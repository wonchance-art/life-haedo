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
  const Core = require('../assets/life/core.js'), M = require('../assets/life/public-cover.js'), ws = Core.id(), baseURL = 'https://example.org/haedo/index.html';
  const initial = M.create(Core.id); initial.title = '처음 표지'; let db = { ...M.empty(ws), covers: [initial] }, scope = true, beforeSave, failRead = !!options.initialFailRead;
  let metadata = { status: 'missing', revision: 0, publicId: null, pending: false }, catalogFailure = false, cursor = null;
  const rows = [ ['post', '공개 여행 글'], ['series', '여행 연재'], ['nine', '읽은 책 9칸'] ].map(([kind, title]) => ({ kind, title, publicId: Core.id(), intro: kind === 'post' ? '' : '이미 공개한 소개', publicationRevision: 1 }));
  const calls = [], saves = [], holds = {}, clone = value => structuredClone(value);
  const storage = {
    readPublicCover: async () => { if (failRead) throw Error('로컬 표지 읽기 실패'); return clone(db); },
    savePublicCover: async (workspaceId, value, base) => { if (beforeSave) await beforeSave(); M.validateState(value); assert.equal(workspaceId, ws); if (base !== db.revision) throw Object.assign(Error('다른 탭에서 표지를 보관했습니다'), { code: 'public_cover_conflict' }); db = { ...clone(value), revision: base + 1 }; saves.push(clone(db)); return clone(db); }
  };
  const remote = {
    catalog: async input => { calls.push(['catalog', input]); if (holds.catalog) await holds.catalog; return { items: clone(rows), errors: catalogFailure ? [{ kind: 'pages', message: '일부 공개 항목 조회 실패' }] : [], nextCursor: cursor }; },
    getState: async id => { calls.push(['getState', id]); if (holds.state) await holds.state; if (holds.stateError) throw holds.stateError; return clone(metadata); },
    prepare: async id => {
      calls.push(['prepare', id]); if (holds.prepare) await holds.prepare; const cover = db.covers.find(value => value.id === id), snapshot = M.project(cover, baseURL);
      return { coverId: id, localRevision: db.revision, cover: clone(cover), snapshot, preview: { status: 'published', title: cover.title, intro: cover.intro, items: cover.items.map(item => rows.find(value => value.kind === item.kind && value.publicId === item.publicId)) } };
    },
    publish: async (review, expected) => { calls.push(['publish', review, expected]); if (holds.publish) await holds.publish; if (holds.publishError) { metadata.pending = true; throw holds.publishError; } metadata = { status: 'published', revision: 1, publicId: Core.id(), pending: false }; return { status: 'stored', state: clone(metadata) }; },
    retry: async id => { calls.push(['retry', id]); metadata = { ...metadata, status: 'published', revision: 1, publicId: metadata.publicId || Core.id(), pending: false }; return { status: 'stored', state: clone(metadata) }; },
    revoke: async (id, expected) => { calls.push(['revoke', id, expected]); metadata = { ...metadata, status: 'revoked', revision: metadata.revision + 1, pending: false }; return { status: 'stored', state: clone(metadata) }; },
    dispose() { calls.push(['dispose']); }
  };
  global.HaedoLife = { Core, PublicCover: M, PublicCoverView: { render(value, renderOptions) { calls.push(['render', clone(value), renderOptions]); const node = document.createElement('article'); node.append(value.title, value.intro || '', ...value.items.map(item => item.title)); return node; } } };
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../assets/life/public-cover-ui.js'), 'utf8'));
  const host = document.createElement('main'); document.body.append(host);
  const ui = global.HaedoLife.PublicCoverUI.create({ host, storage, workspaceId: ws, baseURL, remote, isCurrent: () => scope, ...options });
  await ui.ready; t.after(() => { ui.dispose(); global.document = previous.document; global.HaedoLife = previous.life; });
  const get = selector => { const node = host.querySelector(selector); assert.ok(node, selector); return node; };
  const click = async selector => { const node = get(selector); assert.equal(node.disabled, false, selector); await node.emit('click'); await settle(); };
  const input = async (selector, text) => { const node = get(selector); assert.equal(node.disabled, false, selector); node.value = text; await node.emit('input'); return node; };
  const add = async index => { const row = get('#pcCatalog').children[index], node = row.querySelector('button'); assert.equal(node.disabled, false); await node.emit('click'); await settle(); };
  const preview = async () => { await click('#pcReview'); get('#pcConsent').checked = true; };
  return { ui, get, host, click, input, add, preview, calls, saves, holds, Core, M, ws, rows, document, storage, db: () => clone(db), setDb: value => { db = clone(value); }, setBeforeSave: value => { beforeSave = value; }, setScope: value => { scope = value; }, setFailRead: value => { failRead = value; }, setMetadata: value => { metadata = value; }, setPartial: value => { catalogFailure = value; }, setCursor: value => { cursor = value; } };
}

