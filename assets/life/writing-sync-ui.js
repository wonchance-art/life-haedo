/* Compact automatic-sync status below the editor; remote events never rewrite its inputs. */
(function (root) {
  'use strict'; const life = root.HaedoLife ||= {};
  const labels = { not_enabled: '동기화 준비 중', pending: '다른 기기로 보내는 중', synced: '모든 기기에 동기화됨',
    paused: '동기화 준비 중', conflict: '다른 기기 변경 확인 중', error: '동기화 확인 필요', closed: '기록으로 저장한 초안' };
  const NOTICE = '다른 기기 변경을 반영했고 이전 내용은 복구 목록에 있습니다.';
  const el = (tag, text, cls) => { const value = document.createElement(tag); if (text != null) value.textContent = text; if (cls) value.className = cls; return value; };
  function create({ host, manager, storage, workspaceId: ws, draftId: id, beforeAction, onOpen, isCurrent }) {
    let disposed = false, busy = false, actionId = 0, refreshId = 0, state = null, error = '';
    host.id = 'lifeWritingSync'; host.dataset.draftId = id; host.classList.add('life-writing-sync');
    const summary = el('summary', '초안 동기화'); host.append(summary);
    const status = el('p', '초안 동기화 확인 중…', 'life-meta'); status.id = 'writingSyncStatus'; status.setAttribute('role', 'status');
    const errorBox = el('p', '', 'life-error'); errorBox.id = 'writingSyncError'; errorBox.hidden = true; errorBox.setAttribute('role', 'alert');
    const content = el('div'); host.append(status, errorBox, content);
    const alive = () => !disposed && host.isConnected && isCurrent();
    function button(text, key, task) {
      const control = el('button', text, 'life-button'); control.type = 'button'; if (key) control.id = key;
      control.addEventListener('click', async () => {
        if (!alive() || busy) return;
        const token = ++actionId; refreshId++; busy = true; error = ''; errorBox.hidden = true; host.setAttribute('aria-busy', 'true');
        content.querySelectorAll('button').forEach(value => { value.disabled = true; });
        try { await beforeAction(); if (!alive() || token !== actionId) return; await task(); }
        catch (cause) { if (alive() && token === actionId) error = cause.message || '초안을 처리하지 못했습니다. 글은 보존됩니다.'; }
        finally { if (alive() && token === actionId) { busy = false; await refresh(); (content.querySelector('#' + key) || content.querySelector('button'))?.focus({ preventScroll: true }); } }
      }); return control;
    }
    function draw() {
      if (!alive()) return;
      const focus = content.contains(document.activeElement) ? document.activeElement.id : '';
      status.dataset.state = state?.status || 'error'; status.textContent = labels[state?.status] || '동기화 확인 필요';
      errorBox.textContent = error || state?.error?.message || ''; errorBox.hidden = !errorBox.textContent;
      const short = errorBox.textContent ? '확인 필요' : state?.notice ? '변경 반영됨' :
        ({ pending: '보내는 중', synced: '동기화됨', closed: '완료' })[state?.status];
      summary.textContent = '초안 동기화' + (short ? ' · ' + short : '');
      host.setAttribute('aria-busy', 'false'); content.replaceChildren();
      if (!state) content.append(button('다시 확인', 'writingSyncRetry', async () => {}));
      else {
        if (state.notice) {
          const notice = el('p', NOTICE, 'life-help'); notice.id = 'writingSyncNotice'; content.append(notice);
          const actions = el('div', null, 'life-actions');
          if (state.notice.recoveryStageId && state.notice.recoveryStageId !== id) actions.append(button('이전 내용 열기', 'writingSyncRecovery', async () => {
            const target = state.notice.recoveryStageId; manager.dismissNotice?.(ws, id); await onOpen(target);
          }));
          actions.append(button('확인', 'writingSyncNoticeDone', async () => { manager.dismissNotice?.(ws, id); }));
          content.append(actions);
        }
        if (errorBox.textContent && state.status !== 'closed') content.append(button('다시 시도', 'writingSyncNow', async () => {
          if (state.enabled) await manager.syncNow(ws, id); else await manager.enable(ws, id);
        }));
        if (state.conflict?.missing) content.append(el('p', '서버 초안을 찾지 못해 자동으로 다시 만들지 않았습니다. 이 기기의 글은 그대로 있고 TXT로 보관할 수 있습니다.', 'life-help'));
      }
      if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
    }
    async function refresh() {
      if (!alive() || busy) return; const token = ++refreshId;
      try {
        const next = await manager.getState(ws, id);
        if (!alive() || busy || token !== refreshId) return;
        state = next; draw();
      }
      catch (cause) { if (alive() && !busy && token === refreshId) { error = cause.message; state = null; draw(); } }
    }
    const off = manager.subscribe(event => { if (event.workspaceId === ws) refresh(); });
    const offStorage = storage.subscribe(ws, event => { if (event.type === 'writing_sync_changed' || event.type === 'writing_draft_changed') refresh(); });
    refresh(); return { dispose() { disposed = true; refreshId++; actionId++; off(); offStorage(); } };
  }
  life.WritingSyncUI = Object.freeze({ create });
})(globalThis);
