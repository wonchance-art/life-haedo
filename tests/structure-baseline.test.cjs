'use strict';
// S0 structure baseline (docs/design-review/structure-workflow-review-20261102.md, 4-5/4-6).
// Before the sync merge and the storage.js / ui.js splits move code, this pins what exists now:
//   A. the storage.js public API: key names and value types of createStorage() and of the
//      account-scoped storage that forAccount() returns,
//   C. the output of the 20 sorted-JSON helpers listed in 2-3, and which of them agree exactly.
// (B, the HaedoLife.* names a page registers, needs a real page: tests/structure-baseline-browser.cjs.)
//
// The pins record current behaviour; they do not judge it. When a reviewed change alters one of
// these on purpose (a real-device fix that adds a storage method, an S1-S6 step), update the pin in
// that same PR so the diff shows it. `STRUCTURE_BASELINE_PRINT=1 node tests/structure-baseline.test.cjs`
// prints the current values in the pinned shape, keeping each existing group's ID.
//
// S1 rule: S1 may share code only between helpers in the same group. Each SITES entry has a fixed
// label (the original file#name). When a module's local helper is replaced by a shared one
// (HaedoLife.SyncCommon.* in a new file), change only that entry's file and name to the shared
// helper and keep its label: every label must still produce its pinned group's outputs. Pointing a
// label at a helper with other outputs fails as "label X now produces group Y" (or a new output).
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
const shape = object => Object.keys(object).sort().map(key => key + ':' + typeof object[key]);
function storageApis() {
  const { createStorage } = require('../assets/life/storage.js');
  // No IndexedDB is opened to build either API object; a throwing stub proves that.
  const storage = createStorage({ idb: { open() { throw new Error('structure baseline opened IndexedDB'); } }, channelFactory: null });
  const scoped = storage.forAccount({ userId: '11111111-1111-4111-8111-111111111111', projectUrl: 'https://structure-baseline.invalid/' });
  return { storage: shape(storage), forAccount: shape(scoped) };
}

// ---------------------------------------------------------------------------------------------
// C. sorted-JSON helpers
// ---------------------------------------------------------------------------------------------
// [fixed label, file, local name]. The label never changes; file and name follow the code (S1 rule).
// Line numbers are found by name, never pinned.
const SITES = [
  ['assets/data.js#canonical', 'assets/data.js', 'canonical'],
  ['assets/life/core.js#canonical', 'assets/life/core.js', 'canonical'],
  ['assets/life/interest-profile.js#canonical', 'assets/life/interest-profile.js', 'canonical'],
  ['assets/life/naver-capture.js#canonical', 'assets/life/naver-capture.js', 'canonical'],
  ['assets/life/material-continuity.js#canonical', 'assets/life/material-continuity.js', 'canonical'],
  ['assets/life/material-continuity-sync.js#canonical', 'assets/life/sync-common.js', 'canonical'], // S1: now SyncCommon.canonical
  ['assets/life/blog-sync.js#canonical', 'assets/life/sync-common.js', 'canonical'], // S1: now SyncCommon.canonical
  ['assets/life/account-docs-sync.js#canonical', 'assets/life/account-docs-sync.js', 'canonical'],
  ['assets/life/account-materials.js#canonical', 'assets/life/account-materials.js', 'canonical'],
  ['assets/life/original-attachments.js#canonical', 'assets/life/original-attachments.js', 'canonical'],
  ['assets/life/preservation.js#canonical', 'assets/life/preservation.js', 'canonical'],
  ['assets/life/preservation-references.js#canonical', 'assets/life/preservation-references.js', 'canonical'],
  ['assets/life/unified-search.js#canonicalReference', 'assets/life/unified-search.js', 'canonicalReference'],
  ['assets/life/public-cover-remote.js#canonical', 'assets/life/public-cover-remote.js', 'canonical'],
  ['assets/life/nine-board.js#canonical', 'assets/life/nine-board.js', 'canonical'],
  ['assets/life/nine-public-remote.js#canonical', 'assets/life/nine-public-remote.js', 'canonical'],
  ['assets/life/blog-series-package.js#canonical', 'assets/life/blog-series-package.js', 'canonical'],
  ['assets/life/source-edit.js#canonical', 'assets/life/source-edit.js', 'canonical'],
  ['assets/life/obsidian-decisions.js#canonical', 'assets/life/obsidian-decisions.js', 'canonical'],
  ['assets/life/storage.js#stablePayload', 'assets/life/storage.js', 'stablePayload']
];
// The three helpers review 2-4 found to mean different things.
const DISTINCT_2_4 = ['assets/data.js#canonical', 'assets/life/account-docs-sync.js#canonical', 'assets/life/storage.js#stablePayload'];

