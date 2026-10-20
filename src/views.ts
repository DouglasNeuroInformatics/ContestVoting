import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { User } from "./auth.ts";
import type { Entry } from "./entries.ts";
import { t, type Lang } from "./i18n.ts";

type Body = HtmlEscapedString | Promise<HtmlEscapedString>;

const CSS = `
:root { --bg:#14100c; --panel:#221a12; --text:#f5ece0; --muted:#bfae99; --accent:#ff7a1a; --accent-ink:#1a0f05; --danger:#ff6b6b; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
.wrap { max-width:640px; margin:0 auto; padding:16px; }
header { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
header a { color:var(--muted); }
h1 { font-size:1.6rem; line-height:1.2; margin:24px 0 8px; }
.panel { background:var(--panel); border-radius:12px; padding:20px; margin:16px 0; }
label { display:block; font-weight:600; margin-bottom:6px; }
input { width:100%; font-size:1.1rem; padding:12px; border-radius:8px; border:1px solid #5a4632; background:#0e0b08; color:var(--text); }
input.code { letter-spacing:.4em; text-align:center; font-size:1.6rem; }
button { width:100%; margin-top:12px; padding:14px; font-size:1.05rem; font-weight:700; border:0; border-radius:8px; background:var(--accent); color:var(--accent-ink); cursor:pointer; }
button.link { background:none; color:var(--muted); text-decoration:underline; font-weight:400; padding:8px; width:auto; }
.help { color:var(--muted); font-size:.9rem; margin:6px 0 0; }
.error { color:var(--danger); font-weight:600; }
h2 { font-size:1.2rem; margin:12px 0 4px; }
label { margin-top:14px; }
textarea { width:100%; font:inherit; padding:12px; border-radius:8px; border:1px solid #5a4632; background:#0e0b08; color:var(--text); }
input[type=file] { font-size:1rem; padding:10px; }
label.check { display:flex; gap:10px; align-items:flex-start; font-weight:400; }
label.check input { width:auto; margin-top:4px; }
button.danger { background:transparent; color:var(--danger); border:1px solid var(--danger); }
.notice { background:#1f3a1f; color:#c8f0c8; padding:12px; border-radius:8px; }
.badge { display:inline-block; padding:4px 10px; border-radius:999px; font-weight:700; font-size:.9rem; }
.badge.pending { background:#4a3b12; color:#ffd77a; }
.badge.approved { background:#1f3a1f; color:#9be29b; }
.badge.rejected { background:#4a1717; color:#ff9e9e; }
.thumbs { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:12px; }
.thumbs img { width:100%; aspect-ratio:1; object-fit:cover; border-radius:8px; display:block; }
nav.admin { display:flex; gap:16px; flex-wrap:wrap; margin:16px 0; }
nav.admin a { color:var(--muted); }
nav.admin a.current { color:var(--accent); font-weight:700; }
nav.admin + * { margin-top:0; }
select { width:100%; font-size:1rem; padding:10px; border-radius:8px; border:1px solid #5a4632; background:#0e0b08; color:var(--text); }
table { width:100%; border-collapse:collapse; font-size:.9rem; display:block; overflow-x:auto; }
td, th { text-align:left; padding:6px 8px; border-bottom:1px solid #3a2d20; vertical-align:top; }
.flag { display:inline-block; background:#4a3b12; color:#ffd77a; border-radius:6px; padding:0 6px; font-size:.8rem; }
button.small { width:auto; margin:0; padding:4px 10px; font-size:.85rem; }
footer { color:var(--muted); font-size:.85rem; text-align:center; margin:40px 0 16px; }
`;

export function layout(lang: Lang, user: User | null, body: Body): Body {
  const s = t(lang);
  const other = lang === "fr" ? "en" : "fr";
  return html`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${s.title}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header>
  <span><a href="/lang/${other}">${s.switchLang}</a>${user?.isAdmin ? html` · <a href="/admin">Admin</a>` : ""}</span>
  ${user
    ? html`<form method="post" action="/logout" style="margin:0">
        <span class="help">${s.loggedInAs} ${user.email}</span>
        <button class="link" type="submit">${s.logout}</button>
      </form>`
    : ""}
</header>
${body}
<footer>🎃 ${s.poweredBy}</footer>
</div>
</body>
</html>`;
}

export function landingPage(lang: Lang, opensAt: string): Body {
  const s = t(lang);
  return html`<h1>🎃 ${s.title}</h1>
<div class="panel">
  <p>${s.landingLead} <strong>${opensAt}</strong>.</p>
  <p class="help">${s.landingSoon}</p>
</div>`;
}

