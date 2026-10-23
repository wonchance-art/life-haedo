"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const Core = require("../assets/life/core.js");
const Markdown = require("../assets/life/source-markdown.js");
const Edit = require("../assets/life/source-edit.js");
const Decisions = require("../assets/life/obsidian-decisions.js");

// Anonymous data only. Preserve mixed line endings and two identical body
// passages so a formatted projection cannot silently rebind an old quote.
const raw = "\uFEFF---\r\n"
  + 'title: "속성 제목"\r\n'
  + "date: 2026-01-02\r\n"
  + "tags:\r\n  - 익명태그\r\n"
  + 'related:\r\n  - "[[대상#절]]"\r\n  - "[[이전/후보]]"\r\n  - "[[미확인]]"\r\n'
  + "---\r\n\r\n# 본문 제목\r\n\r\n반복 **문장** 😀\r\n\r\n반복 **문장** 😀\r";
const targetRaw = "---\r\ntitle: 목적 속성\r\n---\r\n# 절\r\n목적 원문";
const digest = (text) => createHash("sha256").update(text).digest("hex");
const clone = (value) => structuredClone(value);
const rangeOf = (text, token, last = false) => {
  const start = last ? text.lastIndexOf(token) : text.indexOf(token);
  assert.ok(start >= 0);
  return { start, end: start + token.length };
};

async function fixture() {
  const { buildVault } = await import("../scripts/lib/obsidian-vault.mjs");
  const result = await buildVault([
    ["notes/익명기록.md", raw], ["대상.md", targetRaw], ["후보.md", "# 후보\n선택 대상"],
  ].map(([path, text]) => ({ path, bytes: Buffer.from(text) })), {
    repositoryUrl: "https://github.com/example/anonymous", ref: "a".repeat(40), title: "익명 검토",
  });
  const bundle = result.notesBackup.workspace;
  const source = bundle.sources.find((item) => item.sourceKey === "notes/익명기록.md");
  const version = bundle.sourceVersions.find((item) => item.sourceId === source.id);
  return { result, bundle, source, version };
}

function packageInput(result, notes = result.notesBackup) {
  return { notes: JSON.stringify(notes), supporting: JSON.stringify(result.filesBackup),
    audit: JSON.stringify(result.manifest), review: JSON.stringify(result.review) };
}

function assertProperties(text) {
  const prepared = Markdown.prepare(text);
  assert.equal(prepared.formatted, true);
  assert.match(prepared.html, /<details\b[^>]*\bclass="[^"]*\bsource-properties\b[^"]*"/);
  assert.match(prepared.html, /<dl\b/);
  const body = prepared.html.slice(prepared.html.indexOf("</details>") + "</details>".length);
  assert.doesNotMatch(body, /속성 제목|익명태그|2026-01-02|related:|title:/);
  assert.match(body, /<h1\b[^>]*>본문 제목<\/h1>/);
  return prepared;
}

// Restore deliberately assigns fresh IDs. Compare exact version bytes/hashes,
// source paths and ranges rather than mistaking those new IDs for data loss.
function referenceValue(bundle, ref) {
  const source = bundle.sources.find((item) => item.id === ref.sourceId);
  const version = bundle.sourceVersions.find((item) => item.id === ref.sourceVersionId);
  assert.ok(source && version);
  return { path: source.sourceKey, hash: version.contentHash, raw: version.contentText,
    locator: ref.locator, selected: ref.locator
      ? version.contentText.slice(ref.locator.start, ref.locator.end) : null };
}
function relatedValues(bundle) {
  return bundle.links.filter((link) => link.kind === "obsidian_link")
    .map((link) => ({ note: link.note, refs: link.sourceRefs.map((ref) => referenceValue(bundle, ref)) }));
}
function quoteValues(bundle) {
  return bundle.records.map((record) => ({ kind: record.kind, text: record.text,
    topic: record.topic, note: record.note,
    refs: record.sourceRefs.map((ref) => referenceValue(bundle, ref)) }));
}

test("properties project imported Markdown without promoting YAML or changing original bytes, metadata or audit", async () => {
  const { result, bundle, source, version } = await fixture(), before = clone(result);
  assertProperties(version.contentText);
  assert.equal(Markdown.prepare(targetRaw).formatted, true);
  assert.deepEqual(result, before);
  assert.equal(source.title, "익명기록");
  assert.equal(source.sourceKey, "notes/익명기록.md");
  assert.equal(version.contentText, raw);
  assert.deepEqual(Buffer.from(version.contentText), Buffer.from(raw));
  assert.equal(version.contentHash, digest(raw));
  assert.equal(version.originalCreatedAt, null);
  assert.deepEqual(version.originalAuthor, { label: "", relation: "unknown" });
  assert.equal(Object.hasOwn(source, "tags"), false);
  assert.equal(Object.hasOwn(version, "tags"), false);
  assert.deepEqual(bundle.records, []);
  assert.equal(bundle.links.length, 1);
  const entry = result.manifest.files.find((file) => file.path === source.sourceKey);
  assert.equal(entry.sha256, digest(raw));
  assert.equal(entry.bytes, Buffer.byteLength(raw));
});

