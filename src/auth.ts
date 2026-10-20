import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.ts";
import { getSetting, type Db } from "./db.ts";
import { codeEmail, type Mailer } from "./mail.ts";

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60_000;
export const MAX_SENDS_PER_EMAIL_PER_HOUR = 5;
const HOUR = 60 * 60_000;

export type AuthDeps = { db: Db; cfg: Config; mailer: Mailer; now: () => Date };

export type User = { email: string; isAdmin: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (raw: string) => raw.trim().toLowerCase();

export function allowedDomains(deps: Pick<AuthDeps, "db" | "cfg">): string[] {
  const extra = (getSetting(deps.db, "extra_domains") ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return [...deps.cfg.allowedDomains, ...extra];
}

export const isAdmin = (cfg: Config, email: string) => cfg.adminEmails.includes(email);

const hashCode = (secret: string, email: string, code: string) =>
  createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type RequestCodeResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid_email" | "domain" | "not_open" | "email_limit" | "ip_limit" | "send_failed" }
  | { ok: false; reason: "cooldown"; retryAfterSec: number };

export async function requestCode(
  deps: AuthDeps,
  rawEmail: string,
  ip: string,
  loginOpen: boolean,
): Promise<RequestCodeResult> {
  const { db, cfg } = deps;
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, reason: "invalid_email" };

  const privileged = isAdmin(cfg, email) || cfg.previewEmails.includes(email);
  if (!privileged && !allowedDomains(deps).includes(email.split("@")[1])) return { ok: false, reason: "domain" };
  if (!privileged && !loginOpen) return { ok: false, reason: "not_open" };

  const now = deps.now().getTime();
  const last = db.prepare("SELECT sent_at FROM otp_codes WHERE email = ?").get(email) as { sent_at: number } | undefined;
  if (last && now - last.sent_at < RESEND_COOLDOWN_MS) {
    return { ok: false, reason: "cooldown", retryAfterSec: Math.ceil((RESEND_COOLDOWN_MS - (now - last.sent_at)) / 1000) };
  }
  const count = (sql: string, v: string) => (db.prepare(sql).get(v, now - HOUR) as { n: number }).n;
  if (count("SELECT COUNT(*) AS n FROM otp_sends WHERE email = ? AND sent_at > ?", email) >= MAX_SENDS_PER_EMAIL_PER_HOUR) {
    return { ok: false, reason: "email_limit" };
  }
  if (count("SELECT COUNT(*) AS n FROM otp_sends WHERE ip = ? AND sent_at > ?", ip) >= cfg.ipSendLimitPerHour) {
    console.warn(`[auth] ip send limit hit ip=${ip} email=${email}`);
    return { ok: false, reason: "ip_limit" };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  db.prepare(
    `INSERT INTO otp_codes (email, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
       attempts = 0, sent_at = excluded.sent_at`,
  ).run(email, hashCode(cfg.sessionSecret, email, code), now + CODE_TTL_MS, now);
  db.prepare("INSERT INTO otp_sends (email, ip, sent_at) VALUES (?, ?, ?)").run(email, ip, now);

  try {
    await deps.mailer.send(codeEmail(email, code, cfg.baseUrl));
  } catch (e) {
    console.error(`[auth] sending code to ${email} failed:`, e);
    db.prepare("DELETE FROM otp_codes WHERE email = ?").run(email);
    return { ok: false, reason: "send_failed" };
  }
  return { ok: true, email };
}

export type VerifyResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; reason: "no_code" | "expired" | "too_many" }
  | { ok: false; reason: "wrong"; attemptsLeft: number };

export function verifyCode(
  deps: AuthDeps,
  rawEmail: string,
  rawCode: string,
  meta: { deviceId: string; ip: string; ua: string },
): VerifyResult {
  const { db, cfg } = deps;
  const email = normalizeEmail(rawEmail);
  const code = rawCode.replace(/\s+/g, "");
  const now = deps.now().getTime();
  const row = db.prepare("SELECT code_hash, expires_at, attempts FROM otp_codes WHERE email = ?").get(email) as
    | { code_hash: string; expires_at: number; attempts: number }
    | undefined;
  if (!row) return { ok: false, reason: "no_code" };
  if (now > row.expires_at) {
    db.prepare("DELETE FROM otp_codes WHERE email = ?").run(email);
    return { ok: false, reason: "expired" };
  }
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "too_many" };

  const expected = Buffer.from(row.code_hash, "hex");
  const actual = Buffer.from(hashCode(cfg.sessionSecret, email, code), "hex");
  if (!/^\d{6}$/.test(code) || !timingSafeEqual(expected, actual)) {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      db.prepare("DELETE FROM otp_codes WHERE email = ?").run(email);
      return { ok: false, reason: "too_many" };
    }
    db.prepare("UPDATE otp_codes SET attempts = ? WHERE email = ?").run(attempts, email);
    return { ok: false, reason: "wrong", attemptsLeft: MAX_ATTEMPTS - attempts };
  }

  db.prepare("DELETE FROM otp_codes WHERE email = ?").run(email);
  db.prepare("INSERT INTO users (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING").run(email, now);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Math.max(cfg.sessionEndAt.getTime(), now + HOUR));
  db.prepare(
    "INSERT INTO sessions (token_hash, email, device_id, ip, ua, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(hashToken(token), email, meta.deviceId, meta.ip, meta.ua.slice(0, 300), now, expiresAt.getTime());
  return { ok: true, token, expiresAt };
}

export function getSessionUser(deps: Pick<AuthDeps, "db" | "cfg" | "now">, token: string | undefined): User | null {
  if (!token) return null;
  const row = deps.db.prepare("SELECT email, expires_at FROM sessions WHERE token_hash = ?").get(hashToken(token)) as
    | { email: string; expires_at: number }
    | undefined;
  if (!row || row.expires_at < deps.now().getTime()) return null;
  return { email: row.email, isAdmin: isAdmin(deps.cfg, row.email) };
}

export function deleteSession(db: Db, token: string | undefined): void {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}
