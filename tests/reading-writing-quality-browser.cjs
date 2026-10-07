/* Focused reading and writing quality journeys in the real local app.
 * Anonymous intercepted Auth + isolated IndexedDB; no production or Apple claims.
 * BASE_URL=http://127.0.0.1:4184 PW_MODULE_PATH=tests/browser-ci/node_modules/playwright node tests/reading-writing-quality-browser.cjs
 * QUALITY_PHASE=baseline BASE_URL=http://127.0.0.1:4185 captures the same fixture before changes.
 */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe } = require('./unified-home-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const phase = process.env.QUALITY_PHASE || 'after';
const baseline = phase === 'baseline';
const out = path.resolve(__dirname, '../.local/reading-writing-quality', phase);
const title = '비가 멎은 오후에 책을 덮고 걸으며 오래 남겨 둔 질문을 다시 읽고 나의 언어로 천천히 이어 쓰는 기록 — 익숙한 관심과 새로 발견한 생각을 함께 놓고 다음 문장의 방향을 고르는 시간';
const quote = '같은 길에서 다시 발견한 질문🌱';
const raw = Array.from({ length: 34 }, (_, i) => `${i + 1}번째 문단. 책을 읽으며 적어 둔 생각은 걸을 때 조금씩 다른 모습을 보였다. 서두르지 않고 문장 사이의 여백을 읽었다. ${i === 17 ? quote : '천천히 읽은 자리를 기억한다.'}`).join('\r\n\r\n');
const stored = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.read(await s.getActive()); });
const draftSaved = page => page.waitForFunction(() => document.querySelector('#lifeWritingStatus')?.dataset.state === 'draft');
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function selectMiddle(page) {
  await page.locator('#lifeSourceText').evaluate((el, { raw, quote }) => {
    el.focus({ preventScroll: true }); const start = raw.indexOf(quote), range = document.createRange();
    range.setStart(el.firstChild, start); range.setEnd(el.firstChild, start + quote.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    const rect = range.getBoundingClientRect(); scrollTo({ top: Math.max(0, scrollY + rect.top - innerHeight / 3), behavior: 'instant' });
    el.dispatchEvent(new Event('pointerup', { bubbles: true }));
  }, { raw, quote }); await frames(page);
}
async function seed(page) {
  const result = await page.evaluate(async ({ title, raw }) => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core; let b = await s.read(await s.getActive());
    const old = await c.prepareImport({ origin: 'apple_notes', title, text: raw, forceSeparate: true }, b);
    await s.commitLocal({ operationId: c.id(), workspaceId: b.workspaceId, baseRevision: b.revision, changes: c.buildImportChanges(b, old) });
    b = await s.read(b.workspaceId);
    const latest = await c.prepareImport({ origin: 'apple_notes', title, text: '최신 버전은 다른 글입니다. 이전에 고른 구절은 원래 버전에서 읽어야 합니다.', existingSourceId: old.source.id }, b);
    await s.commitLocal({ operationId: c.id(), workspaceId: b.workspaceId, baseRevision: b.revision, changes: c.buildImportChanges(b, latest) });
    return { sourceId: old.source.id, versionId: old.version.id, latestId: latest.version.id };
  }, { title, raw }); await page.reload(); await ready(page); return result;
}
async function abortDraftWrites(page, on) {
  await page.evaluate(on => {
    window.__qualityPut ||= IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = on ? function(...args) { const result = __qualityPut.apply(this, args); if (this.name === 'staging') this.transaction.abort(); return result; } : __qualityPut;
  }, on);
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { phase, createdAt: new Date().toISOString(), base, browser: browser.version(), scope: 'Real local UI, SDK and isolated IndexedDB; anonymous Auth HTTP; Linux Chromium viewport/touch/keyboard simulation only', checks: [], visual: [], observations: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [] };
  const verify = (name, value, detail) => { report.checks.push({ name, pass: !!value, ...(detail === undefined ? {} : { detail }) }); };
  async function capture(page, scene, size) {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => { for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); });
    const metrics = await page.evaluate(inspect), file = `${scene}-${size.width}.png`;
    // A focusable read-only document is a keyboard reading surface, not an action target.
    metrics.smallTargets = metrics.smallTargets.filter(target => target.id !== 'lifeSourceText');
    await page.screenshot({ path: path.join(out, file) }); report.visual.push({ scene, file, ...metrics });
    for (const [name, pass, detail] of [['no horizontal overflow', !metrics.horizontalOverflow], ['44px controls', !metrics.smallTargets.length, metrics.smallTargets], ['16px inputs', !metrics.smallInputs.length, metrics.smallInputs], ['named controls', !metrics.unnamed.length, metrics.unnamed], ['text contrast', !metrics.contrastFailures.length, metrics.contrastFailures]]) verify(`${size.width} ${scene}: ${name}`, pass, detail);
  }
  for (const size of [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }]) {
    const server = new FakeCloud(), context = await makeContext(browser, server, `quality-${size.width}`, accounts.a, { viewport: size, hasTouch: size.width < 1440 }), page = await context.newPage();
    page.setDefaultTimeout(12000); observe(page, report, String(size.width));
    await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.external.push({ origin: u.origin, path: u.pathname }); return route.abort('blockedbyclient'); });
    const activate = async locator => size.width < 1440 ? locator.tap() : locator.click();
    const activateSticky = async locator => {
      const target = await locator.evaluate(el => { const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, visible: y >= 0 && y < innerHeight && el.contains(document.elementFromPoint(x, y)), scrollY }; });
      assert(target.visible, 'sticky reading control must be physically visible at the selected paragraph');
      if (size.width < 1440) await page.touchscreen.tap(target.x, target.y); else await page.mouse.click(target.x, target.y);
      report.observations.push({ width: size.width, control: await locator.getAttribute('id'), beforeActivation: target.scrollY, afterActivation: await page.evaluate(() => scrollY) });
    };
    try {
      await page.goto(base + '/index.html?section=records'); await ready(page); await capture(page, 'records-empty', size);
      const source = await seed(page); await page.locator('#lifeSearch').fill(quote);
      const result = page.locator(`.life-source-card[data-version-id="${source.versionId}"] .life-source-open`);
      await result.focus(); await page.keyboard.press('Enter'); await settle(page); await frames(page);
      verify(`${size.width} search opens exact previous version`, await page.locator('#lifeVersion').inputValue() === source.versionId);
      assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
      await capture(page, 'reader-match', size); await selectMiddle(page);
      const position = await page.evaluate(() => scrollY); verify(`${size.width} selected middle is scrolled`, position > 400, position);
      await activateSticky(page.locator('#lifeExcerptToggle')); await page.locator('#lifeSourceTopic').fill('다시 읽은 질문'); await page.locator('#lifeSourceNote').fill('원래 문장의 둘째 생각을 이어 읽는다.');
      verify(`${size.width} excerpt shows exact middle quote`, await page.locator('#lifeSelectedQuote').textContent() === quote);
      await capture(page, 'reader-excerpt', size);
      await page.keyboard.press('Escape'); await frames(page);
      const closed = await page.evaluate(() => ({ y: scrollY, focus: document.activeElement?.id, expanded: document.querySelector('#lifeExcerptToggle').getAttribute('aria-expanded') }));
      verify(`${size.width} closing excerpt restores reading position and toolbar focus`, closed.expanded === 'false' && closed.focus === 'lifeExcerptToggle' && Math.abs(closed.y - position) < 3, { ...closed, expectedY: position });
      await activateSticky(page.locator('#lifeExcerptToggle')); assert.equal(await page.locator('#lifeSourceNote').inputValue(), '원래 문장의 둘째 생각을 이어 읽는다.');
      await activate(page.getByRole('button', { name: '선택 구절 모음에 추가', exact: true })); await settle(page); await frames(page);
      const b = await stored(page), record = b.records[0]; assert.equal(record.text, quote); assert.deepEqual(record.sourceRefs[0], { sourceId: source.sourceId, sourceVersionId: source.versionId, locator: { start: raw.indexOf(quote), end: raw.indexOf(quote) + quote.length } }); assert.equal(b.sourceVersions.find(v => v.id === source.versionId).contentText, raw);
      verify(`${size.width} saving excerpt keeps reading position`, Math.abs(await page.evaluate(() => scrollY) - position) < 3);
      await page.locator('#lifeSearchReturn').focus(); await page.keyboard.press('Enter'); await settle(page); await frames(page);
      verify(`${size.width} back preserves query and exact result focus`, await page.locator('#lifeSearch').inputValue() === quote && await result.evaluate(el => el === document.activeElement));
      await page.locator('#lifeSearch').fill('익명 샘플에 없는 검색어'); await capture(page, 'search-empty', size);
      await activate(page.getByRole('button', { name: '글쓰기', exact: true })); await page.locator('#lifeWritingTitle').waitFor();
      verify(`${size.width} writer entry clears previous excerpt success`, await page.locator('#lifeSaveStatus').textContent() === '' && await page.locator('#lifeWritingStatus').getAttribute('data-state') === 'empty');
      await capture(page, 'writer-empty', size);
      await page.locator('#lifeWritingTitle').fill(title); await page.locator('#lifeWritingBody').fill('책을 덮고 문장을 다시 읽었다.\n첫 글의 본문은 기록에 저장하기 전까지 브라우저 초안으로 남는다.'); await draftSaved(page);
      const fit = await page.locator('#lifeWritingTitle').evaluate(el => ({ tag: el.tagName, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, value: el.value }));
      verify(`${size.width} full long title is visible`, fit.tag === 'TEXTAREA' && fit.scrollHeight <= fit.clientHeight + 2 && fit.scrollWidth <= fit.clientWidth + 2 && fit.value === title, fit);
      await page.locator('#lifeWritingTitle').focus(); await page.keyboard.press('Home'); await page.keyboard.type('다시 '); await draftSaved(page);
      verify(`${size.width} title save retains focus and cursor`, await page.locator('#lifeWritingTitle').evaluate(el => el === document.activeElement && el.selectionStart === el.selectionEnd && el.selectionStart > 0));
      const enteredTitle = await page.locator('#lifeWritingTitle').inputValue();
      await page.keyboard.press('Enter'); verify(`${size.width} title Enter keeps single-line title without saving`, await page.locator('#lifeWritingTitle').evaluate(el => el === document.activeElement && !el.value.includes('\n')) && await page.locator('#lifeWritingTitle').inputValue() === enteredTitle && (await stored(page)).sources.length === 1);
      await capture(page, 'writer-long-title', size);
      const maximumTitle = ('천천히 읽은 생각을 나의 언어로 이어 쓰고 다음 문장을 고른다. ').repeat(25).slice(0, 500);
      await page.locator('#lifeWritingTitle').fill(maximumTitle); await draftSaved(page); await frames(page);
      const maximumFit = await page.locator('#lifeWritingTitle').evaluate(el => ({ length: el.value.length, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, maxLength: el.maxLength }));
      verify(`${size.width} maximum 500-character title fits`, maximumFit.length === 500 && maximumFit.maxLength === 500 && maximumFit.scrollHeight <= maximumFit.clientHeight + 2 && maximumFit.scrollWidth <= maximumFit.clientWidth + 2, maximumFit);
      await capture(page, 'writer-maximum-title', size);
      const longBody = Array.from({ length: 40 }, (_, i) => `${i + 1}번째 글쓰기 문단. 오래 남겨 둔 생각을 다른 문장으로 다시 쓰면서 중간에 읽던 위치를 기억한다. 질문을 이어 쓰는 동안 커서와 화면의 위치가 함께 남아 있어야 한다.`).join('\n\n');
      await page.locator('#lifeWritingBody').fill(longBody); await draftSaved(page);
      await page.locator('#lifeWritingBody').evaluate(el => { el.focus(); el.setSelectionRange(610, 640, 'backward'); el.scrollTop = 970; });
      const editorPosition = await page.locator('#lifeWritingBody').evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, scrollTop: el.scrollTop }));
      await page.locator('[data-haedo-navigation] [data-haedo-section="tools"]').click(); await settle(page);
      await page.locator('[data-haedo-navigation] [data-haedo-section="records"]').click(); await settle(page); await page.locator('#lifeWritingBody').waitFor(); await frames(page);
      const resumed = await page.locator('#lifeWritingBody').evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, scrollTop: el.scrollTop }));
      verify(`${size.width} section return keeps body selection direction and inner scroll`, JSON.stringify(editorPosition) === JSON.stringify(resumed) && await page.locator('#lifeWritingBody').inputValue() === longBody, { before: editorPosition, after: resumed });
      await activate(page.locator('#lifeWritingNew')); await page.locator('#lifeWritingBody').waitFor(); await frames(page);
      verify(`${size.width} new draft has independent position and text`, await page.locator('#lifeWritingBody').evaluate(el => !el.value && el.selectionStart === 0 && el.selectionEnd === 0 && el.scrollTop === 0));
      await page.locator('#lifeWritingTitle').fill('실패에서 복구하는 다른 익명 초안'); await draftSaved(page);
      await abortDraftWrites(page, true); await page.locator('#lifeWritingBody').fill('실패 후에도 입력을 유지하는 익명 본문.'); await page.locator('#lifeWritingError').waitFor({ state: 'visible' });
      await capture(page, 'writer-error', size); assert.equal(await page.locator('#lifeWritingBody').inputValue(), '실패 후에도 입력을 유지하는 익명 본문.');
      await page.locator('[data-haedo-navigation] [data-haedo-section="tools"]').click(); await page.locator('#lifeError').waitFor({ state: 'visible' });
      verify(`${size.width} failed navigation preserves writing error and input`, await page.locator('#lifeWritingError').isVisible() && await page.locator('#lifeWritingStatus').getAttribute('data-state') === 'error' && await page.locator('#lifeWritingBody').inputValue() === '실패 후에도 입력을 유지하는 익명 본문.');
      await abortDraftWrites(page, false); await activate(page.locator('#lifeWritingRetry')); await draftSaved(page);
      await page.locator('#lifeWritingSave').focus(); await page.keyboard.press('Enter'); await page.locator('#lifeSourceText').waitFor(); await settle(page); assert.equal(await page.locator('#lifeSourceText').textContent(), '실패 후에도 입력을 유지하는 익명 본문.');
      await capture(page, 'writer-saved-reader', size);
      // Delay the real IDB read's success delivery to expose loading; release it unchanged.
      await page.locator('.life-reader-tools > button').first().click(); await settle(page);
      await page.evaluate(() => {
        window.__qualityGetAll = IDBIndex.prototype.getAll; window.__qualityRelease = null;
        IDBIndex.prototype.getAll = function(...args) {
          const request = __qualityGetAll.apply(this, args);
          if (this.objectStore.name === 'staging') {
            const add = request.addEventListener.bind(request);
            request.addEventListener = (name, listener, options) => add(name, name === 'success' ? event => { window.__qualityRelease = () => listener.call(request, event); } : listener, options);
          }
          return request;
        };
      });
      const opening = page.getByRole('button', { name: '글쓰기', exact: true }).click(); await page.locator('.life-writing[aria-busy="true"]').waitFor(); await capture(page, 'writer-loading', size);
      verify(`${size.width} writer loading clears previous record-save success`, await page.locator('#lifeSaveStatus').textContent() === '');
      await page.waitForFunction(() => !!__qualityRelease); await page.evaluate(() => { IDBIndex.prototype.getAll = __qualityGetAll; __qualityRelease(); }); await opening; await page.locator('#lifeWritingBody').waitFor();
      assert.equal(server.writes().length, 0); report.checks.push({ name: `${size.width} combined local journey`, pass: true }); console.log('PASS combined quality ' + size.width);
    } catch (error) { report.checks.push({ name: `${size.width} combined local journey`, pass: false, error: error.stack }); console.error('FAIL ' + size.width + '\n' + error.stack); await page.screenshot({ path: path.join(out, `failure-${size.width}.png`), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  await browser.close(); await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Reading/writing quality: ${report.checks.filter(c => c.pass).length}/${report.checks.length} checks; ${report.visual.length} captures; console ${report.consoleErrors.length}; page ${report.pageErrors.length}.`);
  if ((!baseline && report.checks.some(c => !c.pass)) || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
