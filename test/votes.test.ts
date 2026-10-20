import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../src/db.ts";
import { castVote, myVote } from "../src/votes.ts";

function db() {
  const d = openDb(":memory:");
  const add = (owner: string, status: string) =>
    Number(
      d
        .prepare("INSERT INTO entries (owner_email, name, status, consent_at, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 0)")
        .run(owner, owner, status).lastInsertRowid,
    );
  return { d, approved: add("a@x", "approved"), other: add("b@x", "approved"), pending: add("c@x", "pending") };
}

const meta = { deviceId: "dev", ip: "1.1.1.1", ua: "ua", now: 1 };

test("one vote per voter; voting again replaces it", () => {
  const { d, approved, other } = db();
  assert.deepEqual(castVote(d, "open", "v@x", approved, meta), { ok: true });
  assert.equal(myVote(d, "v@x"), approved);
  assert.deepEqual(castVote(d, "voting", "v@x", other, { ...meta, now: 2 }), { ok: true });
  assert.equal(myVote(d, "v@x"), other);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM votes").get() as { n: number }).n, 1);
});

test("only approved entries, only while voting is open", () => {
  const { d, approved, pending } = db();
  assert.deepEqual(castVote(d, "open", "v@x", pending, meta), { ok: false, reason: "not_votable" });
  assert.deepEqual(castVote(d, "open", "v@x", 999, meta), { ok: false, reason: "not_votable" });
  for (const phase of ["landing", "closed", "results"] as const) {
    assert.deepEqual(castVote(d, phase, "v@x", approved, meta), { ok: false, reason: "voting_closed" });
  }
  assert.equal(myVote(d, "v@x"), null);
});

test("self-votes are allowed", () => {
  const { d, approved } = db();
  assert.deepEqual(castVote(d, "open", "a@x", approved, meta), { ok: true });
});
