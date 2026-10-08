'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Core = require('../assets/life/core.js');
const Workbench = require('../assets/life/workbench.js');
const Books = require('../assets/life/books.js');
const Print = require('../assets/life/book-print.js');
const minimal = () => ({ title: '내가 고른 시간', fromYear: '', toYear: '', question: '무엇을 오래 좋아했을까?', includeSources: false,
  chapters: [{ title: '처음의 마음', note: '현재의 원고', evidence: [], insights: [] }] });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function fixture() {
  let bundle = Core.createWorkspace({ title: 'PRIVATE_WORKSPACE_TITLE' });
  async function add(input) {
    const value = await Core.prepareImport(input, bundle);
    bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, value)); return value;
  }
  const old = await add({ origin: 'naver_blog', title: '원문 제목', text: 'EXACT_OLD_BODY\r\n\r\n그때의 원형 본문', url: 'https://example.invalid/raw?q=%2B#old',
    author: '나', authorRelation: 'self', originalCreatedAt: '2020-11', coverage: 'full_text' });
  const latest = await add({ origin: 'naver_blog', title: old.source.title, text: 'UNSELECTED_LATEST_BODY', url: old.source.url,
    existingSourceId: old.source.id, authorRelation: 'self', originalCreatedAt: '2025', coverage: 'full_text' });
  const other = await add({ origin: 'other', title: 'ROLE_ONLY_OTHER_TITLE', text: 'ROLE_ONLY_OTHER_BODY', author: '타인',
    authorRelation: 'other', originalCreatedAt: '어느 가을', coverage: 'partial', omissions: ['사진 미보관'] });
  const link = await add({ origin: 'other', title: 'LINK_ONLY_TITLE', text: null, url: 'https://example.invalid/link', coverage: 'link_only' });
  const excluded = await add({ origin: 'other', title: 'EXCLUDED_ONLY_SOURCE_TITLE', text: 'EXCLUDED_ONLY_BODY', coverage: 'full_text' });
  const state = Workbench.empty(bundle.workspaceId);
  state.reflection.note = 'PRIVATE_REFLECTION';
  state.books = [{ id: 'book_private_id', title: '선택한 독자용 책', fromYear: '2017', toYear: '2026', question: 'PRIVATE_PLANNING_QUESTION', chapters: [
    { id: 'chapter_unsafe_origin_id', title: '첫 장', note: 'FIRST_MANUSCRIPT\r\n\r\n두 번째 문단', versionIds: [old.version.id, 'missing_chapter_ref'], insights: [
      { id: 'active_insight_id', statement: 'EXPLICIT_ACTIVE_INSIGHT', uncertainty: 'EXPLICIT_UNCERTAINTY', supportVersionIds: [other.version.id, old.version.id], counterVersionIds: [link.version.id, 'missing_role_ref'], excluded: false },
      { id: 'excluded_insight_id', statement: 'EXCLUDED_STATEMENT', uncertainty: 'EXCLUDED_UNCERTAINTY', supportVersionIds: [excluded.version.id], counterVersionIds: [], excluded: true }
    ] },
    { id: 'chapter_two', title: '다음 장', note: 'SECOND_MANUSCRIPT', versionIds: [old.version.id] },
    { id: 'archived_chapter', title: 'ARCHIVED_TITLE', note: 'ARCHIVED_MANUSCRIPT', versionIds: [latest.version.id], archived: true }
  ] }, { id: 'unselected_book', title: 'UNSELECTED_BOOK', fromYear: '', toYear: '', question: '', chapters: [] }];
  return { bundle, state, old, latest, other, link, excluded };
}

test('default and explicit review output retain the frozen pre-extension byte fingerprint', () => {
  const before = minimal(), output = Print.document(before);
  // Captured from the original renderer before book mode was added. No Git dependency in CI.
  assert.equal(hash(output), 'dabe25ad3f34a968c32502a65c7bbb6f1ed6a7e6178d48601f1f1fd91d54ccfa');
  assert.equal(Print.document(before, {}), output);
  assert.equal(Print.document(before, { mode: 'review', paper: 'A4', includeInsights: true }), output);
});

