/* Anonymous interaction concepts. No Auth, persistence, analytics or remote API. */
(() => {
  'use strict';
  const data = globalThis.HaedoDesignData;
  const q = new URLSearchParams(location.search);
  const concepts = ['color', 'thread', 'pulse'], states = ['normal', 'empty', 'loading', 'error'];
  const m = { concept: concepts.includes(q.get('concept')) ? q.get('concept') : 'color', view: q.get('view') === 'reader' ? 'reader' : 'feed', state: states.includes(q.get('state')) ? q.get('state') : 'normal', query: '', origin: '', topic: '', tab: 'all', saved: new Set(), excerpts: [], expanded: new Set(), sourceId: data.sources[0].id, peekId: data.sources[0].id, selected: data.excerpt, note: '', excerptTopic: '', scroll: 0, returnId: '', composing: false };
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iconPaths = {
    book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z"/><path d="M12 5v15"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
    link: '<path d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0) scale(.9)"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="m11 5-7 7 7 7M4 12h16"/>',
    quote: '<path d="M4 6h6v7H5c0 3-1 4-2 5M14 6h6v7h-5c0 3-1 4-2 5"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>'
  };
  const icon = (name, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.book}</svg>`;
  const current = () => data.sources.find(s => s.id === m.sourceId) || data.sources[0];
  const cover = s => ({ full: '본문 보관', partial: '일부 본문', link: '본문 미확보' }[s.coverage]);
  const originInitial = s => ({ 'apple-notes': '메', obsidian: 'O', 'naver-blog': '블', instagram: '인' }[s.origin]);
  const origins = [...new Map(data.sources.map(s => [s.origin, s.originLabel])).entries()];
  const topicInitial = topic => topic.startsWith('읽기') ? '읽기' : topic.startsWith('걷기') ? '걷기' : topic.startsWith('자료') ? '연결' : '원문';
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
  function navItem(label, glyph, tab, mobile = false) {
    return `<button class="${mobile ? '' : 's-nav-item'}" data-tab="${tab}" aria-label="${label}" ${m.tab === tab ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>${!mobile && tab === 'saved' ? `<span class="s-count" data-saved-count>${m.saved.size}</span>` : ''}</button>`;
  }
  function nav() {
    return `<aside class="s-nav"><div class="s-brand"><span class="s-brand-mark">${icon('spark',24)}</span><span>해도</span></div><nav class="s-nav-links" aria-label="내 자료 탐색">${navItem('모아보기','book','all')}<button class="s-nav-item" data-action="search" aria-label="검색">${icon('search')}<span>검색</span></button>${navItem('다시 볼 자료','bookmark','saved')}${navItem('내 발췌','quote','excerpts')}</nav><button class="s-button s-primary" data-action="import" aria-label="자료 가져오기">${icon('plus')}<span>가져오기</span></button><p class="s-nav-foot"><b>나의 기록, 나의 공간</b>선택한 자료만 모아요.<br>공개 피드에 게시하지 않아요.</p></aside>`;
  }
  function bottom() { return `<nav class="s-bottom" aria-label="하단 탐색">${navItem('모아보기','book','all',true)}<button data-action="search" aria-label="검색">${icon('search')}<span>검색</span></button>${navItem('다시 볼 자료','bookmark','saved',true)}${navItem('내 발췌','quote','excerpts',true)}</nav>`; }
  function topicButtons() {
    return `<div class="s-topics" aria-label="주제로 좁히기">${['',...data.topics].map(topic => `<button class="s-topic" data-topic="${esc(topic)}" aria-pressed="${m.topic === topic}"><span class="s-topic-icon" aria-hidden="true">${topic ? topicInitial(topic) : icon('spark',25)}</span><span>${esc(topic || '전체 주제')}</span></button>`).join('')}</div>`;
  }
  function peekCard() {
    const s = data.sources.find(item => item.id === m.peekId) || data.sources[0];
    return `<section class="s-side-box" id="socialPeek" aria-label="선택한 자료 미리보기"><h2>선택한 원문</h2><span class="s-tag">${esc(s.originLabel)} · ${cover(s)}</span><h3 class="s-peek-title">${esc(s.title)}</h3><p>${esc(shortQuote(s))}</p><button class="s-button s-primary" data-open="${s.id}">원문 읽기 ${icon('arrow',16)}</button></section>`;
  }
  function side() {
    return `<aside class="s-side" aria-label="자료 탐색 보조">${m.concept === 'pulse' ? peekCard() : ''}<section class="s-side-box"><h2>모아볼 주제</h2>${data.topics.map(topic => `<button class="s-side-topic" data-topic="${esc(topic)}" aria-pressed="${m.topic === topic}">${esc(topic)}<span>${data.sources.filter(s => s.topic === topic).length}개</span></button>`).join('')}</section><section class="s-side-box"><h2>문장에서 시작하는 연결</h2><p>마음에 남은 문장을 골라보세요. 원문과 내 생각을 함께 다시 읽을 수 있어요.</p><button class="s-button" data-open="source-01" data-excerpt="true">발췌해 보기 ${icon('arrow',16)}</button></section><p class="s-side-note">12개의 익명 예시 자료입니다.<br>개인 기록은 불러오지 않습니다.</p></aside>`;
  }
  function feed() {
    const title = { color:'다시 읽고 싶은 기록',thread:'기록에서 이어지는 생각',pulse:'지금 찾는 기록' }[m.concept];
    return `<div class="s-top"><div><h1>${title}</h1><p>흩어진 자료를 찾고, 읽고, 연결해요.</p></div><button class="s-button s-primary" data-action="import">${icon('plus',18)}가져오기</button></div><div class="s-layout"><div class="s-center">${topicButtons()}<div class="s-search-row"><label class="s-search">${icon('search')}<input type="search" id="socialSearch" aria-label="제목이나 본문 검색" placeholder="기억나는 문장 찾기" value="${esc(m.query)}" autocomplete="off"></label><select id="socialOrigin" class="s-origin" aria-label="출처로 좁히기"><option value="">모든 출처</option>${origins.map(([value,name]) => `<option value="${value}" ${m.origin === value ? 'selected' : ''}>${name}</option>`).join('')}</select></div><div class="s-tabs" role="group" aria-label="자료 범위">${[['all','전체 자료'],['saved','다시 볼 자료'],['excerpts','내 발췌']].map(([key,label]) => `<button data-tab="${key}" aria-pressed="${m.tab === key}">${label}</button>`).join('')}</div><div id="socialResults"></div></div>${side()}</div>`;
  }
  function bookmark(s, className = 's-action') { const active = m.saved.has(s.id); return `<button class="${className}" data-save="${s.id}" aria-pressed="${active}" aria-label="${esc(s.title)} ${active ? '다시 볼 자료에서 빼기' : '다시 볼 자료에 담기'}">${icon('bookmark',20)}<span>${active ? '담았어요' : '담기'}</span></button>`; }
  function post(s) {
    const expanded = m.expanded.has(s.id), connected = m.excerpts.filter(e => e.sourceId === s.id);
    return `<article class="s-post" data-source-id="${s.id}" data-selected="${s.id === m.peekId}"><div class="s-post-head"><span class="s-avatar" aria-hidden="true">${originInitial(s)}</span><div><div class="s-post-origin">${esc(s.originLabel)}</div><div class="s-post-date">${esc(s.dateLabel)}</div></div><span class="s-tag">${cover(s)}${s.version.includes('이전') ? ' · 이전 버전' : ''}</span></div>${m.concept === 'color' ? `<button class="s-open" data-open="${s.id}" aria-label="${esc(s.title)} 원문 열기"><div class="s-quote-tile">${esc(shortQuote(s))}</div></button>` : ''}<div class="s-post-text"><h2 class="s-title"><button class="s-open" data-open="${s.id}" id="social-open-${s.id}">${highlight(s.title)}</button></h2><p class="s-snippet">${highlight(excerptText(s))}</p>${s.coverage !== 'link' ? `<button class="s-expand" data-expand="${s.id}" aria-expanded="${expanded}" aria-controls="expanded-${s.id}">${expanded ? '문장 접기' : '문장 펼치기'}</button><p class="s-expanded" id="expanded-${s.id}" ${expanded ? '' : 'hidden'}>${esc(s.paragraphs[0])}</p>` : ''}</div><div class="s-actions"><button class="s-action" data-open="${s.id}" aria-label="${esc(s.title)} 읽기">${icon('book',20)}읽기</button>${s.coverage !== 'link' ? `<button class="s-action" data-open="${s.id}" data-excerpt="true" aria-label="${esc(s.title)}에서 발췌">${icon('quote',20)}발췌${connected.length ? ` ${connected.length}` : ''}</button>` : ''}${m.concept === 'pulse' ? `<button class="s-action s-preview-action" data-preview="${s.id}" aria-pressed="${m.peekId === s.id}">${icon('search',18)}미리보기</button>` : ''}${bookmark(s)}</div>${connected.map(e => `<div class="s-inline-quote"><small>내가 고른 문장${e.topic ? ' · '+esc(e.topic) : ''}</small><p>${esc(e.quote)}</p>${e.note ? `<small style="margin-top:10px">내 생각</small><p>${esc(e.note)}</p>` : ''}</div>`).join('')}</article>`;
  }
  function stateMarkup(reader = false) {
    if (m.state === 'loading') return `<section class="s-state" role="status" aria-busy="true"><h2>${reader ? '원문을' : '자료를'} 불러오고 있어요</h2><div class="s-loading-row" aria-hidden="true"></div><div class="s-loading-row" aria-hidden="true"></div></section>`;
    if (m.state === 'error') return `<section class="s-state" role="alert"><h2>${reader ? '원문을' : '자료를'} 불러오지 못했어요</h2><p>기존 기록은 그대로예요. 다시 시도해 주세요.</p><button class="s-button s-primary" data-action="retry">다시 시도</button></section>`;
    return `<section class="s-state"><h2>${m.tab === 'saved' ? '다시 볼 자료를 골라보세요' : m.tab === 'excerpts' ? '문장에서 생각을 이어보세요' : '조건에 맞는 자료가 없어요'}</h2><p>${m.tab === 'all' ? '검색어와 출처·주제를 바꿔보세요.' : '전체 자료에서 읽고 싶은 문장을 찾아보세요.'}</p><button class="s-button s-primary" data-action="reset">전체 자료 보기</button></section>`;
  }
  function renderResults() {
    const rows = filtered();
    $('#socialResults').innerHTML = `<p class="s-result-count" role="status">${m.state === 'normal' ? `${rows.length}개 자료${m.topic ? ' · '+esc(m.topic) : ''}${m.query ? ' · '+esc(m.query)+' 검색' : ''}` : '자료 확인'}</p>` + (m.state !== 'normal' || !rows.length ? stateMarkup() : `<div class="s-posts">${rows.map(post).join('')}</div>`);
  }
  function reader() {
    const s = current();
    const tools = `<div class="s-reader-tools"><button class="s-button s-quiet" data-action="back">${icon('back',18)}자료로 돌아가기</button>${s.coverage !== 'link' ? '<a class="s-button s-quiet s-mobile-only" href="#excerptPanel">발췌 확인</a>' : ''}${bookmark(s)}</div>`;
    if (m.state !== 'normal') return tools + stateMarkup(true);
    return tools + `<div class="s-reader-grid"><article class="s-reader"><div class="s-post-head"><span class="s-avatar" aria-hidden="true">${originInitial(s)}</span><div><div class="s-post-origin">${esc(s.originLabel)}</div><div class="s-post-date">${esc(s.dateLabel)}</div></div><span class="s-tag">${cover(s)}</span></div><h1 id="socialReaderTitle" tabindex="-1">${esc(s.title)}</h1><details><summary>출처 · ${esc(s.version)} · 보관 범위</summary><dl><dt>작성일</dt><dd>${esc(s.dateLabel)}</dd><dt>가져온 날</dt><dd>${esc(s.importedLabel)}</dd><dt>원래 주소</dt><dd>${esc(s.url)} (시안용)</dd><dt>포함 범위</dt><dd>${cover(s)}. ${s.coverage === 'partial' ? esc(s.summary) : '첨부 포함 여부 미확인'}</dd></dl></details>${s.coverage === 'link' ? '<section class="s-state"><h2>이 자료에는 본문이 없어요</h2><p>링크만 보관했어요. 원문 발췌는 본문이 필요해요.</p></section>' : `<div id="sourceBody" class="s-body" tabindex="0" aria-label="읽을 원문, 문장을 선택해 발췌"><p>${s.paragraphs.map(esc).join('</p><p>')}</p></div><p class="s-result-count">가져온 원문의 끝이에요. 원문과 내 생각은 따로 보관해요.</p>`}</article>${s.coverage === 'link' ? '' : `<aside class="s-excerpt" id="excerptPanel"><h2>이 문장에서 시작해요</h2><p>원문을 선택해 발췌할 문장을 바꿔보세요.</p><blockquote id="selectedQuote" aria-live="polite">${esc(m.selected)}</blockquote><label>모을 주제 · 선택<input id="excerptTopic" value="${esc(m.excerptTopic)}" placeholder="분류 없이 남겨도 괜찮아요"></label><label>내 생각 · 선택<textarea id="excerptNote" placeholder="이 문장에서 떠오른 생각">${esc(m.note)}</textarea></label><button class="s-button s-primary" id="addExcerpt">${icon('link',18)}발췌 연결</button><p class="s-help" id="excerptStatus" role="status">이 시안에만 남아요. 원문은 바뀌지 않아요.</p><a class="s-button s-quiet s-mobile-only" href="#socialReaderTitle">원문으로 돌아가기</a></aside>`}</div>`;
  }
  function render(focusMain = false) {
    document.body.dataset.concept = m.concept;
    for (const b of document.querySelectorAll('[data-concept]')) if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed',String(b.dataset.concept === m.concept));
    $('#socialState').value = m.state; route();
    $('#socialApp').innerHTML = `<div class="s-shell">${nav()}<main class="s-workspace" id="socialMain" tabindex="-1">${m.view === 'feed' ? feed() : reader()}</main></div>${bottom()}`;
    if (m.view === 'feed') renderResults();
    if (focusMain) $('#socialMain').focus({ preventScroll:true });
  }
  function openSource(id, anchorId, excerpt = false) {
    if (m.view === 'feed') { m.scroll = window.scrollY; m.returnId = anchorId || 'social-open-'+id; }
    m.sourceId = id; m.view = 'reader'; m.state = 'normal'; m.selected = shortQuote(current()); m.note = ''; m.excerptTopic = '';
    render(); $('#socialReaderTitle')?.focus({ preventScroll:true }); window.scrollTo(0,0);
    if (excerpt && $('#excerptTopic')) { $('#excerptTopic').focus(); }
  }
  function toggleSave(id) {
    const active = !m.saved.has(id); active ? m.saved.add(id) : m.saved.delete(id);
    for (const el of document.querySelectorAll(`[data-save="${id}"]`)) {
      el.setAttribute('aria-pressed',String(active)); el.setAttribute('aria-label',data.sources.find(s => s.id === id).title + (active ? ' 다시 볼 자료에서 빼기' : ' 다시 볼 자료에 담기'));
      el.querySelector('span').textContent = active ? '담았어요' : '담기';
      el.classList.remove('just-saved'); void el.offsetWidth; if (active) el.classList.add('just-saved');
    }
    document.querySelectorAll('[data-saved-count]').forEach(el => el.textContent=m.saved.size);
    if (m.tab === 'saved' && m.view === 'feed' && !active) { renderResults(); $('#socialMain').focus({preventScroll:true}); }
    toast(active ? '시안의 다시 볼 자료에 담았어요.' : '시안의 다시 볼 자료에서 뺐어요. 원문은 그대로예요.');
  }
  document.addEventListener('click', event => {
    const b = event.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-concept')) { m.concept=b.dataset.concept; render(); return; }
    if (b.hasAttribute('data-preview')) {
      m.peekId=b.dataset.preview; $('#socialPeek').outerHTML=peekCard();
      document.querySelectorAll('.s-post').forEach(el=>el.dataset.selected=String(el.dataset.sourceId===m.peekId));
      document.querySelectorAll('[data-preview]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.preview===m.peekId)));
      return;
    }
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
    if (b.hasAttribute('data-tab')) { m.tab=b.dataset.tab; m.view='feed'; m.state='normal'; render(); document.querySelector(`.s-tabs [data-tab="${m.tab}"]`)?.focus({preventScroll:true}); return; }
    if (b.hasAttribute('data-expand')) { const id=b.dataset.expand, expanded=!m.expanded.has(id); expanded ? m.expanded.add(id) : m.expanded.delete(id); b.setAttribute('aria-expanded',String(expanded)); b.textContent=expanded?'문장 접기':'문장 펼치기'; $('#expanded-'+id).hidden=!expanded; return; }
    if (b.id === 'addExcerpt') {
      if (!m.selected) { $('#excerptStatus').textContent='원문에서 문장을 선택해 주세요.'; $('#sourceBody').focus(); return; }
      m.excerpts.push({sourceId:m.sourceId,quote:m.selected,topic:m.excerptTopic,note:m.note});
      $('#excerptStatus').textContent='시안에 연결했어요. 자료로 돌아가면 발췌가 이어져 보여요.'; toast('발췌를 연결했어요. 새로고침하면 초기화돼요.'); return;
    }
    switch (b.dataset.action) {
      case 'back': m.view='feed'; render(); document.getElementById(m.returnId)?.focus({preventScroll:true}); window.scrollTo(0,m.scroll); break;
      case 'search': m.view='feed'; m.state='normal'; render(); $('#socialSearch').focus(); break;
      case 'reset': m.query=''; m.topic=''; m.origin=''; m.tab='all'; m.state='normal'; m.view='feed'; render(); $('#socialSearch').focus(); break;
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
    if(body&&selection&&!selection.isCollapsed&&body.contains(selection.anchorNode)&&body.contains(selection.focusNode)){const text=selection.toString();if(text.trim()){m.selected=text;$('#selectedQuote').textContent=text;}}
  });
  document.addEventListener('keydown',event => {if(event.key==='Escape')$('#socialFeedback').hidden=true;});
  render();
})();
