# Build tasks

Ordered by the critical path. The deliverability test gates everything else.

## Now (10-20 / 10-21) — external setup (you)

- [ ] Scaleway account; Transactional Email in `fr-par`; add domain `mail.douglasneuroinformatics.ca`; generate SMTP credentials.
- [ ] DNS (whoever owns it): `halloween2026` A/AAAA → DNP server; Scaleway SPF / DKIM / DMARC / MX records for `mail.` subdomain.
- [ ] Confirm Docker + ports 80/443 on the DNP server; add a Caddy site block.
- [ ] Create the public repo in the DNP org (MIT).
- [ ] Ask the DRC organizers: FR + EN rules text, admin emails, DRC logo (due 10-24).

## T1 — Skeleton + OTP mail (by 10-22)

- [x] Hono + TS + node:sqlite project, Dockerfile, `.env.example`, schema migration.
- [x] Config loader (times, domains, admins, SMTP) with validation at startup.
- [x] Phase function (clock + override) with unit tests on boundaries.
- [x] Login: email form → domain check → code generate/hash/store → send via nodemailer → verify form → session cookie.
- [x] Rate limits + attempt counter + cooldown.
- [x] `/healthz`, compose file, Caddy block, `scripts/send-test.ts`.
- [ ] Deploy behind Caddy (needs server + DNS + Scaleway creds).

## T2 — Deliverability gate (by 10-23)

- [ ] Send codes to real `@mcgill.ca`, `@mail.mcgill.ca`, `@douglas.mcgill.ca`, `@ssss.gouv.qc.ca` inboxes.
- [ ] Record time-to-inbox and inbox vs junk; check DKIM/SPF/DMARC pass in the headers.
- [ ] Junked or > 2 min → ask Douglas IT to allowlist, or decide on the fallback (unverified email + audit).

## T3 — Entries + photos (by 10-24)

- [x] Submit form (name, caption, 1–3 photos, consent), one per email.
- [x] sharp pipeline: decode-validate, rotate, 1600 px WebP + 600 px thumb, strip metadata. Prebuilt sharp has no HEIC decoder → rely on iOS converting via `accept`; HEIC detected and rejected with instructions.
- [x] My-entry status page: pending / approved / rejected + reason; edit → pending; withdraw → delete entry, photos, votes.
- [x] Photo serving with access rules.
- [ ] Real-phone check at the dry run: iPhone upload arrives as JPEG.

## T4 — Admin (by 10-25)

- [x] Admin allowlist + guard (anon → login, non-admin → 404).
- [x] Queue: approve / reject (+ reason → bilingual email to submitter). Rejecting an approved entry voids its votes.
- [x] Entries list + remove (confirm checkbox; deletes photos + votes).
- [x] Votes: live ranking with ties marked, voter list with shared-device / IP-burst flags, void a vote.
- [x] Settings: phase override, extra domains, publish results (admins pick order = tie-break; counts snapshotted), unpublish.
- [x] `admin_log` on every action, shown on Settings; batched alert mail (≤ 1 per 10 min, new pending only).
- [ ] Bilingual admin UI done; real-phone check of the queue at the dry run.

## T5 — Public pages (by 10-26)

- [x] Landing: rules from `content/rules.{fr,en}.md` (placeholder text until the organizers send theirs), opening date. No countdown (would need JS; the date is enough).
- [ ] Landing: contact for photo removal requests (needs an address from the organizers).
- [x] Gallery: approved entries, per-viewer seeded shuffle, tap a photo to open it full size, vote / change vote.
- [x] Closed + results views (results banner with snapshotted counts).
- [x] i18n: Accept-Language → FR fallback; toggle cookie; all strings + emails.
- [x] Theme + "Brought to you by the DNP" footer text.
- [ ] DNP logo in the footer; DRC logo in the header if supplied.
- [ ] Organizers' extra entry fields (name / research group / PI …) once they send the list.
- [ ] Test on iPhone Safari + Android Chrome.
- [x] Security headers, CSRF origin check, noindex.

## T6 — Dry run (10-27, go/no-go)

- [ ] Seed with admins + ~10 test voters on real phones, scanning the actual QR code.
- [ ] Full cycle: landing → open → submit → approve → vote → change vote → close → publish.
- [ ] Time-travel the phases via the override.
- [ ] Prepare the Google Form fallback anyway.
- [ ] Wipe the DB + photos after the dry run.

## T7 — Contest day (10-30)

- [ ] Verify the phase override is cleared; clock-driven phases correct.
- [ ] On call 08:00–16:00; watch logs and the admin queue.
- [ ] After 16:00: admins resolve ties, publish results.

## T8 — After (by 11-29)

- [ ] Export winners' photos if the DRC wants them.
- [ ] Purge DB + photos; stop the container; remove DNS records.
