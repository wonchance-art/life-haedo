/* 일정의 습관·행복도·목표 칸(B2, 2026-11-04). 일정 화면이 이 칸을 그릴 때만 불러온다.
 * 습관 체크·목표 진행률은 기존 목표·습관(haedo_items)의 HaedoPlatformStore로 저장한다(저장 형식
 * 그대로, 11-03 결정). 충돌은 최신 쪽을 채택하고 진 쪽은 복구 사본으로 남는다.
 * 행복도는 보기만 한다(2026-11-04 소유자 결정 "습관·목표 먼저"): 연표의 값을 0–10으로 보이고,
 * 기록은 연표 편집기로 가는 링크로 한다. 일정에서 행복도를 쓰는 기능은 쓰는 곳을 하나로 다시
 * 설계해 다음 묶음에서 한다. */
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
  // Two-step save state (2026-11-02 owner decision).
  const STATE_TEXT = { ok: '저장됨 · 계정에 올림', pending: '계정에 올리기 대기', error: '계정에 올리지 못함 · 다시 시도' };
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
  // A panel host: kind 'day' | 'week' | 'year'. isCurrent() is false once the screen changed.
  function render(host, { kind, date, week = [], year, today, storageAccount, storage, isCurrent, go }) {
    const s = open(storageAccount);
    if (!s) return () => {};
    mirrorRecovery(s, storage);
    const status = el('p', null, 'life-meta schedule-entry-status'); status.setAttribute('role', 'status');
    const error = el('p', null, 'life-error schedule-entry-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    const body = el('div', null, 'schedule-entry-body');
    host.replaceChildren(body, status, error);
    let dirty = false, painted = false;
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
    // 행복도 is shown, not entered here: the link opens the timeline it is read from.
    function happinessField(day) {
      const field = el('section', null, 'schedule-entry-section schedule-happiness'); field.setAttribute('aria-label', '행복도');
      field.append(el('h3', '행복도', 'schedule-entry-title'));
      const current = mood.on(day), source = mood.source;
      field.append(el('p', current ? current.score + ' / 10' : '기록 없음', 'schedule-happiness-value'));
      const edit = el('a', '연표에서 기록', 'life-text-button schedule-happiness-edit');
      edit.href = 'timeline.html' + (source ? '?doc=' + encodeURIComponent(source.id) : '');
      edit.setAttribute('aria-label', '행복도를 연표에서 기록' + (source ? ' (' + source.name + ')' : ''));
      edit.dataset.focusKey = 'schedule:happiness:edit';
      field.append(edit);
      return field;
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
      habits.append(el('h3', '습관', 'schedule-entry-title'));
      if (!due.length) habits.append(el('p', '이 날 할 습관이 없어요.', 'life-meta schedule-empty'));
      for (const row of due) {
        const line = el('label', null, 'schedule-habit');
        line.append(habitCheck(row, date, row.item.data.title), el('span', row.item.data.title));
        habits.append(line);
      }
      parts.push(habits, happinessField(date));
      const goals = model().activeGoals(s.items, date);
      if (goals.length) { const section = el('section', null, 'schedule-entry-section'); section.append(el('h3', '목표', 'schedule-entry-title'), goalRows(goals)); parts.push(section); }
      return parts;
    }
    function weekPanel() {
      const habits = s.items.filter(item => item.kind === 'habit' && week.some(day => model().scheduled(item.data, day)));
      const section = el('section', null, 'schedule-entry-section schedule-week-entries'); section.setAttribute('aria-label', '이번 주 습관과 행복도');
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
      section.append(el('h3', '습관 · 행복도', 'schedule-entry-title'));
      if (!habits.length) section.append(el('p', '이번 주에 할 습관이 없어요.', 'life-meta schedule-empty'));
      section.append(scroll);
      return [section];
    }
    function yearPanel() {
      const goals = model().activeGoals(s.items, year + '-01-01').filter(goal => !goal.data.target || goal.data.target.startsWith(String(year)) || goal.data.target > year + '-12-31');
      const section = el('section', null, 'schedule-entry-section'); section.setAttribute('aria-label', '목표');
      section.append(el('h3', '목표', 'schedule-entry-title'));
      if (!goals.length) section.append(el('p', '진행 중인 목표가 없어요.', 'life-meta schedule-empty'));
      else section.append(goalRows(goals));
      return [section];
    }
    function paint() {
      if (!alive()) return;
      // Do not rebuild under a control in use (a dragged range).
      const active = document.activeElement;
      if (active && host.contains(active) && active.matches('input[type=range]') && active.matches(':active')) return;
      const focusKey = host.contains(active) ? active?.dataset?.focusKey : null;
      if (kind !== 'year') mood = s.happinessReader();
      body.replaceChildren(...(kind === 'day' ? dayPanel() : kind === 'week' ? weekPanel() : yearPanel()));
      painted = true;
      const state = saveState(s.items), unseen = s.recoveryUnseen;
      status.hidden = !dirty && state === 'ok' && !unseen;
      status.replaceChildren(el('span', STATE_TEXT[state]));
      status.dataset.state = state;
      if (state === 'error') {
        // Items left in conflict are settled by a pull first (newest wins), then everything unsent goes.
        const retry = el('button', '다시 시도', 'life-text-button'); retry.type = 'button'; retry.dataset.focusKey = 'schedule:entry:retry';
        retry.addEventListener('click', () => { if (!alive()) return; s.retry().catch(() => {}).finally(paint); });
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
      if (mirrorError) { status.hidden = false; status.append(el('span', ' ' + mirrorError, 'schedule-entry-recovery-error')); }
      if (focusKey) [...host.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
    }
    const onStore = () => { if (alive()) { paint(); mirrorRecovery(s, storage); } };
    document.addEventListener('haedo:store', onStore);
    paint();
    return () => document.removeEventListener('haedo:store', onStore);
  }
  life.ScheduleEntries = Object.freeze({ render, saveState, STATE_TEXT });
})(globalThis);
