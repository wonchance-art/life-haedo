/* Synthetic 3,479-note vault through the actual app and account-scoped IndexedDB.
 * No private vault, operating account, remote writes or Apple-device claims. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, cloud, base, openAccount } = require('./life-sync-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve('.local/obsidian-reading-scale');
const report = { checks: [], timings: [], visual: [], consoleErrors: [], pageErrors: [], external: [],
  scope: 'Synthetic 3479-note vault, intercepted anonymous Auth, real IndexedDB; no operating data, remote upload or Apple hardware.' };
async function main() {
  await fs.mkdir(out, { recursive: true });
  const { buildVault } = await import('../scripts/lib/obsidian-vault.mjs');
  const entries = Array.from({ length: 3479 }, (_, index) => ({ path: `notes/기록 ${index}.md`, bytes: Buffer.from(
    '\ufeff🌱\r\n# 합성 기록 ' + index + '\r\n' + '관찰 기록의 원문을 그대로 보관한다. '.repeat(24) +
    (index === 0 ? '\r\n시작표식 [[기록 3478#정확 목적지]] [[기록 3478#다른 목적지]]\r\n' : '') +
    (index === 3478 ? '\r\n# 정확 목적지\r\n옛 원문의 목적지\r\n# 다른 목적지\r\n같은 버전의 다른 위치\r\n<script>throw Error("inert source")</script>' : '')
  ) }));
  const imported = await buildVault(entries, { repositoryUrl: 'https://github.com/example/synthetic-notes', ref: 'c'.repeat(40), title: '합성 대규모 읽기' });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version();
  const server = new FakeCloud(), context = await makeContext(browser, server, 'obsidian-reading-scale', accounts.a, { viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
    report.external.push(origin); return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  const check = async (name, fn) => { await fn(); report.checks.push(name); console.log('PASS ' + name); };
  const digest = () => page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, bundle = await s.read(await s.getActive());
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(bundle)))), b => b.toString(16).padStart(2, '0')).join('');
  });
  const timedQuery = async (selector, value) => {
    const started = Date.now(); await page.locator(selector).fill(value);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    report.timings.push({ selector, query: value, elapsedMs: Date.now() - started });
  };
  let refs, before;
  try {
    await page.goto(base + '/index.html'); await ready(page);
    refs = await page.evaluate(async backup => {
      const c = HaedoLife.Core, s = HaedoLife.Shell.storage, b = await c.restoreBackup(backup);
      const start = b.sources.find(source => source.sourceKey === 'notes/기록 0.md');
      const target = b.sources.find(source => source.sourceKey === 'notes/기록 3478.md');
      const oldVersion = b.sourceVersions.find(version => version.sourceId === target.id);
      const newer = await c.prepareImport({ origin: 'obsidian', title: target.title, existingSourceId: target.id, text: '# 최신 목적지\n원래 목적지와 다른 새 본문', coverage: 'full_text', authorRelation: 'self' }, b);
      const updated = c.applyChanges(b, c.buildImportChanges(b, newer));
      await s.installWorkspace(updated);
      return { workspaceId: updated.workspaceId, startId: start.id, targetId: target.id, oldVersionId: oldVersion.id, oldText: oldVersion.contentText, newVersionId: newer.version.id,
        corpus: { notes: updated.sources.length, versions: updated.sourceVersions.length, links: updated.links.length, bodyUtf16Units: updated.sourceVersions.reduce((sum, version) => sum + version.contentText.length, 0) } };
    }, imported.notesBackup);
    report.corpus = refs.corpus;
    await page.goto(base + '/index.html?section=records&view=sources'); await ready(page); await settle(page); before = await digest();
    await check('3479 notes retain bounded 40/80 source results and full search counts', async () => {
      assert.equal(await page.locator('.life-source-card').count(), 40);
      await timedQuery('#lifeSearch', '관찰 기록');
      assert.match(await page.locator('#lifeSearchCount').textContent(), /자료 3479개.*40개 표시/);
      await page.locator('#lifeSearchMore').click();
      assert.equal(await page.locator('.life-source-card').count(), 80);
    });
    await check('Source search follows an exact old-version heading and returns to the same query and result', async () => {
      await timedQuery('#lifeSearch', '시작표식');
      await page.getByRole('button', { name: '자료 읽기: 기록 0', exact: true }).click();
      await page.locator('.life-obsidian-links > summary').click();
      await page.locator('[data-linked-version="' + refs.oldVersionId + '"]').first().waitFor();
      assert.equal(await page.locator('[data-linked-version="' + refs.oldVersionId + '"]').count(), 2, 'different target headings in one note must remain individually reachable');
      const names = await page.locator('[data-linked-version="' + refs.oldVersionId + '"]').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
      assert.equal(new Set(names).size, 2); assert(names.some(name => name?.includes('# 정확 목적지'))); assert(names.some(name => name?.includes('# 다른 목적지')));
      for (const width of [1440, 820, 390]) {
        await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready);
        await page.locator('.life-obsidian-links').scrollIntoViewIfNeeded();
        const metrics = await page.evaluate(inspect); report.visual.push({ scene: 'distinct-heading-links', width, metrics });
        assert.equal(metrics.horizontalOverflow, false);
        for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], 'heading links ' + key);
        await page.screenshot({ path: path.join(out, 'links-' + width + '.png') });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      const firstTarget = page.locator('.life-obsidian-links .life-backup-source').filter({ hasText: '# 정확 목적지' }).locator('[data-linked-version="' + refs.oldVersionId + '"]');
      assert.equal(Number(await firstTarget.getAttribute('data-linked-start')), refs.oldText.indexOf('# 정확 목적지'));
      await firstTarget.click();
      await page.waitForFunction(() => getSelection()?.toString() === '# 정확 목적지');
      assert.equal(await page.locator('#lifeSourceText').textContent(), refs.oldText);
      assert.equal(await page.locator('#lifeVersion').inputValue(), refs.oldVersionId);
      assert.notEqual(refs.oldVersionId, refs.newVersionId);
      assert.equal(await page.locator('#lifeSearchReturn').count(), 1, 'following a note link must preserve the original search return');
      await page.locator('#lifeSearchReturn').click();
      await page.waitForFunction(() => document.activeElement?.dataset.sourceId === document.querySelector('.life-source-open')?.dataset.sourceId);
      assert.equal(await page.locator('#lifeSearch').inputValue(), '시작표식');
      assert.equal(await page.locator('.life-source-open').getAttribute('data-source-id'), refs.startId);
      await page.locator('.life-source-open').click(); await page.locator('.life-obsidian-links > summary').click();
      await page.locator('.life-obsidian-links .life-backup-source').filter({ hasText: '# 다른 목적지' }).locator('[data-linked-version="' + refs.oldVersionId + '"]').click();
      await page.waitForFunction(() => getSelection()?.toString() === '# 다른 목적지');
      assert.equal(await page.locator('#lifeVersion').inputValue(), refs.oldVersionId);
      assert.equal(await page.locator('#lifeSourceText').textContent(), refs.oldText);
      await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor();
    });
    await check('Unified search bounds large results and keeps query, expanded count and exact result focus after note links', async () => {
      await page.locator('#lifeFindOpen').click(); await page.locator('#lifeFind[aria-busy="false"]').waitFor();
      await timedQuery('#lifeFindQuery', '관찰 기록');
      assert.match(await page.locator('.life-find-tabs [data-kind="source"]').textContent(), /3479/);
      assert.equal(await page.locator('.life-find-result[data-kind="source"]').count(), 5);
      await page.getByRole('button', { name: '원문 20개 더 보기', exact: true }).click();
      assert.equal(await page.locator('.life-find-result[data-kind="source"]').count(), 25);
      const first = page.locator('.life-find-result[data-kind="source"]').first();
      const key = await first.getAttribute('data-focus-key');
      await first.click(); await page.locator('.life-obsidian-links > summary').click();
      await page.locator('.life-obsidian-links .life-backup-source').filter({ hasText: '# 정확 목적지' }).locator('[data-linked-version="' + refs.oldVersionId + '"]').click();
      await page.waitForFunction(() => getSelection()?.toString() === '# 정확 목적지');
      await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeFind[aria-busy="false"]').waitFor();
      await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, key);
      assert.equal(await page.locator('#lifeFindQuery').inputValue(), '관찰 기록');
      assert.equal(await page.locator('.life-find-result[data-kind="source"]').count(), 25);
      assert.equal(await digest(), before);
    });
    await check('Switching accounts in the same browser isolates existing IndexedDB notes and restores the original account intact', async () => {
      const login = async account => {
        await openAccount(page);
        const previousDocument = await page.evaluate(() => window.__homeInstance);
        await page.getByRole('button', { name: '로그아웃', exact: true }).click();
        // The authenticated view and logout redirect both use index.html.
        // Wait for the new document before starting the next login navigation.
        await page.waitForFunction(previous => window.__homeInstance && window.__homeInstance !== previous, previousDocument);
        await page.waitForFunction(() => globalThis.HaedoAuth && !HaedoAuth.user && location.pathname.endsWith('/index.html'));
        server.oauthAccounts.set('obsidian-reading-scale', account);
        await page.goto(base + '/login.html?next=life.html');
        await page.locator('#googleLogin').click();
        await page.waitForURL('**/life.html'); await ready(page);
        await page.waitForFunction(id => HaedoAuth.user?.id === id, account.id);
        await page.goto(base + '/index.html?section=records&view=find'); await ready(page);
        await page.locator('#lifeFind[aria-busy="false"]').waitFor();
      };
      await login(accounts.b);
      assert.equal(await page.locator('#lifeFindQuery').inputValue(), '');
      await page.locator('#lifeFindQuery').fill('관찰 기록'); assert.equal(await page.locator('.life-find-result').count(), 0);
      const isolated = await page.evaluate(async id => {
        const s = HaedoLife.Shell.storage;
        let denied = false; try { await s.read(id); } catch (_) { denied = true; }
        return { denied, listed: (await s.listWorkspaces()).some(row => row.workspaceId === id) };
      }, refs.workspaceId);
      assert.deepEqual(isolated, { denied: true, listed: false });
      await login(accounts.a); assert.equal(await digest(), before);
      await page.locator('#lifeFindQuery').fill('관찰 기록');
      assert.match(await page.locator('.life-find-tabs [data-kind="source"]').textContent(), /3479/);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
    assert.equal(server.writes().length, 0); report.pass = true;
  } finally { await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
