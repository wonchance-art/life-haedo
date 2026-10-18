/* A private ordered draft of already-public URL pointers. Targets are never published here. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
  const names = { post: '글', series: '연재', nine: '9칸 형식' };
  const fault = (code, message) => Object.assign(new Error(message), { code });
  function create({ host, storage, workspaceId, auth = root.HaedoAuth, baseURL = root.location?.href, isCurrent = () => true, onDirty = () => {}, remote: injectedRemote }) {
    const M = life.PublicCover, clone = value => structuredClone(value), fresh = () => life.Core.id();
    const remote = injectedRemote || life.PublicCoverRemote.create({ storage, workspaceId, auth, baseURL, isCurrent });
    let disposed = false, loading = true, acting = false, state = null, selected = null, tick = 0, stored = 0, saving = null, timer = null, epoch = 0, stateRequest = 0;
    let saveFailure = null, actionFailure = null, metadata = null, uncertain = false, review = null, rows = [], catalogErrors = [], cursor = null, catalogLoaded = false;
    let fields = null, title = null, intro = null, nextFocus = null, locks = new Map(); const composing = new Set(), pending = new Set();
    const surface = el('section', null, 'pc-editor'); surface.id = 'publicCoverEditor'; surface.setAttribute('aria-label', '공개 표지 편집');
    const toolbar = el('div', null, 'life-actions pc-toolbar'), select = el('select'); select.id = 'pcSelect'; select.setAttribute('aria-label', '표지 선택');
    const saveStatus = el('p', '표지를 불러오는 중…', 'life-meta'); saveStatus.id = 'pcSaveStatus'; saveStatus.setAttribute('role', 'status'); saveStatus.setAttribute('aria-live', 'polite');
    const error = el('p', '', 'life-error pc-error'); error.id = 'pcError'; error.setAttribute('role', 'alert'); error.hidden = true;
    const recovery = el('div', null, 'life-actions pc-recovery'), form = el('section', null, 'pc-fields'), catalog = el('section', null, 'pc-catalog'), items = el('ol', null, 'pc-items'); items.id = 'pcItems'; items.setAttribute('aria-label', '표지 항목 순서');
    const status = el('p', '공개 상태 확인 전', 'life-meta'); status.id = 'pcStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.state = 'loading';
    const publication = el('section', null, 'pc-publication'); publication.id = 'pcPublication';
    const preview = el('section', null, 'pc-preview'); preview.id = 'pcPreview'; preview.setAttribute('aria-label', '전체 표지 미리보기');
    const consent = el('input'); consent.type = 'checkbox'; consent.id = 'pcConsent'; consent.setAttribute('aria-label', '검토한 표지를 공개합니다');
    const consentLabel = el('label', null, 'blog-manager-check'); consentLabel.append(consent, document.createTextNode('검토한 제목·소개·순서와 선택한 공개 항목의 주소를 표지로 공개합니다.'));
    const revokeConsent = el('input'); revokeConsent.type = 'checkbox'; revokeConsent.id = 'pcRevokeConsent'; revokeConsent.setAttribute('aria-label', '이 표지 공개를 철회합니다');
    const revokeLabel = el('label', null, 'blog-manager-check'); revokeLabel.append(revokeConsent, document.createTextNode('이 표지 공개를 철회합니다. 개별 글·연재·9칸의 공개는 유지됩니다.'));
    const actions = el('div', null, 'life-actions'), management = el('div', null, 'life-actions');
    const alive = token => !disposed && host.isConnected && isCurrent() && (token == null || token === epoch);
    const cover = () => state?.covers.find(value => value.id === selected);
    const conflict = () => /conflict/.test(saveFailure?.code || '');
    const dirty = () => loading || acting || !!saving || tick !== stored || !!composing.size || !!pending.size;
    function invalidate() { review = null; consent.checked = false; preview.replaceChildren(); }
    function renderErrors() { if (!alive()) return; error.textContent = [saveFailure?.message, actionFailure?.message].filter(Boolean).join(' '); error.hidden = !error.textContent; recovery.hidden = !saveFailure; const copy = recovery.querySelector('#pcRecover'); if (copy) copy.hidden = !conflict(); }
    function notice() {
      if (!alive()) return;
      saveStatus.textContent = saveFailure ? '이 브라우저에 저장하지 못함 · 입력 유지' : loading ? '표지를 불러오는 중…' : composing.size ? '입력 중' : pending.size ? '문자·길이 확인 필요 · 입력 유지' : saving ? '이 브라우저에 보관 중…' : tick !== stored ? '보관 전 변경 있음' : '이 브라우저에 비공개로 보관됨';
      saveStatus.dataset.state = saveFailure || pending.size ? 'error' : dirty() ? 'dirty' : 'saved'; surface.setAttribute('aria-busy', String(loading || acting || !!saving));
      renderErrors(); onDirty();
    }
    function guard() {
      if (!alive()) throw fault('public_cover_scope', '계정이나 작업공간이 바뀌었습니다. 현재 공간에서 다시 열어 주세요.');
      if (composing.size) throw fault('public_cover_composing', '한글 입력을 마친 뒤 다시 시도해 주세요.');
      if (pending.size) throw fault('public_cover_input', '현재 입력은 유지했습니다. 제목·소개의 문자와 길이를 확인해 주세요.');
    }
    function schedule() { clearTimeout(timer); if (tick !== stored && !conflict()) timer = setTimeout(() => { if (alive() && !acting && !composing.size && !pending.size) flushInternal().catch(() => {}); }, 300); }
    function mark() { tick++; invalidate(); actionFailure = null; notice(); schedule(); }
    async function flushInternal() {
      guard(); clearTimeout(timer); timer = null;
      if (saving) { await saving; return flushInternal(); }
      if (!state || tick === stored) return;
      if (conflict()) throw saveFailure;
      const value = clone(state), version = tick, token = epoch; M.validateState(value);
      const task = Promise.resolve().then(async () => {
        try { const result = await storage.savePublicCover(workspaceId, value, value.revision); if (!alive(token)) return; state.revision = result.revision; stored = version; saveFailure = null; }
        catch (cause) { if (alive(token)) saveFailure = cause; throw cause; }
        finally { if (saving === task) saving = null; notice(); }
      }); saving = task; notice(); await task;
      if (alive(token) && tick !== stored) return flushInternal();
    }
    async function flush() {
      if (acting) throw fault('public_cover_busy', '표지 처리 결과를 확인한 뒤 이동해 주세요. 현재 입력은 유지했습니다.');
      if (loading) await ready;
      return flushInternal();
    }
    function lock(full) {
      const controls = [...surface.querySelectorAll('button'), ...surface.querySelectorAll('select'), ...(full ? [...surface.querySelectorAll('input'), ...surface.querySelectorAll('textarea')] : [])];
      for (const node of controls) { if (!locks.has(node)) locks.set(node, node.disabled); node.disabled = true; }
    }
    function unlock() { for (const [node, disabled] of locks) if (node.isConnected) node.disabled = disabled; locks.clear(); }
    function availability() {
      if (!alive() || acting || loading) return;
      surface.querySelector('#pcNew').disabled = !state;
      publish.disabled = !selected || !!metadata?.pending || uncertain; prepare.disabled = !selected; revoke.disabled = !selected || !metadata || metadata.status === 'missing' && !metadata.pending;
      retry.hidden = !(metadata?.pending || uncertain); retry.disabled = !selected; refresh.disabled = !selected; consent.disabled = !selected; revokeConsent.disabled = !selected;
    }
    async function run(task, { full = false, input = true, publication: publicationAttempt = false } = {}) {
      if (!alive() || acting || loading) return;
      const token = epoch, focused = document.activeElement; actionFailure = null;
      try { if (input) guard(); } catch (cause) { actionFailure = cause; notice(); return; }
      acting = true; lock(full); notice();
      try { await task(); }
      catch (cause) { if (alive(token)) { actionFailure = cause; if (publicationAttempt) { uncertain = true; try { await loadState(); } catch (_) { /* The frozen pending request remains on its original receipt. */ } } if (alive(token) && !metadata?.pending) { status.textContent = '처리 결과를 확인하지 못했습니다. 현재 입력은 유지했습니다.'; status.dataset.state = 'error'; const link = publication.querySelector('a'); if (link) link.textContent = '마지막 확인한 공개 표지 열기'; } } }
      finally { acting = false; unlock(); if (alive(token)) { availability(); notice(); schedule(); const target = nextFocus?.isConnected ? nextFocus : (!document.activeElement || document.activeElement === document.body) && focused?.isConnected ? focused : null; if (target && !target.disabled) target.focus({ preventScroll: true }); nextFocus = null; } }
    }
    function button(label, id, task, options) {
      const node = el('button', label, 'life-button'); node.type = 'button'; if (id) node.id = id;
      node.addEventListener('click', () => run(task, options)); return node;
    }
    function updateSelect() {
      select.replaceChildren(); for (const value of state?.covers || []) { const option = el('option', value.title || '제목 없는 표지'); option.value = value.id; select.append(option); }
      select.value = selected || ''; select.hidden = !state?.covers.length;
    }
    function field(label, key, multiline) {
      const owner = cover(), wrapper = el('label', null, 'life-field'), input = el(multiline ? 'textarea' : 'input'); input.id = key === 'title' ? 'pcTitle' : 'pcIntro'; input.value = owner[key]; input.maxLength = M.LIMITS[key]; input.setAttribute('aria-label', label); if (multiline) input.rows = 3; else input.type = 'text'; wrapper.append(el('span', label), input);
      function apply() {
        if (!alive() || cover() !== owner || composing.has(input)) return;
        const previous = owner[key]; owner[key] = input.value;
        try { M.validateState(state); pending.delete(input); mark(); if (key === 'title') updateSelect(); }
        catch (cause) { owner[key] = previous; pending.add(input); invalidate(); actionFailure = cause; notice(); }
      }
      input.addEventListener('input', apply); input.addEventListener('compositionstart', () => { composing.add(input); invalidate(); clearTimeout(timer); notice(); }); input.addEventListener('compositionend', () => { composing.delete(input); apply(); notice(); }); return { wrapper, input };
    }
    function itemTitle(value) { return rows.find(row => row.kind === value.kind && row.publicId === value.publicId)?.title || `${names[value.kind]} · 제목 미확인`; }
    function renderItems(focusId, focusAction) {
      items.replaceChildren(); const owner = cover(); if (!owner) return;
      if (!owner.items.length) items.append(el('li', '아래 공개 항목에서 표지에 담을 내용을 추가하세요.', 'life-help'));
      owner.items.forEach((value, index) => {
        const row = el('li'); row.dataset.itemId = value.id; row.dataset.kind = value.kind; row.dataset.publicId = value.publicId;
        row.append(el('p', `${index + 1}. ${itemTitle(value)}`), el('p', names[value.kind], 'life-meta')); const controls = el('div', null, 'life-actions pc-item-actions');
        for (const [label, direction, key] of [['위로', -1, 'up'], ['아래로', 1, 'down']]) {
          const move = button(label, null, () => { guard(); if (conflict()) throw saveFailure; const at = owner.items.findIndex(item => item.id === value.id), to = at + direction; if (at < 0 || to < 0 || to >= owner.items.length) return; [owner.items[at], owner.items[to]] = [owner.items[to], owner.items[at]]; mark(); renderItems(value.id, key); });
          move.dataset.action = key; move.setAttribute('aria-label', `${index + 1}번 항목 ${label}`); move.disabled = direction < 0 ? index === 0 : index === owner.items.length - 1; controls.append(move);
        }
        const remove = button('빼기', null, () => { guard(); if (conflict()) throw saveFailure; owner.items = owner.items.filter(item => item.id !== value.id); mark(); renderItems(); renderCatalog(); }); remove.dataset.action = 'remove'; remove.setAttribute('aria-label', `${index + 1}번 항목 빼기`); controls.append(remove); row.append(controls); items.append(row);
      });
      if (focusId) { const row = [...items.children].find(node => node.dataset.itemId === focusId), wanted = row?.querySelector(`[data-action="${focusAction}"]`), target = wanted && !wanted.disabled ? wanted : row?.querySelector('[data-action="remove"]'); if (acting) nextFocus = target; else target?.focus({ preventScroll: true }); }
      if (acting) lock(false);
    }
    function renderForm() {
      invalidate(); composing.clear(); pending.clear(); form.replaceChildren(); fields = title = intro = null; updateSelect();
      if (!cover()) form.append(el('p', '새 표지를 만들어 이미 공개한 항목을 직접 골라 담으세요.', 'life-help'));
      else { fields = [field('표지 제목', 'title', false), field('표지 소개', 'intro', true)]; title = fields[0].input; intro = fields[1].input; form.append(...fields.map(value => value.wrapper)); }
      renderItems(); renderCatalog(); if (acting) lock(true);
    }
    function renderCatalog() {
      catalog.replaceChildren(el('h3', '이미 공개한 항목'), button('공개 항목 다시 확인', 'pcCatalogRefresh', () => loadCatalog(false), { input: false }));
      const info = el('p', !catalogLoaded ? '공개 항목 확인 전입니다.' : catalogErrors.length ? '일부 공개 항목을 확인하지 못했습니다. 확인한 항목과 현재 선택은 유지했습니다. 다시 확인해 주세요.' : !rows.length ? '먼저 글·연재·9칸을 각각 공개한 뒤 추가해 주세요. 여기서 비공개 내용을 게시하지 않습니다.' : '선택한 항목의 제목·내용·공개 여부는 실제 공개본을 따라 바뀝니다.', 'life-help'); info.id = 'pcCatalogStatus'; info.dataset.state = catalogErrors.length ? 'partial' : catalogLoaded ? 'ready' : 'loading'; catalog.append(info);
      if (catalogErrors.length) { const errors = el('ul', null, 'life-help pc-catalog-errors'); for (const value of catalogErrors) errors.append(el('li', `${names[value.kind] || (value.kind === 'pages' ? '연재·9칸 형식' : '공개 항목')}: ${value.message || '공개 상태를 확인하지 못했습니다.'}`)); catalog.append(errors); }
      const list = el('ul', null, 'pc-catalog-list'); list.id = 'pcCatalog'; const owner = cover();
      for (const value of rows) {
        const row = el('li'); row.dataset.kind = value.kind; row.dataset.publicId = value.publicId; row.append(el('h4', value.title || '제목 없는 공개 항목'), el('p', names[value.kind], 'life-meta')); if (value.intro) row.append(el('p', value.intro, 'life-help'));
        const added = owner?.items.some(item => item.kind === value.kind && item.publicId === value.publicId);
        const add = button(added ? '추가됨' : '추가', null, () => {
          guard(); if (conflict()) throw saveFailure; const target = cover(); if (!target) throw new Error('새 표지를 먼저 만들어 주세요.');
          const item = M.item(value.kind, value.publicId, fresh); target.items.push(item); try { M.validateState(state); } catch (cause) { target.items.pop(); throw cause; }
          mark(); renderItems(); renderCatalog();
        }); add.dataset.kind = value.kind; add.dataset.publicId = value.publicId; add.setAttribute('aria-label', `${value.title || '제목 없는 공개 항목'} 표지에 추가`); add.disabled = !owner || added; row.append(add); list.append(row);
      } catalog.append(list); if (cursor) catalog.append(button('공개 항목 더 보기', 'pcCatalogMore', () => loadCatalog(true), { input: false })); if (acting) lock(false);
    }
    async function loadCatalog(more) {
      const token = epoch, value = await remote.catalog({ after: more ? cursor : null }); if (!alive(token)) return;
      invalidate(); rows = [...new Map([...(more ? rows : []), ...value.items].map(row => [row.kind + ':' + row.publicId, row])).values()]; catalogErrors = value.errors || []; cursor = value.nextCursor; catalogLoaded = true; renderCatalog(); renderItems();
    }
    function showState(value) {
      if (!value || !['missing', 'published', 'revoked'].includes(value.status) || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('표지의 현재 공개 상태를 확인하지 못했습니다. 다시 확인해 주세요.');
      metadata = value; uncertain = false; revokeConsent.checked = false; publication.replaceChildren(); status.dataset.state = value.pending ? 'pending' : value.status;
      status.textContent = value.pending ? '결과를 확인하지 못한 요청이 있습니다. 다시 확인하면 승인한 제목·소개·주소를 같은 요청으로 전송합니다. 철회된 항목은 열리지 않습니다.' : value.status === 'published' ? '표지 공개를 확인했습니다. 로컬 수정은 자동 공개되지 않습니다.' : value.status === 'revoked' ? '표지 공개 철회를 확인했습니다. 개별 항목의 공개는 유지됩니다.' : '이 표지는 아직 공개하지 않았습니다.';
      if (value.status === 'published') {
        if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value.publicId)) throw new Error('표지의 공개 주소를 확인하지 못했습니다.');
        const url = new URL('cover.html', baseURL); url.searchParams.set('cover', value.publicId); const link = el('a', '공개 표지 열기'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; publication.append(link);
      } availability();
    }
    async function loadState() {
      const id = selected, token = epoch, request = ++stateRequest; if (!id) { metadata = null; status.dataset.state = 'missing'; status.textContent = '표지를 고른 뒤 공개 상태를 확인할 수 있습니다.'; publication.replaceChildren(); return; }
      const value = await remote.getState(id); if (alive(token) && selected === id && request === stateRequest) showState(value);
    }
    async function prepareReview() {
      invalidate(); await flushInternal(); guard(); const owner = cover(); if (!owner) throw new Error('표지를 먼저 만들어 주세요.');
      const version = tick, token = epoch; await loadState(); if (!alive(token)) return; const expectedRevision = metadata?.revision;
      const value = await remote.prepare(owner.id); if (!alive(token) || cover() !== owner || version !== tick) return; guard();
      const node = life.PublicCoverView.render(value.preview, { preview: true, baseURL }); preview.replaceChildren(node); review = { value, expectedRevision, tick: version, id: owner.id }; consent.checked = false;
      status.dataset.state = 'reviewed'; status.textContent = '이 표지의 제목·소개·순서·공개 항목 주소만 게시합니다. 개별 항목을 새로 공개하거나 원본을 전송하지 않습니다.';
    }
    async function finish(result, action) {
      const id = selected, token = epoch, value = result?.state || await remote.getState(id); if (!alive(token) || selected !== id) return; showState(value);
      if (result?.status !== 'stored') throw new Error('서버의 표지가 바뀌었습니다. 현재 공개 상태를 확인하고 전체 미리보기부터 다시 검토해 주세요.');
      if (action === 'publish' && value.status !== 'published' || action === 'revoke' && value.status !== 'revoked') throw new Error('이전 요청과 현재 공개 상태가 다릅니다. 현재 상태를 다시 확인해 주세요.');
    }
    async function reloadInitial() {
      const token = epoch, value = await storage.readPublicCover(workspaceId); if (!alive(token)) return;
      M.validateState(value); state = clone(value); selected = state.covers[0]?.id || null; saveFailure = null; metadata = null; uncertain = false; renderForm(); await loadState();
    }
    async function recover() {
      guard(); if (saving) await saving; const owner = cover(); if (!owner) return;
      const token = epoch, version = tick, local = clone(owner), latest = await storage.readPublicCover(workspaceId); if (!alive(token)) return; guard(); if (tick !== version || cover() !== owner) throw new Error('입력이 바뀌었습니다. 현재 변경을 확인한 뒤 새 사본으로 보관해 주세요.');
      M.validateState(latest); local.id = fresh(); for (const item of local.items) item.id = fresh(); latest.covers.push(local); M.validateState(latest); const saved = await storage.savePublicCover(workspaceId, latest, latest.revision); if (!alive(token)) return;
      if (tick !== version || composing.size || pending.size) { state.revision = saved.revision; throw fault('public_cover_conflict', '새 표지 사본은 보관했습니다. 그동안의 입력도 유지했으니 입력을 마친 뒤 다시 보관해 주세요.'); }
      state = clone(saved); selected = local.id; stored = tick; saveFailure = null; metadata = null; uncertain = false; renderForm(); await loadState();
    }
    const prepare = button('전체 표지 미리보기', 'pcReview', prepareReview, { full: true });
    const publish = button('표지 게시·갱신', 'pcPublish', async () => {
      const accepted = review, allowed = consent.checked; invalidate(); revokeConsent.checked = false;
      if (!accepted || !allowed || accepted.id !== selected || accepted.tick !== tick) throw new Error('전체 표지 미리보기를 확인하고 공개 동의를 선택해 주세요.');
      if (metadata?.pending || uncertain) throw new Error('미확인 요청을 먼저 같은 요청으로 다시 확인해 주세요.');
      await flushInternal(); guard(); if (accepted.tick !== tick) throw new Error('검토한 표지가 바뀌었습니다. 전체 미리보기를 다시 확인해 주세요.');
      const token = epoch, result = await remote.publish(accepted.value, { expectedRevision: accepted.expectedRevision }); if (alive(token)) await finish(result, 'publish');
    }, { full: true, publication: true });
    const refresh = button('공개 상태 다시 확인', 'pcRefresh', async () => { invalidate(); await loadState(); }, { input: false });
    const retry = button('미확인 요청 다시 확인', 'pcRetry', async () => { invalidate(); revokeConsent.checked = false; const token = epoch, result = await remote.retry(selected); if (alive(token)) await finish(result); }, { full: true, publication: true });
    const revoke = button('표지 공개 철회', 'pcRevoke', async () => {
      const allowed = revokeConsent.checked, expectedRevision = metadata?.revision; invalidate(); revokeConsent.checked = false;
      if (!allowed || !Number.isSafeInteger(expectedRevision)) throw new Error('현재 표지를 확인하고 철회 동의를 선택해 주세요.');
      const token = epoch, result = await remote.revoke(selected, { expectedRevision }); if (alive(token)) await finish(result, 'revoke');
    }, { full: true, publication: true });
    toolbar.append(select, button('새 표지', 'pcNew', async () => {
      await flushInternal(); guard(); const value = M.create(fresh); state.covers.push(value); try { M.validateState(state); } catch (cause) { state.covers.pop(); throw cause; }
      selected = value.id; metadata = null; uncertain = false; mark(); renderForm(); await flushInternal(); await loadState(); nextFocus = title;
    }, { full: true }));
    select.addEventListener('change', async () => { const value = select.value; if (acting || loading) { select.value = selected || ''; return; } await run(async () => { await flushInternal(); selected = value; metadata = null; uncertain = false; actionFailure = null; renderForm(); await loadState(); }, { full: true }); if (alive()) select.value = selected || ''; });
    recovery.append(button('다시 보관', 'pcSaveRetry', async () => { if (!state) await reloadInitial(); else await flushInternal(); saveFailure = null; }), button('내 입력을 새 표지 사본으로 보관', 'pcRecover', recover, { full: true })); recovery.hidden = true;
    actions.append(prepare, publish); management.append(refresh, retry, revoke);
    surface.append(toolbar, saveStatus, error, recovery, form, el('h3', '표지에 담을 순서'), items, catalog,
      el('p', '표지는 이미 공개한 항목으로 들어가는 별도 페이지입니다. 제목·소개·순서와 공개 주소만 게시하며 개별 본문·사진·비공개 기록을 복사하거나 자동 공개하지 않습니다.', 'life-help'), status, publication, actions, preview, consentLabel, revokeLabel, management);
    host.replaceChildren(surface);
    const ready = (async () => {
      const token = epoch;
      try {
        const value = await storage.readPublicCover(workspaceId); if (!alive(token)) return; M.validateState(value); state = clone(value); selected = state.covers[0]?.id || null; renderForm(); lock(false);
        const result = await Promise.allSettled([loadCatalog(false), loadState()]); if (!alive(token)) return;
        for (const value of result) if (value.status === 'rejected') actionFailure = value.reason;
      } catch (cause) { if (alive(token)) { saveFailure = cause; actionFailure = null; form.append(button('표지 다시 불러오기', 'pcReload', reloadInitial)); } }
      finally { loading = false; unlock(); if (alive(token)) { availability(); notice(); } }
    })();
    return { ready, flush, dirty, dispose() { disposed = true; epoch++; stateRequest++; clearTimeout(timer); remote.dispose?.(); invalidate(); surface.remove(); composing.clear(); pending.clear(); locks.clear(); state = null; } };
  }
  life.PublicCoverUI = Object.freeze({ create });
})(globalThis);
