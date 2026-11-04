'use strict';
// 2026-11-04 (#opt-cpu review condition b): the home list's date labels reuse two formatters instead
// of making new ones per row. Their strings must equal the earlier per-row formatting, in Korean,
// in several time zones and across day and year edges.
const test = require('node:test'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const script = `
  globalThis.window = undefined; require(${JSON.stringify(path.join(__dirname, '../assets/life/home.js'))});
  const { dateLabels } = globalThis.HaedoLife.HomeUI;
  // The earlier code: a new formatter for every row.
  function before(value, prefix, now) {
    const date = new Date(value); if (!Number.isFinite(date.getTime())) return null;
    const options = { month: 'long', day: 'numeric' };
    if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
    return { text: prefix + new Intl.DateTimeFormat('ko-KR', options).format(date), title: prefix + new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(date) };
  }
  const values = ['2026-11-04T07:00:00.000Z', '2026-12-31T14:59:59.999Z', '2026-12-31T15:00:00.000Z', '2026-12-31T23:59:59.999Z', '2027-01-01T00:00:00.000Z',
    '2025-12-31T15:00:00.000Z', '2026-01-01T00:00:00Z', '2026-02-28T23:30:00+09:00', '2024-02-29T12:00:00Z', '1999-12-31T23:59:59Z', 'not a date', ''];
  for (let t = Date.UTC(2025, 11, 25); t < Date.UTC(2027, 0, 8); t += 3 * 3600 * 1000 + 17 * 60 * 1000) values.push(new Date(t).toISOString());
  const nows = [new Date('2026-06-01T00:00:00Z'), new Date('2026-12-31T15:30:00Z'), new Date('2027-01-01T00:30:00Z')];
  let compared = 0;
  for (const now of nows) for (const value of values) for (const prefix of ['수정 ', '저장 ']) {
    const a = JSON.stringify(dateLabels(value, prefix, now)), b = JSON.stringify(before(value, prefix, now));
    if (a !== b) { console.log(JSON.stringify({ value, prefix, now, a, b })); process.exit(1); }
    compared++;
  }
  console.log(JSON.stringify({ compared, sample: dateLabels('2026-12-31T15:00:00.000Z', '수정 ', nows[0]) }));
`;
for (const zone of ['Asia/Seoul', 'UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
  test('home date labels equal per-row formatting in ' + zone, () => {
    const run = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const result = JSON.parse(run.stdout.trim().split('\n').pop());
    assert.ok(result.compared > 1000, 'compared ' + result.compared);
    assert.match(result.sample.text, /^수정 .*월 .*일$/, 'Korean month and day');
  });
}

// #194 review minor 2: a formatter keeps the zone it was made in. When the device moves to another
// zone while the page stays open, the labels follow the new zone, as a fresh formatter would.
test('home date labels follow a time zone change while the page stays open', () => {
  const run = spawnSync(process.execPath, ['-e', `
    globalThis.window = undefined; require(${JSON.stringify(path.join(__dirname, '../assets/life/home.js'))});
    const { dateLabels } = globalThis.HaedoLife.HomeUI, now = new Date('2026-06-01T00:00:00Z');
    const before = dateLabels('2026-11-04T20:00:00Z', '수정 ', now);
    process.env.TZ = 'Pacific/Kiritimati';
    const after = dateLabels('2026-11-04T20:00:00Z', '수정 ', now);
    console.log(JSON.stringify({ before, after }));`], { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const { before, after } = JSON.parse(run.stdout.trim());
  assert.deepEqual(before, { text: '수정 11월 4일', title: '수정 2026년 11월 4일' });
  assert.deepEqual(after, { text: '수정 11월 5일', title: '수정 2026년 11월 5일' });
});
