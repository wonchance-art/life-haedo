/* Account-private originals review. No embedded HTML/PDF/HEIC execution or automatic remote transfer. */
(function (root) {
  'use strict';
  const life = (root.HaedoLife ||= {});
  const element = (tag, text, className) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (className) n.className = className; return n; };
  const roleLabel = role => ({ 'git-excluded-attachment': '원본 첨부', 'git-note-version': 'Git 저장본', 'working-note-version': '로컬 작업본' }[role] || '원본');
  const size = n => n < 1024 * 1024 ? Math.ceil(n / 1024).toLocaleString('ko-KR') + ' KiB' : (n / 1024 / 1024).toFixed(1) + ' MiB';
  async function open(options = {}) {
    const auth = options.auth || root.HaedoAuth;
    if (!auth?.getAccount || !life.OriginalAttachments) throw new Error('계정과 원본 보관 모듈을 확인해 주세요.');
    await auth.requireUser?.();
    const account = auth.getAccount();
    const owner = life.OriginalAttachments.create({ auth, account, ...(options.serviceOptions || {}) });
    const storage = options.storage || life.Shell?.storage;
    const dialog = element('dialog', null, 'original-attachments'); dialog.id = 'lifeOriginalAttachments';
    dialog.setAttribute('aria-labelledby', 'originalAttachmentsTitle');
    const header = element('div', null, 'original-attachments-heading');
    const title = element('h2', '원본 첨부'); title.id = 'originalAttachmentsTitle'; header.append(title);
    const close = element('button', '닫기', 'life-button'); close.type = 'button'; header.append(close);
    const status = element('p', '', 'life-meta'); status.id = 'originalAttachmentsStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const error = element('p', '', 'life-error'); error.id = 'originalAttachmentsError'; error.hidden = true; error.setAttribute('role', 'alert');
    const label = element('label', null, 'life-field'); label.append(element('span', '원본 파트 ZIP 열기'));
    const input = element('input'); input.type = 'file'; input.multiple = true; input.accept = '.zip,application/zip'; input.id = 'originalAttachmentsFile'; label.append(input);
    const cancel = element('button', '확인 취소', 'life-button'); cancel.type = 'button'; cancel.id = 'originalAttachmentsCancel'; cancel.hidden = true;
    const review = element('section'); review.id = 'originalAttachmentsReview';
    const list = element('section'); list.id = 'originalAttachmentsCopies';
    const content = element('section'); content.id = 'originalAttachmentsEntries';
    const help = element('details', null, 'life-details');
    help.append(element('summary', '지원 파일·보관 안내'),
      element('p', '원본 보관용으로 준비된 파트 ZIP을 선택하세요. 여러 파트를 함께 선택할 수 있으며 파트는 128 MiB, 개별 파일은 64 MiB 이하입니다. ZIP은 풀거나 다시 압축하지 말고 원래 파일을 별도로 보관해 주세요.', 'life-help'),
      element('p', 'JPEG·PNG·HEIC·PDF와 노트 저장본·작업본을 원본 그대로 보관합니다. HEIC·PDF는 내려받아 해당 앱에서 열어 주세요. 여기서 보관한 파일이 글에 삽입되지는 않습니다.', 'life-help'),
      element('p', '파일 확인에 실패하면 원래 파트 ZIP을 다시 선택해 주세요. 보관 중 일부 파트만 실패했다면 완료된 사본은 유지되며 남은 파트만 다시 시도할 수 있습니다.', 'life-help'));
    dialog.append(header, element('p', '원본 파일을 이 브라우저에 별도 보관합니다. 기존 자료·서버·공개 범위는 바뀌지 않습니다.', 'life-help'), label, help, cancel, status, error, review, list, content);
    let unsubscribe, active = true, busy = false, controller, candidate, generation = 0, selectedCopy = '', shown = 40;
    const objectURLs = new Set();
    const still = () => active && auth.getAccount()?.projectUrl === account.projectUrl && auth.getAccount()?.userId === account.userId;
    const announce = text => { if (still()) status.textContent = text; };
    function clearCandidate() { for (const part of candidate?.parts || []) owner.cancel(part.ticket); candidate = null; review.replaceChildren(); }
    function controls() { input.disabled = busy; dialog.setAttribute('aria-busy', String(busy)); cancel.hidden = !busy; dialog.querySelectorAll('button').forEach(b => { if (b !== close && b !== cancel) b.disabled = busy; }); }
    function button(text, fn, id) { const b = element('button', text, 'life-button'); b.type = 'button'; if (id) b.id = id; b.addEventListener('click', () => run(fn)); return b; }
    function showError(failure) { if (still()) { error.hidden = false; error.textContent = failure?.message || '파일을 처리하지 못했습니다. 원래 자료는 유지됩니다.'; } }
    async function run(fn) {
      if (!still() || busy) return; busy = true; error.hidden = true; controller = new AbortController(); controls();
      try { await fn(controller.signal); }
      catch (e) { showError(e); }
      finally { busy = false; controller = null; if (still()) controls(); }
    }
    function download(blob, name) {
      if (!still()) return;
      const url = URL.createObjectURL(blob); objectURLs.add(url);
      const link = element('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => { URL.revokeObjectURL(url); objectURLs.delete(url); }, 30000);
      announce('다운로드를 요청했습니다. 기기의 파일 앱에서 저장 여부를 확인해 주세요.');
    }
    function preview() {
      review.replaceChildren();
      const { parts, completed, total } = candidate;
      const count = parts.reduce((n, part) => n + part.count, 0), bytes = parts.reduce((n, part) => n + part.bytes, 0);
      review.append(element('h3', parts.length === 1 ? `파트 ${parts[0].part}/${parts[0].partCount} · ${count}개 · ${size(bytes)}` : `선택 ${parts.length}/${parts[0].partCount}개 파트 · 원본 ${count}개 · ${size(bytes)}`), element('p', '선택한 모든 파일의 경로·종류·SHA-256을 확인했습니다. 아래 원본을 새 사본으로 보관합니다. 노트 저장본과 작업본도 기존 원문을 바꾸지 않는 별도 사본입니다.', 'life-help'));
      if (completed) review.append(element('p', `${total}개 파트 중 ${completed}개 보관 완료 · 남은 ${parts.length}개만 다시 시도합니다.`, 'life-help'));
      const examples = element('ul');
      for (const part of parts) {
        const entries = element('ul');
        for (const e of part.entries.slice(0, 5)) entries.append(element('li', roleLabel(e.role) + ' · ' + e.sourceRelativePath));
        if (parts.length === 1) { examples.append(element('li', `파트 ${part.part}/${part.partCount} · ${part.count}개`), ...entries.children); }
        else {
          const row = element('li'), detail = element('details');
          detail.append(element('summary', `파트 ${part.part}/${part.partCount} · ${part.count}개`), entries); row.append(detail); examples.append(row);
        }
      }
      review.append(examples, button(parts.length === 1 ? '이 계정에 새 원본 사본 보관' : `선택한 ${parts.length}개 파트 보관`, async signal => {
        const current = candidate; if (!current) return;
        let saved;
        try {
          while (current.parts.length) {
            saved = await owner.install(current.parts[0].ticket, { signal });
            if (!still()) return;
            current.parts.shift(); current.completed++;
            announce(`${current.total}개 파트 중 ${current.completed}개 보관 완료`);
          }
        } catch (failure) {
          if (still()) { preview(); await refresh(); announce(`${current.total}개 파트 중 ${current.completed}개 보관했습니다. 완료된 사본은 유지되며 남은 파트만 다시 시도할 수 있습니다.`); }
          throw failure;
        }
        clearCandidate(); await refresh(); await showEntries(saved.id); announce(`선택한 ${current.total}개 파트의 원본 사본을 보관했습니다. 기존 자료와 서버는 그대로입니다.`);
      }, 'originalAttachmentsInstall'), button('보관 취소', async () => { clearCandidate(); announce('보관을 취소했습니다. 원래 파일과 기존 사본은 유지했습니다.'); }));
    }
    async function refresh() {
      const copies = await owner.list(); if (!still()) return;
      list.replaceChildren(element('h3', '이 계정의 원본 사본'));
      if (!copies.length) { list.append(element('p', '아직 보관한 원본 사본이 없습니다. 파트 파일을 열어 포함 범위를 확인해 주세요.', 'life-help')); return; }
      for (const copy of copies) {
        const row = element('div', null, 'original-attachments-copy');
        row.append(button(`파트 ${copy.part}/${copy.partCount} · ${copy.count}개 · ${size(copy.bytes)}`, () => showEntries(copy.id)));
        row.append(button('파트 원본 ZIP 받기', async () => { const result = await owner.archive(copy.id); if (still()) download(result.blob, result.name); }));
        list.append(row);
      }
    }
    async function showEntries(id) {
      if (selectedCopy !== id) { selectedCopy = id; shown = 40; }
      const rows = await owner.entries(id); if (!still()) return;
      content.replaceChildren(element('h3', `원본 ${rows.length}개`));
      for (const entry of rows.slice(0, shown)) {
        const row = element('article', null, 'original-attachments-entry'); row.dataset.role = entry.role;
        row.append(element('h4', entry.sourceRelativePath));
        row.append(element('p', `${roleLabel(entry.role)} · ${size(entry.bytes)} · ${entry.mime}`, 'life-meta'));
        const detail = element('details'), heading = element('summary', '해시·경로');
        detail.append(heading, element('p', entry.snapshotPath), element('code', entry.sha256)); row.append(detail);
        row.append(button('원본 파일 받기', async () => { const result = await owner.file(id, entry.snapshotPath); if (still()) download(result.blob, entry.sourceRelativePath.split('/').pop()); }));
        if (entry.mime === 'text/markdown') {
          row.append(button('원문 그대로 읽기', async () => {
            const result = await owner.file(id, entry.snapshotPath); if (!still()) return;
            if (entry.bytes > 1024 * 1024) throw new Error('긴 원문은 원본 파일로 내려받아 확인해 주세요.');
            const pre = element('pre', await result.blob.text(), 'original-attachments-note');
            if (!still()) return; row.querySelector('pre')?.remove(); row.append(pre);
          }));
          if (storage) row.append(button('같은 원문 버전 찾기', async () => {
            const matches = await owner.matchSource(entry, storage); if (!still()) return;
            row.querySelector('[data-original-matches]')?.remove();
            const matchesHost = element('div'); matchesHost.dataset.originalMatches = 'true';
            if (!matches.length) matchesHost.append(element('p', '해도 자료에서 같은 경로·해시의 원문 버전을 찾지 못했습니다. 이 보관함의 사본과 원본 파일은 유지됩니다.', 'life-help'));
            for (const match of matches) {
              matchesHost.append(element('p', match.title + ' · 경로·정확 버전 일치', 'life-help'));
              if (options.onOpenSource) matchesHost.append(button('해도 원문 열기', async () => { dispose(); await options.onOpenSource(match); }));
            }
            row.append(matchesHost);
          }));
        } else row.append(element('p', '이 화면에서는 미리보기를 제공하지 않습니다. 원본 파일을 내려받아 해당 앱에서 열 수 있습니다.', 'life-help'));
        content.append(row);
      }
      if (rows.length > shown) content.append(button('원본 더 보기', async () => { shown += 40; await showEntries(id); }));
    }
    function dispose() {
      if (!active) return;
      active = false; generation++; controller?.abort(); clearCandidate(); owner.dispose(); unsubscribe?.();
      for (const url of objectURLs) URL.revokeObjectURL(url); objectURLs.clear();
      if (dialog.open) dialog.close(); dialog.remove();
    }
    unsubscribe = auth.onAccountChange?.(() => { if (!still()) dispose(); });
    close.addEventListener('click', dispose);
    dialog.addEventListener('cancel', event => { if (busy) { event.preventDefault(); controller?.abort(); } else dispose(); });
    dialog.addEventListener('close', dispose);
    cancel.addEventListener('click', () => controller?.abort());
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []); input.value = ''; if (!files.length) return;
      clearCandidate(); const token = ++generation;
      run(async signal => {
        const parts = [];
        try {
          if (files.length > 200) throw new Error('한 번에 200개 이하의 파트를 선택해 주세요.');
          for (const file of files) {
            const summary = await owner.prepare(file, { signal, onProgress: progress => announce(`파트 ${parts.length + 1}/${files.length} · 원본 ${progress.verified}/${progress.count}개 확인 중`) });
            parts.push(summary);
            if (!still() || token !== generation) { for (const part of parts) owner.cancel(part.ticket); return; }
            if (parts.some(part => part.sourceHead !== summary.sourceHead || part.partCount !== summary.partCount) || parts.slice(0, -1).some(part => part.part === summary.part)) throw new Error('같은 원본 묶음의 파트를 중복 없이 선택해 주세요. 아직 보관하지 않았습니다.');
          }
          parts.sort((a, b) => a.part - b.part);
          candidate = { parts, completed: 0, total: parts.length }; preview(); announce('선택한 모든 원본을 확인했습니다. 포함 범위를 검토한 뒤 새 사본으로 보관해 주세요.');
        } catch (failure) { for (const part of parts) owner.cancel(part.ticket); throw failure; }
      });
    });
    document.body.append(dialog); dialog.showModal();
    await run(refresh);
    return Object.freeze({ dispose, dirty: () => active && busy, flush() { if (active && busy) throw new Error('파일 확인을 마치거나 취소한 뒤 이동해 주세요.'); }, refresh: () => run(refresh) });
  }
  life.OriginalAttachmentsUI = root.LifeOriginalAttachmentsUI = Object.freeze({ open });
})(globalThis);
