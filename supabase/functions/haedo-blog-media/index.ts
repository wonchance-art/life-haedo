/* Only currently published photo IDs are readable. Original objects remain
 * private; this function never redirects or exposes a Storage URL or secret.
 * 2026-11-02: published photos are metadata-free copies. Before any byte is
 * sent, the whole object is read, its SHA-256 must equal the published digest
 * and its structure must carry no EXIF, GPS, XMP, IPTC, comment or text
 * metadata. Anything else (an original, trailing data, an unknown chunk) is
 * refused, so a client mistake cannot publish camera or location data. */
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const MAX_BYTES = 64 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
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

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const starts = (b: Uint8Array, at: number, text: string) => at + text.length <= b.length && ascii(b, at, at + text.length) === text;
// JPEG: only JFIF/JFXX (APP0), ICC colour profile (APP2) and Adobe colour
// transform (APP14) application segments; no APP1 (EXIF/XMP), APP13 (IPTC),
// comments, MPF secondary images or bytes after the end marker.
function cleanJpeg(b: Uint8Array): boolean {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return false;
  let at = 2;
  while (at < b.length) {
    if (b[at] !== 0xff) return false;
    while (at < b.length && b[at] === 0xff) at++;
    if (at >= b.length) return false;
    const marker = b[at++];
    if (marker === 0xd9) return at === b.length;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (at + 2 > b.length) return false;
    const length = (b[at] << 8) | b[at + 1];
    if (length < 2 || at + length > b.length) return false;
    if (marker === 0xfe) return false;
    if (marker >= 0xe0 && marker <= 0xef) {
      const body = at + 2;
      const allowed = (marker === 0xe0 && (starts(b, body, "JFIF\0") || starts(b, body, "JFXX\0"))) ||
        (marker === 0xe2 && starts(b, body, "ICC_PROFILE\0")) || (marker === 0xee && starts(b, body, "Adobe"));
      if (!allowed) return false;
    }
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
// PNG: still images with pixel and colour chunks only. No eXIf, tEXt, zTXt,
// iTXt, tIME, animation or unknown chunks; nothing after IEND.
const PNG_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "cICP", "bKGD", "pHYs"]);
function cleanPng(b: Uint8Array): boolean {
  if (b.length < 8 || ascii(b, 0, 8) !== "\x89PNG\r\n\x1a\n") return false;
  let at = 8;
  while (at + 12 <= b.length) {
    const length = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0, name = ascii(b, at + 4, at + 8);
    if (!PNG_CHUNKS.has(name) || at + 12 + length > b.length) return false;
    at += 12 + length;
    if (name === "IEND") return at === b.length;
  }
  return false;
}
// WebP: still image data, alpha and colour profile only. No EXIF or XMP.
const WEBP_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP"]);
function cleanWebp(b: Uint8Array): boolean {
  if (b.length < 20 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 12) !== "WEBP") return false;
  const riff = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
  if (riff + 8 !== b.length) return false;
  let at = 12;
  while (at + 8 <= b.length) {
    const name = ascii(b, at, at + 4), length = (b[at + 4] | (b[at + 5] << 8) | (b[at + 6] << 16) | (b[at + 7] << 24)) >>> 0;
    if (!WEBP_CHUNKS.has(name) || at + 8 + length > b.length) return false;
    if (name === "VP8X" && (length < 1 || (b[at + 8] & 0x0e))) return false; // EXIF, XMP or animation flags
    at += 8 + length + (length & 1);
  }
  return at === b.length;
}
export function metadataFree(type: string, bytes: Uint8Array): boolean {
  if (type === "image/jpeg") return cleanJpeg(bytes);
  if (type === "image/png") return cleanPng(bytes);
  if (type === "image/webp") return cleanWebp(bytes);
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
    const project = environment("SUPABASE_URL"), key = environment("SUPABASE_SERVICE_ROLE_KEY");
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
        headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
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
        headers: { apikey: key, Authorization: "Bearer " + key },
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
      const suffix = media.type === "image/jpeg" ? "jpg" : media.type === "image/png" ? "png" : "webp";
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
