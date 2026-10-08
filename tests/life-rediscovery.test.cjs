const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../assets/life/core.js');
const workbench = require('../assets/life/workbench.js');
const rediscovery = require('../assets/life/rediscovery.js');
const clone = value => JSON.parse(JSON.stringify(value));

async function fixture(specs = []) {
  let bundle = core.createWorkspace(); const refs = [];
  for (const spec of specs) {
    const prepared = await core.prepareImport({ origin: 'other', forceSeparate: true, ...spec }, bundle);
    bundle = core.applyChanges(bundle, core.buildImportChanges(bundle, prepared, []));
    refs.push({ sourceId: prepared.source.id, versionId: prepared.version.id });
  }
  return { bundle, state: workbench.empty(bundle.workspaceId), refs };
}
async function newer(data, index, text) {
  const source = data.bundle.sources.find(value => value.id === data.refs[index].sourceId);
  const prepared = await core.prepareImport({ origin: source.origin, title: source.title, text,
    existingSourceId: source.id }, data.bundle);
  data.bundle = core.applyChanges(data.bundle, core.buildImportChanges(data.bundle, prepared, []));
  return { sourceId: prepared.source.id, versionId: prepared.version.id };
}
function topic(data, ref, name) {
  const version = data.bundle.sourceVersions.find(item => item.id === ref.versionId), now = data.bundle.updatedAt;
  const record = { id: core.id(), kind: 'excerpt', text: version.contentText.slice(0, 1), topic: name,
    note: '이 메모는 추천의 단어 근거로 사용하지 않습니다.', sourceRefs: [{ sourceId: ref.sourceId,
      sourceVersionId: ref.versionId, locator: { start: 0, end: 1 } }], provenance: { kind: 'user' },
    revision: 1, createdAt: now, updatedAt: now };
  data.bundle = core.applyChanges(data.bundle, { put: { records: [record] } }); return record.id;
}
function group(data, refs, title = '선택해서 연결한 기록') {
  data.state.groups.push({ id: core.id(), title, versionIds: refs.map(ref => ref.versionId) });
}
function related(data, seed = 0, options) { return rediscovery.related(data.bundle, data.state,
  typeof seed === 'number' ? data.refs[seed].versionId : seed, options); }

test('two exact Korean tokens are evidence while one token or generic words do not fill empty results', async () => {
  const data = await fixture([{ title: '기준', text: '정원 산책' }, { title: '연결갑', text: '정원 산책 풍경' },
    { title: '연결을', text: '정원 도예' }, { title: '무관', text: '양자역학 중력파' }]);
  const result = related(data);
  assert.equal(result.length, 1); assert.equal(result[0].versionId, data.refs[1].versionId);
  assert.deepEqual(result[0].reasons, [{ kind: 'term', label: '산책', field: 'body' }, { kind: 'term', label: '정원', field: 'body' }]);
  assert.equal(result[0].snippet, '정원 산책 풍경');
  const generic = await fixture([{ title: '기준', text: '오늘 기록 그리고 새로운 생각 함께' },
    { title: '후보', text: '오늘 기록 그리고 새로운 생각 함께' }]);
  assert.deepEqual(related(generic), []);
});

test('particle endings and semantic or morphological similarity are never guessed', async () => {
  const data = await fixture([{ title: '기준', text: '정원 산책 읽기' },
    { title: '후보', text: '정원의 산책은 읽었다' }]);
  assert.deepEqual(related(data), []);
});

test('realistic Korean reading examples separate useful literal evidence from generic activity words', async () => {
  const data = await fixture([
    { title: '비 온 뒤 동네를 걸으며 남긴 메모', text: '오늘 정원 산책 중에 낮은 담장 너머 식물을 보았다. 보고 싶은 풍경을 문장 하나로 적고 돌아왔다.' },
    { title: '주말 사진에 붙인 짧은 글', text: '정원 산책. 젖은 잎사귀의 빛과 좁은 골목을 오래 기억하고 싶다.' },
    { title: '서점에서 읽은 소설의 한 구절', text: '보고 싶은 사람이 등장할 때마다 문장 끝이 짧아졌다. 화자의 침묵과 시점을 읽고 적고 남긴 독서 메모.' },
    { title: '도시의 공원을 거니는 법', text: '녹지를 천천히 걸으면 마음의 속도가 달라진다.' },
    { title: '정원 산책 행사 안내', text: null, url: 'https://example.org/garden' }
  ]);
  const result = related(data);
  assert.deepEqual(new Set(result.map(item => item.sourceId)), new Set([data.refs[1].sourceId, data.refs[4].sourceId]));
  assert.ok(result.every(item => item.reasons.every(reason => reason.kind !== 'term' || !['보고', '읽고', '적고', '남긴'].includes(reason.label))));
  // The semantically related park example is an acknowledged miss, not fabricated evidence.
  assert.ok(!result.some(item => item.sourceId === data.refs[3].sourceId));
  // The reader can explicitly connect a text even when its wording supplies no signal.
  group(data, [data.refs[0], data.refs[3]], '걷기의 감각');
  assert.equal(related(data)[0].sourceId, data.refs[3].sourceId);
});

