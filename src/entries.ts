import type { Db } from "./db.ts";
import type { StoredPhoto } from "./photos.ts";

export const NAME_MAX = 60;
export const CAPTION_MAX = 200;

export type EntryStatus = "pending" | "approved" | "rejected";

export type Entry = {
  id: number;
  ownerEmail: string;
  name: string;
  caption: string;
  status: EntryStatus;
  rejectReason: string | null;
  createdAt: number;
  updatedAt: number;
  photos: StoredPhoto[];
};

type EntryRow = {
  id: number;
  owner_email: string;
  name: string;
  caption: string;
  status: EntryStatus;
  reject_reason: string | null;
  created_at: number;
  updated_at: number;
};

export type FieldError = "name_required" | "name_too_long" | "caption_too_long" | "consent_required";

export function validateFields(name: string, caption: string, consent: boolean): FieldError | null {
  if (!name) return "name_required";
  if ([...name].length > NAME_MAX) return "name_too_long";
  if ([...caption].length > CAPTION_MAX) return "caption_too_long";
  if (!consent) return "consent_required";
  return null;
}

function photosOf(db: Db, entryId: number): StoredPhoto[] {
  return db.prepare("SELECT file, thumb FROM photos WHERE entry_id = ? ORDER BY position").all(entryId) as StoredPhoto[];
}

function toEntry(db: Db, row: EntryRow): Entry {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    name: row.name,
    caption: row.caption,
    status: row.status,
    rejectReason: row.reject_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    photos: photosOf(db, row.id),
  };
}

export function getEntryByOwner(db: Db, email: string): Entry | null {
  const row = db.prepare("SELECT * FROM entries WHERE owner_email = ?").get(email) as EntryRow | undefined;
  return row ? toEntry(db, row) : null;
}

function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Create the owner's entry or update it. Any save puts the entry back to pending.
 * `photos` replaces all existing photos when given; omitted keeps them.
 * Returns the photos that were replaced so the caller can delete their files.
 */
export function saveEntry(
  db: Db,
  input: { owner: string; name: string; caption: string; photos: StoredPhoto[] | null; now: number },
): { entry: Entry; replaced: StoredPhoto[] } {
  return tx(db, () => {
    const existing = db.prepare("SELECT id FROM entries WHERE owner_email = ?").get(input.owner) as
      | { id: number }
      | undefined;
    let id: number;
    let replaced: StoredPhoto[] = [];
    if (existing) {
      id = existing.id;
      db.prepare(
        "UPDATE entries SET name = ?, caption = ?, status = 'pending', reject_reason = NULL, consent_at = ?, updated_at = ? WHERE id = ?",
      ).run(input.name, input.caption, input.now, input.now, id);
      if (input.photos) {
        replaced = photosOf(db, id);
        db.prepare("DELETE FROM photos WHERE entry_id = ?").run(id);
      }
    } else {
      if (!input.photos?.length) throw new Error("a new entry needs photos");
      id = Number(
        db
          .prepare(
            "INSERT INTO entries (owner_email, name, caption, status, consent_at, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)",
          )
          .run(input.owner, input.name, input.caption, input.now, input.now, input.now).lastInsertRowid,
      );
    }
    input.photos?.forEach((p, i) =>
      db.prepare("INSERT INTO photos (entry_id, position, file, thumb) VALUES (?, ?, ?, ?)").run(id, i, p.file, p.thumb),
    );
    const row = db.prepare("SELECT * FROM entries WHERE id = ?").get(id) as EntryRow;
    return { entry: toEntry(db, row), replaced };
  });
}

/** Hard delete: entry, its photo rows and its votes (FK cascade). Returns photos to delete from disk. */
export function deleteEntry(db: Db, id: number): StoredPhoto[] {
  return tx(db, () => {
    const photos = photosOf(db, id);
    db.prepare("DELETE FROM entries WHERE id = ?").run(id);
    return photos;
  });
}

/** Who may see a stored photo file: its entry's status and owner. */
export function photoOwner(db: Db, name: string): { status: EntryStatus; ownerEmail: string } | null {
  const row = db
    .prepare(
      "SELECT e.status, e.owner_email FROM photos p JOIN entries e ON e.id = p.entry_id WHERE p.file = ? OR p.thumb = ?",
    )
    .get(name, name) as { status: EntryStatus; owner_email: string } | undefined;
  return row ? { status: row.status, ownerEmail: row.owner_email } : null;
}
