'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../assets/life/core.js'), Capture = require('../assets/life/naver-capture.js');
const Identity = require('../assets/life/naver-blog.js'), Media = require('../assets/life/naver-media.js');
const Receipt = require('../assets/life/naver-media-receipt.js'), Sync = require('../assets/life/naver-capture-sync.js');
const F = require('./fixtures/naver-media.cjs'), copy = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

async function fixture(t, options = {}) {
  const restore = F.installDecoder(); t.after(restore);
  const original = await F.fixture(), owner = { userId: F.OWNER, projectUrl: 'https://naver-continuity.invalid' };
  let bundle = Core.applyChanges(original.bundle, original.changes);
  const a = await Media.validate(original.attachment, { ownerId: owner.userId });
  // Same original text, a different capture/photo. Image decoding is the unit
  // fixture header decoder; real image/IndexedDB integration is tested separately.
  const changedBytes = new Uint8Array(F.bytes); changedBytes[changedBytes.length - 1] ^= 1;
  const b = copy(a); b.capture.id = Core.id();
  Object.assign(b.capture.payload.photos[0], { sha256: F.hash(changedBytes), storagePath: F.OWNER + '/naver/fixture_blog/123456789012/' + F.hash(changedBytes), caption: '다른 사진 판' });
  b.capture.capture_hash = await Capture.fingerprint(b.capture.payload);
  b.photos[0].blob = new Blob([changedBytes], { type: 'image/png' });
  const prepared = await Core.prepareImport(Capture.toImportInput(b.capture.payload, { existingSourceId: a.sourceId, existingSourceUrl: bundle.sources[0].url }), bundle, { forceNewVersion: true });
  b.sourceVersionId = prepared.version.id; bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared));
  const ws = bundle.workspaceId, descriptors = [a, b].map(value => Receipt.fromAttachment(ws, value));
  const captures = new Map([a, b].map(value => [value.capture.id, copy(value.capture)]));
  const blobs = new Map([a, b].map(value => [value.capture.payload.photos[0].storagePath, value.photos[0].blob]));
  const local = new Map(), pending = new Map(), remote = new Map(descriptors.map(value => [value.sourceVersionId, copy(value)]));
  const env = { current: true, writes: [], rpcs: [], downloads: [], signals: [], installs: [], commits: [], stages: 0, rpcHook: null, downloadHook: null, verifyHook: null, loseReply: false,
    state: { enabled: true, status: 'synced', outbox: null, conflict: null, binding: { ...owner, remoteId: ws }, remoteRevision: 4, syncedLocalRevision: bundle.revision } };
  const auth = { epoch: 1, user: { id: owner.userId }, getAccount: () => ({ ...owner, userId: auth.user?.id }), async verify() { if (env.verifyHook) await env.verifyHook(); return auth.user; }, client: {
    async rpc(name, args) {
      env.rpcs.push({ name, args: copy(args) }); if (env.rpcHook) await env.rpcHook(name, args);
      if (name === 'life_naver_media_receipt_find') {
        if (env.findError) return { error: env.findError };
        return { data: env.findResult === undefined ? [...remote.values()].filter(value => value.captureId === args.p_capture_id && value.captureHash === args.p_capture_hash).map(copy) : copy(env.findResult) };
      }
      if (name === 'life_naver_media_receipt_read') return { data: copy(remote.get(args.p_source_version_id) || null) };
      if (name === 'life_naver_capture_read') return { data: copy(captures.get(args.p_capture_id)) };
      if (name === 'life_naver_media_receipt_put') {
        const value = { workspaceId: args.p_workspace_id, sourceId: args.p_source_id, sourceVersionId: args.p_source_version_id, captureId: args.p_capture_id, captureHash: args.p_capture_hash };
        const previous = remote.get(value.sourceVersionId); if (previous) assert.deepEqual(previous, value, 'immutable fixture receipt');
        remote.set(value.sourceVersionId, copy(value)); env.writes.push(copy(value));
        if (env.loseReply) { env.loseReply = false; return { error: new Error('response lost after server stored') }; }
        return { data: env.putReply ? env.putReply(copy(value)) : value };
      }
      throw Error('Unexpected RPC ' + name);
    }, storage: { from(bucket) { assert.equal(bucket, 'haedo-naver-originals'); return { async download(path, _options, parameters) {
      env.downloads.push(path); env.signals.push(parameters?.signal || null); if (env.downloadHook) await env.downloadHook(path);
      return blobs.has(path) ? { data: blobs.get(path) } : { error: new Error('missing blob') };
    } }; } }
  } };
  const storage = { isAccountScoped: true, account: owner,
    async read(id) { assert.equal(id, ws); return copy(bundle); }, async getSyncState(id) { assert.equal(id, ws); return copy(env.state); },
    async readNaverCapture(id, versionId) { assert.equal(id, ws); return copy(local.get(versionId) || null); },
    async listNaverMediaReceipts(id, { pendingOnly = false } = {}) { assert.equal(id, ws); return [...pending.values()].filter(value => !pendingOnly || value.pending).map(copy); },
    async acknowledgeNaverMediaReceipt(id, value, options) { assert.equal(id, ws); assert.equal(options.isCurrent(), true); assert.deepEqual(pending.get(value.sourceVersionId)?.receipt, value); pending.set(value.sourceVersionId, { receipt: copy(value), pending: false }); },
    async stageNaverMediaReceipt(id, versionId, options) { env.stages++; assert.equal(id, ws); assert.equal(options.isCurrent(), true); const attachment = local.get(versionId); if (!attachment || attachment.localOnly) return null; const receipt = Receipt.fromAttachment(ws, attachment); if (!pending.has(versionId)) pending.set(versionId, { receipt, pending: true }); return copy(pending.get(versionId)); },
    async commitNaverCapture(request, options) {
      assert.equal(request.workspaceId, ws); assert.equal(request.baseRevision, bundle.revision); assert.equal(options.isCurrent(), true);
      const checked = await Media.validate(request.attachment, { ownerId: owner.userId });
      const next = Core.applyChanges(bundle, request.changes); Media.checkTarget(next, checked);
      const descriptor = Receipt.fromAttachment(ws, checked);
      assert.equal(options.isCurrent(), true); bundle = next; env.commits.push(copy(request)); local.set(checked.sourceVersionId, checked);
      pending.set(checked.sourceVersionId, { receipt: descriptor, pending: true }); return { status: 'stored' };
    },
    async installNaverCaptureForVersion(id, attachment, receipt, options) {
      assert.equal(id, ws); assert.equal(options.isCurrent(), true); Receipt.checkAttachment(receipt, attachment); Media.checkTarget(bundle, attachment);
      const checked = await Media.validate(attachment, { ownerId: owner.userId }); assert.equal(options.isCurrent(), true);
      env.installs.push(copy(receipt)); local.set(receipt.sourceVersionId, checked); pending.set(receipt.sourceVersionId, { receipt: copy(receipt), pending: false }); return { status: 'stored' };
    }
  };
  const service = Sync.create({ storage, auth, core: Core, model: Capture, identity: Identity, isCurrent: () => env.current, ...options }); t.after(() => service.dispose());
  return { env, auth, service, storage, ws, a, b, descriptors, captures, blobs, local, pending, remote, originalBundle: copy(bundle), changedBytes };
}

