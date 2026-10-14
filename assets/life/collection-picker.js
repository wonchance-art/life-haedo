/* Explicit local selection and supported URL lookup. No persistence or automatic requests. */
(function (root) {
  'use strict';
  const C = root.HaedoLife.Collection, Metadata = root.HaedoLife.CollectionMetadata;
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };
  function open({ items, onSelect, isCurrent, purpose }) {
    const attaching = purpose === 'attach';
    const origin = document.activeElement, dialog = node('dialog', null, 'life-collection cl-picker');
    const searchCache = new Map();
    let topic = '';
    let alive = true, controller = null, kind = 'all', limit = 30, composing = false;
    const scrollStyle = document.body.style.overflow;
    function cancel() { controller?.abort(); controller = null; }
    function close() {
      if (!alive) return; alive = false; cancel(); dialog.close(); dialog.remove();
      document.body.style.overflow = scrollStyle;
      if (origin?.isConnected) origin.focus({ preventScroll: true });
    }
    function choose(value) { if (!alive || !isCurrent()) { close(); return; } close(); onSelect(value); }
    function button(label, action, cls = 'life-button') {
      const el = node('button', label, cls); el.type = 'button'; el.addEventListener('click', action); return el;
    }
    const head = node('header', null, 'cl-picker-head'), title = node('h2', attaching ? '글에 무엇을 붙일까요?' : '무엇을 담을까요?'); title.id = 'clPickerTitle';
    const exit = button('', close, 'life-icon-button'); exit.setAttribute('aria-label', '선택창 닫기'); exit.append(root.HaedoLife.Icons.create('close'));
    head.append(title, exit); dialog.setAttribute('aria-labelledby', title.id);
    const form = node('form', null, 'cl-picker-search'), input = node('input');
    input.id = 'clPickerQuery'; input.type = 'search'; input.maxLength = C.LIMITS.url;
    input.placeholder = '이름 검색 또는 링크 붙여넣기'; input.setAttribute('aria-label', '담을 대상 검색'); input.autocomplete = 'off';
    const find = node('button', '링크 확인', 'life-button'); find.type = 'submit'; find.hidden = true;
    form.append(input, find);
    const filters = node('div', null, 'cl-chip-row'); filters.setAttribute('aria-label', '대상 종류');
    for (const [id, label] of [['all', '전체'], ...Object.entries(C.TYPES)]) {
      const b = button(label, () => { kind = id; limit = 30; filters.querySelectorAll('button').forEach(el => el.setAttribute('aria-pressed', String(el === b))); render(); });
      b.setAttribute('aria-pressed', String(id === kind)); filters.append(b);
    }
    const body = node('div', null, 'cl-picker-body'), results = node('div', null, 'cl-picker-results'), remote = node('section', null, 'cl-picker-remote');
    const message = node('p', '', 'life-help'); message.setAttribute('role', 'status');
    const hint = node('p', '입력 중에는 내 컬렉션만 찾아요. 외부 검색을 누르면 검색어가 해당 제공자에게 전송됩니다.', 'life-help'); hint.id = 'clPickerHelp'; input.setAttribute('aria-describedby', hint.id);
    const external = node('div', null, 'cl-picker-providers');
    const bookSearch = button('책 찾기 · Open Library', () => search('books'));
    const projectSearch = button('프로젝트 찾기 · GitHub', () => search('projects'));
    external.append(bookSearch, projectSearch);
    const topics = node('select'); topics.id = 'clPickerTopic'; topics.setAttribute('aria-label', '내 컬렉션 주제');
    const allTopics = node('option', '모든 주제'); allTopics.value = ''; topics.append(allTopics);
    for (const tag of [...new Set(items.flatMap(item => item.tags || []))].sort((a,b) => a.localeCompare(b, 'ko'))) {
      const option = node('option', tag); option.value = tag; topics.append(option);
    }
    topics.hidden = topics.options.length === 1;
    topics.addEventListener('change', () => { topic = topics.value; limit = 30; render(); });
    body.append(hint, external, remote, topics, message, results);
    const foot = node('footer', null, 'cl-picker-foot');
    function manualChoice() {
      const value = input.value.trim(), reference = Metadata.reference(value), isURL = /^https?:\/\//i.test(value);
      choose({seed:{type:kind === 'all' ? reference?.type || 'music' : kind,
        title:isURL ? '' : value.slice(0,C.LIMITS.title),url:isURL ? value : ''},compact:false,
        review:reference ? reference.provider + ' 작품 링크입니다. 정보를 조회한 것은 아닙니다. 원출처에서 제목·작가를 확인해 입력하세요.' : ''});
    }
    foot.append(button('직접 입력', manualChoice));
    dialog.append(head, form, filters, body, foot);
    function identity(url) { try { return Metadata.identify(url)?.url || url; } catch (_) { return url; } }
    function row(item, action, subtitle, glyph = 'plus') {
      const b = button('', action, 'cl-pick-row');
      const shape = node('span', '', 'cl-pick-shape cl-' + item.type); shape.setAttribute('aria-hidden', 'true');
      shape.append(root.HaedoLife.Icons.create(({ person: 'user', place: 'map', tool: 'workspace' })[item.type] || 'bookmark'));
      const copy = node('span', null, 'cl-pick-copy'); copy.append(node('strong', item.title), node('span', subtitle, 'life-meta'));
      b.append(shape, copy, root.HaedoLife.Icons.create(glyph)); return b;
    }
    function render() {
      cancel(); remote.inert = false; remote.removeAttribute('aria-busy'); remote.replaceChildren(); results.replaceChildren();
      const value = input.value.trim(), url = /^https?:\/\//i.test(value);
      find.hidden = !url; find.disabled = false; find.textContent = Metadata.reference(value) ? '작품 정보 입력' : '링크 확인';
      external.hidden = url || value.length < 2;
      bookSearch.disabled = projectSearch.disabled = false;
      const matched = items.filter(item => (kind === 'all' || item.type === kind) && (!topic || item.tags?.includes(topic)) && (url && identity(item.url) === identity(value) || C.matches(item, { query: value, archived: item.archived })));
      message.textContent = matched.length ? `내 컬렉션 · ${matched.length}개` : value ? '아직 모아 둔 항목이 없어요.' : '좋아하는 것의 이름이나 링크로 시작하세요.';
      for (const item of matched.slice(0, limit)) {
        const group = node('div', null, 'cl-pick-item');
        group.append(row(item, () => choose({ item, compact: true }), [item.creator || C.TYPES[item.type], attaching ? '글에 붙이기' : item.archived ? '보관 중 · 메모 이어 쓰기' : '메모 이어 쓰기'].join(' · '), attaching ? 'plus' : 'edit'));
        if (item.note || item.tags?.length) {
          const detail = node('details', null, 'cl-pick-note');
          detail.append(node('summary', '내 메모·주제'));
          if (item.note) detail.append(node('p', item.note));
          if (item.tags?.length) detail.append(node('p', item.tags.join(' · '), 'life-meta'));
          if (attaching) detail.append(node('p', '메모와 주제는 글에 복사하지 않습니다.', 'life-meta'));
          group.append(detail);
        }
        results.append(group);
      }
      if (matched.length > limit) results.append(button('더 보기', () => { const first = limit; limit += 30; render(); results.querySelectorAll('.cl-pick-row')[first]?.focus(); }));
    }
    async function search(provider, page = 1) {
      if (composing || controller || !alive || !isCurrent()) return;
      const query = input.value.trim(); if (query.length < 2 || /^https?:\/\//i.test(query)) return;
      const request = new AbortController(); controller = request;
      const previousFocus = document.activeElement, pageNavigation = remote.contains(previousFocus);
      bookSearch.disabled = projectSearch.disabled = true; remote.inert = true;
      message.textContent = '검색 중…'; remote.setAttribute('aria-busy', 'true');
      try {
        const key = provider + ':' + query + ':' + page;
        const result = searchCache.get(key) || await Metadata.search(provider, query, { signal: request.signal, page });
        if (!alive || !isCurrent() || controller !== request || request.signal.aborted) return;
        if (searchCache.size >= 12) searchCache.delete(searchCache.keys().next().value);
        searchCache.set(key, result);
        remote.replaceChildren();
        message.textContent = result.results.length ? '후보를 선택해 정보를 확인해 주세요.' : '찾은 후보가 없어요. 검색어를 바꾸거나 직접 입력하세요.';
        if (result.incomplete) message.textContent += ' 제공자가 일부 결과만 보냈습니다.';
        for (const candidate of result.results) {
          const existing = items.find(item => identity(item.url) === identity(candidate.url));
          const group = node('div', null, 'cl-candidate');
          group.append(row(existing || candidate, () => choose(existing ? { item: existing, compact: true } : {
            seed: { type: candidate.type, title: candidate.title, creator: candidate.creator, url: candidate.url }, compact: false, review: candidate.provider + ' · ' + candidate.detail
          }), existing ? '내 컬렉션 · ' + (attaching ? '글에 붙이기' : '메모 이어 쓰기') : [candidate.provider, candidate.attribution ? candidate.attributionLabel + ': ' + candidate.attribution : '작성자 정보 없음', candidate.detail].filter(Boolean).join(' · ')));
          if (candidate.type === 'book' && /^https:\/\/openlibrary\.org\/works\/OL[0-9]+W$/.test(candidate.url)) {
            const editions = node('section', null, 'cl-editions');
            const open = button('판본 찾기', () => loadEditions(candidate, editions, 0, open));
            open.setAttribute('aria-label', candidate.title + ' · 판본 찾기');
            const korean = button('한국어판 찾기', () => loadEditions(candidate, editions, 0, korean, true));
            korean.setAttribute('aria-label', candidate.title + ' · 한국어판 찾기');
            const actions = node('div',null,'cl-picker-providers cl-edition-actions'); actions.append(korean,open);
            group.append(actions, editions);
          }
          remote.append(group);
        }
        if (provider === 'books' && (page > 1 || result.hasMore)) {
          remote.append(node('p', `검색 결과 · ${page}쪽`, 'life-help'));
          const pages = node('div',null,'cl-picker-providers');
          if (page > 1) pages.append(button('이전 검색 결과', () => search(provider,page-1)));
          if (result.hasMore) pages.append(button('다음 검색 결과', () => search(provider,page+1)));
          remote.append(pages);
        }
        if (page > 1 || pageNavigation) { remote.inert = false; remote.tabIndex=-1; remote.focus({preventScroll:true}); remote.scrollIntoView({block:'nearest'}); }
      } catch (error) {
        if (!alive || !isCurrent() || controller !== request || request.signal.aborted) return;
        message.textContent = (error.message || '검색하지 못했습니다.') + ' 직접 입력으로 이어갈 수 있어요.';
        remote.inert = false;
        if (pageNavigation && previousFocus.isConnected) previousFocus.focus({preventScroll:true});
      } finally {
        if (alive && controller === request) { controller = null; bookSearch.disabled = projectSearch.disabled = false; remote.inert = false; remote.removeAttribute('aria-busy'); }
      }
    }
    async function loadEditions(work, host, offset, trigger, korean = false) {
      if (composing || controller || !alive || !isCurrent()) return;
      const request = new AbortController(); controller = request;
      trigger.disabled = true; host.setAttribute('aria-busy','true');
      const status = node('p','판본 확인 중…','life-help'); status.setAttribute('role','status');
      host.replaceChildren(status);
      try {
        const key = 'editions:' + work.url + ':' + offset + ':' + korean;
        const result = searchCache.get(key) || await (korean ? Metadata.koreanEdition(work.url, {signal:request.signal}) : Metadata.editions(work.url, offset, {signal:request.signal}));
        if (!alive || !isCurrent() || controller !== request || request.signal.aborted || !host.isConnected) return;
        if (searchCache.size >= 12) searchCache.delete(searchCache.keys().next().value);
        searchCache.set(key,result);
        status.textContent = korean ? (result.results.length ? '한국어판 대표 후보입니다. 전체 판본 목록은 아닙니다. 저자·번역자를 확인해 주세요.' : '제공자 검색에서 한국어판을 확인하지 못했어요. 전체 판본을 찾아보거나 직접 입력할 수 있어요.') : result.results.length ? '언어·출판사·발행일을 확인하세요. 판본의 저자·번역자는 직접 확인해 주세요.' : '이 범위에서 확인 가능한 판본이 없어요. 작품 정보로 계속하거나 직접 입력할 수 있어요.';
        for (const edition of result.results) {
          const existing = items.find(item => identity(item.url) === identity(edition.url));
          host.append(row(existing || edition, () => choose(existing ? {item:existing,compact:true} : {
            seed:{type:'book',title:edition.title,creator:'',url:edition.url},compact:false,
            review:'Open Library · ' + edition.detail + ' · 작품 저자: ' + (work.creator || '미상') + ' · 판본의 저자·번역자는 확인 후 입력'
          }), edition.detail));
        }
        const pages = node('div',null,'cl-picker-providers');
        if (!korean && offset > 0) pages.append(button('이전 판본', () => loadEditions(work,host,offset-6,trigger)));
        if (result.hasMore) pages.append(button('다음 판본', () => loadEditions(work,host,offset+6,trigger)));
        host.append(pages);
        host.tabIndex=-1; host.focus({preventScroll:true}); host.scrollIntoView({block:'nearest'});
      } catch (error) {
        if (!alive || !isCurrent() || controller !== request || request.signal.aborted || !host.isConnected) return;
        status.textContent = (error.message || '판본 정보를 받지 못했어요.') + ' 작품 정보는 그대로 사용할 수 있습니다.';
        host.append(button('판본 다시 확인', () => loadEditions(work,host,offset,trigger,korean)));
      } finally {
        if (alive && controller === request) {controller=null;trigger.disabled=false;host.removeAttribute('aria-busy');}
      }
    }
    input.addEventListener('input', () => { limit = 30; render(); });
    form.addEventListener('compositionstart', () => { composing = true; });
    form.addEventListener('compositionend', () => { composing = false; });
    form.addEventListener('keydown', event => { if (event.key === 'Enter' && (composing || event.isComposing || event.keyCode === 229)) event.preventDefault(); });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (composing || controller || !alive || !isCurrent()) return;
      const value = input.value.trim(); if (!/^https?:\/\//i.test(value)) return;
      if (Metadata.reference(value)) { manualChoice(); return; }
      cancel(); const request = new AbortController(); controller = request;
      remote.replaceChildren(); find.disabled = true; find.textContent = '확인 중…'; message.textContent = '링크 정보를 확인하고 있어요.';
      try {
        const candidate = await Metadata.lookup(value, { signal: request.signal });
        if (!alive || !isCurrent() || controller !== request || request.signal.aborted) return;
        const existing = items.find(item => identity(item.url) === identity(candidate.url));
        message.textContent = existing ? (attaching ? '컬렉션에서 찾았어요. 글에 붙일 수 있어요.' : '이미 담아 둔 항목이에요. 메모를 이어 쓸 수 있어요.') : '정보를 확인하고 골라 주세요.';
        remote.append(row(existing || candidate, () => choose(existing ? { item: existing, compact: true } : { seed: { title: candidate.title, type: candidate.type, url: candidate.url }, compact: true }), existing ? (attaching ? '내 컬렉션 · 글에 붙이기' : '내 컬렉션 · 메모 이어 쓰기') : `${candidate.provider} · ${candidate.attributionLabel}: ${candidate.attribution}`, existing && !attaching ? 'edit' : 'plus'));
      } catch (error) {
        if (!alive || !isCurrent() || controller !== request || request.signal.aborted) return;
        message.textContent = (error.message || '정보를 확인하지 못했어요.') + ' 직접 입력으로 이어갈 수 있어요.';
      } finally { if (alive && controller === request) { controller = null; find.disabled = false; find.textContent = '링크 확인'; } }
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!composing && !event.isComposing && event.keyCode !== 229) close();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button,input,select,summary')].filter(el => !el.disabled && !el.closest('[inert]') && el.getClientRects().length);
      const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1) : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : null;
      if (target) { event.preventDefault(); target.focus(); }
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!composing) close(); });
    let backdrop = false;
    dialog.addEventListener('pointerdown', event => { backdrop = event.target === dialog && outside(event); });
    dialog.addEventListener('click', event => { if (backdrop && event.target === dialog && outside(event)) close(); backdrop = false; });
    function outside(event) { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; }
    document.body.append(dialog); document.body.style.overflow = 'hidden'; render(); dialog.showModal(); input.focus();
    return close;
  }
  root.HaedoLife.CollectionPicker = { open };
})(window);
