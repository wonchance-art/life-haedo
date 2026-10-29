/* Synthetic PostgreSQL only. Proves the original unattended-rescan failure
 * before applying the additive repair. No hosted DB, Naver requests or cron. */
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const image = 'postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3';
const container = 'haedo-naver-rescan-' + Date.now() + '-' + process.pid, database = 'haedo_naver_rescan';
const migration = 'supabase/migrations/20261029040646_naver_inventory_automatic_rescan.sql';
const output = resolve(project, '.local/naver-inventory-rescan'), env = { ...process.env };
for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[name];
if (process.argv.length > 2) throw Error('No arguments or external endpoints are accepted.');
const docker = (args, input) => execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { input, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const sql = input => docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-qAt', '-v', 'ON_ERROR_STOP=1'], input);
const lit = value => value === null ? 'null' : "'" + String(value).replaceAll("'", "''") + "'";
const jlit = value => lit(JSON.stringify(value)) + '::jsonb';
const json = value => JSON.parse(value.trim().split('\n').findLast(line => /^(?:\{|\[|null|true|false)/.test(line)));
const owner = (id, query) => json(sql('set role authenticated;select set_config(\'request.jwt.claims\',' + lit(JSON.stringify({ sub: id, role: 'authenticated' })) + ',false);' + query));
const worker = query => json(sql('set role service_role;' + query));
const entry = no => ({ logNo: String(no), title: '합성 원문 ' + no + ' 🌱', publishedAt: null });
let owns = false;
const report = { pass: false, image, migration, checks: [], originalFailureReproduced: false, hostedDatabaseAccess: false, realNaverAccess: false, cronActivated: false };
const check = (name, run) => { run(); report.checks.push(name); console.log('PASS ' + name); };
await mkdir(output, { recursive: true });
try {
  docker(['info', '--format', '{{.ServerVersion}}']);
  docker(['run', '--detach', '--network', 'none', '--label', 'haedo-test=naver-inventory-rescan', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]); owns = true;
  const isolated = JSON.parse(docker(['inspect', container, '--format', '{{json .HostConfig}}']));
  assert.equal(isolated.NetworkMode, 'none'); assert.equal(Object.keys(isolated.PortBindings || {}).length, 0);
  const deadline = Date.now() + 45000;
  for (;;) { try { docker(['exec', container, 'pg_isready', '--host=127.0.0.1', '-U', 'postgres']); break; } catch { if (Date.now() >= deadline) throw Error('Isolated PostgreSQL not ready'); await new Promise(r => setTimeout(r, 200)); } }
  docker(['exec', container, 'createdb', '-U', 'postgres', database]);
  sql(await readFile(resolve(project, 'supabase/tests/naver-bootstrap.sql'), 'utf8'));
  sql(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const file of ['20261021093111_life_naver_subscriptions.sql', '20261021094614_naver_conflict_http409.sql', '20261021113658_life_naver_captures.sql']) sql(await readFile(resolve(project, 'supabase/migrations', file), 'utf8'));
  const user = randomUUID(), foreign = randomUUID(), ws = randomUUID();
  let sub = owner(user, `select public.life_naver_save('${ws}','rescan_fixture',0,false);`);
  owner(user, `select public.life_naver_inventory_start('${sub.id}',1);`);
  check('disabled runtime never claims or resets inventory', () => assert.deepEqual(worker('select public.life_naver_inventory_claim();'), []));
  sql('update haedo_naver_private.runtime set ready=true;');
  sub = owner(user, `select public.life_naver_save('${ws}','rescan_fixture',1,true);`);
  const due = () => sql(`update haedo_naver_private.inventory set next_check_at=clock_timestamp()-interval '1 second' where subscription_id='${sub.id}';`);
  const claim = () => { due(); return worker('select public.life_naver_inventory_claim();')[0]; };
  const finish = (lease, entries, total, next, error = null) => worker(`select public.life_naver_inventory_finish('${lease.subscription_id}','${lease.lease_token}',${lease.revision},${lease.page},${jlit(entries)},${total ?? 'null'},${next ?? 'null'},${lit(error)});`);
  const inv = () => json(sql(`select to_jsonb(i) from haedo_naver_private.inventory i where subscription_id='${sub.id}';`));
  const queue = () => json(sql("select coalesce(jsonb_agg(log_no order by log_no),'[]') from haedo_naver_private.capture_jobs;"));
  let lease = claim(); const initialScan = lease.scan_id;
  finish(lease, [entry(30), entry(29)], 3, 2);
  lease = claim(); let result = finish(lease, [entry(28), entry(27)], 4, null);
  assert.equal(result.inventory.last_error, 'inventory_changed');
  lease = claim();
  check('original SQL reproduces unattended stale-total and stale-page continuation', () => {
    assert.equal(lease.page, 2); assert.equal(lease.total_start, 3); assert.equal(lease.scan_id, initialScan);
    result = finish(lease, [entry(28), entry(27)], 4, null);
    assert.equal(result.inventory.status, 'partial'); assert.equal(result.inventory.last_error, 'inventory_changed');
    assert.equal(result.inventory.baseline_completed_at, null); assert.deepEqual(queue(), []);
    report.originalFailureReproduced = true;
    report.originalFailure = { initialScan, repeatedPage: lease.page, staleTotal: lease.total_start, observedTotal: 4, status: result.inventory.status, error: result.inventory.last_error };
  });
  // Existing private capture, asset declaration and checkpoint must survive the
  // migration byte-for-byte. Synthetic sentinel payload, not a worker result.
  const savedCapture = randomUUID(), savedJob = randomUUID();
  sql(`insert into public.life_naver_captures(id,owner_id,blog_id,log_no,capture_hash,payload) values('${savedCapture}','${user}','rescan_fixture','26','${'a'.repeat(64)}','{"fixture":"private preserved capture"}');
    insert into haedo_naver_private.capture_jobs(id,owner_id,subscription_id,blog_id,log_no,progress) values('${savedJob}','${user}','${sub.id}','rescan_fixture','26','{"fixture":"pending checkpoint"}');
    insert into haedo_naver_private.capture_assets values('${user}/fixture','${user}','${'b'.repeat(64)}','image/png',7);`);
  const preserved = () => sql(`select jsonb_build_object('capture',(select to_jsonb(c) from public.life_naver_captures c where id='${savedCapture}'),
    'job',(select to_jsonb(j) from haedo_naver_private.capture_jobs j where id='${savedJob}'),'assets',(select jsonb_agg(to_jsonb(a)) from haedo_naver_private.capture_assets a));`).trim();
  const snapshot = () => sql(`select jsonb_build_object('inventory',(select jsonb_agg(to_jsonb(i) order by subscription_id) from haedo_naver_private.inventory i),
    'entries',(select jsonb_agg(to_jsonb(e) order by subscription_id,log_no) from haedo_naver_private.inventory_entries e),'seen',(select jsonb_agg(to_jsonb(s) order by subscription_id,scan_id,log_no) from haedo_naver_private.inventory_seen s),
    'receipts',(select jsonb_agg(to_jsonb(r) order by kind,id,lease_token) from haedo_naver_private.capture_receipts r),'runtime',(select ready from haedo_naver_private.runtime));`).trim();
  const definitions = () => sql("select coalesce(jsonb_agg(jsonb_build_array(p.oid::text,p.proowner,p.proacl::text,pg_get_functiondef(p.oid)) order by p.oid),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','haedo_naver_private') and not(n.nspname='haedo_naver_private' and p.proname='inventory_claim');").trim();
  const acl = () => sql("select jsonb_build_array(p.oid::text,p.proowner,p.proacl::text,p.prosecdef,p.proconfig) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='haedo_naver_private' and p.proname='inventory_claim';").trim();
  const originalData = snapshot(), originalProtected = preserved(), otherDefinitions = definitions(), originalACL = acl();
  const source = await readFile(resolve(project, migration), 'utf8'); report.migrationSHA256 = createHash('sha256').update(source).digest('hex');
  check('additive migration failure rolls back function replacement and every existing row', () => {
    const beforeDefinition = sql("select pg_get_functiondef('haedo_naver_private.inventory_claim(integer,uuid,uuid)'::regprocedure);");
    assert.throws(() => sql(source.replace(/commit;\s*$/, 'select 1/0;commit;')), /division by zero/);
    assert.equal(sql("select pg_get_functiondef('haedo_naver_private.inventory_claim(integer,uuid,uuid)'::regprocedure);"), beforeDefinition);
    assert.equal(snapshot(), originalData); assert.equal(preserved(), originalProtected);
  });
  sql(source);
  check('only the intended function body changes; ACL, wrapper, all data and readiness stay exact', () => {
    assert.equal(definitions(), otherDefinitions); assert.equal(acl(), originalACL); assert.equal(snapshot(), originalData); assert.equal(preserved(), originalProtected);
  });
  lease = claim();
  check('automatic claim restarts changed total at page one with a fresh seen-set identity', () => {
    assert.equal(lease.page, 1); assert.equal(lease.total_start, null); assert.notEqual(lease.scan_id, initialScan);
    assert.equal(sql(`select count(*) from haedo_naver_private.inventory_seen where subscription_id='${sub.id}' and scan_id='${lease.scan_id}';`).trim(), '0');
    assert.equal(sql(`select count(*) from haedo_naver_private.inventory_seen where subscription_id='${sub.id}' and scan_id='${initialScan}';`).trim(), '4');
  });
  const firstResult = finish(lease, [entry(30), entry(29)], 4, 2);
  check('new scan finish receipt remains exact-replay safe and rejects a changed replay body', () => {
    assert.deepEqual(finish(lease, [entry(30), entry(29)], 4, 2), firstResult);
    assert.throws(() => finish(lease, [entry(30)], 4, 2), /operation_mismatch/);
  });
  lease = claim(); result = finish(lease, [entry(28), entry(27)], 4, null);
  check('automatic recovery completes the first stable baseline without auto-importing old posts', () => {
    assert.equal(result.inventory.status, 'complete'); assert.equal(result.inventory.baseline_count, 4); assert.ok(result.inventory.baseline_completed_at);
    assert.deepEqual(queue(), ['26']);
  });
  const baseline = inv(), baselineFields = value => [value.baseline_completed_at, value.baseline_scan_id, value.baseline_count];
  lease = claim(); const changedScan = lease.scan_id;
  finish(lease, [entry(31), entry(30)], 5, 2);
  lease = claim(); result = finish(lease, [entry(32), entry(29)], 6, 3);
  assert.equal(result.inventory.last_error, 'inventory_changed');
  lease = claim(); assert.equal(lease.page, 1); assert.equal(lease.total_start, null); assert.notEqual(lease.scan_id, changedScan);
  finish(lease, [entry(32), entry(31), entry(30)], 6, 2);
  lease = claim(); result = finish(lease, [entry(29), entry(28), entry(27)], 6, null);
  check('post-baseline changed-list recovery preserves original baseline and queues new identities once', () => {
    assert.equal(result.inventory.status, 'complete'); assert.deepEqual(baselineFields(inv()), baselineFields(baseline));
    assert.deepEqual(queue(), ['26', '31', '32']);
    assert.equal(sql(`select bool_and(baseline and not auto_eligible) from haedo_naver_private.inventory_entries where subscription_id='${sub.id}' and log_no in ('27','28','29','30');`).trim(), 't');
    assert.equal(preserved(), originalProtected);
  });
  lease = claim(); const incompleteScan = lease.scan_id;
  result = finish(lease, [entry(32)], 6, null); assert.equal(result.inventory.last_error, 'inventory_incomplete');
  lease = claim();
  check('incomplete terminal inventory also restarts instead of reusing stale seen observations', () => {
    assert.equal(lease.page, 1); assert.equal(lease.total_start, null); assert.notEqual(lease.scan_id, incompleteScan);
    assert.deepEqual(baselineFields(inv()), baselineFields(baseline));
  });
  finish(lease, [entry(32), entry(31), entry(30)], 6, 2);
  lease = claim(); const resumableScan = lease.scan_id; result = finish(lease, [], null, null, 'network_error');
  lease = claim();
  check('transport failures retain valid page and same scan for bounded resume', () => {
    assert.equal(lease.page, 2); assert.equal(lease.total_start, 6); assert.equal(lease.scan_id, resumableScan);
  });
  const inFlight = snapshot();
  check('active lease, foreign owner, invalid limits and client roles cannot start or reset competing scans', () => {
    assert.deepEqual(worker('select public.life_naver_inventory_claim();'), []);
    assert.deepEqual(worker(`select public.life_naver_inventory_claim(1,'${sub.id}','${foreign}');`), []);
    assert.throws(() => worker('select public.life_naver_inventory_claim(3);'), /invalid_request/);
    assert.throws(() => sql('set role authenticated;select public.life_naver_inventory_claim();'), /permission denied/);
    assert.equal(snapshot(), inFlight);
  });
  sql('update haedo_naver_private.runtime set ready=false;'); const paused = snapshot();
  check('global pause fences claim and finish while preserving original captures and partial progress', () => {
    assert.deepEqual(worker('select public.life_naver_inventory_claim();'), []);
    assert.equal(finish(lease, [entry(29), entry(28), entry(27)], 6, null).status, 'stale');
    assert.equal(snapshot(), paused); assert.equal(preserved(), originalProtected);
  });
  sql('update haedo_naver_private.runtime set ready=true;');
  finish(lease, [entry(29), entry(28), entry(27)], 6, null);
  sql('update haedo_naver_private.runtime set ready=false;');
  const beforeReinstall = snapshot(); sql(source);
  check('reinstall is idempotent and never activates collection or changes existing private data', () => {
    assert.equal(snapshot(), beforeReinstall); assert.equal(definitions(), otherDefinitions); assert.equal(acl(), originalACL); assert.equal(preserved(), originalProtected);
  });
  report.pass = true;
} catch (error) { report.error = { message: error.message }; throw error; }
finally {
  if (owns) { docker(['rm', '--force', container]); report.localContainerRemoved = true; }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
