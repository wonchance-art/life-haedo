/* R2 batch journeys: actual Chromium/SDK/IndexedDB with anonymous Auth HTTP.
 * Start npm run dev; node tests/life-batch-browser.cjs. No application packages.
 * File-provider behavior on Apple hardware and real Google OAuth remain untested.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { FakeCloud, platformContext, accounts, base, openManagement, openAccount, openSection } = require('./life-sync-browser.cjs');
function playwright() {
  for (const module of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core', '/opt/codex/cua_node/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(module); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Set PW_MODULE_PATH to an existing Playwright installation.');
}
const file = (name, text) => ({ name, mimeType: /\.md$/i.test(name) ? 'text/markdown' : 'text/plain', buffer: Buffer.isBuffer(text) ? text : Buffer.from(text) });
const errors = [], failures = [];
let passed = 0;
const settle = page => page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]'));
async function click(page, name) {
  if (['기록 검색','원천 기록','가져오기','시간 보기'].includes(name)) await openSection(page, 'records');
  if (['내보내기·사본 복원', '선택 파일 목록'].includes(name)) await openManagement(page);
  if (name === '로그아웃') await openAccount(page);
  await page.getByRole('button', { name, exact: true }).click(); await settle(page);
}
async function ready(page) {
  await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.storage && !document.querySelector('#lifeApp').hidden);
  await page.evaluate(() => HaedoLife.Shell.ready);
}
const stages = page => page.evaluate(async () => HaedoLife.Shell.storage.listStages(await HaedoLife.Shell.storage.getActive()));
const bundle = page => page.evaluate(async () => HaedoLife.Shell.storage.read(await HaedoLife.Shell.storage.getActive()));
const row = (page, index) => page.locator('#lifeBatchList [data-batch-index="' + index + '"]');
async function setBatchFiles(page, files) {
  const picker = page.locator('#lifeBatchFiles');
  if (!(await picker.evaluate(el => el.closest('details').open))) await page.getByText('여러 텍스트 파일 가져오기', { exact: true }).click();
  await picker.setInputFiles(files);
}
async function selectFiles(page, files) {
  await click(page, '가져오기');
  await click(page, '텍스트 파일');
  await setBatchFiles(page, files);
  await page.waitForFunction(() => document.querySelector('#lifeBatchList') && !document.querySelector('#lifeBatchList [data-batch-state="reading"], #lifeBatchList [data-batch-state="saving"], #lifeBatchList [data-batch-state="unread"]'));
}
async function review(page, index) { await row(page, index).getByRole('button', { name: '이 파일 검토', exact: true }).click(); await settle(page); }
async function main() {
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const server = new FakeCloud();
  let number = 0;
  async function check(name, action) {
    if (process.env.BATCH_TEST_MATCH && !new RegExp(process.env.BATCH_TEST_MATCH).test(name)) return;
    const device = 'batch-' + ++number;
    const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block', viewport: { width: 820, height: 1000 } });
    try {
      await platformContext(context, server, device);
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(name + ': ' + error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(name + ': ' + message.text()); });
      await page.goto(base + '/life.html'); await ready(page);
      await action(page, context, device);
      assert.equal(server.writes().length, 0, 'batch selection/review must not opt in to upload');
      passed++; console.log('PASS ' + name);
    } catch (error) { failures.push(name); console.error('FAIL ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  try {
    await check('multiple files remain drafts; partial commit, reload, manual duplicate, source and backup copy', async page => {
      const raw = '첫 줄\r\n🌱 보존할 구절\r\n마지막 줄';
      await selectFiles(page, [file('first.md', raw), file('second.md', raw), file('pending.txt', '아직 검토하지 않은 원문')]);
      let saved = await stages(page);
      assert.equal(saved.length, 3); assert.equal(new Set(saved.map(s => s.batchId)).size, 1);
      assert.deepEqual(saved.map(s => s.batchIndex).sort(), [0, 1, 2]);
      assert.ok(saved.every(s => s.batchTotal === 3 && s.state === 'draft' && !s.appliedResult));
      assert.equal((await bundle(page)).sources.length, 0);
      await row(page, 2).getByRole('button', { name: '건너뛰기 · 초안 유지', exact: true }).click(); await settle(page);
      assert.equal((await stages(page)).find(s => s.batchIndex === 2).state, 'draft');
      await review(page, 0); await click(page, '원문·출처 확인');
      await page.locator('#lifeReviewText').evaluate(el => { const quote = '🌱 보존할 구절', start = el.value.indexOf(quote); el.focus(); el.setSelectionRange(start, start + quote.length); el.dispatchEvent(new Event('select', { bubbles: true })); });
      await page.locator('#lifeExcerptTopic').fill('검토한 자료');
      await click(page, '발췌 후보 추가'); await click(page, '선택한 발췌 모음에 반영');
      saved = await stages(page);
      const applied = saved.find(s => s.batchIndex === 0);
      assert.equal(applied.state, 'applied'); assert.ok(applied.appliedResult.sourceId && applied.appliedResult.sourceVersionId);
      let b = await bundle(page); assert.equal(b.sourceVersions[0].contentText, raw); assert.equal(b.records[0].text, '🌱 보존할 구절');
      assert.equal(b.sourceVersions[0].originalCreatedAt, null);
      assert.equal(b.sourceVersions[0].originalAuthor.relation, 'unknown');
      assert.equal(b.sourceVersions[0].coverage.status, 'unknown');
      const workspaceId = b.workspaceId;
      await page.reload(); await ready(page); await click(page, '선택 파일 목록');
      assert.equal(await row(page, 0).getAttribute('data-batch-state'), 'applied');
      assert.equal(await row(page, 2).getAttribute('data-batch-state'), 'draft');
      await row(page, 0).getByRole('button', { name: '보관한 원문 열기', exact: true }).click(); await settle(page);
      assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
      await page.locator('#lifeBatchReturn').click(); await settle(page);
      await review(page, 1); await click(page, '원문·출처 확인');
      assert.equal(await page.getByRole('button', { name: '자료만 보관', exact: true }).isDisabled(), true);
      await click(page, '별개 자료로 보관'); await click(page, '자료만 보관');
      b = await bundle(page); assert.equal(b.sources.length, 2); assert.equal(b.sourceVersions.length, 2);
      assert.equal((await stages(page)).filter(s => s.state === 'applied').length, 2);
      await selectFiles(page, [file('first.md', raw)]);
      await review(page, 0); await click(page, '원문·출처 확인'); await click(page, '같은 자료로 확인 · 버전 비교'); await click(page, '자료만 보관');
      assert.equal((await bundle(page)).sources.length, 2); assert.equal((await bundle(page)).sourceVersions.length, 2);
      await click(page, '내보내기·사본 복원'); const pending = page.waitForEvent('download'); await click(page, 'JSON 백업');
      const backup = JSON.parse(await fs.readFile(await (await pending).path(), 'utf8'));
      assert.equal(backup.workspace.sourceVersions[0].contentText, raw);
      assert.ok(!JSON.stringify(backup).includes('아직 검토하지 않은 원문'));
      assert.ok(!Object.hasOwn(backup, 'stages'));
      await page.locator('#lifeRestoreFile').setInputFiles(file('copy.json', JSON.stringify(backup))); await settle(page); await click(page, '새 사본으로 복원');
      b = await bundle(page); assert.notEqual(b.workspaceId, workspaceId); assert.equal(b.records[0].text, '🌱 보존할 구절');
      assert.notEqual(b.sourceVersions[0].id, applied.appliedResult.sourceVersionId); assert.equal((await stages(page)).length, 0);
    });
    await check('invalid UTF-8, extension and per-file size fail separately; count and total limits preserve data', async page => {
      await selectFiles(page, [file('ok.txt', '정상 파일'), file('broken.txt', Buffer.from([0xc3, 0x28])), file('unsupported.html', '<p>별도 형식</p>'), file('oversize.md', Buffer.alloc(1024 * 1024 + 1, 65)), file('after.md', '오류 뒤 정상 파일')]);
      assert.equal((await stages(page)).length, 2); assert.equal(await page.locator('#lifeBatchList [data-batch-state="failed"]').count(), 3);
      assert.equal((await bundle(page)).sources.length, 0);
      const before = (await stages(page)).map(s => s.stageId).sort();
      await setBatchFiles(page, Array.from({ length: 11 }, (_, i) => file('count-' + i + '.txt', '합성'))); await settle(page);
      assert.deepEqual((await stages(page)).map(s => s.stageId).sort(), before);
      await setBatchFiles(page, Array.from({ length: 6 }, (_, i) => file('total-' + i + '.txt', Buffer.alloc(1024 * 1024, 65)))); await settle(page);
      assert.deepEqual((await stages(page)).map(s => s.stageId).sort(), before);
      await page.reload(); await ready(page);
      assert.deepEqual((await stages(page)).map(s => s.stageId).sort(), before);
    });
    await check('quota failure cannot mark applied or lose current text; retry retains prior success', async page => {
      await selectFiles(page, [file('saved.txt', '이미 저장한 내용'), file('quota.txt', '실패해도 유지할 현재 내용')]);
      await review(page, 0); await click(page, '원문·출처 확인'); await click(page, '자료만 보관');
      await review(page, 1); await click(page, '원문·출처 확인');
      await page.evaluate(() => { window.__put = IDBObjectStore.prototype.put; window.__quota = 0; IDBObjectStore.prototype.put = function(...args) { const request = __put.apply(this, args); if (this.name === 'staging' && args[0]?.state === 'applied' && args[0]?.batchIndex === 1) { __quota++; throw new DOMException('Anonymous quota failure after applied stage put', 'QuotaExceededError'); } return request; }; });
      try {
        await click(page, '자료만 보관'); assert.ok(await page.evaluate(() => __quota > 0));
        const saved = await stages(page); assert.equal(saved.find(s => s.batchIndex === 1).state, 'draft'); assert.ok(!saved.find(s => s.batchIndex === 1).appliedResult);
        assert.equal((await bundle(page)).sources.length, 1); assert.equal(await page.locator('#lifeImportText').inputValue(), '실패해도 유지할 현재 내용');
      } finally { await page.evaluate(() => { IDBObjectStore.prototype.put = __put; }); }
      await click(page, '자료만 보관'); assert.equal((await bundle(page)).sources.length, 2); assert.equal((await stages(page)).filter(s => s.state === 'applied').length, 2);
    });
    await check('concurrent stage CAS preserves both newer saved draft and current review text', async page => {
      await selectFiles(page, [file('race.txt', '이 화면의 원문')]); await review(page, 0);
      await page.evaluate(async () => { const s = HaedoLife.Shell.storage, list = await s.listStages(await s.getActive()); const draft = list.find(s => s.batchIndex === 0); draft.input.text = '다른 탭에서 보관한 원문'; await s.saveStage(draft); });
      await click(page, '원문·출처 확인');
      assert.equal((await bundle(page)).sources.length, 0); assert.equal((await stages(page))[0].input.text, '다른 탭에서 보관한 원문');
      assert.equal(await page.locator('#lifeImportText').inputValue(), '이 화면의 원문');
      await click(page, '새 검토 사본으로 보관');
      assert.equal((await stages(page)).length, 2); assert.ok((await stages(page)).some(s => s.input.text === '이 화면의 원문'));
      await click(page, '선택 파일 목록');
      await review(page, 0); assert.equal(await page.locator('#lifeImportText').inputValue(), '다른 탭에서 보관한 원문');
      await click(page, '기록 검색'); await page.locator('summary').filter({ hasText: /^검토 중 / }).click();
      await click(page, 'race'); assert.equal(await page.locator('#lifeImportText').inputValue(), '이 화면의 원문');
    });
    await check('failed initial draft save can be edited, saved and reopened without stale memory text', async page => {
      await page.evaluate(() => { const original = IDBObjectStore.prototype.put; window.__draftFailed = false; IDBObjectStore.prototype.put = function(...args) { if (this.name === 'staging' && args[0]?.batchIndex === 0 && !__draftFailed) { __draftFailed = true; throw new DOMException('Anonymous initial draft quota failure', 'QuotaExceededError'); } return original.apply(this, args); }; });
      await selectFiles(page, [file('recover.txt', '최초 파일 내용')]);
      assert.equal((await stages(page)).length, 0); assert.equal(await row(page, 0).getAttribute('data-batch-state'), 'failed');
      await click(page, '입력 확인'); assert.equal(await page.locator('#lifeImportText').inputValue(), '최초 파일 내용');
      await click(page, '본문 붙여넣기');
      await page.locator('#lifeImportText').fill('실패 후 수정하여 보관한 내용'); await click(page, '검토 내용 보관');
      await page.locator('#lifeBatchReturn').click(); await settle(page);
      assert.equal(await row(page, 0).getAttribute('data-batch-state'), 'draft'); await review(page, 0);
      assert.equal(await page.locator('#lifeImportText').inputValue(), '실패 후 수정하여 보관한 내용');
      assert.equal((await stages(page))[0].input.text, '실패 후 수정하여 보관한 내용'); assert.equal((await bundle(page)).sources.length, 0);
    });
    await check('stop discards delayed file result, retains earlier draft, and same selection creates fresh IDs', async page => {
      await click(page, '가져오기');
      await click(page, '텍스트 파일');
      await page.evaluate(() => { window.__arrayBuffer = File.prototype.arrayBuffer; window.__held = false; File.prototype.arrayBuffer = async function() { const value = await __arrayBuffer.call(this); if (this.name === 'held.txt') { __held = true; await new Promise(resolve => { window.__release = resolve; }); } return value; }; });
      const files = [file('first.txt', '먼저 읽은 원문'), file('held.txt', '늦게 읽은 원문'), file('last.txt', '아직 읽지 않은 원문')];
      await setBatchFiles(page, files); await page.waitForFunction(() => window.__held);
      await page.locator('#lifeBatchStop').click(); await page.evaluate(() => __release());
      await page.waitForFunction(() => !document.querySelector('#lifeBatchList [data-batch-state="reading"], #lifeBatchList [data-batch-state="saving"]'));
      let saved = await stages(page); assert.equal(saved.length, 1); const original = saved[0];
      await page.evaluate(() => { File.prototype.arrayBuffer = __arrayBuffer; });
      await setBatchFiles(page, files);
      await page.waitForFunction(() => document.querySelectorAll('#lifeBatchList [data-batch-state="draft"]').length === 3 && !document.querySelector('#lifeBatchStop'));
      saved = await stages(page); assert.equal(saved.length, 4); assert.ok(saved.some(s => s.stageId === original.stageId)); assert.equal(new Set(saved.map(s => s.batchId)).size, 2);
      assert.equal((await bundle(page)).sources.length, 0);
    });
    await check('account switch while reading prevents old text entering new scope or UI', async (page, context, device) => {
      await click(page, '가져오기');
      await click(page, '텍스트 파일');
      await page.evaluate(() => { window.__held = false; const original = File.prototype.arrayBuffer; File.prototype.arrayBuffer = async function() { const value = await original.call(this); __held = true; await new Promise(resolve => { window.__release = resolve; }); return value; }; });
      await setBatchFiles(page, file('old-account.txt', '계정 A 지연 원문')); await page.waitForFunction(() => window.__held);
      assert.equal(await page.evaluate(() => { HaedoAuth.signOut().catch(() => {}); __release(); return document.querySelector('#lifeApp').hidden; }), true);
      await page.waitForFunction(() => location.pathname.endsWith('/index.html') && document.readyState === 'complete');
      server.oauthAccounts.set(device, accounts.b); await page.goto(base + '/login.html?next=life.html'); await page.locator('#googleLogin').click(); await page.waitForURL('**/life.html'); await ready(page);
      assert.equal(await page.evaluate(() => HaedoAuth.user.id), accounts.b.id); assert.equal((await stages(page)).length, 0); assert.equal((await bundle(page)).sources.length, 0);
      assert.doesNotMatch(await page.locator('body').innerText(), /계정 A 지연 원문/);
      await click(page, '로그아웃'); await page.waitForFunction(() => location.pathname.endsWith('/index.html') && document.readyState === 'complete');
      server.oauthAccounts.set(device, accounts.a); await page.goto(base + '/login.html?next=life.html'); await page.locator('#googleLogin').click(); await page.waitForURL('**/life.html'); await ready(page);
      assert.equal((await stages(page)).length, 0, 'late old-account read was saved after disposal');
    });
    if (errors.length) { failures.push('unexpected console/page errors'); console.error(errors.join('\n')); }
    else { passed++; console.log('PASS unexpected console/page errors'); }
  } finally { await browser.close(); }
  console.log(`Batch browser: ${passed} passed, ${failures.length} failed. Anonymous HTTP and Chromium only; Apple File providers untested.`);
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
