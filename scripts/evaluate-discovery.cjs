#!/usr/bin/env node
/* Read-only preparation for human comparison. Public samples only; no private
 * workspace, interest, feedback, storage or network access. Output is local. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Discovery = require('../assets/life/discovery.js');

const ROOT = path.resolve(__dirname, '..');
const SAMPLES = Object.freeze(['AI', '전시', '공연', '독서', '클라우드', '기후변화', '접근성', '책', '신간']);
const DEFAULT_FEED = path.join(ROOT, 'assets/life/discovery-feed.json');
const DEFAULT_OUT = path.join(ROOT, '.local/discovery-expansion/evaluation');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function check(condition, code, message) { if (!condition) throw Object.assign(new Error(message), { code }); }
function exactReasons(item) {
  for (const reason of item.reasons) {
    const raw = reason.field === 'tags' ? item.article.tags[reason.tagIndex] : item.article[reason.field];
    check(typeof raw === 'string' && Number.isSafeInteger(reason.start) && Number.isSafeInteger(reason.end) &&
      reason.start >= 0 && reason.end > reason.start && reason.end <= raw.length && raw.slice(reason.start, reason.end) === reason.quote,
    'discovery_evaluation_evidence', '검색 근거가 공개 필드의 정확한 UTF-16 구간과 일치하지 않습니다.');
  }
}
function itemSnapshot(item, position) {
  exactReasons(item);
  const article = item.article;
  check(Discovery.canonicalUrl(article.url) === article.canonicalUrl, 'discovery_evaluation_evidence', '글 주소 정체성을 확인하지 못했습니다.');
  return { position, articleId: article.id, sourceId: article.sourceId, url: article.url, canonicalUrl: article.canonicalUrl,
    title: article.title, author: article.author, language: article.language, publishedAt: article.publishedAt,
    dateStatus: article.dateStatus, updatedAt: article.updatedAt, dateBasis: article.dateBasis, sortDate: article.sortDate,
    fetchedAt: article.fetchedAt, coverage: article.coverage, rights: clone(article.rights), reasons: clone(item.reasons) };
}
function counts(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return result;
}
// Feed bytes are mandatory: the SHA identifies the actual supplied file, not a
// reserialized approximation. The only interests are the fixed public samples.
function prepareFeed(feedBytes, options = {}) {
  check(Buffer.isBuffer(feedBytes) || typeof feedBytes === 'string', 'discovery_evaluation_invalid', '공개 JSON 파일의 UTF-8 바이트가 필요합니다.');
  const bytes = Buffer.isBuffer(feedBytes) ? Buffer.from(feedBytes) : Buffer.from(feedBytes, 'utf8');
  check(bytes.length <= Discovery.LIMITS.feedBytes, 'discovery_evaluation_invalid', '공개 목록이 지원 용량을 넘었습니다.');
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\ufeff/, '')); }
  catch (_) { throw Object.assign(new Error('공개 목록이 올바른 UTF-8 JSON이 아닙니다.'), { code: 'discovery_evaluation_invalid' }); }
  const evaluatedAt = options.now === undefined ? new Date().toISOString() : typeof options.now === 'function' ? options.now() : options.now;
  check(typeof evaluatedAt === 'string' && Number.isFinite(Date.parse(evaluatedAt)), 'discovery_evaluation_invalid', '평가 시각을 확인해 주세요.');
  const feed = Discovery.validateFeed(input, { now: evaluatedAt });
  // An invalid row must not quietly disappear from this comparison's corpus.
  check(feed.validation.invalid.length === 0, 'discovery_evaluation_invalid', '검증에서 제외된 글이 있습니다. 공개 목록을 수정한 뒤 새 비교를 준비해 주세요.');
  return { bytes, input, feed, evaluatedAt };
}
function evaluate(feedBytes, options = {}) {
  const { bytes, input, feed, evaluatedAt } = prepareFeed(feedBytes, options), before = JSON.stringify(input);
  const feedSHA256 = sha256(bytes), policy = { limit: 5, knownUrls: [], feedback: [], now: evaluatedAt };
  const baseline = Discovery.rank(input, { ...policy, profile: { manual: [] }, mode: 'latest' });
  const comparisons = SAMPLES.map((interest, index) => {
    const profile = { manual: [{ id: 'public-sample-' + index, label: interest }] };
    const related = Discovery.rank(input, { ...policy, profile, mode: 'related' });
    const latest = Discovery.rank(input, { ...policy, profile, mode: 'latest' });
    check(JSON.stringify(latest.items.map(row => row.article.canonicalUrl)) === JSON.stringify(baseline.items.map(row => row.article.canonicalUrl)),
      'discovery_evaluation_catalog', '같은 공급의 최신순 결과가 관심 표본에 따라 바뀌었습니다.');
    const relatedTop5 = related.items.map((item, position) => itemSnapshot(item, position + 1));
    const latestTop5 = latest.items.map((item, position) => itemSnapshot(item, position + 1));
    const latestUrls = new Set(latestTop5.map(item => item.canonicalUrl));
    const overlap = relatedTop5.filter(item => latestUrls.has(item.canonicalUrl)).map(item => item.canonicalUrl);
    return { interest, feedSHA256, generatedAt: input.generatedAt, matchingArticleCount: related.eligibleCount,
      noMatches: related.eligibleCount === 0, relatedTop5, latestTop5,
      latestMatchingArticleCount: latestTop5.filter(item => item.reasons.length > 0).length,
      overlap: { canonicalUrls: overlap, count: overlap.length, relatedOnlyCount: relatedTop5.length - overlap.length,
        latestOnlyCount: latestTop5.length - overlap.length },
      limitation: related.metadata.limitation, userUtilityConclusion: null };
  });
  check(JSON.stringify(input) === before, 'discovery_evaluation_mutated', '공개 목록이 비교 중 바뀌었습니다.');
  const report = { schemaVersion: 1, evaluatedAt,
    scope: '동일한 공개 카탈로그와 고정 공개 관심 표본의 문자열 일치 비교 준비. 사용자 효용 평가는 수행하지 않음.',
    feed: { sha256: feedSHA256, bytes: bytes.length, generatedAt: input.generatedAt, validatedGeneratedAt: feed.generatedAt,
      stale: feed.stale, suppliedArticleCount: input.articles.length, validArticleCount: feed.articles.length,
      uniqueArticleCount: baseline.poolCount, duplicateArticleCount: baseline.metadata.excluded.duplicate,
      invalidArticleCount: feed.validation.invalid.length, sourceCount: feed.sources.length,
      coverageCounts: counts(feed.articles.map(item => item.coverage)), rightsCounts: counts(feed.articles.map(item => item.rights.mode)),
      dateStatusCounts: counts(feed.articles.map(item => item.dateStatus)), dateBasisCounts: counts(feed.articles.map(item => item.dateBasis)),
      sourceArticleCounts: counts(feed.articles.map(item => item.sourceId)),
      sources: clone(feed.sources) },
    conditions: { publicSamples: [...SAMPLES], knownUrls: [], feedback: [], limit: 5, rankingImplementation: 'assets/life/discovery.js',
      rankingSourceSHA256: sha256(require('node:fs').readFileSync(require.resolve('../assets/life/discovery.js'))),
      privateDataRead: false, networkRequests: 0, userUtilityEvaluated: false },
    comparisons,
    limitations: ['관심순은 명시적 표현 일치이며 의미 이해·찬반·개인 선호 판정이 아니다.',
      '최신순은 같은 전체 공급·시점·제외 조건을 사용한다. 개인 보관·피드백은 읽지 않고 양쪽 모두 빈 조건을 적용한다.',
      '후보 수·공통 결과·일치 표현은 자동 집계다. 읽을 만함·이미 앎·무관함·순서 선호는 사용자가 별도 판정해야 한다.',
      '출처의 실패·오래된 수집·불명확한 날짜·본문 미확보는 그대로 남긴다. 링크 접근이나 원문 독서를 수행하지 않는다.'] };
  const reviewTemplate = { schemaVersion: 1, feedSHA256, generatedAt: input.generatedAt, preparedAt: evaluatedAt,
    status: 'not_reviewed', instructions: '원문을 직접 읽은 뒤 judgment에 읽을 만함/이미 앎/무관함 중 하나를 적고 notes를 남긴다. 평가 전에는 null을 유지한다.',
    allowedJudgments: ['읽을 만함', '이미 앎', '무관함'], allowedOrderPreferences: ['관심순', '최신순', '차이 없음', '판단 보류'],
    userUtilityConclusion: null, comparisons: comparisons.map(row => {
      const union = new Map([...row.relatedTop5, ...row.latestTop5].map(item => [item.canonicalUrl, item]));
      return { interest: row.interest, relatedOrder: row.relatedTop5.map(item => item.canonicalUrl), latestOrder: row.latestTop5.map(item => item.canonicalUrl),
        preferredOrder: null, notes: null, reviews: [...union.values()].map(item => ({ articleId: item.articleId,
          canonicalUrl: item.canonicalUrl, title: item.title, judgment: null, notes: null })) };
    }) };
  return { report, reviewTemplate, markdown: renderMarkdown(report) };
}
function markdownText(value) {
  return String(value ?? '미확인').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|~>-]/g, '\\$&').replace(/\r?\n/g, ' ');
}
function renderMarkdown(report) {
  const lines = ['# 공개 관심순·최신순 비교 준비', '',
    '이 문서는 자동 집계다. 사용자 읽을 만함·이미 앎·무관함이나 추천 유용성을 판정하지 않았다.', '',
    '- 공개 목록 SHA-256: `' + report.feed.sha256 + '`', '- 목록 생성 시각: ' + report.feed.generatedAt,
    '- 비교 기준 시각: ' + report.evaluatedAt,
    '- 공급: ' + report.feed.validArticleCount + '개 · canonical URL 중복 제외 후 ' + report.feed.uniqueArticleCount + '개 · 출처 ' + report.feed.sourceCount + '개',
    '- 날짜 상태: ' + Object.entries(report.feed.dateStatusCounts).map(([status, count]) => status + ' ' + count + '개').join(' · '),
    '- 확보 범위: ' + Object.entries(report.feed.coverageCounts).map(([coverage, count]) => coverage + ' ' + count + '개').join(' · '),
    '- 최신 상태를 확인하지 못한 출처·목록 포함: ' + (report.feed.stale ? '예' : '아니오'), '',
    '| 출처 | 수집 상태 | 마지막 성공 | 마지막 시도 | 권리 범위 | 실패 |', '| --- | --- | --- | --- | --- | --- |'];
  for (const source of report.feed.sources) lines.push('| ' + [source.name, source.status + (source.stale ? ' / 최신 상태 미확인' : ''), source.lastSuccessAt, source.lastAttemptAt, source.rights.mode + ' · ' + source.rights.label, source.error || '없음'].map(markdownText).join(' | ') + ' |');
  for (const row of report.comparisons) {
    lines.push('', '## ' + markdownText(row.interest), '', '전체 표현 일치 ' + row.matchingArticleCount + '개 · 최신순 상위 5개 중 일치 ' + row.latestMatchingArticleCount + '개 · 두 목록 공통 ' + row.overlap.count + '개' + (row.noMatches ? ' · 일치 없음' : ''), '');
    for (const [name, items] of [['관심순', row.relatedTop5], ['같은 전체 공급의 최신순', row.latestTop5]]) {
      lines.push('### ' + name, '');
      if (!items.length) lines.push('표시할 글 없음. 관련 없는 글로 수를 채우지 않았다.', '');
      for (const item of items) {
        lines.push(item.position + '. [' + markdownText(item.title) + '](<' + item.canonicalUrl + '>)', '',
          '   출처 ' + markdownText(item.sourceId) + ' · ' + markdownText(item.coverage) + ' · 발행 ' + markdownText(item.publishedAt) + ' (' + markdownText(item.dateStatus) + ') · 수정 ' + markdownText(item.updatedAt) + ' · 정렬 기준 ' + markdownText(item.dateBasis) + ' · 권리 ' + markdownText(item.rights.mode), '');
        for (const reason of item.reasons) lines.push('   - ' + markdownText(reason.field + (reason.tagIndex === undefined ? '' : '[' + reason.tagIndex + ']')) +
          ' UTF-16 [' + reason.start + ', ' + reason.end + '): ' + markdownText(JSON.stringify(reason.quote)) + ' · ' + markdownText(reason.via));
        if (!item.reasons.length) lines.push('   - 이 표본 관심의 일치 표현 없음');
        lines.push('');
      }
    }
    lines.push(markdownText(row.limitation), '');
  }
  lines.push('## 사용자 검토', '', '`review-template.json`의 판단은 모두 null이다. 복사본에서 원문을 직접 읽고 판정한다. 이 도구는 기존 출력 폴더를 덮어쓰지 않는다.', '',
    ...report.limitations.map(value => '- ' + markdownText(value)), '');
  return lines.join('\n');
}
async function writeEvaluation(feedPath = DEFAULT_FEED, outDir = DEFAULT_OUT, options = {}) {
  const input = path.resolve(feedPath), output = path.resolve(outDir);
  const prepared = evaluate(await fs.readFile(input), options);
  await fs.mkdir(path.dirname(output), { recursive: true });
  // Atomic creation is the overwrite guard, including files, nonempty/empty
  // folders and symlinks. Never delete an existing user's review to retry.
  await fs.mkdir(output);
  const files = { 'evaluation.json': JSON.stringify(prepared.report, null, 2) + '\n',
    'evaluation.md': prepared.markdown, 'review-template.json': JSON.stringify(prepared.reviewTemplate, null, 2) + '\n' };
  for (const [name, value] of Object.entries(files)) await fs.writeFile(path.join(output, name), value, { flag: 'wx' });
  return { outputDirectory: output, feedSHA256: prepared.report.feed.sha256, generatedAt: prepared.report.feed.generatedAt,
    samples: prepared.report.comparisons.length, userUtilityEvaluated: false, files: Object.keys(files) };
}
function parseArgs(argv) {
  const options = { feed: DEFAULT_FEED, out: DEFAULT_OUT }, seen = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    check(['--feed', '--out'].includes(key) && !seen.has(key) && typeof argv[index + 1] === 'string' && !argv[index + 1].startsWith('--'),
      'discovery_evaluation_usage', '사용법: node scripts/evaluate-discovery.cjs [--feed FILE] [--out NEW_DIRECTORY]');
    seen.add(key); options[key.slice(2)] = argv[index + 1];
  }
  return options;
}
module.exports = Object.freeze({ SAMPLES, DEFAULT_FEED, DEFAULT_OUT, evaluate, renderMarkdown, writeEvaluation, parseArgs, prepareFeed, itemSnapshot, markdownText, sha256 });
if (require.main === module) {
  if (process.argv.length === 3 && process.argv[2] === '--help') console.log('node scripts/evaluate-discovery.cjs [--feed FILE] [--out NEW_DIRECTORY]\n공개 카탈로그만 읽어 비교 자료를 준비합니다. 기존 출력은 덮어쓰지 않으며 사용자 효용을 자동 판정하지 않습니다.');
  else Promise.resolve().then(() => parseArgs(process.argv.slice(2))).then(options => writeEvaluation(options.feed, options.out))
    .then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
      console.error(error.code === 'EEXIST' ? '출력 경로가 이미 있습니다. 사용자 검토를 보존하려면 다른 --out 경로를 선택해 주세요.' : error.message);
      process.exitCode = 1;
    });
}
