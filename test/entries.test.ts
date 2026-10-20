import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { setSetting } from "../src/db.ts";
import { getEntryByOwner } from "../src/entries.ts";
import { login, setup, type Ctx } from "./helpers.ts";

const ORIGIN = "https://halloween.test";

/** A 3000x2000 JPEG carrying EXIF (incl. orientation) — must come out small and metadata-free. */
const jpeg = () =>
  sharp({ create: { width: 3000, height: 2000, channels: 3, background: "orange" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();

const heicBytes = () => {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(24, 0);
  b.write("ftypheic", 4, "latin1");
  return b;
};

type FileSpec = { bytes: Buffer; name?: string; type?: string };

function entryForm(fields: Record<string, string>, files: FileSpec[]) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append("photos", new File([new Uint8Array(f.bytes)], f.name ?? "p.jpg", { type: f.type ?? "image/jpeg" }));
  return fd;
}

const submit = (ctx: Ctx, cookie: string, fields: Record<string, string>, files: FileSpec[]) =>
  ctx.app.request(
    new Request(`${ORIGIN}/me/entry`, { method: "POST", headers: { origin: ORIGIN, cookie }, body: entryForm(fields, files) }),
  );

const formPost = (ctx: Ctx, path: string, cookie: string, fields: Record<string, string> = {}) =>
  ctx.app.request(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { origin: ORIGIN, cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    }),
  );

const get = (ctx: Ctx, path: string, cookie = "") => ctx.app.request(`${ORIGIN}${path}`, { headers: { cookie } });

const valid = { name: "Zombie Lab", caption: "Braaains", consent: "1" };
const photoFiles = (ctx: Ctx) => readdirSync(ctx.photosDir);

test("entry pages need login", async () => {
  const ctx = setup();
  const res = await get(ctx, "/me/entry");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/login");
});

test("submit: photos resized to WebP, metadata stripped, entry pending", async () => {
  const ctx = setup();
  const cookie = await login(ctx, "alice@mcgill.ca");
  const res = await submit(ctx, cookie, valid, [{ bytes: await jpeg() }, { bytes: await jpeg() }]);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/me/entry?saved=1");

  const entry = getEntryByOwner(ctx.db, "alice@mcgill.ca")!;
  assert.equal(entry.status, "pending");
  assert.equal(entry.name, "Zombie Lab");
  assert.equal(entry.photos.length, 2);
  assert.equal(photoFiles(ctx).length, 4);

  const meta = await sharp(join(ctx.photosDir, entry.photos[0].file)).metadata();
  assert.equal(meta.format, "webp");
  assert.ok(Math.max(meta.width!, meta.height!) <= 1600);
  assert.equal(meta.exif, undefined);
  // Orientation 6 = rotate 90°, so the landscape source must come out portrait.
  assert.ok(meta.height! > meta.width!);

  const page = await (await get(ctx, "/me/entry?saved=1", cookie)).text();
  assert.match(page, /Zombie Lab/);
  assert.match(page, /badge pending/);
});

test("validation errors save nothing", async () => {
  const ctx = setup();
  const cookie = await login(ctx, "bob@mcgill.ca");
  const img = { bytes: await jpeg() };
  const cases: [Record<string, string>, FileSpec[], RegExp][] = [
    [{ ...valid, consent: "" }, [img], /consent/i],
    [valid, [], /at least one photo|au moins une photo/],
    [valid, [img, img, img, img], /Three photos|Trois photos/],
    [{ ...valid, name: "x".repeat(61) }, [img], /60/],
    [{ ...valid, caption: "x".repeat(201) }, [img], /200/],
    [valid, [{ bytes: Buffer.from("not an image"), name: "x.jpg" }], /Unsupported|non pris en charge/],
    [valid, [img, { bytes: heicBytes(), name: "IMG_1.HEIC", type: "image/heic" }], /HEIC/],
    [valid, [{ bytes: await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).gif().toBuffer() }], /Unsupported|non pris en charge/],
  ];
  for (const [fields, files, msg] of cases) {
    const res = await submit(ctx, cookie, fields, files);
    assert.equal(res.status, 400, String(msg));
    assert.match(await res.text(), msg);
  }
  assert.equal(getEntryByOwner(ctx.db, "bob@mcgill.ca"), null);
  assert.equal(photoFiles(ctx).length, 0, "no files left behind");
});

