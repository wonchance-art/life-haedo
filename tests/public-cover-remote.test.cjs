'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../assets/life/core.js'), Model = require('../assets/life/public-cover.js');
const Blog = require('../assets/life/blog.js'), Photo = require('../assets/life/photo-post.js');
const Series = require('../assets/life/blog-series-public.js'), Reader = require('../assets/life/public-cover-reader.js');
const Remote = require('../assets/life/public-cover-remote.js');
const copy = value => structuredClone(value), now = '2026-10-19T00:00:00.000Z', baseURL = 'https://example.org/haedo/index.html';
const config = { url: 'https://synthetic-cover.supabase.co', key: 'sb_publishable_fixture' };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function fixture() {
  const workspaceId = Core.id(), cover = Model.create(Core.id); cover.title = '내 대표 결과'; cover.intro = '직접 공개할 소개';
  const state = { workspaceId, revision: 1, covers: [cover] }, rows = new Map(), blogRows = [], publicPosts = new Map(), receipts = new Map(), backing = new Map();
  const listeners = new Set(), stats = { calls: [], publicReads: [], puts: [], activeReads: 0, maxReads: 0, blogLists: 0 };
  const auth = { ready: true, config, epoch: 1, user: { id: Core.id() },
    async verify() { if (stats.verifyHook) { const hook = stats.verifyHook; stats.verifyHook = null; await hook(); } return auth.user; },
    onAccountChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    client: { rpc(name, params) { return { abortSignal() { return this; }, then(resolve, reject) { return rpc(name, params).then(resolve, reject); } }; } }
  };
  const receiptStorage = { getItem: key => backing.get(key) ?? null, setItem: (key, value) => backing.set(key, value), removeItem: key => backing.delete(key) };
  function metadata(row) { return row ? { status: row.status, revision: row.revision, publicId: row.publicId, updatedAt: row.updatedAt, lastOperationId: row.lastOperationId }
    : { status: 'missing', revision: 0, publicId: null, updatedAt: null, lastOperationId: null }; }
  async function rpc(name, params) {
    stats.calls.push({ name, params: copy(params) });
    if (name === 'life_public_page_get') return { data: metadata(rows.get(params.p_workspace_id)), error: null };
    if (name === 'life_public_page_list') {
      if (stats.pageSlice) return { data: stats.pageSlice(params.p_after), error: null };
      const all = [...rows.values()].filter(row => row.status === 'published').sort((a, b) => a.workspaceId.localeCompare(b.workspaceId));
      const at = params.p_after ? all.findIndex(row => row.workspaceId === params.p_after) + 1 : 0, page = all.slice(at, at + 50);
      return { data: { pages: page.map(row => ({ workspaceId: row.workspaceId, title: 'PRIVATE_OWNER_PAGE_TITLE', revision: row.revision,
        publicId: row.publicId, updatedAt: now, lastOperationId: row.lastOperationId })), nextCursor: at + page.length < all.length ? page.at(-1).workspaceId : null }, error: null };
    }
    assert.equal(name, 'life_public_page_put'); stats.puts.push(copy(params));
    if (stats.failBefore) { stats.failBefore = false; return { error: { status: 503 } }; }
    const prior = receipts.get(params.p_operation_id); if (prior) { assert.deepEqual(params, prior.params); return { data: copy(prior.result), error: null }; }
    const current = rows.get(params.p_workspace_id);
    if ((current?.revision || 0) !== params.p_expected_revision) return { data: { status: 'conflict', revision: current?.revision || 0 }, error: null };
    const published = params.p_action === 'publish', row = { workspaceId: params.p_workspace_id, status: published ? 'published' : 'revoked',
      publicId: published ? current?.publicId || Core.id() : null, revision: params.p_expected_revision + 1, updatedAt: now,
      lastOperationId: params.p_operation_id, snapshot: copy(params.p_snapshot) };
    rows.set(row.workspaceId, row);
    const result = { status: 'stored', revision: row.revision, publicId: row.publicId, published, updatedAt: now, action: params.p_action };
    receipts.set(params.p_operation_id, { params: copy(params), result: copy(result) });
    if (stats.loseAck) { stats.loseAck = false; return { error: { status: 503 } }; }
    return { data: result, error: null };
  }
  async function publicFetch(url, options) {
    const name = url.split('/').at(-1), args = JSON.parse(options.body);
    assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    stats.publicReads.push({ name, args }); stats.activeReads++; stats.maxReads = Math.max(stats.maxReads, stats.activeReads);
    await Promise.resolve();
    try {
      if (stats.publicError && (stats.publicError === args.p_public_id || stats.publicError === args.p_token)) return new Response('', { status: 503 });
      if (name === 'life_blog_public_read') return new Response(JSON.stringify(publicPosts.get(args.p_token) || null));
      assert.equal(name, 'life_public_page_read');
      const row = [...rows.values()].find(value => value.publicId === args.p_public_id && value.status === 'published');
      return new Response(JSON.stringify(row ? { status: 'published', publicId: row.publicId, revision: row.revision, updatedAt: now, snapshot: row.snapshot } : { status: 'missing' }));
    } finally { stats.activeReads--; }
  }
  const storage = { async readPublicCover() { return copy(state); } };
  const blogs = { async list(ws) { assert.equal(ws, null); stats.blogLists++; if (stats.blogListError) throw Object.assign(Error('private error detail'), { code: 'network_error' }); return copy(blogRows); } };
  async function addPost(title = '공개 글 제목') {
    const doc = Photo.create(Core.id); doc.title = title; doc.status = 'saved'; doc.revision = 1; doc.ops = [{ insert: '공개 본문🌱\n짧은 소개가 보입니다.\n' }];
    const token = Core.id(), blogToken = Core.id(), snapshot = await Blog.publicSnapshot(doc, { author: { name: '공개 이름', intro: 'AUTHOR_INTRO_NOT_TARGET' } });
    publicPosts.set(token, { token, blogToken, revision: 1, createdAt: now, updatedAt: now, snapshot });
    blogRows.push({ id: doc.id, workspace_id: Core.id(), revision: 7, title: 'PRIVATE_OWNER_POST_TITLE', publication: { active: true, token, blogToken, revision: 1 } });
    return token;
  }
  function addPage(snapshot, workspace = Core.id()) {
    const publicId = Core.id(); rows.set(workspace, { workspaceId: workspace, publicId, revision: 1, status: 'published', updatedAt: now, lastOperationId: Core.id(), snapshot: copy(snapshot) }); return publicId;
  }
  function nine(title = '공개 취향') { return { format: 'life-share-v1', title, intro: '공개 취향 소개', entries: [{ title: '고른 항목', pinned: false, note: null, parts: [],
    attachments: [{ type: 'book', title: '공개 책', creator: '공개 저자', url: 'https://example.org/book' }] }] }; }
  const manager = Remote.create({ auth, storage, workspaceId, receiptStorage, baseURL, blogRemote: blogs, publicFetch });
  function changeAccount() { auth.epoch++; auth.user = { id: Core.id() }; for (const listener of listeners) listener({ userId: auth.user.id }); }
  return { manager, auth, state, cover, rows, blogRows, publicPosts, receipts, backing, stats, addPost, addPage, nine, changeAccount, publicFetch,
    select(kind, id) { cover.items.push(Model.item(kind, id, Core.id)); }, metadata };
}
test('catalog uses only current public fields, classifies series before nine, excludes covers and retains partial successes', async () => {
  const f = await fixture(), post = await f.addPost(), series = f.addPage(Series.wrapper('공개 연재', '연재 소개', [post], baseURL)), nine = f.addPage(f.nine());
  const nested = Model.create(Core.id); nested.title = '다른 표지'; nested.items.push(Model.item('post', post, Core.id)); f.addPage(Model.project(nested, baseURL));
  f.addPage({ format: 'life-share-v1', title: '일반 원문 페이지', intro: null, entries: [] });
  const broken = f.addPage(f.nine('일시 오류')); f.stats.publicError = broken;
  const result = await f.manager.catalog();
  assert.deepEqual(new Set(result.items.map(row => row.kind + ':' + row.publicId)), new Set(['post:' + post, 'series:' + series, 'nine:' + nine]));
  assert.equal(result.items.find(row => row.kind === 'post').intro, ''); assert.equal(result.errors.length, 1);
  assert(!JSON.stringify(result).includes('PRIVATE_OWNER')); assert(!JSON.stringify(result).includes('AUTHOR_INTRO_NOT_TARGET'));
  assert(f.stats.maxReads <= 4); assert.equal(f.stats.publicReads.filter(row => row.name === 'life_blog_public_read').length, 1); f.manager.dispose();
});
test('prepare scans owner cursors but reads only selected targets and rejects unowned public pointers', async () => {
  const f = await fixture(), first = f.addPage(f.nine()), chosen = f.addPage(f.nine('선택한 공개 취향'));
  const entries = [...f.rows.values()], a = entries[0], b = entries[1];
  const ownerRow = row => ({ workspaceId: row.workspaceId, title: 'PRIVATE_OWNER_PAGE_TITLE', revision: row.revision, publicId: row.publicId, updatedAt: now, lastOperationId: row.lastOperationId });
  f.stats.pageSlice = after => after === null ? { pages: [ownerRow(a)], nextCursor: a.workspaceId } : { pages: [ownerRow(b)], nextCursor: null };
  f.select('nine', chosen); await f.manager.prepare(f.cover.id);
  assert.equal(f.stats.publicReads.length, 1); assert.equal(f.stats.publicReads[0].args.p_public_id, chosen); assert(!f.stats.publicReads.some(row => row.args.p_public_id === first));
  assert.equal(f.stats.calls.filter(call => call.name === 'life_public_page_list').length, 2);
  f.cover.items = [Model.item('nine', Core.id(), Core.id)];
  await assert.rejects(f.manager.prepare(f.cover.id), { code: 'selection_changed' }); assert.equal(f.stats.puts.length, 0); f.manager.dispose();
});
test('full frozen preview matches the anonymous reader and publication contains only approved pointer fields', async () => {
  const f = await fixture(), post = await f.addPost(), series = f.addPage(Series.wrapper('공개 연재', '연재 소개', [post], baseURL)), nine = f.addPage(f.nine());
  f.select('post', post); f.select('series', series); f.select('nine', nine);
  const review = await f.manager.prepare(f.cover.id); assert(Object.isFrozen(review.preview.items[0]));
  assert.equal(f.stats.puts.length, 0); const result = await f.manager.publish(review, { expectedRevision: 0 });
  assert.equal(result.status, 'stored'); assert.equal(result.state.status, 'published'); assert(new URL(result.url).searchParams.has('cover'));
  const reader = Reader.create({ config, fetch: f.publicFetch, baseURL }); const published = await reader.read(result.state.publicId);
  assert.deepEqual({ ...published, publicId: null, revision: 0 }, review.preview);
  const wire = JSON.stringify(f.stats.puts[0].p_snapshot);
  for (const value of ['PRIVATE_OWNER', 'AUTHOR_INTRO_NOT_TARGET', '공개 본문', f.cover.id, ...f.cover.items.map(item => item.id)]) assert(!wire.includes(value), value);
  assert.equal(f.stats.puts.length, 1); reader.dispose(); f.manager.dispose();
});
test('new publication checks target revisions and local CAS again after verified Auth yields', async () => {
  for (const change of ['local', 'target']) {
    const f = await fixture(), post = await f.addPost(); f.select('post', post); const review = await f.manager.prepare(f.cover.id);
    f.stats.verifyHook = async () => { if (change === 'local') { f.cover.intro = '승인하지 않은 변경'; f.state.revision++; }
      else { f.publicPosts.get(post).revision++; f.blogRows[0].publication.revision++; } };
    await assert.rejects(f.manager.publish(review, { expectedRevision: 0 }), { code: change === 'local' ? 'local_changed' : 'selection_changed' });
    assert.equal(f.stats.puts.length, 0); assert.equal(f.backing.size, 0); f.manager.dispose();
  }
});
test('unknown applied publication replays the identical receipt but reports conflict when the current cover head advanced', async () => {
  const f = await fixture(), post = await f.addPost(); f.select('post', post); const review = await f.manager.prepare(f.cover.id); f.stats.loseAck = true;
  await assert.rejects(f.manager.publish(review, { expectedRevision: 0 }), { code: 'publish_unknown' }); assert.equal(f.backing.size, 1);
  const original = copy(f.stats.puts[0]), current = f.rows.get(f.cover.id); current.revision = 2; current.lastOperationId = Core.id(); current.snapshot.title = '다른 기기의 최신 표지';
  f.publicPosts.delete(post); f.blogRows[0].publication.active = false; const publicReads = f.stats.publicReads.length;
  const result = await f.manager.retry(f.cover.id);
  assert.equal(result.status, 'conflict'); assert.equal(result.state.revision, 2); assert.equal(result.url, null);
  assert.deepEqual(f.stats.puts[1], original); assert.equal(f.stats.publicReads.length, publicReads); assert.equal(f.backing.size, 0); f.manager.dispose();
});
test('unapplied pending publication keeps frozen URLs across live target updates and cover revocation leaves targets unchanged', async () => {
  const f = await fixture(), post = await f.addPost(); f.select('post', post); const review = await f.manager.prepare(f.cover.id); f.stats.failBefore = true;
  await assert.rejects(f.manager.publish(review, { expectedRevision: 0 }), { code: 'publish_unknown' }); const original = copy(f.stats.puts[0]);
  f.blogRows[0].publication.active = false;
  await assert.rejects(f.manager.revoke(f.cover.id, { expectedRevision: 0 }), { code: 'pending_operation' });
  assert.equal(f.stats.puts.length, 1); assert.equal(f.backing.size, 1);
  f.blogRows[0].publication.active = true; f.blogRows[0].publication.revision = 2; f.publicPosts.get(post).revision = 2; f.publicPosts.get(post).snapshot.title = '갱신된 현재 공개 제목';
  const retried = await f.manager.retry(f.cover.id); assert.equal(retried.status, 'stored'); assert.deepEqual(f.stats.puts[1], original);
  const targetBefore = copy(f.publicPosts.get(post)); const revoked = await f.manager.revoke(f.cover.id, { expectedRevision: 1 });
  assert.equal(revoked.state.status, 'revoked'); assert.equal(revoked.url, null); assert.deepEqual(f.publicPosts.get(post), targetBefore); f.manager.dispose();
});
test('owner cursor cycles terminate before any unproven public target is read', async () => {
  const f = await fixture(), a = Core.id(), b = Core.id(), selected = Core.id(); f.select('nine', selected);
  const row = id => ({ workspaceId: id, title: '공개 목록', revision: 1, publicId: Core.id(), updatedAt: now, lastOperationId: Core.id() });
  f.stats.pageSlice = after => ({ pages: [row(after === a ? b : a)], nextCursor: after === a ? b : a });
  await assert.rejects(f.manager.prepare(f.cover.id), { code: 'selection_changed' });
  assert.equal(f.stats.calls.filter(call => call.name === 'life_public_page_list').length, 3); assert.equal(f.stats.publicReads.length, 0); f.manager.dispose();
});
test('account changes during verification cancel a reviewed publication before pending persistence or dispatch', async () => {
  const f = await fixture(), post = await f.addPost(); f.select('post', post); const review = await f.manager.prepare(f.cover.id), held = deferred(), started = deferred();
  f.stats.verifyHook = async () => { started.resolve(); await held.promise; };
  const publishing = f.manager.publish(review, { expectedRevision: 0 }), rejected = assert.rejects(publishing, { code: 'request_cancelled' });
  await started.promise; f.changeAccount(); held.resolve(); await rejected;
  assert.equal(f.stats.puts.length, 0); assert.equal(f.backing.size, 0); f.manager.dispose();
});
test('a withdrawn old target token cannot trap an unapplied cover update or prevent independent cover revocation', async () => {
  const f = await fixture(), target = f.addPage(f.nine()); f.select('nine', target);
  const first = await f.manager.publish(await f.manager.prepare(f.cover.id), { expectedRevision: 0 });
  assert.equal(first.state.status, 'published');
  f.cover.title = '검토한 표지 갱신'; f.state.revision++;
  const update = await f.manager.prepare(f.cover.id); f.stats.failBefore = true;
  await assert.rejects(f.manager.publish(update, { expectedRevision: 1 }), { code: 'publish_unknown' });
  const approved = copy(f.stats.puts[1]), targetRow = [...f.rows.values()].find(row => row.publicId === target);
  targetRow.status = 'revoked'; targetRow.publicId = null; targetRow.revision++;
  targetRow.status = 'published'; targetRow.publicId = Core.id(); targetRow.revision++; targetRow.lastOperationId = Core.id();
  const unchangedTarget = copy(targetRow), reads = f.stats.publicReads.length;
  const retried = await f.manager.retry(f.cover.id);
  assert.equal(retried.status, 'stored'); assert.equal(retried.state.revision, 2); assert.equal(f.backing.size, 0);
  assert.deepEqual(f.stats.puts[2], approved); assert.equal(f.stats.publicReads.length, reads);
  assert.equal(Model.parse(f.stats.puts[2].p_snapshot, baseURL).items[0].publicId, target);
  assert.notEqual(targetRow.publicId, target);
  const reader = Reader.create({ config, fetch: f.publicFetch, baseURL }), visible = await reader.read(retried.state.publicId);
  assert.equal(visible.items[0].status, 'missing'); assert.equal(visible.items[0].title, null); assert.equal(visible.items[0].url, null);
  const revoked = await f.manager.revoke(f.cover.id, { expectedRevision: 2 });
  assert.equal(revoked.state.status, 'revoked'); assert.equal(revoked.state.revision, 3); assert.equal(revoked.url, null);
  assert.deepEqual(targetRow, unchangedTarget); assert.equal(f.stats.puts.length, 4); reader.dispose(); f.manager.dispose();
});
