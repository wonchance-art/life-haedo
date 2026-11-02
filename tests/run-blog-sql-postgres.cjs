/* Disposable local PostgreSQL only. No endpoint, account, SQL, or credential options.
 * node tests/run-blog-sql-postgres.cjs   (after npm ci --prefix tests/sql-ci)
 *
 * The SQL part of scripts/check-blog-backend.mjs without Docker, on the installed
 * server binaries (/usr/lib/postgresql/<n>/bin):
 *  1. blog-bootstrap.sql + the blog migrations up to 20261101160000, then
 *     blog-originals.sql (failures 0) and blog-installation.sql (all true).
 *  2. 20261102120000_life_blog_public_photo_copies.sql (when present), then
 *     blog-public-copies.sql; re-running the 2026-11-01 blog migrations alone
 *     keeps every result, and so does re-applying the copy migration.
 *  3. Served bytes, end to end: real SQL + the real haedo-blog-media handler +
 *     an in-memory Storage. Synthetic GPS-bearing JPEG/PNG/WebP/HEIC originals
 *     (tests/fixtures/photo-metadata.cjs). Whatever an outdated client manages to
 *     publish, no served byte may carry EXIF/GPS/XMP; copies are served, a copy
 *     that still carries metadata is refused, and originals stay private and
 *     byte-identical. Before the copy migration this step fails at the first
 *     check (the JPEG original with GPS is served).
 */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');
const pgStub = require('./helpers/supabase-pg-stub.cjs');
const F = require('./fixtures/photo-metadata.cjs');
if (process.argv.length !== 2) throw Error('No endpoint, account, SQL, or credential options are accepted.');
const ROOT = pgStub.ROOT, file = name => path.join(ROOT, name);
const BEFORE = ['supabase/tests/blog-bootstrap.sql', 'supabase/migrations/20261017144744_life_blog_originals.sql',
  'supabase/migrations/20261101091500_life_blog_account_sync.sql', 'supabase/migrations/20261101160000_life_blog_delete_guard.sql'];
// Applied in production before the copy migration (PR #169). Its own install file
// is re-applied after the 2026-11-01 bundle (documented procedure).
const AUTHORSHIP = 'supabase/migrations/20261102110000_life_blog_ai_authorship.sql';
const COPIES = 'supabase/migrations/20261102120000_life_blog_public_photo_copies.sql';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pass = name => console.log('PASS ' + name);
const result = rows => [].concat(rows).filter(r => r.rows?.length).at(-1).rows[0].result;

async function main() {
  if (!pgStub.findPostgres()) {
    if (process.env.SQL_REPLAY_REQUIRED === '1') throw Error('no local PostgreSQL server binaries');
    console.log('SKIP blog SQL: no local PostgreSQL server binaries. Nothing was checked.'); return;
  }
  const pg = await pgStub.startCluster({ label: 'blog-sql' });
  try {
    const db = await pg.connect();
    try {
      for (const name of BEFORE) await pgStub.applyFile(db, file(name));
      const authorshipPresent = fs.existsSync(file(AUTHORSHIP));
      if (authorshipPresent) await pgStub.applyFile(db, file(AUTHORSHIP));
      const originals = result(await pgStub.applyFile(db, file('supabase/tests/blog-originals.sql')));
      assert.equal(originals.failures, 0);
      const ai = authorshipPresent ? result(await pgStub.applyFile(db, file('supabase/tests/blog-ai-authorship.sql'))) : null;
      if (ai) { assert.equal(ai.failures, 0); pass(`blog-ai-authorship.sql ${ai.passed} assertions`); }
      const aiStillPrivate = async label => { if (ai) { assert.deepEqual(result(await pgStub.applyFile(db, file('supabase/tests/blog-ai-authorship.sql'))), ai, label); } };
      const installed = result(await pgStub.applyFile(db, file('supabase/tests/blog-installation.sql')));
      assert.deepEqual(Object.entries(installed).filter(([, ok]) => ok !== true), [], 'installation checks');
      pass(`blog-originals.sql ${originals.passed} assertions, blog-installation.sql ${Object.keys(installed).length} checks`);
      const copiesPresent = fs.existsSync(file(COPIES));
      if (copiesPresent) {
        await pgStub.applyFile(db, file(COPIES));
        const copies = result(await pgStub.applyFile(db, file('supabase/tests/blog-public-copies.sql')));
        assert.equal(copies.failures, 0);
        pass(`blog-public-copies.sql ${copies.passed} assertions`);
        // Every publication now goes through publish_copies: AI marks must still stay private.
        await aiStillPrivate('after the copy migration');
        if (ai) pass('blog-ai-authorship.sql still passes after the copy migration (no AI mark reaches a public snapshot)');
        // The 2026-11-01 install bundle re-runs these two files (and authorship is re-applied
        // after it); right after that (copy migration not re-applied) both rules must hold.
        for (const name of BEFORE.slice(2)) await pgStub.applyFile(db, file(name));
        if (authorshipPresent) await pgStub.applyFile(db, file(AUTHORSHIP));
        assert.deepEqual(result(await pgStub.applyFile(db, file('supabase/tests/blog-public-copies.sql'))), copies);
        assert.deepEqual(result(await pgStub.applyFile(db, file('supabase/tests/blog-installation.sql'))), installed);
        await aiStillPrivate('after re-running the 2026-11-01 files');
        pass('re-running the 2026-11-01 blog migrations does not undo the copy rule or the AI rule');
        await pgStub.applyFile(db, file(COPIES));
        assert.deepEqual(result(await pgStub.applyFile(db, file('supabase/tests/blog-public-copies.sql'))), copies);
        await aiStillPrivate('after re-applying the copy migration');
        pass('re-applying the copy migration keeps every result');
      } else console.log('NOTE ' + COPIES + ' is absent: checking the earlier contract only');
      await servedBytes(db, copiesPresent);
    } finally { await db.end(); }
  } finally { await pg.stop(); }
}

