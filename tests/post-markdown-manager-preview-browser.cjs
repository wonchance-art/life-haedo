/* Actual BlogManager controls + actual sanitized photo copies/renderer, synthetic storage only.
 * node tests/post-markdown-manager-preview-browser.cjs
 * Two photo metadata records A,B are rendered in body order B,A. Pixel checks verify
 * that caption/alt text is paired with the corresponding image, not only its array slot.
 * No real account, publication call or operating server is used. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright } = require('./unified-home-browser.cjs');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.POST_MARKDOWN_MANAGER_OUTPUT || path.join(root, '.local/post-markdown-manager-preview'));
const report = { checks: [], consoleErrors: [], pageErrors: [], externalRequests: [] };
const files = ['vendor/markdown-it/markdown-it.umd.min.js', 'assets/life/page-posts.js', 'assets/life/photo-post.js',
  'assets/life/post-markdown.js', 'assets/life/blog.js', 'assets/life/blog-public-ui.js', 'assets/life/blog-manager.js'];
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [390, 1440]) for (const format of ['v2', 'md']) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.route('**/*', route => {
        if (route.request().url() !== 'http://127.0.0.1:4198/') { report.externalRequests.push(route.request().url()); return route.abort(); }
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>공개 미리보기 검수</title><style>body{margin:20px;font:16px/1.7 sans-serif}main{max-width:720px;margin:auto}input,textarea,button{font:inherit;max-width:100%}button{min-height:44px}label{display:block}figure{margin:16px 0}img{width:180px;max-width:100%;height:auto;image-rendering:pixelated}figcaption{white-space:pre-wrap}</style><main id="manager"></main></html>' });
      });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', error => report.pageErrors.push({ width, format, message: error.message }));
      page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ width, format, message: event.text() }); });
      try {
        await page.goto('http://127.0.0.1:4198/');
        for (const file of files) await page.addScriptTag({ path: path.join(root, file) });
        await page.evaluate(async format => {
          const life = HaedoLife, model = life.PhotoPost, photos = [];
          for (const [id, rgb] of [['photo-a', [220, 30, 30]], ['photo-b', [30, 180, 60]]]) {
            const canvas = document.createElement('canvas'); canvas.width = 12; canvas.height = 8;
            const drawing = canvas.getContext('2d'); drawing.fillStyle = `rgb(${rgb.join(',')})`; drawing.fillRect(0, 0, canvas.width, canvas.height);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            photos.push(await model.readPhoto(new File([blob], id + '.png', { type: blob.type }), () => id));
          }
          const legacy = model.create(() => 'preview-post', '2026-11-05T03:00:00.000Z');
          legacy.title = '사진과 설명 짝 검수'; legacy.status = 'saved'; legacy.revision = 1; legacy.photos = photos;
          legacy.ops = [{ insert: '사진 앞\n' },
            { insert: { photo: { id: photos[1].id, caption: 'B 초록 사진 설명', alt: 'B 초록 사진' } } }, { insert: '\n' },
            { insert: '두 사진 사이', attributes: { bold: true } }, { insert: '\n' },
            { insert: { photo: { id: photos[0].id, caption: 'A 빨강 사진 설명', alt: 'A 빨강 사진' } } }, { insert: '\n끝\n' }];
          const doc = format === 'md' ? life.PostMarkdown.fromV2(legacy).document : legacy;
          doc.photos = photos; model.validate(doc);
          window.fixture = { doc, legacy, publishCalls: 0, snapshot: null };
          const actual = life.BlogPublicUI.render;
          life.BlogPublicUI = { ...life.BlogPublicUI, render(snapshot, options) { fixture.snapshot = structuredClone(snapshot); return actual(snapshot, options); } };
          const storage = {
            async read() { return { sources: [] }; }, async readWorkbench() { return { page: { posts: [] } }; },
            async listPhotoPosts() { return [{ id: doc.id, title: doc.title, revision: doc.revision, status: doc.status, archived: false, updatedAt: doc.updatedAt, body: model.plainText(doc), photos: 2, attachments: 0 }]; },
            async readPhotoPost() { return structuredClone(doc); }, async readPageDrafts() { return { posts: [] }; }, async listStages() { return []; },
          };
          const blogSync = { async getState() { return { status: 'synced', remoteRevision: 1, publication: null }; },
            async statuses() { return { [doc.id]: 'synced' }; }, async publish() { fixture.publishCalls++; throw new Error('This test must not publish'); } };
          window.manager = life.BlogManager.create({ storage, workspaceId: 'fixture-space', blogSync });
          await manager.mount(document.querySelector('#manager'), { postId: doc.id, expectedRevision: 1 });
        }, format);
        await page.getByRole('button', { name: '공개 내용 검토', exact: true }).click();
        await page.locator('.blog-manager-preview').waitFor();
        assert.equal(await page.locator('[data-photo-id]:checked').count(), 0, 'photo publication remains opt-in');
        for (const id of ['photo-a', 'photo-b']) await page.locator('[data-photo-id="' + id + '"]').check();
        await page.getByRole('button', { name: '공개 미리보기 갱신', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('.blog-manager-public-preview img').length === 2 && [...document.querySelectorAll('.blog-manager-public-preview img')].every(img => img.complete && img.naturalWidth === 12));
        const rendered = await page.evaluate(async () => {
          const figures = [...document.querySelectorAll('.blog-manager-public-preview figure')];
          return Promise.all(figures.map(async figure => {
            const img = figure.querySelector('img'), canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
            const drawing = canvas.getContext('2d'); drawing.drawImage(img, 0, 0, 1, 1);
            return { alt: img.alt, caption: figure.querySelector('figcaption').textContent,
              pixel: [...drawing.getImageData(0, 0, 1, 1).data], digest: await HaedoLife.PhotoPost.digest(await (await fetch(img.src)).blob()) };
          }));
        });
        assert.deepEqual(rendered.map(item => ({ alt: item.alt, caption: item.caption, pixel: item.pixel })), [
          { alt: 'B 초록 사진', caption: 'B 초록 사진 설명', pixel: [30, 180, 60, 255] },
          { alt: 'A 빨강 사진', caption: 'A 빨강 사진 설명', pixel: [220, 30, 30, 255] },
        ], 'body B→A must show B pixels beside B caption and A pixels beside A caption');
        const snapshotDigests = await page.evaluate(() => fixture.snapshot.ops.filter(op => typeof op.insert !== 'string').map(op => fixture.snapshot.photos.find(photo => photo.id === op.insert.photo.id).digest));
        assert.deepEqual(rendered.map(item => item.digest), snapshotDigests, 'preview image bytes must match the snapshot metadata for the same body reference');
        assert.equal(await page.evaluate(() => fixture.publishCalls), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        report.checks.push({ name: `${width} ${format}: actual manager preview keeps caption, alt and sanitized photo bytes paired`, pass: true });
        await page.screenshot({ path: path.join(output, `preview-${format}-${width}.png`), fullPage: true });
        await page.evaluate(() => manager.dispose());
      } finally { await context.close(); }
    }
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
    report.pass = report.checks.length === 4;
    for (const check of report.checks) console.log('PASS ' + check.name);
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
