import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { AdminEntry, AuditVote, LogRow, Ranked, Rankings, Results } from "./admin.ts";
import { fill, ta, type AdminError, type AdminNotice } from "./adminI18n.ts";
import { CATEGORIES, type Category } from "./entries.ts";
import { t, type Lang } from "./i18n.ts";
import { PHASES, type Phase } from "./phase.ts";

type Body = HtmlEscapedString | Promise<HtmlEscapedString>;
type Section = "queue" | "entries" | "votes" | "code" | "settings";
export type Flash = { notice?: AdminNotice; error?: AdminError };

function frame(lang: Lang, current: Section, flash: Flash, body: Body): Body {
  const a = ta(lang);
  const link = (s: Section, href: string) =>
    html`<a href="${href}" class="${s === current ? "current" : ""}">${a.nav[s]}</a>`;
  return html`<nav class="admin">
  ${link("queue", "/admin")} ${link("entries", "/admin/entries")} ${link("votes", "/admin/votes")} ${link("code", "/admin/code")} ${link("settings", "/admin/settings")}
</nav>
${flash.notice ? html`<p class="notice" role="status">${a.notice[flash.notice]}</p>` : ""}
${flash.error ? html`<p class="error" role="alert">${a.err[flash.error]}</p>` : ""}
${body}`;
}

const thumbs = (files: string[], thumbs: string[]) =>
  html`<div class="thumbs">${thumbs.map((t, i) => html`<a href="/photos/${files[i]}"><img src="/photos/${t}" alt=""></a>`)}</div>`;

export function queuePage(lang: Lang, entries: AdminEntry[], flash: Flash, fmt: (ms: number) => string): Body {
  const a = ta(lang);
  return frame(
    lang,
    "queue",
    flash,
    entries.length === 0
      ? html`<div class="panel"><p>${a.queueEmpty}</p></div>`
      : html`${entries.map(
          (e) => html`<div class="panel">
  <h2>${e.name}</h2>
  ${e.caption ? html`<p>${e.caption}</p>` : ""}
  <p class="help">${t(lang).categories[e.category]} · ${e.ownerEmail} · ${fmt(e.updatedAt)}</p>
  ${thumbs(e.files, e.thumbs)}
  <form method="post" action="/admin/entries/${e.id}/approve"><button type="submit">${a.approve}</button></form>
  <form method="post" action="/admin/entries/${e.id}/reject">
    <label for="reason-${e.id}">${a.reasonLabel}</label>
    <input id="reason-${e.id}" name="reason" maxlength="200">
    <button class="danger" type="submit">${a.reject}</button>
  </form>
</div>`,
        )}`,
  );
}

export function entriesPage(lang: Lang, entries: AdminEntry[], flash: Flash): Body {
  const a = ta(lang);
  return frame(
    lang,
    "entries",
    flash,
    entries.length === 0
      ? html`<div class="panel"><p>${a.noEntries}</p></div>`
      : html`${entries.map(
          (e) => html`<div class="panel">
  <p><span class="badge ${e.status}">${a.status[e.status]}</span> · ${a.votes}: ${e.votes}</p>
  <h2>${e.name}</h2>
  <p class="help">${t(lang).categories[e.category]} · ${e.ownerEmail}${e.rejectReason ? html` · ${e.rejectReason}` : ""}</p>
  ${thumbs(e.files, e.thumbs)}
  ${e.status !== "approved"
    ? html`<form method="post" action="/admin/entries/${e.id}/approve"><button type="submit">${a.approve}</button></form>`
    : ""}
  <form method="post" action="/admin/entries/${e.id}/remove">
    <label class="check"><input type="checkbox" name="confirm" value="1" required> ${a.removeConfirm}</label>
    <button class="danger" type="submit">${a.remove}</button>
  </form>
</div>`,
        )}`,
  );
}

function rankingTable(lang: Lang, category: Category, ranked: Ranked[]): Body {
  const a = ta(lang);
  return html`<h3>${t(lang).categories[category]}</h3>
<table>
  <tr><th>#</th><th>${a.entry}</th><th>${a.votes}</th></tr>
  ${ranked.map(
    (r) => html`<tr><td>${r.rank}</td><td>${r.name}${r.tied ? html` <span class="flag">${a.tied}</span>` : ""}</td><td>${r.votes}</td></tr>`,
  )}
</table>`;
}

const rankingTables = (lang: Lang, ranked: Rankings) => CATEGORIES.map((c) => rankingTable(lang, c, ranked[c]));

export function votesPage(lang: Lang, ranked: Rankings, votes: AuditVote[], flash: Flash, fmt: (ms: number) => string): Body {
  const a = ta(lang);
  return frame(
    lang,
    "votes",
    flash,
    html`<div class="panel"><h2>${a.ranking}</h2>${rankingTables(lang, ranked)}</div>
<div class="panel">
  <p class="help">${a.flagsHelp}</p>
  ${votes.length === 0
    ? html`<p>${a.noVotes}</p>`
    : html`<table>
  <tr><th>${a.voter}</th><th>${a.category}</th><th>${a.entry}</th><th>${a.time}</th><th>${a.flags}</th><th></th></tr>
  ${votes.map(
    (v) => html`<tr>
    <td>${v.voterEmail}</td><td>${t(lang).categories[v.category]}</td><td>${v.entryName}</td><td>${fmt(v.at)}</td>
    <td>${v.flags.sharedDevice ? html`<span class="flag">${fill(a.flagDevice, { n: v.flags.sharedDevice })}</span> ` : ""}${v.flags.ipBurst
      ? html`<span class="flag">${fill(a.flagIp, { n: v.flags.ipBurst })}</span>`
      : ""}</td>
    <td><form method="post" action="/admin/votes/void"><input type="hidden" name="voter" value="${v.voterEmail}"><input type="hidden" name="category" value="${v.category}"><button class="small danger" type="submit">${a.voidVote}</button></form></td>
  </tr>`,
  )}
</table>`}
</div>`,
  );
}