test('exact source versions with identical text restore their distinct capture bytes without replacing the original graph', async t => {
  const f = await fixture(t), before = copy(f.originalBundle);
  const first = await f.service.restoreForVersion(f.ws, f.a.sourceId, f.a.sourceVersionId);
  const second = await f.service.restoreForVersion(f.ws, f.b.sourceId, f.b.sourceVersionId);
  assert.equal(first.capture.payload.body, second.capture.payload.body); assert.notEqual(first.capture.capture_hash, second.capture.capture_hash);
  assert.deepEqual(new Uint8Array(await first.photos[0].blob.arrayBuffer()), F.bytes);
  assert.deepEqual(new Uint8Array(await second.photos[0].blob.arrayBuffer()), f.changedBytes);
  assert.deepEqual(f.env.installs, f.descriptors); assert.deepEqual(await f.storage.read(f.ws), before);
  const rpcs = f.env.rpcs.length, installs = f.env.installs.length;
  await f.service.restoreForVersion(f.ws, f.a.sourceId, f.a.sourceVersionId);
  assert.equal(f.env.rpcs.length, rpcs); assert.equal(f.env.installs.length, installs);
});

test('pending receipt publication requires exact same-owner source acknowledgement first', async t => {
  const f = await fixture(t); f.pending.set(f.a.sourceVersionId, { receipt: f.descriptors[0], pending: true });
  const good = copy(f.env.state);
  for (const patch of [{ enabled: false }, { status: 'pending' }, { outbox: {} }, { conflict: {} }, { remoteRevision: 0 },
    { syncedLocalRevision: good.syncedLocalRevision - 1 }, { binding: { ...good.binding, userId: Core.id() } }, { binding: { ...good.binding, remoteId: Core.id() } }]) {
    f.env.state = { ...copy(good), ...patch }; assert.deepEqual(await f.service.publishPending(f.ws), { status: 'pending', confirmed: 0 });
  }
  assert.deepEqual(f.env.rpcs, []); assert.equal(f.pending.get(f.a.sourceVersionId).pending, true);
  f.env.state = good; assert.deepEqual(await f.service.publishPending(f.ws), { status: 'confirmed', confirmed: 1 });
  assert.equal(f.pending.get(f.a.sourceVersionId).pending, false);
});

