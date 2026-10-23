/* Virtual source folders. The folder graph is independent of source versions,
 * excerpts and original paths; all writes remain explicit and revision checked. */
(function (root) {
  'use strict';
  const copy = value => structuredClone(value);
  const uiFault = message => Object.assign(new Error(message), { code: 'source_folders_ui' });
  function create({ document = root.document, storage, getBundle, announce = () => {}, onChange = () => {}, isCurrent = () => true }) {
    const model = () => root.HaedoLife.SourceFolders;
    const slots = new Map(), mounts = new Set();
    let disposed = false, epoch = 0, workspaceId = null, slot = null, unsubscribe = null;
    const el = (tag, text, cls) => { const value = document.createElement(tag); if (text != null) value.textContent = text; if (cls) value.className = cls; return value; };
    const owns = (token, owner) => !disposed && token === epoch && owner === slot && owner?.workspaceId === workspaceId && getBundle()?.workspaceId === workspaceId;
    const live = (token, owner, element) => owns(token, owner) && isCurrent() && (!element || element.isConnected);
    function errorText(error) {
      if (/^source_folders_/.test(error?.code || '')) return error.message;
      if (/scope|account|workspace/.test(error?.code || '')) return '계정 또는 작업공간이 바뀌었습니다. 현재 자료실에서 다시 확인하세요.';
      return '폴더를 보관하지 못했습니다. 입력은 유지됩니다. 다시 시도하거나 최신 폴더를 확인하세요.';
    }
    function nodeButton(label, id, action, token, owner, cls = 'life-button sf-button') {
      const button = el('button', label, cls); button.type = 'button'; if (id) button.id = id;
      button.addEventListener('click', () => {
        if (!live(token, owner, button)) return;
        Promise.resolve().then(() => { if (live(token, owner, button)) return action(); }).catch(error => { if (owns(token, owner)) { owner.error = errorText(error); updateMounts(); } });
      }); return button;
    }
    function ensureScope() {
      if (disposed) return null;
      const next = getBundle()?.workspaceId;
      if (!next) return null;
      if (next !== workspaceId) {
        unsubscribe?.(); unsubscribe = null; epoch++; workspaceId = next;
        slot = slots.get(next);
        if (!slot) {
          slot = { workspaceId: next, snapshot: null, pending: null, writing: null, maxRevision: 0, stale: false, error: '', message: '', manageOpen: false,
            editor: { id: 'new', name: '', parentId: '', version: 0, composing: false, compositionEnded: 0 }, confirm: null };
          slots.set(next, slot);
        }
        const token = epoch, owner = slot;
        unsubscribe = storage.subscribe(next, event => {
          if (!owns(token, owner) || event.type !== 'source_folders_changed' || !Number.isSafeInteger(event.revision)) return;
          owner.maxRevision = Math.max(owner.maxRevision, event.revision);
          if (owner.snapshot && event.revision > owner.snapshot.sourceFolders.revision && !owner.writing) {
            owner.stale = true; owner.message = '다른 탭에서 폴더가 바뀌었습니다. 최신 폴더를 확인하세요.'; updateMounts();
          }
        });
        for (const mount of [...mounts]) if (mount.owner !== owner || !mount.host.isConnected) releaseMount(mount);
        if (!owner.snapshot && !owner.pending) load(owner, token).catch(() => {});
      }
      return slot;
    }
    function emit(reason) {
      if (!slot?.snapshot || !owns(epoch, slot)) return;
      try { onChange(copy(slot.snapshot), { reason }); } catch (_) { /* The saved graph remains authoritative. */ }
    }
    function list() { return slot?.snapshot ? model().list(slot.snapshot.sourceFolders) : []; }
    function editorDirty(owner = slot) {
      const editor = owner?.editor; if (!editor) return false;
      const folder = owner.snapshot?.sourceFolders.folders.find(item => item.id === editor.id);
      return editor.id === 'new' ? !!editor.name || !!editor.parentId : !folder || editor.name !== folder.name || editor.parentId !== (folder.parentId || '');
    }
    function folderOptions(select, rows, selected, first) {
      select.replaceChildren();
      for (const [value, label] of first) { const option = el('option', label); option.value = value; select.append(option); }
      for (const row of rows) { const option = el('option', row.label); option.value = row.id; select.append(option); }
      if (selected && !Array.from(select.options).some(option => option.value === selected)) { const missing = el('option', '선택한 폴더 없음'); missing.value = selected; select.append(missing); }
      select.value = selected;
    }
    function parentOptions() {
      const rows = list(), selected = slot.editor.id, descendants = new Set();
      if (selected !== 'new') {
        descendants.add(selected);
        for (let changed = true; changed;) { changed = false; for (const row of rows) if (descendants.has(row.parentId) && !descendants.has(row.id)) { descendants.add(row.id); changed = true; } }
      }
      const own = rows.find(row => row.id === selected), height = own ? Math.max(1, ...rows.filter(row => descendants.has(row.id)).map(row => row.depth - own.depth + 1)) : 1;
      return rows.filter(row => !descendants.has(row.id) && row.depth + height <= model().LIMITS.depth);
    }
    function setEditor(id) {
      const folder = slot.snapshot?.sourceFolders.folders.find(item => item.id === id);
      slot.editor = { id: folder ? folder.id : 'new', name: folder?.name || '', parentId: folder?.parentId || '', version: slot.editor.version + 1, composing: false, compositionEnded: 0 };
      slot.confirm = null; slot.error = ''; updateMounts(true);
    }
    function unavailableCount() {
      if (!slot.snapshot) return 0;
      if (slot.unavailableSnapshot === slot.snapshot) return slot.unavailableCount;
      const available = new Set(slot.snapshot.bundle.sources.map(source => source.id));
      slot.unavailableSnapshot = slot.snapshot;
      slot.unavailableCount = slot.snapshot.sourceFolders.assignments.filter(item => !available.has(item.sourceId)).length;
      return slot.unavailableCount;
    }
    function mountStatus(mount) {
      if (mount.released || mount.owner !== slot || !mount.element.isConnected) return;
      const owner = slot, loaded = !!owner.snapshot;
      mount.element.setAttribute('aria-busy', String(!!owner.pending || !!owner.writing));
      mount.filter.disabled = !loaded || !!owner.pending;
      mount.status.textContent = owner.pending ? '폴더를 확인하고 있습니다.' : owner.writing ? '폴더 보관 중' : owner.message;
      mount.status.hidden = !mount.status.textContent;
      mount.error.textContent = owner.error; mount.error.hidden = !owner.error;
      mount.reload.hidden = !owner.error && !owner.stale;
      mount.save.disabled = !loaded || !!owner.pending || !!owner.writing;
      mount.edit.disabled = !loaded || !!owner.pending || !!owner.writing;
      mount.remove.hidden = owner.editor.id === 'new';
      const children = loaded && owner.snapshot.sourceFolders.folders.some(folder => folder.parentId === owner.editor.id);
      mount.remove.disabled = !loaded || children || !!owner.pending || !!owner.writing;
      mount.children.hidden = !children; mount.remove.title = children ? '하위 폴더를 먼저 이동하세요.' : '폴더만 삭제';
      const unavailable = unavailableCount(); mount.unavailable.hidden = !unavailable;
      mount.unavailable.textContent = unavailable ? '현재 자료실에서 확인되지 않는 자료 연결 ' + unavailable + '개를 유지하고 있습니다.' : '';
      mount.confirm.hidden = !owner.confirm;
    }
    function updateMount(mount, graph = false) {
      if (mount.released || mount.owner !== slot || !owns(mount.token, mount.owner)) return;
      if (graph || !mount.initialized) {
        const rows = list();
        folderOptions(mount.filter, rows, mount.filterValue, [['all', '모든 폴더'], ['unfiled', '미분류']]);
        folderOptions(mount.edit, rows, slot.editor.id, [['new', '새 폴더']]);
        folderOptions(mount.parent, parentOptions(), slot.editor.parentId, [['', '최상위']]);
        if (mount.name.value !== slot.editor.name) mount.name.value = slot.editor.name;
        mount.initialized = true;
      }
      mountStatus(mount);
    }
    function updateMounts(graph = false) {
      for (const mount of [...mounts]) {
        if (mount.released || mount.owner !== slot || mount.initialized && !mount.host.isConnected) releaseMount(mount);
        else updateMount(mount, graph);
      }
    }
    async function load(owner, token) {
      if (!owns(token, owner)) throw uiFault('현재 작업공간에서 폴더를 다시 확인하세요.');
      if (owner.pending) return owner.pending;
      if (owner.writing) throw uiFault('폴더 보관이 끝난 뒤 최신 내용을 확인하세요.');
      const scope = owner.workspaceId, hadSnapshot = !!owner.snapshot, wasDirty = editorDirty(owner), editVersion = owner.editor.version;
      const promise = Promise.resolve().then(async () => {
        try {
          const snapshot = await storage.readSourceFoldersSnapshot(scope);
          if (!owns(token, owner)) return null;
          if (snapshot.bundle.workspaceId !== scope || snapshot.sourceFolders.workspaceId !== scope) throw uiFault('폴더와 자료실의 작업공간이 다릅니다.');
          model().validate(snapshot.sourceFolders); owner.snapshot = copy(snapshot); owner.error = '';
          if (!wasDirty && owner.editor.version === editVersion) {
            const folder = snapshot.sourceFolders.folders.find(item => item.id === owner.editor.id);
            owner.editor.id = folder?.id || 'new'; owner.editor.name = folder?.name || ''; owner.editor.parentId = folder?.parentId || '';
          }
          owner.stale = owner.maxRevision > snapshot.sourceFolders.revision; owner.confirm = null;
          owner.message = owner.stale ? '다른 탭의 변경이 남아 있습니다. 최신 폴더를 다시 확인하세요.' : hadSnapshot ? '최신 폴더를 확인했습니다.' : '';
          updateMounts(true); emit('ready'); return copy(snapshot);
        } catch (error) { if (owns(token, owner)) { owner.error = errorText(error); updateMounts(); } throw error; }
        finally { if (owner.pending === promise) owner.pending = null; if (owns(token, owner)) updateMounts(); }
      });
      owner.pending = promise; updateMounts(); return promise;
    }
    async function saveMutation(mutate, success) {
      const owner = ensureScope(), token = epoch;
      if (!owner?.snapshot || owner.pending) throw uiFault('폴더를 먼저 확인하세요.');
      if (owner.writing) throw uiFault('현재 폴더 보관이 끝난 뒤 다시 시도하세요.');
      const previous = copy(owner.snapshot.sourceFolders), next = mutate(previous), scope = owner.workspaceId;
      const promise = Promise.resolve().then(async () => {
        try {
          const saved = await storage.saveSourceFolders(scope, next, previous.revision);
          if (!owns(token, owner)) return null;
          model().validate(saved); owner.snapshot = { bundle: owner.snapshot.bundle, sourceFolders: copy(saved) };
          owner.error = ''; owner.stale = owner.maxRevision > saved.revision;
          owner.message = owner.stale ? '다른 탭에서 폴더가 다시 바뀌었습니다. 최신 폴더를 확인하세요.' : success;
          updateMounts(true); emit('saved'); announce(success); return copy(saved);
        } catch (error) {
          if (owns(token, owner)) { owner.error = errorText(error); if (/conflict/.test(error?.code || '')) owner.stale = true; updateMounts(); }
          throw error;
        } finally { if (owner.writing === promise) owner.writing = null; if (owns(token, owner)) updateMounts(); }
      });
      owner.writing = promise; updateMounts(); return promise;
    }
    function mountList(host, { filter = 'all', onFilter = () => {} } = {}) {
      const owner = ensureScope(); if (!owner) throw uiFault('자료실을 연 뒤 폴더를 확인하세요.');
      const token = epoch;
      for (const previous of [...mounts]) releaseMount(previous);
      const element = el('section', null, 'source-folders'); element.setAttribute('aria-label', '자료 폴더');
      const bar = el('div', null, 'sf-filter-row'), filterLabel = el('label', null, 'sf-filter-label'), select = el('select'); select.id = 'lifeFolderFilter';
      select.setAttribute('aria-label', '자료 폴더, 상위 폴더를 선택하면 하위 폴더 포함'); filterLabel.append(select); bar.append(filterLabel); element.append(bar);
      const details = el('details', null, 'sf-manage'); details.id = 'lifeFolderManage'; details.open = owner.manageOpen;
      details.append(el('summary', '폴더 관리')); element.append(details);
      const status = el('p', '', 'life-meta sf-status'); status.id = 'lifeFolderStatus'; status.setAttribute('role', 'status'); status.hidden = true;
      const error = el('p', '', 'life-error sf-error'); error.id = 'lifeFolderError'; error.setAttribute('role', 'alert'); error.hidden = true;
      const reload = nodeButton('최신 폴더 확인', 'lifeFolderReload', () => load(owner, token), token, owner); reload.hidden = true;
      element.append(status, error, reload);
      const form = el('form', null, 'sf-editor');
      const editLabel = el('label', '편집할 폴더', 'life-field'), edit = el('select'); edit.id = 'lifeFolderEdit'; editLabel.append(edit);
      const nameLabel = el('label', '이름', 'life-field'), name = el('input'); name.id = 'lifeFolderName'; name.type = 'text'; name.maxLength = model().LIMITS.name; name.autocomplete = 'off'; nameLabel.append(name);
      const parentLabel = el('label', '상위 폴더', 'life-field'), parent = el('select'); parent.id = 'lifeFolderParent'; parentLabel.append(parent);
      const save = el('button', '보관', 'life-button sf-button'); save.id = 'lifeFolderSave'; save.type = 'submit';
      const cancel = nodeButton('입력 취소', 'lifeFolderCancel', () => setEditor(owner.editor.id), token, owner);
      const remove = nodeButton('폴더 삭제', 'lifeFolderDelete', () => {
        const folder = owner.snapshot.sourceFolders.folders.find(item => item.id === owner.editor.id); if (!folder) return;
        owner.confirm = { id: folder.id, revision: owner.snapshot.sourceFolders.revision, editorVersion: owner.editor.version };
        confirmText.textContent = '‘' + folder.name + '’ 폴더만 삭제합니다. 자료는 미분류로 남습니다.'; updateMounts();
      }, token, owner);
      const actions = el('div', null, 'sf-actions'); actions.append(save, cancel, remove);
      const children = el('p', '하위 폴더를 먼저 이동한 뒤 삭제하세요.', 'life-meta'); children.id = 'lifeFolderChildren'; children.hidden = true; remove.setAttribute('aria-describedby', children.id);
      const confirm = el('div', null, 'sf-delete-confirm'); confirm.id = 'lifeFolderDeleteConfirm'; confirm.hidden = true;
      const confirmText = el('p');
      confirm.append(confirmText, nodeButton('폴더만 삭제', 'lifeFolderDeleteApply', async () => {
        const target = copy(owner.confirm); if (!target) return;
        if (target.revision !== owner.snapshot.sourceFolders.revision || target.editorVersion !== owner.editor.version) throw uiFault('폴더 내용이 바뀌었습니다. 삭제할 폴더를 다시 확인하세요.');
        const saved = await saveMutation(state => model().removeFolder(state, target.id), '폴더를 삭제했습니다. 자료는 미분류로 남았습니다.');
        if (!saved || !owns(token, owner)) return;
        setEditor('new');
        for (const mount of mounts) if (mount.owner === owner && mount.filterValue === target.id) { mount.filterValue = 'unfiled'; mount.onFilter('unfiled'); updateMount(mount, true); }
      }, token, owner), nodeButton('취소', 'lifeFolderDeleteCancel', () => { owner.confirm = null; updateMounts(); }, token, owner));
      const unavailable = el('p', '', 'life-meta'); unavailable.id = 'lifeFolderUnavailable'; unavailable.hidden = true;
      form.append(editLabel, nameLabel, parentLabel, actions, children, confirm); details.append(form, unavailable, el('p', '이 브라우저의 자료 폴더입니다. 원본 경로·본문·묶음은 바꾸지 않습니다.', 'life-meta'));
      const mount = { owner, token, host, element, filter: select, filterValue: filter, onFilter, edit, name, parent, save, remove, children, confirm, unavailable, status, error, reload, initialized: false, released: false };
      mounts.add(mount); host.append(element); updateMount(mount, true);
      const fieldLive = target => live(token, owner, target) && element.contains(target);
      select.addEventListener('change', () => { if (!fieldLive(select)) return; mount.filterValue = select.value; onFilter(select.value); });
      details.addEventListener('toggle', () => { if (fieldLive(details)) owner.manageOpen = details.open; });
      edit.addEventListener('change', () => {
        if (!fieldLive(edit)) return;
        if (editorDirty(owner)) { edit.value = owner.editor.id; owner.error = '입력한 이름·상위 폴더를 보관하거나 취소한 뒤 다른 폴더를 선택하세요.'; updateMounts(); return; }
        setEditor(edit.value); name.focus();
      });
      function edited() { owner.editor.version++; owner.error = ''; owner.message = ''; owner.confirm = null; updateMounts(); }
      name.addEventListener('input', () => { if (fieldLive(name)) { owner.editor.name = name.value; edited(); } });
      name.addEventListener('compositionstart', () => { if (fieldLive(name)) owner.editor.composing = true; });
      name.addEventListener('compositionend', () => { if (fieldLive(name)) { owner.editor.composing = false; owner.editor.compositionEnded = Date.now(); owner.editor.name = name.value; edited(); } });
      parent.addEventListener('change', () => { if (fieldLive(parent)) { owner.editor.parentId = parent.value; edited(); } });
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!fieldLive(form) || owner.editor.composing || Date.now() - owner.editor.compositionEnded < 80 || owner.writing) return;
        const draft = copy(owner.editor), oldIds = new Set(owner.snapshot?.sourceFolders.folders.map(item => item.id));
        saveMutation(state => draft.id === 'new' ? model().createFolder(state, { name: draft.name, parentId: draft.parentId || null }) : model().updateFolder(state, draft.id, { name: draft.name, parentId: draft.parentId || null }), '폴더를 보관했습니다.').then(saved => {
          if (!saved || !owns(token, owner)) return;
          const id = draft.id === 'new' ? saved.folders.find(folder => !oldIds.has(folder.id))?.id : draft.id;
          if (id && owner.editor.id === draft.id) {
            if (owner.editor.version === draft.version) setEditor(id);
            else { owner.editor.id = id; updateMounts(true); }
          }
        }).catch(error => { if (owns(token, owner)) { owner.error = errorText(error); updateMounts(); } });
      });
      return Object.freeze({ dispose: () => releaseMount(mount) });
    }
    function releaseMount(mount) { if (mount.released) return; mount.released = true; mounts.delete(mount); mount.element.remove(); }
    function assignmentControl({ sourceIds, buttonLabel = '폴더로 이동', onSaved = () => {} } = {}) {
      const owner = ensureScope(); if (!owner) throw uiFault('자료실을 연 뒤 폴더를 확인하세요.');
      const token = epoch, details = el('details', null, 'source-folder-assignment'); details.dataset.sourceFolderAssignment = 'true';
      const summary = el('summary', null, 'sf-assignment-toggle'); summary.setAttribute('aria-label', buttonLabel); summary.title = buttonLabel;
      if (root.HaedoLife.Icons) summary.append(root.HaedoLife.Icons.create('folder')); else summary.append(el('span', '폴더'));
      details.append(summary);
      const panel = el('div', null, 'sf-assignment-panel'), label = el('label', '이동할 폴더', 'life-field'), destination = el('select'); destination.dataset.sourceFolderDestination = 'true'; label.append(destination);
      const message = el('p', '', 'life-meta'), error = el('p', '', 'life-error sf-error'); error.setAttribute('role', 'alert'); error.hidden = true;
      let loadedRevision = null, selection = null, applying = false;
      const ids = () => { const values = typeof sourceIds === 'function' ? sourceIds() : sourceIds; if (!Array.isArray(values)) throw uiFault('이동할 자료를 선택하세요.'); return [...new Set(values)]; };
      const refreshControl = () => {
        if (!live(token, owner, details)) return;
        const state = owner.snapshot?.sourceFolders;
        if (!state) { message.textContent = owner.pending ? '폴더를 확인하고 있습니다.' : '폴더를 먼저 확인하세요.'; destination.disabled = true; apply.disabled = true; return; }
        const sources = ids();
        if (selection === null) { const assignments = new Map(state.assignments.map(item => [item.sourceId, item.folderId])); const folders = new Set(sources.map(id => assignments.get(id) || '')); selection = folders.size === 1 ? [...folders][0] : ''; }
        folderOptions(destination, model().list(state), selection, [['', '미분류']]);
        destination.disabled = applying; apply.disabled = applying || !sources.length || !!owner.pending || !!owner.writing;
        message.textContent = sources.length ? '자료 ' + sources.length + '개 · 모든 버전의 폴더를 함께 이동합니다.' : '이동할 자료를 먼저 선택하세요.';
        loadedRevision = state.revision;
      };
      const apply = nodeButton('이동', null, async () => {
        try {
          const sources = ids(); if (!sources.length) throw uiFault('이동할 자료를 먼저 선택하세요.');
          if (loadedRevision !== owner.snapshot?.sourceFolders.revision) throw uiFault('폴더가 바뀌었습니다. 최신 폴더를 확인한 뒤 다시 이동하세요.');
          const captured = destination.value || null; applying = true; refreshControl(); error.hidden = true;
          const saved = await saveMutation(state => model().assignSources(state, sources, captured), '자료의 폴더를 옮겼습니다.');
          if (!saved || !owns(token, owner) || !isCurrent()) return;
          if (details.isConnected) { details.open = false; selection = null; summary.focus({ preventScroll: true }); }
          onSaved(copy(saved));
        } catch (cause) { if (live(token, owner, details)) { error.textContent = errorText(cause); error.hidden = false; } }
        finally { applying = false; if (live(token, owner, details)) refreshControl(); }
      }, token, owner); apply.dataset.sourceFolderApply = 'true';
      const reload = nodeButton('최신 폴더 확인', null, async () => {
        try { await load(owner, token); if (live(token, owner, details)) { error.hidden = true; refreshControl(); } }
        catch (cause) { if (live(token, owner, details)) { error.textContent = errorText(cause); error.hidden = false; } }
      }, token, owner); reload.dataset.sourceFolderReload = 'true';
      const cancel = nodeButton('취소', null, () => { details.open = false; selection = null; summary.focus({ preventScroll: true }); }, token, owner); cancel.dataset.sourceFolderCancel = 'true';
      const actions = el('div', null, 'sf-actions'); actions.append(apply, reload, cancel); panel.append(label, message, error, actions); details.append(panel);
      destination.addEventListener('change', () => { if (live(token, owner, destination)) selection = destination.value; });
      details.addEventListener('toggle', () => {
        if (!details.open || !live(token, owner, details)) return;
        try { refreshControl(); if (owner.pending) owner.pending.then(() => { if (live(token, owner, details) && details.open) refreshControl(); }).catch(() => { if (live(token, owner, details)) { error.textContent = owner.error; error.hidden = !owner.error; } }); }
        catch (cause) { error.textContent = errorText(cause); error.hidden = false; }
      });
      details.refresh = refreshControl;
      return details;
    }
    function refresh() { const owner = ensureScope(); return owner ? load(owner, epoch) : Promise.reject(uiFault('자료실을 먼저 열어 주세요.')); }
    function getSnapshot() { const owner = ensureScope(); return owner?.snapshot ? copy(owner.snapshot) : null; }
    function dispose() { if (disposed) return; disposed = true; epoch++; unsubscribe?.(); unsubscribe = null; for (const mount of [...mounts]) releaseMount(mount); slots.clear(); slot = null; workspaceId = null; }
    ensureScope();
    return Object.freeze({ mountList, assignmentControl, refresh, getSnapshot, dispose, get ready() { const owner = ensureScope(); return owner?.pending || Promise.resolve(owner?.snapshot ? copy(owner.snapshot) : null); } });
  }
  (root.HaedoLife ||= {}).SourceFoldersUI = Object.freeze({ create });
})(globalThis);
