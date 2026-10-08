'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Core = require('../assets/life/core.js');
const Workbench = require('../assets/life/workbench.js');
const Books = require('../assets/life/books.js');
const History = require('../assets/life/book-history.js');
const copy = value => structuredClone(value);
const TIME = '2026-10-08T02:03:04.005Z';
const capture = (state, label = 'A 원고') => History.capture(state, 'book_original', label, { createdAt: TIME });
async function fixture() {
  let bundle = Core.createWorkspace({ title: '익명 개정본 자료' });
  const old = await Core.prepareImport({ origin: 'other', title: '옛 글', text: '옛 본문🌱\r\n```', authorRelation: 'self', originalCreatedAt: '2020-11', coverage: 'full_text' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, old));
  const newer = await Core.prepareImport({ origin: 'other', title: old.source.title, existingSourceId: old.source.id, text: '선택하지 않은 최신 본문', coverage: 'full_text' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, newer));
  const state = Workbench.empty(bundle.workspaceId), gap = 'missing_shared_version'; state.revision = 7;
  state.reflection = { note: '기존 회고', versionIds: [old.version.id, gap] };
  state.books = [{ id: 'book_original', title: '책 A', fromYear: '2020', toYear: '', question: '처음의 질문',
    chapters: [{ id: 'chapter_active', title: '활성 장', note: '현재 A 원고🌱\r\n', versionIds: [old.version.id, gap], insights: [
      { id: 'insight_active', statement: 'A 해석', uncertainty: '', supportVersionIds: [old.version.id, gap], counterVersionIds: ['snapshot_only_gap'], excluded: false },
      { id: 'insight_excluded', statement: '제외해도 보관할 해석', uncertainty: '알 수 없는 부분', supportVersionIds: ['snapshot_only_gap'], counterVersionIds: [gap], excluded: true }] },
      { id: 'chapter_archived', title: '보관 장', note: '보관한 원고', versionIds: [old.version.id, gap], archived: true }] }];
  return { bundle, state, old, newer, gap };
}
const book = state => state.books[0];
const currentIds = value => value.chapters.flatMap(chapter => [chapter.id, ...(chapter.insights || []).map(insight => insight.id)]);

test('old v1 remains without implicit archive/history defaults and optional fields survive explicitly', async () => {
  const { bundle, state } = await fixture(); delete book(state).chapters[1].archived;
  assert.equal(Workbench.validate(state), true);
  const restored = await Workbench.restoreBackup(Workbench.makeBackup(bundle, state));
  assert.equal(Object.hasOwn(book(restored.workbench), 'archived'), false);
  assert.equal(Object.hasOwn(book(restored.workbench), 'editions'), false);
  assert(book(restored.workbench).chapters.every(chapter => !Object.hasOwn(chapter, 'archived')));
  book(state).archived = false; book(state).editions = [];
  assert.equal(Workbench.validate(state), true); assert.deepEqual(book((await Workbench.restoreBackup(Workbench.makeBackup(bundle, state))).workbench).editions, []);
});

test('capture owns all archived/excluded material with fresh snapshot IDs and preserves exact original references and revision', async () => {
  const { state, old } = await fixture(), before = copy(state), next = capture(state, '  정해 둔 이름  '), edition = book(next).editions[0];
  assert.deepEqual(state, before); assert.equal(next.revision, state.revision); assert.equal(edition.label, '  정해 둔 이름  ');
  assert.equal(edition.createdAt, TIME); assert.equal(edition.title, '책 A'); assert.equal(edition.chapters[1].archived, true);
  assert.equal(edition.chapters[0].insights[1].excluded, true); assert.equal(edition.chapters[0].insights[1].statement, '제외해도 보관할 해석');
  const oldIds = currentIds(book(state)), snapshotIds = currentIds(edition);
  assert(snapshotIds.every(id => !oldIds.includes(id))); assert.equal(new Set([edition.id, ...oldIds, ...snapshotIds]).size, 1 + oldIds.length + snapshotIds.length);
  assert.deepEqual(edition.chapters[0].versionIds, book(state).chapters[0].versionIds);
  assert(edition.chapters[0].versionIds.includes(old.version.id));
  book(next).chapters[0].note = 'B'; book(next).chapters[0].insights[0].supportVersionIds = [];
  assert.equal(edition.chapters[0].note, before.books[0].chapters[0].note);
  assert.deepEqual(edition.chapters[0].insights[0].supportVersionIds, before.books[0].chapters[0].insights[0].supportVersionIds);
});

