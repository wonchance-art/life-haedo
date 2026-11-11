/* Originals merge between devices: isolated Chromium contexts ("devices") of one anonymous
 * account, the bundled SDK, the real application and IndexedDB against the tests' FakeCloud.
 * Not evidence for the production database, RLS or Apple hardware.
 * What still reaches the manual comparison by its real cause (16 MiB, text the server refuses,
 * a deleted server copy) is in tests/source-merge-limits-browser.cjs: megabytes, minutes.
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
const { FILES: PREVIOUS_FILES, previousFile } = require('./helpers/previous-version.cjs');
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
    notice: typeof s.getSyncNotice === 'function' ? await s.getSyncNotice(w) : null, seen: [...(window.__merge?.statuses || [])], band: [...(window.__merge?.band || [])] };
});
const content = bundle => JSON.stringify({ ...bundle, revision: 0 });
const kick = page => page.evaluate(() => { dispatchEvent(new Event('online')); dispatchEvent(new Event('focus')); });
// The same without the workspace itself (for a library of many megabytes).
const light = page => page.evaluate(async () => {
  const s = HaedoLife.Shell.storage, w = await s.getActive(), b = await s.read(w), state = await HaedoLife.Shell.sync.getState(w);
  return { status: state.status, conflict: state.conflict ? { missing: state.conflict.missing } : null, error: state.error?.code || null, sources: b.sources.length, revision: b.revision };
});
// This device's database, read and changed behind the application (what an earlier version left, or did not leave).
//   base: the stored merge base (its revision and size) · dropBase: remove it · dropAll: remove it and every commit receipt.
const idb = (page, action, workspaceId) => page.evaluate(({ action, workspaceId }) => new Promise((resolve, reject) => {
  const open = indexedDB.open('life-tools-v1');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result, tx = db.transaction(['meta', 'operations'], action === 'base' ? 'readonly' : 'readwrite'), meta = tx.objectStore('meta'); let value = null;
    if (action === 'base') meta.get('syncBase:' + workspaceId).onsuccess = event => { const stored = event.target.result?.value; value = stored ? { remoteRevision: stored.remoteRevision, records: stored.base.records.length } : null; };
    else meta.delete('syncBase:' + workspaceId);
    if (action === 'dropAll') tx.objectStore('operations').delete(IDBKeyRange.bound([workspaceId], [workspaceId, []]));
    tx.oncomplete = () => { db.close(); resolve(value); }; tx.onerror = () => reject(tx.error);
  };
}), { action, workspaceId });
// One device: an isolated context of the anonymous account on `cloud`, with the records screen open.
async function openDevice(browser, cloud, name, { viewport = { width: 1280, height: 900 }, prepare = null } = {}) {
  const context = await makeContext(browser, cloud, name, accounts.a, { viewport });
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
  return { name, context, page, errors };
}
// Every device of the list holds exactly the server snapshot `read()` returns, synced, with no difference recorded.
async function convergedOn(list, label, read) {
  await until(async () => {
    for (const item of list) await kick(item.page);
    const states = []; for (const item of list) states.push(await snap(item.page));
    return states;
  }, states => states.every(state => state.sync.status === 'synced' && !state.sync.conflict && content(state.bundle) === content(read().data)), label, 60000, 500);
}

async function main() {
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const server = new FakeCloud().enableAccountLibrary();
  const devices = [];
  const device = async (name, options = {}) => { const entry = await openDevice(browser, server, name, options); devices.push(entry); return entry; };
  const row = () => server.row(owner, workspaceId);
  let workspaceId;
  const converged = (list, label) => convergedOn(list, label, row);
  const offline = (item, on) => { if (on) server.offline.add(item.name); else server.offline.delete(item.name); };
  const acknowledge = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage; await s.dismissSyncNotice(await s.getActive()); });
  const records = async page => { await page.goto(base + '/index.html?section=records'); await ready(page); await settle(page); };
  const syncView = async page => { await page.goto(base + '/index.html?section=manage&view=sync'); await ready(page); await settle(page); };

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
      const earlier = await imp(mac.page, '맥에서 고친 제목', '맥에서 고친 본문', [], { sourceId: shared.sourceId });
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
        // The title that lost is kept on every device, on the exact version its device saved.
        assert.deepEqual(bundle.links.filter(link => link.kind === 'source_previous_title').map(link => [link.note, link.sourceRefs[0].sourceVersionId]), [['맥에서 고친 제목', earlier.versionId]], item.name);
      }
      assert.deepEqual((await snap(phone.page)).notice?.sourceIds, [shared.sourceId], 'the merging device keeps a notice');
      // The notice names the source, leads to the earlier version and stays until acknowledged, also after a reload.
      await syncView(phone.page);
      const notice = phone.page.locator('#lifeSyncMergeNotice'); await notice.waitFor();
      assert.match(await notice.innerText(), /나중에 고친 쪽이 현재 버전이고, 먼저 고친 본문은 이전 버전으로 남았습니다/);
      const open = notice.locator('[data-merge-source="' + shared.sourceId + '"]');
      assert.equal((await open.innerText()).trim(), '폰에서 나중에 고친 제목 · 이전 버전 열기');
      for (const [width, height] of [[390, 844], [820, 1000], [1440, 900]]) {
        await phone.page.setViewportSize({ width, height }); await settle(phone.page);
        assert.ok(await notice.isVisible());
        assert.ok(await open.evaluate(control => control.getBoundingClientRect().height) >= 44, 'the link to the earlier version is at least 44px tall at ' + width);
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
      // The link opens the exact earlier version, which says what the other device had called the source.
      const kept = '이 버전을 보관한 기기에서의 제목: 맥에서 고친 제목';
      await open.click(); await phone.page.locator('#lifeSourceText').waitFor();
      assert.match(await phone.page.locator('#lifeSourceText').innerText(), /맥에서 고친 본문/);
      assert.equal((await phone.page.locator('[data-previous="source_previous_title"]').innerText()).trim(), kept);
      assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no horizontal overflow in the earlier version');
      await phone.page.screenshot({ path: path.join(out, 'earlier-version-390.png'), fullPage: true });
      // Reading it does not acknowledge the notice.
      await syncView(phone.page); await notice.waitFor();
      await phone.page.locator('#lifeSyncMergeNoticeDone').click();
      await notice.waitFor({ state: 'detached' });
      await phone.page.reload(); await ready(phone.page); await settle(phone.page);
      assert.equal(await phone.page.locator('#lifeSyncMergeNotice').count(), 0); assert.equal((await snap(phone.page)).notice, null);
      // The device that did not merge has no notice; the same line is on the earlier version there.
      assert.equal((await snap(mac.page)).notice, null);
      await mac.page.goto(base + '/index.html?section=records&view=sources'); await ready(mac.page); await settle(mac.page);
      await mac.page.locator('.life-source-card[data-source-id="' + shared.sourceId + '"] .life-source-open').first().click(); await mac.page.locator('#lifeSourceText').waitFor();
      await mac.page.locator('#lifeVersion').selectOption(earlier.versionId);
      await mac.page.locator('[data-previous="source_previous_title"]').waitFor();
      assert.equal((await mac.page.locator('[data-previous="source_previous_title"]').innerText()).trim(), kept);
      await records(mac.page); await records(phone.page);
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
      // The merging device's notice leads to the copy, with the topic as it is really named.
      assert.equal((await snap(phone.page)).notice?.recordIds.length, 1);
      await syncView(phone.page);
      const notice = phone.page.locator('#lifeSyncMergeNotice'); await notice.waitFor();
      assert.ok((await notice.innerText()).includes('먼저 고친 발췌 1개는 주제 이름 앞에 ‘복구 사본’이 붙어 있습니다(예: 복구 사본 · 주제)'), await notice.innerText());
      assert.ok(await phone.page.locator('#lifeSyncMergeCopies').evaluate(control => control.getBoundingClientRect().height) >= 44);
      await phone.page.locator('#lifeSyncMergeCopies').click();
      await phone.page.locator('[data-topic-kind="recovery"][aria-pressed="true"]').waitFor();
      assert.match(await phone.page.locator('#lifeSearchCount').innerText(), /발췌 1개 · 복구 사본/);
      assert.deepEqual(await phone.page.locator('.life-excerpt-card .life-note').allInnerTexts(), ['맥에서 고친 메모']);
      assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no horizontal overflow in the copies');
      await phone.page.screenshot({ path: path.join(out, 'recovery-copies-390.png'), fullPage: true });
      await syncView(phone.page); await phone.page.locator('#lifeSyncMergeNoticeDone').click(); await notice.waitFor({ state: 'detached' });
      // Every device finds them under one filter, also the one that did not merge and has no notice.
      await mac.page.goto(base + '/index.html?section=records&view=sources'); await ready(mac.page); await settle(mac.page);
      await mac.page.getByRole('button', { name: '검색 필터', exact: true }).click();
      await mac.page.getByRole('button', { name: '저장한 문장 주제로 찾기', exact: true }).click();
      await mac.page.locator('#lifeSearchCount').waitFor();
      const filter = mac.page.locator('[data-topic-kind="recovery"]');
      if (!await filter.isVisible()) await mac.page.getByRole('button', { name: '검색 필터', exact: true }).click();
      await filter.waitFor();
      assert.equal(await filter.getAttribute('aria-label'), '복구 사본'); await filter.click();
      await mac.page.locator('[data-topic-kind="recovery"][aria-pressed="true"]').waitFor();
      assert.deepEqual(await mac.page.locator('.life-excerpt-card .life-note').allInnerTexts(), ['맥에서 고친 메모']);
      await records(mac.page); await records(phone.page);
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
      // The device that merged says which deletion did not stand.
      const notice = (await snap(phone.page)).notice;
      assert.deepEqual([notice.restoredIds, notice.recordIds, notice.uncertain], [[kept.recordIds[0]], [], false]);
      await syncView(phone.page);
      assert.match(await phone.page.locator('#lifeSyncMergeNotice').innerText(), /한 기기에서 지운 발췌 1개는 .* 남겼습니다/);
      await phone.page.locator('#lifeSyncMergeNoticeDone').click(); await phone.page.locator('#lifeSyncMergeNotice').waitFor({ state: 'detached' });
      await records(phone.page);
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

    // ---- a device that carries data from before this version: no stored merge base ----
    await check('no stored base, equal to the server: the base is kept when the page opens and again before the first change → a deletion made elsewhere stands', async () => {
      await acknowledge(phone.page);
      const fixture = await imp(mac.page, '기준을 지키는 병합', '기준을 지키는 병합의 본문', [{ start: 0, end: 3, topic: '기준', note: '' }, { start: 4, end: 7, topic: '기준', note: '' }]);
      await converged([mac, phone], 'fixture on both');
      // As after an update while synced: no base record.
      await idb(phone.page, 'dropBase', workspaceId);
      assert.equal(await idb(phone.page, 'base', workspaceId), null);
      await phone.page.reload(); await ready(phone.page); await settle(phone.page);
      const kept = await until(() => idb(phone.page, 'base', workspaceId), value => value !== null, 'the page kept the base when it opened', 20000);
      assert.equal(kept.remoteRevision, row().revision);
      // And when the page had already looked: in the transaction of the first change.
      offline(phone, true);
      await idb(phone.page, 'dropBase', workspaceId);
      await imp(phone.page, '기준을 지킨 뒤 폰에서 가져온 자료', '폰 본문');
      assert.deepEqual(await idb(phone.page, 'base', workspaceId), kept, 'the snapshot from before the change');
      await removeRecord(mac.page, fixture.recordIds[0]);
      await imp(mac.page, '기준을 지킨 뒤 맥에서 가져온 자료', '맥 본문');
      await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().data.tombstones.some(mark => mark.entityId === fixture.recordIds[0]), 'mac stored its deletion');
      offline(phone, false);
      await converged([mac, phone], 'merged with the kept base');
      for (const item of [mac, phone]) {
        const { bundle, titles } = await snap(item.page);
        assert.ok(['기준을 지킨 뒤 폰에서 가져온 자료', '기준을 지킨 뒤 맥에서 가져온 자료'].every(title => titles.includes(title)), item.name);
        assert.equal(bundle.records.some(record => record.id === fixture.recordIds[0]), false, item.name + ': the deletion stands');
        assert.ok(bundle.tombstones.some(mark => mark.entityId === fixture.recordIds[0]) && bundle.records.some(record => record.id === fixture.recordIds[1]));
      }
      assert.equal((await snap(phone.page)).notice, null, 'nothing came back, nothing to announce');
    });

    await check('no stored base, already changed: the commit receipts decide → untouched items follow the server, both devices\' deletions stand, only the real double edit makes a 복구 사본', async () => {
      await acknowledge(phone.page);
      const fixture = await imp(mac.page, '영수증으로 합치는 자료', '가나다라마바사아자차카타파하거너더러머버', [0, 1, 2, 3, 4, 5].map(index => ({ start: index * 2, end: index * 2 + 2, topic: '영수증', note: '처음 ' + index })));
      await converged([mac, phone], 'fixture on both');
      const [a, b, c, d, e, f] = fixture.recordIds;
      offline(phone, true);
      await editNote(phone.page, a, '폰만 고친 메모'); await removeRecord(phone.page, b); await editNote(phone.page, e, '폰이 먼저 고친 메모');
      await imp(phone.page, '영수증으로 합칠 때 폰 자료', '폰 본문');
      // As if those changes had been made on the previous version, which kept no base.
      await idb(phone.page, 'dropBase', workspaceId); await sleep(30);
      await editNote(mac.page, c, '맥만 고친 메모'); await removeRecord(mac.page, d); await editNote(mac.page, e, '맥이 나중에 고친 메모');
      await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().data.tombstones.some(mark => mark.entityId === d), 'mac stored');
      offline(phone, false);
      await converged([mac, phone], 'merged by receipts');
      for (const item of [mac, phone]) {
        const { bundle } = await snap(item.page), note = id => bundle.records.find(record => record.id === id)?.note;
        assert.deepEqual([note(a), note(b), note(c), note(d), note(e), note(f)], ['폰만 고친 메모', undefined, '맥만 고친 메모', undefined, '맥이 나중에 고친 메모', '처음 5'], item.name);
        const marks = bundle.tombstones.map(mark => mark.entityId);
        assert.ok(marks.includes(b) && marks.includes(d), item.name + ': both deletions stand');
        const copies = bundle.records.filter(record => record.topic.startsWith('복구 사본') && record.sourceRefs[0].sourceVersionId === fixture.versionId);
        assert.deepEqual(copies.map(record => record.note), ['폰이 먼저 고친 메모'], item.name);
      }
      const notice = (await snap(phone.page)).notice;
      assert.deepEqual([notice.recordIds.length, notice.restoredIds, notice.uncertain], [1, [], false]);
      await acknowledge(phone.page);
    });

    await check('neither a base nor commit receipts: nothing is deleted, and the notice says what came back and that it could not tell', async () => {
      await acknowledge(phone.page);
      const fixture = await imp(mac.page, '확인할 수 없는 병합', '가나다라마바사아자차', [{ start: 0, end: 2, topic: '확인 불가', note: '처음 0' }, { start: 2, end: 4, topic: '확인 불가', note: '처음 1' }]);
      await converged([mac, phone], 'fixture on both');
      offline(phone, true);
      await imp(phone.page, '확인할 수 없을 때 폰 자료', '폰 본문');
      await idb(phone.page, 'dropAll', workspaceId); await sleep(30);
      await removeRecord(mac.page, fixture.recordIds[0]); await editNote(mac.page, fixture.recordIds[1], '맥에서 고친 메모');
      await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().data.tombstones.some(mark => mark.entityId === fixture.recordIds[0]), 'mac stored');
      offline(phone, false);
      await converged([mac, phone], 'joined without a base');
      let copy = null;
      for (const item of [mac, phone]) {
        const { bundle } = await snap(item.page), mine = bundle.records.filter(record => record.sourceRefs[0].sourceVersionId === fixture.versionId);
        assert.ok(mine.some(record => record.id === fixture.recordIds[0]) && !bundle.tombstones.some(mark => mark.entityId === fixture.recordIds[0]), item.name + ': the excerpt this device held is not deleted');
        assert.equal(mine.find(record => record.id === fixture.recordIds[1]).note, '맥에서 고친 메모', item.name);
        const copies = mine.filter(record => record.topic.startsWith('복구 사본'));
        assert.deepEqual(copies.map(record => [record.note, record.topic]), [['처음 1', '복구 사본 · 확인 불가']], item.name + ': the copy this device held, which may be the text before the edit');
        copy = copies[0].id;
      }
      const notice = (await snap(phone.page)).notice;
      assert.deepEqual([notice.restoredIds, notice.recordIds, notice.uncertain], [[fixture.recordIds[0]], [copy], true]);
      await syncView(phone.page);
      const text = await phone.page.locator('#lifeSyncMergeNotice').innerText();
      assert.match(text, /한 기기에서 지운 발췌 1개는 .* 남겼습니다/); assert.match(text, /무엇이 바뀌었는지 확인하지 못했습니다\. 지운 것은 지우지 않았고, 복구 사본 중에는 고치기 전 내용도 있습니다/);
      assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no horizontal overflow');
      await phone.page.screenshot({ path: path.join(out, 'merge-notice-uncertain-390.png'), fullPage: true });
      await phone.page.locator('#lifeSyncMergeNoticeDone').click(); await phone.page.locator('#lifeSyncMergeNotice').waitFor({ state: 'detached' });
      await records(phone.page);
    });

    await check('a device that changed its workspace on the real previous version, then loads this version: both devices\' deletions stand, nothing comes back, no 복구 사본', async () => {
      // The files the merge work changed, as commit a423773 served them (kept as fixtures; index.html and the other modules were the same).
      const files = new Map(Object.keys(PREVIOUS_FILES).map(name => [name, previousFile(name)]));
      const serve = async route => { const name = new URL(route.request().url()).pathname.split('/').pop(); return files.has(name) ? route.fulfill({ response: await route.fetch(), body: files.get(name) }) : route.fallback(); };
      const ipad = await device('ipad', { viewport: { width: 820, height: 1180 }, prepare: context => context.route(base + '/assets/life/*.js', serve) });
      assert.deepEqual(await ipad.page.evaluate(() => [typeof HaedoLife.SyncCommon.mergeWorkspace, typeof HaedoLife.Shell.storage.mergeSyncRemote]), ['undefined', 'undefined'], 'the page runs the previous version');
      const fixture = await imp(mac.page, '이전 판에서 갈라진 자료', '가나다라마바사아자차카타파하거너더러머버', Array.from({ length: 10 }, (_, index) => ({ start: index * 2, end: index * 2 + 2, topic: '이전 판', note: '처음 ' + index })));
      await converged([mac, ipad], 'the previous version holds the fixture');
      const ids = fixture.recordIds;
      offline(ipad, true);
      await editNote(ipad.page, ids[0], 'iPad에서 고친 메모'); await removeRecord(ipad.page, ids[1]);
      for (let index = 2; index <= 6; index++) await editNote(mac.page, ids[index], 'Mac에서 고친 메모 ' + index);
      await removeRecord(mac.page, ids[7]);
      await until(() => snap(mac.page), state => state.sync.status === 'synced' && row().data.tombstones.some(mark => mark.entityId === ids[7]), 'mac stored');
      offline(ipad, false);
      await until(async () => { await kick(ipad.page); return snap(ipad.page); }, state => state.sync.status === 'conflict', 'the previous version recorded the difference and waits', 40000, 500);
      assert.equal(await idb(ipad.page, 'base', workspaceId), null, 'the previous version kept no base');
      // The update arrives: the same device and database, this version's files.
      await ipad.context.unroute(base + '/assets/life/*.js', serve);
      await ipad.page.reload(); await ready(ipad.page); await settle(ipad.page);
      assert.equal(await ipad.page.evaluate(() => typeof HaedoLife.Shell.storage.mergeSyncRemote), 'function');
      await converged([mac, ipad], 'merged after the update');
      for (const item of [mac, ipad]) {
        const { bundle } = await snap(item.page), mine = bundle.records.filter(record => record.sourceRefs[0].sourceVersionId === fixture.versionId);
        assert.deepEqual(mine.map(record => record.note), ['iPad에서 고친 메모', 'Mac에서 고친 메모 2', 'Mac에서 고친 메모 3', 'Mac에서 고친 메모 4', 'Mac에서 고친 메모 5', 'Mac에서 고친 메모 6', '처음 8', '처음 9'], item.name);
        assert.equal(mine.filter(record => record.topic.startsWith('복구 사본')).length, 0, item.name);
        const marks = bundle.tombstones.map(mark => mark.entityId);
        assert.ok(marks.includes(ids[1]) && marks.includes(ids[7]), item.name + ': both deletions stand');
      }
      assert.equal((await snap(ipad.page)).notice, null);
      assert.deepEqual(ipad.errors.filter(text => !/ERR_INTERNET_DISCONNECTED|ERR_FAILED|net::ERR_/.test(text)), []);
      await ipad.context.close(); devices.splice(devices.indexOf(ipad), 1);
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
      // m3: another tab of this device saves a draft while this tab stays hidden. That tab sends its
      // own draft; the hidden tab makes no request for it.
      const other = await phone.context.newPage(); other.setDefaultTimeout(25000);
      await other.goto(base + '/index.html?section=records&view=write'); await ready(other); await other.locator('#lifeWritingBody').waitFor(); await sleep(4000);
      const quiet = []; const recordQuiet = request => { if (request.url().includes('supabase.co')) quiet.push(request.method() + ' ' + new URL(request.url()).pathname); };
      phone.page.on('request', recordQuiet);
      await other.locator('#lifeWritingTitle').fill('다른 탭에서 쓴 초안'); await other.locator('#lifeWritingBody').fill('다른 탭이 스스로 올린다');
      await until(async () => [...server.drafts.values()].some(value => value.data.text === '다른 탭이 스스로 올린다'), value => value, 'the other tab sent its own draft', 20000, 200);
      await other.locator('#lifeWritingBody').fill('다른 탭이 스스로 올린다 · 한 번 더');
      await until(async () => [...server.drafts.values()].some(value => value.data.text === '다른 탭이 스스로 올린다 · 한 번 더'), value => value, 'the other tab sent its second save', 20000, 200);
      await sleep(6000);
      phone.page.off('request', recordQuiet);
      console.log('     hidden tab while another tab saved a draft twice: ' + quiet.length + ' requests (' + quiet.filter(text => /life_writing_draft/.test(text)).length + ' for drafts)');
      assert.deepEqual(quiet.filter(text => /life_writing_draft/.test(text)), [], 'a hidden tab starts no draft run for another tab\'s save');
      await other.close();
      await phone.page.evaluate(() => { delete document.visibilityState; delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      // A page closed while it still reads "visible" (no visibilitychange first): pagehide is not an
      // upload. The platform suspends the session and blanks the private screen at that moment, so
      // nothing is sent with it; the draft stays on this device and the next page sends it.
      // The editor is opened again first: the other tab may have changed the draft this tab had open.
      await phone.page.goto(base + '/index.html?section=records&view=write'); await ready(phone.page); await phone.page.locator('#lifeWritingBody').waitFor(); await sleep(4000);
      const stored = () => [...server.drafts.values()].some(value => value.data.text === '닫는 순간에 고친 초안');
      const closing = []; const recordClosing = request => { if (request.url().includes('supabase.co')) closing.push(new URL(request.url()).pathname.split('/').pop()); };
      phone.page.on('request', recordClosing);
      await phone.page.evaluate(async () => {
        // Typed and closed at once: the save lands, and pagehide follows before any timer of the sync runs.
        const body = document.querySelector('#lifeWritingBody'); body.value = '닫는 순간에 고친 초안'; body.dispatchEvent(new Event('input', { bubbles: true }));
        for (let n = 0; n < 200 && document.querySelector('#lifeWritingStatus')?.dataset.state !== 'draft'; n++) await new Promise(resolve => setTimeout(resolve, 10));
        dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
      });
      await sleep(6000); phone.page.off('request', recordClosing);
      const atClose = closing.filter(name => /life_writing_draft/.test(name));
      console.log('     pagehide while visible with one unsent draft: ' + atClose.length + ' draft requests (' + closing.length + ' requests in all); stored on the server: ' + stored());
      assert.deepEqual(atClose, [], 'pagehide starts no draft upload');
      await phone.page.goto(base + '/index.html?section=records&view=write'); await ready(phone.page);
      await until(async () => stored(), value => value, 'the next page sent the draft that was left', 30000, 200);
      await records(phone.page);
    });

    // ---- what is left for the person: the merge is not available. The page still has the shared
    // module of the previous version (a cache that kept that one file during an update; the file is
    // commit a423773's, unchanged) next to this version's other modules. ----
    await check('when the merge is unavailable (the previous shared module) the difference is recorded: band, manual comparison and choice still work; an unrelated draft is sent meanwhile, a draft of an unsent original waits', async () => {
      const older = await device('older', { prepare: context => context.route(base + '/assets/life/sync-common.js', async route => route.fulfill({ response: await route.fetch(), body: previousFile('sync-common.js') })) });
      assert.deepEqual(await older.page.evaluate(() => [typeof HaedoLife.SyncCommon.mergeWorkspace, typeof HaedoLife.Shell.storage.mergeSyncRemote]), ['undefined', 'function']);
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
      for (let run = 0; run < 3; run++) assert.equal(await older.page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await HaedoLife.Shell.sync.syncNow(await s.getActive(), { headIfClean: true })).status; }), 'conflict');
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

    // ---- the account band under slow state reads (a library of megabytes, a slow device) ----
    await check('the account band shows a finished state read while events keep arriving: a slow read is not dropped for a newer one', async () => {
      // The page's account library is the real one; its state read is made slow and its listeners can be
      // called from here (as its own events do). Nothing in the application knows about this.
      const slow = await device('slow', { prepare: context => context.addInitScript(() => {
        const life = (window.HaedoLife ||= {}); let wrapped = null;
        Object.defineProperty(life, 'AccountLibrary', { configurable: true, get: () => wrapped, set(value) {
          window.__library = { listeners: new Set(), delay: 0, change: null, reads: 0 };
          wrapped = Object.freeze({ ...value, create(...args) {
            const library = value.create(...args);
            return Object.freeze({ ...library,
              subscribe(listener) { __library.listeners.add(listener); const off = library.subscribe(listener); return () => { __library.listeners.delete(listener); off(); }; },
              async getState(...rest) { __library.reads++; const state = await library.getState(...rest); if (__library.delay) await new Promise(resolve => setTimeout(resolve, __library.delay)); return __library.change ? __library.change(state) : state; } });
          } });
        } });
      }) });
      await converged([mac, slow], 'the device is synced');
      await slow.page.locator('#lifeAccountStorage[data-state="synced"]').waitFor();
      const seen = await slow.page.evaluate(async () => {
        const band = document.querySelector('#lifeAccountStorage'), wait = ms => new Promise(resolve => setTimeout(resolve, ms)), states = [];
        const announce = () => { for (const listener of [...__library.listeners]) listener({ type: 'state' }); };
        // Every read now takes 400 ms and reports another state; an event arrives every 100 ms.
        __library.delay = 400; __library.change = state => ({ ...state, status: 'pending' });
        const reads = __library.reads, storm = setInterval(announce, 100);
        await wait(2500); states.push(band.dataset.state, __library.reads - reads);      // the events are still arriving
        clearInterval(storm); __library.delay = 0; __library.change = null; announce();
        await wait(1500); states.push(band.dataset.state);
        return states;
      });
      assert.equal(seen[0], 'pending', 'a read that finished is shown although newer events had arrived');
      assert.ok(seen[1] >= 3 && seen[1] <= 8, 'one read at a time (25 events in 2.5 s): ' + seen[1]);
      assert.equal(seen[2], 'synced', 'and the last event is followed by a read of its own');
      await slow.context.close(); devices.splice(devices.indexOf(slow), 1);
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
module.exports = { sleep, until, imp, editNote, snap, light, kick, content, openDevice, convergedOn };
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
