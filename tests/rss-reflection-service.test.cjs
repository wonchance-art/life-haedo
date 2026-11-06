'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Core = require('../assets/life/core.js'), Rss = require(process.env.RSS_CONNECTION_MODULE || '../assets/life/rss-connection.js');

function fixture(response, options = {}) {
  const account = { projectUrl: 'https://rss-service.invalid', userId: Core.id() }, bundle = Core.createWorkspace();
  let calls = 0, clock = 0;
  const storage = { isAccountScoped: true, account, getActive: async () => bundle.workspaceId, read: async () => structuredClone(bundle),
    readRssInboxProgress: async () => ({ revision: 0, cursor: null, receipts: [], bundleRevision: bundle.revision, needsRepair: false }),
    saveRssInboxProgress: async () => { throw new Error('No item or ACK may be written on a failed request'); } };
  const auth = { epoch: 1, user: { id: account.userId }, getAccount: () => account, verify: async () => auth.user,
    get session() { return { access_token: 'synthetic-service-token', user: auth.user }; },
    onAccountChange: () => () => {}, client: { supabaseKey: 'synthetic-public-service-key', auth: {
      getSession: async () => ({ data: { session: { access_token: 'synthetic-service-token', user: auth.user } }, error: null }),
      getUser: async token => { assert.equal(token, 'synthetic-service-token'); return { data: { user: auth.user }, error: null }; }
    }, functions: { async invoke(name, { body }) {
      assert.equal(name, 'haedo-rss'); assert.equal(body.action, 'list'); calls++; return response(body);
    } } } };
  const host = new EventTarget(); host.document = new EventTarget(); host.document.visibilityState = 'visible'; host.navigator = { onLine: true };
  const clientFactory = (projectUrl, key, options) => {
    assert.equal(projectUrl, account.projectUrl); assert.equal(key, 'synthetic-public-service-key');
    assert.equal(options.auth.persistSession, false); assert.equal(options.auth.autoRefreshToken, false); assert.equal(options.auth.detectSessionInUrl, false);
    assert.match(options.auth.storageKey, /^haedo-rss-verifier-\d+$/); assert.equal(typeof options.auth.storage.getItem, 'function');
    return { auth: { getUser: token => auth.client.auth.getUser(token) } };
  };
  const service = Rss.createReflection({ storage, auth, core: Core, polling: false, host, now: () => clock, clientFactory, ...options });
  return { service, auth, storage, host, workspaceId: bundle.workspaceId, calls: () => calls, advance: (milliseconds = 60000) => { clock += milliseconds; } };
}

for (const reason of ['undeployed function', 'known setup response']) {
  test(`${reason} parks automatic reflection after one list and permits an explicit connection wake`, async t => {
    const f = fixture(() => reason === 'undeployed function'
      ? { error: { context: { status: 404, json: async () => ({ code: 'NOT_FOUND', message: 'Requested function was not found' }) } } }
      : { data: { error: 'setup_required' } });
    t.after(f.service.dispose);
    const status = await f.service.syncNow();
    assert.equal(status.state, 'stopped'); assert.equal(status.receiveError, Rss.messages.rss_setup_required);
    assert.equal(f.calls(), 1);
    await f.service.syncNow(); await f.service.syncNow(); assert.equal(f.calls(), 1, 'ordinary ticks stay parked');
    await f.service.syncNow(f.workspaceId); assert.equal(f.calls(), 2, 'an explicit new connection can retry setup');
  });
}

for (const reason of ['ordinary network failure', 'unrelated 404']) {
  test(`${reason} remains retryable and is not mislabeled as an undeployed RSS service`, async t => {
    const f = fixture(() => reason === 'ordinary network failure' ? { error: { message: 'private network diagnostic' } }
      : { error: { context: { status: 404, json: async () => ({ error: 'unknown_resource', message: 'Requested function was not found' }) } } });
    t.after(f.service.dispose);
    const status = await f.service.syncNow();
    assert.equal(status.state, 'error'); assert.equal(status.receiveError, Rss.messages.rss_network_error);
    await f.service.syncNow(); assert.equal(f.calls(), 1, 'an early tick does not retry');
    f.advance(); await f.service.syncNow(); assert.equal(f.calls(), 2);
  });
}

