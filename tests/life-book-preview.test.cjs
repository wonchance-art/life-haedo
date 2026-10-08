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
async function fixture() {
  let bundle = Core.createWorkspace({ title: '익명 책 미리보기' }); const imported = [];
  for (const input of [
    { origin: 'other', title: '<img src=x onerror=alert(1)> 옛 글', text: '선택한 옛 본문🌱\r\n### 원문 제목\r\n````',
      url: 'https://example.invalid/old?raw=%2B#part', author: '<script>작성자</script>', authorRelation: 'self', originalCreatedAt: '2020-11', coverage: 'full_text' },
    { origin: 'other', title: '타인 반례', text: '다른 관점 본문', author: '다른 작성자', authorRelation: 'other', originalCreatedAt: '어느 가을', coverage: 'partial', omissions: ['사진 미보관'] },
    { origin: 'other', title: '링크만 있는 자료', text: null, url: 'https://example.invalid/link', coverage: 'link_only' },
    { origin: 'other', title: '제외 전용 제목', text: '제외 전용 본문', author: '제외 전용 작성자', coverage: 'full_text' }
  ]) { const item = await Core.prepareImport(input, bundle); imported.push(item); bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, item)); }
  const [old, other, link, excluded] = imported;
  const newer = await Core.prepareImport({ origin: 'other', title: old.source.title, existingSourceId: old.source.id, text: '선택 밖 최신 본문', coverage: 'full_text' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, newer));
  const state = Workbench.empty(bundle.workspaceId);
  state.reflection.note = '선택 밖 회고'; state.groups.push({ id: 'outside_group', title: '선택 밖 묶음', versionIds: [newer.version.id] });
  const active = { id: 'active_thought', statement: '직접 쓴 해석\r\n<script>텍스트</script>', uncertainty: '모르는 점\n```',
    supportVersionIds: [link.version.id, old.version.id], counterVersionIds: [other.version.id, 'missing_version'], excluded: false };
  const blank = { id: 'blank_thought', statement: '', uncertainty: '', supportVersionIds: [], counterVersionIds: [], excluded: false };
  const removed = { id: 'excluded_thought', statement: '제외 전용 해석', uncertainty: '제외 전용 불확실성', supportVersionIds: [excluded.version.id], counterVersionIds: ['excluded_gap'], excluded: true };
  state.books = [{ id: 'chosen_book', title: '책\n```\n# 제목 모양', fromYear: '2022', toYear: '2024', question: '질문 <script>평문</script>',
    chapters: [{ id: 'first_chapter', title: '첫 장 [제목](javascript:alert(1))', note: '# 사용자 원고\r\n현재 생각🌱', versionIds: [old.version.id, 'missing_version'], insights: [active, blank, removed] },
      { id: 'second_chapter', title: '두 번째 장', note: '둘째 장 원고', versionIds: [old.version.id] }] },
    { id: 'other_book', title: '선택 밖 책', fromYear: '', toYear: '', question: '선택 밖 질문', chapters: [{ id: 'other_chapter', title: '선택 밖 장', note: '선택 밖 원고', versionIds: [newer.version.id] }] }];
  return { bundle, state, old, other, link, excluded, newer };
}
// Captured from the existing exporter before adding Books.project. These frozen
// anonymous strings are a standalone byte oracle; no Git history is needed in CI.
const LEGACY_PLAIN = "# 비공개 책 원고\n\n````\n책 제목: 책\n```\n# 제목 모양\n````\n\n```\n설정한 기간: 2022 ~ 2024\n질문: 질문 <script>평문</script>\n```\n\n설정한 기간은 책의 설명이며 선택한 근거를 자동으로 제한하지 않습니다. 원문 작성일은 경험 시기를 뜻하지 않습니다.\n\n## 장 1\n\n```\n장 제목: 첫 장 [제목](javascript:alert(1))\n```\n\n### 현재 원고\n\n# 사용자 원고\r\n현재 생각🌱\n\n### 선택한 근거 원문\n\n원문 작성일은 경험 시기를 뜻하지 않습니다.\n\n#### 근거 1\n\n```\n제목: <img src=x onerror=alert(1)> 옛 글\n원문 작성일: 2020-11\n원 작성자: <script>작성자</script>\n작성자 관계: 내 기록\n원문 URL: https://example.invalid/old?raw=%2B#part\n선택 버전: 1/2\n본문 확보 범위: full_text\n누락: 확인한 누락 없음\n```\n\n#### 근거 2\n\n```\n연결된 원문 없음\n다른 버전으로 대체하지 않았습니다.\n```\n\n\n### 현재 해석 1\n\n사용자가 직접 쓴 해석입니다. 연결한 글을 내 신념이나 해석의 증명으로 자동 판단하지 않습니다.\n\n```\n해석: 직접 쓴 해석\r\n<script>텍스트</script>\n```\n\n````\n불확실성: 모르는 점\n```\n````\n\n#### 근거로 연결한 원문\n\n원문 작성일은 경험 시기를 뜻하지 않습니다.\n\n##### 근거 1\n\n```\n제목: 링크만 있는 자료\n원문 작성일: 미확인\n원 작성자: 미확인\n작성자 관계: 작성자 관계 미확인\n원문 URL: https://example.invalid/link\n선택 버전: 1/1\n본문 확보 범위: link_only\n누락: 확인한 누락 없음\n```\n\n##### 근거 2\n\n```\n제목: <img src=x onerror=alert(1)> 옛 글\n원문 작성일: 2020-11\n원 작성자: <script>작성자</script>\n작성자 관계: 내 기록\n원문 URL: https://example.invalid/old?raw=%2B#part\n선택 버전: 1/2\n본문 확보 범위: full_text\n누락: 확인한 누락 없음\n```\n\n\n#### 반례로 연결한 원문\n\n원문 작성일은 경험 시기를 뜻하지 않습니다.\n\n##### 근거 1\n\n```\n제목: 타인 반례\n원문 작성일: 어느 가을\n원 작성자: 다른 작성자\n작성자 관계: 다른 사람의 기록\n원문 URL: 미제공\n선택 버전: 1/1\n본문 확보 범위: partial\n누락: 사진 미보관\n```\n\n##### 근거 2\n\n```\n연결된 원문 없음\n다른 버전으로 대체하지 않았습니다.\n```\n\n\n### 현재 해석 2\n\n사용자가 직접 쓴 해석입니다. 연결한 글을 내 신념이나 해석의 증명으로 자동 판단하지 않습니다.\n\n아직 작성하지 않은 해석\n\n```\n해석: \n```\n\n```\n불확실성: \n```\n\n#### 근거로 연결한 원문\n\n원문 작성일은 경험 시기를 뜻하지 않습니다.\n\n선택한 근거 원문이 없습니다.\n\n\n#### 반례로 연결한 원문\n\n원문 작성일은 경험 시기를 뜻하지 않습니다.\n\n선택한 근거 원문이 없습니다.\n\n\n## 장 2\n\n```\n장 제목: 두 번째 장\n```\n\n### 현재 원고\n\n둘째 장 원고\n\n### 선택한 근거 원문\n\n원문 작성일은 경험 시기를 뜻하지 않습니다.\n\n#### 근거 1\n\n```\n제목: <img src=x onerror=alert(1)> 옛 글\n원문 작성일: 2020-11\n원 작성자: <script>작성자</script>\n작성자 관계: 내 기록\n원문 URL: https://example.invalid/old?raw=%2B#part\n선택 버전: 1/2\n본문 확보 범위: full_text\n누락: 확인한 누락 없음\n```\n\n";
const LEGACY_BODIES = "# 비공개 책 원고\n\n````\n책 제목: 책\n```\n# 제목 모양\n````\n\n```\n설정한 기간: 2022 ~ 2024\n질문: 질문 <script>평문</script>\n```\n\n설정한 기간은 책의 설명이며 선택한 근거를 자동으로 제한하지 않습니다. 원문 작성일은 경험 시기를 뜻하지 않습니다.\n\n## 장 1\n\n```\n장 제목: 첫 장 [제목](javascript:alert(1))\n```\n\n### 현재 원고\n\n# 사용자 원고\r\n현재 생각🌱\n\n### 선택한 근거 원문\n\n원문 작성일은 경험 시기를 뜻하지 않습니다.\n\n#### 근거 1\n\n```\n제목: <img src=x onerror=alert(1)> 옛 글\n원문 작성일: 2020-11\n원 작성자: <script>작성자</script>\n작성자 관계: 내 기록\n원문 URL: https://example.invalid/old?raw=%2B#part\n선택 버전: 1/2\n본문 확보 범위: full_text\n누락: 확인한 누락 없음\n```\n\n##### 선택한 버전의 보관 본문\n\n`````\n선택한 옛 본문🌱\r\n### 원문 제목\r\n````\n`````\n\n#### 근거 2\n\n```\n연결된 원문 없음\n다른 버전으로 대체하지 않았습니다.\n```\n\n\n### 현재 해석 1\n\n사용자가 직접 쓴 해석입니다. 연결한 글을 내 신념이나 해석의 증명으로 자동 판단하지 않습니다.\n\n```\n해석: 직접 쓴 해석\r\n<script>텍스트</script>\n```\n\n````\n불확실성: 모르는 점\n```\n````\n\n#### 근거로 연결한 원문\n\n원문 작성일은 경험 시기를 뜻하지 않습니다.\n\n##### 근거 1\n\n```\n제목: 링크만 있는 자료\n원문 작성일: 미확인\n원 작성자: 미확인\n작성자 관계: 작성자 관계 미확인\n원문 URL: https://example.invalid/link\n선택 버전: 1/1\n본문 확보 범위: link_only\n누락: 확인한 누락 없음\n```\n\n###### 선택한 버전의 보관 본문\n\n본문 미확보 · 링크만 보관했습니다.\n\n##### 근거 2\n\n```\n제목: <img src=x onerror=alert(1)> 옛 글\n원문 작성일: 2020-11\n원 작성자: <script>작성자</script>\n작성자 관계: 내 기록\n원문 URL: https://example.invalid/old?raw=%2B#part\n선택 버전: 1/2\n본문 확보 범위: full_text\n누락: 확인한 누락 없음\n```\n\n###### 선택한 버전의 보관 본문\n\n`````\n선택한 옛 본문🌱\r\n### 원문 제목\r\n````\n`````\n\n\n#### 반례로 연결한 원문\n\n원문 작성일은 경험 시기를 뜻하지 않습니다.\n\n##### 근거 1\n\n```\n제목: 타인 반례\n원문 작성일: 어느 가을\n원 작성자: 다른 작성자\n작성자 관계: 다른 사람의 기록\n원문 URL: 미제공\n선택 버전: 1/1\n본문 확보 범위: partial\n누락: 사진 미보관\n```\n\n###### 선택한 버전의 보관 본문\n\n```\n다른 관점 본문\n```\n\n##### 근거 2\n\n```\n연결된 원문 없음\n다른 버전으로 대체하지 않았습니다.\n```\n\n\n### 현재 해석 2\n\n사용자가 직접 쓴 해석입니다. 연결한 글을 내 신념이나 해석의 증명으로 자동 판단하지 않습니다.\n\n아직 작성하지 않은 해석\n\n```\n해석: \n```\n\n```\n불확실성: \n```\n\n#### 근거로 연결한 원문\n\n원문 작성일은 경험 시기를 뜻하지 않습니다.\n\n선택한 근거 원문이 없습니다.\n\n\n#### 반례로 연결한 원문\n\n원문 작성일은 경험 시기를 뜻하지 않습니다.\n\n선택한 근거 원문이 없습니다.\n\n\n## 장 2\n\n```\n장 제목: 두 번째 장\n```\n\n### 현재 원고\n\n둘째 장 원고\n\n### 선택한 근거 원문\n\n원문 작성일은 경험 시기를 뜻하지 않습니다.\n\n#### 근거 1\n\n```\n제목: <img src=x onerror=alert(1)> 옛 글\n원문 작성일: 2020-11\n원 작성자: <script>작성자</script>\n작성자 관계: 내 기록\n원문 URL: https://example.invalid/old?raw=%2B#part\n선택 버전: 1/2\n본문 확보 범위: full_text\n누락: 확인한 누락 없음\n```\n\n##### 선택한 버전의 보관 본문\n\n`````\n선택한 옛 본문🌱\r\n### 원문 제목\r\n````\n`````\n\n";

