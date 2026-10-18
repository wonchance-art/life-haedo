/* Private series reading. The storage/model own exact snapshots; no writes or network. */
(function (root, factory) {
  'use strict';
  const api = factory(root); (root.HaedoLife ||= {}).BlogSeriesReader = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  function create({ storage, workspaceId, isCurrent = () => true, renderPhoto, onExit = () => {}, onEdit = null }) {
    if (typeof storage?.readBlogSeriesSnapshot !== 'function' || typeof renderPhoto !== 'function')
      throw new Error('모음 읽기 기능을 준비하지 못했습니다. 다시 열어 주세요.');
    let host = null, surface = null, snapshot = null, seriesId = null, entryId = null;
    let epoch = 0, disposed = false, photoView = null, view = 'contents', tocPosition = null;
    const node = (tag, text, cls) => {
      const value = root.document.createElement(tag);
      if (text != null) value.textContent = text;
      if (cls) value.className = cls;
      return value;
    };
    const current = token => !disposed && (!Number.isInteger(token) || token === epoch) && !!host?.isConnected && isCurrent();
    const title = item => item.title.trim() || '제목 없는 글';
    function releasePhoto() {
      const previous = photoView; photoView = null;
      previous?.dispose?.();
    }
    function expired() { if (!disposed && !isCurrent()) detach(); }
    function errorText(cause) {
      if (cause?.code === 'blog_series_missing') return '이 모음을 찾을 수 없습니다. 모음 목록에서 다시 확인해 주세요.';
      if (['invalid_blog_series', 'invalid_blog_series_snapshot'].includes(cause?.code))
        return '모음의 정확한 글 사본을 확인하지 못했습니다. 최신 글로 바꾸지 않았습니다. 파일 사본이나 모음 목록을 확인해 주세요.';
      return '모음을 불러오지 못했습니다. 보관한 글은 그대로입니다. 다시 시도해 주세요.';
    }
    function showActionError(cause) {
      if (!current()) { expired(); return; }
      let error = surface.querySelector('.blog-series-reader-error');
      if (!error) { error = node('p', null, 'life-error blog-series-reader-error'); error.setAttribute('role', 'alert'); surface.append(error); }
      error.textContent = cause?.message || '화면을 열지 못했습니다. 다시 시도해 주세요.';
    }
    function button(label, action, id, cls = '') {
      const control = node('button', label, 'life-button ' + cls); control.type = 'button';
      if (id) control.id = id;
      let pending = false;
      control.addEventListener('click', async () => {
        if (pending || control.disabled || !current() || !surface.contains(control)) { expired(); return; }
        const token = epoch; pending = true; control.disabled = true;
        try { await action(); }
        catch (cause) { if (current(token)) showActionError(cause); else expired(); }
        finally { pending = false; if (control.isConnected) control.disabled = false; }
      });
      return control;
    }
    function focus(node, token, restore = null) {
      root.requestAnimationFrame(() => {
        if (!current(token) || !node?.isConnected || !surface.contains(node)) { expired(); return; }
        node.focus({ preventScroll: true });
        if (restore) root.scrollTo({ left: restore.x, top: restore.y, behavior: 'instant' });
        else node.scrollIntoView({ block: 'start', behavior: 'instant' });
      });
    }
    function shell(state) {
      releasePhoto();
      surface.replaceChildren(); surface.dataset.view = state;
      surface.setAttribute('aria-busy', 'false'); surface.removeAttribute('data-entry-id');
    }
    function listActions() {
      const actions = node('nav', null, 'life-actions blog-series-reader-actions'); actions.setAttribute('aria-label', '모음 읽기');
      actions.append(button('모음 목록으로 돌아가기', () => onExit(), 'blogSeriesReaderExit'));
      if (onEdit) actions.append(button('모음 편집', () => onEdit({ seriesId }), 'blogSeriesReaderEdit'));
      return actions;
    }
    function contents({ restore = false, missing = false } = {}) {
      if (!current() || !snapshot) { expired(); return; }
      const token = ++epoch; view = 'contents'; entryId = null; shell('contents');
      surface.append(listActions());
      const heading = node('h1', snapshot.series.title.trim() || '제목 없는 모음', 'blog-series-reader-title');
      heading.id = 'blogSeriesReaderTitle'; heading.tabIndex = -1; surface.append(heading);
      if (snapshot.series.intro) surface.append(node('p', snapshot.series.intro, 'blog-series-reader-intro'));
      const count = node('p', snapshot.series.items.length + '개 글', 'life-meta blog-series-reader-count'); surface.append(count);
      const list = node('ol', null, 'blog-series-toc'); list.setAttribute('aria-label', '모음 목차');
      for (const item of snapshot.series.items) {
        const row = node('li');
        const open = button(title(item), () => {
          tocPosition = { entryId: item.id, x: root.scrollX, y: root.scrollY };
          return openEntry(item.id);
        }, null, 'blog-series-toc-link');
        open.dataset.entryId = item.id; open.dataset.focusKey = 'series:entry:' + seriesId + ':' + item.id;
        row.append(open); list.append(row);
      }
      surface.append(list);
      if (!snapshot.series.items.length) surface.append(node('p', '아직 담은 글이 없습니다. 모음 편집에서 저장한 글을 골라 주세요.', 'life-empty'));
      if (missing) {
        const error = node('p', '이 글은 모음에 없습니다. 목차에서 다시 골라 주세요.', 'life-error'); error.setAttribute('role', 'alert'); surface.append(error);
      }
      const previous = restore && tocPosition && [...list.querySelectorAll('button')].find(value => value.dataset.entryId === tocPosition.entryId);
      focus(previous || heading, token, previous ? tocPosition : null);
    }
    function pagination(index) {
      const navigation = node('nav', null, 'blog-series-reader-pagination'); navigation.setAttribute('aria-label', '모음 글 이동');
      const previous = snapshot.series.items[index - 1], next = snapshot.series.items[index + 1];
      const before = button('이전 글', () => openEntry(previous.id), 'blogSeriesReaderPrevious', 'blog-series-reader-step');
      const after = button('다음 글', () => openEntry(next.id), 'blogSeriesReaderNext', 'blog-series-reader-step');
      before.disabled = !previous; after.disabled = !next;
      for (const [control, item, label] of [[before, previous, '이전 글'], [after, next, '다음 글']]) {
        control.setAttribute('aria-label', item ? label + ': ' + title(item) : label + ' 없음');
        if (item) control.append(node('span', title(item), 'blog-series-reader-step-title'));
      }
      navigation.append(before, button('목차로 돌아가기', () => contents({ restore: true }), 'blogSeriesReaderContentsBottom'), after);
      return navigation;
    }
    async function openEntry(id) {
      if (!current() || !snapshot) { expired(); return; }
      const index = snapshot.series.items.findIndex(item => item.id === id);
      if (index < 0) { contents({ missing: true }); return; }
      const token = ++epoch; view = 'entry'; entryId = id; shell('entry'); surface.dataset.entryId = id;
      const navigation = node('nav', null, 'life-actions blog-series-reader-entry-actions'); navigation.setAttribute('aria-label', '모음 목차');
      navigation.append(button('목차로 돌아가기', () => contents({ restore: true }), 'blogSeriesReaderContents'),
        node('span', (index + 1) + ' / ' + snapshot.series.items.length, 'life-meta blog-series-reader-position'));
      const body = node('div', null, 'blog-series-reader-body'); body.setAttribute('aria-busy', 'true');
      const loading = node('p', '글을 여는 중…', 'life-help'); loading.setAttribute('role', 'status'); body.append(loading);
      surface.append(navigation, body, pagination(index));
      try {
        const rendered = await renderPhoto(structuredClone(snapshot.posts[index].doc));
        if (!current(token) || view !== 'entry' || entryId !== id) { rendered?.dispose?.(); expired(); return; }
        if (!rendered?.node || typeof rendered.dispose !== 'function') {
          rendered?.dispose?.(); throw new Error('글 읽기 화면을 준비하지 못했습니다. 다시 시도해 주세요.');
        }
        photoView = rendered; body.replaceChildren(rendered.node); body.setAttribute('aria-busy', 'false');
        const heading = rendered.node.querySelector('h1,h2');
        if (heading) heading.tabIndex = -1;
        else { body.tabIndex = -1; body.setAttribute('aria-label', title(snapshot.series.items[index])); }
        focus(heading || body, token);
      } catch (_) {
        if (!current(token)) { expired(); return; }
        body.setAttribute('aria-busy', 'false');
        const error = node('p', '이 글을 열지 못했습니다. 같은 사본을 다시 열거나 목차로 돌아가 주세요.', 'life-error'); error.setAttribute('role', 'alert');
        body.replaceChildren(error, button('이 글 다시 열기', () => openEntry(id), 'blogSeriesReaderRetryEntry'));
      }
    }
    async function load(requestedId) {
      const token = ++epoch; snapshot = null; view = 'loading'; entryId = null; shell('loading');
      surface.setAttribute('aria-busy', 'true'); surface.append(listActions());
      const loading = node('p', '모음을 여는 중…', 'life-help'); loading.setAttribute('role', 'status'); surface.append(loading);
      try {
        const value = await storage.readBlogSeriesSnapshot(workspaceId, seriesId);
        if (!current(token)) { expired(); return; }
        root.HaedoLife.BlogSeries.validateSnapshot(value);
        if (value.series.id !== seriesId) throw Object.assign(new Error('모음 식별자가 다릅니다.'), { code: 'invalid_blog_series' });
        snapshot = value;
        if (requestedId) await openEntry(requestedId); else contents();
      } catch (cause) {
        if (!current(token)) { expired(); return; }
        view = 'error'; shell('error'); surface.append(listActions());
        const error = node('p', errorText(cause), 'life-error blog-series-reader-error'); error.setAttribute('role', 'alert');
        surface.append(error, button('모음 다시 불러오기', () => load(requestedId), 'blogSeriesReaderRetry'));
      }
    }
    async function mount(target, { seriesId: id, entryId: requestedId = null } = {}) {
      detach();
      if (disposed || !isCurrent() || !target?.isConnected) return;
      if (seriesId !== id) tocPosition = null;
      seriesId = id; host = target; surface = node('section', null, 'blog-series-reader'); surface.setAttribute('aria-label', '모음 읽기');
      host.replaceChildren(surface); await load(requestedId);
    }
    function detach() {
      epoch++; releasePhoto(); surface?.remove(); host = surface = snapshot = null; entryId = null; view = 'contents';
    }
    function dispose() { detach(); disposed = true; tocPosition = null; seriesId = null; }
    return Object.freeze({ mount, flush: async () => true, dirty: () => false, detach, dispose });
  }
  return Object.freeze({ create });
});
