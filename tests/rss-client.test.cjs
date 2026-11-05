'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Core = require('../assets/life/core.js');
const Rss = require('../assets/life/rss-connection.js');
const owner = { userId: '10000000-0000-4000-8000-000000000001', projectUrl: 'https://rss-fixture.invalid' };
const sha = text => createHash('sha256').update(text).digest('hex');
function fixture() {
  let bundle = Core.createWorkspace(), commits = 0, notify = () => {};
  const env = { current: true, held: null, conflict: false, requests: [], beforeCommit: null };
  const conn = { id: Core.id(), workspace_id: bundle.workspaceId, feed_url: 'https://feed.example.test/rss', status: 'active', revision: 1,
    baseline_count: 4, baseline_at: '2026-11-05T00:00:00.000Z' };
  const page = { configured: true, connections: [conn], items: [], has_more: false, next_cursor: null };
  const auth = { epoch: 1, user: { id: owner.userId }, getAccount: () => ({ ...owner }), async verify() { return auth.user; },
    onAccountChange(fn) { notify = fn; return () => { notify = () => {}; }; },
    client: { functions: { async invoke(name, options) {
      assert.equal(name, 'haedo-rss'); env.requests.push(options.body);
      if (env.held) await env.held;
      return { data: structuredClone(env.pageFor ? env.pageFor(options.body) : page) };
    } } } };
  const storage = { isAccountScoped: true, account: owner, async read() { return structuredClone(bundle); },
    async commitLocal(request, options) {
      env.beforeCommit?.();
      if (!options.isCurrent()) throw { code: 'rss_cancelled' };
      if (env.conflict) { env.conflict = false; return { status: 'conflict' }; }
      if (request.baseRevision !== bundle.revision) return { status: 'conflict' };
      bundle = Core.applyChanges(bundle, request.changes); commits++; return { status: 'stored' };
    } };
  const service = Rss.create({ storage, auth, core: Core, workspaceId: bundle.workspaceId, isCurrent: () => env.current });
  function item(overrides = {}) {
    const body = '\ufeff피드 원문 🌱\r\n<img src="https://invalid.test/private">';
    return { id: Core.id(), owner_id: owner.userId, connection_id: conn.id, identity: 'guid:one', title: 'RSS 글', url: 'https://feed.example.test/one',
      content_text: body, content_hash: sha(body), published_at: '2026-11-05T01:00:00.000Z', fetched_at: '2026-11-05T02:00:00.000Z', disposition: 'stored', reason: null, ...overrides };
  }
  return { env, page, conn, auth, storage, service, item, notify: () => notify(), get bundle() { return structuredClone(bundle); }, get commits() { return commits; },
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
test('connection history and automatic pagination project the 101st item without clicking more', async () => {
  const f = fixture(); f.page.connections.push({ ...f.conn, id: Core.id(), status: 'disconnected' });
  f.page.items = Array.from({ length: 100 }, (_, index) => f.item({ identity: 'guid:' + index })); f.page.has_more = true;
  f.page.next_cursor = { fetched_at: f.page.items[99].fetched_at, id: f.page.items[99].id, privateField: 'must-not-send' };
  const later = { ...f.page, items: [f.item({ identity: 'guid:later' })], has_more: false, next_cursor: null };
  f.env.pageFor = request => request.before ? later : f.page;
  const progress = []; const first = await f.service.list(count => progress.push(count));
  assert.equal(first.hasMore, true); assert.equal(first.items.length, 100); assert.equal(first.checkedItems, 101);
  assert.equal(f.bundle.sources.length, 101); assert.deepEqual(progress, [100]);
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