// Inputs are source text evaluated inside the helper's own context: several helpers test
// Object.getPrototypeOf(value) === Object.prototype, which fails for objects from another realm.
// Synthetic values only.
const CORPUS = [
  ['key order a', '({ b: 1, a: 2 })'],
  ['key order b', '({ a: 2, b: 1 })'],
  ['nested', '({ z: [3, { y: 1, x: [2, 1] }], a: { c: null, b: "가" } })'],
  ['undefined and null', '({ a: undefined, b: null, c: [undefined, null] })'],
  ['non-finite numbers', '({ nan: NaN, inf: Infinity, neg: -Infinity, zero: -0 })'],
  ['booleans', '({ t: true, f: false })'],
  ['primitive boolean', 'true'],
  ['date', '({ at: new Date(0) })'],
  ['toJSON', '({ a: { toJSON() { return "j"; } } })'],
  ['class instance', '(() => { class Point { constructor() { this.y = 1; this.x = 2; } } return { p: new Point() }; })()'],
  ['null prototype', '({ o: Object.assign(Object.create(null), { b: 1, a: 2 }) })'],
  ['map', '({ m: new Map([["b", 1], ["a", 2]]) })'],
  ['sparse array', '({ s: [1, , 3] })'],
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
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      if (end < 0) break; // a line comment that ends the file
      i = end - 1; continue;
    }
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
// ReferenceError names). A free variable that is not a same-file declaration is an error.
function extract(file, name) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const at = locate(source, name);
  if (at === null) throw new Error(file + ': ' + name + ' not found. If it moved to a shared helper, change this SITES entry\'s file and name to that helper and keep its label (S1 rule).');
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
      return { helpers, run: input => run(context, subject, input) };
    } catch (error) {
      const missing = /^(\w+) is not defined/.exec(error.message);
      if (error.name !== 'ReferenceError' || !missing) throw error;
      const helperAt = locate(source, missing[1]);
      if (helperAt === null) throw new Error(file + ': ' + name + ' uses free variable ' + missing[1] + ' that is not declared in this file. If the helper now delegates to a shared module, change this SITES entry\'s file and name to the shared helper itself and keep its label (S1 rule).');
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

// label -> { input label: output }, computed from the code as it is now.
function currentOutputs() {
  const outputs = {};
  for (const [label, file, name] of SITES) {
    const subject = extract(file, name);
    outputs[label] = Object.fromEntries(CORPUS.map(([input, source]) => [input, subject.run(source)]));
  }
  return outputs;
}

// Groups labels whose outputs agree on every input. A group keeps the ID it already has in `pinned`
// (matched by its first pinned member); a group with no pinned counterpart gets the next free ID.
function groups(outputs, pinned = []) {
  const byOutput = new Map();
  for (const [label] of SITES) {
    const key = JSON.stringify(outputs[label]);
    if (!byOutput.has(key)) byOutput.set(key, { members: [], outputs: outputs[label] });
    byOutput.get(key).members.push(label);
  }
  let next = pinned.reduce((max, group) => Math.max(max, Number(group.id.slice(1))), 0);
  return [...byOutput.values()].map(group => {
    const previous = pinned.find(old => group.members.includes(old.representative || old.members[0]));
    return { id: previous ? previous.id : 'G' + (++next), representative: previous ? previous.representative || previous.members[0] : group.members[0], members: group.members, outputs: group.outputs };
  });
}

// For each label, which pinned group its current outputs match: the group ID, or 'new output'.
function placement(outputs) {
  return Object.fromEntries(SITES.map(([label]) => {
    const match = CANONICAL_GROUPS.find(group => JSON.stringify(group.outputs) === JSON.stringify(outputs[label]));
    return [label, match ? match.id : 'new output'];
  }));
}

if (!PRINT) {
  test('storage.js public API keys and value types are unchanged (createStorage and forAccount)', () => {
    const current = storageApis();
    assert.deepEqual(current.storage, STORAGE_API);
    assert.deepEqual(current.forAccount, FOR_ACCOUNT_API);
  });

  test('SITES labels are fixed and unique, and every pinned group member is a label', () => {
    const labels = SITES.map(([label]) => label);
    assert.equal(labels.length, 20);
    assert.equal(new Set(labels).size, 20, 'SITES labels must be unique');
    assert.deepEqual(CANONICAL_GROUPS.flatMap(group => group.members).sort(), [...labels].sort(), 'every label belongs to exactly one pinned group');
    for (const group of CANONICAL_GROUPS) assert.ok(group.members.includes(group.representative), group.id + ' representative is a member');
  });

  test('S1: blog-sync and material-continuity-sync use SyncCommon.canonical and keep no local copy', () => {
    for (const file of ['assets/life/blog-sync.js', 'assets/life/material-continuity-sync.js']) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      assert.match(source, /const canonical = syncCommon\(\)\.canonical;/, file + ' delegates to SyncCommon');
      assert.equal(locate(source.replace(/const canonical = syncCommon\(\)\.canonical;/, ''), 'canonical'), null, file + ' has no local canonical definition');
    }
  });

  test('all 20 sorted-JSON helpers are found by name and evaluated without free variables', () => {
    for (const [label, file, name] of SITES) assert.doesNotThrow(() => extract(file, name), label);
  });

  test('every helper still produces the outputs of its pinned group', () => {
    const now = placement(currentOutputs());
    const expected = Object.fromEntries(CANONICAL_GROUPS.flatMap(group => group.members.map(label => [label, group.id])));
    for (const [label] of SITES) assert.equal(now[label], expected[label], 'label ' + label + ' now produces ' + now[label] + ' instead of ' + expected[label]);
  });

  test('pinned groups have distinct outputs', () => {
    assert.equal(new Set(CANONICAL_GROUPS.map(group => JSON.stringify(group.outputs))).size, CANONICAL_GROUPS.length);
  });

  test('helpers the review found to differ (2-4) still produce different outputs', () => {
    const outputs = currentOutputs();
    assert.equal(new Set(DISTINCT_2_4.map(label => JSON.stringify(outputs[label]))).size, 3, DISTINCT_2_4.join(', ') + ' must not agree');
  });

  test('declaration splitter handles multi-line arrows, statement ends and a trailing line comment', () => {
    const source = 'const a = value => value\n  ? 1\n  : 2;\nconst b = 3\nfunction c(x) { return { y: x }; }\n';
    assert.equal(declaration(source, locate(source, 'a')), 'const a = value => value\n  ? 1\n  : 2');
    assert.equal(declaration(source, locate(source, 'b')), 'const b = 3');
    assert.equal(declaration(source, locate(source, 'c')), 'function c(x) { return { y: x }; }');
    assert.throws(() => declaration('function d() { return 1; // no newline at end', 0), /unterminated declaration/);
  });
}

