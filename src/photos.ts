import { randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type Metadata } from "sharp";

export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_PHOTOS = 3;
const FULL_PX = 1600;
const THUMB_PX = 600;
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp"]);

export type PhotoError = "too_big" | "unsupported" | "heic";
export type StoredPhoto = { file: string; thumb: string };

/** Sniff the HEIC/HEIF brand so iPhone uploads get a specific message. */
function looksLikeHeic(buf: Uint8Array): boolean {
  if (buf.length < 12) return false;
  const box = Buffer.from(buf.subarray(4, 12)).toString("latin1");
  return box.startsWith("ftyp") && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(box.slice(4));
}

/**
 * Decode-validate, auto-rotate, resize, re-encode as WebP. Re-encoding drops all
 * metadata (EXIF/GPS) because sharp only keeps it when asked with withMetadata().
 */
export async function processPhoto(
  input: Uint8Array,
): Promise<{ ok: true; full: Buffer; thumb: Buffer } | { ok: false; error: PhotoError }> {
  if (input.byteLength > MAX_PHOTO_BYTES) return { ok: false, error: "too_big" };
  if (looksLikeHeic(input)) return { ok: false, error: "heic" };
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    return { ok: false, error: "unsupported" };
  }
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) return { ok: false, error: "unsupported" };
  try {
    const base = sharp(input, { failOn: "error" }).rotate();
    const [full, thumb] = await Promise.all([
      base.clone().resize(FULL_PX, FULL_PX, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(),
      base.clone().resize(THUMB_PX, THUMB_PX, { fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer(),
    ]);
    return { ok: true, full, thumb };
  } catch {
    return { ok: false, error: "unsupported" };
  }
}

export async function storePhoto(dir: string, full: Buffer, thumb: Buffer): Promise<StoredPhoto> {
  const id = randomBytes(16).toString("hex");
  const photo = { file: `${id}.webp`, thumb: `${id}_t.webp` };
  await writeFile(join(dir, photo.file), full);
  await writeFile(join(dir, photo.thumb), thumb);
  return photo;
}

export async function deletePhotoFiles(dir: string, photos: StoredPhoto[]): Promise<void> {
  await Promise.all(
    photos.flatMap((p) => [p.file, p.thumb]).map((f) => unlink(join(dir, f)).catch(() => undefined)),
  );
}

/** Only names we generated are ever served — guards against path traversal. */
export const isPhotoName = (name: string) => /^[0-9a-f]{32}(_t)?\.webp$/.test(name);
