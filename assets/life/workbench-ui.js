/* Private, local composition UI. Reading and editing never write to a source service. */
(function (global) {
  'use strict';

  const life = global.HaedoLife = global.HaedoLife || {};
  const ORIGINS = { apple_notes: 'Apple 메모', obsidian: 'Obsidian', naver_blog: '네이버 블로그', instagram: 'Instagram', other: '기타' };
  const MODES = { activities: '묶음', page: '내 페이지', discover: '다시 찾기', reflection: '회고', 'workbench-backup': '자료·구성 백업' };
  const copy = value => JSON.parse(JSON.stringify(value));
  function el(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function fault(code, message) { return Object.assign(new Error(message), { code }); }

  function create({ storage, core, host, getBundle, openSource, announce = () => {}, onRestored,
    onSelectionUsed = () => {}, onSelectionCancel = () => {},
    beforeRestore = async () => {}, isDisposed = () => false }) {
    const model = life.Workbench;
    const limits = model.LIMITS;
    const sessions = new Map();
    const urls = new Set();
    let disposed = false, generation = 0, visible = false, current = null, mode = null;
    let surface = null, statusNode = null, errorNode = null, bodyNode = null, saveControl = null;
    let preview = false, discoverQuery = '', restoreCandidate = null, restoreName = '', restoreSequence = 0, installing = false;
    let incoming = null;
    let viewCleanups = [];

    const alive = () => !disposed && !isDisposed();
    const workspaceIs = session => alive() && getBundle()?.workspaceId === session.workspaceId;
    const showing = (token, session) => visible && token === generation && workspaceIs(session) && current === session;
    function cleanupView() { viewCleanups.splice(0).forEach(cleanup => cleanup()); }
    function errorText(error) {
      if (error?.code === 'workbench_conflict') return '다른 탭에서 구성이 바뀌었습니다. 현재 초안을 유지했습니다. 저장본과 비교해 주세요.';
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
        session.edit !== session.stored ? '저장 전 변경 있음' : session.remoteRevision > session.baseRevision ? '다른 탭의 새 구성이 있습니다.' : '이 브라우저에 저장됨';
      statusNode.dataset.state = session.error ? 'error' : session.edit !== session.stored ? 'dirty' : 'saved';
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
        else actions.append(action('다시 저장', () => flush()));
        errorNode.append(actions);
      }
      updateStatus(session);
    }
    function action(label, task, className = '') {
      const button = el('button', label, 'life-button' + (className ? ' ' + className : ''));
      button.type = 'button';
      const token = generation, session = current;
      button.addEventListener('click', async () => {
        if (!showing(token, session) || !button.isConnected) return;
        if (installing) { report(fault('restore_in_progress', '새 사본을 저장하는 중입니다. 완료 후 다시 시도해 주세요.'), session); return; }
        button.disabled = true;
        try { await task(); } catch (error) { report(error, session); }
        finally { if (button.isConnected) button.disabled = false; }
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
      return (ORIGINS[info.source.origin] || '기타') + ' · ' + relation + ' · ' + coverage + (info.total > 1 ? ' · ' + info.number + '/' + info.total + ' 버전' : '');
    }
    function mark(session, autosave = true) {
      session.edit += 1;
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
    async function openVersion(id) {
      const session = current, token = generation, info = sourceInfo(id);
      if (!info) throw fault('source_missing', '연결된 원문이 없습니다. 새 버전으로 대신 열지 않았습니다.');
      await flush();
      if (showing(token, session)) await openSource(info.source.id, info.version.id);
    }
    function sourceRow(id, { body = false, remove, previewOnly = false, hideTitle = false } = {}) {
      const row = el('div', null, 'wb-source'); row.dataset.versionId = id;
      const info = sourceInfo(id);
      const head = el('div', null, 'wb-row');
      const text = el('div', null, 'wb-grow');
      if (!hideTitle || !info) text.append(el('p', info ? info.source.title : '연결된 원문 없음', 'wb-source-title'));
      text.append(el('p', info ? sourceMeta(info) : '이 버전은 현재 공간에 없습니다. 다른 버전으로 바꾸지 않았습니다.', 'life-meta'));
      head.append(text);
      if (info && !previewOnly) head.append(icon('이 원문 버전 열기', 'book', () => openVersion(id)));
      if (remove) head.append(icon('연결 해제', 'close', remove));
      row.append(head);
      if (body && info?.version.contentText != null) {
        const content = el('p', info.version.contentText, 'wb-source-body');
        row.append(content);
      }
      if (previewOnly && info?.source.url) {
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
    function renderPage() {
      const session = current, page = session.state.page;
      const switchButton = action(preview ? '편집으로 돌아가기' : '방문자 미리보기', async () => {
        const token = generation;
        await flush();
        if (!showing(token, session)) return;
        preview = !preview; redraw(); surface.querySelector('#wbPagePreview')?.focus();
      }, 'life-primary');
      switchButton.id = 'wbPagePreview'; switchButton.setAttribute('aria-pressed', String(preview));
      bodyNode.append(switchButton, notice('비공개 미리보기'));
      if (preview) { renderVisitor(page); return; }
      const pageSettings = details('제목·소개·표시 설정', { open: !page.entries.length });
      pageSettings.append(field('페이지 제목', page.title, { id: 'wbPageTitle', change: value => { page.title = value; } }).wrapper);
      pageSettings.append(field('소개', page.intro, { id: 'wbPageIntro', multiline: true, max: limits.text, change: value => { page.intro = value; } }).wrapper);
      pageSettings.append(toggle('소개 표시', page.showIntro, value => { page.showIntro = value; mark(session); }, { id: 'wbShowIntro' }));
      pageSettings.append(toggle('고정하지 않은 항목 표시', page.showRecent, value => { page.showRecent = value; mark(session); }, { id: 'wbShowRecent' }));
      bodyNode.append(pageSettings);
      const add = details('자료·묶음 추가');
      let selection = [];
      add.append(picker('원문에서 고르기', () => selection, (id, checked) => { selection = checked ? selection.concat(id) : selection.filter(value => value !== id); }, { max: limits.parts }));
      add.append(action('선택한 원문 추가', () => addEntry(sourceName(selection[0]), selection)));
      session.state.groups.forEach(group => add.append(action(group.title + ' 추가', () => addEntry(group.title, group.versionIds), 'wb-group-add')));
      add.append(notice('묶음을 추가한 뒤 구성은 별도로 편집됩니다. 묶음 연결을 바꿔도 이 항목이 자동 변경되지 않습니다.'));
      bodyNode.append(add);
      if (!page.entries.length) bodyNode.append(empty('보여줄 원문이나 묶음을 골라 내 페이지를 구성해 보세요.'));
      page.entries.forEach((entry, index) => {
        const article = el('article', null, 'wb-feed'); article.dataset.entryId = entry.id;
        const row = el('div', null, 'wb-row');
        row.append(el('h3', entry.title, 'wb-grow'));
        row.append(icon(entry.enabled ? '이 항목 숨기기' : '이 항목 표시', 'check', () => { entry.enabled = !entry.enabled; mark(session); redraw(); }, entry.enabled));
        row.append(icon(entry.pinned ? '항목 고정 해제' : '항목 고정', 'bookmark', () => { entry.pinned = !entry.pinned; mark(session); redraw(); }, entry.pinned));
        article.append(row);
        if (!entry.enabled) article.append(notice('미리보기에서 숨김'));
        entry.parts.forEach(part => {
          const partRow = el('div', null, 'wb-part'); partRow.dataset.partVersionId = part.versionId;
          partRow.append(toggle(sourceName(part.versionId) + ' 표시', part.enabled, value => { part.enabled = value; mark(session); }));
          partRow.append(sourceRow(part.versionId, { body: entry.showBody && part.enabled }));
          article.append(partRow);
        });
        const settings = details('항목 편집');
        settings.append(field('항목 제목', entry.title, { change: value => { entry.title = value; row.querySelector('h3').textContent = value || '제목 입력 중'; } }).wrapper);
        settings.append(field('내 코멘트', entry.note, { multiline: true, max: limits.text, change: value => { entry.note = value; } }).wrapper);
        settings.append(toggle('원문 본문 표시', entry.showBody, value => { entry.showBody = value; mark(session); redraw(); }));
        settings.append(toggle('내 코멘트 표시', entry.showNote, value => { entry.showNote = value; mark(session); }));
        settings.append(picker('이 항목의 원문 선택', () => entry.parts.map(part => part.versionId), (id, checked) => {
          entry.parts = checked ? entry.parts.concat({ versionId: id, enabled: true }) : entry.parts.filter(part => part.versionId !== id);
          mark(session);
        }, { max: limits.parts }));
        const actions = el('div', null, 'life-actions');
        const up = action('위로', () => { [page.entries[index - 1], page.entries[index]] = [entry, page.entries[index - 1]]; mark(session); redraw(); });
        up.disabled = index === 0;
        const down = action('아래로', () => { [page.entries[index], page.entries[index + 1]] = [page.entries[index + 1], entry]; mark(session); redraw(); });
        down.disabled = index === page.entries.length - 1;
        actions.append(up, down, action('페이지에서 제거', () => { page.entries = page.entries.filter(item => item.id !== entry.id); mark(session); redraw(); }));
        settings.append(actions, notice('미리보기 구성만 바뀝니다. 보관한 원문과 묶음은 유지합니다.'));
        article.append(settings); bodyNode.append(article);
      });
    }
    function renderVisitor(page) {
      const visitor = el('section', null, 'wb-visitor'); visitor.id = 'wbVisitor'; visitor.setAttribute('aria-label', '비공개 방문자 미리보기');
      visitor.append(el('h3', page.title, 'wb-visitor-title'));
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
    function renderDiscover() {
      const search = field('저장한 자료에서 찾을 말', discoverQuery, { id: 'wbDiscoverQuery' });
      search.input.type = 'search';
      const list = el('div'); list.id = 'wbDiscoverResults';
      const count = el('p', '', 'life-meta'); count.setAttribute('role', 'status');
      let composing = false, shown = 30;
      const more = action('검색 결과 더 보기', () => { shown += 30; fill(); });
      const fill = () => {
        discoverQuery = search.input.value;
        const query = discoverQuery.trim(); list.replaceChildren();
        if (!query) { count.textContent = ''; more.hidden = true; list.append(empty('찾고 싶은 단어를 입력하면 보관한 제목과 원문에서 찾습니다.')); return; }
        const hits = core.searchSources(getBundle(), query);
        count.textContent = '보관한 자료 ' + hits.length + '건';
        hits.slice(0, shown).forEach(hit => {
          const article = el('article', null, 'wb-feed'); article.dataset.versionId = hit.sourceVersionId;
          article.append(sourceRow(hit.sourceVersionId));
          const info = sourceInfo(hit.sourceVersionId);
          if (info?.version.contentText != null) {
            const body = info.version.contentText;
            const start = hit.locator ? Math.max(0, hit.locator.start - 70) : 0;
            const end = hit.locator ? Math.min(body.length, hit.locator.end + 150) : Math.min(body.length, 220);
            article.append(el('p', (start ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : ''), 'wb-result-text'));
          }
          article.append(action('내 페이지에 추가', () => addEntry(info?.source.title, [hit.sourceVersionId])));
          list.append(article);
        });
        if (!hits.length) list.append(empty('일치하는 자료가 없습니다. 다른 표현으로 찾아보세요.'));
        more.hidden = hits.length <= shown;
      };
      search.input.addEventListener('compositionstart', () => { composing = true; });
      search.input.addEventListener('compositionend', () => { composing = false; shown = 30; fill(); });
      search.input.addEventListener('input', () => { if (!composing) { shown = 30; fill(); } });
      bodyNode.append(search.wrapper, count, list, more); fill();
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
      if (!visible || !current?.state || !workspaceIs(current)) return;
      cleanupView();
      bodyNode.replaceChildren();
      if (saveControl) saveControl.hidden = !!incoming;
      if (incoming && ['activities', 'page'].includes(mode)) { renderIncoming(); updateStatus(current); return; }
      if (mode === 'activities') renderActivities();
      if (mode === 'page') renderPage();
      if (mode === 'discover') renderDiscover();
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
      saveControl = icon('지금 저장', 'check', () => flush()); saveControl.hidden = !!incoming;
      heading.append(title, saveControl);
      statusNode = el('p', '이 브라우저의 구성을 불러오는 중…', 'life-meta wb-save-status'); statusNode.id = 'wbStatus';
      statusNode.setAttribute('role', 'status'); statusNode.setAttribute('aria-live', 'polite');
      const scope = details('저장 범위');
      scope.classList.add('wb-scope');
      scope.append(notice('묶음·페이지·회고 구성은 비공개로 이 브라우저에만 저장되며 기기 간 동기화 대상이 아닙니다. 다른 기기로 옮기려면 자료·구성 통합 JSON 백업을 사용해 주세요. 내 페이지는 방문자용 주소나 공개 게시 기능이 없는 비공개 미리보기입니다.'));
      errorNode = el('div', null, 'life-error wb-error'); errorNode.id = 'wbError'; errorNode.setAttribute('role', 'alert'); errorNode.hidden = true;
      bodyNode = el('div', null, 'wb-content'); bodyNode.append(notice('불러오는 중…'));
      const storageLine = el('div', null, 'wb-storage-line'); storageLine.append(statusNode, scope);
      surface.append(heading, storageLine, errorNode, bodyNode); host.replaceChildren(surface);
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
    function leave() { generation += 1; visible = false; cleanupView(); incoming = null; restoreSequence += 1; restoreCandidate = null; restoreName = ''; }
    function dispose() {
      disposed = true; leave();
      sessions.forEach(session => { clearTimeout(session.timer); session.unsubscribe?.(); });
      urls.forEach(url => URL.revokeObjectURL(url)); urls.clear();
    }
    return Object.freeze({ render, flush, dirty, leave, dispose });
  }
  life.WorkbenchUI = Object.freeze({ create });
})(globalThis);