test('restore atomically records current B before replacing it with fresh-ID A and retains the target; B can be recovered', async () => {
  const { state } = await fixture(), captured = capture(state), target = copy(book(captured).editions[0]);
  book(captured).title = '책 B'; book(captured).question = '새 질문'; book(captured).chapters[0].note = 'B 장 원고';
  book(captured).chapters[0].insights[0].statement = 'B 해석'; book(captured).chapters[1].archived = false;
  const before = copy(captured), restored = History.restore(captured, 'book_original', target.id, { createdAt: TIME });
  assert.deepEqual(captured, before); assert.equal(restored.revision, captured.revision); assert.equal(book(restored).title, '책 A');
  assert.equal(book(restored).editions.length, 2); assert.deepEqual(book(restored).editions[0], target);
  const loser = book(restored).editions[1]; assert.equal(loser.label, '복원 전 원고'); assert.equal(loser.title, '책 B');
  assert.equal(loser.chapters[0].note, 'B 장 원고'); assert.equal(loser.chapters[0].insights[0].statement, 'B 해석');
  assert.equal(loser.chapters[1].archived, false); assert.equal(book(restored).chapters[1].archived, true);
  const ids = currentIds(book(restored)).concat(...book(restored).editions.map(currentIds));
  assert.equal(new Set(ids).size, ids.length); assert.equal(Workbench.validate(restored), true);
  const returned = History.restore(restored, 'book_original', loser.id, { createdAt: TIME });
  assert.equal(book(returned).title, '책 B'); assert.equal(book(returned).chapters[0].note, 'B 장 원고');
  assert.equal(book(returned).editions.length, 3);
});

test('archive/recover is non-destructive while preview and Markdown omit archived chapters and refuse an archived book', async () => {
  const { bundle, state } = await fixture(), before = copy(state);
  const archived = History.archiveChapter(state, 'book_original', 'chapter_active');
  assert.deepEqual(state, before); assert.equal(book(archived).chapters[0].note, book(state).chapters[0].note);
  assert.deepEqual(Books.project(bundle, archived, 'book_original').chapters, []);
  assert(!Books.markdown(bundle, archived, 'book_original', { includeSources: true }).includes('A 해석'));
  const recovered = History.archiveChapter(archived, 'book_original', 'chapter_active', false);
  assert.equal(Books.project(bundle, recovered, 'book_original').chapters[0].id, 'chapter_active');
  const closed = History.archiveBook(capture(recovered), 'book_original');
  assert.throws(() => Books.project(bundle, closed, 'book_original'), { code: 'book_archived' });
  assert.throws(() => Books.markdown(bundle, closed, 'book_original'), { code: 'book_archived' });
  const fromEdition = History.restore(closed, 'book_original', book(closed).editions[0].id, { createdAt: TIME });
  assert.equal(book(fromEdition).archived, true, 'Content restoration must not silently recover a whole book');
  assert.equal(Books.project(bundle, History.archiveBook(fromEdition, 'book_original', false), 'book_original').chapters.length, 1);
});

test('ten editions block capture and restore atomically; deleting an explicit edition frees one slot without changing the current manuscript', async () => {
  const { state } = await fixture(); let full = state;
  for (let index = 0; index < 10; index++) full = capture(full, '개정본 ' + index);
  assert.equal(Workbench.LIMITS.bookEditions, 10); const before = copy(full), target = book(full).editions[0].id;
  assert.throws(() => capture(full), { code: 'book_editions_full' });
  assert.throws(() => History.restore(full, 'book_original', target), { code: 'book_editions_full' });
  assert.deepEqual(full, before);
  const smaller = History.deleteEdition(full, 'book_original', book(full).editions[9].id);
  assert.deepEqual(book(smaller).chapters, book(full).chapters); assert.equal(book(smaller).editions.length, 9);
  assert.equal(book(History.restore(smaller, 'book_original', target, { createdAt: TIME })).editions.length, 10);
});

