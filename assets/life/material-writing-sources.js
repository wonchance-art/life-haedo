/* Private exact-version material selection. Only explicit quote/link actions
 * leave this view; material notes and unselected bodies stay separate. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).MaterialWritingSources = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  function create({ host, getBundle, getPlan, isCurrent = () => true, onAdd, onRemove, onNote, onQuote, onLink, onOpenSource, onPendingChange = () => {}, view = null }) {
    const doc = host.ownerDocument, win = doc.defaultView;
    const model = () => root.HaedoLife.MaterialWriting;
    const refs = () => root.HaedoLife.SourceReference;
    const normalized = value => value.replace(/\r\n?/g, '\n');
    function sourceHint(source) {
      if (!source) return '';
      if (typeof source.url === 'string') {
        try { const url = new URL(source.url); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return source.url; } catch (_) { /* A malformed address is not a reliable source clue. */ }
      }
      const path = source.sourceKey;
      return typeof path === 'string' && path && !/^haedo:/i.test(path) && !/^(?:[a-f\d]{32,64}|[a-f\d-]{36})$/i.test(path) ? path : '';
    }
    const labelled = (title, hint) => title + (hint ? ' · 출처: ' + hint : '');
    const el = (tag, text, cls) => { const n = doc.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
    const button = (text, handler, cls = 'life-button') => {
      const n = el('button', text, cls); n.type = 'button';
      n.addEventListener('click', () => { Promise.resolve().then(handler).catch(showError); }); return n;
    };
    const field = (text, input) => { const label = el('label', null, 'life-field'); label.append(el('span', text), input); return label; };
    let stopped = false, epoch = 0, readEpoch = 0, planId = null, bundle = null, activeId = view?.activeId || null, compareId = view?.compareId || '', busy = 0, lastPending = false;
    let surface, error, search, results, candidate, tabs, compare, compareSelect, hint, searchComposing = false;
    const cards = new Map(), mq = win.matchMedia('(max-width: 760px)');
    function current(token = epoch, id = planId) { return !stopped && token === epoch && isCurrent() && host.isConnected && getPlan()?.id === id; }
    function sameMaterial(a, b) { return a && b && a.id === b.id && a.sourceId === b.sourceId && a.sourceVersionId === b.sourceVersionId && a.contentHash === b.contentHash; }
    function material(id) { return getPlan()?.materials.find(value => value.id === id); }
    function pending() { return !!busy || searchComposing || [...cards.values()].some(card => card.composing || card.invalidNote || card.range); }
    function notify() { const value = pending(); if (value !== lastPending) { lastPending = value; onPendingChange(value); } }
    function showError(cause) { if (stopped || !error?.isConnected || !isCurrent()) return; error.textContent = cause.message || '자료를 처리하지 못했습니다. 선택과 입력은 유지됩니다.'; error.hidden = false; }
    function clearError() { if (error) { error.hidden = true; error.textContent = ''; } }
    function guard() { if (!current()) throw Error('작업공간이나 준비가 바뀌었습니다.'); if (busy || searchComposing || [...cards.values()].some(card => card.composing)) throw Error('현재 처리와 한글 입력을 마친 뒤 다시 시도해 주세요.'); if ([...cards.values()].some(card => card.invalidNote)) throw Error('자료 메모의 입력 오류를 먼저 수정해 주세요. 입력은 유지됩니다.'); }
    function navigationGuard() { guard(); if ([...cards.values()].some(card => card.range)) throw Error('선택 구절을 개요에 담거나 선택 취소한 뒤 이동해 주세요.'); }
    async function task(run) { guard(); const token = epoch, id = planId; busy++; notify(); clearError(); try { await run(() => current(token, id)); } finally { busy--; notify(); } }
    function fillCandidates() {
      if (!current() || !bundle || searchComposing) return;
      results.replaceChildren(); candidate.replaceChildren();
      const query = search.value.trim().toLocaleLowerCase('ko-KR');
      if (!query) { results.append(el('p', '제목으로 보관한 원문을 찾으세요.', 'life-help')); return; }
      let count = 0, found = 0;
      for (const source of bundle.sources) {
        if (!root.HaedoLife.Core.isSourceActive(bundle, source.id)) continue;
        if (!(source.title || '').toLocaleLowerCase('ko-KR').includes(query)) continue;
        found++; if (count++ >= 20) continue;
        const title = source.title || '제목 없는 원문', clue = sourceHint(source);
        const choose = button(title, () => {
          guard(); candidate.replaceChildren();
          const versions = bundle.sourceVersions.filter(value => value.sourceId === source.id);
          if (!versions.length) { candidate.append(el('p', '보관한 원문 버전이 없습니다.', 'life-help')); return; }
          const version = el('select'); version.className = 'mw-candidate-version';
          for (const [index, value] of versions.entries()) {
            const option = el('option', '버전 ' + (index + 1) + (value.importedAt ? ' · ' + value.importedAt.slice(0, 10) : ''));
            option.value = value.id; version.append(option);
          }
          version.value = versions[versions.length - 1].id;
          const add = button('선택한 버전 추가', () => task(async valid => {
            const fresh = await getBundle(); if (!valid()) return;
            const picked = model().material(fresh, source.id, version.value, () => root.HaedoLife.Core.id());
            await onAdd(picked); if (!valid()) return;
            bundle = fresh; candidate.replaceChildren(); await refresh();
          })); add.classList.add('mw-material-add');
          candidate.append(el('p', title, 'mw-candidate-title'));
          if (clue) candidate.append(el('p', '출처: ' + clue, 'mw-source-hint'));
          candidate.append(field('추가할 정확한 원문 버전', version), add,
            button('자료 선택 취소', () => { guard(); candidate.replaceChildren(); }));
          version.focus();
        }); choose.classList.add('mw-source-candidate'); choose.dataset.sourceId = source.id; choose.setAttribute('aria-label', labelled(title, clue));
        if (clue) choose.append(el('span', '출처: ' + clue, 'mw-source-hint'));
        results.append(choose);
      }
      if (!found) results.append(el('p', '제목이 일치하는 원문이 없습니다.', 'life-empty'));
      if (found > 20) results.append(el('p', '처음 20개를 표시합니다. 제목을 더 입력해 범위를 좁히세요.', 'life-help'));
    }
    function makeCard(item, resolved) {
      const section = el('section', null, 'mw-material'); section.dataset.materialId = item.id;
      const source = resolved.source, version = resolved.version;
      const active = source && root.HaedoLife.Core.isSourceActive(bundle, source.id);
      const heading = el('h3', source?.title || '연결된 원문 없음', 'mw-material-title'); section.append(heading);
      const clue = sourceHint(source); if (clue) section.append(el('p', '출처: ' + clue, 'mw-source-hint'));
      const card = { node: section, item: { ...item }, range: null, lastLocator: null, selectionSettled: false, composing: false, invalidNote: false, body: null, note: null };
      if (resolved.status !== 'available') section.append(el('p', resolved.status === 'mismatch' ? '선택한 원문 버전의 내용이 다릅니다. 다른 버전으로 바꾸지 않았습니다.' : '선택한 원문 버전이 없습니다. 다른 버전으로 바꾸지 않았습니다.', 'mw-material-unavailable life-help'));
      else {
        const versions = bundle.sourceVersions.filter(value => value.sourceId === source.id);
        if (!active) section.append(el('p', '휴지통에 있는 자료 · 기존 근거는 유지됩니다.', 'life-help'));
        if (root.HaedoLife.Core.isEditedCopy(bundle, version.id)) section.append(el('p', '해도에서 수정한 사본', 'life-meta'));
        section.append(el('p', '버전 ' + (versions.findIndex(value => value.id === version.id) + 1) + '/' + versions.length + (version.coverage?.status === 'partial' ? ' · 일부 본문' : ''), 'life-meta'));
        const hasBody = typeof version.contentText === 'string' && version.contentText.length > 0;
        if (active && typeof onLink === 'function' && root.HaedoLife.Discovery?.canonicalUrl(source.url)) {
          const link = button('출처 링크를 글에 담기', () => {
            navigationGuard();
            return task(async valid => {
              const fresh = await getBundle(); if (!valid()) return;
              if (!sameMaterial(material(card.item.id), card.item)) throw Error('선택한 자료가 바뀌었습니다. 현재 자료를 다시 확인해 주세요.');
              const exact = model().resolveMaterial(fresh, card.item);
              if (exact.status !== 'available' || !root.HaedoLife.Core.isSourceActive(fresh, item.sourceId) || !root.HaedoLife.Discovery?.canonicalUrl(exact.source?.url)) throw Error('선택한 원문 버전과 출처 링크를 확인하지 못했습니다. 기존 글은 유지했습니다.');
              await onLink(card.item.id);
            });
          });
          link.classList.add('mw-material-link'); link.dataset.focusKey = 'material-link:' + planId + ':' + item.id; section.append(link);
        }
        if (hasBody) {
          const body = el('textarea'); body.className = 'mw-material-body'; body.readOnly = true; body.rows = 12; body.value = normalized(version.contentText);
          card.body = body; section.append(field('원문 읽기 · 인용할 구절 선택', body));
          const preview = el('blockquote', '필요한 구절만 직접 선택해 주세요.', 'mw-material-quote'); section.append(preview);
          const apply = button('선택 구절을 개요에 담기', () => task(async valid => {
            if (!card.range) throw Error('먼저 인용할 구절을 선택해 주세요.');
            const range = { ...card.range }, original = { ...item }, fresh = await getBundle();
            if (!root.HaedoLife.Core.isSourceActive(fresh, item.sourceId)) throw Error('휴지통에 있는 자료입니다. 선택은 유지됩니다. 복원한 뒤 새 구절을 담아 주세요.');
            if (!valid() || !sameMaterial(material(item.id), original)) return;
            const ref = await refs().build({ bundle: fresh, sourceId: item.sourceId, versionId: item.sourceVersionId, locator: range });
            if (!valid() || !sameMaterial(material(item.id), original)) return;
            if (ref.contentHash !== item.contentHash) throw Error('선택한 원문 버전이 바뀌었습니다. 구절 선택은 유지됩니다.');
            await onQuote(item.id, ref); if (!valid()) return;
            card.lastLocator = range; card.range = null; card.selectionSettled = true; body.setSelectionRange(body.selectionEnd, body.selectionEnd); preview.textContent = '개요에 인용을 담았습니다.'; apply.disabled = cancel.disabled = true; notify();
          })); apply.classList.add('mw-quote-apply'); apply.disabled = true;
          const cancel = button('구절 선택 취소', () => {
            guard(); card.range = null; card.selectionSettled = true; body.setSelectionRange(body.selectionEnd, body.selectionEnd); preview.textContent = '필요한 구절만 직접 선택해 주세요.'; apply.disabled = cancel.disabled = true; notify();
          }); cancel.classList.add('mw-quote-cancel'); cancel.disabled = true;
          const selection = event => {
            if (!current() || busy || !sameMaterial(material(item.id), item)) return;
            // A blur/selection task queued before adoption can restore the old native
            // textarea range after collapse. Only a fresh reading gesture reopens it.
            if (card.selectionSettled && event?.type === 'select' && event.isTrusted) return;
            card.selectionSettled = false;
            const offset = root.HaedoLife.BlogEvidence.rawOffset;
            card.range = body.selectionEnd > body.selectionStart ? { start: offset(version.contentText, body.selectionStart), end: offset(version.contentText, body.selectionEnd) } : null;
            preview.textContent = card.range ? version.contentText.slice(card.range.start, card.range.end) : '필요한 구절만 직접 선택해 주세요.';
            apply.disabled = cancel.disabled = !card.range; notify();
          };
          for (const name of ['pointerdown', 'keydown']) body.addEventListener(name, () => { card.selectionSettled = false; });
          for (const name of ['select', 'keyup', 'pointerup']) body.addEventListener(name, selection);
          const actions = el('div', null, 'mw-quote-actions'); actions.append(apply, cancel); section.append(actions);
        } else section.append(el('p', '본문이 없는 링크 자료입니다. 출처를 확인하거나 다른 자료에서 구절을 선택하세요.', 'mw-material-link-only life-help'));
        const open = button('정확한 원문 버전 열기', async () => {
          navigationGuard();
          const range = card.lastLocator && { ...card.lastLocator };
          await onOpenSource({ sourceId: item.sourceId, sourceVersionId: item.sourceVersionId, contentHash: item.contentHash, ...(range ? { locator: range } : {}), focusKey: 'material:' + planId + ':' + item.id });
        }); open.classList.add('mw-material-open'); open.dataset.focusKey = 'material:' + planId + ':' + item.id; section.append(open);
      }
      const note = el('textarea'); note.className = 'mw-material-note'; note.rows = 3; note.maxLength = 50000; note.value = item.note; card.note = note;
      section.append(field('자료 메모 · 글에 자동 포함하지 않음', note));
      note.addEventListener('compositionstart', () => { card.composing = true; notify(); });
      const changeNote = () => {
        if (!current() || !sameMaterial(material(item.id), item)) return;
        const text = note.value, token = epoch, id = planId;
        try {
          const result = onNote(item.id, text);
          if (result?.then) { card.invalidNote = true; notify(); result.then(() => { if (current(token, id) && note.value === text) { card.invalidNote = false; notify(); } }, cause => { if (current(token, id) && note.value === text) { card.invalidNote = true; notify(); showError(cause); } }); }
          else { card.invalidNote = false; notify(); }
        } catch (cause) { card.invalidNote = true; notify(); showError(cause); }
      };
      note.addEventListener('input', () => { if (!card.composing) changeNote(); });
      note.addEventListener('compositionend', () => { card.composing = false; changeNote(); notify(); });
      const remove = button('자료 연결 해제', () => task(async valid => {
        if (card.range) throw Error('선택 구절을 담거나 취소한 뒤 자료 연결을 해제해 주세요.');
        await onRemove(item.id); if (valid()) await refresh();
      })); remove.classList.add('mw-material-remove'); section.append(remove); return card;
    }
    function fillMaterials() {
      const plan = getPlan(), selected = plan.materials;
      if (!selected.some(item => item.id === activeId)) activeId = selected[0]?.id || null;
      if (!selected.some(item => item.id === compareId) || activeId === compareId) compareId = '';
      tabs.replaceChildren(); compareSelect.replaceChildren();
      const none = el('option', '비교하지 않음'); none.value = ''; compareSelect.append(none);
      for (const item of selected) {
        // Titles do not require cloning every unshown original body.
        const source = bundle.sources.find(source => source.id === item.sourceId), label = source?.title || '연결된 원문 없음', clue = sourceHint(source);
        const tab = button(label, () => {
          if (activeId === item.id) return;
          const target = cards.get(item.id);
          if (target?.range || target?.invalidNote) {
            // Returning to an unresolved, temporarily hidden comparison must
            // remain possible so its explicit cancel/correction is reachable.
            if (!current() || busy || searchComposing || [...cards.values()].some(card => card.composing)) throw Error('현재 처리와 한글 입력을 마친 뒤 자료를 바꿔 주세요.');
          } else navigationGuard();
          const previous = activeId; activeId = item.id; if (compareId === activeId) compareId = previous || ''; fillMaterials();
        });
        tab.classList.add('mw-material-tab'); tab.dataset.materialId = item.id; tab.setAttribute('aria-label', labelled(label, clue)); tab.setAttribute('aria-pressed', String(activeId === item.id));
        if (clue) tab.append(el('span', '출처: ' + clue, 'mw-source-hint')); tabs.append(tab);
        if (item.id !== activeId) { const option = el('option', labelled(label, clue)); option.value = item.id; compareSelect.append(option); }
      }
      compareSelect.value = compareId; compareSelect.disabled = selected.length < 2;
      hint.textContent = selected.length ? (mq.matches ? '위 자료 이름을 눌러 한 편씩 비교해 읽습니다.' : '필요하면 두 번째 자료를 골라 나란히 비교하세요.') : '자료를 추가하면 정확한 원문 버전을 비교할 수 있습니다.';
      // Keep a live IME target connected during viewport/keyboard changes.
      const visible = selected.filter(item => item.id === activeId || !mq.matches && item.id === compareId || cards.get(item.id)?.composing);
      const ordered = visible.sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0));
      for (const [id, card] of cards) if (!selected.some(item => sameMaterial(item, card.item))) { card.node.remove(); cards.delete(id); }
      for (const item of ordered) {
        const resolved = model().resolveMaterial(bundle, item);
        let card = cards.get(item.id);
        const state = resolved.status + ':' + (resolved.source && root.HaedoLife.Core.isSourceActive(bundle, resolved.source.id) ? 'active' : 'trash') + ':' + (resolved.version && root.HaedoLife.Core.isEditedCopy(bundle, resolved.version.id) ? 'edited' : 'original');
        if (card && card.status !== state) {
          if (card.range || card.invalidNote || card.composing) {
            if (!card.node.querySelector('.mw-material-unavailable')) card.node.prepend(el('p', '원문 연결이 바뀌었습니다. 현재 선택과 메모 입력은 유지됩니다.', 'mw-material-unavailable life-help'));
          } else { card.node.remove(); cards.delete(item.id); card = null; }
        }
        if (!card) { card = makeCard(item, resolved); card.status = state; cards.set(item.id, card); }
        if (doc.activeElement !== card.note && !card.composing && !card.invalidNote && card.note.value !== item.note) card.note.value = item.note;
        if (card.node.parentElement !== compare) compare.append(card.node);
      }
      // Detach hidden bodies: at most two originals exist in the document, regardless of vault size.
      for (const [id, card] of cards) if (!ordered.some(item => item.id === id)) card.node.remove();
      for (const item of ordered) { const node = cards.get(item.id).node; if (compare.children[ordered.indexOf(item)] !== node) compare.insertBefore(node, compare.children[ordered.indexOf(item)] || null); }
      notify();
    }
    async function refresh() {
      const plan = getPlan(); if (!plan || stopped || !isCurrent()) return;
      if (planId !== null && planId !== plan.id && pending()) throw Error('선택 구절과 입력을 마친 뒤 다른 준비를 열어 주세요.');
      if (planId !== plan.id) { epoch++; cards.clear(); compare?.replaceChildren(); if (planId !== null) { activeId = null; compareId = ''; } planId = plan.id; }
      const token = epoch, read = ++readEpoch, value = await getBundle();
      if (!current(token, plan.id) || read !== readEpoch) return;
      bundle = value; fillMaterials(); fillCandidates();
    }
    async function mount() {
      if (stopped) return;
      if (!surface) {
        surface = el('section', null, 'mw-sources'); surface.setAttribute('aria-label', '글의 자료 선택과 비교');
        error = el('p', '', 'mw-sources-error life-error'); error.setAttribute('role', 'alert'); error.hidden = true;
        search = el('input'); search.type = 'search'; search.className = 'mw-source-search'; search.placeholder = '보관한 원문 제목';
        search.addEventListener('compositionstart', () => { searchComposing = true; notify(); });
        search.addEventListener('compositionend', () => { searchComposing = false; notify(); fillCandidates(); });
        search.addEventListener('input', () => { if (!searchComposing) fillCandidates(); });
        results = el('div', null, 'mw-source-candidates'); candidate = el('div', null, 'mw-source-choice'); tabs = el('div', null, 'mw-material-tabs');
        tabs.setAttribute('aria-label', '비교할 자료 선택'); hint = el('p', '', 'life-help mw-compare-hint');
        compareSelect = el('select'); compareSelect.className = 'mw-compare-select';
        compareSelect.addEventListener('change', () => { try { navigationGuard(); compareId = compareSelect.value; fillMaterials(); } catch (cause) { compareSelect.value = compareId; showError(cause); } });
        compare = el('div', null, 'mw-compare');
        surface.append(field('자료 제목 찾기', search), results, candidate, error, tabs, field('함께 비교할 자료', compareSelect), hint, compare); host.append(surface);
        mq.addEventListener('change', resized);
      }
      await refresh();
    }
    function resized() {
      if (!current() || !bundle) return;
      const unresolved = id => { const card = cards.get(id); return card && (card.range || card.invalidNote || card.composing); };
      if (mq.matches && compareId && (cards.get(compareId)?.composing && !cards.get(activeId)?.composing || unresolved(compareId) && !unresolved(activeId))) [activeId, compareId] = [compareId, activeId];
      fillMaterials();
    }
    return Object.freeze({ mount, refresh, pending, getView: () => ({ activeId, compareId }), dispose() { stopped = true; epoch++; readEpoch++; mq.removeEventListener('change', resized); cards.clear(); surface?.remove(); lastPending = false; onPendingChange(false); } });
  }
  return Object.freeze({ create });
});
