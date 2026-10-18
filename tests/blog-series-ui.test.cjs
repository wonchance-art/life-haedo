'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// A deliberately small event DOM exercises async editor ownership, not layout.
class Node {
  constructor(tag, owner) { this.tagName = tag; this.ownerDocument = owner; this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.disabled = false; this.hidden = false; this.value = ''; this._text = ''; }
  append(...values) { for (const value of values) { const child = typeof value === 'string' ? new Node('#text', this.ownerDocument) : value; if (typeof value === 'string') child._text = value; child.parentNode = this; this.children.push(child); } }
  replaceChildren(...values) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...values); }
  after(child) { const parent = this.parentNode; child.parentNode = parent; parent.children.splice(parent.children.indexOf(this) + 1, 0, child); }
  remove() { if (!this.parentNode) return; const parent = this.parentNode; parent.children.splice(parent.children.indexOf(this), 1); this.parentNode = null; }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  async emit(name) { await Promise.all((this.listeners[name] || []).map(fn => fn({ target: this, type: name }))); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return (this.className || '').split(' ').includes(selector.slice(1));
    const data = selector.match(/^\[data-([a-z-]+)="([^"]*)"\]$/);
    if (data) return this.dataset[data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === data[2];
    return this.tagName === selector;
  }
  querySelectorAll(selector) { const result = []; for (const child of this.children) { if (child.matches(selector)) result.push(child); result.push(...child.querySelectorAll(selector)); } return result; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function documentFixture() { const doc = { createElement: tag => new Node(tag, doc), activeElement: null }; doc.body = new Node('body', doc); return doc; }
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 5; i++) await tick(); }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function fixture(t, options = {}) {
  const oldDocument = global.document, oldLife = global.HaedoLife;
  const doc = documentFixture(); global.document = doc;
  const PhotoPost = require('../assets/life/photo-post.js'), Model = require('../assets/life/blog-series.js');
  let id = 0; global.HaedoLife = { PhotoPost, BlogSeries: Model, Core: { id: () => `fresh_${++id}` } };
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../assets/life/blog-series-ui.js'), 'utf8'));
  const clone = value => structuredClone(value), initial = Model.empty('ws'); initial.series.push(Model.create(() => 'original'));
  const docs = new Map();
  for (const [key, title, status, archived] of [['one', '부산 첫날', 'saved', false], ['two', '부산 둘째날', 'saved', false], ['draft', '미완료', 'draft', false], ['archive', '보관함', 'saved', true]]) {
    const post = PhotoPost.create(() => key); post.title = title; post.status = status; post.revision = 1; post.ops = [{ insert: `${title}의 여행 본문\n` }]; post.archived = archived; docs.set(key, post);
  }
  let db = clone(initial), saves = [], beforeSave = null, listFailure = null, scope = true;
  const captured = new Set();
  const storage = {
    readBlogSeries: async () => clone(db),
    saveBlogSeries: async (ws, input, base) => {
      if (beforeSave) await beforeSave(input);
      Model.validate(input);
      if (base !== db.revision) throw Object.assign(new Error('다른 탭에서 모음이 바뀌었습니다.'), { code: 'blog_series_conflict' });
      for (const series of input.series) for (const item of series.items) {
        const key = JSON.stringify([item.postId, item.postRevision, item.title]), post = docs.get(item.postId);
        if (!captured.has(key)) { assert.equal(post?.revision, item.postRevision); captured.add(key); }
      }
      db = { ...clone(input), revision: base + 1 }; saves.push(clone(db)); return clone(db);
    },
    listPhotoPosts: async () => { if (listFailure) throw listFailure; return [...docs.values()].map(p => ({ id: p.id, title: p.title, revision: p.revision, status: p.status, archived: p.archived, body: PhotoPost.plainText(p) })); },
    readPhotoPost: async (_, key) => { if (!docs.has(key)) throw new Error('글이 없습니다.'); return clone(docs.get(key)); },
  };
  const host = doc.createElement('main'); doc.body.append(host);
  const reads = [], exports = [], module = global.HaedoLife.BlogSeriesUI.create({ storage, workspaceId: 'ws', isCurrent: () => scope,
    onRead: async seriesId => { await module.flush(); reads.push(seriesId); }, onExport: async seriesId => exports.push(seriesId), ...options });
  await module.mount(host); t.after(() => { module.dispose(); global.document = oldDocument; global.HaedoLife = oldLife; });
  const get = selector => { const n = host.querySelector(selector); assert.ok(n, selector); return n; };
  const click = async selector => { const node = get(selector); assert.equal(node.disabled, false, selector); await node.emit('click'); await settle(); };
  const input = async (selector, value) => { const n = get(selector); n.value = value; await n.emit('input'); return n; };
  const load = () => click('#bsReloadPosts');
  const add = async key => { const row = get('#bsCandidates').children.find(n => n.dataset.postId === key); assert.ok(row); await row.querySelector('button').emit('click'); await settle(); };
  return { module, host, doc, get, click, input, load, add, docs, reads, exports, storage, model: Model,
    db: () => clone(db), saves: () => saves, setDb: value => { db = clone(value); }, setBeforeSave: value => { beforeSave = value; }, setScope: value => { scope = value; }, setListFailure: value => { listFailure = value; } };
}

