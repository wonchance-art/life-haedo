'use strict';
// Owner decisions 7 and 9 (2026-11-16): the public name and intro are read and saved on their
// own (owner-only RPCs), and attachments are chosen one by one when publishing (none at first).
// The SQL contract (owner-only profile, chosen attachments on every publish path, earlier
// argument sets publish no attachment and keep their receipts) is
// tests/run-blog-public-choice-postgres.cjs; BlogSync's request and replay rules are in
// tests/blog-publication-settle.test.cjs ("decision 7", "decision 9").
const test = require('node:test'), assert = require('node:assert/strict');
const Photo = require('../assets/life/photo-post.js'), Blog = require('../assets/life/blog.js'), Remote = require('../assets/life/blog-remote.js');
const Markdown = require('../assets/life/post-markdown.js');
const endpoint = import('../supabase/functions/haedo-blog-publish/handler.mjs');
const adapter = import('../supabase/functions/haedo-blog-publish/projection.mjs');
const POST = '33333333-3333-4333-8333-333333333333', OP = '44444444-4444-4444-8444-444444444444';
const RECEIPT = { status: 'stored', token: '55555555-5555-4555-8555-555555555555', blogToken: '66666666-6666-4666-8666-666666666666', revision: 1 };
const cards = [{ type: 'book', title: '익명 첨부 하나', creator: '익명 작가', url: 'https://example.com/one' },
  { type: 'article', title: '익명 첨부 둘', creator: '', url: '' }, { type: 'music', title: '익명 첨부 셋', creator: '', url: '' }];

function saved({ title = '첨부 고르기', body = '익명 본문', attachments = cards } = {}) {
  const doc = Photo.create(() => POST, '2026-11-16T00:00:00.000Z');
  doc.status = 'saved'; doc.title = title; doc.ops = [{ insert: body + '\n' }]; doc.attachments = structuredClone(attachments);
  return doc;
}
function client(answer = () => RECEIPT) {
  const calls = [], invokes = [], auth = { ready: true, epoch: 1, user: { id: '11111111-1111-4111-8111-111111111111' }, async verify() { return auth.user; }, client: {
    rpc(name, params) { calls.push({ name, params: structuredClone(params) }); return Promise.resolve({ data: answer(name, params), error: null }); },
    functions: { invoke(name, { body }) { invokes.push({ name, body: structuredClone(body) }); return Promise.resolve({ data: RECEIPT, error: null }); } } } };
  auth.session = { user: auth.user };
  return { remote: Remote.create({ auth, blog: Blog }), calls, invokes };
}

test('Blog.publicSnapshot keeps only the chosen attachments, in document order; without a choice (private reading) every one', () => {
  const doc = saved(), author = { name: '', intro: '' };
  assert.deepEqual(Blog.publicSnapshot(doc, { author, attachments: [] }).attachments, []);
  assert.deepEqual(Blog.publicSnapshot(doc, { author, attachments: [2] }).attachments.map(item => item.title), ['익명 첨부 셋']);
  assert.deepEqual(Blog.publicSnapshot(doc, { author, attachments: [0, 2] }).attachments.map(item => item.title), ['익명 첨부 하나', '익명 첨부 셋']);
  assert.deepEqual(Blog.publicSnapshot(doc, { author, attachments: [0, 1, 2] }).attachments, cards);
  assert.deepEqual(Blog.publicSnapshot(doc, { author }).attachments, cards, 'no choice: unchanged earlier projection');
  assert.deepEqual(Blog.privateReadingSnapshot(doc).attachments, cards);
  for (const bad of [[3], [1, 0], [0, 0], [-1], ['0'], [0.5], {}, null])
    assert.throws(() => Blog.publicSnapshot(doc, { author, attachments: bad }), { code: 'invalid_blog_selection' }, JSON.stringify(bad));
  // A post with only an attachment and nothing chosen has nothing to show publicly.
  const linksOnly = saved({ title: '', body: '', attachments: [cards[0]] });
  assert.throws(() => Blog.publicSnapshot(linksOnly, { author, attachments: [] }));
  assert.deepEqual(Blog.publicSnapshot(linksOnly, { author, attachments: [0] }).attachments, [cards[0]]);
  assert.equal(Blog.attachmentChoice([0, 11]), true); assert.equal(Blog.attachmentChoice([12]), false); assert.equal(Blog.attachmentChoice([1], 1), false);
});

