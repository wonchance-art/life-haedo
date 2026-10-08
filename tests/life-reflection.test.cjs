'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Reflection = require('../assets/life/reflection.js');
const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const bundle = {
    sources: [{ id: 'garden', title: '정원에서 다시 읽은 질문', url: 'https://example.invalid/garden?one=1&two=2' },
      { id: 'book', title: '타인의 글을 읽으며', url: 'https://example.invalid/book' },
      { id: 'unknown', title: '시기가 아직 확인되지 않은 기록' }, { id: 'link', title: '링크만 보관' }],
    sourceVersions: [
      { id: 'garden_old', sourceId: 'garden', originalCreatedAt: '2020-12-31T23:30:00-09:00', contentText: '예전 본문🌱\r\n그때의 기록 그대로.',
        originalAuthor: { relation: 'self', label: '나' }, coverage: { status: 'full_text', omissions: [] } },
      { id: 'garden_new', sourceId: 'garden', originalCreatedAt: '2025-03-12', contentText: '최신 본문을 이전 버전에 대신 넣으면 안 됩니다.',
        originalAuthor: { relation: 'self', label: '나' }, coverage: { status: 'full_text', omissions: [] } },
      { id: 'book_version', sourceId: 'book', originalCreatedAt: '2019', contentText: '다른 사람의 보관 본문',
        originalAuthor: { relation: 'other', label: '다른 작성자' }, coverage: { status: 'partial', omissions: ['사진 미보관'] } },
      { id: 'unknown_version', sourceId: 'unknown', originalCreatedAt: '2024년 가을 산책', importedAt: '2017-01-01T00:00:00Z', contentText: '현재 생각과 혼동하면 안 되는 원문',
        originalAuthor: { relation: 'unknown', label: '' }, coverage: { status: 'unknown', omissions: [] } },
      { id: 'link_version', sourceId: 'link', originalCreatedAt: null, importedAt: '2018-01-01T00:00:00Z', contentText: null,
        originalAuthor: { relation: 'unknown', label: '' }, coverage: { status: 'link_only', omissions: ['본문 미확보'] } }
    ]
  };
  const workbench = { groups: [{ id: 'reading', title: '읽고 생각한 것', versionIds: ['book_version', 'garden_old', 'unselected'] },
    { id: 'newer_only', title: '나중의 정원', versionIds: ['garden_new'] },
    { id: 'second_theme', title: '다시 머문 장소', versionIds: ['garden_old'] }],
    reflection: { versionIds: ['garden_old', 'book_version', 'unknown_version', 'link_version', 'missing_version'],
      note: '## 그때의 선택\r\n기억나는 장면🌱\r\n\r\n## 지금의 생각\n지금은 어떻게 읽는가?' } };
  return { bundle, workbench };
}

test('year accepts real calendar dates and preserves the written year across timezone boundaries', () => {
  for (const [raw, expected] of [['2019', 2019], ['2020-11', 2020], ['2024-01', 2024], ['2024-12', 2024],
    ['2024-02-29', 2024], ['2000-02-29', 2000], ['0001-01-01', 1],
    ['2020-12-31T23:30:00-09:00', 2020], ['2021-01-01T00:30:00+14:00', 2021], ['2024-06-01T12:30:45.123Z', 2024]])
    assert.equal(Reflection.year(raw), expected, raw);
});

test('year rejects coerced, impossible and free-form dates instead of inferring an experience year', () => {
  for (const raw of [null, undefined, 2020, '', '20', '0000', '0000-01', '2024-00', '2024-13', '2024-1', '2024-11 extra',
    '0000-01-01', '1900-02-29', '2024-02-30', '2024-00-12',
    '2024-13-01', '2024-01-00', '2024-04-31', '2024년 가을', ' 2024 ', '2024-01-01 extra',
    '2024-01-01T25:00:00Z', '2024-01-01T00:61:00Z', '2024-01-01T00:00:00+99:00', '2024-01-01Tbad'])
    assert.equal(Reflection.year(raw), null, String(raw));
});

test('chronology groups only selected exact versions, keeping unavailable and undated evidence without import-date fallback', () => {
  const { bundle, workbench } = fixture(), before = clone({ bundle, workbench });
  assert.deepEqual(Reflection.chronology(bundle, workbench.reflection.versionIds), [
    { key: '2019', label: '2019년', versionIds: ['book_version'] },
    { key: '2020', label: '2020년', versionIds: ['garden_old'] },
    { key: 'unknown', label: '작성 시기 미확인', versionIds: ['unknown_version', 'link_version', 'missing_version'] }
  ]);
  assert.deepEqual({ bundle, workbench }, before);
});

test('year filtering is inclusive, leaves unknown evidence visible and does not manufacture empty years', () => {
  const { bundle, workbench } = fixture(), ids = workbench.reflection.versionIds;
  assert.deepEqual(Reflection.chronology(bundle, ids, { from: '2020', to: '2020' }).map(row => row.key), ['2020', 'unknown']);
  assert.deepEqual(Reflection.chronology(bundle, ids, { from: '2021', to: '2023' }), [
    { key: 'unknown', label: '작성 시기 미확인', versionIds: ['unknown_version', 'link_version', 'missing_version'] }
  ]);
  assert.deepEqual(Reflection.chronology(bundle, ['garden_old'], { from: '2021' }), []);
  assert.deepEqual(Reflection.chronology(bundle, []), []);
  assert.deepEqual(Reflection.chronology(bundle, ['garden_old'], { to: '2020' })[0].versionIds, ['garden_old']);
});