module.exports = { SITES, CORPUS, extract, groups, currentOutputs, storageApis };

// ---------------------------------------------------------------------------------------------
// Pinned values (main c108dbb). Regenerate with STRUCTURE_BASELINE_PRINT=1 only for a reviewed change.
// ---------------------------------------------------------------------------------------------
const FOR_ACCOUNT_API = [
  "absorbTimelineDays:function",
  "account:object",
  "accountDocHash:function",
  "accountDocKinds:object",
  "ackCompositionSync:function",
  "ackLibraryMetaSync:function",
  "ackSync:function",
  "ackWritingSync:function",
  "acknowledgeNaverMediaReceipt:function",
  "addPlatformRecovery:function",
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
  "captureSyncBase:function", // originals merge (2026-11-11): the last agreed server snapshot
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
  "dismissSyncNotice:function", // originals merge
  "dismissWritingNotice:function",
  "dispose:function",
  "findMaterialContinuity:function",
  "finishMaterialContinuityClaim:function",
  "forgetMaterialContinuity:function",
  "getActive:function",
  "getCompositionState:function",
  "getCompositionSummary:function", // status read (2026-11-12)
  "getLibraryMetaState:function",
  "getLibraryMetaSummary:function", // status read (2026-11-12)
  "getStage:function",
  "getSyncNotice:function", // originals merge
  "getSyncState:function",
  "getSyncSummary:function", // status read without snapshots (2026-11-12)
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
  "mergeSyncRemote:function", // originals merge: both sides joined in one transaction
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
  "readHappinessDays:function",
  "readInterestProfile:function",
  "readLibraryBackupSnapshot:function",
  "readLibraryMetaEditedAt:function",
  "readLibraryMetaRecovery:function",
  "readLibraryMetaSnapshot:function",
  "readLocalPostCandidate:function",
  "readMaterialContinuityOutputDeletion:function",
  "readMaterialContinuitySnapshot:function",
  "readMaterialContinuityState:function",
  "readMaterialWriting:function",
  "readMaterialWritingOutput:function",
  "readNaverCapture:function",
  "readNineBoard:function",
  "readPageDrafts:function",
  "readPhotoPost:function",
  "readPhotoPosts:function",
  "readPlatformRecovery:function",
  "readPostEvidence:function",
  "readPreservationCatalog:function",
  "readPreservationSnapshot:function",
  "readPublicCover:function",
  "readReadingPosition:function",
  "readRssInboxProgress:function",
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
  "restorePhotoPost:function",
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
  "savePhotoPostOver:function",
  "savePhotoPostWithEvidence:function",
  "savePostEvidence:function",
  "savePostTransition:function",
  "savePublicCover:function",
  "saveReadingPosition:function",
  "saveRssInboxProgress:function",
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
  "writeHappinessDay:function",
  "writeMaterialContinuityState:function"
];

