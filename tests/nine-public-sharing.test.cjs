'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
// Event DOM only: native modal geometry, image opt-in and focus trapping belong
// to the independent actual-browser suite.
class Node {
  constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.disabled = false; this.checked = false; this.hidden = false; this.value = ''; this._text = ''; }
  append(...values) { for (const value of values) { const node = typeof value === 'string' ? this.ownerDocument.createTextNode(value) : value; node.parentNode = this; this.children.push(node); } }
  replaceChildren(...values) { this.children.forEach(node => { node.parentNode = null; }); this.children = []; this._text = ''; this.append(...values); }
  remove() { if (!this.parentNode) return; const parent = this.parentNode; parent.children.splice(parent.children.indexOf(this), 1); this.parentNode = null; }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  async emit(name) { const event = { type: name, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; await Promise.all((this.listeners[name] || []).map(fn => fn(event))); return event; }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; void this.emit('close'); }
  matches(selector) { return selector.split(',').some(part => part.startsWith('#') ? this.id === part.slice(1) : part.startsWith('.') ? (this.className || '').split(' ').includes(part.slice(1)) : this.tagName === part); }
  querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function documentFixture() { const doc = { createElement: tag => new Node(tag, doc), createTextNode: text => { const node = new Node('#text', doc); node.textContent = text; return node; }, activeElement: null }; doc.body = new Node('body', doc); return doc; }
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
function deferred() { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; }
const ws = '11111111-1111-4111-8111-111111111111', boardId = '22222222-2222-4222-8222-222222222222', areaId = '33333333-3333-4333-8333-333333333333', publicId = '44444444-4444-4444-8444-444444444444';
async function fixture(t, options = {}) {
  const old = { document: global.document, life: global.HaedoLife, location: global.location, auth: global.HaedoAuth };
  const document = documentFixture(); global.document = document; global.location = { href: 'https://example.test/app/index.html' }; global.HaedoAuth = {};
  const NineBoard = require('../assets/life/nine-board.js'), NinePublic = require('../assets/life/nine-public.js');
  const source = NineBoard.empty(ws), board = NineBoard.create((() => { let n = 0; return () => n++ ? areaId : boardId; })()); board.title = '취향을 고른 아홉 칸'; board.intro = 'PRIVATE_INTRO'; board.areas[0].title = '직접 고른 책'; board.areas[0].note = 'PRIVATE_NOTE'; board.areas[0].items.push({ attachment: { type: 'book', title: '허용된 책 제목', creator: '만든 사람', url: 'https://example.org/book' }, reason: 'PRIVATE_REASON' });
  board.areas.push({ id: 'other-area', title: 'PRIVATE_OTHER_AREA', note: '', items: [] }); source.boards.push(board); source.revision = 3;
  const publishedSnapshot = options.published ? NinePublic.project(source, { boardId, areaId, title: options.published.title, intro: options.published.intro }).snapshot : null;
  let scope = true, state = options.published ? { status: 'published', revision: 2, publicId, pending: false } : { status: 'missing', revision: 0, publicId: null, pending: false }, failState = false, mode = 'stored', holdPrepare = null, holdPublish = null, disposed = 0, viewDisposed = 0;
  const calls = [], reviews = new WeakSet(), storage = { readNineBoard: async () => structuredClone(source) };
  const remote = {
    getPublished: async id => { calls.push(['published', id]); const result = { state: structuredClone(state), snapshot: publishedSnapshot }; if (options.holdInitial) await options.holdInitial.promise; if (options.failPublished) throw Error('공개 내용 읽기 실패'); return result; },
    getState: async id => { calls.push(['state', id]); if (failState) throw Error('상태 조회 실패'); return structuredClone(state); },
    prepare: async options => { calls.push(['prepare', structuredClone(options)]); const review = NinePublic.project(await storage.readNineBoard(ws), options); if (holdPrepare) await holdPrepare.promise; reviews.add(review); return review; },
    publish: async (review, options) => {
      assert(reviews.has(review)); reviews.delete(review); calls.push(['publish', review, options]);
      if (review.localRevision !== source.revision) throw Object.assign(Error('9칸 구성이 바뀌었습니다.'), { code: 'local_changed' });
      if (holdPublish) await holdPublish.promise;
      if (mode === 'unknown') { state = { status: 'published', revision: 1, publicId, pending: true }; throw Object.assign(Error('게시 결과 미확인'), { code: 'publish_unknown' }); }
      if (mode === 'conflict') { state = { status: 'published', revision: 4, publicId, pending: false }; return { status: 'conflict', state }; }
      state = { status: 'published', revision: state.revision + 1, publicId, pending: false }; return { status: 'stored', state };
    },
    retry: async id => { calls.push(['retry', id]); state = { ...state, pending: false }; return { status: 'stored', state }; },
    revoke: async (id, options) => { calls.push(['revoke', id, options]); state = { status: 'revoked', revision: state.revision + 1, publicId: null, pending: false }; return { status: 'stored', state }; },
    dispose: () => { disposed++; },
  };
  global.HaedoLife = { NineBoard, NinePublic, NinePublicRemote: { create: options => { assert.equal(options.storage, storage); assert.equal(options.workspaceId, ws); return remote; } },
    NinePublicView: { render(snapshot) { const data = NinePublic.parse(snapshot), node = document.createElement('article'); node.textContent = JSON.stringify(data); return { node, dispose() { viewDisposed++; node.replaceChildren(); } }; } } };
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../assets/life/nine-public-sharing.js'), 'utf8'));
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const dispose = await global.HaedoLife.NinePublicSharing.open({ storage, workspaceId: ws, boardId, areaId, isCurrent: () => scope }); await settle();
  t.after(() => { dispose(); global.document = old.document; global.HaedoLife = old.life; global.location = old.location; global.HaedoAuth = old.auth; });
  const get = selector => { const node = document.body.querySelector(selector); assert.ok(node, selector); return node; };
  const click = async selector => { const node = get(selector); assert.equal(node.disabled, false, selector); await node.emit('click'); await settle(); };
  return { get, click, calls, source, trigger, document, dispose, remote, state: () => state, setMode: value => { mode = value; }, setScope: value => { scope = value; }, setFailState: value => { failState = value; }, setHoldPrepare: value => { holdPrepare = value; }, setHoldPublish: value => { holdPublish = value; }, disposed: () => disposed, viewDisposed: () => viewDisposed };
}

