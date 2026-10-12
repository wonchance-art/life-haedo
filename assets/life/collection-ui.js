/* Account/workspace-scoped collection screen; explicit local saves. */
(function (root) {
  'use strict';
  const C = root.HaedoLife.Collection, Media = root.HaedoLife.CollectionMedia;
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (cls) n.className = cls; return n; };
  function create({ storage, host, getBundle, isDisposed, onSaved }) {
    let alive = true, active = false, sequence = 0, workspaceId = null, state = null, unsubscribe = null;
    let draft = null, baseline = '', selected = null, busy = false, conflict = null, restore = null, status = '', error = '', screen;
    let query = '', category = 'all', type = 'all', tag = '', archived = false, mode = 'cover', limit = 40, position = 0;
    const urls = new Set(), mediaCleanups = new Set(), imageMetadata = new Map();
    let imagesEnabled = false, closePicker = null, compactEditor = false, editorInfoOpen = false;
    function clearMedia() { mediaCleanups.forEach(dispose => dispose()); mediaCleanups.clear(); }
    let backupOpen = false, lookupController = null, candidate = null, lookupMessage = '', lookupPending = false;
    function cancelLookup() { lookupController?.abort(); lookupController = null; lookupPending = false; candidate = null; lookupMessage = ''; }
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
      input.addEventListener('input', () => {
        options.change(input.value);
        const summary = screen?.querySelector('.cl-selected-object');
        if (summary && draft) { summary.querySelector('h3').textContent = draft.title; summary.lastElementChild.textContent = draft.creator; }
        const key = { Title: 'title', Url: 'url' }[name];
        if (key) { const choice = screen?.querySelector('[data-metadata-field="' + key + '"]'); if (choice) choice.checked = false; }
        const kind = screen?.querySelector('[data-metadata-field="type"]');
        if (kind && (draft?.creator || Object.values(draft?.details || {}).some(Boolean))) { kind.checked = false; kind.disabled = true; }
        const apply = screen?.querySelector('#clApplyMetadata');
        if (apply) apply.disabled = ![...screen.querySelectorAll('[data-metadata-field]')].some(el => el.checked && !el.disabled);
      });
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
      closePicker?.(); closePicker = null; clearMedia(); active = true; const token = ++sequence, next = getBundle().workspaceId;
      if (workspaceId !== next) {
        imagesEnabled = false; imageMetadata.clear(); clearMedia(); workspaceId = next; state = null; draft = null; selected = null; restore = null; conflict = null; query = ''; category = type = 'all'; tag = ''; archived = false; status = error = '';
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
    function leave() { closePicker?.(); closePicker = null; clearMedia(); imageMetadata.clear(); imagesEnabled = false; cancelLookup(); backupOpen = false; active = false; sequence++; unsubscribe?.(); unsubscribe = null; }
    function draw() {
      if (compactEditor) editorInfoOpen = !!screen?.querySelector('.cl-edit-information')?.open;
      closePicker?.(); closePicker = null; clearMedia(); cancelLookup();
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
      else { box.append(node('span', item.title.slice(0, 60))); box.append(node('small', Media.describe(item) ? '이미지 꺼짐' : '표지 미연결')); }
      if (imagesEnabled) loadImage(box, item);
      return box;
    }
    async function imageLookup(source, options) {
      if (imageMetadata.has(source)) return imageMetadata.get(source);
      const scope = workspaceId, result = await root.HaedoLife.CollectionMetadata.lookup(source, options);
      if (alive && active && !isDisposed() && workspaceId === scope && !options.signal.aborted) {
        if (imageMetadata.size >= 100) imageMetadata.delete(imageMetadata.keys().next().value);
        imageMetadata.set(source, result);
      }
      return result;
    }
    function loadImage(box, item) {
      const descriptor = Media.describe(item); if (!descriptor) return;
      const small = box.querySelector('small');
      mediaCleanups.add(Media.mount({ host: box, descriptor, lookup: imageLookup, onState: state => {
        box.dataset.imageState = state; box.classList.toggle('cl-image-ready', state === 'ready');
        if (small) small.textContent = state === 'loading' ? '이미지 불러오는 중' : state === 'error' ? '이미지 없음 · 출처 확인' : descriptor.provider;
      } }));
    }
    function imageToggle() {
      const wrap = node('div', null, 'cl-image-controls');
      const toggle = button(imagesEnabled ? '외부 이미지 끄기' : '외부 이미지 보기', () => {
        imagesEnabled = !imagesEnabled; draw(); screen.querySelector('#clImageToggle')?.focus({ preventScroll: true });
      }); toggle.id = 'clImageToggle'; toggle.setAttribute('aria-pressed', String(imagesEnabled));
      wrap.append(toggle, node('p', '켜면 Open Library·YouTube에서 이미지를 불러옵니다. 이 화면을 나가면 꺼집니다.', 'life-help')); return wrap;
    }
    function library() {
      const actions = node('div', null, 'cl-actions');
      actions.append(node('p', '이 브라우저 · 비공개', 'life-meta'), button('컬렉션 항목 추가', pick, 'plus'), button('최신 내용 확인', reload, 'refresh'));
      screen.append(actions, imageToggle());
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
      const grid = screen.querySelector('#clGrid'); if (!grid) return; clearMedia(); grid.replaceChildren(); grid.className = 'cl-grid' + (mode === 'note' ? ' cl-notes' : '');
      const shown = state.items.filter(item => C.matches(item, { query, category, type, tag, archived }));
      screen.querySelector('#clCount').textContent = `${archived ? '보관한 항목 · ' : ''}${shown.length}개`;
      if (!shown.length) {
        const empty = node('div', null, 'cl-empty'); empty.append(node('h2', state.items.length ? '찾는 항목이 없어요' : '좋아하는 것을 모아 보세요'));
        empty.append(node('p', state.items.length ? '검색어나 분류를 바꿔 보세요.' : '음악, 책, 작품, 도구와 인물을 한곳에 보관합니다.', 'life-help'));
        empty.append(button(state.items.length ? '검색·분류 초기화' : '첫 항목 추가', () => { if (!state.items.length) return pick(); query = ''; category = type = 'all'; tag = ''; screen.querySelector('#clQuery').value = ''; screen.querySelector('#clTag').value = ''; renderFilters(); renderResults(); screen.querySelector('#clQuery').focus(); })); grid.append(empty); return;
      }
      for (const item of shown.slice(0, limit)) {
        const b = button(item.title, () => { position = root.scrollY; selected = item.id; status = error = ''; draw(); focusHeading(); }); b.className = 'cl-card'; b.dataset.itemId = item.id; b.replaceChildren();
        const art = node('span', null, 'cl-art'); art.append(cover(item));
        const copy = node('span', null, 'cl-caption'); copy.append(node('strong', item.title), node('span', item.type === 'person' ? item.details.field || C.TYPES[item.type] : item.creator || C.TYPES[item.type], 'life-meta'));
        const provider = Media.describe(item); if (provider) copy.append(node('span', provider.provider + ' · ' + provider.label, 'cl-image-credit'));
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
      const descriptor = Media.describe(item);
      if (descriptor) {
        screen.append(imageToggle()); const figure = node('figure', null, 'cl-detail-image'); figure.append(cover(item));
        const caption = node('figcaption'), source = node('a', descriptor.provider + ' · ' + descriptor.label); source.href = descriptor.source; source.target = '_blank'; source.rel = 'noopener noreferrer'; caption.append(source); figure.append(caption); screen.append(figure);
      }
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
    function pick() {
      const token = sequence;
      closePicker = root.HaedoLife.CollectionPicker.open({ items: C.clone(state.items), isCurrent: () => current(token), onSelect: choice => {
        closePicker = null; begin(choice.item, choice);
      } });
    }
    function begin(item, options = {}) {
      compactEditor = !!options.compact;
      draft = item ? C.clone(item) : { id: root.HaedoLife.Core.id(), type: 'music', title: '', creator: '', url: '', note: '', tags: [], details: {}, archived: false, createdAt: now(), updatedAt: now() };
      if (!item && options.seed) Object.assign(draft, options.seed);
      selected = item?.id || null; baseline = item ? JSON.stringify(draft) : ''; conflict = null; error = status = ''; draw(); screen.querySelector(compactEditor ? '#clNote' : '#clTitle').focus();
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
      fs.append(field('출처 주소', 'Url', draft.url, { type: 'url', max: C.LIMITS.url, change: v => { draft.url = v; clearMedia(); cancelLookup(); renderLookup(); renderImageEditor(); } }));
      const lookup = node('section', null, 'cl-lookup'); lookup.id = 'clLookup'; lookup.setAttribute('aria-label', '출처 정보 조회'); fs.append(lookup);
      fs.append(field('주제 · 쉼표로 구분', 'Tags', draft.tags.join(', '), { max: 740, change: v => { draft.tags = [...new Set(v.split(',').map(s => s.trim()).filter(Boolean))]; } }));
      for (const key of C.TYPE_FIELDS[draft.type]) fs.append(field(C.DETAILS[key], key, draft.details[key] || '', { change: v => { draft.details[key] = v; } }));
      fs.append(field(draft.type === 'person' ? '좋아하는 이유 · 비공개' : '내 메모 · 비공개', 'Note', draft.note, { multiline: true, max: C.LIMITS.note, change: v => { draft.note = v; } }));
      fs.append(node('p', '이 브라우저에만 저장합니다. 기기 간 동기화는 아직 연결하지 않았습니다.', 'life-help'));
      const actions = node('div', null, 'cl-actions'); const save = node('button', '저장', 'life-button life-primary'); save.type = 'submit';
      actions.append(save, button('편집 취소', () => { if (dirty() && !root.confirm('저장하지 않은 입력을 버리고 돌아갈까요?')) return; const id = selected; draft = null; conflict = null; error = ''; if (id) { draw(); focusHeading(); } else back(); })); fs.append(actions);
      let composing = false;
      form.addEventListener('compositionstart', () => { composing = true; });
      form.addEventListener('compositionend', () => { composing = false; });
      form.addEventListener('submit', async event => { event.preventDefault(); if (busy || composing) return; await saveDraft(); });
      screen.append(form); renderLookup();
      const imagePanel = node('details', null, 'cl-image-editor'); imagePanel.id = 'clImageEditor'; imagePanel.append(node('summary', '표지·썸네일')); fs.insertBefore(imagePanel, actions); renderImageEditor();
      if (compactEditor) {
        const information = node('details', null, 'cl-edit-information'); information.append(node('summary', '정보 수정')); information.open = editorInfoOpen;
        const note = fs.querySelector('#clNote').closest('label');
        for (const child of [...fs.children]) { if (child === note) break; information.append(child); }
        information.append(imagePanel);
        const object = node('div', null, 'cl-selected-object'); object.append(node('p', C.TYPES[draft.type], 'life-meta'), node('h3', draft.title), node('p', draft.creator, 'life-meta'));
        fs.prepend(object); fs.insertBefore(information, note.nextSibling);
        form.addEventListener('invalid', () => { information.open = true; }, true);
      }
      if (conflict) {
        const panel = node('section', null, 'cl-conflict'); panel.setAttribute('aria-label', '다른 탭 변경 비교');
        panel.append(node('h3', '다른 탭의 변경과 비교'), node('p', '현재 입력은 위에 유지했습니다. 사본으로 저장하면 다른 탭의 항목도 그대로 남습니다.', 'life-help'));
        const other = conflict.items.find(i => i.id === selected);
        if (other) { const details = node('details'); details.append(node('summary', '최신 항목 전체 정보'), node('pre', JSON.stringify(other, null, 2), 'cl-note')); panel.append(node('p', other.title), node('p', other.note || '메모 없음', 'cl-note'), details); }
        panel.append(button('내 입력을 새 사본으로 저장', () => saveDraft(true)), button('최신 변경 다시 비교', compare)); screen.append(panel);
      }
    }
    function renderImageEditor() {
      const panel = screen?.querySelector('#clImageEditor'); if (!panel || !draft) return;
      const open = panel.open; panel.replaceChildren(node('summary', '표지·썸네일')); panel.open = open;
      panel.append(node('p', '책은 Open Library의 ISBN·책 주소, 영상은 YouTube 주소로 연결합니다. 앨범·영화·작품·인물 이미지는 아직 지원하지 않습니다.', 'life-help'));
      if (draft.type === 'book') {
        let value = '';
        panel.append(field('ISBN · 10자리 또는 13자리', 'Isbn', '', { max: 24, change: v => { value = v; } }));
        panel.append(button(draft.url ? 'ISBN 주소로 바꾸기' : 'ISBN 출처 연결', () => {
          const source = Media.bookSource(value); if (!source) throw new Error('ISBN 번호와 마지막 검증 숫자를 확인해 주세요. 기존 출처는 유지했습니다.');
          clearMedia(); cancelLookup(); draft.url = source; screen.querySelector('#clUrl').value = source; renderLookup(); renderImageEditor();
          error = ''; status = 'ISBN 출처를 입력에 적용했습니다. 제목·저자를 확인한 뒤 저장해 주세요.'; feedback(); screen.querySelector('#clUrl').focus();
        }));
        panel.append(node('p', 'ISBN을 연결하면 출처 주소가 Open Library로 바뀝니다. 제목·저자와 기존 메모는 바꾸지 않습니다.', 'life-help'));
      }
      const descriptor = Media.describe(draft); if (!descriptor) return;
      const preview = node('div', null, 'cl-image-preview');
      panel.append(button('외부 이미지 확인', () => {
        clearMedia(); preview.replaceChildren();
        // Editor preview is an explicit one-image request, independent of list opt-in.
        const box = node('span', null, 'cl-cover cl-' + draft.type); box.append(node('span', draft.title || '제목 미입력'), node('small', '이미지 불러오는 중')); preview.append(box); loadImage(box, draft);
      }));
      const source = node('a', descriptor.provider + ' · ' + descriptor.label + ' 출처', 'life-button'); source.href = descriptor.source; source.target = '_blank'; source.rel = 'noopener noreferrer'; panel.append(source, preview);
      panel.append(node('p', '이미지 제공자에게 접속합니다. 이미지는 파일이나 백업에 복사하지 않으며, 출처 주소만 저장합니다.', 'life-help'));
    }
    function renderLookup() {
      const panel = screen?.querySelector('#clLookup'); if (!panel) return;
      const restoreFocus = panel.contains(document.activeElement);
      panel.replaceChildren();
      const actions = node('div', null, 'cl-actions');
      const lookup = button(lookupPending ? '정보 조회 중…' : '주소로 정보 확인', startLookup); lookup.disabled = lookupPending; actions.append(lookup);
      if (lookupPending) actions.append(button('조회 취소', () => { cancelLookup(); lookupMessage = '조회를 취소했습니다. 직접 입력을 계속할 수 있습니다.'; renderLookup(); }));
      panel.append(actions, node('p', 'YouTube·GitHub에 영상·저장소 주소만 보내 조회합니다. 내 메모는 보내지 않습니다.', 'life-help'));
      const message = node('p', lookupMessage, 'life-help'); message.setAttribute('role', 'status'); panel.append(message);
      if (restoreFocus) (lookupPending ? actions.lastChild : lookup).focus({ preventScroll: true });
      if (!candidate) return;
      const result = candidate, preview = node('div', null, 'cl-candidate');
      preview.append(node('h3', result.title), node('p', result.provider + ' · ' + result.attributionLabel + ': ' + (result.attribution || '미확인'), 'life-meta'));
      const source = node('a', '조회한 출처 열기'); source.href = result.url; source.target = '_blank'; source.rel = 'noopener noreferrer'; preview.append(source);
      preview.append(node('p', '적용할 항목만 선택하세요. 만든 사람·메모·주제·상세 정보는 그대로 둡니다.', 'life-help'));
      const choices = [];
      for (const [key, label] of [['title', '제목'], ['url', '출처 주소']]) {
        const wrap = node('label', null, 'cl-lookup-choice'), input = node('input'); input.type = 'checkbox'; input.checked = !draft[key];
        input.dataset.metadataField = key; wrap.append(input, node('span', label + ' · ' + result[key])); preview.append(wrap); choices.push([key, input]);
      }
      if (!selected && !draft.creator && !Object.values(draft.details).some(Boolean)) {
        const wrap = node('label', null, 'cl-lookup-choice'), input = node('input'); input.type = 'checkbox'; input.checked = !draft.title; input.dataset.metadataField = 'type';
        wrap.append(input, node('span', '종류 · ' + C.TYPES[result.type])); preview.append(wrap); choices.push(['type', input]);
      }
      const apply = button('선택한 정보 적용', () => {
        if (candidate !== result) return;
        for (const [key, input] of choices) if (input.checked && !input.disabled) {
          if (key === 'type' && draft.type !== result.type) draft.details = {};
          draft[key] = result[key];
        }
        // Creator/notes/details are never populated from an uploader or repository owner.
        draw(); status = '선택한 정보를 입력에 적용했습니다. 확인 후 저장해 주세요.'; feedback(); screen.querySelector('#clTitle').focus();
      });
      apply.id = 'clApplyMetadata';
      const updateApply = () => { apply.disabled = !choices.some(([, input]) => input.checked && !input.disabled); };
      choices.forEach(([, input]) => input.addEventListener('change', updateApply)); updateApply();
      preview.append(apply, button('조회 결과 닫기', () => { cancelLookup(); renderLookup(); screen.querySelector('#clUrl').focus(); }));
      panel.append(preview);
    }
    async function startLookup() {
      cancelLookup(); const token = sequence, original = draft, value = draft.url;
      const controller = new AbortController(); lookupController = controller; lookupPending = true; lookupMessage = ''; renderLookup();
      try {
        const result = await root.HaedoLife.CollectionMetadata.lookup(value, { signal: controller.signal });
        if (!current(token) || draft !== original || lookupController !== controller || draft.url !== value) return;
        candidate = result; lookupMessage = '조회 결과입니다. 아직 입력하거나 저장하지 않았습니다.';
      } catch (cause) {
        if (!current(token) || draft !== original || lookupController !== controller) return;
        lookupMessage = cause.message;
      } finally {
        if (current(token) && draft === original && lookupController === controller) { lookupPending = false; lookupController = null; renderLookup(); }
      }
    }
    async function commit(next, done) {
      const token = sequence; busy = true; error = ''; status = '저장 중…'; feedback();
      try { const saved = await storage.saveCollection(workspaceId, next, next.revision); if (!current(token)) return false; state = saved; status = '이 브라우저에 저장했습니다.'; onSaved?.(); done?.(); return true; }
      catch (cause) { if (current(token)) { error = cause.message; status = ''; } return false; }
      finally { if (current(token)) { busy = false; feedback(); } }
    }
    async function saveDraft(asCopy = false) {
      cancelLookup(); renderLookup();
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
