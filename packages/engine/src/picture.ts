/**
 * Light copies of a picture for the apps. A conversation's tile is drawn at about 200 px, so loading the original (a
 * 4 MB PNG for a 200 px square) made every conversation with pictures slow. The server makes a WebP copy, kept in
 * memory, and the browser keeps it for good since a file's version never changes. The original stays the download.
 */

/** `tile`: a conversation's or the Drive's cover. `view`: the viewer, sharp on a large screen and still light. */
export type PictureSize = "tile" | "view";

const SIZES: Record<PictureSize, { edge: number; quality: number }> = {
  tile: { edge: 640, quality: 60 },
  view: { edge: 2048, quality: 80 },
};

/** Types we redraw. A GIF keeps its own bytes (a smaller still copy would stop its animation). */
const REDRAWN = new Set(["image/png", "image/jpeg", "image/webp"]);

const base = (contentType: string) => contentType.split(";")[0]?.trim().toLowerCase() ?? "";
export const picturesRedraw = (contentType: string) => REDRAWN.has(base(contentType));

/** The pictures served inline at all: raster types an <img> draws (SVG never: it is a document). */
export const isRasterPicture = (contentType: string) =>
  REDRAWN.has(base(contentType)) || base(contentType) === "image/gif";

/** A copy's long side and quality (also for tests). */
export const pictureSize = (size: PictureSize) => SIZES[size];

/** The copies made recently, by key, up to `CACHE_BYTES` in all (least recently read leaves first). */
const CACHE_BYTES = 64 * 1024 * 1024;
export type Picture = { body: Uint8Array; contentType: string };
const cache = new Map<string, Picture>();
let cached = 0;

function remember(key: string, picture: Picture) {
  if (picture.body.length > CACHE_BYTES / 8) return;
  cache.set(key, picture);
  cached += picture.body.length;
  for (const [k, v] of cache) {
    if (cached <= CACHE_BYTES) break;
    cache.delete(k);
    cached -= v.body.length;
  }
}

/** A copy already made (it moves to the end: read recently). */
export function cachedPicture(key: string): Picture | null {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

/** Copies being made, so ten tiles asking at once make one. */
const making = new Map<string, Promise<Picture | null>>();

/**
 * The picture as a WebP of at most `size`'s long side (never larger than the original; the original itself when the
 * copy would weigh more), or null when it can't be read (the caller sends the original). `key` names version and size.
 */
export function makePicture(key: string, original: Picture, size: PictureSize): Promise<Picture | null> {
  const hit = cachedPicture(key);
  if (hit) return Promise.resolve(hit);
  const pending = making.get(key);
  if (pending) return pending;
  const { edge, quality } = SIZES[size];
  const job = (async () => {
    try {
      // 50 MP at most: a small file claiming a huge canvas is refused before any pixel is held.
      const image = new Bun.Image(original.body, { maxPixels: 50_000_000 });
      const bytes = await image
        .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .bytes();
      // A copy no lighter than the original (a small, well compressed one) is not worth it.
      const out = bytes.length < original.body.length ? { body: bytes, contentType: "image/webp" } : original;
      remember(key, out);
      return out;
    } catch {
      return null;
    } finally {
      making.delete(key);
    }
  })();
  making.set(key, job);
  return job;
}

/** Tests: forget every copy. */
export function forgetPictures() {
  cache.clear();
  cached = 0;
}
