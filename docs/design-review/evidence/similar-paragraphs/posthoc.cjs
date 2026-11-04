/* 사후 서술(판정 미사용). 평가 결과를 본 뒤 만든 분석이므로 새 검증이 아니다.
 * 평가 세트에서 임계값을 고른다면(정답을 본 최적값) 어디까지 가능했는지를 적어, 기각 뒤 "바꿀 조건"의 근거로만 쓴다.
 * node posthoc.cjs → posthoc.json */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const candidate = require('./candidate.js');
const HERE = __dirname;
const read = name => JSON.parse(fs.readFileSync(path.join(HERE, name), 'utf8'));
const gold = read('eval-gold.json'), output = read('eval-output.json');
const index = output.quality.entries.map(entry => ({ ...entry, vectors: candidate.decodeFloat32(entry.vectors, 384) }));
const byId = new Map(index.map(entry => [entry.id, entry]));
const round = value => Math.round(value * 10000) / 10000;
const rows = [];
for (let cents = 20; cents <= 95; cents++) {
  const threshold = cents / 100;
  let hits = 0, fp = 0;
  for (const seed of gold.relatedSeeds) {
    const list = candidate.similar(index, byId.get(seed.seed), threshold).map(result => result.id);
    if (list.some(id => seed.related.includes(id))) hits++;
  }
  for (const id of gold.unrelatedSeeds) if (candidate.similar(index, byId.get(id), threshold).length) fp++;
  rows.push({ threshold, hit3: round(hits / gold.relatedSeeds.length), unrelatedFP: round(fp / gold.unrelatedSeeds.length) });
}
const allowed = rows.filter(row => row.unrelatedFP <= 0.20);
const oracle = allowed.reduce((a, b) => b.hit3 > a.hit3 ? b : a);
// 기준 문단별: 가장 점수가 높은 gold의 순위(같은 문서·복제 제외 전체 후보 중).
const ranks = gold.relatedSeeds.map(seed => {
  const list = candidate.similar(index, byId.get(seed.seed), -1, 1000);
  const rank = list.findIndex(result => seed.related.includes(result.id)) + 1;
  return { seed: seed.seed, type: seed.type, bestGoldRank: rank, candidates: list.length };
});
const result = { note: '사후 서술. 평가 정답을 보고 고른 임계값이므로 성능 추정치가 아니며 판정을 바꾸지 않는다.', grid: rows,
  oracleAtFP020: oracle, bestGoldRank: { top1: ranks.filter(row => row.bestGoldRank === 1).length, top3: ranks.filter(row => row.bestGoldRank <= 3).length,
    top10: ranks.filter(row => row.bestGoldRank <= 10).length, seeds: ranks.length, rows: ranks } };
fs.writeFileSync(path.join(HERE, 'posthoc.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ oracle, ranks: { top1: result.bestGoldRank.top1, top3: result.bestGoldRank.top3, top10: result.bestGoldRank.top10 },
  grid: rows.filter(row => row.threshold * 100 % 5 === 0).map(row => row.threshold + ':' + row.hit3 + '/' + row.unrelatedFP).join(' ') }, null, 1));
