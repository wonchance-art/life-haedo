'use strict';
// The SQL Editor install file must stay identical to what the generator builds from
// 20261104090000_life_ai_usage.sql, so a later migration edit cannot ship a stale file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('AI usage install file matches its migration', async () => {
  const root = path.resolve(__dirname, '..');
  const generator = await import(pathToFileURL(path.join(root, 'scripts/build-ai-usage-install.mjs')).href);
  const expected = await generator.build(pathToFileURL(root + path.sep));
  const actual = await fs.readFile(path.join(root, generator.OUTPUT), 'utf8');
  assert.equal(actual, expected, 'Run node scripts/build-ai-usage-install.mjs');
  assert.ok(actual.includes(`-- ===== ${generator.MIGRATION} =====`));
  assert.equal((actual.match(/^do \$haedo_install\$$/gm) || []).length, 1, 'one installing statement');
  assert.equal((actual.match(/^(begin|commit);$/gim) || []).length, 0, 'no transaction control that the editor could split');
  // The install creates; it never deletes rows, truncates or drops a table or schema.
  assert.doesNotMatch(actual, /\b(delete\s+from|truncate|drop\s+table|drop\s+schema)\b/i);
});