test('saved post selection, search and ordering keep the same input nodes and flush before reading', async t => {
  const f = await fixture(t); const originalTitle = f.get('#bsTitle');
  await f.input('#bsTitle', '부산 여행'); await f.module.flush(); await f.load();
  assert.deepEqual(f.get('#bsCandidates').children.map(n => n.dataset.postId), ['one', 'two']);
  await f.add('one'); await f.add('two');
  assert.equal(f.get('#bsTitle'), originalTitle);
  assert.equal(f.get('#bsCandidates').children[0].querySelector('button').disabled, true);
  await f.input('#bsPostSearch', '둘째날'); assert.equal(f.get('#bsCandidates').children.length, 1);
  const second = f.get('#bsEntries').children[1]; await second.querySelector('[data-action="up"]').emit('click'); await settle();
  assert.equal(f.db().series[0].items[0].postId, 'two');
  assert.equal(f.doc.activeElement.parentNode.parentNode.dataset.entryId, f.db().series[0].items[0].id);
  await f.click('#bsRead'); assert.deepEqual(f.reads, ['original']);
  await f.click('#bsExport'); assert.deepEqual(f.exports, ['original']);
  const selected = f.db().series[0].items[0]; f.docs.delete('two');
  await f.input('#bsIntro', '원래 글이 없어져도 고른 판을 유지'); await f.module.flush();
  assert.equal(f.db().series[0].items[0].postId, selected.postId); assert.equal(f.db().series[0].items[0].postRevision, 1);
});

test('typing during a pending save preserves input identity and serializes the later revision', async t => {
  const f = await fixture(t), hold = deferred(); let first = true;
  f.setBeforeSave(async () => { if (first) { first = false; await hold.promise; } });
  const title = await f.input('#bsTitle', '첫 제목'), saving = f.module.flush(); await settle();
  await f.input('#bsTitle', '나중 제목'); const intro = await f.input('#bsIntro', '입력 중 새 문장'); hold.resolve(); await saving;
  assert.equal(f.get('#bsTitle'), title); assert.equal(f.get('#bsIntro'), intro);
  assert.equal(f.db().series[0].title, '나중 제목'); assert.equal(f.db().series[0].intro, '입력 중 새 문장');
  assert.equal(f.saves().length, 2); assert.equal(f.module.dirty(), false);
});

test('composition and invalid input block saving and navigation without replacing the field', async t => {
  const f = await fixture(t), title = f.get('#bsTitle');
  await title.emit('compositionstart'); title.value = '한글 조합'; await title.emit('input');
  await assert.rejects(f.module.flush(), { code: 'series_input_in_progress' }); await f.click('#bsRead');
  assert.equal(f.reads.length, 0); assert.equal(f.db().series[0].title, '');
  await title.emit('compositionend'); await f.module.flush(); assert.equal(f.db().series[0].title, '한글 조합');
  await f.input('#bsTitle', '\ud800'); await assert.rejects(f.module.flush(), { code: 'series_input_pending' });
  assert.equal(f.get('#bsTitle'), title); assert.equal(title.value, '\ud800'); assert.equal(f.db().series[0].title, '한글 조합');
  await f.input('#bsTitle', '고친 제목'); await f.module.flush(); assert.equal(f.db().series[0].title, '고친 제목');
});

