"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const D = require("../assets/life/obsidian-decisions.js"), P = require("../assets/life/obsidian-package.js");
const { unzipSync } = require("../vendor/fflate/fflate.js");
const { fixture, input } = require("./fixtures/obsidian-decisions.cjs");
const project = path.resolve(__dirname, ".."), cli = path.join(project, "scripts/apply-obsidian-decisions.mjs");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (source, decisions, extra = [], nodeArgs = []) => spawnSync(process.execPath,
  [...nodeArgs, cli, "--input", source, "--decisions", decisions, ...extra], { cwd: project, encoding: "utf8" });
async function setup(t, extraFiles = {}) {
  const f = await fixture(), root = await fs.mkdtemp(path.join(os.tmpdir(), "haedo-apply-portability-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source"), decisions = path.join(root, "decisions.json");
  await fs.mkdir(source, { mode: 0o700 });
  const files = { ...f.files, ...extraFiles };
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(source, name), bytes, { mode: 0o600 });
  const handle = await D.openPackage(input(f.files)), item = handle.items.find((i) => i.target === "이전/책");
  const selected = D.makeDecisions(handle, [{ id: item.id, targetPath: "책.md", targetLocator: null }]);
  await fs.writeFile(decisions, JSON.stringify(selected), { mode: 0o600 });
  return { ...f, root, source, decisions, selected, files };
}
async function unchanged(source, files) {
  assert.deepEqual((await fs.readdir(source)).sort(), Object.keys(files).sort());
  for (const [name, bytes] of Object.entries(files)) assert.equal(hash(await fs.readFile(path.join(source, name))), hash(bytes), name);
}
test("CLI selection produces an app-readable ZIP, preserves opaque tool/archive bytes and reopens idempotently", async (t) => {
  const tool = Buffer.from("\ufeff<!doctype html><script>throw new Error('never execute')</script>\r\n");
  const f = await setup(t, { "review-tool.html": tool, "vault-package.zip": Buffer.from("prior ZIP must not be nested") });
  const output = path.join(f.root, "selected"), result = run(f.source, f.decisions, ["--output", output]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { written: true, added: 1, located: 0, unchanged: 0, deferred: 3, informational: 1, originalFilesPreserved: true });
  await unchanged(f.source, f.files);
  const names = [...Object.keys(f.files).filter((name) => name !== "vault-package.zip"), "decisions.json", "applications.json"].sort();
  const packed = await fs.readFile(path.join(output, "vault-package.zip")), unzipped = unzipSync(packed);
  assert.deepEqual(Object.keys(unzipped).sort(), names);
  for (const name of names) assert.equal(hash(unzipped[name]), hash(await fs.readFile(path.join(output, name))), name);
  for (const name of Object.keys(f.files).filter((name) => !["notes.json", "vault-package.zip"].includes(name)))
    assert.equal(hash(unzipped[name]), hash(f.files[name]), name);
  const notes = JSON.parse(Buffer.from(unzipped["notes.json"]));
  assert.deepEqual(notes.workspace.sources, f.result.notesBackup.workspace.sources);
  assert.deepEqual(notes.workspace.sourceVersions, f.result.notesBackup.workspace.sourceVersions);
  const restored = await P.read(new Blob([packed]));
  assert.equal(restored.notes.sources.length, 5); assert.equal(restored.files.sources.length, 1);
  assert.equal(restored.notes.links.length, 2); assert.notEqual(restored.notes.workspaceId, notes.workspace.workspaceId);
  assert.equal(JSON.parse(Buffer.from(unzipped["applications.json"])).length, 1);
  const second = path.join(f.root, "second"), repeated = run(output, f.decisions, ["--output", second]);
  assert.equal(repeated.status, 0, repeated.stderr); assert.equal(JSON.parse(repeated.stdout).unchanged, 1);
  const secondZip = unzipSync(await fs.readFile(path.join(second, "vault-package.zip")));
  assert.deepEqual(JSON.parse(Buffer.from(secondZip["notes.json"])).workspace, notes.workspace);
  assert.equal(JSON.parse(Buffer.from(secondZip["applications.json"])).length, 2);
  assert.equal(hash(secondZip["review-tool.html"]), hash(tool));
  const overwritten = run(f.source, f.decisions, ["--output", output]);
  assert.notEqual(overwritten.status, 0); assert.match(overwritten.stderr, /EEXIST/);
  assert.equal(hash(await fs.readFile(path.join(output, "vault-package.zip"))), hash(packed));
});
test("legacy six-file packages keep read-only preview and receive a standalone tool plus private ZIP on application", async (t) => {
  const f = await setup(t), output = path.join(f.root, "selected");
  const preview = run(f.source, f.decisions, ["--preview", "--output", output]);
  assert.equal(preview.status, 0, preview.stderr); assert.equal(JSON.parse(preview.stdout).preview, true);
  await assert.rejects(fs.stat(output), { code: "ENOENT" }); await unchanged(f.source, f.files);
  const result = run(f.source, f.decisions, ["--output", output]); assert.equal(result.status, 0, result.stderr);
  const tool = await fs.readFile(path.join(output, "review-tool.html"), "utf8");
  assert.match(tool, /Content-Security-Policy/); assert.match(tool, /fflate/); assert.match(tool, /MIT/);
  assert.equal((await fs.stat(output)).mode & 0o777, 0o700);
  for (const name of await fs.readdir(output)) assert.equal((await fs.stat(path.join(output, name))).mode & 0o777, 0o600, name);
  const restored = await P.read(new Blob([await fs.readFile(path.join(output, "vault-package.zip"))]));
  assert.equal(restored.summary.links, 2); await unchanged(f.source, f.files);
});
test("stale selections, malformed history and linked optional tools fail without partial packages or source changes", async (t) => {
  const f = await setup(t), output = path.join(f.root, "rejected");
  const stale = { ...f.selected, ref: "b".repeat(40) };
  await fs.writeFile(f.decisions, JSON.stringify(stale));
  assert.match(run(f.source, f.decisions, ["--output", output]).stderr, /stale_decisions/);
  await assert.rejects(fs.stat(output), { code: "ENOENT" });
  await fs.writeFile(f.decisions, JSON.stringify(f.selected));
  await fs.writeFile(path.join(f.source, "applications.json"), "{}");
  assert.match(run(f.source, f.decisions, ["--output", output]).stderr, /invalid_history/);
  await assert.rejects(fs.stat(output), { code: "ENOENT" });
  await fs.unlink(path.join(f.source, "applications.json"));
  await fs.symlink(f.decisions, path.join(f.source, "review-tool.html"));
  assert.match(run(f.source, f.decisions, ["--output", output]).stderr, /invalid_private_file/);
  await assert.rejects(fs.stat(output), { code: "ENOENT" });
  await fs.unlink(path.join(f.source, "review-tool.html")); await unchanged(f.source, f.files);
});
test("a real late ZIP write failure removes its owned partial output and permits a clean retry", async (t) => {
  const f = await setup(t), output = path.join(f.root, "selected"), preload = path.join(f.root, "fail-write.cjs"), marker = path.join(f.root, "failure-observed");
  await fs.writeFile(preload, `const fs = require('node:fs/promises'), sync = require('node:fs');
for (const name of ['open', 'writeFile']) {
  const original = fs[name]; fs[name] = async function(file, ...args) {
    if (String(file).endsWith('/vault-package.zip')) {
      sync.writeFileSync(${JSON.stringify(marker)}, String(sync.readdirSync(require('node:path').dirname(file)).length));
      throw Object.assign(new Error('anonymous-write-failure'), {code:'ENOSPC'});
    }
    return original.call(this, file, ...args);
  };
}
require('node:module').syncBuiltinESMExports();`, { mode: 0o600 });
  const failed = run(f.source, f.decisions, ["--output", output], ["--require", preload]);
  assert.notEqual(failed.status, 0); assert.match(failed.stderr, /ENOSPC/);
  assert.ok(Number(await fs.readFile(marker, "utf8")) > 0, "failure follows earlier file writes");
  await assert.rejects(fs.stat(output), { code: "ENOENT" }); await unchanged(f.source, f.files);
  const retry = run(f.source, f.decisions, ["--output", output]); assert.equal(retry.status, 0, retry.stderr);
  assert.equal((await P.read(new Blob([await fs.readFile(path.join(output, "vault-package.zip"))]))).summary.links, 2);
});
