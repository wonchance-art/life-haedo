'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../assets/life/core.js');
const Profile = require('../assets/life/interest-profile.js');
const copy = value => structuredClone(value);
const digest = raw => crypto.createHash('sha256').update(raw).digest('hex');
const now = '2026-10-19T03:00:00.000Z';
const settings = revision => ({ expectedRevision: revision, now });
const code = expected => error => { assert.equal(error.code, expected); return true; };
async function fixtures() {
  let bundle = Core.createWorkspace();
  const texts = ['\ufeff가😀나\r\nCafe\u0301  책을 읽고 다시 쓸 문장을 찾았습니다?', '다른 기록에서도 책을 읽고 문장을 쓰는 방법이 궁금했습니다?'];
  for (let index = 0; index < 3; index++) {
    const prepared = await Core.prepareImport({ origin: 'other', title: '합성 자료 ' + index, text: texts[index % 2], url: 'https://example.org/' + index,
      author: index === 0 ? '직접 작성자' : index === 1 ? '미확인 표기' : '타인 작성자', authorRelation: ['self', 'unknown', 'other'][index],
      coverage: { status: index === 2 ? 'partial' : 'full_text', omissions: index === 2 ? ['사진'] : [] } }, bundle);
    bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared));
  }
  const documents = bundle.sourceVersions.slice(0, 2).map(version => ({ sourceId: version.sourceId, sourceVersionId: version.id, sha256: version.contentHash }));
  const evidence = bundle.sourceVersions.slice(0, 2).map((version, index) => {
    const start = index === 0 ? version.contentText.indexOf('나') : 0;
    return { ...documents[index], start, end: version.contentText.length, quote: version.contentText.slice(start) };
  });
  const result = { workspaceId: bundle.workspaceId, scopeRevision: bundle.revision, limitations: ['sampled_selected_documents_only'],
    analysis: { createdAt: now, model: 'mock/model', modelRevision: 'revision', adapter: 'local-embeddings',
      inputFingerprint: digest(JSON.stringify({ workspaceId: bundle.workspaceId, documents })), documents,
      interests: [{ id: 'topic-reading', kind: 'topic', label: '독서와 글쓰기', terms: ['독서'], support: 2, evidence }] } };
  return { bundle, result, selection: bundle.sourceVersions.map(version => version.id) };
}
async function proposal() {
  const fixture = await fixtures();
  const profile = await Profile.propose(fixture.bundle, Profile.empty(fixture.bundle.workspaceId), fixture.result, { ...settings(0), sourceVersionIds: fixture.selection });
  return { ...fixture, profile };
}
test('browser and CommonJS expose private profile contract without storage or network', () => {
  const context = vm.createContext({ HaedoLife: { Core }, TextEncoder, crypto: crypto.webcrypto, Date });
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/interest-profile.js'), 'utf8'), context);
  assert.equal(typeof context.HaedoLife.InterestProfile.revalidate, 'function');
  assert.equal(Profile.validate(Profile.empty('workspace')), true);
  assert.equal(Profile.MAX_BYTES, 256 * 1024);
});
test('manual preferences remain separate, immutable and protected by tombstone revisions', () => {
  const original = Profile.empty('workspace'), before = copy(original);
  const manual = Profile.setManual(original, [{ id: 'manual-books', label: '내가 직접 고른 독서' }], settings(0));
  assert.deepEqual(original, before); assert.equal(manual.revision, 1); assert.equal(manual.analysis, null);
  const deleted = Profile.clear(manual, settings(1));
  assert.equal(deleted.deleted, true); assert.equal(deleted.revision, 2); assert.deepEqual(deleted.manual, []);
  assert.throws(() => Profile.setManual(deleted, manual.manual, settings(1)), code('interest_profile_conflict'));
  assert.equal(Profile.setManual(deleted, manual.manual, settings(2)).revision, 3);
});
test('proposal stores exact selection, unknown/other author labels, raw SHA and UTF16 without changing originals', async () => {
  const fixture = await fixtures(), before = copy(fixture), initial = Profile.empty(fixture.bundle.workspaceId);
  const manual = Profile.setManual(initial, [{ id: 'manual-own', label: '내 관심' }], settings(0));
  const profile = await Profile.propose(fixture.bundle, manual, fixture.result, { ...settings(1), sourceVersionIds: fixture.selection });
  assert.deepEqual(fixture, before); assert.deepEqual(profile.manual, manual.manual); assert.deepEqual(profile.confirmedIds, []);
  assert.deepEqual(profile.analysis.selection.references.map(ref => ref.authorRelation), ['self', 'unknown', 'other']);
  assert.deepEqual(profile.analysis.selection.references.map(ref => ref.authorLabel), ['직접 작성자', '미확인 표기', '타인 작성자']);
  assert.equal(profile.analysis.selection.references[2].coverage, 'partial');
  assert.deepEqual(profile.analysis.selection.references[2].omissions, ['사진']);
  assert.ok(profile.analysis.selection.references.every(ref => ref.originalCreatedAt === null));
  const first = profile.analysis.interests[0].evidence[0];
  assert.equal(first.start, 4); assert.equal(fixture.bundle.sourceVersions[0].contentText.slice(first.start, first.end), first.quote);
  assert.equal(profile.analysis.evidenceScope, 'saved_material');
  assert.equal(await Profile.revalidate(fixture.bundle, profile), true);
  const confirmed = await Profile.confirm(fixture.bundle, profile, ['topic-reading'], settings(2));
  assert.deepEqual(confirmed.confirmedIds, ['topic-reading']); assert.equal(confirmed.revision, 3);
  assert.equal(confirmed.analysis.interests[0].belief, undefined);
});
test('selection cannot be substituted and forged UTF16 evidence fails before propose/confirm', async () => {
  const { bundle, result, selection } = await fixtures(), original = Profile.empty(bundle.workspaceId);
  const forged = copy(result); forged.analysis.interests[0].evidence[0].quote = '원문에 없는 해석';
  await assert.rejects(Profile.propose(bundle, original, forged, { ...settings(0), sourceVersionIds: selection }), code('interest_profile_stale'));
  const split = copy(result), ref = split.analysis.interests[0].evidence[0], raw = bundle.sourceVersions[0].contentText;
  ref.start = 3; ref.quote = raw.slice(ref.start, ref.end);
  await assert.rejects(Profile.propose(bundle, original, split, { ...settings(0), sourceVersionIds: selection }), code('interest_profile_stale'));
  await assert.rejects(Profile.propose(bundle, original, result, { ...settings(0), sourceVersionIds: [selection[0]] }), code('interest_profile_invalid'));
});
test('same body from multiple sources cannot fabricate independent evidence or support', async () => {
  const { bundle, result, selection } = await fixtures();
  result.analysis.interests[0].support = 999;
  const normal = await Profile.propose(bundle, Profile.empty(bundle.workspaceId), result, { ...settings(0), sourceVersionIds: selection });
  assert.equal(normal.analysis.interests[0].support, 2);
  const duplicate = copy(result), version = bundle.sourceVersions[2], raw = version.contentText;
  duplicate.analysis.documents[1] = { sourceId: version.sourceId, sourceVersionId: version.id, sha256: version.contentHash };
  duplicate.analysis.interests[0].evidence[1] = { ...duplicate.analysis.documents[1], start: 0, end: raw.length, quote: raw };
  await assert.rejects(Profile.propose(bundle, Profile.empty(bundle.workspaceId), duplicate, { ...settings(0), sourceVersionIds: selection }), code('interest_profile_invalid'));
});
test('confirmation revalidates raw body/hash, selected duplicates and author metadata', async () => {
  const fixture = await proposal();
  for (const mutate of [
    data => { data.sourceVersions[0].contentText += ' 변경'; },
    data => { data.sourceVersions[0].contentHash = '0'.repeat(64); },
    data => { data.sourceVersions[2].contentText += ' 중복도 변경'; },
    data => { data.sourceVersions[1].originalAuthor.label = '새 라벨'; },
    data => { data.sourceVersions[1].originalAuthor.relation = 'self'; },
    data => { data.sourceVersions[2].coverage.omissions.push('댓글'); },
    data => { data.sourceVersions.splice(0, 1); }
  ]) {
    const changed = copy(fixture.bundle); mutate(changed);
    await assert.rejects(Profile.confirm(changed, fixture.profile, ['topic-reading'], settings(1)), code('interest_profile_stale'));
  }
  const changed = copy(fixture.bundle); changed.workspaceId = 'different-workspace';
  await assert.rejects(Profile.confirm(changed, fixture.profile, ['topic-reading'], settings(1)), code('interest_profile_stale'));
});
test('adding an unselected newer version preserves exact old references', async () => {
  const { bundle, profile } = await proposal(), source = bundle.sources[0];
  const prepared = await Core.prepareImport({ origin: source.origin, title: source.title, text: '최신 버전의 다른 내용입니다.', existingSourceId: source.id }, bundle);
  const newer = Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared));
  assert.ok(newer.revision > profile.analysis.selection.workspaceRevision);
  const confirmed = await Profile.confirm(newer, profile, ['topic-reading'], settings(1));
  assert.equal(confirmed.analysis.documents[0].sourceVersionId, profile.analysis.documents[0].sourceVersionId);
});
test('link-only selection remains excluded from evidence and retains null hash', async () => {
  const { bundle, result, selection } = await fixtures();
  const prepared = await Core.prepareImport({ origin: 'other', title: '링크만', url: 'https://example.org/link-only', text: '' }, bundle);
  const next = Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared)); result.scopeRevision = next.revision;
  const profile = await Profile.propose(next, Profile.empty(next.workspaceId), result, { ...settings(0), sourceVersionIds: [...selection, prepared.version.id] });
  assert.equal(profile.analysis.selection.references.at(-1).sha256, null);
  assert.equal(profile.analysis.selection.references.at(-1).coverage, 'link_only');
  assert.equal(await Profile.revalidate(next, profile), true);
});
test('malformed profiles, unsupported fields and oversized metadata fail closed', async () => {
  const { profile } = await proposal();
  for (const mutate of [
    data => { data.public = true; }, data => { data.manual = [null]; }, data => { data.analysis.interests = [null]; },
    data => { data.confirmedIds = ['missing']; }, data => { data.deleted = true; }
  ]) { const bad = copy(profile); mutate(bad); assert.throws(() => Profile.validate(bad), code('interest_profile_invalid')); }
  const oversized = copy(profile);
  oversized.analysis.selection.references.forEach(ref => { ref.omissions = Array.from({ length: 100 }, (_, index) => String(index) + '한'.repeat(490)); });
  assert.throws(() => Profile.validate(oversized), code('interest_profile_too_large'));
});
test('raw source mutation while async SHA yields is refused before metadata can be applied', async () => {
  const { bundle, profile } = await proposal();
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const paused = new Promise(resolve => { release = resolve; });
  const context = vm.createContext({ TextEncoder, URL, Date, crypto: { subtle: { digest: async (algorithm, bytes) => {
    entered(); await paused; return crypto.webcrypto.subtle.digest(algorithm, bytes);
  } } } });
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/core.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/interest-profile.js'), 'utf8'), context);
  context.serializedBundle = JSON.stringify(bundle); context.serializedProfile = JSON.stringify(profile);
  vm.runInContext('globalThis.bundle = JSON.parse(serializedBundle); globalThis.profile = JSON.parse(serializedProfile);', context);
  const pending = vm.runInContext('HaedoLife.InterestProfile.revalidate(bundle, profile)', context);
  await started;
  vm.runInContext('bundle.sourceVersions[0].contentText += " 검증 중 변경";', context);
  release(); await assert.rejects(pending, code('interest_profile_stale'));
});
test('malformed adapter output rejects with profile errors rather than leaking type errors', async () => {
  const { bundle, result, selection } = await fixtures();
  for (const mutate of [data => { data.analysis.documents = [null]; }, data => { data.analysis.interests[0].evidence = [null]; }]) {
    const malformed = copy(result); mutate(malformed);
    await assert.rejects(Profile.propose(bundle, Profile.empty(bundle.workspaceId), malformed, { ...settings(0), sourceVersionIds: selection }), code('interest_profile_invalid'));
  }
});
test('current analysis adapter envelope can be proposed and explicitly confirmed', async () => {
  const Analysis = require('../assets/life/interest-analysis.js');
  const { bundle, selection } = await fixtures();
  const adapter = Analysis.create({ now: () => now, embed: async texts => texts.map(value => {
    const topic = Analysis.TOPICS.findIndex(item => item.text === value || item.terms.join(' ') === value);
    const vector = Array(11).fill(0); vector[topic < 0 ? 0 : topic] = 1; return vector;
  }) });
  try {
    const output = await adapter.analyze(bundle, { sourceVersionIds: selection, scopeRevision: bundle.revision });
    assert.ok(output.analysis.interests.length > 0);
    const profile = await Profile.propose(bundle, Profile.empty(bundle.workspaceId), output, { ...settings(0), sourceVersionIds: selection });
    const ids = profile.analysis.interests.map(item => item.id);
    const confirmed = await Profile.confirm(bundle, profile, ids, settings(1));
    assert.deepEqual(confirmed.confirmedIds, ids);
    assert.ok(confirmed.analysis.interests.every(item => item.evidenceScope === 'saved_material'));
    assert.equal(await Profile.revalidate(bundle, confirmed), true);
  } finally { await adapter.dispose(); }
});
