'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../assets/life/core.js');
const Workbench = require('../assets/life/workbench.js');
const Books = require('../assets/life/books.js');
const Print = require('../assets/life/book-print.js');
const minimal = () => ({ title: '내가 고른 시간', fromYear: '', toYear: '', question: '무엇을 오래 좋아했을까?', includeSources: false,
  chapters: [{ title: '처음의 마음', note: '현재의 원고', evidence: [], insights: [] }] });
async function fixture() {
  let bundle = Core.createWorkspace({ title: '인쇄와 무관한 작업공간' });
  const old = await Core.prepareImport({ origin: 'naver_blog', title: '예전의 기록', text: 'EXACT_OLD_BODY 그때의 질문', url: 'https://example.invalid/old', author: '나', authorRelation: 'self', coverage: 'full_text' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, old));
  const latest = await Core.prepareImport({ origin: 'naver_blog', title: old.source.title, text: 'UNSELECTED_LATEST_BODY', url: old.source.url, authorRelation: 'self', coverage: 'full_text', existingSourceId: old.source.id }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, latest));
  const state = Workbench.empty(bundle.workspaceId);
  state.reflection.note = 'PRIVATE_OTHER_REFLECTION';
  state.books = [{ id: 'book_one', title: '내가 고른 시간', fromYear: '2016', toYear: '2025', question: '무엇을 오래 좋아했을까?', chapters: [
    { id: 'chapter_one', title: '처음의 마음', note: '선택한 장의 원고', versionIds: [old.version.id, 'missing_version'], insights: [
      { id: 'insight_one', statement: '이것은 지금의 해석', uncertainty: '아직 모르는 이유', supportVersionIds: [old.version.id], counterVersionIds: [], excluded: false },
      { id: 'insight_hidden', statement: 'EXCLUDED_INSIGHT_PRIVATE', uncertainty: '', supportVersionIds: [], counterVersionIds: [], excluded: true }
    ] },
    { id: 'chapter_archived', title: 'ARCHIVED_CHAPTER_PRIVATE', note: 'ARCHIVED_NOTE_PRIVATE', versionIds: [latest.version.id], archived: true }
  ] }, { id: 'book_two', title: 'OTHER_BOOK_PRIVATE', fromYear: '', toYear: '', question: '', chapters: [] }];
  return { bundle, state, old, latest };
}

test('a canonical single-book projection prints only active selected chapters and exact evidence; default bodies remain off', async () => {
  const { bundle, state, old } = await fixture(), before = structuredClone({ bundle, state });
  const projection = Books.project(bundle, state, 'book_one');
  // Even unrelated properties passed by a caller are not serialized.
  projection.account = 'PRIVATE_ACCOUNT'; projection.backup = state;
  projection.chapters[0].evidence[0].body = 'INJECTED_BODY_WHEN_OFF';
  const output = Print.document(projection);
  for (const value of ['선택한 장의 원고', '이것은 지금의 해석', '아직 모르는 이유', old.version.id, '선택 버전: 1/2', '연결된 원문 없음']) assert(output.includes(value));
  for (const value of ['EXACT_OLD_BODY', 'UNSELECTED_LATEST_BODY', 'PRIVATE_OTHER_REFLECTION', 'OTHER_BOOK_PRIVATE', 'ARCHIVED_CHAPTER_PRIVATE', 'ARCHIVED_NOTE_PRIVATE', 'EXCLUDED_INSIGHT_PRIVATE', 'PRIVATE_ACCOUNT', 'INJECTED_BODY_WHEN_OFF', bundle.workspaceId]) assert(!output.includes(value), value);
  const included = Print.document(Books.project(bundle, state, 'book_one', { includeSources: true }));
  assert(included.includes('EXACT_OLD_BODY')); assert(!included.includes('UNSELECTED_LATEST_BODY'));
  assert.deepEqual({ bundle, state }, before);
});

test('all user and source text stays literal, without links, scripts, styles, images or HTML execution', () => {
  const hostile = '</style><script>globalThis.STOLEN=true</script><img src="https://example.invalid/leak" onerror="alert(1)"><a href="javascript:alert(1)">원문</a>&';
  const value = minimal(); Object.assign(value, { title: hostile, question: hostile, includeSources: true });
  const evidence = { versionId: hostile, missing: false, title: hostile, url: hostile, originalCreatedAt: hostile,
    originalAuthor: { label: hostile, relation: 'other' }, coverage: { status: hostile, omissions: [hostile] }, versionNumber: 1, versionTotal: 1, hasBody: true, body: hostile };
  Object.assign(value.chapters[0], { title: hostile, note: hostile, evidence: [evidence], insights: [{ statement: hostile, uncertainty: hostile, supportEvidence: [evidence], counterEvidence: [evidence] }] });
  const before = structuredClone(value), output = Print.document(value);
  assert(output.includes('&lt;script&gt;')); assert(output.includes('&lt;img')); assert(output.includes('&amp;'));
  assert.doesNotMatch(output, /<(script|img|a|link|iframe|object)\b/i);
  assert.equal((output.match(/<style>/g) || []).length, 1); assert(!output.includes(hostile)); assert.deepEqual(value, before);
});

