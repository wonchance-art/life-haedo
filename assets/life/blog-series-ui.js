/* Private series editor. Entries retain the saved post edition captured by storage. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  function create({ storage, workspaceId, isCurrent = () => true, onRead, onDirty = () => {}, onExport, onInspectImport, onImport, onPublish }) {
    const M = life.BlogSeries, fresh = () => life.Core.id();
    let state = null, selected = null, host = null, surface = null, status = null, error = null;
    let editor = null, entries = null, candidates = null, selector = null, query = '', posts = [], catalogReady = false;
    let tick = 0, stored = 0, saving = null, failure = null, timer = null, epoch = 0, disposed = false, acting = false, navigating = false;
    let catalogSequence = 0, shown = 40, importSequence = 0, importCandidate = null, importReceipt = null;
    const composing = new Set(), pendingFields = new Set();
    const clone = value => structuredClone(value);
    const valid = token => !disposed && isCurrent() && (token == null || token === epoch);
    const mounted = token => valid(token) && !!host?.isConnected;
    const current = () => state?.series.find(value => value.id === selected);
    const conflict = () => !!failure && /conflict/.test(failure.code || '');
    const fault = (code, message) => Object.assign(new Error(message), { code });
    function dirty() { return !!saving || acting || composing.size > 0 || pendingFields.size > 0 || tick !== stored; }
    function message() {
      if (!mounted() || !status) return;
      status.textContent = failure ? '저장하지 못함 · 입력 유지' : pendingFields.size ? '입력을 확인해 주세요 · 입력 유지' : composing.size ? '입력 중' : saving ? '이 브라우저에 저장 중…' : tick !== stored ? '저장 전 변경 있음' : '이 브라우저에 비공개로 저장됨';
      status.dataset.state = failure ? 'error' : dirty() ? 'dirty' : 'saved';
      const recovery = surface.querySelector('.bs-recovery');
      if (recovery) { recovery.hidden = !failure; recovery.querySelector('#bsRecover').hidden = !conflict(); }
      onDirty();
    }
    function report(cause) {
      failure = cause;
      if (mounted() && error) {
        error.textContent = (importReceipt ? '불러온 새 모음은 이미 보관했습니다. ' : '') + (cause.message || '저장하지 못했습니다. 입력을 유지했으니 다시 시도해 주세요.'); error.hidden = false;
        showImportReceipt();
      }
      message();
    }
    function clear() { failure = null; if (error) { error.hidden = true; error.textContent = ''; } message(); }
    function guard() {
      if (!valid()) throw fault('series_scope_changed', '계정이나 작업공간이 바뀌었습니다. 현재 공간에서 다시 열어 주세요.');
      if (composing.size) throw fault('series_input_in_progress', '한글 입력을 마친 뒤 다시 시도해 주세요.');
      if (pendingFields.size) throw fault('series_input_pending', '입력은 남아 있습니다. 문자와 길이를 확인한 뒤 다시 시도해 주세요.');
    }
    function clearImport() { importSequence++; importCandidate = null; surface?.querySelector('.bs-import-review')?.remove(); }
    function mark() {
      clearImport(); tick++; clearTimeout(timer); message();
      if (!conflict()) timer = setTimeout(() => { if (mounted() && !composing.size && !pendingFields.size && !acting) flushInternal().catch(report); }, 450);
    }
    async function flushInternal() {
      guard(); clearTimeout(timer); timer = null;
      if (saving) { await saving; return flushInternal(); }
      if (!state || tick === stored) return;
      if (conflict()) throw failure;
      const version = tick, payload = clone(state), token = epoch;
      const task = Promise.resolve().then(async () => {
        try {
          const saved = await storage.saveBlogSeries(workspaceId, payload, payload.revision);
          if (!valid(token)) return;
          state.revision = saved.revision; stored = version; clear();
        } catch (cause) { if (valid(token)) report(cause); throw cause; }
        finally { if (saving === task) saving = null; message(); }
      });
      saving = task; message(); await task;
      if (valid(token) && tick !== stored) return flushInternal();
    }
    async function flush() {
      // The editor's own read transition has already flushed. Other surfaces must
      // not leave while a file install, recovery or candidate read is still owned.
      if (navigating) return;
      if (acting) throw fault('blog_series_busy', '모음 처리 결과를 확인한 뒤 이동해 주세요.');
      return flushInternal();
    }
    function button(label, run, { id, name, primary = false } = {}) {
      const b = el('button', label, 'life-button' + (primary ? ' life-primary' : '')); b.type = 'button';
      if (id) b.id = id; if (name) b.setAttribute('aria-label', name);
      b.addEventListener('click', async () => {
        if (!mounted() || acting || b.disabled) return;
        const token = epoch; acting = true; b.disabled = true;
        try { await run(); } catch (cause) { if (mounted(token)) report(cause); }
        finally { acting = false; if (b.isConnected) b.disabled = false; message(); if (!failure && tick !== stored && !saving && mounted(token)) flushInternal().catch(report); }
      }); return b;
    }
    function field(label, value, key, { id, max, multiline = false } = {}) {
      const wrapper = el('label', null, 'life-field'), input = el(multiline ? 'textarea' : 'input');
      wrapper.append(el('span', label), input); input.value = value; input.id = id; input.maxLength = max;
      input.setAttribute('aria-label', label); if (multiline) input.rows = 3; else input.type = 'text';
      const owner = current(); let accepted = value;
      function apply() {
        if (!mounted() || current() !== owner || composing.has(input)) return;
        const previous = owner[key]; owner[key] = input.value;
        try { M.validate(state); accepted = input.value; pendingFields.delete(input); owner.updatedAt = new Date().toISOString(); mark(); updateSelector(); }
        catch (cause) { owner[key] = previous; pendingFields.add(input); report(cause); }
        if (input.value === accepted && pendingFields.size === 0 && failure?.code === 'invalid_blog_series') clear();
      }
      input.addEventListener('compositionstart', () => { clearImport(); composing.add(input); clearTimeout(timer); message(); });
      input.addEventListener('compositionend', () => { composing.delete(input); apply(); message(); });
      input.addEventListener('input', apply); return wrapper;
    }
    function title(value) { return value.title || value.body?.trim().split('\n')[0]?.slice(0, 100) || '제목 없는 글'; }
    function updateSelector() {
      if (!selector) return;
      selector.replaceChildren();
      for (const series of state.series) { const option = el('option', series.title || '제목 없는 모음'); option.value = series.id; selector.append(option); }
      selector.value = selected || ''; selector.hidden = !state.series.length;
    }
    function renderEntries(focusId, action) {
      if (!entries || !current()) return;
      entries.replaceChildren();
      if (!current().items.length) entries.append(el('li', '글을 담으면 이 순서대로 목차가 됩니다.', 'life-help'));
      current().items.forEach((item, index) => {
        const row = el('li', null, 'bs-entry'); row.dataset.entryId = item.id;
        row.append(el('span', item.title || '제목 없는 글', 'bs-entry-title'), el('span', `선택한 ${item.postRevision}판`, 'life-meta'));
        const actions = el('div', null, 'life-actions');
        for (const [label, direction, kind] of [['위로', -1, 'up'], ['아래로', 1, 'down']]) {
          const move = button(label, () => {
            guard(); if (conflict()) throw failure;
            const values = current().items, from = values.findIndex(value => value.id === item.id), to = from + direction;
            if (from < 0 || to < 0 || to >= values.length) return;
            [values[from], values[to]] = [values[to], values[from]]; current().updatedAt = new Date().toISOString(); mark(); renderEntries(item.id, kind);
          }, { name: `${item.title || '제목 없는 글'} ${label}` });
          move.dataset.action = kind; move.disabled = direction < 0 ? index === 0 : index === current().items.length - 1; actions.append(move);
        }
        const remove = button('빼기', () => {
          guard(); if (conflict()) throw failure;
          const at = current().items.findIndex(value => value.id === item.id); current().items.splice(at, 1);
          current().updatedAt = new Date().toISOString(); mark(); renderEntries(); renderCandidates();
          entries.querySelector('button')?.focus({ preventScroll: true });
        }, { name: `${item.title || '제목 없는 글'} 모음에서 빼기` }); remove.dataset.action = 'remove'; actions.append(remove); row.append(actions); entries.append(row);
      });
      if (focusId) {
        const row = [...entries.children].find(n => n.dataset.entryId === focusId);
        const wanted = row?.querySelector(`[data-action="${action}"]`);
        (wanted && !wanted.disabled ? wanted : row?.querySelector('[data-action="remove"]'))?.focus({ preventScroll: true });
      }
    }
    function renderCandidates() {
      if (!candidates || !current()) return;
      candidates.replaceChildren();
      if (!catalogReady) { candidates.append(el('p', '저장한 글을 불러와 주세요.', 'life-help')); return; }
      const term = query.trim().toLocaleLowerCase(), chosen = new Set(current().items.map(item => item.postId));
      const matching = posts.filter(post => !term || [post.title, post.body].filter(Boolean).join('\n').toLocaleLowerCase().includes(term));
      if (!matching.length) candidates.append(el('p', '담을 수 있는 저장 글이 없습니다. 초안과 보관함의 글은 제외합니다.', 'life-help'));
      for (const summary of matching.slice(0, shown)) {
        const row = el('div', null, 'bs-candidate'); row.dataset.postId = summary.id;
        row.append(el('span', title(summary), 'bs-candidate-title'));
        const excerpt = summary.body?.trim().slice(0, 180); if (excerpt) row.append(el('p', excerpt, 'life-meta'));
        const add = button(chosen.has(summary.id) ? '담은 글' : '모음에 담기', async () => {
          guard(); if (conflict()) throw failure;
          if (current().items.some(item => item.postId === summary.id)) return;
          if (current().items.length >= (M.LIMITS?.items || 20)) throw new Error('모음에는 글을 20편까지 담을 수 있습니다.');
          const owner = current(), token = epoch, doc = await storage.readPhotoPost(workspaceId, summary.id);
          if (!mounted(token) || current() !== owner) return; guard();
          if (doc.revision !== summary.revision) throw new Error('선택한 글이 바뀌었습니다. 저장 글 목록을 다시 불러와 확인해 주세요.');
          const item = M.item(doc, fresh); owner.items.push(item);
          try { M.validate(state); } catch (cause) { owner.items.pop(); throw cause; }
          owner.updatedAt = new Date().toISOString(); mark(); renderEntries(); renderCandidates();
        }, { name: `${title(summary)} 모음에 담기` }); add.disabled = chosen.has(summary.id); row.append(add); candidates.append(row);
      }
      if (matching.length > shown) candidates.append(button('글 더 보기', () => { guard(); shown += 40; renderCandidates(); }));
    }
    async function loadPosts() {
      guard(); const token = epoch, request = ++catalogSequence;
      const values = await storage.listPhotoPosts(workspaceId);
      if (!mounted(token) || request !== catalogSequence) return;
      posts = values.filter(value => value.status === 'saved' && !value.archived); catalogReady = true; renderCandidates();
    }
    async function navigate(callback) {
      guard(); await flushInternal(); guard(); const id = current()?.id; if (!id || !mounted()) return;
      clearImport();
      navigating = true; try { await callback(id); } finally { navigating = false; }
    }
    function showImportReceipt() {
      if (!mounted() || !importReceipt) return;
      surface.querySelector('.bs-import-result')?.remove();
      const result = el('section', null, 'bs-import-result'); result.setAttribute('role', 'status');
      result.append(el('p', '새 모음은 보관했습니다. 목록 조회만 다시 시도하며 파일을 재설치하지 않습니다.', 'life-help'), button('불러온 모음 다시 확인', async () => {
        guard(); await flushInternal(); guard(); const receipt = importReceipt, token = epoch, version = tick;
        if (!receipt) return;
        const latest = await storage.readBlogSeries(workspaceId);
        if (!mounted(token) || importReceipt !== receipt) return; guard();
        if (version !== tick) throw fault('blog_series_conflict', '목록을 읽는 동안 입력이 바뀌었습니다. 현재 입력을 유지했습니다.');
        M.validate(latest);
        if (!latest.series.some(series => series.id === receipt.seriesId)) throw new Error('보관한 모음을 찾지 못했습니다. 현재 입력과 기존 모음은 유지했습니다.');
        state = clone(latest); selected = receipt.seriesId; stored = tick; importReceipt = null; clear(); render();
      }, { id: 'bsImportReopen' })); surface.append(result);
    }
    function showImport(candidate) {
      const panel = el('section', null, 'bs-import-review'); panel.id = 'bsImportReview'; panel.dataset.state = 'ready'; panel.setAttribute('aria-label', '모음 파일 확인');
      panel.append(el('h3', '모음 파일 확인'), el('p', candidate.file.name, 'life-meta'), el('p', candidate.summary.title || '제목 없는 모음'),
        el('p', `글 ${candidate.summary.posts}편 · 사진 ${candidate.summary.photos}장`, 'life-meta'),
        el('p', '이 파일의 글과 원본 사진을 현재 계정의 새 비공개 모음으로 보관합니다. 기존 모음은 유지하며 일반 글 목록·서버 연결·공개 상태는 추가하지 않습니다. 구조화 인용 근거와 원문 전체 본문은 이 파일에 포함되지 않습니다.', 'life-help'));
      panel.append(button('새 모음으로 불러오기', async () => {
        guard(); await flushInternal(); guard();
        if (importCandidate !== candidate || !mounted(candidate.epoch)) throw new Error('파일 확인 내용이 바뀌었습니다. 파일을 다시 골라 확인해 주세요.');
        const version = tick, result = await onImport(candidate.file);
        if (!mounted(candidate.epoch)) return;
        if (!result || typeof result.seriesId !== 'string') throw new Error('불러온 모음의 보관 결과를 확인하지 못했습니다.');
        importReceipt = { seriesId: result.seriesId };
        clearImport();
        if (version !== tick || composing.size || pendingFields.size) throw fault('blog_series_conflict', '모음 사본은 보관했습니다. 그동안 입력한 변경은 남아 있으니 입력을 마친 뒤 새 모음으로 보관해 주세요.');
        const next = await storage.readBlogSeries(workspaceId);
        if (!mounted(candidate.epoch)) return;
        if (version !== tick || composing.size || pendingFields.size) throw fault('blog_series_conflict', '모음 사본은 보관했습니다. 현재 입력을 유지했으니 입력을 마친 뒤 새 모음으로 보관해 주세요.');
        M.validate(next); state = clone(next); selected = result.seriesId; stored = tick; importReceipt = null; clear(); render();
        status.textContent = '현재 계정의 새 비공개 모음으로 불러왔습니다. 기존 모음은 유지했습니다.';
      }, { id: 'bsImportConfirm', primary: true }), button('파일 취소', () => { clearImport(); surface.querySelector('#bsImport')?.focus(); }, { id: 'bsImportCancel' }));
      surface.querySelector('.bs-toolbar').after(panel);
    }
    async function recover() {
      guard(); if (saving) await saving;
      const owner = current(); if (!owner) return;
      const token = epoch, version = tick, local = clone(owner), latest = await storage.readBlogSeries(workspaceId);
      if (!mounted(token)) return; guard();
      if (version !== tick || current() !== owner) throw new Error('입력이 바뀌었습니다. 현재 변경을 확인하고 다시 보관해 주세요.');
      const copy = { ...local, id: fresh(), items: local.items.map(item => ({ ...item, id: fresh() })), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      latest.series.push(copy); M.validate(latest);
      const saved = await storage.saveBlogSeries(workspaceId, latest, latest.revision);
      if (!mounted(token)) return;
      // Inputs remain editable during I/O; never replace a later local edit.
      if (version !== tick || current() !== owner || composing.size || pendingFields.size) {
        state.revision = saved.revision;
        throw fault('blog_series_conflict', '사본은 보관했습니다. 그동안 입력한 변경은 이 화면에 남아 있습니다. 현재 변경도 새 모음으로 보관해 주세요.');
      }
      state = clone(saved); selected = copy.id; stored = tick; clear(); render();
      status.textContent = '내 변경을 새 모음에 보관했습니다. 다른 탭의 모음도 유지했습니다.';
    }
    function renderEditor() {
      editor.replaceChildren(); entries = null; candidates = null;
      const series = current(); if (!series) { editor.append(el('p', '새 모음에 여행 글을 순서대로 담아 보세요.', 'life-help')); return; }
      editor.append(field('모음 제목', series.title, 'title', { id: 'bsTitle', max: M.LIMITS?.title || 500 }), field('모음 소개', series.intro, 'intro', { id: 'bsIntro', max: M.LIMITS?.intro || 10000, multiline: true }));
      const heading = el('h3', '글 순서'); entries = el('ol', null, 'bs-entries'); entries.id = 'bsEntries'; entries.setAttribute('aria-label', '모음 목차'); editor.append(heading, entries);
      editor.append(el('p', '담을 때의 저장된 글을 보관합니다. 원래 글이 바뀌거나 없어져도 선택한 판을 읽을 수 있습니다. 비공개 모음이며 담은 글을 자동 게시하지 않습니다.', 'life-help'));
      const picker = el('details', null, 'wb-details bs-picker'); picker.append(el('summary', '글 추가'));
      const label = el('label', null, 'life-field'), search = el('input'); search.type = 'search'; search.id = 'bsPostSearch'; search.value = query; search.setAttribute('aria-label', '담을 글 검색'); label.append(el('span', '담을 글 검색'), search);
      search.addEventListener('input', () => { if (!mounted()) return; query = search.value; shown = 40; renderCandidates(); });
      candidates = el('div', null, 'bs-candidates'); candidates.id = 'bsCandidates';
      picker.append(label, button('저장 글 목록 다시 불러오기', loadPosts, { id: 'bsReloadPosts' }), candidates); editor.append(picker);
      picker.addEventListener('toggle', () => { if (picker.open && !catalogReady && mounted()) loadPosts().catch(report); });
      const actions = el('div', null, 'life-actions bs-actions');
      if (typeof onRead === 'function') actions.append(button('모음 읽기', () => navigate(onRead), { id: 'bsRead', primary: true }));
      editor.append(actions); renderEntries(); renderCandidates();
      const files = el('details', null, 'wb-details bs-files'); files.append(el('summary', '파일·공유'));
      if (typeof onExport === 'function') files.append(button('모음 파일 받기', () => navigate(onExport), { id: 'bsExport' }));
      if (typeof onPublish === 'function') files.append(button('공개할 모음 검토', () => navigate(onPublish), { id: 'bsPublish' }));
      if (files.children.length > 1) editor.append(files);
    }
    function render() {
      if (!mounted()) return;
      clearImport();
      composing.clear(); pendingFields.clear(); surface.replaceChildren();
      const toolbar = el('div', null, 'life-actions bs-toolbar'); selector = el('select'); selector.id = 'bsSelect'; selector.setAttribute('aria-label', '모음 선택');
      selector.addEventListener('change', async () => { const next = selector.value; try { if (acting) throw new Error('처리 결과를 확인한 뒤 모음을 바꿔 주세요.'); await flush(); if (!mounted()) return; selected = next; clear(); render(); } catch (cause) { selector.value = selected || ''; report(cause); } });
      toolbar.append(selector, button('새 모음', async () => {
        await flushInternal(); guard(); if (!mounted()) return;
        if (state.series.length >= (M.LIMITS?.series || 20)) throw new Error('모음은 20개까지 보관할 수 있습니다.');
        const series = M.create(fresh); state.series.push(series); selected = series.id; mark(); render(); surface.querySelector('#bsTitle')?.focus();
      }, { id: 'bsNew' }));
      if (typeof onImport === 'function' && typeof onInspectImport === 'function') {
        const file = el('input'); file.type = 'file'; file.accept = '.zip,application/zip'; file.id = 'bsImport'; file.setAttribute('aria-label', '모음 ZIP 파일');
        file.addEventListener('change', async () => {
          const input = file.files[0]; file.value = ''; if (acting || !mounted()) return; clearImport(); if (!input) return;
          acting = true; const token = epoch, request = importSequence;
          try {
            await flushInternal(); guard(); const summary = await onInspectImport(input);
            if (!mounted(token) || request !== importSequence) return;
            if (!summary || typeof summary.title !== 'string' || !Number.isInteger(summary.posts) || summary.posts < 0 || !Number.isInteger(summary.photos) || summary.photos < 0) throw new Error('모음 파일의 확인 정보를 읽지 못했습니다.');
            importCandidate = { file: input, summary, epoch: token }; clear(); showImport(importCandidate);
          } catch (cause) { if (mounted(token) && request === importSequence) report(cause); } finally { acting = false; message(); }
        }); toolbar.append(file);
      }
      status = el('p', '', 'life-meta bs-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      error = el('p', '', 'life-error bs-error'); error.setAttribute('role', 'alert'); error.hidden = true;
      const recovery = el('div', null, 'life-actions bs-recovery'); recovery.append(button('다시 저장', async () => { await flushInternal(); clear(); }, { id: 'bsRetry' }), button('내 변경을 새 모음으로 보관', recover, { id: 'bsRecover' }));
      editor = el('div', null, 'bs-editor'); surface.append(toolbar, status, error, recovery, editor); updateSelector(); renderEditor();
      if (failure) report(failure); else message();
      showImportReceipt();
    }
    async function mount(target, { seriesId = null } = {}) {
      if (disposed) throw new Error('종료한 모음 편집기입니다.');
      if (host && dirty()) await flush();
      host = target; const token = ++epoch; surface = el('section', null, 'bs-workspace'); surface.setAttribute('aria-label', '연재·모음'); host.replaceChildren(surface);
      surface.append(el('p', '모음을 불러오는 중…', 'life-help'));
      try {
        if (!state || !dirty()) { const next = await storage.readBlogSeries(workspaceId); if (!mounted(token)) return; M.validate(next); state = clone(next); stored = tick; }
        if (!mounted(token)) return;
        if (seriesId) selected = seriesId;
        if (!current()) selected = state.series[0]?.id || null;
        render();
      } catch (cause) {
        if (!mounted(token)) return;
        const alert = el('p', cause.message || '모음을 불러오지 못했습니다.', 'life-error'); alert.setAttribute('role', 'alert');
        surface.replaceChildren(alert, button('모음 다시 불러오기', () => mount(target, { seriesId })));
      }
    }
    function detach() { epoch++; catalogSequence++; clearImport(); clearTimeout(timer); timer = null; host = null; surface = null; status = null; error = null; editor = null; candidates = null; entries = null; selector = null; composing.clear(); pendingFields.clear(); }
    function dispose() { detach(); disposed = true; state = null; posts = []; query = ''; }
    return { mount, flush, dirty, detach, dispose };
  }
  life.BlogSeriesUI = Object.freeze({ create });
})(globalThis);