export function codePage(
  lang: Lang,
  flash: Flash,
  issued?: { email: string; code: string; expires: string },
): Body {
  const a = ta(lang);
  return frame(
    lang,
    "code",
    flash,
    html`${issued
      ? html`<div class="panel winners">
  <h2>${fill(a.codeFor, { email: issued.email })}</h2>
  <p class="code-big">${issued.code.slice(0, 3)} ${issued.code.slice(3)}</p>
  <p>${fill(a.codeExpires, { time: issued.expires })}</p>
  <p class="help">${a.codeSteps}</p>
</div>`
      : ""}
<form class="panel" method="post" action="/admin/code">
  <p class="help">${a.codeIntro}</p>
  <label for="email">${a.codeEmail}</label>
  <input id="email" name="email" type="email" inputmode="email" autocomplete="off" required>
  <button type="submit">${a.codeIssue}</button>
</form>`,
  );
}

export function settingsPage(
  lang: Lang,
  d: {
    phase: Phase;
    override: string | null;
    baseDomains: string[];
    extraDomains: string;
    ranked: Rankings;
    results: Results | null;
    published: boolean;
    canPublish: boolean;
    log: LogRow[];
  },
  flash: Flash,
  fmt: (ms: number) => string,
): Body {
  const a = ta(lang);
  const select = (c: Category, place: number) => html`<label for="${c}${place}">${fill(a.place, { n: place })}</label>
<select id="${c}${place}" name="${c}${place}">
  <option value=""></option>
  ${d.ranked[c].map(
    (r) => html`<option value="${r.id}" ${d.ranked[c][place - 1]?.id === r.id ? "selected" : ""}>${r.name} (${r.votes})</option>`,
  )}
</select>`;
  const anyRanked = CATEGORIES.some((c) => d.ranked[c].length > 0);
  return frame(
    lang,
    "settings",
    flash,
    html`<form class="panel" method="post" action="/admin/settings/phase">
  <p>${a.phase}: <strong>${a.phases[d.phase]}</strong></p>
  <label for="override">${a.override}</label>
  <select id="override" name="override">
    <option value="">${a.auto}</option>
    ${PHASES.map((p) => html`<option value="${p}" ${d.override === p ? "selected" : ""}>${a.phases[p]}</option>`)}
  </select>
  <button type="submit">${a.save}</button>
</form>
<form class="panel" method="post" action="/admin/settings/domains">
  <label for="domains">${a.extraDomains}</label>
  <input id="domains" name="domains" value="${d.extraDomains}">
  <p class="help">${fill(a.extraDomainsHelp, { base: d.baseDomains.join(", ") })}</p>
  <button type="submit">${a.save}</button>
</form>
<div class="panel">
  <h2>${a.ranking}</h2>
  ${rankingTables(lang, d.ranked)}
  ${d.published && d.results
    ? html`<p>${a.published}</p>${CATEGORIES.map(
        (c) => html`<h3>${t(lang).categories[c]}</h3><ol>${d.results!.filter((r) => r.category === c).map((r) => html`<li>${r.name} (${r.votes})</li>`)}</ol>`,
      )}
      <form method="post" action="/admin/results/unpublish"><button class="danger" type="submit">${a.unpublish}</button></form>`
    : d.canPublish && anyRanked
      ? html`<form method="post" action="/admin/results/publish">
      <p class="help">${a.publishHelp}</p>
      ${CATEGORIES.map((c) => html`<h3>${t(lang).categories[c]}</h3>${select(c, 1)} ${select(c, 2)} ${select(c, 3)}`)}
      <button type="submit">${a.publish}</button>
    </form>`
      : ""}
</div>
<div class="panel">
  <h2>${a.log}</h2>
  <table>
  ${d.log.map(
    (l) => html`<tr><td>${fmt(l.at)}</td><td>${l.admin_email}</td><td>${l.action}</td><td>${[l.target, l.detail].filter(Boolean).join(" · ")}</td></tr>`,
  )}
  </table>
</div>`,
  );
}

/** Not in the admin frame: whoever sees this isn't logged in yet. */
export function devLoginPage(lang: Lang, error?: boolean): Body {
  const a = ta(lang);
  return html`<h1>${a.devLoginTitle}</h1>
<form class="panel" method="post" action="/dev/login">
  <p class="help">${a.devLoginIntro}</p>
  <label for="email">${t(lang).emailLabel}</label>
  <input id="email" name="email" type="email" inputmode="email" autocomplete="username" required>
  <label for="secret">${a.devLoginSecret}</label>
  <input id="secret" name="secret" type="password" autocomplete="current-password" required>
  ${error ? html`<p class="error" role="alert">${a.devLoginRefused}</p>` : ""}
  <button type="submit">${t(lang).login}</button>
</form>`;
}
