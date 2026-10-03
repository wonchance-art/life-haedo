/* Read-only visual audit of the app, with synthetic Auth and account-scoped IDB.
 * npm run dev (another terminal), then node scripts/design-audit.cjs.
 * No production credentials/API requests, app source edits or package installs.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, platformContext, cloud, base } = require('../tests/life-sync-browser.cjs');
const project = path.resolve(__dirname, '..');
const out = path.join(project, '.local/design-review/before');
const evidence = path.join(project, 'docs/design-review/evidence/before');
const viewports = [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 820, height: 1000 }, { name: 'phone', width: 390, height: 844 }];
const query = '다시 읽기';
const longText = Array.from({ length: 95 }, (_, index) => {
  if (index === 64) return '🌱 다시 읽기는 같은 문장을 새로운 질문으로 만나는 일이다.\r\n원문과 연결 이유를 함께 남겨 두면 나중에도 생각의 출발점을 찾을 수 있다.';
  return ['기록을 모으는 일보다, 필요한 순간에 기록으로 돌아오는 일이 중요하다.', '책에서 옮긴 문장과 산책 뒤의 메모를 한 주제에 나란히 놓아 본다.', '선택한 자료의 출처를 남기고, 서로 다른 시기의 생각을 서둘러 하나로 합치지 않는다.'][index % 3];
}).join('\r\n\r\n');
const fixtures = [
  { title: '읽었던 문장을 다시 찾는 방법', origin: 'obsidian', texts: [longText, '최근 메모에서는 자료를 모으는 기준을 정리했다. 예전 기록의 원문은 별도 버전으로 보존한다.'], omissions: ['첨부 사진은 포함하지 않음'] },
  { title: '산책 후 남긴 메모', origin: 'apple_notes', texts: ['다시 읽기를 통해 처음에는 지나쳤던 생각을 발견한다.\n산책 중 떠오른 질문: 기억은 얼마나 쉽게 달라질까?'] },
  { title: '다시 읽기와 기록의 연결', origin: 'naver_blog', texts: ['개인 메모와 책의 문장을 한곳에서 비교해 보았다.'], url: 'https://example.invalid/reading-note' },
  { title: '다시 읽기: 저장한 게시물', origin: 'instagram', texts: [''], url: 'https://example.invalid/saved-post', coverage: 'link_only' }
];
function playwright() {
  for (const name of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core', '/opt/codex/cua_node/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Use an existing Playwright installation via PW_MODULE_PATH.');
}
async function ready(page) {
  await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.storage && !document.querySelector('#lifeApp').hidden);
  await page.evaluate(() => HaedoLife.Shell.ready);
}
async function seed(page) {
  return page.evaluate(async specs => {
    const storage = HaedoLife.Shell.storage, core = HaedoLife.Core;
    let bundle = await storage.read(await storage.getActive()); const ids = [];
    for (const spec of specs) {
      const item = { versions: [] }; ids.push(item);
      for (const text of spec.texts) {
        const prepared = await core.prepareImport({ title: spec.title, origin: spec.origin, text, url: spec.url || '',
          authorRelation: spec.origin === 'instagram' ? 'other' : 'self', originalCreatedAt: null,
          coverage: { status: spec.coverage || 'partial', omissions: spec.omissions || [] },
          ...(item.sourceId ? { existingSourceId: item.sourceId } : { forceSeparate: true }) }, bundle);
        prepared.version.importedAt = '2026-10-03T09:30:00.000Z';
        await storage.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision,
          operationId: core.id(), changes: core.buildImportChanges(bundle, prepared, []) });
        item.sourceId = prepared.source.id; item.versions.push(prepared.version.id);
        bundle = await storage.read(bundle.workspaceId);
      }
    }
    return ids;
  }, fixtures);
}
async function audit() {
  await fs.mkdir(out, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const server = new FakeCloud();
  const report = { capturedAt: new Date().toISOString(), browser: browser.version(), engine: 'Linux Chromium, viewport simulation',
    authentication: 'Synthetic account, packaged Supabase SDK, local intercepted HTTP', serviceWorkers: 'blocked for stable current-code comparison',
    fonts: 'Official public font URLs allowed; availability recorded per screenshot', realRemoteWrites: 0, screenshots: [], consoleErrors: [], pageErrors: [], blockedExternalHosts: [] };
  const rootOrigin = new URL(base).origin;
  async function contextFor(name, viewport, seedAccount) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: 'block' });
    await platformContext(context, server, name, seedAccount);
    for (const pattern of ['https://fonts.googleapis.com/**', 'https://fonts.gstatic.com/**', 'https://cdn.jsdelivr.net/**']) await context.unroute(pattern);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === rootOrigin || url.origin === cloud) return route.fallback();
      if (['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'].includes(url.hostname)) return route.continue();
      report.blockedExternalHosts.push(url.hostname); return route.abort('blockedbyclient');
    });
    return context;
  }
  function observe(page, name) {
    page.on('pageerror', error => report.pageErrors.push({ scene: name, message: error.message }));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ scene: name, message: message.text() }); });
  }
  async function capture(page, scene, viewport) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(100);
    const metrics = await page.evaluate(() => {
      const result = document.querySelector('#lifeSearchResults article');
      const reader = document.querySelector('#lifeSourceText');
      const h1 = document.querySelector('h1');
      const font = h1 && getComputedStyle(h1);
      return { horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        firstResultTop: result ? Math.round(result.getBoundingClientRect().top + scrollY) : null,
        resultCount: document.querySelectorAll('#lifeSearchResults article').length,
        documentHeight: document.documentElement.scrollHeight,
        headingFont: font ? { family: font.fontFamily, size: font.fontSize } : null,
        loadedWebFonts: Array.from(document.fonts).filter(f => f.status === 'loaded').map(f => f.family),
        reader: reader ? { scrollTop: reader.scrollTop, selectedText: reader.value.slice(reader.selectionStart, reader.selectionEnd), clientHeight: reader.clientHeight } : null };
    });
    const session = await page.context().newCDPSession(page);
    await session.send('DOM.enable'); await session.send('CSS.enable');
    const document = await session.send('DOM.getDocument');
    const heading = await session.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'h1' });
    metrics.actualHeadingFonts = heading.nodeId ? (await session.send('CSS.getPlatformFontsForNode', { nodeId: heading.nodeId })).fonts.map(font => ({ family: font.familyName, custom: font.isCustomFont })) : [];
    await session.detach();
    const name = scene + '-' + viewport.name + '.png';
    await page.screenshot({ path: path.join(out, name), fullPage: false });
    await page.screenshot({ path: path.join(out, scene + '-' + viewport.name + '-full.png'), fullPage: true });
    // Keep the six desktop/phone viewport images small; all originals remain local.
    if (viewport.name !== 'tablet') await fs.copyFile(path.join(out, name), path.join(evidence, name));
    report.screenshots.push({ scene, viewport, file: name, committedEvidence: viewport.name !== 'tablet', ...metrics });
  }
  try {
    for (const viewport of viewports) {
      const publicContext = await contextFor('audit-public-' + viewport.name, viewport, null);
      const home = await publicContext.newPage(); observe(home, 'home-' + viewport.name);
      await home.goto(base + '/index.html'); await capture(home, 'home', viewport); await publicContext.close();
      const context = await contextFor('audit-life-' + viewport.name, viewport);
      const page = await context.newPage(); observe(page, 'life-' + viewport.name);
      await page.goto(base + '/life.html'); await ready(page); const ids = await seed(page);
      await page.reload(); await ready(page);
      await page.getByRole('button', { name: '원천 기록', exact: true }).click();
      await page.locator('#lifeSearch').fill(query); await capture(page, 'search', viewport);
      assert.equal(await page.locator('#lifeSearchResults article').count(), 4, 'same fixture results at each viewport');
      await page.locator('#lifeSearchResults article[data-version-id="' + ids[0].versions[0] + '"]').getByRole('button', { name: '자료 읽기', exact: true }).click();
      await page.waitForFunction(() => { const e = document.querySelector('#lifeSourceText'); return e?.value.slice(e.selectionStart, e.selectionEnd) === '다시 읽기' && e.scrollTop > 0; });
      await page.locator('#lifeSourceTopic').fill('읽기와 기억'); await page.locator('#lifeSourceNote').fill('새 문장을 찾기 전에, 예전 기록의 질문부터 다시 살펴보기.');
      await page.locator('#lifeSourceText').evaluate(el => { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'center', behavior: 'instant' }); });
      await capture(page, 'reader', viewport);
      await context.close();
    }
    assert.equal(server.writes().length, 0, 'audit never opts into remote uploads');
  } finally {
    await browser.close();
    report.realRemoteWrites = 0; report.syntheticRemoteWrites = server.writes().length;
    report.blockedExternalHosts = [...new Set(report.blockedExternalHosts)];
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ screenshots: report.screenshots.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length,
    horizontalOverflow: report.screenshots.filter(x => x.horizontalOverflow).length, syntheticRemoteWrites: report.syntheticRemoteWrites,
    report: '.local/design-review/before/report.json' }, null, 2));
}
module.exports = { fixtures, query, viewports };
if (require.main === module) audit().catch(error => { console.error(error.message); process.exitCode = 1; });
