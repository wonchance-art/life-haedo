"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { createHash } = require("node:crypto"), { spawnSync, execFileSync } = require("node:child_process");
const Core = require("../assets/life/core.js"), Decisions = require("../assets/life/obsidian-decisions.js");
const Package = require("../assets/life/obsidian-package.js");
const project = path.resolve(__dirname, ".."), evidence = path.join(project, ".local/obsidian-portability");
const sha = value => createHash("sha256").update(value).digest("hex");
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull, GIT_TERMINAL_PROMPT: "0" };
const run = (script, args) => spawnSync(process.execPath, [path.join(project, "scripts", script), ...args], { cwd: project, env, encoding: "utf8" });
const git = (directory, ...args) => execFileSync("git", ["-c", "core.hooksPath=" + os.devNull, "-C", directory, ...args], { env, stdio: "pipe" });
async function filesAt(directory) {
  return Object.fromEntries(await Promise.all((await fs.readdir(directory)).sort().map(async name => [name, await fs.readFile(path.join(directory, name))])));
}
function hashes(files) { return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha(bytes)])); }
function bodies(bundle) {
  const paths = new Map(bundle.sources.map(source => [source.id, source.sourceKey]));
  return bundle.sourceVersions.map(version => ({ path: paths.get(version.sourceId), hash: sha(Buffer.from(version.contentText || "")), declaredHash: version.contentHash, format: version.format,
    coverage: version.coverage }))
    .sort((a, b) => compare(a.path, b.path));
}
function links(bundle) {
  const sources = new Map(bundle.sources.map(source => [source.id, source.sourceKey])), versions = new Map(bundle.sourceVersions.map(version => [version.id, version]));
  return bundle.links.map(link => ({ kind: link.kind, refs: link.sourceRefs.map(ref => ({ path: sources.get(ref.sourceId),
    locator: ref.locator, text: ref.locator ? versions.get(ref.sourceVersionId).contentText.slice(ref.locator.start, ref.locator.end) : null })) }))
    .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
}
function freshIds(copy, original) {
  assert.notEqual(copy.workspaceId, original.workspaceId);
  for (const key of ["sources", "sourceVersions", "links"]) {
    const oldIds = new Set(original[key].map(item => item.id));
    assert(copy[key].every(item => !oldIds.has(item.id)), key + " must receive fresh IDs");
  }
}

