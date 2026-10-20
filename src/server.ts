import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { sendAdminAlerts } from "./admin.ts";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { createMailer } from "./mail.ts";

const cfg = loadConfig();
mkdirSync(join(cfg.dataDir, "photos"), { recursive: true });
const db = openDb(join(cfg.dataDir, "app.db"));
const deps = { db, cfg, mailer: createMailer(cfg), now: () => new Date() };
const app = createApp(deps);

const server = serve({ fetch: app.fetch, port: cfg.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`halloween2026 listening on :${info.port} (${cfg.baseUrl}, mail=${cfg.mailTransport})`);
  console.log(`opens ${cfg.openAt.toISOString()}, submissions close ${cfg.submitCloseAt.toISOString()}, voting closes ${cfg.voteCloseAt.toISOString()}`);
});

const alerts = setInterval(() => {
  sendAdminAlerts(deps).catch((e) => console.error("[admin] alert run failed:", e));
}, 60_000);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    clearInterval(alerts);
    server.close();
    db.close();
    process.exit(0);
  });
}
