import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { AdminEntry, AuditVote, LogRow, Ranked, Results } from "./admin.ts";
import { fill, ta, type AdminError, type AdminNotice } from "./adminI18n.ts";
import type { Lang } from "./i18n.ts";
import { PHASES, type Phase } from "./phase.ts";

type Body = HtmlEscapedString | Promise<HtmlEscapedString>;
type Section = "queue" | "entries" | "votes" | "settings";
export type Flash = { notice?: AdminNotice; error?: AdminError };

function frame(lang: Lang, current: Section, flash: Flash, body: Body): Body {
  const a = ta(lang);
  const link = (s: Section, href: string) =>
    html`<a href="${href}" class="${s === current ? "current" : ""}">${a.nav[s]}</a>`;
  return html`<nav class="admin">
  ${link("queue", "/admin")} ${link("entries", "/admin/entries")} ${link("votes", "/admin/votes")} ${link("settings", "/admin/settings")}
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
  <p class="help">${e.ownerEmail} · ${fmt(e.updatedAt)}</p>
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
  <p class="help">${e.ownerEmail}${e.rejectReason ? html` · ${e.rejectReason}` : ""}</p>
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

function rankingTable(lang: Lang, ranked: Ranked[]): Body {
  const a = ta(lang);
  return html`<table>
  <tr><th>#</th><th>${a.entry}</th><th>${a.votes}</th></tr>
  ${ranked.map(
    (r, i) => html`<tr><td>${i + 1}</td><td>${r.name}${r.tied ? html` <span class="flag">${a.tied}</span>` : ""}</td><td>${r.votes}</td></tr>`,
  )}
</table>`;
}

export function votesPage(lang: Lang, ranked: Ranked[], votes: AuditVote[], flash: Flash, fmt: (ms: number) => string): Body {
  const a = ta(lang);
  return frame(
    lang,
    "votes",
    flash,
    html`<div class="panel"><h2>${a.ranking}</h2>${rankingTable(lang, ranked)}</div>
<div class="panel">
  <p class="help">${a.flagsHelp}</p>
  ${votes.length === 0
    ? html`<p>${a.noVotes}</p>`
    : html`<table>
  <tr><th>${a.voter}</th><th>${a.entry}</th><th>${a.time}</th><th>${a.flags}</th><th></th></tr>
  ${votes.map(
    (v) => html`<tr>
    <td>${v.voterEmail}</td><td>${v.entryName}</td><td>${fmt(v.at)}</td>
    <td>${v.flags.sharedDevice ? html`<span class="flag">${fill(a.flagDevice, { n: v.flags.sharedDevice })}</span> ` : ""}${v.flags.ipBurst
      ? html`<span class="flag">${fill(a.flagIp, { n: v.flags.ipBurst })}</span>`
      : ""}</td>
    <td><form method="post" action="/admin/votes/void"><input type="hidden" name="voter" value="${v.voterEmail}"><button class="small danger" type="submit">${a.voidVote}</button></form></td>
  </tr>`,
  )}
</table>`}
</div>`,
  );
}

export function settingsPage(
  lang: Lang,
  d: {
    phase: Phase;
    override: string | null;
    baseDomains: string[];
    extraDomains: string;
    ranked: Ranked[];
    results: Results | null;
    published: boolean;
    canPublish: boolean;
    log: LogRow[];
  },
  flash: Flash,
  fmt: (ms: number) => string,
): Body {
  const a = ta(lang);
  const top = d.ranked.slice(0, 3);
  const select = (place: number) => html`<label for="p${place}">${fill(a.place, { n: place })}</label>
<select id="p${place}" name="place${place}">
  <option value=""></option>
  ${d.ranked.map(
    (r) => html`<option value="${r.id}" ${top[place - 1]?.id === r.id ? "selected" : ""}>${r.name} (${r.votes})</option>`,
  )}
</select>`;
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
  ${rankingTable(lang, d.ranked)}
  ${d.published && d.results
    ? html`<p>${a.published}</p><ol>${d.results.map((r) => html`<li>${r.name} (${r.votes})</li>`)}</ol>
      <form method="post" action="/admin/results/unpublish"><button class="danger" type="submit">${a.unpublish}</button></form>`
    : d.canPublish && d.ranked.length > 0
      ? html`<form method="post" action="/admin/results/publish">
      <p class="help">${a.publishHelp}</p>
      ${select(1)} ${select(2)} ${select(3)}
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
