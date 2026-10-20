import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  email       TEXT PRIMARY KEY,
  lang        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS otp_codes (
  email       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  sent_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS otp_sends (
  email       TEXT NOT NULL,
  ip          TEXT NOT NULL,
  sent_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS otp_sends_email ON otp_sends(email, sent_at);
CREATE INDEX IF NOT EXISTS otp_sends_ip ON otp_sends(ip, sent_at);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  device_id   TEXT,
  ip          TEXT,
  ua          TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  id            INTEGER PRIMARY KEY,
  owner_email   TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  caption       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason TEXT,
  consent_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  id          INTEGER PRIMARY KEY,
  entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  file        TEXT NOT NULL,
  thumb       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  voter_email TEXT PRIMARY KEY,
  entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  device_id   TEXT,
  ip          TEXT,
  ua          TEXT,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_log (
  id          INTEGER PRIMARY KEY,
  admin_email TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      TEXT,
  at          INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL
);
`;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}

export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Db, key: string, value: string | null): void {
  if (value === null) db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  else db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
