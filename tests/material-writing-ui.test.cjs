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
  const old = { document: global.document, life: global.HaedoLife, scrollTo: global.scrollTo };
  const document = docFixture(); global.document = document; global.scrollTo = () => {};
  const M = require('../assets/life/material-writing.js'), C = require('../assets/life/core.js'), P = require('../assets/life/photo-post.js'), R = require('../assets/life/source-reference.js');
  let bundle = C.createWorkspace(); const imported = await C.prepareImport({ origin: 'other', title: '자료의 제목', text: '정확한 인용 구절\r\n자동으로 넣지 않을 본문', url: 'https://example.org/source' }, bundle); bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, imported));
  const ref = await R.build({ bundle, sourceId: imported.source.id, versionId: imported.version.id, locator: { start: 0, end: '정확한 인용 구절'.length } });
  const plan = M.create(C.id); plan.blocks.push({ id: C.id(), kind: 'paragraph', text: '글에 쓸 내 문단' });
  let db = { ...M.empty(bundle.workspaceId), plans: [plan] }, beforeSave = null, beforeCreate = null, failRead = false, scope = true, sourceOptions = null, sourcePending = false, sourceView = { activeId: null, compareId: null };
  const docs = new Map(), saves = [], handoffs = [], opens = []; let creates = 0, failOpen = false;
  const clone = value => structuredClone(value), storage = {
    read: async () => clone(bundle), readMaterialWriting: async () => { if (failRead) throw Error('준비 목록 조회 실패'); return clone(db); },
    saveMaterialWriting: async (ws, input, base) => { if (beforeSave) await beforeSave(); M.validate(input); if (base !== db.revision) throw Object.assign(Error('두 탭 충돌'), { code: 'material_writing_conflict' }); db = { ...clone(input), revision: base + 1 }; saves.push(clone(db)); return clone(db); },
    createMaterialWritingPost: async (ws, id, expected) => {
      handoffs.push({ id, expected }); if (beforeCreate) await beforeCreate(); const owner = db.plans.find(p => p.id === id);
      if (!owner) throw Error('준비 없음'); if (owner.output) { const doc = docs.get(owner.output.postId); if (!doc) throw Error('연결 글 없음'); return { postId: doc.id, revision: doc.revision, planRevision: db.revision, created: false }; }
      if (expected !== db.revision) throw Object.assign(Error('검토 충돌'), { code: 'material_writing_conflict' });
      const { doc } = M.project(db, id, C.id); doc.revision = 1; docs.set(doc.id, clone(doc)); owner.output = { postId: doc.id }; db.revision++; creates++;
      return { postId: doc.id, revision: doc.revision, planRevision: db.revision, created: true };
    }, readPhotoPost: async (ws, id) => clone(docs.get(id)),
  };
  global.HaedoLife = { Core: C, MaterialWriting: M, PhotoPost: P, MaterialWritingSources: { create(value) { sourceOptions = value; return { mount: async () => {}, refresh: async () => {}, pending: () => sourcePending, getView: () => sourceView, dispose() {} }; } } };
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../assets/life/material-writing-ui.js'), 'utf8'));
  const host = document.createElement('main'); document.body.append(host);
  const ui = global.HaedoLife.MaterialWritingUI.create({ storage, workspaceId: bundle.workspaceId, getBundle: storage.read, isCurrent: () => scope,
    onOpenPost: async context => { await ui.flush(); if (failOpen) throw Error('작성기 열기 실패'); opens.push(context); }, onOpenSource: async context => { await ui.flush(); opens.push(context); }, ...options });
  await ui.mount(host); t.after(() => { ui.dispose(); global.document = old.document; global.HaedoLife = old.life; global.scrollTo = old.scrollTo; });
  const get = selector => { const node = host.querySelector(selector); assert.ok(node, selector); return node; };
  const click = async selector => { const node = get(selector); assert.equal(node.disabled, false, selector); await node.emit('click'); await settle(); };
  const input = async (selector, text) => { const node = get(selector); node.value = text; await node.emit('input'); return node; };
  const preview = async () => { await click('#mwPreview'); get('#mwConsent').checked = true; };
  return { ui, get, click, input, preview, host, document, storage, M, C, P, ref, imported, bundle, docs, opens, saves, handoffs,
    db: () => clone(db), setDb: value => { db = clone(value); }, sources: () => sourceOptions, setPending: value => { sourcePending = value; sourceOptions.onPendingChange(value); },
    setBeforeSave: value => { beforeSave = value; }, setBeforeCreate: value => { beforeCreate = value; }, setFailRead: value => { failRead = value; }, setFailOpen: value => { failOpen = value; }, setScope: value => { scope = value; }, creates: () => creates };
}

