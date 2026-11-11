/* Shared material workspace; public home mounts only after account verification. */
(function (root) {
  'use strict';
  const life = root.HaedoLife = root.HaedoLife || {};
  // Frames of index.html/life.html: app blobs/srcdoc, YouTube player (page-media.js), checked news
  // publishers (discovery-ui.js FRAME_ALLOWED_SOURCES). Only frame-src is set. It is added here, before
  // any view can create a frame, not written as <meta http-equiv> in the HTML: Chromium's preload
  // scanner stops looking ahead at a CSP meta tag, so the pages' ~180 scripts were fetched one after
  // another (2026-11-03, slow first screen). A meta inserted into head is enforced the same way.
  const FRAME_POLICY = "frame-src 'self' blob: https://www.youtube-nocookie.com https://www.readersnews.com https://www.frontiersin.org";
  if (![...root.document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')].some(meta => meta.content === FRAME_POLICY)) {
    const policy = root.document.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy'; policy.content = FRAME_POLICY;
    root.document.head.append(policy);
  }
  const auth = root.HaedoAuth;
  const publicHome = root.document.body?.dataset.lifeHome === 'true';
  let mounted, sync, compositionSync, libraryMetaSync, accountLibrary, writingSync, accountDocsSync, scopedStorage, controller, showing, generation = 0, activeKey = null, starting, leaving = false, suspended = false;
  let rssReflection = null, rssLoading = null;
  let retained = false, resumePoint = null, suspension = 0;
  // Recovery belongs to one consecutive failure streak, not to each build's
  // generation. Only real recovery, an owner change or a manual retry resets it.
  let failure = null, retryOwner = null, automaticRetries = 0;
  const AUTO_RETRY_LIMIT = 3;
  // An opening that failed for want of a connection is also tried again by itself after these waits
  // (2026-11-11 m2): three times at most for one failure streak, then only 다시 확인 and the events above.
  // These tries have their own count, so the online / shown-again retries keep their budget. A hidden or
  // offline page spends none. A timed try is quiet: the failure notice and its 다시 확인 stay on screen.
  const AUTO_RETRY_DELAYS = [2000, 5000, 15000];
  let retryTimer = null, timedRetries = 0, attempts = 0;
  // A screen that was just opened never shows only a checking line for longer than this (2026-11-11
  // re-review): a check that is allowed more (after lapses on a slow connection, platform-auth
  // VERIFY_PATIENCE) goes on in the background while the failure notice and 다시 확인 are already there; when
  // it is answered after all, the app opens. A check the owner asked for with 다시 확인 keeps its checking
  // line: it says how long it may take.
  const NOTICE_AFTER_MS = 10000;
  const CHECK_FAILED = '로그인을 확인하지 못했습니다. 연결이 끊겼거나 느립니다. 다시 확인해 주세요. 저장된 자료는 보존돼 있습니다.';
  // The attempt whose account check is still out while the failure notice is on screen (a quiet try, or a
  // check that passed NOTICE_AFTER_MS); 0 when there is none. checkBegan: when the latest attempt began.
  let noticedCheck = 0, checkBegan = 0;
  // A check this old may have been sent into the connection that was lost; a newer one went out on the
  // connection the signal is about (the signals of one return, online and shown again, come together).
  const RENEW_AFTER_MS = 1000;
  const retryableFailures = new Set(['network_error', 'storage_unavailable', 'request_cancelled', 'storage_aborted']);
  const accountKey = account => account ? account.projectUrl + '|' + account.userId : null;
  function resetRecovery() { failure = null; retryOwner = null; automaticRetries = 0; timedRetries = 0; if (retryTimer) { root.clearTimeout(retryTimer); retryTimer = null; } }
  function scheduleRetry() {
    if (retryTimer) { root.clearTimeout(retryTimer); retryTimer = null; }
    if (failure?.code !== 'network_error' || timedRetries >= AUTO_RETRY_DELAYS.length) return;
    retryTimer = root.setTimeout(() => { retryTimer = null; retryAutomatically(true); }, AUTO_RETRY_DELAYS[timedRetries]);
  }
  function recoveryOwner(key) {
    if (retryOwner && retryOwner !== key) resetRecovery();
    retryOwner = key;
  }
  function recordFailure(error, key, message) {
    if (key) recoveryOwner(key);
    const code = typeof error?.code === 'string' ? error.code : null;
    const name = error?.name || 'unknown_error';
    // Raw IndexedDB exceptions can carry numeric DOM codes. Match only the
    // known transient names; a string error code always controls classification.
    const retryable = retryableFailures.has(code) || code === null && ['AbortError', 'InvalidStateError'].includes(name) || error?.code == null && name === 'Error';
    failure = { key, code: code || name, retryable, message };
    // A quiet try that failed the same way keeps the notice it left on screen (and a focused 다시 확인).
    const status = root.document.getElementById('lifeStartup');
    if (status.hidden || status.getAttribute('role') !== 'alert' || status.querySelector('p')?.textContent !== message || !status.querySelector('button:not(:disabled)')) retryNotice(message);
    scheduleRetry();
  }
  // timed: one of the AUTO_RETRY_DELAYS tries; otherwise an event. returned: the event says the connection or
  // the screen came back (online, shown again), not that the account became known.
  function retryAutomatically(timed = false, returned = false) {
    // The connection or the screen came back while a check is out behind the failure notice: that check may
    // be waiting on a request the lost connection will never answer (it would keep the screen closed for the
    // rest of its limit, or for good after the last timed try). It is given up and the account is asked
    // anew, quietly, as 다시 확인 does. These restarts are counted like every event retry, so any number of
    // signals makes at most AUTO_RETRY_LIMIT requests. (The account notice of that very check being answered
    // is no such signal: the check is about to open the screen.)
    const renew = timed !== true && returned === true && !!starting && noticedCheck === attempts && noticedCheck !== 0 && Date.now() - checkBegan >= RENEW_AFTER_MS;
    if (!failure?.retryable || (timed === true ? timedRetries >= AUTO_RETRY_DELAYS.length : automaticRetries >= AUTO_RETRY_LIMIT) || starting && !renew || showing || suspended || retained || leaving || isReadOnly()) return false;
    if (root.document.visibilityState === 'hidden' || root.navigator.onLine === false) return false;
    const key = accountKey(auth?.getAccount());
    // An initial Auth network failure has no verified owner yet. A real logout
    // clears its failure record through the null-account notification instead.
    if (failure.key && failure.key !== key) return false;
    if (timed === true) timedRetries += 1; else automaticRetries += 1;
    if (renew) { starting = null; start(true, true); } else start(timed === true);
    return true;
  }
  let workerScheduled = false;
  function scheduleRssReflection(instance, storage, token, signal) {
    const current = () => !signal.aborted && token === generation && mounted === instance && !suspended && !retained && !leaving;
    let reflectionNotice = null;
    const clearNotice = () => { reflectionNotice?.remove(); reflectionNotice = null; };
    signal.addEventListener('abort', clearNotice, { once: true });
    const onStatus = status => {
      if (!current()) return;
      const blocked = status.state === 'blocked';
      // Temporary failures retry by themselves; after several in a row a quiet,
      // non-blocking status line says so until one check succeeds again.
      if (!blocked && !(status.state === 'error' && status.unavailable === true)) { clearNotice(); return; }
      const main = root.document.querySelector('#lifeApp #lifeMain');
      if (!main) return;
      const id = blocked ? 'rssReflectionError' : 'rssReflectionStatus';
      if (reflectionNotice?.id !== id) clearNotice();
      if (!reflectionNotice?.isConnected) {
        reflectionNotice = root.document.createElement('p');
        reflectionNotice.id = id;
        reflectionNotice.className = blocked ? 'life-error' : 'life-status';
        reflectionNotice.setAttribute('role', blocked ? 'alert' : 'status');
        main.before(reflectionNotice);
      }
      const title = blocked && typeof status.blockedItemTitle === 'string' ? status.blockedItemTitle.trim() : '';
      // The title goes after a colon so the sentence never depends on its final consonant.
      const named = title ? ': “' + (title.length > 80 ? title.slice(0, 80) + '…' : title) + '”' : '';
      const text = blocked ? 'RSS 글을 보관하지 못했습니다' + named + '. 설정의 RSS/Atom 연결에서 상태를 확인해 주세요.'
        : 'RSS 수신함을 확인하지 못하고 있습니다. 설정의 RSS/Atom 연결에서 상태를 확인해 주세요.';
      // Each interval republishes the same state; rewrite (and re-announce) only a change.
      if (reflectionNotice.textContent !== text) reflectionNotice.textContent = text;
    };
    // Keep module loading and private inbox requests off the first-screen path.
    const queue = () => root.requestAnimationFrame(() => {
      const idle = root.requestIdleCallback || (callback => root.setTimeout(callback, 0));
      idle.call(root, () => {
        if (!current()) return;
        // Offline, RSS sends nothing and loads nothing; the 'online' event queues it again.
        if (root.navigator.onLine === false && !life.RssConnection) return;
        if (!rssLoading) rssLoading = life.RssConnection ? Promise.resolve() : new Promise((resolve, reject) => {
          const src = new URL('assets/life/rss-connection.js', root.document.baseURI).href;
          const existing = [...root.document.scripts].find(script => script.src === src);
          const script = existing || root.document.createElement('script');
          script.addEventListener('load', resolve, { once: true });
          script.addEventListener('error', error => { script.remove(); reject(error); }, { once: true });
          if (!existing) { script.src = src; root.document.head.append(script); }
        }).catch(error => { rssLoading = null; throw error; });
        rssLoading.then(() => {
          if (!current() || rssReflection || !life.RssConnection?.createReflection) return;
          rssReflection = life.RssConnection.createReflection({ storage, auth, core: life.Core, isCurrent: current, onStatus });
          rssReflection.start();
        }).catch(() => { /* RSS can retry on the next opening; the current screen stays usable. */ });
      }, { timeout: 2000 });
    });
    root.document.addEventListener('haedo:page-ready', queue, { signal });
    root.addEventListener('online', queue, { signal });
    queue();
  }
  function scheduleWorker() {
    if (workerScheduled || !('serviceWorker' in root.navigator)) return;
    workerScheduled = true;
    // Installing the complete offline shell must not compete with the first
    // account check and visible screen. Reuse one registration per page load.
    root.requestAnimationFrame(() => root.setTimeout(() => {
      root.navigator.serviceWorker.register('./sw.js').catch(() => { workerScheduled = false; });
    }, 0));
  }
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
    resetRecovery();
    retained = false; resumePoint = null;
    root.document.getElementById('lifeApp').hidden = false;
    const accountLabel = root.document.getElementById('lifeAccountLabel');
    if (accountLabel) accountLabel.textContent = account.email || '내 계정';
    const accountPanel = root.document.getElementById('lifeAccount');
    if (accountPanel) accountPanel.hidden = false;
    root.document.documentElement.classList.remove('auth-pending');
    root.document.getElementById('lifeStartup').hidden = true;
    // Resume retained consumers only after their owner has been verified and revealed.
    root.document.dispatchEvent(new root.Event('haedo:page-ready'));
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
    rssReflection?.dispose(); rssReflection = null;
    mounted?.dispose?.(); mounted = null;
    accountLibrary?.dispose?.(); accountLibrary = null;
    libraryMetaSync?.dispose?.(); libraryMetaSync = null;
    compositionSync?.dispose?.(); compositionSync = null;
    writingSync?.dispose?.(); writingSync = null;
    accountDocsSync?.dispose?.(); accountDocsSync = null;
    sync?.dispose?.(); sync = null;
    life.Storage?.clearAccount?.(); scopedStorage = null;
    container.replaceChildren();
    activeKey = null; failure = null;
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
    // The owner asks: this check waits the longest (a slow connection) and replaces one that has not been answered.
    retry.addEventListener('click', () => { resetRecovery(); starting = null; start(false, true); });
    const login = root.document.createElement('a');
    login.href = loginPath(); login.className = 'life-button'; login.textContent = '로그인 화면';
    status.append(retry, login);
  }
  function show(account) {
    if (suspended || isReadOnly()) return Promise.resolve(null);
    const key = account.projectUrl + '|' + account.userId;
    recoveryOwner(key);
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
    // Keep the recovery streak while its attempt is in flight, including a
    // pagehide before the mount completes. Completion replaces or clears it.
    const openingFailure = failure; hide(); failure = openingFailure;
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
      const automatic = !!life.AccountLibrary?.create;
      sync = life.Sync.create({ storage, core: life.Core, remoteFactory: life.PlatformRemote.create, automatic: !automatic });
      compositionSync = life.CompositionSync.create({ storage, sourceSync: sync, auth,
        initialReceive: automatic ? (workspaceId, binding, row, options) => accountLibrary?.getMode() === 'account'
          ? storage.adoptCompositionRemote(workspaceId, binding, row, options) : { status: 'conflict' } : null });
      libraryMetaSync = life.LibraryMetaSync?.create({ storage, sourceSync: sync, auth });
      writingSync = life.WritingSync.create({ storage, sourceSync: sync, auth });
      let bootstrap = null;
      if (automatic) {
        accountLibrary = life.AccountLibrary.create({ storage, core: life.Core, sync, compositionSync, libraryMetaSync, auth });
        notice('계정 자료를 확인하고 있습니다.');
        bootstrap = await accountLibrary.bootstrap({ foreground: true });
        if (signal.aborted || token !== generation || key !== auth.getAccount()?.projectUrl + '|' + auth.getAccount()?.userId) return null;
        if (!bootstrap?.cached && !bootstrap?.workspaceId && !bootstrap?.legacy) {
          // Keep the retry frame alive. Never create an independent empty library
          // while the account's canonical workspace is still unknown.
          throw Object.assign(new Error(bootstrap?.error?.message || '계정 자료를 열지 못했습니다. 연결을 확인하고 다시 시도해 주세요.'), { code: bootstrap?.error?.code });
        }
      }
      const instance = await life.UI.mount(container, { storage, core: life.Core, legacy, sync, compositionSync, libraryMetaSync, accountLibrary, bootstrap, writingSync, auth, signal });
      if (signal.aborted || token !== generation || key !== auth.getAccount()?.projectUrl + '|' + auth.getAccount()?.userId) { instance?.dispose(); return null; }
      mounted = instance;
      reveal(account);
      if (bootstrap?.background) {
        const library = accountLibrary;
        root.requestAnimationFrame(() => {
          if (signal.aborted || token !== generation || mounted !== instance || accountLibrary !== library) return;
          library.reconcile().catch(() => {});
        });
      }
      if (bootstrap?.legacy) sync.setAutomatic?.(true);
      // A legacy (capability 0) bootstrap already started this account's sync.
      // Starting it again reset the verified connection and left no account
      // until a second server check returned.
      if (!automatic) sync.start().catch(() => {
        if (token === generation && !signal.aborted) notice('서버에 연결하지 못했습니다. 바뀐 자료는 보존되고 연결되면 계정에 자동 저장됩니다.');
      });
      if (!automatic || bootstrap?.legacy) compositionSync.start();
      writingSync.start();
      // Account documents (owner directive 2026-11-01): settings, reading
      // position, plans and drafts follow the verified account to every signed-in
      // device automatically. One engine per account; hide() disposes it.
      try { accountDocsSync = life.AccountDocsSync?.create({ storage, auth }) || null; accountDocsSync?.start(); }
      catch (_) { accountDocsSync = null; /* Local saves stay intact; the next open retries. */ }
      scheduleRssReflection(instance, storage, token, signal);
      scheduleWorker();
      return mounted;
    } catch (error) {
      if (signal.aborted || token !== generation) return null;
      hide();
      recordFailure(error, key, error?.message || '자료 화면을 열지 못했습니다. 저장된 자료는 보존돼 있습니다.');
      return null;
    }
  }
  // quiet (a timed automatic try): the failure notice stays while the account is checked again.
  // patient (다시 확인): platform-auth waits its longest limit and gives up an earlier check still out.
  function start(quiet = false, patient = false) {
    if (suspended) return Promise.resolve(null);
    if (starting) return starting;
    // 다시 확인 may be pressed while a quiet try is still out: the earlier attempt then changes nothing.
    const attempt = ++attempts;
    checkBegan = Date.now();
    const pending = (async () => {
      if (isReadOnly()) { hide(); notice('읽기 전용 주소에서는 개인 자료를 열지 않습니다.'); return null; }
      if (!auth) { hide(); retryNotice('로그인 연결을 준비하지 못했습니다.'); return null; }
      // This tab's checks have been running into their limit, so this one is allowed more than NOTICE_AFTER_MS.
      const slow = patient !== true && Number(auth.verifyWait?.()) > NOTICE_AFTER_MS;
      if (quiet !== true) notice(patient === true ? '로그인을 확인하고 있습니다. 연결이 느리면 30초까지 걸립니다.' : slow ? '로그인을 확인하고 있습니다. 연결이 느려 평소보다 오래 걸릴 수 있습니다.' : '로그인을 확인하고 있습니다.');
      const asked = patient === true ? { startup: true, patient: true } : { startup: true };
      const authEpoch = auth.epoch, cached = retained ? mounted : null, transition = suspension;
      // One server check for the opening: the foreground account bootstrap and the
      // first mount reuse it while the session, token and account stay the same.
      const opening = auth.beginStartup?.(patient === true ? { patient: true } : undefined);
      // A quiet try already has the notice on screen. Another check gets it after NOTICE_AFTER_MS while it goes on.
      let noticeTimer = null;
      if (quiet === true) noticedCheck = attempt;
      else if (slow) noticeTimer = root.setTimeout(() => {
        noticeTimer = null;
        if (attempt !== attempts || suspended) return;
        noticedCheck = attempt;
        // Not a failure yet (no timed retry is due): the record lets an online / shown-again signal ask anew.
        failure = { key: accountKey(auth.getAccount()), code: 'network_error', retryable: true, message: CHECK_FAILED };
        retryNotice(CHECK_FAILED);
      }, NOTICE_AFTER_MS);
      const checked = () => { if (noticeTimer) { root.clearTimeout(noticeTimer); noticeTimer = null; } if (noticedCheck === attempt) noticedCheck = 0; };
      try {
        const user = await (publicHome ? auth.verify(asked) : auth.requireUser(asked)).finally(checked);
        if (suspended || auth.epoch !== authEpoch || attempt !== attempts) return null;
        if (cached && (cached !== mounted || transition !== suspension)) return null;
        const account = auth.getAccount();
        if (!user || !account) { if (publicHome) showWelcome(); return null; }
        return await show(account);
      } catch (error) {
        if (suspended || auth.epoch !== authEpoch || attempt !== attempts) return null;
        if (cached && cached === mounted && transition === suspension && auth.getAccount()?.projectUrl + '|' + auth.getAccount()?.userId === activeKey) conceal();
        else hide();
        recordFailure(error, accountKey(auth.getAccount()), CHECK_FAILED);
        return null;
      } finally { opening?.end(); }
    })();
    starting = pending;
    pending.finally(() => { if (starting === pending) starting = null; });
    return pending;
  }
  auth?.onAccountChange(account => {
    if (!account) { resetRecovery(); if (publicHome) showWelcome(); else { hide(); notice('로그인을 확인한 뒤 자료를 다시 열 수 있습니다. 저장된 자료는 보존돼 있습니다.'); } }
    else if (!isReadOnly()) {
      const key = account.projectUrl + '|' + account.userId;
      recoveryOwner(key);
      if (failure && (!failure.key || failure.key === key)) { if (failure.retryable) retryAutomatically(); return; }
      // A retained view is revealed only by its own completed resume verify.
      // A different owner always destroys it through the existing hard boundary.
      if (retained && key === activeKey) return;
      if (suspended && activeKey && key !== activeKey) hide();
      show(account);
    }
  });
  root.document.addEventListener('haedo:signed-out', () => { resetRecovery(); if (publicHome) showWelcome(); else { hide(); notice('로그아웃했습니다. 저장된 자료는 보존돼 있습니다.'); } });
  root.document.addEventListener('haedo:auth-unavailable', event => {
    const account = auth?.getAccount();
    if (retained && account && activeKey === account.projectUrl + '|' + account.userId) conceal();
    else hide();
    recordFailure({ code: event.code || 'auth_error' }, accountKey(account), '로그인을 확인하지 못했습니다. 연결이 끊겼거나 느립니다. 다시 확인해 주세요.');
  });
  root.document.addEventListener('visibilitychange', () => {
    if (!root.document.hidden) retryAutomatically(false, true);
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
    if (!mounted) { const failed = failure; hide(); failure = failed; return; }
    const point = rememberPosition();
    // A native leave dialog can change scroll while keeping the same focused
    // field. Prefer its earlier, still-owned position over that later layout.
    const container = root.document.getElementById('lifeApp');
    if (!(resumePoint?.owner === activeKey && resumePoint.element?.isConnected && container.contains(resumePoint.element))) resumePoint = point;
    retained = true;
    conceal();
    // Closing the scope aborts IndexedDB commits. Keep this owner alive while
    // the browser caches the page, and checkpoint only its accepted local model.
    Promise.resolve(mounted.checkpoint?.()).catch(() => {});
  });
  root.document.addEventListener('haedo:page-resume', event => {
    event.preventDefault();
    suspended = false;
    if (mounted && retained || !failure) start();
    else if (!retryAutomatically() && !starting && !showing) {
      const status = root.document.getElementById('lifeStartup');
      // An aborted attempt can leave only a loading message. Restore its last
      // error, but retain a complete error frame and its already focused button.
      if (status.hidden || status.getAttribute('role') !== 'alert' || status.querySelector('p')?.textContent !== failure.message || !status.querySelector('button:not(:disabled)')) retryNotice(failure.message);
    }
  });
  root.addEventListener('online', () => { retryAutomatically(false, true); });
  // Persisted pageshow is owned by Auth's page-resume event above. Do not race
  // its verification or bypass the failure budget with a second start.
  root.addEventListener('pageshow', event => { if (!event.persisted) retryAutomatically(false, true); });
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
  life.Shell = { isReadOnly, start, get sync() { return sync; }, get compositionSync() { return compositionSync; }, get libraryMetaSync() { return libraryMetaSync; }, get accountLibrary() { return accountLibrary; }, get originals() { return accountLibrary?.originals || null; }, get writingSync() { return writingSync; }, get accountDocsSync() { return accountDocsSync; }, get storage() { return scopedStorage; } };
  life.Shell.ready = start();
  if (publicHome) life.Shell.ready.finally(scheduleWorker).catch(() => {});
})(globalThis);
