/* Explicit publication of one safe nine-board area. Private notes are never copied. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
  async function open({ storage, workspaceId, boardId, areaId, isCurrent = () => true }) {
    const source = await storage.readNineBoard(workspaceId);
    if (!isCurrent()) throw new Error('계정이나 작업공간이 바뀌었습니다. 현재 공간에서 다시 열어 주세요.');
    life.NineBoard.validate(source);
    const board = source.boards.find(value => value.id === boardId);
    if (!board?.areas.some(value => value.id === areaId)) throw new Error('공개할 구성과 영역을 다시 골라 주세요.');
    const remote = life.NinePublicRemote.create({ auth: root.HaedoAuth, storage, workspaceId, isCurrent });
    const previous = document.activeElement, dialog = el('dialog', null, 'bs-share-dialog nine-share-dialog');
    dialog.id = 'nineShare'; dialog.setAttribute('aria-labelledby', 'nineShareTitle');
    const heading = el('h2', '9칸 공개 검토'); heading.id = 'nineShareTitle'; heading.tabIndex = -1;
    const close = el('button', '닫기', 'life-button'); close.type = 'button'; close.id = 'nineShareClose';
    const title = el('input'), intro = el('textarea'); title.type = 'text'; title.value = board.title; title.maxLength = 500;
    title.id = 'nineSharePublicTitle'; title.setAttribute('aria-label', '공개 9칸 제목');
    intro.value = ''; intro.rows = 3; intro.maxLength = 50000; intro.id = 'nineShareIntro'; intro.setAttribute('aria-label', '공개 소개');
    const field = (label, input) => { const wrapper = el('label', null, 'life-field'); wrapper.append(el('span', label), input); return wrapper; };
    const status = el('p', '공개 상태를 확인하는 중입니다.', 'life-meta'); status.id = 'nineShareStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.state = 'loading';
    const error = el('p', '', 'life-error nine-share-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    const publication = el('section', null, 'nine-share-publication'); publication.id = 'nineSharePublication'; publication.setAttribute('aria-label', '9칸 공개 상태');
    const preview = el('section', null, 'nine-share-preview'); preview.id = 'nineSharePreview'; preview.setAttribute('aria-label', '공개 9칸 미리보기');
    const consent = el('input'); consent.type = 'checkbox'; consent.id = 'nineShareConsent'; consent.setAttribute('aria-label', '검토한 9칸을 공개합니다');
    const consentLabel = el('label', null, 'blog-manager-check'); consentLabel.append(consent, document.createTextNode('미리보기의 제목·소개와 선택 영역의 항목·출처를 공개합니다.'));
    const revokeConsent = el('input'); revokeConsent.type = 'checkbox'; revokeConsent.id = 'nineShareRevokeConsent'; revokeConsent.setAttribute('aria-label', '이 공개 9칸을 철회합니다');
    const revokeLabel = el('label', null, 'blog-manager-check'); revokeLabel.append(revokeConsent, document.createTextNode('이 공개 9칸을 철회합니다. 비공개 구성과 다른 공개 글·모음은 유지됩니다.'));
    let active = true, busy = false, metadata = null, review = null, reviewRevision = null, rendered = null, editVersion = 0;
    const composing = new Set();
    const valid = () => active && isCurrent() && dialog.isConnected;
    function clearPreview() {
      review = null; reviewRevision = null; consent.checked = false;
      try { rendered?.dispose?.(); } finally { rendered = null; preview.replaceChildren(); }
    }
    function invalidate() { editVersion++; clearPreview(); }
    function dispose() {
      if (!active) return; active = false; clearPreview(); remote.dispose?.();
      if (dialog.open) dialog.close(); dialog.remove();
      if (isCurrent() && previous?.isConnected) previous.focus({ preventScroll: true });
    }
    function guardInput() { if (composing.size) throw new Error('한글 입력을 마친 뒤 다시 시도해 주세요.'); }
    function showState(value) {
      if (!valid()) return;
      if (!value || !['missing', 'published', 'revoked'].includes(value.status) || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('현재 공개 상태를 확인하지 못했습니다. 다시 조회해 주세요.');
      metadata = value; revokeConsent.checked = false; publication.replaceChildren();
      if (value.status === 'published') {
        if (typeof value.publicId !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value.publicId)) throw new Error('공개한 9칸의 주소를 확인하지 못했습니다.');
        const url = new URL('taste.html', root.location.href); url.searchParams.set('nine', value.publicId);
        const link = el('a', '공개 9칸 열기'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; publication.append(link);
      }
      status.textContent = value.pending ? '결과를 확인하지 못한 요청이 있습니다. 같은 요청을 다시 확인해 주세요.' : value.status === 'published' ? '공개된 9칸을 확인했습니다. 비공개 구성의 수정은 자동 반영되지 않습니다.' : value.status === 'revoked' ? '9칸 공개 철회를 확인했습니다. 비공개 구성은 유지됩니다.' : '이 영역의 공개 9칸이 없습니다.';
      status.dataset.state = value.pending ? 'pending' : value.status;
    }
    async function run(task) {
      if (!valid() || busy) return;
      busy = true; error.hidden = true;
      const controls = [...dialog.querySelectorAll('button,input,textarea,select')].map(node => [node, node.disabled]); controls.forEach(([node]) => { node.disabled = true; });
      dialog.setAttribute('aria-busy', 'true');
      try { await task(); }
      catch (cause) {
        if (valid()) {
          error.textContent = cause.message || '공개 처리 결과를 확인하지 못했습니다. 다시 확인해 주세요.'; error.hidden = false;
          status.textContent = '처리 결과를 확인하지 못했습니다. 입력과 비공개 구성은 유지됩니다.'; status.dataset.state = 'error';
          const link = publication.querySelector('a'); if (link) link.textContent = '마지막 확인한 공개 주소 열기';
        }
      } finally {
        busy = false;
        if (valid()) { dialog.setAttribute('aria-busy', 'false'); controls.forEach(([node, disabled]) => { if (node.isConnected) node.disabled = disabled; }); }
      }
    }
    function button(label, id, task) {
      const node = el('button', label, 'life-button'); node.type = 'button'; node.id = id; node.addEventListener('click', () => run(task)); return node;
    }
    for (const input of [title, intro]) {
      input.addEventListener('input', invalidate);
      input.addEventListener('compositionstart', () => { composing.add(input); invalidate(); });
      input.addEventListener('compositionend', () => { composing.delete(input); invalidate(); });
    }
    async function refresh() { invalidate(); revokeConsent.checked = false; guardInput(); const value = await remote.getState(areaId); if (valid()) showState(value); }
    async function loadInitial() {
      const version = editVersion, initialTitle = title.value, initialIntro = intro.value;
      try {
        const value = await remote.getPublished(areaId);
        if (!valid()) return;
        const data = value.state?.status === 'published' ? life.NinePublic.parse(value.snapshot) : null;
        showState(value.state);
        // Only the opening read may restore already-public fields. Status
        // refreshes and late responses never replace this session's input.
        if (data && version === editVersion && !composing.size && title.value === initialTitle && intro.value === initialIntro) {
          title.value = data.title; intro.value = data.intro || ''; consent.checked = false;
        }
      } catch (cause) {
        if (!valid()) return;
        throw Object.assign(new Error('이전 공개 제목·소개를 읽지 못했습니다. 현재 입력은 유지했습니다. 공개 상태를 다시 확인하거나 닫은 뒤 다시 열어 주세요.'), { code: cause.code, cause });
      }
    }
    async function finish(result, action) {
      if (!valid()) return;
      const value = result?.state || await remote.getState(areaId); if (!valid()) return; showState(value);
      if (result?.status !== 'stored') throw new Error('서버의 9칸이 바뀌었습니다. 공개 상태를 확인하고 새로 미리보기를 검토해 주세요.');
      if ((action === 'publish' && value.status !== 'published') || (action === 'revoke' && value.status !== 'revoked')) throw new Error('이전 요청과 현재 공개 상태가 다릅니다. 현재 상태를 다시 확인해 주세요.');
    }
    const prepare = button('공개 9칸 미리보기', 'nineSharePrepare', async () => {
      invalidate(); guardInput(); const version = editVersion;
      const value = await remote.getState(areaId); if (!valid()) return; showState(value);
      const next = await remote.prepare({ boardId, areaId, title: title.value, intro: intro.value || null });
      if (!valid() || version !== editVersion) return;
      guardInput(); life.NinePublic.parse(next.snapshot);
      const view = life.NinePublicView.render(next.snapshot, { document });
      rendered = view; preview.replaceChildren(view.node); review = next; reviewRevision = value.revision; consent.checked = false;
      status.textContent = '이 미리보기의 한 영역만 공개합니다.'; status.dataset.state = 'reviewed';
    });
    const publish = button('9칸 게시·갱신', 'nineSharePublish', async () => {
      const selectedReview = review, allowed = consent.checked, expectedRevision = reviewRevision;
      const unchanged = selectedReview?.snapshot.title === title.value && selectedReview?.snapshot.intro === (intro.value || null);
      invalidate(); revokeConsent.checked = false; guardInput();
      if (!selectedReview || !allowed || !unchanged) throw new Error('공개 9칸 미리보기를 확인하고 공개 동의를 선택해 주세요.');
      if (metadata?.pending) throw new Error('미확인 요청이 있습니다. 같은 요청을 먼저 다시 확인해 주세요.');
      const result = await remote.publish(selectedReview, { expectedRevision }); if (valid()) await finish(result, 'publish');
    });
    const retry = button('미확인 요청 다시 확인', 'nineShareRetry', async () => {
      invalidate(); revokeConsent.checked = false; guardInput(); const result = await remote.retry(areaId); if (valid()) await finish(result);
    });
    const revoke = button('9칸 공개 철회', 'nineShareRevoke', async () => {
      const allowed = revokeConsent.checked, expectedRevision = metadata?.revision;
      invalidate(); revokeConsent.checked = false; guardInput();
      if (!allowed || !Number.isSafeInteger(expectedRevision)) throw new Error('철회할 공개 9칸을 확인하고 철회 동의를 선택해 주세요.');
      if (metadata?.pending) throw new Error('미확인 요청이 있습니다. 같은 요청을 먼저 다시 확인해 주세요.');
      const result = await remote.revoke(areaId, { expectedRevision }); if (valid()) await finish(result, 'revoke');
    });
    const controls = el('div', null, 'life-actions'); controls.append(button('공개 상태 다시 확인', 'nineShareRefresh', refresh), retry);
    dialog.append(heading, close,
      el('p', '선택한 한 영역의 항목 제목·만든 사람·종류·출처만 공개합니다. 개인 소개·영역 메모·선택 이유·원문 근거·사진·다른 영역은 포함하지 않습니다. 공개 소개는 직접 입력한 내용만 사용합니다.', 'life-help'),
      el('p', '원래 영역을 삭제한 뒤에도 설정 → 공개 페이지 관리에서 공개 사본을 확인하고 철회할 수 있습니다.', 'life-help'),
      field('공개 9칸 제목', title), field('공개 소개', intro), status, error, publication, controls, prepare, preview, consentLabel, publish, revokeLabel, revoke);
    close.addEventListener('click', () => { if (busy) return; try { guardInput(); dispose(); } catch (cause) { error.textContent = cause.message; error.hidden = false; } });
    dialog.addEventListener('cancel', event => { if (busy || composing.size) event.preventDefault(); else dispose(); }); dialog.addEventListener('close', dispose);
    document.body.append(dialog);
    try { dialog.showModal(); heading.focus({ preventScroll: true }); } catch (cause) { dispose(); throw cause; }
    void run(loadInitial); return dispose;
  }
  life.NinePublicSharing = Object.freeze({ open });
})(globalThis);
