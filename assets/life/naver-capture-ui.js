/* Private captured-source reader. Images use verified local Blobs; remote URLs are never loaded. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.HaedoLife ||= {}).NaverCaptureUI = api;
})(globalThis, function (root) {
  'use strict';
  function photos({ payload, photos: originals = [], document: doc = root.document, onWritePhotos, onDownload }) {
    root.HaedoLife.NaverCapture.validatePayload(payload, { local: payload.photos.some(photo => photo.status === 'stored' && photo.storagePath === null) });
    const node = doc.createElement('section'); node.className = 'nv-capture-photos'; node.setAttribute('aria-label', '수집한 사진');
    const urls = [], selections = [], images = [];
    let disposed = false;
    const el = (tag, text, cls) => { const n = doc.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
    node.append(el('p', '본문 안의 정확한 사진 위치는 확인하지 않았습니다. 사진은 확인된 순서대로 따로 표시합니다. 전달받은 파일이 최초 업로드 원본과 같은지는 미확인입니다.', 'life-help'));
    for (const photo of payload.photos) {
      const figure = el('figure', null, 'nv-capture-photo'); figure.dataset.photoIndex = String(photo.index); figure.dataset.state = photo.status;
      const original = originals.find(value => value.index === photo.index);
      if (photo.status === 'stored' && original?.blob instanceof root.Blob) {
        const image = el('img'); image.alt = photo.alt || ''; image.width = photo.width; image.height = photo.height;
        const url = root.URL.createObjectURL(original.blob); urls.push(url); image.src = url; images.push(image);
        figure.append(image);
        const label = el('label', null, 'nv-photo-choice');
        const check = el('input'); check.type = 'checkbox'; check.dataset.photoIndex = String(photo.index); check.setAttribute('aria-label', '사진 ' + (photo.index + 1) + ' 글에 사용');
        selections.push(check); label.append(check, el('span', '사진 ' + (photo.index + 1) + ' 글에 사용')); figure.append(label);
        figure.append(el('p', photo.width + ' × ' + photo.height + ' px · ' + photo.bytes.toLocaleString('ko-KR') + ' bytes', 'life-meta'));
      } else {
        figure.append(el('p', '사진 ' + (photo.index + 1) + ' 파일을 보관하지 못했습니다. 본문과 다른 사진은 그대로 확인할 수 있습니다.', 'nv-warning'));
      }
      if (photo.caption) figure.append(el('figcaption', photo.caption));
      if (photo.alt) figure.append(el('p', '대체 텍스트: ' + photo.alt, 'life-meta'));
      node.append(figure);
    }
    if (!payload.photos.length) node.append(el('p', '이 사본에 사진 정보가 없습니다. 원문에 사진이 없었다는 뜻은 아닙니다.', 'life-help'));
    const getSelectedIndexes = () => selections.filter(check => check.checked).map(check => Number(check.dataset.photoIndex));
    if (onWritePhotos || onDownload) {
      const actions = el('div', null, 'life-actions');
      const error = el('p', '', 'life-error'); error.hidden = true; error.setAttribute('role', 'alert');
      let working = false;
      const perform = async action => { if (disposed || working) return; working = true; error.hidden = true; actions.querySelectorAll('button').forEach(b => { b.disabled = true; });
        try { await action(); } catch (_) { if (!disposed) { error.textContent = '처리하지 못했습니다. 사진과 자료는 그대로 있습니다. 다시 시도해 주세요.'; error.hidden = false; } }
        finally { working = false; if (!disposed) actions.querySelectorAll('button').forEach(b => { b.disabled = b.dataset.action === 'write' && !getSelectedIndexes().length; }); } };
      if (onWritePhotos) { const b = el('button', '선택 사진으로 글쓰기', 'life-button'); b.type = 'button'; b.disabled = true;
        b.dataset.action = 'write'; node.addEventListener('change', () => { b.disabled = working || !getSelectedIndexes().length; });
        b.addEventListener('click', () => { if (!disposed && getSelectedIndexes().length) void perform(() => onWritePhotos(getSelectedIndexes())); }); actions.append(b); }
      if (onDownload) { const b = el('button', '글·사진 ZIP 저장', 'life-button'); b.type = 'button'; b.addEventListener('click', () => { if (!disposed) void perform(onDownload); }); actions.append(b); }
      node.append(actions, error);
    }
    return { node, getSelectedIndexes, dispose() { if (disposed) return; disposed = true; images.forEach(image => image.removeAttribute('src')); urls.forEach(url => root.URL.revokeObjectURL(url)); node.replaceChildren(); } };
  }
  function create({ container, service, workspaceId, capture: initial, captureId, onApply, onOpenSource, onWritePhotos, onDownload, onReturn, isCurrent = () => true, viewState = {} }) {
    const doc = container.ownerDocument;
    const el = (tag, text, cls) => { const n = doc.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
    let disposed = false, epoch = 0, busy = false, navigating = false, data = null, surface, status, error, imageView;
    const valid = token => !disposed && isCurrent() && container.isConnected && (token == null || token === epoch);
    function lock() { if (!surface) return; surface.setAttribute('aria-busy', String(busy || navigating)); surface.querySelectorAll('button,input').forEach(node => { node.disabled = busy || navigating || node.dataset.unavailable === 'true'; }); }
    function fail() { if (!valid()) return; error.hidden = false; error.textContent = '처리하지 못했습니다. 수집한 사본과 기존 자료는 그대로 있습니다. 다시 시도해 주세요.'; status.textContent = '완료하지 못함 · 자료 유지'; status.dataset.state = 'error'; }
    async function task(action) { if (!valid() || busy) return; const token = epoch; busy = true; error.hidden = true; lock(); try { await action(token); } catch (_) { if (valid(token)) fail(); } finally { if (valid(token)) { busy = false; lock(); } } }
    async function navigate(action) { if (!valid() || navigating) return; busy = false; navigating = true; lock(); try { await action(); } finally { navigating = false; if (valid()) lock(); } }
    function button(label, action, id) { const n = el('button', label, 'life-button'); n.type = 'button'; if (id) n.id = id; n.addEventListener('click', () => { if (valid() && !busy && !navigating) void action().catch(fail); }); return n; }
    function paint() {
      const selectedIndexes = imageView?.getSelectedIndexes();
      imageView?.dispose();
      const row = data.capture, payload = row.payload, projection = data.projection || {};
      const received = projection.received === true && typeof projection.sourceId === 'string' && projection.sourceId.length > 0 && typeof projection.sourceVersionId === 'string' && projection.sourceVersionId.length > 0;
      surface = el('section', null, 'naver-capture'); surface.id = 'naverCaptureReview'; surface.dataset.captureId = row.id;
      const heading = el('h2', payload.title); heading.tabIndex = -1;
      surface.append(heading, el('p', '수집된 본문과 사진을 확인한 뒤 이 공간의 자료에 반영할 수 있습니다. 네이버 원본과 이미 보관한 자료는 자동으로 덮어쓰지 않습니다.', 'life-help'));
      const link = el('a', '네이버 원문 열기', 'life-button'); link.href = payload.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; surface.append(link);
      const coverage = { full_text: '본문 추출 완료', partial: '본문 일부', link_only: '본문 미확보', unknown: '본문 범위 미확인' };
      surface.append(el('p', (coverage[payload.coverage] || coverage.unknown) + ' · 사진 ' + payload.photos.filter(p => p.status === 'stored').length + '/' + payload.photos.length + '개 파일 보관', 'life-meta'));
      if (payload.omissions.length) { const list = el('ul', null, 'nv-capture-omissions'); payload.omissions.forEach(text => list.append(el('li', text))); surface.append(list); }
      const body = el('pre', payload.body == null ? '본문은 확보하지 못했습니다. 원문 링크를 확인해 주세요.' : payload.body, 'nv-capture-body'); body.id = 'naverCaptureBody'; surface.append(body);
      imageView = photos({ payload, photos: data.photos || [], document: doc });
      const selected = selectedIndexes || (viewState.captureId === row.id && Array.isArray(viewState.selectedIndexes) ? viewState.selectedIndexes : []);
      imageView.node.querySelectorAll('input').forEach(check => { check.checked = selected.includes(Number(check.dataset.photoIndex)); });
      surface.append(imageView.node);
      status = el('p', '수집 사본을 확인했습니다. 아직 새 글을 만들거나 공개하지 않았습니다.', 'life-status'); status.id = 'naverCaptureStatus'; status.dataset.state = 'ready'; status.setAttribute('role', 'status');
      error = el('p', '', 'life-error'); error.id = 'naverCaptureError'; error.setAttribute('role', 'alert'); error.hidden = true; surface.append(status, error);
      const actions = el('div', null, 'life-actions');
      if (projection.sourceId) actions.append(el('p', '본문을 보완하면 기존 원문을 지우지 않고 새 버전으로 보관합니다. 이전 인용은 원래 버전에 남습니다.', 'life-help'));
      if (onApply) {
        const apply = button(projection.sourceId ? '이 본문으로 자료 보완' : '이 공간의 자료로 보관', () => task(async token => {
          const result = await onApply({ captureId: row.id, ...(projection.sourceId ? { existingSourceId: projection.sourceId, expectedSourceVersionId: projection.sourceVersionId } : {}) });
          if (!valid(token)) return;
          if (result?.sourceId) { data.projection = { ...projection, ...result, received: result.received === true }; paint(); }
          status.textContent = '자료에 반영했습니다. 보관한 자료를 열어 확인할 수 있습니다.'; status.dataset.state = 'stored';
        }), 'naverCaptureApply'); apply.dataset.unavailable = String(['ambiguous', 'trashed'].includes(projection.status)); actions.append(apply);
        if (projection.status === 'trashed') actions.append(el('p', '휴지통에 있는 자료입니다. 보관한 자료에서 복원한 뒤 보완해 주세요.', 'life-help'));
        if (projection.status === 'ambiguous') actions.append(el('p', '기존 자료가 여러 개와 겹칩니다. 자동으로 합치지 않았습니다. 목록에서 기존 자료를 먼저 확인해 주세요.', 'life-help'));
      }
      if (onOpenSource && projection.sourceId) { actions.append(button('보관한 자료 열기', () => navigate(() => onOpenSource({ sourceId: projection.sourceId, sourceVersionId: projection.sourceVersionId })), 'naverCaptureOpen')); if (!received) actions.append(el('p', '보관한 자료 열기는 기존 본문을 엽니다. 현재 검토 중인 수집 사본은 아직 그 버전에 반영되지 않았습니다.', 'life-help')); }
      if (service?.readCapture) actions.append(button('현재 자료 상태 다시 확인', () => task(async token => {
        const latest = await service.readCapture(workspaceId, row.id);
        if (!valid(token)) return;
        const verified = await root.HaedoLife.NaverCapture.validateCaptureRow(latest.capture);
        if (!valid(token)) return;
        data = { ...latest, capture: verified }; paint();
        status.textContent = '현재 자료 상태를 다시 확인했습니다. 수집 사본과 선택한 사진은 그대로 있습니다.'; status.dataset.state = 'ready';
      }), 'naverCaptureReload'));
      if (onWritePhotos) {
        const write = button('선택 사진으로 글쓰기', async () => { if (!received || projection.status === 'trashed') return; await navigate(() => onWritePhotos({ sourceId: projection.sourceId, sourceVersionId: projection.sourceVersionId, indexes: imageView.getSelectedIndexes() })); }, 'naverCaptureWritePhotos');
        const update = () => { write.dataset.unavailable = String(!received || projection.status === 'trashed' || !imageView.getSelectedIndexes().length); lock(); };
        imageView.node.addEventListener('change', update); update(); actions.append(write);
      }
      if (onDownload) { const download = button('글·사진 ZIP 저장', async () => { if (!received) return; await task(async token => { await onDownload({ sourceId: projection.sourceId, sourceVersionId: projection.sourceVersionId }); if (valid(token)) { status.textContent = 'ZIP 파일 저장을 요청했습니다.'; status.dataset.state = 'downloaded'; } }); }, 'naverCaptureDownload'); download.dataset.unavailable = String(!received); actions.append(download); }
      if (!received) actions.append(el('p', '사진을 골라 글로 쓰거나 ZIP으로 보관하려면 현재 수집 사본을 먼저 이 공간의 자료에 반영해 주세요.', 'life-help'));
      if (onReturn) actions.append(button('네이버 글 목록으로 돌아가기', () => navigate(onReturn), 'naverCaptureReturn'));
      surface.append(actions); container.replaceChildren(surface); lock();
    }
    async function render(candidate = initial) {
      if (!valid()) return; const token = ++epoch;
      try {
        const result = candidate || await service.readCapture(workspaceId, captureId);
        if (!valid(token)) return;
        const verified = await root.HaedoLife.NaverCapture.validateCaptureRow(result.capture);
        if (!valid(token)) return;
        data = { ...result, capture: verified }; paint();
      } catch (_) { if (!valid(token)) return; if (!surface) { surface = el('section', null, 'naver-capture'); status = el('p'); error = el('p', '', 'life-error'); error.setAttribute('role', 'alert'); surface.append(status, error, button('수집 사본 다시 확인', () => render(), 'naverCaptureRetry')); container.replaceChildren(surface); } fail(); }
    }
    return { render, flush: async () => { if (busy && !navigating) throw new Error('선택한 처리가 끝난 뒤 이동해 주세요.'); }, dirty: () => busy && !navigating,
      getView: () => ({ captureId: data?.capture?.id || captureId, selectedIndexes: imageView?.getSelectedIndexes() || [] }),
      destroy() { if (disposed) return; disposed = true; epoch++; imageView?.dispose(); data = null; container.replaceChildren(); } };
  }
  return Object.freeze({ create, photos });
});
