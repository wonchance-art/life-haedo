"use strict";
exports.fixture = async function () {
  const { buildVault } = await import("../../scripts/lib/obsidian-vault.mjs");
  const { renderReviewHTML } = await import("../../scripts/lib/obsidian-review.mjs");
  const result = await buildVault([
    ["notes/기록.md", "\ufeff😀 [[이전/책]]\r\n[[이전/책]] [[같음]] [[대상#없는 제목]] [그림](없는.jpg)"],
    ["책.md", "# 읽은 책\r\n익명 책 내용\r\n근거 문장 ^proof"],
    ["a/같음.md", "# 첫 후보\n<script>throw new Error('must not run')</script>"],
    ["b/같음.md", "# 둘째 후보\n다른 익명 내용"],
    ["대상.md", "```md\n# 코드 제목\n```\n# 실제 제목\n내용"],
    ["metadata.yaml", "private: anonymous"],
  ].map(([path, text]) => ({ path, bytes: Buffer.from(text) })), {
    repositoryUrl: "https://github.com/example/anonymous", ref: "a".repeat(40), title: "익명 검토",
  });
  return { result, files: {
    "notes.json": Buffer.from(JSON.stringify(result.notesBackup)),
    "supporting-files.json": Buffer.from(JSON.stringify(result.filesBackup)),
    "private-audit.json": Buffer.from(JSON.stringify(result.manifest)),
    "review.json": Buffer.from(JSON.stringify(result.review)),
    "review.html": Buffer.from(renderReviewHTML(result.review)),
    "repository.bundle": Buffer.from("anonymous-byte-preservation-fixture\0"),
  } };
};
exports.input = (files) => ({ notes: files["notes.json"].toString(), supporting: files["supporting-files.json"].toString(),
  audit: files["private-audit.json"].toString(), review: files["review.json"].toString() });