test('link-only and missing sources stay explicit and malformed or oversized print requests fail without truncating', () => {
  const value = minimal(); value.includeSources = true; value.chapters[0].evidence = [{ versionId: 'gap', missing: true },
    { versionId: 'link', missing: false, title: '주소만', url: 'https://example.invalid/link', originalCreatedAt: null,
      originalAuthor: { label: '', relation: 'unknown' }, coverage: { status: 'link_only', omissions: [] }, versionNumber: 1, versionTotal: 1, hasBody: false, body: null }];
  const output = Print.document(value); assert(output.includes('본문 미확보')); assert(output.includes('연결된 원문 없음')); assert(output.includes('작성자 관계 미확인'));
  for (const bad of [null, {}, { ...minimal(), includeSources: 'yes' }, { ...minimal(), chapters: null }]) assert.throws(() => Print.document(bad), { code: 'invalid_book_print' });
  const large = minimal(); large.chapters[0].note = '<'.repeat(Math.ceil(Print.MAX_DOCUMENT_LENGTH / 4));
  const before = large.chapters[0].note; assert.throws(() => Print.document(large), { code: 'book_print_too_large' }); assert.equal(large.chapters[0].note, before);
});

function harness({ holdFonts = false, onFocus, appendFails = false, urlFails = false } = {}) {
  let resolveFonts, printCalls = 0, restored = 0;
  const urls = new Map(), revoked = []; let nextUrl = 0;
  const frames = [], events = () => { const listeners = new Map(); return {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name) { for (const fn of [...(listeners.get(name) || [])]) fn(); }
  }; };
  const fontReady = holdFonts ? new Promise(resolve => { resolveFonts = resolve; }) : Promise.resolve();
  const document = { activeElement: { isConnected: true, focus() { restored++; } }, body: { append(frame) { frames.push(frame); if (appendFails) throw new Error('Synthetic append failure'); frame.isConnected = true; } },
    createElement(tag) { assert.equal(tag, 'iframe'); const win = { ...events(), focus() { onFocus?.(); }, print() { printCalls++; } };
      return { ...events(), dataset: {}, style: {}, attributes: {}, isConnected: false, contentDocument: { documentElement: { dataset: { haedoPrint: 'v1' } }, fonts: { ready: fontReady } }, contentWindow: win,
        setAttribute(name, value) { this.attributes[name] = value; }, remove() { this.isConnected = false; } }; }
  };
  const URL = { createObjectURL(blob) { if (urlFails) throw new Error('Synthetic URL failure'); const url = 'blob:fixture/' + (++nextUrl); urls.set(url, blob); return url; },
    revokeObjectURL(url) { revoked.push(url); urls.delete(url); } };
  class Blob { constructor(parts) { this.html = parts.join(''); } }
  const context = vm.createContext({ document, URL, Blob, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/book-print.js'), 'utf8'), context);
  return { api: context.HaedoLife.BookPrint, frames, load: () => frames.at(-1).emit('load'), fonts: () => resolveFonts?.(), calls: () => printCalls, restored: () => restored,
    html: frame => urls.get(frame.src)?.html, urlCount: () => urls.size, revoked: () => revoked.slice() };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('native print requests an isolated, sandboxed document and only reports requested; afterprint releases it', async () => {
  const h = harness(), task = h.api.print(minimal(), { isCurrent: () => true }); h.load(); const result = await task;
  assert.equal(result.requested, true); assert.equal(Object.hasOwn(result, 'saved'), false); assert.equal(h.calls(), 1);
  const frame = h.frames[0]; assert.equal(frame.attributes.sandbox, 'allow-same-origin allow-modals'); assert.equal(frame.referrerPolicy, 'no-referrer');
  assert(h.html(frame).includes("default-src 'none'")); assert(frame.isConnected); assert.equal(h.urlCount(), 1);
  assert.equal(Object.hasOwn(frame, 'srcdoc'), false); assert(frame.src.startsWith('blob:'));
  frame.contentWindow.emit('afterprint'); assert(!frame.isConnected); assert.equal(h.restored(), 1); assert.equal(h.urlCount(), 0);
  assert.deepEqual(h.revoked(), [frame.src]);
});

test('a required current-view guard rejects stale requests before frame creation', async () => {
  const h = harness(); await assert.rejects(h.api.print(minimal()), { code: 'invalid_book_print' });
  await assert.rejects(h.api.print(minimal(), { isCurrent: () => false }), { code: 'book_print_cancelled' }); assert.equal(h.frames.length, 0); assert.equal(h.calls(), 0);
});

test('cancel during iframe loading or font preparation prevents late print and cleans the private document', async () => {
  for (const afterLoad of [false, true]) {
    const h = harness({ holdFonts: true }), task = h.api.print(minimal(), { isCurrent: () => true });
    const rejection = assert.rejects(task, { code: 'book_print_cancelled' }); if (afterLoad) h.load(); h.api.cancel(); await rejection;
    h.fonts(); await tick(); assert.equal(h.calls(), 0); assert(!h.frames[0].isConnected); assert.equal(h.urlCount(), 0);
  }
});

test('account changes after asynchronous fonts and during focus are checked immediately before print', async () => {
  let current = true; const h = harness({ holdFonts: true }), task = h.api.print(minimal(), { isCurrent: () => current });
  const rejection = assert.rejects(task, { code: 'book_print_cancelled' }); h.load(); current = false; h.fonts(); await rejection; assert.equal(h.calls(), 0);
  current = true; const focused = harness({ onFocus() { current = false; } }), next = focused.api.print(minimal(), { isCurrent: () => current });
  const focusRejection = assert.rejects(next, { code: 'book_print_cancelled' }); focused.load(); await focusRejection; assert.equal(focused.calls(), 0);
});

test('duplicate preparation is rejected, while cancellation releases the pending request for another click', async () => {
  const h = harness(), first = h.api.print(minimal(), { isCurrent: () => true });
  const cancelled = assert.rejects(first, { code: 'book_print_cancelled' });
  await assert.rejects(h.api.print(minimal(), { isCurrent: () => true }), { code: 'book_print_busy' }); h.api.cancel(); await cancelled;
  const second = h.api.print(minimal(), { isCurrent: () => true }); h.load(); await second; assert.equal(h.calls(), 1); h.api.cancel(); assert(!h.frames[1].isConnected);
});

test('book printing forwards explicit options to the same isolated lifecycle without claiming a saved PDF', async () => {
  const h = harness(), task = h.api.print(minimal(), { isCurrent: () => true, mode: 'book', paper: 'A4', includeInsights: false });
  assert(h.html(h.frames[0]).includes('data-print-mode="book"')); assert(h.html(h.frames[0]).includes('@page { size: A4;'));
  assert(!h.html(h.frames[0]).includes('무엇을 오래 좋아했을까?'));
  h.load(); const result = await task; assert.equal(result.requested, true); assert.equal(Object.hasOwn(result, 'saved'), false);
  h.frames[0].contentWindow.emit('afterprint'); assert(!h.frames[0].isConnected); assert.equal(h.restored(), 1); assert.equal(h.urlCount(), 0);
});

test('invalid book/review print options reject before frame creation and book font preparation remains cancellable', async () => {
  const h = harness({ holdFonts: true });
  for (const value of [{ mode: 'book', paper: 'Letter' }, { mode: 'review', paper: 'A5' }, { includeInsights: false }, { mode: 'book', includeInsights: 'yes' }])
    await assert.rejects(h.api.print(minimal(), { isCurrent: () => true, ...value }), { code: 'invalid_book_print' });
  assert.equal(h.frames.length, 0);
  const task = h.api.print(minimal(), { isCurrent: () => true, mode: 'book' });
  const rejection = assert.rejects(task, { code: 'book_print_cancelled' }); h.load(); h.api.cancel(); await rejection;
  h.fonts(); await tick(); assert.equal(h.calls(), 0); assert(!h.frames[0].isConnected);
});

test('Blob URL creation and append errors clean up; completed dialogs retain the URL until an explicit replacement', async () => {
  for (const setup of [{ urlFails: true }, { appendFails: true }]) {
    const h = harness(setup);
    await assert.rejects(h.api.print(minimal(), { isCurrent: () => true, mode: 'book' }), { code: 'book_print_unavailable' });
    assert.equal(h.urlCount(), 0); assert.equal(h.calls(), 0);
    assert(h.frames.every(frame => !frame.isConnected));
    if (setup.appendFails) assert.equal(h.revoked().length, 1);
  }
  const h = harness();
  const first = h.api.print(minimal(), { isCurrent: () => true }); h.load(); await first;
  assert.equal(h.urlCount(), 1); // Safari may still have an open print dialog.
  const previousUrl = h.frames[0].src;
  const second = h.api.print(minimal(), { isCurrent: () => true, mode: 'book' });
  assert.deepEqual(h.revoked(), [previousUrl]); assert.equal(h.urlCount(), 1);
  h.load(); await second; const nextUrl = h.frames[1].src; h.api.cancel(); h.api.cancel();
  assert.equal(h.urlCount(), 0); assert.deepEqual(h.revoked(), [previousUrl, nextUrl]);
});
