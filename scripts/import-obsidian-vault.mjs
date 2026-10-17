/* Private offline conversion. Output must stay outside the application repository. */
import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  realpath,
} from "node:fs/promises";
import { resolve, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { buildVault } from "./lib/obsidian-vault.mjs";
import { renderReviewHTML } from "./lib/obsidian-review.mjs";
import { renderDecisionTool } from "./lib/obsidian-decision-tool.mjs";
import Zip from "../vendor/fflate/fflate.js";
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
    output = resolve(values["--output"]);
  let cursor = output;
  // Resolve existing ancestors so symlinks cannot redirect private output into the app.
  while (true) {
    try {
      const actual = await realpath(cursor),
        rest = relative(cursor, output),
        destination = resolve(actual, rest);
      if (
        [project, vault].some(
          (root) => destination === root || destination.startsWith(root + sep),
        )
      )
        throw new Error("private_output_required");
      break;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      cursor = dirname(cursor);
    }
  }
  const ref = execFileSync("git", ["-C", vault, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  // A dirty checkout is not represented by the pinned Git source URLs.
  if (
    execFileSync(
      "git",
      ["-C", vault, "status", "--porcelain", "--untracked-files=all"],
      { encoding: "utf8" },
    ).trim()
  )
    throw new Error("clean_vault_required");
  const entries = [];
  async function walk(folder, prefix = "") {
    const items = await readdir(folder, { withFileTypes: true });
    items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const item of items) {
      if (item.name === ".git") continue;
      const absolute = join(folder, item.name),
        key = prefix + item.name;
      if (item.isSymbolicLink()) throw new Error("vault_symlink_unsupported");
      if (item.isDirectory()) await walk(absolute, key + "/");
      else if (item.isFile())
        entries.push({ path: key, bytes: await readFile(absolute) });
      else throw new Error("vault_file_type_unsupported");
    }
  }
  await walk(vault);
  const result = await buildVault(entries, {
    repositoryUrl: values["--repository"],
    ref,
    title: values["--title"] || "Obsidian 노트",
  });
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await mkdir(output, { mode: 0o700 }); // No replacement of an earlier export.
  for (const [name, value] of [
    ["notes.json", result.notesBackup],
    ["supporting-files.json", result.filesBackup],
    ["private-audit.json", result.manifest],
    ["review.json", result.review],
  ])
    await writeFile(join(output, name), JSON.stringify(value), {
      flag: "wx",
      mode: 0o600,
    });
  await writeFile(
    join(output, "review.html"),
    renderReviewHTML(result.review),
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(join(output, "review-tool.html"), await renderDecisionTool(), { flag: "wx", mode: 0o600 });
  execFileSync(
    "git",
    [
      "-C",
      vault,
      "bundle",
      "create",
      join(output, "repository.bundle"),
      "--all",
    ],
    { stdio: "pipe" },
  );
  const { chmod } = await import("node:fs/promises");
  await chmod(join(output, "repository.bundle"), 0o600);
  const archive = {};
  for (const name of ["notes.json", "supporting-files.json", "private-audit.json", "review.json", "review.html", "repository.bundle", "review-tool.html"])
    archive[name] = new Uint8Array(await readFile(join(output, name)));
  await writeFile(join(output, "vault-package.zip"), Zip.zipSync(archive, { level: 0 }), { flag: "wx", mode: 0o600 });
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
