/* 설정 → 백업·복원: "모두 받기" and restore from any existing backup file.
 * Uses FullBackup for data; every restore creates new workspace copies. */
(function (root) {
  'use strict';
  const life = () => root.HaedoLife;
  function node(tag, text, className) {
    const el = root.document.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function size(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + ' GB';
    if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }
  function when(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
  }
  const STATUS = { restored: '복원함', failed: '실패', skipped: '건너뜀' };
  const fault = (code, message) => Object.assign(new Error(message), { code });

  function create({ storage, timeline = null, originals = null, isCurrent = () => true, announce = () => {}, onError = () => {}, onRestored = async () => {},
    onOpenWorkspace = async () => {}, onOpenAnnualPlan = null, onInterrupted = () => {}, notice = '', confirm = text => root.confirm(text),
    localStorage = root.localStorage, timelineHref = 'workspace.html?section=manage#backupAll' }) {
    const F = life().FullBackup;
    let disposed = false, busy = null, generation = 0, lastUrl = null, lastUrlTimer = null;
    const alive = token => !disposed && token === generation && isCurrent();
    const receiptBook = () => { try { return F.receipts(storage, localStorage); } catch (_) { return null; } };
    function button(text, action, className) {
      const el = node('button', text, 'life-button' + (className ? ' ' + className : '')); el.type = 'button';
      el.addEventListener('click', async event => {
        if (busy || el.disabled) return;
        try { await action(event); } catch (error) { if (!disposed) onError(error); }
      });
      return el;
    }
    function revokeLast() {
      if (lastUrlTimer) root.clearTimeout(lastUrlTimer);
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = null; lastUrlTimer = null;
    }
    // One URL at a time: replaced by the next download, released on dispose or after 10 minutes.
    function download(blob, name) {
      revokeLast();
      const url = URL.createObjectURL(blob); lastUrl = url;
      const link = node('a'); link.href = url; link.download = name; link.hidden = true;
      root.document.body.append(link); link.click(); link.remove();
      lastUrlTimer = root.setTimeout(() => { if (lastUrl === url) revokeLast(); }, 10 * 60 * 1000);
    }
    function progress(label) {
      const el = node('progress', null, 'fb-progress'); el.hidden = true; el.max = 1; el.value = 0; el.setAttribute('aria-label', label);
      return el;
    }
    let held = [];
    // Locks the controls present now and restores each one's own state afterwards.
    function setBusy(value, scope = null) {
      busy = value;
      if (value) { held = [...(scope || host).querySelectorAll('button,input')].map(control => [control, control.disabled]); held.forEach(([control]) => { control.disabled = true; }); }
      else { held.forEach(([control, disabled]) => { if (control.isConnected) control.disabled = disabled; }); held = []; }
    }
    function kindRow(row, extra = '') {
      const item = node('li', null, 'fb-kind'); item.dataset.kind = row.kind;
      const copy = node('span', null, 'fb-kind-copy');
      copy.append(node('strong', row.label), node('span', [F.countText(row.counts), row.workspaces ? '자료공간 ' + row.workspaces + '개' : '', extra].filter(Boolean).join(' · '), 'life-meta'));
      item.append(copy);
      return item;
    }
    // Kinds this ZIP does not contain, with where they are kept instead.
    function notIncludedList(rows, id) {
      // Always named in the summary; the reasons and where each is kept open below.
      const box = node('details', null, 'life-details fb-not-included'); if (id) box.id = id;
      box.append(node('summary', '이 ZIP에 넣지 않는 것 ' + rows.length + '가지 · ' + rows.map(row => row.label + (Number.isSafeInteger(row.count) ? ' ' + row.count + '개' : '')).join(', ')));
      const list = node('ul', null, 'fb-kinds');
      for (const row of rows) {
        const item = node('li', null, 'fb-kind'); item.dataset.notIncluded = row.kind;
        const copy = node('span', null, 'fb-kind-copy');
        copy.append(node('strong', row.label + (Number.isSafeInteger(row.count) ? ' ' + row.count + '개' : '')), node('span', row.reason, 'life-meta'), node('span', row.whereToSave, 'life-meta'));
        item.append(copy); list.append(item);
      }
      box.append(list);
      return box;
    }
    function skippedList(rows) {
      const list = node('ul', null, 'fb-kinds');
      for (const row of rows) {
        const item = node('li', null, 'fb-kind'); item.dataset.skipped = row.kind;
        item.append(node('strong', F.KINDS[row.kind].label + (row.title ? ' · ' + row.title : '')), node('span', row.error, 'life-meta'));
        list.append(item);
      }
      return list;
    }

    // ---------- 모두 받기 ----------
    let host, downloadHost, restoreHost, inventoryList, estimateLine, warning, downloadButton, downloadProgress, downloadStatus, downloadResult, excludedHost;
    let planned = null, writer = null;
    const timelineSource = timeline ? () => timeline() : null;
    const context = () => ({ storage, timeline: timelineSource, originals });
    async function loadInventory() {
      const token = generation;
      inventoryList.replaceChildren(node('li', '파일에 담길 목록을 확인하는 중…', 'life-help'));
      downloadButton.disabled = true;
      const plan = await F.plan({ ...context(), isCurrent: () => alive(token) });
      if (!alive(token)) return;
      // The planned kinds are the rows the slower inventory fills in, in the
      // same order: reading every post no longer pushes the rows below. The
      // placeholders carry no data-kind, which marks a counted row.
      const plannedKinds = F.ORDER.filter(kind => plan.tasks.some(task => task.kind === kind));
      if (plannedKinds.length) inventoryList.replaceChildren(...plannedKinds.map(kind => {
        const item = node('li', null, 'fb-kind'); item.dataset.pendingKind = kind;
        const copy = node('span', null, 'fb-kind-copy');
        copy.append(node('strong', F.KINDS[kind].label), node('span', '확인하는 중…', 'life-meta'));
        item.append(copy); return item;
      }));
      // What the ZIP leaves out is already known from the plan; drawing it now
      // keeps the rows below in place when the counts arrive.
      excludedHost.replaceChildren(notIncludedList(plan.notIncluded, 'fbNotIncluded'));
      if (plan.skipped.length) excludedHost.append(node('p', '파일 형식에 맞지 않아 담지 않는 항목 ' + plan.skipped.length + '개', 'fb-warning'), skippedList(plan.skipped));
      estimateLine.textContent = '예상 크기를 확인하는 중…';
      const value = await F.inventory(plan, context(), { isCurrent: () => alive(token) });
      if (!alive(token)) return;
      inventoryList.replaceChildren();
      for (const row of value.kinds) {
        const item = kindRow(row, row.kind === 'timeline' ? '이 기기에 내려받은 사본' : '');
        if (row.failed) item.append(node('span', '읽지 못한 항목 ' + row.failed + '개 · 받을 때 다시 확인합니다', 'fb-warning'));
        inventoryList.append(item);
      }
      // The inventory reports the plan's own lists; redraw only if they differ,
      // so an opened "넣지 않는 것" stays open.
      if (value.notIncluded !== plan.notIncluded || value.skipped !== plan.skipped) {
        excludedHost.replaceChildren(notIncludedList(value.notIncluded, 'fbNotIncluded'));
        if (value.skipped.length) excludedHost.append(node('p', '파일 형식에 맞지 않아 담지 않는 항목 ' + value.skipped.length + '개', 'fb-warning'), skippedList(value.skipped));
      }
      const files = value.kinds.reduce((sum, row) => sum + row.files + row.failed, 0) + 2;
      estimateLine.textContent = '자료공간 ' + value.workspaces + '개 · 파일 ' + files + '개(README.txt·manifest.json 포함) · 예상 크기 약 ' + size(value.estimate);
      warning.hidden = value.estimate < F.LIMITS.warn;
      if (!warning.hidden) warning.textContent = value.estimate > F.LIMITS.bundle
        ? '3.5 GB를 넘어 ZIP 하나로 만들 수 없습니다. 아래 형식별 파일로 나눠 받아 주세요.'
        : '사진이 많아 파일이 큽니다. 만든 ZIP 전체가 받기 전까지 브라우저 메모리에 남으므로 기기에 따라 실패할 수 있습니다. 실패하면 형식별 파일로 나눠 받아 주세요.';
      downloadButton.disabled = value.estimate > F.LIMITS.bundle;
    }
    function showProgress(element, status, { phase, done, total, task }) {
      element.hidden = false; element.max = Math.max(1, total); element.value = done;
      const label = phase === 'read' ? '읽어서 ZIP에 담는 중' : phase === 'verify' ? 'SHA-256 확인 중' : '복원 중';
      status.textContent = label + ' ' + done + '/' + total + (task ? ' · ' + F.KINDS[task.kind].label + (task.title ? ' · ' + task.title : '') : '');
    }
    function renderFiles(manifest) {
      const list = node('ul', null, 'fb-kinds'); const kinds = {};
      for (const file of manifest.files) {
        const row = kinds[file.kind] ||= { kind: file.kind, label: F.KINDS[file.kind].label, files: 0, counts: {}, workspaces: new Set(), formats: new Set() };
        row.files++; for (const [key, value] of Object.entries(file.counts || {})) row.counts[key] = (row.counts[key] || 0) + value;
        if (file.workspace) row.workspaces.add(file.workspace); row.formats.add(file.format + ' v' + file.formatVersion);
      }
      for (const kind of F.ORDER) if (kinds[kind]) {
        const row = kinds[kind];
        list.append(kindRow({ ...row, workspaces: row.workspaces.size }, '파일 ' + row.files + '개 · ' + [...row.formats].join(', ')));
      }
      return list;
    }
    function finish(partial) {
      const token = generation;
      const built = writer.finish({ partial });
      writer = null;
      if (!alive(token)) return;
      download(built.blob, built.fileName);
      downloadResult.replaceChildren();
      const failures = built.manifest.missing.filter(item => item.reason !== 'skipped');
      const heading = node('h3', failures.length ? '일부 항목이 빠진 ZIP을 받았습니다' : '받은 파일'); heading.tabIndex = -1; heading.id = 'fbDownloadDone';
      downloadResult.append(heading, node('p', built.fileName + ' · ' + size(built.bytes) + ' · 파일 ' + (built.manifest.files.length + 2) + '개', 'life-meta'),
        node('p', '하나의 형식이 아닙니다. 아래 형식별 파일을 그대로 담았고 README.txt·manifest.json에 같은 목록과 SHA-256이 있습니다.', 'life-help'),
        renderFiles(built.manifest));
      if (failures.length) downloadResult.append(node('p', '읽지 못해 빠진 항목 ' + failures.length + '개는 이 ZIP에 없습니다. README.txt의 "빠진 항목"을 확인하세요.', 'fb-warning'));
      const skipped = built.manifest.missing.filter(item => item.reason === 'skipped');
      if (skipped.length) downloadResult.append(node('p', '형식에 맞지 않아 담지 않은 항목 ' + skipped.length + '개', 'fb-warning'), skippedList(skipped));
      downloadResult.append(notIncludedList(built.manifest.notIncluded, 'fbNotIncludedAfter'));
      downloadStatus.textContent = '다운로드를 요청했습니다. 파일 보관 위치를 확인해 주세요.';
      downloadProgress.hidden = true;
      heading.focus({ preventScroll: false });
      announce('백업 ZIP 다운로드를 요청했습니다.');
    }
    function showFailures(failed) {
      downloadResult.replaceChildren();
      const heading = node('h3', '읽지 못한 항목이 있어 ZIP을 아직 마치지 않았습니다'); heading.tabIndex = -1; heading.id = 'fbDownloadFailed';
      const list = node('ul', null, 'fb-kinds');
      for (const task of failed) {
        const ws = planned.workspaces.find(row => row.index === task.workspace);
        const item = node('li', null, 'fb-kind fb-failed');
        item.append(node('strong', F.KINDS[task.kind].label + (ws ? ' · ' + ws.title : '') + (task.title ? ' · ' + task.title : '')),
          node('span', writer.results.get(task.id)?.error || '읽지 못했습니다.', 'life-meta'));
        list.append(item);
      }
      const actions = node('div', null, 'life-actions');
      const retry = button('실패한 항목 다시 시도', () => run(new Set(failed.map(task => task.id))), 'life-primary'); retry.id = 'fbRetryFailed';
      const partial = button('빠진 항목을 표시한 일부 ZIP 받기', () => withBusy(async () => finish(true))); partial.id = 'fbDownloadPartial';
      actions.append(retry, partial);
      downloadResult.append(heading, list, node('p', '읽은 항목은 이미 ZIP에 담았습니다. 다시 시도하면 실패한 항목만 읽어 더합니다. 일부 ZIP은 manifest.json의 "complete": false와 README.txt의 빠진 항목으로 표시됩니다.', 'life-help'), actions);
      downloadProgress.hidden = true;
      downloadStatus.textContent = '읽지 못한 항목 ' + failed.length + '개 · 아직 파일을 받지 않았습니다.';
      heading.focus();
    }
    async function withBusy(action, kind = 'download', scope = null) {
      setBusy(kind, scope);
      try { await action(); }
      finally { if (!disposed) setBusy(null); }
    }
    function run(only = null) {
      return withBusy(async () => {
        const token = generation;
        if (!only || !writer) {
          planned = await F.plan({ ...context(), isCurrent: () => alive(token) });
          writer = F.writer(planned, context(), { appVersion: await F.appVersion() });
        }
        if (!alive(token)) return;
        downloadResult.replaceChildren();
        let failed;
        try {
          failed = await writer.collect({ only, isCurrent: () => alive(token),
            onProgress: value => { if (alive(token)) showProgress(downloadProgress, downloadStatus, value); } });
        } catch (error) { writer = null; downloadProgress.hidden = true; throw error; }
        if (!alive(token)) return;
        if (failed.length) return showFailures(failed);
        finish(false);
      });
    }
    function mountDownload() {
      downloadHost.replaceChildren();
      const heading = node('h2', '모두 받기'); heading.id = 'fbDownloadHeading';
      downloadHost.setAttribute('aria-labelledby', heading.id);
      inventoryList = node('ul', null, 'fb-kinds'); inventoryList.id = 'fbInventory'; inventoryList.setAttribute('aria-label', 'ZIP에 담을 형식별 파일');
      estimateLine = node('p', '', 'life-meta'); estimateLine.id = 'fbEstimate';
      warning = node('p', '', 'fb-warning'); warning.hidden = true; warning.id = 'fbSizeWarning';
      excludedHost = node('div'); excludedHost.id = 'fbExcluded';
      downloadButton = button('모두 받기', () => run(), 'life-primary'); downloadButton.id = 'fbDownloadAll'; downloadButton.disabled = true;
      downloadButton.setAttribute('aria-describedby', 'fbEstimate');
      downloadProgress = progress('모두 받기 진행');
      downloadStatus = node('p', '', 'life-meta'); downloadStatus.setAttribute('role', 'status'); downloadStatus.setAttribute('aria-live', 'polite');
      downloadResult = node('div', null, 'fb-result'); downloadResult.id = 'fbDownloadResult';
      const actions = node('div', null, 'life-actions'); actions.append(downloadButton);
      downloadHost.append(heading,
        node('p', '계정의 자료공간을 형식별 파일로 나눠 ZIP 하나에 담습니다. 파일마다 기존 백업 형식을 그대로 쓰며 하나의 형식으로 합치지 않습니다. 아래 "넣지 않는 것"은 이 ZIP에 들어가지 않습니다.', 'life-help'),
        inventoryList, estimateLine, warning, excludedHost, actions, downloadProgress, downloadStatus, downloadResult);
      loadInventory().catch(error => { if (!disposed && error?.code !== 'backup_cancelled') { inventoryList.replaceChildren(node('li', '목록을 확인하지 못했습니다. 다시 열어 주세요.', 'fb-warning')); onError(error); } });
    }

    // ---------- 복원 ----------
    let fileInput, preview, restoreProgress, restoreStatus, restoreResult, interruptedHost, opened = null, openedName = '', lastRestore = null, restoredThisFile = false;
    function clearPreview() { opened = null; openedName = ''; lastRestore = null; restoredThisFile = false; preview.replaceChildren(); }
    async function choose(file) {
      const token = generation;
      clearPreview(); restoreResult.replaceChildren();
      if (!file) return;
      const help = node('p', '파일 형식과 SHA-256을 확인하는 중입니다. 아직 복원하지 않았습니다.', 'life-help');
      preview.append(help);
      if (file.size > F.LIMITS.warn) preview.append(node('p', size(file.size) + '의 큰 파일입니다. 확인하는 동안 이 화면을 닫지 마세요.', 'fb-warning'));
      setBusy('verify', restoreHost);
      try {
        const value = await F.open(file, { onProgress: progressValue => { if (alive(token)) showProgress(restoreProgress, restoreStatus, progressValue); } });
        if (!alive(token)) return;
        opened = value; openedName = file.name || '선택한 파일';
        restoreStatus.textContent = '파일을 확인했습니다. 아직 복원하지 않았습니다.';
        renderPreview();
      } catch (error) {
        if (alive(token)) { preview.replaceChildren(node('p', error.message || '파일을 읽지 못했습니다.', 'fb-warning')); preview.lastChild.id = 'fbRestoreError'; }
        restoreStatus.textContent = '복원하지 않았습니다. 기존 자료와 원래 파일은 그대로입니다.';
      } finally { if (!disposed) { setBusy(null); restoreProgress.hidden = true; } }
    }
    // The run button stays off after a restore of this file, and needs an explicit
    // confirmation when this account already restored the same backup.
    function guardRepeat(runButton, ready) {
      const earlier = receiptBook()?.find(opened.fingerprint);
      if (!earlier) return () => { runButton.disabled = restoredThisFile || !ready(); };
      const box = node('div', null, 'fb-repeat'); box.id = 'fbRepeatWarning';
      box.append(node('p', '이 백업은 이 계정에 ' + when(earlier.restoredAt) + '에 이미 복원했습니다. 다시 복원하면 자료공간·글·사진 사본이 하나 더 생기고, 그 사본도 다른 기기로 동기화됩니다.', 'fb-warning'));
      const label = node('label', null, 'fb-check'), input = node('input'); input.type = 'checkbox'; input.id = 'fbRepeatConfirm';
      label.append(input, node('span', '같은 백업으로 새 사본을 하나 더 만듭니다'));
      box.append(label);
      runButton.before(box);
      const sync = () => { runButton.disabled = restoredThisFile || !ready() || !input.checked; };
      input.addEventListener('change', sync);
      return sync;
    }
    function renderPreview() {
      preview.replaceChildren();
      const heading = node('h3', openedName); heading.tabIndex = -1; heading.id = 'fbRestoreHeading';
      preview.append(heading);
      if (opened.type === 'external') return renderExternal(heading);
      if (opened.type === 'preservation') return renderPreservation(heading);
      const manifest = opened.manifest;
      preview.append(node('p', manifest
        ? '해도 백업 ZIP (목록 v' + manifest.version + ') · ' + when(manifest.createdAt) + ' 생성 · ' + (manifest.appVersion || '앱 버전 기록 없음') + ' · 파일 ' + (manifest.files.length + 2) + '개 · SHA-256 확인 완료'
        : '형식별 백업 · ' + opened.entries[0].format + ' v' + opened.entries[0].formatVersion, 'life-meta'));
      if (manifest) {
        const failures = manifest.missing.filter(item => manifest.version === 1 || item.reason !== 'skipped');
        if (failures.length) preview.append(node('p', '읽지 못해 빠진 항목이 있는 백업입니다(' + failures.length + '개). 담긴 항목만 복원할 수 있습니다.', 'fb-warning'));
        if (manifest.version === 1) preview.append(node('p', '첫 판 백업입니다. 연재 모음·자료로 글쓰기 준비·네이버 원문 사진·원본 첨부와 초안은 이 ZIP에 없습니다.', 'fb-warning'));
        else if (manifest.notIncluded.length) preview.append(notIncludedList(manifest.notIncluded, 'fbRestoreNotIncluded'));
      }
      const fieldset = node('fieldset', null, 'fb-choices'); fieldset.append(node('legend', '복원할 형식'));
      const checks = [];
      for (const row of F.summarize(opened)) {
        const item = node('div', null, 'fb-kind'); item.dataset.kind = row.kind;
        const counts = [F.countText(row.counts), row.workspaces ? '자료공간 ' + row.workspaces + '개' : '', '파일 ' + row.files + '개', row.formats.join(', ')].filter(Boolean).join(' · ');
        if (row.restorable) {
          const label = node('label', null, 'fb-check'), input = node('input'); input.type = 'checkbox'; input.checked = true; input.value = row.kind;
          input.id = 'fbRestoreKind-' + row.kind; checks.push(input);
          const copy = node('span', null, 'fb-kind-copy'); copy.append(node('strong', row.label), node('span', counts, 'life-meta'));
          if (row.kind === 'naverCaptures') copy.append(node('span', opened.type === 'bundle'
            ? '자료·구성과 함께 복원하면 새 사본의 같은 원문 버전에 사진을 붙입니다. 자료·구성 없이는 복원하지 않습니다.'
            : '원문과 사진을 새 자료공간 하나로 복원합니다(원문 사진 화면의 복원과 같음).', 'life-meta'));
          if (row.kind === 'originals') copy.append(node('span', '계정의 원본 첨부 보관함에 파트를 하나 더 추가합니다.', 'life-meta'));
          label.append(input, copy); item.append(label);
        } else {
          const copy = node('span', null, 'fb-kind-copy');
          copy.append(node('strong', row.label), node('span', counts + ' · 이 화면에서는 복원하지 않습니다', 'life-meta'));
          const entry = opened.entries.find(value => value.kind === row.kind);
          const actions = node('div', null, 'life-actions');
          actions.append(button('이 파일만 받기', async () => download(entry.blob || new Blob([JSON.stringify(entry.data, null, 2)], { type: 'application/json' }), 'timeline-goals-habits.json')));
          const link = node('a', '연표 목록에서 복원', 'life-button'); link.href = timelineHref; actions.append(link);
          item.append(copy, node('p', '받은 JSON을 연표 목록의 "백업 가져오기"에서 고르면 새 사본으로 가져옵니다.', 'life-help'), actions);
        }
        fieldset.append(item);
      }
      const ws = opened.workspaces.length;
      preview.append(fieldset, node('p', '원래 자료공간마다 새 사본을 하나씩 만듭니다(' + ws + '개). 사진은 원본 바이트 그대로 복원하고, 인용 근거·9칸 근거는 함께 복원한 자료의 같은 원문 버전에 연결합니다. 기존 자료공간에는 쓰지 않습니다.', 'life-help'));
      const actions = node('div', null, 'life-actions');
      const runButton = button('선택한 형식을 새 사본으로 복원', () => runRestore(new Set(checks.filter(input => input.checked).map(input => input.value))), 'life-primary');
      runButton.id = 'fbRestoreRun';
      actions.append(runButton, button('복원 취소', () => { generation++; clearPreview(); fileInput.value = ''; restoreStatus.textContent = '복원을 취소했습니다. 파일과 기존 자료는 그대로입니다.'; fileInput.focus(); }));
      preview.append(actions);
      const sync = guardRepeat(runButton, () => checks.some(input => input.checked));
      checks.forEach(input => input.addEventListener('change', sync)); sync();
      opened.syncRun = sync;
      heading.focus();
    }
    function renderExternal(heading) {
      const kind = opened.kind;
      preview.append(node('p', F.KINDS[kind].label + ' · ' + opened.format + ' v' + opened.formatVersion + (Object.keys(opened.counts || {}).length ? ' · ' + F.countText(opened.counts) : ''), 'life-meta'));
      const actions = node('div', null, 'life-actions');
      if (kind === 'timeline') {
        preview.append(node('p', '연표·목표·습관은 연표 목록 화면에서 복원합니다. 그 화면의 "백업 가져오기"에서 같은 파일을 고르면 새 사본으로 가져옵니다.', 'life-help'));
        const link = node('a', '연표 목록에서 복원', 'life-button life-primary'); link.href = timelineHref; actions.append(link);
      } else {
        preview.append(node('p', '연간 계획 파일은 연간 계획 화면의 "설정 · 백업 → 백업 불러오기"에서 확인 후 적용합니다.', 'life-help'));
        if (onOpenAnnualPlan) actions.append(button('연간 계획 열기', () => onOpenAnnualPlan(), 'life-primary'));
      }
      preview.append(actions); heading.focus();
    }
    function renderPreservation(heading) {
      preview.append(node('p', F.KINDS.preservation.label + ' · ' + opened.format + ' · 글 ' + opened.counts.posts + ' · 자료 ' + opened.counts.sources, 'life-meta'),
        node('p', '선택한 글·사진·9칸과 정확한 원문 근거를 새 자료공간 하나로 복원합니다. 기존 자료는 바꾸지 않습니다.', 'life-help'));
      const actions = node('div', null, 'life-actions');
      const runButton = button('새 자료공간으로 복원', () => withRestoreBusy(async token => {
        const active = await storage.getActive();
        const service = life().Preservation.create({ storage, workspaceId: active, isCurrent: () => alive(token) });
        try {
          const read = await service.read(opened.file); if (!alive(token)) return;
          let installed;
          // The install marks its copy active; keep the workspace in use, as the bundle restore does.
          try { installed = await service.restore(read.ticket); }
          finally { if (active) await storage.setActive(active).catch(() => {}); }
          restoredThisFile = true;
          receiptBook()?.record({ fingerprint: opened.fingerprint, fileName: openedName, copies: 1 });
          await onRestored().catch(() => {}); if (!alive(token)) return;
          loadInventory().catch(() => {});
          showReport({ workspaces: [{ index: 1, title: installed.bundle?.title || '복원한 자료공간', targetId: installed.bundle?.workspaceId || installed.workspaceId }], extraCopies: [],
            items: [{ kind: 'preservation', label: F.KINDS.preservation.label, workspace: 1, workspaceTitle: installed.bundle?.title || '', status: 'restored',
              targetId: installed.bundle?.workspaceId || installed.workspaceId, counts: read.summary ? { posts: read.summary.posts.length, photos: read.summary.photos, sourceVersions: read.summary.sourceVersions } : {} }] });
        } finally { service.dispose(); }
      }), 'life-primary');
      runButton.id = 'fbRestoreRun';
      actions.append(runButton); preview.append(actions);
      opened.syncRun = guardRepeat(runButton, () => true); opened.syncRun();
      heading.focus();
    }
    async function withRestoreBusy(action) {
      const token = generation;
      setBusy('restore', restoreHost);
      try { await action(token); }
      finally { if (!disposed) { setBusy(null); restoreProgress.hidden = true; opened?.syncRun?.(); } }
    }
    function created(report) {
      return report.workspaces.filter(ws => ws.targetId).map(ws => ws.targetTitle || ws.title).concat((report.extraCopies || []).map(copy => copy.title));
    }
    function runRestore(kinds, retry = null) {
      return withRestoreBusy(async token => {
        restoreResult.replaceChildren();
        const targets = retry?.targets || new Map();
        let report;
        try {
          report = await F.restore(opened, { storage, kinds, targets, originals, select: retry?.select || null, isCurrent: () => alive(token),
            onProgress: value => { if (alive(token)) showProgress(restoreProgress, restoreStatus, value); } });
        } catch (error) {
          if (!error?.report) throw error;
          // Interrupted: list what was already created, here or on the next visit.
          const names = created(error.report), text = '복원을 중간에 멈췄습니다. 이미 만든 새 자료공간 ' + names.length + '개' + (names.length ? '(' + names.join(', ') + ')' : '') + '는 그대로 있고, 기존 자료는 바뀌지 않았습니다.';
          if (names.length) receiptBook()?.record({ fingerprint: opened.fingerprint, createdAt: opened.manifest?.createdAt, fileName: openedName, copies: names.length });
          onInterrupted(text);
          await onRestored().catch(() => {});
          if (alive(token)) { lastRestore = { kinds, targets, report: error.report }; restoredThisFile = true; showReport(error.report, text); }
          return;
        }
        lastRestore = { kinds, targets, report }; restoredThisFile = true;
        if (report.items.some(item => item.status === 'restored'))
          receiptBook()?.record({ fingerprint: opened.fingerprint, createdAt: opened.manifest?.createdAt, fileName: openedName, copies: created(report).length });
        await onRestored().catch(() => {});
        loadInventory().catch(() => {});
        if (!alive(token)) return;
        showReport(report);
      });
    }
    function showReport(report, interrupted = '') {
      restoreResult.replaceChildren();
      const heading = node('h3', interrupted ? '복원을 멈춘 결과' : '복원 결과'); heading.tabIndex = -1; heading.id = 'fbRestoreResultHeading';
      const restored = report.items.filter(item => item.status === 'restored').length, failed = report.items.filter(item => item.status !== 'restored');
      const copies = report.workspaces.filter(ws => ws.targetId).map(ws => ({ workspaceId: ws.targetId, title: ws.targetTitle || ws.title }))
        .concat(report.extraCopies || []);
      restoreResult.append(heading, node('p', '새 자료공간 ' + copies.length + '개 · 복원한 항목 ' + restored + '개' + (failed.length ? ' · 실패·건너뜀 ' + failed.length + '개' : '') + '. 기존 자료는 바뀌지 않았습니다.', failed.length ? 'fb-warning' : 'life-help'));
      if (interrupted) restoreResult.append(node('p', interrupted, 'fb-warning'));
      const list = node('ul', null, 'fb-kinds'); list.id = 'fbRestoreReport';
      const grouped = new Map();
      for (const item of report.items) {
        const key = item.kind + ':' + item.workspace + ':' + item.status;
        const row = grouped.get(key) || { ...item, n: 0, counts: {}, messages: new Set() };
        row.n++; for (const [name, value] of Object.entries(item.counts || {})) row.counts[name] = (row.counts[name] || 0) + value;
        if (item.message) row.messages.add((item.title ? item.title + ': ' : '') + item.message);
        grouped.set(key, row);
      }
      for (const row of grouped.values()) {
        const item = node('li', null, 'fb-kind' + (row.status === 'restored' ? '' : ' fb-failed')); item.dataset.kind = row.kind; item.dataset.status = row.status;
        item.append(node('strong', row.label + ' · ' + row.workspaceTitle + ' · ' + STATUS[row.status] + (row.n > 1 ? ' ' + row.n + '개' : '')),
          node('span', F.countText(row.counts), 'life-meta'));
        for (const text of row.messages) item.append(node('span', text, row.status === 'restored' ? 'life-meta' : 'fb-warning'));
        list.append(item);
      }
      restoreResult.append(list);
      const actions = node('div', null, 'life-actions');
      for (const copy of copies) {
        const open = button(copy.title + ' 열기', () => onOpenWorkspace(copy.workspaceId));
        open.dataset.workspaceId = copy.workspaceId; actions.append(open);
      }
      if (failed.length && lastRestore) {
        const wanted = new Set(failed.map(item => item.kind + ':' + item.workspace + ':' + (item.postId || item.partId || '')));
        const retry = button('실패한 항목 다시 복원', () => runRestore(lastRestore.kinds, { targets: lastRestore.targets,
          select: (kind, ws, entry) => wanted.has(kind + ':' + (ws ?? 0) + ':' + (entry?.postId || entry?.partId || '')) }), 'life-primary');
        retry.id = 'fbRestoreRetry'; actions.prepend(retry);
      }
      restoreResult.append(actions);
      restoreStatus.textContent = interrupted ? '복원을 멈췄습니다.' : '복원을 마쳤습니다. 같은 파일로 다시 복원하려면 파일을 다시 고르세요.';
      heading.focus();
      announce(interrupted || '복원을 마쳤습니다. 기존 자료는 바뀌지 않았습니다.');
    }
    function mountRestore() {
      restoreHost.replaceChildren();
      const heading = node('h2', '복원'); heading.id = 'fbRestoreTitle'; restoreHost.setAttribute('aria-labelledby', heading.id);
      interruptedHost = node('p', notice || '', 'fb-warning'); interruptedHost.id = 'fbInterrupted'; interruptedHost.hidden = !notice;
      const field = node('label', null, 'life-field'); field.append(node('span', '백업 파일 선택 (ZIP·JSON)'));
      fileInput = node('input'); fileInput.type = 'file'; fileInput.id = 'fbRestoreFile'; fileInput.accept = '.zip,.json,application/zip,application/json';
      field.append(fileInput);
      fileInput.addEventListener('change', () => { generation++; choose(fileInput.files?.[0]).catch(onError); });
      preview = node('div', null, 'life-restore-preview fb-preview'); preview.id = 'fbRestorePreview';
      restoreProgress = progress('복원 진행');
      restoreStatus = node('p', '', 'life-meta'); restoreStatus.setAttribute('role', 'status'); restoreStatus.setAttribute('aria-live', 'polite');
      restoreResult = node('div', null, 'fb-result'); restoreResult.id = 'fbRestoreResult';
      restoreHost.append(heading, interruptedHost,
        node('p', '모두 받기 ZIP이나 형식별 백업 파일을 고르세요. 형식과 버전을 확인해 내용을 보여 준 뒤, 고른 형식만 새 자료공간 사본으로 복원합니다.', 'life-help'),
        field, restoreProgress, restoreStatus, preview, restoreResult);
    }
    return Object.freeze({
      mount(target) {
        ({ host, downloadHost, restoreHost } = target);
        mountDownload(); mountRestore();
      },
      busy: () => !!busy,
      // Navigation guard: leaving while a file is written or restored needs a confirmation.
      flush() {
        if (!busy || disposed) return;
        const text = busy === 'restore' ? '복원이 진행 중입니다. 이동하면 남은 복원을 멈춥니다. 이미 만든 사본은 남습니다. 이동할까요?'
          : busy === 'verify' ? '백업 파일을 확인하는 중입니다. 이동하면 확인을 멈춥니다. 이동할까요?'
          : '백업 ZIP을 만드는 중입니다. 이동하면 지금까지 만든 내용은 버리고 파일을 받지 않습니다. 이동할까요?';
        if (!confirm(text)) throw fault('backup_busy', busy === 'restore' ? '복원이 끝난 뒤 이동해 주세요.' : '백업 작업이 끝난 뒤 이동해 주세요.');
        generation++; writer = null;
      },
      dispose() { disposed = true; generation++; writer = null; revokeLast(); }
    });
  }
  (root.HaedoLife ||= {}).FullBackupUI = Object.freeze({ create });
})(globalThis);
