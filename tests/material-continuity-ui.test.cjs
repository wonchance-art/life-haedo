'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
// Small event DOM for ownership and asynchronous state assertions. Actual
// source selection, Quill, geometry and native focus are verified separately.
class Node {
  constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.disabled = false; this.hidden = false; this.value = ''; this._text = ''; this.selectionStart = 0; this.selectionEnd = 0; this.selectionDirection = 'none'; }
  append(...values) { for (const value of values) { const node = typeof value === 'string' ? this.ownerDocument.createTextNode(value) : value; node.parentNode = this; this.children.push(node); } }
  replaceChildren(...values) { this.children.forEach(node => { node.parentNode = null; }); this.children = []; this._text = ''; this.append(...values); }
  remove() { if (!this.parentNode) return; const parent = this.parentNode; parent.children.splice(parent.children.indexOf(this), 1); this.parentNode = null; }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
  contains(node) { return !!node && (this === node || this.children.some(child => child.contains(node))); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  async emit(name) { await Promise.all((this.listeners[name] || []).map(fn => fn({ target: this, type: name }))); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  matches(selector) { if (selector.startsWith('#')) return this.id === selector.slice(1); if (selector.startsWith('.')) return (this.className || '').split(' ').includes(selector.slice(1)); const data = selector.match(/^\[data-([a-z-]+)="([^"]*)"\]$/); if (data) return this.dataset[data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === data[2]; return this.tagName === selector; }
  querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function docFixture() { const doc = { createElement: tag => new Node(tag, doc), createTextNode: text => { const node = new Node('#text', doc); node.textContent = text; return node; }, getElementById: id => doc.body.querySelector('#' + id), activeElement: null }; doc.body = new Node('body', doc); return doc; }
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
function deferred() { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; }
async function fixture(t, options = {}) {
  const previous = { document: global.document, life: global.HaedoLife }, document = docFixture(); global.document = document;
  const Core = require('../assets/life/core.js'), MW = require('../assets/life/material-writing.js'), MC = require('../assets/life/material-continuity.js'), P = require('../assets/life/photo-post.js');
  let bundle = Core.createWorkspace(); const imported = await Core.prepareImport({ origin: 'other', title: '정확한 자료', text: 'FULL_ORIGINAL\r\n마지막 문장', url: 'https://example.org/exact', fileName: 'private/original.md', author: '원 작성자' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, imported));
  const plan = MW.create(Core.id); plan.title = '준비 제목'; plan.question = 'PRIVATE_QUESTION'; plan.materials.push(MW.material(bundle, imported.source.id, imported.version.id, Core.id)); plan.materials[0].note = 'PRIVATE_NOTE'; plan.blocks.push({ id: Core.id(), kind: 'paragraph', text: '개요의 문단 전체' });
  const data = MC.snapshot(bundle, plan), ws = bundle.workspaceId, row = { id: Core.id(), revision: 2, data, updated_at: '2026-10-19T00:00:00.000Z', title: plan.title };
  let selected = plan.id, scope = true, state = { enabled: false, status: 'not_enabled', output: null }, post = null, editingDrafts = [], remotePost = null, outputData = null, listener, before = null, failOpen = false;
  const calls = [], received = [], hold = {}, clone = value => structuredClone(value), result = { workspaceId: Core.id(), planId: Core.id(), bundle: Core.createWorkspace() };
  const manager = {
    getState: async () => { calls.push(['getState']); return clone(state); },
    preview: async () => { calls.push(['preview']); if (hold.preview) await hold.preview; return { data: clone(data), fingerprint: 'FULL_FINGERPRINT', post: clone(post), editingDrafts: clone(editingDrafts), outputData: clone(outputData), state: clone(state), counts: { photos: post?.photos.length || 0 } }; },
    connect: async (ws, id, fp) => { calls.push(['connect', ws, id, fp]); if (hold.connect) await hold.connect; state = { enabled: true, status: 'synced', output: null }; },
    sync: async () => { calls.push(['sync']); state.status = 'synced'; }, pause: async () => { calls.push(['pause']); state.enabled = false; state.status = 'paused'; },
    list: async next => { calls.push(['list', next]); if (hold.list) await hold.list; return { items: [clone(row)], next: null }; }, inspect: async () => { calls.push(['inspect']); return clone(row); },
    receive: async (id, revision) => { calls.push(['receive', id, revision]); if (hold.receive) await hold.receive; return clone(result); },
    compare: async () => { calls.push(['compare']); return { local: { data: clone(data), fingerprint: 'LOCAL', post: clone(post), editingDrafts: clone(editingDrafts), refs: [] }, remote: clone(row), remotePost: clone(remotePost), expected: { fingerprint: 'LOCAL', remoteRevision: row.revision, reviewFingerprint: 'REVIEW' } }; },
    resolve: async (ws, id, choice, expected) => { calls.push(['resolve', ws, id, choice, expected]); if (hold.resolveError) throw hold.resolveError; return clone(result); },
    shareOutput: async (ws, id, fp) => { calls.push(['shareOutput', ws, id, fp]); if (hold.outputError) throw hold.outputError; },
    subscribe(fn) { listener = fn; return () => { listener = null; }; }
  };
  global.HaedoLife = { Core, MaterialWriting: MW, MaterialContinuity: MC, PhotoPost: P };
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../assets/life/material-continuity-ui.js'), 'utf8'));
  const host = document.createElement('main'); document.body.append(host);
  const ui = global.HaedoLife.MaterialContinuityUI.create({ host, manager, workspaceId: ws, getPlanId: () => selected,
    beforeAction: async () => { calls.push(['before']); if (before) await before(); }, isCurrent: () => scope,
    onReceived: async value => { await ui.flush(); if (failOpen) throw Error('열기 실패'); received.push(value); }, ...options });
  await settle(); t.after(() => { ui.dispose(); global.document = previous.document; global.HaedoLife = previous.life; });
  const get = selector => { const value = host.querySelector(selector); assert.ok(value, selector); return value; };
  const click = async selector => { const value = get(selector); assert.equal(value.disabled, false); await value.emit('click'); await settle(); };
  return { ui, host, get, click, calls, data, row, ws, plan, Core, P, MW, MC, hold, received, emit: async () => { listener?.({ workspaceId: ws }); await settle(); },
    setSelected: value => { selected = value; }, setScope: value => { scope = value; }, setBefore: value => { before = value; }, setPost: value => { post = value; }, setEditingDrafts: value => { editingDrafts = value; }, setRemotePost: value => { remotePost = value; }, setOutputData: value => { outputData = value; }, setState: value => { state = value; }, setFailOpen: value => { failOpen = value; } };
}

test('one preparation review exposes private inputs, every exact original and metadata; no write before consent', async t => {
  const f = await fixture(t); await f.click('#mcReview'); const text = f.get('#mcReviewContent').textContent;
  for (const value of ['PRIVATE_QUESTION', 'PRIVATE_NOTE', 'FULL_ORIGINAL\r\n마지막 문장', 'private/original.md', '원 작성자', 'https://example.org/exact', '개요의 문단 전체']) assert.ok(text.includes(value), value);
  assert.equal(f.get('#mcConsent').checked, undefined); assert.equal(f.calls.filter(c => c[0] === 'connect').length, 0);
  f.get('#mcConsent').checked = true; await f.click('#mcConnect'); assert.deepEqual(f.calls.find(c => c[0] === 'connect').slice(1), [f.ws, f.plan.id, 'FULL_FINGERPRINT']);
  assert.equal(f.host.querySelector('#mcConsent'), null); assert.equal(f.get('#mcStatus').dataset.state, 'synced');
});

test('every attempted send consumes consent; failure preserves the main form and requires a new fingerprint review', async t => {
  const f = await fixture(t); await f.click('#mcReview'); await f.click('#mcConnect'); assert.equal(f.calls.filter(c => c[0] === 'connect').length, 0); assert.match(f.get('.mc-error').textContent, /동의/);
  f.get('#mcConsent').checked = true; f.setBefore(() => { throw Error('자료의 미적용 구절을 먼저 마치세요'); }); await f.click('#mcConnect'); assert.equal(f.calls.filter(c => c[0] === 'connect').length, 0);
  // beforeAction fails before an attempted transfer: the prepared request is not sent.
  f.setBefore(null); await f.click('#mcConnect'); assert.equal(f.calls.filter(c => c[0] === 'connect').length, 1);
});

test('no current preparation still lists and inspects server preparations without installing until explicit receive', async t => {
  const f = await fixture(t); f.setSelected(null); await f.ui.refresh(); assert.equal(f.host.querySelector('#mcReview'), null); await f.click('#mcList');
  assert.equal(f.get('#mcServerList').children[0].dataset.remoteId, f.row.id); const inspect = f.get('#mcServerList').querySelector('button'); await inspect.emit('click'); await settle();
  assert.match(f.get('#mcRemoteContent').textContent, /PRIVATE_QUESTION/); assert.equal(f.calls.filter(c => c[0] === 'receive').length, 0);
  await f.click('#mcReceive'); assert.deepEqual(f.calls.find(c => c[0] === 'receive').slice(1), [f.row.id, f.row.revision]); assert.equal(f.received.length, 1);
});

test('install-then-open failure retains the exact receipt and retry opens it without a second install', async t => {
  const f = await fixture(t); f.setFailOpen(true); await f.click('#mcList'); await f.get('#mcServerList').querySelector('button').emit('click'); await settle(); await f.click('#mcReceive');
  assert.equal(f.calls.filter(c => c[0] === 'receive').length, 1); assert.ok(f.get('#mcReceiveOpen')); assert.match(f.get('.mc-error').textContent, /이미 보관/);
  f.setFailOpen(false); await f.click('#mcReceiveOpen'); assert.equal(f.calls.filter(c => c[0] === 'receive').length, 1); assert.equal(f.received.length, 1);
});

test('an in-flight request rejects external navigation and double clicks; late account responses cannot open or render', async t => {
  const f = await fixture(t), wait = deferred(); await f.click('#mcReview'); f.get('#mcConsent').checked = true; f.hold.connect = wait.promise;
  const button = f.get('#mcConnect'), sending = button.emit('click'); await settle(); await assert.rejects(f.ui.flush(), { code: 'material_continuity_busy' }); assert.equal(f.ui.dirty(), true);
  await button.emit('click'); assert.equal(f.calls.filter(c => c[0] === 'connect').length, 1); f.setScope(false); const before = f.host.textContent; wait.resolve(); await sending;
  assert.equal(f.host.textContent, before); assert.equal(f.received.length, 0);
});

test('selected-plan changes invalidate a delayed review and keep the newly selected preparation surface', async t => {
  const f = await fixture(t), wait = deferred(); f.hold.preview = wait.promise; const preparing = f.get('#mcReview').emit('click'); await settle();
  f.setSelected(f.Core.id()); wait.resolve(); await preparing; await settle(); assert.equal(f.host.querySelector('#mcConsent'), null); assert.equal(f.ui.dirty(), false);
});

test('full conflict review passes the exact comparison stamp and consumes stale choices without losing input', async t => {
  const f = await fixture(t); f.setState({ enabled: true, status: 'conflict', output: null }); await f.ui.refresh(); await f.click('#mcCompare');
  const full = f.get('#mcConflictContent').textContent; assert.match(full, /PRIVATE_NOTE/); assert.match(full, /선택하지 않은/);
  f.get('#mcConflictConsent').checked = true; f.hold.resolveError = Error('검토 뒤 서버가 바뀌었습니다'); await f.click('#mcResolveLocal');
  assert.deepEqual(f.calls.find(c => c[0] === 'resolve').slice(3), ['local', { fingerprint: 'LOCAL', remoteRevision: 2, reviewFingerprint: 'REVIEW' }]); assert.equal(f.host.querySelector('#mcConflictConsent'), null); assert.equal(f.received.length, 0); assert.match(f.get('.mc-error').textContent, /서버가 바뀌/);
});

test('pending operations retry only the durable request; pause clearly retains the private server copy', async t => {
  const f = await fixture(t); f.setState({ enabled: true, status: 'pending', pending: { operationId: 'fixed' }, output: null }); await f.ui.refresh(); await f.click('#mcSync');
  assert.equal(f.calls.filter(c => c[0] === 'sync').length, 1); assert.equal(f.calls.filter(c => c[0] === 'connect').length, 0); await f.click('#mcPause'); assert.match(f.get('#mcStatus').textContent, /서버 사본 유지/);
});

test('saved output uses a separate full-original consent, and an other-device writing marker never invents a draft', async t => {
  const f = await fixture(t); f.setState({ enabled: true, status: 'synced', ownClaim: false, output: { state: 'writing' }, outputNeedsReview: true }); await f.ui.refresh(); assert.match(f.host.textContent, /다른 기기에서 글을 작성/); assert.match(f.host.textContent, /글이나 사진의 보관 버전이 달라졌습니다\. 완성 글 원본 전송 검토에서 연결을 다시 보관해 주세요\./); assert.equal(f.calls.filter(c => c[0] === 'shareOutput').length, 0);
  await f.click('#mcOutputReview'); assert.match(f.get('.mc-error').textContent, /글을 저장/); assert.equal(f.calls.filter(c => c[0] === 'shareOutput').length, 0);
  const post = f.P.create(f.Core.id); post.status = 'saved'; post.ops = [{ insert: '완성 글의 전체 본문\n' }]; f.setPost(post);
  await f.click('#mcOutputReview'); assert.match(f.get('#mcReviewContent').textContent, /완성 글의 전체 본문/); assert.match(f.get('#mcReviewContent').textContent, /EXIF\/GPS/); assert.notEqual(f.get('#mcOutputConsent').checked, true);
  f.get('#mcOutputConsent').checked = true; f.hold.outputError = Error('검토 뒤 원본이 바뀌었습니다'); await f.click('#mcShareOutput'); assert.equal(f.calls.filter(c => c[0] === 'shareOutput').length, 1); assert.equal(f.host.querySelector('#mcOutputConsent'), null); assert.match(f.get('.mc-error').textContent, /원본이 바뀌/);
});

test('finished output review includes actual embed captions, original sizes and additional evidence source closure', async t => {
  const f = await fixture(t); f.setState({ enabled: true, status: 'synced', ownClaim: true, output: { state: 'writing' } }); await f.ui.refresh();
  const post = f.P.create(f.Core.id), blob = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])], { type: 'image/png' }), id = f.Core.id();
  post.title = '완성한 여행 글'; post.status = 'saved'; post.photos = [{ id, name: '여행 원본.png', type: blob.type, width: 4032, height: 3024, size: blob.size, digest: await f.P.digest(blob), blob }];
  post.ops = [{ insert: '완성 문단\n' }, { insert: { photo: { id, caption: '사진의 정확한 설명', alt: '풍경 대체 텍스트' } } }, { insert: '\n' }]; f.P.validate(post); f.setPost(post);
  const imported = await f.Core.prepareImport({ origin: 'other', title: '완성 글의 추가 근거', text: 'OUTPUT_EVIDENCE_FULL_TEXT' }, f.data.bundle);
  const enriched = f.Core.applyChanges(f.data.bundle, f.Core.buildImportChanges(f.data.bundle, imported));
  const R = require('../assets/life/source-reference.js'), ref = await R.build({ bundle: enriched, sourceId: imported.source.id, versionId: imported.version.id, locator: { start: 0, end: 'OUTPUT_EVIDENCE_FULL_TEXT'.length } });
  const extra = f.MC.snapshot(enriched, f.data.plan, { state: 'saved', postId: post.id, claimId: f.Core.id(), revision: 1, refs: [ref] }); await f.MC.verify(extra); f.setOutputData(extra);
  await f.click('#mcOutputReview'); const text = f.get('#mcReviewContent').textContent;
  for (const value of ['OUTPUT_EVIDENCE_FULL_TEXT', '사진의 정확한 설명', '풍경 대체 텍스트', '여행 원본.png', '4032 × 3024', '11바이트']) assert.ok(text.includes(value), value);
  assert.equal(f.calls.filter(c => c[0] === 'shareOutput').length, 0); f.get('#mcOutputConsent').checked = true; await f.click('#mcShareOutput'); assert.deepEqual(f.calls.find(c => c[0] === 'shareOutput').slice(1), [f.ws, f.plan.id, 'FULL_FINGERPRINT']);
});