test('one targeted wake with a failed account verification does not retry itself without another event', async t => {
  const f = fixture(() => ({ data: { error: 'setup_required' } })); t.after(f.service.dispose);
  let verifications = 0;
  f.auth.client.auth.getUser = async () => {
    verifications++;
    // Bound a broken immediate retry loop so the regression fails rather than
    // starving the test runner's timer forever.
    if (verifications === 4) f.auth.epoch++;
    throw new Error('synthetic offline verification');
  };
  await f.service.syncNow(f.workspaceId);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(verifications, 1); assert.equal(f.calls(), 0); assert.equal(f.service.getStatus().state, 'error');
  await f.service.syncNow(); assert.equal(verifications, 1, 'an early tick does not retry');
  f.advance(); await f.service.syncNow(); assert.equal(verifications, 2, 'the next ordinary tick can retry');
});

function connectedPage(workspaceId, overrides = {}) {
  return { configured: true, connections: [{ id: '10000000-0000-4000-8000-000000000001', workspace_id: workspaceId,
    feed_url: 'https://feed.example.invalid/rss', status: 'active', revision: 1, baseline_count: 0 }],
    items: [], has_more: false, next_cursor: null, ...overrides };
}

test('a verified same-owner page-ready resumes after Auth advances its epoch, while a different owner cannot resume it', async t => {
  const f = fixture(body => ({ data: connectedPage(body.workspaceId) })); t.after(f.service.dispose);
  f.service.start(); await f.service.syncNow(); assert.equal(f.calls(), 1);
  f.host.document.dispatchEvent(new Event('haedo:page-suspend')); f.auth.epoch++;
  await f.service.syncNow(); assert.equal(f.calls(), 1);
  f.host.document.dispatchEvent(new Event('haedo:page-ready')); await f.service.syncNow();
  assert.equal(f.calls(), 2); assert.equal(f.service.getStatus().state, 'idle');
  f.host.document.dispatchEvent(new Event('haedo:page-suspend')); f.auth.epoch++; f.auth.user = { id: Core.id() };
  f.host.document.dispatchEvent(new Event('haedo:page-ready')); await f.service.syncNow(); assert.equal(f.calls(), 2);
});

test('a disabled collector can receive its other owned workspace once before parking', async t => {
  const elsewhere = Core.id(); let f;
  f = fixture(body => ({ data: connectedPage(body.workspaceId, body.workspaceId === elsewhere
    ? { configured: false }
    : { configured: false, connections: [], other_connections: connectedPage(elsewhere).connections }) }));
  t.after(f.service.dispose);
  const reads = [], originalRead = f.storage.read;
  f.storage.read = async workspaceId => { reads.push(workspaceId); return { ...await originalRead(), workspaceId }; };
  const status = await f.service.syncNow(); assert.equal(status.state, 'stopped');
  assert.equal(f.calls(), 2); assert(reads.includes(elsewhere), 'owned store verifies the target before requesting its items');
  await f.service.syncNow(); assert.equal(f.calls(), 2);
});

test('an account with no RSS connection performs one discovery list and parks', async t => {
  const f = fixture(() => ({ data: { configured: true, connections: [], items: [], has_more: false, next_cursor: null } })); t.after(f.service.dispose);
  await f.service.syncNow(); await f.service.syncNow();
  assert.equal(f.calls(), 1); assert.equal(f.service.getStatus().state, 'stopped');
});

