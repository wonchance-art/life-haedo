/* One preparation at a time. Read-only reviews never publish private input. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
  const labels = { not_enabled: '이 준비는 이 브라우저에만 보관', paused: '준비 이어쓰기 중지됨 · 서버 사본 유지', pending: '전송 결과 확인 필요', synced: '내 계정 서버와 연결됨', conflict: '양쪽 준비 비교 필요', error: '연결 확인 필요' };
  const fault = (code, message) => Object.assign(new Error(message), { code });
  function create({ host, manager, workspaceId, getPlanId, beforeAction = async () => {}, onReceived, onDirty = () => {}, isCurrent = () => true }) {
    let disposed = false, busy = false, navigating = false, generation = 0, refreshId = 0, actionSequence = 0, selected = getPlanId(), state = null;
    let review = null, comparison = null, remoteReview = null, receipt = null, rows = null, cursor = null, failure = null;
    const surface = el('details', null, 'mc-panel life-details'); surface.id = 'mcPanel';
    const summary = el('summary', '다른 기기에서 이어쓰기');
    const status = el('p', '준비 연결 확인 중…', 'life-meta mc-status'); status.id = 'mcStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const error = el('p', '', 'life-error mc-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    const detail = el('div', null, 'mc-detail'), reviewHost = el('div', null, 'mc-review'), server = el('section', null, 'mc-server'), receiveHost = el('div', null, 'mc-receive');
    surface.append(summary, status, error, detail, reviewHost, server, receiveHost); host.append(surface);
    const alive = () => !disposed && host.isConnected && isCurrent();
    const active = (token, id) => alive() && token === generation && getPlanId() === id;
    const dirty = () => busy;
    const notify = () => { if (alive()) { surface.setAttribute('aria-busy', String(busy)); onDirty(); } };
    const announce = text => { if (alive()) status.textContent = text; };
    function report(cause) { failure = cause; if (alive()) { error.textContent = cause?.message || '처리하지 못했습니다. 현재 준비와 입력을 유지했습니다. 다시 시도해 주세요.'; error.hidden = false; status.dataset.state = 'error'; } }
    function clear() { failure = null; error.hidden = true; error.textContent = ''; }
    function clearReview() { review = comparison = null; reviewHost.replaceChildren(); }
    function button(label, id, task, primary = false) {
      const node = el('button', label, 'life-button' + (primary ? ' life-primary' : '')); node.type = 'button'; if (id) node.id = id;
      node.addEventListener('click', async () => {
        if (!alive() || busy || navigating || node.disabled) return;
        const token = generation, planId = getPlanId(), action = ++actionSequence; busy = true; clear(); notify();
        const interruptible = ['mcConnect', 'mcSync', 'mcShareOutput', 'mcResolveLocal', 'mcResolveRemote'].includes(id);
        if (interruptible && !surface.querySelector('#mcPause')) detail.append(pauseButton());
        const controls = [...surface.querySelectorAll('button')].map(value => [value, value.disabled]); controls.forEach(([value]) => { value.disabled = !(interruptible && value.id === 'mcPause'); });
        let result;
        try {
          await beforeAction(); if (!active(token, planId)) return;
          result = await task(() => active(token, planId), planId);
        } catch (cause) { if (active(token, planId)) report(cause); }
        finally {
          if (action === actionSequence) {
            busy = false; controls.forEach(([value, disabled]) => { if (value.isConnected) value.disabled = disabled; }); notify();
            if (alive()) await refresh({ keepError: true });
          }
        }
        // Navigation may itself ask the workbench to flush. Release our busy
        // guard only after the durable installation has finished.
        if (result?.open && active(token, planId)) await openReceipt(result.open);
      }); return node;
    }
    function pauseButton() {
      const node = el('button', '준비 연결 중지', 'life-button'); node.type = 'button'; node.id = 'mcPause';
      node.addEventListener('click', async () => {
        if (!alive() || navigating || node.disabled) return;
        const planId = getPlanId(), token = ++generation, action = ++actionSequence; refreshId++; busy = true;
        clear(); clearReview(); node.disabled = true; notify();
        try { await manager.pause(workspaceId, planId); }
        catch (cause) { if (active(token, planId)) report(cause); }
        finally {
          if (action === actionSequence) {
            busy = false; if (alive()) { remoteReview = null; renderRows(); renderReceipt(); await refresh({ keepError: true }); } notify();
          }
        }
      }); return node;
    }
    function consent(label, id) {
      const row = el('label', null, 'blog-manager-check'), input = el('input'); input.type = 'checkbox'; input.id = id; input.setAttribute('aria-label', label);
      row.append(input, document.createTextNode(label)); return row;
    }
    function accept(id, value) {
      const input = surface.querySelector('#' + id), checked = input?.checked === true;
      if (input) input.checked = false;
      if (!checked || !value) throw fault('material_continuity_consent', '전송할 전체 내용을 검토하고 다시 동의해 주세요.');
      return value;
    }
    function paragraph(parent, title, text) { parent.append(el('h5', title), el('pre', text || '내용 없음', 'life-conflict-content mc-text')); }
    function payload(data, label, outputPending = false) {
      const section = el('section', null, 'mc-payload'); section.append(el('h4', label), el('h5', data.plan.title || '제목 없는 작성 준비'));
      paragraph(section, '비공개 질문', data.plan.question);
      const materials = el('section'); materials.append(el('h5', '선택한 자료와 비공개 메모'));
      if (!data.plan.materials.length) materials.append(el('p', '선택한 자료 없음', 'life-meta'));
      for (const item of data.plan.materials) {
        const source = data.bundle.sources.find(value => value.id === item.sourceId);
        paragraph(materials, source?.title || '자료', item.note);
      } section.append(materials);
      const outline = el('ol', null, 'mc-outline'); outline.setAttribute('aria-label', '전송할 글 개요');
      for (const block of data.plan.blocks) { const row = el('li'); row.append(el('p', block.kind === 'heading' ? '소제목' : block.kind === 'quote' ? '채택한 인용' : '문단', 'life-meta'), el('pre', block.kind === 'quote' ? block.reference.quote : block.text, 'life-conflict-content mc-text')); if (block.kind === 'quote') row.append(el('p', [block.reference.title, block.reference.url].filter(Boolean).join(' · '), 'life-meta')); outline.append(row); }
      section.append(el('h5', '글 개요 전체'), outline);
      const originals = el('details', null, 'life-details mc-originals'); originals.append(el('summary', `전송할 정확한 원문 ${data.bundle.sourceVersions.length}개 전체 확인`));
      for (const version of data.bundle.sourceVersions) {
        const source = data.bundle.sources.find(value => value.id === version.sourceId);
        const entry = el('section'); entry.dataset.sourceVersionId = version.id;
        entry.append(el('h5', source?.title || '자료'), el('p', [source?.url, version.importedAt].filter(Boolean).join(' · '), 'life-meta'));
        entry.append(el('p', [source?.sourceKey ? '원래 파일 경로: ' + source.sourceKey : '', '확보 범위: ' + version.coverage.status, version.coverage.omissions.length ? '누락: ' + version.coverage.omissions.join(' · ') : '', '원 작성자: ' + (version.originalAuthor.label || '미확인') + ' (' + version.originalAuthor.relation + ')', version.originalCreatedAt ? '원 작성일: ' + version.originalCreatedAt : ''].filter(Boolean).join('\n'), 'life-meta mc-text'));
        entry.append(el('pre', version.contentText == null ? '본문을 확보하지 않은 자료입니다. 출처와 정확한 버전 정보만 전송합니다.' : version.contentText, 'life-conflict-content mc-text')); originals.append(entry);
      } section.append(originals);
      if (data.output?.state === 'writing') section.append(el('p', '글 작성이 시작된 준비입니다. 미완성 글과 사진은 전송하지 않습니다. 작성한 기기에서 같은 글을 완성해 주세요.', 'life-help'));
      if (data.output?.state === 'saved') section.append(el('p', outputPending ? '완성 글의 정확한 인용 근거에 필요한 추가 원문도 아래 전체 확인에 포함됩니다. 아직 전송하지 않았으며, 원본 글 보관에 성공한 정확한 판을 연결합니다.' : `저장한 글 ${data.output.revision}판과 그 글의 원본 사진·정확한 인용 근거를 함께 받습니다. 현재 글을 최신 판으로 바꾸어 받지 않습니다.`, 'life-help'));
      return section;
    }
    function postContent(post, label) {
      const section = el('section', null, 'mc-post-content');
      section.append(el('h4', label), el('h5', post.title || '제목 없는 글'), el('p', post.status === 'saved' ? '저장한 글' : '이 기기에서 작성 중인 글', 'life-meta'));
      paragraph(section, '글의 전체 본문', life.PhotoPost.plainText(post));
      const embeds = new Map(post.ops.filter(op => typeof op.insert === 'object').map(op => [op.insert.photo.id, op.insert.photo]));
      for (const photo of post.photos) {
        const embed = embeds.get(photo.id);
        paragraph(section, '원본 사진 · ' + photo.name, `파일: ${photo.name}\n형식: ${photo.type} · ${photo.width} × ${photo.height} · ${photo.size}바이트\n설명: ${embed?.caption || '없음'}\n대체 텍스트: ${embed?.alt || '없음'}`);
      }
      for (const id of embeds.keys()) if (!post.photos.some(photo => photo.id === id)) throw fault('material_continuity_photo_missing', '원본 사진을 확인하지 못했습니다. 전송하지 않았습니다.');
      const links = [...new Set(post.ops.map(op => op.attributes?.link).filter(Boolean))];
      if (links.length) paragraph(section, '본문의 링크', links.join('\n'));
      if (post.attachments?.length) paragraph(section, '글의 첨부', post.attachments.map(item => [item.title, item.creator, item.url].filter(Boolean).join(' · ')).join('\n'));
      return section;
    }
    function transmissionNotice() { return el('p', '이 준비 하나의 제목·비공개 질문·자료 메모·개요·채택한 인용과 선택한 정확한 원문의 전체 본문·출처·원래 파일 경로·작성자·확보 범위를 내 계정 서버에 비공개로 전송합니다. 다른 준비·무관한 자료는 보내지 않으며 공개 게시가 아닙니다. 미완성 글 본문과 사진은 기기 간에 옮기지 않습니다.', 'life-help'); }
    async function prepare(kind, current, planId) {
      clearReview(); const candidate = await manager.preview(workspaceId, planId); if (!current()) return;
      if (kind === 'output' && candidate.editingDrafts?.length) throw fault('material_continuity_output_editing', '작성기에서 수정 중인 글을 저장한 뒤 원본 전송을 검토해 주세요. 현재 글과 입력은 유지했습니다.');
      review = { ...candidate, kind, planId }; const area = el('section', null, 'mc-review-content'); area.id = 'mcReviewContent';
      area.append(payload(kind === 'output' ? candidate.outputData || candidate.data : candidate.data, kind === 'output' ? '준비와 완성 글 전송 범위' : '서버에 보관할 준비', kind === 'output'), transmissionNotice());
      if (kind === 'output') {
        const post = candidate.post;
        if (!post || post.status !== 'saved') { review = null; throw fault('material_continuity_output_unsaved', '기존 작성기에서 글을 저장한 뒤 완성 글의 원본 전송을 검토해 주세요.'); }
        area.append(postContent(post, '완성 글 전체'), el('p', `모든 원본 사진 ${post.photos.length}장과 사진 설명·대체 텍스트·파일 안의 EXIF/GPS 등 메타데이터를 함께 비공개 보관합니다. 공개할 사진 선택과는 별도입니다.`, 'life-help'));
        area.append(consent('완성 글 전체와 모든 사진 원본의 비공개 전송에 동의합니다', 'mcOutputConsent'), button('완성 글 원본 보관·이어쓰기 연결', 'mcShareOutput', async (latest, id) => {
          const accepted = accept('mcOutputConsent', review); clearReview();
          if (accepted.kind !== 'output' || accepted.planId !== id) throw fault('material_continuity_changed', '준비가 바뀌었습니다. 원본 전송 범위를 다시 검토해 주세요.');
          await manager.shareOutput(workspaceId, id, accepted.fingerprint); if (latest()) announce('완성 글의 원본 보관과 연결 상태를 확인했습니다.');
        }, true));
      } else area.append(consent('이 준비와 선택한 원문 전체의 비공개 전송에 동의합니다', 'mcConsent'), button('검토한 준비 서버에 보관', 'mcConnect', async (latest, id) => {
        const accepted = accept('mcConsent', review); clearReview();
        if (accepted.kind !== 'prepare' || accepted.planId !== id) throw fault('material_continuity_changed', '선택한 준비가 바뀌었습니다. 전송 범위를 다시 검토해 주세요.');
        await manager.connect(workspaceId, id, accepted.fingerprint); if (latest()) announce('서버 보관 결과를 확인했습니다.');
      }, true));
      reviewHost.append(area); surface.open = true;
    }
    async function openReceipt(value) {
      if (!alive()) return;
      receipt = value; navigating = true;
      try {
        if (typeof onReceived !== 'function') throw new Error('준비는 이미 받았습니다. 화면을 열지 못했으니 받은 준비 다시 열기를 눌러 주세요.');
        await onReceived(value); if (alive()) { receipt = null; receiveHost.replaceChildren(); announce('받은 준비를 열었습니다.'); }
      } catch (cause) { if (alive()) { report(Object.assign(new Error('준비는 이미 보관했습니다. 받은 준비 다시 열기로 같은 사본을 열어 주세요.'), { cause })); renderReceipt(); } }
      finally { navigating = false; }
    }
    function renderReceipt() {
      receiveHost.replaceChildren(); if (!receipt) return;
      receiveHost.append(el('p', '준비의 새 사본은 이미 보관했습니다. 다시 받거나 중복 설치하지 않고 같은 준비를 엽니다.', 'life-help'), button('받은 준비 다시 열기', 'mcReceiveOpen', async () => ({ open: receipt })));
    }
    function renderState() {
      if (!alive()) return;
      status.dataset.state = selected ? state?.status || 'error' : 'empty';
      status.textContent = !selected ? '작성 준비를 고르거나 서버의 준비를 찾아 받으세요.' : labels[state?.status] || '준비 연결 확인 필요';
      if (state?.changed) status.textContent += ' · 이 기기의 변경 있음';
      summary.textContent = '다른 기기에서 이어쓰기' + (state?.status === 'conflict' ? ' · 비교 필요' : state?.status === 'pending' ? ' · 결과 확인 필요' : '');
      detail.replaceChildren(); if (!selected) return;
      const actions = el('div', null, 'life-actions mc-actions');
      actions.append(button(state?.enabled ? '전송할 준비 다시 검토' : '전송할 준비 검토', 'mcReview', (current, id) => prepare('prepare', current, id), true));
      if (state?.enabled || state?.status === 'paused' || state?.pending) {
        actions.append(button('서버 변경 확인·재시도', 'mcSync', async (current, id) => { clearReview(); const result = await manager.sync(workspaceId, id); if (current() && result?.received) return { open: result.received }; }));
        actions.append(pauseButton());
      }
      if (state?.status === 'conflict') actions.append(button('양쪽 준비 비교', 'mcCompare', compare));
      actions.append(button('연결 상태 다시 확인', 'mcRefresh', async () => {}));
      detail.append(actions);
      if (state?.output?.state === 'writing') detail.append(el('p', state.ownClaim ? '이 기기에서 시작한 글입니다. 위의 이어서 쓰기로 같은 글을 완성해 주세요. 미완성 글과 사진은 자동 전송하지 않습니다.' : '다른 기기에서 글을 작성하고 있습니다. 이 기기에서는 새 글 초안을 만들지 않습니다. 작성한 기기에서 같은 글을 저장하고 원본 전송을 연결한 뒤 받아 주세요.', 'life-help'));
      if (state?.outputNeedsReview) detail.append(el('p', '글이나 사진의 보관 버전이 달라졌습니다. 완성 글 원본 전송 검토에서 연결을 다시 보관해 주세요.', 'life-help'));
      if (state?.enabled) detail.append(button('완성 글 원본 전송 검토', 'mcOutputReview', (current, id) => prepare('output', current, id)));
      if (state?.error && !failure) report(new Error('이전 전송 결과를 확인하지 못했습니다. 서버 변경 확인·재시도로 같은 요청의 결과를 확인하거나 양쪽 준비를 비교해 주세요.'));
    }
    async function compare(current, planId) {
      clearReview(); const candidate = await manager.compare(workspaceId, planId); if (!current()) return;
      comparison = candidate; const section = el('section', null, 'mc-conflict'); section.id = 'mcConflictContent'; section.setAttribute('aria-label', '양쪽 준비 전체 비교');
      section.append(payload(candidate.local.data, '이 기기의 준비'));
      if (candidate.local.post) { const local = postContent(candidate.local.post, '이 기기의 글 전체'); local.dataset.side = 'local'; section.append(local); }
      for (const editing of candidate.local.editingDrafts || []) { const draft = postContent(editing.post, '이 기기에서 수정 중인 글 · 자동 전송 제외'); draft.dataset.side = 'editing'; draft.dataset.editingPostId = editing.post.id; section.append(draft); }
      section.append(payload(candidate.remote.data, '서버의 준비'));
      if (candidate.remotePost) { const remote = postContent(candidate.remotePost, '서버의 글 전체'); remote.dataset.side = 'remote'; section.append(remote); }
      section.append(el('p', '선택하지 않은 쪽도 완전한 새 미연결 사본으로 보관합니다. 질문·메모·개요와 정확한 원문 버전을 잃지 않습니다. 이 기기에서 작성 중인 글과 사진도 지우지 않습니다. 검토 후 어느 쪽을 이 연결에서 이어 쓸지 고르세요.', 'life-help'), consent('양쪽 준비를 확인했고 선택하지 않은 쪽의 새 사본 보관을 확인합니다', 'mcConflictConsent'));
      const actions = el('div', null, 'life-actions');
      for (const [choice, label, id] of [['local', '이 기기 준비로 이어쓰기', 'mcResolveLocal'], ['remote', '서버 준비로 이어쓰기', 'mcResolveRemote']]) actions.append(button(label, id, async (latest, selectedId) => {
        const accepted = accept('mcConflictConsent', comparison); clearReview();
        const result = await manager.resolve(workspaceId, selectedId, choice, accepted.expected); if (latest()) return { open: result };
      })); section.append(actions); reviewHost.append(section);
    }
    function renderRows() {
      server.replaceChildren(); server.append(button('서버의 작성 준비 찾기', 'mcList', (current) => list(current, false)));
      if (rows === null) return;
      const listNode = el('ul', null, 'mc-server-list'); listNode.id = 'mcServerList';
      if (!rows.length) listNode.append(el('li', '서버에 보관한 작성 준비가 없습니다.', 'life-help'));
      for (const row of rows) {
        const item = el('li'); item.dataset.remoteId = row.id;
        item.append(el('h4', row.title || '제목 없는 작성 준비'), el('p', `${row.updated_at || ''} · 서버 ${row.revision}판`, 'life-meta'));
        const inspect = button('내용 확인', null, async current => {
          remoteReview = null; receiveHost.replaceChildren(); const result = await manager.inspect(row.id); if (!current()) return;
          remoteReview = result; renderRemote();
        }); inspect.setAttribute('aria-label', `${row.title || '제목 없는 작성 준비'} 내용 확인`); item.append(inspect); listNode.append(item);
      } server.append(listNode);
      if (cursor) server.append(button('서버 준비 더 보기', 'mcMore', current => list(current, true)));
    }
    async function list(current, more) {
      const result = await manager.list(more ? cursor : undefined); if (!current()) return;
      rows = [...new Map([...(more ? rows || [] : []), ...result.items].map(row => [row.id, row])).values()]; cursor = result.next; renderRows();
    }
    function renderRemote() {
      receiveHost.replaceChildren(); const candidate = remoteReview; if (!candidate) return;
      const section = el('section', null, 'mc-remote-content'); section.id = 'mcRemoteContent'; section.dataset.remoteId = candidate.id;
      section.append(payload(candidate.data, '받을 준비 전체'), el('p', '처음 받는 준비는 현재 로그인한 계정의 새 작업공간에 보관합니다. 이미 이 브라우저에서 받은 연결이면 같은 준비를 확인하고, 이 기기의 변경과 겹치면 양쪽 비교로 보호합니다. 기존 자료를 자동으로 합치거나 덮지 않습니다.', 'life-help'));
      section.append(button('이 준비 받기', 'mcReceive', async current => {
        remoteReview = null; receiveHost.replaceChildren();
        const result = await manager.receive(candidate.id, candidate.revision); if (current()) { receipt = result; return { open: result }; }
      }, true)); receiveHost.append(section);
    }
    async function refresh({ keepError = false } = {}) {
      if (!alive() || busy) return;
      const id = getPlanId(), token = ++refreshId;
      if (id !== selected) { selected = id; generation++; clearReview(); remoteReview = null; if (!receipt) receiveHost.replaceChildren(); clear(); }
      try {
        const next = id ? await manager.getState(workspaceId, id) : null;
        if (!alive() || busy || token !== refreshId || getPlanId() !== id) return;
        state = next; if (!keepError) clear(); renderState(); if (failure) report(failure);
      } catch (cause) { if (alive() && !busy && token === refreshId && getPlanId() === id) { state = null; renderState(); report(cause); } }
    }
    async function flush() { if (busy) throw fault('material_continuity_busy', '기기 간 이어쓰기 처리 결과를 확인한 뒤 이동해 주세요. 준비와 입력은 유지했습니다.'); }
    renderRows(); refresh();
    const off = typeof manager.subscribe === 'function' ? manager.subscribe(event => { if (!event?.workspaceId || event.workspaceId === workspaceId) refresh({ keepError: true }); }) : null;
    return { refresh, flush, dirty, dispose() { disposed = true; generation++; refreshId++; off?.(); surface.remove(); review = comparison = remoteReview = receipt = null; } };
  }
  life.MaterialContinuityUI = Object.freeze({ create });
})(globalThis);
