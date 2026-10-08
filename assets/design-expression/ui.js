/* Anonymous, memory-only comparison. No Auth, storage, service worker or publishing. */
(function () {
  'use strict';
  const data = globalThis.HaedoExpressionSamples;
  const app = document.querySelector('#expressionApp');
  const status = document.querySelector('#expressionStatus');
  const variants = document.querySelector('#expressionVariant');
  const stateControl = document.querySelector('#expressionState');
  const notes = new Map(data.entries.map(entry => [entry.id, entry.note]));
  const expanded = new Set(), editors = new Map();
  let variant = 'a', preview = true, reader = null, returnPoint = null, previewReturn = null;
  const origins = { apple_notes: 'Apple 메모', obsidian: 'Obsidian', instagram: 'Instagram', naver_blog: '네이버 블로그', other: '기타' };
  const element = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  function control(text, fn, className = 'life-button') {
    const el = element('button', text, className); el.type = 'button'; el.addEventListener('click', fn); return el;
  }
  function iconControl(label, icon, fn) {
    const el = control(null, fn, 'life-icon-button'); el.setAttribute('aria-label', label); el.title = label;
    el.append(HaedoLife.Icons.create(icon)); return el;
  }
  function resolve(ref) {
    const source = data.sources.find(item => item.id === ref.sourceId);
    return { source, version: source.versions.find(item => item.id === ref.versionId) };
  }
  function metadata(source, version) {
    const meta = element('p', null, 'expression-source-meta');
    const facts = [origins[source.origin] || source.origin, source.relation === 'self' ? '내 글' : source.relation === 'other' ? '보관한 타인 글' : '작성자 미확인'];
    if (source.coverage === 'partial') facts.push('본문 일부', ...(source.omissions || []));
    if (source.coverage === 'link_only') facts.push('본문 미확보');
    const index = source.versions.findIndex(item => item.id === version.id);
    if (index < source.versions.length - 1) facts.push('이전 버전 ' + (index + 1) + '/' + source.versions.length);
    meta.append(element('span', facts.join(' · ')));
    if (version.originalCreatedAt) {
      const date = element('time', '원문 작성일 ' + version.originalCreatedAt.slice(0, 10).replaceAll('-', '.'), 'expression-date');
      date.dateTime = version.originalCreatedAt; meta.append(date);
    }
    return meta;
  }
  // A prefix remains an exact slice of the selected source version. Nothing is
  // summarized, re-written or used to decide what a public snapshot contains.
  function opening(text) {
    const narrow = app.clientWidth < 600;
    const limit = variant === 'a' ? (narrow ? 170 : 290) : (narrow ? 90 : 150);
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
  function restore(point) {
    if (!point) return;
    const target = document.getElementById(point.id);
    target?.focus({ preventScroll: true });
    if (target instanceof HTMLTextAreaElement && point.start !== undefined) {
      target.setSelectionRange(point.start, point.end, point.direction); target.scrollTop = point.innerScroll;
    }
    scrollTo({ top: point.scrollY, behavior: 'instant' });
  }
  function capturePoint(target) {
    return { id: target.id, scrollY, start: target.selectionStart, end: target.selectionEnd, direction: target.selectionDirection, innerScroll: target.scrollTop };
  }
  function openSource(source, version, button) {
    returnPoint = capturePoint(button); reader = { source, version }; render();
    document.querySelector('#expressionReader h1').focus({ preventScroll: true }); scrollTo({ top: 0, behavior: 'instant' });
  }
  function sourcePart(ref, entry, index) {
    const { source, version } = resolve(ref), key = entry.id + ':' + version.id;
    const part = element('section', null, 'expression-source');
    Object.assign(part.dataset, { sourceId: source.id, versionId: version.id });
    part.setAttribute('aria-label', source.title);
    if (entry.sourceRefs.length > 1 || entry.title !== source.title) part.append(element('h3', source.title));
    part.append(metadata(source, version));
    const actions = element('div', null, 'expression-source-actions');
    if (version.text !== null) {
      const prefix = opening(version.text), canFold = prefix !== version.text;
      const body = element('pre', expanded.has(key) ? version.text : prefix, 'expression-body');
      body.tabIndex = -1;
      body.id = 'expressionBody-' + entry.id + '-' + index;
      body.dataset.collapsed = String(canFold && !expanded.has(key));
      body.setAttribute('aria-label', canFold && !expanded.has(key) ? '원문 앞부분' : '보관한 원문');
      part.append(body);
      if (canFold) {
        const expand = control(expanded.has(key) ? '본문 접기' : '본문 펼치기', () => {
          const wasOpen = expanded.has(key), offset = expand.getBoundingClientRect().top;
          if (wasOpen) expanded.delete(key); else expanded.add(key);
          body.textContent = wasOpen ? prefix : version.text;
          body.dataset.collapsed = String(wasOpen);
          body.setAttribute('aria-label', wasOpen ? '원문 앞부분' : '보관한 원문');
          expand.textContent = wasOpen ? '본문 펼치기' : '본문 접기';
          expand.setAttribute('aria-expanded', String(!wasOpen));
          (wasOpen ? expand : body).focus({ preventScroll: true });
          // Keep the collapse control where the reader was using it.
          if (wasOpen) scrollBy({ top: expand.getBoundingClientRect().top - offset, behavior: 'instant' });
        }, 'expression-text-button expression-expand');
        expand.setAttribute('aria-expanded', String(expanded.has(key))); expand.setAttribute('aria-controls', body.id);
        expand.id = 'expressionExpand-' + entry.id + '-' + index; actions.append(expand);
      }
    } else part.append(element('p', '링크만 보관했습니다. 원문 본문은 없습니다.', 'life-help'));
    const open = control('원문 보기', () => openSource(source, version, open), 'expression-text-button expression-open');
    open.id = 'expressionOpen-' + entry.id + '-' + index;
    open.prepend(HaedoLife.Icons.create('book')); actions.append(open); part.append(actions); return part;
  }
  function entryCard(entry) {
    const card = element('article', null, 'expression-entry'); card.dataset.entryId = entry.id;
    if (entry.pinned) { const pin = element('p', null, 'expression-pin'); pin.append(HaedoLife.Icons.create('bookmark'), document.createTextNode('고정')); card.append(pin); }
    const heading = element('div', null, 'expression-entry-heading'); heading.append(element('h2', entry.title));
    const editorId = 'expressionNote-' + entry.id;
    if (!preview) {
      const edit = iconControl('코멘트 편집 · ' + entry.title, 'edit', () => {
        const opened = editors.has(entry.id);
        if (opened) editors.delete(entry.id); else editors.set(entry.id, null);
        render(); document.getElementById(opened ? edit.id : editorId)?.focus({ preventScroll: true });
      });
      edit.dataset.noteEdit = entry.id; edit.id = 'expressionEdit-' + entry.id;
      edit.setAttribute('aria-expanded', String(editors.has(entry.id))); heading.append(edit);
    }
    card.append(heading);
    entry.sourceRefs.forEach((ref, index) => card.append(sourcePart(ref, entry, index)));
    const note = element('div', null, 'expression-comment'); note.dataset.noteFor = entry.id;
    note.append(element('p', '내 코멘트', 'life-meta'), element('p', notes.get(entry.id), 'expression-comment-body'));
    note.hidden = !notes.get(entry.id); card.append(note);
    if (!preview && editors.has(entry.id)) {
      const editor = element('div', null, 'expression-editor'), label = element('label', null, 'life-field');
      label.append(element('span', '내 코멘트')); const input = element('textarea');
      input.id = editorId; input.dataset.noteId = entry.id; input.value = notes.get(entry.id); input.maxLength = 10000;
      input.addEventListener('input', () => {
        notes.set(entry.id, input.value); note.lastChild.textContent = input.value; note.hidden = !input.value;
        status.textContent = '시안에만 반영했습니다. 실제 자료는 바뀌지 않습니다.';
      });
      input.addEventListener('focusout', () => editors.set(entry.id, capturePoint(input)));
      label.append(input); editor.append(label, element('p', '시안에서만 편집 · 새로고침하면 초기화', 'life-meta')); card.append(editor);
    }
    return card;
  }
  function renderReader() {
    const { source, version } = reader;
    const surface = element('section'); surface.id = 'expressionReader';
    Object.assign(surface.dataset, { sourceId: source.id, versionId: version.id });
    const heading = element('div', null, 'expression-reader-heading');
    const back = iconControl('페이지로 돌아가기', 'back', () => { reader = null; render(); restore(returnPoint); }); back.id = 'expressionBack';
    const title = element('h1', source.title); title.tabIndex = -1;
    heading.append(back, title); surface.append(heading, metadata(source, version));
    if (version.text !== null) surface.append(element('pre', version.text, 'expression-body'));
    else surface.append(element('p', '본문을 확보하지 않은 링크입니다. 예시 주소이며 실제 글을 가져오지 않습니다.', 'life-help'));
    if (source.url) surface.append(element('p', source.url, 'life-meta'));
    app.append(surface);
  }
  function render() {
    app.dataset.variant = variant; app.replaceChildren();
    if (reader) { renderReader(); return; }
    const top = element('header'); top.append(element('h1', data.title, 'expression-page-title'), element('p', data.intro, 'expression-intro'));
    const toolbar = element('div', null, 'expression-toolbar');
    toolbar.append(element('p', preview ? '비공개 미리보기 · 익명 예시' : '편집 체험 · 익명 예시', 'life-meta'));
    const mode = control(preview ? '편집 체험' : '미리보기', () => {
      if (!preview) {
        const last = [...editors.values()].filter(Boolean).at(-1);
        previewReturn = last ? { ...last, scrollY } : capturePoint(mode);
      }
      preview = !preview; render();
      if (!preview && previewReturn) restore(previewReturn);
      else document.querySelector('#expressionMode').focus({ preventScroll: true });
    });
    mode.id = 'expressionMode'; toolbar.append(mode); top.append(toolbar); app.append(top);
    const scene = stateControl.value;
    if (scene !== 'normal') {
      const box = element('section', null, 'expression-state');
      if (scene === 'empty') box.append(element('p', '표시할 글이 없습니다.'), control('예시 글 보기', () => { stateControl.value = 'normal'; render(); document.querySelector('#expressionMode').focus(); }));
      if (scene === 'loading') { box.setAttribute('role', 'status'); box.setAttribute('aria-busy', 'true'); box.append(element('p', '글을 불러오는 중입니다.')); }
      if (scene === 'error') { box.setAttribute('role', 'alert'); box.append(element('p', '글을 불러오지 못했습니다. 시안의 편집 내용은 유지됩니다.'), control('다시 보기', () => { stateControl.value = 'normal'; render(); document.querySelector('#expressionMode').focus(); })); }
      app.append(box); return;
    }
    data.entries.forEach(entry => app.append(entryCard(entry)));
  }
  variants.addEventListener('click', event => {
    const button = event.target.closest('[data-variant]'); if (!button) return;
    variant = button.dataset.variant; reader = null;
    variants.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    render(); status.textContent = variant === 'a' ? 'A 글 중심 배치' : 'B 활동 구분 배치';
  });
  stateControl.addEventListener('change', () => { reader = null; render(); });
  let width = innerWidth;
  addEventListener('resize', () => { if (innerWidth !== width) { width = innerWidth; if (!document.activeElement?.matches('textarea')) render(); } });
  render();
})();
