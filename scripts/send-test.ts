// Deliverability test (T2): send a sample login email to real inboxes via the configured SMTP.
// Usage: node --env-file=.env scripts/send-test.ts alice@mcgill.ca bob@ssss.gouv.qc.ca ...
// Each recipient reports: arrival time vs the "sent at" line, and inbox vs junk.
import { loadConfig } from "../src/config.ts";
import { codeEmail, createMailer } from "../src/mail.ts";

const recipients = process.argv.slice(2);
if (recipients.length === 0) {
  console.error("usage: node --env-file=.env scripts/send-test.ts <email> [email...]");
  process.exit(1);
}

const cfg = loadConfig();
const mailer = createMailer(cfg);

for (const to of recipients) {
  const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  const mail = codeEmail(to, code, cfg.baseUrl);
  const sentAt = new Date().toISOString();
  mail.text += `\n\n[TEST] sent at ${sentAt}. Please reply with the time it arrived and whether it was in Junk.`;
  try {
    await mailer.send(mail);
    console.log(`ok    ${sentAt}  ${to}  code=${code}`);
  } catch (e) {
    console.log(`FAIL  ${sentAt}  ${to}  ${(e as Error).message}`);
  }
}