test('focus and online bursts after a transient failure wait a full polling interval before one retry', async t => {
  const f = fixture(() => ({ error: { message: 'synthetic offline request' } })); t.after(f.service.dispose);
  let verifications = 0; f.auth.client.auth.getUser = async () => { verifications++; return { data: { user: f.auth.user }, error: null }; };
  f.service.start(); await f.service.syncNow();
  assert.equal(f.calls(), 1); assert.equal(verifications, 1);
  for (let index = 0; index < 10; index++) {
    f.host.dispatchEvent(new Event('focus')); f.host.dispatchEvent(new Event('online'));
    f.host.document.dispatchEvent(new Event('visibilitychange'));
  }
  await f.service.syncNow(); assert.equal(f.calls(), 1); assert.equal(verifications, 1);
  f.advance(59999); f.host.dispatchEvent(new Event('online')); await f.service.syncNow(); assert.equal(f.calls(), 1);
  f.advance(1); f.host.dispatchEvent(new Event('online')); await f.service.syncNow();
  assert.equal(f.calls(), 2); assert.equal(verifications, 2);
  // A new connection is an explicit wake and can retry without waiting again.
  await f.service.syncNow(f.workspaceId); assert.equal(f.calls(), 3); assert.equal(verifications, 3);
});

test('a response that fails after startup still retries at the next polling boundary', async t => {
  let f;
  f = fixture(() => { f.advance(10000); return { error: { message: 'synthetic delayed failure' } }; }); t.after(f.service.dispose);
  f.service.start(); await f.service.syncNow(); assert.equal(f.calls(), 1);
  f.advance(49999); await f.service.syncNow(); assert.equal(f.calls(), 1);
  f.advance(1); await f.service.syncNow(); assert.equal(f.calls(), 2, 'the next scheduled minute must not be skipped because the reply was slow');
});

test('only disconnected connections drain once then park until an explicit registration wake', async t => {
  const f = fixture(body => ({ data: connectedPage(body.workspaceId, { connections: connectedPage(body.workspaceId).connections.map(connection => ({ ...connection, status: 'disconnected' })) }) }));
  t.after(f.service.dispose);
  await f.service.syncNow(); assert.equal(f.calls(), 1); assert.equal(f.service.getStatus().state, 'stopped');
  f.advance(); await f.service.syncNow(); assert.equal(f.calls(), 1);
  await f.service.syncNow(f.workspaceId); assert.equal(f.calls(), 2);
});

test('a disconnected inbox retries an unfinished transient receive next minute and parks only after draining it', async t => {
  let row;
  const f = fixture(body => ({ data: connectedPage(body.workspaceId, {
    connections: connectedPage(body.workspaceId).connections.map(connection => ({ ...connection, status: 'disconnected' })), items: [row]
  }) })); t.after(f.service.dispose);
  let bundle = await f.storage.read(), attempts = 0, progress = { revision: 0, cursor: null, receipts: [], needsRepair: false };
  const text = '연결 종료 전 수집해 둔 원문을 다시 보관한다.\r\n🌱';
  row = { id: Core.id(), owner_id: f.storage.account.userId, connection_id: '10000000-0000-4000-8000-000000000001',
    identity: 'disconnected:unfinished', title: '보관을 마치지 못한 글', url: null, content_text: text,
    content_hash: createHash('sha256').update(text).digest('hex'), published_at: '2026-11-05T01:00:00.000Z', fetched_at: '2026-11-05T02:00:00.000Z', disposition: 'stored' };
  f.storage.read = async () => structuredClone(bundle);
  f.storage.readRssInboxProgress = async () => ({ ...structuredClone(progress), bundleRevision: bundle.revision });
  f.storage.commitLocal = async (request, options) => {
    assert.equal(options.isCurrent(), true); attempts++;
    if (attempts === 1) throw { code: 'rss_receive_conflict' };
    assert.equal(request.baseRevision, bundle.revision); bundle = Core.applyChanges(bundle, request.changes);
    return { status: 'stored', revision: bundle.revision };
  };
  f.storage.saveRssInboxProgress = async (_id, input, revision, options) => {
    assert.equal(options.isCurrent(), true); assert.equal(revision, progress.revision); assert.equal(options.expectedBundleRevision, bundle.revision);
    progress = { ...structuredClone(input), revision: revision + 1, needsRepair: false }; return { status: 'stored', ...structuredClone(progress) };
  };
  const failed = await f.service.syncNow(); assert.equal(failed.state, 'error'); assert.equal(failed.receiveErrorCode, 'rss_receive_conflict');
  assert.equal(f.calls(), 1); assert.equal(attempts, 1); assert.equal(bundle.sourceVersions.length, 0);
  f.advance(); const completed = await f.service.syncNow();
  assert.equal(completed.state, 'stopped'); assert.equal(completed.receiveError, null); assert.equal(f.calls(), 2); assert.equal(attempts, 2);
  assert.equal(bundle.sourceVersions[0].contentText, text); assert.equal(progress.receipts.length, 1);
  f.advance(); await f.service.syncNow(); assert.equal(f.calls(), 2); assert.equal(attempts, 2);
});

