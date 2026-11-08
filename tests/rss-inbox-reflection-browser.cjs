/* Actual app startup/scheduler, SDK and device IndexedDB; synthetic owner HTTP only.
 * BASE_URL=http://127.0.0.1:4173 node tests/rss-inbox-reflection-browser.cjs
 * No live feed, deployed Edge, SQL, Cron or Apple-device claim. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { RssCloud, FEED, RAW, hash, gate, arrived, sources, until, observe } = require('./rss-connection-browser.cjs');
const { accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const output = path.resolve(process.env.RSS_REFLECTION_OUTPUT || '.local/rss-reflection/browser');
const report = { checks: [], visual: [], scriptLoads: [], consoleErrors: [], consoleWarnings: [], expectedConsoleErrors: [], expectedTransport: [], expectedAuthConsole: [], expectedAuthTransport: [], pageErrors: [], externalRequests: [], evidence: [] };
const clone = value => structuredClone(value);
const cursor = row => ({ fetched_at: row.fetched_at, id: row.id });
const order = (a, b) => a.fetched_at.localeCompare(b.fetched_at) || a.id.localeCompare(b.id);

// The SQL wire contract is ascending and strictly greater than `before`.
// Keep that historical field name and page boundaries, including empty tails.
class ReflectionCloud extends RssCloud {
  constructor({ count = 1, configured = true, pageSize = 2, accountLibrary = false, httpStatus = 200, outsideLease = 0 } = {}) {
    super(); this.configured = configured; this.initialCount = count; this.pageSize = pageSize; this.httpStatus = httpStatus;
    this.seeded = new Set(); this.listResponses = []; this.holdOwner = null; this.extraConnections = []; this.outsideLease = outsideLease;
    if (accountLibrary) this.enableAccountLibrary();
  }
  add(owner, conn, number) {
    const text = number === 1 ? RAW : RAW + '\n합성 항목 ' + number;
    const item = this.item(conn, { owner_id: owner, id: 'dddddddd-dddd-4ddd-8ddd-' + (owner === accounts.a.id ? '1' : '2') + String(number).padStart(11, '0'),
      identity: 'atom:urn:reflection:' + number, title: '합성 RSS ' + number, content_text: text, content_hash: hash(text),
      fetched_at: '2026-11-05T06:01:' + String(number).padStart(2, '0') + '.000Z' });
    this.items.push(item); return item;
  }
  seed(owner, workspaceId) {
    if (this.seeded.has(owner)) return;
    this.seeded.add(owner);
    if (!this.initialCount) return;
    const conn = this.connection(workspaceId, owner, 'active');
    for (let number = 1; number <= this.initialCount; number++) {
      const row = this.add(owner, conn, number);
      if (number <= this.outsideLease) row.fetched_at = new Date(Date.parse(row.fetched_at) - 600000).toISOString();
    }
  }
  snapshot(owner, workspaceId) {
    const value = super.snapshot(owner, workspaceId);
    const extra = this.extraConnections.filter(row => row.owner === owner && row.connection.workspace_id === workspaceId);
    value.connections.push(...extra.map(row => this.viewConnection(row.connection)));
    value.items.push(...clone(this.items.filter(item => item.owner_id === owner && extra.some(row => row.connection.id === item.connection_id))));
    return value;
  }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname !== '/functions/v1/haedo-rss' || request.method() !== 'POST' || request.postDataJSON().action !== 'list') return super.handle(route, device);
    const owner = this.owner(request), body = request.postDataJSON();
    assert.ok(Object.values(accounts).some(account => account.id === owner));
    this.calls.push({ owner, device, body: clone(body) });
    if (this.failure === 'list') return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'network_error' }) });
    if (this.httpStatus !== 200) return route.fulfill({ status: this.httpStatus, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'NOT_FOUND', message: 'Requested function was not found' }) });
    this.seed(owner, body.workspaceId);
    const snapshot = this.snapshot(owner, body.workspaceId);
    const all = snapshot.items.sort(order).filter(item => !body.before || order(item, body.before) > 0);
    const items = all.slice(0, this.pageSize), hasMore = all.length > items.length;
    const value = { ...snapshot, items, has_more: hasMore, next_cursor: hasMore ? cursor(items.at(-1)) : null };
    const held = this.hold && (!this.holdOwner || this.holdOwner === owner) ? this.hold : null;
    if (held) { this.hold = null; held.enter(); await held.released; }
    await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify(value) }).catch(error => {
      if (!/closed|handled|disposed|Target page/i.test(error.message)) throw error;
    });
    this.listResponses.push({ owner, device, before: clone(body.before || null), items: items.map(item => item.id) });
    if (held) held.finish();
  }
}

function replaceOnce(source, needle, replacement) {
  assert.equal(source.split(needle).length, 2, 'browser mutation/instrumentation must target exactly one boundary: ' + needle);
  return source.replace(needle, replacement);
}
async function instrument(context, { holdStartup = false } = {}) {
  await context.route('**/assets/life/rss-connection.js', async route => {
    const response = await route.fetch(); let source = await response.text(); const originalSha256 = hash(source);
    source = replaceOnce(source, 'async function receive(context, row) {', "async function receive(context, row) { (root.__rssReceiveVisits ||= []).push({ owner: owner.userId, itemId: row.id });");
    source = replaceOnce(source, 'result = await verifier.auth.getUser(context.accessToken);',
      "result = await verifier.auth.getUser(context.accessToken); (root.__rssSdkResults ||= []).push({ owner: owner.userId, errorName: result?.error?.name || null, sessionMissing: !!root.supabase.isAuthSessionMissingError(result?.error) });");
    if (process.env.RSS_REFLECTION_MUTATION === 'ignore-ack') source = replaceOnce(source,
      'const progress = await step(context, () => storage.readRssInboxProgress(workspaceId));',
      'const progress = await step(context, () => storage.readRssInboxProgress(workspaceId)); if (pages === 0) { progress.cursor = null; progress.receipts = []; }');
    if (process.env.RSS_REFLECTION_MUTATION === 'shared-verifier') source = replaceOnce(source,
      'result = await verifier.auth.getUser(context.accessToken);', 'result = await client.auth.getUser(context.accessToken);');
    if (process.env.RSS_REFLECTION_MUTATION === 'no-overlap') source = replaceOnce(source,
      'scanCursor = overlapCursor(progress.cursor);', 'scanCursor = progress.cursor;');
    if (process.env.RSS_REFLECTION_MUTATION === 'no-wake-recheck') source = replaceOnce(source,
      'const recheck = () => { syncNow(undefined, { recheck: true }); };', 'const recheck = wake;');
    if (process.env.RSS_REFLECTION_MUTATION === 'more-ahead') source = replaceOnce(source,
      "return run('list', { before: { fetched_at: before.fetched_at, id: before.id } }, onProgress);",
      "return run('list', { before: { fetched_at: before.fetched_at, id: before.id } }, onProgress).then(async page => { const progress = await storage.readRssInboxProgress(workspaceId), bundle = await storage.read(workspaceId); const receipts = page.items.filter(row => row.sourceVersionId).map(row => ({ kind: 'stored', cursor: { fetched_at: row.fetched_at, id: row.id }, itemId: row.id, sourceId: row.sourceId, sourceVersionId: row.sourceVersionId, contentHash: row.content_hash })); await storage.saveRssInboxProgress(workspaceId, { cursor: receipts.at(-1)?.cursor || null, receipts }, progress.revision, { expectedBundleRevision: bundle.revision }); return page; });");
    source += `\n;(()=>{if(globalThis.__rssCaptureInstalled)return;globalThis.__rssCaptureInstalled=true;const api=HaedoLife.RssConnection;HaedoLife.RssConnection=Object.freeze({...api,createReflection(options){const instance=api.createReflection({...options,onStatus(status){(globalThis.__rssReflectionCycles||=[]).push({owner:options.storage.account.userId,...status});return options.onStatus?.(status);}});(globalThis.__rssReflectors||=[]).push({owner:options.storage.account.userId,instance});return ${holdStartup ? 'Object.freeze({...instance,start(){}})' : 'instance'};}});})();`;
    report.scriptLoads.push({ path: 'assets/life/rss-connection.js', originalSha256, servedSha256: hash(source), mutation: process.env.RSS_REFLECTION_MUTATION || null, holdStartup });
    await route.fulfill({ response, body: source });
  });
  if (process.env.RSS_REFLECTION_MUTATION === 'skip-restore-validation') await context.route('**/assets/life/storage.js', async route => {
    const response = await route.fetch(), source = await response.text();
    const changed = replaceOnce(source, 'receipts = rssValidPrefix(bundle, storedReceipts, await rssBodyProofs(bundle, storedReceipts));', 'receipts = storedReceipts;');
    report.scriptLoads.push({ path: 'assets/life/storage.js', originalSha256: hash(source), servedSha256: hash(changed), mutation: process.env.RSS_REFLECTION_MUTATION });
    await route.fulfill({ response, body: changed });
  });
  await context.route('https://feed.example.invalid/**', route => { report.externalRequests.push(route.request().url()); return route.abort(); });
}
async function app(context, name, observePage = observe, preparePage) {
  const page = await context.newPage(); page.setDefaultTimeout(12000); observePage(page, report, name);
  if (preparePage) await preparePage(page);
  await page.goto(base + '/index.html'); await ready(page); await settle(page);
  await page.waitForFunction(() => globalThis.__rssReflectors?.length > 0);
  return page;
}
async function completed(page, expected, state = 'idle', cycles = 1) {
  await until(page, expected => {
    const completed = (globalThis.__rssReflectionCycles || []).filter(row => row.owner === HaedoAuth.user?.id), status = completed.at(-1);
    return completed.length >= expected.cycles && status?.state === expected.state && status.checkedItems === expected.count ? status : null;
  }, 'RSS reflection completes with exact visited-item count', { count: expected, state, cycles });
}
async function archive(page, rows) {
  const bundle = await sources(page), actual = bundle.sourceVersions.filter(version => version.id.startsWith('rssv_')).sort((a, b) => a.id.localeCompare(b.id));
  const expected = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(actual.map(version => version.id), expected.map(row => 'rssv_' + row.id), 'each expected immutable feed version must exist exactly once');
  assert.equal(bundle.sources.filter(source => source.sourceKey?.startsWith('haedo-rss/')).length, new Set(rows.map(row => row.identity)).size);
  for (let i = 0; i < expected.length; i++) { assert.equal(actual[i].contentText, expected[i].content_text); assert.equal(actual[i].contentHash, expected[i].content_hash); }
  return bundle;
}
async function progress(page) { return page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.readRssInboxProgress(await s.getActive()); }); }
async function tick(page) { await page.clock.fastForward(61000); await settle(page); }
async function startHeld(page) { await page.evaluate(() => __rssReflectors.at(-1).instance.start()); }
const overlap = value => ({ fetched_at: new Date(Date.parse(value.fetched_at) - 120001).toISOString(), id: '00000000-0000-0000-0000-000000000000' });
function exactScan(calls, rows, start, size) {
  const expected = [start];
  for (let i = size; i < rows.length; i += size) expected.push(cursor(rows[i - 1]));
  assert.deepEqual(calls.map(call => call.body.before || null), expected, 'one bounded overlap scan advances by the actual page cursor, without restarting the window per page');
}