test('explicit exact-version groups rank before matching topics and two common terms', async () => {
  const data = await fixture([{ title: '기준', text: '정원 산책' }, { title: '그룹후보', text: '지질학 해양' },
    { title: '주제후보', text: '천문학 별빛' }, { title: '단어후보', text: '정원 산책 풍경' }]);
  group(data, data.refs.slice(0, 2), '직접 정리한 묶음'); topic(data, data.refs[0], '마음에 남은 질문'); topic(data, data.refs[2], '마음에 남은 질문');
  const result = related(data);
  assert.deepEqual(result.map(value => value.versionId), data.refs.slice(1).map(value => value.versionId));
  assert.deepEqual(result[0].reasons, [{ kind: 'group', label: '직접 정리한 묶음' }]);
  assert.deepEqual(result[1].reasons, [{ kind: 'topic', label: '마음에 남은 질문' }]);
});

test('the selected older seed stays exact and its own newer version is never a recommendation', async () => {
  const data = await fixture([{ title: '기준', text: '정원 산책' }, { title: '후보', text: '정원 산책 풍경' }]);
  const latestSeed = await newer(data, 0, '천문학 망원경');
  assert.deepEqual(related(data).map(value => value.versionId), [data.refs[1].versionId]);
  assert.deepEqual(related(data, latestSeed.versionId), []);
});

test('latest candidates never inherit old-version groups or topics', async () => {
  const data = await fixture([{ title: '기준', text: '정원 산책' }, { title: '후보', text: '도예 가마' }]);
  group(data, data.refs); topic(data, data.refs[0], '연결할 주제'); topic(data, data.refs[1], '연결할 주제');
  const newest = await newer(data, 1, '천문학 망원경');
  assert.deepEqual(related(data), []);
  group(data, [data.refs[0], newest], '현재 버전 연결');
  assert.deepEqual(related(data).map(value => value.versionId), [newest.versionId]);
  assert.deepEqual(related(data)[0].reasons, [{ kind: 'group', label: '현재 버전 연결' }]);
});

test('latest means the last Core version, independent of imported or original dates', async () => {
  const data = await fixture([{ title: '기준', text: '정원 산책' }, { title: '후보', text: '천문학 망원경' }]);
  const latest = await newer(data, 1, '정원 산책 풍경');
  data.bundle.sourceVersions.at(-1).importedAt = '2000-01-01T00:00:00.000Z';
  assert.equal(related(data)[0].versionId, latest.versionId);
});

test('directed source exclusions apply across versions without excluding the reverse direction', async () => {
  const data = await fixture([{ title: '기준', text: '정원 산책' }, { title: '후보', text: '정원 산책' }]);
  data.state.discovery = { excludedPairs: [{ seedSourceId: data.refs[0].sourceId, candidateSourceId: data.refs[1].sourceId }] };
  assert.deepEqual(related(data), []);
  assert.equal(related(data, 1)[0].sourceId, data.refs[0].sourceId);
  await newer(data, 1, '정원 산책 풍경'); assert.deepEqual(related(data), []);
});

test('link-only title evidence is labeled as title evidence and never invents a body', async () => {
  const data = await fixture([{ title: '정원 산책', text: '풍경' },
    { title: '정원 산책 안내', text: null, url: 'https://example.org/original' }]);
  const result = related(data)[0];
  assert.equal(result.snippet, ''); assert(result.reasons.every(reason => reason.kind === 'term' && reason.field === 'title'));
  assert.equal(result.versionId, data.refs[1].versionId);
});

test('source URLs and query parameters in a body do not become word evidence', async () => {
  const data = await fixture([{ title: '기준', text: 'https://example.org/정원/산책?query=풍경' },
    { title: '후보', text: 'https://example.org/정원/산책?query=풍경' }]);
  assert.deepEqual(related(data), []);
});

