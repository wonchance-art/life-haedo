#!/usr/bin/env node
'use strict';

// Cross-layer contract check: real local PostgreSQL results, production JS decoders.
// The SDK/fetch transport is simulated. This is not a hosted Supabase/PostgREST test.
// Usage: node tests/life-share-contract.cjs --container life-haedo-public-page-sql
// Requires the synthetic auth shim in an isolated local postgres container.
// Applies the current migration there; all generated accounts/pages/receipts
// are inside a subsequent transaction and rolled back.
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const Share = require('../assets/life/share.js');
const Remote = require('../assets/life/share-remote.js');
const root = path.resolve(__dirname, '..');
const container = process.argv[process.argv.indexOf('--container') + 1];
assert(process.argv.includes('--container') && /^life-haedo-[a-z0-9-]+$/.test(container),
  'Provide an explicit isolated life-haedo-* local PostgreSQL container.');
const output = path.join(root, '.local/share-contract');
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key];
function docker(args, input) {
  const result = spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args],
    { env, input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'local Docker command failed');
  return result.stdout.trim();
}
const inspected = docker(['inspect', '--format', '{{json .HostConfig.NetworkMode}}\n{{json .HostConfig.PortBindings}}\n{{json .Config.Image}}', container]).split('\n').map(JSON.parse);
assert.equal(inspected[0], 'none', 'Only a network-isolated local fixture container is allowed.');
assert.equal(Object.keys(inspected[1] || {}).length, 0, 'Do not target a network-exposed database.');
assert.match(inspected[2], /^postgres:17(?:[.-]|$)/, 'This check expects the PostgreSQL 17 fixture.');
const migrationPath = path.join(root, 'supabase/migrations/20261005120000_life_public_pages.sql');
const migrationSource = fs.readFileSync(migrationPath, 'utf8');
docker(['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], migrationSource);
const counts = () => JSON.parse(docker(['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'],
  "select jsonb_build_object('users',(select count(*) from auth.users),'pages',(select count(*) from public.life_public_pages),'receipts',(select count(*) from public.life_public_page_receipts));"));
const beforeCounts = counts();
const ids = Object.fromEntries(['owner', 'other', 'workspace', 'emptyWorkspace', 'publish', 'update', 'conflict', 'revoke', 'republish', 'initialRevoke', 'otherWrite'].map(key => [key, randomUUID()]));
const snapshot = {
  format: 'life-share-v1', title: '산책과 독서 사이에서 모은 생각', intro: '한 주 동안 다시 읽고 싶었던 문장과 생각입니다.',
  entries: [{ title: '천천히 걷는 일과 주의를 기울이는 일', pinned: true, note: '익명 검증용으로 직접 만든 글입니다.',
    parts: [{ title: '느리게 읽고 오래 남기는 기록', origin: 'obsidian', url: 'https://example.invalid/walk-and-read',
      author: { label: '익명 작성자', relation: 'self' }, originalCreatedAt: '2026-10-05',
      coverage: { status: 'partial', omissions: ['사진 미포함'] }, text: '기록을 다시 읽으면 지나쳤던 관심이 보인다.\n오늘은 작은 발견 하나를 남긴다. 🌱', textKind: 'excerpt' }] }]
};
const changed = { ...snapshot, title: '갱신한 산책과 독서 기록' };
Share.validate(snapshot); Share.validate(changed);
const clone = value => JSON.parse(JSON.stringify(value));
const variants = [
  ['ordinary Korean and paired emoji', value => value],
  ['title exactly 500 UTF-16 units', value => { value.title = '🌱'.repeat(250); }],
  ['title exceeds 500 UTF-16 units', value => { value.title = '🌱'.repeat(251); }],
  ['ECMAScript whitespace-only title', value => { value.title = '\u00a0\u2003\ufeff'; }],
  ['control character in title', value => { value.title = '제어\u0001문자'; }],
  ['whitespace-only published text', value => { value.entries[0].parts[0].text = '\n\t'; }],
  ['valid Korean hostname', value => { value.entries[0].parts[0].url = 'https://한글.example/기록'; }],
  ['invalid URL port', value => { value.entries[0].parts[0].url = 'https://example.invalid:bad/read'; }],
  ['out-of-range URL port', value => { value.entries[0].parts[0].url = 'https://example.invalid:65536/read'; }],
  ['invalid bracketed URL host', value => { value.entries[0].parts[0].url = 'https://[broken/read'; }],
  ['out-of-range numeric IPv4 host', value => { value.entries[0].parts[0].url = 'http://999.999.999.999/a'; }],
  ['invalid bracketed IPv6 host', value => { value.entries[0].parts[0].url = 'https://[::::]/'; }]
].map(([name, mutate]) => {
  const value = clone(snapshot); mutate(value);
  let valid = true;
  try { Share.validate(value); } catch (_) { valid = false; }
  return { name, value, valid };
});
const byteBoundary = clone(snapshot);
byteBoundary.intro = '';
byteBoundary.entries[0].parts = Array.from({ length: 20 }, () => ({ ...clone(snapshot.entries[0].parts[0]), text: 'x'.repeat(50000) }));
byteBoundary.intro = 'x'.repeat(Share.LIMITS.bytes - Buffer.byteLength(JSON.stringify(byteBoundary)));
assert.equal(Buffer.byteLength(JSON.stringify(byteBoundary)), Share.LIMITS.bytes);
Share.validate(byteBoundary);
variants.push({ name: 'compact JSON exactly one MiB', value: byteBoundary, valid: true },
  { name: 'compact JSON one byte beyond one MiB', value: { ...byteBoundary, intro: byteBoundary.intro + 'x' }, valid: false });
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const jsonSQL = value => literal(JSON.stringify(value)) + '::jsonb';
const record = (key, expression) => `results := results || jsonb_build_object(${literal(key)}, ${expression});`;
const put = (revision, operation, action = 'publish', value = snapshot, workspace = ids.workspace) =>
  `public.life_public_page_put(${literal(workspace)}::uuid,${revision},${literal(operation)}::uuid,${literal(action)},${value === null ? 'null' : jsonSQL(value)})`;
const claims = id => `perform set_config('request.jwt.claims',${literal(JSON.stringify({ sub: id, role: 'authenticated' }))},true);`;
const ownerGet = `public.life_public_page_get(${literal(ids.workspace)}::uuid)`;
const sql = `begin;
do $contract$
declare results jsonb := '{}'::jsonb; first_result jsonb; result jsonb; public_id uuid; new_public_id uuid; n integer;
begin
  insert into auth.users(id) values(${literal(ids.owner)}::uuid),(${literal(ids.other)}::uuid);
  execute 'set local role authenticated';
  ${claims(ids.owner)}
  ${record('ownerMissing', ownerGet)}
  ${record('listEmpty', 'public.life_public_page_list(null)')}
  first_result := ${put(0, ids.publish)};
  public_id := (first_result ->> 'publicId')::uuid;
  ${record('publish', 'first_result')}
  ${record('ownerPublished', ownerGet)}
  ${record('listPublished', 'public.life_public_page_list(null)')}
  ${record('publishReplay', put(0, ids.publish))}
  execute 'set local role anon';
  ${record('anonymousPublished', 'public.life_public_page_read(public_id)')}
  ${record('anonymousMissing', `public.life_public_page_read(${literal(ids.workspace)}::uuid)`)}
  begin perform ${ownerGet}; exception when insufficient_privilege then
    ${record('anonymousOwnerError', "jsonb_build_object('code',SQLSTATE,'message',SQLERRM)")}
  end;
  begin perform public.life_public_page_list(null); exception when insufficient_privilege then
    ${record('anonymousListError', "jsonb_build_object('code',SQLSTATE,'message',SQLERRM)")}
  end;
  execute 'set local role authenticated';
  ${record('update', put(1, ids.update, 'publish', changed))}
  ${record('ownerUpdated', ownerGet)}
  ${record('conflict', put(0, ids.conflict))}
  begin perform ${put(0, ids.publish, 'publish', changed)}; exception when invalid_parameter_value then
    ${record('operationMismatchError', "jsonb_build_object('code',SQLSTATE,'message',SQLERRM)")}
  end;
  ${record('revoke', put(2, ids.revoke, 'revoke', null))}
  ${record('ownerRevoked', ownerGet)}
  ${record('listRevoked', 'public.life_public_page_list(null)')}
  ${record('revokeReplay', put(2, ids.revoke, 'revoke', null))}
  execute 'set local role anon';
  ${record('anonymousRevoked', 'public.life_public_page_read(public_id)')}
  execute 'set local role authenticated';
  ${record('historicalPublishReplay', put(0, ids.publish))}
  ${record('ownerAfterHistoricalPublish', ownerGet)}
  result := ${put(3, ids.republish)};
  new_public_id := (result ->> 'publicId')::uuid;
  ${record('republish', 'result')}
  ${record('historicalRevokeReplay', put(2, ids.revoke, 'revoke', null))}
  ${record('ownerAfterHistoricalRevoke', ownerGet)}
  ${record('initialRevoke', put(0, ids.initialRevoke, 'revoke', null, ids.emptyWorkspace))}
  ${record('listRepublished', 'public.life_public_page_list(null)')}
  ${claims(ids.other)}
  ${record('otherOwnerMissing', ownerGet)}
  ${record('otherWriteMissing', put(1, ids.otherWrite))}
  ${record('otherNamespacePublish', put(0, ids.publish))}
  ${record('listOther', 'public.life_public_page_list(null)')}
  execute 'set local role anon';
  ${record('anonymousOldLink', 'public.life_public_page_read(public_id)')}
  ${record('anonymousRepublished', 'public.life_public_page_read(new_public_id)')}
  execute 'set local role authenticated';
  ${claims(ids.owner)}
  for n in 1..51 loop
    perform public.life_public_page_put(gen_random_uuid(),0,gen_random_uuid(),'publish',${jsonSQL(snapshot)});
  end loop;
  result := public.life_public_page_list(null);
  ${record('listFirst', 'result')}
  ${record('listNext', "public.life_public_page_list((result ->> 'nextCursor')::uuid)")}
  execute 'reset role';
  ${record('validation', `jsonb_build_object(${variants.map(({ name, value }) => literal(name) + ',public.life_public_page_valid(' + jsonSQL(value) + ')').join(',')})`)}
  perform set_config('haedo.share_contract.results',results::text,true);
end;
$contract$;
select current_setting('haedo.share_contract.results');
rollback;`;
const raw = docker(['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], sql);
const fixture = JSON.parse(raw);
// Keep the actual SQL JSON response, including its timestamp representation.
fs.writeFileSync(path.join(output, 'sql-results.json'), raw + '\n');
const config = { url: 'https://local-contract.invalid', key: 'sb_publishable_contractfixture' };
const checks = [];
function ownerFor(response, expected, id = ids.owner, error = null) {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  let calls = 0;
  const auth = { ready: true, config, epoch: 0, user: { id }, async verify() { return this.user; }, client: {
    rpc(name, args) {
      calls++; assert.deepEqual({ name, args }, expected);
      return { abortSignal(signal) { assert.equal(signal.aborted, false); return Promise.resolve({ data: response, error }); } };
    }
  } };
  return { owner: Remote.createOwner({ auth, storage }), memory, calls: () => calls };
}
async function check(name, run) {
  await run(); checks.push({ name, passed: true });
}
const getCase = (label, expectedStatus, expectedRevision, id = ids.owner) => check(label, async () => {
  const f = ownerFor(fixture[label], { name: 'life_public_page_get', args: { p_workspace_id: ids.workspace } }, id);
  try { const value = await f.owner.get(ids.workspace); assert.deepEqual(value, fixture[label]);
    assert.equal(value.status, expectedStatus); assert.equal(value.revision, expectedRevision); assert.equal(f.calls(), 1);
  } finally { f.owner.dispose(); }
});
const makeRequest = (revision, operationId, action = 'publish', value = snapshot, workspaceId = ids.workspace) =>
  ({ workspaceId, expectedRevision: revision, operationId, action, snapshot: value });
const rpcRequest = value => ({ name: 'life_public_page_put', args: { p_workspace_id: value.workspaceId,
  p_expected_revision: value.expectedRevision, p_operation_id: value.operationId, p_action: value.action, p_snapshot: value.snapshot } });
const putCase = (label, request, status, revision, id = ids.owner) => check(label, async () => {
  const f = ownerFor(fixture[label], rpcRequest(request), id);
  try { const value = await f.owner.put(request); assert.deepEqual(value, fixture[label]); assert.equal(value.status, status);
    if (revision !== undefined) assert.equal(value.revision, revision);
    assert.equal(f.owner.pending(request.workspaceId), null); assert.equal(f.calls(), 1);
  } finally { f.owner.dispose(); }
});
const listCase = (label, count, after = null, id = ids.owner) => check(label, async () => {
  const f = ownerFor(fixture[label], { name: 'life_public_page_list', args: { p_after: after } }, id);
  try { const value = await f.owner.list(after); assert.deepEqual(value, fixture[label]); assert.equal(value.pages.length, count);
    assert.equal(f.calls(), 1);
  } finally { f.owner.dispose(); }
});
const readCase = (label, publicId, status, revision) => check(label, async () => {
  let calls = 0;
  const reader = Remote.createReader({ config, fetch: async (url, options) => {
    calls++; assert.equal(url, config.url + '/rest/v1/rpc/life_public_page_read');
    assert.deepEqual(JSON.parse(options.body), { p_public_id: publicId });
    assert.equal(new Headers(options.headers).has('Authorization'), false);
    assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    return new Response(JSON.stringify(fixture[label]));
  } });
  try { const value = await reader.read(publicId); assert.deepEqual(value, fixture[label]); assert.equal(value.status, status);
    if (revision !== undefined) assert.equal(value.revision, revision); assert.equal(calls, 1);
  } finally { reader.dispose(); }
});
async function main() {
  await getCase('ownerMissing', 'missing', 0);
  await putCase('publish', makeRequest(0, ids.publish), 'stored', 1);
  await getCase('ownerPublished', 'published', 1);
  await putCase('publishReplay', makeRequest(0, ids.publish), 'stored', 1);
  await readCase('anonymousPublished', fixture.publish.publicId, 'published', 1);
  await readCase('anonymousMissing', ids.workspace, 'missing');
  await putCase('update', makeRequest(1, ids.update, 'publish', changed), 'stored', 2);
  await getCase('ownerUpdated', 'published', 2);
  await putCase('conflict', makeRequest(0, ids.conflict), 'conflict', 2);
  await check('actual SQL operation mismatch maps to a recoverable named error', async () => {
    const request = makeRequest(0, ids.publish, 'publish', changed);
    const f = ownerFor(null, rpcRequest(request), ids.owner, fixture.operationMismatchError);
    try { await assert.rejects(f.owner.put(request), { code: 'operation_mismatch' });
      assert.deepEqual(f.owner.pending(ids.workspace), request);
    } finally { f.owner.dispose(); }
  });
  await putCase('revoke', makeRequest(2, ids.revoke, 'revoke', null), 'stored', 3);
  await getCase('ownerRevoked', 'revoked', 3);
  await putCase('revokeReplay', makeRequest(2, ids.revoke, 'revoke', null), 'stored', 3);
  await readCase('anonymousRevoked', fixture.publish.publicId, 'missing');
  await putCase('historicalPublishReplay', makeRequest(0, ids.publish), 'stored', 1);
  await getCase('ownerAfterHistoricalPublish', 'revoked', 3);
  await putCase('republish', makeRequest(3, ids.republish), 'stored', 4);
  await putCase('historicalRevokeReplay', makeRequest(2, ids.revoke, 'revoke', null), 'stored', 3);
  await getCase('ownerAfterHistoricalRevoke', 'published', 4);
  await putCase('initialRevoke', makeRequest(0, ids.initialRevoke, 'revoke', null, ids.emptyWorkspace), 'stored', 1);
  await getCase('otherOwnerMissing', 'missing', 0, ids.other);
  await putCase('otherWriteMissing', makeRequest(1, ids.otherWrite), 'missing', undefined, ids.other);
  await putCase('otherNamespacePublish', makeRequest(0, ids.publish), 'stored', 1, ids.other);
  await readCase('anonymousOldLink', fixture.publish.publicId, 'missing');
  await readCase('anonymousRepublished', fixture.republish.publicId, 'published', 4);
  await check('actual SQL permission error does not become transport success', async () => {
    assert.equal(fixture.anonymousOwnerError.code, '42501');
    const f = ownerFor(null, { name: 'life_public_page_get', args: { p_workspace_id: ids.workspace } }, ids.owner, fixture.anonymousOwnerError);
    try { await assert.rejects(f.owner.get(ids.workspace), { code: 'permission_denied' }); } finally { f.owner.dispose(); }
  });
  await listCase('listEmpty', 0);
  await listCase('listPublished', 1);
  await listCase('listRevoked', 0);
  await listCase('listRepublished', 1);
  await listCase('listOther', 1, null, ids.other);
  await listCase('listFirst', 50);
  await listCase('listNext', 2, fixture.listFirst.nextCursor);
  await check('owner list excludes revoked pages and other accounts across cursor pages', async () => {
    const all = [...fixture.listFirst.pages, ...fixture.listNext.pages];
    assert.equal(new Set(all.map(page => page.workspaceId)).size, 52);
    assert.equal(fixture.listNext.nextCursor, null);
    assert.equal(all.some(page => page.workspaceId === ids.emptyWorkspace), false);
    assert.equal(all.some(page => page.publicId === fixture.otherNamespacePublish.publicId), false);
    assert.equal(fixture.listOther.pages[0].publicId, fixture.otherNamespacePublish.publicId);
    assert.equal(fixture.listRepublished.pages[0].publicId, fixture.republish.publicId);
  });
  await check('actual SQL anonymous list permission error reaches owner decoder', async () => {
    assert.equal(fixture.anonymousListError.code, '42501');
    const f = ownerFor(null, { name: 'life_public_page_list', args: { p_after: null } }, ids.owner, fixture.anonymousListError);
    try { await assert.rejects(f.owner.list(), { code: 'permission_denied' }); } finally { f.owner.dispose(); }
  });
  await check('update preserves URL, revoke clears it, and republish rotates it', async () => {
    assert.equal(fixture.publish.publicId, fixture.update.publicId);
    assert.equal(fixture.revoke.publicId, null); assert.equal(fixture.ownerRevoked.publicId, null);
    assert.notEqual(fixture.republish.publicId, fixture.publish.publicId);
    assert.notEqual(fixture.otherNamespacePublish.publicId, fixture.publish.publicId);
    assert.deepEqual(fixture.historicalPublishReplay, fixture.publish);
    assert.deepEqual(fixture.historicalRevokeReplay, fixture.revoke);
  });
  await check('SQL public envelope excludes private owner, workspace and operation identities', async () => {
    const body = JSON.stringify(fixture.anonymousRepublished);
    for (const value of Object.values(ids)) assert.equal(body.includes(value), false);
    assert.deepEqual(fixture.anonymousRepublished.snapshot, snapshot);
  });
  await check('strict owner decoder rejects a stale public URL on revoked metadata', async () => {
    const malformed = { ...fixture.ownerRevoked, publicId: fixture.publish.publicId };
    const f = ownerFor(malformed, { name: 'life_public_page_get', args: { p_workspace_id: ids.workspace } });
    try { await assert.rejects(f.owner.get(ids.workspace), { code: 'invalid_remote_data' }); } finally { f.owner.dispose(); }
  });
  await check('strict write decoder preserves the pending request for a malformed revoked result', async () => {
    const request = makeRequest(2, ids.revoke, 'revoke', null);
    const f = ownerFor({ ...fixture.revoke, publicId: fixture.publish.publicId }, rpcRequest(request));
    try { await assert.rejects(f.owner.put(request), { code: 'publish_unknown' });
      assert.deepEqual(f.owner.pending(ids.workspace), request);
    } finally { f.owner.dispose(); }
  });
  await check('strict owner decoder rejects extra snapshot data', async () => {
    const f = ownerFor({ ...fixture.ownerPublished, snapshot }, { name: 'life_public_page_get', args: { p_workspace_id: ids.workspace } });
    try { await assert.rejects(f.owner.get(ids.workspace), { code: 'invalid_remote_data' }); } finally { f.owner.dispose(); }
  });
  await check('strict visitor decoder rejects extra private identifiers', async () => {
    const reader = Remote.createReader({ config, fetch: async () => new Response(JSON.stringify({ ...fixture.anonymousPublished, workspaceId: ids.workspace })) });
    try { await assert.rejects(reader.read(fixture.publish.publicId), { code: 'invalid_remote_data' }); } finally { reader.dispose(); }
  });
  for (const variant of variants) await check('SQL/client validation parity: ' + variant.name, async () => {
    assert.equal(fixture.validation[variant.name], variant.valid);
  });
  await check('rollback leaves account, page and receipt row counts unchanged', async () => {
    assert.deepEqual(counts(), beforeCounts);
  });
  const report = { timestamp: new Date().toISOString(), passed: checks.length, failed: 0,
    scope: 'Real local PostgreSQL 17 RPC JSON through production ShareRemote owner and anonymous strict decoders; SDK/fetch envelopes simulated.',
    limitations: ['No real PostgREST/HTTP or hosted Supabase connection', 'No production users or content', 'No browser/Apple hardware coverage'],
    cleanup: 'Single PostgreSQL transaction rolled back',
    inputs: Object.fromEntries(['assets/life/share.js', 'assets/life/share-remote.js', 'supabase/migrations/20261005120000_life_public_pages.sql'].map(file =>
      [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])), checks };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, failed: 0, report: '.local/share-contract/report.json', cleanup: report.cleanup }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