test('a year-month date participates in year filtering without inventing a day or changing raw export metadata', () => {
  const { bundle, workbench } = fixture(); bundle.sourceVersions[0].originalCreatedAt = '2020-11';
  assert.deepEqual(Reflection.chronology(bundle, ['garden_old'], { from: '2020', to: '2020' }), [
    { key: '2020', label: '2020년', versionIds: ['garden_old'] }
  ]);
  assert.deepEqual(Reflection.chronology(bundle, ['garden_old'], { from: '2021' }), []);
  assert(Reflection.markdown(bundle, workbench).includes('원문 작성일: 2020-11'));
  assert.equal(bundle.sourceVersions[0].originalCreatedAt, '2020-11');
});

test('malformed and reversed year filters reject explicitly without changing the selection', () => {
  const { bundle, workbench } = fixture(), ids = workbench.reflection.versionIds.slice();
  for (const range of [{ from: '2024', to: '2020' }, { from: '2024-01-01' }, { to: '2024년' }, { from: '0000' }, { from: 2024 }])
    assert.throws(() => Reflection.chronology(bundle, ids, range), { code: 'invalid_reflection_range' });
  assert.deepEqual(ids, workbench.reflection.versionIds);
});

test('themes use exact intersections, permit one source in several themes and keep every ungrouped reference', () => {
  const { workbench } = fixture(), before = clone(workbench);
  assert.deepEqual(Reflection.themes(workbench, workbench.reflection.versionIds), [
    { key: 'reading', label: '읽고 생각한 것', versionIds: ['book_version', 'garden_old'] },
    { key: 'second_theme', label: '다시 머문 장소', versionIds: ['garden_old'] },
    { key: 'ungrouped', label: '묶음에 넣지 않은 기록', versionIds: ['unknown_version', 'link_version', 'missing_version'] }
  ]);
  assert.deepEqual(Reflection.themes(workbench, []), []);
  assert.deepEqual(workbench, before);
});

test('default Markdown preserves the current manuscript and exact-version metadata but excludes every original body', () => {
  const { bundle, workbench } = fixture(), before = clone({ bundle, workbench });
  const output = Reflection.markdown(bundle, workbench);
  assert(output.includes(workbench.reflection.note));
  assert(output.includes('원문 작성일: 2020-12-31T23:30:00-09:00'));
  assert(output.includes('원문 작성일: 2024년 가을 산책'));
  assert(output.includes('선택 버전: 1/2'));
  assert(output.includes('작성자 관계: 다른 사람의 기록'));
  assert(output.includes('작성자 관계: 작성자 관계 미확인'));
  assert(output.includes('원문 URL: https://example.invalid/garden?one=1&two=2'));
  assert(output.includes('누락: 사진 미보관'));
  assert(output.includes('연결된 원문 없음'));
  for (const version of bundle.sourceVersions) if (version.contentText) assert(!output.includes(version.contentText));
  assert(!output.includes('2017-01-01T00:00:00Z'));
  assert.deepEqual({ bundle, workbench }, before);
});

test('only explicit includeSources exports selected raw bodies, retaining CRLF and unavailable-body status', () => {
  const { bundle, workbench } = fixture(), output = Reflection.markdown(bundle, workbench, { includeSources: true });
  for (const id of workbench.reflection.versionIds) {
    const version = bundle.sourceVersions.find(version => version.id === id);
    if (version?.contentText) assert(output.includes(version.contentText));
  }
  assert(!output.includes(bundle.sourceVersions[1].contentText));
  assert(output.includes('본문 미확보 · 링크만 보관했습니다.'));
  assert.throws(() => Reflection.markdown(bundle, workbench, { includeSources: 'true' }), { code: 'invalid_reflection' });
});

test('Markdown refuses a manuscript and originals from different workspaces', () => {
  const { bundle, workbench } = fixture(); bundle.workspaceId = 'workspace_a'; workbench.workspaceId = 'workspace_b';
  assert.throws(() => Reflection.markdown(bundle, workbench), { code: 'invalid_reflection' });
});

test('raw metadata and backtick-rich optional bodies stay literal inside fences rather than active links or HTML', () => {
  const { bundle, workbench } = fixture(); workbench.reflection.versionIds = ['garden_old'];
  bundle.sources[0].title = '<script>표식</script>\n```\n# 제목 모양';
  bundle.sources[0].url = 'javascript:alert("원형 URL")';
  bundle.sourceVersions[0].contentText = '그대로🌱\r\n````\r\n[본문 링크 모양](data:text/html,plain)';
  const output = Reflection.markdown(bundle, workbench, { includeSources: true });
  assert(output.includes('````\n제목: ' + bundle.sources[0].title));
  assert(output.includes('원문 URL: javascript:alert("원형 URL")'));
  assert(!output.includes('](javascript:'));
  assert(output.includes('`````\n' + bundle.sourceVersions[0].contentText + '\n`````'));
  assert(output.includes(workbench.reflection.note));
});

test('CommonJS exports the same frozen API made available to the browser namespace', () => {
  assert.equal(globalThis.HaedoLife.Reflection, Reflection);
  assert.equal(Object.isFrozen(Reflection), true);
});

test('a large original with many separate backtick runs exports without truncation or argument-limit failure', () => {
  const { bundle, workbench } = fixture(); workbench.reflection.versionIds = ['garden_old'];
  bundle.sourceVersions[0].contentText = '`기록 '.repeat(150000);
  const output = Reflection.markdown(bundle, workbench, { includeSources: true });
  assert(output.includes(bundle.sourceVersions[0].contentText));
});
