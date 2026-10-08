/* Selected-draft controls stay below the editor; remote events never rewrite its inputs. */
(function (root) {
  'use strict'; const life = root.HaedoLife ||= {};
  const labels = { not_enabled: '이 초안은 이 브라우저에만 보관', pending: '초안 전송 대기', synced: '초안이 서버와 이어짐',
    paused: '초안 이어쓰기 중지됨', conflict: '양쪽 글 비교 필요', error: '초안 연결 확인 필요', closed: '기록으로 저장한 초안' };
  const el = (tag, text, cls) => { const value = document.createElement(tag); if (text != null) value.textContent = text; if (cls) value.className = cls; return value; };
  function create({ host, manager, storage, workspaceId: ws, draftId: id, beforeAction, onOpen, isCurrent }) {
    let disposed = false, busy = false, actionId = 0, refreshId = 0, state = null, view = null, error = '', message = '', rows = null, after = null, pendingSaved = [];
    host.id = 'lifeWritingSync'; host.dataset.draftId = id; host.classList.add('life-writing-sync');
    const summary = el('summary', '초안 이어쓰기'); host.append(summary);
    const status = el('p', '초안 연결 확인 중…', 'life-meta'); status.id = 'writingSyncStatus'; status.setAttribute('role', 'status');
    const errorBox = el('p', '', 'life-error'); errorBox.id = 'writingSyncError'; errorBox.hidden = true; errorBox.setAttribute('role', 'alert');
    const content = el('div'); host.append(status, errorBox, content);
    const alive = () => !disposed && host.isConnected && isCurrent();
    const pause = async () => { await manager.pause(ws, id); view = null; };
    function button(text, key, task, interrupt = false, primary = false) {
      const control = el('button', text, 'life-button' + (primary ? ' life-primary' : '')); control.type = 'button'; if (key) control.id = key;
      if (interrupt) control.dataset.interrupt = 'true';
      control.addEventListener('click', async () => {
        if (!alive() || busy && !interrupt) return;
        const token = ++actionId; refreshId++; busy = true; error = ''; errorBox.hidden = true; host.setAttribute('aria-busy', 'true');
        content.querySelectorAll('button').forEach(value => { value.disabled = !value.dataset.interrupt; });
        if (key === 'writingEnable' && !content.querySelector('#writingPause')) content.append(button('연결 시작 취소', 'writingPause', pause, true));
        try {
          if (!interrupt) await beforeAction();
          if (!alive() || token !== actionId) return;
          await task(() => alive() && token === actionId);
        } catch (cause) { if (alive() && token === actionId) { error = cause.message || '초안을 처리하지 못했습니다. 글은 보존됩니다.'; view = null; } }
        finally { if (alive() && token === actionId) { busy = false; await refresh(); (content.querySelector('#' + (key || 'writingSyncNow')) || content.querySelector('button'))?.focus({ preventScroll: true }); } }
      }); return control;
    }
    async function serverList(more = false) {
      const values = await manager.listRemote(ws, more ? after : null);
      if (!alive()) return;
      const combined = more ? (rows || []).concat(values) : values;
      rows = [...new Map(combined.map(row => [row.draft_id, row])).values()];
      after = values.length === 100 ? values.at(-1).draft_id : null;
    }
    function side(label, stage, key, positions) {
      const part = el('section', null, 'writing-sync-side'); part.append(el('h4', label), el('p', stage.title || '제목 없는 초안', 'life-note'));
      part.append(el('p', stage.state === 'applied' ? '다른 입력을 덮지 않고 기록으로 저장된 상태' : stage.sourceId ? '기존 글을 수정 중인 초안' : '새 글 초안', 'life-meta'));
      const detail = el('details', null, 'life-details'); detail.dataset.section = key; detail.open = positions.get(key)?.open || false;
      const toggle = el('summary', '본문 확인'); toggle.id = 'writingBody-' + key; detail.append(toggle, el('pre', stage.text || '본문 없음', 'life-conflict-content'));
      part.append(detail); return part;
    }
    function draw() {
      if (!alive()) return;
      const focus = content.contains(document.activeElement) ? document.activeElement.id : '';
      const positions = new Map([...content.querySelectorAll('details[data-section]')].map(value => [value.dataset.section, { open: value.open, top: value.scrollTop }]));
      status.dataset.state = state?.status || 'error'; status.textContent = labels[state?.status] || '초안 연결 확인 필요';
      errorBox.textContent = error || state?.error?.message || ''; errorBox.hidden = !errorBox.textContent;
      const completionPending = state?.stage?.state === 'applied' && state.binding && !['closed', 'synced'].includes(state.status);
      const summaryState = state?.status === 'conflict' || errorBox.textContent ? '확인 필요' :
        completionPending ? '저장 완료 확인 필요' : pendingSaved.length ? '저장 완료 확인 ' + pendingSaved.length + '개' :
        ({ pending: '전송 대기', synced: '연결됨', paused: '중지됨', closed: '완료' })[state?.status];
      summary.textContent = '초안 이어쓰기' + (summaryState ? ' · ' + summaryState : '');
      host.setAttribute('aria-busy', 'false'); content.replaceChildren();
      if (!state) content.append(button('다시 확인', 'writingSyncRetry', refresh));
      else {
        const actions = el('div', null, 'life-actions');
        if (!state.enabled && (state.stage?.state !== 'applied' || state.binding)) {
          const finishing = state.stage?.state === 'applied';
          content.append(el('p', finishing ? '기록은 저장됐습니다. 재개하면 원문과 초안의 저장 완료 상태를 서버와 확인합니다.' : '선택한 이 글의 제목·본문·수정 기준만 같은 계정에 보관합니다. 다른 초안과 가져오기 검토는 보내지 않습니다. 원문 동기화를 먼저 연결하세요.', 'life-help'));
          actions.append(button(finishing ? '저장 완료 상태 이어쓰기' : state.status === 'paused' ? '이 초안 이어쓰기 재개' : '이 초안 이어쓰기', 'writingEnable', async () => {
            const stage = await storage.getStage(id);
            if (!stage) throw new Error('제목이나 본문을 먼저 써 주세요. 빈 초안은 전송하지 않습니다.');
            await manager.enable(ws, id); view = null;
          }, false, true));
        } else if (state.enabled && state.status !== 'closed') {
          actions.append(button('지금 이어쓰기', 'writingSyncNow', async () => { await manager.syncNow(ws, id); view = null; }));
          if (state.conflict && !state.conflict.missing) actions.append(button('양쪽 글 비교', 'writingCompare', async () => { view = await manager.compare(ws, id); }, false, true));
          actions.append(button('초안 연결 중지', 'writingPause', pause, true));
        }
        content.append(actions);
        if (state.conflict?.missing) content.append(el('p', '서버 초안이 없어 자동으로 다시 만들지 않았습니다. TXT로 현재 글을 보관할 수 있습니다.', 'life-help'));
        if (state.status === 'closed') content.append(el('p', '기록으로 저장한 초안을 다시 미완성 상태로 되돌리지 않습니다. 쓰던 입력은 새 초안 사본으로 보관할 수 있습니다.', 'life-help'));
      }
      if (message) content.append(el('p', message, 'life-help'));
      if (pendingSaved.length) {
        const pending = el('section', null, 'writing-remote-section'); pending.id = 'writingPendingSaved';
        pending.append(el('h4', '저장 완료 전송 확인'));
        pendingSaved.forEach(stage => {
          const open = button(stage.title || '제목 없는 글', 'writingPending-' + stage.stageId, () => onOpen(stage.stageId));
          open.dataset.pendingDraftId = stage.stageId; pending.append(open);
        }); content.append(pending);
      }
      if (view?.remote && state?.enabled) {
        const panel = el('section', null, 'writing-sync-comparison'); panel.id = 'writingComparison'; panel.setAttribute('aria-label', '양쪽 글 비교');
        panel.append(side('이 기기', view.local, 'local', positions), side('서버', view.remote.data, 'remote', positions));
        panel.append(el('p', '선택하지 않은 글도 새 미연결 초안으로 보관합니다. 초안 목록에서 다시 열거나 TXT로 받을 수 있습니다.', 'life-help'));
        const actions = el('div', null, 'life-actions');
        const terminal = view.local.state === 'applied' || view.remote.data.state === 'applied';
        const choices = terminal ? [['fork','입력 사본 보관하고 종료 확인','writingFork']] :
          [['local','이 기기 글 유지','writingUseLocal'],['remote','서버 글 사용','writingUseRemote']];
        choices.forEach(([choice, label, key]) => actions.append(button(label, key, async current => {
          const result = await manager.resolve(ws, id, choice, view); if (!current()) return;
          view = null; message = '다른 쪽 글을 새 초안 사본으로 보관했습니다.';
          if (result.syncError) error = result.syncError.message;
          await onOpen(terminal ? result.recoveryStageId : id);
        })));
        panel.append(actions); content.append(panel);
      }
      const remoteSection = el('section', null, 'writing-remote-section');
      remoteSection.append(button('다른 기기의 초안 찾기', 'writingRemoteListButton', () => serverList()));
      if (rows !== null) {
        const list = el('div'); list.id = 'writingRemoteList';
        if (rows.some(row => row.state === 'draft')) list.append(el('p', '고른 초안을 받으면 이 기기에서도 해당 글의 이어쓰기를 시작합니다.', 'life-help'));
        if (!rows.length) list.append(el('p', '이 작업공간에 이어 쓸 서버 초안이 없습니다.', 'life-help'));
        rows.forEach(row => {
          const item = el('div', null, 'writing-remote-row');
          if (row.state === 'applied') item.append(el('p', (row.title || '제목 없는 초안') + ' · 기록으로 저장됨', 'life-meta'));
          else {
            const open = button(row.title || '제목 없는 초안', 'writingRemote-' + row.draft_id, async current => {
              const result = await manager.download(ws, row.draft_id); if (!current()) return;
              if (result.stage.state === 'applied') throw new Error('이 초안은 이미 기록으로 저장됐습니다. 기록에서 확인해 주세요.');
              await onOpen(result.stage.stageId);
            }); open.dataset.draftId = row.draft_id; item.append(open);
          }
          list.append(item);
        });
        if (after) list.append(button('더 보기', 'writingRemoteMore', () => serverList(true))); remoteSection.append(list);
      }
      remoteSection.append(el('p', '초안 이어쓰기는 기록 저장이나 공개 게시가 아닙니다. 중지는 다음 전송을 멈추며 서버 사본을 삭제하지 않습니다.', 'life-help'));
      content.append(remoteSection);
      content.querySelectorAll('details[data-section]').forEach(value => { value.scrollTop = positions.get(value.dataset.section)?.top || 0; });
      if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
    }
    async function refresh() {
      if (!alive() || busy) return; const token = ++refreshId;
      try {
        const next = await manager.getState(ws, id);
        const metas = await storage.listWritingSyncStates(ws);
        const candidates = await Promise.all(metas.filter(value => value.draftId !== id && value.status !== 'synced').map(value => storage.getStage(value.draftId)));
        if (!alive() || busy || token !== refreshId) return;
        state = next; pendingSaved = candidates.filter(value => value?.state === 'applied'); draw();
      }
      catch (cause) { if (alive() && !busy && token === refreshId) { error = cause.message; state = null; draw(); } }
    }
    const off = manager.subscribe(event => { if (event.workspaceId === ws) refresh(); });
    const offStorage = storage.subscribe(ws, event => { if (event.type === 'writing_sync_changed' || event.type === 'writing_draft_changed') refresh(); });
    refresh(); return { dispose() { disposed = true; refreshId++; actionId++; off(); offStorage(); } };
  }
  life.WritingSyncUI = Object.freeze({ create });
})(globalThis);
