import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import type { Mail } from "../src/mail.ts";

export const TEST_ENV = {
  BASE_URL: "https://halloween.test",
  OPEN_AT: "2026-10-30T08:00",
  SUBMIT_CLOSE_AT: "2026-10-30T14:00",
  VOTE_CLOSE_AT: "2026-10-30T16:00",
  SESSION_END_AT: "2026-10-30T23:59",
  ALLOWED_DOMAINS: "mcgill.ca,mail.mcgill.ca",
  ADMIN_EMAILS: "admin@example.org",
  PREVIEW_EMAILS: "tester@mcgill.ca",
  MAIL_TRANSPORT: "console",
  SESSION_SECRET: "x".repeat(32),
  IP_SEND_LIMIT_PER_HOUR: "100",
};

export function setup(start = "2026-10-30T13:00:00Z") {
  const dataDir = mkdtempSync(join(tmpdir(), "h26-"));
  mkdirSync(join(dataDir, "photos"));
  const cfg = loadConfig({ ...TEST_ENV, DATA_DIR: dataDir });
  const db = openDb(":memory:");
  const sent: Mail[] = [];
  const clock = { now: new Date(start) };
  const deps = {
    db,
    cfg,
    mailer: { send: async (m: Mail) => void sent.push(m) },
    now: () => clock.now,
  };
  const app = createApp(deps);
  const advance = (ms: number) => (clock.now = new Date(clock.now.getTime() + ms));
  const lastCode = () => /(\d{6})/.exec(sent.at(-1)!.subject)![1];
  return { cfg, db, sent, clock, deps, app, advance, lastCode, photosDir: join(dataDir, "photos") };
}

export type Ctx = ReturnType<typeof setup>;

export const sessionCookie = (res: Response) => /sid=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];

/** Log in through the real OTP flow; returns the `cookie` header value. */
export async function login(ctx: Ctx, email: string): Promise<string> {
  await ctx.app.request(post("/login", { email }));
  const res = await ctx.app.request(post("/login/verify", { email, code: ctx.lastCode() }));
  const sid = sessionCookie(res);
  if (!sid) throw new Error(`login failed for ${email}: ${res.status}`);
  ctx.advance(61_000); // clear the resend cooldown for the next login
  return `sid=${sid}`;
}

export const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(`https://halloween.test${path}`, {
    method: "POST",
    headers: { origin: "https://halloween.test", "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields),
  });
