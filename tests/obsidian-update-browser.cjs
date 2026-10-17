/* Anonymous Auth simulator + actual Chrome and account-scoped IndexedDB. No production requests. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { FakeCloud, base } = require('./life-sync-browser.cjs');
const { pack, entries, updates } = require('./fixtures/obsidian-update.cjs');
async function main() {
  await fs.mkdir('.local/obsidian-update', { recursive: true });
  const before = Buffer.from(await (await pack(entries, 'a')).arrayBuffer()), after = Buffer.from(await (await pack(updates)).arrayBuffer());
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
  const report = { sizes: [], pageErrors: [], consoleErrors: [], remoteWrites: 0 };
  try {
    for (const width of [1440, 820, 390]) {
      const server = new FakeCloud(), context = await makeContext(browser, server, 'obsidian-update-' + width, undefined, { viewport: { width, height: 1000 } });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', e => report.pageErrors.push(e.message)); page.on('console', e => { if (e.type() === 'error') report.consoleErrors.push(e.text()); });
      await page.goto(base + '/index.html?section=records'); await ready(page);
      for (const script of ['obsidian-update.js', 'obsidian-update-ui.js']) await page.addScriptTag({ path: path.resolve('assets/life/' + script) });
      await page.evaluate(() => {
        const storage = HaedoLife.Shell.storage; window.__restoreCalls = 0; window.__scope = true; window.__callbackCalls = 0;
        window.__originalIds = null;
        const wrapped = { ...storage, async installWorkspaces(copies) { __restoreCalls++; if (__restoreCalls === 1) throw new Error('익명 저장 실패 · 다시 시도'); return storage.installWorkspaces(copies); } };
        const host = document.createElement('main'); host.style.cssText = 'max-width:920px;margin:32px auto;padding:16px';
        document.querySelector('#lifeApp').hidden = true; document.body.append(host);
        window.__updateUI = HaedoLife.ObsidianUpdateUI.create({ storage: wrapped, isCurrent: () => __scope, onRestored() { __callbackCalls++; if (__callbackCalls === 1) throw new Error('익명 화면 갱신 실패 · 복원 자료 보존'); } });
        __updateUI.mount(host);
      });
      const oldIds = await page.evaluate(async () => (await HaedoLife.Shell.storage.listWorkspaces()).map(w => w.workspaceId));
      const oldActive = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      await page.locator('#obsidianUpdateBefore').setInputFiles({ name: 'anonymous-before.zip', mimeType: 'application/zip', buffer: before });
      await page.locator('#obsidianUpdateAfter').setInputFiles({ name: 'anonymous-after.zip', mimeType: 'application/zip', buffer: after });
      await page.locator('#obsidianUpdateCompare').click(); await page.getByText('검증과 비교를 마쳤습니다.', { exact: false }).waitFor();
      assert.equal(await page.locator('#obsidianUpdateRows input:not(:disabled)').count(), 4);
      await page.locator('#obsidianUpdateRows details summary').first().click(); await page.getByText('# 첫 기록\n😀 한글 원문 [[대상#제목]]', { exact: true }).waitFor(); assert.equal(await page.locator('#obsidianUpdateRows details').first().locator('a').count(), 2);
      await page.locator('#obsidianUpdateRows details summary').first().click();
      await page.locator('#obsidianUpdateSelectAll').click(); await page.locator('#obsidianUpdatePrepare').click(); await page.locator('#obsidianUpdateRestore').waitFor();
      const downloaded = page.waitForEvent('download'); await page.locator('#obsidianUpdateDownload').click(); const download = await downloaded;
      const destination = path.resolve('.local/obsidian-update/' + width + '-anonymous-update.json'); await download.saveAs(destination);
      const json = JSON.parse(await fs.readFile(destination, 'utf8')); assert.equal(json.format, 'life-obsidian-update-v1');
      await page.locator('#obsidianUpdateRestore').click(); await page.getByText('익명 저장 실패 · 다시 시도', { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(async () => (await HaedoLife.Shell.storage.listWorkspaces()).map(w => w.workspaceId)), oldIds);
      await page.locator('#obsidianUpdateRestore').click(); await page.getByText('익명 화면 갱신 실패 · 복원 자료 보존', { exact: true }).waitFor();
      assert.equal(await page.locator('#obsidianUpdateRestore').isDisabled(), true);
      const ids = await page.evaluate(async () => (await HaedoLife.Shell.storage.listWorkspaces()).map(w => w.workspaceId));
      assert.equal(ids.length, oldIds.length + 2); assert.ok(oldIds.every(id => ids.includes(id)));
      assert.equal(await page.evaluate(() => __restoreCalls), 2);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); assert.equal(overflow, false);
      await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: '.local/obsidian-update/' + width + '-restored.png', fullPage: true });
      // Prepared download is reusable as the next base. Repeat comparison must contain no new modifications.
      await page.locator('#obsidianUpdateBefore').setInputFiles(destination); await page.locator('#obsidianUpdateCompare').click(); await page.getByText('검증과 비교를 마쳤습니다.', { exact: false }).waitFor();
      assert.equal(await page.locator('#obsidianUpdateRows input:not(:disabled)').count(), 0);
      // Account change after preview blocks writes in this feature independently of scoped storage.
      await page.locator('#obsidianUpdateBefore').setInputFiles({ name: 'anonymous-before.zip', mimeType: 'application/zip', buffer: before });
      await page.locator('#obsidianUpdateCompare').click(); await page.getByText('검증과 비교를 마쳤습니다.', { exact: false }).waitFor();
      await page.locator('#obsidianUpdateSelectAll').click(); await page.locator('#obsidianUpdatePrepare').click(); await page.locator('#obsidianUpdateRestore').waitFor();
      await page.evaluate(() => { __scope = false; }); await page.locator('#obsidianUpdateRestore').click();
      assert.equal(await page.evaluate(() => __restoreCalls), 2);
      report.remoteWrites += server.requests.filter(r => r.kind === 'write').length;
      report.sizes.push({ width, overflow, retainedWorkspaces: oldIds.length, createdCopies: ids.length - oldIds.length, repeatChanges: 0, storageRetry: true, callbackNoDuplicate: true, accountChangeBlocked: true });
      await context.close();
    }
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []);
    await fs.writeFile('.local/obsidian-update/browser-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
}
(process.env.OBSIDIAN_INTEGRATED === '1' ? integrated : main)().catch(error => { console.error(error); process.exitCode = 1; });

async function integrated() {
  await fs.mkdir('.local/obsidian-update', { recursive: true });
  const before = Buffer.from(await (await pack(entries, 'a')).arrayBuffer()), after = Buffer.from(await (await pack(updates)).arrayBuffer());
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
  const report = { sizes: [], pageErrors: [], consoleErrors: [], remoteWrites: 0 };
  try {
    for (const width of [1440, 820, 390]) {
      const server = new FakeCloud(), context = await makeContext(browser, server, 'obsidian-integrated-' + width, undefined, { viewport: { width, height: 1000 } });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', e => report.pageErrors.push(e.message)); page.on('console', e => { if (e.type() === 'error') report.consoleErrors.push(e.text()); });
      await page.goto(base + '/index.html?section=manage'); await ready(page);
      const oldIds = await page.evaluate(async () => (await HaedoLife.Shell.storage.listWorkspaces()).map(w => w.workspaceId));
      const oldActive = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      await page.locator('#lifeObsidianUpdateOpen').click(); await page.locator('#obsidianUpdateBefore').waitFor();
      await page.locator('#obsidianUpdateBefore').setInputFiles({ name: 'anonymous-before.zip', mimeType: 'application/zip', buffer: before });
      await page.locator('#obsidianUpdateAfter').setInputFiles({ name: 'anonymous-after.zip', mimeType: 'application/zip', buffer: after });
      await page.locator('#obsidianUpdateCompare').click();
      await page.getByText('검증과 비교를 마쳤습니다.', { exact: false }).waitFor();
      await page.locator('#obsidianUpdateRows details summary').first().click();
      await page.getByText('# 첫 기록\n😀 한글 원문 [[대상#제목]]', { exact: true }).waitFor();
      await page.locator('#obsidianUpdateRows details summary').first().click();
      await page.locator('#obsidianUpdateSelectAll').click(); await page.locator('#obsidianUpdatePrepare').click(); await page.locator('#obsidianUpdateRestore').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: '.local/obsidian-update/' + width + '-integrated-review.png', fullPage: true });
      const downloadEvent = page.waitForEvent('download'); await page.locator('#obsidianUpdateDownload').click(); const download = await downloadEvent;
      await download.saveAs(path.resolve('.local/obsidian-update/' + width + '-integrated-anonymous.json'));
      await page.locator('#obsidianUpdateRestore').click(); await page.getByText('새 작업공간 2개로 복원했습니다.', { exact: false }).waitFor();
      await page.waitForFunction(async id => (await HaedoLife.Shell.storage.getActive()) === id, oldActive);
      const ids = await page.evaluate(async () => (await HaedoLife.Shell.storage.listWorkspaces()).map(w => w.workspaceId));
      assert.equal(ids.length, oldIds.length + 2); assert.ok(oldIds.every(id => ids.includes(id)));
      assert.equal(await page.locator('#obsidianUpdateRestore').isDisabled(), true);
      await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: '.local/obsidian-update/' + width + '-integrated-restored.png', fullPage: true });
      await page.reload(); await ready(page);
      const afterReload = await page.evaluate(async () => (await HaedoLife.Shell.storage.listWorkspaces()).map(w => w.workspaceId));
      assert.deepEqual(afterReload.sort(), ids.sort());
      report.remoteWrites += server.requests.filter(r => r.kind === 'write').length;
      report.sizes.push({ width, managementRoute: true, activeWorkspacePreserved: true, oldPreserved: oldIds.length, restored: ids.length - oldIds.length, reloadPreserved: true });
      await context.close();
    }
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []);
    await fs.writeFile('.local/obsidian-update/integration-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
}