test('deleted record topics are no longer used and unrelated note text is ignored', async () => {
  const data = await fixture([{ title: '기준', text: '정원 산책' }, { title: '후보', text: '도예 가마' }]);
  topic(data, data.refs[0], '명시한 주제'); const deleted = topic(data, data.refs[1], '명시한 주제');
  assert.equal(related(data).length, 1);
  data.bundle = core.applyChanges(data.bundle, { remove: { records: [deleted] } });
  assert.deepEqual(related(data), []);
});

test('only selected seed and latest candidate bodies are read; all source candidates remain eligible', async () => {
  const data = await fixture([{ title: '기준', text: '정원 산책' }, { title: '후보', text: '과거 내용' }]);
  const old = data.bundle.sourceVersions.find(value => value.id === data.refs[1].versionId);
  const latest = await newer(data, 1, '정원 산책 풍경');
  Object.defineProperty(data.bundle.sourceVersions.find(value => value.id === old.id), 'contentText', {
    get() { throw new Error('Historical candidate body must not be read'); }
  });
  assert.equal(related(data)[0].versionId, latest.versionId);
});

test('body comparison stops at the documented 16,000 UTF-16 limit with safe snippet boundaries', async () => {
  const data = await fixture([{ title: '기준', text: '정원 산책' },
    { title: '후보', text: ' '.repeat(rediscovery.LIMITS.bodyCharacters) + '정원 산책' }]);
  assert.deepEqual(related(data), []);
  const version = data.bundle.sourceVersions.at(-1); version.contentText = '🌱'.repeat(40) + ' 정원 산책 ' + '풍경 '.repeat(100);
  const result = related(data)[0];
  assert(result.snippet.includes('정원 산책')); assert(!/^[\udc00-\udfff]|[\ud800-\udbff]$/.test(result.snippet.replace(/^…|…$/g, '')));
});

test('a word cut at the body budget boundary cannot turn into a shorter matching word', async () => {
  const data = await fixture([{ title: '기준', text: '산책 영화' },
    { title: '후보', text: '산책 ' + ' '.repeat(15995) + '영화평론가' }]);
  assert.deepEqual(related(data), []);
});

test('title versus body matches keep a generic reason instead of claiming the same field', async () => {
  const data = await fixture([{ title: '기준', text: '정원 산책' },
    { title: '정원 산책 안내', text: null, url: 'https://example.org/original' }]);
  const result = related(data)[0];
  assert.equal(result.snippet, ''); assert(result.reasons.every(reason => reason.kind === 'term' && !Object.hasOwn(reason, 'field')));
});

test('results are deterministic, capped at three and leave all source and composition data unchanged', async () => {
  const data = await fixture([{ title: '기준', text: '정원 산책' }, ...Array.from({ length: 6 }, (_, index) =>
    ({ title: '후보' + index, text: '정원 산책' }))]);
  const before = JSON.stringify(data);
  const first = related(data), second = related(data); assert.deepEqual(first, second); assert.equal(first.length, 3);
  assert.deepEqual(first.map(result => result.sourceId), data.refs.slice(1).map(ref => ref.sourceId).sort().slice(0, 3));
  assert.equal(related(data, 0, { limit: 1 }).length, 1); assert.equal(JSON.stringify(data), before);
  first[0].reasons[0].label = '호출자가 바꾼 사본'; assert.deepEqual(related(data), second);
  const reordered = clone(data); reordered.bundle.sources.reverse(); assert.deepEqual(related(reordered), second);
});

test('large seed vocabularies keep the same exact-token contract without dropping later terms', async () => {
  const data = await fixture([{ title: '기준', text: Array.from({ length: 600 }, (_, index) => '어휘' + index).join(' ') },
    { title: '후보', text: '어휘550 어휘599' }]);
  const result = related(data);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].reasons, [{ kind: 'term', label: '어휘550', field: 'body' }, { kind: 'term', label: '어휘599', field: 'body' }]);
});

test('small and large seed vocabularies use the same conservative digit boundary', async () => {
  const extra = Array.from({ length: 550 }, (_, index) => '무관어휘' + index).join(' ');
  for (const suffix of ['', ' ' + extra]) {
    const data = await fixture([{ title: '기준', text: '독서 산책' + suffix },
      { title: '후보', text: '2026독서 산책' }]);
    assert.deepEqual(related(data), []);
  }
});

