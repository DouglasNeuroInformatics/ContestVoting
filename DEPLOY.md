# Deploying the Halloween 2026 voting site

For the sysadmin of the DNP server (134.87.12.99). Questions about the app:
Cian Monnin.

**What it is:** one Docker container (Node, SQLite on a bind-mounted
`./data`), behind the Caddy that already serves
`halloween2026.douglasneuroinformatics.ca`. It sends login codes by email
through Scaleway over SMTP (port 587, outbound). Nothing else: no database
server, no Redis, no build step.

**Dates:** test round now → launch (wipe the test data) by **Thu 10-29** →
contest Fri 10-30 08:00 → voting closes Tue 11-03 16:00 → everything deleted
by **Tue 12-01**.

## 1. Check the server can reach the mail relay

```sh
nc -vz smtp.tem.scaleway.com 587
```

It must say "succeeded" / "open". If outbound 587 is blocked, open it before
going further: without it nobody can log in.

## 2. Get the code and the secrets

```sh
git clone https://github.com/DouglasNeuroInformatics/ContestVoting.git halloween2026
cd halloween2026
cp .env.example .env
chmod 600 .env
```

Fill in `.env`:

| Key | Value |
| --- | --- |
| `SMTP_USER` | Scaleway Project ID — Cian sends it |
| `SMTP_PASS` | Scaleway API secret key for this server — Cian sends it over a secure channel, never by email or chat |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `DEV_LOGIN_SECRET` | another `openssl rand -hex 32`; give it to Cian over a secure channel (see below) |
| `ADMIN_EMAILS` | comma-separated, Cian sends the list |

Leave the rest as in `.env.example` except the test-round values below.

## 3. Test round settings

For now the site runs in test mode: everything unlocked, but only named
testers can log in. In `.env`:

```sh
OPEN_AT=2026-10-23T08:00
ALLOWED_DOMAINS=test.invalid
PREVIEW_EMAILS=<testers, comma-separated — Cian sends the list>
```

## 4. Start the container

```sh
mkdir -p data && sudo chown 1000:1000 data   # the container runs as uid 1000
docker compose up -d --build
docker compose logs --tail=20 app
```

The log should end with
`halloween2026 listening on :3000 (https://halloween2026.douglasneuroinformatics.ca, mail=smtp)`.
The app listens on `127.0.0.1:3000` only.

Optional mail check (sends one real code-style email):

```sh
docker compose run --rm app node scripts/send-test.ts you@mcgill.ca
```

## 5. Point Caddy at the app

Replace the current static `halloween2026.douglasneuroinformatics.ca { … }`
block (the "coming soon" page) with the contents of `deploy/Caddyfile`:

```caddy
halloween2026.douglasneuroinformatics.ca {
	request_body {
		max_size 50MB
	}
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
```

then reload Caddy (`sudo systemctl reload caddy` or `caddy reload`). The app
now serves the same landing page at `/`, so visitors see no change until the
contest opens.

**If Caddy itself runs in a container**, `127.0.0.1:3000` points at Caddy's
own container, not the host. In that case put both on a shared Docker network
and use `reverse_proxy app:3000`, or tell Cian and we'll sort it out.

Check: <https://halloween2026.douglasneuroinformatics.ca> shows the landing
page, and `/gallery` shows the (empty) gallery.

## 6. Launch (by Thu 10-29)

Edit `.env` for the real contest:

```sh
OPEN_AT=2026-10-30T08:00
ALLOWED_DOMAINS=mcgill.ca,mail.mcgill.ca,douglas.mcgill.ca,ssss.gouv.qc.ca
PREVIEW_EMAILS=
```

then run, from the repo directory:

```sh
scripts/reset.sh
```

It checks `.env`, shows the settings, asks you to type `wipe`, deletes
`./data` (all test entries, photos, votes and sessions), puts a new
`SESSION_SECRET` in `.env` and restarts the container. It uses `sudo` for
the delete. It refuses to run once `OPEN_AT` has passed, so it can't wipe the
live contest.

Then check: the landing page loads, logging in with a McGill address says
the contest isn't open yet, and an admin can still log in.

## Backup admin login

If login emails stop arriving, admins can still get in at
`https://halloween2026.douglasneuroinformatics.ca/dev/login` with their admin
email and `DEV_LOGIN_SECRET`. Once in, they can issue backup codes to
everyone else. Each use is recorded in the admin log; refused attempts show
in `docker compose logs app` as `dev login refused`. To turn it off, empty
`DEV_LOGIN_SECRET` and `docker compose up -d`. `reset.sh` leaves it as is.

## Day to day

| Task | Command |
| --- | --- |
| Logs | `docker compose logs -f app` |
| Restart | `docker compose restart app` |
| Update to new code | `git pull && docker compose up -d --build` |
| Change a setting | edit `.env`, then `docker compose up -d` |

Settings admins may ask to change:

- `ADMIN_ALERT_MINUTES`: admins get an "entries to review" email at most
  this often while entries wait for approval (default 30; `0` = off).
- `ADMIN_EMAILS`, `PREVIEW_EMAILS`: who can manage the contest / log in
  before it opens.

The container restarts by itself after a reboot (`restart: unless-stopped`).
Data lives in `./data` only. There are no backups; that's accepted for a
one-week event.

Please don't delete `./data` or run `reset.sh` after 10-29 unless Cian asks.

## 7. Tear down (by Tue 12-01)

Only after Cian confirms results are published and any winner photos have
been exported:

```sh
docker compose down
sudo rm -rf data
```

Then remove the Caddy block, delete `.env` (it holds the API key) and ask
DreamHost to remove the `halloween2026` DNS records (A, SPF, DKIM, DMARC).
Cian will revoke the Scaleway key.
