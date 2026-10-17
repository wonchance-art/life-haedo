/* Offline CLI: all validation precedes output; no account/workspace writes. */
import { join } from "node:path";
import Decisions from "./lib/obsidian-decisions.js";
import Package from "../assets/life/obsidian-package.js";
import Zip from "../vendor/fflate/fflate.js";
import { renderDecisionTool } from "./lib/obsidian-decision-tool.mjs";
import { PACKAGE_FILES, readPackage, readPrivateFile, privateDestination, writeNewPackage } from "./lib/private-vault-files.mjs";
const values = {};
async function main() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--preview") { values.preview = true; continue; }
    if (!["--input", "--decisions", "--output"].includes(args[i]) || !args[i + 1] || values[args[i]]) throw new Error("invalid_arguments");
    values[args[i]] = args[++i];
  }
  if (!values["--input"] || !values["--decisions"] || (!values.preview && !values["--output"])) throw new Error("missing_arguments");
  const { root, files } = await readPackage(values["--input"]);
  const handle = await Decisions.openPackage({ notes: files["notes.json"].toString(), supporting: files["supporting-files.json"].toString(),
    audit: files["private-audit.json"].toString(), review: files["review.json"].toString() });
  const decisions = JSON.parse((await readPrivateFile(values["--decisions"], 8 * 1024 * 1024)).toString());
  const preview = Decisions.preview(handle, decisions);
  if (values.preview) { console.log(JSON.stringify({ preview: true, ...preview.summary })); return; }
  const output = await privateDestination(values["--output"], [root]);
  const applied = await Decisions.apply(handle, decisions);
  let history = [];
  try {
    history = JSON.parse((await readPrivateFile(join(root, "applications.json"))).toString());
    if (!Array.isArray(history)) throw new Error("invalid_history");
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  let tool;
  try { tool = await readPrivateFile(join(root, "review-tool.html")); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  // Existing tools are retained as opaque bytes, never imported or executed.
  if (!tool) tool = await renderDecisionTool();
  const result = { ...files, "notes.json": JSON.stringify(applied.notesBackup),
    "decisions.json": JSON.stringify(applied.decisions), "applications.json": JSON.stringify([...history, applied.history]),
    "review-tool.html": tool };
  const archive = {};
  for (const name of [...PACKAGE_FILES, "decisions.json", "applications.json", "review-tool.html"])
    archive[name] = typeof result[name] === "string" ? new TextEncoder().encode(result[name]) : new Uint8Array(result[name]);
  result["vault-package.zip"] = Zip.zipSync(archive, { level: 0 });
  // Verify the exact transport using the app reader; fresh validation copies are discarded.
  await Package.read(new Blob([result["vault-package.zip"]]));
  await writeNewPackage(output, result, [root]);
  console.log(JSON.stringify({ written: true, ...preview.summary, originalFilesPreserved: true }));
}
main().catch((e) => {
  console.error("No existing files were changed. Code: " + (e.code || (/^[a-z_]+$/.test(e.message) ? e.message : "decision_error")));
  process.exitCode = 1;
});
