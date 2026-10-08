'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Core = require('../assets/life/core.js');
const Workbench = require('../assets/life/workbench.js');
const Books = require('../assets/life/books.js');
const copy = value => structuredClone(value);
const ids = () => { let index = 0; return () => 'generated_' + (++index); };
async function fixture() {
  let bundle = Core.createWorkspace({ title: '익명 집필 자료' });
  async function add(input) {
    const prepared = await Core.prepareImport(input, bundle);
    bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared));
    return prepared;
  }
  const old = await add({ origin: 'other', title: '그때 쓴 글', text: '옛 버전 본문', authorRelation: 'self', originalCreatedAt: '2020-11', coverage: 'full_text' });
  const newer = await add({ origin: 'other', title: old.source.title, text: '선택하지 않은 새 본문', existingSourceId: old.source.id,
    authorRelation: 'other', originalCreatedAt: '2024-02-29', coverage: 'full_text' });
  const undated = await add({ origin: 'other', title: '작성일 자유문자', text: '타인의 글', authorRelation: 'other', originalCreatedAt: '어느 가을', coverage: 'partial' });
  const link = await add({ origin: 'other', title: '링크만', text: null, url: 'https://example.invalid/reference', coverage: 'link_only' });
  const gap = 'missing_exact_version';
  const state = Workbench.empty(bundle.workspaceId);
  state.groups = [{ id: 'theme_one', title: '일과 변화', versionIds: [undated.version.id, old.version.id, gap] },
    { id: 'theme_two', title: '<script>관계</script>', versionIds: [old.version.id, newer.version.id] }];
  state.reflection = { note: '기존 회고 원고\r\n현재 생각', versionIds: [old.version.id, gap] };
  return { bundle, state, old, newer, undated, link, gap };
}

test('time outline keeps exact old versions, unknown/missing dates and source order inside each year', async () => {
  const f = await fixture(), before = copy(f);
  const rows = Books.outline(f.bundle, f.state, [f.gap, f.old.version.id, f.link.version.id, f.newer.version.id, f.undated.version.id, f.old.version.id]);
  assert.deepEqual(rows, [
    { key: '2020', title: '2020년', versionIds: [f.old.version.id] },
    { key: '2024', title: '2024년', versionIds: [f.newer.version.id] },
    { key: 'unknown', title: '작성 시기 미확인', versionIds: [f.gap, f.link.version.id, f.undated.version.id] }
  ]);
  assert.deepEqual(f, before);
  rows[0].versionIds.length = 0; assert.equal(f.state.reflection.versionIds[0], f.old.version.id);
  assert.deepEqual(Books.outline(f.bundle, f.state, []), []);
});

test('explicit period selects written years without dropping unknowns or changing stored selections', async () => {
  const f = await fixture(), before = copy(f);
  const rows = Books.outline(f.bundle, f.state, [f.old.version.id, f.newer.version.id, f.undated.version.id, f.gap], { by: 'time', from: '2024', to: '2024' });
  assert.deepEqual(rows.map(row => row.versionIds), [[f.newer.version.id], [f.undated.version.id, f.gap]]);
  assert.deepEqual(Books.outline(f.bundle, f.state, [f.old.version.id], { from: '2030' }), []);
  for (const options of [{ from: '2025', to: '2020' }, { from: '2020-01' }, { to: '0000' }, { by: 'inferred' }])
    assert.throws(() => Books.outline(f.bundle, f.state, [f.old.version.id], options));
  assert.throws(() => Books.outline(f.bundle, { ...f.state, workspaceId: 'different' }, []), { code: 'workspace_mismatch' });
  assert.throws(() => Books.outline(f.bundle, f.state, ['invalid/ref']), { code: 'invalid_book_outline' });
  assert.throws(() => Books.outline(f.bundle, f.state, new Array(100000000)), { code: 'invalid_book_outline' });
  assert.deepEqual(f, before);
});

test('theme outline preserves overlapping exact intersections, ungrouped originals and missing refs', async () => {
  const f = await fixture(), before = copy(f);
  const rows = Books.outline(f.bundle, f.state, [f.old.version.id, f.link.version.id, f.gap, f.undated.version.id], { by: 'theme' });
  assert.deepEqual(rows, [
    { key: 'theme_one', title: '일과 변화', versionIds: [f.undated.version.id, f.old.version.id, f.gap] },
    { key: 'theme_two', title: '<script>관계</script>', versionIds: [f.old.version.id] },
    { key: 'ungrouped', title: '묶음에 넣지 않은 기록', versionIds: [f.link.version.id] }
  ]);
  const filtered = Books.outline(f.bundle, f.state, [f.old.version.id, f.newer.version.id, f.gap], { by: 'theme', from: '2024' });
  assert.deepEqual(filtered.map(row => row.versionIds), [[f.gap], [f.newer.version.id]]);
  assert.deepEqual(f, before);
});

