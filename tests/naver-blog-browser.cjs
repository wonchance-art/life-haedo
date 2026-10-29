/* Naver subscription UI: actual app, bundled SDK and IndexedDB, synthetic owner
 * API HTTP only. This never fetches Naver or proves deployed SQL/cron access.
 * BASE_URL=<local dev server> PW_MODULE_PATH=<installed Playwright> node this-file
 */
'use strict';
const { openRecordsMenu } = require('./helpers/feature-menus.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const { seed, preserved } = require('./account-materials-browser.cjs');
const { databaseSnapshot } = require('./local-post-finder-browser.cjs');
const output = path.resolve('.local/naver-blog');
const blogId = 'example_haedo';
const postUrl = id => 'https://blog.naver.com/' + blogId + '/' + id;
const raw = '\ufeff정확히 보존할 합성 원문🌱\r\n다음 줄과 옛 구절';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => structuredClone(value);
function gate() {
  let entered, release;
  return { entered: new Promise(resolve => { entered = resolve; }), released: new Promise(resolve => { release = resolve; }), enter: () => entered(), release: () => release() };
}
async function arrived(hold) {
  let timer;
  try { await Promise.race([hold.entered, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Expected synthetic API request did not arrive within 20000ms')), 20000); })]); }
  finally { clearTimeout(timer); }
}
// Keep storage reads outside waitForFunction: its predicate must be synchronous.
async function until(page, action, description, argument) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { const value = await page.evaluate(action, argument); if (value) return value; await page.waitForTimeout(40); }
  throw Error('Timed out waiting for ' + description);
}
async function enter(page) {
  await page.goto(base + '/index.html?section=tools&view=naver-blog');
  await ready(page); await settle(page);
}
async function existingNaver(page) {
  return page.evaluate(async ({ blogId, raw }) => {
    const C = HaedoLife.Core, s = HaedoLife.Shell.storage, ws = await s.getActive();
    let bundle = await s.read(ws); const refs = {};
    for (const [id, coverage, url, text] of [
      ['100001', 'full_text', 'https://m.blog.naver.com/' + blogId + '/100001', raw],
      ['100002', 'partial', 'https://blog.naver.com/PostView.naver?blogId=' + blogId + '&logNo=100002', '앞부분만 보관한 합성 원문']
    ]) {
      const p = await C.prepareImport({ origin: 'naver_blog', title: '기존 합성 원문 ' + id, text, url, coverage }, bundle);
      const end = text.indexOf('합성') + 2;
      const excerpts = [{ start: 0, end, topic: '보존할 옛 인용', note: '구독으로 바뀌지 않는 개인 메모' }];
      const result = await s.commitLocal({ workspaceId: ws, baseRevision: bundle.revision, operationId: C.id(), changes: C.buildImportChanges(bundle, p, excerpts) });
      if (result.status !== 'stored') throw Error('Synthetic Naver seed failed');
      refs[id] = { sourceId: p.source.id, versionId: p.version.id, contentHash: p.version.contentHash };
      bundle = await s.read(ws);
    }
    return { workspaceId: ws, refs, bundle };
  }, { blogId, raw });
}
async function sources(page) {
  return page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.read(await s.getActive()); });
}
function item(logNo, overrides = {}) {
  const text = '피드에서 확보한 합성 본문 ' + logNo + '\r\n🌱 정확한 다음 줄';
  return { id: 'dddddddd-dddd-4ddd-8ddd-' + logNo.padStart(12, '0'), blog_id: blogId, log_no: logNo,
    title: '합성 수집 글 ' + logNo, url: postUrl(logNo), content_text: text, content_hash: sha(text),
    published_at: '2026-01-01T01:00:00.000Z', fetched_at: '2026-01-02T01:00:00.000Z', coverage: 'partial', ...overrides };
}

class NaverCloud extends FakeCloud {
  constructor() { super(); this.naverCalls = []; this.subscriptions = new Map(); this.items = []; this.accountInventories = new Map(); this.collectionReady = false; this.holdList = null; this.failList = false; this.failCheck = false; this.failSave = false; this.expectedHttpErrors = 0; }
  subscription(workspaceId, owner = accounts.a.id, enabled = false) {
    const row = { id: 'cccccccc-cccc-4ccc-8ccc-' + String(this.subscriptions.size + 1).padStart(12, '0'), workspace_id: workspaceId, blog_id: blogId,
      enabled, revision: 1, last_checked_at: null, last_success_at: null, last_error: null, next_check_at: null };
    this.subscriptions.set(owner + ':' + workspaceId, row); return row;
  }
  inbox(subscription, logs = ['100001', '100002', '100003'], owner = accounts.a.id) {
    this.items = logs.map(id => ({ ...item(id), owner_id: owner, subscription_id: subscription.id }));
  }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url());
    const advanced = ['life_naver_account_list', 'life_naver_inventory_list', 'life_naver_capture_list'];
    const advancedName = url.pathname.split('/').at(-1);
    if (advanced.includes(advancedName)) {
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
      assert.equal(request.method(), 'POST'); const owner = this.owner(request), body = request.postDataJSON();
      assert.ok(Object.values(accounts).some(account => account.id === owner));
      this.naverCalls.push({ rpc: advancedName, owner, device, body: copy(body) });
      const rows = [...this.subscriptions.entries()].filter(([key]) => key.startsWith(owner + ':')).map(([, row]) => copy(row));
      if (advancedName !== 'life_naver_account_list') assert.ok(rows.some(row => row.id === body.p_subscription_id), 'Advanced reads remain owner scoped');
      const data = advancedName === 'life_naver_account_list' ? { subscriptions: rows.map(row => ({ ...row, inventory: copy(this.accountInventories.get(row.id) || null) })), ready: this.collectionReady, hasMore: false, nextCursor: null } :
        advancedName === 'life_naver_inventory_list' ? { inventory: null, items: [], hasMore: false, nextCursor: null } : { captures: [], jobs: [], hasMore: false, nextCursor: null };
      return route.fulfill({ status: 200, headers, body: JSON.stringify(data) });
    }
    if (!['/rest/v1/rpc/life_naver_list', '/rest/v1/rpc/life_naver_save', '/functions/v1/haedo-naver-blog'].includes(url.pathname)) return super.handle(route, device);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store' };
    const send = async (body, status = 200) => {
      try { return await route.fulfill({ status, headers, body: JSON.stringify(body) }); }
      catch (error) { if (!/closed|disposed|handled|Target page/i.test(error.message)) throw error; }
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    assert.equal(request.method(), 'POST');
    const owner = this.owner(request); assert.ok(Object.values(accounts).some(a => a.id === owner), 'Naver API requires a synthetic authenticated owner');
    const body = request.postDataJSON(), rpc = url.pathname.split('/').at(-1);
    this.naverCalls.push({ rpc, owner, device, body: copy(body) });
    if (rpc === 'life_naver_list') {
      assert.equal(body.p_limit, 100); assert.equal(body.p_before, null);
      if (this.failList) { this.failList = false; this.expectedHttpErrors++; return send({ code: 'XX000', message: 'Synthetic list failure' }, 503); }
      const sub = this.subscriptions.get(owner + ':' + body.p_workspace_id);
      const result = { ready: this.collectionReady, subscriptions: sub ? [copy(sub)] : [],
        items: sub ? copy(this.items.filter(item => item.owner_id === owner && item.subscription_id === sub.id)) : [], has_more: false, next_cursor: null };
      if (this.holdList) { const hold = this.holdList; this.holdList = null; hold.enter(); await hold.released; }
      return send(result);
    }
    if (rpc === 'life_naver_save') {
      const key = owner + ':' + body.p_workspace_id, old = this.subscriptions.get(key);
      assert.equal(body.p_blog_id, blogId, 'Only the anonymous fixture blog may be registered');
      assert.equal(body.p_expected_revision, old?.revision || 0);
      if (!this.collectionReady) assert.equal(body.p_enabled, false);
      if (this.failSave) { this.expectedHttpErrors++; return send({ code: 'XX000', message: 'Synthetic connection save failure' }, 503); }
      const row = old ? { ...old, enabled: body.p_enabled, revision: old.revision + 1 } : this.subscription(body.p_workspace_id, owner, body.p_enabled);
      this.subscriptions.set(key, row); return send(copy(row));
    }
    assert.deepEqual(Object.keys(body), ['subscriptionId']);
    assert.ok([...this.subscriptions.entries()].some(([key, row]) => key.startsWith(owner + ':') && row.id === body.subscriptionId));
    if (!this.collectionReady) return send({ error: 'setup_required' });
    if (this.failCheck) { this.expectedHttpErrors++; return send({ error: 'upstream_failed' }, 503); }
    return send({ status: 'checked' });
  }
}

