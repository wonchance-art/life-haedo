'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Remote = require('../assets/life/blog-remote.js'), Blog = require('../assets/life/blog.js');
const markdownFailure = () => ({ code: '22023', message: 'life_blog_markdown_publication_unavailable', details: 'private document', hint: 'private owner' });
const copy = { id: 'fixture-photo', type: 'image/jpeg', size: 12, digest: 'a'.repeat(64), width: 1, height: 1 };

function fixture(t, { respond, verify } = {}) {
  const owner = randomUUID(), postId = randomUUID(), operationId = randomUUID(), calls = [];
  const auth = { ready: true, epoch: 1, user: { id: owner }, session: { user: { id: owner } },
    verify: verify || (async () => ({ id: owner })), client: {
      rpc: async (name, params) => { calls.push({ name, params: structuredClone(params) }); return respond(name, params); },
      functions: { invoke: async (name, options) => { calls.push({ name, params: structuredClone(options.body) }); return respond(name, options.body); } }
    } };
  const remote = Remote.create({ auth, blog: Blog }); t.after(() => remote.dispose());
  return { auth, remote, postId, operationId, calls };
}
async function failure(action) { try { await action(); assert.fail('Expected publication failure'); } catch (error) { if (error.code === 'ERR_ASSERTION') throw error; return error; } }
function noProof(error) { assert.equal(Object.hasOwn(error, 'publicationRolledBack'), false); }

test('missing public copies retain a specific preparation notice across error normalization without promising unavailable controls', () => {
  const error = Remote.clean({ code: 'blog_public_copies_required', message: 'private original', details: 'private path', publicationRolledBack: true });
  assert.equal(error.code, 'blog_public_copies_required');
  assert.equal(error.message, '공개할 사진 사본을 먼저 준비해야 합니다. 저장한 글과 공개 요청은 유지됩니다.');
  assert.equal(Remote.clean(error).message, error.message);
  assert.equal(Remote.fault(error.code).message, error.message);
  assert.doesNotMatch(error.message, /private|자동으로 다시 시도|초기화|다시 선택/);
  assert.equal(Object.hasOwn(error, 'details'), false); noProof(error);
});

test('only a confirmed legacy SQL refusal carries immediate rollback evidence without leaking SQL details or retrying', async t => {
  for (const photos of [false, true]) {
    const f = fixture(t, { respond: () => ({ status: 400, data: null, error: markdownFailure() }) });
    const options = { expectedPublicRevision: 2, photoIds: photos ? [copy.id] : [], copies: photos ? [copy] : [], author: { name: '합성 작성자', intro: '' } }, before = structuredClone(options);
    const error = await failure(() => f.remote.publish(f.postId, 3, f.operationId, options));
    assert.equal(error.code, 'blog_publication_unavailable');
    assert.equal(error.message, '이 글의 공개 기능이 아직 준비되지 않았습니다. 저장한 글은 유지됩니다.');
    assert.equal(error.publicationRolledBack, true);
    noProof(Remote.clean(error));
    assert.equal(Remote.clean(error).code, error.code, 'further normalization keeps guidance without durable evidence');
    assert.equal(Object.getOwnPropertyDescriptor(error, 'publicationRolledBack').writable, false);
    assert.doesNotMatch(error.message, /private|life_blog_|자동으로 다시 시도/);
    assert.equal(Object.hasOwn(error, 'details'), false); assert.equal(Object.hasOwn(error, 'hint'), false);
    assert.deepEqual(options, before); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].name, photos ? 'life_blog_publish_copies' : 'life_blog_publish');
    assert.equal(f.calls[0].params.p_operation_id, f.operationId);
    const copied = Remote.clean({ ...error, publicationRolledBack: true });
    noProof(copied); assert.equal(copied.code, error.code, 'a copied code and flag retain guidance, not provenance');
  }
});

