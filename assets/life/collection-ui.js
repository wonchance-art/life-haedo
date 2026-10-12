/* Account/workspace-scoped collection screen; explicit local saves. */
(function (root) {
  'use strict';
  const C = root.HaedoLife.Collection;
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (cls) n.className = cls; return n; };
  function create({ storage, host, getBundle, isDisposed, onSaved }) {
    let alive = true, active = false, sequence = 0, workspaceId = null, state = null, unsubscribe = null;
    let draft = null, baseline = '', selected = null, busy = false, conflict = null, restore = null, status = '', error = '', screen;
    let query = '', category = 'all', type = 'all', tag = '', archived = false, mode = 'cover', limit = 40, position = 0;
    const urls = new Set();
    let backupOpen = false;
    const current = token => alive && !isDisposed() && active && token === sequence && getBundle()?.workspaceId === workspaceId;
    const dirty = () => busy || !!draft && JSON.stringify(draft) !== baseline;
    function flush() { if (dirty()) throw new Error('컬렉션 입력을 저장하거나 편집 취소한 뒤 이동해 주세요. 입력은 그대로 유지했습니다.'); }
    function button(label, action, glyph) {
      const b = node('button', glyph ? null : label, glyph ? 'life-icon-button' : 'life-button'); b.type = 'button';
      if (glyph) { b.append(root.HaedoLife.Icons.create(glyph)); b.setAttribute('aria-label', label); b.title = label; }
      b.addEventListener('click', async () => { if (busy || !active) return; try { await action(); } catch (cause) { error = cause.message || '처리하지 못했습니다. 입력을 보존했습니다.'; feedback(); } });
      return b;
    }
    function feedback() {
      if (!active || !screen?.isConnected) return;
      const s = screen.querySelector('#clStatus'), e = screen.querySelector('#clError');
      if (s) { s.textContent = status; s.hidden = !status; }
      if (e) { e.textContent = error; e.hidden = !error; }
      screen.querySelectorAll('fieldset').forEach(el => { el.disabled = busy; });
      screen.setAttribute('aria-busy', String(busy));
    }
    function field(label, name, value, options = {}) {
      const wrap = node('label', null, 'life-field'); wrap.append(node('span', label));
      const input = node(options.multiline ? 'textarea' : 'input'); input.id = 'cl' + name; input.value = value;
      if (!options.multiline) input.type = options.type || 'text';
      input.maxLength = options.max || 500; input.required = !!options.required;
      if (options.multiline) input.rows = 5;
      input.addEventListener('input', () => options.change(input.value));
      wrap.append(input); return wrap;
    }
    function select(label, name, values, value, change) {
      const wrap = node('label', null, 'life-field'); wrap.append(node('span', label)); const input = node('select'); input.id = 'cl' + name;
      values.forEach(([id, text]) => { const option = node('option', text); option.value = id; input.append(option); }); input.value = value;
      input.addEventListener('change', () => change(input.value)); wrap.append(input); return wrap;
    }
    function notice() {
      const e = node('p', error, 'life-error'); e.id = 'clError'; e.setAttribute('role', 'alert'); e.hidden = !error;
      const s = node('p', status, 'life-status'); s.id = 'clStatus'; s.setAttribute('role', 'status'); s.hidden = !status;
      screen.append(s, e);
    }
    async function open() {
      active = true; const token = ++sequence, next = getBundle().workspaceId;
      if (workspaceId !== next) {
        workspaceId = next; state = null; draft = null; selected = null; restore = null; conflict = null; query = ''; category = type = 'all'; tag = ''; archived = false; status = error = '';
      }
      unsubscribe?.();
      unsubscribe = storage.subscribe(workspaceId, event => {
        if (!current(token) || event.type !== 'collection_changed' || busy || event.revision <= (state?.revision ?? -1)) return;
        status = '다른 탭에서 변경했습니다. 최신 내용 확인을 눌러 주세요.'; feedback();
      });
      if (draft) { draw(); return; }
      state = null;
      host.replaceChildren(node('p', '컬렉션을 불러오는 중…', 'life-help'));
      host.firstChild.setAttribute('role', 'status');
      try { const loaded = await storage.readCollection(workspaceId); if (!current(token)) return; state = loaded; draw(); }
      catch (cause) { if (!current(token)) return; error = cause.message; draw(); }
    }
    function leave() { backupOpen = false; active = false; sequence++; unsubscribe?.(); unsubscribe = null; }
    function draw() {
      if (!active || !alive) return;
      screen = node('section', null, 'life-collection'); screen.setAttribute('aria-label', '컬렉션'); host.replaceChildren(screen);
      notice();
      if (!state) { screen.append(button('컬렉션 다시 불러오기', () => { error = ''; return open(); })); return; }
      if (draft) { editor(); feedback(); return; }
      if (selected) { detail(); feedback(); return; }
      library(); feedback();
    }
    function cover(item) {
      const box = node('span', null, 'cl-cover cl-' + item.type); box.setAttribute('aria-hidden', 'true');
      if (['person', 'tool', 'place', 'other'].includes(item.type)) box.append(root.HaedoLife.Icons.create({ person: 'user', tool: 'workspace', place: 'map', other: 'bookmark' }[item.type]));
      else { box.append(node('span', item.title.slice(0, 60))); box.append(node('small', '표지 미연결')); }
      return box;
    }
    function library() {
      const actions = node('div', null, 'cl-actions');
      actions.append(node('p', '이 브라우저 · 비공개', 'life-meta'), button('컬렉션 항목 추가', () => begin(), 'plus'), button('최신 내용 확인', reload, 'refresh'));
      screen.append(actions);
      const search = node('div', null, 'cl-search');
      search.append(field('컬렉션 검색', 'Query', query, { max: 500, change: value => { query = value; limit = 40; renderResults(); } }));
      search.querySelector('input').placeholder = '컬렉션 검색';
      const tags = [...new Set(state.items.flatMap(item => item.tags))].sort((a, b) => a.localeCompare(b, 'ko'));
      if (tag && !tags.includes(tag)) tag = '';
      search.append(select('주제', 'Tag', [['', '모든 주제'], ...tags.map(t => [t, t])], tag, value => { tag = value; limit = 40; renderResults(); })); screen.append(search);
      const filters = node('div', null, 'cl-filters'); filters.id = 'clFilters'; screen.append(filters); renderFilters();
      const resultLine = node('div', null, 'cl-result-line'), count = node('p', '', 'life-meta'); count.id = 'clCount'; count.setAttribute('role', 'status');
      const views = node('div', null, 'cl-actions');
      for (const [id, label, icon] of [['cover', '표지 보기', 'workspace'], ['note', '메모 보기', 'book']]) {
        const b = button(label, () => { mode = id; views.querySelectorAll('button').forEach(el => el.setAttribute('aria-pressed', String(el === b))); renderResults(); }, icon);
        b.setAttribute('aria-pressed', String(mode === id)); views.append(b);
      }
      const archive = button(archived ? '전체 목록 보기' : '보관한 항목 보기', () => { archived = !archived; limit = 40; draw(); screen.querySelector('#clArchiveToggle')?.focus(); }, 'bookmark');
      archive.id = 'clArchiveToggle'; archive.setAttribute('aria-pressed', String(archived)); views.append(archive); resultLine.append(count, views); screen.append(resultLine);
      const grid = node('div'); grid.id = 'clGrid'; screen.append(grid); renderResults();
      const files = node('details', null, 'cl-files'); files.append(node('summary', '백업·복구'));
      files.append(node('p', '컬렉션 정보·비공개 메모·보관 상태만 포함합니다. 원문·발췌·내 페이지·연표 백업과 별도이며 자동 동기화되지 않습니다.', 'life-help'));
      files.append(button('컬렉션 백업 받기', backup));
      const label = node('label', null, 'life-field'); label.append(node('span', '컬렉션 백업 파일 선택'));
      const input = node('input'); input.type = 'file'; input.accept = '.json,application/json'; input.id = 'clRestoreFile';
      input.addEventListener('change', () => { const file = input.files[0]; input.value = ''; if (file && !busy) reviewFile(file); }); label.append(input); files.append(label);
      const review = node('div'); review.id = 'clRestoreReview'; files.append(review); screen.append(files); files.open = backupOpen; renderRestore();
    }
    function renderFilters() {
      const host = screen.querySelector('#clFilters'); host.replaceChildren();
      const parents = node('div', null, 'cl-chip-row'); parents.setAttribute('aria-label', '큰 분류');
      for (const group of [{ id: 'all', label: '전체' }, ...C.GROUPS]) {
        const b = button(group.label, () => { category = group.id; type = group.types?.length === 1 ? group.types[0] : 'all'; limit = 40; renderFilters(); renderResults(); const el = screen.querySelector(`[data-category="${group.id}"]`); el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
        b.dataset.category = group.id; b.setAttribute('aria-pressed', String(category === group.id)); parents.append(b);
      }
      host.append(parents); const group = C.GROUPS.find(g => g.id === category);
      if (group?.types.length > 1) {
        const children = node('div', null, 'cl-chip-row cl-children'); children.setAttribute('aria-label', '세부 종류');
        for (const id of ['all', ...group.types]) { const b = button(id === 'all' ? '모든 종류' : C.TYPES[id], () => { type = id; limit = 40; renderFilters(); renderResults(); screen.querySelector(`[data-type="${id}"]`).focus(); }); b.dataset.type = id; b.setAttribute('aria-pressed', String(type === id)); children.append(b); }
        host.append(children);
      }
    }
    function renderResults() {
      const grid = screen.querySelector('#clGrid'); if (!grid) return; grid.replaceChildren(); grid.className = 'cl-grid' + (mode === 'note' ? ' cl-notes' : '');
      const shown = state.items.filter(item => C.matches(item, { query, category, type, tag, archived }));
      screen.querySelector('#clCount').textContent = `${archived ? '보관한 항목 · ' : ''}${shown.length}개`;
      if (!shown.length) {
        const empty = node('div', null, 'cl-empty'); empty.append(node('h2', state.items.length ? '찾는 항목이 없어요' : '좋아하는 것을 모아 보세요'));
        empty.append(node('p', state.items.length ? '검색어나 분류를 바꿔 보세요.' : '음악, 책, 작품, 도구와 인물을 한곳에 보관합니다.', 'life-help'));
        empty.append(button(state.items.length ? '검색·분류 초기화' : '첫 항목 추가', () => { if (!state.items.length) return begin(); query = ''; category = type = 'all'; tag = ''; screen.querySelector('#clQuery').value = ''; screen.querySelector('#clTag').value = ''; renderFilters(); renderResults(); screen.querySelector('#clQuery').focus(); })); grid.append(empty); return;
      }
      for (const item of shown.slice(0, limit)) {
        const b = button(item.title, () => { position = root.scrollY; selected = item.id; status = error = ''; draw(); focusHeading(); }); b.className = 'cl-card'; b.dataset.itemId = item.id; b.replaceChildren();
        const art = node('span', null, 'cl-art'); art.append(cover(item));
        const copy = node('span', null, 'cl-caption'); copy.append(node('strong', item.title), node('span', item.type === 'person' ? item.details.field || C.TYPES[item.type] : item.creator || C.TYPES[item.type], 'life-meta'));
        if (mode === 'note' && item.note) copy.append(node('span', item.note, 'cl-card-note'));
        b.append(art, copy); grid.append(b);
      }
      if (shown.length > limit) { const more = button('40개 더 보기', () => { const first = limit; limit += 40; renderResults(); screen.querySelectorAll('.cl-card')[first]?.focus({ preventScroll: true }); }); more.classList.add('cl-more'); grid.append(more); }
    }
    function focusHeading() { const h = screen.querySelector('h2'); if (h) { h.tabIndex = -1; h.focus(); } }
    function back(id = selected) { draft = null; baseline = ''; selected = null; conflict = null; draw(); root.scrollTo({ top: position, behavior: 'instant' }); if (id) screen.querySelector(`[data-item-id="${id}"]`)?.focus({ preventScroll: true }); }
    function detail() {
      const item = state.items.find(item => item.id === selected);
      if (!item) { selected = null; library(); return; }
      const actions = node('div', null, 'cl-actions'); actions.append(button('컬렉션 목록으로', () => back(), 'back'), button('항목 수정', () => begin(item), 'edit'));
      screen.append(actions, node('h2', item.title), node('p', C.TYPES[item.type], 'life-meta'));
      const dl = node('dl', null, 'cl-metadata');
      if (item.creator) dl.append(node('dt', item.type === 'film' ? '감독' : '만든 사람'), node('dd', item.creator));
      for (const [key, value] of Object.entries(item.details)) if (value) dl.append(node('dt', C.DETAILS[key]), node('dd', value));
      if (item.tags.length) dl.append(node('dt', '주제'), node('dd', item.tags.join(' · '))); screen.append(dl);
      if (item.url) { const a = node('a', '원래 출처 열기', 'life-button'); a.href = item.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; screen.append(a); }
      screen.append(node('h3', '비공개 메모'), node('p', item.note || '남긴 메모가 없습니다.', 'cl-note'));
      const manage = node('details', null, 'cl-files'); manage.append(node('summary', '항목 관리'), node('p', '보관한 항목은 목록에서 숨기며 백업에는 계속 포함됩니다.', 'life-help'));
      manage.append(button(item.archived ? '목록에 다시 표시' : '항목 보관', async () => {
        const next = C.clone(state); const target = next.items.find(i => i.id === item.id); target.archived = !item.archived; target.updatedAt = now(item.createdAt);
        await commit(next, () => { status = target.archived ? '항목을 보관했습니다.' : '목록에 다시 표시했습니다.'; back(); });
      })); screen.append(manage);
    }
    function now(createdAt = '') { const date = new Date().toISOString(); return date < createdAt ? createdAt : date; }
    function begin(item) {
      draft = item ? C.clone(item) : { id: root.HaedoLife.Core.id(), type: 'music', title: '', creator: '', url: '', note: '', tags: [], details: {}, archived: false, createdAt: now(), updatedAt: now() };
      selected = item?.id || null; baseline = item ? JSON.stringify(draft) : ''; conflict = null; error = status = ''; draw(); screen.querySelector('#clTitle').focus();
    }
    function editor() {
      screen.append(node('h2', selected ? '항목 수정' : '컬렉션에 추가'));
      const form = node('form'), fs = node('fieldset'); form.append(fs); form.id = 'clForm';
      const kinds = node('div', null, 'cl-field-pair'), group = C.groupFor(draft.type);
      kinds.append(select('큰 분류', 'Category', C.GROUPS.map(g => [g.id, g.label]), group.id, value => {
        draft.type = C.GROUPS.find(g => g.id === value).types[0]; if (draft.type === 'person') draft.creator = ''; draft.details = {}; draw(); screen.querySelector('#clCategory').focus();
      }));
      const leaf = select('세부 종류', 'Type', group.types.map(id => [id, C.TYPES[id]]), draft.type, value => { draft.type = value; draft.details = {}; draw(); screen.querySelector('#clType').focus(); }); leaf.querySelector('select').disabled = group.types.length === 1; kinds.append(leaf); fs.append(kinds);
      fs.append(field(draft.type === 'person' ? '이름' : '제목', 'Title', draft.title, { required: true, change: v => { draft.title = v; } }));
      if (draft.type !== 'person') fs.append(field(draft.type === 'film' ? '감독' : '만든 사람', 'Creator', draft.creator, { change: v => { draft.creator = v; } }));
      fs.append(field('출처 주소', 'Url', draft.url, { type: 'url', max: C.LIMITS.url, change: v => { draft.url = v; } }));
      fs.append(field('주제 · 쉼표로 구분', 'Tags', draft.tags.join(', '), { max: 740, change: v => { draft.tags = [...new Set(v.split(',').map(s => s.trim()).filter(Boolean))]; } }));
      for (const key of C.TYPE_FIELDS[draft.type]) fs.append(field(C.DETAILS[key], key, draft.details[key] || '', { change: v => { draft.details[key] = v; } }));
      fs.append(field(draft.type === 'person' ? '좋아하는 이유 · 비공개' : '내 메모 · 비공개', 'Note', draft.note, { multiline: true, max: C.LIMITS.note, change: v => { draft.note = v; } }));
      fs.append(node('p', '이 브라우저에만 저장합니다. 표지·자동 조회·기기 간 동기화는 아직 연결하지 않았습니다.', 'life-help'));
      const actions = node('div', null, 'cl-actions'); const save = node('button', '저장', 'life-button life-primary'); save.type = 'submit';
      actions.append(save, button('편집 취소', () => { if (dirty() && !root.confirm('저장하지 않은 입력을 버리고 돌아갈까요?')) return; const id = selected; draft = null; conflict = null; error = ''; if (id) { draw(); focusHeading(); } else back(); })); fs.append(actions);
      let composing = false;
      form.addEventListener('compositionstart', () => { composing = true; });
      form.addEventListener('compositionend', () => { composing = false; });
      form.addEventListener('submit', async event => { event.preventDefault(); if (busy || composing) return; await saveDraft(); });
      screen.append(form);
      if (conflict) {
        const panel = node('section', null, 'cl-conflict'); panel.setAttribute('aria-label', '다른 탭 변경 비교');
        panel.append(node('h3', '다른 탭의 변경과 비교'), node('p', '현재 입력은 위에 유지했습니다. 사본으로 저장하면 다른 탭의 항목도 그대로 남습니다.', 'life-help'));
        const other = conflict.items.find(i => i.id === selected);
        if (other) { const details = node('details'); details.append(node('summary', '최신 항목 전체 정보'), node('pre', JSON.stringify(other, null, 2), 'cl-note')); panel.append(node('p', other.title), node('p', other.note || '메모 없음', 'cl-note'), details); }
        panel.append(button('내 입력을 새 사본으로 저장', () => saveDraft(true)), button('최신 변경 다시 비교', compare)); screen.append(panel);
      }
    }
    async function commit(next, done) {
      const token = sequence; busy = true; error = ''; status = '저장 중…'; feedback();
      try { const saved = await storage.saveCollection(workspaceId, next, next.revision); if (!current(token)) return false; state = saved; status = '이 브라우저에 저장했습니다.'; onSaved?.(); done?.(); return true; }
      catch (cause) { if (current(token)) { error = cause.message; status = ''; } return false; }
      finally { if (current(token)) { busy = false; feedback(); } }
    }
    async function saveDraft(asCopy = false) {
      const token = sequence;
      try {
        const item = C.clone(draft); item.updatedAt = now(item.createdAt); C.validateItem(item);
        let base = state;
        if (asCopy) { busy = true; feedback(); base = await storage.readCollection(workspaceId); if (!current(token)) return; item.id = root.HaedoLife.Core.id(); item.createdAt = item.updatedAt = now(); }
        const next = C.clone(base), index = asCopy ? -1 : next.items.findIndex(i => i.id === item.id);
        if (index < 0) next.items.unshift(item); else next.items[index] = item;
        C.validate(next);
        const ok = await commit(next, () => { draft = null; baseline = ''; conflict = null; selected = item.id; draw(); focusHeading(); });
        if (!ok && current(token)) await compare();
      } catch (cause) { if (current(token)) { error = cause.message; status = ''; } }
      finally { if (current(token)) { busy = false; feedback(); } }
    }
    async function compare() {
      const token = sequence;
      try { const latest = await storage.readCollection(workspaceId); if (!current(token)) return; if (latest.revision !== state.revision) { conflict = latest; draw(); } }
      catch (cause) { if (current(token)) error = cause.message; }
      feedback();
    }
    async function reload() {
      flush(); const token = sequence; busy = true; feedback();
      try { const latest = await storage.readCollection(workspaceId); if (!current(token)) return; state = latest; status = '최신 내용을 확인했습니다.'; error = ''; draw(); }
      finally { if (current(token)) { busy = false; feedback(); } }
    }
    function download(value, filename) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' })); urls.add(url);
      const a = node('a'); a.href = url; a.download = filename; a.hidden = true; document.body.append(a); a.click(); a.remove();
      root.setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 60000);
    }
    async function backup() {
      const token = sequence; busy = true; feedback();
      try { const latest = await storage.readCollection(workspaceId); if (!current(token)) return; download(C.makeBackup(latest), 'haedo-collection-' + new Date().toISOString().slice(0, 10) + '.json'); status = '컬렉션 백업 다운로드를 요청했습니다. 파일 보관 여부를 확인해 주세요.'; }
      finally { if (current(token)) { busy = false; feedback(); } }
    }
    async function reviewFile(file) {
      const token = sequence; busy = true; error = ''; restore = null; feedback(); renderRestore();
      try { if (file.size > C.LIMITS.bytes) throw new Error('컬렉션 백업은 2 MiB까지 읽을 수 있습니다.'); const text = await file.text(); if (!current(token)) return; restore = { backup: C.readBackup(text), name: file.name }; status = ''; renderRestore(); }
      catch (cause) { if (current(token)) error = cause.message; }
      finally { if (current(token)) { busy = false; feedback(); } }
    }
    function renderRestore() {
      const host = screen.querySelector('#clRestoreReview'); if (!host) return; host.replaceChildren(); if (!restore) return;
      const backup = restore.backup;
      host.append(node('p', `${restore.name} · ${backup.items.length}개 (보관한 항목 ${backup.items.filter(i => i.archived).length}개)`), node('p', '기존 항목을 덮어쓰지 않고 새 사본으로 추가합니다. 같은 파일을 다시 복구하면 사본이 더 생깁니다.', 'life-help'));
      const preview = node('ul'); backup.items.slice(0, 5).forEach(item => preview.append(node('li', item.title))); host.append(preview);
      host.append(button('새 항목 사본으로 복구', async () => {
        const next = C.appendBackup(state, backup, () => root.HaedoLife.Core.id());
        await commit(next, () => { restore = null; status = `${backup.items.length}개를 새 사본으로 복구했습니다. 기존 자료는 그대로입니다.`; draw(); });
      }), button('복구 취소', () => { restore = null; renderRestore(); }));
    }
    function showBackup() { backupOpen = true; const files = screen?.isConnected && screen.querySelector('.cl-files'); if (files) { files.open = true; files.querySelector('summary').focus(); } }
    function dispose() { alive = false; leave(); state = draft = restore = conflict = null; urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); }
    return Object.freeze({ open, leave, flush, dirty, showBackup, dispose });
  }
  root.HaedoLife.CollectionUI = Object.freeze({ create });
})(globalThis);
