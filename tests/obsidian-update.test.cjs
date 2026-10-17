'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { zipSync } = require('../vendor/fflate/fflate.js');
const Core = require('../assets/life/core.js'), U = require('../assets/life/obsidian-update.js');
const { pack, entries, updates } = require('./fixtures/obsidian-update.cjs');
const blob = v => new Blob([JSON.stringify(v)]);
async function pair() { return U.compare(await U.read(await pack(entries, 'a')), await U.read(await pack(updates), { next: true })); }
test('selective copy preserves old originals/exact anchors and retains missing paths; changed unselected targets never map to an old body', async () => {
  const comparison = await pair();
  assert.equal(comparison.rows.find(r => r.path === '이후.md').possibleMoves[0], '이전.md');
  const chosen = comparison.rows.filter(r => ['기록.md', '이후.md'].includes(r.path)).map(r => r.id);
  const result = await U.createCopy(comparison, chosen), notes = result.copies[0];
  assert.equal(notes.sources.length, 6); assert.equal(notes.links.filter(l => l.kind === 'obsidian_update').length, 1);
  assert.equal(result.summary.pendingLinks, 1); // selected source links to an unselected changed target
  assert.equal(notes.sources.filter(s => s.sourceKey === '대상.md').length, 1);
  assert.ok(notes.sources.some(s => s.sourceKey === '빠짐.md'));
  assert.equal(notes.sourceVersions.find(v => v.contentText.includes('원본 본문')).contentText, '# 제목\n원본 본문');
  assert.ok(notes.sources.filter(s => s.sourceKey === '기록.md').map(s => s.url).every(url => /\/(a{40}|b{40})\//.test(url)));
  Core.validateWorkspace(notes); await Core.restoreBackup(result.document.backups.notes);
});
test('selected targets retain UTF-16 fragment locations, old references and idempotent repeat comparison', async () => {
  const comparison = await pair(), result = await U.createCopy(comparison, comparison.rows.filter(r => ['added', 'changed'].includes(r.kind)).map(r => r.id));
  const notes = result.copies[0], link = notes.links.filter(l => l.kind === 'obsidian_link').at(-1);
  assert.equal(notes.sourceVersions.find(v => v.id === link.sourceRefs[1].sourceVersionId).contentText.slice(link.sourceRefs[1].locator.start, link.sourceRefs[1].locator.end), '# 제목');
  const restored = await U.read(blob(result.document)), next = await U.read(await pack(updates), { next: true }), repeated = U.compare(restored, next);
  assert.ok(!repeated.rows.some(r => ['changed', 'added'].includes(r.kind)));
  assert.equal(notes.links.filter(l => l.kind === 'obsidian_link').length, 2);
  assert.notEqual(notes.workspaceId, result.document.backups.notes.workspace.workspaceId + '-invalid');
});
test('original excerpts and topics remain exact references in copied snapshot', async () => {
  const previous = await U.read(await pack(entries, 'a')), incoming = await U.read(await pack(updates), { next: true });
  const snapshot = await U.createCopy(U.compare(previous, incoming), ['0']);
  const original = snapshot.document.backups.notes.workspace, version = original.sourceVersions.find(v => v.contentText.includes('한글 원문'));
  original.records.push({ id: Core.id(), kind: 'excerpt', text: version.contentText.slice(0, 6), sourceRefs: [{ sourceId: version.sourceId, sourceVersionId: version.id, locator: { start: 0, end: 6 } }], topic: '익명', note: '태그와 메모 보존', provenance: { kind: 'user' }, revision: 1, createdAt: original.createdAt, updatedAt: original.updatedAt });
  const backup = Core.makeBackup(original), old = await U.read(blob(backup)), next = await U.read(await pack([['기록.md', '세 번째 본문'], ...updates.slice(1)], 'c'), { next: true });
  const comparison = U.compare(old, next), output = await U.createCopy(comparison, comparison.rows.filter(r => r.kind === 'changed').map(r => r.id));
  const excerpt = output.copies[0].records[0], exact = output.copies[0].sourceVersions.find(v => v.id === excerpt.sourceRefs[0].sourceVersionId);
  assert.equal(exact.contentText.slice(0, 6), excerpt.text); assert.equal(excerpt.topic, '익명'); assert.equal(excerpt.note, '태그와 메모 보존');
});
test('tampering, foreign repository, missing/delete selections, and non-ZIP next input fail closed', async () => {
  const comparison = await pair();
  for (const chosen of [[], ['unknown'], [comparison.rows.find(r => r.kind === 'missing').id], ['0', '0']]) await assert.rejects(U.createCopy(comparison, chosen));
  assert.throws(() => U.compare({}, {}));
  const old = await U.read(await pack(entries)), foreign = await U.read(await pack(updates, 'c', 'https://github.com/example/foreign'));
  assert.throws(() => U.compare(old, foreign));
  const result = await U.createCopy(comparison, ['0']); result.document.backups.notes.workspace.sourceVersions[0].contentText += 'tampered';
  await assert.rejects(U.read(blob(result.document))); await assert.rejects(U.read(blob(result.document), { next: true }));
});
test('account scope, retry after failed transaction, duplicate clicks, callback-neutral cached result and cancellation', async () => {
  const comparison = await pair(); let current = true, calls = 0, release;
  assert.throws(() => U.createService({ storage: { installWorkspaces() {} } }));
  const storage = { isAccountScoped: true, account: { projectUrl: 'https://anonymous.invalid', userId: 'anonymous' }, async installWorkspaces(copies) { calls++; if (calls === 1) throw new Error('quota'); await new Promise(resolve => { release = resolve; }); return copies; } };
  const service = U.createService({ storage, isCurrent: () => current }); await service.prepare(comparison, ['0']);
  await assert.rejects(service.install(), /quota/); const pending = service.install(); await assert.rejects(service.install(), /진행 중/); release(); const installed = await pending;
  assert.deepEqual(await service.install(), installed); assert.equal(calls, 2);
  current = false; await assert.rejects(service.install(), /계정/); current = true; service.dispose(); await assert.rejects(service.prepare(comparison, ['0']), /계정/);
});
test('review shows verified originals without allowing caller mutation; cancelled preparation cannot become installable', async () => {
  const comparison = await pair(), detail = U.reviewRow(comparison, '0');
  assert.ok(detail.before.version.contentText.includes('한글 원문')); assert.ok(detail.after.version.contentText.includes('바뀐 한글'));
  detail.before.version.contentText = 'caller changed'; assert.ok(U.reviewRow(comparison, '0').before.version.contentText.includes('한글 원문'));
  const service = U.createService({ storage: { isAccountScoped: true, account: { userId: 'anonymous' }, installWorkspaces() { throw new Error('must not write'); } } });
  const pending = service.prepare(comparison, ['0']); service.cancel(); await assert.rejects(pending, /파일 선택/); await assert.rejects(service.install(), /먼저/);
});
