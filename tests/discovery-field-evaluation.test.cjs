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
  const report = JSON.parse(await fs.readFile(path.join(output, 'evaluation.json'))); assert.equal(Object.keys(report.sourceSHA256).length, 5);
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
