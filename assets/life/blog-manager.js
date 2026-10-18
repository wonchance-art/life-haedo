/* Account-scoped authored-post management. Reading a list never publishes it. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  const stateLabels = { saved: '저장한 글', draft: '초안', archived: '보관한 글' };
  const kindLabels = { photo: '블로그 글', plain: '첨부 글', source: '기록 글', 'page-draft': '첨부 글 초안', 'writing-draft': '기록 글 초안' };
  const errorText = e => e?.code === 'schema_missing' ? '서버 글 보관 기능이 아직 준비되지 않았습니다. 글은 이 브라우저에 그대로 있습니다.' : e?.message || '처리하지 못했습니다. 입력을 유지했으니 다시 시도해 주세요.';
  function create({ storage, workspaceId, auth, photoPosts, openPost, openLegacy, onOpenEvidence, blogSync, isCurrent = () => true }) {
    let host, surface, list, status, query, filter, detail, evidenceHost, evidence, rows = [], busy = null, disposed = false, epoch = 0, preview = null;
    let subscriptions = [], urls = [], shown = 40, navigating = false;
    const valid = token => !disposed && isCurrent() && (token == null || token === epoch) && !!host?.isConnected;
    const announce = message => { if (valid()) status.textContent = message; };
    async function navigate(fn) { navigating = true; try { return await fn(); } finally { navigating = false; } }
    function button(label, handler, primary = false) {
      const n = el('button', label, 'life-button' + (primary ? ' life-primary' : '')); n.type = 'button';
      n.addEventListener('click', () => { if (!valid() || busy) return; void perform(() => handler(n)); }); return n;
    }
    async function perform(fn) {
      if (!valid() || busy) return;
      const token = epoch, controls = [...surface.querySelectorAll('button,input,textarea,select')].map(n => [n, n.disabled]);
      controls.forEach(([n]) => { n.disabled = true; });
      const task = Promise.resolve().then(fn); busy = task; surface.setAttribute('aria-busy', 'true');
      try { return await task; } catch (e) { if (valid(token)) announce(errorText(e)); }
      finally { if (busy === task) busy = null; if (valid(token)) { surface.setAttribute('aria-busy', 'false'); controls.forEach(([n, disabled]) => { if (n.isConnected) n.disabled = disabled; }); } }
    }
    function clearPreview() { urls.forEach(url => URL.revokeObjectURL(url)); urls = []; preview = null; detail?.replaceChildren(); }
    const meta = text => el('p', text, 'life-meta');
    function getView() { return { query: query?.value || '', filter: filter?.value || 'all', shown }; }
    async function load() {
      const token = epoch;
      list.dataset.state = 'loading';
      const definitions = [
        ['기록 글', () => storage.read(workspaceId)], ['첨부 글', () => storage.readWorkbench(workspaceId)],
        ['블로그 글', () => storage.listPhotoPosts(workspaceId)], ['첨부 글 초안', () => storage.readPageDrafts(workspaceId)],
        ['기록 글 초안', () => storage.listStages(workspaceId)],
      ];
      const results = await Promise.allSettled(definitions.map(([, read]) => Promise.resolve().then(read)));
      if (!valid(token)) return;
      const byKind = new Map(), failed = [];
      results.forEach((result, index) => {
        if (result.status === 'rejected') { failed.push(definitions[index][0]); return; }
        const value = result.value;
        if (index === 0) {
          const bundle = value;
          const own = (bundle.sources || []).filter(source => life.Writing?.isOwnSource(source, bundle));
          byKind.set('source', own.map(source => {
            const version = life.Writing.latestVersion(bundle, source.id);
            return version && { id: source.id, versionId: version.id, title: source.title, body: version.contentText || '', updatedAt: version.importedAt, status: 'saved', kind: 'source' };
          }).filter(Boolean));
        } else if (index === 1) byKind.set('plain', (value.page?.posts || []).map(post => ({ ...post, kind: 'plain' })));
        else if (index === 2) byKind.set('photo', value.map(post => ({ ...post, status: post.archived ? 'archived' : post.status, kind: 'photo' })));
        else if (index === 3) byKind.set('page-draft', (value.posts || []).map(post => ({ ...post, kind: 'page-draft', status: 'draft' })));
        else byKind.set('writing-draft', value.filter(stage => stage.kind === 'writing' && stage.state === 'draft').map(stage => ({ ...stage, id: stage.stageId, body: stage.text || '', kind: 'writing-draft', status: 'draft' })));
      });
      // A failed source retains the last successfully shown rows instead of appearing empty.
      const kinds = ['source', 'plain', 'photo', 'page-draft', 'writing-draft'];
      rows = kinds.flatMap(kind => byKind.get(kind) || rows.filter(row => row.kind === kind));
      rows.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || (a.kind + a.id).localeCompare(b.kind + b.id));
      list.dataset.state = failed.length ? 'partial' : 'ready'; await renderRows();
      if (!valid(token)) return;
      announce(failed.length ? `${failed.join(' · ')} 목록을 읽지 못했습니다. 이미 표시한 글과 검색은 유지했습니다. 다시 불러와 주세요.` : `${rows.length}개 글과 초안을 확인했습니다. 공개는 글마다 따로 선택합니다.`);
    }
    function renderRows() {
      if (!valid()) return;
      const term = query.value.trim().toLocaleLowerCase(), selected = filter.value;
      const matching = rows.filter(row => (selected === 'all' ? row.status !== 'archived' : row.status === selected) &&
        (!term || [row.title, row.body, ...(Array.isArray(row.attachments) ? row.attachments.map(a => a.title) : [])].filter(Boolean).join('\n').toLocaleLowerCase().includes(term)));
      list.replaceChildren(); const pendingEvidence = [];
      const count = meta(`${matching.length}개`); count.classList.add('blog-manager-count'); list.append(count);
      matching.slice(0, shown).forEach(row => {
        const article = el('article', null, 'blog-post'); article.dataset.postId = row.id; article.dataset.kind = row.kind;
        const title = row.title?.trim() || row.body?.trim().split(/\r?\n/)[0]?.slice(0, 100) || '제목 없는 글';
        const focusKey = `blog:post:${row.kind}:${row.id}`, h = el('h3');
        const open = button(title, async () => {
          if (photoPosts?.flush) await photoPosts.flush();
          if (!valid()) return;
          if (row.kind === 'photo') { if (!openPost) throw new Error('글 편집 화면을 열 수 없습니다. 다시 진입해 주세요.'); await navigate(() => openPost(row.id, { expectedRevision: row.revision, focusKey })); }
          else { if (!openLegacy) throw new Error('기존 글 편집 화면을 열 수 없습니다. 다시 진입해 주세요.'); await navigate(() => openLegacy({ ...row }, { focusKey })); }
        }); open.dataset.focusKey = focusKey; h.append(open); article.append(h, meta(`${kindLabels[row.kind]} · ${stateLabels[row.status] || row.status}`));
        if (row.body) article.append(el('p', row.body.slice(0, 160), 'blog-manager-excerpt'));
        if (row.kind === 'photo') {
          const actions = el('div', null, 'blog-manager-actions');
          if (row.status !== 'archived' && storage.readPostEvidence) {
            const provenance = el('div', null, 'blog-manager-evidence'); actions.append(provenance); pendingEvidence.push(showEvidence(row, provenance));
          }
          if (row.status === 'saved') actions.append(button('공개 내용 검토', () => preparePreview(row)));
          actions.append(button(row.status === 'archived' ? '보관 해제' : '보관함으로', async () => {
            const doc = life.PhotoPost.upgrade(await storage.readPhotoPost(workspaceId, row.id));
            if (!valid()) return; doc.archived = !doc.archived;
            await storage.savePhotoPost(workspaceId, doc, doc.revision);
            if (!valid()) return; clearPreview(); await load();
          }));
          if (row.status === 'draft') actions.append(meta('초안은 이 브라우저에 보관합니다. 글을 저장한 뒤 한 편씩 서버에 보관할 수 있습니다.'));
          else {
            const server = el('details', null, 'blog-manager-server'); server.append(el('summary', '서버 보관·다른 기기'));
            const syncMessage = meta('이 글의 전체 본문과 모든 사진 원본·파일 안의 메타데이터를 내 계정 서버에 비공개로 보관합니다. 다른 글은 전송하지 않습니다. 인용 본문과 출처 URL은 함께 옮기지만 정확한 원문 연결 정보는 이 브라우저에 별도로 보관하며 원문 자료 백업과도 구분합니다.'); server.append(syncMessage);
            const state = el('p', '', 'life-meta'); state.dataset.syncPost = row.id; server.append(state); void showSyncState(row.id, state);
            server.append(button('이 글 서버에 보관', () => syncPost(row, state, 'connect')), button('서버와 변경 확인', () => syncPost(row, state, 'sync')));
            if (blogSync?.pause) server.append(button('이 글 서버 연결 중지', async () => { await blogSync.pause(workspaceId, row.id); await showSyncState(row.id, state); }));
            actions.append(server);
          }
          article.append(actions);
        }
        list.append(article);
      });
      if (!matching.length) list.append(meta(selected === 'archived' ? '보관한 글이 없습니다.' : '조건에 맞는 글이 없습니다. 검색이나 상태를 바꿔 주세요.'));
      if (matching.length > shown) list.append(button('글 더 보기', async () => { shown += 40; renderRows(); }));
      return Promise.all(pendingEvidence);
    }
    async function showEvidence(row, area) {
      const token = epoch;
      try {
        const sidecar = await storage.readPostEvidence(workspaceId, row.id);
        if (!valid(token) || !area.isConnected || !sidecar.refs.length) return;
        const details = el('details'); details.append(el('summary', '인용한 원문 확인'));
        const entries = el('ul');
        for (const ref of sidecar.refs) {
          const entry = el('li');
          const focusKey = `blog:evidence:${row.id}:${entries.children.length}`;
          const open = button(ref.title || ref.sourceKey || '제목 없는 원문', async () => {
            if (!life.SourceReference?.resolve) throw new Error('원문 연결 확인 기능을 불러오지 못했습니다. 다시 진입해 주세요.');
            const current = await storage.readPostEvidence(workspaceId, row.id);
            if (!valid(token)) return;
            if (current.revision !== sidecar.revision) throw new Error('인용한 원문 연결이 바뀌었습니다. 글 목록을 다시 불러와 확인해 주세요.');
            if (ref.workspaceId !== workspaceId) throw new Error('다른 작업공간의 원문 연결입니다. 원래 작업공간에서 확인해 주세요.');
            await life.SourceReference.resolve(await storage.read(workspaceId), ref);
            if (!valid(token)) return;
            if (!onOpenEvidence) throw new Error('원문 읽기 화면을 열지 못했습니다. 원문 연결은 유지했습니다.');
            await navigate(() => onOpenEvidence(structuredClone(ref), { focusKey }));
          });
          open.dataset.focusKey = focusKey; entry.append(open);
          if (ref.sourceKey) entry.append(meta(ref.sourceKey));
          entries.append(entry);
        }
        details.append(entries); area.replaceChildren(details);
      } catch (e) {
        if (!valid(token) || !area.isConnected) return;
        area.replaceChildren(meta(errorText(e)), button('인용한 원문 목록 다시 확인', async () => showEvidence(row, area)));
      }
    }
    function requireSync(method) { if (!blogSync || typeof blogSync[method] !== 'function') throw Object.assign(new Error('서버 글 보관 기능이 아직 준비되지 않았습니다. 이 브라우저의 글과 파일 백업을 이용해 주세요.'), { code: 'schema_missing' }); }
    async function showSyncState(id, node) {
      const token = epoch;
      try {
        requireSync('getState'); const value = await blogSync.getState(workspaceId, id);
        if (!valid(token) || !node.isConnected) return;
        const labels = { not_enabled: '이 브라우저에 보관', pending: '서버 보관 대기', synced: '서버 보관 확인', paused: '서버 연결 중지', conflict: '양쪽 변경이 있어 선택이 필요합니다. 이 글은 유지했습니다.', error: '서버 보관을 확인하지 못했습니다.' };
        node.replaceChildren(document.createTextNode((labels[value?.status] || '서버 보관 상태를 확인해 주세요.') + (value?.publication?.active ? ' · 공개 게시 중' : '')));
        if (value?.error) node.append(document.createTextNode(' ' + errorText(typeof value.error === 'string' ? life.BlogRemote?.clean?.({ code: value.error }) || { code: value.error } : value.error)));
        if (value?.status === 'conflict' && value.remoteId) node.append(button('서버 글을 새 사본으로 받기', async () => {
          requireSync('receive'); const result = await blogSync.receive(workspaceId, value.remoteId);
          if (!valid()) return; await load(); announce('서버 글을 새 사본으로 받았습니다. 기존 글도 유지했습니다.');
          if (result.newLocalPostId && openPost) await navigate(() => openPost(result.newLocalPostId));
        }));
        if (value?.status === 'conflict' && blogSync?.resolve) {
          const reviewed = { localRevision: value.conflict?.localRevision, remoteRevision: value.conflict?.remoteRevision };
          node.append(meta(`이 브라우저 ${value.conflict?.localRevision ?? value.localRevision ?? '?'}판 · 서버 ${value.conflict?.remoteRevision ?? value.remoteRevision ?? '?'}판${value.conflict?.remoteTitle ? ' · ' + value.conflict.remoteTitle : ''}`));
          node.append(button('양쪽 사본을 남기고 내 글로 보관', async () => {
            const result = await resolveReviewed(id, 'local', reviewed);
            if (!valid()) return; await load();
            announce(result.status === 'synced' ? '서버의 이전 글도 새 사본으로 남기고 내 글의 서버 보관을 확인했습니다.' : '양쪽 글을 유지했습니다. 서버 처리 상태를 다시 확인해 주세요.');
          }), button('기존 글을 남기고 서버 글로 이어쓰기', async () => {
            const result = await resolveReviewed(id, 'remote', reviewed);
            if (!valid()) return; await load(); announce(result.syncError ? '서버 글을 새 사본으로 받았습니다. 연결 상태는 다시 확인해 주세요.' : '기존 글을 유지하고 서버 글을 새 사본으로 받았습니다.');
            if (result.newLocalPostId && openPost) await navigate(() => openPost(result.newLocalPostId));
          }));
        }
      } catch (e) { if (valid(token) && node.isConnected) node.textContent = errorText(e); }
    }
    async function resolveReviewed(id, choice, reviewed) {
      try { return await blogSync.resolve(workspaceId, id, choice, reviewed); }
      catch (e) {
        if (e?.code === 'local_changed' && valid()) await load();
        throw e;
      }
    }
    async function syncPost(row, node, method) {
      requireSync(method); await blogSync[method](workspaceId, row.id);
      if (!valid()) return; await showSyncState(row.id, node);
      announce('서버 처리 결과를 글 아래에서 확인해 주세요.');
    }
    async function preparePreview(row) {
      const doc = await storage.readPhotoPost(workspaceId, row.id);
      if (!valid()) return;
      if (doc.status !== 'saved' || doc.archived) throw new Error('저장한 보관함 밖 글만 공개할 수 있습니다. 목록을 다시 확인해 주세요.');
      if (!life.Blog?.publicSnapshot || !life.BlogPublicUI?.render) throw new Error('공개 미리보기 기능을 불러오지 못했습니다. 다시 진입해 주세요.');
      let capturedState = null;
      try { if (blogSync?.getState) capturedState = await blogSync.getState(workspaceId, row.id); } catch (_) { /* Preview remains local; publication still requires a working server. */ }
      if (!valid()) return;
      clearPreview();
      let remoteRevision = capturedState?.remoteRevision || 0, publicRevision = capturedState?.publication?.revision || 0;
      preview = { doc, photoIds: [], snapshot: null, revision: doc.revision, remoteRevision, publicRevision };
      const panel = el('section', null, 'blog-manager-preview'); panel.setAttribute('aria-label', '공개 내용 검토');
      panel.append(el('h3', '공개 내용 검토'), meta('이 화면에서 고른 본문과 첨부만 공개합니다. 선택하지 않은 사진은 공개 본문에서도 빠집니다.'));
      const privateLabel = el('label', null, 'blog-manager-check'), privateConsent = el('input'); privateConsent.type = 'checkbox';
      privateConsent.setAttribute('aria-label', '글 전체와 모든 사진 원본의 비공개 서버 보관 동의');
      privateLabel.append(privateConsent, document.createTextNode('게시할 때 이 글의 전체 본문과 모든 사진 원본·내장 메타데이터를 내 계정 서버에 비공개로 보관합니다. 공개에는 아래에서 선택한 사진만 포함합니다.')); panel.append(privateLabel);
      const authorLabel = el('label', '공개 이름'), author = el('input'); author.type = 'text'; author.maxLength = 100; author.setAttribute('aria-label', '공개 이름'); authorLabel.append(author); panel.append(authorLabel);
      const introLabel = el('label', '공개 소개'), intro = el('textarea'); intro.maxLength = 500; intro.rows = 2; intro.setAttribute('aria-label', '공개 소개'); introLabel.append(intro); panel.append(introLabel);
      const photos = el('fieldset'); photos.append(el('legend', '공개할 사진'));
      const selected = new Map();
      doc.photos.forEach(p => {
        const label = el('label', null, 'blog-manager-check'), check = el('input'); check.type = 'checkbox'; check.dataset.photoId = p.id;
        label.append(check, document.createTextNode(`${p.name} · ${p.width}×${p.height} · ${p.size.toLocaleString('ko-KR')}바이트`)); photos.append(label); selected.set(p.id, check);
      });
      if (!doc.photos.length) photos.append(meta('이 글에는 사진이 없습니다.')); panel.append(photos);
      const originalLabel = el('label', null, 'blog-manager-check'), original = el('input'); original.type = 'checkbox';
      original.setAttribute('aria-label', '선택한 사진 원본과 포함된 메타데이터 공개 동의');
      originalLabel.append(original, document.createTextNode('선택한 사진의 원본 파일과 그 안의 촬영·위치 등 메타데이터도 공개될 수 있음을 확인했습니다.')); panel.append(originalLabel);
      const result = el('div', null, 'blog-manager-public-preview'); panel.append(result);
      const consentLabel = el('label', null, 'blog-manager-check'), consent = el('input'); consent.type = 'checkbox'; consent.setAttribute('aria-label', '이 내용을 공개합니다'); consentLabel.append(consent, document.createTextNode('미리보기의 내용을 공개합니다.')); panel.append(consentLabel);
      let changed = true;
      function invalidate() { changed = true; consent.checked = false; result.replaceChildren(meta('공개할 내용을 바꿨습니다. 미리보기를 갱신해 확인해 주세요.')); preview.snapshot = null; }
      author.addEventListener('input', invalidate); intro.addEventListener('input', invalidate); selected.forEach(check => check.addEventListener('change', invalidate));
      original.addEventListener('change', () => { consent.checked = false; });
      panel.append(button('공개 미리보기 갱신', async () => {
        if (!valid() || preview?.doc.id !== doc.id) return;
        if (blogSync?.getState) {
          const state = await blogSync.getState(workspaceId, doc.id);
          if (!valid() || preview?.doc.id !== doc.id) return;
          remoteRevision = state?.remoteRevision || 0; publicRevision = state?.publication?.revision || 0;
        }
        const photoIds = [...selected].filter(([, check]) => check.checked).map(([id]) => id);
        const snapshot = await life.Blog.publicSnapshot(doc, { photoIds, author: { name: author.value, intro: intro.value } });
        if (!valid() || preview?.doc.id !== doc.id) return;
        urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
        const included = doc.photos.filter(p => photoIds.includes(p.id)), photoUrls = new Map();
        snapshot.photos.forEach((p, index) => { const url = URL.createObjectURL(included[index].blob); urls.push(url); photoUrls.set(p.id, url); });
        result.replaceChildren(life.BlogPublicUI.render(snapshot, { document, photoUrl: p => photoUrls.get(p.id) || null, allowOriginal: true }));
        preview = { doc, revision: doc.revision, remoteRevision, publicRevision, snapshot, photoIds, author: { name: author.value, intro: intro.value } }; changed = false; consent.checked = false;
        announce('이 미리보기와 같은 본문·선택 사진으로 공개합니다.');
      }));
      panel.append(button('공개 게시·갱신', async () => {
        if (changed || !preview?.snapshot) throw new Error('공개 미리보기를 먼저 갱신해 주세요.');
        if (!privateConsent.checked) throw new Error('이 글 전체와 모든 사진 원본의 비공개 서버 보관 범위를 확인해 주세요.');
        if (!consent.checked || (preview.photoIds.length && !original.checked)) throw new Error('공개 내용과 선택한 사진 원본 공개 여부를 확인해 주세요.');
        requireSync('publish'); const current = await storage.readPhotoPost(workspaceId, doc.id);
        if (!valid()) return;
        if (changed || !preview?.snapshot || !consent.checked || !privateConsent.checked || (preview.photoIds.length && !original.checked)) throw new Error('공개 내용이 바뀌었습니다. 미리보기를 갱신하고 공개 범위를 다시 확인해 주세요.');
        if (current.revision !== preview.revision || current.archived || current.status !== 'saved') throw new Error('글이 바뀌었습니다. 공개 내용 검토를 다시 열어 최신 글을 확인해 주세요.');
        const published = await blogSync.publish(workspaceId, doc.id, { photoIds: [...preview.photoIds], author: { ...preview.author }, expectedLocalRevision: preview.revision,
          expectedRemoteRevision: preview.remoteRevision, expectedPublicRevision: preview.publicRevision });
        if (!valid()) return;
        const url = published?.url || published?.publicUrl || published?.public?.url;
        let address; try { address = new URL(url); } catch (_) { /* Show a verified completion only with the application public URL. */ }
        if (!address || !['http:', 'https:'].includes(address.protocol) || address.origin !== location.origin || address.username || address.password) throw new Error('게시 결과의 공개 주소를 확인하지 못했습니다. 서버 상태를 다시 확인해 주세요.');
        const link = el('a', '공개한 글 열기'); link.href = address.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; result.append(link);
        try {
          const state = await blogSync.getState(workspaceId, doc.id);
          if (!valid()) return;
          remoteRevision = state?.remoteRevision || 0; publicRevision = state?.publication?.revision || 0;
          preview.remoteRevision = remoteRevision; preview.publicRevision = publicRevision; consent.checked = false;
        } catch (_) {
          if (!valid()) return;
          preview.snapshot = null; changed = true; consent.checked = false;
          announce('공개 게시와 주소는 확인했습니다. 후속 상태 조회에 실패했으니 공개 검토를 다시 열어 확인해 주세요.'); return;
        }
        announce('공개 게시를 확인했습니다. 같은 글의 갱신은 이 주소를 유지합니다.');
      }, true));
      panel.append(button('공개 철회', async () => { requireSync('unpublish'); await blogSync.unpublish(workspaceId, doc.id, { expectedPublicRevision: preview.publicRevision }); if (!valid()) return; result.replaceChildren(meta('공개 철회를 확인했습니다. 이 브라우저의 원래 글은 유지했습니다.')); consent.checked = false; announce('공개 철회를 확인했습니다.'); }));
      panel.append(button('공개 검토 닫기', async () => clearPreview())); detail.append(panel); panel.querySelector('input')?.focus({ preventScroll: true });
    }
    async function listRemote() {
      requireSync('list'); const token = epoch, entries = await blogSync.list(workspaceId);
      if (!valid(token)) return;
      const area = el('section', null, 'blog-manager-remote'); area.append(el('h3', '서버에 보관한 글'));
      for (const remote of entries) {
        const id = remote.id || remote.remoteId;
        const line = el('div'); line.append(meta(remote.title || '제목 없는 서버 글'));
        line.append(button('이 글을 새 사본으로 받기', async () => {
          requireSync('receive'); const result = await blogSync.receive(workspaceId, id);
          if (!valid()) return; await load(); announce(result.syncError ? '새 사본은 보관했습니다. 서버 연결 상태는 다시 확인해 주세요.' : '이 브라우저에 새 사본으로 받았습니다. 기존 글은 유지했습니다.');
          if (result.newLocalPostId && openPost) await navigate(() => openPost(result.newLocalPostId));
        })); area.append(line);
      }
      if (!entries.length) area.append(meta('서버에 보관한 글이 없습니다.'));
      surface.querySelector('.blog-manager-remote')?.remove(); surface.append(area);
    }
    async function chooseEvidence(seed = {}) {
      if (!life.BlogEvidence?.create || !storage.savePhotoPostWithEvidence) throw new Error('근거를 연결할 준비가 되지 않았습니다. 원문과 글은 그대로 있습니다.');
      if (evidence?.dirty?.()) await evidence.flush();
      clearPreview(); evidence?.dispose();
      evidence = life.BlogEvidence.create({ host: evidenceHost, getBundle: () => storage.read(workspaceId), isCurrent: () => valid(), onCancel: () => {},
        onApply: async ({ reference, ops, title }) => {
          if (!valid()) throw new Error('작업공간이 바뀌었습니다. 현재 공간에서 다시 열어 주세요.');
          const doc = life.PhotoPost.create(life.Core?.id || (() => crypto.randomUUID())); doc.title = title || ''; doc.ops = structuredClone(ops);
          const saved = await storage.savePhotoPostWithEvidence(workspaceId, doc, 0, [reference], 0);
          if (!valid()) return;
          evidence?.dispose(); evidence = null;
          try {
            await load(); announce('원문을 유지하고 인용·내 생각을 새 초안으로 보관했습니다.');
            if (openPost) await navigate(() => openPost(saved?.post?.id || saved?.id || doc.id));
          } catch (_) {
            if (valid()) announce('새 초안은 보관했습니다. 편집 화면을 열지 못했으니 글 목록의 초안에서 다시 열어 주세요.');
          }
        } });
      await evidence.open(seed);
    }
    async function flush() {
      if (navigating) return true;
      if (busy) throw new Error('글 처리 결과를 확인한 뒤 이동해 주세요.');
      if (evidence?.dirty?.()) { if (evidence.flush) await evidence.flush(); else throw new Error('선택한 인용과 내 생각을 적용하거나 취소해 주세요.'); }
      return true;
    }
    async function mount(target, { evidenceSeed = null, viewState = null } = {}) {
      if (disposed) throw new Error('종료한 글 관리 화면입니다.');
      if (host) { await flush(); clearPreview(); evidence?.dispose(); evidence = null; subscriptions.forEach(unsubscribe => unsubscribe?.()); subscriptions = []; }
      host = target; epoch++; surface = el('section', null, 'blog-manager'); surface.setAttribute('aria-label', '전체 글 관리');
      const header = el('div', null, 'blog-manager-toolbar');
      query = el('input'); query.id = 'blogManagerSearch'; query.type = 'search'; query.placeholder = '내 글 검색'; query.setAttribute('aria-label', '내 글 검색');
      filter = el('select'); filter.id = 'blogManagerFilter'; filter.setAttribute('aria-label', '글 상태');
      [['all', '전체 글·초안'], ['saved', '저장한 글'], ['draft', '초안'], ['archived', '보관한 글']].forEach(([value, label]) => { const option = el('option', label); option.value = value; filter.append(option); });
      query.value = typeof viewState?.query === 'string' ? viewState.query : '';
      filter.value = ['all', 'saved', 'draft', 'archived'].includes(viewState?.filter) ? viewState.filter : 'all';
      shown = Number.isSafeInteger(viewState?.shown) && viewState.shown >= 40 && viewState.shown <= 1000000 ? viewState.shown : 40;
      const search = () => { shown = 40; renderRows(); }; query.addEventListener('input', search); filter.addEventListener('change', search);
      header.append(query, filter, button('글 목록 다시 불러오기', load));
      status = meta('글을 불러오는 중입니다.'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      detail = el('div'); evidenceHost = el('div'); list = el('div', null, 'blog-manager-list'); list.setAttribute('aria-label', '내 글 목록');
      surface.append(header, status, button('서버에 보관한 글 확인', listRemote), button('자료 인용으로 새 글 쓰기', () => chooseEvidence()), detail, evidenceHost, list); host.replaceChildren(surface);
      if (storage.subscribe) subscriptions.push(storage.subscribe(workspaceId, event => { if (valid() && event.workspaceId === workspaceId && ['photo_posts_changed', 'workbench_changed'].includes(event.type)) announce('저장한 글이 바뀌었습니다. 글 목록을 다시 불러와 확인해 주세요.'); }));
      await load();
      if (evidenceSeed && valid()) await chooseEvidence(evidenceSeed);
    }
    return { mount, flush, getView, dirty: () => !!busy || !!evidence?.dirty?.(), dispose() { disposed = true; epoch++; clearPreview(); evidence?.dispose(); subscriptions.forEach(unsubscribe => unsubscribe?.()); subscriptions = []; rows = []; surface?.replaceChildren(); host = null; } };
  }
  life.BlogManager = Object.freeze({ create });
})(globalThis);
