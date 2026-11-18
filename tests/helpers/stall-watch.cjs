/* A step with no time limit of its own (page.evaluate, locator.evaluateAll) raced with a timer.
 * When the timer wins, the step FAILS (it never passes) and the error says what could still be read at that moment:
 * whether the page's main thread answers, the viewport, the address and the last console lines.
 *
 * Added 2026-11-18: account-library-browser stopped once in captureThree's evaluateAll at 390×844 (no exit code, ended
 * by hand after about ten minutes) and could not be reproduced in 75 later runs. This does not fix anything. It makes
 * the next occurrence end as a failure with enough to tell a blocked main thread from a lost answer.
 * Existing assertions and time limits are unchanged: the limit here is far above what the step takes (well under 1s). */
'use strict';
const STALLED = Symbol('stalled');
const consoles = new WeakMap();
// Starts keeping the page's last console lines and page errors (call before the watched step).
function lastConsole(page, keep = 10) {
  if (consoles.has(page)) return consoles.get(page);
  const lines = [];
  const push = text => { lines.push(text.slice(0, 240)); if (lines.length > keep) lines.shift(); };
  page.on('console', message => push(message.type() + ': ' + message.text()));
  page.on('pageerror', error => push('pageerror: ' + error.message));
  consoles.set(page, lines);
  return lines;
}
const within = (promise, ms, fallback) => { let timer; return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })]).finally(() => clearTimeout(timer)); };
async function watched(page, label, run, { limit = 30000 } = {}) {
  const lines = lastConsole(page);
  const step = Promise.resolve().then(run);
  step.catch(() => {}); // a step left behind after a stall must not end the process a second time
  const result = await within(step, limit, STALLED);
  if (result !== STALLED) return result;
  const thread = await within(page.evaluate(() => 1).then(() => 'answers', error => 'evaluate failed: ' + String(error.message).split('\n')[0].slice(0, 160)), 3000, 'no answer in 3000ms (blocked)');
  let viewport = null, address = null;
  try { viewport = page.viewportSize(); address = page.url(); } catch (_) { /* a closed page has neither */ }
  throw new Error(label + ': no result after ' + limit + 'ms; stopped as a failure. Main thread: ' + thread + '. Viewport: ' + JSON.stringify(viewport) + '. Address: ' + address + '. Last console lines: ' + JSON.stringify(lines));
}
module.exports = { watched, lastConsole };
