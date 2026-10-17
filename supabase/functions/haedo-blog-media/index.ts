/* Only currently published photo IDs are readable. Original objects remain
 * private; this function never redirects or exposes a Storage URL or secret. */
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
      // A withdrawal or update while Storage was opening must not admit an old
      // public photo. Requests already streaming cannot recall received bytes.
      const current = await authorize();
      if (!current || (["bucket", "path", "type", "size", "digest"] as const).some((field) => current[field] !== media[field])) {
        await stored.body.cancel(); return failed(404);
      }
      let received = 0;
      const body = stored.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > media.size || received > MAX_BYTES) throw new Error("original size mismatch");
          controller.enqueue(chunk);
        },
        flush() { if (received !== media.size) throw new Error("original size mismatch"); },
      }));
      const suffix = media.type === "image/jpeg" ? "jpg" : media.type === "image/png" ? "png" : "webp";
      return new Response(body, { status: 200, headers: {
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
