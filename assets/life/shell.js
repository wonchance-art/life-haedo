/* Shared material workspace; public home mounts only after account verification. */
(function (root) {
  'use strict';
  const life = root.HaedoLife = root.HaedoLife || {};
  const auth = root.HaedoAuth;
  const publicHome = root.document.body?.dataset.lifeHome === 'true';
  let mounted, sync, scopedStorage, controller, showing, generation = 0, activeKey = null, starting, leaving = false, suspended = false;
  function loginPath() {
    const next = auth?.safeNext((publicHome ? 'index.html' : 'life.html') + root.location.search) || (publicHome ? 'index.html' : 'life.html');
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
  function hide() {
    generation += 1;
    const container = root.document.getElementById('lifeApp');
    container.hidden = true;
    const welcome = root.document.getElementById('lifeWelcome');
    if (welcome) welcome.hidden = true;
    const accountPanel = root.document.getElementById('lifeAccount');
    if (accountPanel) { accountPanel.hidden = true; accountPanel.open = false; }
    const accountLabel = root.document.getElementById('lifeAccountLabel');
    if (accountLabel) accountLabel.textContent = '';
    controller?.abort(); controller = null;
    showing = null;
    mounted?.dispose?.(); mounted = null;
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
      welcome.querySelectorAll('[data-life-login]').forEach(link => { link.href = loginPath(); });
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
    if (activeKey === key && (mounted || showing)) return Promise.resolve(mounted || showing);
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
      const instance = await life.UI.mount(container, { storage, core: life.Core, legacy, sync, auth, signal });
      if (signal.aborted || token !== generation || key !== auth.getAccount()?.projectUrl + '|' + auth.getAccount()?.userId) { instance?.dispose(); return null; }
      mounted = instance;
      container.hidden = false;
      const accountLabel = root.document.getElementById('lifeAccountLabel');
      if (accountLabel) accountLabel.textContent = account.email || '내 계정';
      const accountPanel = root.document.getElementById('lifeAccount');
      if (accountPanel) accountPanel.hidden = false;
      root.document.documentElement.classList.remove('auth-pending');
      root.document.getElementById('lifeStartup').hidden = true;
      sync.start().catch(() => {
        if (token === generation && !signal.aborted) notice('자료는 이 브라우저에 보관돼 있습니다. 기기 간 동기화에서 서버 연결 상태를 확인해 주세요.');
      });
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
      const authEpoch = auth.epoch;
      try {
        const user = await (publicHome ? auth.verify() : auth.requireUser());
        if (suspended || auth.epoch !== authEpoch) return null;
        const account = auth.getAccount();
        if (!user || !account) { if (publicHome) showWelcome(); return null; }
        return await show(account);
      } catch (_) {
        if (suspended || auth.epoch !== authEpoch) return null;
        hide();
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
    else if (!isReadOnly()) show(account);
  });
  root.document.addEventListener('haedo:signed-out', () => { if (publicHome) showWelcome(); else { hide(); notice('로그아웃했습니다. 저장된 자료는 보존돼 있습니다.'); } });
  root.document.addEventListener('haedo:auth-unavailable', () => { hide(); retryNotice('로그인을 확인하지 못했습니다. 인터넷 연결 후 다시 확인해 주세요.'); });
  root.addEventListener('pagehide', () => { suspended = true; hide(); });
  root.addEventListener('pageshow', event => { if (event.persisted) { suspended = false; starting = null; start(); } });
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
      container.hidden = false;
      if (accountPanel) accountPanel.hidden = false;
      notice((error?.message || '검토 내용을 보관하지 못했습니다.') + ' 로그아웃을 완료하지 않았습니다. 입력은 편집 화면에 남아 있습니다. 작업과 저장 상태를 확인한 뒤 다시 시도해 주세요.', true);
      root.document.getElementById('lifeLogout')?.focus({ preventScroll: true });
    } finally { leaving = false; }
  });
  life.Shell = { isReadOnly, start, get sync() { return sync; }, get storage() { return scopedStorage; } };
  if (publicHome && 'serviceWorker' in root.navigator) root.navigator.serviceWorker.register('./sw.js').catch(() => {});
  life.Shell.ready = start();
})(globalThis);
