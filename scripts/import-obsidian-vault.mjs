/* Private offline conversion. Output must stay outside the application repository. */
import {
  mkdtemp,
  chmod,
  rm,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildVault } from "./lib/obsidian-vault.mjs";
import { renderReviewHTML } from "./lib/obsidian-review.mjs";
import { renderDecisionTool } from "./lib/obsidian-decision-tool.mjs";
import { privateDestination, readPrivateFile, writeNewPackage } from "./lib/private-vault-files.mjs";
import Zip from "../vendor/fflate/fflate.js";
import Core from "../assets/life/core.js";
const args = process.argv.slice(2),
  values = {};
for (let i = 0; i < args.length; i += 2) {
  if (
    !["--vault", "--output", "--repository", "--title"].includes(args[i]) ||
    !args[i + 1] ||
    values[args[i]]
  )
    throw new Error(
      "Use --vault PATH --output PRIVATE_PATH --repository https://github.com/OWNER/REPO [--title TITLE]",
    );
  values[args[i]] = args[i + 1];
}
async function main() {
  if (!values["--vault"] || !values["--output"] || !values["--repository"])
    throw new Error("missing_arguments");
  const vault = await realpath(values["--vault"]),
    output = await privateDestination(values["--output"], [vault]);
  // The explicit --vault owns Git selection, regardless of a caller's Git shell.
  const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
  Object.assign(gitEnvironment, { GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1" });
  const git = (args, options = {}) => execFileSync("git", ["-C", vault, ...args], {
    stdio: "pipe", env: gitEnvironment, ...options,
  });
  if (await realpath(git(["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()) !== vault) throw new Error("vault_git_root_required");
  const ref = git(["rev-parse", "--verify", "HEAD^{commit}"], { encoding: "utf8" }).trim();
  // A dirty checkout is not represented by the pinned Git source URLs.
  if (
    git(["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim()
  )
    throw new Error("clean_vault_required");
  // Read immutable Git objects rather than the mutable/possibly ignored checkout.
  const tree = git(["ls-tree", "-r", "-l", "-z", ref], { maxBuffer: 64 * 1024 * 1024 });
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }), files = [];
  for (let start = 0; start < tree.length;) {
    const end = tree.indexOf(0, start), tab = tree.indexOf(9, start);
    if (end < 0 || tab < start || tab > end) throw new Error("invalid_git_tree");
    const [mode, type, oid, length] = tree.subarray(start, tab).toString("ascii").trim().split(/\s+/), size = Number(length);
    if (mode === "120000") throw new Error("vault_symlink_unsupported");
    if (!["100644", "100755"].includes(mode) || type !== "blob") throw new Error("vault_file_type_unsupported");
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid) || !Number.isSafeInteger(size) || size < 0) throw new Error("invalid_git_tree");
    if (size > Core.MAX_IMPORT_BYTES) throw new Error("text_too_large");
    files.push({ path: decoder.decode(tree.subarray(tab + 1, end)), oid, size });
    start = end + 1;
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (!Number.isSafeInteger(totalBytes)) throw new Error("invalid_git_tree");
  const batch = files.length ? git(["cat-file", "--batch"], {
    input: files.map(file => file.oid).join("\n") + "\n", maxBuffer: totalBytes + files.length * 128 + 1024,
  }) : Buffer.alloc(0);
  const entries = []; let offset = 0;
  for (const file of files) {
    const line = batch.indexOf(10, offset);
    if (line < 0 || batch.subarray(offset, line).toString("ascii") !== file.oid + " blob " + file.size) throw new Error("invalid_git_blob");
    const start = line + 1, end = start + file.size;
    if (end >= batch.length || batch[end] !== 10) throw new Error("invalid_git_blob");
    entries.push({ path: file.path, bytes: batch.subarray(start, end) }); offset = end + 1;
  }
  if (offset !== batch.length) throw new Error("invalid_git_blob");
  const result = await buildVault(entries, {
    repositoryUrl: values["--repository"],
    ref,
    title: values["--title"] || "Obsidian 노트",
  });
  const archive = {};
  for (const [name, value] of [
    ["notes.json", result.notesBackup],
    ["supporting-files.json", result.filesBackup],
    ["private-audit.json", result.manifest],
    ["review.json", result.review],
  ])
    archive[name] = Buffer.from(JSON.stringify(value));
  archive["review.html"] = Buffer.from(renderReviewHTML(result.review));
  archive["review-tool.html"] = Buffer.from(await renderDecisionTool());
  const temporary = await mkdtemp(join(tmpdir(), "haedo-vault-bundle-"));
  try {
    const bundle = join(temporary, "repository.bundle");
    // --all retains history; explicit ref also retains a pinned detached HEAD if it moves.
    git(["bundle", "create", bundle, "--all", ref]);
    await chmod(bundle, 0o600);
    git(["bundle", "verify", bundle]);
    archive["repository.bundle"] = await readPrivateFile(bundle);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  const packed = Zip.zipSync(archive, { level: 0 });
  await writeNewPackage(output, { ...archive, "vault-package.zip": packed }, [vault]);
  const { references } = result.manifest;
  console.log(
    JSON.stringify({
      files: entries.length,
      originalBytes: entries.reduce((sum, e) => sum + e.bytes.length, 0),
      notes: result.notesBackup.workspace.sources.length,
      supportingFiles: result.filesBackup.workspace.sources.length,
      references,
      review: result.review.summary,
      verified: true,
    }),
  );
}
main().catch((e) => {
  console.error(
    "Vault conversion failed; existing data is unchanged. Code: " +
      (e.code ||
        (/^[a-z_]+$/.test(e.message) ? e.message : "conversion_error")),
  );
  process.exitCode = 1;
});
