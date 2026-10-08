'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../assets/life/core.js');
const Workbench = require('../assets/life/workbench.js');
const Books = require('../assets/life/books.js');
const copy = value => structuredClone(value);
const insight = (id, supportVersionIds = [], counterVersionIds = []) => ({ id,
  statement: '그때보다 지금은 다른 선택을 한다.🌱\r\n단정할 수 없는 장면도 있다.', uncertainty: '글에 남지 않은 때는 아직 알 수 없다.',
  supportVersionIds, counterVersionIds, excluded: false });
async function fixture() {
  let bundle = Core.createWorkspace({ title: '익명 해석 근거' });
  const prepared = [];
  for (const input of [
    { origin: 'other', title: '정확한 옛 글', text: '옛 글 본문🌱\r\n### 원문의 제목\r\n````', url: 'https://example.invalid/old?x=%2B#raw', authorRelation: 'self', originalCreatedAt: '2020-11', coverage: 'full_text' },
    { origin: 'other', title: '반대 방향의 타인 글', text: '다른 사람의 반례 본문', author: '다른 작성자', authorRelation: 'other', originalCreatedAt: '어느 가을', coverage: 'partial', omissions: ['사진 미확보'] },
    { origin: 'other', title: '제외 전용 원문 제목', text: '제외 전용의 비공개 본문', author: '제외 전용 작성자', authorRelation: 'unknown', coverage: 'full_text' },
    { origin: 'other', title: '아직 읽지 못한 링크', text: null, url: 'https://example.invalid/link', authorRelation: 'unknown', coverage: 'link_only' }
  ]) {
    const next = await Core.prepareImport(input, bundle); prepared.push(next);
    bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, next));
  }
  const [old, other, excluded, link] = prepared;
  const newer = await Core.prepareImport({ origin: old.source.origin, title: old.source.title, existingSourceId: old.source.id,
    text: '선택하지 않은 최신 본문', coverage: 'full_text' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, newer));
  const state = Workbench.empty(bundle.workspaceId), gap = 'missing_shared_gap', separateGap = 'missing_insight_only';
  state.reflection = { note: '기존 회고', versionIds: [old.version.id, gap] };
  const active = insight('insight_active', [old.version.id, link.version.id, gap], [other.version.id, old.version.id, separateGap]);
  const removed = { ...insight('insight_excluded', [excluded.version.id, gap], [separateGap]), statement: '제외 전용 해석 문장', uncertainty: '제외 전용 불확실성', excluded: true };
  const chapter = { id: 'chapter_original', title: '기억과 글 사이', note: '직접 쓴 장 원고\r\n원고는 자동으로 수정하지 않는다.', versionIds: [gap], insights: [active, removed] };
  state.books = [{ id: 'book_original', title: '변화의 흐름', fromYear: '', toYear: '', question: '', chapters: [chapter] }];
  return { bundle, state, chapter, active, removed, old, other, excluded, link, newer, gap, separateGap };
}

test('insights are optional on old v1 chapters and an explicit empty list survives a backup without adding defaults', async () => {
  const { bundle, state, chapter } = await fixture(); delete chapter.insights;
  const before = copy(state); assert.equal(Workbench.validate(state), true);
  const restored = await Workbench.restoreBackup(Workbench.makeBackup(bundle, state));
  assert.equal(Object.hasOwn(restored.workbench.books[0].chapters[0], 'insights'), false);
  assert.deepEqual(state, before);
  chapter.insights = [];
  assert.deepEqual((await Workbench.restoreBackup(Workbench.makeBackup(bundle, state))).workbench.books[0].chapters[0].insights, []);
});

test('interpretation references stay independent of chapter selections, allow both roles and preserve missing/excluded evidence', async () => {
  const { state, chapter, active, old, removed } = await fixture(), before = copy(state);
  assert.equal(Workbench.validate(state), true);
  assert(active.supportVersionIds.includes(old.version.id) && active.counterVersionIds.includes(old.version.id));
  chapter.versionIds = []; assert.equal(Workbench.validate(state), true);
  assert.deepEqual(active, before.books[0].chapters[0].insights[0]);
  assert.equal(removed.excluded, true); assert.equal(chapter.note, before.books[0].chapters[0].note);
});

