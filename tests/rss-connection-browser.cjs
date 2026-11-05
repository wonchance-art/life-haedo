/* RSS D phase 1: actual settings screen, SDK, IndexedDB and exact-source import.
 * Only synthetic owner HTTP is intercepted; no real feed/account/Edge/DB access.
 * Start scripts/dev-server.py --port 4187, then node tests/rss-connection-browser.cjs.
 * Chromium 390/1440 is not an Apple device, deployed policy, Cron or RLS test.
 */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4187';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FakeCloud, accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const { inspectHome } = require('./home-entry-browser.cjs');
const output = path.resolve(process.env.RSS_BROWSER_OUTPUT || '.local/rss-connection-browser');
const report = { scope: 'Chromium, real app/SDK/IndexedDB, synthetic owner API only; no live feed/DB/Cron, PWA or Apple-device verification', checks: [], visual: [], consoleErrors: [], expectedConsoleErrors: [], pageErrors: [], externalRequests: [] };
function observe(page, report, name) {
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const expected = page.expectedRssHttpStatus;
    if (expected && message.location().url.startsWith(cloud + '/functions/v1/haedo-rss') && message.text().includes('status of ' + expected)) {
      report.expectedConsoleErrors.push({ check: name, message: message.text() }); return;
    }
    report.consoleErrors.push({ check: name, message: message.text() });
  });
  page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
}
const FEED = 'https://feed.example.invalid/atom.xml';
const RAW = '\ufeff새 글의 정확한 합성 본문 🌱\r\n공백  둘과 한글 <script>본문일 뿐</script>';
const hash = text => createHash('sha256').update(text).digest('hex');
const clone = value => structuredClone(value);
function gate() {
  let entered, release, finish;
  return { entered: new Promise(resolve => { entered = resolve; }), released: new Promise(resolve => { release = resolve; }), finished: new Promise(resolve => { finish = resolve; }), enter: () => entered(), release: () => release(), finish: () => finish() };
}
async function arrived(hold) {
  let timeout;
  try { await Promise.race([hold.entered, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Expected synthetic RSS request did not arrive')), 12000); })]); }
  finally { clearTimeout(timeout); }
}
async function sources(page) { return page.evaluate(async () => { const store = HaedoLife.Shell.storage; return store.read(await store.getActive()); }); }
async function until(page, predicate, label, argument) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { const value = await page.evaluate(predicate, argument); if (value) return value; await page.waitForTimeout(40); }
  throw Error('Timed out: ' + label);
}
async function open(page) {
  await nav(page, 'manage'); await page.locator('#lifeSettings').waitFor();
  await page.locator('#lifeRssOpen').click(); await page.locator('#rssConnectionPanel').waitFor();
}
async function capture(page, scene, width) {
  await page.evaluate(async () => { await document.fonts.ready; document.activeElement?.blur(); });
  const metrics = await page.evaluate(inspectHome, '#lifeApp');
  const file = `${scene}-${width}.png`;
  await page.screenshot({ path: path.join(output, file), fullPage: true });
  await page.locator('#rssItemBody').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const viewportFile = `${scene}-viewport-${width}.png`;
  const bodyView = await page.locator('#rssItemBody').evaluate(el => {
    const rect = el.getBoundingClientRect(), header = document.querySelector('.life-header')?.getBoundingClientRect(), dock = document.querySelector('.haedo-nav')?.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, topLimit: header?.bottom || 0, bottomLimit: innerWidth <= 760 ? dock.top : innerHeight };
  });
  assert.ok(bodyView.top >= bodyView.topLimit && bodyView.bottom <= bodyView.bottomLimit, 'exact source body visible between fixed bars: ' + JSON.stringify(bodyView));
  await page.screenshot({ path: path.join(output, viewportFile), fullPage: false });
  report.visual.push({ scene: scene + '-viewport', width, file: viewportFile, bodyView });
  report.visual.push({ scene, width, file, ...metrics });
  assert.equal(metrics.horizontalOverflow, false, scene + ': horizontal overflow');
  assert.deepEqual(metrics.overflow, [], scene + ': outside viewport');
  assert.deepEqual(metrics.unnamed, [], scene + ': unnamed control');
  assert.deepEqual(metrics.smallTargets, [], scene + ': controls below 44px');
  assert.deepEqual(metrics.contrastFailures, [], scene + ': contrast');
}

// Owner-scoped HTTP simulator; server baseline and immutable snapshots model the published wire contract.

class RssCloud extends FakeCloud {
  constructor() {
    super(); this.connections = new Map(); this.items = []; this.calls = []; this.configured = true;
    this.nextItems = []; this.failure = null; this.failureCode = null; this.failureStatus = 200; this.hold = null; this.executionOutcome = null;
  }
  connection(workspaceId, owner = accounts.a.id, status = 'pending') {
    const row = { id: 'cccccccc-cccc-4ccc-8ccc-000000000001', workspace_id: workspaceId, feed_url: FEED,
      status, revision: 1, baseline_at: null, baseline_count: 0, activated_at: null, cursor: null,
      last_error: null, last_checked_at: null, next_check_at: null };
    this.connections.set(owner, row); return row;
  }
  item(conn, overrides = {}) {
    return { id: 'dddddddd-dddd-4ddd-8ddd-000000000001', owner_id: accounts.a.id, connection_id: conn.id,
      identity: 'atom:urn:haedo:rss:1', title: '새로 나온 합성 글', url: 'https://feed.example.invalid/post/1', content_text: RAW,
      content_hash: hash(RAW), published_at: '2026-11-05T05:01:00.000Z', fetched_at: '2026-11-05T06:01:00.000Z',
      disposition: 'stored', reason: null, ...overrides };
  }
  snapshot(owner, workspaceId) {
    const conn = this.connections.get(owner);
    return { configured: this.configured, ready: this.configured, connections: conn && conn.workspace_id === workspaceId ? [clone(conn)] : [],
      items: conn && conn.workspace_id === workspaceId ? clone(this.items.filter(item => item.owner_id === owner && item.connection_id === conn.id)) : [],
      other_connections: conn && conn.workspace_id !== workspaceId ? [clone(conn)] : [], has_more: false, next_cursor: null };
  }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname !== '/functions/v1/haedo-rss') return super.handle(route, device);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store' };
    const send = (body, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(body) }).catch(error => { if (!/closed|handled|disposed|Target page/i.test(error.message)) throw error; });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    assert.equal(request.method(), 'POST'); const owner = this.owner(request), body = request.postDataJSON();
    assert.ok(Object.values(accounts).some(value => value.id === owner), 'Synthetic authenticated owner only');
    this.calls.push({ owner, device, body: clone(body) });
    const { action, workspaceId } = body;
    if (this.failure === action) { const row = this.connections.get(owner); if (row) row.last_error = 'fetch_failed'; return send({ error: this.failureCode || 'rss_network_error' }, this.failureStatus); }
    if (action !== 'list' && !this.configured) return send({ error: 'setup_required' });
    if (action === 'poll' && this.executionOutcome) return send({ ...this.snapshot(owner, workspaceId), execution: { status: this.executionOutcome } });
    let conn = this.connections.get(owner);
    if (action === 'register') {
      assert.equal(body.url, FEED, 'fixture allows exactly one synthetic feed');
      conn = this.connection(workspaceId, owner);
    } else if (action !== 'list') {
      assert.ok(conn && conn.id === body.connectionId && conn.workspace_id === workspaceId, 'owner + workspace scoped connection');
      if (!['preview', 'poll'].includes(action)) assert.equal(body.expectedRevision, conn.revision, 'control CAS revision');
      if (action === 'preview') {
        conn.status = 'preview'; conn.baseline_count = 2; conn.baseline_at = '2026-11-05T05:00:00.000Z'; conn.revision++;
      } else if (action === 'poll') {
        assert.equal(conn.status, 'active');
        this.items.push(...this.nextItems.filter(item => !this.items.some(old => old.id === item.id))); this.nextItems = [];
        conn.last_checked_at = '2026-11-05T06:01:00.000Z'; conn.next_check_at = '2026-11-05T07:01:00.000Z';
      } else if (action === 'activate' || action === 'resume' || action === 'retry') {
        if (action === 'activate') { assert.equal(conn.status, 'preview'); conn.activated_at = conn.baseline_at; }
        conn.status = 'active'; conn.revision++; conn.last_error = null;
      } else if (action === 'pause') { conn.status = 'paused'; conn.revision++; }
      else if (action === 'disconnect') { conn.status = 'disconnected'; conn.revision++; }
      else throw Error('Unexpected RSS fixture action ' + action);
    }
    const value = this.snapshot(owner, workspaceId);
    const hold = action === 'list' && this.hold;
    if (hold) { this.hold = null; hold.enter(); await hold.released; }
    const result = await send(value); if (hold) hold.finish(); return result;
  }
}
async function idle(page) { await page.waitForFunction(() => document.querySelector('#rssConnectionPanel')?.getAttribute('aria-busy') !== 'true'); }
const action = (page, name) => page.locator('[data-rss-action="' + name + '"]').click();
async function disconnect(page, accept = true) {
  let seen = false;
  page.once('dialog', async dialog => {
    seen = true; assert.equal(dialog.type(), 'confirm');
    assert.match(dialog.message(), /받은 자료는 그대로/); assert.match(dialog.message(), /다시 연결하면 기준 목록부터 새로/);
    if (accept) await dialog.accept(); else await dialog.dismiss();
  });
  await action(page, 'disconnect'); await idle(page); assert.ok(seen, 'disconnect requires explicit confirmation');
}