test('CAS failure retains local edits and recovers only the selected series as a fresh exact-edition copy', async t => {
  const f = await fixture(t); await f.load(); await f.add('one');
  const saved = f.db(), latest = f.db(); latest.revision++; latest.series[0].title = '다른 탭의 제목'; f.setDb(latest); f.docs.delete('one');
  const input = await f.input('#bsTitle', '내 변경'); await assert.rejects(f.module.flush(), { code: 'blog_series_conflict' });
  assert.equal(f.get('#bsTitle'), input); assert.equal(input.value, '내 변경'); assert.equal(f.db().series[0].title, '다른 탭의 제목');
  await f.click('#bsRecover'); const recovered = f.db(); assert.equal(recovered.series.length, 2);
  assert.equal(recovered.series[0].title, '다른 탭의 제목'); assert.equal(recovered.series[1].title, '내 변경');
  assert.notEqual(recovered.series[1].id, saved.series[0].id); assert.notEqual(recovered.series[1].items[0].id, saved.series[0].items[0].id);
  assert.equal(recovered.series[1].items[0].postId, 'one'); assert.equal(recovered.series[1].items[0].postRevision, 1);
  assert.equal(f.module.dirty(), false);
});

test('storage and catalog failures preserve inputs and old candidates for explicit retry', async t => {
  const f = await fixture(t); await f.load(); const before = f.get('#bsCandidates').children.map(n => n.dataset.postId);
  f.setListFailure(new Error('목록 읽기 실패')); await f.load(); assert.deepEqual(f.get('#bsCandidates').children.map(n => n.dataset.postId), before);
  f.setBeforeSave(async () => { throw new Error('실제 저장 실패'); });
  const title = await f.input('#bsTitle', '보존할 입력'); await assert.rejects(f.module.flush(), /실제 저장 실패/);
  assert.equal(f.get('#bsTitle'), title); assert.equal(title.value, '보존할 입력'); assert.equal(f.db().series[0].title, '');
  f.setBeforeSave(null); await f.click('#bsRetry'); assert.equal(f.db().series[0].title, '보존할 입력');
});

test('failed import inspection keeps the existing editor and stale account callbacks cannot render or navigate', async t => {
  const hold = deferred(), f = await fixture(t, { onInspectImport: async () => { throw new Error('파일 검증 실패'); }, onImport: async () => { throw new Error('검증되지 않은 파일 설치 금지'); } });
  const title = await f.input('#bsTitle', '현재 모음'); await f.module.flush(); const file = f.get('#bsImport'); file.files = [{}]; await file.emit('change');
  assert.equal(f.get('#bsTitle'), title); assert.equal(title.value, '현재 모음');
  f.storage.listPhotoPosts = () => hold.promise; const loading = f.get('#bsReloadPosts').emit('click'); await settle();
  f.setScope(false); hold.resolve([]); await loading; await settle();
  assert.equal(f.get('#bsTitle'), title); assert.equal(f.get('#bsCandidates').textContent.includes('담을 수 있는 저장 글이 없습니다'), false);
  await f.get('#bsRead').emit('click'); assert.equal(f.reads.length, 0);
});

test('file inspection requires explicit confirmation and changing input or choosing a failed file clears the older candidate', async t => {
  let imports = 0, invalid = false;
  const f = await fixture(t, {
    onInspectImport: async () => { if (invalid) throw new Error('다른 파일 검증 실패'); return { title: '여행 모음 파일', posts: 2, photos: 1 }; },
    onImport: async () => { imports++; const value = f.db(); const series = f.model.create(() => 'imported'); series.title = '여행 모음 파일'; value.series.push(series); value.revision++; f.setDb(value); return { seriesId: series.id }; },
  });
  const select = async name => { const file = f.get('#bsImport'); file.files = [{ name }]; await file.emit('change'); };
  await select('여행.zip'); assert.equal(imports, 0); assert.equal(f.db().series.length, 1);
  assert.match(f.get('#bsImportReview').textContent, /여행.zip/); assert.match(f.get('#bsImportReview').textContent, /글 2편 · 사진 1장/);
  const originalTitle = f.get('#bsTitle'); await f.input('#bsTitle', '검토 도중 변경'); assert.equal(f.host.querySelector('#bsImportReview'), null); assert.equal(imports, 0);
  await f.module.flush(); await select('여행.zip'); invalid = true; await select('변조.zip');
  assert.equal(f.host.querySelector('#bsImportReview'), null); assert.equal(f.get('#bsTitle'), originalTitle); assert.equal(imports, 0);
  invalid = false; await select('여행.zip'); await f.click('#bsImportCancel'); assert.equal(imports, 0);
  await select('여행.zip'); await f.click('#bsImportConfirm'); assert.equal(imports, 1); assert.equal(f.db().series.length, 2);
  assert.equal(f.get('#bsTitle').value, '여행 모음 파일'); assert.equal(f.host.querySelector('#bsImportReview'), null);
});