test('pause interrupts an in-flight preparation transfer without waiting for it or allowing its late UI completion', async t => {
  const f = await fixture(t), wait = deferred(); await f.click('#mcReview'); f.get('#mcConsent').checked = true; f.hold.connect = wait.promise;
  const sending = f.get('#mcConnect').emit('click'); await settle(); assert.equal(f.ui.dirty(), true); assert.equal(f.get('#mcPause').disabled, false);
  f.setBefore(() => { throw Error('중지는 미반영 입력을 전송하지 않으므로 이 guard를 부르지 않습니다'); });
  await f.click('#mcPause'); assert.equal(f.calls.filter(c => c[0] === 'pause').length, 1); assert.equal(f.ui.dirty(), false); assert.match(f.get('#mcStatus').textContent, /중지됨/);
  assert.equal(f.host.querySelector('#mcConsent'), null); const snapshot = f.host.textContent; wait.resolve(); await sending; await settle(); assert.equal(f.host.textContent, snapshot); assert.equal(f.received.length, 0);
});

test('conflict comparison shows complete local draft and remote saved manifests including photo descriptions and protects the full review stamp', async t => {
  const f = await fixture(t), local = f.P.create(f.Core.id), blob = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])], { type: 'image/png' });
  const photo = { id: f.Core.id(), name: '로컬 여행 원본.png', type: blob.type, width: 4032, height: 3024, size: blob.size, digest: await f.P.digest(blob), blob };
  local.title = '작성 중인 여행 글'; local.photos = [photo]; local.ops = [{ insert: 'LOCAL_FULL_BODY\n' }, { insert: { photo: { id: photo.id, caption: '로컬 설명 끝', alt: '로컬 대체 텍스트 끝' } } }, { insert: '\n링크 문단', attributes: { link: 'https://example.org/local-link' } }, { insert: '\n' }]; f.P.validate(local);
  const remote = structuredClone(local); remote.id = f.Core.id(); remote.status = 'saved'; remote.title = '서버에 저장된 글'; remote.ops[0].insert = 'REMOTE_FULL_BODY\n'; remote.ops[1].insert.photo.caption = '서버 설명 끝'; remote.photos[0].name = '서버 여행 원본.png'; f.P.validate(remote);
  // The service returns verified manifests without Blob objects. Comparing them
  // must neither need private bytes nor silently omit embed caption/alt fields.
  for (const post of [local, remote]) for (const value of post.photos) delete value.blob;
  f.setPost(local); f.setRemotePost(remote); f.setState({ enabled: true, status: 'conflict', output: null }); await f.ui.refresh(); await f.click('#mcCompare');
  const localSide = f.get('#mcConflictContent').querySelector('[data-side="local"]'), remoteSide = f.get('#mcConflictContent').querySelector('[data-side="remote"]');
  for (const value of ['LOCAL_FULL_BODY', '로컬 설명 끝', '로컬 대체 텍스트 끝', '로컬 여행 원본.png', '4032 × 3024', 'https://example.org/local-link']) assert.ok(localSide.textContent.includes(value), value);
  for (const value of ['REMOTE_FULL_BODY', '서버 설명 끝', '서버 여행 원본.png', '저장한 글']) assert.ok(remoteSide.textContent.includes(value), value);
  assert.equal(f.calls.filter(c => c[0] === 'resolve').length, 0); f.get('#mcConflictConsent').checked = true; await f.click('#mcResolveRemote');
  assert.deepEqual(f.calls.find(c => c[0] === 'resolve').slice(3), ['remote', { fingerprint: 'LOCAL', remoteRevision: 2, reviewFingerprint: 'REVIEW' }]); assert.equal(f.received.length, 1);
});