test('expanding Unicode lowercase mappings preserve results across the native matcher threshold', async () => {
  const extra = Array.from({ length: 550 }, (_, index) => '무관어휘' + index).join(' ');
  const results = [];
  for (const suffix of ['', ' ' + extra]) {
    const data = await fixture([{ title: '기준', text: 'İstanbul 독서' + suffix },
      { title: '후보', text: 'İstanbul 독서' }]);
    const result = related(data);
    assert.equal(result.length, 1); results.push({ reasons: result[0].reasons, snippet: result[0].snippet });
  }
  assert.deepEqual(results[0], results[1]);
  assert(results[0].reasons.some(reason => reason.label === 'İstanbul'));
});

test('invalid requests and unavailable seeds fail with actionable codes', async () => {
  const data = await fixture([{ title: '기준', text: '정원 산책' }]);
  for (const limit of [0, -1, 4, 1000, '3', 1.5]) assert.throws(() => related(data, 0, { limit }), { code: 'invalid_request' });
  assert.throws(() => related(data, 'missing-version'), { code: 'seed_missing' });
  const mismatch = clone(data); mismatch.state.workspaceId = 'other';
  assert.throws(() => related(mismatch), { code: 'invalid_data' });
  data.state.discovery = { excludedPairs: [{ seedSourceId: data.refs[0].sourceId }] };
  assert.throws(() => related(data), { code: 'invalid_data' });
});

// Deliberately small cross-origin corpus. These are preservation fixtures, not
// a claim that two literal terms establish useful semantic recommendations.
const qualitySamples = [
  { key: 'walk', origin: 'apple_notes', title: '비 온 뒤 동네 정원을 걷다', text: '정원 산책 중에 젖은 잎사귀와 낮은 담장을 살폈다. 천천히 둘러보며 호흡을 고르는 시간이 도움이 되었다.' },
  { key: 'caption', origin: 'instagram', title: '주말 사진에 붙인 짧은 글', text: '정원 산책. 젖은 잎사귀의 빛과 담장 너머 꽃을 담았다. 비가 그친 뒤 풍경이 한층 맑았다.' },
  { key: 'park', origin: 'obsidian', title: '도시의 녹지를 거니는 법', text: '정원의 산책은 목적지보다 주변을 살피는 과정에 가깝다. 나뭇잎을 자세히 바라보니 계절의 변화가 느껴졌다.' },
  { key: 'link', origin: 'naver_blog', title: '정원 산책 행사 안내', text: null, url: 'https://example.org/garden' },
  { key: 'novel', origin: 'obsidian', title: '소설 속 화자의 침묵', text: '화자의 대사가 짧아질수록 인물 사이의 긴장이 커졌다. 시점과 서술 순서를 따로 표시하는 작업이 도움이 되었다.' },
  { key: 'meeting', origin: 'apple_notes', title: '팀 회의의 결정을 남기다', text: '담당자와 기한을 표로 분리했다. 회의가 끝난 뒤 결론부터 공유하는 방식이 도움이 되었다. 도움이 되었다.' },
  { key: 'coffee', origin: 'apple_notes', title: '드립 커피 추출을 바꾸다', text: '드립 커피 추출 시간을 줄이고 분쇄도를 조절했다. 저울로 물의 양을 확인하는 과정이 도움이 되었다.' },
  { key: 'brew', origin: 'naver_blog', title: '원두를 바꾼 아침', text: '드립 커피 추출 시간을 삼 분으로 맞췄다. 분쇄도를 조금 굵게 하니 쓴맛이 줄었다.' },
  { key: 'train', origin: 'instagram', title: '막차를 기다린 저녁', text: '기차 출발 전에 플랫폼 번호를 확인했다. 환승 동선을 미리 살펴본 일이 도움이 되었다.' },
  { key: 'updated', origin: 'apple_notes', title: '주말 관찰 노트', text: '정원 산책 사진을 분류했다.' },
  { key: 'excluded', origin: 'instagram', title: '돌담 옆 화단', text: '정원 산책 중에 라벤더 향을 맡았다. 잎사귀의 색을 사진에 남겼다.' },
  { key: 'recipe', origin: 'obsidian', title: '팬에 구운 채소', text: '불을 낮추고 가지를 천천히 뒤집었다. 굽기 전에 물기를 닦아낸 과정이 도움이 되었다.' }
];