test('lost server reply retains the fixed pending descriptor and exact replay confirms it', async t => {
  const f = await fixture(t); f.remote.delete(f.a.sourceVersionId); f.pending.set(f.a.sourceVersionId, { receipt: f.descriptors[0], pending: true }); f.env.loseReply = true;
  await assert.rejects(f.service.publishPending(f.ws), { code: 'naver_network_error' });
  assert.deepEqual(f.remote.get(f.a.sourceVersionId), f.descriptors[0]); assert.equal(f.pending.get(f.a.sourceVersionId).pending, true);
  assert.deepEqual(await f.service.publishPending(f.ws), { status: 'confirmed', confirmed: 1 });
  assert.deepEqual(f.env.writes, [f.descriptors[0], f.descriptors[0]]); assert.equal(f.pending.get(f.a.sourceVersionId).pending, false);
  assert.deepEqual(await f.service.publishPending(f.ws), { status: 'confirmed', confirmed: 0 });
});

test('missing receipt is unconfirmed and never falls back to same text or the latest available capture', async t => {
  const f = await fixture(t); f.remote.delete(f.a.sourceVersionId);
  assert.equal(await f.service.restoreForVersion(f.ws, f.a.sourceId, f.a.sourceVersionId), null);
  assert.deepEqual(f.env.downloads, []); assert.deepEqual(f.env.installs, []);
  assert.deepEqual(f.env.rpcs.map(value => value.name), ['life_naver_media_receipt_read']);
});

test('wrong owner, receipt target, capture identity or capture hash fails before sidecar installation', async t => {
  for (const kind of ['owner', 'workspace', 'source', 'version', 'capture', 'hash']) {
    const f = await fixture(t);
    if (kind === 'owner') f.captures.get(f.a.capture.id).owner_id = Core.id();
    else {
      const value = copy(f.descriptors[0]);
      if (kind === 'workspace') value.workspaceId = Core.id();
      if (kind === 'source') value.sourceId = Core.id();
      if (kind === 'version') value.sourceVersionId = f.b.sourceVersionId;
      if (kind === 'capture') value.captureId = f.b.capture.id;
      if (kind === 'hash') value.captureHash = '0'.repeat(64);
      f.remote.set(f.a.sourceVersionId, value);
    }
    await assert.rejects(f.service.restoreForVersion(f.ws, f.a.sourceId, f.a.sourceVersionId));
    assert.deepEqual(f.env.installs, []); assert.equal(f.local.size, 0);
  }
});

test('missing or corrupt image download never installs partial sidecar or marks a receipt confirmed locally', async t => {
  for (const kind of ['missing', 'corrupt']) {
    const f = await fixture(t), path = f.a.capture.payload.photos[0].storagePath;
    if (kind === 'missing') f.blobs.delete(path); else f.blobs.set(path, new Blob([new Uint8Array(F.bytes.length)], { type: 'image/png' }));
    await assert.rejects(f.service.restoreForVersion(f.ws, f.a.sourceId, f.a.sourceVersionId));
    assert.deepEqual(f.env.installs, []); assert.equal(f.local.size, 0); assert.equal(f.pending.size, 0);
  }
});

