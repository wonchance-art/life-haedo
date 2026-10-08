/* A focused management surface. No extra frame in the reading or editing feed. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const labels = { not_enabled: '이 브라우저에만 보관 중', pending: '구성 전송 대기', synced: '서버 구성과 연결됨', conflict: '양쪽 구성 비교 필요', error: '구성 이어쓰기 확인 필요', paused: '구성 이어쓰기 중지됨' };
  function node(tag, text, cls) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; }
  function create({ host, manager, storage, workspaceId, beforeAction = async () => {}, isCurrent = () => true }) {
    let disposed = false, sequence = 0, actionSequence = 0, busy = false, view = null, error = '', message = '', state = null, recoveries = [];
    const urls = new Set();
    host.id = 'lifeCompositionSync'; host.classList.add('life-composition-sync');
    const alive = () => !disposed && isCurrent() && host.isConnected;
    const title = node('h3', '묶음·내 페이지 이어쓰기');
    const status = node('p', '구성 연결을 확인하는 중…', 'life-help'); status.id = 'compositionStatus'; status.setAttribute('role', 'status');
    const errorNode = node('p', '', 'life-error'); errorNode.id = 'compositionError'; errorNode.setAttribute('role', 'alert'); errorNode.hidden = true;
    const body = node('div', null, 'composition-content');
    host.append(title, status, errorNode, body);
    const pause = async () => { await manager.pause(workspaceId); view = null; };
    function button(label, id, action, cls = '', interrupt = false) {
      const el = node('button', label, 'life-button ' + cls); el.type = 'button'; if (id) el.id = id;
      if (interrupt) el.dataset.interrupt = 'true';
      el.addEventListener('click', async () => {
        if (!alive() || busy && !interrupt) return;
        const actionToken = ++actionSequence; sequence++;
        busy = true; error = ''; errorNode.hidden = true; host.setAttribute('aria-busy', 'true');
        body.querySelectorAll('button').forEach(value => { value.disabled = !value.dataset.interrupt; });
        if (id === 'compositionEnable' && !body.querySelector('#compositionPause')) body.append(button('연결 시작 취소', 'compositionPause', pause, '', true));
        try { await beforeAction(); if (!alive() || actionToken !== actionSequence) return; await action(); }
        catch (cause) { if (alive() && actionToken === actionSequence) { error = cause.message || '구성을 처리하지 못했습니다. 현재 내용은 보존됩니다.'; if (['composition_conflict_changed','remote_missing','stale_sync_result'].includes(cause.code)) view = null; } }
        finally {
          if (actionToken === actionSequence) {
            busy = false;
            if (alive()) { await refresh(); (body.querySelector('#' + (id || 'compositionSyncNow')) || body.querySelector('button'))?.focus({ preventScroll: true }); }
          }
        }
      }); return el;
    }
    function versionLine(id, enabled = true) {
      const version = view.bundle.sourceVersions.find(value => value.id === id);
      if (!version) return node('p', '받지 못한 원문 · ' + id, 'life-meta');
      const source = view.bundle.sources.find(value => value.id === version.sourceId);
      const number = view.bundle.sourceVersions.filter(value => value.sourceId === version.sourceId).findIndex(value => value.id === id) + 1;
      const line = node('div', null, 'composition-reference');
      line.append(node('p', (source?.title || '제목 없는 원문') + ' · 버전 ' + number + (enabled ? ' · 표시' : ' · 숨김'), 'life-meta'));
      line.append(node('p', version.contentText == null ? '본문 미확보 · 링크만 보관' : version.contentText.slice(0, 160) + (version.contentText.length > 160 ? '…' : ''), 'life-note'));
      return line;
    }
    function summary(label, data, key, openKeys) {
      const section = node('section', null, 'composition-side');
      section.append(node('h4', label), node('p', data.page.title, 'life-note'), node('p', '묶음 ' + data.groups.length + '개 · 페이지 항목 ' + data.page.entries.length + '개', 'life-meta'));
      const details = node('details', null, 'life-details'); details.dataset.section = key; details.open = openKeys.has(key);
      const toggle = node('summary', '내용과 표시 확인'); toggle.id = 'compositionDetails-' + key; details.append(toggle);
      if (data.page.intro) details.append(node('p', data.page.intro, 'life-note'));
      details.append(node('p', '소개 ' + (data.page.showIntro ? '표시' : '숨김') + ' · 고정하지 않은 항목 ' + (data.page.showRecent ? '표시' : '숨김'), 'life-meta'));
      data.groups.forEach(group => { details.append(node('h5', group.title + ' · 묶음')); group.versionIds.forEach(id => details.append(versionLine(id))); });
      data.page.entries.forEach(entry => {
        const part = node('div', null, 'composition-entry');
        part.append(node('h5', entry.title), node('p', (entry.enabled ? '표시' : '숨김') + (entry.pinned ? ' · 고정' : '') + ' · 원문 ' + entry.parts.filter(value => value.enabled).length + '/' + entry.parts.length + '개 · 본문 ' + (entry.showBody ? '표시' : '숨김') + ' · 코멘트 ' + (entry.showNote ? '표시' : '숨김'), 'life-meta'));
        if (entry.note) part.append(node('p', entry.note, 'life-note'));
        entry.parts.forEach(value => part.append(versionLine(value.versionId, value.enabled))); details.append(part);
      });
      if (data.reflection.note) details.append(node('h5', '회고'), node('p', data.reflection.note, 'life-note'));
      details.append(node('p', '회고에 고른 원문 ' + data.reflection.versionIds.length + '개 · 관련 기록 제외 ' + (data.discovery?.excludedPairs.length || 0) + '개', 'life-meta'));
      data.reflection.versionIds.forEach(id => details.append(versionLine(id)));
      const sourceName = id => view.bundle.sources.find(value => value.id === id)?.title || '받지 못한 원문 · ' + id;
      data.discovery?.excludedPairs.forEach(pair => details.append(node('p', sourceName(pair.seedSourceId) + ' → ' + sourceName(pair.candidateSourceId) + ' · 관련 기록에서 제외', 'life-meta')));
      section.append(details); return section;
    }
    async function downloadRecovery(id) {
      const snapshot = await storage.readCompositionRecovery(workspaceId, id);
      if (!alive()) return;
      const backup = life.Workbench.makeBackup(snapshot.bundle, snapshot.workbench);
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' })); urls.add(url);
      const link = node('a'); link.href = url; link.download = 'haedo-composition-recovery-' + snapshot.createdAt.slice(0, 10) + '.json';
      host.append(link); link.click(); link.remove();
      message = '원문과 구성 복구 사본을 내려받았습니다. 자료·구성 백업에서 새 사본으로 복원할 수 있습니다.';
    }
    function draw() {
      if (!alive()) return;
      const focusId = body.contains(document.activeElement) ? document.activeElement.id : '';
      const openKeys = new Set([...body.querySelectorAll('details[open][data-section]')].map(el => el.dataset.section));
      const scrollPositions = new Map([...body.querySelectorAll('details[data-section]')].map(el => [el.dataset.section, el.scrollTop]));
      host.setAttribute('aria-busy', 'false'); status.textContent = labels[state?.status] || '구성 연결 확인 필요'; status.dataset.state = state?.status || 'error';
      errorNode.textContent = error || state?.error?.message || ''; errorNode.hidden = !errorNode.textContent;
      body.replaceChildren();
      if (!state) { body.append(button('다시 확인', 'compositionRetry', refresh)); return; }
      if (!state.enabled) {
        body.append(node('p', '묶음·내 페이지·회고·관련 기록 제외를 같은 계정의 서버에 보관합니다. 글쓰기 초안과 공개 사본은 포함하지 않습니다.', 'life-help'));
        body.append(node('p', '원문 동기화를 먼저 연결하세요. 서버에 구성이 있으면 양쪽 내용을 확인한 뒤 선택합니다.', 'life-help'));
        body.append(button(state.status === 'paused' ? '구성 이어쓰기 재개' : '구성 이어쓰기 시작', 'compositionEnable', async () => { await manager.enable(workspaceId); view = null; }, 'life-primary'));
      } else {
        const actions = node('div', null, 'life-actions');
        actions.append(button('지금 이어쓰기', 'compositionSyncNow', async () => { await manager.syncNow(workspaceId); view = null; }));
        if (state.conflict && !state.conflict.missing) actions.append(button('양쪽 구성 비교', 'compositionCompare', async () => { view = await manager.compare(workspaceId); }, 'life-primary'));
        actions.append(button('구성 연결 중지', 'compositionPause', pause, '', true)); body.append(actions);
        if (state.conflict?.missing) body.append(node('p', '서버 구성을 찾을 수 없습니다. 자동으로 다시 만들지 않았습니다. 이 브라우저의 구성은 자료·구성 백업으로 보관할 수 있습니다.', 'life-help'));
        else if (!state.conflict) body.append(node('p', '원문과 구성을 각각 확인합니다. 공개한 사본은 바뀌지 않습니다.', 'life-help'));
      }
      if (message) body.append(node('p', message, 'life-help'));
      if (view?.remote && state.enabled) {
        const panel = node('section', null, 'composition-comparison'); panel.id = 'compositionComparison'; panel.setAttribute('aria-label', '양쪽 구성 비교');
        panel.append(summary('이 기기', view.local, 'local', openKeys), summary('서버', view.remote.data, 'remote', openKeys));
        panel.append(node('p', '선택하지 않은 구성도 원문과 함께 이 브라우저의 복구 사본에 남깁니다.', 'life-help'));
        const actions = node('div', null, 'life-actions');
        for (const [choice, label, id] of [['local', '이 기기 구성 유지', 'compositionUseLocal'], ['remote', '서버 구성 사용', 'compositionUseRemote']]) {
          actions.append(button(label, id, async () => {
            const result = await manager.resolve(workspaceId, choice, view);
            view = null; message = '선택하지 않은 구성은 복구 사본으로 보관했습니다.';
            if (result.syncError) error = result.syncError.message;
          }));
        }
        panel.append(actions); body.append(panel);
      }
      if (recoveries.length) {
        const details = node('details', null, 'life-details'); details.dataset.section = 'recovery'; details.open = openKeys.has('recovery') || !!message;
        details.append(node('summary', '구성 복구 사본 ' + recoveries.length + '개'));
        recoveries.forEach(item => {
          const row = node('div', null, 'composition-recovery'); row.append(node('p', item.title, 'life-note'), node('p', new Date(item.createdAt).toLocaleString('ko-KR'), 'life-meta'));
          row.append(button('복구 사본 내려받기', 'compositionRecovery-' + item.id, () => downloadRecovery(item.id), 'composition-recovery-download')); details.append(row);
        }); body.append(details);
      }
      body.querySelectorAll('details[data-section]').forEach(el => { el.scrollTop = scrollPositions.get(el.dataset.section) || 0; });
      if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    }
    async function refresh() {
      if (!alive() || busy) return;
      const token = ++sequence;
      try {
        const [next, copies] = await Promise.all([manager.getState(workspaceId), storage.listCompositionRecoveries(workspaceId)]);
        if (!alive() || busy || token !== sequence) return;
        state = next; recoveries = copies; draw();
      } catch (cause) { if (alive() && token === sequence) { state = null; error = cause.message || '구성을 불러오지 못했습니다.'; draw(); } }
    }
    const unsubscribe = manager.subscribe(event => { if (event.workspaceId === workspaceId) refresh(); });
    refresh();
    return { dispose() { disposed = true; sequence++; unsubscribe(); for (const url of urls) URL.revokeObjectURL(url); urls.clear(); } };
  }
  life.CompositionUI = Object.freeze({ create });
})(globalThis);
