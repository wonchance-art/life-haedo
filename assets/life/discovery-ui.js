/* Public candidate discovery and account-scoped reading. Interests and reactions
 * use the existing account documents; private article bodies never enter those records. */
(function (root) {
  'use strict';
  const node = (tag, text, cls) => { const value = root.document.createElement(tag); if (text != null) value.textContent = text; if (cls) value.className = cls; return value; };
  // 앱 안 원문 보기를 허용한 출처. 그 출처의 기사 페이지가 X-Frame-Options와 CSP frame-ancestors를
  // 보내지 않는 것을 직접 확인한 곳만 둔다(docs/design-review/news-in-app-reading.md, 2026-11-03).
  // 공급 형식(discovery-feed.json)에는 필드를 더하지 않는다. 다른 출처는 새 탭으로 연다.
  const FRAME_ALLOWED_SOURCES = Object.freeze(['readersnews-books', 'frontiers-psychology']);
  // The publisher page runs in an opaque origin (no allow-same-origin: no cookies or storage of its
  // own); scripts may run and links may open a new tab, still sandboxed. No top navigation, forms or dialogs.
  // index.html/life.html also limit frames with CSP frame-src.
  const FRAME_SANDBOX = 'allow-scripts allow-popups';
  const icon = (name, size) => root.HaedoLife.Icons.create(name, size ? { size } : undefined);
  // The list shows this many cards and 더 보기 adds as many again. Nothing loads by scrolling.
  const PAGE = 20;
  // 넓게 찾기 answers for the same topics are reused for this long when the news tab is opened again; a requested
  // refresh and a changed topic always ask. The timed catalog refresh never asks (server cache 30 minutes, call limits).
  const WIDE_REUSE_MS = 5 * 60 * 1000;
  function create({ container, storage, getBundle, isCurrent, onImport, onOpenInterests, onOpenOriginal, onReaderHistory, privateReader = null }) {
    let active = false, disposed = false, generation = 0, workspaceId = null, surface = null;
    let current = null, client = null, unsubscribe = null, aborter = null, pendingWrite = null;
    const downloadUrls = new Set();
    let splitDispose = null, splitLayout = null;
    let settingsWrite = null, topicWrite = null, actionWrite = null, languageWrite = null, timer = null, fetchEpoch = 0, suspended = false;
    const actionsModel = () => root.HaedoLife.DiscoveryActions;
    const recommendations = () => root.HaedoLife.DiscoveryRecommendations;
    const INTERVAL = 15 * 60 * 1000;
    const settingsModel = () => root.HaedoLife.DiscoverySettings;
    const languageModel = () => root.HaedoLife.DiscoveryLanguageSettings;
    const readingHost = node('div', null, 'discovery-reading-host');
    let readingUI = null;
    let privateAborter = null, privateEpoch = 0;
    let wideClient = null, wideAborter = null, wideEpoch = 0, wideClearing = null, wideUnlisten = null;
    const wideModel = () => root.HaedoLife.DiscoveryWideRemote;
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
    // A cross-origin frame's load failure cannot be detected reliably, so only the
    // checked list decides; the reader always keeps 새 탭에서 열기.
    function frameAddress(article) {
      const address = url(article?.url);
      if (!address || !FRAME_ALLOWED_SOURCES.includes(article.sourceId)) return null;
      const parsed = new URL(address);
      return parsed.protocol === 'https:' && (engine().ALLOWED_SOURCES[article.sourceId] || []).includes(parsed.hostname) ? address : null;
    }
    function stamp(value, time = true) {
      if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
      const parts = Object.fromEntries(new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
      const thisYear = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric' }).formatToParts(new Date()).find(part => part.type === 'year')?.value;
      return (parts.year === thisYear ? '' : parts.year + '.') + parts.month + '.' + parts.day + (time ? ' ' + parts.hour + ':' + parts.minute : '');
    }
    // Card time: 방금 · N분 전 · N시간 전 · N일 전, and the date after a week. The exact time stays in <time>.
    function elapsed(value) {
      if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
      const minutes = Math.floor((Date.now() - Date.parse(value)) / 60000);
      if (minutes < -5) return stamp(value, false); // a saved snapshot dated ahead: say the date, not 방금
      if (minutes < 1) return '방금';
      if (minutes < 60) return minutes + '분 전';
      if (minutes < 1440) return Math.floor(minutes / 60) + '시간 전';
      const days = Math.floor(minutes / 1440);
      return days <= 7 ? days + '일 전' : stamp(value, false);
    }
    function capture(articleId, focusKey) {
      if (!current || !scope()) return;
      const focused = root.document.activeElement;
      if (current.settingsScreen) {
        if (!focusKey && !current.settingsPanel?.contains(focused)) return;
        current.settingsMemory = { id: focused?.id || null, focusKey: focusKey || focused?.dataset?.focusKey || null,
          articleUrl: focused?.closest?.('[data-discovery-url]')?.dataset.discoveryUrl, scrollY: root.scrollY || 0 };
        return;
      }
      const id = articleId || focused?.closest?.('[data-discovery-id]')?.dataset.discoveryId || current.memory?.articleId || null;
      const article = current.catalog?.feed?.articles.find(value => value.id === id);
      current.memory = { articleId: id, articleUrl: focused?.closest?.('[data-discovery-url]')?.dataset.discoveryUrl || article?.canonicalUrl || current.memory?.articleUrl || null,
        articleIndex: Math.max(0, [...(surface?.querySelectorAll('[data-discovery-id]') || [])].findIndex(el => el.dataset.discoveryId === id)),
        focusKey: focusKey || (surface?.contains(focused) ? focused.dataset.focusKey : null) || current.memory?.focusKey || null,
        scrollY: root.scrollY || 0 };
    }
    function restore() {
      const memory = current?.memory, token = generation;
      if (current?.settingsScreen) {
        const settingsMemory = current.settingsMemory;
        if (!settingsMemory) return;
        root.requestAnimationFrame(() => {
          if (!valid(token) || !current.settingsScreen || !current.settingsPanel?.isConnected || current.editor?.contains(root.document.activeElement) || current.languageDetails?.contains(root.document.activeElement)) return;
          const target = [...current.settingsPanel.querySelectorAll('button,input,select,summary,a')].find(el =>
            !el.disabled && el.getClientRects().length && (settingsMemory.id && el.id === settingsMemory.id || settingsMemory.focusKey && el.dataset.focusKey === settingsMemory.focusKey) &&
            (!settingsMemory.articleUrl || el.closest('[data-discovery-url]')?.dataset.discoveryUrl === settingsMemory.articleUrl));
          target?.focus({ preventScroll: true });
          root.scrollTo({ top: settingsMemory.scrollY, behavior: 'instant' });
        });
        return;
      }
      if (!memory) return;
      root.requestAnimationFrame(() => {
        if (!valid(token) || current.settingsScreen || !surface?.isConnected || (current.editor?.contains(root.document.activeElement) || current.languageDetails?.contains(root.document.activeElement))) return;
        const all = [...surface.querySelectorAll('[data-focus-key]')];
        const articles = [...surface.querySelectorAll('[data-discovery-url]')];
        const target = all.find(el => !el.disabled && el.getClientRects().length && el.dataset.focusKey === memory.focusKey && (!el.closest('[data-discovery-url]') || !memory.articleUrl || el.closest('[data-discovery-url]').dataset.discoveryUrl === memory.articleUrl)) ||
          articles.find(el => el.dataset.discoveryUrl === memory.articleUrl)?.querySelector('[data-discovery-select], a.discovery-row-open[data-discovery-open]') ||
          articles[Math.min(memory.articleIndex || 0, articles.length - 1)]?.querySelector('[data-discovery-select], a.discovery-row-open[data-discovery-open]') || surface.querySelector('#discoveryUndoToast, #discoveryUndo');
        target?.focus({ preventScroll: true });
        root.scrollTo({ top: memory.scrollY, behavior: 'instant' });
      });
    }
    function message(text) { if (scope()) { current.status = text; current.error = ''; } }
    function knownUrls() {
      return (getBundle()?.sources || []).map(source => source.url).filter(value => typeof value === 'string');
    }
    function rankOptions() {
      return { profile: settingsModel().effectiveProfile(current.profile, desiredSettings()), knownUrls: knownUrls(), feedback: current.feedback, contentLanguages: desiredLanguages()?.contentLanguages ?? null, limit: engine().LIMITS.articles, spread: true };
    }
    function readingInput() {
      if (!scope() || suspended || !current?.catalog?.feed || !current.profile || !current.feedback || !current.settings || !current.actions || !current.languageSettings ||
          busy() || inputDirty() || current.conflict || current.topicConflict || current.settingsConflict || current.actionConflict || current.languageConflict) {
        throw Object.assign(new Error('주제·언어·옵션과 남겨 둔 선택을 먼저 저장하거나 취소한 뒤 비교를 시작해 주세요.'), { code: 'discovery_unsaved' });
      }
      const effective = settingsModel().effectiveProfile(current.profile, current.settings);
      const feed = settingsModel().filterFeed(current.catalog.feed, current.settings);
      // A comparison freezes the ranking input only. Image links and their display terms are not part of it.
      for (const source of feed.sources) delete source.images;
      for (const article of feed.articles) delete article.imageUrl;
      const candidates = new Set(feed.articles.map(article => article.canonicalUrl));
      // Only URLs in this frozen candidate catalog can affect exclusion. A
      // large personal library must not make the bounded comparison unavailable.
      const known = [...new Set(knownUrls().map(value => engine().canonicalUrl(value)).filter(value => candidates.has(value)))];
      return clone({ feed,
        profile: { workspaceId, revision: current.profile.revision, manual: effective.manual.map(({ id, label }) => ({ id, label })) },
        feedback: current.feedback, knownUrls: known, contentLanguages: current.languageSettings.contentLanguages,
        actions: current.actions, translationTarget: confirmedTranslationTarget(), baselineMode: current.baselineMode,
        personalAllowed: current.actions.personalizationEnabled && !current.personalBlocked });
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
      capture(); current.collection = 'discover'; current.collectionUrls = null; resetList();
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
          message(intent.value ? (intent.kind === 'liked' ? '좋아요한 글에 추가했습니다.' : '담은 글에 추가했습니다. 원문은 보관하지 않았습니다.') : '반응을 해제했습니다. 되돌리거나 추천·기록의 반응 해제 기록에서 다시 선택할 수 있습니다.');
        } else if (intent.type === 'merge') { blockPersonal(); current.collectionUrls = null; current.copyPreview = null; current.copyEnvelope = null; message('사본의 새 항목을 추가했습니다. 기존 선택은 유지했고 추천 반영은 껐습니다.'); }
        else if (intent.type === 'clear') { blockPersonal(); downloadUrls.forEach(address => URL.revokeObjectURL(address)); downloadUrls.clear(); current.copyGeneration++; current.copyReading = false; current.copyPreview = null; current.copyEnvelope = null; current.lastReaction = null; current.collectionUrls = null; message('반응과 목록을 초기화했습니다. 자료 원문은 유지했습니다.'); }
        else if (intent.type === 'forget') { current.lastReaction = null; current.collectionUrls = current.collectionUrls?.filter(value => value !== intent.canonicalUrl) || null; message('이 글의 반응과 목록 정보를 완전히 지웠습니다. 자료 원문은 유지했습니다.'); }
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
    function react(article, kind, value, focusKey = 'reaction:' + kind + ':' + article.canonicalUrl) {
      if (!scope() || !current.actions || actionWrite || current.actionIntent) return;
      capture(article.id, focusKey);
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
      const fromSettings = current.settingsScreen;
      capture(); current.settingsScreen = false; current.collection = collection; current.collectionUrls = null; current.memory = null; resetList(); current.confirmForget = null; current.toast = null; current.selected = null; readerHistoryClosed(); draw();
      if (fromSettings) { surface.querySelector('#discoveryDiscover')?.focus(); surface.scrollIntoView({ block: 'start' }); }
    }
    function showSettings(value) {
      if (value === !!current.settingsScreen) return;
      if (value) capture();
      current.settingsScreen = value; draw();
      if (value) { current.settingsBack.focus({ preventScroll: true }); surface.scrollIntoView({ block: 'start' }); }
      else { surface.querySelector('#discoveryNewsSettings')?.focus({ preventScroll: true }); root.scrollTo({ top: current.memory?.scrollY || 0, behavior: 'instant' }); }
    }
    function setMode(mode) {
      if (!['latest', 'related', 'personal'].includes(mode) || mode === 'personal' && (!current.actions?.personalizationEnabled || current.personalBlocked)) return;
      capture(); current.collection = 'discover'; current.collectionUrls = null;
      if (mode === 'personal') applyPersonal();
      else { current.mode = mode; current.baselineMode = mode; current.memory = null; resetList(); draw(); }
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
      if (current.confirmReset) { details.append(node('p', '좋아요·담기·반응 해제 기록과 개인 추천 설정을 지웁니다. 자료 원문은 유지합니다.', 'life-meta'), button('반응·목록 초기화 확인', 'discoveryActionsResetConfirm', () => startAction({ type: 'clear' })), button('초기화 취소', 'discoveryActionsResetCancel', () => { current.confirmReset = false; draw(); }, 'discovery-quiet')); }
      return details;
    }
    function articleDetails(article, summaryText, className, kind) {
      const details = node('details', null, className), summary = node('summary', summaryText);
      const key = kind + ':' + article.canonicalUrl;
      current.openArticleDetails ||= new Set(); details.open = current.openArticleDetails.has(key);
      summary.setAttribute('aria-label', summaryText + ': ' + article.title);
      summary.dataset.focusKey = key;
      details.append(summary);
      details.addEventListener('toggle', () => {
        if (!scope() || !details.isConnected) return;
        if (details.open) current.openArticleDetails.add(key); else current.openArticleDetails.delete(key);
      });
      details.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !details.open) return;
        event.preventDefault(); event.stopPropagation(); details.open = false;
        current.openArticleDetails.delete(key); summary.focus({ preventScroll: true });
      });
      return details;
    }
    // 담기·좋아요 are icon toggles (filled = on, aria-pressed). The row has 담기; the reader has both.
    function reactionButton(article, kind, focusKey = 'reaction:' + kind + ':' + article.canonicalUrl) {
      const entry = entryFor(article), title = kind === 'liked' ? '좋아요' : '담기';
      const pressed = !!entry?.[kind], text = pressed ? title + ' 취소' : current.collection === 'cancelled' ? title + ' 복구' : title;
      const control = button(null, null, () => react(article, kind, !pressed, focusKey), 'discovery-reaction');
      control.setAttribute('aria-label', text); control.title = text; control.append(icon(kind === 'liked' ? 'heart' : 'bookmark'));
      control.dataset.discoveryReaction = kind; control.dataset.focusKey = focusKey; control.setAttribute('aria-pressed', String(pressed));
      control.disabled = !current.actions || !!actionWrite || !!current.actionIntent;
      return control;
    }
    function reactionMore(article, moreBody) {
      const entry = entryFor(article);
      if (entry) {
        const exclusion = isWide(article) ? null : button(entry.excludedFromRecommendations ? '추천 근거로 허용' : '추천에 사용하지 않기', null, () => startAction({ type: 'exclude', canonicalUrl: entry.canonicalUrl, value: !entry.excludedFromRecommendations }), 'discovery-quiet'); if (exclusion) { exclusion.dataset.discoveryExcludePersonal = ''; exclusion.disabled = !!actionWrite || !!current.actionIntent; moreBody.append(exclusion); }
        if (current.collection !== 'discover') {
          const forget = button('목록 정보 완전히 지우기', null, () => { current.confirmForget = entry.canonicalUrl; draw(); }, 'discovery-quiet'); forget.dataset.discoveryForget = ''; forget.disabled = !!actionWrite || !!current.actionIntent; moreBody.append(forget);
          if (current.confirmForget === entry.canonicalUrl) moreBody.append(node('p', '좋아요·담기와 복구 정보를 모두 지웁니다. 자료 원문은 유지합니다.', 'life-meta'), button('이 글의 반응 완전히 지우기', 'discoveryForgetConfirm', () => startAction({ type: 'forget', canonicalUrl: entry.canonicalUrl })), button('지우기 취소', 'discoveryForgetCancel', () => { current.confirmForget = null; draw(); }, 'discovery-quiet'));
        }
      }
    }
    // The list tabs, sort and settings controls are created once per surface and
    // updated in place. A redraw caused by another tab's or device's change (or
    // any background update) must not detach a control the user is pressing or
    // has focused; replacing it would drop that click and the focus.
    function headerControls() {
      if (current.header?.section && current.reactionHost?.contains(current.header.section)) return current.header;
      if (current.header?.section && !current.header.section.isConnected) current.header = null;
      if (current.header) return current.header;
      const section = node('section', null, 'discovery-reaction-header');
      // Refresh state: progress while the prepared catalog loads, failed sources, and a refresh control.
      const statusRow = node('div', null, 'discovery-status-row'), progress = node('p', '', 'discovery-progress'); progress.id = 'discoveryProgress'; progress.setAttribute('role', 'status');
      progress.append(icon('refresh', 16), node('span'));
      const failed = button(null, 'discoveryFailedSources', () => { current.optionsOpen = true; showSettings(true); if (current.options) current.options.open = true; }, 'discovery-failed');
      failed.title = '출처·갱신 설정 열기'; failed.append(icon('info', 16), node('span'));
      const refresh = button('지금 갱신', 'discoveryRefreshNow', () => { capture(null, 'refresh-now'); filter.open = false; refreshWide({ force: true }).catch(error => report(error)); return loadCatalog(); }, 'discovery-quiet discovery-refresh-now');
      refresh.dataset.focusKey = 'refresh-now'; refresh.title = '공개 글 목록 다시 확인'; refresh.prepend(icon('refresh', 16));
      statusRow.append(progress, failed);
      const toolbar = node('div', null, 'discovery-news-toolbar'), scroller = node('div', null, 'discovery-tab-scroller');
      const tabs = node('div', null, 'discovery-collection-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '뉴스 목록');
      const collections = [];
      for (const [collection, title, id] of [['discover', '전체', 'discoveryDiscover'], ['bookmarked', '담은 글', 'discoveryBookmarked'], ['liked', '좋아요', 'discoveryLiked'], ['excluded', '제외한 글', 'discoveryExcluded']]) {
        const control = button(null, id, () => selectCollection(collection), 'discovery-mode'); control.setAttribute('role', 'tab'); control.setAttribute('aria-controls', 'discoveryList');
        const label = node('span', title), count = node('span', '', 'discovery-tab-count'); control.append(label, count);
        tabs.append(control); collections.push({ collection, title, control, count });
      }
      tabs.addEventListener('keydown', event => {
        const controls = collections.map(item => item.control), index = controls.indexOf(root.document.activeElement);
        const next = index < 0 ? -1 : event.key === 'ArrowRight' ? (index + 1) % controls.length : event.key === 'ArrowLeft' ? (index - 1 + controls.length) % controls.length : event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); controls[next].focus(); controls[next].click();
      });
      scroller.append(tabs);
      // A fade at the end says more tabs can be scrolled into view.
      const hint = () => { scroller.dataset.more = String(scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1); };
      scroller.addEventListener('scroll', hint, { passive: true }); root.addEventListener('resize', hint);
      // 정렬·주제·언어 in one filter disclosure; its icon names how many differ from the defaults.
      const filter = node('details', null, 'discovery-filter'); filter.id = 'discoveryFilter';
      const filterSummary = node('summary', null, 'discovery-filter-toggle'); filterSummary.id = 'discoveryFilterToggle'; filterSummary.append(icon('filter'));
      const filterCount = node('span', '', 'discovery-filter-count'); filterCount.setAttribute('aria-hidden', 'true'); filterSummary.append(filterCount);
      const filterBody = node('div', null, 'discovery-filter-body');
      const sortLabel = node('label', '정렬', 'discovery-filter-label'); sortLabel.htmlFor = 'discoverySort';
      const sort = node('select', null, 'discovery-sort'); sort.id = 'discoverySort'; sort.setAttribute('aria-label', '글 정렬');
      for (const [value, label] of [['latest', '최신순'], ['related', '관심순'], ['personal', '개인 추천']]) { const option = node('option', label); option.value = value; sort.append(option); }
      // A chosen order closes the filter and keeps keyboard focus on its icon.
      sort.addEventListener('change', () => { if (scope()) { setMode(sort.value); filter.open = false; filterSummary.focus({ preventScroll: true }); } });
      const topicsLink = button('관심 주제', 'discoveryFilterTopics', () => { filter.open = false; current.topicsOpen = true; showSettings(true); if (current.editor) current.editor.open = true; }, 'discovery-quiet');
      const languagesLink = button('언어', 'discoveryFilterLanguages', () => { filter.open = false; current.languageOpen = true; showSettings(true); if (current.languageDetails) current.languageDetails.open = true; }, 'discovery-quiet');
      const imagesLink = button('기사 이미지', 'discoveryFilterImages', () => {
        filter.open = false; current.optionsOpen = true; showSettings(true); if (current.options) current.options.open = true;
        const toggle = root.document.getElementById('discoveryShowImages'); toggle?.focus({ preventScroll: true }); toggle?.scrollIntoView({ block: 'center' });
      }, 'discovery-quiet');
      filterBody.append(sortLabel, sort, topicsLink, languagesLink, imagesLink, refresh); filter.append(filterSummary, filterBody);
      const outside = event => { if (filter.open && !filter.contains(event.target)) filter.open = false; };
      filter.addEventListener('toggle', () => { if (filter.open) root.document.addEventListener('pointerdown', outside, true); else root.document.removeEventListener('pointerdown', outside, true); });
      filter.addEventListener('keydown', event => { if (event.key === 'Escape' && filter.open) { event.preventDefault(); event.stopPropagation(); filter.open = false; filterSummary.focus({ preventScroll: true }); } });
      const settings = button(null, 'discoveryNewsSettings', () => showSettings(true), 'discovery-news-settings-toggle');
      settings.setAttribute('aria-label', '뉴스 설정'); settings.title = '뉴스 설정'; settings.setAttribute('aria-controls', 'discoveryNewsSettingsPanel'); settings.append(icon('settings'));
      // Filter and settings end the tab row on the same right edge as each row's 담기.
      const listTools = node('div', null, 'discovery-list-tools');
      listTools.append(filter, settings); toolbar.append(scroller, listTools); section.append(statusRow, toolbar);
      current.header = { section, statusRow, progress, failed, refresh, toolbar, collections, sort, filter, filterSummary, filterCount, settings, hint };
      return current.header;
    }
    function recommendationControls() {
      const body = current.recommendationBody;
      if (current.recommendation?.body === body) return current.recommendation;
      const text = node('p', '', 'discovery-limitation'), apply = button('새 추천 보기', 'discoveryApplyRecommendations', applyPersonal), notice = node('p', '추천 근거가 바뀌었습니다.', 'discovery-notice');
      body.replaceChildren(text, apply, notice);
      current.recommendation = { body, text, apply, notice };
      return current.recommendation;
    }
    function filterChanges() {
      const languages = desiredLanguages()?.contentLanguages, settings = desiredSettings();
      return (current.mode !== 'latest' ? 1 : 0) + (Array.isArray(languages) ? 1 : 0) +
        (settings && (settings.disabledInterestIds.length || settingsModel().disabledSources(settings).length) ? 1 : 0);
    }
    // While an article is open, unsaved-choice recovery and errors show in its reader, where the action was taken.
    function actionsHeader(counts = {}, readerNotes = null) {
      const { section, statusRow, progress, failed, refresh, toolbar, collections, sort, filterSummary, filterCount, settings, hint } = headerControls();
      root.requestAnimationFrame(hint);
      for (const { collection, title, control, count } of collections) {
        const value = counts[collection], selected = current.collection === collection;
        control.setAttribute('aria-selected', String(selected)); control.tabIndex = selected || current.collection === 'cancelled' && collection === 'discover' ? 0 : -1;
        control.title = title + (Number.isInteger(value) ? ' ' + value : ''); count.textContent = Number.isInteger(value) ? ' ' + value : '';
      }
      for (const option of sort.options) {
        option.selected = current.mode === option.value;
        option.disabled = option.value === 'personal' && (!current.actions?.personalizationEnabled || current.personalBlocked);
      }
      if (sort.value !== current.mode && [...sort.options].some(option => option.value === current.mode)) sort.value = current.mode;
      sort.hidden = current.collection !== 'discover'; settings.setAttribute('aria-expanded', String(!!current.settingsScreen));
      const changed = filterChanges(); filterCount.textContent = changed ? String(changed) : '';
      filterSummary.setAttribute('aria-label', '정렬·주제·언어 (' + (changed ? '적용 ' + changed : '기본값') + ')'); filterSummary.title = '정렬·주제·언어';
      // The prepared catalog arrives as one file, so there is no per-source progress to count.
      const sources = (current.catalog?.feed?.sources || []).filter(source => !desiredSettings()?.disabledSourceIds?.includes(source.id));
      progress.lastChild.textContent = current.loading ? '새로 고치는 중' : '';
      progress.hidden = !current.loading;
      const failures = current.loading ? 0 : sources.filter(source => source.status === 'error').length;
      failed.lastChild.textContent = '출처 ' + failures + '곳 갱신 실패'; failed.hidden = !failures;
      refresh.disabled = current.loading; statusRow.hidden = !current.loading && !failures;
      // Messages below the toolbar are rebuilt; the toolbar itself stays attached.
      for (const child of [...section.children]) if (child !== toolbar && child !== statusRow) child.remove();
      current.preferencesBody.replaceChildren(personalPreferences());
      const actionHost = current.settingsScreen ? current.recoveryBody : readerNotes || section;
      if (current.personalOffIntent) actionHost.append(node('p', '개인 추천 중지 · 남겨 둔 선택을 해결해 주세요.', 'life-meta'));
      if (current.actionError) { const error = node('p', current.actionError, 'life-error'); error.id = 'discoveryActionsError'; error.setAttribute('role', 'alert'); actionHost.append(error); }
      if (current.actionIntent) {
        const recovery = node('div', null, 'discovery-recovery'); recovery.append(node('p', '남겨 둔 선택 · ' + ({ reaction: current.actionIntent.kind === 'liked' ? '좋아요' : '담기', personal: '개인 추천 ' + (current.actionIntent.value ? '켜기' : '끄기'), exclude: '추천 근거 변경', forget: '완전히 지우기', clear: '초기화', merge: '사본 추가' }[current.actionIntent.type]), 'life-meta'));
        const retry = button(current.actionConflict ? '최신 반응 확인' : '선택 다시 저장', current.actionConflict ? 'discoveryActionsReload' : 'discoveryActionsRetry', current.actionConflict ? reloadActions : persistAction); retry.disabled = !!actionWrite; recovery.append(retry);
        const discard = button('이번 선택 취소', 'discoveryActionsDiscard', discardAction, 'discovery-quiet'); discard.disabled = !!actionWrite; recovery.append(discard); actionHost.append(recovery);
      } else if (current.lastReaction) current.managementBody.append(button('방금 반응 되돌리기', 'discoveryReactionUndo', () => react(current.lastReaction.snapshot, current.lastReaction.kind, current.lastReaction.value), 'discovery-quiet'));
      return section;
    }
    function personalPreferences() {
      const section = node('div');
      const pendingOn = current.actionIntent?.type === 'personal' && current.actionIntent.value && !current.personalOffIntent;
      const personal = checkbox('좋아요를 개인 추천에 반영', 'discoveryPersonalize', !!pendingOn || (!!current.actions?.personalizationEnabled && !current.personalBlocked), personalize);
      personal.querySelector('input').disabled = !current.actions || (!current.actions.personalizationEnabled && !pendingOn && (!!actionWrite || !!current.actionIntent)); section.append(personal);
      section.append(node('p', '담기는 다시 볼 목록이며 추천에 반영하지 않습니다.', 'life-meta'));
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
        refreshWide().catch(error => report(error));
        current.translationBlocked = Object.hasOwn(current.languagePatch, 'translationTarget');
        message('언어 설정을 계정에 자동 저장했습니다.');
      } catch (_) { if (valid(token)) current.languageError = '언어 설정을 저장하지 못했습니다. 선택은 남아 있습니다. 다시 저장하거나 선택을 취소해 주세요.'; }
      finally {
        languageWrite = null;
        if (valid(token)) { draw(); if (!current.languageError && !current.languageConflict && languageDirty()) persistLanguages().catch(error => report(error)); }
      }
    }
    function changeLanguage(key, value) {
      if (!scope() || !current.languageSettings) return;
      if (key === 'translationTarget') stopTranslation();
      else { invalidateLanguageResults(); resetList(); }
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
      const selectedLabels = languageModel().CONTENT_LANGUAGE_CODES.filter(code => desired?.contentLanguages?.includes(code)).map(code => languageModel().CONTENT_LANGUAGE_LABELS[code]);
      const languageState = !desired ? '확인 필요' : desired.contentLanguages === null ? '전체 언어' : selectedLabels.length ? null : '선택 없음';
      const selectionSummary = languageState || selectedLabels.slice(0, 3).join('·') + (selectedLabels.length > 3 ? ' 외 ' + (selectedLabels.length - 3) + '개' : '');
      const summary = details.querySelector('summary'); summary.id = 'discoveryLanguageSummary';
      summary.textContent = '언어 옵션 · 콘텐츠: ' + selectionSummary;
      summary.setAttribute('aria-label', '언어 옵션 · 콘텐츠 언어: ' + (languageState || selectedLabels.join('·')));
      const languages = node('fieldset', null, 'discovery-content-languages'); languages.id = 'discoveryContentLanguages'; languages.append(node('legend', '콘텐츠 언어 (여러 개 선택)'));
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
      link.title = link.textContent; link.replaceChildren(root.HaedoLife.Icons.create('globe'));
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
        current.toast = intent.action === 'undo' ? null : { kind: intent.kind };
        if (intent.action !== 'undo' && current.selected?.canonicalUrl === intent.article.canonicalUrl) { current.selected = null; current.openArticleDetails?.delete('more:' + intent.article.canonicalUrl); readerHistoryClosed(); }
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
      for (const kind of ['more', 'card-more']) current.openArticleDetails?.delete(kind + ':' + article.canonicalUrl); // the chosen option closes its menu
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
        disabledInterestIds: ids(current.settings.disabledInterestIds, patch.interests, liveInterests), disabledSourceIds: ids(current.settings.disabledSourceIds, patch.sources),
        ...optionPatch(patch) }, { expectedRevision: current.settings.revision });
    }
    // The option choices not saved yet (기사 이미지 보기, 넓게 찾기 and its pending erase mark).
    // wideRefused: the refusal keys of 넓게 찾기 topics the server refused (kept so a new opening does not ask again).
    function optionPatch(patch) { return Object.fromEntries(['showImages', 'wideSearch', 'wideClear', 'wideRefused'].filter(name => patch[name] !== undefined).map(name => [name, patch[name]])); }
    function settingsDirty() { const p = current?.settingChanges; return !!p && (p.autoRefresh !== undefined || Object.keys(optionPatch(p)).length > 0 || Object.keys(p.interests).length > 0 || Object.keys(p.sources).length > 0); }
    // A new tab, order, filter or refresh starts the list again: 20 cards and a newly computed order.
    // A list computed again has not been used yet: answers that arrive before the person scrolls, presses or moves the
    // keyboard focus in it still take their place in the order (re-review MAJOR-B).
    function resetList() { current.visible = PAGE; current.order = null; current.listTouched = false; }
    // The person's first use of the drawn list: scrolling it (wheel, touch, scroll keys), 더 보기, a card's focus or press.
    function touchList() { if (current && !current.listTouched) current.listTouched = true; }
    // Focus the screen moves itself (restoring a place, the shell's own focus) is not a use; focus that follows the
    // person's key press (Tab into the list) is.
    let lastKeyAt = 0;
    function focusIntoList() { if (Date.now() - lastKeyAt < 1000) touchList(); }
    const SCROLL_KEYS = new Set(['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' ', 'Spacebar']);
    function pageScrollIntent(event) {
      if (event.type === 'keydown') lastKeyAt = Date.now();
      if (!scope() || !current || current.listTouched || current.settingsScreen || root.document.getElementById('lifeApp')?.hidden !== false) return;
      if (event.type === 'keydown' && (!SCROLL_KEYS.has(event.key) || event.target?.closest?.('input, textarea, select, [contenteditable]'))) return;
      touchList();
    }
    // 기사 이미지 보기 (default off): only then does a card ask a publisher's server for its image.
    function imagesOn() { return !!current?.settings && settingsModel().showImages(desiredSettings()); }
    function dropImages() {
      if (!current?.imageNodes) return;
      for (const media of current.imageNodes.values()) { media.querySelector('img')?.removeAttribute('src'); media.remove(); }
      current.imageNodes.clear();
    }
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
    function pageSuspend() { suspended = true; stopTimer(); cancelFetch(); cancelPrivateRead(); wideEpoch++; wideAborter?.abort(); wideAborter = null; if (current?.wide?.status === 'loading') { current.wide.status = current.wide.key ? 'ready' : 'idle'; current.wide.pendingKey = null; } }
    function pageReady() {
      // The shell emits this only after revalidating the account and revealing it.
      suspended = false;
      if (!scope() || root.document.getElementById('lifeApp')?.hidden !== false) return;
      // Suspend cancels the request while the app is hidden. Reflect that state
      // only after the shell has verified the returning account.
      if (current.selected && current.reader?.pageState !== current.selected.privateState) refreshPrivateRead();
      syncTransientControls();
      if (!current.catalog?.feed && canAuto()) loadCatalog(true).catch(error => report(error));
      else scheduleAuto();
    }
    async function loadCatalog(automatic = false) {
      if (!scope() || current.loading || (automatic && !canAuto())) return;
      const token = generation, epoch = ++fetchEpoch;
      aborter = new AbortController(); current.loading = true; current.error = ''; current.nextDue = Date.now() + INTERVAL; stopTimer();
      // A refresh the person asked for starts the list again; the timed one keeps the place being read.
      if (!automatic) resetList();
      draw();
      try {
        const result = await client.load({ signal: aborter.signal });
        if (!valid(token) || epoch !== fetchEpoch || (automatic && !canAuto())) return;
        const previous = current.catalog?.feed ? new Set(current.catalog.feed.articles.map(article => article.canonicalUrl)) : null;
        // A timed refresh keeps the drawn order (new articles join after it, see discoverItems); one asked for starts again.
        if (result.feed || !current.catalog) { current.catalog = result; if (!automatic) current.order = null; if (current.personalResult) current.personalPending = true; }
        if (previous && result.feed) { current.newUrls = new Set(result.feed.articles.map(article => article.canonicalUrl).filter(value => !previous.has(value))); current.newDismissed = false; }
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
      const next = settingsModel().update(current.settings, { autoRefresh: desired.autoRefresh, disabledInterestIds: desired.disabledInterestIds, disabledSourceIds: desired.disabledSourceIds,
        ...optionPatch(changes) }, { expectedRevision: current.settings.revision });
      current.settingsError = ''; settingsWrite = storage.saveDiscoverySettings(workspaceId, next, current.settings.revision); draw();
      try {
        const result = await settingsWrite;
        if (!valid(token)) return;
        if (result.status !== 'stored') { current.settingsConflict = true; current.autoBlocked = true; stopTimer(); cancelFetch(); current.settingsError = '다른 탭에서 옵션이 바뀌었습니다. 최신 옵션을 확인한 뒤 남겨 둔 선택을 다시 저장해 주세요.'; return; }
        const wasAuto = current.settings.autoRefresh; current.settings = result.settings;
        if (current.settingChanges.autoRefresh === changes.autoRefresh) delete current.settingChanges.autoRefresh;
        for (const name of ['showImages', 'wideSearch', 'wideClear', 'wideRefused']) if (JSON.stringify(current.settingChanges[name]) === JSON.stringify(changes[name])) delete current.settingChanges[name];
        for (const group of ['interests', 'sources']) for (const [id, value] of Object.entries(changes[group])) if (current.settingChanges[group][id] === value) delete current.settingChanges[group][id];
        current.autoBlocked = !desiredSettings().autoRefresh;
        if (!wasAuto && result.settings.autoRefresh) current.nextDue = Date.now() + INTERVAL;
        current.settingsError = ''; current.status = !current.catalog?.feed && !desiredSettings().autoRefresh ? '옵션을 저장했습니다. 목록을 아직 받지 못했습니다. 목록 다시 불러오기를 눌러 주세요.' : '주제·출처 옵션을 계정에 자동 저장했습니다.';
      } catch (_) { if (valid(token)) current.settingsError = '옵션을 저장하지 못했습니다. 선택은 남아 있습니다. 다시 저장하거나 취소해 주세요.'; }
      finally {
        settingsWrite = null;
        if (valid(token)) {
          draw(); scheduleAuto();
          // Only a saved choice sends anything: after the save, ask (on, or a changed topic) or erase (off).
          if (!current.settingsError && !settingsDirty()) { keepWideRefusals(); refreshWide().catch(error => report(error)); clearWide().catch(error => report(error)); }
          if (!current.settingsError && settingsDirty()) persistSettings().catch(error => report(error));
          else if (!current.settingsError && !current.catalog?.feed && canAuto()) loadCatalog(true).catch(error => report(error));
        }
      }
    }
    function changeSetting(group, id, enabled) {
      if (!scope() || !current.settings) return;
      if (group === 'autoRefresh') { current.settingChanges.autoRefresh = enabled; current.autoBlocked = !enabled; if (!enabled) { stopTimer(); cancelFetch(); if (!current.catalog?.feed) current.status = '목록을 아직 받지 못했습니다. 목록 다시 불러오기를 눌러 주세요.'; } }
      else if (group === 'showImages') current.settingChanges.showImages = enabled;
      else if (group === 'wideSearch') {
        // Off takes the found links off the screen at once and marks the server copy for erasing; on clears that mark.
        current.settingChanges.wideSearch = enabled; current.settingChanges.wideClear = !enabled && (settingsModel().wideSearch(current.settings) || settingsModel().wideClear(current.settings));
        // A new choice asks again: the topics the server refused before are tried once more (also the kept ones).
        current.wide.notEnabled = false; current.wide.clearError = false; current.wide.clearTried = false; current.wide.refused.clear(); if (!enabled) dropWide();
        if (settingsModel().wideRefused(current.settings).length) current.settingChanges.wideRefused = [];
      }
      else { current.settingChanges[group][id] = enabled; dropPersonal(true); resetList(); }
      current.settingsError = ''; draw(); persistSettings().catch(error => report(error));
    }
    async function reloadSettings() {
      const token = generation, result = await storage.readDiscoverySettings(workspaceId);
      if (!valid(token)) return;
      if (current.settings && current.settings.revision !== result.revision) dropPersonal(true);
      current.settings = result; current.settingsConflict = false; current.settingsError = ''; current.order = null;
      current.autoBlocked = !desiredSettings().autoRefresh; if (current.autoBlocked) { stopTimer(); cancelFetch(); } draw(); scheduleAuto();
      refreshWide().catch(error => report(error));
    }
    function focusTopicControl() {
      if (!scope() || current.editor.hidden) return;
      (current.editor.open ? current.topicInput : current.topicsSummary).focus({ preventScroll: true });
    }
    function showRelatedTopics() {
      current.mode = 'related'; current.baselineMode = 'related'; current.collection = 'discover'; current.collectionUrls = null; current.memory = null; resetList();
      current.settingsScreen = false;
      // The order now shows on the filter icon (적용 1); focus lands there, where 정렬 can be changed back.
      draw(); surface.querySelector('#discoveryFilterToggle')?.focus(); surface.scrollIntoView({ block: 'start' });
    }
    async function saveTopic() {
      if (!scope() || !current.profile || topicWrite || current.topicConflict || current.composing) return;
      const label = current.topicText.trim(); if (!label) return;
      if (current.profile.manual.some(item => item.label === label)) { current.topicError = '이미 저장한 주제입니다. 아래 체크로 선택해 주세요.'; draw(); return; }
      if (current.profile.manual.length >= 40) { current.topicError = '주제는 40개까지 저장할 수 있습니다. 관심 주제 편집에서 정리해 주세요.'; draw(); return; }
      const token = generation, submitted = current.topicText;
      const candidate = root.HaedoLife.InterestProfile.setManual(current.profile, [...current.profile.manual, { id: 'manual-' + root.crypto.randomUUID(), label }], { expectedRevision: current.profile.revision });
      current.topicError = ''; topicWrite = storage.saveInterestProfile(workspaceId, candidate, current.profile.revision); draw();
      try {
        const result = await topicWrite; if (!valid(token)) return;
        if (result.status !== 'stored') { current.topicConflict = true; current.topicError = '다른 탭에서 주제가 바뀌었습니다. 최신 주제를 확인한 뒤 입력을 다시 저장해 주세요.'; return; }
        current.profile = result.profile; current.order = null; dropPersonal(true); refreshWide().catch(error => report(error));
        if (current.topicText === submitted) { current.topicText = ''; current.topicInput.value = ''; }
        current.topicError = ''; current.topicSaved = true; current.status = '주제를 계정에 자동 저장했습니다.';
      } catch (_) { if (valid(token)) current.topicError = '주제를 저장하지 못했습니다. 입력은 남아 있습니다. 다시 저장하거나 입력을 지워 주세요.'; }
      finally { topicWrite = null; if (valid(token)) { draw(); focusTopicControl(); } }
    }
    async function reloadTopics() {
      const token = generation, profile = await storage.readInterestProfile(workspaceId);
      if (valid(token)) { current.profile = profile; current.topicConflict = false; current.topicError = current.topicText.trim() ? '최신 주제를 확인했습니다. 남겨 둔 입력을 다시 저장해 주세요.' : ''; draw(); refreshWide().catch(error => report(error)); }
    }
    function checkbox(text, id, checked, action, data, value) {
      const label = node('label', null, 'discovery-check'), input = node('input'); input.type = 'checkbox'; input.id = id; input.checked = checked;
      if (data) input.dataset[data] = value;
      input.addEventListener('change', () => { if (scope()) action(input.checked); }); label.append(input, node('span', text)); return label;
    }
    // The one line under the topic input: only while 넓게 찾기 is on and the typed text would not be sent.
    function topicWideNote() {
      const note = current?.topicWideNote; if (!note) return;
      const desired = desiredSettings(), text = current.topicText.trim(), result = text && wideModel() && desired && settingsModel().wideSearch(desired) ? wideModel().checkTopic(text) : null;
      const message = result && !result.ok ? '넓게 찾기에는 보내지 않습니다 · ' + wideModel().REASONS[result.reason] : '';
      if (note.textContent !== message) note.textContent = message;
      note.hidden = !message;
    }
    function drawEditor() {
      const host = current.editor, input = current.topicInput, desired = desiredSettings(), focused = root.document.activeElement, focusId = (host.contains(focused) || current.options.contains(focused)) && focused !== input ? focused.id : null;
      current.examples.hidden = !!current.profile?.manual?.length; current.examples.querySelectorAll('button').forEach(el => { el.disabled = !current.profile || !!topicWrite || !!current.topicText.trim(); });
      current.topicAdd.disabled = !current.profile || !!topicWrite || !current.topicText.trim() || current.topicConflict;
      current.topicDiscard.hidden = !current.topicText; current.topicDiscard.disabled = !!topicWrite;
      const choices = node('fieldset', null, 'discovery-topic-choices'); choices.append(node('legend', '목록에 사용할 주제'));
      for (const interest of current.profile?.manual || []) choices.append(checkbox(interest.label, 'discoveryInterest-' + interest.id, !desired?.disabledInterestIds.includes(interest.id), enabled => changeSetting('interests', interest.id, enabled), 'discoveryInterest', interest.id));
      if (!current.profile?.manual?.length) choices.append(node('p', '주제를 하나씩 추가해 주세요. 저장하기 전에는 목록에 사용하지 않습니다.', 'life-meta'));
      const edit = button('관심 주제 편집', 'discoveryOpenInterests', () => navigate(onOpenInterests, null, 'interests'), 'discovery-quiet'); edit.dataset.focusKey = 'interests'; choices.append(edit);
      current.choiceHost.replaceChildren(choices);
      current.wideHost.replaceChildren(wideSettings()); topicWideNote();
      const recovery = node('div', null, 'discovery-topic-recovery');
      if (current.topicError) { const error = node('p', current.topicError, 'life-error'); error.id = 'discoveryTopicError'; error.setAttribute('role', 'alert'); recovery.append(error); recovery.append(button(current.topicConflict ? '최신 주제 확인' : '주제 다시 저장', current.topicConflict ? 'discoveryTopicReload' : 'discoveryTopicRetry', current.topicConflict ? reloadTopics : saveTopic)); }
      current.topicRecovery.replaceChildren(recovery);
      const options = current.options; options.open = current.optionsOpen;
      const inside = node('div', null, 'discovery-options-body');
      inside.append(checkbox('자동 목록 갱신', 'discoveryAutoRefresh', !!desired?.autoRefresh, enabled => changeSetting('autoRefresh', null, enabled)));
      const autoStatus = node('p', current.autoBlocked || !current.settings?.autoRefresh ? '자동 목록 갱신 꺼짐' : root.document.visibilityState === 'hidden' || root.navigator.onLine === false ? '화면이 보이고 온라인일 때 다시 시작합니다.' : '자동 목록 갱신 켜짐 · 다음 확인 ' + new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(new Date(current.nextDue || Date.now() + INTERVAL)), 'life-meta'); autoStatus.id = 'discoveryAutoStatus'; autoStatus.setAttribute('role', 'status'); if (current.nextDue) autoStatus.dataset.nextDue = String(current.nextDue);
      inside.append(node('p', '이 화면을 보는 동안 15분마다 공개 목록을 다시 확인합니다. 화면이 숨겨지거나 닫혀 있으면 중지합니다. 원문을 자동으로 읽거나 보관하지 않습니다.', 'life-meta'), autoStatus);
      const showImages = checkbox('기사 이미지 보기', 'discoveryShowImages', imagesOn(), enabled => changeSetting('showImages', null, enabled));
      const imageHelp = node('p', '켜면 목록을 열 때 각 매체 서버에서 기사 이미지를 받습니다. 그 매체가 접속 사실을 알 수 있습니다. 이미지는 보관하지 않으며, 꺼 두면 이미지를 요청하지 않습니다.', 'life-meta'); imageHelp.id = 'discoveryShowImagesHelp';
      showImages.querySelector('input').setAttribute('aria-describedby', imageHelp.id); showImages.querySelector('input').disabled = !current.settings; inside.append(showImages, imageHelp);
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
      if (focusId) current.settingsPanel.querySelectorAll('[id]').forEach(el => { if (el.id === focusId && !el.disabled) el.focus({ preventScroll: true }); });
    }
    function ensureSurface() {
      if (surface?.isConnected && surface.dataset.workspace === workspaceId) return;
      surface = node('section', null, 'discovery-review discovery discovery-news'); surface.id = 'discoveryReview'; surface.dataset.workspace = workspaceId;
      const editor = node('details', null, 'discovery-topic-editor'), label = node('label', '찾고 싶은 주제', 'discovery-topic-label'); label.htmlFor = 'discoveryTopicInput';
      editor.id = 'discoveryTopics'; editor.open = current.topicsOpen;
      const topicsSummary = node('summary', '관심 주제'); topicsSummary.id = 'discoveryTopicsSummary';
      editor.append(topicsSummary);
      editor.addEventListener('toggle', () => {
        if (!scope() || current.editor !== editor || !editor.isConnected) return;
        current.topicsOpen = editor.open;
        if (!editor.open && editor.contains(root.document.activeElement) && root.document.activeElement !== topicsSummary) topicsSummary.focus({ preventScroll: true });
      });
      const form = node('form', null, 'discovery-topic-form'), input = node('input', null, 'life-input'); input.id = 'discoveryTopicInput'; input.type = 'text'; input.maxLength = 200; input.autocomplete = 'off'; input.value = current.topicText;
      input.setAttribute('aria-describedby', 'discoveryTopicHelp');
      input.addEventListener('compositionstart', () => { current.composing = true; }); input.addEventListener('compositionend', () => { current.composing = false; current.topicText = input.value; current.topicAdd.disabled = !current.topicText.trim() || !!topicWrite || current.topicConflict; current.topicDiscard.hidden = !current.topicText; topicWideNote(); });
      input.addEventListener('input', () => { current.topicText = input.value; current.topicAdd.disabled = !current.topicText.trim() || !!topicWrite || current.topicConflict || !current.profile; current.topicDiscard.hidden = !current.topicText; current.examples.querySelectorAll('button').forEach(el => { el.disabled = !current.profile || !!topicWrite || !!current.topicText.trim(); }); topicWideNote(); });
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.isComposing || current.composing || event.keyCode === 229)) event.preventDefault(); });
      form.addEventListener('submit', event => { event.preventDefault(); if (scope() && !current.composing) saveTopic().catch(error => report(error)); });
      const add = button('주제 추가', 'discoveryTopicAdd', saveTopic), discard = button('입력 지우기', 'discoveryTopicDiscard', () => { current.topicText = ''; input.value = ''; current.topicError = ''; current.topicConflict = false; draw(); focusTopicControl(); }, 'discovery-quiet');
      form.append(input, add, discard); const help = node('p', '현재 제목·태그에 있는 표현을 원문 언어로 적어 주세요. 검색어는 자동 번역하지 않습니다. 번역 언어는 원문 열기에만 적용됩니다.', 'life-meta'); help.id = 'discoveryTopicHelp';
      // While 넓게 찾기 is on: the typed topic is checked by the same rule the server uses, as it is typed.
      const wideNote = node('p', '', 'life-meta discovery-topic-wide-note'); wideNote.id = 'discoveryTopicWideNote'; wideNote.setAttribute('role', 'status'); wideNote.hidden = true;
      const examples = node('div', null, 'discovery-topic-examples'); examples.append(node('span', '예시 주제', 'life-meta'));
      for (const example of ['AI', '전시', '신간', '언어학', '언어 학습', '언어 교육']) examples.append(button(example, null, () => { if (current.topicText.trim() || topicWrite) return; current.topicText = example; input.value = example; return saveTopic(); }, 'discovery-quiet'));
      const choiceHost = node('div'), topicRecovery = node('div'), options = node('details', null, 'discovery-options'); options.id = 'discoveryOptions'; options.open = current.optionsOpen;
      options.append(node('summary', '출처·갱신')); const optionsBody = node('div'), catalogControls = node('div', null, 'discovery-controls'), catalogStatus = node('div');
      const refresh = button('목록 새로고침', 'discoveryRefresh', () => { capture(null, 'refresh'); refreshWide({ force: true }).catch(error => report(error)); return loadCatalog(); }, 'discovery-quiet'); refresh.dataset.focusKey = 'refresh'; refresh.title = '공개 글 목록 다시 확인'; refresh.prepend(root.HaedoLife.Icons.create('refresh')); catalogControls.append(refresh);
      options.append(optionsBody, catalogControls, catalogStatus); options.addEventListener('toggle', () => { if (scope()) current.optionsOpen = options.open; });
      const topicNextHost = node('div');
      const wideHost = node('div', null, 'discovery-wide-host');
      const topicBody = node('div', null, 'discovery-topic-body'); topicBody.append(label, form, wideNote, help, examples, topicRecovery, choiceHost, wideHost, topicNextHost); editor.append(topicBody);
      const reactionHost = node('div', null, 'discovery-reaction-host'), languageHost = node('div', null, 'discovery-language-host'), body = node('div', null, 'discovery-feed-body');
      const preferences = node('details', null, 'discovery-news-preferences'), preferencesBody = node('div', null, 'discovery-news-preferences-body'), recommendationBody = node('div');
      preferences.id = 'discoveryNewsPreferences'; preferences.open = !!current.preferencesOpen;
      preferences.append(node('summary', '추천'), preferencesBody, recommendationBody, readingHost);
      preferences.addEventListener('toggle', () => { if (scope() && preferences.isConnected) current.preferencesOpen = preferences.open; });
      const settingsPanel = node('section', null, 'discovery-news-settings'); settingsPanel.id = 'discoveryNewsSettingsPanel'; settingsPanel.setAttribute('aria-labelledby', 'discoveryNewsSettingsHeading');
      const settingsHeading = node('div', null, 'discovery-settings-heading'), settingsBack = button(null, 'discoveryNewsSettingsBack', () => showSettings(false));
      settingsBack.setAttribute('aria-label', '뉴스로 돌아가기'); settingsBack.title = '뉴스로 돌아가기'; settingsBack.append(root.HaedoLife.Icons.create('back'));
      const settingsTitle = node('h2', '뉴스 설정'); settingsTitle.id = 'discoveryNewsSettingsHeading'; settingsHeading.append(settingsBack, settingsTitle);
      const recoveryBody = node('div'), managementBody = node('div', null, 'discovery-management-body'), records = node('details', null, 'discovery-record-settings');
      records.id = 'discoveryRecords'; records.open = !!current.recordsOpen; records.append(node('summary', '기록 관리'), managementBody);
      records.addEventListener('toggle', () => { if (scope() && records.isConnected) current.recordsOpen = records.open; });
      settingsPanel.append(settingsHeading, recoveryBody, editor, languageHost, preferences, options, records);
      // List and reading column. The reader host stays attached so an open original page is never reloaded by a redraw.
      const layout = node('div', null, 'discovery-layout'), listPane = node('section', null, 'discovery-list-pane'), readerHost = node('div', null, 'discovery-reader-host');
      listPane.setAttribute('aria-label', '뉴스 목록'); listPane.id = 'discoveryListPane'; readerHost.id = 'discoveryReaderHost';
      for (const type of ['pointerdown', 'keydown', 'wheel', 'touchmove']) listPane.addEventListener(type, touchList, { passive: true });
      listPane.addEventListener('focusin', focusIntoList);
      listPane.append(reactionHost, body); layout.append(listPane, readerHost);
      surface.append(layout, settingsPanel); container.replaceChildren(surface);
      current.reader = null;
      Object.assign(current, { editor, topicsSummary, examples, topicInput: input, topicWideNote: wideNote, topicAdd: add, topicDiscard: discard, choiceHost, wideHost, topicRecovery, topicNextHost, options, optionsBody, catalogControls, catalogStatus, reactionHost, languageHost, preferences, preferencesBody, recommendationBody, body, settingsPanel, settingsBack, recoveryBody, managementBody, records, layout, listPane, readerHost });
    }
    function currentFeedArticle(article) {
      return current?.catalog?.feed?.articles.find(value => value.id === article.id && value.sourceId === article.sourceId && value.canonicalUrl === article.canonicalUrl) ||
        current?.wide?.items.find(value => value.id === article.id && value.canonicalUrl === article.canonicalUrl) || null;
    }
    // An article now listed (catalog or 넓게 찾기) by its address.
    function listedArticle(canonicalUrl) {
      return current?.catalog?.feed?.articles.find(item => item.canonicalUrl === canonicalUrl) || current?.wide?.items.find(item => item.canonicalUrl === canonicalUrl) || null;
    }
    const isWide = article => article?.sourceId === engine().WIDE_SOURCE.id;

    // ---- 넓게 찾기 ----------------------------------------------------------------------------------------
    // Sent: the interest topics typed in news settings and left checked, and the content language codes. Nothing
    // from likes, saved or read articles, the recommendation profile or any derived word reaches these functions.
    function wideRemote() {
      if (!wideClient && storage.isAccountScoped && wideModel()?.create) {
        try { wideClient = wideModel().create({ storage, isCurrent: id => scope() && id === workspaceId }); } catch (_) { wideClient = null; }
        // Signing out or changing the account takes the found links out of memory at once.
        if (wideClient) wideUnlisten ||= root.HaedoAuth?.onAccountChange?.(() => {
          const account = root.HaedoAuth.getAccount?.(), owner = storage.account;
          if (current?.wide && (account?.userId !== owner?.userId || account?.projectUrl !== owner?.projectUrl)) dropWide();
        }) || null;
      }
      return wideClient;
    }
    // The saved choice only: an unsaved or conflicting toggle sends nothing.
    function wideSaved() { return !!current?.settings && settingsModel().wideSearch(current.settings) && current.settingChanges.wideSearch === undefined && !current.settingsConflict; }
    function widePlan() {
      if (!wideModel() || !current?.profile || !current.settings || !current.languageSettings) return null;
      const manual = settingsModel().effectiveProfile(current.profile, current.settings).manual.map(({ id, label }) => ({ id, label }));
      const planned = wideModel().plan(manual, { refused: wideRefusedKeys() }), codes = wideModel().languages(current.languageSettings.contentLanguages);
      return { ...planned, languages: codes, key: wideModel().requestKey(planned.topics, codes) };
    }
    // The topics not to send again: refused in this opening, or kept in the account's news settings.
    function wideRefusedKeys() { return new Set([...current.wide.refused, ...(current.settings ? settingsModel().wideRefused(desiredSettings()) : [])]); }
    // Keep the refusals of this opening in the account's news settings, for the topics still typed (at most eight).
    function keepWideRefusals() {
      if (!scope() || !current.settings || !current.profile || settingsWrite || current.settingsConflict || current.settingChanges.wideRefused !== undefined) return;
      const typed = new Set(current.profile.manual.map(item => wideModel().checkTopic(item.label)).filter(result => result.ok).map(result => wideModel().refusalKey(result.topic)));
      const keys = [...wideRefusedKeys()].filter(key => typed.has(key)).slice(-settingsModel().WIDE_REFUSED_MAX);
      const stored = settingsModel().wideRefused(current.settings);
      if (JSON.stringify([...keys].sort()) === JSON.stringify([...stored].sort())) return;
      current.settingChanges.wideRefused = keys; persistSettings().catch(error => report(error));
    }
    function dropWide() {
      wideEpoch++; wideAborter?.abort(); wideAborter = null;
      if (current?.wide) { Object.assign(current.wide, { items: [], topics: [], fetchedAt: null, stale: false, status: 'idle', error: null, key: null, pendingKey: null, loadedAt: 0 }); current.order = null; }
    }
    // One request for all topics. The plan already holds only topics that pass the server's rule (the screen's copy of
    // it). Safety net, should the server still refuse the request for a topic (`invalid_topic`, e.g. a browser whose
    // Unicode tables differ): each topic is asked once on its own, the refused ones are named in settings, kept in the
    // account's news settings (keepWideRefusals) and left out from then on, also after the app is opened again.
    async function askWide(client, planned, signal, live) {
      const ask = topics => client.load({ topics, languages: planned.languages, workspaceId, signal });
      const refuse = topic => { if (live()) current.wide.refused.add(wideModel().refusalKey(topic)); };
      try { return await ask(planned.topics); }
      catch (error) {
        if (error?.code !== 'wide_invalid_topic' || !live()) throw error;
        if (planned.topics.length === 1) { refuse(planned.topics[0]); return wideModel().merge([]); }
        const results = [];
        for (const topic of planned.topics) {
          try { results.push(await ask([topic])); }
          catch (inner) { if (inner?.code !== 'wide_invalid_topic' || !live()) throw inner; refuse(topic); }
        }
        return wideModel().merge(results);
      }
    }
    async function refreshWide({ force = false } = {}) {
      if (!scope() || suspended || !current?.wide) return;
      if (!wideSaved()) { if (current.wide.items.length || current.wide.status !== 'idle') { dropWide(); draw(); } return; }
      const planned = widePlan(), client = wideRemote();
      if (!planned || !client || current.wide.notEnabled) return;
      if (!planned.topics.length || !planned.languages.length) { if (current.wide.items.length || current.wide.status !== 'idle') { dropWide(); draw(); } return; }
      if (current.wide.status === 'loading' && current.wide.pendingKey === planned.key) return; // one request at a time
      if (!force && current.wide.key === planned.key && Date.now() - current.wide.loadedAt < WIDE_REUSE_MS) return;
      wideEpoch++; wideAborter?.abort();
      const epoch = wideEpoch, token = generation, controller = new AbortController(); wideAborter = controller;
      // Links found for other topics leave the screen before the new answer arrives.
      if (current.wide.key !== planned.key) Object.assign(current.wide, { items: [], topics: [], fetchedAt: null, stale: false, key: null });
      // Whether the list is looked at before this answer arrives (draw marks it). Until then the answer may still
      // take its place in the order, e.g. 넓게 찾기 turned on in settings with the list hidden behind them.
      current.wide.listSeen = false;
      Object.assign(current.wide, { status: 'loading', pendingKey: planned.key, error: null }); capture(); draw(); restore();
      const refusedBefore = current.wide.refused.size;
      try {
        const result = await askWide(client, planned, controller.signal, () => valid(token) && epoch === wideEpoch);
        if (!valid(token) || epoch !== wideEpoch) return;
        if (!wideSaved()) { Object.assign(current.wide, { items: [], topics: [], fetchedAt: null, stale: false, status: 'idle', key: null }); return; }
        const fetchedAt = result.fetchedAt || new Date().toISOString();
        const items = result.items.map(item => wideModel().toArticle(item, { sourceId: engine().WIDE_SOURCE.id, canonicalUrl: engine().canonicalUrl, fetchedAt })).filter(article => article.canonicalUrl && wideModel().link(article.url));
        // The answer covers the topics that were asked and taken.
        const answered = planned.topics.filter(topic => !current.wide.refused.has(wideModel().refusalKey(topic)));
        // A list the person has not used yet (no scroll, 더 보기, card focus or press since it was computed), or one the
        // settings covered since the request, takes the links in its order. A list in use keeps every drawn card; the
        // links join after them and 새 글 n건 counts them, like a timed refresh's articles.
        if (!current.listTouched || !current.wide.listSeen) current.order = null;
        if (current.order) {
          const listed = new Set(current.order.urls), added = items.map(article => article.canonicalUrl).filter(value => !listed.has(value));
          if (added.length) { current.newUrls = new Set([...(current.newDismissed ? [] : current.newUrls || []), ...added]); current.newDismissed = false; }
        }
        Object.assign(current.wide, { items, topics: result.topics, fetchedAt: result.fetchedAt, stale: result.stale, status: 'ready', error: null, key: wideModel().requestKey(answered, planned.languages), loadedAt: Date.now() });
      } catch (error) {
        if (!valid(token) || epoch !== wideEpoch) return;
        if (error?.code === 'wide_cancelled') current.wide.status = current.wide.key ? 'ready' : 'idle';
        else {
          // The fixed sources stay as they are; links already shown for these topics stay too.
          Object.assign(current.wide, { status: 'error', error: wideModel().messages[error?.code] ? error.code : 'wide_unavailable' });
          if (error?.code === 'wide_not_enabled') {
            // This account is not allowed: said once, the switch goes back to off (saved) and nothing is asked again.
            Object.assign(current.wide, { notEnabled: true, items: [], topics: [], key: null, status: 'idle', error: null });
            if (settingsModel().wideSearch(current.settings) && current.settingChanges.wideSearch === undefined && !current.settingsConflict) {
              current.settingChanges.wideSearch = false; current.settingChanges.wideClear = true; persistSettings().catch(error => report(error));
            }
          }
        }
      } finally {
        if (epoch === wideEpoch) {
          wideAborter = null;
          if (valid(token)) {
            current.wide.pendingKey = null; capture(); draw(); restore();
            // A refused topic left the plan: it is kept in news settings, and a typed topic beyond the first eight may now be sent.
            if (current.wide.refused.size > refusedBefore) keepWideRefusals();
            if (current.wide.refused.size > refusedBefore && current.wide.status === 'ready') refreshWide().catch(error => report(error));
          }
        }
      }
    }
    // After 넓게 찾기 is turned off: erase the server copy. A failure keeps the mark so the next opening tries again.
    async function clearWide({ manual = false } = {}) {
      if (!scope() || suspended || !current?.settings || wideClearing || settingsDirty() || current.settingsConflict) return;
      if (settingsModel().wideSearch(current.settings) || !settingsModel().wideClear(current.settings)) return;
      const client = wideRemote(); if (!client) return;
      if (current.wide.clearTried && !manual) return; // once per opening unless asked
      const token = generation; current.wide.clearTried = true; current.wide.clearError = false;
      wideClearing = client.clear({ workspaceId }); draw();
      try {
        await wideClearing; if (!valid(token)) return;
        if (!settingsModel().wideSearch(current.settings) && !settingsDirty()) { current.settingChanges.wideClear = false; persistSettings().catch(error => report(error)); }
      } catch (error) { if (valid(token) && error?.code !== 'wide_cancelled') current.wide.clearError = true; }
      finally { wideClearing = null; if (valid(token)) draw(); }
    }
    const wideTime = value => { const text = stamp(value); return text ? text + ' 기준' : ''; };
    // One line above the list when what is shown is not a fresh answer for every topic.
    function wideNotice() {
      const wide = current.wide; if (current.collection !== 'discover') return '';
      if (wide.notEnabled) return '이 계정에서는 넓게 찾기를 쓸 수 없어 꺼 두었습니다.';
      if (!wideSaved()) return '';
      if (wide.status === 'loading') return '넓게 찾는 중';
      if (wide.status === 'error') return { wide_not_enabled: '', wide_auth: '넓게 찾기 · 로그인 계정을 다시 확인해 주세요.', 
        wide_invalid: '넓게 찾기 · 받은 결과를 확인하지 못했습니다. 고정 출처의 글만 보입니다.' }[wide.error] ?? '넓게 찾기 · 지금 가져오지 못했습니다. 고정 출처의 글은 그대로 보입니다.';
      if (wide.status !== 'ready') return '';
      const states = wide.topics.map(row => row.status), time = wideTime(wide.fetchedAt);
      if (states.includes('limited')) return '넓게 찾기 · 받을 수 있는 횟수를 다 썼습니다.' + (time ? ' ' + time + ' 목록입니다.' : '');
      if (states.length && states.every(state => state === 'failed')) return '넓게 찾기 · 새 글을 받지 못했습니다. 고정 출처의 글만 보입니다.';
      if (wide.stale || states.some(state => state === 'stale' || state === 'failed')) return '넓게 찾기 · 일부 주제를 새로 받지 못했습니다.' + (time ? ' ' + time + ' 목록이 섞여 있습니다.' : '');
      if (widePlan()?.rows.some(row => row.reason === 'refused')) return '넓게 찾기 · 서버가 받지 않는 주제가 있습니다. 뉴스 설정에서 확인해 주세요.';
      return '';
    }
    // 넓게 찾기 in news settings: the switch, what it sends and where, and each typed topic's state.
    function wideSettings() {
      const box = node('div', null, 'discovery-wide-settings'), available = !!wideRemote(), desired = desiredSettings();
      const on = !!desired && settingsModel().wideSearch(desired);
      const toggle = checkbox('넓게 찾기', 'discoveryWideSearch', on, enabled => changeSetting('wideSearch', null, enabled));
      const help = node('p', '켜면 위에 직접 적어 켜 둔 관심 주제와 콘텐츠 언어(한국어·영어)를 ' + (wideModel()?.SUPPLIER_LABEL || 'Google 뉴스') + '로 보내 여러 매체의 최신 글을 받습니다. 좋아요·담은 글·읽은 글은 보내지 않습니다. 글을 누르면 Google 주소를 거쳐 원문으로 갑니다. 받은 결과는 내 계정 서버에만 보관하고, 끄면 지웁니다. 담은 글과 읽음·관련 없음 기록은 남습니다.', 'life-meta');
      help.id = 'discoveryWideHelp'; toggle.querySelector('input').setAttribute('aria-describedby', help.id); toggle.querySelector('input').disabled = !current.settings || !available;
      box.append(toggle, help);
      if (!available) box.append(node('p', '로그인한 계정에서만 쓸 수 있습니다.', 'life-meta'));
      const planned = on ? widePlan() : null;
      if (planned) {
        const names = { ko: '한국어', en: '영어' }, list = node('ul', null, 'discovery-wide-topics'); list.id = 'discoveryWideTopics'; list.setAttribute('aria-label', '보내는 관심 주제');
        for (const row of planned.rows) {
          const line = node('li'); line.dataset.wideTopic = row.id; line.dataset.wideSent = String(row.sent); line.append(node('span', row.label, 'discovery-wide-topic'));
          if (!row.sent) line.append(node('span', '보내지 않음 · ' + wideModel().REASONS[row.reason], 'discovery-wide-topic-note'));
          else {
            const states = current.wide.key === planned.key ? current.wide.topics.filter(state => state.topic === row.topic) : [];
            const text = states.map(state => names[state.language] + ' ' + ({ fresh: state.count + '건', cached: state.count + '건', stale: state.count + '건(이전 목록)', failed: '받지 못함', limited: '횟수 제한' + (state.count ? ' · ' + state.count + '건' : '') }[state.status])).join(' · ');
            line.append(node('span', text || (current.wide.status === 'loading' ? '받는 중' : '보냄'), 'discovery-wide-topic-note'));
          }
          list.append(line);
        }
        if (planned.rows.length) box.append(node('p', '보내는 주제 · 위에서부터 ' + wideModel().LIMITS.topics + '개까지', 'life-meta'), list,
          node('p', '주제는 글자·숫자와 일부 기호만 받습니다. 따옴표·괄호·쌍점·별표, 글자·숫자 사이가 아닌 빼기, 이어진 점, 낱말 사이의 대문자 OR·AND·NOT은 받지 않습니다. 받는 예: ' + wideModel().EXAMPLES.accepted.join(', ') + ' · 받지 않는 예: ' + wideModel().EXAMPLES.refused.join(', '), 'life-meta'));
        else box.append(node('p', '보낼 관심 주제가 없습니다. 위에서 주제를 추가하거나 고르면 그 주제로 찾습니다.', 'life-meta'));
        if (planned.rows.length && !planned.languages.length) box.append(node('p', '콘텐츠 언어에 한국어나 영어가 없어 보내지 않습니다.', 'life-meta'));
      }
      if (current.wide.notEnabled) { const refused = node('p', '이 계정에서는 넓게 찾기를 쓸 수 없어 꺼 두었습니다.', 'life-error'); refused.id = 'discoveryWideNotEnabled'; refused.setAttribute('role', 'alert'); box.append(refused); }
      if (!on && desired && settingsModel().wideClear(desired)) {
        const pending = node('p', wideClearing ? '서버에 보관한 결과를 지우고 있습니다.' : current.wide.clearError ? '서버에 보관한 결과를 아직 지우지 못했습니다. 뉴스를 다시 열 때 다시 시도합니다.' : '서버에 보관한 결과를 지울 차례입니다.', 'life-meta'); pending.id = 'discoveryWideClearStatus'; pending.setAttribute('role', 'status'); box.append(pending);
        if (current.wide.clearError && !wideClearing) box.append(button('지금 다시 지우기', 'discoveryWideClearRetry', () => clearWide({ manual: true }), 'discovery-quiet'));
      }
      return box;
    }
    // The rows 넓게 찾기 adds to 전체: links in the chosen content languages that are not already kept, judged or listed.
    function wideRows(fixed) {
      if (!wideSaved() || !current.wide.items.length) return [];
      const languages = desiredLanguages()?.contentLanguages ?? null, known = new Set(knownUrls().map(value => engine().canonicalUrl(value)).filter(Boolean));
      const judged = new Set((current.feedback?.feedback || []).map(entry => entry.canonicalUrl)), sources = current.catalog?.feed?.sources || [];
      // The same article from a fixed source: only an exact title with the exact publisher name counts.
      const listed = new Set(fixed.flatMap(item => [sourceName(item.article, sources), engine().PUBLISHERS[item.article.sourceId]].filter(Boolean).map(name => item.article.title + '\n' + name)));
      return current.wide.items.filter(article => engine().languageAllowed(article.language, languages) && !known.has(article.canonicalUrl) && !judged.has(article.canonicalUrl) && !listed.has(article.title + '\n' + article.sourceName))
        .map(article => ({ article, reasons: article.wide?.topic ? [{ interestLabel: article.wide.topic }] : [] }));
    }
    // 전체: the ranked catalog rows with the found links. Latest order spreads publishers over each page of 20
    // (both kinds counted); 관심순 lists the found links after the matched catalog rows; 개인 추천 shows the catalog only.
    function discoverItems(result) {
      const mode = result.metadata?.mode, fixed = result.items, wide = mode === 'personal' ? [] : wideRows(fixed);
      let items = !wide.length ? fixed : mode === 'latest' ? engine().spreadLatest([...fixed, ...wide]) : [...fixed, ...engine().spreadLatest(wide, { perPublisher: wide.length })];
      // The latest order, once drawn, keeps its pages until the tab, order, filter or a refresh the person asks for
      // (DESIGN.md): a card that leaves does not move the others, and rows that arrive later (the 15-minute refresh, a
      // 넓게 찾기 answer) join after the drawn cards under the same publisher cap, never between them. 관심순 and
      // 개인 추천 keep their own order.
      if (mode !== 'latest') return items;
      const key = current.mode + ':' + mode, url = item => item.article.canonicalUrl;
      if (current.order?.key !== key) { if (!current.loading) current.order = { key, urls: items.map(url) }; return items; }
      const place = new Map(current.order.urls.map((value, index) => [value, index]));
      const known = items.filter(item => place.has(url(item))).sort((a, b) => place.get(url(a)) - place.get(url(b))), fresh = items.filter(item => !place.has(url(item)));
      if (!fresh.length) return known;
      const drawn = known.slice(0, Math.max(PAGE, current.visible || PAGE));
      items = [...drawn, ...engine().spreadAfter(drawn, [...known.slice(drawn.length), ...fresh])];
      if (!current.loading) current.order = { key, urls: items.map(url) };
      return items;
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
    function importButton(article, { focusKey = 'import:' + article.id, currentFeedOnly = false, getArticle = () => article } = {}) {
      const review = button(article.coverage === 'link_only' ? '링크를 자료에 보관' : '자료에 보관', null, () => navigate(onImport, getArticle(), focusKey, currentFeedOnly), 'discovery-review-button');
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
    function sourceName(article, sources = current.catalog?.feed?.sources || []) {
      return sources.find(value => value.id === article.sourceId)?.name || article.sourceName || '출처 미확인';
    }
    function articleMeta(article, sources, { relative = false } = {}) {
      const meta = node('span', null, 'discovery-meta'), name = sourceName(article, sources), source = node('span', name, 'discovery-source-name');
      source.title = name; meta.append(source);
      const shown = article.dateStatus === 'valid' || current.collection !== 'discover';
      const published = shown && (relative ? elapsed(article.publishedAt) : stamp(article.publishedAt));
      if (published) { const time = node('time', published); time.dateTime = article.publishedAt; time.title = date(article.publishedAt, true) || ''; meta.append(time); }
      if (article.language && !/^ko\b/i.test(article.language)) { const language = node('abbr', article.language.split('-')[0].toUpperCase(), 'discovery-language'); language.title = '원문 언어 ' + article.language; meta.append(language); }
      return meta;
    }
    // The publisher's own image for a card, in a fixed 16:9 box. The element is kept across redraws so a
    // list update neither asks for the image again nor blinks; a failed image leaves a text card.
    function cardMedia(article) {
      const state = current, address = state.imageByUrl?.get(article.canonicalUrl);
      if (!address || state.failedImages.has(address)) return null;
      let media = state.imageNodes.get(address);
      if (!media) {
        media = node('span', null, 'discovery-card-media'); const image = node('img');
        image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer'; image.setAttribute('referrerpolicy', 'no-referrer');
        const failed = () => { state.failedImages.add(address); state.imageNodes.delete(address); media.closest('.discovery-card')?.removeAttribute('data-image'); media.remove(); };
        image.addEventListener('error', failed, { once: true });
        image.addEventListener('load', () => { if (image.naturalWidth < 2 || image.naturalHeight < 2) failed(); }, { once: true });
        image.src = address; media.append(image); state.imageNodes.set(address, media);
      }
      return media;
    }
    // 글 옵션: the same choices in a card's ⋯ and in the reader. `received` is the body the reader holds, if any.
    function optionsBody(article, { prefix = '', importKey, received = null, getArticle = () => article } = {}) {
      const moreBody = node('div', null, 'discovery-more-body');
      const review = importButton(received || article, { focusKey: importKey, getArticle });
      const read = button('읽음', null, () => feedback(article, 'already_read'), 'discovery-quiet'); read.dataset.discoveryFeedback = 'already_read'; read.dataset.focusKey = prefix + 'feedback:' + article.id + ':already_read';
      const irrelevant = button('관련 없음', null, () => feedback(article, 'not_relevant'), 'discovery-quiet'); irrelevant.dataset.discoveryFeedback = 'not_relevant'; irrelevant.dataset.focusKey = prefix + 'feedback:' + article.id + ':not_relevant';
      const excluded = current.feedback?.feedback?.some(entry => entry.canonicalUrl === article.canonicalUrl);
      read.disabled = irrelevant.disabled = !!current.pending || busy() || !!excluded || !currentFeedArticle(article);
      const information = articleInformation(article, received, prefix + 'info');
      moreBody.append(review, read, irrelevant); reactionMore(article, moreBody); moreBody.append(information);
      return { moreBody, review, information };
    }
    // A card's ⋯. Its choices are built when it opens, so a closed menu adds no hidden controls to the list.
    function cardMenu(article) {
      const more = articleDetails(article, '글 옵션', 'discovery-more discovery-card-more', 'card-more'), summary = more.querySelector('summary');
      summary.title = '글 옵션'; summary.replaceChildren(icon('more'));
      const fill = () => { if (!more.querySelector('.discovery-more-body')) more.append(optionsBody(article, { prefix: 'card-', importKey: 'card-import:' + article.id }).moreBody); };
      if (more.open) fill();
      more.addEventListener('toggle', () => {
        if (!scope() || !more.isConnected) return;
        if (!more.open) { more.querySelector('.discovery-more-body')?.remove(); return; }
        fill();
        for (const other of surface.querySelectorAll('.discovery-card-more[open]')) if (other !== more) other.open = false;
      });
      return more;
    }
    // Pressing anywhere else closes an open card menu (Escape closes it and returns focus to ⋯).
    function closeCardMenus(event) {
      if (!active || !surface?.isConnected) return;
      for (const menu of surface.querySelectorAll('.discovery-card-more[open]')) if (!menu.contains(event.target)) menu.open = false;
    }
    // Card: [publisher image] · two-line title · 출처 · 경과 시간 [· 언어 · 관심 주제 · 좋아요] · 담기 · ⋯.
    // The image and title are one control that opens the reader; 담기 and ⋯ follow it in the tab order.
    function articleCard(item, sources) {
      const { article } = item, card = node('article', null, 'discovery-article discovery-card'); card.dataset.discoveryId = article.id; card.dataset.discoveryUrl = article.canonicalUrl;
      if (isWide(article)) return wideCard(item, card);
      const open = node('button', null, 'discovery-row-open'); open.type = 'button'; open.dataset.discoverySelect = ''; open.dataset.focusKey = 'open:' + article.id;
      const media = cardMedia(article); if (media) { open.append(media); card.dataset.image = 'true'; }
      open.append(node('span', article.title, 'discovery-title'));
      const foot = node('div', null, 'discovery-card-foot'), meta = articleMeta(article, sources, { relative: true });
      meta.id = 'discoveryMeta-' + article.id; open.setAttribute('aria-describedby', meta.id);
      const label = (item.reasons || []).find(reason => reason.interestLabel)?.interestLabel;
      if (label) { const topic = node('span', label, 'discovery-topic-badge'); topic.title = '관심 주제 ' + label; meta.append(topic); }
      if (entryFor(article)?.liked) { const liked = icon('heart', 16); liked.setAttribute('role', 'img'); liked.setAttribute('aria-label', '좋아요한 글'); liked.removeAttribute('aria-hidden'); liked.classList.add('discovery-liked-mark'); meta.append(liked); }
      if (current.selected?.canonicalUrl === article.canonicalUrl) { open.setAttribute('aria-current', 'true'); card.dataset.selected = 'true'; }
      open.addEventListener('click', () => { if (scope()) select(article); });
      // The rest of the card (its meta line) opens the same article for a pointer; 담기 and ⋯ keep their own press.
      card.addEventListener('click', event => { if (scope() && !event.target.closest('button, summary, details, a') && !String(root.getSelection?.() || '')) select(article); });
      foot.append(meta, reactionButton(article, 'bookmarked'), cardMenu(article));
      card.append(open, foot);
      return card;
    }
    // The one control of a found link: a real link to the supplier's address, new tab only, never the reading column.
    // Title and publisher name are text; the address is set as a property after it is checked again.
    function wideOpen(article) {
      const address = wideModel()?.link(article.url) || null, open = node(address ? 'a' : 'div', null, 'discovery-row-open');
      if (address) {
        open.href = address; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.referrerPolicy = 'no-referrer'; open.setAttribute('referrerpolicy', 'no-referrer');
        open.dataset.discoveryOpen = ''; open.dataset.focusKey = 'open:' + article.id; open.setAttribute('aria-label', article.title + ' · 새 탭에서 열림');
        open.addEventListener('click', event => { if (!scope() || !wideModel().link(open.getAttribute('href'))) { event.preventDefault(); return; } capture(article.id, 'open:' + article.id); });
      }
      open.append(node('span', article.title, 'discovery-title'));
      return open;
    }
    function wideCard(item, card) {
      const { article } = item, open = wideOpen(article); card.dataset.wide = 'true';
      const foot = node('div', null, 'discovery-card-foot'), meta = articleMeta(article, [], { relative: true });
      meta.id = 'discoveryMeta-' + article.id; open.setAttribute('aria-describedby', meta.id);
      const mark = node('span', '넓게', 'discovery-wide-mark'); mark.title = '넓게 찾기로 받은 글'; meta.append(mark);
      const label = (item.reasons || []).find(reason => reason.interestLabel)?.interestLabel;
      if (label) { const topic = node('span', label, 'discovery-topic-badge'); topic.title = '관심 주제 ' + label; meta.append(topic); }
      foot.append(meta, reactionButton(article, 'bookmarked'), cardMenu(article));
      card.append(open, foot);
      return card;
    }
    function excludedCard(entry, available) {
      const card = node('article', null, 'discovery-article discovery-card discovery-excluded-article'); card.dataset.discoveryUrl = entry.canonicalUrl; if (available) card.dataset.discoveryId = available.id;
      const title = available?.title || entry.canonicalUrl, body = available && isWide(available) ? wideOpen(available) : node(available ? 'button' : 'div', null, 'discovery-row-open');
      if (available && isWide(available)) body.replaceChildren();
      else if (available) {
        body.type = 'button'; body.dataset.discoverySelect = ''; body.dataset.focusKey = 'open:' + available.id; body.addEventListener('click', () => { if (scope()) select(available); });
        card.addEventListener('click', event => { if (scope() && !event.target.closest('button, summary, details, a') && !String(root.getSelection?.() || '')) select(available); });
      }
      body.append(node('span', title, 'discovery-title'));
      const foot = node('div', null, 'discovery-card-foot'), meta = available ? articleMeta(available, undefined, { relative: true }) : node('span', null, 'discovery-meta');
      if (!available) meta.append(node('span', '현재 목록에 없는 글'));
      meta.prepend(node('span', entry.kind === 'already_read' ? '읽음' : '관련 없음', 'discovery-topic-badge'));
      const restoreButton = button('되돌리기', null, () => undo(available || { id: entry.articleId, canonicalUrl: entry.canonicalUrl, title }), 'discovery-quiet discovery-restore');
      restoreButton.dataset.discoveryRestore = entry.articleId; restoreButton.setAttribute('aria-label', '제외 되돌리기: ' + title); restoreButton.disabled = !!current.pending || busy();
      foot.append(meta, restoreButton); card.append(body, foot); return card;
    }
    // 더 보기 adds one page; focus moves to the first card it added.
    function showMore(from) {
      if (!scope()) return;
      current.visible = from + PAGE; draw();
      const added = current.body.querySelectorAll('#discoveryList > .discovery-article')[from]?.querySelector('[data-discovery-select], a.discovery-row-open[data-discovery-open], button');
      if (!added) return;
      added.focus({ preventScroll: true }); added.closest('.discovery-article').scrollIntoView({ block: 'nearest' });
      capture(added.closest('[data-discovery-id]')?.dataset.discoveryId, added.dataset.focusKey);
    }
    // Where the reader replaces the list (below 1101px) opening it is a new history entry; the browser's
    // back closes it. The wide reading column beside the list stays on the same entry.
    const readerReplacesList = () => !!root.matchMedia?.('(max-width: 1100px)').matches;
    function readerHistoryClosed() { if (current?.readerPushed) { current.readerPushed = false; onReaderHistory?.(null); } }
    function select(article, { history = true } = {}) {
      cancelPrivateRead();
      capture(article.id, 'open:' + article.id);
      if (history && onReaderHistory && readerReplacesList()) { current.readerPushed = true; onReaderHistory(article.id); }
      current.selected = { canonicalUrl: article.canonicalUrl, article: clone(article), returnFocus: 'open:' + article.id, privateState: canReadPrivate(article) ? 'loading' : 'fallback', privateArticle: null, privateError: '' };
      current.toast = null; draw();
      if (canReadPrivate(article)) loadPrivateRead(current.selected);
      root.requestAnimationFrame(() => {
        if (!scope() || !current.reader?.element.isConnected) return;
        const narrow = root.matchMedia?.('(max-width: 1100px)').matches;
        (narrow ? current.reader.back : current.reader.title).focus({ preventScroll: !narrow });
        if (narrow) root.scrollTo({ top: 0, behavior: 'instant' });
      });
    }
    function closeReader({ history = true } = {}) {
      cancelPrivateRead();
      const key = current.selected?.returnFocus; current.selected = null;
      if (history) readerHistoryClosed(); else current.readerPushed = false;
      draw();
      if (current.memory) restore();
      root.requestAnimationFrame(() => { if (scope()) [...surface.querySelectorAll('[data-discovery-select]')].find(el => el.dataset.focusKey === key)?.focus({ preventScroll: true }); });
    }
    function findArticle(id) {
      return current?.catalog?.feed?.articles.find(value => value.id === id) || current?.actions?.entries.map(entry => entry.snapshot).find(value => value?.id === id) || null;
    }
    // Browser back/forward within news: open or close an article without writing history again.
    function showArticle(id) {
      if (!scope() || !current) return false;
      if (!id) { if (current.selected) closeReader({ history: false }); current.readerPushed = false; return true; }
      const article = findArticle(id); if (!article || isWide(article)) return false;
      current.settingsScreen = false; select(article, { history: false }); current.readerPushed = true; return true;
    }
    function selectedArticle() {
      const selected = current.selected; if (!selected) return null;
      // The selected metadata and received body are one reading snapshot. A feed
      // refresh may replace the list, but must never silently replace this title or body.
      return selected.article;
    }
    function canReadPrivate(article) {
      return !!privateReader?.loadPrivateArticle && !!root.HaedoLife.DiscoveryReaderUI?.create &&
        ['frontiers-psychology', 'mit-linguistics', 'llt-journal'].includes(article?.sourceId);
    }
    function cancelPrivateRead() {
      privateEpoch++;
      if (privateAborter && current?.selected?.privateState === 'loading') { current.selected.privateState = 'error'; current.selected.privateError = '읽기가 중단됐습니다. 다시 불러와 주세요.'; }
      privateAborter?.abort(); privateAborter = null;
    }
    async function loadPrivateRead(selected) {
      if (!scope() || suspended || current.selected !== selected || !canReadPrivate(selected.article)) return;
      const retryHadFocus = root.document.activeElement === current.reader?.page.querySelector('#discoveryReaderRetry');
      cancelPrivateRead(); const epoch = privateEpoch, token = generation, controller = new AbortController(); privateAborter = controller;
      selected.privateState = 'loading'; selected.privateError = ''; selected.privateArticle = null; draw();
      const loadingFocus = retryHadFocus ? current.reader?.page.querySelector('#discoveryReaderStatus') : null;
      if (loadingFocus) { loadingFocus.tabIndex = -1; loadingFocus.focus({ preventScroll: true }); }
      const live = () => valid(token) && !suspended && !controller.signal.aborted && epoch === privateEpoch && current.selected === selected;
      try {
        const received = await privateReader.loadPrivateArticle(selected.article, { workspaceId, signal: controller.signal });
        if (!live()) return;
        const text = received?.coverage === 'full_text' ? received.bodyText : received?.coverage === 'summary' ? received.summary : '';
        if (received?.privateReader && typeof text === 'string' && text.trim()) {
          selected.privateArticle = clone(received); selected.privateState = 'ready';
        } else selected.privateState = 'unavailable';
      } catch (error) {
        if (!live()) return;
        selected.privateState = 'error';
        selected.privateError = error?.code === 'discovery_private_rate_limited' ? '요청이 많습니다. 잠시 뒤 다시 불러와 주세요.' : '본문을 불러오지 못했습니다. 다시 시도해 주세요.';
      } finally {
        if (live()) { privateAborter = null; refreshPrivateRead(); }
      }
    }
    function disposeReaderView() { current?.reader?.privateBody?.dispose(); if (current) current.reader = null; }
    function refreshPrivateRead() {
      const view = current?.reader, selected = current?.selected;
      if (!scope() || !view?.element.isConnected || view.selection !== selected) return;
      const focusedStatus = view.page.querySelector('#discoveryReaderStatus');
      const restoreRetryFocus = focusedStatus && root.document.activeElement === focusedStatus;
      drawReaderPage(view, selected.article);
      // Keep the toolbar and its pressed/focused controls attached while a
      // background response arrives. Only the import result and source details change.
      const received = selected.privateArticle, article = selected.article;
      view.review.textContent = (received || article).coverage === 'link_only' ? '링크를 자료에 보관' : '자료에 보관';
      view.review.disabled = selected.privateState === 'loading' || !!current.pending || !!pendingWrite;
      const updated = articleInformation(article, received);
      while (view.information.children.length > 1) view.information.lastElementChild.remove();
      view.information.append(...[...updated.children].slice(1));
      // A retry replaces its own button. Keep keyboard users in the reading
      // pane, but never take focus back after they move to another control.
      if (restoreRetryFocus && !focusedStatus.isConnected) (view.privateBody?.element || view.page.querySelector('#discoveryReaderRetry'))?.focus({ preventScroll: true });
    }
    // Full-screen reading on a phone: everything behind the reader is inert until it closes.
    let inerted = [];
    const phone = root.matchMedia?.('(max-width: 760px)');
    function syncInert() {
      for (const element of inerted) element.inert = false; inerted = [];
      if (!active || !phone?.matches || root.document.body?.dataset.haedoImmersive !== 'news') return;
      let element = current?.reader?.element;
      while (element && element.parentElement && element !== root.document.body) {
        for (const sibling of element.parentElement.children) if (sibling !== element && !sibling.inert && !['SCRIPT', 'STYLE'].includes(sibling.tagName)) { sibling.inert = true; inerted.push(sibling); }
        element = element.parentElement;
      }
    }
    phone?.addEventListener?.('change', () => syncInert());
    function setImmersive(on) {
      const body = root.document.body; if (!body) return;
      if (on) body.dataset.haedoImmersive = 'news'; else if (body.dataset.haedoImmersive === 'news') delete body.dataset.haedoImmersive;
      syncInert();
    }
    // Only the article body changes; the current news shell owns history, focus and controls.
    function drawReaderPage(view, article) {
      const selected = current.selected, state = selected.privateState || 'fallback';
      if (view.pageState === state) return;
      view.privateBody?.dispose(); view.privateBody = null; view.pageState = state;
      const page = view.page; page.replaceChildren(); page.setAttribute('aria-busy', String(state === 'loading'));
      view.element.dataset.readerState = state;
      const host = (() => { try { return new URL(url(article.url) || '').hostname; } catch (_) { return ''; } })();
      if (state === 'ready' && selected.privateArticle) {
        const received = selected.privateArticle;
        page.dataset.frame = 'private'; page.setAttribute('aria-label', '확보한 원문');
        const bar = node('div', null, 'discovery-reader-host-bar'), coverage = node('span', received.coverage === 'summary' ? '초록' : '본문');
        coverage.id = 'discoveryReaderCoverage'; coverage.dataset.coverage = received.coverage;
        bar.append(coverage, node('span', host));
        view.privateBody = root.HaedoLife.DiscoveryReaderUI.create({ article: received });
        page.append(bar, view.privateBody.element); return;
      }
      page.setAttribute('aria-label', '원문 페이지' + (host ? ' (' + host + ')' : ''));
      if (state === 'loading' || state === 'error' || state === 'unavailable') {
        const status = node('div', null, 'discovery-reader-status');
        const message = node('p', state === 'loading' ? '본문을 불러오는 중입니다.' : state === 'unavailable' ? '본문을 받지 못했습니다. 원문에서 읽을 수 있습니다.' : selected.privateError,
          state === 'error' ? 'life-error' : 'life-meta');
        message.id = 'discoveryReaderStatus'; message.setAttribute('role', state === 'error' ? 'alert' : 'status'); status.append(message);
        if (state !== 'loading') status.append(button('본문 다시 불러오기', 'discoveryReaderRetry', () => loadPrivateRead(selected), 'discovery-quiet'));
        page.append(status);
        if (state === 'loading') { page.dataset.frame = 'loading'; return; }
      }
      const address = frameAddress(article);
      if (address) {
        const bar = node('span', null, 'discovery-reader-host-bar'); bar.append(node('span', host));
        const frame = node('iframe', null, 'discovery-reader-frame'); frame.id = 'discoveryReaderFrame';
        frame.src = address; frame.referrerPolicy = 'no-referrer'; frame.setAttribute('referrerpolicy', 'no-referrer'); frame.setAttribute('sandbox', FRAME_SANDBOX);
        frame.title = '원문 페이지: ' + article.title; frame.loading = 'eager';
        page.dataset.frame = 'allowed'; page.append(bar, frame);
      } else {
        page.dataset.frame = 'blocked';
        if (state === 'fallback') page.append(node('p', '이 출처는 앱 안에서 열 수 없습니다. 새 탭에서 원문을 엽니다.', 'discovery-reader-blocked'));
        const fallback = originalLink(article, { text: '새 탭에서 열기', focusKey: 'reader-open-fallback:' + article.canonicalUrl });
        fallback.className = 'life-button discovery-reader-fallback'; fallback.removeAttribute('data-discovery-open'); page.append(fallback);
      }
    }
    function drawReader() {
      const article = !current.settingsScreen && selectedArticle();
      surface.dataset.reading = String(!!article); setImmersive(!!article);
      if (!article) {
        cancelPrivateRead(); disposeReaderView();
        current.readerHost.replaceChildren(); return;
      }
      let view = current.reader;
      if (!view || view.selection !== current.selected || !view.element.isConnected) {
        disposeReaderView();
        const element = node('article', null, 'discovery-reader'); element.id = 'discoveryReader'; element.dataset.readerUrl = article.canonicalUrl; element.setAttribute('aria-label', '원문 보기');
        const back = button(null, 'discoveryReaderBack', closeReader, 'discovery-reader-back'); back.setAttribute('aria-label', '뉴스로 돌아가기'); back.title = '뉴스로 돌아가기'; back.append(icon('back'), node('span', '뉴스'));
        const head = node('div', null, 'discovery-reader-head'), tools = node('div', null, 'discovery-reader-tools');
        tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', '글 동작');
        const page = node('section', null, 'discovery-reader-page'), notes = node('div', null, 'discovery-reader-notes');
        const title = node('h2', article.title, 'discovery-reader-title'); title.id = 'discoveryReaderTitle'; title.tabIndex = -1;
        head.append(articleMeta(article), title); element.append(back, head, tools, notes, page);
        view = current.reader = { url: article.canonicalUrl, selection: current.selected, element, back, head, tools, notes, page, title, pageState: null, privateBody: null };
        current.readerHost.replaceChildren(element);
      }
      drawReaderPage(view, article);
      const received = current.selected.privateArticle;
      const actions = [], translated = translationLink(article, { focusKey: 'reader-translate:' + article.canonicalUrl });
      if (translated) { translated.append(node('span', languageModel().TRANSLATION_TARGET_LABELS[confirmedTranslationTarget()], 'discovery-tool-label')); actions.push(translated); }
      // Reactions and feedback retain the original public metadata, never the private body/receipt.
      actions.push(reactionButton(article, 'bookmarked', 'reader-reaction:bookmarked:' + article.canonicalUrl), reactionButton(article, 'liked', 'reader-reaction:liked:' + article.canonicalUrl));
      const more = articleDetails(article, '글 옵션', 'discovery-more', 'more');
      more.querySelector('summary').title = '글 옵션'; more.querySelector('summary').replaceChildren(icon('more'));
      const selected = current.selected;
      const { moreBody, review, information } = optionsBody(article, { importKey: 'reader-import:' + article.canonicalUrl, received, getArticle: () => selected.privateArticle || article });
      review.disabled ||= current.selected.privateState === 'loading';
      view.review = review; view.information = information;
      more.append(moreBody); actions.push(more);
      const external = originalLink(article, { text: '새 탭에서 열기', focusKey: 'reader-open:' + article.canonicalUrl });
      external.className = 'discovery-reader-external'; external.title = '새 탭에서 열기'; external.setAttribute('aria-label', '새 탭에서 원문 열기 · ' + article.title); external.replaceChildren(icon('external'), node('span', '새 탭', 'discovery-tool-label'));
      actions.push(external);
      view.tools.replaceChildren(...actions);
      syncInert();
    }
    function articleInformation(article, received = null, kind = 'info') {
      const information = articleDetails(article, '기사 정보', 'discovery-article-info', kind);
      if (!date(article.publishedAt)) information.append(node('p', '발행일 미확인', 'life-meta'));
      else information.append(node('p', '발행 ' + date(article.publishedAt, true), 'life-meta'));
      if (article.dateBasis === 'updated' && date(article.updatedAt)) information.append(node('p', '수정 ' + date(article.updatedAt), 'life-meta'));
      const item = rank()?.items.find(value => value.article.canonicalUrl === article.canonicalUrl), reasons = item?.reasons || [];
      if ((current.mode === 'related' || current.mode === 'personal' && !item?.personal && current.baselineMode === 'related') && reasons.length) {
        const reason = reasons[0], field = { title: '제목', summary: '공개 요약', bodyText: '허용된 본문', tags: '출처 태그' }[reason.field] || '공개 글';
        information.append(node('p', '보관한 관심 ‘' + reason.interestLabel + '’ · ' + field + '에 ‘' + reason.quote + '’' + (reason.via === 'related' ? ' · 관련 표현' : ''), 'discovery-reason'));
        const evidence = node('details', null, 'discovery-evidence'); evidence.append(node('summary', '찾은 근거'));
        reasons.slice(0, 5).forEach(ref => {
          const where = { title: '제목', summary: '공개 요약', bodyText: '허용된 본문', tags: '출처 태그' }[ref.field] || '공개 글';
          evidence.append(node('p', where + ' · 관심 ‘' + ref.interestLabel + '’' + (ref.via === 'related' ? '의 관련 표현' : ref.via === 'alias' ? '의 같은 표현' : ''), 'life-meta'), node('blockquote', ref.quote));
        }); if (reasons.length > 5) evidence.append(node('p', '일치한 표현 ' + reasons.length + '개 중 5개를 표시합니다.', 'life-meta')); information.append(evidence);
      }
      if (item?.personal && !current.personalBlocked) {
        const why = node('details', null, 'discovery-personal-evidence'); why.append(node('summary', '왜 이 글인가'));
        for (const evidence of item.personal.evidence || []) why.append(node('p', '좋아요한 글 ‘' + evidence.title + '’의 ' + (evidence.field === 'tags' ? '보관한 태그' : '보관한 제목') + '와 이 글의 ' + (evidence.candidateField === 'tags' ? '공개 태그' : '제목') + '의 대응 표현 · ‘' + evidence.quote + '’ / ‘' + evidence.candidateQuote + '’', 'life-meta'));
        why.append(node('p', '보관한 제목·태그와 공개 후보의 표현 유사도입니다. 태그 한 개는 한 표현으로 세며 서로 다른 표현 2개 이상이 겹쳐야 반영합니다. 본문 이해·동의·품질 확률을 뜻하지 않습니다.', 'life-meta')); information.append(why);
      }
      if (current.collection !== 'discover' && !listedArticle(article.canonicalUrl)) information.append(node('p', '현재 목록에 없음 · 보관한 제목·출처', 'discovery-notice'));
      if (current.collection !== 'discover') information.append(node('p', received ? '반응 기록에는 제목·출처만 보관합니다.' : '보관한 제목·출처 정보 · 원문 본문은 보관하지 않았습니다.', 'discovery-coverage'));
      const savedEntry = entryFor(article);
      if (current.collection === 'liked' && savedEntry && !savedEntry.liked || current.collection === 'bookmarked' && savedEntry && !savedEntry.bookmarked) information.append(node('p', '반응 해제됨', 'discovery-notice'));
      const source = received || article;
      const coverage = received ? received.coverage === 'full_text' ? '본문 확보' : '초록만 확보 · 원문 전체 미확보' : article.coverage === 'full_text' ? '허용된 본문 확보' : article.coverage === 'summary' ? '공개 요약만 확보 · 원문 전체 미확보' : '링크와 제목만 확보 · 본문 미확보';
      information.append(node('p', coverage, 'discovery-coverage'));
      if (received) {
        if (date(received.acquisition?.fetchedAt)) information.append(node('p', '수집 ' + date(received.acquisition.fetchedAt, true), 'life-meta'));
        information.append(node('p', '자료에 보관하면 읽고 있는 본문과 출처를 저장합니다. 이미지는 포함하지 않습니다.', 'life-meta'));
      } else information.append(node('p', frameAddress(article) ? '앱 안 보기는 출판사 서버에서 직접 받습니다. 원문 내용은 보관하지 않습니다.' : '원문은 새 탭에서 열 수 있습니다.', 'life-meta'));
      if (source.rights?.label) information.append(node('p', source.rights.label, 'life-meta'));
      if (isWide(article)) information.append(node('p', '넓게 찾기로 받은 글' + (article.wide?.topic ? ' · 주제 ‘' + article.wide.topic + '’' : '') + ' · 글을 누르면 Google 주소를 거쳐 원문으로 갑니다.', 'life-meta'));
      const imageTerms = current.imageByUrl?.has(article.canonicalUrl) && current.catalog?.feed?.sources.find(value => value.id === article.sourceId)?.images?.label;
      if (imageTerms) information.append(node('p', imageTerms, 'life-meta'));
      return information;
    }
    function draw() {
      if (!scope()) return;
      const focused = root.document.activeElement, settingsFocus = current.settingsScreen && current.settingsPanel?.contains(focused) ? { element: focused, id: focused.id, key: focused.dataset.focusKey, scrollY: root.scrollY || 0 } : null;
      ensureSurface(); current.editor.hidden = false; drawEditor(); surface.setAttribute('aria-busy', String(busy()));
      current.reactionHost.hidden = current.body.hidden = current.layout.hidden = !!current.settingsScreen; current.settingsPanel.hidden = !current.settingsScreen;
      if (!current.settingsScreen && current.wide) current.wide.listSeen = true;
      // 2026-11-07 owner decision: like 자료, no reading column until an article is opened. Wide screens
      // show the list alone (data-wide); an opened article reads beside it (data-split) with the separator.
      const reading = !current.settingsScreen && !!selectedArticle();
      if (current.settingsScreen) { delete container.dataset.split; delete container.dataset.wide; disposeSplit(); }
      else if (reading) { container.dataset.split = 'news'; delete container.dataset.wide; ensureSplit(); }
      else { delete container.dataset.split; container.dataset.wide = 'news'; disposeSplit(); }
      current.managementBody.replaceChildren(); current.recoveryBody.replaceChildren(); current.catalogStatus.replaceChildren(); current.topicNextHost.replaceChildren();
      const readerOpen = !current.settingsScreen && !!selectedArticle(), readerNotes = node('div');
      const body = node('div'), recoveryHost = current.settingsScreen ? current.recoveryBody : readerOpen ? readerNotes : body;
      const feed = current.catalog?.feed, result = rank();
      const discover = result ? discoverItems(result) : null;
      const tabCounts = { discover: discover?.length, bookmarked: current.actions?.entries.filter(entry => entry.bookmarked).length, liked: current.actions?.entries.filter(entry => entry.liked).length, excluded: current.feedback?.feedback?.length };
      const header = actionsHeader(tabCounts, readerOpen ? readerNotes : null); if (current.reactionHost.firstChild !== header || current.reactionHost.childNodes.length !== 1) current.reactionHost.replaceChildren(header);
      const languages = languageControls(); if (languages.parentNode !== current.languageHost) current.languageHost.replaceChildren(languages);
      current.catalogControls.querySelector('#discoveryRefresh').disabled = current.loading;
      const status = node('p', current.loading ? '공개 글 목록을 불러오고 있습니다.' : current.status, 'discovery-status sr-only'); status.id = 'discoveryStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = !status.textContent; body.append(status);
      if (current.collection === 'discover' && current.topicSaved && current.mode === 'latest') {
        const topicNext = node('div', null, 'discovery-topic-next');
        topicNext.append(node('p', '최신순은 주제로 걸러지지 않습니다.', 'discovery-limitation'), button('관심순으로 보기', 'discoveryTopicRelated', showRelatedTopics, 'discovery-quiet'));
        current.topicNextHost.append(topicNext);
      }
      const error = node('p', current.error, 'life-error'); error.id = 'discoveryError'; error.setAttribute('role', 'alert'); error.hidden = !current.error; recoveryHost.append(error);
      if (current.error && !current.loading && (!current.languageSettings || !current.profile || !current.feedback || !current.settings || !current.actions)) recoveryHost.append(button('다시 확인', 'discoveryRetry', render));
      if (current.topicError || current.settingsError || current.languageError || current.topicConflict || current.settingsConflict || current.languageConflict || readingUI?.dirty() || current.copyPreview || current.copyReading || current.copyError) body.append(button('설정 확인', 'discoverySettingsRecovery', () => showSettings(true), 'discovery-quiet'));
      if (current.pending) {
        const recovery = node('div', null, 'discovery-recovery');
        recovery.append(node('p', '남겨 둔 선택 · ' + (current.pending.action === 'undo' ? '제외 되돌리기' : current.pending.kind === 'already_read' ? '읽음' : '관련 없음') + ' · ' + (current.pending.article.title || current.pending.article.canonicalUrl), 'life-meta'));
        if (current.conflict) recovery.append(button('최신 제외 목록 확인', 'discoveryFeedbackReload', reloadFeedback));
        else { const retry = button('선택 다시 보관', 'discoveryFeedbackRetry', persistIntent); retry.disabled = !!pendingWrite; recovery.append(retry); }
        const discard = button('선택 취소', 'discoveryFeedbackDiscard', () => { current.pending = null; current.conflict = false; message('이번 선택을 취소했습니다. 보관된 제외 목록은 유지했습니다.'); draw(); restore(); }); discard.disabled = !!pendingWrite; recovery.append(discard); recoveryHost.append(recovery);
      } else if (current.lastFeedback) current.managementBody.append(button('방금 제외 되돌리기', 'discoveryUndo', () => undo(current.lastFeedback), 'discovery-quiet'));
      // The recommendation note and its action are updated in place (see headerControls).
      const recommendation = recommendationControls(); current.recommendationBody.hidden = !(current.collection === 'discover' && current.mode === 'personal');
      if (current.collection === 'discover' && current.mode === 'personal') {
        const explanation = current.personalBlocked ? '개인 추천은 꺼져 있습니다.' : current.personalResult?.metadata?.personalization?.applied ? '좋아요한 글에 보관한 제목·태그와 겹치는 표현으로 찾았습니다.' : current.personalPending && current.personalResult ? '지금 목록 순서를 유지하고 이전 개인 추천 점수·근거를 제거했습니다. 새 추천 보기로 다시 계산할 수 있습니다.' : (current.personalInspection?.signalCount ? '좋아요 근거와 표현이 겹치는 후보가 없어 ' : '개인 추천에 사용할 좋아요 근거가 부족해 ') + (current.baselineMode === 'latest' ? '최신순' : '관심순') + '을 보여 줍니다.';
        const settled = !!current.personalResult && !current.personalPending;
        const brief = current.personalResult?.metadata?.personalization?.applied ? '보관한 좋아요의 표현으로 찾은 글입니다.' : '추천 근거가 부족해 ' + (current.baselineMode === 'latest' ? '최신순' : '관심순') + '을 보여 줍니다.';
        recommendation.text.textContent = settled ? brief : explanation;
        const apply = recommendation.apply; apply.disabled = current.personalBlocked || !current.catalog?.feed || !!actionWrite || !!current.actionIntent || !!languageWrite || languageDirty() || current.languageConflict; apply.hidden = settled;
        recommendation.notice.hidden = !current.personalPending;
      }
      if (feed) {
        const stale = current.catalog.stale || result?.metadata?.stale;
        if (stale) current.catalogStatus.append(node('p', '일부 출처 갱신 지연', 'discovery-notice discovery-feed-notice'));
      }
      const list = node('div', null, 'discovery-list'); list.id = 'discoveryList'; list.setAttribute('role', 'tabpanel'); list.setAttribute('aria-label', '뉴스 목록');
      // Image addresses come from the validated current catalog only (a saved reaction keeps none).
      current.imageByUrl = feed && imagesOn() ? new Map(feed.articles.filter(article => article.imageUrl).map(article => [article.canonicalUrl, article.imageUrl])) : null;
      if (!current.imageByUrl) dropImages();
      let rows = [];
      const emptyTab = (heading, text, iconName) => {
        const box = node('div', null, 'discovery-empty'); box.append(node('h2', heading, 'discovery-empty-title'));
        const line = node('p', null, 'discovery-empty-text'); if (iconName) line.append(icon(iconName, 16)); line.append(node('span', text)); box.append(line);
        box.append(button('전체 목록 보기', 'discoveryShowAll', () => selectCollection('discover'), 'discovery-quiet discovery-show-all')); list.append(box);
      };
      if (current.collection === 'excluded') {
        const entries = current.feedback?.feedback || [];
        if (!entries.length) emptyTab('제외한 글이 없습니다', '글의 더보기에서 읽음이나 관련 없음을 고르면 여기에 모입니다.', 'more');
        rows = entries.map(entry => () => excludedCard(entry, listedArticle(entry.canonicalUrl)));
      } else if (current.collection !== 'discover') {
        const items = collectionResult();
        if (current.collection === 'cancelled') list.append(node('h2', '반응 해제 기록', 'discovery-count'));
        if (!items.length) {
          if (current.collection === 'bookmarked') emptyTab('담은 글이 없습니다', '목록에서 담기를 누르면 여기에 모입니다.', 'bookmark');
          else if (current.collection === 'liked') emptyTab('좋아요한 글이 없습니다', '글을 열고 좋아요를 누르면 여기에 모입니다.', 'heart');
          else list.append(node('p', '아직 글이 없습니다.', 'discovery-limitation'));
        }
        rows = items.map(item => () => articleCard(item, []));
      } else if (result) {
        const items = discover, notice = wideNotice();
        if (notice) { const line = node('p', notice, 'discovery-wide-notice'); line.id = 'discoveryWideNotice'; line.setAttribute('role', 'status'); body.append(line); }
        if (!items.length) {
          const contentLanguages = desiredLanguages()?.contentLanguages, availableFeed = settingsModel().filterFeed(feed, desiredSettings());
          const languageUnavailable = Array.isArray(contentLanguages) && contentLanguages.length > 0 && !current.loading && !current.error &&
            current.catalog.status === 'ready' && !current.catalog.error && availableFeed.articles.length > 0 &&
            !availableFeed.articles.some(article => engine().languageAllowed(article.language, contentLanguages));
          list.append(node('p', contentLanguages?.length === 0 ? '표시할 언어를 선택해 주세요.' : feed.sources.every(source => desiredSettings()?.disabledSourceIds?.includes(source.id)) ? '출처를 선택해 주세요.' : languageUnavailable ? '선택한 언어의 글이 현재 목록에 없습니다.' : current.mode === 'related' ? '주제와 맞는 글이 없습니다.' : '표시할 글이 없습니다.', 'discovery-count'));
          list.append(button('뉴스 설정', null, () => showSettings(true), 'discovery-quiet'));
          if (current.mode !== 'latest') list.append(button('최신 글 보기', null, () => setMode('latest'), 'discovery-quiet'));
        }
        // 새 글 n건: articles of this list that the last refresh added. The list keeps its place.
        const fresh = current.newUrls && !current.newDismissed ? items.filter(item => current.newUrls.has(item.article.canonicalUrl)).length : 0;
        if (fresh) {
          // Pressing it is a refresh the person asks for: the order is computed again, so the new ones take their place.
          const notice = button(null, 'discoveryNewArticles', () => { current.newDismissed = true; resetList(); draw(); root.requestAnimationFrame(() => { if (scope()) { surface.querySelector('#discoveryList [data-discovery-select]')?.focus({ preventScroll: true }); current.listPane.scrollIntoView({ block: 'start' }); } }); }, 'discovery-new-articles');
          notice.append(icon('up', 16), node('span', '새 글 ' + fresh + '건')); body.append(notice);
        }
        rows = items.map(item => () => articleCard(item, feed.sources || []));
      }
      // 20 at first, 20 more with 더 보기. The count opened stays while this tab, order and filter stay.
      const visible = Math.min(rows.length, Math.max(PAGE, current.visible || PAGE));
      rows.slice(0, visible).forEach(make => list.append(make()));
      for (const [address, media] of current.imageNodes) if (!list.contains(media)) { media.querySelector('img')?.removeAttribute('src'); current.imageNodes.delete(address); }
      body.append(list);
      if (rows.length > visible) {
        const more = node('div', null, 'discovery-page-row');
        more.append(node('p', rows.length + '건 중 ' + visible + '건', 'discovery-page-count'));
        const next = button('더 보기', 'discoveryShowMore', () => showMore(visible), 'discovery-quiet discovery-show-more'); next.dataset.focusKey = 'show-more';
        more.append(next); body.append(more);
      }
      // 관련 없음·읽음 just left the list: one place to put it back.
      if (current.toast && current.lastFeedback && !current.pending && current.collection === 'discover') {
        const toast = node('div', null, 'discovery-undo-toast'); toast.setAttribute('role', 'status');
        toast.append(node('span', current.toast.kind === 'already_read' ? '읽음으로 제외' : '관련 없음으로 제외'));
        const again = button('되돌리기', 'discoveryUndoToast', () => undo(current.lastFeedback), 'discovery-undo-toast-button'); again.title = '되돌리기'; again.disabled = busy();
        toast.append(again); body.append(toast);
      }
      if (current.feedback?.feedback?.length) {
        const excluded = node('details', null, 'discovery-excluded'); excluded.open = current.excludedOpen;
        excluded.addEventListener('toggle', () => { if (current) current.excludedOpen = excluded.open; });
        excluded.append(node('summary', '제외한 글 ' + current.feedback.feedback.length + '개'));
        current.feedback.feedback.forEach(entry => {
          const available = listedArticle(entry.canonicalUrl);
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
        }); current.managementBody.append(excluded);
      }
      if (feed) current.catalogStatus.append(sourceDetails(feed, result));
      const cancelledCount = current.actions?.entries.filter(entry => !entry.liked && !entry.bookmarked).length || 0;
      current.managementBody.prepend(button('반응 해제 기록 ' + cancelledCount, 'discoveryCancelled', () => selectCollection('cancelled'), 'discovery-quiet'),
        node('p', '좋아요·담기를 모두 해제한 글을 다시 찾습니다. 부정 평가가 아니며 여기서 반응을 복구할 수 있습니다.', 'life-meta'));
      current.managementBody.append(portableControls());
      current.managementBody.append(node('p', '설정과 반응은 계정에 비공개로 자동 저장됩니다.', 'discovery-privacy'));
      current.body.replaceChildren(...body.childNodes);
      drawReader(); if (current.reader) current.reader.notes.replaceChildren(...readerNotes.childNodes);
      readingUI?.refreshLinks();
      if (settingsFocus && !settingsFocus.element.isConnected) {
        const target = [...current.settingsPanel.querySelectorAll('button,input,select,summary,a')].find(el => settingsFocus.id && el.id === settingsFocus.id || settingsFocus.key && el.dataset.focusKey === settingsFocus.key);
        if (target?.getClientRects().length && !target.disabled) { target.focus({ preventScroll: true }); root.scrollTo({ top: settingsFocus.scrollY, behavior: 'instant' }); }
      }
    }
    async function render(options = {}) {
      leave(); if (disposed) return;
      active = true; const next = getBundle()?.workspaceId;
      if (next !== workspaceId) { current = null; client?.dispose(); client = null; wideEpoch++; wideAborter?.abort(); wideAborter = null; }
      workspaceId = next; const token = generation;
      if (!current) current = { profile: null, feedback: null, catalog: null, mode: 'latest', status: '', error: '', pending: null, conflict: false, lastFeedback: null, memory: null, sourcesOpen: false, excludedOpen: false, loading: true, languageSettings: null, languagePatch: {}, languageConflict: false, languageError: '', translationBlocked: true, remoteLanguageRevision: 0, languageReadEpoch: 0, languageOpen: false, actions: null, actionIntent: null, actionConflict: false, actionError: '', remoteActionRevision: 0, personalOffIntent: false, personalBlocked: true, personalStopLatched: false, personalResult: null, personalPending: false, baselineMode: 'latest', collection: 'discover', collectionUrls: null, lastReaction: null, confirmForget: null, confirmReset: false, copyPreview: null, copyEnvelope: null, copyReading: false, copyGeneration: 0, copyError: '', portableOpen: false, selected: null, toast: null, newUrls: null, newDismissed: false, reader: null, settings: null, settingChanges: { interests: {}, sources: {} }, settingsConflict: false, settingsError: '', autoBlocked: true, nextDue: null, topicText: '', topicError: '', topicConflict: false, composing: false, optionsOpen: false, topicsOpen: false, topicSaved: false, visible: PAGE, order: null, listTouched: false, imageByUrl: null, imageNodes: new Map(), failedImages: new Set(),
        wide: { items: [], topics: [], fetchedAt: null, stale: false, status: 'idle', error: null, key: null, pendingKey: null, loadedAt: 0, notEnabled: false, clearError: false, clearTried: false, refused: new Set(), listSeen: true } };
      current.selected = null; current.toast = null; current.readerPushed = false; current.wide.clearTried = false;
      const reopen = typeof options.articleId === 'string' ? options.articleId : null;
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
            if (languageWrite || languageDirty()) { current.languageConflict = true; current.languageError = '다른 탭이나 기기에서 언어 설정이 바뀌었습니다. 최신 언어 설정을 확인해 주세요.'; draw(); }
            else { draw(); reloadLanguages().catch(error => report(error)); }
          }
          if (event.type === 'discovery_actions_changed' && current.actions && event.revision > current.actions.revision) {
            if (actionWrite && event.local) return;
            if (!event.local) current.remoteActionRevision = Math.max(current.remoteActionRevision, event.revision);
            current.personalBlocked = true; current.mode = current.baselineMode; dropPersonal();
            if (actionWrite) { draw(); return; }
            if (current.actionIntent) { current.actionConflict = true; current.actionError = '다른 탭이나 기기에서 반응이 바뀌었습니다. 최신 반응을 확인해 주세요.'; draw(); }
            else { draw(); reloadActions().catch(error => report(error)); }
          }
          if (event.type === 'discovery_profile_changed' && current.feedback && event.revision > current.feedback.revision && !pendingWrite) {
            capture();
            current.conflict = !!current.pending; current.error = '다른 탭이나 기기에서 읽음·제외 선택이 바뀌었습니다. 최신 제외 목록을 확인해 주세요.'; draw();
            if (!current.pending) reloadFeedback().catch(error => report(error));
          }
          if (event.type === 'discovery_settings_changed' && current.settings && event.revision > current.settings.revision) {
            dropPersonal(true); surface?.querySelectorAll('.discovery-personal-evidence').forEach(el => el.remove());
            current.autoBlocked = true; stopTimer(); cancelFetch();
            if (settingsWrite) return;
            if (settingsDirty()) { current.settingsConflict = true; current.settingsError = '다른 탭이나 기기에서 옵션이 바뀌었습니다. 최신 옵션을 확인해 주세요.'; draw(); }
            else reloadSettings().catch(error => report(error));
          }
          if (event.type === 'interest_profile_changed' && current.profile && event.revision > current.profile.revision && !topicWrite) {
            capture();
            storage.readInterestProfile(workspaceId).then(profile => { if (valid(token)) { current.profile = profile; current.order = null; dropPersonal(true); message('다른 화면에서 보관한 관심을 반영했습니다.'); draw(); restore(); refreshWide().catch(error => report(error)); } }).catch(error => report(error));
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
        if (root.HaedoLife.DiscoveryReadingUI) {
          readingUI ||= root.HaedoLife.DiscoveryReadingUI.create({ container: readingHost, storage, getInput: readingInput, isCurrent: scope });
          await readingUI.render(workspaceId);
          if (!valid(token)) return;
        }
        if (!current.catalog) await loadCatalog(); else { restore(); scheduleAuto(); }
        // Opening the news tab with 넓게 찾기 on asks once; a pending erase from an earlier switch-off is tried again.
        if (valid(token)) { refreshWide().catch(error => report(error)); clearWide().catch(error => report(error)); }
        if (reopen && valid(token) && !current.selected) showArticle(reopen);
      } catch (error) {
        if (valid(token)) { current.initialReading = false; current.loading = false; current.languageConflict = true; current.languageError = '언어 설정을 확인하지 못했습니다. 최신 언어 설정 확인을 눌러 주세요.'; report(error, '보관한 관심이나 제외 목록을 읽지 못했습니다. 화면을 다시 열어 주세요. 기존 자료는 유지했습니다.'); }
      }
    }
    function inputDirty() { return languageDirty() || !!languageWrite || !!current?.actionIntent || !!actionWrite || !!current?.personalOffIntent || !!current?.copyPreview || !!current?.copyReading || !!current?.pending || !!pendingWrite || !!topicWrite || !!settingsWrite || !!current?.topicText.trim() || settingsDirty(); }
    function dirty() { return inputDirty() || !!readingUI?.dirty(); }
    async function flush() {
      await Promise.all([pendingWrite, topicWrite, settingsWrite, actionWrite, languageWrite].filter(Boolean).map(promise => promise.catch(() => {})));
      if (languageDirty()) throw Object.assign(new Error('언어 설정이 아직 저장되지 않았습니다. 다시 저장하거나 선택을 취소해 주세요.'), { code: 'discovery_unsaved' });
      if (current?.actionIntent || current?.personalOffIntent || current?.copyPreview || current?.copyReading) throw Object.assign(new Error('반응 선택이나 사본 확인이 아직 끝나지 않았습니다. 다시 저장하거나 선택을 취소해 주세요.'), { code: 'discovery_unsaved' });
      if (current?.topicText.trim() || settingsDirty()) throw Object.assign(new Error('입력한 주제나 옵션 선택이 아직 저장되지 않았습니다. 다시 저장하거나 취소해 주세요.'), { code: 'discovery_unsaved' });
      if (current?.pending) throw Object.assign(new Error('읽음·제외 선택이 아직 보관되지 않았습니다. 선택 다시 보관 또는 선택 취소를 눌러 주세요.'), { code: 'discovery_unsaved' });
      await readingUI?.flush();
    }
    // The line between the list and the reading column sets the list width (assets/life/split-resize.js, this device only).
    function ensureSplit() {
      if (splitDispose && splitLayout === current.layout && splitLayout.isConnected) return;
      disposeSplit(); splitLayout = current.layout;
      splitDispose = root.HaedoLife.SplitResize?.attach(current.layout, { key: 'caeyeon_life_split_news', before: current.readerHost, controls: 'discoveryListPane',
        min: 280, readerMin: 420, defaultWidth: 440 }) || null;
    }
    function disposeSplit() { splitDispose?.(); splitDispose = null; splitLayout = null; }
    function leave() {
      disposeSplit();
      readingUI?.leave(); cancelPrivateRead(); disposeReaderView();
      wideEpoch++; wideAborter?.abort(); wideAborter = null; if (current?.wide?.status === 'loading') { current.wide.status = current.wide.key ? 'ready' : 'idle'; current.wide.pendingKey = null; }
      if (active && surface?.isConnected && scope()) { current.topicsOpen = current.editor.open; capture(); }
      setImmersive(false); for (const element of inerted) element.inert = false; inerted = [];
      generation++; active = false; if (current) { current.languageReadEpoch++; stopTranslation(); } stopTimer(); cancelFetch(); unsubscribe?.(); unsubscribe = null;
      if (current) current.loading = false;
    }
    root.document.addEventListener('pointerdown', closeCardMenus, true);
    for (const type of ['wheel', 'touchmove', 'keydown']) root.addEventListener(type, pageScrollIntent, { passive: true });
    root.document.addEventListener('haedo:page-suspend', pageSuspend); root.document.addEventListener('haedo:page-ready', pageReady); root.document.addEventListener('visibilitychange', lifecycle); root.addEventListener('online', lifecycle); root.addEventListener('offline', lifecycle);
    function dispose() { leave(); readingUI?.dispose(); readingUI = null; disposed = true; downloadUrls.forEach(address => URL.revokeObjectURL(address)); downloadUrls.clear(); dropImages(); wideClient?.dispose(); wideClient = null; wideUnlisten?.(); wideUnlisten = null; if (current?.wide) current.wide.items = []; root.document.removeEventListener('pointerdown', closeCardMenus, true); for (const type of ['wheel', 'touchmove', 'keydown']) root.removeEventListener(type, pageScrollIntent); root.document.removeEventListener('haedo:page-suspend', pageSuspend); root.document.removeEventListener('haedo:page-ready', pageReady); root.document.removeEventListener('visibilitychange', lifecycle); root.removeEventListener('online', lifecycle); root.removeEventListener('offline', lifecycle); client?.dispose(); client = null; current = null; workspaceId = null; }
    return Object.freeze({ render, refresh: render, leave, dispose, flush, dirty, showArticle });
  }
  root.HaedoLife ||= {}; root.HaedoLife.DiscoveryUI = Object.freeze({ create });
})(globalThis);
