/* Annual plan open on two devices of one account (and in two tabs): a plan arriving from elsewhere is
 * taken quietly, unsaved input is merged on top of it, a Korean composition is not touched, and
 * 저장하지 못함 is shown only when this device really cannot store.
 * Real local UI, bundled SDK, scoped IndexedDB and the account-document sync engine; Auth and the
 * account-document RPCs are the anonymous FakeCloud. All plans are synthetic. The composition is
 * Chromium's Input.imeSetComposition, not a real Korean keyboard or an Apple device. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const output = path.resolve(process.env.ANNUAL_PLAN_SYNC_OUTPUT || '.local/annual-plan-sync-browser');
const entry = base + '/index.html?section=tools&view=annual-plan';
const report = { createdAt: new Date().toISOString(), scope: 'Local actual UI/Core/bundled SDK/scoped IndexedDB/account-document sync with anonymous FakeCloud. Two browser contexts stand for two devices of one synthetic account. No production user/DB, real IME or Apple hardware.', checks: [], visual: [], consoleErrors: [], pageErrors: [], expectedErrors: 0 };
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(read, accept, label, timeout = 20000) {
  const deadline = Date.now() + timeout; let value;
  for (;;) {
    value = await read(); if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error('timed out: ' + label + ' — last ' + JSON.stringify(value)?.slice(0, 900));
    await sleep(100);
  }
}
const docKey = workspaceId => 'annualPlan:' + JSON.stringify([cloud, accounts.a.id]) + ':' + workspaceId;
const serverPlan = server => [...(server.accountDocs.get(accounts.a.id) || new Map()).entries()].find(([key]) => key.startsWith('annualPlan:'))?.[1]?.data || null;
const texts = plan => plan ? { rows: plan.rows.map(row => row.year + ':' + row.text), entries: plan.entries.map(item => item.date + ':' + item.text) } : null;
const stored = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.readAnnualPlan(await s.getActive()); });
const kick = page => page.evaluate(() => { dispatchEvent(new Event('online')); });
const annual = (page, year) => page.locator('[data-ap-annual="' + year + '"]');
const month = (page, date) => page.locator('[data-ap-month="' + date + '"] [data-ap-entry]');
// Every save-state sentence and error text the screen showed since open().
async function open(page) {
  await page.goto(entry); await ready(page); await page.locator('#apGrid').waitFor();
  await page.evaluate(() => {
    window.__apSeen = { status: [], error: [] };
    const read = () => {
      const status = document.querySelector('#apSaveStatus')?.textContent || '', error = document.querySelector('#apError');
      if (status && __apSeen.status.at(-1) !== status) __apSeen.status.push(status);
      if (error && !error.hidden && error.textContent && __apSeen.error.at(-1) !== error.textContent) __apSeen.error.push(error.textContent);
    };
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); read();
  });
}
const seen = page => page.evaluate(() => window.__apSeen);
async function quiet(page, label) {
  const log = await seen(page);
  assert.deepEqual(log.error, [], label + ': no error text was ever shown');
  assert.equal(log.status.some(text => /저장하지 못함/.test(text)), false, label + ': 저장하지 못함 was never shown — ' + JSON.stringify(log.status));
  assert.equal(await page.locator('#apError').isVisible(), false); assert.equal(await page.locator('#apRetry').isVisible(), false);
  assert.equal(await page.locator('#apReload, #apReapply').count(), 0, label + ': no manual latest/reapply step exists');
}
async function settled(page, label) {
  await until(() => page.evaluate(() => ({ dirty: document.querySelector('.annual-plan')?.dataset.dirty, state: document.querySelector('.annual-plan')?.dataset.saveState })),
    value => value.dirty === 'false' && value.state === 'ok', label + ': saved and on the account');
}
// B's change reaches the server; nothing has told A yet.
async function bothOpen(a, b, server) {
  await open(a); await open(b);
  const year = (await stored(a)).rows[0].year;
  await annual(a, year).fill('올해 계획'); await until(() => texts(serverPlan(server)), value => value?.rows.includes(year + ':올해 계획'), 'A plan on the account');
  await kick(b); await until(() => annual(b, year).inputValue(), value => value === '올해 계획', 'B shows the plan'); await settled(a, 'A'); await settled(b, 'B');
  return year;
}
async function addMonth(page, date, text) {
  await page.locator('[data-ap-add-month="' + date + '"]').click(); await month(page, date).last().fill(text);
}
// Another tab of the same device stores a change computed from the stored plan (a patch for AnnualPlan.update).
const otherTab = (page, source, argument) => page.evaluate(async ({ source, argument }) => {
  const s = HaedoLife.Shell.storage, w = await s.getActive(), M = HaedoLife.AnnualPlan, old = await s.readAnnualPlan(w);
  const next = M.update(old, new Function('plan', 'a', 'return (' + source + ')(plan, a)')(old, argument), { expectedRevision: old.revision });
  if ((await s.saveAnnualPlan(w, next, old.revision)).status !== 'stored') throw Error('other tab fixture');
}, { source: source.toString(), argument });
const recoveryRows = page => page.evaluate(async () => {
  const s = HaedoLife.Shell.storage, w = await s.getActive(), row = (await s.listAccountDocs()).find(item => item.prefix === 'annualPlan' && item.workspaceId === w);
  return row ? (await s.listAccountDocRecoveries(row.key)).map(item => ({ reason: item.reason, value: item.value })) : [];
});
const saveLine = async page => (await page.locator('.ap-save-line').textContent()).replace(/\s+/g, ' ').trim();
async function twoTabs(device) {
  const { context, page } = await device('mac'), second = await context.newPage();
  await open(page); await open(second); await page.bringToFront();
  return { page, second, year: (await stored(page)).rows[0].year };
}
const hold = page => page.evaluate(() => { window.__holdAnnualSave = true; window.__annualSaveEntered = false; });
const held = page => until(() => page.evaluate(() => window.__annualSaveEntered), Boolean, 'the save is in flight');
const clean = page => until(() => page.evaluate(() => document.querySelector('.annual-plan').dataset.dirty), value => value === 'false', 'nothing unsaved');
async function holdSaves(context) {
  await context.route(base + '/assets/life/storage.js', async route => {
    const response = await route.fetch();
    const hook = `\n;(()=>{const old=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...old,forAccount(...args){const actual=old.forAccount(...args);return Object.freeze({...actual,async saveAnnualPlan(...values){if(window.__holdAnnualSave){window.__annualSaveEntered=true;await new Promise(resolve=>window.__annualSaveRelease=()=>{window.__holdAnnualSave=false;resolve();});}return actual.saveAnnualPlan(...values);}});}});})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
}

async function main() {
  await fs.rm(output, { recursive: true, force: true }); await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function check(name, run) {
    if (process.env.ANNUAL_PLAN_SYNC_MATCH && !new RegExp(process.env.ANNUAL_PLAN_SYNC_MATCH).test(name)) return;
    const server = new FakeCloud(); server.enableAccountLibrary();
    const contexts = [], pages = [];
    const device = async label => {
      const context = await makeContext(browser, server, label + '-' + report.checks.length, accounts.a, { viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
      await holdSaves(context); contexts.push(context);
      context.on('page', page => {
        page.setDefaultTimeout(15000); pages.push(page);
        page.on('pageerror', error => report.pageErrors.push({ check: name, device: label, message: error.message }));
        page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ check: name, device: label, message: event.text() }); });
      });
      return { context, page: await context.newPage() };
    };
    console.log('RUN ' + name);
    try { await run({ device, server }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      for (const [index, page] of pages.entries()) await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '-' + index + '.png'), fullPage: true }).catch(() => {});
    } finally { for (const context of contexts) await context.close(); }
  }
  try {
    await check('a field that only has the cursor takes the other device\'s plan quietly and keeps saving', async ({ device, server }) => {
      const a = (await device('mac')).page, b = (await device('phone')).page, year = await bothOpen(a, b, server);
      const field = annual(a, year);
      await field.evaluate(el => { window.__apField = el; el.focus(); el.setSelectionRange(2, 2); });
      await addMonth(b, year + '-03-01', '폰의 3월 계획');
      await until(() => texts(serverPlan(server)), value => value.entries.includes(year + '-03-01:폰의 3월 계획'), 'B entry on the account');
      await kick(a); await until(() => month(a, year + '-03-01').count(), count => count === 1, 'A shows the March entry while its cursor stays in the annual field');
      assert.equal(await month(a, year + '-03-01').inputValue(), '폰의 3월 계획');
      assert.deepEqual(await field.evaluate(el => ({ same: el === __apField, connected: el.isConnected, focused: document.activeElement === el, value: el.value, start: el.selectionStart, end: el.selectionEnd })),
        { same: true, connected: true, focused: true, value: '올해 계획', start: 2, end: 2 }, 'the focused field kept its node, value and caret');
      await settled(a, 'A after taking the plan'); await quiet(a, 'A after the other device changed the plan');
      // Typing continues at the caret and is stored; so is a new entry.
      await a.keyboard.type('의 큰');
      await until(() => stored(a), plan => plan.rows[0].text === '올해의 큰 계획', 'A input after the arrival is stored');
      await addMonth(a, year + '-05-01', '맥의 5월 계획');
      await until(() => texts(serverPlan(server)), value => value.rows.includes(year + ':올해의 큰 계획') && value.entries.join('|') === [year + '-03-01:폰의 3월 계획', year + '-05-01:맥의 5월 계획'].join('|'), 'both devices\' changes on the account');
      await kick(b); await until(() => month(b, year + '-05-01').count(), count => count === 1, 'B shows the May entry');
      assert.deepEqual(texts(await stored(b)), texts(await stored(a)), 'both devices store the same plan');
      await settled(a, 'A'); await quiet(a, 'A at the end'); await quiet(b, 'B at the end');
      // Nothing holds the person on this screen.
      await a.locator('[data-haedo-navigation] [data-haedo-section="records"]:visible').first().click();
      await until(() => a.locator('#apGrid').count(), count => count === 0, 'A leaves the plan through the menu');
    });

    await check('a second tab changing the plan is taken the same way (focused field, nothing unsaved)', async ({ device }) => {
      const { context, page } = await device('mac'), second = await context.newPage();
      await open(page); await open(second);
      const year = (await stored(page)).rows[0].year;
      await annual(page, year).fill('첫 탭의 계획'); await until(() => stored(page), plan => plan.rows[0].text === '첫 탭의 계획', 'first tab stored');
      await until(() => annual(second, year).inputValue(), value => value === '첫 탭의 계획', 'second tab shows it');
      await page.bringToFront(); await annual(page, year).evaluate(el => { window.__apField = el; el.focus(); el.setSelectionRange(1, 3); });
      await second.evaluate(async date => {
        const s = HaedoLife.Shell.storage, w = await s.getActive(), M = HaedoLife.AnnualPlan, old = await s.readAnnualPlan(w);
        const next = M.update(old, { entries: [{ id: 'second-tab-entry', date, text: '둘째 탭의 7월 계획' }] }, { expectedRevision: old.revision });
        if ((await s.saveAnnualPlan(w, next, old.revision)).status !== 'stored') throw Error('second tab fixture');
      }, year + '-07-01');
      await until(() => month(page, year + '-07-01').count(), count => count === 1, 'first tab shows the other tab\'s entry');
      assert.deepEqual(await annual(page, year).evaluate(el => ({ same: el === __apField, focused: document.activeElement === el, start: el.selectionStart, end: el.selectionEnd })), { same: true, focused: true, start: 1, end: 3 });
      await quiet(page, 'first tab');
      await page.keyboard.press('End'); await page.keyboard.type(' 이어서');
      await until(() => stored(page), plan => plan.rows[0].text === '첫 탭의 계획 이어서' && plan.entries.length === 1, 'first tab keeps saving on top of the other tab\'s plan');
      await quiet(page, 'first tab at the end');
    });

    await check('unsaved input and the other device\'s change both stay; the same field keeps this input and a recovery copy', async ({ device, server }) => {
      const a = (await device('mac')).page, b = (await device('phone')).page, year = await bothOpen(a, b, server);
      // Different fields: A's annual text is on its way to this device's storage when B's March entry arrives.
      await a.evaluate(() => { window.__holdAnnualSave = true; window.__annualSaveEntered = false; });
      await annual(a, year).fill('맥에서 고친 올해 계획'); await until(() => a.evaluate(() => window.__annualSaveEntered), Boolean, 'A save is in flight');
      await addMonth(b, year + '-03-01', '폰의 3월 계획');
      await until(() => texts(serverPlan(server)), value => value.entries.includes(year + '-03-01:폰의 3월 계획'), 'B entry on the account');
      await kick(a); await until(() => stored(a), plan => plan.entries.length === 1, 'the account sync stored B\'s entry under A\'s open editor');
      assert.equal((await stored(a)).rows[0].text, '올해 계획', 'A\'s unsaved input is not stored yet');
      await a.evaluate(() => __annualSaveRelease());
      await until(() => texts(serverPlan(server)), value => value.rows.includes(year + ':맥에서 고친 올해 계획') && value.entries.includes(year + '-03-01:폰의 3월 계획'), 'both changes on the account');
      assert.equal(await annual(a, year).inputValue(), '맥에서 고친 올해 계획'); assert.equal(await month(a, year + '-03-01').inputValue(), '폰의 3월 계획');
      await settled(a, 'A'); await quiet(a, 'A after merging'); assert.equal(await a.locator('#apKept').isVisible(), false, 'different fields leave no recovery copy');
      await kick(b); await until(() => annual(b, year).inputValue(), value => value === '맥에서 고친 올해 계획', 'B shows A\'s annual text'); await settled(b, 'B');
      // The same field: A's unsaved text stays, B's version of that field is kept as a recovery copy.
      await a.evaluate(() => { window.__holdAnnualSave = true; window.__annualSaveEntered = false; });
      await month(a, year + '-03-01').fill('맥에서 고친 3월 계획'); await until(() => a.evaluate(() => window.__annualSaveEntered), Boolean, 'A save is in flight again');
      await month(b, year + '-03-01').fill('폰에서 다시 고친 3월 계획');
      await until(() => texts(serverPlan(server)), value => value.entries.includes(year + '-03-01:폰에서 다시 고친 3월 계획'), 'B edit on the account');
      await kick(a); await until(() => stored(a), plan => plan.entries[0].text === '폰에서 다시 고친 3월 계획', 'the account sync stored B\'s edit under A\'s open editor');
      await a.evaluate(() => __annualSaveRelease());
      await until(() => texts(serverPlan(server)), value => value.entries.includes(year + '-03-01:맥에서 고친 3월 계획'), 'A\'s input wins the same field');
      assert.equal(await month(a, year + '-03-01').inputValue(), '맥에서 고친 3월 계획');
      await settled(a, 'A'); await quiet(a, 'A after the same-field change');
      const kept = a.locator('#apKept'); await kept.waitFor({ state: 'visible' });
      assert.equal(await kept.locator('summary').textContent(), '복구 사본 1개');
      await kept.locator('summary').click(); assert.match(await a.locator('#apKeptText').textContent(), /폰에서 다시 고친 3월 계획/);
      const rows = await a.evaluate(async key => (await HaedoLife.Shell.storage.listAccountDocRecoveries(key)).map(row => ({ reason: row.reason, value: row.value })), docKey((await stored(a)).workspaceId));
      assert.equal(rows.length, 1); assert.equal(rows[0].reason, 'merge_conflict');
      assert.equal(rows[0].value.items.length, 1); assert.equal(rows[0].value.items[0].text, '폰에서 다시 고친 3월 계획', 'the losing version is kept on this device before it is replaced');
      for (const width of [1440, 820, 390]) {
        await a.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await kept.scrollIntoViewIfNeeded();
        const audit = await a.evaluate(() => { const close = document.querySelector('#apKeptClose').getBoundingClientRect(), summary = document.querySelector('#apKept > summary').getBoundingClientRect(); return { documentWidth: document.documentElement.scrollWidth, close: [close.width, close.height], summary: [summary.width, summary.height] }; });
        const file = 'recovery-copy-' + width + '.png'; await a.screenshot({ path: path.join(output, file) }); report.visual.push({ width, file, audit });
        assert.ok(audit.documentWidth <= width, 'no page overflow at ' + width); assert.ok(audit.close[1] >= 44 && audit.summary[1] >= 44, '44px controls at ' + width);
      }
      await a.setViewportSize({ width: 1440, height: 1000 });
      await a.locator('#apKeptClose').click(); assert.equal(await kept.isVisible(), false);
      await kick(b); await until(() => month(b, year + '-03-01').inputValue(), value => value === '맥에서 고친 3월 계획', 'B shows the winning text'); await quiet(b, 'B');
    });

    await check('a Korean composition is untouched while the other device\'s plan arrives around it', async ({ device, server }) => {
      const mac = await device('mac'), a = mac.page, b = (await device('phone')).page, year = await bothOpen(a, b, server);
      const field = annual(a, year), cdp = await mac.context.newCDPSession(a);
      await a.bringToFront();
      await field.evaluate(el => {
        window.__apField = el; window.__apComposition = [];
        for (const type of ['compositionstart', 'compositionend']) el.addEventListener(type, () => __apComposition.push(type));
        el.focus(); el.setSelectionRange(el.value.length, el.value.length);
      });
      await cdp.send('Input.imeSetComposition', { text: ' ㅎ', selectionStart: 2, selectionEnd: 2 });
      await cdp.send('Input.imeSetComposition', { text: ' 하', selectionStart: 2, selectionEnd: 2 });
      await cdp.send('Input.imeSetComposition', { text: ' 한', selectionStart: 2, selectionEnd: 2 });
      assert.deepEqual(await a.evaluate(() => __apComposition), ['compositionstart'], 'a real composition is in progress');
      const during = () => field.evaluate(el => ({ same: el === __apField, connected: el.isConnected, focused: document.activeElement === el, value: el.value, start: el.selectionStart, end: el.selectionEnd, events: [...__apComposition] }));
      const before = await during(); assert.equal(before.value, '올해 계획 한');
      await addMonth(b, year + '-03-01', '폰의 3월 계획');
      await until(() => texts(serverPlan(server)), value => value.entries.includes(year + '-03-01:폰의 3월 계획'), 'B entry on the account');
      await kick(a); await until(() => month(a, year + '-03-01').count(), count => count === 1, 'A shows B\'s entry during the composition');
      assert.deepEqual(await during(), before, 'the composing field kept its node, text, caret and composition');
      assert.equal((await stored(a)).rows[0].text, '올해 계획', 'composing text is not stored before the composition ends');
      // The composition goes on after the arrival and ends normally.
      await cdp.send('Input.imeSetComposition', { text: ' 한ㄱ', selectionStart: 3, selectionEnd: 3 });
      await cdp.send('Input.imeSetComposition', { text: ' 한그', selectionStart: 3, selectionEnd: 3 });
      await cdp.send('Input.imeSetComposition', { text: ' 한글', selectionStart: 3, selectionEnd: 3 });
      assert.deepEqual(await a.evaluate(() => __apComposition), ['compositionstart'], 'still the same composition');
      await cdp.send('Input.insertText', { text: ' 한글' });
      assert.deepEqual(await a.evaluate(() => __apComposition), ['compositionstart', 'compositionend']);
      assert.equal(await field.inputValue(), '올해 계획 한글');
      await until(() => texts(serverPlan(server)), value => value.rows.includes(year + ':올해 계획 한글') && value.entries.includes(year + '-03-01:폰의 3월 계획'), 'composed text and B\'s entry on the account');
      assert.equal(await field.evaluate(el => el === __apField && document.activeElement === el), true);
      await settled(a, 'A'); await quiet(a, 'A'); assert.equal(await a.locator('#apKept').isVisible(), false);
      await kick(b); await until(() => annual(b, year).inputValue(), value => value === '올해 계획 한글', 'B shows the composed text'); await quiet(b, 'B');
    });

    await check('저장하지 못함 appears only when this device cannot store; the other device\'s plan still arrives and the retry saves both', async ({ device, server }) => {
      const a = (await device('mac')).page, b = (await device('phone')).page, year = await bothOpen(a, b, server);
      await quiet(a, 'A before the failure');
      // This device refuses to store the plan that holds A's new text; nothing else fails.
      await a.evaluate(() => {
        window.__apPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) { const request = __apPut.apply(this, args); if (this.name === 'meta' && typeof args[0]?.key === 'string' && args[0].key.startsWith('annualPlan:') && JSON.stringify(args[0].value).includes('저장 실패 중의 입력')) this.transaction.abort(); return request; };
      });
      await annual(a, year).fill('저장 실패 중의 입력'); await a.locator('#apRetry').waitFor({ state: 'visible' });
      assert.equal((await a.locator('.ap-save-line').textContent()).replace(/\s+/g, ' ').trim(), '저장하지 못함 · 다시 시도');
      assert.match(await a.locator('#apError').textContent(), /저장하지 못했습니다/);
      assert.equal((await stored(a)).rows[0].text, '올해 계획');
      await addMonth(b, year + '-03-01', '폰의 3월 계획');
      await until(() => texts(serverPlan(server)), value => value.entries.includes(year + '-03-01:폰의 3월 계획'), 'B entry on the account');
      await kick(a); await until(() => month(a, year + '-03-01').count(), count => count === 1, 'A shows B\'s entry while its own input is unsaved');
      assert.equal(await annual(a, year).inputValue(), '저장 실패 중의 입력', 'the unsaved input is still on screen');
      assert.equal((await a.locator('.ap-save-line').textContent()).replace(/\s+/g, ' ').trim(), '저장하지 못함 · 다시 시도', 'the real failure is still reported');
      await a.evaluate(() => { IDBObjectStore.prototype.put = __apPut; }); await a.locator('#apRetry').click();
      await until(() => texts(serverPlan(server)), value => value.rows.includes(year + ':저장 실패 중의 입력') && value.entries.includes(year + '-03-01:폰의 3월 계획'), 'the retry stores A\'s input on top of B\'s entry');
      await settled(a, 'A after the retry'); assert.equal(await a.locator('#apError').isVisible(), false); assert.equal(await a.locator('#apRetry').isVisible(), false);
      await quiet(b, 'B');
    });

    await check('the other side\'s text is stored as a recovery copy before the save that replaces it; if that copy cannot be stored, nothing is replaced', async ({ device }) => {
      const { page, second, year } = await twoTabs(device), date = year + '-03-01';
      await otherTab(second, (plan, date) => ({ entries: [{ id: 'e-march', date, text: '3월 원문' }] }), date);
      await until(() => month(page, date).count(), count => count === 1, 'the entry is shown'); await clean(page);
      // This device cannot store recovery copies (and only those).
      await page.evaluate(() => {
        window.__apAdd = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (...args) { const request = __apAdd.apply(this, args); if (this.name === 'meta' && typeof args[0]?.key === 'string' && args[0].key.startsWith('accountDocRecovery:')) this.transaction.abort(); return request; };
      });
      await hold(page); await month(page, date).fill('이 탭이 고친 3월'); await held(page);
      await otherTab(second, plan => ({ entries: plan.entries.map(item => ({ ...item, text: '다른 탭이 고친 3월' })) }));
      await page.evaluate(() => __annualSaveRelease());
      await page.locator('#apRetry').waitFor({ state: 'visible' });
      assert.equal(await saveLine(page), '저장하지 못함 · 다시 시도');
      assert.equal((await stored(page)).entries[0].text, '다른 탭이 고친 3월', 'the other side\'s text was not replaced while its copy could not be stored');
      assert.deepEqual(await recoveryRows(page), []);
      assert.equal(await month(page, date).inputValue(), '이 탭이 고친 3월', 'this input is still on screen');
      assert.match(await page.locator('#apKeptText').textContent(), /다른 탭이 고친 3월/, 'and the other side\'s text is readable here');
      await page.evaluate(() => { IDBObjectStore.prototype.add = __apAdd; }); await page.locator('#apRetry').click();
      await until(() => stored(page), plan => plan.entries[0].text === '이 탭이 고친 3월', 'the retry stores this input');
      assert.deepEqual(await recoveryRows(page), [{ reason: 'merge_conflict', value: { items: [{ id: 'e-march', date, text: '다른 탭이 고친 3월' }] } }]);
      await clean(page); assert.equal(await page.locator('#apError').isVisible(), false);
    });

    await check('an undo that ends because a plan arrived leaves what it could bring back as a recovery copy (deletion and restore)', async ({ device }) => {
      const { page, second, year } = await twoTabs(device);
      await otherTab(second, (plan, year) => ({ rows: [{ year, text: '올해' }], entries: [{ id: 'e-march', date: year + '-03-01', text: '지울 3월 계획 원문' }, { id: 'e-may', date: year + '-05-01', text: '5월' }] }), year);
      await until(() => month(page, year + '-03-01').count(), count => count === 1, 'the entries are shown'); await clean(page);
      await page.locator('[data-ap-remove-entry="e-march"]').click(); await page.locator('#apConfirmation').getByRole('button', { name: '삭제', exact: true }).click();
      await until(() => stored(page), plan => plan.entries.length === 1, 'the deletion is stored');
      assert.equal(await page.locator('#apUndo button').textContent(), '삭제 되돌리기');
      await otherTab(second, plan => ({ entries: plan.entries.map(item => item.id === 'e-may' ? { ...item, text: '다른 탭이 고친 5월' } : item) }));
      await until(() => month(page, year + '-05-01').inputValue(), value => value === '다른 탭이 고친 5월', 'the other tab\'s change is shown');
      assert.equal(await page.locator('#apUndo').isVisible(), false, 'the whole-plan undo would remove what arrived, so it ended');
      await until(() => recoveryRows(page), rows => rows.length === 1, 'the deleted entry is kept on this device');
      assert.deepEqual(await recoveryRows(page), [{ reason: 'undo_discarded', value: { items: [{ id: 'e-march', date: year + '-03-01', text: '지울 3월 계획 원문' }] } }]);
      assert.equal(await page.locator('#apKept > summary').textContent(), '복구 사본 1개');
      const shownText = await page.locator('#apKeptText').textContent(); assert.match(shownText, /되돌리기를 닫았습니다/); assert.match(shownText, /지울 3월 계획 원문/);
      assert.deepEqual(texts(await stored(page)).entries, [year + '-05-01:다른 탭이 고친 5월']); await quiet(page, 'after the deletion\'s undo ended');
      // A restore's undo holds the whole plan from before the restore.
      await page.locator('#apKept > summary').click(); await page.locator('#apKeptClose').click(); await page.locator('#apSettings > summary').click();
      const backup = await page.evaluate(async year => { const s = HaedoLife.Shell.storage, value = HaedoLife.AnnualPlan.exportBackup(await s.readAnnualPlan(await s.getActive())); value.plan.rows = [{ year, text: '백업에서 온 계획' }]; value.plan.entries = []; return value; }, year);
      await page.locator('#apImport').setInputFiles({ name: 'synthetic-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
      await page.locator('#apImportPreview').waitFor(); await page.locator('#apImportApply').click();
      await until(() => stored(page), plan => plan.rows[0].text === '백업에서 온 계획' && plan.entries.length === 0, 'the restore is stored');
      assert.equal(await page.locator('#apUndo button').textContent(), '적용 되돌리기');
      await otherTab(second, (plan, year) => ({ entries: [{ id: 'e-july', date: year + '-07-01', text: '다른 탭의 7월' }] }), year);
      await until(() => month(page, year + '-07-01').count(), count => count === 1, 'the other tab\'s entry is shown');
      assert.equal(await page.locator('#apUndo').isVisible(), false);
      await until(() => recoveryRows(page), rows => rows.length === 2, 'the plan from before the restore is kept');
      const whole = (await recoveryRows(page))[1]; assert.equal(whole.reason, 'undo_discarded');
      assert.deepEqual(texts(whole.value), { rows: [year + ':올해'], entries: [year + '-05-01:다른 탭이 고친 5월'] });
      assert.match(await page.locator('#apKeptText').textContent(), /다른 탭이 고친 5월/); await quiet(page, 'after the restore\'s undo ended');
    });

    await check('one side\'s birthday basis meeting the other side\'s cleared birth date is settled as year basis; the other side\'s unrelated edit stays in the plan', async ({ device }) => {
      const { page, second, year } = await twoTabs(device), date = year + '-03-01';
      await otherTab(second, (plan, a) => ({ birthDate: '1990-07-15', rows: [{ year: a.year, text: '올해 원문' }], entries: [{ id: 'e-march', date: a.date, text: '3월 원문' }] }), { year, date });
      await until(() => month(page, date).count(), count => count === 1, 'the entry is shown'); await clean(page);
      await page.locator('#apSettings > summary').click(); await hold(page);
      await page.locator('#apBasis').selectOption('birthday'); await held(page);
      await otherTab(second, plan => ({ birthDate: '', basis: 'year', entries: plan.entries.map(item => ({ ...item, text: '다른 탭이 고친 3월' })) }));
      await page.evaluate(() => __annualSaveRelease());
      await until(() => page.locator('[data-ap-entry="e-march"]').inputValue(), value => value === '다른 탭이 고친 3월', 'the other tab\'s unrelated edit is in this plan');
      await clean(page);
      const plan = await stored(page);
      assert.deepEqual({ birthDate: plan.birthDate, basis: plan.basis, ...texts(plan) }, { birthDate: '', basis: 'year', rows: [year + ':올해 원문'], entries: [date + ':다른 탭이 고친 3월'] });
      assert.equal(await page.locator('#apBasis').inputValue(), 'year'); assert.equal(await page.locator('#apBirthDate').inputValue(), '');
      assert.equal(await page.locator('#apKept').isVisible(), false, 'nothing had to be set aside'); assert.deepEqual(await recoveryRows(page), []); await quiet(page, 'after the settings met');
    });

    await check('two plans that together pass the year limit: this plan stays whole, the other plan is kept whole and the note says so', async ({ device }) => {
      const { page, second } = await twoTabs(device);
      await otherTab(second, () => ({ rows: Array.from({ length: 199 }, (_, n) => ({ year: 2000 + n, text: '' })), entries: [] }));
      await until(() => page.locator('[data-ap-annual]').count(), count => count === 199, '199 years are shown'); await clean(page);
      // Held before the year is added, so the other tab still sees 199 years.
      await hold(page); await page.locator('#apAddYear').click(); await annual(page, 2199).fill('이 탭의 200번째 연도'); await held(page);
      await otherTab(second, plan => ({ rows: [{ year: 1999, text: '다른 탭의 200번째 연도' }, ...plan.rows] }));
      await page.evaluate(() => __annualSaveRelease());
      await until(() => stored(page), plan => plan.rows.some(row => row.year === 2199 && row.text === '이 탭의 200번째 연도'), 'this plan is stored');
      const plan = await stored(page); assert.equal(plan.rows.length, 200); assert.equal(plan.rows.some(row => row.year === 1999), false, 'the two plans could not be stored together');
      const rows = await recoveryRows(page); assert.equal(rows.length, 1); assert.equal(rows[0].reason, 'conflict_remote');
      assert.equal(rows[0].value.rows.length, 200); assert.deepEqual(rows[0].value.rows[0], { year: 1999, text: '다른 탭의 200번째 연도' }, 'the other plan is kept whole');
      const note = await page.locator('#apKeptText').textContent(); assert.match(note, /보관 한도를 넘어/); assert.match(note, /다른 탭의 200번째 연도/); assert.doesNotMatch(note, /같은 칸을/);
      await quiet(page, 'after the limit');
    });
  } finally {
    await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  for (const key of ['consoleErrors', 'pageErrors']) assert.deepEqual(report[key], [], key);
  assert.ok(report.checks.length > 0 && report.checks.every(row => row.pass), 'every check passed');
  console.log('Annual plan sync: ' + report.checks.length + ' passed; console/page errors 0.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