test("existing related links and unresolved ranges survive projection; only an explicit decision adds a connection", async () => {
  const { result, bundle, version } = await fixture();
  const original = clone(bundle), audit = clone(result.manifest), review = clone(result.review);
  const oldLink = clone(bundle.links[0]);
  assert.deepEqual(oldLink.sourceRefs[0].locator, rangeOf(raw, "[[대상#절]]"));
  assert.deepEqual(oldLink.sourceRefs[1].locator, rangeOf(targetRaw, "# 절"));
  assertProperties(version.contentText);
  const handle = await Decisions.openPackage(packageInput(result));
  const candidate = handle.items.find((item) => item.target === "이전/후보");
  const missing = handle.items.find((item) => item.target === "미확인");
  assert.deepEqual(candidate.locator, rangeOf(raw, "[[이전/후보]]"));
  assert.deepEqual(missing.locator, rangeOf(raw, "[[미확인]]"));
  assert.deepEqual(candidate.candidatePaths, ["후보.md"]);
  assert.deepEqual(missing.candidatePaths, []);
  assert.deepEqual(bundle, original);
  const decisions = Decisions.makeDecisions(handle, [
    { id: candidate.id, targetPath: "후보.md", targetLocator: null },
  ]);
  assert.deepEqual(Decisions.preview(handle, decisions).summary,
    { added: 1, located: 0, unchanged: 0, deferred: 1, informational: 0 });
  const applied = await Decisions.apply(handle, decisions), next = applied.notesBackup.workspace;
  assert.deepEqual(next.sources, original.sources);
  assert.deepEqual(next.sourceVersions, original.sourceVersions);
  assert.deepEqual(next.links.slice(0, -1), original.links);
  assert.equal(next.links.length, original.links.length + 1);
  assert.deepEqual(next.links.at(-1).sourceRefs[0].locator, rangeOf(raw, "[[이전/후보]]"));
  assert.equal(next.links.at(-1).note, "이전/후보");
  assert.equal(next.links.some((link) => link.note === "미확인"), false);
  assert.deepEqual(result.manifest, audit);
  assert.deepEqual(result.review, review);
  assert.deepEqual(bundle, original);
  const restored = await Core.restoreBackup(applied.notesBackup);
  assert.notEqual(restored.workspaceId, next.workspaceId);
  assert.deepEqual(relatedValues(restored), relatedValues(next));
});

test("explicit header/body edits keep old property/body quotes and related evidence through immutable versions and backup restore", async () => {
  const { bundle: imported, source, version } = await fixture();
  const importedSnapshot = clone(imported);
  const prepared = await Core.prepareImport({ origin: source.origin, title: source.title,
    existingSourceId: source.id, url: source.url, text: version.contentText, format: version.format,
    author: version.originalAuthor.label, authorRelation: version.originalAuthor.relation,
    originalCreatedAt: version.originalCreatedAt, coverage: version.coverage }, imported);
  assert.equal(prepared.version.id, version.id);
  const quotes = [
    { ...rangeOf(raw, "속성 제목"), topic: "속성 근거", note: "원문 속성 값" },
    { ...rangeOf(raw, "반복 **문장** 😀", true), topic: "본문 근거", note: "두 번째 동일 문장" },
  ];
  const bundle = Core.applyChanges(imported, Core.buildImportChanges(imported, prepared, quotes));
  assert.equal(bundle.sourceVersions.length, imported.sourceVersions.length);
  const before = clone(bundle);
  assertProperties(version.contentText);
  const titleOnly = await Edit.prepare(bundle, Edit.edit(Edit.begin(bundle, source.id), { title: "명시 수정 제목" }));
  assert.equal(titleOnly.version.contentText, raw);
  assert.equal(titleOnly.version.contentHash, version.contentHash);
  assert.equal(titleOnly.version.originalCreatedAt, null);
  const revised = raw.replace("속성 제목", "새 속성 제목").replace("2026-01-02", "2026-02-03") + "\n\n새 본문 😀\r\n";
  const edit = await Edit.prepare(bundle, Edit.edit(Edit.begin(bundle, source.id), { text: revised }));
  const next = Core.applyChanges(bundle, edit.changes);
  assert.notEqual(edit.version.id, version.id);
  assert.equal(edit.version.contentText, revised);
  assert.equal(edit.version.contentHash, digest(revised));
  assert.equal(edit.version.originalCreatedAt, null);
  assert.deepEqual(edit.version.originalAuthor, version.originalAuthor);
  assert.equal(edit.source.title, source.title);
  assert.equal(edit.source.url, source.url);
  assert.equal(edit.source.sourceKey, source.sourceKey);
  assert.deepEqual(next.sourceVersions.find((item) => item.id === version.id), version);
  assert.deepEqual(next.records, before.records);
  assert.deepEqual(next.links.filter((link) => link.kind === "obsidian_link"), before.links);
  assert.deepEqual(bundle, before);
  assert.deepEqual(imported, importedSnapshot);
  const nextSnapshot = clone(next);
  assert.equal(Markdown.prepare(revised).formatted, true);
  assert.deepEqual(next, nextSnapshot);
  const restored = await Core.restoreBackup(Core.makeBackup(next));
  const restoredSource = restored.sources.find((item) => item.sourceKey === source.sourceKey);
  assert.notEqual(restoredSource.id, source.id);
  const restoredVersions = restored.sourceVersions.filter((item) => item.sourceId === restoredSource.id);
  assert.deepEqual(restoredVersions.map((item) => [item.contentHash, item.contentText]),
    [[version.contentHash, raw], [edit.version.contentHash, revised]]);
  assert.deepEqual(quoteValues(restored), quoteValues(next));
  assert.deepEqual(relatedValues(restored), relatedValues(next));
  for (const record of restored.records) {
    const ref = record.sourceRefs[0], original = restored.sourceVersions.find((item) => item.id === ref.sourceVersionId);
    assert.equal(original.contentHash, version.contentHash);
    assert.equal(original.contentText.slice(ref.locator.start, ref.locator.end), record.text);
  }
});
