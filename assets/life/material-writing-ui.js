/* Private writing preparation; the existing PhotoPost editor owns the finished draft. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  function create({ storage, workspaceId, getBundle = () => storage.read(workspaceId), isCurrent = () => true, onDirty = () => {}, onOpenSource, onOpenPost, onClose, onPlanChange = () => {}, onCreatePost }) {
    const M = life.MaterialWriting, fresh = () => life.Core.id(), clone = value => structuredClone(value);
    let state = null, selected = null, host = null, surface = null, status = null, error = null, selector = null, blocks = null, copies = null, output = null;
    let sources = null, sourcesTask = null, sourceLoading = false, sourceView = null, sourcePlanId = null, view = null;
    let tick = 0, stored = 0, saving = null, failure = null, timer = null, epoch = 0, disposed = false, acting = false, navigating = false, review = null;
    const composing = new Set(), pendingFields = new Set();
    const valid = token => !disposed && isCurrent() && (token == null || epoch === token);
    const mounted = token => valid(token) && !!host?.isConnected;
    const plan = () => state?.plans.find(value => value.id === selected);
    const conflict = () => /conflict/.test(failure?.code || '');
    const fault = (code, message) => Object.assign(new Error(message), { code });
    const stamp = value => { value.updatedAt = [value.createdAt, new Date().toISOString()].sort().at(-1); };
    function dirty() { return acting || sourceLoading || !!saving || tick !== stored || composing.size > 0 || pendingFields.size > 0 || !!sources?.pending(); }
    function message() {
      if (!mounted() || !status) return;
      status.textContent = failure ? '저장하지 못함 · 입력 유지' : pendingFields.size ? '입력 확인 필요 · 입력 유지' : sourceLoading ? '자료를 불러오는 중…' : sources?.pending() ? '자료의 구절·입력을 마치거나 취소해 주세요.' : composing.size ? '입력 중' : saving ? '이 브라우저에 저장 중…' : tick !== stored ? '저장 전 변경 있음' : '이 브라우저에 비공개로 저장됨';
      status.dataset.state = failure ? 'error' : dirty() ? 'dirty' : 'saved';
      for (const id of ['mwContinue', 'mwCreate', 'mwPreview']) {
        const control = surface.querySelector('#' + id); if (control) control.disabled = sourceLoading || acting;
      }
      const recovery = surface.querySelector('.mw-recovery');
      if (recovery) { recovery.hidden = !failure; recovery.querySelector('#mwRecover').hidden = !conflict(); }
      onDirty();
    }
    const transient = cause => ['material_source_pending', 'material_input_in_progress', 'material_input_pending', 'material_busy'].includes(cause?.code);
    function report(cause) {
      // A temporary movement guard must not replace a real save/CAS failure.
      if (!transient(cause) || !failure || transient(failure)) failure = cause;
      if (mounted() && error) { error.textContent = [failure.message, failure !== cause ? cause.message : ''].filter(Boolean).join(' ') || '저장하지 못했습니다. 현재 입력을 유지했으니 다시 시도해 주세요.'; error.hidden = false; }
      message();
    }
    function clear() { failure = null; if (error) { error.hidden = true; error.textContent = ''; } message(); }
    function clearReview() { review = null; surface?.querySelector('.mw-preview')?.remove(); }
    function guardLocal() {
      if (!valid()) throw fault('material_scope_changed', '계정이나 작업공간이 바뀌었습니다. 현재 공간에서 다시 열어 주세요.');
      if (composing.size) throw fault('material_input_in_progress', '한글 입력을 마친 뒤 다시 시도해 주세요.');
      if (pendingFields.size) throw fault('material_input_pending', '입력은 남아 있습니다. 문자와 전체 글 길이를 확인한 뒤 다시 시도해 주세요.');
    }
    function guard() {
      guardLocal(); if (sourceLoading || sources?.pending()) throw fault('material_source_pending', '자료의 구절·메모 입력을 마치거나 취소한 뒤 이동해 주세요.');
      if (transient(failure)) clear();
    }
    function mark() {
      tick++; clearReview(); clearTimeout(timer); message();
      schedule();
    }
    function schedule() { clearTimeout(timer); if (!conflict() && tick !== stored) timer = setTimeout(() => { if (mounted() && !acting && !sourceLoading && !composing.size && !pendingFields.size && !sources?.pending()) flushInternal().catch(report); }, 450); }
    async function flushInternal() {
      guard(); clearTimeout(timer); timer = null;
      if (saving) { await saving; return flushInternal(); }
      if (!state || tick === stored) return;
      if (conflict()) throw failure;
      const payload = clone(state), version = tick, token = epoch;
      const task = Promise.resolve().then(async () => {
        try { const saved = await storage.saveMaterialWriting(workspaceId, payload, payload.revision); if (!valid(token)) return; state.revision = saved.revision; stored = version; clear(); }
        catch (cause) { if (valid(token)) report(cause); throw cause; }
        finally { if (saving === task) saving = null; message(); }
      }); saving = task; message(); await task;
      if (valid(token) && tick !== stored) return flushInternal();
    }
    async function flush() { if (acting) throw fault('material_busy', '처리 결과를 확인한 뒤 이동해 주세요.'); return flushInternal(); }
    function button(label, task, { id, name, primary = false } = {}) {
      const node = el('button', label, 'life-button' + (primary ? ' life-primary' : '')); node.type = 'button'; if (id) node.id = id; if (name) node.setAttribute('aria-label', name);
      node.addEventListener('click', async () => {
        if (!mounted() || !node.isConnected || acting || navigating || node.disabled) return;
        const token = epoch; acting = true; node.disabled = true;
        try { await task(); } catch (cause) { if (mounted(token)) report(cause); }
        finally { acting = false; if (node.isConnected) node.disabled = false; message(); if (mounted(token) && tick !== stored && !failure && !saving && !sourceLoading && !sources?.pending() && !composing.size && !pendingFields.size) flushInternal().catch(report); }
      }); return node;
    }
    function field(label, owner, key, { id, multiline = true, max = 50000 } = {}) {
      const wrapper = el('label', null, 'life-field'), input = el(multiline ? 'textarea' : 'input');
      wrapper.append(el('span', label), input); input.value = owner[key]; input.id = id; input.maxLength = max; input.setAttribute('aria-label', label); if (multiline) input.rows = 3; else input.type = 'text';
      const activePlan = plan();
      function apply() {
        if (!mounted() || plan() !== activePlan || composing.has(input)) return;
        const previous = owner[key]; owner[key] = input.value;
        try { M.validate(state); pendingFields.delete(input); stamp(activePlan); mark(); if (key === 'title') updateSelector(); if (failure?.code === 'invalid_material_writing' && !pendingFields.size) clear(); }
        catch (cause) { owner[key] = previous; pendingFields.add(input); clearReview(); report(cause); }
      }
      input.addEventListener('compositionstart', () => { composing.add(input); clearReview(); clearTimeout(timer); message(); });
      input.addEventListener('compositionend', () => { composing.delete(input); apply(); message(); }); input.addEventListener('input', apply); return wrapper;
    }
    function updateSelector() {
      if (!selector) return; selector.replaceChildren();
      for (const value of state.plans) { const option = el('option', value.title || '제목 없는 작성 준비'); option.value = value.id; selector.append(option); }
      selector.value = selected || ''; selector.hidden = !state.plans.length;
    }
    function appendBlock(block, { fromSource = false } = {}) {
      fromSource ? guardLocal() : guard(); if (conflict()) throw failure;
      const owner = plan(); if (!owner) throw new Error('작성 준비를 먼저 만들어 주세요.'); owner.blocks.push(block);
      try { M.validate(state); } catch (cause) { owner.blocks.pop(); throw cause; }
      stamp(owner); mark(); renderBlocks();
      surface.querySelector('#mwBlock_' + block.id)?.focus({ preventScroll: true });
    }
    function renderBlocks(focusId, action) {
      blocks.replaceChildren(); const owner = plan();
      if (!owner.blocks.length) blocks.append(el('li', '글에 쓸 소제목·문단을 적거나 자료에서 구절을 채택하세요.', 'life-help'));
      owner.blocks.forEach((block, index) => {
        const row = el('li', null, 'mw-block'); row.dataset.blockId = block.id; row.dataset.kind = block.kind;
        if (block.kind === 'quote') {
          row.append(el('p', `${index + 1}. 채택한 인용`, 'life-meta'), el('blockquote', block.reference.quote, 'life-quote'), el('p', block.reference.title, 'life-meta'));
          if (block.reference.url) row.append(el('p', block.reference.url, 'life-meta'));
          row.append(el('p', '인용은 직접 고른 구절입니다. 바꾸려면 자료에서 다시 선택해 주세요.', 'life-help'));
        } else row.append(field(`${block.kind === 'heading' ? '소제목' : '문단'} ${index + 1}`, block, 'text', { id: 'mwBlock_' + block.id }));
        const actions = el('div', null, 'life-actions mw-block-actions');
        for (const [label, direction, key] of [['위로', -1, 'up'], ['아래로', 1, 'down']]) {
          const move = button(label, () => {
            guard(); if (conflict()) throw failure;
            const at = owner.blocks.findIndex(value => value.id === block.id), to = at + direction; if (at < 0 || to < 0 || to >= owner.blocks.length) return;
            [owner.blocks[at], owner.blocks[to]] = [owner.blocks[to], owner.blocks[at]]; stamp(owner); mark(); renderBlocks(block.id, key);
          }, { name: `${index + 1}번 블록 ${label}` }); move.dataset.action = key; move.disabled = direction < 0 ? index === 0 : index === owner.blocks.length - 1; actions.append(move);
        }
        const remove = button('블록 삭제', async () => {
          guard(); if (conflict()) throw failure; owner.blocks.splice(owner.blocks.findIndex(value => value.id === block.id), 1); stamp(owner); mark(); renderBlocks(); await sources?.refresh();
          blocks.querySelector('button')?.focus({ preventScroll: true });
        }, { name: `${index + 1}번 블록 삭제` }); remove.dataset.action = 'remove'; actions.append(remove); row.append(actions); blocks.append(row);
      });
      if (focusId) { const row = [...blocks.children].find(value => value.dataset.blockId === focusId), wanted = row?.querySelector(`[data-action="${action}"]`); (wanted && !wanted.disabled ? wanted : row?.querySelector('[data-action="remove"]'))?.focus({ preventScroll: true }); }
    }
    function renderCopies() {
      copies.replaceChildren(); const owner = plan();
      for (const [index, material] of owner.materials.entries()) {
        const copy = button('자료 메모를 문단으로 복사', () => {
          guard(); const value = owner.materials.find(item => item.id === material.id);
          if (!value?.note.trim()) throw new Error('자료 메모를 먼저 적어 주세요. 질문과 메모는 자동으로 글에 들어가지 않습니다.');
          appendBlock({ id: fresh(), kind: 'paragraph', text: value.note });
        }, { name: `${index + 1}번 자료 메모를 문단으로 복사` }); copies.append(copy);
      }
    }
    async function navigate(callback, context) {
      const previousAction = acting; acting = true;
      try {
        await flushInternal(); guard(); if (!mounted()) return;
        rememberView(); acting = false; navigating = true; message();
        return await callback(context);
      } finally { navigating = false; acting = previousAction; }
    }
    function renderOutput() {
      output.replaceChildren(); const owner = plan(); if (!owner?.output) return;
      output.append(el('p', '이미 글 초안으로 보관했습니다. 준비의 변경은 그 글을 덮지 않습니다. 같은 글을 이어 쓰거나 새 준비 사본으로 시작할 수 있습니다.', 'life-help'),
        button('이어서 쓰기', () => openPost(false), { id: 'mwContinue', primary: true }));
    }
    async function openPost(createNew) {
      guard(); const owner = plan(); if (!owner) return;
      let accepted = null;
      if (createNew) {
        accepted = review; const checked = surface.querySelector('#mwConsent')?.checked; clearReview();
        if (!accepted || !checked || accepted.planId !== owner.id || accepted.tick !== tick) throw new Error('전체 글 미리보기를 확인하고 초안 만들기에 동의해 주세요.');
      }
      await flushInternal(); guard(); if (!mounted()) return;
      if (accepted && accepted.tick !== tick) throw new Error('검토한 준비가 바뀌었습니다. 전체 글 미리보기를 다시 확인해 주세요.');
      const token = epoch, version = tick, baseline = JSON.stringify({ ...owner, output: null }), baseRevision = state.revision;
      let result = typeof onCreatePost === 'function'
        ? await onCreatePost({ workspaceId, planId: owner.id, expectedRevision: baseRevision })
        : await storage.createMaterialWritingPost(workspaceId, owner.id, baseRevision);
      if (!mounted(token) || plan() !== owner) return;
      owner.output = { postId: result.postId }; stored = version; clearReview(); renderOutput();
      // A newly created output changes only this plan's receipt. A resume may
      // return a newer wrapper after another tab edited a different plan.
      if (result.created && result.planRevision === baseRevision + 1) state.revision = result.planRevision;
      let latest;
      try { latest = await storage.readMaterialWriting(workspaceId); }
      catch (cause) { throw Object.assign(new Error('글 초안은 이미 보관했습니다. 준비 목록 조회에 실패했으니 이어서 쓰기로 같은 글을 다시 확인해 주세요.'), { cause }); }
      if (!mounted(token) || plan() !== owner) return;
      M.validate(latest); const persisted = latest.plans.find(value => value.id === owner.id);
      if (!persisted?.output || JSON.stringify({ ...persisted, output: null }) !== baseline) throw fault('material_writing_conflict', '글 초안은 보관했습니다. 다른 탭에서 준비가 바뀌어 현재 입력은 유지했습니다. 내 변경을 새 준비 사본으로 보관해 주세요.');
      owner.output = clone(persisted.output); state = { ...clone(latest), plans: latest.plans.map(value => value.id === owner.id ? owner : clone(value)) }; clear(); renderOutput();
      if (version !== tick || composing.size || pendingFields.size || sources?.pending()) {
        status.textContent = '글 초안은 보관했습니다. 그동안의 입력은 이 화면에 남아 있습니다. 입력을 마친 뒤 이어서 쓰기를 눌러 주세요.'; return;
      }
      if (typeof onOpenPost !== 'function') throw new Error('글 초안은 보관했습니다. 기존 작성기를 열 수 없으니 글 목록에서 다시 열어 주세요.');
      if (owner.output.postId !== result.postId) { const current = await storage.readPhotoPost(workspaceId, owner.output.postId); if (!mounted(token)) return; result = { ...result, postId: current.id, revision: current.revision }; }
      try { await navigate(onOpenPost, { postId: result.postId, revision: result.revision, planId: owner.id }); }
      catch (cause) { throw Object.assign(new Error('글 초안은 이미 보관했습니다. 이어서 쓰기로 같은 글을 다시 열어 주세요.'), { cause }); }
    }
    async function prepare() {
      clearReview(); await flushInternal(); guard(); if (!mounted()) return;
      const owner = plan(); if (!owner) return; const projected = M.project(state, owner.id, fresh);
      const section = el('section', null, 'mw-preview'); section.setAttribute('aria-label', '완성할 글 미리보기'); section.id = 'mwPreviewContent';
      section.append(el('h3', projected.doc.title || '제목 없는 글'), el('div', life.PhotoPost.plainText(projected.doc), 'mw-preview-text'),
        el('p', '위 본문과 채택한 인용·출처만 초안에 담습니다. 비공개 질문·자료 메모·미채택 자료의 본문은 담지 않습니다.', 'life-help'));
      review = { planId: owner.id, tick };
      if (!owner.output) {
        const label = el('label', null, 'blog-manager-check'), consent = el('input'); consent.type = 'checkbox'; consent.id = 'mwConsent'; consent.setAttribute('aria-label', '검토한 내용으로 글 초안을 만듭니다');
        label.append(consent, document.createTextNode('검토한 내용으로 새 비공개 글 초안을 만듭니다.')); section.append(label, button('이 내용으로 글쓰기', () => openPost(true), { id: 'mwCreate', primary: true }));
      } else section.append(el('p', '이 미리보기는 현재 준비입니다. 이미 만든 글에는 자동으로 반영되지 않습니다.', 'life-help'));
      surface.append(section);
    }
    function copyPlan(value) {
      const copy = clone(value), materialIds = new Map(); copy.id = fresh(); copy.output = null; copy.createdAt = copy.updatedAt = new Date().toISOString();
      for (const item of copy.materials) { const previous = item.id; item.id = fresh(); materialIds.set(previous, item.id); }
      for (const block of copy.blocks) { block.id = fresh(); if (block.kind === 'quote') block.materialId = materialIds.get(block.materialId); }
      return copy;
    }
    async function recover() {
      guard(); if (saving) await saving; const owner = plan(); if (!owner) return;
      const token = epoch, version = tick, local = clone(owner), latest = await storage.readMaterialWriting(workspaceId);
      if (!mounted(token)) return; guard(); if (tick !== version || plan() !== owner) throw new Error('입력이 바뀌었습니다. 현재 변경을 확인한 뒤 다시 보관해 주세요.');
      const copy = copyPlan(local); latest.plans.push(copy); M.validate(latest); const saved = await storage.saveMaterialWriting(workspaceId, latest, latest.revision);
      if (!mounted(token)) return;
      if (tick !== version || composing.size || pendingFields.size || sources?.pending()) { state.revision = saved.revision; throw fault('material_writing_conflict', '준비 사본은 보관했습니다. 그동안의 입력도 이 화면에 유지했습니다. 입력을 마친 뒤 현재 변경을 다시 보관해 주세요.'); }
      state = clone(saved); selected = copy.id; stored = tick; sourceView = null; clear(); await render();
    }
    function attachSources(target) {
      const token = epoch, owner = plan(), active = () => mounted(token) && plan()?.id === owner.id && target.isConnected;
      sourcePlanId = owner.id;
      sources = life.MaterialWritingSources.create({ host: target, view: sourceView, getBundle, getPlan: () => owner, isCurrent: active,
        onPendingChange: pending => { if (active()) { message(); if (!pending) schedule(); } },
        onAdd: async material => {
          guardLocal(); if (conflict()) throw failure; owner.materials.push(clone(material));
          try { M.validate(state); } catch (cause) { owner.materials.pop(); throw cause; }
          stamp(owner); mark(); renderCopies();
        },
        onRemove: materialId => {
          guardLocal(); if (conflict()) throw failure;
          if (owner.blocks.some(block => block.kind === 'quote' && block.materialId === materialId)) throw new Error('이 자료의 채택한 인용을 먼저 개요에서 빼 주세요. 기존 인용과 자료는 유지했습니다.');
          owner.materials = owner.materials.filter(material => material.id !== materialId); stamp(owner); mark(); renderCopies();
        },
        onNote: (materialId, text) => {
          guardLocal(); if (conflict()) throw failure;
          const material = owner.materials.find(value => value.id === materialId); if (!material) throw new Error('메모할 자료가 바뀌었습니다.');
          const old = material.note; material.note = text;
          try { M.validate(state); } catch (cause) { material.note = old; throw cause; }
          stamp(owner); mark();
        },
        onQuote: (materialId, reference) => appendBlock({ id: fresh(), kind: 'quote', materialId, reference: clone(reference) }, { fromSource: true }),
        onOpenSource: async context => {
          if (!active()) return; if (typeof onOpenSource !== 'function') throw new Error('원문 열기를 연결하지 못했습니다. 준비와 구절은 유지했습니다.');
          await navigate(onOpenSource, { ...context, planId: owner.id });
        } });
      sourceLoading = true; message();
      sourcesTask = Promise.resolve().then(() => sources.mount()).finally(() => { if (active()) { sourceLoading = false; message(); } }); return sourcesTask;
    }
    async function render() {
      if (!mounted()) return;
      clearReview(); if (sources) { sourceView = sourcePlanId === selected ? sources.getView?.() || sourceView : null; sources.dispose(); sources = null; }
      surface.replaceChildren(); composing.clear(); pendingFields.clear();
      onPlanChange({ planId: selected });
      const toolbar = el('div', null, 'life-actions mw-toolbar'); selector = el('select'); selector.id = 'mwPlanSelect'; selector.setAttribute('aria-label', '작성 준비 선택');
      selector.addEventListener('change', async () => {
        const next = selector.value; try { await flush(); if (!mounted()) return; selected = next; sourceView = null; view = null; clear(); await render(); } catch (cause) { selector.value = selected || ''; report(cause); }
      });
      toolbar.append(selector, button('새 작성 준비', async () => {
        await flushInternal(); guard(); const value = M.create(fresh); state.plans.push(value);
        try { M.validate(state); } catch (cause) { state.plans.pop(); throw cause; }
        selected = value.id; sourceView = null; view = null; mark(); await render(); surface.querySelector('#mwTitle')?.focus();
      }, { id: 'mwNew' }));
      if (typeof onClose === 'function') toolbar.append(button('돌아가기', () => navigate(onClose), { id: 'mwClose' }));
      status = el('p', '', 'life-meta mw-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      error = el('p', '', 'life-error mw-error'); error.setAttribute('role', 'alert'); error.hidden = true;
      const recovery = el('div', null, 'life-actions mw-recovery'); recovery.append(button('다시 저장', async () => { await flushInternal(); clear(); }, { id: 'mwRetry' }), button('내 변경을 새 준비 사본으로 보관', recover, { id: 'mwRecover' }));
      surface.append(toolbar, status, error, recovery); updateSelector(); const owner = plan(); if (!owner) { surface.append(el('p', '새 작성 준비에 자료와 내 생각을 모아 한 편의 글로 이어 써 보세요.', 'life-help')); message(); return; }
      surface.append(field('글 제목', owner, 'title', { id: 'mwTitle', max: 500, multiline: false }), field('비공개 질문', owner, 'question', { id: 'mwQuestion' }),
        el('p', '질문과 자료 메모는 준비에만 보관합니다. 글에 넣을 생각은 아래 문단에 쓰거나 자료 메모를 명시적으로 복사해 주세요.', 'life-help'));
      output = el('section', null, 'mw-output'); surface.append(output); renderOutput();
      const target = el('section', null, 'mw-sources'); target.id = 'mwSources'; surface.append(target); copies = el('div', null, 'life-actions mw-note-copies'); surface.append(copies); renderCopies();
      surface.append(el('h3', '글에 담을 내용')); blocks = el('ol', null, 'mw-blocks'); blocks.id = 'mwBlocks'; blocks.setAttribute('aria-label', '글 개요'); surface.append(blocks); renderBlocks();
      const actions = el('div', null, 'life-actions mw-actions'); actions.append(button('소제목 추가', () => appendBlock({ id: fresh(), kind: 'heading', text: '' }), { id: 'mwAddHeading' }), button('문단 추가', () => appendBlock({ id: fresh(), kind: 'paragraph', text: '' }), { id: 'mwAddParagraph' }), button('글 미리보기', prepare, { id: 'mwPreview', primary: true })); surface.append(actions);
      surface.append(button('새 준비 사본 만들기', async () => {
        await flushInternal(); guard(); const copy = copyPlan(plan()); state.plans.push(copy);
        try { M.validate(state); } catch (cause) { state.plans.pop(); throw cause; }
        selected = copy.id; sourceView = null; view = null; mark(); await render();
      }, { id: 'mwCopy' }));
      if (failure) report(failure); else message(); await attachSources(target);
    }
    function rememberView() {
      if (!surface) return; sourceView = sources?.getView?.() || sourceView;
      const input = document.activeElement;
      if (!surface.contains(input)) return;
      view = { planId: selected, id: input.id || null, focusKey: input.dataset?.focusKey || null,
        start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection, y: root.scrollY || 0 };
    }
    function restoreView() {
      if (!mounted() || view?.planId !== selected) return;
      const keyed = view.focusKey && [...surface.querySelectorAll('button')].find(node => node.dataset.focusKey === view.focusKey);
      const input = keyed || (view.id && document.getElementById(view.id)) || surface.querySelector(plan()?.output ? '#mwContinue' : '#mwTitle');
      if (input && surface.contains(input)) { input.focus({ preventScroll: true }); if (typeof view.start === 'number' && input.setSelectionRange) input.setSelectionRange(view.start, view.end, view.direction); }
      root.scrollTo?.({ top: view.y, behavior: 'instant' });
    }
    async function mount(target, { planId = null } = {}) {
      if (disposed) throw new Error('종료한 작성 준비 화면입니다.'); if (host && dirty()) await flush();
      host = target; const token = ++epoch; surface = el('section', null, 'mw-workspace'); surface.setAttribute('aria-label', '자료로 글쓰기'); host.replaceChildren(surface); surface.append(el('p', '작성 준비를 불러오는 중…', 'life-help'));
      try {
        if (!state || !dirty()) { const next = await storage.readMaterialWriting(workspaceId); if (!mounted(token)) return; M.validate(next); state = clone(next); stored = tick; }
        if (!mounted(token)) return; if (planId && planId !== selected) { selected = planId; sourceView = null; view = null; } if (!plan()) selected = state.plans[0]?.id || null;
        await render(); if (mounted(token)) restoreView();
      } catch (cause) {
        if (!mounted(token)) return;
        if (state && plan() && surface.querySelector('#mwTitle')) { sourceLoading = false; report(cause); return; }
        const alert = el('p', cause.message || '작성 준비를 불러오지 못했습니다.', 'life-error'); alert.setAttribute('role', 'alert'); surface.replaceChildren(alert, button('작성 준비 다시 불러오기', () => mount(target, { planId })));
      }
    }
    async function reload({ planId = null } = {}) {
      await flush(); guard(); if (!mounted()) return;
      const token = epoch, version = tick, previous = selected;
      const next = await storage.readMaterialWriting(workspaceId);
      if (!mounted(token)) return;
      guard();
      if (tick !== version || selected !== previous || acting || navigating) throw fault('material_input_pending', '조회하는 동안 입력이 바뀌었습니다. 현재 입력을 보관한 뒤 다시 불러와 주세요.');
      M.validate(next); rememberView(); state = clone(next); stored = tick;
      selected = planId || selected; if (!plan()) selected = state.plans[0]?.id || null;
      if (selected !== previous) { sourceView = null; view = null; }
      clear(); await render(); if (mounted(token)) restoreView();
    }
    function detach() {
      rememberView(); epoch++; clearTimeout(timer); timer = null; clearReview(); sources?.dispose(); sources = null; sourcesTask = null; sourceLoading = false;
      host = surface = status = error = selector = blocks = copies = output = null; composing.clear(); pendingFields.clear();
    }
    function dispose() { detach(); disposed = true; state = null; sourceView = view = null; }
    return { mount, reload, flush, dirty, detach, dispose, getView: () => ({ planId: selected }) };
  }
  life.MaterialWritingUI = Object.freeze({ create });
})(globalThis);
