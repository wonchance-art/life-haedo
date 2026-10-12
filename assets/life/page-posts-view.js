/* Structured attachment cards shared by owner, preview and public-copy reading. */
(function (root) {
  "use strict";
  const life = (root.HaedoLife ||= {});
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  function attachments(values) {
    life.PagePosts.validateAttachments(values);
    const list = node("div", null, "pp-attachments");
    for (const item of values) {
      const card = node(item.url ? "a" : "div", null, "pp-attachment");
      card.dataset.type = item.type;
      if (item.url) {
        card.href = item.url;
        card.target = "_blank";
        card.rel = "noopener noreferrer";
        card.referrerPolicy = "no-referrer";
      }
      const shape = node("span", null, "pp-shape");
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
      const copy = node("span", null, "pp-attachment-copy");
      copy.append(
        node("strong", item.title),
        node(
          "span",
          [item.creator, life.Collection.TYPES[item.type]]
            .filter(Boolean)
            .join(" · "),
          "life-meta",
        ),
      );
      card.append(shape, copy);
      if (item.url) card.append(life.Icons.create("arrow"));
      list.append(card);
    }
    return list;
  }
  function post(value) {
    const article = node("article", null, "pp-post");
    article.dataset.postId = value.id || "";
    article.tabIndex = -1;
    if (value.body) article.append(node("p", value.body, "pp-body"));
    if (value.attachments.length)
      article.append(attachments(value.attachments));
    return article;
  }
  life.PagePostsView = { attachments, post };
})(globalThis);