test('Markdown remains byte-compatible with the pre-projection exporter for both explicit body modes', async () => {
  const { bundle, state } = await fixture();
  assert.equal(Books.markdown(bundle, state, 'chosen_book'), LEGACY_PLAIN);
  assert.equal(Books.markdown(bundle, state, 'chosen_book', { includeSources: true }), LEGACY_BODIES);
});

test('projection includes ordered chapters and active independent roles using exact versions and explicit missing evidence', async () => {
  const { bundle, state, old, other, link } = await fixture(), before = copy({ bundle, state });
  const value = Books.project(bundle, state, 'chosen_book');
  assert.deepEqual(Object.keys(value), ['id', 'title', 'fromYear', 'toYear', 'question', 'includeSources', 'chapters']);
  assert.equal(value.id, 'chosen_book'); assert.equal(value.title, state.books[0].title);
  assert.equal(value.fromYear, '2022'); assert.equal(value.toYear, '2024'); assert.equal(value.includeSources, false);
  assert.deepEqual(value.chapters.map(chapter => chapter.id), ['first_chapter', 'second_chapter']);
  const chapter = value.chapters[0], [active, blank] = chapter.insights;
  assert.equal(chapter.note, state.books[0].chapters[0].note);
  assert.deepEqual(chapter.versionIds, [old.version.id, 'missing_version']);
  assert.deepEqual(chapter.evidence[1], { versionId: 'missing_version', missing: true });
  assert.deepEqual(chapter.insights.map(item => item.id), ['active_thought', 'blank_thought']);
  assert.deepEqual(active.supportVersionIds, [link.version.id, old.version.id]);
  assert.deepEqual(active.counterVersionIds, [other.version.id, 'missing_version']);
  assert.deepEqual(active.supportEvidence.map(item => item.versionId), active.supportVersionIds);
  assert.deepEqual(active.counterEvidence.map(item => item.versionId), active.counterVersionIds);
  assert.equal(active.counterEvidence[0].originalAuthor.relation, 'other');
  assert.deepEqual(active.counterEvidence[0].coverage, { status: 'partial', omissions: ['사진 미보관'] });
  assert.equal(active.counterEvidence[0].originalCreatedAt, '어느 가을');
  assert.deepEqual(active.counterEvidence[1], chapter.evidence[1]);
  assert.equal(blank.statement, ''); assert.deepEqual(blank.supportEvidence, []); assert.deepEqual(blank.counterEvidence, []);
  assert.deepEqual(value.chapters[1].insights, []);
  assert.deepEqual({ bundle, state }, before);
});

