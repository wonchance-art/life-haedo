'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Core = require('../assets/life/core.js');
const Workbench = require('../assets/life/workbench.js');
const Books = require('../assets/life/books.js');
const Remote = require('../assets/life/composition-remote.js');
const copy = value => structuredClone(value);
const chapter = (id, versionIds = []) => ({ id, title: '장 제목 ' + id, note: '현재 원고🌱\r\n그때와 지금.', versionIds });
const book = (id, chapters = []) => ({ id, title: '일과 쉼', fromYear: '', toYear: '', question: '무엇이 달라졌는가?', chapters });
async function fixture() {
  let bundle = Core.createWorkspace({ title: '익명 책 자료' });
  const old = await Core.prepareImport({ origin: 'naver_blog', title: '같은 글의 원문', text: '예전 본문🌱\r\n### 원문 제목\r\n````\r\n끝',
    url: 'https://example.invalid/old?a=%2B#raw', author: '나', authorRelation: 'self', originalCreatedAt: '2020-11', coverage: 'full_text' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, old));
  const newer = await Core.prepareImport({ origin: 'naver_blog', title: old.source.title, existingSourceId: old.source.id,
    text: '선택하지 않은 새 버전 본문', url: old.source.url, authorRelation: 'self', originalCreatedAt: '2025', coverage: 'full_text' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, newer));
  const other = await Core.prepareImport({ origin: 'other', title: '타인의 글', text: '보관한 타인 본문',
    author: '다른 사람', authorRelation: 'other', originalCreatedAt: '어느 가을', coverage: 'partial', omissions: ['사진 미보관'] }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, other));
  const link = await Core.prepareImport({ origin: 'other', title: '본문 없는 링크', text: null,
    url: 'https://example.invalid/link', coverage: 'link_only' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, link));
  const state = Workbench.empty(bundle.workspaceId), gap = 'missing_exact_version';
  state.reflection = { note: '기존 회고를 책으로 덮어쓰지 않습니다.', versionIds: [old.version.id, gap] };
  state.books = [book('book_one', [chapter('chapter_one', [old.version.id, other.version.id, gap]), chapter('chapter_two', [old.version.id, link.version.id, gap])]),
    book('book_two', [chapter('chapter_three', [newer.version.id])])];
  state.books[0].fromYear = '2022'; state.books[0].toYear = '2024';
  return { bundle, state, old, newer, other, link, gap };
}

test('old v1 and empty book lists stay optional without changing the existing reflection or input', async () => {
  const { bundle, state } = await fixture(); delete state.books; const before = copy(state);
  assert.equal(Workbench.validate(state), true);
  const restored = await Workbench.restoreBackup(Workbench.makeBackup(bundle, state));
  assert.equal(Object.hasOwn(restored.workbench, 'books'), false);
  assert.equal(Object.hasOwn(Workbench.empty(bundle.workspaceId), 'books'), false);
  assert.deepEqual(state, before);
  state.books = []; assert.equal(Workbench.validate(state), true);
  assert.deepEqual((await Workbench.restoreBackup(Workbench.makeBackup(bundle, state))).workbench.books, []);
});

test('books keep explicit chapter order and allow shared exact versions and missing references without filtering by period', async () => {
  const { state, old, gap } = await fixture(), before = copy(state);
  assert.equal(Workbench.validate(state), true); assert.deepEqual(state, before);
  assert(state.books[0].chapters.every(value => value.versionIds.includes(old.version.id) && value.versionIds.includes(gap)));
  state.books[0].chapters.reverse(); assert.equal(Workbench.validate(state), true);
  assert.deepEqual(state.reflection, before.reflection);
});

test('strict book/chapter schemas reject unknown fields, duplicate IDs, invalid dates and malformed Unicode', async () => {
  const { state } = await fixture();
  const invalid = [
    s => { s.books = undefined; }, s => { s.books = null; }, s => { s.books = {}; },
    s => { s.books.length++; }, s => { s.books.extra = true; }, s => { s.books[0].unknown = true; },
    s => { delete s.books[0].question; }, s => { s.books[0].chapters[0].unknown = true; },
    s => { s.books[0].chapters[0].note = null; }, s => { s.books[0].question = '\ud800'; },
    s => { s.books[0].chapters[0].note = '\udc00'; }, s => { s.books[0].title = ' \t'; },
    s => { s.books[0].chapters[0].title = ''; }, s => { s.books[0].question = '질문\0'; },
    s => { s.books[0].fromYear = '0000'; }, s => { s.books[0].fromYear = 2020; },
    s => { s.books[0].fromYear = '２０２０'; }, s => { s.books[0].fromYear = '2020-01'; },
    s => { s.books[0].fromYear = '2025'; }, s => { s.books[0].toYear = '2024년'; },
    s => { s.books[0].id = '../book'; }, s => { s.books[1].id = s.books[0].id; },
    s => { s.books[1].chapters[0].id = s.books[0].chapters[0].id; },
    s => { s.books[0].chapters[0].id = s.books[0].id; },
    s => { s.groups.push({ id: s.books[0].id, title: '중복', versionIds: [] }); },
    s => { s.books[0].chapters[0].versionIds.push(s.books[0].chapters[0].versionIds[0]); }
  ];
  for (const mutate of invalid) { const value = copy(state); mutate(value); assert.throws(() => Workbench.validate(value)); }
  const valid = copy(state); valid.books[0].fromYear = '0001'; valid.books[0].toYear = '9999';
  assert.equal(Workbench.validate(valid), true);
});

