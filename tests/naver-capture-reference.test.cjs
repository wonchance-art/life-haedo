'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Core = require('../assets/life/core.js'), Capture = require('../assets/life/naver-capture.js');
const Reference = require('../assets/life/naver-capture-reference.js'), Media = require('../assets/life/naver-media.js');
const F = require('./fixtures/naver-media.cjs');
const clone = value => structuredClone(value);
const stamp = '2026-10-27T03:00:00.000Z';
function linkFor(attachment, id = Core.id()) {
  const payload = attachment.capture.payload;
  return Reference.create({ sourceVersionId: attachment.sourceVersionId, blogId: payload.blogId, logNo: payload.logNo,
    captureHash: attachment.capture.capture_hash }, { id, createdAt: stamp });
}
async function fixture({ partial = false } = {}) {
  const data = await F.fixture();
  if (partial) {
    data.attachment.capture.payload.coverage = 'partial';
    data.attachment.capture.capture_hash = await Capture.fingerprint(data.attachment.capture.payload);
    const prepared = await Core.prepareImport(Capture.toImportInput(data.attachment.capture.payload), data.bundle);
    data.attachment.sourceId = prepared.source.id; data.attachment.sourceVersionId = prepared.version.id;
    data.changes = Core.buildImportChanges(data.bundle, prepared);
  }
  const link = linkFor(data.attachment);
  data.changes.put.links = [link];
  return { ...data, link, bundle: Core.applyChanges(data.bundle, data.changes) };
}

test('same text with different photo captures keeps separate exact version pointers and rejects substitution', async () => {
  const a = await fixture(), b = clone(a.attachment), p = b.capture.payload;
  p.photos[0].caption = '사진 설명이 다른 판'; b.capture.capture_hash = await Capture.fingerprint(p);
  const prepared = await Core.prepareImport(Capture.toImportInput(p, { existingSourceId: a.attachment.sourceId }), a.bundle, { forceNewVersion: true });
  b.sourceVersionId = prepared.version.id;
  const changes = Core.buildImportChanges(a.bundle, prepared); changes.put.links = [linkFor(b)];
  const combined = Core.applyChanges(a.bundle, changes);
  assert.equal(combined.sourceVersions[0].contentText, combined.sourceVersions[1].contentText);
  assert.notEqual(a.attachment.capture.capture_hash, b.capture.capture_hash);
  const old = Reference.get(combined, a.attachment.sourceId, a.attachment.sourceVersionId), newer = Reference.find(combined, b.sourceVersionId);
  assert.equal(old.reference.captureHash, a.attachment.capture.capture_hash);
  assert.equal(newer.reference.captureHash, b.capture.capture_hash);
  assert.equal(Reference.assertCapture(old.reference, a.attachment.capture), true);
  assert.throws(() => Reference.assertCapture(old.reference, b.capture), { code: 'naver_capture_reference_mismatch' });
  assert.throws(() => Reference.assertCapture(newer.reference, a.attachment.capture), { code: 'naver_capture_reference_mismatch' });
  old.link.note = '{}'; old.reference.captureHash = '0'.repeat(64);
  assert.equal(Reference.get(combined, a.attachment.sourceId, a.attachment.sourceVersionId).reference.captureHash, a.attachment.capture.capture_hash);
});

test('no pointer is inferred for legacy equal text, and wrong or missing target identities fail closed', async () => {
  const data = await F.fixture(), bundle = Core.applyChanges(data.bundle, data.changes);
  assert.equal(Reference.get(bundle, data.attachment.sourceId, data.attachment.sourceVersionId), null);
  assert.equal(Reference.find(bundle, data.attachment.sourceVersionId), null);
  assert.throws(() => Reference.get(bundle, 'another-source', data.attachment.sourceVersionId), { code: 'invalid_naver_capture_reference' });
  assert.throws(() => Reference.find(bundle, 'another-version'), { code: 'invalid_naver_capture_reference' });
  assert.deepEqual(bundle.links, []);
});