function allEvidence(value) {
  return value.chapters.flatMap(chapter => chapter.evidence.concat(chapter.insights.flatMap(item => item.supportEvidence.concat(item.counterEvidence))));
}

test('default projection excludes every original body property while preserving literal provenance and body-availability metadata', async () => {
  const { bundle, state, old, other, excluded, newer } = await fixture();
  const value = Books.project(bundle, state, 'chosen_book'), evidence = allEvidence(value), json = JSON.stringify(value);
  assert(evidence.every(item => !Object.hasOwn(item, 'body') && !Object.hasOwn(item, 'contentText')));
  const original = value.chapters[0].evidence[0];
  assert.equal(original.versionId, old.version.id); assert.equal(original.versionNumber, 1); assert.equal(original.versionTotal, 2);
  assert.equal(original.originalCreatedAt, '2020-11'); assert.equal(original.hasBody, true);
  assert.equal(original.title, '<img src=x onerror=alert(1)> 옛 글');
  assert.equal(original.originalAuthor.label, '<script>작성자</script>');
  assert.equal(original.url, old.source.url); assert.equal(original.sourceId, old.source.id);
  for (const body of [old.version.contentText, other.version.contentText, excluded.version.contentText, newer.version.contentText]) assert(!json.includes(JSON.stringify(body).slice(1, -1)));
  assert.equal(value.chapters[0].insights[0].supportEvidence[0].hasBody, false);
});

