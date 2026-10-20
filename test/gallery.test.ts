import assert from "node:assert/strict";
import { test } from "node:test";
import { voteAudit } from "../src/admin.ts";
import { setSetting } from "../src/db.ts";
import { addEntry, login, post, setup } from "./helpers.ts";

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

const vote = (ctx: ReturnType<typeof setup>, cookie: string, entry: number) =>
  ctx.app.request(post("/vote", { entry: String(entry) }, { cookie }));

test("vote flow: anonymous is sent to login; vote, see it marked, change it", async () => {
  const ctx = setup();
  const a = addEntry(ctx, "a@mcgill.ca", "Witch", "approved").id;
  const b = addEntry(ctx, "b@mcgill.ca", "Wizard", "approved").id;

  assert.equal((await vote(ctx, "", a)).headers.get("location"), "/login");
  assert.match(await home(ctx), /Log in with your institutional email to vote|Connectez-vous avec votre courriel institutionnel/);

  const cookie = await login(ctx, "voter@mcgill.ca");
  const res = await vote(ctx, cookie, a);
  assert.equal(res.headers.get("location"), `/?voted=1#e${a}`);
  const page = await home(ctx, cookie);
  assert.match(page, new RegExp(`id="e${a}"[\\s\\S]*?(Your vote|Votre vote)[\\s\\S]*?</article>`));

  await vote(ctx, cookie, b);
  const audit = voteAudit(ctx.db);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].entryId, b);
  assert.ok(audit[0].deviceId, "device recorded for the audit");
});

test("voting refused after close and for unapproved entries; counts never shown publicly", async () => {
  const ctx = setup();
  const a = addEntry(ctx, "a@mcgill.ca", "Witch", "approved").id;
  const p = addEntry(ctx, "p@mcgill.ca", "Pending", "pending").id;
  const cookie = await login(ctx, "voter@mcgill.ca");

  assert.equal((await vote(ctx, cookie, p)).headers.get("location"), "/?e=not_votable");
  await vote(ctx, cookie, a);
  assert.doesNotMatch(await home(ctx, cookie), /\b1 vote|\(1\)/);

  ctx.clock.now = new Date("2026-10-30T20:30:00Z"); // 16:30 → closed
  assert.equal((await vote(ctx, cookie, a)).headers.get("location"), "/?e=voting_closed");
  const closed = await home(ctx, cookie);
  assert.doesNotMatch(closed, /action="\/vote"/);
});

test("results banner appears only once published", async () => {
  const ctx = setup("2026-10-30T20:30:00Z"); // closed
  const a = addEntry(ctx, "a@mcgill.ca", "Pumpkin King", "approved").id;
  setSetting(ctx.db, "results_json", JSON.stringify([{ place: 1, id: a, name: "Pumpkin King", votes: 7 }]));
  assert.doesNotMatch(await home(ctx), /class="panel winners"/);
  setSetting(ctx.db, "results_published", "1");
  const page = await home(ctx);
  assert.match(page, /class="panel winners"/);
  assert.match(page, new RegExp(`href="#e${a}">Pumpkin King</a> — 7 vote`));
});
