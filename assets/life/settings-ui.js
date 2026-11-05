/* 설정 화면의 배치: 넓은 화면은 왼쪽 항목 목록 + 오른쪽 상세, 좁은 화면은 묶음별 행과 현재 값.
 * 2026-11-03 부드러운 판 묶음 E. 행의 동작(자료공간·계정 보관·백업·공개 페이지)은 ui.js가 만들고
 * 이 모듈은 배치·하위 항목 해시·뉴스 언어 값·연표 표시 설정(기존 저장값만)을 맡는다.
 * 새 저장 키·계정 동기화 문서·스키마는 만들지 않는다. 일정의 주 시작(월요일)·처음 여는 단계(일정 목록)·
 * 행복도 입력 단위(날마다)는 소유자 결정(11-03)으로 고정값이라 설정 행을 두지 않는다. */
(function (root) {
  'use strict';
  const life = () => root.HaedoLife;
  // 하위 항목: 해시 `#settings-<id>`. 좁은 화면 묶음: 계정(계정·자료공간), 뉴스, 일정, 보관(백업·공개 페이지).
  const ITEMS = Object.freeze([
    { id: 'account', title: '계정' },
    { id: 'workspace', title: '자료공간', group: 'account' },
    { id: 'news', title: '뉴스' },
    { id: 'schedule', title: '일정' },
    { id: 'backup', title: '백업', narrowTitle: '보관' },
    { id: 'public', title: '공개 페이지', group: 'backup' },
    { id: 'keys', title: '단축키', wideOnly: true }
  ]);
  const HASH = /^#settings-(account|workspace|news|schedule|backup|public|keys)$/;
  // 연표(assets/app.js)가 읽는 기존 기기 저장값. 값과 해석은 app.js의 MA_SIGMA·AGE_MODE와 같다.
  const CURVE_KEY = 'caeyeon_life_ma', CURVE_STEPS = [0, 36, 60];
  const CURVE = { 0: ['기록', '적은 값 그대로'], 36: ['시기', '그 해의 기조'], 60: ['흐름', '인생의 궤적'] };
  const AGE_KEY = 'caeyeon_life_age', AGE = [['intl', '만 나이'], ['kr', '한국 나이']];
  // 앱에 이미 있는 단축키만 적는다(writing-ui·source-edit-ui·app.js의 keydown 처리).
  const SHORTCUTS = Object.freeze([
    ['자료 작성·자료 수정', [['⌘ S', '저장']]],
    ['연표', [['⌘ F · ⌘ K', '검색'], ['⌘ Z', '되돌리기'], ['⇧ ⌘ Z · ⌘ Y', '다시 하기'], ['Delete', '선택 항목 지우기']]],
    ['메뉴·창', [['Esc', '닫기']]]
  ]);

  function node(tag, text, className) {
    const el = root.document.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = String(text);
    if (className) el.className = className;
    return el;
  }
  const glyph = name => life().Icons.create(name);
  // Load the private connection controls only after the owner opens this row.
  let rssLoading = null;
  function loadRss() {
    if (life().RssConnection && life().RssConnectionUI) return Promise.resolve();
    if (!rssLoading) rssLoading = ['rss-connection.js', 'rss-connection-ui.js'].reduce((chain, name) => chain.then(() => new Promise((resolve, reject) => {
      const script = root.document.createElement('script'); script.src = new URL('assets/life/' + name, root.document.baseURI).href;
      script.onload = resolve; script.onerror = () => { script.remove(); reject(new Error('rss_module_unavailable')); };
      root.document.head.append(script);
    })), Promise.resolve()).catch(error => { rssLoading = null; throw error; });
    return rssLoading;
  }

  // 저장값 읽기: app.js와 같은 규칙(없음·빈 값·숫자 아님 = 36, 다른 값은 가까운 칸, 동점은 큰 쪽). 읽기만 하고 고쳐 쓰지 않는다.
  function readCurve(storage) {
    let raw = null;
    try { raw = storage?.getItem(CURVE_KEY); } catch (_) { return 36; }
    if (raw == null || raw === '') return 36;
    const value = +raw; if (!Number.isFinite(value)) return 36;
    return CURVE_STEPS.reduce((a, b) => Math.abs(b - value) <= Math.abs(a - value) ? b : a, CURVE_STEPS[0]);
  }
  function readAge(storage) { try { return storage?.getItem(AGE_KEY) === 'kr' ? 'kr' : 'intl'; } catch (_) { return 'intl'; } }

  // 행 하나: 이름(+보조 줄) · 현재 값 · 화살표. onClick은 호출하는 쪽의 보호(guarded)를 거친 처리다.
  // 접근 가능한 이름은 항목 이름(ariaLabel)이고, 현재 값·보조 줄·설명은 aria-describedby로 읽힌다.
  let rowSequence = 0;
  function row({ label, ariaLabel, sub, value, valueId, onClick, id, focusKey, description }) {
    const control = node('button', null, 'life-destination life-action-row settings-row'); control.type = 'button';
    const key = 'lifeSettingsRow' + (++rowSequence), described = [];
    if (ariaLabel) control.setAttribute('aria-label', ariaLabel);
    if (id) control.id = id;
    if (focusKey) control.dataset.focusKey = focusKey;
    const shown = node('span', value ?? '', 'life-meta settings-row-value'); shown.id = valueId || key + 'Value'; described.push(shown.id);
    control.append(node('strong', label, 'settings-row-label'), shown);
    if (sub !== undefined && sub !== null) { const line = node('span', sub, 'life-meta settings-row-sub'); line.id = key + 'Sub'; described.push(line.id); control.append(line); }
    if (description) { const extra = node('span', description); extra.id = key + 'Description'; extra.hidden = true; described.push(extra.id); control.append(extra); }
    control.setAttribute('aria-describedby', described.join(' '));
    control.append(glyph('chevron'));
    if (onClick) control.addEventListener('click', onClick);
    return control;
  }

  // 곡선 미리보기: 같은 9개 기록을 이동평균 폭만 바꿔 그린다(설명용 그림, 저장 자료 아님).
  const SAMPLE = [34.8, 18, 32, 23.6, 12.4, 29.2, 20.8, 40.4, 26.4];
  function curvePreview(step) {
    const ns = 'http://www.w3.org/2000/svg', svg = root.document.createElementNS(ns, 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 180 52', width: '100%', height: '52', 'aria-hidden': 'true', focusable: 'false', class: 'settings-curve-preview', preserveAspectRatio: 'none' })) svg.setAttribute(key, value);
    const x = i => 10 + i * 20, sigma = step === 0 ? 0 : step === 36 ? 0.9 : 2.2;
    const at = t => {
      if (!sigma) { const i = Math.min(SAMPLE.length - 2, Math.floor(t)); return SAMPLE[i] + (SAMPLE[i + 1] - SAMPLE[i]) * (t - i); }
      let sum = 0, weight = 0;
      SAMPLE.forEach((y, i) => { const w = Math.exp(-((t - i) ** 2) / (2 * sigma * sigma)); sum += w * y; weight += w; });
      return sum / weight;
    };
    const points = []; for (let t = 0; t <= SAMPLE.length - 1 + 1e-9; t += 0.1) points.push((10 + t * 20).toFixed(1) + ',' + at(t).toFixed(1));
    const line = root.document.createElementNS(ns, 'polyline');
    line.setAttribute('points', points.join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-linecap', 'round'); line.setAttribute('stroke-linejoin', 'round');
    svg.append(line);
    SAMPLE.forEach((y, i) => { const dot = root.document.createElementNS(ns, 'circle'); dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y); dot.setAttribute('r', '2.5'); dot.setAttribute('fill', 'currentColor'); svg.append(dot); });
    return svg;
  }

  function create(options = {}) {
    const { rows = {}, account = null, news = null, localStorage = root.localStorage, isCurrent = () => true } = options;
    let disposed = false;
    const cleanups = [];
    const listen = (target, type, handler, opts) => { target?.addEventListener(type, handler, opts); cleanups.push(() => target?.removeEventListener(type, handler, opts)); };
    const element = node('div', null, 'settings'); element.id = 'lifeSettings';
    const layout = node('div', null, 'settings-layout');
    const index = node('nav', null, 'settings-index'); index.setAttribute('aria-label', '설정 항목');
    const list = node('ul'); index.append(list);
    const body = node('div', null, 'settings-body');
    layout.append(index, body); element.append(layout);
    const links = new Map(), sections = new Map();

    function section(item, content) {
      const box = node('section', null, 'settings-section'); box.id = 'settings-' + item.id; box.dataset.settingsItem = item.id;
      if (item.group) box.dataset.settingsJoin = item.group;
      if (item.wideOnly) box.dataset.settingsWide = '';
      const heading = node('h2', null, 'settings-heading'); heading.id = 'settings-heading-' + item.id; heading.tabIndex = -1;
      if (item.narrowTitle) heading.append(node('span', item.title, 'settings-wide-text'), node('span', item.narrowTitle, 'settings-narrow-text'));
      else heading.textContent = item.title;
      box.setAttribute('aria-labelledby', heading.id);
      const card = node('div', null, 'settings-card');
      for (const part of content.filter(Boolean)) card.append(part);
      box.append(heading, card);
      body.append(box); sections.set(item.id, box);
      const entry = node('li'), link = node('a', item.title, 'settings-index-link');
      link.href = '#settings-' + item.id; link.dataset.settingsItem = item.id;
      link.addEventListener('click', event => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); select(item.id, { focus: true, scroll: true, write: true });
      });
      entry.append(link); list.append(entry); links.set(item.id, link);
      return box;
    }

    // ---------- 계정 ----------
    function accountRows() {
      const out = [];
      const panel = root.document.getElementById('lifeAccount');
      const email = account?.email || '';
      if (panel) {
        // 로그아웃은 기존 계정 메뉴(#lifeAccount) 한 곳에서 한다. 이 행은 그 메뉴를 연다.
        const control = row({ label: '계정', value: email || '내 계정', sub: 'Google 로그인', ariaLabel: '계정', id: 'lifeSettingsAccount', focusKey: 'manage:account',
          onClick: () => {
            if (disposed) return;
            panel.open = true;
            root.requestAnimationFrame(() => root.document.getElementById('lifeLogout')?.focus({ preventScroll: true }));
          } });
        control.setAttribute('aria-controls', 'lifeAccount'); control.setAttribute('aria-expanded', String(!!panel.open));
        listen(panel, 'toggle', () => { if (!element.isConnected) return dispose(); control.setAttribute('aria-expanded', String(!!panel.open)); });
        out.push(control);
      }
      const rssHost = node('div'), rssError = node('p', '', 'life-error'); rssError.setAttribute('role', 'alert'); rssError.hidden = true;
      let rssPanel = null, opening = false;
      const rss = row({ label: 'RSS/Atom 연결', sub: '새 글 비공개 보관', ariaLabel: 'RSS/Atom 연결', id: 'lifeRssOpen', onClick: async () => {
        if (opening || disposed || !isCurrent()) return;
        if (rssPanel) { rssPanel.element.querySelector('h3')?.focus(); return; }
        opening = true; rss.disabled = true; rssError.textContent = ''; rssError.hidden = true;
        try {
          await loadRss();
          if (disposed || !isCurrent() || !element.isConnected) return;
          const service = life().RssConnection.create({ storage: options.storage, workspaceId: options.workspaceId, isCurrent: () => !disposed && isCurrent() });
          rssPanel = life().RssConnectionUI.create({ service, container: rssHost, isCurrent: () => !disposed && isCurrent(), onClose: () => { rssPanel = null; if (!disposed && isCurrent() && rss.isConnected) rss.focus(); } });
        } catch (_) { if (!disposed && isCurrent()) { rssError.textContent = '연결 화면을 준비하지 못했습니다. 로그인 상태를 확인한 뒤 다시 열어 주세요.'; rssError.hidden = false; } }
        finally { opening = false; if (!disposed) rss.disabled = false; }
      } });
      cleanups.push(() => { rssPanel?.dispose(); rssPanel = null; });
      return out.concat(rows.account || [], rss, rssError, rssHost);
    }

    // ---------- 뉴스 ----------
    function newsRows() {
      if (!news) return [];
      const out = [];
      if (news.onOpenInterests) out.push(row({ label: '관심 주제 편집', ariaLabel: '관심 주제 편집', focusKey: 'manage:news-interests', onClick: news.onOpenInterests }));
      if (news.onOpenSettings) {
        const settings = row({ label: '뉴스 설정', sub: '언어 · 추천 · 기록 관리', ariaLabel: '뉴스 설정', valueId: 'lifeSettingsNewsLanguage', focusKey: 'manage:news-settings', onClick: news.onOpenSettings });
        out.push(settings);
        // 값은 저장된 언어 선택만 보인다(공개된 storage API). 읽지 못하면 값 없이 둔다.
        if (news.readLanguages) Promise.resolve().then(news.readLanguages).then(value => {
          if (disposed || !isCurrent() || !settings.isConnected || !value) return;
          const labels = life().DiscoveryLanguageSettings?.CONTENT_LANGUAGE_LABELS || {};
          const languages = value.contentLanguages;
          const text = languages === null ? '전체 언어' : Array.isArray(languages) ? (languages.length ? languages.map(code => labels[code] || code).join(', ') : '언어 선택 없음') : '';
          settings.querySelector('.settings-row-value').textContent = text;
        }).catch(() => {});
      }
      return out;
    }

    // ---------- 일정: 연표 표시(기존 기기 저장값) ----------
    let curveInputs = [], curveSelect = null, ageInputs = [], ageSelect = null;
    function write(key, value) {
      try { localStorage.setItem(key, String(value)); return true; }
      catch (_) { return false; }
    }
    function syncSchedule() {
      const curve = String(readCurve(localStorage)), age = readAge(localStorage);
      for (const input of curveInputs) input.checked = input.value === curve;
      if (curveSelect && curveSelect !== root.document.activeElement) curveSelect.value = curve;
      for (const input of ageInputs) input.checked = input.value === age;
      if (ageSelect && ageSelect !== root.document.activeElement) ageSelect.value = age;
      element.querySelectorAll('[data-settings-curve]').forEach(card => card.dataset.checked = String(card.dataset.settingsCurve === curve));
    }
    function scheduleRows() {
      const out = [];
      const status = node('p', '', 'life-help settings-save-error'); status.setAttribute('role', 'status');
      const apply = (key, value) => {
        const saved = write(key, value);
        status.textContent = saved ? '' : '이 브라우저에 설정을 보관하지 못했습니다. 저장소 설정을 확인해 주세요.';
        syncSchedule();
      };
      // 넓은 화면: 곡선 미리보기 카드. 좁은 화면: 현재 값이 보이는 선택 행.
      const curveGroup = node('div', null, 'settings-choice settings-wide-control');
      const curveLabel = node('span', '행복도 곡선', 'settings-choice-legend'); curveLabel.id = 'lifeSettingsCurveLabel';
      const cards = node('div', null, 'settings-curve-cards'); cards.setAttribute('role', 'radiogroup'); cards.setAttribute('aria-labelledby', curveLabel.id);
      curveGroup.append(curveLabel);
      for (const step of CURVE_STEPS) {
        const card = node('label', null, 'settings-curve-card'); card.dataset.settingsCurve = String(step);
        const input = node('input'); input.type = 'radio'; input.name = 'settingsCurve'; input.value = String(step);
        input.addEventListener('change', () => { if (input.checked) apply(CURVE_KEY, step); });
        const head = node('span', null, 'settings-curve-head');
        head.append(input, node('span', CURVE[step][0], 'settings-curve-name'));
        card.append(head, node('span', CURVE[step][1], 'life-meta settings-curve-help'), curvePreview(step));
        cards.append(card); curveInputs.push(input);
      }
      curveGroup.append(cards);
      const curveRow = node('label', null, 'settings-select-row settings-narrow-control');
      curveRow.append(node('span', '행복도 곡선', 'settings-row-label'));
      curveSelect = node('select'); curveSelect.id = 'lifeSettingsCurve';
      for (const step of CURVE_STEPS) { const option = node('option', CURVE[step][0] + ' · ' + CURVE[step][1]); option.value = String(step); curveSelect.append(option); }
      curveSelect.addEventListener('change', () => apply(CURVE_KEY, +curveSelect.value));
      curveRow.append(curveSelect, glyph('chevron'));
      const ageGroup = node('div', null, 'settings-choice settings-age settings-wide-control');
      const ageLabel = node('span', '나이', 'settings-choice-legend'); ageLabel.id = 'lifeSettingsAgeLabel';
      const segments = node('div', null, 'settings-segments'); segments.setAttribute('role', 'radiogroup'); segments.setAttribute('aria-labelledby', ageLabel.id);
      ageGroup.append(ageLabel);
      for (const [value, label] of AGE) {
        const option = node('label', null, 'settings-segment');
        const input = node('input'); input.type = 'radio'; input.name = 'settingsAge'; input.value = value;
        input.addEventListener('change', () => { if (input.checked) apply(AGE_KEY, value); });
        option.append(input, node('span', label)); segments.append(option); ageInputs.push(input);
      }
      ageGroup.append(segments);
      const ageRow = node('label', null, 'settings-select-row settings-narrow-control');
      ageRow.append(node('span', '나이', 'settings-row-label'));
      ageSelect = node('select'); ageSelect.id = 'lifeSettingsAge';
      for (const [value, label] of AGE) { const option = node('option', label); option.value = value; ageSelect.append(option); }
      ageSelect.addEventListener('change', () => apply(AGE_KEY, ageSelect.value));
      ageRow.append(ageSelect, glyph('chevron'));
      out.push(curveRow, ageRow, curveGroup, ageGroup, node('p', '연표 화면에 적용합니다. 이 기기의 브라우저에 보관합니다.', 'life-help settings-note'), status);
      // 다른 탭(연표)에서 바꾼 값을 따른다.
      listen(root, 'storage', event => {
        if (!element.isConnected) return dispose();
        if (event.key === null || event.key === CURVE_KEY || event.key === AGE_KEY) syncSchedule();
      });
      return out;
    }

    // ---------- 단축키 ----------
    function shortcutRows() {
      const out = [];
      for (const [scope, keys] of SHORTCUTS) {
        const group = node('div', null, 'settings-keys');
        group.append(node('h3', scope, 'settings-keys-scope'));
        const listing = node('dl');
        for (const [key, action] of keys) {
          const line = node('div', null, 'settings-key');
          const keys = node('dd'); keys.append(node('kbd', key)); line.append(node('dt', action), keys); listing.append(line);
        }
        group.append(listing); out.push(group);
      }
      out.push(node('p', 'Windows·Linux에서는 ⌘ 대신 Ctrl을 누릅니다.', 'life-help settings-note'));
      return out;
    }

    for (const item of ITEMS) {
      const content = item.id === 'account' ? accountRows() : item.id === 'news' ? newsRows() : item.id === 'schedule' ? scheduleRows() : item.id === 'keys' ? shortcutRows() : rows[item.id] || [];
      if (!content.length) continue;
      section(item, content);
    }
    syncSchedule();

    // ---------- 하위 항목: 해시와 현재 항목 ----------
    let current = null;
    const shown = box => box.getClientRects().length > 0;
    function mark(id) {
      if (!sections.has(id)) id = sections.keys().next().value;
      current = id;
      for (const [key, link] of links) { if (key === id) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current'); }
    }
    function writeHash(id) {
      // 앱의 기록(history.state)을 유지한 채 주소의 해시만 바꾼다. 새 기록 항목을 만들지 않는다.
      try {
        const url = new URL(root.location.href); url.hash = 'settings-' + id;
        if (url.href !== root.location.href) root.history.replaceState(root.history.state, '', url.pathname + url.search + url.hash);
      } catch (_) { /* 주소를 못 바꿔도 항목 이동은 유지한다. */ }
    }
    // 초점 자리: 보이는 제목. 좁은 칸에서 묶음에 이어 붙인 항목(자료공간·공개 페이지)은 제목을 숨기므로 첫 행에 둔다.
    function focusTarget(box) {
      const heading = box.querySelector('.settings-heading');
      if (heading && heading.getBoundingClientRect().width > 1) return heading;
      return [...box.querySelectorAll('.settings-card button, .settings-card select, .settings-card input, .settings-card a[href]')].find(shown) || heading;
    }
    function select(id, { focus = false, scroll = false, write: shouldWrite = false } = {}) {
      // 지금 칸에 없는 항목(좁은 칸의 단축키)은 고르지 않는다. 설정 첫 화면 그대로 연다.
      if (disposed || !sections.has(id) || !shown(sections.get(id))) return false;
      mark(id); pinned = id;
      const box = sections.get(id);
      if (scroll) box.scrollIntoView({ block: 'start', behavior: 'instant' });
      if (focus) focusTarget(box)?.focus({ preventScroll: true });
      if (shouldWrite) writeHash(id);
      return true;
    }

    // 넓은 칸에서 직접 스크롤하면 현재 표시와 해시가 따라간다(초점은 옮기지 않는다).
    // 항목을 고른 직후의 스크롤(바닥에 닿아 위로 못 올린 항목 포함)은 고른 항목을 유지하고, 사용자가 다시 스크롤하면 따라간다.
    let pinned = null, spyFrame = 0, atBottom = false, observer = null;
    const sentinel = node('div', null, 'settings-end'); sentinel.setAttribute('aria-hidden', 'true'); element.append(sentinel);
    function line() {
      const padding = parseFloat(getComputedStyle(root.document.documentElement).scrollPaddingTop);
      return (Number.isFinite(padding) ? padding : 80) + 16;
    }
    function spy() {
      spyFrame = 0;
      if (disposed || pinned || !element.isConnected || !shown(index)) return;
      const visible = [...sections].filter(([, box]) => shown(box));
      if (!visible.length) return;
      const top = line();
      let best = visible[0][0];
      for (const [id, box] of visible) if (box.getBoundingClientRect().top <= top) best = id;
      if (atBottom) best = visible[visible.length - 1][0];
      if (best !== current) { mark(best); writeHash(best); }
    }
    const schedule = () => { if (!spyFrame && !disposed) spyFrame = root.requestAnimationFrame(spy); };
    const unpin = () => { pinned = null; };
    if (root.IntersectionObserver) {
      // 위쪽 띠(머리글 아래 ~ 화면 가운데)를 지나는 항목이 바뀔 때만 다시 잰다.
      observer = new root.IntersectionObserver(schedule, { rootMargin: '-96px 0px -50% 0px', threshold: [0, 1] });
      // 맨 끝 표지는 화면 전체 기준으로 본다(마지막 항목은 위쪽 띠까지 올라오지 못할 수 있다).
      const bottom = new root.IntersectionObserver(entries => { for (const entry of entries) atBottom = entry.isIntersecting; schedule(); });
      cleanups.push(() => { observer.disconnect(); bottom.disconnect(); });
      for (const box of sections.values()) observer.observe(box);
      bottom.observe(sentinel);
    }
    // 사용자의 스크롤 입력만 고정을 푼다(프로그램 스크롤은 풀지 않는다).
    listen(root, 'wheel', () => { unpin(); schedule(); }, { passive: true });
    listen(root, 'touchmove', () => { unpin(); schedule(); }, { passive: true });
    listen(root, 'keydown', event => { if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) { unpin(); schedule(); } });

    function mount(host, { focusItem = true } = {}) {
      host.append(element);
      const match = HASH.exec(root.location.hash || '');
      const id = match && sections.has(match[1]) ? match[1] : null;
      // 해시로 들어오면 그 항목으로 옮긴다. 브라우저 뒤로 가기로 돌아올 때는 앱이 위치·초점을 다시 맞춘다.
      mark(null);
      if (!id) return element;
      if (element.getClientRects().length) {
        // 이동을 마친 앱은 화면의 첫 제목에 초점을 둔다. 해시 항목의 초점은 그 뒤에 둔다.
        // 돌아오기·뒤로 가기는 focusItem false로 항목을 보여 주기만 하고, 앱이 떠날 때 쓴 행에 바로 초점을 둔다.
        if (select(id, { scroll: true }) && focusItem) root.requestAnimationFrame(() => { if (!disposed && element.isConnected) focusTarget(sections.get(id))?.focus({ preventScroll: true }); });
      } else {
        // 첫 화면은 계정 확인 뒤에 보인다(shell의 haedo:page-ready). 보이기 전에는 옮길 수 없다.
        const ready = () => root.requestAnimationFrame(() => {
          if (!disposed && element.isConnected && element.getClientRects().length && HASH.exec(root.location.hash || '')?.[1] === id) select(id, { focus: focusItem, scroll: true });
        });
        listen(root.document, 'haedo:page-ready', ready, { once: true });
      }
      return element;
    }
    function dispose() {
      if (disposed) return; disposed = true;
      if (spyFrame) root.cancelAnimationFrame(spyFrame);
      cleanups.splice(0).forEach(run => { try { run(); } catch (_) {} });
    }
    return Object.freeze({ element, mount, select, dispose, sections: () => [...sections.keys()] });
  }

  (root.HaedoLife ||= {}).SettingsUI = Object.freeze({ create, row, ITEMS, readCurve, readAge, HASH });
})(globalThis);
