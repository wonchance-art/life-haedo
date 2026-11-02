'use strict';
// S0 structure baseline (docs/design-review/structure-workflow-review-20261102.md, 4-5/4-6).
// Before the sync merge and the storage.js / ui.js splits move code, this pins what exists now:
//   A. the storage.js public API (key names and value types of createStorage()),
//   C. the output of the 20 sorted-JSON helpers listed in 2-3, and which of them agree exactly.
// (B, the HaedoLife.* names a page registers, needs a real page: tests/structure-baseline-browser.cjs.)
//
// The pins record current behaviour; they do not judge it. When a reviewed change alters one of
// these on purpose (a real-device fix that adds a storage method, an S1-S6 step), update the pin in
// that same PR so the diff shows it. `STRUCTURE_BASELINE_PRINT=1 node tests/structure-baseline.test.cjs`
// prints the current values in the pinned shape.
//
// S1 rule: S1 may share code only between helpers in the same group below. When a module's local
// helper is replaced by a shared one (HaedoLife.SyncCommon.*), point its SITES entry at the shared
// helper and keep it in its original group; the group's pinned outputs must not change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const PRINT = process.env.STRUCTURE_BASELINE_PRINT === '1';

// ---------------------------------------------------------------------------------------------
// A. storage.js public API
// ---------------------------------------------------------------------------------------------
function storageApi() {
  const { createStorage } = require('../assets/life/storage.js');
  // No IndexedDB is opened to build the API object; a throwing stub proves that.
  const storage = createStorage({ idb: { open() { throw new Error('structure baseline opened IndexedDB'); } }, channelFactory: null });
  return Object.keys(storage).sort().map(key => key + ':' + typeof storage[key]);
}

// ---------------------------------------------------------------------------------------------
// C. sorted-JSON helpers
// ---------------------------------------------------------------------------------------------
// [file, local name]. Line numbers are found by name, never pinned.
const SITES = [
  ['assets/data.js', 'canonical'],
  ['assets/life/core.js', 'canonical'],
  ['assets/life/interest-profile.js', 'canonical'],
  ['assets/life/naver-capture.js', 'canonical'],
  ['assets/life/material-continuity.js', 'canonical'],
  ['assets/life/material-continuity-sync.js', 'canonical'],
  ['assets/life/blog-sync.js', 'canonical'],
  ['assets/life/account-docs-sync.js', 'canonical'],
  ['assets/life/account-materials.js', 'canonical'],
  ['assets/life/original-attachments.js', 'canonical'],
  ['assets/life/preservation.js', 'canonical'],
  ['assets/life/preservation-references.js', 'canonical'],
  ['assets/life/unified-search.js', 'canonicalReference'],
  ['assets/life/public-cover-remote.js', 'canonical'],
  ['assets/life/nine-board.js', 'canonical'],
  ['assets/life/nine-public-remote.js', 'canonical'],
  ['assets/life/blog-series-package.js', 'canonical'],
  ['assets/life/source-edit.js', 'canonical'],
  ['assets/life/obsidian-decisions.js', 'canonical'],
  ['assets/life/storage.js', 'stablePayload']
];

// Inputs are source text evaluated inside the helper's own context: several helpers test
// Object.getPrototypeOf(value) === Object.prototype, which fails for objects from another realm.
// Synthetic values only.
const CORPUS = [
  ['key order a', '({ b: 1, a: 2 })'],
  ['key order b', '({ a: 2, b: 1 })'],
  ['nested', '({ z: [3, { y: 1, x: [2, 1] }], a: { c: null, b: "가" } })'],
  ['undefined and null', '({ a: undefined, b: null, c: [undefined, null] })'],
  ['non-finite numbers', '({ nan: NaN, inf: Infinity, neg: -Infinity, zero: -0 })'],
  ['date', '({ at: new Date(0) })'],
  ['hangul NFC', '({ "한글": "정원" })'],
  ['hangul NFD', '({ ["한글".normalize("NFD")]: "정원".normalize("NFD") })'],
  ['emoji and surrogates', '({ s: "🌱\\ud83d", "😀": 1 })'],
  ['empty object', '({})'],
  ['empty array', '([])'],
  ['numeric string keys', '({ "10": "a", "2": "b", "x": "c" })'],
  ['timeline derived keys', '({ lane: 1, kind: "x", t: 2, label: "keep" })'], // data.js drops these (2-4)
  ['primitive string', '"text"'],
  ['primitive number', '42'],
  ['null', 'null'],
  ['cycle', '(() => { const o = { a: 1 }; o.self = o; return o; })()']
];

