'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Core = require('../assets/life/core.js');
const Rss = require(process.env.RSS_CONNECTION_MODULE || '../assets/life/rss-connection.js');
const owner = { userId: '10000000-0000-4000-8000-000000000001', projectUrl: 'https://rss-fixture.invalid' };
const sha = text => createHash('sha256').update(text).digest('hex');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const cursorStamp = cursor => BigInt(Date.parse(cursor.fetched_at)) * 1000n + BigInt((cursor.fetched_at.match(/\.(\d+)/)?.[1] || '').padEnd(6, '0').slice(3));
function cursorOrder(a, b) { const left = cursorStamp(a), right = cursorStamp(b); return left < right ? -1 : left > right ? 1 : a.id.localeCompare(b.id); }
function inbox(f, visible, pageSize = 100) {
  f.env.pageFor = request => {
    const rows = visible().slice().sort(cursorOrder).filter(row => !request.before || cursorOrder(row, request.before) > 0);
    const items = rows.slice(0, pageSize), last = items.at(-1);
    return { ...f.page, items, has_more: rows.length > pageSize,
      next_cursor: rows.length > pageSize ? { fetched_at: last.fetched_at, id: last.id } : null };
  };
}
function fixture({ now } = {}) {
  let bundle = Core.createWorkspace(), commits = 0, notify = () => {};
  const env = { current: true, held: null, conflict: false, requests: [], beforeCommit: null,
    accessToken: 'synthetic-rss-fixture-token', serverChecks: 0, manualChecks: 0, progressWrites: 0, verifierCreations: 0 };
  let progress = { revision: 0, cursor: null, receipts: [], needsRepair: false };
  const conn = { id: Core.id(), workspace_id: bundle.workspaceId, feed_url: 'https://feed.example.test/rss', status: 'active', revision: 1,
    baseline_count: 4, baseline_at: '2026-11-05T00:00:00.000Z' };
  const page = { configured: true, connections: [conn], items: [], has_more: false, next_cursor: null };
  const auth = { epoch: 1, user: { id: owner.userId }, getAccount: () => ({ ...owner }), async verify() { env.manualChecks++; return auth.user; },
    get session() { return { access_token: env.accessToken, user: auth.user }; },
    onAccountChange(fn) { notify = fn; return () => { notify = () => {}; }; },
    client: { supabaseKey: 'synthetic-public-fixture-key', auth: {
      async getSession() { return { data: { session: { access_token: env.accessToken, user: { id: owner.userId } } }, error: null }; },
      async getUser(token) { env.serverChecks++; assert.equal(token, env.accessToken); return { data: { user: auth.user }, error: null }; }
    }, functions: { async invoke(name, options) {
      assert.equal(name, 'haedo-rss'); env.requests.push(options.body);
      if (env.held) await env.held;
      return { data: structuredClone(env.pageFor ? env.pageFor(options.body) : page) };
    } } } };
  const storage = { isAccountScoped: true, account: owner, async read() { return structuredClone(bundle); },
    async readRssInboxProgress() { return { ...structuredClone(progress), bundleRevision: bundle.revision }; },
    async saveRssInboxProgress(_id, input, expectedRevision, options) {
      env.beforeAck?.();
      if (!options.isCurrent()) throw { code: 'rss_cancelled' };
      if (progress.revision !== expectedRevision || bundle.revision !== options.expectedBundleRevision) return { status: 'conflict' };
      assert.equal(new Set(input.receipts.map(row => row.itemId)).size, input.receipts.length);
      assert.deepEqual(input.cursor, input.receipts.at(-1)?.cursor || null);
      for (let index = 1; index < input.receipts.length; index++) assert(cursorOrder(input.receipts[index - 1].cursor, input.receipts[index].cursor) < 0);
      progress = { ...structuredClone(input), revision: progress.revision + 1, needsRepair: false }; env.progressWrites++;
      return { status: 'stored', ...structuredClone(progress), bundleRevision: bundle.revision };
    },
    async commitLocal(request, options) {
      env.beforeCommit?.();
      if (!options.isCurrent()) throw { code: 'rss_cancelled' };
      if (env.conflict) { env.conflict = false; return { status: 'conflict' }; }
      if (request.baseRevision !== bundle.revision) return { status: 'conflict' };
      bundle = Core.applyChanges(bundle, request.changes); commits++; return { status: 'stored' };
    } };
  const clientFactory = (projectUrl, key, options) => {
    assert.equal(projectUrl, owner.projectUrl); assert.equal(key, 'synthetic-public-fixture-key');
    env.verifierCreations++;
    assert.equal(options.auth.persistSession, false); assert.equal(options.auth.autoRefreshToken, false); assert.equal(options.auth.detectSessionInUrl, false);
    assert.match(options.auth.storageKey, /^haedo-rss-verifier-\d+$/);
    const isolated = options.auth.storage;
    assert.equal(isolated.getItem('probe'), null); isolated.setItem('probe', 'memory-only'); assert.equal(isolated.getItem('probe'), 'memory-only');
    isolated.removeItem('probe'); assert.equal(isolated.getItem('probe'), null);
    return { auth: { getUser: token => auth.client.auth.getUser(token) } };
  };
  const service = Rss.create({ storage, auth, core: Core, workspaceId: bundle.workspaceId, isCurrent: () => env.current, clientFactory, ...(now ? { now } : {}) });
  function item(overrides = {}) {
    const body = '\ufeff피드 원문 🌱\r\n<img src="https://invalid.test/private">';
    return { id: Core.id(), owner_id: owner.userId, connection_id: conn.id, identity: 'guid:one', title: 'RSS 글', url: 'https://feed.example.test/one',
      content_text: body, content_hash: sha(body), published_at: '2026-11-05T01:00:00.000Z', fetched_at: '2026-11-05T02:00:00.000Z', disposition: 'stored', reason: null, ...overrides };
  }
  return { env, page, conn, auth, storage, service, item, clientFactory, notify: () => notify(), get bundle() { return structuredClone(bundle); }, get commits() { return commits; }, get progress() { return structuredClone(progress); },
    mutate(action) { bundle = action(bundle); } };
}
test('exact feed text and deterministic IDs survive retry, concurrent receipt and a second device', async () => {
  const a = fixture(); const item = a.item(); a.page.items = [item]; a.env.conflict = true;
  const results = await Promise.all([a.service.list(), a.service.list()]);
  assert.equal(a.commits, 1); assert.equal(a.bundle.sources.length, 1);
  assert.equal(a.bundle.sourceVersions[0].contentText, item.content_text);
  assert.equal(a.bundle.sourceVersions[0].coverage.status, 'partial');
  assert.equal(results[0].items[0].sourceId, results[1].items[0].sourceId);
  const b = fixture(); b.conn.id = a.conn.id; b.page.items = [item];
  await b.service.list();
  assert.deepEqual(b.bundle.sources, a.bundle.sources); assert.deepEqual(b.bundle.sourceVersions, a.bundle.sourceVersions);
});
test('same identity appends an immutable version and preserves owner title; same URL different identity stays separate', async () => {
  const f = fixture(), first = f.item(); f.page.items = [first]; await f.service.list();
  const old = f.bundle.sourceVersions[0];
  f.mutate(bundle => { bundle.sources[0].title = '사용자가 고친 제목'; return bundle; });
  const text = '고친 피드 원문';
  f.page.items = [f.item({ content_text: text, content_hash: sha(text), fetched_at: '2026-11-05T03:00:00.000Z' })];
  await f.service.list();
  assert.equal(f.bundle.sources.length, 1); assert.equal(f.bundle.sources[0].title, '사용자가 고친 제목');
  assert.equal(f.bundle.sourceVersions.length, 2); assert.deepEqual(f.bundle.sourceVersions[0], old);
  f.page.items = [f.item({ identity: 'guid:two' })]; await f.service.list();
  assert.equal(f.bundle.sources.length, 2);
});
test('held items never project; stopping collection preserves archived materials across devices', async () => {
  for (const state of ['active', 'paused', 'disconnected']) {
    const f = fixture(); f.conn.status = state;
    f.page.items = [f.item(state === 'active' ? { disposition: 'held', reason: 'identity_conflict' } : {})];
    await f.service.list(); assert.equal(f.commits, state === 'active' ? 0 : 1);
  }
});
test('wrong owner, wrong hash, unknown connection and oversize text fail before any material writes', async () => {
  for (const change of [{ owner_id: Core.id() }, { content_hash: '0'.repeat(64) }, { connection_id: Core.id() }, { content_text: 'x'.repeat(1024 * 1024 + 1) }]) {
    const f = fixture(); f.page.items = [f.item(change)];
    await assert.rejects(f.service.list(), { code: 'rss_invalid_data' }); assert.equal(f.commits, 0);
  }
});
test('a bad later item prevents partial projection of the validated first item', async () => {
  const f = fixture(); f.page.items = [f.item(), f.item({ identity: 'guid:two', content_hash: '0'.repeat(64) })];
  await assert.rejects(f.service.list()); assert.equal(f.commits, 0);
});
test('a feed entry with text and a stable ID remains usable without a permalink', async () => {
  const f = fixture(); f.page.items = [f.item({ url: null })];
  await f.service.list(); assert.equal(f.bundle.sources[0].url, undefined); assert.equal(f.bundle.sourceVersions[0].contentText, f.page.items[0].content_text);
});
test('late requests after auth epoch, account, navigation or disposal do not project or return another account data', async () => {
  for (const cancel of [f => f.auth.epoch++, f => { f.auth.user = { id: Core.id() }; f.notify(); }, f => { f.env.current = false; }, f => f.service.dispose()]) {
    const f = fixture(); f.page.items = [f.item()]; let release;
    f.env.held = new Promise(resolve => { release = resolve; });
    const pending = f.service.list(); await new Promise(resolve => setImmediate(resolve)); cancel(f); release();
    await assert.rejects(pending, { code: 'rss_cancelled' }); assert.equal(f.commits, 0);
  }
});
test('account change at commit guard blocks the transaction', async () => {
  const f = fixture(); f.page.items = [f.item()]; f.env.beforeCommit = () => f.auth.epoch++;
  await assert.rejects(f.service.list(), { code: 'rss_cancelled' }); assert.equal(f.commits, 0);
});
test('fresh verification notifications for the unchanged account do not cancel the operation', async () => {
  const f = fixture(); f.page.items = [f.item()];
  f.auth.verify = async () => { f.notify(); return f.auth.user; };
  await f.service.list(); assert.equal(f.commits, 1);
});
test('registration and control requests contain only whitelisted transport fields', async () => {
  const f = fixture();
  await f.service.register('https://feed.example.test/rss');
  assert.deepEqual(f.env.requests[0], { action: 'register', workspaceId: f.conn.workspace_id, url: f.conn.feed_url });
  await f.service.action('activate', { ...f.conn, token: 'must-not-send', title: 'private' });
  assert.deepEqual(f.env.requests[1], { action: 'activate', workspaceId: f.conn.workspace_id, connectionId: f.conn.id, expectedRevision: 1 });
  await f.service.action('preview', f.conn);
  assert.deepEqual(f.env.requests[2], { action: 'preview', workspaceId: f.conn.workspace_id, connectionId: f.conn.id });
  assert.throws(() => f.service.action('delete', f.conn));
  assert.throws(() => f.service.register('javascript:alert(1)'));
});
test('connection history and explicit pages retain the 101st exact item without duplicate projection', async () => {
  const f = fixture(); f.page.connections.push({ ...f.conn, id: Core.id(), status: 'disconnected' });
  f.page.items = Array.from({ length: 100 }, (_, index) => f.item({ identity: 'guid:' + index })); f.page.has_more = true;
  f.page.next_cursor = { fetched_at: f.page.items[99].fetched_at, id: f.page.items[99].id, privateField: 'must-not-send' };
  const later = { ...f.page, items: [f.item({ identity: 'guid:later' })], has_more: false, next_cursor: null };
  f.env.pageFor = request => request.before ? later : f.page;
  const progress = []; const first = await f.service.list(count => progress.push(count));
  assert.equal(first.hasMore, true); assert.equal(first.items.length, 100); assert.equal(first.checkedItems, 100);
  assert.equal(f.bundle.sources.length, 100); assert.deepEqual(progress, [100]); assert.equal(f.env.requests.length, 1);
  const more = await f.service.more(first.nextCursor);
  assert.equal(f.bundle.sources.length, 101); assert.equal(more.items[0].id, later.items[0].id);
  assert.equal(f.bundle.sourceVersions.find(version => version.id === more.items[0].sourceVersionId).contentText, later.items[0].content_text);
  assert.deepEqual(f.env.requests[1].before, first.nextCursor);
  assert.deepEqual(Object.keys(f.env.requests[1].before).sort(), ['fetched_at', 'id']);
  await f.service.more(first.nextCursor); assert.equal(f.bundle.sources.length, 101);
});
test('a new feed version never restores a trashed source', async () => {
  const f = fixture(); f.page.items = [f.item()]; await f.service.list();
  const sourceId = f.bundle.sources[0].id;
  f.mutate(bundle => Core.applyChanges(bundle, Core.buildSourceStateChanges(bundle, sourceId, 'trash')));
  f.page.items = [f.item({ content_text: '새 판', content_hash: sha('새 판') })];
  const result = await f.service.list();
  assert.equal(f.commits, 1); assert.equal(result.items[0].materialStatus, 'trashed');
  assert.equal(Core.isSourceActive(f.bundle, sourceId), false);
});
test('known setup failures show safe text and never expose arbitrary backend errors', async () => {
  const f = fixture(); f.auth.client.functions.invoke = async () => ({ data: { error: 'setup_required', token: 'private' } });
  await assert.rejects(f.service.list(), { code: 'rss_setup_required' });
  f.auth.client.functions.invoke = async () => ({ error: { message: 'private token:secret' } });
  await assert.rejects(f.service.list(), error => error.message === Rss.messages.rss_network_error);
});
test('dedicated feed errors survive HTTP errors without treating a missing connection as login failure', async () => {
  for (const code of ['rss_retry_limit', 'rss_invalid_feed', 'rss_connection_exists', 'rss_not_found']) {
    const f = fixture();
    f.auth.client.functions.invoke = async () => ({ error: { status: 403, context: { async json() { return { error: code }; } } } });
    await assert.rejects(f.service.list(), error => error.code === code && error.message === Rss.messages[code]);
  }
  assert.match(Rss.messages.rss_retry_limit, /1시간에 2회/);
  assert.doesNotMatch(Rss.messages.rss_not_found, /로그인/);
});
test('unexecuted collection status is preserved through pagination and does not become success', async () => {
  for (const status of ['not_due', 'stale']) {
    const f = fixture(); f.page.execution = { status, credential: 'must-not-leak' };
    const result = await f.service.action('poll', f.conn);
    assert.deepEqual(result.execution, { status }); assert.equal(f.commits, 0);
  }
});
test('other workspace connections are read-only metadata and cannot justify wrong-workspace item projection', async () => {
  const f = fixture(), other = { ...f.conn, id: Core.id(), workspace_id: Core.id() };
  f.page.connections = []; f.page.other_connections = [other];
  const snapshot = await f.service.list();
  assert.equal(snapshot.otherConnections[0].status, 'active'); assert.equal(f.commits, 0);
  f.page.items = [f.item({ connection_id: other.id })];
  await assert.rejects(f.service.list(), { code: 'rss_invalid_data' }); assert.equal(f.commits, 0);
});
test('bounded baseline failures retain their specific reason and stopped connection state', async () => {
  for (const code of ['baseline_page_limit', 'baseline_stalled', 'catchup_page_limit']) {
    const f = fixture(); f.conn.status = code === 'catchup_page_limit' ? 'active' : 'pending'; f.conn.last_error = code;
    f.page.execution = { status: 'error', error: code };
    const result = await f.service.action(code === 'catchup_page_limit' ? 'poll' : 'preview', f.conn);
    assert.equal(result.execution.error, code); assert.equal(result.connections[0].last_error, code);
    assert.match(Rss.messages[code], /멈췄습니다/);
    assert.equal(f.commits, 0);
  }
});
test('transient retry state keeps the server retry clock through failures one and two, then stops at three', async () => {
  for (const code of ['network_error', 'rate_limited']) {
    for (const count of [1, 2, 3]) {
      const f = fixture(); Object.assign(f.conn, { last_error: code, failure_count: count, auto_retry: count < 3, next_check_at: '2026-11-05T03:00:00.000Z' });
      f.page.execution = { status: 'error', error: code };
      const result = await f.service.list();
      assert.equal(result.connections[0].auto_retry, count < 3); assert.equal(result.connections[0].failure_count, count);
      assert.equal(result.connections[0].next_check_at, f.conn.next_check_at); assert.equal(result.execution.error, code);
      assert.equal(f.commits, 0);
    }
  }
});
test('third failure or malformed feed cannot be mislabeled as an automatic transient retry', async () => {
  for (const override of [{ last_error: 'network_error', failure_count: 3 }, { last_error: 'rss_invalid_item', failure_count: 1 }, { status: 'paused', last_error: 'network_error', failure_count: 1 }]) {
    const f = fixture(); Object.assign(f.conn, { auto_retry: true }, override);
    await assert.rejects(f.service.list(), { code: 'rss_invalid_data' }); assert.equal(f.commits, 0);
  }
});
test('finish validation failures display safe stopped-collection guidance without backend error content', async () => {
  for (const code of ['rss_invalid_result', 'rss_invalid_pages', 'rss_invalid_item', 'rss_invalid_hash', 'rss_invalid_date', 'rss_text_limit']) {
    const f = fixture(); Object.assign(f.conn, { last_error: code, failure_count: 1, auto_retry: false });
    f.page.execution = { status: 'error', error: code, detail: 'private upstream content' };
    const result = await f.service.list();
    assert.match(Rss.messageFor(result.execution.error), /자동 확인을 멈췄습니다/);
    assert.match(Rss.messageFor(result.connections[0].last_error), /자동 확인을 멈췄습니다/);
    assert.doesNotMatch(JSON.stringify(result.execution), /private upstream/);
  }
});
test('unfinished server work is a stopped collection distinct from automatic transient retries', async () => {
  const f = fixture(); Object.assign(f.conn, { last_error: 'server_error', failure_count: 0, auto_retry: false });
  f.page.execution = { status: 'error', error: 'server_error', detail: 'private backend payload' };
  const result = await f.service.list();
  assert.equal(result.connections[0].auto_retry, false); assert.equal(result.connections[0].failure_count, 0);
  assert.equal(result.execution.error, 'server_error');
  assert.match(Rss.messageFor('server_error'), /서버에서 수집 처리를 마치지 못했습니다/);
  assert.doesNotMatch(JSON.stringify(result.execution), /private backend/);
  await f.service.action('retry', f.conn);
  assert.equal(f.env.requests.at(-1).action, 'retry');
  f.conn.auto_retry = true;
  await assert.rejects(f.service.list(), { code: 'rss_invalid_data' });
});