test('ordered blocks and adopted quotes preview in full; private question and source notes require explicit paragraph copying', async t => {
  const f = await fixture(t), title = await f.input('#mwTitle', '글 제목'), question = await f.input('#mwQuestion', 'PRIVATE_QUESTION');
  const material = f.M.material(f.bundle, f.imported.source.id, f.imported.version.id, f.C.id); material.note = 'PRIVATE_NOTE'; await f.sources().onAdd(material);
  f.setPending(true); await f.sources().onQuote(material.id, f.ref); f.setPending(false); await f.ui.flush();
  await f.click('#mwPreview'); const text = f.get('#mwPreviewContent').textContent; assert.match(text, /글에 쓸 내 문단/); assert.match(text, /정확한 인용 구절/); assert.match(text, /https:\/\/example.org\/source/);
  for (const sentinel of ['PRIVATE_QUESTION', 'PRIVATE_NOTE', '자동으로 넣지 않을 본문']) assert(!text.includes(sentinel));
  assert.ok(f.get('#mwTitle') === title); assert.ok(f.get('#mwQuestion') === question);
  await f.get('.mw-note-copies').querySelector('button').emit('click'); await settle(); await f.click('#mwPreview'); assert.match(f.get('#mwPreviewContent').textContent, /PRIVATE_NOTE/);
  assert.throws(() => f.sources().onRemove(material.id), /인용을 먼저/); assert.equal(f.db().plans[0].materials.length, 1);
});

test('saving serializes newer keystrokes while IME and invalid input preserve the original field DOM', async t => {
  const f = await fixture(t), hold = deferred(); let first = true; f.setBeforeSave(async () => { if (first) { first = false; await hold.promise; } });
  const title = await f.input('#mwTitle', '처음'), saving = f.ui.flush(); await settle(); await f.input('#mwTitle', '나중'); hold.resolve(); await saving;
  assert.equal(f.db().plans[0].title, '나중'); assert.equal(f.saves.length, 2); assert.ok(f.get('#mwTitle') === title);
  await title.emit('compositionstart'); title.value = '조합 중'; await title.emit('input'); await assert.rejects(f.ui.flush(), { code: 'material_input_in_progress' });
  await title.emit('compositionend'); await f.ui.flush(); await f.input('#mwTitle', '\ud800'); await assert.rejects(f.ui.flush(), { code: 'material_input_pending' });
  assert.equal(title.value, '\ud800'); assert.ok(f.get('#mwTitle') === title); await f.input('#mwTitle', '고친 제목'); await f.ui.flush(); assert.equal(f.db().plans[0].title, '고친 제목');
});

test('pending source selections block navigation, previews and field replacement until explicitly resolved', async t => {
  const f = await fixture(t), title = await f.input('#mwTitle', '입력 유지'); f.setPending(true);
  await assert.rejects(f.ui.flush(), { code: 'material_source_pending' }); await f.click('#mwNew'); assert.ok(f.get('#mwTitle') === title); assert.equal(title.value, '입력 유지');
  f.setPending(false); await f.ui.flush(); await f.sources().onOpenSource({ sourceId: f.imported.source.id, sourceVersionId: f.imported.version.id }); assert.equal(f.opens[0].planId, f.ui.getView().planId);
});

test('create needs current explicit consent and a changed plan after consent is never handed off', async t => {
  const f = await fixture(t); await f.preview();
  const creating = f.get('#mwCreate').emit('click'); await f.input('#mwTitle', '검토 후 바꾼 제목'); await creating; await settle();
  assert.equal(f.creates(), 0); assert.equal(f.handoffs.length, 0); assert.equal(f.host.querySelector('#mwConsent'), null);
  await f.preview(); await f.click('#mwCreate'); assert.equal(f.creates(), 1); assert.equal(f.opens.length, 1); assert.equal(f.opens[0].planId, f.ui.getView().planId);
});

test('commit followed by editor-open failure retains the output and resumes the same latest document without recreating it', async t => {
  const f = await fixture(t); f.setFailOpen(true); await f.preview(); await f.click('#mwCreate'); assert.equal(f.creates(), 1); assert.match(f.get('.mw-error').textContent, /이미 보관/);
  const value = f.db(), oldId = value.plans[0].output.postId, doc = f.docs.get(oldId), newId = f.C.id(); doc.id = newId; doc.revision = 7; f.docs.delete(oldId); f.docs.set(newId, doc); value.plans[0].output.postId = newId; value.revision++; f.setDb(value);
  f.setFailOpen(false); await f.click('#mwContinue'); assert.equal(f.creates(), 1); assert.equal(f.opens[0].postId, newId); assert.equal(f.opens[0].revision, 7);
  await f.input('#mwQuestion', '새 질문은 기존 본문을 덮지 않음'); await f.ui.flush(); assert.equal(f.docs.get(newId).ops[0].insert, '글에 쓸 내 문단\n');
});

