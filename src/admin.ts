import type { AuthDeps } from "./auth.ts";
import { getSetting, setSetting, type Db } from "./db.ts";
import { CATEGORIES, type Category, type EntryStatus } from "./entries.ts";
import { adminAlertEmail, rejectionEmail } from "./mail.ts";

export const REASON_MAX = 200;
const BURST_WINDOW_MS = 10 * 60_000;
const BURST_MIN_VOTES = 5;

export function logAdmin(db: Db, admin: string, action: string, target: string | null, detail: string | null, now: number) {
  db.prepare("INSERT INTO admin_log (admin_email, action, target, detail, at) VALUES (?, ?, ?, ?, ?)").run(
    admin,
    action,
    target,
    detail,
    now,
  );
}

export type LogRow = { admin_email: string; action: string; target: string | null; detail: string | null; at: number };

export const recentLog = (db: Db, limit = 50) =>
  db.prepare("SELECT admin_email, action, target, detail, at FROM admin_log ORDER BY id DESC LIMIT ?").all(limit) as LogRow[];

// ---- Entries ----------------------------------------------------------------

export type AdminEntry = {
  id: number;
  ownerEmail: string;
  name: string;
  category: Category;
  caption: string;
  status: EntryStatus;
  rejectReason: string | null;
  updatedAt: number;
  votes: number;
  thumbs: string[];
  files: string[];
};

export function listEntries(db: Db, status?: EntryStatus): AdminEntry[] {
  const rows = db
    .prepare(
      `SELECT e.id, e.owner_email, e.name, e.category, e.caption, e.status, e.reject_reason, e.updated_at,
              (SELECT COUNT(*) FROM votes v WHERE v.entry_id = e.id) AS votes
         FROM entries e ${status ? "WHERE e.status = ?" : ""}
        ORDER BY e.updated_at ASC`,
    )
    .all(...(status ? [status] : [])) as {
    id: number;
    owner_email: string;
    name: string;
    category: Category;
    caption: string;
    status: EntryStatus;
    reject_reason: string | null;
    updated_at: number;
    votes: number;
  }[];
  const photos = db.prepare("SELECT file, thumb FROM photos WHERE entry_id = ? ORDER BY position");
  return rows.map((r) => {
    const ps = photos.all(r.id) as { file: string; thumb: string }[];
    return {
      id: r.id,
      ownerEmail: r.owner_email,
      name: r.name,
      category: r.category,
      caption: r.caption,
      status: r.status,
      rejectReason: r.reject_reason,
      updatedAt: r.updated_at,
      votes: r.votes,
      thumbs: ps.map((p) => p.thumb),
      files: ps.map((p) => p.file),
    };
  });
}

const entryById = (db: Db, id: number) =>
  db.prepare("SELECT id, owner_email, name, status FROM entries WHERE id = ?").get(id) as
    | { id: number; owner_email: string; name: string; status: EntryStatus }
    | undefined;

export function approveEntry(deps: AuthDeps, admin: string, id: number): boolean {
  const entry = entryById(deps.db, id);
  if (!entry) return false;
  const now = deps.now().getTime();
  deps.db.prepare("UPDATE entries SET status = 'approved', reject_reason = NULL WHERE id = ?").run(id);
  logAdmin(deps.db, admin, "approve", String(id), entry.name, now);
  return true;
}

export async function rejectEntry(deps: AuthDeps, admin: string, id: number, reason: string): Promise<boolean> {
  const entry = entryById(deps.db, id);
  if (!entry) return false;
  const now = deps.now().getTime();
  const r = reason.trim().slice(0, REASON_MAX) || null;
  // Votes for an entry that is no longer approved are void.
  deps.db.prepare("DELETE FROM votes WHERE entry_id = ?").run(id);
  deps.db.prepare("UPDATE entries SET status = 'rejected', reject_reason = ? WHERE id = ?").run(r, id);
  logAdmin(deps.db, admin, "reject", String(id), [entry.name, r].filter(Boolean).join(" — "), now);
  try {
    await deps.mailer.send(rejectionEmail(entry.owner_email, entry.name, r, deps.cfg.baseUrl));
  } catch (e) {
    console.error(`[admin] rejection email to ${entry.owner_email} failed:`, e);
  }
  return true;
}

// ---- Votes ------------------------------------------------------------------

export type AuditVote = {
  voterEmail: string;
  category: Category;
  entryId: number;
  entryName: string;
  deviceId: string | null;
  ip: string | null;
  ua: string | null;
  at: number;
  flags: { sharedDevice: number; ipBurst: number };
};

/**
 * Every vote with soft fraud flags. Flags are hints for a human, never automatic:
 * DRC wifi is one shared IP and people do lend phones.
 * - sharedDevice: other voters who voted from the same browser
 * - ipBurst: votes from the same IP within ±10 min (only set when ≥ 5)
 * Both count within one category: a voter's own two votes always share a device.
 */