test('automatic reflection verifies once without common notifications across pages and material commits; manual actions still verify', async t => {
  const f = fixture(); t.after(f.service.dispose);
  let commonNotifications = 0;
  f.auth.verify = async () => { f.env.manualChecks++; commonNotifications++; f.notify(); return f.auth.user; };
  const rows = Array.from({ length: 4 }, (_, index) => f.item({ id: '10000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'), identity: 'automatic:' + index }));
  inbox(f, () => rows, 2);
  const result = await f.service.reflect();
  assert.equal(result.appliedItems, 4); assert.equal(f.commits, 4); assert.equal(f.env.requests.length, 2);
  assert.equal(f.env.serverChecks, 1); assert.equal(f.env.manualChecks, 0); assert.equal(commonNotifications, 0);
  assert.equal(f.progress.receipts.length, 4);
  await f.service.list(); assert.equal(f.env.manualChecks, 1); assert.equal(commonNotifications, 1);
  assert.equal(f.env.serverChecks, 1, 'manual settings keep their existing common verification path');
});

test('late automatic verification success and failure discard epoch, owner, navigation, disposal and token changes', async t => {
  for (const result of ['success', 'failure']) for (const boundary of ['epoch', 'owner', 'navigation', 'dispose', 'token']) {
    await t.test(result + ' after ' + boundary, async t => {
      const f = fixture(), held = deferred(); t.after(f.service.dispose); t.after(() => held.resolve());
      f.page.items = [f.item()]; let entered = false, commonNotifications = 0;
      f.auth.verify = async () => { commonNotifications++; f.notify(); return f.auth.user; };
      f.auth.client.auth.getUser = async token => {
        assert.equal(token, 'synthetic-rss-fixture-token'); entered = true; await held.promise;
        return result === 'success' ? { data: { user: { id: owner.userId } }, error: null }
          : { data: { user: null }, error: { code: 'session_not_found' } };
      };
      const pending = f.service.reflect().then(value => ({ value }), error => ({ error }));
      await settle(); assert.equal(entered, true, 'automatic reflection must use its isolated explicit-token verifier');
      if (boundary === 'epoch') f.auth.epoch++;
      if (boundary === 'owner') { f.auth.user = { id: Core.id() }; f.notify(); }
      if (boundary === 'navigation') f.env.current = false;
      if (boundary === 'dispose') f.service.dispose();
      if (boundary === 'token') f.env.accessToken = 'synthetic-replacement-token';
      held.resolve(); const outcome = await pending;
      assert.equal(outcome.error?.code, 'rss_cancelled');
      assert.equal(f.env.requests.length, 0); assert.equal(f.commits, 0); assert.equal(f.env.progressWrites, 0);
      assert.equal(commonNotifications, 0);
    });
  }
});