const STORAGE_API = [
  "absorbTimelineDays:function",
  "account:object",
  "accountDocHash:function",
  "accountDocKinds:object",
  "ackCompositionSync:function",
  "ackLibraryMetaSync:function",
  "ackSync:function",
  "ackWritingSync:function",
  "acknowledgeNaverMediaReceipt:function",
  "addPlatformRecovery:function",
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
  "captureSyncBase:function", // originals merge (2026-11-11): the last agreed server snapshot
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
  "dismissSyncNotice:function", // originals merge
  "dismissWritingNotice:function",
  "dispose:function",
  "findMaterialContinuity:function",
  "finishMaterialContinuityClaim:function",
  "forAccount:function",
  "forgetMaterialContinuity:function",
  "getActive:function",
  "getCompositionState:function",
  "getCompositionSummary:function", // status read (2026-11-12)
  "getLibraryMetaState:function",
  "getLibraryMetaSummary:function", // status read (2026-11-12)
  "getStage:function",
  "getSyncNotice:function", // originals merge
  "getSyncState:function",
  "getSyncSummary:function", // status read without snapshots (2026-11-12)
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
  "mergeSyncRemote:function", // originals merge: both sides joined in one transaction
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
  "readHappinessDays:function",
  "readInterestProfile:function",
  "readLibraryBackupSnapshot:function",
  "readLibraryMetaEditedAt:function",
  "readLibraryMetaRecovery:function",
  "readLibraryMetaSnapshot:function",
  "readLocalPostCandidate:function",
  "readMaterialContinuityOutputDeletion:function",
  "readMaterialContinuitySnapshot:function",
  "readMaterialContinuityState:function",
  "readMaterialWriting:function",
  "readMaterialWritingOutput:function",
  "readNaverCapture:function",
  "readNineBoard:function",
  "readPageDrafts:function",
  "readPhotoPost:function",
  "readPhotoPosts:function",
  "readPlatformRecovery:function",
  "readPostEvidence:function",
  "readPreservationCatalog:function",
  "readPreservationSnapshot:function",
  "readPublicCover:function",
  "readReadingPosition:function",
  "readRssInboxProgress:function",
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
  "restorePhotoPost:function",
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
  "savePhotoPostOver:function",
  "savePhotoPostWithEvidence:function",
  "savePostEvidence:function",
  "savePostTransition:function",
  "savePublicCover:function",
  "saveReadingPosition:function",
  "saveRssInboxProgress:function",
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
  "writeHappinessDay:function",
  "writeMaterialContinuityState:function"
];

