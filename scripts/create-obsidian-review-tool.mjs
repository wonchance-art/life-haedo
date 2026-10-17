import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { privateDestination } from "./lib/private-vault-files.mjs";
import { renderDecisionTool } from "./lib/obsidian-decision-tool.mjs";
async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== "--output") throw new Error("Use --output PRIVATE_HTML_PATH");
  const output = await privateDestination(process.argv[3]);
  const html = await renderDecisionTool();
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, html, { flag: "wx", mode: 0o600 });
  console.log("Private review tool created; no personal files were embedded.");
}
main().catch((e) => { console.error("Tool not replaced. Code: " + (e.code || "tool_error")); process.exitCode = 1; });