// Returns the source of the declaration starting at `start` (a `function name(` or `const name =`).
function declaration(source, start) {
  const isFunction = source.startsWith('function', start);
  let depth = 0, quote = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i) - 1; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (isFunction && depth === 0 && c === '}') return source.slice(start, i + 1);
    } else if (!isFunction && depth === 0 && (c === ';' || c === ',')) return source.slice(start, i);
    else if (!isFunction && depth === 0 && c === '\n') {
      // A const arrow may continue on the next line with an operator (`? …`, `: …`, `.x`, `&& …`).
      const next = /\S/.exec(source.slice(i + 1)), before = source.slice(start, i).trimEnd();
      if (!next || !/[?:.&|+\-*/,=(]/.test(next[0]) && !/[=>?:,(&|+\-*/]$/.test(before)) return source.slice(start, i);
    }
  }
  throw new Error('unterminated declaration at ' + start);
}

function locate(source, name) {
  const match = new RegExp('(?:^|[\\s;{(,])(?:function\\s+' + name + '\\s*\\(|(?:const|let|var)\\s+' + name + '\\s*=)').exec(source);
  if (!match) return null;
  return match.index + match[0].search(/function|const|let|var/);
}

// Extracts `name` from `file` with the same-file private helpers it needs (resolved from
// ReferenceError names). A free variable that is not a same-file declaration is an error: that
// helper depends on module state and must be pinned through a public path instead.
function extract(file, name) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const at = locate(source, name);
  if (at === null) throw new Error(file + ': ' + name + ' not found; if S1 moved it, point SITES at the shared helper');
  const parts = [declaration(source, at)], helpers = [];
  for (let round = 0; round < 8; round++) {
    const context = vm.createContext({});
    try {
      vm.runInContext(parts.join(';\n') + ';\nthis.__subject = ' + name + ';', context);
      const subject = context.__subject;
      // Helpers called only inside the body surface as ReferenceError when the body runs.
      for (const [, input] of CORPUS) {
        context.__subject = subject;
        try { vm.runInContext('__subject(' + input + ')', context); } catch (error) { if (error.name === 'ReferenceError') throw error; }
      }
      return { line: source.slice(0, at).split('\n').length, helpers, run: input => run(context, subject, input) };
    } catch (error) {
      const missing = /^(\w+) is not defined/.exec(error.message);
      if (error.name !== 'ReferenceError' || !missing) throw error;
      const helperAt = locate(source, missing[1]);
      if (helperAt === null) throw new Error(file + ': ' + name + ' uses free variable ' + missing[1]);
      parts.unshift(declaration(source, helperAt)); helpers.push(missing[1]);
    }
  }
  throw new Error(file + ': too many helper declarations for ' + name);
}

function run(context, subject, input) {
  context.__subject = subject;
  try {
    const value = vm.runInContext('__subject(' + input + ')', context);
    return (typeof value) + ':' + (typeof value === 'string' ? value : JSON.stringify(value));
  } catch (error) {
    return 'throws:' + error.name;
  }
}

function currentOutputs() {
  const sites = {};
  for (const [file, name] of SITES) {
    const subject = extract(file, name);
    sites[file + '#' + name] = { outputs: CORPUS.map(([label, input]) => [label, subject.run(input)]) };
  }
  return sites;
}

// Groups sites whose outputs agree on every input; group IDs follow first appearance in SITES.
function groups(sites) {
  const byOutput = new Map();
  for (const [site, { outputs }] of Object.entries(sites)) {
    const key = JSON.stringify(outputs);
    if (!byOutput.has(key)) byOutput.set(key, { members: [], outputs });
    byOutput.get(key).members.push(site);
  }
  return [...byOutput.values()].map((group, index) => ({ id: 'G' + (index + 1), members: group.members, outputs: Object.fromEntries(group.outputs) }));
}