test('outline creation produces detached blank chapters, preserves reflection/revision and shared exact references', async () => {
  const f = await fixture(); f.state.revision = 9;
  const rows = Books.outline(f.bundle, f.state, [f.old.version.id, f.gap], { by: 'theme' });
  const input = { title: '  내 책 <script>  ', question: '무엇이 바뀌었나?', chapters: rows.map(({ title, versionIds }) => ({ title, versionIds })) };
  const before = copy({ state: f.state, input });
  const result = Books.fromOutline(f.state, input, { id: ids() });
  assert.equal(Workbench.validate(result.state), true);
  const book = result.state.books.find(book => book.id === result.bookId);
  assert.equal(book.title, input.title); assert.equal(book.question, input.question);
  assert.deepEqual([book.fromYear, book.toYear], ['', '']);
  assert(book.chapters.every(chapter => chapter.note === '' && !Object.hasOwn(chapter, 'insights')));
  assert.deepEqual(book.chapters.map(chapter => chapter.versionIds), [[f.old.version.id, f.gap], [f.old.version.id]]);
  assert.deepEqual(result.state.reflection, f.state.reflection); assert.equal(result.state.revision, 9);
  assert.deepEqual({ state: f.state, input }, before);
  book.chapters[0].versionIds.pop(); result.state.reflection.note = '다른 원고'; input.chapters[1].title = '다른 목차';
  assert.deepEqual(f.state, before.state); assert.equal(book.chapters[1].title, before.input.chapters[1].title);
});

test('ID collisions reserve existing history IDs and references, retry safely and never mutate on failure', async () => {
  const f = await fixture();
  f.state.books = [{ id: 'existing_book', title: '기존 책', fromYear: '', toYear: '', question: '', chapters: [], editions: [
    { id: 'existing_edition', label: '개정본', createdAt: '2026-10-08T00:00:00.000Z', title: '이전 책', fromYear: '', toYear: '', question: '',
      chapters: [{ id: 'snapshot_chapter', title: '장', note: '', versionIds: [], insights: [
        { id: 'snapshot_insight', statement: '', uncertainty: '', supportVersionIds: [f.gap], counterVersionIds: [], excluded: true }
      ] }] }
  ] }];
  const input = { title: '새 책', chapters: [{ title: '첫 장', versionIds: [f.old.version.id] }] }, before = copy({ state: f.state, input });
  const collisions = [f.state.workspaceId, 'theme_one', 'existing_book', 'existing_edition', 'snapshot_chapter', 'snapshot_insight', f.gap, f.old.version.id, 'fresh_book', 'fresh_book', 'fresh_chapter'];
  const result = Books.fromOutline(f.state, input, { id: () => collisions.shift() });
  assert.equal(result.bookId, 'fresh_book'); assert.equal(result.state.books[1].chapters[0].id, 'fresh_chapter');
  let calls = 0;
  assert.throws(() => Books.fromOutline(f.state, input, { id: () => { calls++; return 'snapshot_chapter'; } }), { code: 'id_collision' });
  assert.equal(calls, 1024);
  assert.throws(() => Books.fromOutline(f.state, input, { id: () => '../bad' }), { code: 'invalid_id' });
  assert.deepEqual({ state: f.state, input }, before);
});

test('invalid or empty outlines fail closed with no inferred notes, truncation or altered old state', async () => {
  const f = await fixture(), before = copy(f.state);
  const valid = { title: '책', chapters: [{ title: '장', versionIds: [f.gap] }] };
  const bad = [
    { ...valid, chapters: [] }, { ...valid, chapters: [{ title: '장', versionIds: [] }] },
    { ...valid, title: '' }, { ...valid, extra: true }, { ...valid, question: '\ud800' },
    { ...valid, chapters: [{ title: '장', versionIds: [f.gap, f.gap] }] },
    { ...valid, chapters: [{ title: '장', note: '자동 해석', versionIds: [f.gap] }] },
    { ...valid, chapters: [{ title: '장', versionIds: new Array(1) }] },
    { ...valid, chapters: [{ title: '장', versionIds: Array.from({ length: 1001 }, (_, index) => 'v_' + index) }] },
    { ...valid, chapters: Array.from({ length: 101 }, () => ({ title: '장', versionIds: [f.gap] })) },
    { ...valid, question: '🌱'.repeat(10001) }, { ...valid, title: 'x'.repeat(501) }
  ];
  for (const input of bad) { const untouched = copy(input); assert.throws(() => Books.fromOutline(f.state, input, { id: ids() })); assert.deepEqual(input, untouched); }
  assert.deepEqual(f.state, before);
  const full = copy(f.state); full.books = Array.from({ length: 20 }, (_, index) => ({ id: 'b_' + index, title: '책', fromYear: '', toYear: '', question: '', chapters: [] }));
  const fullBefore = copy(full);
  assert.throws(() => Books.fromOutline(full, valid, { id: ids() }), { code: 'limit_reached' }); assert.deepEqual(full, fullBefore);
});