test('explicit body mode contains only selected exact raw bodies; missing/link-only cases remain distinct', async () => {
  const { bundle, state, old, other, excluded, newer } = await fixture();
  const value = Books.project(bundle, state, 'chosen_book', { includeSources: true });
  assert.equal(value.includeSources, true);
  assert.equal(value.chapters[0].evidence[0].body, old.version.contentText);
  assert.equal(value.chapters[0].insights[0].supportEvidence[1].body, old.version.contentText);
  assert.equal(value.chapters[0].insights[0].counterEvidence[0].body, other.version.contentText);
  assert.equal(value.chapters[0].insights[0].supportEvidence[0].body, null);
  assert.equal(value.chapters[0].insights[0].supportEvidence[0].hasBody, false);
  assert.equal(Object.hasOwn(value.chapters[0].evidence[1], 'body'), false);
  assert(allEvidence(value).every(item => ![excluded.version.id, newer.version.id].includes(item.versionId)));
});

test('excluded-only content, IDs and references and unchosen projects never enter either projected body mode', async () => {
  const { bundle, state, excluded, newer } = await fixture();
  for (const includeSources of [false, true]) {
    const value = Books.project(bundle, state, 'chosen_book', { includeSources }), json = JSON.stringify(value);
    for (const text of ['excluded_thought', 'excluded_gap', '제외 전용 해석', '제외 전용 불확실성', excluded.source.id, excluded.version.id,
      excluded.source.title, excluded.version.originalAuthor.label, 'other_book', 'other_chapter', 'outside_group', '선택 밖 회고', newer.version.id]) assert(!json.includes(text), text);
  }
});

