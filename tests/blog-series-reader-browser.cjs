'use strict';
// Component lifecycle in a real browser. Full owner/IndexedDB journeys live in
// blog-series-browser.cjs; these snapshots and read failures are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright } = require('./unified-home-browser.cjs');
const base = process.env.BASE_URL || 'http://127.0.0.1:4209';
const output = path.resolve(__dirname, '../.local/blog-series-reader');
const report = { checks: [], consoleErrors: [], pageErrors: [], external: [],
  scope: 'Real browser DOM, PhotoPost/Blog/BlogSeries models and private renderer. Synthetic immutable snapshots, read failures and account lifecycle; separate from full owner/IndexedDB QA. No production, publication or Apple-device claim.' };

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version(); report.node = process.version;
  let active;
  async function fixture() {
    const context = await browser.newContext({ viewport: { width: 820, height: 1000 }, serviceWorkers: 'block' }); active = context;
    await context.route('**/*', route => {
      const origin = new URL(route.request().url()).origin;
      if (origin === new URL(base).origin) return route.continue();
      report.external.push(origin); return route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => !!globalThis.HaedoLife?.BlogPublicUI && !!globalThis.HaedoLife?.PhotoPost);
    for (const [globalName, file] of [['BlogSeries', 'blog-series.js'], ['BlogSeriesReader', 'blog-series-reader.js']]) {
      if (!await page.evaluate(name => !!HaedoLife[name], globalName)) await page.addScriptTag({ url: base + '/assets/life/' + file });
    }
    await page.addStyleTag({ content: 'body>:not(#seriesReaderTestHost){display:none!important}#seriesReaderTestHost{display:block;max-width:680px;margin:0 auto;padding:24px 20px 90px}' });
    await page.evaluate(async () => {
      const life = HaedoLife, M = life.PhotoPost;
      const make = (title, body) => { const doc = M.create(() => crypto.randomUUID()); doc.status = 'saved'; doc.revision = 1; doc.title = title; doc.ops = [{ insert: body + '\n' }]; return doc; };
      const old = make('', '사진 없이 남긴 첫 여행 기록'); old.format = 'life-photo-post-v1'; delete old.attachments; delete old.archived;
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 960;
      const context = canvas.getContext('2d'); context.fillStyle = '#285e59'; context.fillRect(0, 0, 1280, 960);
      const photo = await M.readPhoto(new File([await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))], '여행-원본.png', { type: 'image/png' }), () => crypto.randomUUID());
      const rich = make('둘째 날의 여행과 원본 사진', '긴 한글 본문과 직접 남긴 생각\n'.repeat(180)); rich.photos = [photo];
      rich.ops.push({ insert: { photo: { id: photo.id, caption: '축소하지 않은 원본 사진 설명', alt: '짙은 청록색 익명 시험 사진' } } }, { insert: '\n' });
      const last = make('마지막 날 · 줄바꿈 없이 긴 제목 '.repeat(12), '마지막 날에 남긴 내용');
      const series = life.BlogSeries.create(() => 'synthetic_series'); series.title = '천천히 이어 읽는 여행 모음';
      series.intro = '모음 소개도 자르지 않고 보여줍니다.\n'.repeat(45);
      const docs = [old, rich, last]; series.items = docs.map((doc, index) => life.BlogSeries.item(doc, () => 'item_' + index));
      const value = { series, posts: docs.map((doc, index) => ({ itemId: series.items[index].id, doc })) }; life.BlogSeries.validateSnapshot(value);
      const host = document.createElement('main'); host.id = 'seriesReaderTestHost'; document.body.append(host);
      const state = window.readerTest = { value, valid: true, reads: 0, rendered: [], disposed: 0, activeURLs: new Set(), exits: 0, edits: [], failRead: false, failRender: false };
      const storage = { async readBlogSeriesSnapshot(ws, id) {
        if (ws !== 'synthetic_workspace' || id !== value.series.id) throw Error('Wrong reader scope'); state.reads++;
        if (state.holdRead) { state.readHeld = true; await new Promise(resolve => { state.releaseRead = resolve; }); }
        if (state.failRead) throw Object.assign(Error('Synthetic snapshot read failed'), { code: state.failRead === 'missing' ? 'blog_series_missing' : 'storage_error' });
        return structuredClone(state.value);
      } };
      const renderPhoto = async doc => {
        if (state.failRender) throw Error('Synthetic renderer failed');
        state.rendered.push(doc.id);
        const value = life.Blog.publicSnapshot(doc, { photoIds: doc.photos.map(photo => photo.id) });
        const urls = new Map(value.photos.map((photo, index) => { const url = URL.createObjectURL(doc.photos[index].blob); state.activeURLs.add(url); return [photo.id, url]; }));
        const node = life.BlogPublicUI.render(value, { privateView: true, photoUrl: photo => urls.get(photo.id) });
        const rendered = { node, dispose() { state.disposed++; for (const url of urls.values()) { URL.revokeObjectURL(url); state.activeURLs.delete(url); } } };
        if (state.holdRender) { state.renderHeld = true; await new Promise(resolve => { state.releaseRender = resolve; }); }
        return rendered;
      };
      window.seriesReader = life.BlogSeriesReader.create({ storage, workspaceId: 'synthetic_workspace', isCurrent: () => state.valid, renderPhoto,
        onExit: async () => { await seriesReader.flush(); state.exits++; }, onEdit: async value => { state.edits.push(value); } });
      state.mount = options => seriesReader.mount(host, { seriesId: value.series.id, ...options });
      state.before = JSON.stringify({ series: value.series, posts: value.posts.map(row => ({ itemId: row.itemId, manifest: life.Blog.pack(row.doc) })) });
      await state.mount();
    });
    await page.waitForFunction(() => document.activeElement?.id === 'blogSeriesReaderTitle');
    return page;
  }
  const check = async (name, run) => {
    if (process.env.SERIES_READER_MATCH && !new RegExp(process.env.SERIES_READER_MATCH).test(name)) return;
    console.log('START ' + name); const page = await fixture(); await run(page); report.checks.push(name); console.log('PASS ' + name);
    await active.close(); active = null;
  };
  try {
    await check('Contents keep complete introduction, defer photo rendering and restore the exact clicked row and scroll', async page => {
      assert.equal(await page.locator('.blog-series-toc-link').count(), 3);
      assert.equal(await page.getByRole('button', { name: '제목 없는 글', exact: true }).count(), 1);
      assert.equal(await page.locator('.blog-series-reader-intro').innerText(), await page.evaluate(() => readerTest.value.series.intro));
      assert.equal(await page.locator('.blog-series-reader img').count(), 0); assert.deepEqual(await page.evaluate(() => readerTest.rendered), []);
      const item = page.locator('.blog-series-toc-link[data-entry-id=item_1]'); await item.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => scrollY); await item.click(); await page.locator('.blog-series-reader-body[aria-busy=false] .blog-document').waitFor();
      assert.equal(await page.locator('.blog-series-reader-position').innerText(), '2 / 3');
      assert((await page.locator('.blog-document').innerText()).includes('긴 한글 본문과 직접 남긴 생각'));
      assert.equal(await page.locator('.blog-photo img').getAttribute('width'), '1280');
      assert.equal(await page.locator('.blog-photo img').getAttribute('height'), '960');
      await page.locator('#blogSeriesReaderContents').click();
      await page.waitForFunction(() => document.activeElement?.dataset.entryId === 'item_1');
      assert(Math.abs(await page.evaluate(() => scrollY) - before) <= 2);
      assert.equal(await page.evaluate(() => readerTest.activeURLs.size), 0); assert.equal(await page.evaluate(() => readerTest.reads), 1);
    });
    await check('Previous and next use frozen v1/v2 posts without rereading originals or changing the saved snapshot', async page => {
      await page.locator('.blog-series-toc-link[data-entry-id=item_0]').click();
      await page.locator('.blog-series-reader-body[aria-busy=false]').waitFor(); assert.equal(await page.locator('#blogSeriesReaderPrevious').isDisabled(), true);
      await page.locator('#blogSeriesReaderNext').click(); await page.locator('.blog-series-reader[data-entry-id=item_1] .blog-series-reader-body[aria-busy=false]').waitFor();
      await page.locator('.blog-photo img').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => { const image = document.querySelector('.blog-photo img'); return image?.complete && image.naturalWidth === 1280; });
      await page.getByRole('button', { name: '사진 원본 크기로 보기', exact: true }).click();
      const original = await page.locator('.blog-photo-frame').evaluate(frame => ({ image: frame.querySelector('img').getBoundingClientRect().width, scroll: frame.scrollWidth, width: frame.clientWidth }));
      assert.equal(original.image, 1280); assert(original.scroll > original.width);
      await page.locator('#blogSeriesReaderNext').click(); await page.locator('.blog-series-reader[data-entry-id=item_2] .blog-series-reader-body[aria-busy=false]').waitFor();
      assert.equal(await page.locator('#blogSeriesReaderNext').isDisabled(), true); assert.equal(await page.evaluate(() => readerTest.activeURLs.size), 0);
      await page.locator('#blogSeriesReaderPrevious').click(); await page.locator('.blog-series-reader[data-entry-id=item_1] .blog-series-reader-body[aria-busy=false]').waitFor();
      assert.equal(await page.evaluate(() => readerTest.reads), 1);
      assert.equal(await page.evaluate(() => JSON.stringify({ series: readerTest.value.series, posts: readerTest.value.posts.map(row => ({ itemId: row.itemId, manifest: HaedoLife.Blog.pack(row.doc) })) })), await page.evaluate(() => readerTest.before));
      assert.equal(await page.evaluate(() => seriesReader.dirty()), false);
    });
    await check('Snapshot failure and corrupt snapshots expose retry without substituting a different document', async page => {
      await page.evaluate(async () => { readerTest.failRead = 'missing'; await readerTest.mount({ entryId: 'item_1' }); });
      assert.equal(await page.locator('.blog-document').count(), 0); assert.match(await page.locator('.blog-series-reader [role=alert]').innerText(), /찾을 수 없습니다/);
      await page.evaluate(() => { readerTest.failRead = false; readerTest.value.posts[1].itemId = 'wrong_entry'; });
      await page.locator('#blogSeriesReaderRetry').click(); assert.match(await page.locator('.blog-series-reader [role=alert]').innerText(), /정확한 글 사본/);
      assert.equal(await page.locator('.blog-document').count(), 0);
      await page.evaluate(() => { readerTest.value.posts[1].itemId = 'item_1'; });
      await page.locator('#blogSeriesReaderRetry').click(); await page.locator('.blog-series-reader[data-entry-id=item_1] .blog-document').waitFor();
      await page.evaluate(async () => { await readerTest.mount({ entryId: 'no_longer_in_contents' }); });
      assert.equal(await page.locator('.blog-series-toc-link').count(), 3); assert.match(await page.locator('.blog-series-reader [role=alert]').innerText(), /목차에서 다시/);
    });
    await check('A failed renderer retries the same entry and the editor and exit receive their exact context', async page => {
      await page.evaluate(() => { readerTest.failRender = true; });
      await page.locator('.blog-series-toc-link[data-entry-id=item_1]').click(); await page.locator('#blogSeriesReaderRetryEntry').waitFor();
      assert.equal(await page.locator('.blog-series-reader-position').innerText(), '2 / 3');
      await page.evaluate(() => { readerTest.failRender = false; });
      await page.locator('#blogSeriesReaderRetryEntry').click(); await page.locator('.blog-series-reader-body[aria-busy=false] .blog-document').waitFor();
      await page.locator('#blogSeriesReaderContents').click(); await page.locator('#blogSeriesReaderEdit').click(); await page.locator('#blogSeriesReaderExit').click();
      assert.deepEqual(await page.evaluate(() => readerTest.edits), [{ seriesId: 'synthetic_series' }]); assert.equal(await page.evaluate(() => readerTest.exits), 1);
    });
    await check('A late old-account snapshot cannot recreate private contents after account invalidation', async page => {
      await page.evaluate(() => { readerTest.holdRead = true; readerTest.lateMount = readerTest.mount(); });
      await page.waitForFunction(() => readerTest.readHeld === true);
      await page.evaluate(async () => { readerTest.valid = false; seriesReader.detach(); readerTest.releaseRead(); await readerTest.lateMount; });
      assert.equal(await page.locator('.blog-series-reader').count(), 0); assert.equal(await page.evaluate(() => readerTest.activeURLs.size), 0);
      assert(!(await page.locator('#seriesReaderTestHost').innerText()).includes('여행 모음'));
    });
    await check('A late renderer disposes its original photo URLs and cannot replace a newer contents view', async page => {
      await page.evaluate(() => { readerTest.holdRender = true; });
      await page.locator('.blog-series-toc-link[data-entry-id=item_1]').click(); await page.waitForFunction(() => readerTest.renderHeld === true);
      await page.locator('#blogSeriesReaderContents').click(); await page.locator('.blog-series-toc-link').first().waitFor();
      await page.evaluate(async () => { readerTest.holdRender = false; readerTest.releaseRender(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      assert.equal(await page.locator('.blog-series-reader').getAttribute('data-view'), 'contents'); assert.equal(await page.locator('.blog-document').count(), 0);
      assert.equal(await page.evaluate(() => readerTest.activeURLs.size), 0); assert.equal(await page.evaluate(() => readerTest.disposed), 1);
      await page.evaluate(async () => { seriesReader.detach(); await readerTest.mount(); seriesReader.dispose(); });
      assert.equal(await page.locator('.blog-series-reader').count(), 0);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } catch (error) {
    report.pass = false; report.error = error.stack;
    await active?.pages().at(-1)?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(cause => { report.captureError = cause.message; }); throw error;
  } finally { await active?.close(); await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
