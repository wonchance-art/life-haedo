/* D2 public projection/rendering in the real browser, with synthetic local data only.
 * node tests/post-markdown-public-browser.cjs
 * Covers empty/photo-ending Markdown snapshots and v2/Markdown display equivalence.
 * Publication itself is deliberately blocked by the phase-1 migration. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { playwright } = require('./unified-home-browser.cjs');
const Photo = require('../assets/life/photo-post.js');
const Blog = require('../assets/life/blog.js');
const Markdown = require('../assets/life/post-markdown.js');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.POST_MARKDOWN_PUBLIC_OUTPUT || path.join(root, '.local/post-markdown-public'));
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6jSEAAAAASUVORK5CYII=', 'base64');
const report = { checks: [], consoleErrors: [], pageErrors: [], externalRequests: [] };
async function fixtures() {
  const blob = new Blob([imageBytes], { type: 'image/png' });
  const photo = { id: randomUUID(), name: '익명 검수.png', type: blob.type, width: 1, height: 1, size: blob.size, digest: await Photo.digest(blob), blob };
  const doc = Photo.create(randomUUID, '2026-11-05T00:00:00.000Z');
  doc.status = 'saved'; doc.title = '익명 검수 글'; doc.photos = [photo];
  doc.ops = [{ insert: { photo: { id: photo.id, alt: '한 장', caption: '끝 사진\n둘째 설명' } } }, { insert: '\n' }];
  const md = Markdown.fromV2(doc).document;
  md.markdown = Markdown.fromDelta(doc.ops.slice(0, -1)).markdown;
  const empty = Blog.publicSnapshot(md);
  const photoEnded = Blog.publicSnapshot(md, { photoIds: [photo.id] });
  assert.deepEqual(empty.ops, []);
  assert.equal(typeof photoEnded.ops.at(-1).insert, 'object');
  const ops = [
    { insert: '제목' }, { insert: '\n', attributes: { header: 1 } },
    { insert: '첫 문단\n둘째 문단\n\n' },
    { insert: '강조한 두 줄\n한 줄 더\n', attributes: { bold: true } },
    { insert: '목록 하나\n목록 둘\n', attributes: { list: 'bullet' } },
    { insert: '번호 하나\n번호 둘\n', attributes: { list: 'ordered' } },
    { insert: '인용 하나\n인용 둘\n', attributes: { blockquote: true } },
    { insert: 'AI 제안', attributes: { author: 'ai', italic: true } }, { insert: '\n' },
    { insert: '안전한 링크', attributes: { link: 'https://example.org/a%20b?x=&amp;' } }, { insert: '\n' },
    { insert: { photo: { id: photo.id, alt: '사진의 대체 글', caption: '사진 설명\n두 줄' } } },
    { insert: '사진 뒤\n마지막\n' },
  ];
  const old = { ...doc, ops }, converted = Markdown.fromV2(old).document;
  Photo.validate(old); Photo.validate(converted);
  const options = { photoIds: [photo.id], author: { name: '검수 작성자', intro: '' } };
  const boundaryOld = { ...doc, ops: [{ insert: '사진 앞' }, doc.ops[0], { insert: '사진 뒤\n' }] };
  const boundaryMd = Markdown.fromV2(boundaryOld).document;
  return { empty, photoEnded, boundaryOld: Blog.publicSnapshot(boundaryOld), boundaryMd: Blog.publicSnapshot(boundaryMd), old: Blog.publicSnapshot(old, options), md: Blog.publicSnapshot(converted, options),
    privateOld: Blog.privateReadingSnapshot(old, options), privateMd: Blog.privateReadingSnapshot(converted, options) };
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const snapshots = await fixtures();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      page.on('pageerror', error => report.pageErrors.push(error.message));
      page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push(event.text()); });
      await context.route('**/*', route => { report.externalRequests.push(route.request().url()); return route.abort(); });
      try {
        await page.setContent('<!doctype html><html lang="ko"><meta charset="utf-8"><style>body{font:16px/1.7 sans-serif;margin:20px}article{max-width:700px}figcaption{white-space:pre-wrap}img{max-width:100%}</style><main id="fixture"></main></html>');
        for (const file of ['page-posts.js', 'photo-post.js', 'blog.js', 'blog-public-ui.js']) await page.addScriptTag({ path: path.join(root, 'assets/life', file) });
        await page.evaluate(bytes => {
          window.photoURL = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
          window.renderSnapshot = (snapshot, options = {}) => {
            document.querySelector('#fixture').replaceChildren(HaedoLife.BlogPublicUI.render(snapshot, { photoUrl: () => photoURL, ...options }));
            return document.querySelector('article').innerHTML;
          };
        }, [...imageBytes]);
        await page.evaluate(snapshot => renderSnapshot(snapshot), snapshots.empty);
        assert.equal(await page.locator('.blog-line').count(), 0, 'omitted photos must not create a blank paragraph');
        assert.equal(await page.locator('figure,img').count(), 0);
        assert.equal(await page.locator('.blog-title').innerText(), '익명 검수 글');
        report.checks.push({ name: width + ': empty public body renders title only', pass: true });
        await page.evaluate(snapshot => renderSnapshot(snapshot), snapshots.photoEnded);
        assert.equal(await page.locator('.blog-line').count(), 0, 'photo-ending snapshot must not gain a blank paragraph');
        assert.equal(await page.locator('figure').count(), 1);
        assert.equal(await page.locator('figcaption').innerText(), '끝 사진\n둘째 설명');
        assert.equal(await page.locator('img').getAttribute('alt'), '한 장');
        await page.locator('img').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => { const img = document.querySelector('img'); return img.complete && img.naturalWidth === 1; });
        assert.match(await page.locator('img').getAttribute('src'), /^blob:/);
        assert.equal(await page.locator('.blog-photo-error').isVisible(), false);
        report.checks.push({ name: width + ': photo-ending body renders a real local blob without added paragraphs', pass: true });
        for (const privateView of [false, true]) {
          const old = privateView ? snapshots.privateOld : snapshots.old;
          const md = privateView ? snapshots.privateMd : snapshots.md;
          const originalHTML = await page.evaluate(({ snapshot, privateView }) => renderSnapshot(snapshot, { privateView }), { snapshot: old, privateView });
          const markdownHTML = await page.evaluate(({ snapshot, privateView }) => renderSnapshot(snapshot, { privateView }), { snapshot: md, privateView });
          assert.equal(markdownHTML, originalHTML, 'rendered v2/Markdown DOM must match including multiline block attributes');
          assert.equal(await page.locator('.blog-ai-text').count(), privateView ? 1 : 0);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          report.checks.push({ name: width + ': ' + (privateView ? 'private' : 'public') + ' v2/Markdown rendered DOM equality', pass: true });
        }
        await page.screenshot({ path: path.join(output, 'render-' + width + '.png'), fullPage: true });
        const oldBoundary = await page.evaluate(snapshot => renderSnapshot(snapshot), snapshots.boundaryOld);
        const mdBoundary = await page.evaluate(snapshot => renderSnapshot(snapshot), snapshots.boundaryMd);
        assert.equal(mdBoundary, oldBoundary, 'omitting a photo must preserve the source paragraph boundary in both formats');
        assert.deepEqual(await page.locator('.blog-line').allTextContents(), ['사진 앞', '사진 뒤']);
        assert.equal(await page.locator('figure,img').count(), 0);
        report.checks.push({ name: width + ': omitted photo preserves both surrounding paragraphs', pass: true });
        await page.screenshot({ path: path.join(output, 'omitted-photo-' + width + '.png'), fullPage: true });
        await page.evaluate(() => URL.revokeObjectURL(photoURL));
      } finally { await context.close(); }
    }
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.consoleErrors, []);
    assert.deepEqual(report.externalRequests, []);
    report.pass = report.checks.length === 10;
    for (const check of report.checks) console.log('PASS ' + check.name);
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