test('automatic reflectors of multiple workspaces reuse one memory-only verifier for the shared client', async t => {
  const f = fixture(); t.after(f.service.dispose);
  await f.service.reflect(); await f.service.reflect();
  assert.equal(f.env.verifierCreations, 1);
  const otherWorkspace = Core.id();
  const other = Rss.create({ storage: f.storage, auth: f.auth, core: Core, workspaceId: otherWorkspace, clientFactory: f.clientFactory });
  t.after(other.dispose);
  f.env.pageFor = body => ({ ...f.page, connections: [{ ...f.conn, workspace_id: body.workspaceId }] });
  await other.reflect();
  assert.equal(f.env.verifierCreations, 1); assert.equal(f.env.serverChecks, 3);
  other.dispose(); await f.service.reflect(); assert.equal(f.env.verifierCreations, 1); assert.equal(f.env.serverChecks, 4);
});

test('a token change while a reflected response is pending or at commit cannot apply or acknowledge it', async t => {
  for (const stage of ['response', 'commit', 'ack']) await t.test(stage, async t => {
    const f = fixture(), held = deferred(); t.after(f.service.dispose);
    f.page.items = [f.item()];
    if (stage === 'response') f.env.held = held.promise;
    if (stage === 'commit') f.env.beforeCommit = () => { f.env.accessToken = 'synthetic-replacement-token'; };
    if (stage === 'ack') f.env.beforeAck = () => { f.env.accessToken = 'synthetic-replacement-token'; };
    const pending = f.service.reflect().then(value => ({ value }), error => ({ error }));
    if (stage === 'response') { await settle(); f.env.accessToken = 'synthetic-replacement-token'; held.resolve(); }
    const outcome = await pending;
    assert.equal(outcome.error?.code, 'rss_cancelled');
    assert.equal(f.commits, stage === 'ack' ? 1 : 0); assert.equal(f.env.progressWrites, 0);
  });
});

