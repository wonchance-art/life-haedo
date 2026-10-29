'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../assets/life/core.js'), Capture = require('../assets/life/naver-capture.js');
const Reference = require('../assets/life/naver-capture-reference.js'), Media = require('../assets/life/naver-media.js');
const Identity = require('../assets/life/naver-blog.js'), Sync = require('../assets/life/naver-capture-sync.js');
const F = require('./fixtures/naver-media.cjs');
const clone = value => structuredClone(value);
const owner = { userId: F.OWNER, projectUrl: 'https://capture-recovery.invalid' };
const decodedTests = new WeakSet();
function gate() {
  let enter, release;
  return { entered: new Promise(resolve => { enter = resolve; }), waiting: new Promise(resolve => { release = resolve; }), enter, release };
}
async function fixture(t, { referenced = true, local = false } = {}) {
  if (!decodedTests.has(t)) { decodedTests.add(t); t.after(F.installDecoder()); }
  const initial = await F.fixture(), quote = '그대로 보관한 구절', start = initial.payload.body.indexOf(quote);
  let bundle = Core.applyChanges(initial.bundle, Core.buildImportChanges(initial.bundle, initial.prepared, [{ start, end: start + quote.length, note: '공개하지 않는 인용 메모' }]));
  const newer = await Core.prepareImport({ ...Capture.toImportInput(initial.payload, { existingSourceId: initial.attachment.sourceId }),
    text: '다른 최신 판은 복구 대상으로 추정하지 않는다.', title: '현재 제목' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, newer));
  const target = { sourceId: initial.attachment.sourceId, sourceVersionId: initial.attachment.sourceVersionId,
    expectedCaptureHash: initial.attachment.capture.capture_hash };
  const pointer = { sourceVersionId: target.sourceVersionId, blogId: initial.payload.blogId, logNo: initial.payload.logNo, captureHash: target.expectedCaptureHash };
  const link = () => Reference.create(pointer, { id: Core.id(), createdAt: '2026-10-27T00:00:00.000Z' });
  if (referenced) bundle = Core.applyChanges(bundle, { put: { links: [link()] } });
  let installed = local ? clone(initial.attachment) : null, writes = 0, remembered = 0;
  const env = { current: true, account: clone(owner), selectRows: [clone(initial.attachment.capture)], rpcRow: clone(initial.attachment.capture),
    selectGate: null, downloadGate: null, selectError: null, downloadError: null, blob: null, commitError: null, commitHook: null };
  const selects = [], downloads = [], rpcs = [], callbacks = new Set();
  const auth = { epoch: 1, user: { id: owner.userId }, getAccount: () => clone(env.account), async verify() { return auth.user; },
    onAccountChange(callback) { callbacks.add(callback); return () => callbacks.delete(callback); }, client: {
      from(table) {
        const row = { table, filters: {}, columns: null, limit: null, signal: null };
        const query = { select(columns) { row.columns = columns; return query; }, eq(name, value) { assert.equal(Object.hasOwn(row.filters, name), false); row.filters[name] = value; return query; },
          limit(value) { row.limit = value; return query; }, abortSignal(signal) { row.signal = signal; return query; },
          then(resolve, reject) { return (async () => {
            selects.push(row); assert.equal(table, 'life_naver_captures');
            assert.equal(row.columns, 'id,owner_id,blog_id,log_no,capture_hash,created_at,payload'); assert.equal(row.limit, 2);
            assert.deepEqual(row.filters, { owner_id: owner.userId, blog_id: pointer.blogId, log_no: pointer.logNo, capture_hash: pointer.captureHash });
            if (env.selectGate) { const hold = env.selectGate; hold.enter(); await hold.waiting; }
            return { data: clone(env.selectRows), error: env.selectError };
          })().then(resolve, reject); } };
        return query;
      },
      rpc(name, args) {
        rpcs.push({ name, args: clone(args) }); assert.equal(name, 'life_naver_capture_read');
        assert.deepEqual(Object.keys(args), ['p_capture_id']);
        return Promise.resolve({ data: clone(env.rpcRow), error: null });
      },
      storage: { from(bucket) { assert.equal(bucket, 'haedo-naver-originals'); return { async download(path, options, init) {
        assert.deepEqual(options, {}); assert(init.signal instanceof AbortSignal);
        downloads.push({ path, signal: init.signal });
        if (env.downloadGate) { const hold = env.downloadGate; hold.enter(); await hold.waiting; }
        return { data: env.blob || initial.attachment.photos[0].blob, error: env.downloadError };
      } }; } }
    } };
  const storage = { isAccountScoped: true, account: clone(owner), async read(ws) { assert.equal(ws, bundle.workspaceId); return clone(bundle); },
    async readNaverCapture(ws, versionId) { assert.equal(ws, bundle.workspaceId); assert.equal(versionId, target.sourceVersionId); return clone(installed); },
    async restoreNaverCapturePhotos(input, options) {
      if (env.commitHook) await env.commitHook();
      if (!options.isCurrent()) return { status: 'rejected', error: { code: 'request_cancelled' } };
      if (env.commitError) return { status: 'rejected', error: env.commitError };
      assert.equal(input.workspaceId, bundle.workspaceId); assert.equal(input.sourceId, target.sourceId); assert.equal(input.sourceVersionId, target.sourceVersionId);
      assert.deepEqual(input.expectedReference, pointer); assert.deepEqual(Reference.get(bundle, target.sourceId, target.sourceVersionId).reference, pointer);
      assert.equal(Media.checkTarget(bundle, input.attachment), true);
      if (installed && installed.capture.capture_hash !== input.attachment.capture.capture_hash) return { status: 'conflict' };
      const alreadyReceived = !!installed; if (!installed) { installed = clone(input.attachment); writes++; }
      return { status: 'stored', sourceId: target.sourceId, sourceVersionId: target.sourceVersionId, revision: bundle.revision, alreadyReceived };
    },
    async rememberNaverCaptureReference(input, options) {
      if (env.commitHook) await env.commitHook();
      if (!options.isCurrent()) return { status: 'rejected', error: { code: 'request_cancelled' } };
      if (env.commitError) return { status: 'rejected', error: env.commitError };
      assert.equal(input.expectedCaptureHash, target.expectedCaptureHash); assert.equal(input.expectedCaptureId, initial.attachment.capture.id);
      assert.equal(typeof input.operationId, 'string');
      const alreadyRemembered = !!Reference.get(bundle, target.sourceId, target.sourceVersionId);
      if (!alreadyRemembered) { bundle = Core.applyChanges(bundle, { put: { links: [link()] } }); remembered++; }
      return { status: 'stored', sourceId: target.sourceId, sourceVersionId: target.sourceVersionId, revision: bundle.revision, alreadyRemembered };
    } };
  const service = Sync.create({ storage, auth, core: Core, model: Capture, identity: Identity, reference: Reference, media: Media, isCurrent: () => env.current });
  t.after(() => service.dispose());
  return { env, auth, storage, service, target, pointer, initial, selects, downloads, rpcs,
    get bundle() { return clone(bundle); }, get installed() { return clone(installed); }, get writes() { return writes; }, get remembered() { return remembered; },
    mutate(action) { action(bundle); }, setInstalled(value) { installed = clone(value); },
    accountChange(next) { env.account = next; auth.user = { id: next.userId }; for (const callback of callbacks) callback(); } };
}