test("edit without photos keeps them; edit with photos replaces and deletes old files; any edit → pending", async () => {
  const ctx = setup();
  const cookie = await login(ctx, "carol@mcgill.ca");
  await submit(ctx, cookie, valid, [{ bytes: await jpeg() }]);
  const first = getEntryByOwner(ctx.db, "carol@mcgill.ca")!;
  ctx.db.prepare("UPDATE entries SET status = 'approved' WHERE id = ?").run(first.id);

  await submit(ctx, cookie, { ...valid, name: "Renamed" }, []);
  const second = getEntryByOwner(ctx.db, "carol@mcgill.ca")!;
  assert.equal(second.name, "Renamed");
  assert.equal(second.status, "pending");
  assert.deepEqual(second.photos, first.photos);

  await submit(ctx, cookie, valid, [{ bytes: await jpeg() }, { bytes: await jpeg() }]);
  const third = getEntryByOwner(ctx.db, "carol@mcgill.ca")!;
  assert.equal(third.photos.length, 2);
  assert.equal(third.id, first.id, "still one entry per person");
  assert.ok(!existsSync(join(ctx.photosDir, first.photos[0].file)), "old photo deleted");
  assert.equal(photoFiles(ctx).length, 4);
});

test("rejected entry shows the reason", async () => {
  const ctx = setup();
  const cookie = await login(ctx, "dan@mcgill.ca");
  await submit(ctx, cookie, valid, [{ bytes: await jpeg() }]);
  ctx.db.prepare("UPDATE entries SET status = 'rejected', reject_reason = 'Photo floue' WHERE owner_email = ?").run("dan@mcgill.ca");
  const page = await (await get(ctx, "/me/entry", cookie)).text();
  assert.match(page, /badge rejected/);
  assert.match(page, /Photo floue/);
});

test("submissions close at 14:00 but withdraw still works during voting; withdraw deletes photos and votes", async () => {
  const ctx = setup();
  const cookie = await login(ctx, "erin@mcgill.ca");
  await submit(ctx, cookie, valid, [{ bytes: await jpeg() }]);
  const entry = getEntryByOwner(ctx.db, "erin@mcgill.ca")!;
  ctx.db.prepare("INSERT INTO votes (voter_email, entry_id, updated_at) VALUES ('v@mcgill.ca', ?, 0)").run(entry.id);

  ctx.clock.now = new Date("2026-10-30T18:30:00Z"); // 14:30 Montreal → voting
  const late = await submit(ctx, cookie, { ...valid, name: "Too late" }, []);
  assert.equal(late.status, 400);
  assert.equal(getEntryByOwner(ctx.db, "erin@mcgill.ca")!.name, "Zombie Lab");

  const unconfirmed = await formPost(ctx, "/me/entry/withdraw", cookie);
  assert.equal(unconfirmed.status, 400);

  const res = await formPost(ctx, "/me/entry/withdraw", cookie, { confirm: "1" });
  assert.equal(res.headers.get("location"), "/me/entry?withdrawn=1");
  assert.equal(getEntryByOwner(ctx.db, "erin@mcgill.ca"), null);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM votes").get() as { n: number }).n, 0);
  assert.equal(photoFiles(ctx).length, 0);
});

test("withdraw refused once voting has closed", async () => {
  const ctx = setup();
  const cookie = await login(ctx, "fay@mcgill.ca");
  await submit(ctx, cookie, valid, [{ bytes: await jpeg() }]);
  setSetting(ctx.db, "phase_override", "closed");
  const res = await formPost(ctx, "/me/entry/withdraw", cookie, { confirm: "1" });
  assert.equal(res.status, 400);
  assert.ok(getEntryByOwner(ctx.db, "fay@mcgill.ca"));
});

test("photo access: pending only to owner and admins; approved to everyone; bad names 404", async () => {
  const ctx = setup();
  const owner = await login(ctx, "gus@mcgill.ca");
  const other = await login(ctx, "hal@mcgill.ca");
  const admin = await login(ctx, "admin@example.org");
  await submit(ctx, owner, valid, [{ bytes: await jpeg() }]);
  const { file, thumb } = getEntryByOwner(ctx.db, "gus@mcgill.ca")!.photos[0];

  assert.equal((await get(ctx, `/photos/${file}`, owner)).status, 200);
  assert.equal((await get(ctx, `/photos/${thumb}`, admin)).status, 200);
  assert.equal((await get(ctx, `/photos/${file}`, other)).status, 404);
  assert.equal((await get(ctx, `/photos/${file}`)).status, 404);

  ctx.db.prepare("UPDATE entries SET status = 'approved'").run();
  const pub = await get(ctx, `/photos/${file}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.headers.get("content-type"), "image/webp");

  for (const bad of ["..%2Fapp.db", "nothex.webp", `${file.slice(0, -5)}.jpg`]) {
    assert.equal((await get(ctx, `/photos/${bad}`, admin)).status, 404, bad);
  }
});
