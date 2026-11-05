'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Remote = require('../assets/life/blog-remote.js'), Blog = require('../assets/life/blog.js'), Photo = require('../assets/life/photo-post.js');
const cases = [
  ['life_blog_markdown_publication_unavailable', 'blog_publication_unavailable', /공개 기능이 아직 준비되지 않았습니다/],
  ['life_blog_update_required', 'blog_update_required', /새로고침한 뒤 다시 시도/],
];

test('known SQL format failures get actionable public-safe messages instead of blaming the input', () => {
  for (const [message, code, expected] of cases) {
    const error = Remote.clean({ code: '22023', message, details: 'private SQL and document body', hint: 'private owner' });
    assert.equal(error.code, code); assert.match(error.message, expected); assert.match(error.message, /저장한 글은 유지됩니다/);
    assert.doesNotMatch(error.message, /life_blog_|private|자동으로 다시 시도|요청 형식/);
    assert.equal(Object.hasOwn(error, 'details'), false); assert.equal(Object.hasOwn(error, 'hint'), false);
    assert.equal(Remote.clean(error).code, code, 'the normalized code survives another transport boundary');
    assert.equal(Remote.fault(code).message, error.message);
  }
  for (const message of ['life_blog_update_required: private details', 'life_blog_markdown_publication_unavailable suffix', 'different invalid request']) {
    assert.equal(Remote.clean({ code: '22023', message }).code, 'invalid_request', 'only an exact known server condition gets the specialized guidance');
  }
  assert.equal(Remote.clean({ code: '42501', message: 'life_blog_update_required' }).code, 'permission_denied');
  assert.equal(Remote.clean({ message: 'life_blog_update_required' }).code, 'network_error');
});

test('save and publish surface the known format failure once while retaining the submitted document', async () => {
  const owner = randomUUID(), workspaceId = randomUUID(), postId = randomUUID();
  const doc = Photo.create(() => postId); doc.status = 'saved'; doc.ops = [{ insert: '그대로 남아야 할 한글 본문\n' }];
  const data = Blog.pack(doc), before = structuredClone(data), calls = [];
  let failure;
  const auth = { ready: true, epoch: 1, user: { id: owner }, session: { user: { id: owner } },
    verify: async () => ({ id: owner }), client: { rpc: async (name, params) => {
      calls.push({ name, params: structuredClone(params) }); return { data: null, error: failure };
    } } };
  const remote = Remote.create({ auth, blog: Blog });
  try {
    for (const [message, code] of cases) {
      failure = { code: '22023', message }; const count = calls.length;
      const request = message === 'life_blog_update_required'
        ? remote.save({ workspaceId, postId, operationId: randomUUID(), expectedRevision: 1, data })
        : remote.publish(postId, 1, randomUUID(), { expectedPublicRevision: 0 });
      await assert.rejects(request, error => error.code === code && /저장한 글은 유지됩니다/.test(error.message));
      assert.equal(calls.length, count + 1, 'a format failure does not trigger a different or repeated write');
      assert.deepEqual(data, before);
    }
    assert.deepEqual(calls.map(call => call.name), ['life_blog_publish', 'life_blog_save']);
    assert.deepEqual(calls[1].params.p_data, before);
  } finally { remote.dispose(); }
});
