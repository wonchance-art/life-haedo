/* Read-only Markdown thumbnails on the real home/schedule UI, fake account + real IDB.
 * npm run dev; node tests/post-markdown-thumbnails-browser.cjs
 * Does not enter the legacy editor or contact a production account. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const output = path.resolve(process.env.POST_MARKDOWN_THUMBNAILS_OUTPUT || '.local/post-markdown-thumbnails');
const report = { checks: [], consoleErrors: [], pageErrors: [] };
async function seed(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, ws = await s.getActive();
    const photos = [];
    for (const [width, height, color] of [[320, 200, '#9b2929'], [200, 120, '#276b4d']]) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const drawing = canvas.getContext('2d'); drawing.fillStyle = color; drawing.fillRect(0, 0, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      photos.push(await m.readPhoto(new File([blob], 'anonymous-' + width + '.png', { type: blob.type }), c.id));
    }
    const legacy = m.create(c.id, '2026-11-05T03:00:00.000Z'); legacy.status = 'saved'; legacy.title = 'Markdown 사진 순서 검수';
    legacy.photos = photos;
    legacy.ops = [{ insert: '본문 순서와 사진 배열 순서가 다른 글\n' },
      { insert: { photo: { id: photos[1].id, alt: '본문의 첫 초록 사진', caption: '첫 사진 설명' } } },
      { insert: { photo: { id: photos[0].id, alt: '본문의 둘째 빨강 사진', caption: '둘째 사진 설명' } } }, { insert: '\n' }];
    const doc = HaedoLife.PostMarkdown.fromV2(legacy).document;
    // Metadata order intentionally differs from embedded order. Both remain valid.
    doc.photos = photos;
    m.validate(doc);
    await s.savePhotoPost(ws, doc, 0);
    const stored = await s.readPhotoPost(ws, doc.id);
    if (stored.format !== 'life-post-md-v1' || stored.photos[0].id === m.contentOps(stored).find(op => op.insert?.photo).insert.photo.id) throw new Error('thumbnail order fixture was not preserved');
    return { id: doc.id, title: doc.title };
  });
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [390, 1440]) {
      const context = await makeContext(browser, new FakeCloud(), 'markdown-thumbnails-' + width, accounts.a,
        { viewport: { width, height: 1000 }, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => report.pageErrors.push({ width, message: error.message }));
      page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ width, message: event.text() }); });
      try {
        await page.goto(base + '/index.html'); await ready(page); const doc = await seed(page);
        await page.reload(); await ready(page);
        const row = page.locator('.home-post[data-photo-post-id="' + doc.id + '"]');
        await row.locator('.home-post-media').scrollIntoViewIfNeeded();
        const home = row.locator('img.home-post-cover');
        await home.waitFor(); await page.waitForFunction(id => {
          const image = document.querySelector('.home-post[data-photo-post-id="' + id + '"] img.home-post-cover');
          return image?.complete && image.naturalWidth === 200 && image.naturalHeight === 120;
        }, doc.id);
        assert.equal(await home.getAttribute('alt'), '본문의 첫 초록 사진');
        assert.match(await home.getAttribute('src'), /^blob:/);
        assert.equal(await row.locator('.home-post-open').innerText(), doc.title);
        assert.equal(await row.locator('.home-photo-error').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        report.checks.push({ name: width + ': HomeUI shows the first embedded Markdown photo', pass: true });
        await page.screenshot({ path: path.join(output, 'home-' + width + '.png'), fullPage: true });
        await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-05'); await ready(page);
        const scheduleRow = page.locator('.schedule-row-photo').filter({ hasText: doc.title });
        await scheduleRow.scrollIntoViewIfNeeded();
        const thumb = scheduleRow.locator('.schedule-thumb'); const image = thumb.locator('img');
        await image.waitFor(); await page.waitForFunction(() => {
          const image = document.querySelector('.schedule-row-photo .schedule-thumb img');
          return image?.complete && image.naturalWidth === 200 && image.naturalHeight === 120;
        });
        assert.match(await image.getAttribute('src'), /^blob:/);
        assert.equal(await thumb.getAttribute('aria-label'), '본문의 첫 초록 사진');
        assert.equal(await scheduleRow.locator('.schedule-post-open').innerText(), doc.title);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        report.checks.push({ name: width + ': ScheduleUI shows the first embedded Markdown photo', pass: true });
        await page.screenshot({ path: path.join(output, 'day-' + width + '.png'), fullPage: true });
      } finally { await context.close(); }
    }
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []);
    report.pass = report.checks.length === 4;
    for (const check of report.checks) console.log('PASS ' + check.name);
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
