/* 습관 트래커(2026-11-07 소유자 요청 "습관은 트래커 처럼 볼 수 있도록"). 습관마다 한 달 달력을 그린다.
 * 습관 화면(habits.html)이 이 그리기(render)를 쓴다. 저장은 하지 않는다:
 * 누른 날은 onToggle(item, date, wasDone)으로 넘기고, 각 화면이 자기 저장 경로(store.change)로 저장한다.
 * 요일은 일정 달력과 같이 월요일부터 놓는다. 칸마다 data-focus-key가 있어 다시 그린 뒤 같은 칸으로
 * 초점을 되돌린다(화면 쪽에서). 일정 M은 2026-11-08부터 보기 전용 간단 트래커 표(renderCompact) 하나를 쓰고,
 * 체크는 일정 D·W와 습관 화면에서 한다. */
(function (root) {
  "use strict";
  const WEEK = Object.freeze(["월", "화", "수", "목", "금", "토", "일"]);
  const DAY_NAMES = Object.freeze(["일", "월", "화", "수", "목", "금", "토"]);
  const pad = (n) => String(n).padStart(2, "0");
  const monthOf = (date) => String(date).slice(0, 7);
  function shiftMonth(value, n) {
    const [year, month] = value.split("-").map(Number), index = year * 12 + (month - 1) + n;
    return Math.floor(index / 12) + "-" + pad((index % 12) + 1);
  }
  function monthLabel(value) {
    const [year, month] = value.split("-").map(Number);
    return year + "년 " + month + "월";
  }
  // Weekday names of a habit, Monday first (as the grid).
  const dayList = (days) => [...(days || [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((n) => DAY_NAMES[n]).join(", ");
  // "이번 달 n/m회 · 연속 k회 · 월, 수, 금" (another month: "10월 n/m회").
  function summaryText(summary, { current, streak, days }) {
    const parts = [(current ? "이번 달" : summary.month + "월") + " " + summary.done + "/" + summary.scheduled + "회", "연속 " + streak + "회"];
    const names = dayList(days);
    parts.push(names || "정한 요일 없음");
    return parts.join(" · ");
  }
  function el(tag, className, text) {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }
  // container: emptied and filled with one card per habit.
  // options: habits (store items), month 'YYYY-MM', today 'YYYY-MM-DD', model (HaedoPlatformData),
  // onToggle(item, date, wasDone), onOpen(item) (optional: the title opens the edit dialog),
  // focusScope (prefix of data-focus-key), heading ('h2' | 'h3' | 'h4' for a title without onOpen).
  function render(container, { habits, month, today, model, onToggle, onOpen, focusScope = "habit", heading = "h3" }) {
    const [year, monthNumber] = month.split("-").map(Number), current = month === monthOf(today);
    const lead = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
    const cards = habits.map((item) => {
      const card = el("article", "habit-tracker-card"), head = el("div", "habit-tracker-head");
      const summary = model.habitMonth(item.data, year, monthNumber, today);
      const title = onOpen ? el("button", "habit-copy habit-tracker-title") : el(heading, "habit-tracker-title");
      if (onOpen) {
        title.type = "button";
        title.append(el("strong", "", item.data.title));
        title.setAttribute("aria-label", item.data.title + " 수정");
        title.dataset.focusKey = focusScope + ":" + item.id + ":edit";
        title.addEventListener("click", () => onOpen(item));
      } else title.textContent = item.data.title;
      const line = el("p", "habit-tracker-summary", summaryText(summary, { current, streak: model.streak(item.data, today), days: item.data.days }));
      head.append(title, line);
      const grid = el("div", "habit-tracker-grid");
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", item.data.title + " " + monthLabel(month));
      for (const name of WEEK) {
        const label = el("span", "habit-tracker-weekday", name);
        label.setAttribute("aria-hidden", "true");
        grid.append(label);
      }
      for (let i = 0; i < lead; i++) grid.append(el("span", "habit-tracker-blank"));
      for (const day of summary.days) {
        const state = day.done ? "done" : day.open ? "open" : day.future ? "future" : "off";
        const button = el("button", "habit-tracker-day");
        button.type = "button";
        button.dataset.state = state;
        button.dataset.date = day.date;
        button.dataset.focusKey = focusScope + ":" + item.id + ":" + day.date;
        // Only scheduled days up to today take a tap (toggleHabit refuses the rest as well).
        button.disabled = !day.open;
        button.setAttribute("aria-pressed", String(day.done));
        // A kept check that takes no tap says why, not "완료 취소" (the button is disabled).
        const kept = day.future ? " 완료(오늘 뒤)" : day.date < item.data.created ? " 완료(시작 전)" : " 완료(정한 요일 아님)";
        button.setAttribute("aria-label", item.data.title + " " + day.date + (day.done ? (day.open ? " 완료 취소" : kept) : " 완료"));
        if (day.date === today) button.setAttribute("aria-current", "date");
        button.append(el("span", "habit-tracker-number", Number(day.date.slice(8))));
        if (day.done) button.append(root.HaedoLife.Icons.create("check", { size: 16 }));
        button.addEventListener("click", () => { if (!button.disabled) onToggle(item, day.date, day.done); });
        grid.append(button);
      }
      card.append(head, grid);
      card.dataset.habit = item.id;
      return card;
    });
    container.classList.add("habit-tracker");
    container.replaceChildren(...cards);
  }
  // 간단 트래커 표 of 일정 M (2026-11-08 일정 통합 정리 S5): one read-only row per habit, one dot per day
  // of the month. Done is filled, a scheduled day not done is outlined, a check kept on a day that is not one
  // to do is a ring with a dot inside (another shape, not only a lighter shade: review 2 m3), the rest is blank;
  // today is marked on its day number only. Nothing here takes a tap but the row: the whole row is one link
  // (href(item)) to the habit screen, where the month is checked, and ends in a › . The dots are drawn for the
  // eye only (aria-hidden): the link's name carries the habit and its n/m, and one legend line in text under the
  // table says what the three shapes are. options: habits, month, today, model, href(item), onOpen(item, event)
  // (optional: a plain click goes through it, e.g. to flush drafts first), focusScope.
  function renderCompact(container, { habits, month, today, model, href, onOpen, focusScope = "habit-row" }) {
    const [year, monthNumber] = month.split("-").map(Number), current = month === monthOf(today);
    const length = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const todayDay = monthOf(today) === month ? Number(today.slice(8)) : 0;
    // Day numbers over the dots: the 1st, 10th, 20th, the last day and today; a number next to today
    // gives way so two numbers never share the space of one narrow column.
    const marked = new Set([1, 10, 20, length].filter((day) => !todayDay || Math.abs(day - todayDay) !== 1));
    if (todayDay) marked.add(todayDay);
    const table = el("div", "habit-compact");
    table.style.setProperty("--habit-compact-days", String(length));
    const head = el("div", "habit-compact-head");
    head.setAttribute("aria-hidden", "true");
    const numbers = el("span", "habit-compact-days");
    for (let day = 1; day <= length; day++) {
      const cell = el("span", "habit-compact-number", marked.has(day) ? day : "");
      if (day === todayDay) cell.dataset.today = "true";
      numbers.append(cell);
    }
    head.append(el("span", "habit-compact-name"), el("span", "habit-compact-count"), numbers, el("span", "habit-compact-go"));
    const list = el("ul", "habit-compact-rows");
    for (const item of habits) {
      const summary = model.habitMonth(item.data, year, monthNumber, today);
      const count = summary.done + "/" + summary.scheduled + "회";
      const row = el("li", "habit-compact-item");
      const link = el("a", "habit-compact-row");
      link.href = href(item);
      link.dataset.habit = item.id;
      link.dataset.focusKey = focusScope + ":" + item.id;
      link.setAttribute("aria-label", item.data.title + ", " + (current ? "이번 달" : monthNumber + "월") + " " + count + ", 습관 화면에서 보기");
      if (onOpen) link.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpen(item, event);
      });
      const dots = el("span", "habit-compact-days");
      dots.setAttribute("aria-hidden", "true");
      for (const day of summary.days) {
        // Done on a day to do is filled, a day to do is outlined, the rest is empty. A check kept on a day that
        // is no longer one to do (not counted in n/m) is a ring with a dot inside.
        const dot = el("span", "habit-compact-dot");
        dot.dataset.state = day.done ? (day.scheduled ? "done" : "kept") : day.scheduled ? "planned" : "none";
        dot.dataset.date = day.date;
        if (day.date === today) dot.dataset.today = "true";
        dots.append(dot);
      }
      // The trailing › says the row opens something (touch has no hover).
      const go = el("span", "habit-compact-go");
      go.setAttribute("aria-hidden", "true");
      const icons = root.HaedoLife && root.HaedoLife.Icons;
      if (icons) go.append(icons.create("forward", { size: 16 })); else go.textContent = "›";
      link.append(el("span", "habit-compact-name", item.data.title), el("span", "habit-compact-count", count), dots, go);
      row.append(link);
      list.append(row);
    }
    // What the shapes are, in text (read in order after the rows); the shapes beside the words are drawn by CSS.
    const legend = el("p", "habit-compact-legend");
    for (const [state, text] of [["done", "완료"], ["planned", "할 날"], ["kept", "정한 요일이 아닌 날의 체크"]]) {
      const entry = el("span", "habit-compact-legend-item"), mark = el("span", "habit-compact-dot");
      mark.dataset.state = state;
      mark.setAttribute("aria-hidden", "true");
      entry.append(mark, el("span", null, text));
      legend.append(entry);
    }
    table.append(head, list, legend);
    container.replaceChildren(table);
  }
  // Focus the same control after a repaint (data-focus-key), without scrolling the page.
  function restoreFocus(container, key) {
    if (!key) return;
    const node = [...container.querySelectorAll("[data-focus-key]")].find((candidate) => candidate.dataset.focusKey === key);
    if (node && !node.disabled) node.focus({ preventScroll: true });
  }
  const api = Object.freeze({ WEEK, render, renderCompact, restoreFocus, summaryText, dayList, monthOf, shiftMonth, monthLabel });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HaedoHabitTracker = api;
})(globalThis);
