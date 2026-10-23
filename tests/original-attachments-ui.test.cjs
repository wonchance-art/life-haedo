'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
// Event DOM for status/error lifetime only. Native controls, IDB and ZIP bytes
// are covered by the original integrated browser and capability1 account flow.
class Node {
  constructor(tag, document) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.listeners = {}; this.hidden = false; this.disabled = false; this._text = ''; this.attributes = {}; this.dataset = {}; }
  append(...items) { for (const node of items) { node.remove?.(); node.parentNode = this; this.children.push(node); } }
  replaceChildren(...items) { for (const node of this.children) node.parentNode = null; this.children = []; this._text = ''; this.append(...items); }
  remove() { if (this.parentNode) { const children = this.parentNode.children; children.splice(children.indexOf(this), 1); this.parentNode = null; } }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  async emit(name) { await Promise.all((this.listeners[name] || []).map(listener => listener({ target: this, preventDefault() {} }))); }
  querySelectorAll(selector) { const matches = node => selector[0] === '#' ? node.id === selector.slice(1) : selector[0] === '.' ? (node.className || '').split(' ').includes(selector.slice(1)) : node.tagName === selector; return this.children.flatMap(node => [...(matches(node) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  click() { return this.emit('click'); }
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
async function fixture(t, mode = 'legacy') {
  const document = { createElement: tag => new Node(tag, document) }; document.body = new Node('body', document);
  const account = { projectUrl: 'https://synthetic.supabase.co', userId: '11111111-1111-4111-8111-111111111111' };
  const auth = { getAccount: () => account, async requireUser() {}, onAccountChange() { return () => {}; } };
  let state = { mode, status: mode === 'legacy' ? 'unsupported' : 'pending', pending: mode === 'legacy' ? 0 : 1, error: null, catalogRevision: 0 }, listener, archiveError;
  const copies = [], downloads = [];
  const service = { getState: () => ({ ...state }), subscribe(fn) { listener = fn; return () => { listener = null; }; }, cancel() {}, async list() { return copies.map(value => ({ ...value })); },
    async prepare(file) { return { ticket: { part: file.part }, part: file.part, partCount: 2, sourceHead: 'a'.repeat(40), count: 1, bytes: 1, entries: [{ sourceRelativePath: 'anonymous.md', role: 'working-note-version' }] }; },
    async install(ticket) { const copy = { id: 'copy-' + ticket.part, part: ticket.part, partCount: 2, count: 1, bytes: 1 }; copies.push(copy); return copy; },
    async entries() { return []; }, async archive() { if (archiveError) throw archiveError; return { blob: new Blob(['synthetic']), name: 'anonymous.zip' }; } };
  const sandbox = { document, AbortController, setTimeout: () => 0, clearTimeout() {}, URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:synthetic'; }, revokeObjectURL() {} }, HaedoLife: { OriginalAttachments: { create() { throw Error('Shared service must be used'); } } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/life/original-attachments-ui.js'), 'utf8'), sandbox);
  const ui = await sandbox.HaedoLife.OriginalAttachmentsUI.open({ auth, service }); t.after(() => ui.dispose());
  const get = selector => { const node = document.body.querySelector(selector); assert(node, selector); return node; };
  const click = async node => { assert.equal(node.disabled, false); await node.emit('click'); await settle(); };
  const batch = async () => { get('#originalAttachmentsFile').files = [{ part: 1 }, { part: 2 }]; await get('#originalAttachmentsFile').emit('change'); await settle(); await click(get('#originalAttachmentsInstall')); };
  return { get, click, batch, downloads, setError(error) { archiveError = error; }, async state(value = {}) { state = { ...state, ...value }; listener?.({ ...state }); await settle(); } };
}
test('legacy unsupported hint is initial only; batch completion and download status survive final sync refresh', async t => {
  const f = await fixture(t); assert.match(f.get('#originalAttachmentsStatus').textContent, /계정 원본 연동을 사용할 수 없습니다/);
  await f.batch(); assert.match(f.get('#originalAttachmentsStatus').textContent, /2개 파트.*보관/);
  await f.state(); assert.match(f.get('#originalAttachmentsStatus').textContent, /2개 파트.*보관/);
  const download = f.get('#originalAttachmentsCopies').querySelectorAll('button').find(node => node.textContent === '파트 원본 ZIP 받기');
  await f.click(download); assert.equal(f.downloads.length, 1); assert.match(f.get('#originalAttachmentsStatus').textContent, /다운로드를 요청했습니다/);
  await f.state(); assert.match(f.get('#originalAttachmentsStatus').textContent, /다운로드를 요청했습니다/);
});
test('account pending remains unacknowledged and corruption errors survive later saved notifications', async t => {
  const f = await fixture(t, 'account'); await f.batch(); assert.match(f.get('#originalAttachmentsStatus').textContent, /계정 보관 대기 1개/); assert.doesNotMatch(f.get('#originalAttachmentsStatus').textContent, /계정에 보관했습니다/);
  await f.state({ status: 'saved', pending: 0 }); assert.match(f.get('#originalAttachmentsStatus').textContent, /계정에 보관했습니다/);
  f.setError(new Error('원본 파일 해시 불일치'));
  const download = f.get('#originalAttachmentsCopies').querySelectorAll('button').find(node => node.textContent === '파트 원본 ZIP 받기');
  await f.click(download); assert.equal(f.get('#originalAttachmentsError').hidden, false); assert.match(f.get('#originalAttachmentsError').textContent, /해시 불일치/);
  await f.state(); assert.equal(f.get('#originalAttachmentsError').hidden, false); assert.match(f.get('#originalAttachmentsError').textContent, /해시 불일치/);
});