test('a separate editing draft blocks saved-output transfer and is fully visible in keep-both conflict review without entering the wire payload', async t => {
  const f = await fixture(t), saved = f.P.create(f.Core.id), draft = f.P.create(f.Core.id), blob = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])], { type: 'image/png' });
  saved.title = '이미 저장한 글'; saved.status = 'saved'; saved.revision = 1; saved.ops = [{ insert: 'SAVED_BODY\n' }]; f.P.validate(saved);
  draft.title = '계속 수정 중인 글'; draft.replaces = { id: saved.id, revision: saved.revision }; draft.ops = [{ insert: 'EDITING_DRAFT_FULL_TEXT\n' }];
  const photo = { id: f.Core.id(), name: '수정 초안의 원본.png', type: blob.type, width: 2048, height: 1536, size: blob.size, digest: await f.P.digest(blob), blob }; draft.photos = [photo];
  draft.ops.push({ insert: { photo: { id: photo.id, caption: '수정 초안의 사진 설명', alt: '수정 초안의 대체 텍스트' } } }, { insert: '\n' }); f.P.validate(draft);
  f.setPost(saved); f.setEditingDrafts([{ post: draft, refs: [] }]); f.setState({ enabled: true, status: 'conflict', output: { state: 'saved' } }); await f.ui.refresh();
  await f.click('#mcOutputReview'); assert.match(f.get('.mc-error').textContent, /작성기에서 수정 중인 글을 저장한 뒤 원본 전송을 검토/); assert.equal(f.host.querySelector('#mcOutputConsent'), null); assert.equal(f.calls.filter(c => c[0] === 'shareOutput').length, 0);
  await f.click('#mcCompare'); const shown = f.get('#mcConflictContent').querySelector('[data-side="editing"]');
  for (const value of ['이 기기에서 수정 중인 글 · 자동 전송 제외', 'EDITING_DRAFT_FULL_TEXT', '수정 초안의 원본.png', '2048 × 1536', '수정 초안의 사진 설명', '수정 초안의 대체 텍스트']) assert.ok(shown.textContent.includes(value), value);
  assert.equal(shown.dataset.editingPostId, draft.id); assert.ok(!JSON.stringify(f.data).includes('EDITING_DRAFT_FULL_TEXT')); assert.equal(f.calls.filter(c => c[0] === 'resolve').length, 0);
});
