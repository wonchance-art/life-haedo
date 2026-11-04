/* Only currently published photo IDs are readable. Original objects remain
 * private; this function never redirects or exposes a Storage URL or secret.
 * 2026-11-02: published photos are metadata-free copies. Before any byte is
 * sent, the whole object is read, its SHA-256 must equal the published digest
 * and it must pass the public-copy allow list below (no EXIF, GPS, XMP,
 * IPTC, comment, text, time or animation data, nothing after the end marker).
 * Anything else is refused, so a client mistake cannot publish camera or
 * location data. */
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const MAX_BYTES = 64 * 1024 * 1024;
// Public copies are JPEG or PNG only (HEIC/HEIF and WebP publish a JPEG/PNG copy).
const TYPES = new Set(["image/jpeg", "image/png"]);
type Media = { bucket: string; path: string; type: string; size: number; digest: string };
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Surrogate-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const failed = (status: number) => new Response(null, { status, headers: HEADERS });
function validMedia(input: unknown): input is Media {
  const value = input as Partial<Media> | null;
  if (!value || value.bucket !== "haedo-blog-originals" || typeof value.type !== "string" || !TYPES.has(value.type) ||
      typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_BYTES ||
      typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest) || typeof value.path !== "string") return false;
  const path = value.path.split("/");
  return path.length === 4 && UUID.test(path[0]) && UUID.test(path[1]) &&
    /^[A-Za-z0-9_-]{1,128}$/.test(path[2]) && path[3] === value.digest;
}

// The public-copy allow list. Same rules as PhotoPost.metadataFree in
// assets/life/photo-post.js (tests/blog-public-copies.test.cjs compares both
// on one corpus). JPEG: SOI, SOF, DHT, DQT, DRI, SOS, EOI, APP0 JFIF (16-byte,
// no thumbnail), APP2 ICC (profile signature), APP14 Adobe (14-byte). PNG:
// IHDR, PLTE, IDAT, IEND, tRNS, gAMA, cHRM, sRGB, iCCP (name/method/zlib
// header), pHYs. Anything else, or bytes after the end marker, is refused.
// ICC profile contents (including their description text) are checked
// structurally only.
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "pHYs"]);
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const bytesAre = (b: Uint8Array, from: number, value: string) =>
  from + value.length <= b.length && [...value].every((c, i) => b[from + i] === c.charCodeAt(0));
function jpegSegment(b: Uint8Array, marker: number, at: number, length: number): boolean {
  const body = at + 2;
  if (JPEG_SOF.has(marker) || [0xc4, 0xdb, 0xdd, 0xda].includes(marker)) return true;
  if (marker === 0xe0) return length === 16 && bytesAre(b, body, "JFIF\0") && b[body + 12] === 0 && b[body + 13] === 0;
  if (marker === 0xee) return length === 14 && bytesAre(b, body, "Adobe");
  if (marker === 0xe2) {
    if (length < 16 || !bytesAre(b, body, "ICC_PROFILE\0")) return false;
    const seq = b[body + 12], count = b[body + 13];
    if (seq < 1 || seq > count) return false;
    return seq > 1 || (length >= 16 + 40 && bytesAre(b, body + 14 + 36, "acsp"));
  }
  return false;
}
function cleanJpeg(b: Uint8Array): boolean {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return false;
  let at = 2;
  while (at < b.length) {
    if (b[at] !== 0xff) return false;
    while (at < b.length && b[at] === 0xff) at++;
    if (at >= b.length) return false;
    const marker = b[at++];
    if (marker === 0xd9) return at === b.length;
    if (at + 2 > b.length) return false;
    const length = (b[at] << 8) | b[at + 1];
    if (length < 2 || at + length > b.length || !jpegSegment(b, marker, at, length)) return false;
    at += length;
    if (marker === 0xda) {
      // Entropy-coded data: stuffed 0xFF00, restart markers and fill bytes stay inside the scan.
      while (at < b.length) {
        if (b[at] !== 0xff) { at++; continue; }
        const next = b[at + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { at += 2; continue; }
        if (next === 0xff) { at++; continue; }
        break;
      }
    }
  }
  return false;
}
function iccpValid(b: Uint8Array, from: number, length: number): boolean {
  let n = 0;
  while (n < length && n < 80 && b[from + n] !== 0) {
    const c = b[from + n];
    if (!((c >= 32 && c <= 126) || c >= 161)) return false;
    n++;
  }
  if (n < 1 || n > 79 || b[from] === 32 || b[from + n - 1] === 32 || n + 4 > length) return false;
  const cmf = b[from + n + 2], flg = b[from + n + 3];
  return b[from + n] === 0 && b[from + n + 1] === 0 && (cmf & 15) === 8 && ((cmf << 8) | flg) % 31 === 0;
}
function cleanPng(b: Uint8Array): boolean {
  if (b.length < 8 || PNG_SIGNATURE.some((v, i) => b[i] !== v)) return false;
  let at = 8;
  while (at + 12 <= b.length) {
    const length = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0,
      name = String.fromCharCode(...b.subarray(at + 4, at + 8)), end = at + 12 + length;
    if (end > b.length || (at === 8) !== (name === "IHDR") || !PNG_KEEP.has(name) || (name === "iCCP" && !iccpValid(b, at + 8, length))) return false;
    at = end;
    if (name === "IEND") return at === b.length;
  }
  return false;
}
export function metadataFree(type: string, bytes: Uint8Array): boolean {
  if (type === "image/jpeg") return cleanJpeg(bytes);
  if (type === "image/png") return cleanPng(bytes);
  return false;
}
async function readExact(body: ReadableStream<Uint8Array>, size: number): Promise<Uint8Array | null> {
  const reader = body.getReader(), bytes = new Uint8Array(size);
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.byteLength > size) { await reader.cancel(); return null; }
      bytes.set(value, received); received += value.byteLength;
    }
  } finally { reader.releaseLock(); }
  return received === size ? bytes : null;
}
// Supabase API keys, new format first (2026-11-04; legacy keys retire by the
// end of 2026). Same rules as ../_shared/supabase-keys.mjs, kept inline so this
// single-file function deploys alone; tests/supabase-keys.test.cjs checks both.
// SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS are JSON objects keyed by
// name ("default" is used). sb_secret_ keys are not JWTs: apikey header only.
type Environment = (name: string) => string | undefined;
const keyText = (value: unknown) => typeof value === "string" && value.length > 0 ? value : null;
function namedKeys(raw: string | undefined): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw.length) return null;
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (_) { return null; }
}
export function serverKey(environment: Environment): string | null {
  const secrets = namedKeys(environment("SUPABASE_SECRET_KEYS"));
  const publishables = namedKeys(environment("SUPABASE_PUBLISHABLE_KEYS"));
  const publicKeys = [...Object.values(publishables || {}).map(keyText),
    keyText(environment("SUPABASE_ANON_KEY")), keyText(environment("SUPABASE_PUBLISHABLE_KEY"))].filter(Boolean);
  return [keyText(secrets?.default), keyText(environment("SUPABASE_SERVICE_ROLE_KEY"))]
    .find((key) => !!key && !key.startsWith("sb_publishable_") && !publicKeys.includes(key)) || null;
}
const serverHeaders = (key: string): Record<string, string> =>
  key.startsWith("sb_secret_") ? { apikey: key } : { apikey: key, Authorization: "Bearer " + key };
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (n) => n.toString(16).padStart(2, "0")).join("");

