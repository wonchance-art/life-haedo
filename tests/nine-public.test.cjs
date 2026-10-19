'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../assets/life/nine-public.js'), N = require('../assets/life/nine-board.js'), Share = require('../assets/life/share.js');
const Core = require('../assets/life/core.js'), R = require('../assets/life/source-reference.js');
const copy = value => structuredClone(value);
function fixture(count = 3) {
  const board = N.create(Core.id); board.title = '비공개 구성 제목'; board.intro = '비공개 구성 소개';
  const area = board.areas[0]; area.title = '선택 영역'; area.note = '비공개 영역 메모';
  for (let index = 0; index < count; index++) {
    const item = N.snapshot({ type: index % 2 ? 'artwork' : 'book', title: '전체 제목 ' + index + ' 🌱', creator: '만든 사람 ' + index,
      url: 'https://example.org/item?edition=' + index + '#source', note: '컬렉션 개인 메모', tags: ['개인 태그'] });
    item.reason = '비공개 선택 이유 ' + index; area.items.push(item);
  }
  board.areas.push({ id: Core.id(), title: '선택하지 않은 영역', note: '다른 영역 메모', items: [N.snapshot({ type: 'other', title: '다른 영역 항목' })] });
  const other = N.create(Core.id); other.title = '다른 구성';
  const state = { ...N.empty(Core.id()), revision: 7, boards: [board, other] };
  return { state, board, area, options: { boardId: board.id, areaId: area.id, title: '직접 검토한 공개 제목' } };
}
test('one-area projection retains exact ordered metadata and excludes private fields from the wire', () => {
  const f = fixture(), before = copy(f.state), review = M.project(f.state, f.options), wire = JSON.stringify(review.snapshot);
  assert(Share.validate(review.snapshot)); assert.equal(review.workspaceId, f.state.workspaceId); assert.equal(review.localRevision, 7);
  assert.equal(review.boardId, f.board.id); assert.equal(review.areaId, f.area.id); assert.equal(review.snapshot.title, f.options.title); assert.equal(review.snapshot.intro, null);
  assert.deepEqual(review.snapshot.entries, [{ title: f.area.title, pinned: false, note: null, parts: [], attachments: f.area.items.map(item => item.attachment) }]);
  for (const hidden of [f.state.workspaceId, f.board.id, f.area.id, f.board.title, f.board.intro, f.area.note,
    '비공개 선택 이유', '개인 메모', '개인 태그', '선택하지 않은 영역', '다른 영역 항목', '다른 구성', 'reference']) assert(!wire.includes(hidden), hidden);
  assert.deepEqual(f.state, before); assert(Object.isFrozen(review)); assert(Object.isFrozen(review.snapshot.entries[0].attachments[0]));
  assert(!Object.isFrozen(f.state.boards[0])); f.area.items[0].attachment.title = '원본만 변경'; assert.equal(review.snapshot.entries[0].attachments[0].title, '전체 제목 0 🌱');
});
test('native parse preserves full title, creator, source and order with nine trailing null-padded slots', () => {
  for (const count of [1, 3, 9]) {
    const f = fixture(count), review = M.project(f.state, { ...f.options, intro: '직접 쓴 소개\r\n두 번째 줄' }), before = copy(review.snapshot), result = M.parse(review.snapshot);
    assert.equal(result.title, f.options.title); assert.equal(result.intro, '직접 쓴 소개\r\n두 번째 줄'); assert.equal(result.areaTitle, f.area.title); assert.equal(result.items.length, 9);
    assert.deepEqual(result.items.slice(0, count), f.area.items.map(item => item.attachment)); assert.deepEqual(result.items.slice(count), Array(9 - count).fill(null));
    assert(Object.isFrozen(result.items)); assert(Object.isFrozen(result.items[0])); assert.deepEqual(review.snapshot, before);
    const editable = copy(review.snapshot), parsed = M.parse(editable); editable.entries[0].attachments[0].title = '입력 사본 변경';
    assert.equal(parsed.items[0].title, f.area.items[0].attachment.title); assert(!Object.isFrozen(editable));
  }
});
test('private source references and quoted text cannot enter a projected snapshot', async () => {
  const f = fixture(1); let bundle = Core.createWorkspace({ workspaceId: f.state.workspaceId });
  const prepared = await Core.prepareImport({ origin: 'obsidian', title: '비공개 근거 제목', text: '비공개 인용 구절\n원문 전체는 제외', authorRelation: 'other' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared));
  const reference = await R.build({ bundle, sourceId: prepared.source.id, versionId: prepared.version.id, locator: { start: 0, end: 9 } });
  f.state.format = 'life-nine-board-v2'; f.area.items[0].reference = { kind: 'source', value: reference };
  const wire = JSON.stringify(M.project(f.state, f.options).snapshot);
  for (const hidden of [reference.quote, reference.contentHash, reference.sourceId, reference.sourceVersionId, 'locator', 'reference', '원문 전체는 제외']) assert(!wire.includes(hidden), hidden);
});
test('explicit public text is never filled from private board descriptions and uses the existing text validator', () => {
  const f = fixture(); f.area.title = '';
  const result = M.project(f.state, { ...f.options, intro: '' }); assert.equal(result.snapshot.intro, ''); assert.equal(result.snapshot.entries[0].title, '이름 없는 영역');
  for (const options of [{ boardId: f.board.id, areaId: f.area.id }, { ...f.options, title: '' }, { ...f.options, title: '\ud800' },
    { ...f.options, intro: '\u0000숨은 문자' }, { ...f.options, intro: f.board }, { ...f.options, title: '긴'.repeat(501) }, { ...f.options, privateNote: '숨김' }]) assert.throws(() => M.project(f.state, options));
});
test('missing, empty, overfilled and sparse selections fail without changing the source', () => {
  const empty = fixture(0); assert.throws(() => M.project(empty.state, empty.options));
  const f = fixture(), before = copy(f.state);
  assert.throws(() => M.project(f.state, { ...f.options, boardId: Core.id() })); assert.throws(() => M.project(f.state, { ...f.options, areaId: Core.id() }));
  const over = fixture(9); over.area.items.push(copy(over.area.items[0])); assert.throws(() => M.project(over.state, over.options));
  const sparse = fixture(); delete sparse.area.items[1]; assert.throws(() => M.project(sparse.state, sparse.options)); assert.deepEqual(f.state, before);
});
test('generic public pages cannot introduce body parts, notes, multiple areas, private keys or more than nine slots', () => {
  const f = fixture(9), valid = M.project(f.state, f.options).snapshot;
  for (const change of [s => s.entries = [], s => s.entries.push(copy(s.entries[0])), s => s.entries[0].attachments = [],
    s => s.entries[0].attachments.push(copy(s.entries[0].attachments[0])), s => delete s.entries[0].attachments,
    s => s.entries[0].pinned = true, s => s.entries[0].note = '개인 메모', s => s.entries[0].parts.push({ text: '원문 본문' }),
    s => s.ownerId = 'private', s => s.entries[0].areaId = 'private', s => s.entries[0].attachments[0].reason = '개인 이유',
    s => s.entries[0].attachments[0].reference = {}, s => s.entries[0].attachments.privateNote = '배열의 숨은 값', s => delete s.entries[0].attachments[2]]) {
    const invalid = copy(valid); change(invalid); assert.throws(() => M.parse(invalid));
  }
});
test('unsafe links and unsupported attachment kinds are rejected using existing validators', () => {
  for (const url of ['javascript:alert(1)', 'https://user:secret@example.org/', 'https://example.org/a b', 'https://example.org/\\hidden']) {
    const f = fixture(1); f.area.items[0].attachment.url = url; assert.throws(() => M.project(f.state, f.options));
    const g = fixture(1), snapshot = copy(M.project(g.state, g.options).snapshot); snapshot.entries[0].attachments[0].url = url; assert.throws(() => M.parse(snapshot));
  }
  const f = fixture(1); f.area.items[0].attachment.type = 'script'; assert.throws(() => M.project(f.state, f.options));
  const g = fixture(1), snapshot = copy(M.project(g.state, g.options).snapshot); snapshot.entries[0].attachments[0].type = 'script'; assert.throws(() => M.parse(snapshot));
});
