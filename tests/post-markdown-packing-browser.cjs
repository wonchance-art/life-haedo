/* Independent capacity-packing review: real renderer, synthetic data only. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { playwright } = require('./unified-home-browser.cjs');
const P = require('../assets/life/photo-post.js'), M = require('../assets/life/post-markdown.js'), B = require('../assets/life/blog.js');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, '.local/b2-independent');
// Baseline decoder measures the actual pre-packing expansion and fixes the
// canonical Markdown byte contract independently of the edited implementation.
const baseline = new Module(path.join(ROOT, 'assets/life/post-markdown.baseline.cjs'));
baseline.filename = path.join(ROOT, 'assets/life/post-markdown.baseline.cjs');
baseline.paths = Module._nodeModulePaths(path.dirname(baseline.filename));
baseline._compile(execFileSync('git', ['show', '5fcaa3f80947fa78352a9d8e1724de557141b4e8:assets/life/post-markdown.js'], { cwd: ROOT, encoding: 'utf8' }), baseline.filename);
const OLD = baseline.exports;
// Loading the historical UMD installs it globally; restore the product module.
globalThis.HaedoLife.PostMarkdown = M;
function fixture() {
  const doc = P.create(() => 'packing-post', '2026-11-05T00:00:00.000Z');
  doc.status = 'saved'; doc.title = '긴 문서의 원문과 AI 표시';
  const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
  doc.photos = ['p1', 'p2'].map(id => ({ id, name: id + '.png', type: blob.type, width: 1, height: 1, size: blob.size, digest: 'a'.repeat(64), blob }));
  const attrs = [
    { author: 'ai', bold: true, blockquote: true },
    { italic: true, list: 'bullet' },
    { author: 'ai', link: 'https://example.org/keep?x=1', header: 2 },
    { bold: true },
  ];
  doc.ops = [];
  for (let i = 0; i < 1000; i++) {
    doc.ops.push({ insert: '가😀\n\n나\n다\n', attributes: attrs[i % attrs.length] });
    if (i === 300 || i === 700) doc.ops.push({ insert: { photo: { id: i === 300 ? 'p1' : 'p2', alt: '대체 글', caption: '설명\n원문' } } });
  }
  P.validate(doc);
  const md = M.fromV2(doc).document;
  P.validate(md);
  assert.equal(md.markdown, OLD.fromDelta(doc.ops).markdown, 'canonical Markdown bytes unchanged from pinned main');
  assert(OLD.toDelta(md.markdown).length > 5000, 'fixture must actually trigger capacity packing');
  assert(M.toDelta(md.markdown).length <= 5000, 'packed document stays in the existing operation cap');
  return { doc, md, unpacked: OLD.toDelta(md.markdown).length, packed: M.toDelta(md.markdown).length };
}
async function main() {
  const { doc, md, unpacked, packed } = fixture();
  const { projectMarkdownOps } = await import('../supabase/functions/haedo-blog-publish/projection.mjs');
  for (const photoIds of [[], ['p2', 'p1']]) {
    const options = { photoIds, copies: md.photos.filter(photo => photoIds.includes(photo.id)).map(photo => ({
      id: photo.id, type: 'image/png', size: 1, width: 1, height: 1, digest: 'b'.repeat(64)
    })) }, browser = B.publicSnapshot(md, options);
    const selected = md.photos.filter(photo => photoIds.includes(photo.id));
    const privateIds = new Map(browser.photos.map((photo, index) => [photo.id, selected[index].id]));
    for (const op of browser.ops) if (typeof op.insert !== 'string') op.insert.photo.id = privateIds.get(op.insert.photo.id);
    const manifest = { ...md, photos: md.photos.map(P.metadata) };
    assert.equal(JSON.stringify(projectMarkdownOps(manifest, options)), JSON.stringify(browser.ops), 'actual Edge shared projection matches browser bytes for packed documents');
  }
  await fs.mkdir(OUT, { recursive: true });
  const report = { unpacked, packed, edgeProjectionChecks: 2, checks: [], pageErrors: [], consoleErrors: [], requests: [] };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => report.pageErrors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') report.consoleErrors.push(e.text()); });
    await page.route('**/*', route => { report.requests.push(route.request().url()); return route.abort(); });
    await page.setContent('<!doctype html><meta charset="utf-8"><main></main>');
    for (const file of ['page-posts.js', 'photo-post.js', 'blog.js', 'blog-public-ui.js']) await page.addScriptTag({ path: path.join(ROOT, 'assets/life', file) });
    for (const privateView of [false, true]) for (const includePhotos of [false, true]) {
      const options = { photoIds: includePhotos ? ['p1', 'p2'] : [] };
      const snapshot = value => privateView ? B.privateReadingSnapshot(value, options) : B.publicSnapshot(value, options);
      const original = snapshot(doc), converted = snapshot(md);
      const render = value => page.evaluate(({ value, privateView }) => {
        document.querySelector('main').replaceChildren(HaedoLife.BlogPublicUI.render(value, { privateView }));
        const article = document.querySelector('article');
        return { html: article.innerHTML, text: article.textContent, ai: article.querySelectorAll('.blog-ai-text').length, photos: article.querySelectorAll('figure').length };
      }, { value, privateView });
      const before = await render(original), after = await render(converted);
      assert.deepEqual(after, before, 'packed v2/Markdown actual renderer equality, including AI and blank paragraphs');
      assert.equal(after.photos, includePhotos ? 2 : 0);
      assert.equal(after.ai > 0, privateView);
      report.checks.push({ privateView, includePhotos, aiSpans: after.ai, pass: true });
    }
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.requests, []);
    report.pass = true; console.log(JSON.stringify(report));
  } finally { await browser.close(); await fs.writeFile(path.join(OUT, 'packing-browser.json'), JSON.stringify(report, null, 2) + '\n'); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
