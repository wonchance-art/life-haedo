/* One private, frozen reading comparison. No fetch, inferred reading or reaction writes. */
(function (root) {
  'use strict';
  function create({ container, storage, getInput, isCurrent = () => true }) {
    const doc = container.ownerDocument, clone = value => structuredClone(value);
    const model = () => root.HaedoLife.DiscoveryReading;
    const language = () => root.HaedoLife.DiscoveryLanguageSettings;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const fields = ['intent', 'reading', 'helpful', 'reason'];
    const modeLabels = { latest: '최신순', related: '관심순', personal: '개인 추천' };
    const choices = {
      intent: [['', '답하지 않음'], ['yes', '읽고 싶음'], ['no', '읽고 싶지 않음']],
      reading: [['', '답하지 않음'], ['not_read', '아직 읽지 않음'], ['partial', '일부 읽음 · 초록·소개 포함'], ['full', '본문을 읽음'], ['unavailable', '원문을 열지 못함']],
      helpful: [['', '답하지 않음'], ['yes', '도움이 됨'], ['no', '도움이 되지 않음']],
      reason: [['', '선택하지 않음'], ['off_topic', '찾던 주제와 다름'], ['too_technical', '너무 전문적임'], ['already_known', '이미 아는 내용'], ['other', '기타']]
    };
    const labels = { intent: '읽기 전 의향', reading: '직접 읽은 범위', helpful: '읽은 범위에서의 도움', reason: '판단 이유 · 선택' };
    let active = false, disposed = false, suspended = false, workspaceId = null, generation = 0, readEpoch = 0, remoteEpoch = 0, remoteMax = 0;
    let saved = null, displayed = null, loaded = false, blocked = true, conflict = false, loading = false, error = '', status = '', unsubscribe = null, inflight = null, pending = null;
    let surface, summary, statusNode, errorNode, recovery, emptyHost, sessionHost, conditionHost, listsHost, articlesHost, preferenceHost, deleteHost, translationNotice;
    let preferenceSelect, preferenceSave, preferenceDiscard, clearConfirm = false, preferenceDraft = null;
    const drafts = new Map(), rows = new Map();
    function scope() { return active && !disposed && !!workspaceId && isCurrent() && container.isConnected; }
    function valid(token) { return scope() && token === generation && !suspended; }
    function usable() { return scope() && !suspended && doc.getElementById('lifeApp')?.hidden !== true; }
    const reviewOf = (profile, url) => profile?.session?.reviews.find(value => value.canonicalUrl === url);
    const valuesOf = value => Object.fromEntries(fields.map(key => [key, value?.[key] ?? null]));
    const sessionMatches = () => !!displayed && saved?.session?.id === displayed.id;
    function dirty() { return !!pending || drafts.size > 0 || !!preferenceDraft || !!inflight; }
    function fault(message) { return Object.assign(new Error(message), { code: 'discovery_reading_unsaved' }); }
    async function flush() {
      if (inflight || loading) throw fault('읽기 비교의 저장·확인이 끝난 뒤 이동해 주세요.');
      if (dirty()) throw fault('읽기 비교에 저장하지 않은 선택이 있습니다. 기록 저장 또는 선택 취소 후 이동해 주세요.');
    }
    function node(tag, text, cls) { const value = doc.createElement(tag); if (text != null) value.textContent = text; if (cls) value.className = cls; return value; }
    function button(text, id, action) {
      const value = node('button', text, 'life-button'); value.type = 'button'; if (id) value.id = id;
      value.addEventListener('click', () => { if (usable() && !value.disabled) Promise.resolve().then(action).catch(() => { if (scope()) { error = '처리하지 못했습니다. 현재 선택을 유지했습니다. 다시 확인해 주세요.'; sync(); } }); });
      return value;
    }
    function date(value) {
      const stamp = Date.parse(value); return Number.isFinite(stamp) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(stamp) : '시각 미확인';
    }
    function ensureSurface() {
      if (surface) { if (surface.parentNode !== container) container.append(surface); return; }
      surface = node('details', null, 'discovery-reading'); surface.id = 'discoveryReadingComparison';
      summary = node('summary', '읽기 비교'); summary.id = 'discoveryReadingSummary'; surface.append(summary);
      const body = node('div', null, 'discovery-reading-body');
      statusNode = node('p', '', 'life-meta'); statusNode.id = 'discoveryReadingStatus'; statusNode.setAttribute('role', 'status'); statusNode.setAttribute('aria-live', 'polite');
      errorNode = node('p', '', 'life-error'); errorNode.id = 'discoveryReadingError'; errorNode.setAttribute('role', 'alert');
      recovery = node('div', null, 'life-actions discovery-reading-recovery');
      emptyHost = node('div');
      const intro = node('p', '지금의 주제·언어·출처와 공개 목록을 고정해 소수의 글을 비교합니다. 답은 이 브라우저에 비공개로 보관합니다.', 'life-meta');
      emptyHost.append(intro, button('현재 조건으로 비교 시작', 'discoveryReadingStart', start));
      sessionHost = node('section', null, 'discovery-reading-session'); sessionHost.setAttribute('aria-label', '현재 읽기 비교');
      conditionHost = node('div'); listsHost = node('div'); listsHost.id = 'discoveryReadingLists'; articlesHost = node('div');
      translationNotice = node('p', '', 'life-meta discovery-reading-translation-notice');
      preferenceHost = node('div', null, 'discovery-reading-preference'); deleteHost = node('div', null, 'discovery-reading-delete');
      sessionHost.append(conditionHost, listsHost, translationNotice, articlesHost, preferenceHost, deleteHost);
      body.append(statusNode, errorNode, recovery, emptyHost, sessionHost); surface.append(body); container.append(surface);
    }
    function currentDraft(url) { return drafts.get(url)?.value || valuesOf(reviewOf(saved, url)); }
    function markReview(url, key, value) {
      if (!usable() || blocked || !sessionMatches()) return;
      const next = { ...currentDraft(url), [key]: value || null };
      if (!['partial', 'full'].includes(next.reading)) { next.helpful = null; next.reason = null; }
      if (same(next, valuesOf(reviewOf(saved, url)))) drafts.delete(url); else drafts.set(url, { sessionId: displayed.id, value: next });
      error = ''; status = ''; sync();
    }
    function makeRow(entry, index) {
      const article = entry.snapshot, url = article.canonicalUrl, row = node('article', null, 'discovery-reading-article'); row.dataset.readingUrl = url;
      row.append(node('h3', article.title, 'discovery-reading-title'));
      row.append(node('p', article.sourceName + (article.publishedAt ? ' · 발행 ' + date(article.publishedAt) : ' · 발행일 미확인'), 'life-meta'));
      const memberships = Object.entries(displayed.lists).filter(([, list]) => Array.isArray(list) && list.includes(url)).map(([mode, list]) => modeLabels[mode] + ' ' + (list.indexOf(url) + 1));
      row.append(node('p', memberships.join(' · ') + ' · 링크와 제목 등 당시 메타데이터만 보관', 'life-meta'));
      const links = node('div', null, 'life-actions discovery-reading-links');
      const original = node('a', '원문 읽기', 'life-button'); original.dataset.readingOpen = ''; original.target = '_blank'; original.rel = 'noopener noreferrer'; original.referrerPolicy = 'no-referrer';
      original.addEventListener('click', event => { if (!canRead(article) || original.getAttribute('href') !== originalURL(article)) event.preventDefault(); }); links.append(original);
      const translated = node('a', '', 'life-button'); translated.dataset.readingTranslate = ''; translated.dataset.discoveryTranslate = ''; translated.target = '_blank'; translated.rel = 'noopener noreferrer'; translated.referrerPolicy = 'no-referrer';
      translated.addEventListener('click', event => { if (!translationURL(article) || translated.getAttribute('href') !== translationURL(article)) { event.preventDefault(); refreshLinks(); } });
      row.append(links);
      const form = node('form', null, 'discovery-reading-form'), controls = {};
      for (const key of fields) {
        const label = node('label', null, 'life-field'), id = 'discoveryReading-' + index + '-' + key;
        label.append(node('span', labels[key])); const select = node('select'); select.id = id; select.dataset.readingField = key;
        for (const [value, text] of choices[key]) { const option = node('option', text); option.value = value; select.append(option); }
        select.addEventListener('change', () => markReview(url, key, select.value)); label.append(select); form.append(label); controls[key] = select;
      }
      const save = button('이 글의 기록 저장', null, () => saveReview(url)); save.dataset.readingSave = url;
      const discard = button('이번 선택 취소', null, () => { drafts.delete(url); if (pending?.kind === 'review' && pending.url === url) pending = null; error = ''; status = '이번 글의 선택을 취소했습니다.'; sync(); }); discard.dataset.readingDiscard = url;
      form.addEventListener('submit', event => { event.preventDefault(); saveReview(url).catch(() => {}); });
      const actions = node('div', null, 'life-actions'); actions.append(save, discard); const state = node('p', '', 'life-meta'); state.setAttribute('role', 'status'); form.append(actions, state); row.append(form);
      articlesHost.append(row); rows.set(url, { row, controls, save, discard, state, links, original, translated, article });
    }
    function frozenEvidence(session, conditions) {
      const fieldLabels = { title: '제목', tags: '태그', summary: '공개 요약', bodyText: '허용된 본문' };
      conditions.append(node('h4', '당시 선정 근거'));
      const articles = node('ol', null, 'discovery-evidence');
      for (const entry of session.articles.slice(0, 6)) {
        const item = node('li'); item.dataset.readingEvidenceUrl = entry.snapshot.canonicalUrl;
        item.append(node('p', entry.snapshot.title, 'life-meta'));
        const memberships = Object.entries(session.lists).filter(([, list]) => list?.includes(entry.snapshot.canonicalUrl)).map(([mode, list]) => modeLabels[mode] + ' ' + (list.indexOf(entry.snapshot.canonicalUrl) + 1));
        item.append(node('p', memberships.join(' · '), 'life-meta'));
        const personal = entry.personal?.evidence || [], manual = entry.reasons.slice(0, 5 - Math.min(personal.length, 3));
        for (const ref of manual) {
          item.append(node('p', '관심 표현 일치 · 관심 ‘' + ref.interestLabel + '’ · ' + fieldLabels[ref.field] + ' · ' +
            (ref.via === 'related' ? '관련 표현 ‘' + ref.matchedTerm + '’' : ref.via === 'alias' ? '연결 표현 ‘' + ref.matchedTerm + '’' : '직접 일치'), 'life-meta'));
          const quote = node('blockquote', ref.quote); quote.dataset.readingEvidenceKind = 'manual'; item.append(quote);
        }
        for (const ref of personal.slice(0, 5 - manual.length)) {
          item.append(node('p', '비교 당시 좋아요한 글 ‘' + entry.personal.sourceSnapshot.title + '’ · 보관한 ' + fieldLabels[ref.field] +
            '와 이 글의 ' + fieldLabels[ref.candidateField], 'life-meta'));
          const pair = node('blockquote'), original = node('span', ref.quote), candidate = node('span', ref.candidateQuote);
          pair.dataset.readingEvidenceKind = 'personal'; original.dataset.readingQuote = 'original'; candidate.dataset.readingQuote = 'candidate';
          pair.append(original, doc.createTextNode(' / '), candidate); item.append(pair);
        }
        if (!manual.length && !personal.length) {
          item.append(node('p', '기록된 표현 근거 없음', 'life-meta'));
        }
        if (entry.reasons.length + personal.length > 5) item.append(node('p', '기록된 표현 근거 중 5개까지 표시합니다.', 'life-meta'));
        articles.append(item);
      }
      conditions.append(articles);
    }
    function renderSession(session) {
      const focused = doc.activeElement;
      if (displayed?.id === session?.id && displayed?.rankInputSHA256 === session?.rankInputSHA256) return;
      displayed = session ? clone(session) : null; rows.clear(); articlesHost.replaceChildren(); conditionHost.replaceChildren(); listsHost.replaceChildren(); preferenceHost.replaceChildren(); deleteHost.replaceChildren(); clearConfirm = false;
      if (!session) return;
      const conditions = node('details', null, 'discovery-reading-conditions'); conditions.id = 'discoveryReadingConditions'; conditions.append(node('summary', '비교 조건·근거'));
      const c = session.conditions;
      conditions.append(node('p', '비교 시작 · ' + date(session.createdAt) + ' / 공개 목록 수집 기준 · ' + date(session.generatedAt), 'life-meta'));
      conditions.append(node('p', '주제 · ' + (c.manual.map(value => value.label).join(' · ') || '선택 없음'), 'life-meta'));
      conditions.append(node('p', '콘텐츠 언어 · ' + (c.contentLanguages === null ? '전체' : c.contentLanguages.length ? c.contentLanguages.map(code => language().CONTENT_LANGUAGE_LABELS[code] || code).join(' · ') : '선택 없음'), 'life-meta'));
      conditions.append(node('p', '출처 · ' + (session.sources.filter(source => c.sourceIds.includes(source.id)).map(source => source.name).join(' · ') || '선택 없음'), 'life-meta'));
      conditions.append(node('p', '비교 입력 · 보관 URL ' + c.knownUrlCount + '개 · 읽음/제외 ' + c.feedbackCount + '개 · 개인 추천 기준 ' + modeLabels[c.baselineMode], 'life-meta'));
      const personalStatus = { disabled: '개인 추천은 꺼져 있어 이 비교에 포함하지 않았습니다.', insufficient_signal: '개인 추천에 사용할 좋아요 근거가 없어 ' + modeLabels[c.baselineMode] + ' 기준 목록을 사용했습니다.',
        no_overlap: '좋아요 근거와 후보의 대응 표현이 반영 기준을 충족하지 않아 ' + modeLabels[c.baselineMode] + ' 기준 목록을 사용했습니다.', applied: '비교 당시의 좋아요 제목·태그와 후보의 대응 표현을 반영했습니다.' };
      conditions.append(node('p', personalStatus[session.personal.status], 'life-meta'));
      if (session.personal.policy) conditions.append(node('p', '개인 추천 표현 정책 · ' + session.personal.policy, 'life-meta'));
      conditions.append(node('p', '시작 당시의 보관·읽음/제외 조건을 유지합니다. 새 공개 목록이나 설정으로 비교하려면 현재 비교를 삭제한 뒤 시작해 주세요.', 'life-meta'));
      if (session.stale || session.sources.some(source => source.status !== 'ok' || source.stale)) conditions.append(node('p', '일부 출처의 최신 수집을 확인하지 못한 목록입니다.', 'discovery-notice'));
      frozenEvidence(session, conditions);
      conditionHost.append(conditions);
      const orders = node('details', null, 'discovery-reading-orders'); orders.append(node('summary', '목록 순서 보기'));
      for (const [mode, list] of Object.entries(session.lists)) {
        const group = node('section'); group.append(node('h4', modeLabels[mode]));
        if (!Array.isArray(list)) group.append(node('p', '이 비교에는 포함하지 않았습니다.', 'life-meta'));
        else if (!list.length) group.append(node('p', '이 조건에 맞는 후보가 없습니다.', 'life-meta'));
        else { const ol = node('ol'); list.forEach(url => ol.append(node('li', session.articles.find(item => item.snapshot.canonicalUrl === url)?.snapshot.title || url))); group.append(ol); }
        orders.append(group);
      }
      listsHost.append(orders, node('p', '각 목록 상위 2개를 비교하며 겹치는 글은 한 번만 기록합니다. 읽지 않은 글과 무응답은 도움 없음으로 계산하지 않습니다.', 'life-meta'));
      if (!session.articles.length) listsHost.append(node('p', '현재 조건에 비교할 글이 없습니다. 주제·출처·언어를 확인한 뒤 새 비교를 시작할 수 있습니다.', 'discovery-notice'));
      session.articles.forEach(makeRow);
      preferenceHost.append(node('h3', '다시 보고 싶은 목록'));
      const preferenceLabel = node('label', null, 'life-field'); preferenceLabel.append(node('span', '목록 선호 · 선택')); preferenceSelect = node('select'); preferenceSelect.id = 'discoveryReadingPreference';
      for (const [value, text] of [['', '답하지 않음'], ['latest', '최신순'], ['related', '관심순'], ['personal', '개인 추천'], ['tie', '차이 없음'], ['undecided', '판단하기 어려움']]) {
        const option = node('option', text); option.value = value; option.disabled = ['latest', 'related', 'personal'].includes(value) && !session.lists[value]?.length; preferenceSelect.append(option);
      }
      preferenceSelect.addEventListener('change', () => { if (!sessionMatches() || blocked) return; const value = preferenceSelect.value || null; preferenceDraft = value === saved.session.preference ? null : { sessionId: displayed.id, value }; error = ''; status = ''; sync(); });
      preferenceLabel.append(preferenceSelect); preferenceSave = button('목록 선호 저장', 'discoveryReadingPreferenceSave', savePreference); preferenceDiscard = button('선호 선택 취소', 'discoveryReadingPreferenceDiscard', () => { preferenceDraft = null; if (pending?.kind === 'preference') pending = null; error = ''; sync(); });
      const actions = node('div', null, 'life-actions'); actions.append(preferenceSave, preferenceDiscard); preferenceHost.append(preferenceLabel, actions);
      if (focused && container.contains(focused) && !focused.isConnected) summary.focus({ preventScroll: true });
    }
    function canRead(article) { return usable() && loaded && !blocked && sessionMatches() && displayed.articles.some(entry => entry.snapshot.canonicalUrl === article.canonicalUrl); }
    function originalURL(article) {
      try { return language().buildTranslationURL(article, 'ko') && root.HaedoLife.Discovery.canonicalUrl(article.url) === article.canonicalUrl ? article.url : null; } catch (_) { return null; }
    }
    function translationURL(article) {
      if (!canRead(article)) return null;
      const target = displayed.conditions.translationTarget;
      if (target === 'original') return null;
      try { return getInput().translationTarget === target ? language().buildTranslationURL(article, target) : null; } catch (_) { return null; }
    }
    function refreshLinks() {
      if (!surface) return;
      let target = 'original';
      if (usable() && loaded && !blocked && sessionMatches()) { try { target = getInput().translationTarget || 'original'; } catch (_) { target = null; } }
      const frozenTarget = displayed?.conditions.translationTarget || 'original';
      for (const item of rows.values()) {
        const original = canRead(item.article) && originalURL(item.article);
        if (original) { item.original.href = original; item.original.removeAttribute('aria-disabled'); item.original.removeAttribute('tabindex'); }
        else { item.original.removeAttribute('href'); item.original.setAttribute('aria-disabled', 'true'); item.original.tabIndex = -1; }
        const address = canRead(item.article) && target === frozenTarget && target !== 'original' && language().buildTranslationURL(item.article, target);
        item.translated.hidden = !address;
        if (address) { item.translated.textContent = (language().TRANSLATION_TARGET_LABELS[target] || target) + '로 번역해 열기 · Google 번역'; item.translated.href = address; item.translated.removeAttribute('aria-disabled'); item.translated.removeAttribute('tabindex'); if (item.translated.parentNode !== item.links) item.links.append(item.translated); }
        else { item.translated.removeAttribute('href'); item.translated.setAttribute('aria-disabled', 'true'); item.translated.tabIndex = -1; }
      }
      translationNotice.textContent = frozenTarget !== 'original' && target !== frozenTarget ? '현재 번역 설정이 비교 시작 때와 달라 번역 열기를 중지했습니다. 원문은 직접 열 수 있습니다.' : frozenTarget !== 'original' ? '번역 링크를 누르면 공개 원문 URL을 Google 번역으로 보냅니다. 실제 번역 결과는 서비스와 원문 사이트에 따라 다릅니다.' : '';
      translationNotice.hidden = !translationNotice.textContent;
    }
    function retryAllowed() { return !!pending && (pending.kind === 'create' ? !saved?.session : pending.kind === 'clear' ? saved?.session?.id === pending.sessionId : saved?.session?.id === pending.sessionId); }
    function sync() {
      ensureSurface(); surface.setAttribute('aria-busy', String(loading || !!inflight));
      statusNode.textContent = loading ? '보관한 읽기 비교를 확인하고 있습니다.' : status; statusNode.hidden = !statusNode.textContent;
      errorNode.textContent = error; errorNode.hidden = !error;
      emptyHost.hidden = !!displayed; sessionHost.hidden = !displayed || loading || !loaded;
      const startButton = emptyHost.querySelector('#discoveryReadingStart'); startButton.disabled = !usable() || !loaded || blocked || !!saved?.session || dirty() || loading;
      const locked = !usable() || !loaded || blocked || !sessionMatches() || loading;
      for (const [url, item] of rows) {
        const value = currentDraft(url), changed = drafts.has(url);
        for (const key of fields) { const select = item.controls[key]; if (select.value !== (value[key] || '')) select.value = value[key] || ''; select.disabled = locked || ['helpful', 'reason'].includes(key) && !['partial', 'full'].includes(value.reading); }
        item.save.disabled = locked || !changed || !!inflight; item.discard.disabled = !!inflight; item.discard.hidden = !changed;
        item.state.textContent = changed ? '아직 저장하지 않은 선택입니다.' : fields.some(key => value[key] !== null) ? '보관한 기록입니다.' : '아직 답하지 않았습니다.';
      }
      if (displayed) {
        const wanted = preferenceDraft ? preferenceDraft.value : saved?.session?.preference ?? null;
        if (preferenceSelect.value !== (wanted || '')) preferenceSelect.value = wanted || '';
        preferenceSelect.disabled = locked; preferenceSave.disabled = locked || !preferenceDraft || !!inflight; preferenceDiscard.hidden = !preferenceDraft; preferenceDiscard.disabled = !!inflight;
        deleteHost.replaceChildren();
        if (!clearConfirm) { const clear = button('이 비교 삭제', 'discoveryReadingClear', () => { clearConfirm = true; sync(); deleteHost.querySelector('#discoveryReadingClearConfirm')?.focus(); }); clear.disabled = locked || !!inflight; deleteHost.append(clear); }
        else {
          deleteHost.append(node('p', '현재 비교와 이 비교의 선택을 삭제할까요?', 'life-meta'));
          const actions = node('div', null, 'life-actions'), confirm = button('비교 삭제', 'discoveryReadingClearConfirm', clear), cancel = button('삭제 취소', 'discoveryReadingClearCancel', () => { clearConfirm = false; sync(); deleteHost.querySelector('#discoveryReadingClear')?.focus(); }); confirm.disabled = cancel.disabled = !!inflight; actions.append(confirm, cancel); deleteHost.append(actions);
        }
      }
      recovery.replaceChildren();
      if ((conflict || blocked && loaded) && !loading && !inflight) recovery.append(button('최신 비교 확인', 'discoveryReadingReload', reload));
      if (pending && !conflict && retryAllowed() && !loading && !inflight) recovery.append(button('선택 다시 저장', 'discoveryReadingRetry', retry));
      if ((dirty() || conflict) && !inflight && !loading) recovery.append(button('저장하지 않은 선택 취소', 'discoveryReadingDiscard', discardAll));
      refreshLinks();
    }
    function reconcile() {
      for (const [url, draft] of drafts) if (draft.sessionId === saved?.session?.id && same(draft.value, valuesOf(reviewOf(saved, url)))) drafts.delete(url);
      if (preferenceDraft && preferenceDraft.sessionId === saved?.session?.id && preferenceDraft.value === saved.session.preference) preferenceDraft = null;
      if (pending?.kind === 'create' && saved?.session?.id === pending.id || pending?.kind === 'clear' && !saved?.session || pending?.kind === 'review' && saved?.session?.id === pending.sessionId && same(pending.value, valuesOf(reviewOf(saved, pending.url))) || pending?.kind === 'preference' && saved?.session?.id === pending.sessionId && saved.session.preference === pending.value) pending = null;
    }
    async function readLatest() {
      const token = generation, read = ++readEpoch; loading = true; blocked = true; sync();
      try {
        const profile = await storage.readDiscoveryReading(workspaceId);
        if (!valid(token) || read !== readEpoch) return false;
        model().validate(profile);
        if (profile.workspaceId !== workspaceId || profile.revision < remoteMax || profile.revision < (saved?.revision || 0)) throw fault('최신 비교를 다시 확인해 주세요.');
        saved = clone(profile); loaded = true; reconcile();
        const staleDraft = [...drafts.values()].some(value => value.sessionId !== saved.session?.id) || preferenceDraft && preferenceDraft.sessionId !== saved.session?.id || pending && !retryAllowed();
        if (staleDraft) { blocked = true; conflict = true; error = '다른 탭에서 이 비교를 삭제하거나 바꿨습니다. 남겨 둔 선택은 새 비교에 넣지 않습니다. 선택을 취소한 뒤 현재 비교를 확인해 주세요.'; }
        else { blocked = false; conflict = false; error = ''; renderSession(saved.session); }
        return !staleDraft;
      } catch (_) { if (valid(token) && read === readEpoch) { blocked = true; conflict = true; error = '최신 읽기 비교를 확인하지 못했습니다. 선택은 유지했습니다. 최신 비교 확인을 다시 눌러 주세요.'; } return false; }
      finally { if (valid(token) && read === readEpoch) { loading = false; sync(); } }
    }
    async function reload() { if (inflight) return; await readLatest(); }
    function operationError() { return '읽기 비교를 저장하지 못했습니다. 이번 선택은 남아 있습니다. 다시 저장하거나 선택을 취소해 주세요.'; }
    async function persist(operation) {
      if (!usable() || !loaded || blocked || conflict || inflight || !saved) return;
      if (operation.kind !== 'create' && saved.session?.id !== operation.sessionId || operation.kind === 'create' && saved.session) { blocked = true; conflict = true; error = '비교가 바뀌었습니다. 최신 비교를 확인해 주세요.'; sync(); return; }
      pending = clone(operation); error = ''; status = ''; const token = generation, observed = remoteEpoch, base = saved.revision, starting = clone(saved);
      let task;
      task = Promise.resolve().then(async () => {
        try {
          let next;
          const options = { expectedRevision: base, now: new Date().toISOString() };
          if (operation.kind === 'create') next = await model().createComparison(starting, operation.input, { ...options, now: operation.now, sessionId: operation.id });
          else if (operation.kind === 'review') next = model().setReview(starting, operation.url, operation.value, options);
          else if (operation.kind === 'preference') next = model().setPreference(starting, operation.value, options);
          else next = model().clear(starting, options);
          if (!valid(token) || observed !== remoteEpoch) return;
          const result = await storage.saveDiscoveryReading(workspaceId, next, base);
          if (!valid(token)) return;
          if (result.status !== 'stored' || observed !== remoteEpoch || result.profile.revision < remoteMax || result.profile.revision < saved.revision) {
            blocked = true; conflict = true; error = '다른 탭에서 읽기 비교가 바뀌었습니다. 이번 선택을 남겼습니다. 최신 비교 확인 후 같은 비교에만 다시 저장할 수 있습니다.'; return;
          }
          model().validate(result.profile); saved = clone(result.profile); pending = null;
          if (operation.kind === 'clear') { drafts.clear(); preferenceDraft = null; clearConfirm = false; renderSession(null); status = '읽기 비교를 삭제했습니다.'; }
          else { reconcile(); renderSession(saved.session); status = operation.kind === 'create' ? '현재 조건으로 읽기 비교를 시작했습니다.' : '읽기 비교의 선택을 저장했습니다.'; }
          blocked = false; conflict = false;
        } catch (cause) { if (valid(token)) { if (/conflict/.test(cause?.code || '')) { blocked = true; conflict = true; } error = operationError(); } }
        finally { if (inflight === task) inflight = null; if (valid(token)) sync(); }
      });
      inflight = task; sync(); await task;
    }
    async function start() {
      if (!usable() || dirty() || saved?.session || blocked || !loaded) return;
      let input;
      try { input = clone(getInput()); } catch (_) { error = '뉴스의 입력·선택 저장과 목록 확인을 마친 뒤 비교를 시작해 주세요.'; sync(); return; }
      await persist({ kind: 'create', input, id: root.crypto.randomUUID(), now: new Date().toISOString() });
    }
    async function saveReview(url) {
      const draft = drafts.get(url); if (!draft) return;
      await persist({ kind: 'review', sessionId: draft.sessionId, url, value: clone(draft.value) });
    }
    async function savePreference() { if (preferenceDraft) await persist({ kind: 'preference', sessionId: preferenceDraft.sessionId, value: preferenceDraft.value }); }
    async function clear() { if (saved?.session) await persist({ kind: 'clear', sessionId: saved.session.id }); }
    async function retry() {
      if (!pending || !retryAllowed()) return;
      const operation = clone(pending);
      if (operation.kind === 'review' && drafts.get(operation.url)?.sessionId === operation.sessionId) operation.value = clone(drafts.get(operation.url).value);
      if (operation.kind === 'preference' && preferenceDraft?.sessionId === operation.sessionId) operation.value = preferenceDraft.value;
      await persist(operation);
    }
    async function discardAll() {
      if (inflight) return;
      drafts.clear(); preferenceDraft = null; pending = null; clearConfirm = false;
      if (blocked || conflict) { await readLatest(); return; }
      renderSession(saved?.session || null); status = '저장하지 않은 선택을 취소했습니다.'; error = ''; sync();
    }
    function receive(event) {
      if (!scope() || event.type !== 'discovery_reading_changed' || event.workspaceId !== workspaceId || !Number.isSafeInteger(event.revision)) return;
      if (event.local && inflight) return;
      if (event.revision <= (saved?.revision ?? -1)) return;
      remoteMax = Math.max(remoteMax, event.revision); remoteEpoch++; readEpoch++; blocked = true; loading = false;
      if (inflight || dirty()) { conflict = true; error = '다른 탭에서 읽기 비교가 바뀌었습니다. 현재 선택을 유지했습니다. 최신 비교를 확인해 주세요.'; sync(); }
      else { sync(); readLatest().catch(() => {}); }
    }
    async function render(nextWorkspaceId) {
      if (disposed) return;
      if (scope() && workspaceId === nextWorkspaceId) { sync(); return; }
      leave();
      if (workspaceId !== nextWorkspaceId) {
        workspaceId = nextWorkspaceId; saved = displayed = null; loaded = false; pending = null; drafts.clear(); rows.clear(); preferenceDraft = null; remoteMax = remoteEpoch = 0; error = status = ''; clearConfirm = false;
        surface?.remove(); surface = null;
      }
      active = true; blocked = true; loaded = false; ensureSurface(); sync();
      const token = generation; unsubscribe = storage.subscribe(workspaceId, receive);
      if (inflight) await inflight.catch(() => {});
      if (valid(token)) await readLatest();
    }
    function leave() { active = false; generation++; readEpoch++; unsubscribe?.(); unsubscribe = null; blocked = true; loading = false; refreshLinks(); }
    function suspend() { if (!active) return; suspended = true; generation++; readEpoch++; blocked = true; loading = false; refreshLinks(); }
    async function ready() { if (!scope() || doc.getElementById('lifeApp')?.hidden === true) return; suspended = false; generation++; if (inflight) await inflight.catch(() => {}); if (scope()) await readLatest(); }
    doc.addEventListener('haedo:page-suspend', suspend); doc.addEventListener('haedo:page-ready', ready);
    function dispose() { leave(); disposed = true; doc.removeEventListener('haedo:page-suspend', suspend); doc.removeEventListener('haedo:page-ready', ready); surface?.remove(); drafts.clear(); rows.clear(); saved = displayed = pending = null; }
    return Object.freeze({ render, leave, dispose, flush, dirty, refreshLinks });
  }
  (root.HaedoLife ||= {}).DiscoveryReadingUI = Object.freeze({ create });
})(globalThis);
