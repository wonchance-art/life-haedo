'use strict';
/* Dedicated disposable local PostgreSQL only: no hosted DB, credentials, Auth
 * sessions or real user content. This checks the release delta, not every RPC. */
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { spawnSync } = require('node:child_process'), { randomUUID, createHash } = require('node:crypto');
const Core = require('../assets/life/core.js'), Workbench = require('../assets/life/workbench.js'), Writing = require('../assets/life/writing.js');
const Photo = require('../assets/life/photo-post.js'), Blog = require('../assets/life/blog.js'), Material = require('../assets/life/material-writing.js');
const Continuity = require('../assets/life/material-continuity.js'), Ref = require('../assets/life/source-reference.js');
const Series = require('../assets/life/blog-series-public.js'), Nine = require('../assets/life/nine-board.js'), NinePublic = require('../assets/life/nine-public.js'), Cover = require('../assets/life/public-cover.js');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.local/integrated-release-installation');
const migration = 'supabase/migrations/20261019005829_life_material_continuity.sql';
const accountMaterialMigration = 'supabase/migrations/20261020042517_account_material_registrations.sql';
const image = 'postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3';
const container = 'haedo-blog-postgres-' + Date.now() + process.pid, database = 'haedo_blog_qa_integrated_install', runId = randomUUID();
const env = { ...process.env }; for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key];
const q = value => "'" + String(value).replaceAll("'", "''") + "'", json = value => q(JSON.stringify(value)) + '::jsonb';
const hash = value => createHash('sha256').update(value).digest('hex');
function command(name, args, input) {
  const result = spawnSync(name, args, { env, input, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || name + ' failed'); return result.stdout;
}
const docker = (args, input) => command('docker', ['--host=unix:///var/run/docker.sock', ...args], input);
const psql = source => docker(['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', database], source);
const sql = source => JSON.parse(psql(source).trim().split('\n').filter(Boolean).at(-1));
const owner = randomUUID();
function rpc(name, args, role = 'authenticated') {
  assert.match(name, /^[a-z_]+$/);
  return sql('begin;set local role ' + role + ';select set_config(\'request.jwt.claims\',' + q(JSON.stringify({ role, ...(role === 'authenticated' ? { sub: owner } : {}) })) + ',true);select public.' + name + '(' + args.join(',') + ');commit;');
}
const namespaces = "array['public','auth','storage','haedo_blog_private']";
const catalogQuery = `select jsonb_build_object(
 'schemas',(select jsonb_agg(jsonb_build_array(nspname,nspacl) order by nspname) from pg_namespace where nspname=any(${namespaces})),
 'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.prosrc,p.proconfig,p.prosecdef,p.proacl) order by n.nspname,p.proname,p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any(${namespaces}) and p.proname not like 'life_material_%'),
 'relations',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl,(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),(select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid)) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=any(${namespaces}) and c.relkind in('r','i','S','v')),
 'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p where schemaname=any(${namespaces}))
);`;
async function main() {
  assert.equal(process.argv.length, 2, 'This local checker accepts no remote/container arguments.');
  await fs.mkdir(output, { recursive: true }); let owned = false;
  const report = { pass: false, baseline: '88ccfe5', delta: migration, image, network: 'none', publishedHostPorts: 0, productionAccess: false, checks: [] };
  const check = async (name, run) => { await run(); report.checks.push(name); console.log('PASS ' + name); };
  try {
    const files = (await fs.readdir(path.join(root, 'supabase/migrations'))).filter(name => name.endsWith('.sql')).sort();
    const baseline = files.filter(name => ![migration, accountMaterialMigration].includes('supabase/migrations/' + name));
    assert.equal(baseline.length, 10);
    assert.equal(files.length, baseline.length + 2, 'Both additive migrations must be checked explicitly.');
    for (const file of baseline) {
      const relative = 'supabase/migrations/' + file, current = await fs.readFile(path.join(root, relative), 'utf8');
      assert.equal(hash(current), hash(command('git', ['-C', root, 'show', '88ccfe5:' + relative])), 'Previously installed migration changed: ' + file);
    }
    const delta = await fs.readFile(path.join(root, migration), 'utf8'); report.migrationSha256 = hash(delta);
    assert.match(delta, /^--[^\n]+\nbegin;/); assert.match(delta, /commit;\s*$/);
    // Record the attempted resource before launch: a timed-out Docker client
    // can still leave its container running. Cleanup checks the unique label.
    owned = true;
    docker(['run', '--detach', '--name', container, '--label', 'com.haedo.fixture=integrated-release-installation', '--label', 'com.haedo.fixture-run=' + runId, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]);
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { docker(['exec', container, 'pg_isready', '--host=127.0.0.1', '-U', 'postgres', '--quiet']); ready = true; break; }
      catch (_) { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    assert(ready, 'The final TCP PostgreSQL server must be ready after init.');
    const host = JSON.parse(docker(['inspect', container, '--format', '{{json .HostConfig}}']));
    assert.equal(host.NetworkMode, 'none'); assert.equal(Object.keys(host.PortBindings || {}).length, 0);
    docker(['exec', container, 'createdb', '-U', 'postgres', database]);
    psql(await fs.readFile(path.join(root, 'supabase/tests/blog-bootstrap.sql'), 'utf8') + '\ncreate table auth.users(id uuid primary key);');
    for (const file of baseline) psql(await fs.readFile(path.join(root, 'supabase/migrations', file), 'utf8'));
    psql(`insert into auth.users values(${q(owner)}::uuid);create table public.charts(id text primary key,data jsonb);insert into public.charts values('synthetic-legacy','{"sentinel":"unchanged"}');
 create schema installation_probe;
 create function installation_probe.data_snapshot() returns jsonb language plpgsql as $$
 declare r record; data jsonb; result jsonb:='{}';begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=any(${namespaces}) and c.relkind='r' order by n.nspname,c.relname loop
 execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from %I.%I t',r.nspname,r.relname) into data;
 result:=result||jsonb_build_object(r.nspname||'.'||r.relname,data);end loop;return result;end $$;`);
    let bundle = Core.createWorkspace({ title: 'synthetic baseline originals' });
    const source = await Core.prepareImport({ origin: 'obsidian', title: '정확한 옛 원문', text: '🌿\r\n보존할 옛 구절\r\n끝', author: '원저자', authorRelation: 'other', coverage: 'partial' }, bundle);
    bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, source));
    const op = randomUUID(); assert.equal(rpc('life_sync_put', [q(bundle.workspaceId) + '::uuid', '0', q(op) + '::uuid', json(bundle)]).status, 'stored');
    const workbench = Workbench.empty(bundle.workspaceId); assert.equal(rpc('life_composition_put', [q(bundle.workspaceId) + '::uuid', '0', q(randomUUID()) + '::uuid', '1', json(workbench)]).status, 'stored');
    const writing = Writing.createDraft(bundle); writing.text = '기존 직접 쓰기 초안'; assert.equal(rpc('life_writing_draft_put', [q(bundle.workspaceId) + '::uuid', q(writing.stageId) + '::uuid', '0', q(randomUUID()) + '::uuid', '1', json(writing)]).status, 'stored');
    const posts = [Photo.create(Core.id), Photo.create(Core.id)]; posts[0].format = 'life-photo-post-v1'; delete posts[0].attachments; delete posts[0].archived;
    for (const [i, post] of posts.entries()) { post.status = 'saved'; post.revision = 1; post.title = '기존 저장 글 ' + i; post.ops = [{ insert: '원래 본문 🌿\n' }]; Photo.validate(post); assert.equal(rpc('life_blog_save', [q(bundle.workspaceId) + '::uuid', q(post.id) + '::uuid', '0', q(randomUUID()) + '::uuid', json(Blog.pack(post))]).status, 'stored'); }
    const publication = rpc('life_blog_publish', [q(posts[1].id) + '::uuid', '1', q(randomUUID()) + '::uuid', "'{}'::text[]", json({ name: '익명', intro: '기존 공개 소개' }), '0']);
    assert.equal(publication.status, 'stored');
    const asset = rpc('life_blog_prepare_asset', [q(posts[1].id) + '::uuid', q('partial_upload'), q(hash('synthetic original bytes')), '24', q('image/png'), '4032', '3024']);
    psql('insert into storage.objects(bucket_id,name,owner_id,metadata) values(' + q(asset.bucket) + ',' + q(asset.path) + ',' + q(owner) + ",'{\"size\":24,\"mimetype\":\"image/png\"}');");
    const pageId = randomUUID(), originalPage = { format: 'life-share-v1', title: '기존 공개 페이지', intro: null, entries: [] };
    assert.equal(rpc('life_public_page_put', [q(pageId) + '::uuid', '0', q(randomUUID()) + '::uuid', q('publish'), json(originalPage)]).status, 'stored');
    const beforeData = sql('select installation_probe.data_snapshot();'), beforeCatalog = sql(catalogQuery), baselineDigest = hash(JSON.stringify(beforeData));
    await check('Whole main baseline migrations, original/partial-upload rows, receipts, functions and grants survive failed additive installation', async () => {
      const fail = delta.replace(/commit;\s*$/i, "select 1/0;\ncommit;\n"); assert.throws(() => psql(fail), /division by zero/);
      assert.equal(sql("select to_jsonb(to_regnamespace('haedo_material_private') is null and not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname like 'life_material_%'));"), true);
      assert.deepEqual(sql('select installation_probe.data_snapshot();'), beforeData); assert.deepEqual(sql(catalogQuery), beforeCatalog);
    });
    await check('The single missing migration installs after blog originals without altering any prior schema, privilege or stored byte metadata', async () => {
      psql(delta); assert.deepEqual(sql('select installation_probe.data_snapshot();'), beforeData); assert.deepEqual(sql(catalogQuery), beforeCatalog);
      const gates = sql("select jsonb_build_object('rls',(select count(*)=2 and bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='haedo_material_private' and c.relkind='r'),'privateTables',not has_table_privilege('authenticated','haedo_material_private.heads','select') and not has_table_privilege('anon','haedo_material_private.receipts','select'),'rpc',(select count(*)=3 and bool_and(not prosecdef and proconfig=array['search_path=pg_catalog'] and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute')) from pg_proc p where pronamespace='public'::regnamespace and proname like 'life_material_%')); ");
      assert(Object.values(gates).every(Boolean));
    });
    const plan = Material.create(Core.id); plan.title = '새 준비'; plan.question = '명시 동의한 비공개 질문'; plan.materials = [Material.material(bundle, source.source.id, source.version.id, Core.id)];
    const ref = await Ref.build({ bundle, sourceId: source.source.id, versionId: source.version.id, locator: { start: 4, end: 12 } });
    plan.blocks = [{ id: Core.id(), kind: 'quote', materialId: plan.materials[0].id, reference: ref }];
    const payload = await Continuity.verify(Continuity.snapshot(bundle, plan)), remoteId = randomUUID(), operationId = randomUUID();
    const args = [q(remoteId) + '::uuid', q(operationId) + '::uuid', '0', json(payload)]; assert.deepEqual(rpc('life_material_put', args), { status: 'stored', revision: 1 });
    const materialDigest = () => sql("select jsonb_build_object('heads',(select jsonb_agg(to_jsonb(h) order by owner_id,id) from haedo_material_private.heads h),'receipts',(select jsonb_agg(to_jsonb(r) order by owner_id,id,operation_id) from haedo_material_private.receipts r));");
    await check('Interrupted reinstallation and safe API disable/restore retain new heads and durable retry identity while legacy reading continues', async () => {
      const existing = materialDigest(); assert.throws(() => psql(delta.replace(/commit;\s*$/i, 'select 1/0;commit;')), /division by zero/); assert.deepEqual(materialDigest(), existing);
      psql('revoke execute on function public.life_material_get(uuid),public.life_material_list(timestamptz,uuid),public.life_material_put(uuid,uuid,bigint,jsonb),haedo_material_private.get(uuid),haedo_material_private.list(timestamptz,uuid),haedo_material_private.put(uuid,uuid,bigint,jsonb) from authenticated;');
      assert.throws(() => rpc('life_material_get', [q(remoteId) + '::uuid']), /permission denied/); assert.equal(rpc('life_blog_read', [q(posts[1].id) + '::uuid']).data.title, posts[1].title);
      assert.deepEqual(materialDigest(), existing); psql(delta); assert.deepEqual(materialDigest(), existing); assert.deepEqual(rpc('life_material_put', args), { status: 'stored', revision: 1 });
      assert.deepEqual(sql('select installation_probe.data_snapshot();'), beforeData); assert.deepEqual(sql(catalogQuery), beforeCatalog);
    });
    await check('Current cover, series and nine pointer wrappers use the unchanged installed Share format without target or private-row migration', async () => {
      const publicPost = rpc('life_blog_read', [q(posts[1].id) + '::uuid']).publication.token;
      const board = Nine.create(Core.id); board.areas[0].items = [Nine.snapshot({ type: 'book', title: '공개한 책' })];
      const nine = NinePublic.project({ ...Nine.empty(bundle.workspaceId), boards: [board] }, { boardId: board.id, areaId: board.areas[0].id, title: '공개 9칸' }).snapshot;
      const series = Series.wrapper('연재', '', [publicPost], 'https://example.test/app/series.html');
      const cover = Cover.create(Core.id); cover.title = '표지'; cover.items = [Cover.item('post', publicPost), Cover.item('series', randomUUID()), Cover.item('nine', randomUUID())];
      const snapshots = [nine, series, Cover.project(cover, 'https://example.test/app/cover.html')];
      for (const snapshot of snapshots) assert.equal(sql('select to_jsonb(public.life_public_page_valid(' + json(snapshot) + '));'), true);
      assert.deepEqual(sql('select installation_probe.data_snapshot();'), beforeData); assert.deepEqual(sql(catalogQuery), beforeCatalog);
    });
    await check('Account material registration installation, rollback, owner-only reads and reinstallation preserve all existing data and privileges', async () => {
      const registrationDDL = await fs.readFile(path.join(root, accountMaterialMigration), 'utf8');
      const intactData = sql('select installation_probe.data_snapshot();');
      const intactCatalog = sql(catalogQuery);
      assert.throws(() => psql(registrationDDL.replace(/commit;\s*$/i, 'select 1/0;\ncommit;')), /division by zero/);
      assert.deepEqual(sql('select installation_probe.data_snapshot();'), intactData);
      assert.deepEqual(sql(catalogQuery), intactCatalog);
      psql(registrationDDL);
      psql(await fs.readFile(path.join(root, 'supabase/tests/account-materials-installation.sql'), 'utf8'));
      psql(registrationDDL);
      const after = sql('select installation_probe.data_snapshot();');
      assert.deepEqual(after['public.life_account_materials'], []);
      delete after['public.life_account_materials'];
      assert.deepEqual(after, intactData);
      const catalog = sql(catalogQuery);
      catalog.relations = catalog.relations.filter(row => !row[1].startsWith('life_account_materials'));
      catalog.policies = catalog.policies.filter(row => row.tablename !== 'life_account_materials');
      assert.deepEqual(catalog, intactCatalog);
      report.accountMaterialMigrationSha256 = hash(registrationDDL);
    });
    report.pass = true; report.baselineMigrations = baseline; report.baselineDataSha256 = baselineDigest;
    report.rollback = 'Failed transaction rolls back all additive DDL. After successful use retain data/receipts and compatible output-receipt storage; disable new UI and public/private entrypoint execution, then reapply the migration to restore. Full 88cc frontend rollback is safe only before new preparation usage. No destructive down migration.';
  } finally {
    if (owned) {
      let labels = null;
      try { labels = JSON.parse(docker(['inspect', container, '--format', '{{json .Config.Labels}}'])); }
      catch (error) { if (!/No such (object|container)/i.test(error.message)) throw error; }
      if (labels) { assert.equal(labels['com.haedo.fixture-run'], runId, 'Never clean up another task resource.'); docker(['rm', '--force', '--volumes', container]); }
      report.localContainerRemoved = true;
    }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
