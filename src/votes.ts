import type { Db } from "./db.ts";
import type { Phase } from "./phase.ts";

export const votingOpen = (phase: Phase) => phase === "open" || phase === "voting";

export type VoteResult = { ok: true } | { ok: false; reason: "voting_closed" | "not_votable" };

/**
 * One vote per email; voting again replaces the earlier vote. Only approved
 * entries can receive votes. Device, IP and user agent are kept for the admin audit.
 */
export function castVote(
  db: Db,
  phase: Phase,
  voter: string,
  entryId: number,
  meta: { deviceId: string; ip: string; ua: string; now: number },
): VoteResult {
  if (!votingOpen(phase)) return { ok: false, reason: "voting_closed" };
  const entry = db.prepare("SELECT status FROM entries WHERE id = ?").get(entryId) as { status: string } | undefined;
  if (entry?.status !== "approved") return { ok: false, reason: "not_votable" };
  db.prepare(
    `INSERT INTO votes (voter_email, entry_id, device_id, ip, ua, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(voter_email) DO UPDATE SET entry_id = excluded.entry_id, device_id = excluded.device_id,
       ip = excluded.ip, ua = excluded.ua, updated_at = excluded.updated_at`,
  ).run(voter, entryId, meta.deviceId, meta.ip, meta.ua.slice(0, 300), meta.now);
  return { ok: true };
}

export function myVote(db: Db, voter: string): number | null {
  const row = db.prepare("SELECT entry_id FROM votes WHERE voter_email = ?").get(voter) as { entry_id: number } | undefined;
  return row?.entry_id ?? null;
}
