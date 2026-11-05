'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(require.resolve('../assets/life/settings-ui.js'), 'utf8'), context);
const { formatWorkspaceCount } = context.HaedoLife.SettingsUI;

test('account and browser workspace count labels preserve the existing user-facing wording', () => {
  const bundle = { sources: [{ id: 'a' }, { id: 'b' }], records: [{ id: 'quote' }] };
  assert.equal(formatWorkspaceCount(bundle), '자료 2개 · 발췌 1개');
  assert.equal(formatWorkspaceCount(bundle, { local: true }), '이 브라우저 · 자료 2개 · 발췌 1개');
  assert.equal(formatWorkspaceCount({ sources: [], records: [] }), '자료 0개 · 발췌 0개');
});
