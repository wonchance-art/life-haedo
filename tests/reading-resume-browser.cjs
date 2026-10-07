/* Durable local reading resume through the real UI, SDK and isolated IndexedDB.
 * Anonymous Auth HTTP only. Linux Chromium viewport/touch simulation is not Apple validation.
 * BASE_URL=http://127.0.0.1:4184 PW_MODULE_PATH=tests/browser-ci/node_modules/playwright node tests/reading-resume-browser.cjs
 */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { FakeCloud, accounts, cloud, base, openManagement } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, nav, makeContext, observe } = require('./unified-home-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve(__dirname, '../.local/reading-resume');
const title = '산책길에서 다시 읽던 질문과 문장을 원래 버전의 자리에 이어 놓는 긴 익명 기록';
const quote = '이어 읽을 옛 구절🌱';
const raw = Array.from({ length: 44 }, (_, i) => `${i + 1}번째 문단. 책을 덮고 천천히 걸으며 남겨 둔 질문을 다시 읽었다. 문장 사이에서 생각이 조금씩 달라지는 것을 보았다. ${i === 23 ? quote : '서두르지 않고 읽은 자리를 기억한다.'}`).join('\r\n\r\n');
const latest = '최신 버전은 다른 질문을 다룬다. 읽던 옛 구절을 최신 버전의 같은 숫자 위치로 바꾸면 안 된다.';
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const current = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.read(await s.getActive()); });
async function fixture(page) {
  await page.goto(base + '/index.html?section=records'); await ready(page); await settle(page);
  const ids = await page.evaluate(async ({ title, raw, latest }) => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core; let b = await s.read(await s.getActive());
    const old = await c.prepareImport({ origin: 'apple_notes', title, text: raw, forceSeparate: true }, b);
    await s.commitLocal({ operationId: c.id(), workspaceId: b.workspaceId, baseRevision: b.revision, changes: c.buildImportChanges(b, old) }); b = await s.read(b.workspaceId);
    const newer = await c.prepareImport({ origin: 'apple_notes', title, text: latest, existingSourceId: old.source.id }, b);
    await s.commitLocal({ operationId: c.id(), workspaceId: b.workspaceId, baseRevision: b.revision, changes: c.buildImportChanges(b, newer) }); b = await s.read(b.workspaceId);
    const link = await c.prepareImport({ origin: 'other', title: '본문 없이 보관한 익명 링크', text: '', url: 'https://example.invalid/anonymous-reading-link', forceSeparate: true }, b);
    await s.commitLocal({ operationId: c.id(), workspaceId: b.workspaceId, baseRevision: b.revision, changes: c.buildImportChanges(b, link) });
    return { workspaceId: b.workspaceId, sourceId: old.source.id, oldVersion: old.version.id, latestVersion: newer.version.id, linkSource: link.source.id, linkVersion: link.version.id };
  }, { title, raw, latest }); await page.reload(); await ready(page); await settle(page); return ids;
}
async function openOld(page, ids) {
  await page.locator('#lifeSearch').fill(quote);
  await page.locator(`.life-source-card[data-version-id="${ids.oldVersion}"] .life-source-open`).click();
  await page.locator('#lifeSourceText').waitFor(); await settle(page); await frames(page);
  assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
  assert.equal(await page.locator('#lifeVersion').inputValue(), ids.oldVersion);
}
async function selectKnownQuote(page) {
  await page.locator('#lifeSourceText').evaluate((el, { raw, quote }) => {
    const start = raw.indexOf(quote), range = document.createRange();
    range.setStart(el.firstChild, start); range.setEnd(el.firstChild, start + quote.length);
    el.focus({ preventScroll: true }); getSelection().removeAllRanges(); getSelection().addRange(range);
    const box = range.getBoundingClientRect(); scrollTo({ top: Math.max(0, scrollY + box.top - innerHeight / 3), behavior: 'instant' });
    el.dispatchEvent(new Event('pointerup', { bubbles: true }));
  }, { raw, quote }); await frames(page);
}
async function visiblePosition(page, start) {
  return page.locator('#lifeSourceText').evaluate((el, start) => {
    const range = document.createRange(); range.setStart(el.firstChild, start); range.setEnd(el.firstChild, Math.min(el.firstChild.length, start + 1));
    const r = range.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, viewportHeight: innerHeight, scrollY, version: document.querySelector('#lifeVersion')?.value, selected: getSelection().toString() };
  }, start);
}
async function backup(page) {
  await openManagement(page); await page.getByRole('button', { name: '내보내기·사본 복원', exact: true }).click(); await settle(page);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'JSON 백업', exact: true }).click();
  return JSON.parse(await fs.readFile(await (await downloading).path(), 'utf8'));
}
async function capture(page, report, scene, size) {
  if (process.env.RESUME_CAPTURE === '0') return;
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => { for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish(); });
  const metrics = await page.evaluate(inspect), file = `${scene}-${size.width}.png`;
  metrics.smallTargets = metrics.smallTargets.filter(item => item.id !== 'lifeSourceText');
  await page.screenshot({ path: path.join(out, file) }); report.visual.push({ scene, file, ...metrics });
  assert.equal(metrics.horizontalOverflow, false); assert.deepEqual(metrics.smallTargets, []); assert.deepEqual(metrics.smallInputs, []); assert.deepEqual(metrics.unnamed, []); assert.deepEqual(metrics.contrastFailures, []);
}

