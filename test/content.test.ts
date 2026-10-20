import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.ts";

const ORIGIN = "https://halloween.test";
const page = async (ctx: ReturnType<typeof setup>, path: string, lang: string) =>
  (await ctx.app.request(`${ORIGIN}${path}`, { headers: { "accept-language": lang } })).text();

test("landing shows the opening date and the rules in the viewer's language", async () => {
  const ctx = setup("2026-10-21T12:00:00Z");
  const fr = await page(ctx, "/", "fr-CA");
  assert.match(fr, /30 octobre/);
  assert.match(fr, /<div class="panel rules"><h2>Le 30 octobre/);
  const en = await page(ctx, "/", "en-CA");
  assert.match(en, /<div class="panel rules"><h2>On October 30/);
});

test("/rules is available in every phase and linked from the gallery", async () => {
  const ctx = setup();
  assert.match(await page(ctx, "/rules", "en"), /How it works/);
  assert.match(await page(ctx, "/", "en"), /href="\/rules"/);
});

test("missing content file still renders the page", async () => {
  const ctx = setup("2026-10-21T12:00:00Z");
  ctx.cfg.contentDir = "/nonexistent";
  const res = await ctx.app.request(`${ORIGIN}/`);
  assert.equal(res.status, 200);
  assert.doesNotMatch(await res.text(), /panel rules/);
});
