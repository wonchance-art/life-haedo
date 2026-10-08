// Build an offline comparison. Does not change the public site allowlist.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'design/book-workshop');
const output = resolve(root, 'docs/design-review/evidence/book-design-reset/comparison.html');
let html = await readFile(resolve(source, 'index.html'), 'utf8');
const css = await readFile(resolve(source, 'ui.css'), 'utf8');
if (/@import\b|\burl\s*\(|<\/style/i.test(css)) throw new Error('Comparison CSS must be local and self contained.');
html = html.replace('<link rel="stylesheet" href="ui.css">', `<style>\n${css}\n</style>`);
for (const file of ['../../assets/life/icons.js', 'sample.js', 'ui.js']) {
  const code = await readFile(resolve(source, file), 'utf8');
  if (/<\/script/i.test(code)) throw new Error('Unexpected closing script tag.');
  html = html.replace(`<script src="${file}"></script>`, `<script>\n${code}\n</script>`);
}
const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
html = html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, html);
console.log('Built offline comparison: docs/design-review/evidence/book-design-reset/comparison.html');