test('public fields begin with an empty manual introduction and preview contains only the safe selected area', async t => {
  const f = await fixture(t); assert.equal(f.get('#nineShareIntro').value, ''); assert.equal(f.get('#nineShareConsent').checked, false);
  assert.equal(f.calls.filter(row => !['state', 'published'].includes(row[0])).length, 0);
  await f.click('#nineSharePrepare'); const projection = f.get('#nineSharePreview').textContent;
  assert.match(projection, /허용된 책 제목/); assert.match(projection, /직접 고른 책/);
  for (const sentinel of ['PRIVATE_INTRO', 'PRIVATE_NOTE', 'PRIVATE_REASON', 'PRIVATE_OTHER_AREA', ws, boardId, areaId]) assert(!projection.includes(sentinel));
  assert.deepEqual(f.calls.find(row => row[0] === 'prepare')[1], { boardId, areaId, title: f.source.boards[0].title, intro: null });
  assert.equal(f.get('#nineShareConsent').checked, false);
});

test('every publication attempt consumes review and consent; a CAS conflict requires a new reviewed revision', async t => {
  const f = await fixture(t); await f.click('#nineSharePublish'); assert.equal(f.calls.filter(row => row[0] === 'publish').length, 0);
  await f.click('#nineSharePrepare'); f.get('#nineShareConsent').checked = true; f.setMode('conflict'); await f.click('#nineSharePublish');
  assert.equal(f.get('#nineShareConsent').checked, false); assert.equal(f.get('#nineSharePreview').children.length, 0);
  await f.click('#nineSharePublish'); assert.equal(f.calls.filter(row => row[0] === 'publish').length, 1);
  f.setMode('stored'); await f.click('#nineSharePrepare'); f.get('#nineShareConsent').checked = true; await f.click('#nineSharePublish');
  assert.equal(f.calls.filter(row => row[0] === 'publish')[1][2].expectedRevision, 4);
  assert.equal(f.get('#nineSharePublication').querySelector('a').href, `https://example.test/app/taste.html?nine=${publicId}`);
  assert.equal(f.get('#nineShareConsent').checked, false);
});

