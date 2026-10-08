// Engine-only anonymous benchmark; deliberately keeps full workspace validation.
// Run: node tests/search-quality-benchmark.cjs
// SEARCH_CORE_PATH selects an immutable baseline copy; SEARCH_BENCH_OUTPUT saves JSON.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const core = require(process.env.SEARCH_CORE_PATH ? path.resolve(process.env.SEARCH_CORE_PATH) : '../assets/life/core.js');
const stamp = '2026-10-07T00:00:00.000Z';
const common = '오늘은 작은 정원에서 천천히 걸었다. 오래된 기록을 다시 읽으며 생각을 남긴다. 🌱 자료의 출처와 원문을 보존하고 다음에 읽을 구절을 고른다.\r\n'.repeat(20);
function fixture(size) {
  const bundle = core.createWorkspace({ workspaceId: 'anonymous-search-benchmark', title: '익명 합성 자료' });
  for (let i = 0; i < size; i++) {
    const sourceId = 'source-' + i;
    const contentText = common + (i === size - 1 ? '마지막 특별한 표식' : '익명 문서 번호 ' + i);
    bundle.sources.push({ id: sourceId, origin: 'obsidian', title: '자료 ' + i + (i === size - 1 ? ' 제목전용표식' : ''), revision: 1, createdAt: stamp, updatedAt: stamp });
    bundle.sourceVersions.push({ id: 'version-' + i, sourceId, format: 'text/plain', contentText, contentHash: crypto.createHash('sha256').update(contentText).digest('hex'), coverage: { status: 'unknown', omissions: [] }, originalAuthor: { label: '', relation: 'unknown' }, originalCreatedAt: null, importedAt: stamp, revision: 1 });
  }
  core.validateWorkspace(bundle);
  return bundle;
}
function measure(fn) {
  const samples = 15;
  const firstStart = performance.now(); let result = fn(); const firstMs = performance.now() - firstStart;
  for (let i = 0; i < 3; i++) fn();
  const times = [];
  for (let i = 0; i < samples; i++) { const start = performance.now(); result = fn(); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  const round = value => Math.round(value * 1000) / 1000;
  return { firstMs: round(firstMs), medianMs: round(times[Math.floor(samples / 2)]), p95Ms: round(times[Math.ceil(samples * 0.95) - 1]), samples, resultCount: Array.isArray(result) ? result.length : undefined };
}
function run() {
  const report = { generatedAt: new Date().toISOString(), runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model }, scope: 'Synchronous engine only; synthetic 1-version sources and no records, no UI/render/network/storage time. Full validation on every search. Three untimed warmups, fifteen warm samples, first timing reported separately. No timing pass/fail threshold.', sizes: [] };
  for (const size of [100, 1000, 10000]) {
    const bundle = fixture(size);
    const item = { sourceCount: size, versionCount: size, recordCount: 0, contentUtf16Units: bundle.sourceVersions.reduce((n, v) => n + v.contentText.length, 0), contentUtf8Bytes: bundle.sourceVersions.reduce((n, v) => n + Buffer.byteLength(v.contentText), 0), validateWorkspace: measure(() => core.validateWorkspace(bundle)), queries: [] };
    for (const [name, query, options, expected] of [['empty', '', {}, size], ['absent', '없는검색표식', {}, 0], ['selective-body', '특별한 표식', {}, 1], ['common-body', '정원', {}, size], ['title-only', '제목전용표식', {}, 1], ['spacing-exact-control', '자료의 출처', {}, size], ['spacing-literal', '자료의출처', {}, 0], ['spacing-option', '자료의출처', { ignoreKoreanSpacing: true }, typeof core.matchesSearchText === 'function' ? size : 0]]) {
      const timing = measure(() => core.searchSources(bundle, query, options));
      assert.equal(timing.resultCount, expected, name);
      item.queries.push({ name, query, options, ...timing });
    }
    report.sizes.push(item);
  }
  if (process.env.SEARCH_BENCH_OUTPUT) { const file = path.resolve(process.env.SEARCH_BENCH_OUTPUT); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n'); }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (require.main === module) run();
module.exports = { fixture, measure, run };
