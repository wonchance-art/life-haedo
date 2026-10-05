/* Record selection -> local group/page composition. Actual bundled SDK and IDB.
 * BASE_URL=http://127.0.0.1:4184 node tests/record-arrange-browser.cjs
 * Anonymous intercepted Auth only; no live Supabase/SNS or Apple-device claims. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe, nav } = require('./unified-home-browser.cjs');
const { fixture, current, seedComposition, abortWorkbenchWrites, go, inspect, oldBody, newBody } = require('./life-workbench-browser.cjs');
const { inspectHome } = require('./home-entry-browser.cjs');
const out = path.resolve(__dirname, '../.local/record-arrange');
const report = { createdAt: new Date().toISOString(), scope: 'Actual app/SDK/IndexedDB; anonymous intercepted Auth, viewport/touch/IME-event simulation only', checks: [], visual: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [], realRemoteWrites: 0 };

async function instrument(context) {
  await context.route(`${base}/assets/life/storage.js`, async route => {
    const response = await route.fetch(), source = await response.text();
    // Capture the real read before holding its response, so stale-data tests do
    // not accidentally test a new read performed after navigation has finished.
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async readWorkbench(...readArgs){const result=await actual.readWorkbench(...readArgs);if(window.__arrangeHoldRead){window.__arrangeReadEntered=true;await new Promise(resolve=>{window.__arrangeReleaseRead=()=>{window.__arrangeHoldRead=false;resolve();};});}window.__arrangeReadsFinished=(window.__arrangeReadsFinished||0)+1;return result;}});}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
  await context.addInitScript(() => {
    window.__arrangeWrites = [];
    for (const method of ['put', 'add', 'delete', 'clear']) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) {
        if (window.__arrangeWatchWrites) __arrangeWrites.push({ store: this.name, method });
        return original.apply(this, args);
      };
    }
  });
}
async function records(page) { await page.goto(base + '/index.html?section=records'); await ready(page); await page.locator('#lifeSelectionToggle').waitFor(); }
async function selectMode(page) { if (await page.locator('#lifeSelectionToggle').getAttribute('aria-pressed') !== 'true') await page.locator('#lifeSelectionToggle').click(); }
async function selectVersion(page, id) { const b = page.locator(`.life-source-select[data-version-id="${id}"]`); await b.waitFor(); if (await b.getAttribute('aria-pressed') !== 'true') await b.click(); }
async function oldSelection(page, f, extra = true) {
  await records(page); await selectMode(page); await page.locator('#lifeSearch').fill('처음 받은 본문'); await selectVersion(page, f.refs[0].versionId);
  if (extra) { await page.locator('#lifeSearch').fill('오후 네 시의 빛'); await selectVersion(page, f.refs[1].versionId); }
}
async function review(page, target, location = '#lifeSelectionBar') {
  await page.locator(`${location} .life-arrange-${target}`).click(); await settle(page); await page.locator('#wbIncomingSelection').waitFor();
}
async function apply(page, title) { if (title != null) await page.locator('#wbIncomingTitle').fill(title); await page.locator('#wbIncomingApply').click(); }
async function waitSaved(page, predicate) {
  await page.waitForFunction(source => { const s=HaedoLife.Shell.storage; return s.getActive().then(id=>s.readWorkbench(id)).then(w=>new Function('w', 'return ('+source+')(w)')(w)); }, predicate.toString());
  return current(page);
}
async function capture(page, scene, size, workbench = false) {
  if (process.env.ARRANGE_VISUAL_SCENES && !process.env.ARRANGE_VISUAL_SCENES.split(',').some(value => value === scene || value === scene + ':' + size.width)) return;
  await page.evaluate(() => document.fonts.ready); await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.mouse.move(size.width - 1, 0);
  const metrics = workbench ? await page.evaluate(inspect) : await page.evaluate(inspectHome, '#lifeMain');
  if (!workbench) metrics.smallInputs = await page.locator('#lifeMain input:not([type=checkbox]),#lifeMain textarea,#lifeMain select').evaluateAll(nodes => nodes.filter(el => el.checkVisibility() && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => ({ id: el.id, size: getComputedStyle(el).fontSize })));
  const file = `${scene}-${size.width}.png`; await page.screenshot({ path: path.join(out, file), fullPage: !scene.includes('many') }); report.visual.push({ scene, file, ...metrics });
  assert(!metrics.horizontalOverflow && !metrics.overflow.length, `${scene}/${size.width} overflow ${JSON.stringify(metrics.overflow)}`);
  assert.deepEqual(metrics.smallTargets, [], `${scene}/${size.width} targets below 44px`);
  assert.deepEqual(metrics.unnamed, [], `${scene}/${size.width} unnamed controls`);
  assert.deepEqual(metrics.smallInputs, [], `${scene}/${size.width} inputs below 16px`);
  assert.deepEqual(metrics.contrastFailures, [], `${scene}/${size.width} text contrast`);
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, run, options = {}) {
    if (process.env.ARRANGE_TEST_MATCH && !new RegExp(process.env.ARRANGE_TEST_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'arrange-' + report.checks.length, context = await makeContext(browser, server, device, accounts.a, options), page = await context.newPage();
    page.setDefaultTimeout(10000); observe(page, report, name); await instrument(context);
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push({ origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient'); });
    try { await run({ page, context, server, device }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, `failure-${report.checks.length}.png`), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    await check('selection spans searches, reviews fixed versions and cancellation writes nothing', async ({ page }) => {
      const f = await fixture(page), before = await current(page); await records(page);
      await page.evaluate(() => { window.__arrangeWatchWrites = true; __arrangeWrites.length = 0; });
      await selectMode(page); await page.locator('#lifeSearch').fill('처음 받은 본문'); await selectVersion(page, f.refs[0].versionId);
      await page.locator('#lifeSearch').fill('오후 네 시의 빛'); await selectVersion(page, f.refs[1].versionId);
      assert.match(await page.locator('#lifeSelectionBar').textContent(), /2/);
      assert.match(await page.locator('#lifeSelectionBar').textContent(), /보이지|다른|밖|숨/);
      await page.getByRole('button', { name: '검색 필터', exact: true }).click(); await page.locator('#lifeOriginFilter').selectOption('apple_notes');
      assert.equal(await page.locator('.life-source-card').count(), 0); assert.match(await page.locator('#lifeSelectionStatus').textContent(), /2/);
      await review(page, 'groups');
      const selected = await page.locator('#wbIncomingSelection input[data-version-id]:checked').evaluateAll(nodes => nodes.map(el => el.dataset.versionId));
      assert.deepEqual(new Set(selected), new Set([f.refs[0].versionId, f.refs[1].versionId]));
      assert.match(await page.locator('#wbIncomingSelection').textContent(), /1\/2|이전 버전/);
      await page.locator('#wbIncomingTitle').fill('적용 전 검토 제목');
      assert.deepEqual(await current(page), before); assert.deepEqual(await page.evaluate(() => __arrangeWrites), []);
      await page.locator('#wbIncomingCancel').click(); await settle(page);
      assert.equal(await page.locator('#lifeSearch').inputValue(), '오후 네 시의 빛');
      assert.equal(await page.locator('#lifeOriginFilter').inputValue(), 'apple_notes'); await page.locator('#lifeOriginFilter').selectOption('');
      assert.equal(await page.locator(`.life-source-select[data-version-id="${f.refs[1].versionId}"]`).getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await current(page), before); assert.deepEqual(await page.evaluate(() => __arrangeWrites), []);
      await page.locator('#lifeSelectionToggle').click(); assert(await page.locator('#lifeSelectionBar').isHidden());
      assert.deepEqual(await current(page), before);
    });
    await check('hidden selections can be removed and a batch stops at one hundred fixed versions', async ({ page }) => {
      await records(page);
      const ids = await page.evaluate(async () => {
        const s=HaedoLife.Shell.storage,c=HaedoLife.Core,b=await s.read(await s.getActive()),put={sources:[],sourceVersions:[],records:[]};
        for(let i=0;i<101;i++) {
          const p=await c.prepareImport({origin:'other',title:'선택 상한 익명 기록 '+i,text:'기록 수가 많아도 선택 범위를 확인합니다. '+i,forceSeparate:true},b),changes=c.buildImportChanges(b,p,[]);
          for(const key of Object.keys(put))put[key].push(...(changes.put?.[key]||[]));
        }
        const r=await s.commitLocal({workspaceId:b.workspaceId,baseRevision:b.revision,operationId:c.id(),changes:{put}}); if(r.status!=='stored')throw new Error('Large anonymous fixture rejected');
        return put.sourceVersions.map(v=>v.id);
      });
      await records(page); const before=await current(page); await selectMode(page);
      for(const id of ids.slice(0,100)) await selectVersion(page,id);
      assert.equal(await page.locator('.life-source-select[aria-pressed="true"]').count(),100);
      await page.locator(`.life-source-select[data-version-id="${ids[100]}"]`).click();
      assert.equal(await page.locator('.life-source-select[aria-pressed="true"]').count(),100);
      assert.match(await page.locator('.life-status').textContent(),/100/);
      await page.locator('#lifeSearch').fill('검색되지 않는 말');
      assert.match(await page.locator('#lifeSelectionStatus').textContent(),/100/);
      await page.locator('#lifeSelectionBar summary').click();
      assert.equal(await page.locator('#lifeSelectionBar .life-selection-list li').count(),100);
      await page.locator('#lifeSelectionBar .life-selection-list li').first().getByRole('button').click();
      assert.match(await page.locator('#lifeSelectionBar summary').textContent(),/99/);
      await page.getByRole('button',{name:'선택 모두 해제',exact:true}).click();
      assert.match(await page.locator('#lifeSelectionBar summary').textContent(),/0/);
      assert(await page.locator('#lifeSelectionBar .life-arrange-page').isDisabled());
      assert.deepEqual(await current(page),before);
    });
    await check('existing group receives a unique union and source coordinates remain intact', async ({ page }) => {
      const f = await fixture(page), ids = await seedComposition(page, f.refs), before = await current(page);
      await oldSelection(page, f); await review(page, 'groups'); await page.locator('#wbIncomingGroup').selectOption(ids.groupId);
      await apply(page); const after = await waitSaved(page, w => w.revision > 0 && w.groups.length === 1);
      assert.deepEqual(after.workbench.groups[0].versionIds, before.workbench.groups[0].versionIds);
      assert.deepEqual(after.bundle, before.bundle); assert.deepEqual(after.workbench.page, before.workbench.page);
      // Add a genuinely new exact version to the same group, then repeat it.
      await records(page); await selectMode(page); await selectVersion(page, f.refs[3].versionId); await review(page, 'groups'); await page.locator('#wbIncomingGroup').selectOption(ids.groupId); await apply(page);
      const changed = await waitSaved(page, w => w.groups[0].versionIds.length === 4);
      assert.deepEqual(changed.workbench.groups[0].versionIds, [...before.workbench.groups[0].versionIds, f.refs[3].versionId]);
      assert.deepEqual(changed.bundle.records, before.bundle.records); assert.deepEqual(changed.bundle.sourceVersions, before.bundle.sourceVersions);
    });
    await check('reader keeps exact old version and quote return through review cancel and new group', async ({ page }) => {
      const f = await fixture(page), before = await current(page); await records(page); await page.locator('#lifeSearch').fill('원문 버전과 위치를 보존할 익명 발췌');
      await page.locator('.life-excerpt-open').click(); await settle(page); await page.waitForFunction(() => getSelection().toString() === '보존할 구절🌱');
      assert.equal(await page.locator('#lifeSourceText').textContent(), oldBody);
      await page.locator('#lifeReaderArrange').click(); assert(await page.locator('#lifeReaderArrangePanel').isVisible());
      await review(page, 'groups', '#lifeReaderArrangePanel');
      assert.deepEqual(await page.locator('#wbIncomingSelection input[data-version-id]:checked').evaluateAll(nodes => nodes.map(el => el.dataset.versionId)), [f.refs[0].versionId]);
      await page.locator('#wbIncomingCancel').click(); await settle(page); assert.equal(await page.locator('#lifeSourceText').textContent(), oldBody);
      await page.waitForFunction(() => getSelection().toString() === '보존할 구절🌱');
      if (!(await page.locator('#lifeReaderArrangePanel').isVisible())) await page.locator('#lifeReaderArrange').click();
      await review(page, 'groups', '#lifeReaderArrangePanel'); await apply(page, '원문을 읽다가 만든 묶음');
      const after = await waitSaved(page, w => w.groups.length === 1); assert.equal(after.workbench.groups[0].title, '원문을 읽다가 만든 묶음');
      assert.deepEqual(after.workbench.groups[0].versionIds, [f.refs[0].versionId]); assert.deepEqual(after.bundle, before.bundle);
    });
    await check('selected page entry is independent, respects toggles and survives backup restore', async ({ page }) => {
      const f = await fixture(page), before = await current(page); await oldSelection(page, f); await review(page, 'page'); await apply(page, '산책과 전시를 다시 읽는 페이지');
      let after = await waitSaved(page, w => w.page.entries.length === 1); const entryId = after.workbench.page.entries[0].id;
      assert.deepEqual(after.workbench.page.entries[0].parts.map(p => p.versionId), [f.refs[0].versionId, f.refs[1].versionId]); assert.deepEqual(after.bundle, before.bundle);
      const entry = page.locator(`article[data-entry-id="${entryId}"]`);
      for (const details of await entry.locator('details').all()) if (!(await details.evaluate(el => el.open))) await details.locator('summary').first().click();
      await entry.getByLabel('내 코멘트', { exact: true }).fill('내가 고른 조각에서 이어진 질문');
      await entry.locator(`[data-part-version-id="${f.refs[1].versionId}"] input[type=checkbox]`).uncheck();
      await page.getByRole('button', { name: '지금 저장', exact: true }).click(); await waitSaved(page, w => w.page.entries[0].note === '내가 고른 조각에서 이어진 질문');
      await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor(); let text = await page.locator('#wbVisitor').textContent();
      assert(text.includes(oldBody)); assert(!text.includes(newBody)); assert(!text.includes('오후 네 시의 빛.')); assert(text.includes('내가 고른 조각에서 이어진 질문'));
      await page.reload(); await ready(page); await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor(); assert((await page.locator('#wbVisitor').textContent()).includes(oldBody));
      await go(page, 'workbench-backup'); after = await current(page); const waiting = page.waitForEvent('download'); await page.locator('#wbBackupDownload').click(); const content = JSON.parse(await fs.readFile(await (await waiting).path(), 'utf8'));
      assert.equal(content.format, 'life-workbench-backup-v1'); assert.deepEqual(content.workbench.page, after.workbench.page); assert.deepEqual(content.sourceBackup.workspace.records, before.bundle.records);
      await page.locator('#wbRestoreFile').setInputFiles({ name: '선택한-기록-사본.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(content)) }); await page.locator('#wbRestoreInstall').click();
      await page.waitForFunction(id => HaedoLife.Shell.storage.getActive().then(active => active !== id), before.bundle.workspaceId); await page.locator('.life-workbench[data-mode="page"]').waitFor(); const restored = await current(page);
      assert.notEqual(restored.workbench.page.entries[0].id, entryId); assert.equal(restored.workbench.page.entries[0].parts[1].enabled, false);
      assert.equal(restored.bundle.sourceVersions.find(v => v.id === restored.workbench.page.entries[0].parts[0].versionId).contentText, oldBody);
      const record = restored.bundle.records[0], ref = record.sourceRefs[0]; assert.equal(restored.bundle.sourceVersions.find(v => v.id === ref.sourceVersionId).contentText.slice(ref.locator.start, ref.locator.end), record.text);
      assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), before.bundle.workspaceId), before.bundle);
    });
    await check('review omission changes only the new page and reader arrange preserves unrelated list selection', async ({ page }) => {
      const f=await fixture(page); await oldSelection(page,f); await review(page,'page');
      await page.locator(`#wbIncomingSelection input[data-version-id="${f.refs[1].versionId}"]`).uncheck();
      await apply(page,'검토에서 원문 하나만 고른 항목'); const after=await waitSaved(page,w=>w.page.entries.length===1);
      assert.deepEqual(after.workbench.page.entries[0].parts.map(p=>p.versionId),[f.refs[0].versionId]);
      await page.getByRole('button',{name:'기록으로 돌아가기',exact:true}).click(); await settle(page);
      assert.equal(await page.locator('.life-source-select[aria-pressed="true"]').count(),0);
      await selectMode(page); await page.locator('#lifeSearch').fill(''); await selectVersion(page,f.refs[2].versionId);
      await page.locator(`.life-source-card[data-version-id="${f.refs[1].versionId}"] .life-source-open`).click(); await settle(page);
      await page.locator('#lifeReaderArrange').click(); await review(page,'groups','#lifeReaderArrangePanel'); await apply(page,'읽던 원문만 따로 담기'); await waitSaved(page,w=>w.groups.length===1);
      await page.getByRole('button',{name:'기록 목록',exact:true}).click(); await settle(page);
      assert.equal(await page.locator(`.life-source-select[data-version-id="${f.refs[2].versionId}"]`).getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('.life-source-select[aria-pressed="true"]').count(),1);
      assert.deepEqual((await current(page)).workbench.page,after.workbench.page);
    });
    await check('write failure preserves one accepted draft, blocks navigation and retries without duplicate', async ({ page }) => {
      const f = await fixture(page), before = await current(page); await oldSelection(page, f, false); await review(page, 'page'); await abortWorkbenchWrites(page, true); await apply(page, '실패해도 한 번만 담기는 기록');
      await page.locator('#wbError').waitFor({ state: 'visible' }); assert.equal(await page.locator('article[data-entry-id]').count(), 1); assert.deepEqual(await current(page), before);
      await page.locator('[data-haedo-section="tools"]').click(); await page.locator('#lifeError').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.life-workbench').getAttribute('data-mode'), 'page'); assert.equal(await page.locator('article[data-entry-id]').count(), 1);
      await abortWorkbenchWrites(page, false); await page.getByRole('button', { name: '다시 저장', exact: true }).click(); const after = await waitSaved(page, w => w.page.entries.length === 1);
      assert.equal(after.workbench.page.entries[0].title, '실패해도 한 번만 담기는 기록'); assert.deepEqual(after.workbench.page.entries[0].parts.map(p => p.versionId), [f.refs[0].versionId]); assert.deepEqual(after.bundle, before.bundle);
    });
    await check('workspace switch clears selection and late review cannot overwrite another section', async ({ page }) => {
      const f = await fixture(page); const other = await page.evaluate(async id => { const s = HaedoLife.Shell.storage, b = await s.createWorkspace('다른 익명 공간'); await s.setActive(id); return b.workspaceId; }, f.workspaceId);
      await oldSelection(page, f, false); await page.evaluate(() => { window.__arrangeHoldRead = true; window.__arrangeReadEntered = false; });
      await page.locator('#lifeSelectionBar .life-arrange-page').click(); await page.waitForFunction(() => __arrangeReadEntered);
      await page.locator('[data-haedo-section="tools"]').click(); await settle(page); const finished = await page.evaluate(() => window.__arrangeReadsFinished || 0);
      await page.evaluate(() => __arrangeReleaseRead()); await page.waitForFunction(n => window.__arrangeReadsFinished > n, finished);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'tools'); assert.equal(await page.locator('#wbIncomingSelection').count(), 0);
      await nav(page, 'manage'); await page.getByRole('button', { name: '자료 관리', exact: true }).click(); await page.locator('#lifeWorkspace').selectOption(other); await settle(page); await nav(page, 'records');
      await page.getByRole('button', { name: '기록 목록', exact: true }).click(); await settle(page); assert.equal(await page.locator('.life-source-select[aria-pressed="true"]').count(), 0);
      assert.equal((await current(page)).bundle.workspaceId, other); assert.equal((await current(page)).workbench.page.entries.length, 0);
      assert.equal(await page.evaluate(async id => (await HaedoLife.Shell.storage.readWorkbench(id)).page.entries.length, f.workspaceId), 0);
    });
    await check('new saved composition preserves pending review and a deleted destination never becomes a new group silently', async ({ page, context }) => {
      const f=await fixture(page),ids=await seedComposition(page,f.refs),original=(await current(page)).bundle;
      await oldSelection(page,f); await review(page,'groups');
      await page.locator('#wbIncomingTitle').fill('검토 중 작성한 새 묶음 이름');
      await page.locator('#wbIncomingGroup').selectOption(ids.groupId);
      await page.locator(`#wbIncomingSelection input[data-version-id="${f.refs[1].versionId}"]`).uncheck();
      const other=await context.newPage(); observe(other,report,'second tab composition edit'); await other.goto(base+'/index.html?section=records'); await ready(other);
      await other.evaluate(async id=>{const s=HaedoLife.Shell.storage,w=await s.readWorkbench(id);w.groups[0].title='다른 탭에서 수정한 묶음';await s.saveWorkbench(id,w,w.revision);},f.workspaceId);
      await page.locator('#wbReloadSaved').click(); await page.waitForFunction(()=>document.querySelector('.life-workbench')?.getAttribute('aria-busy')==='false');
      assert.equal(await page.locator('#wbIncomingTitle').inputValue(),'검토 중 작성한 새 묶음 이름');
      assert.equal(await page.locator('#wbIncomingGroup').inputValue(),ids.groupId);
      assert.deepEqual(await page.locator('#wbIncomingSelection input[data-version-id]:checked').evaluateAll(nodes=>nodes.map(n=>n.dataset.versionId)),[f.refs[0].versionId]);
      await other.evaluate(async id=>{const s=HaedoLife.Shell.storage,w=await s.readWorkbench(id);w.groups=[];await s.saveWorkbench(id,w,w.revision);},f.workspaceId);
      await page.locator('#wbReloadSaved').click(); await page.waitForFunction(()=>document.querySelector('.life-workbench')?.getAttribute('aria-busy')==='false');
      assert.equal(await page.locator('#wbIncomingGroup').inputValue(),ids.groupId); await page.locator('#wbIncomingError').waitFor({state:'visible'});
      assert.match(await page.locator('#wbIncomingError').textContent(),/삭제|없/);
      await page.locator('#wbIncomingApply').click(); assert.equal((await current(page)).workbench.groups.length,0); assert(await page.locator('#wbIncomingSelection').isVisible());
      await page.locator('#wbIncomingGroup').selectOption(''); assert.equal(await page.locator('#wbIncomingTitle').inputValue(),'검토 중 작성한 새 묶음 이름');
      await page.locator('#wbIncomingApply').click(); const after=await waitSaved(page,w=>w.groups.length===1);
      assert.equal(after.workbench.groups[0].title,'검토 중 작성한 새 묶음 이름'); assert.deepEqual(after.workbench.groups[0].versionIds,[f.refs[0].versionId]); assert.deepEqual(after.bundle,original); await other.close();
    });
    await check('pending review disappears across signout and another account', async ({ page, server, device }) => {
      const f = await fixture(page); await oldSelection(page, f, false); await page.evaluate(() => { window.__arrangeHoldRead = true; window.__arrangeReadEntered = false; });
      await page.locator('#lifeSelectionBar .life-arrange-page').click(); await page.waitForFunction(() => __arrangeReadEntered);
      await page.evaluate(() => { window.__arrangeSignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); }); await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage);
      await page.evaluate(() => __arrangeReleaseRead()); await page.waitForFunction(() => HaedoAuth.user === null);
      assert.equal(await page.locator('#wbIncomingSelection').count(), 0); server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-login]').click(); await page.locator('#googleLogin').click();
      await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await nav(page, 'records');
      assert.equal(await page.locator('.life-source-select[aria-pressed="true"]').count(), 0); assert.equal((await current(page)).bundle.sources.length, 0);
      assert.equal(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.read(id); return false; } catch (_) { return true; } }, f.workspaceId), true);
    });
    await check('keyboard selection and Korean composition keep review local until explicit apply', async ({ page }) => {
      const f = await fixture(page); await records(page); const before = await current(page); await page.locator('#lifeSelectionToggle').focus(); await page.keyboard.press('Enter');
      const target = page.locator(`.life-source-select[data-version-id="${f.refs[1].versionId}"]`); await target.focus(); await page.keyboard.press('Space'); assert.equal(await target.getAttribute('aria-pressed'), 'true');
      const focus = await target.evaluate(el => ({ visible: el.matches(':focus-visible'), outline: parseFloat(getComputedStyle(el).outlineWidth) })); assert(focus.visible && focus.outline >= 2);
      await review(page, 'groups'); await page.locator('#wbIncomingTitle').evaluate(el => { el.focus(); el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })); el.value='산책하며 떠오른'; el.dispatchEvent(new InputEvent('input', { bubbles: true, data:'른', isComposing:true })); });
      assert.deepEqual(await current(page), before); await page.locator('#wbIncomingTitle').evaluate(el => { el.value='산책하며 떠오른 질문'; el.dispatchEvent(new InputEvent('input', { bubbles:true, data:' 질문', isComposing:true })); el.dispatchEvent(new CompositionEvent('compositionend', { bubbles:true, data:'질문' })); });
      assert.deepEqual(await current(page), before); await page.locator('#wbIncomingApply').focus(); await page.keyboard.press('Enter'); const after = await waitSaved(page, w => w.groups.length === 1); assert.equal(after.workbench.groups[0].title, '산책하며 떠오른 질문');
    });
    for (const size of [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }]) await check('visual selection empty many review loading and save error ' + size.width, async ({ page }) => {
      await records(page); await capture(page, 'empty', size); const f = await fixture(page, { many: true }); await records(page); await selectMode(page);
      const pick = page.locator(`.life-source-select[data-version-id="${f.refs[1].versionId}"]`); if (size.width < 1440) await pick.tap(); else await pick.click(); await selectVersion(page, f.refs[2].versionId);
      await capture(page, 'many-selected', size); await page.locator('#lifeSearch').fill('처음 받은 본문'); await selectVersion(page, f.refs[0].versionId); await capture(page, 'hidden-selection', size);
      await page.evaluate(() => { window.__arrangeHoldRead = true; window.__arrangeReadEntered = false; }); await page.locator('#lifeSelectionBar .life-arrange-page').click(); await page.waitForFunction(() => __arrangeReadEntered); await capture(page, 'loading', size, true); await page.evaluate(() => __arrangeReleaseRead());
      await page.locator('#wbIncomingSelection').waitFor(); await page.locator('#wbIncomingTitle').fill('산책에서 발견한 오래된 질문과 빛의 방향을 따라 다시 읽는 긴 제목의 기록'); await capture(page, 'review', size, true);
      await abortWorkbenchWrites(page, true); if (size.width < 1440) await page.locator('#wbIncomingApply').tap(); else await page.locator('#wbIncomingApply').click(); await page.locator('#wbError').waitFor({ state: 'visible' }); await capture(page, 'save-error', size, true);
      await abortWorkbenchWrites(page, false); await page.getByRole('button', { name: '다시 저장', exact: true }).click(); await waitSaved(page, w => w.page.entries.length === 1);
    }, { viewport: size, hasTouch: size.width < 1440 });
  } finally {
    await browser.close(); const serialized = JSON.stringify(report, null, 2) + '\n';
    await fs.writeFile(path.join(out, process.env.ARRANGE_TEST_MATCH ? 'recheck-report.json' : 'browser-report.json'), serialized);
    await fs.writeFile(path.join(out, 'run-' + report.createdAt.replace(/[:.]/g, '-') + '.json'), serialized);
  }
  console.log(`Record arrangement: ${report.checks.filter(c => c.pass).length}/${report.checks.length} journeys; ${report.visual.length} visual states; console ${report.consoleErrors.length}; page ${report.pageErrors.length}.`);
  if (report.checks.some(c => !c.pass) || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
