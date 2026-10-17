// Model timings on anonymous data; no timing assertions or production access.
const fs = require('node:fs/promises'), path = require('node:path');
const { fixture } = require('../tests/fixtures/search-scale.cjs');
const { playwright, makeContext, ready } = require('../tests/unified-home-browser.cjs');
const { FakeCloud, accounts, base } = require('../tests/life-sync-browser.cjs');
async function main() {
  const out = path.resolve('.local/flow-quality'); await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const report = { browser: browser.version(), scope: 'Linux model-only timings, 7 samples including cold first call; CDP heap is a point-in-time reading without forced GC. No IDB load, DOM paint or Apple hardware claim.', samples: [] };
  try {
    const context = await makeContext(browser, new FakeCloud(), 'search-scale', accounts.a);
    const page = await context.newPage(); await page.goto(base + '/index.html'); await ready(page);
    const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
    // Optional immutable old module, provided by the caller for same-browser comparisons.
    if (process.env.SEARCH_BASELINE_FILE) await page.evaluate(source => {
      const current = HaedoLife.UnifiedSearch; (0, eval)(source); window.__baselineSearch = HaedoLife.UnifiedSearch; HaedoLife.UnifiedSearch = current;
    }, await fs.readFile(process.env.SEARCH_BASELINE_FILE, 'utf8'));
    for (const count of [100, 1000, 5000]) {
      const value = await fixture(count), bytes = Buffer.byteLength(JSON.stringify(value));
      await page.evaluate(data => { window.__scaleData = data; }, value);
      for (const implementation of process.env.SEARCH_BASELINE_FILE ? ['before', 'after'] : ['after']) for (const query of ['산책', '기억표식', '없는검색어']) {
        const result = await page.evaluate(({ implementation, query, count }) => {
          const model = implementation === 'before' ? __baselineSearch : HaedoLife.UnifiedSearch, times = [];
          for (let i = 0; i < 7; i++) {
            const start = performance.now(), rows = model.search(__scaleData, query); times.push(performance.now() - start);
            if (rows.length !== (query === '없는검색어' ? 0 : count)) throw Error('Search dropped results');
            if (rows[0]?.sourceVersionId !== (query === '없는검색어' ? undefined : 'v0')) throw Error('Search changed exact identity');
          }
          times.sort((a, b) => a - b); return { p50: times[3], p95: times[6] };
        }, { implementation, query, count });
        const metrics = (await cdp.send('Performance.getMetrics')).metrics;
        report.samples.push({ implementation, count, query, serializedBytes: bytes, ...result, heapUsedBytes: metrics.find(m => m.name === 'JSHeapUsedSize')?.value });
      }
      await page.evaluate(() => { delete window.__scaleData; });
    }
    // A separate end-to-end sample includes real IndexedDB installation/load and DOM paint.
    const sample = await fixture(1000);
    await page.evaluate(async data => { await HaedoLife.Shell.storage.installWorkspace(data.bundle); }, sample);
    const loadStart = performance.now(); await page.goto(base + '/index.html?section=records&view=find'); await ready(page);
    await page.locator('#lifeFind[aria-busy="false"]').waitFor();
    const loadMs = performance.now() - loadStart;
    await page.locator('#lifeFindQuery').fill('기억표식');
    await page.waitForFunction(() => document.querySelectorAll('.life-find-result').length === 5);
    report.ui = await page.evaluate(async () => {
      const input = document.querySelector('#lifeFindQuery');
      const samples = [];
      for (const value of ['없는검색어', '기억표식', '산책', '기억표식']) {
        const start = performance.now(); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); samples.push({ query: value, inputToTwoFramesMs: performance.now() - start });
      }
      const start = performance.now(); document.querySelector('.life-find-tabs [data-kind=source]').click();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { count: 1000, samples, cachedKindToTwoFramesMs: performance.now() - start, renderedRows: document.querySelectorAll('.life-find-result').length };
    }); report.ui.navigationAndLoadMs = loadMs;
    if (report.ui.renderedRows !== 20) throw Error('Unbounded result rendering');
  } finally { await browser.close(); await fs.writeFile(path.join(out, 'search-browser-performance.json'), JSON.stringify(report, null, 2)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
