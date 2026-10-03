const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const fs = require('node:fs');
const core = require('../assets/life/core.js');

const copy = value => structuredClone(value);
const input = overrides => ({ origin: 'obsidian', title: '익명 자료', text: '첫 문장\r\n🌱 다시 읽을 구절\r\n마지막 문장', ...overrides });
const errorCode = code => error => { assert.equal(error.code, code); return true; };
async function stored(value = input(), excerpts = []) {
  const before = core.createWorkspace();
  const prepared = await core.prepareImport(value, before);
  const changes = core.buildImportChanges(before, prepared, excerpts);
  return { bundle: core.applyChanges(before, changes), prepared, value };
}

test('browser IIFE and CommonJS expose the same contract without external dependencies', () => {
  const context = vm.createContext({ crypto: crypto.webcrypto, TextEncoder, URL, Date, console });
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/core.js'), 'utf8'), context);
  assert.equal(typeof context.HaedoLife.Core.restoreBackup, 'function');
  assert.equal(typeof context.HaedoLife.Core.buildImportChanges, 'function');
  assert.equal(context.HaedoLife.Core.createWorkspace().revision, 0);
  assert.match(core.id(), /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(core.validateWorkspace(core.createWorkspace()), true);
});

test('import preserves CRLF, whitespace, composed/decomposed characters and hashes original UTF-8', async () => {
  const value = input({ text: '  원문\r\n🌱 e\u0301 é\n마지막\r\n ' });
  const before = copy(value);
  const workspace = core.createWorkspace();
  const original = copy(workspace);
  const prepared = await core.prepareImport(value, workspace);
  assert.deepEqual(value, before); assert.deepEqual(workspace, original);
  assert.equal(prepared.version.contentText, value.text);
  assert.equal(prepared.version.contentHash, crypto.createHash('sha256').update(value.text, 'utf8').digest('hex'));
  assert.equal(prepared.version.coverage.status, 'unknown');
  assert.deepEqual(prepared.version.originalAuthor, { label: '', relation: 'unknown' });
  assert.equal(prepared.version.originalCreatedAt, null);
});

test('known partial coverage, original author and original date are preserved apart from import time', async () => {
  const value = input({ author: '자료 작성자', authorRelation: 'other', originalCreatedAt: '2020-봄', coverage: { status: 'partial', omissions: ['이미지', '앞뒤 문맥'] } });
  const { bundle } = await stored(value);
  const version = bundle.sourceVersions[0];
  assert.deepEqual(version.coverage, value.coverage);
  assert.equal(version.originalCreatedAt, '2020-봄');
  assert.equal(version.originalAuthor.relation, 'other');
  assert.notEqual(version.originalCreatedAt, version.importedAt);
});

test('async import owns its input metadata and text before hashing yields', async () => {
  const value = input({ coverage: { status: 'partial', omissions: ['이미지'] }, author: '원 작성자', authorRelation: 'other' });
  const promise = core.prepareImport(value, core.createWorkspace());
  value.text = '검토 중 바뀐 본문'; value.coverage.status = 'full_text'; value.coverage.omissions.push('동시에 바뀐 항목');
  value.author = '새 작성자'; value.existingSourceId = 'missing';
  const prepared = await promise;
  assert.equal(prepared.version.contentText, input().text);
  assert.equal(prepared.version.contentHash, crypto.createHash('sha256').update(input().text).digest('hex'));
  assert.deepEqual(prepared.version.coverage, { status: 'partial', omissions: ['이미지'] });
  assert.deepEqual(prepared.version.originalAuthor, { label: '원 작성자', relation: 'other' });
  assert.equal(prepared.match.kind, 'new');
  await assert.rejects(core.prepareImport(input({ author: () => '지원하지 않는 값' }), core.createWorkspace()), errorCode('invalid_metadata'));
  await assert.rejects(core.prepareImport(input({ originalCreatedAt: new Date() }), core.createWorkspace()), errorCode('invalid_metadata'));
});

test('link-only input has no text/hash, cannot produce excerpts and keeps the original URL', async () => {
  const { bundle, prepared } = await stored(input({ text: '', url: 'https://example.org/post?tag=a#part', format: 'text/markdown' }));
  assert.equal(prepared.version.format, 'text/plain');
  assert.equal(prepared.version.contentText, null); assert.equal(prepared.version.contentHash, null);
  assert.equal(prepared.version.coverage.status, 'link_only');
  assert.equal(bundle.sources[0].url, 'https://example.org/post?tag=a#part');
  assert.throws(() => core.buildImportChanges(bundle, prepared, [{ start: 0, end: 1 }]), errorCode('invalid_locator'));
  await assert.rejects(core.prepareImport(input({ text: null, url: 'https://example.org', coverage: 'full_text' }), core.createWorkspace()), errorCode('invalid_coverage'));
  await assert.rejects(core.prepareImport(input({ text: '본문', coverage: 'link_only' }), core.createWorkspace()), errorCode('invalid_coverage'));
});

test('dangerous URL schemes, credentials and protocol disguises fail import, validation and backup restore', async () => {
  const { bundle } = await stored(input({ url: 'https://example.org' }));
  const dangerous = ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///tmp/a', 'blob:https://example.org/a', '//example.org', 'https://user:password@example.org', 'https:\\example.org', 'https://example.org/\npath', 'https://example.org/\tpath'];
  for (const url of dangerous) {
    await assert.rejects(core.prepareImport(input({ url }), core.createWorkspace()), errorCode('unsafe_url'));
    const bad = copy(bundle); bad.sources[0].url = url;
    assert.throws(() => core.validateWorkspace(bad), errorCode('unsafe_url'));
    const backup = core.makeBackup(bundle); backup.workspace.sources[0].url = url;
    await assert.rejects(core.restoreBackup(backup), errorCode('unsafe_url'));
  }
});

test('unsupported files, invalid text/encoding and oversized UTF-8 fail without truncating the input', async () => {
  const workspace = core.createWorkspace();
  await assert.rejects(core.prepareImport(input({ fileName: 'sample.pdf' }), workspace), errorCode('unsupported_format'));
  await assert.rejects(core.prepareImport(input({ format: 'text/html' }), workspace), errorCode('unsupported_format'));
  await assert.rejects(core.prepareImport(input({ text: '\ud800' }), workspace), errorCode('invalid_encoding'));
  await assert.rejects(core.prepareImport(input({ text: '\udc00' }), workspace), errorCode('invalid_encoding'));
  await assert.rejects(core.prepareImport(input({ text: '본문\0binary' }), workspace), errorCode('invalid_encoding'));
  await assert.rejects(core.prepareImport(input({ text: 5 }), workspace), errorCode('invalid_text'));
  await assert.rejects(core.prepareImport(input({ text: '' }), workspace), errorCode('missing_text'));
  const text = '한'.repeat(Math.floor(core.MAX_IMPORT_BYTES / 3) + 1);
  const value = input({ text });
  await assert.rejects(core.prepareImport(value, workspace), errorCode('text_too_large'));
  assert.equal(value.text, text);
  const md = await core.prepareImport(input({ fileName: 'NOTE.MD' }), workspace);
  assert.equal(md.version.format, 'text/markdown');
});

test('same content in another or unconfirmed source remains a candidate and never merges automatically', async () => {
  const { bundle } = await stored(input({ url: 'https://example.org/a' }));
  const first = bundle.sources[0].id;
  for (const value of [input({ url: 'https://example.org/a' }), input({ origin: 'apple_notes' }), input({ origin: 'instagram', text: '', url: 'https://example.org/a' })]) {
    const prepared = await core.prepareImport(value, bundle);
    assert.equal(prepared.match.kind, 'overlap');
    assert.equal(prepared.match.sourceId, first);
    assert.notEqual(prepared.source.id, first);
    const result = core.applyChanges(bundle, core.buildImportChanges(bundle, prepared));
    assert.equal(result.sources.length, 2);
    assert.equal(result.sourceVersions.length, 2);
    assert.deepEqual(result.sourceVersions[0], bundle.sourceVersions[0]);
  }
  const separate = await core.prepareImport(input({ forceSeparate: true }), bundle);
  assert.equal(separate.match.kind, 'new'); assert.notEqual(separate.source.id, first);
  await assert.rejects(core.prepareImport(input({ forceSeparate: true, existingSourceId: first }), bundle), errorCode('source_identity_mismatch'));
});

test('explicit source selection reuses exact metadata but creates immutable versions for changed metadata/body', async () => {
  const { bundle, value } = await stored(input({ coverage: 'full_text' }));
  const original = copy(bundle);
  const existingSourceId = bundle.sources[0].id;
  const same = await core.prepareImport({ ...value, existingSourceId }, bundle);
  assert.equal(same.match.kind, 'exact_duplicate');
  assert.equal(same.version.id, bundle.sourceVersions[0].id);
  assert.equal(core.buildImportChanges(bundle, same).put.sourceVersions.length, 0);
  for (const changed of [{ text: value.text + '\n추가' }, { author: '다른 작성자' }, { authorRelation: 'self' }, { originalCreatedAt: '2019' }, { coverage: { status: 'partial', omissions: ['앞뒤 문맥'] } }, { format: 'text/markdown' }, { title: '다른 제목' }]) {
    const prepared = await core.prepareImport({ ...value, ...changed, existingSourceId }, bundle);
    assert.equal(prepared.match.kind, 'new_revision');
    assert.equal(prepared.source.id, existingSourceId); assert.notEqual(prepared.version.id, bundle.sourceVersions[0].id);
    const result = core.applyChanges(bundle, core.buildImportChanges(bundle, prepared));
    assert.equal(result.sourceVersions.length, 2);
    assert.deepEqual(result.sourceVersions[0], original.sourceVersions[0]);
  }
  assert.deepEqual(bundle, original);
  await assert.rejects(core.prepareImport({ ...value, origin: 'apple_notes', existingSourceId }, bundle), errorCode('source_identity_mismatch'));
  await assert.rejects(core.prepareImport({ ...value, existingSourceId: 'missing' }, bundle), errorCode('missing_reference'));
});

test('link-only sources can gain a body as a new version after explicit user selection', async () => {
  const value = input({ text: '', url: 'https://example.org' });
  const { bundle } = await stored(value);
  const prepared = await core.prepareImport({ ...value, text: '새로 제공한 선택 본문', coverage: 'partial', existingSourceId: bundle.sources[0].id }, bundle);
  assert.equal(prepared.match.kind, 'new_revision');
  const result = core.applyChanges(bundle, core.buildImportChanges(bundle, prepared));
  assert.equal(result.sourceVersions[0].contentText, null);
  assert.equal(result.sourceVersions[1].contentText, '새로 제공한 선택 본문');
});

test('excerpt locators use raw UTF-16 and distinguish emoji, CRLF and repeated phrases', async () => {
  const value = input({ text: '🌱 같은 문장\r\n🌱 같은 문장\r\n끝' });
  const workspace = core.createWorkspace(), prepared = await core.prepareImport(value, workspace);
  const second = value.text.indexOf('🌱', 2), end = value.text.indexOf('\r', second);
  const result = core.applyChanges(workspace, core.buildImportChanges(workspace, prepared, [{ start: second, end, topic: '질문', note: '보완' }]));
  assert.equal(result.records[0].text, '🌱 같은 문장');
  assert.equal(result.records[0].sourceRefs[0].locator.start, second);
  assert.equal(result.sourceVersions[0].contentText, value.text);
  for (const location of [{ start: 0, end: 1 }, { start: 1, end: 4 }, { start: -1, end: 2 }, { start: 0, end: 999 }, { start: 0.5, end: 2 }, { start: 2, end: 2 }]) {
    assert.throws(() => core.buildImportChanges(workspace, prepared, [location]), errorCode('invalid_locator'));
  }
  const wrong = copy(result); wrong.records[0].text += '!';
  assert.throws(() => core.validateWorkspace(wrong), errorCode('quote_mismatch'));
});

test('repeated excerpt/topic is deduplicated while a different topic remains an explicit new record', async () => {
  const value = input(), selection = { start: 0, end: 3, topic: '생활', note: '메모' };
  const { bundle } = await stored(value, [selection, selection]);
  assert.equal(bundle.records.length, 1);
  const prepared = await core.prepareImport({ ...value, existingSourceId: bundle.sources[0].id }, bundle);
  const same = core.buildImportChanges(bundle, prepared, [selection]);
  assert.equal(same.put.records.length, 0);
  const different = core.buildImportChanges(bundle, prepared, [{ ...selection, topic: '창작' }]);
  assert.equal(different.put.records.length, 1);
  assert.throws(() => core.buildImportChanges(bundle, prepared, [{ ...selection, note: '다른 메모' }]), errorCode('duplicate_excerpt'));
});

test('apply is immutable and rejects source-version overwrite, source deletion and dangling references', async () => {
  const { bundle } = await stored(input(), [{ start: 0, end: 3, topic: '생활' }]);
  const before = copy(bundle);
  const edited = { ...bundle.sourceVersions[0], coverage: { status: 'partial', omissions: ['누락'] }, revision: 2 };
  assert.throws(() => core.applyChanges(bundle, { put: { sourceVersions: [edited] } }), errorCode('immutable_source_version'));
  assert.throws(() => core.applyChanges(bundle, { remove: { sources: [bundle.sources[0].id] } }), errorCode('unsupported_field'));
  const changedRecord = copy(bundle.records[0]); changedRecord.revision += 1; changedRecord.sourceRefs[0].sourceVersionId = 'missing';
  assert.throws(() => core.applyChanges(bundle, { put: { records: [changedRecord] } }), errorCode('missing_reference'));
  const changedSource = { ...bundle.sources[0], url: 'javascript:alert(1)', revision: 2 };
  assert.throws(() => core.applyChanges(bundle, { put: { sources: [changedSource] } }), errorCode('source_identity_mismatch'));
  const result = core.applyChanges(bundle, { put: {} });
  assert.equal(result.revision, bundle.revision + 1); assert.notEqual(result, bundle);
  assert.deepEqual(bundle, before);
});

test('excerpt deletion preserves originals, removes dependent connections and prevents resurrection', async () => {
  let { bundle } = await stored(input(), [{ start: 0, end: 3 }]);
  const record = bundle.records[0], source = bundle.sources[0], version = bundle.sourceVersions[0];
  bundle = core.applyChanges(bundle, { put: {
    links: [{ id: core.id(), entityRefs: [{ entityType: 'record', entityId: record.id }, { entityType: 'source', entityId: source.id }] }],
    resumeHints: [{ id: core.id(), recordId: record.id, sourceVersionId: version.id, locator: { start: 0, end: 3 } }]
  } });
  const result = core.applyChanges(bundle, { remove: { records: [record.id] } });
  assert.equal(result.records.length, 0); assert.equal(result.sources.length, 1); assert.equal(result.sourceVersions.length, 1);
  assert.equal(result.links.length, 0); assert.equal(result.resumeHints.length, 0);
  assert.equal(result.tombstones[0].entityId, record.id);
  assert.throws(() => core.applyChanges(result, { put: { records: [record] } }), errorCode('deleted_record'));
  assert.equal(core.applyChanges(result, { remove: { records: [record.id] } }).tombstones.length, 1);
});

test('backup is detached, declares excluded staging and restores all IDs/references into a new copy', async () => {
  let { bundle } = await stored(input({ coverage: 'partial', omissions: ['이미지'] }), [{ start: 0, end: 3 }]);
  const source = bundle.sources[0], version = bundle.sourceVersions[0], record = bundle.records[0];
  bundle = core.applyChanges(bundle, { put: {
    links: [{ id: core.id(), sourceRefs: copy(record.sourceRefs), entityRefs: [{ entityType: 'record', entityId: record.id, revision: 1 }, { entityType: 'sourceVersion', entityId: version.id }] }],
    resumeHints: [{ id: core.id(), sourceId: source.id, sourceVersionId: version.id, recordId: record.id, locator: { start: 0, end: 3 } }]
  } });
  const original = copy(bundle), backup = core.makeBackup(bundle), backupBefore = copy(backup);
  assert.equal(backup.manifest.stagingIncluded, false);
  assert.equal(backup.manifest.counts.sourceVersions, 1);
  assert.equal(backup.manifest.sourceVersions[0].utf8Bytes, Buffer.byteLength(version.contentText, 'utf8'));
  const restored = await core.restoreBackup(JSON.stringify(backup));
  assert.notEqual(restored.workspaceId, bundle.workspaceId); assert.equal(restored.revision, 0);
  for (const name of ['sources', 'sourceVersions', 'records', 'links', 'resumeHints']) assert.notEqual(restored[name][0].id, bundle[name][0].id);
  assert.equal(restored.sourceVersions[0].sourceId, restored.sources[0].id);
  assert.equal(restored.records[0].sourceRefs[0].sourceVersionId, restored.sourceVersions[0].id);
  assert.equal(restored.records[0].sourceRefs[0].sourceId, restored.sources[0].id);
  assert.equal(restored.links[0].entityRefs[0].entityId, restored.records[0].id);
  assert.equal(restored.links[0].entityRefs[1].entityId, restored.sourceVersions[0].id);
  assert.equal(restored.links[0].sourceRefs[0].sourceVersionId, restored.sourceVersions[0].id);
  assert.equal(restored.resumeHints[0].recordId, restored.records[0].id);
  assert.equal(restored.resumeHints[0].sourceVersionId, restored.sourceVersions[0].id);
  assert.equal(restored.sourceVersions[0].contentText, version.contentText);
  assert.deepEqual(bundle, original); assert.deepEqual(backup, backupBefore);
  backup.workspace.records[0].note = '사본만 변경';
  assert.notEqual(bundle.records[0].note, backup.workspace.records[0].note);
  assert.equal(core.validateWorkspace(restored), true);
});

test('restoring deleted records remaps tombstone targets without reviving them', async () => {
  const { bundle } = await stored(input(), [{ start: 0, end: 3 }]);
  const deleted = core.applyChanges(bundle, { remove: { records: [bundle.records[0].id] } });
  const restored = await core.restoreBackup(core.makeBackup(deleted));
  assert.equal(restored.records.length, 0);
  assert.notEqual(restored.tombstones[0].id, deleted.tombstones[0].id);
  assert.notEqual(restored.tombstones[0].entityId, deleted.tombstones[0].entityId);
});

test('backup restoration rejects invalid schema, changed hashes, broken references/locators and extra account fields', async () => {
  const { bundle } = await stored(input(), [{ start: 0, end: 3 }]);
  const backup = core.makeBackup(bundle), before = copy(backup);
  await assert.rejects(core.restoreBackup('{bad'), errorCode('invalid_backup'));
  for (const [edit, code] of [
    [data => { data.schemaVersion = 2; }, 'unsupported_backup'],
    [data => { data.manifest.counts.sources = 3; }, 'manifest_mismatch'],
    [data => { data.workspace.sourceVersions[0].contentHash = 'bad'; }, 'invalid_hash'],
    [data => { data.workspace.sourceVersions[0].sourceId = 'missing'; }, 'missing_reference'],
    [data => { data.workspace.records[0].sourceRefs[0].locator.end = 999; }, 'invalid_locator'],
    [data => { data.workspace.records[0].text = '원문과 다름'; }, 'quote_mismatch'],
    [data => { data.workspace.accountBinding = { token: 'anonymous-example' }; }, 'unsupported_field'],
    [data => { data.workspace.sources[0].id = data.workspace.records[0].id; }, 'duplicate_id']
  ]) {
    const bad = copy(backup); edit(bad);
    await assert.rejects(core.restoreBackup(bad), errorCode(code));
  }
  const tamperedWorkspace = copy(bundle);
  tamperedWorkspace.sourceVersions[0].contentText += '추가';
  const badHash = core.makeBackup(tamperedWorkspace);
  await assert.rejects(core.restoreBackup(badHash), errorCode('hash_mismatch'));
  assert.deepEqual(backup, before);
});

test('async restoration owns its snapshot rather than hashing data that the caller can replace midway', async () => {
  const { bundle } = await stored();
  const backup = core.makeBackup(bundle);
  const promise = core.restoreBackup(backup);
  backup.workspace.sourceVersions[0].contentText = '검증 중 외부 변경';
  const result = await promise;
  assert.equal(result.sourceVersions[0].contentText, bundle.sourceVersions[0].contentText);
});

test('reading Markdown preserves text and provenance inside fences that contain HTML/images and nested fences', async () => {
  const text = '<script>alert(1)</script>\n![remote](https://example.org/image.png)\n```\n# 제목\n````\n끝';
  const { bundle } = await stored(input({ text, title: '제목\n![image](https://example.org/title.png)', format: 'text/markdown', url: 'https://example.org/source', coverage: 'partial', omissions: ['댓글'] }), [{ start: 0, end: 25, topic: '주제\n# 제목', note: '<img src=x onerror=alert(1)>' }]);
  const before = copy(bundle), result = core.toMarkdown(bundle);
  assert.ok(result.includes(text));
  assert.ok(result.includes('https://example.org/source')); assert.ok(result.includes('UTF-16 [0, 25)'));
  assert.ok(result.includes('확보 범위: partial')); assert.ok(result.includes('누락: 댓글'));
  assert.ok(result.includes('복원은 JSON 백업'));
  let open = null;
  for (const line of result.split('\n')) {
    if (!open && /^`{3,}text$/.test(line)) { open = line.slice(0, -4); continue; }
    if (open && line === open) { open = null; continue; }
    if (/<script|<img|!\[|^```$|^````$/.test(line)) assert.ok(open, 'untrusted input must be inside a text fence');
  }
  assert.equal(open, null); assert.deepEqual(bundle, before);
});

test('reading export handles many short backtick runs without an argument-stack overflow', async () => {
  const { bundle } = await stored(input({ text: '`x'.repeat(150000) }));
  assert.doesNotThrow(() => core.toMarkdown(bundle));
});