export function homePage(lang: Lang, phaseText: string, user: User | null, showEntryLink: boolean): Body {
  const s = t(lang);
  return html`<h1>🎃 ${s.title}</h1>
<div class="panel">
  <p><strong>${phaseText}</strong></p>
  <p class="help">${s.comingSoon}</p>
  ${user
    ? showEntryLink ? html`<p><a href="/me/entry">${s.myEntry}</a></p>` : ""
    : html`<p><a href="/login">${s.login}</a></p>`}
</div>`;
}

export type EntryFormValues = { name: string; caption: string };

export function entryPage(
  lang: Lang,
  opts: {
    entry: Entry | null;
    canEdit: boolean;
    canWithdraw: boolean;
    values?: EntryFormValues;
    error?: string;
    notice?: string;
  },
): Body {
  const s = t(lang);
  const { entry } = opts;
  const values = opts.values ?? { name: entry?.name ?? "", caption: entry?.caption ?? "" };
  return html`<h1>${s.myEntry}</h1>
${opts.notice ? html`<p class="notice" role="status">${opts.notice}</p>` : ""}
${entry
    ? html`<div class="panel">
  <p><span class="badge ${entry.status}">${s.status[entry.status]}</span></p>
  ${entry.status === "rejected"
    ? html`${entry.rejectReason ? html`<p>${s.rejectReason} ${entry.rejectReason}</p>` : ""}<p class="help">${s.rejectedHelp}</p>`
    : ""}
  <h2>${entry.name}</h2>
  ${entry.caption ? html`<p>${entry.caption}</p>` : ""}
  <div class="thumbs">${entry.photos.map((p) => html`<a href="/photos/${p.file}"><img src="/photos/${p.thumb}" alt=""></a>`)}</div>
</div>`
    : ""}
${opts.canEdit
    ? html`<form class="panel" method="post" action="/me/entry" enctype="multipart/form-data">
  ${entry ? html`<p class="help">${s.editNote}</p>` : ""}
  <label for="name">${s.nameLabel}</label>
  <input id="name" name="name" maxlength="60" required value="${values.name}">
  <label for="caption">${s.captionLabel}</label>
  <textarea id="caption" name="caption" maxlength="200" rows="3">${values.caption}</textarea>
  <label for="photos">${s.photosLabel}</label>
  <input id="photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple ${entry ? "" : "required"}>
  <p class="help">${entry ? s.photosHelpEdit : s.photosHelpNew}</p>
  <label class="check"><input type="checkbox" name="consent" value="1" required> ${s.consentLabel}</label>
  ${opts.error ? html`<p class="error" role="alert">${opts.error}</p>` : ""}
  <button type="submit">${entry ? s.saveChanges : s.submit}</button>
</form>`
    : html`${opts.error ? html`<p class="error" role="alert">${opts.error}</p>` : ""}${entry ? "" : html`<div class="panel"><p>${s.submissionsClosed}</p></div>`}`}
${entry && opts.canWithdraw
    ? html`<form class="panel" method="post" action="/me/entry/withdraw">
  <h2>${s.withdrawTitle}</h2>
  <label class="check"><input type="checkbox" name="confirm" value="1" required> ${s.withdrawConfirm}</label>
  <button class="danger" type="submit">${s.withdraw}</button>
</form>`
    : ""}`;
}

export function loginPage(lang: Lang, opts: { email?: string; error?: string } = {}): Body {
  const s = t(lang);
  return html`<h1>${s.login}</h1>
<form class="panel" method="post" action="/login">
  <label for="email">${s.emailLabel}</label>
  <input id="email" name="email" type="email" inputmode="email" autocomplete="email" required value="${opts.email ?? ""}">
  <p class="help">${s.emailHelp}</p>
  ${opts.error ? html`<p class="error" role="alert">${opts.error}</p>` : ""}
  <button type="submit">${s.sendCode}</button>
</form>`;
}

export function verifyPage(lang: Lang, email: string, error?: string): Body {
  const s = t(lang);
  return html`<h1>${s.login}</h1>
<form class="panel" method="post" action="/login/verify">
  <p>${s.codeSentTo} <strong>${email}</strong></p>
  <input type="hidden" name="email" value="${email}">
  <label for="code">${s.codeLabel}</label>
  <input id="code" class="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" required autofocus>
  <p class="help">${s.codeHelp}</p>
  ${error ? html`<p class="error" role="alert">${error}</p>` : ""}
  <button type="submit">${s.verify}</button>
</form>
<form method="post" action="/login" style="text-align:center">
  <input type="hidden" name="email" value="${email}">
  <button class="link" type="submit">${s.resend}</button>
  <a class="help" href="/login">${s.otherEmail}</a>
</form>`;
}
