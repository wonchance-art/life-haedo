/* Explicit private preservation review. The service owns validation and storage. */
(function (root) {
  'use strict';
  const life = (root.HaedoLife ||= {});
  const node = (tag, text, cls) => {
    const value = document.createElement(tag);
    if (text != null) value.textContent = text;
    if (cls) value.className = cls;
    return value;
  };
  const fault = message => Object.assign(new Error(message), { code: 'preservation_busy' });
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('ko-KR') : '미확인';
  const size = value => Number.isSafeInteger(value) && value >= 0 ? (value < 1024 * 1024 ? `${Math.ceil(value / 1024).toLocaleString('ko-KR')} KiB` : `${(value / (1024 * 1024)).toFixed(1)} MiB`) : '크기 미확인';
  const amount = value => Array.isArray(value) ? value.length : value;

  function create({ service, isCurrent = () => true, onRestored = null, onOpen = null } = {}) {
    if (!service) throw new Error('자료 보관 서비스를 확인해 주세요.');
    let host, surface, status, error, inventoryHost, selectionHost, reviewHost, workspaceSelect;
    let disposed = false, busy = false, generation = 0, catalog = null, inventory = null, review = null;
    let scope = '', shown = 40;
    const postIds = new Set(), boardIds = new Set();
    const valid = () => !disposed && isCurrent();
    const announce = message => { if (valid() && status) status.textContent = message; };
    const state = value => { if (surface) surface.dataset.state = value; };
    const clearError = () => { if (error) { error.hidden = true; error.textContent = ''; } };
    const showError = message => { if (!valid()) return; error.textContent = message; error.hidden = false; };
    function syncControls() {
      if (!surface) return;
      surface.setAttribute('aria-busy', String(busy));
      surface.querySelectorAll('button,input,select').forEach(control => { control.disabled = busy || control.dataset.unavailable === 'true'; });
      const prepare = surface.querySelector('#preservationPrepareExport');
      if (prepare) prepare.disabled = busy || !postIds.size && !boardIds.size;
    }
    function button(label, action, id, primary = false) {
      const control = node('button', label, 'life-button' + (primary ? ' life-primary' : ''));
      control.type = 'button'; if (id) control.id = id;
      control.addEventListener('click', () => run(action));
      return control;
    }
    function openButton(workspaceId) {
      const control = node('button', '복원한 작업공간 열기', 'life-button'); control.type = 'button'; control.id = 'preservationOpenRestored';
      control.addEventListener('click', async () => {
        if (!valid() || busy) return;
        clearError();
        try { await onOpen(workspaceId); }
        catch (failure) { showError(failure?.message || '작업공간을 열지 못했습니다. 복원한 자료는 유지했습니다.'); }
      });
      return control;
    }
    async function run(action) {
      if (!valid() || busy) return;
      const token = generation; busy = true; clearError(); state('busy'); syncControls();
      try { await action(); if (valid() && token === generation) state('ready'); }
      catch (failure) { if (valid() && token === generation) { state('error'); showError(failure?.message || '처리하지 못했습니다. 원래 자료는 유지됩니다. 다시 확인해 주세요.'); } }
      finally { busy = false; if (valid() && token === generation) syncControls(); }
    }
    function clearReview() {
      if (review?.ticket) service.cancel?.(review.ticket);
      review = null; if (reviewHost) reviewHost.replaceChildren();
    }
    function renderInventory(failed = false) {
      inventoryHost.replaceChildren();
      if (!inventory?.rows?.length) {
        inventoryHost.append(node('p', failed ? '보관 현황을 확인하지 못했습니다. 다시 확인해 주세요.' : '보관 현황을 확인하고 있습니다.', 'life-help'));
        return;
      }
      for (const item of inventory.rows) {
        const row = node('article', null, 'preservation-scope');
        row.dataset.preservationKey = item.key; row.dataset.state = failed ? 'error' : item.status;
        const heading = node('div', null, 'preservation-scope-heading');
        heading.append(node('h3', item.label), node('span', item.status === 'ready' && !failed ? `${count(item.count)}개` : '확인 못함', 'life-meta'));
        row.append(heading);
        const fields = node('dl', null, 'preservation-scope-fields');
        for (const [label, value] of [['이 브라우저', item.local], ['서버', item.server], ['파일', item.file]]) {
          const field = node('div'); field.append(node('dt', label), node('dd', value || '확인하지 못했습니다.')); fields.append(field);
        }
        row.append(fields);
        if (item.detail) row.append(node('p', item.detail, 'life-help'));
        inventoryHost.append(row);
      }
      if (failed) inventoryHost.prepend(node('p', '현황을 갱신하지 못했습니다. 개수는 다시 확인해 주세요.', 'life-help'));
    }
    function choice(kind, item, selected) {
      const label = node('label', null, 'preservation-choice');
      const input = node('input'); input.type = 'checkbox'; input.checked = selected.has(item.id);
      input.dataset[kind === 'post' ? 'postId' : 'boardId'] = item.id;
      input.setAttribute('aria-label', item.title || (kind === 'post' ? '제목 없는 글' : '제목 없는 9칸 구성'));
      const copy = node('span'); copy.append(node('strong', item.title || (kind === 'post' ? '제목 없는 글' : '제목 없는 9칸 구성')));
      const detail = kind === 'post' ? [item.archived ? '보관한 글' : '저장한 글', item.photoCount != null ? `사진 ${count(item.photoCount)}장` : ''].filter(Boolean).join(' · ') : `항목 ${count(item.itemCount)}개`;
      copy.append(node('span', detail, 'life-meta')); label.append(input, copy);
      input.addEventListener('change', () => {
        if (!valid() || busy) return;
        clearReview(); if (input.checked) selected.add(item.id); else selected.delete(item.id);
        updateSelection(); syncControls();
      });
      return label;
    }
    function updateSelection() {
      const label = surface.querySelector('#preservationSelectionCount');
      if (label) label.textContent = `글 ${postIds.size}개 · 9칸 구성 ${boardIds.size}개 선택`;
    }
    function renderSelections() {
      selectionHost.replaceChildren();
      if (!catalog) { selectionHost.append(node('p', '글과 9칸 목록을 확인하지 못했습니다. 다시 확인해 주세요.', 'life-help')); return; }
      const unowned = catalog.unowned || [];
      if (catalog.unownedError) {
        const warning = node('p', catalog.unownedError, 'life-help'); warning.dataset.unownedState = 'error'; selectionHost.append(warning);
      }
      if (unowned.length || scope) {
        const label = node('label', null, 'life-field'); label.append(node('span', '파일로 옮길 작업공간'));
        workspaceSelect = node('select'); workspaceSelect.id = 'preservationWorkspace';
        const current = node('option', '현재 작업공간'); current.value = ''; workspaceSelect.append(current);
        for (const item of unowned) { const option = node('option', `${item.title || '제목 없는 작업공간'} · 계정 미연결`); option.value = item.workspaceId; workspaceSelect.append(option); }
        if (scope && !unowned.some(item => item.workspaceId === scope)) {
          const selected = node('option', `${catalog.workspace?.title || '선택한 작업공간'} · 계정 미연결`); selected.value = scope; workspaceSelect.append(selected);
        }
        workspaceSelect.value = scope;
        workspaceSelect.addEventListener('change', () => run(async () => {
          const previous = scope; scope = workspaceSelect.value; postIds.clear(); boardIds.clear(); shown = 40; clearReview();
          try { await loadCatalog(); }
          catch (failure) { scope = previous; renderSelections(); throw failure; }
        })); label.append(workspaceSelect); selectionHost.append(label);
      }
      const name = node('p', catalog.workspace?.title || '현재 작업공간', 'preservation-workspace'); selectionHost.append(name);
      if (scope) selectionHost.append(node('p', '계정에 연결되지 않은 자료입니다. 원래 공간은 유지하고 현재 로그인한 계정의 새 공간으로 복원합니다.', 'life-help'));
      for (const [kind, title, values, selected, id] of [
        ['post', '저장한 글', catalog.posts || [], postIds, 'preservationPostSelection'],
        ['board', '9칸 구성', catalog.boards || [], boardIds, 'preservationBoardSelection'],
      ]) {
        const group = node('fieldset', null, 'preservation-selection'); group.id = id; group.append(node('legend', title));
        const visible = kind === 'post' ? values.slice(0, shown) : values;
        visible.forEach(item => group.append(choice(kind, item, selected)));
        if (!values.length) group.append(node('p', '선택할 항목이 없습니다.', 'life-help'));
        if (kind === 'post' && shown < values.length) group.append(button('글 더 보기', async () => { shown += 40; renderSelections(); }, 'preservationMorePosts'));
        selectionHost.append(group);
      }
      const chosen = node('p', '', 'life-meta'); chosen.id = 'preservationSelectionCount'; selectionHost.append(chosen);
      selectionHost.append(button('선택한 자료의 포함 범위 확인', prepare, 'preservationPrepareExport', true));
      updateSelection(); syncControls();
    }
    async function loadCatalog() {
      const result = await service.catalog(scope ? { unownedWorkspaceId: scope } : {});
      if (!valid()) return;
      catalog = result;
      const posts = new Set((catalog.posts || []).map(item => item.id)), boards = new Set((catalog.boards || []).map(item => item.id));
      for (const id of postIds) if (!posts.has(id)) postIds.delete(id);
      for (const id of boardIds) if (!boards.has(id)) boardIds.delete(id);
      renderSelections();
    }
    async function refresh() {
      clearReview(); announce('이 브라우저의 보관 범위와 목록을 확인하고 있습니다.');
      const results = await Promise.allSettled([service.inventory(), loadCatalog()]);
      if (!valid()) return;
      if (results[0].status === 'fulfilled') { inventory = results[0].value; renderInventory(); }
      else renderInventory(true);
      if (results[1].status === 'rejected') renderSelections();
      const partial = results.some(result => result.status === 'rejected') || inventory?.rows?.some(row => row.status === 'error') || catalog?.unownedError;
      if (partial) showError('일부 현황이나 목록을 확인하지 못했습니다. 확인한 자료와 선택은 유지했습니다. 보관 현황을 다시 확인해 주세요.');
      announce(partial ? '일부 범위만 확인했습니다. 확인하지 못한 종류는 다시 확인해 주세요.' : '보관 범위와 선택 목록을 확인했습니다. 서버의 현재 상태는 조회하지 않았습니다.');
    }
    function renderSummary(value) {
      const box = node('div', null, 'preservation-summary');
      const posts = value.posts || [], boards = value.boards || [], sources = value.sources || [];
      box.append(node('p', `글 ${posts.length}개 · 9칸 구성 ${boards.length}개 · 원문 ${sources.length}개 · 예상 크기 ${size(value.bytes)}`));
      const list = node('ul');
      posts.forEach(post => list.append(node('li', `${post.title || '제목 없는 글'} · 사진 ${count(amount(post.photos))}장${post.archived ? ' · 보관한 글' : ''}${post.dependency ? ' · 9칸 근거로 함께 포함' : ''}`)));
      boards.forEach(board => list.append(node('li', `${board.title || '제목 없는 9칸 구성'} · 9칸 구성`)));
      sources.forEach(source => list.append(node('li', `${source.title || '제목 없는 원문'} · 정확 버전 ${count(amount(source.versions))}개 전체 본문`)));
      box.append(list);
      box.append(node('p', '선택한 글의 사진 원본과 파일 안 메타데이터, 근거에 필요한 원문의 정확 버전 전체 본문이 함께 들어갑니다. 파일은 비공개로 보관해 주세요.', 'life-help'));
      box.append(node('p', '기존 자료 전체 백업이 아닙니다. 계정·서버 연결·공개 상태는 옮기지 않으며 자동 전송하거나 공개하지 않습니다.', 'life-help'));
      return box;
    }
    function showReview(value, kind) {
      clearReview(); review = { ...value, kind };
      const box = node('section', null, 'preservation-review'); box.id = kind === 'file' ? 'preservationImportReview' : 'preservationExportReview'; box.dataset.state = 'ready';
      box.append(node('h3', kind === 'file' ? '파일의 포함 범위 확인' : '선택한 자료의 포함 범위'));
      box.append(renderSummary(value.summary));
      if (kind === 'export') {
        box.append(button('근거 포함 ZIP 받기', download, 'preservationDownload', true));
        if (scope && service.restorePrepared) box.append(button('현재 계정의 새 공간으로 복원', restore, 'preservationRestorePrepared'));
      } else box.append(button('현재 계정의 새 공간으로 복원', restore, 'preservationRestore', true));
      box.append(button('검토 취소', async () => { clearReview(); announce('검토를 취소했습니다. 기존 자료는 유지했습니다.'); }, 'preservationCancelReview'));
      reviewHost.replaceChildren(box); syncControls();
    }
    async function prepare() {
      if (!postIds.size && !boardIds.size) throw new Error('파일에 담을 글이나 9칸 구성을 먼저 선택해 주세요.');
      // A fresh review must never expose the previous candidate as ready while
      // its source snapshot and exact dependencies are still being checked.
      clearReview();
      const result = await service.prepare({ postIds: [...postIds], boardIds: [...boardIds], ...(scope ? { unownedWorkspaceId: scope } : {}) });
      if (!valid()) return; showReview(result, 'export'); announce('포함할 자료를 확인했습니다. 내용을 검토한 뒤 ZIP을 받아 주세요.');
    }
    async function download() {
      const candidate = review; if (!candidate || candidate.kind !== 'export') throw new Error('선택한 자료의 포함 범위를 먼저 확인해 주세요.');
      const blob = await service.export(candidate.ticket); if (!valid() || review !== candidate) return;
      const url = URL.createObjectURL(blob), link = node('a'); link.href = url; link.download = 'haedo-evidence.zip';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce('ZIP 다운로드를 요청했습니다. 기기의 파일 앱에서 저장 여부를 확인해 주세요.');
    }
    async function restore() {
      const candidate = review; if (!candidate) throw new Error('복원할 파일의 포함 범위를 먼저 확인해 주세요.');
      const result = await (candidate.kind === 'export' && service.restorePrepared ? service.restorePrepared(candidate.ticket) : service.restore(candidate.ticket));
      if (!valid() || review !== candidate) return;
      const workspaceId = result.bundle?.workspaceId || result.workspaceId;
      clearReview(); postIds.clear(); boardIds.clear(); renderSelections();
      surface.dataset.restoreWorkspaceId = workspaceId || '';
      const saved = node('section', null, 'preservation-result'); saved.id = 'preservationRestored';
      saved.append(node('h3', '새 공간으로 복원했습니다'), node('p', '원래 작업공간과 글은 유지했습니다. 서버 연결과 공개는 시작하지 않았습니다.', 'life-help'));
      if (onOpen && workspaceId) saved.append(openButton(workspaceId));
      reviewHost.replaceChildren(saved); announce('현재 로그인한 계정의 새 작업공간으로 복원했습니다.');
      if (onRestored) {
        try { await onRestored(result); }
        catch (_) { if (valid()) showError('새 공간 복원은 완료했습니다. 화면 목록을 갱신하지 못했으니 관리에서 작업공간을 다시 확인해 주세요.'); }
      }
    }
    async function mount(container) {
      host = container; surface = node('section', null, 'preservation'); surface.id = 'lifePreservation'; state('loading');
      status = node('p', '', 'life-meta'); status.id = 'preservationStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      error = node('p', '', 'life-error'); error.id = 'preservationError'; error.setAttribute('role', 'alert'); error.hidden = true;
      surface.append(node('h2', '자료별 보관 범위'), node('p', '이 브라우저·서버·파일은 서로 다른 보관 범위입니다. 현재 작업공간의 자료를 종류별로 확인합니다.', 'life-help'), button('보관 현황 다시 확인', refresh, 'preservationRefresh'), status, error);
      const jump = node('a', '선택 자료·파일 복원으로 이동', 'preservation-jump'); jump.href = '#preservationTransport';
      jump.addEventListener('click', event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (!valid()) return;
        // Hash navigation also fires the app's popstate router and remounts
        // this view. Move focus and scroll without discarding the selection.
        transport.focus({ preventScroll: true }); transport.scrollIntoView({ block: 'start', behavior: 'instant' });
      });
      surface.insertBefore(jump, status);
      inventoryHost = node('div', null, 'preservation-inventory'); inventoryHost.id = 'preservationInventory'; surface.append(inventoryHost);
      const transport = node('section', null, 'preservation-transport'); transport.id = 'preservationTransport'; transport.tabIndex = -1; transport.append(node('h2', '선택한 자료와 근거 옮기기'), node('p', '저장한 글이나 9칸 구성을 고르면 필요한 근거 원문도 파일에 함께 담습니다. 사진 원본과 원문 전체 본문이 포함될 수 있으므로 포함 범위를 먼저 확인해 주세요.', 'life-help'));
      selectionHost = node('div'); selectionHost.id = 'preservationSelection'; transport.append(selectionHost);
      const fileLabel = node('label', null, 'life-field'); fileLabel.append(node('span', '근거 포함 ZIP 열기'));
      const file = node('input'); file.type = 'file'; file.accept = '.zip,application/zip'; file.id = 'preservationFile';
      file.addEventListener('change', () => { const chosen = file.files?.[0]; if (!chosen) return; run(async () => {
        clearReview();
        const result = await service.read(chosen); if (!valid()) return; showReview(result, 'file'); announce('파일을 검증했습니다. 아직 복원하지 않았습니다. 포함 범위를 확인해 주세요.');
      }); file.value = ''; }); fileLabel.append(file); transport.append(fileLabel);
      transport.append(node('p', '이 화면의 ‘근거 포함 ZIP 받기’로 받은 파일을 선택하세요. 사진 글 ZIP·Obsidian 패키지는 각각의 복원 메뉴에서 열어 주세요. ZIP은 풀거나 다시 압축하지 말고 원래 파일을 보관해 주세요.', 'life-help'));
      reviewHost = node('div'); reviewHost.id = 'preservationReview'; transport.append(reviewHost); surface.append(transport); host.replaceChildren(surface);
      await run(refresh); return surface;
    }
    return Object.freeze({ mount, refresh: () => run(refresh), dirty: () => busy,
      flush() { if (busy) throw fault('파일 처리가 끝난 뒤 이동해 주세요.'); },
      dispose() { disposed = true; generation++; clearReview(); service.dispose?.(); host = null; }
    });
  }
  life.PreservationUI = Object.freeze({ create });
})(globalThis);