async function checkSource(page, expected = 1) {
  const bundle = await until(page, async expected => {
    const s = HaedoLife.Shell.storage, b = await s.read(await s.getActive());
    return b.sources.filter(source => source.sourceKey?.startsWith('haedo-rss/')).length === expected ? b : null;
  }, 'exact RSS material count ' + expected, expected);
  if (expected) {
    const source = bundle.sources.find(source => source.sourceKey?.startsWith('haedo-rss/'));
    const version = bundle.sourceVersions.find(version => version.sourceId === source?.id);
    assert.ok(source); assert.equal(version.contentText, RAW); assert.equal(version.contentHash, hash(RAW));
    assert.equal(version.coverage.status, 'partial'); assert.match(version.coverage.omissions.join(' '), /사진/);
  }
  return bundle;
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function check(name, run, width = 1440, accountLibrary = false) {
    if (process.env.RSS_BROWSER_MATCH && !new RegExp(process.env.RSS_BROWSER_MATCH).test(name)) return;
    const server = new RssCloud();
    if (accountLibrary) server.enableAccountLibrary();
    const context = await makeContext(browser, server, 'rss-' + report.checks.length, accounts.a,
      { viewport: { width, height: width === 390 ? 844 : 960 }, hasTouch: width === 390 });
    await context.route('https://feed.example.invalid/**', route => { report.externalRequests.push(route.request().url()); return route.abort(); });
    if (process.env.RSS_BROWSER_MUTATION) {
      const mutations = {
        'skip-hash': ['need(await step(context, () => hash(row.content_text)) === row.content_hash);', '/* Mutation: incoming content hash verification removed. */'],
        'only-active': ["if (row.disposition !== 'stored')", "if (row.disposition !== 'stored' || page.connections.find(conn => conn.id === row.connection_id)?.status !== 'active')"],
        'no-disconnect-confirm': ["if (action === 'disconnect' && !root.confirm('받은 자료는 그대로 유지됩니다. 다시 연결하면 기준 목록부터 새로 만듭니다. 연결을 해제할까요?')) return;", '/* Mutation: disconnect confirmation removed. */', 'rss-connection-ui.js']
      };
      const [needle, replacement, moduleName = 'rss-connection.js'] = mutations[process.env.RSS_BROWSER_MUTATION] || [];
      assert.ok(needle, 'known browser mutation');
      const original = await fs.readFile(path.resolve('assets/life', moduleName), 'utf8');
      assert.equal(original.split(needle).length, 2, 'mutation targets one exact safety check');
      await context.route('**/assets/life/' + moduleName, route => route.fulfill({ contentType: 'application/javascript', body: original.replace(needle, replacement) }));
    }
    const page = await context.newPage(); observe(page, report, name); page.setDefaultTimeout(12000);
    try {
      await page.goto(base + '/index.html'); await ready(page); await settle(page);
      assert.equal(server.calls.length, 0, 'no RSS request until the settings row is opened');
      await run({ page, context, server });
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
  }
  try {
    for (const width of [1440, 390]) await check('settings to exact private archive and connection lifecycle ' + width, async ({ page, server }) => {
      await open(page); await idle(page);
      await page.locator('#rssFeedUrl').fill(FEED);
      await page.locator('#rssRegister').evaluate(button => { button.click(); button.click(); }); await idle(page);
      await action(page, 'preview'); await idle(page);
      assert.match(await page.locator('#rssConnectionPanel').innerText(), /새 글만/);
      await checkSource(page, 0);
      await action(page, 'activate'); await idle(page);
      const conn = server.connections.get(accounts.a.id);
      server.nextItems = [server.item(conn), server.item(conn, { id: 'dddddddd-dddd-4ddd-8ddd-000000000002', identity: 'atom:urn:haedo:rss:2', title: '날짜를 확인할 글', disposition: 'held', reason: 'date_unknown', published_at: null, content_text: '', content_hash: null })];
      await action(page, 'poll'); await idle(page); await checkSource(page);
      if (width === 390) assert.match(await page.locator('#lifeCurrentWorkspace').innerText(), /자료 1개/, 'narrow settings material count updates after RSS projection');
      await page.locator('[data-rss-item="dddddddd-dddd-4ddd-8ddd-000000000001"]').click();
      assert.equal(await page.locator('#rssItemBody').textContent(), RAW, 'text rendering retains source bytes, never HTML');
      assert.equal(await page.locator('#rssItemBody script').count(), 0);
      assert.equal(await page.locator('#rssConnectionPanel img[src^="http"]').count(), 0, 'remote images never load');
      await capture(page, 'private-reader', width);
      const before = await sources(page); await page.locator('#rssRefresh').click(); await idle(page);
      assert.deepEqual(await sources(page), before, 'repeated inbox receipt is idempotent');
      await action(page, 'pause'); await idle(page); assert.equal(conn.status, 'paused');
      await action(page, 'resume'); await idle(page); assert.equal(conn.status, 'active');
      server.failure = 'poll'; await action(page, 'poll'); await idle(page);
      await page.locator('#rssError:not([hidden])').waitFor(); assert.deepEqual(await sources(page), before, 'failed intake preserves exact originals');
      server.failure = null;
      await page.locator('#rssRefresh').click(); await idle(page); await action(page, 'retry'); await idle(page);
      await disconnect(page); assert.equal(conn.status, 'disconnected');
      assert.deepEqual(await sources(page), before, 'disconnect keeps already stored originals');
      await nav(page, 'schedule'); await open(page); await idle(page);
      assert.deepEqual(await sources(page), before, 'reopening never duplicates stored materials');
      assert.equal(server.calls.filter(call => call.body.action === 'register').length, 1, 'duplicate activation starts only one registration');
      await page.locator('#rssClose').click();
      assert.equal(await page.locator('#rssConnectionPanel').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'lifeRssOpen', 'close restores entry focus');
    }, width);
    await check('unconfigured connector keeps input and performs no registration', async ({ page, server }) => {
      server.configured = false; await open(page); await idle(page);
      assert.match(await page.locator('#rssConnectionPanel').innerText(), /준비|확정/);
      assert.equal(server.calls.filter(call => call.body.action !== 'list').length, 0);
    });
    await check('corrupt immutable body is rejected before material storage', async ({ page, server }) => {
      const ws = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      const conn = server.connection(ws, accounts.a.id, 'active'); server.items = [server.item(conn, { content_hash: '0'.repeat(64) })];
      const before = await sources(page); await open(page); await idle(page);
      assert.deepEqual(await sources(page), before, 'a mismatched wire hash cannot become a new material');
      await page.locator('#rssError:not([hidden])').waitFor();
      assert.equal(await page.locator('[data-rss-item]').count(), 0, 'unverified private body is not exposed as a valid item');
    });
    for (const scenario of [
      { code: 'rss_retry_limit', action: 'retry', status: 'active', pattern: /1시간에 2회/ },
      { code: 'rss_invalid_feed', action: 'preview', status: 'pending', pattern: /피드/ },
      { code: 'rss_connection_exists', action: 'register', pattern: /이미|다른 자료공간/ },
      { code: 'rss_not_found', action: 'poll', status: 'active', pattern: /연결/, httpStatus: 403 }
    ]) await check('dedicated service error keeps input and originals: ' + scenario.code, async ({ page, server }) => {
      const ws = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      if (scenario.status) { const conn = server.connection(ws, accounts.a.id, scenario.status); if (scenario.action === 'retry') conn.last_error = 'fetch_failed'; }
      await open(page); await idle(page); await page.locator('#rssFeedUrl').fill(FEED);
      server.failure = scenario.action; server.failureCode = scenario.code; server.failureStatus = scenario.httpStatus || 200;
      page.expectedRssHttpStatus = scenario.httpStatus;
      const before = await sources(page), expectedBefore = report.expectedConsoleErrors.length;
      if (scenario.action === 'register') await page.locator('#rssRegister').click(); else await action(page, scenario.action);
      await idle(page); const shown = await page.locator('#rssError').innerText();
      assert.match(shown, scenario.pattern, 'specific error explains recovery');
      assert.doesNotMatch(shown, /로그인을 확인|입력과 기존 자료는 유지됩니다/, 'specific server error is not replaced by auth or generic transport prose');
      assert.equal(await page.locator('#rssFeedUrl').inputValue(), FEED); assert.deepEqual(await sources(page), before);
      if (scenario.httpStatus) assert.equal(report.expectedConsoleErrors.length - expectedBefore, 1, 'exactly one expected synthetic HTTP diagnostic');
    });
    await check('not_due and stale do not claim that collection ran', async ({ page, server }) => {
      const ws = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      const conn = server.connection(ws, accounts.a.id, 'active'); await open(page); await idle(page);
      server.nextItems = [server.item(conn)]; const before = await sources(page);
      for (const outcome of ['not_due', 'stale']) {
        server.executionOutcome = outcome; await action(page, 'poll'); await idle(page);
        const status = await page.locator('#rssStatus').innerText();
        assert.doesNotMatch(status, /확인했습니다|수집했습니다|완료했습니다/, 'unexecuted result cannot claim success');
        assert.match(status, outcome === 'not_due' ? /다음 확인 시간/ : /이번 확인 결과를 반영하지 않았습니다/, 'execution-specific state is visible');
        assert.deepEqual(await sources(page), before, 'unexecuted check cannot invent collected material');
      }
    });
    await check('disconnect confirmation cancel and accept preserve the archive', async ({ page, server }) => {
      const ws = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      const conn = server.connection(ws, accounts.a.id, 'active'); server.items = [server.item(conn)];
      await open(page); await idle(page); const before = await checkSource(page);
      const callsBefore = server.calls.length; await disconnect(page, false);
      assert.equal(conn.status, 'active'); assert.equal(server.calls.length, callsBefore, 'cancel sends no disconnect request');
      assert.deepEqual(await sources(page), before);
      await disconnect(page, true); assert.equal(conn.status, 'disconnected');
      assert.equal(server.calls.filter(call => call.body.action === 'disconnect').length, 1);
      assert.deepEqual(await sources(page), before, 'confirmed disconnect preserves exact stored data');
      assert.equal(await page.locator('#rssRegister').isEnabled(), true, 'reconnection starts from an explicit registration');
    });
    await check('other workspace connection is shown without copying its private inbox', async ({ page, server }) => {
      const ws = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      const conn = server.connection('eeeeeeee-eeee-4eee-8eee-000000000001', accounts.a.id, 'paused');
      server.items = [server.item(conn)]; assert.notEqual(conn.workspace_id, ws);
      const before = await sources(page); await open(page); await idle(page);
      assert.match(await page.locator('#rssConnectionPanel').innerText(), /다른 자료공간/);
      assert.match(await page.locator('#rssConnectionPanel').innerText(), /수집 중지됨/);
      assert.equal(await page.locator('[data-rss-item]').count(), 0);
      assert.equal(await page.locator('[data-rss-action]').count(), 0, 'another workspace connection has no controls here');
      assert.deepEqual(await sources(page), before);
      await page.locator('#rssFeedUrl').fill(FEED);
      if (await page.locator('#rssRegister').isEnabled()) {
        server.failure = 'register'; server.failureCode = 'rss_connection_exists';
        await page.locator('#rssRegister').click(); await idle(page); assert.match(await page.locator('#rssError').innerText(), /다른 자료공간|이미/);
      } else assert.match(await page.locator('#rssConnectionPanel').innerText(), /먼저|기존|연결/);
      assert.deepEqual(await sources(page), before);
    });
    await check('same item revision preserves the exact older source version', async ({ page, server }) => {
      const ws = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      const conn = server.connection(ws, accounts.a.id, 'active'); server.items = [server.item(conn)];
      await open(page); await idle(page); const old = await checkSource(page);
      const oldSource = old.sources.find(source => source.sourceKey?.startsWith('haedo-rss/'));
      const oldVersion = old.sourceVersions.find(version => version.sourceId === oldSource.id);
      const edited = RAW + '\r\n나중에 덧붙인 문장';
      server.items.push(server.item(conn, { id: 'dddddddd-dddd-4ddd-8ddd-000000000003', title: '수정한 합성 글', content_text: edited, content_hash: hash(edited), fetched_at: '2026-11-05T07:01:00.000Z' }));
      await page.locator('#rssRefresh').click(); await idle(page);
      const latest = await sources(page);
      assert.equal(latest.sources.filter(source => source.sourceKey?.startsWith('haedo-rss/')).length, 1, 'same GUID remains one source');
      assert.deepEqual(latest.sourceVersions.find(version => version.id === oldVersion.id), oldVersion, 'old exact version is immutable');
      const updated = latest.sourceVersions.find(version => version.id !== oldVersion.id && version.sourceId === oldSource.id);
      assert.ok(updated, 'edit has its own source version'); assert.equal(updated.contentText, edited); assert.equal(updated.contentHash, hash(edited));
      await page.locator('[data-rss-item="dddddddd-dddd-4ddd-8ddd-000000000001"]').click();
      assert.equal(await page.locator('#rssItemBody').textContent(), RAW, 'old inbox receipt reads its own exact text');
      await page.locator('[data-rss-item="dddddddd-dddd-4ddd-8ddd-000000000003"]').click();
      assert.equal(await page.locator('#rssItemBody').textContent(), edited, 'new inbox receipt reads updated exact text');
      await page.locator('#rssRefresh').click(); await idle(page); assert.deepEqual(await sources(page), latest, 'replaying both receipts is idempotent');
    });
    await check('fresh second device retains paused and disconnected archive without duplicate sources', async ({ page, server }) => {
      await open(page); await idle(page);
      await page.locator('#rssFeedUrl').fill(FEED); await page.locator('#rssRegister').click(); await idle(page);
      await action(page, 'preview'); await idle(page); await action(page, 'activate'); await idle(page);
      const conn = server.connections.get(accounts.a.id);
      // The worker has already stored this item, but neither device has read it yet.
      // Pause returns the immutable server archive even though future collection stops.
      server.items = [server.item(conn)];
      await action(page, 'pause'); await idle(page); assert.equal(conn.status, 'paused');
      assert.equal((await sources(page)).sources.filter(source => source.sourceKey?.startsWith('haedo-rss/')).length, 1, 'stopping collection must not prevent an already archived item from materializing');
      const first = await checkSource(page);
      await until(page, async id => {
        const state = await HaedoLife.Shell.accountLibrary.getState(id);
        return state.mode === 'account' && state.status === 'synced' && ['sources', 'composition', 'metadata'].every(key => state.domains[key]?.status === 'synced');
      }, 'automatic account acknowledgement of paused archive', conn.workspace_id);
      await disconnect(page); assert.equal(conn.status, 'disconnected');
      assert.deepEqual(await sources(page), first, 'disconnect does not discard the paused archive');
      const secondContext = await makeContext(browser, server, 'rss-fresh-second-device', accounts.a,
        { viewport: { width: 390, height: 844 }, hasTouch: true });
      await secondContext.route('https://feed.example.invalid/**', route => { report.externalRequests.push(route.request().url()); return route.abort(); });
      const second = await secondContext.newPage(); observe(second, report, 'fresh second device'); second.setDefaultTimeout(12000);
      try {
        await second.goto(base + '/index.html'); await ready(second); await settle(second);
        assert.equal(await second.evaluate(() => HaedoLife.Shell.storage.getActive()), conn.workspace_id, 'fresh login discovers the existing account workspace');
        const received = await checkSource(second);
        assert.deepEqual(received.sources, first.sources, 'same source ID and metadata across independent IndexedDB contexts');
        assert.deepEqual(received.sourceVersions, first.sourceVersions, 'same exact version ID, bytes and hash on fresh device');
        await open(second); await idle(second);
        assert.match(await second.locator('[data-rss-connection]').innerText(), /연결 해제됨/);
        await second.locator('[data-rss-item="dddddddd-dddd-4ddd-8ddd-000000000001"]').click();
        assert.equal(await second.locator('#rssItemBody').textContent(), RAW);
        await second.locator('#rssRefresh').click(); await idle(second);
        assert.deepEqual(await sources(second), received, 'disconnected inbox replay creates no duplicate source or version');
        assert.equal(server.libraryDefaults.size, 1, 'both devices share one account default');
      } finally { await secondContext.close(); }
    }, 1440, true);
    await check('late old-account inbox never reaches the next account', async ({ page, server }) => {
      const ws = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      const conn = server.connection(ws, accounts.a.id, 'active');
      await open(page); await idle(page);
      server.items = [server.item(conn)]; const hold = gate(); server.hold = hold;
      await page.locator('#rssRefresh').click(); await arrived(hold);
      try {
        await page.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.b));
        await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id);
        await ready(page); await settle(page); hold.release();
        await hold.finished;
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const b = await sources(page);
        assert.equal(b.sources.some(source => source.sourceKey?.startsWith('haedo-rss/')), false);
        assert.equal(await page.locator('#rssItemBody').count(), 0, 'departed account private reader is gone');
        assert.doesNotMatch(await page.locator('#lifeApp').innerText(), /새로 나온 합성 글/);
      } finally { hold.release(); }
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
  } finally {
    await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  const result = { passed: report.checks.filter(check => check.pass).length, total: report.checks.length, visual: report.visual.length, console: report.consoleErrors.length, expectedHttp: report.expectedConsoleErrors.length, page: report.pageErrors.length, realFeeds: report.externalRequests.length };
  console.log(JSON.stringify(result));
  if (report.checks.some(check => !check.pass) || report.consoleErrors.length || report.pageErrors.length || report.externalRequests.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
