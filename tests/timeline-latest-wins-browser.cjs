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
// Recovery copies are named '<이름> 복구 사본 (YYYY-MM-DD HH:MM)' (B2 review: dated, one suffix).
const RECOVERY = /^내 연표 복구 사본 \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/;
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
// The tab is hidden and shown again (visibilitychange), as when returning to it.
const tabReturn = page => page.evaluate(async () => {
  for (const hidden of [true, false]) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(done => setTimeout(done, 50));
  }
});
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
      page.on('console', event => {
        if (event.type() !== 'error') return;
        // Document writes the check makes fail on purpose (offline).
        if (tables.fail && /Failed to load resource:.*500/.test(event.text())) return;
        report.consoleErrors.push({ check: name, message: event.text() });
      });
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
      assert.equal(docs.filter(d => / 복구 사본/.test(d.name)).length, 0, 'taking turns needs no recovery copy');
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
      const copy = docs.find(d => RECOVERY.test(d.name));
      assert.ok(copy, 'the 일정 version is kept as a recovery copy');
      assert.deepEqual(copy.data.happiness, [{ date: '2026-11-03', v: 0.8 }]);
      assert.ok(docs.find(d => d.id === DOC).data.events.some(e => e.title === '편집기에서 저장한 사건'));
      // Both reach the account; the recovery copy is a new row (existing rows stay).
      await settled(tables, data => data.events.some(e => e.title === '편집기에서 저장한 사건'), 'the saved edit');
      const deadline = Date.now() + 15000;
      while (tables.owned('haedo_documents', accounts.a.id).length < 2 && Date.now() < deadline) await new Promise(done => setTimeout(done, 200));
      const rows = tables.owned('haedo_documents', accounts.a.id);
      assert.equal(rows.length, 2); assert.ok(rows.some(r => RECOVERY.test(r.name) && r.data.happiness.length === 1));
      // The recovery copy is in the backup and comes back on restore (new copies, nothing replaced).
      const backup = await schedule.evaluate(() => { HaedoPlatformStore.ensure(HaedoAuth.user.id); return HaedoPlatformStore.backup(); });
      assert.ok(backup.docs.some(d => RECOVERY.test(d.name) && d.data.happiness.length === 1));
      const restored = await schedule.evaluate(b => HaedoPlatformData.importDocs(localStorage, HaedoAuth.user.id, b).map(d => d.name), backup);
      assert.ok(restored.some(name => RECOVERY.test(name)), 'restored under the same dated name');
    });

    await check('another device\'s server write: the newer side wins and the other is kept first (both directions)', async ({ open, tables }) => {
      const timeline = await open(); await openTimeline(timeline);
      // Local newer: another device wrote earlier than this edit.
      const other = timelineDoc(); other.events.push({ date: '2026-11-01', title: '다른 기기 사건' });
      tables.rows.haedo_documents.set(DOC, { ...tables.rows.haedo_documents.get(DOC), data: other, updated_at: '2026-11-03T02:30:00.000Z' });
      await timelineEdit(timeline, '이 기기 사건');
      await settled(tables, data => data.events.some(e => e.title === '이 기기 사건'), 'local newer');
      let docs = await allDocs(timeline);
      assert.ok(docs.some(d => RECOVERY.test(d.name) && d.data.events.some(e => e.title === '다른 기기 사건')), 'the overwritten server copy is kept');
      // Server newer: another device wrote after this device's (offline) edit.
      const later = timelineDoc(); later.events.push({ date: '2026-11-04', title: '더 늦은 다른 기기 사건' });
      await timeline.evaluate(() => { const reg = REG.docs.find(d => d.id === curDocId); reg.updated = '2026-11-03T02:00:00.000Z'; });
      await timeline.evaluate(() => { DATA.events.push({ date: '2026-11-02', title: '오래된 이 기기 사건' }); localStorage.setItem(DOC_PREFIX + curDocId, JSON.stringify(DATA)); bodySeen = localStorage.getItem(DOC_PREFIX + curDocId); const reg = REG.docs.find(d => d.id === curDocId); reg.updated = '2026-11-03T02:00:00.000Z'; saveRegistry(); });
      tables.rows.haedo_documents.set(DOC, { ...tables.rows.haedo_documents.get(DOC), data: later, updated_at: '2026-11-03T06:00:00.000Z' });
      await timeline.evaluate(() => cloudQueue.flush(curDocId));
      await timeline.waitForFunction(() => DATA.events.some(e => e.title === '더 늦은 다른 기기 사건'));
      docs = await allDocs(timeline);
      assert.ok(docs.some(d => RECOVERY.test(d.name) && d.data.events.some(e => e.title === '오래된 이 기기 사건')), 'this device\'s older edit is kept');
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

    // B1 (review of d7eae0e): timeline.html had two uploaders for the open document (app.js cloudPush
    // and the shared store's wake-up). One edit and a tab return must send one PATCH, raise no
    // conflict, make no recovery copy and leave no orphan; the goals/habits pages send nothing for a
    // clean document.
    await check('one uploader per document: edits and tab returns send one PATCH each, with no conflict, copy or orphan', async ({ open, tables }) => {
      const timeline = await open(); await openTimeline(timeline);
      const patches = () => tables.calls.filter(call => call.table === 'haedo_documents' && call.method === 'PATCH').length;
      const quiet = async page => { await page.waitForTimeout(1500); await page.waitForFunction(() => { const d = REG.docs.find(x => x.id === curDocId); return d && d.syncedAt === d.updated; }, null, { timeout: 15000 }); };
      const before = patches();
      // The tab returns while the edit is still unsent (the editor's push is debounced).
      await timelineEdit(timeline, '편집 1'); await tabReturn(timeline);
      await settled(tables, data => data.events.some(e => e.title === '편집 1'), 'edit 1'); await quiet(timeline);
      assert.equal(patches() - before, 1, 'edit 1 and a tab return: one PATCH');
      await timelineEdit(timeline, '편집 2'); await tabReturn(timeline);
      await settled(tables, data => data.events.some(e => e.title === '편집 2'), 'edit 2 (no conflict)'); await quiet(timeline);
      await tabReturn(timeline); await quiet(timeline);
      assert.equal(patches() - before, 2, 'edit 2 and a tab return: one more PATCH');
      const docs = await allDocs(timeline);
      assert.equal(docs.filter(d => / 복구 사본/.test(d.name)).length, 0, 'no recovery copy');
      assert.equal(await timeline.evaluate(() => document.body.innerText.includes('충돌')), false, 'no conflict shown');
      // No orphan: every stored body and every server row is listed.
      const listed = new Set(docs.map(d => d.id));
      const bodies = await timeline.evaluate(prefix => Object.keys(localStorage).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)), 'caeyeon_life_account_' + accounts.a.id + '_doc_');
      assert.deepEqual(bodies.filter(id => !listed.has(id)), [], 'no orphan body');
      assert.deepEqual(tables.owned('haedo_documents', accounts.a.id).map(r => r.id).filter(id => !listed.has(id)), [], 'no orphan server row');
      assert.equal(tables.owned('haedo_documents', accounts.a.id).length, 1);
      // A clean document on the goals and habits pages: a tab return sends nothing.
      for (const name of ['habits', 'goals']) {
        const other = await open(); await other.goto(base + '/' + name + '.html');
        await other.locator('#syncMessage').filter({ hasText: '서버와 기기 사본을 확인했습니다.' }).waitFor({ timeout: 15000 });
        const seen = patches(); await tabReturn(other); await other.waitForTimeout(1500);
        assert.equal(patches(), seen, name + ': no PATCH for a clean document');
        await other.close();
      }
    });

    // Re-review of 3e9ecfb. R3: a page that wrote 행복도 is closed while documents cannot be written;
    // reopened with the network back, it sends the value itself (no other page needed).
    await check('R3: a 행복도 that failed is sent after the 일정 page is reopened', async ({ open, tables }) => {
      const schedule = await open(); await openDay(schedule, '2026-11-03');
      await schedule.waitForFunction(([reg, id]) => JSON.parse(localStorage.getItem(reg) || '{"docs":[]}').docs.some(d => d.id === id && d.syncedAt), [regKey(accounts.a.id), DOC]);
      tables.fail = 'haedo_documents';
      await happiness(schedule, 7);
      await schedule.locator('.schedule-entry-status').filter({ hasText: '계정에 올리지 못함' }).waitFor({ timeout: 15000 });
      tables.fail = null;
      await openDay(schedule, '2026-11-03');                                     // reopened (new page load)
      await settled(tables, data => data.happiness.some(h => h.date === '2026-11-03' && h.v === 0.4), 'sent after the reopen');
      await schedule.waitForFunction(() => document.querySelector('.schedule-entry-status')?.dataset.state === 'ok', null, { timeout: 15000 });
    });

    // R6: the timeline tab adopts the 일정 tab's write (which holds its own pending edit), the 일정
    // tab closes while documents cannot be written: nothing is dropped and nothing claims "동기화됨".
    await check('R6: the timeline tab keeps its pending edit when it adopts another tab\'s write and sends both after that tab closes', async ({ open, tables }) => {
      const timeline = await open(); await openTimeline(timeline);
      const schedule = await open(); await openDay(schedule, '2026-11-03');
      tables.fail = 'haedo_documents';
      await timelineEdit(timeline, '편집 E');                                    // its upload waits (debounced)
      await happiness(schedule, 6);
      await timeline.waitForFunction(() => DATA.happiness.some(h => h.date === '2026-11-03') && DATA.events.some(e => e.title === '편집 E'));
      await schedule.close();
      await timeline.waitForTimeout(2500);
      assert.notEqual((await timeline.locator('#saveStatus').textContent()).trim(), '동기화됨', 'nothing on the account yet: not shown as synced');
      tables.fail = null;
      await tabReturn(timeline);
      await settled(tables, data => data.events.some(e => e.title === '편집 E') && data.happiness.some(h => h.date === '2026-11-03' && h.v === 0.2), 'E and 행복도');
      await timeline.waitForFunction(() => document.getElementById('saveStatus').textContent.trim() === '동기화됨', null, { timeout: 15000 });
      assert.equal((await allDocs(timeline)).filter(d => / 복구 사본/.test(d.name)).length, 0);
    });

    // R6b: the 일정 tab closes before its own (debounced) upload starts; no tab return, no pull. The
    // timeline tab that adopted the write sends it, and an edit waiting to go is never "동기화됨".
    await check('R6b: the adopting timeline tab sends the merged version itself; a waiting edit is shown as waiting', async ({ open, tables }) => {
      const timeline = await open(); await openTimeline(timeline);
      const status = () => timeline.locator('#saveStatus').textContent().then(text => text.trim());
      await timelineEdit(timeline, '먼저 올린 편집');
      await settled(tables, data => data.events.some(e => e.title === '먼저 올린 편집'), 'first edit');
      await timeline.waitForFunction(() => document.getElementById('saveStatus').textContent.trim() === '동기화됨', null, { timeout: 15000 });
      const schedule = await open(); await openDay(schedule, '2026-11-03');
      await timelineEdit(timeline, '대기 편집');
      assert.equal(await status(), '계정에 올리기 대기', 'an edit not on the account yet is not "동기화됨"');
      await happiness(schedule, 9); await schedule.close();
      await settled(tables, data => data.events.some(e => e.title === '대기 편집') && data.happiness.some(h => h.date === '2026-11-03' && h.v === 0.8), 'the merged version');
      await timeline.waitForFunction(() => document.getElementById('saveStatus').textContent.trim() === '동기화됨', null, { timeout: 15000 });
    });

    await check('a document another tab deleted does not come back with a save in a tab that still lists it (re-review minor 3)', async ({ open }) => {
      const timeline = await open(); await openTimeline(timeline);
      // Deleted in another tab (body and list entry gone) while this tab's list still has it.
      await timeline.evaluate(() => { REG.docs.push({ id: 'd_gone', name: '지운 문서', updated: '2026-11-03T03:00:00.000Z' }); });
      await timelineEdit(timeline, '지운 뒤 저장');
      assert.equal((await local(timeline)).reg.docs.some(d => d.id === 'd_gone'), false);
      assert.equal(await timeline.evaluate(() => REG.docs.some(d => d.id === 'd_gone')), false);
    });

    await check('another tab\'s write waits for a pointer gesture to end; history and selection stay, and undo across it keeps a recovery copy (re-review minor 6)', async ({ open }) => {
      const timeline = await open(); await openTimeline(timeline);
      await timelineEdit(timeline, '편집 1');
      await timeline.evaluate(() => { selected = DATA.events.find(e => e.title === '편집 1'); });
      const schedule = await open(); await openDay(schedule, '2026-11-03');
      await timeline.evaluate(() => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));   // a drag starts
      await happiness(schedule, 8);
      await schedule.waitForFunction(() => document.querySelector('.schedule-entry-status')?.dataset.state === 'ok', null, { timeout: 15000 });
      await timeline.waitForTimeout(500);
      assert.equal(await timeline.evaluate(() => DATA.happiness.length), 0, 'not adopted during the gesture');
      await timeline.evaluate(() => dispatchEvent(new PointerEvent('pointerup')));
      await timeline.waitForFunction(() => DATA.happiness.length === 1);
      assert.deepEqual(await timeline.evaluate(() => [UNDO.length > 0, selected?.title]), [true, '편집 1'], 'history and selection stay');
      // Undo steps back over the adoption: the adopted version (with 행복도) is kept first.
      await timeline.evaluate(() => undo());
      assert.equal(await timeline.evaluate(() => DATA.happiness.length), 0);
      const copy = (await allDocs(timeline)).find(d => RECOVERY.test(d.name));
      assert.ok(copy, 'the adopted version is kept'); assert.deepEqual(copy.data.happiness.map(({ date, v }) => ({ date, v })), [{ date: '2026-11-03', v: 0.6 }]);
    });

    // Third re-review (0b328f7) blocker: with the item editor open, the timeline tab's memory must
    // never go out over the 일정 tab's write. P1–P3 are the reviewer's reproductions.
    const editorOpen = page => page.evaluate(() => { document.getElementById('popEd').hidden = false; });
    const editorCancel = page => page.evaluate(() => closePop());
    const pending = page => page.evaluate(id => localStorage.getItem('caeyeon_life_account_' + id + '_happiness_pending'), accounts.a.id);
    await check('P3: the 일정 tab closes right after a 행복도 while the timeline editor is open; closing the editor takes it in and sends it', async ({ open, tables }) => {
      const timeline = await open(); await openTimeline(timeline);
      const schedule = await open(); await openDay(schedule, '2026-11-03');
      await editorOpen(timeline);
      await happiness(schedule, 9); await schedule.waitForTimeout(300); await schedule.close();   // before its 1.5 s upload
      await timeline.waitForTimeout(300);
      await editorCancel(timeline); await tabReturn(timeline);
      await settled(tables, data => data.happiness.some(h => h.date === '2026-11-03' && h.v === 0.8), 'the 일정 value on the account');
      assert.equal(await timeline.evaluate(() => DATA.happiness.some(h => h.date === '2026-11-03' && h.v === 0.8)), true);
      await timeline.waitForFunction(() => document.getElementById('saveStatus').textContent.trim() === '동기화됨', null, { timeout: 15000 });
    });
    await check('P2: the same while document writes fail; back online, the value still reaches the account', async ({ open, tables }) => {
      const timeline = await open(); await openTimeline(timeline);
      const schedule = await open(); await openDay(schedule, '2026-11-03');
      await editorOpen(timeline);
      tables.fail = 'haedo_documents';
      await happiness(schedule, 9); await schedule.waitForTimeout(300); await schedule.close();
      await editorCancel(timeline); await timeline.waitForTimeout(2500);
      assert.notEqual((await timeline.locator('#saveStatus').textContent()).trim(), '동기화됨');
      tables.fail = null;
      await tabReturn(timeline);
      await settled(tables, data => data.happiness.some(h => h.date === '2026-11-03' && h.v === 0.8), 'the 일정 value after the network returns');
    });
    await check('P1: the timeline\'s own upload is waiting and its editor is open when the 일정 tab writes: both edits reach the account', async ({ open, tables }) => {
      const timeline = await open(); await openTimeline(timeline);
      const schedule = await open(); await openDay(schedule, '2026-11-03');
      await timelineEdit(timeline, '대기 중 편집'); await editorOpen(timeline);
      await happiness(schedule, 9);
      await settled(tables, data => data.events.some(e => e.title === '대기 중 편집') && data.happiness.some(h => h.date === '2026-11-03' && h.v === 0.8), 'both edits');
      await schedule.waitForFunction(() => document.querySelector('.schedule-entry-status')?.dataset.state === 'ok', null, { timeout: 15000 });
      await schedule.waitForFunction(id => !localStorage.getItem('caeyeon_life_account_' + id + '_happiness_pending'), accounts.a.id, { timeout: 15000 });
      await editorCancel(timeline);
      await timeline.waitForFunction(() => DATA.happiness.some(h => h.date === '2026-11-03'));
      assert.equal(await pending(timeline), null);
    });

    // Minor 5: the lock and the "already sent" skip each have a check of their own.
    await check('two uploads of the same change at once send one PATCH (the per-document lock)', async ({ open, tables }) => {
      const schedule = await open(); await openDay(schedule, '2026-11-03');
      await schedule.waitForFunction(([reg, id]) => JSON.parse(localStorage.getItem(reg) || '{"docs":[]}').docs.some(d => d.id === id && d.syncedAt), [regKey(accounts.a.id), DOC]);
      const patches = () => tables.calls.filter(call => call.table === 'haedo_documents' && call.method === 'PATCH').length, before = patches();
      let release; tables.hold = new Promise(done => { release = done; });
      const both = schedule.evaluate(() => { HaedoPlatformStore.setHappiness('2026-11-03', 4); const id = HaedoPlatformStore.base.docId;
        return Promise.all([HaedoPlatformStore.uploadDocuments([id]), HaedoPlatformStore.uploadDocuments([id])]).then(() => 'ok', e => e.message); });
      await schedule.waitForTimeout(800); tables.hold = null; release();
      assert.equal(await both, 'ok');
      await schedule.waitForTimeout(2500);                                       // the queued upload finds it clean
      assert.equal(patches() - before, 1, 'one PATCH for one change');
      assert.equal((await allDocs(schedule)).filter(d => / 복구 사본/.test(d.name)).length, 0);
    });
    await check('a version another page already sent is not sent again by the timeline (skip when the disk copy is clean)', async ({ open, tables }) => {
      const timeline = await open(); await openTimeline(timeline);
      const schedule = await open(); await openDay(schedule, '2026-11-03');
      const patches = () => tables.calls.filter(call => call.table === 'haedo_documents' && call.method === 'PATCH').length, before = patches();
      await timelineEdit(timeline, '한 번만 보낼 편집');                            // its own upload waits 1.5 s…
      await schedule.evaluate(id => HaedoPlatformStore.uploadDocuments([id]), DOC);   // …the 일정 page sends it first
      await settled(tables, data => data.events.some(e => e.title === '한 번만 보낼 편집'), 'sent by the 일정 page');
      await timeline.waitForTimeout(3000);
      assert.equal(patches() - before, 1, 'the timeline does not send the same version again');
      await timeline.waitForFunction(() => document.getElementById('saveStatus').textContent.trim() === '동기화됨', null, { timeout: 15000 });
    });
    await check('M1c: a timeline edit left unsent when its tab closed is sent by the 일정 page opened later', async ({ open, tables }) => {
      const timeline = await open(); await openTimeline(timeline);
      tables.fail = 'haedo_documents';
      await timelineEdit(timeline, '닫힌 탭의 편집'); await timeline.waitForTimeout(2000); await timeline.close();
      tables.fail = null;
      const schedule = await open(); await openDay(schedule, '2026-11-03');
      await settled(tables, data => data.events.some(e => e.title === '닫힌 탭의 편집'), 'sent by the 일정 page');
    });
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.pageErrors, [], 'page errors'); assert.deepEqual(report.consoleErrors, [], 'console errors');
  assert(report.checks.length && report.checks.every(item => item.pass), 'all checks pass');
  console.log(JSON.stringify({ checks: report.checks.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
