'use strict';
// 일정 date math (2026-11-03 owner decision: weeks start on Monday) and day grouping.
process.env.TZ = 'Asia/Seoul';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/life/schedule-data.js');

test('civil dates are validated without normalising impossible days', () => {
  for (const value of ['2026-02-29', '2026-13-01', '2026-00-10', '26-01-01', '2026-1-1', '2200-01-01', null, 20261103]) assert.equal(D.valid(value), false, String(value));
  for (const value of ['2028-02-29', '2026-12-31', '1900-01-01']) assert.equal(D.valid(value), true, value);
});

test('weeks start on Monday and month/quarter grids cover whole weeks', () => {
  assert.equal(D.weekday('2026-11-02'), 0); assert.equal(D.weekday('2026-11-08'), 6);
  assert.deepEqual(D.weekOf('2026-10-28'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  const october = D.monthWeeks('2026-10-15');
  assert.equal(october.length, 5); assert.equal(october[0][0], '2026-09-28'); assert.equal(october.at(-1)[6], '2026-11-01');
  const q4 = D.quarterWeeks('2026-11-03');
  assert.equal(q4[0][0], '2026-09-28'); assert.equal(q4.at(-1)[6], '2027-01-03'); assert.equal(q4.length, 14);
  assert.equal(D.quarterOf('2026-03-31'), 1); assert.equal(D.quarterOf('2026-10-01'), 4);
});

test('stepping keeps the day where the month allows it and crosses years', () => {
  assert.equal(D.step('month', '2026-01-31', 1), '2026-02-28');
  assert.equal(D.step('year', '2028-02-29', 1), '2029-02-28');
  assert.equal(D.step('quarter', '2026-11-30', 1), '2027-02-28');
  assert.equal(D.step('week', '2026-12-28', 1), '2027-01-04');
  assert.equal(D.step('day', '2026-12-31', 1), '2027-01-01');
  assert.equal(D.step('day', '2026-01-01', -1), '2025-12-31');
});

test('titles name the period; another year is named in full', () => {
  assert.equal(D.title('year', '2026-10-28', '2026-11-03'), '2026년');
  assert.equal(D.title('quarter', '2026-10-28', '2026-11-03'), '2026년 4분기');
  assert.equal(D.title('month', '2026-10-28', '2026-11-03'), '10월');
  assert.equal(D.title('month', '2025-10-28', '2026-11-03'), '2025년 10월');
  assert.equal(D.title('week', '2026-10-28', '2026-11-03'), '10.26 – 11.1');
  assert.equal(D.title('day', '2026-10-28', '2026-11-03'), '10월 28일 수요일');
  // Weeks follow their Monday's year; a New Year week names both years (from either side).
  assert.equal(D.title('week', '2027-01-01', '2026-11-03'), '2026년 12.28 – 2027년 1.3');
  assert.equal(D.title('week', '2026-12-29', '2027-01-02'), '2026년 12.28 – 2027년 1.3');
  assert.equal(D.title('week', '2027-01-06', '2027-01-02'), '1.4 – 1.10');
  assert.equal(D.title('week', '2025-06-04', '2026-11-03'), '2025년 6.2 – 6.8');
});

test('records group by the local civil day of their time; plans by their own date', () => {
  // 23:30 UTC on 10-27 is 08:30 on 10-28 in Seoul.
  const days = D.group({ posts: [{ id: 'a', at: '2026-10-27T23:30:00.000Z', photos: 1 }, { id: 'b', at: 'not a time' }],
    excerpts: [{ id: 'x', at: '2026-10-28T03:00:00.000Z' }], plans: [{ id: 'p', date: '2026-10-28', text: '예정' }, { id: 'q', date: '2026-02-30' }] });
  assert.deepEqual([...days.keys()], ['2026-10-28']);
  const entry = days.get('2026-10-28');
  assert.deepEqual([entry.posts.length, entry.excerpts.length, entry.plans.length], [1, 1, 1]);
  assert.equal(D.timeOf('2026-10-27T23:30:00.000Z'), '08:30');
  assert.equal(D.count(entry), 2); assert.equal(D.count(entry, 'photos'), 1); assert.equal(D.count(entry, 'excerpts'), 1);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(D.level), [0, 1, 1, 2, 2, 3]);
  assert.equal(D.countLabel(D.summary(days, D.weekOf('2026-10-28'))), '글 1편, 발췌 1개');
  assert.equal(D.lead(days, ['2026-10-28']).id, 'a');
});

// ── 2026-11-11 review MAJOR-2: a record whose time lies outside the days 일정 handles ──
test('a time outside 1900–2199 has no day (the list says 날짜 미확인, calendars leave it out) and never breaks parts()', () => {
  const D = require('../assets/life/schedule-data.js');
  for (const iso of ['0000-06-01T00:00:00.000Z', '0001-01-01T00:00:00.000Z', '0999-06-02T00:00:00.000Z', '1000-06-01T00:00:00.000Z', '1899-06-01T12:00:00.000Z', '2200-06-01T12:00:00.000Z', '9999-12-31T23:59:59.999Z'])
    assert.equal(D.dayOf(iso), null, iso);
  for (const iso of ['1900-06-01T12:00:00.000Z', '2026-11-11T03:00:00.000Z', '2199-06-01T12:00:00.000Z']) {
    const day = D.dayOf(iso); assert.ok(D.valid(day), iso); assert.equal(typeof D.parts(day).year, 'number'); assert.ok(D.dayTitle(day));
  }
  assert.equal(D.dayOf('not a time'), null); assert.equal(D.dayOf(undefined), null);
  // civil() always writes four year digits, so parts() reads what civil() wrote.
  for (const [date, text] of [[new Date(999, 5, 2, 12), '0999-06-02'], [new Date(2026, 10, 11, 12), '2026-11-11']]) { assert.equal(D.civil(date), text); assert.deepEqual(D.parts(D.civil(date)), { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }); }
  const early = new Date(2000, 0, 1, 12); early.setFullYear(7); assert.equal(D.civil(early), '0007-01-01');
  // Grouping keeps the readable records and skips the one without a day.
  const days = D.group({ posts: [{ id: 'a', at: '0999-06-02T00:00:00.000Z' }, { id: 'b', at: '2026-11-11T03:00:00.000Z' }] });
  assert.deepEqual([...days.values()].flatMap(entry => entry.posts.map(post => post.id)), ['b']);
});