test("private Git vault survives import CLI, explicit-choice CLI ZIP and app restoration with exact bytes and reusable failure recovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "haedo-portability-")), vault = path.join(root, "vault");
  const imported = path.join(root, "imported"), selected = path.join(root, "selected"), decisionFile = path.join(root, "decisions.json");
  const report = { checks: [], scope: "Synthetic local Git and offline Node CLIs/shared app readers only; no private vault, browser, account, database or network." };
  const check = name => report.checks.push(name);
  try {
    const entries = new Map([
      ["notes/기록 😀.md", Buffer.from("\ufeff😀 [[이전/책]]\r\n[[이전/책]] [[같음]] [[목적지#없는 제목]]\r\n원문 보존 문장")],
      ["책.md", Buffer.from("# 읽은 책\r\n익명 책 내용\r\n근거 문장 ^proof")],
      ["a/같음.md", Buffer.from("# 첫 후보\n<script>throw Error('inert text')</script>")],
      ["b/같음.md", Buffer.from("# 둘째 후보\n선택하지 않은 후보")],
      ["목적지.md", Buffer.from("```md\n# 코드 제목\n```\n# 실제 제목\n정확한 위치")],
      ["empty.md", Buffer.alloc(0)], ["meta/설정.yaml", Buffer.from("anonymous: true\r\n")],
      ["meta/빈 설정.txt", Buffer.alloc(0)], [".gitignore", Buffer.from("ignored-local.txt\n")],
    ]);
    await fs.mkdir(vault);
    git(vault, "init", "-q"); git(vault, "config", "core.autocrlf", "false");
    await fs.writeFile(path.join(vault, "책.md"), "# 이전 Git 버전\n이력에만 남는 문장");
    git(vault, "add", "."); git(vault, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "first synthetic snapshot");
    git(vault, "tag", "synthetic-baseline");
    const oldRef = git(vault, "rev-parse", "HEAD").toString().trim();
    for (const [name, bytes] of entries) { await fs.mkdir(path.dirname(path.join(vault, name)), { recursive: true }); await fs.writeFile(path.join(vault, name), bytes); }
    git(vault, "add", "."); git(vault, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "complete synthetic vault");
    const ref = git(vault, "rev-parse", "HEAD").toString().trim();
    await fs.writeFile(path.join(vault, "ignored-local.txt"), "ignored synthetic data must never enter an export");
    const converted = run("import-obsidian-vault.mjs", ["--vault", vault, "--output", imported, "--repository", "https://github.com/example/anonymous-portability", "--title", "합성 이동 검증"]);
    assert.equal(converted.status, 0, converted.stderr);
    assert.equal(JSON.parse(converted.stdout).files, entries.size);
    const originalFiles = await filesAt(imported), originalHashes = hashes(originalFiles);
    const audit = JSON.parse(originalFiles["private-audit.json"]);
    assert.equal(audit.ref, ref);
    const originalNotes = JSON.parse(originalFiles["notes.json"]).workspace, originalSupporting = JSON.parse(originalFiles["supporting-files.json"]).workspace;
    const originalVersions = [...originalNotes.sourceVersions, ...originalSupporting.sourceVersions], originalSources = [...originalNotes.sources, ...originalSupporting.sources];
    assert.equal(originalSources.length, entries.size);
    for (const source of originalSources) {
      assert(entries.has(source.sourceKey), "only pinned tracked files may be exported");
      const version = originalVersions.find(item => item.sourceId === source.id);
      const bytes = entries.get(source.sourceKey), audited = audit.files.find(file => file.path === source.sourceKey);
      assert.deepEqual(Buffer.from(version.contentText || ""), bytes);
      assert.equal(audited.bytes, bytes.length); assert.equal(audited.sha256, sha(bytes));
      if (bytes.length) { assert.equal(version.contentHash, sha(bytes)); assert.equal(version.coverage.status, "full_text"); }
      else { assert.equal(version.contentText, null); assert.equal(version.contentHash, null); assert.equal(version.coverage.status, "link_only"); }
      assert.equal(source.url, "https://github.com/example/anonymous-portability/blob/" + ref + "/" + source.sourceKey.split("/").map(encodeURIComponent).join("/"));
    }
    const originalPacked = await Package.read(new Blob([originalFiles["vault-package.zip"]]));
    assert.deepEqual(bodies(originalPacked.notes), bodies(originalNotes));
    assert.deepEqual(bodies(originalPacked.files), bodies(originalSupporting));
    freshIds(originalPacked.notes, originalNotes); freshIds(originalPacked.files, originalSupporting);
    check("Pinned Git files, ignored-file exclusion, BOM/CRLF/emoji/empty bytes and initial app ZIP restoration");

    const handle = await Decisions.openPackage({ notes: originalFiles["notes.json"].toString(), supporting: originalFiles["supporting-files.json"].toString(),
      audit: originalFiles["private-audit.json"].toString(), review: originalFiles["review.json"].toString() });
    const occurrence = handle.items.find(item => item.target === "이전/책"), anchor = handle.items.find(item => item.reason === "anchor_missing");
    assert(occurrence); assert(anchor);
    const heading = Decisions.targetInfo(handle, "목적지.md").anchors.find(item => item.text === "# 실제 제목");
    assert(heading, "the explicit choice must name the actual destination heading");
    const choices = Decisions.makeDecisions(handle, [{ id: occurrence.id, targetPath: "책.md", targetLocator: null },
      { id: anchor.id, targetPath: "목적지.md", targetLocator: heading }]);
    await fs.writeFile(decisionFile, JSON.stringify(choices), { mode: 0o600 });
    const apply = (input, output, extra = []) => run("apply-obsidian-decisions.mjs", ["--input", input, "--decisions", decisionFile, ...(output ? ["--output", output] : []), ...extra]);
    const preview = apply(imported, null, ["--preview"]);
    assert.equal(preview.status, 0, preview.stderr); assert.equal(JSON.parse(preview.stdout).preview, true);
    assert.deepEqual(hashes(await filesAt(imported)), originalHashes);
    await assert.rejects(fs.stat(selected), { code: "ENOENT" });
    const applied = apply(imported, selected); assert.equal(applied.status, 0, applied.stderr);
    const selectedFiles = await filesAt(selected), archived = await Package.unpack(new Blob([selectedFiles["vault-package.zip"]]), { keepArchive: true });
    assert.equal(Object.keys(selectedFiles).length, 10); assert.equal(Object.keys(archived.unpacked).length, 9);
    for (const [name, bytes] of Object.entries(selectedFiles)) {
      assert.equal((await fs.stat(path.join(selected, name))).mode & 0o777, 0o600);
      if (name !== "vault-package.zip") assert.deepEqual(Buffer.from(archived.unpacked[name]), bytes, name + " inside the ZIP must match its sidecar");
    }
    assert.equal((await fs.stat(selected)).mode & 0o777, 0o700);
    for (const name of ["supporting-files.json", "private-audit.json", "review.json", "review.html", "review-tool.html", "repository.bundle"])
      assert.deepEqual(selectedFiles[name], originalFiles[name], name + " must remain byte-identical");
    assert.deepEqual(hashes(await filesAt(imported)), originalHashes);
    const selectedNotes = JSON.parse(selectedFiles["notes.json"]).workspace, history = JSON.parse(selectedFiles["applications.json"]);
    assert.deepEqual(bodies(selectedNotes), bodies(originalNotes)); assert.equal(history.length, 1);
    assert.equal(history[0].summary.added, 1); assert.equal(history[0].summary.located, 1); assert.equal(history[0].summary.deferred, 2);
    assert.deepEqual(JSON.parse(selectedFiles["decisions.json"]), choices);
    const restored = await Package.read(new Blob([selectedFiles["vault-package.zip"]]));
    assert.deepEqual(bodies(restored.notes), bodies(originalNotes)); assert.deepEqual(bodies(restored.files), bodies(originalSupporting));
    assert.deepEqual(links(restored.notes), links(selectedNotes)); freshIds(restored.notes, selectedNotes); freshIds(restored.files, originalSupporting);
    const secondCopy = await Core.restoreBackup(Core.makeBackup(restored.notes));
    assert.deepEqual(bodies(secondCopy), bodies(restored.notes)); assert.deepEqual(links(secondCopy), links(restored.notes)); freshIds(secondCopy, restored.notes);
    const projections = links(secondCopy);
    assert(projections.some(link => link.refs[0].text === "[[이전/책]]" && link.refs[1].path === "책.md"));
    assert(projections.some(link => link.refs[1].text === "# 실제 제목"));
    assert.equal(projections.length, 2);
    check("Explicit choices, pending references, private permissions and generated ZIP/Core restoration preserve full bodies and remapped exact links");

    const unchanged = hashes(selectedFiles), stale = { ...choices, ref: "f".repeat(40) };
    await fs.writeFile(decisionFile, JSON.stringify(stale));
    const rejectedOutput = path.join(root, "rejected"), rejected = apply(imported, rejectedOutput);
    assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /stale_decisions/);
    await assert.rejects(fs.stat(rejectedOutput), { code: "ENOENT" });
    assert.deepEqual(hashes(await filesAt(imported)), originalHashes); assert.deepEqual(hashes(await filesAt(selected)), unchanged);
    await fs.writeFile(decisionFile, JSON.stringify(choices));
    assert.notEqual(apply(imported, selected).status, 0); assert.deepEqual(hashes(await filesAt(selected)), unchanged);
    const retry = apply(imported, rejectedOutput); assert.equal(retry.status, 0, retry.stderr);
    const retried = await Package.read(new Blob([await fs.readFile(path.join(rejectedOutput, "vault-package.zip"))]));
    assert.deepEqual(links(retried.notes), links(restored.notes)); assert.deepEqual(bodies(retried.files), bodies(originalSupporting));
    const repeatedOutput = path.join(root, "repeated"), repeated = apply(selected, repeatedOutput);
    assert.equal(repeated.status, 0, repeated.stderr);
    const repeatedFiles = await filesAt(repeatedOutput), repeatedHistory = JSON.parse(repeatedFiles["applications.json"]);
    assert.equal(repeatedHistory.length, 2); assert.equal(repeatedHistory[1].summary.unchanged, 2);
    const reopened = await Package.read(new Blob([repeatedFiles["vault-package.zip"]]));
    assert.deepEqual(links(reopened.notes), links(restored.notes)); assert.deepEqual(bodies(reopened.notes), bodies(restored.notes));
    assert.deepEqual(hashes(await filesAt(selected)), unchanged);
    check("Stale choice and overwrite failures leave no partial output; same-destination retry and repeated application remain reusable without duplicate links");

    git(vault, "bundle", "verify", path.join(selected, "repository.bundle"));
    const recovered = path.join(root, "recovered-git");
    execFileSync("git", ["-c", "core.hooksPath=" + os.devNull, "clone", "-q", path.join(selected, "repository.bundle"), recovered], { env, stdio: "pipe" });
    assert.equal(git(recovered, "rev-parse", "HEAD").toString().trim(), ref);
    assert.equal(git(recovered, "rev-parse", "synthetic-baseline").toString().trim(), oldRef);
    for (const [name, bytes] of entries) assert.deepEqual(git(recovered, "show", "HEAD:" + name), bytes);
    assert.equal(git(recovered, "show", oldRef + ":책.md").toString(), "# 이전 Git 버전\n이력에만 남는 문장");
    assert.equal(git(vault, "rev-parse", "HEAD").toString().trim(), ref);
    assert.equal(git(vault, "status", "--porcelain", "--untracked-files=all").toString(), "");
    assert.equal((await fs.readFile(path.join(vault, "ignored-local.txt"), "utf8")), "ignored synthetic data must never enter an export");
    check("Byte-identical Git bundle restores tracked files and earlier tagged history while the original checkout remains unchanged");
    report.pass = true; report.files = entries.size; report.notes = restored.notes.sources.length; report.supportingFiles = restored.files.sources.length;
    report.explicitChoices = choices.decisions.length; report.links = restored.notes.links.length; report.pendingReferences = history[0].summary.deferred;
    report.gitCommits = 2; report.generatedArchiveFiles = Object.keys(archived.unpacked).length;
  } catch (error) { report.pass = false; report.failure = error.message; throw error; }
  finally { await fs.mkdir(evidence, { recursive: true }); await fs.writeFile(path.join(evidence, "report.json"), JSON.stringify(report, null, 2)); await fs.rm(root, { recursive: true, force: true }); }
});
