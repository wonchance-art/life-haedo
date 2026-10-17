/* Anonymous server receipt and local memo recovery; no production sessions/data. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, cloud, base, openManagement } = require('./life-sync-browser.cjs');
const core = require('../assets/life/core.js');
const output = path.resolve('.local/obsidian-receive');
async function main() {
  const server = new FakeCloud(), remote = core.createWorkspace({ title: '익명 서버 Obsidian 노트' });
  const prepared = await core.prepareImport({ origin: 'obsidian', title: '받은 노트', text: '# 받은 제목\n익명 서버 본문 🌿' }, remote);
  Object.assign(remote, core.applyChanges(remote, core.buildImportChanges(remote, prepared, [])));
  server.rows.set(server.key(accounts.a.id, remote.workspaceId), { id: remote.workspaceId, owner_id: accounts.a.id, revision: 1, title: remote.title, updated_at: remote.updatedAt, data: remote });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await makeContext(browser, server, 'obsidian-receive', accounts.a);
  const report = { checks: [], consoleErrors: [], pageErrors: [], scope: 'Synthetic Auth/server only; real Chromium and IndexedDB. No production or Apple hardware proof.' };
  await context.route('**/assets/life/storage.js', async route => {
    const response = await route.fetch();
    const hook = `;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage={...original,forAccount(...args){const s=original.forAccount(...args);return Object.freeze({...s,
      async saveStage(...args){if(window.__receiveFailDraft)throw new Error('익명 초안 보관 실패');return s.saveStage(...args);},
      async installSyncRemote(...args){const value=await s.installSyncRemote(...args);if(window.__receiveFailRefresh){window.__receiveFailRefresh=false;window.__receiveFailList=true;}return value;},
      async listWorkspaces(...args){if(window.__receiveFailList){window.__receiveFailList=false;throw new Error('익명 수신 목록 조회 실패');}return s.listWorkspaces(...args);}});}};})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('pageerror', error => report.pageErrors.push(error.message));
  const check = async (name, action) => { await action(); report.checks.push(name); console.log('PASS ' + name); };
  const click = async name => { await page.getByRole('button', { name, exact: true }).click(); await settle(page); };
  const active = () => page.evaluate(() => HaedoLife.Shell.storage.getActive());
  const sync = async () => { await openManagement(page); await click('기기 간 동기화'); await click('서버 작업공간 목록 확인'); };
  try {
    await page.goto(base + '/index.html?section=records&view=sources'); await ready(page); await settle(page);
    const original = await page.evaluate(async () => {
      const s = HaedoLife.Shell.storage, c = HaedoLife.Core, b = await s.read(await s.getActive());
      const p = await c.prepareImport({ origin: 'obsidian', title: '원래 로컬 노트', text: '로컬 본문과 보관할 메모' }, b);
      const saved = await s.commitLocal({ operationId: c.id(), workspaceId: b.workspaceId, baseRevision: b.revision, changes: c.buildImportChanges(b, p, []) });
      if (saved.status !== 'stored') throw new Error('Anonymous source seed failed'); return b.workspaceId;
    });
    const originalSnapshot = await page.evaluate(id => HaedoLife.Shell.storage.read(id), original);
    await page.reload(); await ready(page); await settle(page);
    await page.getByRole('button', { name: '자료 읽기: 원래 로컬 노트', exact: true }).click(); await settle(page);
    await click('발췌와 주제 연결'); await page.locator('#lifeSourceNote').fill('보존해야 할 미반영 메모 🌱');
    await sync();
    await check('draft persistence failure stops receipt before any local workspace switch', async () => {
      await page.evaluate(() => { window.__receiveFailDraft = true; });
      await click('이 작업공간 받기');
      assert.equal(await active(), original);
      assert.equal(await page.evaluate(id => HaedoLife.Shell.storage.listWorkspaces().then(rows => rows.some(row => row.workspaceId === id)), remote.workspaceId), false);
      assert.match(await page.locator('#lifeError').innerText(), /익명 초안 보관 실패/);
      await page.evaluate(() => { window.__receiveFailDraft = false; });
    });
    await check('successful receipt durably saves previous memo and switching back remains usable', async () => {
      await click('이 작업공간 받기'); assert.equal(await active(), remote.workspaceId);
      assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), original), originalSnapshot);
      await page.getByRole('button', { name: '자료 읽기: 받은 노트', exact: true }).click(); await settle(page);
      assert.match(await page.locator('#lifeSourceText').innerText(), /익명 서버 본문 🌿/);
      const stages = await page.evaluate(id => HaedoLife.Shell.storage.listStages(id), original);
      assert(stages.some(stage => stage.draftNote === '보존해야 할 미반영 메모 🌱'));
      await openManagement(page); await page.locator('#lifeWorkspace').selectOption(original); await settle(page);
      assert.equal(await active(), original); assert.equal(await page.locator('#lifeError').isVisible(), false);
      assert(stages.every(stage => stage.workspaceId === original));
      assert.equal(server.writes().length, 0);
    });
    await check('received snapshot remains open when subsequent workspace list refresh fails', async () => {
      const second = core.createWorkspace({ title: '익명 서버 보조 파일' });
      server.rows.set(server.key(accounts.a.id, second.workspaceId), { id: second.workspaceId, owner_id: accounts.a.id, revision: 1, title: second.title, updated_at: second.updatedAt, data: second });
      await sync(); await page.evaluate(() => { window.__receiveFailRefresh = true; });
      await page.locator('[data-remote-id="' + second.workspaceId + '"]').getByRole('button', { name: '이 작업공간 받기', exact: true }).click(); await settle(page);
      assert.equal(await active(), second.workspaceId); assert.equal(await page.locator('#lifeRemoteList').count(), 0);
      assert.match(await page.locator('#lifeError').innerText(), /보관.*목록|목록.*보관/);
      await openManagement(page); assert.equal(await page.locator('#lifeWorkspace').inputValue(), second.workspaceId);
      assert.equal(server.writes().length, 0);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); report.pass = true;
  } finally {
    await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await context.close(); await browser.close();
  }
  console.log('Obsidian receive browser checks: ' + report.checks.length + ' passed; console/page errors 0.');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