const reading = (page, workspaceId) => page.evaluate(async workspaceId => {
  const s = HaedoLife.Shell.storage; return s.readReadingPosition(workspaceId || await s.getActive());
}, workspaceId);
async function savedPosition(page, expected = {}) {
  let row;
  for (let attempt = 0; attempt < 80; attempt++) {
    row = await reading(page);
    if (row.status === 'available' && row.position && Object.entries(expected).every(([key, value]) => row.position[key] === value)) return row;
    await page.waitForTimeout(100);
  }
  throw new Error('Expected durable reading position did not arrive: ' + JSON.stringify(row));
}
async function actualScroll(page, amount = 640) {
  const point = await page.locator('#lifeSourceText').evaluate(el => { const r = el.getBoundingClientRect(); return { x: Math.min(innerWidth - 30, r.left + r.width / 2), y: Math.min(innerHeight - 130, Math.max(100, r.top + 150)), before: scrollY }; });
  await page.mouse.move(point.x, point.y); await page.mouse.wheel(0, amount);
  await page.waitForFunction(before => scrollY !== before, point.before); await frames(page);
}
async function recordList(page) {
  await page.goto(base + '/index.html?section=records'); await ready(page); await settle(page);
  await page.locator('#lifeSearch').waitFor(); await frames(page);
}
async function exactResume(page, ids, bookmark, button = '#homeReadingResumeOpen') {
  await page.locator(button).focus(); await page.keyboard.press('Enter'); await page.locator('#lifeSourceText').waitFor(); await settle(page); await frames(page);
  assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
  assert.equal(await page.locator('#lifeVersion').inputValue(), ids.oldVersion);
  const location = await visiblePosition(page, bookmark.position.offset);
  assert(location.bottom >= 60 && location.top < location.viewportHeight - 100, 'Durable UTF16 position must be visible after explicit resume');
  return location;
}
async function overwritePosition(page, workspaceId, revision, position) {
  await page.evaluate(async ({ workspaceId, revision, position }) => {
    const account = HaedoLife.Shell.storage.account;
    const key = `readingPosition:${JSON.stringify([account.projectUrl, account.userId])}:${workspaceId}`;
    await new Promise((resolve, reject) => {
      const opening = indexedDB.open('life-tools-v1'); opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result, tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ key, value: { format: 'life-reading-position-v1', workspaceId, revision, position } });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, { workspaceId, revision, position });
}
async function putFailure(page, enabled) {
  await page.evaluate(enabled => {
    window.__resumePut ||= IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = enabled ? function(...args) {
      const request = __resumePut.apply(this, args);
      if (this.name === 'meta' && args[0]?.value?.format === 'life-reading-position-v1') this.transaction.abort();
      return request;
    } : __resumePut;
  }, enabled);
}
async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only a local application may be tested');
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), base, scope: 'Real local UI, SDK, isolated IndexedDB and anonymous Auth HTTP; Chromium viewport/touch simulation only', checks: [], visual: [], observations: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [], realRemoteWrites: 0 };
  async function check(name, action, size = { width: 820, height: 1000 }) {
    if (process.env.RESUME_TEST_MATCH && !new RegExp(process.env.RESUME_TEST_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'reading-resume-' + report.checks.length;
    const context = await makeContext(browser, server, device, accounts.a, { viewport: size, hasTouch: size.width <= 820 });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.external.push({ origin: u.origin, path: u.pathname }); return route.abort('blockedbyclient'); });
    try { await action({ page, context, server, device, size }); assert.equal(server.writes().length, 0, 'Local reading position must never opt into remote writes'); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const size of [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }]) {
      await check('trusted scroll then reload and explicit older-version resume ' + size.width, async ({ page }) => {
        const ids = await fixture(page), original = await current(page); assert.equal((await reading(page)).status, 'empty');
        await openOld(page, ids); await page.waitForTimeout(500); assert.equal((await reading(page)).status, 'empty', 'A restored search location alone is not a reading action');
        await actualScroll(page); const position = await savedPosition(page, { sourceId: ids.sourceId, sourceVersionId: ids.oldVersion });
        assert(position.position.offset > 0 && position.position.offset <= raw.length); assert.deepEqual(await current(page), original, 'Reading position must not revise original workspace data');
        const captured = await visiblePosition(page, position.position.offset);
        assert(captured.bottom >= 60 && captured.top < captured.viewportHeight - 100, 'Captured point must belong to the paragraph actually visible after scrolling');
        const previous = raw.charCodeAt(position.position.offset - 1), next = raw.charCodeAt(position.position.offset);
        assert(!(previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF), 'Bookmark must use a complete UTF16 character boundary');
        await nav(page, 'home'); await page.reload(); await ready(page); await settle(page); await frames(page);
        await page.locator('#homeReadingResumeOpen').waitFor(); assert.equal(await page.locator('#lifeSourceText').count(), 0); assert(await page.evaluate(() => scrollY < 100), 'Home rendering must not auto-open or jump to a distant reading position');
        await capture(page, report, 'home-position', size);
        const location = await exactResume(page, ids, position); report.observations.push({ width: size.width, savedOffset: position.position.offset, ...location });
        await capture(page, report, 'reader-resumed', size);
        await recordList(page); await page.locator('#lifeReadingResumeOpen').waitFor(); await page.reload(); await ready(page); await settle(page); await frames(page);
        assert.equal(await page.locator('#lifeSourceText').count(), 0); assert(await page.evaluate(() => scrollY < 100));
        await capture(page, report, 'records-position', size);
        await exactResume(page, ids, position, '#lifeReadingResumeOpen'); assert.deepEqual(await reading(page), position, 'Programmatic resume must not create a fresh reading write');
      }, size);
    }
    await check('trusted selection keeps exact raw UTF16 offset and viewport reflow resumes that character', async ({ page }) => {
      const ids = await fixture(page); await openOld(page, ids); await page.waitForTimeout(500); await selectKnownQuote(page);
      // The fixture owns the raw offsets. A genuine key event completes the selection;
      // production capture deliberately ignores script-generated pointer events.
      await page.keyboard.press('Shift+ArrowRight');
      const position = await savedPosition(page, { sourceVersionId: ids.oldVersion, offset: raw.indexOf(quote) });
      await nav(page, 'home'); await page.reload(); await ready(page); await page.locator('#homeReadingResumeOpen').waitFor();
      await page.setViewportSize({ width: 390, height: 844 }); await exactResume(page, ids, position);
      assert.deepEqual(await reading(page), position, 'Reflow and restoration must not revise the saved character offset');
      await page.locator('#lifeSearchReturn').focus(); await page.keyboard.press('Enter'); await page.locator('#homeReadingResumeOpen').waitFor(); await frames(page);
      assert.equal(await page.locator('#homeReadingResumeOpen').evaluate(el => el === document.activeElement), true, 'Reader back must wait for and focus its explicit resume button');
    });
    await check('native Chromium touch gesture stores a visible reading character', async ({ page, context }) => {
      const ids = await fixture(page); await openOld(page, ids); await page.waitForTimeout(500);
      const before = await page.evaluate(() => scrollY), client = await context.newCDPSession(page);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 190, y: 620 }] });
      for (const y of [540, 440, 330, 230]) { await page.waitForTimeout(50); await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 190, y }] }); }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(before => scrollY !== before, before);
      const position = await savedPosition(page, { sourceVersionId: ids.oldVersion });
      const location = await visiblePosition(page, position.position.offset); assert(location.bottom >= 60 && location.top < location.viewportHeight - 100);
      await nav(page, 'home'); await page.locator('#homeReadingResumeOpen').waitFor(); await page.locator('#homeReadingResumeOpen').tap(); await page.locator('#lifeSourceText').waitFor(); await frames(page);
      assert.equal(await page.locator('#lifeVersion').inputValue(), ids.oldVersion); assert.equal(await page.locator('#lifeSourceText').textContent(), raw); await client.detach();
    }, { width: 390, height: 844 });
    await check('search location wins and source/excerpt/arrangement panels do not become reading positions', async ({ page }) => {
      const ids = await fixture(page); await openOld(page, ids); await page.waitForTimeout(500); await actualScroll(page, 1100);
      const position = await savedPosition(page, { sourceVersionId: ids.oldVersion }); await recordList(page); await openOld(page, ids);
      assert.equal(await page.evaluate(() => getSelection().toString()), quote, 'An explicit search range must win over the stored reading position');
      const atSearch = await visiblePosition(page, raw.indexOf(quote)); assert(atSearch.top >= 60 && atSearch.top < atSearch.viewportHeight - 100);
      assert.deepEqual(await reading(page), position); await page.waitForTimeout(500);
      for (const selector of ['#lifeSourceInfoToggle', '#lifeReaderArrange', '#lifeExcerptToggle']) {
        await page.locator(selector).click(); await frames(page);
        const before = await reading(page); await page.mouse.wheel(0, 160); await page.waitForTimeout(700);
        assert.deepEqual(await reading(page), before, 'Scrolling inside an open source tool must preserve the original reading point');
        await page.keyboard.press('Escape'); await frames(page);
      }
      assert.deepEqual(await reading(page), position, 'Tool-open and close jumps must not be mistaken for reading');
    });
    await check('clear cancels delayed reading work and old-tab candidates cannot resurrect it', async ({ page, context }) => {
      const ids = await fixture(page); await openOld(page, ids); await page.waitForTimeout(500); await actualScroll(page);
      await savedPosition(page, { sourceVersionId: ids.oldVersion }); await nav(page, 'home'); await page.locator('#homeReadingResumeClear').waitFor();
      const other = await context.newPage(); other.setDefaultTimeout(12000);
      await other.goto(base + '/index.html?section=records'); await ready(other); await openOld(other, ids); await other.waitForTimeout(500);
      // A reading event in a second tab proposes a debounced candidate. Clearing
      // from the visible home must leave a durable tombstone after that timer.
      await actualScroll(other, 900); await page.locator('#homeReadingResumeClear').click(); await page.locator('#homeReadingResume').waitFor({ state: 'hidden' });
      await other.waitForTimeout(1100); const cleared = await reading(page); assert.equal(cleared.status, 'empty'); assert.equal(cleared.position, null);
      await page.reload(); await ready(page); await settle(page); assert.equal(await page.locator('#homeReadingResumeOpen').count(), 0);
      assert.equal((await current(page)).sourceVersions.length, 3); await other.close();
    });
    await check('workspace and account boundaries keep local reading points private', async ({ page, server, device }) => {
      const ids = await fixture(page); await openOld(page, ids); await page.waitForTimeout(500); await actualScroll(page);
      const position = await savedPosition(page, { sourceVersionId: ids.oldVersion });
      await openManagement(page); await page.getByRole('button', { name: '내보내기·사본 복원', exact: true }).click(); await settle(page);
      await page.locator('#lifeNewWorkspaceName').fill('다른 익명 읽기 공간'); await page.getByRole('button', { name: '빈 작업공간 만들기', exact: true }).click(); await settle(page);
      const otherWorkspace = (await current(page)).workspaceId; assert.notEqual(otherWorkspace, ids.workspaceId); assert.equal((await reading(page)).status, 'empty');
      await nav(page, 'home'); assert.equal(await page.locator('#homeReadingResumeOpen').count(), 0);
      await openManagement(page); await page.locator('#lifeWorkspace').selectOption(ids.workspaceId); await settle(page); await nav(page, 'home'); await page.locator('#homeReadingResumeOpen').waitFor(); assert.deepEqual(await reading(page), position);
      await page.evaluate(() => { window.__resumeLogout = HaedoAuth.client.auth.signOut({ scope: 'local' }); });
      await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage);
      server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-login]').click(); await page.locator('#googleLogin').click(); await page.waitForURL(u => u.pathname.endsWith('/index.html')); await ready(page); await nav(page, 'home');
      assert.equal((await reading(page)).status, 'empty'); assert.equal(await page.locator('#homeReadingResumeOpen').count(), 0);
      const denied = await page.evaluate(async workspaceId => { try { await HaedoLife.Shell.storage.readReadingPosition(workspaceId); return false; } catch (_) { return true; } }, ids.workspaceId); assert.equal(denied, true);
    });
    await check('stale displayed point refreshes without jumping and link or missing exact versions never fall back', async ({ page, size }) => {
      const ids = await fixture(page); await openOld(page, ids); await page.waitForTimeout(500); await actualScroll(page);
      const position = await savedPosition(page, { sourceVersionId: ids.oldVersion }); await nav(page, 'home'); await page.locator('#homeReadingResumeOpen').waitFor();
      const newerPoint = { ...position.position, offset: raw.indexOf(quote) };
      // Represent a changed row arriving before its advisory notification. Only
      // the persisted anonymous meta row is changed; all original data stays intact.
      await overwritePosition(page, ids.workspaceId, position.revision + 1, newerPoint);
      await page.locator('#homeReadingResumeOpen').click(); await page.locator('#homeReadingResume .life-reading-resume-status').waitFor();
      assert.equal(await page.locator('#lifeSourceText').count(), 0, 'A changed point must be reviewed before jumping');
      const updated = await reading(page); await exactResume(page, ids, updated);
      await nav(page, 'home'); await page.locator('#homeReadingResumeOpen').waitFor();
      await overwritePosition(page, ids.workspaceId, updated.revision + 1, { sourceId: ids.sourceId, sourceVersionId: 'missing-anonymous-version', offset: 0, updatedAt: new Date().toISOString() });
      await page.locator('#homeReadingResumeOpen').click(); await page.locator('#homeReadingResume .life-reading-resume-status').waitFor(); assert.equal(await page.locator('#lifeSourceText').count(), 0); assert.equal(await page.locator('#homeReadingResumeOpen').count(), 0);
      const missing = await reading(page); assert.equal(missing.status, 'unavailable'); assert.equal((await current(page)).sourceVersions.length, 3);
      await capture(page, report, 'home-unavailable', size);
      await overwritePosition(page, ids.workspaceId, missing.revision + 1, { sourceId: ids.linkSource, sourceVersionId: ids.linkVersion, offset: 0, updatedAt: new Date().toISOString() });
      await page.reload(); await ready(page); await page.locator('#homeReadingResume .life-reading-resume-status').waitFor(); assert.equal(await page.locator('#homeReadingResumeOpen').count(), 0);
      assert.equal((await reading(page)).status, 'unavailable'); await page.locator('#homeReadingResumeClear').click(); await page.locator('#homeReadingResume').waitFor({ state: 'hidden' });
    });
    await check('native reading-position write failure preserves original reading and prior durable point', async ({ page }) => {
      const ids = await fixture(page); await openOld(page, ids); await page.waitForTimeout(500); await actualScroll(page);
      const position = await savedPosition(page, { sourceVersionId: ids.oldVersion }), original = await current(page);
      await putFailure(page, true); await actualScroll(page, 850); await page.locator('#lifeReadingPositionStatus').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#lifeSourceText').textContent(), raw); assert.deepEqual(await reading(page), position); assert.deepEqual(await current(page), original);
      await putFailure(page, false); await actualScroll(page, -300);
      let recovered;
      for (let i = 0; i < 80; i++) { recovered = await reading(page); if (recovered.revision > position.revision) break; await page.waitForTimeout(100); }
      assert(recovered.revision > position.revision, 'A later real reading action should recover local metadata saving');
      await page.locator('#lifeReadingPositionStatus').waitFor({ state: 'hidden' });
      report.observations.push({ scenario: 'reading-position failure recovery', previousRevision: position.revision, recoveredRevision: recovered.revision, feedbackVisibleAfterSuccess: await page.locator('#lifeReadingPositionStatus').isVisible() });
    });
    await check('native reading-position read failure and malformed metadata keep home usable with retry', async ({ page, size }) => {
      const ids = await fixture(page); await openOld(page, ids); await page.waitForTimeout(500); await actualScroll(page);
      const position = await savedPosition(page, { sourceVersionId: ids.oldVersion });
      await page.evaluate(() => {
        window.__resumeGet = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function(...args) {
          if (this.name === 'meta' && String(args[0]).startsWith('readingPosition:')) throw new DOMException('Anonymous resume metadata read failed', 'InvalidStateError');
          return __resumeGet.apply(this, args);
        };
      });
      await nav(page, 'home'); await page.locator('#homeReadingResumeRetry').waitFor(); assert.equal(await page.locator('#homeRecent').isVisible(), true); assert.equal(await page.locator('#homeReadingResumeOpen').count(), 0);
      await capture(page, report, 'home-read-error', size);
      await page.evaluate(() => { IDBObjectStore.prototype.get = __resumeGet; }); await page.locator('#homeReadingResumeRetry').click(); await page.locator('#homeReadingResumeOpen').waitFor(); assert.deepEqual(await reading(page), position);
      await overwritePosition(page, ids.workspaceId, position.revision + 1, { ...position.position, offset: -1 });
      await page.reload(); await ready(page); await page.locator('#homeReadingResumeRetry').waitFor(); assert.equal(await page.locator('#lifeSourceText').count(), 0); assert.equal(await page.locator('#homeRecent').isVisible(), true);
      await overwritePosition(page, ids.workspaceId, position.revision + 2, position.position); await page.locator('#homeReadingResumeRetry').click(); await page.locator('#homeReadingResumeOpen').waitFor();
      await exactResume(page, ids, await reading(page));
    });
    await check('reading position never leaks into original backup or uploads', async ({ page }) => {
      const ids = await fixture(page), original = await current(page); await openOld(page, ids); await page.waitForTimeout(500); await actualScroll(page);
      await savedPosition(page, { sourceVersionId: ids.oldVersion }); assert.deepEqual(await current(page), original);
      const exported = await backup(page); assert.equal(exported.format, 'life-tools-backup-v1'); assert.deepEqual(exported.workspace, original); assert(!JSON.stringify(exported).includes('life-reading-position-v1'));
    });
  } finally {
    await browser.close(); await fs.writeFile(path.join(out, process.env.RESUME_TEST_MATCH ? 'recheck-report.json' : 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`Reading resume: ${report.checks.filter(c => c.pass).length}/${report.checks.length}; ${report.visual.length} captures; console ${report.consoleErrors.length}; page ${report.pageErrors.length}.`);
  if (report.checks.some(c => !c.pass) || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
