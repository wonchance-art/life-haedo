import { lstat, open, realpath, mkdir, writeFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname, relative, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const project = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runFile = promisify(execFile);
const problem = (code) => Object.assign(new Error(code), { code });
export const PACKAGE_FILES = ["notes.json", "supporting-files.json", "private-audit.json", "review.json", "review.html", "repository.bundle"];
async function actualDestination(output) {
  let cursor = output;
  while (true) {
    try {
      return resolve(await realpath(cursor), relative(cursor, output));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      cursor = dirname(cursor);
    }
  }
}
async function applicationRoots() {
  // Copies distributed without Git still protect their own application folder.
  try { await lstat(join(project, ".git")); }
  catch (e) { if (e.code === "ENOENT") return [project]; throw e; }
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_NO_REPLACE_OBJECTS = "1";
  const { stdout } = await runFile("git", ["-C", project, "worktree", "list", "--porcelain", "-z"], {
    encoding: "utf8", maxBuffer: 1024 * 1024, env,
  });
  return [project, ...stdout.split("\0").filter((line) => line.startsWith("worktree ")).map((line) => line.slice(9))];
}
const within = (path, root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
export async function privateDestination(path, protectedRoots = []) {
  const output = resolve(path), destination = await actualDestination(output);
  // A system alias (Mac /var -> /private/var) can precede an outward
  // symlink inside the application. Check every traversed parent as well as
  // the final target, so that alias cannot hide the protected application.
  const ancestors = [];
  for (let cursor = output; ; cursor = dirname(cursor)) {
    ancestors.push(await actualDestination(cursor));
    if (dirname(cursor) === cursor) break;
  }
  for (const value of [...await applicationRoots(), ...protectedRoots]) {
    const root = resolve(value), actual = await actualDestination(root);
    if (within(output, root) || within(destination, actual) || ancestors.some(parent => within(parent, actual))) throw problem("private_output_required");
  }
  return output;
}
function sameFile(left, right) {
  return left.ino === right.ino && left.dev === right.dev;
}
function sameContents(left, right) {
  return sameFile(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
export async function readPrivateFile(path, limit = 64 * 1024 * 1024) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw problem("invalid_private_file");
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) throw problem("invalid_private_file");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat({ bigint: true });
    if (!info.isFile() || info.size > BigInt(limit) || !sameContents(before, info)) throw problem("invalid_private_file");
    const chunks = [];
    let total = 0;
    while (true) {
      // Read at most one byte beyond the limit, including when a file grows.
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, limit - total + 1));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) throw problem("invalid_private_file");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await file.stat({ bigint: true });
    if (!sameContents(info, after) || after.size !== BigInt(total)) throw problem("invalid_private_file");
    return Buffer.concat(chunks, total);
  } finally { await file.close(); }
}
export async function readPackage(path) {
  const before = await lstat(path, { bigint: true });
  if (!before.isDirectory()) throw problem("private_directory_required");
  const root = await realpath(path), files = {};
  if (!sameFile(before, await lstat(root, { bigint: true }))) throw problem("private_directory_required");
  for (const name of PACKAGE_FILES) files[name] = await readPrivateFile(join(root, name));
  if (!sameFile(before, await lstat(root, { bigint: true }))) throw problem("private_directory_required");
  return { root, files };
}
export async function writeNewPackage(output, files, protectedRoots = []) {
  const entries = Object.entries(files);
  for (const [name] of entries) {
    if (!/^[A-Za-z0-9.-]+$/.test(name) || name === "." || name === ".." || name.length > 255) throw problem("invalid_output_name");
  }
  output = await privateDestination(output, protectedRoots);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await mkdir(output, { mode: 0o700 }); // Own this directory or fail without touching it.
  const owned = await lstat(output, { bigint: true });
  try {
    for (const [name, content] of entries) {
      const current = await lstat(output, { bigint: true });
      if (!current.isDirectory() || !sameFile(owned, current)) throw problem("private_output_changed");
      await writeFile(join(output, name), content, { flag: "wx", mode: 0o600 });
    }
    const current = await lstat(output, { bigint: true });
    if (!current.isDirectory() || !sameFile(owned, current)) throw problem("private_output_changed");
  } catch (e) {
    // Another process may have replaced the path after we created it. Never
    // remove that process's directory while cleaning up our failed export.
    try {
      const current = await lstat(output, { bigint: true });
      if (current.isDirectory() && sameFile(owned, current)) await rm(output, { recursive: true, force: true });
    } catch (cleanup) { if (cleanup.code !== "ENOENT") throw cleanup; }
    throw e;
  }
}
