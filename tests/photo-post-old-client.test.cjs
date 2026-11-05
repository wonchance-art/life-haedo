'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto'), Module = require('node:module');
const Photo = require('../assets/life/photo-post.js'), Markdown = require('../assets/life/post-markdown.js');
const { createStorage } = require('../assets/life/storage.js');
const { memoryIdb, owner, Core } = require('./helpers/blog-sync-cloud.cjs');
const fixtureRoot = path.join(__dirname, 'fixtures/post-markdown-old-client');
const provenance = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'provenance.json'), 'utf8'));
assert.equal(provenance.commit, '2eebd27cbde54f697c9de3a09382f2e21b39a743');

function loadOriginal(name) {
  const entry = provenance.files.find(value => value.source.endsWith('/' + name));
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(fixtureRoot, entry.fixture)));
  assert.equal(raw.byteLength, entry.bytes);
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), entry.sha256);
  // Compile exact old bytes at their original path. Dependencies are unchanged
  // shared helpers; only these two old modules determine the version boundary.
  const filename = path.resolve(__dirname, '..', entry.source);
  const mod = new Module(filename, module); mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(raw.toString('utf8'), filename);
  return mod.exports;
}

async function setup(t) {
  const currentGlobals = { ...globalThis.HaedoLife };
  const oldPhoto = loadOriginal('photo-post.js'), oldStorage = loadOriginal('storage.js');
  Object.assign(globalThis.HaedoLife, currentGlobals);
  t.after(() => Object.assign(globalThis.HaedoLife, currentGlobals));
  const memory = memoryIdb(), options = { idb: memory.idb, core: Core, channelFactory: null, account: owner };
  const current = createStorage(options), old = oldStorage.createStorage(options);
  t.after(() => { current.close(); old.close(); });
  const ws = (await current.createWorkspace('구형 앱 합성 검수')).workspaceId;
  const doc = Photo.create(Core.id, '2026-11-05T00:00:00.000Z');
  doc.title = '정본 글'; doc.status = 'saved'; doc.ops = [{ insert: '정확하게 남길 문장\n' }];
  return { memory, current, old, oldPhoto, ws, doc, useOld() { globalThis.HaedoLife.PhotoPost = oldPhoto; } };
}

test('pinned old app refuses Markdown direct read and write without changing any stored row', async t => {
  const f = await setup(t), markdown = Markdown.fromV2(f.doc).document;
  const saved = await f.current.savePhotoPost(f.ws, markdown, 0), before = structuredClone(f.memory.rows);
  f.useOld();
  assert.doesNotThrow(() => f.oldPhoto.validate(f.doc), 'the pinned validator really accepts its own v2 format');
  assert.throws(() => f.oldPhoto.validate(markdown), { code: 'invalid_photo_post' });
  await assert.rejects(f.old.readPhotoPost(f.ws, saved.id), { code: 'invalid_photo_post' });
  await assert.rejects(f.old.savePhotoPost(f.ws, { ...f.doc, revision: saved.revision }, saved.revision), { code: 'invalid_photo_post' });
  await assert.rejects(f.old.savePhotoPost(f.ws, saved, saved.revision), { code: 'invalid_photo_post' });
  assert.deepEqual(f.memory.rows, before);
});

test('pinned old app exposes the historical replacement risk: an existing v2 draft can delete an md target', async t => {
  const f = await setup(t);
  const saved = await f.current.savePhotoPost(f.ws, Markdown.fromV2(f.doc).document, 0);
  const draft = await f.current.savePhotoPost(f.ws, { ...f.doc, id: Core.id(), revision: 0, status: 'draft',
    replaces: { id: saved.id, revision: saved.revision }, title: '예전 탭의 수정' }, 0);
  f.useOld();
  const result = await f.old.savePhotoPost(f.ws, { ...draft, status: 'saved' }, draft.revision);
  assert.equal(result.format, 'life-photo-post-v2');
  assert.equal(result.id, draft.id);
  assert.equal(f.memory.rows.get('meta').has(JSON.stringify(`photo-post:${f.ws}:${saved.id}`)), false,
    'KNOWN OLD-APP LIMITATION: its replacement path deletes the unreadable Markdown target');
  assert.equal((await f.old.listPhotoPosts(f.ws)).length, 1);
});

test('pinned old app refuses an md-format editing draft before its replacement target can be changed', async t => {
  const f = await setup(t);
  const saved = await f.current.savePhotoPost(f.ws, Markdown.fromV2(f.doc).document, 0);
  const draft = await f.current.savePhotoPost(f.ws, { ...saved, id: Core.id(), revision: 0, status: 'draft',
    replaces: { id: saved.id, revision: saved.revision }, title: '새 편집기의 수정' }, 0);
  const before = structuredClone(f.memory.rows);
  f.useOld();
  await assert.rejects(f.old.readPhotoPost(f.ws, draft.id), { code: 'invalid_photo_post' });
  await assert.rejects(f.old.savePhotoPost(f.ws, { ...draft, status: 'saved' }, draft.revision), { code: 'invalid_photo_post' });
  assert.deepEqual(f.memory.rows, before, 'B2 must use md-format editing drafts; old v2 drafts are a separate remaining risk');
});