test('reference data is bounded and contains no account, row ID, path or duplicated source identity', async () => {
  const f = await fixture(), value = Reference.validate(f.link), note = JSON.parse(f.link.note);
  assert.deepEqual(Object.keys(note).sort(), ['blogId', 'captureHash', 'format', 'logNo']);
  assert.deepEqual(Object.keys(value).sort(), ['blogId', 'captureHash', 'logNo', 'sourceVersionId']);
  assert.equal(value.sourceVersionId, f.attachment.sourceVersionId);
  assert(!f.link.note.includes(F.OWNER)); assert(!f.link.note.includes(f.attachment.capture.id));
  assert(!f.link.note.includes(f.attachment.sourceId)); assert(!f.link.note.includes(f.attachment.sourceVersionId));
  assert(!f.link.note.includes(f.payload.photos[0].storagePath));
  const mutations = [l => { l.owner_id = F.OWNER; }, l => { l.sourceRefs = []; }, l => { l.revision = 2; },
    l => { l.updatedAt = '2026-10-27T03:00:01.000Z'; }, l => { l.entityRefs[0].revision = 1; },
    l => { l.entityRefs = Array(1); }, l => { l.entityRefs.extra = 'hidden'; }, l => { l.note += ' '; },
    l => { l.note = l.note.replace('"blogId":', '"blogId":"discarded","blogId":'); },
    l => { l.note = JSON.stringify({ ...note, captureId: f.attachment.capture.id }); },
    l => { l.note = JSON.stringify({ ...note, sourceVersionId: value.sourceVersionId }); },
    l => { l.note = JSON.stringify({ ...note, captureHash: 'x'.repeat(64) }); },
    l => { l.note = JSON.stringify({ ...note, logNo: '0' }); }, l => { l[Symbol('hidden')] = true; }];
  for (const mutate of mutations) { const bad = clone(f.link); mutate(bad); assert.throws(() => Reference.validate(bad)); }
  let invoked = 0; const getter = clone(f.link); Object.defineProperty(getter, 'note', { enumerable: true, get() { invoked++; return f.link.note; } });
  assert.throws(() => Reference.validate(getter)); assert.equal(invoked, 0);
  const input = { ...value, ownerId: F.OWNER }; assert.throws(() => Reference.create(input, { id: Core.id(), createdAt: stamp }));
});

test('Core rejects duplicate and forged target pointers while preserving Naver URL aliases', async () => {
  const f = await fixture(), note = JSON.parse(f.link.note);
  const mutations = [b => b.links.push({ ...clone(f.link), id: Core.id() }),
    b => { b.links[0].entityRefs[0].entityId = 'missing-version'; },
    b => { b.sources[0].origin = 'other'; },
    b => { b.links[0].note = JSON.stringify({ ...note, blogId: 'another_blog' }); },
    b => { b.links[0].note = JSON.stringify({ ...note, logNo: '999999' }); }];
  for (const mutate of mutations) { const bad = clone(f.bundle); mutate(bad); assert.throws(() => Core.validateWorkspace(bad)); }
  const alias = clone(f.bundle); alias.sources[0].url = 'https://m.blog.naver.com/PostView.naver?blogId=fixture_blog&logNo=123456789012';
  assert.equal(Core.validateWorkspace(alias), true);
  assert.equal(Reference.get(alias, f.attachment.sourceId, f.attachment.sourceVersionId).reference.captureHash, note.captureHash);
});

test('Core cannot remove, replace, relabel or retarget an established pointer', async () => {
  const f = await fixture();
  for (const patch of [{ kind: 'ordinary' }, { revision: 2 }, { note: f.link.note.replace(f.attachment.capture.capture_hash, '0'.repeat(64)) }]) {
    assert.throws(() => Core.applyChanges(f.bundle, { put: { links: [{ ...clone(f.link), ...patch }] } }), { code: 'immutable_naver_capture_reference' });
  }
  const missing = clone(f.bundle); missing.links = [];
  assert.throws(() => Core.assertSourceLinkPreservation(f.bundle, missing), { code: 'immutable_naver_capture_reference' });
  const replacement = clone(f.bundle); replacement.links[0].id = Core.id();
  assert.throws(() => Core.assertSourceLinkPreservation(f.bundle, replacement), { code: 'immutable_naver_capture_reference' });
  const ordinary = clone(f.bundle); ordinary.links = [{ id: f.link.id, kind: 'ordinary', entityRefs: clone(f.link.entityRefs) }];
  assert.throws(() => Core.applyChanges(ordinary, { put: { links: [f.link] } }), { code: 'immutable_naver_capture_reference' });
  const unchanged = Core.applyChanges(f.bundle, { put: { links: [clone(f.link)] } });
  assert.equal(Core.assertSourceLinkPreservation(f.bundle, unchanged), true);
});

