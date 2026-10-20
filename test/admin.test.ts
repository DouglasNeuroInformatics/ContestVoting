import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ranking, sendAdminAlerts, voteAudit } from "../src/admin.ts";
import { getSetting } from "../src/db.ts";
import { addEntry, addVote, login, post, setup, type Ctx } from "./helpers.ts";

const ORIGIN = "https://halloween.test";
const ADMIN = "admin@example.org";

const status = (ctx: Ctx, id: number) =>
  (ctx.db.prepare("SELECT status FROM entries WHERE id = ?").get(id) as { status: string } | undefined)?.status;

const adminPost = (ctx: Ctx, cookie: string, path: string, fields: Record<string, string> = {}, from = "/admin") =>
  ctx.app.request(post(path, fields, { cookie, referer: `${ORIGIN}${from}` }));

const get = (ctx: Ctx, path: string, cookie = "") => ctx.app.request(`${ORIGIN}${path}`, { headers: { cookie } });

test("admin pages: anon → login, non-admin → 404, admin → 200", async () => {
  const ctx = setup();
  const user = await login(ctx, "alice@mcgill.ca");
  const admin = await login(ctx, ADMIN);
  for (const path of ["/admin", "/admin/entries", "/admin/votes", "/admin/settings"]) {
    assert.equal((await get(ctx, path)).headers.get("location"), "/login", path);
    assert.equal((await get(ctx, path, user)).status, 404, path);
    assert.equal((await get(ctx, path, admin)).status, 200, path);
  }
  assert.equal((await adminPost(ctx, user, "/admin/settings/phase", { override: "results" })).status, 404);
  assert.equal(getSetting(ctx.db, "phase_override"), null);
});

test("queue lists pending entries with escaped text; approve logs and redirects with notice", async () => {
  const ctx = setup();
  const admin = await login(ctx, ADMIN);
  const { id } = addEntry(ctx, "a@mcgill.ca", "<script>x</script>");
  addEntry(ctx, "b@mcgill.ca", "Already approved", "approved");

  const page = await (await get(ctx, "/admin", admin)).text();
  assert.match(page, /&lt;script&gt;x/);
  assert.doesNotMatch(page, /Already approved/);

  const res = await adminPost(ctx, admin, `/admin/entries/${id}/approve`);
  assert.equal(res.headers.get("location"), "/admin?n=approved");
  assert.equal(status(ctx, id), "approved");
  const log = ctx.db.prepare("SELECT admin_email, action, target FROM admin_log").get() as Record<string, string>;
  assert.deepEqual({ ...log }, { admin_email: ADMIN, action: "approve", target: String(id) });

  assert.equal((await adminPost(ctx, admin, "/admin/entries/999/approve")).headers.get("location"), "/admin?e=not_found");
});

test("reject: emails the owner with the reason and voids its votes", async () => {
  const ctx = setup();
  const admin = await login(ctx, ADMIN);
  const { id } = addEntry(ctx, "owner@mcgill.ca", "Vampire", "approved");
  addVote(ctx, "v@mcgill.ca", id);
  const before = ctx.sent.length;

  await adminPost(ctx, admin, `/admin/entries/${id}/reject`, { reason: "Photo floue" });
  assert.equal(status(ctx, id), "rejected");
  const mail = ctx.sent[before];
  assert.equal(mail.to, "owner@mcgill.ca");
  assert.match(mail.text, /Photo floue/);
  assert.match(mail.text, /\/me\/entry/);
  assert.equal(voteAudit(ctx.db).length, 0);
});

test("remove needs confirmation, then deletes entry, photo files and votes", async () => {
  const ctx = setup();
  const admin = await login(ctx, ADMIN);
  const { id, photo } = addEntry(ctx, "o@mcgill.ca", "Ghost", "approved");
  addVote(ctx, "v@mcgill.ca", id);

  const unconfirmed = await adminPost(ctx, admin, `/admin/entries/${id}/remove`, {}, "/admin/entries");
  assert.equal(unconfirmed.headers.get("location"), "/admin/entries?e=confirm");
  assert.equal(status(ctx, id), "approved");

  await adminPost(ctx, admin, `/admin/entries/${id}/remove`, { confirm: "1" }, "/admin/entries");
  assert.equal(status(ctx, id), undefined);
  assert.equal(voteAudit(ctx.db).length, 0);
  assert.ok(!existsSync(join(ctx.photosDir, photo.file)));
});

test("vote audit flags shared devices and IP bursts; void removes a vote", async () => {
  const ctx = setup();
  const admin = await login(ctx, ADMIN);
  const { id } = addEntry(ctx, "o@mcgill.ca", "Mummy", "approved");
  const t0 = ctx.clock.now.getTime();
  addVote(ctx, "a@mcgill.ca", id, { device: "phone1" });
  addVote(ctx, "b@mcgill.ca", id, { device: "phone1" });
  for (let i = 0; i < 5; i++) addVote(ctx, `n${i}@mcgill.ca`, id, { ip: "1.2.3.4", at: t0 + i * 60_000 });
  addVote(ctx, "late@mcgill.ca", id, { ip: "1.2.3.4", at: t0 + 60 * 60_000 });

  const audit = new Map(voteAudit(ctx.db).map((v) => [v.voterEmail, v.flags]));
  assert.equal(audit.get("a@mcgill.ca")!.sharedDevice, 1);
  assert.equal(audit.get("n0@mcgill.ca")!.ipBurst, 5);
  assert.equal(audit.get("late@mcgill.ca")!.ipBurst, 0, "an hour later is not part of the burst");
  assert.equal(audit.get("late@mcgill.ca")!.sharedDevice, 0);

  const page = await (await get(ctx, "/admin/votes", admin)).text();
  assert.match(page, /same device as 1 other|même appareil que 1 autre/);

  await adminPost(ctx, admin, "/admin/votes/void", { voter: "b@mcgill.ca" }, "/admin/votes");
  assert.ok(!voteAudit(ctx.db).some((v) => v.voterEmail === "b@mcgill.ca"));
});

