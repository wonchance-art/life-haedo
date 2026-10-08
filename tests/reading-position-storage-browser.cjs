/* Local reading positions: actual IndexedDB and two Chromium tabs, anonymous
 * samples only. No Auth, remote endpoint, Apple hardware or operating data. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright } = require('./unified-home-browser.cjs');
const base = (process.env.BASE_URL || 'http://127.0.0.1:4184').replace(/\/$/, '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Local anonymous server required');
const harnessPath = '/__reading_position_storage__.html';
const harness = '<!doctype html><html lang="ko"><meta charset="utf-8"><title>읽기 위치 저장 검사</title><link rel="icon" href="data:,"><main>익명 로컬 저장 검사</main>' +
  ['vendor/idb/idb.js', 'assets/life/core.js', 'assets/life/storage.js'].map(file => `<script src="/${file}"></script>`).join('') + '</html>';
const owner = { projectUrl: 'https://reading-position-test.supabase.co', userId: '11111111-1111-4111-8111-111111111111' };
async function helpers(page, account = owner) {
  await page.evaluate(async account => {
    globalThis.S = HaedoLife.Storage.forAccount(account); globalThis.C = HaedoLife.Core; globalThis.events = [];
    await S.open();
    globalThis.errorCode = async action => { try { await action(); return 'unexpected_success'; } catch (error) { return error.code; } };
    globalThis.key = id => `readingPosition:${JSON.stringify([S.account.projectUrl, S.account.userId])}:${id}`;
    globalThis.importSource = async (id, input) => {
      const bundle = await S.read(id), prepared = await C.prepareImport(input, bundle);
      const result = await S.commitLocal({ workspaceId: id, baseRevision: bundle.revision, operationId: C.id(), changes: C.buildImportChanges(bundle, prepared) });
      if (result.status !== 'stored') throw Error('Anonymous fixture import failed');
      return { sourceId: prepared.source.id, sourceVersionId: prepared.version.id, offset: 0 };
    };
    globalThis.fixture = async () => {
      const bundle = await S.createWorkspace('익명 읽기 위치 검사');
      const position = await importSource(bundle.workspaceId, { origin: 'other', title: '같은 문장을 정확한 버전에서 다시 읽기',
        text: '한글🌱 원문을 읽다가 잠깐 다른 기록을 확인한다.\r\n돌아와도 이전 문장이 남아 있다.', coverage: 'partial' });
      S.subscribe(bundle.workspaceId, value => events.push(value));
      return { id: bundle.workspaceId, position };
    };
  }, account);
}
async function main() {
  const output = path.resolve(process.env.READING_POSITION_STORAGE_REPORT || '.local/reading-resume/storage-report.json');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ serviceWorkers: 'block' }), pages = [];
  const report = { capturedAt: new Date().toISOString(), browser: browser.version(), environment: 'Linux Chromium, actual IndexedDB/BroadcastChannel and anonymous local samples; no real Auth, remote writes or Apple hardware.', checks: [], consoleErrors: [], pageErrors: [], external: [] };
  async function open(account = owner) {
    const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push(event.text()); });
    await page.goto(base + harnessPath); await helpers(page, account); return page;
  }
  async function check(name, action) {
    if (process.env.READING_POSITION_STORAGE_TEST_MATCH && !new RegExp(process.env.READING_POSITION_STORAGE_TEST_MATCH).test(name)) return;
    try { const evidence = await action(); report.checks.push({ name, pass: true, evidence }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
  }
  try {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) { report.external.push(url.origin); return route.abort('blockedbyclient'); }
      if (url.pathname === harnessPath) return route.fulfill({ contentType: 'text/html', body: harness });
      return route.continue();
    });
    const first = await open(), second = await open();
    await check('one local position survives reload; caller mutation cannot alter the saved row', async () => {
      const f = await first.evaluate(async () => {
        const f = await fixture(), initial = await S.readReadingPosition(f.id);
        const saved = await S.saveReadingPosition(f.id, f.position, initial.revision);
        saved.state.position.offset = 4000;
        return { ...f, initial, state: await S.readReadingPosition(f.id) };
      });
      assert.deepEqual(f.initial, { revision: 0, position: null, status: 'empty' });
      assert.equal(f.state.revision, 1); assert.equal(f.state.status, 'available'); assert.equal(f.state.position.offset, 0);
      assert.equal(f.state.position.updatedAt, new Date(f.state.position.updatedAt).toISOString());
      await first.reload(); await helpers(first);
      assert.deepEqual(await first.evaluate(id => S.readReadingPosition(id), f.id), f.state);
      const r = await first.evaluate(async f => {
        await S.saveReadingPosition(f.id, { ...f.position, offset: 4 }, 1);
        const db = await idb.openDB('life-tools-v1', 1), rows = (await db.getAll('meta')).filter(row => row.key === key(f.id)); db.close();
        return { rows: rows.length, keys: Object.keys(rows[0].value.position).sort() };
      }, f);
      assert.deepEqual(r, { rows: 1, keys: ['offset', 'sourceId', 'sourceVersionId', 'updatedAt'] });
      return { reloadPreserved: true, metadataRows: 1, savedContentOrHistory: false };
    });
    await check('a new source head leaves the exact old version and UTF-16 end position intact', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(), original = await S.read(f.id), text = original.sourceVersions[0].contentText;
        const position = { ...f.position, offset: text.length };
        await S.saveReadingPosition(f.id, position, 0);
        const newer = await importSource(f.id, { origin: 'other', title: '새 제목', text: '새 버전의 짧은 본문', existingSourceId: f.position.sourceId, coverage: 'full_text' });
        return { state: await S.readReadingPosition(f.id), old: position, newer, versionCount: (await S.read(f.id)).sourceVersions.length };
      });
      assert.equal(r.versionCount, 2); assert.notEqual(r.old.sourceVersionId, r.newer.sourceVersionId);
      assert.equal(r.state.status, 'available'); assert.equal(r.state.position.sourceVersionId, r.old.sourceVersionId); assert.equal(r.state.position.offset, r.old.offset);
      return { exactOldVersionPreserved: true, utf16EndAllowed: true, latestFallback: false };
    });
    await check('invalid offsets, split surrogate pairs, missing pairs and link-only sources cannot be stored', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(), text = (await S.read(f.id)).sourceVersions[0].contentText, codes = [];
        for (const offset of [-1, 1.5, NaN, text.length + 1, text.indexOf('🌱') + 1]) codes.push(await errorCode(() => S.saveReadingPosition(f.id, { ...f.position, offset }, 0)));
        codes.push(await errorCode(() => S.saveReadingPosition(f.id, { ...f.position, updatedAt: new Date().toISOString() }, 0)));
        codes.push(await errorCode(() => S.saveReadingPosition(f.id, { ...f.position, sourceId: C.id() }, 0)));
        codes.push(await errorCode(() => S.saveReadingPosition(f.id, { ...f.position, sourceVersionId: C.id() }, 0)));
        const link = await importSource(f.id, { origin: 'other', title: '본문 없는 링크', url: 'https://example.invalid/reading-source', coverage: 'link_only' });
        codes.push(await errorCode(() => S.saveReadingPosition(f.id, link, 0)));
        const foreign = await fixture(); codes.push(await errorCode(() => S.saveReadingPosition(f.id, foreign.position, 0)));
        return { codes, state: await S.readReadingPosition(f.id) };
      });
      assert.deepEqual(r.codes, [...Array(6).fill('reading_position_invalid'), ...Array(4).fill('reading_position_unavailable')]);
      assert.deepEqual(r.state, { revision: 0, position: null, status: 'empty' });
      return { rejectedInvalidCandidates: r.codes.length, metadataWritten: false };
    });
    await check('clearing an empty position stores a revision tombstone that rejects delayed revision-zero captures', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(), clear = await S.clearReadingPosition(f.id, 0), stale = await S.saveReadingPosition(f.id, f.position, 0);
        const next = await S.clearReadingPosition(f.id, 1);
        return { clear, stale, next, state: await S.readReadingPosition(f.id) };
      });
      assert.deepEqual(r.clear, { status: 'stored', state: { revision: 1, position: null, status: 'empty' } });
      assert.deepEqual(r.stale, { status: 'conflict', state: r.clear.state });
      assert.deepEqual(r.next, { status: 'stored', state: { revision: 2, position: null, status: 'empty' } }); assert.deepEqual(r.state, r.next.state);
      return { emptyClearRevision: 1, repeatedClearRevision: 2, staleResurrection: false };
    });
    await check('two tabs saving from the same revision have exactly one winner', async () => {
      const f = await first.evaluate(() => fixture());
      const results = await Promise.all([first, second].map((page, index) => page.evaluate(({ f, offset }) => S.saveReadingPosition(f.id, { ...f.position, offset }, 0), { f, offset: index ? 4 : 0 })));
      assert.equal(results.filter(value => value.status === 'stored').length, 1); assert.equal(results.filter(value => value.status === 'conflict').length, 1);
      const states = await Promise.all([first, second].map(page => page.evaluate(id => S.readReadingPosition(id), f.id)));
      assert.deepEqual(states[0], states[1]); assert.equal(states[0].revision, 1); assert.deepEqual(results.find(value => value.status === 'stored').state, states[0]);
      return { winningWrites: 1, conflictingWrites: 1, samePersistedState: true };
    });
    await check('another tab clear and newer save both reject a delayed older candidate without rebasing', async () => {
      const f = await first.evaluate(async () => { const f = await fixture(); await S.saveReadingPosition(f.id, f.position, 0); return f; });
      const cleared = await second.evaluate(id => S.clearReadingPosition(id, 1), f.id);
      const afterClear = await first.evaluate(f => S.saveReadingPosition(f.id, f.position, 1), f);
      assert.equal(afterClear.status, 'conflict'); assert.deepEqual(afterClear.state, cleared.state);
      const newer = await second.evaluate(f => S.saveReadingPosition(f.id, { ...f.position, offset: 4 }, 2), f);
      const afterNewer = await first.evaluate(f => S.saveReadingPosition(f.id, f.position, 1), f);
      assert.equal(afterNewer.status, 'conflict'); assert.deepEqual(afterNewer.state, newer.state);
      assert.deepEqual(await first.evaluate(id => S.readReadingPosition(id), f.id), newer.state);
      return { staleAfterClearRejected: true, newerOtherTabPreserved: true, automaticRetry: false };
    });
    await check('a removed exact version remains unavailable until explicit clear; newer text is never substituted', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(); await S.saveReadingPosition(f.id, f.position, 0);
        await importSource(f.id, { origin: 'other', title: '남아 있는 최신 원문', text: '이 버전으로 자동 이동하면 안 된다.', existingSourceId: f.position.sourceId });
        const db = await idb.openDB('life-tools-v1', 1), bundle = await db.get('bundles', f.id);
        bundle.sourceVersions = bundle.sourceVersions.filter(value => value.id !== f.position.sourceVersionId); C.validateWorkspace(bundle);
        await db.put('bundles', bundle); const before = await db.get('meta', key(f.id));
        const state = await S.readReadingPosition(f.id), rejected = await errorCode(() => S.saveReadingPosition(f.id, f.position, 1)), after = await db.get('meta', key(f.id)); db.close();
        const cleared = await S.clearReadingPosition(f.id, 1); return { state, rejected, before, after, cleared, old: f.position };
      });
      assert.equal(r.state.status, 'unavailable'); assert.equal(r.state.position.sourceVersionId, r.old.sourceVersionId); assert.deepEqual(r.before, r.after);
      assert.equal(r.rejected, 'reading_position_unavailable'); assert.deepEqual(r.cleared.state, { revision: 2, position: null, status: 'empty' });
      return { danglingPositionRetained: true, unavailableWithoutMutation: true, explicitClearWorks: true };
    });
    await check('positions are isolated by account, project and workspace; unscoped access is rejected', async () => {
      const f = await first.evaluate(async () => { const f = await fixture(); await S.saveReadingPosition(f.id, f.position, 0); return f; });
      for (const account of [{ ...owner, userId: '22222222-2222-4222-8222-222222222222' }, { ...owner, projectUrl: 'https://other-reading-position-test.supabase.co' }]) {
        const foreign = await open(account);
        const codes = await foreign.evaluate(async f => Promise.all([() => S.readReadingPosition(f.id), () => S.saveReadingPosition(f.id, f.position, 0), () => S.clearReadingPosition(f.id, 0)].map(errorCode)), f);
        assert.deepEqual(codes, Array(3).fill('workspace_access_denied'));
      }
      const r = await first.evaluate(async f => {
        const unscoped = HaedoLife.Storage, codes = await Promise.all([() => unscoped.readReadingPosition(f.id), () => unscoped.saveReadingPosition(f.id, f.position, 0), () => unscoped.clearReadingPosition(f.id, 0)].map(errorCode));
        const other = await fixture(), initialOther = await S.readReadingPosition(other.id); await S.saveReadingPosition(other.id, { ...other.position, offset: 4 }, 0);
        return { codes, initialOther, original: await S.readReadingPosition(f.id), other: await S.readReadingPosition(other.id) };
      }, f);
      assert.deepEqual(r.codes, Array(3).fill('auth_scope_required')); assert.deepEqual(r.initialOther, { revision: 0, position: null, status: 'empty' });
      assert.notEqual(r.original.position.sourceId, r.other.position.sourceId); assert.equal(r.original.position.offset, 0); assert.equal(r.other.position.offset, 4);
      return { foreignOperationsRejected: 6, unscopedOperationsRejected: 3, workspacePositionsIndependent: true };
    });
    await check('scope disposal aborts a pending write and its old handle cannot read, save or clear', async () => {
      const closing = await open();
      const r = await closing.evaluate(async () => {
        const f = await fixture(), original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...args) {
          const request = original.call(this, value, ...args);
          if (this.name === 'meta' && value?.key === key(f.id)) S.dispose();
          return request;
        };
        let pending; try { pending = await errorCode(() => S.saveReadingPosition(f.id, f.position, 0)); } finally { IDBObjectStore.prototype.put = original; }
        const codes = await Promise.all([() => S.readReadingPosition(f.id), () => S.saveReadingPosition(f.id, f.position, 0), () => S.clearReadingPosition(f.id, 0)].map(errorCode));
        return { f, pending, codes };
      });
      assert.equal(r.pending, 'storage_scope_closed'); assert.deepEqual(r.codes, Array(3).fill('storage_scope_closed'));
      assert.deepEqual(await second.evaluate(id => S.readReadingPosition(id), r.f.id), { revision: 0, position: null, status: 'empty' });
      return { pendingWriteAborted: true, disposedOperationsRejected: 3, partialPositionWritten: false };
    });
    await check('quota aborts roll back both save and clear without advancing revision or publishing success', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(); await S.saveReadingPosition(f.id, f.position, 0);
        const before = await S.readReadingPosition(f.id), notified = events.filter(value => value.type === 'reading_position_changed').length, original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...args) {
          if (this.name === 'meta' && value?.key === key(f.id)) { this.transaction.abort(); throw new DOMException('Anonymous quota abort', 'QuotaExceededError'); }
          return original.call(this, value, ...args);
        };
        let codes; try { codes = [await errorCode(() => S.saveReadingPosition(f.id, { ...f.position, offset: 4 }, 1)), await errorCode(() => S.clearReadingPosition(f.id, 1))]; }
        finally { IDBObjectStore.prototype.put = original; }
        return { codes, before, after: await S.readReadingPosition(f.id), notified, afterNotified: events.filter(value => value.type === 'reading_position_changed').length };
      });
      assert.deepEqual(r.codes, ['storage_quota', 'storage_quota']); assert.deepEqual(r.after, r.before); assert.equal(r.notified, r.afterNotified);
      return { failedSaveAndClearRolledBack: true, falseSuccessEvents: 0 };
    });
    await check('save and clear preserve source revisions, pending sync payload, exports and restored-copy isolation', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(), binding = { ...S.account, remoteId: f.id }; await S.bindSync(f.id, binding); await S.prepareSyncUpload(f.id, binding);
        const bundle = await S.read(f.id), before = { bundle: JSON.stringify(bundle), sync: JSON.stringify(await S.getSyncState(f.id)), markdown: C.toMarkdown(bundle), backup: C.makeBackup(bundle) };
        await S.saveReadingPosition(f.id, f.position, 0); await S.clearReadingPosition(f.id, 1);
        const afterBundle = await S.read(f.id), afterBackup = C.makeBackup(afterBundle); afterBackup.exportedAt = before.backup.exportedAt;
        const copy = await C.restoreBackup(before.backup); await S.installWorkspace(copy);
        return { bundleUnchanged: before.bundle === JSON.stringify(afterBundle), syncUnchanged: before.sync === JSON.stringify(await S.getSyncState(f.id)),
          markdownUnchanged: before.markdown === C.toMarkdown(afterBundle), backupUnchanged: JSON.stringify(before.backup) === JSON.stringify(afterBackup),
          copiedPosition: await S.readReadingPosition(copy.workspaceId), readingHints: afterBundle.resumeHints.length };
      });
      assert.deepEqual(r, { bundleUnchanged: true, syncUnchanged: true, markdownUnchanged: true, backupUnchanged: true, copiedPosition: { revision: 0, position: null, status: 'empty' }, readingHints: 0 });
      return { bundleAndOutboxByteUnchanged: true, backupPayloadUnchangedExceptExportTime: true, restoredCopyHasNoPosition: true };
    });
    await check('account-scoped notifications contain revision only and other tabs re-read the authoritative state', async () => {
      const f = await first.evaluate(() => fixture());
      await second.evaluate(id => S.subscribe(id, value => events.push(value)), f.id);
      const saved = await first.evaluate(f => S.saveReadingPosition(f.id, f.position, 0), f);
      await second.waitForFunction(id => events.some(value => value.type === 'reading_position_changed' && value.workspaceId === id && value.revision === 1), f.id);
      const r = await second.evaluate(async id => ({ event: events.find(value => value.type === 'reading_position_changed' && value.workspaceId === id), state: await S.readReadingPosition(id) }), f.id);
      assert.deepEqual(r.event, { type: 'reading_position_changed', workspaceId: f.id, revision: 1 }); assert.deepEqual(r.state, saved.state);
      return { broadcastReceived: true, leakedContentOrPosition: false };
    });
    await check('unknown metadata formats and content-bearing fields are rejected without overwriting their row', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(); await S.saveReadingPosition(f.id, f.position, 0);
        const db = await idb.openDB('life-tools-v1', 1), original = await db.get('meta', key(f.id)), codes = [], unchanged = [];
        for (const corrupt of [{ ...original.value, format: 'life-reading-position-future' }, { ...original.value, position: { ...original.value.position, text: '저장해서는 안 되는 원문 사본' } }]) {
          const row = { key: key(f.id), value: corrupt }; await db.put('meta', row);
          codes.push(await errorCode(() => S.readReadingPosition(f.id)), await errorCode(() => S.saveReadingPosition(f.id, f.position, 1)), await errorCode(() => S.clearReadingPosition(f.id, 1)));
          unchanged.push(JSON.stringify(row) === JSON.stringify(await db.get('meta', key(f.id))));
        }
        await db.put('meta', original); db.close(); return { codes, unchanged };
      });
      assert.deepEqual(r.codes, Array(6).fill('reading_position_invalid')); assert.deepEqual(r.unchanged, [true, true]);
      return { invalidMetadataOperationsRejected: 6, corruptRowsSilentlyOverwritten: false };
    });
  } finally {
    await Promise.all(pages.map(page => page.evaluate(() => { S?.dispose(); HaedoLife.Storage.dispose(); }).catch(() => {})));
    await context.close(); await browser.close();
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
  console.log(`Reading position storage: ${report.checks.filter(value => value.pass).length}/${report.checks.length}; actual IndexedDB, no remote writes.`);
  if (report.checks.some(value => !value.pass)) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