test('BlogRemote: a choice always goes through life_blog_publish_copies with p_attachments; a request without one keeps its earlier RPC and arguments', async () => {
  const { remote, calls } = client();
  await remote.publish(POST, 1, OP, { photoIds: [], author: { name: '', intro: '' }, attachments: [] });
  assert.deepEqual(calls.at(-1), { name: 'life_blog_publish_copies', params: { p_post_id: POST, p_expected_revision: 1, p_expected_publication_revision: 0, p_operation_id: OP,
    p_photo_ids: [], p_author: { name: '', intro: '' }, p_copies: {}, p_attachments: [] } }, 'text-only with a choice: copies {}');
  await remote.publish(POST, 1, OP, { photoIds: [], author: { name: '', intro: '' }, attachments: [0, 2] });
  assert.deepEqual(calls.at(-1).params.p_attachments, [0, 2]);
  // A request recorded before 2026-11-16: exactly the earlier call.
  await remote.publish(POST, 1, OP, { photoIds: [], author: { name: '', intro: '' } });
  assert.deepEqual(calls.at(-1), { name: 'life_blog_publish', params: { p_post_id: POST, p_expected_revision: 1, p_expected_publication_revision: 0, p_operation_id: OP,
    p_photo_ids: [], p_author: { name: '', intro: '' } } });
  const sent = calls.length;
  for (const bad of [[1, 0], [0, 0], [12], [-1], ['0'], [0.5], null, {}, Array.from({ length: 13 }, (_, i) => i)])
    await assert.rejects(remote.publish(POST, 1, OP, { photoIds: [], attachments: bad }), { code: 'invalid_request' }, JSON.stringify(bad));
  assert.equal(calls.length, sent, 'refused choices never reach the server');
  remote.dispose();
});

test('BlogRemote: a Markdown choice is sent to the Edge as p_attachments; a Markdown request without one is sent without it', async () => {
  const { remote, invokes } = client();
  await remote.publish(POST, 1, OP, { documentFormat: 'life-post-md-v1', photoIds: [], author: { name: '', intro: '' }, attachments: [1] });
  assert.deepEqual(invokes.at(-1).body.p_attachments, [1]);
  await remote.publish(POST, 1, OP, { documentFormat: 'life-post-md-v1', photoIds: [], author: { name: '', intro: '' } });
  assert.equal(Object.hasOwn(invokes.at(-1).body, 'p_attachments'), false);
  remote.dispose();
});

test('BlogRemote: the public name and intro are read and saved through the owner RPCs, and every answer is checked', async () => {
  let reply = { author: { name: '', intro: '' }, saved: false, blogToken: null, posts: 0 };
  const { remote, calls } = client(name => name.endsWith('public_profile') ? structuredClone(reply) : RECEIPT);
  assert.deepEqual(await remote.publicProfile(), reply);
  assert.deepEqual(calls.at(-1), { name: 'life_blog_get_public_profile', params: {} });
  reply = { author: { name: '익명', intro: '소개' }, saved: true, blogToken: RECEIPT.blogToken, posts: 2 };
  assert.deepEqual(await remote.savePublicProfile({ name: '익명', intro: '소개' }), reply);
  assert.deepEqual(calls.at(-1), { name: 'life_blog_set_public_profile', params: { p_author: { name: '익명', intro: '소개' } } });
  const sent = calls.length;
  for (const bad of [{ name: '익명' }, { name: '', intro: '', extra: '' }, { name: 'x'.repeat(501), intro: '' }, { name: '', intro: 'x'.repeat(2001) }, { name: 'a\u0001', intro: '' }, null])
    await assert.rejects(remote.savePublicProfile(bad), { code: 'invalid_request' });
  assert.equal(calls.length, sent, 'refused values never reach the server');
  for (const wrong of [{ ...reply, author: { name: 1, intro: '' } }, { ...reply, saved: 'yes' }, { ...reply, blogToken: 'x' }, { ...reply, saved: false }, { ...reply, posts: -1 }, null]) {
    reply = wrong;
    await assert.rejects(remote.publicProfile(), { code: 'invalid_remote_data' });
  }
  remote.dispose();
});

