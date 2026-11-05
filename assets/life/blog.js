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
  const markdown = () => root.HaedoLife?.PostMarkdown || require("./post-markdown.js");
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
  const viewKeys = ["type", "size", "digest", "width", "height"];
  // HEIC/HEIF originals carry `view` (derived JPEG metadata); other types never do.
  const needsView = (photo) => model().viewRequired(photo?.type);
  function placeholder(photo) {
    const blob = new Blob([], { type: typeof photo.type === "string" ? photo.type : "" });
    // Structural validation needs the declared size, without allocating photo-sized buffers.
    Object.defineProperty(blob, "size", { value: photo.size });
    return blob;
  }
  function validateManifest(value) {
    const md = value?.format === "life-post-md-v1", v2 = md || value?.format === "life-photo-post-v2";
    fields(value, ["format", "id", "revision", "title", "status", "replaces", "createdAt", "updatedAt", md ? "markdown" : "ops", "photos", ...(v2 ? ["attachments", "archived"] : [])]);
    check(Array.isArray(value.photos));
    for (const photo of value.photos) {
      fields(photo, needsView(photo) ? [...photoKeys, "view"] : photoKeys);
      if (needsView(photo)) fields(photo.view, viewKeys);
    }
    bytes(value);
    model().validate({ ...value, photos: value.photos.map((photo) => ({ ...photo,
      ...(photo.view ? { view: { ...photo.view, blob: placeholder(photo.view) } } : {}), blob: placeholder(photo) })) });
    return value;
  }
  function pack(doc) {
    model().validate(doc);
    const manifest = { ...copy(doc), photos: doc.photos.map((photo) => copy(model().metadata(photo))) };
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
  const signature = async (blob) => model().detectType(new Uint8Array(await blob.slice(0, 4096).arrayBuffer()));
  // `photos` is a Map id -> Blob | { blob, view }, or an array of photo objects
  // ({ id, blob, view?: { blob } | Blob }). A HEIC view may also come from the
  // same-session pairing that PhotoPost.validate records for its original Blob.
  async function hydrate(input, photos) {
    validateManifest(input);
    const manifest = copy(input), originals = new Map();
    const entries = photos instanceof Map ? [...photos] : Array.isArray(photos) ? photos.map((p) => [p?.id, p]) : [];
    for (const [id, value] of entries) {
      const blob = value instanceof Blob ? value : value?.blob, carried = value instanceof Blob ? undefined : value?.view ?? undefined;
      const view = carried === undefined || carried instanceof Blob ? carried : carried?.blob;
      check(!originals.has(id) && blob instanceof Blob && (view === undefined || view instanceof Blob), "invalid_blog_photo");
      originals.set(id, { blob, view });
    }
    check(originals.size === manifest.photos.length, "invalid_blog_photo");
    for (const photo of manifest.photos) {
      const { blob, view: carried } = originals.get(photo.id) || {};
      check(blob && blob.size === photo.size && blob.type === photo.type, "invalid_blog_photo");
      check(await signature(blob) === photo.type, "invalid_blog_photo");
      check(await model().digest(blob) === photo.digest, "invalid_blog_photo");
      if (needsView(photo)) {
        // The HEIC original is checked by signature and digest only; browsers
        // without a HEVC decoder must still verify and move the exact bytes.
        const view = carried || model().pairedView(blob);
        check(view instanceof Blob && view.size === photo.view.size && view.type === photo.view.type, "invalid_blog_photo");
        check(await signature(view) === "image/jpeg" && await model().digest(view) === photo.view.digest, "invalid_blog_photo");
        const size = await dimensions(view);
        check(!size || (size[0] === photo.view.width && size[1] === photo.view.height), "invalid_blog_photo");
        photo.view.blob = view;
      } else {
        check(!carried, "invalid_blog_photo");
        const size = await dimensions(blob);
        check(!size || (size[0] === photo.width && size[1] === photo.height), "invalid_blog_photo");
      }
      photo.blob = blob;
    }
    model().validate(manifest);
    return manifest;
  }
  // AI authorship marks stay private (owner decision 2026-11-02). A public copy
  // drops only that attribute; text and every other visible format are unchanged. The
  // server publish RPC applies the same rule to the stored document.
  function withoutAuthorship(op) {
    if (!op.attributes || !Object.hasOwn(op.attributes, "author")) return copy(op);
    const { author: _private, ...rest } = op.attributes, next = { insert: copy(op.insert) };
    if (Object.keys(rest).length) next.attributes = copy(rest);
    return next;
  }
  // A private reading copy has the public copy's shape but keeps the owner's
  // AI authorship marks. It is only rendered in the owner's own views; it is
  // never sent, stored or published, and validateSnapshot (public) rejects it.
  const READING_FORMAT = "life-blog-private-reading-v1";
  function validateSnapshot(value) { return checkSnapshot(value, false); }
  function validateReadingSnapshot(value) { return checkSnapshot(value, true); }
  function validationBodyOps(ops) {
    if (ops.length && typeof ops.at(-1)?.insert === "string") return ops;
    // Per-op types, aggregate text size and photo references do not depend on
    // order. Reuse an existing complete line in this validation-only surrogate
    // so a photo-ending body at 5,000 ops/50,000 chars needs no extra allowance.
    const end = ops.findIndex((op) => typeof op.insert === "string" && op.insert.endsWith("\n"));
    return end >= 0 ? [...ops.slice(0, end), ...ops.slice(end + 1), ops[end]] : [...ops, { insert: "\n" }];
  }
  function checkSnapshot(value, reading) {
    const code = "invalid_blog_snapshot";
    fields(value, ["format", "title", "ops", "attachments", "photos", "author"], code);
    check(value.format === (reading ? READING_FORMAT : "life-blog-public-v1"), code);
    if (!reading) check(Array.isArray(value.ops) && value.ops.every((op) => !plain(op?.attributes) || !Object.hasOwn(op.attributes, "author")), code);
    fields(value.author, ["name", "intro"], code);
    text(value.author.name, LIMITS.name, code); text(value.author.intro, LIMITS.intro, code);
    check(Array.isArray(value.photos), code);
    const photos = value.photos.map((photo) => {
      fields(photo, ["id", "type", "width", "height", "size", "digest"], code);
      check(typeof photo.id === "string" && UUID.test(photo.id), code);
      return { ...photo, name: "사진", blob: placeholder(photo) };
    });
    try {
      // Markdown can end with an independent photo, or become empty when every
      // photo is omitted. Validate those reading projections with a temporary
      // terminal paragraph; never add that paragraph to the visible snapshot.
      // Text-ending ops still obey the existing complete-line contract.
      check(Array.isArray(value.ops), code);
      const validationOps = validationBodyOps(value.ops);
      const doc = { ...model().create(() => "public", "2000-01-01T00:00:00.000Z"), title: value.title,
        ops: validationOps, photos, attachments: value.attachments, status: "saved" };
      const used = model().validate(doc);
      check(used.size === photos.length, code);
      bytes(value, code);
    } catch (_) { throw fault(code); }
    return value;
  }
  // `copies` (array or Map of {id,type,size,digest,width,height}) are the
  // metadata-free public copies of the selected photos, one per photo in every
  // format (HEIC/HEIF copies are made from their JPEG view); a selected photo
  // then shows that copy's metadata, exactly as the server publishes it.
  // Without `copies` the projection keeps the original's (or HEIC view's)
  // metadata for private reading only; publication always supplies them.
  function publicSnapshot(doc, options = {}) { return project(doc, options, false); }
  // Owner-only reading (private series view): the same projection, AI marks kept.
  function privateReadingSnapshot(doc, options = {}) { return project(doc, options, true); }
  function project(doc, { photoIds = [], author = { name: "", intro: "" }, copies = null } = {}, reading) {
    model().validate(doc);
    // Markdown remains the private stored source. Public/reading copies keep
    // their established, validated Delta shape, so anonymous readers do not
    // need a new format or a Markdown parser. This is a projection, not a save.
    const ops = doc.format === "life-post-md-v1" ? markdown().toDelta(doc.markdown) : doc.ops;
    check(doc.status === "saved" && !doc.archived, "blog_post_not_saved");
    check(Array.isArray(photoIds) && photoIds.every((id) => typeof id === "string") && new Set(photoIds).size === photoIds.length, "invalid_blog_selection");
    const selected = new Set(photoIds), available = new Set(doc.photos.map((p) => p.id));
    check(photoIds.every((id) => available.has(id)), "invalid_blog_selection");
    const used = new Set(ops.filter((op) => typeof op.insert !== "string").map((op) => op.insert.photo.id));
    check(photoIds.every((id) => used.has(id)), "invalid_blog_selection");
    const crypto = root.crypto || (typeof require === "function" && require("node:crypto").webcrypto);
    const copied = copies === null ? null : new Map((copies instanceof Map ? [...copies.values()] : Array.isArray(copies) ? copies : [null]).map((c) => [c?.id, c]));
    if (copied) {
      check(!copied.has(undefined) && [...copied.keys()].every((id) => selected.has(id)), "invalid_blog_selection");
      for (const p of doc.photos.filter((value) => selected.has(value.id))) {
        const c = copied.get(p.id), bound = needsView(p) ? p.view : p;
        check(!!c && ["image/jpeg", "image/png"].includes(c.type) && c.digest !== p.digest && c.digest !== p.view?.digest && Number.isSafeInteger(c.size) && c.size > 0 &&
          Number.isSafeInteger(c.width) && c.width >= 1 && c.width <= bound.width && Number.isSafeInteger(c.height) && c.height >= 1 && c.height <= bound.height &&
          typeof c.digest === "string" && /^[a-f0-9]{64}$/.test(c.digest), "invalid_blog_selection");
      }
    }
    // Preview image URLs and server publishing both follow this metadata order.
    const selectedPhotos = doc.photos.filter((p) => selected.has(p.id));
    const mapping = new Map(selectedPhotos.map((p) => [p.id, crypto.randomUUID()]));
    const projectOps = (values) => values.filter((op) => typeof op.insert === "string" || selected.has(op.insert.photo.id)).map((op) => typeof op.insert === "string" ? (reading ? copy(op) : withoutAuthorship(op)) :
      { ...copy(op), insert: { photo: { ...copy(op.insert.photo), id: mapping.get(op.insert.photo.id) } } });
    const snapshot = { format: reading ? READING_FORMAT : "life-blog-public-v1", title: doc.title,
      ops: projectOps(ops),
      // An original is never projected publicly when copies are given; the
      // public photo for that position is its copy. A HEIC original is never
      // projected even privately: its JPEG view stands in for it.
      attachments: copy(doc.attachments || []), photos: selectedPhotos.map((p) => {
        const { type, width, height, size, digest } = copied ? copied.get(p.id) : needsView(p) ? p.view : p;
        return { id: mapping.get(p.id), type, width, height, size, digest };
      }), author: copy(author) };
    // Preserve the existing server projection for v1/v2 byte for byte. Markdown
    // enters through toDelta above, then uses the same selection/AI-removal rules.
    // Operation boundaries may differ; never reorder photos or invent paragraphs.
    checkSnapshot(snapshot, reading);
    return snapshot;
  }
  return Object.freeze({ LIMITS, pack, validateManifest, hydrate, publicSnapshot, validateSnapshot, privateReadingSnapshot, validateReadingSnapshot });
});