test('account or screen transition while photo bytes are in flight cannot install the late sidecar', async t => {
  for (const kind of ['account', 'screen', 'dispose']) {
    const f = await fixture(t), entered = deferred(), hold = deferred();
    f.env.downloadHook = async () => { entered.resolve(); await hold.promise; };
    const operation = f.service.restoreForVersion(f.ws, f.a.sourceId, f.a.sourceVersionId);
    await entered.promise;
    if (kind === 'account') { f.auth.user = { id: Core.id() }; f.auth.epoch++; }
    else if (kind === 'screen') f.env.current = false; else f.service.dispose();
    hold.resolve(); await assert.rejects(operation, { code: 'naver_cancelled' });
    assert.deepEqual(f.env.installs, []); assert.equal(f.local.size, 0);
  }
});

test('a reader restore whose account check or capture read stops answering ends with a timeout, installs nothing and retry restores exact bytes', async t => {
  for (const kind of ['verify', 'rpc']) {
    const f = await fixture(t, { restoreRequestLimitMs: 40 }), hold = deferred(); let stalled = false;
    const stall = async () => { if (!stalled) { stalled = true; await hold.promise; } };
    if (kind === 'verify') { let calls = 0; f.env.verifyHook = async () => { if (++calls === 3) await stall(); }; }
    if (kind === 'rpc') f.env.rpcHook = async name => { if (name === 'life_naver_capture_read') await stall(); };
    await assert.rejects(f.service.restoreForVersion(f.ws, f.a.sourceId, f.a.sourceVersionId), { code: 'naver_timeout' }, kind);
    assert.equal(stalled, true, kind); assert.deepEqual(f.env.installs, []); assert.equal(f.local.size, 0); assert.equal(f.pending.size, 0);
    hold.resolve(); await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(f.env.installs, [], kind + ' late answer installs nothing');
    const restored = await f.service.restoreForVersion(f.ws, f.a.sourceId, f.a.sourceVersionId);
    assert.equal(restored.capture.capture_hash, f.a.capture.capture_hash);
    assert.deepEqual(new Uint8Array(await restored.photos[0].blob.arrayBuffer()), F.bytes);
    assert.deepEqual(f.env.installs, [f.descriptors[0]]);
  }
});

