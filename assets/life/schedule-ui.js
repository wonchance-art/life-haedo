/* 일정의 연·분기·월·주·일 보기(2026-11-02 부드러운 판, B1). 읽기 전용 투영이다.
 * 이미 이 화면에서 읽는 자료만 쓴다: 저장한 내 글(사진 글·첨부 글·직접 쓴 글),
 * 발췌, 날짜가 있는 연간 계획 항목. B2(2026-11-04)부터 습관 체크·목표 진행률은 이 화면에서
 * 입력하고, 하루 행복도는 일정 D에서 입력한다(계정 문서 happinessDays). 그 칸은 schedule-entries.js가 그리고, 그
 * 칸을 그릴 때만 기존 목표·습관 저장소(sync.js·platform-store.js)를 불러온다. 불러오지 못하면
 * 예전처럼 각 편집 화면 링크를 둔다. */
(function (global) {
  'use strict';
  const life = global.HaedoLife = global.HaedoLife || {};
  const UNIT_OF = Object.freeze({ tools: 'year', quarter: 'quarter', month: 'month', week: 'week', day: 'day' });
  const MODE_OF = Object.freeze({ year: 'tools', quarter: 'quarter', month: 'month', week: 'week', day: 'day' });
  // 보기 단위: the list and the five calendar units (decision: Y/Q/M/W/D letters, named 연·분기·월·주·일).
  const VIEWS = Object.freeze([['home', '목록', '목록', 'L'], ['tools', 'Y', '연', 'Y'], ['quarter', 'Q', '분기', 'Q'], ['month', 'M', '월', 'M'], ['week', 'W', '주', 'W'], ['day', 'D', '일', 'D']]);
  const STEP_NAMES = Object.freeze({ year: '해', quarter: '분기', month: '달', week: '주', day: '날' });
  const FILTERS = Object.freeze([['all', '전체'], ['posts', '글'], ['excerpts', '발췌'], ['photos', '사진']]);
  const data = () => life.ScheduleData;
  // Loaded on first use, not on the first screen (2026-11-04 lead condition: no startup cost).
  const ENTRY_SCRIPTS = Object.freeze([['HaedoSync', 'assets/sync.js'], ['HaedoPlatformStore', 'assets/platform-store.js'], ['ScheduleEntries', 'assets/life/schedule-entries.js']]);
  // The habit tracker of 일정 M (habit-tracker.js/.css, 2026-11-07, the one habits.html shows) is loaded
  // apart and only for the month slot: if it fails, only that slot falls back to its link; D·W·Y stay.
  const TRACKER_SCRIPT = 'assets/habit-tracker.js', TRACKER_STYLE = 'assets/habit-tracker.css';
  let entryLoad = null, trackerStyled = false;
  const entriesReady = () => !!(life.ScheduleEntries && global.HaedoPlatformStore);
  const trackerReady = () => !!global.HaedoHabitTracker && trackerStyled;
  const ready = kind => entriesReady() && (kind !== 'month' || trackerReady());
  const failed = () => new Error('일정 입력 칸을 불러오지 못했습니다.');
  function addScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = src;
      script.onload = resolve; script.onerror = () => { script.remove(); reject(failed()); };
      document.head.append(script);
    });
  }
  function loadEntries() {
    if (entriesReady()) return Promise.resolve(life.ScheduleEntries);
    entryLoad ||= (async () => {
      for (const [name, src] of ENTRY_SCRIPTS) {
        if (name === 'ScheduleEntries' ? life.ScheduleEntries : global[name]) continue;
        await addScript(src);
      }
      if (!entriesReady()) throw failed();
      return life.ScheduleEntries;
    })().catch(error => { entryLoad = null; throw error; });
    return entryLoad;
  }
  // Script and style both: an unstyled month of 30 buttons is not shown (the link is, instead).
  // Each file keeps its own pending load: a failure of one forgets only that one, so a slot asking
  // again while the other is still on its way reuses it instead of adding a second tag.
  let styleLoad = null, trackerScriptLoad = null;
  function loadTrackerStyle() {
    if (trackerStyled) return Promise.resolve();
    styleLoad ||= new Promise((resolve, reject) => {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = TRACKER_STYLE;
      link.onload = () => { trackerStyled = true; resolve(); };
      link.onerror = () => { link.remove(); styleLoad = null; reject(failed()); };
      document.head.append(link);
    });
    return styleLoad;
  }
  function loadTrackerScript() {
    if (global.HaedoHabitTracker) return Promise.resolve();
    trackerScriptLoad ||= new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = TRACKER_SCRIPT;
      const fail = () => { script.remove(); trackerScriptLoad = null; reject(failed()); };
      script.onload = () => { if (global.HaedoHabitTracker) resolve(); else fail(); };
      script.onerror = fail;
      document.head.append(script);
    });
    return trackerScriptLoad;
  }
  function loadTracker() {
    if (trackerReady()) return Promise.resolve();
    return Promise.all([loadTrackerStyle(), loadTrackerScript()]).then(() => { if (!trackerReady()) throw failed(); });
  }
  const loadFor = kind => kind === 'month' ? Promise.all([loadEntries(), loadTracker()]).then(([entries]) => entries) : loadEntries();
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function glyph(name, className) { const svg = life.Icons.create(name); if (className) svg.classList.add(className); return svg; }
  function plainButton(text, className) { const node = el('button', text, className); node.type = 'button'; return node; }
  function snippet(text, limit = 140) {
    const value = Array.from(String(text || '').replace(/\s+/g, ' ').trim());
    return value.length > limit ? value.slice(0, limit).join('') + '…' : value.join('');
  }
  const postTitle = post => String(post.title || '').trim() || snippet(post.body, 60) || (post.photos ? '사진이 있는 글' : '제목 없는 글');
  const isMode = mode => Object.hasOwn(UNIT_OF, mode);
  const scheduleMode = mode => mode === 'home' || isMode(mode);

  function create({ storage, core, host, getBundle, isDisposed = () => false, announce = () => {}, open, go, links = {} }) {
    let disposed = false, generation = 0, visible = false, filter = 'all';
    let stopWatch = null, watchTimer = null, observer = null, createdScope = null;
    const entryStops = new Set();
    const createdCache = new Map();
    const urls = new Set();
    const alive = () => !disposed && !isDisposed();
    const showing = context => alive() && visible && context.token === generation && getBundle()?.workspaceId === context.workspaceId && context.surface.isConnected;
    function clearMedia() {
      observer?.disconnect(); observer = null;
      urls.forEach(url => URL.revokeObjectURL(url)); urls.clear();
    }
    // Posts are read the same way as the list (all libraries of the account);
    // a part that cannot be read is reported and the rest is still shown.
    async function load(context) {
      const bundle = getBundle(), workspaceId = context.workspaceId, errors = [];
      const [photo, workbench, plan] = await Promise.allSettled([
        life.HomeUI.listAccountPosts(storage, workspaceId),
        storage.readWorkbench(workspaceId),
        typeof storage.readAnnualPlan === 'function' ? storage.readAnnualPlan(workspaceId) : Promise.resolve(null)
      ]);
      const posts = [], excerpts = [];
      if (photo.status === 'fulfilled' && Array.isArray(photo.value?.posts)) {
        const saved = photo.value.posts.filter(post => post.status === 'saved' && !post.archived);
        // A calendar places a post on the day it was written (createdAt), so editing an old post
        // does not move it to today. The list index has no createdAt; each library is read once.
        const written = await createdTimes(saved, workspaceId);
        for (const post of saved)
          posts.push({ kind: 'photo', id: post.id, workspaceId: post.workspaceId || workspaceId, title: post.title, body: post.body,
            at: written.get((post.workspaceId || workspaceId) + '/' + post.id) || post.updatedAt, photos: post.photos || 0 });
        if (photo.value.failed) errors.push('일부 자료공간의 글');
      } else errors.push('사진 글');
      if (workbench.status === 'fulfilled' && workbench.value?.workspaceId === workspaceId) {
        for (const post of workbench.value.page?.posts || []) if (post.status === 'saved')
          posts.push({ kind: 'plain', id: post.id, workspaceId, title: '', body: post.body, at: post.createdAt || post.updatedAt, photos: 0, attachments: post.attachments || [] });
      } else errors.push('첨부 글');
      const active = id => core.isSourceActive(bundle, id);
      for (const source of bundle.sources) {
        if (!active(source.id) || !life.Writing?.isOwnSource(source, bundle)) continue;
        const version = life.Writing.latestVersion(bundle, source.id);
        // A direct writing's first version is when it was written; later versions are edits.
        if (version) posts.push({ kind: 'source', id: source.id, versionId: version.id, workspaceId, title: source.title, body: version.contentText, at: source.createdAt || version.importedAt, photos: 0 });
      }
      const sources = new Map(bundle.sources.map(source => [source.id, source]));
      for (const record of bundle.records || []) {
        const ref = record.sourceRefs?.find(item => active(item.sourceId));
        if (!ref) continue;
        excerpts.push({ kind: 'excerpt', id: record.id, workspaceId, text: record.text, at: record.createdAt, sourceId: ref.sourceId, versionId: ref.sourceVersionId,
          locator: ref.locator || null, sourceTitle: sources.get(ref.sourceId)?.title || '' });
      }
      let plans = [], rows = [];
      if (plan.status === 'fulfilled' && plan.value) {
        plans = (plan.value.entries || []).map(entry => ({ kind: 'plan', id: entry.id, date: entry.date, text: entry.text }));
        rows = plan.value.rows || [];
      } else if (plan.status !== 'fulfilled') errors.push('연간 계획');
      return { days: data().group({ posts, excerpts, plans }), posts, plans, rows, errors };
    }
    // createdAt of saved photo posts, one read per library; an unreadable post keeps its list time.
    // Kept across renders by (library, post, revision, updatedAt): only new or changed posts are read.
    // The cache belongs to one account and open library; either change empties it.
    function createdKey(ws, post) { return JSON.stringify([ws, post.id, post.revision ?? null, post.updatedAt ?? null]); }
    async function createdTimes(saved, workspaceId) {
      const scope = JSON.stringify([storage.account?.userId ?? null, workspaceId]);
      if (createdScope !== scope) { createdCache.clear(); createdScope = scope; }
      const byLibrary = new Map(), out = new Map(), used = new Set();
      for (const post of saved) {
        const ws = post.workspaceId || workspaceId, key = createdKey(ws, post); used.add(key);
        if (createdCache.has(key)) { out.set(ws + '/' + post.id, createdCache.get(key)); continue; }
        if (!byLibrary.has(ws)) byLibrary.set(ws, []); byLibrary.get(ws).push(post);
      }
      if (byLibrary.size && typeof storage.readPhotoPosts === 'function') await Promise.all([...byLibrary].map(async ([ws, posts]) => {
        try {
          const docs = await storage.readPhotoPosts(ws, posts.map(post => post.id));
          // A pass that started under another account or library does not fill this cache.
          if (createdScope !== scope) return;
          docs.forEach((doc, i) => {
            const post = posts[i];
            if (doc?.id !== post.id || typeof doc.createdAt !== 'string') return;
            createdCache.set(createdKey(ws, post), doc.createdAt); out.set(ws + '/' + post.id, doc.createdAt);
          });
        } catch (_) { /* Not cached: the list time places the post and the next render reads it again. */ }
      }));
      if (createdScope === scope) for (const key of [...createdCache.keys()]) if (!used.has(key)) createdCache.delete(key);
      return out;
    }
    // A photo post's first photo, read only when the thumbnail is about to show.
    function thumb(context, post, label) {
      const frame = el('span', null, 'schedule-thumb');
      frame.setAttribute('role', 'img'); frame.setAttribute('aria-label', label || '사진');
      const read = async () => {
        try {
          const doc = await storage.readPhotoPost(post.workspaceId || context.workspaceId, post.id);
          if (!showing(context) || !frame.isConnected) return;
          const embedded = life.PhotoPost.contentOps(doc).find(op => op.insert?.photo)?.insert.photo;
          const photo = doc.photos.find(item => item.id === embedded?.id) || doc.photos[0];
          const blob = photo?.view?.blob ?? photo?.blob;
          if (!blob) return;
          const url = URL.createObjectURL(blob); urls.add(url);
          const image = el('img'); image.alt = ''; image.decoding = 'async'; image.src = url;
          image.addEventListener('error', () => image.remove(), { once: true });
          if (embedded?.alt || embedded?.caption) frame.setAttribute('aria-label', embedded.alt || embedded.caption);
          frame.replaceChildren(image);
        } catch (_) { /* The title and date still identify the post. */ }
      };
      if (typeof global.IntersectionObserver === 'function') {
        if (!observer) observer = new global.IntersectionObserver(entries => entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          observer?.unobserve(entry.target); const run = entry.target._scheduleRead; delete entry.target._scheduleRead; run?.();
        }), { rootMargin: '240px 0px' });
        frame._scheduleRead = read; observer.observe(frame);
      } else Promise.resolve().then(read);
      return frame;
    }
    function opener(context, item, control) {
      control.dataset.scheduleItem = item.kind + ':' + item.id;
      control.dataset.focusKey = 'schedule:item:' + item.kind + ':' + item.id;
      let running = false;
      control.addEventListener('click', async event => {
        event.preventDefault();
        if (running || !showing(context)) return;
        running = true; control.setAttribute('aria-busy', 'true');
        try { await open(item); }
        catch (_) { if (showing(context)) showError(context, '화면을 열지 못했습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.'); }
        finally { running = false; control.removeAttribute('aria-busy'); }
      });
      return control;
    }
    function goButton(context, label, mode, date, className, focusKey) {
      const control = plainButton(label, className);
      control.dataset.scheduleGo = mode + ':' + date; control.dataset.focusKey = focusKey || 'schedule:go:' + mode + ':' + date;
      control.addEventListener('click', () => { if (showing(context)) go(mode, date); });
      return control;
    }
    // 습관·행복도·목표 칸. Painted from the device copy right away; a load failure falls back to the
    // editor links (fallback()).
    function entrySlot(context, kind, extra, fallback) {
      const slot = el('section', null, 'schedule-entries schedule-entries-' + kind); slot.setAttribute('aria-busy', 'true');
      slot.setAttribute('aria-label', kind === 'year' ? '목표' : kind === 'month' ? '이 달 습관' : kind === 'week' ? '이번 주 습관과 행복도' : '그날 습관과 행복도');
      const paint = entries => {
        const stop = entries.render(slot, { kind, date: context.date, today: data().today(), storageAccount: storage.account, storage, ...extra,
          isCurrent: () => showing(context), go: (mode, date) => { if (showing(context)) go(mode, date); },
          // The habit screen is another page: the shell keeps its drafts before leaving (links.page).
          leave: typeof links.page === 'function' ? href => { if (showing(context)) links.page(href); } : null });
        entryStops.add(stop);
        slot.setAttribute('aria-busy', 'false');
        if (!slot.childElementCount && fallback) slot.append(fallback());
      };
      // Already loaded: paint now, so a redraw can restore focus to the same control.
      if (ready(kind)) { paint(life.ScheduleEntries); return slot; }
      loadFor(kind).then(entries => { if (showing(context) && slot.isConnected) paint(entries); }).catch(() => {
        if (!showing(context) || !slot.isConnected) return;
        slot.setAttribute('aria-busy', 'false');
        if (fallback) slot.replaceChildren(fallback());
      });
      return slot;
    }
    function showError(context, text) {
      context.error.hidden = false; context.error.textContent = text;
    }
    function partialNotice(context, result) {
      if (!result.errors.length) { context.notice.hidden = true; return; }
      context.notice.hidden = false;
      context.notice.replaceChildren(el('p', result.errors.join(', ') + '을 불러오지 못했어요. 확인된 기록만 표시합니다.', 'life-meta'));
      const retry = plainButton('다시 불러오기', 'life-button');
      retry.addEventListener('click', () => { if (showing(context)) void refresh(context); });
      context.notice.append(retry);
    }
    function dots(context, days, list, { size = 'small', selected } = {}) {
      const row = el('span', null, 'schedule-dots schedule-dots-' + size); row.setAttribute('aria-hidden', 'true');
      const now = data().today();
      for (const day of list) {
        const entry = context.result.days.get(day);
        const dot = el('span', null, 'schedule-dot');
        dot.dataset.level = String(data().level(data().count(entry, filter)));
        dot.dataset.date = day; dot.title = data().shortDay(day);
        if (!data().count(entry, filter) && entry?.plans.length && day >= now) dot.dataset.planned = 'true';
        if (day === now) dot.dataset.today = 'true';
        if (day === selected) dot.dataset.selected = 'true';
        row.append(dot);
      }
      // Pointer shortcut to the day; keyboard users open the month or week first.
      row.addEventListener('click', event => { const day = event.target?.dataset?.date; if (day && showing(context)) go('day', day); });
      return row;
    }
    function filterTabs(context, redraw) {
      const tabs = el('div', null, 'schedule-filter'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '점으로 보일 기록');
      for (const [key, label] of FILTERS) {
        const tab = plainButton(label, 'schedule-filter-tab'); tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(filter === key)); tab.tabIndex = filter === key ? 0 : -1;
        tab.dataset.scheduleFilter = key; tab.dataset.focusKey = 'schedule:filter:' + key;
        const choose = () => {
          if (!showing(context) || filter === key) return;
          filter = key;
          for (const item of tabs.children) { const on = item.dataset.scheduleFilter === key; item.setAttribute('aria-selected', String(on)); item.tabIndex = on ? 0 : -1; }
          redraw();
        };
        tab.addEventListener('click', choose);
        tab.addEventListener('keydown', event => {
          const keys = FILTERS.map(item => item[0]), at = keys.indexOf(key);
          const next = event.key === 'ArrowRight' ? keys[(at + 1) % keys.length] : event.key === 'ArrowLeft' ? keys[(at + keys.length - 1) % keys.length] : null;
          if (!next) return;
          event.preventDefault(); event.stopPropagation();
          const target = tabs.querySelector('[data-schedule-filter="' + next + '"]'); target.click(); target.focus({ preventScroll: true });
        });
        tabs.append(tab);
      }
      return tabs;
    }
    function legend() {
      const box = el('p', null, 'schedule-legend'); box.setAttribute('aria-hidden', 'true');
      for (const [level, text] of [[0, '0'], [1, '1–2'], [2, '3–4'], [3, '5+']]) {
        const item = el('span', null, 'schedule-legend-item'); const dot = el('span', null, 'schedule-dot'); dot.dataset.level = String(level);
        item.append(dot, el('span', text)); box.append(item);
      }
      const today = el('span', null, 'schedule-legend-item'), dot = el('span', null, 'schedule-dot'); dot.dataset.level = '1'; dot.dataset.today = 'true';
      today.append(dot, el('span', '오늘'));
      const planned = el('span', null, 'schedule-legend-item'), pdot = el('span', null, 'schedule-dot'); pdot.dataset.level = '0'; pdot.dataset.planned = 'true';
      planned.append(pdot, el('span', '예정'));
      box.append(today, planned);
      return box;
    }
    const planDate = (date, withYear) => {
      const { year, month, day } = data().parts(date);
      return (withYear ? year + '.' : '') + month + '.' + day;
    };
    function planRows(context, entries, { empty, limit = 8 } = {}) {
      const list = el('div', null, 'schedule-plan-list');
      if (!entries.length && empty) list.append(el('p', empty, 'schedule-empty'));
      const thisYear = data().parts(data().today()).year;
      for (const entry of entries.slice(0, limit)) {
        const row = goButton(context, null, 'day', entry.date, 'schedule-plan-row', 'schedule:plan:' + entry.id);
        const when = el('span', null, 'schedule-plan-date');
        when.append(el('strong', planDate(entry.date, data().parts(entry.date).year !== thisYear)), el('span', data().WEEKDAYS[data().weekday(entry.date)]));
        row.append(when, el('span', snippet(entry.text, 80), 'schedule-plan-text'));
        row.setAttribute('aria-label', data().dayTitle(entry.date) + ', ' + snippet(entry.text, 80));
        list.append(row);
      }
      if (entries.length > limit) list.append(el('p', '그 밖의 계획 ' + (entries.length - limit) + '개는 연간 계획에서 볼 수 있어요.', 'life-meta schedule-more'));
      return list;
    }
    // 계획 칸: the links to the plan screens, (Y) the year's sentence, then the dated plan entries of the period.
    // Named for its period (올해 · 이 해 · 이 분기), not 계획: the link line inside is the 계획 navigation (review 3 m4).
    function planAside(context, { heading, entries, empty, year, label }) {
      const aside = el('aside', null, 'schedule-aside'); aside.setAttribute('aria-label', label);
      if (links.plan) aside.append(links.plan());
      if (year) aside.append(...yearPlan(context, year, aside));
      const title = el('h2', heading, 'schedule-aside-title'); aside.append(title, planRows(context, entries, { empty }));
      return aside;
    }
    // 올해 계획 (2026-11-08 S4): the annual plan's sentence of the year under its own title; without one, a link
    // to the annual plan where it is written. The link moves inside the app the way the plan link line does
    // (links.annualPlan, else that line's own 연간 계획 link: drafts kept, history pushed); only a page without
    // either follows the address itself.
    function yearPlan(context, year, aside) {
      const thisYear = data().parts(data().today()).year === year;
      const text = context.result.rows.find(row => row.year === year)?.text;
      const title = el('h2', thisYear ? '올해 계획' : year + '년 계획', 'schedule-aside-title schedule-year-title');
      if (String(text || '').trim()) return [title, el('p', snippet(text, 240), 'schedule-year-text')];
      const link = el('a', '연간 계획에 ' + (thisYear ? '올해' : '이 해') + ' 문장을 적을 수 있어요', 'schedule-year-empty');
      link.href = 'index.html?section=schedule&view=annual-plan'; link.dataset.focusKey = 'schedule:year-plan';
      link.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const planLink = aside.querySelector('[data-plan-destination="annual-plan"]');
        if (typeof links.annualPlan !== 'function' && !planLink) return;
        event.preventDefault();
        if (!showing(context)) return;
        if (typeof links.annualPlan === 'function') links.annualPlan(); else planLink.click();
      });
      return [title, link];
    }
    function yearView(context) {
      const { year } = data().parts(context.date), now = data().today();
      const wrap = el('div', null, 'schedule-layout');
      const primary = el('section', null, 'schedule-primary'); primary.setAttribute('aria-label', year + '년 기록');
      const rows = el('div', null, 'schedule-year-rows');
      const draw = () => {
        rows.replaceChildren();
        for (let month = 1; month <= 12; month++) {
          const list = data().monthDays(year, month), summary = data().summary(context.result.days, list), leadPost = data().lead(context.result.days, list);
          const row = el('div', null, 'schedule-year-row'); row.dataset.month = String(month);
          if (list.includes(context.date)) row.dataset.selected = 'true';
          const target = list.includes(now) ? now : list.includes(context.date) ? context.date : list[0];
          const label = goButton(context, month + '월', 'month', target, 'schedule-month-label', 'schedule:month:' + year + '-' + month);
          const counts = data().countLabel(summary);
          label.setAttribute('aria-label', month + '월' + (leadPost ? ', ' + postTitle(leadPost) : '') + (counts ? ', ' + counts : ', 기록 없음'));
          const body = el('span', null, 'schedule-year-body');
          body.append(el('span', leadPost ? postTitle(leadPost) : '', 'schedule-lead'), dots(context, context.result.days, list, { selected: context.date }));
          const photos = el('span', null, 'schedule-year-photos');
          summary.photos.slice(-2).reverse().forEach(post => photos.append(thumb(context, post, month + '월 사진')));
          row.append(label, body, photos);
          // The whole row (title, photos) opens the month; dots open their day; the label is the keyboard control.
          row.addEventListener('click', event => { if (!event.target.closest('button,a,.schedule-dots') && showing(context)) label.click(); });
          rows.append(row);
        }
      };
      draw();
      primary.append(filterTabs(context, draw), rows, legend());
      const entries = context.result.plans.filter(entry => entry.date.startsWith(year + '-') && (year !== data().parts(now).year || entry.date >= now)).sort((a, b) => a.date.localeCompare(b.date));
      const aside = planAside(context, { heading: '예정', entries, empty: '이 해의 남은 예정이 없어요.', year, label: year === data().parts(now).year ? '올해' : '이 해' });
      aside.append(entrySlot(context, 'year', { year }, null));
      wrap.append(primary, aside);
      return wrap;
    }
    function quarterView(context) {
      const weeks = data().quarterWeeks(context.date), now = data().today();
      const wrap = el('div', null, 'schedule-layout');
      const primary = el('section', null, 'schedule-primary'); primary.setAttribute('aria-label', data().title('quarter', context.date) + ' 기록');
      const rows = el('div', null, 'schedule-quarter-rows');
      const draw = () => {
        rows.replaceChildren();
        let lastMonth = 0;
        for (const week of weeks) {
          const summary = data().summary(context.result.days, week), leadPost = data().lead(context.result.days, week);
          const row = el('div', null, 'schedule-quarter-row');
          if (week.includes(context.date)) row.dataset.selected = 'true';
          const anchor = week.find(day => data().quarterOf(day) === data().quarterOf(context.date) && data().parts(day).year === data().parts(context.date).year) || week[0];
          const month = data().parts(anchor).month;
          row.append(el('span', month !== lastMonth ? month + '월' : '', 'schedule-quarter-month')); lastMonth = month;
          const target = week.includes(now) ? now : week.includes(context.date) ? context.date : week[0];
          const range = goButton(context, data().shortDay(week[0]) + ' – ' + data().shortDay(week[6]), 'week', target, 'schedule-week-label', 'schedule:week:' + week[0]);
          const counts = data().countLabel(summary);
          range.setAttribute('aria-label', data().shortDay(week[0]) + '부터 ' + data().shortDay(week[6]) + '까지 주' + (counts ? ', ' + counts : ', 기록 없음'));
          const photo = el('span', null, 'schedule-quarter-photo');
          if (summary.photos.length) photo.append(thumb(context, summary.photos.at(-1), '그 주 사진'));
          row.append(range, dots(context, context.result.days, week, { size: 'large', selected: context.date }),
            el('span', leadPost ? postTitle(leadPost) : '', 'schedule-lead'), el('span', counts, 'schedule-count'), photo);
          rows.append(row);
        }
      };
      draw();
      primary.append(filterTabs(context, draw), rows, legend());
      const first = weeks[0][0], last = weeks.at(-1)[6];
      const entries = context.result.plans.filter(entry => entry.date >= first && entry.date <= last && entry.date >= now).sort((a, b) => a.date.localeCompare(b.date));
      wrap.append(primary, planAside(context, { heading: '예정', entries, empty: '이 분기의 남은 예정이 없어요.', label: '이 분기' }));
      return wrap;
    }
    function dayLabel(day, entry) {
      const parts = [data().dayTitle(day)];
      const counts = entry ? data().countLabel({ posts: entry.posts.length, excerpts: entry.excerpts.length }) : '';
      if (counts) parts.push(counts);
      if (entry?.plans.length) parts.push('예정 ' + entry.plans.length + '개');
      return parts.join(', ');
    }
    function monthView(context) {
      const { year, month } = data().parts(context.date), now = data().today();
      const wrap = el('div', null, 'schedule-month');
      const grid = el('div', null, 'schedule-month-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', year + '년 ' + month + '월');
      data().WEEKDAYS.forEach(name => { const head = el('span', name, 'schedule-weekday'); head.setAttribute('aria-hidden', 'true'); grid.append(head); });
      for (const week of data().monthWeeks(context.date)) for (const day of week) {
        const entry = context.result.days.get(day), inMonth = data().parts(day).month === month;
        const cell = goButton(context, null, 'day', day, 'schedule-day-cell', 'schedule:day:' + day);
        cell.setAttribute('aria-label', dayLabel(day, entry) + (day === context.date ? ', 선택' : '') + (day === now ? ', 오늘' : ''));
        if (!inMonth) cell.dataset.outside = 'true';
        if (day === now) cell.dataset.today = 'true';
        if (day === context.date) cell.setAttribute('aria-current', 'date');
        cell.append(el('span', data().parts(day).day, 'schedule-day-number'));
        const leadPost = entry?.posts.at(-1);
        if (leadPost) cell.append(el('span', postTitle(leadPost), 'schedule-cell-title'));
        const photoPost = entry?.posts.filter(post => post.photos > 0).at(-1);
        if (photoPost) cell.append(thumb(context, photoPost, '사진'));
        for (const plan of (entry?.plans || []).slice(0, 2)) {
          const line = el('span', null, 'schedule-cell-plan'); line.append(glyph('calendar'), el('span', snippet(plan.text, 40))); cell.append(line);
        }
        if (entry?.excerpts.length && !leadPost) {
          const line = el('span', null, 'schedule-cell-plan'); line.append(glyph('quote'), el('span', '발췌 ' + entry.excerpts.length)); cell.append(line);
        }
        const mark = el('span', null, 'schedule-cell-dot'); mark.setAttribute('aria-hidden', 'true');
        mark.dataset.level = String(data().level(data().count(entry)));
        if (!data().count(entry) && entry?.plans.length && day >= now) mark.dataset.planned = 'true';
        cell.append(mark);
        grid.append(cell);
      }
      // Phone: the chosen day's records under the calendar (decision: iPhone 일정, 월 아래 예정).
      const chosen = el('section', null, 'schedule-month-chosen'); chosen.setAttribute('aria-label', data().dayTitle(context.date));
      chosen.append(el('h2', data().dayTitle(context.date), 'schedule-chosen-title'), dayRows(context, context.date, { compact: true }));
      const entries = context.result.plans.filter(entry => entry.date.startsWith(year + '-' + String(month).padStart(2, '0')) && entry.date >= now).sort((a, b) => a.date.localeCompare(b.date));
      const plans = el('section', null, 'schedule-month-plans'); plans.setAttribute('aria-label', '예정');
      plans.append(el('h2', '예정', 'schedule-aside-title'), planRows(context, entries, { empty: '이 달의 남은 예정이 없어요.' }));
      // 습관 트래커 of this month: one compact read-only table (2026-11-08 S5), between the calendar and the remaining plans.
      wrap.append(grid, chosen, entrySlot(context, 'month', {}, links.habits), plans);
      return wrap;
    }
    function itemRow(context, item, { compact = false } = {}) {
      const row = el('div', null, 'schedule-row schedule-row-' + item.kind);
      const mark = el('span', null, 'schedule-mark'); mark.setAttribute('aria-hidden', 'true');
      const content = el('div', null, 'schedule-row-content');
      row.append(el('span', item.kind === 'plan' ? '' : data().timeOf(item.at), 'schedule-time'), mark, content);
      if (item.kind === 'plan') {
        mark.append(glyph('calendar'));
        const text = el('p', null, 'schedule-plan-body'); text.append(el('span', '예정: ', 'life-sr-only'), document.createTextNode(snippet(item.text, 400))); content.append(text);
      } else if (item.kind === 'excerpt') {
        const figure = el('figure', null, 'schedule-quote');
        const quote = el('blockquote', snippet(item.text, compact ? 120 : 600));
        const caption = el('figcaption', null, 'schedule-quote-source');
        const source = opener(context, item, plainButton(item.sourceTitle || '원문 열기', 'schedule-link'));
        caption.append(source); figure.append(quote, caption); content.append(figure);
      } else {
        mark.append(glyph(item.kind === 'source' ? 'book' : 'edit'));
        // h3 under the day's 그날 기록 (D) or the day heading (W, the phone month); compact is the smaller title.
        const heading = el('h3', null, 'schedule-post-title' + (compact ? ' schedule-post-title-compact' : ''));
        heading.append(opener(context, item, plainButton(postTitle(item), 'schedule-post-open')));
        content.append(heading);
        if (!compact && item.photos > 0) { const media = el('div', null, 'schedule-post-media'); media.append(thumb(context, item, '사진')); content.append(media); }
        if (!compact && String(item.title || '').trim() && item.body) content.append(el('p', snippet(item.body, 280), 'schedule-post-body'));
        if (compact && item.photos > 0) row.append(thumb(context, item, '사진'));
      }
      return row;
    }
    function dayRows(context, day, options = {}) {
      const entry = context.result.days.get(day), list = el('div', null, 'schedule-day-rows');
      const items = [...(entry?.plans || []), ...[...(entry?.excerpts || []), ...(entry?.posts || [])].sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0))];
      // Said at body size, in D and under the phone month (2026-11-08 S7, review 2 m6).
      if (!items.length && !options.quiet) list.append(el('p', day > data().today() ? '아직 오지 않은 날이에요.' : '이 날 기록이 없어요.', 'schedule-empty' + (options.compact ? '' : ' schedule-day-empty')));
      for (const item of items) list.append(itemRow(context, item, options));
      return list;
    }
    function weekView(context) {
      const week = data().weekOf(context.date), now = data().today();
      const wrap = el('div', null, 'schedule-week');
      wrap.append(entrySlot(context, 'week', { week }, links.habits));
      const grid = el('div', null, 'schedule-week-grid');
      for (const day of week) {
        const entry = context.result.days.get(day);
        const column = el('section', null, 'schedule-week-day'); column.setAttribute('aria-label', data().dayTitle(day));
        if (day === context.date) column.dataset.selected = 'true';
        const head = goButton(context, null, 'day', day, 'schedule-week-head', 'schedule:day:' + day);
        head.setAttribute('aria-label', dayLabel(day, entry) + (day === now ? ', 오늘' : ''));
        if (day === now) head.dataset.today = 'true';
        head.append(el('span', data().WEEKDAYS[data().weekday(day)], 'schedule-week-name'), el('span', data().parts(day).day, 'schedule-week-number'));
        column.append(head, dayRows(context, day, { compact: true, quiet: true }));
        grid.append(column);
      }
      wrap.append(grid);
      return wrap;
    }
    function weekStrip(context) {
      // A group of day buttons (no tab pattern: each opens that day); the shown day is aria-current.
      const strip = el('div', null, 'schedule-week-strip'); strip.setAttribute('role', 'group');
      const week = data().weekOf(context.date); strip.setAttribute('aria-label', data().shortDay(week[0]) + ' – ' + data().shortDay(week[6]));
      for (const day of week) {
        const tab = goButton(context, null, 'day', day, 'schedule-strip-day', 'schedule:strip:' + day);
        if (day === context.date) tab.setAttribute('aria-current', 'date');
        tab.setAttribute('aria-label', dayLabel(day, context.result.days.get(day)));
        if (day === data().today()) tab.dataset.today = 'true';
        const mark = el('span', null, 'schedule-cell-dot'); mark.setAttribute('aria-hidden', 'true'); mark.dataset.level = String(data().level(data().count(context.result.days.get(day))));
        tab.append(el('span', data().WEEKDAYS[data().weekday(day)], 'schedule-strip-name'), el('span', data().parts(day).day, 'schedule-strip-number'), mark);
        strip.append(tab);
      }
      return strip;
    }
    function dayView(context) {
      const wrap = el('div', null, 'schedule-layout schedule-day');
      const primary = el('section', null, 'schedule-primary'); primary.setAttribute('aria-label', data().dayTitle(context.date) + ' 기록');
      // 2026-11-08 S7: 체크 (그날 습관 + 행복도) → 그날 기록 → 다른 해 (the aside).
      primary.append(weekStrip(context));
      // Fallback when the slot cannot load: the habit screen only. 행복도 is entered here in D alone; the timeline
      // shows it and is not offered as a second place for it (2026-11-08 S7, the former 연표에서 행복도 보기).
      primary.append(entrySlot(context, 'day', {}, links.habits));
      // 그날 기록 is an h2 like 습관 and 행복도 above it (review 3 n2); it is not shown (the records say what they are).
      const records = el('section', null, 'schedule-day-records'), recordsTitle = el('h2', '그날 기록', 'life-sr-only');
      recordsTitle.id = 'scheduleDayRecordsTitle'; records.setAttribute('aria-labelledby', recordsTitle.id);
      records.append(recordsTitle, dayRows(context, context.date));
      primary.append(records);
      wrap.append(primary);
      const { month, day, year } = data().parts(context.date);
      const others = context.result.posts.filter(post => {
        const at = data().dayOf(post.at); if (!at) return false;
        const p = data().parts(at); return p.month === month && p.day === day && p.year !== year;
      }).sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
      if (others.length) {
        const aside = el('aside', null, 'schedule-aside schedule-other-years'); aside.setAttribute('aria-label', '다른 해');
        aside.append(el('h2', '다른 해', 'schedule-aside-title'));
        for (const post of others.slice(0, 6)) {
          const row = opener(context, post, plainButton(null, 'schedule-other-row'));
          if (post.photos > 0) row.append(thumb(context, post, data().parts(data().dayOf(post.at)).year + '년 사진'));
          const copy = el('span', null, 'schedule-other-copy');
          copy.append(el('span', data().parts(data().dayOf(post.at)).year, 'schedule-other-year'), el('span', postTitle(post), 'schedule-other-title'));
          row.append(copy); aside.append(row);
        }
        wrap.append(aside);
      }
      return wrap;
    }
    const views = { year: yearView, quarter: quarterView, month: monthView, week: weekView, day: dayView };
    async function refresh(context) {
      const result = await load(context);
      if (!showing(context)) return;
      // A goal slider being moved is not rebuilt under the pointer: redraw once it is let go.
      const held = document.activeElement;
      if (held?.matches?.('.schedule-entries input[type=range]') && context.surface.contains(held)) {
        let later = false;
        const again = () => { if (later) return; later = true; if (showing(context)) void refresh(context).catch(() => {}); };
        held.addEventListener('change', again, { once: true }); held.addEventListener('blur', again, { once: true });
        return;
      }
      entryStops.forEach(stop => { try { stop(); } catch (_) {} }); entryStops.clear();
      const focusKey = context.surface.contains(document.activeElement) ? document.activeElement?.dataset?.focusKey : null;
      const scroll = global.scrollY;
      clearMedia();
      context.result = result;
      partialNotice(context, result);
      context.body.replaceChildren(views[context.unit](context));
      context.surface.setAttribute('aria-busy', 'false');
      if (focusKey) [...context.surface.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
      if (context.loaded) global.scrollTo({ top: scroll, behavior: 'instant' });
      context.loaded = true;
    }
    function unwatch() { stopWatch?.(); stopWatch = null; if (watchTimer) clearTimeout(watchTimer); watchTimer = null; }
    function watch(context) {
      unwatch();
      const listener = event => {
        if (!['photo_posts_changed', 'account_doc_applied', 'remote_changed', 'bundle_changed'].includes(event?.type) || !showing(context)) return;
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => { watchTimer = null; if (showing(context)) void refresh(context).catch(() => {}); }, 250);
      };
      try { if (typeof storage.subscribeAll === 'function') { stopWatch = storage.subscribeAll(listener); return; } }
      catch (error) { if (error?.code !== 'auth_scope_required') return; }
      try { if (typeof storage.subscribe === 'function') stopWatch = storage.subscribe(context.workspaceId, listener); } catch (_) { stopWatch = null; }
    }
    async function render(mode, { date } = {}) {
      if (!alive()) return;
      const bundle = getBundle(), unit = UNIT_OF[mode];
      if (!bundle || !unit) return;
      leave();
      const surface = el('div', null, 'life-schedule schedule-' + unit); surface.id = 'lifeSchedule';
      surface.dataset.unit = unit; surface.setAttribute('aria-busy', 'true');
      const context = { token: ++generation, workspaceId: bundle.workspaceId, unit, date: data().valid(date) ? date : data().today(), surface,
        result: { days: new Map(), posts: [], plans: [], rows: [], errors: [] }, loaded: false,
        error: el('p', null, 'life-error schedule-error'), notice: el('div', null, 'schedule-notice home-load-error'), body: el('div', null, 'schedule-body') };
      visible = true;
      surface.dataset.date = context.date;
      context.error.hidden = true; context.error.setAttribute('role', 'alert');
      context.notice.hidden = true; context.notice.setAttribute('role', 'status');
      // The empty frame keeps the plan links usable while records load.
      context.body.append(views[unit](context));
      surface.append(context.error, context.notice, context.body);
      host.append(surface);
      watch(context);
      try { await refresh(context); }
      catch (_) { if (showing(context)) { surface.setAttribute('aria-busy', 'false'); showError(context, '기록을 불러오지 못했어요. 다시 시도해 주세요.'); } }
    }
    function leave() {
      unwatch();
      entryStops.forEach(stop => { try { stop(); } catch (_) {} }); entryStops.clear();
      generation += 1; visible = false; clearMedia();
    }
    function dispose() { leave(); disposed = true; createdCache.clear(); createdScope = null; }
    return Object.freeze({ render, leave, dispose });
  }

  // 으로/로 after a word (review 2 NIT: no "(으)로"): 로 after a vowel or ㄹ, 으로 after another final consonant.
  // A word not ending in Hangul (a bare number) is read by its last digit: 2·4·5·9 end in a vowel, 1·7·8 in ㄹ.
  function withRo(word) {
    const text = String(word), last = text.at(-1) || '', code = last.charCodeAt(0) - 0xAC00;
    if (code >= 0 && code < 11172) { const final = code % 28; return text + (final === 0 || final === 8 ? '로' : '으로'); }
    return text + ('0136'.includes(last) ? '으로' : '로');
  }
  // Header parts for 일정 (ui.js arranges them in its heading row).
  function headerParts({ mode, date, onView, onToday, onStep, onUp, onHelp }) {
    const unit = UNIT_OF[mode] || null, D = data();
    const views = el('nav', null, 'life-schedule-views'); views.setAttribute('aria-label', '보기 단위');
    for (const [view, text, label, key] of VIEWS) {
      const link = el('a', null, 'life-schedule-view');
      link.href = view === 'home' ? 'index.html' : 'index.html?section=schedule&view=' + view + (view === 'tools' ? '' : '&date=' + date);
      link.dataset.scheduleView = view; link.dataset.focusKey = 'schedule:view:' + view;
      link.setAttribute('aria-label', label); link.title = label + ' (' + key + ')';
      if (view === 'tools') link.append(el('span', text, 'schedule-view-letter'), glyph('calendar', 'schedule-view-icon'));
      else link.textContent = text;
      if (view === mode) link.setAttribute('aria-current', 'true');
      link.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); onView(view);
      });
      views.append(link);
    }
    const today = plainButton('오늘', 'life-button schedule-today'); today.dataset.focusKey = 'schedule:today';
    today.title = '오늘 (T)'; today.addEventListener('click', () => onToday());
    // The list has no period: 오늘 and ‹ › are not shown there (2026-11-08 S2, not left disabled). schedule.css hides
    // them; a wide screen keeps their place unseen so the 보기 단위 bar does not move. inert: never reached either.
    const idle = node => { if (!unit) { node.dataset.scheduleIdle = 'true'; node.inert = true; } };
    idle(today);
    const step = el('span', null, 'schedule-step');
    const name = STEP_NAMES[unit] || '';
    for (const [direction, label, key] of [[-1, '이전 ' + name, '← 또는 P'], [1, '다음 ' + name, '→ 또는 N']]) {
      const control = plainButton(null, 'life-icon-button schedule-step-button');
      control.dataset.scheduleStep = String(direction); control.dataset.focusKey = 'schedule:step:' + direction;
      control.setAttribute('aria-label', unit ? label : direction < 0 ? '이전' : '다음'); control.title = unit ? label + ' (' + key + ')' : '';
      control.append(glyph('back', direction > 0 ? 'schedule-glyph-next' : null));
      control.addEventListener('click', () => onStep(direction));
      step.append(control);
    }
    idle(step);
    const help = plainButton('?', 'life-icon-button schedule-help'); help.setAttribute('aria-label', '단축키 (?)'); help.title = '단축키 (?)';
    help.dataset.focusKey = 'schedule:help'; help.setAttribute('aria-haspopup', 'dialog');
    help.addEventListener('click', () => onHelp(help));
    // Phone: one level up (연 → 목록, 월 → 연, 일 → 월; 분기 → 연, 주 → 월).
    let up = null;
    if (unit) {
      const parent = unit === 'year' ? ['home', '목록'] : unit === 'month' || unit === 'quarter' ? ['tools', D.parts(date).year + ''] : ['month', D.parts(date).month + '월'];
      up = el('a', null, 'schedule-up');
      up.href = parent[0] === 'home' ? 'index.html' : 'index.html?section=schedule&view=' + parent[0] + (parent[0] === 'tools' ? '' : '&date=' + date);
      up.dataset.scheduleUp = parent[0]; up.dataset.focusKey = 'schedule:up';
      up.setAttribute('aria-label', withRo(unit === 'month' || unit === 'quarter' ? parent[1] + '년' : parent[1]) + ' 올라가기');
      up.append(glyph('back'), el('span', parent[1]));
      up.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); onUp(parent[0]);
      });
    }
    return { views, today, step, help, up, title: unit ? D.title(unit, date) : '일정' };
  }
  const SHORTCUTS = Object.freeze([['L', '목록'], ['Y · Q · M · W · D', '연 · 분기 · 월 · 주 · 일'], ['T', '오늘'], ['← 또는 P', '이전'], ['→ 또는 N', '다음'], ['/', '통합 검색'], ['?', '이 도움말']]);
  function helpDialog(trigger) {
    document.getElementById('scheduleShortcuts')?.remove();
    const dialog = el('dialog', null, 'schedule-shortcuts'); dialog.id = 'scheduleShortcuts'; dialog.setAttribute('aria-labelledby', 'scheduleShortcutsTitle');
    const title = el('h2', '일정 단축키'); title.id = 'scheduleShortcutsTitle';
    const list = el('dl');
    for (const [key, text] of SHORTCUTS) { const row = el('div'); row.append(el('dt', key), el('dd', text)); list.append(row); }
    const close = plainButton('닫기', 'life-button'); close.addEventListener('click', () => dialog.close());
    dialog.append(title, list, close);
    dialog.addEventListener('close', () => { dialog.remove(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); });
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    document.body.append(dialog);
    dialog.showModal(); close.focus();
    return dialog;
  }
  // Single-key shortcuts while a schedule screen is shown and no field has focus.
  // Under the Korean 2-set layout `key` is a jamo (e.g. ㅡ for M); the physical key decides then.
  const CODES = Object.freeze({ KeyL: 'l', KeyY: 'y', KeyQ: 'q', KeyM: 'm', KeyW: 'w', KeyD: 'd', KeyT: 't', KeyP: 'p', KeyN: 'n', Slash: '/' });
  // Only a non-ASCII character (a Hangul jamo, …) falls back to the physical key: an ASCII key of
  // another layout (AZERTY `,` on KeyM, Dvorak `,` on KeyW) is that character, not a shortcut.
  function shortcutKey(event) {
    if (event.key.length !== 1) return event.key;
    if (event.key.charCodeAt(0) < 128) return event.key.toLowerCase();
    const latin = CODES[event.code];
    return latin === '/' && event.shiftKey ? '?' : latin || null;
  }
  // Single-key shortcuts while a schedule screen is shown, no field has focus and no IME is composing.
  function bindShortcuts({ active, onKey }) {
    const handler = event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.keyCode === 229 || !active()) return;
      const target = event.target;
      // isContentEditable covers every editable host (true, plaintext-only, inherited).
      if (target?.isContentEditable || target?.closest?.('input,textarea,select,dialog,[role=tablist],details[open]')) return;
      const key = shortcutKey(event);
      const map = { l: 'home', y: 'tools', q: 'quarter', m: 'month', w: 'week', d: 'day', t: 'today', p: 'prev', n: 'next', ArrowLeft: 'prev', ArrowRight: 'next', '/': 'find', '?': 'help' };
      if (!key || !Object.hasOwn(map, key) || event.shiftKey && key !== '?') return;
      event.preventDefault(); onKey(map[key]);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }
  life.ScheduleUI = Object.freeze({ create, headerParts, helpDialog, bindShortcuts, withRo, UNIT_OF, MODE_OF, isMode, scheduleMode });
})(globalThis);
