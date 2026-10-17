'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../assets/life/core.js'), R = require('../assets/life/source-reference.js'), N = require('../assets/life/nine-board.js'), U = require('../assets/life/unified-search.js');
async function fixture() {
  let bundle = C.createWorkspace(); const p = await C.prepareImport({ origin: 'obsidian', title: '원문 근거', text: '🌱\r\n선택한 구절\n나머지 비공개 내용', authorRelation: 'unknown' }, bundle);
  bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, p));
  const ref = await R.build({ bundle, sourceId: p.source.id, versionId: p.version.id, locator: { start: 4, end: 10 } });
  const board = N.create(C.id); board.title = '고른 기록'; board.areas[0].title = '다시 볼 것';
  const item = N.evidenceSnapshot({ kind: 'source', value: ref }); item.reason = '직접 쓴 선택 이유'; board.areas[0].items.push(item);
  return { bundle, ref, board, state: { ...N.empty(bundle.workspaceId), format: 'life-nine-board-v2', boards: [board] } };
}
test('v2 evidence is explicit and exact, while legacy empty/default/backup remain v1', async () => {
  const { state, ref, board } = await fixture(); assert(N.validate(state));
  assert.equal(state.boards[0].areas[0].items[0].reference.value.quote, ref.quote);
  assert.equal(N.empty('legacy').format, 'life-nine-board-v1');
  const legacy = N.create(C.id); legacy.areas[0].items.push(N.snapshot({ type: 'book', title: '기존 책' }));
  assert.equal(N.backup([legacy]).format, 'life-nine-board-backup-v1'); assert.deepEqual(N.readBackup(N.backup([legacy])), [legacy]);
  assert.throws(() => N.validate({ ...state, format: 'life-nine-board-v1' }));
  assert.throws(() => N.readBackup({ format: 'life-nine-board-backup-v1', boards: [board] }));
});
test('v2 backup and copies preserve frozen source identity, show missing bindings across workspaces and never guess by URL', async () => {
  const { board, bundle, ref } = await fixture(), snapshot = structuredClone(board);
  const file = N.backup([board]); assert.equal(file.format, 'life-nine-board-backup-v2');
  const restored = N.copies(N.readBackup(JSON.parse(JSON.stringify(file))), C.id);
  assert.notEqual(restored[0].id, board.id); assert.deepEqual(restored[0].areas[0].items[0].reference.value, ref);
  await R.resolve(bundle, restored[0].areas[0].items[0].reference.value);
  await assert.rejects(R.resolve({ ...bundle, workspaceId: C.id() }, ref)); assert.deepEqual(board, snapshot);
  const quoteOnly = N.html(board); assert(quoteOnly.includes(ref.quote)); assert(!quoteOnly.includes(ref.sourceId)); assert(!quoteOnly.includes(bundle.workspaceId));assert(!quoteOnly.includes('나머지 비공개 내용'));
});
test('existing exact search targets, reason edits, duplicate review and 9-item cap include references without changing originals', async () => {
  const { state, board } = await fixture(), before = structuredClone(state);
  const result = U.search({ nineBoard: state }, '직접 쓴 선택 이유')[0]; assert.equal(result.kind, 'nine');
  assert.equal(U.resolveNineTarget(state, result.nineTarget).item.reference.value.quote, board.areas[0].items[0].reference.value.quote);
  const changed = structuredClone(board); changed.areas[0].items[0].reference.value.quote = '완전히 새구절';
  changed.areas[0].items[0].reference.value.locator.end = changed.areas[0].items[0].reference.value.locator.start + '완전히 새구절'.length;
  assert.throws(() => U.resolveNineTarget({ ...state, boards: [changed] }, result.nineTarget), /다시 불러와/);
  const reordered=structuredClone(state),reference=reordered.boards[0].areas[0].items[0].reference;
  reference.value=Object.fromEntries(Object.entries(reference.value).reverse());
  assert.equal(U.resolveNineTarget(reordered,result.nineTarget).item.reference.value.quote,board.areas[0].items[0].reference.value.quote);
  assert.deepEqual(N.reviewBoards([board],reordered.boards),[{existing:true,file:false}]);assert.deepEqual(N.changed([board],reordered.boards),[]);
  assert.deepEqual(N.reviewBoards([board], [changed]), [{ existing: false, file: false }]);
  assert.deepEqual(N.changed([board], [changed]), [changed]);
  const full = structuredClone(board); full.areas[0].items = Array.from({ length: 9 }, () => structuredClone(board.areas[0].items[0])); assert(N.boards([full], true));
  full.areas[0].items.push(structuredClone(full.areas[0].items[0])); assert.throws(() => N.boards([full], true)); assert.deepEqual(state, before);
});
