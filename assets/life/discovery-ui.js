/* Public article discovery. Private interests and feedback stay in this browser;
 * only the prepared same-origin public catalog is requested. No source writes. */
(function (root) {
  'use strict';
  const node = (tag, text, cls) => { const value = root.document.createElement(tag); if (text != null) value.textContent = text; if (cls) value.className = cls; return value; };
  function create({ container, storage, getBundle, isCurrent, onImport, onOpenInterests, onOpenOriginal }) {
    let active = false, disposed = false, generation = 0, workspaceId = null, surface = null;
    let current = null, client = null, unsubscribe = null, aborter = null, pendingWrite = null;
    const downloadUrls = new Set();
    let settingsWrite = null, topicWrite = null, actionWrite = null, languageWrite = null, timer = null, fetchEpoch = 0, suspended = false;
    const actionsModel = () => root.HaedoLife.DiscoveryActions;
    const recommendations = () => root.HaedoLife.DiscoveryRecommendations;
    const INTERVAL = 15 * 60 * 1000;
    const settingsModel = () => root.HaedoLife.DiscoverySettings;
    const languageModel = () => root.HaedoLife.DiscoveryLanguageSettings;
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
      current.memory = { articleId: id, articleUrl: focused?.closest?.('[data-discovery-url]')?.dataset.discoveryUrl || article?.canonicalUrl || current.memory?.articleUrl || null,
        articleIndex: Math.max(0, [...(surface?.querySelectorAll('[data-discovery-id]') || [])].findIndex(el => el.dataset.discoveryId === id)),
        focusKey: focusKey || (surface?.contains(focused) ? focused.dataset.focusKey : null) || current.memory?.focusKey || null,
        scrollY: root.scrollY || 0 };
    }
    function restore() {
      const memory = current?.memory, token = generation;
      if (!memory) return;
      root.requestAnimationFrame(() => {
        if (!valid(token) || !surface?.isConnected || (current.editor?.contains(root.document.activeElement) || current.languageDetails?.contains(root.document.activeElement))) return;
        const all = [...surface.querySelectorAll('[data-focus-key]')];
        const articles = [...surface.querySelectorAll('[data-discovery-url]')];
        const target = all.find(el => !el.disabled && el.getClientRects().length && el.dataset.focusKey === memory.focusKey && (!el.closest('[data-discovery-url]') || !memory.articleUrl || el.closest('[data-discovery-url]').dataset.discoveryUrl === memory.articleUrl)) ||
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
    function rankOptions() {
      return { profile: settingsModel().effectiveProfile(current.profile, desiredSettings()), knownUrls: knownUrls(), feedback: current.feedback, contentLanguages: desiredLanguages()?.contentLanguages ?? null, limit: 5 };
    }
    function rank() {
      if (!current?.catalog?.feed || !current.profile || !current.feedback || !current.settings || !current.languageSettings) return null;
      const feed = settingsModel().filterFeed(current.catalog.feed, desiredSettings()), options = rankOptions();
      if (current.mode !== 'personal' || current.personalBlocked || !current.actions?.personalizationEnabled) return client.rank(feed, { ...options, mode: current.mode === 'personal' ? current.baselineMode : current.mode });
      if (!current.personalResult) return client.rank(feed, { ...options, mode: current.baselineMode });
      const allowed = new Set(feed.articles.filter(article => engine().languageAllowed(article.language, options.contentLanguages)).map(article => article.canonicalUrl));
      const excluded = new Set([...knownUrls().map(value => engine().canonicalUrl(value)), ...current.feedback.feedback.map(entry => entry.canonicalUrl)]);
      return { ...current.personalResult, items: current.personalResult.items.filter(item => allowed.has(item.article.canonicalUrl) && !excluded.has(item.article.canonicalUrl)) };
    }
    function busy() { return current.loading || !!pendingWrite || !!settingsWrite || !!topicWrite || !!actionWrite || !!languageWrite; }
    function dropPersonal(preserveRows = false) {
      if (preserveRows && current.personalResult) {
        const { personalization, ...metadata } = current.personalResult.metadata;
        current.personalResult = { ...current.personalResult, metadata, items: current.personalResult.items.map(item => { const { personal, ...plain } = item; return plain; }) };
      } else current.personalResult = null;
      current.personalPending = true;
    }
    function blockPersonal() { current.personalBlocked = true; current.personalStopLatched = true; current.mode = current.baselineMode; dropPersonal(); }
    function applyPersonal() {
      if (!scope() || !current.catalog?.feed || languageWrite || languageDirty() || current.languageConflict || current.personalBlocked || !current.actions?.personalizationEnabled) return;
      capture(); current.collection = 'discover'; current.collectionUrls = null;
      current.personalResult = recommendations().rank(settingsModel().filterFeed(current.catalog.feed, desiredSettings()), { ...rankOptions(), actions: current.actions, mode: 'personal', baselineMode: current.baselineMode });
      current.personalInspection = recommendations().inspectSignals(current.actions, { sourceIds: settingsModel().filterFeed(current.catalog.feed, desiredSettings()).sources.map(source => source.id), contentLanguages: desiredLanguages()?.contentLanguages ?? null });
      current.mode = 'personal'; current.personalPending = false; draw(); restore();
    }
    function entryFor(article) { return current.actions?.entries.find(entry => entry.canonicalUrl === article.canonicalUrl); }
    function captured(article) {
      const source = current.catalog?.feed?.sources.find(value => value.id === article.sourceId);
      return actionsModel().capture(article, source || { id: article.sourceId, name: article.sourceName });
    }
    async function persistAction() {
      if (!scope() || !current.actionIntent || actionWrite || current.actionConflict) return;
      const token = generation, intent = current.actionIntent, options = { expectedRevision: current.actions.revision };
      let candidate;
      try {
        if (intent.type === 'reaction') candidate = actionsModel().setReaction(current.actions, intent.snapshot, intent.kind, intent.value, options);
        else if (intent.type === 'personal') candidate = actionsModel().setPersonalization(current.actions, intent.value, options);
        else if (intent.type === 'exclude') candidate = actionsModel().setExcluded(current.actions, intent.canonicalUrl, intent.value, options);
        else if (intent.type === 'forget') candidate = actionsModel().forget(current.actions, intent.canonicalUrl, options);
        else if (intent.type === 'clear') candidate = actionsModel().clear(current.actions, options);
        else candidate = actionsModel().mergeCopy(current.actions, intent.copy, options);
        current.actionError = ''; actionWrite = storage.saveDiscoveryActions(workspaceId, candidate, current.actions.revision); draw();
        const result = await actionWrite;
        if (!valid(token)) return;
        if (result.status !== 'stored') { current.actionConflict = true; blockPersonal(); current.actionError = '다른 탭에서 반응이 바뀌었습니다. 이번 선택은 남겼습니다. 최신 반응 확인 후 다시 저장해 주세요.'; return; }
        if (result.profile.revision < current.remoteActionRevision) {
          blockPersonal(); current.actionConflict = true;
          current.actionError = '저장 뒤 다른 탭에서 반응이 다시 바뀌었습니다. 이번 의도는 남겼습니다. 최신 반응 확인 후 다시 저장하거나 취소해 주세요.';
          try { const latest = await storage.readDiscoveryActions(workspaceId); if (valid(token)) current.actions = latest; }
          catch (_) { if (valid(token)) current.actionError = '저장 뒤 바뀐 반응을 확인하지 못했습니다. 개인 추천은 중지했고 이번 의도는 남겼습니다. 최신 반응 확인을 눌러 주세요.'; }
          return;
        }
        current.actions = result.profile; current.actionIntent = null; current.actionConflict = false;
        if (intent.type === 'personal' && intent.value && !current.personalOffIntent) { current.personalStopLatched = false; current.personalBlocked = false; applyPersonal(); }
        if (intent.type === 'reaction') {
          current.lastReaction = { snapshot: intent.snapshot, kind: intent.kind, value: !intent.value };
          current.personalPending = true;
          message(intent.value ? (intent.kind === 'liked' ? '좋아요한 글에 추가했습니다.' : '담은 글에 추가했습니다. 원문은 보관하지 않았습니다.') : '선택을 취소했습니다. 되돌리거나 취소한 글에서 다시 선택할 수 있습니다.');
        } else if (intent.type === 'merge') { blockPersonal(); current.collectionUrls = null; current.copyPreview = null; current.copyEnvelope = null; message('사본의 새 항목을 추가했습니다. 기존 선택은 유지했고 추천 반영은 껐습니다.'); }
        else if (intent.type === 'clear') { blockPersonal(); downloadUrls.forEach(address => URL.revokeObjectURL(address)); downloadUrls.clear(); current.copyGeneration++; current.copyReading = false; current.copyPreview = null; current.copyEnvelope = null; current.lastReaction = null; current.collectionUrls = null; message('반응과 목록을 초기화했습니다. 자료실 원문은 유지했습니다.'); }
        else if (intent.type === 'forget') { current.lastReaction = null; current.collectionUrls = current.collectionUrls?.filter(value => value !== intent.canonicalUrl) || null; message('이 글의 반응과 목록 정보를 완전히 지웠습니다. 자료실 원문은 유지했습니다.'); }
        else if (intent.type === 'exclude') message(intent.value ? '이 반응을 추천에서 제외했습니다.' : '이 좋아요를 다음 추천의 근거로 사용할 수 있습니다.');
        else if (!intent.value) message('개인 추천을 껐습니다. 좋아요·담은 목록은 유지했습니다.');
      } catch (error) { if (valid(token)) current.actionError = /too_large/.test(error?.code || '') ? '목록 보관 한도를 넘었습니다. 기존 선택과 이번 의도는 유지했습니다. 사본을 받거나 목록을 정리한 뒤 다시 시도해 주세요.' : '반응을 저장하지 못했습니다. 이번 선택은 남아 있습니다. 다시 저장하거나 선택을 취소해 주세요.'; }
      finally {
        actionWrite = null;
        if (valid(token)) {
          draw(); restore();
          if (!current.actionIntent && current.personalOffIntent) { current.personalOffIntent = false; current.actionIntent = { type: 'personal', value: false }; persistAction().catch(error => report(error)); }
        }
      }
    }
    function react(article, kind, value) {
      if (!scope() || !current.actions || actionWrite || current.actionIntent) return;
      capture(article.id, 'reaction:' + kind + ':' + article.canonicalUrl);
      if (kind === 'liked' && !value) dropPersonal(true);
      current.actionIntent = { type: 'reaction', snapshot: captured(article), kind, value };
      persistAction().catch(error => report(error));
    }
    function personalize(value) {
      if (!scope() || !current.actions) return;
      if (!value) { blockPersonal(); if (current.actionIntent || actionWrite) { current.personalOffIntent = true; draw(); return; } }
      else if (current.actionIntent || actionWrite) return;
      current.actionIntent = { type: 'personal', value }; persistAction().catch(error => report(error));
    }
    async function reloadActions() {
      const token = generation, actions = await storage.readDiscoveryActions(workspaceId);
      if (!valid(token)) return;
      current.actions = actions; current.actionConflict = false;
      current.personalBlocked = current.personalStopLatched || !actions.personalizationEnabled;
      current.actionError = current.actionIntent ? '최신 반응을 확인했습니다. 남겨 둔 선택을 다시 저장하거나 취소해 주세요.' : '';
      draw(); restore();
    }
    async function discardAction() {
      if (actionWrite) return;
      const conflict = current.actionConflict; current.actionIntent = null; current.actionError = '';
      if (conflict) await reloadActions();
      if (current.personalOffIntent) { current.personalOffIntent = false; current.actionIntent = { type: 'personal', value: false }; await persistAction(); }
      else { message('이번 선택을 취소했습니다. 개인 추천 중지는 유지합니다.'); draw(); restore(); }
    }
    function selectCollection(collection) {
      capture(); current.collection = collection; current.collectionUrls = null; current.memory = null; current.confirmForget = null; draw();
    }
    function startAction(intent) {
      if (!scope() || !current.actions || actionWrite || current.actionIntent) return;
      capture(); current.confirmForget = null; current.confirmReset = false;
      if (intent.type === 'clear' || intent.type === 'merge') blockPersonal();
      if (intent.type === 'exclude' || intent.type === 'forget') dropPersonal(true);
      current.actionIntent = intent; persistAction().catch(error => report(error));
    }
    async function exportActions() {
      const token = generation; if (actionWrite) await actionWrite.catch(() => {}); if (!valid(token)) return;
      const copy = actionsModel().exportCopy(current.actions), blob = new Blob([JSON.stringify(copy)], { type: 'application/json;charset=utf-8' });
      const address = URL.createObjectURL(blob), link = node('a'); downloadUrls.add(address); link.href = address; link.download = 'haedo-discovery-actions.json'; link.click(); root.setTimeout(() => { URL.revokeObjectURL(address); downloadUrls.delete(address); }, 1000);
      message('사본 다운로드를 요청했습니다. 실제 파일 저장 위치를 확인해 주세요. 계정 연결·원문 본문·추천 설정은 포함하지 않습니다.'); draw();
    }
    async function previewActions(file) {
      if (!scope() || !file || actionWrite || current.actionIntent) return;
      const token = generation, copyToken = ++current.copyGeneration;
      current.copyReading = true; current.copyError = ''; current.copyPreview = null; current.copyEnvelope = null; draw();
      try {
        if (file.size > actionsModel().MAX_BYTES) throw new Error('too_large');
        const bytes = await file.arrayBuffer(); if (!valid(token) || copyToken !== current.copyGeneration) return;
        const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        const preview = actionsModel().previewCopy(envelope);
        if (!valid(token) || copyToken !== current.copyGeneration) return;
        current.copyEnvelope = envelope; current.copyPreview = preview;
      } catch (_) { if (valid(token) && copyToken === current.copyGeneration) current.copyError = '사본을 확인하지 못했습니다. 해도의 좋아요·담기 JSON 사본과 파일 크기를 확인해 주세요. 기존 선택은 유지했습니다.'; }
      finally { if (valid(token) && copyToken === current.copyGeneration) { current.copyReading = false; draw(); } }
    }
    function portableControls() {
      const details = node('details', null, 'discovery-portable'); details.id = 'discoveryPortable'; details.open = current.portableOpen;
      details.addEventListener('toggle', () => { if (current) current.portableOpen = details.open; }); details.append(node('summary', '목록 사본과 초기화'));
      const controls = node('div', null, 'discovery-actions');
      const download = button('좋아요·담기 사본 받기', 'discoveryActionsExport', exportActions); download.disabled = !current.actions || !!actionWrite; controls.append(download);
      const label = node('label', '사본에서 추가', 'discovery-file-label'), file = node('input'); file.id = 'discoveryActionsFile'; file.type = 'file'; file.accept = '.json,application/json'; file.disabled = !current.actions || !!actionWrite || !!current.actionIntent; file.addEventListener('change', () => previewActions(file.files?.[0]).catch(error => report(error))); label.htmlFor = file.id; controls.append(label, file); details.append(controls);
      details.append(node('p', '이 브라우저의 목록 사본입니다. 기존 선택과 취소한 항목을 유지한 채 새 항목만 추가합니다. 가져온 좋아요는 추천에서 제외하며 개인 추천도 끕니다. 원문 본문·계정 연결은 포함하지 않습니다.', 'life-meta'));
      if (current.copyReading) details.append(node('p', '파일을 확인하고 있습니다.', 'life-meta'));
      if (current.copyError) { const error = node('p', current.copyError, 'life-error'); error.id = 'discoveryCopyError'; error.setAttribute('role', 'alert'); details.append(error); }
      if (current.copyPreview) {
        const existing = new Set(current.actions.entries.map(entry => entry.canonicalUrl)), entries = current.copyPreview.entries, kept = entries.filter(entry => existing.has(entry.canonicalUrl)).length;
        const preview = node('div', null, 'discovery-copy-preview'); preview.id = 'discoveryCopyPreview';
        preview.append(node('p', '사본 ' + entries.length + '개 · 새로 추가 ' + (entries.length - kept) + '개 · 기존 선택 유지 ' + kept + '개', 'life-meta'));
        const apply = button('기존 선택 유지하며 추가', 'discoveryCopyApply', () => startAction({ type: 'merge', copy: current.copyEnvelope })); apply.disabled = !!actionWrite || !!current.actionIntent; preview.append(apply); details.append(preview);
      }
      if (current.copyPreview || current.copyReading || current.copyError) details.append(button('파일 선택 취소', 'discoveryCopyDiscard', () => { current.copyGeneration++; current.copyReading = false; current.copyPreview = null; current.copyEnvelope = null; current.copyError = ''; draw(); }, 'discovery-quiet'));
      const reset = button('반응·목록 초기화', 'discoveryActionsReset', () => { current.confirmReset = true; draw(); }, 'discovery-quiet'); reset.disabled = !current.actions || !!actionWrite || !!current.actionIntent; details.append(reset);
      if (current.confirmReset) { details.append(node('p', '좋아요·담기·취소한 글과 개인 추천 설정을 지웁니다. 자료실 원문은 유지합니다.', 'life-meta'), button('반응·목록 초기화 확인', 'discoveryActionsResetConfirm', () => startAction({ type: 'clear' })), button('초기화 취소', 'discoveryActionsResetCancel', () => { current.confirmReset = false; draw(); }, 'discovery-quiet')); }
      return details;
    }
    function reactionControls(article) {
      const controls = node('div', null, 'discovery-reactions'), entry = entryFor(article);
      for (const [kind, title] of [['liked', '좋아요'], ['bookmarked', '담기']]) {
        const pressed = !!entry?.[kind], control = button(pressed ? title + ' 취소' : current.collection === 'cancelled' ? title + ' 복구' : title, null, () => react(article, kind, !pressed), 'discovery-reaction');
        control.dataset.discoveryReaction = kind; control.dataset.focusKey = 'reaction:' + kind + ':' + article.canonicalUrl; control.setAttribute('aria-pressed', String(pressed)); control.disabled = !current.actions || !!actionWrite || !!current.actionIntent; controls.append(control);
      }
      if (entry) {
        const exclusion = button(entry.excludedFromRecommendations ? '추천 근거로 허용' : '추천에 사용하지 않기', null, () => startAction({ type: 'exclude', canonicalUrl: entry.canonicalUrl, value: !entry.excludedFromRecommendations }), 'discovery-quiet'); exclusion.dataset.discoveryExcludePersonal = ''; exclusion.disabled = !!actionWrite || !!current.actionIntent; controls.append(exclusion);
        if (current.collection !== 'discover') {
          const forget = button('목록 정보 완전히 지우기', null, () => { current.confirmForget = entry.canonicalUrl; draw(); }, 'discovery-quiet'); forget.dataset.discoveryForget = ''; forget.disabled = !!actionWrite || !!current.actionIntent; controls.append(forget);
          if (current.confirmForget === entry.canonicalUrl) controls.append(node('p', '좋아요·담기와 복구 정보를 모두 지웁니다. 자료실 원문은 유지합니다.', 'life-meta'), button('이 글의 반응 완전히 지우기', 'discoveryForgetConfirm', () => startAction({ type: 'forget', canonicalUrl: entry.canonicalUrl })), button('지우기 취소', 'discoveryForgetCancel', () => { current.confirmForget = null; draw(); }, 'discovery-quiet'));
        }
      }
      return controls;
    }
    function actionsHeader() {
      const section = node('section', null, 'discovery-reaction-header'), tabs = node('div', null, 'discovery-collection-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '글 목록');
      for (const [collection, title, id] of [['discover', '새 글', 'discoveryDiscover'], ['liked', '좋아요한 글', 'discoveryLiked'], ['bookmarked', '담은 글', 'discoveryBookmarked'], ['cancelled', '취소한 글', 'discoveryCancelled']]) {
        const count = collection === 'discover' ? '' : ' ' + (current.actions?.entries.filter(entry => collection === 'cancelled' ? !entry.liked && !entry.bookmarked : entry[collection]).length || 0);
        const control = button(title + count, id, () => selectCollection(collection), 'discovery-mode'); control.setAttribute('aria-pressed', String(current.collection === collection)); tabs.append(control);
      }
      section.append(tabs);
      const pendingOn = current.actionIntent?.type === 'personal' && current.actionIntent.value && !current.personalOffIntent;
      const personal = checkbox('좋아요를 개인 추천에 반영', 'discoveryPersonalize', !!pendingOn || (!!current.actions?.personalizationEnabled && !current.personalBlocked), personalize);
      personal.querySelector('input').disabled = !current.actions || (!current.actions.personalizationEnabled && !pendingOn && (!!actionWrite || !!current.actionIntent)); section.append(personal);
      section.append(node('p', '담기는 다시 볼 목록이며 추천에 반영하지 않습니다.', 'life-meta'));
      if (current.personalOffIntent) section.append(node('p', '개인 추천은 즉시 중지했습니다. 남겨 둔 선택을 해결한 뒤 끄기 설정을 저장합니다.', 'life-meta'));
      if (current.actionError) { const error = node('p', current.actionError, 'life-error'); error.id = 'discoveryActionsError'; error.setAttribute('role', 'alert'); section.append(error); }
      if (current.actionIntent) {
        const recovery = node('div', null, 'discovery-recovery'); recovery.append(node('p', '남겨 둔 선택 · ' + ({ reaction: current.actionIntent.kind === 'liked' ? '좋아요' : '담기', personal: '개인 추천 ' + (current.actionIntent.value ? '켜기' : '끄기'), exclude: '추천 근거 변경', forget: '완전히 지우기', clear: '초기화', merge: '사본 추가' }[current.actionIntent.type]), 'life-meta'));
        const retry = button(current.actionConflict ? '최신 반응 확인' : '선택 다시 저장', current.actionConflict ? 'discoveryActionsReload' : 'discoveryActionsRetry', current.actionConflict ? reloadActions : persistAction); retry.disabled = !!actionWrite; recovery.append(retry);
        const discard = button('이번 선택 취소', 'discoveryActionsDiscard', discardAction, 'discovery-quiet'); discard.disabled = !!actionWrite; recovery.append(discard); section.append(recovery);
      } else if (current.lastReaction) section.append(button('방금 반응 되돌리기', 'discoveryReactionUndo', () => react(current.lastReaction.snapshot, current.lastReaction.kind, current.lastReaction.value), 'discovery-quiet'));
      return section;
    }
    function collectionResult() {
      if (!current.actions) return [];
      const matches = entry => current.collection === 'cancelled' ? !entry.liked && !entry.bookmarked : entry[current.collection];
      current.collectionUrls ||= current.actions.entries.filter(matches).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(entry => entry.canonicalUrl);
      return current.collectionUrls.map(key => current.actions.entries.find(entry => entry.canonicalUrl === key)).filter(Boolean).map(entry => ({ article: clone(entry.snapshot), reasons: [] }));
    }
    function languageDirty() { return !!current && Object.keys(current.languagePatch).length > 0; }
    function desiredLanguages() {
      if (!current?.languageSettings) return null;
      return { ...current.languageSettings, ...current.languagePatch };
    }
    function stopTranslation() {
      if (!current) return;
      current.translationBlocked = true;
      surface?.querySelectorAll('[data-discovery-translate]').forEach(link => link.remove());
    }
    function invalidateLanguageResults() { dropPersonal(); current.mode = current.baselineMode; }
    function confirmedTranslationTarget() {
      if (!current?.languageSettings || current.translationBlocked || Object.hasOwn(current.languagePatch, 'translationTarget')) return 'original';
      return current.languageSettings.translationTarget;
    }
    async function readLanguages() {
      const token = generation, read = ++current.languageReadEpoch;
      const settings = await storage.readDiscoveryLanguageSettings(workspaceId);
      if (!valid(token) || read !== current.languageReadEpoch) return false;
      if (settings.revision < current.remoteLanguageRevision || settings.revision < (current.languageSettings?.revision || 0)) {
        current.languageConflict = true; current.languageError = '더 최신의 언어 설정이 있습니다. 최신 언어 설정 확인을 다시 눌러 주세요.'; return false;
      }
      current.languageSettings = settings; current.languageVerifiedEpoch = read; return true;
    }
    async function reloadLanguages() {
      const token = generation; stopTranslation(); invalidateLanguageResults();
      try {
        if (!await readLanguages() || !valid(token) || current.languageVerifiedEpoch !== current.languageReadEpoch || current.languageSettings.revision < current.remoteLanguageRevision) return;
        current.languageConflict = false; current.languageError = '';
        current.translationBlocked = Object.hasOwn(current.languagePatch, 'translationTarget');
      } catch (_) { if (valid(token)) { current.languageConflict = true; current.languageError = '언어 설정을 확인하지 못했습니다. 번역 열기는 중지했습니다. 최신 언어 설정 확인을 다시 눌러 주세요.'; } }
      finally { if (valid(token)) draw(); }
    }
    async function persistLanguages() {
      if (!scope() || !current.languageSettings || !languageDirty() || languageWrite || current.languageConflict) return;
      const token = generation, patch = clone(current.languagePatch);
      const candidate = languageModel().update(current.languageSettings, patch, { expectedRevision: current.languageSettings.revision });
      current.languageError = ''; languageWrite = storage.saveDiscoveryLanguageSettings(workspaceId, candidate, current.languageSettings.revision); draw();
      try {
        const result = await languageWrite; if (!valid(token)) return;
        if (result.status !== 'stored' || result.settings.revision < current.remoteLanguageRevision || result.settings.revision < current.languageSettings.revision) {
          stopTranslation(); invalidateLanguageResults(); current.languageConflict = true;
          current.languageError = '다른 탭에서 언어 설정이 바뀌었습니다. 이번 선택은 남겼습니다. 최신 언어 설정 확인 후 다시 저장해 주세요.';
          await readLanguages().catch(() => false); return;
        }
        current.languageSettings = result.settings;
        for (const key of Object.keys(patch)) if (JSON.stringify(current.languagePatch[key]) === JSON.stringify(patch[key])) delete current.languagePatch[key];
        current.translationBlocked = Object.hasOwn(current.languagePatch, 'translationTarget');
        message('언어 설정을 이 브라우저에 저장했습니다.');
      } catch (_) { if (valid(token)) current.languageError = '언어 설정을 저장하지 못했습니다. 선택은 남아 있습니다. 다시 저장하거나 선택을 취소해 주세요.'; }
      finally {
        languageWrite = null;
        if (valid(token)) { draw(); if (!current.languageError && !current.languageConflict && languageDirty()) persistLanguages().catch(error => report(error)); }
      }
    }
    function changeLanguage(key, value) {
      if (!scope() || !current.languageSettings) return;
      if (key === 'translationTarget') stopTranslation();
      else invalidateLanguageResults();
      current.languagePatch[key] = clone(value); current.languageError = ''; draw(); persistLanguages().catch(error => report(error));
    }
    async function discardLanguages() {
      if (languageWrite) return;
      const token = generation;
      current.languagePatch = {}; stopTranslation(); invalidateLanguageResults();
      await reloadLanguages(); if (valid(token) && !current.languageConflict) message('이번 언어 선택을 취소하고 저장된 설정을 확인했습니다.');
      if (valid(token)) draw();
    }
    function languageControls() {
      let details = current.languageDetails;
      if (!details) {
        details = node('details', null, 'discovery-language-options'); details.id = 'discoveryLanguageOptions'; details.open = current.languageOpen;
        details.append(node('summary', '언어 옵션')); current.languageBody = node('div'); details.append(current.languageBody);
        details.addEventListener('toggle', () => { if (current && scope()) current.languageOpen = details.open; }); current.languageDetails = details;
      }
      const focused = root.document.activeElement, focusId = details.contains(focused) ? focused.id : null, desired = desiredLanguages(), body = node('div', null, 'discovery-language-body');
      const languages = node('fieldset', null, 'discovery-content-languages'); languages.id = 'discoveryContentLanguages'; languages.hidden = current.collection !== 'discover'; languages.append(node('legend', '콘텐츠 언어'));
      for (const [code, label] of [['all', '전체 언어'], ...languageModel().CONTENT_LANGUAGE_CODES.map(code => [code, languageModel().CONTENT_LANGUAGE_LABELS[code]])]) {
        const checked = code === 'all' ? desired?.contentLanguages == null : desired?.contentLanguages?.includes(code) || false;
        const control = checkbox(label, 'discoveryLanguage-' + code, checked, enabled => {
          if (code === 'all') changeLanguage('contentLanguages', enabled ? null : []);
          else { const values = new Set(desiredLanguages().contentLanguages || []); enabled ? values.add(code) : values.delete(code); changeLanguage('contentLanguages', [...values]); }
        }, 'discoveryContentLanguage', code); control.querySelector('input').disabled = !current.languageSettings; languages.append(control);
      }
      body.append(languages);
      const label = node('label', '번역해서 열 언어', 'discovery-translation-label'); label.htmlFor = 'discoveryTranslationLanguage';
      const target = node('select'); target.id = 'discoveryTranslationLanguage'; target.disabled = !current.languageSettings;
      for (const code of languageModel().TRANSLATION_TARGET_CODES) { const option = node('option', languageModel().TRANSLATION_TARGET_LABELS[code]); option.value = code; target.append(option); }
      target.value = desired?.translationTarget || 'original'; target.addEventListener('change', () => changeLanguage('translationTarget', target.value)); body.append(label, target);
      body.append(node('p', '번역 링크를 누르면 공개 원문 주소가 Google 번역으로 전달됩니다. 번역문은 보관하지 않으며 외부 서비스에서 열리지 않을 수 있습니다.', 'life-meta'));
      if (languageWrite) body.append(node('p', '언어 설정을 저장하고 있습니다. 번역 언어 변경은 저장 후 적용합니다.', 'life-meta'));
      if (current.languageError) { const error = node('p', current.languageError, 'life-error'); error.id = 'discoveryLanguageError'; error.setAttribute('role', 'alert'); body.append(error); }
      if (current.languageConflict || current.languageError || languageDirty()) {
        const retry = button(current.languageConflict || !current.languageSettings ? '최신 언어 설정 확인' : '언어 설정 다시 저장', current.languageConflict || !current.languageSettings ? 'discoveryLanguageReload' : 'discoveryLanguageRetry', current.languageConflict || !current.languageSettings ? reloadLanguages : persistLanguages); retry.disabled = !!languageWrite; body.append(retry);
        if (languageDirty()) { const discard = button('언어 선택 취소', 'discoveryLanguageDiscard', discardLanguages, 'discovery-quiet'); discard.disabled = !!languageWrite; body.append(discard); }
      }
      current.languageBody.replaceChildren(body);
      if (focusId) details.querySelectorAll('[id]').forEach(control => { if (control.id === focusId && !control.disabled) control.focus({ preventScroll: true }); });
      return details;
    }
    function translationLink(article, { focusKey = 'translate:' + article.canonicalUrl, currentFeedOnly = false } = {}) {
      const target = confirmedTranslationTarget(), address = languageModel().buildTranslationURL(article, target);
      if (!address) return null;
      const revision = current.languageSettings.revision, link = node('a', languageModel().TRANSLATION_TARGET_LABELS[target] + '로 번역해 열기 · Google 번역', 'life-button discovery-quiet discovery-translation-link');
      link.href = address; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer'; link.dataset.discoveryTranslate = ''; link.dataset.focusKey = focusKey;
      link.setAttribute('aria-label', link.textContent + ' · 새 탭');
      link.addEventListener('click', event => {
        if (!scope() || currentFeedOnly && !currentFeedArticle(article) || suspended || root.document.getElementById('lifeApp')?.hidden !== false || current.languageSettings?.revision !== revision || confirmedTranslationTarget() !== target || languageModel().buildTranslationURL(article, target) !== address) { event.preventDefault(); return; }
        capture(article.id, link.dataset.focusKey);
      }); return link;
    }
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
    function desiredSettings() {
      if (!current?.settings) return null;
      const patch = current.settingChanges;
      // An explicit topic selection retires only IDs whose manual topics were removed.
      // Source selections and passive reads retain unknown IDs as before.
      const liveInterests = Object.keys(patch.interests).length ? new Set(current.profile.manual.map(item => item.id)) : null;
      const ids = (saved, changes, live) => { const result = new Set(live ? saved.filter(id => live.has(id)) : saved); Object.entries(changes).forEach(([id, enabled]) => enabled ? result.delete(id) : result.add(id)); return [...result]; };
      if (!settingsDirty()) return current.settings;
      return settingsModel().update(current.settings, { autoRefresh: patch.autoRefresh ?? current.settings.autoRefresh,
        disabledInterestIds: ids(current.settings.disabledInterestIds, patch.interests, liveInterests), disabledSourceIds: ids(current.settings.disabledSourceIds, patch.sources) }, { expectedRevision: current.settings.revision });
    }
    function settingsDirty() { const p = current?.settingChanges; return !!p && (p.autoRefresh !== undefined || Object.keys(p.interests).length > 0 || Object.keys(p.sources).length > 0); }
    function cancelFetch() {
      fetchEpoch++; aborter?.abort(); aborter = null; client?.cancel();
      if (current) current.loading = false;
    }
    function canAuto() { return !suspended && root.document.getElementById('lifeApp')?.hidden === false && scope() && !current.settingsConflict && current.settings?.autoRefresh && desiredSettings()?.autoRefresh && !current.autoBlocked && root.document.visibilityState !== 'hidden' && root.navigator.onLine !== false; }
    function stopTimer() { if (timer !== null) root.clearTimeout(timer); timer = null; }
    function scheduleAuto() {
      stopTimer(); if (!canAuto() || current.loading) return;
      const wait = Math.max(0, (current.nextDue || Date.now() + INTERVAL) - Date.now());
      timer = root.setTimeout(() => { timer = null; if (canAuto()) loadCatalog(true).catch(error => report(error)); }, wait);
    }
    function syncTransientControls() {
      if (!scope() || !surface?.isConnected) return;
      surface.setAttribute('aria-busy', String(busy()));
      const refresh = surface.querySelector('#discoveryRefresh');
      if (refresh) refresh.disabled = current.loading;
      const status = surface.querySelector('#discoveryStatus');
      if (status) { status.textContent = current.loading ? '공개 글 목록을 불러오고 있습니다.' : current.status; status.hidden = !status.textContent; }
      surface.querySelectorAll('[data-discovery-feedback], [data-discovery-undo], #discoveryUndo').forEach(control => { control.disabled = !!current.pending || busy(); });
    }
    function lifecycle() {
      if (!scope()) return;
      if (!canAuto()) {
        stopTimer(); cancelFetch();
        if (!suspended && root.document.getElementById('lifeApp')?.hidden === false) syncTransientControls();
      } else scheduleAuto();
    }
    function pageSuspend() { suspended = true; stopTimer(); cancelFetch(); }
    function pageReady() {
      // The shell emits this only after revalidating the account and revealing it.
      suspended = false;
      if (!scope() || root.document.getElementById('lifeApp')?.hidden !== false) return;
      syncTransientControls();
      if (!current.catalog?.feed && canAuto()) loadCatalog(true).catch(error => report(error));
      else scheduleAuto();
    }
    async function loadCatalog(automatic = false) {
      if (!scope() || current.loading || (automatic && !canAuto())) return;
      const token = generation, epoch = ++fetchEpoch;
      aborter = new AbortController(); current.loading = true; current.error = ''; current.nextDue = Date.now() + INTERVAL; stopTimer(); draw();
      try {
        const result = await client.load({ signal: aborter.signal });
        if (!valid(token) || epoch !== fetchEpoch || (automatic && !canAuto())) return;
        if (result.feed || !current.catalog) { current.catalog = result; if (current.personalResult) current.personalPending = true; }
        if (result.error || result.status === 'error') current.error = current.catalog?.feed ? '목록을 다시 받지 못해 이전 목록을 보여 줍니다.' : '공개 글 목록을 불러오지 못했습니다. 목록 다시 불러오기를 눌러 주세요.';
        else if (automatic) message('공개 목록을 자동으로 다시 확인했습니다.');
      } catch (error) {
        if (valid(token) && epoch === fetchEpoch && error?.name !== 'AbortError') current.error = current.catalog?.feed ? '목록을 다시 받지 못해 이전 목록을 보여 줍니다.' : '공개 글 목록을 불러오지 못했습니다. 목록 다시 불러오기를 눌러 주세요.';
      } finally {
        if (valid(token) && epoch === fetchEpoch) { current.loading = false; aborter = null; draw(); restore(); scheduleAuto(); }
      }
    }
    async function persistSettings() {
      if (!scope() || !settingsDirty() || settingsWrite || current.settingsConflict) return;
      const token = generation, changes = clone(current.settingChanges), desired = desiredSettings();
      const next = settingsModel().update(current.settings, { autoRefresh: desired.autoRefresh, disabledInterestIds: desired.disabledInterestIds, disabledSourceIds: desired.disabledSourceIds }, { expectedRevision: current.settings.revision });
      current.settingsError = ''; settingsWrite = storage.saveDiscoverySettings(workspaceId, next, current.settings.revision); draw();
      try {
        const result = await settingsWrite;
        if (!valid(token)) return;
        if (result.status !== 'stored') { current.settingsConflict = true; current.autoBlocked = true; stopTimer(); cancelFetch(); current.settingsError = '다른 탭에서 옵션이 바뀌었습니다. 최신 옵션을 확인한 뒤 남겨 둔 선택을 다시 저장해 주세요.'; return; }
        const wasAuto = current.settings.autoRefresh; current.settings = result.settings;
        if (current.settingChanges.autoRefresh === changes.autoRefresh) delete current.settingChanges.autoRefresh;
        for (const group of ['interests', 'sources']) for (const [id, value] of Object.entries(changes[group])) if (current.settingChanges[group][id] === value) delete current.settingChanges[group][id];
        current.autoBlocked = !desiredSettings().autoRefresh;
        if (!wasAuto && result.settings.autoRefresh) current.nextDue = Date.now() + INTERVAL;
        current.settingsError = ''; current.status = !current.catalog?.feed && !desiredSettings().autoRefresh ? '옵션을 저장했습니다. 목록을 아직 받지 못했습니다. 목록 다시 불러오기를 눌러 주세요.' : '주제·출처 옵션을 이 브라우저에 저장했습니다.';
      } catch (_) { if (valid(token)) current.settingsError = '옵션을 저장하지 못했습니다. 선택은 남아 있습니다. 다시 저장하거나 취소해 주세요.'; }
      finally {
        settingsWrite = null;
        if (valid(token)) {
          draw(); scheduleAuto();
          if (!current.settingsError && settingsDirty()) persistSettings().catch(error => report(error));
          else if (!current.settingsError && !current.catalog?.feed && canAuto()) loadCatalog(true).catch(error => report(error));
        }
      }
    }
    function changeSetting(group, id, enabled) {
      if (!scope() || !current.settings) return;
      if (group === 'autoRefresh') { current.settingChanges.autoRefresh = enabled; current.autoBlocked = !enabled; if (!enabled) { stopTimer(); cancelFetch(); if (!current.catalog?.feed) current.status = '목록을 아직 받지 못했습니다. 목록 다시 불러오기를 눌러 주세요.'; } }
      else { current.settingChanges[group][id] = enabled; dropPersonal(true); }
      current.settingsError = ''; draw(); persistSettings().catch(error => report(error));
    }
    async function reloadSettings() {
      const token = generation, result = await storage.readDiscoverySettings(workspaceId);
      if (!valid(token)) return;
      if (current.settings && current.settings.revision !== result.revision) dropPersonal(true);
      current.settings = result; current.settingsConflict = false; current.settingsError = '';
      current.autoBlocked = !desiredSettings().autoRefresh; if (current.autoBlocked) { stopTimer(); cancelFetch(); } draw(); scheduleAuto();
    }
    function focusTopicControl() {
      if (!scope() || current.editor.hidden) return;
      (current.editor.open ? current.topicInput : current.topicsSummary).focus({ preventScroll: true });
    }
    function showRelatedTopics() {
      current.mode = 'related'; current.baselineMode = 'related'; current.memory = null;
      draw(); surface.querySelector('#discoveryRecommended')?.focus();
    }
    async function saveTopic() {
      if (!scope() || !current.profile || topicWrite || current.topicConflict || current.composing) return;
      const label = current.topicText.trim(); if (!label) return;
      if (current.profile.manual.some(item => item.label === label)) { current.topicError = '이미 저장한 주제입니다. 아래 체크로 선택해 주세요.'; draw(); return; }
      if (current.profile.manual.length >= 40) { current.topicError = '주제는 40개까지 저장할 수 있습니다. 관심 확인에서 정리해 주세요.'; draw(); return; }
      const token = generation, submitted = current.topicText;
      const candidate = root.HaedoLife.InterestProfile.setManual(current.profile, [...current.profile.manual, { id: 'manual-' + root.crypto.randomUUID(), label }], { expectedRevision: current.profile.revision });
      current.topicError = ''; topicWrite = storage.saveInterestProfile(workspaceId, candidate, current.profile.revision); draw();
      try {
        const result = await topicWrite; if (!valid(token)) return;
        if (result.status !== 'stored') { current.topicConflict = true; current.topicError = '다른 탭에서 주제가 바뀌었습니다. 최신 주제를 확인한 뒤 입력을 다시 저장해 주세요.'; return; }
        current.profile = result.profile; dropPersonal(true);
        if (current.topicText === submitted) { current.topicText = ''; current.topicInput.value = ''; }
        current.topicError = ''; current.topicSaved = true; current.status = '주제를 이 브라우저에 저장했습니다.';
      } catch (_) { if (valid(token)) current.topicError = '주제를 저장하지 못했습니다. 입력은 남아 있습니다. 다시 저장하거나 입력을 지워 주세요.'; }
      finally { topicWrite = null; if (valid(token)) { draw(); focusTopicControl(); } }
    }
    async function reloadTopics() {
      const token = generation, profile = await storage.readInterestProfile(workspaceId);
      if (valid(token)) { current.profile = profile; current.topicConflict = false; current.topicError = current.topicText.trim() ? '최신 주제를 확인했습니다. 남겨 둔 입력을 다시 저장해 주세요.' : ''; draw(); }
    }
    function checkbox(text, id, checked, action, data, value) {
      const label = node('label', null, 'discovery-check'), input = node('input'); input.type = 'checkbox'; input.id = id; input.checked = checked;
      if (data) input.dataset[data] = value;
      input.addEventListener('change', () => { if (scope()) action(input.checked); }); label.append(input, node('span', text)); return label;
    }
    function drawEditor() {
      const host = current.editor, input = current.topicInput, desired = desiredSettings(), focused = root.document.activeElement, focusId = host.contains(focused) && focused !== input ? focused.id : null;
      current.examples.hidden = !!current.profile?.manual?.length; current.examples.querySelectorAll('button').forEach(el => { el.disabled = !current.profile || !!topicWrite || !!current.topicText.trim(); });
      current.topicAdd.disabled = !current.profile || !!topicWrite || !current.topicText.trim() || current.topicConflict;
      current.topicDiscard.hidden = !current.topicText; current.topicDiscard.disabled = !!topicWrite;
      const choices = node('fieldset', null, 'discovery-topic-choices'); choices.append(node('legend', '목록에 사용할 주제'));
      for (const interest of current.profile?.manual || []) choices.append(checkbox(interest.label, 'discoveryInterest-' + interest.id, !desired?.disabledInterestIds.includes(interest.id), enabled => changeSetting('interests', interest.id, enabled), 'discoveryInterest', interest.id));
      if (!current.profile?.manual?.length) choices.append(node('p', '주제를 하나씩 추가해 주세요. 저장하기 전에는 목록에 사용하지 않습니다.', 'life-meta'));
      const edit = button('관심 확인', 'discoveryOpenInterests', () => navigate(onOpenInterests, null, 'interests'), 'discovery-quiet'); edit.dataset.focusKey = 'interests'; choices.append(edit);
      current.choiceHost.replaceChildren(choices);
      const recovery = node('div', null, 'discovery-topic-recovery');
      if (current.topicError) { const error = node('p', current.topicError, 'life-error'); error.id = 'discoveryTopicError'; error.setAttribute('role', 'alert'); recovery.append(error); recovery.append(button(current.topicConflict ? '최신 주제 확인' : '주제 다시 저장', current.topicConflict ? 'discoveryTopicReload' : 'discoveryTopicRetry', current.topicConflict ? reloadTopics : saveTopic)); }
      current.topicRecovery.replaceChildren(recovery);
      const options = current.options; options.open = current.optionsOpen;
      const inside = node('div', null, 'discovery-options-body');
      inside.append(checkbox('자동 목록 갱신', 'discoveryAutoRefresh', !!desired?.autoRefresh, enabled => changeSetting('autoRefresh', null, enabled)));
      const autoStatus = node('p', current.autoBlocked || !current.settings?.autoRefresh ? '자동 목록 갱신 꺼짐' : root.document.visibilityState === 'hidden' || root.navigator.onLine === false ? '화면이 보이고 온라인일 때 다시 시작합니다.' : '자동 목록 갱신 켜짐 · 다음 확인 ' + new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(new Date(current.nextDue || Date.now() + INTERVAL)), 'life-meta'); autoStatus.id = 'discoveryAutoStatus'; autoStatus.setAttribute('role', 'status'); if (current.nextDue) autoStatus.dataset.nextDue = String(current.nextDue);
      inside.append(node('p', '이 화면을 보는 동안 15분마다 공개 목록을 다시 확인합니다. 화면이 숨겨지거나 닫혀 있으면 중지합니다. 원문을 자동으로 읽거나 보관하지 않습니다.', 'life-meta'), autoStatus);
      const sources = node('fieldset', null, 'discovery-source-choices'); sources.append(node('legend', '목록에 표시할 출처'));
      for (const source of current.catalog?.feed?.sources || []) sources.append(checkbox(source.name, 'discoverySource-' + source.id, !desired?.disabledSourceIds.includes(source.id), enabled => changeSetting('sources', source.id, enabled), 'discoverySource', source.id));
      if (!current.catalog?.feed) sources.append(node('p', '공개 목록을 불러오면 출처를 선택할 수 있습니다.', 'life-meta'));
      inside.append(sources, node('p', '출처 선택은 이 화면의 목록 표시를 바꿉니다. 공용 목록 수집 설정에는 영향을 주지 않습니다.', 'life-meta'));
      if (settingsDirty()) inside.append(node('p', settingsWrite ? '옵션을 저장하고 있습니다.' : '아직 저장되지 않은 선택이 있습니다.', 'life-meta'));
      if (current.settingsError) { const error = node('p', current.settingsError, 'life-error'); error.id = 'discoverySettingsError'; error.setAttribute('role', 'alert'); inside.append(error); }
      if ((settingsDirty() || current.settingsConflict) && !settingsWrite) {
        inside.append(button(current.settingsConflict ? '최신 옵션 확인' : '옵션 다시 저장', current.settingsConflict ? 'discoverySettingsReload' : 'discoverySettingsRetry', current.settingsConflict ? reloadSettings : persistSettings));
        inside.append(button('옵션 선택 취소', 'discoverySettingsDiscard', async () => { const reload = current.settingsConflict; current.settingChanges = { interests: {}, sources: {} }; current.settingsError = ''; current.autoBlocked = true; stopTimer(); cancelFetch(); if (reload) await reloadSettings(); else { current.autoBlocked = !current.settings.autoRefresh; draw(); scheduleAuto(); } }, 'discovery-quiet'));
      }
      current.optionsBody.replaceChildren(inside);
      if (focusId) host.querySelectorAll('[id]').forEach(el => { if (el.id === focusId && !el.disabled) el.focus({ preventScroll: true }); });
    }
    function ensureSurface() {
      if (surface?.isConnected && surface.dataset.workspace === workspaceId) return;
      surface = node('section', null, 'discovery-review'); surface.id = 'discoveryReview'; surface.dataset.workspace = workspaceId;
      const editor = node('details', null, 'discovery-topic-editor'), label = node('label', '찾고 싶은 주제', 'discovery-topic-label'); label.htmlFor = 'discoveryTopicInput';
      editor.id = 'discoveryTopics'; editor.open = current.topicsOpen;
      const topicsSummary = node('summary', '주제·출처'); topicsSummary.id = 'discoveryTopicsSummary';
      editor.append(topicsSummary);
      editor.addEventListener('toggle', () => {
        if (!scope() || current.editor !== editor || !editor.isConnected) return;
        current.topicsOpen = editor.open;
        if (!editor.open && editor.contains(root.document.activeElement) && root.document.activeElement !== topicsSummary) topicsSummary.focus({ preventScroll: true });
      });
      const form = node('form', null, 'discovery-topic-form'), input = node('input', null, 'life-input'); input.id = 'discoveryTopicInput'; input.type = 'text'; input.maxLength = 200; input.autocomplete = 'off'; input.value = current.topicText;
      input.setAttribute('aria-describedby', 'discoveryTopicHelp');
      input.addEventListener('compositionstart', () => { current.composing = true; }); input.addEventListener('compositionend', () => { current.composing = false; current.topicText = input.value; current.topicAdd.disabled = !current.topicText.trim() || !!topicWrite || current.topicConflict; current.topicDiscard.hidden = !current.topicText; });
      input.addEventListener('input', () => { current.topicText = input.value; current.topicAdd.disabled = !current.topicText.trim() || !!topicWrite || current.topicConflict || !current.profile; current.topicDiscard.hidden = !current.topicText; current.examples.querySelectorAll('button').forEach(el => { el.disabled = !current.profile || !!topicWrite || !!current.topicText.trim(); }); });
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.isComposing || current.composing || event.keyCode === 229)) event.preventDefault(); });
      form.addEventListener('submit', event => { event.preventDefault(); if (scope() && !current.composing) saveTopic().catch(error => report(error)); });
      const add = button('주제 추가', 'discoveryTopicAdd', saveTopic), discard = button('입력 지우기', 'discoveryTopicDiscard', () => { current.topicText = ''; input.value = ''; current.topicError = ''; current.topicConflict = false; draw(); focusTopicControl(); }, 'discovery-quiet');
      form.append(input, add, discard); const help = node('p', '현재 제목·태그에 있는 표현을 원문 언어로 적어 주세요. 검색어는 자동 번역하지 않습니다. 번역 언어는 원문 열기에만 적용됩니다.', 'life-meta'); help.id = 'discoveryTopicHelp';
      const examples = node('div', null, 'discovery-topic-examples'); examples.append(node('span', '예시 주제', 'life-meta'));
      for (const example of ['AI', '전시', '신간', 'Linguistics']) examples.append(button(example, null, () => { if (current.topicText.trim() || topicWrite) return; current.topicText = example; input.value = example; return saveTopic(); }, 'discovery-quiet'));
      const choiceHost = node('div'), topicRecovery = node('div'), options = node('details', null, 'discovery-options'); options.id = 'discoveryOptions'; options.open = current.optionsOpen;
      options.append(node('summary', '옵션')); const optionsBody = node('div'); options.append(optionsBody); options.addEventListener('toggle', () => { if (scope()) current.optionsOpen = options.open; });
      const topicBody = node('div', null, 'discovery-topic-body'); topicBody.append(label, form, help, examples, topicRecovery, choiceHost, options); editor.append(topicBody); const reactionHost = node('div'), languageHost = node('div'), body = node('div'); surface.append(editor, reactionHost, languageHost, body); container.replaceChildren(surface);
      Object.assign(current, { editor, topicsSummary, examples, topicInput: input, topicAdd: add, topicDiscard: discard, choiceHost, topicRecovery, options, optionsBody, reactionHost, languageHost, body });
    }
    function currentFeedArticle(article) {
      return current?.catalog?.feed?.articles.find(value => value.id === article.id && value.sourceId === article.sourceId && value.canonicalUrl === article.canonicalUrl) || null;
    }
    function originalLink(article, { text = article.title, focusKey = 'open:' + article.id, currentFeedOnly = false } = {}) {
      const link = node('a', text); link.href = url(article.url) || url(article.canonicalUrl) || '#'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
      link.setAttribute('aria-label', article.title + ' · 새 탭에서 원문 읽기');
      link.dataset.discoveryOpen = ''; link.dataset.focusKey = focusKey;
      link.addEventListener('click', event => openOriginal(event, article, focusKey, currentFeedOnly)); return link;
    }
    function openOriginal(event, article, focusKey = 'open:' + article.id, currentFeedOnly = false) {
      if (!scope() || currentFeedOnly && !currentFeedArticle(article)) { event.preventDefault(); return; }
      capture(article.id, focusKey);
      if (onOpenOriginal) {
        event.preventDefault();
        try { Promise.resolve(onOpenOriginal(article)).catch(error => report(error)); } catch (error) { report(error); }
      }
    }
    async function navigate(action, article, focusKey, currentFeedOnly = false) {
      if (!scope()) return; const token = generation;
      capture(article?.id, focusKey);
      await flush();
      if (!valid(token)) return;
      const selected = currentFeedOnly ? currentFeedArticle(article) : article;
      if (currentFeedOnly && !selected) throw Error('현재 공개 목록에서 이 글을 확인하지 못했습니다. 제외 선택은 유지했습니다.');
      await action?.(selected, current.memory ? { focusKey: current.memory.focusKey, scrollY: current.memory.scrollY } : undefined);
    }
    function importButton(article, { focusKey = 'import:' + article.id, currentFeedOnly = false } = {}) {
      const review = button(article.coverage === 'link_only' ? '링크 보관 검토' : '보관 검토', null, () => navigate(onImport, article, focusKey, currentFeedOnly), 'discovery-review-button');
      review.dataset.discoveryImport = ''; review.dataset.focusKey = focusKey; review.disabled = !!current.pending || !!pendingWrite; return review;
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
      details.append(node('p', '준비된 공개 목록에서 찾습니다. 목록 다시 불러오기는 이 목록을 다시 확인하며, 출처 사이트의 새 글 수집을 실행하지 않습니다. 공용 목록의 하루 단위 갱신은 배포에 반영된 뒤 확인할 수 있습니다.', 'life-meta'));
      return details;
    }
    function articleRow(item, sources) {
      const { article } = item, row = node('article', null, 'discovery-article'); row.dataset.discoveryId = article.id; row.dataset.discoveryUrl = article.canonicalUrl;
      const source = sources.find(value => value.id === article.sourceId);
      const meta = node('p', null, 'discovery-meta'); meta.append(node('span', source?.name || article.sourceName || '출처 미확인'));
      const published = date(article.publishedAt);
      if (published && (article.dateStatus === 'valid' || current.collection !== 'discover')) { const time = node('time', published); time.dateTime = article.publishedAt; meta.append(time); }
      else meta.append(node('span', '발행일 미확인'));
      if (article.dateBasis === 'updated' && date(article.updatedAt)) meta.append(node('span', '수정 ' + date(article.updatedAt)));
      row.append(meta);
      const heading = node('h2', null, 'discovery-title'); heading.append(originalLink(article)); row.append(heading);
      if (article.summary) row.append(node('p', article.summary, 'discovery-summary'));
      const reasons = item.reasons || [];
      if ((current.mode === 'related' || current.mode === 'personal' && !item.personal && current.baselineMode === 'related') && reasons.length) {
        const reason = reasons[0], field = { title: '제목', summary: '공개 요약', bodyText: '허용된 본문', tags: '출처 태그' }[reason.field] || '공개 글';
        row.append(node('p', '보관한 관심 ‘' + reason.interestLabel + '’ · ' + field + '에 ‘' + reason.quote + '’', 'discovery-reason'));
        const evidence = node('details', null, 'discovery-evidence'); evidence.append(node('summary', '찾은 근거'));
        reasons.slice(0, 5).forEach(ref => {
          const where = { title: '제목', summary: '공개 요약', bodyText: '허용된 본문', tags: '출처 태그' }[ref.field] || '공개 글';
          evidence.append(node('p', where + ' · 관심 ‘' + ref.interestLabel + '’' + (ref.via === 'alias' ? '의 같은 표현' : ''), 'life-meta'), node('blockquote', ref.quote));
        }); if (reasons.length > 5) evidence.append(node('p', '일치한 표현 ' + reasons.length + '개 중 5개를 표시합니다.', 'life-meta')); row.append(evidence);
      }
      if (item.personal && !current.personalBlocked) {
        const why = node('details', null, 'discovery-personal-evidence'); why.append(node('summary', '왜 이 글인가'));
        for (const evidence of item.personal.evidence || []) why.append(node('p', '좋아요한 글 ‘' + evidence.title + '’의 ' + (evidence.field === 'tags' ? '보관한 태그' : '보관한 제목') + '와 이 글의 ' + (evidence.candidateField === 'tags' ? '공개 태그' : '제목') + '의 대응 표현 · ‘' + evidence.quote + '’ / ‘' + evidence.candidateQuote + '’', 'life-meta'));
        why.append(node('p', '보관한 제목·태그와 공개 후보의 표현 유사도입니다. 본문 이해·동의·품질 확률을 뜻하지 않습니다.', 'life-meta')); row.append(why);
      }
      if (current.collection !== 'discover' && !current.catalog?.feed?.articles.some(value => value.canonicalUrl === article.canonicalUrl)) row.append(node('p', '현재 공개 목록에 없음 · 마지막으로 담은 제목·출처입니다. 원문 접근 여부는 자동 확인하지 않습니다.', 'discovery-notice'));
      if (current.collection !== 'discover') row.append(node('p', '보관한 제목·출처 정보 · 원문 본문은 보관하지 않았습니다.', 'discovery-coverage'));
      const savedEntry = entryFor(article);
      if (current.collection === 'liked' && savedEntry && !savedEntry.liked || current.collection === 'bookmarked' && savedEntry && !savedEntry.bookmarked) row.append(node('p', '이 목록의 선택을 취소했습니다. 아래 반응 버튼으로 다시 선택할 수 있습니다.', 'discovery-notice'));
      const coverage = article.coverage === 'full_text' ? '허용된 본문 확보' : article.coverage === 'summary' ? '공개 요약만 확보 · 원문 전체 미확보' : '링크와 제목만 확보 · 본문 미확보';
      row.append(node('p', coverage, 'discovery-coverage'));
      const actions = node('div', null, 'discovery-actions');
      const review = importButton(article);
      const read = button('읽음', null, () => feedback(article, 'already_read'), 'discovery-quiet'); read.dataset.discoveryFeedback = 'already_read'; read.dataset.focusKey = 'feedback:' + article.id + ':already_read';
      const irrelevant = button('관련 없음', null, () => feedback(article, 'not_relevant'), 'discovery-quiet'); irrelevant.dataset.discoveryFeedback = 'not_relevant'; irrelevant.dataset.focusKey = 'feedback:' + article.id + ':not_relevant';
      read.disabled = irrelevant.disabled = !!current.pending || busy();
      actions.append(review, read, irrelevant); const translated = translationLink(article); if (translated) actions.append(translated); row.append(reactionControls(article), actions); return row;
    }
    function draw() {
      if (!scope()) return;
      ensureSurface(); current.editor.hidden = current.collection !== 'discover'; if (!current.editor.hidden) drawEditor(); surface.setAttribute('aria-busy', String(busy()));
      const body = node('div'), labels = (current.profile?.manual || []).filter(item => !desiredSettings()?.disabledInterestIds.includes(item.id)).map(item => item.label);
      current.reactionHost.replaceChildren(actionsHeader());
      const languages = languageControls(); if (languages.parentNode !== current.languageHost) current.languageHost.replaceChildren(languages);
      let controls = current.sortControls;
      if (!controls) {
        controls = node('div', null, 'discovery-controls');
        const modes = node('div', null, 'discovery-modes'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '글 정렬');
        for (const [mode, label, id] of [['related', '관심순', 'discoveryRecommended'], ['latest', '최신순', 'discoveryLatest'], ['personal', '개인 추천', 'discoveryPersonalized']]) {
          const action = button(label, id, () => { capture(); current.collection = 'discover'; current.collectionUrls = null; if (mode === 'personal') { if (current.actions?.personalizationEnabled && !current.personalBlocked) applyPersonal(); else personalize(true); } else { current.mode = mode; current.baselineMode = mode; current.memory = null; draw(); } surface.querySelector('#' + id)?.focus(); }, 'discovery-mode');
          action.dataset.discoveryMode = mode; modes.append(action);
        }
        const refresh = button('목록 다시 불러오기', 'discoveryRefresh', () => { capture(null, 'refresh'); return loadCatalog(); }, 'discovery-quiet'); refresh.dataset.focusKey = 'refresh';
        controls.append(modes, refresh); current.sortControls = controls;
      }
      controls.hidden = current.collection !== 'discover';
      controls.querySelectorAll('[data-discovery-mode]').forEach(control => control.setAttribute('aria-pressed', String(current.mode === control.dataset.discoveryMode)));
      controls.querySelector('#discoveryRefresh').disabled = current.loading; body.append(controls);
      const status = node('p', current.loading ? '공개 글 목록을 불러오고 있습니다.' : current.status, 'discovery-status'); status.id = 'discoveryStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = !status.textContent; body.append(status);
      if (current.collection === 'discover' && current.topicSaved && current.mode === 'latest') {
        const topicNext = node('div', null, 'discovery-topic-next');
        topicNext.append(node('p', '최신순은 주제로 걸러지지 않습니다.', 'discovery-limitation'), button('관심순으로 보기', 'discoveryTopicRelated', showRelatedTopics, 'discovery-quiet'));
        body.append(topicNext);
      }
      const error = node('p', current.error, 'life-error'); error.id = 'discoveryError'; error.setAttribute('role', 'alert'); error.hidden = !current.error; body.append(error);
      if (current.error && !current.loading && (!current.languageSettings || !current.profile || !current.feedback || !current.settings || !current.actions)) body.append(button('다시 확인', 'discoveryRetry', render));
      if (current.pending) {
        const recovery = node('div', null, 'discovery-recovery');
        recovery.append(node('p', '남겨 둔 선택 · ' + (current.pending.action === 'undo' ? '제외 되돌리기' : current.pending.kind === 'already_read' ? '읽음' : '관련 없음') + ' · ' + (current.pending.article.title || current.pending.article.canonicalUrl), 'life-meta'));
        if (current.conflict) recovery.append(button('최신 제외 목록 확인', 'discoveryFeedbackReload', reloadFeedback));
        else { const retry = button('선택 다시 보관', 'discoveryFeedbackRetry', persistIntent); retry.disabled = !!pendingWrite; recovery.append(retry); }
        const discard = button('선택 취소', 'discoveryFeedbackDiscard', () => { current.pending = null; current.conflict = false; message('이번 선택을 취소했습니다. 보관된 제외 목록은 유지했습니다.'); draw(); restore(); }); discard.disabled = !!pendingWrite; recovery.append(discard); body.append(recovery);
      } else if (current.lastFeedback) body.append(button('방금 제외 되돌리기', 'discoveryUndo', () => undo(current.lastFeedback), 'discovery-quiet'));
      const feed = current.catalog?.feed, result = rank();
      if (current.collection === 'discover' && current.mode === 'personal') {
        const explanation = current.personalBlocked ? '개인 추천은 꺼져 있습니다.' : current.personalResult?.metadata?.personalization?.applied ? '좋아요한 글에 보관한 제목·태그와 겹치는 표현으로 찾았습니다.' : current.personalPending && current.personalResult ? '지금 목록 순서를 유지하고 이전 개인 추천 점수·근거를 제거했습니다. 새 추천 보기로 다시 계산할 수 있습니다.' : (current.personalInspection?.signalCount ? '좋아요 근거와 표현이 겹치는 후보가 없어 ' : '개인 추천에 사용할 좋아요 근거가 부족해 ') + (current.baselineMode === 'latest' ? '최신순' : '관심순') + '을 보여 줍니다.';
        const settled = !!current.personalResult && !current.personalPending;
        const brief = current.personalResult?.metadata?.personalization?.applied ? '보관한 좋아요의 표현으로 찾은 글입니다.' : '추천 근거가 부족해 ' + (current.baselineMode === 'latest' ? '최신순' : '관심순') + '을 보여 줍니다.';
        body.append(node('p', settled ? brief : explanation, 'discovery-limitation'));
        const apply = button('새 추천 보기', 'discoveryApplyRecommendations', applyPersonal); apply.disabled = current.personalBlocked || !current.catalog?.feed || !!actionWrite || !!current.actionIntent || !!languageWrite || languageDirty() || current.languageConflict; apply.hidden = settled; body.append(apply);
        if (current.personalPending) body.append(node('p', '반응이나 공개 목록이 바뀌었습니다. 새 추천 보기를 누르면 순서를 적용합니다.', 'discovery-notice'));
      }
      if (feed) {
        const stale = current.catalog.stale || result?.metadata?.stale;
        if (stale) body.append(node('p', '최신 상태를 확인하지 못한 출처가 있습니다. 출처와 목록 상태에서 수집 시각을 확인해 주세요.', 'discovery-notice'));
        const failed = (feed.sources || []).filter(source => source.status === 'error' || source.status === 'never_fetched');
        if (failed.length) body.append(node('p', failed.map(source => source.name + (source.status === 'error' ? ' 수집 실패' : ' 수집 자료 없음')).join(' · '), 'discovery-notice'));
      }
      const list = node('div', null, 'discovery-list'); list.id = 'discoveryList';
      if (current.collection !== 'discover') {
        const items = collectionResult(); list.append(node('p', ({ liked: '좋아요한 글', bookmarked: '담은 글', cancelled: '취소한 글' }[current.collection]) + ' · 현재 목록 ' + items.length + '개', 'discovery-count'));
        if (!items.length) list.append(node('p', current.collection === 'cancelled' ? '두 반응을 모두 취소한 글이 여기에 남습니다. 원하는 반응을 다시 선택할 수 있습니다.' : '새 글에서 ' + (current.collection === 'liked' ? '좋아요' : '담기') + '를 누르면 이 목록에서 다시 볼 수 있습니다.', 'discovery-limitation'));
        items.forEach(item => list.append(articleRow(item, [])));
      } else if (result) {
        const items = result.items;
        const summary = current.mode === 'personal' ? '개인 추천 목록 · ' + items.length + '개' : current.mode === 'related' ? items.length ? '관심과 표현이 맞는 글 ' + items.length + '개' + (items.length < 3 ? ' · 관련 글이 적어 더 채우지 않았습니다.' : '') : labels.length ? '선택한 주제와 표현이 맞는 새 글을 찾지 못했습니다.' : '주제·출처를 열어 주제를 추가·선택하거나 최신순으로 공개 글을 둘러보세요.' : '같은 출처와 제외 조건 · 발행·수정일이 최신인 글 ' + items.length + '개';
        list.append(node('p', desiredLanguages()?.contentLanguages?.length === 0 ? '선택한 콘텐츠 언어가 없습니다. 언어 옵션에서 표시할 언어를 켜 주세요.' : !desiredSettings()?.disabledSourceIds || feed.sources.some(source => !desiredSettings().disabledSourceIds.includes(source.id)) ? summary : '선택한 출처가 없습니다. 옵션에서 목록에 표시할 출처를 켜 주세요.', 'discovery-count'));
        if (current.mode === 'related' && items.length) list.append(node('p', result.metadata?.limitation || '공개 글에 실제로 나타난 표현으로 찾았습니다. 같은 표현이라도 문맥은 다를 수 있습니다.', 'discovery-limitation'));
        if (!items.length && labels.length && current.mode === 'related') {
          list.append(node('p', '현재 제목·태그의 표현으로 찾습니다. 검색어는 자동 번역하지 않으므로 원문 언어의 주제(예: Linguistics)를 직접 입력해 보세요. 번역 언어는 원문 열기 설정입니다.', 'discovery-limitation'));
          list.append(button('최신 글 보기', null, () => { current.mode = 'latest'; current.baselineMode = 'latest'; draw(); }, 'discovery-quiet'));
        }
        items.forEach(item => list.append(articleRow(item, feed.sources || [])));
      }
      body.append(list);
      if (current.feedback?.feedback?.length) {
        const excluded = node('details', null, 'discovery-excluded'); excluded.open = current.excludedOpen;
        excluded.addEventListener('toggle', () => { if (current) current.excludedOpen = excluded.open; });
        excluded.append(node('summary', '제외한 글 ' + current.feedback.feedback.length + '개'));
        current.feedback.feedback.forEach(entry => {
          const available = feed?.articles?.find(item => item.canonicalUrl === entry.canonicalUrl);
          const article = available || { id: entry.articleId, canonicalUrl: entry.canonicalUrl, title: entry.canonicalUrl };
          const row = node('div', null, 'discovery-excluded-row'); row.dataset.discoveryUrl = entry.canonicalUrl;
          row.append(node('p', article.title), node('small', entry.kind === 'already_read' ? '읽음' : '관련 없음', 'life-meta'));
          if (available) {
            const actions = node('div', null, 'discovery-actions');
            actions.append(originalLink(article, { text: '원문 읽기', focusKey: 'excluded-open:' + article.id, currentFeedOnly: true }),
              importButton(article, { focusKey: 'excluded-import:' + article.id, currentFeedOnly: true }));
            const translated = translationLink(article, { focusKey: 'excluded-translate:' + article.canonicalUrl, currentFeedOnly: true });
            if (translated) actions.append(translated); row.append(actions);
          }
          const restoreButton = button('제외 되돌리기', null, () => undo(article), 'discovery-quiet'); restoreButton.dataset.discoveryUndo = entry.articleId; restoreButton.disabled = !!current.pending || busy(); row.append(restoreButton); excluded.append(row);
        }); body.append(excluded);
      }
      if (feed) body.append(sourceDetails(feed, result));
      body.append(portableControls());
      body.append(node('p', '주제·옵션과 좋아요·담기·읽음·제외 선택은 이 브라우저에만 보관합니다. 원문을 열기 전에는 해당 사이트에 접속하지 않습니다.', 'discovery-privacy'));
      current.body.replaceChildren(...body.childNodes);
    }
    async function render() {
      leave(); if (disposed) return;
      active = true; const next = getBundle()?.workspaceId;
      if (next !== workspaceId) { current = null; client?.dispose(); client = null; }
      workspaceId = next; const token = generation;
      if (!current) current = { profile: null, feedback: null, catalog: null, mode: 'latest', status: '', error: '', pending: null, conflict: false, lastFeedback: null, memory: null, sourcesOpen: false, excludedOpen: false, loading: true, languageSettings: null, languagePatch: {}, languageConflict: false, languageError: '', translationBlocked: true, remoteLanguageRevision: 0, languageReadEpoch: 0, languageOpen: false, actions: null, actionIntent: null, actionConflict: false, actionError: '', remoteActionRevision: 0, personalOffIntent: false, personalBlocked: true, personalStopLatched: false, personalResult: null, personalPending: false, baselineMode: 'latest', collection: 'discover', collectionUrls: null, lastReaction: null, confirmForget: null, confirmReset: false, copyPreview: null, copyEnvelope: null, copyReading: false, copyGeneration: 0, copyError: '', portableOpen: false, settings: null, settingChanges: { interests: {}, sources: {} }, settingsConflict: false, settingsError: '', autoBlocked: true, nextDue: null, topicText: '', topicError: '', topicConflict: false, composing: false, optionsOpen: false, topicsOpen: false, topicSaved: false };
      const retainedPersonal = { result: current.personalResult, mode: current.mode, blocked: current.personalBlocked, pending: current.personalPending, actions: current.actions?.revision, settings: current.settings?.revision, profile: current.profile?.revision, feedback: current.feedback?.revision, language: current.languageSettings?.revision };
      stopTranslation(); current.languageReadEpoch++; current.personalResult = null; current.personalBlocked = true; if (current.mode === 'personal') current.mode = current.baselineMode;
      current.initialReading = true; client ||= engine().create(); draw();
        unsubscribe = storage.subscribe(workspaceId, event => {
          if (!scope()) return;
          if (event.type === 'discovery_language_settings_changed' && event.revision > (current.languageSettings?.revision || 0)) {
            if (languageWrite && event.local) return;
            if (!event.local) current.remoteLanguageRevision = Math.max(current.remoteLanguageRevision, event.revision);
            current.languageReadEpoch++; stopTranslation(); invalidateLanguageResults();
            if (current.initialReading) return;
            if (languageWrite || languageDirty()) { current.languageConflict = true; current.languageError = '다른 탭에서 언어 설정이 바뀌었습니다. 최신 언어 설정을 확인해 주세요.'; draw(); }
            else { draw(); reloadLanguages().catch(error => report(error)); }
          }
          if (event.type === 'discovery_actions_changed' && current.actions && event.revision > current.actions.revision) {
            if (actionWrite && event.local) return;
            if (!event.local) current.remoteActionRevision = Math.max(current.remoteActionRevision, event.revision);
            current.personalBlocked = true; current.mode = current.baselineMode; dropPersonal();
            if (actionWrite) { draw(); return; }
            if (current.actionIntent) { current.actionConflict = true; current.actionError = '다른 탭에서 반응이 바뀌었습니다. 최신 반응을 확인해 주세요.'; draw(); }
            else { draw(); reloadActions().catch(error => report(error)); }
          }
          if (event.type === 'discovery_profile_changed' && current.feedback && event.revision > current.feedback.revision && !pendingWrite) {
            capture();
            current.conflict = !!current.pending; current.error = '다른 탭에서 읽음·제외 선택이 바뀌었습니다. 최신 제외 목록을 확인해 주세요.'; draw();
            if (!current.pending) reloadFeedback().catch(error => report(error));
          }
          if (event.type === 'discovery_settings_changed' && current.settings && event.revision > current.settings.revision) {
            dropPersonal(true); surface?.querySelectorAll('.discovery-personal-evidence').forEach(el => el.remove());
            current.autoBlocked = true; stopTimer(); cancelFetch();
            if (settingsWrite) return;
            if (settingsDirty()) { current.settingsConflict = true; current.settingsError = '다른 탭에서 옵션이 바뀌었습니다. 최신 옵션을 확인해 주세요.'; draw(); }
            else reloadSettings().catch(error => report(error));
          }
          if (event.type === 'interest_profile_changed' && current.profile && event.revision > current.profile.revision && !topicWrite) {
            capture();
            storage.readInterestProfile(workspaceId).then(profile => { if (valid(token)) { current.profile = profile; dropPersonal(true); message('다른 화면에서 보관한 관심을 반영했습니다.'); draw(); restore(); } }).catch(error => report(error));
          }
        });
      try {
        const [profile, feedbackProfile, settings, actions, language] = await Promise.all([storage.readInterestProfile(workspaceId), storage.readDiscoveryProfile(workspaceId), storage.readDiscoverySettings(workspaceId), storage.readDiscoveryActions(workspaceId), readLanguages().catch(() => false)]);
        if (!valid(token)) return;
        const languageReady = language && current.languageVerifiedEpoch === current.languageReadEpoch && current.languageSettings?.revision >= current.remoteLanguageRevision || await readLanguages().catch(() => false); if (!valid(token)) return; current.initialReading = false;
        if (!languageReady) { current.languageSettings = null; current.languageConflict = true; current.languageError = '최신 언어 설정을 확인하지 못했습니다. 최신 언어 설정 확인을 눌러 주세요.'; }
        else { current.languageConflict = false; current.languageError = ''; }
        const sameInputs = languageReady && retainedPersonal.actions === actions.revision && retainedPersonal.settings === settings.revision && retainedPersonal.profile === profile.revision && retainedPersonal.feedback === feedbackProfile.revision && retainedPersonal.language === current.languageSettings?.revision;
        current.translationBlocked = !languageReady || Object.hasOwn(current.languagePatch, 'translationTarget');
        current.actions = actions; current.personalBlocked = current.personalStopLatched || !actions.personalizationEnabled; current.profile = profile; current.feedback = feedbackProfile; current.settings = settings; current.autoBlocked = !desiredSettings().autoRefresh; current.loading = false;
        if (sameInputs && retainedPersonal.mode === 'personal' && !retainedPersonal.blocked && !current.personalBlocked) { current.personalResult = retainedPersonal.result; current.mode = retainedPersonal.mode; current.personalPending = retainedPersonal.pending; }
        else if (!sameInputs) dropPersonal();
        draw();
        if (!current.catalog) await loadCatalog(); else { restore(); scheduleAuto(); }
      } catch (error) {
        if (valid(token)) { current.initialReading = false; current.loading = false; current.languageConflict = true; current.languageError = '언어 설정을 확인하지 못했습니다. 최신 언어 설정 확인을 눌러 주세요.'; report(error, '보관한 관심이나 제외 목록을 읽지 못했습니다. 화면을 다시 열어 주세요. 기존 자료는 유지했습니다.'); }
      }
    }
    function dirty() { return languageDirty() || !!languageWrite || !!current?.actionIntent || !!actionWrite || !!current?.personalOffIntent || !!current?.copyPreview || !!current?.copyReading || !!current?.pending || !!pendingWrite || !!topicWrite || !!settingsWrite || !!current?.topicText.trim() || settingsDirty(); }
    async function flush() {
      await Promise.all([pendingWrite, topicWrite, settingsWrite, actionWrite, languageWrite].filter(Boolean).map(promise => promise.catch(() => {})));
      if (languageDirty()) throw Object.assign(new Error('언어 설정이 아직 저장되지 않았습니다. 다시 저장하거나 선택을 취소해 주세요.'), { code: 'discovery_unsaved' });
      if (current?.actionIntent || current?.personalOffIntent || current?.copyPreview || current?.copyReading) throw Object.assign(new Error('반응 선택이나 사본 확인이 아직 끝나지 않았습니다. 다시 저장하거나 선택을 취소해 주세요.'), { code: 'discovery_unsaved' });
      if (current?.topicText.trim() || settingsDirty()) throw Object.assign(new Error('입력한 주제나 옵션 선택이 아직 저장되지 않았습니다. 다시 저장하거나 취소해 주세요.'), { code: 'discovery_unsaved' });
      if (current?.pending) throw Object.assign(new Error('읽음·제외 선택이 아직 보관되지 않았습니다. 선택 다시 보관 또는 선택 취소를 눌러 주세요.'), { code: 'discovery_unsaved' });
    }
    function leave() {
      if (active && surface?.isConnected && scope()) { current.topicsOpen = current.editor.open; capture(); }
      generation++; active = false; if (current) { current.languageReadEpoch++; stopTranslation(); } stopTimer(); cancelFetch(); unsubscribe?.(); unsubscribe = null;
      if (current) current.loading = false;
    }
    root.document.addEventListener('haedo:page-suspend', pageSuspend); root.document.addEventListener('haedo:page-ready', pageReady); root.document.addEventListener('visibilitychange', lifecycle); root.addEventListener('online', lifecycle); root.addEventListener('offline', lifecycle);
    function dispose() { leave(); disposed = true; downloadUrls.forEach(address => URL.revokeObjectURL(address)); downloadUrls.clear(); root.document.removeEventListener('haedo:page-suspend', pageSuspend); root.document.removeEventListener('haedo:page-ready', pageReady); root.document.removeEventListener('visibilitychange', lifecycle); root.removeEventListener('online', lifecycle); root.removeEventListener('offline', lifecycle); client?.dispose(); client = null; current = null; workspaceId = null; }
    return Object.freeze({ render, refresh: render, leave, dispose, flush, dirty });
  }
  root.HaedoLife ||= {}; root.HaedoLife.DiscoveryUI = Object.freeze({ create });
})(globalThis);
