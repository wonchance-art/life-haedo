'use strict';
const { createHash } = require('node:crypto');
const { zipSync } = require('../../vendor/fflate/fflate.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(change = () => {}, options = {}) {
  const head = 'a'.repeat(40);
  const content = [
    ['photos/anonymous.png', 'git-excluded-attachment', 'image/png', Buffer.from([137,80,78,71,13,10,26,10,1,2,3])],
    ['notes/익명.md', 'git-note-version', 'text/markdown', Buffer.from('# 저장본\r\n한글 원문 🙂\r\n')],
    ['notes/익명.md', 'working-note-version', 'text/markdown', Buffer.from('# 작업본\n한글 <script>globalThis.__originalsXSS=1</script>\n')],
    ['documents/anonymous.pdf', 'git-excluded-attachment', 'application/pdf', Buffer.from('%PDF-1.7\n anonymous')],
    ['photos/anonymous.heic', 'git-excluded-attachment', 'image/heic', Buffer.from('anonymous-heic')]
  ];
  const files = {}, entries = content.map(([sourceRelativePath, role, mime, bytes]) => {
    const kind = { 'git-excluded-attachment':'attachments', 'git-note-version':'git-version', 'working-note-version':'working-version' }[role];
    const snapshotPath = `snapshot/${kind}/${sourceRelativePath}`; files[snapshotPath] = bytes;
    return { sourceRelativePath, role, mime, snapshotPath, bytes: bytes.length, sha256: sha(bytes), ...(role === 'git-note-version' ? { sourceGitCommit: head } : {}) };
  });
  const receipt = { format:'haedo-private-originals-part-v1', part:1, partCount:1, sourceHead:head, entries };
  change(receipt, files); files['part-receipt.json'] = Buffer.from(JSON.stringify(receipt));
  return { receipt, files, zip: Buffer.from(zipSync(files, {level:0,...options})) };
}
module.exports = { fixture, sha };
