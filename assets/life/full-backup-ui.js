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

  function create({ storage, timeline = null, isCurrent = () => true, announce = () => {}, onError = () => {}, onRestored = async () => {},
    onOpenWorkspace = async () => {}, onOpenAnnualPlan = null, timelineHref = 'workspace.html?section=manage#backupAll' }) {
    const F = life().FullBackup;
    let disposed = false, busy = false, generation = 0;
    const urls = new Set();
    const alive = token => !disposed && token === generation && isCurrent();
    function button(text, action, className) {
      const el = node('button', text, 'life-button' + (className ? ' ' + className : '')); el.type = 'button';
      el.addEventListener('click', async event => {
        if (busy || el.disabled) return;
        try { await action(event); } catch (error) { if (!disposed) onError(error); }
      });
      return el;
    }
    function download(blob, name) {
      const url = URL.createObjectURL(blob); urls.add(url);
      const link = node('a'); link.href = url; link.download = name; link.hidden = true;
      root.document.body.append(link); link.click(); link.remove();
      root.setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 120000);
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

    // ---------- 모두 받기 ----------
    let host, downloadHost, restoreHost, inventoryList, estimateLine, warning, downloadButton, downloadProgress, downloadStatus, downloadResult;
    let planned = null, results = null;
    const timelineSource = timeline ? () => timeline() : null;
    async function loadInventory() {
      const token = generation;
      inventoryList.replaceChildren(node('li', '파일에 담길 목록을 확인하는 중…', 'life-help'));
      downloadButton.disabled = true;
      const plan = await F.plan({ storage, timeline: timelineSource });
      if (!alive(token)) return;
      const value = await F.inventory(plan, { storage, timeline: timelineSource });
      if (!alive(token)) return;
      inventoryList.replaceChildren();
      for (const row of value.kinds) {
        const item = kindRow(row, row.kind === 'timeline' ? '이 기기에 내려받은 사본' : '');
        if (row.failed) item.append(node('span', '읽지 못한 항목 ' + row.failed + '개 · 받을 때 다시 확인합니다', 'fb-warning'));
        inventoryList.append(item);
      }
      const files = value.kinds.reduce((sum, row) => sum + row.files + row.failed, 0) + 2;
      estimateLine.textContent = '자료공간 ' + value.workspaces + '개 · 파일 ' + files + '개(README.txt·manifest.json 포함) · 예상 크기 약 ' + size(value.estimate);
      warning.hidden = value.estimate < F.LIMITS.warn;
      if (!warning.hidden) warning.textContent = value.estimate > F.LIMITS.bundle
        ? '3.5 GB를 넘어 ZIP 하나로 만들 수 없습니다. 아래 형식별 파일로 나눠 받아 주세요.'
        : '사진이 많아 파일이 큽니다. 기기 메모리가 부족하면 만들기에 실패할 수 있습니다. 실패하면 형식별 파일로 나눠 받아 주세요.';
      downloadButton.disabled = value.estimate > F.LIMITS.bundle;
    }
    function showProgress(element, status, { phase, done, total, task }) {
      element.hidden = false; element.max = Math.max(1, total); element.value = done;
      const label = phase === 'read' ? '읽는 중' : phase === 'zip' ? 'ZIP에 담는 중' : phase === 'verify' ? 'SHA-256 확인 중' : '복원 중';
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
    async function finish(partial) {
      const token = generation;
      const built = await F.build(planned, results, { appVersion: await F.appVersion(), partial,
        onProgress: value => { if (alive(token)) showProgress(downloadProgress, downloadStatus, value); } });
      if (!alive(token)) return;
      download(built.blob, built.fileName);
      downloadResult.replaceChildren();
      const heading = node('h3', partial ? '일부만 담은 ZIP을 받았습니다' : '받은 파일', null); heading.tabIndex = -1; heading.id = 'fbDownloadDone';
      downloadResult.append(heading, node('p', built.fileName + ' · ' + size(built.bytes) + ' · 파일 ' + (built.manifest.files.length + 2) + '개', 'life-meta'),
        node('p', '하나의 형식이 아닙니다. 아래 형식별 파일을 그대로 담았고 README.txt·manifest.json에 같은 목록과 SHA-256이 있습니다.', 'life-help'),
        renderFiles(built.manifest));
      if (!built.manifest.complete) downloadResult.append(node('p', '빠진 항목 ' + built.manifest.missing.length + '개는 이 ZIP에 없습니다. README.txt의 "빠진 항목"을 확인하세요.', 'fb-warning'));
      downloadStatus.textContent = '다운로드를 요청했습니다. 파일 보관 위치를 확인해 주세요.';
      downloadProgress.hidden = true;
      heading.focus({ preventScroll: false });
      announce('백업 ZIP 다운로드를 요청했습니다.');
    }
    function showFailures() {
      const failed = planned.tasks.filter(task => results.get(task.id)?.status !== 'ok');
      downloadResult.replaceChildren();
      const heading = node('h3', '읽지 못한 항목이 있어 전체 ZIP을 만들지 않았습니다'); heading.tabIndex = -1; heading.id = 'fbDownloadFailed';
      const list = node('ul', null, 'fb-kinds');
      for (const task of failed) {
        const ws = planned.workspaces.find(row => row.index === task.workspace);
        const item = node('li', null, 'fb-kind fb-failed');
        item.append(node('strong', F.KINDS[task.kind].label + (ws ? ' · ' + ws.title : '') + (task.title ? ' · ' + task.title : '')),
          node('span', results.get(task.id)?.error || '읽지 못했습니다.', 'life-meta'));
        list.append(item);
      }
      const actions = node('div', null, 'life-actions');
      const retry = button('실패한 항목 다시 시도', () => run(new Set(failed.map(task => task.id))), 'life-primary'); retry.id = 'fbRetryFailed';
      const partial = button('빠진 항목을 표시한 일부 ZIP 받기', () => withBusy(() => finish(true))); partial.id = 'fbDownloadPartial';
      actions.append(retry, partial);
      downloadResult.append(heading, list, node('p', '일부 ZIP은 manifest.json에 "complete": false로, README.txt에 빠진 항목으로 표시됩니다.', 'life-help'), actions);
      downloadProgress.hidden = true;
      downloadStatus.textContent = '읽지 못한 항목 ' + failed.length + '개 · 나머지는 아직 받지 않았습니다.';
      heading.focus();
    }
    async function withBusy(action) {
      setBusy(true);
      try { await action(); }
      finally { if (!disposed) setBusy(false); }
    }
    function run(only = null) {
      return withBusy(async () => {
        const token = generation;
        if (!only) { planned = await F.plan({ storage, timeline: timelineSource }); results = new Map(); }
        if (!alive(token)) return;
        downloadResult.replaceChildren();
        await F.collect(planned, { storage, timeline: timelineSource }, { only, results, isCurrent: () => alive(token),
          onProgress: value => { if (alive(token)) showProgress(downloadProgress, downloadStatus, value); } });
        if (!alive(token)) return;
        if (planned.tasks.some(task => results.get(task.id)?.status !== 'ok')) return showFailures();
        await finish(false);
      });
    }
    function mountDownload() {
      downloadHost.replaceChildren();
      const heading = node('h2', '모두 받기'); heading.id = 'fbDownloadHeading';
      downloadHost.setAttribute('aria-labelledby', heading.id);
      inventoryList = node('ul', null, 'fb-kinds'); inventoryList.id = 'fbInventory'; inventoryList.setAttribute('aria-label', 'ZIP에 담을 형식별 파일');
      estimateLine = node('p', '', 'life-meta'); estimateLine.id = 'fbEstimate';
      warning = node('p', '', 'fb-warning'); warning.hidden = true; warning.id = 'fbSizeWarning';
      downloadButton = button('모두 받기', () => run(), 'life-primary'); downloadButton.id = 'fbDownloadAll'; downloadButton.disabled = true;
      downloadButton.setAttribute('aria-describedby', 'fbEstimate');
      downloadProgress = progress('모두 받기 진행');
      downloadStatus = node('p', '', 'life-meta'); downloadStatus.setAttribute('role', 'status'); downloadStatus.setAttribute('aria-live', 'polite');
      downloadResult = node('div', null, 'fb-result'); downloadResult.id = 'fbDownloadResult';
      const actions = node('div', null, 'life-actions'); actions.append(downloadButton);
      downloadHost.append(heading,
        node('p', '모든 자료공간을 형식별 파일로 나눠 ZIP 하나에 담습니다. 파일마다 기존 백업 형식을 그대로 쓰며, 하나의 형식으로 합치지 않습니다.', 'life-help'),
        inventoryList, estimateLine, warning, actions, downloadProgress, downloadStatus, downloadResult);
      loadInventory().catch(error => { if (!disposed) { inventoryList.replaceChildren(node('li', '목록을 확인하지 못했습니다. 다시 열어 주세요.', 'fb-warning')); onError(error); } });
    }

    // ---------- 복원 ----------
    let fileInput, preview, restoreProgress, restoreStatus, restoreResult, opened = null, openedName = '', lastRestore = null;
    function clearPreview() { opened = null; openedName = ''; lastRestore = null; preview.replaceChildren(); }
    async function choose(file) {
      const token = generation;
      clearPreview(); restoreResult.replaceChildren();
      if (!file) return;
      const help = node('p', '파일 형식과 SHA-256을 확인하는 중입니다. 아직 복원하지 않았습니다.', 'life-help');
      preview.append(help);
      if (file.size > F.LIMITS.warn) preview.append(node('p', size(file.size) + '의 큰 파일입니다. 확인하는 동안 이 화면을 닫지 마세요.', 'fb-warning'));
      setBusy(true, restoreHost);
      try {
        const value = await F.open(file, { onProgress: progressValue => { if (alive(token)) showProgress(restoreProgress, restoreStatus, progressValue); } });
        if (!alive(token)) return;
        opened = value; openedName = file.name || '선택한 파일';
        restoreStatus.textContent = '파일을 확인했습니다. 아직 복원하지 않았습니다.';
        renderPreview();
      } catch (error) {
        if (alive(token)) { preview.replaceChildren(node('p', error.message || '파일을 읽지 못했습니다.', 'fb-warning')); preview.lastChild.id = 'fbRestoreError'; }
        restoreStatus.textContent = '복원하지 않았습니다. 기존 자료와 원래 파일은 그대로입니다.';
      } finally { if (!disposed) { setBusy(false, restoreHost); restoreProgress.hidden = true; } }
    }
    function renderPreview() {
      preview.replaceChildren();
      const heading = node('h3', openedName); heading.tabIndex = -1; heading.id = 'fbRestoreHeading';
      preview.append(heading);
      if (opened.type === 'external') return renderExternal(heading);
      if (opened.type === 'preservation') return renderPreservation(heading);
      const manifest = opened.manifest;
      preview.append(node('p', manifest
        ? '해도 전체 백업 v' + manifest.version + ' · ' + when(manifest.createdAt) + ' 생성 · ' + (manifest.appVersion || '앱 버전 기록 없음') + ' · 파일 ' + (manifest.files.length + 2) + '개 · SHA-256 확인 완료'
        : '형식별 백업 · ' + opened.entries[0].format + ' v' + opened.entries[0].formatVersion, 'life-meta'));
      if (manifest && !manifest.complete) preview.append(node('p', '일부 항목이 빠진 백업입니다(빠진 항목 ' + manifest.missing.length + '개). 담긴 항목만 복원할 수 있습니다.', 'fb-warning'));
      const fieldset = node('fieldset', null, 'fb-choices'); fieldset.append(node('legend', '복원할 형식'));
      const checks = [];
      for (const row of F.summarize(opened)) {
        const item = node('div', null, 'fb-kind'); item.dataset.kind = row.kind;
        const counts = [F.countText(row.counts), row.workspaces ? '자료공간 ' + row.workspaces + '개' : '', '파일 ' + row.files + '개', row.formats.join(', ')].filter(Boolean).join(' · ');
        if (row.restorable) {
          const label = node('label', null, 'fb-check'), input = node('input'); input.type = 'checkbox'; input.checked = true; input.value = row.kind;
          input.id = 'fbRestoreKind-' + row.kind; checks.push(input);
          const copy = node('span', null, 'fb-kind-copy'); copy.append(node('strong', row.label), node('span', counts, 'life-meta'));
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
      const sync = () => { runButton.disabled = !checks.some(input => input.checked); };
      checks.forEach(input => input.addEventListener('change', sync)); sync();
      actions.append(runButton, button('복원 취소', () => { generation++; clearPreview(); fileInput.value = ''; restoreStatus.textContent = '복원을 취소했습니다. 파일과 기존 자료는 그대로입니다.'; fileInput.focus(); }));
      preview.append(actions);
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
          await onRestored().catch(() => {}); if (!alive(token)) return;
          loadInventory().catch(() => {});
          showReport({ workspaces: [{ index: 1, title: installed.bundle?.title || '복원한 자료공간', targetId: installed.bundle?.workspaceId || installed.workspaceId }],
            items: [{ kind: 'preservation', label: F.KINDS.preservation.label, workspace: 1, workspaceTitle: installed.bundle?.title || '', status: 'restored',
              targetId: installed.bundle?.workspaceId || installed.workspaceId, counts: read.summary ? { posts: read.summary.posts.length, photos: read.summary.photos, sourceVersions: read.summary.sourceVersions } : {} }] });
        } finally { service.dispose(); }
      }), 'life-primary');
      runButton.id = 'fbRestoreRun';
      actions.append(runButton); preview.append(actions); heading.focus();
    }
    async function withRestoreBusy(action) {
      const token = generation;
      setBusy(true, restoreHost);
      try { await action(token); }
      finally { if (!disposed) { setBusy(false, restoreHost); restoreProgress.hidden = true; } }
    }
    function runRestore(kinds, retry = null) {
      return withRestoreBusy(async token => {
        restoreResult.replaceChildren();
        const targets = retry?.targets || new Map();
        const report = await F.restore(opened, { storage, kinds, targets, select: retry?.select || null, isCurrent: () => alive(token),
          onProgress: value => { if (alive(token)) showProgress(restoreProgress, restoreStatus, value); } });
        lastRestore = { kinds, targets, report };
        await onRestored().catch(() => {});
        loadInventory().catch(() => {});
        if (!alive(token)) return;
        showReport(report);
      });
    }
    function showReport(report) {
      restoreResult.replaceChildren();
      const heading = node('h3', '복원 결과'); heading.tabIndex = -1; heading.id = 'fbRestoreResultHeading';
      const restored = report.items.filter(item => item.status === 'restored').length, failed = report.items.filter(item => item.status !== 'restored');
      const copies = report.workspaces.filter(ws => ws.targetId);
      restoreResult.append(heading, node('p', '새 자료공간 ' + copies.length + '개 · 복원한 항목 ' + restored + '개' + (failed.length ? ' · 실패·건너뜀 ' + failed.length + '개' : '') + '. 기존 자료는 바뀌지 않았습니다.', failed.length ? 'fb-warning' : 'life-help'));
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
        item.append(node('strong', row.label + ' · ' + row.workspaceTitle + ' · ' + STATUS[row.status] + (row.kind === 'photoPosts' ? ' ' + row.n + '편' : '')),
          node('span', F.countText(row.counts), 'life-meta'));
        for (const text of row.messages) item.append(node('span', text, row.status === 'restored' ? 'life-meta' : 'fb-warning'));
        list.append(item);
      }
      restoreResult.append(list);
      const actions = node('div', null, 'life-actions');
      for (const ws of copies) {
        const open = button((ws.targetTitle || ws.title) + ' 열기', () => onOpenWorkspace(ws.targetId));
        open.dataset.workspaceId = ws.targetId; actions.append(open);
      }
      if (failed.length && lastRestore) {
        const wanted = new Set(failed.map(item => item.kind + ':' + item.workspace + ':' + (item.postId || '')));
        const retry = button('실패한 항목 다시 복원', () => runRestore(lastRestore.kinds, { targets: lastRestore.targets,
          select: (kind, ws, entry) => wanted.has(kind + ':' + ws + ':' + (entry?.postId || '')) }), 'life-primary');
        retry.id = 'fbRestoreRetry'; actions.prepend(retry);
      }
      restoreResult.append(actions);
      restoreStatus.textContent = '복원을 마쳤습니다.';
      heading.focus();
      announce('복원을 마쳤습니다. 기존 자료는 바뀌지 않았습니다.');
    }
    function mountRestore() {
      restoreHost.replaceChildren();
      const heading = node('h2', '복원'); heading.id = 'fbRestoreTitle'; restoreHost.setAttribute('aria-labelledby', heading.id);
      const field = node('label', null, 'life-field'); field.append(node('span', '백업 파일 선택 (ZIP·JSON)'));
      fileInput = node('input'); fileInput.type = 'file'; fileInput.id = 'fbRestoreFile'; fileInput.accept = '.zip,.json,application/zip,application/json';
      field.append(fileInput);
      fileInput.addEventListener('change', () => { generation++; choose(fileInput.files?.[0]).catch(onError); });
      preview = node('div', null, 'life-restore-preview fb-preview'); preview.id = 'fbRestorePreview';
      restoreProgress = progress('복원 진행');
      restoreStatus = node('p', '', 'life-meta'); restoreStatus.setAttribute('role', 'status'); restoreStatus.setAttribute('aria-live', 'polite');
      restoreResult = node('div', null, 'fb-result'); restoreResult.id = 'fbRestoreResult';
      restoreHost.append(heading,
        node('p', '모두 받기 ZIP이나 형식별 백업 파일을 고르세요. 형식과 버전을 확인해 내용을 보여 준 뒤, 고른 형식만 새 자료공간 사본으로 복원합니다.', 'life-help'),
        field, restoreProgress, restoreStatus, preview, restoreResult);
    }
    return Object.freeze({
      mount(target) {
        ({ host, downloadHost, restoreHost } = target);
        mountDownload(); mountRestore();
      },
      busy: () => busy,
      dispose() { disposed = true; generation++; for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }
    });
  }
  (root.HaedoLife ||= {}).FullBackupUI = Object.freeze({ create });
})(globalThis);
