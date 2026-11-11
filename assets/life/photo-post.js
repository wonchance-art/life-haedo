/* Private rich-text documents, unchanged original photo bytes and
 * metadata-free public copies. */
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
    // Long edge of the derived JPEG for HEIC/HEIF originals. iOS canvases
    // fail above ~16.7M pixels, and 4096 keeps 4:3 and 1:1 views within it.
    viewEdge: 4096,
  });
  const ORIGINAL_TYPES = Object.freeze([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ]);
  const HEIC_TYPES = new Set(["image/heic", "image/heif"]);
  const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
  // HEIC/HEIF originals keep their exact bytes; every display path uses the
  // derived JPEG in `view`. Other types never carry a view.
  const viewRequired = (type) => HEIC_TYPES.has(type);
  const HEIC_UNSUPPORTED =
    "이 브라우저에서는 HEIC 보기용 사본을 만들 수 없습니다. iPhone·iPad에서 추가해 주세요.";
  const fault = (message, code = "invalid_photo_post") =>
    Object.assign(new Error(message), { code });
  const posts = () =>
    root.HaedoLife?.PagePosts ||
    (typeof require === "function" && require("./page-posts.js"));
  const markdown = () => root.HaedoLife?.PostMarkdown ||
    (typeof require === "function" && require("./post-markdown.js"));
  const isMarkdown = (d) => d?.format === "life-post-md-v1";
  // Projection only: Markdown stays the sole persisted body in the new format.
  const contentOps = (d) => isMarkdown(d) ? markdown().toDelta(d.markdown) : d.ops;
  function remapBody(d, ids) {
    if (isMarkdown(d)) return { markdown: markdown().remapPhotos(d.markdown, ids) };
    return { ops: structuredClone(d.ops).map(op => {
      if (typeof op.insert === "string") return op;
      const next = ids.get(op.insert.photo.id);
      if (typeof next !== "string") throw fault("사진 참조를 옮기지 못했습니다.");
      return { ...op, insert: { photo: { ...op.insert.photo, id: next } } };
    }) };
  }
  // Serializable photo fields: removes the original and the view Blob while
  // keeping key order, so non-HEIC manifests stay byte-identical.
  function metadata(p) {
    const { blob, ...rest } = p;
    if (rest.view) {
      const { blob: viewBlob, ...view } = rest.view;
      rest.view = view;
    }
    return rest;
  }
  // Same-session pairing of a validated original Blob with its view Blob, so
  // callers that pass only `photo.blob` to Blog.hydrate after Blog.pack(doc)
  // keep working. Hydrate still verifies size, digest and dimensions.
  const pairs = new WeakMap();
  const pairedView = (blob) =>
    blob && typeof blob === "object" ? pairs.get(blob) : undefined;
  function manifest(d) {
    return {
      format:
        isMarkdown(d) ? "life-post-md-backup-v1" : d.format === "life-photo-post-v1"
          ? "life-photo-post-backup-v1"
          : "life-photo-post-backup-v2",
      title: d.title,
      ...(isMarkdown(d) ? { markdown: d.markdown } : { ops: d.ops }),
      photos: d.photos.map(metadata),
      ...(d.format === "life-photo-post-v2" || isMarkdown(d)
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
  // `field` names the input in the refusal, so the writer knows which one to fix.
  function text(v, max, field) {
    if (
      typeof v !== "string" ||
      v.length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(v)
    )
      throw fault(field && typeof v === "string" && v.length > max
        ? field + "은 " + max + "자까지 쓸 수 있습니다. 줄여 주세요."
        : (field ? field + "의 " : "입력의 ") + "문자와 길이를 확인해 주세요.");
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
  function ops(values, photoIds, markdownBody = false) {
    if (!Array.isArray(values) || !values.length)
      throw fault("본문 길이를 확인해 주세요.");
    if (values.length > LIMITS.ops)
      throw fault("본문 길이를 확인해 주세요. 서식 조각이 5,000개를 넘었습니다. 서식이 섞인 부분을 줄여 주세요.");
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
        // Characters only: the length is the whole body's, reported once below.
        text(op.insert, Infinity, "본문");
        length += op.insert.length;
      } else {
        fields(op.insert, ["photo"]);
        const p = op.insert.photo;
        fields(p, ["id", "caption", "alt"]);
        id(p.id);
        text(p.caption, 2000, "사진 설명");
        text(p.alt, 2000, "사진 대체 텍스트");
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
          else if (key === "author") {
            // Private authorship mark for text the owner brought from an AI
            // tool. Only "ai" exists; unmarked text is the owner's own.
            if (v !== "ai" || typeof op.insert !== "string")
              throw fault("AI 글 표시를 확인해 주세요.");
          } else throw fault("지원하지 않는 서식입니다.");
        }
      }
    }
    if (length > LIMITS.text)
      throw fault(
        "본문은 50,000자까지 쓸 수 있습니다. 지금 " +
          length.toLocaleString("ko-KR") + "자입니다. 줄여 주세요.",
      );
    if (!markdownBody && (typeof values.at(-1).insert !== "string" ||
      !values.at(-1).insert.endsWith("\n")))
      throw fault("지원하지 않는 본문 형식입니다.");
    return used;
  }
  function photo(p, withBlob = true) {
    const heic = plain(p) && viewRequired(p.type);
    fields(p, [
      "id",
      "name",
      "type",
      "width",
      "height",
      "size",
      "digest",
      ...(heic ? ["view"] : []),
      ...(withBlob ? ["blob"] : []),
    ]);
    id(p.id);
    text(p.name, 500);
    if (
      !ORIGINAL_TYPES.includes(p.type) ||
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
    if (heic) checkView(p, withBlob);
  }
  function checkView(p, withBlob) {
    const v = p.view;
    fields(v, [
      "type",
      "size",
      "digest",
      "width",
      "height",
      ...(withBlob ? ["blob"] : []),
    ]);
    if (
      v.type !== "image/jpeg" ||
      !Number.isSafeInteger(v.size) ||
      v.size <= 0 ||
      v.size > LIMITS.file ||
      !Number.isSafeInteger(v.width) ||
      v.width < 1 ||
      v.width > Math.min(p.width, LIMITS.viewEdge) ||
      !Number.isSafeInteger(v.height) ||
      v.height < 1 ||
      v.height > Math.min(p.height, LIMITS.viewEdge) ||
      !/^[a-f0-9]{64}$/.test(v.digest)
    )
      throw fault("HEIC 사진의 보기용 사본 정보를 확인해 주세요.");
    if (withBlob) {
      if (
        !(v.blob instanceof Blob) ||
        v.blob.size !== v.size ||
        v.blob.type !== v.type
      )
        throw fault("HEIC 사진의 보기용 사본 파일이 누락됐습니다.");
      pairs.set(p.blob, v.blob);
    }
  }
  function inspect(d) {
    if (typeof d?.format === "string" &&
        !["life-photo-post-v1", "life-photo-post-v2", "life-post-md-v1"].includes(d.format))
      throw fault("새 형식의 글입니다. 새로고침한 뒤 다시 열어 주세요.", "photo_post_update_required");
    const md = isMarkdown(d);
    const v2 = d?.format === "life-photo-post-v2" || md;
    fields(d, [
      "format",
      "id",
      "revision",
      "title",
      "status",
      "replaces",
      "createdAt",
      "updatedAt",
      md ? "markdown" : "ops",
      "photos",
      ...(v2 ? ["attachments", "archived"] : []),
    ]);
    if (
      !["life-photo-post-v1", "life-photo-post-v2", "life-post-md-v1"].includes(d.format) ||
      !["draft", "saved"].includes(d.status)
    )
      throw fault("사진 글 형식을 확인해 주세요.");
    if (v2) {
      if (typeof d.archived !== "boolean")
        throw fault("글의 숨김 상태를 확인해 주세요.");
      posts().validateAttachments(d.attachments);
    }
    id(d.id);
    revision(d.revision);
    text(d.title, 500, "제목");
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
      bytes += p.size + (p.view ? p.view.size : 0);
    }
    if (bytes > LIMITS.bytes)
      throw fault(
        "한 글의 원본 사진은 합계 256 MiB까지 보관할 수 있습니다. 해상도는 줄이지 않습니다.",
      );
    let bodyOps = d.ops;
    if (md) {
      text(d.markdown, 1024 * 1024, "본문");
      const parsed = markdown().parse(d.markdown);
      if (parsed.markdown !== d.markdown)
        throw fault("본문을 편집기에서 다시 확인한 뒤 저장해 주세요.");
      bodyOps = parsed.ops;
    }
    const used = ops(bodyOps, ids, md);
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
      !plainTextFromOps(d, bodyOps).trim() &&
      !used.size &&
      !(d.attachments || []).length
    )
      throw fault("글을 쓰거나 사진을 붙여 주세요.");
    return { used, bodyOps };
  }
  // Both APIs perform every document/media/body validation. Projection callers
  // can reuse the decoded body without reparsing or caching private Markdown.
  function validate(d) { return inspect(d).used; }
  function validatedBody(d) { return inspect(d).bodyOps; }
  const plainTextFromOps = (d, bodyOps) =>
    bodyOps
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
  const plainText = (d) => plainTextFromOps(d, contentOps(d));
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
  // ---- Input cleaning and normalization ------------------------------------
  // The editor accepts more than a stored post may hold. These functions are
  // the one place that turns accepted input into the stored form, so a draft
  // is never refused for something the editor let the writer do. They know
  // the Delta document only, not the editor that produced it.
  const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u;
  // Vertical tab and form feed are the manual line breaks of Word and
  // PowerPoint clipboards: a line break in the body, a space in one-line
  // fields. Other control characters and unpaired surrogates carry no text.
  function cleanText(value, lineBreaks = true) {
    if (typeof value !== "string") return "";
    if (!UNSAFE_TEXT.test(value)) return value;
    return value
      .replace(/[\u000b\u000c]/g, lineBreaks ? "\n" : " ")
      .replace(/[\u0000-\u0008\u000e-\u001f\u007f]/g, "")
      .replace(/[\uD800-\uDFFF]/gu, "");
  }
  // An address typed without a scheme is an https address. Returns the
  // address validation accepts, or null when it is not an http(s) address.
  function safeLink(value) {
    if (typeof value !== "string") return null;
    let v = value.trim();
    if (!v) return null;
    if (!/^https?:\/\//i.test(v)) {
      // "example.com:8080/x" names a port, not a scheme.
      if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[^\s/?#:@]+:\d{1,5}(?:[/?#]|$)/.test(v))
        return null;
      v = (v.startsWith("//") ? "https:" : "https://") + v;
      try {
        const host = new URL(v).hostname;
        if (!host.includes(".") && host !== "localhost") return null;
      } catch (_) {
        return null;
      }
    }
    try {
      link(v);
    } catch (_) {
      return null;
    }
    return v;
  }
  // Nearest supported form of one op's attributes. `note(kind)` records a
  // change; a kind names one the writer should be told about.
  function normalAttributes(attributes, isText, note) {
    if (attributes == null) return null;
    if (!plain(attributes)) {
      note("format");
      return null;
    }
    const out = {};
    for (const [key, v] of Object.entries(attributes)) {
      if (v == null || v === false) {
        note();
        continue;
      }
      if (["bold", "italic", "underline", "blockquote"].includes(key)) {
        if (v !== true) note();
        out[key] = true;
      } else if (key === "header") {
        const level = Number(v);
        if (level === 1 || level === 2) {
          if (v !== level) note();
          out.header = level;
        } else {
          note("format");
          if (Number.isInteger(level) && level >= 3 && level <= 6) out.header = 2;
        }
      } else if (key === "list") {
        if (v === "ordered" || v === "bullet") out.list = v;
        else if (v === "checked" || v === "unchecked") {
          note("checklist");
          out.list = "bullet";
        } else note("format");
      } else if (key === "align") {
        if (["center", "right", "justify"].includes(v)) out.align = v;
        else note(v === "left" || v === "" ? undefined : "format");
      } else if (key === "link") {
        const safe = safeLink(v);
        if (safe) {
          if (safe !== v) note();
          out.link = safe;
        } else note("link");
      } else if (key === "author") {
        if (v === "ai" && isText) out.author = "ai";
        else note("format");
      } else note("format");
    }
    return Object.keys(out).length ? out : null;
  }
  const sameAttributes = (a, b) => {
    const x = a || {}, y = b || {}, keys = Object.keys(x);
    return keys.length === Object.keys(y).length && keys.every((k) => x[k] === y[k]);
  };
  // The document in the form validation accepts, when one exists: unsupported
  // formats become the nearest supported one, characters a post cannot hold
  // are cleaned, photos the body no longer uses are left out (the editor keeps
  // them for undo). Lengths are never cut: a document over a limit stays over
  // it and is reported by validate(). `changes` lists what the writer should
  // be told; `changed` is true when the body or title differs at all.
  function normalize(input) {
    if (!plain(input) || isMarkdown(input) || !Array.isArray(input.ops))
      return { doc: input, changes: [], changed: false };
    const changes = new Set();
    let changed = false;
    const note = (kind) => {
      changed = true;
      if (kind) changes.add(kind);
    };
    const all = Array.isArray(input.photos) ? input.photos : [];
    const known = new Set(all.map((p) => p?.id)),
      used = new Set(),
      out = [];
    const push = (insert, attributes) => out.push(attributes ? { insert, attributes } : { insert });
    for (const op of input.ops) {
      if (!plain(op) || !Object.hasOwn(op, "insert")) {
        note("format");
        continue;
      }
      if (Object.keys(op).some((k) => k !== "insert" && k !== "attributes")) note();
      if (typeof op.insert === "string") {
        const value = cleanText(op.insert);
        if (value !== op.insert) note("chars");
        if (value) push(value, normalAttributes(op.attributes, true, note));
        continue;
      }
      const p = plain(op.insert) ? op.insert.photo : null;
      if (!plain(p) || typeof p.id !== "string" || !known.has(p.id) || used.has(p.id)) {
        note("embed");
        continue;
      }
      used.add(p.id);
      const caption = cleanText(typeof p.caption === "string" ? p.caption : ""),
        alt = cleanText(typeof p.alt === "string" ? p.alt : "", false);
      if (caption !== p.caption || alt !== p.alt) note("chars");
      else if (Object.keys(op.insert).length !== 1 || Object.keys(p).length !== 3) note();
      push({ photo: { id: p.id, caption, alt } }, normalAttributes(op.attributes, false, note));
    }
    const last = out.at(-1);
    if (!last || typeof last.insert !== "string" || !last.insert.endsWith("\n")) {
      // Every stored body ends with a line break (the editor's own form).
      push("\n", null);
      changed = true;
    }
    const title = cleanText(typeof input.title === "string" ? input.title : "", false);
    if (title !== input.title) note("chars");
    // A body that needed nothing keeps its exact ops (a copy or a backup of a
    // stored post is the same document). Only a mapped body is compacted, the
    // way the editor itself joins text that now carries the same formats.
    let body = input.ops;
    if (changed) {
      body = [];
      for (const op of out) {
        const last = body.at(-1);
        if (last && typeof op.insert === "string" && typeof last.insert === "string" && sameAttributes(last.attributes, op.attributes))
          last.insert += op.insert;
        else body.push(op);
      }
    }
    return {
      doc: { ...input, title, ops: body, photos: all.filter((p) => used.has(p?.id)) },
      changes: [...changes],
      changed,
    };
  }
  // One status line for what normalize() changed.
  const CHANGE_NOTES = {
    checklist: "체크 목록은 글머리 목록으로 바꿨어요",
    chars: "쓸 수 없는 문자를 뺐어요",
    link: "주소가 아닌 링크는 풀었어요",
    format: "지원하지 않는 서식은 풀었어요",
    embed: "넣을 수 없는 항목은 뺐어요",
  };
  function describeChanges(changes) {
    const notes = (changes || []).map((kind) => CHANGE_NOTES[kind]).filter(Boolean);
    return notes.length > 1 ? "지원하지 않는 서식·문자를 정리했어요" : notes[0] || "";
  }
  // What the title, body and attachments hold, for comparing two documents.
  const contentKey = (d) =>
    JSON.stringify([d.title, normalize(d).doc.ops, d.attachments || []]);
  const isEmpty = (d) =>
    !String(d.title || "").trim() &&
    !(d.attachments || []).length &&
    contentOps(d).every((op) => typeof op.insert === "string" && !op.insert.trim());
  // ---- Device-only recovery copies ------------------------------------------
  // What the editor holds, written without validation and synchronously to
  // this browser only, for the moments the draft itself cannot be stored: the
  // content is over a limit, the store failed, or the page is closing before
  // autosave ran. Text, formats and photo references only; photo bytes stay in
  // the stored draft. One copy per account, workspace and draft: `scope` is the
  // signed-in account, so another account in the same browser never reads it
  // (its workspaces are other ids as well). Never synced, never public.
  const RECOVERY_PREFIX = "haedo_life_post_recovery_v1:";
  const MOVED_PREFIX = "haedo_life_post_moved_v1:";
  const KEY_PART = /^[A-Za-z0-9_-]{1,128}$/;
  function recovery(store, scope = "local") {
    if (!KEY_PART.test(scope || "")) store = null;
    const key = (ws, postId) =>
      KEY_PART.test(ws || "") && KEY_PART.test(postId || "") ? RECOVERY_PREFIX + scope + ":" + ws + ":" + postId : null;
    function parse(ws, postId, raw) {
      try {
        const v = JSON.parse(raw);
        if (!plain(v) || v.v !== 1 || v.account !== scope || v.workspaceId !== ws || v.id !== postId ||
            typeof v.title !== "string" || !Array.isArray(v.ops) || !Array.isArray(v.attachments) ||
            !Number.isSafeInteger(v.revision) || typeof v.savedAt !== "string" ||
            !(v.replaces === null || plain(v.replaces) && typeof v.replaces.id === "string"))
          return null;
        return v;
      } catch (_) {
        return null;
      }
    }
    return {
      // True only when the copy is durably written.
      write(ws, d) {
        const k = key(ws, d?.id);
        if (!k || !store) return false;
        try {
          store.setItem(k, JSON.stringify({
            v: 1, account: scope, workspaceId: ws, id: d.id, revision: d.revision,
            replaces: d.replaces ? { id: d.replaces.id, revision: d.replaces.revision } : null,
            savedAt: new Date().toISOString(), title: String(d.title ?? ""),
            ops: (Array.isArray(d.ops) ? d.ops : []).map((op) =>
              plain(op?.insert) && plain(op.insert.photo)
                ? { ...op, insert: { photo: { id: op.insert.photo.id, caption: op.insert.photo.caption || "", alt: op.insert.photo.alt || "" } } }
                : op),
            attachments: Array.isArray(d.attachments) ? d.attachments : [],
          }));
          return true;
        } catch (_) {
          return false;
        }
      },
      read(ws, postId) {
        const k = key(ws, postId);
        if (!k || !store) return null;
        try {
          const raw = store.getItem(k);
          return raw === null ? null : parse(ws, postId, raw);
        } catch (_) {
          return null;
        }
      },
      clear(ws, postId) {
        const k = key(ws, postId);
        try {
          if (k && store) store.removeItem(k);
        } catch (_) {}
      },
      // Newest first.
      list(ws) {
        const found = [];
        if (!store || !KEY_PART.test(ws || "")) return found;
        try {
          const prefix = RECOVERY_PREFIX + scope + ":" + ws + ":";
          for (let i = 0; i < store.length; i++) {
            const k = store.key(i);
            if (!k?.startsWith(prefix)) continue;
            const copy = parse(ws, k.slice(prefix.length), store.getItem(k));
            if (copy) found.push(copy);
          }
        } catch (_) {}
        return found.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      },
    };
  }
  // Saving a revision gives the post a new id. This device remembers which id
  // took an old one's place (identifiers only), so an address kept from before
  // the edit still opens the post.
  function moved(store, scope = "local") {
    if (!KEY_PART.test(scope || "")) store = null;
    const name = (ws) => MOVED_PREFIX + scope + ":" + ws;
    const read = (ws) => {
      try {
        const v = JSON.parse(store.getItem(name(ws)) || "{}");
        return plain(v) ? v : {};
      } catch (_) {
        return {};
      }
    };
    return {
      record(ws, from, to) {
        if (!store || ![ws, from, to].every((v) => KEY_PART.test(v || "")) || from === to) return;
        try {
          const entries = Object.entries(read(ws)).filter(([k]) => k !== from);
          entries.push([from, to]);
          store.setItem(name(ws), JSON.stringify(Object.fromEntries(entries.slice(-300))));
        } catch (_) {}
      },
      // The id that now stands for `postId`, or null when none is recorded.
      resolve(ws, postId) {
        if (!store || !KEY_PART.test(ws || "") || !KEY_PART.test(postId || "")) return null;
        const map = read(ws);
        let at = postId;
        for (let hops = 0; hops < 300 && typeof map[at] === "string" && KEY_PART.test(map[at]); hops++)
          at = map[at];
        return at === postId ? null : at;
      },
    };
  }
  async function digest(blob) {
    return Array.from(
      new Uint8Array(
        await root.crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
  }
  // Type from content only. HEIF: `ftyp` box with a HEVC-coded brand. A plain
  // mif1/msf1 file counts only when it lists a HEVC brand, so AVIF is refused.
  function detectType(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    const s = (from, to) => String.fromCharCode(...b.subarray(from, to));
    if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255)
      return "image/jpeg";
    if (b.length >= 8 && s(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
    if (b.length >= 12 && s(0, 4) === "RIFF" && s(8, 12) === "WEBP")
      return "image/webp";
    if (b.length >= 16 && s(4, 8) === "ftyp") {
      const size = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
      if (size < 16 || size % 4 || size > b.length) return null;
      const major = s(8, 12),
        compatible = [];
      for (let at = 16; at + 4 <= size; at += 4) compatible.push(s(at, at + 4));
      if (HEIC_BRANDS.has(major)) return "image/heic";
      if (
        (major === "mif1" || major === "msf1") &&
        compatible.some((brand) => HEIC_BRANDS.has(brand))
      )
        return "image/heif";
    }
    return null;
  }
  const head = async (blob) =>
    new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  function loadImage(url, message) {
    return new Promise((resolve, reject) => {
      const img = new Image(),
        timer = setTimeout(() => {
          img.src = "";
          reject(fault(message || "사진을 열지 못했습니다. 원본은 바꾸지 않았습니다."));
        }, 20000);
      img.onload = () => {
        clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(fault(message || "이 브라우저에서 사진을 열지 못했습니다."));
      };
      img.src = url;
    });
  }
  // HEIC decoding holds a full-resolution bitmap (48 MP ≈ 190 MB). One at a
  // time keeps several selected iPhone photos from exhausting tab memory.
  let heicQueue = Promise.resolve();
  function oneHeicAtATime(task) {
    const result = heicQueue.then(task, task);
    heicQueue = result.catch(() => {});
    return result;
  }
  async function decodeImage(blob, message = HEIC_UNSUPPORTED, code = "heic_unsupported") {
    if (typeof root.createImageBitmap === "function") {
      try {
        // The default orientation applies HEIF irot/imir and EXIF rotation.
        const bitmap = await root.createImageBitmap(blob);
        if (bitmap.width > 0 && bitmap.height > 0)
          return {
            image: bitmap,
            width: bitmap.width,
            height: bitmap.height,
            close: () => bitmap.close?.(),
          };
        bitmap.close?.();
      } catch (_) {}
    }
    if (typeof root.Image !== "function" || !root.URL?.createObjectURL)
      throw fault(message, code);
    const url = root.URL.createObjectURL(blob);
    try {
      const img = await loadImage(url, message);
      if (!img.naturalWidth || !img.naturalHeight) throw 0;
      return {
        image: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        close: () => root.URL.revokeObjectURL(url),
      };
    } catch (_) {
      root.URL.revokeObjectURL(url);
      throw fault(message, code);
    }
  }
  // Canvas re-encoding writes pixels only: no EXIF, GPS, XMP or text chunks.
  // JPEG has no alpha, so transparent regions become white, not black.
  async function encodeImage(image, width, height, type = "image/jpeg", message = HEIC_UNSUPPORTED, quality = 0.9, code = "heic_unsupported") {
    const paint = (ctx) => {
      if (!ctx) throw fault(message, code);
      if (type === "image/jpeg") {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, width, height);
    };
    const options = type === "image/jpeg" ? quality : undefined;
    if (root.document?.createElement) {
      const canvas = root.document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      try {
        paint(canvas.getContext("2d"));
        return await new Promise((resolve, reject) =>
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(fault(message, code))),
            type,
            options,
          ),
        );
      } finally {
        // iOS keeps canvas backing stores until they are shrunk.
        canvas.width = canvas.height = 0;
      }
    }
    if (typeof root.OffscreenCanvas === "function") {
      const canvas = new root.OffscreenCanvas(width, height);
      paint(canvas.getContext("2d"));
      return canvas.convertToBlob(
        type === "image/jpeg" ? { type, quality } : { type },
      );
    }
    throw fault(message, code);
  }
  const encodeJpeg = (image, width, height) => encodeImage(image, width, height);
  // Returns the displayed size of the original and a derived JPEG. The HEIC
  // bytes themselves are never rewritten.
  function makeView(original) {
    return oneHeicAtATime(async () => {
      const source = await decodeImage(original);
      try {
        const scale = Math.min(
          1,
          LIMITS.viewEdge / Math.max(source.width, source.height),
        );
        const width = Math.max(1, Math.min(LIMITS.viewEdge, Math.round(source.width * scale))),
          height = Math.max(1, Math.min(LIMITS.viewEdge, Math.round(source.height * scale)));
        const blob = await encodeJpeg(source.image, width, height);
        if (
          !(blob instanceof Blob) ||
          blob.type !== "image/jpeg" ||
          !blob.size ||
          blob.size > LIMITS.file ||
          detectType(await head(blob)) !== "image/jpeg"
        )
          throw fault(HEIC_UNSUPPORTED, "heic_unsupported");
        return {
          width: source.width,
          height: source.height,
          view: {
            type: "image/jpeg",
            size: blob.size,
            digest: await digest(blob),
            width,
            height,
            blob,
          },
        };
      } finally {
        source.close();
      }
    });
  }
  // Public copies (2026-11-02 owner decision): every published photo is a
  // canvas re-encoding with EXIF rotation applied, so camera, time and
  // location metadata never leave the private original. JPEG and opaque WebP
  // become JPEG (quality 0.9); PNG and transparent WebP become lossless PNG.
  // Animated PNG/WebP publish their first frame only; the dialog says so.
  const COPY_FAILED =
    "이 브라우저에서 공개용 사진 사본을 만들지 못했습니다. 원본은 그대로 두었습니다.";
  const COPY_TYPES = Object.freeze(["image/jpeg", "image/png"]);
  async function chunkWalk(blob, from, read) {
    // Reads only chunk headers until `read` returns true or the file ends.
    let at = from;
    while (at + 8 <= blob.size) {
      const header = new Uint8Array(await blob.slice(at, at + 8).arrayBuffer());
      if (header.length < 8) return;
      const next = await read(header, at);
      if (next === true || next === undefined || next <= at) return;
      at = next;
    }
  }
  // Alpha and animation of an original, from its bytes (headers only).
  async function imageTraits(blob) {
    const type = detectType(await head(blob));
    const traits = { type, alpha: false, animated: false };
    if (type === "image/png") {
      await chunkWalk(blob, 8, async (h, at) => {
        const length = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0,
          name = String.fromCharCode(...h.subarray(4, 8));
        if (name === "IHDR") {
          const data = new Uint8Array(await blob.slice(at + 8, at + 8 + 13).arrayBuffer());
          if (data[9] === 4 || data[9] === 6) traits.alpha = true;
        } else if (name === "tRNS") traits.alpha = true;
        else if (name === "acTL") traits.animated = true;
        else if (name === "IDAT" || name === "IEND") return true;
        return at + 12 + length;
      });
    } else if (type === "image/webp") {
      await chunkWalk(blob, 12, async (h, at) => {
        const name = String.fromCharCode(...h.subarray(0, 4)),
          length = (h[4] | (h[5] << 8) | (h[6] << 16) | (h[7] << 24)) >>> 0;
        const data = new Uint8Array(await blob.slice(at + 8, at + 8 + Math.min(length, 16)).arrayBuffer());
        if (name === "VP8X") {
          if (data[0] & 0x10) traits.alpha = true;
          if (data[0] & 0x02) traits.animated = true;
        } else if (name === "VP8L") {
          if ((data[4] >> 4) & 1) traits.alpha = true;
          return true;
        } else if (name === "ALPH") traits.alpha = true;
        else if (name === "ANIM" || name === "ANMF") traits.animated = true;
        else if (name === "VP8 ") return true;
        return at + 8 + length + (length & 1);
      });
    }
    return traits;
  }
  const copyType = (traits) =>
    traits.type === "image/png" || (traits.type === "image/webp" && traits.alpha)
      ? "image/png"
      : "image/jpeg";
  // Byte-level allow list of a public copy. The same rules run in the
  // haedo-blog-media Edge function (supabase/functions/haedo-blog-media):
  // a copy is uploaded only when `publicBytes` would change nothing.
  // JPEG: SOI, SOF, DHT, DQT, DRI, SOS, EOI, APP0 JFIF (16-byte, no
  // thumbnail), APP2 ICC (profile signature), APP14 Adobe (14-byte). PNG:
  // IHDR, PLTE, IDAT, IEND, tRNS, gAMA, cHRM, sRGB, iCCP (name/method/zlib
  // header), pHYs. Everything else (EXIF/XMP/IPTC/comments, Apple iDOT and
  // minimal Exif from ImageIO, text, time, animation, trailing bytes) is
  // removed. ICC profile contents are checked structurally only.
  const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "pHYs"]);
  const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
  const bytesAre = (b, from, value) =>
    from + value.length <= b.length && [...value].every((c, i) => b[from + i] === c.charCodeAt(0));
  function jpegSegment(b, marker, at, length) {
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
  function jpegParts(b) {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    const keep = [b.subarray(0, 2)];
    let at = 2, dropped = false;
    while (at < b.length) {
      if (b[at] !== 0xff) return null;
      const start = at;
      while (at < b.length && b[at] === 0xff) at++;
      if (at >= b.length) return null;
      const marker = b[at++];
      if (marker === 0xd9) {
        keep.push(b.subarray(start, at));
        return { keep, dropped: dropped || at !== b.length };
      }
      if (at + 2 > b.length) return null;
      const length = (b[at] << 8) | b[at + 1];
      if (length < 2 || at + length > b.length) return null;
      const end = at + length;
      if (jpegSegment(b, marker, at, length)) keep.push(b.subarray(start, end));
      else if (marker === 0xda) return null;
      else dropped = true;
      at = end;
      if (marker === 0xda) {
        // Entropy-coded data with stuffed 0xFF00, restart markers and fill bytes.
        const scan = at;
        while (at < b.length) {
          if (b[at] !== 0xff) { at++; continue; }
          const next = b[at + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { at += 2; continue; }
          if (next === 0xff) { at++; continue; }
          break;
        }
        keep.push(b.subarray(scan, at));
      }
    }
    return null;
  }
  function iccpValid(b, from, length) {
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
  function pngParts(b) {
    if (b.length < 8 || PNG_SIGNATURE.some((v, i) => b[i] !== v)) return null;
    const keep = [b.subarray(0, 8)];
    let at = 8, dropped = false;
    while (at + 12 <= b.length) {
      const length = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0,
        name = String.fromCharCode(...b.subarray(at + 4, at + 8)), end = at + 12 + length;
      if (end > b.length || (at === 8) !== (name === "IHDR")) return null;
      if (PNG_KEEP.has(name) && (name !== "iCCP" || iccpValid(b, at + 8, length))) keep.push(b.subarray(at, end));
      else dropped = true;
      at = end;
      if (name === "IEND") return { keep, dropped: dropped || at !== b.length };
    }
    return null;
  }
  const parts = (type, b) => (type === "image/jpeg" ? jpegParts(b) : type === "image/png" ? pngParts(b) : null);
  const asBytes = (bytes) => (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  // The allow-listed bytes of a JPEG/PNG, or null when the structure is broken.
  function publicBytes(type, bytes) {
    const found = parts(type, asBytes(bytes));
    if (!found) return null;
    const out = new Uint8Array(found.keep.reduce((n, part) => n + part.length, 0));
    let at = 0;
    for (const part of found.keep) { out.set(part, at); at += part.length; }
    return out;
  }
  function metadataFree(type, bytes) {
    const found = parts(type, asBytes(bytes));
    return !!found && !found.dropped;
  }
  // Re-encoding an image that already is canvas output can return the same
  // bytes. A copy must still be a separate object, so such a PNG gains an
  // sRGB chunk (canvas output is sRGB) and such a JPEG is encoded at 0.89
  // (different quantization tables). Neither adds personal metadata.
  const CRC = Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  function pngChunk(name, data) {
    const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = name.charCodeAt(i);
    out.set(data, 8);
    let crc = 0xffffffff;
    for (const byte of out.subarray(4, 8 + data.length)) crc = CRC[(crc ^ byte) & 255] ^ (crc >>> 8);
    view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
    return out;
  }
  function distinctPng(b) {
    const names = new Set();
    for (let at = 8; at + 12 <= b.length; ) {
      const length = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
      names.add(String.fromCharCode(...b.subarray(at + 4, at + 8)));
      at += 12 + length;
    }
    const chunk = !names.has("sRGB") && !names.has("iCCP") ? pngChunk("sRGB", new Uint8Array([0]))
      : !names.has("pHYs") ? pngChunk("pHYs", new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 0])) : null;
    if (!chunk) throw fault(COPY_FAILED, "public_copy_failed");
    const ihdrEnd = 8 + 12 + (((b[8] << 24) | (b[9] << 16) | (b[10] << 8) | b[11]) >>> 0), out = new Uint8Array(b.length + chunk.length);
    out.set(b.subarray(0, ihdrEnd));
    out.set(chunk, ihdrEnd);
    out.set(b.subarray(ihdrEnd), ihdrEnd + chunk.length);
    return out;
  }
  function checkPublicCopy(p, copy) {
    const bound = p.view || p;
    if (
      !plain(copy) ||
      copy.id !== p.id ||
      !COPY_TYPES.includes(copy.type) ||
      (viewRequired(p.type) && copy.type !== "image/jpeg") ||
      !Number.isSafeInteger(copy.size) ||
      copy.size <= 0 ||
      copy.size > LIMITS.file ||
      !Number.isSafeInteger(copy.width) ||
      copy.width < 1 ||
      copy.width > Math.min(bound.width, LIMITS.viewEdge) ||
      !Number.isSafeInteger(copy.height) ||
      copy.height < 1 ||
      copy.height > Math.min(bound.height, LIMITS.viewEdge) ||
      !/^[a-f0-9]{64}$/.test(copy.digest) ||
      copy.digest === p.digest ||
      copy.digest === p.view?.digest ||
      !(copy.blob instanceof Blob) ||
      copy.blob.size !== copy.size ||
      copy.blob.type !== copy.type
    )
      throw fault("공개용 사진 사본 정보를 확인해 주세요.");
    return copy;
  }
  // `photo` is a validated document photo with its Blob. Every format gets a
  // separate copy: JPEG/PNG/WebP from the original, HEIC/HEIF from their
  // JPEG view (decodable everywhere, already upright). The canvas output is
  // then reduced to the allow list above, so platform encoders that add
  // their own Exif or iDOT (Apple ImageIO) still publish clean bytes.
  async function publicCopy(p) {
    photo(p);
    const heic = viewRequired(p.type), source = heic ? p.view : p;
    const traits = heic ? { type: "image/jpeg", alpha: false, animated: false } : await imageTraits(p.blob);
    if (traits.type !== source.type) throw fault(COPY_FAILED, "public_copy_failed");
    const type = copyType(traits), avoid = new Set([p.digest, p.view?.digest].filter(Boolean));
    return oneHeicAtATime(async () => {
      const decoded = await decodeImage(source.blob, COPY_FAILED, "public_copy_failed");
      try {
        // The decoder must show the same upright picture the editor showed.
        if (decoded.width !== source.width || decoded.height !== source.height)
          throw fault(
            "이 브라우저에서 사진 방향을 확인하지 못했습니다. 원본은 그대로 두었습니다.",
            "public_copy_failed",
          );
        const scale = Math.min(1, LIMITS.viewEdge / Math.max(source.width, source.height));
        const width = Math.max(1, Math.min(LIMITS.viewEdge, Math.round(source.width * scale))),
          height = Math.max(1, Math.min(LIMITS.viewEdge, Math.round(source.height * scale)));
        const encode = async (quality) => {
          const blob = await encodeImage(decoded.image, width, height, type, COPY_FAILED, quality, "public_copy_failed");
          if (!(blob instanceof Blob) || blob.type !== type || !blob.size || blob.size > LIMITS.file)
            throw fault(COPY_FAILED, "public_copy_failed");
          const bytes = publicBytes(type, new Uint8Array(await blob.arrayBuffer()));
          if (!bytes) throw fault(COPY_FAILED, "public_copy_failed");
          return bytes;
        };
        const hash = (bytes) => digest(new Blob([bytes]));
        let bytes = await encode(0.9);
        if (avoid.has(await hash(bytes)))
          bytes = type === "image/png" ? distinctPng(bytes) : await encode(0.89);
        const blob = new Blob([bytes], { type }), value = await hash(bytes);
        if (avoid.has(value) || !metadataFree(type, bytes) || detectType(bytes.subarray(0, 16)) !== type)
          throw fault(COPY_FAILED, "public_copy_failed");
        return checkPublicCopy(p, { id: p.id, type, size: blob.size, digest: value, width, height, blob, animated: traits.animated });
      } finally {
        decoded.close();
      }
    });
  }
  async function readPhoto(file, makeId) {
    if (
      !file ||
      !["", ...ORIGINAL_TYPES].includes(file.type) ||
      !file.size ||
      file.size > LIMITS.file
    )
      throw fault(
        "JPEG·PNG·WebP·HEIC 사진을 골라 주세요. 원본 한 장은 64 MiB까지 보관할 수 있습니다.",
      );
    const detectedType = detectType(await head(file));
    if (
      !detectedType ||
      (file.type &&
        file.type !== detectedType &&
        !(viewRequired(file.type) && viewRequired(detectedType)))
    )
      throw fault("사진 내용과 파일 형식이 일치하지 않습니다.");
    // An empty MIME label is supplied by some file providers. The signature
    // determines only the label; the decoder below must still open the bytes.
    const original = file.slice(0, file.size, detectedType);
    let width, height, derived;
    if (viewRequired(detectedType)) {
      derived = await makeView(original);
      ({ width, height } = derived);
    } else {
      const url = URL.createObjectURL(original);
      try {
        const img = await loadImage(url);
        [width, height] = [img.naturalWidth, img.naturalHeight];
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const p = {
      id: makeId(),
      name: file.name || "사진",
      type: detectedType,
      width,
      height,
      size: file.size,
      digest: await digest(file),
      ...(derived ? { view: derived.view } : {}),
      blob: original,
    };
    photo(p);
    return p;
  }
  const zip = () =>
    root.fflate ||
    (typeof require === "function" && require("../../vendor/fflate/fflate.js"));
  // `lenient` writes what the editor holds even when it cannot be stored (over
  // a limit): a file of the writer's own input must not depend on validation.
  async function backup(input, { lenient = false } = {}) {
    const d = lenient ? normalize(input).doc : compact(input),
      files = {};
    for (const p of d.photos) {
      const { blob } = p;
      files["photos/" + p.id] = new Uint8Array(await blob.arrayBuffer());
      if (p.view)
        files["views/" + p.id] = new Uint8Array(await p.view.blob.arrayBuffer());
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
              /^(photos|views)\/[A-Za-z0-9_-]{1,128}$/.test(entry.name)
            )
          )
            throw fault("중복되거나 지원하지 않는 백업 경로입니다.");
          seen.add(entry.name);
          total += entry.originalSize;
          if (
            seen.size > 2 * LIMITS.photos + 1 ||
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
    const md = m?.format === "life-post-md-backup-v1";
    const v2 = m?.format === "life-photo-post-backup-v2" || md;
    fields(m, [
      "format",
      "title",
      md ? "markdown" : "ops",
      "photos",
      ...(v2 ? ["attachments"] : []),
    ]);
    if (
      !["life-photo-post-backup-v1", "life-photo-post-backup-v2", "life-post-md-backup-v1"].includes(
        m.format,
      ) ||
      !Array.isArray(m.photos) ||
      m.photos.length > 20
    )
      throw fault("사진 글 전용 백업 파일인지 확인해 주세요.");
    const d = create(makeId),
      ids = new Map();
    d.title = m.title;
    if (md) {
      d.format = "life-post-md-v1";
      delete d.ops;
      d.markdown = m.markdown;
      text(d.markdown, 1024 * 1024, "본문");
      if (markdown().canonicalize(d.markdown) !== d.markdown)
        throw fault("백업 본문 형식을 확인해 주세요. 원래 파일은 유지했습니다.");
    } else d.ops = m.ops;
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
      let viewBlob = null;
      if (p.view) {
        const viewData = files["views/" + p.id];
        if (!viewData || viewData.length !== p.view.size)
          throw fault("HEIC 사진의 보기용 사본 파일이 누락됐습니다.");
        viewBlob = new Blob([viewData], { type: p.view.type });
        if (
          detectType(viewData.subarray(0, 16)) !== "image/jpeg" ||
          (await digest(viewBlob)) !== p.view.digest
        )
          throw fault("보기용 사본의 내용이 백업 정보와 다릅니다.");
      }
      const next = {
        ...p,
        id: makeId(),
        ...(viewBlob ? { view: { ...p.view, blob: viewBlob } } : {}),
        blob,
      };
      ids.set(p.id, next.id);
      d.photos.push(next);
    }
    if (
      Object.keys(files).length !==
      1 + m.photos.length + m.photos.filter((p) => p.view).length
    )
      throw fault("사진 글 전용 백업 파일인지 확인해 주세요.");
    ops(contentOps(d), oldIds, md);
    Object.assign(d, remapBody(d, ids));
    validate(d);
    return d;
  }
  return Object.freeze({
    LIMITS,
    create,
    upgrade,
    validate,
    validatedBody,
    cleanText,
    safeLink,
    normalize,
    describeChanges,
    contentKey,
    isEmpty,
    recovery,
    moved,
    compact,
    plainText,
    contentOps,
    remapBody,
    readPhoto,
    detectType,
    viewRequired,
    imageTraits,
    publicCopy,
    checkPublicCopy,
    publicBytes,
    metadataFree,
    metadata,
    pairedView,
    digest,
    backup,
    readBackup,
  });
});
