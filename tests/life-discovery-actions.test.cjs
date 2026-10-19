'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Discovery = require('../assets/life/discovery.js');
const Actions = require('../assets/life/discovery-actions.js');
const now = '2026-10-19T05:00:00.000Z';
const opts = expectedRevision => ({ expectedRevision, now });
function article(n = 1) { return { id: 'article-' + n, sourceId: 'seoul-culture', url: 'https://news.seoul.go.kr/culture/archives/' + n + '?newsId=A%20B&utm_source=test#section', title: '공연😀 소식 ' + n, author: null, language: 'ko', tags: ['공연'], publishedAt: null, updatedAt: null, fetchedAt: now, coverage: 'full_text', bodyText: 'not copied', summary: 'not copied', rights: { label: '제목과 링크', url: 'https://news.seoul.go.kr/culture', mode: 'full_text_allowed' } }; }
const source = { id: 'seoul-culture', name: '서울시 문화' };
const shot = n => Actions.capture(article(n), source);
const invalid = fn => assert.throws(fn, { code: 'discovery_actions_invalid' });
test('UMD and CommonJS API are equivalent and default profile is private/off', () => {
  const sandbox = { structuredClone, TextEncoder, HaedoLife: { Discovery } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/life/discovery-actions.js'), 'utf8'), sandbox);
  assert.deepEqual(Object.keys(sandbox.HaedoLife.DiscoveryActions), Object.keys(Actions));
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.HaedoLife.DiscoveryActions.empty('w'))), Actions.empty('w'));
  assert.equal(Actions.empty('w').personalizationEnabled, false);
});
test('capture preserves public metadata/url identity and strips body, summary and authority', () => {
  const a = article(), original = structuredClone(a), result = Actions.capture(a, source);
  assert.equal(result.url, a.url); assert.equal(result.canonicalUrl, 'https://news.seoul.go.kr/culture/archives/1?newsId=A%20B');
  assert.equal(result.coverage, 'link_only'); assert.equal(result.rights.mode, 'metadata_only');
  assert.equal('bodyText' in result || 'summary' in result, false); assert.deepEqual(a, original);
  for (const url of ['http://news.seoul.go.kr/x', 'https://news.seoul.go.kr.evil.example/x', 'https://user@news.seoul.go.kr/x']) invalid(() => Actions.capture({ ...a, url }, source));
  invalid(() => Actions.capture({ ...a, sourceId: 'unapproved' }, { id: 'unapproved', name: 'unknown' }));
  invalid(() => Actions.capture({ ...a, coverage: 'private' }, source));
  invalid(() => Actions.capture({ ...a, rights: { ...a.rights, mode: 'not_allowed' } }, source));
  invalid(() => Actions.capture({ ...a, rights: { ...a.rights, mode: 'metadata_only' } }, source));
  invalid(() => Actions.capture({ ...a, canonicalUrl: 'https://news.seoul.go.kr/different' }, source));
});
test('like/bookmark targets are independent; cancelled rows and original liked snapshot persist', () => {
  const initial = Actions.empty('w'), s = shot(1);
  const liked = Actions.setReaction(initial, s, 'liked', true, opts(0));
  const both = Actions.setReaction(liked, { ...s, title: 'changed public title' }, 'bookmarked', true, opts(1));
  assert.deepEqual(initial, Actions.empty('w')); assert.equal(both.entries[0].snapshot.title, s.title);
  const unliked = Actions.setReaction(both, s, 'liked', false, opts(2));
  assert.equal(unliked.entries[0].bookmarked, true); assert.equal(unliked.entries[0].likedAt, null);
  const cancelled = Actions.setReaction(unliked, s, 'bookmarked', false, opts(3));
  assert.equal(cancelled.entries.length, 1); assert.equal(cancelled.entries[0].bookmarkedAt, null);
  assert.deepEqual(Actions.exportCopy(cancelled, { now }).entries, []);
  const active = Actions.setReaction(both, s, 'liked', true, opts(2));
  assert.equal(active.entries[0].likedAt, both.entries[0].likedAt);
  s.tags.push('mutation'); assert.deepEqual(liked.entries[0].snapshot.tags, ['공연']);
});
test('first like and re-like capture the actual selected metadata while bookmarks cannot rewrite active like evidence', () => {
  const a = shot(1), b = { ...a, title: '새 제목', tags: ['새 태그'] };
  const bookmarked = Actions.setReaction(Actions.empty('w'), a, 'bookmarked', true, opts(0));
  const liked = Actions.setReaction(bookmarked, b, 'liked', true, opts(1));
  assert.deepEqual(liked.entries[0].snapshot, b);
  const stillLiked = Actions.setReaction(liked, a, 'bookmarked', false, opts(2));
  assert.deepEqual(stillLiked.entries[0].snapshot, b);
  const unliked = Actions.setReaction(stillLiked, b, 'liked', false, opts(3));
  const reliked = Actions.setReaction(unliked, a, 'liked', true, opts(4));
  assert.deepEqual(reliked.entries[0].snapshot, a);
});
test('personalization/exclusion and forget/reset are explicit revisioned choices without stale resurrection', () => {
  const liked = Actions.setReaction(Actions.empty('w'), shot(1), 'liked', true, opts(0));
  const enabled = Actions.setPersonalization(liked, true, opts(1));
  const excluded = Actions.setExcluded(enabled, shot(1).url, true, opts(2));
  assert.equal(excluded.entries[0].liked, true); assert.equal(excluded.entries[0].excludedFromRecommendations, true);
  const forgot = Actions.forget(excluded, shot(1).canonicalUrl, opts(3)); assert.deepEqual(forgot.entries, []); assert.equal(forgot.personalizationEnabled, true);
  const cleared = Actions.clear(excluded, opts(3)); assert.equal(cleared.deleted, true); assert.equal(cleared.personalizationEnabled, false); assert.deepEqual(cleared.entries, []);
  assert.throws(() => Actions.setPersonalization(cleared, true, opts(1)), { code: 'discovery_actions_conflict' });
  invalid(() => Actions.setExcluded(cleared, shot(1).url, false, opts(4)));
});
test('strict snapshots, timestamps, entries and byte bounds reject untrusted private or malformed payloads', () => {
  const liked = Actions.setReaction(Actions.empty('w'), shot(1), 'liked', true, opts(0));
  for (const mutate of [p => p.privateText = 'x', p => p.entries[0].snapshot.summary = 'private', p => p.entries[0].snapshot.rights.mode = 'full_text_allowed', p => p.entries[0].snapshot.canonicalUrl += '#fragment', p => p.entries[0].snapshot.title = '\ud800', p => p.entries[0].snapshot.tags = Array(1), p => p.entries[0].snapshot.publishedAt = '2026-02-30T05:00:00Z', p => p.entries[0].likedAt = null, p => p.entries.push(p.entries[0]), p => p.personalizationEnabled = 'true', p => p.entries[0].snapshot.sourceId = 'not-registered']) { const p = structuredClone(liked); mutate(p); invalid(() => Actions.validate(p)); }
  invalid(() => Actions.validate({ ...Actions.empty('w'), personalizationEnabled: true }));
  const many = { ...liked, entries: Array.from({ length: 501 }, (_, n) => ({ ...liked.entries[0], canonicalUrl: shot(n).canonicalUrl, snapshot: shot(n) })) };
  assert.throws(() => Actions.validate(many), { code: 'discovery_actions_too_large' });
  const large = { ...liked, entries: Array.from({ length: 500 }, (_, n) => { const s = shot(n); s.title = '가'.repeat(500); s.tags = ['나'.repeat(200), '다'.repeat(200), '라'.repeat(200)]; return { ...liked.entries[0], canonicalUrl: s.canonicalUrl, snapshot: s }; }) };
  assert.throws(() => Actions.validate(large), { code: 'discovery_actions_too_large' });
});
test('portable copy is strict and account-free; existing cancelled rows win and imported signals stay off/excluded', () => {
  let sourceProfile = Actions.setReaction(Actions.empty('origin'), shot(1), 'liked', true, opts(0));
  sourceProfile = Actions.setReaction(sourceProfile, shot(2), 'bookmarked', true, opts(1));
  sourceProfile = Actions.setPersonalization(sourceProfile, true, opts(2));
  const exported = Actions.exportCopy(sourceProfile, { now }), before = structuredClone(exported);
  assert.deepEqual(Object.keys(exported), ['format', 'schemaVersion', 'exportedAt', 'entries']);
  const preview = Actions.previewCopy(exported); assert.deepEqual(preview.counts, { total: 2, liked: 1, bookmarked: 1 });
  preview.entries[0].snapshot.title = 'mutated preview'; assert.deepEqual(exported, before);
  const cancelled = Actions.setReaction(Actions.empty('target'), shot(1), 'liked', false, opts(0));
  const enabled = Actions.setPersonalization(cancelled, true, opts(1));
  const merged = Actions.mergeCopy(enabled, exported, opts(2));
  assert.equal(merged.personalizationEnabled, false); assert.equal(merged.entries[0].liked, false); assert.equal(merged.entries[1].bookmarked, true); assert.equal(merged.entries[1].excludedFromRecommendations, true);
  assert.equal(merged.workspaceId, 'target'); assert.deepEqual(enabled.entries, cancelled.entries);
  invalid(() => Actions.previewCopy({ ...exported, workspaceId: 'leaked' }));
  invalid(() => Actions.previewCopy({ ...exported, entries: cancelled.entries }));
  const targetBefore = structuredClone(enabled); invalid(() => Actions.mergeCopy(enabled, { ...exported, format: 'other' }, opts(2))); assert.deepEqual(enabled, targetBefore);
});
test('portable merge capacity failure never evicts existing cancelled or active selections', () => {
  const base = Actions.setReaction(Actions.empty('w'), shot(0), 'liked', false, opts(0));
  const full = { ...base, entries: Array.from({ length: 500 }, (_, n) => ({ ...base.entries[0], canonicalUrl: shot(n).canonicalUrl, snapshot: shot(n) })) };
  Actions.validate(full); const before = structuredClone(full);
  const other = Actions.setReaction(Actions.empty('other'), shot(501), 'bookmarked', true, opts(0));
  assert.throws(() => Actions.mergeCopy(full, Actions.exportCopy(other, { now }), opts(1)), { code: 'discovery_actions_too_large' });
  assert.deepEqual(full, before);
});
