'use strict';
// 2026-11-04 (status reads, D1): SyncCommon.latest runs a status refresh one at a time. Requests made
// meanwhile share one more run after it. The screen therefore ends on the latest state after any burst
// of events, and an earlier read never lands after a later one.
const test = require('node:test'), assert = require('node:assert/strict');
const { latest } = require('../assets/life/sync-common.js');
const sleep = ms => new Promise(done => setTimeout(done, ms));

function screenFixture({ delays = () => 5 } = {}) {
  // A refresh like ui.js: read the source (slowly), then write the screen if no newer refresh began.
  const f = { source: 0, screen: null, runs: 0, overlap: 0, maxOverlap: 0, starts: [], writes: [], sequence: 0 };
  f.refresh = latest(async () => {
    const run = ++f.runs, sequence = ++f.sequence, seen = f.source; f.starts.push({ run, at: performance.now(), seen });
    f.overlap++; f.maxOverlap = Math.max(f.maxOverlap, f.overlap);
    try { await sleep(delays(run)); } finally { f.overlap--; }
    if (sequence !== f.sequence) return run; // the ui.js sequence guard, kept
    f.screen = seen; f.writes.push(seen); return run;
  });
  return f;
}

test('a burst of 50 events ends with the latest state on screen, in far fewer reads, never overlapping', async () => {
  const f = screenFixture(), pending = [];
  for (let i = 1; i <= 50; i++) { f.source = i; pending.push(f.refresh()); if (i % 5 === 0) await sleep(1); }
  await Promise.all(pending);
  assert.equal(f.screen, 50, 'the last event is shown');
  assert.equal(f.maxOverlap, 1, 'reads never overlap');
  assert.ok(f.runs < 50 / 2, 'coalesced: ' + f.runs + ' runs');
  assert.deepEqual(f.writes, [...f.writes].sort((a, b) => a - b), 'the screen only moves forward');
});

test('each request settles with a run that started after it was made', async () => {
  const f = screenFixture(), made = [];
  for (let i = 1; i <= 20; i++) {
    f.source = i; const at = performance.now();
    made.push(f.refresh().then(run => ({ at, run })));
    await sleep(i % 3);
  }
  for (const { at, run } of await Promise.all(made)) assert.ok(f.starts[run - 1].at >= at, 'run ' + run + ' started after its request');
});

test('a slow early read cannot overwrite a later one (late response)', async () => {
  // Without one-at-a-time runs the first read (slow) would finish after the second (fast) and win.
  const f = screenFixture({ delays: run => run === 1 ? 40 : 2 });
  f.source = 1; const first = f.refresh();
  await sleep(1); f.source = 2; const second = f.refresh();
  await Promise.all([first, second]);
  assert.equal(f.screen, 2);
  assert.deepEqual(f.writes, [1, 2]);
});

test('a failed run rejects only its requests; the next request runs again', async () => {
  let runs = 0;
  const refresh = latest(async () => { const run = ++runs; await sleep(2); if (run === 1) throw Object.assign(Error('offline'), { code: 'network_error' }); return 'ok'; });
  const a = refresh(), b = refresh();
  await assert.rejects(a, { code: 'network_error' });
  assert.equal(await b, 'ok', 'the request made meanwhile is served by the next run');
  assert.equal(await refresh(), 'ok'); assert.equal(runs, 3);
});

test('the first run starts at once, as a direct call would', () => {
  let started = false;
  const refresh = latest(async () => { started = true; });
  refresh();
  assert.equal(started, true);
});