test('late initial session reads cannot start verification after navigation and missing sessions send nothing', async t => {
  const f = fixture(), held = deferred(); t.after(f.service.dispose);
  f.auth.client.auth.getSession = () => held.promise;
  const pending = f.service.reflect().then(value => ({ value }), error => ({ error }));
  await settle(); f.env.current = false;
  held.resolve({ data: { session: { user: { id: owner.userId }, access_token: f.env.accessToken } }, error: null });
  assert.equal((await pending).error?.code, 'rss_cancelled'); assert.equal(f.env.serverChecks, 0); assert.equal(f.env.requests.length, 0);
  const missing = fixture(); t.after(missing.service.dispose);
  missing.auth.client.auth.getSession = async () => ({ data: { session: null }, error: null });
  await assert.rejects(missing.service.reflect(), { code: 'rss_auth_required' }); assert.equal(missing.env.requests.length, 0);
});

test('two connections whose finishes commit in reverse order are both received once through the lease overlap', async t => {
  const f = fixture(); t.after(f.service.dispose);
  const other = { ...f.conn, id: Core.id() }; f.page.connections.push(other);
  const early = f.item({ connection_id: other.id, identity: 'early', fetched_at: '2026-11-05T01:58:00.000001Z' });
  const later = f.item({ identity: 'later', fetched_at: '2026-11-05T02:00:00.000001Z' });
  let visible = [later]; inbox(f, () => visible);
  await f.service.reflect(); assert.equal(f.commits, 1); assert.equal(f.progress.cursor.id, later.id);
  visible = [early, later]; const second = await f.service.reflect();
  assert.equal(second.appliedItems, 1); assert.equal(f.commits, 2); assert.equal(f.bundle.sourceVersions.length, 2);
  assert.deepEqual(f.progress.receipts.map(row => row.itemId), [early.id, later.id]);
  assert.equal(f.env.requests[1].before.fetched_at, '2026-11-05T01:57:59.999Z');
  assert.equal(f.env.requests[1].before.id, '00000000-0000-0000-0000-000000000000');
  const acknowledgements = f.env.progressWrites; await f.service.reflect();
  assert.equal(f.commits, 2); assert.equal(f.env.progressWrites, acknowledgements, 'an overlap containing only proved IDs writes no ACK');
  assert.deepEqual(f.bundle.sourceVersions.map(row => row.contentText), [later.content_text, early.content_text]);
});

