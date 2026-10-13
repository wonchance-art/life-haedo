/* Shared post body and attachments; optional media belongs to the current view only. */
(function (root) {
  "use strict";
  const life = (root.HaedoLife ||= {});
  let nextBody = 0;
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  function attachments(values, { media = null, compact = false } = {}) {
    life.PagePosts.validateAttachments(values);
    const list = node("div", null, "pp-attachments");
    list.dataset.count = String(values.length);
    list.classList.toggle("pp-attachments-compact", compact);
    for (const item of values) {
      const card = node("section", null, "pp-attachment");
      card.dataset.type = item.type;
      const descriptor = media && life.PageMedia.describe(item),
        visual = node("div", null, "pp-visual"),
        shape = node("span", null, "pp-shape");
      shape.setAttribute("aria-hidden", "true");
      shape.append(
        life.Icons.create(
          {
            person: "user",
            place: "map",
            tool: "workspace",
            book: "book",
            music: "disc",
            film: "play",
            video: "play",
          }[item.type] || "bookmark",
        ),
      );
      visual.append(shape);
      card.append(visual);
      const copy = node("div", null, "pp-attachment-copy"),
        title = node(
          item.url ? "a" : "strong",
          item.title,
          "pp-attachment-title",
        );
      if (item.url) {
        title.href = item.url;
        title.target = "_blank";
        title.rel = "noopener noreferrer";
        title.referrerPolicy = "no-referrer";
        title.setAttribute("aria-label", item.title + " · 출처 열기");
      }
      copy.append(
        title,
        node(
          "span",
          [item.creator, life.Collection.TYPES[item.type]]
            .filter(Boolean)
            .join(" · "),
          "life-meta",
        ),
      );
      const actions = node("div", null, "pp-object-actions");
      if (descriptor) {
        const status = node(
          "span",
          descriptor.provider === "YouTube" ? "연결한 영상" : "Open Library",
          "pp-media-status life-meta",
        );
        const retry = node(
          "button",
          "이미지 다시 시도",
          "life-button pp-image-retry",
        );
        retry.type = "button";
        retry.hidden = true;
        retry.addEventListener("click", () => media.retry(shape));
        media.cover(shape, descriptor, (state) => {
          visual.dataset.mediaState = state;
          status.textContent =
            state === "loading"
              ? "이미지 불러오는 중…"
              : state === "error"
                ? "이미지 없음 · 출처는 유지됩니다."
                : descriptor.provider === "YouTube"
                  ? "연결한 영상"
                  : "Open Library";
          retry.hidden = state !== "error";
        });
        actions.append(status, retry);
        if (descriptor.embed) {
          const play = node("button", "영상 보기", "life-button pp-video-open");
          play.type = "button";
          play.setAttribute("aria-label", item.title + " · 영상 보기");
          play.prepend(life.Icons.create("play"));
          play.addEventListener("click", () =>
            media.video(item, descriptor, play),
          );
          actions.append(play);
        }
      }
      copy.append(actions);
      card.append(copy);
      list.append(card);
    }
    return list;
  }
  function post(value, { media = null, fold = true } = {}) {
    const article = node("article", null, "pp-post");
    article.dataset.postId = value.id || "";
    article.tabIndex = -1;
    if (value.body) {
      const body = node("p", value.body, "pp-body");
      article.append(body);
      if (fold && value.body.length > 600) {
        body.id = "ppBodyRead-" + ++nextBody;
        body.dataset.folded = "true";
        const more = node("button", "더 읽기", "life-button pp-read-more");
        more.type = "button";
        more.setAttribute("aria-controls", body.id);
        more.setAttribute("aria-expanded", "false");
        more.addEventListener("click", () => {
          const expanded = more.getAttribute("aria-expanded") === "true";
          body.dataset.folded = String(expanded);
          more.setAttribute("aria-expanded", String(!expanded));
          more.textContent = expanded ? "더 읽기" : "접기";
          if (expanded) more.scrollIntoView({ block: "nearest" });
        });
        article.append(more);
      }
    }
    if (value.attachments.length)
      article.append(attachments(value.attachments, { media }));
    return article;
  }
  life.PagePostsView = { attachments, post };
})(globalThis);
