# DRC Halloween 2026 — Costume Contest Voting

Spec, settled 2026-10-20. Brought to you by the DNP.

- URL: `https://halloween2026.douglasneuroinformatics.ca/`
- Contest: Friday 2026-10-30, times in `America/Montreal`
- Scale: < 100 voters, < 100 entries
- Replaces woobox (cost, US-hosted)

## 1. Phases

One URL (the poster QR code) serves every phase. The phase is computed from the clock, and an admin override in `settings` wins over the clock.

| Phase | When | Public sees |
|---|---|---|
| `landing` | until 10-30 08:00 | Rules, how it works, opening date. No login. |
| `open` | 08:00 – 14:00 | Gallery + vote; submit / edit / withdraw own entry |
| `voting` | 14:00 – 16:00 | Gallery + vote; submissions closed |
| `closed` | 16:00 → results published | Gallery, "voting closed, results soon" |
| `results` | admin clicks Publish | Top-3 banner with counts, gallery |

Times live in config (`.env`), not code.

## 2. Identity & login (email OTP)

- Login = institutional email + 6-digit code emailed via Scaleway TEM (SMTP).
- Allowed domains: `mcgill.ca`, `mail.mcgill.ca`, `douglas.mcgill.ca`, `ssss.gouv.qc.ca`. Admins can add more domains at runtime. Any other domain → "use your institutional email".
- Normalise email: trim, lowercase. Compare the exact domain (no subdomain wildcard unless listed).
- Code: 6 digits, random from the CSPRNG, stored hashed, valid 10 min, max 5 wrong attempts (then invalidated), resend cooldown 60 s, max 5 sends per email per hour, and an IP cap (soft: log + flag, since DRC wifi is a shared NAT).
- Code only, no magic links: M365 Safe Links pre-clicks links.
- Session: random token in an `HttpOnly; Secure; SameSite=Lax` cookie, hashed in the DB, expires 10-30 23:59.
- Login only opens at the start of `open`. Admins can log in during any phase.
- The email says which code is for which site, in FR + EN, so it isn't mistaken for phishing.

## 3. Voting

- Only during `open` and `voting`, and only for `approved` entries.
- One vote per email; a later vote replaces the earlier one (upsert). Self-votes are allowed.
- Tallies are hidden from the public until `results`. Admins see live counts.
- Each vote records ip + user-agent for the admin audit only.
- Entry withdrawn/removed → its votes are deleted. The voter's "my vote" shows none, and they can vote again.

## 4. Entries

- One entry per email (team captains submit for teams).
- Fields: costume/team name (≤ 60 chars), caption (≤ 200 chars), 1–3 photos, required consent checkbox (text in §8).
- Status: `pending` → `approved` | `rejected` (with an optional reason). Any edit → back to `pending`.
- Withdraw = hard delete of the entry, its photos and its votes.
- Rejected → email to the submitter with the reason (FR + EN), and the status page shows it. They can edit and resubmit.
- Public view: name, photos, caption. The submitter email is never public.
- Submissions are allowed only in `open`. Withdraw is allowed until `closed`.

## 5. Photos

- Upload `accept="image/jpeg,image/png,image/webp"`. On iOS this makes Safari convert HEIC → JPEG client-side. Prebuilt sharp cannot decode HEIC (checked: libheif built with AVIF only), so a HEIC upload is detected and rejected with instructions.
- ≤ 15 MB per file, ≤ 3 files. Validate by decoding with sharp, not by MIME/extension.
- Process: auto-rotate from EXIF → resize to fit 1600 px → WebP q≈80 → strip all metadata → random filename. The original is discarded.
- Also make a 600 px thumbnail for the gallery.
- Served only if the entry is `approved`, or to its owner/admins (pending previews).

## 6. Gallery

- Approved entries in a shuffled order, seeded per session (or per anon cookie), so the order is stable for a viewer.
- One scrolling page, no pagination. A tap opens the photos large.
- The vote button shows "your vote" on the current choice.

## 7. Admin

- Admins = allowlist of emails in `.env` (4+). Same OTP login.
- Mobile-first pages:
  - **Queue**: pending entries with photos, Approve / Reject (+ reason).
  - **Entries**: all, with status; Remove an approved entry (→ deleted like withdraw, logged).
  - **Votes**: live counts per entry; voter list (email, time, ip, ua) with flags: many emails from the same device cookie or IP within a short window. Void a vote.
  - **Settings**: phase override, extra allowed domains, Publish results.