test('same-timestamp lower UUID and submillisecond late items are retained and sorted before the old ACK', async t => {
  const f = fixture(); t.after(f.service.dispose);
  const later = f.item({ id: '10000000-0000-4000-8000-000000000003', identity: 'later', fetched_at: '2026-11-05T02:00:00.000002Z' });
  const sameTime = f.item({ id: '10000000-0000-4000-8000-000000000002', identity: 'same-time', fetched_at: later.fetched_at });
  const earlier = f.item({ id: '10000000-0000-4000-8000-000000000004', identity: 'earlier', fetched_at: '2026-11-05T02:00:00.000001Z' });
  let visible = [later]; inbox(f, () => visible); await f.service.reflect();
  visible = [later, sameTime, earlier]; await f.service.reflect();
  assert.equal(f.commits, 3); assert.deepEqual(f.progress.receipts.map(row => row.itemId), [earlier.id, sameTime.id, later.id]);
});

test('overlap pagination advances past an all-duplicate first page without repeated receipt writes', async t => {
  const f = fixture(); t.after(f.service.dispose);
  const rows = Array.from({ length: 3 }, (_, index) => f.item({ id: '10000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'), identity: 'page:' + index }));
  let visible = rows.slice(0, 2); inbox(f, () => visible, 2); await f.service.reflect();
  const firstAck = f.env.progressWrites; visible = rows; const result = await f.service.reflect();
  assert.equal(result.appliedItems, 1); assert.equal(f.env.requests.length, 3);
  assert.deepEqual(f.env.requests[2].before, { fetched_at: rows[1].fetched_at, id: rows[1].id });
  assert.equal(f.env.progressWrites, firstAck + 1); assert.equal(f.commits, 3);
});

