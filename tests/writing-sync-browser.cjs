/* Automatic writing-draft sync; two isolated Chromium contexts, bundled SDK and real
 * IndexedDB with anonymous HTTP only. No operating DB or Apple hardware claims.
 * BASE_URL=http://127.0.0.1:4184 node tests/writing-sync-browser.cjs */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
process.env.PW_MODULE_PATH ||= process.env.PLAYWRIGHT_MODULE || '';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext } = require('./unified-home-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
// page.waitForFunction treats a returned Promise as already true; asynchronous page state is awaited in Node.
const { awaitCondition } = require('./helpers/await-condition.cjs');
const out = process.env.WRITING_SYNC_REPORT_DIR ? path.resolve(process.env.WRITING_SYNC_REPORT_DIR) : path.resolve(__dirname, '../.local/writing-sync');
const copy = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const title = '산책을 마치고 돌아오는 길에서 발견한 작은 질문을 나만의 문장으로 남기고 다시 읽는 기록 — 오래된 관심과 새로운 생각을 함께 이어 쓰기';
const body = '책을 덮고 천천히 걸었다.\n다시 읽을 문장🌱\n그때의 생각은 아직 완성되지 않았다. 내 언어로 쓰는 일은 오래 머문 자리를 확인하는 일이었다.\n<img src=x onerror="window.__writingInjected=1">';
// Draft RPCs live in tests/helpers/writing-cloud.cjs, composed into the shared FakeCloud.
// `slowAccountCheck` answers one device's account checks (/auth/v1/user) late: the latency of a
// loaded runner or a slow network while an opened page's originals engine connects.
class WritingCloud extends FakeCloud {
  async handle(route, device) {
    const slow = this.slowAccountCheck;
    if (slow?.device === device && new URL(route.request().url()).pathname === '/auth/v1/user') await new Promise(resolve => setTimeout(resolve, slow.ms));
    return super.handle(route, device);
  }
}
const listCount = (server, device) => server.writingRequests.filter(value => value.kind === 'writing-list' && value.device === device).length;
async function go(page, view = 'write') {
  await page.goto(base + '/index.html?section=' + (view === 'sync' ? 'manage' : 'records') + '&view=' + view); await ready(page); await settle(page);
  await page.waitForFunction(() => !!HaedoLife.Shell.writingSync);
  // Each open (re)starts the originals engine after mount (legacy library path here), and until
  // its account check answers the originals read auth_required, so a draft pass then does nothing.
  // Drive passes only once the engine is connected, as on a device that finished opening.
  await page.waitForFunction(() => !!HaedoLife.Shell.sync?.getAccount());
  if (view === 'write') await page.locator('#lifeWritingBody').waitFor();
}
const active = page => page.evaluate(() => HaedoLife.Shell.storage.getActive());
const stage = (page, id) => page.evaluate(id => HaedoLife.Shell.storage.getStage(id), id);
const stages = (page, id) => page.evaluate(id => HaedoLife.Shell.storage.listStages(id), id);
const bundle = (page, id) => page.evaluate(id => HaedoLife.Shell.storage.read(id), id);
const metadata = (page, ws, id) => page.evaluate(({ ws, id }) => HaedoLife.Shell.writingSync.getState(ws, id), { ws, id });
// One automatic pass (the same function the 30 s / online / focus / visibility loop runs).
async function auto(page) { await page.evaluate(() => HaedoLife.Shell.writingSync.refresh()); await settle(page); }
async function sync(page, ws, id) { return page.evaluate(async ({ ws, id }) => { try { await HaedoLife.Shell.writingSync.syncNow(ws, id); return null; } catch (error) { return error.code; } }, { ws, id }); }
async function fill(page, text = body, name = title) {
  await page.locator('#lifeWritingTitle').fill(name); await page.locator('#lifeWritingBody').fill(text);
  await page.waitForFunction(() => document.querySelector('#lifeWritingStatus')?.dataset.state === 'draft');
  const rows = await stages(page, await active(page)); return rows.find(value => value.kind === 'writing' && value.state === 'draft' && value.title === name && value.text === text);
}
async function sourceOn(page, id) { await page.evaluate(async id => { await HaedoLife.Shell.sync.enable(id); await HaedoLife.Shell.sync.syncNow(id); }, id); }
async function receiveSources(page, id) {
  await go(page, 'sync'); await page.getByRole('button', { name: '서버 작업공간 목록 확인', exact: true }).click();
  await page.locator('#lifeRemoteList').getByRole('button', { name: '이 작업공간 받기', exact: true }).click();
  await settle(page); await awaitCondition(page, id => HaedoLife.Shell.storage.getActive().then(value => value === id), id, { timeout: 12000, label: 'received workspace active' }); await go(page);
  // Drafts are listed only for a workspace whose originals sync is enabled and synced for this account.
  await awaitCondition(page, id => HaedoLife.Shell.sync.getState(id).then(value => value.enabled && value.status === 'synced'), id, { timeout: 12000, label: 'received originals synced' });
}
async function editStored(page, id, text) { return page.evaluate(async ({ id, text }) => { const s = HaedoLife.Shell.storage, value = await s.getStage(id); return s.saveStage({ ...value, text, updatedAt: new Date().toISOString() }); }, { id, text }); }
async function openDraft(page, id) { await go(page); const details = page.locator('#lifeWritingDrafts'); if (!await details.evaluate(value => value.open)) await details.locator('summary').click(); await details.locator('[data-stage-id="' + id + '"]').click(); await page.locator('#lifeWritingBody').waitFor(); }
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), environment: 'Linux Chromium, isolated browser contexts and actual IndexedDB; anonymous HTTP simulator. Not operating SQL/RLS, actual Apple hardware/IME/Files or Google OAuth.', checks: [], captures: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [], productionWrites: 0 };
  async function check(name, action) {
    if (process.env.WRITING_SYNC_TEST_MATCH && !new RegExp(process.env.WRITING_SYNC_TEST_MATCH).test(name)) return;
    const server = new WritingCloud(), devices = [];
    const device = async (name, width = 820) => {
      const context = await makeContext(browser, server, name, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820 });
      await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push({ origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient'); });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
      page.on('console', event => { if (event.type() !== 'error') return; if (event.location().url.startsWith(cloud) && /Failed to load resource:.*(ERR_|status of (404|400))/.test(event.text())) report.expectedErrors++; else report.consoleErrors.push({ name, message: event.text() }); });
      const value = { context, page, name }; devices.push(value); await go(page); return value;
    };
    try { await action({ server, device }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); for (const value of devices) await value.page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '-' + value.name + '.png'), fullPage: true }).catch(() => {}); }
    finally { if (server.heldWriting) server.heldWriting.release.resolve(); await Promise.all(devices.map(value => value.context.close())); }
  }
  async function capture(page, scene) {
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await page.evaluate(async () => { await document.fonts.ready; document.activeElement?.blur(); scrollTo(0, 0); });
      const metrics = await page.evaluate(inspect), file = scene + '-' + width + '.png'; await page.screenshot({ path: path.join(out, file), fullPage: true }); report.captures.push({ scene, file, ...metrics });
      assert.equal(metrics.horizontalOverflow, false, scene + ' overflow'); assert.deepEqual(metrics.contrastFailures, [], scene + ' contrast'); assert.deepEqual(metrics.smallTargets, [], scene + ' 44px targets'); assert.deepEqual(metrics.unnamed, [], scene + ' accessible names'); assert.deepEqual(metrics.smallInputs, [], scene + ' 16px inputs');
    }
  }
  // The panel is a compact status; every assertion about transfer goes through the same
  // automatic pass the background loop runs. Helper storage writes only arrange competing input.
  async function panel(page) { const details = page.locator('#lifeWritingSync'); if (!(await details.evaluate(value => value.open))) await details.locator('summary').first().click(); }
  async function status(page, value) { await page.locator('#writingSyncStatus[data-state="' + value + '"]').waitFor(); }
  const removed = ['#writingEnable', '#writingPause', '#writingRemoteListButton', '#writingCompare', '#writingUseLocal', '#writingUseRemote', '#writingFork'];
  const paired = async ({ device }) => {
    const a = await device('a'), b = await device('b'), draft = await fill(a.page), ws = await active(a.page); await sourceOn(a.page, ws); await auto(a.page);
    await receiveSources(b.page, ws); await auto(b.page); assert.equal((await stage(b.page, draft.stageId)).text, body);
    return { a, b, ws, id: draft.stageId, draft };
  };
  try {
    await check('every draft crosses devices automatically; import drafts stay private and record save stays explicit', async ({ server, device }) => {
      const a = await device('a'), b = await device('b'); await panel(a.page); await capture(a.page, 'empty');
      for (const selector of removed) assert.equal(await a.page.locator(selector).count(), 0, selector);
      const draft = await fill(a.page), ws = await active(a.page); assert.ok(draft);
      await auto(a.page); assert.equal(server.draftWrites().length, 0, 'no draft leaves before its originals sync');
      await sourceOn(a.page, ws); await auto(a.page); await openDraft(a.page, draft.stageId); await panel(a.page); await status(a.page, 'synced');
      assert.equal(server.draft(accounts.a.id, ws, draft.stageId).data.text, body); assert.equal(server.row(accounts.a.id, ws).data.sourceVersions.length, 0);
      await a.page.locator('#lifeWritingNew').click(); const second = await fill(a.page, '새로 쓴 초안도 따로 켜지 않고 다른 기기로 간다.', '새로 쓴 초안');
      await auto(a.page); assert.equal(server.draft(accounts.a.id, ws, second.stageId).data.text, '새로 쓴 초안도 따로 켜지 않고 다른 기기로 간다.');
      await a.page.locator('#lifeWritingClose').click(); await a.page.getByRole('button', { name: '가져오기', exact: true }).click();
      await a.page.locator('#lifeImportTitle').fill('외부 가져오기 전용 초안'); await a.page.locator('#lifeImportText').fill('가져오기 검토 중인 별도 본문'); await a.page.getByRole('button', { name: '검토 내용 보관', exact: true }).click(); await settle(a.page);
      const imported = (await stages(a.page, ws)).find(value => value.kind !== 'writing'); assert.ok(imported); await auto(a.page); assert.equal(server.draft(accounts.a.id, ws, imported.stageId), undefined);
      await receiveSources(b.page, ws); await auto(b.page);
      const received = await stages(b.page, ws);
      assert.deepEqual(received.filter(value => value.kind === 'writing').map(value => value.stageId).sort(), [draft.stageId, second.stageId].sort());
      assert.equal(received.some(value => value.stageId === imported.stageId), false); assert.equal((await bundle(b.page, ws)).sources.length, 0);
      await openDraft(b.page, draft.stageId); assert.equal(await b.page.locator('#lifeWritingBody').inputValue(), body);
      assert.equal(await b.page.locator('#lifeWritingBody img').count(), 0); assert.equal(await b.page.evaluate(() => window.__writingInjected), undefined);
      await panel(b.page); await status(b.page, 'synced'); for (const selector of removed) assert.equal(await b.page.locator(selector).count(), 0, selector);
      assert.equal(server.requests.some(value => value.kind.startsWith('public')), false); await capture(b.page, 'synced');
    });
    await check('competing offline edits keep the newest text and the other as a recoverable draft with one notice', async context => {
      const { server } = context, { a, b, ws, id } = await paired(context); server.writingOffline.add('a'); server.writingOffline.add('b');
      await editStored(a.page, id, '첫 기기의 이어 쓴 문장🌱'); await b.page.waitForTimeout(20); await editStored(b.page, id, '두 번째 기기에 나중에 남긴 문장🌿');
      server.writingOffline.delete('a'); assert.equal(await sync(a.page, ws, id), null); assert.equal(server.draft(accounts.a.id, ws, id).data.text, '첫 기기의 이어 쓴 문장🌱');
      // The notice is a short in-session message: keep the draft open while the conflict settles.
      await openDraft(b.page, id); await panel(b.page);
      server.writingOffline.delete('b'); assert.equal(await sync(b.page, ws, id), null);
      assert.equal((await stage(b.page, id)).text, '두 번째 기기에 나중에 남긴 문장🌿'); assert.equal(server.draft(accounts.a.id, ws, id).data.text, '두 번째 기기에 나중에 남긴 문장🌿');
      const recovery = (await stages(b.page, ws)).find(value => value.stageId !== id && value.text === '첫 기기의 이어 쓴 문장🌱'); assert.ok(recovery); assert.equal(recovery.state, 'draft');
      await b.page.locator('#writingSyncNotice').waitFor();
      assert.match(await b.page.locator('#lifeWritingSync').innerText(), /다른 기기 변경을 반영했고 이전 내용은 복구 목록에 있습니다/); await capture(b.page, 'resolved-notice');
      await b.page.locator('#writingSyncRecovery').focus(); await b.page.keyboard.press('Enter');
      await b.page.waitForFunction(id => document.querySelector('#lifeWritingSync')?.dataset.draftId === id, recovery.stageId);
      const waiting = b.page.waitForEvent('download'); await b.page.locator('#lifeWritingDownload').click(); const downloaded = await waiting, text = await fs.readFile(await downloaded.path(), 'utf8'); assert.match(text, /첫 기기의 이어 쓴 문장🌱/);
      await auto(b.page); assert.equal(server.draft(accounts.a.id, ws, recovery.stageId).data.text, '첫 기기의 이어 쓴 문장🌱');
      await auto(a.page); assert.equal((await stage(a.page, id)).text, '두 번째 기기에 나중에 남긴 문장🌿'); assert.equal((await stage(a.page, recovery.stageId)).text, '첫 기기의 이어 쓴 문장🌱');
    });
    await check('lost acknowledgement survives reload and retries the same operation exactly once on the server', async context => {
      const { server } = context, { a, ws, id } = await paired(context); server.loseWriting.add('a'); await editStored(a.page, id, '응답을 놓쳐도 남아 있는 문장'); await sync(a.page, ws, id);
      const pending = await metadata(a.page, ws, id), revision = server.draft(accounts.a.id, ws, id).revision; assert.ok(pending.outbox); const operation = pending.outbox.operationId;
      await a.page.reload(); await ready(a.page); assert.equal((await metadata(a.page, ws, id)).outbox.operationId, operation); server.loseWriting.delete('a'); assert.equal(await sync(a.page, ws, id), null); assert.equal((await metadata(a.page, ws, id)).outbox, null); assert.equal(server.draft(accounts.a.id, ws, id).revision, revision);
    });
    await check('missing SQL keeps local input and never creates a remote draft; the next pass connects once it exists', async ({ server, device }) => {
      // The draft schema is missing before the originals connect: the pass that their connection
      // starts must already meet it (no draft may slip through before the flag is set).
      const a = await device('a'), draft = await fill(a.page), ws = await active(a.page); server.writingMissing = true; await sourceOn(a.page, ws); await auto(a.page);
      assert.equal((await metadata(a.page, ws, draft.stageId)).enabled, false); assert.equal((await stage(a.page, draft.stageId)).text, body); assert.equal(server.draft(accounts.a.id, ws, draft.stageId), undefined);
      await go(a.page); await panel(a.page); await status(a.page, 'not_enabled'); await capture(a.page, 'missing-installation');
      // The missing schema is not probed again every cycle; an explicit retry (force) checks it once.
      await auto(a.page); assert.equal(await a.page.evaluate(() => HaedoLife.Shell.writingSync.availability().status), 'unavailable');
      server.writingMissing = false; await a.page.evaluate(() => HaedoLife.Shell.writingSync.refresh({ force: true })); await settle(a.page); await go(a.page); await panel(a.page); await status(a.page, 'synced');
      assert.equal(server.draft(accounts.a.id, ws, draft.stageId).data.text, body);
      await a.page.evaluate(ws => HaedoLife.Shell.sync.pause(ws), ws); const writes = server.draftWrites().length; await editStored(a.page, draft.stageId, '원문 연결을 멈춘 뒤 작성한 문장');
      assert.notEqual(await sync(a.page, ws, draft.stageId), null); assert.equal(server.draftWrites().length, writes); assert.equal((await stage(a.page, draft.stageId)).text, '원문 연결을 멈춘 뒤 작성한 문장');
    });
    await check('account switch rejects held draft response and opens a separate private store', async context => {
      const { server } = context, { a, b, ws, id } = await paired(context); await editStored(a.page, id, '이전 계정의 비공개 문장'); await sync(a.page, ws, id);
      const held = { device: 'b', kind: 'get', entered: deferred(), release: deferred() }; server.heldWriting = held; const pending = sync(b.page, ws, id); await held.entered.promise;
      try { server.oauthAccounts.set('b', accounts.b); await b.page.evaluate(() => HaedoAuth.signOut()); held.release.resolve(); await pending.catch(() => {}); await b.page.goto(base + '/login.html?next=index.html'); await b.page.locator('#googleLogin').click(); await b.page.waitForURL('**/index.html'); await ready(b.page); assert.equal(await b.page.evaluate(() => HaedoAuth.user.id), accounts.b.id); assert.equal((await b.page.evaluate(() => HaedoLife.Shell.storage.listWorkspaces())).some(value => value.workspaceId === ws), false); await auto(b.page); assert.equal(server.draftWrites('b').some(value => value.owner === accounts.b.id), false); assert.doesNotMatch(await b.page.locator('body').innerText(), /이전 계정의 비공개 문장/); }
      finally { held.release.resolve(); }
    });
    await check('server updates never replace an active Korean composition; applied terminal preserves exact source pair and pending input', async context => {
      const { server } = context, { a, b, ws, id } = await paired(context); await openDraft(b.page, id);
      await b.page.locator('#lifeWritingBody').focus(); await b.page.locator('#lifeWritingBody').evaluate(element => { window.__writingInput = element; element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'ㅎ' })); element.value += '\n한글 입력 중'; element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '한글 입력 중' })); });
      const input = await b.page.locator('#lifeWritingBody').inputValue(); await editStored(a.page, id, '다른 기기에서 먼저 완성한 글'); await sync(a.page, ws, id); await auto(b.page);
      assert.equal(await b.page.locator('#lifeWritingBody').inputValue(), input); assert.equal(await b.page.locator('#lifeWritingBody').evaluate(element => element === window.__writingInput), true);
      await b.page.locator('#lifeWritingBody').evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '한글 입력 중' })));
      await b.page.locator('#lifeWritingError').waitFor(); await b.page.locator('#lifeWritingRescue').click(); await b.page.waitForFunction(() => document.querySelector('#lifeWritingStatus')?.dataset.state === 'draft'); assert.ok((await stages(b.page, ws)).some(value => value.stageId !== id && value.text === input));
      await openDraft(a.page, id); await a.page.locator('#lifeWritingSave').click(); await a.page.locator('#lifeSourceText').waitFor(); await sync(a.page, ws, id);
      const published = await stage(a.page, id), source = await bundle(a.page, ws), remote = server.draft(accounts.a.id, ws, id); assert.equal(published.state, 'applied'); assert.equal(remote.data.state, 'applied'); assert.ok(source.sourceVersions.some(value => value.id === published.appliedResult.sourceVersionId && value.sourceId === published.appliedResult.sourceId));
      // B's background passes may hold the same draft queue; retry the explicit pass until the record arrives.
      for (let attempt = 0; attempt < 10 && (await stage(b.page, id)).state !== 'applied'; attempt++) { await b.page.evaluate(ws => HaedoLife.Shell.sync.syncNow(ws), ws).catch(() => {}); await sync(b.page, ws, id); if ((await stage(b.page, id)).state !== 'applied') await b.page.waitForTimeout(300); }
      assert.equal((await stage(b.page, id)).state, 'applied'); assert.deepEqual((await stage(b.page, id)).appliedResult, published.appliedResult); assert.ok((await stages(b.page, ws)).some(value => value.stageId !== id && value.text === input));
    });
    await check('a remote saved record closes the draft identity and the unsaved local alternative becomes a recoverable draft automatically', async context => {
      const { server } = context, { a, b, ws, id } = await paired(context); server.writingOffline.add('b');
      await editStored(b.page, id, '기기 B가 오프라인에서 이어 쓴 미완성 생각'); await sync(b.page, ws, id);
      await openDraft(a.page, id); await a.page.locator('#lifeWritingSave').click(); await a.page.locator('#lifeSourceText').waitFor(); await sync(a.page, ws, id);
      const committed = server.draft(accounts.a.id, ws, id), record = copy(server.row(accounts.a.id, ws).data); assert.equal(committed.data.state, 'applied');
      server.writingOffline.delete('b'); await b.page.evaluate(ws => HaedoLife.Shell.sync.syncNow(ws), ws); assert.equal(await sync(b.page, ws, id), null);
      const closed = await stage(b.page, id), recovery = (await stages(b.page, ws)).find(value => value.stageId !== id && value.text === '기기 B가 오프라인에서 이어 쓴 미완성 생각');
      assert.equal(closed.state, 'applied'); assert.deepEqual(closed.appliedResult, committed.data.appliedResult); assert.ok(recovery); assert.equal(recovery.state, 'draft'); assert.equal(recovery.sourceId, null); assert.equal(recovery.baseSourceRevision, null); assert.equal(recovery.baseSourceVersionId, null);
      assert.equal(server.draft(accounts.a.id, ws, id).revision, committed.revision); assert.deepEqual(server.row(accounts.a.id, ws).data.sourceVersions, record.sourceVersions); assert.deepEqual((await bundle(b.page, ws)).sourceVersions, record.sourceVersions);
      await auto(b.page); assert.equal(server.draft(accounts.a.id, ws, recovery.stageId).data.text, recovery.text);
      await openDraft(b.page, recovery.stageId); assert.equal(await b.page.locator('#lifeWritingBody').inputValue(), recovery.text); assert.equal((await bundle(b.page, ws)).sources.length, 1);
    });
    await check('a draft saved as a record closes on the server and is not reinstalled as a draft elsewhere', async ({ server, device }) => {
      const a = await device('a'), b = await device('b'), draft = await fill(a.page), ws = await active(a.page), id = draft.stageId;
      await sourceOn(a.page, ws); await auto(a.page); await a.page.locator('#lifeWritingSave').click(); await a.page.locator('#lifeSourceText').waitFor();
      const saved = await stage(a.page, id); assert.equal(saved.state, 'applied'); await auto(a.page);
      const remote = server.draft(accounts.a.id, ws, id); assert.equal(remote.data.state, 'applied'); assert.deepEqual(remote.data.appliedResult, saved.appliedResult);
      assert.equal((await metadata(a.page, ws, id)).status, 'closed'); await go(a.page); await panel(a.page);
      const listed = listCount(server, 'b'); await receiveSources(b.page, ws); await auto(b.page);
      // The absence below means something only if B's pass listed the server drafts (the closed one among them).
      assert.ok(listCount(server, 'b') > listed, 'B listed the server drafts'); assert.equal(await stage(b.page, id), null);
      assert.ok((await bundle(b.page, ws)).sourceVersions.some(value => value.id === saved.appliedResult.sourceVersionId));
    });
    await check('a device that reopens while its originals still connect receives a new draft without waiting for the 30 s poll', async context => {
      const { server } = context, { a, b, ws } = await paired(context), text = '다시 연 기기가 주기를 기다리지 않고 받는 초안.';
      await a.page.locator('#lifeWritingNew').click(); const next = await fill(a.page, text, '다시 연 기기의 초안');
      await auto(a.page); assert.equal(server.draft(accounts.a.id, ws, next.stageId).data.text, text);
      // B reopens with slow account checks, so its first pass finds the originals not connected.
      // No pass is driven on B: the draft must arrive from the open itself, well before the 30 s poll.
      server.slowAccountCheck = { device: 'b', ms: 1500 };
      try {
        await go(b.page);
        await awaitCondition(b.page, id => HaedoLife.Shell.storage.getStage(id).then(value => value?.state === 'draft'), next.stageId, { timeout: 5000, label: 'new draft installed on the reopened device' });
        assert.equal((await stage(b.page, next.stageId)).text, text);
      } finally { server.slowAccountCheck = null; }
    });
    await check('server-only drafts beyond one page install automatically without overwriting a local draft', async context => {
      const { server } = context, { b, ws, id } = await paired(context), original = server.draft(accounts.a.id, ws, id);
      for (let index = 0; index < 101; index++) { const draftId = '00000000-0000-4000-8000-' + String(index).padStart(12, '0'), value = copy(original); value.draft_id = draftId; value.data.stageId = draftId; value.data.title = '다른 기기의 글 ' + index; server.drafts.set(server.draftKey(accounts.a.id, ws, draftId), value); }
      const before = await stage(b.page, id); await auto(b.page);
      assert.equal((await stages(b.page, ws)).filter(value => value.kind === 'writing').length, 102); assert.deepEqual(await stage(b.page, id), before);
      const requests = server.writingRequests.filter(value => value.kind === 'writing-list' && value.device === 'b'); assert.ok(requests.some(value => value.after));
      assert.equal(server.draftWrites('b').length, 0);
    });
  } finally { await browser.close(); await fs.writeFile(path.join(out, 'selected-drafts-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  assert.deepEqual(report.consoleErrors, [], 'unexpected console errors'); assert.deepEqual(report.pageErrors, [], 'unexpected page errors'); assert.deepEqual(report.external, [], 'unexpected external requests');
  console.log(`Writing automatic-draft browser: ${report.checks.filter(value => value.pass).length}/${report.checks.length} scenarios; ${report.captures.length} viewport captures. Anonymous HTTP, not operating SQL or Apple hardware.`);
  if (report.checks.some(value => !value.pass)) process.exitCode = 1;
}
module.exports = { WritingCloud };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