test('whole-state byte budget rejects a new outline atomically rather than trimming existing manuscripts', () => {
  const state = Workbench.empty('workshop_bytes');
  state.books = [{ id: 'existing', title: '책', fromYear: '', toYear: '', question: '',
    chapters: Array.from({ length: 100 }, (_, index) => ({ id: 'existing_' + index, title: '장', note: 'x'.repeat(20000), versionIds: [] })) }];
  Workbench.validate(state);
  const input = { title: '새 책', chapters: Array.from({ length: 100 }, () => ({ title: 'y'.repeat(500),
    versionIds: Array.from({ length: 1000 }, (_, index) => 'reference_' + index) })) };
  const before = copy({ state, input });
  assert.throws(() => Books.fromOutline(state, input, { id: ids() }), { code: 'workbench_too_large' });
  assert.deepEqual({ state, input }, before);
});

test('review counts unique exact references across chapters and roles, retaining factual missing/author/date distinctions', async () => {
  const f = await fixture();
  const result = Books.fromOutline(f.state, { title: '검토', chapters: [
    { title: '첫 장', versionIds: [f.old.version.id, f.gap] }, { title: '둘째 장', versionIds: [f.old.version.id, f.link.version.id] }
  ] }, { id: ids() });
  const book = result.state.books[0]; book.chapters[0].note = ' \r\n'; book.chapters[1].note = '사용자가 쓴 원고';
  book.chapters[0].insights = [
    { id: 'active', statement: '', uncertainty: '', supportVersionIds: [f.old.version.id, f.undated.version.id], counterVersionIds: [f.old.version.id, f.gap], excluded: false },
    { id: 'excluded', statement: '제외한 해석', uncertainty: '', supportVersionIds: [f.newer.version.id], counterVersionIds: [], excluded: true }
  ];
  const projection = Books.project(f.bundle, result.state, result.bookId), before = copy(projection);
  const review = Books.review(projection);
  assert.deepEqual(review.counts, { chapters: 2, blankNotes: 1, references: 4, missing: 1, otherAuthors: 1, unknownAuthors: 1, linkOnly: 1, undated: 2 });
  assert.deepEqual(review.chapters[0], { id: book.chapters[0].id, title: '첫 장', blankNote: true,
    references: 3, missing: 1, otherAuthors: 1, unknownAuthors: 0, linkOnly: 0, undated: 1 });
  assert.equal(review.chapters[1].blankNote, false); assert.equal(review.chapters[1].references, 2);
  assert.deepEqual(projection, before); review.chapters[0].title = '다른 제목'; assert.deepEqual(projection, before);
  assert.deepEqual(Books.review(Books.project(f.bundle, result.state, result.bookId, { includeSources: true })).counts, review.counts);
});

test('review excludes archived chapters and treats valid year-month dates as known without source bodies', async () => {
  const f = await fixture(), result = Books.fromOutline(f.state, { title: '책', chapters: [
    { title: '보이는 장', versionIds: [f.old.version.id] }, { title: '보관 장', versionIds: [f.link.version.id, f.gap] }
  ] }, { id: ids() });
  result.state.books[0].chapters[1].archived = true;
  assert.deepEqual(Books.review(Books.project(f.bundle, result.state, result.bookId)).counts,
    { chapters: 1, blankNotes: 1, references: 1, missing: 0, otherAuthors: 0, unknownAuthors: 0, linkOnly: 0, undated: 0 });
  result.state.books[0].chapters[0].archived = true;
  assert.deepEqual(Books.review(Books.project(f.bundle, result.state, result.bookId)).counts,
    { chapters: 0, blankNotes: 0, references: 0, missing: 0, otherAuthors: 0, unknownAuthors: 0, linkOnly: 0, undated: 0 });
});

test('browser helper uses the existing Reflection loading order with no added dependency or state mutation', async () => {
  const f = await fixture(), context = vm.createContext({ TextEncoder, Date, URL, crypto: crypto.webcrypto });
  for (const file of ['core', 'workbench', 'reflection', 'books'])
    vm.runInContext(fs.readFileSync(require.resolve('../assets/life/' + file + '.js'), 'utf8'), context);
  context.inputJSON = JSON.stringify(f);
  const actual = vm.runInContext(`(() => {
    const f = JSON.parse(inputJSON), B = HaedoLife.Books;
    const rows = B.outline(f.bundle, f.state, [f.old.version.id, f.gap], {by:'time'});
    let n=0; const result=B.fromOutline(f.state,{title:'책',chapters:rows.map(({title,versionIds})=>({title,versionIds}))},{id:()=> 'browser_'+(++n)});
    return JSON.stringify({rows,review:B.review(B.project(f.bundle,result.state,result.bookId)),original:f.state});
  })()`, context);
  const parsed = JSON.parse(actual);
  assert.equal(parsed.review.counts.chapters, 2); assert.equal(parsed.review.counts.missing, 1);
  assert.deepEqual(parsed.original, f.state); assert.equal(Object.isFrozen(context.HaedoLife.Books), true);
});