test('reader edition orders title-only cover, safe index TOC, manuscripts and mandatory chapter appendix', async () => {
  const f = await fixture(), projection = Books.project(f.bundle, f.state, 'book_private_id'), before = structuredClone(projection);
  const output = Print.document(projection, { mode: 'book' });
  assert(output.includes('<meta name="viewport" content="width=device-width,initial-scale=1">'));
  assert(output.includes('data-haedo-print="v1" data-print-mode="book" data-print-paper="A5"')); assert(output.includes('@page { size: A5;'));
  const coverAt = output.indexOf('<header class="book-cover">'), tocAt = output.indexOf('<nav class="book-toc"'), firstAt = output.indexOf('<section class="chapter"'), appendixAt = output.indexOf('<section class="source-appendix"');
  assert(coverAt < tocAt && tocAt < firstAt && firstAt < appendixAt);
  assert.equal(output.slice(coverAt, tocAt), '<header class="book-cover"><h1>선택한 독자용 책</h1></header>');
  assert.equal((output.match(/class="appendix-chapter"/g) || []).length, 2);
  assert(output.includes('href="#haedo-book-chapter-1"')); assert(output.includes('href="#haedo-book-chapter-2"'));
  assert(output.includes('href="#haedo-book-sources"'));
  assert(output.includes('id="haedo-book-chapter-1"')); assert(output.includes('id="haedo-book-sources"'));
  const mainText = output.slice(firstAt, appendixAt);
  assert(mainText.includes('FIRST_MANUSCRIPT')); assert(mainText.includes('SECOND_MANUSCRIPT'));
  assert(!mainText.includes(f.old.version.id)); assert(!mainText.includes('missing_chapter_ref'));
  for (const hidden of ['PRIVATE_PLANNING_QUESTION', '2017 ~ 2026', 'PRIVATE_REFLECTION', 'UNSELECTED_BOOK', 'ARCHIVED_TITLE', 'ARCHIVED_MANUSCRIPT', 'EXCLUDED_STATEMENT', 'EXCLUDED_UNCERTAINTY', 'EXCLUDED_ONLY_SOURCE_TITLE', 'EXCLUDED_ONLY_BODY', 'EXPLICIT_ACTIVE_INSIGHT', 'EXPLICIT_UNCERTAINTY', 'ROLE_ONLY_OTHER_TITLE', 'LINK_ONLY_TITLE', f.bundle.workspaceId, 'chapter_unsafe_origin_id'])
    assert(!output.includes(hidden), hidden);
  assert.deepEqual(projection, before);
});

test('book source appendix preserves missing exact IDs, old version, raw metadata and no newest replacement', async () => {
  const f = await fixture(), output = Print.document(Books.project(f.bundle, f.state, 'book_private_id'), { mode: 'book', paper: 'A4' });
  assert(output.includes('@page { size: A4;')); assert(output.includes('data-print-paper="A4"'));
  const appendix = output.slice(output.indexOf('<section class="source-appendix"'));
  for (const text of ['UNSELECTED_LATEST_BODY', f.latest.version.id]) assert(!output.includes(text));
  for (const text of [f.old.version.id, 'missing_chapter_ref', '선택 버전: 1/2', '원문 작성일: 2020-11', '내 기록', f.old.source.url.replace('&', '&amp;'), '다른 버전으로 대체하지 않았습니다.']) assert(appendix.includes(text), text);
  assert(!output.includes('EXACT_OLD_BODY'));
});

test('source body and insight inclusion are independent and role-only metadata appears only with explicit insights', async () => {
  const f = await fixture();
  for (const includeSources of [false, true]) for (const includeInsights of [false, true]) {
    const projection = Books.project(f.bundle, f.state, 'book_private_id', { includeSources });
    const output = Print.document(projection, { mode: 'book', includeInsights });
    assert.equal(output.includes('EXACT_OLD_BODY'), includeSources);
    for (const text of ['EXPLICIT_ACTIVE_INSIGHT', 'EXPLICIT_UNCERTAINTY', 'ROLE_ONLY_OTHER_TITLE', 'LINK_ONLY_TITLE', 'missing_role_ref', '다른 사람의 기록', '작성자 관계 미확인', '본문 미확보 · 링크만 보관했습니다.', '어느 가을', '사진 미보관'])
      assert.equal(output.includes(text), includeInsights, text);
    assert.equal(output.includes('ROLE_ONLY_OTHER_BODY'), includeSources && includeInsights);
    const appendixAt = output.indexOf('<section class="source-appendix"');
    assert(!output.slice(0, appendixAt).includes('EXACT_OLD_BODY'));
    if (includeInsights) {
      assert(output.indexOf('EXPLICIT_ACTIVE_INSIGHT') < appendixAt);
      assert(output.indexOf('ROLE_ONLY_OTHER_TITLE') > appendixAt);
      assert(output.includes('생각과 연결한 근거')); assert(output.includes('다른 관점'));
    }
    for (const text of ['UNSELECTED_LATEST_BODY', 'EXCLUDED_ONLY_BODY', 'ARCHIVED_MANUSCRIPT']) assert(!output.includes(text));
  }
});

