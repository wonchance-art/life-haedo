/* Explicit, account/workspace-local classification review. No raw file body is retained. */
(function (root) {
  'use strict';
  root.HaedoLife ||= {};
  const node = (tag, text, cls) => {
    const element = root.document.createElement(tag);
    if (text !== undefined && text !== null) element.textContent = String(text);
    if (cls) element.className = cls;
    return element;
  };
  const initialFilters = () => ({ source: '', topic: '', kind: '', review: '' });
  const emptyProjection = () => ({ byVersion: new Map(), staleVersionIds: new Set(), matched: 0, unmatched: 0, stale: 0, ambiguous: 0 });
  const reviewLabels = {
    source_unconfirmed: '출처 확인 필요', source_unknown: '출처 확인 필요',
    body_missing: '본문 확인 필요', attachment_unread: '첨부 확인 필요', ocr_unreliable: '문자 판독 확인 필요',
    mixed_authorship: '작성 관계 확인 필요', original_author_unknown: '원저자 확인 필요',
    metadata_body_conflict: '기존 분류와 본문 비교 필요', generated_or_dialogue_possible: '문서 화자 확인 필요',
    plan_vs_fact: '계획과 실제 기록 구분 필요', topic_tie: '주제 확인 필요', topic_unclassified: '주제 확인 필요',
    topic_ambiguous: '주제 확인 필요', work_status_unverified: '프로젝트 상태 확인 필요',
    private_contact_record: '인물 정보 확인 필요', cross_source_copy_candidate: '다른 출처의 사본 확인 필요',
    insufficient_topic_evidence: '주제 판단 근거 부족',
    frontmatter_parse_error_original_preserved: '원본 메타데이터 형식 확인 필요',
    very_short_or_empty_body: '본문이 짧거나 비어 있음',
    multiple_topics_close_score: '여러 주제 확인 필요',
    semantic_classification_uncertain: '내용 분류 확인 필요',
  };
  function create({ storage, getBundle, isCurrent = () => true, isDisposed = () => false, onChange = () => {} }) {
    let alive = true, active = false, sequence = 0, workspaceId = null, saved = null, stage = null;
    let projection = emptyProjection(), projectedRevision = null, ready = false, busy = false, needsLatest = false;
    let message = '', error = '', clearRequested = false, panelHost = null, panel = null, content = null, filterHost = null;
    let filters = initialFilters(), unsubscribe = null, filterCallback = null, pending = null, loadingRevision = null, observedRevision = 0, rememberedOpen = false;
    const urls = new Set();
    const model = () => root.HaedoLife.SourceClassification;
    const inScope = () => alive && active && !isDisposed() && isCurrent() && getBundle()?.workspaceId === workspaceId;
    const current = token => token === sequence && inScope();
    const revision = () => getBundle()?.revision;
    const validProjection = () => inScope() && ready && projectedRevision === revision();
    function notify() { if (inScope()) onChange(); }
    function invalidate() { projection = emptyProjection(); projectedRevision = null; ready = false; }
    function reconcileLatest() {
      if (observedRevision <= (saved?.revision ?? 0)) return false;
      needsLatest = true; invalidate();
      message = '다른 탭에서 분류를 변경했습니다. 최신 분류를 다시 확인해 주세요.';
      return true;
    }
    function explain(cause) {
      if (cause?.code === 'source_classification_too_large') return '분류 파일은 32MiB와 자료 10,000개 이내로 선택해 주세요.';
      if (cause?.code === 'source_classification_invalid' || cause instanceof SyntaxError) return '분류 파일의 형식이나 원문 식별 정보를 확인해 주세요. 기존 분류는 유지했습니다.';
      if (['auth_scope_required', 'account_changed', 'workspace_mismatch'].includes(cause?.code)) return '계정이나 작업공간이 바뀌었습니다. 현재 화면에서 다시 확인해 주세요.';
      return '분류를 처리하지 못했습니다. 기존 분류와 검토 중인 파일은 유지했습니다. 다시 시도해 주세요.';
    }
    function subscribe() {
      unsubscribe?.(); unsubscribe = null;
      if (!storage.subscribe || !workspaceId) return;
      unsubscribe = storage.subscribe(workspaceId, event => {
        if (!inScope() || event.type !== 'source_classification_changed' || event.revision <= (saved?.revision ?? -1)) return;
        observedRevision = Math.max(observedRevision, event.revision);
        if (busy) return;
        needsLatest = true; invalidate();
        message = '다른 탭에서 분류를 변경했습니다. 최신 분류를 확인한 뒤 다시 적용해 주세요.';
        draw(); drawFilters(); notify();
      });
    }
    function enter() {
      const next = getBundle()?.workspaceId;
      if (!alive || isDisposed() || !isCurrent() || !next) return false;
      if (workspaceId !== next) {
        reset(); workspaceId = next;
      }
      active = true;
      if (!unsubscribe) subscribe();
      return true;
    }
    function cancelStage() {
      stage = null; clearRequested = false;
      if (busy) { sequence++; pending = null; busy = false; invalidate(); needsLatest = true; }
      draw();
    }
    function leave() {
      if (panel) rememberedOpen = panel.open;
      active = false; sequence++; pending = null; busy = false; loadingRevision = null;
      stage = null; saved = null; clearRequested = false; needsLatest = false; observedRevision = 0; message = error = '';
      invalidate(); unsubscribe?.(); unsubscribe = null;
      panelHost = panel = content = filterHost = null; filterCallback = null;
      for (const url of urls) root.URL.revokeObjectURL(url);
      urls.clear();
    }
    function reset() { leave(); workspaceId = null; filters = initialFilters(); rememberedOpen = false; }
    function dispose() { reset(); alive = false; }
    function button(text, id, run, primary = false) {
      const control = node('button', text, 'life-button' + (primary ? ' sc-primary' : ''));
      control.type = 'button'; if (id) control.id = id;
      control.addEventListener('click', () => { if (!busy && inScope()) run(); });
      return control;
    }
    function feedback() {
      const status = content?.querySelector('#sourceClassificationStatus'), failure = content?.querySelector('#sourceClassificationError');
      if (status) { status.textContent = message; status.hidden = !message; }
      if (failure) { failure.textContent = error; failure.hidden = !error; }
      content?.setAttribute('aria-busy', String(busy));
      content?.querySelectorAll('fieldset').forEach(fieldset => { fieldset.disabled = busy; });
    }
    function statistics(target, value) {
      const list = node('dl', null, 'sc-counts');
      for (const [label, amount] of [['연결 가능', value.matched], ['현재 작업공간에서 찾지 못함', value.unmatched], ['본문 불일치·확인 불가', value.stale], ['대상을 구분하지 못함', value.ambiguous]]) {
        list.append(node('dt', label), node('dd', Number(amount || 0).toLocaleString('ko-KR') + '개'));
      }
      target.append(list);
      target.append(node('p', '다른 작업공간의 자료인지는 확인하지 않습니다. 같은 경로의 원문이 여러 저장소에 있으면 자동으로 고르지 않습니다.', 'sc-help'));
    }
    function draw() {
      if (!content || !panel?.isConnected) return;
      const open = panel.open;
      content.replaceChildren();
      const status = node('p', null, 'sc-status'); status.id = 'sourceClassificationStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      const failure = node('p', null, 'sc-error'); failure.id = 'sourceClassificationError'; failure.setAttribute('role', 'alert');
      content.append(status, failure);
      const fields = node('fieldset', null, 'sc-controls'); fields.append(node('legend', '분류 파일 검토', 'life-sr-only'));
      fields.append(node('p', '분류 파일을 검토한 뒤 이 브라우저의 현재 작업공간에만 적용합니다. 원문·기존 출처·동기화·공개 내용은 바꾸지 않습니다.', 'sc-help'));
      const label = node('label', null, 'sc-file'); label.append(node('span', '분류 파일 불러오기'));
      const input = node('input'); input.id = 'sourceClassificationFile'; input.type = 'file'; input.accept = '.json,application/json';
      input.addEventListener('change', event => { const file = event.target.files?.[0]; if (file) prepare(file); });
      label.append(input); fields.append(label);
      if (stage) {
        const preview = node('section', null, 'sc-preview'); preview.id = 'sourceClassificationPreview';
        preview.append(node('h3', '적용 전 검토')); statistics(preview, stage.projection);
        preview.append(node('p', saved?.manifest ? '적용하면 이 작업공간의 기존 분류표를 바꿉니다. 원문은 그대로 유지합니다.' : '본문이 정확히 일치한 원문 버전에만 분류 후보를 표시합니다.', 'sc-help'));
        const apply = button('이 브라우저에 적용', 'sourceClassificationApply', applyStage, true);
        apply.disabled = !saved || needsLatest || !stage.projection.matched;
        preview.append(apply, button('검토 취소', 'sourceClassificationCancel', () => { stage = null; error = ''; message = '파일 검토를 취소했습니다. 기존 분류는 유지했습니다.'; draw(); }));
        fields.append(preview);
      }
      const actions = node('div', null, 'sc-actions');
      actions.append(button(needsLatest ? '최신 분류 확인' : '분류 다시 확인', 'sourceClassificationRefresh', () => refresh({ keepStage: true, explicit: true })));
      if (saved?.manifest) {
        const exportButton = button('분류 파일 내려받기', 'sourceClassificationExport', exportManifest);
        exportButton.disabled = needsLatest;
        actions.append(exportButton, button('이 브라우저의 분류 지우기', 'sourceClassificationClear', () => { clearRequested = true; draw(); }));
      }
      fields.append(actions);
      if (saved?.manifest && !stage) {
        fields.append(node('p', validProjection() ? '연결된 원문 버전 ' + projection.byVersion.size.toLocaleString('ko-KR') + '개 · 분류는 자동 1차 후보이며 원저자는 확정하지 않습니다.' : '저장한 분류를 현재 원문과 대조해야 합니다.', 'sc-help'));
      } else if (!saved?.manifest && !stage && !busy) fields.append(node('p', '이 작업공간에 적용한 분류가 없습니다.', 'sc-help'));
      if (clearRequested) {
        const confirm = node('div', null, 'sc-confirm');
        confirm.append(node('p', '이 브라우저에 적용한 분류표만 지웁니다. 원문과 내려받은 분류 파일은 남습니다.', 'sc-help'));
        confirm.append(button('분류표만 지우기', 'sourceClassificationClearConfirm', clearManifest), button('취소', 'sourceClassificationClearCancel', () => { clearRequested = false; draw(); }));
        fields.append(confirm);
      }
      content.append(fields); panel.open = open; feedback();
    }
    function mount(container) {
      if (!enter()) return;
      if (panelHost === container && panel?.isConnected) { draw(); return; }
      stage = null; clearRequested = false;
      if (panel) rememberedOpen = panel.open;
      panelHost = container;
      panel = node('details', null, 'sc-panel'); panel.id = 'sourceClassification';
      const mountedPanel = panel;
      panel.open = rememberedOpen;
      panel.addEventListener('toggle', () => {
        if (panel === mountedPanel && inScope()) rememberedOpen = mountedPanel.open;
      });
      panel.append(node('summary', '분류'));
      content = node('div', null, 'sc-panel-content'); panel.append(content);
      container.replaceChildren(panel); draw();
    }
    function drawFilters() {
      if (!filterHost?.isConnected) return;
      const available = validProjection() ? [...projection.byVersion.values()] : [];
      const visible = !!saved?.manifest || Object.values(filters).some(Boolean);
      filterHost.hidden = !visible;
      filterHost.replaceChildren();
      const choices = { source: new Map(), topic: new Map(), kind: new Map() };
      const taxonomy = new Map((saved?.manifest?.taxonomy || []).map(row => [row.id, row.label]));
      for (const record of available) {
        choices.source.set(record.source.id, record.source.label); choices.kind.set(record.kind.id, record.kind.label);
        for (const id of record.topicIds) choices.topic.set(id, taxonomy.get(id) || '주제 후보');
      }
      const group = node('div', null, 'sc-filters'); group.setAttribute('aria-label', '자료 분류 필터');
      for (const [key, label] of [['source', '분류 출처'], ['topic', '주제 후보'], ['kind', '자료 유형'], ['review', '분류 확인']]) {
        const wrap = node('label', null, 'sc-filter'); wrap.append(node('span', label));
        const select = node('select'); select.id = 'sourceClassification' + key[0].toUpperCase() + key.slice(1);
        const all = node('option', '전체'); all.value = ''; select.append(all);
        const values = key === 'review' ? [['needs_review', '확인 필요'], ['unclassified', '주제 미확정'], ['unlinked', '미연결']] : [...choices[key]].sort((a, b) => a[1].localeCompare(b[1], 'ko'));
        if (filters[key] && !values.some(([value]) => value === filters[key])) values.push([filters[key], '이전 선택 (현재 자료 없음)']);
        for (const [value, text] of values) { const option = node('option', text); option.value = value; select.append(option); }
        select.value = filters[key]; select.disabled = busy || !ready;
        select.addEventListener('change', () => { filters[key] = select.value; if (inScope()) { (filterCallback || onChange)(); } });
        wrap.append(select); group.append(wrap);
      }
      filterHost.append(group);
      if (needsLatest) filterHost.append(node('p', '분류가 바뀌었습니다. 최신 분류 확인 전까지 분류 조건을 목록에 적용하지 않습니다.', 'sc-help'));
    }
    function mountFilters(container, change) {
      if (!enter()) return;
      filterHost = container; filterCallback = typeof change === 'function' ? change : null; drawFilters();
    }
    async function refresh(options = {}) {
      if (!enter()) return null;
      const bundle = getBundle(), nextRevision = bundle.revision;
      if (pending && loadingRevision === nextRevision && !options.explicit) return pending;
      if (!options.explicit && saved && validProjection() && !needsLatest) return projection;
      const retained = options.keepStage ? stage : null;
      if (!options.keepStage) stage = null;
      const token = ++sequence;
      busy = true; error = ''; invalidate(); loadingRevision = nextRevision; draw(); drawFilters();
      const job = (async () => {
        try {
          const loaded = await storage.readSourceClassification(workspaceId);
          if (!current(token)) return null;
          const verified = loaded.manifest ? await model().project(bundle, loaded.manifest) : emptyProjection();
          if (!current(token) || getBundle().revision !== nextRevision) return null;
          let reviewed = null;
          if (retained) {
            reviewed = await model().project(bundle, retained.manifest);
            if (!current(token) || getBundle().revision !== nextRevision) return null;
          }
          saved = loaded;
          if (observedRevision > loaded.revision) { reconcileLatest(); return null; }
          projection = verified; projectedRevision = nextRevision; ready = true;
          stage = retained ? { manifest: retained.manifest, projection: reviewed, revision: nextRevision } : null;
          needsLatest = false;
          if (options.explicit) message = retained ? '최신 분류를 확인했습니다. 미리보기를 확인한 뒤 적용해 주세요.' : '현재 작업공간의 분류를 확인했습니다.';
          return projection;
        } catch (cause) { if (current(token)) { error = explain(cause); invalidate(); } return null; }
        finally {
          if (current(token)) {
            reconcileLatest();
            busy = false; pending = null; loadingRevision = null; draw(); drawFilters(); notify();
          }
        }
      })();
      pending = job; return job;
    }
    async function prepare(file) {
      if (!enter() || busy) return;
      const bundle = getBundle(), bundleRevision = bundle.revision, token = ++sequence;
      stage = null; clearRequested = false; busy = true; error = message = ''; draw(); drawFilters();
      try {
        if (file.size > model().MAX_BYTES) throw { code: 'source_classification_too_large' };
        const manifest = model().parse(await file.text());
        if (!current(token) || getBundle().revision !== bundleRevision) return;
        const checked = await model().project(bundle, manifest);
        if (!current(token) || getBundle().revision !== bundleRevision) return;
        stage = { manifest, projection: checked, revision: bundleRevision };
        message = checked.matched ? '원문을 대조했습니다. 적용 전 검토를 확인해 주세요.' : '현재 작업공간에서 연결할 수 있는 원문이 없습니다. 파일과 작업공간을 확인해 주세요.';
      } catch (cause) { if (current(token)) error = explain(cause); }
      finally { if (current(token)) { const invalidated = reconcileLatest(); busy = false; draw(); drawFilters(); if (invalidated) notify(); } }
    }
    async function applyStage() {
      if (!stage || !saved || busy || needsLatest || !inScope()) return;
      const token = ++sequence, candidate = stage, bundle = getBundle(), bundleRevision = bundle.revision;
      let stored = false, applied = false;
      busy = true; error = message = ''; draw(); drawFilters();
      try {
        const checked = await model().project(bundle, candidate.manifest);
        if (!current(token) || getBundle().revision !== bundleRevision) return;
        if (candidate.revision !== bundleRevision || !checked.matched) {
          stage = { ...candidate, projection: checked, revision: bundleRevision };
          message = checked.matched ? '원문 목록이 바뀌어 다시 대조했습니다. 미리보기를 확인한 뒤 적용해 주세요.' : '현재 원문과 연결할 수 없어 적용하지 않았습니다.'; return;
        }
        const result = await storage.saveSourceClassification(workspaceId, candidate.manifest, saved.revision);
        if (!current(token)) return;
        if (result.status !== 'stored') {
          saved = result.state; needsLatest = true; invalidate();
          error = '다른 탭에서 분류를 변경해 적용하지 않았습니다. 검토한 파일은 유지했습니다. 최신 분류를 확인한 뒤 다시 적용해 주세요.';
          return;
        }
        stored = true; saved = result.state; stage = null; invalidate();
        const actual = result.state.manifest ? await model().project(getBundle(), result.state.manifest) : emptyProjection();
        if (!current(token) || getBundle().revision !== bundleRevision) return;
        if (observedRevision > result.state.revision) { reconcileLatest(); return; }
        projection = actual; projectedRevision = bundleRevision; ready = true; needsLatest = false; applied = true;
        stage = null; message = '이 브라우저의 현재 작업공간에 분류를 적용했습니다.';
      } catch (cause) {
        if (current(token)) error = stored ? '분류 파일은 이 브라우저에 저장했지만 원문 대조를 완료하지 못했습니다. 분류 다시 확인을 눌러 주세요.' : explain(cause);
      }
      finally {
        if (current(token)) {
          reconcileLatest(); busy = false; draw(); drawFilters(); notify();
          if (applied && !needsLatest && !error) root.HaedoMotion?.feedback(content?.querySelector('#sourceClassificationStatus'));
        }
      }
    }
    async function clearManifest() {
      if (!saved || busy || !inScope()) return;
      const token = ++sequence; busy = true; error = message = ''; draw(); drawFilters();
      try {
        const result = await storage.clearSourceClassification(workspaceId, saved.revision);
        if (!current(token)) return;
        if (result.status !== 'stored') {
          saved = result.state; needsLatest = true; invalidate();
          error = '다른 탭에서 분류를 변경해 지우지 않았습니다. 최신 분류를 확인해 주세요.'; return;
        }
        saved = result.state; projection = emptyProjection(); projectedRevision = revision(); ready = true;
        stage = null; needsLatest = false; clearRequested = false; filters = initialFilters();
        message = '이 브라우저의 분류표만 지웠습니다. 원문은 유지했습니다.';
      } catch (cause) { if (current(token)) error = explain(cause); }
      finally { if (current(token)) { reconcileLatest(); busy = false; draw(); drawFilters(); notify(); } }
    }
    function exportManifest() {
      if (!saved?.manifest || needsLatest || !inScope()) return;
      try {
        const clean = model().validate(saved.manifest);
        const blob = new root.Blob([JSON.stringify(clean, null, 2) + '\n'], { type: 'application/json' });
        const url = root.URL.createObjectURL(blob); urls.add(url);
        const anchor = node('a'); anchor.href = url; anchor.download = 'source-classification.json';
        root.document.body.append(anchor); anchor.click(); anchor.remove();
        root.setTimeout(() => { root.URL.revokeObjectURL(url); urls.delete(url); }, 1000);
        message = '분류 파일 다운로드를 요청했습니다.'; error = ''; feedback();
      } catch (cause) { error = explain(cause); feedback(); }
    }
    function metadata(versionId) {
      if (!validProjection()) return null;
      const record = projection.byVersion.get(versionId);
      if (record) {
        const taxonomy = new Map((saved?.manifest?.taxonomy || []).map(row => [row.id, row.label]));
        return { ...record, status: 'matched', topicLabels: record.topicIds.map(id => taxonomy.get(id) || '주제 후보'),
          reviewReasonLabels: [...new Set(record.reviewReasons.map(reason => reviewLabels[reason] || '분류 검토 필요'))] };
      }
      if (projection.staleVersionIds.has(versionId)) return { status: 'changed', topicLabels: [], reviewReasonLabels: ['현재 본문과 분류 기준을 맞출 수 없습니다.'] };
      return null;
    }
    function matches(versionId) {
      if (!Object.values(filters).some(Boolean) || !validProjection()) return true;
      const record = projection.byVersion.get(versionId);
      if (filters.source && record?.source.id !== filters.source || filters.kind && record?.kind.id !== filters.kind || filters.topic && !record?.topicIds.includes(filters.topic)) return false;
      if (filters.review === 'needs_review' && !record?.reviewReasons.length) return false;
      if (filters.review === 'unclassified' && (!record?.isContent || record.topicIds.length && record.primaryTopic !== 'unclassified')) return false;
      if (filters.review === 'unlinked' && record) return false;
      return true;
    }
    const getFilterState = () => ({ ...filters });
    return Object.freeze({ mount, refresh, mountFilters, getFilterState, filters: getFilterState, matches, metadata,
      projected: () => validProjection() ? new Map(projection.byVersion) : new Map(), cancelStage, leave, reset, dispose });
  }
  root.HaedoLife.SourceClassificationUI = Object.freeze({ create });
})(globalThis);
