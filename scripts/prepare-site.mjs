import { cp, mkdir, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
const destination = resolve(process.argv[2] || ".local/site");
const url = process.env.HAEDO_SUPABASE_URL || "";
const key = process.env.HAEDO_SUPABASE_KEY || "";
if (
  !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url) ||
  !key.startsWith("sb_publishable_")
) {
  throw new Error(
    "A dedicated project URL and publishable key are required. Values are never logged.",
  );
}
await mkdir(destination, { recursive: true });
for (const path of [
  "index.html",
  "login.html",
  "workspace.html",
  "timeline.html",
  "goals.html",
  "habits.html",
  "privacy.html",
  "assets",
  "vendor",
  "icon.svg",
  "icon-maskable.svg",
  "manifest.webmanifest",
  "sw.js",
]) {
  await access(path);
  await cp(path, resolve(destination, path), { recursive: true });
}
await writeFile(
  resolve(destination, "assets/platform-config.js"),
  "window.HAEDO_CONFIG=Object.freeze(" +
    JSON.stringify({ url: url.replace(/\/$/, ""), key }) +
    ");\n",
);
await writeFile(resolve(destination, ".nojekyll"), "");
console.log(
  "Prepared public app shell. Personal files, Git metadata and credentials are excluded.",
);
