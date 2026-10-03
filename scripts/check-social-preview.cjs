/* Minimal reading UI comparison checks with anonymous, in-memory samples.
 * Start npm run dev first. This does not test native Apple devices or live accounts.
 * Uses an existing Playwright/Chromium installation; no package or remote writes.
 * Evidence and the machine-readable report are overwritten in .local/design-review/minimal.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.local/design-review/minimal');
const evidence = path.join(root, 'docs/design-review/evidence/minimal');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4173');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Only a local preview server is permitted');
const sizes = [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 820, height: 1000 }, { name: 'phone', width: 390, height: 844 }];
function playwright() {
  for (const name of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core', '/opt/codex/cua_node/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Use an existing Playwright installation via PW_MODULE_PATH.');
}

function navigation(page, tab) {
  return page.locator('.s-nav [data-tab="' + tab + '"]:visible, .s-bottom [data-tab="' + tab + '"]:visible').first();
}

async function openFilters(page) {
  if (await page.locator('#socialFilters').isHidden()) await page.locator('#filterToggle').click();
  await page.locator('#socialFilters').waitFor({ state: 'visible' });
}

async function openExcerpt(page) {
  if (await page.locator('#excerptPanel').isHidden()) await page.locator('#excerptToggle').click();
  await page.locator('#excerptPanel').waitFor({ state: 'visible' });
}

// Runs inside Chromium. Measures rendered text over its actual ancestor surfaces.
// Native option popups, images, browser chrome and disabled controls are out of scope.
function inspect() {
  const visible = el => {
    const r = el.getBoundingClientRect(), css = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && css.visibility === 'visible' && css.display !== 'none' && !el.closest('[hidden], [inert], .s-sr');
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
  const interactive = Array.from(document.querySelectorAll('button, a[href], input, select, textarea, summary')).filter(visible).filter(el => !el.disabled && !el.matches('.s-skip'));
  const targets = interactive.map(el => { const r = el.getBoundingClientRect(); return { ...describe(el), width: +r.width.toFixed(1), height: +r.height.toFixed(1) }; });
  const boundaries = interactive.filter(el => el.matches('input, select, textarea')).map(el => {
    const css = getComputedStyle(el), surface = bg(el);
    const edges = ['Top', 'Right', 'Bottom', 'Left'].filter(side => parseFloat(css['border' + side + 'Width']) > 0 && css['border' + side + 'Style'] !== 'none');
    const contrasts = edges.map(side => rgb(css['border' + side + 'Color'])).filter(Boolean).map(border => ratio(over(border, surface), surface));
    return { ...describe(el), ratio: +(contrasts.length ? Math.min(...contrasts) : ratio(surface, bg(el.parentElement))).toFixed(3) };
  });
  const unnamed = interactive.filter(el => {
    const name = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.trim() || el.labels?.[0]?.textContent.trim();
    return !name;
  }).map(describe);
  const overflow = Array.from(document.body.querySelectorAll('*')).filter(visible).filter(el => {
    if (el.matches('.s-skip')) return false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (/^(auto|scroll)$/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth) return false;
    }
    const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1;
  }).slice(0, 12).map(describe);
  const title = document.querySelector('.s-title .s-open');
  const focused = document.activeElement, focusStyle = getComputedStyle(focused), focusColor = rgb(focusStyle.outlineColor);
  const focusContrast = focused.matches(':focus-visible') && parseFloat(focusStyle.outlineWidth) > 0 && focusColor ? +ratio(over(focusColor, bg(focused.parentElement)), bg(focused.parentElement)).toFixed(3) : null;
  return {
    width: innerWidth, height: innerHeight, documentHeight: document.documentElement.scrollHeight,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1, overflowingElements: overflow,
    firstResultY: title ? Math.round(title.getBoundingClientRect().top + scrollY) : null,
    firstBodyY: document.querySelector('#sourceBody') ? Math.round(document.querySelector('#sourceBody').getBoundingClientRect().top + scrollY) : null,
    resultCount: document.querySelectorAll('#socialResults .s-post').length,
    readingFont: document.querySelector('#sourceBody') ? getComputedStyle(document.querySelector('#sourceBody')).fontFamily : null,
    minTextContrast: Math.min(...text.map(t => t.ratio)), contrastFailures: text.filter(t => t.ratio + .001 < t.required),
    measuredText: text.length, smallTargets: targets.filter(t => t.width < 44 || t.height < 44), unnamed,
    controlBoundaryFailures: boundaries.filter(t => t.ratio !== null && t.ratio < 3),
    collapsed: Object.fromEntries(['socialFilters', 'excerptPanel', 'sourceDetails', 'socialPeek'].map(id => [id, document.getElementById(id) ? !visible(document.getElementById(id)) : null])),
    reviewOpen: !!document.querySelector('#reviewOptions[open]'),
    focusContrast,
    backgroundImages: Array.from(document.querySelectorAll('body *')).filter(visible).filter(el => getComputedStyle(el).backgroundImage !== 'none').map(el => ({ ...describe(el), image: getComputedStyle(el).backgroundImage })),
    longHeading: Array.from(document.querySelectorAll('h1,h2,h3')).filter(el => visible(el) && el.textContent.length > 60).map(el => ({ ...describe(el), clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1, lineHeight: getComputedStyle(el).lineHeight, height: el.getBoundingClientRect().height })),
    activity: globalThis.__previewActivity
  };
}

async function main() {
  const connectedOnly = process.argv.includes('--connected-only');
  const interactionsOnly = process.argv.includes('--interactions-only');
  const sourceOnly = process.argv.includes('--source-disclosure-only');
  const reportName = sourceOnly ? 'source-disclosure-report.json' : connectedOnly ? 'connected-report.json' : interactionsOnly ? 'interactions-report.json' : 'report.json';
  await fs.mkdir(out, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { capturedAt: new Date().toISOString(), browser: browser.version(), platform: 'Linux Chromium; viewport/touch simulation, not Apple hardware',
    mode: sourceOnly ? 'source-disclosure' : connectedOnly ? 'connected' : interactionsOnly ? 'interactions' : 'full', completed: false,
    matrix: [], disclosures: [], interactions: [], screenshots: [], failures: [], consoleErrors: [], pageErrors: [], blockedRequests: [], activity: [] };
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
      if (u.origin === base.origin && route.request().method() === 'GET' && (u.pathname.endsWith('/social-sample.html') || u.pathname.includes('/assets/design-social/') || u.pathname.endsWith('/assets/design-review/sample-data.js') || u.pathname.endsWith('/icon.svg'))) return route.continue();
      report.blockedRequests.push({ origin: u.origin, path: u.pathname }); return route.abort('blockedbyclient');
    });
    context.on('page', page => {
      page.on('pageerror', error => report.pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    });
    return context;
  }
  async function go(page, concept, view, state = 'normal') {
    const url = new URL('social-sample.html', base.href.endsWith('/') ? base : base.href + '/');
    url.search = new URLSearchParams({ concept, view, state });
    await page.goto(url.href); await page.locator('main').waitFor(); await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(280); // Let one bounded entrance transition settle before measuring.
  }
  async function capture(page, name, keep = false) {
    const file = name + '.png'; await page.screenshot({ path: path.join(out, file), fullPage: false });
    if (keep) await fs.copyFile(path.join(out, file), path.join(evidence, file));
    report.screenshots.push({ file, curated: keep });
  }
  async function measure(page, scene, detail) {
    const metrics = await page.evaluate(inspect); report.matrix.push({ scene, ...detail, ...metrics });
    check(!metrics.horizontalOverflow && !metrics.overflowingElements.length, scene + ': no horizontal clipping', metrics.overflowingElements);
    check(!metrics.contrastFailures.length, scene + ': visible text contrast', metrics.contrastFailures);
    check(!metrics.unnamed.length, scene + ': accessible control names', metrics.unnamed);
    check(!metrics.smallTargets.length, scene + ': active targets at least 44 by 44 CSS pixels', metrics.smallTargets);
    check(!metrics.controlBoundaryFailures.length, scene + ': input/select boundary contrast at least 3:1', metrics.controlBoundaryFailures);
    check(metrics.longHeading.every(h => !h.clipped), scene + ': long Korean heading remains readable', metrics.longHeading);
    check(Object.values(metrics.activity).every(n => n === 0), scene + ': no persistent storage or service worker access', metrics.activity);
  }
  try {
    if (sourceOnly) {
      await sourceDisclosureEvidence({ context, go, capture, inspect, check, report });
    } else if (connectedOnly) {
      await connectedEvidence({ context, go, capture, inspect, check, report });
    } else if (interactionsOnly) {
      await interactionChecks({ context, go, capture, inspect, check, report });
      await connectedEvidence({ context, go, capture, inspect, check, report });
    } else {
    for (const size of sizes) {
      const ctx = await context({ width: size.width, height: size.height }); const page = await ctx.newPage();
      for (const concept of ['color', 'thread', 'pulse']) for (const view of ['feed', 'reader']) for (const state of ['normal', 'empty', 'loading', 'error']) {
        await go(page, concept, view, state);
        const scene = [concept, view, state, size.name].join('-');
        await measure(page, scene, { concept, view, state, viewport: size });
        const hiddenTools = await page.evaluate(() => ({ review: !!document.querySelector('#reviewOptions[open]'), filters: document.querySelector('#socialFilters')?.hidden, excerpt: document.querySelector('#excerptPanel')?.hidden, source: document.querySelector('#sourceDetails')?.hidden }));
        check(!hiddenTools.review, scene + ': comparison tools start collapsed', hiddenTools);
        if (view === 'feed') check(hiddenTools.filters === true, scene + ': source/topic filters start collapsed', hiddenTools);
        if (view === 'feed' && concept === 'pulse') check(await page.locator('#socialPeek').isHidden(), scene + ': preview starts collapsed');
        if (view === 'reader' && state === 'normal') check(hiddenTools.excerpt === true && hiddenTools.source === true, scene + ': reading starts without excerpt/source panels', hiddenTools);
        if (state === 'normal') await capture(page, [concept, view, size.name].join('-'), true);
        else if (concept === 'color') await capture(page, scene);
      }
      await ctx.close();
    }
    const landscape = { name: 'landscape', width: 1024, height: 768 };
    const ctx = await context({ width: landscape.width, height: landscape.height }), page = await ctx.newPage();
    for (const concept of ['color', 'thread', 'pulse']) for (const view of ['feed', 'reader']) {
      await go(page, concept, view);
      await measure(page, concept + '-' + view + '-landscape', { concept, view, state: 'normal', viewport: landscape });
      await capture(page, concept + '-' + view + '-landscape');
    }
    await ctx.close();
    await interactionChecks({ context, go, capture, inspect, check, report });
    await connectedEvidence({ context, go, capture, inspect, check, report });
    await sourceDisclosureEvidence({ context, go, capture, inspect, check, report });
    }
    check(!report.pageErrors.length, 'No browser page errors', report.pageErrors);
    check(!report.consoleErrors.length, 'No browser console errors', report.consoleErrors);
    check(!report.blockedRequests.length, 'No auth, remote or non-preview asset requests attempted', report.blockedRequests);
    report.completed = true;
  } catch (error) {
    report.runnerError = error.message;
    throw error;
  } finally {
    await browser.close();
    await fs.writeFile(path.join(out, reportName), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ matrixScenes: report.matrix.length, disclosedScenes: report.disclosures.length, interactions: report.interactions.length, screenshots: report.screenshots.length,
    failures: report.failures, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length,
    report: '.local/design-review/minimal/' + reportName }, null, 2));
  if (report.failures.length) process.exitCode = 1;
}

async function sourceDisclosureEvidence({ context, go, capture, inspect, check, report }) {
  for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 1000 }]) {
    const ctx = await context({ width: viewport.width, height: viewport.height }, viewport.name === 'phone'), page = await ctx.newPage();
    try {
      await go(page, 'thread', 'reader');
      await page.evaluate(() => scrollTo(0, Math.min(1200, document.documentElement.scrollHeight - innerHeight)));
      const readingY = await page.evaluate(() => scrollY);
      check(readingY > 700, viewport.name + ': source disclosure starts after meaningful reading scroll', readingY);
      await page.locator('#sourceToggle').click();
      const opened = await page.locator('#sourceDetails').evaluate(el => {
        const first = el.querySelector('dt').getBoundingClientRect(), toolbar = document.querySelector('.s-reader-tools').getBoundingClientRect();
        return { visible: !el.hidden, focused: el === document.activeElement, firstRowY: first.top, firstRowBottom: first.bottom, toolbarBottom: toolbar.bottom, viewportHeight: innerHeight, y: scrollY };
      });
      check(opened.visible && opened.focused && opened.firstRowY >= opened.toolbarBottom && opened.firstRowBottom < opened.viewportHeight,
        viewport.name + ': requested source details move into view below the sticky toolbar', opened);
      const metrics = await page.evaluate(inspect); report.disclosures.push({ concept: 'thread', panel: 'source-after-reading-scroll', viewport, ...metrics });
      check(!metrics.horizontalOverflow && !metrics.contrastFailures.length && !metrics.smallTargets.length && !metrics.unnamed.length,
        viewport.name + ': source details remain readable and operable after scrolling', { contrast: metrics.contrastFailures, targets: metrics.smallTargets, unnamed: metrics.unnamed });
      await capture(page, 'thread-source-open-' + viewport.name, viewport.name === 'phone');
      await page.keyboard.press('Escape');
      const closed = await page.evaluate(() => ({ hidden: document.querySelector('#sourceDetails').hidden, focused: document.activeElement.id, y: scrollY }));
      check(closed.hidden && closed.focused === 'sourceToggle' && Math.abs(closed.y - readingY) <= 1, viewport.name + ': Escape restores the reading position and source opener', { readingY, closed });
      await page.locator('#sourceToggle').click(); await page.locator('#sourceToggle').click();
      const toggled = await page.evaluate(() => ({ hidden: document.querySelector('#sourceDetails').hidden, focused: document.activeElement.id, y: scrollY }));
      check(toggled.hidden && toggled.focused === 'sourceToggle' && Math.abs(toggled.y - readingY) <= 1, viewport.name + ': toggling source details closed restores the same reading position', { readingY, toggled });
      report.interactions.push({ concept: 'thread', flow: 'Scrolled reading → visible source metadata → Escape/toggle → original scroll and focus', viewport });
    } finally { await ctx.close(); }
  }
}

async function connectedEvidence({ context, go, capture, inspect, check, report }) {
  const ctx = await context({ width: 390, height: 844 }, true), page = await ctx.newPage();
  try {
    await go(page, 'thread', 'reader');
    const selected = await page.evaluate(() => {
      const node = document.querySelector('#sourceBody p:nth-child(2)').firstChild;
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, node.textContent.indexOf('.') + 1);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString();
    });
    await page.waitForFunction(text => document.querySelector('#selectedQuote').textContent === text, selected);
    await openExcerpt(page);
    const note = '다음에 다시 읽을 때는 이 문장이 마음에 남은 이유부터 살펴보기.';
    await page.locator('#excerptTopic').fill('읽기와 기록'); await page.locator('#excerptNote').fill(note);
    await page.locator('#addExcerpt').tap(); await page.keyboard.press('Escape');
    if (await page.locator('#excerptPanel').isVisible()) await page.locator('#closeExcerpt').click();
    await page.locator('[data-action="back"]').tap(); await navigation(page, 'excerpts').tap();
    const card = page.locator('.s-post[data-source-id="source-01"]');
    check(await card.locator('.s-inline-quote p').nth(0).textContent() === selected && await card.locator('.s-inline-quote p').nth(1).textContent() === note,
      'thread connected example keeps the original excerpt and the personal note separate');
    await card.evaluate(el => el.scrollIntoView({ block: 'start' }));
    const metrics = await page.evaluate(inspect);
    check(!metrics.horizontalOverflow && !metrics.contrastFailures.length, 'connected quote and note remain readable', metrics.contrastFailures);
    check(Object.values(metrics.activity).every(n => n === 0), 'connected excerpt stays in memory', metrics.activity);
    await capture(page, 'thread-connected-phone', true);
    report.matrix.push({ scene: 'thread-connected-phone', ...metrics });
    report.interactions.push({ concept: 'thread', flow: 'Selected original → topic and separate note → excerpts tab → connected source card evidence' });
  } finally { await ctx.close(); }
}

async function interactionChecks({ context, go, capture, inspect, check, report }) {
  async function checkDisclosed(page, concept, panel) {
    const metrics = await page.evaluate(inspect);
    report.disclosures.push({ concept, panel, ...metrics });
    check(!metrics.horizontalOverflow && !metrics.overflowingElements.length, concept + ': disclosed ' + panel + ' stays within the viewport', metrics.overflowingElements);
    check(!metrics.contrastFailures.length && !metrics.controlBoundaryFailures.length, concept + ': disclosed ' + panel + ' keeps text and boundary contrast', { text: metrics.contrastFailures, boundary: metrics.controlBoundaryFailures });
    check(!metrics.unnamed.length && !metrics.smallTargets.length, concept + ': disclosed ' + panel + ' keeps named 44px controls', { unnamed: metrics.unnamed, small: metrics.smallTargets });
  }
  for (const concept of ['color', 'thread', 'pulse']) {
    const ctx = await context({ width: 390, height: 844 }, true), page = await ctx.newPage();
    await go(page, concept, 'feed');
    check(await page.locator('#socialFilters').isHidden(), concept + ': filters are hidden before use');
    await openFilters(page);
    check(await page.locator('#filterToggle').getAttribute('aria-expanded') === 'true', concept + ': filter opener announces the expanded controls');
    await checkDisclosed(page, concept, 'filters'); await capture(page, concept + '-filters-open-phone', concept === 'color');
    await page.locator('#filterToggle').click();
    check(await page.locator('#socialFilters').isHidden() && await page.locator('#filterToggle').getAttribute('aria-expanded') === 'false', concept + ': filter toggle closes its controls');
    await openFilters(page); await page.locator('#socialOrigin').focus(); await page.keyboard.press('Escape');
    check(await page.locator('#socialFilters').isHidden() && await page.locator('#filterToggle').evaluate(el => el === document.activeElement), concept + ': Escape closes filters and returns focus to their opener');
    report.interactions.push({ concept, flow: 'Collapsed filters, toggle, expanded state and Escape focus restoration' });
    const firstBookmark = page.locator('[data-save]').first();
    const bookmarkId = await firstBookmark.getAttribute('data-save');
    const wasSaved = await firstBookmark.getAttribute('aria-pressed') === 'true';
    await firstBookmark.tap();
    check(await page.locator('[data-save="' + bookmarkId + '"]').getAttribute('aria-pressed') === String(!wasSaved), concept + ': bookmark toggles its accessible state');
    check(await page.locator('#socialFeedback').isVisible() && /담았어요/.test(await page.locator('#socialFeedback').textContent()), concept + ': bookmark announces its result');
    await page.keyboard.press('Escape');
    await navigation(page, 'saved').tap();
    check(await page.locator('#socialResults .s-post').count() === 1 && await page.locator('#socialResults [data-source-id="' + bookmarkId + '"]').count() === 1, concept + ': saved tab shows only the chosen source');
    await navigation(page, 'all').tap();
    await page.locator('[data-save="' + bookmarkId + '"]').tap();
    check(await page.locator('[data-save="' + bookmarkId + '"]').getAttribute('aria-pressed') === String(wasSaved), concept + ': bookmark toggle is reversible');
    await page.keyboard.press('Escape');
    report.interactions.push({ concept, flow: 'Touch bookmark toggle, saved tab, accessible state and status' });

    const expand = page.locator('[data-expand="source-01"]');
    await expand.tap();
    check(await expand.getAttribute('aria-expanded') === 'true' && await page.locator('#expanded-source-01').isVisible(), concept + ': inline expansion reveals its controlled passage');
    await expand.tap();
    check(await expand.getAttribute('aria-expanded') === 'false' && await page.locator('#expanded-source-01').isHidden(), concept + ': inline expansion closes reversibly');
    report.interactions.push({ concept, flow: 'Inline source passage expansion and collapse' });

    if (concept === 'pulse') {
      await page.locator('[data-preview="source-03"]').tap();
      check(await page.locator('#socialPeek').isVisible() && await page.locator('#peekTitle').evaluate(el => el === document.activeElement), 'pulse: mobile preview opens only on request and focuses its heading');
      await page.keyboard.press('Escape');
      check(await page.locator('#socialPeek').isHidden() && await page.locator('[data-preview="source-03"]').evaluate(el => el === document.activeElement), 'pulse: mobile preview Escape restores its source opener');
      report.interactions.push({ concept, flow: 'Mobile preview disclosure and Escape focus restoration' });
    }

    await openFilters(page); await page.locator('.s-topic[data-topic="원문과 출처"]').tap();
    check(await page.locator('#socialResults .s-post').count() === 1 && await page.locator('#social-open-source-06').count() === 1, concept + ': mobile topic filter reaches the last horizontally scrolled topic');
    const selectedTopic = await page.locator('.s-topic[data-topic="원문과 출처"]').evaluate(el => {
      const r = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect();
      return { focused: document.activeElement === el, visible: r.left >= parent.left - 1 && r.right <= parent.right + 1, pressed: el.getAttribute('aria-pressed') };
    });
    check(selectedTopic.focused && selectedTopic.visible && selectedTopic.pressed === 'true', concept + ': selected mobile topic remains focused and visible', selectedTopic);
    report.interactions.push({ concept, flow: 'Mobile last-topic filter, horizontal rail and focus retention' });
    await go(page, concept, 'feed');

    await page.locator('#socialSearch').fill('따옴표');
    check(await page.locator('#socialResults .s-post').count() === 1 && await page.locator('#social-open-source-06').count() === 1, concept + ': literal Korean body search finds the source');
    await openFilters(page); await page.locator('#socialOrigin').selectOption('apple-notes');
    check(await page.locator('#socialResults .s-post').count() === 0, concept + ': source filter intersects search results');
    await page.locator('#socialSearch').fill(''); await page.locator('#socialOrigin').selectOption('');
    const count = await page.locator('#socialResults .s-post').count();
    check(count === 12, concept + ': clearing both filters restores all anonymous sources');
    await page.locator('#socialSearch').dispatchEvent('compositionstart');
    await page.locator('#socialSearch').fill('따옴표');
    check(await page.locator('#socialResults .s-post').count() === count, concept + ': Korean composition does not filter before commit');
    await page.locator('#socialSearch').dispatchEvent('compositionend');
    check(await page.locator('#socialResults .s-post').count() === 1, concept + ': Korean composition commit updates results');
    await page.locator('#socialSearch').fill('기록'); await page.locator('#socialOrigin').selectOption('apple-notes');
    const rows = await page.locator('#socialResults .s-post').count(), target = page.locator('#social-open-source-05');
    await target.scrollIntoViewIfNeeded();
    // Playwright may scroll again to clear a fixed mobile bar before tapping.
    // Capture the user's actual click position, which is what the app restores.
    await page.evaluate(() => window.addEventListener('click', event => {
      if (event.target.closest('[data-open="source-05"]')) globalThis.__openedFromY = scrollY;
    }, { capture: true, once: true }));
    await target.tap();
    const oldScroll = await page.evaluate(() => globalThis.__openedFromY);
    check(await page.locator('#sourceBody').isVisible(), concept + ': long-title source opens for reading');
    await page.locator('[data-action="back"]').first().tap();
    const restored = await page.evaluate(() => ({ query: document.querySelector('#socialSearch').value, origin: document.querySelector('#socialOrigin').value, focus: document.activeElement?.dataset.open, y: scrollY }));
    check(restored.query === '기록' && restored.origin === 'apple-notes' && restored.focus === 'source-05' && Math.abs(restored.y - oldScroll) <= 1 && await page.locator('#socialResults .s-post').count() === rows,
      concept + ': reader back preserves filters, row focus and scroll', { oldScroll, restored });
    report.interactions.push({ concept, flow: 'Korean search, origin filter, synthetic IME lifecycle and reading/back context' });

    await go(page, concept, 'reader');
    check(await page.locator('#excerptPanel').isHidden() && await page.locator('#sourceDetails').isHidden(), concept + ': reader starts with original content and closed auxiliary panels');
    await page.locator('#sourceToggle').click();
    check(await page.locator('#sourceDetails').isVisible() && await page.locator('#sourceToggle').getAttribute('aria-expanded') === 'true', concept + ': source metadata is explicitly available');
    await checkDisclosed(page, concept, 'source');
    await page.keyboard.press('Escape');
    check(await page.locator('#sourceDetails').isHidden() && await page.locator('#sourceToggle').evaluate(el => el === document.activeElement), concept + ': Escape closes source details and returns focus');
    await page.locator('#sourceBody').focus();
    const selected = await page.evaluate(() => {
      const text = document.querySelector('#sourceBody p').firstChild;
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, Math.min(text.length, 38));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString();
    });
    await page.waitForFunction(text => document.querySelector('#selectedQuote')?.textContent === text, selected);
    check(await page.locator('#selectedQuote').textContent() === selected, concept + ': selected original appears verbatim in excerpt');
    check(await page.locator('#excerptPanel').isHidden() && await page.locator('#sourceBody').evaluate(el => el === document.activeElement), concept + ': text selection does not open tools or steal reading focus');
    await openExcerpt(page);
    check(await page.locator('#excerptToggle').getAttribute('aria-expanded') === 'true' && await page.locator('#selectedQuote').isVisible(), concept + ': explicit excerpt action reveals the selected quote');
    await page.locator('#closeExcerpt').click();
    check(await page.locator('#excerptPanel').isHidden() && await page.locator('#excerptToggle').evaluate(el => el === document.activeElement), concept + ': excerpt close button restores its opener focus');
    await openExcerpt(page); await page.locator('#excerptNote').focus(); await page.keyboard.press('Escape');
    check(await page.locator('#excerptPanel').isHidden() && await page.locator('#excerptToggle').evaluate(el => el === document.activeElement), concept + ': Escape closes excerpt tools and returns focus');
    await openExcerpt(page);
    const openMetrics = await page.evaluate(inspect);
    check(!openMetrics.horizontalOverflow && !openMetrics.contrastFailures.length && !openMetrics.controlBoundaryFailures.length && !openMetrics.smallTargets.length, concept + ': disclosed excerpt tools retain layout, contrast and target sizes', openMetrics);
    await capture(page, concept + '-excerpt-open-phone', concept === 'thread');
    await checkDisclosed(page, concept, 'excerpt');
    report.interactions.push({ concept, flow: 'Original-first reading, source disclosure, selection without focus theft, explicit excerpt open/close/Escape' });
    await page.locator('#addExcerpt').tap();
    check(/연결했어요/.test(await page.locator('#excerptStatus').textContent()) && /새로고침하면 초기화/.test(await page.locator('#socialFeedback').textContent()), concept + ': excerpt status clearly describes its temporary scope');
    report.interactions.push({ concept, flow: 'DOM text selection and adding a sample excerpt without a note' });
    const excerptMetrics = await page.evaluate(inspect);
    check(!excerptMetrics.contrastFailures.length, concept + ': excerpt feedback text contrast', excerptMetrics.contrastFailures);
    check(Object.values(excerptMetrics.activity).every(n => n === 0), concept + ': sample excerpt does not use persistent storage', excerptMetrics.activity);
    await page.keyboard.press('Escape');
    if (await page.locator('#excerptPanel').isVisible()) await page.locator('#closeExcerpt').click();
    await page.locator('[data-action="back"]').tap();
    await navigation(page, 'excerpts').tap();
    check(await page.locator('#socialResults .s-post').count() === 1 && await page.locator('.s-inline-quote p').textContent() === selected, concept + ': excerpt tab shows the selected quote next to its source');
    await page.reload(); await page.locator('main').waitFor();
    check(await page.locator('.s-inline-quote').count() === 0, concept + ': reload discards temporary excerpts');

    await go(page, concept, 'feed'); await page.locator('[data-excerpt="true"][data-open="source-01"]').tap();
    check(await page.locator('#sourceBody').isVisible() && await page.locator('#excerptPanel').isVisible() && await page.locator('#excerptTopic').evaluate(el => el === document.activeElement), concept + ': source excerpt shortcut opens the original and explicit excerpt tools');
    await page.locator('#closeExcerpt').click();
    check(await page.locator('#excerptPanel').isHidden() && await page.locator('#excerptToggle').evaluate(el => el === document.activeElement), concept + ': shortcut excerpt close returns to the reader control');
    report.interactions.push({ concept, flow: 'Source excerpt shortcut and reader focus recovery' });

    await go(page, concept, 'feed'); await page.locator('#socialSearch').fill('');
    await page.locator('#social-open-source-09').tap();
    check(await page.locator('#sourceBody').count() === 0 && await page.locator('#addExcerpt').count() === 0, concept + ': link-only source has no body or excerpt action');
    await capture(page, concept + '-link-only-phone');
    await go(page, concept, 'reader', 'error'); await page.locator('[data-action="retry"]').tap();
    check(await page.locator('#sourceBody').isVisible(), concept + ': retry restores reader');
    await go(page, concept, 'feed', 'error'); await page.locator('[data-action="retry"]').tap();
    check(await page.locator('#socialResults .s-post').count() > 0, concept + ': retry restores feed');
    report.interactions.push({ concept, flow: 'Link-only guard and error recovery' });

    await go(page, concept, 'feed'); await page.keyboard.press('Tab');
    const skip = await page.evaluate(() => ({ text: document.activeElement.textContent.trim(), top: document.activeElement.getBoundingClientRect().top }));
    check(skip.text.includes('본문') && skip.top >= 0, concept + ': keyboard skip link is visible', skip);
    await page.keyboard.press('Enter');
    check(await page.locator('main').evaluate(el => el === document.activeElement), concept + ': skip link moves focus into main');
    const focusSamples = [];
    for (let index = 0; index < 10; index++) {
      await page.keyboard.press('Tab');
      const sample = await page.evaluate(() => { const el = document.activeElement, css = getComputedStyle(el); return { tag: el.tagName, name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 50), width: css.outlineWidth, style: css.outlineStyle, focusVisible: el.matches(':focus-visible') }; });
      if (sample.tag === 'BODY') break;
      focusSamples.push(sample);
    }
    check(focusSamples.length >= 5 && focusSamples.every(s => s.focusVisible && parseFloat(s.width) >= 2 && s.style !== 'none'), concept + ': tabbed controls show focus', focusSamples);
    if (await page.evaluate(() => document.activeElement === document.body)) await page.keyboard.press('Shift+Tab');
    const focused = await page.evaluate(inspect);
    check(focused.focusContrast >= 3, concept + ': focus ring contrast', focused.focusContrast);
    await capture(page, concept + '-keyboard-phone');
    report.interactions.push({ concept, flow: 'Keyboard skip navigation, Tab order and focus' });

    const iconNav = page.locator('.s-nav button:visible, .s-bottom button:visible');
    const iconNames = await iconNav.evaluateAll(elements => elements.map(el => ({ name: el.getAttribute('aria-label'), text: el.textContent.trim() })));
    check(iconNames.length >= 3 && iconNames.every(item => item.name && item.name.trim()), concept + ': icon-only navigation retains explicit accessible names', iconNames);
    await iconNav.first().focus();
    const help = await iconNav.first().evaluate(el => {
      const pseudo = getComputedStyle(el, '::after');
      const generated = pseudo.content !== 'none' && pseudo.content !== 'normal' && pseudo.display !== 'none' && pseudo.visibility !== 'hidden' && Number(pseudo.opacity) > 0;
      const tooltips = Array.from(document.querySelectorAll('[role="tooltip"]')).filter(t => { const r=t.getBoundingClientRect(), css=getComputedStyle(t); return r.width>0 && r.height>0 && css.visibility!=='hidden' && Number(css.opacity)>0; }).map(t => t.textContent.trim());
      return { name: el.getAttribute('aria-label'), generated, content: pseudo.content, tooltips, focused: el.matches(':focus-visible') };
    });
    check(help.focused && (help.generated || help.tooltips.length > 0), concept + ': keyboard focus exposes icon help', help);
    await capture(page, concept + '-icon-help-phone');
    report.interactions.push({ concept, flow: 'Icon navigation accessible names and keyboard-visible help' });

    await page.locator('#reviewOptions > summary').focus(); await page.keyboard.press('Enter');
    check(await page.locator('#reviewOptions').getAttribute('open') !== null && await page.locator('button[data-concept="' + concept + '"]').isVisible(), concept + ': comparison options remain keyboard-accessible when requested');
    await checkDisclosed(page, concept, 'comparison');
    await page.locator('#reviewOptions > summary').focus(); await page.keyboard.press('Enter');
    check(await page.locator('#reviewOptions').getAttribute('open') === null, concept + ': comparison options can return to their collapsed state');
    report.interactions.push({ concept, flow: 'Collapsed comparison options open and close with the keyboard' });

    await page.emulateMedia({ reducedMotion: 'reduce' }); await go(page, concept, 'feed');
    const moving = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter(el => {
      const css = getComputedStyle(el), moving = value => value.split(',').some(v => parseFloat(v) > .01);
      return (css.animationName !== 'none' && moving(css.animationDuration)) || moving(css.transitionDuration);
    }).map(el => ({ tag: el.tagName, className: el.className })).slice(0, 15));
    check(!moving.length, concept + ': reduced-motion disables interface animation', moving);
    report.interactions.push({ concept, flow: 'Reduced-motion preference' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (concept === 'pulse') {
      await page.locator('[data-preview="source-03"]').click();
      check(await page.locator('#socialPeek').isVisible() && await page.locator('#socialPeek h3').textContent() === '천천히 걷다가 발견한 동네의 작은 도서관' && await page.locator('#socialPeek [data-open="source-03"]').count() === 1,
        'pulse: explicitly opened preview shows the chosen original title and reading action');
      check(await page.locator('[data-preview="source-03"]').getAttribute('aria-pressed') === 'true' && await page.locator('[data-source-id="source-03"]').getAttribute('data-selected') === 'true',
        'pulse: preview selection is reflected on its source row');
      await page.locator('[data-action="close-preview"]').click();
      check(await page.locator('#socialPeek').isHidden() && await page.locator('[data-preview="source-03"]').evaluate(el => el === document.activeElement), 'pulse: preview close returns focus to its opener');
      await page.locator('[data-preview="source-09"]').click();
      check(/본문 미확보/.test(await page.locator('#socialPeek').textContent()) && /링크만 보관/.test(await page.locator('#socialPeek').textContent()), 'pulse: link-only preview preserves its missing-body status');
      await capture(page, 'pulse-preview-open-desktop', true);
      await page.keyboard.press('Escape');
      check(await page.locator('#socialPeek').isHidden() && await page.locator('[data-preview="source-09"]').evaluate(el => el === document.activeElement), 'pulse: Escape closes the preview and restores focus');
      report.interactions.push({ concept, flow: 'Explicit preview, selected source, missing-body status and close/Escape focus restoration' });
    }
    await openFilters(page); await page.locator('[data-topic="걷기와 관찰"]:visible').first().click();
    check(await page.locator('#socialResults .s-post').count() === 2 && await page.locator('#socialResults [data-source-id="source-03"]').count() === 1 && await page.locator('#socialResults [data-source-id="source-11"]').count() === 1,
      concept + ': topic filter shows the two walking/observation sources');
    check(await page.locator('[data-topic="걷기와 관찰"]:visible').first().getAttribute('aria-pressed') === 'true', concept + ': topic announces its selected state');
    check(await page.evaluate(() => document.activeElement?.dataset.topic === '걷기와 관찰' && document.activeElement.getBoundingClientRect().height > 0), concept + ': desktop topic filter keeps focus on a visible selected control');
    report.interactions.push({ concept, flow: 'Desktop topic filter and selected state' });
    const activity = await page.evaluate(() => globalThis.__previewActivity); report.activity.push({ concept, ...activity });
    check(Object.values(activity).every(n => n === 0), concept + ': no persistent storage or service worker activity', activity);
    await ctx.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
