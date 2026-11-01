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
    getState: async (_, id) => { calls.push(['getState', id]); if (hold.getState) await hold.getState; return clone(state); },
    autoSync: async (ws, id) => { calls.push(['autoSync', ws, id]); if (hold.autoError) throw hold.autoError; state = { ...state, status: 'synced', error: null }; return { ...clone(state), received: hold.received || null }; },
    dismissNotice: (ws, id) => { calls.push(['dismissNotice', ws, id]); state = { ...state, notice: null }; },
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
  const watches = [];
  global.HaedoLife = { Core, MaterialWriting: MW, MaterialContinuity: MC, PhotoPost: P,
    MaterialContinuitySync: { watch: (id, handlers) => { const entry = { id, handlers, active: true }; watches.push(entry); return () => { entry.active = false; }; } } };
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../assets/life/material-continuity-ui.js'), 'utf8'));
  const host = document.createElement('main'); document.body.append(host);
  const ui = global.HaedoLife.MaterialContinuityUI.create({ host, manager, workspaceId: ws, getPlanId: () => selected,
    beforeAction: async () => { calls.push(['before']); if (before) await before(); }, isCurrent: () => scope,
    onReceived: async value => { await ui.flush(); if (failOpen) throw Error('열기 실패'); received.push(value); }, ...options });
  await settle(); t.after(() => { ui.dispose(); global.document = previous.document; global.HaedoLife = previous.life; });
  const get = selector => { const value = host.querySelector(selector); assert.ok(value, selector); return value; };
  const click = async selector => { const value = get(selector); assert.equal(value.disabled, false); await value.emit('click'); await settle(); };
  return { ui, host, get, click, calls, watches, data, row, ws, plan, Core, P, MW, MC, hold, received, emit: async () => { listener?.({ workspaceId: ws }); await settle(); },
    setSelected: value => { selected = value; }, setScope: value => { scope = value; }, setBefore: value => { before = value; }, setPost: value => { post = value; }, setEditingDrafts: value => { editingDrafts = value; }, setRemotePost: value => { remotePost = value; }, setOutputData: value => { outputData = value; }, setState: value => { state = value; }, setFailOpen: value => { failOpen = value; } };
}

const writes = calls => calls.filter(call => ['connect', 'receive', 'resolve', 'shareOutput', 'pause', 'list', 'inspect', 'preview'].includes(call[0]));

test('the panel is a compact status: no consent, review, receive, pause or keep-this-device controls and no write on mount', async t => {
  const f = await fixture(t); f.setState({ enabled: true, status: 'synced', output: null }); await f.ui.refresh();
  assert.equal(f.get('#mcStatus').textContent, '모든 기기에 동기화됨');
  for (const id of ['#mcReview', '#mcConsent', '#mcConnect', '#mcList', '#mcReceive', '#mcPause', '#mcCompare', '#mcResolveLocal', '#mcResolveRemote', '#mcOutputReview'])
    assert.equal(f.host.querySelector(id), null, id);
  assert.doesNotMatch(f.host.textContent, /다른 기기에서 이어쓰기|이 기기 준비로 이어쓰기|이 준비 받기|이 브라우저에만/);
  assert.deepEqual(writes(f.calls), []);
});

test('an automatic latest-wins resolution shows one short notice that the user can dismiss', async t => {
  const f = await fixture(t); f.setState({ enabled: true, status: 'synced', output: null, notice: { choice: 'remote', at: '2026-11-01T00:00:00.000Z' } }); await f.ui.refresh();
  assert.match(f.host.textContent, /다른 기기 변경을 반영했고 이전 내용은 복구 목록에 있습니다/);
  await f.click('#mcNoticeDone'); assert.deepEqual(f.calls.find(call => call[0] === 'dismissNotice').slice(1), [f.ws, f.plan.id]);
  assert.doesNotMatch(f.host.textContent, /복구 목록에 있습니다/);
});

test('a sync error offers one retry that runs the automatic step after flushing input and opens a received change', async t => {
  const f = await fixture(t); f.setState({ enabled: true, status: 'error', error: 'network_error', output: null }); await f.ui.refresh();
  assert.equal(f.get('.mc-error').hidden, false);
  f.setBefore(() => { throw Error('입력을 먼저 마치세요'); }); await f.click('#mcSync');
  assert.equal(f.calls.filter(call => call[0] === 'autoSync').length, 0); assert.match(f.get('.mc-error').textContent, /입력을 먼저 마치세요/);
  f.setBefore(null); f.hold.received = { workspaceId: f.ws, planId: f.plan.id }; await f.click('#mcSync');
  assert.deepEqual(f.calls.find(call => call[0] === 'autoSync').slice(1), [f.ws, f.plan.id]); assert.deepEqual(f.received, [{ workspaceId: f.ws, planId: f.plan.id }]);
  assert.equal(f.get('#mcStatus').textContent, '모든 기기에 동기화됨');
});

test('another device writing the post is described without inventing a local draft or a takeover control', async t => {
  const f = await fixture(t); f.setState({ enabled: true, status: 'synced', ownClaim: false, output: { state: 'writing', postId: f.Core.id(), claimId: f.Core.id() } }); await f.ui.refresh();
  assert.match(f.host.textContent, /다른 기기에서 이 준비의 글을 쓰고 있습니다/); assert.equal(f.host.querySelector('button'), null); assert.deepEqual(writes(f.calls), []);
});

test('the open editor registers a hold so background passes skip unsaved input; dispose releases it', async t => {
  let dirty = true; const f = await fixture(t, { isBusy: () => dirty });
  const entry = f.watches.at(-1); assert.equal(entry.id, f.ws); assert.equal(entry.handlers.busy(), true);
  dirty = false; assert.equal(entry.handlers.busy(), false);
  f.ui.dispose(); assert.equal(entry.active, false); assert.equal(entry.handlers.busy(), false);
});

test('a late state for a previously selected preparation never renders over the newly selected one', async t => {
  const f = await fixture(t); let release; f.hold.getState = new Promise(resolve => { release = resolve; });
  f.setState({ enabled: true, status: 'error', error: 'network_error', output: null }); const late = f.ui.refresh(); await settle();
  f.setSelected(null); f.hold.getState = null; await f.ui.refresh(); release(); await late; await settle();
  assert.equal(f.get('#mcStatus').dataset.state, 'empty'); assert.equal(f.host.querySelector('#mcSync'), null);
});
