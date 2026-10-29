'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const Model = require('../assets/life/naver-blog.js');
// Event DOM for pause permissions, failed saves and late-result ownership.
// Native layout, keyboard focus and pointer reachability are browser checks.
class Node {
  constructor(tag, document) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.listeners = {}; this.dataset = {}; this.attributes = {}; this.value = ''; this.disabled = false; this.hidden = false; this._text = ''; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this._text = ''; this.append(...nodes); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set innerHTML(_) { throw Error('Unsafe HTML'); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  emit(name) { if (name === 'click' && this.disabled) return; for (const handler of this.listeners[name] || []) handler({ target: this, type: name, preventDefault() {} }); }
  focus() { if (!this.disabled && this.isConnected) this.ownerDocument.activeElement = this; }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return (this.className || '').split(' ').includes(selector.slice(1));
    const data = /^\[data-([a-z-]+)="([^"]*)"\]$/.exec(selector);
    if (data) return this.dataset[data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === data[2];
    return this.tagName === selector;
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(value => value.trim().split(/\s+/));
    const matches = node => selectors.some(parts => {
      if (!node.matches(parts.at(-1))) return false;
      let parent = node.parentNode;
      for (let i = parts.length - 2; i >= 0; i--) { while (parent && !parent.matches(parts[i])) parent = parent.parentNode; if (!parent) return false; parent = parent.parentNode; }
      return true;
    });
    return this.children.flatMap(node => [...(matches(node) ? [node] : []), ...node.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function documentFixture() { const document = { createElement: tag => new Node(tag, document), activeElement: null }; document.body = new Node('body', document); return document; }
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function deferred() { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; }
async function fixture(t, options = {}) {
  const document = documentFixture(), host = document.createElement('main'); document.body.append(host);
  const ws = 'current-workspace'; let current = true, beforeSave = null, saveError = null;
  let connection = { id: 'connection-one', blogId: 'won_cy_', workspaceId: options.otherWorkspace ? 'other-workspace' : ws, enabled: options.enabled !== false, revision: 7, baselineComplete: options.baseline === true, inventory: options.inventory };
  const ready = options.ready === true, calls = [];
  const clone = value => structuredClone(value);
  const subscription = () => ({ id: connection.id, blog_id: connection.blogId, workspace_id: connection.workspaceId, enabled: connection.enabled, revision: connection.revision });
  const save = async (kind, target, value) => {
    calls.push({ kind, target, value: clone(value) }); if (beforeSave) await beforeSave(); if (saveError) throw saveError;
    assert.equal(value.expectedRevision, connection.revision); connection = { ...connection, enabled: value.enabled, revision: connection.revision + 1 }; return subscription();
  };
  const service = {
    async list() { calls.push({ kind: 'list' }); return { ready, subscriptions: connection.workspaceId === ws ? [subscription()] : [], items: [], hasMore: false }; },
    save: (workspace, value) => { assert.equal(workspace, ws); return save('save', workspace, value); }
  };
  if (!options.legacy) Object.assign(service, {
    async connections() { calls.push({ kind: 'connections' }); return { ready, connections: [clone(connection)] }; },
    async publicList() { return { items: [], hasMore: false, complete: options.inventory?.status === 'complete', inventory: options.inventory, jobs: [] }; },
    async captures() { return { captures: [], jobs: [], hasMore: false }; },
    async startInventory() { return {}; },
    async checkCapture() { return options.checkResult || { status: 'checked' }; },
    configureConnection: (workspace, id, value) => { assert.equal(workspace, ws); assert.equal(id, connection.id); return save('configure', id, value); }
  });
  const sandbox = { URL, Intl, HaedoLife: { NaverBlog: Model } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/life/naver-blog-ui.js'), 'utf8'), sandbox);
  const ui = sandbox.HaedoLife.NaverBlogUI.create({ container: host, service, workspaceId: ws, isCurrent: () => current, viewState: { blogInput: 'won_cy_' } });
  await ui.render(); t.after(() => ui.destroy());
  const get = selector => { const value = host.querySelector(selector); assert.ok(value, selector); return value; };
  const accountRow = () => get('#naverAccountConnections').querySelector('.nv-connection');
  const accountToggle = () => accountRow()?.querySelector('[data-action="new-posts"]');
  const rssToggle = () => get('#naverBlogSubscriptions').querySelector('[data-action="pause"],[data-action="resume"]');
  return { ui, host, document, get, calls, accountRow, accountToggle, rssToggle, state: () => clone(connection), setBeforeSave: value => { beforeSave = value; }, setSaveError: value => { saveError = value; }, setCurrent: value => { current = value; }, async click(node) { assert.ok(node); assert.equal(node.disabled, false); node.focus(); node.emit('click'); await settle(); } };
}

test('count mismatch remains partial after a checked worker response and preserves input', async t => {
  const f = await fixture(t, { ready: true, enabled: false, inventory: { status: 'partial', seen_count: 1665, total_start: 1663 }, checkResult: { status: 'checked', failed: true } });
  const input = f.get('#naverBlogId'), originalInput = input.value;
  await f.click(f.accountRow().querySelector('[data-action="inventory"]'));
  const status = f.get('#naverCaptureIntakeStatus');
  assert.equal(status.dataset.state, 'partial');
  assert.match(status.textContent, /1,665개.*1,663개/);
  assert.match(status.textContent, /전체 목록 확인은 미완료/);
  assert.equal(input.value, originalInput);
  assert.equal(f.accountToggle(), null);
});

test('observed baseline enables an explicit opt-in while disclosing unconfirmed total', async t => {
  const f = await fixture(t, { ready: true, enabled: false, baseline: true, inventory: { status: 'complete', baseline_method: 'observed_set', baseline_count: 1665, seen_count: 1665, total_start: 1663 } });
  await f.click(f.accountRow().querySelector('[data-action="public-list"]'));
  const status = f.get('#naverCaptureIntakeStatus');
  assert.equal(status.dataset.state, 'observed');
  assert.match(status.textContent, /반복 확인한 목록/);
  assert.match(status.textContent, /전체 공개 글 수는 미확정/);
  assert.equal(f.accountToggle().disabled, false);
  assert.match(f.accountToggle().textContent, /새로 발견한 글/);
  assert.equal(f.state().enabled, false);
  assert.equal(f.calls.filter(value => value.kind === 'configure').length, 0);
});

test('an incomplete subsequent scan preserves the observed baseline without a completed scan message', async t => {
  const f = await fixture(t, { ready: true, baseline: true, inventory: { status: 'partial', baseline_method: 'observed_set', baseline_count: 1665, seen_count: 30, total_start: 1664 } });
  await f.click(f.accountRow().querySelector('[data-action="public-list"]'));
  assert.equal(f.get('#naverCaptureIntakeStatus').dataset.state, 'partial');
  assert.match(f.get('#naverCaptureIntakeStatus').textContent, /기준 목록은 유지.*이번 목록 확인은 아직 끝나지/);
});

test('an interrupted first scan does not label a normally shorter prefix as a source count mismatch', async t => {
  const f = await fixture(t, { ready: true, enabled: false, inventory: { status: 'partial', seen_count: 30, total_start: 1663, page: 2, last_error: 'network_error' } });
  await f.click(f.accountRow().querySelector('[data-action="public-list"]'));
  assert.equal(f.get('#naverCaptureIntakeStatus').dataset.state, 'partial');
  assert.doesNotMatch(f.get('#naverCaptureIntakeStatus').textContent, /개수가 달라/);
});

test('setup-off enabled connection can pause before baseline, including a different workspace', async t => {
  const f = await fixture(t, { otherWorkspace: true, baseline: false, ready: false });
  const pause = f.accountToggle(); assert.ok(pause); assert.match(pause.textContent, /중지/); assert.equal(pause.disabled, false);
  assert.equal(f.get('#naverBlogAuto').disabled, true); assert.match(f.get('#naverBlogPreview').textContent, /https:\/\/blog.naver.com\/won_cy_/);
  await f.click(pause);
  assert.equal(f.state().enabled, false); assert.deepEqual(f.calls.filter(call => call.kind === 'configure'), [{ kind: 'configure', target: 'connection-one', value: { expectedRevision: 7, enabled: false } }]);
  assert.equal(f.accountToggle(), null); assert.equal(f.document.activeElement, f.accountRow().querySelector('[data-action="public-list"]'));
  assert.equal(f.get('#naverBlogStatus').dataset.state, 'setup-required');
});

test('RSS pause remains available without runtime readiness and cannot re-enable while setup is off', async t => {
  const f = await fixture(t, { ready: false, baseline: true });
  assert.equal(f.rssToggle().disabled, false); await f.click(f.rssToggle());
  assert.equal(f.state().enabled, false); assert.equal(f.rssToggle().disabled, true); assert.match(f.rssToggle().textContent, /켜기/);
  assert.match(f.accountToggle().textContent, /켜기/); assert.equal(f.accountToggle().disabled, true);
  assert.equal(f.document.activeElement, f.get('#naverBlogRefresh'));
  f.rssToggle().emit('click'); await settle(); assert.equal(f.calls.filter(call => call.kind === 'save').length, 1);
});

test('capture enabling retains ready and completed-baseline gates, while legacy RSS keeps its original ready-only gate', async t => {
  const noBaseline = await fixture(t, { enabled: false, ready: true, baseline: false });
  assert.equal(noBaseline.accountToggle(), null); assert.equal(noBaseline.get('#naverBlogAuto').disabled, true);
  assert.equal(noBaseline.rssToggle().disabled, false); await noBaseline.click(noBaseline.rssToggle()); assert.equal(noBaseline.state().enabled, true);
  const off = await fixture(t, { enabled: false, ready: false, baseline: true }); assert.equal(off.accountToggle().disabled, true); assert.equal(off.rssToggle().disabled, true);
  const complete = await fixture(t, { enabled: false, ready: true, baseline: true }); assert.equal(complete.accountToggle().disabled, false);
  await complete.click(complete.accountToggle()); assert.equal(complete.state().enabled, true); assert.match(complete.accountToggle().textContent, /중지/); assert.equal(complete.document.activeElement, complete.accountToggle());
});

test('legacy-only subscription can be paused with setup off without adding a new collection contract', async t => {
  const f = await fixture(t, { ready: false, legacy: true }); assert.equal(f.host.querySelector('#naverAccountConnections'), null);
  await f.click(f.rssToggle()); assert.equal(f.state().enabled, false); assert.equal(f.rssToggle().disabled, true);
  assert.equal(f.calls.filter(call => call.kind === 'save').length, 1);
});

test('failed explicit pause preserves the original enabled choice, input node and focus for retry', async t => {
  const f = await fixture(t, { ready: false, baseline: false });
  const pause = f.accountToggle(), input = f.get('#naverBlogId'); f.setSaveError(Object.assign(new Error('save failed'), { code: 'naver_network_error' }));
  await f.click(pause); assert.equal(f.state().enabled, true); assert.equal(f.accountToggle(), pause); assert.equal(pause.disabled, false); assert.equal(f.document.activeElement, pause);
  assert.equal(f.get('#naverBlogId'), input); assert.equal(input.value, 'won_cy_'); assert.equal(f.get('#naverCaptureIntakeError').hidden, false);
  f.setSaveError(null); await f.click(pause); assert.equal(f.state().enabled, false); assert.equal(f.calls.filter(call => call.kind === 'configure').length, 2);
});

test('late pause result after leaving the account view cannot repaint or refocus the stale screen', async t => {
  const f = await fixture(t, { ready: false, otherWorkspace: true }), hold = deferred(); f.setBeforeSave(() => hold.promise);
  const pause = f.accountToggle(); await f.click(pause); const prior = f.host.textContent, readCount = f.calls.filter(call => ['list', 'connections'].includes(call.kind)).length;
  f.setCurrent(false); hold.resolve(); await settle();
  assert.equal(f.host.textContent, prior); assert.equal(f.calls.filter(call => ['list', 'connections'].includes(call.kind)).length, readCount);
  assert.equal(f.document.activeElement, pause);
});

test('successful pause does not reclaim focus moved to a different control during the request', async t => {
  const f = await fixture(t, { ready: true, baseline: true }), hold = deferred(); f.setBeforeSave(() => hold.promise);
  await f.click(f.accountToggle()); const outside = f.document.createElement('button'); f.document.body.append(outside); outside.focus();
  hold.resolve(); await settle(); assert.equal(f.state().enabled, false); assert.equal(f.document.activeElement, outside);
});