if (PRINT) {
  console.log(JSON.stringify({ storageApi: storageApi(), canonicalGroups: groups(currentOutputs()) }, null, 2));
} else {
  test('storage.js public API keys and value types are unchanged', () => {
    assert.deepEqual(storageApi(), STORAGE_API);
  });

  test('all 20 sorted-JSON helpers are found by name and evaluated without free variables', () => {
    for (const [file, name] of SITES) assert.doesNotThrow(() => extract(file, name), file + ' ' + name);
  });

  test('sorted-JSON helpers keep their exact outputs and their equal-output groups', () => {
    assert.deepEqual(groups(currentOutputs()), CANONICAL_GROUPS);
  });

  test('helpers the review found to differ (2-4) stay in different groups', () => {
    const groupOf = site => CANONICAL_GROUPS.find(group => group.members.includes(site)).id;
    const data = groupOf('assets/data.js#canonical'), docs = groupOf('assets/life/account-docs-sync.js#canonical'), storage = groupOf('assets/life/storage.js#stablePayload');
    assert.equal(new Set([data, docs, storage]).size, 3, 'data.js, account-docs-sync.js and storage.js must not share a group');
  });

  test('declaration splitter handles multi-line arrows and stops at the statement end', () => {
    const source = 'const a = value => value\n  ? 1\n  : 2;\nconst b = 3\nfunction c(x) { return { y: x }; }\n';
    assert.equal(declaration(source, locate(source, 'a')), 'const a = value => value\n  ? 1\n  : 2');
    assert.equal(declaration(source, locate(source, 'b')), 'const b = 3');
    assert.equal(declaration(source, locate(source, 'c')), 'function c(x) { return { y: x }; }');
  });
}

module.exports = { SITES, CORPUS, extract, groups, currentOutputs, storageApi };

