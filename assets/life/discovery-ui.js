/* Public article discovery. Private interests and feedback stay in this browser;
 * only the prepared same-origin public catalog is requested. No source writes. */
(function (root) {
  'use strict';
  const node = (tag, text, cls) => { const value = root.document.createElement(tag); if (text != null) value.textContent = text; if (cls) value.className = cls; return value; };
  function create({ container, storage, getBundle, isCurrent, onImport, onOpenInterests, onOpenOriginal }) {
    let active = false, disposed = false, generation = 0, workspaceId = null, surface = null;
    let current = null, client = null, unsubscribe = null, aborter = null, pendingWrite = null;
    let settingsWrite = null, topicWrite = null, timer = null, fetchEpoch = 0, suspended = false;
    const INTERVAL = 15 * 60 * 1000;
    const settingsModel = () => root.HaedoLife.DiscoverySettings;
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
        if (!valid(token) || !surface?.isConnected || root.document.activeElement === current.topicInput) return;
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
      if (!current?.catalog?.feed || !current.profile || !current.feedback || !current.settings) return null;
      const settings = desiredSettings();
      return client.rank(settingsModel().filterFeed(current.catalog.feed, settings), { profile: settingsModel().effectiveProfile(current.profile, settings), knownUrls: knownUrls(), feedback: current.feedback, mode: current.mode, limit: 5 });
    }
    function busy() { return current.loading || !!pendingWrite || !!settingsWrite || !!topicWrite; }
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
        if (result.feed || !current.catalog) current.catalog = result;
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
      else current.settingChanges[group][id] = enabled;
      current.settingsError = ''; draw(); persistSettings().catch(error => report(error));
    }
    async function reloadSettings() {
      const token = generation, result = await storage.readDiscoverySettings(workspaceId);
      if (!valid(token)) return;
      current.settings = result; current.settingsConflict = false; current.settingsError = '';
      current.autoBlocked = !desiredSettings().autoRefresh; if (current.autoBlocked) { stopTimer(); cancelFetch(); } draw(); scheduleAuto();
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
        current.profile = result.profile;
        if (current.topicText === submitted) { current.topicText = ''; current.topicInput.value = ''; }
        current.topicError = ''; current.status = '주제를 이 브라우저에 저장했습니다.';
      } catch (_) { if (valid(token)) current.topicError = '주제를 저장하지 못했습니다. 입력은 남아 있습니다. 다시 저장하거나 입력을 지워 주세요.'; }
      finally { topicWrite = null; if (valid(token)) { draw(); current.topicInput.focus({ preventScroll: true }); } }
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
      const editor = node('section', null, 'discovery-topic-editor'), label = node('label', '찾고 싶은 주제', 'discovery-topic-label'); label.htmlFor = 'discoveryTopicInput';
      const form = node('form', null, 'discovery-topic-form'), input = node('input', null, 'life-input'); input.id = 'discoveryTopicInput'; input.type = 'text'; input.maxLength = 200; input.autocomplete = 'off'; input.value = current.topicText;
      input.setAttribute('aria-describedby', 'discoveryTopicHelp');
      input.addEventListener('compositionstart', () => { current.composing = true; }); input.addEventListener('compositionend', () => { current.composing = false; current.topicText = input.value; current.topicAdd.disabled = !current.topicText.trim() || !!topicWrite || current.topicConflict; current.topicDiscard.hidden = !current.topicText; });
      input.addEventListener('input', () => { current.topicText = input.value; current.topicAdd.disabled = !current.topicText.trim() || !!topicWrite || current.topicConflict || !current.profile; current.topicDiscard.hidden = !current.topicText; current.examples.querySelectorAll('button').forEach(el => { el.disabled = !current.profile || !!topicWrite || !!current.topicText.trim(); }); });
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.isComposing || current.composing || event.keyCode === 229)) event.preventDefault(); });
      form.addEventListener('submit', event => { event.preventDefault(); if (scope() && !current.composing) saveTopic().catch(error => report(error)); });
      const add = button('주제 추가', 'discoveryTopicAdd', saveTopic), discard = button('입력 지우기', 'discoveryTopicDiscard', () => { current.topicText = ''; input.value = ''; current.topicError = ''; current.topicConflict = false; draw(); input.focus(); }, 'discovery-quiet');
      form.append(input, add, discard); const help = node('p', '한 번에 하나씩 적어 주세요. 제목·공개 요약에 실제로 나타난 표현으로 찾습니다.', 'life-meta'); help.id = 'discoveryTopicHelp';
      const examples = node('div', null, 'discovery-topic-examples'); examples.append(node('span', '예시 주제', 'life-meta'));
      for (const example of ['AI', '전시', '신간']) examples.append(button(example, null, () => { if (current.topicText.trim() || topicWrite) return; current.topicText = example; input.value = example; return saveTopic(); }, 'discovery-quiet'));
      const choiceHost = node('div'), topicRecovery = node('div'), options = node('details', null, 'discovery-options'); options.id = 'discoveryOptions'; options.open = current.optionsOpen;
      options.append(node('summary', '옵션')); const optionsBody = node('div'); options.append(optionsBody); options.addEventListener('toggle', () => { if (scope()) current.optionsOpen = options.open; });
      editor.append(label, form, help, examples, topicRecovery, choiceHost, options); const body = node('div'); surface.append(editor, body); container.replaceChildren(surface);
      Object.assign(current, { editor, examples, topicInput: input, topicAdd: add, topicDiscard: discard, choiceHost, topicRecovery, options, optionsBody, body });
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
      details.append(node('p', '준비된 공개 목록에서 찾습니다. 목록 다시 불러오기는 이 목록을 다시 확인하며, 출처 사이트의 새 글 수집을 실행하지 않습니다. 공용 목록의 하루 단위 갱신은 배포에 반영된 뒤 확인할 수 있습니다.', 'life-meta'));
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
      ensureSurface(); drawEditor(); surface.setAttribute('aria-busy', String(busy()));
      const body = node('div'), labels = (current.profile?.manual || []).filter(item => !desiredSettings()?.disabledInterestIds.includes(item.id)).map(item => item.label);
      const controls = node('div', null, 'discovery-controls'), modes = node('div', null, 'discovery-modes'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '글 정렬');
      for (const [mode, label, id] of [['related', '관심순', 'discoveryRecommended'], ['latest', '최신순', 'discoveryLatest']]) {
        const action = button(label, id, () => { capture(); current.mode = mode; current.memory = null; draw(); surface.querySelector('#' + id)?.focus(); }, 'discovery-mode');
        action.setAttribute('aria-pressed', String(current.mode === mode)); modes.append(action);
      }
      const refresh = button('목록 다시 불러오기', 'discoveryRefresh', () => { capture(null, 'refresh'); return loadCatalog(); }, 'discovery-quiet'); refresh.disabled = current.loading; refresh.dataset.focusKey = 'refresh';
      controls.append(modes, refresh); body.append(controls);
      const status = node('p', current.loading ? '공개 글 목록을 불러오고 있습니다.' : current.status, 'discovery-status'); status.id = 'discoveryStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = !status.textContent; body.append(status);
      const error = node('p', current.error, 'life-error'); error.id = 'discoveryError'; error.setAttribute('role', 'alert'); error.hidden = !current.error; body.append(error);
      if (current.error && !current.loading && (!current.profile || !current.feedback || !current.settings)) body.append(button('다시 확인', 'discoveryRetry', render));
      if (current.pending) {
        const recovery = node('div', null, 'discovery-recovery');
        recovery.append(node('p', '남겨 둔 선택 · ' + (current.pending.action === 'undo' ? '제외 되돌리기' : current.pending.kind === 'already_read' ? '읽음' : '관련 없음') + ' · ' + (current.pending.article.title || current.pending.article.canonicalUrl), 'life-meta'));
        if (current.conflict) recovery.append(button('최신 제외 목록 확인', 'discoveryFeedbackReload', reloadFeedback));
        else { const retry = button('선택 다시 보관', 'discoveryFeedbackRetry', persistIntent); retry.disabled = !!pendingWrite; recovery.append(retry); }
        const discard = button('선택 취소', 'discoveryFeedbackDiscard', () => { current.pending = null; current.conflict = false; message('이번 선택을 취소했습니다. 보관된 제외 목록은 유지했습니다.'); draw(); restore(); }); discard.disabled = !!pendingWrite; recovery.append(discard); body.append(recovery);
      } else if (current.lastFeedback) body.append(button('방금 제외 되돌리기', 'discoveryUndo', () => undo(current.lastFeedback), 'discovery-quiet'));
      const feed = current.catalog?.feed, result = rank();
      if (feed) {
        const stale = current.catalog.stale || result?.metadata?.stale;
        if (stale) body.append(node('p', '최신 상태를 확인하지 못한 출처가 있습니다. 출처와 목록 상태에서 수집 시각을 확인해 주세요.', 'discovery-notice'));
        const failed = (feed.sources || []).filter(source => source.status === 'error' || source.status === 'never_fetched');
        if (failed.length) body.append(node('p', failed.map(source => source.name + (source.status === 'error' ? ' 수집 실패' : ' 수집 자료 없음')).join(' · '), 'discovery-notice'));
      }
      const list = node('div', null, 'discovery-list'); list.id = 'discoveryList';
      if (result) {
        const items = result.items;
        const summary = current.mode === 'related' ? items.length ? '관심과 표현이 맞는 글 ' + items.length + '개' + (items.length < 3 ? ' · 관련 글이 적어 더 채우지 않았습니다.' : '') : labels.length ? '선택한 주제와 표현이 맞는 새 글을 찾지 못했습니다.' : '위에서 주제를 추가·선택하거나 최신순으로 공개 글을 둘러보세요.' : '같은 출처와 제외 조건 · 발행·수정일이 최신인 글 ' + items.length + '개';
        list.append(node('p', !desiredSettings()?.disabledSourceIds || feed.sources.some(source => !desiredSettings().disabledSourceIds.includes(source.id)) ? summary : '선택한 출처가 없습니다. 옵션에서 목록에 표시할 출처를 켜 주세요.', 'discovery-count'));
        if (current.mode === 'related' && items.length) list.append(node('p', result.metadata?.limitation || '공개 글에 실제로 나타난 표현으로 찾았습니다. 같은 표현이라도 문맥은 다를 수 있습니다.', 'discovery-limitation'));
        if (!items.length && labels.length && current.mode === 'related') {
          list.append(node('p', '구체적인 주제를 추가하거나 출처 선택을 확인해 주세요. 최신 글도 둘러볼 수 있습니다.', 'discovery-limitation'));
          list.append(button('최신 글 보기', null, () => { current.mode = 'latest'; draw(); }, 'discovery-quiet'));
        }
        items.forEach(item => list.append(articleRow(item, feed.sources || [])));
      }
      body.append(list);
      if (current.feedback?.feedback?.length) {
        const excluded = node('details', null, 'discovery-excluded'); excluded.open = current.excludedOpen;
        excluded.addEventListener('toggle', () => { if (current) current.excludedOpen = excluded.open; });
        excluded.append(node('summary', '제외한 글 ' + current.feedback.feedback.length + '개'));
        current.feedback.feedback.forEach(entry => {
          const article = feed?.articles?.find(item => item.canonicalUrl === entry.canonicalUrl) || { id: entry.articleId, canonicalUrl: entry.canonicalUrl, title: entry.canonicalUrl };
          const row = node('div', null, 'discovery-excluded-row'); row.append(node('p', article.title), node('small', entry.kind === 'already_read' ? '읽음' : '관련 없음', 'life-meta'));
          const restoreButton = button('제외 되돌리기', null, () => undo(article), 'discovery-quiet'); restoreButton.dataset.discoveryUndo = entry.articleId; restoreButton.disabled = !!current.pending || busy(); row.append(restoreButton); excluded.append(row);
        }); body.append(excluded);
      }
      if (feed) body.append(sourceDetails(feed, result));
      body.append(node('p', '주제·옵션과 읽음·제외 선택은 이 브라우저에만 보관합니다. 원문을 열기 전에는 해당 사이트에 접속하지 않습니다.', 'discovery-privacy'));
      current.body.replaceChildren(...body.childNodes);
    }
    async function render() {
      leave(); if (disposed) return;
      active = true; const next = getBundle()?.workspaceId;
      if (next !== workspaceId) { current = null; client?.dispose(); client = null; }
      workspaceId = next; const token = generation;
      if (!current) current = { profile: null, feedback: null, catalog: null, mode: 'related', status: '', error: '', pending: null, conflict: false, lastFeedback: null, memory: null, sourcesOpen: false, excludedOpen: false, loading: true, settings: null, settingChanges: { interests: {}, sources: {} }, settingsConflict: false, settingsError: '', autoBlocked: true, nextDue: null, topicText: '', topicError: '', topicConflict: false, composing: false, optionsOpen: false };
      client ||= engine().create(); draw();
      try {
        const [profile, feedbackProfile, settings] = await Promise.all([storage.readInterestProfile(workspaceId), storage.readDiscoveryProfile(workspaceId), storage.readDiscoverySettings(workspaceId)]);
        if (!valid(token)) return;
        current.profile = profile; current.feedback = feedbackProfile; current.settings = settings; current.autoBlocked = !desiredSettings().autoRefresh; current.loading = false;
        unsubscribe = storage.subscribe(workspaceId, event => {
          if (!scope()) return;
          if (event.type === 'discovery_profile_changed' && event.revision > current.feedback.revision && !pendingWrite) {
            capture();
            current.conflict = !!current.pending; current.error = '다른 탭에서 읽음·제외 선택이 바뀌었습니다. 최신 제외 목록을 확인해 주세요.'; draw();
            if (!current.pending) reloadFeedback().catch(error => report(error));
          }
          if (event.type === 'discovery_settings_changed' && event.revision > current.settings.revision) {
            current.autoBlocked = true; stopTimer(); cancelFetch();
            if (settingsWrite) return;
            if (settingsDirty()) { current.settingsConflict = true; current.settingsError = '다른 탭에서 옵션이 바뀌었습니다. 최신 옵션을 확인해 주세요.'; draw(); }
            else reloadSettings().catch(error => report(error));
          }
          if (event.type === 'interest_profile_changed' && event.revision > current.profile.revision && !topicWrite) {
            capture();
            storage.readInterestProfile(workspaceId).then(profile => { if (valid(token)) { current.profile = profile; message('다른 화면에서 보관한 관심을 반영했습니다.'); draw(); restore(); } }).catch(error => report(error));
          }
        });
        draw();
        if (!current.catalog) await loadCatalog(); else { restore(); scheduleAuto(); }
      } catch (error) {
        if (valid(token)) { current.loading = false; report(error, '보관한 관심이나 제외 목록을 읽지 못했습니다. 화면을 다시 열어 주세요. 기존 자료는 유지했습니다.'); }
      }
    }
    function dirty() { return !!current?.pending || !!pendingWrite || !!topicWrite || !!settingsWrite || !!current?.topicText.trim() || settingsDirty(); }
    async function flush() {
      await Promise.all([pendingWrite, topicWrite, settingsWrite].filter(Boolean).map(promise => promise.catch(() => {})));
      if (current?.topicText.trim() || settingsDirty()) throw Object.assign(new Error('입력한 주제나 옵션 선택이 아직 저장되지 않았습니다. 다시 저장하거나 취소해 주세요.'), { code: 'discovery_unsaved' });
      if (current?.pending) throw Object.assign(new Error('읽음·제외 선택이 아직 보관되지 않았습니다. 선택 다시 보관 또는 선택 취소를 눌러 주세요.'), { code: 'discovery_unsaved' });
    }
    function leave() {
      if (active && surface?.isConnected && scope()) capture();
      generation++; active = false; stopTimer(); cancelFetch(); unsubscribe?.(); unsubscribe = null;
      if (current) current.loading = false;
    }
    root.document.addEventListener('haedo:page-suspend', pageSuspend); root.document.addEventListener('haedo:page-ready', pageReady); root.document.addEventListener('visibilitychange', lifecycle); root.addEventListener('online', lifecycle); root.addEventListener('offline', lifecycle);
    function dispose() { leave(); disposed = true; root.document.removeEventListener('haedo:page-suspend', pageSuspend); root.document.removeEventListener('haedo:page-ready', pageReady); root.document.removeEventListener('visibilitychange', lifecycle); root.removeEventListener('online', lifecycle); root.removeEventListener('offline', lifecycle); client?.dispose(); client = null; current = null; workspaceId = null; }
    return Object.freeze({ render, refresh: render, leave, dispose, flush, dirty });
  }
  root.HaedoLife ||= {}; root.HaedoLife.DiscoveryUI = Object.freeze({ create });
})(globalThis);
