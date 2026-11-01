/* A focused management surface. No extra frame in the reading or editing feed. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const labels = { not_enabled: '동기화 준비 중', pending: '다른 기기로 보내는 중', synced: '모든 기기에 동기화됨', conflict: '다른 기기 변경 확인 중', error: '동기화 확인 필요', paused: '동기화 준비 중' };
  const NOTICE = '다른 기기 변경을 반영했고 이전 내용은 복구 목록에 있습니다.';
  function node(tag, text, cls) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; }
    function create({ host, manager, storage, workspaceId, beforeAction = async () => {}, isCurrent = () => true, managed = false, onRetry = null }) {
    let disposed = false, sequence = 0, actionSequence = 0, busy = false, error = '', message = '', state = null, recoveries = [], autoEnabled = false;
    const urls = new Set();
    host.id = 'lifeCompositionSync'; host.classList.add('life-composition-sync');
    const alive = () => !disposed && isCurrent() && host.isConnected;
    const title = node('h3', managed ? '묶음·페이지·책' : '묶음·내 페이지 동기화');
    const status = node('p', '구성 동기화를 확인하는 중…', 'life-help'); status.id = 'compositionStatus'; status.setAttribute('role', 'status');
    const errorNode = node('p', '', 'life-error'); errorNode.id = 'compositionError'; errorNode.setAttribute('role', 'alert'); errorNode.hidden = true;
    const body = node('div', null, 'composition-content');
    host.append(title, status, errorNode, body);
    function button(label, id, action, cls = '') {
      const el = node('button', label, 'life-button ' + cls); el.type = 'button'; if (id) el.id = id;
      el.addEventListener('click', async () => {
        if (!alive() || busy) return;
        const actionToken = ++actionSequence; sequence++;
        busy = true; error = ''; errorNode.hidden = true; host.setAttribute('aria-busy', 'true');
        body.querySelectorAll('button').forEach(value => { value.disabled = true; });
        try { await beforeAction(); if (!alive() || actionToken !== actionSequence) return; await action(); }
        catch (cause) { if (alive() && actionToken === actionSequence) error = cause.message || '구성을 처리하지 못했습니다. 현재 내용은 보존됩니다.'; }
        finally {
          if (actionToken === actionSequence) {
            busy = false;
            if (alive()) { await refresh(); (body.querySelector('#' + (id || 'compositionSyncNow')) || body.querySelector('button'))?.focus({ preventScroll: true }); }
          }
        }
      }); return el;
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
      host.setAttribute('aria-busy', 'false');
      const failed = !!(error || state?.error || state?.conflict);
      host.hidden = managed && !failed && !recoveries.length && !message && !state?.noticeAt;
      status.textContent = managed ? failed ? '구성 동기화 확인 필요' : '구성 복구' : labels[state?.status] || '동기화 확인 필요'; status.dataset.state = state?.status || 'error';
      errorNode.textContent = error || state?.error?.message || ''; errorNode.hidden = !errorNode.textContent;
      body.replaceChildren();
      if (!state) { body.append(button('다시 확인', 'compositionRetry', refresh)); return; }
      if (failed) body.append(button('다시 시도', 'compositionSyncNow', async () => {
        if (state.enabled && state.conflict && !state.conflict.missing) await manager.syncNow(workspaceId);
        else if (managed && onRetry) await onRetry(); else if (state.enabled) await manager.syncNow(workspaceId); else await manager.enable(workspaceId);
      }));
      if (state.conflict?.missing) body.append(node('p', '서버 구성을 찾을 수 없어 자동으로 다시 만들지 않았습니다. 현재 구성은 자료·구성 백업이나 복구 파일로 보관할 수 있습니다.', 'life-help'));
      if (state.noticeAt) {
        const notice = node('p', NOTICE, 'life-help'); notice.id = 'compositionNotice'; body.append(notice);
        body.append(button('확인', 'compositionNoticeDone', () => manager.dismissNotice(workspaceId)));
      }
      if (message) body.append(node('p', message, 'life-help'));
      if (recoveries.length) {
        const details = node('details', null, 'life-details'); details.dataset.section = 'recovery'; details.open = openKeys.has('recovery') || !!message || !!state.noticeAt;
        details.append(node('summary', '구성 복구 사본 ' + recoveries.length + '개'));
        recoveries.forEach(item => {
          const row = node('div', null, 'composition-recovery'); row.append(node('p', item.title, 'life-note'), node('p', new Date(item.createdAt).toLocaleString('ko-KR'), 'life-meta'));
          row.append(button('복구 사본 내려받기', 'compositionRecovery-' + item.id, () => downloadRecovery(item.id), 'composition-recovery-download')); details.append(row);
        }); body.append(details);
      }
      if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    }
    async function refresh() {
      if (!alive() || busy) return;
      const token = ++sequence;
      try {
        const [next, copies] = await Promise.all([manager.getState(workspaceId), storage.listCompositionRecoveries(workspaceId)]);
        if (!alive() || busy || token !== sequence) return;
        state = next; recoveries = copies; draw();
        // Without the account library nothing else starts this workspace's sync; do it once, quietly.
        if (!managed && !state.enabled && !autoEnabled) { autoEnabled = true; manager.enable(workspaceId).catch(cause => { if (alive()) { error = cause.message || ''; refresh(); } }); }
        // A conflict recorded before automatic resolution existed is settled on the next run.
        else if (state.enabled && state.conflict && !state.conflict.missing && !autoEnabled) { autoEnabled = true; manager.syncNow(workspaceId).catch(cause => { if (alive()) { error = cause.message || ''; refresh(); } }); }
      } catch (cause) { if (alive() && token === sequence) { state = null; error = cause.message || '구성을 불러오지 못했습니다.'; draw(); } }
    }
    const unsubscribe = manager.subscribe(event => {
      if (event.workspaceId !== workspaceId) return;
      refresh();
    });
    refresh();
    return { dispose() { disposed = true; sequence++; unsubscribe(); for (const url of urls) URL.revokeObjectURL(url); urls.clear(); } };
  }
  life.CompositionUI = Object.freeze({ create });
})(globalThis);