test('exact old-version recovery deduplicates concurrent requests and leaves every source, quote and revision untouched', async t => {
  const f = await fixture(t), before = f.bundle;
  const a = f.service.restoreSourcePhotos(before.workspaceId, f.target), b = f.service.restoreSourcePhotos(before.workspaceId, f.target);
  const results = await Promise.all([a, b]); assert.deepEqual(results[0], results[1]);
  assert.equal(f.selects.length, 1); assert.equal(f.downloads.length, 1); assert.equal(f.writes, 1);
  assert.notEqual(before.sourceVersions.at(-1).id, f.target.sourceVersionId); assert.deepEqual(f.bundle, before);
  assert.equal(f.installed.sourceVersionId, f.target.sourceVersionId);
  assert.deepEqual(new Uint8Array(await f.installed.photos[0].blob.arrayBuffer()), F.bytes);
  assert.equal(f.rpcs.length, 0); assert.equal(results[0].revision, before.revision);
  assert.equal((await f.service.restoreSourcePhotos(before.workspaceId, f.target)).alreadyReceived, true);
  assert.equal(f.writes, 1); assert.deepEqual(f.bundle, before);
});

test('missing pointer and changed rendered hash fail before any lookup or download', async t => {
  const f = await fixture(t, { referenced: false });
  await assert.rejects(f.service.restoreSourcePhotos(f.bundle.workspaceId, f.target), { code: 'naver_photo_reference_missing' });
  assert.equal(f.selects.length, 0); assert.equal(f.downloads.length, 0); assert.equal(f.writes, 0);
  const g = await fixture(t);
  await assert.rejects(g.service.restoreSourcePhotos(g.bundle.workspaceId, { ...g.target, expectedCaptureHash: '0'.repeat(64) }), { code: 'naver_conflict' });
  assert.equal(g.selects.length, 0); assert.equal(g.writes, 0);
});

