"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { zipSync } = require("../vendor/fflate/fflate.js");
const P = require("../assets/life/obsidian-package.js"), D = require("../assets/life/obsidian-decisions.js");
const { fixture, input } = require("./fixtures/obsidian-decisions.cjs");
const blob = (files) => new Blob([zipSync(files, { level: 0 })]);
function changeCentralEntry(bytes, name, change) {
  const packed = Buffer.from(bytes);
  let at = 0;
  while ((at = packed.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at)) !== -1) {
    if (packed.subarray(at + 46, at + 46 + packed.readUInt16LE(at + 28)).toString() === name) { change(packed, at); return packed; }
    at += 4;
  }
  throw new Error(`fixture entry not found: ${name}`);
}
test("private package restores verified original and reviewed notes/files under fresh IDs without interpreting HTML, archive or history", async () => {
  const { files, result } = await fixture(), a = await P.read(blob(files)), b = await P.read(blob(files));
  assert.equal(a.notes.sources.length, 5); assert.equal(a.files.sources.length, 1);
  assert.notEqual(a.notes.workspaceId, b.notes.workspaceId);
  assert.deepEqual(a.notes.sourceVersions.map(v => v.contentText), result.notesBackup.workspace.sourceVersions.map(v => v.contentText));
  assert.deepEqual(a.retainedArchiveFiles.sort(), ["repository.bundle", "review.html"]);
  const h = await D.openPackage(input(files)), item = h.items.find(i => i.target === "이전/책");
  const applied = await D.apply(h, D.makeDecisions(h, [{ id: item.id, targetPath: "책.md", targetLocator: null }]));
  const reviewed = await P.read(blob({ ...files, "notes.json": Buffer.from(JSON.stringify(applied.notesBackup)), "applications.json": Buffer.from("not installed or executed") }));
  assert.equal(reviewed.notes.links.length, 2);
  assert.equal(reviewed.summary.reviewOccurrences, 4);
  assert.equal(globalThis.mustNotRun, undefined);
});
test("missing, foreign, nested and duplicate entries reject before any restore result", async () => {
  const { files } = await fixture();
  const missing = { ...files }; delete missing["repository.bundle"];
  for (const invalid of [missing, { "manifest.json": Buffer.from("{}") }, { ...files, "../escape": Buffer.from("blocked") }, { ...files, "folder/notes.json": files["notes.json"] }])
    await assert.rejects(P.read(blob(invalid)), { code: "invalid_obsidian_package" });
  const duplicate = Buffer.from(await blob({ ...files, "notes.jsox": files["notes.json"] }).arrayBuffer());
  let at = 0;
  while ((at = duplicate.indexOf("notes.jsox", at)) !== -1) { duplicate.write("notes.json", at); at += 10; }
  await assert.rejects(P.read(new Blob([duplicate])), { code: "invalid_obsidian_package" });
});
test("oversized files/declared expansion, malformed UTF-8, mixed source hashes and unreadable ZIPs fail closed", async () => {
  const { files } = await fixture();
  await assert.rejects(P.read({ size: P.LIMIT + 1, arrayBuffer() { throw new Error("must not read"); } }), { code: "invalid_obsidian_package" });
  const zip = Buffer.from(await blob(files).arrayBuffer()), central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  zip.writeUInt32LE(P.FILE_LIMIT + 1, central + 24);
  await assert.rejects(P.read(new Blob([zip])), { code: "invalid_obsidian_package" });
  await assert.rejects(P.read(blob({ ...files, "notes.json": Buffer.from([0xff, 0xfe, 0]) })), { code: "invalid_obsidian_package" });
  const changed = JSON.parse(files["private-audit.json"]); changed.files[0].sha256 = "0".repeat(64);
  await assert.rejects(P.read(blob({ ...files, "private-audit.json": Buffer.from(JSON.stringify(changed)) })), { code: "invalid_obsidian_package" });
  await assert.rejects(P.read(new Blob([Buffer.alloc(100)])), { code: "invalid_obsidian_package" });
});
test("standalone unpack can retain exact archive bytes while app read decodes only the four data files", async () => {
  const { files } = await fixture(), packed = blob(files);
  const data = await P.unpack(packed), all = await P.unpack(packed, { keepArchive: true });
  assert.deepEqual(Object.keys(data.unpacked).sort(), ["notes.json", "private-audit.json", "review.json", "supporting-files.json"]);
  for (const [name, bytes] of Object.entries(files)) assert.deepEqual(Buffer.from(all.unpacked[name]), bytes);
});
test("stored entry metadata cannot understate restored or retained bytes, including files skipped by the app", async () => {
  const { files } = await fixture(), packed = await blob(files).arrayBuffer();
  for (const name of ["notes.json", "repository.bundle"]) {
    const understated = changeCentralEntry(packed, name, (bytes, at) => bytes.writeUInt32LE(1, at + 24));
    await assert.rejects(P.unpack(new Blob([understated])), { code: "invalid_obsidian_package" });
    await assert.rejects(P.unpack(new Blob([understated]), { keepArchive: true }), { code: "invalid_obsidian_package" });
  }
  const unsupported = changeCentralEntry(packed, "repository.bundle", (bytes, at) => bytes.writeUInt16LE(99, at + 10));
  await assert.rejects(P.unpack(new Blob([unsupported])), { code: "invalid_obsidian_package" });
});
test("deflated entries must return their complete declared output rather than a shorter truncated file", async () => {
  const { files } = await fixture(), packed = zipSync(files, { level: 6 });
  const valid = await P.unpack(new Blob([packed]), { keepArchive: true });
  for (const [name, bytes] of Object.entries(files)) assert.deepEqual(Buffer.from(valid.unpacked[name]), bytes);
  const overstated = changeCentralEntry(packed, "notes.json", (bytes, at) => bytes.writeUInt32LE(files["notes.json"].length + 1, at + 24));
  await assert.rejects(P.unpack(new Blob([overstated])), { code: "invalid_obsidian_package" });
});