test('a newly visible earlier failure rolls ACK back to the proven prefix and cannot skip the item on retry', async t => {
  const f = fixture(); t.after(f.service.dispose);
  const prior = f.item({ identity: 'prior', fetched_at: '2026-11-05T01:57:00.000Z' });
  const missing = f.item({ identity: 'late-failure', fetched_at: '2026-11-05T01:59:00.000Z' });
  const later = f.item({ identity: 'later', fetched_at: '2026-11-05T02:00:00.000Z' });
  const future = f.item({ identity: 'future', fetched_at: '2026-11-05T03:00:00.000Z' });
  let visible = [prior, later]; inbox(f, () => visible); await f.service.reflect();
  assert.equal(f.progress.cursor.id, later.id);
  visible = [prior, missing, later, future]; f.env.beforeCommit = () => { throw { code: 'rss_receive_conflict' }; };
  const failed = await f.service.reflect(); assert.equal(failed.receiveError, Rss.messages.rss_receive_conflict);
  assert.equal(f.commits, 2); assert.equal(f.progress.cursor.id, prior.id);
  assert.deepEqual(f.progress.receipts.map(row => row.itemId), [prior.id]);
  assert.equal(f.bundle.sourceVersions.length, 2, 'ACK rollback never deletes an already preserved body');
  f.env.beforeCommit = null; const recovered = await f.service.reflect();
  assert.equal(recovered.appliedItems, 2); assert.equal(f.commits, 4);
  assert.deepEqual(f.progress.receipts.map(row => row.itemId), [prior.id, missing.id, later.id, future.id]);
  assert.equal(new Set(f.bundle.sourceVersions.map(row => row.id)).size, 4);
});

test('a malformed late overlap item prevents all page writes and leaves the fixed ACK window retryable', async t => {
  const f = fixture(); t.after(f.service.dispose);
  const later = f.item({ identity: 'later', fetched_at: '2026-11-05T02:00:00.000Z' });
  const early = f.item({ identity: 'early', fetched_at: '2026-11-05T01:59:00.000Z' });
  const future = f.item({ identity: 'future', fetched_at: '2026-11-05T03:00:00.000Z' });
  let visible = [later]; inbox(f, () => visible); await f.service.reflect();
  const ack = f.progress; visible = [{ ...early, content_hash: '0'.repeat(64) }, later, future];
  await assert.rejects(f.service.reflect(), { code: 'rss_invalid_data' });
  assert.deepEqual(f.progress, ack); assert.equal(f.commits, 1);
  await assert.rejects(f.service.reflect(), { code: 'rss_invalid_data' });
  assert.deepEqual(f.env.requests[1].before, f.env.requests[2].before, 'the overlap follows the unchanged ACK, not wall-clock time');
  visible = [early, later, future]; await f.service.reflect();
  assert.equal(f.commits, 3); assert.deepEqual(f.progress.receipts.map(row => row.itemId), [early.id, later.id, future.id]);
});

test('a permanently rejected validated row exposes only its item identity and title beside the safe error', async t => {
  const f = fixture(); t.after(f.service.dispose);
  const row = f.item({ title: '<img src=x onerror=alert(1)> 검증된 RSS 제목' }); f.page.items = [row];
  f.env.beforeCommit = () => { throw { code: 'rss_invalid_data', diagnostic: row.content_text }; };
  const result = await f.service.reflect();
  assert.equal(result.receiveErrorCode, 'rss_invalid_data'); assert.equal(result.blockedItemId, row.id); assert.equal(result.blockedItemTitle, row.title);
  assert.equal(result.receiveError, Rss.messages.rss_invalid_data);
  assert.equal(f.commits, 0); assert.equal(f.progress.cursor, null);
  assert.doesNotMatch(JSON.stringify(result), /피드 원문|diagnostic|content_text/);
});

const at = (minute, second = 0) => new Date(Date.UTC(2026, 10, 5, 2, minute, second)).toISOString();
const windowBefore = row => ({ fetched_at: new Date(Date.parse(row.fetched_at) - 120001).toISOString(), id: '00000000-0000-0000-0000-000000000000' });
const exactAfter = row => ({ fetched_at: row.fetched_at, id: row.id });
const settleBefore = row => ({ fetched_at: new Date(Date.parse(row.fetched_at) - 600001).toISOString(), id: '00000000-0000-0000-0000-000000000000' });