async function servedBytes(db, copiesPresent) {
  const source = fs.readFileSync(file('supabase/functions/haedo-blog-media/index.ts'), 'utf8');
  const edge = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
  const owner = randomUUID(), workspace = randomUUID(), post = randomUUID(), objects = new Map();
  const as = async (role, sub, sql, params = []) => {
    await db.query('begin');
    try {
      if (role !== 'postgres') await db.query('set local role ' + role);
      await db.query("select set_config('request.jwt.claims',$1,true)", [sub ? JSON.stringify({ sub, role }) : '']);
      const value = (await db.query(sql, params)).rows[0]?.value; await db.query('commit'); return value;
    } catch (error) { await db.query('rollback'); throw error; }
  };
  const rpc = (name, args) => as('authenticated', owner, `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as value`, args);
  const handler = edge.createHandler({ environment: key => key === 'SUPABASE_URL' ? 'https://anonymous-blog.example.invalid' : 'synthetic-server-only-secret',
    fetcher: async (url, options) => {
      if (url.includes('/rest/v1/rpc/life_blog_public_media')) {
        const { p_token, p_photo_id } = JSON.parse(options.body);
        return Response.json(await as('service_role', null, 'select public.life_blog_public_media($1,$2) as value', [p_token, p_photo_id]) ?? null);
      }
      const key = decodeURIComponent(url.split('/haedo-blog-originals/')[1]), object = objects.get(key);
      if (!object) return new Response(null, { status: 404 });
      return new Response(object.bytes, { headers: { 'Content-Type': object.type, 'Content-Length': String(object.bytes.length) } });
    } });
  const store = async (photoId, bytes, type, width, height, register = 'life_blog_prepare_asset') => {
    const digest = sha(bytes), asset = await rpc(register, [post, photoId, digest, bytes.length, type, width, height]);
    objects.set(asset.path, { bytes: Buffer.from(bytes), type });
    await as('postgres', null, "insert into storage.objects(bucket_id,name,owner_id,metadata) values('haedo-blog-originals',$1,$2,$3)", [asset.path, owner, { size: bytes.length, mimetype: type }]);
    return { digest, size: bytes.length, type, width, height, path: asset.path };
  };
  // Synthetic originals with invented GPS/EXIF/XMP, and the HEIC's clean JPEG view.
  const sources = {
    jpeg: { bytes: F.jpegWithGps(F.JPEG_8X8), type: 'image/jpeg', width: 8, height: 8 },
    png: { bytes: F.pngWithGps(F.png(4, 3)), type: 'image/png', width: 4, height: 3 },
    webp: { bytes: F.webpWithGps(F.WEBP_8X8, { width: 8, height: 8 }), type: 'image/webp', width: 8, height: 8 },
    heic: { bytes: F.heicWithGps(), type: 'image/heic', width: 8, height: 8 },
  };
  for (const value of Object.values(sources)) assert(F.leaks(value.bytes).length, 'every synthetic original carries location metadata');
  const photos = [];
  for (const [id, value] of Object.entries(sources)) {
    const stored = await store(id, value.bytes, value.type, value.width, value.height);
    const photo = { id, name: 'private-' + id, type: value.type, width: value.width, height: value.height, size: stored.size, digest: stored.digest };
    if (id === 'heic') { const view = await store(id, F.JPEG_8X8, 'image/jpeg', 8, 8); photo.view = { type: 'image/jpeg', size: view.size, digest: view.digest, width: 8, height: 8 }; }
    photos.push(photo);
  }
  const doc = { format: 'life-photo-post-v2', id: post, revision: 1, title: 'GPS 표본 네 장', status: 'saved', replaces: null, createdAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z',
    ops: [{ insert: '네 형식\n' }, ...photos.map(p => ({ insert: { photo: { id: p.id, caption: p.id, alt: '' } } })), { insert: '\n' }], photos, attachments: [], archived: false };
  assert.equal((await rpc('life_blog_save', [workspace, post, 0, randomUUID(), doc])).status, 'stored');
  const author = { name: '익명', intro: '' }, all = photos.map(p => p.id);
  const serve = async token => {
    const snapshot = (await as('anon', null, 'select public.life_blog_public_read($1) as value', [token]))?.snapshot;
    const out = [];
    for (const photo of snapshot?.photos || []) {
      const response = await handler(new Request(`https://anonymous-edge.example.invalid/?token=${token}&photo=${photo.id}`));
      out.push({ status: response.status, bytes: Buffer.from(await response.arrayBuffer()), photo });
    }
    return out;
  };
  const noLeak = (served, label) => {
    for (const item of served.filter(entry => entry.status === 200))
      assert.deepEqual(F.leaks(item.bytes), [], `${label}: served ${item.photo.type} bytes carry EXIF/GPS/XMP`);
  };

  // 1. An outdated client publishes every photo through the earlier RPC.
  let outdated = null, refusal = null;
  try { outdated = await rpc('life_blog_publish', [post, 1, randomUUID(), all, author, 0]); } catch (error) { refusal = error; }
  if (outdated?.token) {
    const served = await serve(outdated.token);
    noLeak(served, 'outdated client');
    await rpc('life_blog_unpublish', [post, outdated.revision, randomUUID()]);
  }
  assert.equal(refusal?.message, 'life_blog_public_copy_required', 'an outdated client cannot publish a JPEG/PNG/WebP original');
  pass('an outdated client publishing originals is refused; nothing with GPS is served');
  assert(copiesPresent);

  // 2. The current client publishes copies (canvas output stand-ins without metadata).
  // The HEIC copy is made from its view (here: the view without its colour profile).
  const copyBytes = { jpeg: F.stripJpeg(sources.jpeg.bytes), png: F.png(4, 3), webp: F.stripJpeg(sources.jpeg.bytes), heic: F.stripJpeg(F.JPEG_8X8) };
  const copies = {};
  for (const [id, bytes] of Object.entries(copyBytes)) {
    const type = bytes[0] === 0xff ? 'image/jpeg' : 'image/png', stored = await store(id, bytes, type, sources[id].width, sources[id].height, 'life_blog_publish_prepare_copy');
    copies[id] = { type, size: stored.size, digest: stored.digest, width: stored.width, height: stored.height };
  }
  const published = await rpc('life_blog_publish_copies', [post, 1, randomUUID(), all, author, 0, copies]);
  let served = await serve(published.token);
  assert.deepEqual(served.map(item => item.status), [200, 200, 200, 200]);
  noLeak(served, 'copies');
  assert.deepEqual(served.map(item => sha(item.bytes)), [copies.jpeg.digest, copies.png.digest, copies.webp.digest, copies.heic.digest], 'the served bytes are exactly the registered copies');
  assert(!served.some(item => [photos[3].digest, photos[3].view.digest].includes(sha(item.bytes))), 'neither the HEIC original nor its view is served');
  for (const item of served) assert(edge.metadataFree(item.photo.type, item.bytes));
  for (const [id, value] of Object.entries(sources)) assert.equal(sha(objects.get(`${owner}/${post}/${id}/${sha(value.bytes)}`).bytes), sha(value.bytes), id + ' original stays byte-identical');
  assert.equal(Number(await as('anon', null, "select count(*)::int as value from storage.objects where bucket_id='haedo-blog-originals'")), 0, 'anonymous callers read no private object');
  pass('copies of JPEG, PNG, WebP and HEIC are served without metadata; originals stay private and byte-identical');

  // 3. A copy that still carries metadata (a client defect) is never served.
  const tainted = F.pngWithGps(F.png(4, 3, [9, 9, 9, 255])), bad = await store('png', tainted, 'image/png', 4, 3, 'life_blog_publish_prepare_copy');
  const republished = await rpc('life_blog_publish_copies', [post, 1, randomUUID(), ['png'], author, published.revision,
    { png: { type: 'image/png', size: bad.size, digest: bad.digest, width: 4, height: 3 } }]);
  served = await serve(republished.token);
  assert.deepEqual(served.map(item => item.status), [502], 'a tainted copy is refused by the media handler');
  pass('the media handler refuses a registered copy whose bytes still carry EXIF/GPS/XMP');

  // 4. Withdrawal stops the direct image URL.
  await rpc('life_blog_unpublish', [post, republished.revision, randomUUID()]);
  const stale = await handler(new Request(`https://anonymous-edge.example.invalid/?token=${republished.token}&photo=${served[0].photo.id}`));
  assert.equal(stale.status, 404);
  pass('a withdrawn photo URL returns 404');
}

main().catch(error => { console.error('FAIL blog SQL: ' + (error.stack || error.message)); process.exitCode = 1; });
