/* Account-scoped authored-post management. Reading a list never publishes it. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  const stateLabels = { saved: '저장한 글', draft: '초안', archived: '보관한 글' };
  const kindLabels = { photo: '블로그 글', plain: '첨부 글', source: '기록 글', 'page-draft': '첨부 글 초안', 'writing-draft': '기록 글 초안' };
  const errorText = e => e?.code === 'schema_missing' ? '서버 글 보관 기능이 아직 준비되지 않았습니다. 글은 이 브라우저에 그대로 있습니다.' : e?.message || '처리하지 못했습니다. 입력을 유지했으니 다시 시도해 주세요.';
  function create({ storage, workspaceId, auth, photoPosts, openPost, openLegacy, onOpenEvidence, onOpenAccountBlog = null, blogSync, isCurrent = () => true }) {
    let host, surface, list, status, query, filter, detail, evidenceHost, evidence, rows = [], busy = null, disposed = false, epoch = 0, preview = null;
    let subscriptions = [], urls = [], shown = 40, navigating = false, focusedPostId = null, expectedInitialRevision = null, syncStates = {};
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
      if (expectedInitialRevision !== null) {
        // A failed fresh photo read must not validate a newly requested exact
        // destination against rows retained from an earlier manager mount.
        const selected = byKind.get('photo')?.find(row => row.id === focusedPostId);
        if (!selected || selected.revision !== expectedInitialRevision || !['saved', 'archived'].includes(selected.status)) {
          list.dataset.state = 'error';
          throw new Error('선택한 글이 바뀌었습니다. 읽던 글로 돌아가 현재 내용을 확인한 뒤 다시 열어 주세요.');
        }
        expectedInitialRevision = null;
      }
      rows.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || (a.kind + a.id).localeCompare(b.kind + b.id));
      try { syncStates = blogSync?.statuses ? await blogSync.statuses(workspaceId) : {}; } catch (_) { syncStates = {}; }
      if (!valid(token)) return;
      list.dataset.state = failed.length ? 'partial' : 'ready'; await renderRows();
      if (!valid(token)) return;
      announce(failed.length ? `${failed.join(' · ')} 목록을 읽지 못했습니다. 이미 표시한 글과 검색은 유지했습니다. 다시 불러와 주세요.` : focusedPostId ? '선택한 글의 공개·보관 상태를 확인했습니다.' : `${rows.length}개 글과 초안을 확인했습니다. 공개는 글마다 따로 선택합니다.`);
    }
    function renderRows() {
      if (!valid()) return;
      const term = query.value.trim().toLocaleLowerCase(), selected = filter.value;
      const matching = rows.filter(row => focusedPostId ? row.kind === 'photo' && row.id === focusedPostId :
        (selected === 'all' ? row.status !== 'archived' : row.status === selected) &&
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
          actions.append(button('삭제', () => deletePost(row)));
          const state = el('p', '', 'life-meta blog-manager-sync'); state.dataset.syncPost = row.id; showSyncState(row.id, state);
          actions.append(state);
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
    function requireSync(method) { if (!blogSync || typeof blogSync[method] !== 'function') throw Object.assign(new Error('서버 동기화를 준비하지 못했습니다. 글은 이 기기에 그대로 있습니다.'), { code: 'schema_missing' }); }
    const syncLabels = { synced: '모든 기기에 저장됨', pending: '저장 대기', error: '오류 · 다시 시도' };
    function showSyncState(id, node) {
      const value = syncStates[id] || 'pending';
      node.dataset.state = value; node.replaceChildren(document.createTextNode(syncLabels[value] || syncLabels.pending));
      if (value === 'error' && blogSync?.syncNow) node.append(document.createTextNode(' '), button('다시 시도', async () => { await blogSync.syncNow({ force: true }); if (valid()) await refreshSync(); }));
    }
    async function refreshSync() {
      const token = epoch;
      try { syncStates = blogSync?.statuses ? await blogSync.statuses(workspaceId) : {}; } catch (_) { return; }
      if (!valid(token)) return;
      list?.querySelectorAll('[data-sync-post]').forEach(node => showSyncState(node.dataset.syncPost, node));
    }
    async function deletePost(row) {
      const label = row.title?.trim() || '제목 없는 글';
      if (typeof root.confirm === 'function' && !root.confirm(`“${label}”을 삭제할까요? 로그인한 모든 기기에서 함께 삭제됩니다.`)) return;
      if (blogSync?.deletePost) await blogSync.deletePost(workspaceId, row.id, { expectedRevision: row.revision });
      else await storage.deletePhotoPost(workspaceId, row.id, row.revision);
      if (!valid()) return; clearPreview(); await load(); announce('글을 삭제했습니다. 다른 기기에서도 삭제됩니다.');
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
      const authorLabel = el('label', '공개 이름'), author = el('input'); author.type = 'text'; author.maxLength = 100; author.setAttribute('aria-label', '공개 이름'); authorLabel.append(author); panel.append(authorLabel);
      const introLabel = el('label', '공개 소개'), intro = el('textarea'); intro.maxLength = 500; intro.rows = 2; intro.setAttribute('aria-label', '공개 소개'); introLabel.append(intro); panel.append(introLabel);
      const photos = el('fieldset'); photos.append(el('legend', '공개할 사진'));
      const selected = new Map();
      // 2026-11-02 owner decision: every published photo is a re-encoded copy
      // without camera or location metadata; originals stay private.
      const animated = new Set();
      for (const p of doc.photos) {
        try { if (!life.PhotoPost.viewRequired(p.type) && (await life.PhotoPost.imageTraits(p.blob)).animated) animated.add(p.id); } catch (_) { /* The copy step reports unreadable photos. */ }
      }
      if (!valid()) return;
      doc.photos.forEach(p => {
        const label = el('label', null, 'blog-manager-check'), check = el('input'); check.type = 'checkbox'; check.dataset.photoId = p.id;
        label.append(check, document.createTextNode(`${p.name} · ${p.width}×${p.height} · ${p.size.toLocaleString('ko-KR')}바이트` + (animated.has(p.id) ? ' · 움직이는 사진은 첫 장면만 공개' : ''))); photos.append(label); selected.set(p.id, check);
      });
      if (doc.photos.length) photos.append(meta('고른 사진은 촬영·위치 정보를 뺀 사본으로 공개합니다. 원본은 비공개로 남습니다.'));
      else photos.append(meta('이 글에는 사진이 없습니다.'));
      panel.append(photos);
      const result = el('div', null, 'blog-manager-public-preview'); panel.append(result);
      const consentLabel = el('label', null, 'blog-manager-check'), consent = el('input'); consent.type = 'checkbox'; consent.setAttribute('aria-label', '이 내용을 공개합니다'); consentLabel.append(consent, document.createTextNode('미리보기의 내용을 공개합니다.')); panel.append(consentLabel);
      let changed = true;
      // Copies made for this review, reused while the same photos stay selected.
      const copies = new Map();
      function invalidate() { changed = true; consent.checked = false; result.replaceChildren(meta('공개할 내용을 바꿨습니다. 미리보기를 갱신해 확인해 주세요.')); preview.snapshot = null; }
      author.addEventListener('input', invalidate); intro.addEventListener('input', invalidate); selected.forEach(check => check.addEventListener('change', invalidate));
      panel.append(button('공개 미리보기 갱신', async () => {
        if (!valid() || preview?.doc.id !== doc.id) return;
        if (blogSync?.getState) {
          const state = await blogSync.getState(workspaceId, doc.id);
          if (!valid() || preview?.doc.id !== doc.id) return;
          remoteRevision = state?.remoteRevision || 0; publicRevision = state?.publication?.revision || 0;
        }
        const photoIds = [...selected].filter(([, check]) => check.checked).map(([id]) => id);
        const included = doc.photos.filter(p => photoIds.includes(p.id));
        if (included.some(p => !copies.has(p.id))) announce('공개할 사진의 사본을 만드는 중입니다.');
        for (const p of included) {
          if (!copies.has(p.id)) copies.set(p.id, await life.PhotoPost.publicCopy(p));
          if (!valid() || preview?.doc.id !== doc.id) return;
        }
        const shown = included.map(p => copies.get(p.id)), uploaded = shown.filter(copy => !copy.view);
        const snapshot = await life.Blog.publicSnapshot(doc, { photoIds, author: { name: author.value, intro: intro.value }, copies: uploaded });
        if (!valid() || preview?.doc.id !== doc.id) return;
        urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
        // The preview shows the exact bytes that become public.
        const photoUrls = new Map();
        snapshot.photos.forEach((p, index) => { const url = URL.createObjectURL(shown[index].blob); urls.push(url); photoUrls.set(p.id, url); });
        result.replaceChildren(life.BlogPublicUI.render(snapshot, { document, photoUrl: p => photoUrls.get(p.id) || null, allowOriginal: true }));
        preview = { doc, revision: doc.revision, remoteRevision, publicRevision, snapshot, photoIds, copies: uploaded, author: { name: author.value, intro: intro.value } }; changed = false; consent.checked = false;
        announce('이 미리보기와 같은 본문·선택 사진으로 공개합니다.');
      }));
      panel.append(button('공개 게시·갱신', async () => {
        if (changed || !preview?.snapshot) throw new Error('공개 미리보기를 먼저 갱신해 주세요.');
        if (!consent.checked) throw new Error('미리보기의 공개 내용을 확인해 주세요.');
        requireSync('publish'); const current = await storage.readPhotoPost(workspaceId, doc.id);
        if (!valid()) return;
        if (changed || !preview?.snapshot || !consent.checked) throw new Error('공개 내용이 바뀌었습니다. 미리보기를 갱신하고 공개 범위를 다시 확인해 주세요.');
        if (current.revision !== preview.revision || current.archived || current.status !== 'saved') throw new Error('글이 바뀌었습니다. 공개 내용 검토를 다시 열어 최신 글을 확인해 주세요.');
        const published = await blogSync.publish(workspaceId, doc.id, { photoIds: [...preview.photoIds], author: { ...preview.author }, copies: preview.copies, expectedLocalRevision: preview.revision,
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
    async function mount(target, { evidenceSeed = null, viewState = null, postId = null, expectedRevision = null } = {}) {
      if (disposed) throw new Error('종료한 글 관리 화면입니다.');
      if (host) { await flush(); clearPreview(); evidence?.dispose(); evidence = null; subscriptions.forEach(unsubscribe => unsubscribe?.()); subscriptions = []; }
      focusedPostId = typeof postId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(postId) ? postId : null;
      if (postId !== null && !focusedPostId) throw new Error('관리할 글의 식별자를 확인해 주세요.');
      if (expectedRevision !== null && (!focusedPostId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw new Error('관리할 글의 정확한 판을 확인해 주세요.');
      expectedInitialRevision = expectedRevision;
      host = target; epoch++; surface = el('section', null, 'blog-manager'); surface.setAttribute('aria-label', focusedPostId ? '선택한 글 관리' : '전체 글 관리');
      const header = el('div', null, 'blog-manager-toolbar');
      query = el('input'); query.id = 'blogManagerSearch'; query.type = 'search'; query.placeholder = '내 글 검색'; query.setAttribute('aria-label', '내 글 검색');
      filter = el('select'); filter.id = 'blogManagerFilter'; filter.setAttribute('aria-label', '글 상태');
      [['all', '전체 글·초안'], ['saved', '저장한 글'], ['draft', '초안'], ['archived', '보관한 글']].forEach(([value, label]) => { const option = el('option', label); option.value = value; filter.append(option); });
      query.value = typeof viewState?.query === 'string' ? viewState.query : '';
      filter.value = ['all', 'saved', 'draft', 'archived'].includes(viewState?.filter) ? viewState.filter : 'all';
      query.hidden = filter.hidden = !!focusedPostId;
      shown = Number.isSafeInteger(viewState?.shown) && viewState.shown >= 40 && viewState.shown <= 1000000 ? viewState.shown : 40;
      const search = () => { shown = 40; renderRows(); }; query.addEventListener('input', search); filter.addEventListener('change', search);
      header.append(query, filter, button('글 목록 다시 불러오기', load));
      status = meta('글을 불러오는 중입니다.'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      detail = el('div'); evidenceHost = el('div'); list = el('div', null, 'blog-manager-list'); list.setAttribute('aria-label', '내 글 목록');
      surface.append(header, status);
      if (!focusedPostId && typeof onOpenAccountBlog === 'function') {
        const account = button('글 동기화 상태', () => navigate(() => onOpenAccountBlog({ originFocusKey: 'blog:account-list' })));
        account.dataset.focusKey = 'blog:account-list'; account.id = 'blogAccountList'; surface.append(account);
      }
      if (!focusedPostId) surface.append(button('자료 인용으로 새 글 쓰기', () => chooseEvidence()));
      surface.append(detail, evidenceHost, list);
      host.replaceChildren(surface);
      if (blogSync?.subscribe) subscriptions.push(blogSync.subscribe(event => { if (event?.type === 'status' && !event.status?.running && valid()) void refreshSync(); }));
      if (storage.subscribe) subscriptions.push(storage.subscribe(workspaceId, event => { if (valid() && event.workspaceId === workspaceId && ['photo_posts_changed', 'workbench_changed'].includes(event.type)) announce('저장한 글이 바뀌었습니다. 글 목록을 다시 불러와 확인해 주세요.'); }));
      await load();
      if (evidenceSeed && valid()) await chooseEvidence(evidenceSeed);
    }
    return { mount, flush, getView, dirty: () => !!busy || !!evidence?.dirty?.(), dispose() { disposed = true; epoch++; clearPreview(); evidence?.dispose(); subscriptions.forEach(unsubscribe => unsubscribe?.()); subscriptions = []; rows = []; surface?.replaceChildren(); host = null; } };
  }
  life.BlogManager = Object.freeze({ create });
})(globalThis);
