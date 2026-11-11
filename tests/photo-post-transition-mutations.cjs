'use strict';
// Run product mutants in an isolated child loader; never rewrite shared files.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'post-transition-mutants-'));
const mutants = [
  { name: 'split-transaction', pattern: 'failure at recovery rolls back', edits: [
    ["const post = await writePhotoPost(tx, workspaceId, value, baseRevision, null, null, effects);", "await tx.done; const post = await transaction(['bundles', 'meta'], 'readwrite', part => writePhotoPost(part, workspaceId, value, baseRevision, null, null, effects));"],
    ["const kept = await writePhotoPost(tx, workspaceId, recovery, 0,\n          originalEvidence ? { refs, baseRevision: 0 } : null, null, effects, refs, null, true);", "const kept = await transaction(['bundles', 'meta'], 'readwrite', part => writePhotoPost(part, workspaceId, recovery, 0, originalEvidence ? { refs, baseRevision: 0 } : null, null, effects, refs, null, true));"],
    ["await meta.put({ key: receiptKey, value: { payload, recoveryId, originalTitle: source.title, postRevision: post.revision, recoveryRevision: kept.revision } });", "await transaction(['meta'], 'readwrite', part => part.objectStore('meta').put({ key: receiptKey, value: { payload, recoveryId, originalTitle: source.title, postRevision: post.revision, recoveryRevision: kept.revision } }));"]
  ] },
  { name: 'drop-recovery-evidence', pattern: '^explicit replacement preserves', edits: [
    ["originalEvidence ? { refs, baseRevision: 0 } : null, null, effects, refs, null, true);", "null, null, effects, refs, null, true);"]
  ] }
];
try {
  for (const mutant of mutants) {
    const loader = path.join(temp, mutant.name + '.cjs');
    fs.writeFileSync(loader, `const fs = require('node:fs'), Module = require('node:module');\nconst prior = Module._extensions['.js'];\nModule._extensions['.js'] = function(mod, filename) {\n if (filename !== ${JSON.stringify(path.join(root, 'assets/life/storage.js'))}) return prior(mod, filename);\n let source = fs.readFileSync(filename, 'utf8');\n for (const [before, after] of ${JSON.stringify(mutant.edits)}) { if (source.split(before).length !== 2) throw new Error('mutation target changed'); source = source.replace(before, after); }\n mod._compile(source, filename);\n};\n`);
    const result = spawnSync(process.execPath, ['--require', loader, '--test', '--test-name-pattern', mutant.pattern, 'tests/photo-post-transition.test.cjs'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.error, undefined, mutant.name + ' must finish, not time out');
    assert.notEqual(result.status, 0, mutant.name + ' was not detected');
    assert.match(result.stdout + result.stderr, /AssertionError|ERR_ASSERTION/, mutant.name + ' must fail a preservation assertion');
    process.stdout.write(mutant.name + ': detected by preservation assertion\n');
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
