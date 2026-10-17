/* Private document transport and explicit public projections. No storage or network. */
(function (root, factory) {
  const api = factory(root);
  (root.HaedoLife ||= {}).Blog = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis, function (root) {
  "use strict";
  const LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, name: 500, intro: 2000 });
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const model = () => root.HaedoLife?.PhotoPost || require("./photo-post.js");
  const fault = (code = "invalid_blog_document") => Object.assign(new Error("글의 형식과 사진 원본을 확인해 주세요."), { code });
  const check = (value, code) => { if (!value) throw fault(code); };
  const plain = (value) => value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const copy = (value) => structuredClone(value);
  function fields(value, keys, code) {
    check(plain(value) && Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)), code);
  }
  function text(value, limit, code) {
    check(typeof value === "string" && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(value), code);
  }
  function bytes(value, code) { check(new TextEncoder().encode(JSON.stringify(value)).length <= LIMITS.bytes, code); }
  const photoKeys = ["id", "name", "type", "width", "height", "size", "digest"];
  function placeholder(photo) {
    const blob = new Blob([], { type: typeof photo.type === "string" ? photo.type : "" });
    // Structural validation needs the declared size, without allocating photo-sized buffers.
    Object.defineProperty(blob, "size", { value: photo.size });
    return blob;
  }
  function validateManifest(value) {
    const v2 = value?.format === "life-photo-post-v2";
    fields(value, ["format", "id", "revision", "title", "status", "replaces", "createdAt", "updatedAt", "ops", "photos", ...(v2 ? ["attachments", "archived"] : [])]);
    check(Array.isArray(value.photos));
    for (const photo of value.photos) fields(photo, photoKeys);
    bytes(value);
    model().validate({ ...value, photos: value.photos.map((photo) => ({ ...photo, blob: placeholder(photo) })) });
    return value;
  }
  function pack(doc) {
    model().validate(doc);
    const manifest = { ...copy(doc), photos: doc.photos.map(({ blob, ...metadata }) => copy(metadata)) };
    validateManifest(manifest);
    return manifest;
  }
  async function dimensions(blob) {
    if (typeof root.createImageBitmap === "function") {
      const image = await root.createImageBitmap(blob);
      try { return [image.width, image.height]; } finally { image.close(); }
    }
    if (typeof root.Image !== "function" || !root.URL?.createObjectURL) return null;
    const url = root.URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const image = new root.Image(), timer = setTimeout(() => { image.src = ""; reject(fault("invalid_blog_photo")); }, 20000);
        image.onload = () => { clearTimeout(timer); resolve([image.naturalWidth, image.naturalHeight]); };
        image.onerror = () => { clearTimeout(timer); reject(fault("invalid_blog_photo")); };
        image.src = url;
      });
    } finally { root.URL.revokeObjectURL(url); }
  }
  async function hydrate(input, photos) {
    validateManifest(input);
    const manifest = copy(input), originals = new Map();
    const entries = photos instanceof Map ? [...photos] : Array.isArray(photos) ? photos.map((p) => [p?.id, p?.blob]) : [];
    for (const [id, blob] of entries) {
      check(!originals.has(id) && blob instanceof Blob, "invalid_blog_photo"); originals.set(id, blob);
    }
    check(originals.size === manifest.photos.length, "invalid_blog_photo");
    for (const photo of manifest.photos) {
      const blob = originals.get(photo.id);
      check(blob && blob.size === photo.size && blob.type === photo.type, "invalid_blog_photo");
      const signature = new Uint8Array(await blob.slice(0, 12).arrayBuffer()), s = String.fromCharCode(...signature);
      check((photo.type === "image/jpeg" && signature[0] === 255 && signature[1] === 216 && signature[2] === 255) ||
        (photo.type === "image/png" && s.startsWith("\x89PNG\r\n\x1a\n")) ||
        (photo.type === "image/webp" && s.startsWith("RIFF") && s.slice(8) === "WEBP"), "invalid_blog_photo");
      check(await model().digest(blob) === photo.digest, "invalid_blog_photo");
      const size = await dimensions(blob);
      check(!size || (size[0] === photo.width && size[1] === photo.height), "invalid_blog_photo");
      photo.blob = blob;
    }
    model().validate(manifest);
    return manifest;
  }
  function validateSnapshot(value) {
    const code = "invalid_blog_snapshot";
    fields(value, ["format", "title", "ops", "attachments", "photos", "author"], code);
    check(value.format === "life-blog-public-v1", code);
    fields(value.author, ["name", "intro"], code);
    text(value.author.name, LIMITS.name, code); text(value.author.intro, LIMITS.intro, code);
    check(Array.isArray(value.photos), code);
    const photos = value.photos.map((photo) => {
      fields(photo, ["id", "type", "width", "height", "size", "digest"], code);
      check(typeof photo.id === "string" && UUID.test(photo.id), code);
      return { ...photo, name: "사진", blob: placeholder(photo) };
    });
    try {
      const doc = { ...model().create(() => "public", "2000-01-01T00:00:00.000Z"), title: value.title,
        ops: value.ops, photos, attachments: value.attachments, status: "saved" };
      const used = model().validate(doc);
      check(used.size === photos.length, code);
      bytes(value, code);
    } catch (_) { throw fault(code); }
    return value;
  }
  function publicSnapshot(doc, { photoIds = [], author = { name: "", intro: "" } } = {}) {
    model().validate(doc);
    check(doc.status === "saved" && !doc.archived, "blog_post_not_saved");
    check(Array.isArray(photoIds) && photoIds.every((id) => typeof id === "string") && new Set(photoIds).size === photoIds.length, "invalid_blog_selection");
    const selected = new Set(photoIds), available = new Set(doc.photos.map((p) => p.id));
    check(photoIds.every((id) => available.has(id)), "invalid_blog_selection");
    const used = new Set(doc.ops.filter((op) => typeof op.insert !== "string").map((op) => op.insert.photo.id));
    check(photoIds.every((id) => used.has(id)), "invalid_blog_selection");
    const crypto = root.crypto || (typeof require === "function" && require("node:crypto").webcrypto);
    const mapping = new Map(doc.photos.filter((p) => selected.has(p.id)).map((p) => [p.id, crypto.randomUUID()]));
    const snapshot = { format: "life-blog-public-v1", title: doc.title,
      ops: doc.ops.filter((op) => typeof op.insert === "string" || selected.has(op.insert.photo.id)).map((op) => typeof op.insert === "string" ? copy(op) :
        { ...copy(op), insert: { photo: { ...copy(op.insert.photo), id: mapping.get(op.insert.photo.id) } } }),
      attachments: copy(doc.attachments || []), photos: doc.photos.filter((p) => selected.has(p.id)).map(({ id, type, width, height, size, digest }) =>
        ({ id: mapping.get(id), type, width, height, size, digest })), author: copy(author) };
    validateSnapshot(snapshot);
    return snapshot;
  }
  return Object.freeze({ LIMITS, pack, validateManifest, hydrate, publicSnapshot, validateSnapshot });
});