test('incoming snapshots cannot modify a referenced partial text version or its acquired metadata', async () => {
  const f = await fixture({ partial: true });
  const mutations = [async b => { b.sourceVersions[0].contentText += '\r\nchanged'; b.sourceVersions[0].contentHash = require('node:crypto').createHash('sha256').update(b.sourceVersions[0].contentText, 'utf8').digest('hex'); },
    async b => { b.sourceVersions[0].coverage.omissions = ['new omission']; }, async b => { b.sourceVersions[0].originalAuthor.label = 'another author'; },
    async b => { b.sourceVersions[0].originalCreatedAt = '2026-10-01'; }, async b => { b.sourceVersions[0].revision++; }];
  for (const mutate of mutations) {
    const incoming = clone(f.bundle); await mutate(incoming); assert.equal(Core.validateWorkspace(incoming), true);
    assert.throws(() => Core.assertSourceLinkPreservation(f.bundle, incoming), { code: 'immutable_source_version' });
  }
  const title = clone(f.bundle); title.sources[0].title = '현재 표시 제목'; title.sources[0].revision++;
  assert.equal(Core.assertSourceLinkPreservation(f.bundle, title), true);
});

test('trash does not erase the pointer, and adding a pointer cannot bypass a trashed source', async () => {
  const f = await fixture(), trashed = Core.applyChanges(f.bundle, Core.buildSourceStateChanges(f.bundle, f.attachment.sourceId, 'trash'));
  assert.deepEqual(Reference.find(trashed, f.attachment.sourceVersionId), Reference.find(f.bundle, f.attachment.sourceVersionId));
  const legacy = clone(f.bundle); legacy.links = [];
  const legacyTrash = Core.applyChanges(legacy, Core.buildSourceStateChanges(legacy, f.attachment.sourceId, 'trash'));
  assert.throws(() => Core.applyChanges(legacyTrash, { put: { links: [f.link] } }), { code: 'source_trashed' });
  const changes = Core.buildSourceStateChanges(legacyTrash, f.attachment.sourceId, 'active'); changes.put.links.push(f.link);
  assert.throws(() => Core.applyChanges(legacyTrash, changes), { code: 'source_trashed' });
});

test('full JSON backup remaps reference targets without changing the photo hash or exact quote positions', async () => {
  const f = await fixture(), body = f.bundle.sourceVersions[0].contentText, start = body.indexOf('그대로'), end = body.indexOf('\r\n끝');
  const record = { id: Core.id(), kind: 'excerpt', text: body.slice(start, end), topic: '', note: '',
    sourceRefs: [{ sourceId: f.attachment.sourceId, sourceVersionId: f.attachment.sourceVersionId, locator: { start, end } }],
    provenance: { kind: 'user' }, revision: 1, createdAt: stamp, updatedAt: stamp };
  const bundle = Core.applyChanges(f.bundle, { put: { records: [record] } }), restored = await Core.restoreBackup(Core.makeBackup(bundle));
  const pointer = Reference.find(restored, restored.sourceVersions[0].id);
  assert.notEqual(restored.workspaceId, bundle.workspaceId); assert.notEqual(pointer.link.id, f.link.id);
  assert.notEqual(pointer.reference.sourceVersionId, f.attachment.sourceVersionId);
  assert.equal(pointer.link.note, f.link.note); assert.equal(pointer.reference.captureHash, f.attachment.capture.capture_hash);
  assert.equal(restored.sourceVersions[0].contentText, body);
  assert.deepEqual(restored.records[0].sourceRefs[0].locator, { start, end }); assert.equal(restored.records[0].text, record.text);
  assert.equal(restored.records[0].sourceRefs[0].sourceVersionId, pointer.reference.sourceVersionId);
});