test('direct selection and order edits autosave only public URL pointers; full preview is shared and consent starts off', async t => {
  const f = await fixture(t), title = await f.input('#pcTitle', '여행 읽기 안내'), intro = await f.input('#pcIntro', '직접 적은 소개'); await f.add(0); await f.add(2);
  const second = f.get('#pcItems').children[1]; await second.querySelector('[data-action="up"]').emit('click'); await settle(); await f.ui.flush();
  assert.deepEqual(f.db().covers[0].items.map(item => item.kind), ['nine', 'post']); assert.ok(f.get('#pcTitle') === title); assert.ok(f.get('#pcIntro') === intro); assert.equal(f.get('#pcSaveStatus').dataset.state, 'saved');
  await f.click('#pcReview'); assert.notEqual(f.get('#pcConsent').checked, true); const render = f.calls.find(value => value[0] === 'render'); assert.equal(render[2].preview, true); assert.deepEqual(render[1].items.map(item => item.title), ['읽은 책 9칸', '공개 여행 글']);
  assert.match(f.get('#pcPreview').textContent, /직접 적은 소개/); assert.equal(f.calls.filter(c => ['publish', 'revoke'].includes(c[0])).length, 0);
  const wire = f.M.project(f.db().covers[0], 'https://example.org/haedo/index.html'); assert.ok(!JSON.stringify(wire).includes('공개 여행 글')); assert.ok(!JSON.stringify(f.db()).includes('publicationRevision'));
});

test('explicit publish consumes the exact reviewed version and later edits require a fresh preview', async t => {
  const f = await fixture(t); await f.add(0); await f.preview(); await f.input('#pcIntro', '검토 후 고친 소개'); assert.equal(f.get('#pcPreview').children.length, 0); assert.equal(f.get('#pcConsent').checked, false);
  await f.click('#pcPublish'); assert.equal(f.calls.filter(c => c[0] === 'publish').length, 0); await f.preview(); await f.click('#pcPublish');
  const sent = f.calls.find(c => c[0] === 'publish'); assert.deepEqual(sent[2], { expectedRevision: 0 }); assert.equal(sent[1].cover.intro, '검토 후 고친 소개'); assert.equal(f.get('#pcConsent').checked, false); assert.equal(f.get('#pcStatus').dataset.state, 'published'); assert.match(f.get('#pcPublication').querySelector('a').href, /cover.html\?cover=/);
});

test('IME and invalid fields retain original DOM, selection and text while blocking save and page exit', async t => {
  const f = await fixture(t), title = f.get('#pcTitle'); title.focus(); title.setSelectionRange(1, 3, 'backward'); await title.emit('compositionstart'); title.value = '아직 한글 조합'; await title.emit('input');
  await assert.rejects(f.ui.flush(), { code: 'public_cover_composing' }); await f.click('#pcNew'); assert.ok(f.get('#pcTitle') === title); assert.equal(title.value, '아직 한글 조합'); assert.equal(title.selectionDirection, 'backward');
  await title.emit('compositionend'); await f.ui.flush(); await f.input('#pcTitle', '\ud800'); await assert.rejects(f.ui.flush(), { code: 'public_cover_input' }); assert.ok(f.get('#pcTitle') === title); assert.equal(title.value, '\ud800');
  await f.input('#pcTitle', '고친 제목'); await f.ui.flush(); assert.equal(f.db().covers[0].title, '고친 제목');
});

