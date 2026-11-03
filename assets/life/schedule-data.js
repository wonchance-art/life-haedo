/* 일정 보기의 날짜 계산과 기록 묶기. 읽기 전용: 저장소를 읽거나 쓰지 않고,
 * 받은 행을 그 기기의 현지 날짜(YYYY-MM-DD)로 나눈다. 주는 월요일에 시작한다
 * (2026-11-03 소유자 결정). */
(function (root, factory) {
  'use strict';
  const api = factory();
  (root.HaedoLife ||= {}).ScheduleData = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';
  const UNITS = Object.freeze(['year', 'quarter', 'month', 'week', 'day']);
  const WEEKDAYS = Object.freeze(['월', '화', '수', '목', '금', '토', '일']);
  const pad = n => String(n).padStart(2, '0');
  const civilPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
  function valid(value) {
    const m = typeof value === 'string' && civilPattern.exec(value);
    if (!m) return false;
    const year = +m[1], month = +m[2], day = +m[3];
    if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1) return false;
    return day <= new Date(year, month, 0).getDate();
  }
  function civil(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  // Noon keeps daylight-saving shifts from moving a civil date.
  function toDate(value) { const m = civilPattern.exec(value); return new Date(+m[1], +m[2] - 1, +m[3], 12); }
  function today(now = new Date()) { return civil(now); }
  // The civil date of an ISO timestamp in this device's time zone; null when unreadable.
  function dayOf(iso) {
    const time = Date.parse(iso);
    return Number.isFinite(time) ? civil(new Date(time)) : null;
  }
  function timeOf(iso) {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return '';
    const date = new Date(time);
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
  }
  function addDays(value, n) { const date = toDate(value); date.setDate(date.getDate() + n); return civil(date); }
  function addMonths(value, n) {
    const date = toDate(value), day = date.getDate();
    const target = new Date(date.getFullYear(), date.getMonth() + n, 1, 12);
    target.setDate(Math.min(day, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
    return civil(target);
  }
  const parts = value => { const m = civilPattern.exec(value); return { year: +m[1], month: +m[2], day: +m[3] }; };
  // 0 = Monday … 6 = Sunday.
  function weekday(value) { return (toDate(value).getDay() + 6) % 7; }
  function startOfWeek(value) { return addDays(value, -weekday(value)); }
  function weekOf(value) { const start = startOfWeek(value); return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }
  function monthStart(value) { const { year, month } = parts(value); return year + '-' + pad(month) + '-01'; }
  function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }
  function monthDays(year, month) { return Array.from({ length: daysInMonth(year, month) }, (_, i) => year + '-' + pad(month) + '-' + pad(i + 1)); }
  // Whole Monday-start weeks covering the month.
  function monthWeeks(value) {
    const { year, month } = parts(value), first = year + '-' + pad(month) + '-01';
    const last = year + '-' + pad(month) + '-' + pad(daysInMonth(year, month));
    const weeks = [];
    for (let start = startOfWeek(first); start <= last; start = addDays(start, 7)) weeks.push(weekOf(start));
    return weeks;
  }
  function quarterOf(value) { return Math.floor((parts(value).month - 1) / 3) + 1; }
  // Monday-start weeks whose Monday… Sunday touch the quarter.
  function quarterWeeks(value) {
    const { year } = parts(value), q = quarterOf(value);
    const first = year + '-' + pad((q - 1) * 3 + 1) + '-01';
    const lastMonth = q * 3, last = year + '-' + pad(lastMonth) + '-' + pad(daysInMonth(year, lastMonth));
    const weeks = [];
    for (let start = startOfWeek(first); start <= last; start = addDays(start, 7)) weeks.push(weekOf(start));
    return weeks;
  }
  function step(unit, value, direction) {
    const n = direction < 0 ? -1 : 1;
    if (unit === 'year') return addMonths(value, 12 * n);
    if (unit === 'quarter') return addMonths(value, 3 * n);
    if (unit === 'month') return addMonths(value, n);
    if (unit === 'week') return addDays(value, 7 * n);
    return addDays(value, n);
  }
  const shortDay = value => { const { month, day } = parts(value); return month + '.' + day; };
  function dayTitle(value, now = today()) {
    const { year, month, day } = parts(value);
    return (year !== parts(now).year ? year + '년 ' : '') + month + '월 ' + day + '일 ' + WEEKDAYS[weekday(value)] + '요일';
  }
  function title(unit, value, now = today()) {
    const { year, month } = parts(value);
    const thisYear = year === parts(now).year;
    if (unit === 'year') return year + '년';
    if (unit === 'quarter') return year + '년 ' + quarterOf(value) + '분기';
    if (unit === 'month') return (thisYear ? '' : year + '년 ') + month + '월';
    // A week is named by its Monday's year; a week across New Year names both years.
    if (unit === 'week') {
      const days = weekOf(value), first = parts(days[0]).year, last = parts(days[6]).year;
      if (first !== last) return first + '년 ' + shortDay(days[0]) + ' – ' + last + '년 ' + shortDay(days[6]);
      return (first === parts(now).year ? '' : first + '년 ') + shortDay(days[0]) + ' – ' + shortDay(days[6]);
    }
    return dayTitle(value, now);
  }
  // One entry per civil day: saved posts, excerpts and dated plan entries.
  // Rows keep their own fields; nothing is merged or rewritten.
  function group({ posts = [], excerpts = [], plans = [] } = {}) {
    const days = new Map();
    const slot = day => { if (!days.has(day)) days.set(day, { posts: [], excerpts: [], plans: [] }); return days.get(day); };
    for (const post of posts) { const day = dayOf(post.at); if (day) slot(day).posts.push(post); }
    for (const excerpt of excerpts) { const day = dayOf(excerpt.at); if (day) slot(day).excerpts.push(excerpt); }
    for (const plan of plans) if (valid(plan.date)) slot(plan.date).plans.push(plan);
    const byTime = (a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || String(a.id).localeCompare(String(b.id));
    for (const value of days.values()) { value.posts.sort(byTime); value.excerpts.sort(byTime); }
    return days;
  }
  // Records counted for a dot; plans are drawn separately (dashed).
  function count(entry, filter = 'all') {
    if (!entry) return 0;
    if (filter === 'posts') return entry.posts.length;
    if (filter === 'excerpts') return entry.excerpts.length;
    if (filter === 'photos') return entry.posts.filter(post => post.photos > 0).length;
    return entry.posts.length + entry.excerpts.length;
  }
  function level(n) { return n <= 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : 3; }
  function summary(days, list) {
    let posts = 0, excerpts = 0; const photos = [];
    for (const day of list) {
      const entry = days.get(day); if (!entry) continue;
      posts += entry.posts.length; excerpts += entry.excerpts.length;
      for (const post of entry.posts) if (post.photos > 0) photos.push(post);
    }
    return { posts, excerpts, photos };
  }
  // The latest post of the days, as the period's representative title.
  function lead(days, list) {
    let best = null;
    for (const day of list) for (const post of days.get(day)?.posts || []) if (!best || (Date.parse(post.at) || 0) >= (Date.parse(best.at) || 0)) best = post;
    return best;
  }
  function countLabel({ posts, excerpts }) {
    const out = [];
    if (posts) out.push('글 ' + posts + '편');
    if (excerpts) out.push('발췌 ' + excerpts + '개');
    return out.join(', ');
  }
  return Object.freeze({ UNITS, WEEKDAYS, valid, civil, toDate, today, dayOf, timeOf, addDays, addMonths, parts, weekday,
    startOfWeek, weekOf, monthStart, daysInMonth, monthDays, monthWeeks, quarterOf, quarterWeeks, step, shortDay,
    dayTitle, title, group, count, level, summary, lead, countLabel });
});
