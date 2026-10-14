(function (root) {
  'use strict';
  const life = root.HaedoLife, M = life.UnifiedSearch;
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  function create({ storage, host, getBundle, isDisposed, onOpen, onReload }) {
    let scope = null, active = false, generation = 0, unsubscribe;
    let query = '', kind = 'all', spacing = false, archived = false, limits = {};
    let data = {}, dataRevision = 0, cached = null, errors = [], section, input, list, status, tabs, changed, composing = false;
    const current = token => active && !isDisposed() && token === generation && getBundle()?.workspaceId === scope;
    const button = (label, action) => { const b = el('button', label, 'life-button'); b.type = 'button'; b.addEventListener('click', action); return b; };
    function leave() { active = false; generation++; unsubscribe?.(); unsubscribe = null; data = {}; cached = null; dataRevision++; }
    function reset() { leave(); scope = null; query = ''; kind = 'all'; spacing = archived = false; limits = {}; }
    function draw() {
      if (!active || !section.isConnected) return;
      const focusKey = list.querySelector(':focus')?.dataset.focusKey;
      // Changing visible kinds or limits never rescans unchanged source bodies.
      if (!cached || cached.revision !== dataRevision || cached.query !== query || cached.spacing !== spacing || cached.archived !== archived) {
        cached = { revision: dataRevision, query, spacing, archived, rows: M.search(data, query, { ignoreKoreanSpacing: spacing, archived }) };
      }
      const rows = cached.rows;
      list.replaceChildren();
      tabs.querySelectorAll('button').forEach(b => {
        const count = rows.filter(r => b.dataset.kind === 'all' || r.kind === b.dataset.kind).length;
        b.textContent = (b.dataset.kind === 'all' ? '전체' : M.labels[b.dataset.kind]) + (query.trim() ? ' ' + count : '');
        b.setAttribute('aria-pressed', String(b.dataset.kind === kind));
      });
      if (!query.trim()) { list.append(el('p', '기억나는 문장, 글 제목, 만든 사람을 찾아보세요.', 'life-empty')); return; }
      let total = 0;
      for (const [key, label] of Object.entries(M.labels)) {
        if (kind !== 'all' && key !== kind) continue;
        const matches = rows.filter(r => r.kind === key); total += matches.length;
        if (!matches.length) continue;
        const group = el('section', null, 'life-find-group'); group.setAttribute('aria-label', label + ' 검색 결과');
        group.append(el('h2', label + ' · ' + matches.length, 'life-find-heading'));
        const limit = limits[key] || (kind === 'all' ? 5 : 20);
        for (const row of matches.slice(0, limit)) {
          const open = button('', async () => {
            const token = generation;
            try { await onOpen(row); }
            catch (e) { if (current(token)) { status.textContent = e.message || '항목을 열지 못했습니다. 다시 확인해 주세요.'; status.setAttribute('role', 'alert'); } }
          });
          open.classList.add('life-find-result'); open.dataset.focusKey = row.key; open.dataset.kind = row.kind;
          const glyph = el('span', null, 'life-find-icon'); glyph.setAttribute('aria-hidden', 'true');
          glyph.append(life.Icons.create(row.kind === 'source' ? 'book' : row.kind === 'page' ? 'edit' : 'bookmark'));
          const copy = el('span', null, 'life-find-copy');
          copy.append(el('span', row.meta + (row.type ? ' · ' + life.Collection.TYPES[row.type] : ''), 'life-meta'), el('strong', row.title), el('span', row.snippet, 'life-find-snippet'), el('span', row.field + ' 일치', 'life-meta'));
          open.append(glyph, copy); group.append(open);
        }
        if (matches.length > limit) group.append(button(label + ' 20개 더 보기', () => {
          limits[key] = limit + 20; draw(); list.querySelectorAll('[data-kind="' + key + '"]')[limit]?.focus();
        }));
        list.append(group);
      }
      if (!total) list.append(el('p', errors.length ? '읽은 범위에는 일치하는 항목이 없습니다. 불러오지 못한 범위는 다시 확인해 주세요.' : '일치하는 항목이 없습니다. 짧은 문구나 다른 종류로 찾아보세요.', 'life-empty'));
      if (focusKey) [...list.querySelectorAll('[data-focus-key]')].find(b => b.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
    }
    async function reload() {
      onReload?.();
      const token = ++generation; data = {}; dataRevision++; cached = null; errors = []; changed.hidden = true;
      status.setAttribute('role', 'status'); status.textContent = '이 작업공간의 자료를 불러오는 중…'; section.setAttribute('aria-busy', 'true'); draw();
      const reads = [['bundle', '원문', () => storage.read(scope)], ['workbench', '페이지', () => storage.readWorkbench(scope)], ['collection', '컬렉션', () => storage.readCollection(scope)], ['nineBoard', '9칸 구성', () => storage.readNineBoard(scope)]];
      await Promise.all(reads.map(async ([key, label, read]) => {
        try { const value = await read(); if (!current(token)) return; data[key] = value; dataRevision++; }
        catch (_) { if (!current(token)) return; errors.push(label); }
        if (current(token)) draw();
      }));
      if (!current(token)) return;
      section.setAttribute('aria-busy', 'false');
      status.textContent = errors.length ? errors.join('·') + '을 불러오지 못했습니다. 나머지 결과는 사용할 수 있습니다.' : '';
      if (errors.length) { status.setAttribute('role', 'alert'); changed.hidden = false; changed.textContent = '불러오기 다시 시도'; }
    }
    async function open() {
      const next = getBundle().workspaceId;
      if (scope !== next) reset();
      scope = next; active = true; composing = false;
      section = el('section', null, 'life-find'); section.setAttribute('aria-label', '통합 검색'); section.id = 'lifeFind';
      const bar = el('div', null, 'life-search-bar'); bar.append(life.Icons.create('search'));
      const label = el('label', null, 'life-search-field'); label.append(el('span', '통합 검색어', 'life-sr-only'));
      input = el('input'); input.type = 'search'; input.id = 'lifeFindQuery'; input.maxLength = 500; input.value = query; input.placeholder = '원문·페이지·컬렉션·9칸 구성 검색'; label.append(input);
      const update = () => { query = input.value; limits = {}; draw(); };
      input.addEventListener('compositionstart', () => { composing = true; });
      input.addEventListener('compositionend', () => { composing = false; update(); });
      input.addEventListener('input', event => { if (!composing && !event.isComposing) update(); });
      const clear = button('', () => { composing = false; input.value = ''; update(); input.focus(); }); clear.classList.add('life-icon-button'); clear.setAttribute('aria-label', '통합 검색어 지우기'); clear.append(life.Icons.create('close')); bar.append(label, clear);
      tabs = el('div', null, 'life-find-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '검색할 종류');
      for (const [key, title] of [['all', '전체'], ...Object.entries(M.labels)]) { const b = button(title, () => { kind = key; draw(); }); b.dataset.kind = key; tabs.append(b); }
      const options = el('details', null, 'life-details'); options.append(el('summary', '검색 범위·옵션'));
      options.append(el('p', '현재 계정·작업공간의 보관 원문과 발췌·메모, 저장한 페이지 글·구성의 코멘트, 컬렉션, 저장한 9칸 구성·영역·선택 이유를 검색합니다. 작성 중인 초안·미반영 입력·가져올 파일 후보·책 원고·공개 서버 사본은 포함하지 않습니다. 검색어는 저장하거나 전송하지 않습니다.', 'life-help'));
      const checkbox = (text, value, change) => { const wrap = el('label', null, 'life-check'), box = el('input'); box.type = 'checkbox'; box.checked = value; box.addEventListener('change', () => { change(box.checked); limits = {}; draw(); }); wrap.append(box, el('span', text)); return wrap; };
      options.append(checkbox('한글 띄어쓰기 무시', spacing, v => { spacing = v; }), checkbox('보관한 컬렉션 포함', archived, v => { archived = v; }));
      status = el('p', '', 'life-help'); status.id = 'lifeFindStatus'; status.setAttribute('role', 'status');
      changed = button('변경된 자료 다시 읽기', reload); changed.id = 'lifeFindReload'; changed.hidden = true;
      list = el('div'); list.id = 'lifeFindResults';
      section.append(bar, tabs, options, status, changed, list); host.replaceChildren(section);
      unsubscribe?.(); unsubscribe = storage.subscribe(scope, event => {
        if (active && ['changed', 'workbench_changed', 'collection_changed', 'nine_board_changed'].includes(event.type)) { changed.hidden = false; changed.textContent = '변경된 자료 다시 읽기'; }
      });
      return reload();
    }
    return Object.freeze({ open, leave, reset, dispose: reset });
  }
  life.UnifiedSearchUI = Object.freeze({ create });
})(globalThis);
