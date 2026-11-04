/* B2 (#187, scope reduced 2026-11-04): the timeline editor is the only writer of its documents.
 * Its own behaviour is main's (assets/app.js unchanged but for the shared scale function), and the
 * shared store loaded on timeline.html, habits, goals and workspace never sends a timeline on a
 * wake-up. Real app, SDK and IDB; anonymous intercepted Auth; haedo_documents / haedo_items in
 * memory with server stamps and conditional PATCH (tests/schedule-entries-browser.cjs PlatformTables).
 * npm run dev; node tests/timeline-single-writer-browser.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { PlatformTables } = require('./schedule-entries-browser.cjs');

const output = path.resolve(process.env.TIMELINE_WRITER_OUTPUT || '.local/timeline-single-writer-browser');
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
// A timeline edit as the editor makes it (mutate DATA, persist).
const timelineEdit = (page, title, date = '2026-11-03') => page.evaluate(([title, date]) => { DATA.events.push({ date, title }); persist(); }, [title, date]);
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
    if (process.env.TIMELINE_WRITER_MATCH && !new RegExp(process.env.TIMELINE_WRITER_MATCH).test(name)) return;
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
    // B1 (review of d7eae0e): one edit and a tab return send one PATCH, raise no conflict, make no
    // recovery copy and leave no orphan (main's behaviour); a tab return on the goals, habits and
    // workspace pages sends nothing for a clean document.
    await check('the timeline editor is the only writer: edits and tab returns send one PATCH each, with no conflict, copy or orphan', async ({ open, tables }) => {
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
      for (const name of ['habits', 'goals', 'workspace']) {
        const other = await open(); await other.goto(base + '/' + name + '.html');
        await other.locator('#syncMessage').filter({ hasText: '서버와 기기 사본을 확인했습니다.' }).waitFor({ timeout: 15000 });
        const seen = patches(); await tabReturn(other); await other.waitForTimeout(1500);
        assert.equal(patches(), seen, name + ': no PATCH for a clean document');
        await other.close();
      }
    });

  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.pageErrors, [], 'page errors'); assert.deepEqual(report.consoleErrors, [], 'console errors');
  assert(report.checks.length && report.checks.every(item => item.pass), 'all checks pass');
  console.log(JSON.stringify({ checks: report.checks.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
