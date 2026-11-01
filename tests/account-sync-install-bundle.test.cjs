'use strict';
// The SQL Editor install file must stay identical to what the generator builds
// from the six 2026-11-01 migrations, so a later migration edit cannot ship a
// stale combined file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('combined account sync install file matches its migrations', async () => {
  const root = path.resolve(__dirname, '..');
  const generator = await import(pathToFileURL(path.join(root, 'scripts/build-account-sync-install.mjs')).href);
  const expected = await generator.build(pathToFileURL(root + path.sep));
  const actual = await fs.readFile(path.join(root, generator.OUTPUT), 'utf8');
  assert.equal(actual, expected, 'Run node scripts/build-account-sync-install.mjs');
  for (const name of generator.MIGRATIONS) assert.ok(actual.includes(`-- ===== ${name} =====`), name);
  // One DO statement: atomic however the SQL Editor splits or pools statements.
  assert.equal((actual.match(/^do \$haedo_install\$$/gm) || []).length, 1, 'one installing statement');
  assert.equal((actual.match(/^(begin|commit);$/gim) || []).length, 0, 'no transaction control that the editor could split');
});
