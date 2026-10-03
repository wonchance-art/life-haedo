/* Design proposal only: no Auth, storage, network or service worker access. */
(() => {
  'use strict';
  const data = globalThis.HaedoDesignData;
  const params = new URLSearchParams(location.search);
  const allowed = { direction: ['a', 'b', 'c'], view: ['search', 'reader', 'components'], state: ['normal', 'many', 'empty', 'loading', 'error'] };
  const model = { direction: 'a', view: 'search', state: 'normal', query: '기록', origin: '', sourceId: data.sources[0].id, quote: data.excerpt, saved: [], note: '', topic: '', searchScroll: 0, returnId: '' };
  for (const key of Object.keys(allowed)) if (allowed[key].includes(params.get(key))) model[key] = params.get(key);
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icons = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z"/><path d="M12 5v15"/>',
    excerpt: '<path d="M5 4h14v16l-7-4-7 4Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="m11 5-7 7 7 7M4 12h16"/>',
    leaf: '<path d="M19 4c-7 0-13 2-13 8a6 6 0 0 0 6 6c6 0 7-7 7-14Z"/><path d="M5 21 15 10"/>'
  };
  const icon = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.book}</svg>`;
  const coverage = source => ({ full: '본문 보관', partial: '일부 본문', link: '본문 미확보' }[source.coverage]);
  const source = () => data.sources.find(item => item.id === model.sourceId) || data.sources[0];
  function feedback(message) { $('#feedback').textContent = message; $('#feedback').hidden = false; }
  function setRoute() {
    const url = new URL(location.href);
    for (const key of Object.keys(allowed)) url.searchParams.set(key, model[key]);
    history.replaceState(null, '', url);
  }
  function highlight(text) {
    if (!model.query) return escape(text);
    const lower = text.toLocaleLowerCase('ko'), query = model.query.toLocaleLowerCase('ko');
    const at = lower.indexOf(query);
    return at < 0 ? escape(text) : escape(text.slice(0, at)) + '<mark>' + escape(text.slice(at, at + query.length)) + '</mark>' + escape(text.slice(at + query.length));
  }
  function snippet(item) {
    if (item.coverage === 'link') return '본문 미확보. 링크만 보관한 자료예요.';
    const paragraphs = item.paragraphs.find(p => p.toLocaleLowerCase('ko').includes(model.query.toLocaleLowerCase('ko')));
    const raw = paragraphs || item.paragraphs[0] || '';
    const at = model.query ? raw.toLocaleLowerCase('ko').indexOf(model.query.toLocaleLowerCase('ko')) : 0;
    const start = Math.max(0, at - 35);
    return (start ? '…' : '') + raw.slice(start, start + 165) + (raw.length > start + 165 ? '…' : '');
  }
  function filtered() {
    const values = data.sources.filter(item => (!model.origin || item.origin === model.origin) && (!model.query || [item.title, ...item.paragraphs].join('\n').toLocaleLowerCase('ko').includes(model.query.toLocaleLowerCase('ko'))));
    // Additional rows are explicitly labelled copies, never presented as real records.
    return model.state === 'many' ? Array.from({ length: 5 }, (_, i) => values.map(item => ({ ...item, sampleCopy: i + 1 }))).flat() : values;
  }
  function rail() {
    const origins = [...new Map(data.sources.map(item => [item.origin, item.originLabel])).entries()];
    return `<aside class="rail"><div><div class="brand">${icon('leaf', 30)}<span>해도</span></div><p class="rail-note">흩어진 기록을 한곳에</p></div>
      <nav aria-label="자료 탐색"><button class="nav-item" data-view="search" ${model.view === 'search' || model.view === 'reader' ? 'aria-current="page"' : ''}>${icon('book')}자료 모아보기</button><button class="nav-item" data-action="saved">${icon('excerpt')}발췌 <span id="savedCount">${model.saved.length}</span></button></nav>
      <section class="source-nav"><h2>가져온 곳</h2>${origins.map(([value, name]) => `<button class="nav-item" data-origin="${value}"><span class="source-dot" aria-hidden="true"></span>${name}</button>`).join('')}</section>
      <p class="rail-bottom">내가 가져온 범위만 보관해요.<br>원래 기록은 그대로 남아요.</p></aside>`;
  }
  function render() {
    document.body.dataset.direction = model.direction;
    document.body.dataset.view = model.view;
    for (const key of Object.keys(allowed)) $('#' + key).value = model[key];
    setRoute();
    $('#prototype').innerHTML = `<div class="app-shell">${rail()}<div class="workspace"><div class="workspace-top"><span>내 공간 <span aria-hidden="true">/</span> 자료 모아보기</span><span class="account"><span class="avatar" aria-hidden="true">나</span>예시 작업공간</span></div><main id="main" class="main-content" tabindex="-1">${model.view === 'search' ? searchScreen() : model.view === 'reader' ? readerScreen() : components()}</main></div></div>`;
    if (model.view === 'search') renderResults();
    $('#feedback').hidden = true;
  }
  function searchScreen() {
    return `<div class="page-heading"><div><h1>자료 모아보기</h1><p>남겨둔 기록에서, 지금 필요한 문장을 찾아보세요.</p></div><button class="hd-button hd-primary" data-action="import">${icon('plus', 18)}가져오기</button></div>
      <div class="search-toolbar"><label class="search-box" aria-label="자료 검색">${icon('search')}<input class="hd-field" id="query" type="search" value="${escape(model.query)}" placeholder="제목이나 본문에서 찾기" aria-label="제목이나 본문에서 찾기" autocomplete="off"><button class="clear" data-action="clear" aria-label="검색어 지우기">지우기</button></label>
      <label class="origin-filter"><select class="hd-field" id="origin" aria-label="출처로 좁히기"><option value="">모든 출처</option>${[...new Map(data.sources.map(item => [item.origin, item.originLabel])).entries()].map(([value, name]) => `<option value="${value}" ${value === model.origin ? 'selected' : ''}>${name}</option>`).join('')}</select></label></div>
      <div id="resultArea"></div>`;
  }
  function stateMarkup(kind, reader = false) {
    if (kind === 'loading') return `<div role="status" aria-busy="true"><p class="loading-copy">${reader ? '원문을' : '자료를'} 불러오고 있어요.</p>${[1, 2, 3].map(() => '<div class="result-row" aria-hidden="true"><div class="skeleton short"></div><div class="skeleton"></div><div class="skeleton"></div></div>').join('')}</div>`;
    if (kind === 'error') return `<section class="hd-state error" role="alert"><h2>${reader ? '원문을' : '자료를'} 불러오지 못했어요</h2><p>기존 기록은 변경되지 않았어요. 다시 시도해 주세요.</p><button class="hd-button" data-action="retry">다시 시도</button></section>`;
    return `<section class="hd-state"><h2>${reader ? '이 원문의 본문이 없어요' : '찾는 자료가 없어요'}</h2><p>${reader ? '링크만 보관한 자료는 본문을 읽거나 발췌할 수 없어요.' : '다른 검색어를 쓰거나 출처 필터를 지워보세요.'}</p><button class="hd-button" data-action="${reader ? 'back' : 'reset'}">${reader ? '검색 결과로 돌아가기' : '검색 조건 지우기'}</button></section>`;
  }
  function renderResults() {
    const rows = filtered();
    $('#resultArea').innerHTML = `<div class="results-caption"><h2 id="resultCount" role="status">${['loading', 'error'].includes(model.state) ? '자료 검색' : `${model.state === 'empty' ? 0 : rows.length}개의 자료${model.query ? ' 검색 결과' : ''}`}</h2><p>${model.state === 'many' ? '밀도 확인용 반복 샘플' : '제목과 본문에서 검색 · 원문 버전 유지'}</p></div>` + (['loading', 'error', 'empty'].includes(model.state) ? stateMarkup(model.state) : !rows.length ? stateMarkup('empty') : `<div class="result-list">${rows.map(item => `<article class="result-row" data-source-id="${item.id}"><div class="result-heading"><h2 class="result-title"><button class="result-open" data-open="${item.id}" id="open-${item.id}${item.sampleCopy || ''}">${highlight(item.title)}${item.sampleCopy ? ` <span class="hd-meta">(예시 ${item.sampleCopy})</span>` : ''}</button></h2></div><p class="result-summary">${highlight(snippet(item))}</p><div class="result-meta"><span class="origin">${escape(item.originLabel)}</span><span>${escape(item.dateLabel)}</span><span class="hd-tag">${coverage(item)}${item.version.includes('이전') ? ' · 이전 버전' : ''}</span><span class="topic">${escape(item.topic)}</span></div></article>`).join('')}</div>`);
  }
  function readerScreen() {
    const item = source();
    const normal = !['loading', 'error', 'empty'].includes(model.state) && item.coverage !== 'link';
    return `<div class="back-line"><button class="hd-button hd-quiet" data-action="back">${icon('back', 18)}검색 결과</button>${normal ? '<a class="hd-button hd-quiet mobile-excerpt" href="#excerptPanel">발췌 확인</a>' : ''}</div>
      ${!normal && model.state !== 'normal' && model.state !== 'many' ? stateMarkup(model.state, true) : `<div class="reader-grid"><aside class="reader-index" aria-label="다른 자료"><h2>함께 살펴볼 자료</h2>${data.sources.slice(0, 5).map(other => `<button class="hd-button hd-quiet" data-open="${other.id}" ${item.id === other.id ? 'aria-current="true"' : ''}>${escape(other.title)}</button>`).join('')}</aside><article class="reader-main"><div class="reader-meta"><span>${escape(item.originLabel)}</span><span class="hd-tag">${coverage(item)}</span><span>${escape(item.version)}</span></div><h1 id="readerTitle" tabindex="-1">${escape(item.title)}</h1>
      <details class="reader-details"><summary>출처와 가져온 범위 확인</summary><dl><dt>작성일</dt><dd>${escape(item.dateLabel)}</dd><dt>가져온 날</dt><dd>${escape(item.importedLabel)}</dd><dt>보관 버전</dt><dd>${escape(item.version)}</dd><dt>원래 주소</dt><dd>${escape(item.url)} <span>(시안용 주소)</span></dd><dt>포함 범위</dt><dd>${coverage(item)} · ${item.coverage === 'partial' ? escape(item.summary) : '첨부 포함 여부 미확인'}</dd></dl></details>
      ${item.coverage === 'link' ? stateMarkup('empty', true) : `<div id="readingBody" class="reading-body" tabindex="0" aria-label="가져온 원문, 텍스트를 선택해 발췌"><p>${item.paragraphs.map(escape).join('</p><p>')}</p></div><p class="reader-end hd-meta">가져온 원문의 끝이에요. 출처와 보관 버전은 발췌에도 함께 남아요.</p>`}</article>
      ${item.coverage === 'link' ? '' : `<aside class="excerpt-panel" id="excerptPanel" aria-label="발췌 확인"><h2>기억해 둘 문장</h2><p>원문에서 문장을 선택하면 여기에 담겨요.</p><button class="hd-button hd-quiet" data-action="example-quote">예시 문장 선택</button><blockquote id="quote" aria-live="polite">${escape(model.quote)}</blockquote><label class="hd-label">모을 주제 <span class="hd-meta">선택</span><input id="topic" class="hd-field" placeholder="분류 없이 남겨도 괜찮아요" aria-describedby="saveStatus" value="${escape(model.topic)}" list="topicOptions"><datalist id="topicOptions">${data.topics.map(topic => `<option value="${escape(topic)}">`).join('')}</datalist></label><label class="hd-label">내 생각 <span class="hd-meta">선택</span><textarea id="note" class="hd-field" placeholder="이 문장을 남기는 이유">${escape(model.note)}</textarea></label><button class="hd-button hd-primary" data-action="save">${icon('excerpt', 18)}발췌 추가</button><p class="excerpt-help" id="saveStatus" role="status">시안에서는 이 화면에만 추가돼요.</p><a href="#readerTitle" class="hd-button hd-quiet mobile-excerpt">원문으로 돌아가기</a></aside>`}</div>`}`;
  }
  function components() {
    return `<div class="page-heading"><div><h1>공통 UI 기준</h1><p>읽기와 찾기를 돕는 작은 규칙. A안을 기준으로 한 제안이에요.</p></div></div><div class="component-grid">
    <section class="component-section"><h2>표면과 색</h2><div class="swatches"><div class="swatch">본문<br>#FAF9F5</div><div class="swatch" style="background:var(--hd-panel)">보조 영역<br>#F0F1E9</div><div class="swatch" style="background:var(--hd-accent);color:var(--hd-on-accent)">주요 행동<br>#365B41</div></div><p style="margin-top:16px">상태는 색과 함께 문장으로 알려줘요.</p><p class="status-note" role="status">발췌가 추가됐어요. 원문으로 돌아갈 수 있어요.</p></section>
    <section class="component-section"><h2>행동의 우선순위</h2><div class="component-actions"><button class="hd-button hd-primary" data-action="component">발췌 추가</button><button class="hd-button" data-action="component">다시 시도</button><button class="hd-button hd-quiet" data-action="component">취소</button><button class="hd-button" disabled>문장을 선택해 주세요</button></div><p style="margin-top:20px">한 작업 영역에는 주요 행동 하나. 모든 조작은 최소 44px 높이와 키보드 초점을 가져요.</p></section>
    <section class="component-section"><h2>한글과 긴 제목</h2><h3>${escape(data.sources.find(item => item.title.length > 80).title)}</h3><p style="margin-top:16px">제목은 단어 단위로 줄을 바꾸고, 좁은 화면에서는 긴 단어도 넘치지 않아요. 본문은 17px, 줄 높이는 약 2배로 읽어요.</p><span class="hd-tag">본문 미확보</span> <span class="hd-tag">이전 버전</span></section>
    <section class="component-section"><h2>입력과 오류</h2><label class="hd-label">모을 주제<input class="hd-field" placeholder="예: 읽기와 기록"></label><label class="hd-label">필수 값 오류 예시<input class="hd-field" aria-invalid="true" aria-describedby="fieldError" value=""></label><p id="fieldError" style="color:var(--hd-error)">필수 값을 입력해 주세요.</p></section>
    <section class="component-section wide-section"><h2>자료가 없거나 불러오지 못했을 때</h2>${stateMarkup('error')}<div style="height:24px"></div>${stateMarkup('empty')}</section></div>`;
  }
  function openSource(id, returnId = '') {
    if (model.view === 'search') { model.searchScroll = window.scrollY; model.returnId = returnId; }
    model.sourceId = id; model.view = 'reader'; model.state = 'normal'; model.note = ''; model.quote = id === data.sources[0].id ? data.excerpt : (source().paragraphs[0] || '');
    render(); $('#readerTitle')?.focus({ preventScroll: true }); window.scrollTo(0, 0);
  }
  let composing = false;
  $('#prototype').addEventListener('compositionstart', event => { if (event.target.id === 'query') composing = true; });
  $('#prototype').addEventListener('compositionend', event => { if (event.target.id === 'query') { composing = false; model.query = event.target.value; renderResults(); } });
  $('#prototype').addEventListener('input', event => {
    if (event.target.id === 'query' && !composing) { model.query = event.target.value; renderResults(); }
    if (event.target.id === 'note') model.note = event.target.value;
    if (event.target.id === 'topic') model.topic = event.target.value;
  });
  $('#prototype').addEventListener('change', event => { if (event.target.id === 'origin') { model.origin = event.target.value; renderResults(); } });
  document.addEventListener('selectionchange', () => {
    const body = $('#readingBody'), selection = window.getSelection();
    if (!body || !selection || selection.isCollapsed || !body.contains(selection.anchorNode) || !body.contains(selection.focusNode)) return;
    const text = selection.toString().trim();
    if (text) { model.quote = text; $('#quote').textContent = text; }
  });
  $('#prototype').addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.open) { openSource(button.dataset.open, button.id); return; }
    if (button.dataset.view) { model.view = button.dataset.view; model.state = 'normal'; render(); return; }
    if (button.dataset.origin) { model.origin = button.dataset.origin; model.view = 'search'; model.state = 'normal'; render(); $('#origin').focus(); return; }
    switch (button.dataset.action) {
      case 'clear': model.query = ''; $('#query').value = ''; renderResults(); $('#query').focus(); break;
      case 'reset': model.query = ''; model.origin = ''; model.state = 'normal'; model.view = 'search'; render(); $('#query').focus(); break;
      case 'back': model.view = 'search'; render(); document.getElementById(model.returnId)?.focus({ preventScroll: true }); window.scrollTo(0, model.searchScroll); break;
      case 'retry': model.state = 'normal'; render(); $('#main').focus(); break;
      case 'import': feedback('가져오기 시안은 다음 단계에서 연결해요. 현재 기록은 바뀌지 않아요.'); break;
      case 'example-quote': model.quote = source().id === data.sources[0].id ? data.excerpt : source().paragraphs[0]; $('#quote').textContent = model.quote; $('#topic').focus(); break;
      case 'save':
        if (!model.quote) { $('#saveStatus').textContent = '원문에서 발췌할 문장을 선택해 주세요.'; $('#readingBody').focus(); break; }
        $('#topic').removeAttribute('aria-invalid');
        model.saved.push({ sourceId: model.sourceId, quote: model.quote, topic: model.topic, note: model.note });
        $('#savedCount').textContent = model.saved.length;
        $('#saveStatus').textContent = '시안에 발췌를 추가했어요. 새로고침하면 사라져요.';
        break;
      case 'saved': feedback(model.saved.length ? `이 시안에서 추가한 발췌 ${model.saved.length}개: ${model.saved.at(-1).quote}` : '아직 추가한 발췌가 없어요. 원문을 읽고 문장을 골라보세요.'); break;
      case 'component': feedback('공통 버튼의 동작 확인 예시예요. 실제 자료는 바뀌지 않아요.'); break;
    }
  });
  for (const key of Object.keys(allowed)) $('#' + key).addEventListener('change', event => { model[key] = event.target.value; render(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') $('#feedback').hidden = true; });
  render();
})();