test('input changes and composition dispose the preview and held older preparation cannot reinstall it', async t => {
  const f = await fixture(t); await f.click('#nineSharePrepare'); f.get('#nineShareConsent').checked = true;
  const intro = f.get('#nineShareIntro'); intro.value = '직접 공개 소개'; await intro.emit('input');
  assert.equal(f.get('#nineShareConsent').checked, false); assert.equal(f.get('#nineSharePreview').children.length, 0); assert.equal(f.viewDisposed(), 1);
  await intro.emit('compositionstart'); await f.click('#nineSharePrepare'); assert.equal(f.calls.filter(row => row[0] === 'prepare').length, 1); await intro.emit('compositionend');
  const hold = deferred(); f.setHoldPrepare(hold); const preparing = f.get('#nineSharePrepare').emit('click'); await settle(); intro.value = '나중 입력'; await intro.emit('input'); hold.resolve(); await preparing;
  assert.equal(f.get('#nineSharePreview').children.length, 0); assert.equal(f.get('#nineShareIntro'), intro); assert.equal(intro.value, '나중 입력');
});

test('a lost response retries the durable request separately and revocation requires its own explicit consent', async t => {
  const f = await fixture(t); await f.click('#nineSharePrepare'); f.get('#nineShareConsent').checked = true; f.setMode('unknown'); await f.click('#nineSharePublish');
  assert.equal(f.get('#nineShareConsent').checked, false); assert.match(f.get('.nine-share-error').textContent, /미확인/);
  await f.click('#nineShareRetry'); assert.equal(f.calls.filter(row => row[0] === 'publish').length, 1); assert.equal(f.calls.filter(row => row[0] === 'retry').length, 1);
  assert.equal(f.get('#nineShareStatus').dataset.state, 'published'); assert.ok(f.get('#nineSharePublication').querySelector('a'));
  await f.click('#nineShareRevoke'); assert.equal(f.calls.filter(row => row[0] === 'revoke').length, 0);
  f.get('#nineShareRevokeConsent').checked = true; await f.click('#nineShareRevoke');
  assert.equal(f.get('#nineShareRevokeConsent').checked, false); assert.equal(f.get('#nineShareStatus').dataset.state, 'revoked'); assert.equal(f.get('#nineSharePublication').children.length, 0);
});

test('source changes after preview reject publishing and cannot reuse the consumed consent', async t => {
  const f = await fixture(t); await f.click('#nineSharePrepare'); f.get('#nineShareConsent').checked = true; f.source.revision++;
  await f.click('#nineSharePublish'); assert.match(f.get('.nine-share-error').textContent, /구성이 바뀌/); assert.equal(f.get('#nineShareConsent').checked, false);
  await f.click('#nineSharePublish'); assert.equal(f.calls.filter(row => row[0] === 'publish').length, 1);
});

test('busy close and Escape are blocked; disposal and late account results cannot revive the dialog', async t => {
  const f = await fixture(t); await f.click('#nineSharePrepare'); f.get('#nineShareConsent').checked = true;
  const hold = deferred(); f.setHoldPublish(hold); const publishing = f.get('#nineSharePublish').emit('click'); await settle();
  assert.equal(f.get('#nineShareClose').disabled, true); const cancel = await f.get('#nineShare').emit('cancel'); assert.equal(cancel.defaultPrevented, true);
  await f.get('#nineShareClose').emit('click'); assert.equal(f.get('#nineShare').open, true);
  f.setScope(false); f.dispose(); hold.resolve(); await publishing; await settle();
  assert.equal(f.document.body.querySelector('#nineShare'), null); assert.equal(f.disposed(), 1);
});

