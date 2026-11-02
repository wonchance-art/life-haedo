'use strict';
// Writing a post and keeping what it cites (people, works, places) in the taste collection.
// Synthetic account and data on FakeCloud; real IndexedDB in Chromium. No production data.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const { awaitCondition } = require('./helpers/await-condition.cjs');

const out = path.resolve('.local/taste-link');
const report = { checks: [], visual: [], errors: [], consoleErrors: [], external: [] };

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await makeContext(browser, new FakeCloud(), 'taste-link', accounts.a, { viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback();
    report.external.push(u.origin); return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const collection = () => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.readCollection(await s.getActive()); });
  const docs = () => page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, w = await s.getActive();
    return Promise.all((await s.listPhotoPosts(w)).map(row => s.readPhotoPost(w, row.id)));
  });
  const check = async (name, run) => { console.log('START ' + name); await run(); report.checks.push(name); console.log('PASS ' + name); };
  const capture = async (scene, widths = [1440, 390]) => {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); });
      const metrics = await page.evaluate(inspect); report.visual.push({ scene, width, metrics });
      assert.equal(metrics.horizontalOverflow, false, scene + ' overflow');
      for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ' ' + key);
      await page.screenshot({ path: path.join(out, scene + '-' + width + '.png') });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  };
  // Opens "직접 입력" in the attachment picker and fills the review form.
  async function review({ type, title, url = '' }) {
    await click('음악·책·대상 붙이기'); await page.locator('#clPickerQuery').fill(title); await click('직접 입력');
    const form = page.locator('.photo-attachment-review');
    await form.getByLabel('첨부 종류', { exact: true }).selectOption(type);
    await form.getByRole('textbox', { name: '제목 또는 이름', exact: true }).fill(title);
    await form.getByRole('textbox', { name: '출처 링크', exact: true }).fill(url);
    return form;
  }
  const keep = form => form.getByRole('checkbox', { name: '취향 컬렉션에도 저장', exact: true });
  const status = () => page.locator('.photo-status').innerText();
  const row = title => page.locator('.photo-edit-attachment').filter({ hasText: title });

  try {
    await page.goto(base + '/index.html'); await ready(page); await settle(page);
    await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    const before = await collection();
    await page.locator('[data-home-destination="write"]:visible, #homeFirstWrite:visible').first().click();
    await page.locator('#photoTitle').fill('시인과 호숫가를 다시 읽은 날');
    await page.locator('.ql-editor').fill('익명 시인의 문장을 떠올리며 호숫가를 걸었다.');

    await check('A new person attached while writing is saved to the collection once and marked on the post', async () => {
      const form = await review({ type: 'person', title: '익명 시인' });
      assert.equal(await keep(form).isChecked(), true, 'a new attachment starts with collection saving on');
      await keep(form).scrollIntoViewIfNeeded(); await capture('attachment-review', [390, 1440]); await keep(form).scrollIntoViewIfNeeded();
      await click('첨부');
      await row('익명 시인').locator('.photo-attachment-collected').waitFor();
      assert.match(await status(), /취향 컬렉션에도 저장했습니다|자동 저장/);
      const after = await collection();
      assert.equal(after.revision, before.revision + 1);
      const added = after.items.filter(item => !before.items.some(old => old.id === item.id));
      assert.equal(added.length, 1);
      assert.deepEqual({ type: added[0].type, title: added[0].title, creator: added[0].creator, url: added[0].url, note: added[0].note, tags: added[0].tags, archived: added[0].archived },
        { type: 'person', title: '익명 시인', creator: '', url: '', note: '', tags: [], archived: false });
      await awaitCondition(page, async () => { const s = HaedoLife.Shell.storage, w = await s.getActive();
        const rows = await s.listPhotoPosts(w); for (const r of rows) { const d = await s.readPhotoPost(w, r.id); if (d.attachments?.some(a => a.title === '익명 시인')) return true; } return false; }, undefined, { timeout: 15000, label: 'post keeps the attachment' });
    });

    await check('The same place twice stays one collection item, and an unchecked work leaves the collection unchanged', async () => {
      let form = await review({ type: 'place', title: '산책한 호숫가', url: 'https://example.org/lake' }); await click('첨부');
      await row('산책한 호숫가').locator('.photo-attachment-collected').waitFor();
      const once = await collection();
      form = await review({ type: 'place', title: '산책한 호숫가', url: 'https://example.org/lake' }); await click('첨부');
      await awaitCondition(page, () => /이미 있습니다/.test(document.querySelector('.photo-status')?.textContent || ''), undefined, { timeout: 15000, label: 'duplicate notice' });
      assert.deepEqual(await collection(), once, 'a duplicate attachment adds nothing to the collection');
      form = await review({ type: 'artwork', title: '익명 그림' }); await keep(form).uncheck(); await click('첨부');
      await row('익명 그림').waitFor();
      assert.deepEqual(await collection(), once, 'an unchecked attachment is not saved to the collection');
      assert.equal(await row('익명 그림').locator('.photo-attachment-collected').count(), 0);
      await capture('attachments-marked', [390, 1440]);
    });

    await check('An edit of an attachment not yet in the collection offers saving it, and an item already there starts unchecked', async () => {
      await page.getByRole('button', { name: '익명 그림 첨부 정보 수정', exact: true }).click();
      let form = page.locator('.photo-attachment-review'); assert.equal(await keep(form).isChecked(), true);
      await click('입력 취소');
      await page.getByRole('button', { name: '익명 시인 첨부 정보 수정', exact: true }).click();
      form = page.locator('.photo-attachment-review'); assert.equal(await keep(form).isChecked(), false);
      await click('입력 취소');
    });

    // Shell.storage is frozen, so races and failures are made at the IndexedDB level (as in
    // edition-collection-browser.cjs). Hooks are installed after the picker has read the collection,
    // so the reads they count are the row mark's (1st) and the save path's (2nd).
    await check('A collection saved by another tab in between is kept and the new item is added after one retry', async () => {
      await review({ type: 'film', title: '함께 본 영화' });
      await page.evaluate(async () => {
        const s = HaedoLife.Shell.storage, w = await s.getActive(), other = await s.readCollection(w), now = new Date().toISOString();
        other.items.push({ id: HaedoLife.Core.id(), type: 'book', title: '다른 탭에서 넣은 책', creator: '', url: '', note: '다른 탭 메모', tags: [], details: {}, archived: false, createdAt: now, updatedAt: now });
        const get = IDBObjectStore.prototype.get; let reads = 0; window.__writeReads = 0;
        IDBObjectStore.prototype.get = function (key) {
          const request = get.call(this, key);
          if (this.name === 'meta' && key === 'collection:' + w) {
            if (this.transaction.mode === 'readwrite') window.__writeReads++;
            else if (++reads === 2) request.addEventListener('success', () => { window.__racingSave = s.saveCollection(w, other, other.revision); });
          }
          return request;
        };
        window.__restoreGet = () => { IDBObjectStore.prototype.get = get; };
      });
      await click('첨부');
      await row('함께 본 영화').locator('.photo-attachment-collected').waitFor();
      await page.evaluate(() => window.__racingSave);
      // The racing save, the save that met the conflict, and the retried save.
      assert.equal(await page.evaluate(() => window.__writeReads), 3, 'the save path met the conflict and retried once');
      await page.evaluate(() => window.__restoreGet());
      const titles = (await collection()).items.map(item => item.title);
      assert.ok(titles.includes('다른 탭에서 넣은 책'), "the other tab's item is kept");
      assert.equal(titles.filter(title => title === '함께 본 영화').length, 1);
    });

    await check('A collection that cannot be read leaves the attachment on the post with a retry path', async () => {
      await review({ type: 'place', title: '읽기 실패 때 붙인 장소' });
      await page.evaluate(async () => {
        const s = HaedoLife.Shell.storage, w = await s.getActive(), get = IDBObjectStore.prototype.get; let failures = 0;
        IDBObjectStore.prototype.get = function (key) {
          if (this.name === 'meta' && key === 'collection:' + w && this.transaction.mode === 'readonly' && ++failures <= 2) {
            if (failures === 2) IDBObjectStore.prototype.get = get;
            throw new DOMException('synthetic collection read failure', 'UnknownError');
          }
          return get.call(this, key);
        };
      });
      await click('첨부');
      await page.locator('.photo-status[role=alert]').waitFor();
      assert.match(await status(), /첨부는 글에 남아 있으며/);
      await row('읽기 실패 때 붙인 장소').waitFor();
      assert.equal((await collection()).items.some(item => item.title === '읽기 실패 때 붙인 장소'), false);
      await page.getByRole('button', { name: '읽기 실패 때 붙인 장소 첨부 정보 수정', exact: true }).click();
      assert.equal(await keep(page.locator('.photo-attachment-review')).isChecked(), true);
      await click('수정 반영');
      await row('읽기 실패 때 붙인 장소').locator('.photo-attachment-collected').waitFor();
      assert.equal((await collection()).items.filter(item => item.title === '읽기 실패 때 붙인 장소').length, 1);
    });

    await check('The collection item lists the post that attaches it and opens that post', async () => {
      await awaitCondition(page, () => document.querySelector('.photo-status')?.textContent === '자동 저장됨', undefined, { timeout: 15000, label: 'autosave' });
      const postId = (await docs()).find(d => d.attachments?.some(a => a.title === '익명 시인')).id;
      await page.goto(base + '/index.html?section=records&view=collection'); await ready(page); await page.locator('.life-collection').waitFor();
      await page.locator('#clQuery').fill('익명 시인'); await page.locator('.cl-card').first().click();
      const used = page.locator('.cl-used');
      await used.getByRole('button', { name: '시인과 호숫가를 다시 읽은 날', exact: true }).waitFor();
      assert.match(await used.innerText(), /초안 · \d{4}-\d\d-\d\d/);
      await capture('collection-used', [390, 1440]);
      await used.getByRole('button', { name: '시인과 호숫가를 다시 읽은 날', exact: true }).click();
      await awaitCondition(page, id => !!document.querySelector('[data-photo-post-id="' + id + '"], #photoTitle, .photo-article'), postId, { timeout: 15000, label: 'post opened' });
      const opened = await page.evaluate(() => document.querySelector('#photoTitle')?.value || document.querySelector('.photo-article h1, .photo-article h2')?.textContent || '');
      assert.match(opened, /시인과 호숫가를 다시 읽은 날/);
    });

    await check('An item no post attaches says so', async () => {
      await page.goto(base + '/index.html?section=records&view=collection'); await ready(page); await page.locator('.life-collection').waitFor();
      await page.locator('#clQuery').fill('다른 탭에서 넣은 책'); await page.locator('.cl-card').first().click();
      await page.locator('.cl-used').getByText('아직 이 항목을 붙인 글이 없습니다.').waitFor();
    });

    assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []);
    report.pass = true;
  } finally {
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await context.close(); await browser.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
