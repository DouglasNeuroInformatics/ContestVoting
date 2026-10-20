import nodemailer from "nodemailer";
import type { Config } from "./config.ts";

export type Mail = { to: string; subject: string; text: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export function createMailer(cfg: Config): Mailer {
  if (cfg.mailTransport === "console" || !cfg.smtp) {
    return {
      async send(mail) {
        console.log(`[mail] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}\n[/mail]`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.port === 465,
    auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: cfg.mailFrom, ...mail });
    },
  };
}

/** Bilingual on purpose: we don't know the recipient's language before they log in. */
export function codeEmail(to: string, code: string, baseUrl: string): Mail {
  const host = new URL(baseUrl).host;
  return {
    to,
    subject: `${code} — code Halloween DRC / DRC Halloween code`,
    text: [
      `Votre code de connexion pour ${host} : ${code}`,
      `Il expire dans 10 minutes. Si vous n'avez rien demandé, ignorez ce courriel.`,
      ``,
      `Your login code for ${host}: ${code}`,
      `It expires in 10 minutes. If you didn't ask for it, ignore this email.`,
      ``,
      `— Concours de costumes d'Halloween du CRD / DRC Halloween costume contest`,
      `Propulsé par / Brought to you by the DNP`,
    ].join("\n"),
  };
}
