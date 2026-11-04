/* 하루 행복도 단일 쓰기 1단계(docs/life-tools-design/happiness-single-writer.md "검사 계획" 브라우저)
 * on the real app, SDK and IDB with the anonymous intercepted Auth. haedo_items / haedo_documents are
 * owner-scoped in-memory tables (PlatformTables); life_account_documents is the account-document
 * fixture (RPCs and the owner-scoped select). npm run dev; node tests/happiness-days-browser.cjs
 * Never uses real Google, production Supabase or Apple-device claims. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { PlatformTables } = require('./schedule-entries-browser.cjs');

const output = path.resolve(process.env.HAPPINESS_DAYS_OUTPUT || '.local/happiness-days-browser');
const TODAY = '2026-11-03T12:00:00+09:00';
const EPOCH = '1970-01-01T00:00:00.000Z';
const report = { checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0 };
const key = account => `happinessDays:${JSON.stringify([cloud, account.id])}:days`;
const timeline = happiness => ({ profile: { name: '내 연표', birth: '1990-01' }, scale: 'signed1', events: [], spans: [], eras: [], happiness, thoughts: [], records: [], trips: [], layers: [] });
const accountDoc = (server, account = accounts.a) => server.accountDocs.get(account.id)?.get(key(account))?.data || null;
const entryOn = (server, date) => accountDoc(server)?.entries.find(entry => entry.date === date) || null;
async function until(check, label, ms = 15000) {
  const deadline = Date.now() + ms;
  for (;;) {
    let value; try { value = await check(); } catch (_) { value = null; }
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out: ' + label);
    await new Promise(done => setTimeout(done, 150));
  }
}
async function shown(page, mode) {
  await page.waitForFunction(m => document.querySelector('#lifeMain')?.dataset.mode === m && document.querySelector('#lifeSchedule')?.getAttribute('aria-busy') === 'false', mode);
}
async function entries(page) { await page.waitForFunction(() => { const slot = document.querySelector('.schedule-entries'); return slot && slot.getAttribute('aria-busy') === 'false' && slot.dataset.happiness !== 'loading' && slot.querySelector('.schedule-happiness'); }); }
async function openDay(page, date) {
  await page.goto(base + '/index.html?section=schedule&view=day&date=' + date); await ready(page); await shown(page, 'day'); await entries(page);
}
const chosen = page => page.evaluate(() => document.querySelector('.schedule-happiness input:checked')?.value ?? null);
const statusText = page => page.locator('.schedule-entry-status').first();
async function openEditor(page, docId) {
  await page.goto(base + '/timeline.html?doc=' + encodeURIComponent(docId));
  await page.waitForFunction(() => typeof DATA === 'object' && typeof HAPDAYS === 'object' && HAPDAYS.state !== 'loading');
}
// The <g data-hap> of a 행복도 dot whose date and value match (HAPVIEW order = drawing order).
async function dotBox(page, date) {
  return page.evaluate(d => {
    const i = HAPVIEW.findIndex(p => p.date === d); if (i < 0) return null;
    const dots = [...document.querySelectorAll('#tl g[data-hap]')];
    const target = dots.find(g => { const c = g.querySelector('circle'); return Math.abs(+c.getAttribute('cx') - X(HAPVIEW[i].t)) < 0.5; });
    if (!target) return null; const box = target.querySelector('circle').getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, date);
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, viewport = { width: 1440, height: 960 }) {
    if (process.env.HAPPINESS_DAYS_MATCH && !new RegExp(process.env.HAPPINESS_DAYS_MATCH).test(name)) return;
    const server = new FakeCloud(), tables = new PlatformTables(), device = 'happy-' + report.checks.length;
    const context = await makeContext(browser, server, device, accounts.a, { viewport, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
    await tables.attach(context);
    const pages = [];
    const newPage = async () => {
      const page = await context.newPage(); page.setDefaultTimeout(15000); pages.push(page);
      await page.clock.setFixedTime(new Date(TODAY));
      page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
      page.on('console', event => {
        if (event.type() !== 'error') return;
        if (page.__expectFailure && /Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(event.text())) { report.expectedErrors++; return; }
        report.consoleErrors.push({ check: name, message: event.text() });
      });
      return page;
    };
    console.log('RUN ' + name);
    try { await run({ page: await newPage(), newPage, context, server, tables, device }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      for (const [i, page] of pages.entries()) await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '-' + i + '.png'), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
  }
  try {
    await check('일정 D stores 0–10 in the account document (no timeline PATCH); keyboard, reload, 지우기 and future days', async ({ page, server, tables }) => {
      await openDay(page, '2026-11-03');
      assert.equal(await page.locator('.schedule-happiness').getByRole('radio').count(), 11);
      await page.getByRole('radio', { name: '행복도 7' }).check();
      await statusText(page).filter({ hasText: '저장됨 · 계정에 올림' }).waitFor({ timeout: 15000 });
      await until(() => entryOn(server, '2026-11-03')?.v === 0.4, 'stored 7 → 0.4');
      // Keyboard: arrows move within the 0–10 group and store the new value.
      await page.getByRole('radio', { name: '행복도 7' }).focus(); await page.keyboard.press('ArrowRight');
      await until(() => entryOn(server, '2026-11-03')?.v === 0.6, 'stored 8 → 0.6');
      assert.equal(entryOn(server, '2026-11-03').src, undefined, 'a 일정 D value carries no src');
      await page.reload(); await ready(page); await shown(page, 'day'); await entries(page);
      await page.waitForFunction(() => document.querySelector('.schedule-happiness input:checked')?.value === '8');
      await page.getByRole('button', { name: '이 날 행복도 지우기' }).click();
      await until(() => entryOn(server, '2026-11-03')?.v === null, 'cleared (deletion mark)');
      assert.equal(await chosen(page), null);
      assert.equal(tables.calls.filter(call => call.table === 'haedo_documents' && call.method !== 'GET').length, 0, 'no timeline write');
      await openDay(page, '2026-11-05');
      assert.equal(await page.locator('.schedule-happiness input:not([disabled])').count(), 0, 'a day not come yet cannot be entered');
    });

    await check('two tabs entering different days at once both stay (real IndexedDB)', async ({ page, newPage, server }) => {
      const other = await newPage();
      await openDay(page, '2026-11-02'); await openDay(other, '2026-11-03');
      await Promise.all([page.getByRole('radio', { name: '행복도 3' }).check(), other.getByRole('radio', { name: '행복도 9' }).check()]);
      await until(() => entryOn(server, '2026-11-02')?.v === -0.4 && entryOn(server, '2026-11-03')?.v === 0.8, 'both days reached the account');
      const local = await page.evaluate(async () => (await HaedoLife.Shell.storage.readHappinessDays()).entries.map(e => [e.date, e.v]));
      assert.deepEqual(local, [['2026-11-02', -0.4], ['2026-11-03', 0.8]]);
    });

    await check('a timeline\'s old daily points move to the account (at 1970, src); the timeline is not changed; the editor shows the merged points', async ({ page, server, tables }) => {
      const happiness = [{ date: '2026-10', v: 0.1 }, { date: '2026-10-01', v: 0.2 }, { date: '2026-11-02', v: 0.4 }];
      tables.seed('haedo_documents', accounts.a.id, { id: 'd_timeline', name: '내 연표', data: timeline(happiness) });
      await openDay(page, '2026-11-02');
      await page.waitForFunction(() => document.querySelector('.schedule-happiness input:checked')?.value === '7');
      await until(() => accountDoc(server)?.migrated?.length === 1, 'migrated row reached the account');
      const doc = accountDoc(server);
      assert.deepEqual(doc.entries.map(e => [e.date, e.v, e.at, e.src]), [['2026-10-01', 0.2, EPOCH, 'd_timeline'], ['2026-11-02', 0.4, EPOCH, 'd_timeline']]);
      assert.deepEqual(doc.migrated[0].dates, { '2026-10-01': 0.2, '2026-11-02': 0.4 });
      assert.equal(doc.migrated[0].seenAt, tables.rows.haedo_documents.get('d_timeline').updated_at, 'the server time of the version read');
      // 일정 D corrects the migrated day.
      await page.getByRole('radio', { name: '행복도 9' }).check();
      await until(() => entryOn(server, '2026-11-02')?.v === 0.8 && entryOn(server, '2026-11-02')?.src === undefined, 'the corrected value, without src');
      // The editor: merged points, the timeline's own points untouched, day points view only.
      await openEditor(page, 'd_timeline');
      await page.waitForFunction(() => HAPDAYS.state === 'ready');
      const view = await page.evaluate(() => HAPVIEW.map(p => [p.date, p.v, p.account, p.locked]).sort());
      assert.deepEqual(view, [['2026-10', 0.1, false, false], ['2026-10-01', 0.2, true, true], ['2026-11-02', 0.8, true, true]]);
      assert.deepEqual(await page.evaluate(() => DATA.happiness.map(h => [h.date, h.v])), [['2026-10', 0.1], ['2026-10-01', 0.2], ['2026-11-02', 0.4]], 'DATA keeps the timeline\'s own points');
      // A day point cannot be dragged; clicking it offers 일정에서 고치기 (that day of 일정 D).
      const dot = await until(() => dotBox(page, '2026-11-02'), 'day dot drawn');
      await page.mouse.move(dot.x, dot.y); await page.mouse.down(); await page.mouse.move(dot.x + 60, dot.y - 80, { steps: 6 }); await page.mouse.up();
      assert.deepEqual(await page.evaluate(() => DATA.happiness.find(h => h.date.startsWith('2026-11'))), { date: '2026-11-02', v: 0.4, t: await page.evaluate(() => DATA.happiness.find(h => h.date === '2026-11-02').t), fut: false }, 'the drag changed nothing');
      const again = await dotBox(page, '2026-11-02');
      await page.mouse.click(again.x, again.y);
      const link = page.locator('#popEd').getByRole('link', { name: '일정에서 고치기' });
      await link.waitFor();
      assert.equal(await link.getAttribute('href'), 'index.html?section=schedule&view=day&date=2026-11-02');
      assert.equal(await page.locator('#popEd input').count(), 0, 'no value, date or delete control for a day value');
      await page.keyboard.press('Escape'); await page.evaluate(() => closePop());
      // A month point is still edited here, but it cannot become a day point.
      const month = await until(() => dotBox(page, '2026-10'), 'month dot drawn');
      await page.mouse.click(month.x, month.y);
      const date = page.locator('#popEd [data-f="date"]'); await date.waitFor();
      await date.fill('2026-10-15'); await date.press('Enter'); await date.blur().catch(() => {});
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => DATA.happiness.find(h => h.date.startsWith('2026-10') && h.date.length === 7)?.date), '2026-10', 'the month point stays a month point');
      const value = page.locator('#popEd [data-f="v"]'); await value.fill('0.3'); await value.press('Enter');
      await page.evaluate(() => closePop());
      // The editor's save sends the timeline with its own points only.
      await until(() => tables.rows.haedo_documents.get('d_timeline').data.happiness.some(h => h.date === '2026-10' && h.v === 0.3), 'editor saved the month value');
      const saved = tables.rows.haedo_documents.get('d_timeline').data.happiness.map(h => [h.date, h.v]);
      assert.deepEqual(saved, [['2026-10', 0.3], ['2026-10-01', 0.2], ['2026-11-02', 0.4]], 'no account value went into the timeline');
      assert.equal(entryOn(server, '2026-11-02').v, 0.8, 'the 일정 D value stays after the editor saved');
    });

    await check('no account document yet: the editor shows an old day point as it is, but it cannot be dragged and the timeline is not written', async ({ page, tables }) => {
      tables.seed('haedo_documents', accounts.a.id, { id: 'd_timeline', name: '내 연표', data: timeline([{ date: '2026-10', v: 0.1 }, { date: '2026-10-02', v: 0.5 }]) });
      const before = tables.rows.haedo_documents.get('d_timeline').updated_at;
      await openEditor(page, 'd_timeline');
      await page.waitForFunction(() => HAPDAYS.state === 'none');
      assert.deepEqual(await page.evaluate(() => HAPVIEW.map(p => [p.date, p.v, p.locked]).sort()), [['2026-10', 0.1, false], ['2026-10-02', 0.5, true]]);
      const dot = await until(() => dotBox(page, '2026-10-02'), 'day dot drawn');
      await page.mouse.move(dot.x, dot.y); await page.mouse.down(); await page.mouse.move(dot.x + 80, dot.y - 90, { steps: 8 }); await page.mouse.up();
      await page.waitForTimeout(800);
      assert.deepEqual(await page.evaluate(() => DATA.happiness.map(h => [h.date, h.v])), [['2026-10', 0.1], ['2026-10-02', 0.5]], 'the drag moved nothing');
      assert.equal(tables.rows.haedo_documents.get('d_timeline').updated_at, before, 'the timeline was not sent');
      // The context menu offers only 일정에서 고치기 for a day value.
      const again = await dotBox(page, '2026-10-02');
      await page.mouse.click(again.x, again.y, { button: 'right' });
      await page.waitForTimeout(200);
      const menu = await page.evaluate(() => [...document.querySelectorAll('#ctxMenu:not([hidden]) button')].map(b => b.textContent.trim()));
      assert.deepEqual(menu, ['일정에서 고치기'], 'no delete for a day value');
    });

    await check('a timeline never sent (no server timelines) migrates with its device time', async ({ page, context, server }) => {
      const uid = accounts.a.id, doc = timeline([{ date: '2026-10-05', v: 0.6 }]);
      await context.addInitScript(([uid, doc]) => {
        const reg = 'caeyeon_life_account_' + uid + '_registry';
        if (!localStorage.getItem(reg)) {
          localStorage.setItem(reg, JSON.stringify({ docs: [{ id: 'd_local', name: '기기 연표', updated: '2026-11-03T02:00:00.000Z' }], current: 'd_local' }));
          localStorage.setItem('caeyeon_life_account_' + uid + '_doc_d_local', JSON.stringify(doc));
        }
      }, [uid, doc]);
      await openDay(page, '2026-10-05');
      await page.waitForFunction(() => document.querySelector('.schedule-happiness input:checked')?.value === '8');
      await until(() => accountDoc(server)?.migrated?.length === 1, 'migrated');
      assert.deepEqual(accountDoc(server).migrated[0], { docId: 'd_local', at: EPOCH, seenAt: null, localSeenAt: '2026-11-03T02:00:00.000Z', dates: { '2026-10-05': 0.6 } });
    });

    await check('an open editor popup is not redrawn by a 행복도 read; another tab\'s 일정 D value stays through the editor\'s save', async ({ page, newPage, server, tables }) => {
      tables.seed('haedo_documents', accounts.a.id, { id: 'd_timeline', name: '내 연표', data: timeline([{ date: '2026-10', v: 0.1 }]) });
      await openEditor(page, 'd_timeline');
      const month = await until(() => dotBox(page, '2026-10'), 'month dot drawn');
      await page.mouse.click(month.x, month.y);
      const value = page.locator('#popEd [data-f="v"]'); await value.waitFor();
      await value.fill('0.7'); // typed, not committed yet
      const schedule = await newPage();
      await openDay(schedule, '2026-11-03');
      await schedule.getByRole('radio', { name: '행복도 9' }).check();
      await until(() => entryOn(server, '2026-11-03')?.v === 0.8, '일정 D value reached the account');
      await page.evaluate(() => loadHappinessDays());
      await page.waitForFunction(() => HAPDAYS.state === 'ready' && HAPDAYS.entries.some(e => e.date === '2026-11-03'));
      await page.waitForTimeout(600);
      assert.equal(await page.locator('#popEd').isHidden(), false, 'the popup stays open');
      assert.equal(await value.inputValue(), '0.7', 'the typed value stays');
      assert.equal(await page.evaluate(() => HAPVIEW.some(p => p.date === '2026-11-03')), false, 'not redrawn while the popup is open');
      await value.press('Enter'); await page.evaluate(() => closePop());
      await page.waitForFunction(() => HAPVIEW.some(p => p.date === '2026-11-03' && p.v === 0.8));
      await until(() => tables.rows.haedo_documents.get('d_timeline').data.happiness.some(h => h.v === 0.7), 'editor saved');
      assert.equal(tables.rows.haedo_documents.get('d_timeline').data.happiness.some(h => h.date === '2026-11-03'), false);
      assert.equal(entryOn(server, '2026-11-03').v, 0.8);
    });

    await check('the editor cannot read the 행복도: day points are hidden and 일정에서 보기 is shown', async ({ page, server, tables }) => {
      tables.seed('haedo_documents', accounts.a.id, { id: 'd_timeline', name: '내 연표', data: timeline([{ date: '2026-10', v: 0.1 }, { date: '2026-10-02', v: 0.5 }]) });
      server.accountDocReadFail = true; page.__expectFailure = true;
      await openEditor(page, 'd_timeline');
      await page.waitForFunction(() => HAPDAYS.state === 'failed');
      const note = page.locator('#hapDaysNote'); await note.waitFor();
      assert.equal(await note.getByRole('link', { name: '일정에서 보기' }).getAttribute('href'), 'index.html?section=schedule&view=day');
      assert.deepEqual(await page.evaluate(() => HAPVIEW.map(p => p.date)), ['2026-10'], 'the old day point is hidden, the month stays');
      assert.deepEqual(await page.evaluate(() => DATA.happiness.map(h => h.date)), ['2026-10', '2026-10-02'], 'nothing removed from the timeline');
      // A late read (held) does not redraw under an open popup.
      server.accountDocReadFail = false;
      let release; server.accountDocReadHold = new Promise(done => { release = done; });
      const pending = page.evaluate(() => loadHappinessDays());
      const month = await until(() => dotBox(page, '2026-10'), 'month dot drawn');
      await page.mouse.click(month.x, month.y); await page.locator('#popEd [data-f="v"]').waitFor();
      release(); server.accountDocReadHold = null; await pending;
      await page.waitForTimeout(600);
      assert.equal(await page.locator('#popEd').isHidden(), false);
      assert.deepEqual(await page.evaluate(() => HAPVIEW.map(p => p.date)), ['2026-10'], 'still the earlier drawing');
      await page.evaluate(() => closePop());
      await page.waitForFunction(() => HAPVIEW.some(p => p.date === '2026-10-02'));
      assert.equal(await note.isHidden(), true);
    });

    await check('offline: the choice is kept on the device, survives a reload, and is sent when back online', async ({ page, server, device }) => {
      await openDay(page, '2026-11-03');
      server.accountDocsOffline.add(device); page.__expectFailure = true;
      await page.getByRole('radio', { name: '행복도 6' }).check();
      await statusText(page).filter({ hasText: /계정에 올리기 대기|계정에 올리지 못함/ }).waitFor({ timeout: 15000 });
      await page.reload(); await ready(page); await shown(page, 'day'); await entries(page);
      await page.waitForFunction(() => document.querySelector('.schedule-happiness input:checked')?.value === '6');
      assert.equal(entryOn(server, '2026-11-03'), null, 'not sent while offline');
      server.accountDocsOffline.delete(device);
      await page.evaluate(() => dispatchEvent(new Event('online')));
      await until(() => entryOn(server, '2026-11-03')?.v === 0.2, 'sent after reconnecting');
    });

    await check('mixed versions: an older storage.js next to the new 일정 writes nothing and asks for a refresh; the choice stays on screen', async ({ page, context, server }) => {
      // This release's storage.js without the happinessDays API (as an older cached module), made from the
      // served file itself: no git history needed (CI checks out one commit), like sync-common-mixed-browser.
      const api = 'readHappinessDays, writeHappinessDay, absorbTimelineDays,';
      let replaced = 0;
      await context.route('**/assets/life/storage.js', async route => {
        const response = await route.fetch(), text = await response.text();
        assert.equal(text.split(api).length, 2, 'the API line to remove is in storage.js exactly once');
        replaced++;
        await route.fulfill({ response, body: text.replace(api, '') });
      });
      await openDay(page, '2026-11-03');
      assert.ok(replaced >= 1, 'the older module was served');
      assert.equal(await page.evaluate(() => typeof HaedoLife.Shell.storage.writeHappinessDay), 'undefined');
      await page.getByRole('radio', { name: '행복도 8' }).check();
      const notice = page.locator('.schedule-happiness-error[data-code="app_refresh_required"]');
      await notice.waitFor();
      assert.equal(await notice.innerText(), '앱을 새로고침한 뒤 다시 시도해 주세요. 값은 그대로 있습니다.');
      assert.equal(await chosen(page), '8', 'the choice stays on screen');
      await page.waitForTimeout(1500);
      assert.equal(accountDoc(server), null, 'nothing written');
      assert.equal(server.accountDocWrites().filter(row => String(row.body.p_doc_key).startsWith('happinessDays:')).length, 0);
    });

    // Review MINOR-3: 3 then 7 at once; the first write ends after the second failed. 7 stays chosen.
    await check('a quick second choice stays on screen when its write fails after the first one ends', async ({ page, context, server }) => {
      const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);let n=0;return Object.freeze({...actual,async writeHappinessDay(...a){n++;if(n===1){await new Promise(r=>setTimeout(r,800));return actual.writeHappinessDay(...a);}if(n===2)throw Object.assign(new Error('저장하지 못했습니다. 다시 시도해 주세요.'),{code:'storage_aborted'});return actual.writeHappinessDay(...a);}});}});})();`;
      await context.route('**/assets/life/storage.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()) + hook }); });
      await openDay(page, '2026-11-03');
      await page.getByRole('radio', { name: '행복도 3' }).check();
      await page.getByRole('radio', { name: '행복도 7' }).check();
      await page.locator('.schedule-happiness-error').filter({ hasText: '저장하지 못했습니다' }).waitFor();
      await page.waitForTimeout(1500); // the first write (3) ends here
      assert.equal(await chosen(page), '7', 'the later choice stays on screen');
      await until(() => entryOn(server, '2026-11-03')?.v === -0.4, 'the first write reached the account');
    });

    // Review nit: before the account document is read, no day shows a timeline's old value (a day
    // deleted in 일정 D must not come back for a moment).
    await check('while the account document is being read, a deleted day does not show the timeline\'s old value', async ({ page, context, server, tables }) => {
      tables.seed('haedo_documents', accounts.a.id, { id: 'd_timeline', name: '내 연표', data: timeline([{ date: '2026-11-02', v: 0.4 }]) });
      await openDay(page, '2026-11-02');
      await page.waitForFunction(() => document.querySelector('.schedule-happiness input:checked')?.value === '7');
      await page.getByRole('button', { name: '이 날 행복도 지우기' }).click();
      await until(() => entryOn(server, '2026-11-02')?.v === null, 'deleted');
      const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async readHappinessDays(...a){await new Promise(r=>{window.__releaseRead=r;});return actual.readHappinessDays(...a);}});}});})();`;
      await context.route('**/assets/life/storage.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()) + hook }); });
      await page.reload(); await ready(page); await shown(page, 'day');
      await page.waitForFunction(() => typeof window.__releaseRead === 'function' && document.querySelector('.schedule-entries')?.dataset.happiness === 'loading' && document.querySelector('.schedule-happiness'));
      assert.equal(await chosen(page), null, 'nothing chosen while the read is held');
      await page.evaluate(() => window.__releaseRead());
      await entries(page);
      assert.equal(await chosen(page), null, 'still deleted after the read');
    });

    await check('the editor drops a 행복도 read that ends after its account session changed', async ({ page, server, tables }) => {
      tables.seed('haedo_documents', accounts.a.id, { id: 'd_timeline', name: '내 연표', data: timeline([{ date: '2026-10', v: 0.1 }]) });
      server.accountDocs.set(accounts.a.id, new Map([[key(accounts.a), { revision: 1, data: { revision: 1, format: 1, entries: [{ date: '2026-10-02', v: 0.5, at: EPOCH }], migrated: [] }, deleted: false, client_updated_at: null, seq: 1 }]]));
      await openEditor(page, 'd_timeline');
      await page.waitForFunction(() => HAPDAYS.state === 'ready');
      let release; server.accountDocReadHold = new Promise(done => { release = done; });
      const pending = page.evaluate(() => loadHappinessDays());
      await until(() => server.accountDocReads.length >= 2, 'second read started');
      await page.evaluate(() => { cloudEpoch++; }); // the account session changed (dropSession/epoch), as on a switch
      server.accountDocs.get(accounts.a.id).get(key(accounts.a)).data.entries[0].v = -0.9;
      release(); server.accountDocReadHold = null; await pending;
      assert.deepEqual(await page.evaluate(() => [HAPDAYS.state, HAPDAYS.entries.map(e => e.v)]), ['ready', [0.5]], 'the late result was not taken');
      assert.deepEqual(await page.evaluate(() => HAPVIEW.filter(p => p.account).map(p => p.v)), [0.5], 'the drawing keeps the earlier value');
    });

    for (const width of [1440, 390]) await check('the day input fits ' + width + ' with 44px targets and no horizontal scroll', async ({ page }) => {
      await openDay(page, '2026-11-03');
      await page.getByRole('radio', { name: '행복도 5' }).check();
      await page.getByRole('button', { name: '이 날 행복도 지우기' }).waitFor();
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(wide, false, 'no horizontal page scroll');
      const small = await page.locator('.schedule-happiness label, .schedule-happiness button').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect()).filter(b => b.height < 44 || b.width < 24).length);
      assert.equal(small, 0, 'targets at least 44px tall');
      await page.screenshot({ path: path.join(output, 'day-' + width + '.png'), fullPage: false });
    }, { width, height: 900 });
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.pageErrors, [], 'page errors'); assert.deepEqual(report.consoleErrors, [], 'console errors');
  assert(report.checks.length && report.checks.every(item => item.pass), 'all checks pass');
  console.log(JSON.stringify({ checks: report.checks.length, expectedErrors: report.expectedErrors }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
