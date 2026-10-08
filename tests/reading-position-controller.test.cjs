/* Controller sequencing only: trusted-input callbacks and storage are controlled.
 * This is not browser gesture, IndexedDB, Apple-device or operating-data proof. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../assets/life/reading-position.js'), 'utf8');
function events(target = {}) {
  const listeners = new Map();
  return Object.assign(target, {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, event = {}) { for (const listener of listeners.get(type) || []) listener({ type, ...event }); }
  });
}
async function fixture({ delaySave = false } = {}) {
  let selected = 100;
  const document = events({ visibilityState: 'visible' });
  const text = { nodeType: 3, data: '가'.repeat(400) };
  const reader = events({ ownerDocument: document, isConnected: true, firstChild: text });
  const writes = [];
  const subscribers = new Set();
  let releaseSave = null;
  let saved = { revision: 1, status: 'available', position: { sourceId: 'source', sourceVersionId: 'version', offset: 100 } };
  const storage = {
    async readReadingPosition() { return structuredClone(saved); },
    async saveReadingPosition(workspaceId, position, revision) {
      writes.push({ workspaceId, position: structuredClone(position), revision });
      if (delaySave) { delaySave = false; await new Promise(resolve => { releaseSave = resolve; }); }
      if (revision !== saved.revision) return { status: 'conflict', state: structuredClone(saved) };
      saved = { revision: revision + 1, status: 'available', position: structuredClone(position) };
      for (const listener of subscribers) listener({ type: 'reading_position_changed', workspaceId, revision: saved.revision });
      return { status: 'stored', state: structuredClone(saved) };
    },
    subscribe(_, listener) { subscribers.add(listener); return () => subscribers.delete(listener); }
  };
  const root = events({ setTimeout, clearTimeout, performance, scrollY: 0,
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
    getSelection: () => ({ rangeCount: 1, getRangeAt: () => ({ startContainer: text, endContainer: text,
      startOffset: selected, endOffset: selected + 1, collapsed: false }) }) });
  vm.runInNewContext(source, root);
  const controller = root.HaedoLife.ReadingPosition.create({ storage, debounceMs: 10000 });
  const watch = controller.watchReader({ workspaceId: 'workspace', sourceId: 'source', sourceVersionId: 'version', reader, isReading: () => true });
  await Promise.resolve(); await Promise.resolve();
  return { writes, controller, watch, release() { releaseSave(); },
    snapshot() { return structuredClone(saved); },
    externalClear() {
      saved = { revision: saved.revision + 1, status: 'empty', position: null };
      for (const listener of subscribers) listener({ type: 'reading_position_changed', workspaceId: 'workspace', revision: saved.revision });
    },
    choose(offset) { selected = offset; reader.emit('pointerup', { isTrusted: true }); } };
}
test('returning to the persisted point cancels an older debounced reading candidate', async () => {
  const f = await fixture();
  try {
    f.choose(200);
    f.choose(100);
    await f.watch.flush();
    assert.deepEqual(f.writes, [], 'the abandoned offset 200 must not replace the latest reading point 100');
  } finally { f.controller.dispose(); }
});
for (const target of [100, 300]) test('a later reading point ' + target + ' survives this reader own delayed save notification', async () => {
  const f = await fixture({ delaySave: true });
  try {
    f.choose(200);
    const saving = f.watch.flush();
    f.choose(target);
    f.release();
    await saving;
    await f.watch.flush();
    assert.equal(f.snapshot().position.offset, target, 'own completion must not erase a newer user reading action');
  } finally { f.controller.dispose(); }
});
test('another tab clear cancels a captured point without recreating it', async () => {
  const f = await fixture();
  try {
    f.choose(200);
    f.externalClear();
    await f.watch.flush();
    assert.equal(f.snapshot().position, null);
    assert.deepEqual(f.writes, []);
  } finally { f.controller.dispose(); }
});
test('a conflicted delayed save cannot rebase a later queued point across another tab clear', async () => {
  const f = await fixture({ delaySave: true });
  try {
    f.choose(200);
    const saving = f.watch.flush();
    f.choose(300);
    f.externalClear();
    f.release();
    await saving;
    await f.watch.flush();
    assert.equal(f.snapshot().position, null);
    assert.equal(f.writes.length, 1, 'a conflict must not retry or rebase either old candidate');
  } finally { f.controller.dispose(); }
});

test('leaving drains already captured reading input without sampling detached DOM', async () => {
  const f = await fixture({ delaySave: true });
  try {
    f.choose(200);
    const saving = f.watch.flush();
    f.choose(300);
    f.watch.close();
    f.choose(100);
    f.release();
    await saving;
    assert.equal(f.snapshot().position.offset, 300);
    assert.equal(f.writes.length, 2);
  } finally { f.controller.dispose(); }
});
