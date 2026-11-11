/* Originals merge: what still reaches the manual comparison, by its real cause. Two isolated
 * Chromium contexts ("devices") of one anonymous account, the bundled SDK, the real application
 * and IndexedDB against the tests' FakeCloud, in a library of their own:
 *   - a merged snapshot the server would refuse (half of a character pair),
 *   - a merged snapshot over 16 MiB (two devices with 9 MB each: megabytes through the browser, minutes),
 *   - a deleted server copy.
 * The merge itself, the notice and the previous version are in tests/source-merge-browser.cjs.
 * Not evidence for the production database, RLS or Apple hardware.
 *   python3 scripts/dev-server.py --port 4613 &
 *   BASE_URL=http://127.0.0.1:4613 node tests/source-merge-limits-browser.cjs
 * SOURCE_MERGE_ONLY=<regex> runs only the checks whose name matches. Report: .local/source-merge-limits/. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright } = require('./unified-home-browser.cjs');
const { sleep, until, imp, editNote, snap, light, kick, openDevice, convergedOn } = require('./source-merge-browser.cjs');
const out = path.resolve(__dirname, '../.local/source-merge-limits');
const owner = accounts.a.id;
const results = [], failures = [];
const only = process.env.SOURCE_MERGE_ONLY ? new RegExp(process.env.SOURCE_MERGE_ONLY) : null;
async function check(name, action) {
  if (only && !only.test(name)) { console.log('skip ' + name); return; }
  const started = Date.now();
  try { await action(); results.push({ name, ok: true, ms: Date.now() - started }); console.log('ok   ' + name + ' (' + (Date.now() - started) + ' ms)'); }
  catch (error) { failures.push(name); results.push({ name, ok: false, error: String(error.stack || error).slice(0, 2500) }); console.log('FAIL ' + name + '\n' + (error.stack || error)); }
}

async function main() {
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const second = new FakeCloud().enableAccountLibrary();
  const devices = [];
  const open = async (name, options = {}) => { const entry = await openDevice(browser, second, name, options); devices.push(entry); return entry; };
  let secondId = null;
  const row2 = () => second.row(owner, secondId);
  const converged = (list, label) => convergedOn(list, label, row2);
  const offline = (item, on) => { if (on) second.offline.add(item.name); else second.offline.delete(item.name); };
  try {
    const big = await open('big'), small = await open('small', { viewport: { width: 390, height: 844 } });
    secondId = (await snap(big.page)).workspaceId; assert.equal((await snap(small.page)).workspaceId, secondId, 'both devices open the account\'s default library');
    await converged([big, small], 'both devices start synced');

    await check('a merged snapshot the server would refuse (half of a character pair) is recorded for the comparison; once the text is whole the same device merges by itself', async () => {
      const fixture = await imp(big.page, '끊긴 글자', '끊긴 글자의 본문입니다', [{ start: 0, end: 2, topic: '글자', note: '처음' }]);
      await converged([big, small], 'fixture on both');
      offline(small, true);
      await small.page.evaluate(async id => {
        const s = HaedoLife.Shell.storage, c = HaedoLife.Core, w = await s.getActive(), b = await s.read(w), record = b.records.find(value => value.id === id);
        const result = await s.commitLocal({ workspaceId: w, baseRevision: b.revision, operationId: c.id(),
          changes: { put: { records: [{ ...record, note: '끊긴 메모 ' + String.fromCharCode(0xd83d), revision: record.revision + 1, updatedAt: new Date().toISOString() }] } } });
        if (result.status !== 'stored') throw new Error('edit ' + result.status);
      }, fixture.recordIds[0]);
      await imp(big.page, '끊긴 글자와 함께 온 자료', '큰 화면 본문');
      await until(() => snap(big.page), state => state.sync.status === 'synced' && row2().data.sources.length === 2, 'the other device stored');
      const stored = row2().revision;
      offline(small, false);
      const recorded = await until(async () => { await kick(small.page); return light(small.page); }, state => state.status === 'conflict', 'recorded for the comparison', 40000, 500);
      assert.equal(recorded.conflict.missing, false); assert.equal(row2().revision, stored, 'nothing was sent');
      await small.page.locator('#lifeAccountStorage[data-state="conflict"]').waitFor();
      assert.ok(await small.page.locator('#lifeAccountStorageReview').isVisible(), 'the band offers the comparison');
      await editNote(small.page, fixture.recordIds[0], '고친 메모 😀');
      await converged([big, small], 'merged once the text was whole');
      assert.deepEqual([row2().data.records[0].note, row2().data.sources.length], ['고친 메모 😀', 2]);
    });

    await check('a merged snapshot over 16 MiB is recorded for the comparison; later runs ask for the revision only; the manual choice resolves it', async () => {
      // Nine originals of 1 MB on each device, saved by one commit each: 18 MB together.
      const many = (page, label) => page.evaluate(async label => {
        const s = HaedoLife.Shell.storage, c = HaedoLife.Core, w = await s.getActive(), b = await s.read(w), put = {};
        for (let index = 0; index < 9; index++) {
          const prepared = await c.prepareImport({ origin: 'other', title: label + ' 큰 자료 ' + index, text: (label + index + ' ').padEnd(1000 * 1000, 'x'), authorRelation: 'self', coverage: 'full_text', forceSeparate: true }, b);
          for (const [name, items] of Object.entries(c.buildImportChanges(b, prepared, []).put)) put[name] = (put[name] || []).concat(items);
        }
        const result = await s.commitLocal({ workspaceId: w, baseRevision: b.revision, operationId: c.id(), changes: { put } });
        if (result.status !== 'stored') throw new Error('import ' + result.status + ' ' + (result.error?.code || ''));
      }, label);
      const before = row2().data.sources.length, phases = [], started = Date.now(); let last = started;
      const phase = name => { phases.push(name + ' ' + ((Date.now() - last) / 1000).toFixed(1) + ' s'); last = Date.now(); };
      offline(small, true);
      await many(small.page, '작은 화면'); await many(big.page, '큰 화면'); phase('both devices import 9 MB');
      await until(() => light(big.page), state => state.status === 'synced' && row2().data.sources.length === before + 9, 'the other device stored its nine', 120000, 500);
      phase('the other device uploads'); const stored = row2().revision, own = (await light(small.page)).sources;
      const reads = []; const record = request => { const url = new URL(request.url()); if (url.pathname === '/rest/v1/life_workspaces' && url.searchParams.get('id')) reads.push(url.searchParams.get('select')?.split(',').includes('data') ? 'full' : 'revision'); };
      small.page.on('request', record);
      offline(small, false);
      const recorded = await until(async () => { await kick(small.page); return light(small.page); }, state => state.status === 'conflict', 'recorded for the comparison', 120000, 1000);
      phase('this device downloads, tries the merge and records the difference'); assert.equal(recorded.conflict.missing, false); assert.equal(recorded.sources, own, 'this device\'s originals are untouched'); assert.equal(row2().revision, stored, 'nothing was sent');
      // The band follows once the account library's pass over this large library has finished.
      await until(() => small.page.evaluate(() => document.querySelector('#lifeAccountStorage')?.dataset.state + ' / ' + [...(window.__merge?.band || [])].join(',') + ' / ' + document.querySelector('#lifeAccountStorage')?.innerText.replace(/\s+/g, ' ').slice(0, 120)),
        value => value.startsWith('conflict '), 'the band shows the difference', 120000, 1000);
      phase('the band shows it'); await sleep(3000); const first = reads.length;
      // Two further runs of the engine, as the account library starts them (focus and online events are joined and spaced).
      // Each still reads this device's 9 MB from IndexedDB, which is what takes the time here.
      for (let run = 0; run < 2; run++) assert.equal(await small.page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await HaedoLife.Shell.sync.syncNow(await s.getActive(), { headIfClean: true })).status; }), 'conflict');
      const later = reads.slice(first); small.page.off('request', record); phase('two further runs');
      console.log('     over 16 MiB, until the comparison: ' + phases.join(' · '));
      console.log('     over 16 MiB: ' + reads.slice(0, first).filter(kind => kind === 'full').length + ' full download(s) until it was recorded; in two further runs ' + later.filter(kind => kind === 'full').length + ' full and ' + later.filter(kind => kind === 'revision').length + ' revision-only reads');
      assert.equal(later.filter(kind => kind === 'full').length, 0, 'the megabytes are not downloaded again');
      assert.ok(later.filter(kind => kind === 'revision').length >= 2, 'each run asks whether the server moved (the page\'s own runs in the same seconds do too)');
      // The comparison still resolves it: the server side is taken, this device's side stays as a copy.
      const spaces = (await small.page.evaluate(() => HaedoLife.Shell.storage.listWorkspaces())).length;
      // The band offers the comparison between the account library's passes over this large library (it reads "working" during one).
      await until(async () => { try { await small.page.locator('#lifeAccountStorageReview').click({ timeout: 2000 }); return true; } catch (_) { return false; } }, value => value, 'the comparison is offered', 120000, 500);
      // The screen is busy for a long time here: it reads the 9 MB server side and lays out both sides, then
      // copies this device's 9 MB into a new space. The waits are for megabytes, not for a timer.
      const busy = { timeout: 240000 }, idle = () => small.page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]'), null, busy);
      await idle(); phase('opening the account screen');
      await small.page.getByRole('button', { name: '양쪽 자료 비교', exact: true }).click(busy); await idle(); phase('reading and showing both sides');
      await small.page.getByRole('button', { name: '서버 변경 받기 · 내 변경은 사본 보관', exact: true }).click(busy);
      const resolved = await until(async () => { await kick(small.page); return light(small.page); }, state => state.status === 'synced' && !state.conflict, 'resolved by hand', 240000, 1000);
      phase('taking the server side and keeping a copy'); assert.equal(resolved.sources, before + 9);
      console.log('     over 16 MiB, ' + ((Date.now() - started) / 1000).toFixed(0) + ' s in all, the manual choice: ' + phases.slice(-3).join(' · '));
      assert.equal((await small.page.evaluate(() => HaedoLife.Shell.storage.listWorkspaces())).length, spaces + 1, 'this device\'s side is kept as a copy');
    });

    await check('a deleted server copy is recorded as missing: never merged, never created again', async () => {
      await until(async () => { await kick(small.page); return light(small.page); }, state => state.status === 'synced', 'synced before the deletion', 120000, 1000);
      offline(small, true);
      await imp(small.page, '서버 사본이 지워진 뒤의 자료', '본문');
      const writes = second.writes(owner, secondId).length;
      second.rows.delete(second.key(owner, secondId));
      offline(small, false);
      await until(async () => { await kick(small.page); return light(small.page); }, state => state.conflict?.missing === true, 'recorded as missing', 60000, 1000);
      for (let run = 0; run < 3; run++) { await kick(small.page); await sleep(1500); }
      assert.equal(second.rows.has(second.key(owner, secondId)), false, 'the server copy was not created again');
      assert.deepEqual(second.writes(owner, secondId).slice(writes).filter(request => request.device === 'small').map(request => request.expected).filter(expected => expected === 0), [], 'no first upload was tried');
      assert.equal((await light(small.page)).conflict.missing, true);
    });

    await check('no unexpected console or page errors on any device', async () => {
      const expected = /ERR_INTERNET_DISCONNECTED|ERR_FAILED|net::ERR_/;
      for (const item of devices) assert.deepEqual(item.errors.filter(text => !expected.test(text)), [], item.name);
    });
  } catch (error) { failures.push('fatal'); console.error(error.stack || error); }
  finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ base, results }, null, 2));
    await browser.close();
  }
  console.log(results.filter(item => item.ok).length + '/' + results.length + ' checks passed');
  if (failures.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