export function createHandler({ fetcher = fetch, environment = (name: string) => Deno.env.get(name) }: {
  fetcher?: typeof fetch; environment?: (name: string) => string | undefined;
} = {}) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
    if (request.method !== "GET") return failed(405);
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some((key) => !["token", "photo"].includes(key)) ||
        url.searchParams.getAll("token").length !== 1 || url.searchParams.getAll("photo").length !== 1) return failed(404);
    const token = url.searchParams.get("token"), photo = url.searchParams.get("photo");
    if (!UUID.test(token || "") || !UUID.test(photo || "")) return failed(404);
    const project = environment("SUPABASE_URL"), key = serverKey(environment);
    if (!project || !key) return failed(503);
    let origin: string;
    try {
      const parsed = new URL(project);
      if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/" ||
          !(parsed.protocol === "https:" || (parsed.protocol === "http:" && ["127.0.0.1", "localhost", "kong"].includes(parsed.hostname)))) return failed(503);
      origin = parsed.origin;
    } catch (_) { return failed(503); }
    const authorize = async (): Promise<Media | null> => {
      const response = await fetcher(origin + "/rest/v1/rpc/life_blog_public_media", {
        method: "POST", signal: request.signal, redirect: "error",
        headers: { ...serverHeaders(key), "Content-Type": "application/json" },
        body: JSON.stringify({ p_token: token, p_photo_id: photo }),
      });
      if (!response.ok) throw new Error("media lookup failed");
      const text = await response.text();
      if (text.length > 8192) throw new Error("media lookup invalid");
      const value = JSON.parse(text);
      if (value === null) return null;
      if (!validMedia(value)) throw new Error("media lookup invalid");
      return value;
    };
    let stored: Response | undefined;
    try {
      const media = await authorize();
      if (!media) return failed(404);
      stored = await fetcher(origin + "/storage/v1/object/authenticated/haedo-blog-originals/" + media.path.split("/").map(encodeURIComponent).join("/"), {
        method: "GET", signal: request.signal, cache: "no-store", redirect: "error",
        headers: serverHeaders(key),
      });
      if (!stored.ok || !stored.body) { await stored.body?.cancel(); return failed(404); }
      const type = stored.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      const length = stored.headers.get("content-length");
      if (type !== media.type || (length !== null && Number(length) !== media.size)) {
        await stored.body.cancel(); return failed(502);
      }
      const bytes = await readExact(stored.body, media.size);
      if (!bytes || hex(await crypto.subtle.digest("SHA-256", bytes)) !== media.digest || !metadataFree(media.type, bytes)) return failed(502);
      // A withdrawal or update while Storage was being read must not admit an
      // old public photo. Nothing has been sent before this check.
      const current = await authorize();
      if (!current || (["bucket", "path", "type", "size", "digest"] as const).some((field) => current[field] !== media[field])) return failed(404);
      const suffix = media.type === "image/jpeg" ? "jpg" : "png";
      return new Response(bytes, { status: 200, headers: {
        ...HEADERS, "Content-Type": media.type, "Content-Length": String(media.size),
        "Content-Disposition": `inline; filename="photo.${suffix}"`,
      } });
    } catch (_) {
      try { await stored?.body?.cancel(); } catch (_) { /* A response may already be closed. */ }
      return failed(502);
    }
  };
}
if (typeof Deno !== "undefined") Deno.serve(createHandler());