test('delayed handoff blocks external flush and preserves later composing input while installing exactly one draft', async t => {
  const f = await fixture(t), hold = deferred(); f.setBeforeCreate(() => hold.promise); await f.preview();
  const creating = f.get('#mwCreate').emit('click'); await settle(); await assert.rejects(f.ui.flush(), { code: 'material_busy' });
  const title = f.get('#mwTitle'); await title.emit('compositionstart'); title.value = '완료 중 한글'; hold.resolve(); await creating; await settle();
  assert.equal(f.creates(), 1); assert.equal(f.opens.length, 0); assert.ok(f.get('#mwTitle') === title); assert.equal(title.value, '완료 중 한글'); assert.ok(f.get('#mwContinue'));
  await title.emit('compositionend'); await f.ui.flush(); await f.click('#mwContinue'); assert.equal(f.creates(), 1); assert.equal(f.opens.length, 1);
});

test('a CAS conflict recovers a fresh plan with new material/block IDs, retained exact refs and no output', async t => {
  const f = await fixture(t), material = f.M.material(f.bundle, f.imported.source.id, f.imported.version.id, f.C.id); await f.sources().onAdd(material); await f.sources().onQuote(material.id, f.ref); await f.ui.flush();
  const before = f.db(), latest = f.db(); latest.revision++; latest.plans[0].title = '다른 탭'; f.setDb(latest); const title = await f.input('#mwTitle', '내 준비'); await assert.rejects(f.ui.flush(), { code: 'material_writing_conflict' });
  assert.ok(f.get('#mwTitle') === title); await f.click('#mwRecover'); const recovered = f.db().plans[1]; assert.equal(f.db().plans[0].title, '다른 탭'); assert.equal(recovered.title, '내 준비'); assert.equal(recovered.output, null);
  assert.notEqual(recovered.id, before.plans[0].id); assert.notEqual(recovered.materials[0].id, material.id); const quoted = recovered.blocks.find(b => b.kind === 'quote'); assert.equal(quoted.materialId, recovered.materials[0].id); assert.deepEqual(quoted.reference, f.ref);
});

test('resuming a receipt merges other plans from the current wrapper instead of overwriting concurrent edits', async t => {
  const f = await fixture(t); await f.preview(); await f.click('#mwCreate'); const latest = f.db(), other = f.M.create(f.C.id); other.title = '다른 탭의 새 준비'; latest.plans.push(other); latest.revision++; f.setDb(latest);
  await f.click('#mwContinue'); await f.input('#mwQuestion', '내 질문 수정'); await f.ui.flush(); assert.equal(f.db().plans[1].title, '다른 탭의 새 준비');
  const changed = f.db(); changed.revision++; changed.plans[0].title = '동일 준비의 원격 변경'; f.setDb(changed); const title = f.get('#mwTitle'); await f.click('#mwContinue'); assert.ok(f.get('#mwTitle') === title); assert.match(f.get('.mw-error').textContent, /다른 탭에서 준비/);
});

test('post-commit list read failures preserve the receipt and stale account completions never open another account view', async t => {
  const f = await fixture(t); await f.preview(); f.setBeforeCreate(() => { f.setFailRead(true); }); await f.click('#mwCreate'); assert.equal(f.creates(), 1); assert.ok(f.get('#mwContinue')); assert.match(f.get('.mw-error').textContent, /이미 보관/);
  f.setFailRead(false); f.setBeforeCreate(null); await f.click('#mwContinue'); assert.equal(f.creates(), 1);
  const hold = deferred(); f.setBeforeCreate(() => hold.promise); const continuing = f.get('#mwContinue').emit('click'); await settle(); const count = f.opens.length; f.setScope(false); hold.resolve(); await continuing; assert.equal(f.opens.length, count);
});

test('detaching and remounting without an explicit plan preserves the chosen plan, input value and caret', async t => {
  const f = await fixture(t), title = await f.input('#mwTitle', '이어서 고칠 제목'); await f.ui.flush(); title.focus(); title.setSelectionRange(2, 5, 'backward');
  const id = f.ui.getView().planId; f.ui.detach(); await f.ui.mount(f.host, { planId: null });
  assert.equal(f.ui.getView().planId, id); const restored = f.get('#mwTitle'); assert.equal(restored.value, '이어서 고칠 제목'); assert.equal(restored.selectionStart, 2); assert.equal(restored.selectionEnd, 5); assert.equal(restored.selectionDirection, 'backward'); assert.ok(f.document.activeElement === restored);
});

