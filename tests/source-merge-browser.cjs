/* Originals merge between devices: isolated Chromium contexts ("devices") of one anonymous
 * account, the bundled SDK, the real application and IndexedDB against the tests' FakeCloud.
 * Not evidence for the production database, RLS or Apple hardware.
 *   python3 scripts/dev-server.py --port 4613 &
 *   BASE_URL=http://127.0.0.1:4613 node tests/source-merge-browser.cjs
 * SOURCE_MERGE_ONLY=<regex> runs only the checks whose name matches (each check makes its own
 * fixtures on top of the shared setup). Screenshots: .local/source-merge/ (anonymous sample text only). */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const out = path.resolve(__dirname, '../.local/source-merge');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate, label, timeout = 40000, step = 150) {
  const start = Date.now(); let value;
  do { value = await read(); if (predicate(value)) return value; await sleep(step); } while (Date.now() - start < timeout);
  throw new Error('timeout: ' + label + ' — ' + JSON.stringify(value)?.slice(0, 1200));
}
const owner = accounts.a.id;
const results = [], failures = [];
const only = process.env.SOURCE_MERGE_ONLY ? new RegExp(process.env.SOURCE_MERGE_ONLY) : null;
async function check(name, action) {
  if (only && !only.test(name)) { console.log('skip ' + name); return; }
  const started = Date.now();
  try { await action(); results.push({ name, ok: true, ms: Date.now() - started }); console.log('ok   ' + name + ' (' + (Date.now() - started) + ' ms)'); }
  catch (error) { failures.push(name); results.push({ name, ok: false, error: String(error.stack || error).slice(0, 2500) }); console.log('FAIL ' + name + '\n' + (error.stack || error)); }
}

// ---- page helpers (anonymous sample content, written through the same storage calls the screens use) ----
const imp = (page, title, text, excerpts = [], options = {}) => page.evaluate(async ({ title, text, excerpts, options }) => {
  const s = HaedoLife.Shell.storage, c = HaedoLife.Core, w = await s.getActive(), b = await s.read(w);
  const prepared = await c.prepareImport({ origin: 'other', title, text, authorRelation: 'self', coverage: 'full_text',
    ...(options.sourceId ? { existingSourceId: options.sourceId } : { forceSeparate: true }) }, b);
  if (options.own) prepared.source.sourceKey = 'haedo:writing:' + crypto.randomUUID();
  const changes = c.buildImportChanges(b, prepared, excerpts);
  const result = await s.commitLocal({ workspaceId: w, baseRevision: b.revision, operationId: c.id(), changes });
  if (result.status !== 'stored') throw new Error('import ' + result.status + ' ' + (result.error?.code || ''));
  return { sourceId: prepared.source.id, versionId: prepared.version.id, recordIds: (changes.put.records || []).map(record => record.id) };
}, { title, text, excerpts, options });
const editNote = (page, id, note) => page.evaluate(async ({ id, note }) => {
  const s = HaedoLife.Shell.storage, c = HaedoLife.Core, w = await s.getActive(), b = await s.read(w), record = b.records.find(value => value.id === id);
  const result = await s.commitLocal({ workspaceId: w, baseRevision: b.revision, operationId: c.id(),
    changes: { put: { records: [{ ...record, note, revision: record.revision + 1, updatedAt: new Date().toISOString() }] } } });
  if (result.status !== 'stored') throw new Error('edit ' + result.status);
}, { id, note });
const removeRecord = (page, id) => page.evaluate(async id => {
  const s = HaedoLife.Shell.storage, c = HaedoLife.Core, w = await s.getActive(), b = await s.read(w);
  const result = await s.commitLocal({ workspaceId: w, baseRevision: b.revision, operationId: c.id(), changes: { remove: { records: [id] } } });
  if (result.status !== 'stored') throw new Error('remove ' + result.status);
}, id);
const trash = (page, sourceId) => page.evaluate(async sourceId => {
  const s = HaedoLife.Shell.storage, c = HaedoLife.Core, w = await s.getActive(), b = await s.read(w);
  const result = await s.commitLocal({ workspaceId: w, baseRevision: b.revision, operationId: c.id(), changes: c.buildSourceStateChanges(b, sourceId, 'trash') });
  if (result.status !== 'stored') throw new Error('trash ' + result.status);
}, sourceId);
const draft = (page, title, text, sourceId = null) => page.evaluate(async ({ title, text, sourceId }) => {
  const s = HaedoLife.Shell.storage, w = await s.getActive(), b = await s.read(w);
  const stage = HaedoLife.Writing.createDraft(b, sourceId ? { sourceId } : {});
  Object.assign(stage, { title, text }); return (await s.saveStage(stage)).stageId;
}, { title, text, sourceId });
const snap = page => page.evaluate(async () => {
  const s = HaedoLife.Shell.storage, w = await s.getActive(), b = await s.read(w), state = await HaedoLife.Shell.sync.getState(w);
  HaedoLife.Core.validateWorkspace(b);
  return { workspaceId: w, revision: b.revision, bundle: b, titles: b.sources.map(source => source.title),
    sync: { status: state.status, remoteRevision: state.remoteRevision, conflict: state.conflict ? { missing: state.conflict.missing } : null, error: state.error?.code || null },
    notice: await s.getSyncNotice(w), seen: [...(window.__merge?.statuses || [])], band: [...(window.__merge?.band || [])] };
});
const content = bundle => JSON.stringify({ ...bundle, revision: 0 });
const kick = page => page.evaluate(() => { dispatchEvent(new Event('online')); dispatchEvent(new Event('focus')); });

