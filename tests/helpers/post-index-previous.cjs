'use strict';
// The post-list files of the last app version before per-post list rows (haedo-v220, main c76e693),
// read from tests/fixtures/post-index/c76e693/ (gzip of the unchanged bytes; see the README there).
// No Git history and no network: a shallow clone (CI) reads the same bytes. Every read checks the
// length and the SHA-256 below, so a changed fixture fails the check that uses it.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto'), Module = require('node:module');
const ROOT = path.resolve(__dirname, '../..');
const COMMIT = 'c76e693af8208ab7ca5576d05c66a5ffbef600ed';
const DIRECTORY = path.join(ROOT, 'tests/fixtures/post-index/c76e693');
// assets/life/<name> at that commit (the files the post-list work changes; the others are the same).
const FILES = Object.freeze({
  'storage.js': { bytes: 511856, sha256: '78ff0bd9769b1b1c100a20be1171707764e70ae9fc9468245cd7e30a0aafa6b9' },
  'home.js': { bytes: 59766, sha256: 'be262673ac5d3112bec63c1f8e3c35203e3441c225e90e6497285e032faff494' },
  'schedule-ui.js': { bytes: 52417, sha256: 'a99355cccbafdc63427d8b46d9cec4b67485093fa8fb5b0f79766f50af807e1a' },
});
function previousFile(name) {
  const expected = FILES[name];
  if (!expected) throw new Error('No fixture of assets/life/' + name + ' at commit ' + COMMIT.slice(0, 7) + '.');
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(DIRECTORY, name + '.gz')));
  if (raw.length !== expected.bytes || crypto.createHash('sha256').update(raw).digest('hex') !== expected.sha256)
    throw new Error('tests/fixtures/post-index/c76e693/' + name + '.gz is not assets/life/' + name + ' of commit ' + COMMIT.slice(0, 7) + '.');
  return raw.toString('utf8');
}
// That version's Storage module for Node, compiled as if it were assets/life/storage.js (its
// require('./photo-post.js') and the like load this repository's modules, the same at that commit).
// Loading it sets globalThis.HaedoLife.Storage as the module does; the earlier value is put back.
function previousStorage() {
  const filename = path.join(ROOT, 'assets/life/storage.js'), life = globalThis.HaedoLife, before = life?.Storage;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(previousFile('storage.js'), filename);
  if (life) life.Storage = before;
  return mod.exports;
}
module.exports = { COMMIT, FILES, previousFile, previousStorage };
