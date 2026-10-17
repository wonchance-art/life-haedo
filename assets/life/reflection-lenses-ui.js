/* Session-only reading controls. Saving remains with the existing reflection editor. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function render({ bundle, workbench, period, view, sourceRow }) {
    const model = life.ReflectionLenses, scope = model.scope(bundle, workbench, workbench.reflection.versionIds, period);
    const host = element('section', null, 'wb-lenses'); host.id = 'wbLenses';
    const title = element('h3', '선택한 글 살펴보기', 'life-sr-only'); title.id = 'wbLensesTitle'; host.setAttribute('aria-labelledby', title.id);
    const help = element('p', '선택한 내 글의 묶음·물음표 구절·전후 글을 살펴봅니다. 자동 분석이나 해석은 아닙니다.', 'life-meta');
    const tabs = element('div', null, 'life-actions'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '읽기 관점');
    const content = element('div'); content.id = 'wbLensContent';
    const facts = element('details', null, 'wb-details'); facts.append(element('summary', '살펴보는 내 글 '+scope.items.length+'개'));
    const c = scope.counts;
    facts.append(element('p', `회고 선택 ${c.selected}개 중 기간 밖 ${c.outsidePeriod}개, 원문 없음 ${c.missing}개, 타인 글 ${c.other}개, 작성자 미확인 ${c.unknownAuthor}개, 본문 미확보 ${c.noBody}개는 이 보기에서 제외했습니다.`, 'life-meta'),
      element('p', `내 글 중 작성 시기 미확인 ${c.unknownDate}개는 관심·질문에 남기고 전후 비교에서는 제외합니다. 기존 선택·원문·내보내기 범위는 바뀌지 않습니다.`, 'life-meta'));
    const kinds = [['interests','관심'],['questions','질문'],['changes','변화']];
    view.kind ||= 'interests'; view.limit ||= 40;
    function action(label, callback) { const b = element('button', label, 'life-button'); b.type = 'button'; b.addEventListener('click', callback); return b; }
    function source(item, key, quote, hideTitle = false, read = false) {
      const article = element('article', null, 'wb-lens-source'); article.dataset.lensVersion = item.versionId;
      article.append(sourceRow(item.versionId, { focusKey: 'lens:'+key+':'+item.versionId, hideTitle, isCurrent: () => host.isConnected && article.isConnected, locator: quote ? { start: quote.start, end: quote.end } : null }));
      article.append(element('p', '원문 작성일 · '+(item.date || '미확인'), 'life-meta'));
      if (quote) {
        const block = element('blockquote', quote.text, 'wb-lens-quote');
        block.dataset.start = quote.start; block.dataset.end = quote.end; article.append(block);
        if (quote.text.length > 600) {
          const key = quote.versionId + ':' + quote.start;
          view.expandedQuotes ||= {};
          const expand = action('', () => { view.expandedQuotes[key] = !view.expandedQuotes[key]; update(); });
          const hint = element('p', '', 'life-meta');
          function update() {
            const open = !!view.expandedQuotes[key];
            // Only the view is folded. The original range always identifies the entire question.
            let end = 600;
            if (/[\uD800-\uDBFF]/.test(quote.text.charAt(end - 1))) end--;
            block.textContent = open ? quote.text : quote.text.slice(0, end);
            hint.textContent = open ? '' : '긴 구절의 앞부분입니다. 전체 구절은 펼치거나 원문에서 확인할 수 있습니다.';
            expand.textContent = open ? '구절 접기' : '구절 펼치기'; expand.setAttribute('aria-expanded', String(open));
          }
          article.append(hint, expand); update();
        }
      } else {
        const d = element('details', null, 'wb-details'); d.append(element('summary','보관 본문 읽기'));
        d.addEventListener('toggle', () => { if (d.open && !d.querySelector('pre')) d.append(element('pre', item.text, 'wb-source-body')); });
        if (read) d.open = true;
        article.append(d);
      }
      return article;
    }
    function fill() {
      content.replaceChildren();
      tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === view.kind)));
      if (!scope.items.length) { content.append(element('p', '이 범위에는 본문과 작성자를 확인한 내 글이 없습니다. 회고 선택이나 작성 기간을 확인해 주세요.', 'life-empty')); return; }
      if (view.kind === 'interests') {
        content.append(element('h4', '내가 묶어 둔 관심'), element('p', '직접 만든 묶음입니다. 글의 수로 관심의 강도를 판단하지 않습니다.', 'life-meta'));
        let shown = 0, total = 0;
        for (const group of model.interests(workbench, scope.items)) {
          total += group.versionIds.length;
          const ids = group.versionIds.slice(0, Math.max(0, view.limit-shown)); shown += ids.length;
          if (!ids.length) continue;
          const section = element('section', null, 'wb-lens-group'); section.append(element('h4', group.title));
          ids.forEach(id => section.append(source(scope.items.find(item=>item.versionId===id), 'interest:'+group.id)));
          content.append(section);
        }
        more(shown < total);
      } else if (view.kind === 'questions') {
        content.append(element('h4', '글에 남긴 질문'), element('p', '물음표가 있는 구절을 원문 그대로 보여줍니다. 반복된 고민인지, 타인의 말을 인용했는지는 맥락을 확인해 주세요.', 'life-meta'));
        const result = model.questions(scope.items, view.limit);
        const seen = new Set();
        result.rows.forEach(ref => { content.append(source(scope.items.find(item=>item.versionId===ref.versionId), 'question:'+ref.start, ref, seen.has(ref.versionId))); seen.add(ref.versionId); });
        if (!result.rows.length) content.append(element('p', '물음표가 있는 구절이 없습니다. 질문이나 고민이 없었다는 뜻은 아닙니다.', 'life-empty'));
        more(result.hasMore);
      } else {
        content.append(element('h4', '두 글 비교하기'), element('p', '같은 주제를 다룬 두 글을 골라 보세요. 변화나 성장의 결론은 자동으로 만들지 않습니다.', 'life-meta'));
        const choices = scope.items.filter(item=>item.year !== null);
        const counts = new Map(), positions = new Map();
        bundle.sourceVersions.forEach(v => { const n = (counts.get(v.sourceId) || 0) + 1; counts.set(v.sourceId, n); positions.set(v.id, n); });
        const controls = element('div', null, 'wb-lens-choices'), pair = element('div');
        function compare() {
          pair.replaceChildren(); const result = model.compare(scope.items, view.first, view.second);
          pair.append(element('p', result.notice, 'life-meta'));
          result.items.forEach((item, i)=>pair.append(source(item, 'compare:'+i, undefined, false, true)));
          if (result.items.length) pair.append(element('p', '무엇이 이어지고 무엇이 달라졌나요? 다른 상황 때문에 다르게 쓴 것은 아닐까요?', 'wb-lens-prompt'));
        }
        for (const [key,label] of [['first','첫 번째 글'],['second','두 번째 글']]) {
          const wrap = element('label', label), select = element('select'); select.id = 'wbLens-'+key;
          select.append(new Option('글 선택', ''));
          choices.forEach(item=>select.append(new Option(item.year+' · '+positions.get(item.versionId)+'/'+counts.get(item.sourceId)+' 버전 · '+item.title, item.versionId)));
          select.value = choices.some(item=>item.versionId===view[key]) ? view[key] : '';
          if (!select.value) view[key] = '';
          select.addEventListener('change',()=>{view[key]=select.value;compare();}); wrap.append(select); controls.append(wrap);
        }
        content.append(controls, pair); compare();
      }
    }
    function more(needed) {
      if (!needed) return;
      if (view.limit >= 1000) { content.append(element('p','한 번에 1,000개까지 표시합니다. 회고 선택이나 작성 기간을 좁혀 주세요.','life-meta')); return; }
      const b = action('더 보기',()=>{const old = content.querySelectorAll('[data-lens-version]').length;view.limit=Math.min(1000,view.limit+40);fill();const next=content.querySelectorAll('[data-lens-version]')[old];if(next){next.tabIndex=-1;next.focus();}}); content.append(b);
    }
    kinds.forEach(([kind,label])=>{const b=action(label,()=>{view.kind=kind;view.limit=40;fill();});b.dataset.kind=kind;tabs.append(b);});
    facts.append(help);
    host.append(title, tabs, facts, content); fill(); return host;
  }
  life.ReflectionLensesUI = Object.freeze({ render });
})(globalThis);