test('cross-origin Korean corpus keeps literal evidence grounded, exact latest versions and directed exclusions', async () => {
  const data = await fixture(qualitySamples.map(({ key, ...sample }) => sample));
  const latest = await newer(data, 9, '목성 위성의 공전 주기를 조사했다. 망원경 배율과 구름의 움직임을 비교했다.');
  data.state.discovery = { excludedPairs: [{ seedSourceId: data.refs[0].sourceId, candidateSourceId: data.refs[10].sourceId }] };
  const before = JSON.stringify(data);
  const pair = (left, right) => {
    const ids = new Set([data.refs[left].sourceId, data.refs[right].sourceId]);
    return rediscovery.related({ ...data.bundle, sources: data.bundle.sources.filter(item => ids.has(item.id)),
      sourceVersions: data.bundle.sourceVersions.filter(item => ids.has(item.sourceId)) }, data.state, data.refs[left].versionId);
  };
  assert.equal(pair(0, 1)[0].versionId, data.refs[1].versionId);
  assert.equal(pair(0, 3)[0].snippet, '');
  assert.equal(pair(6, 7)[0].versionId, data.refs[7].versionId);
  assert.deepEqual(pair(0, 9), [], 'The old garden candidate must not survive its unrelated latest version');
  assert.equal(data.bundle.sourceVersions.at(-1).id, latest.versionId);
  assert.deepEqual(pair(0, 10), []);
  assert.equal(pair(10, 0)[0].versionId, data.refs[0].versionId);
  // Check every eligible pair so the three-result cap cannot conceal bad references.
  // False relevance from boilerplate is evaluated in rediscovery-quality.md.
  for (let left = 0; left < data.refs.length; left++) for (let right = 0; right < data.refs.length; right++) {
    if (left === right) continue;
    for (const result of pair(left, right)) {
      const seed = data.bundle.sourceVersions.find(item => item.id === data.refs[left].versionId);
      const candidate = data.bundle.sourceVersions.find(item => item.id === result.versionId);
      assert.equal(result.sourceId, data.refs[right].sourceId);
      assert.equal(result.versionId, data.bundle.sourceVersions.filter(item => item.sourceId === result.sourceId).at(-1).id);
      for (const reason of result.reasons.filter(reason => reason.kind === 'term')) {
        assert((qualitySamples[left].title + '\n' + (seed.contentText || '')).includes(reason.label));
        assert((qualitySamples[right].title + '\n' + (candidate.contentText || '')).includes(reason.label));
      }
      if (candidate.contentText === null) assert.equal(result.snippet, '');
      else assert(candidate.contentText.includes(result.snippet.replace(/^…|…$/g, '')));
    }
  }
  assert.equal(JSON.stringify(data), before);
});

test('help-related holdouts preserve substantive literal topics and explicit user topics in both directions', async () => {
  const specs = [
    [{ title: '이웃을 찾아간 오후', text: '도움이 필요한 이웃에게 연락했다.' }, { title: '주민센터 자원활동', text: '도움이 필요한 어르신에게 안부를 물었다.' }],
    [{ title: '처음 온 사람을 위한 안내', text: '도움 요청 방법을 문서로 남겼다.' }, { title: '행사 현장 담당표', text: '도움 요청 창구를 한곳으로 모았다.' }],
    [{ title: '저녁의 독서', text: '도움이 되었다. 천문학 망원경 관측법을 익혔다.' }, { title: '별자리 관찰', text: '도움이 되었다. 천문학 망원경 조작을 배웠다.' }]
  ];
  for (const pair of specs) {
    const data = await fixture(pair), before = JSON.stringify(data);
    for (const [seed, candidate] of [[0, 1], [1, 0]]) {
      const result = related(data, seed)[0];
      assert.equal(result.versionId, data.refs[candidate].versionId);
      for (const reason of result.reasons) {
        assert.equal(reason.kind, 'term');
        assert(pair[seed].text.includes(reason.label)); assert(pair[candidate].text.includes(reason.label));
      }
    }
    assert.equal(JSON.stringify(data), before);
  }
  const explicit = await fixture([{ title: '동네 연락망', text: '안부 전화를 나눴다.' },
    { title: '생활 지원 모임', text: '식료품 배달 순서를 정했다.' }]);
  for (const ref of explicit.refs) topic(explicit, ref, '도움이 필요한 이웃');
  for (const seed of [0, 1]) assert.deepEqual(related(explicit, seed)[0].reasons,
    [{ kind: 'topic', label: '도움이 필요한 이웃' }]);
});
