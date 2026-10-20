import assert from "node:assert/strict";
import { test } from "node:test";
import { setSetting } from "../src/db.ts";
import { post, setup } from "./helpers.ts";

const sessionCookie = (res: Response) => /sid=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];

async function login(ctx: ReturnType<typeof setup>, email: string) {
  await ctx.app.request(post("/login", { email }));
  const res = await ctx.app.request(post("/login/verify", { email, code: ctx.lastCode() }));
  return { res, sid: sessionCookie(res) };
}

test("happy path: code by email, verify, session cookie, logged-in page", async () => {
  const ctx = setup();
  const res1 = await ctx.app.request(post("/login", { email: "  Alice@McGill.ca " }));
  assert.equal(res1.status, 200);
  assert.equal(ctx.sent.length, 1);
  assert.equal(ctx.sent[0].to, "alice@mcgill.ca");

  const { res, sid } = await login(ctx, "alice@mcgill.ca");
  assert.equal(res.status, 302);
  assert.ok(sid);
  const home = await ctx.app.request("https://halloween.test/", { headers: { cookie: `sid=${sid}` } });
  assert.match(await home.text(), /alice@mcgill\.ca/);
});

test("rejects non-institutional domains and lookalikes", async () => {
  const ctx = setup();
  for (const email of ["bob@gmail.com", "bob@evilmcgill.ca", "bob@mcgill.ca.evil.com", "not-an-email"]) {
    const res = await ctx.app.request(post("/login", { email }));
    assert.equal(res.status, 400, email);
  }
  assert.equal(ctx.sent.length, 0);
});

test("login closed during landing, except for admins and preview testers", async () => {
  const ctx = setup("2026-10-21T12:00:00Z");
  assert.equal((await ctx.app.request(post("/login", { email: "alice@mcgill.ca" }))).status, 400);
  assert.equal((await ctx.app.request(post("/login", { email: "admin@example.org" }))).status, 200);
  assert.equal((await ctx.app.request(post("/login", { email: "tester@mcgill.ca" }))).status, 200);
  assert.equal(ctx.sent.length, 2);
});

test("resend cooldown, then per-email hourly cap", async () => {
  const ctx = setup();
  const email = "carol@mcgill.ca";
  assert.equal((await ctx.app.request(post("/login", { email }))).status, 200);
  assert.equal((await ctx.app.request(post("/login", { email }))).status, 429);
  for (let i = 0; i < 4; i++) {
    ctx.advance(61_000);
    assert.equal((await ctx.app.request(post("/login", { email }))).status, 200);
  }
  ctx.advance(61_000);
  assert.equal((await ctx.app.request(post("/login", { email }))).status, 429);
  assert.equal(ctx.sent.length, 5);
});

test("wrong codes burn attempts; 5th wrong kills the code", async () => {
  const ctx = setup();
  const email = "dan@mcgill.ca";
  await ctx.app.request(post("/login", { email }));
  const code = ctx.lastCode();
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 4; i++) {
    const res = await ctx.app.request(post("/login/verify", { email, code: wrong }));
    assert.equal(res.status, 400);
  }
  const fifth = await ctx.app.request(post("/login/verify", { email, code: wrong }));
  assert.match(await fifth.text(), /Too many|Trop d/);
  const late = await ctx.app.request(post("/login/verify", { email, code }));
  assert.equal(late.status, 400, "correct code must not work after lockout");
});

test("code expires after 10 minutes and is single-use", async () => {
  const ctx = setup();
  const email = "erin@mcgill.ca";
  await ctx.app.request(post("/login", { email }));
  const code = ctx.lastCode();
  ctx.advance(10 * 60_000 + 1);
  assert.equal((await ctx.app.request(post("/login/verify", { email, code }))).status, 400);

  ctx.advance(61_000);
  await ctx.app.request(post("/login", { email }));
  const code2 = ctx.lastCode();
  assert.equal((await ctx.app.request(post("/login/verify", { email, code: code2 }))).status, 302);
  assert.equal((await ctx.app.request(post("/login/verify", { email, code: code2 }))).status, 400);
});

test("cross-origin POST is refused", async () => {
  const ctx = setup();
  const res = await ctx.app.request(post("/login", { email: "x@mcgill.ca" }, { origin: "https://evil.example" }));
  assert.equal(res.status, 403);
  assert.equal(ctx.sent.length, 0);
});

test("admin-added domain is accepted at runtime", async () => {
  const ctx = setup();
  assert.equal((await ctx.app.request(post("/login", { email: "f@douglas.mcgill.ca" }))).status, 400);
  setSetting(ctx.db, "extra_domains", "douglas.mcgill.ca");
  assert.equal((await ctx.app.request(post("/login", { email: "f@douglas.mcgill.ca" }))).status, 200);
});

test("logout ends the session", async () => {
  const ctx = setup();
  const { sid } = await login(ctx, "gail@mcgill.ca");
  await ctx.app.request(post("/logout", {}, { cookie: `sid=${sid}` }));
  const home = await ctx.app.request("https://halloween.test/", { headers: { cookie: `sid=${sid}` } });
  assert.doesNotMatch(await home.text(), /gail@mcgill\.ca/);
});

test("language: Accept-Language picks English, French is the fallback", async () => {
  const ctx = setup("2026-10-21T12:00:00Z");
  const en = await ctx.app.request("https://halloween.test/", { headers: { "accept-language": "en-CA,en;q=0.9" } });
  assert.match(await en.text(), /<html lang="en">/);
  const de = await ctx.app.request("https://halloween.test/", { headers: { "accept-language": "de-DE" } });
  assert.match(await de.text(), /<html lang="fr">/);
});

test("user text is escaped in pages", async () => {
  const ctx = setup();
  const res = await ctx.app.request(post("/login", { email: '"><script>alert(1)</script>' }));
  assert.doesNotMatch(await res.text(), /<script>alert/);
});
