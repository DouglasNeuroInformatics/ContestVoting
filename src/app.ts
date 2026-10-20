import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { deleteSession, getSessionUser, requestCode, verifyCode, type AuthDeps, type User } from "./auth.ts";
import { getSetting } from "./db.ts";
import { deleteEntry, getEntryByOwner, photoOwner, saveEntry, validateFields } from "./entries.ts";
import { detectLang, errorText, formatDateTime, t, type ErrorKey, type Lang } from "./i18n.ts";
import { computePhase, type Phase } from "./phase.ts";
import { deletePhotoFiles, isPhotoName, MAX_PHOTO_BYTES, MAX_PHOTOS, processPhoto, storePhoto } from "./photos.ts";
import { entryPage, homePage, landingPage, layout, loginPage, verifyPage } from "./views.ts";

type Env = {
  Variables: { lang: Lang; user: User | null; deviceId: string; ip: string };
};

const SESSION_COOKIE = "sid";
const DEVICE_COOKIE = "did";
const LANG_COOKIE = "lang";
const YEAR_S = 365 * 24 * 3600;

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

export function createApp(deps: AuthDeps) {
  const { db, cfg } = deps;
  const app = new Hono<Env>();

  const phaseNow = (): Phase =>
    computePhase(deps.now(), cfg, getSetting(db, "phase_override"), getSetting(db, "results_published") === "1");

  const cookieOpts = { path: "/", httpOnly: true, secure: cfg.secureCookies, sameSite: "Lax" as const };

  app.use(async (c, next) => {
    c.header("Content-Security-Policy", CSP);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
    c.header("X-Robots-Tag", "noindex");

    // Caddy appends the real client address as the last X-Forwarded-For entry.
    const xff = c.req.header("x-forwarded-for");
    const socketIp = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket
      ?.remoteAddress;
    c.set("ip", (cfg.trustProxy && xff ? xff.split(",").at(-1)!.trim() : socketIp) ?? "unknown");

    let deviceId = getCookie(c, DEVICE_COOKIE);
    if (!deviceId || !/^[\w-]{16,64}$/.test(deviceId)) {
      deviceId = randomBytes(16).toString("base64url");
      setCookie(c, DEVICE_COOKIE, deviceId, { ...cookieOpts, maxAge: YEAR_S });
    }
    c.set("deviceId", deviceId);
    c.set("lang", detectLang(getCookie(c, LANG_COOKIE), c.req.header("accept-language")));
    c.set("user", getSessionUser(deps, getCookie(c, SESSION_COOKIE)));
    await next();
  });

  // CSRF: every state-changing request must come from our own origin.
  app.use(async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") return next();
    const origin = c.req.header("origin");
    const referer = c.req.header("referer");
    const sameOrigin = origin ? origin === cfg.origin : referer ? referer.startsWith(cfg.origin + "/") : false;
    if (!sameOrigin) return c.text(errorText(c.get("lang"), "origin"), 403);
    return next();
  });

  const render = (c: Context<Env>, body: Parameters<typeof layout>[2], status: 200 | 400 | 429 = 200) =>
    c.html(layout(c.get("lang"), c.get("user"), body), status);

  app.get("/healthz", (c) => c.json({ ok: true, phase: phaseNow() }));

  app.get("/lang/:lang", (c) => {
    const lang = c.req.param("lang");
    if (lang === "fr" || lang === "en") setCookie(c, LANG_COOKIE, lang, { ...cookieOpts, maxAge: YEAR_S });
    const back = c.req.header("referer");
    return c.redirect(back?.startsWith(cfg.origin + "/") ? back.slice(cfg.origin.length) : "/");
  });

  app.get("/", (c) => {
    const lang = c.get("lang");
    const s = t(lang);
    const phase = phaseNow();
    if (phase === "landing") return render(c, landingPage(lang, formatDateTime(cfg.openAt, lang, cfg.tz)));
    const text = { open: s.phaseOpen, voting: s.phaseVoting, closed: s.phaseClosed, results: s.phaseResults }[phase];
    return render(c, homePage(lang, text, c.get("user"), phase === "open" || phase === "voting"));
  });

  app.get("/login", (c) => (c.get("user") ? c.redirect("/") : render(c, loginPage(c.get("lang")))));

  app.post("/login", async (c) => {
    const lang = c.get("lang");
    const form = await c.req.parseBody();
    const email = String(form.email ?? "");
    const res = await requestCode(deps, email, c.get("ip"), phaseNow() !== "landing");
    if (res.ok) return render(c, verifyPage(lang, res.email));
    const msg = errorText(lang, res.reason, res.reason === "cooldown" ? { s: res.retryAfterSec } : {});
    // A cooldown on resend should keep the user on the code screen.
    if (res.reason === "cooldown") return render(c, verifyPage(lang, email.trim().toLowerCase(), msg), 429);
    const status = res.reason === "email_limit" || res.reason === "ip_limit" ? 429 : 400;
    return render(c, loginPage(lang, { email, error: msg }), status);
  });

  app.post("/login/verify", async (c) => {
    const lang = c.get("lang");
    const form = await c.req.parseBody();
    const email = String(form.email ?? "");
    const res = verifyCode(deps, email, String(form.code ?? ""), {
      deviceId: c.get("deviceId"),
      ip: c.get("ip"),
      ua: c.req.header("user-agent") ?? "",
    });
    if (res.ok) {
      setCookie(c, SESSION_COOKIE, res.token, { ...cookieOpts, expires: res.expiresAt });
      return c.redirect("/");
    }
    if (res.reason === "wrong") {
      return render(c, verifyPage(lang, email, errorText(lang, "wrong", { n: res.attemptsLeft })), 400);
    }
    return render(c, loginPage(lang, { email, error: errorText(lang, res.reason) }), 400);
  });

  // ---- Entries --------------------------------------------------------------

  const photosDir = join(cfg.dataDir, "photos");
  const canEdit = (p: Phase) => p === "open";
  const canWithdraw = (p: Phase) => p === "open" || p === "voting";

  app.use("/me/*", async (c, next) => (c.get("user") ? next() : c.redirect("/login")));

  app.get("/me/entry", (c) => {
    const lang = c.get("lang");
    const phase = phaseNow();
    const s = t(lang);
    const notice = c.req.query("saved") ? s.saved : c.req.query("withdrawn") ? s.withdrawn : undefined;
    const entry = getEntryByOwner(db, c.get("user")!.email);
    return render(c, entryPage(lang, { entry, canEdit: canEdit(phase), canWithdraw: canWithdraw(phase), notice }));
  });

  app.post("/me/entry", bodyLimit({ maxSize: MAX_PHOTOS * MAX_PHOTO_BYTES + 1024 * 1024 }), async (c) => {
    const lang = c.get("lang");
    const owner = c.get("user")!.email;
    const phase = phaseNow();
    const entry = getEntryByOwner(db, owner);
    const form = await c.req.parseBody({ all: true });
    const values = { name: String(form.name ?? "").trim(), caption: String(form.caption ?? "").trim() };
    const fail = (key: ErrorKey) =>
      render(
        c,
        entryPage(lang, { entry, canEdit: canEdit(phase), canWithdraw: canWithdraw(phase), values, error: errorText(lang, key) }),
        400,
      );

    if (!canEdit(phase)) return fail("submissions_closed");
    const fieldError = validateFields(values.name, values.caption, form.consent === "1");
    if (fieldError) return fail(fieldError);

    const files = [form.photos].flat().filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > MAX_PHOTOS) return fail("too_many_photos");
    if (files.length === 0 && !entry) return fail("photos_required");

    // Process every photo before storing any, so a bad file leaves nothing behind.
    const processed = [];
    for (const f of files) {
      const res = await processPhoto(new Uint8Array(await f.arrayBuffer()));
      if (!res.ok) return fail(res.error);
      processed.push(res);
    }
    const stored = [];
    for (const p of processed) stored.push(await storePhoto(photosDir, p.full, p.thumb));

    const { replaced } = saveEntry(db, {
      owner,
      name: values.name,
      caption: values.caption,
      photos: stored.length ? stored : null,
      now: deps.now().getTime(),
    });
    await deletePhotoFiles(photosDir, replaced);
    return c.redirect("/me/entry?saved=1");
  });

  app.post("/me/entry/withdraw", async (c) => {
    const lang = c.get("lang");
    const phase = phaseNow();
    const entry = getEntryByOwner(db, c.get("user")!.email);
    if (!entry) return c.redirect("/me/entry");
    const form = await c.req.parseBody();
    const error = !canWithdraw(phase) ? "withdraw_closed" : form.confirm !== "1" ? "withdraw_confirm" : null;
    if (error) {
      return render(
        c,
        entryPage(lang, { entry, canEdit: canEdit(phase), canWithdraw: canWithdraw(phase), error: errorText(lang, error) }),
        400,
      );
    }
    await deletePhotoFiles(photosDir, deleteEntry(db, entry.id));
    return c.redirect("/me/entry?withdrawn=1");
  });

  app.get("/photos/:name", async (c) => {
    const name = c.req.param("name");
    if (!isPhotoName(name)) return c.notFound();
    const owner = photoOwner(db, name);
    const user = c.get("user");
    const allowed =
      owner &&
      ((owner.status === "approved" && phaseNow() !== "landing") || user?.email === owner.ownerEmail || user?.isAdmin);
    if (!allowed) return c.notFound();
    try {
      const buf = await readFile(join(photosDir, name));
      return c.body(new Uint8Array(buf), 200, { "Content-Type": "image/webp", "Cache-Control": "private, max-age=300" });
    } catch {
      return c.notFound();
    }
  });

  app.post("/logout", (c) => {
    deleteSession(db, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/");
  });

  return app;
}
