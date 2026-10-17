/* Selected private file continuity. No remote reads, writes, publication or account inference. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).Preservation = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const dependency = name => root.HaedoLife?.[name] || (typeof require === 'function' && require({
    PreservationReferences: './preservation-references.js', PreservationPackage: './preservation-package.js', Blog: './blog.js'
  }[name]));
  const fault = (code, message) => Object.assign(new Error(message), { code });
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  function fingerprint(snapshot) {
    return JSON.stringify(canonical({ bundle: { workspaceId: snapshot.bundle.workspaceId,
      sources: snapshot.bundle.sources, sourceVersions: snapshot.bundle.sourceVersions }, nineBoard: snapshot.nineBoard,
      posts: snapshot.posts.map(({ doc, evidence }) => ({ doc: dependency('Blog').pack(doc), evidence })) }));
  }
  function summarize(snapshot, selection = null) {
    const chosen = new Set(selection?.postIds || []);
    const sources = snapshot.bundle.sources.map(source => ({ id: source.id, title: source.title,
      versions: snapshot.bundle.sourceVersions.filter(version => version.sourceId === source.id).length }));
    const posts = snapshot.posts.map(({ doc, evidence }) => ({ id: doc.id, title: doc.title, photos: doc.photos.length,
      dependency: !!selection && !chosen.has(doc.id), evidence: evidence.refs.length, archived: doc.archived === true }));
    const boards = snapshot.nineBoard.boards.map(board => ({ id: board.id, title: board.title, areas: board.areas.length }));
    const photoBytes = snapshot.posts.reduce((total, { doc }) => total + doc.photos.reduce((sum, photo) => sum + photo.blob.size, 0), 0);
    return { posts, boards, sources, photos: posts.reduce((sum, post) => sum + post.photos, 0),
      sourceVersions: snapshot.bundle.sourceVersions.length, photoBytes,
      bytes: photoBytes + new TextEncoder().encode(fingerprint(snapshot)).length };
  }
  function create({ storage, workspaceId, isCurrent = () => true }) {
    if (!storage?.isAccountScoped || !storage.account || typeof workspaceId !== 'string')
      throw fault('auth_scope_required', '로그인한 계정에서 보관 범위를 확인해 주세요.');
    let disposed = false, generation = 0, sequence = 0;
    const candidates = new Map();
    function guard(token = generation) {
      if (disposed || token !== generation || !isCurrent()) throw fault('preservation_cancelled', '계정이나 작업공간이 바뀌었습니다. 자료는 변경하지 않았습니다.');
    }
    function candidate(ticket) {
      guard(); const value = candidates.get(ticket);
      if (!value) throw fault('preservation_candidate_missing', '파일 내용을 다시 확인한 뒤 진행해 주세요.');
      return value;
    }
    function keep(value) {
      // Bound retained original-photo memory even if a caller opens several files.
      while (candidates.size >= 2) candidates.delete(candidates.keys().next().value);
      const ticket = String(++sequence); candidates.set(ticket, value);
      return { ticket, summary: structuredClone(value.summary) };
    }
    async function catalog({ unownedWorkspaceId = null } = {}) {
      const token = generation; guard(token);
      const value = await storage.readPreservationCatalog(unownedWorkspaceId || workspaceId, { unowned: !!unownedWorkspaceId }); guard(token);
      const previous = await Promise.allSettled([storage.listUnownedWorkspaces()]); guard(token);
      return { ...value, posts: value.posts.map(post => ({ ...post, photoCount: post.photos })),
        unowned: previous[0].status === 'fulfilled' ? previous[0].value : [],
        unownedError: previous[0].status === 'rejected' ? '이전 자료 목록을 읽지 못했습니다. 다시 확인해 주세요.' : null };
    }
    async function inventory() {
      const token = generation; guard(token);
      const specs = [
        ['sources', '원문·발췌', () => storage.read(workspaceId), value => value.sources.length,
          '원문 동기화 대상 · 현재 서버 보관 여부 미확인', '자료 JSON·자료/구성 JSON. 근거 파일에는 필요한 정확 버전만 포함', value => '원문 ' + value.sources.length + '개 · 버전 ' + value.sourceVersions.length + '개 · 발췌 ' + value.records.length + '개'],
        ['stages', '가져오기·기록 글 초안', () => storage.listStages(workspaceId), value => value.length,
          '기록 글 초안만 별도 선택 이어쓰기 · 가져오기 검토 제외', '일반 자료 JSON과 이번 근거 파일에서 제외 · 기존 초안별 보관 경로 사용'],
        ['workbench', '묶음·내 페이지·회고·책', () => storage.readWorkbench(workspaceId), value => value.groups.length + value.page.entries.length + (value.page.posts || []).length + (value.books || []).length,
          '원문과 별도로 명시 연결 · 현재 서버 보관 여부 미확인', '자료·구성 JSON · 이번 근거 파일에는 포함하지 않음', value => '묶음 ' + value.groups.length + '개 · 페이지 항목/글 ' + (value.page.entries.length + (value.page.posts || []).length) + '개 · 책 ' + (value.books || []).length + '개 · 회고 원문 ' + value.reflection.versionIds.length + '개'],
        ['photoPosts', '기본 작성기 글·사진', () => storage.listPhotoPosts(workspaceId), value => value.length,
          '저장 글 한 편씩 명시 보관 · 현재 서버 보관 여부 미확인', '글별 원본 ZIP·HTML 읽기 파일 · 이번 근거 파일은 선택 저장 글만', value => '저장 글 ' + value.filter(post => post.status === 'saved').length + '개 · 초안 ' + value.filter(post => post.status === 'draft').length + '개'],
        ['pageDrafts', '기존 첨부 글 초안', () => storage.readPageDrafts(workspaceId), value => value.posts.length,
          '서버 이동에서 제외', '기존 초안 선택 파일 · 이번 근거 파일에서 제외'],
        ['collection', '컬렉션', () => storage.readCollection(workspaceId), value => value.items.length,
          '이 브라우저 보관 · 서버 이동에서 제외', '컬렉션 전용 JSON · 이번 근거 파일에서 제외'],
        ['nineBoard', '9칸 구성', () => storage.readNineBoard(workspaceId), value => value.boards.length,
          '이 브라우저 보관 · 서버 이동에서 제외', '9칸 JSON·HTML · 이번 근거 파일은 선택 구성과 필요한 참조 포함'],
        ['evidence', '구조화된 인용 근거', async () => {
          const posts = await storage.listPhotoPosts(workspaceId); guard(token);
          const values = await Promise.all(posts.map(post => storage.readPostEvidence(workspaceId, post.id))); guard(token);
          return values.reduce((sum, value) => sum + value.refs.length, 0);
        }, value => value, '글별 서버 보관에서 제외', '기존 글 ZIP에서 제외 · 이번 근거 파일은 선택 글의 정확한 근거 포함']
      ];
      const results = await Promise.allSettled(specs.map(spec => Promise.resolve().then(spec[2]))); guard(token);
      return { workspaceId, rows: specs.map(([key, label, , count, server, file, detail], index) => {
        const result = results[index];
        if (result.status === 'rejected') return { key, label, status: 'error', count: null, local: '읽기 실패', server, file,
          detail: '이 종류의 자료를 읽지 못했습니다. 다른 현황은 유지했습니다. 다시 확인해 주세요.' };
        return { key, label, status: 'ready', count: count(result.value), local: '이 브라우저', server, file,
          detail: detail ? detail(result.value) : '' };
      }) };
    }
    async function prepare({ postIds = [], boardIds = [], unownedWorkspaceId = null } = {}) {
      const token = generation; guard(token);
      const selection = { postIds: [...postIds], boardIds: [...boardIds] }, from = unownedWorkspaceId || workspaceId;
      const snapshot = await storage.readPreservationSnapshot(from, { ...selection, unowned: !!unownedWorkspaceId }); guard(token);
      const selected = await dependency('PreservationReferences').select(snapshot, selection); guard(token);
      return keep({ kind: 'local', snapshot: selected, selection, workspaceId: from, unowned: !!unownedWorkspaceId,
        fingerprint: fingerprint(selected), summary: summarize(selected, selection) });
    }
    async function read(file) {
      const token = generation; guard(token);
      const snapshot = await dependency('PreservationPackage').read(file); guard(token);
      return keep({ kind: 'file', snapshot, summary: summarize(snapshot) });
    }
    async function fresh(value, token) {
      if (value.kind !== 'local') return;
      const current = await storage.readPreservationSnapshot(value.workspaceId, { ...value.selection, unowned: value.unowned }); guard(token);
      const selected = await dependency('PreservationReferences').select(current, value.selection); guard(token);
      if (fingerprint(selected) !== value.fingerprint) throw fault('preservation_source_changed', '내용을 확인한 뒤 선택한 글·9칸·근거가 바뀌었습니다. 원본은 유지했습니다. 선택 내용을 다시 확인해 주세요.');
    }
    async function exportFile(ticket) {
      const token = generation, value = candidate(ticket);
      await fresh(value, token);
      const blob = await dependency('PreservationPackage').pack(value.snapshot); guard(token);
      // Packing and hash verification may take time; recheck before offering the file.
      await fresh(value, token); guard(token);
      return blob;
    }
    async function restore(ticket) {
      const token = generation, value = candidate(ticket);
      await fresh(value, token);
      const copy = await dependency('PreservationReferences').copy(value.snapshot); guard(token);
      await fresh(value, token); guard(token);
      // Storage validates again and commits owner, bundle, photos, evidence and board together.
      const options = value.kind === 'local' ? { source: { workspaceId: value.workspaceId, unowned: value.unowned,
        expected: value.snapshot } } : undefined;
      const installed = await storage.installPreservationCopy(copy, options);
      // The transaction's committed result stays authoritative even if its notification
      // moves the UI to the new workspace before this continuation runs.
      candidates.delete(ticket); return installed;
    }
    function cancel(ticket) {
      if (ticket !== undefined) candidates.delete(ticket);
      else { generation++; candidates.clear(); }
    }
    return Object.freeze({ catalog, inventory, prepare, read, export: exportFile, restore, restorePrepared: restore,
      cancel, dispose() { disposed = true; generation++; candidates.clear(); } });
  }
  return Object.freeze({ create, summarize });
});