// Equal-output groups. S1 may share code only inside one group; IDs stay with their representative.
// Suspicious outputs are pinned as is (S1 defect candidates, decided 2026-11-02): G2/G3/G5 build
// strings that are not JSON for undefined values and toJSON methods (`undefined`, `{"toJSON":undefined}`)
// and keep sparse-array holes (`[1,,3]`); a Date becomes {} in G1/G3/G5/G6/G8, an ISO string in
// G2/G4/G7, and is rejected by G9; G2/G3/G5 order key "10" before "2" while the others follow
// integer-key order. Object-returning helpers are shown through this test's JSON.stringify.
const CANONICAL_GROUPS = [
  {
    "id": "G1",
    "representative": "assets/data.js#canonical",
    "members": [
      "assets/data.js#canonical"
    ],
    "outputs": {
      "key order a": "object:{\"a\":2,\"b\":1}",
      "key order b": "object:{\"a\":2,\"b\":1}",
      "nested": "object:{\"a\":{\"b\":\"가\",\"c\":null},\"z\":[3,{\"x\":[2,1],\"y\":1}]}",
      "undefined and null": "object:{\"b\":null,\"c\":[null,null]}",
      "non-finite numbers": "object:{\"inf\":null,\"nan\":null,\"neg\":null,\"zero\":0}",
      "booleans": "object:{\"f\":false}",
      "primitive boolean": "boolean:true",
      "date": "object:{\"at\":{}}",
      "toJSON": "object:{\"a\":\"j\"}",
      "class instance": "object:{\"p\":{\"x\":2,\"y\":1}}",
      "null prototype": "object:{\"o\":{\"a\":2,\"b\":1}}",
      "map": "object:{\"m\":{}}",
      "sparse array": "object:{\"s\":[1,null,3]}",
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
    "representative": "assets/life/core.js#canonical",
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
      "booleans": "string:{\"f\":false,\"t\":true}",
      "primitive boolean": "string:true",
      "date": "string:{\"at\":\"1970-01-01T00:00:00.000Z\"}",
      "toJSON": "string:{\"a\":{\"toJSON\":undefined}}",
      "class instance": "string:{\"p\":{\"y\":1,\"x\":2}}",
      "null prototype": "string:{\"o\":{\"a\":2,\"b\":1}}",
      "map": "string:{\"m\":{}}",
      "sparse array": "string:{\"s\":[1,,3]}",
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
    "representative": "assets/life/naver-capture.js#canonical",
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
      "booleans": "string:{\"f\":false,\"t\":true}",
      "primitive boolean": "string:true",
      "date": "string:{\"at\":{}}",
      "toJSON": "string:{\"a\":{\"toJSON\":undefined}}",
      "class instance": "string:{\"p\":{\"x\":2,\"y\":1}}",
      "null prototype": "string:{\"o\":{\"a\":2,\"b\":1}}",
      "map": "string:{\"m\":{}}",
      "sparse array": "string:{\"s\":[1,,3]}",
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
    "representative": "assets/life/material-continuity.js#canonical",
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
      "booleans": "object:{\"f\":false,\"t\":true}",
      "primitive boolean": "boolean:true",
      "date": "object:{\"at\":\"1970-01-01T00:00:00.000Z\"}",
      "toJSON": "object:{\"a\":\"j\"}",
      "class instance": "object:{\"p\":{\"y\":1,\"x\":2}}",
      "null prototype": "object:{\"o\":{\"a\":2,\"b\":1}}",
      "map": "object:{\"m\":{}}",
      "sparse array": "object:{\"s\":[1,null,3]}",
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
    "representative": "assets/life/account-docs-sync.js#canonical",
    "members": [
      "assets/life/account-docs-sync.js#canonical"
    ],
    "outputs": {
      "key order a": "string:{\"a\":2,\"b\":1}",
      "key order b": "string:{\"a\":2,\"b\":1}",
      "nested": "string:{\"a\":{\"b\":\"가\",\"c\":null},\"z\":[3,{\"x\":[2,1],\"y\":1}]}",
      "undefined and null": "string:{\"b\":null,\"c\":[null,null]}",
      "non-finite numbers": "string:{\"inf\":null,\"nan\":null,\"neg\":null,\"zero\":0}",
      "booleans": "string:{\"f\":false,\"t\":true}",
      "primitive boolean": "string:true",
      "date": "string:{\"at\":{}}",
      "toJSON": "string:{\"a\":{\"toJSON\":undefined}}",
      "class instance": "string:{\"p\":{\"x\":2,\"y\":1}}",
      "null prototype": "string:{\"o\":{\"a\":2,\"b\":1}}",
      "map": "string:{\"m\":{}}",
      "sparse array": "string:{\"s\":[1,,3]}",
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
    "representative": "assets/life/account-materials.js#canonical",
    "members": [
      "assets/life/account-materials.js#canonical"
    ],
    "outputs": {
      "key order a": "string:{\"a\":2,\"b\":1}",
      "key order b": "string:{\"a\":2,\"b\":1}",
      "nested": "string:{\"a\":{\"b\":\"가\",\"c\":null},\"z\":[3,{\"x\":[2,1],\"y\":1}]}",
      "undefined and null": "string:{\"b\":null,\"c\":[null,null]}",
      "non-finite numbers": "string:{\"inf\":null,\"nan\":null,\"neg\":null,\"zero\":0}",
      "booleans": "string:{\"f\":false,\"t\":true}",
      "primitive boolean": "string:true",
      "date": "string:{\"at\":{}}",
      "toJSON": "string:{\"a\":\"j\"}",
      "class instance": "string:{\"p\":{\"x\":2,\"y\":1}}",
      "null prototype": "string:{\"o\":{\"a\":2,\"b\":1}}",
      "map": "string:{\"m\":{}}",
      "sparse array": "string:{\"s\":[1,null,3]}",
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
    "representative": "assets/life/original-attachments.js#canonical",
    "members": [
      "assets/life/original-attachments.js#canonical"
    ],
    "outputs": {
      "key order a": "string:{\"a\":2,\"b\":1}",
      "key order b": "string:{\"a\":2,\"b\":1}",
      "nested": "string:{\"a\":{\"b\":\"가\",\"c\":null},\"z\":[3,{\"x\":[2,1],\"y\":1}]}",
      "undefined and null": "string:{\"b\":null,\"c\":[null,null]}",
      "non-finite numbers": "string:{\"inf\":null,\"nan\":null,\"neg\":null,\"zero\":0}",
      "booleans": "string:{\"f\":false,\"t\":true}",
      "primitive boolean": "string:true",
      "date": "string:{\"at\":\"1970-01-01T00:00:00.000Z\"}",
      "toJSON": "string:{\"a\":\"j\"}",
      "class instance": "string:{\"p\":{\"x\":2,\"y\":1}}",
      "null prototype": "string:{\"o\":{\"a\":2,\"b\":1}}",
      "map": "string:{\"m\":{}}",
      "sparse array": "string:{\"s\":[1,null,3]}",
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
    "representative": "assets/life/preservation.js#canonical",
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
      "booleans": "object:{\"f\":false,\"t\":true}",
      "primitive boolean": "boolean:true",
      "date": "object:{\"at\":{}}",
      "toJSON": "object:{\"a\":\"j\"}",
      "class instance": "object:{\"p\":{\"x\":2,\"y\":1}}",
      "null prototype": "object:{\"o\":{\"a\":2,\"b\":1}}",
      "map": "object:{\"m\":{}}",
      "sparse array": "object:{\"s\":[1,null,3]}",
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
    "representative": "assets/life/storage.js#stablePayload",
    "members": [
      "assets/life/storage.js#stablePayload"
    ],
    "outputs": {
      "key order a": "string:{\"a\":2,\"b\":1}",
      "key order b": "string:{\"a\":2,\"b\":1}",
      "nested": "string:{\"a\":{\"b\":\"가\",\"c\":null},\"z\":[3,{\"x\":[2,1],\"y\":1}]}",
      "undefined and null": "throws:Error",
      "non-finite numbers": "throws:Error",
      "booleans": "string:{\"f\":false,\"t\":true}",
      "primitive boolean": "string:true",
      "date": "throws:Error",
      "toJSON": "throws:Error",
      "class instance": "throws:Error",
      "null prototype": "string:{\"o\":{\"a\":2,\"b\":1}}",
      "map": "throws:Error",
      "sparse array": "throws:Error",
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

// Print mode runs after the pins above exist, so existing group IDs are kept.
if (require.main === module && PRINT) {
  console.log(JSON.stringify({ storageApis: storageApis(), canonicalGroups: groups(currentOutputs(), CANONICAL_GROUPS) }, null, 2));
}
