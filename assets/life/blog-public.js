/* Anonymous public RPCs only. No SDK, Auth, cookies, IndexedDB or offline copies. */
(function (root, factory) {
  const api = factory(root);
  (root.HaedoLife ||= {}).BlogPublic = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis, function (root) {
  "use strict";
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const model = () => root.HaedoLife?.Blog || require("./blog.js");
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const check = (ok, code = "invalid_remote_data") => { if (!ok) fail(code); };
  const plain = (v) => v && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  function fields(v, names) { check(plain(v) && Reflect.ownKeys(v).length === names.length && names.every((name) => Object.hasOwn(v, name))); }
  function token(value, code = "invalid_request") { check(typeof value === "string" && UUID.test(value), code); return value.toLowerCase(); }
  function date(value) { check(typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value))); }
  function text(value, max) { check(typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(value)); }
  function config(input) {
    if (!input?.url || !input.key) fail("config_missing");
    let url;
    try { url = new URL(input.url); } catch (_) { fail("invalid_config"); }
    check(url.protocol === "https:" && url.pathname === "/" && !url.username && !url.password && !url.hash && !url.search, "invalid_config");
    const key = input.key;
    check(typeof key === "string" && key.length < 8192 && !/^sb_secret_/i.test(key), "invalid_config");
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
      try {
        const parts = key.split("."); check(parts.length === 3 && parts.every(Boolean), "invalid_config");
        const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        check(JSON.parse(root.atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))).role === "anon", "invalid_config");
      } catch (_) { fail("invalid_config"); }
    }
    return { url: url.origin, key };
  }
  function validatePost(value, requestedToken) {
    if (value === null) return null;
    fields(value, ["token", "blogToken", "revision", "createdAt", "updatedAt", "snapshot"]);
    check(token(value.token, "invalid_remote_data") === requestedToken);
    token(value.blogToken, "invalid_remote_data");
    check(Number.isSafeInteger(value.revision) && value.revision > 0); date(value.createdAt); date(value.updatedAt);
    check(Date.parse(value.updatedAt) >= Date.parse(value.createdAt));
    try { model().validateSnapshot(value.snapshot); } catch (_) { fail("invalid_remote_data"); }
    return value;
  }
  function validateRow(value) {
    fields(value, ["token", "revision", "title", "createdAt", "updatedAt", "excerpt", "cover"]);
    token(value.token, "invalid_remote_data"); check(Number.isSafeInteger(value.revision) && value.revision > 0);
    text(value.title, 500); text(value.excerpt, 500); date(value.createdAt); date(value.updatedAt);
    check(Date.parse(value.updatedAt) >= Date.parse(value.createdAt));
    if (value.cover !== null) {
      fields(value.cover, ["id", "type", "width", "height"]);
      token(value.cover.id, "invalid_remote_data"); check(["image/jpeg", "image/png", "image/webp"].includes(value.cover.type));
      check(Number.isSafeInteger(value.cover.width) && value.cover.width > 0 && Number.isSafeInteger(value.cover.height) && value.cover.height > 0);
    }
    return value;
  }
  function createReader(options = {}) {
    const connection = config(options.config || root.HAEDO_CONFIG), fetcher = options.fetch || root.fetch?.bind(root);
    check(typeof fetcher === "function", "invalid_config");
    let disposed = false;
    const controllers = new Set(), limit = model().LIMITS.bytes + 64 * 1024;
    const alive = () => check(!disposed, "request_cancelled");
    async function rpc(name, args) {
      alive(); const controller = new AbortController(); controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
      try {
        const response = await fetcher(connection.url + "/rest/v1/rpc/" + name, {
          method: "POST", headers: { apikey: connection.key, "Content-Type": "application/json", "Cache-Control": "no-store" },
          body: JSON.stringify(args), credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
        });
        alive();
        if (!response.ok) fail([404, 503].includes(response.status) ? "schema_missing" : "network_error");
        check(!Number.isFinite(Number(response.headers?.get("content-length"))) || Number(response.headers.get("content-length")) <= limit);
        let raw = "";
        if (response.body?.getReader) {
          const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
          let size = 0;
          try {
            while (true) {
              const chunk = await reader.read(); alive(); if (chunk.done) break;
              size += chunk.value.byteLength; check(size <= limit); raw += decoder.decode(chunk.value, { stream: true });
            }
            raw += decoder.decode();
          } catch (error) { await reader.cancel().catch(() => {}); throw error; }
          finally { reader.releaseLock(); }
        } else { raw = await response.text(); check(new TextEncoder().encode(raw).length <= limit); }
        alive();
        try { return JSON.parse(raw); } catch (_) { fail("invalid_remote_data"); }
      } catch (error) {
        alive(); if (["invalid_remote_data", "network_error", "schema_missing"].includes(error.code)) throw error;
        fail(error.name === "AbortError" ? "request_cancelled" : "network_error");
      } finally { clearTimeout(timer); controllers.delete(controller); }
    }
    async function read(id) { const requested = token(id); return validatePost(await rpc("life_blog_public_read", { p_token: requested }), requested); }
    async function list(id, { before = null, limit: count = 40 } = {}) {
      const blogToken = token(id); check(Number.isSafeInteger(count) && count > 0 && count <= 40, "invalid_request");
      if (before !== null) { fields(before, ["updatedAt", "token"]); date(before.updatedAt); token(before.token, "invalid_request"); }
      const result = await rpc("life_blog_public_list", { p_blog_token: blogToken, p_limit: count, p_before: before });
      fields(result, ["blogToken", "author", "posts", "nextCursor"]);
      check(token(result.blogToken, "invalid_remote_data") === blogToken);
      fields(result.author, ["name", "intro"]); text(result.author.name, 500); text(result.author.intro, 2000);
      check(Array.isArray(result.posts) && result.posts.length <= count);
      const seen = new Set();
      for (const row of result.posts) { validateRow(row); check(!seen.has(row.token)); seen.add(row.token); }
      if (result.nextCursor !== null) {
        fields(result.nextCursor, ["updatedAt", "token"]); date(result.nextCursor.updatedAt); token(result.nextCursor.token, "invalid_remote_data");
        const last = result.posts.at(-1);
        check(last && last.token === result.nextCursor.token && last.updatedAt === result.nextCursor.updatedAt &&
          (!before || last.token !== before.token || last.updatedAt !== before.updatedAt));
      }
      return result;
    }
    function photoURL(id, photoId) {
      alive(); return connection.url + "/functions/v1/haedo-blog-media?token=" + token(id) + "&photo=" + token(photoId);
    }
    function dispose() { if (disposed) return; disposed = true; for (const controller of controllers) controller.abort(); controllers.clear(); }
    return Object.freeze({ read, list, photoURL, dispose });
  }
  return Object.freeze({ createReader, validatePost, token });
});
