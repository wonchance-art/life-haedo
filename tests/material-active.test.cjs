'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../assets/life/core.js'), Search = require('../assets/life/unified-search.js');
const Rediscovery = require('../assets/life/rediscovery.js'), Material = require('../assets/life/material-writing.js');
const References = require('../assets/life/source-reference.js');

async function fixture() {
  let bundle = C.createWorkspace(); const entries = [];
  for (const [title, text] of [['기준 자료', '\ufeff정원 산책 🌱\r\n옛 정확 구절'], ['함께 읽을 자료', '정원 산책과 관찰']]) {
    const prepared = await C.prepareImport({ origin: 'obsidian', title, text, format: 'text/markdown', forceSeparate: true }, bundle);
    bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, prepared,
      [{ start: text.indexOf('정원'), end: text.indexOf('정원') + 2, topic: '메모로만 찾는 표식', note: '검색 전용 메모' }]));
    entries.push(prepared);
  }
  return { bundle, entries };
}
const state = (bundle, id, status) => C.applyChanges(bundle, C.buildSourceStateChanges(bundle, id, status));

test('trash excludes memo-only source hits without hiding a saved page, and restore returns the same exact versions', async () => {
  const { bundle, entries } = await fixture(), before = structuredClone(bundle);
  const workbench = { page: { posts: [{ id: 'saved', status: 'saved', visibility: 'private', body: '메모로만 찾는 표식', attachments: [] }], entries: [] } };
  const trashed = state(bundle, entries[0].source.id, 'trash');
  const hits = Search.search({ bundle: trashed, workbench }, '메모로만 찾는 표식');
  assert.deepEqual(hits.map(hit => hit.kind), ['source', 'page']);
  assert.equal(hits[0].sourceId, entries[1].source.id);
  assert(!Search.search({ bundle: trashed }, '기준 자료').length);
  const restored = state(trashed, entries[0].source.id, 'active');
  assert.deepEqual(Search.search({ bundle: restored }, '메모로만 찾는 표식').map(hit => hit.sourceVersionId), entries.map(row => row.version.id));
  assert.deepEqual(restored.sources, before.sources);
  assert.deepEqual(restored.sourceVersions, before.sourceVersions);
  assert.deepEqual(restored.records, before.records);
  assert.deepEqual(bundle, before);
});

test('trash removes a rediscovery candidate while keeping exact historical references resolvable', async () => {
  const { bundle, entries } = await fixture(), workbench = { workspaceId: bundle.workspaceId, groups: [] };
  const ref = await References.build({ bundle, sourceId: entries[1].source.id, versionId: entries[1].version.id, locator: { start: 0, end: 5 } });
  assert.equal(Rediscovery.related(bundle, workbench, entries[0].version.id).length, 1);
  const trashed = state(bundle, entries[1].source.id, 'trash');
  assert.deepEqual(Rediscovery.related(trashed, workbench, entries[0].version.id), []);
  const exact = await References.resolve(trashed, ref);
  assert.equal(exact.sourceVersionId, entries[1].version.id);
  assert.deepEqual(exact.locator, ref.locator);
  assert.equal(trashed.sourceVersions.find(version => version.id === exact.sourceVersionId).contentText.slice(exact.locator.start, exact.locator.end), ref.quote);
  assert.equal(Rediscovery.related(state(trashed, entries[1].source.id, 'active'), workbench, entries[0].version.id)[0].versionId, entries[1].version.id);
});

test('new material selection requires restore but an existing preparation retains its exact source', async () => {
  const { bundle, entries } = await fixture();
  const selected = Material.material(bundle, entries[0].source.id, entries[0].version.id, C.id);
  const trashed = state(bundle, entries[0].source.id, 'trash');
  assert.throws(() => Material.material(trashed, entries[0].source.id, entries[0].version.id, C.id), /휴지통/);
  const resolved = Material.resolveMaterial(trashed, selected);
  assert.equal(resolved.status, 'available');
  assert.equal(resolved.version.id, entries[0].version.id);
  assert.equal(resolved.version.contentText, entries[0].version.contentText);
  assert.equal(Material.material(state(trashed, entries[0].source.id, 'active'), entries[0].source.id, entries[0].version.id, C.id).sourceId, entries[0].source.id);
});