test('Edge: the attachment choice is optional, checked, and passed to prepare, projection and commit only when given', async () => {
  const { validateInput } = await endpoint, { projectMarkdownOps } = await adapter;
  const base = { p_post_id: POST, p_expected_revision: 1, p_expected_publication_revision: 0, p_operation_id: OP, p_photo_ids: [], p_author: { name: '', intro: '' }, p_copies: {} };
  assert.deepEqual(validateInput(base), base, 'an earlier app: seven fields');
  assert.deepEqual(validateInput({ ...base, p_attachments: [0, 2] }), { ...base, p_attachments: [0, 2] });
  for (const bad of [[1, 0], [0, 0], [12], [-1], ['0'], [0.5], null, {}, Array.from({ length: 13 }, (_, i) => i)])
    assert.throws(() => validateInput({ ...base, p_attachments: bad }), { code: 'invalid_request' }, JSON.stringify(bad));
  assert.throws(() => validateInput({ ...base, p_extra: [] }), { code: 'invalid_request' });
  const md = Blog.pack(Markdown.fromV2(saved()).document);
  assert.deepEqual(projectMarkdownOps(md, { attachments: [1] }), projectMarkdownOps(md, {}), 'attachments never enter the ops');
  assert.throws(() => projectMarkdownOps(md, { attachments: [3] }), 'a position past the stored attachments is refused');
});

test('Edge handler: prepare and commit receive p_attachments exactly when the request has it', async () => {
  const { createHandler } = await endpoint;
  const md = Blog.pack(Markdown.fromV2(saved()).document);
  const run = async input => {
    const calls = [];
    const fetcher = async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : null; calls.push({ url, body });
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: '11111111-1111-4111-8111-111111111111', role: 'authenticated', is_anonymous: false });
      if (url.endsWith('/life_blog_markdown_publish_prepare')) return Response.json({ status: 'prepared', ownerId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222', revision: 1, sourceHash: 'a'.repeat(64), document: md });
      if (url.endsWith('/life_blog_markdown_publish_commit')) return Response.json(RECEIPT);
      throw Error('unexpected');
    };
    const env = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_fixture' }), SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_fixture' }) };
    const response = await createHandler({ fetcher, environment: name => env[name] })(new Request('https://edge.example/', { method: 'POST',
      headers: { authorization: 'Bearer a.b.c', 'content-type': 'application/json' }, body: JSON.stringify(input) }));
    return { status: response.status, calls };
  };
  const base = { p_post_id: POST, p_expected_revision: 1, p_expected_publication_revision: 0, p_operation_id: OP, p_photo_ids: [], p_author: { name: '', intro: '' }, p_copies: {} };
  const chosen = await run({ ...base, p_attachments: [2] });
  assert.equal(chosen.status, 200);
  assert.deepEqual(chosen.calls.filter(call => /rpc/.test(call.url)).map(call => call.body.p_attachments), [[2], [2]]);
  const earlier = await run(base);
  assert.equal(earlier.status, 200);
  assert.deepEqual(earlier.calls.filter(call => /rpc/.test(call.url)).map(call => Object.hasOwn(call.body, 'p_attachments')), [false, false]);
  const outside = await run({ ...base, p_attachments: [3] });
  assert.equal(outside.calls.some(call => /commit/.test(call.url)), false, 'a position past the stored list is never committed');
});