test('failed state refresh preserves field DOM and marks an old address as last confirmed; closing restores the trigger focus', async t => {
  const f = await fixture(t); await f.click('#nineSharePrepare'); f.get('#nineShareConsent').checked = true; await f.click('#nineSharePublish');
  const title = f.get('#nineSharePublicTitle'), intro = f.get('#nineShareIntro'); intro.value = '유지할 공개 소개'; await intro.emit('input');
  f.setFailState(true); await f.click('#nineShareRefresh');
  assert.equal(f.get('#nineSharePublicTitle'), title); assert.equal(f.get('#nineShareIntro'), intro); assert.equal(intro.value, '유지할 공개 소개');
  assert.equal(f.get('#nineShareStatus').dataset.state, 'error'); assert.match(f.get('#nineSharePublication').textContent, /마지막 확인/);
  await f.click('#nineShareClose'); assert.equal(f.document.activeElement, f.trigger); assert.equal(f.disposed(), 1);
});

test('opening an already-published area restores only its public title and introduction; later status refresh preserves manual edits', async t => {
  const f = await fixture(t, { published: { title: '직접 공개한 제목', intro: '이전에 직접 쓴 공개 소개\n다음 문장' } });
  assert.equal(f.get('#nineSharePublicTitle').value, '직접 공개한 제목'); assert.equal(f.get('#nineShareIntro').value, '이전에 직접 쓴 공개 소개\n다음 문장');
  assert.equal(f.get('#nineShareConsent').checked, false); assert.equal(f.get('#nineSharePreview').children.length, 0);
  const title = f.get('#nineSharePublicTitle'), intro = f.get('#nineShareIntro'); title.value = '이번에 수정 중인 제목'; await title.emit('input'); intro.value = '이번 공개 소개'; await intro.emit('input');
  await f.click('#nineShareRefresh'); assert.equal(title.value, '이번에 수정 중인 제목'); assert.equal(intro.value, '이번 공개 소개');
  assert.equal(f.calls.filter(row => row[0] === 'published').length, 1); assert.equal(f.calls.filter(row => ['publish', 'revoke', 'retry'].includes(row[0])).length, 0);
});

for (const mode of ['input', 'composition', 'account']) test(`the opening public snapshot cannot overwrite ${mode} that changed while reading`, async t => {
  const hold = deferred(), f = await fixture(t, { published: { title: '늦은 공개 제목', intro: '늦은 공개 소개' }, holdInitial: hold });
  const title = f.get('#nineSharePublicTitle'), intro = f.get('#nineShareIntro');
  if (mode === 'input') { intro.value = '지금 작성한 소개'; await intro.emit('input'); }
  if (mode === 'composition') { await intro.emit('compositionstart'); intro.value = '조합 중인 소개'; }
  if (mode === 'account') f.setScope(false);
  const expectedTitle = title.value, expectedIntro = intro.value; hold.resolve(); await settle();
  assert.equal(title.value, expectedTitle); assert.equal(intro.value, expectedIntro); assert.equal(f.get('#nineShareConsent').checked, false);
  assert.equal(f.calls.filter(row => ['publish', 'revoke', 'retry'].includes(row[0])).length, 0);
});

test('a failed opening public snapshot reports the read failure and leaves the initial fields available', async t => {
  const f = await fixture(t, { published: { title: '읽지 못한 공개 제목', intro: '읽지 못한 공개 소개' }, failPublished: true });
  assert.equal(f.get('#nineSharePublicTitle').value, f.source.boards[0].title); assert.equal(f.get('#nineShareIntro').value, '');
  assert.match(f.get('.nine-share-error').textContent, /이전 공개 제목·소개를 읽지 못/); assert.equal(f.get('#nineShareIntro').disabled, false);
  await f.click('#nineShareRefresh'); assert.equal(f.get('#nineShareStatus').dataset.state, 'published'); assert.equal(f.get('#nineShareIntro').value, '');
  assert.equal(f.calls.filter(row => ['publish', 'revoke', 'retry'].includes(row[0])).length, 0);
});
