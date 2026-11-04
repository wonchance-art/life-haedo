/* Compact automatic-sync status for the selected preparation. Sync itself runs in the background. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
  const labels = { not_enabled: '동기화 준비 중', paused: '동기화 준비 중', pending: '다른 기기로 보내는 중', synced: '모든 기기에 동기화됨', conflict: '다른 기기 변경 확인 중', error: '동기화 확인 필요' };
  const NOTICE = '다른 기기 변경을 반영했고 이전 내용은 복구 목록에 있습니다.';
  function create({ host, manager, workspaceId, getPlanId, beforeAction = async () => {}, onReceived, onDirty = () => {}, isCurrent = () => true, isBusy = () => false, onChanged = null }) {
    let disposed = false, busy = false, refreshId = 0, actionSequence = 0, selected = getPlanId(), state = null, failure = null;
    const surface = el('details', null, 'mc-panel life-details'); surface.id = 'mcPanel';
    const summary = el('summary', '준비 동기화');
    const status = el('p', '준비 동기화 확인 중…', 'life-meta mc-status'); status.id = 'mcStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const error = el('p', '', 'life-error mc-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    const detail = el('div', null, 'mc-detail');
    surface.append(summary, status, error, detail); host.append(surface);
    const alive = () => !disposed && host.isConnected && isCurrent();
    const dirty = () => busy;
    const notify = () => { if (alive()) { surface.setAttribute('aria-busy', String(busy)); onDirty(); } };
    function report(cause) { failure = cause; if (alive()) { error.textContent = cause?.message || '동기화하지 못했습니다. 현재 준비와 입력은 유지했습니다.'; error.hidden = false; status.dataset.state = 'error'; } }
    function clear() { failure = null; error.hidden = true; error.textContent = ''; }
    function button(label, id, task) {
      const node = el('button', label, 'life-button'); node.type = 'button'; if (id) node.id = id;
      node.addEventListener('click', async () => {
        if (!alive() || busy || node.disabled) return;
        const planId = getPlanId(), action = ++actionSequence; busy = true; clear(); notify();
        detail.querySelectorAll('button').forEach(value => { value.disabled = true; });
        let result;
        try { await beforeAction(); if (!alive() || getPlanId() !== planId) return; result = await task(planId); }
        catch (cause) { if (alive() && getPlanId() === planId) report(cause); }
        finally { if (action === actionSequence) { busy = false; notify(); if (alive()) await refresh({ keepError: true }); } }
        if (result?.received && alive() && getPlanId() === planId && typeof onReceived === 'function') {
          try { await onReceived(result.received); } catch (cause) { if (alive()) report(cause); }
        }
      }); return node;
    }
    function renderState() {
      if (!alive()) return;
      status.dataset.state = selected ? state?.status || 'error' : 'empty';
      status.textContent = !selected ? '작성 준비를 고르면 동기화 상태를 표시합니다.' : labels[state?.status] || '동기화 확인 필요';
      summary.textContent = '준비 동기화' + (state?.notice ? ' · 변경 반영됨' : state?.status === 'error' || failure ? ' · 확인 필요' : state?.status === 'synced' ? ' · 동기화됨' : '');
      detail.replaceChildren(); if (!selected || !state) return;
      if (state.notice) {
        detail.append(el('p', NOTICE, 'life-help mc-notice'));
        detail.append(button('확인', 'mcNoticeDone', async planId => { await manager.dismissNotice?.(workspaceId, planId); }));
      }
      if (state.output?.state === 'writing' && !state.ownClaim) detail.append(el('p', '다른 기기에서 이 준비의 글을 쓰고 있습니다. 그 기기에서 글을 저장하면 여기에도 반영됩니다.', 'life-help'));
      if (state.status === 'error' || failure) {
        detail.append(button('다시 시도', 'mcSync', planId => manager.autoSync(workspaceId, planId)));
        if (!failure) report(new Error('최근 동기화 결과를 확인하지 못했습니다. 준비는 이 기기에 그대로 있고 자동으로 다시 시도합니다.'));
      }
    }
    async function refresh({ keepError = false } = {}) {
      if (!alive() || busy) return;
      const id = getPlanId(), token = ++refreshId;
      if (id !== selected) { selected = id; clear(); }
      try {
        const next = id ? await manager.getState(workspaceId, id) : null;
        if (!alive() || busy || token !== refreshId || getPlanId() !== id) return;
        state = next; if (!keepError) clear(); renderState(); if (failure) report(failure);
      } catch (cause) {
        if (!alive() || busy || token !== refreshId || getPlanId() !== id) return;
        // A just-created preparation is shown before its first save. That is not a sync
        // failure: show the waiting state, and the save's own change event refreshes again.
        if (cause?.code === 'material_writing_missing') { state = { status: 'not_enabled' }; if (!keepError) clear(); renderState(); if (failure) report(failure); return; }
        state = null; renderState(); report(cause);
      }
    }
    async function flush() { if (busy) throw Object.assign(new Error('동기화 처리 결과를 확인한 뒤 이동해 주세요. 준비와 입력은 유지했습니다.'), { code: 'material_continuity_busy' }); }
    refresh();
    const off = typeof manager.subscribe === 'function' ? manager.subscribe(event => { if (!event?.workspaceId || event.workspaceId === workspaceId) refresh({ keepError: true }); }) : null;
    // Background passes skip this workspace while the editor holds unsaved input,
    // and ask a clean editor to reload after a change arrived.
    const unwatch = life.MaterialContinuitySync?.watch?.(workspaceId, { busy: () => !disposed && (busy || !!isBusy()),
      reload: async result => { if (!alive()) return; if (onChanged) await onChanged(result); await refresh({ keepError: true }); } }) || null;
    return { refresh, flush, dirty, dispose() { disposed = true; refreshId++; off?.(); unwatch?.(); surface.remove(); } };
  }
  life.MaterialContinuityUI = Object.freeze({ create });
})(globalThis);