export function voteAudit(db: Db): AuditVote[] {
  const rows = db
    .prepare(
      `SELECT v.voter_email, v.category, v.entry_id, e.name, v.device_id, v.ip, v.ua, v.updated_at
         FROM votes v JOIN entries e ON e.id = v.entry_id ORDER BY v.updated_at DESC`,
    )
    .all() as {
    voter_email: string;
    category: Category;
    entry_id: number;
    name: string;
    device_id: string | null;
    ip: string | null;
    ua: string | null;
    updated_at: number;
  }[];
  const byDevice = new Map<string, number>();
  const key = (r: { device_id: string | null; category: string }) => `${r.category}:${r.device_id}`;
  for (const r of rows) if (r.device_id) byDevice.set(key(r), (byDevice.get(key(r)) ?? 0) + 1);
  return rows.map((r) => {
    const burst = r.ip
      ? rows.filter(
          (o) => o.ip === r.ip && o.category === r.category && Math.abs(o.updated_at - r.updated_at) <= BURST_WINDOW_MS,
        ).length
      : 0;
    return {
      voterEmail: r.voter_email,
      category: r.category,
      entryId: r.entry_id,
      entryName: r.name,
      deviceId: r.device_id,
      ip: r.ip,
      ua: r.ua,
      at: r.updated_at,
      flags: {
        sharedDevice: r.device_id ? byDevice.get(key(r))! - 1 : 0,
        ipBurst: burst >= BURST_MIN_VOTES ? burst : 0,
      },
    };
  });
}

export function voidVote(deps: AuthDeps, admin: string, voterEmail: string, category: Category): boolean {
  const res = deps.db.prepare("DELETE FROM votes WHERE voter_email = ? AND category = ?").run(voterEmail, category);
  if (res.changes === 0) return false;
  logAdmin(deps.db, admin, "void_vote", voterEmail, category, deps.now().getTime());
  return true;
}

// ---- Results ----------------------------------------------------------------

export type Ranked = { id: number; name: string; votes: number; tied: boolean };

/** Approved entries of one category by votes; `tied` marks entries sharing a count with a neighbour. */
export function ranking(db: Db, category: Category): Ranked[] {
  const rows = db
    .prepare(
      `SELECT e.id, e.name, COUNT(v.voter_email) AS votes
         FROM entries e LEFT JOIN votes v ON v.entry_id = e.id
        WHERE e.status = 'approved' AND e.category = ?
        GROUP BY e.id ORDER BY votes DESC, e.id ASC`,
    )
    .all(category) as { id: number; name: string; votes: number }[];
  return rows.map((r, i) => ({
    ...r,
    tied: rows[i - 1]?.votes === r.votes || rows[i + 1]?.votes === r.votes,
  }));
}

export type Rankings = Record<Category, Ranked[]>;

export const rankings = (db: Db): Rankings =>
  Object.fromEntries(CATEGORIES.map((c) => [c, ranking(db, c)])) as Rankings;

export type Results = { category: Category; place: number; id: number; name: string; votes: number }[];

export function getResults(db: Db): Results | null {
  const raw = getSetting(db, "results_json");
  return raw ? (JSON.parse(raw) as Results) : null;
}

/**
 * Admins pick the final order per category (that is how ties are broken); counts are
 * snapshotted. Every picked id must be an approved entry of that category, without repeats.
 */
export function publishResults(deps: AuthDeps, admin: string, picks: Record<Category, number[]>): "ok" | "invalid" {
  const results: Results = [];
  for (const category of CATEGORIES) {
    const ids = picks[category];
    const ranked = ranking(deps.db, category);
    const picked = ids.map((id) => ranked.find((r) => r.id === id));
    if (picked.some((p) => !p) || new Set(ids).size !== ids.length) return "invalid";
    picked.forEach((p, i) => results.push({ category, place: i + 1, id: p!.id, name: p!.name, votes: p!.votes }));
  }
  if (results.length === 0) return "invalid";
  setSetting(deps.db, "results_json", JSON.stringify(results));
  setSetting(deps.db, "results_published", "1");
  const detail = results.map((r) => `${r.category} ${r.place}. ${r.name} (${r.votes})`).join("; ");
  logAdmin(deps.db, admin, "publish_results", null, detail, deps.now().getTime());
  return "ok";
}

export function unpublishResults(deps: AuthDeps, admin: string): void {
  setSetting(deps.db, "results_published", null);
  logAdmin(deps.db, admin, "unpublish_results", null, null, deps.now().getTime());
}

// ---- Settings ---------------------------------------------------------------

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function setExtraDomains(deps: AuthDeps, admin: string, raw: string): string[] | "invalid" {
  const domains = [...new Set(raw.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean))];
  if (domains.some((d) => !DOMAIN_RE.test(d))) return "invalid";
  setSetting(deps.db, "extra_domains", domains.length ? domains.join(",") : null);
  logAdmin(deps.db, admin, "set_domains", null, domains.join(", ") || "(none)", deps.now().getTime());
  return domains;
}

// ---- Batched admin alerts ---------------------------------------------------

/**
 * Called every minute by the server. Sends at most one email per ADMIN_ALERT_MINUTES (0 = off),
 * listing entries that became pending since the last alert.
 */
export async function sendAdminAlerts(deps: AuthDeps): Promise<number> {
  const minutes = deps.cfg.adminAlertMinutes;
  if (minutes === 0) return 0;
  const now = deps.now().getTime();
  const last = Number(getSetting(deps.db, "admin_alert_at") ?? 0);
  if (now - last < minutes * 60_000) return 0;
  const fresh = deps.db
    .prepare("SELECT name FROM entries WHERE status = 'pending' AND updated_at > ? ORDER BY updated_at")
    .all(last) as { name: string }[];
  if (fresh.length === 0) return 0;
  const pendingTotal = (deps.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE status = 'pending'").get() as { n: number }).n;
  setSetting(deps.db, "admin_alert_at", String(now));
  let sent = 0;
  for (const to of deps.cfg.adminEmails) {
    try {
      await deps.mailer.send(adminAlertEmail(to, fresh.map((f) => f.name), pendingTotal, deps.cfg.baseUrl));
      sent++;
    } catch (e) {
      console.error(`[admin] alert to ${to} failed:`, e);
    }
  }
  return sent;
}
