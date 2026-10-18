'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Discovery = require('../assets/life/discovery.js');
const Profile = require('../assets/life/discovery-profile.js');
const now = '2026-10-19T05:00:00.000Z';
const options = expectedRevision => ({ expectedRevision, now });
const article = { id: 'article-1', canonicalUrl: 'https://example.org/article?id=1' };
test('browser and CommonJS expose the same explicit private-feedback contract', () => {
  const context = vm.createContext({ HaedoLife: { Discovery }, TextEncoder, Date });
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/discovery-profile.js'), 'utf8'), context);
  assert.equal(typeof context.HaedoLife.DiscoveryProfile.setFeedback, 'function');
  assert.equal(context.HaedoLife.DiscoveryProfile.empty('workspace').revision, 0);
  assert.equal(Profile.validate(Profile.empty('workspace')), true);
});
test('only explicit feedback mutates a detached profile; reading keys does not save a visit or copied content', () => {
  const initial = Profile.empty('workspace'), before = structuredClone(initial);
  const supplied = { ...article, title: '원격 제목', summary: '요약', contentText: '이 값은 피드백에 들어가지 않는다.' };
  assert.equal(Profile.articleKey(supplied), article.canonicalUrl); assert.deepEqual(initial, before);
  const next = Profile.setFeedback(initial, supplied, 'not_relevant', options(0));
  assert.deepEqual(initial, before); assert.equal(next.revision, 1);
  assert.deepEqual(next.feedback, [{ articleId: article.id, canonicalUrl: article.canonicalUrl, kind: 'not_relevant', updatedAt: now }]);
  assert.equal(JSON.stringify(next).includes(supplied.contentText), false);
});
test('canonical URL is feedback identity across changed provider IDs and tracking variants; undo creates a fresh revision', () => {
  const first = Profile.setFeedback(Profile.empty('workspace'), article, 'not_relevant', options(0));
  const variant = { id: 'new-provider-id', url: article.canonicalUrl + '&utm_source=reader#fragment' };
  const second = Profile.setFeedback(first, variant, 'already_read', options(1));
  assert.equal(second.feedback.length, 1); assert.equal(second.feedback[0].articleId, variant.id);
  const undone = Profile.undo(second, { canonicalUrl: variant.url }, options(2));
  assert.equal(undone.revision, 3); assert.deepEqual(undone.feedback, []);
  assert.throws(() => Profile.setFeedback(undone, article, 'not_relevant', options(1)), { code: 'discovery_profile_conflict' });
});
test('distinct article query identities and trailing slash paths are preserved', () => {
  let value = Profile.empty('workspace');
  for (const url of ['https://example.org/item?id=1', 'https://example.org/item?id=2', 'https://example.org/item/']) {
    value = Profile.setFeedback(value, { id: 'id-' + value.revision, canonicalUrl: url }, 'already_read', options(value.revision));
  }
  assert.equal(value.feedback.length, 3);
  assert.throws(() => Profile.setFeedback(value, { id: 'bad', canonicalUrl: article.canonicalUrl, url: 'https://example.org/different' }, 'already_read', options(3)), { code: 'discovery_profile_invalid' });
});
test('reset is a revision tombstone and explicit later feedback may start again at the latest revision', () => {
  const initial = Profile.setFeedback(Profile.empty('workspace'), article, 'already_read', options(0));
  const reset = Profile.clear(initial, options(1));
  assert.equal(reset.deleted, true); assert.equal(reset.revision, 2); assert.deepEqual(reset.feedback, []);
  assert.throws(() => Profile.undo(reset, article, options(1)), { code: 'discovery_profile_conflict' });
  const current = Profile.setFeedback(reset, article, 'not_relevant', options(2));
  assert.equal(current.deleted, false); assert.equal(current.revision, 3);
});
test('unsafe URLs, unsupported states, duplicate identities and unrelated metadata fail closed', () => {
  const empty = Profile.empty('workspace');
  for (const url of ['http://example.org/', 'javascript:alert(1)', 'https://user:secret@example.org/', 'data:text/plain,x']) {
    assert.throws(() => Profile.setFeedback(empty, { id: 'invalid', url }, 'not_relevant', options(0)), { code: 'discovery_profile_invalid' });
  }
  assert.throws(() => Profile.setFeedback(empty, article, 'opened', options(0)), { code: 'discovery_profile_invalid' });
  const one = Profile.setFeedback(empty, article, 'already_read', options(0));
  assert.throws(() => Profile.validate({ ...one, body: 'extra' }), { code: 'discovery_profile_invalid' });
  assert.throws(() => Profile.validate({ ...one, feedback: [one.feedback[0], one.feedback[0]] }), { code: 'discovery_profile_invalid' });
  assert.throws(() => Profile.validate({ ...one, feedback: [null] }), { code: 'discovery_profile_invalid' });
});
test('metadata byte bounds refuse growth without dropping previous feedback', () => {
  const original = Profile.empty('workspace'); let value = original;
  assert.throws(() => {
    for (let index = 0; index < 30; index++) value = Profile.setFeedback(value,
      { id: 'long-' + index, canonicalUrl: 'https://example.org/' + 'a'.repeat(7000) + index }, 'already_read', options(value.revision));
  }, { code: 'discovery_profile_too_large' });
  assert.equal(original.revision, 0); assert.deepEqual(original.feedback, []); assert.ok(value.feedback.length > 0);
});
