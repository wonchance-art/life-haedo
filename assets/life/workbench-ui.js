/* Private, local composition UI. Reading and editing never write to a source service. */
(function (global) {
  'use strict';

  const life = global.HaedoLife = global.HaedoLife || {};
  const ORIGINS = { apple_notes: 'Apple 메모', obsidian: 'Obsidian', naver_blog: '네이버 블로그', instagram: 'Instagram', other: '기타' };
  const MODES = { activities: '묶음', page: '내 페이지', discover: '다시 찾기', related: '관련 기록', reflection: '회고', 'workbench-backup': '자료·구성 백업', 'public-pages': '공개한 페이지' };
  const copy = value => JSON.parse(JSON.stringify(value));
  function el(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function fault(code, message) { return Object.assign(new Error(message), { code }); }

  function create({ storage, core, host, getBundle, openSource, announce = () => {}, onRestored,
    onSelectionUsed = () => {}, onSelectionCancel = () => {}, onArrange = () => {},
    shareRemoteFactory = () => life.ShareRemote?.createOwner({ auth: global.HaedoAuth }),
    sharePublicUrl = publicId => { const url = new URL('share.html', global.location.href); url.searchParams.set('id', publicId); return url.href; },
    beforeRestore = async () => {}, isDisposed = () => false }) {
    const model = life.Workbench;
    const limits = model.LIMITS;
    const sessions = new Map();
    const urls = new Set();
    let disposed = false, generation = 0, visible = false, current = null, mode = null;
    let surface = null, statusNode = null, errorNode = null, bodyNode = null, saveControl = null;
    let preview = false, restoreCandidate = null, restoreName = '', restoreSequence = 0, installing = false;
    let incoming = null;
    let shareRemote = null;
    let publicList = null;
    let viewCleanups = [];

    const alive = () => !disposed && !isDisposed();
    const workspaceIs = session => alive() && getBundle()?.workspaceId === session.workspaceId;
    const showing = (token, session) => visible && token === generation && workspaceIs(session) && current === session;
    function cleanupView() { viewCleanups.splice(0).forEach(cleanup => cleanup()); }
    function rememberPageEditor() {
      if (!visible || mode !== 'page' || preview || incoming || current?.share?.open || !bodyNode?.isConnected || !bodyNode.querySelector('.wb-page-entries')) return;
      current.pageEditorView = { revision: current.baseRevision,
        openEntries: [...bodyNode.querySelectorAll('.wb-page-entry-edit[open]')].map(node => node.closest('[data-entry-id]').dataset.entryId),
        settingsOpen: !!bodyNode.querySelector('.wb-page-settings')?.open, addOpen: !!bodyNode.querySelector('.wb-page-add')?.open,
        fields: [...bodyNode.querySelectorAll('[data-page-field]')].map(input => ({ key: input.dataset.pageField,
          start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection, top: input.scrollTop, left: input.scrollLeft })) };
    }
    function restorePageEditor(session, focus = false) {
      const view = session.pageEditorView;
      if (!view || view.revision !== session.baseRevision || preview) return false;
      bodyNode.querySelectorAll('.wb-page-entry-edit').forEach(node => { node.open = view.openEntries.includes(node.closest('[data-entry-id]').dataset.entryId); });
      for (const [selector, open] of [['.wb-page-settings', view.settingsOpen], ['.wb-page-add', view.addOpen]]) {
        const node = bodyNode.querySelector(selector); if (node) node.open = open;
      }
      const inputs = [...bodyNode.querySelectorAll('[data-page-field]')];
      for (const position of view.fields) {
        const input = inputs.find(node => node.dataset.pageField === position.key); if (!input) continue;
        input.setSelectionRange(position.start, position.end, position.direction);
        input.scrollTop = position.top; input.scrollLeft = position.left;
      }
      const target = focus && inputs.find(node => node.dataset.pageField === session.pageFieldFocus && node.getClientRects().length);
      if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest' }); }
      return !!target;
    }
    function errorText(error) {
      if (error?.code === 'workbench_conflict') return '다른 곳에서 구성이 바뀌었습니다. 현재 초안을 유지했습니다. 저장본과 비교해 주세요.';
      if (error?.code === 'storage_quota') return '저장 공간이 부족합니다. 현재 초안을 유지했습니다. JSON 사본을 받아 보관한 뒤 다시 저장해 주세요.';
      if (error?.code === 'storage_scope_closed' || error?.code === 'workspace_access_denied') return '계정 또는 작업공간이 바뀌어 저장을 멈췄습니다. 원래 공간에서 다시 확인해 주세요.';
      return error?.message || '저장하지 못했습니다. 현재 초안을 유지했습니다. 다시 시도해 주세요.';
    }
    function announceSafe(message, session = current) {
      if (session && workspaceIs(session)) announce(message);
    }
    function updateStatus(session) {
      if (!visible || current !== session || !workspaceIs(session) || !statusNode) return;
      statusNode.textContent = !session.state ? '구성을 불러오지 못함' : session.saving ? '이 브라우저에 저장 중…' : session.error ? '저장하지 못함 · 초안 유지' : incoming ? '선택 검토 중 · 아직 추가하지 않음' :
        session.edit !== session.stored ? '저장 전 변경 있음' : session.remoteRevision > session.baseRevision ? '새로 받은 구성이 있습니다.' : '이 브라우저에 저장됨';
      statusNode.dataset.state = session.error ? 'error' : session.edit !== session.stored ? 'dirty' : 'saved';
      if (mode === 'related') surface.querySelector('.wb-storage-line').hidden = !!session.state && !session.saving && !session.error && session.edit === session.stored && session.remoteRevision <= session.baseRevision;
    }
    function clearError() { if (errorNode) { errorNode.hidden = true; errorNode.replaceChildren(); } }
    function report(error, session = current) {
      if (!session || !visible || current !== session || !workspaceIs(session) || !errorNode) return;
      errorNode.hidden = false;
      errorNode.replaceChildren(el('p', errorText(error)));
      if (session.state && session.edit !== session.stored) {
        const actions = el('div', null, 'life-actions');
        actions.append(action('초안 JSON 받기', () => downloadDraft(session)));
        if (error?.code === 'workbench_conflict') actions.append(action('저장본과 비교', () => compareSaved(session)));
        else {
          const token = generation, recoveryBox = errorNode, recoveryError = errorNode.firstElementChild;
          const retry = action('다시 저장', async () => {
            await flush();
            if (showing(token, session) && errorNode === recoveryBox && recoveryBox.firstElementChild === recoveryError && !session.error) {
              const restoreFocus = document.activeElement === retry;
              clearError();
              if (restoreFocus) surface.querySelector('#wbPagePreview')?.focus();
            }
          });
          actions.append(retry);
        }
        errorNode.append(actions);
      }
      updateStatus(session);
    }
    function action(label, task, className = '', isEnabled = () => true) {
      const button = el('button', label, 'life-button' + (className ? ' ' + className : ''));
      button.type = 'button';
      const token = generation, session = current;
      button.addEventListener('click', async () => {
        if (!showing(token, session) || !button.isConnected) return;
        if (installing) { report(fault('restore_in_progress', '새 사본을 저장하는 중입니다. 완료 후 다시 시도해 주세요.'), session); return; }
        button.disabled = true;
        try { await task(); } catch (error) { report(error, session); }
        finally { if (button.isConnected) button.disabled = !isEnabled(); }
      });
      return button;
    }
    function icon(label, glyph, task, pressed) {
      const button = action('', task, 'life-icon-button');
      button.setAttribute('aria-label', label);
      button.title = label;
      if (pressed != null) button.setAttribute('aria-pressed', String(pressed));
      button.append(life.Icons.create(glyph));
      return button;
    }
    function field(label, value, { id, multiline = false, max = limits.title, change } = {}) {
      const wrapper = el('label', null, 'life-field');
      wrapper.append(el('span', label));
      const input = el(multiline ? 'textarea' : 'input');
      if (!multiline) input.type = 'text';
      input.value = value;
      input.maxLength = max;
      if (id) input.id = id;
      if (multiline) input.rows = 4;
      const token = generation, session = current;
      let composing = false;
      input.addEventListener('compositionstart', () => { composing = true; session.composing.add(input); clearTimeout(session.timer); });
      input.addEventListener('input', () => {
        if (!showing(token, session) || installing) return;
        change?.(input.value);
        if (change) mark(session, !composing && !input.isComposing);
      });
      const finish = () => {
        if (!composing) return;
        composing = false; session.composing.delete(input);
        if (workspaceIs(session) && session.edit !== session.stored) schedule(session);
      };
      input.addEventListener('compositionend', finish);
      input.addEventListener('blur', finish);
      viewCleanups.push(() => { session.composing.delete(input); });
      wrapper.append(input);
      return { wrapper, input };
    }
    function toggle(label, checked, task, attributes = {}) {
      const wrapper = el('label', null, 'wb-check');
      const input = el('input'); input.type = 'checkbox'; input.checked = checked;
      for (const [name, value] of Object.entries(attributes)) input.setAttribute(name, value);
      const token = generation, session = current;
      input.addEventListener('change', () => {
        if (!showing(token, session) || installing) { input.checked = !input.checked; return; }
        try { task(input.checked); } catch (error) { input.checked = !input.checked; report(error, session); }
      });
      wrapper.append(input, el('span', label));
      return wrapper;
    }
    function details(label, { open = false } = {}) {
      const element = el('details', null, 'wb-details');
      element.open = open;
      element.append(el('summary', label));
      return element;
    }
    function notice(text) { return el('p', text, 'life-note wb-notice'); }
    function empty(text) { return el('p', text, 'life-empty wb-empty'); }
    function sourceInfo(id, bundle = getBundle()) {
      const version = bundle?.sourceVersions.find(item => item.id === id);
      const source = version && bundle.sources.find(item => item.id === version.sourceId);
      if (!version || !source) return null;
      const versions = bundle.sourceVersions.filter(item => item.sourceId === source.id);
      return { source, version, number: versions.findIndex(item => item.id === version.id) + 1, total: versions.length };
    }
    function sourceName(id, bundle) { return sourceInfo(id, bundle)?.source.title || '연결된 원문 없음'; }
    function sourceMeta(info) {
      const coverage = info.version.contentText == null ? '본문 미확보' : info.version.coverage.status === 'partial' ? '일부 본문' :
        info.version.coverage.status === 'unknown' ? '확보 범위 미확인' : '제공한 본문';
      const relation = { self: '내 기록', other: '다른 사람의 기록', unknown: '작성자 관계 미확인' }[info.version.originalAuthor.relation];
      return (life.Writing?.isOwnSource(info.source, getBundle()) ? '내 글' : ORIGINS[info.source.origin] || '기타') + ' · ' + relation + ' · ' + coverage + (info.total > 1 ? ' · ' + info.number + '/' + info.total + ' 버전' : '');
    }
    function mark(session, autosave = true) {
      session.edit += 1;
      if (session.share) { session.share.draft = null; session.share.consented = false; }
      if (session.error?.code !== 'workbench_conflict') { session.error = null; clearError(); }
      updateStatus(session);
      if (autosave) schedule(session);
    }
    function schedule(session) {
      clearTimeout(session.timer);
      if (!alive() || session.composing.size || session.error?.code === 'workbench_conflict') return;
      session.timer = global.setTimeout(() => {
        session.timer = null;
        if (workspaceIs(session)) flushSession(session).catch(() => {});
      }, 650);
    }
    async function flushSession(session) {
      clearTimeout(session.timer); session.timer = null;
      if (!workspaceIs(session)) throw fault('workspace_changed', '작업공간이 바뀌어 현재 초안을 적용하지 않았습니다.');
      if (!session.state) { if (session.loading) await session.loading; else return; }
      if (session.saving) { await session.saving; return flushSession(session); }
      if (session.edit === session.stored) return;
      if (session.error?.code === 'workbench_conflict') { report(session.error, session); throw session.error; }
      const tick = session.edit, payload = copy(session.state);
      payload.revision = session.baseRevision;
      const task = (async () => {
        try {
          const result = await storage.saveWorkbench(session.workspaceId, payload, session.baseRevision);
          session.baseRevision = result.revision;
          // Preserve keystrokes typed while the write was in flight.
          session.state.revision = result.revision;
          session.stored = tick; session.error = null;
          // Existing controls close over this draft. Keep its object identity after saving.
        } catch (error) { session.error = error; report(error, session); throw error; }
        finally { session.saving = null; updateStatus(session); }
      })();
      session.saving = task; updateStatus(session);
      await task;
      if (session.edit !== session.stored) return flushSession(session);
    }
    async function flush() {
      if (installing) throw fault('restore_in_progress', '새 사본을 저장하는 중입니다. 완료 후 이동해 주세요.');
      if (current?.state && current.edit !== current.stored || current?.saving) await flushSession(current);
    }
    function dirty() { return installing || !!current && (current.edit !== current.stored || !!current.saving); }
    function sessionFor(id) {
      if (sessions.has(id)) return sessions.get(id);
      const session = { workspaceId: id, state: null, baseRevision: 0, edit: 0, stored: 0, remoteRevision: 0,
        loading: null, saving: null, timer: null, error: null, composing: new Set(), unsubscribe: null };
      if (storage.subscribe) session.unsubscribe = storage.subscribe(id, event => {
        if (!alive() || event.type !== 'workbench_changed') return;
        session.remoteRevision = Math.max(session.remoteRevision, event.revision || 0);
        if (!session.state || session.saving || session.remoteRevision <= session.baseRevision) return;
        if (session.edit !== session.stored) {
          clearTimeout(session.timer);
          session.error = fault('workbench_conflict', '다른 탭에서 구성이 바뀌었습니다.');
          report(session.error, session);
        } else if (visible && current === session && workspaceIs(session)) {
          updateStatus(session);
          if (!surface.querySelector('#wbReloadSaved')) {
            const reload = action('새 저장본 읽기', async () => {
              if (!incoming) { session.state = null; await render(mode); return; }
              const token = generation;
              cleanupView(); session.state = null;
              surface.setAttribute('aria-busy', 'true'); bodyNode.replaceChildren(notice('불러오는 중…'));
              try {
                await load(session);
                if (!showing(token, session)) return;
                clearError(); redraw(); reload.remove();
              } finally { if (showing(token, session)) surface.setAttribute('aria-busy', 'false'); }
            });
            reload.id = 'wbReloadSaved'; statusNode.after(reload);
          }
        }
      });
      sessions.set(id, session);
      return session;
    }
    async function load(session) {
      if (session.loading) return session.loading;
      session.loading = (async () => {
        const result = await storage.readWorkbench(session.workspaceId);
        session.state = copy(result); session.baseRevision = result.revision;
        session.edit = 0; session.stored = 0; session.error = null;
      })();
      try { await session.loading; } finally { session.loading = null; }
    }
    async function openVersion(id, focusKey) {
      const session = current, token = generation, info = sourceInfo(id);
      if (!info) throw fault('source_missing', '연결된 원문이 없습니다. 새 버전으로 대신 열지 않았습니다.');
      await flush();
      if (showing(token, session)) await openSource(info.source.id, info.version.id, { focusKey });
    }
    function sourceRow(id, { body = false, remove, previewOnly = false, hideTitle = false, showLink = false, focusKey } = {}) {
      const row = el('div', null, 'wb-source'); row.dataset.versionId = id;
      const info = sourceInfo(id);
      const head = el('div', null, 'wb-row');
      const text = el('div', null, 'wb-grow');
      if (!hideTitle || !info) text.append(el('p', info ? info.source.title : '연결된 원문 없음', 'wb-source-title'));
      text.append(el('p', info ? sourceMeta(info) : '이 버전은 현재 공간에 없습니다. 다른 버전으로 바꾸지 않았습니다.', 'life-meta'));
      head.append(text);
      if (info && !previewOnly) {
        const open = (focusKey ? discoveryIcon : icon)('이 원문 버전 열기', 'book', () => openVersion(id, focusKey));
        if (focusKey) open.dataset.focusKey = focusKey;
        head.append(open);
      }
      if (remove) head.append(icon('연결 해제', 'close', remove));
      row.append(head);
      if (body && info?.version.contentText != null) {
        const content = el('p', info.version.contentText, 'wb-source-body');
        row.append(content);
      }
      if ((previewOnly || showLink) && info?.source.url) {
        try {
          const url = new URL(info.source.url);
          if (['http:', 'https:'].includes(url.protocol)) {
            const link = el('a', '원문 출처', 'wb-source-link'); link.href = url.href;
            link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link);
          }
        } catch (_) { /* Invalid URLs never become links. */ }
      }
      return row;
    }
    function picker(label, selected, change, { max = limits.groupVersions, single = false } = {}) {
      const box = details(label);
      const search = field('원문 제목·본문 찾기', '', {});
      search.input.type = 'search'; search.input.removeAttribute('maxLength');
      const list = el('div', null, 'wb-picker-list');
      const more = action('원문 더 보기', () => { shown += 30; fill(); });
      let shown = 30, query = '', composing = false;
      const fill = () => {
        const bundle = getBundle(), needle = query.trim().toLocaleLowerCase('ko-KR');
        const versions = bundle.sourceVersions.slice().reverse().filter(version => {
          const info = sourceInfo(version.id, bundle);
          return info && (!needle || (info.source.title + '\n' + (version.contentText || '')).toLocaleLowerCase('ko-KR').includes(needle));
        });
        list.replaceChildren();
        versions.slice(0, shown).forEach(version => {
          const info = sourceInfo(version.id, bundle);
          const row = toggle(info.source.title + ' · ' + sourceMeta(info), selected().includes(version.id), value => {
            if (value && !single && selected().length >= max) throw fault('limit_reached', '선택할 수 있는 원문은 ' + max + '개까지입니다.');
            change(version.id, value);
            if (single) fill();
          }, { 'data-version-id': version.id });
          list.append(row);
        });
        if (!versions.length) list.append(empty(needle ? '일치하는 원문이 없습니다.' : '보관한 원문이 없습니다. 자료를 먼저 가져와 주세요.'));
        more.hidden = versions.length <= shown;
      };
      search.input.addEventListener('compositionstart', () => { composing = true; });
      search.input.addEventListener('compositionend', () => { composing = false; query = search.input.value; shown = 30; fill(); });
      search.input.addEventListener('input', () => { if (!composing) { query = search.input.value; shown = 30; fill(); } });
      box.append(search.wrapper, list, more); fill();
      return box;
    }

    function renderActivities() {
      const session = current, state = session.state;
      const add = el('form', null, 'wb-add-row');
      const title = field('새 묶음 이름', '', { id: 'wbGroupTitle' });
      const createButton = action('묶음 만들기', () => {
        if (!title.input.value.trim()) { title.input.setCustomValidity('묶음 이름을 입력해 주세요.'); title.input.reportValidity(); return; }
        if (state.groups.length >= limits.groups) throw fault('limit_reached', '묶음은 ' + limits.groups + '개까지 보관할 수 있습니다.');
        const group = { id: core.id(), title: title.input.value.trim(), versionIds: [] };
        state.groups.push(group); mark(session); redraw();
        revealGroup(group.id);
      }, 'life-primary');
      createButton.id = 'wbCreateGroup';
      title.input.addEventListener('input', () => title.input.setCustomValidity(''));
      add.addEventListener('submit', event => { event.preventDefault(); createButton.click(); });
      add.append(title.wrapper, createButton); bodyNode.append(add);
      if (!state.groups.length) bodyNode.append(empty('관련된 기록을 묶어 정리해 보세요. 원문은 각각 그대로 보관됩니다.'));
      state.groups.forEach(group => {
        const article = el('article', null, 'wb-feed'); article.dataset.groupId = group.id;
        const heading = el('div', null, 'wb-row');
        heading.append(el('h3', group.title, 'wb-grow'), icon('이 묶음을 내 페이지에 추가', 'plus', () => addEntry(group.title, group.versionIds)));
        article.append(heading);
        const none = notice('아직 연결한 원문이 없습니다.'); none.hidden = group.versionIds.length > 0; article.append(none);
        group.versionIds.forEach(id => article.append(sourceRow(id)));
        const edit = details('묶음 편집');
        edit.append(field('묶음 이름', group.title, { change: value => { group.title = value; heading.querySelector('h3').textContent = value || '이름 입력 중'; } }).wrapper);
        edit.append(picker('원문 선택', () => group.versionIds, (id, checked) => {
          group.versionIds = checked ? group.versionIds.concat(id) : group.versionIds.filter(value => value !== id);
          mark(session);
          const old = [...article.children].filter(child => child.classList.contains('wb-source'));
          old.forEach(child => child.remove());
          none.hidden = group.versionIds.length > 0;
          group.versionIds.forEach(value => edit.before(sourceRow(value)));
        }));
        const missing = group.versionIds.filter(id => !sourceInfo(id));
        missing.forEach(id => edit.append(action('없는 원문 연결 해제', () => { group.versionIds = group.versionIds.filter(value => value !== id); mark(session); redraw(); })));
        edit.append(action('묶음만 삭제', () => { state.groups = state.groups.filter(item => item.id !== group.id); mark(session); redraw(); }));
        edit.append(notice('기록과 내 페이지에 이미 추가한 항목은 그대로 남습니다.'));
        article.append(edit); bodyNode.append(article);
      });
    }
    function renderIncoming() {
      const session = current, pending = incoming, token = generation;
      const box = el('section', null, 'wb-incoming'); box.id = 'wbIncomingSelection';
      box.setAttribute('aria-labelledby', 'wbIncomingHeading');
      const heading = el('h3', '담을 기록'); heading.id = 'wbIncomingHeading';
      box.append(heading);
      const count = el('p', '', 'life-meta'); count.id = 'wbIncomingCount'; count.setAttribute('role', 'status');
      const error = el('p', '', 'wb-incoming-error'); error.id = 'wbIncomingError'; error.setAttribute('role', 'alert'); error.hidden = true;
      const list = el('div', null, 'wb-incoming-list');
      const sameWorkspace = pending.workspaceId === session.workspaceId;
      const selected = () => pending.versionIds.filter(id => pending.selected.has(id));
      const fail = message => { error.textContent = message; error.hidden = false; return false; };
      const validate = () => {
        if (!sameWorkspace || pending.workspaceId !== getBundle()?.workspaceId) return fail('다른 작업공간에서 고른 기록입니다. 원래 공간으로 돌아가 다시 선택해 주세요.');
        if (pending.invalid) return fail('선택 정보를 읽지 못했습니다. 기록으로 돌아가 다시 선택해 주세요.');
        if (mode === 'activities' && pending.groupId && !session.state.groups.some(item => item.id === pending.groupId)) return fail('선택한 묶음이 다른 탭에서 삭제되었습니다. 담을 묶음을 다시 선택해 주세요.');
        const ids = selected();
        if (!ids.length) return fail('담을 기록을 하나 이상 선택해 주세요.');
        if (ids.some(id => !sourceInfo(id))) return fail('현재 공간에 없는 원문 버전이 있습니다. 다시 선택하거나 해당 기록을 직접 해제해 주세요.');
        const max = mode === 'page' ? limits.parts : limits.groupVersions;
        if (ids.length > max) return fail('한 번에 담을 수 있는 원문은 ' + max + '개까지입니다. 선택을 줄여 주세요.');
        error.hidden = true; error.textContent = ''; return true;
      };
      const refresh = () => {
        count.textContent = selected().length + '개 선택';
        validate();
      };
      pending.versionIds.forEach(id => {
        const info = sameWorkspace ? sourceInfo(id) : null;
        const row = el('div', null, 'wb-incoming-record'); row.dataset.versionId = id;
        const check = toggle(info?.source.title || (sameWorkspace ? '연결된 원문 없음' : '다른 작업공간의 기록'), pending.selected.has(id), checked => {
          if (checked) pending.selected.add(id); else pending.selected.delete(id);
          refresh();
        }, { 'data-version-id': id });
        check.classList.add('wb-incoming-check');
        if (!sameWorkspace) check.querySelector('input').disabled = true;
        const detail = el('div', null, 'wb-incoming-meta');
        if (info) {
          detail.append(el('p', sourceMeta(info) + (info.total === 1 ? ' · 1/1 버전' : ''), 'life-meta'));
          if (info.version.originalAuthor.label) detail.append(el('p', '원 작성자 · ' + info.version.originalAuthor.label, 'life-meta'));
          if (info.source.url) {
            try {
              const url = new URL(info.source.url);
              if (['http:', 'https:'].includes(url.protocol)) {
                const link = el('a', '원문 출처', 'wb-source-link'); link.href = url.href;
                link.target = '_blank'; link.rel = 'noopener noreferrer'; detail.append(link);
              }
            } catch (_) { /* Invalid URLs never become links. */ }
          }
        } else detail.append(el('p', '다른 버전으로 대신 담지 않습니다.', 'life-meta'));
        row.append(check, detail); list.append(row);
      });
      box.append(count, list, error);
      const target = el('label', null, 'life-field');
      const group = el('select'); group.id = 'wbIncomingGroup';
      if (mode === 'activities') {
        target.append(el('span', '담을 묶음'));
        group.append(new Option('새 묶음', ''));
        session.state.groups.forEach(item => group.append(new Option(item.title, item.id)));
        if (pending.groupId && !session.state.groups.some(item => item.id === pending.groupId)) {
          const missing = new Option('선택한 묶음 없음', pending.groupId); missing.disabled = true; group.append(missing);
        }
        group.value = pending.groupId;
        target.append(group); box.append(target);
      }
      const title = field(mode === 'page' ? '항목 제목' : '새 묶음 이름', pending.title, { id: 'wbIncomingTitle' });
      let composing = false;
      const apply = action(mode === 'page' ? '내 페이지에 추가' : '묶음에 담기', async () => {
        if (incoming !== pending || pending.accepted || composing || !showing(token, session)) return;
        if (!validate()) { error.scrollIntoView({ block: 'nearest' }); return; }
        const ids = selected(), name = title.input.value.trim();
        if ((mode === 'page' || !group.value) && !name) {
          title.input.setCustomValidity(mode === 'page' ? '항목 제목을 입력해 주세요.' : '묶음 이름을 입력해 주세요.');
          title.input.reportValidity(); return;
        }
        const candidate = copy(session.state);
        let addedId;
        if (mode === 'activities') {
          if (group.value) {
            const existing = candidate.groups.find(item => item.id === group.value);
            if (!existing) { fail('선택한 묶음을 찾지 못했습니다. 묶음을 다시 선택해 주세요.'); return; }
            const union = [...new Set(existing.versionIds.concat(ids))];
            if (union.length > limits.groupVersions) { fail('한 묶음에는 원문 ' + limits.groupVersions + '개까지 담을 수 있습니다.'); return; }
            existing.versionIds = union; addedId = existing.id;
          } else {
            if (candidate.groups.length >= limits.groups) { fail('묶음은 ' + limits.groups + '개까지 보관할 수 있습니다.'); return; }
            addedId = core.id(); candidate.groups.push({ id: addedId, title: name, versionIds: ids });
          }
        } else {
          if (candidate.page.entries.length >= limits.entries) { fail('내 페이지 항목은 ' + limits.entries + '개까지 만들 수 있습니다.'); return; }
          addedId = core.id();
          candidate.page.entries.push({ id: addedId, title: name, parts: ids.map(versionId => ({ versionId, enabled: true })),
            note: '', pinned: false, enabled: true, showBody: true, showNote: true });
        }
        model.validate(candidate);
        // Accept once before writing. A failed save retains this draft and retries the same entry.
        pending.accepted = true; incoming = null;
        session.state.groups = candidate.groups; session.state.page.entries = candidate.page.entries;
        mark(session, false); redraw();
        if (mode === 'activities') revealGroup(addedId);
        else {
          const article = [...bodyNode.querySelectorAll('[data-entry-id]')].find(node => node.dataset.entryId === addedId);
          const editor = article?.querySelector('details');
          if (editor) { editor.open = true; editor.querySelector('summary')?.focus({ preventScroll: true }); }
          article?.scrollIntoView({ block: 'start' });
        }
        announceSafe('선택한 기록을 편집 초안에 담았습니다.', session);
        try { onSelectionUsed({ workspaceId: session.workspaceId, versionIds: ids }); }
        finally { await flushSession(session); }
      }, 'life-primary');
      apply.id = 'wbIncomingApply';
      title.input.addEventListener('compositionstart', () => { composing = true; apply.disabled = true; });
      const finishComposition = () => { composing = false; apply.disabled = false; pending.title = title.input.value; };
      title.input.addEventListener('compositionend', finishComposition);
      title.input.addEventListener('blur', finishComposition);
      title.input.addEventListener('input', () => { pending.title = title.input.value; title.input.setCustomValidity(''); });
      group.addEventListener('change', () => {
        if (!showing(token, session) || incoming !== pending) return;
        pending.groupId = group.value; title.wrapper.hidden = !!group.value; refresh();
      });
      title.wrapper.hidden = mode === 'activities' && !!group.value;
      box.append(title.wrapper);
      if (mode === 'page') box.append(notice('하나의 비공개 항목으로 담습니다. 추가한 뒤 본문·코멘트·표시 여부를 편집하고 미리볼 수 있습니다.'));
      const actions = el('div', null, 'life-actions');
      const cancel = action('취소', async () => {
        if (await onSelectionCancel() === false) return;
        if (showing(token, session) && incoming === pending) { incoming = null; redraw(); }
      }); cancel.id = 'wbIncomingCancel';
      actions.append(apply, cancel); box.append(actions); bodyNode.append(box); refresh();
    }
    function revealGroup(groupId) {
      const article = [...surface.querySelectorAll('[data-group-id]')].find(node => node.dataset.groupId === groupId);
      if (!article) return;
      const editor = article.querySelector('details');
      if (editor) editor.open = true;
      editor?.querySelector('summary')?.focus({ preventScroll: true });
      article.scrollIntoView({ block: 'start' });
    }
    function addEntry(title, versionIds) {
      const session = current;
      if (!versionIds.length) throw fault('empty_selection', '원문을 먼저 선택해 주세요.');
      if (versionIds.length > limits.parts) throw fault('limit_reached', '내 페이지 한 항목에는 원문 ' + limits.parts + '개까지 넣을 수 있습니다.');
      if (session.state.page.entries.length >= limits.entries) throw fault('limit_reached', '내 페이지 항목은 ' + limits.entries + '개까지 만들 수 있습니다.');
      const entry = { id: core.id(), title: title || '선택한 자료', parts: versionIds.map(versionId => ({ versionId, enabled: true })),
        note: '', pinned: false, enabled: true, showBody: true, showNote: true };
      session.state.page.entries.push(entry); mark(session);
      announceSafe('내 페이지에 추가했습니다. 비공개 구성으로 보관합니다.', session);
      if (mode === 'page') redraw();
    }
    function owner() {
      shareRemote ||= shareRemoteFactory();
      if (!shareRemote || !life.Share || !life.ShareView) throw fault('share_unavailable', '공개 기능을 불러오지 못했습니다. 새로고침한 뒤 다시 확인해 주세요.');
      return shareRemote;
    }
    function shareState(session) {
      return session.share ||= { open: false, sequence: 0, phase: 'idle', head: null, loaded: false, error: '', message: '',
        choices: { bodyVersionIds: [], excerpts: [] }, draft: null, reviewRows: [], choicesOpen: false, quoteOpen: new Set(), consented: false, revokeConfirm: false };
    }
    function sharing(session, sequence) {
      return workspaceIs(session) && visible && current === session && mode === 'page' && session.share?.open && session.share.sequence === sequence;
    }
    function shareError(error) {
      if (error?.code === 'publish_unknown' || error?.code === 'pending_operation') return '게시 결과를 아직 확인하지 못했습니다. 같은 요청의 결과를 확인하거나 다시 시도해 주세요.';
      if (error?.code === 'request_cancelled') return '계정 또는 화면이 바뀌어 결과를 표시하지 않았습니다. 원래 계정에서 공개 상태를 확인해 주세요.';
      if (error?.code === 'pending_storage_failed') return '요청 복구 정보를 보관하지 못해 전송하지 않았습니다. 브라우저 저장 설정을 확인해 주세요.';
      return error?.message || '공개 상태를 확인하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.';
    }
    function makeShareDraft(session) {
      const share = shareState(session);
      share.consented = false; share.draft = null;
      if (session.remoteRevision > session.baseRevision) throw fault('workbench_conflict', '다른 탭의 새 구성이 있습니다. 새 저장본을 읽은 뒤 공개할 내용을 다시 확인해 주세요.');
      const draft = life.Share.makeDraft(getBundle(), session.state, share.choices);
      share.reviewRows = draft.reviewRows;
      share.draft = { ...draft, edit: session.edit, revision: getBundle().revision, signature: JSON.stringify(draft.snapshot) };
    }
    async function openShare(session) {
      const token = generation;
      await flush();
      if (!showing(token, session)) return;
      const share = shareState(session);
      share.open = true; share.choices = { bodyVersionIds: [], excerpts: [] }; share.reviewRows = []; share.choicesOpen = false; share.quoteOpen.clear();
      share.revokeConfirm = false; share.message = '';
      await refreshShare(session);
    }
    async function refreshShare(session) {
      const share = shareState(session), sequence = ++share.sequence;
      share.phase = 'loading'; share.error = ''; share.message = ''; share.loaded = false; share.draft = null; share.consented = false; share.revokeConfirm = false; redraw();
      try {
        const head = await owner().get(session.workspaceId);
        if (!sharing(session, sequence)) return;
        share.head = head; share.loaded = true; share.phase = 'ready';
        if (!owner().pending(session.workspaceId)) makeShareDraft(session);
      } catch (error) {
        if (!sharing(session, sequence)) return;
        share.error = shareError(error); share.phase = 'error';
      }
      if (sharing(session, sequence)) redraw();
    }
    function changeShareChoices(session, change, focusClass, versionId) {
      const share = shareState(session);
      if (!share.open || ['loading', 'sending'].includes(share.phase)) return;
      change(share.choices); share.error = ''; share.message = '';
      try { makeShareDraft(session); } catch (error) { share.error = shareError(error); }
      redraw();
      [...bodyNode.querySelectorAll('.' + focusClass)].find(control => control.dataset.versionId === versionId)?.focus({ preventScroll: true });
    }
    async function sendShare(session, actionName, retry = false) {
      const share = shareState(session), sequence = share.sequence;
      if (!sharing(session, sequence) || ['loading', 'sending'].includes(share.phase)) return;
      try {
        const remote = owner();
        if (!retry) {
          if (remote.pending(session.workspaceId)) throw fault('pending_operation');
          if (!share.loaded || !share.head) throw fault('share_not_checked', '공개 상태를 먼저 확인해 주세요.');
          if (actionName === 'publish') {
            if (!share.consented || !share.draft) throw fault('share_not_reviewed', '공개할 사본과 공개 범위를 먼저 확인해 주세요.');
            share.phase = 'sending'; share.error = ''; share.message = ''; redraw();
            await flush();
            if (!sharing(session, sequence)) return;
            const latest = life.Share.makeDraft(getBundle(), session.state, share.choices);
            if (share.draft.edit !== session.edit || share.draft.revision !== getBundle().revision || session.remoteRevision > session.baseRevision ||
                JSON.stringify(latest.snapshot) !== share.draft.signature) {
              share.draft = null; share.consented = false;
              throw fault('share_draft_changed', '검토한 뒤 구성이 바뀌었습니다. 공개할 내용을 다시 확인해 주세요.');
            }
          }
        }
        share.phase = 'sending'; share.error = ''; share.message = ''; redraw();
        const result = retry ? await remote.retryPending(session.workspaceId) : await remote.put({ workspaceId: session.workspaceId,
          expectedRevision: share.head.revision, operationId: global.crypto.randomUUID(), action: actionName,
          snapshot: actionName === 'publish' ? share.draft.snapshot : null });
        if (!sharing(session, sequence)) return;
        // An idempotent receipt may describe an older operation; read the current server head.
        share.loaded = false; share.draft = null; share.consented = false; share.revokeConfirm = false;
        const head = await remote.get(session.workspaceId);
        if (!sharing(session, sequence)) return;
        share.head = head; share.loaded = true; share.phase = 'ready';
        if (result?.status === 'conflict' || result?.status === 'missing') {
          share.error = '다른 기기에서 공개본이 바뀌었습니다. 최신 공개 상태를 읽었습니다. 내용을 다시 검토한 뒤 적용해 주세요.';
        } else share.message = head.status === 'published' ? '서버에서 공개 상태를 확인했습니다.' : head.status === 'revoked' ? '서버에서 공개 철회를 확인했습니다.' : '아직 게시한 사본이 없습니다.';
        announceSafe(share.error || share.message, session);
      } catch (error) {
        if (!sharing(session, sequence)) return;
        share.error = shareError(error); share.phase = 'error';
        // A transport error cannot prove whether a public change committed.
        if (error?.code === 'publish_unknown' || error?.code === 'request_cancelled') share.loaded = false;
      }
      if (sharing(session, sequence)) {
        redraw();
        const target = bodyNode.querySelector(share.error ? '#wbShareError' : '#wbShareUrl') || bodyNode.querySelector('#wbShareStatus');
        if (target) { if (!target.matches('a[href],button,input,select,textarea,[tabindex]')) target.tabIndex = -1; target.focus({ preventScroll: true }); }
      }
    }
    function renderSharePanel(session) {
      const share = shareState(session), busy = ['loading', 'sending'].includes(share.phase);
      const box = el('section', null, 'wb-share'); box.id = 'wbSharePanel'; box.setAttribute('aria-label', '공개 사본 관리');
      box.setAttribute('aria-busy', String(busy));
      const header = el('div', null, 'wb-row');
      const back = icon('페이지 편집으로 돌아가기', 'back', () => {
        share.open = false; share.sequence += 1; share.draft = null; share.consented = false; preview = false; redraw();
        surface.querySelector('#wbPageShare')?.focus();
      }); back.id = 'wbShareBack';
      header.append(back, el('h3', '공개 사본', 'wb-grow'));
      box.append(header);
      const status = el('p', share.phase === 'loading' ? '공개 상태를 확인하는 중…' : share.phase === 'sending' ? '서버에 요청 중…' :
        !share.loaded ? '공개 상태 확인 필요' : share.head?.status === 'published' ? '공개 중' : share.head?.status === 'revoked' ? '공개 철회됨' : '아직 게시하지 않음', 'life-meta');
      status.id = 'wbShareStatus'; status.setAttribute('role', 'status'); box.append(status);
      const error = el('p', share.error, 'wb-incoming-error'); error.id = 'wbShareError'; error.setAttribute('role', 'alert'); error.hidden = !share.error; box.append(error);
      if (share.message) box.append(notice(share.message));
      let pending = null, pendingError = null;
      try { pending = shareRemote?.pending(session.workspaceId); } catch (cause) { pendingError = cause; error.textContent = shareError(cause); error.hidden = false; }
      if (pending) box.append(notice('아직 확인하지 못한 요청이 있습니다. 새 게시 대신 같은 요청의 결과를 확인해 주세요.'));
      if (share.loaded && share.head?.status === 'published' && !pending && !pendingError) {
        const link = el('a', '공개 페이지 열기', 'wb-source-link'); link.id = 'wbShareUrl';
        link.href = sharePublicUrl(share.head.publicId); link.target = '_blank'; link.rel = 'noopener noreferrer';
        const copyLink = action('링크 복사', async () => {
          const sequence = share.sequence;
          if (!global.navigator.clipboard?.writeText) { share.error = '링크 복사를 지원하지 않습니다. 공개 페이지를 연 뒤 주소를 복사해 주세요.'; redraw(); return; }
          try { await global.navigator.clipboard.writeText(link.href); if (sharing(session, sequence)) announceSafe('공개 링크를 복사했습니다.', session); }
          catch (_) { if (sharing(session, sequence)) { share.error = '링크를 복사하지 못했습니다. 공개 페이지를 연 뒤 주소를 복사해 주세요.'; redraw(); } }
        }); copyLink.id = 'wbShareCopy';
        const links = el('div', null, 'life-actions'); links.append(link, copyLink); box.append(links);
      }
      const actions = el('div', null, 'life-actions');
      const refresh = action('공개 상태 다시 확인', () => refreshShare(session)); refresh.id = 'wbShareRefresh'; refresh.disabled = busy; actions.append(refresh);
      if (pending) {
        const retry = action('같은 요청 다시 확인', () => sendShare(session, pending.action, true)); retry.id = 'wbShareRetry'; retry.disabled = busy; actions.append(retry);
      } else if (share.loaded && !pendingError) {
        const review = action(share.draft ? '공개 내용 다시 확인' : '공개할 내용 검토', async () => {
          const sequence = share.sequence;
          await flush();
          if (!sharing(session, sequence)) return;
          share.error = ''; share.message = ''; share.revokeConfirm = false;
          try { makeShareDraft(session); } catch (cause) { share.error = shareError(cause); }
          redraw();
        }); review.id = 'wbShareReview'; review.disabled = busy; actions.append(review);
        if (share.head?.status === 'published') {
          const revoke = action('공개 철회', () => { share.revokeConfirm = true; share.consented = false; redraw(); bodyNode.querySelector('#wbShareRevokeConfirm')?.focus(); });
          revoke.id = 'wbShareRevoke'; revoke.disabled = busy; actions.append(revoke);
        }
      }
      box.append(actions);
      if (share.revokeConfirm && !pending && !pendingError) {
        const confirmation = el('section', null, 'wb-share-confirm');
        confirmation.append(el('h3', '공개를 철회할까요?'), notice('이 주소에서 사본을 읽을 수 없게 됩니다. 이미 외부에 복사된 내용까지 지워지지는 않습니다.'));
        const revoke = action('공개 철회 확인', () => sendShare(session, 'revoke')); revoke.id = 'wbShareRevokeConfirm'; revoke.disabled = busy;
        confirmation.append(revoke, action('철회 취소', () => { share.revokeConfirm = false; redraw(); bodyNode.querySelector('#wbShareRevoke')?.focus(); })); box.append(confirmation);
      } else if (!pending && !pendingError) {
        if (share.reviewRows.length) renderShareChoices(session, box, busy);
        if (share.draft) {
          const previewBox = el('section', null, 'wb-share-preview'); previewBox.id = 'wbSharePreview';
          previewBox.append(el('h3', '공개 전 확인'), life.ShareView.render(share.draft.snapshot, { headingLevel: 3 })); box.append(previewBox);
          const consent = toggle('이 사본을 누구나 볼 수 있는 주소로 공개합니다.', share.consented, value => {
            share.consented = value; box.querySelector('#wbSharePublish').disabled = !value;
          }, { id: 'wbShareConsent' }); consent.querySelector('input').disabled = busy;
          const publish = action(share.head?.status === 'published' ? '이 사본으로 공개본 갱신' : '이 사본 게시', () => sendShare(session, 'publish'), 'life-primary');
          publish.id = 'wbSharePublish'; publish.disabled = busy || !share.consented;
          box.append(consent, publish, notice('표시한 사본만 공개합니다. 이후 편집 내용은 다시 갱신하기 전까지 반영되지 않습니다.'));
        }
      }
      bodyNode.append(box);
    }
    function renderShareChoices(session, box, busy) {
      const share = session.share;
      const choices = details('공개할 본문·인용 선택', { open: share.choicesOpen }); choices.id = 'wbShareChoices';
      choices.addEventListener('toggle', () => { if (choices.isConnected) share.choicesOpen = choices.open; });
      choices.append(notice('기본은 제목·출처 카드입니다. 다른 사람의 글은 공개해도 되는 본문이나 인용만 직접 골라 주세요.'));
      share.reviewRows.forEach(row => {
        const article = el('section', null, 'wb-share-part'); article.dataset.versionId = row.versionId;
        article.append(el('h4', row.title));
        const info = sourceInfo(row.versionId);
        if (info) article.append(el('p', sourceMeta(info), 'life-meta'));
        const body = toggle('본문 공개', share.choices.bodyVersionIds.includes(row.versionId), checked => changeShareChoices(session, value => {
          value.bodyVersionIds = checked ? value.bodyVersionIds.concat(row.versionId) : value.bodyVersionIds.filter(id => id !== row.versionId);
          if (checked) value.excerpts = value.excerpts.filter(item => item.versionId !== row.versionId);
        }, 'wb-share-body', row.versionId), { 'data-version-id': row.versionId, class: 'wb-share-body' });
        body.querySelector('input').disabled = busy || !row.canIncludeBody; article.append(body);
        if (!row.canIncludeBody && typeof row.text === 'string') article.append(notice('페이지 편집에서 원문 본문 표시를 켜면 선택할 수 있습니다.'));
        if (row.canIncludeBody && typeof row.text === 'string' && row.text.length) {
          const quote = details('인용 구간 선택', { open: share.quoteOpen.has(row.versionId) });
          quote.addEventListener('toggle', () => { if (quote.isConnected) {
            if (quote.open) share.quoteOpen.add(row.versionId); else share.quoteOpen.delete(row.versionId);
          } });
          quote.append(notice('아래 원문에서 공개할 구절을 선택해 주세요.'));
          const input = el('textarea', null, 'wb-share-excerpt'); input.readOnly = true; input.rows = 6; input.value = row.text;
          input.dataset.versionId = row.versionId; input.setAttribute('aria-label', row.title + ' 인용할 구절 선택');
          // Textarea normalizes CRLF/CR. Convert its UTF-16 offsets back to unchanged source text.
          const rawOffset = value => { let raw = 0, displayed = 0; while (raw < row.text.length && displayed < value) {
            if (row.text[raw] === '\r' && row.text[raw + 1] === '\n') raw += 2; else raw += 1; displayed += 1;
          } return raw; };
          const use = action('선택 구절 사용', () => {
            const start = rawOffset(input.selectionStart), end = rawOffset(input.selectionEnd);
            if (start === end) {
              share.error = '원문에서 공개할 구절을 먼저 선택해 주세요.';
              const error = bodyNode.querySelector('#wbShareError'); error.textContent = share.error; error.hidden = false; input.focus(); return;
            }
            changeShareChoices(session, value => {
              value.bodyVersionIds = value.bodyVersionIds.filter(id => id !== row.versionId);
              value.excerpts = value.excerpts.filter(item => item.versionId !== row.versionId).concat({ versionId: row.versionId, start, end });
            }, 'wb-share-use-excerpt', row.versionId);
          }); use.classList.add('wb-share-use-excerpt'); use.dataset.versionId = row.versionId; use.disabled = busy;
          quote.append(input, use); article.append(quote);
        }
        const excerpt = share.choices.excerpts.find(item => item.versionId === row.versionId);
        if (excerpt) {
          article.append(el('blockquote', row.text.slice(excerpt.start, excerpt.end), 'wb-share-quote'));
          const clear = action('인용 선택 해제', () => changeShareChoices(session, value => { value.excerpts = value.excerpts.filter(item => item.versionId !== row.versionId); }, 'wb-share-body', row.versionId));
          clear.classList.add('wb-share-clear-excerpt'); clear.dataset.versionId = row.versionId; clear.disabled = busy; article.append(clear);
        }
        choices.append(article);
      });
      box.append(choices);
    }
    function publicShowing(token, session, listing) {
      return showing(token, session) && mode === 'public-pages' && publicList === listing;
    }
    async function loadPublicPages(more = false) {
      const listing = publicList, session = current, token = generation;
      if (!listing || listing.busy) return;
      const focusId = ['wbPublicPagesRefresh', 'wbPublicPagesMore'].includes(document.activeElement?.id) ? document.activeElement.id : null;
      listing.busy = true; listing.error = ''; listing.message = ''; listing.confirm = null; redraw();
      try {
        const result = await owner().list(more ? listing.nextCursor : null);
        if (!publicShowing(token, session, listing)) return;
        const rows = more ? listing.rows.slice() : [];
        result.pages.forEach(row => { const index = rows.findIndex(item => item.workspaceId === row.workspaceId); if (index < 0) rows.push(row); else rows[index] = row; });
        listing.rows = rows; listing.nextCursor = result.nextCursor; listing.loaded = true;
      } catch (error) { if (publicShowing(token, session, listing)) listing.error = shareError(error); }
      finally { if (publicShowing(token, session, listing)) {
        listing.busy = false; redraw();
        if (focusId) (bodyNode.querySelector('#' + focusId) || bodyNode.querySelector('#wbPublicPagesRefresh'))?.focus({ preventScroll: true });
      } }
    }
    async function managePublicPage(row, intent) {
      const listing = publicList, session = current, token = generation;
      if (!listing || listing.busy) return;
      listing.busy = true; listing.error = ''; listing.message = ''; redraw();
      const updateHead = head => {
        listing.confirm = null;
        if (head.status !== 'published') {
          listing.rows = listing.rows.filter(item => item.workspaceId !== row.workspaceId);
          listing.message = '이 사본이 공개되지 않은 상태를 서버에서 확인했습니다.';
          return false;
        }
        const index = listing.rows.findIndex(item => item.workspaceId === row.workspaceId);
        const changed = head.revision !== row.revision || head.publicId !== row.publicId;
        if (index >= 0) listing.rows[index] = { ...row, ...head, title: changed ? '공개 내용이 바뀐 페이지' : row.title };
        listing.message = changed ? '공개본이 바뀌었습니다. 현재 공개 페이지를 확인한 뒤 다시 철회를 선택해 주세요.' : '현재 이 페이지가 공개 중인 상태를 서버에서 확인했습니다.';
        return true;
      };
      try {
        const remote = owner();
        if (intent === 'retry') {
          await remote.retryPending(row.workspaceId);
          if (!publicShowing(token, session, listing)) return;
          const head = await remote.get(row.workspaceId);
          if (!publicShowing(token, session, listing)) return;
          updateHead(head);
        } else {
          if (remote.pending(row.workspaceId)) throw fault('pending_operation');
          const head = await remote.get(row.workspaceId);
          if (!publicShowing(token, session, listing)) return;
          if (head.status !== 'published' || head.revision !== row.revision || head.publicId !== row.publicId) { updateHead(head); return; }
          if (intent === 'prepare') listing.confirm = { workspaceId: row.workspaceId, revision: head.revision, publicId: head.publicId };
          else {
            const confirmed = listing.confirm;
            if (!confirmed || confirmed.workspaceId !== row.workspaceId || confirmed.revision !== head.revision || confirmed.publicId !== head.publicId)
              throw fault('share_not_reviewed', '철회할 공개 페이지를 다시 확인해 주세요.');
            await remote.put({ workspaceId: row.workspaceId, expectedRevision: head.revision,
              operationId: global.crypto.randomUUID(), action: 'revoke', snapshot: null });
            if (!publicShowing(token, session, listing)) return;
            const latest = await remote.get(row.workspaceId);
            if (!publicShowing(token, session, listing)) return;
            updateHead(latest);
          }
        }
      } catch (error) { if (publicShowing(token, session, listing)) { listing.error = shareError(error); listing.confirm = null; } }
      finally { if (publicShowing(token, session, listing)) {
        listing.busy = false; redraw();
        const article = [...bodyNode.querySelectorAll('.wb-public-page')].find(item => item.dataset.workspaceId === row.workspaceId);
        (article?.querySelector(listing.confirm ? '.wb-public-revoke-confirm' : '.wb-public-retry,.wb-public-revoke') || bodyNode.querySelector('#wbPublicPagesRefresh'))?.focus({ preventScroll: true });
      } }
    }
    function renderPublicPages() {
      const listing = publicList ||= { rows: [], nextCursor: null, loaded: false, started: false, busy: false, error: '', message: '', confirm: null };
      const box = el('section', null, 'wb-public-pages'); box.id = 'wbPublicPages'; box.setAttribute('aria-busy', String(listing.busy));
      const status = el('p', listing.busy ? '공개 상태를 확인하는 중…' : listing.error ? '공개 상태 다시 확인 필요' : listing.loaded ? '이 계정에서 공개한 페이지' : '공개 목록 확인 필요', 'life-meta');
      status.id = 'wbPublicPagesStatus'; status.setAttribute('role', 'status'); box.append(status);
      const error = el('p', listing.error, 'wb-incoming-error'); error.id = 'wbPublicPagesError'; error.setAttribute('role', 'alert'); error.hidden = !listing.error; box.append(error);
      if (listing.message) box.append(notice(listing.message));
      const refresh = action('공개 목록 다시 확인', () => loadPublicPages()); refresh.id = 'wbPublicPagesRefresh'; refresh.disabled = listing.busy; box.append(refresh);
      if (listing.loaded && !listing.rows.length) box.append(empty('현재 공개한 페이지가 없습니다.'));
      listing.rows.forEach(row => {
        const article = el('article', null, 'wb-feed wb-public-page'); article.dataset.workspaceId = row.workspaceId;
        article.append(el('h3', row.title), el('p', '서버 갱신 · ' + new Date(row.updatedAt).toLocaleString('ko-KR'), 'life-meta'));
        const actions = el('div', null, 'life-actions');
        const link = el('a', '공개 페이지 열기', 'wb-source-link wb-public-link'); link.href = sharePublicUrl(row.publicId); link.target = '_blank'; link.rel = 'noopener noreferrer';
        actions.append(link);
        let pending = null, pendingError = null;
        try { pending = shareRemote?.pending(row.workspaceId); } catch (cause) { pendingError = cause; }
        if (pendingError) article.append(el('p', shareError(pendingError), 'wb-incoming-error'));
        else if (pending) {
          article.append(notice('이 페이지에 확인하지 못한 요청이 있습니다.'));
          const retry = action('같은 요청 다시 확인', () => managePublicPage(row, 'retry')); retry.classList.add('wb-public-retry'); retry.disabled = listing.busy; actions.append(retry);
        } else {
          const revoke = action('공개 철회', () => managePublicPage(row, 'prepare')); revoke.classList.add('wb-public-revoke'); revoke.disabled = listing.busy; actions.append(revoke);
        }
        article.append(actions);
        if (listing.confirm?.workspaceId === row.workspaceId && !pending && !pendingError) {
          const confirm = el('section', null, 'wb-share-confirm');
          confirm.append(notice('이 페이지의 공개 주소를 닫습니다. 이미 외부에 복사된 내용까지 지워지지는 않습니다.'));
          const revoke = action('공개 철회 확인', () => managePublicPage(row, 'revoke')); revoke.classList.add('wb-public-revoke-confirm'); revoke.disabled = listing.busy;
          const cancel = action('철회 취소', () => {
            listing.confirm = null; redraw();
            [...bodyNode.querySelectorAll('.wb-public-page')].find(item => item.dataset.workspaceId === row.workspaceId)?.querySelector('.wb-public-revoke')?.focus({ preventScroll: true });
          }); cancel.classList.add('wb-public-revoke-cancel'); cancel.disabled = listing.busy;
          confirm.append(revoke, cancel); article.append(confirm);
        }
        box.append(article);
      });
      if (listing.nextCursor) { const more = action('공개 페이지 더 보기', () => loadPublicPages(true)); more.id = 'wbPublicPagesMore'; more.disabled = listing.busy; box.append(more); }
      bodyNode.append(box);
      if (!listing.started) { listing.started = true; loadPublicPages(); }
    }
    function pagePart(part, entry, index) {
      const info = sourceInfo(part.versionId);
      const section = el('div', null, 'wb-page-part'); section.dataset.versionId = part.versionId;
      if (!info) {
        section.append(el('p', '연결된 원문 없음', 'wb-source-title'), notice('이 버전은 현재 공간에 없습니다. 다른 버전으로 바꾸지 않았습니다.'));
        return section;
      }
      const title = el('h4', info.source.title, 'wb-source-title wb-page-part-title');
      title.hidden = index === 0 && info.source.title === entry.title; section.append(title);
      const origin = life.Writing?.isOwnSource(info.source, getBundle()) ? '내 글' : ORIGINS[info.source.origin] || '기타';
      const metadata = [origin];
      if (info.version.originalAuthor.relation !== 'self') metadata.push(info.version.originalAuthor.relation === 'other' ? '다른 사람의 기록' : '작성자 관계 미확인');
      if (info.version.contentText == null) metadata.push('본문 미확보');
      else if (info.version.coverage.status === 'partial') metadata.push('일부 본문');
      else if (info.version.coverage.status === 'unknown') metadata.push('확보 범위 미확인');
      if (info.total > 1) metadata.push(info.number + '/' + info.total + ' 버전');
      section.append(el('p', metadata.join(' · '), 'life-meta wb-page-source-meta'));
      if (entry.showBody && info.version.contentText != null) section.append(el('p', info.version.contentText, 'wb-source-body'));
      return section;
    }
    function renderPage() {
      const session = current, page = session.state.page;
      if (session.share?.open) { renderSharePanel(session); return; }
      const switchButton = action(preview ? '편집으로 돌아가기' : '방문자 미리보기', async () => {
        const token = generation;
        await flush();
        if (!showing(token, session)) return;
        rememberPageEditor(); preview = !preview; redraw();
        if (preview || !restorePageEditor(session, true)) surface.querySelector('#wbPagePreview')?.focus();
      });
      switchButton.id = 'wbPagePreview'; switchButton.setAttribute('aria-pressed', String(preview));
      const actions = el('div', null, 'life-actions wb-page-actions');
      const publish = discoveryIcon('공개 사본 관리', 'link', () => openShare(session)); publish.id = 'wbPageShare';
      actions.append(switchButton, publish);
      if (saveControl) actions.append(saveControl);
      if (preview) {
        bodyNode.append(actions, notice('비공개 미리보기')); renderVisitor(page); return;
      }
      const lead = el('div', null, 'wb-page-lead');
      const title = el('h2', '', 'wb-visitor-title'), intro = el('p', '', 'wb-visitor-intro');
      lead.append(title, intro);
      const refreshLead = () => {
        title.textContent = page.title; title.hidden = !page.title.trim() || page.title === MODES.page;
        intro.textContent = page.intro; intro.hidden = !page.showIntro || !page.intro;
        lead.hidden = title.hidden && intro.hidden;
      };
      refreshLead(); bodyNode.append(lead, actions);
      const pageSettings = details('제목·소개·표시 설정', { open: !page.entries.length }); pageSettings.classList.add('wb-page-settings');
      const pageField = (control, key) => {
        control.input.dataset.pageField = key;
        control.input.addEventListener('focus', () => { if (workspaceIs(session)) session.pageFieldFocus = key; });
        return control.wrapper;
      };
      const editPage = discoveryIcon('페이지 설정', 'settings', () => { pageSettings.open = true; pageSettings.querySelector('summary').focus(); pageSettings.scrollIntoView({ block: 'nearest' }); });
      editPage.id = 'wbPageSettings'; actions.append(editPage);
      pageSettings.append(pageField(field('페이지 제목', page.title, { id: 'wbPageTitle', change: value => { page.title = value; refreshLead(); } }), 'page:title'));
      pageSettings.append(pageField(field('소개', page.intro, { id: 'wbPageIntro', multiline: true, max: limits.text, change: value => { page.intro = value; refreshLead(); } }), 'page:intro'));
      pageSettings.append(toggle('소개 표시', page.showIntro, value => { page.showIntro = value; mark(session); refreshLead(); }, { id: 'wbShowIntro' }));
      pageSettings.append(toggle('고정하지 않은 항목 표시', page.showRecent, value => {
        page.showRecent = value; mark(session); entryViews.forEach(view => view.refresh());
      }, { id: 'wbShowRecent' }));
      const add = details('자료·묶음 추가'); add.classList.add('wb-page-add');
      let selection = [];
      add.append(picker('원문에서 고르기', () => selection, (id, checked) => { selection = checked ? selection.concat(id) : selection.filter(value => value !== id); }, { max: limits.parts }));
      add.append(action('선택한 원문 추가', () => addEntry(sourceName(selection[0]), selection)));
      session.state.groups.forEach(group => add.append(action(group.title + ' 추가', () => addEntry(group.title, group.versionIds), 'wb-group-add')));
      add.append(notice('묶음을 추가한 뒤 구성은 별도로 편집됩니다. 묶음 연결을 바꿔도 이 항목이 자동 변경되지 않습니다.'));
      const setup = el('div', null, 'wb-page-setup'); setup.append(pageSettings, add);
      const entriesHost = el('div', null, 'wb-page-entries');
      const none = empty('보여줄 원문이나 묶음을 골라 내 페이지를 구성해 보세요.'); none.id = 'wbPageEmpty';
      const entryViews = new Map();
      function reorder() {
        const focus = document.activeElement;
        const ordered = page.entries.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned));
        ordered.forEach((entry, index) => {
          const article = entryViews.get(entry.id).article;
          if (entriesHost.children[index] !== article) entriesHost.insertBefore(article, entriesHost.children[index] || null);
        });
        page.entries.forEach(entry => {
          const peers = ordered.filter(item => item.pinned === entry.pinned), index = peers.indexOf(entry);
          const view = entryViews.get(entry.id); view.up.disabled = index === 0; view.down.disabled = index === peers.length - 1;
        });
        none.hidden = page.entries.length > 0;
        if (focus?.isConnected && document.activeElement !== focus) focus.focus({ preventScroll: true });
      }
      function move(entry, direction) {
        const peers = page.entries.filter(item => item.pinned === entry.pinned), index = peers.indexOf(entry), other = peers[index + direction];
        if (index < 0 || !other) return;
        const from = page.entries.indexOf(entry), to = page.entries.indexOf(other);
        [page.entries[from], page.entries[to]] = [other, entry]; mark(session); reorder();
      }
      page.entries.forEach(entry => {
        const article = el('article', null, 'wb-feed wb-page-entry'); article.dataset.entryId = entry.id;
        const row = el('div', null, 'wb-row wb-page-entry-heading');
        const heading = el('h3', entry.title, 'wb-grow'); row.append(heading);
        const pin = el('span', null, 'wb-page-pin'); pin.append(life.Icons.create('bookmark'), el('span', '고정한 항목', 'life-sr-only')); row.append(pin);
        const hidden = el('p', '', 'life-meta wb-page-hidden');
        const content = el('div', null, 'wb-page-content');
        const sourceContent = el('div', null, 'wb-page-parts');
        const note = el('div', null, 'wb-comment'), noteBody = el('p', '', 'wb-comment-body');
        note.append(el('p', '내 코멘트', 'life-meta'), noteBody);
        const noContent = notice('표시할 내용이 없습니다. 항목 편집에서 원문이나 코멘트를 선택해 주세요.');
        content.append(sourceContent, note, noContent);
        const settings = details('항목 편집'); settings.classList.add('wb-page-entry-edit'); settings.id = 'wbPageEntryEdit-' + entry.id;
        const editEntry = discoveryIcon('항목 편집', 'edit', () => {
          settings.open = true; settings.querySelector('summary').focus(); settings.scrollIntoView({ block: 'nearest' });
        });
        editEntry.classList.add('wb-page-entry-open'); editEntry.setAttribute('aria-controls', settings.id); editEntry.setAttribute('aria-expanded', 'false');
        settings.addEventListener('toggle', () => { editEntry.setAttribute('aria-expanded', String(settings.open)); });
        row.append(editEntry);
        let enabled, pinned, renderedParts = null;
        const refresh = () => {
          const entryTitle = entry.title || '제목 입력 중';
          if (heading.textContent !== entryTitle) heading.textContent = entryTitle;
          pin.hidden = !entry.pinned;
          const shown = entry.enabled && (entry.pinned || page.showRecent);
          article.dataset.shown = String(shown); hidden.hidden = shown;
          hidden.textContent = entry.enabled ? '고정하지 않은 항목 · 미리보기에서 숨김' : '미리보기에서 숨김';
          content.hidden = !shown;
          if (shown) {
            const parts = entry.parts.filter(part => part.enabled);
            const partsKey = JSON.stringify([getBundle().revision, entry.showBody, parts.map(part => part.versionId)]);
            if (renderedParts !== partsKey) {
              sourceContent.replaceChildren(...parts.map((part, index) => pagePart(part, entry, index))); renderedParts = partsKey;
            }
            const firstTitle = sourceContent.firstElementChild?.querySelector('.wb-page-part-title');
            if (firstTitle) firstTitle.hidden = firstTitle.textContent === entry.title;
            note.hidden = !entry.showNote || !entry.note;
            if (noteBody.textContent !== entry.note) noteBody.textContent = entry.note;
            noContent.hidden = parts.length > 0 || !note.hidden;
          }
          if (enabled) { enabled.setAttribute('aria-label', entry.enabled ? '이 항목 숨기기' : '이 항목 표시'); enabled.setAttribute('aria-pressed', String(entry.enabled)); enabled.querySelector('.life-tooltip').textContent = enabled.getAttribute('aria-label'); }
          if (pinned) { pinned.setAttribute('aria-label', entry.pinned ? '항목 고정 해제' : '항목 고정'); pinned.setAttribute('aria-pressed', String(entry.pinned)); pinned.querySelector('.life-tooltip').textContent = pinned.getAttribute('aria-label'); }
        };
        const flags = el('div', null, 'life-actions wb-page-flags');
        enabled = discoveryIcon(entry.enabled ? '이 항목 숨기기' : '이 항목 표시', 'check', () => { entry.enabled = !entry.enabled; mark(session); refresh(); }, entry.enabled);
        pinned = discoveryIcon(entry.pinned ? '항목 고정 해제' : '항목 고정', 'bookmark', () => { entry.pinned = !entry.pinned; mark(session); refresh(); reorder(); }, entry.pinned);
        flags.append(enabled, pinned); settings.append(flags);
        settings.append(pageField(field('항목 제목', entry.title, { change: value => { entry.title = value; refresh(); } }), entry.id + ':title'));
        settings.append(pageField(field('내 코멘트', entry.note, { multiline: true, max: limits.text, change: value => { entry.note = value; refresh(); } }), entry.id + ':note'));
        settings.append(toggle('원문 본문 표시', entry.showBody, value => { entry.showBody = value; mark(session); refresh(); }));
        settings.append(toggle('내 코멘트 표시', entry.showNote, value => { entry.showNote = value; mark(session); refresh(); }));
        const partsHost = el('div', null, 'wb-page-part-settings');
        const refreshParts = () => {
          partsHost.replaceChildren();
          entry.parts.forEach(part => {
            const partRow = el('div', null, 'wb-part'); partRow.dataset.partVersionId = part.versionId;
            partRow.append(toggle(sourceName(part.versionId) + ' 표시', part.enabled, value => { part.enabled = value; mark(session); refresh(); }));
            partRow.append(sourceRow(part.versionId, { hideTitle: true, showLink: true, focusKey: 'page:part:' + entry.id + ':' + part.versionId }));
            const info = sourceInfo(part.versionId);
            if (info?.version.originalAuthor.label) partRow.append(el('p', '원 작성자 · ' + info.version.originalAuthor.label, 'life-meta'));
            if (info?.version.coverage.omissions.length) partRow.append(el('p', '포함되지 않은 내용 · ' + info.version.coverage.omissions.join(' · '), 'life-meta'));
            if (!info) partRow.append(action('없는 원문 연결 해제', () => { entry.parts = entry.parts.filter(item => item.versionId !== part.versionId); mark(session); refreshParts(); refresh(); }));
            partsHost.append(partRow);
          });
        };
        refreshParts(); settings.append(partsHost);
        settings.append(picker('이 항목의 원문 선택', () => entry.parts.map(part => part.versionId), (id, checked) => {
          entry.parts = checked ? entry.parts.concat({ versionId: id, enabled: true }) : entry.parts.filter(part => part.versionId !== id);
          mark(session); refreshParts(); refresh();
        }, { max: limits.parts }));
        const itemActions = el('div', null, 'life-actions');
        const peers = () => page.entries.filter(item => item.pinned === entry.pinned);
        const up = action('위로', () => move(entry, -1), '', () => peers().indexOf(entry) > 0);
        const down = action('아래로', () => move(entry, 1), '', () => peers().indexOf(entry) < peers().length - 1);
        itemActions.append(up, down, action('페이지에서 제거', () => {
          page.entries = page.entries.filter(item => item.id !== entry.id); mark(session); article.remove(); entryViews.delete(entry.id); reorder();
          if (!page.entries.length) { pageSettings.open = true; add.open = true; add.querySelector('summary').focus({ preventScroll: true }); }
        }));
        settings.append(itemActions, notice('미리보기 구성만 바뀝니다. 보관한 원문과 묶음은 유지합니다.'));
        article.append(row, hidden, content, settings); entryViews.set(entry.id, { article, refresh, up, down }); refresh();
      });
      reorder(); bodyNode.append(entriesHost, none, setup);
      restorePageEditor(session);
    }
    function renderVisitor(page) {
      const visitor = el('section', null, 'wb-visitor'); visitor.id = 'wbVisitor'; visitor.setAttribute('aria-label', '비공개 방문자 미리보기');
      if (page.title !== MODES.page) visitor.append(el('h3', page.title, 'wb-visitor-title'));
      if (page.showIntro && page.intro) visitor.append(el('p', page.intro, 'wb-visitor-intro'));
      const entries = page.entries.filter(entry => entry.enabled && (entry.pinned || page.showRecent));
      entries.sort((a, b) => Number(b.pinned) - Number(a.pinned));
      if (!entries.length) visitor.append(empty('표시할 항목이 없습니다. 편집에서 항목 표시를 켜 주세요.'));
      entries.forEach(entry => {
        const article = el('article', null, 'wb-feed'); article.dataset.entryId = entry.id;
        const head = el('div', null, 'wb-row'); head.append(el('h3', entry.title, 'wb-grow'));
        if (entry.pinned) { const pin = life.Icons.create('bookmark'); const note = el('span', '고정한 항목', 'life-sr-only'); head.append(pin, note); }
        article.append(head);
        entry.parts.filter(part => part.enabled).forEach((part, index) => article.append(sourceRow(part.versionId, {
          body: entry.showBody, previewOnly: true, hideTitle: index === 0 && sourceInfo(part.versionId)?.source.title === entry.title
        })));
        if (entry.showNote && entry.note) { const note = el('div', null, 'wb-comment'); note.append(el('p', '내 코멘트', 'life-meta'), el('p', entry.note, 'wb-comment-body')); article.append(note); }
        visitor.append(article);
      });
      bodyNode.append(visitor);
    }
    function discoveryView(session) {
      const key = mode === 'related' ? 'relatedView' : 'discoveryView';
      return session[key] ||= { query: '', seedVersionId: null, chooserOpen: true, excludedOpen: false, criteriaOpen: false, shown: 30, contextError: '' };
    }
    function discoveryIcon(label, glyph, task, pressed) {
      const button = icon(label, glyph, task, pressed); button.removeAttribute('title');
      const tooltip = el('span', label, 'life-tooltip'); tooltip.setAttribute('aria-hidden', 'true'); button.append(tooltip);
      button.addEventListener('keydown', event => { if (event.key === 'Escape') button.dataset.tooltipDismissed = 'true'; });
      const reset = () => { delete button.dataset.tooltipDismissed; };
      button.addEventListener('blur', reset); button.addEventListener('pointerleave', reset);
      return button;
    }
    function renderDiscover() {
      const session = current, token = generation, view = discoveryView(session);
      const relatedHost = el('section', null, 'wb-discovery'); relatedHost.id = 'wbDiscoveryRelated';
      if (view.contextError) {
        const error = el('p', view.contextError, 'wb-discovery-error'); error.id = 'wbDiscoveryContextError'; error.setAttribute('role', 'alert'); bodyNode.append(error);
      }
      const chooser = details(view.seedVersionId ? '기준 기록 바꾸기' : '기준 기록 고르기', { open: !view.seedVersionId || view.chooserOpen });
      chooser.id = 'wbDiscoveryChooser'; chooser.classList.add('wb-discovery-chooser');
      chooser.addEventListener('toggle', () => { if (chooser.isConnected && showing(token, session)) view.chooserOpen = chooser.open; });
      const search = field('저장한 자료에서 찾을 말', view.query, { id: 'wbDiscoverQuery' });
      search.input.type = 'search';
      const list = el('div'); list.id = 'wbDiscoverResults';
      const count = el('p', '', 'life-meta'); count.setAttribute('role', 'status');
      let composing = false;
      const more = action('검색 결과 더 보기', () => { view.shown += 30; fill(); });
      async function choose(versionId) {
        await flush();
        if (!showing(token, session)) return;
        view.seedVersionId = versionId; view.chooserOpen = !versionId; view.excludedOpen = false;
        view.contextError = ''; bodyNode.querySelector('#wbDiscoveryContextError')?.remove();
        chooser.open = view.chooserOpen; chooser.querySelector('summary').textContent = versionId ? '기준 기록 바꾸기' : '기준 기록 고르기';
        fillRelated(); fill();
        (versionId ? relatedHost.querySelector('#wbDiscoverySeed') : search.input)?.focus({ preventScroll: true });
      }
      async function changeExclusions(seedId, candidateId, exclude) {
        const pairs = session.state.discovery?.excludedPairs || [];
        const matches = pair => pair.seedSourceId === seedId && (!candidateId || pair.candidateSourceId === candidateId);
        if (exclude && pairs.some(matches)) return;
        if (exclude && pairs.length >= limits.excludedPairs) throw fault('limit_reached', '제외한 연결이 ' + limits.excludedPairs + '개입니다. 이전에 제외한 연결을 복원한 뒤 다시 선택해 주세요.');
        session.state.discovery = { excludedPairs: exclude ? pairs.concat({ seedSourceId: seedId, candidateSourceId: candidateId }) : pairs.filter(pair => !matches(pair)) };
        mark(session, false); fillRelated();
        (relatedHost.querySelector('#wbDiscoveryExcluded > summary') || relatedHost.querySelector('#wbDiscoverySeed'))?.focus({ preventScroll: true });
        await flushSession(session);
        if (showing(token, session)) announceSafe(exclude ? '이 기준 기록의 관련 목록에서 제외했습니다.' : '이 기준 기록의 제외를 복원했습니다.', session);
      }
      function fillRelated() {
        if (!showing(token, session)) return;
        relatedHost.replaceChildren(); relatedHost.hidden = !view.seedVersionId;
        if (!view.seedVersionId) return;
        const seed = sourceInfo(view.seedVersionId);
        const seedBox = el('section', null, 'wb-discovery-seed'); seedBox.id = 'wbDiscoverySeed'; seedBox.dataset.versionId = view.seedVersionId; seedBox.tabIndex = -1;
        const seedHeading = el('div', null, 'wb-row'); seedHeading.append(el('h3', '기준 기록', 'wb-grow'));
        const clear = discoveryIcon('기준 기록 해제', 'close', () => choose(null)); clear.id = 'wbDiscoveryClear'; seedHeading.append(clear);
        seedBox.append(seedHeading, sourceRow(view.seedVersionId, { focusKey: 'discover:seed:' + view.seedVersionId }));
        if (seed?.total === 1) seedBox.append(el('p', '버전 1/1', 'life-meta'));
        relatedHost.append(seedBox);
        const error = el('p', '', 'wb-discovery-error'); error.id = 'wbDiscoveryError'; error.setAttribute('role', 'alert'); error.hidden = true; relatedHost.append(error);
        let results;
        try {
          if (!seed) throw fault('seed_missing', '기준 원문 버전을 찾지 못했습니다. 다른 버전으로 바꾸지 않았습니다.');
          if (!life.Rediscovery?.related) throw fault('rediscovery_unavailable', '관련 기록 기능을 불러오지 못했습니다. 새로고침한 뒤 다시 확인해 주세요.');
          results = life.Rediscovery.related(getBundle(), session.state, view.seedVersionId, { limit: 3 });
        } catch (cause) {
          error.textContent = cause.message || '관련 기록을 확인하지 못했습니다. 기준 기록을 다시 선택해 주세요.'; error.hidden = false;
          relatedHost.append(action('기준 기록 다시 고르기', () => choose(null)));
          return;
        }
        const heading = el('h3', '함께 읽을 기록', 'wb-discovery-heading'); heading.id = 'wbDiscoveryRelatedHeading';
        relatedHost.append(heading);
        if (!results.length) relatedHost.append(empty('연결 근거가 있는 기록을 찾지 못했습니다. 다른 기준 기록을 고르거나 제외한 연결을 복원해 보세요.'));
        results.forEach(result => {
          const article = el('article', null, 'wb-feed wb-discovery-result'); article.dataset.versionId = result.versionId; article.dataset.sourceId = result.sourceId;
          article.append(sourceRow(result.versionId, { focusKey: 'discover:related:' + result.versionId }));
          if (result.snippet) article.append(el('p', result.snippet, 'wb-result-text'));
          const reasons = el('ul', null, 'wb-discovery-reasons');
          result.reasons.forEach(reason => {
            const label = reason.kind === 'topic' ? '같은 주제' : reason.kind === 'group' ? '같은 묶음' : reason.field === 'title' ? '제목에 함께 나온 말' : reason.field === 'body' ? '본문에 함께 나온 말' : '함께 나온 말';
            reasons.append(el('li', label + ' · ' + reason.label));
          }); article.append(reasons);
          const actions = el('div', null, 'life-actions wb-discovery-actions');
          const focusId = 'wbDiscoveryArrange-' + result.versionId;
          const seedVersionId = view.seedVersionId;
          const arrange = discoveryIcon('기준 기록과 함께 묶음에 담기', 'link', async () => {
            await flush();
            if (!showing(token, session) || view.seedVersionId !== seedVersionId) return;
            if (!sourceInfo(seedVersionId) || !sourceInfo(result.versionId)) throw fault('source_missing', '담을 원문 버전을 찾지 못했습니다. 다른 버전으로 바꾸지 않았습니다.');
            await onArrange({ workspaceId: session.workspaceId, versionIds: [...new Set([seedVersionId, result.versionId])], focusId });
          }); arrange.id = focusId; arrange.classList.add('wb-discovery-arrange');
          const exclude = discoveryIcon('이 기준 기록의 관련 목록에서 제외', 'close', () => changeExclusions(seed.source.id, result.sourceId, true));
          exclude.classList.add('wb-discovery-exclude'); exclude.dataset.sourceId = result.sourceId;
          actions.append(arrange, exclude); article.append(actions); relatedHost.append(article);
        });
        const pairs = (session.state.discovery?.excludedPairs || []).filter(pair => pair.seedSourceId === seed.source.id);
        if (pairs.length) {
          const excluded = details('이 기준 기록에서 제외한 연결 ' + pairs.length + '개', { open: view.excludedOpen }); excluded.id = 'wbDiscoveryExcluded';
          excluded.addEventListener('toggle', () => { if (excluded.isConnected) view.excludedOpen = excluded.open; });
          excluded.append(notice('관련 목록에서만 제외한 연결입니다. 원문은 그대로 남아 있습니다.'));
          pairs.forEach(pair => {
            const title = getBundle().sources.find(source => source.id === pair.candidateSourceId)?.title || '현재 공간에 없는 기록';
            const row = el('div', null, 'wb-row wb-discovery-excluded'); row.append(el('span', title, 'wb-grow'));
            const restore = action('복원', () => changeExclusions(seed.source.id, pair.candidateSourceId, false)); restore.setAttribute('aria-label', title + ' 연결 복원');
            restore.classList.add('wb-discovery-restore'); restore.dataset.sourceId = pair.candidateSourceId; row.append(restore); excluded.append(row);
          });
          const restoreAll = action('이 기준 기록의 제외 모두 복원', () => changeExclusions(seed.source.id, null, false)); restoreAll.id = 'wbDiscoveryRestoreAll'; excluded.append(restoreAll);
          relatedHost.append(excluded);
        }
        const criteria = details('연결 기준', { open: view.criteriaOpen }); criteria.classList.add('wb-discovery-criteria');
        criteria.addEventListener('toggle', () => { if (criteria.isConnected) view.criteriaOpen = criteria.open; });
        criteria.append(notice('같은 주제·묶음 또는 두 개 이상 함께 나온 단어를 비교합니다. 후보는 각 기록의 최신 버전이며, 단어 비교에는 본문 앞 16,000자만 사용합니다. 의미나 취향을 분석한 결과는 아닙니다.'));
        relatedHost.append(criteria);
      }
      const fill = () => {
        if (!showing(token, session)) return;
        view.query = search.input.value;
        const query = view.query.trim(); list.replaceChildren();
        const hits = core.searchSources(getBundle(), query);
        count.textContent = query ? '보관한 자료 ' + hits.length + '건 · 일치한 버전' : '최근 담은 기록에서 시작하기';
        const versions = new Map(getBundle().sourceVersions.map((version, index) => [version.id, { ...version, index }]));
        const visibleHits = query ? hits.slice(0, view.shown) : hits.slice().sort((a, b) => {
          const left = versions.get(a.sourceVersionId), right = versions.get(b.sourceVersionId);
          return right.importedAt.localeCompare(left.importedAt) || right.index - left.index;
        }).slice(0, 3);
        visibleHits.forEach(hit => {
          const article = el('article', null, 'wb-feed'); article.dataset.versionId = hit.sourceVersionId;
          article.append(sourceRow(hit.sourceVersionId, { focusKey: 'discover:search:' + hit.sourceVersionId }));
          const info = sourceInfo(hit.sourceVersionId);
          if (info?.version.contentText != null) {
            const body = info.version.contentText;
            const start = hit.locator ? Math.max(0, hit.locator.start - 70) : 0;
            const end = hit.locator ? Math.min(body.length, hit.locator.end + 150) : Math.min(body.length, 220);
            article.append(el('p', (start ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : ''), 'wb-result-text'));
          }
          const actions = el('div', null, 'life-actions wb-discovery-actions');
          const select = action('관련 기록 보기', () => choose(hit.sourceVersionId), 'life-primary');
          select.setAttribute('aria-pressed', String(view.seedVersionId === hit.sourceVersionId));
          select.classList.add('wb-discovery-select'); select.dataset.versionId = hit.sourceVersionId;
          actions.append(select, discoveryIcon('내 페이지에 추가', 'plus', () => addEntry(info?.source.title, [hit.sourceVersionId]))); article.append(actions);
          list.append(article);
        });
        if (!hits.length) list.append(empty(query ? '일치하는 자료가 없습니다. 다른 표현으로 찾아보세요.' : '보관한 기록이 없습니다. 기록에서 글을 쓰거나 자료를 가져와 주세요.'));
        more.hidden = !query || hits.length <= view.shown;
      };
      search.input.addEventListener('compositionstart', () => { composing = true; });
      search.input.addEventListener('compositionend', () => { composing = false; view.shown = 30; fill(); });
      search.input.addEventListener('input', () => { if (!composing) { view.shown = 30; fill(); } });
      chooser.append(search.wrapper, count, list, more); bodyNode.append(relatedHost, chooser); fillRelated(); fill();
    }
    function renderReflection() {
      const session = current, reflection = session.state.reflection;
      bodyNode.append(notice('고른 자료를 돌아보고 내 생각을 적어보세요.'));
      const overview = el('div', null, 'wb-reflection-overview'); overview.id = 'wbReflectionSummary';
      const selectedList = el('div');
      const fill = () => {
        const infos = reflection.versionIds.map(id => sourceInfo(id));
        const available = infos.filter(Boolean);
        const count = label => available.filter(info => info.version.originalAuthor.relation === label).length;
        overview.replaceChildren();
        overview.append(el('p', '선택한 원문 버전 ' + reflection.versionIds.length + '개', 'wb-source-title'));
        const facts = el('dl', null, 'wb-facts');
        [['내 기록', count('self')], ['다른 사람의 기록', count('other')], ['작성자 관계 미확인', count('unknown')],
          ['본문 미확보', available.filter(info => info.version.contentText == null).length], ['연결된 원문 없음', infos.length - available.length]].forEach(([label, value]) => {
          facts.append(el('dt', label), el('dd', value + '개'));
        });
        const detail = details('집계 기준');
        detail.append(notice('선택한 원문 버전의 개수입니다. 경험 횟수나 관심의 강도를 뜻하지 않습니다.'));
        overview.append(facts, detail);
        selectedList.replaceChildren();
        reflection.versionIds.forEach(id => selectedList.append(sourceRow(id, { remove: () => { reflection.versionIds = reflection.versionIds.filter(value => value !== id); mark(session); redraw(); } })));
      };
      bodyNode.append(picker('회고할 원문 선택', () => reflection.versionIds, (id, checked) => {
        reflection.versionIds = checked ? reflection.versionIds.concat(id) : reflection.versionIds.filter(value => value !== id);
        mark(session); fill();
      }, { max: limits.reflectionVersions }), overview, selectedList);
      bodyNode.append(field('내 회고', reflection.note, { id: 'wbReflectionNote', multiline: true, max: limits.text,
        change: value => { reflection.note = value; } }).wrapper);
      fill();
    }

    function download(data, name) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
      urls.add(url);
      const link = el('a'); link.href = url; link.download = name; link.hidden = true;
      document.body.append(link); link.click(); link.remove();
      global.setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000);
    }
    function downloadDraft(session) {
      if (!workspaceIs(session)) throw fault('workspace_changed', '원래 작업공간에서 초안 사본을 받아 주세요.');
      download(model.makeBackup(getBundle(), session.state), 'haedo-workbench-draft.json');
      announceSafe('초안 JSON 다운로드를 요청했습니다. 파일 보관을 확인해 주세요.', session);
    }
    async function compareSaved(session) {
      const token = generation;
      const saved = await storage.readWorkbench(session.workspaceId);
      if (!showing(token, session)) return;
      const compare = el('section', null, 'wb-conflict');
      compare.append(el('h3', '구성 비교'), notice('내 초안을 적용하면 아래 저장본의 묶음·페이지·회고 구성이 바뀝니다. 보관한 원문은 바뀌지 않습니다.'));
      function summary(state) {
        const text = ['묶음', ...state.groups.map(group => group.title + '\n' + group.versionIds.map(id => sourceName(id)).join('\n')),
          '\n페이지: ' + state.page.title, '소개 표시: ' + (state.page.showIntro ? '켬' : '끔'), state.page.intro,
          '고정하지 않은 항목 표시: ' + (state.page.showRecent ? '켬' : '끔')];
        state.page.entries.forEach(entry => text.push('\n' + entry.title,
          '항목 ' + (entry.enabled ? '표시' : '숨김') + ' · 고정 ' + (entry.pinned ? '켬' : '끔') + ' · 본문 ' + (entry.showBody ? '표시' : '숨김') + ' · 코멘트 ' + (entry.showNote ? '표시' : '숨김'),
          ...entry.parts.map(part => sourceName(part.versionId) + ' · ' + (part.enabled ? '표시' : '숨김')), entry.note));
        text.push('\n회고 원문', ...state.reflection.versionIds.map(id => sourceName(id)), state.reflection.note);
        return text.join('\n');
      }
      const mine = details('내 초안', { open: true }), theirs = details('다른 탭의 저장본', { open: true });
      mine.append(el('pre', summary(session.state), 'wb-comparison-text'));
      theirs.append(el('pre', summary(saved), 'wb-comparison-text'));
      compare.append(mine, theirs, action('비교한 저장본에 내 초안 적용', async () => {
        session.baseRevision = saved.revision; session.state.revision = saved.revision; session.error = null;
        await flush(); clearError(); redraw();
      }), action('초안 유지하고 비교 닫기', () => compare.remove()));
      errorNode.querySelector('.wb-conflict')?.remove(); errorNode.append(compare);
    }
    function renderBackup() {
      const session = current;
      bodyNode.append(notice('보관한 원문·발췌와 묶음·페이지·회고 구성을 함께 담습니다. 미적용 가져오기 초안·사진·연표는 포함하지 않습니다.'));
      const downloadButton = action('통합 JSON 받기', async () => {
        const token = generation;
        await flush();
        if (!showing(token, session)) return;
        const snapshot = await storage.readWorkbenchSnapshot(session.workspaceId);
        if (!showing(token, session)) return;
        download(model.makeBackup(snapshot.bundle, snapshot.workbench), 'haedo-workbench-backup.json');
        announceSafe('통합 JSON 다운로드를 요청했습니다. 파일 보관을 확인해 주세요.', session);
      }, 'life-primary');
      downloadButton.id = 'wbBackupDownload'; bodyNode.append(downloadButton);
      const fileField = el('label', null, 'life-field'); fileField.append(el('span', '통합 구성 JSON으로 새 사본 복원'));
      const file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.id = 'wbRestoreFile'; fileField.append(file);
      const previewHost = el('section', null, 'wb-restore-preview'); previewHost.id = 'wbRestorePreview';
      const token = generation;
      const fill = () => {
        previewHost.replaceChildren();
        if (!restoreCandidate) return;
        const candidate = restoreCandidate;
        previewHost.append(el('h3', '복원 전 확인'), el('p', restoreName, 'life-meta'), el('p', candidate.bundle.title, 'wb-source-title'));
        previewHost.append(notice('자료 ' + candidate.bundle.sources.length + '개 · 원문 버전 ' + candidate.bundle.sourceVersions.length + '개 · 묶음 ' + candidate.workbench.groups.length + '개 · 페이지 항목 ' + candidate.workbench.page.entries.length + '개'));
        previewHost.append(notice('새 작업공간으로 복원합니다. 기존 공간은 유지되고 새 사본은 자동 동기화되지 않습니다.'));
        const install = action('새 사본으로 복원', async () => {
          if (installing) return;
          await beforeRestore(); await flush();
          if (!showing(token, session) || restoreCandidate !== candidate) return;
          installing = true; file.disabled = true;
          const controls = [...surface.querySelectorAll('button,input,textarea,select')].map(control => [control, control.disabled]);
          controls.forEach(([control]) => { control.disabled = true; });
          let result;
          try { result = await storage.installWorkbenchCopy(candidate); }
          finally {
            installing = false;
            controls.forEach(([control, disabled]) => { if (control.isConnected) control.disabled = disabled; });
            if (file.isConnected) file.disabled = false;
          }
          // Installation already committed. Never offer the same install again if screen refresh fails.
          restoreCandidate = null; restoreName = ''; file.value = ''; previewHost.replaceChildren(notice('새 사본을 만들었습니다.'));
          if (!showing(token, session)) return;
          try { await onRestored?.(result); }
          catch (_) { if (previewHost.isConnected) previewHost.append(notice('사본 저장은 완료됐지만 화면을 열지 못했습니다. 관리에서 새 작업공간을 선택해 주세요.')); }
        }, 'life-primary');
        install.id = 'wbRestoreInstall';
        previewHost.append(install, action('복원 취소', () => {
          if (installing) throw fault('restore_in_progress', '새 사본을 저장하는 중입니다. 완료 후 확인해 주세요.');
          restoreSequence += 1; restoreCandidate = null; restoreName = ''; file.value = ''; fill();
        }));
      };
      file.addEventListener('change', async () => {
        if (installing || !showing(token, session)) return;
        const sequence = ++restoreSequence;
        restoreCandidate = null; restoreName = ''; clearError(); previewHost.replaceChildren();
        const selected = file.files?.[0]; if (!selected) return;
        previewHost.append(notice('JSON을 확인하는 중…'));
        try {
          let text;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer()); }
          catch (_) { throw fault('invalid_encoding', 'UTF-8 JSON 파일을 읽지 못했습니다. 파일을 확인하고 다시 선택해 주세요.'); }
          const candidate = await model.restoreBackup(text);
          if (sequence !== restoreSequence || !showing(token, session)) return;
          restoreCandidate = candidate; restoreName = selected.name; fill();
        } catch (error) {
          if (sequence === restoreSequence && showing(token, session)) { previewHost.replaceChildren(); report(error, session); }
        }
      });
      bodyNode.append(fileField, previewHost); fill();
    }

    function redraw() {
      if (!visible || !current || !workspaceIs(current) || mode !== 'public-pages' && !current.state) return;
      rememberPageEditor();
      cleanupView();
      bodyNode.replaceChildren();
      if (saveControl) saveControl.hidden = ['public-pages', 'related'].includes(mode) || !!incoming || mode === 'page' && !!current.share?.open;
      if (mode === 'public-pages') { renderPublicPages(); return; }
      if (incoming && ['activities', 'page'].includes(mode)) { renderIncoming(); updateStatus(current); return; }
      if (mode === 'activities') renderActivities();
      if (mode === 'page') renderPage();
      if (mode === 'discover' || mode === 'related') renderDiscover();
      if (mode === 'reflection') renderReflection();
      if (mode === 'workbench-backup') renderBackup();
      updateStatus(current);
    }
    async function render(nextMode, options = {}) {
      if (!alive()) return;
      const bundle = getBundle(); if (!bundle) return;
      cleanupView();
      const token = ++generation;
      visible = true; mode = MODES[nextMode] ? nextMode : 'activities'; current = sessionFor(bundle.workspaceId);
      if (typeof options.pagePreview === 'boolean') preview = options.pagePreview;
      if (mode === 'discover' && typeof options.seedVersionId === 'string') {
        const view = discoveryView(current); view.seedVersionId = options.seedVersionId; view.chooserOpen = false;
      }
      if (mode === 'related' && options.discovery !== undefined) {
        const context = options.discovery, view = discoveryView(current);
        const valid = context && context.workspaceId === bundle.workspaceId && typeof context.seedVersionId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(context.seedVersionId);
        view.seedVersionId = valid ? context.seedVersionId : null; view.chooserOpen = !valid;
        view.contextError = valid ? '' : '기준 기록의 작업공간이나 버전을 확인하지 못했습니다. 현재 공간에서 기록을 다시 골라 주세요.';
      }
      incoming = null;
      if (options.selection && ['activities', 'page'].includes(mode)) {
        const selection = options.selection;
        const validIds = Array.isArray(selection.versionIds) && selection.versionIds.length <= limits.groupVersions &&
          selection.versionIds.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id));
        const ids = validIds ? [...new Set(selection.versionIds)] : [];
        incoming = { workspaceId: selection.workspaceId, versionIds: ids, selected: new Set(ids), invalid: !validIds,
          title: selection.workspaceId === bundle.workspaceId ? (sourceInfo(ids[0], bundle)?.source.title || '') : '', groupId: '', accepted: false };
        if (mode === 'page') preview = false;
      }
      const session = current;
      surface = el('section', null, 'life-workbench'); surface.dataset.mode = mode;
      surface.setAttribute('aria-busy', 'true');
      surface.dataset.workspaceId = bundle.workspaceId;
      const heading = el('div', null, 'wb-row wb-heading');
      const title = el('h2', MODES[mode], 'life-heading wb-grow'); title.tabIndex = -1;
      if (mode === 'page' || mode === 'related') { heading.classList.add('wb-heading-quiet'); title.classList.add('life-sr-only'); }
      saveControl = (mode === 'page' ? discoveryIcon : icon)('지금 저장', 'check', () => flush()); saveControl.hidden = ['public-pages', 'related'].includes(mode) || !!incoming;
      heading.append(title, saveControl);
      statusNode = el('p', '이 브라우저의 구성을 불러오는 중…', 'life-meta wb-save-status'); statusNode.id = 'wbStatus';
      statusNode.setAttribute('role', 'status'); statusNode.setAttribute('aria-live', 'polite');
      const scope = details('저장 범위');
      scope.classList.add('wb-scope');
      scope.append(notice('구성은 먼저 이 브라우저에 저장됩니다. 관리의 기기 간 동기화에서 묶음·내 페이지 이어쓰기를 별도로 시작하면 같은 계정의 서버에 보관합니다. 글쓰기·가져오기 초안은 포함하지 않습니다. 자료·구성 JSON 백업으로 새 사본을 복원할 수도 있습니다. 공개 사본은 따로 게시·갱신·철회하며, 표시를 끄거나 원문을 수정해도 이미 게시한 사본은 바뀌지 않습니다.'));
      errorNode = el('div', null, 'life-error wb-error'); errorNode.id = 'wbError'; errorNode.setAttribute('role', 'alert'); errorNode.hidden = true;
      bodyNode = el('div', null, 'wb-content'); bodyNode.append(notice('불러오는 중…'));
      const storageLine = el('div', null, 'wb-storage-line'); storageLine.append(statusNode, scope);
      storageLine.hidden = mode === 'public-pages' || mode === 'related';
      surface.append(heading, storageLine, errorNode, bodyNode); host.replaceChildren(surface);
      if (mode === 'public-pages') { surface.setAttribute('aria-busy', 'false'); redraw(); return; }
      try {
        if (!session.state || session.edit === session.stored && session.remoteRevision > session.baseRevision) await load(session);
        if (!showing(token, session)) return;
        surface.setAttribute('aria-busy', 'false');
        redraw(); if (session.error) report(session.error, session);
        if (!incoming && mode === 'activities' && typeof options.groupId === 'string') revealGroup(options.groupId);
      } catch (error) {
        if (!showing(token, session)) return;
        surface.setAttribute('aria-busy', 'false');
        bodyNode.replaceChildren(empty('구성을 불러오지 못했습니다. 보관한 원문은 바뀌지 않았습니다.'), action('다시 불러오기', () => render(mode, options)));
        report(error, session);
      }
    }
    function leave() {
      rememberPageEditor();
      generation += 1; visible = false; cleanupView(); incoming = null; restoreSequence += 1; restoreCandidate = null; restoreName = '';
      publicList = null;
      if (current?.share) { current.share.open = false; current.share.sequence += 1; current.share.draft = null; current.share.consented = false; }
    }
    function dispose() {
      disposed = true; leave();
      shareRemote?.dispose();
      sessions.forEach(session => { clearTimeout(session.timer); session.unsubscribe?.(); });
      urls.forEach(url => URL.revokeObjectURL(url)); urls.clear();
    }
    return Object.freeze({ render, flush, dirty, leave, dispose });
  }
  life.WorkbenchUI = Object.freeze({ create });
})(globalThis);
