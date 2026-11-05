/* On-demand settings panel; text only, no third-party requests or remote images. */
(function (root) {
  'use strict';
  const STATES = { pending: '기준 목록 확인 전', preview: '새 글 수집 시작 전', active: '새 글 수집 설정됨', paused: '수집 중지됨', disconnected: '연결 해제됨' };
  const REASONS = { identity_conflict: '식별자가 겹쳐 확인 필요', date_unknown: '발행일 확인 필요', old_observed: '이전에 발행된 글', future_date: '발행일 확인 필요', content_too_large: '본문이 자료 보관 한도를 넘음',
    missing_url: '원문 주소 확인 필요', missing_content: '본문을 받지 못함', invalid_date: '발행일 형식 확인 필요', missing_identity: '항목 식별자 확인 필요',
    unsupported_content: '지원하지 않는 본문 형식', ambiguous_links: '원문 주소가 여러 개여서 확인 필요' };
  function node(tag, text, className) {
    const value = root.document.createElement(tag);
    if (text !== undefined) value.textContent = text;
    if (className) value.className = className;
    return value;
  }
  function create({ service, container, isCurrent = () => true, onClose = () => {}, auth = root.HaedoAuth } = {}) {
    let disposed = false, busy = false, page = null, serial = 0;
    const element = node('section', undefined, 'life-management'); element.id = 'rssConnectionPanel'; element.setAttribute('aria-label', 'RSS 연결');
    const heading = node('h3', 'RSS/Atom 연결'); heading.tabIndex = -1;
    const status = node('p', '', 'life-help'); status.id = 'rssStatus'; status.setAttribute('role', 'status');
    const error = node('p', '', 'life-error'); error.id = 'rssError'; error.setAttribute('role', 'alert'); error.hidden = true;
    const label = node('label', '피드 주소'); label.htmlFor = 'rssFeedUrl';
    const input = node('input'); input.id = 'rssFeedUrl'; input.type = 'url'; input.autocomplete = 'url'; input.placeholder = 'https://…'; input.style.width = '100%'; input.style.minHeight = '44px';
    const button = (text, callback, id) => { const value = node('button', text, 'life-button'); value.type = 'button'; if (id) value.id = id; value.addEventListener('click', callback); return value; };
    const register = button('연결 등록', () => run(progress => service.register(input.value.trim(), progress)), 'rssRegister');
    const refresh = button('상태 새로고침', () => run(progress => service.list(progress)), 'rssRefresh');
    const close = button('닫기', () => { dispose(); onClose(); }, 'rssClose');
    const rows = node('div'), items = node('div'), reader = node('section'); reader.hidden = true;
    element.append(heading, node('p', '새 글만 비공개로 모읍니다. 처음 확인한 목록은 기준으로만 남기고 가져오지 않습니다.', 'life-help'),
      node('p', '60분 간격 · 한 번에 100항목 이내. 피드가 제공한 본문만 보관하며 사진·영상·댓글은 받지 않습니다.', 'life-help'),
      label, input, register, refresh, close, status, error, rows, items, reader);
    container.append(element);
    const current = () => !disposed && isCurrent() && element.isConnected;
    function controls() {
      element.setAttribute('aria-busy', String(busy));
      element.querySelectorAll('button').forEach(value => { if (value !== close) value.disabled = busy; });
      input.disabled = busy;
      if (page && !page.configured) register.disabled = true;
      if (page?.connections.some(conn => conn.status !== 'disconnected')) register.disabled = true;
    }
    async function run(action) {
      if (busy || !current()) return;
      busy = true; error.textContent = ''; error.hidden = true; status.textContent = '확인 중…'; controls(); const request = ++serial;
      try {
        const result = await action(count => { if (current() && request === serial) status.textContent = '받은 글 ' + count + '개 확인 · 나머지 보관 중…'; }); if (!current() || request !== serial) return;
        page = result; paint();
      } catch (cause) {
        if (!current() || request !== serial) return;
        error.textContent = root.HaedoLife.RssConnection.messages[cause?.code] || '요청을 마치지 못했습니다. 입력과 기존 자료는 유지됩니다.';
        error.hidden = false;
        status.textContent = '';
      } finally { if (current() && request === serial) { busy = false; controls(); } }
    }
    function showItem(item) {
      if (!current()) return;
      reader.replaceChildren(); reader.hidden = false;
      const title = node('h4', item.title || '제목 없는 RSS 글'); title.tabIndex = -1;
      const body = node('pre', item.content_text, 'nv-capture-body'); body.id = 'rssItemBody'; body.style.whiteSpace = 'pre-wrap'; body.style.overflowWrap = 'anywhere';
      reader.append(title, node('p', '피드가 제공한 본문 · 사진·영상·댓글 미보관', 'life-help'), body);
      if (item.url) {
        const origin = node('a', '원문 열기', 'life-button'); origin.href = item.url; origin.target = '_blank'; origin.rel = 'noopener noreferrer';
        reader.append(origin);
      }
      title.focus();
    }
    function paint() {
      rows.replaceChildren(); items.replaceChildren(); reader.replaceChildren(); reader.hidden = true;
      status.textContent = page.configured ? '연결 상태를 확인했습니다.' : 'RSS 연결을 준비 중입니다. 피드 주소가 확정되면 연결할 수 있습니다.';
      if (page.execution?.status === 'not_due') status.textContent = root.HaedoLife.RssConnection.messages.rss_not_due;
      else if (page.execution?.status === 'stale') status.textContent = root.HaedoLife.RssConnection.messages.rss_stale;
      else if (page.execution?.status === 'busy') status.textContent = root.HaedoLife.RssConnection.messages.rss_busy;
      else if (page.execution?.status === 'error') status.textContent = '이번 확인을 마치지 못했습니다. 기존 자료는 유지됩니다.';
      else if (page.execution?.status === 'partial') status.textContent = page.connections.some(conn => conn.status === 'pending') ?
        '기준 목록 일부를 확인했습니다. 나머지 목록을 이어서 확인합니다.' : '새 글 일부를 보관했습니다. 남은 새 글을 이어서 확인합니다.';
      if (page.execution?.error) { error.textContent = root.HaedoLife.RssConnection.messages[page.execution.error] || root.HaedoLife.RssConnection.messages.rss_network_error; error.hidden = false; }
      if (page.receiveError) { error.textContent = page.receiveError; error.hidden = false; }
      for (const conn of page.otherConnections || []) {
        const elsewhere = node('section'); elsewhere.dataset.rssOtherConnection = conn.id;
        const address = node('p', conn.feed_url, 'life-meta'); address.style.overflowWrap = 'anywhere';
        elsewhere.append(node('p', '다른 자료공간의 RSS 연결 · ' + STATES[conn.status]), address,
          node('p', '기존 연결의 자료공간에서 수집 상태를 변경할 수 있습니다.', 'life-help'));
        rows.append(elsewhere);
      }
      for (const conn of page.connections) {
        const line = node('section'); line.dataset.rssConnection = conn.id;
        const address = node('p', conn.feed_url, 'life-meta'); address.style.overflowWrap = 'anywhere';
        line.append(address, node('p', conn.last_error && ['pending', 'active'].includes(conn.status) ?
          conn.status === 'pending' ? '기준 목록 확인 중지됨' : '새 글 확인 중지됨' : STATES[conn.status]));
        if (conn.baseline_at) line.append(node('p', '기준 목록 ' + conn.baseline_count + '개 · 과거 글은 가져오지 않음', 'life-help'));
        if (conn.next_check_at && conn.status === 'active' && !conn.last_error && Number.isFinite(Date.parse(conn.next_check_at))) {
          line.append(node('p', '다음 확인 가능: ' + new Date(conn.next_check_at).toLocaleString('ko-KR'), 'life-help'));
        }
        if (conn.last_error) line.append(node('p', root.HaedoLife.RssConnection.messages[conn.last_error] || '마지막 확인을 마치지 못했습니다. 다시 시도해 주세요.', 'life-error'));
        const actions = conn.status === 'pending' ? conn.last_error ? [] : [['preview', '기준 목록 미리보기']] : conn.status === 'preview' ? [['activate', '새 글만 수집 시작']] :
          conn.status === 'active' ? [...(conn.last_error ? [] : [['poll', '새 글 확인']]), ['pause', '수집 중지']] : conn.status === 'paused' ? [['resume', '수집 재개']] : [];
        if (conn.last_error && ['pending', 'active'].includes(conn.status) && !['baseline_page_limit', 'catchup_page_limit'].includes(conn.last_error)) actions.push(['retry', '다시 시도']);
        if (conn.status !== 'disconnected') actions.push(['disconnect', '연결 해제']);
        for (const [action, text] of actions) {
          const control = button(text, () => {
            if (busy || !current()) return;
            if (action === 'disconnect' && !root.confirm('받은 자료는 그대로 유지됩니다. 다시 연결하면 기준 목록부터 새로 만듭니다. 연결을 해제할까요?')) return;
            run(progress => service.action(action, conn, progress));
          }); control.dataset.rssAction = action;
          line.append(control);
        }
        if (conn.status === 'disconnected') line.append(node('p', '수집은 멈췄습니다. 이미 보관한 자료는 유지됩니다.', 'life-help'));
        rows.append(line);
      }
      items.append(node('h4', '받은 글'));
      if (!page.items.length) items.append(node('p', '아직 받은 새 글이 없습니다.', 'life-help'));
      for (const item of page.items) {
        const line = node('div');
        if (item.disposition === 'held') line.append(node('p', (item.title || '제목 없는 글') + ' · ' + (REASONS[item.reason] || '확인 필요 · 보관 보류'), 'life-help'));
        else {
          const open = button(item.title || '제목 없는 RSS 글', () => showItem(item)); open.dataset.rssItem = item.id;
          line.append(open, node('p', item.sourceId ? '자료에 보관됨 · 계정 동기화 상태는 자료에서 확인' : '서버 수신함에 보관됨', 'life-meta'));
        }
        items.append(line);
      }
      if (page.hasMore) items.append(button('더 보기', () => run(progress => service.more(page.nextCursor, progress)), 'rssMore'));
      controls();
    }
    const owner = auth?.getAccount?.(), openingEpoch = auth?.epoch;
    const unlisten = auth?.onAccountChange?.(() => {
      const account = auth.getAccount?.();
      if (auth.epoch !== openingEpoch || account?.userId !== owner?.userId || account?.projectUrl !== owner?.projectUrl) { dispose(); onClose(); }
    });
    function dispose() { if (disposed) return; disposed = true; serial++; service.dispose(); unlisten?.(); element.remove(); }
    run(progress => service.list(progress)); heading.focus();
    return Object.freeze({ element, dispose });
  }
  (root.HaedoLife ||= {}).RssConnectionUI = Object.freeze({ create });
})(globalThis);
