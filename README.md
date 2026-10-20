# DRC Halloween 2026 — costume contest voting

Voting site for the Douglas Research Centre Halloween costume contest, at
<https://halloween2026.douglasneuroinformatics.ca>. Brought to you by the
[DNP](https://douglasneuroinformatics.ca).

Design: [SPEC.md](SPEC.md). Progress: [TASKS.md](TASKS.md).

## Stack

Node 24 runs the TypeScript directly (type stripping, no build step). Hono for
HTTP, server-rendered HTML, built-in `node:sqlite`, nodemailer over SMTP
(Scaleway Transactional Email). Login is a 6-digit code sent to an
institutional email address.

## Develop

```sh
npm install
cp .env.example .env    # set MAIL_TRANSPORT=console, BASE_URL=http://localhost:3000,
                        # DATA_DIR=./data, SESSION_SECRET=$(openssl rand -base64 48)
npm run dev             # codes are printed to the terminal
npm test
npm run typecheck
```

To try the open phase before the contest, set `OPEN_AT` to a past time in `.env`.

## Deploy (DNP server)

```sh
cp .env.example .env    # fill SMTP_*, ADMIN_EMAILS, SESSION_SECRET
mkdir -p data && sudo chown 1000:1000 data   # container runs as uid 1000
docker compose up -d --build
```

Add `deploy/Caddyfile` to the server's Caddy config and reload Caddy. The app
listens on `127.0.0.1:3000` only; Caddy terminates TLS.

## Deliverability test

Before the contest, check that the login emails reach institutional inboxes:

```sh
docker compose run --rm app node scripts/send-test.ts alice@mcgill.ca bob@ssss.gouv.qc.ca
```

Each recipient reports arrival time and whether the email landed in Junk.

To log in before the contest opens, put the address in `ADMIN_EMAILS` or
`PREVIEW_EMAILS`.

## License

MIT
