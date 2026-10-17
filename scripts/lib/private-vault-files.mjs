import { lstat, open, realpath, mkdir, writeFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname, relative, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
const project = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const problem = (code) => Object.assign(new Error(code), { code });
export const PACKAGE_FILES = ["notes.json", "supporting-files.json", "private-audit.json", "review.json", "review.html", "repository.bundle"];
export async function privateDestination(path, protectedRoots = []) {
  const output = resolve(path);
  let cursor = output;
  while (true) {
    try {
      const actual = await realpath(cursor), destination = resolve(actual, relative(cursor, output));
      if ([project, ...protectedRoots].some((root) => destination === root || destination.startsWith(root + sep))) throw problem("private_output_required");
      return output;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      cursor = dirname(cursor);
    }
  }
}
export async function readPrivateFile(path, limit = 64 * 1024 * 1024) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) throw problem("invalid_private_file");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit || before.ino !== info.ino || before.dev !== info.dev) throw problem("invalid_private_file");
    const bytes = await file.readFile();
    if (bytes.length > limit) throw problem("invalid_private_file");
    return bytes;
  } finally { await file.close(); }
}
export async function readPackage(path) {
  if (!(await lstat(path)).isDirectory()) throw problem("private_directory_required");
  const root = await realpath(path), files = {};
  for (const name of PACKAGE_FILES) files[name] = await readPrivateFile(join(root, name));
  return { root, files };
}
export async function writeNewPackage(output, files) {
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await mkdir(output, { mode: 0o700 }); // Own this directory or fail without touching it.
  try {
    for (const [name, content] of Object.entries(files)) {
      if (!/^[A-Za-z0-9.-]+$/.test(name)) throw problem("invalid_output_name");
      await writeFile(join(output, name), content, { flag: "wx", mode: 0o600 });
    }
  } catch (e) {
    await rm(output, { recursive: true, force: true });
    throw e;
  }
}
