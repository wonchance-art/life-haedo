'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const repo = path.resolve(__dirname, '..'), cli = path.join(repo, 'scripts/import-obsidian-vault.mjs');
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(action) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'haedo-import-snapshot-')), vault = path.join(root, 'vault');
  await fs.mkdir(vault);
  const git = (...args) => execFileSync(realGit, ['-C', vault, ...args], { encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  const commit = () => { git('add', '.'); git('-c', 'user.name=Anonymous', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'anonymous snapshot'); return git('rev-parse', 'HEAD').trim(); };
  const run = (output, options = {}) => spawnSync(process.execPath, [...(options.import ? ['--import', options.import] : []), cli, '--vault', vault, '--output', output, '--repository', 'https://github.com/example/anonymous'], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...options.env } });
  const wrapper = async source => {
    const bin = path.join(root, 'bin'); await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(path.join(bin, 'git'), '#!/bin/sh\n' + source + '\n', { mode: 0o700 });
    return { ...process.env, PATH: bin + path.delimiter + process.env.PATH, OBSIDIAN_TEST_GIT_REAL: realGit };
  };
  git('init', '-q');
  try { await action({ root, vault, git, commit, run, wrapper }); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}
test('CLI exports only committed snapshot bytes, ignoring ignored private working files', async () => fixture(async ({ root, vault, commit, run }) => {
  const bytes = Buffer.from('\ufeff# 원문\r\n원래 공백  🌱\r\n');
  await fs.writeFile(path.join(vault, '노트.md'), bytes);
  await fs.writeFile(path.join(vault, '.gitignore'), 'ignored-*\n');
  const ref = commit(); await fs.writeFile(path.join(vault, 'ignored-secret.md'), 'must never be included');
  await fs.symlink('/missing/anonymous-target', path.join(vault, 'ignored-symlink'));
  const output = path.join(root, 'package'), result = run(output);
  assert.equal(result.status, 0, result.stderr); const summary = JSON.parse(result.stdout);
  assert.equal(summary.files, 2); assert.equal(summary.notes, 1); assert.equal(summary.supportingFiles, 1);
  const audit = JSON.parse(await fs.readFile(path.join(output, 'private-audit.json')));
  assert.equal(audit.ref, ref); assert.equal(audit.files.length, 2);
  assert.equal(audit.files.find(row => row.path === '노트.md').sha256, hash(bytes));
  assert(!JSON.stringify(audit).includes('ignored-secret'));
  const notes = JSON.parse(await fs.readFile(path.join(output, 'notes.json')));
  assert.deepEqual(Buffer.from(notes.workspace.sourceVersions[0].contentText), bytes);
  assert.match(notes.workspace.sources[0].url, new RegExp('/blob/' + ref + '/'));
  for (const name of await fs.readdir(output)) assert.equal((await fs.stat(path.join(output, name))).mode & 0o777, 0o600, name);
  assert.equal((await fs.stat(output)).mode & 0o777, 0o700);
  assert(!result.stdout.includes('원문')); assert(!result.stdout.includes('ignored-secret'));
}));
test('checkout changes after clean check cannot change bytes attributed to the pinned commit', async () => fixture(async ({ root, vault, git, commit, run, wrapper }) => {
  await fs.writeFile(path.join(vault, 'note.md'), '# 고정 원문\n'); const first = commit();
  const originalBranch = git('symbolic-ref', '--short', 'HEAD').trim(); git('checkout', '--orphan', 'different-history');
  await fs.writeFile(path.join(vault, 'note.md'), '# 나중 checkout 원문\n'); const second = commit();
  git('branch', '-D', originalBranch);
  git('checkout', '--detach', first);
  const env = await wrapper('if [ "$3" = "status" ]; then\n  "$OBSIDIAN_TEST_GIT_REAL" "$@" || exit $?\n  "$OBSIDIAN_TEST_GIT_REAL" -C "$2" checkout --detach "$OBSIDIAN_TEST_NEXT_REF" >/dev/null 2>&1\n  exit $?\nfi\nexec "$OBSIDIAN_TEST_GIT_REAL" "$@"');
  const output = path.join(root, 'package'), result = run(output, { env: { ...env, OBSIDIAN_TEST_NEXT_REF: second } });
  assert.equal(result.status, 0, result.stderr);
  const notes = JSON.parse(await fs.readFile(path.join(output, 'notes.json'))), audit = JSON.parse(await fs.readFile(path.join(output, 'private-audit.json')));
  assert.equal(audit.ref, first); assert.equal(notes.workspace.sourceVersions[0].contentText, '# 고정 원문\n');
  assert.equal(git('rev-parse', 'HEAD').trim(), second, 'CLI must not reset source checkout');
  git('bundle', 'verify', path.join(output, 'repository.bundle'));
  const restored = path.join(root, 'restored.git'); execFileSync(realGit, ['clone', '--bare', path.join(output, 'repository.bundle'), restored], { stdio: 'pipe' });
  assert.equal(execFileSync(realGit, ['--git-dir=' + restored, 'show', first + ':note.md'], { encoding: 'utf8' }), '# 고정 원문\n');
  assert.equal(execFileSync(realGit, ['--git-dir=' + restored, 'show', second + ':note.md'], { encoding: 'utf8' }), '# 나중 checkout 원문\n');
}));
test('bundle failure leaves no partially exported output or earlier-output changes', async () => fixture(async ({ root, vault, commit, run, wrapper }) => {
  await fs.writeFile(path.join(vault, 'note.md'), '# 익명\n'); commit();
  const env = await wrapper('if [ "$3" = "bundle" ] && [ "$4" = "create" ]; then exit 72; fi\nexec "$OBSIDIAN_TEST_GIT_REAL" "$@"');
  const output = path.join(root, 'failed'), result = run(output, { env });
  assert.notEqual(result.status, 0); await assert.rejects(fs.lstat(output), { code: 'ENOENT' });
  assert.equal(result.stdout, ''); assert(!result.stderr.includes('# 익명'));
}));
test('filesystem write failure removes only the newly owned partial package and preserves prior exports', async () => fixture(async ({ root, vault, commit, run }) => {
  await fs.writeFile(path.join(vault, 'note.md'), '# 익명\n'); commit();
  const original = path.join(root, 'original'); assert.equal(run(original).status, 0);
  const before = await fs.readFile(path.join(original, 'notes.json')), output = path.join(root, 'failed');
  const hook = path.join(root, 'fail-write.mjs');
  await fs.writeFile(hook, `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';const original=fs.writeFile;fs.writeFile=async function(file,...args){if(String(file)===process.env.OBSIDIAN_TEST_FAILED_FILE)throw Object.assign(new Error('anonymous write failure'),{code:'EIO'});return original.call(this,file,...args);};syncBuiltinESMExports();`);
  const result = run(output, { import: hook, env: { OBSIDIAN_TEST_FAILED_FILE: path.join(output, 'review.html') } });
  assert.notEqual(result.status, 0); await assert.rejects(fs.lstat(output), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(path.join(original, 'notes.json')), before);
  assert.notEqual(run(original).status, 0); assert.deepEqual(await fs.readFile(path.join(original, 'notes.json')), before);
}));
test('a subdirectory of a Git repository is refused without exporting parent files', async () => fixture(async ({ root, vault, commit, run }) => {
  await fs.mkdir(path.join(vault, 'nested')); await fs.writeFile(path.join(vault, 'nested', 'note.md'), '# 안쪽\n');
  await fs.writeFile(path.join(vault, 'outside.md'), '# 바깥쪽\n'); commit();
  const output = path.join(root, 'package');
  const result = spawnSync(process.execPath, [cli, '--vault', path.join(vault, 'nested'), '--output', output, '--repository', 'https://github.com/example/anonymous'], { cwd: repo, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /vault_git_root_required/);
  await assert.rejects(fs.lstat(output), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(vault, 'outside.md'), 'utf8'), '# 바깥쪽\n');
}));
test('long committed path listings above the default child-process buffer retain every source', async () => fixture(async ({ root, vault, git, commit, run }) => {
  const directory = ['가'.repeat(60), '나'.repeat(60), '다'.repeat(60), '라'.repeat(60)].join('/');
  await fs.mkdir(path.join(vault, directory), { recursive: true });
  for (let start = 0; start < 1500; start += 100) await Promise.all(Array.from({ length: 100 }, (_, n) => fs.writeFile(path.join(vault, directory, '기록-' + (start + n) + '.md'), '# 익명\n')));
  await fs.writeFile(path.join(vault, '\ufeff이름.md'), '# 이름 BOM 보존\n'); commit();
  const tree = Buffer.from(git('ls-tree', '-r', '-l', '-z', 'HEAD'), 'utf8'); assert(tree.length > 1024 * 1024);
  const output = path.join(root, 'package'), result = run(output);
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).files, 1501);
  const audit = JSON.parse(await fs.readFile(path.join(output, 'private-audit.json')));
  assert.equal(audit.files.length, 1501); assert(audit.files.some(row => row.path === '\ufeff이름.md'));
}));
test('oversized committed blobs are rejected from tree size before reading their bytes', async () => fixture(async ({ root, vault, commit, run, wrapper }) => {
  await fs.writeFile(path.join(vault, 'too-large.md'), Buffer.alloc(1024 * 1024 + 1, 65)); commit();
  const marker = path.join(root, 'read-marker');
  const env = await wrapper('if [ "$3" = "cat-file" ]; then : > "$OBSIDIAN_TEST_READ_MARKER"; exit 71; fi\nexec "$OBSIDIAN_TEST_GIT_REAL" "$@"');
  const output = path.join(root, 'package'), result = run(output, { env: { ...env, OBSIDIAN_TEST_READ_MARKER: marker } });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /text_too_large/);
  await assert.rejects(fs.lstat(marker), { code: 'ENOENT' }); await assert.rejects(fs.lstat(output), { code: 'ENOENT' });
}));
test('inherited Git repository and object environment cannot substitute another history', async () => fixture(async ({ root, vault, git, commit, run }) => {
  await fs.writeFile(path.join(vault, 'note.md'), '# 동일한 원문\n'); const ref = commit();
  const other = path.join(root, 'other'); await fs.mkdir(other);
  const alternate = (...args) => execFileSync(realGit, ['-C', other, ...args], { encoding: 'utf8', stdio: 'pipe' });
  alternate('init', '-q'); await fs.writeFile(path.join(other, 'note.md'), '# 다른 이력\n'); alternate('add', '.');
  alternate('-c', 'user.name=Anonymous', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'different history');
  await fs.writeFile(path.join(other, 'note.md'), '# 동일한 원문\n'); alternate('add', '.');
  alternate('-c', 'user.name=Anonymous', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'same bytes');
  const otherRef = alternate('rev-parse', 'HEAD').trim(); assert.notEqual(ref, otherRef);
  const output = path.join(root, 'package'), result = run(output, { env: {
    GIT_DIR: path.join(other, '.git'), GIT_WORK_TREE: vault, GIT_COMMON_DIR: path.join(other, '.git'),
    GIT_INDEX_FILE: path.join(other, '.git', 'index'), GIT_OBJECT_DIRECTORY: path.join(other, '.git', 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(vault, '.git', 'objects'),
  } });
  assert.equal(result.status, 0, result.stderr);
  const audit = JSON.parse(await fs.readFile(path.join(output, 'private-audit.json'))); assert.equal(audit.ref, ref);
  const heads = git('bundle', 'list-heads', path.join(output, 'repository.bundle')); assert(heads.includes(ref)); assert(!heads.includes(otherRef));
  assert.equal(git('rev-parse', 'HEAD').trim(), ref); assert.equal(alternate('rev-parse', 'HEAD').trim(), otherRef);
}));
test('output redirected into the source after conversion starts is refused before any vault writes', async () => fixture(async ({ root, vault, git, commit, run, wrapper }) => {
  await fs.writeFile(path.join(vault, 'note.md'), '# 원본 보존\n'); const ref = commit();
  const safe = path.join(root, 'safe'), alias = path.join(root, 'alias'); await fs.mkdir(safe); await fs.symlink(safe, alias);
  const env = await wrapper('if [ "$3" = "bundle" ] && [ "$4" = "create" ]; then\n "$OBSIDIAN_TEST_GIT_REAL" "$@" || exit $?\n rm "$OBSIDIAN_TEST_OUTPUT_ALIAS" && ln -s "$2" "$OBSIDIAN_TEST_OUTPUT_ALIAS"\n exit $?\nfi\nexec "$OBSIDIAN_TEST_GIT_REAL" "$@"');
  const result = run(path.join(alias, 'package'), { env: { ...env, OBSIDIAN_TEST_OUTPUT_ALIAS: alias } });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /private_output_required/);
  await assert.rejects(fs.lstat(path.join(vault, 'package')), { code: 'ENOENT' });
  assert.equal(git('status', '--porcelain'), ''); assert.equal(git('rev-parse', 'HEAD').trim(), ref);
}));
