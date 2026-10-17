'use strict';
const { zipSync } = require('../../vendor/fflate/fflate.js');
async function pack(entries, ref = 'b', repositoryUrl = 'https://github.com/example/anonymous') {
  const { buildVault } = await import('../../scripts/lib/obsidian-vault.mjs');
  const result = await buildVault(entries.map(([path, text]) => ({ path, bytes: Buffer.from(text) })), { repositoryUrl, ref: ref.repeat(40), title: '익명 원문' });
  const files = { 'notes.json': JSON.stringify(result.notesBackup), 'supporting-files.json': JSON.stringify(result.filesBackup), 'private-audit.json': JSON.stringify(result.manifest), 'review.json': JSON.stringify(result.review), 'review.html': 'anonymous', 'repository.bundle': 'anonymous archive' };
  return new Blob([zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)])), { level: 0 })]);
}
const entries = [['기록.md', '# 첫 기록\n😀 한글 원문 [[대상#제목]]'], ['대상.md', '# 제목\n원본 본문'], ['빠짐.md', '사라져도 보존'], ['이전.md', '경로 후보']];
const updates = [['기록.md', '# 첫 기록\n😀 바뀐 한글 [[대상#제목]]'], ['대상.md', '# 제목\n새 본문'], ['이후.md', '경로 후보'], ['추가.md', '신규']];

module.exports = { pack, entries, updates };