test('missing or ambiguous HTTP status, wrong SQLSTATE and inexact SQL messages never authorize replacing a pending request', async t => {
  const responses = [undefined, 200, 401, 403, 429, 500, 502, 503].map(status => ({ status, error: markdownFailure() }));
  responses.push({ status: 400, error: { ...markdownFailure(), code: '42501' } },
    { status: 400, error: { ...markdownFailure(), message: 'life_blog_markdown_publication_unavailable suffix' } },
    { status: 400, error: { code: 'blog_publication_unavailable', publicationRolledBack: true } },
    { status: 400, error: { code: '22023', message: 'life_blog_update_required' } });
  for (const response of responses) {
    const f = fixture(t, { respond: () => response });
    const error = await failure(() => f.remote.publish(f.postId, 3, f.operationId));
    noProof(error); assert.equal(f.calls.length, 1);
  }
});

test('raw SQL-looking exceptions outside an actual RPC response never mint rollback evidence', async t => {
  for (const location of ['verify', 'rpc']) {
    const raised = { ...markdownFailure(), status: 400, publicationRolledBack: true };
    const f = fixture(t, { respond: () => { throw raised; }, ...(location === 'verify' ? { verify: async () => { throw raised; } } : {}) });
    const error = await failure(() => f.remote.publish(f.postId, 3, f.operationId));
    noProof(error); assert.equal(error.code, 'blog_publication_unavailable');
    assert.equal(f.calls.length, location === 'verify' ? 0 : 1);
  }
  noProof(Remote.clean({ ...markdownFailure(), status: 400, publicationRolledBack: true }));
  noProof(Remote.fault('blog_publication_unavailable'));
});

test('Markdown Edge failures retain existing Korean guidance but never impersonate a legacy receipt rejection', async t => {
  for (const [code, message] of [
    ['blog_publication_unavailable', '이 글의 공개 기능이 아직 준비되지 않았습니다. 저장한 글은 유지됩니다.'],
    ['blog_update_required', '새 형식의 글입니다. 새로고침한 뒤 다시 시도해 주세요. 저장한 글은 유지됩니다.']
  ]) {
    const f = fixture(t, { respond: () => ({ error: { name: 'FunctionsHttpError', context: { status: 400,
      json: async () => ({ code, publicationRolledBack: true, message: 'private response', details: 'private body' }) } } }) });
    const error = await failure(() => f.remote.publish(f.postId, 3, f.operationId, { documentFormat: 'life-post-md-v1' }));
    assert.equal(error.code, code); assert.equal(error.message, message); noProof(error);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, 'haedo-blog-publish');
  }
});

test('the same SQL format error on a read has guidance but no publication rollback evidence', async t => {
  const f = fixture(t, { respond: () => ({ status: 400, error: markdownFailure() }) });
  const error = await failure(() => f.remote.read(f.postId));
  assert.equal(error.code, 'blog_publication_unavailable'); noProof(error);
  assert.equal(f.calls[0].name, 'life_blog_read');
});

test('a completed operation receipt replays unchanged without attempting a new route or operation', async t => {
  const result = { status: 'published', token: randomUUID(), blogToken: randomUUID(), revision: 8 };
  const f = fixture(t, { respond: () => ({ status: 200, data: result, error: null }) });
  assert.deepEqual(await f.remote.publish(f.postId, 3, f.operationId, { expectedPublicRevision: 7 }), result);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, 'life_blog_publish');
  assert.equal(f.calls[0].params.p_operation_id, f.operationId);
});

test('an account transition before a rejected response returns cancellation rather than reusable recovery evidence', async t => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { respond: async () => { await wait; return { status: 400, error: markdownFailure() }; } });
  const operation = f.remote.publish(f.postId, 3, f.operationId);
  while (!f.calls.length) await new Promise(resolve => setImmediate(resolve));
  f.auth.epoch++; f.auth.user = { id: randomUUID() }; release();
  const error = await failure(() => operation);
  assert.equal(error.code, 'request_cancelled'); noProof(error);
});