test('a live page rereads the lease window during the lease and once after the settle margin, then reads only after the exact ACK', async t => {
  let clock = 0; const f = fixture({ now: () => clock }); t.after(f.service.dispose);
  const ack = f.item({ identity: 'ack', fetched_at: '2026-11-05T02:00:00.123456Z' });
  const slow = f.item({ identity: 'slow-commit', fetched_at: '2026-11-05T01:59:55.000Z' });
  const next = f.item({ identity: 'next', fetched_at: at(30) });
  let visible = [ack], returned = []; inbox(f, () => visible);
  const pageFor = f.env.pageFor; f.env.pageFor = request => { const page = pageFor(request); returned.push(page.items.map(row => row.id)); return page; };
  await f.service.reflect(); assert.deepEqual(f.progress.cursor, exactAfter(ack));
  const minutes = [0, 1, 2, 3, 4, 9, 10];
  for (const minute of minutes) {
    clock = minute * 60000;
    // finish stamped this row before the ACK row, then waited about four minutes to commit.
    if (minute === 4) visible = [slow, ack];
    await f.service.reflect();
  }
  clock = 600001; const settled = await f.service.reflect();
  assert.equal(settled.appliedItems, 1, 'the slow commit is received by the read after the settle margin');
  clock = 660001; await f.service.reflect(); clock = 720001; await f.service.reflect();
  const overlap = { fetched_at: '2026-11-05T01:58:00.122Z', id: '00000000-0000-0000-0000-000000000000' }, exact = exactAfter(ack);
  const settle = { fetched_at: '2026-11-05T01:50:00.122Z', id: '00000000-0000-0000-0000-000000000000' };
  assert.deepEqual(f.env.requests.map(row => row.before || null), [null, overlap, overlap, overlap, exact, exact, exact, exact, settle, exact, exact]);
  assert.deepEqual(returned.slice(4, 8), [[], [], [], []], 'between the lease and the margin only rows after the ACK are fetched');
  assert.deepEqual(returned.slice(9), [[], []], 'a settled ACK never fetches an acknowledged body again');
  assert.deepEqual(f.progress.receipts.map(row => row.itemId), [slow.id, ack.id]); assert.deepEqual(f.progress.cursor, exact);
  visible = [slow, ack, next]; await f.service.reflect();
  assert.deepEqual(f.env.requests.at(-1).before, exact); assert.deepEqual(f.progress.cursor, exactAfter(next));
  await f.service.reflect(); assert.deepEqual(f.env.requests.at(-1).before, windowBefore(next), 'a new ACK starts its own lease window');
  assert.equal(f.commits, 3);
});

for (const [label, stampedBefore, visibleAtMinute] of [['inside the lease window, visible within the lease', 30, 1],
  ['inside the lease window, visible after the lease', 30, 5], ['200 s before the ACK, visible after the lease', 200, 5], ['590 s before the ACK, visible at nine minutes', 590, 9]]) {
  test('a slow commit stamped ' + label + ' is received by the settle read', async t => {
    let clock = 0; const f = fixture({ now: () => clock }); t.after(f.service.dispose);
    const ack = f.item({ identity: 'ack', fetched_at: at(10) });
    const late = f.item({ identity: 'late', fetched_at: new Date(Date.parse(ack.fetched_at) - stampedBefore * 1000).toISOString() });
    let visible = [ack]; inbox(f, () => visible); await f.service.reflect();
    for (let minute = 1; minute <= 14; minute++) { clock = minute * 60000 + 1; if (minute === visibleAtMinute) visible = [late, ack]; await f.service.reflect(); }
    assert.deepEqual(f.progress.receipts.map(row => row.itemId), [late.id, ack.id]);
    assert.deepEqual(f.env.requests.at(-1).before, exactAfter(ack), 'the ACK settled after its one wide read');
    assert.equal(f.env.requests.filter(row => row.before?.fetched_at === settleBefore(ack).fetched_at).length, 1, 'the wide read happens once');
  });
}

test('the settle read happens only after more than the margin and repeats until it completes', async t => {
  let clock = 0; const f = fixture({ now: () => clock }); t.after(f.service.dispose);
  const ack = f.item({ identity: 'ack', fetched_at: at(0) }), next = f.item({ identity: 'next', fetched_at: at(1) });
  let visible = [ack]; inbox(f, () => visible); await f.service.reflect();
  clock = 600000; await f.service.reflect();
  assert.deepEqual(f.env.requests.at(-1).before, exactAfter(ack), 'exactly the margin is not more than the margin');
  clock = 600001; visible = [ack, next]; f.env.beforeCommit = () => { throw { code: 'rss_receive_conflict' }; };
  const failed = await f.service.reflect(); assert.equal(failed.receiveErrorCode, 'rss_receive_conflict');
  assert.deepEqual(f.env.requests.at(-1).before, settleBefore(ack)); assert.deepEqual(f.progress.cursor, exactAfter(ack));
  f.env.beforeCommit = null; clock = 660001; await f.service.reflect();
  assert.deepEqual(f.env.requests.at(-1).before, settleBefore(ack), 'an unfinished settle read is repeated');
  assert.deepEqual(f.progress.receipts.map(row => row.itemId), [ack.id, next.id]); assert.equal(f.commits, 2);
});

test('a new ACK restarts the lease clock even after an earlier ACK settled', async t => {
  let clock = 0; const f = fixture({ now: () => clock }); t.after(f.service.dispose);
  const first = f.item({ identity: 'first', fetched_at: at(0) }), second = f.item({ identity: 'second', fetched_at: at(20) });
  const late = f.item({ identity: 'late-before-second', fetched_at: at(19, 55) });
  let visible = [first]; inbox(f, () => visible); await f.service.reflect();
  for (const time of [600001, 660001]) { clock = time; await f.service.reflect(); }
  assert.deepEqual(f.env.requests.at(-1).before, exactAfter(first), 'the first ACK settled');
  clock = 700000; visible = [first, second]; await f.service.reflect(); assert.deepEqual(f.progress.cursor, exactAfter(second));
  clock = 701000; await f.service.reflect(); assert.deepEqual(f.env.requests.at(-1).before, windowBefore(second));
  clock = 702000; visible = [first, late, second]; const caught = await f.service.reflect();
  assert.equal(caught.appliedItems, 1, 'a concurrent earlier finish is received inside the new lease');
  assert.deepEqual(f.progress.receipts.map(row => row.itemId), [first.id, late.id, second.id]);
});

