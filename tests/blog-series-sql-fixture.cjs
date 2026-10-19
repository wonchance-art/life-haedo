'use strict';
/* Extends the existing actual-SQL blog transport with the existing page RPCs.
 * Auth/Storage HTTP remain synthetic; only isolated QA databases are accepted. */
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { LocalSQLBlogCloud } = require('./blog-completion-browser.cjs');
const { accounts } = require('./life-sync-browser.cjs');
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
class LocalSQLSeriesCloud extends LocalSQLBlogCloud {
  constructor(options) { super(options); this.pageRequests = []; this.pageFailure = null; }
  async prepare() {
    this.docker(['exec', '-i', this.container, 'createdb', '-U', 'postgres', this.database]);
    const read = name => fs.readFile(path.resolve(__dirname, '..', name), 'utf8');
    const source = [await read('supabase/tests/blog-bootstrap.sql'),
      'create table auth.users(id uuid primary key); create function public.life_composition_valid(jsonb) returns boolean language sql immutable as $$select true$$;',
      await read('supabase/migrations/20261005120000_life_public_pages.sql'),
      await read('supabase/migrations/20261012010000_life_page_posts.sql'),
      await read('supabase/migrations/20261017144744_life_blog_originals.sql'),
      'insert into auth.users(id) values ' + Object.values(accounts).map(account => '(' + literal(account.id) + '::uuid)').join(',') + ';'].join('\n');
    this.docker(['exec', '-i', this.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', this.database], source);
  }
  async initialize() {
    await super.initialize();
    const rows = this.sql(`select jsonb_agg(jsonb_build_object('name',p.proname,'args',
      (select coalesce(jsonb_agg(jsonb_build_object('name',p.proargnames[i],'type',format_type(p.proargtypes[i-1],null)) order by i),'[]') from generate_subscripts(p.proargnames,1) i)))
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('life_public_page_get','life_public_page_put','life_public_page_read','life_public_page_list');`);
    for (const row of rows) { assert(!this.functions.has(row.name)); this.functions.set(row.name, row.args); }
  }
  rpc(owner, name, input, role = owner ? 'authenticated' : 'anon') {
    if (name.startsWith('life_blog_')) return super.rpc(owner, name, input, role);
    assert(['life_public_page_get', 'life_public_page_put', 'life_public_page_read', 'life_public_page_list'].includes(name));
    const signature = this.functions.get(name); assert(signature); const names = new Map(signature.map(item => [item.name, item.type]));
    const args = Object.entries(input).map(([key, value]) => { assert(names.has(key)); return key + ' => ' + this.typed(value, names.get(key)); });
    return this.sql('select to_jsonb(public.' + name + '(' + args.join(',') + '));', { owner, role });
  }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.startsWith('/rest/v1/rpc/life_public_page_')) return super.handle(route, device);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0' };
    const send = (value, status = 200) => route.fulfill({ status, headers, body: status === 204 ? '' : JSON.stringify(value) });
    if (request.method() === 'OPTIONS') return send(null, 204);
    assert.equal(request.method(), 'POST'); const name = url.pathname.split('/').at(-1), owner = this.owner(request), args = request.postDataJSON();
    if (name === 'life_public_page_read') assert.equal(request.headers().authorization, undefined);
    this.pageRequests.push({ name, owner, device, args: structuredClone(args) });
    try {
      const value = this.rpc(owner, name, args);
      if (name === 'life_public_page_put' && this.pageFailure === 'ack') { this.pageFailure = null; this.expectedFailures++; return route.abort('failed'); }
      return send(value);
    } catch (error) { if (error instanceof assert.AssertionError) throw error; return send({ code: error.code, message: error.message }, error.code === '42501' ? 403 : 400); }
  }
}
module.exports = { LocalSQLSeriesCloud };
