/* Independent integration transport: real application/IndexedDB and real isolated
 * PostgreSQL RPCs. Only Auth and Storage HTTP/binary delivery are simulated.
 * No production configuration, account, database or remote write is permitted. */
'use strict';
const { openBlogMenu } = require('./helpers/feature-menus.cjs');
process.env.BASE_URL ||= 'http://127.0.0.1:4196';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { spawnSync } = require('node:child_process'), { createHash } = require('node:crypto');
const { ShareCloud } = require('./life-share-browser.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const output = path.resolve(__dirname, '../.local/blog-completion');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// A photo publication uses life_blog_publish_copies (2026-11-02); text-only and HEIC-only use life_blog_publish.
const isPublish = rpc => rpc === 'life_blog_publish' || rpc === 'life_blog_publish_copies';
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const copy = value => JSON.parse(JSON.stringify(value));

class LocalSQLBlogCloud extends ShareCloud {
  constructor({ container, database }) {
    super();
    // Optional alternative to the network:none container: a disposable,
    // socket-only local cluster (no TCP listener) selected explicitly.
    const socket = process.env.BLOG_POSTGRES_SOCKET;
    this.local = socket ? { host: socket, port: process.env.BLOG_POSTGRES_PORT || '5432', bin: process.env.BLOG_POSTGRES_BIN || '/usr/lib/postgresql/16/bin' } : null;
    if (this.local) { assert(path.isAbsolute(socket) && !/^(?:\/var\/run|\/run)\b/.test(socket), 'A disposable socket directory is required.'); container ||= 'haedo-blog-postgres-0'; }
    assert.match(container || '', /^haedo-blog-postgres-[0-9]+$/, 'An explicit local fixture container is required.');
    assert.match(database || '', /^haedo_blog_qa(?:_[a-z0-9_]+)?$/, 'An independent QA-only database is required.');
    this.container = container; this.database = database; this.blogRequests = []; this.assetRequests = []; this.originals = new Map();
    this.failure = null; this.expectedFailures = 0; this.functions = new Map();
    this.dockerEnv = { ...process.env };
    for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete this.dockerEnv[key];
    if (this.local) return;
    const inspected = this.docker(['inspect', '--format', '{{json .HostConfig.NetworkMode}}\n{{json .HostConfig.PortBindings}}\n{{json .Config.Image}}', container]).trim().split('\n').map(JSON.parse);
    assert.equal(inspected[0], 'none'); assert.equal(Object.keys(inspected[1] || {}).length, 0);
    assert.match(inspected[2], /^postgres:17(?:[.-][A-Za-z0-9.-]+)?(?:@sha256:[a-f0-9]{64})?$/);
  }
  docker(args, input) {
    let value;
    if (this.local) {
      // Only `exec -i <fixture> psql|createdb ...` is translated to the local socket cluster.
      assert(args[0] === 'exec' && args[1] === '-i' && args[2] === this.container && ['psql', 'createdb'].includes(args[3]), 'Unsupported local fixture command');
      value = spawnSync(path.join(this.local.bin, args[3]), ['-h', this.local.host, '-p', this.local.port, ...args.slice(4)], { input, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    } else value = spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { input, env: this.dockerEnv, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (value.status !== 0) {
      const message = value.stderr || value.error?.message || 'Local SQL failed';
      const code = message.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1] || 'local_sql_error';
      throw Object.assign(new Error(message), { code });
    }
    return value.stdout;
  }
  sql(query, { owner = null, role = 'postgres' } = {}) {
    assert(['postgres', 'authenticated', 'anon', 'service_role'].includes(role));
    const claims = { role, ...(owner ? { sub: owner } : {}) };
    const source = '\\set VERBOSITY verbose\nbegin;\nset local "request.jwt.claims" = ' + literal(JSON.stringify(claims)) + ';\nset local role ' + role + ';\n' + query.replace(/;?\s*$/, ';') + '\ncommit;';
    const raw = this.docker(['exec', '-i', this.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', this.database], source);
    const line = raw.trim().split('\n').filter(Boolean).at(-1);
    return line ? JSON.parse(line) : null;
  }
  async initialize() {
    // The isolated auth.uid() shim needs only transaction-local synthetic claims.
    // No hosted Auth user/session or production JWT is copied into this fixture.
    const rows = this.sql(`select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'args',
      (select coalesce(jsonb_agg(jsonb_build_object('name',p.proargnames[i],'type',format_type(p.proargtypes[i-1],null)) order by i),'[]') from generate_subscripts(p.proargnames,1) i))), '[]')
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'life_blog_%';`);
    for (const row of rows) { assert(!this.functions.has(row.name), 'RPC overloads require explicit review'); this.functions.set(row.name, row.args); }
    assert(this.functions.has('life_blog_save') && this.functions.has('life_blog_public_read'), 'The real blog migration must be installed first.');
    this.objectColumns = new Set(this.sql("select jsonb_agg(column_name) from information_schema.columns where table_schema='storage' and table_name='objects';"));
  }
  typed(value, type) {
    assert(['uuid', 'text', 'jsonb', 'integer', 'bigint', 'boolean', 'text[]'].includes(type), 'Review the new SQL argument type: ' + type);
    if (value === null) return 'null::' + type;
    if (type === 'jsonb') return literal(JSON.stringify(value)) + '::jsonb';
    if (type === 'text[]') return 'array(select jsonb_array_elements_text(' + literal(JSON.stringify(value)) + '::jsonb))::text[]';
    return literal(String(value)) + '::' + type;
  }
  rpc(owner, name, input, role = owner ? 'authenticated' : 'anon') {
    assert.match(name, /^life_blog_[a-z_]+$/); const signature = this.functions.get(name); assert(signature, 'Unexpected unimplemented RPC: ' + name);
    const names = new Map(signature.map(item => [item.name, item.type]));
    for (const key of Object.keys(input)) assert(names.has(key), 'Client/SQL argument mismatch: ' + name + '.' + key);
    const args = Object.entries(input).map(([key, value]) => { assert.match(key, /^p_[a-z0-9_]+$/); return key + ' => ' + this.typed(value, names.get(key)); });
    return this.sql('select coalesce(to_jsonb(public.' + name + '(' + args.join(',') + ")), 'null'::jsonb);", { owner, role });
  }
  owner(request) {
    const bearer = request.headers().authorization?.replace(/^Bearer /i, '');
    try { const sub = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url')).sub; return Object.values(accounts).find(a => a.id === sub)?.id || null; }
    catch (_) { return null; }
  }
  async uploaded(request) {
    const bytes = request.postDataBuffer(), type = request.headers()['content-type'] || '';
    if (!type.startsWith('multipart/form-data')) return { bytes, type: type.split(';')[0] };
    const form = await new Request(request.url(), { method: 'POST', headers: { 'content-type': type }, body: bytes }).formData();
    const files = [...form.values()].filter(value => value instanceof Blob); assert.equal(files.length, 1);
    return { bytes: Buffer.from(await files[0].arrayBuffer()), type: files[0].type };
  }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url()), rpc = url.pathname.split('/').at(-1), owner = this.owner(request);
    // A device taken offline reaches neither the synthetic Auth nor the SQL/Storage transport.
    if (this.offlineDevices?.has(device) && request.method() !== 'OPTIONS') { this.expectedFailures++; return route.abort('failed'); }
    if (!url.pathname.startsWith('/rest/v1/rpc/life_blog_') && !url.pathname.startsWith('/storage/v1/object/') && url.pathname !== '/functions/v1/haedo-blog-media') return super.handle(route, device);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0' };
    const send = (value, status = 200) => route.fulfill({ status, headers, body: status === 204 ? '' : JSON.stringify(value) });
    if (request.method() === 'OPTIONS') return send(null, 204);
    try {
      if (url.pathname === '/functions/v1/haedo-blog-media') {
        assert.equal(request.method(), 'GET'); assert.equal(request.headers().authorization, undefined);
        const asset = this.rpc(null, 'life_blog_public_media', { p_token: url.searchParams.get('token'), p_photo_id: url.searchParams.get('photo') }, 'service_role');
        if (!asset) { this.expectedFailures++; return send({ message: 'Not found' }, 404); }
        const original = this.originals.get(asset.bucket + '/' + asset.path);
        assert(original && original.bytes.length === asset.size && digest(original.bytes) === asset.digest);
        return route.fulfill({ status: 200, headers: { ...headers, 'content-type': asset.type }, body: original.bytes });
      }
      if (url.pathname.startsWith('/rest/v1/rpc/life_blog_')) {
        assert.equal(request.method(), 'POST'); const body = request.postDataJSON(), anonymous = ['life_blog_public_read', 'life_blog_public_list'].includes(rpc);
        if (anonymous) assert.equal(request.headers().authorization, undefined, 'Anonymous reading must not attach a private session');
        this.blogRequests.push({ rpc, device, owner, body: copy(body) });
        const response = this.rpc(owner, rpc, body);
        if (this.failure === 'save-ack' && rpc === 'life_blog_save') { this.failure = null; this.expectedFailures++; return route.abort('failed'); }
        if (this.failure === 'publish-ack' && isPublish(rpc)) { this.failure = null; this.expectedFailures++; return route.abort('failed'); }
        return send(response);
      }
      assert(owner, 'Storage originals require the synthetic authenticated owner');
      const parts = url.pathname.split('/').slice(4).map(decodeURIComponent);
      if (parts[0] === 'authenticated') parts.shift();
      const bucket = parts.shift(), key = parts.join('/'); assert.equal(bucket, 'haedo-blog-originals');
      if (request.method() === 'DELETE' && !key) {
        // Storage API remove(): the real RLS policies decide which rows go.
        const names = request.postDataJSON()?.prefixes || [];
        this.assetRequests.push({ method: 'DELETE', owner, key: names.join(','), device });
        const removed = this.sql('with d as (delete from storage.objects where bucket_id=' + literal(bucket) + ' and name=any(array(select jsonb_array_elements_text(' + literal(JSON.stringify(names)) + '::jsonb))) returning name) select coalesce(jsonb_agg(name),\'[]\'::jsonb) from d;', { owner, role: 'authenticated' });
        for (const name of removed) this.originals.delete(bucket + '/' + name);
        return send(removed.map(name => ({ name })));
      }
      this.assetRequests.push({ method: request.method(), owner, key, device });
      if (request.method() === 'POST') {
        if (this.failure === 'upload') { this.failure = null; this.expectedFailures++; return send({ statusCode: '503', error: 'Synthetic upload failure', message: 'Synthetic upload failure' }, 503); }
        const original = await this.uploaded(request), columns = ['bucket_id', 'name', 'metadata'], values = [literal(bucket), literal(key), literal(JSON.stringify({ size: original.bytes.length, mimetype: original.type })) + '::jsonb'];
        if (this.objectColumns.has('owner')) { columns.push('owner'); values.push(literal(owner) + '::uuid'); }
        if (this.objectColumns.has('owner_id')) { columns.push('owner_id'); values.push(literal(owner)); }
        this.sql('insert into storage.objects(' + columns.join(',') + ') values(' + values.join(',') + ');', { owner, role: 'authenticated' });
        this.originals.set(bucket + '/' + key, original); return send({ Key: bucket + '/' + key, Id: key });
      }
      assert.equal(request.method(), 'GET');
      const visible = this.sql('select count(*) from storage.objects where bucket_id=' + literal(bucket) + ' and name=' + literal(key) + ';', { owner, role: 'authenticated' });
      const original = visible && this.originals.get(bucket + '/' + key);
      if (!original) return send({ message: 'Object not found' }, 404);
      return route.fulfill({ status: 200, headers: { ...headers, 'content-type': original.type }, body: original.bytes });
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      return send({ code: error.code || 'local_sql_error', message: error.message }, error.code === '42501' ? 403 : 400);
    }
  }
}

module.exports = { LocalSQLBlogCloud, digest, output };

async function main() {
  const argument = name => process.argv[process.argv.indexOf(name) + 1];
  const container = process.argv.includes('--container') ? argument('--container') : process.env.BLOG_POSTGRES_CONTAINER;
  const database = process.argv.includes('--database') ? argument('--database') : process.env.BLOG_POSTGRES_DATABASE;
  assert(container && database, 'Pass an explicit isolated --container and --database or BLOG_POSTGRES_CONTAINER/BLOG_POSTGRES_DATABASE.');
  assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'An explicitly selected loopback test server is required.');
  await fs.mkdir(output, { recursive: true });
  const server = new LocalSQLBlogCloud({ container, database });
  let migrationSha256 = null;
  if (process.argv.includes('--prepare-database')) {
    // createdb fails on an existing database; never replace another fixture.
    server.docker(['exec', '-i', container, 'createdb', '-U', 'postgres', database]);
    const bootstrap = await fs.readFile(path.resolve(__dirname, '../supabase/tests/blog-bootstrap.sql'), 'utf8');
    const migration = await fs.readFile(path.resolve(__dirname, '../supabase/migrations/20261017144744_life_blog_originals.sql'), 'utf8') + '\n' + await fs.readFile(path.resolve(__dirname, '../supabase/migrations/20261101091500_life_blog_account_sync.sql'), 'utf8') + '\n' + await fs.readFile(path.resolve(__dirname, '../supabase/migrations/20261101160000_life_blog_delete_guard.sql'), 'utf8') + '\n' + await fs.readFile(path.resolve(__dirname, '../supabase/migrations/20261102120000_life_blog_public_photo_copies.sql'), 'utf8');
    server.docker(['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', database], bootstrap + '\n' + migration);
    migrationSha256 = digest(Buffer.from(migration));
  }
  await server.initialize();
  const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, migrationSha256, syncScriptHashes: {}, syncScriptLoads: [],
    scope: 'Real local application/SDK/IndexedDB → intercepted synthetic HTTP → actual PostgreSQL RPCs/RLS in an independent network:none database. Auth and Storage binary/Edge delivery are simulated. No production, Google OAuth, Apple hardware or deployment claim.' };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const contexts = [], pages = [];
  async function device(name, seed = accounts.a) {
    const context = await makeContext(browser, server, name, seed, { viewport: { width: 1440, height: 1000 } }); contexts.push(context);
    await context.addInitScript(() => {
      window.__completionDB = []; window.__completionWrites = [];
      const open = IDBFactory.prototype.open; IDBFactory.prototype.open = function (...args) { __completionDB.push(args[0]); return open.apply(this, args); };
      const write = Storage.prototype.setItem; Storage.prototype.setItem = function (...args) { __completionWrites.push(args[0]); return write.apply(this, args); };
      // A check can park the background account sync cycle (explicit saves still send).
      const request = LockManager.prototype.request;
      LockManager.prototype.request = function (name, ...rest) { if (window.__parkBlogSync && String(name).startsWith('haedo-blog-sync:')) return Promise.resolve(rest.at(-1)(null)); return request.call(this, name, ...rest); };
    });
    await context.route('**/*', route => { const origin = new URL(route.request().url()).origin; if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push(origin); return route.abort(); });
    await context.route(base + '/assets/life/blog-sync.js', async route => { const response = await route.fetch(), bytes = await response.body(); report.syncScriptHashes[name] = digest(bytes); report.syncScriptLoads.push({ device: name, hash: digest(bytes) }); return route.fulfill({ response, body: bytes }); });
    const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(25000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', event => { if (event.type() !== 'error') return;
      const expectedTransport = event.location().url.startsWith(cloud) && /Failed to load resource:.*(?:503|ERR_FAILED)/.test(event.text());
      const expectedRevokedMedia = event.location().url.startsWith(cloud + '/functions/v1/haedo-blog-media') && /Failed to load resource:.*404/.test(event.text());
      if (expectedTransport || expectedRevokedMedia) report.expectedErrors++; else report.consoleErrors.push(event.text()); });
    return { context, page, name };
  }
  const owner = await device('completion-owner'), visitor = await device('completion-visitor', null), page = owner.page;
  const click = async (p, name) => { await p.getByRole('button', { name, exact: true }).click(); await settle(p); await p.waitForFunction(() => !document.querySelector('.blog-manager[aria-busy="true"]')); };
  const data = p => p.evaluate(async () => { const s = HaedoLife.Shell.storage, workspaceId = await s.getActive(), rows = await s.listPhotoPosts(workspaceId); return { workspaceId, rows, docs: await Promise.all(rows.map(row => s.readPhotoPost(workspaceId, row.id))) }; });
  const preserved = p => p.evaluate(async () => { const s = HaedoLife.Shell.storage, id = await s.getActive(); return { bundle: await s.read(id), workbench: await s.readWorkbench(id), nine: await s.readNineBoard(id), collection: await s.readCollection(id) }; });
  const manager = async p => { await openBlogMenu(p); await p.getByRole('button', { name: '글 공개·보관', exact: true }).click(); await p.locator('.blog-manager-list[data-state="ready"]').waitFor(); };
  const row = (p, id) => p.locator('.blog-post[data-post-id="' + id + '"]');
  const serverState = async (p, id, state = 'synced') => {
    await p.locator([].concat(state).map(value => '#photoServerStatus[data-post-id="' + id + '"][data-state="' + value + '"]').join(',')).waitFor();
  };
  const savedPost = async (p, title, images = [], { beforeSave, expectedServerState = 'synced' } = {}) => {
    await nav(p, 'home'); await p.locator('[data-home-destination="write"]:visible').click(); await p.locator('#photoTitle').fill(title);
    await p.locator('.ql-editor').fill('기억한 풍경을 내 말로 남깁니다. 🌱\n이 글만 직접 골라 공개합니다.');
    if (images.length) {
      await p.evaluate(() => { const q = Quill.find(document.querySelector('.ql-container')); q.setSelection(q.getLength() - 1, 0, 'silent'); });
      await p.locator('#photoFiles').setInputFiles(images); await p.locator('.photo-block').nth(images.length - 1).waitFor();
      for (let i = 0; i < images.length; i++) {
        await p.locator('.photo-block').nth(i).click();
        await p.getByRole('textbox', { name: '사진 설명', exact: true }).fill('직접 남긴 사진 설명 ' + i);
        const settings = p.locator('.photo-settings');
        if (!await settings.evaluate(node => node.open)) await settings.locator(':scope > summary').click();
        await p.getByRole('textbox', { name: '사진 대체 텍스트', exact: true }).fill('합성 원본 풍경 ' + i);
      }
    }
    if (beforeSave) await beforeSave();
    await click(p, '글 저장'); await p.locator('.photo-article').waitFor();
    const stored = await data(p), doc = stored.docs.find(value => value.title === title && value.status === 'saved'); assert(doc);
    await serverState(p, doc.id, expectedServerState);
    return { doc, workspaceId: stored.workspaceId };
  };
  const review = async (p, id, selected = []) => {
    await row(p, id).getByRole('button', { name: '공개 내용 검토', exact: true }).click(); await p.locator('.blog-manager-preview').waitFor();
    await p.getByRole('textbox', { name: '공개 이름', exact: true }).fill('익명 검수 블로그');
    await p.getByRole('textbox', { name: '공개 소개', exact: true }).fill('직접 고른 글만 보여 줍니다.');
    for (const id of selected) await p.locator('input[data-photo-id="' + id + '"]').check();
    await click(p, '공개 미리보기 갱신');
    await p.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check();
  };
  const publishedURL = async p => { await click(p, '공개 게시·갱신'); const link = p.getByRole('link', { name: '공개한 글 열기', exact: true }); await link.waitFor(); return link.getAttribute('href'); };
  const publicState = async (p, state) => p.waitForFunction(state => document.querySelector('#blogStatus')?.dataset.state === state, state);
  const syncState = (p, id) => p.evaluate(async id => { const s = HaedoLife.Shell.storage; return s.readBlogSyncState(await s.getActive(), id); }, id);
  const fingerprint = (p, id) => p.evaluate(async id => {
    const s = HaedoLife.Shell.storage, doc = await s.readPhotoPost(await s.getActive(), id);
    return { ...doc, photos: await Promise.all(doc.photos.map(async ({ blob, ...metadata }) => ({ ...metadata, actualHash: await HaedoLife.PhotoPost.digest(blob) }))) };
  }, id);
  // An 'online' event starts an immediate account sync cycle without backoff.
  const kick = p => p.evaluate(() => dispatchEvent(new Event('online')));
  // Emulates a backgrounded tab (e.g. another window in front, or CI): the
  // page reports hidden and receives the same visibilitychange event.
  const setHidden = (p, hidden) => p.evaluate(hidden => {
    for (const name of ['visibilityState', 'hidden']) Object.defineProperty(document, name, { configurable: true, get: () => name === 'hidden' ? hidden : hidden ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  const until = async (read, ok, label, timeout = 30000) => {
    const end = Date.now() + timeout; let value;
    do { value = await read(); if (ok(value)) return value; await new Promise(done => setTimeout(done, 100)); } while (Date.now() < end);
    assert.fail(label + ': last observation ' + JSON.stringify(value)?.slice(0, 500));
  };
  const syncLine = (p, id) => row(p, id).locator('[data-sync-post="' + id + '"]');
  const editPhotoPost = async (p, doc, title, prefix, { beforeSave, expectedServerState = 'synced' } = {}) => {
    await manager(p); await row(p, doc.id).getByRole('button', { name: doc.title, exact: true }).click(); await p.locator('.photo-article').waitFor();
    await click(p, '글 수정'); await p.locator('#photoTitle').fill(title);
    await p.evaluate(prefix => Quill.find(document.querySelector('.ql-container')).insertText(0, prefix, 'user'), prefix);
    if (beforeSave) await beforeSave();
    await click(p, '글 저장'); await p.locator('.photo-article').waitFor();
    const next = (await data(p)).docs.find(value => value.status === 'saved' && value.title === title);
    assert(next); assert.notEqual(next.id, doc.id); assert.deepEqual(next.photos.map(photo => photo.digest), doc.photos.map(photo => photo.digest));
    await serverState(p, next.id, expectedServerState);
    return next;
  };
  const capture = async (p, scene, selector) => {
    const inspect = require('./home-entry-browser.cjs').inspectHome;
    for (const width of [1440, 820, 390]) { await p.setViewportSize({ width, height: 1000 }); await p.evaluate(() => document.fonts.ready); const metrics = await p.evaluate(inspect, selector);
      assert.equal(metrics.horizontalOverflow, false); for (const key of ['smallTargets', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ' ' + key);
      const file = scene + '-' + width + '.png'; await p.screenshot({ path: path.join(output, file), fullPage: true }); report.visual.push({ scene, width, file, metrics }); }
  };
  const check = async (name, fn) => { console.log('START ' + name); try { await fn(); report.checks.push({ name, pass: true }); console.log('PASS ' + name); } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); throw error; } };
  let original, first, firstURL, firstToken, blogURL, photoPost, photoURL, photoToken;
  try {
    await page.goto(base + '/index.html'); await ready(page); await settle(page);
    await page.evaluate(async () => { const s = HaedoLife.Shell.storage, c = HaedoLife.Core, b = await s.read(await s.getActive()), p = await c.prepareImport({ origin: 'obsidian', title: '기존 원문', text: '\ufeff기존 원문은 바뀌지 않는다.\r\n정확한 위치 🌱', authorRelation: 'other' }, b); const result = await s.commitLocal({ operationId: c.id(), workspaceId: b.workspaceId, baseRevision: b.revision, changes: c.buildImportChanges(b, p, []) }); if (result.status !== 'stored') throw Error('Anonymous source seed failed'); });
    original = await preserved(page); const suffix = String(Date.now());
    await check('Default new text post stays private until explicit review; real SQL publication and anonymous blog/detail preserve all existing data', async () => {
      first = await savedPost(page, '새 작성기의 첫 공개 글 ' + suffix); assert.equal(first.doc.photos.length, 0);
      const privateSaves = server.blogRequests.filter(r => r.rpc === 'life_blog_save');
      assert.equal(privateSaves.length, 1); assert.equal(privateSaves[0].body.p_post_id, first.doc.id);
      assert.equal(privateSaves[0].body.p_workspace_id, first.workspaceId); assert.equal(privateSaves[0].body.p_expected_revision, 0);
      const firstPrivate = server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: first.doc.id });
      assert.equal(firstPrivate.revision, 1); assert.deepEqual(firstPrivate.data.ops, first.doc.ops); assert.equal(firstPrivate.publication, null);
      await manager(page); await review(page, first.doc.id); assert.equal(server.blogRequests.filter(r => isPublish(r.rpc)).length, 0);
      firstURL = await publishedURL(page); firstToken = new URL(firstURL).searchParams.get('post'); assert.notEqual(firstToken, first.doc.id);
      await visitor.page.goto(firstURL); await publicState(visitor.page, 'published'); assert.match(await visitor.page.locator('#blogContent').innerText(), /이 글만 직접 골라 공개/);
      const payload = server.rpc(null, 'life_blog_public_read', { p_token: firstToken }); assert.equal(payload.snapshot.title, first.doc.title);
      for (const privateValue of [accounts.a.id, accounts.a.email, first.workspaceId, first.doc.id, '기존 원문']) assert(!JSON.stringify(payload).includes(privateValue));
      assert.deepEqual(await visitor.page.evaluate(() => ({ db: __completionDB, writes: __completionWrites, auth: !!globalThis.HaedoAuth, storage: !!globalThis.HaedoLife?.Storage })), { db: [], writes: [], auth: false, storage: false });
      blogURL = await visitor.page.locator('#blogBack').getAttribute('href'); await visitor.page.locator('#blogBack').click(); await publicState(visitor.page, 'published');
      await visitor.page.locator('a[href="' + firstURL + '"]').click(); await publicState(visitor.page, 'published');
      assert.deepEqual(await preserved(page), original); await capture(visitor.page, 'first-public-text', '#blogContent');
    });
    await check('Private editing migrates the real local post binding; explicit update keeps the public address and stale public CAS cannot overwrite it', async () => {
      await click(page, '공개 검토 닫기'); await row(page, first.doc.id).getByRole('button', { name: first.doc.title, exact: true }).click(); await page.locator('.photo-article').waitFor();
      await click(page, '글 수정'); await page.locator('.ql-editor').fill('명시 갱신 뒤에만 보일 새 본문 🌿\n'); await click(page, '글 저장'); await page.locator('.photo-article').waitFor();
      const changed = (await data(page)).docs.find(doc => doc.title === first.doc.title && doc.status === 'saved'); assert(changed); assert.notEqual(changed.id, first.doc.id);
      await serverState(page, changed.id);
      await visitor.page.locator('#blogRefresh').click(); await publicState(visitor.page, 'published'); assert(!(await visitor.page.locator('#blogContent').innerText()).includes('명시 갱신 뒤에만'));
      const before = server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: first.doc.id });
      await manager(page); await review(page, changed.id); assert.equal(await publishedURL(page), firstURL);
      await visitor.page.locator('#blogRefresh').click(); await publicState(visitor.page, 'published'); assert.match(await visitor.page.locator('#blogContent').innerText(), /명시 갱신 뒤에만/);
      const latest = server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: first.doc.id });
      const stale = server.rpc(accounts.a.id, 'life_blog_publish', { p_post_id: first.doc.id, p_expected_revision: latest.revision, p_operation_id: require('node:crypto').randomUUID(), p_photo_ids: [], p_author: { name: '오래된 검토', intro: '' }, p_expected_publication_revision: before.publication.revision });
      assert.equal(stale.status, 'conflict'); assert.equal(server.rpc(null, 'life_blog_public_read', { p_token: firstToken }).snapshot.author.name, '익명 검수 블로그');
      first = { ...first, doc: changed }; assert.deepEqual(await preserved(page), original);
    });
    await check('Original-photo upload failure and a lost SQL save acknowledgement retain local bytes; the automatic retry replays the exact operation without duplicate writes', async () => {
      const images = await page.evaluate(() => [[4032, 3024, 'image/png'], [1200, 1800, 'image/jpeg']].map(([width, height, type], index) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const c = canvas.getContext('2d'); c.fillStyle = index ? '#f2decb' : '#cadfe1'; c.fillRect(0, 0, width, height); c.fillStyle = '#243b49'; c.font = '70px sans-serif'; c.fillText('익명 원본 사진 ' + index, 90, 200);
        return { width, height, type, data: canvas.toDataURL(type, .95).split(',')[1] };
      }));
      await page.evaluate(() => { window.__parkBlogSync = true; });
      photoPost = await savedPost(page, '선택한 원본 사진 글 ' + suffix, images.map((image, i) => ({ name: 'anonymous-original-' + i + (i ? '.jpg' : '.png'), mimeType: image.type, buffer: Buffer.from(image.data, 'base64') })), {
        beforeSave: () => { server.failure = 'upload'; }, expectedServerState: 'error'
      });
      assert.deepEqual(photoPost.doc.photos.map(photo => photo.digest), images.map(image => digest(Buffer.from(image.data, 'base64'))));
      const photoManifest = photoPost.doc.photos.map(({ blob, ...metadata }) => metadata);
      assert.equal(server.failure, null, 'The explicit save must reach and consume the original-upload failure');
      assert.equal(server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: photoPost.doc.id }), null);
      // The manager shows one compact status; its retry starts the same automatic cycle.
      await manager(page); await syncLine(page, photoPost.doc.id).filter({ hasText: '오류 · 다시 시도' }).waitFor();
      server.failure = 'save-ack'; await page.evaluate(() => { window.__parkBlogSync = false; });
      await syncLine(page, photoPost.doc.id).getByRole('button', { name: '다시 시도', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.blog-manager[aria-busy="true"]'));
      assert.equal(server.failure, null, 'the retry commits SQL and loses its acknowledgement');
      const committed = server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: photoPost.doc.id }); assert.equal(committed.revision, 1);
      const pendingState = await page.evaluate(({ workspaceId, id }) => HaedoLife.Shell.storage.readBlogSyncState(workspaceId, id), { workspaceId: photoPost.workspaceId, id: photoPost.doc.id });
      const uploadCount = server.assetRequests.filter(r => r.method === 'POST').length;
      if (pendingState.pending) await kick(page);
      const state = await until(() => page.evaluate(({ workspaceId, id }) => HaedoLife.Shell.storage.readBlogSyncState(workspaceId, id), { workspaceId: photoPost.workspaceId, id: photoPost.doc.id }), value => !value.pending && value.status === 'synced', 'lost acknowledgement replayed');
      assert.equal(state.remoteRevision, 1);
      const saves = server.blogRequests.filter(r => r.rpc === 'life_blog_save' && r.body.p_post_id === photoPost.doc.id);
      assert(saves.length >= 2); assert(saves.every(save => save.body.p_operation_id === saves[0].body.p_operation_id), 'every retry reuses the exact operation');
      assert.equal(server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: photoPost.doc.id }).revision, 1);
      assert.equal(server.assetRequests.filter(r => r.method === 'POST').length, uploadCount, 'An acknowledged original must not be uploaded twice on save retry');
      await syncLine(page, photoPost.doc.id).filter({ hasText: '모든 기기에 저장됨' }).waitFor({ timeout: 35000 }).catch(async () => { await manager(page); await syncLine(page, photoPost.doc.id).filter({ hasText: '모든 기기에 저장됨' }).waitFor(); });
      const checked = await page.evaluate(async ({ workspaceId, id }) => { const d = await HaedoLife.Shell.storage.readPhotoPost(workspaceId, id); return Promise.all(d.photos.map(async ({ blob, ...metadata }) => ({ metadata, actualHash: await HaedoLife.PhotoPost.digest(blob) }))); }, { workspaceId: photoPost.workspaceId, id: photoPost.doc.id });
      assert.deepEqual(checked.map(value => value.metadata), photoManifest); assert.deepEqual(checked.map(value => value.actualHash), photoManifest.map(photo => photo.digest));
      assert.deepEqual(await preserved(page), original); report.originalPhotos = images.map(image => ({ width: image.width, height: image.height, type: image.type }));
    });
    await check('Only the chosen photo reaches the anonymous snapshot as a full-resolution metadata-free copy; revoked direct image URLs stop serving it', async () => {
      await review(page, photoPost.doc.id, [photoPost.doc.photos[0].id]); photoURL = await publishedURL(page); photoToken = new URL(photoURL).searchParams.get('post');
      const snapshot = server.rpc(null, 'life_blog_public_read', { p_token: photoToken }).snapshot; assert.equal(snapshot.photos.length, 1); assert.notEqual(snapshot.photos[0].id, photoPost.doc.photos[0].id);
      assert(!JSON.stringify(snapshot).includes('anonymous-original-')); assert(!JSON.stringify(snapshot).includes(photoPost.doc.photos[1].digest));
      await visitor.page.goto(photoURL); await publicState(visitor.page, 'published');
      const image = visitor.page.locator('#blogContent img'); assert.equal(await image.count(), 1); await image.scrollIntoViewIfNeeded(); await image.evaluate(node => node.decode());
      assert.equal(await image.getAttribute('alt'), '합성 원본 풍경 0');
      assert.equal(await visitor.page.locator('#blogContent figcaption').innerText(), '직접 남긴 사진 설명 0');
      assert(!JSON.stringify(snapshot).includes('직접 남긴 사진 설명 1'));
      assert.deepEqual(await image.evaluate(node => [node.naturalWidth, node.naturalHeight]), [4032, 3024]); const src = await image.getAttribute('src');
      const actualHash = await visitor.page.evaluate(async url => { const bytes = await (await fetch(url, { credentials: 'omit', cache: 'no-store' })).arrayBuffer(); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join(''); }, src);
      // 2026-11-02: the served bytes are the published copy, never the original.
      assert.equal(actualHash, snapshot.photos[0].digest); assert.notEqual(snapshot.photos[0].digest, photoPost.doc.photos[0].digest);
      await visitor.page.getByRole('button', { name: '사진 원본 크기로 보기', exact: true }).click(); assert.equal(await visitor.page.locator('.blog-photo-original').count(), 1);
      await visitor.page.getByRole('button', { name: '사진 화면에 맞추기', exact: true }).click(); await capture(visitor.page, 'public-original-photo', '#blogContent');
      await click(page, '공개 철회'); await visitor.page.locator('#blogRefresh').click(); await publicState(visitor.page, 'missing'); assert.equal(await visitor.page.locator('#blogContent').innerText(), '');
      assert.equal(await visitor.page.evaluate(async url => (await fetch(url, { credentials: 'omit', cache: 'no-store' })).status, src), 404);
      assert.equal(server.rpc(null, 'life_blog_public_media', { p_token: photoToken, p_photo_id: snapshot.photos[0].id }, 'service_role'), null);
      await visitor.page.goto(blogURL); await publicState(visitor.page, 'published'); assert.equal(await visitor.page.locator('a[href="' + photoURL + '"]').count(), 0); assert.equal(await visitor.page.locator('a[href="' + firstURL + '"]').count(), 1);
      assert.deepEqual(await preserved(page), original);
    });
    await check('A second authenticated browser receives the post automatically under the same identities; edits, a two-device conflict, a lost receipt, explicit publication and deletion follow the account', async () => {
      const remotePostId = photoPost.doc.id, readRemote = () => server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: remotePostId });
      const second = await device('completion-second-owner'); await second.page.goto(base + '/index.html'); await ready(second.page); await settle(second.page); const before = await preserved(second.page);
      // No button: the background sync of the second browser installs it in place.
      const received = await until(async () => (await data(second.page)).docs.find(doc => doc.id === remotePostId), Boolean, 'second browser receives the saved post');
      assert.equal(received.status, 'saved'); assert.equal(received.title, photoPost.doc.title);
      assert.deepEqual(received.photos.map(photo => [photo.id, photo.digest]), photoPost.doc.photos.map(photo => [photo.id, photo.digest]));
      await nav(second.page, 'home'); await second.page.locator('#homePosts [data-photo-post-id="' + remotePostId + '"]').waitFor();
      const backup = await second.page.evaluate(async id => { const s = HaedoLife.Shell.storage, m = HaedoLife.PhotoPost, ws = await s.getActive(), doc = await s.readPhotoPost(ws, id), zip = await m.backup(doc), restored = await m.readBackup(zip, HaedoLife.Core.id); const saved = await s.savePhotoPost(ws, restored, 0); return { originalId: doc.id, restoredId: saved.id, status: saved.status, hashes: await Promise.all(saved.photos.map(photo => HaedoLife.PhotoPost.digest(photo.blob))), text: HaedoLife.PhotoPost.plainText(saved), captions: saved.ops.filter(op => op.insert?.photo).map(op => ({ caption: op.insert.photo.caption, alt: op.insert.photo.alt })) }; }, remotePostId);
      assert.notEqual(backup.originalId, backup.restoredId); assert.equal(backup.status, 'draft'); assert.deepEqual(backup.hashes, photoPost.doc.photos.map(photo => photo.digest)); assert.match(backup.text, /기억한 풍경/);
      assert.deepEqual(backup.captions, [0, 1].map(i => ({ caption: '직접 남긴 사진 설명 ' + i, alt: '합성 원본 풍경 ' + i })));
      assert.deepEqual(await preserved(second.page), before); assert.deepEqual(await preserved(page), original);
      const foreign = await device('completion-foreign', accounts.b); await foreign.page.goto(base + '/index.html'); await ready(foreign.page); await kick(foreign.page);
      await foreign.page.waitForTimeout(1500); assert.deepEqual((await data(foreign.page)).docs, [], 'another account receives nothing');
      assert.equal(server.rpc(accounts.b.id, 'life_blog_read', { p_post_id: remotePostId }), null);
      assert.throws(() => server.rpc(null, 'life_blog_read', { p_post_id: remotePostId }), error => error.code === '42501');
      const firstAsset = readRemote().assets[photoPost.doc.photos[0].id];
      assert.equal(server.sql('select count(*) from storage.objects where bucket_id=' + literal(firstAsset.bucket) + ' and name=' + literal(firstAsset.path) + ';', { owner: accounts.b.id, role: 'authenticated' }), 0);
      assert.throws(() => server.rpc(null, 'life_blog_public_media', { p_token: photoToken, p_photo_id: '00000000-0000-4000-8000-000000000000' }), error => error.code === '42501');
      // Publication stays explicit on whichever device chooses it.
      await manager(second.page); await review(second.page, remotePostId, [received.photos[0].id]);
      const receivedURL = await publishedURL(second.page), receivedToken = new URL(receivedURL).searchParams.get('post');
      assert.notEqual(receivedURL, photoURL, 'Republishing after withdrawal must not reactivate the revoked address');
      assert.equal(server.rpc(null, 'life_blog_public_read', { p_token: photoToken }), null);
      const receivedPublic = server.rpc(null, 'life_blog_public_read', { p_token: receivedToken }).snapshot;
      assert.equal(receivedPublic.photos.length, 1); assert.notEqual(receivedPublic.photos[0].id, received.photos[0].id);
      assert.notEqual(receivedPublic.photos[0].digest, received.photos[0].digest); assert(!JSON.stringify(receivedPublic).includes(received.photos[1].digest));
      await visitor.page.goto(receivedURL); await publicState(visitor.page, 'published');
      const receivedImage = visitor.page.locator('#blogContent img'); assert.equal(await receivedImage.count(), 1);
      await receivedImage.scrollIntoViewIfNeeded(); await receivedImage.evaluate(node => node.decode());
      assert.deepEqual(await receivedImage.evaluate(node => [node.naturalWidth, node.naturalHeight]), [4032, 3024]);
      assert.equal(await receivedImage.getAttribute('alt'), '합성 원본 풍경 0');
      const receivedSrc = await receivedImage.getAttribute('src');
      assert.equal(await visitor.page.evaluate(async url => { const bytes = await (await fetch(url, { credentials: 'omit', cache: 'no-store' })).arrayBuffer(); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join(''); }, receivedSrc), receivedPublic.photos[0].digest);
      await click(second.page, '공개 철회'); await visitor.page.locator('#blogRefresh').click(); await publicState(visitor.page, 'missing');
      assert.equal(await visitor.page.evaluate(async url => (await fetch(url, { credentials: 'omit', cache: 'no-store' })).status, receivedSrc), 404);
      report.continuity = [];
      const phase = name => { const remote = readRemote(); report.continuity.push({ name, remoteRevision: remote?.revision || 0, publicationRevision: remote?.publication?.revision || 0 }); console.log('CONTINUITY ' + name); };
      const currentOf = async p => (await data(p)).docs.find(doc => doc.status === 'saved' && doc.id === remotePostId) ||
        (await p.evaluate(async id => { const s = HaedoLife.Shell.storage, ws = await s.getActive(); for (const row of await s.listPhotoPosts(ws)) { const state = await s.readBlogSyncState(ws, row.id); if (state?.remoteId === id && row.status === 'saved') return s.readPhotoPost(ws, row.id); } return null; }, remotePostId));
      phase('Automatic receipt, foreign-account isolation and explicit publication on the receiving browser');

      // B edits; A shows the edit in place without any choice.
      const editedB = await editPhotoPost(second.page, received, 'B에서 다듬은 여행 글 ' + suffix, 'B에서 이어 쓴 첫 수정\n');
      assert.equal(readRemote().data.title, editedB.title);
      await kick(page);
      const atA = await until(() => currentOf(page), doc => doc?.title === editedB.title, 'A applies the B edit in place');
      assert.deepEqual(atA.photos.map(photo => photo.digest), editedB.photos.map(photo => photo.digest));
      phase('B edit reaches A in place');

      // Both devices change the post while A is offline: the later edit stays
      // and the earlier one is kept as a separate draft on every device.
      (server.offlineDevices ||= new Set()).add(owner.name);
      const editedA = await editPhotoPost(page, atA, 'A가 오프라인에서 먼저 쓴 글 ' + suffix, 'A의 오프라인 문장\n', { expectedServerState: ['error', 'pending'] });
      assert.equal(readRemote().data.title, editedB.title, 'nothing left the offline device');
      // A's tab goes to the background (its one hidden flush runs now, while
      // still offline); it stays hidden when it comes back online below.
      await setHidden(page, true);
      await new Promise(done => setTimeout(done, 1100));
      const laterB = await editPhotoPost(second.page, await currentOf(second.page), 'B가 나중에 다듬은 글 ' + suffix, 'B의 나중 문장\n');
      // A comes back online while its tab is still in the background: its kept
      // conflict copy must reach the account without the tab in front.
      server.offlineDevices.delete(owner.name); await kick(page);
      const keptA = await until(async () => (await data(page)).docs.find(doc => doc.status === 'draft' && doc.title === '충돌로 보관한 이전 내용 · ' + editedA.title), Boolean, 'A keeps its earlier edit as a draft');
      assert((await data(page)).docs.some(doc => doc.status === 'saved' && doc.title === laterB.title), 'the later B edit is in place on A');
      assert.equal(readRemote().data.title, laterB.title); assert(keptA.ops[0].insert.startsWith('A의 오프라인 문장\n'));
      await until(async () => server.sql("select count(*) from haedo_blog_private.posts where data->>'status'='draft' and data->>'title'=" + literal(keptA.title) + ';'), count => count === 1, 'the kept draft reaches the account');
      await setHidden(page, false);
      await kick(second.page);
      await until(async () => (await data(second.page)).docs.some(doc => doc.status === 'draft' && doc.title === keptA.title), Boolean, 'the kept draft reaches B');
      phase('A two-device conflict keeps both versions on both devices');

      // A lost save acknowledgement replays the same operation once more.
      const latestA = await until(() => currentOf(page), doc => doc?.title === laterB.title, 'A current post');
      const revisionBefore = readRemote().revision;
      const editedLost = await editPhotoPost(page, latestA, 'A의 응답 유실 수정 ' + suffix, 'A의 응답 유실 문장\n', { beforeSave: () => { server.failure = 'save-ack'; }, expectedServerState: 'error' });
      assert.equal(server.failure, null); assert.equal(readRemote().revision, revisionBefore + 1); assert.equal(readRemote().data.title, editedLost.title);
      const pending = (await syncState(page, editedLost.id)).pending; assert(pending);
      const uploadsAfterSave = server.assetRequests.filter(request => request.method === 'POST').length;
      await kick(page); await until(() => syncState(page, editedLost.id), state => state && !state.pending && state.status === 'synced', 'lost receipt replayed');
      const sameSave = server.blogRequests.filter(request => request.rpc === 'life_blog_save' && request.body.p_operation_id === pending.operationId);
      assert(sameSave.length >= 2); assert(sameSave.every(request => JSON.stringify(request.body) === JSON.stringify(sameSave[0].body)));
      assert.equal(readRemote().revision, revisionBefore + 1); assert.equal(server.assetRequests.filter(request => request.method === 'POST').length, uploadsAfterSave);
      phase('A lost save receipt replays the exact operation without another revision or upload');

      // Independent public CAS and a lost publication receipt (unchanged contract).
      await manager(page); await review(page, editedLost.id, [editedLost.photos[0].id]);
      const continuityURL = await publishedURL(page), continuityToken = new URL(continuityURL).searchParams.get('post');
      await click(page, '공개 검토 닫기'); await review(page, editedLost.id, [editedLost.photos[0].id]);
      const beforePublicRace = readRemote(), publicationCalls = server.blogRequests.filter(request => isPublish(request.rpc)).length;
      const otherPublication = server.rpc(accounts.a.id, 'life_blog_publish', { p_post_id: remotePostId, p_expected_revision: beforePublicRace.revision,
        p_operation_id: require('node:crypto').randomUUID(), p_photo_ids: [], p_author: { name: '다른 기기의 명시 공개', intro: '글만 직접 공개했습니다.' }, p_expected_publication_revision: beforePublicRace.publication.revision });
      assert.equal(otherPublication.status, 'stored');
      const publicRaceWinner = server.rpc(null, 'life_blog_public_read', { p_token: continuityToken });
      await click(page, '공개 게시·갱신');
      assert.equal(server.blogRequests.filter(request => isPublish(request.rpc)).length, publicationCalls, 'A stale public preview must be rejected before another publication RPC');
      assert.deepEqual(server.rpc(null, 'life_blog_public_read', { p_token: continuityToken }), publicRaceWinner);
      await click(page, '공개 검토 닫기'); await review(page, editedLost.id, [editedLost.photos[0].id]);
      server.failure = 'publish-ack'; await click(page, '공개 게시·갱신');
      const publishPending = await syncState(page, editedLost.id); assert(publishPending.publishPending);
      const committedPublic = server.rpc(null, 'life_blog_public_read', { p_token: continuityToken });
      assert.equal(await publishedURL(page), continuityURL);
      const repeatedPublish = server.blogRequests.filter(request => isPublish(request.rpc) && request.body.p_operation_id === publishPending.publishPending.operationId);
      assert.equal(repeatedPublish.length, 2); assert.deepEqual(repeatedPublish[0].body, repeatedPublish[1].body);
      assert.deepEqual(server.rpc(null, 'life_blog_public_read', { p_token: continuityToken }), committedPublic);
      assert.equal(committedPublic.snapshot.photos.length, 1); assert.notEqual(committedPublic.snapshot.photos[0].digest, editedLost.photos[0].digest, 'the public photo is a copy');
      await visitor.page.goto(continuityURL); await publicState(visitor.page, 'published');
      const finalImage = visitor.page.locator('#blogContent img'); await finalImage.scrollIntoViewIfNeeded(); await finalImage.evaluate(node => node.decode());
      const finalSrc = await finalImage.getAttribute('src');
      await capture(visitor.page, 'continuity-final-public', '#blogContent');
      await click(page, '공개 철회'); await visitor.page.locator('#blogRefresh').click(); await publicState(visitor.page, 'missing');
      assert.equal(await visitor.page.evaluate(async url => (await fetch(url, { credentials: 'omit', cache: 'no-store' })).status, finalSrc), 404);
      phase('Independent public CAS and a lost publication receipt preserve exact selection until replay and withdrawal');

      // Explicit deletion on A removes the private post and its originals
      // through real SQL and Storage RLS, then disappears from B.
      const paths = Object.values(readRemote().assets).map(asset => asset.path);
      await manager(page); page.once('dialog', dialog => dialog.accept());
      await row(page, editedLost.id).getByRole('button', { name: '삭제', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.blog-manager[aria-busy="true"]'));
      assert(!(await data(page)).docs.some(doc => doc.id === editedLost.id));
      await kick(page); await until(async () => readRemote() === null, Boolean, 'server deletion');
      await until(async () => server.sql('select count(*) from storage.objects where name=any(array(select jsonb_array_elements_text(' + literal(JSON.stringify(paths)) + '::jsonb)));'), count => count === 0, 'deleted originals removed');
      await kick(second.page);
      await until(async () => !(await data(second.page)).docs.some(doc => doc.id === remotePostId), Boolean, 'B removes the deleted post');
      assert((await data(second.page)).docs.some(doc => doc.title === keptA.title), 'the separately kept draft is not affected');
      await nav(second.page, 'home'); await second.page.locator('#homePosts[aria-busy="false"]').waitFor();
      assert.equal(await second.page.locator('#homePosts [data-photo-post-id="' + remotePostId + '"]').count(), 0, 'the deleted post leaves the other home feed');
      await capture(second.page, 'continuity-after-delete', '#lifeHome'); await second.page.setViewportSize({ width: 1440, height: 1000 });
      assert.deepEqual(await preserved(second.page), before); assert.deepEqual(await preserved(page), original);
      phase('Explicit deletion reaches the server, its originals and the other device');
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
    report.pass = true;
  } catch (error) { report.pass = false; await page.screenshot({ path: path.join(output, 'failure-owner.png'), fullPage: true }).catch(() => {}); throw error; }
  finally { report.realSqlRpcCalls = server.blogRequests.length; report.originalUploads = server.assetRequests.filter(r => r.method === 'POST').length; report.expectedTransportFailures = server.expectedFailures;
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await Promise.all(contexts.map(context => context.close())); await browser.close(); }
  console.log('Blog completion: ' + report.checks.length + ' journeys; actual isolated SQL/IDB; no production claims.');
}

if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