test('the root navigation callback can flush a last accepted keystroke without bypassing input guards or duplicating the draft', async t => {
  const hold = deferred(); let entered = false;
  const f = await fixture(t, { onOpenPost: async () => { entered = true; await hold.promise; await f.ui.flush(); } });
  await f.preview(); const creating = f.get('#mwCreate').emit('click'); await settle(); assert.equal(entered, true);
  await f.input('#mwQuestion', '화면 전환 직전에도 남길 질문'); hold.resolve(); await creating; await settle();
  assert.equal(f.db().plans[0].question, '화면 전환 직전에도 남길 질문'); assert.equal(f.creates(), 1);
});

test('resolving a temporary quote guard clears its old warning after successful preview without clearing real save failures', async t => {
  const f = await fixture(t); f.setPending(true); await f.click('#mwPreview'); assert.equal(f.get('.mw-error').hidden, false);
  f.setPending(false); await f.click('#mwPreview'); assert.ok(f.get('#mwPreviewContent')); assert.equal(f.get('.mw-error').hidden, true); assert.notEqual(f.get('.mw-status').dataset.state, 'error');
  await f.input('#mwTitle', '저장할 변경'); f.setBeforeSave(() => { throw Object.assign(Error('보존해야 할 실제 저장 실패'), { code: 'storage_failed' }); }); await f.click('#mwPreview'); assert.match(f.get('.mw-error').textContent, /실제 저장 실패/);
  f.setPending(true); await f.click('#mwPreview'); f.setPending(false); await f.click('#mwPreview'); assert.match(f.get('.mw-error').textContent, /실제 저장 실패/); assert.equal(f.get('.mw-status').dataset.state, 'error');
});

test('selection notifications are local only and explicit reload adopts a received plan after a successful flush', async t => {
  const events = [], f = await fixture(t, { onPlanChange: value => events.push(value) });
  assert.equal(events.at(-1).planId, f.ui.getView().planId);
  const incoming = f.M.create(f.C.id); incoming.title = '받은 준비'; const latest = f.db(); latest.plans.push(incoming); latest.revision++; f.setDb(latest);
  await f.ui.reload({ planId: incoming.id }); assert.equal(f.ui.getView().planId, incoming.id); assert.equal(f.get('#mwTitle').value, '받은 준비'); assert.equal(events.at(-1).planId, incoming.id);
  const count = events.length; await f.input('#mwTitle', '기기 안에서 고친 제목'); await f.ui.flush(); assert.equal(events.length, count);
});

test('explicit reload keeps composing and delayed new input DOM instead of replacing it with a late snapshot', async t => {
  const f = await fixture(t), title = f.get('#mwTitle'); await title.emit('compositionstart'); title.value = '한글 조합'; await assert.rejects(f.ui.reload({}), { code: 'material_input_in_progress' }); assert.ok(f.get('#mwTitle') === title);
  await title.emit('compositionend'); await f.ui.flush();
  const wait = deferred(), read = f.storage.readMaterialWriting; f.storage.readMaterialWriting = async () => { const value = await read(); await wait.promise; return value; };
  const reload = f.ui.reload({}); await settle(); await f.input('#mwTitle', '늦은 조회 중 새 입력'); wait.resolve(); await assert.rejects(reload, { code: 'material_input_pending' });
  assert.ok(f.get('#mwTitle') === title); assert.equal(title.value, '늦은 조회 중 새 입력'); f.storage.readMaterialWriting = read; await f.ui.flush(); assert.equal(f.db().plans[0].title, '늦은 조회 중 새 입력');
});

test('connected creation delegates the frozen preparation revision and keeps foreign-device refusal without a local draft', async t => {
  const calls = [], f = await fixture(t, { onCreatePost: async value => { calls.push(value); throw Object.assign(Error('다른 기기에서 글을 작성 중입니다'), { code: 'material_output_elsewhere' }); } });
  await f.preview(); await f.click('#mwCreate'); assert.equal(f.creates(), 0); assert.equal(f.handoffs.length, 0); assert.deepEqual(calls, [{ workspaceId: f.bundle.workspaceId, planId: f.ui.getView().planId, expectedRevision: f.db().revision }]);
  assert.match(f.get('.mw-error').textContent, /다른 기기/); assert.equal(f.host.querySelector('#mwConsent'), null); assert.equal(f.db().plans[0].output, null);
});
