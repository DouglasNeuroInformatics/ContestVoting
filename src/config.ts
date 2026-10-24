import { fileURLToPath } from "node:url";
import { zonedTimeToUtc } from "./time.ts";

export type Config = {
  baseUrl: string;
  origin: string;
  secureCookies: boolean;
  tz: string;
  openAt: Date;
  submitCloseAt: Date;
  voteCloseAt: Date;
  sessionEndAt: Date;
  allowedDomains: string[];
  adminEmails: string[];
  /** Non-admins allowed to log in before the contest opens (deliverability testing). */
  previewEmails: string[];
  /** Minimum gap between "entries to review" emails to admins; 0 = never send them. */
  adminAlertMinutes: number;
  mailTransport: "smtp" | "console";
  smtp: { host: string; port: number; user: string; pass: string } | null;
  mailFrom: string;
  sessionSecret: string;
  /** Break-glass admin login without an emailed code; null = off. */
  devLoginSecret: string | null;
  dataDir: string;
  /** Where the organizers' landing page lives: index.html, landing.js, images/, fonts/. */
  siteDir: string;
  port: number;
  trustProxy: boolean;
};

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const errors: string[] = [];
  const req = (key: string) => {
    const v = env[key]?.trim();
    if (!v) errors.push(`${key} is required`);
    return v ?? "";
  };

  const tz = env.TZ_CONTEST?.trim() || "America/Montreal";
  const time = (key: string) => {
    const v = req(key);
    if (!v) return new Date(NaN);
    try {
      return zonedTimeToUtc(v, tz);
    } catch (e) {
      errors.push(`${key}: ${(e as Error).message}`);
      return new Date(NaN);
    }
  };

  const baseUrl = req("BASE_URL").replace(/\/+$/, "");
  const openAt = time("OPEN_AT");
  const submitCloseAt = time("SUBMIT_CLOSE_AT");
  const voteCloseAt = time("VOTE_CLOSE_AT");
  const sessionEndAt = time("SESSION_END_AT");
  if (!(openAt < submitCloseAt && submitCloseAt <= voteCloseAt && voteCloseAt < sessionEndAt)) {
    errors.push("need OPEN_AT < SUBMIT_CLOSE_AT <= VOTE_CLOSE_AT < SESSION_END_AT");
  }

  const allowedDomains = list(env.ALLOWED_DOMAINS);
  if (allowedDomains.length === 0) errors.push("ALLOWED_DOMAINS is required");
  const adminEmails = list(env.ADMIN_EMAILS);
  if (adminEmails.length === 0) errors.push("ADMIN_EMAILS is required");

  const adminAlertMinutes = Number(env.ADMIN_ALERT_MINUTES?.trim() || 30);
  if (!Number.isInteger(adminAlertMinutes) || adminAlertMinutes < 0) {
    errors.push("ADMIN_ALERT_MINUTES must be a whole number of minutes (0 = off)");
  }

  const mailTransport = env.MAIL_TRANSPORT === "console" ? "console" : "smtp";
  let smtp: Config["smtp"] = null;
  if (mailTransport === "smtp") {
    smtp = {
      host: req("SMTP_HOST"),
      port: Number(env.SMTP_PORT ?? 587),
      user: req("SMTP_USER"),
      pass: req("SMTP_PASS"),
    };
  }

  const sessionSecret = req("SESSION_SECRET");
  if (sessionSecret && sessionSecret.length < 32) errors.push("SESSION_SECRET must be at least 32 characters");
  const devLoginSecret = env.DEV_LOGIN_SECRET?.trim() || null;
  if (devLoginSecret && devLoginSecret.length < 32) errors.push("DEV_LOGIN_SECRET must be at least 32 characters");
  if (devLoginSecret && devLoginSecret === sessionSecret) errors.push("DEV_LOGIN_SECRET must differ from SESSION_SECRET");

  let origin = "";
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    errors.push("BASE_URL must be a URL");
  }

  if (errors.length) throw new Error(`Invalid configuration:\n  - ${errors.join("\n  - ")}`);

  return {
    baseUrl,
    origin,
    secureCookies: baseUrl.startsWith("https://"),
    tz,
    openAt,
    submitCloseAt,
    voteCloseAt,
    sessionEndAt,
    allowedDomains,
    adminEmails,
    previewEmails: list(env.PREVIEW_EMAILS),
    adminAlertMinutes,
    mailTransport,
    smtp,
    mailFrom: env.MAIL_FROM?.trim() || "Halloween DRC <noreply@halloween2026.douglasneuroinformatics.ca>",
    sessionSecret,
    devLoginSecret,
    dataDir: env.DATA_DIR?.trim() || "./data",
    siteDir: env.SITE_DIR?.trim() || fileURLToPath(new URL("..", import.meta.url)),
    port: Number(env.PORT ?? 3000),
    trustProxy: env.TRUST_PROXY === "1",
  };
}
