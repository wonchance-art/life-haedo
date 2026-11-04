'use strict';
// B2: the pure helpers the schedule uses for 행복도, habits and goals (assets/platform-data.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../assets/platform-data.js');

test('행복도 0–10 maps to the timeline scale by the timeline\'s own rule v = (n - 5) / 5', () => {
  assert.deepEqual([0, 1, 5, 7, 10].map(model.happinessValue), [-1, -0.8, 0, 0.4, 1]);
  for (let n = 0; n <= 10; n++) assert.equal(model.happinessScore(model.happinessValue(n)), n, 'round trip ' + n);
  assert.equal(model.happinessScore(0.35), 7); assert.equal(model.happinessScore(-0.05), 5);
  for (const bad of [-1, 11, 2.5, '5', null]) assert.throws(() => model.happinessValue(bad), /0부터 10/);
  for (const bad of [1.2, -3, NaN, '0.2', null]) assert.equal(model.happinessScore(bad), null);
});

test('a day\'s entry is read only from that date; month points of the timeline are not a day\'s input', () => {
  const doc = { profile: {}, happiness: [{ date: '2026-11', v: 0.2 }, { date: '2026-11-04', v: 0.35 }] };
  assert.deepEqual(model.happinessOn(doc, '2026-11-04'), { v: 0.35, score: 7 });
  assert.equal(model.happinessOn(doc, '2026-11-05'), null);
  assert.equal(model.happinessOn(doc, '2026-11'), null);
});

test('setting a day keeps every other entry, keeps a value that already shows as the same score, and clears', () => {
  const doc = { profile: { name: '익명' }, events: [{ date: '2020-01', title: '익명 사건', happiness: 0.1 }],
    happiness: [{ date: '2026-11', v: 0.2 }, { date: '2026-11-04', v: 0.35, note: '보존' }] };
  const same = model.withHappiness(doc, '2026-11-04', 7);
  assert.deepEqual(same.happiness, doc.happiness, '0.35 shows as 7 and is not rewritten');
  const changed = model.withHappiness(doc, '2026-11-04', 9);
  assert.deepEqual(changed.happiness[1], { date: '2026-11-04', v: 0.8, note: '보존' });
  assert.deepEqual(changed.happiness[0], { date: '2026-11', v: 0.2 }); assert.deepEqual(changed.events, doc.events);
  assert.equal(doc.happiness[1].v, 0.35, 'the input document is not modified');
  const added = model.withHappiness(doc, '2026-11-05', 0);
  assert.deepEqual(added.happiness.at(-1), { date: '2026-11-05', v: -1 });
  assert.deepEqual(model.withHappiness(doc, '2026-11-04', null).happiness, [{ date: '2026-11', v: 0.2 }]);
  assert.throws(() => model.withHappiness(doc, '2026-11', 5), /날짜/);
  assert.throws(() => model.withHappiness({ nope: true }, '2026-11-04', 5), /연표/);
});

test('due habits follow their weekdays and start date; deleted habits and goals are left out', () => {
  const habit = (id, days, created, checks = [], deleted) => ({ id, kind: 'habit', data: { title: id, days, created, checks, ...(deleted ? { deleted: true } : {}) } });
  const items = [habit('weekdays', [1, 2, 3, 4, 5], '2026-11-01', ['2026-11-04']), habit('sunday', [0], '2026-11-01'), habit('later', [3], '2026-11-10'),
    habit('gone', [3], '2026-11-01', [], true), { id: 'g', kind: 'goal', data: { title: 'g', progress: 10, target: '' } }];
  const due = model.dueHabits(items, '2026-11-04'); // a Wednesday
  assert.deepEqual(due.map(row => [row.item.id, row.checked]), [['weekdays', true]]);
  assert.deepEqual(model.dueHabits(items, '2026-11-08').map(row => row.item.id), ['sunday']);
  assert.deepEqual(model.dueHabits(items, 'bad'), []);
});

test('active goals: unfinished, target not before the period, nearest target first', () => {
  const g = (id, progress, target, deleted) => ({ id, kind: 'goal', data: { title: id, progress, target, ...(deleted ? { deleted: true } : {}) } });
  const items = [g('open', 30, ''), g('soon', 10, '2026-12-01'), g('past', 20, '2026-10-01'), g('done', 100, '2026-12-31'), g('gone', 5, '2026-12-02', true), g('next', 50, '2026-11-20')];
  assert.deepEqual(model.activeGoals(items, '2026-11-01').map(item => item.id), ['next', 'soon', 'open']);
  assert.deepEqual(model.activeGoals(items, null).map(item => item.id), ['past', 'next', 'soon', 'open']);
});

test('newest edit wins; a tie or an unreadable stamp goes to the server copy', () => {
  assert.equal(model.localWins('2026-11-04T00:00:02Z', '2026-11-04T00:00:01Z'), true);
  assert.equal(model.localWins('2026-11-04T00:00:01Z', '2026-11-04T00:00:01Z'), false);
  assert.equal(model.localWins('2026-11-04T00:00:00Z', '2026-11-04T00:00:01Z'), false);
  assert.equal(model.localWins('bad', '2026-11-04T00:00:01Z'), false);
  assert.equal(model.localWins('2026-11-04T00:00:01Z', 'bad'), true);
  assert.equal(model.keys('A').recovery, 'caeyeon_life_account_A_items_recovery');
});

test('the full backup\'s timeline part carries the recovery list next to the items', () => {
  globalThis.HaedoLife ||= {};
  const Full = require('../assets/life/full-backup.js');
  const values = new Map([[model.keys('A').items, JSON.stringify([{ id: 'g', kind: 'goal', data: { title: 'g', progress: 1, target: '' } }])],
    [model.keys('A').recovery, JSON.stringify([{ id: 'g', kind: 'goal', data: { title: 'g', progress: 9, target: '' }, updated: '2026-11-01T00:00:00Z', keptAt: '2026-11-02T00:00:00Z', reason: 'remote_newer' }])]]);
  const snapshot = Full.timelineSnapshot({ platformData: model, localStorage: { getItem: key => values.get(key) ?? null }, uid: 'A', now: () => 'T' });
  assert.equal(snapshot.format, 'haedo-platform-backup-v1');
  assert.equal(snapshot.items.length, 1);
  assert.deepEqual(snapshot.recovery.map(row => [row.id, row.data.progress, row.reason]), [['g', 9, 'remote_newer']]);
  const empty = Full.timelineSnapshot({ platformData: model, localStorage: { getItem: () => null }, uid: 'A', now: () => 'T' });
  assert.deepEqual(empty.recovery, []);
});