// The photo download limit grows with the recorded size: 30 s plus 64 KiB/s.
async function bigPhoto(f, size = 8 * 1024 * 1024) {
  const big = new Uint8Array(size); big.set(F.bytes);
  const capture = copy(f.captures.get(f.a.capture.id)), photo = capture.payload.photos[0], digest = F.hash(big);
  Object.assign(photo, { sha256: digest, bytes: big.length, storagePath: F.OWNER + '/naver/fixture_blog/123456789012/' + digest });
  capture.capture_hash = await Capture.fingerprint(capture.payload);
  f.captures.set(capture.id, capture); f.blobs.set(photo.storagePath, new Blob([big], { type: 'image/png' }));
  f.remote.set(f.a.sourceVersionId, { ...f.remote.get(f.a.sourceVersionId), captureHash: capture.capture_hash });
  return { big, capture };
}
// Lets real I/O and microtasks run (no mocked time passes) until the condition holds.
async function spin(condition) { for (let i = 0; i < 20000 && !condition(); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(condition(), 'condition reached'); }
// Drives mocked setTimeout while real I/O and microtasks get turns between ticks.
async function advance(t, operation, { step = 1000, until, wait = 30000 }) {
  let settled = null; operation.then(value => { settled = { value }; }, error => { settled = { error }; });
  for (let elapsed = 0; !settled && elapsed < until; elapsed += step) {
    for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(step);
  }
  // Then real time only (hashing, Blob reads): no mocked time passes here.
  const { performance } = require('node:perf_hooks'), deadline = performance.now() + wait;
  while (!settled && performance.now() < deadline) await new Promise(resolve => setImmediate(resolve));
  return settled;
}

test('the photo download limit grows with the recorded size instead of the fixed request limit', () => {
  assert.equal(Sync.downloadLimitMs(64 * 1024 * 1024), 30000 + 1024000, '64 MiB: about 17 minutes');
  assert.equal(Sync.downloadLimitMs(8 * 1024 * 1024), 30000 + 128000);
  assert.equal(Sync.downloadLimitMs(0), 30000);
});

test('a large photo arriving slowly within its size limit is restored, although it takes longer than the request limit', async t => {
  const f = await fixture(t), { big, capture } = await bigPhoto(f);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started = false; f.env.downloadHook = () => { started = true; return new Promise(resolve => setTimeout(resolve, 150000)); }; // 150 s > 45 s request limit, < 158 s
  const operation = f.service.restoreForVersion(f.ws, f.a.sourceId, f.a.sourceVersionId); await spin(() => started);
  const result = await advance(t, operation, { until: 170000 });
  assert.ok(result && !result.error, String(result?.error?.code || 'not settled'));
  assert.equal(result.value.capture.capture_hash, capture.capture_hash);
  assert.equal((await result.value.photos[0].blob.arrayBuffer()).byteLength, big.length);
  assert.equal(f.env.installs.length, 1);
});

test('a stalled photo download ends with a timeout only after its size limit, aborts and installs nothing', async t => {
  const f = await fixture(t); await bigPhoto(f);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started = false; f.env.downloadHook = () => { started = true; return new Promise(() => {}); };
  const operation = f.service.restoreForVersion(f.ws, f.a.sourceId, f.a.sourceVersionId); await spin(() => started);
  assert.equal(await advance(t, operation, { until: 157000, wait: 300 }), null, 'still waiting just before 158 s');
  const result = await advance(t, operation, { until: 3000 });
  assert.equal(result?.error?.code, 'naver_timeout');
  assert.equal(f.env.signals[0]?.aborted, true, 'expired photo download is aborted');
  assert.deepEqual(f.env.installs, []); assert.equal(f.local.size, 0); assert.equal(f.pending.size, 0);
});

test('capture review reads are not bounded by the reader restore limit', async t => {
  const f = await fixture(t, { restoreRequestLimitMs: 20 });
  f.env.downloadHook = () => new Promise(resolve => setTimeout(resolve, 60));
  const snapshot = await f.service.readCapture(f.ws, f.a.capture.id);
  assert.deepEqual(new Uint8Array(await snapshot.photos[0].blob.arrayBuffer()), F.bytes);
});

test('late receipt publication reply after account change leaves the durable local descriptor pending', async t => {
  const f = await fixture(t), entered = deferred(), hold = deferred();
  f.pending.set(f.a.sourceVersionId, { receipt: f.descriptors[0], pending: true });
  f.env.rpcHook = async name => { if (name === 'life_naver_media_receipt_put') { entered.resolve(); await hold.promise; } };
  const operation = f.service.publishPending(f.ws); await entered.promise;
  f.auth.user = { id: Core.id() }; f.auth.epoch++; hold.resolve();
  await assert.rejects(operation, { code: 'naver_cancelled' }); assert.equal(f.pending.get(f.a.sourceVersionId).pending, true);
});

test('legacy capture registration reuses the exact staged descriptor and local-only ZIP never uploads', async t => {
  const f = await fixture(t); f.local.set(f.a.sourceVersionId, f.a);
  assert.deepEqual(await f.service.registerForVersion(f.ws, f.a.sourceVersionId), { status: 'confirmed' });
  assert.deepEqual(f.env.writes, [f.descriptors[0]]);
  f.local.set(f.b.sourceVersionId, { ...f.b, localOnly: true });
  const requests = f.env.rpcs.length;
  assert.deepEqual(await f.service.registerForVersion(f.ws, f.b.sourceVersionId), { status: 'local_only' });
  assert.equal(f.env.rpcs.length, requests); assert.equal(f.pending.has(f.b.sourceVersionId), false);
});


test('a successful put reply with a changed descriptor cannot acknowledge another capture or version', async t => {
  for (const field of ['workspaceId', 'sourceId', 'sourceVersionId', 'captureId', 'captureHash']) {
    const f = await fixture(t); f.pending.set(f.a.sourceVersionId, { receipt: f.descriptors[0], pending: true });
    f.env.putReply = value => ({ ...value, [field]: field === 'captureHash' ? '0'.repeat(64) : Core.id() });
    await assert.rejects(f.service.publishPending(f.ws), { code: 'naver_invalid_data' });
    assert.deepEqual(f.pending.get(f.a.sourceVersionId), { receipt: f.descriptors[0], pending: true });
  }
});


test('capture receive finds its exact older remote mapping and installs only the missing sidecar; repeated receive adds no version', async t => {
  const f = await fixture(t), before = await f.storage.read(f.ws);
  assert.equal(before.sourceVersions.at(-1).id, f.b.sourceVersionId);
  const result = await f.service.receiveCapture(f.ws, f.a.capture.id);
  assert.deepEqual(result, { sourceId: f.a.sourceId, sourceVersionId: f.a.sourceVersionId, alreadyReceived: true, received: true });
  assert.deepEqual(f.env.installs, [f.descriptors[0]]); assert.deepEqual(f.env.commits, []);
  assert.deepEqual(await f.storage.read(f.ws), before);
  const repeated = await f.service.receiveCapture(f.ws, f.a.capture.id);
  assert.deepEqual(repeated, result); assert.equal(f.env.installs.length, 1); assert.equal(f.env.commits.length, 0);
});

test('capture receive refuses multiple exact-version matches and the bounded find sentinel before any graph write', async t => {
  for (const count of [2, 51]) {
    const f = await fixture(t); f.env.findResult = Array.from({ length: count }, (_, n) => ({ ...f.descriptors[0], sourceVersionId: n ? f.b.sourceVersionId : f.a.sourceVersionId }));
    await assert.rejects(f.service.receiveCapture(f.ws, f.a.capture.id), { code: 'naver_ambiguous' });
    assert.deepEqual(f.env.commits, []); assert.deepEqual(f.env.installs, []);
    assert.deepEqual(await f.storage.read(f.ws), f.originalBundle);
  }
});

test('find transport and permission failures never fall through to creating a new Core version', async t => {
  for (const error of [new Error('unavailable'), { status: 401, code: '42501' }]) {
    const f = await fixture(t); f.env.findError = error;
    await assert.rejects(f.service.receiveCapture(f.ws, f.a.capture.id), { code: error.status === 401 ? 'naver_auth_required' : 'naver_network_error' });
    assert.deepEqual(f.env.commits, []); assert.deepEqual(f.env.installs, []);
    assert.deepEqual(await f.storage.read(f.ws), f.originalBundle);
  }
});

test('missing find RPC preserves the legacy explicit new-version import without changing historical originals', async t => {
  const f = await fixture(t); f.env.findError = { code: '42883', message: 'function missing' };
  const result = await f.service.receiveCapture(f.ws, f.a.capture.id);
  assert.equal(result.alreadyReceived, false); assert.notEqual(result.sourceVersionId, f.a.sourceVersionId);
  assert.equal(f.env.commits.length, 1); assert.deepEqual(f.env.installs, []);
  const after = await f.storage.read(f.ws);
  assert.equal(after.sourceVersions.length, f.originalBundle.sourceVersions.length + 1);
  assert.deepEqual(after.sourceVersions.slice(0, -1), f.originalBundle.sourceVersions);
  assert.deepEqual(await f.service.receiveCapture(f.ws, f.a.capture.id), { ...result, alreadyReceived: true });
  assert.equal(f.env.commits.length, 1);
});

test('find mappings with wrong source, missing version, workspace, capture id or hash cannot install or create another original', async t => {
  for (const field of ['sourceId', 'sourceVersionId', 'workspaceId', 'captureId', 'captureHash']) {
    const f = await fixture(t); f.env.findResult = [{ ...f.descriptors[0], [field]: field === 'captureHash' ? '0'.repeat(64) : Core.id() }];
    await assert.rejects(f.service.receiveCapture(f.ws, f.a.capture.id));
    assert.deepEqual(f.env.commits, []); assert.deepEqual(f.env.installs, []);
    assert.deepEqual(await f.storage.read(f.ws), f.originalBundle);
  }
});

test('late exact-mapping lookup after screen or account change cannot install a sidecar or create a new version', async t => {
  for (const kind of ['screen', 'account']) {
    const f = await fixture(t), entered = deferred(), hold = deferred();
    f.env.rpcHook = async name => { if (name === 'life_naver_media_receipt_find') { entered.resolve(); await hold.promise; } };
    const operation = f.service.receiveCapture(f.ws, f.a.capture.id); await entered.promise;
    if (kind === 'screen') f.env.current = false; else { f.auth.epoch++; f.auth.user = { id: Core.id() }; }
    hold.resolve(); await assert.rejects(operation, { code: 'naver_cancelled' });
    assert.deepEqual(f.env.installs, []); assert.deepEqual(f.env.commits, []);
  }
});
