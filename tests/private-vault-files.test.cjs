"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { pathToFileURL } = require("node:url");
const runFile = promisify(execFile);
const modulePath = path.resolve(__dirname, "../scripts/lib/private-vault-files.mjs");
const helper = import(pathToFileURL(modulePath));
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "haedo-private-files-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function missing(file) { await assert.rejects(fs.lstat(file), { code: "ENOENT" }); }
async function injectedRead(program) {
  const { stdout } = await runFile(process.execPath, ["--input-type=module", "--eval", program], { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}

test("private output protection covers every application worktree, symlinks and existing ancestors without creating files", async t => {
  const root = await temporary(t), repository = path.join(root, "application"), peer = path.join(root, "another worktree");
  const relativeModule = "scripts/lib/private-vault-files.mjs", emptyHooks = path.join(root, "empty-hooks");
  await fs.mkdir(path.dirname(path.join(repository, relativeModule)), { recursive: true });
  await fs.mkdir(emptyHooks);
  await fs.copyFile(modulePath, path.join(repository, relativeModule));
  const git = (...args) => runFile("git", ["-c", `core.hooksPath=${emptyHooks}`, ...args]);
  await git("init", "--quiet", repository);
  await git("-C", repository, "add", relativeModule);
  await git("-C", repository, "-c", "user.name=Anonymous fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Synthetic helper fixture");
  await git("-C", repository, "worktree", "add", "--quiet", "--detach", peer, "HEAD");
  const scoped = await import(pathToFileURL(path.join(peer, relativeModule)));
  const alias = path.join(root, "app-alias"), outside = path.join(root, "outside");
  await fs.symlink(repository, alias, "dir");
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(peer, "outward-alias"), "dir");
  for (const output of [path.join(repository, "private", "new"), path.join(peer, "private", "new"), path.join(alias, "private", "new"), path.join(peer, "outward-alias", "new")]) {
    await assert.rejects(scoped.privateDestination(output), { code: "private_output_required" });
    await assert.rejects(scoped.writeNewPackage(output, { "notes.json": "anonymous" }), { code: "private_output_required" });
    await missing(output);
  }
  const inheritedConfig = path.join(root, "invalid-inherited-config");
  await fs.writeFile(inheritedConfig, "[anonymous malformed configuration");
  const overrides = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "include.path", GIT_CONFIG_VALUE_0: inheritedConfig };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, overrides);
    await assert.rejects(scoped.privateDestination(path.join(repository, "new")), { code: "private_output_required" });
    await missing(path.join(repository, "new"));
  } finally {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
  assert.equal(await scoped.privateDestination(path.join(root, "application-extra", "new")), path.join(root, "application-extra", "new"));
});

test("protected source roots are canonicalized and relative or symlink aliases cannot receive output", async t => {
  const root = await temporary(t), source = path.join(root, "source"), alias = path.join(root, "source-alias");
  const { privateDestination } = await helper;
  await fs.mkdir(source); await fs.symlink(source, alias, "dir");
  await assert.rejects(privateDestination(path.join(source, "new"), [alias]), { code: "private_output_required" });
  await assert.rejects(privateDestination(path.join(alias, "new"), [path.relative(process.cwd(), source)]), { code: "private_output_required" });
  await assert.rejects(privateDestination(path.join(root, "new"), [path.parse(root).root]), { code: "private_output_required" });
  await missing(path.join(source, "new"));
});

test("the final package write rechecks protected source roots after a destination parent changes", async t => {
  const root = await temporary(t), source = path.join(root, "source"), outside = path.join(root, "outside"), alias = path.join(root, "destination");
  const { privateDestination, writeNewPackage } = await helper;
  await fs.mkdir(source); await fs.mkdir(outside); await fs.symlink(outside, alias, "dir");
  await fs.writeFile(path.join(source, "original.txt"), "preserve original");
  const output = await privateDestination(path.join(alias, "new"), [source]);
  await fs.unlink(alias); await fs.symlink(source, alias, "dir");
  await assert.rejects(writeNewPackage(output, { "notes.json": "anonymous" }, [source]), { code: "private_output_required" });
  await missing(path.join(source, "new")); await missing(path.join(outside, "new"));
  assert.equal(await fs.readFile(path.join(source, "original.txt"), "utf8"), "preserve original");
});

