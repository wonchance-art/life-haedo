// Rebuild from this directory: npm ci --ignore-scripts && npm run build.
import { build } from 'esbuild';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const result = await build({ entryPoints: ['entry.mjs'], outfile: 'tiptap.umd.min.js', bundle: true, minify: true,
  format: 'iife', globalName: 'HaedoTiptap', platform: 'browser', target: ['es2020'], legalComments: 'linked', metafile: true });
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (match) packages.set(match[1], `node_modules/${match[1]}`);
}
let notices = 'Runtime dependency licenses for tiptap.umd.min.js\n';
const dependencies = [];
for (const [name, directory] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const pkg = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
  const files = await readdir(directory), license = files.find(file => /^licen[cs]e(?:\.|$)/i.test(file));
  if (!license) throw new Error(`Missing license: ${name}`);
  notices += `\n===== ${name}@${pkg.version} (${pkg.license}) =====\n${await readFile(`${directory}/${license}`, 'utf8')}\n`;
  dependencies.push({ name, version: pkg.version, license: pkg.license });
}
await writeFile('LICENSES.txt', notices);
const bytes = await readFile('tiptap.umd.min.js');
await writeFile('manifest.json', JSON.stringify({ version: '3.32.2', bytes: bytes.length, gzipBytes: gzipSync(bytes).length,
  sha256: createHash('sha256').update(bytes).digest('hex'), dependencies }, null, 2) + '\n');
console.log(`Bundle: ${bytes.length} bytes; gzip: ${gzipSync(bytes).length} bytes; ${dependencies.length} licensed runtime packages.`);
