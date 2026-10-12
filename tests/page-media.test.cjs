"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const M = require("../assets/life/page-media.js");
test("Page media preserves object types and only embeds the linked YouTube video without tracking or autoplay", () => {
  for (const type of ["music", "film", "video"]) {
    const input = {
        type,
        title: "익명 대상",
        url: "https://youtu.be/M7lc1UVf-VE?si=private#secret",
      },
      before = JSON.stringify(input),
      d = M.describe(input);
    assert.equal(d.label, "연결한 영상 썸네일");
    assert.equal(
      d.embed,
      "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?autoplay=0&playsinline=1&rel=0",
    );
    assert.equal(JSON.stringify(input), before);
  }
  for (const type of ["tool", "person", "artwork", "place"])
    assert.equal(
      M.describe({ type, url: "https://youtu.be/M7lc1UVf-VE" }),
      null,
    );
});
test("Page embed rejects untrusted destinations and reuses checksum-verified book covers", () => {
  for (const url of [
    "http://youtu.be/M7lc1UVf-VE",
    "https://youtube.com.evil.test/watch?v=M7lc1UVf-VE",
    "https://user:password@youtu.be/M7lc1UVf-VE",
    "https://youtu.be:444/M7lc1UVf-VE",
    "https://youtu.be/invalid",
    "javascript:alert(1)",
  ])
    assert.equal(M.describe({ type: "video", url }), null);
  const book = M.describe({
    type: "book",
    url: "https://openlibrary.org/isbn/9780140328721?secret=x",
  });
  assert.equal(book.embed, null);
  assert.equal(book.label, "표지");
  assert(!book.source.includes("secret"));
});