// ---------------------------------------------------------------------------------------------
// Pinned values (main c108dbb). Regenerate with STRUCTURE_BASELINE_PRINT=1 only for a reviewed change.
// ---------------------------------------------------------------------------------------------
const STORAGE_API = [
  "account:object",
  "accountDocHash:function",
  "accountDocKinds:object",
  "ackCompositionSync:function",
  "ackLibraryMetaSync:function",
  "ackSync:function",
  "ackWritingSync:function",
  "acknowledgeNaverMediaReceipt:function",
  "adoptCompositionRemote:function",
  "adoptLibraryMetaRemote:function",
  "adoptMaterialContinuity:function",
  "adoptSyncRemote:function",
  "adoptUnownedWorkspaces:function",
  "applyAccountDoc:function",
  "applyCompositionRemote:function",
  "applyLibraryMetaRemote:function",
  "applySyncRemote:function",
  "applyWritingRemote:function",
  "attachNaverCaptureCopy:function",
  "bindCompositionSync:function",
  "bindLibraryMetaSync:function",
  "bindSync:function",
  "bindWritingSync:function",
  "clearAccount:function",
  "clearBlogTombstone:function",
  "clearReadingPosition:function",
  "close:function",
  "commitBlogSync:function",
  "commitLocal:function",
  "commitNaverCapture:function",
  "createMaterialWritingPost:function",
  "createWorkspace:function",
  "deletePhotoPost:function",
  "deleteStage:function",
  "dismissCompositionNotice:function",
  "dismissLibraryMetaNotice:function",
  "dismissWritingNotice:function",
  "dispose:function",
  "findMaterialContinuity:function",
  "finishMaterialContinuityClaim:function",
  "forAccount:function",
  "forgetMaterialContinuity:function",
  "getActive:function",
  "getCompositionState:function",
  "getLibraryMetaState:function",
  "getStage:function",
  "getSyncState:function",
  "getWritingSyncState:function",
  "importUnownedWorkspace:function",
  "installBlogSeriesCopy:function",
  "installLibraryCopy:function",
  "installMaterialContinuity:function",
  "installNaverCaptureCopy:function",
  "installNaverCaptureForVersion:function",
  "installPreservationCopy:function",
  "installReceivedBlogPost:function",
  "installSyncRemote:function",
  "installWorkbenchCopy:function",
  "installWorkspace:function",
  "installWorkspaces:function",
  "installWritingRemote:function",
  "isAccountScoped:boolean",
  "listAccountDocKeys:function",
  "listAccountDocRecoveries:function",
  "listAccountDocs:function",
  "listAccountLibraries:function",
  "listBlogCopies:function",
  "listBlogSyncStates:function",
  "listCompositionRecoveries:function",
  "listLibraryMetaRecoveries:function",
  "listMaterialContinuityOrphans:function",
  "listNaverCaptures:function",
  "listNaverMediaReceipts:function",
  "listPhotoPosts:function",
  "listStages:function",
  "listUnownedWorkspaces:function",
  "listWorkspaces:function",
  "listWritingSyncStates:function",
  "open:function",
  "pauseCompositionSync:function",
  "pauseLibraryMetaSync:function",
  "pauseSync:function",
  "pauseWritingSync:function",
  "prepareCompositionUpload:function",
  "prepareLibraryMetaUpload:function",
  "prepareSyncUpload:function",
  "prepareWritingUpload:function",
  "read:function",
  "readAccountDocCursor:function",
  "readAccountDocRecord:function",
  "readAccountMaterialRegistration:function",
  "readAnnualPlan:function",
  "readBlogSeries:function",
  "readBlogSeriesSnapshot:function",
  "readBlogSyncState:function",
  "readCollection:function",
  "readCompositionRecovery:function",
  "readDiscoveryActions:function",
  "readDiscoveryLanguageSettings:function",
  "readDiscoveryProfile:function",
  "readDiscoveryReading:function",
  "readDiscoverySettings:function",
  "readInterestProfile:function",
  "readLibraryBackupSnapshot:function",
  "readLibraryMetaEditedAt:function",
  "readLibraryMetaRecovery:function",
  "readLibraryMetaSnapshot:function",
  "readLocalPostCandidate:function",
  "readMaterialContinuitySnapshot:function",
  "readMaterialContinuityState:function",
  "readMaterialWriting:function",
  "readNaverCapture:function",
  "readNineBoard:function",
  "readPageDrafts:function",
  "readPhotoPost:function",
  "readPhotoPosts:function",
  "readPostEvidence:function",
  "readPreservationCatalog:function",
  "readPreservationSnapshot:function",
  "readPublicCover:function",
  "readReadingPosition:function",
  "readSourceFolders:function",
  "readSourceFoldersSnapshot:function",
  "readWorkbench:function",
  "readWorkbenchEditedAt:function",
  "readWorkbenchSnapshot:function",
  "readWritingSnapshot:function",
  "resolveCompositionSync:function",
  "resolveLibraryMetaSync:function",
  "resolveSync:function",
  "resolveWritingSync:function",
  "saveAccountDocRecovery:function",
  "saveAnnualPlan:function",
  "saveBlogSeries:function",
  "saveCollection:function",
  "saveDiscoveryActions:function",
  "saveDiscoveryLanguageSettings:function",
  "saveDiscoveryProfile:function",
  "saveDiscoveryReading:function",
  "saveDiscoverySettings:function",
  "saveInterestProfile:function",
  "saveMaterialWriting:function",
  "saveNineBoard:function",
  "saveNineBoardCopy:function",
  "savePageDrafts:function",
  "savePagePost:function",
  "savePhotoPost:function",
  "savePhotoPostFromNaverCapture:function",
  "savePhotoPostFromNineBoard:function",
  "savePhotoPostWithEvidence:function",
  "savePostEvidence:function",
  "savePublicCover:function",
  "saveReadingPosition:function",
  "saveSourceFolders:function",
  "saveStage:function",
  "saveWorkbench:function",
  "scanLocalPosts:function",
  "setActive:function",
  "setCompositionConflict:function",
  "setCompositionError:function",
  "setLibraryMetaConflict:function",
  "setLibraryMetaError:function",
  "setSyncConflict:function",
  "setSyncError:function",
  "setWritingConflict:function",
  "setWritingError:function",
  "stageNaverMediaReceipt:function",
  "subscribe:function",
  "subscribeAll:function",
  "upgradeAccountDocSchema:function",
  "writeAccountDocCursor:function",
  "writeAccountDocSync:function",
  "writeBlogSyncState:function",
  "writeMaterialContinuityState:function"
];