test('another tab truncating the ACK between pages restarts the scan instead of merging across the gap', async t => {
  let clock = 0; const f = fixture({ now: () => clock }); t.after(f.service.dispose);
  const a1 = f.item({ identity: 'a1', fetched_at: at(0) }), late = f.item({ identity: 'late', fetched_at: at(0, 30) });
  const a2 = f.item({ identity: 'a2', fetched_at: at(1) }), a3 = f.item({ identity: 'a3', fetched_at: at(10) }), a4 = f.item({ identity: 'a4', fetched_at: at(10, 30) });
  let visible = [a1, a2, a3, a4]; inbox(f, () => visible, 2);
  const read = f.storage.readRssInboxProgress; let reads = 0;
  f.storage.readRssInboxProgress = async (...args) => {
    if (++reads === 2) {
      // Tab B saw the late row, failed on it and rolled the shared ACK back to a1.
      visible = [a1, late, a2, a3, a4]; const progress = await read(...args), kept = progress.receipts.filter(row => row.itemId === a1.id);
      assert.equal((await f.storage.saveRssInboxProgress(null, { cursor: kept.at(-1).cursor, receipts: kept }, progress.revision,
        { expectedBundleRevision: f.bundle.revision, isCurrent: () => true })).status, 'stored');
    }
    return read(...args);
  };
  await f.service.reflect();
  assert.deepEqual(f.progress.receipts.map(row => row.itemId), [a1.id, late.id, a2.id, a3.id, a4.id]);
  assert(f.bundle.sourceVersions.some(row => row.id === 'rssv_' + late.id));
});

test('a restore that invalidates the ACK between pages restarts from the repaired prefix', async t => {
  let clock = 0; const f = fixture({ now: () => clock }); t.after(f.service.dispose);
  const a1 = f.item({ identity: 'a1', fetched_at: at(0) }), a2 = f.item({ identity: 'a2', fetched_at: at(1) });
  const a3 = f.item({ identity: 'a3', fetched_at: at(10) }), a4 = f.item({ identity: 'a4', fetched_at: at(10, 30) });
  inbox(f, () => [a1, a2, a3, a4], 2);
  const read = f.storage.readRssInboxProgress; let reads = 0;
  f.storage.readRssInboxProgress = async (...args) => {
    const progress = await read(...args);
    if (++reads !== 2) return progress;
    // An older backup without a2 was restored: storage reports the valid prefix and repair.
    f.mutate(bundle => ({ ...bundle, revision: bundle.revision + 1,
      sources: bundle.sources.filter(source => !bundle.sourceVersions.some(version => version.id === 'rssv_' + a2.id && version.sourceId === source.id)),
      sourceVersions: bundle.sourceVersions.filter(version => version.id !== 'rssv_' + a2.id) }));
    const kept = progress.receipts.filter(row => row.itemId === a1.id);
    return { ...progress, receipts: kept, cursor: kept[0].cursor, needsRepair: true };
  };
  await f.service.reflect();
  assert.deepEqual(f.progress.receipts.map(row => row.itemId), [a1.id, a2.id, a3.id, a4.id]);
  assert(f.bundle.sourceVersions.some(row => row.id === 'rssv_' + a2.id), 'the restored-away original is received again');
});

test('repeated cross-tab ACK changes stop after a bounded number of restarts', async t => {
  const f = fixture(); t.after(f.service.dispose);
  const rows = [0, 1, 2].map(minute => f.item({ identity: 'r' + minute, fetched_at: at(minute) }));
  inbox(f, () => rows, 1);
  const read = f.storage.readRssInboxProgress; let reads = 0;
  f.storage.readRssInboxProgress = async (...args) => { const progress = await read(...args); return ++reads > 1 ? { ...progress, revision: progress.revision + 1000 + reads } : progress; };
  await assert.rejects(f.service.reflect(), { code: 'rss_receive_conflict', contended: true });
  assert(reads <= 6, 'restarts are bounded');
});

test('repeated repair restarts without another tab saving give up as an ordinary failure', async t => {
  const f = fixture(); t.after(f.service.dispose);
  const rows = [0, 1, 2].map(minute => f.item({ identity: 'r' + minute, fetched_at: at(minute) }));
  inbox(f, () => rows, 1);
  const read = f.storage.readRssInboxProgress; let reads = 0;
  f.storage.readRssInboxProgress = async (...args) => { const progress = await read(...args); return ++reads > 1 ? { ...progress, needsRepair: true } : progress; };
  await assert.rejects(f.service.reflect(), error => error.code === 'rss_receive_conflict' && error.contended !== true);
  assert(reads <= 8, 'restarts are bounded');
});

test('a whole response that is not the inbox envelope is a temporary error; item data stays permanent', async () => {
  for (const data of ['<!doctype html><title>proxy</title>', null, { configured: true, connections: [], items: 'x' }, { configured: 'yes', connections: [], items: [] }]) {
    const f = fixture(); f.env.pageFor = () => data;
    await assert.rejects(f.service.list(), { code: 'rss_unexpected_response', message: Rss.messages.rss_unexpected_response });
    await assert.rejects(f.service.reflect(), { code: 'rss_unexpected_response' });
    assert.equal(f.commits, 0); assert.equal(f.env.progressWrites, 0);
  }
  const reordered = fixture(), a = reordered.item({ identity: 'a', fetched_at: '2026-11-05T02:00:00.000Z' }), b = reordered.item({ identity: 'b', fetched_at: '2026-11-05T01:00:00.000Z' });
  reordered.env.pageFor = () => ({ ...reordered.page, items: [a, b] });
  await assert.rejects(reordered.service.reflect(), { code: 'rss_unexpected_response' }); assert.equal(reordered.commits, 0);
  const item = fixture(); item.page.items = [item.item({ content_hash: '0'.repeat(64) })];
  await assert.rejects(item.service.reflect(), { code: 'rss_invalid_data' }); assert.equal(item.commits, 0);
});
