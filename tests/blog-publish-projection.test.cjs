'use strict';
const test = require('node:test');
test('Edge Markdown projection uses the maintained browser codec and validators', async t => {
  const { cases } = await import('./blog-publish-projection-cases.mjs');
  for (const [name, run] of cases) await t.test(name, run);
});
