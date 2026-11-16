/* 연표 표시 설정(행복도 곡선·나이)의 계정 자동 연동(2026-11-16, account-sync-everywhere.md 같은 날짜 절).
 * Two browser contexts = two devices of one account on one FakeCloud (real app, SDK, IndexedDB; intercepted
 * anonymous Auth; account documents in memory). Chromium widths only, not Apple devices.
 * Covers: first sync uploads this browser's earlier values and keeps them; a 설정 choice on one device reaches the
 * other; a focused select is not overwritten until it is left; a change made in the timeline editor (timeline.html,
 * without storage.js) goes up on the next 해도 entry. Account switching and late responses: tests/timeline-display-sync.test.cjs.
 * npm run dev (or scripts/dev-server.py --port 4184); BASE_URL, PW_MODULE_PATH, CHROMIUM_PATH as in README. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav, observe } = require('./unified-home-browser.cjs');
const { PlatformTables } = require('./schedule-entries-browser.cjs');

const out = path.resolve('.local/timeline-display-sync-browser');
const report = { createdAt: new Date().toISOString(), scope: 'Actual SDK/IndexedDB with intercepted anonymous Auth; Chromium widths, not Apple devices', checks: [], consoleErrors: [], pageErrors: [] };
const MA = 'caeyeon_life_ma', AGE = 'caeyeon_life_age', RECORD = 'caeyeon_life_display_sync';
const DOC = 'd_display';
const timelineDoc = () => ({ profile: { name: '내 연표', birth: '1990-01' }, scale: 'signed1', events: [{ date: '2020-01', title: '익명 사건' }], spans: [], eras: [],
  happiness: [], thoughts: [], records: [], trips: [], layers: [] });

const stored = (page, key) => page.evaluate(key => localStorage.getItem(key), key);
async function until(test, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await test()) return; await new Promise(done => setTimeout(done, 150)); }
  throw new Error('never reached: ' + label);
}
// The account document as the server holds it, as { key: v }.
function serverDisplay(server) {
  for (const docs of server.accountDocs.values()) for (const [key, row] of docs) if (key.startsWith('timelineDisplay:') && !row.deleted)
    return Object.fromEntries(row.data.items.map(item => [item.key, item.v]));
  return null;
}
// The engine wakes on window focus (sync-lifecycle): it sends this device's changes and pulls the others'.
const wake = page => page.evaluate(() => window.dispatchEvent(new Event('focus')));
async function openSettings(page) { await nav(page, 'manage'); await page.locator('#lifeMain[data-mode="manage"]').waitFor(); await settle(page); await page.locator('#lifeSettings').waitFor(); }

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  const contexts = [];
  async function device(server, name, width, tables = null) {
    const context = await makeContext(browser, server, 'tds-' + name + '-' + report.checks.length, accounts.a, { viewport: { width, height: width === 390 ? 844 : 960 }, hasTouch: width <= 820 });
    if (tables) await tables.attach(context);
    contexts.push(context);
    const page = await context.newPage(); observe(page, report, name); page.setDefaultTimeout(15000);
    return { context, page };
  }
  async function check(name, run) {
    console.log('RUN ' + name);
    try { await run(); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      for (const [i, context] of contexts.entries()) for (const [j, page] of context.pages().entries()) await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '-' + i + '-' + j + '.png'), fullPage: true }).catch(() => {});
    } finally { for (const context of contexts.splice(0)) await context.close(); }
  }
  try {
    await check('first sync uploads the earlier values, a 설정 choice reaches the other device, a focused select waits', async () => {
      const server = new FakeCloud();
      const mac = await device(server, 'mac', 1440), ipad = await device(server, 'ipad', 390);
      // The Mac had chosen 기록(0) and 한국 나이 before this release (values only, no record).
      await mac.page.goto(base + '/privacy.html');
      await mac.page.evaluate(([ma, age]) => { localStorage.setItem(ma, '0'); localStorage.setItem(age, 'kr'); }, [MA, AGE]);
      await mac.page.goto(base + '/index.html'); await ready(mac.page);
      await until(async () => JSON.stringify(serverDisplay(server)) === JSON.stringify({ age: 'kr', curve: 0 }), 'the Mac values reach the account');
      assert.equal(await stored(mac.page, MA), '0'); assert.equal(await stored(mac.page, AGE), 'kr');
      // The iPad never chose: it takes the account values into the copies the timeline reads.
      await ipad.page.goto(base + '/index.html'); await ready(ipad.page);
      await until(async () => await stored(ipad.page, MA) === '0' && await stored(ipad.page, AGE) === 'kr', 'the iPad copies follow the account');
      await openSettings(ipad.page);
      assert.equal(await ipad.page.locator('#lifeSettingsCurve').inputValue(), '0');
      assert.equal(await ipad.page.locator('#lifeSettingsAge').inputValue(), 'kr');
      assert.match(await ipad.page.locator('#settings-schedule .settings-note').innerText(), /로그인한 모든 기기/);
      // 설정 on the Mac: 흐름(60).
      await openSettings(mac.page);
      assert.equal(await mac.page.locator('#settings-schedule input[value="0"]').isChecked(), true);
      await mac.page.locator('.settings-curve-card[data-settings-curve="60"]').click();
      assert.equal(await stored(mac.page, MA), '60', 'the copy is written at once');
      await wake(mac.page);
      await until(async () => serverDisplay(server)?.curve === 60, 'the Mac choice reaches the account');
      // The iPad's curve select is focused (being chosen): the received value waits until it is left.
      await ipad.page.locator('#lifeSettingsCurve').focus();
      await wake(ipad.page);
      await until(async () => await stored(ipad.page, MA) === '60', 'the iPad copy takes the later choice');
      assert.equal(await ipad.page.locator('#lifeSettingsCurve').inputValue(), '0', 'a focused select is not overwritten');
      assert.equal(await ipad.page.evaluate(() => document.activeElement?.id), 'lifeSettingsCurve');
      await ipad.page.locator('#lifeSettingsAge').focus();
      await until(async () => await ipad.page.locator('#lifeSettingsCurve').inputValue() === '60', 'the select shows the value once left');
      // 설정 on the iPad: 만 나이. Back to the Mac, whose open 설정 redraws.
      await ipad.page.locator('#lifeSettingsAge').selectOption('intl');
      assert.equal(await stored(ipad.page, AGE), 'intl');
      await wake(ipad.page); await until(async () => serverDisplay(server)?.age === 'intl', 'the iPad choice reaches the account');
      await wake(mac.page);
      await until(async () => await stored(mac.page, AGE) === 'intl', 'the Mac copy follows');
      await mac.page.waitForFunction(() => document.querySelector('#settings-schedule input[value="intl"]').checked);
      assert.deepEqual(serverDisplay(server), { age: 'intl', curve: 60 });
    });

    await check('a change made in the timeline editor goes up on the next 해도 entry and reaches the other device', async () => {
      const server = new FakeCloud(), tables = new PlatformTables('2026-11-03T01:00:00Z');
      const mac = await device(server, 'mac', 1440, tables), ipad = await device(server, 'ipad', 1440);
      tables.seed('haedo_documents', accounts.a.id, { id: DOC, name: '내 연표', data: timelineDoc() });
      await mac.page.goto(base + '/index.html'); await ready(mac.page); await openSettings(mac.page);
      await mac.page.locator('.settings-curve-card[data-settings-curve="60"]').click();
      await wake(mac.page); await until(async () => serverDisplay(server)?.curve === 60, 'first choice reaches the account');
      await ipad.page.goto(base + '/index.html'); await ready(ipad.page);
      await until(async () => await stored(ipad.page, MA) === '60', 'the iPad follows');
      // The Mac timeline editor (timeline.html loads no 해도 storage) switches to 기록(0) and 한국 나이.
      await mac.page.goto(base + '/timeline.html?doc=' + DOC);
      await mac.page.waitForFunction(() => document.getElementById('timelineAccess')?.hidden && typeof persist === 'function');
      await mac.page.locator('#btnShow').click();
      await mac.page.locator('button[data-ma="0"]').click();
      await mac.page.locator('button[data-age="kr"]').click();
      assert.equal(await stored(mac.page, MA), '0'); assert.equal(await stored(mac.page, AGE), 'kr');
      const record = JSON.parse(await stored(mac.page, RECORD));
      assert.equal(record.curve.v, 0); assert.equal(record.curve.up, false, 'recorded as not yet in the account');
      assert.deepEqual(serverDisplay(server), { curve: 60 }, 'the timeline editor itself sends nothing');
      // Next 해도 entry on the Mac.
      await mac.page.goto(base + '/index.html'); await ready(mac.page);
      await until(async () => JSON.stringify(serverDisplay(server)) === JSON.stringify({ age: 'kr', curve: 0 }), 'the editor change goes up');
      assert.equal(JSON.parse(await stored(mac.page, RECORD)).curve.up, true);
      await wake(ipad.page);
      await until(async () => await stored(ipad.page, MA) === '0' && await stored(ipad.page, AGE) === 'kr', 'the iPad copies follow');
    });

    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []);
  } finally { await browser.close(); await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ passed: report.checks.filter(c => c.pass).length, total: report.checks.length, console: report.consoleErrors.length, page: report.pageErrors.length }));
  if (report.checks.some(c => !c.pass) || report.consoleErrors.length || report.pageErrors.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
