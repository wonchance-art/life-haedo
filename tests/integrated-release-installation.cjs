'use strict';
/* Dedicated disposable local PostgreSQL only: no hosted DB, credentials, Auth
 * sessions or real user content. This checks the release delta, not every RPC. */
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { spawnSync } = require('node:child_process'), { randomUUID, createHash } = require('node:crypto');
const Core = require('../assets/life/core.js'), Workbench = require('../assets/life/workbench.js'), Writing = require('../assets/life/writing.js');
const Photo = require('../assets/life/photo-post.js'), Blog = require('../assets/life/blog.js'), Material = require('../assets/life/material-writing.js');
const Continuity = require('../assets/life/material-continuity.js'), Ref = require('../assets/life/source-reference.js');
const SourceEdit = require('../assets/life/source-edit.js');
const Series = require('../assets/life/blog-series-public.js'), Nine = require('../assets/life/nine-board.js'), NinePublic = require('../assets/life/nine-public.js'), Cover = require('../assets/life/public-cover.js');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.local/integrated-release-installation');
const migration = 'supabase/migrations/20261019005829_life_material_continuity.sql';
const accountMaterialMigration = 'supabase/migrations/20261020042517_account_material_registrations.sql';
const naverMigrations = ['supabase/migrations/20261021093111_life_naver_subscriptions.sql', 'supabase/migrations/20261021094614_naver_conflict_http409.sql'];
const captureMigration = 'supabase/migrations/20261021113658_life_naver_captures.sql';
const editedCopyMigration = 'supabase/migrations/20261022031304_life_material_edited_copy_markers.sql';
const image = 'postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3';
const container = 'haedo-blog-postgres-' + Date.now() + process.pid, database = 'haedo_blog_qa_integrated_install', runId = randomUUID();
const env = { ...process.env }; for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key];
const q = value => "'" + String(value).replaceAll("'", "''") + "'", json = value => q(JSON.stringify(value)) + '::jsonb';
const hash = value => createHash('sha256').update(value).digest('hex');
function command(name, args, input, timeout = 30000) {
  const result = spawnSync(name, args, { env, input, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || name + ' failed'); return result.stdout;
}
const docker = (args, input, timeout) => command('docker', ['--host=unix:///var/run/docker.sock', ...args], input, timeout);
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
    const baseline = command('git', ['-C', root, 'ls-tree', '-r', '--name-only', '88ccfe5', '--', 'supabase/migrations'])
      .trim().split('\n').filter(name => name.endsWith('.sql')).map(name => path.basename(name)).sort();
    assert.equal(baseline.length, 10);
    assert.deepEqual(files.map(name => 'supabase/migrations/' + name),
      [...baseline.map(name => 'supabase/migrations/' + name), migration, accountMaterialMigration, ...naverMigrations, captureMigration, editedCopyMigration].sort(),
      'Exactly the ten legacy and six reviewed additive migrations are required; missing or unknown files are rejected.');
    for (const file of baseline) {
      const relative = 'supabase/migrations/' + file, current = await fs.readFile(path.join(root, relative), 'utf8');
      assert.equal(hash(current), hash(command('git', ['-C', root, 'show', '88ccfe5:' + relative])), 'Previously installed migration changed: ' + file);
    }
    const delta = await fs.readFile(path.join(root, migration), 'utf8'); report.migrationSha256 = hash(delta);
    assert.match(delta, /^--[^\n]+\nbegin;/); assert.match(delta, /commit;\s*$/);
    // Record the attempted resource before launch: a timed-out Docker client
    // can still leave its container running. Cleanup checks the unique label.
    owned = true;
    // Managed Docker uses vfs: materializing this pinned image can exceed 30s.
    // Only resource creation gets this budget; SQL and all assertions keep 30s.
    docker(['run', '--detach', '--name', container, '--label', 'com.haedo.fixture=integrated-release-installation', '--label', 'com.haedo.fixture-run=' + runId, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image], undefined, 120000);
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
    await check('Naver base and HTTP409 fix install atomically, preserve every existing row and catalog, and retain inbox receipts and the disabled gate on reinstallation', async () => {
      const [baseDDL, fixDDL] = await Promise.all(naverMigrations.map(file => fs.readFile(path.join(root, file), 'utf8')));
      const allNamespaces = "array['public','auth','storage','haedo_blog_private','haedo_material_private','haedo_naver_private']";
      const allCatalog = catalogQuery.replaceAll(namespaces, allNamespaces).replace(" and p.proname not like 'life_material_%'", '');
      psql(`create function installation_probe.all_data_snapshot() returns jsonb language plpgsql as $$
 declare r record; data jsonb; result jsonb:='{}';begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=any(${allNamespaces}) and c.relkind='r' order by n.nspname,c.relname loop
 execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from %I.%I t',r.nspname,r.relname) into data;
 result:=result||jsonb_build_object(r.nspname||'.'||r.relname,data);end loop;return result;end $$;`);
      const dataSnapshot = () => sql('select installation_probe.all_data_snapshot();');
      const intactData = dataSnapshot(), intactCatalog = sql(allCatalog);
      const naverTable = (schema, name) => schema === 'haedo_naver_private' || schema === 'public' && name.startsWith('life_naver_');
      const legacyData = data => Object.fromEntries(Object.entries(data).filter(([key]) => !naverTable(...key.split('.'))));
      const legacyCatalog = catalog => ({
        schemas: catalog.schemas.filter(row => row[0] !== 'haedo_naver_private'),
        functions: catalog.functions.filter(row => !naverTable(row[0], row[1])),
        relations: catalog.relations.filter(row => !naverTable(row[0], row[1])),
        policies: catalog.policies.filter(row => !naverTable(row.schemaname, row.tablename))
      });
      const failed = ddl => ddl.replace(/commit;\s*$/i, 'select 1/0;\ncommit;');
      assert.match(baseDDL, /begin;/); assert.match(baseDDL, /commit;\s*$/i);
      assert.match(fixDDL, /begin;/); assert.match(fixDDL, /commit;\s*$/i);
      assert.throws(() => psql(failed(baseDDL)), /division by zero/);
      assert.equal(sql("select to_jsonb(to_regnamespace('haedo_naver_private') is null and to_regclass('public.life_naver_subscriptions') is null and to_regclass('public.life_naver_items') is null and not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname like 'life_naver_%'));"), true);
      assert.deepEqual(dataSnapshot(), intactData); assert.deepEqual(sql(allCatalog), intactCatalog);
      psql(baseDDL);
      const metadata = sql(await fs.readFile(path.join(root, 'supabase/tests/naver-installation.sql'), 'utf8'));
      assert.equal(Object.keys(metadata).length, 11); assert(Object.values(metadata).every(value => value === true));
      assert.deepEqual(legacyData(dataSnapshot()), intactData); assert.deepEqual(legacyCatalog(sql(allCatalog)), intactCatalog);
      const saveDefinition = () => sql("select jsonb_build_object('body',p.prosrc,'acl',p.proacl,'path',p.proconfig,'definer',p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='haedo_naver_private' and p.proname='save';");
      const baseSave = saveDefinition(), baseData = dataSnapshot(), baseCatalog = sql(allCatalog);
      assert.equal((baseSave.body.match(/errcode='40001'/g) || []).length, 2);
      assert.throws(() => psql(failed(fixDDL)), /division by zero/);
      assert.deepEqual(saveDefinition(), baseSave); assert.deepEqual(dataSnapshot(), baseData); assert.deepEqual(sql(allCatalog), baseCatalog);
      psql(fixDDL);
      assert.deepEqual(saveDefinition(), { ...baseSave, body: baseSave.body.replaceAll("errcode='40001'", "errcode='PT409'") });
      assert.deepEqual(legacyData(dataSnapshot()), intactData); assert.deepEqual(legacyCatalog(sql(allCatalog)), intactCatalog);
      // Seed only this new synthetic inbox; actual original-photo metadata,
      // Auth, publications, all older receipts and material heads stay intact.
      const subscription = rpc('life_naver_save', [q(bundle.workspaceId) + '::uuid', q('installation_probe'), '0', 'false']);
      psql('update haedo_naver_private.runtime set ready=true where singleton;');
      const lease = rpc('life_naver_claim', ['1', q(subscription.id) + '::uuid', q(owner) + '::uuid'], 'service_role');
      assert.equal(lease.length, 1);
      const body = '새 수집 원문\r\n🌿', items = [{ log_no: '987', title: 'Synthetic inbox item', url: 'https://blog.naver.com/installation_probe/987',
        content_text: body, content_hash: hash(body), published_at: null, coverage: 'partial' }];
      const finishArgs = [q(subscription.id) + '::uuid', q(lease[0].lease_token) + '::uuid', String(lease[0].revision), json(items)];
      assert.deepEqual(rpc('life_naver_finish', finishArgs, 'service_role'), { status: 'stored', inserted: 1 });
      psql('update haedo_naver_private.runtime set ready=false where singleton;');
      const installedData = dataSnapshot(), installedCatalog = sql(allCatalog), installedSave = saveDefinition();
      assert.equal(installedData['public.life_naver_items'].length, 1); assert.equal(installedData['haedo_naver_private.receipts'].length, 1);
      assert.throws(() => psql(failed(fixDDL)), /division by zero/);
      assert.deepEqual(dataSnapshot(), installedData); assert.deepEqual(saveDefinition(), installedSave); assert.deepEqual(sql(allCatalog), installedCatalog);
      psql(baseDDL); psql(fixDDL);
      assert.deepEqual(dataSnapshot(), installedData); assert.deepEqual(sql(allCatalog), installedCatalog); assert.deepEqual(saveDefinition(), installedSave);
      assert.deepEqual(rpc('life_naver_finish', finishArgs, 'service_role'), { status: 'stored', inserted: 1 });
      assert.deepEqual(dataSnapshot(), installedData); assert.deepEqual(legacyData(installedData), intactData);
      assert.deepEqual(legacyCatalog(sql(allCatalog)), intactCatalog);
      assert.deepEqual(sql(await fs.readFile(path.join(root, 'supabase/tests/naver-installation.sql'), 'utf8')), metadata);
      report.naverMigrations = naverMigrations.map((file, index) => ({ file, sha256: hash(index ? fixDDL : baseDDL) }));
      report.naverInstallation = metadata; report.naverInstalledDataSha256 = hash(JSON.stringify(installedData));
    });
    await check('Naver capture installation rolls back atomically and preserves all older data, catalogs and privileges through installation and reinstall', async () => {
      const captureDDL = await fs.readFile(path.join(root, captureMigration), 'utf8');
      const allNamespaces = "array['public','auth','storage','haedo_blog_private','haedo_material_private','haedo_naver_private']";
      const allCatalog = catalogQuery.replaceAll(namespaces, allNamespaces).replace(" and p.proname not like 'life_material_%'", '');
      const dataSnapshot = () => sql('select installation_probe.all_data_snapshot();');
      const intactData = dataSnapshot(), intactCatalog = sql(allCatalog);
      const oldKeys = {
        schemas: row => row[0], functions: row => JSON.stringify(row.slice(0, 3)),
        relations: row => JSON.stringify(row.slice(0, 2)), policies: row => JSON.stringify([row.schemaname, row.tablename, row.policyname])
      };
      const keepExistingCatalog = catalog => Object.fromEntries(Object.entries(oldKeys).map(([kind, key]) => {
        const before = new Set(intactCatalog[kind].map(key));
        return [kind, catalog[kind].filter(row => before.has(key(row)))];
      }));
      const keepExistingData = data => Object.fromEntries(Object.keys(intactData).map(key => {
        assert(Object.hasOwn(data, key), 'An existing table disappeared: ' + key);
        return [key, key === 'storage.buckets' ? data[key].filter(row => row.id !== 'haedo-naver-originals') : data[key]];
      }));
      assert.equal(sql("select to_jsonb(to_regclass('public.life_naver_captures') is null);"), true);
      assert.throws(() => psql(captureDDL.replace(/commit;\s*$/i, 'select 1/0;\ncommit;')), /division by zero/);
      assert.deepEqual(dataSnapshot(), intactData); assert.deepEqual(sql(allCatalog), intactCatalog);
      assert.equal(sql("select to_jsonb(to_regclass('public.life_naver_captures') is null and not exists(select 1 from storage.buckets where id='haedo-naver-originals'));"), true);
      psql(captureDDL);
      assert.deepEqual(keepExistingData(dataSnapshot()), intactData);
      assert.deepEqual(keepExistingCatalog(sql(allCatalog)), intactCatalog);
      const metadata = sql(await fs.readFile(path.join(root, 'supabase/tests/naver-capture-installation.sql'), 'utf8'));
      assert.equal(Object.keys(metadata).length, 12); assert(Object.values(metadata).every(value => value === true));
      const installedData = dataSnapshot(), installedCatalog = sql(allCatalog);
      assert.deepEqual(installedData['public.life_naver_captures'], []);
      assert.equal(installedData['storage.buckets'].filter(row => row.id === 'haedo-naver-originals').length, 1);
      assert.throws(() => psql(captureDDL.replace(/commit;\s*$/i, 'select 1/0;\ncommit;')), /division by zero/);
      assert.deepEqual(dataSnapshot(), installedData); assert.deepEqual(sql(allCatalog), installedCatalog);
      psql(captureDDL);
      assert.deepEqual(dataSnapshot(), installedData); assert.deepEqual(sql(allCatalog), installedCatalog);
      assert.deepEqual(keepExistingData(dataSnapshot()), intactData);
      assert.deepEqual(keepExistingCatalog(sql(allCatalog)), intactCatalog);
      report.captureMigration = { file: captureMigration, sha256: hash(captureDDL) };
      report.captureInstallation = metadata;
      report.captureInstalledDataSha256 = hash(JSON.stringify(installedData));
      report.captureDataReinstallEvidence = 'supabase/tests/check-naver-captures.mjs separately checks retained immutable captures, photo metadata, checkpoints and receipts; no actual object-byte claim.';
    });
    await check('Edited-copy migration rolls back atomically, preserves the full populated installation and permissions, and retains immutable markers through reinstall', async () => {
      const markerDDL = await fs.readFile(path.join(root, editedCopyMigration), 'utf8');
      assert.equal(hash(markerDDL), 'dee903b0c70841228077bcffa7977c76d353822920dd295e0488c40fbd5f36ac', 'Only the independently reviewed marker migration is accepted.');
      assert.match(markerDDL, /begin;/); assert.match(markerDDL, /commit;\s*$/i);
      const allNamespaces = "array['public','auth','storage','haedo_blog_private','haedo_material_private','haedo_naver_private']";
      const allCatalog = catalogQuery.replaceAll(namespaces, allNamespaces).replace(" and p.proname not like 'life_material_%'", '');
      const dataSnapshot = () => sql('select installation_probe.all_data_snapshot();');
      const functionMetadata = () => sql("select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl,p.provolatile) order by n.nspname,p.proname,p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any(" + allNamespaces + ");");
      const intactData = dataSnapshot(), intactCatalog = sql(allCatalog), intactFunctions = functionMetadata();
      const capability = row => row[0] === 'public' && row[1] === 'life_material_capabilities';
      assert(!intactCatalog.functions.some(capability));
      const failed = markerDDL.replace(/commit;\s*$/i, 'select 1/0;\ncommit;');
      assert.throws(() => psql(failed), /division by zero/);
      assert.deepEqual(dataSnapshot(), intactData); assert.deepEqual(sql(allCatalog), intactCatalog); assert.deepEqual(functionMetadata(), intactFunctions);
      psql(markerDDL);
      assert.deepEqual(dataSnapshot(), intactData);
      assert.deepEqual(functionMetadata().filter(row => !capability(row)), intactFunctions, 'Existing function signatures, owners, security modes, paths, grants and volatility stay unchanged.');
      const installedCatalog = sql(allCatalog), changedFunctions = new Set(['valid', 'put']);
      const oldFunctions = new Map(intactCatalog.functions.map(row => [JSON.stringify(row.slice(0, 3)), row]));
      const preservedCatalog = { ...installedCatalog, functions: installedCatalog.functions.filter(row => !capability(row)).map(row => {
        if (row[0] !== 'haedo_material_private' || !changedFunctions.has(row[1])) return row;
        const old = oldFunctions.get(JSON.stringify(row.slice(0, 3))); assert(old);
        assert.notEqual(row[3], old[3], 'The reviewed validator/put definition must actually install.');
        return row.map((value, index) => index === 3 ? old[3] : value);
      }) };
      assert.deepEqual(preservedCatalog, intactCatalog, 'Only the two reviewed function bodies and new capability function may differ.');
      assert.deepEqual(rpc('life_material_capabilities', []), { source_edited_copy: 1 });
      assert.throws(() => rpc('life_material_capabilities', [], 'anon'), /permission denied/);
      assert.throws(() => psql("begin;set local role authenticated;select set_config('request.jwt.claims','{}',true);select public.life_material_capabilities();commit;"), /life_material_auth_required/);
      const gates = sql("select jsonb_build_object('rls',(select count(*)=2 and bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='haedo_material_private' and c.relkind='r'),'privateTables',not has_table_privilege('authenticated','haedo_material_private.heads','select') and not has_table_privilege('anon','haedo_material_private.receipts','select'),'rpc',(select count(*)=4 and bool_and(not prosecdef and proconfig=array['search_path=pg_catalog'] and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute')) from pg_proc p where pronamespace='public'::regnamespace and proname like 'life_material_%')); ");
      assert(Object.values(gates).every(Boolean));
      assert.deepEqual(rpc('life_material_put', args), { status: 'stored', revision: 1 });
      assert.deepEqual(dataSnapshot(), intactData, 'A pre-migration durable receipt remains an exact no-op retry.');
      const stage = SourceEdit.edit(SourceEdit.begin(bundle, source.source.id), { text: '# 수정 사본\n원래 자료와 구별할 문장 🌿', format: 'text/markdown' });
      const prepared = await SourceEdit.prepare(bundle, stage), edited = Core.applyChanges(bundle, prepared.changes);
      const editedPlan = Material.create(Core.id); editedPlan.title = '수정판을 고른 준비';
      editedPlan.materials = [Material.material(edited, source.source.id, prepared.stageResult.sourceVersionId, Core.id)];
      const marked = await Continuity.verify(Continuity.snapshot(edited, editedPlan));
      assert.equal(marked.bundle.links.length, 1); assert.equal(marked.bundle.links[0].kind, 'source_edited_copy');
      assert(!marked.bundle.sourceVersions.some(version => version.id === source.version.id), 'Unselected original body stays out of the partial payload.');
      const markedId = randomUUID(), markedArgs = [q(markedId) + '::uuid', q(randomUUID()) + '::uuid', '0', json(marked)];
      assert.deepEqual(rpc('life_material_put', markedArgs), { status: 'stored', revision: 1 });
      const populatedData = dataSnapshot();
      assert.throws(() => psql(failed), /division by zero/);
      assert.deepEqual(dataSnapshot(), populatedData); assert.deepEqual(sql(allCatalog), installedCatalog);
      psql(markerDDL); psql(markerDDL);
      assert.deepEqual(dataSnapshot(), populatedData); assert.deepEqual(sql(allCatalog), installedCatalog);
      assert.deepEqual(rpc('life_material_put', markedArgs), { status: 'stored', revision: 1 });
      const stripped = JSON.parse(JSON.stringify(marked)); stripped.bundle.links = [];
      assert.throws(() => rpc('life_material_put', [q(markedId) + '::uuid', q(randomUUID()) + '::uuid', '1', json(stripped)]), /life_material_immutable_source_version/);
      assert.deepEqual(dataSnapshot(), populatedData);
      for (const [table, rows] of Object.entries(intactData)) {
        const priorRows = ['haedo_material_private.heads', 'haedo_material_private.receipts'].includes(table)
          ? populatedData[table].filter(row => row.id !== markedId) : populatedData[table];
        assert.deepEqual(priorRows, rows, 'Older stored rows changed in ' + table);
      }
      report.editedCopyMigration = { file: editedCopyMigration, sha256: hash(markerDDL), preservedPopulatedRows: true, preservedExistingPermissions: true, failedTransactionAtomic: true, populatedReinstallPreserved: true, immutableMarkerLossRejected: true };
      report.editedCopyInstalledDataSha256 = hash(JSON.stringify(populatedData));
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