// Equal-output groups (S1 may share code only inside one group). Suspicious outputs are pinned as is:
// G2/G3 emit a literal `undefined` and `[,null]` (not JSON) for undefined values; a Date becomes {}
// in G1/G3/G5/G6/G8, an ISO string in G2/G4/G7, and is rejected by G9; G2/G3/G5 order key "10"
// before "2" while the others follow integer-key order. Object-returning helpers are shown through
// this test's JSON.stringify. See the S0 report before changing any of them.
const CANONICAL_GROUPS = [
  {
    "id": "G1",
    "members": [
      "assets/data.js#canonical"
    ],
    "outputs": {
      "key order a": "object:{\"a\":2,\"b\":1}",
      "key order b": "object:{\"a\":2,\"b\":1}",
      "nested": "object:{\"a\":{\"b\":\"가\",\"c\":null},\"z\":[3,{\"x\":[2,1],\"y\":1}]}",
      "undefined and null": "object:{\"b\":null,\"c\":[null,null]}",
      "non-finite numbers": "object:{\"inf\":null,\"nan\":null,\"neg\":null,\"zero\":0}",
      "date": "object:{\"at\":{}}",
      "hangul NFC": "object:{\"한글\":\"정원\"}",
      "hangul NFD": "object:{\"한글\":\"정원\"}",
      "emoji and surrogates": "object:{\"s\":\"🌱\\ud83d\",\"😀\":1}",
      "empty object": "object:{}",
      "empty array": "object:[]",
      "numeric string keys": "object:{\"2\":\"b\",\"10\":\"a\",\"x\":\"c\"}",
      "timeline derived keys": "object:{\"label\":\"keep\"}",
      "primitive string": "string:text",
      "primitive number": "number:42",
      "null": "object:null",
      "cycle": "throws:RangeError"
    }
  },
  {
    "id": "G2",
    "members": [
      "assets/life/core.js#canonical",
      "assets/life/interest-profile.js#canonical",
      "assets/life/source-edit.js#canonical"
    ],
    "outputs": {
      "key order a": "string:{\"a\":2,\"b\":1}",
      "key order b": "string:{\"a\":2,\"b\":1}",
      "nested": "string:{\"a\":{\"b\":\"가\",\"c\":null},\"z\":[3,{\"x\":[2,1],\"y\":1}]}",
      "undefined and null": "string:{\"a\":undefined,\"b\":null,\"c\":[,null]}",
      "non-finite numbers": "string:{\"inf\":null,\"nan\":null,\"neg\":null,\"zero\":0}",
      "date": "string:{\"at\":\"1970-01-01T00:00:00.000Z\"}",
      "hangul NFC": "string:{\"한글\":\"정원\"}",
      "hangul NFD": "string:{\"한글\":\"정원\"}",
      "emoji and surrogates": "string:{\"s\":\"🌱\\ud83d\",\"😀\":1}",
      "empty object": "string:{}",
      "empty array": "string:[]",
      "numeric string keys": "string:{\"10\":\"a\",\"2\":\"b\",\"x\":\"c\"}",
      "timeline derived keys": "string:{\"kind\":\"x\",\"label\":\"keep\",\"lane\":1,\"t\":2}",
      "primitive string": "string:\"text\"",
      "primitive number": "string:42",
      "null": "string:null",
      "cycle": "throws:RangeError"
    }
  },
  {
    "id": "G3",
    "members": [
      "assets/life/naver-capture.js#canonical",
      "assets/life/material-continuity-sync.js#canonical",
      "assets/life/blog-sync.js#canonical",
      "assets/life/obsidian-decisions.js#canonical"
    ],
    "outputs": {
      "key order a": "string:{\"a\":2,\"b\":1}",
      "key order b": "string:{\"a\":2,\"b\":1}",
      "nested": "string:{\"a\":{\"b\":\"가\",\"c\":null},\"z\":[3,{\"x\":[2,1],\"y\":1}]}",
      "undefined and null": "string:{\"a\":undefined,\"b\":null,\"c\":[,null]}",
      "non-finite numbers": "string:{\"inf\":null,\"nan\":null,\"neg\":null,\"zero\":0}",
      "date": "string:{\"at\":{}}",
      "hangul NFC": "string:{\"한글\":\"정원\"}",
      "hangul NFD": "string:{\"한글\":\"정원\"}",
      "emoji and surrogates": "string:{\"s\":\"🌱\\ud83d\",\"😀\":1}",
      "empty object": "string:{}",
      "empty array": "string:[]",
      "numeric string keys": "string:{\"10\":\"a\",\"2\":\"b\",\"x\":\"c\"}",
      "timeline derived keys": "string:{\"kind\":\"x\",\"label\":\"keep\",\"lane\":1,\"t\":2}",
      "primitive string": "string:\"text\"",
      "primitive number": "string:42",
      "null": "string:null",
      "cycle": "throws:RangeError"
    }
  },
  {
    "id": "G4",
    "members": [
      "assets/life/material-continuity.js#canonical",
      "assets/life/preservation-references.js#canonical",
      "assets/life/blog-series-package.js#canonical"
    ],
    "outputs": {
      "key order a": "object:{\"a\":2,\"b\":1}",
      "key order b": "object:{\"a\":2,\"b\":1}",
      "nested": "object:{\"a\":{\"b\":\"가\",\"c\":null},\"z\":[3,{\"x\":[2,1],\"y\":1}]}",
      "undefined and null": "object:{\"b\":null,\"c\":[null,null]}",
      "non-finite numbers": "object:{\"inf\":null,\"nan\":null,\"neg\":null,\"zero\":0}",
      "date": "object:{\"at\":\"1970-01-01T00:00:00.000Z\"}",
      "hangul NFC": "object:{\"한글\":\"정원\"}",
      "hangul NFD": "object:{\"한글\":\"정원\"}",
      "emoji and surrogates": "object:{\"s\":\"🌱\\ud83d\",\"😀\":1}",
      "empty object": "object:{}",
      "empty array": "object:[]",
      "numeric string keys": "object:{\"2\":\"b\",\"10\":\"a\",\"x\":\"c\"}",
      "timeline derived keys": "object:{\"kind\":\"x\",\"label\":\"keep\",\"lane\":1,\"t\":2}",
      "primitive string": "string:text",
      "primitive number": "number:42",
      "null": "object:null",
      "cycle": "throws:RangeError"
    }
  },
  {
    "id": "G5",
    "members": [
      "assets/life/account-docs-sync.js#canonical"
    ],
    "outputs": {
      "key order a": "string:{\"a\":2,\"b\":1}",
      "key order b": "string:{\"a\":2,\"b\":1}",
      "nested": "string:{\"a\":{\"b\":\"가\",\"c\":null},\"z\":[3,{\"x\":[2,1],\"y\":1}]}",
      "undefined and null": "string:{\"b\":null,\"c\":[null,null]}",
      "non-finite numbers": "string:{\"inf\":null,\"nan\":null,\"neg\":null,\"zero\":0}",
      "date": "string:{\"at\":{}}",
      "hangul NFC": "string:{\"한글\":\"정원\"}",
      "hangul NFD": "string:{\"한글\":\"정원\"}",
      "emoji and surrogates": "string:{\"s\":\"🌱\\ud83d\",\"😀\":1}",
      "empty object": "string:{}",
      "empty array": "string:[]",
      "numeric string keys": "string:{\"10\":\"a\",\"2\":\"b\",\"x\":\"c\"}",
      "timeline derived keys": "string:{\"kind\":\"x\",\"label\":\"keep\",\"lane\":1,\"t\":2}",
      "primitive string": "string:\"text\"",
      "primitive number": "string:42",
      "null": "string:null",
      "cycle": "throws:RangeError"
    }
  },
  {
    "id": "G6",
    "members": [
      "assets/life/account-materials.js#canonical"
    ],
    "outputs": {
      "key order a": "string:{\"a\":2,\"b\":1}",
      "key order b": "string:{\"a\":2,\"b\":1}",
      "nested": "string:{\"a\":{\"b\":\"가\",\"c\":null},\"z\":[3,{\"x\":[2,1],\"y\":1}]}",
      "undefined and null": "string:{\"b\":null,\"c\":[null,null]}",
      "non-finite numbers": "string:{\"inf\":null,\"nan\":null,\"neg\":null,\"zero\":0}",
      "date": "string:{\"at\":{}}",
      "hangul NFC": "string:{\"한글\":\"정원\"}",
      "hangul NFD": "string:{\"한글\":\"정원\"}",
      "emoji and surrogates": "string:{\"s\":\"🌱\\ud83d\",\"😀\":1}",
      "empty object": "string:{}",
      "empty array": "string:[]",
      "numeric string keys": "string:{\"2\":\"b\",\"10\":\"a\",\"x\":\"c\"}",
      "timeline derived keys": "string:{\"kind\":\"x\",\"label\":\"keep\",\"lane\":1,\"t\":2}",
      "primitive string": "string:\"text\"",
      "primitive number": "string:42",
      "null": "string:null",
      "cycle": "throws:RangeError"
    }
  },
  {
    "id": "G7",
    "members": [
      "assets/life/original-attachments.js#canonical"
    ],
    "outputs": {
      "key order a": "string:{\"a\":2,\"b\":1}",
      "key order b": "string:{\"a\":2,\"b\":1}",
      "nested": "string:{\"a\":{\"b\":\"가\",\"c\":null},\"z\":[3,{\"x\":[2,1],\"y\":1}]}",
      "undefined and null": "string:{\"b\":null,\"c\":[null,null]}",
      "non-finite numbers": "string:{\"inf\":null,\"nan\":null,\"neg\":null,\"zero\":0}",
      "date": "string:{\"at\":\"1970-01-01T00:00:00.000Z\"}",
      "hangul NFC": "string:{\"한글\":\"정원\"}",
      "hangul NFD": "string:{\"한글\":\"정원\"}",
      "emoji and surrogates": "string:{\"s\":\"🌱\\ud83d\",\"😀\":1}",
      "empty object": "string:{}",
      "empty array": "string:[]",
      "numeric string keys": "string:{\"2\":\"b\",\"10\":\"a\",\"x\":\"c\"}",
      "timeline derived keys": "string:{\"kind\":\"x\",\"label\":\"keep\",\"lane\":1,\"t\":2}",
      "primitive string": "string:\"text\"",
      "primitive number": "string:42",
      "null": "string:null",
      "cycle": "throws:RangeError"
    }
  },
  {
    "id": "G8",
    "members": [
      "assets/life/preservation.js#canonical",
      "assets/life/unified-search.js#canonicalReference",
      "assets/life/public-cover-remote.js#canonical",
      "assets/life/nine-board.js#canonical",
      "assets/life/nine-public-remote.js#canonical"
    ],
    "outputs": {
      "key order a": "object:{\"a\":2,\"b\":1}",
      "key order b": "object:{\"a\":2,\"b\":1}",
      "nested": "object:{\"a\":{\"b\":\"가\",\"c\":null},\"z\":[3,{\"x\":[2,1],\"y\":1}]}",
      "undefined and null": "object:{\"b\":null,\"c\":[null,null]}",
      "non-finite numbers": "object:{\"inf\":null,\"nan\":null,\"neg\":null,\"zero\":0}",
      "date": "object:{\"at\":{}}",
      "hangul NFC": "object:{\"한글\":\"정원\"}",
      "hangul NFD": "object:{\"한글\":\"정원\"}",
      "emoji and surrogates": "object:{\"s\":\"🌱\\ud83d\",\"😀\":1}",
      "empty object": "object:{}",
      "empty array": "object:[]",
      "numeric string keys": "object:{\"2\":\"b\",\"10\":\"a\",\"x\":\"c\"}",
      "timeline derived keys": "object:{\"kind\":\"x\",\"label\":\"keep\",\"lane\":1,\"t\":2}",
      "primitive string": "string:text",
      "primitive number": "number:42",
      "null": "object:null",
      "cycle": "throws:RangeError"
    }
  },
  {
    "id": "G9",
    "members": [
      "assets/life/storage.js#stablePayload"
    ],
    "outputs": {
      "key order a": "string:{\"a\":2,\"b\":1}",
      "key order b": "string:{\"a\":2,\"b\":1}",
      "nested": "string:{\"a\":{\"b\":\"가\",\"c\":null},\"z\":[3,{\"x\":[2,1],\"y\":1}]}",
      "undefined and null": "throws:Error",
      "non-finite numbers": "throws:Error",
      "date": "throws:Error",
      "hangul NFC": "string:{\"한글\":\"정원\"}",
      "hangul NFD": "string:{\"한글\":\"정원\"}",
      "emoji and surrogates": "string:{\"s\":\"🌱\\ud83d\",\"😀\":1}",
      "empty object": "string:{}",
      "empty array": "string:[]",
      "numeric string keys": "string:{\"2\":\"b\",\"10\":\"a\",\"x\":\"c\"}",
      "timeline derived keys": "string:{\"kind\":\"x\",\"label\":\"keep\",\"lane\":1,\"t\":2}",
      "primitive string": "string:\"text\"",
      "primitive number": "string:42",
      "null": "string:null",
      "cycle": "throws:Error"
    }
  }
];
