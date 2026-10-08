/* Public expression B: real owner review/SDK/IDB and the independent anonymous
 * share.html reader. Synthetic content and intercepted HTTP only.
 * BASE_URL=http://127.0.0.1:4184 node tests/public-expression-browser.cjs */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture, samples, PublicationCloud } = require('./page-expression-browser.cjs');
const { accounts, cloud, publicKey, base, platformContext } = require('./life-sync-browser.cjs');
const { playwright, makeContext, observe } = require('./unified-home-browser.cjs');
const { current } = require('./life-workbench-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const Share = require('../assets/life/share.js');
const out = path.resolve('.local/public-expression');
const publicId = '33333333-3333-4333-8333-000000000001';
const clone = value => JSON.parse(JSON.stringify(value));
const frames = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
function annotation(error) { if (process.env.GITHUB_ACTIONS) console.error('::error title=Public page expression::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')); }
async function entered(gate) {
  let timer;
  try { await Promise.race([gate.entered, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Mock public read was not requested within 12 seconds')), 12000); })]); }
  finally { clearTimeout(timer); }
}
class PublicCloud extends PublicationCloud {
  constructor() { super(); this.publicReads = []; this.badRead = false; this.missing = false; this.readGate = null; this.routeErrors = []; }
  async attach(context, device) {
    await context.route(`${cloud}/**`, async route => {
      try { await this.handle(route, device); }
      catch (error) { this.routeErrors.push(error.stack || String(error)); await route.abort('failed').catch(() => {}); }
    });
  }
  holdRead() {
    let enter, release;
    const gate = { entered: new Promise(resolve => { enter = resolve; }), released: new Promise(resolve => { release = resolve; }), release: () => release() };
    this.readGate = { enter, released: gate.released }; return gate;
  }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.endsWith('/life_public_page_read')) return super.handle(route, device);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    assert.equal(request.method(), 'POST'); assert.deepEqual(request.postDataJSON(), { p_public_id: publicId });
    assert.equal(request.headers().apikey, publicKey);
    assert.equal(request.headers().authorization, undefined, 'Anonymous reading must not borrow an account token');
    const response = this.badRead ? { status: 'unexpected' } : this.missing || !this.publicPage ? { status: 'missing' } : {
      status: 'published', publicId, revision: this.publicPage.metadata.revision, updatedAt: this.publicPage.metadata.updatedAt, snapshot: clone(this.publicPage.snapshot)
    };
    this.publicReads.push({ device, body: request.postDataJSON(), response: clone(response) });
    if (this.readGate) { const gate = this.readGate; this.readGate = null; gate.enter(); await gate.released; }
    return route.fulfill({ status: 200, headers, body: JSON.stringify(response) });
  }
}
function snapshotFromSamples(sample) {
  const snapshot = { format: 'life-share-v1', title: sample.title, intro: sample.intro,
    entries: sample.entries.map(entry => ({ title: entry.title, pinned: entry.pinned, note: entry.note || null,
      parts: entry.sourceRefs.map(ref => {
        const source = sample.sources.find(value => value.id === ref.sourceId), version = source.versions.find(value => value.id === ref.versionId);
        const textKind = version.text === null ? 'none' : source.relation === 'self' ? 'body' : 'excerpt';
        return { title: source.title, origin: source.origin, url: source.url || null, author: { label: '', relation: source.relation }, originalCreatedAt: version.originalCreatedAt,
          coverage: { status: source.coverage, omissions: source.omissions }, text: textKind === 'excerpt' ? version.text.slice(0, 340) : version.text, textKind };
      }) })) };
  Share.validate(snapshot); return snapshot;
}
async function instrumentAnonymous(context) {
  await context.addInitScript(() => {
    window.__publicPrivacy = { storage: [], idb: [], cache: [], fetches: [] };
    for (const name of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
      const original = Storage.prototype[name]; Storage.prototype[name] = function (...args) { __publicPrivacy.storage.push(name); return original.apply(this, args); };
    }
    for (const name of ['open', 'deleteDatabase']) {
      const original = IDBFactory.prototype[name]; IDBFactory.prototype[name] = function (...args) { __publicPrivacy.idb.push(name); return original.apply(this, args); };
    }
    for (const name of ['open', 'match', 'delete', 'keys']) {
      const original = CacheStorage.prototype[name]; CacheStorage.prototype[name] = function (...args) { __publicPrivacy.cache.push(name); return original.apply(this, args); };
    }
    const fetch = window.fetch; window.fetch = function (input, options) {
      const request = input instanceof Request ? input : null;
      __publicPrivacy.fetches.push({ url: String(request?.url || input), cache: options?.cache || request?.cache || 'default', credentials: options?.credentials || request?.credentials || 'same-origin' });
      return fetch.apply(this, arguments);
    };
  });
}
async function privacy(page, server, device) {
  const state = await page.evaluate(() => ({ ...__publicPrivacy, authLoaded: 'HaedoAuth' in window, storageLoaded: !!HaedoLife.Storage, sdkLoaded: 'supabase' in window }));
  assert.deepEqual(state.storage, []); assert.deepEqual(state.idb, []); assert.deepEqual(state.cache, []);
  assert.equal(state.authLoaded, false); assert.equal(state.storageLoaded, false); assert.equal(state.sdkLoaded, false);
  assert(state.fetches.length > 0); assert(state.fetches.every(item => item.url === cloud + '/rest/v1/rpc/life_public_page_read' && item.cache === 'no-store' && item.credentials === 'omit'));
  assert.equal(server.requests.filter(request => request.device === device).length, 0, 'Anonymous reader has no auth/private data requests');
  return { readRequests: state.fetches.length, storageAccesses: 0, idbAccesses: 0, cacheAccesses: 0, authLoaded: false, requestsNoStore: true };
}
function source(page, owner, entryIndex = 0, partIndex = 0) { return page.locator(`${owner ? '#wbSharePreview' : '#shareContent'} .share-source[data-entry-index="${entryIndex}"][data-part-index="${partIndex}"]`); }
async function publicState(page, state) { await page.waitForFunction(state => document.querySelector('#shareStatus')?.dataset.state === state, state); }
async function contentContract(page, snapshot, owner) {
  for (const [entryIndex, entry] of snapshot.entries.entries()) for (const [partIndex, part] of entry.parts.entries()) {
    const row = source(page, owner, entryIndex, partIndex); await row.waitFor();
    const body = row.locator('.share-body'), expand = row.locator('.share-expand');
    assert.equal(await row.locator('.share-source-meta').isVisible(), true);
    if (part.originalCreatedAt) assert((await row.locator('.share-source-date').textContent()).includes(part.originalCreatedAt));
    else assert.equal(await row.locator('.share-source-date').count(), 0);
    if (part.textKind === 'none') { assert.equal(await body.count(), 0); assert.equal(await expand.count(), 0); assert((await row.innerText()).includes('본문')); }
    else if (part.textKind === 'excerpt') { assert.equal(await body.evaluate(el => el.tagName), 'BLOCKQUOTE'); assert.equal(await body.textContent(), part.text); assert.equal(await expand.count(), 0); assert((await row.innerText()).includes('고른 문장')); }
    else {
      assert.equal(await body.evaluate(el => el.tagName), 'PRE'); const text = await body.textContent(); assert(text.length > 0 && part.text.startsWith(text));
      assert(!text.endsWith('\r') && !/[\uD800-\uDBFF]$/.test(text));
      if (part.text.length > 400) { assert(text.length < part.text.length); assert.equal(await expand.getAttribute('aria-expanded'), 'false'); }
    }
    if (part.coverage.status === 'partial') assert((await row.innerText()).includes('일부'));
    for (const omission of part.coverage.omissions) assert((await row.innerText()).includes(omission), 'Omissions are visible without opening details');
  }
  const notes = page.locator(`${owner ? '#wbSharePreview' : '#shareContent'} .share-fold-note`);
  if (owner) { assert(await notes.count() > 0); assert((await notes.first().innerText()).includes('접힌 본문도 전체가 공개됩니다.')); }
  else assert.equal(await notes.count(), 0);
}
async function activate(page, button, width) { if (width <= 820) await button.tap(); else { await button.focus(); await page.keyboard.press('Enter'); } }
async function take(page, report, label, width) {
  await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); }); await frames(page);
  const metrics = await page.evaluate(inspect), screenshot = `${label}-${width}.png`;
  await page.screenshot({ path: path.join(out, screenshot), fullPage: true });
  if (width === 390) await page.screenshot({ path: path.join(out, `${label}-${width}-viewport.png`), fullPage: false });
  report.visual.push({ label, width, screenshot, ...metrics });
  assert.equal(metrics.horizontalOverflow, false); assert.deepEqual(metrics.smallInputs, []); assert.deepEqual(metrics.smallTargets, []); assert.deepEqual(metrics.unnamed, []); assert.deepEqual(metrics.contrastFailures, []);
}
async function ownerPublish(page, server, sample) {
  const f = await fixture(page, sample), before = await current(page);
  await page.locator('#wbPageShare').click(); await page.locator('#wbSharePreview').waitFor(); await page.locator('#wbShareChoices > summary').click();
  for (const item of sample.sources.filter(source => source.relation === 'self')) {
    const versionId = sample.entries.flatMap(entry => entry.sourceRefs).find(ref => ref.sourceId === item.id)?.versionId;
    if (versionId) await page.locator(`.wb-share-body[data-version-id="${f.versionIds[versionId]}"]`).check();
  }
  const quoteVersion = sample.sources.find(source => source.id === 'book-introduction').versions[0], quote = quoteVersion.text.slice(0, 340);
  const quoteInput = page.locator(`.wb-share-excerpt[data-version-id="${f.versionIds[quoteVersion.id]}"]`);
  await quoteInput.locator('..').locator('summary').click();
  await quoteInput.evaluate((el, text) => { el.focus(); el.setSelectionRange(0, text.replace(/\r\n/g, '\n').length); el.dispatchEvent(new Event('select', { bubbles: true })); }, quote);
  await quoteInput.locator('..').locator('.wb-share-use-excerpt').click(); await page.locator('#wbShareChoices > summary').click();
  return { f, before, expected: snapshotFromSamples(sample) };
}
async function publishReviewed(page, server) {
  const revision = (server.publicPage?.metadata.revision || 0) + 1;
  const responses = Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/life_public_page_put')),
    page.waitForResponse(async response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/life_public_page_get') && response.ok() && (await response.json()).revision === revision)
  ]); responses.catch(() => {});
  await page.locator('#wbShareConsent').check(); await page.locator('#wbSharePublish').click();
  const [stored, confirmed] = await responses; assert.equal((await stored.json()).revision, revision); assert.equal((await confirmed.json()).revision, revision);
  await page.waitForFunction(() => document.querySelector('#wbSharePanel')?.getAttribute('aria-busy') === 'false' && document.querySelector('#wbShareError')?.hidden === true);
  await page.locator('#wbShareUrl').waitFor({ state: 'visible' });
  return new URL(await page.locator('#wbShareUrl').getAttribute('href'), base).href;
}
async function main() {
  await fs.mkdir(out, { recursive: true }); const sample = await samples();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), scope: 'Actual owner review and anonymous public reader with synthetic HTTP; Chromium viewport/touch/keyboard only, not live SQL/RLS/Google or Apple hardware.', checks: [], visual: [], observations: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, operatingRemoteWrites: 0 };
  async function check(name, width, run) {
    if (process.env.PUBLIC_EXPRESSION_MATCH && !new RegExp(process.env.PUBLIC_EXPRESSION_MATCH).test(name)) return;
    const server = new PublicCloud(), contexts = [], options = { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820, reducedMotion: 'reduce' };
    async function open(owner = false) {
      const device = `public-expression-${report.checks.length}-${contexts.length}`;
      const context = owner ? await makeContext(browser, server, device, accounts.a, options) : await browser.newContext({ serviceWorkers: 'block', ...options });
      if (!owner) { await platformContext(context, server, device, null); await instrumentAnonymous(context); }
      await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
      const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name); contexts.push({ context, page, device, owner }); return { page, device };
    }
    try { await run({ server, open }); assert.deepEqual(server.routeErrors, [], 'Synthetic HTTP route assertions'); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); annotation(error); for (const [index, item] of contexts.entries()) await item.page.screenshot({ path: path.join(out, `failure-${report.checks.length}-${index}.png`), fullPage: true }).catch(() => {}); }
    finally { for (const item of contexts) await item.context.close(); }
  }
  try {
    for (const width of [1440, 820, 390]) await check(`owner review and anonymous body/excerpt distinction at ${width}`, width, async ({ server, open }) => {
      const owner = (await open(true)).page, preparation = await ownerPublish(owner, server, sample), expected = preparation.expected;
      await contentContract(owner, expected, true); await take(owner, report, 'review', width);
      const ownBody = source(owner, true).locator('.share-body'), raw = expected.entries[0].parts[0].text;
      await activate(owner, source(owner, true).locator('.share-expand'), width); assert.equal(await ownBody.textContent(), raw);
      assert.equal(await ownBody.evaluate(el => { const r = el.getBoundingClientRect(); return document.activeElement === el && r.bottom > 0 && r.top < innerHeight; }), true);
      await activate(owner, source(owner, true).locator('.share-expand'), width);
      assert.equal(await source(owner, true).locator('.share-expand').evaluate(el => document.activeElement === el), true);
      const url = await publishReviewed(owner, server); assert.deepEqual(server.publicPage.snapshot, expected); assert.deepEqual(await current(owner), preparation.before);
      const { page, device } = await open(); await page.goto(url); await publicState(page, 'published');
      await contentContract(page, expected, false); await take(page, report, 'public', width);
      const body = source(page, false).locator('.share-body'), expand = source(page, false).locator('.share-expand');
      assert(server.publicReads.at(-1).response.snapshot.entries[0].parts[0].text === raw, 'The public RPC intentionally delivers the full opted-in body even while visually folded');
      await activate(page, expand, width); assert.equal(await body.textContent(), raw);
      const phrase = '🌱 낮은 화단의 새잎'; await body.evaluate((el, phrase) => { window.__publicTextNode = el.firstChild; const start = el.firstChild.textContent.indexOf(phrase); const range = document.createRange(); range.setStart(el.firstChild, start); range.setEnd(el.firstChild, start + phrase.length); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }, phrase);
      for (const boundary of [701, 700, width]) { await page.setViewportSize({ width: boundary, height: width === 390 ? 844 : 1000 }); await frames(page); assert.equal(await body.evaluate(el => el.firstChild === __publicTextNode), true); assert.equal(await page.evaluate(() => getSelection().toString()), phrase); }
      await activate(page, expand, width); assert.equal(await expand.getAttribute('aria-expanded'), 'false'); assert.equal(await expand.evaluate(el => document.activeElement === el), true);
      for (const link of await page.locator('.share-source-link').all()) { assert.equal(await link.getAttribute('rel'), 'noopener noreferrer'); assert.equal(await link.getAttribute('referrerpolicy'), 'no-referrer'); }
      report.observations.push({ width, rawUtf16Length: raw.length, payloadContainsWholeBody: true, excerptAlwaysWhole: true, resizePreservesTextAndSelection: true, ...await privacy(page, server, device) });
    });
    await check('same-revision background reads preserve selection; changes, revocation and failures clear stale public content', 390, async ({ server, open }) => {
      const original = snapshotFromSamples(sample); server.publicPage = { metadata: { revision: 1, publicId, updatedAt: new Date().toISOString() }, snapshot: clone(original) };
      const { page, device } = await open(); await page.clock.install();
      const firstRead = server.holdRead();
      try { await page.goto(base + '/share.html?id=' + publicId); await entered(firstRead); await publicState(page, 'loading'); assert.equal(await page.locator('#shareContent').textContent(), ''); await take(page, report, 'loading', 390); }
      finally { firstRead.release(); }
      await publicState(page, 'published'); const raw = original.entries[0].parts[0].text;
      await source(page, false).locator('.share-expand').tap();
      await source(page, false).locator('.share-body').evaluate(el => { window.__publicOriginalBody = el; window.__publicOriginalText = el.firstChild; const range = document.createRange(); range.setStart(el.firstChild, 4); range.setEnd(el.firstChild, 25); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
      const selected = await page.evaluate(() => getSelection().toString());
      async function background() {
        const response = page.waitForResponse(value => value.request().method() === 'POST' && new URL(value.url()).pathname.endsWith('/life_public_page_read')); response.catch(() => {});
        await page.clock.fastForward(30001); await response;
        await page.waitForFunction(() => document.querySelector('#shareContent')?.getAttribute('aria-busy') !== 'true');
      }
      await background(); assert.equal(await source(page, false).locator('.share-body').evaluate(el => el === __publicOriginalBody && el.firstChild === __publicOriginalText), true); assert.equal(await page.evaluate(() => getSelection().toString()), selected); assert.equal(await source(page, false).locator('.share-body').textContent(), raw);
      server.publicPage.metadata.revision++; server.publicPage.snapshot.entries[0].parts[0].text = '갱신한 공개 첫 문장.\r\n' + raw;
      await background(); assert.equal(await source(page, false).locator('.share-body').evaluate(el => el === __publicOriginalBody), false); assert.equal(await source(page, false).locator('.share-expand').getAttribute('aria-expanded'), 'false'); assert((await source(page, false).locator('.share-body').textContent()).startsWith('갱신한 공개 첫 문장.'));
      // Explicit refresh intentionally clears and reloads. Background equality
      // above is the state-preserving contract; visibility loss always clears.
      await page.evaluate(() => dispatchEvent(new Event('offline'))); await publicState(page, 'error'); assert.equal(await page.locator('#shareContent').textContent(), ''); assert.equal(await page.title(), '공유 페이지 · 해도'); await take(page, report, 'offline', 390);
      await page.evaluate(() => dispatchEvent(new Event('online'))); await publicState(page, 'published');
      server.badRead = true; await background(); await publicState(page, 'error'); assert.equal(await page.locator('#shareContent').textContent(), ''); await take(page, report, 'error', 390);
      server.badRead = false; await page.locator('#shareRefresh').tap(); await publicState(page, 'published');
      const late = server.holdRead();
      try {
        await page.clock.fastForward(30001); await entered(late); await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); await publicState(page, 'paused'); assert.equal(await page.locator('#shareContent').textContent(), '');
        server.missing = true;
      } finally { late.release(); }
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))); await publicState(page, 'missing'); assert.equal(await page.locator('#shareContent').textContent(), ''); await take(page, report, 'revoked', 390);
      server.missing = false; server.publicPage.metadata.revision++; server.publicPage.snapshot.entries = []; await page.locator('#shareRefresh').tap(); await publicState(page, 'published'); await page.locator('.share-empty').waitFor(); await take(page, report, 'empty', 390);
      report.observations.push({ scene: 'lifecycle', sameRevisionRetainsDOMAndSelection: true, changedRevisionReplacesDOM: true, lateReadCannotReviveRemovedContent: true, manualRefreshRecoversError: true, ...await privacy(page, server, device) });
    });
    assert(report.checks.length > 0); report.pass = report.checks.every(check => check.pass) && !report.consoleErrors.length && !report.pageErrors.length && !report.external.length;
  } finally {
    await browser.close(); report.finishedAt = new Date().toISOString(); const json = JSON.stringify(report, null, 2);
    await fs.writeFile(path.join(out, 'run-' + report.createdAt.replace(/[:.]/g, '-') + '.json'), json); await fs.writeFile(path.join(out, 'browser-report.json'), json);
  }
  console.log(JSON.stringify({ checks: report.checks.length, passed: report.checks.filter(check => check.pass).length, visual: report.visual.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length, report: path.join(out, 'browser-report.json') }));
  if (!report.pass) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); annotation(error); process.exitCode = 1; });
