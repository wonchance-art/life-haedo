/* Account-scoped authored-post management. Reading a list never publishes it. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  const stateLabels = { saved: '저장한 글', draft: '초안', archived: '숨긴 글' };
  const kindLabels = { photo: '블로그 글', plain: '첨부 글', source: '기록 글', 'page-draft': '첨부 글 초안', 'writing-draft': '기록 글 초안' };
  const errorText = e => e?.code === 'schema_missing' ? '서버 글 보관 기능이 아직 준비되지 않았습니다. 글은 이 브라우저에 그대로 있습니다.' : e?.message || '처리하지 못했습니다. 입력을 유지했으니 다시 시도해 주세요.';
  function create({ storage, workspaceId, auth, photoPosts, openPost, openLegacy, onOpenEvidence, onOpenAccountBlog = null, blogSync, isCurrent = () => true }) {
    let host, surface, list, status, query, filter, detail, evidenceHost, evidence, rows = [], busy = null, disposed = false, epoch = 0, preview = null;
    let subscriptions = [], urls = [], shown = 40, navigating = false, focusedPostId = null, expectedInitialRevision = null, syncStates = {};
    // Publication of each post as this device knows it ('public' | 'private' | 'unknown'), read
    // locally from BlogSync. `panelPublic` redraws an open review's own status line.
    let publicStates = {}, publicNotices = {}, panelPublic = null, refusedDelete = false, openDialog = null;
    const readPublic = async () => {
      const states = blogSync?.publicationStatuses ? await blogSync.publicationStatuses(workspaceId) : {};
      const notices = blogSync?.publicationNotices ? await blogSync.publicationNotices(workspaceId) : {};
      publicStates = states; publicNotices = notices;
    };
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
    function clearPreview() { urls.forEach(url => URL.revokeObjectURL(url)); urls = []; preview = null; panelPublic = null; detail?.replaceChildren(); }
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
      try { await readPublic(); } catch (_) { publicStates = {}; publicNotices = {}; }
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
        }); open.dataset.focusKey = focusKey; h.append(open);
        const facts = meta(`${kindLabels[row.kind]} · ${stateLabels[row.status] || row.status}`);
        // Which posts are public is visible in the list itself, hidden posts included.
        if (row.kind === 'photo') { const shownPublic = el('span', '', 'blog-manager-public'); shownPublic.dataset.publicLabel = row.id; facts.append(shownPublic); }
        article.append(h, facts);
        if (row.body) article.append(el('p', row.body.slice(0, 160), 'blog-manager-excerpt'));
        if (row.kind === 'photo') {
          const actions = el('div', null, 'blog-manager-actions');
          if (row.status !== 'archived' && storage.readPostEvidence) {
            const provenance = el('div', null, 'blog-manager-evidence'); actions.append(provenance); pendingEvidence.push(showEvidence(row, provenance));
          }
          if (row.status === 'saved') actions.append(button('공개 내용 검토', () => preparePreview(row)));
          // Withdrawal (or the check that leads to it) for every post, hidden or not: a hidden
          // public post has no review panel, and deletion requires withdrawal first.
          const publicActions = el('span', null, 'blog-manager-public-actions'); publicActions.dataset.publicActions = row.id; actions.append(publicActions);
          actions.append(button(row.status === 'archived' ? '목록에 다시 보이기' : '목록에서 숨기기', control => toggleHidden(row, control)));
          actions.append(button('삭제', () => deletePost(row)));
          const state = el('p', '', 'life-meta blog-manager-sync'); state.dataset.syncPost = row.id; showSyncState(row.id, state);
          actions.append(state);
          article.append(actions);
        }
        list.append(article);
      });
      if (!matching.length) list.append(meta(selected === 'archived' ? '숨긴 글이 없습니다.' : '조건에 맞는 글이 없습니다. 검색이나 상태를 바꿔 주세요.'));
      if (matching.length > shown) list.append(button('글 더 보기', async () => { shown += 40; renderRows(); }));
      showPublicStates();
      return Promise.all(pendingEvidence);
    }
    // ---- publication in the list (2026-11-11) ------------------------------------------
    const publicLabels = { public: '공개 중', unknown: '공개 확인 못 함' };
    // An unanswered request is named next to the status for as long as it is kept (never
    // silently): short in the list, in full in the review and 글 정보. None of these says the
    // request failed for good, because it can still arrive.
    const noticeLabels = { update_unapplied: '앞서 보낸 갱신 미반영', publish_unapplied: '앞서 보낸 게시 미반영', earlier_choice_public: '마지막 선택 미반영', copy_unverified: '공개본 확인 필요' };
    const noticeTexts = life.BlogRemote?.publicationNotes || {};
    const noteText = (code, state) => life.BlogRemote?.publicationNote ? life.BlogRemote.publicationNote(code, state) : noticeTexts[code] || '';
    const logTexts = { withdrawal_resent: noticeTexts.withdrawal_resent, withdrawal_overtaken: noticeTexts.withdrawal_overtaken };
    // A withdrawal of a post that was not public: `ended` says it ended an unanswered publish request.
    const notPublic = outcome => outcome?.ended ? '앞서 보낸 공개 게시 요청을 끝냈습니다. 이 글은 공개 중이 아닙니다.' : '이 글은 공개 중이 아닙니다.';
    const logText = log => logTexts[log?.code] ? logTexts[log.code] + (Number.isFinite(Date.parse(log.at)) ? ' (' + new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(log.at)) + ')' : '') : '';
    const postLabel = row => row.title?.trim() || '제목 없는 글';
    function showPublicStates() {
      if (!list) return;
      list.querySelectorAll('[data-public-label]').forEach(node => {
        const value = publicStates[node.dataset.publicLabel] || 'private', notice = publicNotices[node.dataset.publicLabel] || '';
        if (node.dataset.state === value && (node.dataset.notice || '') === notice) return;
        node.dataset.state = value; node.dataset.notice = notice;
        node.textContent = [publicLabels[value], noticeLabels[notice]].filter(Boolean).map(text => ' · ' + text).join('');
      });
      list.querySelectorAll('[data-public-actions]').forEach(node => {
        const id = node.dataset.publicActions, value = publicStates[id] || 'private';
        if (node.dataset.state === value) return;
        const row = rows.find(item => item.kind === 'photo' && item.id === id), had = node.contains(document.activeElement);
        node.dataset.state = value; node.replaceChildren();
        if (!row) return;
        // Named with the post: the open review has its own 공개 철회 for the post it shows.
        const named = (label, handler) => { const n = button(label, handler); n.setAttribute('aria-label', `${postLabel(row)} ${label}`); n.dataset.publicAction = label === '공개 철회' ? 'withdraw' : 'check'; return n; };
        if (value === 'public') node.append(named('공개 철회', control => withdrawRow(row, control)));
        else if (value === 'unknown' && blogSync?.settlePublication) node.append(named('공개 상태 확인', () => checkRow(row)));
        // The control that had focus was replaced: keep focus in the same row.
        if (had) (node.querySelector('button') || node.closest('.blog-post')?.querySelector('h3 button'))?.focus({ preventScroll: true });
      });
      panelPublic?.();
    }
    async function refreshPublic() {
      const token = epoch;
      try { await readPublic(); } catch (_) { return; }
      if (valid(token)) showPublicStates();
    }
    // Focus after an action redrew the list: the same post if it is still listed, else the list's own controls.
    function focusPost(id) {
      const target = [...(list?.querySelectorAll('.blog-post') || [])].find(node => node.dataset.postId === id)?.querySelector('h3 button') ||
        (filter && !filter.hidden ? filter : surface?.querySelector('button'));
      // Controls are disabled while an action runs; focus moves once they are enabled again.
      setTimeout(() => { if (valid() && target?.isConnected) target.focus({ preventScroll: true }); }, 0);
    }
    // One modal question with named choices. Escape, the backdrop and 취소 answer null. Focus
    // starts on 취소 and returns to the control that asked.
    function choose(control, { title, lines, choices }) {
      return new Promise(resolve => {
        const dialog = el('dialog', null, 'blog-manager-dialog'), heading = el('h2', title), actions = el('div', null, 'blog-manager-dialog-actions');
        heading.id = 'blogManagerDialogTitle'; dialog.setAttribute('aria-labelledby', heading.id); dialog.append(heading);
        lines.forEach(text => dialog.append(el('p', text)));
        let answer = null;
        for (const [label, value, primary] of [...choices, ['취소', null, false]]) {
          const n = el('button', label, 'life-button' + (primary ? ' life-primary' : '')); n.type = 'button';
          if (value === null) n.dataset.dialogCancel = '';
          n.addEventListener('click', () => { answer = value; dialog.close(); }); actions.append(n);
        }
        dialog.append(actions);
        dialog.addEventListener('click', event => {
          if (event.target !== dialog) return;
          const box = dialog.getBoundingClientRect();
          if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
        });
        dialog.addEventListener('close', () => {
          if (openDialog === dialog) openDialog = null;
          dialog.remove();
          // The asking control is disabled while its action runs; it takes focus again once enabled.
          if (answer === null) setTimeout(() => { if (valid() && control?.isConnected) control.focus({ preventScroll: true }); }, 0);
          resolve(valid() ? answer : null);
        }, { once: true });
        // Inside the manager, so the dialog (top layer) keeps the app's tokens and goes with the screen.
        openDialog = dialog; surface.append(dialog); dialog.showModal();
        actions.querySelector('[data-dialog-cancel]').focus({ preventScroll: true });
      });
    }
    async function checkRow(row) {
      requireSync('settlePublication');
      await blogSync.settlePublication(workspaceId, row.id);
      if (!valid()) return; await refreshPublic(); if (!valid()) return; focusPost(row.id);
      const value = publicStates[row.id] || 'private';
      announce(value === 'public' ? `“${postLabel(row)}”은 공개 중입니다.` : value === 'unknown' ? '아직 확인되지 않았습니다. 보낸 요청이 늦게 반영될 수 있어 잠시 뒤 다시 확인합니다.' : `“${postLabel(row)}”은 공개 중이 아닙니다.`);
    }
    async function withdrawRow(row, control) {
      requireSync('unpublish');
      const answer = await choose(control, { title: '공개 철회', lines: [`“${postLabel(row)}”의 공개를 철회합니다.`, '공개 주소는 더 이상 열리지 않습니다. 다시 공개하면 새 주소가 됩니다. 이 기기와 계정의 글은 그대로 있습니다.'],
        choices: [['공개 철회', 'withdraw', true]] });
      if (answer !== 'withdraw' || !valid()) return;
      const outcome = await blogSync.unpublish(workspaceId, row.id);
      if (!valid()) return;
      if (preview?.doc.id === row.id) clearPreview();
      await refreshPublic(); if (!valid()) return; focusPost(row.id);
      announce(outcome?.status === 'not_published' ? notPublic(outcome) : '공개 철회를 확인했습니다. 글은 그대로 있습니다.');
    }
    // Hiding only removes a post from the lists. A public post stays public, so the owner is
    // told and chooses; nothing is withdrawn or kept public silently.
    async function toggleHidden(row, control) {
      const hiding = row.status !== 'archived'; let withdraw = false, kept = false;
      if (hiding) {
        let value = publicStates[row.id] || 'private';
        if (value === 'unknown' && blogSync?.settlePublication) {
          try { value = (await blogSync.settlePublication(workspaceId, row.id))?.publicationStatus || value; } catch (_) { /* Asked below as not confirmed. */ }
          if (!valid()) return;
        }
        if (value === 'public') {
          const answer = await choose(control, { title: '공개 중인 글 숨기기', lines: [`“${postLabel(row)}”은 공개 중입니다. 목록에서 숨겨도 공개는 유지되고 공개 주소도 계속 열립니다.`, '공개를 끝내려면 철회해야 합니다. 숨긴 뒤에도 숨긴 글 목록에서 철회할 수 있습니다.'],
            choices: [['공개 철회 후 숨기기', 'withdraw', true], ['숨기기만', 'hide', false]] });
          if (!answer || !valid()) return;
          withdraw = answer === 'withdraw'; kept = !withdraw;
        } else if (value === 'unknown') {
          const answer = await choose(control, { title: '공개 상태를 확인하지 못한 글 숨기기', lines: [`“${postLabel(row)}”의 공개 상태를 확인하지 못했습니다. 공개 중이라면 목록에서 숨겨도 공개는 유지됩니다.`, '숨긴 뒤 숨긴 글 목록에서 공개 상태를 확인하고 철회할 수 있습니다.'],
            choices: [['숨기기만', 'hide', false]] });
          if (!answer || !valid()) return;
        }
      }
      if (withdraw) { requireSync('unpublish'); await blogSync.unpublish(workspaceId, row.id); if (!valid()) return; }
      const doc = life.PhotoPost.upgrade(await storage.readPhotoPost(workspaceId, row.id));
      if (!valid()) return; doc.archived = !doc.archived;
      await storage.savePhotoPost(workspaceId, doc, doc.revision);
      if (!valid()) return; clearPreview(); await load();
      if (!valid()) return; focusPost(row.id);
      if (withdraw) announce('공개를 철회하고 목록에서 숨겼습니다.');
      else if (kept) announce('목록에서 숨겼습니다. 공개는 유지됩니다. 숨긴 글에서 공개를 철회할 수 있습니다.');
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
    // An older page mixed with newer modules (no SyncCommon) has no blog engine until it is reloaded.
    const staleApp = () => !blogSync && !!root.HaedoLife?.BlogSync && !root.HaedoLife?.SyncCommon;
    const refreshRequired = () => Object.assign(new Error('앱을 새로고침한 뒤 다시 시도해 주세요. 글은 이 기기에 그대로 있습니다.'), { code: 'app_refresh_required' });
    function requireSync(method) {
      if (staleApp()) throw refreshRequired();
      if (!blogSync || typeof blogSync[method] !== 'function') throw Object.assign(new Error('서버 동기화를 준비하지 못했습니다. 글은 이 기기에 그대로 있습니다.'), { code: 'schema_missing' });
    }
    // Two steps (2026-11-02 decision 4): the account, never "all devices".
    const syncLabels = { synced: '계정에 올림', pending: '계정에 올리기 대기', error: '계정에 올리지 못함' };
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
      await refreshPublic();
    }
    async function deletePost(row) {
      const label = row.title?.trim() || '제목 없는 글';
      // Deleting only here would not reach the other devices (the post comes back with the next sync).
      if (staleApp()) throw refreshRequired();
      if (typeof root.confirm === 'function' && !root.confirm(`“${label}”을 삭제할까요? 로그인한 모든 기기에서 함께 삭제됩니다.`)) return;
      if (blogSync?.deletePost) await blogSync.deletePost(workspaceId, row.id, { expectedRevision: row.revision });
      else await storage.deletePhotoPost(workspaceId, row.id, row.revision);
      if (!valid()) return; clearPreview(); await load(); announce('글을 삭제했습니다. 다른 기기에서도 삭제됩니다.');
    }
    // The server refused a deletion because the post is public there (another device published
    // it and this device had not seen that yet). The post is received again: say why.
    async function explainRefusedDelete() {
      refusedDelete = false;
      if (busy) { announce('공개 중인 글이라 삭제하지 않고 다시 받았습니다. 글 목록을 다시 불러와 공개를 철회한 뒤 삭제해 주세요.'); return; }
      try { await load(); } catch (_) { /* The list keeps what it showed. */ }
      announce('공개 중인 글이라 서버에서 삭제하지 않았고, 이 기기로 다시 받았습니다. 공개를 철회한 뒤 삭제해 주세요.');
    }
    // The state of one post for its review: an unknown result is settled with one exact server
    // check first, so the review compares against what is really public.
    async function reviewState(id) {
      if (!blogSync?.getState) return null;
      let state = await blogSync.getState(workspaceId, id);
      if (state?.publicationStatus === 'unknown' && blogSync.settlePublication) {
        try { state = await blogSync.settlePublication(workspaceId, id); } catch (_) { /* Shown as not confirmed; publishing and withdrawing ask the server again. */ }
      }
      return state;
    }
    async function preparePreview(row) {
      const doc = await storage.readPhotoPost(workspaceId, row.id);
      if (!valid()) return;
      if (doc.status !== 'saved' || doc.archived) throw new Error('숨기지 않은 저장 글만 공개할 수 있습니다. 목록을 다시 확인해 주세요.');
      if (!life.Blog?.publicSnapshot || !life.BlogPublicUI?.render) throw new Error('공개 미리보기 기능을 불러오지 못했습니다. 다시 진입해 주세요.');
      let capturedState = null;
      try { capturedState = await reviewState(row.id); } catch (_) { /* Preview remains local; publication still requires a working server. */ }
      if (!valid()) return;
      // The account's current public name and intro (one profile for the whole public list;
      // every publish request replaces it). `profile` null: this engine cannot read it.
      let profile = null, profileFailed = false;
      const readProfile = async () => {
        if (!blogSync?.publicProfile) return;
        try { profile = await blogSync.publicProfile(workspaceId); profileFailed = false; } catch (_) { profile = null; profileFailed = true; }
      };
      await readProfile();
      if (!valid()) return;
      clearPreview();
      let remoteRevision = capturedState?.remoteRevision || 0, publicRevision = capturedState?.publication?.revision || 0;
      preview = { doc, photoIds: [], snapshot: null, revision: doc.revision, remoteRevision, publicRevision };
      // D1 (soft redesign): the review reads as one 공개하기 sheet; its steps and checks are unchanged.
      const panel = el('section', null, 'blog-manager-preview'); panel.setAttribute('aria-label', '공개하기');
      // The title, the whole body and every attachment are published; only photos are chosen.
      panel.append(el('h3', '공개하기'), meta('제목, 본문 전체와 모든 첨부를 공개합니다. 사진은 아래에서 고른 것만 공개하고, 고르지 않은 사진은 공개 본문에서도 빠집니다.'));
      // What is public now, from this device's record of the server (settled above when unknown).
      const currentLine = el('p', '', 'life-meta blog-manager-current'); panel.append(currentLine);
      let panelState = capturedState;
      // Set once the preview controls exist: ends a preview that is not what became public.
      let dropPreview = null;
      const showCurrent = () => {
        const value = panelState?.publicationStatus || (panelState?.publication?.active ? 'public' : panelState ? 'private' : 'unknown');
        const had = currentLine.contains(document.activeElement);
        currentLine.dataset.publication = value;
        currentLine.replaceChildren(document.createTextNode('현재 공개 상태: ' + (value === 'public' ? '공개 중' : value === 'private' ? '비공개' : '확인하지 못함')));
        if (value === 'public' && panelState.publication?.token) {
          let address = null; try { address = new URL('blog.html?post=' + encodeURIComponent(panelState.publication.token), location.href); } catch (_) { /* No link. */ }
          if (address) { const link = el('a', '공개 중인 글 열기'); link.href = address.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; currentLine.append(document.createTextNode(' · '), link); }
        } else if (value === 'unknown' && blogSync?.settlePublication) {
          currentLine.append(document.createTextNode(' · 이 기기에서 보낸 게시나 철회의 결과를 받지 못했습니다. '), button('공개 상태 확인', async () => {
            const state = await blogSync.settlePublication(workspaceId, doc.id);
            if (!valid() || preview?.doc.id !== doc.id) return;
            panelState = state; showCurrent(); await refreshPublic();
            announce(state?.publicationStatus === 'public' ? '이 글은 공개 중입니다. 공개 미리보기를 갱신하면 현재 공개본을 기준으로 다시 게시할 수 있습니다.' : state?.publicationStatus === 'unknown' ? '아직 확인되지 않았습니다. 보낸 요청이 늦게 반영될 수 있어 잠시 뒤 다시 확인합니다.' : '이 글은 공개 중이 아닙니다.');
          }));
        }
        const notice = panelState?.publicationNotice || (value === 'private' && panelState?.publishPending ? 'publish_unapplied' : value === 'public' && panelState?.publishPending ? 'update_unapplied' : '');
        currentLine.dataset.notice = notice || '';
        if (noticeTexts[notice]) currentLine.append(el('span', ' · ' + noteText(notice, panelState), 'blog-manager-current-notice'));
        // The last choice was not sent and an earlier one is public: a preview made before that is over.
        if (notice === 'earlier_choice_public' && preview?.snapshot && preview.publicRevision !== (panelState.publication?.revision || 0)) dropPreview?.();
        // The owner ends a publish request that is not applied: the server then refuses it for
        // good and this notice ends. An update of a public post is not ended this way.
        if (notice === 'publish_unapplied' && blogSync?.cancelPublish) currentLine.append(document.createTextNode(' '), button('게시 요청 취소', async () => {
          let outcome;
          try { outcome = await blogSync.cancelPublish(workspaceId, doc.id); }
          catch (failure) { if (valid()) { await syncPanel(); await refreshPublic(); } throw failure; }
          if (!valid() || preview?.doc.id !== doc.id) return;
          await syncPanel(); await refreshPublic(); if (!valid()) return;
          announce(outcome?.status === 'cancelled' ? '앞서 보낸 게시 요청을 취소했습니다. 이 글은 공개 중이 아닙니다.' : outcome?.status === 'published' ? '그 게시 요청은 이미 반영되어 공개 중입니다. 취소하지 않았습니다.' : '취소하지 않았습니다. 공개 상태를 확인해 주세요.');
        }));
        if (logText(panelState?.publicationLog)) currentLine.append(el('span', ' · ' + logText(panelState.publicationLog), 'blog-manager-current-log'));
        if (had) (currentLine.querySelector('button,a') || panel.querySelector('input'))?.focus({ preventScroll: true });
      };
      const syncPanel = async () => {
        if (!blogSync?.getState) return;
        try { const state = await blogSync.getState(workspaceId, doc.id); if (valid() && preview?.doc.id === doc.id) { panelState = state; showCurrent(); } } catch (_) { /* The line keeps what it showed. */ }
      };
      panelPublic = () => { if (!busy) void syncPanel(); };
      showCurrent();
      const footer = el('div', null, 'blog-manager-publish-actions');
      const authorLabel = el('label', '공개 이름'), author = el('input'); author.type = 'text'; author.maxLength = 100; author.setAttribute('aria-label', '공개 이름'); authorLabel.append(author); panel.append(authorLabel);
      const introLabel = el('label', '공개 소개'), intro = el('textarea'); intro.maxLength = 500; intro.rows = 2; intro.setAttribute('aria-label', '공개 소개'); introLabel.append(intro); panel.append(introLabel);
      // The review starts from the current values, so an update does not blank them.
      const profileNote = el('p', '', 'life-meta blog-manager-profile'); panel.append(profileNote);
      // A value the owner typed in this review is never replaced by a later read.
      const typed = new Set();
      author.addEventListener('input', () => typed.add(author)); intro.addEventListener('input', () => typed.add(intro));
      const showProfile = fill => {
        if (fill && profile) { if (!typed.has(author)) author.value = profile.author.name; if (!typed.has(intro)) intro.value = profile.author.intro; }
        profileNote.dataset.state = profileFailed ? 'failed' : profile?.remembered ? 'remembered' : profile ? 'ready' : 'unavailable';
        profileNote.replaceChildren(document.createTextNode('공개 이름과 소개는 이 글에만 쓰이지 않습니다. 공개 글 목록 맨 위에 표시되며, 여기서 바꾸면 공개한 모든 글의 목록에서 함께 바뀝니다.' +
          (profile?.visible ? ` 지금 공개 글 ${profile.posts}개의 목록에 표시 중인 값을 채웠습니다.`
            // Nothing is public, so the server shows no name or intro to read back.
            : profile?.remembered ? ' 지금 공개 중인 글이 없어 서버의 값을 읽을 수 없습니다. 이 기기에서 마지막으로 게시한 이름과 소개를 채웠으니 확인해 주세요.' : '')));
        if (profileFailed) {
          const failed = el('span', ' 현재 공개 이름과 소개를 읽지 못했습니다. 읽기 전에는 게시하지 않습니다(빈칸으로 게시하면 목록의 이름과 소개가 지워집니다). ', 'blog-manager-profile-error'); failed.setAttribute('role', 'alert');
          profileNote.append(failed, button('공개 이름·소개 다시 읽기', async () => {
            await readProfile(); if (!valid() || preview?.doc.id !== doc.id) return;
            const kept = typed.size > 0;
            showProfile(!!profile); if (profile) invalidate();
            announce(!profile ? '공개 이름과 소개를 읽지 못했습니다. 연결을 확인한 뒤 다시 읽어 주세요.'
              : kept ? '현재 공개 이름과 소개를 읽었습니다. 직접 입력한 칸은 그대로 두었습니다. 미리보기를 갱신해 확인해 주세요.' : '현재 공개 이름과 소개를 읽었습니다. 미리보기를 갱신해 확인해 주세요.');
          }));
        }
      };
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
      dropPreview = () => { changed = true; consent.checked = false; preview.snapshot = null; result.replaceChildren(meta('이 미리보기는 게시되지 않았습니다. 미리보기를 갱신해 현재 공개 상태를 확인해 주세요.')); };
      author.addEventListener('input', invalidate); intro.addEventListener('input', invalidate); selected.forEach(check => check.addEventListener('change', invalidate));
      showProfile(true);
      footer.append(button('공개 미리보기 갱신', async () => {
        if (!valid() || preview?.doc.id !== doc.id) return;
        if (blogSync?.getState) {
          const state = await reviewState(doc.id);
          if (!valid() || preview?.doc.id !== doc.id) return;
          remoteRevision = state?.remoteRevision || 0; publicRevision = state?.publication?.revision || 0;
          panelState = state; showCurrent();
        }
        const photoIds = [...selected].filter(([, check]) => check.checked).map(([id]) => id);
        const included = doc.photos.filter(p => photoIds.includes(p.id));
        if (included.some(p => !copies.has(p.id))) announce('공개할 사진의 사본을 만드는 중입니다.');
        for (const p of included) {
          if (!copies.has(p.id)) copies.set(p.id, await life.PhotoPost.publicCopy(p));
          if (!valid() || preview?.doc.id !== doc.id) return;
        }
        const shown = included.map(p => copies.get(p.id)), uploaded = shown;
        const snapshot = await life.Blog.publicSnapshot(doc, { photoIds, author: { name: author.value, intro: intro.value }, copies: uploaded });
        if (!valid() || preview?.doc.id !== doc.id) return;
        urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
        // The preview shows the exact bytes that become public.
        const photoUrls = new Map();
        snapshot.photos.forEach((p, index) => { const url = URL.createObjectURL(shown[index].blob); urls.push(url); photoUrls.set(p.id, url); });
        // The head of the public post list changes with this request too: shown with the post.
        const head = el('div', null, 'blog-manager-list-head'), name = author.value.trim();
        head.append(meta('공개 글 목록 맨 위에 표시'), el('p', name ? name + '의 블로그' : '공개 글', 'blog-manager-list-title'));
        if (intro.value.trim()) head.append(el('p', intro.value, 'blog-manager-list-intro'));
        else head.append(meta('소개 없음'));
        result.replaceChildren(head, meta('이 글의 공개 화면'), life.BlogPublicUI.render(snapshot, { document, photoUrl: p => photoUrls.get(p.id) || null, allowOriginal: true }));
        preview = { doc, revision: doc.revision, remoteRevision, publicRevision, snapshot, photoIds, copies: uploaded, author: { name: author.value, intro: intro.value } }; changed = false; consent.checked = false;
        announce('이 미리보기와 같은 본문·선택 사진으로 공개합니다.');
      }));
      footer.append(button('공개 게시·갱신', async () => {
        if (changed || !preview?.snapshot) throw new Error('공개 미리보기를 먼저 갱신해 주세요.');
        if (!consent.checked) throw new Error('미리보기의 공개 내용을 확인해 주세요.');
        requireSync('publish'); const current = await storage.readPhotoPost(workspaceId, doc.id);
        if (!valid()) return;
        if (changed || !preview?.snapshot || !consent.checked) throw new Error('공개 내용이 바뀌었습니다. 미리보기를 갱신하고 공개 범위를 다시 확인해 주세요.');
        if (current.revision !== preview.revision || current.archived || current.status !== 'saved') throw new Error('글이 바뀌었습니다. 공개 내용 검토를 다시 열어 최신 글을 확인해 주세요.');
        // Every publish request replaces the account's public name and intro: never with values
        // the review could not start from.
        if (profileFailed) throw new Error('현재 공개 이름과 소개를 읽지 못해 게시하지 않았습니다. 공개 이름·소개 다시 읽기를 누른 뒤 게시해 주세요.');
        let published;
        try {
          published = await blogSync.publish(workspaceId, doc.id, { photoIds: [...preview.photoIds], author: { ...preview.author }, copies: preview.copies, expectedLocalRevision: preview.revision,
            expectedRemoteRevision: preview.remoteRevision, expectedPublicRevision: preview.publicRevision });
        } catch (failure) {
          if (!valid()) return;
          await syncPanel(); await refreshPublic();
          if (!valid()) return;
          if (failure?.code === 'local_changed') {
            // The server's publication or the post is no longer what this preview was made from.
            preview.snapshot = null; changed = true; consent.checked = false;
            throw new Error('글이나 공개 상태가 이 미리보기와 달라졌습니다. 공개 미리보기를 갱신해 현재 상태를 확인한 뒤 다시 게시해 주세요.');
          }
          if (failure?.code === 'blog_conflict') {
            // This request was not applied: what is public is not this preview. The preview and the
            // consent end here, and the cause and the public copy are said as the server shows them.
            preview.snapshot = null; changed = true; consent.checked = false;
            result.replaceChildren(meta('이 미리보기는 게시되지 않았습니다. 미리보기를 갱신해 현재 공개 상태를 확인해 주세요.'));
            const copy = failure.publicCopy, photos = copy && Number.isSafeInteger(copy.photos) ? ` 지금 공개 중인 사본에는 사진이 ${copy.photos}장 있습니다.` : copy ? ' 다른 내용이 공개 중입니다.' : ' 지금 공개 중인 사본은 없습니다.';
            throw new Error((failure.ownRequest ? '이 기기에서 앞서 보낸 게시 요청이 먼저 반영되어 이 게시는 적용하지 못했습니다.' : '공개 내용이 그사이 다른 요청으로 바뀌어 이 게시는 적용하지 못했습니다.') + photos +
              ' 미리보기를 갱신한 뒤 다시 게시하거나 철회해 주세요.');
          }
          throw failure;
        }
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
          panelState = state; showCurrent(); await refreshPublic();
          if (!valid()) return;
        } catch (_) {
          if (!valid()) return;
          preview.snapshot = null; changed = true; consent.checked = false;
          announce('공개 게시와 주소는 확인했습니다. 후속 상태 조회에 실패했으니 공개 검토를 다시 열어 확인해 주세요.'); return;
        }
        announce('공개 게시를 확인했습니다. 같은 글의 갱신은 이 주소를 유지합니다.');
      }, true));
      footer.append(button('공개 철회', async () => {
        requireSync('unpublish');
        // Withdrawing follows the server's current publication, not the revision this panel last
        // saw: the owner wants the post not public, whichever revision is public now.
        let outcome;
        try { outcome = await blogSync.unpublish(workspaceId, doc.id); }
        catch (failure) { if (valid()) { await syncPanel(); await refreshPublic(); } throw failure; }
        if (!valid()) return;
        // The next publication is a new one: it is reviewed again against the withdrawn state.
        preview.snapshot = null; changed = true; consent.checked = false;
        try {
          const state = await blogSync.getState(workspaceId, doc.id);
          if (!valid()) return;
          remoteRevision = state?.remoteRevision || 0; publicRevision = state?.publication?.revision || 0;
          preview.remoteRevision = remoteRevision; preview.publicRevision = publicRevision; panelState = state; showCurrent();
        } catch (_) { if (!valid()) return; }
        await refreshPublic(); if (!valid()) return;
        if (outcome?.status === 'not_published') { result.replaceChildren(meta(outcome.ended ? notPublic(outcome) : '이 글은 공개 중이 아닙니다. 철회할 공개본이 없습니다.')); announce(notPublic(outcome)); return; }
        result.replaceChildren(meta('공개 철회를 확인했습니다. 이 브라우저의 원래 글은 유지했습니다.')); announce('공개 철회를 확인했습니다.');
      }));
      footer.append(button('공개 검토 닫기', async () => clearPreview())); panel.append(footer); detail.append(panel); panel.querySelector('input')?.focus({ preventScroll: true });
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
      if (host) { await flush(); clearPreview(); openDialog?.close(); evidence?.dispose(); evidence = null; subscriptions.forEach(unsubscribe => unsubscribe?.()); subscriptions = []; }
      focusedPostId = typeof postId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(postId) ? postId : null;
      if (postId !== null && !focusedPostId) throw new Error('관리할 글의 식별자를 확인해 주세요.');
      if (expectedRevision !== null && (!focusedPostId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw new Error('관리할 글의 정확한 판을 확인해 주세요.');
      expectedInitialRevision = expectedRevision;
      host = target; epoch++; surface = el('section', null, 'blog-manager'); surface.setAttribute('aria-label', focusedPostId ? '선택한 글 관리' : '전체 글 관리');
      const header = el('div', null, 'blog-manager-toolbar');
      query = el('input'); query.id = 'blogManagerSearch'; query.type = 'search'; query.placeholder = '내 글 검색'; query.setAttribute('aria-label', '내 글 검색');
      filter = el('select'); filter.id = 'blogManagerFilter'; filter.setAttribute('aria-label', '글 상태');
      [['all', '전체 글·초안'], ['saved', '저장한 글'], ['draft', '초안'], ['archived', '숨긴 글']].forEach(([value, label]) => { const option = el('option', label); option.value = value; filter.append(option); });
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
        const account = button('계정 보관 상태', () => navigate(() => onOpenAccountBlog({ originFocusKey: 'blog:account-list' })));
        account.dataset.focusKey = 'blog:account-list'; account.id = 'blogAccountList'; surface.append(account);
      }
      if (!focusedPostId) surface.append(button('자료 인용으로 새 글 쓰기', () => chooseEvidence()));
      surface.append(detail, evidenceHost, list);
      host.replaceChildren(surface);
      if (blogSync?.subscribe) subscriptions.push(blogSync.subscribe(event => {
        if (!valid()) return;
        if (event?.type === 'status') { if (!event.status?.running) void refreshSync(); }
        else if (event?.type === 'delete_refused') { if (event.workspaceId === workspaceId) refusedDelete = true; }
        else if (event?.type === 'publication_notice') {
          const said = logTexts[event.code] || (event.code === 'earlier_choice_public' ? noticeTexts.earlier_choice_public : '');
          if (event.workspaceId !== workspaceId || !said) return;
          const row = rows.find(item => item.kind === 'photo' && item.id === event.localPostId);
          if (!busy) announce((row ? `“${postLabel(row)}”: ` : '') + said);
          void refreshPublic();
        }
        // One post's connection state changed (a settled publication included).
        else if (event?.workspaceId === workspaceId && event.localPostId) void refreshPublic();
      }));
      if (storage.subscribe) subscriptions.push(storage.subscribe(workspaceId, event => {
        if (!valid() || event.workspaceId !== workspaceId || !['photo_posts_changed', 'workbench_changed'].includes(event.type)) return;
        if (refusedDelete && event.type === 'photo_posts_changed') { void explainRefusedDelete(); return; }
        announce('저장한 글이 바뀌었습니다. 글 목록을 다시 불러와 확인해 주세요.');
      }));
      await load();
      if (evidenceSeed && valid()) await chooseEvidence(evidenceSeed);
    }
    return { mount, flush, getView, dirty: () => !!busy || !!evidence?.dirty?.(), dispose() { disposed = true; epoch++; clearPreview(); openDialog?.close(); evidence?.dispose(); subscriptions.forEach(unsubscribe => unsubscribe?.()); subscriptions = []; rows = []; surface?.replaceChildren(); host = null; } };
  }
  life.BlogManager = Object.freeze({ create });
})(globalThis);