test("ranking counts only approved entries and marks ties", () => {
  const ctx = setup();
  const a = addEntry(ctx, "a@mcgill.ca", "A", "approved").id;
  const b = addEntry(ctx, "b@mcgill.ca", "B", "approved").id;
  const c = addEntry(ctx, "c@mcgill.ca", "C", "approved").id;
  addEntry(ctx, "d@mcgill.ca", "D pending");
  addVote(ctx, "1@mcgill.ca", a);
  addVote(ctx, "2@mcgill.ca", a);
  addVote(ctx, "3@mcgill.ca", b);
  addVote(ctx, "4@mcgill.ca", c);
  assert.deepEqual(
    ranking(ctx.db).map((r) => [r.name, r.votes, r.tied]),
    [
      ["A", 2, false],
      ["B", 1, true],
      ["C", 1, true],
    ],
  );
});

test("publish: refused while voting, then admins pick the order; phase becomes results; unpublish reverts", async () => {
  const ctx = setup("2026-10-30T19:00:00Z"); // 15:00 Montreal → voting
  const admin = await login(ctx, ADMIN);
  const a = addEntry(ctx, "a@mcgill.ca", "A", "approved").id;
  const b = addEntry(ctx, "b@mcgill.ca", "B", "approved").id;
  addVote(ctx, "1@mcgill.ca", a);
  addVote(ctx, "2@mcgill.ca", b);

  const early = await adminPost(ctx, admin, "/admin/results/publish", { place1: String(a) }, "/admin/settings");
  assert.equal(early.headers.get("location"), "/admin/settings?e=voting_open");

  ctx.clock.now = new Date("2026-10-30T20:30:00Z"); // 16:30 → closed
  const dup = await adminPost(ctx, admin, "/admin/results/publish", { place1: String(a), place2: String(a) }, "/admin/settings");
  assert.equal(dup.headers.get("location"), "/admin/settings?e=invalid_results");

  // Tie 1–1: admins put B first.
  await adminPost(ctx, admin, "/admin/results/publish", { place1: String(b), place2: String(a), place3: "" }, "/admin/settings");
  assert.deepEqual(JSON.parse(getSetting(ctx.db, "results_json")!).map((r: { name: string }) => r.name), ["B", "A"]);
  assert.equal((await (await get(ctx, "/healthz")).json()).phase, "results");

  await adminPost(ctx, admin, "/admin/results/unpublish", {}, "/admin/settings");
  assert.equal((await (await get(ctx, "/healthz")).json()).phase, "closed");
});

test("phase override set and cleared; extra domains validated", async () => {
  const ctx = setup();
  const admin = await login(ctx, ADMIN);
  await adminPost(ctx, admin, "/admin/settings/phase", { override: "closed" }, "/admin/settings");
  assert.equal((await (await get(ctx, "/healthz")).json()).phase, "closed");
  await adminPost(ctx, admin, "/admin/settings/phase", { override: "" }, "/admin/settings");
  assert.equal((await (await get(ctx, "/healthz")).json()).phase, "open");

  const bad = await adminPost(ctx, admin, "/admin/settings/domains", { domains: "ok.ca, not a domain" }, "/admin/settings");
  assert.equal(bad.headers.get("location"), "/admin/settings?e=invalid_domains");
  await adminPost(ctx, admin, "/admin/settings/domains", { domains: "Douglas.McGill.ca, umontreal.ca" }, "/admin/settings");
  assert.equal(getSetting(ctx.db, "extra_domains"), "douglas.mcgill.ca,umontreal.ca");
  const log = ctx.db.prepare("SELECT action FROM admin_log ORDER BY id").all() as { action: string }[];
  assert.deepEqual(log.map((l) => l.action), ["phase_override", "phase_override", "set_domains"]);
});

test("admin alerts are batched: at most one email per admin per 10 min, only for new pending entries", async () => {
  const ctx = setup();
  ctx.sent.length = 0;
  assert.equal(await sendAdminAlerts(ctx.deps), 0, "nothing pending");

  addEntry(ctx, "a@mcgill.ca", "First");
  assert.equal(await sendAdminAlerts(ctx.deps), 1);
  assert.equal(ctx.sent[0].to, ADMIN);
  assert.match(ctx.sent[0].text, /First/);

  ctx.advance(60_000);
  addEntry(ctx, "b@mcgill.ca", "Second");
  assert.equal(await sendAdminAlerts(ctx.deps), 0, "inside the 10-min window");

  ctx.advance(10 * 60_000);
  assert.equal(await sendAdminAlerts(ctx.deps), 1);
  assert.match(ctx.sent[1].text, /Second/);
  assert.doesNotMatch(ctx.sent[1].text, /First/);

  ctx.advance(10 * 60_000);
  assert.equal(await sendAdminAlerts(ctx.deps), 0, "nothing new");
});
