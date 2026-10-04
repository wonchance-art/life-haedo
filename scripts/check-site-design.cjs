/* Whole-site design comparison using an immutable before server and anonymous fixtures.
 * BASE_URL=http://127.0.0.1:4174 SITE_DESIGN_PHASE=before node scripts/check-site-design.cjs
 * SITE_DESIGN_PHASE=after node scripts/check-site-design.cjs
 * No real account, remote records, Apple hardware, native IME or Files verification.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base, openManagement } = require('../tests/life-sync-browser.cjs');
const { playwright, ready, shellReady, nav, makeContext, observe } = require('../tests/unified-home-browser.cjs');
const { seed } = require('./check-life-collections-design.cjs');
const phase = process.env.SITE_DESIGN_PHASE || 'after';
assert(['before', 'after'].includes(phase));
const selectedScenes = new Set((process.env.SITE_DESIGN_SCENES || '').split(',').filter(Boolean));
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.local/life-design-site', phase, 'visual');
const evidence = path.join(root, 'docs/design-review/evidence/life-design-site');
const sizes = [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 820, height: 1000 }, { name: 'phone', width: 390, height: 844 }];
const stamp = '2026-10-04T00:00:00.000Z';
const titles = ['좋은 문장을 모으는 일에서 그 문장을 다시 읽고 내 생각과 연결하는 일까지 천천히 이어 가기', '산책 중에 남긴 질문을 책의 한 문단과 함께 읽기', '메모에 남긴 출처를 확인하고 다음 주에 다시 읽기', '짧은 기록을 모아 한 달의 변화를 돌아보기'];
function fixtures() {
  const docs = Array.from({ length: 8 }, (_, i) => ({ id: 'd_site_' + i, name: titles[i % titles.length] + (i ? ' ' + (i + 1) : ''), updated_at: stamp,
    data: { profile: { name: '익명 읽기 기록', birth: '2024-01' }, scale: 'signed1',
      events: Array.from({ length: 8 }, (_, j) => ({ date: `2026-${String(j + 1).padStart(2, '0')}-15`, title: titles[j % titles.length], desc: '산책 메모와 도서관에서 읽은 문장을 다시 살펴본 익명 기록입니다.', happiness: (j % 5 - 2) / 2 })),
      spans: [{ start: '2026-02', end: '2026-05', title: '천천히 다시 읽은 기간', color: '#2E5E63' }], eras: [], happiness: [], thoughts: [], records: [], trips: [], layers: [] } }));
  const items = ['goal', 'habit'].flatMap(kind => Array.from({ length: 8 }, (_, i) => ({ id: `${kind}-site-${i}`, kind, name: titles[i % titles.length], updated_at: stamp,
    data: kind === 'goal' ? { title: titles[i % titles.length], progress: i * 10, target: '2026-11-30' } : { title: titles[i % titles.length], created: '2026-09-01', days: [0, 1, 2, 3, 4, 5, 6], checks: ['2026-10-01', '2026-10-03'] } })));
  return { docs, items };
}
const representatives = new Set(['home-feed-desktop', 'home-tools-desktop', 'home-manage-phone', 'home-transfer-phone', 'login-phone', 'goals-list-desktop', 'goals-form-phone', 'habits-list-phone', 'habits-form-tablet', 'workspace-list-desktop', 'workspace-manage-phone', 'timeline-chart-desktop', 'timeline-chart-phone', 'timeline-records-tablet', 'timeline-form-phone', 'home-error-phone']);
async function clean(page) { await page.evaluate(() => document.activeElement.blur()); await page.mouse.move(0, 0); }
async function platformReady(page) { await page.waitForFunction(() => globalThis.HaedoAuth?.user && document.querySelector('[data-private]')?.hidden === false && !document.querySelector('#syncRetry')?.disabled); }
// Shared computed-style audit logic extended to generic platform skip links and native controls.
function inspect() {
  const visible = el => el.checkVisibility({ visibilityProperty: true }) && !el.closest('[hidden], [inert], .life-sr-only, .sr-only') && !el.matches('.skip-link:not(:focus), .life-skip:not(:focus)') && el.getBoundingClientRect().width > 1;
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
  const describe = el => ({ tag: el.tagName.toLowerCase(), id: el.id, class: el.getAttribute('class') || '', text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 80) });
  const contrast = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  function measure(el, placeholder = false) {
    const css = getComputedStyle(el, placeholder ? '::placeholder' : null), bg = background(el);
    const large = parseFloat(css.fontSize) >= 24 || (parseFloat(css.fontSize) >= 18.66 && parseInt(css.fontWeight) >= 700);
    const painted = el instanceof SVGElement ? css.fill : css.color;
    const ink = rgba(painted === 'currentcolor' ? css.color : painted);
    for (let parent = el; parent; parent = parent.parentElement) ink[3] *= Number(getComputedStyle(parent).opacity);
    if (el instanceof SVGElement) ink[3] *= Number(css.fillOpacity);
    contrast.push({ ...describe(el), placeholder, ratio: +ratio(over(ink, bg), bg).toFixed(3), required: large ? 3 : 4.5, size: css.fontSize });
  }
  while (walker.nextNode()) {
    const node = walker.currentNode, el = node.parentElement;
    if (node.textContent.trim() && visible(el) && !el.closest('script, style, option, [disabled], .life-skip')) measure(el);
  }
  // Native checkbox/radio controls have no editable text and cannot trigger text-input zoom.
  const fields = Array.from(document.querySelectorAll('input, select, textarea')).filter(visible).filter(el => !el.disabled && !el.matches('input[type=checkbox], input[type=radio], input[type=file], input[type=range], input[type=color]'));
  for (const el of fields) { measure(el); if (el.placeholder && !el.value) measure(el, true); }
  const interactive = Array.from(document.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex="0"]')).filter(visible).filter(el => !el.disabled && !el.matches('.life-skip'));
  const targets = interactive.map(el => { const target = el.matches('input[type="checkbox"], input[type="radio"]') ? el.closest('label') || el : el; const r = target.getBoundingClientRect(); return { ...describe(el), spatial: el instanceof SVGElement, width: +r.width.toFixed(1), height: +r.height.toFixed(1) }; });
  const unnamed = interactive.filter(el => !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || el.textContent.trim() || el.labels?.[0]?.textContent.trim())).map(describe);
  const focused = document.activeElement, css = getComputedStyle(focused), outline = parseFloat(css.outlineWidth);
  const title = document.querySelector('#lifeSearchResults h3') || document.querySelector('#lifeMain h2');
  const reader = document.querySelector('#lifeSourceText');
  return { viewport: { width: innerWidth, height: innerHeight }, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    contrastFailures: contrast.filter(item => item.ratio < item.required), minimumTextContrast: Math.min(...contrast.map(item => item.ratio)),
    smallTargets: targets.filter(item => item.width < 43.9 || item.height < 43.9), spatialTargets: targets.filter(item => item.spatial), unnamed,
    smallInputs: fields.filter(el => parseFloat(getComputedStyle(el).fontSize) < 16).map(describe),
    focus: { ...describe(focused), visible: focused.matches(':focus-visible'), width: outline,
      contrast: outline ? +ratio(over(rgba(css.outlineColor), background(focused.parentElement)), background(focused.parentElement)).toFixed(3) : null },
    title: title ? { width: title.clientWidth, height: title.clientHeight, lineHeight: getComputedStyle(title).lineHeight, wordBreak: getComputedStyle(title).wordBreak, overflowWrap: getComputedStyle(title).overflowWrap } : null,
    reader: reader ? { width: reader.clientWidth, size: getComputedStyle(reader).fontSize, lineHeight: getComputedStyle(reader).lineHeight, selectedText: getSelection().toString() } : null,
    resultCount: document.querySelectorAll('#lifeSearchResults article').length };
}

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { phase, capturedAt: new Date().toISOString(), base, browser: browser.version(),
    environment: 'Linux Chromium viewport and touch simulation; not actual Apple, Google, IME, Files, VoiceOver or production Supabase',
    fixture: 'Same six-source/twelve-excerpt collections fixture; eight synthetic goals, habits and timelines with long Korean titles',
    method: 'Computed HTML color and SVG fill over actual surfaces, including inherited opacity; finite entrance animations finish before measurement. Spatial chart targets retain their measured sizes and are reported separately from menus/forms.',
    checks: [], captures: [], errors: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, blockedWrites: [], realRemoteWrites: 0 };
  const check = (name, pass, detail) => report.checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  async function capture(page, scene, size) {
    if (selectedScenes.size && !selectedScenes.has(scene)) return;
    await page.evaluate(() => document.fonts.ready); await clean(page);
    await page.evaluate(() => { for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish(); });
    const metrics = await page.evaluate(inspect);
    const layout = await page.evaluate(() => {
      const visible = e => e.checkVisibility({ visibilityProperty: true }) && !e.closest('[hidden]');
      const main = [...document.querySelectorAll('#lifeMain, main.p-main')].find(visible), heading = [...document.querySelectorAll('h1, #lifeMain h2')].find(visible);
      const css = getComputedStyle(main || document.body);
      return { font: css.fontFamily, background: getComputedStyle(document.body).backgroundColor,
        contentWidth: main ? +(main.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)).toFixed(1) : null,
        headingTop: heading ? +heading.getBoundingClientRect().top.toFixed(1) : null,
        commonIcons: [...document.querySelectorAll('[data-haedo-navigation] a')].map(el => { const r = el.getBoundingClientRect(), icon = el.querySelector('svg')?.getBoundingClientRect(); return { label: el.getAttribute('aria-label'), width: r.width, height: r.height, iconWidth: icon?.width, iconHeight: icon?.height, offsetX: icon ? Math.abs((r.left + r.right - icon.left - icon.right) / 2) : null, offsetY: icon ? Math.abs((r.top + r.bottom - icon.top - icon.bottom) / 2) : null }; }) };
    });
    const file = `${scene}-${size.name}.png`;
    await page.screenshot({ path: path.join(out, file) });
    report.captures.push({ scene, size, file, ...metrics, layout });
    for (const [name, pass, detail] of [['no horizontal overflow', !metrics.horizontalOverflow], ['text contrast', !metrics.contrastFailures.length, metrics.contrastFailures],
      ['44px targets', !metrics.smallTargets.length, metrics.smallTargets], ['named controls', !metrics.unnamed.length, metrics.unnamed], ['16px inputs', !metrics.smallInputs.length, metrics.smallInputs]]) check(`${size.name} ${scene}: ${name}`, pass, detail);
    check(`${size.name} ${scene}: aligned common navigation`, layout.commonIcons.length === 3 && layout.commonIcons.every(i => i.width >= 44 && i.height >= 44 && i.iconWidth === 20 && i.iconHeight === 20 && i.offsetX < 1 && i.offsetY < 1), layout.commonIcons);
    if (!scene.startsWith('timeline-')) check(`${size.name} ${scene}: content maximum 700px`, layout.contentWidth === null || layout.contentWidth <= 701, layout.contentWidth);
  }
  async function contextFor(server, device, account, size, platform = { docs: [], items: [] }) {
    const context = await makeContext(browser, server, device, account, { viewport: { width: size.width, height: size.height }, hasTouch: size.width <= 820 });
    await context.route(`${cloud}/rest/v1/**`, route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'GET') {
        let rows = url.pathname.endsWith('/haedo_documents') ? platform.docs : url.pathname.endsWith('/haedo_items') ? platform.items : [];
        const id = url.searchParams.get('id'); if (id?.startsWith('eq.')) rows = rows.filter(row => row.id === id.slice(3));
        return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(rows) });
      }
      report.blockedWrites.push({ method: request.method(), table: url.pathname.split('/').pop() });
      return route.fulfill({ status: 409, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message: 'Design audit is read only' }) });
    });
    return context;
  }
  try {
    for (const size of sizes) {
      const server = new FakeCloud();
      async function run(name, account, fn, data) {
        const groups = { home: ['home-loading','home-empty','home-feed','home-tools','home-manage','home-management-options','home-transfer'], guest: ['home-welcome','login','login-error','privacy'], error: ['home-error'], 'empty-platform': ['goals-empty','habits-empty','workspace-empty'], platform: ['goals-list','goals-form','habits-list','habits-form','workspace-list','workspace-form','workspace-manage','timeline-chart','timeline-records','timeline-form'] };
        if (selectedScenes.size && !groups[name].some(scene => selectedScenes.has(scene))) return;
        const device = `site-${phase}-${size.name}-${name}`, context = await contextFor(server, device, account, size, data), page = await context.newPage();
        page.setDefaultTimeout(15000); observe(page, report, `${size.name} ${name}`);
        try { await fn(page, context, device); } catch (error) { report.errors.push({ scene: name, size: size.name, error: error.stack }); }
        finally { await context.close(); }
      }
      await run('home', accounts.a, async (page, context) => {
        let release; const gate = new Promise(resolve => { release = resolve; });
        await context.route(`${cloud}/auth/v1/user`, async route => { await gate; return route.fallback(); });
        try { await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await page.locator('#lifeStartup').waitFor({ state: 'visible' }); await capture(page, 'home-loading', size); }
        finally { release(); }
        await ready(page); await context.unroute(`${cloud}/auth/v1/user`); await capture(page, 'home-empty', size);
        await seed(page); await capture(page, 'home-feed', size);
        await page.locator('[data-haedo-navigation] a').first().focus(); await page.keyboard.press('Tab');
        const focus = (await page.evaluate(inspect)).focus;
        check(size.name + ' common navigation keyboard focus', focus.visible && focus.width >= 3 && focus.contrast >= 3, focus);
        await nav(page, 'tools'); await capture(page, 'home-tools', size);
        await nav(page, 'manage'); await capture(page, 'home-manage', size);
        await openManagement(page); await capture(page, 'home-management-options', size);
        if (phase === 'after') { await page.getByRole('button', { name: '내보내기·사본 복원', exact: true }).click(); await capture(page, 'home-transfer', size); }
      });
      await run('guest', null, async (page, context) => {
        await page.goto(base + '/index.html'); await shellReady(page); await capture(page, 'home-welcome', size);
        await page.goto(base + '/login.html?next=index.html'); await page.waitForFunction(() => !document.querySelector('#googleLogin')?.disabled); await capture(page, 'login', size);
        await context.route(`${cloud}/auth/v1/settings`, route => route.abort('internetdisconnected')); page.expectedAuthFailure = true;
        await page.goto(base + '/login.html?next=index.html'); await page.waitForFunction(() => /서버에 연결하지 못/.test(document.querySelector('#loginMessage')?.textContent)); await capture(page, 'login-error', size);
        await context.unroute(`${cloud}/auth/v1/settings`); page.expectedAuthFailure = false;
        await page.goto(base + '/privacy.html'); await page.waitForFunction(() => globalThis.HaedoNavigation); await capture(page, 'privacy', size);
      });
      await run('error', accounts.a, async (page, _context, device) => {
        server.offline.add(device); page.expectedAuthFailure = true;
        await page.goto(base + '/index.html'); await shellReady(page); await capture(page, 'home-error', size);
      });
      await run('empty-platform', accounts.a, async page => {
        for (const name of ['goals', 'habits', 'workspace']) {
          await page.goto(base + '/' + name + '.html'); await platformReady(page); await capture(page, name + '-empty', size);
        }
      });
      await run('platform', accounts.a, async page => {
        for (const name of ['goals', 'habits']) {
          await page.goto(base + '/' + name + '.html'); await platformReady(page);
          await page.locator(name === 'goals' ? '#goalList > *' : '#habitList > *').first().waitFor(); await capture(page, name + '-list', size);
          await page.locator('#addItem').click(); await page.locator('#itemTitle').fill(titles[0]); await capture(page, name + '-form', size);
          await page.keyboard.press('Escape');
          check(size.name + ' ' + name + ' form escape returns to add button', await page.locator('#addItem').evaluate(el => el === document.activeElement));
        }
        await page.goto(base + '/workspace.html'); await platformReady(page); await page.locator('.document-row').first().waitFor(); await capture(page, 'workspace-list', size);
        await page.locator('#newTimeline').click(); await page.locator('#timelineName').fill(titles[0]); await capture(page, 'workspace-form', size); await page.keyboard.press('Escape');
        await page.goto(base + '/workspace.html?section=manage'); await platformReady(page); await capture(page, 'workspace-manage', size);
        await page.goto(base + '/timeline.html?doc=d_site_0'); await page.waitForFunction(() => !!globalThis.HAEDO_CONTEXT && document.querySelector('#timelineAccess').hidden && !!document.querySelector('#tl path'));
        await capture(page, 'timeline-chart', size); await page.locator('#btnRecords').click(); await capture(page, 'timeline-records', size);
        await page.locator('#recordQuery').fill('2026-01-15');
        const equivalent = page.locator('#recordRows button.record-row'); assert.equal(await equivalent.count(), 1);
        const equivalentBox = await equivalent.boundingBox();
        await equivalent.focus(); await page.keyboard.press('Enter'); await page.locator('#popEd').waitFor({ state: 'visible' });
        check(size.name + ' timeline equivalent record has 44px target and keyboard edit', equivalentBox.width >= 44 && equivalentBox.height >= 44 && await page.locator('#popEd .pe-title').inputValue() === titles[0]);
        await page.keyboard.press('Escape'); await page.locator('#recordQuery').fill('');
        await page.locator('#btnTimeline').click();
        // Real chart keyboard path; the dense spatial target is not enlarged into neighbouring events.
        const marker = page.locator('#tl g[role="button"][aria-label^="2026-01-15 "]');
        await page.keyboard.press('Tab'); await marker.focus();
        const markerFocus = (await page.evaluate(inspect)).focus;
        await page.keyboard.press('Enter');
        await page.locator('#popEd').waitFor({ state: 'visible' }); await capture(page, 'timeline-form', size);
        check(size.name + ' timeline marker keyboard Enter opens exact event', await page.locator('#popEd .pe-title').inputValue() === titles[0] && await page.locator('#popEd [data-f="date"]').inputValue() === '2026-01-15', { markerFocus });
      }, fixtures());
      assert.equal(server.writes().length, 0);
    }
    check('no unexpected console errors', !report.consoleErrors.length, report.consoleErrors);
    check('no page errors', !report.pageErrors.length, report.pageErrors);
    check('no remote write attempts', !report.blockedWrites.length, report.blockedWrites);
  } finally {
    await browser.close();
    if (selectedScenes.size) {
      const previous = JSON.parse(await fs.readFile(path.join(out, 'report.json'), 'utf8'));
      const merge = (old, current, key) => [...new Map([...old, ...current].map(value => [key(value), value])).values()];
      report.checks = merge(previous.checks, report.checks, row => row.name);
      report.captures = merge(previous.captures, report.captures, row => row.file);
      report.errors = [...previous.errors, ...report.errors]; report.consoleErrors = [...previous.consoleErrors, ...report.consoleErrors]; report.pageErrors = [...previous.pageErrors, ...report.pageErrors];
      report.expectedErrors += previous.expectedErrors; report.blockedWrites = [...previous.blockedWrites, ...report.blockedWrites];
      report.partialRuns = [...(previous.partialRuns || []), { capturedAt: report.capturedAt, scenes: [...selectedScenes] }];
    }
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  if (phase === 'after') {
    await fs.mkdir(evidence, { recursive: true });
    for (const entry of report.captures) if (representatives.has(entry.file.replace('.png', ''))) {
      await fs.copyFile(path.join(out, entry.file), path.join(evidence, 'after-' + entry.file));
      const before = path.join(root, '.local/life-design-site/before/visual', entry.file);
      try { await fs.copyFile(before, path.join(evidence, 'before-' + entry.file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  const failed = report.checks.filter(item => !item.pass);
  console.log(JSON.stringify({ phase, passed: report.checks.length - failed.length, failed, errors: report.errors, captures: report.captures.length, expectedErrors: report.expectedErrors, blockedWrites: report.blockedWrites, report: path.relative(root, path.join(out, 'report.json')) }, null, 2));
  // The immutable before run records existing defects rather than treating them as new regressions.
  if (report.errors.length || (phase === 'after' && failed.length)) process.exitCode = 1;
}
module.exports = { fixtures, inspect };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