test('serialized local saves retain newer keystrokes and a storage failure never recreates the form', async t => {
  const f = await fixture(t), wait = deferred(); let first = true; f.setBeforeSave(async () => { if (first) { first = false; await wait.promise; } });
  const title = await f.input('#pcTitle', '첫 입력'), saving = f.ui.flush(); await settle(); await f.input('#pcTitle', '나중 입력'); wait.resolve(); await saving; assert.equal(f.db().covers[0].title, '나중 입력'); assert.equal(f.saves.length, 2);
  f.setBeforeSave(() => { throw Object.assign(Error('주입한 저장 실패'), { code: 'storage_failed' }); }); await f.input('#pcIntro', '저장 실패에도 남는 소개'); await assert.rejects(f.ui.flush(), { code: 'storage_failed' }); assert.ok(f.get('#pcTitle') === title); assert.equal(f.get('#pcSaveStatus').dataset.state, 'error');
  f.setBeforeSave(null); await f.click('#pcSaveRetry'); assert.equal(f.db().covers[0].intro, '저장 실패에도 남는 소개'); assert.equal(f.get('#pcSaveStatus').dataset.state, 'saved');
});

test('CAS recovery appends a new unpublished cover and item IDs without overwriting the winner', async t => {
  const f = await fixture(t); await f.add(0); await f.ui.flush(); const before = f.db(), other = f.db(); other.revision++; other.covers[0].title = '다른 탭의 표지'; f.setDb(other);
  const title = await f.input('#pcTitle', '내가 고친 표지'); await assert.rejects(f.ui.flush(), { code: 'public_cover_conflict' }); assert.ok(f.get('#pcTitle') === title); await f.click('#pcRecover');
  const after = f.db(); assert.equal(after.covers[0].title, '다른 탭의 표지'); assert.equal(after.covers[1].title, '내가 고친 표지'); assert.notEqual(after.covers[1].id, before.covers[0].id); assert.notEqual(after.covers[1].items[0].id, before.covers[0].items[0].id); assert.equal(after.covers[1].items[0].publicId, before.covers[0].items[0].publicId); assert.equal(f.get('#pcStatus').dataset.state, 'missing');
});

test('readonly public-state refresh permits typing and preserves the exact field node and caret', async t => {
  const f = await fixture(t), title = f.get('#pcTitle'), wait = deferred(); title.focus(); title.setSelectionRange(1, 3, 'backward'); f.holds.state = wait.promise;
  const refreshing = f.get('#pcRefresh').emit('click'); await settle(); assert.equal(title.disabled, false); await f.input('#pcTitle', '상태 확인 중에도 쓰는 제목');
  await assert.rejects(f.ui.flush(), { code: 'public_cover_busy' }); wait.resolve(); await refreshing; await f.ui.flush(); assert.ok(f.get('#pcTitle') === title); assert.equal(title.value, '상태 확인 중에도 쓰는 제목'); assert.equal(title.selectionStart, 1); assert.equal(title.selectionDirection, 'backward');
});

test('unknown publication retries the original approved request while local newer input stays private', async t => {
  const f = await fixture(t); await f.add(0); await f.preview(); f.holds.publishError = Object.assign(Error('응답을 잃었습니다'), { code: 'network_error' }); await f.click('#pcPublish');
  assert.equal(f.get('#pcStatus').dataset.state, 'pending'); assert.equal(f.get('#pcRetry').hidden, false); assert.equal(f.get('#pcPublish').disabled, true); assert.equal(f.get('#pcConsent').checked, false);
  await f.input('#pcTitle', '아직 공개하지 않은 새 제목'); await f.ui.flush(); await f.click('#pcRetry'); assert.equal(f.calls.filter(c => c[0] === 'publish').length, 1); assert.equal(f.calls.filter(c => c[0] === 'retry').length, 1); assert.equal(f.get('#pcTitle').value, '아직 공개하지 않은 새 제목'); assert.equal(f.get('#pcStatus').dataset.state, 'published');
});

test('independent revoke needs its own default-off consent and changes no local or target data', async t => {
  const f = await fixture(t); await f.add(1); await f.preview(); await f.click('#pcPublish'); const before = f.db(); assert.notEqual(f.get('#pcRevokeConsent').checked, true); await f.click('#pcRevoke'); assert.equal(f.calls.filter(c => c[0] === 'revoke').length, 0);
  f.get('#pcRevokeConsent').checked = true; await f.click('#pcRevoke'); assert.deepEqual(f.calls.find(c => c[0] === 'revoke').slice(1), [before.covers[0].id, { expectedRevision: 1 }]); assert.deepEqual(f.db(), before); assert.equal(f.get('#pcStatus').dataset.state, 'revoked'); assert.equal(f.get('#pcRevokeConsent').checked, false);
});