test("package output validates every name before creating parents and never replaces existing paths or changes their permissions", async t => {
  const root = await temporary(t), parent = path.join(root, "new-parent"), output = path.join(parent, "new");
  const { writeNewPackage } = await helper;
  for (const name of [".", "..", "../outside", "nested/file", "back\\slash", "x".repeat(256)]) {
    await assert.rejects(writeNewPackage(output, { "notes.json": "anonymous", [name]: "blocked" }), { code: "invalid_output_name" });
    await missing(parent);
  }
  await fs.mkdir(parent, { mode: 0o755 }); await fs.chmod(parent, 0o755);
  await fs.writeFile(path.join(parent, "existing.json"), "original");
  await assert.rejects(writeNewPackage(path.join(parent, "existing.json"), { "notes.json": "new" }), { code: "EEXIST" });
  assert.equal(await fs.readFile(path.join(parent, "existing.json"), "utf8"), "original");
  await fs.mkdir(output, { mode: 0o755 }); await fs.chmod(output, 0o755);
  await assert.rejects(writeNewPackage(output, { "notes.json": "new" }), { code: "EEXIST" });
  assert.deepEqual(await fs.readdir(output), []);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(parent)).mode & 0o777, 0o755);
    assert.equal((await fs.stat(output)).mode & 0o777, 0o755);
  }
});

test("private package output preserves exact bytes and failed file writes remove only the new output for a retry", async t => {
  const root = await temporary(t), output = path.join(root, "new"), sentinel = path.join(root, "existing.txt");
  const { writeNewPackage, readPrivateFile } = await helper;
  await fs.writeFile(sentinel, "keep");
  await assert.rejects(writeNewPackage(output, { "notes.json": "anonymous partial", "review.json": null }), { code: "ERR_INVALID_ARG_TYPE" });
  await missing(output); assert.equal(await fs.readFile(sentinel, "utf8"), "keep");
  const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x00, 0xff]);
  await writeNewPackage(output, { "notes.json": bytes, "empty.txt": Buffer.alloc(0) });
  assert.deepEqual(await readPrivateFile(path.join(output, "notes.json")), bytes);
  assert.deepEqual(await readPrivateFile(path.join(output, "empty.txt"), 0), Buffer.alloc(0));
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(output)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(output, "notes.json"))).mode & 0o777, 0o600);
  }
});

test("failed cleanup cannot delete a replacement directory created by another writer", async t => {
  const root = await temporary(t), output = path.join(root, "new"), moved = path.join(root, "moved");
  const { writeNewPackage } = await helper;
  const content = { async *[Symbol.asyncIterator]() {
    yield Buffer.from("anonymous partial");
    await fs.rename(output, moved); await fs.mkdir(output);
    await fs.writeFile(path.join(output, "existing.txt"), "preserve replacement");
    throw Object.assign(new Error("synthetic write failure"), { code: "ENOSPC" });
  } };
  await assert.rejects(writeNewPackage(output, { "notes.json": content }), { code: "ENOSPC" });
  assert.equal(await fs.readFile(path.join(output, "existing.txt"), "utf8"), "preserve replacement");
  assert.equal(await fs.readFile(path.join(moved, "notes.json"), "utf8"), "anonymous partial");
});

test("a successful final file write still rejects a directory that was replaced during the write", async t => {
  const root = await temporary(t), output = path.join(root, "new"), moved = path.join(root, "moved");
  const { writeNewPackage } = await helper;
  const content = { async *[Symbol.asyncIterator]() {
    yield Buffer.from("anonymous");
    await fs.rename(output, moved); await fs.mkdir(output);
    await fs.writeFile(path.join(output, "existing.txt"), "preserve replacement");
  } };
  await assert.rejects(writeNewPackage(output, { "notes.json": content }), { code: "private_output_changed" });
  assert.equal(await fs.readFile(path.join(output, "existing.txt"), "utf8"), "preserve replacement");
});