test('books use the agreed collection and UTF-16 limits and the shared 2 MiB budget without truncation', () => {
  const state = Workbench.empty('workspace_books');
  assert.deepEqual([Workbench.LIMITS.books, Workbench.LIMITS.bookChapters, Workbench.LIMITS.chapterVersions], [20, 100, 1000]);
  state.books = Array.from({ length: 20 }, (_, i) => book('book_' + i)); assert.equal(Workbench.validate(state), true);
  state.books.push(book('book_overflow')); assert.throws(() => Workbench.validate(state)); state.books.pop();
  state.books[0].chapters = Array.from({ length: 100 }, (_, i) => chapter('chapter_' + i)); assert.equal(Workbench.validate(state), true);
  state.books[0].chapters.push(chapter('chapter_overflow')); assert.throws(() => Workbench.validate(state)); state.books[0].chapters.pop();
  const one = state.books[0].chapters[0]; one.versionIds = Array.from({ length: 1000 }, (_, i) => 'version_' + i);
  assert.equal(Workbench.validate(state), true); one.versionIds.push('version_overflow'); assert.throws(() => Workbench.validate(state)); one.versionIds.pop();
  one.note = '🌱'.repeat(10000); assert.equal(Workbench.validate(state), true);
  one.note += 'x'; assert.throws(() => Workbench.validate(state)); one.note = '';
  state.books[0].question = 'x'.repeat(20001); assert.throws(() => Workbench.validate(state)); state.books[0].question = '';
  state.books[0].title = 'x'.repeat(501); assert.throws(() => Workbench.validate(state)); state.books[0].title = '책';
  state.books[0].chapters.forEach(value => { value.note = '글'.repeat(10000); });
  assert.throws(() => Workbench.validate(state), { code: 'workbench_too_large' });
  assert.equal(one.note.length, 10000);
});

test('backup remaps books and chapters and shared real/missing references atomically with existing reflection', async () => {
  const { bundle, state, gap } = await fixture(), before = copy({ bundle, state });
  const backup = Workbench.makeBackup(bundle, state), restored = await Workbench.restoreBackup(backup);
  assert.deepEqual({ bundle, state }, before);
  const mappedOld = restored.bundle.sourceVersions[0].id, mappedGap = restored.workbench.reflection.versionIds[1];
  assert.notEqual(mappedGap, gap); assert(!restored.bundle.sourceVersions.some(value => value.id === mappedGap));
  for (const chapter of restored.workbench.books[0].chapters) {
    assert(chapter.versionIds.includes(mappedOld)); assert(chapter.versionIds.includes(mappedGap));
  }
  const ids = restored.workbench.books.flatMap(value => [value.id, ...value.chapters.map(item => item.id)]);
  assert.equal(new Set(ids).size, ids.length);
  const oldIds = state.books.flatMap(value => [value.id, ...value.chapters.map(item => item.id)]);
  assert(ids.every(id => !oldIds.includes(id)));
  assert.deepEqual(restored.workbench.books.map(value => value.chapters.map(item => item.title)), state.books.map(value => value.chapters.map(item => item.title)));
  assert.equal(restored.workbench.books[0].fromYear, '2022');
  assert.equal(restored.workbench.reflection.note, state.reflection.note);
  assert.equal(restored.workbench.revision, 0);
  const again = await Workbench.restoreBackup(Workbench.makeBackup(restored.bundle, restored.workbench));
  assert.notEqual(again.workbench.books[0].id, restored.workbench.books[0].id);
  assert.equal(again.workbench.books[0].chapters[0].versionIds[2], again.workbench.reflection.versionIds[1]);
});

test('asynchronous restore owns the whole book snapshot before source hashing yields', async () => {
  const { bundle, state } = await fixture(), input = Workbench.makeBackup(bundle, state), before = copy(input);
  const pending = Workbench.restoreBackup(input);
  input.workbench.books[0].title = '대기 중 다른 제목';
  input.workbench.books[0].chapters[0].note = '대기 중 다른 원고';
  input.workbench.books[0].chapters[0].versionIds = [];
  input.sourceBackup.workspace.sourceVersions[0].contentText = '대기 중 다른 본문';
  const restored = await pending;
  assert.equal(restored.workbench.books[0].title, before.workbench.books[0].title);
  assert.equal(restored.workbench.books[0].chapters[0].note, before.workbench.books[0].chapters[0].note);
  assert.equal(restored.workbench.books[0].chapters[0].versionIds.length, 3);
  assert.equal(restored.bundle.sourceVersions[0].contentText, before.sourceBackup.workspace.sourceVersions[0].contentText);
});

