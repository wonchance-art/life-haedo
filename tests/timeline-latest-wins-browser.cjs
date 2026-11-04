/* Task 3 (2026-11-04): the timeline editor (assets/app.js) follows the same newest-wins rule as the
 * shared store, and a timeline tab and the 일정 행복도 input on the same document lose nothing.
 * Real app, SDK and IDB; anonymous intercepted Auth; haedo_documents / haedo_items in memory with
 * server stamps and conditional PATCH (tests/schedule-entries-browser.cjs PlatformTables).
 * npm run dev; node tests/timeline-latest-wins-browser.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { PlatformTables } = require('./schedule-entries-browser.cjs');

const output = path.resolve(process.env.TIMELINE_LWW_OUTPUT || '.local/timeline-latest-wins-browser');
const TODAY = '2026-11-03T12:00:00+09:00'; // 03:00Z; the server clock below starts before it
const report = { checks: [], consoleErrors: [], pageErrors: [] };
const DOC = 'd_timeline';
const timelineDoc = () => ({ profile: { name: '내 연표', birth: '1990-01' }, scale: 'signed1', events: [{ date: '2020-01', title: '익명 사건' }], spans: [], eras: [],
  happiness: [], thoughts: [], records: [], trips: [], layers: [] });
const regKey = id => 'caeyeon_life_account_' + id + '_registry', docKey = (id, doc) => 'caeyeon_life_account_' + id + '_doc_' + doc;

async function openTimeline(page) {
  await page.goto(base + '/timeline.html?doc=' + DOC);
  await page.waitForFunction(() => document.getElementById('timelineAccess')?.hidden && typeof window.refreshWorkspace !== 'undefined' && typeof persist === 'function');
}
async function openDay(page, date) {
  await page.goto(base + '/index.html?section=schedule&view=day&date=' + date); await ready(page);
  await page.waitForFunction(() => document.querySelector('#lifeMain')?.dataset.mode === 'day' && document.querySelector('.schedule-entries .schedule-entry-body')?.childElementCount > 0);
}
// A timeline edit as the editor makes it (mutate DATA, persist).
const timelineEdit = (page, title, date = '2026-11-03') => page.evaluate(([title, date]) => { DATA.events.push({ date, title }); persist(); }, [title, date]);
const happiness = (page, n) => page.locator('.schedule-happiness-option', { hasText: new RegExp('^' + n + '$') }).click();
async function settled(tables, test, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const row = tables.rows.haedo_documents.get(DOC); if (row && test(row.data)) return row; await new Promise(done => setTimeout(done, 200)); }
  throw new Error('server copy never reached: ' + label + '\n' + JSON.stringify(tables.rows.haedo_documents.get(DOC)?.data));
}
const local = (page, id) => page.evaluate(([reg, key]) => ({ reg: JSON.parse(localStorage.getItem(reg)), doc: key && JSON.parse(localStorage.getItem(key)) }), [regKey(accounts.a.id), id ? docKey(accounts.a.id, id) : null]);
const allDocs = page => page.evaluate(([reg, prefix]) => JSON.parse(localStorage.getItem(reg)).docs.map(d => ({ ...d, data: JSON.parse(localStorage.getItem(prefix + d.id)) })), [regKey(accounts.a.id), 'caeyeon_life_account_' + accounts.a.id + '_doc_']);

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run) {
    if (process.env.TIMELINE_LWW_MATCH && !new RegExp(process.env.TIMELINE_LWW_MATCH).test(name)) return;
    const server = new FakeCloud(), tables = new PlatformTables('2026-11-03T01:00:00Z'), device = 'tlww-' + report.checks.length;
    const context = await makeContext(browser, server, device, accounts.a, { viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
    await tables.attach(context);
    tables.seed('haedo_documents', accounts.a.id, { id: DOC, name: '내 연표', data: timelineDoc() });
    const pages = [];
    const open = async () => {
      const page = await context.newPage(); page.setDefaultTimeout(15000); await page.clock.setFixedTime(new Date(TODAY));
      page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
      page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ check: name, message: event.text() }); });
      pages.push(page); return page;
    };
    console.log('RUN ' + name);
    try { await run({ open, tables, context }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); for (const [i, page] of pages.entries()) await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '-' + i + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    await check('a timeline tab and the 일정 행복도 input write the same document in turn: nothing is lost', async ({ open, tables }) => {
      const timeline = await open(); await openTimeline(timeline);
      const schedule = await open(); await openDay(schedule, '2026-11-03');
      await happiness(schedule, 8);                                   // 일정 → disk → the timeline tab adopts it
      await timeline.waitForFunction(() => DATA.happiness.some(h => h.date === '2026-11-03' && h.v === 0.6));
      await timelineEdit(timeline, '연표 탭 사건 1');                    // timeline edit on top of it
      await openDay(schedule, '2026-11-02'); await happiness(schedule, 3);
      await timeline.waitForFunction(() => DATA.happiness.some(h => h.date === '2026-11-02'));
      await timelineEdit(timeline, '연표 탭 사건 2');
      const row = await settled(tables, data => data.events.some(e => e.title === '연표 탭 사건 2') && data.happiness.length === 2, 'all four edits');
      assert.deepEqual(row.data.happiness.map(h => [h.date, h.v]).sort(), [['2026-11-02', -0.4], ['2026-11-03', 0.6]]);
      assert.deepEqual(row.data.events.map(e => e.title).filter(t => t.startsWith('연표 탭')), ['연표 탭 사건 1', '연표 탭 사건 2']);
      const docs = await allDocs(timeline);
      assert.equal(docs.filter(d => d.name.endsWith('복구 사본')).length, 0, 'taking turns needs no recovery copy');
      assert.equal(tables.owned('haedo_documents', accounts.a.id).length, 1, 'no extra server rows');
    });

    await check('with an item editor open, a 일정 write is not applied; the next save keeps it as a recovery copy first', async ({ open, tables }) => {
      const timeline = await open(); await openTimeline(timeline);
      const schedule = await open(); await openDay(schedule, '2026-11-03');
      await timeline.evaluate(() => { document.getElementById('popEd').hidden = false; });   // an open item editor (unsaved input)
      await happiness(schedule, 9);
      await schedule.waitForFunction(() => document.querySelector('.schedule-entry-status')?.dataset.state === 'ok', null, { timeout: 15000 });
      await timeline.waitForTimeout(400);
      assert.equal(await timeline.evaluate(() => DATA.happiness.length), 0, 'the open editor\'s document is not replaced');
      await timeline.evaluate(() => { document.getElementById('popEd').hidden = true; });
      await timelineEdit(timeline, '편집기에서 저장한 사건');
      const docs = await allDocs(timeline);
      const copy = docs.find(d => d.name === '내 연표 복구 사본');
      assert.ok(copy, 'the 일정 version is kept as a recovery copy');
      assert.deepEqual(copy.data.happiness, [{ date: '2026-11-03', v: 0.8 }]);
      assert.ok(docs.find(d => d.id === DOC).data.events.some(e => e.title === '편집기에서 저장한 사건'));
      // Both reach the account; the recovery copy is a new row (existing rows stay).
      await settled(tables, data => data.events.some(e => e.title === '편집기에서 저장한 사건'), 'the saved edit');
      const deadline = Date.now() + 15000;
      while (tables.owned('haedo_documents', accounts.a.id).length < 2 && Date.now() < deadline) await new Promise(done => setTimeout(done, 200));
      const rows = tables.owned('haedo_documents', accounts.a.id);
      assert.equal(rows.length, 2); assert.ok(rows.some(r => r.name === '내 연표 복구 사본' && r.data.happiness.length === 1));
      // The recovery copy is in the backup and comes back on restore (new copies, nothing replaced).
      const backup = await schedule.evaluate(() => { HaedoPlatformStore.ensure(HaedoAuth.user.id); return HaedoPlatformStore.backup(); });
      assert.ok(backup.docs.some(d => d.name === '내 연표 복구 사본' && d.data.happiness.length === 1));
      const restored = await schedule.evaluate(b => HaedoPlatformData.importDocs(localStorage, HaedoAuth.user.id, b).map(d => d.name), backup);
      assert.ok(restored.includes('내 연표 복구 사본'));
    });

    await check('another device\'s server write: the newer side wins and the other is kept first (both directions)', async ({ open, tables }) => {
      const timeline = await open(); await openTimeline(timeline);
      // Local newer: another device wrote earlier than this edit.
      const other = timelineDoc(); other.events.push({ date: '2026-11-01', title: '다른 기기 사건' });
      tables.rows.haedo_documents.set(DOC, { ...tables.rows.haedo_documents.get(DOC), data: other, updated_at: '2026-11-03T02:30:00.000Z' });
      await timelineEdit(timeline, '이 기기 사건');
      await settled(tables, data => data.events.some(e => e.title === '이 기기 사건'), 'local newer');
      let docs = await allDocs(timeline);
      assert.ok(docs.some(d => d.name === '내 연표 복구 사본' && d.data.events.some(e => e.title === '다른 기기 사건')), 'the overwritten server copy is kept');
      // Server newer: another device wrote after this device's (offline) edit.
      const later = timelineDoc(); later.events.push({ date: '2026-11-04', title: '더 늦은 다른 기기 사건' });
      await timeline.evaluate(() => { const reg = REG.docs.find(d => d.id === curDocId); reg.updated = '2026-11-03T02:00:00.000Z'; });
      await timeline.evaluate(() => { DATA.events.push({ date: '2026-11-02', title: '오래된 이 기기 사건' }); localStorage.setItem(DOC_PREFIX + curDocId, JSON.stringify(DATA)); bodySeen = localStorage.getItem(DOC_PREFIX + curDocId); const reg = REG.docs.find(d => d.id === curDocId); reg.updated = '2026-11-03T02:00:00.000Z'; saveRegistry(); });
      tables.rows.haedo_documents.set(DOC, { ...tables.rows.haedo_documents.get(DOC), data: later, updated_at: '2026-11-03T06:00:00.000Z' });
      await timeline.evaluate(() => cloudQueue.flush(curDocId));
      await timeline.waitForFunction(() => DATA.events.some(e => e.title === '더 늦은 다른 기기 사건'));
      docs = await allDocs(timeline);
      assert.ok(docs.some(d => d.name === '내 연표 복구 사본' && d.data.events.some(e => e.title === '오래된 이 기기 사건')), 'this device\'s older edit is kept');
      assert.equal(tables.rows.haedo_documents.get(DOC).updated_at, '2026-11-03T06:00:00.000Z', 'nothing written over the newer server copy');
    });

    await check('the document list is merged, not overwritten: another tab\'s new document survives a save in a stale tab', async ({ open }) => {
      const timeline = await open(); await openTimeline(timeline);
      const other = await open(); await openDay(other, '2026-11-03');
      // The other tab adds a document (as the store does for a recovery copy) while the timeline tab holds an older list.
      await other.evaluate(([reg, prefix]) => {
        const list = JSON.parse(localStorage.getItem(reg)), id = 'd_other_tab';
        localStorage.setItem(prefix + id, JSON.stringify({ profile: { name: '다른 탭 문서' }, events: [], spans: [], eras: [], happiness: [], thoughts: [], records: [], trips: [], layers: [] }));
        list.docs.push({ id, name: '다른 탭 문서', updated: '2026-11-03T03:00:00.000Z' }); localStorage.setItem(reg, JSON.stringify(list));
      }, [regKey(accounts.a.id), 'caeyeon_life_account_' + accounts.a.id + '_doc_']);
      await timeline.evaluate(() => { REG.docs = REG.docs.filter(d => d.id !== 'd_other_tab'); });  // as if the event had not arrived yet
      await timelineEdit(timeline, '오래된 목록 탭의 저장');
      const { reg } = await local(timeline);
      assert.ok(reg.docs.some(d => d.id === 'd_other_tab'), 'the other tab\'s document is still listed');
      // A deleted document is not brought back by the merge.
      await timeline.evaluate(([prefix]) => { localStorage.removeItem(prefix + 'd_other_tab'); REG.docs = REG.docs.filter(d => d.id !== 'd_other_tab'); saveRegistry(); }, ['caeyeon_life_account_' + accounts.a.id + '_doc_']);
      assert.ok(!(await local(timeline)).reg.docs.some(d => d.id === 'd_other_tab'));
    });
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.pageErrors, [], 'page errors'); assert.deepEqual(report.consoleErrors, [], 'console errors');
  assert(report.checks.length && report.checks.every(item => item.pass), 'all checks pass');
  console.log(JSON.stringify({ checks: report.checks.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
