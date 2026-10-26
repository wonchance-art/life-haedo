/* Private rich-text documents and unchanged original photo bytes. */
(function (root, factory) {
  const api = factory(root);
  (root.HaedoLife ||= {}).PhotoPost = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis, function (root) {
  "use strict";
  const LIMITS = Object.freeze({
    photos: 20,
    file: 64 * 1024 * 1024,
    bytes: 256 * 1024 * 1024,
    text: 50000,
    ops: 5000,
  });
  const fault = (message, code = "invalid_photo_post") =>
    Object.assign(new Error(message), { code });
  const posts = () =>
    root.HaedoLife?.PagePosts ||
    (typeof require === "function" && require("./page-posts.js"));
  function manifest(d) {
    return {
      format:
        d.format === "life-photo-post-v1"
          ? "life-photo-post-backup-v1"
          : "life-photo-post-backup-v2",
      title: d.title,
      ops: d.ops,
      photos: d.photos.map(({ blob, ...metadata }) => metadata),
      ...(d.format === "life-photo-post-v2"
        ? { attachments: d.attachments }
        : {}),
    };
  }
  const plain = (v) =>
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(v));
  function fields(v, keys) {
    if (
      !plain(v) ||
      Object.keys(v).some((k) => !keys.includes(k)) ||
      keys.some((k) => !Object.hasOwn(v, k))
    )
      throw fault("사진 글 형식을 확인해 주세요.");
  }
  function text(v, max) {
    if (
      typeof v !== "string" ||
      v.length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(v)
    )
      throw fault("입력의 문자와 길이를 확인해 주세요.");
  }
  function id(v) {
    if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v))
      throw fault("사진 글 식별자를 확인해 주세요.");
  }
  function revision(v) {
    if (!Number.isSafeInteger(v) || v < 0)
      throw fault("저장 기준을 확인해 주세요.");
  }
  function date(v) {
    if (
      typeof v !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) ||
      !Number.isFinite(Date.parse(v)) ||
      new Date(v).toISOString() !== v
    )
      throw fault("사진 글 날짜를 확인해 주세요.");
  }
  function link(v) {
    text(v, 2048);
    try {
      const u = new URL(v);
      if (
        !["http:", "https:"].includes(u.protocol) ||
        u.username ||
        u.password ||
        /[\s\\]/u.test(v)
      )
        throw 0;
    } catch (_) {
      throw fault("링크는 http 또는 https 주소로 입력해 주세요.");
    }
  }
  function ops(values, photoIds) {
    if (!Array.isArray(values) || !values.length || values.length > LIMITS.ops)
      throw fault("본문 길이를 확인해 주세요.");
    let length = 0;
    const used = new Set();
    for (const op of values) {
      if (
        !plain(op) ||
        Object.keys(op).some((k) => !["insert", "attributes"].includes(k)) ||
        !Object.hasOwn(op, "insert")
      )
        throw fault("지원하지 않는 본문 형식입니다.");
      if (typeof op.insert === "string") {
        text(op.insert, LIMITS.text);
        length += op.insert.length;
      } else {
        fields(op.insert, ["photo"]);
        const p = op.insert.photo;
        fields(p, ["id", "caption", "alt"]);
        id(p.id);
        text(p.caption, 2000);
        text(p.alt, 2000);
        if (!photoIds.has(p.id) || used.has(p.id))
          throw fault("사진 참조가 없거나 중복됐습니다.");
        used.add(p.id);
      }
      if (op.attributes) {
        if (!plain(op.attributes)) throw fault("본문 서식을 확인해 주세요.");
        for (const [key, v] of Object.entries(op.attributes)) {
          if (["bold", "italic", "underline"].includes(key)) {
            if (v !== true) throw fault("본문 서식을 확인해 주세요.");
          } else if (key === "header") {
            if (![1, 2].includes(v)) throw fault("제목 서식을 확인해 주세요.");
          } else if (key === "blockquote") {
            if (v !== true) throw fault("인용 서식을 확인해 주세요.");
          } else if (key === "list") {
            if (!["ordered", "bullet"].includes(v))
              throw fault("목록 서식을 확인해 주세요.");
          } else if (key === "align") {
            if (!["center", "right", "justify"].includes(v))
              throw fault("정렬 서식을 확인해 주세요.");
          } else if (key === "link") link(v);
          else throw fault("지원하지 않는 서식입니다.");
        }
      }
    }
    if (
      length > LIMITS.text ||
      typeof values.at(-1).insert !== "string" ||
      !values.at(-1).insert.endsWith("\n")
    )
      throw fault("본문은 50,000자까지 쓸 수 있습니다.");
    return used;
  }
  function photo(p, withBlob = true) {
    fields(p, [
      "id",
      "name",
      "type",
      "width",
      "height",
      "size",
      "digest",
      ...(withBlob ? ["blob"] : []),
    ]);
    id(p.id);
    text(p.name, 500);
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(p.type) ||
      !Number.isSafeInteger(p.size) ||
      p.size <= 0 ||
      p.size > LIMITS.file ||
      !Number.isSafeInteger(p.width) ||
      p.width < 1 ||
      !Number.isSafeInteger(p.height) ||
      p.height < 1 ||
      !/^[a-f0-9]{64}$/.test(p.digest)
    )
      throw fault("지원하는 원본 사진인지 확인해 주세요.");
    if (
      withBlob &&
      (!(p.blob instanceof Blob) ||
        p.blob.size !== p.size ||
        p.blob.type !== p.type)
    )
      throw fault("원본 사진 파일이 누락됐습니다.");
  }
  function validate(d) {
    const v2 = d?.format === "life-photo-post-v2";
    fields(d, [
      "format",
      "id",
      "revision",
      "title",
      "status",
      "replaces",
      "createdAt",
      "updatedAt",
      "ops",
      "photos",
      ...(v2 ? ["attachments", "archived"] : []),
    ]);
    if (
      !["life-photo-post-v1", "life-photo-post-v2"].includes(d.format) ||
      !["draft", "saved"].includes(d.status)
    )
      throw fault("사진 글 형식을 확인해 주세요.");
    if (v2) {
      if (typeof d.archived !== "boolean")
        throw fault("글의 보관 상태를 확인해 주세요.");
      posts().validateAttachments(d.attachments);
    }
    id(d.id);
    revision(d.revision);
    text(d.title, 500);
    date(d.createdAt);
    date(d.updatedAt);
    if (d.updatedAt < d.createdAt)
      throw fault("사진 글 날짜 순서를 확인해 주세요.");
    if (d.replaces !== null) {
      fields(d.replaces, ["id", "revision"]);
      id(d.replaces.id);
      revision(d.replaces.revision);
      if (d.replaces.id === d.id) throw fault("수정할 글을 확인해 주세요.");
    }
    if (!Array.isArray(d.photos) || d.photos.length > LIMITS.photos)
      throw fault("한 글에 사진은 20장까지 붙일 수 있습니다.");
    const ids = new Set();
    let bytes = 0;
    for (const p of d.photos) {
      photo(p);
      if (ids.has(p.id)) throw fault("중복된 사진 식별자입니다.");
      ids.add(p.id);
      bytes += p.size;
    }
    if (bytes > LIMITS.bytes)
      throw fault(
        "한 글의 원본 사진은 합계 256 MiB까지 보관할 수 있습니다. 해상도는 줄이지 않습니다.",
      );
    const used = ops(d.ops, ids);
    const manifestBytes = new TextEncoder().encode(
      JSON.stringify(manifest(d)),
    ).length;
    if (manifestBytes > 2 * 1024 * 1024)
      throw fault(
        "글과 서식 정보가 너무 큽니다. 내용을 줄인 뒤 다시 저장해 주세요.",
      );
    if (
      d.status === "saved" &&
      !d.title.trim() &&
      !plainText(d).trim() &&
      !used.size &&
      !(d.attachments || []).length
    )
      throw fault("글을 쓰거나 사진을 붙여 주세요.");
    return used;
  }
  const plainText = (d) =>
    d.ops
      .map((op) =>
        typeof op.insert === "string" ? op.insert : op.insert.photo.caption,
      )
      .join("") +
    ((d.attachments || []).length
      ? "\n" +
        d.attachments
          .map((a) => [a.title, a.creator, a.url].filter(Boolean).join(" · "))
          .join("\n")
      : "");
  function create(makeId, time = new Date().toISOString()) {
    return {
      format: "life-photo-post-v2",
      id: makeId(),
      revision: 0,
      title: "",
      status: "draft",
      replaces: null,
      createdAt: time,
      updatedAt: time,
      ops: [{ insert: "\n" }],
      photos: [],
      attachments: [],
      archived: false,
    };
  }
  function upgrade(input) {
    validate(input);
    const d = structuredClone(input);
    if (d.format === "life-photo-post-v1")
      Object.assign(d, {
        format: "life-photo-post-v2",
        attachments: [],
        archived: false,
      });
    return d;
  }
  function compact(d) {
    const used = validate(d),
      next = structuredClone(d);
    next.photos = next.photos.filter((p) => used.has(p.id));
    return next;
  }
  async function digest(blob) {
    return Array.from(
      new Uint8Array(
        await root.crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
  }
  async function readPhoto(file, makeId) {
    if (
      !file ||
      !["", "image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      !file.size ||
      file.size > LIMITS.file
    )
      throw fault(
        "JPEG·PNG·WebP 사진을 골라 주세요. 원본 한 장은 64 MiB까지 보관할 수 있습니다.",
      );
    const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer()),
      s = String.fromCharCode(...signature);
    const detectedType = signature[0] === 255 && signature[1] === 216 && signature[2] === 255
      ? "image/jpeg" : s.startsWith("\x89PNG\r\n\x1a\n") ? "image/png"
        : s.startsWith("RIFF") && s.slice(8) === "WEBP" ? "image/webp" : null;
    if (!detectedType || (file.type && file.type !== detectedType))
      throw fault("사진 내용과 파일 형식이 일치하지 않습니다.");
    // An empty MIME label is supplied by some file providers. The signature
    // determines only the label; Image below must still decode the bytes.
    const original = file.slice(0, file.size, detectedType);
    const url = URL.createObjectURL(original);
    let width, height;
    try {
      [width, height] = await new Promise((resolve, reject) => {
        const img = new Image(),
          timer = setTimeout(() => {
            img.src = "";
            reject(fault("사진을 열지 못했습니다. 원본은 바꾸지 않았습니다."));
          }, 20000);
        img.onload = () => {
          clearTimeout(timer);
          resolve([img.naturalWidth, img.naturalHeight]);
        };
        img.onerror = () => {
          clearTimeout(timer);
          reject(fault("이 브라우저에서 사진을 열지 못했습니다."));
        };
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    const p = {
      id: makeId(),
      name: file.name || "사진",
      type: detectedType,
      width,
      height,
      size: file.size,
      digest: await digest(file),
      blob: original,
    };
    photo(p);
    return p;
  }
  const zip = () =>
    root.fflate ||
    (typeof require === "function" && require("../../vendor/fflate/fflate.js"));
  async function backup(input) {
    const d = compact(input),
      files = {};
    for (const p of d.photos) {
      const { blob } = p;
      files["photos/" + p.id] = new Uint8Array(await blob.arrayBuffer());
    }
    files["manifest.json"] = zip().strToU8(JSON.stringify(manifest(d)));
    return new Blob([zip().zipSync(files, { level: 0 })], {
      type: "application/zip",
    });
  }
  async function readBackup(file, makeId) {
    if (!file || file.size > LIMITS.bytes + 4 * 1024 * 1024)
      throw fault("사진 글 백업 크기를 확인해 주세요.");
    let files;
    const seen = new Set();
    let total = 0;
    try {
      files = zip().unzipSync(new Uint8Array(await file.arrayBuffer()), {
        filter: (entry) => {
          if (
            seen.has(entry.name) ||
            !(
              entry.name === "manifest.json" ||
              /^photos\/[A-Za-z0-9_-]{1,128}$/.test(entry.name)
            )
          )
            throw fault("중복되거나 지원하지 않는 백업 경로입니다.");
          seen.add(entry.name);
          total += entry.originalSize;
          if (
            seen.size > 21 ||
            (entry.name === "manifest.json" &&
              entry.originalSize > 2 * 1024 * 1024) ||
            total > LIMITS.bytes + 2 * 1024 * 1024
          )
            throw fault("백업의 펼친 크기가 너무 큽니다.");
          return true;
        },
      });
    } catch (e) {
      throw fault(
        e.code === "invalid_photo_post"
          ? e.message
          : "사진 글 ZIP 백업을 읽지 못했습니다.",
      );
    }
    let m;
    try {
      m = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          files["manifest.json"],
        ),
      );
    } catch (_) {
      throw fault("사진 글 백업의 내용을 확인해 주세요.");
    }
    const v2 = m?.format === "life-photo-post-backup-v2";
    fields(m, [
      "format",
      "title",
      "ops",
      "photos",
      ...(v2 ? ["attachments"] : []),
    ]);
    if (
      !["life-photo-post-backup-v1", "life-photo-post-backup-v2"].includes(
        m.format,
      ) ||
      !Array.isArray(m.photos) ||
      m.photos.length > 20 ||
      Object.keys(files).length !== m.photos.length + 1
    )
      throw fault("사진 글 전용 백업 파일인지 확인해 주세요.");
    const d = create(makeId),
      ids = new Map();
    d.title = m.title;
    d.ops = m.ops;
    d.attachments = v2 ? structuredClone(m.attachments) : [];
    const oldIds = new Set();
    for (const p of m.photos) {
      photo(p, false);
      if (oldIds.has(p.id)) throw fault("중복된 사진입니다.");
      oldIds.add(p.id);
      const data = files["photos/" + p.id];
      if (!data || data.length !== p.size)
        throw fault("원본 사진 파일이 누락됐습니다.");
      const blob = new Blob([data], { type: p.type });
      if ((await digest(blob)) !== p.digest)
        throw fault("원본 사진의 내용이 백업 정보와 다릅니다.");
      const next = { ...p, id: makeId(), blob };
      ids.set(p.id, next.id);
      d.photos.push(next);
    }
    ops(d.ops, oldIds);
    d.ops = structuredClone(d.ops).map((op) =>
      typeof op.insert === "string"
        ? op
        : {
            ...op,
            insert: {
              photo: { ...op.insert.photo, id: ids.get(op.insert.photo.id) },
            },
          },
    );
    validate(d);
    return d;
  }
  return Object.freeze({
    LIMITS,
    create,
    upgrade,
    validate,
    compact,
    plainText,
    readPhoto,
    digest,
    backup,
    readBackup,
  });
});