async function idle(page, state) {
  await page.waitForFunction(expected => {
    const surface = document.querySelector('#lifeNaverBlog'), status = document.querySelector('#naverBlogStatus');
    return surface && surface.getAttribute('aria-busy') !== 'true' && status && (!expected || status.dataset.state === expected);
  }, state);
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const rootDir = path.resolve(__dirname, '..');
  const files = ['assets/life/naver-blog.js', 'assets/life/naver-blog-sync.js', 'assets/life/naver-blog-ui.js', 'assets/life/naver-blog.css', 'assets/life/ui.js', 'assets/life/storage.js', 'assets/platform-auth.js', 'sw.js'];
  async function hashes() {
    const result = {};
    for (const file of files) {
      const disk = sha(await fs.readFile(path.join(rootDir, file))), response = await fetch(base + '/' + file);
      assert.equal(response.status, 200); const served = sha(Buffer.from(await response.arrayBuffer())); assert.equal(served, disk, 'HTTP and disk must match: ' + file); result[file] = disk;
    }
    return result;
  }
  const startHashes = await hashes();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const report = { scope: 'Actual application, bundled Supabase SDK and IndexedDB; synthetic authenticated owner API HTTP. No live Naver fetch, deployed SQL/RLS, server collector or cron installation proof. Local automatic receipt requires an open app.', checks: [], visual: [], consoleErrors: [], expectedConsoleErrors: [], pageErrors: [], externalRequests: [], sourceHashes: startHashes, browser: browser.version() };
  async function check(name, action) {
    if (process.env.NAVER_BLOG_MATCH && !new RegExp(process.env.NAVER_BLOG_MATCH).test(name)) return;
    const server = new NaverCloud(), context = await makeContext(browser, server, 'naver-' + report.checks.length, accounts.a, { viewport: { width: 1440, height: 1000 } });
    // Observe completion of the real service, including a departed view's work.
    // No transport/model/storage result is replaced or forced by this spy.
    await context.addInitScript(() => {
      window.__naverActiveLists = 0; window.__naverObservedLists = 0;
      const life = window.HaedoLife ||= {};
      Object.defineProperty(life, 'NaverBlogSync', { configurable: true, set(api) {
        Object.defineProperty(life, 'NaverBlogSync', { configurable: true, writable: true, value: { ...api, create(options) {
          const service = api.create(options);
          return Object.freeze({ ...service, async list(...args) {
            window.__naverObservedLists++; window.__naverActiveLists++;
            try { return await service.list(...args); } finally { window.__naverActiveLists--; }
          } });
        } } });
      } });
    });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    const pending = new Map(), requestFailures = [];
    page.on('request', request => pending.set(request, { path: new URL(request.url()).pathname, method: request.method() }));
    page.on('requestfinished', request => pending.delete(request));
    page.on('requestfailed', request => { requestFailures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }); pending.delete(request); });
    page.on('pageerror', e => report.pageErrors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') (/Failed to load resource.*503/.test(e.text()) && server.expectedHttpErrors ? report.expectedConsoleErrors : report.consoleErrors).push(e.text()); });
    await context.route('**/*', route => {
      const origin = new URL(route.request().url()).origin;
      if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
      report.externalRequests.push(origin); return route.abort();
    });
    console.log('START ' + name);
    try {
      await page.goto(base + '/index.html'); await ready(page); const seeded = await seed(page);
      const original = await preserved(page, seeded);
      assert.equal(original.doc.photos[0].blob, seeded.original.digest); assert.equal(seeded.original.width, 4032); assert.equal(seeded.original.height, 3024);
      await action({ page, context, server, seeded });
      assert.equal(server.writes().length, 0, 'Naver import must not transmit the private workspace');
      const blogWrites = server.blogCalls.filter(call => !['life_blog_list', 'life_blog_read'].includes(call.rpc)).length;
      assert.equal(blogWrites, 0, 'Naver import must not write or publish personal posts');
      report.checks.push({ name, pass: true, original: seeded.original, calls: server.naverCalls.map(call => ({ rpc: call.rpc, owner: call.owner, workspaceId: call.body.p_workspace_id, enabled: call.body.p_enabled })), workspaceWrites: server.writes().length, blogWrites });
      console.log('PASS ' + name);
    } catch (error) {
      const surface = await page.evaluate(() => ({ readyState: document.readyState, appHidden: document.querySelector('#lifeApp')?.hidden,
        core: !!window.HaedoLife?.Core, shell: !!window.HaedoLife?.Shell, naver: !!window.HaedoLife?.NaverBlogUI,
        status: document.querySelector('#naverBlogStatus')?.dataset.state })).catch(() => null);
      report.checks.push({ name, pass: false, error: error.stack, surface, pendingRequests: [...pending.values()], requestFailures });
      await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); throw error;
    } finally { await context.close(); }
  }
  try {
    await check('ID and URL preview register a disabled server connection honestly while collection is not configured', async ({ page, server, seeded }) => {
      const before = await preserved(page, seeded); await enter(page); await idle(page, 'setup-required');
      await page.locator('#naverBlogId').fill(blogId);
      assert.equal(await page.locator('#naverBlogPreview').textContent(), 'https://blog.naver.com/' + blogId);
      await page.locator('#naverBlogId').fill('https://blog.naver.com.evil.invalid/' + blogId);
      assert.equal(await page.locator('#naverBlogSave').isDisabled(), true); assert.equal(server.naverCalls.filter(c => c.rpc === 'life_naver_save').length, 0);
      await page.locator('#naverBlogId').fill('https://m.blog.naver.com/' + blogId + '/100001');
      assert.equal(await page.locator('#naverBlogPreview').textContent(), 'https://blog.naver.com/' + blogId);
      assert.equal(await page.locator('#naverBlogAuto').isChecked(), false); assert.equal(await page.locator('#naverBlogAuto').isDisabled(), true);
      await page.locator('#naverBlogSave').click(); await page.locator('.nv-subscription').waitFor(); await idle(page, 'setup-required');
      const saves = server.naverCalls.filter(c => c.rpc === 'life_naver_save');
      assert.equal(saves.length, 1); assert.deepEqual(saves[0].body, { p_workspace_id: seeded.workspaceId, p_blog_id: blogId, p_expected_revision: 0, p_enabled: false });
      await page.getByRole('button', { name: '지금 확인', exact: true }).click(); await page.locator('#naverBlogError').waitFor(); await idle(page, 'setup-required');
      assert.match(await page.locator('#naverBlogError').textContent(), /준비/); assert.equal(await page.locator('#naverBlogId').inputValue(), 'https://m.blog.naver.com/' + blogId + '/100001');
      await capture(page, report, 'connection-setup-required');
      await enter(page); await idle(page, 'setup-required'); assert.equal(await page.locator('.nv-subscription').count(), 1);
      assert.equal(server.naverCalls.filter(c => c.rpc === 'life_naver_save').length, 1); assert.deepEqual(await preserved(page, seeded), before);
    });
    await check('Old mobile and PostView originals survive projection, explicit new receipt, re-entry and opt-in automatic receipt without duplication', async ({ page, server, seeded }) => {
      const before = await preserved(page, seeded), existing = await existingNaver(page), original = await sources(page);
      server.collectionReady = true; const sub = server.subscription(seeded.workspaceId); server.inbox(sub);
      await enter(page); await idle(page, 'ready');
      const row = id => page.locator('.nv-item[data-item-id="' + item(id).id + '"]');
      assert.equal(await row('100001').getAttribute('data-state'), 'imported');
      assert.equal(await row('100002').getAttribute('data-state'), 'needs_content');
      assert.equal(await row('100003').getAttribute('data-state'), 'new');
      const sourceKey = 'naver-blog:source:' + existing.refs['100001'].sourceId;
      assert.equal(await row('100001').locator('[data-action=open]').getAttribute('data-focus-key'), sourceKey);
      await row('100001').locator('[data-action=open]').click(); await page.locator('#lifeSourceText').waitFor();
      assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
      assert.equal(sha(await page.locator('#lifeSourceText').textContent()), existing.refs['100001'].contentHash);
      assert.equal(await page.locator('.life-reader-heading').textContent(), original.sources.find(source => source.id === existing.refs['100001'].sourceId).title);
      await page.getByRole('button', { name: '네이버 블로그 목록으로 돌아가기', exact: true }).click(); await idle(page, 'ready');
      await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key && document.activeElement.matches('.nv-item [data-action=open]'), sourceKey);
      assert.equal(await page.evaluate(() => document.activeElement.closest('.nv-item').dataset.itemId), item('100001').id);
      report.exactSourceReturn = { ...existing.refs['100001'], itemId: item('100001').id, exactSourceAndVersionBytes: true, exactSameRowFocus: true };
      await row('100003').locator('[data-action=receive]').click();
      await page.waitForFunction(id => document.querySelector('.nv-item[data-item-id="' + id + '"]')?.dataset.state === 'needs_content', item('100003').id); await idle(page, 'ready');
      let current = await sources(page); assert.equal(current.sources.length, original.sources.length + 1); assert.equal(current.sourceVersions.length, original.sourceVersions.length + 1); await unchanged(page, original);
      const received = current.sources.find(source => source.url === postUrl('100003'));
      assert.ok(received); const version = current.sourceVersions.find(version => version.sourceId === received.id);
      assert.equal(version.contentText, item('100003').content_text); assert.equal(version.contentHash, item('100003').content_hash); assert.equal(version.coverage.status, 'partial');
      assert.match(version.coverage.omissions.join(' '), /사진/); await capture(page, report, 'deduplicated-collected-materials');
      const once = current; await enter(page); await idle(page, 'ready'); assert.deepEqual(await sources(page), once); assert.equal(await row('100003').locator('[data-action=receive]').count(), 0);
      await row('100002').locator('[data-action=complete]').click(); await page.locator('#lifeImportText').waitFor();
      assert.equal(await page.locator('#lifeImportUrl').inputValue(), original.sources.find(source => source.id === existing.refs['100002'].sourceId).url);
      await unchanged(page, original); await enter(page); await idle(page, 'ready');
      await page.locator('.nv-subscription [data-action=resume]').click(); await idle(page, 'ready');
      server.items.push({ ...item('100004'), owner_id: accounts.a.id, subscription_id: sub.id });
      await page.locator('#naverBlogRefresh').click(); await idle(page, 'ready');
      current = await until(page, async () => { const s = HaedoLife.Shell.storage, b = await s.read(await s.getActive()); return b.sources.some(source => source.url?.endsWith('/100004')) ? b : null; }, 'explicitly enabled automatic local receipt');
      assert.equal(current.sources.length, original.sources.length + 2); assert.equal(current.sourceVersions.length, original.sourceVersions.length + 2); await unchanged(page, original);
      const automaticOnce = current; await enter(page); await idle(page, 'ready'); assert.deepEqual(await sources(page), automaticOnce);
      const after = await preserved(page, seeded);
      assert.deepEqual(after.stages.filter(stage => before.stages.some(old => old.stageId === stage.stageId)), before.stages);
      const completion = after.stages.filter(stage => !before.stages.some(old => old.stageId === stage.stageId));
      assert.equal(completion.length, 1, 'Explicit completion opens exactly one ordinary import draft');
      assert.equal(completion[0].input.existingSourceId, existing.refs['100002'].sourceId); assert.equal(completion[0].input.text, '');
      assert.deepEqual({ ...after, stages: before.stages }, before);
    });
    await check('Pause and failed checks retain input, forged content cannot install, and delayed old workspace or account replies are ignored', async ({ page, server, seeded }) => {
      const other = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, old = await s.getActive(), next = await s.createWorkspace('구독과 독립적인 합성 공간'); await s.setActive(old); return next.workspaceId; });
      const before = await preserved(page, seeded); server.collectionReady = true;
      const sub = server.subscription(seeded.workspaceId, accounts.a.id, true); server.inbox(sub, []);
      await enter(page); await idle(page, 'ready'); await page.locator('#naverBlogId').fill(blogId);
      await page.locator('.nv-subscription [data-action=pause]').click(); await idle(page, 'ready');
      assert.equal(server.subscriptions.get(accounts.a.id + ':' + seeded.workspaceId).enabled, false);
      assert.equal(await page.locator('#naverBlogId').inputValue(), blogId);
      server.failCheck = true; await page.getByRole('button', { name: '지금 확인', exact: true }).click(); await idle(page, 'error');
      assert.equal(await page.locator('#naverBlogId').inputValue(), blogId); assert.deepEqual(await preserved(page, seeded), before);
      server.failCheck = false; server.inbox(sub, ['100003']); server.items[0].content_hash = '0'.repeat(64);
      const intact = await sources(page); await page.locator('#naverBlogRefresh').click(); await idle(page, 'error'); assert.deepEqual(await sources(page), intact); assert.equal(await page.locator('.nv-item').count(), 0);
      server.items = []; await page.locator('#naverBlogRefresh').click(); await idle(page, 'ready');
      // The delayed response really contains an opted-in new item: without the
      // final current-view guard it would install into the departed workspace.
      server.subscriptions.get(accounts.a.id + ':' + seeded.workspaceId).enabled = true;
      server.inbox(sub, ['100005']);
      const hold = gate(); server.holdList = hold; await page.locator('#naverBlogRefresh').click(); await arrived(hold);
      try {
        await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(other);
        await until(page, async expected => (await HaedoLife.Shell.storage.getActive()) === expected, 'exact new workspace activation', other);
        await page.locator('#lifeSearch').waitFor(); await settle(page);
        await openRecordsMenu(page); await page.getByRole('button', { name: '네이버 블로그 연결', exact: true }).click(); await idle(page, 'ready'); hold.release();
        assert.ok(await page.evaluate(() => __naverObservedLists > 0)); await page.waitForFunction(() => __naverActiveLists === 0);
        assert.equal(await page.locator('.nv-subscription').count(), 0); assert.equal(await page.locator('.nv-item').count(), 0);
        assert.deepEqual(await page.evaluate(ws => HaedoLife.Shell.storage.read(ws), seeded.workspaceId), intact);
      } finally { hold.release(); }
      const otherSubscription = server.subscription(other, accounts.a.id, true); server.inbox(otherSubscription, ['100006']);
      const late = gate(); server.holdList = late; await page.locator('#naverBlogRefresh').click(); await arrived(late);
      try {
        await page.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.b));
        await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id); await ready(page); await settle(page); await idle(page, 'ready');
        const bBefore = await databaseSnapshot(page); late.release(); await page.waitForFunction(() => __naverActiveLists === 0);
        assert.equal(await page.locator('.nv-subscription').count(), 0); assert.equal(await page.locator('.nv-item').count(), 0);
        assert.deepEqual(await databaseSnapshot(page), bBefore);
        assert.equal(await page.evaluate(async ws => { try { await HaedoLife.Shell.storage.read(ws); return null; } catch (e) { return e.code; } }, seeded.workspaceId), 'workspace_access_denied');
      } finally { late.release(); }
    });
    await check('RSS pause remains usable while collection is not ready; failed save keeps exact input, focus and private originals', async ({ page, server, seeded }) => {
      const before = await preserved(page, seeded), sub = server.subscription(seeded.workspaceId, accounts.a.id, true); server.inbox(sub, []);
      await enter(page); await idle(page, 'setup-required'); await page.locator('#naverBlogId').fill(blogId);
      const pause = page.locator('.nv-subscription[data-subscription-id="' + sub.id + '"] [data-action=pause]');
      assert.equal(await pause.isEnabled(), true, 'An already enabled connection can always be paused');
      server.failSave = true; await pause.click(); await idle(page, 'error');
      await page.waitForFunction(() => document.activeElement?.matches('.nv-subscription [data-action=pause]'));
      assert.equal(server.subscriptions.get(accounts.a.id + ':' + seeded.workspaceId).enabled, true); assert.equal(await page.locator('#naverBlogId').inputValue(), blogId); assert.deepEqual(await preserved(page, seeded), before);
      await capture(page, report, 'rss-pause-failure-ready-false', '.nv-subscription [data-action=pause]');
      server.failSave = false; await pause.click(); await idle(page, 'setup-required');
      assert.equal(server.subscriptions.get(accounts.a.id + ':' + seeded.workspaceId).enabled, false);
      assert.equal(await page.locator('.nv-subscription [data-action=resume]').isDisabled(), true, 'Not-ready collection cannot be re-enabled'); assert.equal(await page.locator('#naverBlogAuto').isDisabled(), true);
      await page.waitForFunction(() => document.activeElement?.id === 'naverBlogRefresh');
      assert.equal(await page.locator('#naverBlogId').inputValue(), blogId); assert.deepEqual(await preserved(page, seeded), before);
    });
    await check('An enabled account connection in another workspace can pause without a baseline, while re-enable retains both readiness gates', async ({ page, server, seeded }) => {
      const other = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, active = await s.getActive(), other = await s.createWorkspace('중지할 다른 합성 공간'); await s.setActive(active); return other.workspaceId; });
      const before = await preserved(page, seeded), otherBefore = await page.evaluate(ws => HaedoLife.Shell.storage.read(ws), other), sub = server.subscription(other, accounts.a.id, true);
      await enter(page); await idle(page, 'setup-required'); await page.locator('#naverBlogId').fill(blogId);
      const row = page.locator('.nv-connection[data-connection-id="' + sub.id + '"]'), toggle = () => row.locator('[data-action=new-posts]');
      assert.equal(await toggle().isEnabled(), true); assert.match(await toggle().innerText(), /중지/);
      server.failSave = true; await toggle().click(); await page.locator('#naverCaptureIntakeStatus[data-state=error]').waitFor(); await idle(page);
      await page.waitForFunction(id => document.activeElement?.closest('.nv-connection')?.dataset.connectionId === id && document.activeElement?.dataset.action === 'new-posts', sub.id);
      assert.equal(server.subscriptions.get(accounts.a.id + ':' + other).enabled, true); assert.equal(await page.locator('#naverBlogId').inputValue(), blogId);
      assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.getActive()), seeded.workspaceId); assert.deepEqual(await page.evaluate(ws => HaedoLife.Shell.storage.read(ws), other), otherBefore); assert.deepEqual(await preserved(page, seeded), before);
      await capture(page, report, 'account-pause-failure-incomplete-baseline', '.nv-connection[data-connection-id="' + sub.id + '"] [data-action=new-posts]');
      server.failSave = false; await toggle().click(); await idle(page, 'setup-required');
      assert.equal(server.subscriptions.get(accounts.a.id + ':' + other).enabled, false); assert.equal(await toggle().count(), 0, 'Incomplete baseline still cannot enable automatic new-post collection');
      await page.waitForFunction(id => document.activeElement?.closest('.nv-connection')?.dataset.connectionId === id && document.activeElement?.dataset.action === 'public-list', sub.id);
      server.collectionReady = true; await enter(page); await idle(page, 'ready'); assert.equal(await toggle().count(), 0, 'Ready server alone cannot enable an incomplete baseline');
      server.accountInventories.set(sub.id, { status: 'complete', baseline_completed_at: '2026-10-29T04:00:00.000Z' }); server.collectionReady = false;
      await enter(page); await idle(page, 'setup-required'); assert.equal(await toggle().isDisabled(), true, 'Complete baseline alone cannot bypass not-ready collection');
      server.collectionReady = true; await enter(page); await idle(page, 'ready'); assert.equal(await toggle().isEnabled(), true); await toggle().click(); await idle(page, 'ready');
      assert.equal(server.subscriptions.get(accounts.a.id + ':' + other).enabled, true);
      const saves = server.naverCalls.filter(call => call.rpc === 'life_naver_save'); assert(saves.every(call => call.body.p_workspace_id === other), 'Account control targets the connection workspace without changing the active workspace'); assert.deepEqual(saves.map(call => call.body.p_enabled), [false, false, true]);
      assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.getActive()), seeded.workspaceId); assert.deepEqual(await page.evaluate(ws => HaedoLife.Shell.storage.read(ws), other), otherBefore); assert.deepEqual(await preserved(page, seeded), before);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
    assert.deepEqual(await hashes(), startHashes, 'Runtime files must remain frozen throughout the whole suite'); report.pass = true;
  } finally {
    report.contextsRemaining = browser.contexts().length;
    try { await browser.close(); report.browserClosed = true; }
    finally { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
  }
}
async function unchanged(page, old) {
  const now = await sources(page);
  for (const name of ['sources', 'sourceVersions', 'records', 'links', 'resumeHints', 'tombstones']) {
    assert.deepEqual(now[name].filter(row => old[name].some(prior => prior.id === row.id)), old[name], 'Existing ' + name + ' must remain byte-for-byte equivalent');
  }
}
async function capture(page, report, scene, pointerSelector) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const metrics = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth }));
    assert.ok(metrics.overflow <= 1, 'Naver interface must not overflow horizontally');
    if (pointerSelector) {
      const control = page.locator(pointerSelector); await control.scrollIntoViewIfNeeded();
      const pointer = await control.evaluate(el => { const box = el.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return { enabled: !el.disabled, clear: hit === el || el.contains(hit), width: box.width, height: box.height }; });
      assert.equal(pointer.enabled, true); assert.equal(pointer.clear, true, 'Pause remains reachable by an actual pointer in both viewports'); metrics.pointer = pointer;
    }
    const filename = scene + '-' + width + '.png';
    await page.screenshot({ path: path.join(output, filename), fullPage: true }); report.visual.push({ filename, ...metrics });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

module.exports = { NaverCloud, blogId, postUrl, raw, gate, item, existingNaver, enter, capture };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
