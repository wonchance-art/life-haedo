'use strict';
// Independent view/input checks. The integration suite owns the complete A/B,
// public-media and evidence-file journey; its real source fixture is reused here.
process.env.BASE_URL ||= 'http://127.0.0.1:4215';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { LocalSQLMaterialCloud } = require('./material-continuity-sql-fixture.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { seedMaterials, seedPlan, enter, saved, readPreparation } = require('./material-writing-browser.cjs');
const { seedContinuity, call, syncMaterials, shareWorkspace } = require('./material-continuity-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const newSourceOnly = process.argv.includes('--new-source-only');
const output = path.resolve(__dirname, '../.local/material-continuity-visual' + (newSourceOnly ? '-new-source' : ''));
const migration = 'supabase/migrations/20261019005829_life_material_continuity.sql';

async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(output, { recursive: true });
  const databaseBase = (process.env.BLOG_POSTGRES_DATABASE || 'haedo_blog_qa').slice(0, 32);
  const server = new LocalSQLMaterialCloud({ container: process.env.BLOG_POSTGRES_CONTAINER,
    database: databaseBase + '_material_visual_' + process.pid });
  await server.prepare(migration); await server.initialize();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await makeContext(browser, server, 'material-continuity-visual', accounts.a, { viewport: { width: 820, height: 1000 } });
  const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0,
    browser: browser.version(), node: process.version,
    scope: 'Real workbench/preparation/continuity UI, SDK, IndexedDB and isolated PostgreSQL material RPCs. Shared synthetic source fixture and synthetic Auth. Composition events and viewport simulation; no Apple/native IME/Google OAuth, production, installation, merge or deployment claims.' };
  await context.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
    report.external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (message.location().url.startsWith(cloud) && /Failed to load resource:.*ERR_FAILED/.test(message.text()) && server.expectedFailures > report.expectedErrors) report.expectedErrors++;
    else report.consoleErrors.push(message.text());
  });
  const writes = () => server.materialRequests.filter(entry => entry.rpc === 'life_material_put');
  const idle = () => page.waitForFunction(() => {
    const panel = document.getElementById('mcPanel');
    return panel && panel.getAttribute('aria-busy') !== 'true' && !!document.getElementById('mcStatus')?.dataset.state;
  });
  async function panel() { await page.locator('#mcPanel').waitFor(); if (!await page.locator('#mcPanel').evaluate(node => node.open)) await page.locator('#mcPanel > summary').click(); await idle(); }
  async function click(id) { await page.locator(id).click(); await idle(); }
  async function capture(scene, widths = [1440, 820, 390]) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => { document.activeElement?.blur(); document.querySelector('#mcPanel > summary')?.scrollIntoView({ block: 'start', behavior: 'instant' }); });
      const metrics = await page.evaluate(inspect);
      assert.equal(metrics.horizontalOverflow, false, scene + ': overflow');
      for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ': ' + key);
      const file = scene + '-' + width + '.png', fullFile = scene + '-' + width + '-full.png';
      await page.screenshot({ path: path.join(output, file) });
      await page.screenshot({ path: path.join(output, fullFile), fullPage: true });
      report.visual.push({ scene, width, file, fullFile, metrics });
    }
    await page.setViewportSize({ width: 820, height: 1000 });
  }
  async function check(name, run) {
    if (newSourceOnly && !name.startsWith('Receiving a new source')) return;
    console.log('START ' + name); await run(); report.checks.push(name); console.log('PASS ' + name);
  }
  try {
    await page.goto(base + '/index.html'); await ready(page);
    const fixture = await seedMaterials(page), planId = await seedPlan(page, fixture, '다른 기기에서도 정확한 자료와 내 생각으로 완성할 여행 글 🌱');
    const otherId = await seedPlan(page, fixture, '현재 입력을 보존할 두 번째 작성 준비');
    await enter(page, planId); await panel();
    const REMOVED = ['#mcReview', '#mcConsent', '#mcConnect', '#mcList', '#mcReceive', '#mcPause', '#mcCompare', '#mcResolveLocal', '#mcResolveRemote', '#mcOutputReview', '#mcShareOutput'];
    await check('The compact preparation sync status reads cleanly at three widths and offers no review, consent or receive controls', async () => {
      await syncMaterials(page); await enter(page, planId); await panel();
      await page.locator('#mcStatus[data-state="synced"]').waitFor();
      for (const selector of REMOVED) assert.equal(await page.locator(selector).count(), 0, selector);
      assert.match(await page.locator('#mcPanel').innerText(), /모든 기기에 동기화됨/);
      assert.ok(writes().some(entry => entry.body.p_data.plan.id === planId), 'the preparation was sent by the automatic pass');
      assert.ok(writes().some(entry => entry.body.p_data.plan.id === otherId), 'every preparation syncs, not only the open one');
      await capture('compact-synced');
    });
    await check('A background pass never replaces active Korean input, its caret or the selected preparation', async () => {
      const question = page.locator('#mwQuestion'); await question.focus();
      await question.evaluate(node => { window.__mcQuestionNode = node; node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'ㅎ' })); node.value += '\n한글 조합 중'; node.setSelectionRange(3, 5); node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '한글 조합 중' })); });
      const before = { value: await question.inputValue(), plan: await page.locator('#mwPlanSelect').inputValue(), writes: writes().length };
      await page.evaluate(async ({ planId }) => { const s = HaedoLife.Shell.storage, ws = await s.getActive(), state = await s.readMaterialWriting(ws);
        // Another tab/device changes the same preparation while this editor holds unsaved input.
        state.plans.find(p => p.id === planId).title = '다른 곳에서 바꾼 제목'; state.plans.find(p => p.id === planId).updatedAt = new Date().toISOString(); await s.saveMaterialWriting(ws, state, state.revision); }, { planId });
      await syncMaterials(page);
      assert.equal(await question.inputValue(), before.value); assert.equal(await question.evaluate(node => node === window.__mcQuestionNode), true);
      assert.deepEqual(await question.evaluate(node => [node.selectionStart, node.selectionEnd]), [3, 5]);
      assert.equal(await page.locator('#mwPlanSelect').inputValue(), before.plan); assert.equal(writes().length, before.writes, 'the busy workspace is skipped');
      await page.locator('#mwIncoming:not([hidden])').waitFor(); await capture('changed-elsewhere-while-typing', [390]);
      await question.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '한글 조합 중' })));
      await click('#mwLoadIncoming'); await page.locator('#mwIncoming').waitFor({ state: 'hidden' }); await saved(page);
      const titles = await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.readMaterialWriting(await s.getActive())).plans.map(p => [p.title, p.question]); });
      assert.ok(titles.some(([, q]) => q.endsWith('한글 조합 중')), 'the typed input is kept as its own preparation copy');
    });
    await check('A failed automatic send shows one retry that sends the same preparation again', async () => {
      await enter(page, otherId); await panel();
      await page.evaluate(async ({ id }) => { const s = HaedoLife.Shell.storage, ws = await s.getActive(), state = await s.readMaterialWriting(ws); const plan = state.plans.find(p => p.id === id); plan.question = '실패 후 다시 보낼 질문'; plan.updatedAt = new Date().toISOString(); await s.saveMaterialWriting(ws, state, state.revision); }, { id: otherId });
      server.materialFailure = entry => entry.rpc === 'life_material_put'; await syncMaterials(page);
      await page.locator('#mcStatus[data-state="error"]').waitFor(); await page.locator('#mcSync').waitFor(); await capture('sync-retry', [1440, 390]);
      // The failed response is retried with the same durable operation (by this retry or the next background pass).
      await click('#mcSync'); await page.locator('#mcStatus[data-state="synced"]').waitFor();
      const failed = writes().filter(entry => entry.body.p_data.plan.id === otherId && entry.body.p_data.plan.question === '실패 후 다시 보낼 질문');
      assert.ok(failed.length >= 2, 'the aborted send was replayed'); assert.equal(new Set(failed.map(entry => entry.body.p_operation_id)).size, 1, 'the replay reuses the same operation');
      const ws = await page.evaluate(() => HaedoLife.Shell.storage.getActive()), linked = await call(page, 'getState', [ws, otherId]);
      assert.equal(server.rpc(accounts.a.id, 'life_material_get', { p_id: linked.remoteId }).data.plan.question, '실패 후 다시 보낼 질문');
    });
    await check('Receiving a new source in the same workspace updates the parent reader snapshot and returns to the exact preparation', async () => {
      const contexts = [];
      try {
        const devices = [];
        for (const name of ['material-visual-new-source-a', 'material-visual-new-source-b']) {
          const ctx = await makeContext(browser, server, name, accounts.a); contexts.push(ctx);
          await ctx.route('**/*', route => {
            const origin = new URL(route.request().url()).origin;
            if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
            report.external.push(route.request().url()); return route.abort();
          });
          const p = await ctx.newPage(); p.setDefaultTimeout(20000);
          p.on('pageerror', error => report.pageErrors.push(error.message));
          p.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
          await p.goto(base + '/index.html'); await ready(p); devices.push(p);
        }
        const [a, b] = devices, f = await seedContinuity(a, '새 정확 원문을 받아 다시 읽을 준비');
        await shareWorkspace(a, b, f.workspaceId); await syncMaterials(a); await syncMaterials(b);
        const received = { workspaceId: f.workspaceId, planId: f.planId };
        assert.ok((await b.evaluate(ws => HaedoLife.Shell.storage.readMaterialWriting(ws), f.workspaceId)).plans.some(p => p.id === f.planId), 'B received the same preparation');
        // Mount A before B creates the new source: the shell must genuinely have
        // the previous bundle. Reloading the whole page after receive hides this defect.
        await enter(a, f.planId);
        const raw = 'B_ONLY_NEW_ORIGINAL_全文🌱\r\n새 버전의 정확한 원문';
        await b.evaluate(async ({ ws, planId, raw }) => {
          const L = HaedoLife, s = L.Shell.storage, bundle = await s.read(ws);
          const prepared = await L.Core.prepareImport({ origin: 'obsidian', author: '합성 저자', authorRelation: 'other',
            title: 'B에서 새로 추가한 원문', text: raw, url: 'https://example.org/new-exact-original', fileName: 'B신규.md' }, bundle);
          const result = await s.commitLocal({ workspaceId: ws, baseRevision: bundle.revision, operationId: L.Core.id(), changes: L.Core.buildImportChanges(bundle, prepared) });
          if (result.status !== 'stored') throw Error('Synthetic new source commit failed');
          const next = await s.read(ws), state = await s.readMaterialWriting(ws), plan = state.plans.find(p => p.id === planId);
          plan.materials.push(L.MaterialWriting.material(next, prepared.source.id, prepared.version.id, L.Core.id)); plan.updatedAt = new Date().toISOString();
          await s.saveMaterialWriting(ws, state, state.revision);
        }, { ws: received.workspaceId, planId: received.planId, raw });
        await syncMaterials(b);
        // A's open, clean editor reloads by itself after its background pass installs the change.
        await syncMaterials(a); assert.equal(await a.locator('#mwPlanSelect').inputValue(), f.planId);
        const local = await a.evaluate(async ({ ws, planId, raw }) => {
          const s = HaedoLife.Shell.storage, bundle = await s.read(ws), state = await s.readMaterialWriting(ws);
          const version = bundle.sourceVersions.find(v => v.contentText === raw), plan = state.plans.find(p => p.id === planId);
          return { versionId: version.id, sourceId: version.sourceId, materialId: plan.materials.find(m => m.sourceVersionId === version.id).id };
        }, { ws: f.workspaceId, planId: f.planId, raw });
        await a.locator('.mw-material-tab[data-material-id="' + local.materialId + '"]').click();
        const card = a.locator('.mw-material[data-material-id="' + local.materialId + '"]');
        assert.equal(await card.locator('.mw-material-body').inputValue(), raw.replace(/\r\n/g, '\n'));
        await card.locator('.mw-material-open').click();
        await a.locator('#lifeMain[data-mode="source"] .life-reader').waitFor();
        assert((await a.locator('#lifeMain').innerText()).includes('B_ONLY_NEW_ORIGINAL_全文🌱'));
        assert(!(await a.locator('#lifeMain').innerText()).includes('요청한 원문 버전을 찾을 수 없습니다'));
        await a.getByRole('button', { name: '선택 자료 페이지로 돌아가기', exact: true }).click();
        await a.locator('#mwPlanSelect').waitFor(); assert.equal(await a.locator('#mwPlanSelect').inputValue(), f.planId);
        await a.locator('.mw-material-tab[data-material-id="' + local.materialId + '"]').click();
        assert.equal(await a.locator('.mw-material[data-material-id="' + local.materialId + '"] .mw-material-body').inputValue(), raw.replace(/\r\n/g, '\n'));
      } finally { for (const ctx of contexts) await ctx.close(); }
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
    report.materialWrites = writes().length; report.productionWrites = 0; report.pass = true;
  } catch (error) {
    report.pass = false; report.error = error.stack;
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(output, 'failure-dom.json'), JSON.stringify(await page.evaluate(() => ({ text: document.body.innerText, panel: document.getElementById('mcPanel')?.outerHTML })).catch(() => null), null, 2));
    throw error;
  } finally {
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); await browser.close();
  }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { main };