test('projection deeply owns nested arrays and metadata in both directions without mutating the input', async () => {
  const { bundle, state } = await fixture(), original = copy({ bundle, state });
  const value = Books.project(bundle, state, 'chosen_book', { includeSources: true }), retained = copy(value);
  value.chapters[0].versionIds.push('caller_added'); value.chapters[0].insights[0].supportVersionIds.reverse();
  value.chapters[0].evidence[0].originalAuthor.label = 'caller_label';
  value.chapters[0].insights[0].counterEvidence[0].coverage.omissions.push('caller_omission');
  value.chapters[0].note = 'caller_note'; assert.deepEqual({ bundle, state }, original);
  const snapshot = Books.project(bundle, state, 'chosen_book', { includeSources: true });
  bundle.sources[0].title = 'input_title'; bundle.sourceVersions[0].originalAuthor.label = 'input_author';
  bundle.sourceVersions[1].coverage.omissions.push('input_omission'); state.books[0].chapters[0].note = 'input_note';
  state.books[0].chapters[0].insights[0].supportVersionIds = []; state.books[0].chapters[0].insights[0].excluded = true;
  assert.deepEqual(snapshot, retained);
  assert.notEqual(snapshot.chapters[0].evidence[0].originalAuthor, snapshot.chapters[0].insights[0].supportEvidence[1].originalAuthor);
});