test("private reads reject invalid limits, directories and symlinks without changing original bytes", async t => {
  const root = await temporary(t), original = path.join(root, "original"), alias = path.join(root, "alias");
  const { readPrivateFile } = await helper;
  await fs.writeFile(original, "anonymous\r\n"); await fs.symlink(original, alias);
  for (const limit of [-1, NaN, Infinity, 1.5, "16"]) await assert.rejects(readPrivateFile(original, limit), { code: "invalid_private_file" });
  await assert.rejects(readPrivateFile(original, 1), { code: "invalid_private_file" });
  await assert.rejects(readPrivateFile(root), { code: "invalid_private_file" });
  await assert.rejects(readPrivateFile(alias), { code: "invalid_private_file" });
  assert.equal(await fs.readFile(original, "utf8"), "anonymous\r\n");
});

test("growing-file reads stop at the byte limit and close their descriptor without an unbounded readFile", async t => {
  const root = await temporary(t), original = path.join(root, "original");
  await fs.writeFile(original, "anonymous");
  const result = await injectedRead(`
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const filename = ${JSON.stringify(original)}, actualOpen = fs.open;
    let closed = 0, unbounded = 0, requested = 0, received = 0;
    fs.open = async (...args) => {
      const file = await actualOpen(...args), read = file.read.bind(file), close = file.close.bind(file);
      file.readFile = async () => { unbounded++; throw new Error('unbounded read used'); };
      file.read = async (...values) => {
        if (!requested) await fs.appendFile(filename, 'x'.repeat(1024));
        requested += values[2]; const result = await read(...values); received += result.bytesRead; return result;
      };
      file.close = async () => { closed++; return close(); }; return file;
    };
    syncBuiltinESMExports();
    const { readPrivateFile } = await import(${JSON.stringify(pathToFileURL(modulePath).href)});
    let code; try { await readPrivateFile(filename, 16); } catch (e) { code = e.code; }
    console.log(JSON.stringify({ code, closed, unbounded, requested, received }));
  `);
  assert.deepEqual(result, { code: "invalid_private_file", closed: 1, unbounded: 0, requested: 17, received: 17 });
});

test("in-place content changes during a bounded read fail instead of returning a mixed snapshot", async t => {
  const root = await temporary(t), original = path.join(root, "original");
  await fs.writeFile(original, "original");
  const result = await injectedRead(`
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const filename = ${JSON.stringify(original)}, actualOpen = fs.open;
    let closed = 0, mutated = false;
    fs.open = async (...args) => {
      const file = await actualOpen(...args), read = file.read.bind(file), close = file.close.bind(file);
      file.read = async (...values) => { if (!mutated) { mutated = true; await fs.writeFile(filename, 'modified'); } return read(...values); };
      file.close = async () => { closed++; return close(); }; return file;
    };
    syncBuiltinESMExports();
    const { readPrivateFile } = await import(${JSON.stringify(pathToFileURL(modulePath).href)});
    let code; try { await readPrivateFile(filename, 16); } catch (e) { code = e.code; }
    console.log(JSON.stringify({ code, closed, mutated }));
  `);
  assert.deepEqual(result, { code: "invalid_private_file", closed: 1, mutated: true });
});

test("package reads preserve the six required files and reject directory or member symlinks", async t => {
  const root = await temporary(t), folder = path.join(root, "package"), alias = path.join(root, "alias");
  const { readPackage, writeNewPackage, PACKAGE_FILES } = await helper;
  const files = Object.fromEntries(PACKAGE_FILES.map((name, index) => [name, Buffer.from(`anonymous ${index}\r\n`)]));
  await writeNewPackage(folder, files);
  const result = await readPackage(folder);
  assert.equal(result.root, await fs.realpath(folder)); assert.deepEqual(result.files, files);
  await fs.symlink(folder, alias, "dir");
  await assert.rejects(readPackage(alias), { code: "private_directory_required" });
  await fs.rename(path.join(folder, "notes.json"), path.join(root, "original.json"));
  await fs.symlink(path.join(root, "original.json"), path.join(folder, "notes.json"));
  await assert.rejects(readPackage(folder), { code: "invalid_private_file" });
  assert.deepEqual(await fs.readFile(path.join(root, "original.json")), files["notes.json"]);
});
