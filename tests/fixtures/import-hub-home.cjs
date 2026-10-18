/* Generated Korean samples only; no private vault, account, images or source requests. */
'use strict';
async function seed(page, mode = 'imported') {
  return page.evaluate(async mode => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, workspaceId = await s.getActive();
    const at = Date.now(), refs = [], timestamp = minutes => new Date(at - minutes * 60000).toISOString();
    for (let index = 0; index < 13; index++) {
      const bundle = await s.read(workspaceId), linkOnly = index === 12;
      const text = index === 0 ? '\ufeff---\r\ntitle: 합성 보관 원문\r\n---\r\n이전 원문을 바꾸지 않는 문장 🌱\r\n' : `모든 자료 검색표식 ${index}. 외부에 남긴 익명의 글을 보관합니다. 🌱\n${'오래 읽을 한국어 문장을 천천히 이어 갑니다. '.repeat(index === 11 ? 12 : 2)}`;
      const title = index === 11 ? '긴 한국어 제목도 줄을 넘기며 읽을 수 있도록 보관한 익명 산책과 독서에 관한 아주 긴 기록' : linkOnly ? '본문 없이 주소만 보관한 익명 글' : '외부 블로그 익명 기록 ' + index;
      const input = { origin: index % 2 ? 'naver_blog' : 'obsidian', title, text: linkOnly ? null : text, url: `https://example.invalid/anonymous-blog/${index}`, authorRelation: 'unknown', forceSeparate: true, coverage: linkOnly ? 'link_only' : 'full_text' };
      const prepared = await c.prepareImport(input, bundle); prepared.version.importedAt = timestamp(80-index); prepared.source.createdAt = prepared.source.updatedAt = timestamp(80-index);
      const result = await s.commitLocal({ workspaceId, baseRevision: bundle.revision, operationId: c.id(), changes: c.buildImportChanges(bundle, prepared) }); if (result.status !== 'stored') throw Error('Synthetic source fixture failed');
      refs.push({ sourceId: prepared.source.id, versionId: prepared.version.id, title, text: linkOnly ? null : text, linkOnly });
    }
    let bundle = await s.read(workspaceId), original = bundle.sources.find(row => row.id === refs[0].sourceId);
    const latestText = '모든 자료 검색표식 최신 원문 🌱\r\n이전 버전의 BOM과 줄바꿈은 그대로 보존합니다.';
    const newer = await c.prepareImport({ origin: original.origin, title: original.title, url: original.url, text: latestText, existingSourceId: original.id, authorRelation: 'unknown' }, bundle);
    newer.version.importedAt = timestamp(30); newer.source.updatedAt = timestamp(30);
    const committed = await s.commitLocal({ workspaceId, baseRevision: bundle.revision, operationId: c.id(), changes: c.buildImportChanges(bundle, newer) }); if (committed.status !== 'stored') throw Error('Synthetic latest version failed');
    const result = { workspaceId, refs, oldVersionId: refs[0].versionId, latestVersionId: newer.version.id, latestText, mode };
    if (mode === 'mixed') {
      const M = HaedoLife.PhotoPost, P = HaedoLife.PagePosts, W = HaedoLife.Writing;
      const photo = M.create(c.id, timestamp(8)); photo.status = 'saved'; photo.title = '그림과 함께 남긴 익명의 사진 글';
      photo.ops = [{ insert: '모든 자료 검색표식 익명 사진 글. 직접 그린 모양만 표시합니다.\n' }];
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 640; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#d9e7df'; ctx.fillRect(0,0,960,640); ctx.fillStyle = '#43665a'; ctx.fillRect(0,390,960,250); ctx.fillStyle = '#e5ca93'; ctx.fillRect(370,180,170,460);
      const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.9)), image = await M.readPhoto(new File([blob],'anonymous-drawing.jpg',{type:'image/jpeg'}),c.id);
      photo.photos = [image]; photo.ops.push({ insert: { photo: { id: image.id, caption: '검증용으로 직접 그린 익명 이미지', alt: '옅은 초록 바탕에 직사각형으로 그린 합성 그림' } } }, { insert: '\n' }); await s.savePhotoPost(workspaceId,photo,0); result.photoId=photo.id;
      const draft=M.create(c.id,timestamp(1)); draft.title='작성 중인 익명 초안'; draft.ops=[{insert:'홈 최근 목록에 섞이지 않을 초안\n'}]; await s.savePhotoPost(workspaceId,draft,0);result.draftId=draft.id;
      const archived=M.create(c.id,timestamp(2));archived.status='saved';archived.archived=true;archived.title='보관함에 남긴 익명 글';archived.ops=[{insert:'홈 최근 목록에 섞이지 않을 보관 글\n'}];await s.savePhotoPost(workspaceId,archived,0);result.archivedId=archived.id;
      const wb=await s.readWorkbench(workspaceId),post=P.draft(wb.page.posts||[],c.id(),timestamp(6));post.body='모든 자료 검색표식 익명 첨부 글\n다른 저장 형식의 본문도 그대로 보관합니다.';wb.page.posts=P.finish((wb.page.posts||[]).concat(post),post.id,timestamp(5)).posts;await s.saveWorkbench(workspaceId,wb,wb.revision);result.plainId=post.id;
      bundle=await s.read(workspaceId);const own=W.createDraft(bundle);own.title='직접 쓴 익명 기록';own.text='모든 자료 검색표식 직접 쓴 원문의 정확한 본문 🌱';const saved=await W.prepareSave(bundle,own);const write=await s.commitLocal({workspaceId,baseRevision:bundle.revision,operationId:c.id(),changes:saved.changes});if(write.status!=='stored')throw Error('Synthetic own writing failed');result.ownSourceId=saved.source.id;result.ownVersionId=saved.version.id;
    }
    const other=await s.createWorkspace('다른 익명 홈 작업공간');await s.setActive(workspaceId);result.otherWorkspaceId=other.workspaceId;
    return result;
  }, mode);
}
module.exports={seed};