test('dedicated local-only capture ZIP omits server-recovery pointers and retains the original bytes', async t => {
  const restore = F.installDecoder(); t.after(restore); const f = await fixture();
  const archive = await Media.pack({ bundle: f.bundle, attachment: f.attachment }), opened = await Media.read(archive), copied = await Media.copy(opened);
  for (const value of [opened, copied]) {
    assert.equal(value.attachment.localOnly, true); assert.deepEqual(value.bundle.links, []);
    assert.equal(Reference.find(value.bundle, value.attachment.sourceVersionId), null);
    assert.equal(value.attachment.capture.capture_hash, f.attachment.capture.capture_hash);
    assert.deepEqual(new Uint8Array(await value.attachment.photos[0].blob.arrayBuffer()), F.bytes);
    assert.equal(value.attachment.capture.payload.photos[0].storagePath, null);
  }
});

test('public presentation and selected preservation keep exact text without publishing recovery pointers', async () => {
  const f = await fixture(), Workbench = require('../assets/life/workbench.js'), Share = require('../assets/life/share.js');
  const Post = require('../assets/life/photo-post.js'), Evidence = require('../assets/life/source-reference.js');
  const Nine = require('../assets/life/nine-board.js'), Preservation = require('../assets/life/preservation-references.js');
  const versionId = f.attachment.sourceVersionId, body = f.bundle.sourceVersions[0].contentText;
  const state = Workbench.empty(f.bundle.workspaceId);
  state.page.entries = [{ id: Core.id(), title: '선택한 자료', pinned: false, enabled: true,
    parts: [{ versionId, enabled: true }], note: '', showBody: true, showNote: false }];
  const snapshot = Share.makeDraft(f.bundle, state, { bodyVersionIds: [versionId] }).snapshot;
  assert.equal(snapshot.entries[0].parts[0].text, body);
  const doc = Post.create(Core.id); doc.status = 'saved'; doc.revision = 1; doc.title = '선택한 글'; doc.ops = [{ insert: '직접 쓴 글\n' }];
  const ref = await Evidence.build({ bundle: f.bundle, sourceId: f.attachment.sourceId, versionId,
    locator: { start: body.indexOf('그대로'), end: body.indexOf('\r\n끝') } });
  const selected = await Preservation.select({ bundle: f.bundle, posts: [{ doc, evidence: { revision: 1, refs: [ref] } }],
    nineBoard: Nine.empty(f.bundle.workspaceId) }, { postIds: [doc.id], boardIds: [] });
  assert.deepEqual(selected.bundle.links, []); assert.equal(selected.bundle.sourceVersions[0].contentText, body);
  assert.equal(selected.posts[0].evidence.refs[0].quote, ref.quote);
  for (const value of [snapshot, selected]) for (const secret of [Reference.KIND, Reference.FORMAT, f.link.id, f.attachment.capture.capture_hash])
    assert(!JSON.stringify(value).includes(secret));
  assert.equal(Reference.find(f.bundle, versionId).link.id, f.link.id);
});

test('browser Core keeps legacy bundles usable and fails closed until the pointer module is installed', async () => {
  const f = await fixture(), sandbox = { console, URL, TextEncoder, structuredClone, crypto: require('node:crypto').webcrypto };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(require.resolve('../assets/life/core.js'), 'utf8'), sandbox);
  sandbox.withPointer = JSON.stringify(f.bundle); sandbox.withoutPointer = JSON.stringify({ ...f.bundle, links: [] });
  assert.equal(vm.runInContext('HaedoLife.Core.validateWorkspace(JSON.parse(withoutPointer))', sandbox), true);
  assert.throws(() => vm.runInContext('HaedoLife.Core.validateWorkspace(JSON.parse(withPointer))', sandbox), { code: 'dependency_unavailable' });
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/naver-blog.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/naver-capture-reference.js'), 'utf8'), sandbox);
  assert.equal(vm.runInContext('HaedoLife.Core.validateWorkspace(JSON.parse(withPointer))', sandbox), true);
});