test('partial catalog results preserve selections and late account preview responses never replace another account screen', async t => {
  const f = await fixture(t); await f.add(0); await f.ui.flush(); f.setPartial(true); await f.click('#pcCatalogRefresh'); assert.equal(f.get('#pcCatalogStatus').dataset.state, 'partial'); assert.equal(f.get('#pcItems').children.length, 1);
  const wait = deferred(); f.holds.prepare = wait.promise; const preparing = f.get('#pcReview').emit('click'); await settle(); assert.equal(f.get('#pcTitle').disabled, true); await assert.rejects(f.ui.flush(), { code: 'public_cover_busy' });
  f.setScope(false); const before = f.host.textContent; wait.resolve(); await preparing; assert.equal(f.host.textContent, before); assert.equal(f.get('#pcPreview').children.length, 0); assert.equal(f.calls.filter(c => c[0] === 'publish').length, 0);
});

test('an initial local read failure can retry without marking absent data saved or creating a cover', async t => {
  const f = await fixture(t, { initialFailRead: true }); assert.equal(f.get('#pcSaveStatus').dataset.state, 'error'); assert.equal(f.get('#pcNew').disabled, true); assert.equal(f.saves.length, 0);
  f.setFailRead(false); await f.click('#pcSaveRetry'); assert.equal(f.get('#pcTitle').value, '처음 표지'); assert.equal(f.get('#pcSaveStatus').dataset.state, 'saved'); assert.equal(f.get('#pcNew').disabled, false); assert.equal(f.saves.length, 0);
});

test('a lost acknowledgement followed by a failed status read still exposes same-request retry and keeps all current input', async t => {
  const f = await fixture(t); await f.add(0); await f.preview(); f.holds.publishError = Error('게시 응답 유실'); f.holds.stateError = Error('후속 상태 조회 실패'); await f.click('#pcPublish');
  assert.equal(f.get('#pcRetry').hidden, false); assert.equal(f.get('#pcPublish').disabled, true); assert.equal(f.get('#pcTitle').value, '처음 표지'); assert.equal(f.get('#pcConsent').checked, false);
  delete f.holds.stateError; await f.click('#pcRetry'); assert.equal(f.calls.filter(c => c[0] === 'publish').length, 1); assert.equal(f.calls.filter(c => c[0] === 'retry').length, 1); assert.equal(f.get('#pcStatus').dataset.state, 'published');
});

test('late input during recovery retains the winner and committed copy; the conflict guard prevents a subsequent stale-wrapper save', async t => {
  const f = await fixture(t); await f.add(0); await f.ui.flush(); const latest = f.db(); latest.revision++; latest.covers[0].title = '다른 탭의 승자'; f.setDb(latest);
  const title = await f.input('#pcTitle', '복구 시점의 내 제목'); await assert.rejects(f.ui.flush(), { code: 'public_cover_conflict' });
  f.setBeforeSave(async () => {
    // Native input is locked here. Inject a queued/programmatic event to exercise
    // the defensive post-commit branch without weakening normal control locks.
    assert.equal(title.disabled, true); title.value = '복구 저장 중 추가한 입력'; await title.emit('input');
  });
  await f.click('#pcRecover'); const committed = f.db(); assert.equal(committed.covers.length, 2); assert.equal(committed.covers[0].title, '다른 탭의 승자'); assert.equal(committed.covers[1].title, '복구 시점의 내 제목');
  assert.ok(f.get('#pcTitle') === title); assert.equal(title.value, '복구 저장 중 추가한 입력'); assert.equal(f.get('#pcSaveStatus').dataset.state, 'error');
  const writes = f.saves.length; f.setBeforeSave(null); await assert.rejects(f.ui.flush(), { code: 'public_cover_conflict' }); await f.click('#pcSaveRetry'); assert.equal(f.saves.length, writes); assert.deepEqual(f.db(), committed);
  await f.click('#pcRecover'); assert.equal(f.db().covers.length, 3); assert.equal(f.db().covers[0].title, '다른 탭의 승자'); assert.equal(f.db().covers[1].title, '복구 시점의 내 제목'); assert.equal(f.db().covers[2].title, '복구 저장 중 추가한 입력');
});
