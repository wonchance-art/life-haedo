'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Settings = require('../assets/life/discovery-settings.js');
const opts = expectedRevision => ({ expectedRevision, now: '2026-10-19T05:00:00.000Z' });
const invalid = run => assert.throws(run, { code: 'discovery_settings_invalid' });
test('browser and CommonJS expose the same pure API; untouched settings default off', () => {
  const sandbox = { structuredClone, TextEncoder }; vm.runInNewContext(fs.readFileSync(require.resolve('../assets/life/discovery-settings.js'), 'utf8'), sandbox);
  assert.deepEqual(Object.keys(sandbox.HaedoLife.DiscoverySettings), Object.keys(Settings));
  assert.equal(Settings.validate(Settings.empty('workspace')), true);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.HaedoLife.DiscoverySettings.empty('workspace'))), Settings.empty('workspace'));
  assert.equal(Settings.empty('workspace').autoRefresh, false);
});
test('explicit update and reset are detached revisioned choices; reset defeats stale re-enable', () => {
  const original = Settings.empty('workspace'), patch = { autoRefresh: true, disabledInterestIds: ['topic-a'], disabledSourceIds: ['source-a'] };
  const enabled = Settings.update(original, patch, opts(0));
  patch.disabledInterestIds.push('topic-b');
  assert.deepEqual(original, Settings.empty('workspace'));
  assert.deepEqual(enabled.disabledInterestIds, ['topic-a']); assert.equal(enabled.autoRefresh, true);
  const disabled = Settings.update(enabled, { autoRefresh: false }, opts(1));
  const cleared = Settings.clear(disabled, opts(2));
  assert.deepEqual(cleared, { ...Settings.empty('workspace'), revision: 3, deleted: true, updatedAt: opts(0).now });
  assert.throws(() => Settings.update(cleared, { autoRefresh: true }, opts(1)), { code: 'discovery_settings_conflict' });
  assert.equal(Settings.update(cleared, { autoRefresh: true }, opts(3)).autoRefresh, true);
});
test('strict bounded schema rejects unsafe zero state, invalid IDs, duplicate selections and unrelated fields', () => {
  const base = Settings.empty('workspace'), valid = Settings.update(base, {}, opts(0));
  for (const value of [null, {}, { ...base, autoRefresh: true }, { ...base, deleted: true }, { ...base, updatedAt: opts(0).now }, { ...base, privateText: 'secret' }, { ...valid, autoRefresh: 1 }, { ...valid, disabledSourceIds: Array(1) }, { ...valid, disabledInterestIds: ['a', 'a'] }, { ...valid, disabledSourceIds: ['bad id'] }, { ...valid, disabledSourceIds: Array.from({ length: 101 }, (_, i) => 's' + i) }, { ...valid, disabledInterestIds: Array.from({ length: 41 }, (_, i) => 'i' + i) }, { ...valid, updatedAt: '2026-02-30T05:00:00Z' }, { ...valid, revision: -1 }]) invalid(() => Settings.validate(value));
  invalid(() => Settings.update(base, { analysis: true }, opts(0)));
  invalid(() => Settings.update(base, { autoRefresh: undefined }, opts(0)));
  invalid(() => Settings.update(base, {}, { ...opts(0), externalUrl: 'https://example.org/' }));
  assert.throws(() => Settings.update({ ...valid, revision: Number.MAX_SAFE_INTEGER }, {}, opts(Number.MAX_SAFE_INTEGER)), { code: 'discovery_settings_conflict' });
});
test('projection filters only explicit IDs, supports all-off and preserves raw profile/feed plus unknown disabled IDs', () => {
  const profile = { workspaceId: 'workspace', manual: [{ id: 'topic-a', label: '언어' }, { id: 'topic-b', label: '책' }], analysis: null, confirmedIds: [] };
  const feed = { sources: [{ id: 'source-a' }, { id: 'source-b' }], articles: [{ id: 'a', sourceId: 'source-a' }, { id: 'b', sourceId: 'source-b' }], generatedAt: 'public' };
  const before = structuredClone({ profile, feed });
  const settings = Settings.update(Settings.empty('workspace'), { disabledInterestIds: ['topic-a', 'topic-b', 'absent-topic'], disabledSourceIds: ['source-a', 'source-b', 'absent-source'] }, opts(0));
  assert.deepEqual(Settings.effectiveProfile(profile, settings).manual, []);
  const selected = Settings.filterFeed(feed, settings); assert.deepEqual(selected.sources, []); assert.deepEqual(selected.articles, []);
  assert.deepEqual({ profile, feed }, before); assert.ok(settings.disabledSourceIds.includes('absent-source'));
  const enabled = Settings.update(settings, { disabledInterestIds: [], disabledSourceIds: [] }, opts(1));
  const projected = Settings.effectiveProfile(profile, enabled); projected.manual[0].label = 'changed';
  assert.equal(profile.manual[0].label, '언어'); assert.deepEqual(Settings.filterFeed(feed, enabled), feed);
  invalid(() => Settings.effectiveProfile({ ...profile, workspaceId: 'other' }, settings));
});
