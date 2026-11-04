/* 일정의 습관·행복도·목표 칸(B2, 2026-11-04). 일정 화면이 이 칸을 그릴 때만 불러온다.
 * 저장은 기존 목표·습관(haedo_items)과 연표 문서(haedo_documents)의 HaedoPlatformStore를 그대로
 * 쓴다(저장 형식 그대로, 11-03 결정). 충돌은 최신 쪽을 채택하고 진 쪽은 복구 사본으로 남는다.
 * 행복도는 0–10으로 보이고 연표에는 v = (n - 5) / 5로 저장한다. */
(function (global) {
  'use strict';
  const life = global.HaedoLife = global.HaedoLife || {};
  const model = () => global.HaedoPlatformData;
  const store = () => global.HaedoPlatformStore;
  const WEEK = ['월', '화', '수', '목', '금', '토', '일'];
  let started = null; // the account whose first pull this page started
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  // Two-step save state (2026-11-02 owner decision).
  const STATE_TEXT = { ok: '저장됨 · 계정에 올림', pending: '계정에 올리기 대기', error: '계정에 올리지 못함 · 다시 시도' };
  function saveState(items, docState) {
    const states = items.map(item => item.state);
    if (states.includes('err') || states.includes('conflict') || docState === 'error') return 'error';
    if (states.includes('sync') || docState === 'pending') return 'pending';
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
      // This screen owns the timeline documents it shows: wake-ups refresh and resend them.
      store().followDocuments();
      store().pull().catch(() => {});
      store().syncDocuments().catch(() => {});
    }
    return store();
  }
  // Recovery copies follow the account as an ordinary account document (platformRecovery,
  // AccountDocsSync): copies from the account are added here, and copies kept here are added
  // there. Both sides only add (by rid); nothing is replaced or removed. One pass at a time.
  let mirroring = null, mirrorAgain = false;
  const accountCopy = row => ({ rid: row.rid, id: row.id, kind: row.kind, data: row.data, updated: row.updated ?? null,
    keptAt: String(row.keptAt || ''), reason: String(row.reason || '') });
  function mirrorRecovery(s, storage) {
    if (typeof storage?.readPlatformRecovery !== 'function' || typeof storage.addPlatformRecovery !== 'function') return;
    if (mirroring) { mirrorAgain = true; return; }
    const uid = s.account, same = () => uid && s.account === uid && storage.account?.userId === uid;
    mirroring = (async () => {
      do {
        mirrorAgain = false;
        if (!same()) return;
        const account = await storage.readPlatformRecovery();
        if (!same()) return;
        if (account.items.length) s.restoreRecovery(account.items);
        const known = new Set(account.items.map(item => item.rid));
        const local = s.recovery.filter(row => !known.has(row.rid) && ['goal', 'habit'].includes(row.kind) && typeof row.data?.title === 'string');
        if (local.length && same()) await storage.addPlatformRecovery(local.reverse().map(accountCopy));
      } while (mirrorAgain);
    })().catch(() => {}).finally(() => { mirroring = null; });
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
    function happinessField(day) {
      const field = el('fieldset', null, 'schedule-happiness'); const legend = el('legend', '행복도');
      const current = s.happiness(day), name = 'schedule-happiness-' + day;
      field.append(legend);
      const scale = el('div', null, 'schedule-happiness-scale');
      for (let n = 0; n <= 10; n++) {
        const label = el('label', null, 'schedule-happiness-option');
        const radio = el('input'); radio.type = 'radio'; radio.name = name; radio.value = String(n);
        radio.checked = current?.score === n; radio.disabled = day > today;
        radio.dataset.focusKey = 'schedule:happiness:' + day + ':' + n;
        radio.addEventListener('change', act(() => { if (radio.checked) s.setHappiness(day, n); }));
        label.append(radio, el('span', n));
        scale.append(label);
      }
      field.append(scale);
      if (current) {
        const clear = el('button', '지우기', 'life-text-button schedule-happiness-clear'); clear.type = 'button';
        clear.dataset.focusKey = 'schedule:happiness:' + day + ':clear';
        clear.addEventListener('click', act(() => s.setHappiness(day, null)));
        field.append(clear);
      }
      if (day > today) field.append(el('p', '오지 않은 날은 기록할 수 없어요.', 'life-meta'));
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
      for (const item of habits) {
        const tr = el('tr'); const th = el('th', item.data.title); th.scope = 'row'; th.title = item.data.title; tr.append(th);
        week.forEach((day, i) => {
          const td = el('td');
          if (model().scheduled(item.data, day)) td.append(habitCheck({ item }, day, item.data.title + ', ' + WEEK[i] + '요일'));
          tr.append(td);
        });
        tbody.append(tr);
      }
      const mood = el('tr'); const mh = el('th', '행복도'); mh.scope = 'row'; mood.append(mh);
      week.forEach((day, i) => {
        const td = el('td'), value = s.happiness(day), score = value?.score ?? null;
        const link = el('button', score != null ? String(score) : '–', 'schedule-happiness-day'); link.type = 'button';
        link.setAttribute('aria-label', WEEK[i] + '요일 행복도 ' + (score != null ? score : '기록 없음') + ', 그날 보기');
        link.dataset.focusKey = 'schedule:happiness-day:' + day;
        link.addEventListener('click', () => { if (alive()) go('day', day); });
        td.append(link); mood.append(td);
      });
      tbody.append(mood); table.append(tbody);
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
      // Do not rebuild under a control in use (a dragged range, a focused radio being chosen).
      const active = document.activeElement;
      if (active && host.contains(active) && active.matches('input[type=range]') && active.matches(':active')) return;
      const focusKey = host.contains(active) ? active?.dataset?.focusKey : null;
      body.replaceChildren(...(kind === 'day' ? dayPanel() : kind === 'week' ? weekPanel() : yearPanel()));
      painted = true;
      const state = saveState(s.items, s.happinessState()), unseen = s.recoveryUnseen;
      status.hidden = !dirty && state === 'ok' && !unseen;
      status.replaceChildren(el('span', STATE_TEXT[state]));
      status.dataset.state = state;
      if (state === 'error') {
        // Items left in conflict are settled by a pull first (newest wins), then everything unsent goes.
        const retry = el('button', '다시 시도', 'life-text-button'); retry.type = 'button'; retry.dataset.focusKey = 'schedule:entry:retry';
        retry.addEventListener('click', () => { if (!alive()) return; s.retryDocuments(); s.retry().catch(() => {}).finally(paint); });
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
      if (focusKey) [...host.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
    }
    const onStore = () => { if (alive()) { paint(); mirrorRecovery(s, storage); } };
    document.addEventListener('haedo:store', onStore);
    paint();
    return () => document.removeEventListener('haedo:store', onStore);
  }
  life.ScheduleEntries = Object.freeze({ render, saveState, STATE_TEXT });
})(globalThis);
