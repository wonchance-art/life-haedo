/* Naver subscriptions are read-only at the source. No credentials or remote HTML enter this view. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.HaedoLife ||= {}).NaverBlogUI = api;
})(globalThis, function (root) {
  'use strict';
  const labels = { imported: '이미 보관한 글', needs_content: '본문 보완 필요', new: '아직 보관하지 않은 글', ambiguous: '기존 자료 확인 필요' };
  function create({ container, service, workspaceId, onOpenSource, onImport, onReturn, isCurrent = () => true, viewState = {} }) {
    viewState ||= {};
    const doc = container.ownerDocument;
    const el = (tag, text, cls) => { const n = doc.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
    let disposed = false, epoch = 0, request = 0, busy = false, composing = false, navigating = false;
    let surface, input, preview, auto, save, status, error, subscriptions, items, more, filter;
    let ready = false, loaded = false, data = { subscriptions: [], items: [] }, shown = 20;
    let autoDraft = viewState.autoCollect === true;
    const current = token => !disposed && isCurrent() && container.isConnected && (token == null || token === epoch);
    const model = () => root.HaedoLife?.NaverBlog;
    function parsed() { try { return model().parseBlog(input.value); } catch (_) { return null; } }
    function message(text, state) { if (!current()) return; status.textContent = text; status.dataset.state = state; }
    function clearError() { error.hidden = true; error.textContent = ''; }
    function fail(cause) {
      if (!current()) return;
      const code = cause?.code;
      const setup = ['naver_setup_required', 'naver_blog_setup_required', 'setup_required'].includes(code);
      error.textContent = code === 'naver_blog_invalid' ? '네이버 블로그 아이디나 블로그 주소를 확인해 주세요. 입력은 그대로 남아 있습니다.' :
        code === 'naver_conflict' || code === 'naver_blog_conflict' || code === 'revision_conflict' ? '다른 화면에서 연결이 바뀌었습니다. 연결 목록을 다시 확인한 뒤 선택해 주세요.' :
        setup ? '서버 수집 기능은 준비 중입니다. 연결 주소는 보관할 수 있으며 실제 수집 범위는 아직 확인하지 않았습니다.' :
        code === 'naver_schema_missing' ? '블로그 연결 저장소가 아직 준비되지 않았습니다. 입력한 아이디는 그대로 있습니다. 준비 후 다시 시도해 주세요.' :
        code === 'naver_ambiguous' || code === 'naver_blog_ambiguous' ? '같은 글일 수 있는 자료가 여러 개입니다. 기존 자료를 먼저 확인해 주세요.' :
        '처리하지 못했습니다. 입력과 기존 자료는 그대로 있습니다. 목록을 다시 확인한 뒤 다시 시도해 주세요.';
      error.hidden = false; message(setup ? '서버 수집 기능 준비 중 · 연결 주소 유지' : '확인하지 못함 · 기존 자료 유지', setup ? 'setup-required' : 'error');
    }
    function controls() {
      if (!surface) return;
      surface.setAttribute('aria-busy', String(busy));
      surface.querySelectorAll('button').forEach(b => { b.disabled = busy || b.dataset.unavailable === 'true'; });
      save.disabled = busy || composing || !parsed();
      auto.disabled = busy || !ready;
      auto.checked = ready && autoDraft;
      input.disabled = busy;
      filter.disabled = busy;
    }
    function button(label, action, id, cls) {
      const n = el('button', label, cls || 'life-button'); n.type = 'button'; if (id) n.id = id;
      n.addEventListener('click', () => {
        if (!current() || busy) return;
        if (composing) { error.textContent = '아이디의 한글 입력을 마친 뒤 다시 선택해 주세요.'; error.hidden = false; input.focus(); return; }
        void action(n).catch(fail);
      });
      return n;
    }
    async function work(action) {
      if (!current() || busy) return;
      const token = epoch; busy = true; clearError(); controls();
      try { await action(token); } catch (cause) { if (current(token)) fail(cause); }
      finally { if (current(token)) { busy = false; controls(); } }
    }
    async function navigate(callback) {
      if (!current()) return;
      busy = false; navigating = true; controls();
      try { await callback(); } finally { navigating = false; }
    }
    function date(value) {
      const at = new Date(value || '');
      return Number.isFinite(at.getTime()) ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(at) : '아직 없음';
    }
    function safeLink(value, label) {
      try {
        const u = new URL(value);
        if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
        const a = el('a', label, 'life-button'); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
      } catch (_) { return null; }
    }
    function paintSubscriptions() {
      subscriptions.replaceChildren();
      if (!data.subscriptions.length) { subscriptions.append(el('p', '연결한 블로그가 없습니다.', 'life-help')); return; }
      for (const row of data.subscriptions) {
        const article = el('article', null, 'nv-subscription'); article.dataset.subscriptionId = row.id;
        article.append(el('h3', row.blogId || row.blog_id || '연결한 블로그'));
        article.append(el('p', !ready ? '연결 주소 보관 · 자동 수집 준비 중' : row.enabled ? '새 공개 글 자동 수집 켜짐' : '자동 수집 중지', 'life-meta'));
        article.append(el('p', '마지막 확인 성공: ' + date(row.lastSuccessAt || row.last_success_at), 'life-meta'));
        if (row.lastError || row.last_error || row.lastErrorCode || row.last_error_code) article.append(el('p', '최근 확인에 실패했습니다. 기존 자료는 유지됩니다. 다시 확인할 수 있습니다.', 'nv-warning'));
        const actions = el('div', null, 'life-actions');
        actions.append(button('지금 확인', () => work(async token => {
          message('새 공개 글을 확인하고 있습니다…', 'checking');
          await service.check(workspaceId, row.id);
          if (current(token)) await load('새 글 목록을 확인했습니다.');
        })));
        const toggle = button(row.enabled ? '자동 수집 중지' : '자동 수집 켜기', () => work(async token => {
          const result = await service.save(workspaceId, { blogId: row.blogId || row.blog_id, expectedRevision: row.revision, enabled: !row.enabled });
          if (!current(token)) return;
          adoptSubscription(result); paintSubscriptions(); await load('연결 설정을 보관했습니다.');
        }));
        if (!ready) toggle.dataset.unavailable = 'true';
        toggle.dataset.action = row.enabled ? 'pause' : 'resume'; actions.append(toggle); article.append(actions); subscriptions.append(article);
      }
    }
    function paintItems() {
      items.replaceChildren();
      const rows = data.items.filter(row => !filter.value || row.status === filter.value);
      for (const row of rows.slice(0, shown)) {
        const article = el('article', null, 'nv-item'); article.dataset.itemId = row.id; article.dataset.state = row.status;
        article.append(el('h3', row.title || '제목 없는 글'), el('p', labels[row.status] || '보관 상태 확인 필요', 'life-meta'));
        if (row.status === 'needs_content') article.append(el('p', '기존 자료는 일부 본문 또는 링크만 보관되어 있습니다. 원문을 확인하고 본문을 보완할 수 있습니다.', 'life-help'));
        const actions = el('div', null, 'life-actions'); const original = safeLink(row.url, '네이버 원문 열기'); if (original) actions.append(original);
        if (row.sourceId && onOpenSource) {
          const open = button('보관한 자료 열기', () => navigate(() => onOpenSource({ sourceId: row.sourceId, sourceVersionId: row.sourceVersionId }))); open.dataset.action = 'open'; open.dataset.focusKey = 'naver-blog:source:' + row.sourceId; actions.append(open);
        }
        if (row.status === 'needs_content' && onImport) {
          const add = button('본문 보완하기', () => navigate(() => onImport({ item: row, sourceId: row.sourceId, sourceVersionId: row.sourceVersionId, input: model().toImportInput(row) }))); add.dataset.action = 'complete'; actions.append(add);
        }
        if (row.status === 'new') {
          const receive = button('이 공간에 받기', () => work(async token => {
            message('선택한 글을 자료로 보관하고 있습니다…', 'receiving');
            const result = await service.receive(workspaceId, row.id);
            if (!current(token)) return;
            // Keep a committed source receipt if the following list read fails.
            if (result?.sourceId) { row.sourceId = result.sourceId; row.sourceVersionId = result.sourceVersionId || null; row.status = 'needs_content'; paintItems(); }
            await load('선택한 글을 자료로 보관했습니다. 본문 포함 범위를 확인해 주세요.');
          })); receive.dataset.action = 'receive'; actions.append(receive);
        }
        if (row.status === 'ambiguous') {
          article.append(el('p', '기존 자료가 여러 개와 겹쳐 자동으로 합치지 않았습니다.', 'life-help'));
          if (onOpenSource) (row.candidateSourceIds || []).forEach((sourceId, index) => {
            const candidate = button('기존 자료 ' + (index + 1) + ' 확인', () => navigate(() => onOpenSource({ sourceId })));
            candidate.dataset.action = 'candidate'; actions.append(candidate);
          });
        }
        article.append(actions); items.append(article);
      }
      if (!rows.length) items.append(el('p', loaded ? '확인한 목록에 해당하는 글이 없습니다. 목록에 없는 과거 글까지 모두 확인한 결과는 아닙니다.' : '글 목록을 확인하고 있습니다…', 'life-help'));
      more.hidden = rows.length <= shown && !data.hasMore; items.dataset.state = loaded ? rows.length ? 'ready' : 'empty' : 'loading';
    }
    function adoptSubscription(row) {
      if (!row?.id) return;
      const i = data.subscriptions.findIndex(item => item.id === row.id);
      if (i < 0) data.subscriptions.push(row); else data.subscriptions[i] = row;
    }
    function collectionNotice(result, success) {
      clearError();
      const count = Number.isSafeInteger(result.receivedCount) && result.receivedCount > 0 ? result.receivedCount : 0;
      const received = count ? ' ' + count + '개 글을 이 공간의 자료에 반영했습니다.' : '';
      if (result.autoReceiveError) {
        error.textContent = '일부 글을 이 공간에 반영하지 못했습니다. 이미 보관한 자료는 유지됩니다. 목록을 다시 확인해 주세요.';
        error.hidden = false;
      }
      message((success || (ready ? '확인 가능한 공개 글 목록입니다.' : '연결 주소를 보관할 수 있습니다. 서버 수집 기능은 준비 중이며 실제 수집 범위는 아직 확인하지 않았습니다.')) + received,
        result.autoReceiveError ? 'partial' : ready ? 'ready' : 'setup-required');
    }
    async function load(success) {
      const token = epoch, id = ++request; message('연결과 글 목록을 확인하고 있습니다…', 'loading');
      const result = await service.list(workspaceId);
      if (!current(token) || id !== request) return;
      if (!result || !Array.isArray(result.subscriptions) || !Array.isArray(result.items)) throw new Error('invalid_list');
      data = { subscriptions: result.subscriptions.map(row => ({ ...row })), items: result.items.map(row => ({ ...row })), hasMore: result.hasMore === true, nextCursor: result.nextCursor }; ready = result.ready === true; loaded = true;
      paintSubscriptions(); paintItems(); controls();
      collectionNotice(result, success);
    }
    function init() {
      surface = el('section', null, 'naver-blog'); surface.id = 'lifeNaverBlog'; surface.setAttribute('aria-label', '네이버 블로그 연결');
      surface.append(el('p', '공개한 네이버 글을 비공개 자료로 모읍니다. 네이버 원본을 수정하거나 해도에 자동 공개하지 않습니다.', 'life-help'));
      const form = el('form', null, 'nv-form');
      const label = el('label', null, 'life-field'); label.htmlFor = 'naverBlogId'; label.append(el('span', '아이디 또는 블로그 주소'));
      input = el('input'); input.id = 'naverBlogId'; input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 8192; input.setAttribute('aria-describedby', 'naverBlogHelp naverBlogPreview'); label.append(input);
      input.value = typeof viewState.blogInput === 'string' ? viewState.blogInput.slice(0, 8192) : '';
      const help = el('p', 'blog.naver.com/ 뒤에 오는 아이디나 블로그 주소를 입력해 주세요.', 'life-help'); help.id = 'naverBlogHelp';
      preview = el('p', '블로그 주소를 입력하면 연결할 주소가 여기에 표시됩니다.', 'nv-preview life-meta'); preview.id = 'naverBlogPreview';
      const update = () => { const p = parsed(); preview.textContent = p?.url || (input.value ? '아이디나 블로그 주소를 확인해 주세요.' : '블로그 주소를 입력하면 연결할 주소가 여기에 표시됩니다.'); controls(); };
      input.addEventListener('input', update); input.addEventListener('compositionstart', () => { composing = true; controls(); }); input.addEventListener('compositionend', () => { composing = false; update(); });
      const choice = el('label', null, 'nv-auto'); auto = el('input'); auto.type = 'checkbox'; auto.id = 'naverBlogAuto'; choice.append(auto, el('span', '새로 확인되는 글을 비공개 자료로 수집'));
      auto.addEventListener('change', () => { autoDraft = ready && auto.checked; });
      const autoHelp = el('p', '처음 확인한 목록도 포함합니다. 앱을 닫으면 서버에 보관하고, 이 화면을 열 때 현재 공간에 반영합니다.', 'life-help');
      autoHelp.id = 'naverBlogAutoHelp'; auto.setAttribute('aria-describedby', autoHelp.id);
      save = button('블로그 연결 보관', () => work(async token => {
        const value = model().parseBlog(input.value);
        const existing = data.subscriptions.find(row => (row.blogId || row.blog_id) === value.blogId);
        const result = await service.save(workspaceId, { blogId: value.blogId, expectedRevision: existing?.revision || 0, enabled: ready && auto.checked });
        if (!current(token)) return;
        adoptSubscription(result); paintSubscriptions(); await load('블로그 연결을 보관했습니다.');
      }), 'naverBlogSave');
      form.addEventListener('submit', event => { event.preventDefault(); if (!save.disabled) save.click(); });
      form.append(label, help, preview, choice, autoHelp, save);
      status = el('p', '', 'life-status'); status.id = 'naverBlogStatus'; status.setAttribute('role', 'status');
      error = el('p', '', 'life-error'); error.id = 'naverBlogError'; error.setAttribute('role', 'alert'); error.hidden = true;
      const tools = el('div', null, 'life-actions'); tools.append(button('목록 다시 확인', async () => { clearError(); await load(); }, 'naverBlogRefresh'));
      if (onReturn) tools.append(button('자료 목록으로 돌아가기', () => navigate(onReturn), 'naverBlogReturn'));
      subscriptions = el('div', null, 'nv-subscriptions'); subscriptions.id = 'naverBlogSubscriptions';
      const heading = el('h2', '확인한 글');
      const filterLabel = el('label', null, 'life-field'); filterLabel.htmlFor = 'naverBlogFilter'; filterLabel.append(el('span', '보관 상태'));
      filter = el('select'); filter.id = 'naverBlogFilter';
      for (const [value, text] of [['', '전체'], ...Object.entries(labels)]) { const option = el('option', text); option.value = value; filter.append(option); }
      filter.addEventListener('change', () => { shown = 20; paintItems(); }); filterLabel.append(filter);
      items = el('div', null, 'nv-items'); items.id = 'naverBlogItems';
      more = button('20개 더 보기', () => work(async token => {
        const matches = data.items.filter(row => !filter.value || row.status === filter.value);
        if (shown >= matches.length && data.hasMore) {
          const page = await service.list(workspaceId, { before: data.nextCursor });
          if (!current(token)) return;
          if (!page || !Array.isArray(page.items)) throw new Error('invalid_list');
          const known = new Set(data.items.map(row => row.id));
          data.items.push(...page.items.filter(row => !known.has(row.id)).map(row => ({ ...row })));
          data.hasMore = page.hasMore === true; data.nextCursor = page.nextCursor;
          collectionNotice(page, '글 목록을 더 확인했습니다.');
        }
        const start = shown; shown += 20; paintItems();
        const first = items.children[start]; first?.querySelector('button,a')?.focus({ preventScroll: true }); first?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }), 'naverBlogMore'); more.hidden = true;
      surface.append(form, status, error, tools, subscriptions, heading, el('p', '본문 일부·링크만 보관될 수 있습니다. 사진 원본은 자동 보관하지 않으며 목록 밖의 과거 글은 확인되지 않았을 수 있습니다.', 'life-help'), filterLabel, items, more);
      container.replaceChildren(surface); update();
    }
    async function render() { if (disposed || !isCurrent()) return; if (!surface) init(); try { await load(); } catch (cause) { fail(cause); } }
    async function flush() {
      if (composing) throw new Error('아이디 입력을 마친 뒤 이동해 주세요.');
      if (busy && !navigating) throw new Error('선택한 작업이 끝난 뒤 이동해 주세요.');
    }
    return { render, flush, dirty: () => composing || busy && !navigating,
      getView: () => ({ blogInput: input?.value || '', autoCollect: autoDraft }),
      destroy() { if (disposed) return; disposed = true; epoch++; request++; data = { subscriptions: [], items: [] }; surface?.replaceChildren(); container.replaceChildren(); } };
  }
  return Object.freeze({ create });
});
