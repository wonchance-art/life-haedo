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
  const keep = form => form.getByRole('checkbox', { name: '컬렉션에도 저장', exact: true });
  const status = () => page.locator('.photo-status').innerText();
  const row = title => page.locator('.photo-edit-attachment').filter({ hasText: title });

  try {
    await page.goto(base + '/index.html'); await ready(page); await settle(page);
    await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    const before = await collection();
    await page.locator('[data-haedo-compose]:visible').first().click();
    await page.locator('#photoTitle').fill('시인과 호숫가를 다시 읽은 날');
    await page.locator('.ql-editor').fill('익명 시인의 문장을 떠올리며 호숫가를 걸었다.');

    await check('A new person attached while writing is saved to the collection once and marked on the post', async () => {
      const form = await review({ type: 'person', title: '익명 시인' });
      assert.equal(await keep(form).isChecked(), true, 'a new attachment starts with collection saving on');
      await keep(form).scrollIntoViewIfNeeded(); await capture('attachment-review', [390, 1440]); await keep(form).scrollIntoViewIfNeeded();
      await click('첨부');
      await row('익명 시인').locator('.photo-attachment-collected').waitFor();
      // The collection result lives on the card; the post's status line and its recovery actions stay out of it.
      assert.equal(await page.locator('.photo-recovery-actions:visible').count(), 0);
      assert.doesNotMatch(await status(), /컬렉션/);
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
      await row('산책한 호숫가').nth(1).locator('.photo-attachment-collected').waitFor();
      assert.deepEqual(await collection(), once, 'a duplicate attachment adds nothing to the collection');
      form = await review({ type: 'artwork', title: '익명 그림' }); await keep(form).uncheck(); await click('첨부');
      await row('익명 그림').waitFor();
      assert.deepEqual(await collection(), once, 'an unchecked attachment is not saved to the collection');
      assert.equal(await row('익명 그림').locator('.photo-attachment-collected').count(), 0);
      await capture('attachments-marked', [390, 1440]);
    });

    await check('An edit offers collection saving unchecked when the item is not kept yet, and only shows that it is kept otherwise', async () => {
      await page.getByRole('button', { name: '익명 그림 첨부 정보 수정', exact: true }).click();
      let form = page.locator('.photo-attachment-review'); assert.equal(await keep(form).isChecked(), false, 'fixing a typo never saves by surprise');
      await click('입력 취소');
      await page.getByRole('button', { name: '익명 시인 첨부 정보 수정', exact: true }).click();
      form = page.locator('.photo-attachment-review'); assert.equal(await keep(form).count(), 0);
      assert.equal(await form.locator('.photo-attachment-collected').innerText(), '컬렉션에 있음');
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
      const failed = row('읽기 실패 때 붙인 장소');
      await failed.getByText('컬렉션에 저장하지 못함 · 컬렉션을 읽지 못함', { exact: true }).waitFor();
      assert.equal((await collection()).items.some(item => item.title === '읽기 실패 때 붙인 장소'), false);
      // Autosave rewrites the post's status line; the failure must outlive it on the card.
      await awaitCondition(page, () => document.querySelector('.photo-status')?.textContent === '자동 저장됨', undefined, { timeout: 15000, label: 'autosave after the failure' });
      assert.equal(await failed.getByText('컬렉션에 저장하지 못함 · 컬렉션을 읽지 못함', { exact: true }).count(), 1, 'the failure and its reason stay on the card');
      assert.equal(await page.locator('.photo-recovery-actions:visible').count(), 0);
      assert.doesNotMatch(await status(), /컬렉션/);
      await capture('attachment-collect-failed', [390, 1440]);
      await page.getByRole('button', { name: '읽기 실패 때 붙인 장소 컬렉션 저장 다시 시도', exact: true }).click();
      await failed.locator('.photo-attachment-collected').waitFor();
      assert.equal((await collection()).items.filter(item => item.title === '읽기 실패 때 붙인 장소').length, 1);
    });

    await check('A detached attachment drops its failure, so the same target attached again starts clean', async () => {
      await review({ type: 'place', title: '해제할 장소' });
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
      await row('해제할 장소').getByText(/컬렉션에 저장하지 못함/).waitFor();
      await page.getByRole('button', { name: '해제할 장소 첨부 해제', exact: true }).click();
      await awaitCondition(page, () => ![...document.querySelectorAll('.photo-edit-attachment')].some(n => n.textContent.includes('해제할 장소')), undefined, { timeout: 15000, label: 'detached' });
      const form = await review({ type: 'place', title: '해제할 장소' }); await keep(form).uncheck(); await click('첨부');
      await row('해제할 장소').waitFor();
      assert.equal(await row('해제할 장소').getByText(/저장하지 못함/).count(), 0, 'no failure carried over from the detached card');
      assert.equal(await page.getByRole('button', { name: '해제할 장소 컬렉션 저장 다시 시도', exact: true }).count(), 0);
    });

    await check('A save that kept the target wins over a newer attempt for it that failed', async () => {
      await review({ type: 'artwork', title: '겹쳐 저장한 그림' });
      // Readonly reads of the collection key after this point: 1 the row mark, 2 save A. On A's read the
      // store is held (a read-write transaction on a connection opened in advance), so A's write waits.
      // Save B for the same target then reads 3 (row mark) and 4 (its own read); both fail. After the
      // release A keeps the target and B fails: the card must say it is kept.
      await page.evaluate(async () => {
        const s = HaedoLife.Shell.storage, w = await s.getActive(), get = IDBObjectStore.prototype.get; let reads = 0;
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('life-tools-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        IDBObjectStore.prototype.get = function (key) {
          if (this.name !== 'meta' || key !== 'collection:' + w || this.transaction.mode !== 'readonly') return get.call(this, key);
          reads++;
          if (reads >= 3) { if (reads === 4) IDBObjectStore.prototype.get = get; throw new DOMException('synthetic collection read failure', 'UnknownError'); }
          const request = get.call(this, key);
          if (reads === 2) request.addEventListener('success', () => {
            const tx = db.transaction('meta', 'readwrite'), store = tx.objectStore('meta'); window.__hold = true;
            window.__held = new Promise(resolve => { tx.oncomplete = () => { db.close(); resolve(); }; });
            (function spin() { if (window.__hold) store.get('taste-link-hold').onsuccess = spin; })();
          });
          return request;
        };
      });
      await click('첨부');
      await awaitCondition(page, () => window.__hold === true, undefined, { timeout: 15000, label: 'save A holding' });
      await page.getByRole('button', { name: '겹쳐 저장한 그림 첨부 정보 수정', exact: true }).click();
      await keep(page.locator('.photo-attachment-review')).check(); await click('수정 반영');
      await page.evaluate(async () => { window.__hold = false; await window.__held; });
      const card = row('겹쳐 저장한 그림');
      await card.locator('.photo-attachment-collected').waitFor();
      assert.equal(await card.getByText(/저장하지 못함/).count(), 0, 'the kept target shows no failure');
      assert.equal((await collection()).items.filter(item => item.title === '겹쳐 저장한 그림').length, 1);
    });

    await check('Editing or detaching an attachment never deletes or rewrites the collection item', async () => {
      await review({ type: 'tool', title: '연필' }); await click('첨부');
      await row('연필').locator('.photo-attachment-collected').waitFor();
      const kept = await collection(), pencil = kept.items.find(item => item.title === '연필');
      await page.getByRole('button', { name: '연필 첨부 정보 수정', exact: true }).click();
      const form = page.locator('.photo-attachment-review');
      assert.equal(await keep(form).count(), 0, 'an attachment already in the collection offers no second save');
      await form.getByRole('textbox', { name: '제목 또는 이름', exact: true }).fill('연필 두 자루'); await click('수정 반영');
      await row('연필 두 자루').waitFor();
      assert.deepEqual(await collection(), kept, 'editing the post attachment leaves the collection as it was');
      await page.getByRole('button', { name: '연필 두 자루 첨부 해제', exact: true }).click();
      await awaitCondition(page, () => ![...document.querySelectorAll('.photo-edit-attachment')].some(n => n.textContent.includes('연필 두 자루')), undefined, { timeout: 15000, label: 'detached' });
      assert.deepEqual((await collection()).items.find(item => item.id === pencil.id), pencil, 'detaching keeps the collection item');
      assert.deepEqual(await collection(), kept);
    });

    await check('A form opened while the collection save is still running keeps its input and Korean composition', async () => {
      await review({ type: 'book', title: '늦게 저장되는 책' });
      // A long read-write transaction on the same store makes the save path wait; it is released
      // only after the user has opened another form and started composing.
      await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('life-tools-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        const tx = db.transaction('meta', 'readwrite'), store = tx.objectStore('meta'); window.__hold = true;
        window.__held = new Promise(resolve => { tx.oncomplete = () => { db.close(); resolve(); }; });
        (function spin() { if (window.__hold) store.get('structure-taste-link-hold').onsuccess = spin; })();
      });
      await click('첨부'); await row('늦게 저장되는 책').waitFor();
      await page.getByRole('button', { name: '익명 시인 첨부 정보 수정', exact: true }).click();
      const form = page.locator('.photo-attachment-review'), title = form.getByRole('textbox', { name: '제목 또는 이름', exact: true });
      await form.evaluate(n => { window.__openForm = n; });
      await title.dispatchEvent('compositionstart'); await title.fill('조합 중인 새 제목');
      await page.evaluate(async () => { window.__hold = false; await window.__held; });
      await row('늦게 저장되는 책').locator('.photo-attachment-collected').waitFor();
      assert.equal(await form.evaluate(n => n === window.__openForm && n.isConnected), true, 'the open form is the same node');
      assert.equal(await title.inputValue(), '조합 중인 새 제목');
      await title.dispatchEvent('compositionend'); await click('입력 취소');
      assert.equal((await collection()).items.filter(item => item.title === '늦게 저장되는 책').length, 1);
    });

    await check('The collection item lists the post that attaches it and opens that post', async () => {
      await awaitCondition(page, () => document.querySelector('.photo-status')?.textContent === '자동 저장됨', undefined, { timeout: 15000, label: 'autosave' });
      assert.ok((await docs()).some(d => d.attachments?.some(a => a.title === '익명 시인')));
      await page.goto(base + '/index.html?section=records&view=collection'); await ready(page); await page.locator('.life-collection').waitFor();
      await page.locator('#clQuery').fill('익명 시인'); await page.locator('.cl-card').first().click();
      const used = page.locator('.cl-used');
      await used.getByRole('button', { name: '시인과 호숫가를 다시 읽은 날', exact: true }).waitFor();
      assert.match(await used.innerText(), /초안 · \d{4}-\d\d-\d\d/);
      await capture('collection-used', [390, 1440]);
      await used.getByRole('button', { name: '시인과 호숫가를 다시 읽은 날', exact: true }).click();
      // The opened post is the editor (a draft) or the reader; wait for its title, not for any row
      // carrying the post id, which can appear before the post itself has rendered.
      await awaitCondition(page, title => (document.querySelector('#photoTitle')?.value || '') === title
        || [...document.querySelectorAll('.photo-article h1, .photo-article h2')].some(n => n.textContent.trim() === title), '시인과 호숫가를 다시 읽은 날', { timeout: 15000, label: 'post opened with its title' });
      assert.equal(await page.locator('.cl-used').count(), 0, 'the collection screen was left for the post');
    });

    await check('Posts of another workspace and the signed-out public page never show in the list', async () => {
      const other = await page.evaluate(async () => {
        const s = HaedoLife.Shell.storage, active = await s.getActive(), created = await s.createWorkspace('다른 자료공간');
        if (await s.getActive() !== active) await s.setActive(active);
        const d = HaedoLife.PhotoPost.create(HaedoLife.Core.id); d.title = '다른 자료공간의 비공개 글';
        d.attachments = [{ type: 'person', title: '익명 시인', creator: '', url: '' }]; d.ops = [{ insert: '다른 자료공간에서 같은 시인을 붙였다.\n' }];
        await s.savePhotoPost(created.workspaceId, d, 0);
        return { workspaceId: created.workspaceId, active: await s.getActive() === active };
      });
      assert.equal(other.active, true, 'the active workspace did not change');
      await page.goto(base + '/index.html?section=records&view=collection'); await ready(page); await page.locator('.life-collection').waitFor();
      await page.locator('#clQuery').fill('익명 시인'); await page.locator('.cl-card').first().click();
      const used = page.locator('.cl-used'); await used.locator('.cl-used-open').first().waitFor();
      assert.deepEqual(await used.locator('.cl-used-open').allInnerTexts(), ['시인과 호숫가를 다시 읽은 날']);
      const visitor = await browser.newContext(); const publicPage = await visitor.newPage();
      await visitor.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.fallback() : route.abort());
      await publicPage.goto(base + '/index.html', { waitUntil: 'load' });
      const text = await publicPage.locator('body').innerText();
      assert.equal(await publicPage.locator('.cl-used').count(), 0);
      for (const title of ['시인과 호숫가를 다시 읽은 날', '다른 자료공간의 비공개 글', '익명 시인']) assert.equal(text.includes(title), false, title + ' must not appear signed out');
      await visitor.close();
    });

    await check('An item no post attaches says so', async () => {
      await page.goto(base + '/index.html?section=records&view=collection'); await ready(page); await page.locator('.life-collection').waitFor();
      await page.locator('#clQuery').fill('다른 탭에서 넣은 책'); await page.locator('.cl-card').first().click();
      await page.locator('.cl-used').getByText('아직 이 항목을 붙인 글이 없습니다.').waitFor();
    });

    await check('A full collection says why saving fails, and the attachment stays on the post', async () => {
      const filled = await page.evaluate(async () => {
        const s = HaedoLife.Shell.storage, w = await s.getActive(), c = await s.readCollection(w), now = new Date().toISOString();
        for (let i = c.items.length; i < 1000; i++) c.items.push({ id: HaedoLife.Core.id(), type: 'other', title: '합성 항목 ' + i, creator: '', url: '', note: '', tags: [], details: {}, archived: false, createdAt: now, updatedAt: now });
        await s.saveCollection(w, c, c.revision); return (await s.readCollection(w)).items.length;
      });
      assert.equal(filled, 1000);
      await page.goto(base + '/index.html'); await ready(page); await settle(page);
      await page.locator('#homeComposition[aria-busy="false"]').waitFor();
      await page.locator('[data-haedo-compose]:visible').first().click();
      await page.locator('#photoTitle').fill('한도 확인 글');
      await review({ type: 'place', title: '한도를 넘는 장소' }); await click('첨부');
      await row('한도를 넘는 장소').getByText('컬렉션에 저장하지 못함 · 컬렉션 한도(1,000개·2 MiB)를 넘음', { exact: true }).waitFor();
      assert.equal((await collection()).items.length, 1000);
      await page.getByRole('button', { name: '한도를 넘는 장소 컬렉션 저장 다시 시도', exact: true }).waitFor();
      await awaitCondition(page, async () => { const s = HaedoLife.Shell.storage, w = await s.getActive();
        for (const r of await s.listPhotoPosts(w)) { const d = await s.readPhotoPost(w, r.id); if (d.attachments?.some(a => a.title === '한도를 넘는 장소')) return true; } return false; },
        undefined, { timeout: 15000, label: 'the post keeps the attachment' });
    });

    assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []);
    report.pass = true;
  } finally {
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await context.close(); await browser.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
