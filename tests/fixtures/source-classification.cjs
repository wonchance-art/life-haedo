/* Anonymous, generated data only. Never reads an actual vault or classification. */
'use strict';
const { createHash } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const commit = 'c'.repeat(40);
const otherCommit = 'd'.repeat(40);
const repositoryUrl = 'https://github.com/example/classification-browser-fixture';
const taxonomy = [{ id: 'reading', label: '익명 읽기' }, { id: 'walking', label: '익명 산책' }];
const rawMarker = 'SYNTHETIC_RAW_PREVIEW_MUST_NOT_EXPORT';

async function fixture(count = 96) {
  const { buildVault } = await import('../../scripts/lib/obsidian-vault.mjs');
  const entries = Array.from({ length: count }, (_, index) => {
    const path = index === 0 ? 'a/같은 제목.md' : index === 1 ? 'b/같은 제목.md' : index === 2 ? 'notes/이전 버전.md' : `notes/익명 분류 ${String(index).padStart(3, '0')}.md`;
    const body = `합성공통 ${index} 한글🌱 자료를 정확한 버전에서 읽습니다.${index % 3 === 0 ? ' 찾을표식' : ''}${index === 2 ? ' 이전원문의끝표식🌱' : ''}`;
    const text = index === 0 ? `\ufeff---\r\ntitle: 합성 제목\r\ntags: [synthetic]\r\n---\r\n${body}\r\n[[../b/같은 제목]]\r\n` : `${body}\n${index === 1 ? '<script>globalThis.__classificationSourceExecuted = true;</script>\n' : ''}`;
    return { path, bytes: Buffer.from(text), text, index };
  });
  entries.push({ path: 'support/익명 보조.md', bytes: Buffer.from('합성공통 본문 글이 아닌 익명 보조 메타데이터\n'), text: '합성공통 본문 글이 아닌 익명 보조 메타데이터\n', index: count });
  const built = await buildVault(entries, { repositoryUrl, ref: commit, title: '익명 분류 자료실' });
  const full = {
    schemaVersion: 1, sourceCommit: commit, taxonomy,
    scope: 'Synthetic browser verification only', originalFilesChanged: false, serverWritten: false, authorshipConfirmed: false,
    records: entries.map(({ path, bytes, index }) => {
      const topic = taxonomy[Math.floor(index / 4) % 2], source = index % 2, kind = Math.floor(index / 2) % 2, review = Math.floor(index / 8) % 2 === 1;
      const supporting = index === count, unclassified = index === count - 1;
      return {
        id: `synthetic-${index}`, path, bytes: bytes.length, sha256: hash(bytes), isContent: !supporting,
        title: path.split('/').at(-1).slice(0, -3),
        source: { id: `source-${source}`, label: `익명 출처 ${source + 1}`, kind: 'archive', originalFolder: path.split('/').slice(0, -1).join('/'), evidence: null, status: 'structural_or_unconfirmed' },
        kind: { id: kind ? 'saved-text' : 'note', label: kind ? '익명 저장 글' : '익명 메모', basis: '합성 자료의 명시 후보', status: 'candidate' },
        authorship: { relation: 'unknown', candidate: 'unknown', status: 'unconfirmed' },
        topics: supporting || unclassified ? [] : [{ id: topic.id, label: topic.label, score: 2, confidence: 'moderate', basis: { synthetic: true } }], primaryTopic: supporting ? 'not_applicable' : unclassified ? 'unclassified' : topic.id,
        reviewReasons: unclassified ? ['topic_unclassified'] : review ? ['합성 자료의 확인이 필요합니다.'] : [], reviewStatus: review || unclassified ? 'needs_review' : 'classified_candidate',
        existingTags: ['synthetic'], originalDate: '2026-10-18', bodySha256: hash(bytes),
        preview: rawMarker + ' ' + index, copyPath: `분류사본/익명/${index}.md`,
      };
    }),
  };
  const versions = built.notesBackup.workspace.sourceVersions;
  const sources = built.notesBackup.workspace.sources;
  const refs = entries.map(entry => {
    const source = sources.find(row => row.sourceKey === entry.path), version = versions.find(row => row.sourceId === source.id);
    return { index: entry.index, path: entry.path, text: entry.text, sourceId: source.id, versionId: version.id, sha256: hash(entry.bytes) };
  });
  return { backup: built.notesBackup, full, refs, commit, otherCommit, repositoryUrl, rawMarker };
}
module.exports = { fixture, commit, otherCommit, repositoryUrl, taxonomy, rawMarker };
