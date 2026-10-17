// Anonymous, valid content with one exact excerpt per source. No stored user data.
const core = require('../../assets/life/core.js');
async function fixture(count) {
  const bundle = core.createWorkspace();
  const text = '익명의 일상 기록🌱\n' + '산책하며 지나온 시간과 관심의 변화를 차분히 돌아본다. '.repeat(50);
  const prepared = await core.prepareImport({ origin: 'obsidian', title: '시간과 취향', text, authorRelation: 'self' }, bundle);
  for (let i = 0; i < count; i++) {
    const source = { ...prepared.source, id: 's' + i }, version = { ...prepared.version, id: 'v' + i, sourceId: source.id };
    bundle.sources.push(source); bundle.sourceVersions.push(version);
    bundle.records.push({ id: 'r' + i, kind: 'excerpt', text: '익명', topic: '', note: '기억표식', sourceRefs: [{ sourceId: source.id, sourceVersionId: version.id, locator: { start: 0, end: 2 } }], provenance: { kind: 'user' }, revision: 1, createdAt: bundle.createdAt, updatedAt: bundle.updatedAt });
  }
  core.validateWorkspace(bundle);
  return { bundle };
}
module.exports = { fixture };