test('a committed import with a failed follow-up read keeps a receipt and retries only reading', async t => {
  let imports = 0, failNext = false;
  const f = await fixture(t, {
    onInspectImport: async () => ({ title: '복원한 여행', posts: 0, photos: 0 }),
    onImport: async () => {
      imports++; const value = f.db(), series = f.model.create(() => 'received'); series.title = '복원한 여행';
      value.series.push(series); value.revision++; f.setDb(value); failNext = true; return { seriesId: series.id };
    },
  });
  const read = f.storage.readBlogSeries; f.storage.readBlogSeries = async () => { if (failNext) { failNext = false; throw new Error('후속 조회 실패'); } return read(); };
  const title = f.get('#bsTitle'), file = f.get('#bsImport'); file.files = [{ name: 'received.zip' }]; await file.emit('change'); await f.click('#bsImportConfirm');
  assert.equal(imports, 1); assert.equal(f.db().series.length, 2); assert.equal(f.get('#bsTitle'), title);
  assert.match(f.get('.bs-error').textContent, /이미 보관/); assert.equal(f.host.querySelector('#bsImportReview'), null);
  await f.click('#bsImportReopen'); assert.equal(imports, 1); assert.equal(f.get('#bsTitle').value, '복원한 여행'); assert.equal(f.host.querySelector('#bsImportReopen'), null);
});

for (const mode of ['invalid', 'composing']) test(`an import committed during ${mode} input never replaces the current editor`, async t => {
  const hold = deferred(); let imports = 0;
  const f = await fixture(t, {
    onInspectImport: async () => ({ title: '파일 모음', posts: 0, photos: 0 }),
    onImport: async () => { await hold.promise; imports++; const value = f.db(), series = f.model.create(() => 'received'); value.series.push(series); value.revision++; f.setDb(value); return { seriesId: series.id }; },
  });
  const file = f.get('#bsImport'); file.files = [{ name: 'received.zip' }]; await file.emit('change');
  const confirming = f.get('#bsImportConfirm').emit('click'); await settle();
  const title = f.get('#bsTitle'); if (mode === 'composing') await title.emit('compositionstart');
  const value = mode === 'invalid' ? '\ud800' : '아직 조합 중'; await f.input('#bsTitle', value); hold.resolve(); await confirming; await settle();
  assert.equal(imports, 1); assert.equal(f.db().series.length, 2); assert.ok(f.get('#bsTitle') === title, 'the original input DOM must survive'); assert.equal(title.value, value);
  assert.ok(f.get('#bsImportReopen')); await assert.rejects(f.module.flush(), { code: mode === 'invalid' ? 'series_input_pending' : 'series_input_in_progress' });
});

test('a recovery committed during composition retains the completed copy and the newer input', async t => {
  const f = await fixture(t), latest = f.db(), hold = deferred(); latest.revision++; latest.series[0].title = '다른 탭'; f.setDb(latest);
  await f.input('#bsTitle', '내 사본'); await assert.rejects(f.module.flush(), { code: 'blog_series_conflict' });
  f.setBeforeSave(() => hold.promise); const recovering = f.get('#bsRecover').emit('click'); await settle();
  const title = f.get('#bsTitle'); await title.emit('compositionstart'); title.value = '사본 보관 중 입력'; await title.emit('input');
  hold.resolve(); await recovering; await settle();
  assert.equal(f.db().series.length, 2); assert.equal(f.db().series[1].title, '내 사본');
  assert.ok(f.get('#bsTitle') === title, 'recovering must not replace an active composition'); assert.equal(title.value, '사본 보관 중 입력');
  await assert.rejects(f.module.flush(), { code: 'series_input_in_progress' });
});

test('external navigation flush is blocked for the entire import installation while the internal confirm flush still works', async t => {
  const hold = deferred(); let installs = 0;
  const f = await fixture(t, {
    onInspectImport: async () => ({ title: '이동 경계', posts: 0, photos: 0 }),
    onImport: async () => { installs++; await hold.promise; const value = f.db(), series = f.model.create(() => 'held_import'); value.series.push(series); value.revision++; f.setDb(value); return { seriesId: series.id }; },
  });
  const file = f.get('#bsImport'); file.files = [{ name: 'held.zip' }]; await file.emit('change');
  const confirming = f.get('#bsImportConfirm').emit('click'); await settle();
  assert.equal(installs, 1, 'the internal flush must not block its own confirmed action');
  let rejection;
  try { await f.module.flush(); } catch (cause) { rejection = cause; }
  hold.resolve(); await confirming; await settle();
  assert.equal(rejection?.code, 'blog_series_busy', 'navigation must stay blocked until the owned install finishes');
  assert.equal(installs, 1); assert.equal(f.db().series.length, 2); await f.module.flush();
});
