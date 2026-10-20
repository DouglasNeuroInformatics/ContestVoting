import assert from "node:assert/strict";
import { test } from "node:test";
import { addEntry, setup } from "./helpers.ts";

const ORIGIN = "https://halloween.test";
const home = async (ctx: ReturnType<typeof setup>, cookie = "did=viewer-aaaaaaaaaaaaaaaa") =>
  (await ctx.app.request(`${ORIGIN}/`, { headers: { cookie } })).text();

test("gallery shows approved entries only, never owner emails", async () => {
  const ctx = setup();
  addEntry(ctx, "a@mcgill.ca", "Approved Witch", "approved");
  addEntry(ctx, "b@mcgill.ca", "Pending Ghoul", "pending");
  addEntry(ctx, "c@mcgill.ca", "Rejected Bat", "rejected");
  const page = await home(ctx);
  assert.match(page, /Approved Witch/);
  assert.doesNotMatch(page, /Pending Ghoul|Rejected Bat/);
  assert.doesNotMatch(page, /@mcgill\.ca/);
});

test("gallery stays hidden during landing", async () => {
  const ctx = setup("2026-10-21T12:00:00Z");
  addEntry(ctx, "a@mcgill.ca", "Early Approved", "approved");
  assert.doesNotMatch(await home(ctx), /Early Approved/);
});

test("order is stable per viewer and differs across viewers", async () => {
  const ctx = setup();
  for (let i = 0; i < 12; i++) addEntry(ctx, `p${i}@mcgill.ca`, `Costume-${i}`, "approved");
  const order = (page: string) => [...page.matchAll(/<h2>(Costume-\d+)<\/h2>/g)].map((m) => m[1]);
  const a1 = order(await home(ctx, "did=viewer-aaaaaaaaaaaaaaaa"));
  const a2 = order(await home(ctx, "did=viewer-aaaaaaaaaaaaaaaa"));
  assert.equal(a1.length, 12);
  assert.deepEqual(a1, a2);
  const firsts = new Set<string>();
  for (let i = 0; i < 20; i++) firsts.add(order(await home(ctx, `did=viewer-${String(i).padStart(16, "0")}`))[0]);
  assert.ok(firsts.size > 3, `first entry barely varies: ${[...firsts]}`);
});

test("empty gallery shows a friendly message", async () => {
  const ctx = setup();
  assert.match(await home(ctx), /No costumes yet|Aucun costume/);
});
