'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Receipt = require('../assets/life/naver-media-receipt.js'), Core = require('../assets/life/core.js');
const F = require('./fixtures/naver-media.cjs');
const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', CAPTURE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const fixture = () => ({ workspaceId: WS, sourceId: 'source_1', sourceVersionId: 'version-2', captureId: CAPTURE, captureHash: 'a'.repeat(64) });
const fail = { code: 'invalid_naver_media_receipt' };
test('receipt keeps only exact primitive identities and returns an independent canonical copy', () => {
  const value = fixture(), before = structuredClone(value), result = Receipt.validate(value);
  assert.deepEqual(result, value); assert.notEqual(result, value); result.captureHash = '0'.repeat(64); assert.deepEqual(value, before);
  const nullPrototype = Object.assign(Object.create(null), value);
  assert.deepEqual(Receipt.validate(nullPrototype), value);
});
test('strict fields reject private payloads, missing fields, symbols, accessors and invalid identities without invoking getters', () => {
  for (const mutate of [
    v => { v.ownerId = WS; }, v => { v.photos = []; }, v => { delete v.sourceId; }, v => { v.workspaceId = 'workspace'; },
    v => { v.captureId = 'capture'; }, v => { v.sourceId = ''; }, v => { v.sourceVersionId = 'a'.repeat(129); },
    v => { v.sourceId = '경로/노트'; }, v => { v.captureHash = 'A'.repeat(64); }, v => { v.captureHash = 'a'.repeat(63); },
    v => { v.captureHash = null; }, v => { v[Symbol('hidden')] = 1; }, v => { Object.setPrototypeOf(v, { extra: true }); },
    v => { Object.defineProperty(v, 'sourceId', { enumerable: true, get() { assert.fail('getter must not execute'); } }); },
    v => { Object.defineProperty(v, 'sourceId', { enumerable: false, value: 'source' }); }
  ]) { const value = fixture(); mutate(value); assert.throws(() => Receipt.validate(value), fail); }
  for (const value of [null, [], 'receipt', 1]) assert.throws(() => Receipt.validate(value), fail);
});
test('attachment projection requires normalized server media and exact capture identity without copying bytes or owner', () => {
  const value = fixture(), attachment = { sourceId: value.sourceId, sourceVersionId: value.sourceVersionId, localOnly: false,
    capture: { id: CAPTURE, capture_hash: value.captureHash, owner_id: WS, payload: { private: true } }, photos: [] };
  const before = structuredClone(attachment), result = Receipt.fromAttachment(WS, attachment);
  assert.deepEqual(result, value); assert.deepEqual(attachment, before); assert.equal(Receipt.checkAttachment(result, attachment), true);
  for (const mutate of [
    v => { v.localOnly = true; }, v => { delete v.localOnly; }, v => { v.capture.id = WS; },
    v => { v.capture.capture_hash = '0'.repeat(64); }, v => { v.sourceId = 'another'; }, v => { v.sourceVersionId = 'another'; },
    v => { Object.defineProperty(v, 'capture', { enumerable: true, get() { assert.fail('getter must not execute'); } }); }
  ]) { const bad = structuredClone(attachment); mutate(bad); assert.throws(() => Receipt.checkAttachment(result, bad), fail); }
});
test('target verification preserves the exact Core source and historical version and never substitutes another Naver source', async () => {
  const data = await F.fixture(Core.createWorkspace({ workspaceId: WS }));
  const bundle = Core.applyChanges(data.bundle, data.changes), attachment = { ...data.attachment, localOnly: false };
  const receipt = Receipt.fromAttachment(bundle.workspaceId, attachment), before = structuredClone(bundle);
  assert.equal(Receipt.checkTarget(bundle, receipt), true); assert.deepEqual(bundle, before);
  for (const mutate of [v => { v.workspaceId = CAPTURE; }, v => { v.sourceId = 'missing'; }, v => { v.sourceVersionId = 'missing'; }]) {
    const bad = structuredClone(receipt); mutate(bad); assert.throws(() => Receipt.checkTarget(bundle, bad), fail);
  }
  const unrelated = await Core.prepareImport({ origin: 'naver_blog', title: '동명 자료', url: data.payload.url, text: data.payload.body, forceSeparate: true }, bundle);
  const more = Core.applyChanges(bundle, Core.buildImportChanges(bundle, unrelated));
  assert.equal(Receipt.checkTarget(more, receipt), true);
  assert.throws(() => Receipt.checkTarget(more, { ...receipt, sourceId: unrelated.source.id }), fail);
  const wrongOrigin = structuredClone(bundle); wrongOrigin.sources[0].origin = 'obsidian';
  assert.throws(() => Receipt.checkTarget(wrongOrigin, receipt), fail);
});
test('equal body versions keep distinct photo receipts rather than matching body text or newest version', async () => {
  const data = await F.fixture(), first = Core.applyChanges(data.bundle, data.changes);
  const next = await Core.prepareImport({ origin: 'naver_blog', title: data.payload.title, url: data.payload.url,
    text: data.payload.body, existingSourceId: data.prepared.source.id }, first, { forceNewVersion: true });
  const bundle = Core.applyChanges(first, Core.buildImportChanges(first, next));
  assert.equal(next.version.contentHash, data.prepared.version.contentHash);
  assert.notEqual(next.version.id, data.prepared.version.id);
  const oldAttachment = { ...data.attachment, localOnly: false }, newerAttachment = { ...oldAttachment,
    sourceVersionId: next.version.id, capture: { ...oldAttachment.capture, id: CAPTURE, capture_hash: '0'.repeat(64) } };
  const old = Receipt.fromAttachment(bundle.workspaceId, oldAttachment), newer = Receipt.fromAttachment(bundle.workspaceId, newerAttachment);
  assert.equal(Receipt.checkTarget(bundle, old), true); assert.equal(Receipt.checkTarget(bundle, newer), true);
  assert.equal(Receipt.checkAttachment(old, oldAttachment), true); assert.equal(Receipt.checkAttachment(newer, newerAttachment), true);
  assert.throws(() => Receipt.checkAttachment(old, newerAttachment), fail);
  assert.throws(() => Receipt.checkAttachment(newer, oldAttachment), fail);
});
test('browser namespace exposes the same isolated strict model without requiring a Core implementation until target checks', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/naver-media-receipt.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.HaedoLife.NaverMediaReceipt), Object.keys(Receipt));
  context.receiptJson = JSON.stringify(fixture());
  const actual = vm.runInContext('JSON.stringify(HaedoLife.NaverMediaReceipt.validate(JSON.parse(receiptJson)))', context);
  assert.deepEqual(JSON.parse(actual), fixture());
});
