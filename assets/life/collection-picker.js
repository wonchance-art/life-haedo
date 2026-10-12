/* Explicit local selection and supported URL lookup. No persistence or automatic requests. */
(function (root) {
  'use strict';
  const C = root.HaedoLife.Collection, Metadata = root.HaedoLife.CollectionMetadata;
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };
  function open({ items, onSelect, isCurrent, purpose = 'edit' }) {
    const origin = document.activeElement, dialog = node('dialog', null, 'life-collection cl-picker');
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
    const head = node('header', null, 'cl-picker-head'), title = node('h2', purpose === 'insert' ? '함께 넣을 항목' : '무엇을 담을까요?'); title.id = 'clPickerTitle';
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
    const hint = node('p', '이름은 내 컬렉션에서 찾아요. YouTube·GitHub는 링크로 확인할 수 있어요.', 'life-help'); hint.id = 'clPickerHelp'; input.setAttribute('aria-describedby', hint.id);
    body.append(hint, remote, message, results);
    const foot = node('footer', null, 'cl-picker-foot');
    foot.append(button('직접 입력', () => { const value = input.value.trim(); choose({ seed: { type: kind === 'all' ? 'music' : kind, title: /^https?:\/\//i.test(value) ? '' : value.slice(0, C.LIMITS.title), url: /^https?:\/\//i.test(value) ? value : '' }, compact: false }); }));
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
      cancel(); remote.replaceChildren(); results.replaceChildren();
      const value = input.value.trim(), url = /^https?:\/\//i.test(value);
      find.hidden = !url; find.disabled = false; find.textContent = '링크 확인';
      const matched = items.filter(item => (kind === 'all' || item.type === kind) && (url && identity(item.url) === identity(value) || C.matches(item, { query: value, archived: item.archived })));
      message.textContent = matched.length ? `내 컬렉션 · ${matched.length}개` : value ? '아직 모아 둔 항목이 없어요.' : '좋아하는 것의 이름이나 링크로 시작하세요.';
      for (const item of matched.slice(0, limit)) results.append(row(item, () => choose({ item, compact: true }), [item.creator || C.TYPES[item.type], purpose === 'insert' ? (item.archived ? '보관 중 · 정보 선택' : '정보 선택') : item.archived ? '보관 중 · 메모 이어 쓰기' : '메모 이어 쓰기'].join(' · '), purpose === 'insert' ? 'plus' : 'edit'));
      if (matched.length > limit) results.append(button('더 보기', () => { const first = limit; limit += 30; render(); results.querySelectorAll('.cl-pick-row')[first]?.focus(); }));
    }
    input.addEventListener('input', () => { limit = 30; render(); });
    form.addEventListener('compositionstart', () => { composing = true; });
    form.addEventListener('compositionend', () => { composing = false; });
    form.addEventListener('keydown', event => { if (event.key === 'Enter' && (composing || event.isComposing || event.keyCode === 229)) event.preventDefault(); });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (composing || controller || !alive || !isCurrent()) return;
      const value = input.value.trim(); if (!/^https?:\/\//i.test(value)) return;
      cancel(); const request = new AbortController(); controller = request;
      remote.replaceChildren(); find.disabled = true; find.textContent = '확인 중…'; message.textContent = '링크 정보를 확인하고 있어요.';
      try {
        const candidate = await Metadata.lookup(value, { signal: request.signal });
        if (!alive || !isCurrent() || controller !== request || request.signal.aborted) return;
        const existing = items.find(item => identity(item.url) === identity(candidate.url));
        message.textContent = existing ? (purpose === 'insert' ? '내 컬렉션에 저장한 정보를 선택할 수 있어요.' : '이미 담아 둔 항목이에요. 메모를 이어 쓸 수 있어요.') : '정보를 확인하고 골라 주세요.';
        remote.append(row(existing || candidate, () => choose(existing ? { item: existing, compact: true } : { seed: { title: candidate.title, type: candidate.type, url: candidate.url }, compact: true }), existing ? (purpose === 'insert' ? '내 컬렉션 · 정보 선택' : '내 컬렉션 · 메모 이어 쓰기') : `${candidate.provider} · ${candidate.attributionLabel}: ${candidate.attribution}`, existing && purpose !== 'insert' ? 'edit' : 'plus'));
      } catch (error) {
        if (!alive || !isCurrent() || controller !== request || request.signal.aborted) return;
        message.textContent = (error.message || '정보를 확인하지 못했어요.') + ' 직접 입력으로 이어갈 수 있어요.';
      } finally { if (alive && controller === request) { controller = null; find.disabled = false; find.textContent = '링크 확인'; } }
    });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button,input')].filter(el => !el.disabled && el.getClientRects().length);
      const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1) : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : null;
      if (target) { event.preventDefault(); target.focus(); }
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    let backdrop = false;
    dialog.addEventListener('pointerdown', event => { backdrop = event.target === dialog && outside(event); });
    dialog.addEventListener('click', event => { if (backdrop && event.target === dialog && outside(event)) close(); backdrop = false; });
    function outside(event) { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; }
    document.body.append(dialog); document.body.style.overflow = 'hidden'; render(); dialog.showModal(); input.focus();
    return close;
  }
  root.HaedoLife.CollectionPicker = { open };
})(window);
