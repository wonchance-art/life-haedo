/* Two isolated browsers, bundled SDK and real IndexedDB; anonymous HTTP only.
 * BASE_URL=http://127.0.0.1:4184 node tests/composition-sync-browser.cjs
 * COMPOSITION_TEST_MATCH limits scenarios. No production/Apple-device claims. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
process.env.PW_MODULE_PATH ||= process.env.PLAYWRIGHT_MODULE || '';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext } = require('./unified-home-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = process.env.COMPOSITION_REPORT_DIR ? path.resolve(process.env.COMPOSITION_REPORT_DIR) : path.resolve(__dirname, '../.local/composition-sync');
const copy = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };

class CompositionCloud extends FakeCloud {
  constructor() { super(); this.compositions = new Map(); this.compositionReceipts = new Map(); this.compositionMissing = false; this.compositionOffline = new Set(); this.loseComposition = new Set(); this.heldComposition = null; }
  composition(owner, id) { return this.compositions.get(this.key(owner, id)); }
  compositionWrites(device) { return this.requests.filter(value => value.kind === 'composition-write' && (!device || value.device === device)); }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url());
    if (!['/rest/v1/rpc/life_composition_get', '/rest/v1/rpc/life_composition_put'].includes(url.pathname)) return super.handle(route, device);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-type': 'application/json' };
    const send = (body, status = 200) => route.fulfill({ status, headers, body: status === 204 ? '' : JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return send(null, 204);
    if (this.offline.has(device) || this.compositionOffline.has(device)) { this.expectedFailures++; return route.abort('internetdisconnected'); }
    let account;
    try { const token = request.headers().authorization.replace(/^Bearer /i, ''), payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); account = Object.values(accounts).find(value => value.id === payload.sub); } catch (_) {}
    if (!account) return send({ code: 'PGRST301', message: 'Anonymous account required' }, 401);
    const body = request.postDataJSON(), id = body.p_workspace_id, owner = account.id, key = this.key(owner, id), write = url.pathname.endsWith('_put');
    this.requests.push({ kind: write ? 'composition-write' : 'composition-read', owner, id, device, operation: body.p_operation_id, expected: body.p_expected_revision });
    if (this.compositionMissing) { this.expectedFailures++; return send({ code: 'PGRST202', message: 'Anonymous composition schema missing' }, 404); }
    const hold = this.heldComposition?.device === device && this.heldComposition.write === write ? this.heldComposition : null;
    if (hold) this.heldComposition = null;
    if (!write) {
      const result = copy(this.compositions.get(key) || null);
      if (hold) { hold.entered.resolve(); await hold.release.promise; }
      return send(result);
    }
    const { p_expected_revision: expected, p_operation_id: operation, p_source_revision: sourceRevision, p_data: data } = body;
    const payload = JSON.stringify({ expected, sourceRevision, data }), receiptKey = key + ':' + operation;
    const receipt = this.compositionReceipts.get(receiptKey); let result;
    if (receipt) {
      if (receipt.payload !== payload) return send({ code: '22023', message: 'life_composition_operation_mismatch' }, 400);
      result = receipt.result;
    } else {
      const source = this.row(owner, id), old = this.compositions.get(key);
      if (!source || sourceRevision > source.revision) return send({ code: '22023', message: 'life_composition_source_not_ready' }, 400);
      if (!old && expected !== 0) result = { status: 'missing' };
      else if (old && old.revision !== expected) result = { status: 'conflict', revision: old.revision };
      else {
        result = { status: 'stored', revision: (old?.revision || 0) + 1 };
        this.compositions.set(key, { workspace_id: id, revision: result.revision, source_revision: sourceRevision, data: copy(data), updated_at: new Date().toISOString() });
        this.compositionReceipts.set(receiptKey, { payload, result });
      }
    }
    if (hold) { hold.entered.resolve(); await hold.release.promise; }
    if (this.loseComposition.has(device)) { this.expectedFailures++; return route.abort('failed'); }
    return send(result);
  }
}
async function go(page, view = 'sync') {
  await page.goto(base + '/index.html?section=manage&view=' + view); await ready(page); await settle(page);
  await page.waitForFunction(() => !!HaedoLife.Shell.compositionSync);
  if (view === 'sync') await page.locator('#lifeCompositionSync').waitFor();
}
const composition = (page, id) => page.evaluate(id => HaedoLife.Shell.storage.readWorkbench(id), id);
const metadata = (page, id) => page.evaluate(id => HaedoLife.Shell.compositionSync.getState(id), id);
async function sync(page, id) { return page.evaluate(async id => { try { await HaedoLife.Shell.compositionSync.syncNow(id); return null; } catch (error) { return error.code; } }, id); }
async function change(page, id, label) {
  return page.evaluate(async ({ id, label }) => {
    const storage = HaedoLife.Shell.storage, state = await storage.readWorkbench(id);
    state.page.title = label; state.page.entries[0].note = label + '의 코멘트: 원문은 그대로 두고 나의 생각만 이어 적는다.';
    return storage.saveWorkbench(id, state, state.revision);
  }, { id, label });
}
async function seed(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core; let bundle = await s.read(await s.getActive()); const refs = [];
    for (const sample of [
      { title: '느리게 걸으며 다시 읽은 정원의 오래된 기록과 이번 주에 새롭게 알아차린 장면들', origin: 'apple_notes', text: '정원 산책을 마치고 앉았다. 같은 장소를 다시 찾을 때 보이는 차이를 적어 두고 싶다.\n\n이번에는 기록을 더 모으기보다 이미 남긴 글을 천천히 읽었다. 🌿', coverage: 'full_text' },
      { title: '사진에서 다시 발견한 작은 변화', origin: 'instagram', text: '산책 사진을 다시 보니 나무 사이의 빛이 달라졌다. 사진과 댓글은 이 사본에 포함하지 않는다.', coverage: { status: 'partial', omissions: ['사진과 댓글 미포함'] }, url: 'https://www.instagram.com/p/AnonymousContinuity/' }
    ]) {
      const prepared = await c.prepareImport(sample, bundle), result = await s.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision, operationId: c.id(), changes: c.buildImportChanges(bundle, prepared, []) });
      if (result.status !== 'stored') throw new Error('Anonymous source fixture failed'); refs.push({ sourceId: prepared.source.id, versionId: prepared.version.id }); bundle = await s.read(bundle.workspaceId);
    }
    const state = await s.readWorkbench(bundle.workspaceId);
    state.groups.push({ id: c.id(), title: '이번 주 산책과 독서', versionIds: refs.map(value => value.versionId) });
    state.page.title = '다시 읽고 고른 이번 주의 장면'; state.page.intro = '서로 다른 앱에 흩어진 글을 나의 흐름으로 묶었다.';
    state.page.entries.push({ id: c.id(), title: bundle.sources[0].title, parts: refs.map((value, index) => ({ versionId: value.versionId, enabled: index === 0 })), note: '다음 산책에서는 같은 나무를 찾아가기로 했다. 이 코멘트는 원문과 별도로 남긴 생각이다.', enabled: true, pinned: true, showBody: true, showNote: true });
    state.reflection = { note: '정답보다 다시 살펴볼 질문을 남겼다.', versionIds: [refs[1].versionId] };
    state.discovery = { excludedPairs: [{ seedSourceId: refs[0].sourceId, candidateSourceId: refs[1].sourceId }] };
    await s.saveWorkbench(bundle.workspaceId, state, state.revision);
    return { id: bundle.workspaceId, refs };
  });
}
async function sourcesOn(page, id) {
  await page.getByRole('button', { name: '이 작업공간 동기화 시작', exact: true }).click();
  await page.waitForFunction(id => HaedoLife.Shell.sync.getState(id).then(state => state.status === 'synced'), id);
}
async function receiveSources(page, id) {
  await page.getByRole('button', { name: '서버 작업공간 목록 확인', exact: true }).click();
  await page.locator('#lifeRemoteList').getByRole('button', { name: '이 작업공간 받기', exact: true }).click();
  await page.waitForFunction(id => HaedoLife.Shell.storage.getActive().then(active => active === id), id); await settle(page); await go(page);
}
async function enable(page) { await page.locator('#compositionEnable').click(); await page.waitForFunction(() => document.querySelector('#lifeCompositionSync')?.getAttribute('aria-busy') === 'false'); }
async function waitStatus(page, value) { await page.locator('#compositionStatus[data-state="' + value + '"]').waitFor(); }
async function receiveComposition(page) { await enable(page); await waitStatus(page, 'conflict'); await page.locator('#compositionCompare').click(); await page.locator('#compositionUseRemote').click(); await waitStatus(page, 'synced'); }
function semantic(value) { const result = copy(value); delete result.revision; return result; }

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), environment: 'Linux Chromium, two isolated browser contexts and real IndexedDB; anonymous HTTP simulator. Not live SQL/RLS, actual Apple hardware/IME/Files or Google OAuth.', checks: [], captures: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, realRemoteWrites: 0 };
  async function check(name, action) {
    if (process.env.COMPOSITION_TEST_MATCH && !new RegExp(process.env.COMPOSITION_TEST_MATCH).test(name)) return;
    const server = new CompositionCloud(), devices = [];
    const device = async (name, width = 820) => {
      const context = await makeContext(browser, server, name, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820 });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
      page.on('console', event => { if (event.type() !== 'error') return; if (event.location().url.startsWith(cloud) && /Failed to load resource:.*(ERR_|status of (404|400))/.test(event.text())) report.expectedErrors++; else report.consoleErrors.push({ name, message: event.text() }); });
      const value = { context, page, name }; devices.push(value); await go(page); return value;
    };
    try { await action({ server, device }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); for (const value of devices) await value.page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '-' + value.name + '.png'), fullPage: true }).catch(() => {}); }
    finally { if (server.heldComposition) server.heldComposition.release.resolve(); await Promise.all(devices.map(value => value.context.close())); }
  }
  const paired = async ({ server, device }) => {
    const a = await device('a'), b = await device('b'), fixture = await seed(a.page); await sourcesOn(a.page, fixture.id); await enable(a.page); await waitStatus(a.page, 'synced');
    await receiveSources(b.page, fixture.id); await receiveComposition(b.page); return { a, b, ...fixture };
  };
  async function capture(page, scene) {
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); });
      const metrics = await page.evaluate(inspect), file = scene + '-' + width + '.png';
      await page.screenshot({ path: path.join(out, file), fullPage: true }); report.captures.push({ scene, file, ...metrics });
      assert.equal(metrics.horizontalOverflow, false, scene + ' horizontal overflow'); assert.deepEqual(metrics.contrastFailures, [], scene + ' contrast'); assert.deepEqual(metrics.smallTargets, [], scene + ' 44px targets'); assert.deepEqual(metrics.unnamed, [], scene + ' accessible names'); assert.deepEqual(metrics.smallInputs, [], scene + ' 16px inputs');
    }
  }
  try {
    await check('explicit source and composition opt-in; second device receives exact references through UI', async ({ server, device }) => {
      const a = await device('a'), b = await device('b'), { id } = await seed(a.page), before = await composition(a.page, id);
      assert.equal(server.compositionWrites().length, 0); assert.equal(server.writes().length, 0);
      assert.match(await a.page.locator('#lifeCompositionSync').innerText(), /글쓰기 초안과 공개 사본은 포함하지 않습니다/);
      await enable(a.page); await a.page.locator('#compositionError').waitFor(); assert.equal(server.compositionWrites().length, 0); assert.equal((await metadata(a.page, id)).enabled, false);
      await sourcesOn(a.page, id); assert.equal(server.compositionWrites().length, 0); await enable(a.page); await waitStatus(a.page, 'synced');
      assert.deepEqual(semantic(server.composition(accounts.a.id, id).data), semantic(before));
      await receiveSources(b.page, id); assert.equal((await composition(b.page, id)).page.entries.length, 0); assert.equal(server.compositionWrites('b').length, 0);
      await receiveComposition(b.page); assert.deepEqual(semantic(await composition(b.page, id)), semantic(before)); assert.equal(server.compositionWrites('b').length, 0);
      await b.page.goto(base + '/index.html?section=records&view=page'); await ready(b.page); await b.page.locator('.wb-page-entry').waitFor();
      assert.match(await b.page.locator('#lifeMain').innerText(), /다음 산책에서는 같은 나무/);
      await b.page.reload(); await ready(b.page); assert.deepEqual(semantic(await composition(b.page, id)), semantic(before));
      const source = await b.page.evaluate(id => HaedoLife.Shell.storage.read(id), id); assert.deepEqual(semantic(source), semantic(server.row(accounts.a.id, id).data));
      assert.equal(server.requests.some(value => value.kind.startsWith('public')), false);
    });
    await check('offline competing page edits require comparison; discarded side downloads and restores as a new copy', async context => {
      const { server } = context, { a, b, id } = await paired(context);
      server.compositionOffline.add('a'); server.compositionOffline.add('b');
      await change(a.page, id, '첫 기기의 수정'); await change(b.page, id, '두 번째 기기의 수정');
      await sync(a.page, id); await sync(b.page, id); server.compositionOffline.delete('a'); await sync(a.page, id); server.compositionOffline.delete('b');
      await sync(b.page, id); await waitStatus(b.page, 'conflict'); assert.equal((await composition(b.page, id)).page.title, '두 번째 기기의 수정');
      await b.page.locator('#compositionCompare').click(); await b.page.locator('#compositionComparison').waitFor();
      assert.match(await b.page.locator('#compositionComparison').innerText(), /첫 기기의 수정/); assert.match(await b.page.locator('#compositionComparison').innerText(), /두 번째 기기의 수정/);
      await capture(b.page, 'comparison');
      await b.page.locator('#compositionUseRemote').focus(); await b.page.keyboard.press('Enter'); await waitStatus(b.page, 'synced');
      assert.equal((await composition(b.page, id)).page.title, '첫 기기의 수정');
      await b.page.reload(); await ready(b.page); await b.page.locator('details[data-section="recovery"] > summary').click();
      const download = b.page.waitForEvent('download'); await b.page.locator('.composition-recovery').filter({ hasText: '두 번째 기기의 수정' }).locator('.composition-recovery-download').click();
      const file = await download, json = await fs.readFile(await file.path(), 'utf8'), backup = JSON.parse(json);
      assert.equal(backup.workbench.page.title, '두 번째 기기의 수정'); assert.equal(backup.sourceBackup.workspace.workspaceId, id);
      for (const value of ['access_token', 'refresh_token', 'compositionSync:', 'outbox', cloud]) assert.equal(json.includes(value), false);
      await go(b.page, 'workbench-backup'); await b.page.locator('#wbRestoreFile').setInputFiles({ name: 'recovery.json', mimeType: 'application/json', buffer: Buffer.from(json) });
      await b.page.locator('#wbRestoreInstall').click(); await b.page.waitForFunction(id => HaedoLife.Shell.storage.getActive().then(active => active !== id), id);
      const restored = await b.page.evaluate(async () => HaedoLife.Shell.storage.readWorkbenchSnapshot(await HaedoLife.Shell.storage.getActive()));
      assert.equal(restored.workbench.page.title, '두 번째 기기의 수정'); assert.notEqual(restored.bundle.workspaceId, id);
      assert.equal(restored.workbench.page.entries[0].parts[0].versionId, restored.bundle.sourceVersions[0].id);
      assert.equal((await composition(b.page, id)).page.title, '첫 기기의 수정');
    });
    await check('lost write acknowledgement replays durable operation after reload without a duplicate revision', async context => {
      const { server } = context, { a, id } = await paired(context); server.loseComposition.add('a');
      await change(a.page, id, '응답을 놓친 수정'); await sync(a.page, id);
      const pending = await metadata(a.page, id), revision = server.composition(accounts.a.id, id).revision; assert.ok(pending.outbox);
      const operation = pending.outbox.operationId; await a.page.reload(); await ready(a.page); assert.equal((await metadata(a.page, id)).outbox.operationId, operation);
      server.loseComposition.delete('a'); assert.equal(await sync(a.page, id), null); assert.equal((await metadata(a.page, id)).outbox, null);
      assert.equal(server.composition(accounts.a.id, id).revision, revision); assert.ok(server.compositionWrites('a').filter(value => value.operation === operation).length >= 2);
    });
    await check('paused source or composition cannot upload; missing SQL stays an actionable preserved-local error', async ({ server, device }) => {
      const a = await device('a'), { id } = await seed(a.page), before = await composition(a.page, id); await sourcesOn(a.page, id);
      server.compositionMissing = true; await enable(a.page); await a.page.locator('#compositionError').waitFor();
      assert.match(await a.page.locator('#compositionError').innerText(), /준비/); assert.equal((await metadata(a.page, id)).enabled, false); assert.deepEqual(await composition(a.page, id), before);
      await capture(a.page, 'missing-installation'); server.compositionMissing = false; await enable(a.page); await waitStatus(a.page, 'synced');
      await a.page.evaluate(id => HaedoLife.Shell.sync.pause(id), id); const writes = server.compositionWrites().length;
      await change(a.page, id, '원문 연결 중지 후 로컬 수정'); assert.equal(await sync(a.page, id), 'composition_source_pending'); assert.equal(server.compositionWrites().length, writes);
      await a.page.locator('#compositionPause').click(); await waitStatus(a.page, 'paused'); assert.equal((await metadata(a.page, id)).enabled, false); assert.equal(await sync(a.page, id), 'sync_paused'); assert.equal(server.compositionWrites().length, writes);
      await capture(a.page, 'paused');
    });
    await check('local choice retains server loser; stale comparison cannot overwrite newer local edits', async context => {
      const { server } = context, { a, b, id } = await paired(context); server.compositionOffline.add('b');
      await change(b.page, id, '현재 기기 선택'); await change(a.page, id, '서버 쪽 이전 구성'); await sync(a.page, id); server.compositionOffline.delete('b'); await sync(b.page, id);
      await b.page.locator('#compositionCompare').click(); await b.page.locator('#compositionComparison').waitFor();
      await change(b.page, id, '비교 뒤 더 쓴 구성'); await b.page.locator('#compositionUseLocal').click();
      await b.page.locator('#compositionError').waitFor(); assert.equal((await composition(b.page, id)).page.title, '비교 뒤 더 쓴 구성'); assert.equal(server.composition(accounts.a.id, id).data.page.title, '서버 쪽 이전 구성');
      await b.page.locator('#compositionCompare').click(); await b.page.locator('#compositionUseLocal').click(); await waitStatus(b.page, 'synced');
      assert.equal(server.composition(accounts.a.id, id).data.page.title, '비교 뒤 더 쓴 구성');
      const recovery = await b.page.evaluate(async id => { const s = HaedoLife.Shell.storage, rows = await s.listCompositionRecoveries(id); return s.readCompositionRecovery(id, rows[0].id); }, id);
      assert.equal(recovery.workbench.page.title, '서버 쪽 이전 구성');
    });
    await check('account switch cancels a held composition reply and never installs A into B', async context => {
      const { server } = context, { a, b, id } = await paired(context); await change(a.page, id, '이전 계정의 비공개 구성'); await sync(a.page, id);
      const held = { device: 'b', write: false, entered: deferred(), release: deferred() }; server.heldComposition = held;
      const pending = sync(b.page, id); await held.entered.promise;
      server.oauthAccounts.set('b', accounts.b);
      try {
        await b.page.evaluate(async () => HaedoAuth.signOut());
        held.release.resolve(); await pending.catch(() => {});
        await b.page.goto(base + '/login.html?next=index.html'); await b.page.locator('#googleLogin').click(); await b.page.waitForURL('**/index.html'); await ready(b.page);
        assert.equal(await b.page.evaluate(() => HaedoAuth.user.id), accounts.b.id);
        assert.equal((await b.page.evaluate(() => HaedoLife.Shell.storage.listWorkspaces())).some(value => value.workspaceId === id), false);
        assert.equal(server.compositionWrites('b').some(value => value.owner === accounts.b.id), false);
        assert.equal(await b.page.locator('body').innerText().then(value => value.includes('이전 계정의 비공개 구성')), false);
      } finally { held.release.resolve(); }
    });
    await check('UI pause cancels pending first enable and active read; re-enable completes before either late response', async ({ server, device }) => {
      const a = await device('a'), { id } = await seed(a.page); await sourcesOn(a.page, id);
      for (const first of [true, false]) {
        const held = { device: 'a', write: false, entered: deferred(), release: deferred() }; server.heldComposition = held;
        await a.page.locator(first ? '#compositionEnable' : '#compositionSyncNow').click(); await held.entered.promise;
        try {
          assert.equal(await a.page.locator('#lifeCompositionSync').getAttribute('aria-busy'), 'true');
          assert.equal(await a.page.locator('#compositionPause').isEnabled(), true);
          await a.page.locator('#compositionPause').focus(); await a.page.keyboard.press('Enter');
          await waitStatus(a.page, first ? 'not_enabled' : 'paused'); assert.equal((await metadata(a.page, id)).enabled, false);
          // Keep the earlier HTTP response held while a new generation completes.
          await enable(a.page); await waitStatus(a.page, 'synced');
          const settled = await metadata(a.page, id), value = await composition(a.page, id), writes = server.compositionWrites().length;
          held.release.resolve(); await a.page.waitForLoadState('networkidle');
          assert.deepEqual(await metadata(a.page, id), settled); assert.deepEqual(await composition(a.page, id), value);
          assert.equal(server.compositionWrites().length, writes); assert.equal(await a.page.locator('#compositionError').isVisible(), false);
          assert.equal(await a.page.locator('#lifeCompositionSync').getAttribute('aria-busy'), 'false');
        } finally { held.release.resolve(); }
      }
    });
    await check('equal-count comparison identifies different exact source versions; expanded detail and keyboard focus survive refresh', async ({ server, device }) => {
      const a = await device('a'), b = await device('b'), { id, refs } = await seed(a.page);
      const newer = await a.page.evaluate(async ({ id, sourceId }) => {
        const s = HaedoLife.Shell.storage, c = HaedoLife.Core, bundle = await s.read(id), source = bundle.sources.find(value => value.id === sourceId);
        const prepared = await c.prepareImport({ origin: source.origin, title: source.title, existingSourceId: sourceId, text: '두 번째 버전에서는 비 온 뒤의 정원을 보았다. 이전 글과 같은 원천이지만 관찰한 장면과 질문이 달라졌다.', coverage: 'full_text' }, bundle);
        const result = await s.commitLocal({ workspaceId: id, baseRevision: bundle.revision, operationId: c.id(), changes: c.buildImportChanges(bundle, prepared, []) });
        if (result.status !== 'stored') throw new Error('Version fixture failed');
        const state = await s.readWorkbench(id), oldId = bundle.sourceVersions.find(value => value.sourceId === sourceId).id;
        state.groups[0].versionIds = [oldId]; state.page.entries[0].parts = [{ versionId: oldId, enabled: true }]; state.reflection.versionIds = [oldId];
        await s.saveWorkbench(id, state, state.revision); return prepared.version.id;
      }, { id, sourceId: refs[0].sourceId });
      await sourcesOn(a.page, id); await enable(a.page); await waitStatus(a.page, 'synced'); await receiveSources(b.page, id); await receiveComposition(b.page);
      server.compositionOffline.add('b');
      await b.page.evaluate(async ({ id, newer }) => {
        const s = HaedoLife.Shell.storage, state = await s.readWorkbench(id);
        state.groups[0].versionIds = [newer]; state.page.entries[0].parts = [{ versionId: newer, enabled: true }]; state.reflection.versionIds = [newer];
        await s.saveWorkbench(id, state, state.revision);
      }, { id, newer });
      await a.page.evaluate(async id => { const s = HaedoLife.Shell.storage, state = await s.readWorkbench(id); state.page.intro = '처음 보관한 원문 버전으로 다시 읽는다.'; await s.saveWorkbench(id, state, state.revision); }, id);
      await sync(a.page, id); server.compositionOffline.delete('b'); await sync(b.page, id); await waitStatus(b.page, 'conflict');
      await b.page.locator('#compositionCompare').click(); await b.page.locator('#compositionComparison').waitFor();
      const sides = b.page.locator('.composition-side'); assert.equal(await sides.count(), 2);
      assert.equal(await sides.nth(0).locator(':scope > .life-meta').innerText(), await sides.nth(1).locator(':scope > .life-meta').innerText());
      for (const key of ['local', 'remote']) { await b.page.locator('#compositionDetails-' + key).focus(); await b.page.keyboard.press('Enter'); }
      assert.match(await sides.nth(0).innerText(), /버전 2 · 표시/); assert.match(await sides.nth(0).innerText(), /두 번째 버전에서는 비 온 뒤의 정원/);
      assert.match(await sides.nth(1).innerText(), /버전 1 · 표시/); assert.match(await sides.nth(1).innerText(), /정원 산책을 마치고 앉았다/);
      assert.equal((await sides.nth(1).innerText()).includes('두 번째 버전에서는'), false);
      await b.page.locator('#compositionDetails-local').focus();
      const positions = await b.page.locator('.composition-side details').evaluateAll(elements => elements.map(el => { el.scrollTop = 120; el.dataset.qaRefresh = 'before'; return el.scrollTop; }));
      assert.ok(positions.every(value => value > 0), 'long comparison details did not scroll');
      await sync(b.page, id);
      await b.page.waitForFunction(() => document.activeElement?.id === 'compositionDetails-local' && [...document.querySelectorAll('.composition-side details')].every(value => value.open && value.dataset.qaRefresh !== 'before'));
      assert.deepEqual(await b.page.locator('.composition-side details').evaluateAll(elements => elements.map(el => el.scrollTop)), positions, 'refresh reset the reading position inside comparison details');
      await capture(b.page, 'exact-version-comparison');
      assert.equal((await composition(b.page, id)).page.entries[0].parts[0].versionId, newer);
      assert.equal(server.composition(accounts.a.id, id).data.page.entries[0].parts[0].versionId, refs[0].versionId);
    });
    await check('loading and empty composition management remain keyboard accessible in three widths', async ({ server, device }) => {
      const a = await device('a', 390); await capture(a.page, 'not-enabled');
      const id = await a.page.evaluate(() => HaedoLife.Shell.storage.getActive()); await sourcesOn(a.page, id);
      const held = { device: 'a', write: false, entered: deferred(), release: deferred() }; server.heldComposition = held;
      const enabling = a.page.locator('#compositionEnable').click(); await held.entered.promise;
      try { assert.equal(await a.page.locator('#lifeCompositionSync').getAttribute('aria-busy'), 'true'); assert.equal(await a.page.locator('#compositionEnable').isDisabled(), true); await capture(a.page, 'loading'); }
      finally { held.release.resolve(); await enabling; }
      await waitStatus(a.page, 'synced'); await a.page.locator('#compositionPause').focus(); await a.page.keyboard.press('Enter'); await waitStatus(a.page, 'paused');
      await a.page.locator('#compositionEnable').focus(); await a.page.keyboard.press('Enter'); await waitStatus(a.page, 'synced'); await capture(a.page, 'empty-synced');
    });
  } finally { await browser.close(); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
  assert.deepEqual(report.consoleErrors, [], 'unexpected console errors'); assert.deepEqual(report.pageErrors, [], 'unexpected page errors');
  console.log(`Composition browser: ${report.checks.filter(value => value.pass).length}/${report.checks.length} scenarios; ${report.captures.length} viewport captures. Anonymous HTTP, not operating SQL or Apple hardware.`);
  if (report.checks.some(value => !value.pass)) process.exitCode = 1;
}
module.exports = { CompositionCloud };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
