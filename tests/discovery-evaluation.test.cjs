'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const Discovery = require('../assets/life/discovery.js');
const Evaluation = require('../scripts/evaluate-discovery.cjs');
const exec = promisify(execFile);
const NOW = '2026-10-19T04:00:00.000Z';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const rights = mode => ({ label: '공개 합성 검토 범위', url: 'https://d2.naver.com/rights', mode });
  const source = { id: 'naver-d2', name: '합성 기술 출처', url: 'https://d2.naver.com/', feedUrl: 'https://d2.naver.com/feed',
    language: 'ko', rights: rights('full_text_allowed'), status: 'ok', stale: false, error: null,
    lastSuccessAt: '2026-10-18T18:00:00Z', lastAttemptAt: '2026-10-18T18:00:00Z' };
  const article = (id, title, day, extra = {}) => ({ id, sourceId: source.id, url: 'https://d2.naver.com/' + id, title,
    publishedAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`, author: null, language: 'ko', summary: '',
    tags: [], coverage: 'link_only', rights: rights('metadata_only'), fetchedAt: source.lastSuccessAt, ...extra });
  const articles = [article('ai-title', '😀 AI 연구', 1), article('ai-tag', '기술 자료', 2, { tags: ['인공 지능'], publishedAt: null, updatedAt: '2026-10-02T00:00:00Z' }),
    article('ai-summary', '공개 요약', 3, { coverage: 'summary', summary: '가😀 AI 활용에 관한 요약', rights: rights('summary_allowed') }),
    article('ai-body', '허용된 자료', 4, { coverage: 'full_text', bodyText: '가😀 AI 활용과 접근성 검토', rights: rights('full_text_allowed') }),
    article('ai-fifth', 'AI 기록 다섯', 5), article('ai-sixth', 'AI 기록 여섯', 6),
    article('new-show', '<script>전시</script> [제목](javascript:alert) ![그림](x)', 18), article('new-music', '공연 안내', 17),
    article('new-book', '독서 모임', 16), article('new-cloud', '클라우드 운영', 15), article('new-other', '자동차 소식', 14)];
  articles.push(article('duplicate-url', 'AI 복사 제목', 19, { url: articles[6].url + '?utm_source=duplicate#hash' }));
  return { schemaVersion: 1, generatedAt: '2026-10-18T18:00:00Z', sources: [source,
    { ...source, id: 'seoul-culture', name: '이전 성공 없는 실패 출처', url: 'https://news.seoul.go.kr/', feedUrl: 'https://news.seoul.go.kr/feed',
      rights: { label: '제목·링크만', url: null, mode: 'metadata_only' }, status: 'error', stale: true, lastSuccessAt: null, error: '합성 수집 실패' }], articles };
}
const encode = feed => Buffer.from(JSON.stringify(feed, null, 2) + '\n');
async function temporary(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'haedo-discovery-evaluation-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory; }
test('public comparison uses one byte-identical catalog, actual ranking and the same latest baseline for all nine interests', () => {
  const feed = fixture(), before = structuredClone(feed), bytes = encode(feed), originalBytes = Buffer.from(bytes);
  const { report, reviewTemplate } = Evaluation.evaluate(bytes, { now: NOW });
  assert.deepEqual(feed, before); assert.deepEqual(bytes, originalBytes);
  assert.equal(report.feed.sha256, digest(bytes)); assert.equal(report.feed.generatedAt, feed.generatedAt);
  assert.deepEqual(report.conditions.publicSamples, ['AI', '전시', '공연', '독서', '클라우드', '기후변화', '접근성', '책', '신간']);
  assert.equal(report.feed.validArticleCount, 12); assert.equal(report.feed.uniqueArticleCount, 11); assert.equal(report.feed.duplicateArticleCount, 1);
  const latestUrls = report.comparisons[0].latestTop5.map(item => item.canonicalUrl);
  for (const sample of report.comparisons) {
    const profile = { manual: [{ id: 'public', label: sample.interest }] };
    const actual = Discovery.rank(feed, { profile, knownUrls: [], feedback: [], mode: 'related', limit: 5, now: NOW });
    assert.deepEqual(sample.relatedTop5.map(item => item.canonicalUrl), actual.items.map(item => item.article.canonicalUrl));
    assert.deepEqual(sample.latestTop5.map(item => item.canonicalUrl), latestUrls);
    assert.equal(sample.feedSHA256, report.feed.sha256);
    assert.equal(sample.overlap.count, sample.relatedTop5.filter(item => latestUrls.includes(item.canonicalUrl)).length);
    assert.equal(sample.userUtilityConclusion, null);
  }
  const ai = report.comparisons.find(item => item.interest === 'AI');
  assert.equal(ai.matchingArticleCount, 6); assert.equal(ai.relatedTop5.length, 5);
  assert.ok(ai.relatedTop5.some(item => !latestUrls.includes(item.canonicalUrl)));
  assert.equal(report.conditions.userUtilityEvaluated, false); assert.equal(reviewTemplate.userUtilityConclusion, null);
});
test('quotes refer to exact raw title/tag/summary/body UTF16 fields including emoji offsets', () => {
  const feed = fixture(), { report } = Evaluation.evaluate(encode(feed), { now: NOW });
  const fields = new Set(); let emojiOffset = false;
  for (const sample of report.comparisons) for (const item of [...sample.relatedTop5, ...sample.latestTop5]) {
    const original = feed.articles.find(article => article.id === item.articleId);
    for (const reason of item.reasons) {
      const raw = reason.field === 'tags' ? original.tags[reason.tagIndex] : original[reason.field];
      assert.equal(raw.slice(reason.start, reason.end), reason.quote); fields.add(reason.field);
      if (original.id === 'ai-title' && reason.field === 'title') { assert.equal(reason.start, 3); emojiOffset = true; }
    }
  }
  assert.ok(emojiOffset); assert.deepEqual([...fields].sort(), ['bodyText', 'summary', 'tags', 'title']);
});
test('no-match samples stay empty while supply failures, rights, dates and limitations remain visible', () => {
  const feed = fixture(); feed.articles[10].publishedAt = '2026-11-01T00:00:00Z';
  const { report, markdown } = Evaluation.evaluate(encode(feed), { now: NOW });
  const climate = report.comparisons.find(row => row.interest === '기후변화');
  assert.equal(climate.noMatches, true); assert.equal(climate.matchingArticleCount, 0); assert.deepEqual(climate.relatedTop5, []);
  assert.equal(climate.latestTop5.length, 5); assert.equal(climate.latestMatchingArticleCount, 0);
  assert.equal(report.feed.sources[1].status, 'error'); assert.equal(report.feed.sources[1].lastSuccessAt, null);
  assert.equal(report.feed.sources[1].error, '합성 수집 실패'); assert.equal(report.feed.stale, true);
  assert.equal(report.feed.dateStatusCounts.unknown, 1); assert.equal(report.feed.dateStatusCounts.future, 1);
  assert.equal(report.feed.rightsCounts.full_text_allowed, 1); assert.ok(report.limitations.length > 0);
  assert.match(markdown, /일치 없음/); assert.match(markdown, /합성 수집 실패/);
  assert.match(markdown, /최신 상태 미확인/); assert.equal(markdown.includes('이전 자료'), false);
  assert.equal(markdown.includes('오래된 수집 포함: 예'), false);
});
test('human judgments remain null and canonical duplicates are reviewed once per interest', () => {
  const { report, reviewTemplate } = Evaluation.evaluate(encode(fixture()), { now: NOW });
  assert.equal(reviewTemplate.status, 'not_reviewed'); assert.equal(reviewTemplate.feedSHA256, report.feed.sha256);
  for (const row of reviewTemplate.comparisons) {
    assert.equal(row.preferredOrder, null); assert.equal(row.notes, null);
    assert.equal(new Set(row.reviews.map(item => item.canonicalUrl)).size, row.reviews.length);
    for (const item of row.reviews) { assert.equal(item.judgment, null); assert.equal(item.notes, null); }
  }
  assert.deepEqual(report.conditions.knownUrls, []); assert.deepEqual(report.conditions.feedback, []);
  assert.equal(report.conditions.privateDataRead, false); assert.equal(report.conditions.networkRequests, 0);
});
test('malformed UTF8/JSON/schema and invalid articles fail rather than produce a partial comparison', () => {
  for (const value of [Buffer.from([0xc3, 0x28]), Buffer.from('{'), Buffer.from('{}')]) assert.throws(() => Evaluation.evaluate(value, { now: NOW }));
  for (const mutate of [feed => { feed.articles[0].url = 'https://unregistered.example.org/article'; },
    feed => { feed.articles[0].coverage = 'full_text'; feed.articles[0].bodyText = '허가 없는 본문'; },
    feed => { feed.sources[0].status = 'not-a-state'; }]) {
    const feed = fixture(); mutate(feed); assert.throws(() => Evaluation.evaluate(encode(feed), { now: NOW }));
  }
});
test('Markdown escapes publisher text and cannot inject HTML or additional image/javascript links', () => {
  const { markdown } = Evaluation.evaluate(encode(fixture()), { now: NOW });
  assert.equal(markdown.includes('<script>'), false);
  assert.ok(markdown.includes('&lt;script&gt;'));
  assert.equal(markdown.includes('![그림](x)'), false);
  assert.ok(markdown.includes('사용자 읽을 만함')); assert.ok(markdown.includes('판정하지 않았다'));
});
test('output artifacts preserve exact input and refuse reruns that would overwrite user judgments', async t => {
  const temp = await temporary(t), file = path.join(temp, 'public.json'), output = path.join(temp, 'evaluation'), bytes = encode(fixture());
  await fs.writeFile(file, bytes);
  const result = await Evaluation.writeEvaluation(file, output, { now: NOW });
  assert.equal(result.feedSHA256, digest(bytes)); assert.equal(result.samples, 9);
  assert.deepEqual((await fs.readdir(output)).sort(), ['evaluation.json', 'evaluation.md', 'review-template.json']);
  const reviewFile = path.join(output, 'review-template.json'), template = JSON.parse(await fs.readFile(reviewFile, 'utf8'));
  template.comparisons[0].reviews[0].judgment = '이미 앎'; template.comparisons[0].notes = '사용자가 작성한 판단';
  const human = JSON.stringify(template, null, 2); await fs.writeFile(reviewFile, human);
  const reportBefore = await fs.readFile(path.join(output, 'evaluation.json'));
  await assert.rejects(Evaluation.writeEvaluation(file, output, { now: NOW }), { code: 'EEXIST' });
  assert.equal(await fs.readFile(reviewFile, 'utf8'), human);
  assert.deepEqual(await fs.readFile(path.join(output, 'evaluation.json')), reportBefore);
  assert.deepEqual(await fs.readFile(file), bytes);
});
test('invalid feed creates no output and an existing symlink output is never followed', async t => {
  const temp = await temporary(t), file = path.join(temp, 'invalid.json'), output = path.join(temp, 'not-created');
  await fs.writeFile(file, '{}');
  await assert.rejects(Evaluation.writeEvaluation(file, output, { now: NOW }));
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  await fs.writeFile(file, encode(fixture()));
  const human = path.join(temp, 'human'), alias = path.join(temp, 'alias'); await fs.mkdir(human);
  await fs.writeFile(path.join(human, 'review-template.json'), '사용자 검토'); await fs.symlink(human, alias, 'dir');
  await assert.rejects(Evaluation.writeEvaluation(file, alias, { now: NOW }), { code: 'EEXIST' });
  assert.deepEqual(await fs.readdir(human), ['review-template.json']);
  assert.equal(await fs.readFile(path.join(human, 'review-template.json'), 'utf8'), '사용자 검토');
});
test('CLI supports explicit local paths, reports no human evaluation and rejects duplicate or unknown arguments', async t => {
  const temp = await temporary(t), file = path.join(temp, 'feed.json'), output = path.join(temp, 'out'); await fs.writeFile(file, encode(fixture()));
  const script = path.resolve(__dirname, '../scripts/evaluate-discovery.cjs');
  const run = await exec(process.execPath, [script, '--feed', file, '--out', output]);
  assert.equal(JSON.parse(run.stdout).userUtilityEvaluated, false);
  await assert.rejects(exec(process.execPath, [script, '--feed', file, '--out', output]), error => error.code === 1 && error.stderr.includes('이미 있습니다'));
  assert.throws(() => Evaluation.parseArgs(['--out']), { code: 'discovery_evaluation_usage' });
  assert.throws(() => Evaluation.parseArgs(['--feed', file, '--feed', file]), { code: 'discovery_evaluation_usage' });
  assert.throws(() => Evaluation.parseArgs(['--private-bundle', file]), { code: 'discovery_evaluation_usage' });
  const compact = Buffer.from(JSON.stringify(fixture())), pretty = encode(fixture());
  assert.notEqual(Evaluation.evaluate(compact, { now: NOW }).report.feed.sha256, Evaluation.evaluate(pretty, { now: NOW }).report.feed.sha256);
});
