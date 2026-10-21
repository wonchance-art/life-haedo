'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Core = require('../assets/life/core.js');
const Model = require('../assets/life/naver-blog.js');
const Sync = require('../assets/life/naver-blog-sync.js');
const owner = { userId: '10000000-0000-4000-8000-000000000001', projectUrl: 'https://naver-fixture.invalid' };
const sha = text => createHash('sha256').update(text).digest('hex');
function fixture() {
  let bundle = Core.createWorkspace(), commits = 0;
  const env = { ready: true, enabled: false, current: true, held: null, rows: [], conflict: false };
  const sub = { id: Core.id(), workspace_id: bundle.workspaceId, blog_id: 'example_haedo', revision: 1, enabled: false };
  const auth = { epoch: 1, user: { id: owner.userId }, getAccount: () => ({ ...owner }), async verify() { return auth.user; },
    client: { async rpc(name, args) {
      if (env.held) await env.held;
      if (name === 'life_naver_list') return { data: { ready: env.ready, has_more: false, next_cursor: null,
        subscriptions: [{ ...sub, enabled: env.enabled }], items: structuredClone(env.rows) } };
      if (name === 'life_naver_save') return { data: { ...sub, blog_id: args.p_blog_id, enabled: args.p_enabled } };
      throw Error('Unexpected RPC');
    } } };
  const storage = { isAccountScoped: true, account: owner, async read() { return structuredClone(bundle); },
    async commitLocal(request, options = {}) {
      assert.equal(options.isCurrent?.(), true);
      if (env.conflict) { env.conflict = false; return { status: 'conflict' }; }
      if (request.baseRevision !== bundle.revision) return { status: 'conflict' };
      bundle = Core.applyChanges(bundle, request.changes); commits++; return { status: 'stored' };
    } };
  const service = Sync.create({ storage, auth, core: Core, model: Model, isCurrent: () => env.current });
  function item(logNo, overrides = {}) {
    const text = '\ufeff수집한 글 🌱\r\n그대로 보관 ' + logNo;
    return { id: Core.id(), owner_id: owner.userId, subscription_id: sub.id, blog_id: sub.blog_id, log_no: logNo,
      title: '합성 글 ' + logNo, url: 'https://blog.naver.com/' + sub.blog_id + '/' + logNo,
      content_text: text, content_hash: sha(text), published_at: null, fetched_at: '2026-10-21T01:00:00.000Z', coverage: 'partial', ...overrides };
  }
  return { env, auth, service, storage, item, sub, get bundle() { return structuredClone(bundle); }, get commits() { return commits; },
    async seed(input) { const prepared = await Core.prepareImport(input, bundle); bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared)); return prepared; } };
}
test('explicit inbox receive preserves actual bytes, retries CAS, and concurrent replay adds one source only', async () => {
  const f = fixture(); const row = f.item('123456'); f.env.rows = [row]; f.env.conflict = true;
  const results = await Promise.all([f.service.receive(f.sub.workspace_id, row.id), f.service.receive(f.sub.workspace_id, row.id)]);
  assert.equal(results[0].sourceId, results[1].sourceId); assert.equal(f.commits, 1);
  assert.equal(f.bundle.sources.length, 1); assert.equal(f.bundle.sourceVersions[0].contentText, row.content_text);
  assert.equal(f.bundle.sourceVersions[0].coverage.status, 'partial');
  assert.equal(f.bundle.sourceVersions[0].originalAuthor.relation, 'unknown'); f.service.dispose();
});
test('opt-in projects only new items and never replaces existing full or partial originals', async () => {
  const f = fixture(); const prior = [];
  for (const [logNo, coverage] of [['100001', 'full_text'], ['100002', 'partial']]) {
    prior.push(await f.seed({ origin: 'naver_blog', title: '옛 자료', text: '원래 본문 ' + logNo, coverage,
      url: 'https://m.blog.naver.com/example_haedo/' + logNo }));
  }
  const before = f.bundle; f.env.rows = [f.item('100001'), f.item('100002'), f.item('100003')];
  assert.equal((await f.service.list(f.sub.workspace_id)).receivedCount, 0); assert.equal(f.commits, 0);
  f.env.enabled = true;
  assert.equal((await f.service.list(f.sub.workspace_id)).receivedCount, 1); assert.equal(f.commits, 1);
  assert.equal((await f.service.list(f.sub.workspace_id)).receivedCount, 0); assert.equal(f.commits, 1);
  assert.deepEqual(f.bundle.sources.slice(0, 2), before.sources); assert.deepEqual(f.bundle.sourceVersions.slice(0, 2), before.sourceVersions);
  assert.equal(f.bundle.sources.length, 3); f.service.dispose();
});
test('wrong-owner item, a mismatched hash, and invented coverage are rejected before any local write', async () => {
  for (const overrides of [{ owner_id: Core.id() }, { content_hash: '0'.repeat(64) }, { coverage: 'full_text' }]) {
    const f = fixture(); f.env.enabled = true; f.env.rows = [f.item('100001', overrides)];
    await assert.rejects(f.service.list(f.sub.workspace_id)); assert.equal(f.commits, 0); f.service.dispose();
  }
});
test('late list after same-account navigation or auth epoch change cannot auto-materialize', async () => {
  for (const cancel of [f => { f.env.current = false; }, f => { f.auth.epoch++; }]) {
    const f = fixture(); let release; f.env.enabled = true; f.env.rows = [f.item('100001')];
    f.env.held = new Promise(resolve => { release = resolve; });
    const pending = f.service.list(f.sub.workspace_id); await new Promise(resolve => setImmediate(resolve)); cancel(f); release();
    await assert.rejects(pending, { code: 'naver_cancelled' }); assert.equal(f.commits, 0); f.service.dispose();
  }
});
test('server not ready never auto-receives even if a stale subscription says enabled', async () => {
  const f = fixture(); f.env.enabled = true; f.env.ready = false; f.env.rows = [f.item('100001')];
  const result = await f.service.list(f.sub.workspace_id);
  assert.equal(result.ready, false); assert.equal(result.receivedCount, 0); assert.equal(f.commits, 0); f.service.dispose();
});
