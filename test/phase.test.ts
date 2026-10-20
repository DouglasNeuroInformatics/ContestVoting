import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { computePhase } from "../src/phase.ts";
import { zonedTimeToUtc } from "../src/time.ts";
import { TEST_ENV } from "./helpers.ts";

test("zonedTimeToUtc handles Montreal EDT and EST", () => {
  // Oct 30 is still EDT (UTC-4); Nov 2 2026 is after the switch to EST (UTC-5).
  assert.equal(zonedTimeToUtc("2026-10-30T08:00", "America/Montreal").toISOString(), "2026-10-30T12:00:00.000Z");
  assert.equal(zonedTimeToUtc("2026-11-02T08:00", "America/Montreal").toISOString(), "2026-11-02T13:00:00.000Z");
});

test("phase follows the clock at each boundary", () => {
  const cfg = loadConfig(TEST_ENV);
  const at = (iso: string, published = false) => computePhase(new Date(iso), cfg, null, published);
  assert.equal(at("2026-10-30T11:59:59Z"), "landing");
  assert.equal(at("2026-10-30T12:00:00Z"), "open");
  assert.equal(at("2026-10-30T17:59:59Z"), "open");
  assert.equal(at("2026-10-30T18:00:00Z"), "voting");
  assert.equal(at("2026-10-30T20:00:00Z"), "closed");
  assert.equal(at("2026-10-30T20:00:00Z", true), "results");
});

test("valid override wins, invalid override is ignored", () => {
  const cfg = loadConfig(TEST_ENV);
  const now = new Date("2026-10-20T12:00:00Z");
  assert.equal(computePhase(now, cfg, "voting", false), "voting");
  assert.equal(computePhase(now, cfg, "bogus", false), "landing");
});

test("config rejects out-of-order times and short secrets", () => {
  assert.throws(() => loadConfig({ ...TEST_ENV, VOTE_CLOSE_AT: "2026-10-30T07:00" }), /OPEN_AT < SUBMIT_CLOSE_AT/);
  assert.throws(() => loadConfig({ ...TEST_ENV, SESSION_SECRET: "short" }), /at least 32/);
});
