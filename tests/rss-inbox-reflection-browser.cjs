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
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const output = path.resolve(process.env.RSS_REFLECTION_OUTPUT || '.local/rss-reflection/browser');
const report = { checks: [], consoleErrors: [], expectedConsoleErrors: [], expectedTransport: [], pageErrors: [], externalRequests: [], evidence: [] };
const clone = value => structuredClone(value);
const cursor = row => ({ fetched_at: row.fetched_at, id: row.id });
const order = (a, b) => a.fetched_at.localeCompare(b.fetched_at) || a.id.localeCompare(b.id);

// The SQL wire contract is ascending and strictly greater than `before`.
// Keep that historical field name and page boundaries, including empty tails.
class ReflectionCloud extends RssCloud {
  constructor({ count = 1, configured = true, pageSize = 2, accountLibrary = false, httpStatus = 200 } = {}) {
    super(); this.configured = configured; this.initialCount = count; this.pageSize = pageSize; this.httpStatus = httpStatus;
    this.seeded = new Set(); this.listResponses = []; this.holdOwner = null;
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
    for (let number = 1; number <= this.initialCount; number++) this.add(owner, conn, number);
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
    const response = await route.fetch(); let source = await response.text();
    source = replaceOnce(source, 'async function receive(context, row) {', "async function receive(context, row) { (root.__rssReceiveVisits ||= []).push({ owner: owner.userId, itemId: row.id });");
    source = replaceOnce(source, "status = { state: stopped ? 'stopped' : receiveError ? 'error' : 'idle', checkedItems, receiveError };", "status = { state: stopped ? 'stopped' : receiveError ? 'error' : 'idle', checkedItems, receiveError }; (root.__rssReflectionCycles ||= []).push({ owner: owner.userId, ...status });");
    if (process.env.RSS_REFLECTION_MUTATION === 'ignore-ack') source = replaceOnce(source,
      'const progress = await step(context, () => storage.readRssInboxProgress(workspaceId));',
      'const progress = await step(context, () => storage.readRssInboxProgress(workspaceId)); if (pages === 0) { progress.cursor = null; progress.receipts = []; }');
    if (process.env.RSS_REFLECTION_MUTATION === 'more-ahead') source = replaceOnce(source,
      "return run('list', { before: { fetched_at: before.fetched_at, id: before.id } }, onProgress);",
      "return run('list', { before: { fetched_at: before.fetched_at, id: before.id } }, onProgress).then(async page => { const progress = await storage.readRssInboxProgress(workspaceId), bundle = await storage.read(workspaceId); const receipts = page.items.filter(row => row.sourceVersionId).map(row => ({ kind: 'stored', cursor: { fetched_at: row.fetched_at, id: row.id }, itemId: row.id, sourceId: row.sourceId, sourceVersionId: row.sourceVersionId, contentHash: row.content_hash })); await storage.saveRssInboxProgress(workspaceId, { cursor: receipts.at(-1)?.cursor || null, receipts }, progress.revision, { expectedBundleRevision: bundle.revision }); return page; });");
    source += `\n;(()=>{if(globalThis.__rssCaptureInstalled)return;globalThis.__rssCaptureInstalled=true;const api=HaedoLife.RssConnection;HaedoLife.RssConnection=Object.freeze({...api,createReflection(options){const instance=api.createReflection(options);(globalThis.__rssReflectors||=[]).push({owner:options.storage.account.userId,instance});return ${holdStartup ? 'Object.freeze({...instance,start(){}})' : 'instance'};}});})();`;
    await route.fulfill({ response, body: source });
  });
  if (process.env.RSS_REFLECTION_MUTATION === 'skip-restore-validation') await context.route('**/assets/life/storage.js', async route => {
    const response = await route.fetch(), source = await response.text();
    await route.fulfill({ response, body: replaceOnce(source, 'receipts = rssValidPrefix(bundle, raw.receipts, await rssBodyProofs(bundle, raw.receipts));', 'receipts = raw.receipts;') });
  });
  await context.route('https://feed.example.invalid/**', route => { report.externalRequests.push(route.request().url()); return route.abort(); });
}
async function app(context, name) {
  const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
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

async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, options = {}) {
    if (process.env.RSS_REFLECTION_MATCH && !new RegExp(process.env.RSS_REFLECTION_MATCH).test(name)) return;
    const server = new ReflectionCloud(options), contexts = [];
    async function device(label, setup = {}) {
      const context = await makeContext(browser, server, label, setup.account || accounts.a);
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

    await check('restart uses persistent ACK and requests no previously reflected page or item', async ({ server, device }) => {
      const context = await device('restart'); let page = await app(context, 'initial application'); await completed(page, 5);
      const before = await archive(page, server.items), ack = await progress(page);
      assert.equal(server.calls.length, 3); await page.close(); const count = server.calls.length;
      page = await app(context, 'fresh JavaScript application');
      // Wait for the real idle-start request before examining a zero-item result.
      await until(page, () => globalThis.__rssReflectionCycles?.length >= 1, 'restarted reflection completes');
      await page.evaluate(() => __rssReflectors.at(-1).instance.syncNow());
      assert.equal(server.calls.length - count, 2, 'startup and an explicit repeat each request only the empty tail, never old pages');
      assert.equal(await page.evaluate(() => (globalThis.__rssReceiveVisits || []).length), 0, 'restart never revisits an acknowledged item');
      assert.deepEqual(await archive(page, server.items), before); assert.deepEqual(await progress(page), ack);
      assert.ok(server.calls.slice(count).every(call => call.body.before?.id === server.items.at(-1).id));
      report.evidence.push({ name: 'restart', initialPages: count, restartAndRepeatPages: server.calls.length - count, repeatedItems: 0 });
    }, { count: 5 });

    await check('periodic reflection receives only a new exact version with RSS UI closed', async ({ server, device }) => {
      const context = await device('periodic'), page = await context.newPage(); observe(page, report, 'periodic');
      await page.clock.install(); await page.goto(base + '/index.html'); await ready(page); await settle(page); await completed(page, 1);
      const conn = server.connections.get(accounts.a.id); server.add(accounts.a.id, conn, 2);
      await tick(page); await completed(page, 1, 'idle', 2); await archive(page, server.items);
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
      await page.waitForFunction(() => !document.getElementById('lifeApp').hidden); await completed(page, 0, 'idle', 2);
      server.add(accounts.a.id, server.connections.get(accounts.a.id), 2);
      await tick(page); await completed(page, 1, 'idle', 3); await archive(page, server.items);
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
      await tick(page); await page.evaluate(() => { dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); }); await settle(page);
      assert.equal(server.calls.length, 1, 'no repeated list after empty/disabled discovery, even on wake events');
      if (configured) {
        await page.evaluate(async feed => {
          const s = HaedoLife.Shell.storage, service = HaedoLife.RssConnection.create({ storage: s, workspaceId: await s.getActive() });
          try { await service.register(feed); } finally { service.dispose(); }
        }, FEED);
        await completed(page, 0, 'idle', 2);
        assert.equal(server.calls.filter(call => call.body.action === 'register').length, 1);
        assert.equal(server.calls.filter(call => call.body.action === 'list').length, 2, 'the actual registration event resumes the stopped consumer');
      }
    }, { count: configured ? 0 : 1, configured });

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

    await check('manual more cannot advance a prefix past an unseen earlier item', async ({ server, device }) => {
      const page = await app(await device('more', { holdStartup: true }), 'manual pagination');
      const workspaceId = await page.evaluate(() => HaedoLife.Shell.storage.getActive()); server.seed(accounts.a.id, workspaceId);
      await page.evaluate(async before => {
        const s = HaedoLife.Shell.storage, service = HaedoLife.RssConnection.create({ storage: s, workspaceId: await s.getActive() });
        try { await service.more(before); } finally { service.dispose(); }
      }, cursor(server.items[0]));
      await archive(page, server.items.slice(1, 3));
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
      assert.equal(server.calls[previousCalls].body.before.id, server.items[1].id, 'restart resumes at the last proven prefix before the missing original');
    }, { count: 5 });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ passed: report.checks.filter(row => row.pass).length, total: report.checks.length, realFeeds: report.externalRequests.length, expected404: report.expectedTransport.length, expectedNative404: report.expectedConsoleErrors.length }));
  if (report.checks.some(row => !row.pass) || report.consoleErrors.length || report.pageErrors.length || report.externalRequests.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
