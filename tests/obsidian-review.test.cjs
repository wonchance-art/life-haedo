"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const options = {
  repositoryUrl: "https://github.com/example/vault",
  ref: "a".repeat(40),
};
const entry = (path, text) => ({ path, bytes: Buffer.from(text) });
async function fixture() {
  const { buildVault } = await import("../scripts/lib/obsidian-vault.mjs");
  return buildVault(
    [
      entry(
        "from/index.md",
        "[[missing]] [[missing]] [CSV](table.csv) [사진](img.png) [외부](/PostList.naver?blogId=anonymous) [[else/topic]] [[same]] [[target#gone]] [그림](../config.svg)",
      ),
      entry("another.md", "[[missing]]"),
      entry("moved/topic.md", "주제 원본"),
      entry("a/same.md", "A"),
      entry("b/same.md", "B"),
      entry("target.md", "# 실제 제목"),
      entry("config.svg", "<svg/>"),
    ],
    options,
  );
}
test("audit separates informational attachments/external paths/saved files from actionable notes without changing links or raw references", async () => {
  const r = await fixture(),
    s = r.review.summary;
  assert.equal(r.manifest.unresolvedReferences.length, 10);
  assert.equal(r.notesBackup.workspace.links.length, 1);
  assert.deepEqual(s.categories, {
    missing_note: 4,
    ambiguous: 1,
    anchor_missing: 1,
    invalid: 0,
    attachment_missing: 2,
    supporting_file: 1,
    external_relative: 1,
  });
  assert.equal(s.reviewOccurrences, 6);
  assert.equal(s.reviewGroups, 4);
  assert.equal(s.informationalOccurrences, 4);
  const missing = r.review.groups.find((g) => g.target === "missing");
  assert.equal(missing.occurrences.length, 3);
  const stale = r.review.groups.find((g) => g.target === "else/topic");
  assert.deepEqual(stale.candidatePaths, ["moved/topic.md"]);
  const anchor = r.review.groups.find(g => g.category === "anchor_missing");
  assert.deepEqual(anchor.candidatePaths, []);
  assert.equal(anchor.targetPath, 'target.md');
  const ambiguous = r.review.groups.find((g) => g.category === "ambiguous");
  assert.deepEqual(ambiguous.candidatePaths, ["a/same.md", "b/same.md"]);
  assert.equal(
    r.review.informational.find((r) => r.category === "supporting_file")
      .savedPath,
    "config.svg",
  );
  assert(
    r.manifest.unresolvedReferences.every(
      (row) => !Object.hasOwn(row, "category"),
    ),
  );
});
test("review grouping preserves different relative destinations and self anchors; group IDs remain stable across fresh document IDs", async () => {
  const { buildVault } = await import("../scripts/lib/obsidian-vault.mjs");
  const entries = [
    entry("a/from.md", "[[./missing]] [[#gone]]"),
    entry("b/from.md", "[[./missing]] [[#gone]]"),
  ];
  const a = await buildVault(entries, options),
    b = await buildVault(entries, options);
  assert.equal(a.review.summary.reviewGroups, 4);
  assert.deepEqual(
    a.review.groups.map((g) => g.id),
    b.review.groups.map((g) => g.id),
  );
  assert.notEqual(
    a.notesBackup.workspace.workspaceId,
    b.notesBackup.workspace.workspaceId,
  );
});
test("report rendering escapes imported targets and paths, keeps a restrictive CSP and contains no script or external resources", async () => {
  const { classifyReferences, renderReviewHTML } = await import(
    "../scripts/lib/obsidian-review.mjs"
  );
  const r = classifyReferences({
    repositoryUrl: options.repositoryUrl,
    ref: options.ref,
    files: [{ path: "<img src=x onerror=alert(1)>.md", workspace: "notes" }],
    unresolvedReferences: [
      {
        path: "source.md",
        target: "<img src=x onerror=alert(1)>",
        locator: { start: 0, end: 10 },
        reason: "missing",
      },
    ],
  });
  const html = renderReviewHTML(r);
  assert(!/<(?:script|img|iframe|link)\b/i.test(html));
  assert(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert(html.includes("default-src 'none'"));
  assert(html.includes('charset="utf-8"'));
});
test("unknown note suffixes and unsupported relative URLs stay reviewable instead of being treated as absent attachments", async () => {
  const { classifyReferences } = await import(
    "../scripts/lib/obsidian-review.mjs"
  );
  const r = classifyReferences({
    repositoryUrl: options.repositoryUrl,
    ref: options.ref,
    files: [],
    unresolvedReferences: ["x.csv.md", "/custom-endpoint?x=y"].map(
      (target) => ({
        path: "source.md",
        target,
        locator: { start: 0, end: 1 },
        reason: "missing",
      }),
    ),
  });
  assert.equal(r.summary.reviewGroups, 2);
  assert.equal(r.summary.categories.missing_note, 2);
});
