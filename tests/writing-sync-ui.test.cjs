'use strict';
// The compact writing-draft sync line (writing-sync-ui.js) under the 2026-11-16 owner rule: a state that
// went well or will run in a moment is said to screen readers only; a stop the user should know is shown.
// A tiny event DOM is enough here: the line is text, a class and buttons.
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.hidden = false; this.className = ''; this._text = ''; this.listeners = {}; }
  append(...values) { for (const value of values) { const node = typeof value === 'string' ? Object.assign(new Node('#text'), { _text: value }) : value; node.parentNode = this; this.children.push(node); } }
  replaceChildren(...values) { this.children = []; this._text = ''; this.append(...values); }
  set textContent(value) { this.children = []; this._text = String(value); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  get classList() { const node = this, names = () => node.className.split(' ').filter(Boolean); return { contains: name => names().includes(name), add: name => { if (!names().includes(name)) node.className = [...names(), name].join(' '); }, toggle(name, on = !names().includes(name)) { node.className = [...names().filter(value => value !== name), ...(on ? [name] : [])].join(' '); return on; } }; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  contains(node) { return node === this || this.children.some(child => child.contains?.(node)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { return this.children.flatMap(node => [...(selector === '#' + node.id || selector === 'button' && node.tagName === 'button' ? [node] : []), ...(node.querySelectorAll ? node.querySelectorAll(selector) : [])]); }
  focus() {}
  get isConnected() { return true; }
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
function mount(t, state, availability) {
  const previous = { document: global.document, life: global.HaedoLife };
  global.document = { createElement: tag => new Node(tag), activeElement: null, getElementById: () => null };
  delete require.cache[path.resolve(__dirname, '../assets/life/writing-sync-ui.js')];
  require('../assets/life/writing-sync-ui.js');
  t.after(() => { global.document = previous.document; global.HaedoLife = previous.life; });
  const host = new Node('details'), manager = { getState: async () => structuredClone(state), subscribe: () => () => {}, availability: () => availability };
  global.HaedoLife.WritingSyncUI.create({ host, manager, storage: { subscribe: () => () => {} }, workspaceId: 'ws', draftId: 'draft', beforeAction: async () => {}, onOpen: async () => {}, isCurrent: () => true });
  return host;
}
const line = host => { const status = host.children.find(node => node.id === 'writingSyncStatus'); return { said: status.textContent, quiet: status.classList.contains('life-save-quiet'), summary: host.children[0].textContent }; };

test('uploaded, uploading and a draft not switched on yet are said, not shown', async t => {
  for (const [status, said] of [['synced', '계정에 올림'], ['pending', '계정에 올리는 중'], ['not_enabled', '계정에 올리기 대기']]) {
    const host = mount(t, { status, enabled: status !== 'not_enabled' }, { status: 'available', until: 0 }); await settle();
    assert.deepEqual([line(host).said, line(host).quiet], [said, true], status);
  }
});

test('a draft that cannot be switched on (the automatic loop cannot reach the server) shows its wait (review n5)', async t => {
  const host = mount(t, { status: 'not_enabled', enabled: false }, { status: 'unavailable', until: Date.now() + 60000 }); await settle();
  assert.deepEqual([line(host).said, line(host).quiet], ['계정에 올리기 대기', false]);
});

test('paused, a conflict and a failure are shown; the summary keeps a settled word for screen readers only', async t => {
  for (const status of ['paused', 'conflict', 'error']) {
    const host = mount(t, { status, enabled: status !== 'paused' }, { status: 'available', until: 0 }); await settle();
    assert.equal(line(host).quiet, false, status);
  }
  const host = mount(t, { status: 'synced', enabled: true }, { status: 'available', until: 0 }); await settle();
  const summary = host.children[0];
  assert.equal(summary.textContent, '초안 동기화 · 동기화됨');
  assert.equal(summary.children.find(node => node.className === 'life-sr-only')?.textContent, ' · 동기화됨');
});
