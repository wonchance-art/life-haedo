'use strict';
// Application files of the version before the originals merge (commit a423773), read from
// tests/fixtures/source-merge/a423773/ (gzip of the unchanged bytes; see the README there).
// No Git history and no network: a shallow clone (CI) reads the same bytes. Every read checks
// the length and the SHA-256 below, so a changed fixture fails the check that uses it.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const COMMIT = 'a4237731833b4b2669ead4a99fc5135ec46f21a3';
const DIRECTORY = path.join(ROOT, 'tests/fixtures/source-merge/a423773');
// assets/life/<name> at that commit.
const FILES = Object.freeze({
  'account-library.js': { bytes: 23863, sha256: '11b0b3c7e2a7d177e38664d2f501dbd5e5c60782aa113e995d1b281044d65d1e' },
  'composition-sync.js': { bytes: 21831, sha256: '7eb62a98d237099037d1e90c7d90cd139d8df3a55052336ab843e41293e0698f' },
  'storage.js': { bytes: 468583, sha256: '6436add886ac555043a4f81fc0bfa31fe4ea5f763fcf2468e9d2709c3f76ace5' },
  'sync-common.js': { bytes: 1331, sha256: '5519260cefbecc9efbc2796c74e97c48ac9d37fd6c96c27cb505c49d002e754b' },
  'sync.js': { bytes: 32443, sha256: '840c256be98315b0a84a8a4dd091b50c6b6f9b2af45213a46e003f962a68bf08' },
  'sync-lifecycle.js': { bytes: 2121, sha256: 'f27e00439c2a877f5b8441a5215d05f0b78c7978fb54ec0e4767bd36a39165c2' },
  'ui.js': { bytes: 434285, sha256: '235222e5c20e139cd78997d78a91c221d781139aea0ce90f28d3245425e2da29' },
  'writing-sync.js': { bytes: 19264, sha256: '0fe00d2d2cb27d79208d3e61a98cd6329fec9c3de5817e5c9550a8539aeb2f43' },
});
function previousFile(name) {
  const expected = FILES[name];
  if (!expected) throw new Error('No fixture of assets/life/' + name + ' at commit ' + COMMIT.slice(0, 7) + '.');
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(DIRECTORY, name + '.gz')));
  if (raw.length !== expected.bytes || crypto.createHash('sha256').update(raw).digest('hex') !== expected.sha256) {
    throw new Error('tests/fixtures/source-merge/a423773/' + name + '.gz is not assets/life/' + name + ' of commit ' + COMMIT.slice(0, 7) + '.');
  }
  return raw.toString('utf8');
}
// For Node (createDevice({ tree })): a directory whose assets/life holds this repository's modules
// with the previous version's files written over them. The files above are the ones the merge
// work changed (and the lifecycle module the engine loads); the other modules were the same at
// that commit when this was written, and the device scenarios do not reach them.
function previousTree(directory) {
  const target = path.join(directory, 'assets/life');
  fs.cpSync(path.join(ROOT, 'assets/life'), target, { recursive: true });
  for (const name of Object.keys(FILES)) fs.writeFileSync(path.join(target, name), previousFile(name));
  return directory;
}
module.exports = { COMMIT, FILES, previousFile, previousTree };
