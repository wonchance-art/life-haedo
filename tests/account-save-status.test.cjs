'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(require.resolve('../assets/life/workbench-ui.js'), 'utf8'), context);
const presentation = context.HaedoLife.WorkbenchUI.savedPresentation;
const account = { userId: 'account-a', projectUrl: 'https://example.test' };
const options = { account, workspaceId: 'space-a' };
const ack = { workspaceId: 'space-a', binding: { ...account, remoteId: 'space-a' }, enabled: true, status: 'synced', remoteRevision: 3, syncedLocalRevision: 7, outbox: null, conflict: null, error: null };
test('saved account status requires an exact durable acknowledgement for this account, workspace and revision', () => {
  assert.equal(presentation(ack, 7, options).label, '저장됨 · 계정에 올림');
  for (const revision of [6, 8, null, undefined]) assert.equal(presentation(ack, revision, options).key, 'pending');
  for (const patch of [{ enabled: false }, { status: 'pending' }, { outbox: { operationId: 'pending' } }, { remoteRevision: 0 }, { binding: null }]) {
    assert.equal(presentation({ ...ack, ...patch }, 7, options).key, 'pending');
  }
  assert.equal(presentation(null, 7, options).label, '저장됨 · 계정에 올리기 대기');
  assert.equal(presentation(ack, 7, {}).label, '저장됨');
});
// 2026-11-16 owner: what went well, or will run in a moment, is not shown (the label stays for screen readers).
test('a settled or about-to-run save is quiet; a stopped sync and a failure are shown', () => {
  assert.equal(presentation(ack, 7, options).quiet, true, '저장됨 · 계정에 올림');
  assert.equal(presentation(ack, 7, {}).quiet, true, '저장됨 (no account)');
  for (const patch of [{ status: 'pending' }, { outbox: { operationId: 'pending' } }, { remoteRevision: 0 }, { binding: null }]) {
    assert.equal(presentation({ ...ack, ...patch }, 7, options).quiet, true, JSON.stringify(patch));
  }
  assert.equal(presentation(ack, 8, options).quiet, true, 'a newer revision about to be uploaded');
  assert.equal(presentation(null, 7, options).quiet, true, 'a state not read yet does not flash');
  // not_enabled is the ordinary state of a composition never synced yet (a fresh account keeps it).
  assert.equal(presentation({ workspaceId: 'space-a', enabled: false, status: 'not_enabled', conflict: null, error: null }, 7, options).quiet, true, 'never synced yet');
  // An explicit pause does not end by itself: its wait is shown.
  const paused = presentation({ ...ack, enabled: false, status: 'paused' }, 7, options);
  assert.deepEqual([paused.key, paused.label, paused.quiet], ['pending', '저장됨 · 계정에 올리기 대기', false]);
  assert.equal(presentation({ ...ack, error: { code: 'network_error' } }, 7, options).quiet, false);
  assert.equal(presentation(ack, 7, { ...options, error: new Error('read failed') }).quiet, false);
});
test('upload failures and mismatched scope never masquerade as account storage', () => {
  for (const patch of [{ error: { code: 'network_error' } }, { conflict: {} }, { status: 'error' }, { workspaceId: 'space-b' }, { binding: { ...ack.binding, userId: 'account-b' } }, { binding: { ...ack.binding, remoteId: 'space-b' } }]) {
    assert.equal(presentation({ ...ack, ...patch }, 7, options).label, '저장됨 · 계정에 올리지 못함 · 다시 시도');
  }
  assert.equal(presentation(ack, 7, { ...options, error: new Error('read failed') }).key, 'error');
});
