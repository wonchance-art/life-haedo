/* Independent, anonymous UI preview checks. Start npm run dev first.
 * Uses an existing Playwright/Chromium installation; no package or remote writes.
 * Evidence and the machine-readable report are overwritten in .local/design-review/after.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.local/design-review/after');
const evidence = path.join(root, 'docs/design-review/evidence/after');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4173');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Only a local preview server is permitted');
const sizes = [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 820, height: 1000 }, { name: 'phone', width: 390, height: 844 }];
function playwright() {
  for (const name of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core', '/opt/codex/cua_node/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Use an existing Playwright installation via PW_MODULE_PATH.');
}

// Runs inside Chromium. Measures rendered text over its actual ancestor surfaces.
// Native option popups, images, browser chrome and disabled controls are out of scope.
function inspect() {
  const visible = el => {
    const r = el.getBoundingClientRect(), css = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && css.visibility === 'visible' && css.display !== 'none' && !el.closest('[hidden], [inert]');
  };
  const rgb = value => {
    const match = value.match(/^rgba?\(([^)]+)\)$/);
    if (!match) return null;
    const a = match[1].split(/[, /]+/).filter(Boolean).map(Number);
    return [a[0], a[1], a[2], a[3] ?? 1];
  };
  const over = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
  const bg = el => {
    const layers = []; for (let p = el; p; p = p.parentElement) layers.unshift(p);
    return layers.reduce((color, p) => over(rgb(getComputedStyle(p).backgroundColor) || [0, 0, 0, 0], color), [255, 255, 255, 1]);
  };
  const luminance = c => c.slice(0, 3).map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((s, n, i) => s + n * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => { const l = [luminance(a), luminance(b)].sort((a, b) => b - a); return (l[0] + .05) / (l[1] + .05); };
  const describe = el => ({ tag: el.tagName.toLowerCase(), id: el.id, text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 72) });
  const text = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, el = node.parentElement;
    if (!node.textContent.trim() || !visible(el) || el.closest('script, style, option, [disabled]')) continue;
    const style = getComputedStyle(el), foreground = rgb(style.color); if (!foreground) continue;
    const background = bg(el), contrast = ratio(over(foreground, background), background);
    const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700);
    text.push({ ...describe(el), ratio: +contrast.toFixed(3), required: large ? 3 : 4.5, fontSize: style.fontSize });
  }
  // Input values/placeholders are not text nodes and need a separate measurement.
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (!visible(el) || el.disabled) continue;
    const style = getComputedStyle(el), background = bg(el), foreground = rgb(style.color);
    if (foreground) text.push({ ...describe(el), ratio: +ratio(over(foreground, background), background).toFixed(3), required: 4.5, fontSize: style.fontSize });
    if (el.placeholder && !el.value) {
      const foreground = rgb(getComputedStyle(el, '::placeholder').color);
      if (foreground) text.push({ ...describe(el), text: 'placeholder: ' + el.placeholder, ratio: +ratio(over(foreground, background), background).toFixed(3), required: 4.5, fontSize: style.fontSize });
    }
  }
  const interactive = Array.from(document.querySelectorAll('button, a[href], input, select, textarea, summary')).filter(visible).filter(el => !el.disabled && !el.matches('.hd-skip'));
  const targets = interactive.map(el => { const r = el.getBoundingClientRect(); return { ...describe(el), width: +r.width.toFixed(1), height: +r.height.toFixed(1) }; });
  const boundaries = interactive.filter(el => el.matches('input, select, textarea')).map(el => {
    const css = getComputedStyle(el), border = rgb(css.borderTopColor), surface = bg(el);
    return { ...describe(el), ratio: border ? +ratio(over(border, surface), surface).toFixed(3) : null };
  });
  const unnamed = interactive.filter(el => {
    const name = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.trim() || el.labels?.[0]?.textContent.trim();
    return !name;
  }).map(describe);
  const overflow = Array.from(document.body.querySelectorAll('*')).filter(visible).filter(el => {
    if (el.matches('.hd-skip')) return false;
    const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1;
  }).slice(0, 12).map(describe);
  const title = document.querySelector('.result-title');
  const focused = document.activeElement, focusStyle = getComputedStyle(focused), focusColor = rgb(focusStyle.outlineColor);
  const focusContrast = focused.matches(':focus-visible') && parseFloat(focusStyle.outlineWidth) > 0 && focusColor ? +ratio(over(focusColor, bg(focused.parentElement)), bg(focused.parentElement)).toFixed(3) : null;
  return {
    width: innerWidth, height: innerHeight, documentHeight: document.documentElement.scrollHeight,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1, overflowingElements: overflow,
    firstResultY: title ? Math.round(title.getBoundingClientRect().top + scrollY) : null,
    resultCount: document.querySelectorAll('.result-row').length,
    readingFont: document.querySelector('.reading-body') ? getComputedStyle(document.querySelector('.reading-body')).fontFamily : null,
    minTextContrast: Math.min(...text.map(t => t.ratio)), contrastFailures: text.filter(t => t.ratio + .001 < t.required),
    measuredText: text.length, smallTargets: targets.filter(t => t.width < 44 || t.height < 44), unnamed,
    controlBoundaryFailures: boundaries.filter(t => t.ratio !== null && t.ratio < 3),
    focusContrast,
    longHeading: Array.from(document.querySelectorAll('h1,h2,h3')).filter(el => visible(el) && el.textContent.length > 60).map(el => ({ ...describe(el), clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1, lineHeight: getComputedStyle(el).lineHeight, height: el.getBoundingClientRect().height })),
    activity: globalThis.__previewActivity
  };
}

async function main() {
  await fs.mkdir(out, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { capturedAt: new Date().toISOString(), browser: browser.version(), platform: 'Linux Chromium; viewport/touch simulation, not Apple hardware',
    matrix: [], interactions: [], screenshots: [], failures: [], consoleErrors: [], pageErrors: [], blockedRequests: [], activity: [] };
  function check(ok, description, detail) { if (!ok) report.failures.push({ description, detail }); }
  async function context(viewport, touch = false) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', hasTouch: touch });
    await context.addInitScript(() => {
      globalThis.__previewActivity = { storage: 0, indexedDB: 0, serviceWorker: 0 };
      for (const name of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
        const original = Storage.prototype[name];
        Storage.prototype[name] = function (...args) { globalThis.__previewActivity.storage++; return original.apply(this, args); };
      }
      for (const name of ['open', 'deleteDatabase']) {
        const original = IDBFactory.prototype[name];
        IDBFactory.prototype[name] = function (...args) { globalThis.__previewActivity.indexedDB++; return original.apply(this, args); };
      }
      if (navigator.serviceWorker) navigator.serviceWorker.register = () => { globalThis.__previewActivity.serviceWorker++; return Promise.reject(new Error('Service worker forbidden in design preview')); };
    });
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin === base.origin && route.request().method() === 'GET' && (u.pathname.endsWith('/design-sample.html') || u.pathname.includes('/assets/design-review/') || u.pathname.endsWith('/icon.svg'))) return route.continue();
      report.blockedRequests.push({ origin: u.origin, path: u.pathname }); return route.abort('blockedbyclient');
    });
    context.on('page', page => {
      page.on('pageerror', error => report.pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    });
    return context;
  }
  async function go(page, direction, view, state = 'normal') {
    const url = new URL('design-sample.html', base.href.endsWith('/') ? base : base.href + '/');
    url.search = new URLSearchParams({ direction, view, state });
    await page.goto(url.href); await page.locator('#main').waitFor(); await page.evaluate(() => document.fonts.ready);
  }
  async function capture(page, name, keep = false) {
    const file = name + '.png'; await page.screenshot({ path: path.join(out, file), fullPage: false });
    if (keep) await fs.copyFile(path.join(out, file), path.join(evidence, file));
    report.screenshots.push({ file, curated: keep });
  }
  try {
    for (const size of sizes) {
      const ctx = await context({ width: size.width, height: size.height }); const page = await ctx.newPage();
      for (const direction of ['a', 'b', 'c']) for (const view of ['search', 'reader']) for (const state of ['normal', 'many', 'empty', 'loading', 'error']) {
        await go(page, direction, view, state);
        const metrics = await page.evaluate(inspect); const scene = [direction, view, state, size.name].join('-');
        report.matrix.push({ scene, direction, view, state, viewport: size, ...metrics });
        check(!metrics.horizontalOverflow && !metrics.overflowingElements.length, scene + ': no horizontal clipping', metrics.overflowingElements);
        check(!metrics.contrastFailures.length, scene + ': visible text contrast', metrics.contrastFailures);
        check(!metrics.unnamed.length, scene + ': accessible control names', metrics.unnamed);
        check(!metrics.smallTargets.length, scene + ': active targets at least 44 by 44 CSS pixels', metrics.smallTargets);
        check(!metrics.controlBoundaryFailures.length, scene + ': input/select boundary contrast at least 3:1', metrics.controlBoundaryFailures);
        check(metrics.longHeading.every(h => !h.clipped), scene + ': long Korean heading remains readable', metrics.longHeading);
        check(Object.values(metrics.activity).every(n => n === 0), scene + ': no persistent storage or service worker access', metrics.activity);
        if (state === 'normal') await capture(page, [direction, view, size.name].join('-'), true);
        else if (direction === 'a') await capture(page, scene);
      }
      for (const direction of ['a', 'b', 'c']) {
        await go(page, direction, 'components'); const metrics = await page.evaluate(inspect);
        report.matrix.push({ scene: direction + '-components-' + size.name, direction, view: 'components', viewport: size, ...metrics });
        check(!metrics.horizontalOverflow && !metrics.overflowingElements.length, direction + ' components layout at ' + size.width, metrics.overflowingElements);
        check(!metrics.contrastFailures.length, direction + ' components contrast at ' + size.width, metrics.contrastFailures);
      }
      await ctx.close();
    }
    // Interaction checks are kept separate from visual measurements below.
    await interactionChecks({ context, go, capture, inspect, check, report });
    check(!report.pageErrors.length, 'No browser page errors', report.pageErrors);
    check(!report.consoleErrors.length, 'No browser console errors', report.consoleErrors);
    check(!report.blockedRequests.length, 'No auth, remote or non-preview asset requests attempted', report.blockedRequests);
  } finally {
    await browser.close();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ matrixScenes: report.matrix.length, interactions: report.interactions.length, screenshots: report.screenshots.length,
    failures: report.failures, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length,
    report: '.local/design-review/after/report.json' }, null, 2));
  if (report.failures.length) process.exitCode = 1;
}

async function interactionChecks({ context, go, capture, inspect, check, report }) {
  for (const direction of ['a', 'b', 'c']) {
    const ctx = await context({ width: 390, height: 844 }, true), page = await ctx.newPage();
    await go(page, direction, 'search');
    await page.locator('#query').fill('따옴표');
    check(await page.locator('.result-open').count() === 1 && await page.locator('[data-open="source-06"]').count() === 1, direction + ': literal Korean body search finds its source');
    await page.locator('#origin').selectOption('apple-notes');
    check(await page.locator('.result-open').count() === 0 && await page.getByText('찾는 자료가 없어요', { exact: true }).isVisible(), direction + ': origin filter intersects the text search');
    await page.locator('[data-action="reset"]').tap();
    check(await page.locator('#query').inputValue() === '' && await page.locator('#origin').inputValue() === '' && await page.locator('.result-open').count() === 12, direction + ': empty-result recovery clears both filters');
    const before = await page.locator('.result-open').count();
    await page.locator('#query').dispatchEvent('compositionstart');
    await page.locator('#query').fill('따옴표');
    check(await page.locator('.result-open').count() === before, direction + ': IME composition does not prematurely filter');
    await page.locator('#query').dispatchEvent('compositionend');
    check(await page.locator('.result-open').count() === 1, direction + ': committed Korean composition updates results');
    await page.locator('#query').fill('기록'); await page.locator('#origin').selectOption('apple-notes');
    const resultCount = await page.locator('.result-open').count();
    const target = page.locator('.result-open[data-open="source-05"]');
    await target.scrollIntoViewIfNeeded(); const oldScroll = await page.evaluate(() => scrollY);
    await target.tap();
    check(await page.locator('#readerTitle').textContent() === await page.evaluate(() => HaedoDesignData.sources.find(s => s.id === 'source-05').title), direction + ': chosen long title opens the correct original');
    await page.locator('[data-action="back"]').first().tap();
    const restored = await page.evaluate(() => ({ query: document.querySelector('#query').value, origin: document.querySelector('#origin').value, focus: document.activeElement?.id, y: scrollY }));
    check(restored.query === '기록' && restored.origin === 'apple-notes' && restored.focus === 'open-source-05' && Math.abs(restored.y - oldScroll) <= 1 && await page.locator('.result-open').count() === resultCount,
      direction + ': back restores query, origin, results, focused row and scroll', { oldScroll, restored });
    report.interactions.push({ direction, flow: 'Korean search, source filtering, IME event lifecycle, touch open/back and context restoration' });

    await go(page, direction, 'reader');
    const selected = await page.evaluate(() => {
      const text = document.querySelector('#readingBody p').firstChild;
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, Math.min(text.length, 38));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString();
    });
    await page.waitForFunction(text => document.querySelector('#quote')?.textContent === text, selected);
    check((await page.locator('#quote').textContent()) === selected, direction + ': selected original text updates excerpt verbatim');
    await page.locator('#topic').fill(''); await page.locator('[data-action="save"]').tap();
    check(await page.locator('#savedCount').textContent() === '1' && /새로고침하면 사라/.test(await page.locator('#saveStatus').textContent()), direction + ': an excerpt can be kept without an optional topic');
    await page.locator('#topic').fill('읽기와 기록'); await page.locator('#note').fill('선택한 원문과 내 생각을 구분해 두기.');
    await page.locator('[data-action="save"]').tap();
    check(await page.locator('#savedCount').textContent() === '2' && /새로고침하면 사라/.test(await page.locator('#saveStatus').textContent()), direction + ': a second excerpt with topic and note clearly describes its temporary scope');
    const savedMetrics = await page.evaluate(inspect);
    check(!savedMetrics.contrastFailures.length, direction + ': successful excerpt feedback contrast', savedMetrics.contrastFailures);
    check(Object.values(savedMetrics.activity).every(n => n === 0), direction + ': excerpt save never accesses persistent storage', savedMetrics.activity);
    await page.reload(); await page.locator('#main').waitFor();
    check(await page.locator('#savedCount').textContent() === '0', direction + ': reload discards sample-only excerpts');
    report.interactions.push({ direction, flow: 'DOM Range selection, optional empty topic, temporary excerpt saves and reload' });

    await go(page, direction, 'search'); await page.locator('[data-action="clear"]').tap();
    await page.locator('.result-open[data-open="source-09"]').tap();
    check(await page.locator('#readingBody').count() === 0 && await page.locator('[data-action="save"]').count() === 0 && await page.getByText('이 원문의 본문이 없어요', { exact: true }).isVisible(), direction + ': link-only source never offers body/excerpt actions');
    await capture(page, direction + '-link-only-phone');
    await go(page, direction, 'reader', 'error'); await page.locator('[data-action="retry"]').tap();
    check(await page.locator('#readingBody').isVisible(), direction + ': reader error retry restores reading');
    await go(page, direction, 'search', 'error'); await page.locator('[data-action="retry"]').tap();
    check(await page.locator('.result-open').count() > 0, direction + ': search error retry restores results');
    report.interactions.push({ direction, flow: 'Missing body guard and search/reader retry' });

    await go(page, direction, 'components');
    await page.keyboard.press('Tab');
    const skip = await page.evaluate(() => ({ text: document.activeElement.textContent, top: document.activeElement.getBoundingClientRect().top }));
    check(skip.text === '본문으로 이동' && skip.top >= 0, direction + ': keyboard skip link becomes visible', skip);
    await page.keyboard.press('Enter');
    check(await page.locator('#main').evaluate(el => el === document.activeElement), direction + ': skip link focuses main content');
    const focusSamples = [];
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press('Tab');
      const sample = await page.evaluate(() => { const el = document.activeElement, css = getComputedStyle(el); return { tag: el.tagName, name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 50), width: css.outlineWidth, style: css.outlineStyle, color: css.outlineColor, focusVisible: el.matches(':focus-visible') }; });
      if (sample.tag === 'BODY') break; // Tab can legitimately leave the document for browser chrome.
      focusSamples.push(sample);
    }
    check(focusSamples.length >= 7 && focusSamples.every(s => s.focusVisible && parseFloat(s.width) >= 2 && s.style !== 'none'), direction + ': tabbed controls retain a visible focus indicator', focusSamples);
    if (await page.evaluate(() => document.activeElement === document.body)) await page.keyboard.press('Shift+Tab');
    const focusedMetrics = await page.evaluate(inspect);
    check(focusedMetrics.focusContrast >= 3, direction + ': keyboard focus outline contrast at least 3:1', focusedMetrics.focusContrast);
    await capture(page, direction + '-components-focus-phone');
    const button = page.locator('.component-actions .hd-primary');
    await button.hover(); const hoverMetrics = await page.evaluate(inspect);
    check(!hoverMetrics.contrastFailures.length, direction + ': hovered primary button text contrast', hoverMetrics.contrastFailures);
    await button.tap(); check(await page.locator('#feedback').isVisible(), direction + ': touch button exposes feedback');
    const feedbackMetrics = await page.evaluate(inspect);
    check(!feedbackMetrics.contrastFailures.length, direction + ': live feedback contrast', feedbackMetrics.contrastFailures);
    await page.keyboard.press('Escape'); check(await page.locator('#feedback').isHidden(), direction + ': Escape dismisses feedback');
    report.interactions.push({ direction, flow: 'Keyboard skip/tab/focus, hover contrast, touch feedback, Escape' });

    // CSS text enlargement is a useful extra stress check, not browser zoom emulation.
    await go(page, direction, 'search'); await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const enlarged = await page.evaluate(inspect);
    check(!enlarged.horizontalOverflow, direction + ': 200% root text size avoids document overflow', enlarged.overflowingElements);
    await capture(page, direction + '-text-enlarged-phone');
    report.interactions.push({ direction, flow: '200% CSS root text size at 390px (not browser zoom)' });
    const activity = await page.evaluate(() => globalThis.__previewActivity); report.activity.push({ direction, ...activity });
    check(Object.values(activity).every(n => n === 0), direction + ': interactions do not access persistent storage or service worker', activity);
    await ctx.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
