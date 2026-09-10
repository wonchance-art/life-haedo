import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
let scriptCount = 0;
let resourceCount = 0;

async function localResource(reference, owner) {
  if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return;
  const path = decodeURIComponent(reference.split(/[?#]/)[0]);
  if (!path) return;
  const absolute = resolve(dirname(resolve(root, owner)), path);
  const info = await stat(absolute).catch(() => null);
  assert(info && (info.isFile() || info.isDirectory()), `${owner}: missing ${reference}`);
  resourceCount++;
}

const htmlFiles = (await readdir(root)).filter(name => name.endsWith('.html'));
for (const name of htmlFiles) {
  const html = await readFile(resolve(root, name), 'utf8');
  let inline = 0;
  // These pages use classic inline scripts. Parse without executing application code.
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    const type = match[1].match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
    if (type && !/^(text|application)\/javascript$/i.test(type)) {
      assert.notEqual(type, 'module', `${name}: extend check.mjs for module scripts`);
      continue;
    }
    new Script(match[2], { filename: `${name}:inline-${++inline}` });
    scriptCount++;
  }
  for (const tag of html.matchAll(/<(?:script|link|img)\b[^>]*>/gi)) {
    for (const attr of tag[0].matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      await localResource(attr[1], name);
    }
  }
}

for (const name of ['sw.js', ...((await Promise.all(['scripts', 'assets'].map(async dir => (await readdir(resolve(root, dir))).filter(name => /\.(?:mjs|js)$/.test(name)).map(name => `${dir}/${name}`)))).flat())]) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, name)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${name}: ${result.stderr || result.error || 'syntax check failed'}`);
  scriptCount++;
}

const manifest = JSON.parse(await readFile(resolve(root, 'manifest.webmanifest'), 'utf8'));
assert(manifest.name && manifest.start_url && manifest.scope, 'Incomplete PWA manifest');
for (const icon of manifest.icons ?? []) await localResource(icon.src, 'manifest.webmanifest');
await localResource(manifest.start_url, 'manifest.webmanifest');
const sw = await readFile(resolve(root, 'sw.js'), 'utf8');
const shell = sw.match(/const SHELL=\[([^\]]*)\]/)?.[1];
assert(shell, 'Service worker SHELL list not found; update the checker if its format changes');
for (const entry of shell.matchAll(/['"]([^'"]+)['"]/g)) await localResource(entry[1], 'sw.js');

console.log(`PASS: ${htmlFiles.length} HTML pages, ${scriptCount} JavaScript blocks/files, ${resourceCount} local resource references, PWA manifest and shell.`);
console.log('Browser interactions, remote resources and cloud sync need separate verification.');
