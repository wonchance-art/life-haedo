/* Real UI/SDK/IDB with synthetic account and Naver responses; no production data. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { accounts, base } = require('./life-sync-browser.cjs');
const { existingNaver, item, blogId } = require('./naver-blog-browser.cjs');
const { CaptureCloud, capturedRow } = require('./life-naver-capture-browser.cjs');

async function main() {
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const server = new CaptureCloud(), context = await makeContext(browser, server, 'naver-photo-status', accounts.a);
  const page = await context.newPage(), errors = [], logs = [];
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') logs.push(message.text()); });
  const enter = async () => { await page.goto(base + '/index.html?section=tools&view=naver-blog', { waitUntil: 'domcontentloaded' }); await ready(page); await settle(page); await page.locator('#lifeNaverBlog').waitFor(); await page.waitForFunction(() => ['ready', 'partial', 'setup-required'].includes(document.querySelector('#naverBlogStatus')?.dataset.state)); };
  const row = no => page.locator('.nv-item[data-item-id="' + item(no).id + '"]');
  const output = '.local/naver-photo-status';
  try {
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await ready(page); await settle(page);
    const existing = await existingNaver(page), sub = server.setup(existing.workspaceId); server.inbox(sub);
    await page.evaluate(async ({ ws, blogId }) => {
      const s = HaedoLife.Shell.storage, C = HaedoLife.Core, b = await s.read(ws);
      const value = await C.prepareImport({ origin: 'naver_blog', title: '본문 없는 합성 글', url: 'https://blog.naver.com/' + blogId + '/100003', text: null, coverage: 'link_only' }, b);
      const result = await s.commitLocal({ workspaceId: ws, baseRevision: b.revision, operationId: C.id(), changes: C.buildImportChanges(b, value) });
      if (result.status !== 'stored') throw Error('Synthetic source setup failed');
    }, { ws: existing.workspaceId, blogId });
    const before = await page.evaluate(ws => HaedoLife.Shell.storage.read(ws), existing.workspaceId);
    await enter(); await row('100001').locator('[data-action=open]').click();
    const host = page.locator('#lifeNaverSourceMedia'); await page.locator('#lifeNaverSourceMedia[data-state=unverified]').waitFor();
    assert.match(await host.innerText(), /사진 사본을 이 브라우저에서 확인하지 못했습니다/);
    assert.match(await host.innerText(), /사진 유무와 서버 보관 여부는 알 수 없습니다/);
    assert.match(await host.innerText(), /새 원문 버전이 만들어질 수 있습니다/);
    assert.equal(await page.locator('#lifeSourceText').textContent(), before.sourceVersions.find(v => v.id === existing.refs['100001'].versionId).contentText);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1));
      const reviewBox = await page.locator('#lifeNaverMediaReview').boundingBox(), relatedBox = await page.locator('#lifeReaderRelatedEnd').boundingBox();
      assert.ok(reviewBox && relatedBox && relatedBox.y >= reviewBox.y + reviewBox.height + 8, 'Recovery button and following reader action must not overlap');
      await fs.mkdir(output, { recursive: true }); await page.screenshot({ path: `${output}/unverified-${width}.png`, fullPage: true });
    }
    const count = server.captureCalls.filter(call => ['life_naver_capture_request', 'worker'].includes(call.rpc)).length;
    await page.locator('#lifeNaverMediaReview').click(); await page.locator('#lifeNaverBlog').waitFor();
    assert.equal(server.captureCalls.filter(call => ['life_naver_capture_request', 'worker'].includes(call.rpc)).length, count);
    assert.deepEqual(await page.evaluate(ws => HaedoLife.Shell.storage.read(ws), existing.workspaceId), before);
    await row('100003').locator('[data-action=open]').click(); await page.locator('#lifeNaverSourceMedia[data-state=unverified]').waitFor();
    assert.equal(await page.locator('#lifeSourceText').count(), 0); assert.match(await page.locator('#lifeNaverSourceMedia').innerText(), /사진 유무와 서버 보관 여부는 알 수 없습니다/);
    await page.locator('#lifeNaverMediaReview').click(); await page.locator('#lifeNaverBlog').waitFor();

    const photo = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48; canvas.getContext('2d').fillRect(0, 0, 64, 48);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const p = await HaedoLife.PhotoPost.readPhoto(blob, HaedoLife.Core.id);
      return { digest: p.digest, type: p.type, width: p.width, height: p.height, size: p.size, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
    });
    photo.bytes = Buffer.from(photo.bytes); const capture = await capturedRow([photo], { failedPhoto: false }); server.addCapture(capture, [photo]);
    await page.locator('.nv-connection[data-connection-id="' + sub.id + '"] [data-action=public-list]').click();
    await page.locator('.nv-capture-row[data-capture-id="' + capture.id + '"] [data-action=review-capture]').click();
    await page.locator('#naverCaptureApply').click(); await page.locator('#naverCaptureStatus[data-state=stored]').waitFor();
    await page.locator('#naverCaptureOpen').click(); await page.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor();
    assert.equal(await page.locator('#lifeNaverMediaReview').count(), 0); assert.equal(await page.locator('#lifeNaverSourceMedia[data-state=unverified]').count(), 0);
    await page.waitForFunction(() => document.querySelector('#lifeNaverSourceMedia img')?.naturalWidth === 64);
    // A damaged sidecar is a read error, not evidence that the photo is absent.
    await page.evaluate(({ ws, versionId }) => new Promise((resolve, reject) => {
      const request = indexedDB.open('life-tools-v1'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').add({ key: `naver-capture:${ws}:${versionId}`, value: {} });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }), { ws: existing.workspaceId, versionId: existing.refs['100001'].versionId });
    await enter(); await row('100001').locator('[data-action=open]').click();
    await page.locator('#lifeNaverSourceMedia[data-state=error]').waitFor();
    assert.match(await page.locator('#lifeNaverSourceMedia').innerText(), /사진 사본을 확인하지 못했습니다/);
    assert.equal(await page.locator('#lifeNaverMediaReview').count(), 0);
    assert.equal(await page.locator('#lifeSourceText').textContent(), before.sourceVersions.find(v => v.id === existing.refs['100001'].versionId).contentText);
    assert.deepEqual(errors, []); assert.deepEqual(logs, []);
    console.log('PASS missing text/link-only photo status, explicit navigation without writes, verified photo and damaged-sidecar error');
  } finally { await context.close(); await browser.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
