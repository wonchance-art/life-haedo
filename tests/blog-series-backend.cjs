'use strict';
/* Existing RPCs only, actual PostgreSQL. Never accepts production connections. */
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto'), fs = require('node:fs/promises'), path = require('node:path');
const { LocalSQLSeriesCloud } = require('./blog-series-sql-fixture.cjs'), { accounts } = require('./life-sync-browser.cjs');
const Remote = require('../assets/life/blog-series-remote.js'), Public = require('../assets/life/blog-series-public.js'), BlogPublic = require('../assets/life/blog-public.js'), ShareRemote = require('../assets/life/share-remote.js'), Photo = require('../assets/life/photo-post.js'), Blog = require('../assets/life/blog.js');
async function main() {
  const server = new LocalSQLSeriesCloud({ container: process.env.BLOG_POSTGRES_CONTAINER, database: process.env.BLOG_POSTGRES_DATABASE + '_series_contract' });
  await server.prepare(); await server.initialize(); const calls = [], owner = accounts.a.id, backing = new Map(), out = path.resolve(__dirname, '../.local/blog-series-backend'); await fs.mkdir(out, { recursive: true });
  let drop = false;
  const auth = { ready: true, config: { url: 'https://anonymous.supabase.co', key: 'sb_publishable_fixture' }, user: { id: owner }, epoch: 0, async verify() { return auth.user; }, onAccountChange() { return () => {}; }, client: { rpc(name, args) {
    calls.push({ name, args: structuredClone(args) });
    return { abortSignal() { return this; }, async then(resolve, reject) { try { const data = server.rpc(auth.user.id, name, args); if (drop && name === 'life_public_page_put') { drop = false; throw TypeError('lost acknowledgement'); } return resolve({ data, error: null }); } catch (error) { return reject(error); } } };
  } } };
  const fetch = async (url, options) => Response.json(server.rpc(null, new URL(url).pathname.split('/').at(-1), JSON.parse(options.body)));
  const config = auth.config, baseURL = 'https://anonymous.example/app/index.html';
  const remote = Remote.create({ auth, baseURL, publicReader: BlogPublic.createReader({ config, fetch }), storage: { getItem: key => backing.get(key) ?? null, setItem: (key, value) => backing.set(key, value), removeItem: key => backing.delete(key) } });
  const readers = () => Public.createReader({ baseURL, shareReader: ShareRemote.createReader({ config, fetch }), blogReader: BlogPublic.createReader({ config, fetch }) });
  const report = { checks: [], calls: [], pass: false, scope: 'Actual isolated PostgreSQL existing page/blog RPCs and JS decoders; synthetic auth/SDK/fetch; no hosted service or operational writes.' };
  async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS ' + name); }
  const workspace = randomUUID(), docs = [];
  try {
    for (let index = 0; index < 3; index++) {
      const doc = Photo.create(randomUUID); doc.status = 'saved'; doc.revision = 1; doc.title = '공개 여행 ' + index; doc.ops = [{ insert: '공개 본문 ' + index + '\n' }];
      const manifest = await Blog.pack(doc); assert.equal(server.rpc(owner, 'life_blog_save', { p_workspace_id: workspace, p_post_id: doc.id, p_expected_revision: 0, p_operation_id: randomUUID(), p_data: manifest }).status, 'stored');
      const pub = index < 2 ? server.rpc(owner, 'life_blog_publish', { p_post_id: doc.id, p_expected_revision: 1, p_operation_id: randomUUID(), p_photo_ids: [], p_author: { name: '익명 작성자', intro: '' }, p_expected_publication_revision: 0 }) : null;
      docs.push({ doc, pub });
    }
    const series = { id: randomUUID(), revision: 1, title: '두 편의 여행 연재', intro: '명시 선택 순서', items: docs.map(({ doc }, index) => ({ id: 'item-' + index, postId: doc.id, postRevision: 1, title: doc.title })) };
    let review, published, reader;
    await check('own active selection only; new independent wrapper preserves existing workspace page and all private posts', async () => {
      assert.equal((await remote.ownerListPublished()).length, 2);
      await assert.rejects(remote.prepare(series, [{ entryId: 'item-2', token: randomUUID() }]), { code: 'invalid_selection' });
      const prior = server.rpc(owner, 'life_public_page_put', { p_workspace_id: workspace, p_expected_revision: 0, p_operation_id: randomUUID(), p_action: 'publish', p_snapshot: { format: 'life-share-v1', title: '기존 개인 페이지', intro: null, entries: [] } });
      review = await remote.prepare(series, [{ entryId: 'item-1', token: docs[1].pub.token }, { entryId: 'item-0', token: docs[0].pub.token }]);
      published = await remote.publish(review, { expectedRevision: 0 }); assert.equal(published.status, 'stored');
      assert.deepEqual(server.rpc(null, 'life_public_page_read', { p_public_id: prior.publicId }).snapshot.entries, []);
      assert.equal(server.rpc(owner, 'life_public_page_get', { p_workspace_id: workspace }).revision, 1);
      assert.deepEqual(server.rpc(owner, 'life_blog_list', { p_workspace_id: workspace }).map(row => row.revision), [1, 1, 1]);
      const snapshot = server.rpc(null, 'life_public_page_read', { p_public_id: published.publicId }).snapshot;
      assert.deepEqual(Public.parseWrapper(snapshot, baseURL), docs.slice(0, 2).map(row => row.pub.token));
      for (const { doc } of docs) assert(!JSON.stringify(snapshot).includes(doc.id));
    });
    await check('anonymous gets only selected current bodies; child revocation does not leave a copied title or body', async () => {
      reader = readers(); const value = await reader.read(published.publicId, { post: docs[1].pub.token }); assert.equal(value.post.snapshot.title, docs[1].doc.title);
      assert.equal(server.rpc(owner, 'life_blog_unpublish', { p_post_id: docs[1].doc.id, p_expected_revision: 1, p_operation_id: randomUUID() }).status, 'stored');
      const revoked = await reader.read(published.publicId, { post: docs[1].pub.token }); assert.equal(revoked.post, null); assert.equal(revoked.entries[1].title, null); assert.equal(revoked.entries[0].available, true);
      await assert.rejects(reader.read(published.publicId, { post: randomUUID() }), { code: 'invalid_request' }); reader.dispose();
    });
    await check('actual CAS conflict and exact lost-response receipt replay never duplicate a wrapper', async () => {
      review = await remote.prepare(series, [{ entryId: 'item-0', token: docs[0].pub.token }]);
      const conflict = await remote.publish(review, { expectedRevision: 0 }); assert.equal(conflict.status, 'conflict');
      drop = true; await assert.rejects(remote.publish(review, { expectedRevision: 1 }), { code: 'publish_unknown' });
      assert((await remote.getState(series.id)).pending); const first = calls.filter(row => row.name === 'life_public_page_put').at(-1);
      const replay = await remote.retry(series.id); assert.equal(replay.revision, 2); assert.equal(replay.publicId, published.publicId);
      assert.deepEqual(calls.filter(row => row.name === 'life_public_page_put').at(-1), first);
      assert.equal(server.sql('select count(*) from public.life_public_pages;'), 2);
    });
    await check('series revoke affects no independently public post; republish changes only series token; foreign owner cannot read its state', async () => {
      assert.equal((await remote.revoke(series.id, { expectedRevision: 2 })).status, 'stored');
      reader = readers(); assert.deepEqual(await reader.read(published.publicId), { status: 'missing' }); reader.dispose();
      assert(server.rpc(null, 'life_blog_public_read', { p_token: docs[0].pub.token }));
      const again = await remote.publish(review, { expectedRevision: 3 }); assert.notEqual(again.publicId, published.publicId);
      assert.equal(server.rpc(accounts.b.id, 'life_public_page_get', { p_workspace_id: series.id }).status, 'missing');
      assert.throws(() => server.rpc(null, 'life_public_page_get', { p_workspace_id: series.id }), error => error.code === '42501');
      assert.equal(server.sql('select count(*) from public.life_public_pages;'), 2);
    });
    report.pass = true;
  } finally { remote.dispose(); report.calls = calls.map(row => row.name); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
