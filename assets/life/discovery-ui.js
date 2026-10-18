/* Public article discovery. Private interests and feedback stay in this browser;
 * only the prepared same-origin public catalog is requested. No source writes. */
(function (root) {
  'use strict';
  const node = (tag, text, cls) => { const value = root.document.createElement(tag); if (text != null) value.textContent = text; if (cls) value.className = cls; return value; };
  function create({ container, storage, getBundle, isCurrent, onImport, onOpenInterests, onOpenOriginal }) {
    let active = false, disposed = false, generation = 0, workspaceId = null, surface = null;
    let current = null, client = null, unsubscribe = null, aborter = null, pendingWrite = null;
    const scope = () => !disposed && active && isCurrent() && getBundle()?.workspaceId === workspaceId;
    const valid = token => scope() && token === generation;
    const model = () => root.HaedoLife.DiscoveryProfile;
    const engine = () => root.HaedoLife.Discovery;
    const clone = value => structuredClone(value);
    function button(text, id, action, cls = '') {
      const el = node('button', text, 'life-button ' + cls); el.type = 'button'; if (id) el.id = id;
      el.addEventListener('click', () => { if (!scope() || el.disabled) return; Promise.resolve().then(action).catch(error => report(error)); });
      return el;
    }
    function report(error, text) {
      if (!scope()) return;
      current.error = text || (/scope|owner|access/.test(error?.code || '') ? '계정이나 작업공간이 바뀌었습니다. 현재 공간에서 다시 열어 주세요.' : '처리하지 못했습니다. 선택과 기존 자료는 유지했습니다. 다시 시도해 주세요.');
      draw();
    }
    function date(value, includeTime = false) {
      if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
      return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(value));
    }
    function url(value) {
      try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null; } catch (_) { return null; }
    }
    function capture(articleId, focusKey) {
      if (!current || !scope()) return;
      const focused = root.document.activeElement;
      const id = articleId || focused?.closest?.('[data-discovery-id]')?.dataset.discoveryId || current.memory?.articleId || null;
      const article = current.catalog?.feed?.articles.find(value => value.id === id);
      current.memory = { articleId: id, articleUrl: article?.canonicalUrl || focused?.closest?.('[data-discovery-url]')?.dataset.discoveryUrl || current.memory?.articleUrl || null,
        articleIndex: Math.max(0, [...(surface?.querySelectorAll('[data-discovery-id]') || [])].findIndex(el => el.dataset.discoveryId === id)),
        focusKey: focusKey || (surface?.contains(focused) ? focused.dataset.focusKey : null) || current.memory?.focusKey || null,
        scrollY: root.scrollY || 0 };
    }
    function restore() {
      const memory = current?.memory, token = generation;
      if (!memory) return;
      root.requestAnimationFrame(() => {
        if (!valid(token) || !surface?.isConnected) return;
        const all = [...surface.querySelectorAll('[data-focus-key]')];
        const articles = [...surface.querySelectorAll('[data-discovery-url]')];
        const target = all.find(el => !el.disabled && el.dataset.focusKey === memory.focusKey && (!el.closest('[data-discovery-url]') || !memory.articleUrl || el.closest('[data-discovery-url]').dataset.discoveryUrl === memory.articleUrl)) ||
          articles.find(el => el.dataset.discoveryUrl === memory.articleUrl)?.querySelector('[data-discovery-open]') ||
          articles[Math.min(memory.articleIndex || 0, articles.length - 1)]?.querySelector('[data-discovery-open]') || surface.querySelector('#discoveryUndo');
        target?.focus({ preventScroll: true });
        root.scrollTo({ top: memory.scrollY, behavior: 'instant' });
      });
    }
    function message(text) { if (scope()) { current.status = text; current.error = ''; } }
    function knownUrls() {
      return (getBundle()?.sources || []).map(source => source.url).filter(value => typeof value === 'string');
    }
    function rank() {
      if (!current?.catalog?.feed || !current.profile || !current.feedback) return null;
      return client.rank(current.catalog.feed, { profile: current.profile, knownUrls: knownUrls(), feedback: current.feedback, mode: current.mode, limit: 5 });
    }
    function busy() { return current.loading || !!pendingWrite; }
    async function persistIntent() {
      if (!scope() || !current.pending || pendingWrite || current.conflict) return;
      const token = generation, intent = current.pending;
      const candidate = intent.action === 'undo'
        ? model().undo(current.feedback, intent.article, { expectedRevision: current.feedback.revision })
        : model().setFeedback(current.feedback, intent.article, intent.kind, { expectedRevision: current.feedback.revision });
      current.error = '';
      pendingWrite = storage.saveDiscoveryProfile(workspaceId, candidate, current.feedback.revision);
      draw();
      try {
        const result = await pendingWrite;
        if (!valid(token)) return;
        if (result.status !== 'stored') {
          current.conflict = true;
          current.error = '다른 탭에서 제외한 글이 바뀌었습니다. 이번 선택은 남겨 두었습니다. 최신 내용을 확인한 뒤 다시 보관하거나 선택을 취소해 주세요.';
          return;
        }
        current.feedback = result.profile; current.pending = null; current.conflict = false;
        current.lastFeedback = intent.action === 'undo' ? null : clone(intent.article);
        message(intent.action === 'undo' ? '제외를 되돌렸습니다.' : intent.kind === 'already_read' ? '읽음으로 목록에서 제외했습니다.' : '관련 없음으로 목록에서 제외했습니다.');
      } catch (error) {
        if (valid(token)) current.error = '목록 제외를 보관하지 못했습니다. 이번 선택은 남아 있습니다. 다시 보관하거나 선택을 취소해 주세요.';
      } finally {
        pendingWrite = null;
        if (valid(token)) { draw(); restore(); }
      }
    }
    async function feedback(article, kind) {
      if (busy() || current.pending || !current.feedback) return;
      capture(article.id, 'feedback:' + article.id + ':' + kind);
      current.pending = { action: 'set', article: clone(article), kind };
      await persistIntent();
    }
    async function undo(article) {
      if (busy() || current.pending || !current.feedback) return;
      capture(article.id || article.articleId, 'open:' + (article.id || article.articleId));
      current.pending = { action: 'undo', article: clone(article) };
      await persistIntent();
    }
    async function reloadFeedback() {
      const token = generation;
      const saved = await storage.readDiscoveryProfile(workspaceId);
      if (!valid(token)) return;
      current.feedback = saved; current.conflict = false;
      message(current.pending ? '최신 제외 목록을 확인했습니다. 남겨 둔 선택을 다시 보관하거나 취소해 주세요.' : '최신 읽음·제외 선택을 반영했습니다.'); draw();
      if (current.pending) surface.querySelector('#discoveryFeedbackRetry')?.focus({ preventScroll: true }); else restore();
    }
    async function loadCatalog() {
      if (!scope() || current.loading) return;
      const token = generation;
      aborter = new AbortController(); current.loading = true; current.error = ''; draw();
      try {
        const result = await client.load({ signal: aborter.signal });
        if (!valid(token)) return;
        current.catalog = result;
        if (result.error || result.status === 'error') current.error = result.feed ? '목록을 다시 받지 못해 이전 목록을 보여 줍니다.' : '공개 글 목록을 불러오지 못했습니다. 목록 다시 불러오기를 눌러 주세요.';
      } catch (error) {
        if (valid(token) && error?.name !== 'AbortError') current.error = '공개 글 목록을 불러오지 못했습니다. 목록 다시 불러오기를 눌러 주세요.';
      } finally {
        if (valid(token)) { current.loading = false; aborter = null; draw(); restore(); }
      }
    }
    function openOriginal(event, article) {
      if (!scope()) { event.preventDefault(); return; }
      capture(article.id, 'open:' + article.id);
      if (onOpenOriginal) {
        event.preventDefault();
        try { Promise.resolve(onOpenOriginal(article)).catch(error => report(error)); } catch (error) { report(error); }
      }
    }
    async function navigate(action, article, focusKey) {
      capture(article?.id, focusKey);
      await flush();
      if (scope()) await action?.(article, current.memory ? { focusKey: current.memory.focusKey, scrollY: current.memory.scrollY } : undefined);
    }
    function sourceDetails(feed, result) {
      const details = node('details', null, 'discovery-sources'); details.open = current.sourcesOpen;
      details.addEventListener('toggle', () => { if (current) current.sourcesOpen = details.open; });
      details.append(node('summary', '출처와 목록 상태'));
      if (date(feed.generatedAt)) details.append(node('p', '목록 수집 기준 · ' + date(feed.generatedAt, true), 'life-meta'));
      const sources = result?.metadata?.sources || feed.sources || [];
      for (const source of sources) {
        const section = node('section', null, 'discovery-source'); section.append(node('h3', source.name));
        const state = source.status === 'error' ? '이번 수집 실패' : source.status === 'never_fetched' ? '수집한 글 없음' : source.stale ? '이전 수집 자료' : '수집한 목록';
        section.append(node('p', state + (date(source.lastSuccessAt) ? ' · 마지막 수집 ' + date(source.lastSuccessAt, true) : ''), 'life-meta'));
        if (source.error) section.append(node('p', String(source.error).slice(0, 300), 'life-meta'));
        if (source.rights?.label) section.append(node('p', source.rights.label, 'life-meta'));
      }
      details.append(node('p', '준비된 공개 목록에서 찾습니다. 목록 다시 불러오기는 이 목록을 다시 확인하며, 출처 사이트의 새 글 수집을 실행하지 않습니다.', 'life-meta'));
      return details;
    }
    function articleRow(item, sources) {
      const { article } = item, row = node('article', null, 'discovery-article'); row.dataset.discoveryId = article.id; row.dataset.discoveryUrl = article.canonicalUrl;
      const source = sources.find(value => value.id === article.sourceId);
      const meta = node('p', null, 'discovery-meta'); meta.append(node('span', source?.name || '출처 미확인'));
      const published = date(article.publishedAt);
      if (published && article.dateStatus === 'valid') { const time = node('time', published); time.dateTime = article.publishedAt; meta.append(time); }
      else meta.append(node('span', '발행일 미확인'));
      if (article.dateBasis === 'updated' && date(article.updatedAt)) meta.append(node('span', '수정 ' + date(article.updatedAt)));
      row.append(meta);
      const heading = node('h2', null, 'discovery-title'), original = node('a', article.title);
      original.href = url(article.url) || url(article.canonicalUrl) || '#'; original.target = '_blank'; original.rel = 'noopener noreferrer'; original.referrerPolicy = 'no-referrer';
      original.setAttribute('aria-label', article.title + ' · 새 탭에서 원문 읽기');
      original.dataset.discoveryOpen = ''; original.dataset.focusKey = 'open:' + article.id;
      original.addEventListener('click', event => openOriginal(event, article)); heading.append(original); row.append(heading);
      if (article.summary) row.append(node('p', article.summary, 'discovery-summary'));
      const reasons = item.reasons || [];
      if (current.mode === 'related' && reasons.length) {
        const reason = reasons[0], field = { title: '제목', summary: '공개 요약', bodyText: '허용된 본문', tags: '출처 태그' }[reason.field] || '공개 글';
        row.append(node('p', '보관한 관심 ‘' + reason.interestLabel + '’ · ' + field + '에 ‘' + reason.quote + '’', 'discovery-reason'));
        const evidence = node('details', null, 'discovery-evidence'); evidence.append(node('summary', '찾은 근거'));
        reasons.slice(0, 5).forEach(ref => {
          const where = { title: '제목', summary: '공개 요약', bodyText: '허용된 본문', tags: '출처 태그' }[ref.field] || '공개 글';
          evidence.append(node('p', where + ' · 관심 ‘' + ref.interestLabel + '’' + (ref.via === 'alias' ? '의 같은 표현' : ''), 'life-meta'), node('blockquote', ref.quote));
        }); if (reasons.length > 5) evidence.append(node('p', '일치한 표현 ' + reasons.length + '개 중 5개를 표시합니다.', 'life-meta')); row.append(evidence);
      }
      const coverage = article.coverage === 'full_text' ? '허용된 본문 확보' : article.coverage === 'summary' ? '공개 요약만 확보 · 원문 전체 미확보' : '링크와 제목만 확보 · 본문 미확보';
      row.append(node('p', coverage, 'discovery-coverage'));
      const actions = node('div', null, 'discovery-actions');
      const review = button(article.coverage === 'link_only' ? '링크 보관 검토' : '보관 검토', null, () => navigate(onImport, article, 'import:' + article.id), 'discovery-review-button');
      review.dataset.discoveryImport = ''; review.dataset.focusKey = 'import:' + article.id;
      const read = button('읽음', null, () => feedback(article, 'already_read'), 'discovery-quiet'); read.dataset.discoveryFeedback = 'already_read'; read.dataset.focusKey = 'feedback:' + article.id + ':already_read';
      const irrelevant = button('관련 없음', null, () => feedback(article, 'not_relevant'), 'discovery-quiet'); irrelevant.dataset.discoveryFeedback = 'not_relevant'; irrelevant.dataset.focusKey = 'feedback:' + article.id + ':not_relevant';
      read.disabled = irrelevant.disabled = !!current.pending || busy(); review.disabled = !!current.pending || !!pendingWrite;
      actions.append(review, read, irrelevant); row.append(actions); return row;
    }
    function draw() {
      if (!scope()) return;
      surface = node('section', null, 'discovery-review'); surface.id = 'discoveryReview'; surface.setAttribute('aria-busy', String(busy()));
      const interests = node('div', null, 'discovery-interests'), labels = current.profile?.manual?.map(item => item.label) || [];
      interests.append(node('p', labels.length ? '보관한 관심 · ' + labels.slice(0, 2).join(' · ') + (labels.length > 2 ? ' 외 ' + (labels.length - 2) + '개' : '') : '보관한 관심을 적으면 관련 글을 찾을 수 있습니다.', 'discovery-interest-copy'));
      const edit = button(labels.length ? '관심 확인' : '관심 적기', 'discoveryOpenInterests', () => navigate(onOpenInterests, null, 'interests'), 'discovery-quiet'); edit.dataset.focusKey = 'interests'; interests.append(edit); surface.append(interests);
      const controls = node('div', null, 'discovery-controls'), modes = node('div', null, 'discovery-modes'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '글 정렬');
      for (const [mode, label, id] of [['related', '관심순', 'discoveryRecommended'], ['latest', '최신순', 'discoveryLatest']]) {
        const action = button(label, id, () => { capture(); current.mode = mode; current.memory = null; draw(); surface.querySelector('#' + id)?.focus(); }, 'discovery-mode');
        action.setAttribute('aria-pressed', String(current.mode === mode)); modes.append(action);
      }
      const refresh = button('목록 다시 불러오기', 'discoveryRefresh', () => { capture(null, 'refresh'); return loadCatalog(); }, 'discovery-quiet'); refresh.disabled = current.loading; refresh.dataset.focusKey = 'refresh';
      controls.append(modes, refresh); surface.append(controls);
      const status = node('p', current.loading ? '공개 글 목록을 불러오고 있습니다.' : current.status, 'discovery-status'); status.id = 'discoveryStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = !status.textContent; surface.append(status);
      const error = node('p', current.error, 'life-error'); error.id = 'discoveryError'; error.setAttribute('role', 'alert'); error.hidden = !current.error; surface.append(error);
      if (current.error && !current.loading && (!current.profile || !current.feedback)) surface.append(button('다시 확인', 'discoveryRetry', render));
      if (current.pending) {
        const recovery = node('div', null, 'discovery-recovery');
        recovery.append(node('p', '남겨 둔 선택 · ' + (current.pending.action === 'undo' ? '제외 되돌리기' : current.pending.kind === 'already_read' ? '읽음' : '관련 없음') + ' · ' + (current.pending.article.title || current.pending.article.canonicalUrl), 'life-meta'));
        if (current.conflict) recovery.append(button('최신 제외 목록 확인', 'discoveryFeedbackReload', reloadFeedback));
        else { const retry = button('선택 다시 보관', 'discoveryFeedbackRetry', persistIntent); retry.disabled = !!pendingWrite; recovery.append(retry); }
        const discard = button('선택 취소', 'discoveryFeedbackDiscard', () => { current.pending = null; current.conflict = false; message('이번 선택을 취소했습니다. 보관된 제외 목록은 유지했습니다.'); draw(); restore(); }); discard.disabled = !!pendingWrite; recovery.append(discard); surface.append(recovery);
      } else if (current.lastFeedback) surface.append(button('방금 제외 되돌리기', 'discoveryUndo', () => undo(current.lastFeedback), 'discovery-quiet'));
      const feed = current.catalog?.feed, result = rank();
      if (feed) {
        const stale = current.catalog.stale || result?.metadata?.stale;
        if (stale) surface.append(node('p', '최신 상태를 확인하지 못한 출처가 있습니다. 출처와 목록 상태에서 수집 시각을 확인해 주세요.', 'discovery-notice'));
        const failed = (feed.sources || []).filter(source => source.status === 'error' || source.status === 'never_fetched');
        if (failed.length) surface.append(node('p', failed.map(source => source.name + (source.status === 'error' ? ' 수집 실패' : ' 수집 자료 없음')).join(' · '), 'discovery-notice'));
      }
      const list = node('div', null, 'discovery-list'); list.id = 'discoveryList';
      if (result) {
        const items = result.items;
        const summary = current.mode === 'related' ? items.length ? '관심과 표현이 맞는 글 ' + items.length + '개' + (items.length < 3 ? ' · 관련 글이 적어 더 채우지 않았습니다.' : '') : labels.length ? '보관한 관심과 표현이 맞는 새 글을 찾지 못했습니다.' : '관심을 적거나 최신순으로 공개 글을 둘러보세요.' : '같은 출처와 제외 조건 · 발행·수정일이 최신인 글 ' + items.length + '개';
        list.append(node('p', summary, 'discovery-count'));
        if (current.mode === 'related' && items.length) list.append(node('p', result.metadata?.limitation || '공개 글에 실제로 나타난 표현으로 찾았습니다. 같은 표현이라도 문맥은 다를 수 있습니다.', 'discovery-limitation'));
        if (!items.length && labels.length && current.mode === 'related') {
          list.append(node('p', '관심 확인에서 구체적인 관심 표현을 보관하거나 최신 글을 둘러보세요.', 'discovery-limitation'));
          list.append(button('최신 글 보기', null, () => { current.mode = 'latest'; draw(); }, 'discovery-quiet'));
        }
        items.forEach(item => list.append(articleRow(item, feed.sources || [])));
      }
      surface.append(list);
      if (current.feedback?.feedback?.length) {
        const excluded = node('details', null, 'discovery-excluded'); excluded.open = current.excludedOpen;
        excluded.addEventListener('toggle', () => { if (current) current.excludedOpen = excluded.open; });
        excluded.append(node('summary', '제외한 글 ' + current.feedback.feedback.length + '개'));
        current.feedback.feedback.forEach(entry => {
          const article = feed?.articles?.find(item => item.canonicalUrl === entry.canonicalUrl) || { id: entry.articleId, canonicalUrl: entry.canonicalUrl, title: entry.canonicalUrl };
          const row = node('div', null, 'discovery-excluded-row'); row.append(node('p', article.title), node('small', entry.kind === 'already_read' ? '읽음' : '관련 없음', 'life-meta'));
          const restoreButton = button('제외 되돌리기', null, () => undo(article), 'discovery-quiet'); restoreButton.dataset.discoveryUndo = entry.articleId; restoreButton.disabled = !!current.pending || busy(); row.append(restoreButton); excluded.append(row);
        }); surface.append(excluded);
      }
      if (feed) surface.append(sourceDetails(feed, result));
      surface.append(node('p', '관심과 읽음·제외 선택은 이 브라우저에만 보관합니다. 원문을 열기 전에는 해당 사이트에 접속하지 않습니다.', 'discovery-privacy'));
      container.replaceChildren(surface);
    }
    async function render() {
      leave(); if (disposed) return;
      active = true; const next = getBundle()?.workspaceId;
      if (next !== workspaceId) { current = null; client?.dispose(); client = null; }
      workspaceId = next; const token = generation;
      if (!current) current = { profile: null, feedback: null, catalog: null, mode: 'related', status: '', error: '', pending: null, conflict: false, lastFeedback: null, memory: null, sourcesOpen: false, excludedOpen: false, loading: true };
      client ||= engine().create(); draw();
      try {
        const [profile, feedbackProfile] = await Promise.all([storage.readInterestProfile(workspaceId), storage.readDiscoveryProfile(workspaceId)]);
        if (!valid(token)) return;
        current.profile = profile; current.feedback = feedbackProfile; current.loading = false;
        unsubscribe = storage.subscribe(workspaceId, event => {
          if (!scope()) return;
          if (event.type === 'discovery_profile_changed' && event.revision > current.feedback.revision && !pendingWrite) {
            capture();
            current.conflict = !!current.pending; current.error = '다른 탭에서 읽음·제외 선택이 바뀌었습니다. 최신 제외 목록을 확인해 주세요.'; draw();
            if (!current.pending) reloadFeedback().catch(error => report(error));
          }
          if (event.type === 'interest_profile_changed' && event.revision > current.profile.revision) {
            capture();
            storage.readInterestProfile(workspaceId).then(profile => { if (valid(token)) { current.profile = profile; message('다른 화면에서 보관한 관심을 반영했습니다.'); draw(); restore(); } }).catch(error => report(error));
          }
        });
        draw();
        if (!current.catalog) await loadCatalog(); else restore();
      } catch (error) {
        if (valid(token)) { current.loading = false; report(error, '보관한 관심이나 제외 목록을 읽지 못했습니다. 화면을 다시 열어 주세요. 기존 자료는 유지했습니다.'); }
      }
    }
    function dirty() { return !!current?.pending || !!pendingWrite; }
    async function flush() {
      if (pendingWrite) await pendingWrite.catch(() => {});
      if (current?.pending) throw Object.assign(new Error('읽음·제외 선택이 아직 보관되지 않았습니다. 선택 다시 보관 또는 선택 취소를 눌러 주세요.'), { code: 'discovery_unsaved' });
    }
    function leave() {
      if (active && surface?.isConnected && scope()) capture();
      generation++; active = false; aborter?.abort(); aborter = null; client?.cancel(); unsubscribe?.(); unsubscribe = null;
      if (current) current.loading = false;
    }
    function dispose() { leave(); disposed = true; client?.dispose(); client = null; current = null; workspaceId = null; }
    return Object.freeze({ render, refresh: render, leave, dispose, flush, dirty });
  }
  root.HaedoLife ||= {}; root.HaedoLife.DiscoveryUI = Object.freeze({ create });
})(globalThis);
