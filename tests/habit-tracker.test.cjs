// 습관 트래커(2026-11-07): the month summary (platform-data habitMonth) and the summary line.
const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../assets/platform-data.js");
const tracker = require("../assets/habit-tracker.js");

const habit = (over = {}) => ({ title: "익명 습관", created: "2026-10-01", days: [1, 3, 5], checks: [], ...over });
const states = (summary) => Object.fromEntries(summary.days.map((d) => [d.date, d.done ? "done" : d.open ? "open" : d.future ? "future" : "off"]));

test("only scheduled days up to today count; future scheduled days do not", () => {
  // November 2026: Mondays 2, 9, 16, 23, 30; Wednesdays 4, 11, 18, 25; Fridays 6, 13, 20, 27. Today Sat 11-07.
  const summary = model.habitMonth(habit({ checks: ["2026-11-02", "2026-11-06", "2026-11-09"] }), 2026, 11, "2026-11-07");
  assert.equal(summary.days.length, 30);
  assert.equal(summary.scheduled, 3, "Mon 2, Wed 4, Fri 6");
  assert.equal(summary.done, 2, "a check after today (11-09) is not counted");
  const s = states(summary);
  assert.equal(s["2026-11-02"], "done");
  assert.equal(s["2026-11-04"], "open");
  assert.equal(s["2026-11-05"], "off", "Thursday is not scheduled");
  assert.equal(s["2026-11-11"], "future");
  assert.equal(s["2026-11-07"], "off", "today, but not a scheduled weekday");
});

test("today counts when scheduled; month boundaries stop at the month's last day", () => {
  const summary = model.habitMonth(habit({ days: [0, 1, 2, 3, 4, 5, 6], checks: ["2026-10-31", "2026-11-01", "2026-12-01"] }), 2026, 11, "2026-11-30");
  assert.equal(summary.days[0].date, "2026-11-01");
  assert.equal(summary.days.at(-1).date, "2026-11-30");
  assert.equal(summary.scheduled, 30, "today (11-30) is included");
  assert.equal(summary.done, 1, "checks of the months around are not counted");
  const past = model.habitMonth(habit({ days: [0, 1, 2, 3, 4, 5, 6], checks: ["2026-10-31"] }), 2026, 10, "2026-11-07");
  assert.equal(past.days.length, 31);
  assert.equal(past.scheduled, 31, "a past month counts every scheduled day");
  assert.equal(past.done, 1);
});

test("a habit created mid-month counts from its start day", () => {
  const summary = model.habitMonth(habit({ created: "2026-11-04", checks: ["2026-11-02", "2026-11-04"] }), 2026, 11, "2026-11-07");
  assert.equal(summary.scheduled, 2, "Wed 4 and Fri 6; Mon 2 is before the start");
  assert.equal(summary.done, 1);
  const s = states(summary);
  assert.equal(s["2026-11-02"], "done", "a stored check before the start stays visible");
  assert.equal(summary.days[1].open, false, "but cannot be changed");
  assert.equal(s["2026-11-06"], "open");
});

test("February of a leap year has 29 days, a common year 28", () => {
  const leap = model.habitMonth(habit({ created: "2024-01-01", days: [4], checks: ["2024-02-29"] }), 2024, 2, "2024-03-10");
  assert.equal(leap.days.length, 29);
  assert.equal(leap.days.at(-1).date, "2024-02-29");
  assert.equal(leap.scheduled, 5, "Thursdays 1, 8, 15, 22, 29");
  assert.equal(leap.done, 1);
  assert.equal(model.habitMonth(habit({ created: "2025-01-01" }), 2025, 2, "2025-03-01").days.length, 28);
});

test("a habit with no days (or no start) has nothing to count and nothing to tap", () => {
  for (const data of [habit({ days: [] }), habit({ days: undefined }), habit({ created: undefined })]) {
    const summary = model.habitMonth(data, 2026, 11, "2026-11-07");
    assert.equal(summary.scheduled, 0);
    assert.equal(summary.done, 0);
    assert.equal(summary.days.some((d) => d.open), false);
  }
  assert.equal(tracker.summaryText({ month: 11, done: 0, scheduled: 0 }, { current: true, streak: 0, days: [] }), "이번 달 0/0회 · 연속 0회 · 정한 요일 없음");
});

test("a cell open in the tracker is exactly one toggleHabit accepts", () => {
  const data = habit({ created: "2026-10-28" });
  const today = "2026-11-07";
  for (const month of [10, 11, 12]) {
    for (const day of model.habitMonth(data, 2026, month, today).days) {
      let accepted = true;
      try { model.toggleHabit(data, day.date, today); } catch (_) { accepted = false; }
      assert.equal(day.open, accepted, day.date);
    }
  }
});

test("summary line, weekday order (Monday first) and month stepping", () => {
  const summary = model.habitMonth(habit({ days: [5, 1, 3], checks: ["2026-11-02"] }), 2026, 11, "2026-11-07");
  assert.equal(tracker.summaryText(summary, { current: true, streak: 1, days: [5, 1, 3] }), "이번 달 1/3회 · 연속 1회 · 월, 수, 금");
  assert.equal(tracker.summaryText({ ...summary, month: 10 }, { current: false, streak: 1, days: [0, 6] }), "10월 1/3회 · 연속 1회 · 토, 일");
  assert.deepEqual(tracker.WEEK, ["월", "화", "수", "목", "금", "토", "일"]);
  assert.equal(tracker.shiftMonth("2026-01", -1), "2025-12");
  assert.equal(tracker.shiftMonth("2026-12", 1), "2027-01");
  assert.equal(tracker.shiftMonth("2026-11", -13), "2025-10");
  assert.equal(tracker.monthOf("2026-11-07"), "2026-11");
  assert.equal(tracker.monthLabel("2026-03"), "2026년 3월");
});