test('capture/restore fail without modifying the input when the final combined configuration exceeds 2 MiB', async () => {
  const { state } = await fixture(); const big = copy(state);
  book(big).chapters = Array.from({ length: 60 }, (_, index) => ({ id: 'large_' + index, title: '긴 장', note: 'x'.repeat(20000), versionIds: [] }));
  assert.equal(Workbench.validate(big), true); const before = copy(big);
  assert.throws(() => capture(big), { code: 'workbench_too_large' }); assert.deepEqual(big, before);
  const small = capture(state), id = book(small).editions[0].id;
  // Restore a large snapshot: both the restored manuscript and mandatory recovery
  // copy must fit. The target is large but the current book is small.
  const snapshot = book(small).editions[0]; snapshot.chapters = copy(book(big).chapters).map(chapter => ({ ...chapter, id: 'snapshot_' + chapter.id }));
  // Make the current manuscript large too, but use fewer chapters so the initial
  // book plus snapshot still fits and the final two large snapshots cannot.
  book(small).chapters = Array.from({ length: 35 }, (_, index) => ({ id: 'current_' + index, title: '현재 장', note: 'x'.repeat(20000), versionIds: [] }));
  assert.equal(Workbench.validate(small), true); const original = copy(small);
  assert.throws(() => History.restore(small, 'book_original', id, { createdAt: TIME }), { code: 'workbench_too_large' });
  assert.deepEqual(small, original);
});

test('strict history metadata rejects noncanonical/impossible dates, malformed flags, nested histories and reused global IDs', async () => {
  const { state } = await fixture(), captured = capture(state);
  for (const createdAt of ['2026-10-08T02:03:04Z', '2026-10-08T02:03:04.005+00:00', '2026-02-30T02:03:04.005Z',
    '0000-01-01T00:00:00.000Z', '+010000-01-01T00:00:00.000Z', '2026-10-08T24:00:00.000Z', null]) {
    assert.throws(() => History.capture(state, 'book_original', '원고', { createdAt }));
  }
  for (const label of ['', ' \t', '\ud800', 'x'.repeat(501)]) assert.throws(() => capture(state, label));
  assert.equal(Workbench.validate(History.capture(state, 'book_original', '원고', { createdAt: '0001-01-01T00:00:00.000Z' })), true);
  const invalid = [
    value => { book(value).archived = 'true'; }, value => { book(value).editions = undefined; },
    value => { book(value).chapters[0].archived = null; }, value => { book(value).editions[0].editions = []; },
    value => { book(value).editions[0].archived = true; }, value => { delete book(value).editions[0].label; },
    value => { book(value).editions[0].id = book(value).id; },
    value => { book(value).editions[0].chapters[0].id = book(value).chapters[0].id; },
    value => { book(value).editions[0].chapters[0].insights[0].id = book(value).chapters[0].insights[0].id; }
  ];
  for (const mutate of invalid) { const value = copy(captured); mutate(value); assert.throws(() => Workbench.validate(value)); }
});