test('empty, duplicate, foreign-owner and same-text different-photo-set rows never reach photo download', async t => {
  for (const kind of ['missing', 'duplicate', 'foreign', 'different-photo-set', 'extra-field']) {
    const f = await fixture(t), row = clone(f.initial.attachment.capture), before = f.bundle;
    if (kind === 'missing') f.env.selectRows = [];
    if (kind === 'duplicate') f.env.selectRows = [row, row];
    if (kind === 'foreign') { row.owner_id = Core.id(); row.payload.photos[0].storagePath = row.payload.photos[0].storagePath.replace(F.OWNER, row.owner_id); f.env.selectRows = [row]; }
    if (kind === 'different-photo-set') { row.payload.photos[0].caption = '같은 본문이지만 다른 사진 묶음'; row.capture_hash = await Capture.fingerprint(row.payload); f.env.selectRows = [row]; }
    if (kind === 'extra-field') f.env.selectRows = [{ ...row, extra: 'must reject' }];
    await assert.rejects(f.service.restoreSourcePhotos(before.workspaceId, f.target), { code: kind === 'missing' ? 'naver_photo_unavailable' : 'naver_invalid_data' });
    assert.equal(f.downloads.length, 0); assert.equal(f.writes, 0); assert.deepEqual(f.bundle, before);
    f.service.dispose();
  }
});

test('a wrong-body capture is rejected before downloading even when its pointer declares that valid hash', async t => {
  const f = await fixture(t), row = clone(f.initial.attachment.capture);
  row.payload.body += ' 다름'; row.payload.bodyHash = F.hash(row.payload.body); row.capture_hash = await Capture.fingerprint(row.payload);
  f.env.selectRows = [row]; f.pointer.captureHash = row.capture_hash; f.target.expectedCaptureHash = row.capture_hash;
  f.mutate(bundle => { const marker = bundle.links.find(link => link.kind === Reference.KIND); const note = JSON.parse(marker.note); note.captureHash = row.capture_hash; marker.note = JSON.stringify(note); });
  await assert.rejects(f.service.restoreSourcePhotos(f.bundle.workspaceId, f.target), { code: 'naver_invalid_data' });
  assert.equal(f.downloads.length, 0); assert.equal(f.writes, 0);
});

