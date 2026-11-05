'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../assets/life/core.js'), Photo = require('../assets/life/photo-post.js');
const Markdown = require('../assets/life/post-markdown.js'), Ref = require('../assets/life/source-reference.js');
const Nine = require('../assets/life/nine-board.js'), Refs = require('../assets/life/preservation-references.js');
const Package = require('../assets/life/preservation-package.js');

test('Markdown preservation ZIP and fresh copy retain exact evidence, AI, photo bytes and remapped references', async () => {
  let bundle = Core.createWorkspace({ title: '익명 근거 공간' });
  const imported = await Core.prepareImport({ origin: 'obsidian', title: '예전 기록', text: '정확한 원문의 문장\r\n마지막 줄', authorRelation: 'unknown' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, imported));
  const evidence = await Ref.build({ bundle, sourceId: imported.source.id, versionId: imported.version.id, locator: { start: 0, end: 11 } });
  const old = Photo.create(Core.id); old.title = '인용한 글'; old.status = 'saved'; old.revision = 3;
  const blob = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1])], { type: 'image/png' });
  const photo = { id: Core.id(), name: '비공개 원본.png', type: blob.type, size: blob.size, width: 1, height: 1, digest: await Photo.digest(blob), blob };
  old.photos = [photo]; old.ops = [{ insert: '인용 뒤 생각', attributes: { author: 'ai', italic: true } }, { insert: '\n' },
    { insert: { photo: { id: photo.id, caption: '원본 설명\n둘째 줄', alt: '대체 글' } } }, { insert: '\n' }];
  const doc = Markdown.fromV2(old).document;
  const postRef = await Ref.buildPost({ workspaceId: bundle.workspaceId, post: doc });
  const board = Nine.create(Core.id); board.title = '글로 이어지는 구성';
  board.areas[0].items = [Nine.evidenceSnapshot({ kind: 'post', value: postRef })];
  const input = { bundle, posts: [{ doc, evidence: { revision: 1, refs: [evidence] } }],
    nineBoard: { ...Nine.empty(bundle.workspaceId), format: 'life-nine-board-v2', boards: [board] } };
  const selected = await Refs.select(input, { postIds: [doc.id], boardIds: [board.id] });
  const reopened = await Package.read(await Package.pack(selected));
  assert.deepEqual(reopened, selected, 'opening the package retains the original identities and source');
  const before = structuredClone(reopened), copied = await Refs.copy(reopened), restored = copied.posts[0].doc;
  assert.deepEqual(reopened, before, 'fresh copy does not mutate the verified archive');
  assert.equal(restored.format, 'life-post-md-v1'); assert.equal(Object.hasOwn(restored, 'ops'), false);
  assert.notEqual(restored.id, doc.id); assert.notEqual(restored.photos[0].id, photo.id);
  assert.equal(restored.revision, 1); assert.equal(restored.replaces, null);
  assert.equal(restored.markdown, Markdown.remapPhotos(doc.markdown, new Map([[photo.id, restored.photos[0].id]])));
  assert.equal(Photo.plainText(restored), Photo.plainText(doc));
  assert(Photo.contentOps(restored).some(op => op.attributes?.author === 'ai'));
  assert.deepEqual(await restored.photos[0].blob.arrayBuffer(), await photo.blob.arrayBuffer());
  assert.equal(restored.photos[0].digest, photo.digest);
  assert.equal(copied.bundle.sourceVersions[0].contentText, imported.version.contentText);
  const copiedEvidence = copied.posts[0].evidence.refs[0];
  assert.notEqual(copiedEvidence.sourceVersionId, evidence.sourceVersionId);
  assert.equal(copiedEvidence.quote, evidence.quote); await Ref.resolve(copied.bundle, copiedEvidence);
  const copiedPostRef = copied.nineBoard.boards[0].areas[0].items[0].reference.value;
  assert.equal(copiedPostRef.postId, restored.id); assert.equal(copiedPostRef.postRevision, 1);
  await Ref.resolvePost({ workspaceId: copied.bundle.workspaceId, post: restored }, copiedPostRef);
});