test('default book export uses only the chosen book, ordered chapters and exact-version safe provenance', async () => {
  const { bundle, state, old, newer, other } = await fixture(), before = copy({ bundle, state });
  const output = Books.markdown(bundle, state, 'book_one');
  assert(output.includes(state.books[0].question)); assert(output.includes('설정한 기간: 2022 ~ 2024'));
  assert(output.includes('원문 작성일: 2020-11')); assert(output.includes('선택 버전: 1/2'));
  assert(output.includes('다른 사람의 기록')); assert(output.includes('사진 미보관')); assert(output.includes('연결된 원문 없음'));
  assert(output.includes('원문 작성일: 어느 가을')); assert(output.includes(old.source.url));
  assert(output.indexOf('장 제목: 장 제목 chapter_one') < output.indexOf('장 제목: 장 제목 chapter_two'));
  assert(!output.includes(state.reflection.note)); assert(!output.includes('chapter_three'));
  for (const prepared of [old, newer, other]) assert(!output.includes(prepared.version.contentText));
  assert.deepEqual({ bundle, state }, before);
});

test('explicit body export retains raw CRLF, fences and metadata while excluding unselected newest versions', async () => {
  const { bundle, state, old, newer, other } = await fixture();
  state.books[0].title = '책\n```\n# 제목 모양'; state.books[0].question = '<script>질문</script>\n```';
  state.books[0].chapters[0].title = '[장](javascript:alert(1))';
  const output = Books.markdown(bundle, state, 'book_one', { includeSources: true });
  assert(output.includes('````\n책 제목: ' + state.books[0].title + '\n````'));
  assert(output.includes(state.books[0].question));
  assert(output.includes('```\n장 제목: [장](javascript:alert(1))\n```'));
  assert(output.includes('`````\n' + old.version.contentText + '\n`````'));
  assert(output.includes(other.version.contentText)); assert(!output.includes(newer.version.contentText));
  assert(output.includes(state.books[0].chapters[0].note));
  assert(output.includes('작성자 관계 미확인')); assert(output.includes('본문 미확보 · 링크만 보관했습니다.'));
  assert(output.includes('#### 근거 1')); assert(output.includes('##### 선택한 버전의 보관 본문'));
});

test('book export fails closed for a missing book, wrong workspace and malformed composition/options', async () => {
  const { bundle, state } = await fixture();
  assert.throws(() => Books.markdown(bundle, state, 'not_here'), { code: 'book_missing' });
  assert.throws(() => Books.markdown(bundle, { ...state, workspaceId: 'elsewhere' }, 'book_one'), { code: 'workspace_mismatch' });
  assert.throws(() => Books.markdown(bundle, state, 'book_one', { includeSources: 'true' }), { code: 'invalid_book' });
  const bad = copy(state); bad.books[0].chapters[0].versionIds.push(bad.books[0].chapters[0].versionIds[0]);
  assert.throws(() => Books.markdown(bundle, bad, 'book_one'), { code: 'duplicate_id' });
  state.books = [book('empty_book')]; assert(Books.markdown(bundle, state, 'empty_book').includes('아직 구성한 장이 없습니다.'));
});

test('browser and CommonJS expose the same frozen book helper', async () => {
  const { bundle, state } = await fixture();
  const context = vm.createContext({ TextEncoder, structuredClone, Date, URL, crypto: crypto.webcrypto });
  for (const file of ['core', 'workbench', 'reflection', 'books']) vm.runInContext(fs.readFileSync(require.resolve('../assets/life/' + file + '.js'), 'utf8'), context);
  context.fixtureJSON = JSON.stringify({ bundle, state });
  vm.runInContext('var {bundle,state}=JSON.parse(fixtureJSON)', context);
  assert.equal(vm.runInContext("HaedoLife.Books.markdown(bundle,state,'book_one')", context), Books.markdown(bundle, state, 'book_one'));
  assert.equal(Object.isFrozen(context.HaedoLife.Books), true);
  assert.deepEqual(Object.keys(Books), ['markdown']);
});

test('composition remote owns full book data before authorization and server rejection cannot strip books', async () => {
  const { state } = await fixture(); let resolve, sent;
  const ready = new Promise(done => { resolve = done; });
  const remote = Remote.create({ auth: { ready: true, config: { url: 'https://fixture.supabase.co', key: 'fixture' } }, workbench: Workbench,
    clientFactory: () => () => ({ auth: { getUser: () => ready, dispose() {} }, async rpc(_name, params) { sent = params; return { error: { code: '22023' } }; } }) });
  const workspaceId = '11111111-1111-4111-8111-111111111111'; state.workspaceId = workspaceId;
  const before = copy(state);
  const pending = remote.write({ workspaceId, operationId: '22222222-2222-4222-8222-222222222222', expectedRevision: 0, sourceRevision: 1, data: state });
  state.books[0].title = '인증 대기 중 바뀐 제목';
  resolve({ data: { user: { id: 'fixture' } }, error: null });
  await assert.rejects(pending, { code: 'invalid_request' });
  assert.deepEqual(sent.p_data, before); assert(Object.hasOwn(sent.p_data, 'books'));
  assert.equal(state.books[0].title, '인증 대기 중 바뀐 제목'); remote.dispose();
});
