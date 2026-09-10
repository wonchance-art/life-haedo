const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../assets/data.js');
const sample = () => ({ scale: 'signed1', profile: { name: 'Test', birth: '1995-01' }, events: [{ date: '2024-02-29', title: 'Test' }] });
test('dates follow the Gregorian calendar, including century leap years', () => {
  for (const date of ['2024-02-29', '2000-02-29', '2026-09', '2026-12-31']) assert.equal(data.validDate(date), true, date);
  for (const date of ['1900-02-29', '2025-02-29', '2026-04-31', '2026-02-00', '2026-13', '0000-01', '2026-01-32', null]) assert.equal(data.validDate(date), false, date);
});
test('moving a dated entry to a shorter month clamps its day', () => {
  assert.equal(data.withDay('2024-01-31', '2024-02'), '2024-02-29');
  assert.equal(data.withDay('2024-02-29', '2025-02'), '2025-02-28');
  assert.equal(data.withDay('2024-01', '2024-02'), '2024-02');
});
test('invalid collections, values, coordinates and injectable colors are preserved in quarantine', () => {
  const d = sample(); d.events.push(null, { happiness: Infinity, loc: { lat: 100, lng: 0 } });
  d.spans = 'damaged'; d.layers = [{ color: '\"><img src=x onerror=alert(1)>' }];
  const result = data.structure(d);
  assert.equal(result.events.length, 2); assert.deepEqual(result.spans, []);
  assert.equal(result.events[1].happiness, null); assert.equal(result.events[1].loc, undefined);
  assert.equal(result.layers[0].color, '#7A8A80'); assert.equal(result._quarantine.length, 5);
});
test('import assigns new document IDs without mutating or overwriting the original', () => {
  const original = { docs: [{ id: 'existing', data: sample() }, { id: 'existing', data: sample() }] };
  const before = structuredClone(original); let counter = 0;
  const imported = data.prepareImport(original, () => `new${++counter}`, data.structure);
  assert.deepEqual(imported.map(d => d.id), ['new1', 'new2']); assert.deepEqual(original, before);
  assert.ok(imported.every(d => d.data.events[0].title === 'Test'));
});
test('a malformed backup fails before normalizing or generating IDs', () => {
  let calls = 0;
  assert.throws(() => data.prepareImport({ docs: [{ data: sample() }, { data: {} }] }, () => calls++, () => calls++));
  assert.equal(calls, 0);
});
test('pristine comparison excludes renderer fields but retains edits to thoughts and layers', () => {
  const a = sample(), b = sample(); b.events[0].t = 2024; b.events[0].fut = true;
  assert.deepEqual(data.canonical(a), data.canonical(b));
  b.thoughts = [{ date: '2024-01', text: 'New thought' }];
  assert.notDeepEqual(data.canonical(a), data.canonical(b));
});
test('planned observations do not make later actual segments dashed', () => {
  const points = [false, false, true, false, false].map((future, x) => ({ x, future }));
  assert.deepEqual(data.curveIntervals(points), [
    { start: 0, end: 1, future: false }, { start: 1, end: 3, future: true }, { start: 3, end: 4, future: false }
  ]);
  assert.deepEqual(data.curveIntervals([]), []);
});