test('download failures and byte corruption cannot install partial media or change the source graph', async t => {
  for (const kind of ['http', 'bytes']) {
    const f = await fixture(t), before = f.bundle;
    if (kind === 'http') f.env.downloadError = { status: 500, message: 'synthetic failure' };
    else { const bytes = Uint8Array.from(F.bytes); bytes[bytes.length - 1] ^= 1; f.env.blob = new Blob([bytes], { type: 'image/png' }); }
    await assert.rejects(f.service.restoreSourcePhotos(before.workspaceId, f.target), { code: kind === 'http' ? 'naver_network_error' : 'naver_invalid_data' });
    assert.equal(f.writes, 0); assert.equal(f.installed, null); assert.deepEqual(f.bundle, before); f.service.dispose();
  }
});

test('late exact-query replies after account, project, epoch or screen changes cannot download or install', async t => {
  for (const kind of ['account', 'project', 'epoch', 'screen', 'dispose']) {
    const f = await fixture(t), hold = gate(); f.env.selectGate = hold;
    const pending = f.service.restoreSourcePhotos(f.bundle.workspaceId, f.target); await hold.entered;
    if (kind === 'account') f.accountChange({ ...owner, userId: Core.id() });
    if (kind === 'project') f.accountChange({ ...owner, projectUrl: 'https://other-project.invalid' });
    if (kind === 'epoch') f.auth.epoch++;
    if (kind === 'screen') f.env.current = false;
    if (kind === 'dispose') f.service.dispose();
    hold.release(); await assert.rejects(pending, { code: 'naver_cancelled' });
    if (['account', 'project', 'dispose'].includes(kind)) assert.equal(f.selects[0].signal.aborted, true);
    assert.equal(f.downloads.length, 0); assert.equal(f.writes, 0); f.service.dispose();
  }
});

test('disposing a source reader aborts the private photo request and rejects even an ignored-abort late body', async t => {
  const f = await fixture(t), hold = gate(), before = f.bundle; f.env.downloadGate = hold;
  const pending = f.service.restoreSourcePhotos(before.workspaceId, f.target); await hold.entered;
  f.service.dispose(); assert.equal(f.downloads[0].signal.aborted, true); hold.release();
  await assert.rejects(pending, { code: 'naver_cancelled' }); assert.equal(f.writes, 0); assert.deepEqual(f.bundle, before);
});

test('trash or replaced pointer during a photo transfer is rechecked before installation', async t => {
  for (const kind of ['trash', 'pointer']) {
    const f = await fixture(t), hold = gate(); f.env.downloadGate = hold;
    const pending = f.service.restoreSourcePhotos(f.bundle.workspaceId, f.target); await hold.entered;
    f.mutate(bundle => {
      if (kind === 'trash') Object.assign(bundle, Core.applyChanges(bundle, Core.buildSourceStateChanges(bundle, f.target.sourceId, 'trash')));
      else { const marker = bundle.links.find(link => link.kind === Reference.KIND), note = JSON.parse(marker.note); note.captureHash = '0'.repeat(64); marker.note = JSON.stringify(note); }
    });
    const changed = f.bundle; hold.release(); await assert.rejects(pending, { code: kind === 'trash' ? 'naver_source_trashed' : 'naver_conflict' });
    assert.equal(f.writes, 0); assert.deepEqual(f.bundle, changed); f.service.dispose();
  }
});

test('the final transaction guard and local failure remain failures after all remote checks succeeded', async t => {
  const f = await fixture(t); f.env.commitHook = async () => { f.env.current = false; };
  await assert.rejects(f.service.restoreSourcePhotos(f.bundle.workspaceId, f.target), { code: 'naver_cancelled' }); assert.equal(f.writes, 0);
  const g = await fixture(t); g.env.commitError = { code: 'storage_aborted' };
  await assert.rejects(g.service.restoreSourcePhotos(g.bundle.workspaceId, g.target), { code: 'naver_network_error' }); assert.equal(g.writes, 0);
  for (const [storageCode, serviceCode] of [['naver_capture_changed', 'naver_conflict'], ['immutable_naver_capture', 'naver_conflict'], ['source_trashed', 'naver_source_trashed']]) {
    const h = await fixture(t); h.env.commitError = { code: storageCode };
    await assert.rejects(h.service.restoreSourcePhotos(h.bundle.workspaceId, h.target), { code: serviceCode }); assert.equal(h.writes, 0);
  }
});

