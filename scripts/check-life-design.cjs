/* Production material UI visual/interaction audit, anonymous local fixtures only.
 * npm run dev; node scripts/check-life-design.cjs
 * Uses existing Playwright/Chromium. No real account, remote writes or Apple-device claims.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, platformContext, cloud, base, openSection, openManagement } = require('../tests/life-sync-browser.cjs');
const { fixtures: originals, query } = require('./design-audit.cjs');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only a local server is permitted');
const project = path.resolve(__dirname, '..');
const out = path.join(project, '.local/design-review/integration');
const evidence = path.join(project, 'docs/design-review/evidence/integration');
const sizes = [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 820, height: 1000 }, { name: 'phone', width: 390, height: 844 }];
const fixtures = originals.map((item, index) => index ? item : { ...item, title: '읽었던 문장을 다시 찾는 방법 — Apple 메모와 Obsidian, 블로그에 흩어진 기록을 서두르지 않고 연결하며 읽기' }).concat(Array.from({ length: 24 }, (_, i) => ({
  title: ['주말의 산책에서 발견한 질문', '다 읽지 못한 책을 다시 펼치며', '메모를 정리하지 않고도 찾는 연습'][i % 3] + ' ' + (i + 1),
  origin: ['apple_notes', 'obsidian', 'naver_blog'][i % 3],
  texts: ['다시 읽기는 처음의 판단을 확인하는 데서 끝나지 않는다. 어느 대목에서 생각이 바뀌었는지, 앞뒤 문장과 출처를 함께 살펴본다.']
})));
function playwright() {
  for (const name of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core', '/opt/codex/cua_node/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Set PW_MODULE_PATH to an existing Playwright installation.');
}
async function ready(page) {
  await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.storage && !document.querySelector('#lifeApp').hidden);
  await page.evaluate(() => HaedoLife.Shell.ready);
}
const settle = page => page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]'));
async function click(page, name) {
  if (['모아보기', '원천 기록', '가져오기', '시간 보기'].includes(name)) await openSection(page, 'records');
  await page.getByRole('button', { name, exact: true }).click(); await settle(page);
}
async function seed(page) {
  const ids = await page.evaluate(async specs => {
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
        const result = await storage.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision,
          operationId: core.id(), changes: core.buildImportChanges(bundle, prepared, []) });
        if (result.status !== 'stored') throw new Error('Anonymous fixture failed to save');
        item.sourceId = prepared.source.id; item.versions.push(prepared.version.id);
        bundle = await storage.read(bundle.workspaceId);
      }
    }
    return ids;
  }, fixtures);
  await page.reload(); await ready(page); return ids;
}

// Real computed styles over their ancestor surfaces, including input values.
// Native popup menus and OS browser chrome are outside this audit.
function inspect() {
  const visible = el => el.checkVisibility({ visibilityProperty: true }) && !el.closest('[hidden], [inert], .life-sr-only') && el.getBoundingClientRect().width > 1;
  const canvas = document.createElement('canvas').getContext('2d');
  function rgba(value) {
    canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = value; canvas.fillRect(0, 0, 1, 1);
    const c = Array.from(canvas.getImageData(0, 0, 1, 1).data); return [c[0], c[1], c[2], c[3] / 255];
  }
  const over = (a, b) => a.slice(0, 3).map((n, i) => n * a[3] + b[i] * (1 - a[3])).concat(1);
  const background = el => {
    const layers = []; for (let p = el; p; p = p.parentElement) layers.unshift(p);
    return layers.reduce((color, p) => over(rgba(getComputedStyle(p).backgroundColor), color), [255, 255, 255, 1]);
  };
  const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => { const levels = [luminance(a), luminance(b)].sort((x, y) => y - x); return (levels[0] + .05) / (levels[1] + .05); };
  const describe = el => ({ tag: el.tagName.toLowerCase(), id: el.id, text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 80) });
  const contrast = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  function measure(el, placeholder = false) {
    const css = getComputedStyle(el, placeholder ? '::placeholder' : null), bg = background(el);
    const large = parseFloat(css.fontSize) >= 24 || (parseFloat(css.fontSize) >= 18.66 && parseInt(css.fontWeight) >= 700);
    contrast.push({ ...describe(el), placeholder, ratio: +ratio(over(rgba(css.color), bg), bg).toFixed(3), required: large ? 3 : 4.5, size: css.fontSize });
  }
  while (walker.nextNode()) {
    const node = walker.currentNode, el = node.parentElement;
    if (node.textContent.trim() && visible(el) && !el.closest('script, style, option, [disabled], .life-skip')) measure(el);
  }
  const fields = Array.from(document.querySelectorAll('input, select, textarea')).filter(visible).filter(el => !el.disabled);
  for (const el of fields) { measure(el); if (el.placeholder && !el.value) measure(el, true); }
  const interactive = Array.from(document.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex="0"]')).filter(visible).filter(el => !el.disabled && !el.matches('.life-skip'));
  const targets = interactive.map(el => { const target = el.matches('input[type="checkbox"], input[type="radio"]') ? el.closest('label') || el : el; const r = target.getBoundingClientRect(); return { ...describe(el), width: +r.width.toFixed(1), height: +r.height.toFixed(1) }; });
  const unnamed = interactive.filter(el => !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || el.textContent.trim() || el.labels?.[0]?.textContent.trim())).map(describe);
  const focused = document.activeElement, css = getComputedStyle(focused), outline = parseFloat(css.outlineWidth);
  const title = document.querySelector('#lifeSearchResults h3') || document.querySelector('#lifeMain h2');
  const reader = document.querySelector('#lifeSourceText');
  return { viewport: { width: innerWidth, height: innerHeight }, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    contrastFailures: contrast.filter(item => item.ratio < item.required), minimumTextContrast: Math.min(...contrast.map(item => item.ratio)),
    smallTargets: targets.filter(item => item.width < 43.9 || item.height < 43.9), unnamed,
    smallInputs: fields.filter(el => parseFloat(getComputedStyle(el).fontSize) < 16).map(describe),
    focus: { ...describe(focused), visible: focused.matches(':focus-visible'), width: outline,
      contrast: outline ? +ratio(over(rgba(css.outlineColor), background(focused.parentElement)), background(focused.parentElement)).toFixed(3) : null },
    title: title ? { width: title.clientWidth, height: title.clientHeight, lineHeight: getComputedStyle(title).lineHeight, wordBreak: getComputedStyle(title).wordBreak, overflowWrap: getComputedStyle(title).overflowWrap } : null,
    reader: reader ? { width: reader.clientWidth, size: getComputedStyle(reader).fontSize, lineHeight: getComputedStyle(reader).lineHeight, selectedText: getSelection().toString() } : null,
    resultCount: document.querySelectorAll('#lifeSearchResults article').length };
}

async function main() {
  await fs.mkdir(out, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const server = new FakeCloud();
  const report = { capturedAt: new Date().toISOString(), browser: browser.version(), platform: 'Linux Chromium; viewport simulation, no Apple hardware or IME/Files/VoiceOver validation',
    fixture: 'Original before-audit reading text, with a longer title and 24 extra anonymous materials; 28 sources, 29 raw versions',
    authentication: 'Packaged SDK plus FakeCloud interception; no production credentials', webFonts: 'External font CSS mocked empty; local system font fallback',
    checks: [], captures: [], errors: [], consoleErrors: [], pageErrors: [], blockedExternal: [], realRemoteWrites: 0 };
  const check = (name, pass, details) => report.checks.push({ name, pass, ...(details === undefined ? {} : { details }) });
  async function capture(page, scene, size, committed = false) {
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.evaluate(inspect), file = `${scene}-${size.name}.png`;
    if (scene === 'search') {
      const session = await page.context().newCDPSession(page);
      await session.send('DOM.enable'); await session.send('CSS.enable');
      const document = await session.send('DOM.getDocument');
      const title = await session.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#lifeSearchResults h3' });
      metrics.actualTitleFonts = title.nodeId ? (await session.send('CSS.getPlatformFontsForNode', { nodeId: title.nodeId })).fonts.map(font => ({ family: font.familyName, custom: font.isCustomFont })) : [];
      await session.detach();
    }
    await page.screenshot({ path: path.join(out, file) });
    if (committed) await fs.copyFile(path.join(out, file), path.join(evidence, file));
    report.captures.push({ scene, size, file, committed, ...metrics });
    for (const [name, condition, details] of [
      ['no horizontal overflow', !metrics.horizontalOverflow], ['text contrast', !metrics.contrastFailures.length, metrics.contrastFailures],
      ['44px targets', !metrics.smallTargets.length, metrics.smallTargets], ['named controls', !metrics.unnamed.length, metrics.unnamed], ['16px inputs', !metrics.smallInputs.length, metrics.smallInputs]
    ]) check(`${size.name} ${scene}: ${name}`, condition, details);
  }
  async function contextFor(size) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, serviceWorkers: 'block', hasTouch: size.width <= 820 });
    await platformContext(context, server, 'visual-' + size.name);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(base).origin || url.origin === cloud || ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'].includes(url.hostname)) return route.fallback();
      report.blockedExternal.push(url.hostname); return route.abort('blockedbyclient');
    });
    return context;
  }
  async function toggle(page, name, panel, open) {
    if (name === '자료 관리' && open) await openManagement(page);
    const button = page.getByRole('button', { name, exact: true });
    if (await button.getAttribute('aria-expanded') !== String(open)) {
      if (page.viewportSize().width <= 820) await button.tap(); else await button.click();
    }
    assert.equal(await page.locator(panel).isVisible(), open, name + ' visibility follows control');
    assert.equal(await button.getAttribute('aria-expanded'), String(open));
  }
  try {
    for (const size of sizes) {
      const context = await contextFor(size), page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ size: size.name, message: message.text() }); });
      page.on('pageerror', error => report.pageErrors.push({ size: size.name, message: error.message }));
      try {
        let release; const gate = new Promise(resolve => { release = resolve; });
        await context.route(`${cloud}/auth/v1/user`, async route => { await gate; return route.fallback(); });
        await page.goto(base + '/life.html', { waitUntil: 'domcontentloaded' });
        await page.locator('#lifeStartup').waitFor({ state: 'visible' });
        await capture(page, 'loading', size, size.name === 'tablet'); release();
        await ready(page); await context.unroute(`${cloud}/auth/v1/user`);
        await openSection(page, 'manage');
        await page.locator('#lifeAccountToggle').focus(); await page.keyboard.press('Enter');
        check(`${size.name} account menu opens by keyboard`, await page.locator('#lifeLogout').isVisible());
        await page.keyboard.press('Escape');
        check(`${size.name} account Escape closes and returns focus`, await page.locator('#lifeLogout').isHidden() && await page.locator('#lifeAccountToggle').evaluate(el => el === document.activeElement));
        await toggle(page, '자료 관리', '#lifeManagement', true); await capture(page, 'management', size);
        await toggle(page, '자료 관리', '#lifeManagement', false);
        await click(page, '원천 기록'); await capture(page, 'empty', size, size.name === 'phone');
        const ids = await seed(page); await click(page, '원천 기록');
        await page.locator('#lifeSearch').fill(query);
        assert.equal(await page.locator('#lifeSearchResults article').count(), 28);
        await page.locator('#lifeSearch').focus(); await page.keyboard.press('Tab');
        let focus = await page.evaluate(inspect);
        check(`${size.name} keyboard focus has visible 3px ring`, focus.focus.visible && focus.focus.width >= 3 && focus.focus.contrast >= 3, focus.focus);
        await page.evaluate(() => document.activeElement.blur()); await page.mouse.move(size.width / 2, 10);
        await capture(page, 'search', size, true);
        await toggle(page, '검색 필터', '#lifeSearchFilters', true);
        await page.locator('#lifeOriginFilter').selectOption('obsidian');
        const filtered = await page.locator('#lifeSearchResults article').count(); assert(filtered > 0 && filtered < 28);
        await toggle(page, '검색 필터', '#lifeSearchFilters', false);
        check(`${size.name} closed filter keeps selected condition visible`, /Obsidian/.test(await page.locator('#lifeSearchCount').innerText()));
        await capture(page, 'filtered', size);
        await toggle(page, '검색 필터', '#lifeSearchFilters', true); await page.locator('#lifeOriginFilter').selectOption('');
        await toggle(page, '검색 필터', '#lifeSearchFilters', false);
        const open = page.locator(`#lifeSearchResults article[data-version-id="${ids[0].versions[0]}"]`).getByRole('button', { name: /^자료 읽기/ });
        await open.click(); await settle(page);
        await page.waitForFunction(expected => getSelection().toString() === expected, query);
        const text = await page.locator('#lifeSourceText').textContent(); assert.equal(text, fixtures[0].texts[0]);
        assert.equal(await page.locator('#lifeExcerptPanel').isVisible(), false, 'selection must not auto-open editor');
        await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await capture(page, 'reader', size, true);
        await toggle(page, '출처 정보', '#lifeSourceDetails', true);
        assert.match(await page.locator('#lifeSourceDetails').innerText(), /첨부 사진은 포함하지 않음/);
        await capture(page, 'source-details', size);
        await toggle(page, '출처 정보', '#lifeSourceDetails', false);
        await toggle(page, '발췌와 주제 연결', '#lifeExcerptPanel', true);
        await click(page, '키보드로 구절 선택');
        // Extend the existing real search selection. Readonly native textarea
        // ArrowLeft does not reliably collapse/move its caret in Chromium.
        for (let index = 0; index < query.length; index++) await page.keyboard.press('Shift+ArrowRight');
        const excerptStart = fixtures[0].texts[0].indexOf(query);
        const excerptText = fixtures[0].texts[0].slice(excerptStart, excerptStart + query.length * 2);
        check(`${size.name} keyboard Shift selection preserves excerpt`, await page.locator('#lifeSelectedQuote').textContent() === excerptText);
        await click(page, '키보드로 구절 선택');
        await page.locator('#lifeSourceTopic').fill('읽기와 기억');
        await page.locator('#lifeSourceNote').fill('새 문장을 찾기 전에, 예전 기록의 질문부터 다시 살펴보기.');
        await page.locator('#lifeExcerptPanel').scrollIntoViewIfNeeded(); await capture(page, 'excerpt', size, size.name === 'phone');
        await page.keyboard.press('Escape');
        check(`${size.name} excerpt Escape closes panel and returns focus`, await page.locator('#lifeExcerptPanel').isHidden() && await page.getByRole('button', { name: '발췌와 주제 연결', exact: true }).evaluate(el => el === document.activeElement));
        await toggle(page, '발췌와 주제 연결', '#lifeExcerptPanel', true);
        assert.equal(await page.locator('#lifeSourceTopic').inputValue(), '읽기와 기억');
        await click(page, '선택 구절 모음에 추가');
        const stored = await page.evaluate(async () => HaedoLife.Shell.storage.read(await HaedoLife.Shell.storage.getActive()));
        const record = stored.records.find(record => record.topic === '읽기와 기억');
        assert.equal(record.text, excerptText); assert.equal(record.sourceRefs[0].sourceVersionId, ids[0].versions[0]);
        assert.deepEqual(record.sourceRefs[0].locator, { start: excerptStart, end: excerptStart + excerptText.length });
        await page.locator('#lifeSearchReturn').click(); await settle(page);
        assert.equal(await page.locator('#lifeSearch').inputValue(), query);
        check(`${size.name} result focus restored`, await open.evaluate(el => el === document.activeElement));
        await open.click(); await settle(page);
        await page.locator('#lifeVersion').evaluate(el => el.add(new Option('확인할 수 없는 버전', '00000000-0000-4000-8000-000000000099')));
        await page.locator('#lifeVersion').selectOption('00000000-0000-4000-8000-000000000099'); await settle(page);
        assert.match(await page.locator('#lifeMain').innerText(), /요청한 원문 버전을 찾을 수 없습니다/);
        await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await capture(page, 'error', size, size.name === 'phone');
        await page.locator('#lifeSearchReturn').click(); await settle(page);
        await page.locator('#lifeSearch').fill('없는검증자료'); await capture(page, 'no-results', size);
        assert.equal(await page.locator('#lifeSearchResults article').count(), 0);
        if (size.name === 'tablet') {
          await page.setViewportSize({ width: 1180, height: 820 }); await page.locator('#lifeSearch').fill(query);
          await capture(page, 'landscape', { name: 'landscape', width: 1180, height: 820 });
        }
        if (size.name === 'phone') {
          await click(page, '가져오기'); await capture(page, 'import', size);
          for (const [name, scene] of [['내보내기·사본 복원', 'transfer'], ['기기 간 동기화', 'sync']]) {
            await toggle(page, '자료 관리', '#lifeManagement', true); await click(page, name);
            await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await capture(page, scene, size);
          }
        }
        await page.emulateMedia({ reducedMotion: 'reduce' });
        check(`${size.name} reduced motion removes icon transitions`, await page.locator('.life-icon-button').first().evaluate(el => getComputedStyle(el).transitionDuration === '0s'));
        check(`${size.name} search/read/excerpt/return/error recovery`, true);
      } catch (error) { report.errors.push({ size: size.name, message: error.message }); }
      finally { await context.close(); }
    }
    check('no synthetic remote writes', server.writes().length === 0);
    check('no console errors', report.consoleErrors.length === 0, report.consoleErrors);
    check('no page errors', report.pageErrors.length === 0, report.pageErrors);
    check('no unexpected external requests', report.blockedExternal.length === 0, report.blockedExternal);
  } finally {
    await browser.close(); report.syntheticRemoteWrites = server.writes().length;
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  const failures = report.checks.filter(item => !item.pass);
  console.log(JSON.stringify({ captures: report.captures.length, committedEvidence: report.captures.filter(item => item.committed).length,
    passed: report.checks.length - failures.length, failures, errors: report.errors, report: '.local/design-review/integration/report.json' }, null, 2));
  if (failures.length || report.errors.length) process.exitCode = 1;
}
module.exports = { fixtures, inspect };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