test('strict interpretation schema rejects inferred-origin fields, duplicate IDs/role refs and malformed UTF-16', async () => {
  const { state } = await fixture();
  const invalid = [
    c => { c.insights = null; }, c => { c.insights = undefined; }, c => { c.insights = {}; },
    c => { c.insights.length++; }, c => { c.insights.extra = true; },
    c => { c.insights[0].origin = 'ai'; }, c => { c.insights[0].unknown = true; },
    c => { delete c.insights[0].excluded; }, c => { c.insights[0].excluded = 'false'; },
    c => { c.insights[0].statement = '\ud800'; }, c => { c.insights[0].uncertainty = '\udc00'; },
    c => { c.insights[0].uncertainty = '모름\0'; }, c => { c.insights[0].statement = null; },
    c => { c.insights[0].uncertainty = null; }, c => { c.insights[0].id = '../insight'; },
    c => { c.insights[0].id = c.id; }, c => { c.insights[1].id = c.insights[0].id; },
    c => { c.insights[0].supportVersionIds.push(c.insights[0].supportVersionIds[0]); },
    c => { c.insights[0].counterVersionIds.push(c.insights[0].counterVersionIds[0]); },
    c => { c.insights[0].supportVersionIds = null; }, c => { c.insights[0].counterVersionIds.push('../version'); }
  ];
  for (const mutate of invalid) { const value = copy(state); mutate(value.books[0].chapters[0]); assert.throws(() => Workbench.validate(value)); }
  for (const id of [state.books[0].id, 'group_collision', 'page_collision']) {
    const value = copy(state); value.books[0].chapters[0].insights[0].id = id;
    value.groups.push({ id: 'group_collision', title: '묶음', versionIds: [] });
    value.page.entries.push({ id: 'page_collision', title: '페이지', parts: [], note: '', pinned: false, enabled: true, showBody: false, showNote: true });
    assert.throws(() => Workbench.validate(value), { code: 'duplicate_id' });
  }
  const value = copy(state); value.books[0].chapters.push({ id: 'another_chapter', title: '다른 장', note: '', versionIds: [], insights: [copy(value.books[0].chapters[0].insights[0])] });
  assert.throws(() => Workbench.validate(value), { code: 'duplicate_id' });
});

test('an empty interpretation draft stores its exact empty statement and exports uncertainty/evidence without a fabricated claim', async () => {
  const { bundle, state, active, chapter, old } = await fixture(); chapter.versionIds = [];
  active.statement = ''; active.uncertainty = '작성 전에 더 읽고 싶은 대목';
  const before = copy(state); assert.equal(Workbench.validate(state), true);
  const output = Books.markdown(bundle, state, 'book_original');
  assert(output.includes('아직 작성하지 않은 해석')); assert(output.includes(active.uncertainty));
  assert(output.includes('원문 작성일: 2020-11')); assert(output.includes(old.source.url));
  const restored = await Workbench.restoreBackup(Workbench.makeBackup(bundle, state));
  assert.equal(restored.workbench.books[0].chapters[0].insights[0].statement, '');
  assert.deepEqual(state, before);
  active.statement = ' \t\r\n'; assert.equal(Workbench.validate(state), true);
  assert(Books.markdown(bundle, state, 'book_original').includes('해석: ' + active.statement));
});

test('interpretation/role/UTF-16 limits and aggregate 2 MiB budget reject instead of trimming', async () => {
  const { state, chapter } = await fixture();
  assert.deepEqual([Workbench.LIMITS.chapterInsights, Workbench.LIMITS.insightVersions], [100, 100]);
  chapter.insights = Array.from({ length: 100 }, (_, index) => insight('insight_' + index));
  assert.equal(Workbench.validate(state), true);
  chapter.insights.push(insight('insight_overflow')); assert.throws(() => Workbench.validate(state)); chapter.insights.pop();
  const one = chapter.insights[0];
  for (const role of ['supportVersionIds', 'counterVersionIds']) {
    one[role] = Array.from({ length: 100 }, (_, index) => 'version_' + index); assert.equal(Workbench.validate(state), true);
    one[role].push('version_overflow'); assert.throws(() => Workbench.validate(state)); one[role].pop();
  }
  one.statement = '🌱'.repeat(10000); one.uncertainty = ''; assert.equal(Workbench.validate(state), true);
  one.statement += 'x'; assert.throws(() => Workbench.validate(state)); one.statement = '해석';
  one.uncertainty = 'x'.repeat(20001); assert.throws(() => Workbench.validate(state));
  chapter.insights.forEach(value => { value.statement = '글'.repeat(10000); value.uncertainty = ''; });
  assert.throws(() => Workbench.validate(state), { code: 'workbench_too_large' });
  assert.equal(chapter.insights.length, 100); assert.equal(one.statement.length, 10000);
});

test('backup atomically remaps every interpretation ID and independent role reference including shared and excluded gaps', async () => {
  const { bundle, state, chapter, gap, separateGap } = await fixture(), before = copy({ bundle, state });
  const restored = await Workbench.restoreBackup(Workbench.makeBackup(bundle, state));
  const c = restored.workbench.books[0].chapters[0], [active, removed] = c.insights;
  const oldId = restored.bundle.sourceVersions[0].id, otherId = restored.bundle.sourceVersions[1].id;
  const removedId = restored.bundle.sourceVersions[2].id, linkId = restored.bundle.sourceVersions[3].id;
  const shared = restored.workbench.reflection.versionIds[1], independent = active.counterVersionIds[2];
  assert.deepEqual(active.supportVersionIds, [oldId, linkId, shared]);
  assert.deepEqual(active.counterVersionIds, [otherId, oldId, independent]);
  assert.deepEqual(removed.supportVersionIds, [removedId, shared]); assert.deepEqual(removed.counterVersionIds, [independent]);
  assert.deepEqual(c.versionIds, [shared]); assert.notEqual(shared, gap); assert.notEqual(independent, separateGap);
  assert(!restored.bundle.sourceVersions.some(value => [shared, independent].includes(value.id)));
  assert.notEqual(active.id, chapter.insights[0].id); assert.notEqual(removed.id, chapter.insights[1].id); assert.notEqual(active.id, removed.id);
  assert.equal(removed.excluded, true); assert.equal(removed.statement, chapter.insights[1].statement);
  assert.equal(c.note, chapter.note); assert.deepEqual({ bundle, state }, before);
  const again = await Workbench.restoreBackup(Workbench.makeBackup(restored.bundle, restored.workbench));
  const second = again.workbench.books[0].chapters[0].insights;
  assert.equal(second[0].supportVersionIds[2], second[1].supportVersionIds[1]);
  assert.equal(second[0].counterVersionIds[2], second[1].counterVersionIds[0]);
});

