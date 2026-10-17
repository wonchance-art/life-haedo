/* Authored page posts and detached attachment snapshots; no network or source rewriting. */
(function (root, factory) {
  "use strict";
  const api = factory(root);
  root.HaedoLife ||= {};
  root.HaedoLife.PagePosts = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis, function (root) {
  "use strict";
  const LIMITS = Object.freeze({ posts: 200, attachments: 12, body: 20000 });
  const clone = (value) => structuredClone(value),
    plain = (v) =>
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(v));
  function fail(message) {
    throw Object.assign(new Error(message), { code: "invalid_page_post" });
  }
  function fields(v, keys) {
    if (
      !plain(v) ||
      Reflect.ownKeys(v).some((k) => !keys.includes(k)) ||
      keys.some((k) => !Object.hasOwn(v, k))
    )
      fail("게시물의 형식을 확인해 주세요.");
  }
  function text(v, max) {
    if (
      typeof v !== "string" ||
      v.length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v) ||
      !wellFormed(v)
    )
      fail("게시물의 길이와 문자를 확인해 주세요.");
  }
  function wellFormed(s) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const n = s.charCodeAt(++i);
        if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
      } else if (c >= 0xdc00 && c <= 0xdfff) return false;
    }
    return true;
  }
  function id(v) {
    if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v))
      fail("게시물 식별자를 확인해 주세요.");
  }
  function date(v) {
    if (
      typeof v !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) ||
      v.startsWith("0000") ||
      !Number.isFinite(Date.parse(v)) ||
      new Date(v).toISOString() !== v
    )
      fail("게시물 날짜를 확인해 주세요.");
  }
  function collection() {
    return (
      root.HaedoLife?.Collection ||
      (typeof require === "function" && require("./collection.js"))
    );
  }
  function attachment(value) {
    const c = collection(),
      time = "2000-01-01T00:00:00.000Z";
    const result = {
      type: value.type,
      title: value.title,
      creator: value.creator ?? "",
      url: value.url ?? "",
    };
    c.validateItem({
      id: "attachment",
      ...result,
      note: "",
      tags: [],
      details: {},
      archived: false,
      createdAt: time,
      updatedAt: time,
    });
    if (result.url)
      (
        root.HaedoLife?.Share ||
        (typeof require === "function" && require("./share.js"))
      ).safeURL(result.url);
    text(result.title, 500);
    text(result.creator, 500);
    text(result.url, 2048);
    return result;
  }
  function validateAttachments(values) {
    if (!Array.isArray(values) || values.length > LIMITS.attachments)
      fail("첨부는 12개까지 넣을 수 있습니다.");
    for (const v of values) {
      fields(v, ["type", "title", "creator", "url"]);
      attachment(v);
    }
    return true;
  }
  function validate(posts, ids = new Set(), max = LIMITS.posts) {
    if (!Array.isArray(posts) || posts.length > max)
      fail("게시물과 초안은 200개까지 보관할 수 있습니다.");
    for (const p of posts) {
      fields(p, [
        "id",
        "status",
        "replaces",
        "baseUpdatedAt",
        "body",
        "attachments",
        "visibility",
        "createdAt",
        "updatedAt",
      ]);
      id(p.id);
      if (ids.has(p.id)) fail("중복된 게시물 식별자입니다.");
      ids.add(p.id);
      text(p.body, LIMITS.body);
      date(p.createdAt);
      date(p.updatedAt);
      if (p.updatedAt < p.createdAt) fail("게시물 날짜 순서를 확인해 주세요.");
      if (
        !["draft", "saved"].includes(p.status) ||
        !["private", "page"].includes(p.visibility)
      )
        fail("게시물 상태와 공개 범위를 확인해 주세요.");
      validateAttachments(p.attachments);
      if (p.replaces === null) {
        if (p.baseUpdatedAt !== null) fail("수정 기준을 확인해 주세요.");
      } else {
        id(p.replaces);
        date(p.baseUpdatedAt);
        if (p.replaces === p.id || p.status !== "draft")
          fail("수정할 게시물을 확인해 주세요.");
      }
      if (p.status === "saved" && !p.body.trim() && !p.attachments.length)
        fail("글을 쓰거나 대상을 붙여 주세요.");
    }
    return true;
  }
  function draft(posts, newId, time, targetId = null) {
    validate(posts, new Set(), LIMITS.posts * 2);
    id(newId);
    date(time);
    if (
      posts.filter((p) => p.status === "draft").length >= LIMITS.posts ||
      (!targetId &&
        posts.filter((p) => p.status === "saved").length >= LIMITS.posts)
    )
      fail("게시물과 초안은 200개까지 보관할 수 있습니다.");
    const target = targetId
      ? posts.find((p) => p.id === targetId && p.status === "saved")
      : null;
    if (targetId && !target) fail("수정할 게시물을 찾을 수 없습니다.");
    const result = {
      id: newId,
      status: "draft",
      replaces: target?.id || null,
      baseUpdatedAt: target?.updatedAt || null,
      body: target?.body || "",
      attachments: clone(target?.attachments || []),
      visibility: target?.visibility || "private",
      createdAt: time,
      updatedAt: time,
    };
    validate(posts.concat(result), new Set(), LIMITS.posts * 2);
    return result;
  }
  function finish(posts, draftId, time, { asNew = false } = {}) {
    validate(posts, new Set(), LIMITS.posts + 1);
    date(time);
    const next = clone(posts),
      d = next.find((p) => p.id === draftId && p.status === "draft");
    if (!d) fail("작성 중인 초안을 찾을 수 없습니다.");
    const target =
      d.replaces && !asNew
        ? next.find((p) => p.id === d.replaces && p.status === "saved")
        : null;
    if (
      d.replaces &&
      !asNew &&
      (!target || target.updatedAt !== d.baseUpdatedAt)
    )
      fail(
        "기존 글이 바뀌었습니다. 초안을 유지했으니 새 글로 저장하거나 기존 글을 확인해 주세요.",
      );
    const saved = {
      ...d,
      id: target?.id || d.id,
      status: "saved",
      replaces: null,
      baseUpdatedAt: null,
      createdAt: target?.createdAt || d.createdAt,
      updatedAt: time,
    };
    if (target && time <= target.updatedAt)
      saved.updatedAt = new Date(
        Date.parse(target.updatedAt) + 1,
      ).toISOString();
    const result = next
      .filter((p) => p.id !== d.id && p.id !== target?.id)
      .concat(saved);
    validate(result);
    return { posts: result, id: saved.id };
  }
  function remap(posts, fresh) {
    const ids = new Map();
    for (const p of posts) {
      if (!ids.has(p.id)) ids.set(p.id, fresh());
      if (p.replaces && !ids.has(p.replaces)) ids.set(p.replaces, fresh());
    }
    return posts.map((p) => ({
      ...clone(p),
      id: ids.get(p.id),
      replaces: p.replaces ? ids.get(p.replaces) : null,
    }));
  }
  function title(text) {
    let result = text.slice(0, 500);
    if (/[\uD800-\uDBFF]$/.test(result)) result = result.slice(0, -1);
    return result;
  }
  function publicEntries(posts) {
    validate(posts);
    return posts
      .filter((p) => p.status === "saved" && p.visibility === "page")
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => ({
        title: title(
          p.body.trim().split("\n")[0] || p.attachments[0]?.title || "내 글",
        ),
        pinned: false,
        note: p.body || null,
        parts: [],
        attachments: clone(p.attachments),
      }));
  }
  function draftList(posts) {
    validate(posts);
    if (posts.some((p) => p.status !== "draft"))
      fail("작성 중인 초안만 불러올 수 있습니다.");
  }
  function readDraftBackup(value) {
    fields(value, ["format", "posts"]);
    if (value.format !== "life-page-drafts-v1")
      fail("페이지 초안 파일을 골라 주세요.");
    draftList(value.posts);
    return clone(value.posts);
  }
  function reviewDrafts(posts, incoming) {
    draftList(posts);
    draftList(incoming);
    // Identity, dates and visibility are deliberately excluded. Text, order and URLs are exact.
    const key = (p) => JSON.stringify([
      p.body,
      p.attachments.map((a) => [a.type, a.title, a.creator, a.url]),
    ]);
    const existing = new Set(posts.map(key)),
      seen = new Set();
    return incoming.map((p) => {
      const content = key(p),
        result = { existing: existing.has(content), file: seen.has(content) };
      seen.add(content);
      return result;
    });
  }
  function restoreDrafts(posts, incoming, fresh) {
    draftList(posts);
    draftList(incoming);
    const added = incoming.map((p) => ({
      ...clone(p),
      id: fresh(),
      replaces: null,
      baseUpdatedAt: null,
      visibility: "private",
    }));
    draftList(posts.concat(added));
    return added;
  }
  function changedDrafts(base, current) {
    draftList(base);
    draftList(current);
    const key = (p) => JSON.stringify([
      p.replaces, p.baseUpdatedAt, p.body,
      p.attachments.map((a) => [a.type, a.title, a.creator, a.url]),
      p.visibility, p.createdAt, p.updatedAt,
    ]);
    const originals = new Map(base.map((p) => [p.id, key(p)]));
    return current.filter((p) => originals.get(p.id) !== key(p)).map(clone);
  }
  return Object.freeze({
    LIMITS,
    attachment,
    validateAttachments,
    validate,
    draft,
    finish,
    remap,
    publicEntries,
    readDraftBackup,
    reviewDrafts,
    restoreDrafts,
    changedDrafts,
  });
});
