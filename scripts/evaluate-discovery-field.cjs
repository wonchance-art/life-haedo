#!/usr/bin/env node
/* Local reading preparation only. No Storage/Auth, network, automatic link
 * opening, opinion inference or writes to supplied inputs/product state. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const Evaluation = require('./evaluate-discovery.cjs');
const Discovery = require('../assets/life/discovery.js');
const Recommendations = require('../assets/life/discovery-recommendations.js');
const Actions = require('../assets/life/discovery-actions.js');
const LanguageSettings = require('../assets/life/discovery-language-settings.js');
const Settings = require('../assets/life/discovery-settings.js');
const Profile = require('../assets/life/discovery-profile.js');
const ROOT = path.resolve(__dirname, '..');
const PRIVATE_ROOT = path.join(ROOT, '.local/discovery-field');
const WORKSPACE = 'local-field-evaluation';
const MODES = Object.freeze(['latest', 'related', 'personal', 'signals_removed']);
const LABELS = Object.freeze({ A: 'latest', B: 'related', C: 'personal' });
const MAX_CONDITIONS_BYTES = 256 * 1024;
const SOURCE_FILES = Object.freeze(['scripts/evaluate-discovery.cjs', 'scripts/evaluate-discovery-field.cjs',
  'assets/life/discovery.js', 'assets/life/discovery-actions.js', 'assets/life/discovery-recommendations.js', 'assets/life/discovery-language-settings.js',
  'assets/life/discovery-settings.js', 'assets/life/discovery-profile.js']);
const MESSAGES = Object.freeze({
  field_usage: '사용법: node scripts/evaluate-discovery-field.cjs --now ISO --out .local/discovery-field/NEW_RUN [--feed FILE] [--content-languages all|none|ko,en] [--conditions-file FILE] [--topic-file FILE] [--actions FILE --actions-kind simulation|user_supplied]',
  field_input: '입력 파일의 크기·UTF-8·형식·공개 출처를 확인하지 못했습니다. 입력은 변경하지 않았습니다.',
  field_output: '출력은 .local/discovery-field 안의 새 하위 폴더만 사용할 수 있습니다. 심볼릭 링크와 기존 경로는 허용하지 않습니다.',
  field_existing: '출력 경로가 이미 있습니다. 기존 검토를 보존하려면 새 하위 폴더를 선택해 주세요.',
  field_evidence: '비교 조건 또는 실제 문자열 근거를 확인하지 못했습니다.',
  field_failed: '로컬 비교 준비를 완료하지 못했습니다. 기존 입력과 검토는 덮어쓰지 않았습니다.'
});
const clone = value => structuredClone(value);
function fail(code) { return Object.assign(new Error(MESSAGES[code]), { code }); }
function check(condition, code = 'field_input') { if (!condition) throw fail(code); }
function publicError(error) { return MESSAGES[error?.code] || MESSAGES.field_failed; }
function json(bytes, maximum) {
  check(Buffer.isBuffer(bytes) && bytes.length <= maximum);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\ufeff/, '')); }
  catch (_) { throw fail('field_input'); }
}
function topicInput(bytes) {
  if (bytes == null) return { value: null, input: 'not_provided', sha256: null };
  const value = json(bytes, 4096);
  check(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 2 && value.schemaVersion === 1 && Object.hasOwn(value, 'topic'));
  check(value.topic === null || typeof value.topic === 'string' && value.topic.trim() && value.topic.length <= 200);
  return { value: value.topic, input: 'explicit_file', sha256: Evaluation.sha256(bytes) };
}
function reactionInput(bytes, kind) {
  check(bytes == null ? kind === undefined : ['simulation', 'user_supplied'].includes(kind));
  if (bytes == null) return { actions: Actions.empty(WORKSPACE), provenance: 'none', sha256: null };
  let preview;
  try { preview = Actions.previewCopy(json(bytes, Actions.MAX_BYTES)); } catch (_) { throw fail('field_input'); }
  // This isolated counterfactual is not a product import/merge or opt-in. Keep
  // recorded exclusions/times; never call mergeCopy or a persistence API.
  const actions = { ...Actions.empty(WORKSPACE), revision: 1, updatedAt: preview.exportedAt,
    personalizationEnabled: true, entries: clone(preview.entries) };
  Actions.validate(actions);
  return { actions, provenance: kind, sha256: Evaluation.sha256(bytes) };
}
function conditionInput(bytes, now) {
  if (bytes == null) return null;
  const value = json(bytes, MAX_CONDITIONS_BYTES);
  const exact = (row, keys) => check(row && Object.getPrototypeOf(row) === Object.prototype &&
    Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)));
  exact(value, ['schemaVersion', 'disabledSourceIds', 'knownUrls', 'feedback']);
  check(value.schemaVersion === 1 && Array.isArray(value.disabledSourceIds) && value.disabledSourceIds.every(id =>
    typeof id === 'string' && Object.hasOwn(Discovery.ALLOWED_SOURCES, id)));
  const settings = Settings.update(Settings.empty(WORKSPACE), { disabledSourceIds: value.disabledSourceIds },
    { expectedRevision: 0, now: new Date(now).toISOString() });
  const hosts = new Set(Object.values(Discovery.ALLOWED_SOURCES).flat());
  const safeURL = url => {
    const canonical = Discovery.canonicalUrl(url);
    check(typeof url === 'string' && canonical === url && hosts.has(new URL(canonical).hostname));
  };
  check(Array.isArray(value.knownUrls) && value.knownUrls.length <= Discovery.LIMITS.articles);
  for (const url of value.knownUrls) safeURL(url);
  check(new Set(value.knownUrls).size === value.knownUrls.length);
  check(Array.isArray(value.feedback) && value.feedback.length <= Profile.MAX_FEEDBACK);
  for (const row of value.feedback) {
    exact(row, ['articleId', 'canonicalUrl', 'kind', 'updatedAt']); safeURL(row.canonicalUrl);
    check(typeof row.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(row.updatedAt) &&
      Number.isFinite(Date.parse(row.updatedAt)) && new Date(row.updatedAt).toISOString().replace('.000Z', 'Z') === row.updatedAt.replace('.000Z', 'Z') &&
      Date.parse(row.updatedAt) <= Date.parse(now));
  }
  const feedback = { ...Profile.empty(WORKSPACE), revision: 1, updatedAt: new Date(now).toISOString(), feedback: clone(value.feedback) };
  Profile.validate(feedback);
  return { settings, feedback, knownUrls: clone(value.knownUrls), sha256: Evaluation.sha256(bytes) };
}
function exactSpan(raw, start, end, quote) {
  check(typeof raw === 'string' && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start &&
    end <= raw.length && raw.slice(start, end) === quote, 'field_evidence');
}
function snapshot(item, position, actions, now, sourceIds, contentLanguages) {
  const result = { ...Evaluation.itemSnapshot(item, position), tags: [...item.article.tags] };
  if (!item.personal) return result;
  for (const evidence of item.personal.evidence) {
    const original = actions.entries.find(row => row.canonicalUrl === evidence.canonicalUrl);
    check(original?.liked && !original.excludedFromRecommendations && Date.parse(original.likedAt) <= now &&
      Date.parse(original.snapshot.fetchedAt) <= now && sourceIds.has(original.snapshot.sourceId) && evidence.title === original.snapshot.title &&
      Discovery.languageAllowed(original.snapshot.language, contentLanguages) && Discovery.languageAllowed(item.article.language, contentLanguages) &&
      ['title', 'tags'].includes(evidence.field) && ['title', 'tags'].includes(evidence.candidateField), 'field_evidence');
    const raw = evidence.field === 'tags' ? original.snapshot.tags[evidence.tagIndex] : original.snapshot.title;
    const candidate = evidence.candidateField === 'tags' ? item.article.tags[evidence.candidateTagIndex] : item.article.title;
    exactSpan(raw, evidence.start, evidence.end, evidence.quote);
    exactSpan(candidate, evidence.candidateStart, evidence.candidateEnd, evidence.candidateQuote);
  }
  return { ...result, personal: clone(item.personal) };
}
function countSources(items) {
  const counts = {};
  for (const item of items) counts[item.sourceId] = (counts[item.sourceId] || 0) + 1;
  return counts;
}
function prepare(feedBytes, options = {}) {
  try {
    // An explicit fixed cutoff is mandatory even for the no-selection form.
    check(typeof options.now === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(options.now) &&
      Number.isFinite(Date.parse(options.now)) && new Date(options.now).toISOString().slice(0, 19) === options.now.slice(0, 19));
    const { bytes, input, feed, evaluatedAt } = Evaluation.prepareFeed(feedBytes, { now: options.now });
    // Reuse the UI's strict settings model in isolated memory, never its stored
    // preferences. Missing/null is all; an explicit empty array stays empty.
    const contentLanguages = LanguageSettings.update(LanguageSettings.empty(WORKSPACE), {
      contentLanguages: options.contentLanguages === undefined ? null : options.contentLanguages
    }, { expectedRevision: 0, now: new Date(evaluatedAt).toISOString() }).contentLanguages;
    const topic = topicInput(options.topicBytes), reaction = reactionInput(options.actionsBytes, options.actionsKind);
    const suppliedConditions = conditionInput(options.conditionsBytes, evaluatedAt);
    const rankingInput = suppliedConditions ? Settings.filterFeed(input, suppliedConditions.settings) : input;
    const actions = reaction.actions, now = Date.parse(evaluatedAt), original = JSON.stringify({ input, actions });
    const sourceIds = new Set(rankingInput.sources.map(source => source.id));
    // Freeze the ORIGINAL past-like exclusion across every arm, including the
    // ablation, so cancelling the signals does not change candidate eligibility.
    const knownUrls = [...new Set([...(suppliedConditions?.knownUrls || []), ...actions.entries.filter(row => row.liked && Date.parse(row.likedAt) <= now &&
      Date.parse(row.snapshot.fetchedAt) <= now).map(row => row.canonicalUrl)])].sort();
    const profile = { workspaceId: WORKSPACE, manual: topic.value === null ? [] : [{ id: 'explicit-evaluation-topic', label: topic.value }] };
    const common = { profile, feedback: suppliedConditions?.feedback || [], knownUrls, now: evaluatedAt, limit: 2, contentLanguages };
    const removed = { ...clone(actions), entries: actions.entries.map(row => ({ ...clone(row), liked: false, likedAt: null })) };
    Actions.validate(removed);
    const raw = {
      latest: Discovery.rank(rankingInput, { ...common, mode: 'latest' }),
      related: Discovery.rank(rankingInput, { ...common, mode: 'related' }),
      personal: Recommendations.rank(rankingInput, { ...common, actions, mode: 'personal', baselineMode: 'related' }),
      signals_removed: Recommendations.rank(rankingInput, { ...common, actions: removed, mode: 'personal', baselineMode: 'related' })
    };
    check(JSON.stringify(raw.signals_removed) === JSON.stringify(raw.related), 'field_evidence');
    check(MODES.every(mode => raw[mode].poolCount === raw.related.poolCount &&
      JSON.stringify(raw[mode].metadata.excluded) === JSON.stringify(raw.related.metadata.excluded)), 'field_evidence');
    const modes = {};
    for (const mode of MODES) {
      const value = raw[mode], items = value.items.map((item, index) => snapshot(item, index + 1, actions, now, sourceIds, contentLanguages));
      check(new Set(items.map(item => item.canonicalUrl)).size === items.length && items.every(item =>
        !knownUrls.includes(item.canonicalUrl) && Discovery.languageAllowed(item.language, contentLanguages)), 'field_evidence');
      modes[mode] = { items, eligibleCount: value.eligibleCount, poolCount: value.poolCount, metadata: clone(value.metadata),
        rankOutputSHA256: Evaluation.sha256(JSON.stringify(value)), sourceCounts: countSources(items), distinctSources: new Set(items.map(item => item.sourceId)).size };
    }
    const excludedFeedback = new Set(suppliedConditions?.feedback.feedback.map(row => row.canonicalUrl) || []);
    check(MODES.every(mode => modes[mode].items.every(row => sourceIds.has(row.sourceId) && !excludedFeedback.has(row.canonicalUrl))), 'field_evidence');
    const inspection = Recommendations.inspectSignals(actions, { now: evaluatedAt, sourceIds: [...sourceIds], contentLanguages });
    const applied = raw.personal.metadata.personalization?.applied === true;
    const personalStatus = applied ? 'applied' : !inspection.enabled ? 'disabled' : !inspection.signalCount ? 'insufficient_signal' : 'no_overlap';
    const union = new Map(), lists = [];
    for (const [label, mode] of Object.entries(LABELS)) {
      for (const item of modes[mode].items) if (!union.has(item.canonicalUrl)) union.set(item.canonicalUrl, { ...item, reviewId: 'article-' + (union.size + 1) });
      lists.push({ label, reviewIds: modes[mode].items.map(item => union.get(item.canonicalUrl).reviewId) });
    }
    check(JSON.stringify({ input, actions }) === original, 'field_evidence');
    const reviewTemplate = { schemaVersion: 1, status: 'not_reviewed', feedSHA256: Evaluation.sha256(bytes), evaluatedAt,
      comparisonTopic: topic.value, topicInput: topic.input, contentLanguages: clone(contentLanguages), actualUserSelection: null, reactionProvenance: reaction.provenance,
      actualUserReactionsConfirmed: null, personalCondition: '비교용 메모리에서만 적용하며 앱 설정은 바꾸지 않음',
      userUtilityConclusion: null, preferredList: null, preferenceReason: null, lists,
      instructions: ['제목만 보고 읽기 의향을 먼저 적고, 실제로 읽은 글만 읽은 범위와 도움을 판정한다.',
        '아직 안 읽음·접근 실패·답 없음은 미평가이며 무관함이나 싫어요가 아니다. 이미 앎은 별도 값이다.',
        'A/B/C는 고정 표시 순서다. 서로 다른 글의 구성과 순서가 함께 바뀌므로 순서만의 인과 실험이 아니다.'],
      reviews: [...union.values()].map(item => ({ reviewId: item.reviewId, articleId: item.articleId, canonicalUrl: item.canonicalUrl,
        title: item.title, sourceId: item.sourceId, sourceName: feed.sources.find(source => source.id === item.sourceId).name,
        publishedAt: item.publishedAt, updatedAt: item.updatedAt, dateBasis: item.dateBasis, coverage: item.coverage,
        titleIntent: null, alreadyKnown: null, accessStatus: null, readingStatus: null, usefulAfterReading: null,
        irrelevantAfterReading: null, notes: null })) };
    // Only these local artifacts may contain the topic/action hashes or derived
    // reactions. CLI stdout deliberately omits them, paths, titles and URLs.
    const report = { schemaVersion: 1, evaluatedAt, scope: '로컬 직접 읽기 비교 준비. 실제 사용자 선택·실독·효용을 평가하지 않음.',
      feed: { sha256: Evaluation.sha256(bytes), bytes: bytes.length, generatedAt: feed.generatedAt, stale: feed.stale,
        articleCount: feed.articles.length, sourceCount: feed.sources.length, sources: clone(feed.sources),
        futurePublicationCount: feed.articles.filter(item => item.dateStatus === 'future').length },
      topic, reactions: { provenance: reaction.provenance, sha256: reaction.sha256, actualUserReactionsConfirmed: null, explicitEvaluationEnabled: options.actionsBytes != null,
        productOptInChanged: false, inspection },
      conditions: { now: evaluatedAt, limit: 2, knownUrls, feedback: clone(suppliedConditions?.feedback.feedback || []), contentLanguages: clone(contentLanguages), baselineMode: 'related', modeLabels: clone(LABELS),
        pastLikeExclusionsFrozenAcrossArms: true, ablation: 'liked=false/likedAt=null; bookmarks/exclusions/candidate exclusions unchanged',
        sourceSettings: 'supplied feed sources only', implicitPrivateReads: 0, explicitReactionInputProvided: options.actionsBytes != null,
        networkRequests: 0, automaticLinkOpens: 0, actualUserSelection: null, userUtilityEvaluated: false,
        personalDatePolicy: 'The existing personal ranker excludes future publication rows when applied; exact fallback retains baseline policy.' },
      personal: { status: personalStatus, applied, exactRelatedFallback: !applied && JSON.stringify(raw.personal) === JSON.stringify(raw.related) },
      modes, signalsRemovedExactRelated: true, reviewUniqueArticleCount: union.size,
      overlapCounts: { latestRelated: modes.latest.items.filter(item => modes.related.items.some(other => other.canonicalUrl === item.canonicalUrl)).length,
        relatedPersonal: modes.related.items.filter(item => modes.personal.items.some(other => other.canonicalUrl === item.canonicalUrl)).length,
        latestPersonal: modes.latest.items.filter(item => modes.personal.items.some(other => other.canonicalUrl === item.canonicalUrl)).length },
      userUtilityConclusion: null,
      limitations: ['합성 반응은 시뮬레이션이다. 파일 제공·목록 준비·어휘 겹침은 실제 사용자 취향·읽음·만족의 증거가 아니다.',
        '개인추천은 명시적 과거 좋아요의 공개 제목·태그만 쓴다. 담기·읽음·클릭을 긍정 취향으로 사용하지 않는다.',
        '원문 언어는 앱과 같은 제공 표기 필터다. 후보와 좋아요 근거에 같은 선택을 적용하며 실제 본문 언어를 탐지하거나 번역하지 않는다.',
        '개인추천의 적용·일치·출처 수·목록 차이는 기술통계이며 의미 정확도·실독 후 효용·개선율이 아니다.',
        '같은 단어도 뜻이 다를 수 있다. 단어가 두 개 겹치는 동음이의어도 구별하지 못한다.',
        '원문 링크는 자동으로 열지 않았다. 수집 상태·날짜 불명·본문 미확보·후보 부족은 그대로 남긴다.',
        '반응 사본을 평가용 메모리에만 재구성했다. 앱 import/동기화/공개/개인추천 opt-in은 바꾸지 않는다.',
        '같은 feed/시각/known 조건이어도 모드의 본래 후보 선택 규칙은 다르다. 고정 A/B/C 노출은 무작위 맹검이나 인과 실험이 아니다.'] };
    if (suppliedConditions) {
      const explicit = { input: 'explicit_file', sha256: suppliedConditions.sha256,
        disabledSourceIds: clone(suppliedConditions.settings.disabledSourceIds), activeSourceIds: [...sourceIds],
        suppliedKnownUrls: clone(suppliedConditions.knownUrls), feedback: clone(suppliedConditions.feedback.feedback),
        actualUserConditionsConfirmed: null };
      report.conditions.sourceSettings = 'explicit disabledSourceIds projected with DiscoverySettings.filterFeed';
      report.conditions.explicit = clone(explicit); reviewTemplate.explicitConditions = clone(explicit);
    }
    return { report, reviewTemplate, markdown: renderMarkdown(report, reviewTemplate) };
  } catch (error) { throw fail(error.code === 'field_evidence' ? 'field_evidence' : 'field_input'); }
}
function renderMarkdown(report, review) {
  const escape = Evaluation.markdownText;
  const languages = review.contentLanguages === null ? '전체 언어' : review.contentLanguages.length === 0 ? '선택 없음 — 후보 없음' :
    review.contentLanguages.map(code => LanguageSettings.CONTENT_LANGUAGE_LABELS[code]).join(', ');
  const lines = ['# 직접 읽기 비교 준비 — 로컬 전용', '', '사용자 선택·실제 반응·원문 독서·효용은 아직 판정하지 않았다. 이 파일을 공개 문서나 Pages 산출물에 포함하지 않는다.', '',
    '- 비교 입력 주제: ' + (review.comparisonTopic === null ? '미선택' : escape(review.comparisonTopic)),
    '- 주제 입력은 비교 조건이며 실제 사용자 선택 확인은 null이다.', '- 반응 출처: ' + escape(review.reactionProvenance) + ' · 앱 설정 변경 없음',
    '- 원문 언어 조건: ' + escape(languages) + ' · 네 비교 조건과 좋아요 근거에 동일 적용',
    '- 고정 시각: ' + escape(report.evaluatedAt), '- 공개 목록 SHA-256: `' + report.feed.sha256 + '`',
    '- 상세 모드·신호 제거·정확 근거는 별도 `evaluation.json`에 기록했다.', ''];
  if (review.explicitConditions) lines.push('- 명시 조건 파일 적용 · 비활성 출처 ' + review.explicitConditions.disabledSourceIds.length +
    '개 · 제공 보관 URL ' + review.explicitConditions.suppliedKnownUrls.length + '개 · 읽음/관련 없음 ' + review.explicitConditions.feedback.length +
    '개. 실제 화면 조건 일치 확인은 null이며 자동으로 읽지 않았다.', '');
  for (const list of review.lists) {
    lines.push('## 목록 ' + list.label, '');
    if (!list.reviewIds.length) lines.push('후보 없음. 관련 없는 글로 채우지 않았다.', '');
    for (const [index, id] of list.reviewIds.entries()) {
      const item = review.reviews.find(row => row.reviewId === id);
      lines.push((index + 1) + '. ' + escape(id) + ' · [' + escape(item.title) + '](<' + item.canonicalUrl + '>)', '',
        '   ' + escape(item.sourceName) + ' · 발행 ' + escape(item.publishedAt) + ' · 수정 ' + escape(item.updatedAt) + ' · 날짜 기준 ' + escape(item.dateBasis) + ' · ' + escape(item.coverage), '');
    }
  }
  lines.push('## 기록 방법', '', '중복 글은 같은 article 번호로 한 번만 기록한다. `review-template.json`의 답은 전부 null이다.', '',
    ...review.instructions.map(value => '- ' + escape(value)), '',
    '각 글의 titleIntent는 읽기 전 의향, alreadyKnown은 이미 알았는지, accessStatus는 원문 접근, readingStatus는 읽은 범위다. usefulAfterReading과 irrelevantAfterReading은 실제 읽은 뒤에만 답한다. preferredList와 이유는 별도로 남긴다.', '',
    '개인추천 적용 여부·개수로 사용자 효용을 추정하지 않는다. 입력이나 기존 검토를 고치지 말고 이 새 폴더의 양식에 직접 답한다.', '');
  return lines.join('\n');
}
function outputPath(value) {
  check(typeof value === 'string' && value.length > 0, 'field_output');
  const output = path.resolve(value), relative = path.relative(PRIVATE_ROOT, output);
  check(relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative), 'field_output');
  return output;
}
async function safeAncestors(directory) {
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw fail('field_output');
      try { await fs.mkdir(current, { mode: 0o700 }); } catch (cause) { if (cause.code !== 'EEXIST') throw fail('field_output'); }
      stat = await fs.lstat(current);
    }
    check(stat.isDirectory() && !stat.isSymbolicLink(), 'field_output');
  }
}
async function readBounded(file, maximum) {
  let handle;
  try {
    check(typeof file === 'string' && file && !/^[a-z]+:\/\//i.test(file));
    handle = await fs.open(file, 'r'); const stat = await handle.stat(); check(stat.isFile() && stat.size <= maximum);
    const buffer = Buffer.alloc(maximum + 1); let length = 0;
    while (length < buffer.length) { const row = await handle.read(buffer, length, buffer.length - length, null); if (!row.bytesRead) break; length += row.bytesRead; }
    check(length <= maximum); return buffer.subarray(0, length);
  } catch (_) { throw fail('field_input'); }
  finally { await handle?.close(); }
}
async function sourceHashes() {
  return Object.fromEntries(await Promise.all(SOURCE_FILES.map(async file => [file, Evaluation.sha256(await fs.readFile(path.join(ROOT, file)))])));
}
async function writeEvaluation(options) {
  let output;
  try {
    output = outputPath(options.out);
    try { await fs.lstat(output); throw fail('field_existing'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const [feedBytes, topicBytes, actionsBytes, conditionsBytes] = await Promise.all([
      readBounded(options.feed || Evaluation.DEFAULT_FEED, Discovery.LIMITS.feedBytes),
      options.topicFile === undefined ? null : readBounded(options.topicFile, 4096),
      options.actions === undefined ? null : readBounded(options.actions, Actions.MAX_BYTES),
      options.conditionsFile === undefined ? null : readBounded(options.conditionsFile, MAX_CONDITIONS_BYTES)
    ]);
    const prepared = prepare(feedBytes, { now: options.now, topicBytes, actionsBytes, actionsKind: options.actionsKind, contentLanguages: options.contentLanguages, conditionsBytes });
    prepared.report.sourceSHA256 = await sourceHashes();
    await safeAncestors(path.dirname(output));
    try { await fs.mkdir(output, { mode: 0o700 }); } catch (error) { throw fail(error.code === 'EEXIST' ? 'field_existing' : 'field_output'); }
    const files = { 'evaluation.json': JSON.stringify(prepared.report, null, 2) + '\n', 'evaluation.md': prepared.markdown,
      'review-template.json': JSON.stringify(prepared.reviewTemplate, null, 2) + '\n' };
    for (const [name, value] of Object.entries(files)) await fs.writeFile(path.join(output, name), value, { flag: 'wx', mode: 0o600 });
    return { status: 'prepared', feedSHA256: prepared.report.feed.sha256, sourceSHA256: prepared.report.sourceSHA256,
      userUtilityEvaluated: false, files: Object.keys(files) };
  } catch (error) { throw fail(Object.hasOwn(MESSAGES, error.code) ? error.code : 'field_failed'); }
}
function parseArgs(argv) {
  const options = {}, seen = new Set(), keys = { '--feed': 'feed', '--out': 'out', '--now': 'now', '--topic-file': 'topicFile', '--actions': 'actions', '--actions-kind': 'actionsKind', '--content-languages': 'contentLanguages', '--conditions-file': 'conditionsFile' };
  for (let at = 0; at < argv.length; at += 2) {
    const key = argv[at], value = argv[at + 1];
    check(Object.hasOwn(keys, key) && !seen.has(key) && typeof value === 'string' && value && !value.startsWith('--'), 'field_usage');
    seen.add(key); options[keys[key]] = value;
  }
  if (seen.has('--content-languages')) {
    const value = options.contentLanguages;
    options.contentLanguages = value === 'all' ? null : value === 'none' ? [] : value.split(',');
    check(options.contentLanguages === null || options.contentLanguages.length <= LanguageSettings.CONTENT_LANGUAGE_CODES.length &&
      options.contentLanguages.every(code => LanguageSettings.CONTENT_LANGUAGE_CODES.includes(code)) && new Set(options.contentLanguages).size === options.contentLanguages.length, 'field_usage');
  }
  check(seen.has('--now') && seen.has('--out') && seen.has('--actions') === seen.has('--actions-kind') &&
    (options.actionsKind === undefined || ['simulation', 'user_supplied'].includes(options.actionsKind)), 'field_usage');
  return options;
}
module.exports = Object.freeze({ PRIVATE_ROOT, MODES, LABELS, SOURCE_FILES, prepare, renderMarkdown, writeEvaluation, parseArgs, publicError });
if (require.main === module) {
  if (process.argv.length === 3 && process.argv[2] === '--help') console.log(MESSAGES.field_usage);
  else Promise.resolve().then(() => parseArgs(process.argv.slice(2))).then(writeEvaluation)
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(publicError(error)); process.exitCode = 1; });
}