test('restore snapshots the interpretation, both roles and excluded state before asynchronous source hashing', async () => {
  const { bundle, state } = await fixture(), backup = Workbench.makeBackup(bundle, state), before = copy(backup);
  const pending = Workbench.restoreBackup(backup), active = backup.workbench.books[0].chapters[0].insights[0];
  active.statement = '대기 중 새 해석'; active.supportVersionIds = []; active.counterVersionIds = []; active.excluded = true;
  const restored = await pending, result = restored.workbench.books[0].chapters[0].insights[0];
  assert.equal(result.statement, before.workbench.books[0].chapters[0].insights[0].statement);
  assert.equal(result.supportVersionIds.length, 3); assert.equal(result.counterVersionIds.length, 3); assert.equal(result.excluded, false);
});

test('default Markdown includes only active interpretation text and role-specific exact provenance without original bodies', async () => {
  const { bundle, state, chapter, active, removed, old, other, excluded, newer } = await fixture(); chapter.versionIds = [];
  const before = copy({ bundle, state }), output = Books.markdown(bundle, state, 'book_original');
  assert(output.includes(active.statement)); assert(output.includes(active.uncertainty)); assert(output.includes(chapter.note));
  const supportStart = output.indexOf('#### 근거로 연결한 원문'), counterStart = output.indexOf('#### 반례로 연결한 원문');
  assert(supportStart >= 0 && counterStart > supportStart);
  assert(output.slice(supportStart, counterStart).includes('원문 작성일: 2020-11'));
  assert(!output.slice(supportStart, counterStart).includes(other.source.title));
  assert(output.slice(counterStart).includes('작성자 관계: 다른 사람의 기록'));
  assert(output.slice(counterStart).includes('누락: 사진 미확보')); assert(output.includes('원문 작성일: 어느 가을'));
  assert(output.includes('선택 버전: 1/2')); assert(output.includes(old.source.url));
  assert(output.includes('연결된 원문 없음'));
  for (const value of [removed.statement, removed.uncertainty, excluded.source.title, excluded.version.originalAuthor.label,
    old.version.contentText, other.version.contentText, excluded.version.contentText, newer.version.contentText]) assert(!output.includes(value), value);
  assert.deepEqual({ bundle, state }, before);
});

test('opt-in bodies preserve raw exact versions and excluded-only evidence never leaks; excluding is reversible without editing the note', async () => {
  const { bundle, state, chapter, active, removed, old, other, excluded, newer } = await fixture(); chapter.versionIds = [];
  active.statement = '<script>현재 해석</script>\r\n`````\n# 제목 모양'; active.uncertainty = '불확실함\n```';
  const output = Books.markdown(bundle, state, 'book_original', { includeSources: true });
  assert(output.includes('``````\n해석: ' + active.statement + '\n``````'));
  assert(output.includes(old.version.contentText)); assert(output.includes(other.version.contentText));
  assert(output.includes('`````\n' + old.version.contentText + '\n`````'));
  assert(output.includes('본문 미확보 · 링크만 보관했습니다.'));
  assert(!output.includes(excluded.version.contentText)); assert(!output.includes(newer.version.contentText));
  active.excluded = true; const note = chapter.note;
  const hidden = Books.markdown(bundle, state, 'book_original', { includeSources: true });
  assert(!hidden.includes(active.statement)); assert(!hidden.includes(old.version.contentText)); assert(hidden.includes(note));
  active.excluded = false; assert.equal(Books.markdown(bundle, state, 'book_original', { includeSources: true }), output);
  assert.equal(chapter.note, note); assert.equal(removed.excluded, true);
});

test('excluding an interpretation leaves independently selected chapter evidence and the raw chapter manuscript intact', async () => {
  const { bundle, state, chapter, active, old, excluded } = await fixture();
  active.excluded = true; chapter.versionIds = [old.version.id];
  chapter.note = '독립적으로 쓴 장 원고\n' + active.statement;
  const output = Books.markdown(bundle, state, 'book_original', { includeSources: true });
  assert(output.includes(chapter.note)); assert(output.includes(old.version.contentText));
  assert(!output.includes('### 현재 해석')); assert(!output.includes(excluded.version.contentText));
});
