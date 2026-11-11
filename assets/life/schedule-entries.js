/* 일정의 습관·행복도·목표 칸(B2, 2026-11-04). 일정 화면이 이 칸을 그릴 때만 불러온다.
 * 습관 체크·목표 진행률은 기존 목표·습관(haedo_items)의 HaedoPlatformStore로 저장한다(저장 형식
 * 그대로, 11-03 결정). 충돌은 최신 쪽을 채택하고 진 쪽은 복구 사본으로 남는다.
 * 하루 행복도는 일정 D에서만 입력한다(11-02 결정). 정본은 계정 문서 happinessDays이고 쓰는 곳은
 * 셸 저장소의 writeHappinessDay 하나다(2026-11-04 소유자 결정, happiness-single-writer.md). 이
 * 화면은 연표 문서의 옛 하루 점을 계정 문서로 옮기고(지우지 않는다) 옛 편집기가 더한 값을
 * 받아들인다(absorbHappiness). 연표 편집기는 하루 값을 보기만 한다. */
(function (global) {
  'use strict';
  const life = global.HaedoLife = global.HaedoLife || {};
  const model = () => global.HaedoPlatformData;
  const store = () => global.HaedoPlatformStore;
  const WEEK = ['월', '화', '수', '목', '금', '토', '일'];
  let started = null; // the account whose first pull this page started
  // Signing out ends that account here too: the next account starts its own first pull.
  global.document?.addEventListener('haedo:signed-out', () => { started = null; });
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  // ── 하루 행복도(happinessDays) — 셸 저장소 범위마다 하나 ──
  const REFRESH = '앱을 새로고침한 뒤 다시 시도해 주세요. 값은 그대로 있습니다.';
  let current = null; // the happinessDays controller of the open storage scope
  const happinessKey = account => `happinessDays:${JSON.stringify([account.projectUrl, account.userId])}:days`;
  function moodFor(storage, s) {
    if (current && current.storage === storage) return current;
    current?.stop();
    const m = { storage, entries: null, refresh: false, error: null, sync: 'ok', pending: new Map(), stops: [], loading: null, again: false,
      absorbing: null, absorbAgain: false };
    // Repaint only when what the panel shows changed (values, notices, save state): a repaint
    // rebuilds the panel, so status notices alone must not churn it.
    let shown = null;
    const repaint = () => {
      const now = JSON.stringify([m.entries, m.refresh, m.error, m.sync, [...m.pending]]);
      if (now === shown) return;
      shown = now; document.dispatchEvent(new Event('haedo:happiness'));
    };
    // A page whose storage.js has no happinessDays (an older cached module next to this one) never writes.
    m.ready = typeof storage?.writeHappinessDay === 'function' && typeof storage?.readHappinessDays === 'function' &&
      typeof storage?.absorbTimelineDays === 'function' && !!model()?.absorbHappiness;
    if (!m.ready) m.refresh = true;
    const same = () => current === m && storage.account && accountOf(storage.account) === storage.account.userId;
    m.load = () => {
      if (!m.ready) return Promise.resolve();
      if (m.loading) { m.again = true; return m.loading; }
      m.loading = (async () => {
        do {
          m.again = false;
          try {
            const value = await storage.readHappinessDays();
            if (!same()) return;
            m.entries = value.entries; m.refresh = false; m.error = null;
          } catch (error) {
            if (!same()) return;
            if (error?.code === 'app_refresh_required') m.refresh = true;
            else if (!['storage_scope_closed', 'auth_scope_required'].includes(error?.code)) m.error = error?.message || '행복도를 읽지 못했습니다.';
          }
          await m.syncState();
        } while (m.again && same());
        repaint();
      })().finally(() => { m.loading = null; });
      return m.loading;
    };
    // Two-step save state of this one document (the account engine's view of it).
    m.syncState = async () => {
      try {
        const record = await storage.readAccountDocRecord(happinessKey(storage.account));
        const engine = life.Shell?.accountDocsSync?.getStatus?.();
        m.sync = !record.exists || (record.sync && record.hash === record.sync.hash) ? 'ok'
          : record.sync?.error || ['error', 'unavailable'].includes(engine?.state) ? 'error' : 'pending';
      } catch (_) { /* The value on screen stays; the status is refreshed on the next notice. */ }
    };
    // Old daily points of this account's timelines → the account document (absorbTimelineDays decides
    // inside one transaction). One pass at a time; the account is captured when the pass begins.
    m.absorb = () => {
      if (!m.ready || m.refresh) return;
      if (m.absorbing) { m.absorbAgain = true; return; }
      const account = storage.account, uid = account?.userId;
      if (!uid || accountOf(account) !== uid) return;
      m.absorbing = (async () => {
        do {
          m.absorbAgain = false;
          await model().absorbHappiness({ storage, localStorage: global.localStorage, uid, account, serverIds: s.serverDocumentIds ?? null,
            isCurrent: () => same() && s.account === uid });
        } while (m.absorbAgain && same());
      })().catch(error => {
        if (!same() || ['storage_scope_closed', 'auth_scope_required', 'account_changed'].includes(error?.code)) return;
        // Said on the 일정 (one line), not swallowed: e.g. a full 행복도 document stops moving timeline days.
        if (error?.code === 'app_refresh_required') m.refresh = true;
        else m.error = '연표의 하루 행복도를 옮기지 못했습니다. 연표의 값은 그대로 있습니다. ' + (error?.message || '');
        repaint();
      }).finally(() => { m.absorbing = null; });
    };
    // 일정 D: score 0–10 or null (지우기). The choice stays on screen until it is stored.
    m.write = async (date, score) => {
      m.pending.set(date, score); m.error = null; repaint();
      if (!m.ready || m.refresh) { m.refresh = true; repaint(); return; }
      try {
        await storage.writeHappinessDay(date, score === null ? null : (score - 5) / 5);
        if (!same()) return;
        // A later choice for the same day stays on screen until its own write ends.
        if (m.pending.get(date) === score) m.pending.delete(date);
        await m.load();
      } catch (error) {
        if (!same()) return;
        if (error?.code === 'app_refresh_required') m.refresh = true;
        else m.error = error?.message || '행복도를 저장하지 못했습니다. 다시 시도해 주세요.';
        repaint();
      }
    };
    m.stop = () => { for (const stop of m.stops.splice(0)) { try { stop(); } catch (_) { /* Closed scope. */ } } };
    if (m.ready) {
      try {
        m.stops.push(storage.subscribeAll(event => {
          if (event?.type === 'happiness_days_changed' || (event?.type === 'account_doc_applied' && String(event.key || '').startsWith('happinessDays:'))) m.load();
          else if (event?.type === 'account_doc_changed' && String(event.key || '').startsWith('happinessDays:')) m.syncState().then(repaint);
        }));
      } catch (_) { /* A closed scope: the next screen opens a new one. */ }
      const engine = life.Shell?.accountDocsSync;
      if (engine?.subscribe) m.stops.push(engine.subscribe(() => { if (same()) m.syncState().then(repaint); }));
    }
    current = m;
    m.load();
    return m;
  }
  global.document?.addEventListener('haedo:signed-out', () => { current?.stop(); current = null; });
  // Two-step save state (2026-11-02 owner decision).
  // The error state is followed by its own [다시 시도] button (2026-11-08 S9, the same line as platform-ui.js), so
  // the words are not said twice.
  const STATE_TEXT = { ok: '저장됨 · 계정에 올림', pending: '계정에 올리기 대기', error: '계정에 올리지 못함 ·' };
  function saveState(items) {
    const states = items.map(item => item.state);
    if (states.includes('err') || states.includes('conflict')) return 'error';
    if (states.includes('sync')) return 'pending';
    return 'ok';
  }
  // The open account only after the shell's server check: the shell renders the private
  // schedule only for a verified account, and storage.account must be that same account.
  function accountOf(storageAccount) {
    const user = global.HaedoAuth?.user?.id;
    return user && storageAccount?.userId === user ? user : null;
  }
  function open(storageAccount) {
    const uid = accountOf(storageAccount);
    if (!uid || !store()) return null;
    store().ensure(uid);
    if (started !== uid) {
      started = uid;
      // Fresh copies from the account; the panel paints the device copy first and repaints on notice.
      // Timelines are only read here (syncDocuments brings them, also on wake-ups; nothing is sent).
      store().watchDocuments();
      store().pull().catch(() => {});
      store().syncDocuments().catch(() => {});
    }
    return store();
  }
  // Recovery copies follow the account as an ordinary account document (platformRecovery,
  // AccountDocsSync): copies from the account are added here, and copies kept here are added
  // there. Both sides only add (by rid); nothing is replaced or removed. One pass at a time.
  let mirroring = null, mirrorAgain = false, mirrorError = null, mirrorStorage = null;
  const accountCopy = row => ({ rid: row.rid, id: row.id, kind: row.kind, data: row.data, updated: row.updated ?? null,
    keptAt: String(row.keptAt || ''), reason: String(row.reason || '') });
  function mirrorRecovery(s, given) {
    if (typeof given?.readPlatformRecovery !== 'function' || typeof given.addPlatformRecovery !== 'function') return;
    // The newest scope the shell handed over (an older one closes when the screen is rebuilt).
    mirrorStorage = given;
    if (mirroring) { mirrorAgain = true; return; }
    const uid = s.account;
    let storage = mirrorStorage;
    const same = () => uid && s.account === uid && storage.account?.userId === uid;
    mirroring = (async () => {
      do {
        mirrorAgain = false; storage = mirrorStorage;
        if (!same()) return;
        const account = await storage.readPlatformRecovery();
        if (!same()) return;
        if (account.items.length) s.restoreRecovery(account.items);
        const known = new Set(account.items.map(item => item.rid));
        const local = s.recovery.filter(row => !known.has(row.rid) && ['goal', 'habit'].includes(row.kind) && typeof row.data?.title === 'string');
        if (local.length && same()) await storage.addPlatformRecovery(local.reverse().map(accountCopy));
        if (mirrorError) { mirrorError = null; document.dispatchEvent(new Event('haedo:store')); }
      } while (mirrorAgain);
    })().catch(error => {
      // A closed or signed-out scope is not a failure: the next screen starts a new pass.
      if (['storage_scope_closed', 'auth_scope_required', 'account_changed'].includes(error?.code)) return;
      // Said in the status line, not swallowed: a full account list (5,000 copies or 2 MB) stops
      // only the account copy; new copies stay on this device and in its backups.
      const full = ['platform_recovery_too_large', 'invalid_platform_recovery'].includes(error?.code);
      const next = full ? '복구 사본 목록이 가득 차 새 사본은 이 기기와 백업에만 남습니다.' : '복구 사본을 계정에 올리지 못했습니다. 이 기기에는 남아 있습니다.';
      if (mirrorError !== next && same()) { mirrorError = next; document.dispatchEvent(new Event('haedo:store')); }
    }).finally(() => { mirroring = null; });
  }
  // A panel host: kind 'day' | 'week' | 'month' | 'year'. isCurrent() is false once the screen changed.
  // leave(href), when given, opens another page of the app (habits.html) after the shell kept its drafts;
  // without it a link opens the page itself.
  function render(host, { kind, date, week = [], year, today, storageAccount, storage, isCurrent, go, leave }) {
    const s = open(storageAccount);
    if (!s) return () => {};
    mirrorRecovery(s, storage);
    // 하루 행복도: the shell's storage scope (the same verified account) holds the account document.
    const days = storage?.account?.userId === s.account ? moodFor(storage, s) : null;
    days?.absorb();
    const status = el('p', null, 'life-meta schedule-entry-status'); status.setAttribute('role', 'status');
    const error = el('p', null, 'life-error schedule-entry-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    const body = el('div', null, 'schedule-entry-body');
    // 행복도 notices apart from the goal/habit error line (a save failure there is not hidden by them).
    const moodNotice = el('p', null, 'life-error schedule-happiness-error'); moodNotice.setAttribute('role', 'alert'); moodNotice.hidden = true;
    host.replaceChildren(body, status, error, moodNotice);
    let dirty = false, painted = false, retrying = false, statusSaid = null;
    // 행복도 is shown in the day and week panels only (not in the year goals or the month habit tracker).
    const moodShown = kind === 'day' || kind === 'week';
    // 행복도 for this paint: the timelines are read once per paint, not once per day shown.
    let mood = { source: null, on: () => null };
    // The first paint may run while the host is still being built (not yet in the page).
    const alive = () => isCurrent() && (host.isConnected || !painted) && s.account === accountOf(storageAccount);
    function fail(message) { error.hidden = false; error.textContent = message; }
    function act(run) {
      return event => {
        if (!alive()) return;
        error.hidden = true;
        try { run(event); dirty = true; } catch (e) { fail(e?.message || '저장하지 못했습니다. 다시 시도해 주세요.'); }
        paint();
      };
    }
    function habitCheck(row, day, label) {
      const box = el('input'); box.type = 'checkbox'; box.checked = row.item.data.checks.includes(day);
      box.disabled = day > today; box.dataset.focusKey = 'schedule:habit:' + row.item.id + ':' + day;
      box.setAttribute('aria-label', label);
      box.addEventListener('change', act(() => {
        const latest = s.items.find(item => item.id === row.item.id);
        if (!latest) throw new Error('습관을 찾지 못했습니다. 화면을 다시 열어 주세요.');
        // Toggle from the stored state, so a repeated change does not apply twice.
        const next = model().toggleHabit(latest.data, day, today);
        if (next.checks.includes(day) !== box.checked) return;
        s.change(latest.id, 'habit', next);
      }));
      return box;
    }
    // 일정 D: 0–10 (signed1 in the account document), 지우기 clears that day only. Days not come yet
    // cannot be entered. A choice not stored yet stays selected (also when the app must refresh).
    function happinessField(day) {
      // The legend holds the h2, so 행복도 is a heading beside 습관 and 그날 기록 and still names the group (review 3 n2).
      const field = el('fieldset', null, 'schedule-happiness'), legend = el('legend'); legend.append(el('h2', '행복도', 'schedule-happiness-title')); field.append(legend);
      const stored = mood.on(day), waiting = days?.pending.has(day) ? days.pending.get(day) : undefined;
      const chosen = waiting !== undefined ? waiting : stored?.score ?? null, name = 'schedule-happiness-' + day;
      const scale = el('div', null, 'schedule-happiness-scale');
      for (let n = 0; n <= 10; n++) {
        const label = el('label', null, 'schedule-happiness-option');
        const radio = el('input'); radio.type = 'radio'; radio.name = name; radio.value = String(n);
        radio.checked = chosen === n; radio.disabled = day > today || !days;
        radio.dataset.focusKey = 'schedule:happiness:' + day + ':' + n;
        radio.setAttribute('aria-label', '행복도 ' + n);
        radio.addEventListener('change', () => { if (alive() && radio.checked && days) { dirty = true; days.write(day, n); } });
        label.append(radio, el('span', n));
        scale.append(label);
      }
      field.append(scale);
      if (chosen !== null && day <= today && days) {
        const clear = el('button', '지우기', 'life-text-button schedule-happiness-clear'); clear.type = 'button';
        clear.dataset.focusKey = 'schedule:happiness:' + day + ':clear';
        clear.setAttribute('aria-label', '이 날 행복도 지우기');
        clear.addEventListener('click', () => { if (alive() && days) { dirty = true; days.write(day, null); } });
        field.append(clear);
      }
      if (day > today) field.append(el('p', '오지 않은 날은 기록할 수 없어요.', 'life-meta'));
      return field;
    }
    // A link to another page of the app (habit or goal screen): a plain click goes through leave() (drafts kept
    // first), others open as links.
    function pageLink(link, href) {
      link.href = href;
      if (leave) link.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); if (alive()) leave(href);
      });
      return link;
    }
    // No habit at all (2026-11-08 S7): D·W·M say so and link to the habit screen, where one is added.
    function noHabits(section) {
      if (s.items.some(item => item.kind === 'habit')) return false;
      const line = el('p', null, 'schedule-empty schedule-no-habits');
      const add = pageLink(el('a', '습관 추가', 'schedule-empty-link schedule-habit-add'), 'habits.html');
      add.dataset.focusKey = 'schedule:habit-add';
      line.append(el('span', '아직 습관이 없어요. '), add);
      section.append(line);
      return true;
    }
    function goalRows(goals) {
      const list = el('div', null, 'schedule-goals');
      for (const goal of goals) {
        const row = el('label', null, 'schedule-goal');
        const title = el('span', goal.data.title, 'schedule-goal-title');
        const meta = el('span', (goal.data.target ? goal.data.target.replace(/-/g, '.') + ' · ' : '') + goal.data.progress + '%', 'life-meta schedule-goal-meta');
        const input = el('input'); input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '5'; input.value = String(goal.data.progress);
        input.dataset.focusKey = 'schedule:goal:' + goal.id; input.setAttribute('aria-label', goal.data.title + ' 진행률');
        input.addEventListener('input', () => { meta.textContent = (goal.data.target ? goal.data.target.replace(/-/g, '.') + ' · ' : '') + input.value + '%'; });
        // Saved when the value is let go (change), not on every drag step.
        input.addEventListener('change', act(() => {
          const latest = s.items.find(item => item.id === goal.id);
          if (!latest) throw new Error('목표를 찾지 못했습니다. 화면을 다시 열어 주세요.');
          s.change(latest.id, 'goal', { ...latest.data, progress: Number(input.value) });
        }));
        row.append(title, meta, input); list.append(row);
      }
      return list;
    }
    function dayPanel() {
      const due = model().dueHabits(s.items, date), parts = [];
      const habits = el('section', null, 'schedule-entry-section'); habits.setAttribute('aria-label', '습관');
      habits.append(el('h2', '습관', 'schedule-entry-title'));
      if (!noHabits(habits) && !due.length) habits.append(el('p', '이 날 할 습관이 없어요.', 'schedule-empty'));
      for (const row of due) {
        const line = el('label', null, 'schedule-habit');
        line.append(habitCheck(row, date, row.item.data.title), el('span', row.item.data.title));
        habits.append(line);
      }
      // 2026-11-08 S7: the day is 체크 only (그날 습관 + 행복도); goals have nothing to do with one day and stay in Y.
      parts.push(habits, happinessField(date));
      return parts;
    }
    function weekPanel() {
      const habits = s.items.filter(item => item.kind === 'habit' && week.some(day => model().scheduled(item.data, day)));
      // Named once, by the slot (이번 주 습관과 행복도, review 3 n3); the section has its h2.
      const section = el('section', null, 'schedule-entry-section schedule-week-entries');
      const table = el('table', null, 'schedule-habit-grid');
      const head = el('tr'); head.append(el('th', '습관'));
      week.forEach((day, i) => { const th = el('th', WEEK[i]); th.scope = 'col'; if (day === today) th.dataset.today = 'true'; head.append(th); });
      const thead = el('thead'); thead.append(head); table.append(thead);
      const tbody = el('tbody');
      // Phone width: the name gets a full-width line of its own above its seven days (the row
      // header carries it for screen readers; this line is visual only).
      // Its first cell lines up with the row headers (hidden at phone width), so the name spans
      // exactly the seven day columns.
      const label = (text, cls = '') => { const row = el('tr', null, 'schedule-grid-label ' + cls); row.setAttribute('aria-hidden', 'true'); const cell = el('td', text); cell.colSpan = 7; row.append(el('th'), cell); return row; };
      for (const item of habits) {
        tbody.append(label(item.data.title));
        const tr = el('tr'); const th = el('th', item.data.title); th.scope = 'row'; th.title = item.data.title; tr.append(th);
        week.forEach((day, i) => {
          const td = el('td');
          // The whole cell is the target (a label around the box), not only the 22px box.
          if (model().scheduled(item.data, day)) { const hit = el('label', null, 'schedule-grid-check'); hit.append(habitCheck({ item }, day, item.data.title + ', ' + WEEK[i] + '요일')); td.append(hit); }
          tr.append(td);
        });
        tbody.append(tr);
      }
      tbody.append(label('행복도'));
      const moodRow = el('tr'); const mh = el('th', '행복도'); mh.scope = 'row'; moodRow.append(mh);
      week.forEach((day, i) => {
        const td = el('td'), value = mood.on(day), score = value?.score ?? null;
        const link = el('button', score != null ? String(score) : '–', 'schedule-happiness-day'); link.type = 'button';
        link.setAttribute('aria-label', WEEK[i] + '요일 행복도 ' + (score != null ? score : '기록 없음') + ', 그날 보기');
        link.dataset.focusKey = 'schedule:happiness-day:' + day;
        link.addEventListener('click', () => { if (alive()) go('day', day); });
        td.append(link); moodRow.append(td);
      });
      tbody.append(moodRow); table.append(tbody);
      const scroll = el('div', null, 'schedule-habit-scroll'); scroll.append(table);
      section.append(el('h2', '습관 · 행복도', 'schedule-entry-title'));
      if (!noHabits(section) && !habits.length) section.append(el('p', '이번 주에 할 습관이 없어요.', 'schedule-empty'));
      section.append(scroll);
      return [section];
    }
    // 일정 M (2026-11-08 S5): one compact read-only tracker table of this month (HaedoHabitTracker.renderCompact).
    // Nothing is checked here: each row is a link to the habit screen of that month (habits.html?month=YYYY-MM, read
    // by platform-ui.js); D·W and the habit screen check.
    function monthPanel() {
      const month = String(date).slice(0, 7), [y, m] = month.split('-').map(Number);
      const habits = s.items.filter(item => item.kind === 'habit' && model().habitMonth(item.data, y, m, today).days.some(day => day.scheduled));
      // Named once, by the slot (이 달 습관); the section has its 습관 heading.
      const section = el('section', null, 'schedule-entry-section schedule-month-habits');
      section.append(el('h2', '습관', 'schedule-entry-title'));
      if (noHabits(section)) return [section];
      if (!habits.length) { section.append(el('p', '이 달에 할 습관이 없어요.', 'schedule-empty')); return [section]; }
      const table = el('div');
      global.HaedoHabitTracker.renderCompact(table, { habits, month, today, model: model(), focusScope: 'schedule:month-habit',
        href: () => 'habits.html?month=' + month, onOpen: leave ? () => { if (alive()) leave('habits.html?month=' + month); } : null });
      section.append(table);
      return [section];
    }
    function yearPanel() {
      const goals = model().activeGoals(s.items, year + '-01-01').filter(goal => !goal.data.target || goal.data.target.startsWith(String(year)) || goal.data.target > year + '-12-31');
      // Named once, by the slot (목표, review 3 n3); its h2 is a sibling of 올해 계획 and 예정 in the aside.
      const section = el('section', null, 'schedule-entry-section');
      section.append(el('h2', '목표', 'schedule-entry-title'));
      if (!goals.length) {
        // No goal (review 2 m6): said at body size, with a link to the goal screen where one is added.
        const line = el('p', null, 'schedule-empty schedule-no-goals');
        const add = pageLink(el('a', '목표 추가', 'schedule-empty-link schedule-goal-add'), 'goals.html');
        add.dataset.focusKey = 'schedule:goal-add';
        line.append(el('span', '진행 중인 목표가 없어요. '), add);
        section.append(line);
      } else section.append(goalRows(goals));
      return [section];
    }
    // What the panel shows. A store notice that changes none of it leaves the nodes in place: a press that
    // spans a rebuild is lost, and a node found just before it is detached.
    let bodyShown = null;
    const bodyState = () => JSON.stringify([s.items, !!days, (kind === 'day' ? [date] : kind === 'week' ? week : [])
      .map(day => [mood.on(day)?.score ?? null, days?.pending.has(day) ? [days.pending.get(day)] : 0])]);
    function paint(onNotice = false) {
      if (!alive()) return;
      // Do not rebuild under a control in use (a dragged range).
      const active = document.activeElement;
      if (active && host.contains(active) && active.matches('input[type=range]') && active.matches(':active')) return;
      const focusKey = host.contains(active) ? active?.dataset?.focusKey : null;
      // Until the account document is read (or when it cannot be), no day shows a timeline's old point:
      // a day deleted in 일정 D must not come back as its old value for a moment. A page whose storage has
      // no happinessDays (mixed versions) shows the timeline's points as before.
      if (moodShown) mood = days?.ready && days.entries === null ? { source: null, on: () => null } : s.happinessReader(days?.entries ?? null);
      const shows = bodyState(), rebuild = !onNotice || shows !== bodyShown;
      bodyShown = shows;
      if (rebuild) body.replaceChildren(...(kind === 'day' ? dayPanel() : kind === 'week' ? weekPanel() : kind === 'month' ? monthPanel() : yearPanel()));
      painted = true;
      // 'loading' until the 행복도 document is read here (one more repaint follows), then 'ready'.
      host.dataset.happiness = moodShown && days?.ready && days.entries === null && !days.error ? 'loading' : 'ready';
      const itemState = saveState(s.items), moodState = kind === 'day' && days ? days.sync : 'ok';
      const state = [itemState, moodState].includes('error') ? 'error' : [itemState, moodState].includes('pending') ? 'pending' : 'ok';
      const unseen = s.recoveryUnseen;
      status.hidden = !dirty && state === 'ok' && !unseen && !mirrorError;
      // The status line is a live region: it is rebuilt only when what it says changes (review 3 n1), so a
      // repaint for another reason (a 행복도 notice, a store notice) does not have it read out again.
      const said = JSON.stringify([state, unseen, mirrorError]);
      if (said !== statusSaid) {
        statusSaid = said;
        status.replaceChildren(el('span', STATE_TEXT[state]));
        status.dataset.state = state;
        if (state === 'error') {
          // Items left in conflict are settled by a pull first (newest wins), then everything unsent goes.
          // aria-disabled, not disabled, while a retry runs: a focused button that turns disabled drops keyboard focus.
          const retry = el('button', '다시 시도', 'life-text-button'); retry.type = 'button'; retry.dataset.focusKey = 'schedule:entry:retry';
          retry.addEventListener('click', () => {
            if (!alive() || retrying) return;
            retrying = true; retry.setAttribute('aria-disabled', 'true');
            Promise.allSettled([s.retry(), life.Shell?.accountDocsSync?.syncNow?.()]).then(() => days?.syncState()).finally(() => { retrying = false; paint(); });
          });
          status.append(' ', retry);
        }
        // Shown until acknowledged; the copies stay (list: habits.html#recovery, and in backups).
        if (unseen) {
          const view = el('a', '보기', 'life-text-button'); view.href = 'habits.html#recovery'; view.setAttribute('aria-label', '복구 사본 보기');
          const seen = el('button', '확인', 'life-text-button'); seen.type = 'button'; seen.dataset.focusKey = 'schedule:entry:recovery-seen';
          seen.setAttribute('aria-label', '복구 사본 알림 확인');
          seen.addEventListener('click', () => { if (alive()) s.acknowledgeRecovery(); });
          status.append(el('span', ' 다른 기기와 겹친 변경 ' + unseen + '개를 복구 사본으로 남겼습니다. ', 'schedule-entry-recovery'), view, ' ', seen);
        }
        if (mirrorError) status.append(el('span', ' ' + mirrorError, 'schedule-entry-recovery-error'));
      }
      status.querySelector('[data-focus-key="schedule:entry:retry"]')?.setAttribute('aria-disabled', String(retrying));
      // A newer app wrote the 행복도 document, or this page mixes module versions: nothing is written.
      // Also an alert: its text is set only when it changes.
      moodNotice.hidden = !(days?.refresh && moodShown) && !(days?.error && kind === 'day');
      const notice = days?.refresh && moodShown ? REFRESH : days?.error && kind === 'day' ? days.error : null;
      if (notice !== null && moodNotice.textContent !== notice) moodNotice.textContent = notice;
      if (notice === REFRESH) moodNotice.dataset.code = 'app_refresh_required'; else if (notice !== null) delete moodNotice.dataset.code;
      const byKey = key => key ? [...host.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === key) : null;
      // 지우기 goes away once the day has no value: focus moves to that day's choice 0, not to the page (review 3 m5).
      const again = byKey(focusKey) || (/:clear$/.test(focusKey || '') ? byKey(focusKey.replace(/:clear$/, ':0')) : null);
      if (again) again.focus({ preventScroll: true });
      // A retry that succeeded removes its button: focus goes to the status line that now says so, not to the page.
      else if (focusKey === 'schedule:entry:retry' && !status.hidden) { status.tabIndex = -1; status.focus({ preventScroll: true }); }
    }
    // Timelines or items changed here: repaint, mirror recovery copies, and absorb timeline days.
    const onStore = () => { if (alive()) { paint(true); mirrorRecovery(s, storage); days?.absorb(); } };
    const onMood = () => { if (alive()) paint(); };
    document.addEventListener('haedo:store', onStore);
    document.addEventListener('haedo:happiness', onMood);
    paint();
    return () => { document.removeEventListener('haedo:store', onStore); document.removeEventListener('haedo:happiness', onMood); };
  }
  life.ScheduleEntries = Object.freeze({ render, saveState, STATE_TEXT });
})(globalThis);
