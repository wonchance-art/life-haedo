/* 비슷한 문단 실험 평가기. 실행기 결과(벡터)와 gold로 채점한다. 모델·브라우저·네트워크를 쓰지 않는다.
 * node evaluate.cjs --set dev    → dev-report.json (변형·임계값 선택. 개발 세트에서만)
 * node evaluate.cjs --set eval --freeze-sha <SHA>  → eval-report.json (봉인한 값으로 한 번 채점)
 * 기반선은 제품 assets/life/rediscovery.js의 related()를 수정 없이 문단 단위로 호출한다. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const candidate = require('./candidate.js');
const HERE = __dirname, REPO = path.resolve(HERE, '../../../..');
const rediscovery = require(path.join(REPO, 'assets/life/rediscovery.js'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const shaFile = file => sha(fs.readFileSync(file));
const read = name => JSON.parse(fs.readFileSync(path.join(HERE, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(HERE, name), JSON.stringify(value, null, 2) + '\n');
const GRID = Array.from({ length: 76 }, (_, index) => (20 + index) / 100); // 0.20 … 0.95
const DEV_FP_LIMIT = 0.10;
const CRITERIA = Object.freeze({ hit3: 0.70, marginOverBaseline: 0.15, unrelatedFP: 0.20, indexMs: 60000, queryMs: 200, storageBytes: 2000000 });

function args() {
  const values = {};
  for (let index = 2; index < process.argv.length; index += 2) values[process.argv[index].slice(2)] = process.argv[index + 1];
  if (!['dev', 'eval'].includes(values.set)) throw new Error('--set dev|eval');
  return values;
}
const round = value => Math.round(value * 10000) / 10000;

function paragraphTable(corpus) {
  const table = new Map();
  for (const document of corpus.documents) for (const paragraph of candidate.paragraphs(document))
    table.set(document.id + ':' + paragraph.index, { ...paragraph, title: document.title });
  return table;
}
function checkGold(gold, table) {
  for (const seed of gold.relatedSeeds) for (const id of [seed.seed, ...seed.related]) if (!table.get(id)?.indexed) throw new Error('gold 참조 오류 ' + id);
  for (const seed of gold.relatedSeeds) for (const id of seed.related) if (id.split(':')[0] === seed.seed.split(':')[0]) throw new Error('같은 문서 gold ' + id);
  for (const id of gold.unrelatedSeeds) if (!table.get(id)?.indexed) throw new Error('gold 참조 오류 ' + id);
}
// 한 방법의 결과(seed id → 후보 id 목록)를 채점한다.
function score(gold, outputs) {
  let hits = 0, reciprocal = 0, returned = 0, correct = 0, emptyRelated = 0, fp = 0, goldFound = 0, goldTotal = 0;
  const perSeed = [];
  for (const seed of gold.relatedSeeds) {
    const list = outputs.get(seed.seed) || [], related = new Set(seed.related);
    const rank = list.findIndex(id => related.has(id));
    if (rank >= 0) { hits++; reciprocal += 1 / (rank + 1); }
    if (!list.length) emptyRelated++;
    returned += list.length; correct += list.filter(id => related.has(id)).length;
    goldFound += seed.related.filter(id => list.includes(id)).length; goldTotal += seed.related.length;
    perSeed.push({ seed: seed.seed, type: seed.type, hit: rank >= 0, rank: rank >= 0 ? rank + 1 : null, returned: list });
  }
  const unrelated = [];
  for (const id of gold.unrelatedSeeds) { const list = outputs.get(id) || []; if (list.length) fp++; unrelated.push({ seed: id, returned: list }); }
  const n = gold.relatedSeeds.length, m = gold.unrelatedSeeds.length;
  return { hit3: round(hits / n), hits, relatedSeeds: n, mrr: round(reciprocal / n), goldRecall3: round(goldFound / goldTotal),
    returnedPrecision: returned ? round(correct / returned) : null, returnedOnRelated: returned, emptyOnRelated: emptyRelated,
    unrelatedFP: round(fp / m), unrelatedWithOutput: fp, unrelatedSeeds: m, perSeed, unrelated };
}
function embeddingOutputs(entries, gold, threshold) {
  const index = entries.map(entry => ({ ...entry, vectors: candidate.decodeFloat32(entry.vectors, 384) }));
  const byId = new Map(index.map(entry => [entry.id, entry])), outputs = new Map(), scores = new Map();
  for (const id of [...gold.relatedSeeds.map(seed => seed.seed), ...gold.unrelatedSeeds]) {
    const results = candidate.similar(index, byId.get(id), threshold);
    outputs.set(id, results.map(result => result.id)); scores.set(id, results.map(result => round(result.score)));
  }
  return { outputs, scores };
}
// 기반선: 문단 하나를 원문 하나로 본 최소 묶음. 같은 문서·같은 본문 복제는 제품의 방향 있는 제외 쌍으로 뺀다.
const safe = id => id.replace(':', '_');
function baselineOutputs(table, gold, titleMode) {
  const ids = [...table.keys()].filter(id => table.get(id).indexed);
  const bundle = { schemaVersion: 1, workspaceId: 'experiment', sources: [], sourceVersions: [], records: [], tombstones: [], links: [] };
  for (const id of ids) {
    const paragraph = table.get(id);
    bundle.sources.push({ id: 's_' + safe(id), title: titleMode === 'document' ? paragraph.title : '' });
    bundle.sourceVersions.push({ id: 'v_' + safe(id), sourceId: 's_' + safe(id), contentText: paragraph.text });
  }
  const outputs = new Map();
  for (const seedId of [...gold.relatedSeeds.map(seed => seed.seed), ...gold.unrelatedSeeds]) {
    const seed = table.get(seedId), normalized = candidate.normalize(seed.text);
    const excludedPairs = ids.filter(id => id !== seedId && (id.split(':')[0] === seedId.split(':')[0] || candidate.normalize(table.get(id).text) === normalized))
      .map(id => ({ seedSourceId: 's_' + safe(seedId), candidateSourceId: 's_' + safe(id) }));
    const workbench = { workspaceId: 'experiment', groups: [], discovery: { excludedPairs } };
    const results = rediscovery.related(bundle, workbench, 'v_' + safe(seedId), { limit: 3 });
    outputs.set(seedId, results.map(result => result.sourceId.slice(2).replace('_', ':')));
  }
  return outputs;
}
// 참고값(판정 미사용): 현재 제품처럼 문서 단위로 재발견. 돌려준 문서에 gold 문단이 있으면 적중.
function documentBaseline(corpus, gold) {
  const bundle = { schemaVersion: 1, workspaceId: 'experiment', sources: [], sourceVersions: [], records: [], tombstones: [], links: [] };
  for (const document of corpus.documents) {
    bundle.sources.push({ id: 's_' + document.id, title: document.title });
    bundle.sourceVersions.push({ id: 'v_' + document.id, sourceId: 's_' + document.id, contentText: document.text });
  }
  const workbench = { workspaceId: 'experiment', groups: [], discovery: { excludedPairs: [] } };
  const docOutputs = new Map(), outputs = new Map();
  for (const document of corpus.documents) docOutputs.set(document.id, rediscovery.related(bundle, workbench, 'v_' + document.id, { limit: 3 }).map(result => result.sourceId.slice(2)));
  const resolve = (seedId, related) => {
    const docs = docOutputs.get(seedId.split(':')[0]);
    // 문서 안의 어느 문단인지 짚지 못하므로, gold 문단이 든 문서를 돌려주면 그 gold를 낸 것으로 후하게 센다.
    return docs.map(doc => related.find(id => id.startsWith(doc + ':')) || doc + ':?');
  };
  for (const seed of gold.relatedSeeds) outputs.set(seed.seed, resolve(seed.seed, seed.related));
  for (const id of gold.unrelatedSeeds) outputs.set(id, resolve(id, []));
  return outputs;
}
// 사실 보고: gold 쌍 각각에 공통어 규칙(서로 다른 실제 단어 2개 이상)이 성립하는지.
function lexicalOverlap(table, gold) {
  let pairs = 0, overlap = 0;
  for (const seed of gold.relatedSeeds) for (const target of seed.related) {
    pairs++;
    const a = table.get(seed.seed), b = table.get(target);
    const bundle = { schemaVersion: 1, workspaceId: 'x', records: [], tombstones: [], links: [],
      sources: [{ id: 'a', title: '' }, { id: 'b', title: '' }], sourceVersions: [{ id: 'va', sourceId: 'a', contentText: a.text }, { id: 'vb', sourceId: 'b', contentText: b.text }] };
    if (rediscovery.related(bundle, { workspaceId: 'x', groups: [] }, 'va', { limit: 1 }).length) overlap++;
  }
  return { goldPairs: pairs, withTwoCommonTerms: overlap, ratio: round(overlap / pairs) };
}
function strip(result) { const { perSeed, unrelated, ...summary } = result; return summary; }

function tune() {
  const seal = read('seal.json'), gold = read('dev-gold.json'), corpus = read('dev-corpus.json'), output = read('dev-output.json');
  for (const name of ['dev-gold.json', 'dev-corpus.json']) if (shaFile(path.join(HERE, name)) !== seal.files[name]) throw new Error(name + ' 봉인 불일치');
  if (output.sealSHA256 !== shaFile(path.join(HERE, 'seal.json'))) throw new Error('dev 실행의 봉인 SHA 불일치');
  const table = paragraphTable(corpus); checkGold(gold, table);
  const variants = {};
  for (const variant of candidate.VARIANTS) {
    const entries = output.variants[variant].entries, grid = [];
    for (const threshold of GRID) { const result = embeddingOutputs(entries, gold, threshold); const s = score(gold, result.outputs); grid.push({ threshold, hit3: s.hit3, unrelatedFP: s.unrelatedFP }); }
    // 개발 세트 오탐률 ≤ 0.10 중 Hit@3 최대, 같으면 더 높은 임계값.
    const allowed = grid.filter(row => row.unrelatedFP <= DEV_FP_LIMIT);
    const best = allowed.reduce((a, b) => (b.hit3 > a.hit3 || (b.hit3 === a.hit3 && b.threshold > a.threshold)) ? b : a);
    const detail = score(gold, embeddingOutputs(entries, gold, best.threshold).outputs);
    variants[variant] = { selectedThreshold: best.threshold, dev: strip(detail), grid, perSeed: detail.perSeed, unrelated: detail.unrelated };
  }
  // 변형 선택: 선택 임계값에서 개발 Hit@3 최대, 같으면 P → TP → W2 순(단순한 쪽).
  const chosen = candidate.VARIANTS.reduce((a, b) => variants[b].dev.hit3 > variants[a].dev.hit3 ? b : a);
  const baselines = { paragraphNoTitle: strip(score(gold, baselineOutputs(table, gold, 'none'))), paragraphDocumentTitle: strip(score(gold, baselineOutputs(table, gold, 'document'))),
    documentLevelReference: strip(score(gold, documentBaseline(corpus, gold))) };
  const report = { set: 'dev', evaluatorSHA256: shaFile(__filename), candidateSHA256: shaFile(path.join(HERE, 'candidate.js')), selectionRule: 'variant별 개발 오탐률 ≤ 0.10에서 Hit@3 최대·동률은 높은 임계값, 변형은 Hit@3 최대·동률은 P→TP→W2',
    chosen: { variant: chosen, threshold: variants[chosen].selectedThreshold }, variants, baselines, lexicalOverlap: lexicalOverlap(table, gold) };
  write('dev-report.json', report);
  console.log(JSON.stringify({ chosen: report.chosen, perVariant: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, { t: v.selectedThreshold, ...v.dev }])), baselines, lexical: report.lexicalOverlap }, null, 1));
}

function final(options) {
  const freezeBytes = fs.readFileSync(path.join(HERE, 'freeze.json'));
  if (sha(freezeBytes) !== options['freeze-sha']) throw new Error('freeze.json SHA 불일치');
  const freeze = JSON.parse(freezeBytes.toString('utf8'));
  for (const [name, expected] of Object.entries(freeze.files)) if (shaFile(path.join(HERE, name)) !== expected) throw new Error(name + ' 동결 SHA 불일치');
  const seal = read('seal.json');
  for (const name of ['eval-gold.json', 'eval-corpus.json', 'preregistration.md']) if (shaFile(path.join(HERE, name)) !== seal.files[name]) throw new Error(name + ' 봉인 불일치');
  const gold = read('eval-gold.json'), corpus = read('eval-corpus.json'), output = read('eval-output.json');
  if (output.freezeSHA256 !== options['freeze-sha']) throw new Error('평가 실행의 동결 SHA 불일치');
  const table = paragraphTable(corpus); checkGold(gold, table);
  const { variant, threshold } = freeze.parameters;
  const embedded = embeddingOutputs(output.quality.entries, gold, threshold);
  const method = score(gold, embedded.outputs);
  const b1 = score(gold, baselineOutputs(table, gold, 'none')), b2 = score(gold, baselineOutputs(table, gold, 'document'));
  const reference = score(gold, documentBaseline(corpus, gold));
  const strongest = b1.hit3 >= b2.hit3 ? 'paragraphNoTitle' : 'paragraphDocumentTitle', baselineHit = Math.max(b1.hit3, b2.hit3);
  const cost = output.cost;
  const checks = {
    hit3: { value: method.hit3, limit: '≥ ' + CRITERIA.hit3, pass: method.hit3 >= CRITERIA.hit3 },
    margin: { value: round(method.hit3 - baselineHit), baseline: strongest, baselineHit3: baselineHit, limit: '≥ ' + CRITERIA.marginOverBaseline, pass: round(method.hit3 - baselineHit) >= CRITERIA.marginOverBaseline },
    unrelatedFP: { value: method.unrelatedFP, limit: '≤ ' + CRITERIA.unrelatedFP, pass: method.unrelatedFP <= CRITERIA.unrelatedFP },
    indexMs: { corpusPool: round(cost.corpusPool.indexMs), longPool: round(cost.longPool.indexMs), limit: '≤ ' + CRITERIA.indexMs, pass: cost.corpusPool.indexMs <= CRITERIA.indexMs && cost.longPool.indexMs <= CRITERIA.indexMs },
    queryMs: { corpusPoolMax: round(cost.corpusPool.query.maxMs), longPoolMax: round(cost.longPool.query.maxMs), limit: '≤ ' + CRITERIA.queryMs, pass: cost.corpusPool.query.maxMs <= CRITERIA.queryMs && cost.longPool.query.maxMs <= CRITERIA.queryMs },
    storageBytes: { corpusPool: cost.corpusPool.storageBytes, longPool: cost.longPool.storageBytes, limit: '≤ ' + CRITERIA.storageBytes, pass: cost.corpusPool.storageBytes <= CRITERIA.storageBytes && cost.longPool.storageBytes <= CRITERIA.storageBytes },
    throttleApplied: { iframeRatio: round(output.calibration.iframeRatio), note: '판정 조건이 아니라 측정 유효성 확인: iframe 주 스레드 감속비', valid: output.calibration.iframeRatio >= 3 },
    sameVectors: { maxAbsDifference: cost.workerVsHostMaxAbsDifference, valid: cost.workerVsHostMaxAbsDifference === 0 },
    networkViolations: { count: output.run.network.violations.length, valid: output.run.network.violations.length === 0 },
    productUnchanged: { valid: JSON.stringify(output.productBefore) === JSON.stringify(output.productAfter) && JSON.stringify(output.productBefore) === JSON.stringify(freeze.product) }
  };
  const quality = ['hit3', 'margin', 'unrelatedFP', 'indexMs', 'queryMs', 'storageBytes'];
  const valid = ['throttleApplied', 'sameVectors', 'networkViolations', 'productUnchanged'].every(key => checks[key].valid);
  const decision = !valid ? 'invalid_run' : quality.every(key => checks[key].pass) ? 'adopt' : 'reject';
  const scores = Object.fromEntries([...embedded.scores]);
  const report = { set: 'eval', freezeSHA256: options['freeze-sha'], evaluatorSHA256: shaFile(__filename), parameters: freeze.parameters, decision, checks,
    method: { ...strip(method), perSeed: method.perSeed.map(row => ({ ...row, scores: scores[row.seed] })), unrelated: method.unrelated.map(row => ({ ...row, scores: scores[row.seed] })) },
    baselines: { paragraphNoTitle: b1, paragraphDocumentTitle: b2, documentLevelReference: { ...strip(reference), note: '현재 제품 동작(문서 단위). 문단을 짚지 못해 후하게 센 참고값이며 판정에 쓰지 않는다.' } },
    byType: Object.fromEntries(['question', 'experience', 'topic'].map(type => { const rows = method.perSeed.filter(row => row.type === type); const base = b1.hit3 >= b2.hit3 ? b1 : b2;
      return [type, { seeds: rows.length, methodHits: rows.filter(row => row.hit).length, baselineHits: base.perSeed.filter(row => row.type === type && row.hit).length }]; })),
    lexicalOverlap: lexicalOverlap(table, gold),
    cost: { workerPrepareMsUnthrottled: output.workerPrepareMs, hostPrepareMsThrottled: cost.hostPrepareMsThrottled, corpusPool: cost.corpusPool, longPool: cost.longPool,
      singleLongParagraphEmbedMedianMs: cost.singleLongParagraphEmbedMedianMs, memory: output.run.memory, externalBytes: output.run.network.externalBytes, calibration: output.calibration } };
  write('eval-report.json', report);
  console.log(JSON.stringify({ decision, checks, method: strip(method), b1: strip(b1), b2: strip(b2), reference: strip(reference), byType: report.byType, lexical: report.lexicalOverlap }, null, 1));
}

const options = args();
if (options.set === 'dev') tune(); else final(options);
