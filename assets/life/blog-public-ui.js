/* Safe public Delta reading, shared with owner preview. No private storage or Auth. */
(function (root, factory) {
  const api = factory(root);
  (root.HaedoLife ||= {}).BlogPublicUI = api;
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root.document?.getElementById("blogContent")) api.start();
})(globalThis, function (root) {
  "use strict";
  const model = () => root.HaedoLife?.Blog || require("./blog.js");
  function render(snapshot, { document = root.document, photoUrl = () => null, allowOriginal = true, privateView = false } = {}) {
    model().validateSnapshot(snapshot);
    const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
    const article = node("article", undefined, "blog-document");
    article.append(node("h1", snapshot.title || "제목 없는 글", "blog-title"));
    if (snapshot.author.name) article.append(node("p", snapshot.author.name, "blog-byline"));
    const photos = new Map(snapshot.photos.map((p) => [p.id, p]));
    let line = document.createDocumentFragment(), list = null, kind = null;
    function finish(attrs = {}) {
      const tag = attrs.header ? "h" + (attrs.header + 1) : attrs.blockquote ? "blockquote" : attrs.list ? "li" : "p";
      const element = node(tag, undefined, "blog-line");
      if (attrs.align) element.classList.add("blog-align-" + attrs.align);
      element.append(line); if (!element.childNodes.length) element.append(node("br"));
      if (attrs.list) {
        if (!list || kind !== attrs.list) { list = node(attrs.list === "ordered" ? "ol" : "ul"); article.append(list); kind = attrs.list; }
        list.append(element);
      } else { article.append(element); list = null; kind = null; }
      line = document.createDocumentFragment();
    }
    for (const op of snapshot.ops) {
      if (typeof op.insert !== "string") {
        if (line.childNodes.length) finish(); list = null; kind = null;
        const photo = photos.get(op.insert.photo.id), figure = node("figure", undefined, "blog-photo"), frame = node("div", undefined, "blog-photo-frame");
        frame.tabIndex = 0; frame.setAttribute("aria-label", "사진 보기");
        const image = node("img"), fallback = node("p", privateView ? "사진을 열지 못했습니다. 모음을 다시 열어 확인해 주세요." : "사진을 열지 못했습니다. 잠시 후 공개 상태를 다시 확인해 주세요.", "blog-photo-error");
        fallback.hidden = true;
        image.alt = op.insert.photo.alt || op.insert.photo.caption || (privateView ? "모음의 사진" : "공개한 사진");
        image.width = photo.width; image.height = photo.height; image.loading = "lazy"; image.decoding = "async"; image.referrerPolicy = "no-referrer"; image.crossOrigin = "anonymous";
        let url = photoUrl(photo);
        try { const parsed = new URL(url); if (!["https:", "blob:"].includes(parsed.protocol)) url = null; } catch (_) { url = null; }
        const expand = node("button", "사진 원본 크기로 보기", "life-button blog-photo-expand"); expand.type = "button"; expand.setAttribute("aria-pressed", "false");
        expand.addEventListener("click", () => {
          const original = frame.classList.toggle("blog-photo-original"); expand.setAttribute("aria-pressed", String(original));
          expand.textContent = original ? "사진 화면에 맞추기" : "사진 원본 크기로 보기";
        });
        const missing = () => { image.hidden = true; image.removeAttribute("src"); fallback.hidden = false; expand.disabled = true; };
        image.addEventListener("error", missing, { once: true });
        if (url) image.src = url; else missing();
        frame.append(image, fallback); figure.append(frame);
        if (op.insert.photo.caption) figure.append(node("figcaption", op.insert.photo.caption));
        if (allowOriginal) figure.append(expand);
        article.append(figure); continue;
      }
      const pieces = op.insert.split("\n");
      pieces.forEach((value, index) => {
        if (value) {
          let text = document.createTextNode(value);
          for (const [attr, tag] of [["bold", "strong"], ["italic", "em"], ["underline", "u"]]) if (op.attributes?.[attr]) { const wrapper = node(tag); wrapper.append(text); text = wrapper; }
          if (op.attributes?.link) {
            const link = node("a"); link.href = op.attributes.link; link.target = "_blank"; link.rel = "noopener noreferrer"; link.referrerPolicy = "no-referrer"; link.append(text); text = link;
          }
          line.append(text);
        }
        if (index < pieces.length - 1) finish(op.attributes);
      });
    }
    if (line.childNodes.length) finish();
    if (snapshot.attachments.length) {
      const attachments = node("section", undefined, "blog-attachments"); attachments.setAttribute("aria-label", "글에 붙인 대상");
      for (const item of snapshot.attachments) {
        const entry = node("p"), label = [item.title, item.creator].filter(Boolean).join(" · ");
        if (item.url) { const link = node("a", label); link.href = item.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.referrerPolicy = "no-referrer"; entry.append(link); }
        else entry.textContent = label;
        attachments.append(entry);
      }
      article.append(attachments);
    }
    return article;
  }
  function start({ document = root.document, window = root, createReader = (options) => root.HaedoLife.BlogPublic.createReader(options) } = {}) {
    const content = document.getElementById("blogContent"), status = document.getElementById("blogStatus"), refresh = document.getElementById("blogRefresh"), backlink = document.getElementById("blogBack"), updated = document.getElementById("blogUpdated");
    let epoch = 0, reader = null, timer = null, serialized = null, pageCount = 1, disposed = false;
    const url = new URL(window.location.href), posts = url.searchParams.getAll("post"), blogs = url.searchParams.getAll("blog");
    let post = null, blog = null;
    try {
      if (posts.length === 1 && blogs.length === 0) post = root.HaedoLife.BlogPublic.token(posts[0]);
      else if (blogs.length === 1 && posts.length === 0) blog = root.HaedoLife.BlogPublic.token(blogs[0]);
    } catch (_) { /* Invalid addresses never produce a network request. */ }
    const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
    const address = (key, value) => { const target = new URL("blog.html", window.location.href); target.searchParams.set(key, value); return target.href; };
    function message(value, state) { status.textContent = value; status.dataset.state = state; }
    function cancel() { clearTimeout(timer); timer = null; epoch++; reader?.dispose(); reader = null; }
    function clear() { content.replaceChildren(); updated.hidden = true; updated.textContent = ""; backlink.hidden = true; serialized = null; document.title = "블로그 · 해도"; }
    function timestamp(value, prefix) {
      const date = new Date(value); return prefix + new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
    }
    function renderList(data) {
      const fragment = document.createDocumentFragment();
      fragment.append(node("h1", data.author.name ? data.author.name + "의 블로그" : "공개 글", "blog-title"));
      if (data.author.intro) fragment.append(node("p", data.author.intro, "blog-intro"));
      if (!data.posts.length) fragment.append(node("p", "아직 공개한 글이 없습니다.", "blog-empty"));
      const list = node("div", undefined, "blog-post-list");
      for (const item of data.posts) {
        const entry = node("article", undefined, "blog-list-entry"), link = node("a", item.title || "제목 없는 글", "blog-post-link"); link.href = address("post", item.token);
        entry.append(link, node("p", item.excerpt, "blog-list-excerpt"), node("p", timestamp(item.createdAt, "발행 "), "blog-date"));
        list.append(entry);
      }
      fragment.append(list);
      if (data.nextCursor) {
        const more = node("button", "이전 글 더 보기", "life-button"); more.type = "button";
        more.addEventListener("click", () => { pageCount++; load({ preserve: true }); }); fragment.append(more);
      }
      content.replaceChildren(fragment); document.title = (data.author.name || "공개 글") + " · 해도";
    }
    async function load({ preserve = false } = {}) {
      if (disposed) return; cancel(); const captured = epoch;
      if (!preserve) clear();
      if (document.hidden) { clear(); message("돌아오면 공개 상태를 다시 확인합니다.", "paused"); return; }
      if (!post && !blog) { clear(); message("블로그 주소를 확인해 주세요.", "missing"); refresh.hidden = true; return; }
      refresh.disabled = true; content.setAttribute("aria-busy", "true"); if (!preserve) message("공개한 글을 확인하고 있습니다…", "loading");
      try {
        reader = createReader({ config: window.HAEDO_CONFIG });
        if (post) {
          const data = await reader.read(post); if (disposed || captured !== epoch || document.hidden) return;
          if (!data) { clear(); message("공개된 글이 없습니다. 공개가 종료됐거나 주소가 바뀌었을 수 있습니다.", "missing"); return; }
          const next = JSON.stringify(data);
          if (next !== serialized || !content.childNodes.length) {
            content.replaceChildren(render(data.snapshot, { document, photoUrl: (photo) => reader.photoURL(post, photo.id) })); serialized = next;
          }
          backlink.href = address("blog", data.blogToken); backlink.hidden = false;
          document.title = (data.snapshot.title || "제목 없는 글") + " · 해도";
          updated.textContent = timestamp(data.createdAt, "발행 ") + " · " + timestamp(data.updatedAt, "갱신 "); updated.hidden = false;
        } else {
          let data, before = null, all = [];
          for (let index = 0; index < pageCount; index++) {
            data = await reader.list(blog, { before }); if (disposed || captured !== epoch || document.hidden) return;
            all.push(...data.posts); before = data.nextCursor; if (!before) break;
          }
          const seen = new Set(); data = { ...data, posts: all.filter((p) => { if (seen.has(p.token)) return false; seen.add(p.token); return true; }) };
          const next = JSON.stringify(data);
          if (next !== serialized || !content.childNodes.length) { renderList(data); serialized = next; }
        }
        message("", "published"); timer = setTimeout(() => load({ preserve: true }), 30000);
      } catch (error) {
        if (disposed || captured !== epoch || document.hidden) return;
        clear(); message(["config_missing", "invalid_config", "schema_missing"].includes(error.code) ? "블로그 연결이 아직 준비되지 않았습니다. 잠시 후 다시 확인해 주세요." : "공개 상태를 확인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.", "error");
      } finally { if (captured === epoch) { content.removeAttribute("aria-busy"); refresh.disabled = false; } }
    }
    const refreshClick = () => load(), hidden = () => { if (document.hidden) { cancel(); clear(); message("돌아오면 공개 상태를 다시 확인합니다.", "paused"); } else load(); };
    const hide = () => { cancel(); clear(); message("공개 상태를 다시 확인합니다.", "paused"); };
    const offline = () => { cancel(); clear(); message("인터넷 연결 후 공개 상태를 다시 확인해 주세요.", "error"); refresh.disabled = false; };
    const show = (event) => { if (event.persisted) load(); }, online = () => load();
    refresh.addEventListener("click", refreshClick); document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("offline", offline); window.addEventListener("online", online);
    load();
    function dispose() {
      if (disposed) return; disposed = true; cancel(); clear();
      refresh.removeEventListener("click", refreshClick); document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("offline", offline); window.removeEventListener("online", online);
    }
    return Object.freeze({ load, dispose });
  }
  return Object.freeze({ render, start });
});
