'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const Discovery = require('../assets/life/discovery.js');
const Actions = require('../assets/life/discovery-actions.js');
const Recommendations = require('../assets/life/discovery-recommendations.js');
const LanguageSettings = require('../assets/life/discovery-language-settings.js');
const Settings = require('../assets/life/discovery-settings.js');
const Profile = require('../assets/life/discovery-profile.js');
const Field = require('../scripts/evaluate-discovery-field.cjs');
const exec = promisify(execFile);
const NOW = '2026-10-19T04:00:00.000Z', PAST = '2026-10-17T00:00:00.000Z', FUTURE = '2026-10-20T00:00:00.000Z';
const rights = { label: '합成 공개 메타데이터만', url: null, mode: 'metadata_only' };
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function source(id = 'naver-d2') {
  const host = Discovery.ALLOWED_SOURCES[id][0];
  return { id, name: '합성 공개 출처 ' + id, url: `https://${host}/`, feedUrl: `https://${host}/feed`, language: 'ko', rights,
    status: 'ok', stale: false, lastSuccessAt: PAST, lastAttemptAt: PAST, error: null };
}
function article(id, title, extra = {}) {
  const sourceId = extra.sourceId || 'naver-d2';
  return { id, title, sourceId, url: `https://${Discovery.ALLOWED_SOURCES[sourceId][0]}/article?id=${id}`, author: null, language: 'ko',
    tags: [], publishedAt: PAST, fetchedAt: PAST, summary: '', coverage: 'link_only', rights, ...extra };
}
function fixture() {
  const liked = article('past-liked', '😀 인공지능 언어 연구', { tags: ['언어'] });
  return { schemaVersion: 1, generatedAt: PAST, sources: [source(), source('woowahan-tech')], articles: [liked,
    article('manual', '인공지능 기술 개요', { publishedAt: '2026-10-18T03:00:00Z' }),
    article('personal-a', '😀 AI 언어 실험', { tags: ['언어'], publishedAt: '2026-10-16T00:00:00Z' }),
    article('personal-b', '인공지능 언어 도구', { sourceId: 'woowahan-tech', publishedAt: '2026-10-15T00:00:00Z' }),
    article('latest-a', '공연 도시 산책', { publishedAt: '2026-10-19T03:00:00Z' }),
    article('latest-b', '전시 일정 기록', { publishedAt: '2026-10-19T02:00:00Z' })] };
}
function copyFor(item, kind = 'liked', now = PAST, excluded = false) {
  let profile = Actions.setReaction(Actions.empty('synthetic-only'), Actions.capture(item, source(item.sourceId)), kind, true, { expectedRevision: 0, now });
  if (excluded) profile = Actions.setExcluded(profile, item.url, true, { expectedRevision: profile.revision, now });
  return Actions.exportCopy(profile, { now });
}
const topicBytes = encode({ schemaVersion: 1, topic: 'AI' });
function prepare(catalog = fixture(), actions = copyFor(catalog.articles[0]), extra = {}) {
  return Field.prepare(encode(catalog), { now: NOW, topicBytes, actionsBytes: encode(actions), actionsKind: 'simulation', ...extra });
}
async function temporary(t) {
  await fs.mkdir(Field.PRIVATE_ROOT, { recursive: true });
  const directory = path.join(Field.PRIVATE_ROOT, 'test-' + randomUUID()); await fs.mkdir(directory);
  t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory;
}
test('three actual modes and ablation use identical bytes/cutoff/exclusions; no self-recommendation or inferred utility', () => {
  const catalog = fixture(), envelope = copyFor(catalog.articles[0]), before = JSON.stringify({ catalog, envelope });
  const { report, reviewTemplate } = prepare(catalog, envelope), workspaceId = 'local-field-evaluation';
  const actions = { ...Actions.empty(workspaceId), revision: 1, updatedAt: envelope.exportedAt, personalizationEnabled: true, entries: envelope.entries };
  const common = { now: NOW, limit: 2, profile: { workspaceId, manual: [{ id: 'explicit-evaluation-topic', label: 'AI' }] }, feedback: [], knownUrls: [Discovery.canonicalUrl(catalog.articles[0].url)] };
  for (const mode of ['latest', 'related', 'personal']) {
    const expected = mode === 'personal' ? Recommendations.rank(catalog, { ...common, actions, mode, baselineMode: 'related' }) : Discovery.rank(catalog, { ...common, mode });
    assert.deepEqual(report.modes[mode].items.map(row => row.canonicalUrl), expected.items.map(row => row.article.canonicalUrl));
    assert.equal(report.modes[mode].poolCount, 5);
    assert.deepEqual(report.modes[mode].metadata.excluded, expected.metadata.excluded);
  }
  assert.equal(report.personal.applied, true); assert.equal(report.reactions.provenance, 'simulation');
  assert.equal(report.signalsRemovedExactRelated, true); assert.deepEqual(report.modes.signals_removed, report.modes.related);
  assert.deepEqual(report.conditions.knownUrls, common.knownUrls); assert(report.reviewUniqueArticleCount <= 6);
  assert.equal(report.userUtilityConclusion, null); assert.equal(report.conditions.networkRequests, 0); assert.equal(report.conditions.implicitPrivateReads, 0);
  assert.equal(reviewTemplate.actualUserSelection, null); assert.equal(reviewTemplate.actualUserReactionsConfirmed, null);
  assert.equal(reviewTemplate.preferredList, null); assert.equal(reviewTemplate.preferenceReason, null);
  assert.equal(new Set(reviewTemplate.reviews.map(row => row.canonicalUrl)).size, reviewTemplate.reviews.length);
  for (const row of reviewTemplate.reviews) for (const name of ['titleIntent', 'alreadyKnown', 'accessStatus', 'readingStatus', 'usefulAfterReading', 'irrelevantAfterReading', 'notes']) assert.equal(row[name], null);
  assert.equal(JSON.stringify({ catalog, envelope }), before);
});
test('topic absent/null and no reactions are valid incomplete forms with exact related fallback', () => {
  for (const options of [{}, { topicBytes: encode({ schemaVersion: 1, topic: null }) }]) {
    const { report, reviewTemplate } = Field.prepare(encode(fixture()), { now: NOW, ...options });
    assert.equal(report.topic.value, null); assert.equal(report.personal.status, 'disabled'); assert.equal(report.personal.exactRelatedFallback, true);
    assert.deepEqual(report.modes.related.items, []); assert.deepEqual(report.modes.personal.items, []); assert.equal(report.modes.latest.items.length, 2);
    assert.equal(reviewTemplate.comparisonTopic, null); assert.equal(reviewTemplate.actualUserSelection, null); assert.equal(reviewTemplate.status, 'not_reviewed');
    assert.deepEqual(report.conditions.knownUrls, []); assert.equal(report.reactions.sha256, null);
  }
});
test('bookmark-only/excluded/future/source-off signals remain nonpositive and the ablation keeps original past-known URLs', () => {
  const catalog = fixture(), liked = catalog.articles[0];
  const examples = [copyFor(liked, 'bookmarked'), copyFor(liked, 'liked', PAST, true), copyFor(liked, 'liked', FUTURE),
    copyFor({ ...liked, sourceId: 'seoul-culture', url: 'https://news.seoul.go.kr/never-in-enabled-feed' }),
    copyFor({ ...liked, fetchedAt: FUTURE })];
  for (const [index, envelope] of examples.entries()) {
    const { report } = prepare(catalog, envelope);
    assert.equal(report.personal.applied, false); assert.equal(report.personal.status, 'insufficient_signal');
    assert.equal(report.personal.exactRelatedFallback, true); assert.equal(report.signalsRemovedExactRelated, true);
    assert.deepEqual(report.modes.signals_removed, report.modes.related);
    assert.equal(report.conditions.knownUrls.length, [0, 1, 0, 1, 0][index]);
  }
  const empty = { format: Actions.FORMAT, schemaVersion: 1, exportedAt: NOW, entries: [] };
  assert.equal(prepare(catalog, empty).report.personal.status, 'insufficient_signal');
});
test('no overlap is disclosed as exact fallback, not a personalized success, and future candidates retain original mode policies', () => {
  const catalog = fixture(), envelope = copyFor(article('other-like', '독서 소설 문학'));
  let result = prepare(catalog, envelope); assert.equal(result.report.personal.status, 'no_overlap'); assert.equal(result.report.personal.exactRelatedFallback, true);
  catalog.articles.push(article('future-candidate', 'AI 언어 실험', { publishedAt: FUTURE }));
  result = prepare(catalog); assert.equal(result.report.feed.futurePublicationCount, 1);
  assert(!result.report.modes.personal.items.some(row => row.articleId === 'future-candidate'));
  assert.match(result.report.conditions.personalDatePolicy, /existing/);
});
test('all manual and personal reasons retain real UTF16 title/tag spans with aliases and emoji', () => {
  const catalog = fixture(), envelope = copyFor(catalog.articles[0]), { report } = prepare(catalog, envelope);
  let aliasSeen = false;
  for (const mode of Field.MODES) for (const item of report.modes[mode].items) {
    const original = catalog.articles.find(row => row.id === item.articleId);
    for (const reason of item.reasons) {
      const field = reason.field === 'tags' ? original.tags[reason.tagIndex] : original[reason.field]; assert.equal(field.slice(reason.start, reason.end), reason.quote);
    }
    for (const reason of item.personal?.evidence || []) {
      const liked = envelope.entries.find(row => row.canonicalUrl === reason.canonicalUrl).snapshot;
      const field = reason.field === 'tags' ? liked.tags[reason.tagIndex] : liked.title;
      const target = reason.candidateField === 'tags' ? original.tags[reason.candidateTagIndex] : original.title;
      assert.equal(field.slice(reason.start, reason.end), reason.quote); assert.equal(target.slice(reason.candidateStart, reason.candidateEnd), reason.candidateQuote);
      if (reason.quote === '인공지능' && reason.candidateQuote === 'AI') aliasSeen = true;
    }
  }
  assert(aliasSeen);
});
test('strict UTF8/schema/size/source validation refuses invalid inputs without including snippets', () => {
  const bytes = encode(fixture()), marker = 'SYNTHETIC_PRIVATE_MARKER';
  for (const options of [
    { topicBytes: Buffer.from('{"topic":"' + marker + '"') }, { topicBytes: Buffer.from([0xc3, 0x28]) },
    { topicBytes: Buffer.alloc(4097, 32) }, { topicBytes: encode({ schemaVersion: 1, topic: 'AI', extra: marker }) },
    { actionsBytes: encode(copyFor(fixture().articles[0])) }, { actionsKind: 'simulation' },
    { actionsBytes: encode({ ...copyFor(fixture().articles[0]), privateMemo: marker }), actionsKind: 'simulation' },
    { now: undefined }, { now: '2026-02-30T00:00:00Z' }
  ]) assert.throws(() => Field.prepare(bytes, { now: NOW, ...options }), error => error.code === 'field_input' && !error.message.includes(marker));
  const invalid = fixture(); invalid.articles[0].url = 'https://unapproved.example/a';
  assert.throws(() => Field.prepare(encode(invalid), { now: NOW }), { code: 'field_input' });
});
test('neutral reading Markdown escapes publisher HTML/images and does not claim blind/causal or actual reading results', () => {
  const catalog = fixture(); catalog.articles[4].title = '<script>공연</script> ![image](javascript:alert)';
  const { markdown, reviewTemplate } = prepare(catalog);
  assert(!markdown.includes('<script>')); assert(!markdown.includes('![image]')); assert(markdown.includes('&lt;script&gt;'));
  assert(markdown.includes('목록 A')); assert(markdown.includes('목록 B')); assert(markdown.includes('목록 C'));
  assert(markdown.includes('인과 실험이 아니다')); assert(markdown.includes('실제 사용자 선택 확인은 null'));
  assert(reviewTemplate.lists.every(row => !Object.hasOwn(row, 'mode')));
});
test('new private artifacts preserve all inputs and existing human answers; no network or product import occurs', async t => {
  const directory = await temporary(t), catalog = fixture(), files = { feed: path.join(directory, 'feed.json'), topicFile: path.join(directory, 'topic.json'), actions: path.join(directory, 'copy.json') };
  const data = { feed: encode(catalog), topicFile: topicBytes, actions: encode(copyFor(catalog.articles[0])) };
  for (const name of Object.keys(files)) await fs.writeFile(files[name], data[name]);
  const fetchBefore = globalThis.fetch; globalThis.fetch = () => { throw new Error('unexpected network'); };
  t.after(() => { globalThis.fetch = fetchBefore; });
  const output = path.join(directory, 'new-run'), options = { ...files, actionsKind: 'simulation', out: output, now: NOW };
  const result = await Field.writeEvaluation(options); assert.equal(result.status, 'prepared'); assert.equal(result.userUtilityEvaluated, false);
  assert.deepEqual((await fs.readdir(output)).sort(), ['evaluation.json', 'evaluation.md', 'review-template.json']);
  const report = JSON.parse(await fs.readFile(path.join(output, 'evaluation.json'))); assert.equal(Object.keys(report.sourceSHA256).length, Field.SOURCE_FILES.length);
  assert(Field.SOURCE_FILES.includes('assets/life/discovery-language-settings.js'));
  assert(!JSON.stringify(result).includes(report.topic.sha256)); assert(!JSON.stringify(result).includes(report.reactions.sha256));
  assert(!JSON.stringify(result).includes(files.actions)); assert(!JSON.stringify(result).includes(output));
  const reviewPath = path.join(output, 'review-template.json'), review = JSON.parse(await fs.readFile(reviewPath));
  review.reviews[0].titleIntent = 'user-written-synthetic-answer'; const human = encode(review); await fs.writeFile(reviewPath, human);
  await assert.rejects(Field.writeEvaluation(options), { code: 'field_existing' }); assert.deepEqual(await fs.readFile(reviewPath), human);
  for (const name of Object.keys(files)) assert.deepEqual(await fs.readFile(files[name]), data[name]);
  if (process.platform !== 'win32') { assert.equal((await fs.stat(output)).mode & 0o777, 0o700); assert.equal((await fs.stat(reviewPath)).mode & 0o777, 0o600); }
});
test('output outside private root, root itself, existing directories and parent symlinks fail without writing through them', async t => {
  const directory = await temporary(t), file = path.join(directory, 'feed.json'); await fs.writeFile(file, encode(fixture()));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'haedo-field-external-')); t.after(() => fs.rm(external, { recursive: true, force: true }));
  for (const out of [path.join(external, 'out'), Field.PRIVATE_ROOT, path.join(Field.PRIVATE_ROOT, '..', 'outside')]) {
    await assert.rejects(Field.writeEvaluation({ feed: file, out, now: NOW }), { code: 'field_output' });
  }
  const alias = path.join(directory, 'parent-alias'); await fs.symlink(external, alias, 'dir');
  await assert.rejects(Field.writeEvaluation({ feed: file, out: path.join(alias, 'child'), now: NOW }), { code: 'field_output' });
  assert.deepEqual(await fs.readdir(external), []);
  await assert.rejects(Field.writeEvaluation({ feed: file, out: directory, now: NOW }), { code: 'field_existing' });
});
test('CLI requires fixed time/new output and labels simulation; stdout/stderr never echo topic/actions/snippets/paths', async t => {
  const directory = await temporary(t), marker = 'SYNTHETIC_PRIVATE_MARKER', file = path.join(directory, 'feed.json'), topic = path.join(directory, marker + '.json');
  await fs.writeFile(file, encode(fixture())); await fs.writeFile(topic, encode({ schemaVersion: 1, topic: marker }));
  const script = path.resolve(__dirname, '../scripts/evaluate-discovery-field.cjs');
  const run = await exec(process.execPath, [script, '--feed', file, '--topic-file', topic, '--now', NOW, '--out', path.join(directory, marker + '-output')]);
  assert.equal(JSON.parse(run.stdout).userUtilityEvaluated, false); assert(!run.stdout.includes(marker)); assert(!run.stdout.includes(directory)); assert.equal(run.stderr, '');
  await fs.writeFile(topic, '{"topic":"' + marker + '"');
  for (const args of [['--feed', file, '--topic-file', topic, '--now', NOW, '--out', path.join(directory, 'invalid')],
    ['--feed', path.join(directory, marker + '-missing'), '--now', NOW, '--out', path.join(directory, 'missing')]]) {
    await assert.rejects(exec(process.execPath, [script, ...args]), error => error.code === 1 && !error.stdout.includes(marker) && !error.stderr.includes(marker) && !error.stderr.includes(directory));
  }
  for (const args of [[], ['--out', 'x'], ['--now', NOW], ['--now', NOW, '--out', 'x', '--actions', 'file'],
    ['--now', NOW, '--out', 'x', '--actions-kind', 'simulation'], ['--now', NOW, '--out', 'x', '--feed', 'a', '--feed', 'b'],
    ['--now', NOW, '--out', 'x', '--private-bundle', marker]]) assert.throws(() => Field.parseArgs(args), { code: 'field_usage' });
});
function languageFixture() {
  return { schemaVersion: 1, generatedAt: PAST, sources: [source()], articles: [
    ['ko', 'ko-KR'], ['en', 'en-US'], ['ja', 'ja-JP'], ['zh', 'zh-Hant'],
    ['unknown', 'unknown'], ['mixed', 'mixed'], ['other', 'pt-BR']
  ].map(([id, language]) => article(id, '😀 AI 언어 실험', { language })) };
}
function bilingualCopy() {
  return { format: Actions.FORMAT, schemaVersion: 1, exportedAt: PAST, entries: [
    copyFor(article('past-ko-like', '인공지능 언어 연구', { language: 'ko-KR' })).entries[0],
    copyFor(article('past-en-like', 'AI 언어 연구', { language: 'en-US' })).entries[0]
  ] };
}
test('UI language selections reach all four actual ranking arms, prototype inspection and recorded reading conditions', () => {
  const catalog = languageFixture(), envelope = bilingualCopy(), original = JSON.stringify({ catalog, envelope });
  const cases = [[null, 7], [['ko'], 1], [['en'], 1], [['ko', 'en'], 2], [[], 0], [['und'], 1], [['mul'], 1], [['other'], 1]];
  for (const [contentLanguages, count] of cases) {
    const { report, reviewTemplate, markdown } = prepare(catalog, envelope, { contentLanguages });
    const workspaceId = 'local-field-evaluation', actions = { ...Actions.empty(workspaceId), revision: 1,
      updatedAt: envelope.exportedAt, personalizationEnabled: true, entries: envelope.entries };
    const common = { now: NOW, limit: 2, contentLanguages, knownUrls: report.conditions.knownUrls, feedback: [],
      profile: { workspaceId, manual: [{ id: 'explicit-evaluation-topic', label: 'AI' }] } };
    const removed = { ...structuredClone(actions), entries: actions.entries.map(row => ({ ...structuredClone(row), liked: false, likedAt: null })) };
    for (const mode of Field.MODES) {
      const expected = mode === 'latest' || mode === 'related' ? Discovery.rank(catalog, { ...common, mode }) :
        Recommendations.rank(catalog, { ...common, mode: 'personal', baselineMode: 'related', actions: mode === 'personal' ? actions : removed });
      assert.equal(report.modes[mode].poolCount, count);
      assert.deepEqual(report.modes[mode].items.map(row => row.canonicalUrl), expected.items.map(row => row.article.canonicalUrl));
      assert.deepEqual(report.modes[mode].metadata, expected.metadata);
      assert(report.modes[mode].items.every(row => Discovery.languageAllowed(row.language, contentLanguages)));
      for (const row of report.modes[mode].items) for (const evidence of row.personal?.evidence || []) {
        const prior = envelope.entries.find(entry => entry.canonicalUrl === evidence.canonicalUrl);
        assert(Discovery.languageAllowed(prior.snapshot.language, contentLanguages));
      }
    }
    assert.deepEqual(report.reactions.inspection, Recommendations.inspectSignals(actions, { now: NOW, sourceIds: ['naver-d2'], contentLanguages }));
    assert.deepEqual(report.conditions.contentLanguages, contentLanguages); assert.deepEqual(reviewTemplate.contentLanguages, contentLanguages);
    assert.deepEqual(report.modes.signals_removed, report.modes.related);
    assert.equal(report.signalsRemovedExactRelated, true); assert.match(markdown, /원문 언어 조건/);
    assert.equal(reviewTemplate.actualUserSelection, null); assert.equal(reviewTemplate.actualUserReactionsConfirmed, null);
    assert.equal(report.userUtilityConclusion, null); assert.equal(report.conditions.networkRequests, 0);
    for (const row of reviewTemplate.reviews) assert.equal(row.usefulAfterReading, null);
  }
  assert.equal(JSON.stringify({ catalog, envelope }), original);
});
test('unspecified/null all is exact, none remains an empty shared pool and out-of-language likes cannot masquerade as no-overlap', () => {
  const catalog = languageFixture(), envelope = bilingualCopy();
  assert.deepEqual(prepare(catalog, envelope), prepare(catalog, envelope, { contentLanguages: null }));
  const selection = ['ko'], { report } = prepare(catalog, copyFor(article('english-like', 'AI 언어 연구', { language: 'en-US' })), { contentLanguages: selection });
  assert.equal(report.personal.status, 'insufficient_signal'); assert.equal(report.personal.exactRelatedFallback, true);
  assert.equal(report.reactions.inspection.signalCount, 0); assert.equal(report.reactions.inspection.excluded.languageOff, 1);
  assert.deepEqual(report.modes.personal, report.modes.related);
  selection.push('en'); assert.deepEqual(report.conditions.contentLanguages, ['ko'], 'report cannot share a caller-mutated selection');
  const none = prepare(catalog, envelope, { contentLanguages: [] });
  for (const mode of Field.MODES) { assert.deepEqual(none.report.modes[mode].items, []); assert.equal(none.report.modes[mode].poolCount, 0); }
  assert.equal(none.report.reactions.inspection.signalCount, 0); assert.equal(none.report.reactions.inspection.excluded.languageOff, 2);
  assert.deepEqual(none.reviewTemplate.reviews, []); assert.match(none.markdown, /선택 없음/);
  assert.equal(none.reviewTemplate.preferredList, null); assert.equal(none.report.userUtilityConclusion, null);
});
test('restricted comparison preserves source failure/stale and original language metadata without publisher fallback', () => {
  const catalog = languageFixture(); Object.assign(catalog.sources[0], { language: 'en', status: 'error', stale: true, error: '합성 수집 실패' });
  const original = structuredClone(catalog), { report } = prepare(catalog, bilingualCopy(), { contentLanguages: ['en'] });
  assert.equal(report.feed.stale, true); assert.equal(report.feed.articleCount, 7);
  for (const mode of Field.MODES) {
    assert.deepEqual(report.modes[mode].items.map(row => row.articleId), ['en']);
    assert.equal(report.modes[mode].items[0].language, 'en-US');
    assert.equal(report.modes[mode].metadata.sources[0].status, 'error'); assert.equal(report.modes[mode].metadata.sources[0].stale, true);
    assert.equal(report.modes[mode].metadata.excluded.language, 6);
  }
  assert.deepEqual(catalog, original);
  for (const selection of ['en', {}, ['en', 'en'], ['en-US'], ['xx'], Array(1), ['ko', null]]) {
    assert.throws(() => prepare(catalog, bilingualCopy(), { contentLanguages: selection }), { code: 'field_input' });
  }
  assert.deepEqual(LanguageSettings.CONTENT_LANGUAGE_CODES, Discovery.CONTENT_LANGUAGE_CODES);
});
test('CLI parses strict explicit language codes and writes the same condition without leaking inputs or changing prior answers', async t => {
  const directory = await temporary(t), file = path.join(directory, 'feed.json'), original = encode(languageFixture()); await fs.writeFile(file, original);
  const script = path.resolve(__dirname, '../scripts/evaluate-discovery-field.cjs');
  for (const [at, [argument, selection]] of [['all', null], ['none', []], ['ko', ['ko']], ['en', ['en']], ['ko,en', ['ko', 'en']]].entries()) {
    const output = path.join(directory, 'language-run-' + at), run = await exec(process.execPath,
      [script, '--feed', file, '--now', NOW, '--content-languages', argument, '--out', output]);
    const report = JSON.parse(await fs.readFile(path.join(output, 'evaluation.json'))), review = JSON.parse(await fs.readFile(path.join(output, 'review-template.json')));
    assert.deepEqual(report.conditions.contentLanguages, selection); assert.deepEqual(review.contentLanguages, selection);
    assert.equal(report.topic.value, null); assert.equal(review.actualUserSelection, null); assert.equal(report.reactions.provenance, 'none');
    assert.equal(report.personal.status, 'disabled'); assert.equal(report.signalsRemovedExactRelated, true);
    assert.equal(run.stderr, ''); assert(!run.stdout.includes(file)); assert(!run.stdout.includes(output));
    assert.deepEqual(Object.keys(JSON.parse(run.stdout)).sort(), ['feedSHA256', 'files', 'sourceSHA256', 'status', 'userUtilityEvaluated']);
  }
  assert.deepEqual(await fs.readFile(file), original);
  for (const argument of ['all,ko', 'none,en', 'ko,ko', 'KO', 'en-US', 'ko, en', 'en,,ko', 'null', 'SYNTHETIC_PRIVATE_MARKER']) {
    assert.throws(() => Field.parseArgs(['--now', NOW, '--out', 'unused', '--content-languages', argument]), { code: 'field_usage' });
  }
  await assert.rejects(exec(process.execPath, [script, '--feed', file, '--now', NOW, '--out', path.join(directory, 'invalid'),
    '--content-languages', 'SYNTHETIC_PRIVATE_MARKER']), error => error.code === 1 && !error.stderr.includes('SYNTHETIC_PRIVATE_MARKER') && !error.stderr.includes(directory));
  await assert.rejects(fs.stat(path.join(directory, 'invalid')), { code: 'ENOENT' });
});
function conditions(extra = {}) { return { schemaVersion: 1, disabledSourceIds: [], knownUrls: [], feedback: [], ...extra }; }
function feedbackRow(item, kind = 'already_read') {
  return { articleId: item.id, canonicalUrl: Discovery.canonicalUrl(item.url), kind, updatedAt: PAST };
}
test('explicit source/known/read/hide conditions match actual UI projections and all four raw rank outputs', () => {
  const catalog = fixture(), envelope = copyFor(catalog.articles[0]), explicit = conditions({ disabledSourceIds: ['woowahan-tech'],
    knownUrls: [Discovery.canonicalUrl(catalog.articles[1].url)], feedback: [feedbackRow(catalog.articles[2]), feedbackRow(catalog.articles[4], 'not_relevant')] });
  const original = JSON.stringify({ catalog, envelope, explicit }), conditionsBytes = encode(explicit);
  const { report, reviewTemplate, markdown } = prepare(catalog, envelope, { conditionsBytes });
  const workspaceId = 'local-field-evaluation', settings = Settings.update(Settings.empty(workspaceId), { disabledSourceIds: explicit.disabledSourceIds }, { expectedRevision: 0, now: NOW });
  const input = Settings.filterFeed(catalog, settings), feedback = { ...Profile.empty(workspaceId), revision: 1, updatedAt: NOW, feedback: explicit.feedback };
  Profile.validate(feedback);
  const actions = { ...Actions.empty(workspaceId), revision: 1, updatedAt: envelope.exportedAt, personalizationEnabled: true, entries: envelope.entries };
  const removed = { ...structuredClone(actions), entries: actions.entries.map(row => ({ ...structuredClone(row), liked: false, likedAt: null })) };
  const common = { now: NOW, limit: 2, contentLanguages: null, knownUrls: report.conditions.knownUrls, feedback,
    profile: { workspaceId, manual: [{ id: 'explicit-evaluation-topic', label: 'AI' }] } };
  const hash = require('../scripts/evaluate-discovery.cjs').sha256;
  for (const mode of Field.MODES) {
    const expected = ['latest', 'related'].includes(mode) ? Discovery.rank(input, { ...common, mode }) :
      Recommendations.rank(input, { ...common, actions: mode === 'personal' ? actions : removed, mode: 'personal', baselineMode: 'related' });
    assert.equal(report.modes[mode].rankOutputSHA256, hash(JSON.stringify(expected)));
    assert.deepEqual(report.modes[mode].metadata, expected.metadata);
    assert.equal(report.modes[mode].poolCount, 1);
    assert.deepEqual(expected.metadata.excluded, { known: 2, feedback: 2, duplicate: 0, invalid: 0 });
    assert(report.modes[mode].items.every(item => item.articleId === 'latest-b'));
  }
  assert.deepEqual(report.conditions.feedback, explicit.feedback);
  assert.equal(report.conditions.knownUrls.length, 2);
  assert.deepEqual(reviewTemplate.explicitConditions, report.conditions.explicit);
  assert.deepEqual(report.conditions.explicit.activeSourceIds, ['naver-d2']);
  assert.equal(report.conditions.explicit.actualUserConditionsConfirmed, null);
  assert.equal(report.feed.articleCount, 6, 'original supplied feed metadata is retained separately');
  assert.equal(report.userUtilityConclusion, null); assert.equal(reviewTemplate.actualUserSelection, null);
  assert.match(markdown, /明示|명시 조건 파일/); assert.deepEqual(report.modes.signals_removed, report.modes.related);
  assert.equal(JSON.stringify({ catalog, envelope, explicit }), original);
});
test('source-off and language-off prototypes are excluded from inspection/evidence while original like-known remains frozen', () => {
  const catalog = fixture(), envelope = copyFor(catalog.articles[0]);
  const explicit = conditions({ disabledSourceIds: ['naver-d2', 'seoul-culture'] });
  for (const contentLanguages of [null, ['ko'], []]) {
    const { report } = prepare(catalog, envelope, { contentLanguages, conditionsBytes: encode(explicit) });
    assert.equal(report.personal.status, 'insufficient_signal'); assert.equal(report.personal.exactRelatedFallback, true);
    assert.equal(report.reactions.inspection.signalCount, 0); assert.equal(report.reactions.inspection.excluded.sourceOff, 1);
    assert.deepEqual(report.conditions.knownUrls, [Discovery.canonicalUrl(catalog.articles[0].url)]);
    assert.deepEqual(report.modes.signals_removed, report.modes.related);
    for (const mode of Field.MODES) assert.equal(report.modes[mode].poolCount, contentLanguages?.length === 0 ? 0 : 1);
  }
  const allOff = conditions({ disabledSourceIds: catalog.sources.map(row => row.id) });
  const { report } = prepare(catalog, envelope, { conditionsBytes: encode(allOff) });
  for (const mode of Field.MODES) { assert.equal(report.modes[mode].poolCount, 0); assert.deepEqual(report.modes[mode].items, []); }
  const languageOff = prepare(catalog, copyFor(article('english-like', 'AI 언어 연구', { language: 'en-US' })), {
    conditionsBytes: encode(conditions()), contentLanguages: ['ko'] }).report;
  assert.equal(languageOff.reactions.inspection.excluded.languageOff, 1); assert.equal(languageOff.personal.status, 'insufficient_signal');
});
test('condition schema rejects unknown fields/types/unsafe URLs/duplicates/future feedback and unset retains exact output', () => {
  const catalog = fixture(), envelope = copyFor(catalog.articles[0]), base = prepare(catalog, envelope);
  assert.deepEqual(base, prepare(catalog, envelope, { conditionsBytes: null }));
  const empty = prepare(catalog, envelope, { conditionsBytes: encode(conditions()) });
  assert.deepEqual(empty.report.modes, base.report.modes); assert.deepEqual(empty.report.reactions, base.report.reactions);
  const good = Discovery.canonicalUrl(catalog.articles[1].url), row = feedbackRow(catalog.articles[2]);
  const badURLs = ['http://d2.naver.com/a', 'https://d2.naver.com.evil.test/a', 'https://localhost/a', 'https://127.0.0.1/a',
    'https://user:pass@d2.naver.com/a', 'https://d2.naver.com:444/a', good + '#fragment', good + '&utm_source=tracker', null];
  const cases = [null, [], {}, { ...conditions(), schemaVersion: '1' }, { ...conditions(), revision: 1 },
    { schemaVersion: 1, disabledSourceIds: [], knownUrls: [] },
    conditions({ disabledSourceIds: ['naver-d2', 'naver-d2'] }), conditions({ disabledSourceIds: ['unknown-source'] }),
    conditions({ disabledSourceIds: ['__proto__'] }), conditions({ disabledSourceIds: [1] }),
    conditions({ knownUrls: [good, good] }), conditions({ knownUrls: Array(501).fill(good) }),
    conditions({ feedback: [row, row] }), conditions({ feedback: [{ ...row, articleId: 1 }] }),
    conditions({ feedback: [{ ...row, kind: 'liked' }] }), conditions({ feedback: [{ ...row, memo: 'PRIVATE_MARKER' }] }),
    conditions({ feedback: [{ ...row, updatedAt: FUTURE }] }), conditions({ feedback: [{ ...row, updatedAt: '2026-02-30T00:00:00Z' }] }),
    conditions({ feedback: [{ ...row, updatedAt: '2026-10-17T00:00:00.000000Z' }] }),
    conditions({ feedback: Array(501).fill(row) }), conditions({ feedback: 'PRIVATE_MARKER' }),
    ...badURLs.flatMap(url => [conditions({ knownUrls: [url] }), conditions({ feedback: [{ ...row, canonicalUrl: url }] })])];
  for (const value of cases) assert.throws(() => prepare(catalog, envelope, { conditionsBytes: encode(value) }), error => error.code === 'field_input' && !error.message.includes('PRIVATE_MARKER'));
  assert.throws(() => prepare(catalog, envelope, { conditionsBytes: Buffer.alloc(256 * 1024 + 1, 32) }), { code: 'field_input' });
});
test('explicit conditions CLI keeps private input/hash/path out of stdout/errors and preserves answers and supplied bytes', async t => {
  const directory = await temporary(t), marker = 'CONDITIONS_PRIVATE_MARKER';
  const catalog = fixture(), file = path.join(directory, 'feed.json'), conditionsFile = path.join(directory, marker + '.json');
  const feedBytes = encode(catalog), conditionBytes = encode(conditions({ knownUrls: [Discovery.canonicalUrl(catalog.articles[4].url)] }));
  await fs.writeFile(file, feedBytes); await fs.writeFile(conditionsFile, conditionBytes);
  const out = path.join(directory, 'new'), script = path.resolve(__dirname, '../scripts/evaluate-discovery-field.cjs');
  const args = [script, '--feed', file, '--now', NOW, '--content-languages', 'ko', '--conditions-file', conditionsFile, '--out', out];
  const run = await exec(process.execPath, args), report = JSON.parse(await fs.readFile(path.join(out, 'evaluation.json')));
  assert.equal(report.conditions.explicit.input, 'explicit_file'); assert.equal(report.conditions.explicit.actualUserConditionsConfirmed, null);
  assert(!run.stdout.includes(report.conditions.explicit.sha256)); assert(!run.stdout.includes(marker)); assert(!run.stdout.includes(directory));
  assert(!run.stdout.includes(catalog.articles[4].url)); assert.equal(run.stderr, '');
  const reviewPath = path.join(out, 'review-template.json'), review = JSON.parse(await fs.readFile(reviewPath));
  assert(review.reviews.every(row => row.usefulAfterReading === null)); review.preferredList = 'synthetic-human-answer';
  const answer = encode(review); await fs.writeFile(reviewPath, answer);
  await assert.rejects(exec(process.execPath, args), error => error.code === 1 && !error.stderr.includes(marker));
  assert.deepEqual(await fs.readFile(reviewPath), answer); assert.deepEqual(await fs.readFile(file), feedBytes); assert.deepEqual(await fs.readFile(conditionsFile), conditionBytes);
  for (const bytes of [Buffer.from('{"' + marker + '":'), Buffer.from([0xff]), encode(conditions({ knownUrls: ['https://' + marker + '.invalid/a'] }))]) {
    await fs.writeFile(conditionsFile, bytes);
    await assert.rejects(exec(process.execPath, [...args.slice(0, -1), path.join(directory, 'invalid')]), error => error.code === 1 && !error.stderr.includes(marker) && !error.stderr.includes(directory));
  }
  await assert.rejects(fs.stat(path.join(directory, 'invalid')), { code: 'ENOENT' });
});