test('preview and Markdown expose the same active selections after explicit reorder/role edits without period filtering', async () => {
  const { bundle, state, old, other } = await fixture();
  state.books[0].chapters.reverse();
  const chapter = state.books[0].chapters[1]; chapter.versionIds = [];
  chapter.insights[0].supportVersionIds = [other.version.id]; chapter.insights[0].counterVersionIds = [old.version.id];
  chapter.insights[1].excluded = true;
  const before = copy({ bundle, state }), preview = Books.project(bundle, state, 'chosen_book', { includeSources: true });
  const markdown = Books.markdown(bundle, state, 'chosen_book', { includeSources: true });
  assert.deepEqual(preview.chapters.map(item => item.id), ['second_chapter', 'first_chapter']);
  assert.equal(preview.chapters[1].evidence.length, 0); assert.equal(preview.chapters[1].insights.length, 1);
  assert.equal(preview.chapters[1].insights[0].supportEvidence[0].versionId, other.version.id);
  assert.equal(preview.chapters[1].insights[0].counterEvidence[0].versionId, old.version.id);
  assert(markdown.indexOf('장 제목: 두 번째 장') < markdown.indexOf('장 제목: 첫 장'));
  for (const item of allEvidence(preview)) if (!item.missing) {
    assert(markdown.includes('제목: ' + item.title)); assert(markdown.includes('선택 버전: ' + item.versionNumber + '/' + item.versionTotal));
    if (item.body !== null) assert(markdown.includes(item.body));
  }
  assert(!markdown.includes('아직 작성하지 않은 해석')); assert.deepEqual({ bundle, state }, before);
});

test('projection fails closed for malformed options, a different workspace or invalid composition instead of sanitizing selections', async () => {
  const { bundle, state } = await fixture();
  assert.throws(() => Books.project(bundle, state, 'missing_book'), { code: 'book_missing' });
  assert.throws(() => Books.project(bundle, { ...state, workspaceId: 'different_workspace' }, 'chosen_book'), { code: 'workspace_mismatch' });
  assert.throws(() => Books.project(bundle, state, 'chosen_book', { includeSources: 'true' }), { code: 'invalid_book' });
  const bad = copy(state); bad.books[0].chapters[0].insights[0].counterVersionIds.push('missing_version');
  assert.throws(() => Books.project(bundle, bad, 'chosen_book'), { code: 'duplicate_id' });
  state.books = [{ id: 'empty_book', title: '빈 책', fromYear: '', toYear: '', question: '', chapters: [] }];
  assert.deepEqual(Books.project(bundle, state, 'empty_book').chapters, []);
});

test('browser projection is identical without loading a Markdown renderer or Reflection module', async () => {
  const { bundle, state } = await fixture();
  const context = vm.createContext({ TextEncoder, structuredClone, URL, crypto: crypto.webcrypto });
  for (const name of ['core', 'workbench', 'books']) vm.runInContext(fs.readFileSync(require.resolve('../assets/life/' + name + '.js'), 'utf8'), context);
  context.inputJSON = JSON.stringify({ bundle, state }); vm.runInContext('var {bundle,state}=JSON.parse(inputJSON)', context);
  const value = JSON.parse(vm.runInContext("JSON.stringify(HaedoLife.Books.project(bundle,state,'chosen_book',{includeSources:true}))", context));
  assert.deepEqual(value, Books.project(bundle, state, 'chosen_book', { includeSources: true }));
  assert.equal(context.HaedoLife.Reflection, undefined); assert.equal(Object.isFrozen(context.HaedoLife.Books), true);
  assert.equal(vm.runInContext("HaedoLife.Books.markdown(bundle,state,'chosen_book')", context), LEGACY_PLAIN);
});