test('backup remaps every current, archived, snapshot and excluded exact/missing reference into one consistent new copy', async () => {
  const { bundle, state, gap } = await fixture(), captured = History.archiveBook(capture(state), 'book_original'), before = copy(captured);
  // This gap occurs only in snapshot roles after the current manuscript changes.
  book(captured).chapters[0].insights = []; book(captured).chapters[1].versionIds = [];
  const backup = Workbench.makeBackup(bundle, captured), restored = await Workbench.restoreBackup(backup);
  const b = book(restored.workbench), e = b.editions[0], mapped = restored.bundle.sourceVersions[0].id;
  const shared = restored.workbench.reflection.versionIds[1], independent = e.chapters[0].insights[0].counterVersionIds[0];
  assert.equal(b.archived, true); assert.equal(e.chapters[1].archived, true); assert.notEqual(e.id, book(captured).editions[0].id);
  assert.deepEqual(b.chapters[0].versionIds, [mapped, shared]); assert.deepEqual(e.chapters[0].versionIds, [mapped, shared]);
  assert.deepEqual(e.chapters[1].versionIds, [mapped, shared]);
  assert.deepEqual(e.chapters[0].insights[0].supportVersionIds, [mapped, shared]);
  assert.deepEqual(e.chapters[0].insights[1].counterVersionIds, [shared]);
  assert.equal(e.chapters[0].insights[1].supportVersionIds[0], independent); assert.notEqual(shared, gap);
  assert(!restored.bundle.sourceVersions.some(version => [shared, independent].includes(version.id)));
  const ids = currentIds(b).concat(currentIds(e)); assert.equal(new Set(ids).size, ids.length);
  assert.equal(e.createdAt, TIME); assert.equal(e.label, book(before).editions[0].label);
  assert.deepEqual(restored.bundle.sourceVersions.map(version => version.contentText), bundle.sourceVersions.map(version => version.contentText));
});

test('asynchronous backup restoration owns edition contents before source hashing yields', async () => {
  const { bundle, state } = await fixture(), captured = capture(state), input = Workbench.makeBackup(bundle, captured);
  const expected = copy(input.workbench.books[0].editions[0]), pending = Workbench.restoreBackup(input);
  input.workbench.books[0].editions[0].title = '대기 중 변경'; input.workbench.books[0].editions[0].chapters[0].note = '대기 중 다른 원고';
  const restored = await pending, edition = book(restored.workbench).editions[0];
  assert.equal(edition.title, expected.title); assert.equal(edition.chapters[0].note, expected.chapters[0].note);
});

test('missing targets and malformed operations do not silently archive/delete/restore another book or edition', async () => {
  const { state } = await fixture(), before = copy(state);
  assert.throws(() => History.archiveBook(state, 'not_here'), { code: 'book_missing' });
  assert.throws(() => History.archiveChapter(state, 'book_original', 'not_here'), { code: 'book_chapter_missing' });
  assert.throws(() => History.restore(state, 'book_original', 'not_here'), { code: 'book_edition_missing' });
  assert.throws(() => History.deleteEdition(state, 'book_original', 'not_here'), { code: 'book_edition_missing' });
  assert.throws(() => History.archiveBook(state, 'book_original', 'true'));
  assert.throws(() => History.archiveChapter(state, 'book_original', 'chapter_active', null));
  assert.deepEqual(state, before);
});

test('browser history uses the same public API and collision failure preserves the current manuscript', async () => {
  const { state } = await fixture();
  const context = vm.createContext({ TextEncoder, structuredClone, URL, crypto: crypto.webcrypto });
  for (const name of ['core', 'workbench', 'book-history']) vm.runInContext(fs.readFileSync(require.resolve('../assets/life/' + name + '.js'), 'utf8'), context);
  context.input = JSON.stringify(state); vm.runInContext('var state=JSON.parse(input)', context);
  const value = JSON.parse(vm.runInContext("JSON.stringify(HaedoLife.BookHistory.capture(state,'book_original','A',{createdAt:'" + TIME + "'}))", context));
  assert.equal(Workbench.validate(value), true); assert.equal(book(value).editions[0].createdAt, TIME);
  assert.equal(Object.isFrozen(context.HaedoLife.BookHistory), true);
  vm.runInContext("HaedoLife.Core={id:()=>state.books[0].id}", context);
  assert.throws(() => vm.runInContext("HaedoLife.BookHistory.capture(state,'book_original','A')", context), { code: 'id_collision' });
  assert.equal(vm.runInContext('JSON.stringify(state)', context), context.input);
});
