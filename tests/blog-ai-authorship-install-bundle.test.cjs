'use strict';
// The SQL Editor install file must stay identical to what its generator builds
// from the 2026-11-02 AI authorship migration.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('combined AI authorship install file matches its migration', async () => {
  const root = path.resolve(__dirname, '..');
  const generator = await import(pathToFileURL(path.join(root, 'scripts/build-blog-ai-authorship-install.mjs')).href);
  const expected = await generator.build(pathToFileURL(root + path.sep));
  const actual = await fs.readFile(path.join(root, generator.OUTPUT), 'utf8');
  assert.equal(actual, expected, 'Run node scripts/build-blog-ai-authorship-install.mjs');
  for (const name of generator.MIGRATIONS) assert.ok(actual.includes(`-- ===== ${name} =====`), name);
  assert.equal((actual.match(/^do \$haedo_install\$$/gm) || []).length, 1, 'one installing statement');
  assert.equal((actual.match(/^(begin|commit);$/gim) || []).length, 0, 'no transaction control that the editor could split');
});

test('the authorship migration changes only the author rule of the two functions it redefines', async () => {
  const root = path.resolve(__dirname, '..');
  const read = name => fs.readFile(path.join(root, 'supabase/migrations', name), 'utf8');
  const fn = (sql, name) => {
    const start = sql.indexOf('create or replace function haedo_blog_private.' + name + '(');
    assert.ok(start >= 0, name); return sql.slice(start, sql.indexOf('\nend $$;', start) + 8);
  };
  const before = await read('20261101091500_life_blog_account_sync.sql'), after = await read('20261102110000_life_blog_ai_authorship.sql');
  const strip = text => text.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
  // valid_document: the allowed-key list gains 'author' and one author rule follows the link rule.
  const expectedValid = fn(before, 'valid_document')
    .replace("array['bold','italic','underline','header','blockquote','list','align','link'],'{}'", "array['bold','italic','underline','header','blockquote','list','align','link','author'],'{}'")
    .replace("elsif k='link' and not haedo_blog_private.url(value) then return false; end if;",
      "elsif k='link' and not haedo_blog_private.url(value) then return false;\n       elsif k='author' and (value<>'\"ai\"'::jsonb or jsonb_typeof(o->'insert')<>'string') then return false; end if;");
  assert.equal(strip(fn(after, 'valid_document')), strip(expectedValid));
  // publish: only the string-insert branch drops the author attribute.
  const expectedPublish = fn(before, 'publish')
    .replace(' op jsonb; a haedo_blog_private', ' op jsonb; text_op jsonb; a haedo_blog_private')
    .replace("  if jsonb_typeof(op->'insert')='string' then ops:=ops||jsonb_build_array(op);",
      "  if jsonb_typeof(op->'insert')='string' then\n    text_op:=op;\n    if jsonb_typeof(op->'attributes')='object' and op->'attributes' ? 'author' then\n      text_op:=case when (op->'attributes')-'author'='{}'::jsonb then op-'attributes' else jsonb_set(op,'{attributes}',(op->'attributes')-'author') end;\n    end if;\n    ops:=ops||jsonb_build_array(text_op);");
  assert.equal(strip(fn(after, 'publish')), strip(expectedPublish));
});
