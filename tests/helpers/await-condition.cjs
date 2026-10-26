'use strict';
const { performance } = require('node:perf_hooks');

// The pinned Playwright can accept an async waitForFunction predicate before
// its Promise resolves. Await the observation in Node and require boolean true.
async function awaitCondition(page, predicate, argument, { timeout, label = 'browser condition' } = {}) {
  if (!Number.isFinite(timeout) || timeout <= 0) throw new TypeError('awaitCondition requires an explicit positive timeout');
  const deadline = performance.now() + timeout;
  const timeoutError = () => Object.assign(new Error(label + ' did not become true within ' + timeout + 'ms'), { name: 'TimeoutError' });
  while (performance.now() < deadline) {
    let timer;
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    let result;
    try {
      result = await Promise.race([
        Promise.resolve().then(() => page.evaluate(predicate, argument)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError()), remaining); })
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (result === true) return;
    const pause = Math.min(16, deadline - performance.now());
    if (pause > 0) await new Promise(resolve => setTimeout(resolve, pause));
  }
  throw timeoutError();
}

module.exports = { awaitCondition };