test('bodies injected into an off projection and unrelated private fields are never serialized', async () => {
  const f = await fixture(), projection = Books.project(f.bundle, f.state, 'book_private_id');
  projection.account = 'PRIVATE_ACCOUNT'; projection.backup = f.state; projection.chapters[0].evidence[0].body = 'BODY_INJECTED_WHILE_OFF';
  const output = Print.document(projection, { mode: 'book', includeInsights: true });
  for (const value of ['PRIVATE_ACCOUNT', 'PRIVATE_REFLECTION', 'BODY_INJECTED_WHILE_OFF']) assert(!output.includes(value));
});

test('hostile user/source text stays literal and every active link is a generated local TOC anchor', async () => {
  const f = await fixture(), projection = Books.project(f.bundle, f.state, 'book_private_id', { includeSources: true });
  const hostile = '</style><script>alert(1)</script><img src="https://example.invalid/leak"><a href="javascript:alert(1)">TEXT</a>&';
  projection.title = hostile; projection.chapters[0].title = hostile; projection.chapters[0].note = hostile;
  Object.assign(projection.chapters[0].evidence[0], { title: hostile, url: hostile, originalCreatedAt: hostile, body: hostile,
    originalAuthor: { label: hostile, relation: 'other' }, coverage: { status: 'partial', omissions: [hostile] } });
  const output = Print.document(projection, { mode: 'book', includeInsights: true });
  assert(output.includes('&lt;script&gt;')); assert(output.includes('&lt;img')); assert(output.includes('&amp;'));
  assert.doesNotMatch(output, /<(script|img|link|iframe|object)\b/i); assert.equal((output.match(/<style>/g) || []).length, 1);
  const links = [...output.matchAll(/<a href="([^"]*)">/g)].map(match => match[1]);
  assert.deepEqual(links, ['#haedo-book-chapter-1', '#haedo-book-chapter-2', '#haedo-book-sources']);
  assert(output.includes("connect-src 'none'")); assert(output.includes('content="no-referrer"'));
});

test('book mode refuses malformed active flags, source bodies and oversized escaped text without changing the projection', async () => {
  const f = await fixture();
  for (const alter of [p => { p.chapters[0].archived = true; }, p => { p.chapters[0].insights[0].excluded = true; },
    p => { p.chapters[0].evidence[0].body = 42; }, p => { delete p.chapters[0].evidence[0].body; }]) {
    const value = Books.project(f.bundle, f.state, 'book_private_id', { includeSources: true }); alter(value); const before = structuredClone(value);
    assert.throws(() => Print.document(value, { mode: 'book', includeInsights: true }), { code: 'invalid_book_print' }); assert.deepEqual(value, before);
  }
  const large = minimal(); large.chapters[0].note = '<'.repeat(Math.ceil(Print.MAX_DOCUMENT_LENGTH / 4)); const before = large.chapters[0].note;
  assert.throws(() => Print.document(large, { mode: 'book' }), { code: 'book_print_too_large' }); assert.equal(large.chapters[0].note, before);
});

test('explicit review is fixed A4/insights-on and malformed mode/paper/insights options fail closed', () => {
  for (const settings of [null, [], { mode: 'unknown' }, { mode: 'book', paper: 'A5; background:url(https://example.invalid)' },
    { mode: 'book', paper: 'Letter' }, { mode: 'book', includeInsights: 1 }, { mode: 'review', paper: 'A5' },
    { mode: 'review', includeInsights: false }, { includeInsights: false }, { extra: true }])
    assert.throws(() => Print.document(minimal(), settings), { code: 'invalid_book_print' });
});

test('empty and blank manuscripts stay explicit; book output never invents contents or page numbers', () => {
  const value = minimal(); value.chapters[0].note = '';
  const output = Print.document(value, { mode: 'book' }); assert(output.includes('아직 작성한 원고가 없습니다.')); assert(output.includes('연결한 원문이 없습니다.'));
  value.chapters = []; const empty = Print.document(value, { mode: 'book' });
  assert(empty.includes('아직 구성한 장이 없습니다.')); assert(empty.includes('출처 부록'));
  assert.doesNotMatch(empty.slice(empty.indexOf('<nav class="book-toc"'), empty.indexOf('</nav>')), /페이지\s*\d|data-page|toc-page/);
});
