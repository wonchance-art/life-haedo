/* Private, local composition UI. Reading and editing never write to a source service. */
(function (global) {
  'use strict';

  const life = global.HaedoLife = global.HaedoLife || {};
  const ORIGINS = { apple_notes: 'Apple 메모', obsidian: 'Obsidian', naver_blog: '네이버 블로그', instagram: 'Instagram', other: '기타' };
  const MODES = { activities: '묶음', page: '내 페이지', discover: '다시 찾기', related: '관련 기록', reflection: '회고', books: '책 만들기', 'workbench-backup': '자료·구성 백업', 'public-pages': '공개한 페이지' };
  const copy = value => JSON.parse(JSON.stringify(value));
  function el(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function fault(code, message) { return Object.assign(new Error(message), { code }); }

  function create({ storage, core, host, getBundle, openSource, announce = () => {}, onRestored,
    onSelectionUsed = () => {}, onSelectionCancel = () => {}, onArrange = () => {}, onWorkbenchNavigate = () => {}, onChapterImport = () => {},
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
    function field(label, value, { id, multiline = false, wrapTitle = false, max = limits.title, change } = {}) {
      const wrapper = el('label', null, 'life-field');
      wrapper.append(el('span', label));
      const input = el(multiline || wrapTitle ? 'textarea' : 'input');
      if (!multiline && !wrapTitle) input.type = 'text';
      input.value = value;
      input.maxLength = max;
      if (id) input.id = id;
      if (multiline) input.rows = 4;
      const token = generation, session = current;
      let composing = false;
      // Preserve WritingUI's single-line title contract while wrapping visually.
      const normalizeTitle = () => {
        if (!wrapTitle || composing || !/[\r\n]/.test(input.value)) return;
        const { selectionStart: start, selectionEnd: end, selectionDirection: direction } = input;
        const clean = text => text.replace(/[\r\n]/g, '');
        const left = clean(input.value.slice(0, start)).length, right = clean(input.value.slice(0, end)).length;
        input.value = clean(input.value); input.setSelectionRange(left, right, direction);
      };
      if (wrapTitle) {
        input.rows = 1;
        input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && !composing) event.preventDefault(); });
        input.addEventListener('beforeinput', event => { if (['insertLineBreak', 'insertParagraph'].includes(event.inputType) && !event.isComposing && !composing) event.preventDefault(); });
      }
      input.addEventListener('compositionstart', () => { composing = true; session.composing.add(input); clearTimeout(session.timer); });
      input.addEventListener('input', () => {
        if (!showing(token, session) || installing) return;
        normalizeTitle();
        change?.(input.value);
        if (change) mark(session, !composing && !input.isComposing);
      });
      const finish = () => {
        if (!composing) return;
        composing = false; session.composing.delete(input);
        if (wrapTitle && input.isConnected && showing(token, session) && !installing) { normalizeTitle(); change?.(input.value); }
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
      // Selection is consumed only after the accepted reflection draft is durable,
      // including a later explicit retry after a failed transaction.
      const accepted = session.reflectionSelection;
      if (accepted && session.stored >= accepted.tick && workspaceIs(session)) {
        session.reflectionSelection = null;
        onSelectionUsed({ workspaceId: session.workspaceId, versionIds: accepted.versionIds });
      }
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
              // The banner may have appeared before this tab began editing.
              // Recheck now; an old reload control must never discard a later draft.
              if (session.composing.size) throw fault('input_in_progress', '입력을 마친 뒤 저장본을 확인해 주세요.');
              if (session.edit !== session.stored || session.saving) {
                throw fault('workbench_conflict', '현재 초안과 새 저장본을 먼저 비교해 주세요.');
              }
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
        session.chapterImport = null;
      })();
      try { await session.loading; } finally { session.loading = null; }
    }
    async function openVersion(id, focusKey, isCurrent = () => true) {
      const session = current, token = generation, info = sourceInfo(id);
      if (!info) throw fault('source_missing', '연결된 원문이 없습니다. 새 버전으로 대신 열지 않았습니다.');
      await flush();
      if (showing(token, session) && isCurrent()) await openSource(info.source.id, info.version.id, { focusKey });
    }
    function sourceRow(id, { body = false, remove, previewOnly = false, hideTitle = false, showLink = false, focusKey, isCurrent } = {}) {
      const row = el('div', null, 'wb-source'); row.dataset.versionId = id;
      const info = sourceInfo(id);
      const head = el('div', null, 'wb-row');
      const text = el('div', null, 'wb-grow');
      if (!hideTitle || !info) text.append(el('p', info ? info.source.title : '연결된 원문 없음', 'wb-source-title'));
      text.append(el('p', info ? sourceMeta(info) : '이 버전은 현재 공간에 없습니다. 다른 버전으로 바꾸지 않았습니다.', 'life-meta'));
      head.append(text);
      if (info && !previewOnly) {
        const open = (focusKey ? discoveryIcon : icon)('이 원문 버전 열기', 'book', () => openVersion(id, focusKey, isCurrent));
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
    function picker(label, selected, change, { max = limits.groupVersions, single = false, filter = () => true } = {}) {
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
          return info && filter(version) && (!needle || (info.source.title + '\n' + (version.contentText || '')).toLocaleLowerCase('ko-KR').includes(needle));
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
      const reflection = action('회고에서 읽기', () => onWorkbenchNavigate({ workspaceId: session.workspaceId, mode: 'reflection' }));
      reflection.id = 'wbGroupsReflection'; bodyNode.append(reflection);
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
      const apply = action(mode === 'reflection' ? '회고에 담기' : mode === 'page' ? '내 페이지에 추가' : '묶음에 담기', async () => {
        if (incoming !== pending || pending.accepted || composing || !showing(token, session)) return;
        if (!validate()) { error.scrollIntoView({ block: 'nearest' }); return; }
        const ids = selected(), name = title.input.value.trim();
        if (mode !== 'reflection' && (mode === 'page' || !group.value) && !name) {
          title.input.setCustomValidity(mode === 'page' ? '항목 제목을 입력해 주세요.' : '묶음 이름을 입력해 주세요.');
          title.input.reportValidity(); return;
        }
        const candidate = copy(session.state);
        let addedId;
        if (mode === 'reflection') {
          const union = [...new Set(candidate.reflection.versionIds.concat(ids))];
          if (union.length > limits.reflectionVersions) { fail('회고에는 원문 ' + limits.reflectionVersions + '개까지 담을 수 있습니다.'); return; }
          candidate.reflection.versionIds = union;
        } else if (mode === 'activities') {
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
        session.state.groups = candidate.groups; session.state.page.entries = candidate.page.entries; session.state.reflection = candidate.reflection;
        mark(session, false);
        if (mode === 'reflection') session.reflectionSelection = { tick: session.edit, versionIds: ids.slice() };
        redraw();
        if (mode === 'activities') revealGroup(addedId);
        else if (mode === 'page') {
          const article = [...bodyNode.querySelectorAll('[data-entry-id]')].find(node => node.dataset.entryId === addedId);
          const editor = article?.querySelector('details');
          if (editor) { editor.open = true; editor.querySelector('summary')?.focus({ preventScroll: true }); }
          article?.scrollIntoView({ block: 'start' });
        }
        announceSafe('선택한 기록을 편집 초안에 담았습니다.', session);
        if (mode === 'reflection') {
          await flushSession(session);
        } else {
          try { onSelectionUsed({ workspaceId: session.workspaceId, versionIds: ids }); }
          finally { await flushSession(session); }
        }
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
      title.wrapper.hidden = mode === 'reflection' || mode === 'activities' && !!group.value;
      box.append(title.wrapper);
      if (mode === 'reflection') box.append(notice('기존 회고 선택에 정확한 원문 버전을 더합니다. 한 번에 100개, 회고 전체는 1,000개까지 담을 수 있습니다. 원문과 발췌는 그대로 남습니다.'));
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
      // Native details.toggle is queued. Capture the visible state before
      // replacing controls so fast keyboard input cannot close its own panel.
      const choices = bodyNode.querySelector('#wbShareChoices');
      if (choices) {
        share.choicesOpen = choices.open;
        choices.querySelectorAll('.wb-share-part').forEach(part => {
          const quote = part.querySelector('details');
          if (quote?.open) share.quoteOpen.add(part.dataset.versionId);
          else share.quoteOpen.delete(part.dataset.versionId);
        });
      }
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
          previewBox.append(el('h3', '공개 전 확인'), life.ShareView.render(share.draft.snapshot, { headingLevel: 3, review: true })); box.append(previewBox);
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
    // Display-only exact prefix: never write this text or expansion state to
    // the workbench, source bundle, backup or public snapshot.
    function pageOpening(text, narrow) {
      const limit = narrow ? 90 : 150;
      if (text.length <= limit + 40) return text;
      let end = limit;
      const paragraph = Math.max(text.lastIndexOf('\n\n', end), text.lastIndexOf('\r\n\r\n', end));
      const space = Math.max(text.lastIndexOf(' ', end), text.lastIndexOf('\n', end));
      if (paragraph > limit / 2) end = paragraph;
      else if (space > limit / 2) end = space;
      if (/^[\uDC00-\uDFFF]$/.test(text[end])) end -= 1;
      if (text[end - 1] === '\r' && text[end] === '\n') end -= 1;
      return text.slice(0, end);
    }
    function pageBody(text, entryId, versionId) {
      const session = current, token = generation;
      const expanded = session.pageExpanded ||= new Set();
      const key = entryId + ':' + versionId;
      const content = el('pre', null, 'wb-source-body');
      content.id = 'wbPageBody-' + key; content.tabIndex = -1;
      const button = el('button', '', 'life-button wb-page-expand'); button.type = 'button';
      button.setAttribute('aria-controls', content.id);
      const narrow = global.matchMedia('(max-width: 700px)');
      function fill() {
        const prefix = pageOpening(text, narrow.matches), canFold = prefix !== text;
        const open = expanded.has(key);
        const shownText = open ? text : prefix;
        if (content.textContent !== shownText) content.textContent = shownText;
        content.dataset.collapsed = String(canFold && !open);
        button.hidden = !canFold; button.textContent = open ? '본문 접기' : '본문 펼치기';
        button.setAttribute('aria-expanded', String(open));
      }
      button.addEventListener('click', () => {
        if (!showing(token, session) || !button.isConnected || installing) return;
        const open = !expanded.has(key);
        if (open) expanded.add(key); else expanded.delete(key);
        fill();
        const target = open ? content : button;
        target.focus({ preventScroll: true }); target.scrollIntoView({ block: open ? 'start' : 'nearest' });
      });
      narrow.addEventListener('change', fill);
      viewCleanups.push(() => narrow.removeEventListener('change', fill));
      fill(); return { content, button };
    }
    function pagePart(part, entry, index) {
      const info = sourceInfo(part.versionId);
      const section = el('div', null, 'wb-page-part wb-source'); section.dataset.versionId = part.versionId;
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
      const meta = el('div', null, 'wb-page-metadata');
      meta.append(el('p', metadata.join(' · '), 'life-meta wb-page-source-meta'));
      // Imported dates may be free-form (or unknown). Preserve the selected
      // version's value without inventing a timezone, precision or activity date.
      if (info.version.originalCreatedAt) meta.append(el('p', '원문 작성일 ' + info.version.originalCreatedAt, 'life-meta wb-page-source-date'));
      section.append(meta);
      if (info.version.coverage.omissions.length) section.append(el('p', '포함되지 않은 내용 · ' + info.version.coverage.omissions.join(' · '), 'life-meta wb-page-omissions'));
      const body = entry.showBody && info.version.contentText != null ? pageBody(info.version.contentText, entry.id, part.versionId) : null;
      if (body) section.append(body.content);
      const focusKey = 'page:body:' + entry.id + ':' + part.versionId;
      const open = discoveryIcon('이 원문 버전 열기', 'book', () => openVersion(part.versionId, focusKey));
      open.classList.add('wb-page-source-open'); open.dataset.focusKey = focusKey;
      const sourceActions = el('div', null, 'life-actions wb-page-source-actions');
      if (body) sourceActions.append(body.button);
      if (info.source.url) {
        try {
          const url = new URL(info.source.url);
          if (['http:', 'https:'].includes(url.protocol)) {
            const link = el('a', '원문 출처', 'wb-source-link'); link.href = url.href;
            link.target = '_blank'; link.rel = 'noopener noreferrer'; sourceActions.append(link);
          }
        } catch (_) { /* Invalid URLs never become links. */ }
      }
      sourceActions.append(open); section.append(sourceActions);
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
        const article = el('article', null, 'wb-feed wb-page-entry'); article.dataset.entryId = entry.id;
        const head = el('div', null, 'wb-row wb-page-entry-heading'); head.append(el('h3', entry.title, 'wb-grow'));
        if (entry.pinned) { const pin = life.Icons.create('bookmark'); const note = el('span', '고정한 항목', 'life-sr-only'); head.append(pin, note); }
        article.append(head);
        const content = el('div', null, 'wb-page-content');
        entry.parts.filter(part => part.enabled).forEach((part, index) => content.append(pagePart(part, entry, index)));
        if (entry.showNote && entry.note) { const note = el('div', null, 'wb-comment'); note.append(el('p', '내 코멘트', 'life-meta'), el('p', entry.note, 'wb-comment-body')); content.append(note); }
        article.append(content);
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
      const session = current, token = generation, reflection = session.state.reflection;
      const view = session.reflectionView ||= { mode: 'time', from: '', to: '', shown: 40 };
      const reader = life.Reflection;
      surface.querySelector('.wb-heading h2').textContent = session.bookPlanOpen ? '목차 구성' : '회고';
      saveControl.hidden = !!session.bookPlanOpen;
      if (session.bookPlanOpen) { bodyNode.append(bookPlanner(session, view)); return; }
      bodyNode.append(notice('당시의 글을 읽고 지금의 생각을 원고로 남깁니다.'));
      const guidance = details('20대의 글에서 시작하기');
      guidance.append(notice('시간순으로 장면을 살핀 뒤 관계·일·배움처럼 나에게 중요한 주제로 돌아보세요. 나이와 기간은 글만으로 추정하지 않습니다. 기록이 적은 시기도 빈 삶을 뜻하지 않습니다.'));
      const pickerHost = el('div');
      const controls = el('div', null, 'life-actions');
      const time = action('연도별', () => { view.mode = 'time'; view.shown = 40; fill(); }); time.id = 'wbReflectionTime';
      const theme = action('묶음별', () => { view.mode = 'theme'; view.shown = 40; fill(); }); theme.id = 'wbReflectionThemes';
      controls.append(time, theme);
      const period = details('작성 연도로 좁히기');
      const from = field('시작 연도', view.from, { id: 'wbReflectionFrom' });
      const to = field('끝 연도', view.to, { id: 'wbReflectionTo' });
      for (const input of [from.input, to.input]) { input.inputMode = 'numeric'; input.maxLength = 4; input.placeholder = '미지정'; }
      const periodFields = el('div', null, 'wb-add-row'); periodFields.append(from.wrapper, to.wrapper);
      const apply = action('기간 적용', () => {
        reader.chronology(getBundle(), reflection.versionIds, { from: from.input.value, to: to.input.value });
        view.from = from.input.value; view.to = to.input.value; view.shown = 40;
        if (!session.error) clearError();
        refillPicker(); fill();
      }); apply.id = 'wbReflectionApplyPeriod';
      const clear = action('기간 해제', () => { from.input.value = to.input.value = view.from = view.to = ''; view.shown = 40; if (!session.error) clearError(); refillPicker(); fill(); });
      period.append(periodFields, apply, clear, notice('원문 작성 연도 기준이며 같은 연도 안은 선택순입니다. 경험 시기는 별도로 회고에 적어 주세요. 시기 미확인 자료도 남깁니다. 기간은 이번 화면의 보기 조건이며 선택·회고·백업에는 저장하지 않습니다.'));
      const overview = el('div', null, 'wb-reflection-overview'); overview.id = 'wbReflectionSummary';
      const selectedList = el('div', null, 'wb-reflection-reading'); selectedList.id = 'wbReflectionReading';
      const more = action('기록 더 보기', () => { view.shown += 40; fill(); }); more.id = 'wbReflectionMore';
      const included = () => new Set(reader.chronology(getBundle(), getBundle().sourceVersions.map(item => item.id), view).flatMap(group => group.versionIds));
      const refillPicker = () => {
        const allowed = included();
        pickerHost.replaceChildren(picker('회고할 원문 선택', () => reflection.versionIds, (id, checked) => {
          reflection.versionIds = checked ? reflection.versionIds.concat(id) : reflection.versionIds.filter(value => value !== id);
          mark(session); fill();
        }, { max: limits.reflectionVersions, filter: version => allowed.has(version.id) }));
      };
      const fill = () => {
        time.setAttribute('aria-pressed', String(view.mode === 'time')); theme.setAttribute('aria-pressed', String(view.mode === 'theme'));
        const infos = reflection.versionIds.map(id => sourceInfo(id)), available = infos.filter(Boolean);
        const count = label => available.filter(info => info.version.originalAuthor.relation === label).length;
        overview.replaceChildren();
        const summary = details('선택한 원문 버전 ' + reflection.versionIds.length + '개');
        const facts = el('dl', null, 'wb-facts');
        [['내 기록', count('self')], ['다른 사람의 기록', count('other')], ['작성자 관계 미확인', count('unknown')],
          ['본문 미확보', available.filter(info => info.version.contentText == null).length], ['연결된 원문 없음', infos.length - available.length]].forEach(([label, value]) => {
          facts.append(el('dt', label), el('dd', value + '개'));
        });
        summary.append(facts, notice('선택한 버전 수이며 경험 횟수·관심의 강도·나의 신념을 뜻하지 않습니다.')); overview.append(summary);
        const years = reader.chronology(getBundle(), reflection.versionIds, view);
        const visible = years.flatMap(group => group.versionIds);
        const sections = view.mode === 'time' ? years : reader.themes(session.state, visible);
        if (view.mode === 'theme') overview.append(notice('직접 만든 묶음 기준입니다. 발췌의 주제와는 별개이며 선택한 정확한 원문 버전만 보여줍니다.'));
        if (visible.length !== reflection.versionIds.length) overview.append(notice('기간 밖의 선택 자료 ' + (reflection.versionIds.length - visible.length) + '개는 선택을 유지합니다. 원고 내보내기에는 선택 자료 전체가 포함됩니다.'));
        selectedList.replaceChildren();
        let shown = 0, total = sections.reduce((sum, group) => sum + group.versionIds.length, 0);
        for (const group of sections) {
          const ids = group.versionIds.slice(0, Math.max(0, view.shown - shown)); if (!ids.length) continue;
          shown += ids.length;
          const section = el('section', null, 'wb-reflection-section'); section.dataset.reflectionGroup = group.key;
          section.append(el('h3', group.label));
          for (const id of ids) {
            const row = sourceRow(id, { focusKey: 'reflection:' + group.key + ':' + id, remove: () => { reflection.versionIds = reflection.versionIds.filter(value => value !== id); mark(session); refillPicker(); fill(); time.focus(); } });
            const info = sourceInfo(id);
            row.append(el('p', '원문 작성일 · ' + (info?.version.originalCreatedAt || '미확인'), 'life-meta'));
            if (info?.version.contentText != null) {
              const text = details('본문 읽기');
              text.addEventListener('toggle', () => {
                if (text.open && !text.querySelector('pre')) {
                  const content = el('pre', info.version.contentText, 'wb-source-body'); content.tabIndex = 0; text.append(content);
                }
              });
              row.append(text);
            }
            section.append(row);
          }
          selectedList.append(section);
        }
        if (!visible.length) selectedList.append(empty(reflection.versionIds.length ? '이 작성 기간에 해당하는 선택 자료가 없습니다. 기간을 해제하면 다시 볼 수 있습니다.' : '돌아볼 글을 골라 주세요. 기록이 없는 장면은 아래 회고에 직접 적어도 됩니다.'));
        more.hidden = shown >= total;
      };
      const readingControls = el('div', null, 'wb-reflection-controls'); readingControls.append(controls, period);
      const plan = action('선택한 글로 목차 구성', async () => {
        if (session.composing.size) throw fault('input_in_progress', '입력을 마친 뒤 목차를 구성해 주세요.');
        await flush(); if (!showing(token, session)) return;
        session.bookPlanOpen = true; redraw(); const target = bodyNode.querySelector('#wbPlanTitle'); target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'center' });
      }, 'life-primary'); plan.id = 'wbReflectionPlan';
      const group = action('선택한 글 묶기', async () => {
        const ids = reader.chronology(getBundle(), reflection.versionIds, view).flatMap(item => item.versionIds);
        if (!ids.length) throw fault('empty_selection', '묶을 글을 먼저 선택해 주세요.');
        if (ids.length > limits.groupVersions) throw fault('limit_reached', '한 번에 100개까지 묶을 수 있습니다. 작성 기간이나 회고 선택을 좁혀 주세요.');
        await flush(); if (!showing(token, session)) return;
        return onArrange({ workspaceId: session.workspaceId, versionIds: ids, focusId: 'wbReflectionGroup' });
      }); group.id = 'wbReflectionGroup';
      controls.append(plan, group);
      bodyNode.append(pickerHost, readingControls);
      bodyNode.append(overview, selectedList, more);
      const note = field('내 회고', reflection.note, { id: 'wbReflectionNote', multiline: true, max: limits.text,
        change: value => { reflection.note = value; } });
      note.input.rows = 12;
      const prompts = details('회고 질문을 원고에 추가');
      const questions = [
        ['시간순 돌아보기', '## 시간순 돌아보기\n\n어떤 장면과 선택이 기억나는가?\n그때의 글과 지금의 기억은 어디서 다른가?\n생각이 바뀐 계기와 아직 설명하기 어려운 부분은 무엇인가?\n'],
        ['주제별 돌아보기', '## 주제별 돌아보기\n\n관계·일·배움·취향 중 계속 돌아온 질문은 무엇인가?\n그 생각을 뒷받침하는 글과 다른 방향의 글은 무엇인가?\n지금도 이어갈 것과 내려놓고 싶은 것은 무엇인가?\n'],
        ['책의 목차 구상', '## 책의 목차 구상\n\n이 글들을 엮어 누구에게 어떤 이야기를 들려주고 싶은가?\n첫 장면 / 변화의 계기 / 지금의 관점\n각 장에 넣을 글과 더 써야 할 장면\n']
      ];
      for (const [label, text] of questions) prompts.append(action(label, () => {
        if (session.composing.size) throw fault('input_in_progress', '입력을 마친 뒤 질문을 추가해 주세요.');
        const next = reflection.note + (reflection.note ? '\n\n' : '') + text;
        if (next.length > limits.text) throw fault('limit_reached', '회고 길이를 줄인 뒤 추가해 주세요. 기존 내용은 유지했습니다.');
        reflection.note = next; note.input.value = next; mark(session);
        note.input.focus(); note.input.setSelectionRange(next.length, next.length);
      }));
      const exportBox = details('원고 파일로 보관');
      const include = toggle('선택한 원문 본문도 포함', false, () => {}); include.querySelector('input').id = 'wbReflectionIncludeSources';
      const exportButton = action('회고 원고 Markdown 받기', async () => {
        await flush();
        if (!showing(token, session)) return;
        const text = reader.markdown(getBundle(), session.state, { includeSources: include.querySelector('input').checked });
        const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); urls.add(url);
        const link = el('a'); link.href = url; link.download = 'haedo-reflection.md'; link.hidden = true;
        document.body.append(link); link.click(); link.remove();
        global.setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000);
      }); exportButton.id = 'wbReflectionExport';
      exportBox.append(include, notice('내 회고와 선택한 자료의 출처를 파일로 받습니다. 보기 기간과 무관하게 선택 전체를 포함하며 공개 게시하지 않습니다. 원문·구성 복원에는 자료·구성 JSON 백업을 사용하세요.'), exportButton);
      bodyNode.append(note.wrapper, prompts, exportBox, guidance);
      refillPicker(); fill();
    }

    function bookPlanner(session, reflectionView) {
      const token = generation;
      const draft = session.bookPlan ||= { title: '', question: '', by: reflectionView.mode, from: reflectionView.from,
        to: reflectionView.to, versionIds: session.state.reflection.versionIds.slice(), choices: {} };
      const box = el('section', null, 'wb-book-plan'); box.id = 'wbBookPlan';
      box.setAttribute('aria-labelledby', 'wbPlanHeading');
      const heading = el('h3', '목차 구성', 'life-sr-only'); heading.id = 'wbPlanHeading';
      const title = field('책 제목', draft.title, { id: 'wbPlanTitle' }); title.input.placeholder = '예: 나의 20대, 일과 쉼';
      const question = field('이 책에서 돌아볼 질문', draft.question, { id: 'wbPlanQuestion', multiline: true, max: limits.text });
      question.input.placeholder = '예: 잘해야 한다는 마음은 어떻게 달라졌을까?';
      title.input.addEventListener('input', () => { draft.title = title.input.value; });
      question.input.addEventListener('input', () => { draft.question = question.input.value; });
      const modes = el('div', null, 'life-actions');
      const list = el('ol', null, 'wb-plan-list'); list.id = 'wbPlanChapters';
      const summary = el('p', '', 'life-meta'); summary.id = 'wbPlanSummary'; summary.setAttribute('role', 'status');
      const choices = () => draft.choices[draft.by] ||= life.Books.outline(getBundle(), session.state, draft.versionIds,
        { by: draft.by, from: draft.from, to: draft.to }).map(value => ({ ...value, selected: true }));
      const count = () => {
        const selected = choices().filter(item => item.selected);
        summary.textContent = selected.length + '개 장 · 정확한 원문 버전 ' + new Set(selected.flatMap(item => item.versionIds)).size + '개';
      };
      const time = action('연도별 목차', () => { draft.by = 'time'; fill(); }); time.id = 'wbPlanTime';
      const theme = action('묶음별 목차', () => { draft.by = 'theme'; fill(); }); theme.id = 'wbPlanThemes';
      const refresh = action('현재 선택으로 후보 다시 만들기', () => {
        if (session.composing.size) throw fault('input_in_progress', '입력을 마친 뒤 후보를 만들어 주세요.');
        if (!global.confirm('목차 후보의 제목과 포함 선택을 새로 만들까요? 책 제목과 질문은 유지합니다.')) return;
        draft.versionIds = session.state.reflection.versionIds.slice(); draft.from = reflectionView.from; draft.to = reflectionView.to;
        draft.choices = {}; fill();
      }); refresh.id = 'wbPlanRefresh';
      modes.append(time, theme);
      const fill = () => {
        time.setAttribute('aria-pressed', String(draft.by === 'time')); theme.setAttribute('aria-pressed', String(draft.by === 'theme'));
        list.replaceChildren();
        for (const [index, item] of choices().entries()) {
          const row = el('li', null, 'wb-plan-chapter'); row.dataset.planKey = item.key;
          const check = toggle('장 ' + (index + 1) + ' 포함', item.selected, value => { item.selected = value; count(); });
          const name = field('장 ' + (index + 1) + ' 제목', item.title, { id: 'wbPlanChapter' + index });
          name.input.addEventListener('input', () => { item.title = name.input.value; });
          const sources = details('연결할 원문 · ' + item.versionIds.length + '개');
          // Names, authorship and exact versions are reviewable before anything is saved.
          let shown = 0;
          const more = action('연결할 원문 더 보기', () => fillSources());
          const fillSources = () => {
            const batch = item.versionIds.slice(shown, shown + 40); shown += batch.length;
            batch.forEach(id => sources.insertBefore(sourceRow(id), more)); more.hidden = shown >= item.versionIds.length;
          };
          sources.append(more);
          sources.addEventListener('toggle', () => { if (sources.open && !shown) fillSources(); });
          row.append(check, name.wrapper, sources); list.append(row);
        }
        if (!choices().length) list.append(empty('선택한 기간의 글이 없습니다. 돌아볼 글을 고르거나 기간을 해제한 뒤 후보를 다시 만들어 주세요.'));
        count();
      };
      const apply = action(draft.createdBookId ? '저장 후 책 열기' : '이 목차로 책 만들기', async () => {
        if (session.composing.size) throw fault('input_in_progress', '입력을 마친 뒤 책을 만들어 주세요.');
        await flush(); if (!showing(token, session)) return;
        if (!draft.createdBookId) {
          const result = life.Books.fromOutline(session.state, { title: draft.title.trim(), question: draft.question,
            chapters: choices().filter(item => item.selected).map(item => ({ title: item.title.trim(), versionIds: item.versionIds.slice() })) }, { id: () => core.id() });
          session.state = result.state; draft.createdBookId = result.bookId;
          mark(session, false); redraw();
          await flush(); if (!showing(token, session)) return;
        }
        session.bookView = { bookId: draft.createdBookId, chapterId: null, shown: 40, renderId: 0 };
        await onWorkbenchNavigate({ workspaceId: session.workspaceId, mode: 'books' });
        if (workspaceIs(session)) { session.bookPlan = null; session.bookPlanOpen = false; }
      }, 'life-primary'); apply.id = 'wbPlanCreate';
      const close = action('회고로 돌아가기', () => { session.bookPlanOpen = false; redraw(); bodyNode.querySelector('#wbReflectionPlan')?.focus(); }); close.id = 'wbPlanClose';
      const actions = el('div', null, 'life-actions'); actions.append(apply, close);
      box.append(heading, notice(draft.createdBookId ? '책 초안을 저장한 뒤 같은 책을 엽니다.' : '목차 후보는 이 화면에만 임시 보관합니다. 책 만들기를 눌러야 저장됩니다.'), title.wrapper, question.wrapper, modes,
        notice('선택한 글의 작성 연도 또는 직접 만든 묶음에서 시작합니다. 장 제목과 포함 여부를 고른 뒤 만드세요. 먼저 3~5개 장으로 시작해도 좋습니다.'), list, summary);
      const scope = details('후보 범위와 원문 보존');
      scope.append(notice('후보를 만들 때의 회고 선택과 보기 기간(' + (draft.from || '제한 없음') + ' ~ ' + (draft.to || '제한 없음') + ')을 사용합니다. 작성 시기 미확인도 따로 남기며, 묶음이 겹치면 같은 버전을 여러 장에 연결할 수 있습니다. 기간 밖 자료와 회고 글은 원래 회고에 남습니다. 장 원고는 빈 상태로 시작하며 글을 자동 해석하거나 공개하지 않습니다.'), refresh);
      box.append(scope, actions); fill();
      if (draft.createdBookId) {
        box.querySelectorAll('input,textarea,button').forEach(control => { if (![apply, close].includes(control)) control.disabled = true; });
        box.insertBefore(notice('책 초안은 이미 만들었습니다. 저장을 완료한 뒤 같은 책을 엽니다.'), actions);
      }
      return box;
    }

    function bookReview(projection, editChapter) {
      const result = life.Books.review(projection);
      const box = details('원고 점검'); box.id = 'wbBookReview';
      box.append(notice('선택한 원고의 상태만 확인합니다. 글의 완성도나 생각의 옳고 그름을 평가하지 않습니다.'));
      const facts = [['blankNote', '아직 쓰지 않은 원고'], ['missing', '연결된 원문 없음'], ['otherAuthors', '다른 사람의 글'],
        ['unknownAuthors', '작성자 관계 미확인'], ['linkOnly', '본문 미확보'], ['undated', '작성 시기 미확인']];
      for (const chapter of result.chapters) {
        const row = el('div', null, 'wb-review-row'); row.dataset.reviewChapter = chapter.id;
        const issues = facts.filter(([key]) => chapter[key]).map(([key, label]) => label + (key === 'blankNote' ? '' : ' ' + chapter[key] + '개'));
        row.append(el('h4', chapter.title), el('p', issues.join(' · ') || '빈 원고·출처 확인 항목 없음', 'life-meta'));
        const edit = action('이 장 확인', () => editChapter(chapter.id)); edit.dataset.reviewEdit = chapter.id; row.append(edit); box.append(row);
      }
      if (!result.chapters.length) box.append(empty('목차에서 첫 장을 추가해 주세요.'));
      box.append(notice('원문은 정확한 버전으로 연결하며 작성일을 경험 시기로 추정하지 않습니다. 타인 글과 미확인 자료는 내 생각의 근거인지 직접 검토하세요. 보관한 장·제외한 해석은 이번 출력에서 빠집니다.'));
      return box;
    }

    function renderBooks() {
      const session = current, token = generation, state = session.state;
      const view = session.bookView ||= { bookId: null, chapterId: null, shown: 40, renderId: 0 };
      const renderId = ++view.renderId;
      const active = () => showing(token, session) && view.renderId === renderId;
      async function transition(change, focusId) {
        if (session.composing.size) throw fault('input_in_progress', '입력을 마친 뒤 이동해 주세요.');
        await flush();
        if (!active()) return;
        change(); redraw();
        const target = focusId && bodyNode.querySelector('#' + focusId);
        target?.focus({ preventScroll: true });
        const scrollTarget = focusId === 'wbChapterNote' ? target?.closest('.wb-book-editor') : target;
        scrollTarget?.scrollIntoView({ block: focusId === 'wbChapterNote' ? 'start' : 'nearest' });
      }
      async function historyChange(make, after = () => {}, focusId) {
        if (session.composing.size) throw fault('input_in_progress', '입력을 마친 뒤 원고를 보관해 주세요.');
        await flush(); if (!active()) return;
        const next = make(session.state); // Pure operation validates size and limits before touching the live draft.
        session.state = next; after(next); mark(session, false); redraw();
        const target = focusId && bodyNode.querySelector('#' + focusId); target?.focus();
        await flush();
      }
      const books = state.books || [], activeBooks = books.filter(item => !item.archived);
      const book = activeBooks.find(item => item.id === view.bookId);
      surface.dataset.bookScene = !book ? 'list' : view.edition ? 'edition' : view.reading ? 'read' : 'edit';
      const surfaceHeading = surface.querySelector('.wb-heading');
      surfaceHeading.querySelector('h2').textContent = books.length ? '내 책' : MODES.books;
      surfaceHeading.classList.add('wb-heading-quiet');
      surfaceHeading.querySelector('h2').classList.add('life-sr-only');
      if (!book) {
        surfaceHeading.append(saveControl); saveControl.hidden = true;
        view.bookId = null; view.chapterId = null; view.reading = false; view.readPosition = null; view.editorPosition = null; view.includeSources = false; view.edition = false; view.editionOptions = null; view.editionPosition = null;
        if (!activeBooks.length) bodyNode.append(empty(books.length ? '모든 책을 보관 중입니다. 아래에서 원하는 책을 복구해 이어 쓸 수 있습니다.' : '돌아보고 싶은 시기나 주제로 첫 책을 시작하세요.'));
        const list = el('div', null, 'wb-book-list'); list.id = 'wbBookList'; list.tabIndex = -1;
        activeBooks.forEach(item => {
          const row = el('article', null, 'wb-row wb-book-row'); row.dataset.bookId = item.id;
          const text = el('div', null, 'wb-grow');
          const chapters = item.chapters.filter(chapter => !chapter.archived);
          const readBook = () => transition(() => { view.bookId = item.id; view.chapterId = chapters[0]?.id || null; view.reading = true; view.shown = 40; }, null);
          const title = el('h3'); title.append(action(item.title, readBook, 'wb-book-title-link'));
          text.append(title, el('p', [item.fromYear && item.toYear ? item.fromYear + '–' + item.toYear : item.fromYear || item.toYear, chapters.length + '개 장', '비공개'].filter(Boolean).join(' · '), 'life-meta'));
          const opening = chapters.find(chapter => chapter.note.trim())?.note.split(/\n\s*\n/)[0];
          if (opening) { const chars = Array.from(opening); text.append(el('p', chars.slice(0, 200).join('') + (chars.length > 200 ? '…' : ''), 'wb-book-opening')); }
          const openChapter = chapterId => transition(() => {
            view.bookId = item.id; view.chapterId = chapterId; view.shown = 40;
          }, chapterId ? 'wbChapterNote' : 'wbBookHeading');
          const entryActions = el('div', null, 'life-actions wb-book-entry-actions');
          entryActions.append(action('전체 읽기', readBook, 'life-primary'), discoveryIcon('책 열기', 'edit', () => openChapter(chapters[0]?.id || null)));
          row.append(text, entryActions);
          if (chapters.length) {
            const outline = details('목차', { open: activeBooks.length === 1 && chapters.length <= 6 }); outline.classList.add('wb-book-list-outline');
            chapters.forEach((chapter, index) => {
              const open = action((index + 1) + '. ' + chapter.title, () => openChapter(chapter.id));
              open.dataset.chapterId = chapter.id; outline.append(open);
            });
            row.append(outline);
          }
          list.append(row);
        });
        bodyNode.append(list);
        const archived = details('보관한 책 · ' + (books.length - activeBooks.length), { open: !activeBooks.length && books.length > 0 }); archived.id = 'wbArchivedBooks';
        for (const item of books.filter(value => value.archived)) {
          const row = el('div', null, 'wb-history-row'); row.append(el('p', item.title));
          const restore = action('책 복구', () => historyChange(value => life.BookHistory.archiveBook(value, item.id, false), () => {}, 'wbBookList'));
          restore.dataset.bookRestore = item.id; row.append(restore); archived.append(row);
        }
        archived.append(notice('보관한 책도 개정본·원문 연결과 함께 백업·구성 이어쓰기에 남습니다.'));
        bodyNode.append(archived);
        const createBox = details('새 책', { open: !books.length }); createBox.id = 'wbBookCreateBox';
        const title = field('책 제목', '', { id: 'wbBookCreateTitle' }); title.input.placeholder = '예: 20대, 일과 쉼';
        async function addBook(fromReflection) {
          const value = title.input.value.trim();
          if (!value) { title.input.focus(); throw fault('title_required', '책 제목을 입력해 주세요.'); }
          await transition(() => {
            if (books.length >= limits.books) throw fault('limit_reached', '책은 ' + limits.books + '권까지 만들 수 있습니다.');
            const chapters = fromReflection ? [{ id: core.id(), title: '회고에서 시작한 글', note: state.reflection.note, versionIds: state.reflection.versionIds.slice() }] : [];
            const next = { id: core.id(), title: value, fromYear: '', toYear: '', question: '', chapters };
            state.books = books.concat(next); view.bookId = next.id; view.chapterId = chapters[0]?.id || null; view.shown = 40;
            mark(session);
          }, 'wbBookHeading');
        }
        const add = action('빈 책 만들기', () => addBook(false), 'life-primary'); add.id = 'wbBookCreate';
        const fromReflection = action('기존 회고로 책 만들기', () => addBook(true)); fromReflection.id = 'wbBookFromReflection';
        fromReflection.disabled = !state.reflection.note && !state.reflection.versionIds.length;
        const actions = el('div', null, 'life-actions'); actions.append(add, fromReflection);
        createBox.append(title.wrapper, actions, notice('기존 회고로 시작하면 글과 선택한 원문 연결을 첫 장에 복사합니다. 기존 회고는 그대로 남습니다.'));
        const plan = action('회고에서 목차 구성', () => onWorkbenchNavigate({ workspaceId: session.workspaceId, mode: 'reflection', planOpen: true }));
        plan.id = 'wbBookPlanStart'; createBox.prepend(plan);
        bodyNode.append(createBox); return;
      }
      const back = discoveryIcon('책 목록', 'back', () => transition(() => { view.bookId = null; view.chapterId = null; }, 'wbBookList')); back.id = 'wbBooksBack';
      const heading = el('h3', book.title, 'wb-book-title'); heading.id = 'wbBookHeading'; heading.tabIndex = -1;
      const lead = el('div', null, 'wb-book-lead'), leadActions = el('div', null, 'wb-row wb-book-actions');
      saveControl.hidden = false; leadActions.append(back, saveControl); lead.append(leadActions, heading); bodyNode.append(lead);
      const openEdition = async (remember = () => {}) => {
        remember();
        const input = bodyNode.querySelector('#wbChapterNote');
        const position = input && { chapterId: view.chapterId, start: input.selectionStart, end: input.selectionEnd, top: input.scrollTop, pageY: global.scrollY, inputTop: input.getBoundingClientRect().top };
        await transition(() => {
          if (position) view.editorPosition = position;
          view.editionReturn = !!view.reading; view.edition = true;
          if (view.editionOptions?.bookId !== book.id) view.editionOptions = { bookId: book.id, paper: 'A5', includeInsights: false, includeSources: false };
        }, 'wbEditionHeading');
      };
      if (view.edition) {
        saveControl.hidden = true;
        renderBookEdition(session, book, view, active, transition, leadActions);
        return;
      }
      if (view.reading) {
        saveControl.hidden = true;
        renderBookReading(session, book, view, active, transition, leadActions, openEdition);
        return;
      }
      const openReading = action(view.readPosition ? '읽던 곳으로 돌아가기' : '전체 원고 읽기', async () => {
        const input = bodyNode.querySelector('#wbChapterNote');
        const position = input && { chapterId: view.chapterId, start: input.selectionStart, end: input.selectionEnd, top: input.scrollTop, pageY: global.scrollY, inputTop: input.getBoundingClientRect().top };
        await transition(() => { view.editorPosition = position; view.reading = true; }, null);
      });
      openReading.id = view.readPosition ? 'wbBookPreviewReturn' : 'wbBookPreviewOpen';
      openReading.setAttribute('aria-label', openReading.textContent); openReading.textContent = '읽기';
      leadActions.insertBefore(openReading, saveControl);
      const edition = action(view.editionOptions ? '책자 다시 보기' : '책자 만들기', () => openEdition()); edition.id = 'wbBookEditionOpen';
      const settings = details('책 설정'); settings.id = 'wbBookSettings';
      const title = field('책 제목', book.title, { id: 'wbBookTitle', change: value => { book.title = value; heading.textContent = value || '제목을 입력해 주세요'; } });
      const from = field('시작 연도', book.fromYear, { id: 'wbBookFromYear', max: 4, change: value => { book.fromYear = value; } });
      const to = field('끝 연도', book.toYear, { id: 'wbBookToYear', max: 4, change: value => { book.toYear = value; } });
      for (const input of [from.input, to.input]) { input.inputMode = 'numeric'; input.placeholder = '선택 사항'; }
      const period = el('div', null, 'wb-add-row'); period.append(from.wrapper, to.wrapper);
      const question = field('이 책에서 돌아볼 질문', book.question, { id: 'wbBookQuestion', multiline: true, max: limits.text, change: value => { book.question = value; } });
      settings.append(title.wrapper, period, notice('기간은 책의 범위를 적어 두는 정보입니다. 연결한 글을 자동으로 넣거나 빼지 않습니다. 비워 두면 기간을 제한하지 않습니다.'), question.wrapper);
      const archiveBook = action('책 보관', () => {
        if (!global.confirm('이 책을 보관함으로 옮길까요? 원고·개정본·원문 연결은 유지되며 보관한 책에서 복구할 수 있습니다.')) return;
        return historyChange(value => life.BookHistory.archiveBook(value, book.id), () => { view.bookId = null; }, 'wbBookList');
      }); archiveBook.id = 'wbBookArchive'; settings.append(archiveBook);
      const activeChapters = book.chapters.filter(item => !item.archived);
      const outline = details('목차', { open: !activeChapters.length }); outline.id = 'wbBookOutline';
      const chapterList = el('ol', null, 'wb-book-outline');
      activeChapters.forEach((chapter, index) => {
        const row = el('li', null, 'wb-row'); row.dataset.chapterId = chapter.id;
        const open = action(chapter.title, () => transition(() => { view.chapterId = chapter.id; view.shown = 40; }, 'wbChapterTitle'), 'wb-chapter-open');
        open.setAttribute('aria-label', '장 열기: ' + chapter.title);
        if (view.chapterId === chapter.id) open.setAttribute('aria-current', 'true');
        const move = direction => transition(() => {
          const position = activeChapters.indexOf(chapter), neighbour = activeChapters[position + direction];
          if (!neighbour) return;
          const at = book.chapters.indexOf(chapter), next = book.chapters.indexOf(neighbour);
          [book.chapters[at], book.chapters[next]] = [book.chapters[next], book.chapters[at]];
          view.outlineOpen = true; mark(session);
        }, 'wbBookOutlineHeading');
        const up = discoveryIcon('위로 이동', 'chevron', () => move(-1)); up.classList.add('wb-chapter-up'); up.disabled = index === 0;
        const down = discoveryIcon('아래로 이동', 'chevron', () => move(1)); down.disabled = index === activeChapters.length - 1;
        row.append(el('span', String(index + 1), 'wb-chapter-number'), open, up, down); chapterList.append(row);
      });
      outline.querySelector('summary').id = 'wbBookOutlineHeading';
      if (view.outlineOpen) { outline.open = true; view.outlineOpen = false; }
      const addRow = el('div', null, 'wb-add-row');
      const chapterTitle = field('새 장 제목', '', { id: 'wbChapterCreateTitle' }); chapterTitle.input.placeholder = '예: 처음 일하던 해';
      const addChapter = action('장 추가', async () => {
        const value = chapterTitle.input.value.trim();
        if (!value) { chapterTitle.input.focus(); throw fault('title_required', '장 제목을 입력해 주세요.'); }
        await transition(() => {
          if (book.chapters.length >= limits.bookChapters) throw fault('limit_reached', '한 책은 ' + limits.bookChapters + '개 장까지 구성할 수 있습니다.');
          const chapter = { id: core.id(), title: value, note: '', versionIds: [] };
          book.chapters.push(chapter); view.chapterId = chapter.id; view.shown = 40; mark(session);
        }, 'wbChapterNote');
      }); addChapter.id = 'wbChapterCreate'; addRow.append(chapterTitle.wrapper, addChapter);
      outline.append(chapterList, addRow);
      const archivedChapters = details('보관한 장 · ' + (book.chapters.length - activeChapters.length)); archivedChapters.id = 'wbArchivedChapters';
      for (const item of book.chapters.filter(value => value.archived)) {
        const row = el('div', null, 'wb-history-row'); row.append(el('p', item.title));
        const restore = action('장 복구', () => historyChange(value => life.BookHistory.archiveChapter(value, book.id, item.id, false), () => { view.chapterId = item.id; }, 'wbChapterNote'));
        restore.dataset.chapterRestore = item.id; row.append(restore); archivedChapters.append(row);
      }
      archivedChapters.append(notice('보관한 장은 현재 원고·Markdown·인쇄에서 빠지며 백업에는 남습니다. 복구하면 원래 목차 위치에 다시 나타납니다.'));
      outline.append(archivedChapters);
      const tools = el('div', null, 'wb-book-controls wb-book-management'); tools.id = 'wbBookManagement';
      tools.append(settings, bookEditions(session, book, view, historyChange), edition);
      const manage = discoveryIcon('책 설정·개정본·파일', 'settings', () => { tools.querySelector('summary')?.focus({ preventScroll: true }); tools.scrollIntoView({ block: 'start' }); });
      leadActions.insertBefore(outline, openReading); leadActions.insertBefore(manage, saveControl);
      outline.classList.add('wb-toolbar-outline');
      const outlineSummary = outline.querySelector('summary'); outlineSummary.setAttribute('aria-label', '목차'); outlineSummary.title = '목차'; outlineSummary.append(life.Icons.create('book'));
      const outlinePanel = el('div', null, 'wb-outline-panel'); while (outlineSummary.nextSibling) outlinePanel.append(outlineSummary.nextSibling); outline.append(outlinePanel);
      const chapter = view.chapterId ? activeChapters.find(item => item.id === view.chapterId) : activeChapters[0];
      if (chapter) {
        view.chapterId = chapter.id;
        const editor = el('section', null, 'wb-book-editor'); editor.dataset.activeChapterId = chapter.id;
        const chapterName = field('장 제목', chapter.title, { id: 'wbChapterTitle', wrapTitle: true, change: value => {
          chapter.title = value;
          const open = [...chapterList.querySelectorAll('[data-chapter-id]')].find(row => row.dataset.chapterId === chapter.id)?.querySelector('.wb-chapter-open');
          if (open) { open.textContent = value || '제목을 입력해 주세요'; open.setAttribute('aria-label', '장 열기: ' + value); }
        } });
        const note = field('이 장의 원고', chapter.note, { id: 'wbChapterNote', multiline: true, max: limits.text, change: value => { chapter.note = value; } });
        note.input.rows = 10; note.input.placeholder = '그때의 글을 읽으며 지금의 생각을 적어 보세요.';
        chapterName.wrapper.classList.add('wb-manuscript-title'); note.wrapper.classList.add('wb-manuscript-body');
        for (const wrapper of [chapterName.wrapper, note.wrapper]) wrapper.firstElementChild.classList.add('life-sr-only');
        const length = el('p', '', 'life-meta wb-book-length'); length.id = 'wbChapterLength';
        length.title = '일부 이모지는 두 글자로 계산됩니다.';
        const updateLength = () => { length.textContent = chapter.note.length.toLocaleString('ko-KR') + ' / ' + limits.text.toLocaleString('ko-KR'); };
        note.input.addEventListener('input', updateLength); updateLength();
        note.input.setAttribute('aria-describedby', length.id);
        const chapterNavigation = el('div', null, 'life-actions wb-chapter-navigation');
        const index = activeChapters.indexOf(chapter);
        for (const [offset, label] of [[-1, '이전 장'], [1, '다음 장']]) {
          const target = activeChapters[index + offset];
          const control = action(label, () => transition(() => { view.chapterId = target.id; view.shown = 40; }, 'wbChapterNote'));
          control.setAttribute('aria-label', label); control.title = label; control.replaceChildren(life.Icons.create(offset < 0 ? 'back' : 'arrow'));
          control.id = offset < 0 ? 'wbChapterPrevious' : 'wbChapterNext'; control.disabled = !target; chapterNavigation.append(control);
        }
        chapterNavigation.append(el('span', (index + 1) + ' / ' + activeChapters.length, 'life-meta'));
        editor.append(chapterNavigation, chapterName.wrapper, note.wrapper, length);
        const archiveChapter = action('이 장 보관', () => {
          if (!global.confirm('이 장을 보관할까요? 현재 원고 출력에서 빠지며 목차의 보관한 장에서 복구할 수 있습니다.')) return;
          return historyChange(value => life.BookHistory.archiveChapter(value, book.id, chapter.id), () => { view.chapterId = null; view.readPosition = null; }, 'wbBookOutlineHeading');
        }); archiveChapter.id = 'wbChapterArchive'; tools.append(archiveChapter);
        const sourceBox = details('이 장의 근거 · ' + chapter.versionIds.length + '개'); sourceBox.id = 'wbChapterEvidence';
        const importSources = action('자료 가져오기', async () => {
          if (session.composing.size) throw fault('input_in_progress', '입력을 마친 뒤 자료를 가져와 주세요.');
          await flush(); if (!active()) return;
          view.editorPosition = { chapterId: chapter.id, start: note.input.selectionStart, end: note.input.selectionEnd,
            direction: note.input.selectionDirection, top: note.input.scrollTop, left: note.input.scrollLeft, pageY: global.scrollY, inputTop: note.input.getBoundingClientRect().top };
          await onChapterImport({ workspaceId: session.workspaceId, bookId: book.id, chapterId: chapter.id,
            bookTitle: book.title, chapterTitle: chapter.title }, { isCurrent: active });
        }); importSources.id = 'wbChapterImport'; sourceBox.append(importSources);
        const pending = session.chapterImport;
        const reviewing = pending && pending.bookId === book.id && pending.chapterId === chapter.id && pending.workspaceId === session.workspaceId;
        importSources.hidden = !!reviewing;
        if (reviewing) {
          const review = el('section', null, 'wb-chapter-import'); review.id = 'wbChapterImportReview';
          review.setAttribute('aria-labelledby', 'wbChapterImportHeading');
          const heading = el('h3', chapter.title + ' · 자료 연결'); heading.id = 'wbChapterImportHeading'; heading.tabIndex = -1;
          review.append(heading, notice('보관한 원문 중 연결할 정확한 버전을 선택해 주세요. 선택하지 않은 자료도 원문으로 보관됩니다.'));
          const choices = [];
          for (const id of pending.versionIds) {
            const info = sourceInfo(id), row = sourceRow(id, { isCurrent: active,
              focusKey: 'book-import:' + book.id + ':' + chapter.id + ':' + id });
            const choice = toggle('이 버전 연결', pending.selected.has(id), checked => {
              if (!active() || session.chapterImport !== pending || pending.accepted) return;
              if (checked) pending.selected.add(id); else pending.selected.delete(id);
              apply.disabled = !pending.selected.size;
            });
            const input = choice.querySelector('input'); input.dataset.versionId = id;
            input.disabled = !info || !!pending.accepted; choices.push(input); row.append(choice); review.append(row);
          }
          const finish = () => {
            session.chapterImport = null; view.restoreEditor = true; view.evidenceOpen = chapter.id; redraw();
          };
          const apply = action(pending.accepted ? '연결 저장 다시 시도' : '선택한 자료 연결', async () => {
            if (!active() || session.chapterImport !== pending) return;
            if (session.composing.size) throw fault('input_in_progress', '입력을 마친 뒤 자료를 연결해 주세요.');
            const liveBook = session.state.books?.find(item => item.id === pending.bookId && !item.archived);
            const liveChapter = liveBook?.chapters.find(item => item.id === pending.chapterId && !item.archived);
            if (!liveChapter || getBundle()?.workspaceId !== pending.workspaceId) {
              throw fault('chapter_missing', '선택한 책이나 장을 찾을 수 없습니다. 원문은 그대로 보관했습니다.');
            }
            if (pending.versionIds.some(id => pending.selected.has(id) && !sourceInfo(id))) {
              throw fault('source_missing', '선택한 원문 버전을 찾을 수 없습니다. 다른 버전으로 바꾸지 않았습니다.');
            }
            if (!pending.accepted) {
              await flush(); if (!active() || session.chapterImport !== pending) return;
              const selected = pending.versionIds.filter(id => pending.selected.has(id));
              if (!selected.length) throw fault('empty_selection', '연결할 자료를 먼저 선택해 주세요.');
              const bundle = getBundle();
              if (bundle?.workspaceId !== pending.workspaceId || selected.some(id => !sourceInfo(id, bundle))) {
                throw fault('source_missing', '선택한 원문 버전을 찾을 수 없습니다. 다른 버전으로 바꾸지 않았습니다.');
              }
              const candidate = copy(session.state);
              const targetBook = candidate.books?.find(item => item.id === pending.bookId && !item.archived);
              const targetChapter = targetBook?.chapters.find(item => item.id === pending.chapterId && !item.archived);
              if (!targetChapter) throw fault('chapter_missing', '선택한 책이나 장을 찾을 수 없습니다. 원문은 그대로 보관했습니다.');
              targetChapter.versionIds = [...new Set(targetChapter.versionIds.concat(selected))];
              model.validate(candidate);
              // Keep the live editor objects: only the explicitly selected references change.
              chapter.versionIds = targetChapter.versionIds;
              mark(session, false); pending.accepted = true;
              choices.forEach(input => { input.disabled = true; }); cancel.disabled = true;
              apply.textContent = '연결 저장 다시 시도';
            }
            await flush();
            if (!active() || session.chapterImport !== pending) return;
            finish(); announceSafe('선택한 자료를 이 장에 연결했습니다.', session);
          }, 'life-primary', () => !!pending.accepted || pending.selected.size > 0);
          apply.id = 'wbChapterImportApply'; apply.disabled = !pending.accepted && !pending.selected.size;
          const cancel = action('연결하지 않고 돌아가기', () => {
            if (!active() || session.chapterImport !== pending) return;
            if (pending.accepted) throw fault('pending_chapter_import', '연결 초안을 먼저 저장하거나 저장본과 비교해 주세요. 보관한 원문은 유지됩니다.');
            finish();
          }); cancel.id = 'wbChapterImportCancel'; cancel.disabled = !!pending.accepted;
          const actions = el('div', null, 'life-actions'); actions.append(apply, cancel); review.append(actions); sourceBox.append(review);
          sourceBox.open = true;
        }
        const pickerHost = el('div'); pickerHost.hidden = !!reviewing;
        const rows = el('div', null, 'wb-book-sources'); rows.id = 'wbChapterSources';
        const more = action('연결한 원문 더 보기', () => { view.shown += 40; fillSources(); }); more.id = 'wbChapterMore';
        const refillPicker = () => pickerHost.replaceChildren(picker('이 장에 원문 연결', () => chapter.versionIds, (id, selected) => {
          chapter.versionIds = selected ? chapter.versionIds.concat(id) : chapter.versionIds.filter(value => value !== id);
          mark(session); fillSources();
        }, { max: limits.chapterVersions }));
        const fillSources = () => {
          const summary = sourceBox.querySelector('summary'), label = '이 장의 근거 · ' + chapter.versionIds.length + '개';
          summary.textContent = label; summary.setAttribute('aria-label', label); summary.title = label; summary.append(life.Icons.create('quote'));
          rows.replaceChildren();
          for (const id of chapter.versionIds.slice(0, view.shown)) {
            const row = sourceRow(id, { focusKey: 'books:' + book.id + ':' + chapter.id + ':' + id, isCurrent: active, remove: () => {
              chapter.versionIds = chapter.versionIds.filter(value => value !== id); mark(session); refillPicker(); fillSources(); sourceBox.querySelector('summary').focus();
            } });
            const info = sourceInfo(id); row.append(el('p', '원문 작성일 · ' + (info?.version.originalCreatedAt || '미확인'), 'life-meta'));
            if (info?.version.contentText != null) {
              const read = details('본문 읽기');
              read.addEventListener('toggle', () => {
                if (read.open && !read.querySelector('pre')) { const text = el('pre', info.version.contentText, 'wb-source-body'); text.tabIndex = 0; read.append(text); }
              }); row.append(read);
            }
            rows.append(row);
          }
          if (!chapter.versionIds.length) rows.append(notice('원문을 연결하지 않고 기억부터 적어도 됩니다. 원문 연결을 해제해도 원고는 지우지 않습니다.'));
          more.hidden = chapter.versionIds.length <= view.shown;
        };
        sourceBox.append(pickerHost, rows, more); refillPicker(); fillSources();
        // Keep the exact source return target visible after returning from its reader.
        sourceBox.open = !!pending && pending.bookId === book.id && pending.chapterId === chapter.id || view.evidenceOpen === chapter.id;
        sourceBox.addEventListener('toggle', () => { if (active()) view.evidenceOpen = sourceBox.open ? chapter.id : null; });
        editor.append(insightPanel(session, book, chapter, view, active), sourceBox); bodyNode.append(editor);
        editor.insertBefore(sourceBox, chapterName.wrapper);
        const fit = () => {
          if (!active() || !note.input.isConnected) return;
          // Measuring auto height can temporarily shrink the whole document and
          // clamp its scroll offset. Restore the page, not the text or caret.
          const position = { left: global.scrollX, top: global.scrollY, behavior: 'instant' };
          for (const input of [chapterName.input, note.input]) {
            const css = global.getComputedStyle(input); input.style.height = 'auto';
            input.style.height = Math.ceil(input.scrollHeight + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth)) + 'px';
          }
          global.scrollTo(position);
        };
        note.input.addEventListener('input', fit); chapterName.input.addEventListener('input', fit);
        chapterName.input.addEventListener('compositionend', fit); fit();
        let width = editor.getBoundingClientRect().width;
        if (global.ResizeObserver) {
          const observer = new global.ResizeObserver(() => { const next = editor.getBoundingClientRect().width; if (next !== width) { width = next; fit(); } });
          observer.observe(editor); viewCleanups.push(() => observer.disconnect());
        }
        global.document.fonts?.ready.then(fit);
      } else bodyNode.append(empty(book.chapters.length ? '선택한 장을 찾을 수 없습니다. 목차에서 편집할 장을 골라 주세요.' : '첫 장을 추가해 글과 생각을 모아 보세요.'));
      const exportBox = details('책 원고 파일로 보관');
      const include = toggle('연결한 원문 본문도 포함', !!view.includeSources, value => { view.includeSources = value; }); include.querySelector('input').id = 'wbBookIncludeSources';
      const exportButton = action('책 원고 Markdown 받기', async () => {
        if (session.composing.size) throw fault('input_in_progress', '입력을 마친 뒤 원고를 받아 주세요.');
        await flush(); if (!active()) return;
        const text = life.Books.markdown(getBundle(), state, book.id, { includeSources: include.querySelector('input').checked });
        const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); urls.add(url);
        const link = el('a'); link.href = url; link.download = 'haedo-book.md'; link.hidden = true;
        document.body.append(link); link.click(); link.remove();
        global.setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000);
      }); exportButton.id = 'wbBookExport';
      exportBox.append(include, notice('이 책의 보관하지 않은 장과 제외하지 않은 생각을 목차 순서대로 받습니다. 기본은 직접 쓴 원고·해석·출처이며 공개 게시하지 않습니다. 제외한 생각을 이미 원고에 적었다면 그 문장은 직접 검토하세요. 복원에는 자료·구성 JSON 백업을 사용하세요.'), exportButton);
      tools.append(exportBox); bodyNode.append(tools);
      if (view.restoreEditor) {
        view.restoreEditor = false;
        const input = bodyNode.querySelector('#wbChapterNote'), position = view.editorPosition;
        if (input) {
          if (position?.chapterId === view.chapterId) {
            input.setSelectionRange(position.start, position.end, position.direction); input.scrollTop = position.top;
            if (position.left !== undefined) input.scrollLeft = position.left;
          }
          input.focus({ preventScroll: true });
          if (position?.chapterId === view.chapterId && Number.isFinite(position.inputTop)) global.scrollBy({ top: input.getBoundingClientRect().top - position.inputTop, behavior: 'instant' });
          else if (position?.chapterId === view.chapterId && Number.isFinite(position.pageY)) global.scrollTo({ top: position.pageY, behavior: 'instant' });
          else input.scrollIntoView({ block: 'nearest' });
        }
      }
    }

    function bookEditions(session, book, view, change) {
      const box = details('개정본 · ' + (book.editions || []).length + ' / ' + limits.bookEditions, { open: !!view.editionsOpen }); box.id = 'wbBookEditions';
      const token = generation, stamp = view.renderId;
      box.addEventListener('toggle', () => { if (showing(token, session) && view.renderId === stamp) view.editionsOpen = box.open; });
      const label = field('개정본 이름', '', { id: 'wbEditionLabel' }); label.input.placeholder = '예: 처음 끝까지 읽은 원고';
      const capture = action('현재 원고 보관', () => {
        const value = label.input.value.trim();
        if (!value) { label.input.focus(); throw fault('title_required', '개정본 이름을 입력해 주세요.'); }
        return change(state => life.BookHistory.capture(state, book.id, value), () => { view.editionsOpen = true; }, 'wbBookEditionsHeading');
      }); capture.id = 'wbEditionCapture';
      box.querySelector('summary').id = 'wbBookEditionsHeading';
      box.append(label.wrapper, capture, notice('책 제목·질문·모든 장·해석·정확한 원문 연결을 보관합니다. 원문 본문을 복제하지 않으며 자동 개정 이력은 아닙니다. 복원할 때 현재 원고도 개정본 한 칸에 먼저 보관합니다.'));
      for (const edition of (book.editions || []).slice().reverse()) {
        const row = el('section', null, 'wb-edition'); row.dataset.editionId = edition.id;
        row.append(el('h4', edition.label), el('p', new Date(edition.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ' · 한국 시간', 'life-meta'));
        const content = details('개정본 내용 확인');
        content.addEventListener('toggle', () => {
          if (!content.open || content.dataset.loaded) return;
          content.dataset.loaded = 'true';
          content.append(el('h5', edition.title), el('p', (edition.fromYear || '미지정') + ' ~ ' + (edition.toYear || '미지정'), 'life-meta'), el('p', edition.question, 'wb-history-text'));
          for (const chapter of edition.chapters) {
            content.append(el('h5', chapter.title + (chapter.archived ? ' · 보관한 장' : '')), el('p', chapter.note, 'wb-history-text'));
            content.append(el('p', '장 원문: ' + chapter.versionIds.map(id => sourceName(id)).join(' · '), 'life-meta'));
            for (const insight of chapter.insights || []) {
              content.append(el('p', '내 해석' + (insight.excluded ? ' · 원고에서 제외' : ''), 'life-meta'), el('p', insight.statement, 'wb-history-text'), el('p', insight.uncertainty, 'wb-history-text'),
                el('p', '근거: ' + insight.supportVersionIds.map(id => sourceName(id)).join(' · '), 'life-meta'), el('p', '반례: ' + insight.counterVersionIds.map(id => sourceName(id)).join(' · '), 'life-meta'));
            }
          }
        });
        const restore = action('이 개정본으로 복원', () => {
          if (!global.confirm('현재 원고를 먼저 개정본으로 보관한 뒤 선택한 원고로 되돌릴까요? 보관한 장과 제외한 해석도 선택 당시 상태로 돌아갑니다.')) return;
          return change(state => life.BookHistory.restore(state, book.id, edition.id), next => {
            view.chapterId = next.books.find(item => item.id === book.id).chapters.find(item => !item.archived)?.id || null;
            view.readPosition = null; view.editorPosition = null; view.editionsOpen = true;
          }, 'wbChapterNote');
        });
        const remove = action('개정본 삭제', () => {
          if (!global.confirm('이 개정본을 영구 삭제할까요? 현재 원고와 원문은 남지만 이 개정본은 자료·구성 JSON 백업이 없으면 복구할 수 없습니다.')) return;
          return change(state => life.BookHistory.deleteEdition(state, book.id, edition.id), () => { view.editionsOpen = true; }, 'wbBookEditionsHeading');
        });
        const actions = el('div', null, 'life-actions'); actions.append(restore, remove); row.append(content, actions); box.append(row);
      }
      box.append(notice('최대 10개와 전체 구성 2 MiB 한도를 함께 적용합니다. 용량이 부족하면 자료·구성 JSON을 보관한 뒤 필요 없는 개정본을 직접 삭제하세요. 오래된 개정본을 자동으로 지우지 않습니다.'));
      return box;
    }

    function renderBookEdition(session, book, view, active, transition, leadActions) {
      const settings = view.editionOptions;
      const box = el('section', null, 'wb-book-edition'); box.id = 'wbBookEdition';
      const heading = el('h4', '책자 미리보기', 'life-sr-only'); heading.id = 'wbEditionHeading'; heading.tabIndex = -1;
      const back = action(view.editionReturn ? '전체 원고로 돌아가기' : '원고 편집', () => {
        rememberFrame();
        return transition(() => { view.edition = false; view.reading = view.editionReturn; view.restoreEditor = !view.editionReturn; });
      }); back.id = 'wbEditionBack'; leadActions.append(back);
      const controls = el('div', null, 'wb-edition-controls');
      const paperLabel = el('label', null, 'life-field'); paperLabel.append(el('span', '판형'));
      const paper = el('select'); paper.id = 'wbEditionPaper';
      for (const value of ['A5', 'A4']) { const option = el('option', value === 'A5' ? 'A5 · 작은 책' : 'A4 · 큰 원고'); option.value = value; paper.append(option); }
      paper.value = settings.paper; paperLabel.append(paper);
      const insights = toggle('내 해석·아직 모르는 점 포함', settings.includeInsights, value => { settings.includeInsights = value; refresh(); });
      insights.querySelector('input').id = 'wbEditionInsights';
      const sources = toggle('연결한 원문 본문 포함', settings.includeSources, value => { settings.includeSources = value; refresh(); });
      sources.querySelector('input').id = 'wbEditionSources';
      paper.addEventListener('change', () => { if (active()) { settings.paper = paper.value; refresh(); } });
      controls.append(paperLabel, insights, sources);
      const scope = details('포함 범위');
      scope.append(notice('표지·목차·장 원고·출처 부록을 만듭니다. 책 설정의 질문·기간, 제외한 해석과 보관한 장은 넣지 않습니다. 해석을 넣으면 아직 모르는 점과 근거·반례도 함께 넣습니다. 원문 본문은 별도 선택입니다.'));
      scope.append(notice('이 설정은 이 책을 여는 동안만 유지됩니다. 파일을 만들며 저장된 원고·공개 범위를 바꾸지 않습니다.'));
      const status = el('p', '', 'life-meta'); status.id = 'wbEditionStatus'; status.setAttribute('role', 'status');
      const frameHost = el('div', null, 'wb-edition-frame');
      let ready = false, content = '', projection, seq = 0, timer, frame, frameURL;
      function rememberFrame() {
        if (!ready || !frame?.contentDocument) return;
        const doc = frame.contentDocument, win = frame.contentWindow;
        const anchors = [...doc.querySelectorAll('main > [id]')];
        const anchor = anchors.filter(node => node.getBoundingClientRect().top <= 60).at(-1);
        view.editionPosition = { id: anchor?.id || null, top: anchor?.getBoundingClientRect().top || 0, y: win.scrollY };
      }
      const clearFrame = () => { frameHost.replaceChildren(); if (frameURL) { URL.revokeObjectURL(frameURL); frameURL = null; } };
      const printOptions = () => ({ mode: 'book', paper: settings.paper, includeInsights: settings.includeInsights });
      const available = () => active() && ready;
      const download = action('책자 HTML 받기', async () => {
        await flush(); if (!available()) return;
        const url = URL.createObjectURL(new Blob([content], { type: 'text/html;charset=utf-8' })); urls.add(url);
        const link = el('a'); link.href = url; link.download = 'haedo-book-' + settings.paper.toLowerCase() + '.html'; link.hidden = true;
        document.body.append(link); link.click(); link.remove();
        global.setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000);
      }, '', available); download.id = 'wbEditionHTML';
      const print = action('인쇄 · PDF', async () => {
        await flush(); if (!available()) return;
        const printSeq = seq;
        try { await life.BookPrint.print(projection, { ...printOptions(), isCurrent: () => active() && seq === printSeq }); }
        catch (error) { if ((!active() || seq !== printSeq) && error?.code === 'book_print_cancelled') return; throw error; }
        if (active() && seq === printSeq) announceSafe('인쇄 창에서 PDF로 저장하세요. 미리보기의 최종 쪽나눔과 파일 보관은 인쇄 창에서 확인해 주세요.', session);
      }, 'life-primary', available); print.id = 'wbEditionPrint';
      const retry = action('미리보기 다시 만들기', () => refresh()); retry.id = 'wbEditionRetry'; retry.hidden = true;
      function failed(error, attempt) {
        if (!active() || attempt !== seq) return;
        clearTimeout(timer); ready = false; content = ''; projection = null; clearFrame();
        download.disabled = print.disabled = true; retry.hidden = false;
        status.textContent = error?.message || '미리보기를 만들지 못했습니다. 원고는 유지했습니다.';
      }
      function refresh() {
        rememberFrame(); const attempt = ++seq; clearTimeout(timer); life.BookPrint.cancel();
        ready = false; content = ''; projection = null; download.disabled = print.disabled = true; retry.hidden = true;
        clearFrame(); status.textContent = '책자를 만드는 중…';
        try {
          projection = life.Books.project(getBundle(), session.state, book.id, { includeSources: settings.includeSources });
          content = life.BookPrint.document(projection, printOptions());
          frame = el('iframe'); frame.id = 'wbEditionPreview'; frame.title = '책자 본문 미리보기';
          frame.setAttribute('sandbox', 'allow-same-origin'); frame.setAttribute('referrerpolicy', 'no-referrer');
          let loaded = false;
          frame.addEventListener('load', async () => {
            try {
              if (!active() || attempt !== seq || loaded || frame.contentDocument?.documentElement?.dataset.haedoPrint !== 'v1') return;
              loaded = true;
              await frame.contentDocument.fonts.ready;
              if (!active() || attempt !== seq) return;
              const position = view.editionPosition;
              if (position) {
                const anchor = position.id && frame.contentDocument.getElementById(position.id);
                frame.contentWindow.scrollTo(0, anchor ? anchor.getBoundingClientRect().top + frame.contentWindow.scrollY - position.top : position.y);
              }
              clearTimeout(timer); ready = true; download.disabled = print.disabled = false;
              status.textContent = '책자 준비됨 · 최종 쪽나눔은 인쇄 창에서 확인하세요.';
            } catch (error) { failed(error, attempt); }
          });
          frameURL = URL.createObjectURL(new Blob([content], { type: 'text/html;charset=utf-8' }));
          frame.src = frameURL; frameHost.append(frame);
          timer = global.setTimeout(() => failed(new Error('미리보기 준비가 지연됐습니다. 다시 시도해 주세요. 원고는 유지했습니다.'), attempt), 15000);
        } catch (error) { failed(error, attempt); }
      }
      const editLabel = el('label', null, 'life-field'); editLabel.append(el('span', '고칠 장'));
      const editChapter = el('select'); editChapter.id = 'wbEditionEditChapter';
      for (const chapter of book.chapters.filter(item => !item.archived)) { const option = el('option', chapter.title); option.value = chapter.id; editChapter.append(option); }
      if ([...editChapter.options].some(option => option.value === view.chapterId)) editChapter.value = view.chapterId;
      editLabel.append(editChapter);
      const edit = action('이 장 고치기', () => {
        rememberFrame();
        const index = [...editChapter.options].findIndex(option => option.value === editChapter.value);
        const chapterAnchor = 'haedo-book-chapter-' + (index + 1);
        if (view.editionPosition?.id !== chapterAnchor) view.editionPosition = { id: chapterAnchor, top: 0, y: 0 };
        return transition(() => {
          view.chapterId = editChapter.value; view.edition = false; view.reading = false; view.restoreEditor = true;
        });
      }); edit.id = 'wbEditionEdit'; edit.disabled = !editChapter.options.length;
      const editing = el('div', null, 'wb-edition-edit'); editing.append(editLabel, edit);
      const actions = el('div', null, 'life-actions'); actions.append(download, print, retry);
      const outputSettings = details('책자 설정'); outputSettings.id = 'wbEditionSettings'; outputSettings.append(controls, scope);
      const editSettings = details('장 고치기'); editSettings.id = 'wbEditionEditing'; editSettings.append(editing);
      const toolbar = el('div', null, 'wb-edition-toolbar'); toolbar.append(outputSettings, editSettings);
      box.append(heading, toolbar, actions, status, frameHost); bodyNode.append(box);
      viewCleanups.push(() => { ++seq; clearTimeout(timer); clearFrame(); content = ''; projection = null; life.BookPrint.cancel(); });
      refresh();
    }

    function renderBookReading(session, book, view, active, transition, leadActions, openEdition) {
      const projection = life.Books.project(getBundle(), session.state, book.id, { includeSources: !!view.includeSources });
      const reader = el('article', null, 'wb-book-reading'); reader.id = 'wbBookPreview';
      reader.setAttribute('aria-label', '전체 원고 미리보기');
      view.readOpen ||= [];
      const remember = () => {
        const candidates = [...reader.querySelectorAll('[data-read-anchor]')].filter(node => node.getClientRects().length);
        const anchor = candidates.find(node => node.getBoundingClientRect().bottom > 100) || candidates.at(-1);
        view.readPosition = anchor ? { key: anchor.dataset.readAnchor, text: anchor.textContent, chapterId: anchor.closest('[data-preview-chapter-id]')?.dataset.previewChapterId, top: anchor.getBoundingClientRect().top } : null;
        view.readOpen = [...reader.querySelectorAll('details[open]')].map(node => node.dataset.readDetail);
      };
      const returnEditor = chapterId => {
        remember(); view.readFocusChapter = chapterId || view.chapterId;
        return transition(() => { view.chapterId = chapterId || view.chapterId; view.reading = false; view.restoreEditor = true; }, null);
      };
      const edition = action('책자 만들기', () => openEdition(remember)); edition.id = 'wbBookEditionOpen';
      const back = action('집필', () => {
        // A previous chapter's trailing space can remain above a TOC destination.
        // Edit the chapter occupying most of the unobscured reading viewport.
        const top = Math.max(0, leadActions.getBoundingClientRect().bottom);
        const visible = [...reader.querySelectorAll('[data-preview-chapter-id]')].map(node => {
          const rect = node.getBoundingClientRect();
          return { node, height: Math.max(0, Math.min(global.innerHeight, rect.bottom) - Math.max(top, rect.top)) };
        }).filter(item => item.height > 0).sort((a, b) => b.height - a.height)[0]?.node;
        return returnEditor(visible?.dataset.previewChapterId || view.chapterId);
      }); back.setAttribute('aria-label', '원고 편집'); back.id = 'wbBookPreviewBack'; leadActions.append(back);
      const outline = details('목차'); outline.id = 'wbBookPreviewOutline';
      for (const chapter of projection.chapters) {
        const jump = action(chapter.title, () => {
          outline.open = false;
          const target = [...reader.querySelectorAll('[data-preview-chapter-id]')].find(node => node.dataset.previewChapterId === chapter.id);
          target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'start' });
        }, 'wb-reading-jump'); outline.append(jump);
      }
      outline.classList.add('wb-toolbar-outline');
      const outlineSummary = outline.querySelector('summary'); outlineSummary.setAttribute('aria-label', '목차'); outlineSummary.title = '목차'; outlineSummary.append(life.Icons.create('book'));
      const outlinePanel = el('div', null, 'wb-outline-panel'); while (outlineSummary.nextSibling) outlinePanel.append(outlineSummary.nextSibling); outline.append(outlinePanel);
      leadActions.insertBefore(outline, back);
      const options = details('읽기·파일 설정', { open: !!view.readOptionsOpen }); options.id = 'wbBookPreviewOptions';
      options.addEventListener('toggle', () => { if (active()) view.readOptionsOpen = options.open; });
      const include = toggle('연결한 원문 본문도 포함', !!view.includeSources, value => {
        remember(); view.readOptionsOpen = true; view.focusReadOptions = true; view.includeSources = value; redraw();
      }); include.querySelector('input').id = 'wbBookPreviewIncludeSources';
      options.append(include, notice('미리보기와 파일에 같은 내용을 포함합니다. HTML·Markdown 문법은 이 화면에서 텍스트로 표시합니다. 공개 게시하지 않습니다.'));
      const download = action('책 원고 Markdown 받기', async () => {
        await flush(); if (!active()) return;
        const text = life.Books.markdown(getBundle(), session.state, book.id, { includeSources: !!view.includeSources });
        const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); urls.add(url);
        const link = el('a'); link.href = url; link.download = 'haedo-book.md'; link.hidden = true;
        document.body.append(link); link.click(); link.remove();
        global.setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000);
      }); download.id = 'wbBookPreviewExport';
      const print = action('인쇄 · PDF', async () => {
        await flush(); if (!active()) return;
        const content = life.Books.project(getBundle(), session.state, book.id, { includeSources: !!view.includeSources });
        try { await life.BookPrint.print(content, { isCurrent: active }); }
        catch (error) { if (!active() && error?.code === 'book_print_cancelled') return; throw error; }
        if (active()) announceSafe('인쇄 창에서 PDF로 저장하거나 프린터를 선택하세요. 실제 파일 보관은 직접 확인해 주세요.', session);
      }); print.id = 'wbBookPrint';
      viewCleanups.push(() => life.BookPrint?.cancel());
      const toolbar = el('div', null, 'wb-reading-tools wb-book-management'); toolbar.id = 'wbBookReadingTools'; toolbar.append(bookReview(projection, returnEditor), options, edition, download, print);
      const output = discoveryIcon('원고 점검·파일·인쇄', 'download', () => { toolbar.querySelector('summary')?.focus({ preventScroll: true }); toolbar.scrollIntoView({ block: 'start' }); }); leadActions.append(output);
      const intro = details('책 소개'); intro.classList.add('wb-reading-intro');
      intro.append(el('p', '비공개 원고 · ' + (projection.fromYear || '미지정') + ' ~ ' + (projection.toYear || '미지정'), 'life-meta'));
      if (projection.question) intro.append(el('p', projection.question, 'wb-reading-question'));
      function textBlocks(hostNode, text, key) {
        // Preserve all text (including blank lines); paragraph anchors stay session-local.
        const pieces = text.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) || [''];
        if (pieces.length > 200) pieces.splice(199, pieces.length - 199, pieces.slice(199).join(''));
        const content = el('div', null, 'wb-reading-text');
        pieces.forEach((piece, index) => {
          const node = el('span', piece); node.dataset.readAnchor = key + ':' + index; content.append(node);
        }); hostNode.append(content);
      }
      function provenance(items, label, key) {
        const box = details(label + ' · ' + items.length); box.dataset.readDetail = key;
        box.open = view.readOpen.includes(key);
        if (!items.length) box.append(notice('선택한 근거 원문이 없습니다.'));
        items.forEach((item, index) => {
          const row = el('section', null, 'wb-reading-source'); row.dataset.versionId = item.versionId;
          row.dataset.readAnchor = key + ':' + index;
          if (item.missing) row.append(el('p', '연결된 원문 없음'), notice('다른 버전으로 대체하지 않았습니다.'));
          else {
            const relation = { self: '내 기록', other: '다른 사람의 기록', unknown: '작성자 관계 미확인' };
            row.append(el('h5', item.title), el('p', [
              '원문 작성일: ' + (item.originalCreatedAt || '미확인'),
              '원 작성자: ' + (item.originalAuthor.label || '미확인'),
              '작성자 관계: ' + (relation[item.originalAuthor.relation] || relation.unknown),
              '원문 URL: ' + (item.url || '미제공'),
              '선택 버전: ' + item.versionNumber + '/' + item.versionTotal,
              '본문 확보 범위: ' + item.coverage.status,
              '누락: ' + (item.coverage.omissions.join(' · ') || '확인한 누락 없음')
            ].join('\n'), 'life-meta wb-reading-provenance'));
            if (projection.includeSources) {
              if (item.body == null) row.append(notice('본문 미확보 · 링크만 보관했습니다.'));
              else textBlocks(row, item.body, key + ':' + index + ':body');
            }
            const focusKey = 'book-preview:' + book.id + ':' + key + ':' + item.versionId;
            const open = discoveryIcon('이 원문 버전 열기', 'book', () => { remember(); return openVersion(item.versionId, focusKey, active); });
            open.dataset.focusKey = focusKey; row.append(open);
          }
          box.append(row);
        }); return box;
      }
      projection.chapters.forEach((chapter, index) => {
        const section = el('section', null, 'wb-reading-chapter'); section.dataset.previewChapterId = chapter.id; section.tabIndex = -1;
        const titleRow = el('div', null, 'wb-reading-chapter-heading');
        const title = el('h4', chapter.title); title.dataset.readAnchor = chapter.id + ':title';
        const edit = discoveryIcon('이 장 편집', 'edit', () => returnEditor(chapter.id)); edit.dataset.previewEdit = chapter.id;
        titleRow.append(el('span', String(index + 1), 'wb-chapter-number'), title, edit); section.append(titleRow);
        if (chapter.note) textBlocks(section, chapter.note, chapter.id + ':note');
        else section.append(notice('아직 작성한 원고가 없습니다.'));
        section.append(provenance(chapter.evidence, '이 장의 근거', chapter.id + ':evidence'));
        chapter.insights.forEach((insight, n) => {
          const thought = el('section', null, 'wb-reading-thought');
          const heading = el('h5', '내 해석 ' + (n + 1)); heading.dataset.readAnchor = insight.id + ':title'; thought.append(heading);
          if (!insight.statement.trim()) thought.append(notice('아직 작성하지 않은 해석'));
          textBlocks(thought, insight.statement, insight.id + ':statement');
          if (insight.uncertainty) { thought.append(el('h6', '아직 모르는 점')); textBlocks(thought, insight.uncertainty, insight.id + ':uncertainty'); }
          thought.append(provenance(insight.supportEvidence, '근거로 연결한 원문', insight.id + ':support'), provenance(insight.counterEvidence, '반례로 연결한 원문', insight.id + ':counter'));
          section.append(thought);
        }); reader.append(section);
      });
      if (!projection.chapters.length) reader.append(empty('아직 구성한 장이 없습니다. 원고 편집에서 첫 장을 추가해 주세요.'));
      reader.append(intro, notice('원문 작성일은 경험 시기를 뜻하지 않습니다. 해석은 직접 쓴 생각이며 연결한 글이 그 생각을 증명하지는 않습니다.'));
      bodyNode.append(reader, toolbar);
      // Save the view before navigating to another original; restore only this render.
      const saved = view.readPosition;
      global.requestAnimationFrame(() => {
        if (!active() || !reader.isConnected) return;
        const anchors = [...reader.querySelectorAll('[data-read-anchor]')].filter(node => node.getClientRects().length);
        const exact = saved && anchors.find(node => node.dataset.readAnchor === saved.key);
        const anchor = saved && (exact?.textContent === saved.text ? exact : anchors.find(node =>
          node.closest('[data-preview-chapter-id]')?.dataset.previewChapterId === saved.chapterId && node.textContent === saved.text) || exact ||
          anchors.find(node => node.dataset.readAnchor === saved.chapterId + ':title'));
        const focus = view.focusReadOptions ? include.querySelector('input') : [...reader.querySelectorAll('[data-preview-edit]')].find(node => node.dataset.previewEdit === view.readFocusChapter) || anchor?.closest('[data-preview-chapter-id]') || reader;
        view.focusReadOptions = false;
        if (!focus.matches('button,input')) focus.tabIndex = -1; focus.focus({ preventScroll: true });
        if (anchor) global.scrollBy(0, anchor.getBoundingClientRect().top - saved.top);
        else { bodyNode.querySelector('#wbBookHeading')?.scrollIntoView({ block: 'start' }); }
      });
    }

    function insightPanel(session, book, chapter, view, bookActive) {
      const panel = details('생각과 근거'); panel.id = 'wbChapterInsights';
      panel.open = view.insightsOpenChapter === chapter.id;
      panel.addEventListener('toggle', () => { if (bookActive()) view.insightsOpenChapter = panel.open ? chapter.id : null; });
      const content = el('div', null, 'wb-insights-content'); panel.append(content);
      let turn = 0;
      function fill() {
        const stamp = ++turn, active = () => bookActive() && turn === stamp;
        async function change(task, focusId) {
          if (session.composing.size) throw fault('input_in_progress', '입력을 마친 뒤 생각을 바꿔 주세요.');
          await flush(); if (!active()) return;
          task(); fill();
          const target = focusId && content.querySelector('#' + focusId);
          target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'nearest' });
        }
        const insights = chapter.insights || [], enabled = insights.filter(item => !item.excluded);
        panel.querySelector('summary').textContent = '생각과 근거 · ' + enabled.length + '개';
        content.replaceChildren();
        const list = el('div', null, 'wb-insight-list');
        const names = new Map();
        function insightRow(item, excluded) {
          const row = el('div', null, 'wb-row wb-insight-row'); row.dataset.insightId = item.id;
          const name = el('p', item.statement.trim() ? item.statement.slice(0, 120) : '아직 적지 않은 생각', 'wb-grow'); names.set(item.id, name);
          row.append(name, discoveryIcon(excluded ? '생각 복원' : '생각 열기', excluded ? 'plus' : 'edit', () => change(() => {
            if (excluded) { item.excluded = false; mark(session); }
            view.insightId = item.id;
          }, 'wbInsightStatement')));
          if (view.insightId === item.id) row.dataset.current = 'true';
          return row;
        }
        enabled.forEach(item => list.append(insightRow(item, false)));
        if (!enabled.length) list.append(notice('글을 읽으며 달라진 생각이나 아직 답하지 못한 질문을 남겨 보세요.'));
        const add = action('생각 추가', () => change(() => {
          if (insights.length >= limits.chapterInsights) throw fault('limit_reached', '한 장의 생각은 제외한 항목을 포함해 ' + limits.chapterInsights + '개까지 보관할 수 있습니다.');
          const item = { id: core.id(), statement: '', uncertainty: '', supportVersionIds: [], counterVersionIds: [], excluded: false };
          chapter.insights = insights.concat(item); view.insightId = item.id; mark(session);
        }, 'wbInsightStatement')); add.id = 'wbInsightCreate';
        content.append(list, add);
        const item = insights.find(value => value.id === view.insightId && !value.excluded);
        if (item) {
          const editor = el('section', null, 'wb-insight-editor'); editor.dataset.activeInsightId = item.id;
          const statement = field('지금의 생각', item.statement, { id: 'wbInsightStatement', multiline: true, max: limits.text, change: value => {
            item.statement = value; names.get(item.id).textContent = value.trim() ? value.slice(0, 120) : '아직 적지 않은 생각';
          } }); statement.input.rows = 5; statement.input.placeholder = '예: 예전에는 결과를 먼저 보았지만, 이제는 내가 선택한 이유를 더 오래 돌아본다.';
          const uncertainty = field('아직 모르는 점', item.uncertainty, { id: 'wbInsightUncertainty', multiline: true, max: limits.text, change: value => { item.uncertainty = value; } });
          uncertainty.input.rows = 3; uncertainty.input.placeholder = '다른 설명이 가능한지, 어떤 기록이 더 필요한지 적어 보세요.';
          editor.append(statement.wrapper, notice('당시의 기록과 구분한 현재의 해석입니다. 연결한 글이 생각을 자동으로 증명하지는 않습니다.'));
          for (const [role, key, label, pickerLabel] of [
            ['Support', 'supportVersionIds', '뒷받침하는 글', '뒷받침할 원문 연결'],
            ['Counter', 'counterVersionIds', '다른 관점의 글', '다른 관점의 원문 연결']
          ]) {
            const box = details(label + ' · ' + item[key].length + '개'); box.id = 'wbInsight' + role;
            const pickerHost = el('div'), rows = el('div', null, 'wb-insight-sources'); rows.id = box.id + 'Rows';
            const slot = item.id + ':' + role; view.insightShown ||= {};
            let shown = view.insightShown[slot] || 20;
            const more = action('연결한 글 더 보기', () => { shown += 20; view.insightShown[slot] = shown; sources(); });
            const refill = () => pickerHost.replaceChildren(picker(pickerLabel, () => item[key], (id, selected) => {
              item[key] = selected ? item[key].concat(id) : item[key].filter(value => value !== id);
              mark(session); sources();
            }, { max: limits.insightVersions }));
            const sources = () => {
              box.querySelector('summary').textContent = label + ' · ' + item[key].length + '개'; rows.replaceChildren();
              for (const id of item[key].slice(0, shown)) {
                const row = sourceRow(id, { focusKey: 'insight:' + book.id + ':' + chapter.id + ':' + item.id + ':' + role + ':' + id,
                  isCurrent: active, remove: () => { item[key] = item[key].filter(value => value !== id); mark(session); refill(); sources(); box.querySelector('summary').focus(); } });
                const info = sourceInfo(id); row.append(el('p', '원문 작성일 · ' + (info?.version.originalCreatedAt || '미확인'), 'life-meta')); rows.append(row);
              }
              if (!item[key].length) rows.append(notice(role === 'Support' ? '아직 연결한 근거가 없습니다. 기억이나 추정은 아직 모르는 점에 구분해 적어도 됩니다.' : '다른 관점의 글이 없다는 뜻은 아닙니다. 아직 찾지 못한 반례도 남겨 두세요.'));
              more.hidden = item[key].length <= shown;
            };
            box.append(pickerHost, rows, more); refill(); sources(); editor.append(box);
          }
          const exclude = action('원고에서 제외', () => change(() => { item.excluded = true; view.insightId = null; mark(session); }, 'wbInsightExcludedSummary')); exclude.id = 'wbInsightExclude';
          editor.append(uncertainty.wrapper, exclude, notice('제외하면 이 생각과 전용 근거는 책 파일에서 빠집니다. 장 원고에 이미 적은 문장과 별도로 연결한 글은 유지되며, 자료 삭제나 모든 분석에서의 제외는 아닙니다.'));
          content.append(editor);
        }
        const removed = insights.filter(value => value.excluded);
        if (removed.length) {
          const excluded = details('제외한 생각 · ' + removed.length + '개'); excluded.id = 'wbInsightExcluded';
          excluded.querySelector('summary').id = 'wbInsightExcludedSummary';
          removed.forEach(value => excluded.append(insightRow(value, true))); content.append(excluded);
        }
      }
      fill(); return panel;
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
      compare.append(el('h3', '구성 비교'), notice('내 초안을 적용하면 아래 저장본의 묶음·페이지·회고·책 구성이 바뀝니다. 보관한 원문은 바뀌지 않습니다.'));
      function summary(state) {
        const text = ['묶음', ...state.groups.map(group => group.title + '\n' + group.versionIds.map(id => sourceName(id)).join('\n')),
          '\n페이지: ' + state.page.title, '소개 표시: ' + (state.page.showIntro ? '켬' : '끔'), state.page.intro,
          '고정하지 않은 항목 표시: ' + (state.page.showRecent ? '켬' : '끔')];
        state.page.entries.forEach(entry => text.push('\n' + entry.title,
          '항목 ' + (entry.enabled ? '표시' : '숨김') + ' · 고정 ' + (entry.pinned ? '켬' : '끔') + ' · 본문 ' + (entry.showBody ? '표시' : '숨김') + ' · 코멘트 ' + (entry.showNote ? '표시' : '숨김'),
          ...entry.parts.map(part => sourceName(part.versionId) + ' · ' + (part.enabled ? '표시' : '숨김')), entry.note));
        text.push('\n회고 원문', ...state.reflection.versionIds.map(id => sourceName(id)), state.reflection.note);
        function chaptersSummary(chapters, historical = false) {
          chapters.forEach((chapter, index) => {
            text.push('\n' + (index + 1) + '. ' + chapter.title + (chapter.archived ? ' · 보관한 장' : ''), chapter.note, ...chapter.versionIds.map(id => sourceName(id)));
            for (const thought of chapter.insights || []) text.push('\n' + (historical ? '당시 해석' : '현재 해석') + (thought.excluded ? ' · 원고에서 제외' : ''), thought.statement,
              '아직 모르는 점: ' + thought.uncertainty, '뒷받침하는 글', ...thought.supportVersionIds.map(id => sourceName(id)),
              '다른 관점의 글', ...thought.counterVersionIds.map(id => sourceName(id)));
          });
        }
        for (const book of state.books || []) {
          text.push('\n책: ' + book.title + (book.archived ? ' · 보관한 책' : ''), '기간: ' + book.fromYear + ' ~ ' + book.toYear, book.question);
          chaptersSummary(book.chapters);
          for (const edition of book.editions || []) {
            text.push('\n개정본: ' + edition.label, edition.createdAt, edition.title, edition.fromYear + ' ~ ' + edition.toYear, edition.question);
            chaptersSummary(edition.chapters, true);
          }
        }
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
      bodyNode.append(notice('보관한 원문·발췌와 묶음·페이지·회고·책 구성을 함께 담습니다. 미적용 가져오기 초안·사진·연표는 포함하지 않습니다.'));
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
        const books = candidate.workbench.books || [];
        const chapters = books.flatMap(book => book.chapters);
        const activeChapters = books.filter(book => !book.archived).flatMap(book => book.chapters.filter(chapter => !chapter.archived));
        const bookSummary = notice('책 ' + books.length + '권 · 활성 장 ' + activeChapters.length + '개 · 보관한 책 ' + books.filter(book => book.archived).length +
          '권 · 보관한 장 ' + chapters.filter(chapter => chapter.archived).length + '개 · 개정본 ' + books.reduce((sum, book) => sum + (book.editions || []).length, 0) + '개');
        bookSummary.id = 'wbRestoreBookSummary'; previewHost.append(bookSummary);
        previewHost.append(notice('활성 장은 보관한 책의 장을 제외합니다. 보관한 장은 장별 보관 설정 기준이며, 개정본 안의 장은 중복 집계하지 않습니다.'));
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
      if (incoming && ['activities', 'page', 'reflection'].includes(mode)) { renderIncoming(); updateStatus(current); return; }
      if (mode === 'activities') renderActivities();
      if (mode === 'page') renderPage();
      if (mode === 'discover' || mode === 'related') renderDiscover();
      if (mode === 'reflection') renderReflection();
      if (mode === 'books') renderBooks();
      if (mode === 'workbench-backup') renderBackup();
      updateStatus(current);
    }
    async function render(nextMode, options = {}) {
      if (!alive()) return;
      const bundle = getBundle(); if (!bundle) return;
      cleanupView();
      if (current && current.workspaceId !== bundle.workspaceId) current.chapterImport = null;
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
      if (mode === 'reflection' && options.planOpen) current.bookPlanOpen = true;
      incoming = null;
      if (options.selection && ['activities', 'page', 'reflection'].includes(mode)) {
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
      if (mode === 'books') surface.append(heading, errorNode, bodyNode, storageLine);
      else surface.append(heading, storageLine, errorNode, bodyNode);
      host.replaceChildren(surface);
      if (mode === 'public-pages') { surface.setAttribute('aria-busy', 'false'); redraw(); return; }
      try {
        if (!session.state || session.edit === session.stored && session.remoteRevision > session.baseRevision) await load(session);
        if (!showing(token, session)) return;
        surface.setAttribute('aria-busy', 'false');
        if (mode === 'books' && options.bookList === true) session.bookView = null;
        if (mode === 'books' && options.chapterImport !== undefined && options.bookList !== true) {
          const target = options.chapterImport;
          const book = target?.workspaceId === bundle.workspaceId && (session.state.books || []).find(item => item.id === target.bookId && !item.archived);
          const chapter = book && book.chapters.find(item => item.id === target.chapterId && !item.archived);
          const validIds = Array.isArray(target?.versionIds) && target.versionIds.length <= limits.chapterVersions &&
            target.versionIds.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id));
          if (book && chapter && validIds) {
            const previous = session.bookView;
            session.bookView = previous?.bookId === book.id && previous.chapterId === chapter.id ? previous :
              { bookId: book.id, chapterId: chapter.id, shown: 40, renderId: 0 };
            session.bookView.reading = false; session.bookView.edition = false;
            if (target.versionIds.length) {
              session.chapterImport = { workspaceId: bundle.workspaceId, bookId: book.id, chapterId: chapter.id,
                versionIds: [...new Set(target.versionIds)], selected: new Set(), accepted: false };
              session.bookView.evidenceOpen = chapter.id;
            } else {
              session.chapterImport = null; session.bookView.restoreEditor = true;
            }
          } else {
            session.bookView = null; session.chapterImport = null;
            announce('가져올 자료를 연결할 책이나 장을 확인하지 못했습니다. 원문은 그대로 보관했습니다. 현재 작업공간의 책 목록에서 다시 골라 주세요.');
          }
        }
        if (mode === 'books' && options.book !== undefined && options.chapterImport === undefined && options.bookList !== true) {
          const target = options.book;
          const book = target?.workspaceId === bundle.workspaceId && (session.state.books || []).find(item => item.id === target.bookId && !item.archived);
          const chapter = book && (target.chapterId === undefined ? book.chapters.find(item => !item.archived) : book.chapters.find(item => item.id === target.chapterId && !item.archived));
          if (book && (target.chapterId === undefined || chapter)) {
            session.bookView = { bookId: book.id, chapterId: chapter?.id || null, shown: 40, renderId: 0 };
          } else {
            session.bookView = null;
            announce('선택한 책이나 장을 찾을 수 없습니다. 현재 작업공간의 책 목록에서 다시 골라 주세요.');
          }
        }
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
