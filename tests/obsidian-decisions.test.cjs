"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const Core = require("../assets/life/core.js");
const D = require("../scripts/lib/obsidian-decisions.js");
const { fixture, input } = require("./fixtures/obsidian-decisions.cjs");
const copy = (x) => JSON.parse(JSON.stringify(x));
async function setup() { const f = await fixture(); return { ...f, h: await D.openPackage(input(f.files)) }; }
const book = (h) => h.items.find((i) => i.target === "이전/책");
const select = (h) => D.makeDecisions(h, [{ id: book(h).id, targetPath: "책.md", targetLocator: null }]);
test("decisions change only an explicitly chosen occurrence and preserve bodies, paths, audit and other links through real restore", async () => {
  const { h, result, files } = await setup(), original = JSON.stringify(result.notesBackup);
  const decisions = select(h), p = D.preview(h, decisions);
  assert.deepEqual(p.summary, { added: 1, located: 0, unchanged: 0, deferred: 3, informational: 1 });
  const applied = await D.apply(h, decisions);
  assert.equal(JSON.stringify(result.notesBackup), original);
  assert.deepEqual(applied.notesBackup.workspace.sources, result.notesBackup.workspace.sources);
  assert.deepEqual(applied.notesBackup.workspace.sourceVersions, result.notesBackup.workspace.sourceVersions);
  assert.deepEqual(applied.notesBackup.workspace.links.slice(0, -1), result.notesBackup.workspace.links);
  const restored = await Core.restoreBackup(applied.notesBackup);
  assert.equal(restored.links.length, 2);
  const link = restored.links.find((l) => l.note === "이전/책"), versions = new Map(restored.sourceVersions.map((v) => [v.id, v]));
  assert.equal(versions.get(link.sourceRefs[0].sourceVersionId).contentText.slice(link.sourceRefs[0].locator.start, link.sourceRefs[0].locator.end), "[[이전/책]]");
  assert.equal(result.manifest.unresolvedReferences.length, 5);
  // Restored IDs differ from the original audit; do not silently apply to an account copy.
  await assert.rejects(D.openPackage(input({ ...files, "notes.json": Buffer.from(JSON.stringify(Core.makeBackup(restored))) })), { code: "source_mismatch" });
});
test("reapplying a decision to its generated package is idempotent; changed-ID account workspaces require a new import mapping", async () => {
  const { h, files } = await setup(), decisions = select(h), applied = await D.apply(h, decisions);
  const next = input({ ...files, "notes.json": Buffer.from(JSON.stringify(applied.notesBackup)) });
  const reopened = await D.openPackage(next);
  assert.equal(D.preview(reopened, decisions).summary.unchanged, 1);
  assert.equal((await D.apply(reopened, decisions)).notesBackup.workspace.links.length, applied.notesBackup.workspace.links.length);
  next.notes = JSON.stringify(Core.makeBackup(await Core.restoreBackup(applied.notesBackup)));
  await assert.rejects(D.openPackage(next), { code: "source_mismatch" });
});
test("anchor repair updates the existing document link exactly once and excludes fenced code headings", async () => {
  const { h, result } = await setup(), item = h.items.find((i) => i.reason === "anchor_missing");
  const target = D.targetInfo(h, "대상.md");
  assert.deepEqual(target.anchors.map((a) => a.text), ["# 실제 제목"]);
  const d = D.makeDecisions(h, [{ id: item.id, targetPath: "대상.md", targetLocator: target.anchors[0] }]);
  assert.equal(D.preview(h, d).summary.located, 1);
  const applied = await D.apply(h, d);
  assert.equal(applied.notesBackup.workspace.links.length, result.notesBackup.workspace.links.length);
  assert.equal(applied.notesBackup.workspace.links[0].id, result.notesBackup.workspace.links[0].id);
  assert.deepEqual(applied.notesBackup.workspace.links[0].sourceRefs[1].locator, { start: target.anchors[0].start, end: target.anchors[0].end });
});
test("stale bindings, token/range/hash edits, duplicate decisions and unknown candidate paths fail closed", async () => {
  const { h } = await setup(), d = select(h);
  for (const mutate of [
    (x) => x.ref = "b".repeat(40), (x) => x.auditSha256 = "0".repeat(64),
    (x) => x.decisions[0].token = "changed", (x) => x.decisions[0].locator.start++,
    (x) => x.decisions[0].sourceSha256 = "0".repeat(64), (x) => x.decisions[0].targetSha256 = "0".repeat(64),
  ]) { const stale = copy(d); mutate(stale); assert.throws(() => D.preview(h, stale), { code: "stale_decisions" }); }
  const duplicate = copy(d); duplicate.decisions.push(copy(d.decisions[0]));
  assert.throws(() => D.preview(h, duplicate), { code: "duplicate_decision" });
  const wrong = copy(d); wrong.decisions[0].targetPath = "대상.md";
  assert.throws(() => D.preview(h, wrong), { code: "unknown_candidate" });
  const badRange = copy(d); badRange.decisions[0].targetLocator = { start: 0, end: 1, text: "#" };
  assert.throws(() => D.preview(h, badRange), { code: "invalid_target_locator" });
  const unsupported = copy(d); unsupported.decisions[0].applyAll = true;
  assert.throws(() => D.preview(h, unsupported), { code: "invalid_decisions" });
  const reordered = copy(d); const loc = reordered.decisions[0].locator;
  reordered.decisions[0].locator = { end: loc.end, start: loc.start };
  assert.equal(D.preview(h, reordered).summary.added, 1);
  const anchor = h.items.find((i) => i.reason === "anchor_missing");
  assert.throws(() => D.preview(h, D.makeDecisions(h, [{ id: anchor.id, targetPath: "대상.md", targetLocator: null }])), { code: "target_locator_required" });
});
test("caller edits to the public review projection cannot grant candidates or change verified summary counts", async () => {
  const { h } = await setup(), d = select(h), item = book(h);
  item.candidatePaths.push("대상.md");
  item.locator.start++;
  item.token = "changed display";
  h.informationalOccurrences = 999;
  h.binding.ref = "b".repeat(40);
  assert.throws(() => D.makeDecisions(h, [{ id: item.id, targetPath: "대상.md", targetLocator: null }]), { code: "unknown_candidate" });
  const altered = copy(d); altered.decisions[0].targetPath = "대상.md";
  assert.throws(() => D.preview(h, altered), { code: "unknown_candidate" });
  assert.deepEqual(D.preview(h, d).summary, { added: 1, located: 0, unchanged: 0, deferred: 3, informational: 1 });
});
test("overlapping audit occurrences fail before they can become multiple choices for one source token", async () => {
  const { files } = await setup();
  for (const modify of [(locator) => locator.start++, (locator) => locator.end--]) {
    const data = input(files), audit = JSON.parse(data.audit), review = JSON.parse(data.review);
    const original = audit.unresolvedReferences.find((ref) => ref.target === "이전/책"), overlapping = copy(original);
    modify(overlapping.locator); audit.unresolvedReferences.push(overlapping);
    const group = review.groups.find((g) => g.target === original.target), occurrence = copy(group.occurrences[0]);
    occurrence.locator = copy(overlapping.locator); group.occurrences.push(occurrence);
    review.summary.reviewOccurrences++; review.summary.unresolvedOccurrences++;
    data.audit = JSON.stringify(audit); data.review = JSON.stringify(review);
    await assert.rejects(D.openPackage(data), { code: "overlapping_reference" });
  }
});
test("a failed new-package write removes only its own partial output and never replaces existing directories", async () => {
  const { writeNewPackage } = await import("../scripts/lib/private-vault-files.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "haedo-write-failure-")), output = path.join(root, "new");
  try {
    await assert.rejects(writeNewPackage(output, { "notes.json": "temporary", "../invalid": "blocked" }), { code: "invalid_output_name" });
    await assert.rejects(fs.stat(output), { code: "ENOENT" });
    await fs.mkdir(output); await fs.writeFile(path.join(output, "keep"), "existing");
    await assert.rejects(writeNewPackage(output, { "notes.json": "new" }), { code: "EEXIST" });
    assert.equal(await fs.readFile(path.join(output, "keep"), "utf8"), "existing");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test("untrusted review projections, altered source content and conflicting existing links cannot drive application", async () => {
  const { h, files } = await setup(), data = input(files), review = JSON.parse(data.review);
  review.groups[0].candidatePaths = ["대상.md"]; data.review = JSON.stringify(review);
  await assert.rejects(D.openPackage(data), { code: "review_mismatch" });
  const incomplete = input(files), missing = JSON.parse(incomplete.review);
  missing.informational = []; missing.summary.informationalOccurrences = 0;
  incomplete.review = JSON.stringify(missing);
  await assert.rejects(D.openPackage(incomplete), { code: "review_mismatch" });
  const changed = input(files), backup = JSON.parse(changed.notes);
  backup.workspace.sourceVersions[0].contentText += "edited";
  changed.notes = JSON.stringify(Core.makeBackup(backup.workspace));
  await assert.rejects(D.openPackage(changed), { code: "hash_mismatch" });
  const d = select(h), applied = await D.apply(h, d);
  const link = applied.notesBackup.workspace.links.at(-1);
  link.sourceRefs[1] = copy(applied.notesBackup.workspace.links[0].sourceRefs[1]);
  const conflicting = await D.openPackage(input({ ...files, "notes.json": Buffer.from(JSON.stringify(Core.makeBackup(applied.notesBackup.workspace))) }));
  assert.throws(() => D.preview(conflicting, d), { code: "conflicting_link" });
});
test("CLI previews without writes, writes a separate mode-0700 package, retains exact auxiliary bytes and refuses overwrite/symlink/stale inputs", async () => {
  const { h, files } = await setup(), root = await fs.mkdtemp(path.join(os.tmpdir(), "haedo-decision-"));
  try {
    const source = path.join(root, "input"), output = path.join(root, "output"), decisionFile = path.join(root, "decision.json");
    await fs.mkdir(source);
    for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(source, name), bytes);
    await fs.writeFile(decisionFile, JSON.stringify(select(h)));
    const run = (...extra) => spawnSync(process.execPath, ["scripts/apply-obsidian-decisions.mjs", "--input", source, "--decisions", decisionFile, ...extra], { encoding: "utf8" });
    assert.equal(run("--preview").status, 0);
    assert.deepEqual(await fs.readdir(root), ["decision.json", "input"]);
    const success = run("--output", output); assert.equal(success.status, 0, success.stderr);
    assert.equal((await fs.stat(output)).mode & 0o777, 0o700);
    for (const name of await fs.readdir(output)) assert.equal((await fs.stat(path.join(output, name))).mode & 0o777, 0o600);
    for (const name of Object.keys(files).filter((n) => n !== "notes.json")) assert.deepEqual(await fs.readFile(path.join(output, name)), files[name]);
    for (const name of Object.keys(files)) assert.deepEqual(await fs.readFile(path.join(source, name)), files[name]);
    assert.notEqual(run("--output", output).status, 0);
    await fs.symlink(process.cwd(), path.join(root, "app"));
    assert.match(run("--output", path.join(root, "app", "private-output")).stderr, /private_output_required/);
    const stale = select(h); stale.ref = "b".repeat(40); await fs.writeFile(decisionFile, JSON.stringify(stale));
    assert.match(run("--output", path.join(root, "bad")).stderr, /stale_decisions/);
    await assert.rejects(fs.stat(path.join(root, "bad")), { code: "ENOENT" });
    await fs.unlink(path.join(source, "review.json"));
    await fs.symlink(decisionFile, path.join(source, "review.json"));
    assert.match(run("--preview").stderr, /invalid_private_file/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
