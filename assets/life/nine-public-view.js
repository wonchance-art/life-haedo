/* Public 3x3 metadata reading. No Auth, SDK, private storage or offline copy. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).NinePublicView = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document?.getElementById('ninePublicContent')) api.start();
})(globalThis, function (root) {
  'use strict';
  const life = () => root.HaedoLife;
  function serial(data) {
    return JSON.stringify([data.title, data.intro, data.areaTitle,
      data.items.map(item => item ? [item.type, item.title, item.creator, item.url] : null)]);
  }
  function render(snapshot, { document = root.document } = {}) {
    const data = life().NinePublic.parse(snapshot);
    const node = (tag, text, cls) => {
      const value = document.createElement(tag); if (text != null) value.textContent = text; if (cls) value.className = cls; return value;
    };
    let active = true, selected = null, position = null, imagesOn = false, mediaCleanups = [];
    const article = node('article', null, 'np-document'), intro = node('header', null, 'np-intro');
    intro.append(node('h1', data.title, 'np-title'));
    if (data.intro) intro.append(node('p', data.intro, 'np-description'));
    article.append(intro, node('h2', data.areaTitle, 'np-area-title'));
    const grid = node('ol', null, 'np-grid'); grid.setAttribute('aria-label', data.areaTitle + ' · 아홉 칸');
    const detail = node('section', null, 'np-detail'); detail.id = 'ninePublicDetail'; detail.hidden = true; detail.tabIndex = -1;
    const tiles = [], covers = [];
    function readingPosition(tile) {
      const parents = [];
      for (let parent = tile.parentElement; parent; parent = parent.parentElement) {
        if (parent === document.scrollingElement || parent === document.body || parent === document.documentElement) continue;
        const style = root.getComputedStyle(parent);
        if (/(auto|scroll|hidden|overlay)/.test(style.overflowX + ' ' + style.overflowY) &&
            (parent.scrollHeight > parent.clientHeight || parent.scrollWidth > parent.clientWidth))
          parents.push({ node: parent, x: parent.scrollLeft, y: parent.scrollTop });
      }
      return { x: root.scrollX, y: root.scrollY, parents };
    }
    const focusLater = (target, scroll) => {
      root.requestAnimationFrame(() => {
        if (!active || !article.isConnected || !target.isConnected) return;
        target.focus({ preventScroll: true });
        if (scroll) {
          for (const saved of scroll.parents || []) if (saved.node.isConnected && saved.node.contains(target))
            saved.node.scrollTo({ top: saved.y, left: saved.x, behavior: 'instant' });
          root.scrollTo({ top: scroll.y, left: scroll.x, behavior: 'instant' });
        }
        else target.scrollIntoView({ block: 'start', behavior: 'instant' });
      });
    };
    function closeDetail() {
      if (!active || selected === null) return;
      const target = tiles[selected], scroll = position;
      target.setAttribute('aria-expanded', 'false'); selected = null; position = null; detail.hidden = true; detail.replaceChildren();
      focusLater(target, scroll);
    }
    function openDetail(index) {
      if (!active || !article.isConnected) return;
      if (selected === index) { closeDetail(); return; }
      const item = data.items[index];
      if (selected !== null) tiles[selected].setAttribute('aria-expanded', 'false');
      selected = index; position = readingPosition(tiles[index]); tiles[index].setAttribute('aria-expanded', 'true');
      const heading = node('h3', item.title, 'np-detail-title'); heading.tabIndex = -1;
      const fields = node('dl', null, 'np-detail-meta');
      for (const [label, value] of [['만든 사람', item.creator || '표시된 정보 없음'], ['종류', life().Collection.TYPES[item.type]]]) {
        fields.append(node('dt', label), node('dd', value));
      }
      detail.replaceChildren(heading, fields);
      if (item.url) {
        const source = node('a', item.url, 'np-source-link'); source.href = item.url; source.target = '_blank';
        source.rel = 'noopener noreferrer'; source.referrerPolicy = 'no-referrer'; source.setAttribute('aria-label', item.title + ' · 출처 열기'); detail.append(source);
      } else detail.append(node('p', '출처 주소가 없습니다.', 'np-source-empty'));
      const close = node('button', '9칸으로 돌아가기', 'life-button np-detail-close'); close.type = 'button'; close.addEventListener('click', closeDetail);
      detail.append(close); detail.hidden = false; focusLater(heading);
    }
    for (const [index, item] of data.items.entries()) {
      const cell = node('li', null, 'np-cell');
      if (!item) {
        cell.classList.add('np-cell-empty'); cell.setAttribute('aria-label', (index + 1) + '번째 칸 · 비어 있음');
        const empty = node('div', null, 'np-empty'); empty.append(node('span', index + 1, 'np-position'), node('span', '빈 칸')); cell.append(empty);
      } else {
        const tile = node('button', null, 'np-tile'); tile.type = 'button'; tile.dataset.index = index;
        tile.setAttribute('aria-label', (index + 1) + '번째 칸 · ' + item.title + ' · 상세 보기');
        tile.setAttribute('aria-expanded', 'false'); tile.setAttribute('aria-controls', 'ninePublicDetail');
        const descriptor = life().CollectionMedia?.describe(item);
        if (descriptor?.provider === 'Open Library' && descriptor.image && item.type === 'book') {
          const cover = node('span', null, 'np-cover'); cover.hidden = true;
          const status = node('span', '', 'np-media-status'); cover.append(status); tile.append(cover); covers.push({ cover, status, descriptor });
        }
        tile.append(node('span', index + 1, 'np-position'), node('span', item.title, 'np-item-title'));
        if (item.creator) tile.append(node('span', item.creator, 'np-creator'));
        tile.append(node('span', life().Collection.TYPES[item.type], 'np-type'));
        tile.addEventListener('click', () => openDetail(index)); tiles[index] = tile; cell.append(tile);
      }
      grid.append(cell);
    }
    function stopImages() {
      mediaCleanups.forEach(cleanup => cleanup()); mediaCleanups = [];
      for (const { cover, status } of covers) { cover.replaceChildren(status); cover.hidden = true; status.hidden = false; status.textContent = ''; }
      imagesOn = false;
    }
    if (covers.length) {
      const options = node('section', null, 'np-media-options'), toggle = node('button', '책 표지 보기', 'life-button np-media-toggle');
      toggle.type = 'button'; toggle.setAttribute('aria-pressed', 'false');
      options.append(toggle, node('p', '표지를 켜면 Open Library에 연결합니다. 제목과 출처는 표지 없이도 볼 수 있습니다.', 'np-media-status'));
      toggle.addEventListener('click', () => {
        if (!active || !article.isConnected) return;
        if (imagesOn) stopImages();
        else {
          imagesOn = true;
          for (const { cover, status, descriptor } of covers) {
            cover.hidden = false;
            mediaCleanups.push(life().CollectionMedia.mount({ host: cover, descriptor, onState(state) {
              if (!active || !imagesOn) return;
              cover.dataset.state = state; status.hidden = state === 'ready';
              status.textContent = state === 'loading' ? '표지를 여는 중…' : state === 'error' ? '표지를 열지 못했습니다.' : '';
            } }));
          }
        }
        toggle.textContent = imagesOn ? '책 표지 끄기' : '책 표지 보기'; toggle.setAttribute('aria-pressed', String(imagesOn));
      });
      article.append(options);
    }
    article.append(grid, detail);
    return Object.freeze({ node: article, dispose() { if (!active) return; active = false; stopImages(); selected = null; position = null; article.replaceChildren(); } });
  }
  function start({ document = root.document, window = root, createReader = options => life().ShareRemote.createReader(options), intervalMs = 30000 } = {}) {
    const content = document.getElementById('ninePublicContent'), status = document.getElementById('ninePublicStatus');
    const updated = document.getElementById('ninePublicUpdated'), refresh = document.getElementById('ninePublicRefresh');
    if (!content || !status || !updated || !refresh) throw new Error('공개 9칸 화면을 준비하지 못했습니다.');
    const values = new URL(window.location.href).searchParams.getAll('nine');
    const publicId = values.length === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values[0]) ? values[0].toLowerCase() : null;
    let epoch = 0, timer = null, reader = null, view = null, serialized = null, disposed = false;
    const message = (text, state) => { status.textContent = text; status.dataset.state = state; };
    function cancel() { epoch++; if (timer !== null) window.clearTimeout(timer); timer = null; reader?.dispose(); reader = null; }
    function clearView() {
      view?.dispose(); view = null; content.replaceChildren(); serialized = null;
      updated.hidden = true; updated.textContent = ''; content.removeAttribute('aria-busy'); document.title = '9칸 · 해도';
    }
    function pause(text, state) { cancel(); clearView(); refresh.disabled = false; message(text, state); }
    async function load() {
      if (disposed) return;
      cancel(); const token = epoch;
      if (document.hidden) { clearView(); refresh.disabled = false; message('돌아오면 공개 상태를 다시 확인합니다.', 'paused'); return; }
      if (window.navigator.onLine === false) { clearView(); refresh.disabled = false; message('인터넷 연결 후 공개 상태를 다시 확인해 주세요.', 'error'); return; }
      if (!publicId) { clearView(); message('9칸 주소를 확인해 주세요.', 'missing'); refresh.hidden = true; return; }
      refresh.disabled = true; content.setAttribute('aria-busy', 'true');
      if (!view) message('공개한 9칸을 확인하고 있습니다…', 'loading');
      try {
        reader = createReader({ config: window.HAEDO_CONFIG });
        const response = await reader.read(publicId);
        if (disposed || token !== epoch || document.hidden) return;
        if (response?.status !== 'published') { clearView(); message('공개된 9칸이 없습니다. 주소가 바뀌었거나 공개가 종료됐을 수 있습니다.', 'missing'); return; }
        const data = life().NinePublic.parse(response.snapshot), next = serial(data);
        if (next !== serialized || !content.childElementCount) {
          const nextView = render(response.snapshot, { document }); view?.dispose(); view = nextView;
          content.replaceChildren(view.node); serialized = next;
        }
        document.title = data.title + ' · 해도'; message('', 'published');
        updated.textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(response.updatedAt)) + '에 공개본 갱신'; updated.hidden = false;
        timer = window.setTimeout(load, intervalMs);
      } catch (cause) {
        if (disposed || token !== epoch || document.hidden) return;
        clearView(); message(['config_missing', 'invalid_config'].includes(cause?.code) ? '공개 연결을 준비하지 못했습니다. 잠시 후 다시 확인해 주세요.' : '공개 상태를 확인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.', 'error');
      } finally { if (!disposed && token === epoch) { content.removeAttribute('aria-busy'); refresh.disabled = false; } }
    }
    const visibility = () => { if (document.hidden) pause('돌아오면 공개 상태를 다시 확인합니다.', 'paused'); else load(); };
    const hide = () => pause('공개 상태를 다시 확인합니다.', 'paused');
    const show = event => { if (event.persisted) load(); };
    const offline = () => pause('인터넷 연결 후 공개 상태를 다시 확인해 주세요.', 'error');
    refresh.addEventListener('click', load); document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show); window.addEventListener('offline', offline); window.addEventListener('online', load);
    load();
    return Object.freeze({ load, dispose() {
      if (disposed) return; disposed = true; cancel(); clearView();
      refresh.removeEventListener('click', load); document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); window.removeEventListener('offline', offline); window.removeEventListener('online', load);
    } });
  }
  return Object.freeze({ render, start });
});
