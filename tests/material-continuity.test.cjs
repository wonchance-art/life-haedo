'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../assets/life/core.js'), M = require('../assets/life/material-writing.js');
const R = require('../assets/life/source-reference.js'), V = require('../assets/life/material-continuity.js');
const now = '2026-10-18T23:00:00.000Z';
async function fixture() {
  let bundle = C.createWorkspace();
  async function add(title, text, extra = {}) {
    const prepared = await C.prepareImport({ origin: 'other', title, text, url: 'https://example.org/' + title, ...extra }, bundle);
    bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, prepared)); return prepared;
  }
  const first = await add('first', '\ufeff원문🌱\r\n정확한 옛 구절🌿\r\n끝');
  const newer = await add('first-new', 'PRIVATE_NEWER_SOURCE', { existingSourceId: first.source.id, url: first.source.url });
  const unquoted = await add('unquoted', '메모만 남긴 자료도 정확한 본문을 보낸다.');
  const extra = await add('extra', '완성글에서 새로 인용한 구절');
  const unused = await add('unused', 'PRIVATE_UNSELECTED_SOURCE');
  const quote = await R.build({ bundle, sourceId: first.source.id, versionId: first.version.id, locator: { start: 1, end: first.version.contentText.length } });
  const savedRef = await R.build({ bundle, sourceId: extra.source.id, versionId: extra.version.id, locator: { start: 0, end: 10 } });
  const plan = M.create(C.id, now); plan.title = '이어 쓸 준비'; plan.question = 'PRIVATE_QUESTION_TO_CONTINUE';
  plan.materials = [M.material(bundle, first.source.id, first.version.id, C.id), M.material(bundle, unquoted.source.id, unquoted.version.id, C.id)];
  plan.materials[1].note = 'PRIVATE_NOTE_TO_CONTINUE';
  plan.blocks = [{ id: C.id(), kind: 'paragraph', text: '내 생각\r\n\n' }, { id: C.id(), kind: 'quote', materialId: plan.materials[0].id, reference: quote }];
  const output = { state: 'saved', postId: C.id(), claimId: C.id(), revision: 3, refs: [savedRef] };
  return { bundle, plan, output, first, newer, unquoted, extra, unused, quote, savedRef };
}
test('one preparation snapshot keeps private work and every selected exact material while excluding unrelated workspace data', async () => {
  const f = await fixture(), before = structuredClone({ bundle: f.bundle, plan: f.plan });
  f.plan.output = { postId: C.id() };
  const payload = V.snapshot(f.bundle, f.plan);
  assert.equal(payload.format, V.FORMAT); assert.equal(payload.plan.output, null); assert.equal(payload.output, null);
  assert.equal(payload.plan.question, f.plan.question); assert.equal(payload.plan.materials[1].note, f.plan.materials[1].note);
  assert.deepEqual(payload.plan.blocks, f.plan.blocks);
  assert.deepEqual(new Set(payload.bundle.sourceVersions.map(row => row.id)), new Set([f.first.version.id, f.unquoted.version.id]));
  for (const key of ['records', 'links', 'resumeHints', 'tombstones']) assert.deepEqual(payload.bundle[key], []);
  assert(!JSON.stringify(payload).includes('PRIVATE_NEWER_SOURCE')); assert(!JSON.stringify(payload).includes('PRIVATE_UNSELECTED_SOURCE'));
  payload.plan.question = '변경한 사본'; payload.bundle.sourceVersions[0].contentText = '변경한 사본';
  assert.deepEqual(f.bundle, before.bundle); assert.equal(f.plan.question, before.plan.question);
});
test('saved output includes its additional exact evidence closure; writing claim contains no local post document or publication', async () => {
  const f = await fixture(), saved = V.snapshot(f.bundle, f.plan, f.output);
  assert.equal(saved.bundle.sourceVersions.length, 3); assert(saved.bundle.sourceVersions.some(row => row.id === f.extra.version.id));
  assert.deepEqual((await V.verify(saved)).output, f.output);
  const writing = V.snapshot(f.bundle, f.plan, { state: 'writing', postId: f.output.postId, claimId: f.output.claimId });
  assert.equal(writing.bundle.sourceVersions.length, 2); assert.deepEqual(Object.keys(writing.output).sort(), ['claimId', 'postId', 'state']);
});
test('verification hashes unquoted material bodies too and rejects raw quote and version substitution', async () => {
  const f = await fixture(), payload = V.snapshot(f.bundle, f.plan, f.output);
  const body = structuredClone(payload); body.bundle.sourceVersions.find(row => row.id === f.unquoted.version.id).contentText += '변조';
  assert(V.validate(body)); await assert.rejects(V.verify(body), /본문과 해시/);
  const quote = structuredClone(payload); quote.plan.blocks[1].reference.quote = 'x'.repeat(quote.plan.blocks[1].reference.quote.length);
  await assert.rejects(V.verify(quote), /원문 근거/);
  const version = structuredClone(payload); version.plan.materials[0].sourceVersionId = f.newer.version.id;
  assert.throws(() => V.validate(version));
  const savedQuote = structuredClone(payload); savedQuote.output.refs[0].quote = 'x'.repeat(savedQuote.output.refs[0].quote.length);
  await assert.rejects(V.verify(savedQuote), /원문 근거/);
});
test('verification owns input before hashing yields and keeps BOM, CRLF, emoji, UTF16 locators and explicit paragraph space', async () => {
  const f = await fixture(), payload = V.snapshot(f.bundle, f.plan), original = structuredClone(payload);
  const pending = V.verify(payload); payload.plan.question = '늦게 바꾼 입력'; payload.bundle.sourceVersions[0].contentText = '늦게 바꾼 본문';
  const verified = await pending; assert.deepEqual(verified, original);
  assert.equal(verified.plan.blocks[1].reference.quote, f.quote.quote); assert(verified.plan.blocks[1].reference.quote.includes('\r\n'));
  assert.equal(verified.plan.blocks[0].text, '내 생각\r\n\n');
  assert.deepEqual(await R.resolve(verified.bundle, verified.plan.blocks[1].reference), { sourceId: f.first.source.id, sourceVersionId: f.first.version.id, locator: f.quote.locator });
});
test('exact closure rejects extra, missing, mismatched and cross-workspace source material', async () => {
  const f = await fixture(), original = V.snapshot(f.bundle, f.plan, f.output);
  const mutations = [p => p.bundle.sourceVersions.pop(), p => { p.bundle.sourceVersions.push(structuredClone(f.unused.version)); p.bundle.sources.push(structuredClone(f.unused.source)); },
    p => { p.bundle.records.push({ id: C.id() }); }, p => { p.output.refs[0].workspaceId = C.id(); }, p => { p.output.refs[0].contentHash = '0'.repeat(64); },
    p => { p.plan.output = { postId: C.id() }; }, p => { p.plan.materials[0].contentHash = null; }];
  for (const mutate of mutations) { const p = structuredClone(original); mutate(p); assert.throws(() => V.validate(p)); }
});
test('strict output and JSON shapes reject forged identifiers, unsupported fields, sparse arrays, accessors and cycles', async () => {
  const f = await fixture(), original = V.snapshot(f.bundle, f.plan, f.output);
  const mutations = [p => { p.format = 'unknown'; }, p => { p.owner = 'hidden'; }, p => { p.output.state = 'draft'; }, p => { p.output.postId = 'non-uuid'; },
    p => { p.output.claimId = ''; }, p => { p.output.revision = 0; }, p => { p.output.refs = Array(1); }, p => { p.output.refs.extra = 'hidden'; },
    p => { p.output.publication = { active: true }; }, p => { p.plan.question = '\ud800'; }, p => { p.bundle.sources[0].url = undefined; }, p => { p.cycle = p; }];
  for (const mutate of mutations) { const p = structuredClone(original); mutate(p); assert.throws(() => V.validate(p)); }
  let invoked = 0; const accessor = structuredClone(original); Object.defineProperty(accessor.plan, 'title', { enumerable: true, get() { invoked++; return ''; } });
  await assert.rejects(V.verify(accessor)); assert.equal(invoked, 0);
});
test('link-only selected material remains explicitly unavailable for quotation and is not fetched', async () => {
  const f = await fixture(), link = await C.prepareImport({ origin: 'other', title: 'link', url: 'https://example.org/link' }, f.bundle);
  f.bundle = C.applyChanges(f.bundle, C.buildImportChanges(f.bundle, link));
  f.plan.materials.push(M.material(f.bundle, link.source.id, link.version.id, C.id));
  const verified = await V.verify(V.snapshot(f.bundle, f.plan));
  const version = verified.bundle.sourceVersions.find(row => row.id === link.version.id); assert.equal(version.contentText, null); assert.equal(version.contentHash, null);
});
test('canonical fingerprints ignore object key/source collection ordering but retain private text, outline order and output revision', async () => {
  const f = await fixture(), original = V.snapshot(f.bundle, f.plan, f.output), expected = await V.fingerprint(original);
  const reverse = value => Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverse(entry)])) : value;
  const reordered = reverse(original); reordered.bundle.sources.reverse(); reordered.bundle.sourceVersions.reverse();
  assert.equal(await V.fingerprint(reordered), expected);
  for (const mutate of [p => { p.plan.question += '수정'; }, p => { p.plan.materials[1].note += '수정'; }, p => { p.plan.blocks.reverse(); }, p => { p.output.revision++; }]) {
    const changed = structuredClone(original); mutate(changed); assert.notEqual(await V.fingerprint(changed), expected);
  }
});
test('remapping and inverse maps round trip canonical identity while output claim IDs, source bytes and private work stay intact', async () => {
  const f = await fixture(), payload = V.snapshot(f.bundle, f.plan, f.output), before = structuredClone(payload), target = C.id();
  const seen = [], { data, mapping } = V.remap(payload, target, oldId => { seen.push(oldId); return C.id(); });
  assert.equal(data.bundle.workspaceId, target); assert.equal(data.plan.output, null); assert.equal(data.output.postId, payload.output.postId); assert.equal(data.output.claimId, payload.output.claimId);
  assert.equal(data.plan.blocks[1].reference.workspaceId, target); assert.equal(data.output.refs[0].workspaceId, target);
  assert.equal(seen.length, payload.bundle.sources.length + payload.bundle.sourceVersions.length + 1 + payload.plan.materials.length + payload.plan.blocks.length);
  assert(!seen.includes(payload.bundle.workspaceId)); assert.deepEqual(mapping.workspaceId, { from: payload.bundle.workspaceId, to: target });
  await V.verify(data);
  const inverse = new Map(); for (const key of ['sourceIds', 'versionIds', 'planIds', 'materialIds', 'blockIds']) for (const [a, b] of Object.entries(mapping[key])) inverse.set(b, a);
  const restored = V.remap(data, payload.bundle.workspaceId, oldId => inverse.get(oldId)).data;
  assert.deepEqual(restored, payload); assert.equal(await V.fingerprint(restored), await V.fingerprint(payload)); assert.deepEqual(payload, before);
  assert.throws(() => V.remap(payload, target, () => target), /중복/);
});
test('existing plan limits and 16MiB UTF8 envelope reject excess without truncating the original selection', async () => {
  const f = await fixture(), tooMany = structuredClone(f.plan);
  tooMany.materials = Array.from({ length: 17 }, () => ({ ...f.plan.materials[0], id: C.id() }));
  assert.throws(() => V.snapshot(f.bundle, tooMany));
  const hash = require('node:crypto').createHash('sha256').update('x'.repeat(C.MAX_IMPORT_BYTES)).digest('hex');
  const plan = M.create(C.id, now), bundle = C.createWorkspace();
  for (let i = 0; i < 16; i++) {
    const source = { ...f.unquoted.source, id: C.id() }, version = { ...f.unquoted.version, id: C.id(), sourceId: source.id, contentText: 'x'.repeat(C.MAX_IMPORT_BYTES), contentHash: hash };
    bundle.sources.push(source); bundle.sourceVersions.push(version);
    plan.materials.push({ id: C.id(), sourceId: source.id, sourceVersionId: version.id, contentHash: hash, note: '' });
  }
  assert.throws(() => V.snapshot(bundle, plan), /16 MiB/); assert.equal(bundle.sourceVersions.length, 16); assert.equal(plan.materials.length, 16);
  const p = V.snapshot(f.bundle, f.plan, f.output); p.output.refs = Array.from({ length: 65 }, () => structuredClone(f.savedRef)); assert.throws(() => V.validate(p), /근거/);
});
test('edited selected versions carry only immutable markers, omit their base body, and remap marker identities', async () => {
  const f = await fixture(), mark = versionId => ({ id: C.id(), kind: 'source_edited_copy',
    entityRefs: [{ entityType: 'sourceVersion', entityId: versionId }], revision: 1, createdAt: now, updatedAt: now });
  const edited = mark(f.newer.version.id), unrelated = mark(f.unused.version.id);
  f.bundle.links.push(edited, unrelated, { ...mark(f.newer.version.id), kind: 'source_edit_base',
    entityRefs: [{ entityType: 'sourceVersion', entityId: f.first.version.id }, { entityType: 'sourceVersion', entityId: f.newer.version.id }] });
  const plan = M.create(C.id, now); plan.materials = [M.material(f.bundle, f.first.source.id, f.newer.version.id, C.id)];
  const payload = await V.verify(V.snapshot(f.bundle, plan));
  assert.deepEqual(payload.bundle.links, [edited]);
  assert.deepEqual(payload.bundle.sourceVersions.map(v => v.id), [f.newer.version.id]);
  assert(!JSON.stringify(payload).includes(f.first.version.contentText));
  assert(!JSON.stringify(payload).includes('source_edit_base')); assert(!JSON.stringify(payload).includes(unrelated.id));
  const mapped = V.remap(payload, C.id());
  assert.notEqual(mapped.data.bundle.links[0].id, edited.id);
  assert.equal(mapped.mapping.linkIds[edited.id], mapped.data.bundle.links[0].id);
  assert.equal(mapped.data.bundle.links[0].entityRefs[0].entityId, mapped.mapping.versionIds[f.newer.version.id]);
  assert.equal(C.isEditedCopy(mapped.data.bundle, mapped.data.bundle.sourceVersions[0].id), true);
  const inverse = new Map(); for (const key of ['sourceIds', 'versionIds', 'linkIds', 'planIds', 'materialIds', 'blockIds']) for (const [a, b] of Object.entries(mapped.mapping[key])) inverse.set(b, a);
  assert.deepEqual(V.remap(mapped.data, payload.bundle.workspaceId, old => inverse.get(old)).data, payload);
  const polluted = structuredClone(payload); polluted.bundle.links.push({ id: C.id(), kind: 'private_link', entityRefs: [{ entityType: 'sourceVersion', entityId: f.newer.version.id }] });
  assert.throws(() => V.validate(polluted), /표식/);
  const two = structuredClone(payload), extra = structuredClone(f.unquoted.version), source = structuredClone(f.unquoted.source);
  two.bundle.sources.push(source); two.bundle.sourceVersions.push(extra); two.plan.materials.push(M.material(f.bundle, source.id, extra.id, C.id));
  two.bundle.links.push(mark(extra.id)); const expected = await V.fingerprint(two); two.bundle.links.reverse();
  assert.equal(await V.fingerprint(two), expected);
});