test('caller mutation while transfer is pending cannot replace the selected target', async t => {
  const f = await fixture(t), hold = gate(), request = clone(f.target); f.env.selectGate = hold;
  const pending = f.service.restoreSourcePhotos(f.bundle.workspaceId, request); await hold.entered;
  request.sourceVersionId = f.bundle.sourceVersions.at(-1).id; request.expectedCaptureHash = '0'.repeat(64); hold.release();
  const result = await pending; assert.equal(result.sourceVersionId, f.target.sourceVersionId); assert.equal(f.writes, 1);
});

test('remembering legacy remote media freshly reads the exact server row and only adds its immutable reference', async t => {
  const f = await fixture(t, { referenced: false, local: true }), before = f.bundle, bytesBefore = f.installed;
  const result = await f.service.rememberSourcePhotos(before.workspaceId, f.target);
  assert.equal(result.alreadyRemembered, false); assert.equal(f.remembered, 1); assert.equal(f.rpcs.length, 1);
  assert.deepEqual(f.rpcs[0], { name: 'life_naver_capture_read', args: { p_capture_id: f.initial.attachment.capture.id } });
  assert.equal(f.downloads.length, 0); assert.equal(f.selects.length, 0); assert.equal(f.writes, 0);
  for (const collection of ['sources', 'sourceVersions', 'records', 'resumeHints', 'tombstones']) assert.deepEqual(f.bundle[collection], before[collection]);
  assert.equal(f.bundle.revision, before.revision + 1); assert.deepEqual(Reference.get(f.bundle, f.target.sourceId, f.target.sourceVersionId).reference, f.pointer);
  assert.deepEqual(f.installed, bytesBefore);
  assert.equal((await f.service.rememberSourcePhotos(before.workspaceId, f.target)).alreadyRemembered, true); assert.equal(f.remembered, 1);
});

test('remembering rejects local-only files, absent rows and a different returned capture ID before adding a reference', async t => {
  for (const kind of ['local', 'absent', 'wrong-id', 'different-set']) {
    const f = await fixture(t, { referenced: false, local: true }), before = f.bundle;
    if (kind === 'local') { const attachment = f.installed; attachment.localOnly = true; f.setInstalled(attachment); }
    if (kind === 'absent') f.env.rpcRow = null;
    if (kind === 'wrong-id') f.env.rpcRow.id = Core.id();
    if (kind === 'different-set') { f.env.rpcRow.payload.photos[0].caption = '다른 사진 판'; f.env.rpcRow.capture_hash = await Capture.fingerprint(f.env.rpcRow.payload); }
    await assert.rejects(f.service.rememberSourcePhotos(before.workspaceId, f.target), { code: kind === 'local' ? 'naver_conflict' : kind === 'absent' ? 'naver_photo_unavailable' : 'naver_invalid_data' });
    assert.equal(f.remembered, 0); assert.equal(f.writes, 0); assert.equal(f.downloads.length, 0); assert.deepEqual(f.bundle, before); f.service.dispose();
  }
});

test('the existing capture reader rejects a different response ID before downloading its images', async t => {
  const f = await fixture(t); f.env.rpcRow.id = Core.id();
  await assert.rejects(f.service.readCapture(f.bundle.workspaceId, f.initial.attachment.capture.id), { code: 'naver_invalid_data' });
  assert.equal(f.downloads.length, 0); assert.equal(f.writes, 0);
});