async function main() {
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const server = new FakeCloud().enableAccountLibrary();
  const devices = [];
  // Requests of one device that the test answers itself (a failing or delayed upload).
  async function device(name, { viewport = { width: 1280, height: 900 }, prepare = null } = {}) {
    const context = await makeContext(browser, server, name, accounts.a, { viewport });
    if (prepare) await prepare(context);
    // Every sync status this device's storage announces and every state of the account band.
    await context.addInitScript(() => {
      window.__merge = { statuses: new Set(), band: new Set(), changes: 0 };
      const wait = setInterval(() => {
        const storage = globalThis.HaedoLife?.Shell?.storage, band = document.querySelector('#lifeAccountStorage');
        if (!storage || !band) return; clearInterval(wait);
        storage.subscribeAll(event => { if (event.type === 'sync_changed') { __merge.statuses.add(event.status); __merge.changes++; } });
        const read = () => { __merge.band.add(band.dataset.state + (document.querySelector('#lifeAccountStorageReview')?.hidden === false ? ':review' : '')); };
        new MutationObserver(read).observe(band, { attributes: true, subtree: true, childList: true }); read();
      }, 20);
    });
    const errors = [];
    const page = await context.newPage(); page.setDefaultTimeout(25000);
    page.on('pageerror', error => errors.push('pageerror: ' + error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '/index.html?section=records'); await ready(page); await settle(page);
    const entry = { name, context, page, errors }; devices.push(entry); return entry;
  }
  const row = () => server.row(owner, workspaceId);
  let workspaceId;
  // Every device holds exactly the server snapshot, synced, with no difference recorded.
  async function converged(list, label) {
    await until(async () => {
      for (const item of list) await kick(item.page);
      const states = []; for (const item of list) states.push(await snap(item.page));
      return states;
    }, states => states.every(state => state.sync.status === 'synced' && !state.sync.conflict && content(state.bundle) === content(row().data)), label, 60000, 500);
  }
  const offline = (item, on) => { if (on) server.offline.add(item.name); else server.offline.delete(item.name); };

  try {
    const mac = await device('mac'), phone = await device('phone', { viewport: { width: 390, height: 844 } });
    workspaceId = (await snap(mac.page)).workspaceId;
    assert.equal((await snap(phone.page)).workspaceId, workspaceId, 'both devices open the account\'s default library');
    await converged([mac, phone], 'both devices start synced');

    // A source with an excerpt that both devices hold.
    const shared = await imp(mac.page, '공통 자료', '공통 본문 첫 줄\n둘째 줄 😀 끝', [{ start: 0, end: 5, topic: '주제', note: '처음 메모' }]);
    await converged([mac, phone], 'shared source on both');
    await check('M1: each device imports a different source while apart → both keep both, with no choice and no conflict band', async () => {
      offline(phone, true);
      await imp(phone.page, '폰에서 오프라인으로 가져온 자료', '폰 원문 본문입니다.');
      await imp(mac.page, '맥에서 가져온 자료', '맥 원문.');
      await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().data.sources.length === 2, 'mac stored');
      offline(phone, false);
      await converged([mac, phone], 'both devices hold both sources');
      const state = await snap(phone.page);
      assert.deepEqual([...state.titles].sort(), ['공통 자료', '맥에서 가져온 자료', '폰에서 오프라인으로 가져온 자료'].sort());
      assert.ok(row().data.sourceVersions.length >= 3);
      for (const item of [mac, phone]) {
        const seen = await snap(item.page);
        assert.ok(!seen.seen.includes('conflict'), item.name + ' never announced a conflict: ' + seen.seen);
        assert.ok(!seen.band.some(value => /conflict|review/.test(value)), item.name + ' never showed the conflict band: ' + seen.band);
        assert.equal(seen.notice, null, 'different items: nothing to announce');
      }
      assert.equal(await phone.page.locator('#lifeAccountStorageReview').isVisible(), false);
    });

    await check('a writing draft and a composition change made while the originals were apart reach the account', async () => {
      offline(phone, true);
      await imp(phone.page, '폰 두 번째 자료', '폰 두 번째 본문');
      const draftId = await draft(phone.page, '떨어져 있는 동안 쓴 초안', '이 초안은 계정에 올라간다');
      await phone.page.evaluate(async id => { const s = HaedoLife.Shell.storage, state = await s.readWorkbench(id); state.page.intro = '떨어져 있는 동안 고친 소개'; await s.saveWorkbench(id, state, state.revision); }, workspaceId);
      await imp(mac.page, '맥 두 번째 자료', '맥 두 번째 본문');
      await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().data.sources.some(source => source.title === '맥 두 번째 자료'), 'mac stored');
      offline(phone, false);
      await converged([mac, phone], 'both sources again');
      await until(async () => { await kick(phone.page); return { draft: server.draft(owner, workspaceId, draftId)?.data.text || null, intro: server.composition(owner, workspaceId)?.data.page.intro || null }; },
        value => value.draft === '이 초안은 계정에 올라간다' && value.intro === '떨어져 있는 동안 고친 소개', 'draft and composition on the server', 60000, 500);
    });

    await check('the same source edited on both devices: both exact versions stay, the later is current, the excerpt keeps its exact version; the earlier one is findable', async () => {
      offline(phone, true);
      await imp(mac.page, '맥에서 고친 제목', '맥에서 고친 본문', [], { sourceId: shared.sourceId });
      await sleep(30);
      await imp(phone.page, '폰에서 나중에 고친 제목', '폰에서 나중에 고친 본문', [], { sourceId: shared.sourceId });
      await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().data.sourceVersions.filter(version => version.sourceId === shared.sourceId).length === 2, 'mac stored its version');
      offline(phone, false);
      await converged([mac, phone], 'both versions on both devices');
      for (const item of [mac, phone]) {
        const { bundle } = await snap(item.page);
        const versions = bundle.sourceVersions.filter(version => version.sourceId === shared.sourceId);
        assert.deepEqual(versions.map(version => version.contentText), ['공통 본문 첫 줄\n둘째 줄 😀 끝', '맥에서 고친 본문', '폰에서 나중에 고친 본문'], item.name);
        assert.equal(bundle.sources.find(source => source.id === shared.sourceId).title, '폰에서 나중에 고친 제목');
        const record = bundle.records.find(value => value.id === shared.recordIds[0]), ref = record.sourceRefs[0];
        assert.equal(ref.sourceVersionId, shared.versionId, 'the excerpt still points at the exact version it was taken from');
        assert.equal(versions[0].contentText.slice(ref.locator.start, ref.locator.end), record.text);
      }
      assert.deepEqual((await snap(phone.page)).notice?.sourceIds, [shared.sourceId], 'the merging device keeps a notice');
      // The notice names the source and stays until acknowledged, also after a reload.
      await phone.page.goto(base + '/index.html?section=manage&view=sync'); await ready(phone.page); await settle(phone.page);
      const notice = phone.page.locator('#lifeSyncMergeNotice'); await notice.waitFor();
      const text = await notice.innerText();
      assert.match(text, /나중에 고친 쪽을 남겼습니다/); assert.match(text, /이전 버전/); assert.match(text, /폰에서 나중에 고친 제목/);
      for (const [width, height] of [[390, 844], [820, 1000], [1440, 900]]) {
        await phone.page.setViewportSize({ width, height }); await settle(phone.page);
        assert.ok(await notice.isVisible());
        assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no horizontal overflow at ' + width);
        // Measured through the locator: the panel may be redrawn by a sync event between two reads.
        const tall = await phone.page.locator('#lifeSyncMergeNoticeDone').evaluate(control => control.getBoundingClientRect().height);
        assert.ok(tall >= 44, 'the acknowledge control is at least 44px tall at ' + width + ': ' + tall);
        // Account and sync events that change nothing do not redraw the notice (a redraw between press and release loses the click).
        assert.equal(await phone.page.evaluate(() => new Promise(resolve => { let redraws = 0; const observer = new MutationObserver(() => { redraws++; });
          observer.observe(document.querySelector('#lifeSyncState'), { childList: true }); setTimeout(() => { observer.disconnect(); resolve(redraws); }, 1500); })), 0, 'the notice was redrawn at ' + width);
        await phone.page.screenshot({ path: path.join(out, 'merge-notice-' + width + '.png'), fullPage: true });
      }
      await phone.page.setViewportSize({ width: 390, height: 844 });
      await phone.page.locator('#lifeSyncMergeNoticeDone').click();
      await notice.waitFor({ state: 'detached' });
      await phone.page.reload(); await ready(phone.page); await settle(phone.page);
      assert.equal(await phone.page.locator('#lifeSyncMergeNotice').count(), 0); assert.equal((await snap(phone.page)).notice, null);
    });

    await check('the same excerpt edited on both devices: the later edit stays and the other is a 복구 사본 excerpt on both devices', async () => {
      const id = shared.recordIds[0];
      offline(phone, true);
      await editNote(mac.page, id, '맥에서 고친 메모'); await sleep(30); await editNote(phone.page, id, '폰에서 나중에 고친 메모');
      await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().data.records.find(record => record.id === id).note === '맥에서 고친 메모', 'mac stored its note');
      offline(phone, false);
      await converged([mac, phone], 'excerpt merged');
      for (const item of [mac, phone]) {
        const { bundle } = await snap(item.page), records = bundle.records.filter(record => record.sourceRefs[0].sourceVersionId === shared.versionId);
        assert.deepEqual(records.map(record => [record.note, record.topic]), [['폰에서 나중에 고친 메모', '주제'], ['맥에서 고친 메모', '복구 사본 · 주제']], item.name);
        assert.deepEqual(records[1].sourceRefs, records[0].sourceRefs); assert.equal(records[1].text, records[0].text);
      }
    });

    await check('deleted on one device and edited on the other → the edit stays; deleted and untouched → deleted; trashed while the other kept writing → not left in the trash', async () => {
      const kept = await imp(mac.page, '발췌 두 개', '첫째 구절과 둘째 구절', [{ start: 0, end: 5, topic: '삭제 대 수정', note: '' }, { start: 7, end: 12, topic: '삭제만', note: '' }]);
      const trashed = await imp(mac.page, '휴지통 대 수정', '처음 본문');
      await converged([mac, phone], 'fixtures on both');
      offline(phone, true);
      await removeRecord(mac.page, kept.recordIds[0]); await removeRecord(mac.page, kept.recordIds[1]); await trash(mac.page, trashed.sourceId);
      await editNote(phone.page, kept.recordIds[0], '지워지기 전에 폰에서 쓴 메모');
      await imp(phone.page, '휴지통 대 수정', '폰에서 계속 쓴 본문', [], { sourceId: trashed.sourceId });
      await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().data.tombstones.length >= 2, 'mac stored its deletions');
      offline(phone, false);
      await converged([mac, phone], 'deletions and edits merged');
      for (const item of [mac, phone]) {
        const { bundle } = await snap(item.page);
        assert.equal(bundle.records.find(record => record.id === kept.recordIds[0])?.note, '지워지기 전에 폰에서 쓴 메모', item.name + ': the edited excerpt stays');
        assert.equal(bundle.records.some(record => record.id === kept.recordIds[1]), false, item.name + ': the untouched excerpt is deleted');
        assert.ok(bundle.tombstones.some(mark => mark.entityId === kept.recordIds[1]) && !bundle.tombstones.some(mark => mark.entityId === kept.recordIds[0]));
        assert.equal(await item.page.evaluate(async id => { const s = HaedoLife.Shell.storage; return HaedoLife.Core.sourceState(await s.read(await s.getActive()), id).status; }, trashed.sourceId), 'active', item.name);
        assert.equal(bundle.sourceVersions.filter(version => version.sourceId === trashed.sourceId).length, 2);
      }
    });

    await check('both devices move the same source to the trash while apart → one trash row, and the device whose row was replaced takes the result', async () => {
      const both = await imp(mac.page, '양쪽에서 휴지통으로', '양쪽에서 지운 본문');
      await converged([mac, phone], 'fixture on both');
      offline(phone, true);
      await trash(phone.page, both.sourceId); await sleep(30); await trash(mac.page, both.sourceId); // the phone's row is the earlier one and is kept
      const rows = [];
      for (const item of [phone, mac]) rows.push((await snap(item.page)).bundle.links.find(link => link.kind === 'source_trash' && link.entityRefs[0].entityId === both.sourceId).id);
      assert.notEqual(rows[0], rows[1], 'each device made its own row');
      await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().data.links.some(link => link.id === rows[1]), 'mac stored its row');
      offline(phone, false);
      await converged([mac, phone], 'one trash row on both');
      for (const item of [mac, phone]) {
        const { bundle, sync } = await snap(item.page), states = bundle.links.filter(link => link.entityRefs?.[0]?.entityId === both.sourceId && /^source_(trash|active)$/.test(link.kind));
        assert.deepEqual(states.map(link => [link.id, link.kind]), [[rows[0], 'source_trash']], item.name);
        assert.equal(sync.error, null, item.name + ' took the merged row without an error');
      }
    });

    await check('CAS race: the server moves between this device\'s read and its upload → it reads again, merges and sends once more', async () => {
      const before = row().revision; let intercepted = 0;
      const handler = async route => {
        if (intercepted++ === 0) {
          await imp(mac.page, 'CAS 경합 중 맥 자료', '맥이 먼저 올린 본문');
          await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().revision === before + 1, 'mac stored first');
        }
        return route.fallback();
      };
      await phone.context.route('**/rest/v1/rpc/life_sync_put', handler);
      try {
        await imp(phone.page, 'CAS 경합 중 폰 자료', '폰이 늦게 올린 본문');
        await until(() => snap(phone.page), state => state.sync.status === 'synced' && row().revision === before + 2, 'phone merged and stored');
      } finally { await phone.context.unroute('**/rest/v1/rpc/life_sync_put', handler); }
      const writes = server.writes(owner, workspaceId).filter(request => request.device === 'phone').slice(-2).map(request => request.expected);
      assert.deepEqual(writes, [before, before + 1], 'refused against the old revision, stored against the merged-with one');
      await converged([mac, phone], 'both hold both race sources');
      assert.ok(['CAS 경합 중 맥 자료', 'CAS 경합 중 폰 자료'].every(title => row().data.sources.some(source => source.title === title)));
      assert.ok(!(await snap(phone.page)).seen.includes('conflict'));
    });

    await check('a reload after the merge was applied and before it was sent continues from the merged snapshot', async () => {
      const blocked = route => route.abort('failed');
      offline(phone, true);
      await imp(phone.page, '새로고침 전 폰 자료', '폰 본문');
      await imp(mac.page, '새로고침 전 맥 자료', '맥 본문');
      await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().data.sources.some(source => source.title === '새로고침 전 맥 자료'), 'mac stored');
      const revision = row().revision;
      await phone.context.route('**/rest/v1/rpc/life_sync_put', blocked); server.expectedFailures++;
      offline(phone, false);
      // Reads work, uploads do not: the phone merges locally and keeps the request for later.
      const merged = await until(async () => { await kick(phone.page); return snap(phone.page); },
        state => ['새로고침 전 폰 자료', '새로고침 전 맥 자료'].every(title => state.titles.includes(title)), 'merged on the phone', 40000, 500);
      assert.equal(merged.sync.conflict, null); assert.equal(row().revision, revision, 'nothing was stored yet');
      await phone.page.reload(); await ready(phone.page); await settle(phone.page);
      const reloaded = await snap(phone.page);
      assert.ok(['새로고침 전 폰 자료', '새로고침 전 맥 자료'].every(title => reloaded.titles.includes(title)), 'the merged snapshot survived the reload');
      assert.equal(reloaded.sync.conflict, null); assert.notEqual(reloaded.sync.status, 'synced');
      await phone.context.unroute('**/rest/v1/rpc/life_sync_put', blocked);
      await converged([mac, phone], 'sent after the reload');
      assert.equal(row().revision, revision + 1, 'one upload of the merged snapshot');
    });

    await check('a device without a stored base (diverged before this version) deletes nothing in its first merge', async () => {
      const fixture = await imp(mac.page, '기준 없는 병합', '기준 없는 병합의 본문', [{ start: 0, end: 5, topic: '기준 없음', note: '' }]);
      await converged([mac, phone], 'fixture on both');
      offline(phone, true);
      await phone.page.evaluate(workspaceId => new Promise((resolve, reject) => {
        const open = indexedDB.open('life-tools-v1');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => { const db = open.result, tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').delete('syncBase:' + workspaceId);
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
      }), workspaceId);
      await imp(phone.page, '기준 없이 폰에서 가져온 자료', '폰 본문');
      await removeRecord(mac.page, fixture.recordIds[0]);
      await imp(mac.page, '기준 없이 맥에서 가져온 자료', '맥 본문');
      await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().data.tombstones.some(mark => mark.entityId === fixture.recordIds[0]), 'mac stored its deletion');
      offline(phone, false);
      await converged([mac, phone], 'joined without a base');
      for (const item of [mac, phone]) {
        const { bundle, titles } = await snap(item.page);
        assert.ok(['기준 없이 폰에서 가져온 자료', '기준 없이 맥에서 가져온 자료'].every(title => titles.includes(title)), item.name);
        assert.ok(bundle.records.some(record => record.id === fixture.recordIds[0]), item.name + ': the excerpt this device still held is not deleted');
        assert.ok(!bundle.tombstones.some(mark => mark.entityId === fixture.recordIds[0]));
      }
    });

    await check('a difference recorded by the previous version is merged at the next run without a choice', async () => {
      offline(phone, true);
      await imp(phone.page, '이전 판이 기록한 충돌의 폰 자료', '폰 본문');
      await imp(mac.page, '이전 판이 기록한 충돌의 맥 자료', '맥 본문');
      await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().data.sources.some(source => source.title === '이전 판이 기록한 충돌의 맥 자료'), 'mac stored');
      // What the previous version left on a device: the recorded conflict with the server row.
      await phone.page.evaluate(async ({ workspaceId, row }) => {
        const s = HaedoLife.Shell.storage, state = await s.getSyncState(workspaceId);
        await s.setSyncConflict(workspaceId, state.binding, row);
      }, { workspaceId, row: { id: workspaceId, title: row().data.title, revision: row().revision, data: row().data } });
      assert.equal((await snap(phone.page)).sync.status, 'conflict');
      offline(phone, false);
      await converged([mac, phone], 'recorded conflict merged');
      assert.ok(['이전 판이 기록한 충돌의 폰 자료', '이전 판이 기록한 충돌의 맥 자료'].every(title => row().data.sources.some(source => source.title === title)));
    });

    await check('m1: typed, then hidden → the draft is sent while hidden, with a bounded number of requests', async () => {
      await phone.page.goto(base + '/index.html?section=records&view=write'); await ready(phone.page); await phone.page.locator('#lifeWritingBody').waitFor();
      await converged([mac, phone], 'idle before typing'); await sleep(3500); // a pass after opening has finished
      await phone.page.locator('#lifeWritingTitle').fill('숨기기 직전에 쓴 초안'); await phone.page.locator('#lifeWritingBody').fill('탭을 숨겨도 계정에 올라간다');
      await phone.page.waitForFunction(() => document.querySelector('#lifeWritingStatus')?.dataset.state === 'draft');
      const requests = []; const record = request => { if (request.url().includes('supabase.co')) requests.push(request.method() + ' ' + new URL(request.url()).pathname); };
      phone.page.on('request', record);
      await phone.page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const sent = () => [...server.drafts.values()].some(value => value.data.title === '숨기기 직전에 쓴 초안' && value.data.text === '탭을 숨겨도 계정에 올라간다');
      await until(async () => sent(), value => value, 'the hidden page sent its draft', 15000, 200);
      const afterSend = requests.length;
      await sleep(20000);
      phone.page.off('request', record);
      console.log('     hidden page: ' + afterSend + ' requests until the draft was stored, ' + (requests.length - afterSend) + ' in the following 20 s');
      assert.ok(afterSend <= 12, 'sending one draft from a hidden page took ' + afterSend + ' requests: ' + requests.slice(0, afterSend).join(', '));
      assert.ok(requests.length - afterSend <= 6, 'a hidden page with nothing to send stays quiet: ' + requests.slice(afterSend).join(', '));
      await phone.page.evaluate(() => { delete document.visibilityState; delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    });

    // ---- what is left for the person: the merge is not available (a page still on an older shared module) ----
    await check('when the merge is unavailable the difference is recorded: band, manual comparison and choice still work; an unrelated draft is sent meanwhile, a draft of an unsent original waits', async () => {
      const older = await device('older', { prepare: context => context.route(base + '/assets/life/sync-common.js', async route => {
        const response = await route.fetch(), body = await response.text(), changed = body.replace('canonical, mergeWorkspace, mergeBase,', 'canonical, mergeBase,');
        assert.notEqual(changed, body, 'the served module exports the merge'); return route.fulfill({ response, body: changed });
      }) });
      await converged([mac, older], 'third device synced');
      offline(older, true);
      const own = await imp(older.page, '아직 올라가지 않은 내 글', '서버에 없는 원문', [], { own: true });
      await imp(mac.page, '수동 비교의 맥 자료', '맥 본문');
      await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().data.sources.some(source => source.title === '수동 비교의 맥 자료'), 'mac stored');
      offline(older, false);
      const recorded = await until(async () => { await kick(older.page); return snap(older.page); }, state => state.sync.status === 'conflict', 'conflict recorded', 40000, 500);
      assert.equal(recorded.sync.conflict.missing, false);
      await older.page.locator('#lifeAccountStorage[data-state="conflict"]').waitFor();
      assert.ok(await older.page.locator('#lifeAccountStorageReview').isVisible(), 'the band offers the comparison');
      // Unrelated draft: sent while the originals stay in conflict. Draft of the unsent original: waits.
      const free = await draft(older.page, '충돌 중 새 초안', '원문과 무관한 초안은 올라간다');
      const bound = await draft(older.page, '아직 올라가지 않은 내 글', '서버에 없는 원문을 고친 초안', own.sourceId);
      await until(async () => { await kick(older.page); return server.draft(owner, workspaceId, free)?.data.text || null; }, value => value === '원문과 무관한 초안은 올라간다', 'unrelated draft on the server during the conflict', 40000, 500);
      assert.equal((await snap(older.page)).sync.status, 'conflict', 'the originals are still waiting for the choice');
      await sleep(6000); await kick(older.page); await sleep(2000);
      assert.equal(server.draft(owner, workspaceId, bound), undefined, 'a draft never precedes the original it points at');
      // The storage itself refuses it, whatever the engine asks.
      assert.equal(await older.page.evaluate(async ({ workspaceId, bound }) => {
        const s = HaedoLife.Shell.storage, binding = (await s.getSyncState(workspaceId)).binding;
        try { await s.bindWritingSync(workspaceId, bound, binding); return 'bound'; } catch (error) { return error.code; }
      }, { workspaceId, bound }), 'writing_source_pending');
      // Every later run tries the merge again, without announcing the same recorded difference again.
      const announced = await older.page.evaluate(() => __merge.changes);
      for (let n = 0; n < 3; n++) { await kick(older.page); await sleep(1500); }
      assert.equal(await older.page.evaluate(() => __merge.changes), announced, 'the recorded difference was announced again');
      // The manual comparison still resolves it.
      await older.page.locator('#lifeAccountStorageReview').click(); await settle(older.page);
      await older.page.getByRole('button', { name: '양쪽 자료 비교', exact: true }).click(); await settle(older.page);
      assert.ok(await older.page.locator('#lifeSyncConflict .life-conflict-content').count() >= 2);
      await older.page.getByRole('button', { name: '내 변경 보내기 · 서버 변경은 사본 보관', exact: true }).click(); await settle(older.page);
      await until(async () => { await kick(older.page); return snap(older.page); }, state => state.sync.status === 'synced' && !state.sync.conflict, 'resolved by hand', 40000, 500);
      assert.ok(row().data.sources.some(source => source.id === own.sourceId), 'the chosen side was stored');
      await until(async () => { await kick(older.page); return server.draft(owner, workspaceId, bound)?.data.text || null; }, value => value === '서버에 없는 원문을 고친 초안', 'the dependent draft follows its original', 40000, 500);
      // The server copy this device did not choose is kept as a copy on it, and the other device receives the chosen snapshot.
      assert.ok((await older.page.evaluate(() => HaedoLife.Shell.storage.listWorkspaces())).length >= 2);
      await converged([mac], 'mac receives the chosen snapshot');
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