test('permanent item rejection exposes a safe blocked state and does not poll past it', async t => {
  const f = fixture(() => ({ data: { error: 'rss_invalid_item', detail: 'private rejected payload' } })); t.after(f.service.dispose);
  const result = await f.service.syncNow();
  assert.equal(result.state, 'blocked'); assert.equal(result.receiveErrorCode, 'rss_invalid_item');
  assert.equal(result.receiveError, Rss.messages.rss_invalid_item); assert.equal(result.blockedItemId, null);
  assert.doesNotMatch(JSON.stringify(result), /private rejected/);
  f.advance(); await f.service.syncNow(); assert.equal(f.calls(), 1);
  await f.service.syncNow(f.workspaceId); assert.equal(f.calls(), 2);
});

test('current terminal states notify once and a successful explicit retry clears blocked details', async t => {
  const states = []; let blocked = true;
  const f = fixture(body => blocked ? { data: { error: 'rss_invalid_item' } } : { data: connectedPage(body.workspaceId) }, { onStatus: value => states.push(value) });
  t.after(f.service.dispose);
  await f.service.syncNow(); assert.equal(states.length, 1); assert.equal(states[0].state, 'blocked'); assert.equal(states[0].blockedItemTitle, null);
  f.advance(); await f.service.syncNow(); assert.equal(states.length, 1, 'parked ticks do not republish the same failure');
  blocked = false; await f.service.syncNow(f.workspaceId);
  assert.equal(states.length, 2); assert.equal(states[1].state, 'idle'); assert.equal(states[1].receiveErrorCode, null); assert.equal(states[1].blockedItemTitle, null);
});

test('a status consumer throwing or rejecting does not change a completed collection or trigger a retry', async t => {
  for (const failure of ['throw', 'reject']) await t.test(failure, async t => {
    let callbacks = 0;
    const f = fixture(body => ({ data: connectedPage(body.workspaceId) }), { onStatus() {
      callbacks++; if (failure === 'throw') throw new Error('synthetic status consumer');
      return Promise.reject(new Error('synthetic async consumer'));
    } }); t.after(f.service.dispose);
    const result = await f.service.syncNow(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(result.state, 'idle'); assert.equal(callbacks, 1); assert.equal(f.calls(), 1);
  });
});

test('late success and failure cannot publish status after suspension, disposal, account or token change', async t => {
  for (const result of ['success', 'failure']) for (const boundary of ['suspend', 'dispose', 'account', 'token']) await t.test(result + ' after ' + boundary, async t => {
    let release, entered = false; const states = [], held = new Promise(resolve => { release = resolve; });
    const f = fixture(async body => { entered = true; await held; return result === 'success' ? { data: connectedPage(body.workspaceId) } : { data: { error: 'rss_invalid_item' } }; },
      { onStatus: value => states.push(value) }); t.after(f.service.dispose); t.after(release);
    f.service.start(); const pending = f.service.syncNow();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(entered, true);
    if (boundary === 'suspend') f.host.document.dispatchEvent(new Event('haedo:page-suspend'));
    if (boundary === 'dispose') f.service.dispose();
    if (boundary === 'account') { f.auth.epoch++; f.auth.user = { id: Core.id() }; }
    if (boundary === 'token') Object.defineProperty(f.auth, 'session', { get: () => ({ access_token: 'synthetic-replacement-token', user: f.auth.user }) });
    release(); await pending; assert.deepEqual(states, []);
  });
});
