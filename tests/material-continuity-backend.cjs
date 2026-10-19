'use strict';
/* Disposable, network-isolated PostgreSQL only. No hosted project or real user. */
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { randomUUID, createHash } = require('node:crypto'), { spawn } = require('node:child_process');
const { LocalSQLBlogCloud } = require('./blog-completion-browser.cjs');
const Core = require('../assets/life/core.js'), Writing = require('../assets/life/material-writing.js'), Model = require('../assets/life/material-continuity.js');
const Ref = require('../assets/life/source-reference.js'), Photo = require('../assets/life/photo-post.js');
const Remote = require('../assets/life/material-continuity-remote.js'), Platform = require('../assets/platform-life-remote.js');
const migration = 'supabase/migrations/20261019005829_life_material_continuity.sql';
const out = path.resolve(__dirname, '../.local/material-continuity');
const q = value => value === null ? 'null' : "'" + String(value).replaceAll("'", "''") + "'";
const json = value => q(JSON.stringify(value)) + '::jsonb';
const copy = value => structuredClone(value);
async function main() {
  if (process.argv.slice(2).some(value => value !== '--prepare-database')) throw Error('Only --prepare-database is supported.');
  const database = process.env.BLOG_POSTGRES_DATABASE ? process.env.BLOG_POSTGRES_DATABASE + '_contract' : 'haedo_blog_qa_material_contract_' + Date.now();
  assert(database.length <= 63, 'An independent PostgreSQL database name of at most 63 characters is required.');
  const server = new LocalSQLBlogCloud({ container: process.env.BLOG_POSTGRES_CONTAINER, database });
  const report = { checks: [], scope: 'Isolated actual PostgreSQL, real verified-client adapter and exact source model. Synthetic identities only; no hosted Supabase or real Auth/Storage claim.', network: 'none', publishedHostPorts: 0 };
  let created = false, remote;
  const psql = source => server.docker(['exec', '-i', server.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', database], source);
  const owner = randomUUID(), foreign = randomUUID(); let user = owner, heldRPC = null; const calls = [];
  function rpc(name, args, role = 'authenticated', uid = user) {
    const types = { p_id: 'uuid', p_operation_id: 'uuid', p_expected_revision: 'bigint', p_data: 'jsonb', p_after_updated_at: 'timestamptz', p_after_id: 'uuid' };
    assert(['life_material_get', 'life_material_put', 'life_material_list'].includes(name));
    const fields = Object.entries(args).map(([key, value]) => { assert(types[key]); return key + '=>' + (types[key] === 'jsonb' ? json(value) : q(value) + '::' + types[key]); });
    return server.sql('select public.' + name + '(' + fields.join(',') + ');', { owner: uid, role });
  }
  const auth = { ready: true, epoch: 0, user: { id: owner }, config: { url: 'https://anonymous.supabase.co', key: 'sb_publishable_fixture' },
    async verify() { return auth.user; }, onAccountChange() { return () => {}; }, client: { auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } }, rpc(name, args) {
      calls.push({ name, args: copy(args) }); return { abortSignal() { return this; }, then(resolve, reject) { return (async () => { if (heldRPC) { const wait = heldRPC; heldRPC = null; await wait; } return { data: rpc(name, args), error: null }; })().then(resolve, reject); } };
    } } };
  const check = async (name, fn) => { await fn(); report.checks.push(name); console.log('PASS ' + name); };
  async function concurrentPut(id, expected, data) {
    const sql = 'begin;set local role authenticated;select set_config(\'request.jwt.claims\',' + q(JSON.stringify({ sub: owner, role: 'authenticated' })) + ',true);select public.life_material_put(' + q(id) + '::uuid,' + q(randomUUID()) + '::uuid,' + expected + ',' + json(data) + ');commit;';
    return new Promise((resolve, reject) => {
      const child = spawn('docker', ['--host=unix:///var/run/docker.sock', 'exec', '-i', server.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', database], { env: server.dockerEnv });
      let stdout = '', stderr = ''; const timer = setTimeout(() => { child.kill(); reject(Error('Bounded isolated SQL concurrency timeout')); }, 30000);
      child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; }); child.on('error', reject);
      child.on('close', status => { clearTimeout(timer); if (status) reject(Error(stderr)); else { const values = stdout.trim().split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch (_) { return []; } }); resolve(values.find(v => v?.status)); } }); child.stdin.end(sql);
    });
  }
  async function holdBlogSave(sql) {
    const child = spawn('docker', ['--host=unix:///var/run/docker.sock', 'exec', '-i', server.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', database], { env: server.dockerEnv });
    let stdout = '', stderr = '', entered, failEntry;
    const ready = new Promise((yes, no) => { entered = yes; failEntry = no; });
    const timer = setTimeout(() => { child.kill(); failEntry(Error('Bounded isolated blog row-lock timeout')); }, 30000);
    const done = new Promise((yes, no) => { child.on('error', no); child.on('close', status => { clearTimeout(timer); status ? no(Error(stderr)) : yes(); }); });
    child.stdout.on('data', value => { stdout += value; if (stdout.includes('BLOG_LOCKED')) entered(); }); child.stderr.on('data', value => { stderr += value; });
    child.on('error', failEntry); child.on('close', status => { if (status) failEntry(Error(stderr)); });
    child.stdin.write('begin;set local role authenticated;select set_config(\'request.jwt.claims\',' + q(JSON.stringify({ sub: owner, role: 'authenticated' })) + ',true);' + sql + "select 'BLOG_LOCKED';\n");
    await ready; return { async release() { child.stdin.end('commit;\n'); await done; } };
  }
  try {
    await fs.mkdir(out, { recursive: true }); server.docker(['exec', server.container, 'createdb', '-U', 'postgres', database]); created = true;
    for (const file of ['supabase/tests/blog-bootstrap.sql', 'supabase/migrations/20261017144744_life_blog_originals.sql', migration]) psql(await fs.readFile(path.resolve(__dirname, '..', file), 'utf8'));
    psql(await fs.readFile(path.resolve(__dirname, '..', migration), 'utf8'));
    remote = Remote.create({ auth, model: Model, clientFactory: Platform.clientFactory });
    let bundle = Core.createWorkspace();
    const raw = '\ufeff🌱 머리\r\n정확한 옛 구절🌿\r\n다음 문단\r\n선택한 원문 전체';
    const first = await Core.prepareImport({ origin: 'obsidian', title: '정확한 선택 자료', text: raw, fileName: 'notes/선택.md', url: 'https://example.org/exact', authorRelation: 'unknown' }, bundle); bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, first));
    const latest = await Core.prepareImport({ origin: 'obsidian', title: first.source.title, text: '다른 최신 본문', existingSourceId: first.source.id, authorRelation: 'unknown' }, bundle); bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, latest));
    const link = await Core.prepareImport({ origin: 'other', title: '선택한 링크 자료', url: 'https://example.org/link', authorRelation: 'unknown' }, bundle); bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, link));
    const template = bundle.sources.find(s => s.id === first.source.id), version = bundle.sourceVersions.find(v => v.id === latest.version.id);
    for (let i = 0; i < 3000; i++) { const sourceId = randomUUID(); bundle.sources.push({ ...template, id: sourceId, sourceKey: 'unselected/' + i + '.md', title: '미선택 자료 ' + i }); bundle.sourceVersions.push({ ...version, id: randomUUID(), sourceId }); }
    const plan = Writing.create(randomUUID); plan.title = '하나의 준비'; plan.question = '명시 전송한 비공개 질문';
    const material = Writing.material(bundle, first.source.id, first.version.id, randomUUID); material.note = '명시 전송한 비공개 메모'; plan.materials.push(material, Writing.material(bundle, link.source.id, link.version.id, randomUUID));
    const reference = await Ref.build({ bundle, sourceId: first.source.id, versionId: first.version.id, locator: { start: raw.indexOf('정확한'), end: raw.indexOf('다음') + 2 } });
    plan.blocks.push({ id: randomUUID(), kind: 'quote', materialId: material.id, reference }, { id: randomUUID(), kind: 'paragraph', text: '직접 쓴 글의 문단' });
    const data = await Model.verify(Model.snapshot(bundle, plan)), id = randomUUID(), operationId = randomUUID(); let headRevision = 1;
    await check('Private owner RPC/RLS, fixed paths and repeatable installation expose no tables or foreign metadata', async () => {
      const installed = server.sql("select jsonb_build_object('rls',(select count(*)=2 and bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='haedo_material_private' and relkind='r'),'wrappers',(select count(*)=3 and bool_and(not prosecdef and proconfig=array['search_path=pg_catalog']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in('life_material_get','life_material_list','life_material_put')),'table_denied',not has_table_privilege('authenticated','haedo_material_private.heads','select') and not has_table_privilege('anon','haedo_material_private.receipts','select'));");
      assert(Object.values(installed).every(Boolean));
      for (const role of ['anon', 'authenticated']) assert.throws(() => rpc('life_material_get', { p_id: id }, role, null), e => e.code === '42501');
      assert.equal(await remote.read(id), null); assert.deepEqual(await remote.list(), { items: [], next: null });
      assert.throws(() => server.sql('select count(*) from haedo_material_private.heads;', { owner, role: 'authenticated' }), e => e.code === '42501');
    });
    await check('Three thousand originals reduce to two exact selected versions; old CRLF/emoji and link-only travel without unrelated records', async () => {
      assert.equal(data.bundle.sources.length, 2); assert.equal(data.bundle.sourceVersions.length, 2); assert(!data.bundle.sourceVersions.some(v => v.id === latest.version.id));
      assert.equal(data.bundle.sourceVersions.find(v => v.id === link.version.id).contentHash, null);
      assert.deepEqual(await remote.write({ remoteId: id, operationId, expectedRevision: 0, data }), { status: 'stored', revision: 1 });
      const read = await remote.read(id); assert.deepEqual(read.data, data); assert.equal(read.data.plan.blocks[0].reference.quote, reference.quote);
      user = foreign; auth.user = { id: foreign }; auth.epoch++; assert.equal(await remote.read(id), null); assert.deepEqual(await remote.list(), { items: [], next: null }); user = owner; auth.user = { id: owner }; auth.epoch++;
    });
    await check('Exact durable retries survive lost replies, reject payload reuse and require reading the current head', async () => {
      assert.deepEqual(await remote.write({ remoteId: id, operationId, expectedRevision: 0, data: Object.fromEntries(Object.entries(data).reverse()) }), { status: 'stored', revision: 1 });
      const changed = copy(data); changed.plan.question += '변경'; await assert.rejects(remote.write({ remoteId: id, operationId, expectedRevision: 0, data: changed }), { code: 'operation_mismatch' });
      assert.deepEqual(await remote.write({ remoteId: id, operationId: randomUUID(), expectedRevision: 0, data }), { status: 'conflict', revision: 1 });
      const titled = copy(data); titled.bundle.sources[0].title = '같은 원문의 바뀐 제목'; titled.bundle.sources[0].revision++;
      assert.deepEqual(await remote.write({ remoteId: id, operationId: randomUUID(), expectedRevision: 1, data: titled }), { status: 'stored', revision: 2 }); headRevision = 2;
      assert.deepEqual(await remote.write({ remoteId: id, operationId, expectedRevision: 0, data }), { status: 'stored', revision: 1 }); assert.equal((await remote.read(id)).revision, 2);
    });
    let claim;
    await check('Two actual SQL connections race for one permanent writing claim; only one CAS wins', async () => {
      const a = copy(data), b = copy(data); a.output = { state: 'writing', postId: randomUUID(), claimId: randomUUID() }; b.output = { state: 'writing', postId: randomUUID(), claimId: randomUUID() };
      const results = await Promise.all([concurrentPut(id, headRevision, a), concurrentPut(id, headRevision, b)]); assert.deepEqual(results.map(r => r.status).sort(), ['conflict', 'stored']);
      const current = await remote.read(id); headRevision = current.revision; claim = current.data.output; assert.equal(headRevision, 3); assert([a.output.postId, b.output.postId].includes(claim.postId));
      for (const output of [null, { ...claim, postId: randomUUID() }, { ...claim, claimId: randomUUID() }]) await assert.rejects(remote.write({ remoteId: id, operationId: randomUUID(), expectedRevision: headRevision, data: { ...data, output } }), { code: 'output_conflict' });
    });
    await check('Saved output is monotonic, keeps its post/claim, and refuses same-revision evidence rewrites', async () => {
      const doc = Photo.create(() => claim.postId), postWorkspace = randomUUID(); doc.status = 'saved'; doc.revision = 1; doc.ops = [{ insert: '정확히 저장한 완성 글\n' }];
      server.sql('select public.life_blog_save(' + q(postWorkspace) + '::uuid,' + q(claim.postId) + '::uuid,0,' + q(randomUUID()) + '::uuid,' + json(doc) + ');', { owner, role: 'authenticated' });
      const output = { ...claim, state: 'saved', revision: 1, refs: [reference] };
      await remote.write({ remoteId: id, operationId: randomUUID(), expectedRevision: headRevision++, data: { ...data, output } });
      for (const invalid of [claim, null, { ...output, postId: randomUUID() }, { ...output, refs: [{ ...reference, title: '다른 인용 제목' }] }]) await assert.rejects(remote.write({ remoteId: id, operationId: randomUUID(), expectedRevision: headRevision, data: { ...data, output: invalid } }), { code: 'output_conflict' });
      doc.revision = 2;
      const blogWriter = await holdBlogSave('select public.life_blog_save(' + q(postWorkspace) + '::uuid,' + q(claim.postId) + '::uuid,1,' + q(randomUUID()) + '::uuid,' + json(doc) + ');');
      const staleDescriptor = concurrentPut(id, headRevision, { ...data, output }).then(value => value, error => error);
      let waiting = false;
      try {
        for (let attempt = 0; attempt < 50 && !waiting; attempt++) {
          waiting = server.sql("select to_jsonb(exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%life_material_put%'));");
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
        }
      } finally { await blogWriter.release(); }
      const staleResult = await staleDescriptor; assert.equal(waiting, true, 'Descriptor commit must wait on the exact post row before checking its revision'); assert(staleResult instanceof Error); assert.match(staleResult.message, /life_material_output_changed/);
      await remote.write({ remoteId: id, operationId: randomUUID(), expectedRevision: headRevision++, data: { ...data, output: { ...output, revision: 2 } } });
      await assert.rejects(remote.write({ remoteId: id, operationId: randomUUID(), expectedRevision: headRevision, data: { ...data, output } }), { code: 'output_conflict' });
      const foreignClaim = { state: 'writing', postId: randomUUID(), claimId: randomUUID() }, foreignId = randomUUID();
      await remote.write({ remoteId: foreignId, operationId: randomUUID(), expectedRevision: 0, data: { ...data, output: foreignClaim } });
      const foreignPost = Photo.create(() => foreignClaim.postId); foreignPost.status = 'saved'; foreignPost.revision = 1; foreignPost.ops = [{ insert: '다른 계정의 저장 글\n' }];
      server.sql('select public.life_blog_save(' + q(randomUUID()) + '::uuid,' + q(foreignClaim.postId) + '::uuid,0,' + q(randomUUID()) + '::uuid,' + json(foreignPost) + ');', { owner: foreign, role: 'authenticated' });
      await assert.rejects(remote.write({ remoteId: foreignId, operationId: randomUUID(), expectedRevision: 1, data: { ...data, output: { ...foreignClaim, state: 'saved', revision: 1, refs: [] } } }), { code: 'output_missing' });
    });
    await check('Corrupt bytes, UTF16 surrogate splits, extra originals and remove/re-add version mutations never reach a new head', async () => {
      const direct = value => rpc('life_material_put', { p_id: randomUUID(), p_operation_id: randomUUID(), p_expected_revision: 0, p_data: value });
      const corrupted = copy(data); corrupted.bundle.sourceVersions[0].contentText += '변조'; assert.throws(() => direct(corrupted), e => e.code === '22023');
      const split = copy(data); split.plan.blocks[0].reference.locator = { start: 1, end: 2 }; split.plan.blocks[0].reference.quote = 'x'; assert.throws(() => direct(split), e => e.code === '22023');
      const extra = copy(data); extra.bundle.records.push({ hidden: '미선택 개인 메모' }); assert.throws(() => direct(extra), e => e.code === '22023');
      const historyId = randomUUID(); await remote.write({ remoteId: historyId, operationId: randomUUID(), expectedRevision: 0, data });
      const empty = copy(data); empty.bundle.sources = []; empty.bundle.sourceVersions = []; empty.plan.materials = []; empty.plan.blocks = [];
      await remote.write({ remoteId: historyId, operationId: randomUUID(), expectedRevision: 1, data: empty });
      const altered = copy(data), old = altered.bundle.sourceVersions.find(v => v.id === first.version.id); old.contentText += '다른 정확바이트'; old.contentHash = createHash('sha256').update(old.contentText).digest('hex');
      altered.plan.materials[0].contentHash = old.contentHash; altered.plan.blocks[0].reference.contentHash = old.contentHash;
      await Model.verify(altered); await assert.rejects(remote.write({ remoteId: historyId, operationId: randomUUID(), expectedRevision: 2, data: altered }), { code: 'immutable_source_version' });
      assert.equal((await remote.read(historyId)).revision, 2);
    });
    await check('Metadata-only pagination includes every one of twenty-one tied-timestamp rows exactly once', async () => {
      const ids = [];
      for (let i = 0; i < 21; i++) { const key = randomUUID(); ids.push(key); await remote.write({ remoteId: key, operationId: randomUUID(), expectedRevision: 0, data }); }
      server.sql("update haedo_material_private.heads set updated_at='2026-10-19T01:00:00.123456Z' where owner_id=" + q(owner) + "::uuid;select 'true'::jsonb;");
      const seen = new Set(); let cursor = null, pages = 0;
      do { const next = await remote.list(cursor); pages++; assert(next.items.length <= 20); for (const item of next.items) { assert.deepEqual(Object.keys(item).sort(), ['id', 'revision', 'title', 'updated_at']); assert(!seen.has(item.id)); seen.add(item.id); } cursor = next.next; } while (cursor && pages < 5);
      assert.equal(cursor, null); assert.equal(seen.size, ids.length + 3); assert(ids.every(id => seen.has(id)));
      assert.throws(() => rpc('life_material_list', { p_after_updated_at: '2026-10-19T00:00:00Z', p_after_id: null }), e => e.code === '22023');
    });
    await check('Account disposal cancels held responses, and deleted heads cannot be recreated using historical remote IDs', async () => {
      let release; heldRPC = new Promise(resolve => { release = resolve; }); const pending = remote.read(id); await new Promise(resolve => setImmediate(resolve));
      user = foreign; auth.user = { id: foreign }; auth.epoch++; release(); await assert.rejects(pending, { code: 'request_cancelled' }); user = owner; auth.user = { id: owner }; auth.epoch++;
      server.sql('delete from haedo_material_private.heads where owner_id=' + q(owner) + '::uuid and id=' + q(id) + "::uuid;select 'true'::jsonb;");
      await assert.rejects(remote.write({ remoteId: id, operationId: randomUUID(), expectedRevision: 0, data }), { code: 'remote_missing' });
      await assert.rejects(remote.write({ remoteId: id, operationId, expectedRevision: 0, data }), { code: 'remote_missing' });
      assert.equal(await remote.read(id), null);
      const digest = () => server.sql("select to_jsonb(encode(sha256(convert_to(coalesce((select jsonb_agg(to_jsonb(h) order by owner_id,id) from haedo_material_private.heads h),'[]'::jsonb)::text||coalesce((select jsonb_agg(to_jsonb(r) order by owner_id,id,operation_id) from haedo_material_private.receipts r),'[]'::jsonb)::text,'UTF8')),'hex'));");
      const prior = digest(); psql(await fs.readFile(path.resolve(__dirname, '..', migration), 'utf8')); assert.equal(digest(), prior); report.populatedReinstallPreserved = true;
    });
    report.pass = true;
  } finally {
    remote?.dispose(); if (created) server.docker(['exec', server.container, 'dropdb', '-U', 'postgres', '--if-exists', database]);
    await fs.mkdir(out, { recursive: true }); await fs.writeFile(path.join(out, 'backend-report.json'), JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
