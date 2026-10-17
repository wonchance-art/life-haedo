/* File-only review first; restoration always creates a new private account-owned copy. */
(function (root) {
  'use strict';
  const life = (root.HaedoLife ||= {}), node = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };
  const labels = { added: '추가', changed: '수정', missing: '누락 · 기존 보존', unchanged: '동일' };
  function create({ storage, isCurrent = () => true, onRestored = null } = {}) {
    const service = life.ObsidianUpdate.createService({ storage, isCurrent });
    let host, surface, status, error, resultHost, rowsHost, controlsHost, beforeFile, afterFile, disposed = false, busy = false, generation = 0;
    let comparison = null, prepared = null, installed = null, shown = 40; const selected = new Set();
    const valid = () => !disposed && isCurrent();
    const guard = token => { if (!valid() || token !== generation) throw new Error('화면이나 계정이 바뀌었습니다. 원본 자료는 유지됩니다.'); };
    const sync = () => { if (!surface) return; surface.setAttribute('aria-busy', String(busy)); surface.querySelectorAll('button,input').forEach(el => { el.disabled = busy || el.dataset.unavailable === 'true'; }); };
    async function run(action) {
      if (busy || !valid()) return;
      const token = generation; busy = true; error.hidden = true; sync();
      try { await action(token); } catch (failure) { if (valid() && token === generation) { error.hidden = false; error.textContent = failure.message || '처리하지 못했습니다. 원본은 유지됩니다. 다시 시도해 주세요.'; } }
      finally { busy = false; if (valid() && token === generation) sync(); }
    }
    const button = (text, action, id, primary = false) => { const el = node('button', text, 'life-button' + (primary ? ' life-primary' : '')); el.type = 'button'; if (id) el.id = id; el.addEventListener('click', () => run(action)); return el; };
    function invalidate() { generation++; service.cancel(); comparison = prepared = installed = null; selected.clear(); rowsHost.replaceChildren(); controlsHost.replaceChildren(); resultHost.replaceChildren(); status.textContent = ''; }
    function renderRows() {
      rowsHost.replaceChildren(); if (!comparison) return;
      const counts = comparison.rows.reduce((a, r) => { a[r.kind] = (a[r.kind] || 0) + 1; return a; }, {});
      rowsHost.append(node('p', Object.entries(labels).map(([key, label]) => `${label} ${counts[key] || 0}개`).join(' · '), 'life-meta'));
      rowsHost.append(node('p', '누락 항목은 삭제하지 않습니다. 경로 변경 후보는 제안이며, 선택하면 이전 경로도 보존한 별도 원문으로 추가합니다.', 'life-help'));
      const list = node('div'); list.id = 'obsidianUpdateRows';
      const visibleRows = comparison.rows.filter(row => row.kind !== 'unchanged');
      if (!visibleRows.length) rowsHost.append(node('p', '추가·수정·누락 항목이 없습니다. 같은 자료를 다시 만들지 않습니다.', 'life-help'));
      for (const row of visibleRows.slice(0, shown)) {
        const label = node('label', null, 'preservation-choice'); label.style.display = 'flex'; label.style.gap = '.65rem'; label.style.marginBlock = '.6rem';
        const check = node('input'); check.type = 'checkbox'; check.dataset.rowId = row.id; check.checked = selected.has(row.id);
        const enabled = ['added', 'changed'].includes(row.kind); check.dataset.unavailable = String(!enabled); check.disabled = busy || !enabled;
        check.setAttribute('aria-label', `${labels[row.kind]} ${row.path}`);
        check.addEventListener('change', () => { if (check.checked) selected.add(row.id); else selected.delete(row.id); prepared = installed = null; service.cancel(); resultHost.replaceChildren(); renderControls(); });
        const text = node('span'); text.style.minWidth = '0'; text.style.overflowWrap = 'anywhere'; text.append(node('strong', row.path), node('span', ` · ${labels[row.kind]}`, 'life-meta'));
        if (row.possibleMoves.length) text.append(node('small', ` 경로 변경 후보: ${row.possibleMoves.join(', ')} · 자동 확정하지 않음`, 'life-help'));
        label.append(check, text);
        const item = node('article'); item.append(label);
        const details = node('details'), summary = node('summary', '원문 비교'); details.append(summary);
        let loaded = false;
        details.addEventListener('toggle', () => {
          if (!details.open || loaded || !valid()) return; loaded = true;
          const values = life.ObsidianUpdate.reviewRow(comparison, row.id);
          for (const [key, title] of [['before', '이전 원문'], ['after', '새 원문']]) {
            const value = values[key]; details.append(node('h4', title));
            if (!value) { details.append(node('p', key === 'before' ? '이전 파일에 없음' : '새 파일에 없음 · 기존 자료 보존', 'life-help')); continue; }
            const source = node('a', '정확한 원문 출처'); source.href = value.source.url; source.target = '_blank'; source.rel = 'noopener noreferrer'; details.append(source);
            details.append(node('p', value.version.coverage.status === 'full_text' ? '본문 확보' : '부분 본문 또는 미확보 · 원래 확보 범위 유지', 'life-meta'));
            const raw = node('pre', value.version.contentText ?? '본문 미확보'); raw.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:20rem;overflow:auto;padding:.75rem;border:1px solid var(--line,#ddd);font:inherit'; details.append(raw);
          }
        });
        item.append(details); list.append(item);
      }
      rowsHost.append(list);
      if (shown < visibleRows.length) rowsHost.append(button('40개 더 보기', () => { shown += 40; renderRows(); }, 'obsidianUpdateMore'));
    }
    function renderControls() {
      controlsHost.replaceChildren(); if (!comparison) return;
      controlsHost.append(button('추가·수정 모두 선택', () => { comparison.rows.filter(r => ['added', 'changed'].includes(r.kind)).forEach(r => selected.add(r.id)); prepared = installed = null; service.cancel(); resultHost.replaceChildren(); renderRows(); renderControls(); }, 'obsidianUpdateSelectAll'));
      const prepare = button(`선택 ${selected.size}개로 새 사본 준비`, async token => {
        const value = await service.prepare(comparison, [...selected]); guard(token); prepared = value; installed = null; renderResult();
      }, 'obsidianUpdatePrepare', true); prepare.dataset.unavailable = String(!selected.size); controlsHost.append(prepare); sync();
    }
    function renderResult() {
      resultHost.replaceChildren(); if (!prepared) return;
      const s = prepared.summary;
      resultHost.append(node('p', `추가 ${s.added}개 · 수정 ${s.changed}개 · 원문 연결 ${s.links}개 · 누락 보존 ${s.preservedMissing}개 · 새 작업공간 ${s.workspaces}개`, 'life-meta'));
      if (s.pendingLinks) resultHost.append(node('p', `선택하지 않은 변경 버전을 향한 링크 ${s.pendingLinks}개는 새 연결에서 제외했습니다. 이전 원문·발췌·연결은 그대로 보존했습니다.`, 'life-help'));
      resultHost.append(node('p', '기존 자료를 보존한 새 사본입니다. 입력 파일에 포함된 원문·버전·발췌·연결만 포함하며 책·구성·초안·사진과 바이너리 첨부는 별도 보관해야 합니다. 기존 계정 자료와 합치거나 덮어쓰지 않습니다.', 'life-help'));
      resultHost.append(button('갱신 사본 JSON 받기', () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(prepared.document)], { type: 'application/json' }));
        const a = node('a'); a.href = url; a.download = 'haedo-obsidian-update.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      }, 'obsidianUpdateDownload'));
      const restore = button(installed ? '새 사본 복원 완료' : '현재 계정에 새 사본 복원', async token => {
        const copies = await service.install(); guard(token); installed = copies; renderResult(); status.textContent = `새 작업공간 ${copies.length}개로 복원했습니다. 기존 작업공간은 보존했습니다.`;
        // Mark installation complete before navigation callbacks: a callback failure must never duplicate data.
        if (onRestored) await onRestored(copies);
      }, 'obsidianUpdateRestore', true); restore.dataset.unavailable = String(!!installed); resultHost.append(restore); sync();
    }
    function mount(target) {
      if (disposed) throw new Error('닫힌 화면입니다. 다시 열어 주세요.'); host = target; surface = node('section'); surface.id = 'obsidianUpdatePanel';
      surface.append(node('h2', 'Obsidian 갱신'), node('p', '이전 사본과 새 변환 ZIP을 비교하고, 선택한 변경을 기존 자료와 함께 새 사본으로 보관합니다. 파일은 서버로 업로드하지 않습니다.', 'life-help'));
      const field = (title, id, accept) => { const label = node('label', title); label.style.display = 'block'; label.style.marginBlock = '1rem'; const el = node('input'); el.type = 'file'; el.id = id; el.accept = accept; el.style.display = 'block'; el.style.maxWidth = '100%'; el.addEventListener('change', invalidate); label.append(el); surface.append(label); return el; };
      beforeFile = field('이전 자료 · 변환 ZIP 또는 JSON 사본', 'obsidianUpdateBefore', '.zip,.json'); afterFile = field('새 자료 · 검증할 Obsidian 변환 ZIP', 'obsidianUpdateAfter', '.zip');
      error = node('p', '', 'life-help'); error.id = 'obsidianUpdateError'; error.role = 'alert'; error.hidden = true;
      status = node('p', '', 'life-meta'); status.role = 'status'; status.setAttribute('aria-live', 'polite');
      const compare = button('파일 비교', async token => {
        if (!beforeFile.files[0] || !afterFile.files[0]) throw new Error('이전 자료와 새 Obsidian 변환 ZIP을 모두 선택해 주세요.');
        const old = await life.ObsidianUpdate.read(beforeFile.files[0]); guard(token);
        const next = await life.ObsidianUpdate.read(afterFile.files[0], { next: true }); guard(token);
        comparison = life.ObsidianUpdate.compare(old, next); prepared = installed = null; selected.clear(); service.cancel(); shown = 40;
        renderRows(); renderControls(); resultHost.replaceChildren(); status.textContent = '검증과 비교를 마쳤습니다. 추가·수정 항목을 선택해 주세요.';
      }, 'obsidianUpdateCompare');
      rowsHost = node('div'); controlsHost = node('div'); controlsHost.className = 'life-actions'; resultHost = node('div'); resultHost.id = 'obsidianUpdateResult';
      surface.append(compare, status, error, rowsHost, controlsHost, resultHost); host.replaceChildren(surface); return api;
    }
    const api = Object.freeze({ mount, dirty: () => busy, async flush() { if (busy) throw new Error('파일 처리 중입니다. 처리가 끝난 뒤 이동해 주세요.'); }, dispose() { disposed = true; generation++; service.dispose(); host?.replaceChildren(); } });
    return api;
  }
  life.ObsidianUpdateUI = Object.freeze({ create }); root.LifeObsidianUpdateUI = life.ObsidianUpdateUI;
})(globalThis);
