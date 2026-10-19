/* Shared material workspace; public home mounts only after account verification. */
(function (root) {
  'use strict';
  const life = root.HaedoLife = root.HaedoLife || {};
  const auth = root.HaedoAuth;
  const publicHome = root.document.body?.dataset.lifeHome === 'true';
  let mounted, sync, compositionSync, writingSync, scopedStorage, controller, showing, generation = 0, activeKey = null, starting, leaving = false, suspended = false;
  let retained = false, resumePoint = null, suspension = 0;
  function loginPath(compose = false) {
    const next = auth?.safeNext(compose && publicHome ? 'index.html?compose=1' : (publicHome ? 'index.html' : 'life.html') + root.location.search) || (publicHome ? 'index.html' : 'life.html');
    return 'login.html?next=' + encodeURIComponent(next);
  }
  function isReadOnly() {
    if (root.VIEW_ONLY) return true;
    const query = new URLSearchParams(root.location.search);
    return ['view-only', 'view_only', 'viewOnly', 'readonly', 'read_only', 'share', 'public'].some(key => query.has(key)) || /^(share|shared|public|readonly|view-only)$/i.test(query.get('view') || '');
  }
  function notice(message, error = false) {
    const status = root.document.getElementById('lifeStartup');
    status.hidden = false;
    status.setAttribute('role', error ? 'alert' : 'status');
    const text = root.document.createElement('p');
    text.textContent = message;
    status.replaceChildren(text);
    return status;
  }
  function conceal() {
    const container = root.document.getElementById('lifeApp');
    container.hidden = true;
    const welcome = root.document.getElementById('lifeWelcome');
    if (welcome) welcome.hidden = true;
    const accountPanel = root.document.getElementById('lifeAccount');
    if (accountPanel) { accountPanel.hidden = true; accountPanel.open = false; }
    const accountLabel = root.document.getElementById('lifeAccountLabel');
    if (accountLabel) accountLabel.textContent = '';
    return container;
  }
  function rememberPosition() {
    const container = root.document.getElementById('lifeApp');
    const element = root.document.activeElement;
    const point = { owner: activeKey, x: root.scrollX, y: root.scrollY };
    if (container.contains(element)) {
      point.element = element;
      if (typeof element.selectionStart === 'number') {
        point.start = element.selectionStart; point.end = element.selectionEnd; point.direction = element.selectionDirection;
      } else {
        const selection = root.getSelection();
        if (selection.rangeCount && container.contains(selection.anchorNode)) point.range = selection.getRangeAt(0).cloneRange();
      }
    }
    return point;
  }
  function reveal(account) {
    if (suspended || !mounted || activeKey !== account.projectUrl + '|' + account.userId) return;
    const point = retained ? resumePoint : null, instance = mounted;
    retained = false; resumePoint = null;
    root.document.getElementById('lifeApp').hidden = false;
    const accountLabel = root.document.getElementById('lifeAccountLabel');
    if (accountLabel) accountLabel.textContent = account.email || '내 계정';
    const accountPanel = root.document.getElementById('lifeAccount');
    if (accountPanel) accountPanel.hidden = false;
    root.document.documentElement.classList.remove('auth-pending');
    root.document.getElementById('lifeStartup').hidden = true;
    if (point?.owner === activeKey) root.requestAnimationFrame(() => {
      if (suspended || retained || mounted !== instance || point.owner !== activeKey) return;
      const container = root.document.getElementById('lifeApp');
      if (point.element?.isConnected && container.contains(point.element)) {
        point.element.focus({ preventScroll: true });
        if (typeof point.start === 'number') point.element.setSelectionRange(point.start, point.end, point.direction);
        else if (point.range && container.contains(point.range.commonAncestorContainer)) {
          const selection = root.getSelection(); selection.removeAllRanges(); selection.addRange(point.range);
        }
      }
      root.scrollTo({ left: point.x, top: point.y, behavior: 'instant' });
    });
  }
  function hide() {
    generation += 1; suspension += 1;
    retained = false; resumePoint = null;
    const container = conceal();
    controller?.abort(); controller = null;
    showing = null;
    mounted?.dispose?.(); mounted = null;
    compositionSync?.dispose?.(); compositionSync = null;
    writingSync?.dispose?.(); writingSync = null;
    sync?.dispose?.(); sync = null;
    life.Storage?.clearAccount?.(); scopedStorage = null;
    container.replaceChildren();
    activeKey = null;
  }
  function showWelcome() {
    hide();
    if (!publicHome || suspended) return;
    const welcome = root.document.getElementById('lifeWelcome');
    if (welcome) {
      welcome.querySelectorAll('[data-life-login],[data-life-return-login]').forEach(link => { link.href = loginPath(link.dataset.lifeLogin === 'compose'); });
      welcome.hidden = false;
    }
    root.document.getElementById('lifeStartup').hidden = true;
    root.document.documentElement.classList.remove('auth-pending');
  }
  function retryNotice(message) {
    const status = notice(message, true);
    const retry = root.document.createElement('button');
    retry.type = 'button'; retry.className = 'life-button'; retry.textContent = '다시 확인';
    retry.addEventListener('click', () => { starting = null; start(); });
    const login = root.document.createElement('a');
    login.href = loginPath(); login.className = 'life-button'; login.textContent = '로그인 화면';
    status.append(retry, login);
  }
  function show(account) {
    if (suspended || isReadOnly()) return Promise.resolve(null);
    const key = account.projectUrl + '|' + account.userId;
    if (activeKey === key && (mounted || showing)) {
      if (mounted && retained && !leaving) reveal(account);
      return Promise.resolve(mounted || showing);
    }
    const pending = build(account);
    showing = pending;
    pending.finally(() => { if (showing === pending) showing = null; });
    return pending;
  }
  async function build(account) {
    const key = account.projectUrl + '|' + account.userId;
    if (activeKey === key && mounted) return mounted;
    hide();
    activeKey = key;
    const token = generation;
    controller = new AbortController();
    const signal = controller.signal;
    const container = root.document.getElementById('lifeApp');
    try {
      if (!life.Storage?.forAccount || !life.UI?.mount || !life.Legacy?.forAccount || !life.PlatformRemote?.create || !life.Sync?.create) throw new Error('자료 화면 연결을 준비하지 못했습니다. 다시 열어주세요.');
      const storage = life.Storage.forAccount(account);
      scopedStorage = storage;
      const legacy = life.Legacy.forAccount(account);
      sync = life.Sync.create({ storage, core: life.Core, remoteFactory: life.PlatformRemote.create });
      compositionSync = life.CompositionSync.create({ storage, sourceSync: sync, auth });
      writingSync = life.WritingSync.create({ storage, sourceSync: sync, auth });
      const instance = await life.UI.mount(container, { storage, core: life.Core, legacy, sync, compositionSync, writingSync, auth, signal });
      if (signal.aborted || token !== generation || key !== auth.getAccount()?.projectUrl + '|' + auth.getAccount()?.userId) { instance?.dispose(); return null; }
      mounted = instance;
      reveal(account);
      sync.start().catch(() => {
        if (token === generation && !signal.aborted) notice('자료는 이 브라우저에 보관돼 있습니다. 기기 간 동기화에서 서버 연결 상태를 확인해 주세요.');
      });
      compositionSync.start();
      writingSync.start();
      if ('serviceWorker' in root.navigator) root.navigator.serviceWorker.register('./sw.js').catch(() => {});
      return mounted;
    } catch (error) {
      if (signal.aborted || token !== generation) return null;
      hide();
      retryNotice(error?.message || '자료 화면을 열지 못했습니다. 저장된 자료는 보존돼 있습니다.');
      return null;
    }
  }
  function start() {
    if (suspended) return Promise.resolve(null);
    if (starting) return starting;
    const pending = (async () => {
      if (isReadOnly()) { hide(); notice('읽기 전용 주소에서는 개인 자료를 열지 않습니다.'); return null; }
      if (!auth) { hide(); retryNotice('로그인 연결을 준비하지 못했습니다.'); return null; }
      notice('로그인을 확인하고 있습니다.');
      const authEpoch = auth.epoch, cached = retained ? mounted : null, transition = suspension;
      try {
        const user = await (publicHome ? auth.verify() : auth.requireUser());
        if (suspended || auth.epoch !== authEpoch) return null;
        if (cached && (cached !== mounted || transition !== suspension)) return null;
        const account = auth.getAccount();
        if (!user || !account) { if (publicHome) showWelcome(); return null; }
        return await show(account);
      } catch (_) {
        if (suspended || auth.epoch !== authEpoch) return null;
        if (cached && cached === mounted && transition === suspension && auth.getAccount()?.projectUrl + '|' + auth.getAccount()?.userId === activeKey) conceal();
        else hide();
        retryNotice('개인 자료를 열기 위해 로그인을 확인해야 합니다. 인터넷 연결 후 다시 확인해 주세요. 저장된 자료는 보존돼 있습니다.');
        return null;
      }
    })();
    starting = pending;
    pending.finally(() => { if (starting === pending) starting = null; });
    return pending;
  }
  auth?.onAccountChange(account => {
    if (!account) { if (publicHome) showWelcome(); else { hide(); notice('로그인을 확인한 뒤 자료를 다시 열 수 있습니다. 저장된 자료는 보존돼 있습니다.'); } }
    else if (!isReadOnly()) {
      const key = account.projectUrl + '|' + account.userId;
      // A retained view is revealed only by its own completed resume verify.
      // A different owner always destroys it through the existing hard boundary.
      if (retained && key === activeKey) return;
      if (suspended && activeKey && key !== activeKey) hide();
      show(account);
    }
  });
  root.document.addEventListener('haedo:signed-out', () => { if (publicHome) showWelcome(); else { hide(); notice('로그아웃했습니다. 저장된 자료는 보존돼 있습니다.'); } });
  root.document.addEventListener('haedo:auth-unavailable', () => {
    const account = auth?.getAccount();
    if (retained && account && activeKey === account.projectUrl + '|' + account.userId) conceal();
    else hide();
    retryNotice('로그인을 확인하지 못했습니다. 인터넷 연결 후 다시 확인해 주세요.');
  });
  root.document.addEventListener('visibilitychange', () => {
    if (!mounted || retained) return;
    resumePoint = root.document.hidden ? rememberPosition() : null;
  });
  // An existing unsaved-input dialog can blur the field before pagehide. Keep
  // its pre-dialog selection without cancelling or delaying the navigation.
  root.addEventListener('beforeunload', () => {
    if (mounted && !retained && !suspended) resumePoint = rememberPosition();
  }, { capture: true });
  // Auth notifies the workspace before concealing changes its scroll height.
  // Window pagehide listener options alone cannot establish this ownership.
  root.document.addEventListener('haedo:page-suspend', () => {
    suspended = true; suspension += 1; starting = null;
    if (!mounted) { hide(); return; }
    const point = rememberPosition();
    if (point.element || !resumePoint) resumePoint = point;
    retained = true;
    conceal();
    // Closing the scope aborts IndexedDB commits. Keep this owner alive while
    // the browser caches the page, and checkpoint only its accepted local model.
    Promise.resolve(mounted.checkpoint?.()).catch(() => {});
  });
  root.document.addEventListener('haedo:page-resume', event => {
    event.preventDefault();
    suspended = false;
    start();
  });
  root.document.querySelectorAll('.life-global-nav .life-icon-button').forEach(control => {
    control.addEventListener('keydown', event => {
      if (event.key === 'Escape') control.dataset.tooltipDismissed = 'true';
    });
    const resetTooltip = () => { delete control.dataset.tooltipDismissed; };
    control.addEventListener('blur', resetTooltip);
    control.addEventListener('pointerleave', resetTooltip);
  });
  root.document.addEventListener('keydown', event => {
    const panel = root.document.getElementById('lifeAccount');
    if (event.key !== 'Escape' || !panel?.open || !panel.contains(root.document.activeElement)) return;
    panel.open = false;
    const toggle = root.document.getElementById('lifeAccountToggle');
    if (toggle) { toggle.dataset.tooltipDismissed = 'true'; toggle.focus({ preventScroll: true }); }
  });
  root.document.getElementById('lifeLogout')?.addEventListener('click', async () => {
    if (leaving) return;
    leaving = true;
    const container = root.document.getElementById('lifeApp');
    const accountPanel = root.document.getElementById('lifeAccount');
    const token = generation;
    const instance = mounted;
    container.hidden = true;
    if (accountPanel) accountPanel.hidden = true;
    notice('검토 내용을 보관하고 로그아웃합니다.');
    try {
      await instance?.flushDraft?.();
      if (token !== generation || !auth.getAccount()) return;
      hide();
      await auth.signOut();
    } catch (error) {
      if (!auth.getAccount()) {
        notice(error?.code === 'storage_unavailable' ? '개인 화면을 닫았습니다. 로그아웃 상태를 보관하지 못했습니다. 이 브라우저의 저장소 설정을 확인해 주세요.' : '개인 화면을 닫았습니다. 로그인 상태를 확인하려면 다시 열어주세요.', true);
        return;
      }
      if (token !== generation || mounted !== instance) return;
      if (suspended || retained) {
        retryNotice((error?.message || '검토 내용을 보관하지 못했습니다.') + ' 로그아웃을 완료하지 않았습니다. 입력을 유지하고 있습니다. 다시 확인한 뒤 보관을 재시도해 주세요.');
        return;
      }
      container.hidden = false;
      if (accountPanel) accountPanel.hidden = false;
      notice((error?.message || '검토 내용을 보관하지 못했습니다.') + ' 로그아웃을 완료하지 않았습니다. 입력은 편집 화면에 남아 있습니다. 작업과 저장 상태를 확인한 뒤 다시 시도해 주세요.', true);
      root.document.getElementById('lifeLogout')?.focus({ preventScroll: true });
    } finally { leaving = false; }
  });
  life.Shell = { isReadOnly, start, get sync() { return sync; }, get compositionSync() { return compositionSync; }, get writingSync() { return writingSync; }, get storage() { return scopedStorage; } };
  if (publicHome && 'serviceWorker' in root.navigator) root.navigator.serviceWorker.register('./sw.js').catch(() => {});
  life.Shell.ready = start();
})(globalThis);
