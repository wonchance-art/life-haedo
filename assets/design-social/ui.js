/* Anonymous interaction concepts. No Auth, persistence, analytics or remote API. */
(() => {
  'use strict';
  const data = globalThis.HaedoDesignData;
  const q = new URLSearchParams(location.search);
  const concepts = ['color', 'thread', 'pulse'], states = ['normal', 'empty', 'loading', 'error'];
  const m = { concept: concepts.includes(q.get('concept')) ? q.get('concept') : 'color', view: q.get('view') === 'reader' ? 'reader' : 'feed', state: states.includes(q.get('state')) ? q.get('state') : 'normal', query: '', origin: '', topic: '', tab: 'all', saved: new Set(), excerpts: [], expanded: new Set(), sourceId: data.sources[0].id, peekId: data.sources[0].id, selected: data.excerpt, note: '', excerptTopic: '', scroll: 0, returnId: '', composing: false, filtersOpen: false, excerptOpen: false, sourceOpen: false, sourceScroll: 0, peekOpen: false, panelScroll: 0, panelOpener: '', peekOpener: '' };
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Lucide 1.51.0 except Haedo's approved quote A; provenance: vendor/lucide/.
  const iconPaths = {
    book: '<path d="M12 5v16" /><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />',
    search: '<path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" />',
    bookmark: '<path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z" />',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />',
    plus: '<path d="M5 12h14" /><path d="M12 5v14" />',
    back: '<path d="m12 19-7-7 7-7" /><path d="M19 12H5" />',
    quote: '<path d="M10 12H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v8a6 6 0 0 1-6 6M21 12h-5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v8a6 6 0 0 1-6 6"/>',
    arrow: '<path d="M5 12h14" /><path d="m12 5 7 7-7 7" />',
    close: '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
    filter: '<path d="M10 5H3" /><path d="M12 19H3" /><path d="M14 3v4" /><path d="M16 17v4" /><path d="M21 12h-9" /><path d="M21 19h-5" /><path d="M21 5h-7" /><path d="M8 10v4" /><path d="M8 12H3" />',
    info: '<circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />',
    more: '<path d="m6 9 6 6 6-6" />',
    spark: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />',
  };
  const icon = (name, size = 20) => `<svg class="s-glyph" data-glyph="${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconPaths[name] || iconPaths.book}</svg>`;
  const current = () => data.sources.find(s => s.id === m.sourceId) || data.sources[0];
  const cover = s => ({ full: '본문 보관', partial: '일부 본문', link: '본문 미확보' }[s.coverage]);
  const origins = [...new Map(data.sources.map(s => [s.origin, s.originLabel])).entries()];
  const shortQuote = s => s.id === 'source-01' ? data.excerpt : s.paragraphs[0]?.split(/(?<=[.!?])\s/)[0] || '링크만 보관한 자료예요.';
  function toast(text) {
    $('#socialFeedback').innerHTML = `<span>${esc(text)}</span><button data-action="dismiss" aria-label="안내 닫기">${icon('close', 18)}</button>`;
    $('#socialFeedback').hidden = false;
  }
  function route() { const url = new URL(location.href); for (const key of ['concept','view','state']) url.searchParams.set(key, m[key]); history.replaceState(null,'',url); }
  function highlight(text) {
    if (!m.query) return esc(text);
    const at = text.toLocaleLowerCase('ko').indexOf(m.query.toLocaleLowerCase('ko'));
    return at < 0 ? esc(text) : esc(text.slice(0,at)) + '<mark>' + esc(text.slice(at,at + m.query.length)) + '</mark>' + esc(text.slice(at + m.query.length));
  }
  function excerptText(s) {
    if (s.coverage === 'link') return '본문을 가져오지 않은 링크예요. 출처와 보관 범위를 확인할 수 있어요.';
    const raw = s.paragraphs.find(p => m.query && p.toLocaleLowerCase('ko').includes(m.query.toLocaleLowerCase('ko'))) || s.paragraphs[0];
    const pos = m.query ? raw.toLocaleLowerCase('ko').indexOf(m.query.toLocaleLowerCase('ko')) : 0;
    const start = Math.max(0,pos - 25), length = m.concept === 'color' ? 90 : m.concept === 'thread' ? 175 : 115;
    return (start ? '…' : '') + raw.slice(start,start + length) + (raw.length > start + length ? '…' : '');
  }
  function filtered() {
    return data.sources.filter(s => (!m.query || [s.title,...s.paragraphs].join('\n').toLocaleLowerCase('ko').includes(m.query.toLocaleLowerCase('ko'))) && (!m.origin || s.origin === m.origin) && (!m.topic || s.topic === m.topic) && (m.tab === 'all' || m.tab === 'saved' && m.saved.has(s.id) || m.tab === 'excerpts' && m.excerpts.some(e => e.sourceId === s.id)));
  }
  function iconButton(label, glyph, attributes = '', extraClass = '') {
    return `<button class="s-icon ${extraClass}" aria-label="${esc(label)}" data-tip="${esc(label)}" ${attributes}>${icon(glyph)}</button>`;
  }
  function navItem(label, glyph, tab) {
    return iconButton(label, glyph, `data-tab="${tab}" ${m.tab === tab ? 'aria-current="page"' : ''}`, 's-nav-item');
  }
  function navItems() {
    return navItem('모아보기','book','all') + iconButton('검색','search','data-action="search"') + navItem('다시 볼 자료','bookmark','saved') + navItem('내 발췌','quote','excerpts') + iconButton('자료 가져오기','plus','data-action="import"');
  }
  function nav() {
    return `<aside class="s-nav"><div class="s-brand" aria-label="해도">${icon('spark')}</div><nav class="s-nav-links" aria-label="내 자료 탐색">${navItems()}</nav></aside>`;
  }
  function bottom() { return `<nav class="s-bottom" aria-label="하단 탐색">${navItems()}</nav>`; }
  function topicButtons() {
    return `<div class="s-topics" role="group" aria-label="주제로 좁히기">${['',...data.topics].map(topic => `<button class="s-topic" data-topic="${esc(topic)}" aria-pressed="${m.topic === topic}">${esc(topic || '전체 주제')}</button>`).join('')}</div>`;
  }
  function peekCard() {
    const s = data.sources.find(item => item.id === m.peekId) || data.sources[0];
    return `<section class="s-preview" id="socialPeek" aria-label="선택한 자료 미리보기" ${m.peekOpen ? '' : 'hidden'}><div class="s-panel-head"><h2 id="peekTitle" tabindex="-1">미리보기</h2>${iconButton('미리보기 닫기','close','data-action="close-preview"')}</div><span class="s-tag">${esc(s.originLabel)} · ${cover(s)}</span><h3>${esc(s.title)}</h3><p>${esc(shortQuote(s))}</p><button class="s-button" data-open="${s.id}">원문 읽기 ${icon('arrow',16)}</button></section>`;
  }
  function feed() {
    return `<div class="s-feed"><h1 class="s-sr">${{all:'모아보기',saved:'다시 볼 자료',excerpts:'내 발췌'}[m.tab]}</h1><div class="s-search-row"><label class="s-search">${icon('search')}<input type="search" id="socialSearch" aria-label="제목이나 본문 검색" placeholder="기억나는 문장 찾기" value="${esc(m.query)}" autocomplete="off"></label>${iconButton('검색 필터','filter',`id="filterToggle" aria-expanded="${m.filtersOpen}" aria-controls="socialFilters"`)}</div><section class="s-filter-panel" id="socialFilters" aria-label="검색 필터" ${m.filtersOpen ? '' : 'hidden'}><label>출처<select id="socialOrigin" class="s-origin" aria-label="출처로 좁히기"><option value="">모든 출처</option>${origins.map(([value,name]) => `<option value="${value}" ${m.origin === value ? 'selected' : ''}>${name}</option>`).join('')}</select></label>${topicButtons()}</section>${m.concept === 'pulse' ? peekCard() : ''}<div id="socialResults"></div></div>`;
  }
  function bookmark(s) {
    const active = m.saved.has(s.id), label = active ? '다시 볼 자료에서 빼기' : '다시 볼 자료에 담기';
    return `<button class="s-icon s-action" data-save="${s.id}" aria-pressed="${active}" aria-label="${esc(s.title)} ${label}" data-tip="${label}">${icon('bookmark')}</button>`;
  }
  function post(s) {
    const expanded = m.expanded.has(s.id), connected = m.excerpts.filter(e => e.sourceId === s.id);
    return `<article class="s-post" data-source-id="${s.id}" data-selected="${m.peekOpen && s.id === m.peekId}"><div class="s-post-head"><span>${esc(s.originLabel)}</span><span>${esc(s.dateLabel)}</span><span class="s-tag">${cover(s)}${s.version.includes('이전') ? ' · 이전 버전' : ''}</span></div><h2 class="s-title"><button class="s-open" data-open="${s.id}" id="social-open-${s.id}">${highlight(s.title)}</button></h2><p class="s-snippet" ${expanded ? 'hidden' : ''}>${highlight(excerptText(s))}</p><p class="s-expanded" id="expanded-${s.id}" ${expanded ? '' : 'hidden'}>${esc(s.paragraphs[0] || '')}</p><div class="s-actions">${s.coverage !== 'link' ? iconButton(expanded ? '문장 접기' : '문장 펼치기','more',`data-expand="${s.id}" aria-expanded="${expanded}" aria-controls="expanded-${s.id}"`)+iconButton('발췌','quote',`data-open="${s.id}" data-excerpt="true" aria-description="${esc(s.title)}에서 발췌"`) : ''}${m.concept === 'pulse' ? iconButton('미리보기','search',`data-preview="${s.id}" id="preview-${s.id}" aria-pressed="${m.peekOpen && m.peekId === s.id}" aria-controls="socialPeek"`) : ''}${bookmark(s)}</div>${connected.map(e => `<div class="s-inline-quote"><small>내가 고른 문장${e.topic ? ' · '+esc(e.topic) : ''}</small><p>${esc(e.quote)}</p>${e.note ? `<small style="margin-top:10px">내 생각</small><p>${esc(e.note)}</p>` : ''}</div>`).join('')}</article>`;
  }
  function stateMarkup(reader = false) {
    if (m.state === 'loading') return `<section class="s-state" role="status" aria-busy="true"><h2>${reader ? '원문을' : '자료를'} 불러오고 있어요</h2><div class="s-loading-row" aria-hidden="true"></div><div class="s-loading-row" aria-hidden="true"></div></section>`;
    if (m.state === 'error') return `<section class="s-state" role="alert"><h2>${reader ? '원문을' : '자료를'} 불러오지 못했어요</h2><p>기존 기록은 그대로예요. 다시 시도해 주세요.</p><button class="s-button s-primary" data-action="retry">다시 시도</button></section>`;
    return `<section class="s-state"><h2>${m.tab === 'saved' ? '다시 볼 자료를 골라보세요' : m.tab === 'excerpts' ? '문장에서 생각을 이어보세요' : '조건에 맞는 자료가 없어요'}</h2><p>${m.tab === 'all' ? '검색어와 출처·주제를 바꿔보세요.' : '전체 자료에서 읽고 싶은 문장을 찾아보세요.'}</p><button class="s-button s-primary" data-action="reset">전체 자료 보기</button></section>`;
  }
  function renderResults() {
    const rows = filtered();
    $('#filterToggle').dataset.active=String(Boolean(m.origin || m.topic));
    $('#socialResults').innerHTML = `<p class="s-result-count" role="status">${m.state === 'normal' ? `${rows.length}개 자료${m.origin ? ' · '+esc(origins.find(([value])=>value===m.origin)[1]) : ''}${m.topic ? ' · '+esc(m.topic) : ''}${m.query ? ' · '+esc(m.query)+' 검색' : ''}` : '자료 확인'}</p>` + (m.state !== 'normal' || !rows.length ? stateMarkup() : `<div class="s-posts">${rows.map(post).join('')}</div>`);
  }
  function reader() {
    const s = current();
    const toolbar = `<div class="s-reader-tools">${iconButton('자료로 돌아가기','back','data-action="back"')}${m.state === 'normal' ? iconButton('출처와 보관 범위','info',`id="sourceToggle" aria-expanded="${m.sourceOpen}" aria-controls="sourceDetails"`)+(s.coverage !== 'link' ? iconButton('발췌','quote',`id="excerptToggle" aria-expanded="${m.excerptOpen}" aria-controls="excerptPanel"`) : '') : ''}${bookmark(s)}</div>`;
    if (m.state !== 'normal') return `<div class="s-reader-wrap">${toolbar}${stateMarkup(true)}</div>`;
    return `<div class="s-reader-wrap">${toolbar}<article class="s-reader"><h1 id="socialReaderTitle" tabindex="-1">${esc(s.title)}</h1><div class="s-post-head"><span>${esc(s.originLabel)}</span><span>${esc(s.dateLabel)}</span><span class="s-tag">${cover(s)} · ${esc(s.version)}</span></div><section class="s-source-details" id="sourceDetails" tabindex="-1" aria-label="출처와 보관 범위" ${m.sourceOpen ? '' : 'hidden'}><dl><dt>작성일</dt><dd>${esc(s.dateLabel)}</dd><dt>가져온 날</dt><dd>${esc(s.importedLabel)}</dd><dt>원래 주소</dt><dd>${esc(s.url)} (시안용)</dd><dt>포함 범위</dt><dd>${cover(s)}. ${s.coverage === 'partial' ? esc(s.summary) : '첨부 포함 여부 미확인'}</dd></dl></section>${s.coverage === 'link' ? '<section class="s-state"><h2>이 자료에는 본문이 없어요</h2><p>링크만 보관했어요. 원문 발췌는 본문이 필요해요.</p></section>' : `<div id="sourceBody" class="s-body" tabindex="0" aria-label="읽을 원문, 문장을 선택해 발췌"><p>${s.paragraphs.map(esc).join('</p><p>')}</p></div><div class="s-end" aria-hidden="true"></div>`}</article>${s.coverage === 'link' ? '' : `<aside class="s-excerpt" id="excerptPanel" aria-label="발췌 연결" ${m.excerptOpen ? '' : 'hidden'}><div class="s-panel-head"><h2>발췌</h2>${iconButton('발췌 닫기','close','id="closeExcerpt"')}</div><p>원문에서 선택한 문장을 연결해요.</p><blockquote id="selectedQuote" aria-live="polite">${esc(m.selected)}</blockquote><label>모을 주제 · 선택<input id="excerptTopic" value="${esc(m.excerptTopic)}" placeholder="분류 없이 남겨도 괜찮아요"></label><label>내 생각 · 선택<textarea id="excerptNote" placeholder="이 문장에서 떠오른 생각">${esc(m.note)}</textarea></label><button class="s-button s-primary" id="addExcerpt">${icon('link',18)}발췌 연결</button><p class="s-help" id="excerptStatus" role="status">이 시안에만 남아요. 원문은 바뀌지 않아요.</p></aside>`}</div>`;
  }
  function setExcerpt(open, focus = true) {
    if (!$('#excerptPanel')) return;
    if (open && !m.excerptOpen) { m.panelScroll=scrollY; m.panelOpener='excerptToggle'; }
    m.excerptOpen=open; $('#excerptPanel').hidden=!open;
    $('#excerptToggle').setAttribute('aria-expanded',String(open));
    if (focus && open) $('#excerptTopic').focus();
    if (focus && !open) { document.getElementById(m.panelOpener)?.focus({preventScroll:true}); window.scrollTo(0,m.panelScroll); }
  }
  function setFilters(open, focus = false) {
    m.filtersOpen=open; $('#socialFilters').hidden=!open;
    $('#filterToggle').setAttribute('aria-expanded',String(open));
    if (focus) $('#filterToggle').focus({preventScroll:true});
  }
  function setSource(open) {
    if (open && !m.sourceOpen) m.sourceScroll=scrollY;
    m.sourceOpen=open; $('#sourceDetails').hidden=!open;
    $('#sourceToggle').setAttribute('aria-expanded',String(open));
    if (open) {
      $('#sourceDetails').focus({preventScroll:true});
      $('#sourceDetails').scrollIntoView({block:'start'});
    } else {
      $('#sourceToggle').focus({preventScroll:true});
      window.scrollTo(0,m.sourceScroll);
    }
  }
  function closePeek() {
    m.peekOpen=false; $('#socialPeek').hidden=true;
    document.querySelectorAll('[data-preview]').forEach(el=>el.setAttribute('aria-pressed','false'));
    document.querySelectorAll('.s-post').forEach(el=>el.dataset.selected='false');
    document.getElementById(m.peekOpener)?.focus({preventScroll:true}); window.scrollTo(0,m.panelScroll);
  }
  function render(focusMain = false) {
    document.body.dataset.concept = m.concept;
    document.body.dataset.view = m.view;
    for (const b of document.querySelectorAll('[data-concept]')) if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed',String(b.dataset.concept === m.concept));
    $('#socialState').value = m.state; route();
    $('#socialApp').innerHTML = `<div class="s-shell">${nav()}<main class="s-workspace" id="socialMain" tabindex="-1">${m.view === 'feed' ? feed() : reader()}</main></div>${bottom()}`;
    if (m.view === 'feed') renderResults();
    if (focusMain) $('#socialMain').focus({ preventScroll:true });
  }
  function openSource(id, anchorId, excerpt = false) {
    if (m.view === 'feed') { m.scroll = window.scrollY; m.returnId = anchorId || 'social-open-'+id; }
    m.sourceId = id; m.view = 'reader'; m.state = 'normal'; m.selected = shortQuote(current()); m.note = ''; m.excerptTopic = ''; m.excerptOpen=false; m.sourceOpen=false;
    render(); $('#socialReaderTitle')?.focus({ preventScroll:true }); window.scrollTo(0,0);
    if (excerpt) setExcerpt(true);
  }
  function toggleSave(id) {
    const active = !m.saved.has(id); active ? m.saved.add(id) : m.saved.delete(id);
    for (const el of document.querySelectorAll(`[data-save="${id}"]`)) {
      el.setAttribute('aria-pressed',String(active)); el.setAttribute('aria-label',data.sources.find(s => s.id === id).title + (active ? ' 다시 볼 자료에서 빼기' : ' 다시 볼 자료에 담기'));
      el.dataset.tip=active ? '다시 볼 자료에서 빼기' : '다시 볼 자료에 담기';
      el.classList.remove('just-saved'); void el.offsetWidth; if (active) el.classList.add('just-saved');
    }
    if (m.tab === 'saved' && m.view === 'feed' && !active) { renderResults(); $('#socialMain').focus({preventScroll:true}); }
    toast(active ? '시안의 다시 볼 자료에 담았어요.' : '시안의 다시 볼 자료에서 뺐어요. 원문은 그대로예요.');
  }
  document.addEventListener('click', event => {
    const b = event.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-concept')) { m.concept=b.dataset.concept; render(); return; }
    if (b.hasAttribute('data-preview')) {
      m.panelScroll=scrollY; m.peekOpener=b.id; m.peekOpen=true; m.peekId=b.dataset.preview; $('#socialPeek').outerHTML=peekCard();
      $('#peekTitle').focus();
      document.querySelectorAll('.s-post').forEach(el=>el.dataset.selected=String(el.dataset.sourceId===m.peekId));
      document.querySelectorAll('[data-preview]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.preview===m.peekId)));
      return;
    }
    if (b.id === 'filterToggle') { setFilters(!m.filtersOpen); return; }
    if (b.id === 'excerptToggle') { setExcerpt(!m.excerptOpen); return; }
    if (b.id === 'closeExcerpt') { setExcerpt(false); return; }
    if (b.id === 'sourceToggle') { setSource(!m.sourceOpen); return; }
    if (b.hasAttribute('data-save')) { toggleSave(b.dataset.save); return; }
    if (b.hasAttribute('data-open')) { openSource(b.dataset.open,b.id,b.dataset.excerpt === 'true'); return; }
    if (b.hasAttribute('data-topic')) {
      const preferred=b.classList.contains('s-side-topic')?'s-side-topic':'s-topic';
      const railScroll=$('.s-topics')?.scrollLeft || 0;
      m.topic=b.dataset.topic; m.view='feed'; m.state='normal'; render();
      if($('.s-topics')) $('.s-topics').scrollLeft=railScroll;
      const matches=[...document.querySelectorAll(`[data-topic="${CSS.escape(m.topic)}"]`)].filter(el=>el.getClientRects().length);
      const target=matches.find(el=>el.classList.contains(preferred)) || matches[0];
      target?.focus({preventScroll:true}); target?.scrollIntoView({block:'nearest',inline:'nearest'});
      return;
    }
    if (b.hasAttribute('data-tab')) { m.tab=b.dataset.tab; m.view='feed'; m.state='normal'; render(); [...document.querySelectorAll(`[data-tab="${m.tab}"]`)].find(el=>el.getClientRects().length)?.focus({preventScroll:true}); return; }
    if (b.hasAttribute('data-expand')) { const id=b.dataset.expand, expanded=!m.expanded.has(id); expanded ? m.expanded.add(id) : m.expanded.delete(id); b.setAttribute('aria-expanded',String(expanded)); b.setAttribute('aria-label',expanded?'문장 접기':'문장 펼치기'); b.dataset.tip=b.getAttribute('aria-label'); $('#expanded-'+id).hidden=!expanded; b.closest('.s-post').querySelector('.s-snippet').hidden=expanded; return; }
    if (b.id === 'addExcerpt') {
      if (!m.selected) { $('#excerptStatus').textContent='원문에서 문장을 선택해 주세요.'; $('#sourceBody').focus(); return; }
      m.excerpts.push({sourceId:m.sourceId,quote:m.selected,topic:m.excerptTopic,note:m.note});
      $('#excerptStatus').textContent='시안에 연결했어요. 자료로 돌아가면 발췌가 이어져 보여요.'; toast('발췌를 연결했어요. 새로고침하면 초기화돼요.'); return;
    }
    switch (b.dataset.action) {
      case 'close-preview': closePeek(); break;
      case 'back': m.view='feed'; render(); document.getElementById(m.returnId)?.focus({preventScroll:true}); window.scrollTo(0,m.scroll); break;
      case 'search': m.view='feed'; m.state='normal'; render(); $('#socialSearch').focus(); break;
      case 'reset': m.query=''; m.topic=''; m.origin=''; m.tab='all'; m.state='normal'; m.view='feed'; m.peekOpen=false; render(); $('#socialSearch').focus(); break;
      case 'retry': m.state='normal'; render(true); break;
      case 'dismiss': $('#socialFeedback').hidden=true; break;
      case 'import': toast('이번 시안은 찾기·읽기·발췌 비교예요. 가져오기는 기존 앱에서 사용할 수 있어요.'); break;
    }
  });
  $('#socialState').addEventListener('change',event => {m.state=event.target.value;render();});
  document.addEventListener('compositionstart',event => {if(event.target.id==='socialSearch')m.composing=true;});
  document.addEventListener('compositionend',event => {if(event.target.id==='socialSearch'){m.composing=false;m.query=event.target.value;renderResults();}});
  document.addEventListener('input',event => {
    if(event.target.id==='socialSearch'&&!m.composing){m.query=event.target.value;renderResults();}
    if(event.target.id==='excerptTopic')m.excerptTopic=event.target.value;
    if(event.target.id==='excerptNote')m.note=event.target.value;
  });
  document.addEventListener('change',event => {if(event.target.id==='socialOrigin'){m.origin=event.target.value;renderResults();}});
  document.addEventListener('selectionchange',() => {
    const body=$('#sourceBody'),selection=getSelection();
    if(body&&selection&&!selection.isCollapsed&&body.contains(selection.anchorNode)&&body.contains(selection.focusNode)){const text=selection.toString();if(text.trim()){m.selected=text;$('#selectedQuote').textContent=text;$('#excerptToggle').dataset.ready='true';$('#excerptToggle').dataset.tip='선택한 문장 발췌';$('#excerptToggle').setAttribute('aria-label','선택한 문장 발췌');}}
  });
  document.addEventListener('keydown',event => {
    if(event.key!=='Escape') return;
    document.body.dataset.tipsHidden='true';
    if (!$('#socialFeedback').hidden) { $('#socialFeedback').hidden=true; return; }
    if (m.view==='reader' && m.excerptOpen) { setExcerpt(false); return; }
    if (m.view==='reader' && m.sourceOpen) { setSource(false); return; }
    if (m.view==='feed' && m.peekOpen) { closePeek(); return; }
    if (m.view==='feed' && m.filtersOpen) { setFilters(false,true); return; }
    if ($('#reviewOptions').open) { $('#reviewOptions').open=false; $('#reviewOptions > summary').focus(); }
  });
  for (const name of ['pointermove','focusin']) document.addEventListener(name,()=>{delete document.body.dataset.tipsHidden;});
  render();
})();
