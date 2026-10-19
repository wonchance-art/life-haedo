'use strict';
/* Actual isolated PostgreSQL material/blog RPC transport. Auth and immutable
 * Storage binary/Edge delivery reuse the existing synthetic HTTP boundary. */
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { LocalSQLBlogCloud,digest } = require('./blog-completion-browser.cjs');
class LocalSQLMaterialCloud extends LocalSQLBlogCloud {
  constructor(options) {
    super(options); this.materialRequests = []; this.materialFailure = null; this.materialMutation = null; this.materialGate = null;
  }
  async prepare(migration) {
    assert.match(migration, /^supabase\/migrations\/\d{14}_life_material_[a-z_]+\.sql$/);
    this.docker(['exec', '-i', this.container, 'createdb', '-U', 'postgres', this.database]);
    const files = await Promise.all(['supabase/tests/blog-bootstrap.sql', 'supabase/migrations/20261017144744_life_blog_originals.sql', migration].map(name => fs.readFile(path.resolve(__dirname, '..', name), 'utf8')));
    this.docker(['exec', '-i', this.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', this.database], files.join('\n'));
    this.installedMigrationSha256=digest(Buffer.from(files[2]));
  }
  async initialize() {
    await super.initialize();
    const rows = this.sql(`select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'args',
      (select coalesce(jsonb_agg(jsonb_build_object('name',p.proargnames[i],'type',format_type(p.proargtypes[i-1],null)) order by i),'[]') from generate_subscripts(p.proargnames,1) i))),'[]')
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('life_material_get','life_material_list','life_material_put');`);
    assert.equal(rows.length, 3, 'Install the actual material migration before integration verification');
    for (const row of rows) { assert(!this.functions.has(row.name)); this.functions.set(row.name, row.args); }
  }
  typed(value, type) {
    // The keyset-list cursor is a genuine timestamptz argument, not an SQL
    // fragment. Review this one additional introspected type explicitly.
    if (type === 'timestamp with time zone') {
      if (value === null) return 'null::timestamptz';
      assert.equal(typeof value, 'string'); assert(Number.isFinite(Date.parse(value)));
      return "'" + value.replaceAll("'", "''") + "'::timestamptz";
    }
    return super.typed(value, type);
  }
  rpc(owner, name, input, role = owner ? 'authenticated' : 'anon') {
    if (name.startsWith('life_blog_')) return super.rpc(owner, name, input, role);
    assert(['life_material_get', 'life_material_list', 'life_material_put'].includes(name));
    const signature = this.functions.get(name); assert(signature); const names = new Map(signature.map(arg => [arg.name, arg.type]));
    const args = Object.entries(input).map(([key, value]) => { assert.match(key, /^p_[a-z0-9_]+$/); assert(names.has(key), 'Client/SQL argument mismatch: ' + name + '.' + key); return key + ' => ' + this.typed(value, names.get(key)); });
    return this.sql('select to_jsonb(public.' + name + '(' + args.join(',') + '));', { owner, role });
  }
  holdMaterialNext(predicate) {
    assert.equal(this.materialGate, null); let release, entered;
    const gate = { predicate, arrived: new Promise(resolve => { entered = resolve; }), waiting: new Promise(resolve => { release = resolve; }), release, entered };
    this.materialGate = gate; return gate;
  }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.startsWith('/rest/v1/rpc/life_material_')) return super.handle(route, device);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0' };
    const send = (body, status = 200) => route.fulfill({ status, headers, body: status === 204 ? '' : JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return send(null, 204);
    assert.equal(request.method(), 'POST'); const rpc = url.pathname.split('/').at(-1), owner = this.owner(request), body = request.postDataJSON();
    const entry = { rpc, device, owner, body: structuredClone(body) }; this.materialRequests.push(entry);
    try {
      let response = this.rpc(owner, rpc, body);
      if (this.materialFailure?.(entry, response)) { this.materialFailure = null; this.expectedFailures++; return route.abort('failed'); }
      if (this.materialMutation?.when(entry, response)) { const mutation = this.materialMutation; this.materialMutation = null; response = mutation.change(structuredClone(response)); }
      const gate = this.materialGate;
      if (gate?.predicate(entry, response)) { this.materialGate = null; gate.entered({ entry, response }); await gate.waiting; }
      return send(response);
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      return send({ code: error.code || 'local_sql_error', message: error.message }, error.code === '42501' ? 403 : 400);
    }
  }
}
module.exports = { LocalSQLMaterialCloud };
