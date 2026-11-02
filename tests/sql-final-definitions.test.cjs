'use strict';
// docs/design-review/sql-final-definitions.md must match what the generator reads
// from supabase/migrations, so a new redefinition cannot leave the list stale.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const load = () => import(pathToFileURL(path.join(root, 'scripts/sql-final-definitions.mjs')).href);

test('SQL final-definition list matches the migrations', async () => {
  const generator = await load();
  const expected = await generator.build(pathToFileURL(root + path.sep));
  const actual = await fs.readFile(path.join(root, generator.OUTPUT), 'utf8');
  assert.equal(actual, expected, 'Run node scripts/sql-final-definitions.mjs');
});

test('scan follows replacement, quoted defaults, renames and drops', async () => {
  const { scan, summarize } = await load();
  const files = [
    { name: '1.sql', sql: [
      'create table public.t(id int);',
      `create function public.f(p jsonb, q jsonb default '{"a":"","b":""}'::jsonb) returns int language sql as $$ select 1 $$;`,
      'create function public.g(a int) returns int language sql as $$ select 1 $$;',
    ].join('\n') },
    { name: '2.sql', sql: [
      '-- create function public.commented(x int)',
      'alter table public.t add column x int, enable row level security;',
      'alter function public.f(jsonb,jsonb) rename to f_body;',
      'create or replace function public.f(p_data jsonb, q jsonb) returns int language sql as $$ select 2 $$;',
      'drop function if exists public.g(integer);',
    ].join('\n') },
  ];
  const s = summarize(scan(files));
  const f = s.functions.find(x => x.name === 'public.f');
  assert.deepEqual(f.files, ['1.sql', '2.sql']);
  assert.deepEqual(f.live, ['jsonb, jsonb']);
  assert.deepEqual(f.renamedTo, ['public.f_body']);
  const body = s.functions.find(x => x.name === 'public.f_body');
  assert.equal(body.renamedFrom, 'public.f');
  assert.equal(body.bodyFile, '1.sql');
  assert.equal(s.functions.find(x => x.name === 'public.g').dropped, true);
  assert.equal(s.functions.some(x => x.name === 'public.commented'), false);
  assert.deepEqual(s.redefinedTables.map(t => [t.name, t.alters.flatMap(a => a.detail)]), [['public.t', ['add column']]]);
});
