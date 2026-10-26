/* Explicit, read-only review of scoped Obsidian link candidates. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).ObsidianLinkCandidatesUI = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const PAGE = 20;
  function create({ document: doc = root.document, model = root.HaedoLife?.ObsidianLinkCandidates,
    text, fromPath, notes, attachments = null, fromSourceId = null, fromSourceVersionId = null,
    existingLinks = [], onOpenNote, onConnectNote, onOpenAttachment, isCurrent = () => true } = {}) {
    if (!doc?.createElement || !model?.scan || !model?.resolve || typeof text !== 'string' || typeof fromPath !== 'string' ||
        !Array.isArray(notes) || !(attachments === null || Array.isArray(attachments)) || !Array.isArray(existingLinks)) throw new Error('invalid_scope');
    const sourceNotes = notes.map(v => ({ path: v?.path, sourceId: v?.sourceId, sourceVersionId: v?.sourceVersionId, origin: v?.origin, text: v?.text, title: v?.title, url: v?.url, importedAt: v?.importedAt }));
    const sourceFiles = attachments?.map(v => ({ path: v?.path, copyId: v?.copyId, snapshotPath: v?.snapshotPath, sha256: v?.sha256, mime: v?.mime, bytes: v?.bytes })) ?? null;
    const links = structuredClone(existingLinks); let occurrences = [], scanFailed = false, initialized = false;
    const el = (tag, value, cls) => { const n = doc.createElement(tag); if (value != null) n.textContent = value; if (cls) n.className = cls; return n; };
    let host, list, status, more, details, summary, shown = 0, disposed = false, busy = false;
    const connectionControls = new Map(), focusTargets = new Map(), rowStates = new Map(), anchorStates = new Map(), resolved = new Map();
    const MAX_RESOLVED = 200, MAX_RESOLVED_WEIGHT = 20000; let resolvedWeight = 0;
    const valid = () => !disposed && isCurrent() && !!host?.isConnected;
    function resolve(occurrence, requestedKind = null) {
      // This instance owns an immutable snapshot of the path and explicit scope.
      const key = JSON.stringify([occurrence.target, !!occurrence.invalid, requestedKind]);
      const previous = resolved.get(key);
      if (previous) { resolved.delete(key); resolved.set(key, previous); return previous.value; }
      const value = model.resolve({ occurrence, fromPath, notes: sourceNotes, attachments: sourceFiles, requestedKind });
      const weight = 1 + (value.candidates || []).reduce((sum, candidate) => sum + 1 + (candidate.locators?.length || 0), 0);
      if (weight <= MAX_RESOLVED_WEIGHT) {
        while (resolved.size >= MAX_RESOLVED || resolvedWeight + weight > MAX_RESOLVED_WEIGHT) {
          const oldest = resolved.keys().next().value; resolvedWeight -= resolved.get(oldest).weight; resolved.delete(oldest);
        }
        resolved.set(key, { value, weight }); resolvedWeight += weight;
      }
      return value;
    }
    const sameLocator = (a, b) => a == null && b == null || !!a && !!b && a.start === b.start && a.end === b.end;
    function context(text, locator) {
      if (typeof text !== 'string' || !Number.isSafeInteger(locator?.start) || !Number.isSafeInteger(locator?.end) ||
          locator.start < 0 || locator.end <= locator.start || locator.end > text.length) return null;
      const splitsPair = n => n > 0 && n < text.length && /[\uD800-\uDBFF]/.test(text[n - 1]) && /[\uDC00-\uDFFF]/.test(text[n]);
      let before = Math.max(0, locator.start - 32), after = Math.min(text.length, locator.end + 80), matchEnd = Math.min(locator.end, locator.start + 160);
      if (splitsPair(before)) before--; if (splitsPair(after)) after++; if (splitsPair(matchEnd)) matchEnd++;
      return { before: text.slice(before, locator.start), match: text.slice(locator.start, matchEnd) + (matchEnd < locator.end ? '…' : ''), after: text.slice(locator.end, after) };
    }
    function state(occurrence, candidate, locator) {
      const prior = links.filter(link => link?.kind === 'obsidian_link' && Array.isArray(link.sourceRefs) && link.sourceRefs.length === 2 &&
        link.sourceRefs[0]?.sourceId === fromSourceId && link.sourceRefs[0]?.sourceVersionId === fromSourceVersionId &&
        sameLocator(link.sourceRefs[0]?.locator, { start: occurrence.start, end: occurrence.end }));
      if (!prior.length) return 'new';
      return prior.length === 1 && prior[0].sourceRefs[1]?.sourceId === candidate.sourceId &&
        prior[0].sourceRefs[1]?.sourceVersionId === candidate.sourceVersionId && sameLocator(prior[0].sourceRefs[1]?.locator, locator) ? 'connected' : 'conflict';
    }
    function button(label, action, disabled = false) {
      const b = el('button', label, 'life-button'); b.type = 'button'; b.disabled = disabled;
      b.addEventListener('click', async () => {
        if (b.disabled || disabled || busy || !valid()) return;
        busy = true; status.hidden = true; status.textContent = '';
        try { await action(); } catch (_) { if (valid()) { status.textContent = '열거나 연결하지 못했습니다. 원래 자료는 유지됩니다.'; status.hidden = false; } }
        finally { busy = false; }
      });
      return b;
    }
    function noteActions(row, occurrence, candidate, locator, label, allowConnect) {
      const actions = el('div', null, 'life-actions');
      const focusKey = 'obsidian-candidate:' + occurrence.start + ':' + candidate.sourceVersionId + ':' + (locator?.start ?? 'document');
      if (typeof onOpenNote === 'function') {
        const open = button(label, () => onOpenNote({ occurrence: { ...occurrence }, candidate: structuredClone(candidate), locator: locator && { ...locator } }));
        open.dataset.obsidianFocus = focusKey + ':open'; focusTargets.set(focusKey + ':open', open); actions.append(open);
      }
      if (allowConnect && typeof onConnectNote === 'function' && typeof fromSourceId === 'string' && typeof fromSourceVersionId === 'string') {
        const linkState = state(occurrence, candidate, locator);
        const key = occurrence.start + ':' + occurrence.end;
        const connect = button(linkState === 'connected' ? '이미 연결됨' : linkState === 'conflict' ? '다른 대상이 이미 연결됨' : '이 위치를 연결', async () => {
          await onConnectNote({ occurrence: { ...occurrence }, candidate: structuredClone(candidate), locator: locator && { ...locator } });
          if (!valid()) return;
          links.push({ kind: 'obsidian_link', sourceRefs: [{ sourceId: fromSourceId, sourceVersionId: fromSourceVersionId, locator: { start: occurrence.start, end: occurrence.end } },
            { sourceId: candidate.sourceId, sourceVersionId: candidate.sourceVersionId, locator: locator && { ...locator } }] });
          for (const item of connectionControls.get(key) || []) { item.disabled = true; item.textContent = item === connect ? '이미 연결됨' : '다른 대상이 이미 연결됨'; }
        }, linkState !== 'new');
        connect.dataset.obsidianFocus = focusKey + ':connect'; focusTargets.set(focusKey + ':connect', connect);
        if (!connectionControls.has(key)) connectionControls.set(key, []); connectionControls.get(key).push(connect); actions.append(connect);
      }
      row.append(actions);
    }
    function appendCandidates(row, occurrence, result, current) {
      let offset = 0;
      const candidates = el('div'), next = button('대상 20개 더 보기', async () => append());
      row.append(candidates, next);
      function append() {
        for (const [pageIndex, candidate] of result.candidates.slice(offset, offset + PAGE).entries()) {
          const item = el('section', null, 'life-backup-source');
          item.append(el('p', '후보 ' + (offset + pageIndex + 1), 'life-meta'), el('p', candidate.path || '경로 미확인', 'life-meta'));
          if (result.kind === 'attachment') {
            item.append(el('p', '선택한 첨부 목록의 후보입니다. 원본 파일을 열기 전에는 내용을 확인하지 않았습니다.', 'life-help'));
            if (candidate.copyId) item.dataset.copyId = candidate.copyId;
            if (candidate.snapshotPath) item.append(el('p', candidate.snapshotPath, 'life-meta'));
            const identified = typeof candidate.copyId === 'string' && !!candidate.copyId && typeof candidate.snapshotPath === 'string' && !!candidate.snapshotPath && /^[a-f0-9]{64}$/.test(candidate.sha256 || '');
            if (!identified) item.append(el('p', '첨부 식별 정보가 부족해 열 수 없습니다.', 'life-help'));
            if (identified && typeof onOpenAttachment === 'function') item.append(button('첨부 후보 열기', () => onOpenAttachment({ occurrence: { ...occurrence }, candidate: structuredClone(candidate) })));
          } else {
            const description = sourceNotes.find(value => value.sourceId === candidate.sourceId && value.sourceVersionId === candidate.sourceVersionId);
            if (description?.title) item.append(el('p', description.title, 'life-meta'));
            if (description?.url) item.append(el('p', description.url, 'life-meta'));
            if (typeof description?.importedAt === 'string' && Number.isFinite(Date.parse(description.importedAt))) {
              const time = el('time', '보관 ' + new Date(description.importedAt).toLocaleString('ko-KR'), 'life-meta'); time.dateTime = description.importedAt; item.append(time);
            }
            if (candidate.sourceId) item.dataset.sourceId = candidate.sourceId;
            if (candidate.sourceVersionId) item.dataset.versionId = candidate.sourceVersionId;
            const identified = typeof candidate.sourceId === 'string' && !!candidate.sourceId && typeof candidate.sourceVersionId === 'string' && !!candidate.sourceVersionId;
            if (!identified) item.append(el('p', '원문 식별 정보가 부족해 열거나 연결할 수 없습니다.', 'life-help'));
            else if (candidate.anchorStatus === 'document') noteActions(item, occurrence, candidate, null, '문서 전체 열기', true);
            else if (candidate.anchorStatus === 'anchor_found' || candidate.anchorStatus === 'anchor_ambiguous') {
            item.append(el('p', candidate.anchorStatus === 'anchor_ambiguous' ? '같은 위치 이름이 여러 번 나옵니다. 직접 고르세요.' : '이름이 일치하는 위치를 확인했습니다. 직접 선택하세요.', 'life-help'));
            const anchors = el('div'); let index = 0;
            const nextAnchor = button('일치 위치 20개 더 보기', async () => appendAnchors());
            function appendAnchors() {
              for (const locator of candidate.locators.slice(index, index + PAGE)) {
                const nearby = context(description?.text, locator);
                if (!nearby) { anchors.append(el('p', '대상 원문 위치를 다시 확인해야 합니다. 자동으로 열거나 연결하지 않았습니다.', 'life-help')); index++; continue; }
                const snippet = el('div', null, 'life-help');
                snippet.append(el('p', '앞: ' + nearby.before), el('p', '위치: ' + nearby.match), el('p', '뒤: ' + nearby.after)); anchors.append(snippet);
                noteActions(anchors, occurrence, candidate, locator, '일치 위치 ' + (++index) + ' 열기 (' + locator.start + '–' + locator.end + ')', true);
              }
              nextAnchor.hidden = index >= candidate.locators.length;
            }
            anchorStates.set(occurrence.start + ':' + candidate.sourceVersionId, { locators: candidate.locators, load: appendAnchors, shown: () => index });
            item.append(anchors, nextAnchor); appendAnchors();
            } else {
              item.append(el('p', candidate.anchorStatus === 'text_missing' ? '대상 본문을 확인하지 못해 위치를 찾지 못했습니다.' : '요청한 위치를 찾지 못했습니다.', 'life-help'));
              noteActions(item, occurrence, candidate, null, '문서만 열기 · 위치 미확인', false);
            }
          }
          candidates.append(item);
        }
        offset = Math.min(offset + PAGE, result.candidates.length); next.hidden = offset >= result.candidates.length;
      }
      current.loadCandidates = append; current.shownCandidates = () => offset; append();
    }
    function appendRows() {
      for (const occurrence of occurrences.slice(shown, shown + PAGE)) {
        const row = el('article', null, 'life-backup-source'); row.dataset.start = String(occurrence.start); row.dataset.end = String(occurrence.end);
        row.append(el('p', occurrence.token, 'life-source-url'), el('p', '원문 위치 ' + occurrence.start + '–' + occurrence.end, 'life-meta'));
        const resultHost = el('div'); row.append(resultHost);
        const current = { occurrence, result: null, show: null, loadCandidates: null, shownCandidates: () => 0 };
        rowStates.set(occurrence.start, current);
        function show(result) {
          resultHost.replaceChildren();
          current.result = result; current.loadCandidates = null;
          for (const key of focusTargets.keys()) if (key.startsWith('obsidian-candidate:' + occurrence.start + ':')) focusTargets.delete(key);
          for (const key of anchorStates.keys()) if (key.startsWith(occurrence.start + ':')) anchorStates.delete(key);
          const labels = { candidate: '대상 후보 1개 · 직접 확인', ambiguous: '대상 후보 여러 개 · 직접 선택', ambiguous_kind: '같은 이름의 노트와 첨부가 모두 있습니다. 종류를 직접 고르세요.', missing: '현재 범위에서 찾지 못함 · 존재 여부 미확인', invalid: '해석할 수 없는 대상', invalid_scope: '현재 원문 경로나 확인 범위를 해석하지 못했습니다.', not_checked: '첨부 목록을 아직 확인하지 않았습니다', unsupported_fragment: '첨부의 지정 위치는 지원하지 않습니다', too_many_candidates: '후보가 너무 많습니다. 더 정확한 경로가 필요합니다.' };
          resultHost.append(el('p', labels[result.status] || '대상 상태를 확인하지 못했습니다.', 'life-help'));
          if (result.status === 'ambiguous_kind') for (const [kind, label] of [['note', '노트 후보 확인'], ['attachment', '첨부 후보 확인']]) {
            resultHost.append(button(label, async () => show(resolve(occurrence, kind))));
          }
          if (result.status === 'candidate' || result.status === 'ambiguous') appendCandidates(resultHost, occurrence, result, current);
        }
        current.show = show;
        try { show(resolve(occurrence)); }
        catch (_) { show({ status: 'invalid_scope' }); }
        list.append(row);
      }
      shown = Math.min(shown + PAGE, occurrences.length); more.hidden = shown >= occurrences.length;
    }
    function mount(target) {
      if (disposed || !target?.replaceChildren) throw new Error('invalid_scope'); host = target;
      details = el('details', null, 'life-details life-obsidian-candidates'); summary = el('summary', '원문 링크 후보 확인');
      details.append(summary, el('p', '현재 지정된 범위에서 찾은 후보입니다. 자동 연결하지 않으며, 다른 보관함의 같은 경로일 수도 있습니다.', 'life-help'));
      list = el('div'); status = el('p', '', 'life-error'); status.hidden = true; status.setAttribute('role', 'alert');
      more = button('링크 20개 더 보기', async () => appendRows()); more.hidden = true;
      details.append(list, more, status); details.addEventListener('toggle', () => { if (details.open && valid()) initialize(); });
      host.replaceChildren(details); return api;
    }
    function initialize() {
      if (initialized || !valid()) return; initialized = true;
      try { occurrences = model.scan(text).map(value => ({ ...value })); } catch (_) { scanFailed = true; }
      summary.textContent = scanFailed ? '원문 링크 후보 확인 불가' : '원문 링크 후보 ' + occurrences.length;
      if (scanFailed) { status.textContent = '이 원문의 링크 후보를 확인하지 못했습니다. 원문은 그대로 유지됩니다.'; status.hidden = false; }
      appendRows();
    }
    function revealFocus(key) {
      if (!valid() || typeof key !== 'string') return null;
      const match = /^obsidian-candidate:(\d+):([A-Za-z0-9_-]+):(\d+|document)(?::(open|connect))?$/.exec(key);
      if (!match) return null;
      const start = Number(match[1]); if (!Number.isSafeInteger(start)) return null;
      initialize(); if (scanFailed) return null;
      const occurrenceIndex = occurrences.findIndex(value => value.start === start); if (occurrenceIndex < 0) return null;
      details.open = true;
      while (shown <= occurrenceIndex && shown < occurrences.length) appendRows();
      const current = rowStates.get(start); if (!current) return null;
      if (current.result?.status === 'ambiguous_kind') {
        try { current.show(resolve(current.occurrence, 'note')); }
        catch (_) { return null; }
      }
      const candidates = current.result?.candidates;
      if (!Array.isArray(candidates) || !current.loadCandidates) return null;
      const matching = candidates.map((value, index) => value.sourceVersionId === match[2] ? index : -1).filter(index => index >= 0);
      if (matching.length !== 1) return null; const candidateIndex = matching[0];
      while (current.shownCandidates() <= candidateIndex) current.loadCandidates();
      if (match[3] !== 'document') {
        const position = Number(match[3]); if (!Number.isSafeInteger(position)) return null;
        const anchors = anchorStates.get(start + ':' + match[2]); if (!anchors) return null;
        const anchorIndex = anchors.locators.findIndex(value => value.start === position); if (anchorIndex < 0) return null;
        while (anchors.shown() <= anchorIndex) anchors.load();
      }
      const target = focusTargets.get('obsidian-candidate:' + start + ':' + match[2] + ':' + match[3] + ':' + (match[4] || 'open'));
      if (!target || target.disabled || !valid()) return null;
      target.focus(); return target;
    }
    const api = Object.freeze({ mount, revealFocus, dispose() { disposed = true; resolved.clear(); resolvedWeight = 0; host?.replaceChildren(); } }); return api;
  }
  return Object.freeze({ create });
});
