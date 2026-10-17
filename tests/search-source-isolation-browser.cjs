/* Exact source reading must not depend on unrelated workspace/draft queries. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const out = path.resolve(__dirname, '../.local/search-source-isolation');
async function main() {
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await makeContext(browser, new FakeCloud(), 'source-isolation', accounts.a);
  const report = { checks: [], consoleErrors: [], pageErrors: [], scope: 'Anonymous HTTP Auth and real local app/IndexedDB; no personal data, production or Apple proof.' };
  await context.route(base + '/assets/life/storage.js', async route => {
    const response = await route.fetch(), hook = `;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage={...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,
      async listWorkspaces(...args){if(window.__sourceFailLists){window.__sourceListCalls=(window.__sourceListCalls||0)+1;throw new Error('익명 공간 목록 조회 실패');}return actual.listWorkspaces(...args);},
      async listStages(...args){if(window.__sourceFailStages){window.__sourceStageCalls=(window.__sourceStageCalls||0)+1;throw new Error('익명 초안 조회 실패');}return actual.listStages(...args);},
      async read(...args){if(window.__sourceFailRead)throw new Error('익명 원문 읽기 실패');const value=await actual.read(...args);if(window.__sourceHoldRead){window.__sourceReadHeld=true;await new Promise(resolve=>{window.__sourceReleaseRead=()=>{window.__sourceHoldRead=false;resolve();};});}window.__sourceReads=(window.__sourceReads||0)+1;return value;}});}};})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(30000);
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); }); page.on('pageerror', error => report.pageErrors.push(error.message));
  const check = async (name, action) => { await action(); report.checks.push(name); console.log('PASS ' + name); };
  try {
    await page.goto(base + '/index.html'); await ready(page);
    const fixture = await page.evaluate(async () => {
      const s = HaedoLife.Shell.storage, c = HaedoLife.Core; let b = await s.read(await s.getActive());
      const text = '첫 기록🌿\r\n오래 좋아한 기준을 다시 읽는다.', first = await c.prepareImport({ origin: 'obsidian', title: '익명 원문', text }, b);
      const commit = async p => { const result = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, p, []) }); if (result.status !== 'stored') throw Error('Fixture commit failed'); b = await s.read(b.workspaceId); };
      await commit(first); const second = await c.prepareImport({ origin: 'obsidian', title: '익명 원문 최신', existingSourceId: first.source.id, text: '최신 본문에는 검색할 이전 구절이 없다.' }, b); await commit(second);
      return { workspaceId: b.workspaceId, sourceVersionId: first.version.id, text, bundle: b };
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page); await page.locator('#lifeFindOpen').click();
    await page.locator('#lifeFind[aria-busy="false"]').waitFor(); await page.locator('#lifeFindQuery').fill('오래 좋아한');
    const target = () => page.locator('[data-focus-key="find:source:' + fixture.sourceVersionId + '"]'); await target().waitFor();
    await check('workspace-list and draft-list failures cannot block an exact historical source or search return', async () => {
      for (const flag of ['__sourceFailLists', '__sourceFailStages']) {
        await page.evaluate(flag => { window[flag] = true; }, flag); await target().click(); await page.locator('#lifeSourceText').waitFor();
        assert.equal(await page.locator('#lifeSourceText').textContent(), fixture.text); await page.waitForFunction(() => getSelection()?.toString() === '오래 좋아한');
        await page.locator('#lifeSearchReturn').click(); await settle(page); await target().waitFor();
        assert.equal(await page.locator('#lifeFindQuery').inputValue(), '오래 좋아한'); await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, 'find:source:' + fixture.sourceVersionId);
        await page.evaluate(flag => { window[flag] = false; }, flag);
      }
      assert.deepEqual(await page.evaluate(() => ({ workspaces: window.__sourceListCalls || 0, stages: window.__sourceStageCalls || 0 })), { workspaces: 0, stages: 0 });
      assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), fixture.workspaceId), fixture.bundle);
    });
    await check('an actual original-read failure keeps the same query and retry opens the exact old version', async () => {
      await page.evaluate(() => { window.__sourceFailRead = true; }); await target().click(); await settle(page);
      assert.equal(await page.locator('#lifeSourceText').count(), 0); assert.match(await page.locator('#lifeError').textContent(), /익명 원문 읽기 실패/); assert.equal(await page.locator('#lifeFindQuery').inputValue(), '오래 좋아한');
      await page.evaluate(() => { window.__sourceFailRead = false; }); await target().click(); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), fixture.text);
      await page.locator('#lifeSearchReturn').click(); await settle(page); await target().waitFor();
    });
    await check('a held old-account original read cannot render its private body after signout', async () => {
      await page.evaluate(() => { window.__sourceHoldRead = true; }); await target().click(); await page.waitForFunction(() => window.__sourceReadHeld === true);
      const completed = await page.evaluate(() => window.__sourceReads || 0);
      await page.evaluate(() => { window.__sourceSignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); });
      await page.waitForFunction(() => !HaedoLife.Shell.storage && document.querySelector('#lifeApp').hidden);
      await page.evaluate(() => __sourceReleaseRead()); await page.waitForFunction(previous => __sourceReads > previous, completed);
      assert.equal(await page.locator('#lifeSourceText').count(), 0); assert(!(await page.locator('body').innerText()).includes(fixture.text)); assert.equal(await page.evaluate(() => HaedoAuth.user), null);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); report.pass = true;
  } finally { await fs.mkdir(out, { recursive: true }); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); await browser.close(); }
  console.log('Search source isolation: ' + report.checks.length + ' passed.');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
