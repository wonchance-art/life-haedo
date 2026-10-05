/* Anonymous reader. No Auth client, private storage, offline snapshot or SDK session. */
(function (root) {
  'use strict';
  const status = document.getElementById('shareStatus');
  const content = document.getElementById('shareContent');
  const updated = document.getElementById('shareUpdated');
  const refresh = document.getElementById('shareRefresh');
  const life = root.HaedoLife;
  refresh.append(life.Icons.create('cloud'));
  let generation = 0, timer = null, reader = null, renderedRevision = null;
  const values = new URL(root.location.href).searchParams.getAll('id');
  const publicId = values.length === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values[0]) ? values[0] : null;
  function clear() {
    clearTimeout(timer); timer = null; generation++;
    reader?.dispose(); reader = null;
    content.replaceChildren(); updated.textContent = ''; updated.hidden = true;
    renderedRevision = null;
    content.removeAttribute('aria-busy'); refresh.disabled = false;
    document.title = '공유 페이지 · 해도';
  }
  function message(text, state) { status.textContent = text; status.dataset.state = state; }
  async function load({ background = false } = {}) {
    if (background) {
      clearTimeout(timer); timer = null; generation++;
      reader?.dispose(); reader = null;
    } else clear();
    if (document.hidden) { message('페이지로 돌아오면 공개 상태를 다시 확인합니다.', 'paused'); return; }
    if (!publicId) { message('공유 주소를 확인해 주세요.', 'missing'); refresh.hidden = true; return; }
    const token = generation;
    refresh.disabled = true; content.setAttribute('aria-busy', 'true');
    if (!background) message('공유 페이지를 확인하는 중입니다.', 'loading');
    try {
      reader = life.ShareRemote.createReader({ config: root.HAEDO_CONFIG });
      const response = await reader.read(publicId);
      if (token !== generation || document.hidden) return;
      if (response.status !== 'published') {
        content.replaceChildren(); updated.hidden = true; renderedRevision = null;
        document.title = '공유 페이지 · 해도';
        message('공개된 페이지가 없습니다. 주소가 바뀌었거나 공개가 종료됐을 수 있습니다.', 'missing');
        return;
      }
      if (renderedRevision !== response.revision || !content.childElementCount) {
        const view = life.ShareView.render(response.snapshot);
        view.setAttribute('aria-label', '공개된 페이지');
        content.replaceChildren(view); renderedRevision = response.revision;
      }
      message('', 'published');
      document.title = response.snapshot.title + ' · 해도';
      const date = new Date(response.updatedAt);
      if (Number.isFinite(date.getTime())) {
        updated.textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date) + '에 공개본 갱신';
        updated.hidden = false;
      }
      timer = setTimeout(() => load({ background: true }), 30000);
    } catch (error) {
      if (token !== generation || document.hidden) return;
      content.replaceChildren(); updated.hidden = true; renderedRevision = null;
      document.title = '공유 페이지 · 해도';
      const text = error.code === 'config_missing' || error.code === 'invalid_config' ? '공유 연결 설정을 확인할 수 없습니다. 잠시 후 다시 열어 주세요.' :
        '공개 상태를 확인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.';
      message(text, 'error');
    } finally {
      if (token === generation) { content.removeAttribute('aria-busy'); refresh.disabled = false; }
    }
  }
  refresh.addEventListener('click', load);
  document.addEventListener('visibilitychange', load);
  root.addEventListener('pagehide', () => { clear(); message('공개 상태를 다시 확인합니다.', 'paused'); });
  root.addEventListener('pageshow', event => { if (event.persisted) load(); });
  root.addEventListener('offline', () => { clear(); message('인터넷 연결 후 공개 상태를 다시 확인해 주세요.', 'error'); });
  root.addEventListener('online', load);
  load();
})(globalThis);
