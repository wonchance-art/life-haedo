'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../assets/life/material-writing.js'), C = require('../assets/life/core.js');
const R = require('../assets/life/source-reference.js'), P = require('../assets/life/photo-post.js');
const now = '2026-10-18T22:00:00.000Z';
async function fixture() {
  let bundle = C.createWorkspace();
  const raw = '\ufeff🌱 원문 첫 줄\r\n옛 버전에서 고른 구절🌿\r\n끝';
  const first = await C.prepareImport({ origin: 'obsidian', title: '첫 원문', text: raw, fileName: 'notes/첫.md', url: 'https://example.org/first' }, bundle);
  bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, first));
  const newer = await C.prepareImport({ origin: 'obsidian', title: '첫 원문 현재판', existingSourceId: first.source.id, text: '현재판에는 예전 구절이 없다.' }, bundle);
  bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, newer));
  const second = await C.prepareImport({ origin: 'other', title: '다른 원문', text: '두 번째 자료에서 선택한 문장\n나머지는 비공개', url: 'https://example.org/second' }, bundle);
  bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, second));
  const firstRef = await R.build({ bundle, sourceId: first.source.id, versionId: first.version.id, locator: { start: raw.indexOf('옛'), end: raw.indexOf('\r\n끝') } });
  const secondRef = await R.build({ bundle, sourceId: second.source.id, versionId: second.version.id, locator: { start: 0, end: second.version.contentText.indexOf('\n') } });
  const plan = M.create(C.id, now); plan.title = '자료에서 완성할 글 🌱'; plan.question = 'PRIVATE_QUESTION';
  const a = M.material(bundle, first.source.id, first.version.id, C.id), b = M.material(bundle, second.source.id, second.version.id, C.id);
  a.note = 'PRIVATE_SOURCE_NOTE'; b.note = 'PRIVATE_SECOND_NOTE'; plan.materials = [a, b];
  plan.blocks = [{ id: C.id(), kind: 'heading', text: '첫 소제목\r\n다음 소제목' },
    { id: C.id(), kind: 'paragraph', text: '내가 글에 담은 생각 🌱\r\n둘째 문단' },
    { id: C.id(), kind: 'quote', materialId: b.id, reference: secondRef },
    { id: C.id(), kind: 'paragraph', text: '두 자료를 잇는 내 문장' },
    { id: C.id(), kind: 'quote', materialId: a.id, reference: firstRef }];
  const state = { ...M.empty(bundle.workspaceId), plans: [plan] };
  return { bundle, state, plan, a, b, raw, first, newer, second, firstRef, secondRef };
}
test('ordered heading, thought and adopted quotes project to PhotoPost while private notes and question stay excluded', async () => {
  const f = await fixture(), before = structuredClone(f.state), projected = M.project(f.state, f.plan.id, C.id);
  assert(P.validate(projected.doc)); assert.equal(projected.doc.status, 'draft'); assert.equal(projected.doc.revision, 0); assert.equal(projected.doc.title, f.plan.title);
  assert.deepEqual(projected.refs, [f.secondRef, f.firstRef]);
  const body = P.plainText(projected.doc); let last = -1;
  for (const part of ['첫 소제목', '다음 소제목', '내가 글에 담은 생각', f.secondRef.quote, '두 자료를 잇는', f.firstRef.quote]) { const at = body.indexOf(part); assert(at > last, part); last = at; }
  assert(projected.doc.ops.some(op => op.attributes?.header === 2)); assert(projected.doc.ops.some(op => op.attributes?.blockquote));
  assert(projected.doc.ops.some(op => op.attributes?.link === f.firstRef.url));
  for (const privateValue of [f.plan.question, f.a.note, f.b.note, '현재판에는 예전 구절이 없다.', '나머지는 비공개', f.a.id, f.firstRef.sourceVersionId]) assert(!JSON.stringify(projected.doc).includes(privateValue), privateValue);
  assert.deepEqual(f.state, before);
});
test('material selection and resolution keep the exact old version; missing/mismatched targets never become the latest', async () => {
  const f = await fixture(), before = structuredClone(f.bundle), resolved = M.resolveMaterial(f.bundle, f.a);
  assert.equal(resolved.status, 'available'); assert.equal(resolved.version.id, f.first.version.id); assert.equal(resolved.version.contentText, f.raw);
  resolved.version.contentText = '변경한 사본'; resolved.source.title = '변경한 제목'; assert.deepEqual(f.bundle, before);
  assert.deepEqual(M.resolveMaterial(f.bundle, { ...f.a, contentHash: '0'.repeat(64) }), { status: 'mismatch' });
  assert.deepEqual(M.resolveMaterial(f.bundle, { ...f.a, sourceVersionId: f.second.version.id }), { status: 'mismatch' });
  const missing = structuredClone(f.bundle); missing.sourceVersions = missing.sourceVersions.filter(row => row.id !== f.first.version.id);
  assert.deepEqual(M.resolveMaterial(missing, f.a), { status: 'missing' });
  assert.throws(() => M.material(f.bundle, f.first.source.id, f.second.version.id, C.id), /정확한 원문/);
});
test('link-only materials retain unavailable body metadata and cannot be used as quoted source text', async () => {
  const f = await fixture(), prepared = await C.prepareImport({ origin: 'other', title: '본문 없는 출처', url: 'https://example.org/link-only' }, f.bundle);
  const bundle = C.applyChanges(f.bundle, C.buildImportChanges(f.bundle, prepared)), material = M.material(bundle, prepared.source.id, prepared.version.id, C.id);
  assert.equal(material.contentHash, null); const resolved = M.resolveMaterial(bundle, material); assert.equal(resolved.status, 'available'); assert.equal(resolved.version.contentText, null);
  f.plan.materials.push(material); f.plan.blocks[2].materialId = material.id; assert.throws(() => M.validate(f.state), /자료·정확 버전/);
});
test('quote references require the selected material, workspace, exact version and hash, and cannot silently survive material removal', async () => {
  const f = await fixture();
  const mutations = [value => value.plans[0].materials.pop(), value => { value.plans[0].blocks[2].materialId = C.id(); }, value => { value.plans[0].blocks[2].reference.workspaceId = C.id(); }, value => { value.plans[0].blocks[2].reference.sourceVersionId = f.first.version.id; }, value => { value.plans[0].blocks[2].reference.contentHash = '0'.repeat(64); }, value => { value.plans[0].blocks[2].reference.quote += 'x'; }];
  for (const mutate of mutations) { const value = structuredClone(f.state); mutate(value); assert.throws(() => M.validate(value)); }
});
test('raw CRLF/emoji evidence stays exact while emitted paragraphs use the existing editor newline representation', async () => {
  const f = await fixture();
  f.plan.blocks = [{ id: C.id(), kind: 'paragraph', text: '생각🌱\r\n다음\r끝\n' }, { id: C.id(), kind: 'quote', materialId: f.a.id, reference: f.firstRef }];
  const projected = M.project(f.state, f.plan.id, C.id);
  assert(P.plainText(projected.doc).startsWith('생각🌱\n다음\n끝\n')); assert.equal(projected.refs[0].quote, f.firstRef.quote);
  assert.equal(projected.refs[0].contentHash, f.first.version.contentHash); assert.equal(projected.refs[0].locator.end - projected.refs[0].locator.start, f.firstRef.quote.length);
  assert.deepEqual(await R.resolve(f.bundle, projected.refs[0]), { sourceId: f.first.source.id, sourceVersionId: f.first.version.id, locator: f.firstRef.locator });
  const originalRef = structuredClone(f.firstRef); projected.refs[0].quote = '사본 변경'; projected.doc.ops[0].insert = '편집한 문장\n'; assert.deepEqual(f.firstRef, originalRef);
});
test('adjacent adopted quotes have no automatic thought paragraphs between or after their source labels', async () => {
  const f = await fixture();
  f.plan.blocks = [{ id: C.id(), kind: 'quote', materialId: f.a.id, reference: f.firstRef }, { id: C.id(), kind: 'quote', materialId: f.b.id, reference: f.secondRef }];
  const { doc, refs } = M.project(f.state, f.plan.id, C.id);
  assert.equal(P.plainText(doc), f.firstRef.quote + '\n출처: ' + f.firstRef.title + '\n' + f.firstRef.url + '\n' + f.secondRef.quote + '\n출처: ' + f.secondRef.title + '\n' + f.secondRef.url + '\n');
  assert(!doc.ops.some(op => op.insert === '\n\n'));
  assert.deepEqual(refs, [f.firstRef, f.secondRef]);
});
test('removing automatic thought placeholders preserves explicit paragraph whitespace and raw CRLF evidence lines', async () => {
  const f = await fixture(), ref = await R.build({ bundle: f.bundle, sourceId: f.first.source.id, versionId: f.first.version.id, locator: { start: 0, end: f.raw.length } });
  const whitespace = '\r\n \t\r\n\r\n';
  f.plan.blocks = [{ id: C.id(), kind: 'quote', materialId: f.a.id, reference: ref }, { id: C.id(), kind: 'paragraph', text: whitespace }, { id: C.id(), kind: 'quote', materialId: f.b.id, reference: f.secondRef }];
  const before = structuredClone(f.state), { doc, refs } = M.project(f.state, f.plan.id, C.id);
  assert.equal(P.plainText(doc), f.raw.replace(/\r\n/g, '\n') + '\n출처: ' + ref.title + '\n' + ref.url + '\n' + '\n \t\n\n' + f.secondRef.quote + '\n출처: ' + f.secondRef.title + '\n' + f.secondRef.url + '\n');
  assert(doc.ops.some(op => op.insert === '\n \t\n\n' && !op.attributes));
  assert.equal(doc.ops.filter(op => op.attributes?.blockquote).length, 4);
  assert.equal(refs[0].quote, f.raw); assert.deepEqual(refs[0], ref); assert.deepEqual(f.state, before);
  assert.deepEqual(await R.resolve(f.bundle, refs[0]), { sourceId: f.first.source.id, sourceVersionId: f.first.version.id, locator: ref.locator });
});
test('blank preparation can be saved but cannot create a blank article from only private comparison notes', () => {
  const state = M.empty(C.id()), plan = M.create(C.id, now); plan.question = '아직 글로 쓰지 않은 질문'; state.plans.push(plan);
  assert(M.validate(state)); assert.throws(() => M.project(state, plan.id, C.id), /담을 내용이 없습니다/);
  plan.blocks = [{ id: C.id(), kind: 'heading', text: ' \r\n\t' }, { id: C.id(), kind: 'paragraph', text: '\n \n' }];
  assert(M.validate(state)); assert.throws(() => M.project(state, plan.id, C.id), /담을 내용이 없습니다/);
  plan.blocks[1].text = '실제로 담을 내 문장'; plan.title = ''; assert.equal(M.project(state, plan.id, C.id).doc.title, '');
});
test('strict wrappers, arrays, unique IDs, dates, text and allowed output fields reject injected or ambiguous preparation', async () => {
  const original = (await fixture()).state;
  const mutations = [state => { state.owner = 'hidden'; }, state => { state.plans[0].materials[0].url = 'hidden'; }, state => { state.plans[0].blocks[0].reason = 'hidden'; }, state => { state.plans[0].blocks[0].id = state.plans[0].materials[0].id; }, state => { state.plans[0].blocks[0].text = '\ud800'; }, state => { state.plans[0].question = '\0'; }, state => { state.plans[0].updatedAt = '2026-02-31T00:00:00.000Z'; }, state => { state.plans[0].updatedAt = '2000-01-01T00:00:00.000Z'; }, state => { state.plans[0].output = { postId: C.id(), publication: 'hidden' }; }, state => { state.plans.extra = 'hidden'; }, state => { delete state.plans[0].blocks[1]; }, state => { state.plans[0].blocks[0].kind = 'html'; }, state => { state.plans[0].materials[0].contentHash = 'bad'; }];
  for (const mutate of mutations) { const value = structuredClone(original); mutate(value); assert.throws(() => M.validate(value)); }
  const linked = structuredClone(original); linked.plans[0].output = { postId: C.id() }; assert(M.validate(linked));
  assert.throws(() => M.project(original, C.id(), C.id)); assert.throws(() => M.project(original, original.plans[0].id, () => 'invalid id'));
});
test('preparation/material/block limits fail without trimming or changing the caller data', () => {
  const state = M.empty(C.id());
  for (let i = 0; i < M.LIMITS.plans; i++) state.plans.push(M.create(C.id, now)); assert(M.validate(state));
  state.plans.push(M.create(C.id, now)); assert.throws(() => M.validate(state)); assert.equal(state.plans.length, M.LIMITS.plans + 1);
  const state2 = M.empty(C.id()), plan = M.create(C.id, now); state2.plans.push(plan);
  for (let i = 0; i < M.LIMITS.materials; i++) plan.materials.push({ id: C.id(), sourceId: C.id(), sourceVersionId: C.id(), contentHash: 'a'.repeat(64), note: '' });
  assert(M.validate(state2)); plan.materials.push({ ...plan.materials[0], id: C.id() }); assert.throws(() => M.validate(state2)); plan.materials.pop();
  plan.blocks = Array.from({ length: M.LIMITS.blocks }, () => ({ id: C.id(), kind: 'paragraph', text: '短' })); assert(M.validate(state2));
  plan.blocks.push({ id: C.id(), kind: 'paragraph', text: '넘은 블록' }); assert.throws(() => M.validate(state2));
});
test('64 quote blocks match the existing sidecar cap, including explicit repeat quotations', async () => {
  const f = await fixture();
  f.plan.blocks = Array.from({ length: M.LIMITS.quotes }, () => ({ id: C.id(), kind: 'quote', materialId: f.a.id, reference: structuredClone(f.firstRef) }));
  assert(M.validate(f.state)); assert.equal(M.project(f.state, f.plan.id, C.id).refs.length, 64);
  f.plan.blocks.push({ ...structuredClone(f.plan.blocks[0]), id: C.id() }); const before = structuredClone(f.state);
  assert.throws(() => M.validate(f.state), /64/); assert.deepEqual(f.state, before);
});
test('final PhotoPost text/ops and private wrapper size limits reject excess rather than dropping blocks or notes', () => {
  const state = M.empty(C.id()), plan = M.create(C.id, now); state.plans.push(plan);
  plan.blocks = [{ id: C.id(), kind: 'paragraph', text: 'x'.repeat(P.LIMITS.text - 1) }]; assert(M.validate(state));
  assert.equal(M.project(state, plan.id, C.id).doc.ops[0].insert.length, P.LIMITS.text);
  plan.blocks.push({ id: C.id(), kind: 'paragraph', text: 'more' }); assert.throws(() => M.validate(state), /50,000|본문/); assert.equal(plan.blocks.length, 2);
  plan.blocks = [{ id: C.id(), kind: 'heading', text: 'x\n'.repeat(P.LIMITS.ops) }]; assert.throws(() => M.validate(state), /본문/);
  plan.blocks = [];
  for (let i = 0; i < M.LIMITS.materials; i++) plan.materials.push({ id: C.id(), sourceId: C.id(), sourceVersionId: C.id(), contentHash: null, note: '한'.repeat(M.LIMITS.note) });
  assert.throws(() => M.validate(state), /2 MiB/); assert.equal(plan.materials[0].note.length, M.LIMITS.note);
});
