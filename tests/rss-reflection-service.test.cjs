'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../assets/life/core.js'), Rss = require('../assets/life/rss-connection.js');

function fixture(response) {
  const account = { projectUrl: 'https://rss-service.invalid', userId: Core.id() }, bundle = Core.createWorkspace();
  let calls = 0, clock = 0;
  const storage = { isAccountScoped: true, account, getActive: async () => bundle.workspaceId, read: async () => structuredClone(bundle),
    readRssInboxProgress: async () => ({ revision: 0, cursor: null, receipts: [], bundleRevision: bundle.revision, needsRepair: false }),
    saveRssInboxProgress: async () => { throw new Error('No item or ACK may be written on a failed request'); } };
  const auth = { epoch: 1, user: { id: account.userId }, getAccount: () => account, verify: async () => auth.user,
    onAccountChange: () => () => {}, client: { functions: { async invoke(name, { body }) {
      assert.equal(name, 'haedo-rss'); assert.equal(body.action, 'list'); calls++; return response(body);
    } } } };
  const host = new EventTarget(); host.document = new EventTarget(); host.document.visibilityState = 'visible'; host.navigator = { onLine: true };
  const service = Rss.createReflection({ storage, auth, core: Core, polling: false, host, now: () => clock });
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
  f.auth.verify = async () => {
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
  let verifications = 0; f.auth.verify = async () => { verifications++; return f.auth.user; };
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