- Every admin action → `admin_log` (who, what, target, when).
- New pending entries → batched email to admins at most every 10 min.
- Ties for top 3: shown to the admins, who decide manually; Publish takes the final ordering.

## 8. Privacy (Québec Law 25)

- Collected: email, entry content, photos, vote, ip/ua (anti-fraud).
- Consent text (FR + EN) on submission: photos shown publicly on this site during the contest; deleted within 30 days; removal on request.
- Anyone pictured can ask an admin to remove an entry (contact on the landing page).
- Purge by 2026-11-29: all rows + photos, except winners' photos if the DRC asks (exported, then the DB is deleted).
- `X-Robots-Tag: noindex` site-wide.

## 9. i18n

- FR + EN for all UI, emails, rules.
- Language from `Accept-Language`, French fallback; toggle stored in a cookie.
- Rules text supplied by the DRC organizers (FR + EN) by 10-24, stored as Markdown files in the repo.

## 10. Branding

- Halloween theme: dark background, orange accents. Must stay legible on phones outdoors.
- Footer: "Propulsé par / Brought to you by the DNP" + DNP logo (from douglasneuroinformatics.ca).
- DRC logo in the header if supplied.

## 11. Stack & deployment

- Node 24 runs TypeScript directly (type stripping, no build), Hono (`@hono/node-server`), server-rendered HTML via `hono/html`, minimal client JS.
- SQLite via built-in `node:sqlite` (WAL). Photos on disk.
- `sharp` for images, `nodemailer` for SMTP.
- One Docker container; `/data` (db + photos) bind-mounted from the host. No backups (one-day event), accepted risk.
- Caddy on the DNP server reverse-proxies `halloween2026.douglasneuroinformatics.ca` → container, with automatic TLS. Caddy limits the request body (≈ 50 MB).
- Public repo, MIT, DNP GitHub org. Secrets only in `.env` on the server.

### Config (`.env`)

```
BASE_URL=https://halloween2026.douglasneuroinformatics.ca
TZ=America/Montreal
OPEN_AT=2026-10-30T08:00
SUBMIT_CLOSE_AT=2026-10-30T14:00
VOTE_CLOSE_AT=2026-10-30T16:00
SESSION_END_AT=2026-10-30T23:59
ALLOWED_DOMAINS=mcgill.ca,mail.mcgill.ca,douglas.mcgill.ca,ssss.gouv.qc.ca
ADMIN_EMAILS=a@...,b@...,c@...,d@...
SMTP_HOST=smtp.tem.scaleway.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM="Halloween DRC <noreply@mail.douglasneuroinformatics.ca>"
SESSION_SECRET=...
DATA_DIR=/data
```

## 12. Data model (SQLite)

```
users        (email PK, lang, created_at)
otp_codes    (email PK, code_hash, expires_at, attempts, sent_at)
otp_sends    (email, ip, sent_at)                -- rate limiting
sessions     (token_hash PK, email, device_id, ip, ua, expires_at)
entries      (id PK, owner_email UNIQUE, name, caption, status,
              reject_reason, consent_at, created_at, updated_at)
photos       (id PK, entry_id FK, position, file, thumb)
votes        (voter_email PK, entry_id FK, device_id, ip, ua, updated_at)
admin_log    (id PK, admin_email, action, target, detail, at)
settings     (key PK, value)   -- phase_override, extra_domains, results_json
```

## 13. Security checklist

- CSRF: SameSite=Lax cookie + `Origin` check on every POST.
- Constant-time code compare; hash codes and session tokens.
- Ownership/role check on every entry, photo or admin route.
- Escape all user text (JSX does this); no user HTML.
- Upload limits enforced in Caddy and the app; decode-validate images.
- Rate-limit the OTP request and verify endpoints.
- Security headers: CSP (self only), `nosniff`, `frame-ancestors 'none'`.

## 14. Risks

| Risk | Mitigation |
|---|---|
| OTP mail junked/slow at McGill/CIUSSS | Deliverability test by 10-23; ask Douglas IT to allowlist the sender; fall back to unverified email + admin audit |
| Scaleway account/domain verification delay | Start today |
| DNS not in our hands | Ask the DNS owner today for the A record + mail records |
| Server down on the day | On call 08:00–16:00; Google Form fallback |
| Inappropriate photo slips through | Moderation queue; Remove button; removal on request |