async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, options = {}) {
    if (process.env.RSS_REFLECTION_MATCH && !new RegExp(process.env.RSS_REFLECTION_MATCH).test(name)) return;
    const server = new ReflectionCloud(options), contexts = [];
    async function device(label, setup = {}) {
      const context = await makeContext(browser, server, label, setup.account || accounts.a, setup.viewport ? { viewport: setup.viewport } : {});
      context.on('page', page => page.on('console', entry => { if (entry.type() === 'warning') report.consoleWarnings.push({ check: name, message: entry.text() }); }));
      contexts.push(context); await instrument(context, setup);
      return context;
    }
    try { await run({ server, device }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) {
      const pages = await Promise.all(contexts.flatMap(context => context.pages()).map(page => page.evaluate(() => ({ statuses: (globalThis.__rssReflectors || []).map(row => ({ owner: row.owner, ...row.instance.getStatus() })), cycles: globalThis.__rssReflectionCycles || [], visits: globalThis.__rssReceiveVisits || [] })).catch(() => null)));
      report.checks.push({ name, pass: false, error: error.stack, pages, calls: server.calls }); console.error('FAIL ' + name + '\n' + error.stack + '\n' + JSON.stringify({ pages, calls: server.calls }));
    }
    finally { for (const context of contexts) await context.close(); }
  }
  try {
    await check('startup reflects the same inbox once on each independent device without opening RSS', async ({ server, device }) => {
      const a = await app(await device('first'), 'first device'); await completed(a, 1);
      assert.equal(await a.locator('#rssConnectionPanel').count(), 0);
      const first = await archive(a, server.items), ackA = await progress(a);
      const b = await app(await device('second'), 'second device'); await completed(b, 1);
      assert.equal((await sources(b)).workspaceId, first.workspaceId);
      await archive(b, server.items); const ackB = await progress(b);
      assert.deepEqual(ackB.receipts, ackA.receipts);
      for (const page of [a, b]) assert.equal((await page.evaluate(() => __rssReceiveVisits)).length, 1, 'each device independently verifies its material before ACK');
      assert.ok(server.calls.every(call => call.body.action === 'list'));
    }, { accountLibrary: true });

    await check('restart uses persistent ACK, bounded lease overlap and no repeated material receipt', async ({ server, device }) => {
      const context = await device('restart'); let page = await app(context, 'initial application'); await completed(page, 5);
      const before = await archive(page, server.items), ack = await progress(page);
      assert.equal(server.calls.length, 3); await page.close(); const count = server.calls.length;
      page = await app(context, 'fresh JavaScript application');
      // Wait for the real idle-start request before examining a zero-item result.
      await until(page, () => globalThis.__rssReflectionCycles?.length >= 1, 'restarted reflection completes');
      await page.evaluate(() => __rssReflectors.at(-1).instance.syncNow());
      // #212 comment 6684028544 requires a lease-sized overlap. Re-reading its
      // pages is intentional; receiving an already acknowledged item is not.
      assert.equal(server.calls.length - count, 4, 'startup and an explicit repeat each scan exactly two overlap pages');
      assert.equal(await page.evaluate(() => (globalThis.__rssReceiveVisits || []).length), 0, 'restart never revisits an acknowledged item');
      assert.deepEqual(await archive(page, server.items), before); assert.deepEqual(await progress(page), ack);
      exactScan(server.calls.slice(count, count + 2), server.items.slice(2), overlap(ack.cursor), 2);
      exactScan(server.calls.slice(count + 2), server.items.slice(2), overlap(ack.cursor), 2);
      const oldIds = new Set(server.items.slice(0, 2).map(row => row.id));
      assert.equal(server.listResponses.slice(count).flatMap(row => row.items).filter(id => oldIds.has(id)).length, 0, 'rows outside the lease window are never fetched again');
      report.evidence.push({ name: 'restart', initialPages: count, restartAndRepeatPages: server.calls.length - count, outsideWindowRows: 2, outsideWindowFetches: 0, repeatedItems: 0 });
    }, { count: 5, outsideLease: 2 });

    await check('periodic reflection receives only a new exact version with RSS UI closed', async ({ server, device }) => {
      const context = await device('periodic'), page = await context.newPage(); observe(page, report, 'periodic');
      await page.clock.install(); await page.goto(base + '/index.html'); await ready(page); await settle(page); await completed(page, 1);
      const conn = server.connections.get(accounts.a.id); server.add(accounts.a.id, conn, 2);
      await tick(page); await completed(page, 2, 'idle', 2); await archive(page, server.items);
      assert.equal(await page.locator('#rssConnectionPanel').count(), 0);
      assert.equal(await page.evaluate(() => __rssReceiveVisits.length), 2);
      assert.equal(server.calls.length, 2, 'the periodic request resumes after its durable cursor');
    });

    await check('a retained page resumes the verified same owner after Auth advances its epoch', async ({ server, device }) => {
      const context = await device('retained'), page = await context.newPage(); observe(page, report, 'retained');
      await page.clock.install(); await page.goto(base + '/index.html'); await ready(page); await settle(page); await completed(page, 1);
      const epoch = await page.evaluate(() => HaedoAuth.epoch);
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      assert.ok(await page.evaluate(previous => HaedoAuth.epoch > previous, epoch), 'actual Auth pagehide advances the account epoch');
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await page.waitForFunction(() => !document.getElementById('lifeApp').hidden); await completed(page, 1, 'idle', 2);
      server.add(accounts.a.id, server.connections.get(accounts.a.id), 2);
      await tick(page); await completed(page, 2, 'idle', 3); await archive(page, server.items);
      assert.equal(server.calls.length, 3, 'one startup, one retained-page wake and one periodic tail request');
    });

    await check('a transient reflection failure waits for the next period and preserves the screen', async ({ server, device }) => {
      server.failure = 'list'; const context = await device('transient'), page = await context.newPage(); observe(page, report, 'transient');
      await page.clock.install(); await page.goto(base + '/index.html'); await ready(page); await settle(page);
      await until(page, () => globalThis.__rssReflectors?.at(-1)?.instance.getStatus().state === 'error', 'transient failure is contained');
      assert.equal(server.calls.length, 1); await settle(page); assert.equal(server.calls.length, 1, 'no immediate retry loop');
      assert.equal(await page.locator('#rssConnectionPanel').count(), 0);
      server.failure = null; await tick(page); await completed(page, 1); await archive(page, server.items);
      assert.equal(server.calls.length, 2, 'the next period performs exactly one retry');
    });

    for (const configured of [true, false]) await check('empty or runtime-off startup stops polling ' + configured, async ({ server, device }) => {
      const context = await device('stopped'), page = await context.newPage(); observe(page, report, 'stopped');
      await page.clock.install(); await page.goto(base + '/index.html'); await ready(page); await settle(page); await completed(page, configured ? 0 : 1, 'stopped');
      await archive(page, server.items);
      assert.equal(server.calls.length, 1);
      await tick(page); await tick(page);
      assert.equal(server.calls.length, 1, 'the minute timer never polls an empty or disabled discovery');
      // 2026-11-08 rule: a returning wake rechecks a parked discovery at most once per interval.
      await page.evaluate(() => { for (let i = 0; i < 5; i++) { dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); } });
      await completed(page, configured ? 0 : 1, 'stopped', 2);
      assert.equal(server.calls.length, 2, 'a burst of returning wakes rechecks exactly once');
      await page.evaluate(() => { dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); }); await settle(page);
      assert.equal(server.calls.length, 2, 'returning wakes inside one interval do not recheck again');
      if (configured) {
        await page.evaluate(async feed => {
          const s = HaedoLife.Shell.storage, service = HaedoLife.RssConnection.create({ storage: s, workspaceId: await s.getActive() });
          try { await service.register(feed); } finally { service.dispose(); }
        }, FEED);
        await completed(page, 0, 'idle', 3);
        assert.equal(server.calls.filter(call => call.body.action === 'register').length, 1);
        assert.equal(server.calls.filter(call => call.body.action === 'list').length, 3, 'the actual registration event resumes the stopped consumer');
      } else {
        // Collection enabled elsewhere: the early wake above runs on the next due minute, once.
        server.configured = true; await tick(page); await completed(page, 1, 'idle', 3);
        assert.equal(server.calls.length, 3); await archive(page, server.items);
      }
    }, { count: configured ? 0 : 1, configured });

    await check('a connection registered on another device reaches an open parked tab on its next returning wake', async ({ server, device }) => {
      const parked = await (await device('parked-tab')).newPage(); observe(parked, report, 'parked-tab');
      await parked.clock.install(); await parked.goto(base + '/index.html'); await ready(parked); await settle(parked); await completed(parked, 0, 'stopped');
      const lists = () => server.calls.filter(call => call.device === 'parked-tab' && call.body.action === 'list').length;
      assert.equal(lists(), 1);
      const other = await app(await device('registering-device'), 'registering device'); await completed(other, 0, 'stopped');
      assert.equal((await sources(other)).workspaceId, (await sources(parked)).workspaceId);
      await other.evaluate(async feed => {
        const s = HaedoLife.Shell.storage, service = HaedoLife.RssConnection.create({ storage: s, workspaceId: await s.getActive() });
        try { await service.register(feed); } finally { service.dispose(); }
      }, FEED);
      server.add(accounts.a.id, server.connections.get(accounts.a.id), 1);
      await tick(parked); assert.equal(lists(), 1, 'the parked tab does not poll; only a returning wake looks again');
      await parked.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await completed(parked, 1, 'idle', 2); await archive(parked, server.items);
      assert.equal(lists(), 2); assert.equal(await parked.locator('#rssConnectionPanel').count(), 0);
      report.evidence.push({ name: 'other-device-registration', parkedTabLists: lists(), timerOnlyLists: 0, reflectedItems: 1, reload: false });
    }, { count: 0, accountLibrary: true });

    await check('an undeployed RSS function returns HTTP 404 once without app errors or retry', async ({ server, device }) => {
      const context = await device('missing-edge'), page = await context.newPage(); page.expectedRssHttpStatus = 404; observe(page, report, 'missing-edge');
      page.on('response', response => { if (response.url() === cloud + '/functions/v1/haedo-rss' && response.status() === 404) report.expectedTransport.push({ check: 'missing-edge', status: response.status(), method: response.request().method() }); });
      await page.clock.install(); await page.goto(base + '/index.html'); await ready(page); await settle(page);
      await until(page, () => globalThis.__rssReflectors?.at(-1)?.instance.getStatus().state === 'stopped', 'missing function parks reflection');
      assert.equal(server.calls.length, 1); await tick(page);
      await page.evaluate(() => { dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); }); await settle(page);
      assert.equal(server.calls.length, 1); assert.equal(await page.locator('#rssConnectionPanel').count(), 0);
      // #212 comment 6659281521 permits only this one native Chromium 404 line.
      assert.deepEqual(report.expectedTransport, [{ check: 'missing-edge', status: 404, method: 'POST' }]);
      const native = report.expectedConsoleErrors.filter(row => row.check === 'missing-edge');
      assert.equal(native.length, 1); assert.match(native[0].message, /^Failed to load resource:.*status of 404/);
      assert.deepEqual(report.consoleErrors.filter(row => row.check === 'missing-edge'), []);
      assert.deepEqual(report.pageErrors.filter(row => row.check === 'missing-edge'), []);
    }, { count: 0, httpStatus: 404 });

    await check('a late account A response cannot write A originals or ACK into account B', async ({ server, device }) => {
      server.hold = gate(); server.holdOwner = accounts.a.id; const held = server.hold;
      const page = await app(await device('switch'), 'account switching'); await arrived(held);
      await page.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.b));
      await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id);
      await ready(page); await settle(page); held.release(); await held.finished; await completed(page, 1);
      const expected = server.items.filter(row => row.owner_id === accounts.b.id); await archive(page, expected);
      const ack = await progress(page); assert.deepEqual(ack.receipts.map(row => row.itemId), expected.map(row => row.id));
      assert.ok((await page.evaluate(() => globalThis.__rssReceiveVisits || [])).every(row => row.owner === accounts.b.id));
    });

    for (const outcome of ['success', 'session_not_found']) await check('late automatic SDK verification ' + outcome + ' cannot notify, sign out or remount the replacement account', async ({ server, device }) => {
      const context = await device('auth-' + outcome, { holdStartup: true });
      const observeAuth = (page, result, name) => {
        page.on('pageerror', error => result.pageErrors.push({ check: name, message: error.message }));
        page.on('console', entry => {
          if (entry.type() !== 'error') return;
          const row = { check: name, message: entry.text() };
          if (outcome === 'session_not_found' && entry.location().url === cloud + '/auth/v1/user' && /^Failed to load resource:.*status of 401/.test(entry.text())) result.expectedAuthConsole.push(row);
          else result.consoleErrors.push(row);
        });
      };
      const page = await app(context, 'late-auth-' + outcome, observeAuth), held = gate();
      const tokenA = await page.evaluate(async () => (await HaedoAuth.client.auth.getSession()).data.session.access_token);
      let heldOnce = false;
      await context.route(cloud + '/auth/v1/user', async route => {
        if (heldOnce || route.request().headers().authorization !== 'Bearer ' + tokenA) return route.fallback();
        heldOnce = true; held.enter(); await held.released;
        // The bundled SDK reads modern body.code only with this wire version;
        // without it this would be an ordinary AuthApiError, hiding SIGNED_OUT.
        await route.fulfill({ status: outcome === 'success' ? 200 : 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'X-Supabase-Api-Version', 'x-supabase-api-version': '2024-01-01' },
          body: JSON.stringify(outcome === 'success' ? session(accounts.a).user : { code: 'session_not_found', message: 'Synthetic old session no longer exists' }) });
        held.finish();
      });
      page.on('response', response => {
        if (response.url() === cloud + '/auth/v1/user' && response.status() === 401) report.expectedAuthTransport.push({ check: outcome, status: 401, method: response.request().method(), apiVersion: response.headers()['x-supabase-api-version'] });
      });
      try {
        await page.evaluate(() => {
          window.__rssAuthWork = { done: false };
          __rssReflectors.at(-1).instance.syncNow().finally(() => { __rssAuthWork.done = true; }).catch(() => {});
        });
        await arrived(held);
        await page.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.b));
        await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id);
        await ready(page); await nav(page, 'records'); await settle(page);
        const sharedKey = await page.evaluate(() => HaedoAuth.client.auth.storageKey);
        const watcherUrl = base + '/_qa_rss_auth_watch.html';
        await context.route(watcherUrl, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic Auth broadcast observer</title>' }));
        const watcher = await context.newPage(); await watcher.goto(watcherUrl);
        await watcher.evaluate(key => {
          window.__rssAuthBroadcasts = []; window.__rssAuthChannel = new BroadcastChannel(key);
          __rssAuthChannel.onmessage = event => __rssAuthBroadcasts.push({ event: event.data?.event || null });
        }, sharedKey);
        await page.bringToFront(); await settle(page);
        await page.locator('#lifeSearch').fill('B 계정 입력 보존'); await page.locator('#lifeSearch').focus();
        const before = await sources(page), ack = await progress(page);
        await page.evaluate(async () => {
          window.__rssAuthBoundary = { child: document.querySelector('#lifeApp').firstElementChild, storage: HaedoLife.Shell.storage,
            input: document.querySelector('#lifeSearch'), token: (await HaedoAuth.client.auth.getSession()).data.session.access_token,
            storedSession: localStorage.getItem(HaedoAuth.client.auth.storageKey), notifications: 0, signedOut: 0 };
          __rssAuthBoundary.unlisten = HaedoAuth.onAccountChange(() => { __rssAuthBoundary.notifications++; });
          __rssAuthBoundary.subscription = HaedoAuth.client.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') __rssAuthBoundary.signedOut++; }).data.subscription;
        });
        held.release(); await held.finished;
        await until(page, () => __rssAuthWork.done, 'late automatic verification settles'); await settle(page);
        const sdkResults = await page.evaluate(owner => (__rssSdkResults || []).filter(row => row.owner === owner), accounts.a.id);
        assert.deepEqual(sdkResults, [{ owner: accounts.a.id, errorName: outcome === 'success' ? null : 'AuthSessionMissingError', sessionMissing: outcome !== 'success' }], 'the real bundled SDK must exercise the intended missing-session class');
        const after = await page.evaluate(async () => {
          const b = __rssAuthBoundary, current = (await HaedoAuth.client.auth.getSession()).data.session;
          const result = { owner: HaedoAuth.user?.id || null, sessionOwner: current?.user?.id || null, tokenPreserved: current?.access_token === b.token,
            storedSessionPreserved: localStorage.getItem(HaedoAuth.client.auth.storageKey) === b.storedSession,
            sameChild: document.querySelector('#lifeApp').firstElementChild === b.child, sameStorage: HaedoLife.Shell.storage === b.storage,
            sameInput: document.querySelector('#lifeSearch') === b.input, input: b.input.value, focused: document.activeElement === b.input,
            notifications: b.notifications, signedOut: b.signedOut, hidden: document.querySelector('#lifeApp').hidden };
          b.unlisten(); b.subscription.unsubscribe(); return result;
        });
        assert.deepEqual(after, { owner: accounts.b.id, sessionOwner: accounts.b.id, tokenPreserved: true, storedSessionPreserved: true, sameChild: true, sameStorage: true,
          sameInput: true, input: 'B 계정 입력 보존', focused: true, notifications: 0, signedOut: 0, hidden: false });
        assert.deepEqual(await watcher.evaluate(() => __rssAuthBroadcasts), [], 'late verification never broadcasts on the shared Auth channel');
        assert.deepEqual(await sources(page), before); assert.deepEqual(await progress(page), ack);
        assert.equal(server.calls.length, 0, 'cancelled old-owner verification never reaches the inbox request');
        report.evidence.push({ name: 'late-auth-' + outcome, sdkResults, sharedBroadcasts: 0, ...after });
        if (outcome === 'session_not_found') {
          assert.deepEqual(report.expectedAuthTransport, [{ check: outcome, status: 401, method: 'GET', apiVersion: '2024-01-01' }]);
          assert.equal(report.expectedAuthConsole.length, 1, 'only the exact held Auth 401 is expected');
        }
      } finally { held.release(); }
    }, { count: 0 });

    await check('two connections committing in reverse fetched order both arrive exactly once within the lease overlap', async ({ server, device }) => {
      const page = await app(await device('reverse-commit', { holdStartup: true }), 'reverse committed connections');
      const workspaceId = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      server.seeded.add(accounts.a.id);
      const later = server.connection(workspaceId, accounts.a.id, 'active');
      const earlier = { ...clone(later), id: 'cccccccc-cccc-4ccc-8ccc-000000000002', feed_url: 'https://feed.example.invalid/earlier.xml' };
      server.extraConnections.push({ owner: accounts.a.id, connection: earlier });
      const y = server.add(accounts.a.id, later, 1); y.fetched_at = '2026-11-05T06:03:00.000Z';
      await startHeld(page); await completed(page, 1); await archive(page, [y]);
      const firstAck = await progress(page), firstCalls = server.calls.length;
      const x = server.add(accounts.a.id, earlier, 2); x.fetched_at = '2026-11-05T06:01:00.000Z';
      await page.evaluate(() => __rssReflectors.at(-1).instance.syncNow()); await completed(page, 2, 'idle', 2);
      await archive(page, [x, y]); const ack = await progress(page);
      assert.deepEqual(ack.cursor, firstAck.cursor, 'a late visible row must not lose the already proven high-water cursor');
      assert.deepEqual(ack.receipts.map(row => row.itemId), [x.id, y.id]);
      assert.deepEqual(await page.evaluate(() => __rssReceiveVisits.map(row => row.itemId)), [y.id, x.id], 'only the newly visible item reaches material receipt');
      exactScan(server.calls.slice(firstCalls), [x, y], { fetched_at: '2026-11-05T06:00:59.999Z', id: '00000000-0000-0000-0000-000000000000' }, 1);
      const stable = await sources(page), repeated = server.calls.length;
      await page.evaluate(() => __rssReflectors.at(-1).instance.syncNow());
      assert.deepEqual(await sources(page), stable); assert.deepEqual(await progress(page), ack);
      assert.equal(await page.evaluate(() => __rssReceiveVisits.length), 2);
      exactScan(server.calls.slice(repeated), [x, y], overlap(ack.cursor), 1);
      report.evidence.push({ name: 'reverse-commit', connections: 2, rows: 2, newReceipts: 2, duplicateReceipts: 0, overlapMilliseconds: 120001 });
    }, { count: 0, pageSize: 1 });

    await check('a multi-page inbox preserves 48 exact large bodies and current input while warm overlap receives no duplicate', async ({ server, device }) => {
      const page = await app(await device('large-inbox', { holdStartup: true }), 'large inbox');
      const workspaceId = await page.evaluate(() => HaedoLife.Shell.storage.getActive()); server.seed(accounts.a.id, workspaceId);
      for (const row of server.items) { row.content_text += '\r\n' + 'x'.repeat(14 * 1024); row.content_hash = hash(row.content_text); }
      await nav(page, 'records'); await page.locator('#lifeSearch').fill('이어 쓸 검색'); await page.locator('#lifeSearch').focus();
      const firstStarted = performance.now(); await page.evaluate(() => __rssReflectors.at(-1).instance.syncNow());
      const firstMilliseconds = performance.now() - firstStarted;
      await completed(page, 48); const before = await archive(page, server.items), ack = await progress(page);
      assert.equal(server.calls.length, 3); assert.equal(await page.evaluate(() => __rssReceiveVisits.length), 48);
      const warmStarted = performance.now(); await page.evaluate(() => __rssReflectors.at(-1).instance.syncNow());
      const warmMilliseconds = performance.now() - warmStarted;
      await completed(page, 48, 'idle', 2); assert.deepEqual(await archive(page, server.items), before); assert.deepEqual(await progress(page), ack);
      assert.equal(await page.evaluate(() => __rssReceiveVisits.length), 48); assert.equal(server.calls.length, 6);
      exactScan(server.calls.slice(3), server.items, overlap(ack.cursor), 16);
      assert.equal(await page.locator('#lifeSearch').inputValue(), '이어 쓸 검색');
      assert.equal(await page.locator('#lifeSearch').evaluate(node => node === document.activeElement), true);
      report.evidence.push({ name: 'large-inbox', items: 48, minimumBodyBytes: 14 * 1024, pagesPerCycle: 3, duplicateReceipts: 0, firstMilliseconds, warmMilliseconds,
        scope: 'Actual Chromium app/IndexedDB and synthetic HTTP; descriptive timing only, separate from the large storage benchmark.' });
    }, { count: 48, pageSize: 16 });

    for (const width of [1440, 390]) await check('permanent inbox rejection keeps input, explains the blocked item and recovers on actual reload ' + width, async ({ server, device }) => {
      const context = await device('blocked-' + width, { viewport: { width, height: 1000 } });
      const page = await app(context, 'blocked-' + width, observe, value => value.clock.install());
      await completed(page, 1);
      const bad = server.items[0], originalText = bad.content_text;
      bad.title = '확인이 필요한 합성 자료 <img src=x>'; bad.content_text += '\r\n이미 보관한 불변 판과 다른 합성 본문'; bad.content_hash = hash(bad.content_text);
      server.add(accounts.a.id, server.connections.get(accounts.a.id), 2);
      await nav(page, 'records'); await page.locator('#lifeSearch').fill('오류 중에도 이어 쓸 검색'); await page.locator('#lifeSearch').focus();
      await page.evaluate(() => { window.__rssBlockedInput = document.querySelector('#lifeSearch'); window.__rssBlockedMain = document.querySelector('#lifeMain'); });
      const before = await sources(page); await tick(page);
      await until(page, () => __rssReflectors.at(-1).instance.getStatus().state === 'blocked', 'permanent item blocks the automatic consumer');
      const notice = page.locator('#rssReflectionError'); await notice.waitFor();
      const text = await notice.innerText(); assert(text.includes(bad.title)); assert(!text.includes(bad.id)); assert(!text.includes(bad.content_text));
      assert.equal(await notice.locator('img,script').count(), 0, 'the feed title is rendered as text');
      assert.deepEqual(await sources(page), before); assert.equal((await progress(page)).receipts.length, 0, 'later items cannot bypass a rejected prefix');
      assert.deepEqual(await page.evaluate(() => ({ sameInput: document.querySelector('#lifeSearch') === __rssBlockedInput,
        sameMain: document.querySelector('#lifeMain') === __rssBlockedMain, input: __rssBlockedInput.value, focused: document.activeElement === __rssBlockedInput })),
      { sameInput: true, sameMain: true, input: '오류 중에도 이어 쓸 검색', focused: true });
      assert.equal(server.calls.length, 2); await tick(page); assert.equal(server.calls.length, 2, 'a permanent error does not poll again');
      const bounds = await notice.evaluate(node => ({ width: node.getBoundingClientRect().width, horizontalOverflow: document.documentElement.scrollWidth > innerWidth }));
      assert.equal(bounds.horizontalOverflow, false);
      const file = 'blocked-inbox-' + width + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: false }); report.visual.push({ width, file, ...bounds });
      bad.content_text = originalText; bad.content_hash = hash(bad.content_text);
      // The corrected server fixture is consumed by an actual app reload, not by
      // calling a manager method and labelling that a UI retry.
      await page.reload(); await ready(page); await completed(page, 2); await archive(page, server.items);
      assert.equal(await notice.count(), 0); assert.equal(server.calls.length, 3);
      const recovered = 'recovered-inbox-' + width + '.png'; await page.screenshot({ path: path.join(output, recovered), fullPage: false }); report.visual.push({ width, file: recovered });
      const third = server.add(accounts.a.id, server.connections.get(accounts.a.id), 3); third.content_hash = 'e'.repeat(64);
      await tick(page); await until(page, () => __rssReflectors.at(-1).instance.getStatus().state === 'blocked', 'later permanent item blocks again'); await notice.waitFor();
      assert(!(await notice.innerText()).includes(third.title), 'a malformed snapshot must not expose an unvalidated title');
      await page.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.b));
      await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id);
      await ready(page); await completed(page, 1); assert.equal(await notice.count(), 0, 'old account warning is removed when its shell is aborted');
      await archive(page, server.items.filter(row => row.owner_id === accounts.b.id));
      report.evidence.push({ name: 'blocked-inbox', width, inputPreserved: true, exactPrefixStopped: true, safeTitleOnly: true, realReloadRecovery: true, oldAccountNoticeRemoved: true });
    }, { count: 1 });

    await check('manual more cannot advance a prefix past an unseen earlier item', async ({ server, device }) => {
      const page = await app(await device('more', { holdStartup: true }), 'manual pagination');
      const workspaceId = await page.evaluate(() => HaedoLife.Shell.storage.getActive()); server.seed(accounts.a.id, workspaceId);
      await page.evaluate(async before => {
        const s = HaedoLife.Shell.storage, service = HaedoLife.RssConnection.create({ storage: s, workspaceId: await s.getActive() });
        try { await service.more(before); } finally { service.dispose(); }
      }, cursor(server.items[0]));
      await archive(page, server.items.slice(1, 3));
      assert.equal((await progress(page)).cursor, null, 'manual pagination never advances the automatic inbox cursor');
      assert.deepEqual((await progress(page)).receipts, [], 'manual pagination never claims a proven automatic prefix');
      await startHeld(page);
      await until(page, () => __rssReflectors.at(-1).instance.getStatus().state === 'idle' && __rssReflectors.at(-1).instance.getStatus().checkedItems > 0, 'automatic prefix after manual more');
      await archive(page, server.items); assert.equal((await progress(page)).receipts.length, 5);
    }, { count: 5 });

    await check('restored exact-source gap invalidates the durable ACK before reflection resumes', async ({ server, device }) => {
      const context = await device('restore'); let page = await app(context, 'before restore'); await completed(page, 5); await archive(page, server.items);
      const missing = server.items[2];
      await page.evaluate(async itemId => {
        __rssReflectors.at(-1).instance.dispose();
        const s = HaedoLife.Shell.storage, workspaceId = await s.getActive(), bundle = await s.read(workspaceId);
        const version = bundle.sourceVersions.find(row => row.id === 'rssv_' + itemId), sourceId = version.sourceId;
        bundle.sourceVersions = bundle.sourceVersions.filter(row => row.sourceId !== sourceId); bundle.sources = bundle.sources.filter(row => row.id !== sourceId); bundle.revision++;
        HaedoLife.Core.validateWorkspace(bundle);
        // Install a validated earlier source snapshot into actual device IDB.
        // This isolates ACK invalidation from the separately tested backup UI.
        await new Promise((resolve, reject) => { const request = indexedDB.open('life-tools-v1'); request.onerror = () => reject(request.error); request.onsuccess = () => {
          const db = request.result, tx = db.transaction(['bundles'], 'readwrite'); tx.objectStore('bundles').put(bundle);
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
        }; });
      }, missing.id);
      const previousCalls = server.calls.length; await page.close(); page = await app(context, 'after restore');
      await until(page, () => globalThis.__rssReflectionCycles?.length >= 1, 'restored application reflection completes');
      await archive(page, server.items); assert.equal((await progress(page)).receipts.length, 5);
      assert.deepEqual(server.calls[previousCalls].body.before, overlap(cursor(server.items[1])), 'restart overlaps the last proven prefix before the missing original');
    }, { count: 5 });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
    assert.deepEqual(report.consoleWarnings.filter(row => /Multiple GoTrueClient|Multiple.*(?:Auth|GoTrue).*instances/i.test(row.message)), [], 'isolated verification must not create duplicate SDK client warnings');
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ passed: report.checks.filter(row => row.pass).length, total: report.checks.length, realFeeds: report.externalRequests.length, expected404: report.expectedTransport.length, expectedNative404: report.expectedConsoleErrors.length }));
  if (report.checks.some(row => !row.pass) || report.consoleErrors.length || report.pageErrors.length || report.externalRequests.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
