// Build the anonymous comparison as one offline HTML file; not a public site build.
// Usage: node scripts/build-expression-preview.mjs [output.html]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = resolve(root, 'expression-sample.html');
const output = resolve(root, process.argv[2] || '.local/expression-design/expression-comparison.html');
if (process.argv.length > 3) throw new Error('Usage: node scripts/build-expression-preview.mjs [output.html]');
const outputDirs = ['.local/expression-design', 'docs/design-review/evidence/expression-page'].map(path => resolve(root, path));
if (!output.endsWith('.html') || !outputDirs.some(path => output.startsWith(path + sep))) {
  throw new Error('Write the preview HTML below .local/expression-design/ or docs/design-review/evidence/expression-page/, never into the public site output.');
}

const styles = ['assets/life/ui.css', 'assets/life/workbench.css', 'assets/design-expression/ui.css'];
const scripts = ['assets/life/icons.js', 'assets/design-expression/sample-data.js', 'assets/design-expression/ui.js'];
const assetPaths = [...styles, ...scripts];
const assetTexts = new Map(await Promise.all(assetPaths.map(async path => [path, await readFile(resolve(root, path), 'utf8')])));
const used = new Set();
let html = await readFile(input, 'utf8');
function attribute(tag, name) {
  const match = tag.match(new RegExp('\\b' + name + '\\s*=\\s*(["\'])(.*?)\\1', 'i'));
  return match?.[2];
}
function asset(path, allowed) {
  if (!allowed.includes(path) || used.has(path)) throw new Error('Unexpected or duplicate preview asset: ' + (path || '(missing path)'));
  used.add(path);
  return assetTexts.get(path);
}
html = html.replace(/<link\b[^>]*>/gi, tag => {
  const rel = attribute(tag, 'rel'), href = attribute(tag, 'href');
  if (rel === 'icon' && href === 'icon.svg') return '';
  if (rel !== 'stylesheet') throw new Error('Unexpected preview link: ' + (href || '(missing path)'));
  const css = asset(href, styles);
  if (/@import\b|\burl\s*\(|<\/style\b/i.test(css)) throw new Error('Preview styles must be self-contained: ' + href);
  return '<style>\n' + css + '\n</style>';
});
html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (tag, attrs, body) => {
  if (body.trim()) throw new Error('The preview input must use only the approved external script tags.');
  const src = attribute(attrs, 'src');
  const js = asset(src, scripts);
  if (/<\/script\b/i.test(js)) throw new Error('Preview script contains an HTML closing tag: ' + src);
  return '<script>\n' + js + '\n</script>';
});
if (used.size !== assetPaths.length) throw new Error('The comparison must include every approved style and script exactly once.');
if (/<(?:script|link)\b[^>]*\b(?:src|href)\s*=/i.test(html)) throw new Error('A linked preview dependency remains.');
if (/<meta\b[^>]*http-equiv\s*=\s*(["'])refresh\1/i.test(html) || /<base\b/i.test(html)) throw new Error('The preview cannot redirect or set a remote base URL.');

// Inline code/styles only. Sample URLs are inert text; no connections, forms,
// embedded pages, fonts or external images are permitted even when opened offline.
const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
if (!/<head\b[^>]*>/i.test(html)) throw new Error('The preview input is missing its head element.');
html = html.replace(/<head\b[^>]*>/i, tag => tag + '\n  <meta http-equiv="Content-Security-Policy" content="' + policy + '">');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, html, 'utf8');
console.log('Built offline expression comparison: ' + output);
