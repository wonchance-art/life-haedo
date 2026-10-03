/* Real workspace DOM + backupFile.onchange + platform data/store regression.
 * Auth and its HTTP responses are anonymous mocks: this does not test Google,
 * live Supabase, production RLS or actual Apple hardware/file-provider behavior.
 * Start npm run dev, then node tests/platform-import-browser.cjs.
 * BASE_URL must point to localhost; PW_MODULE_PATH and CHROMIUM_PATH select
 * existing test tools. No application dependencies are installed.
 */
'use strict';
const assert = require('node:assert/strict');
// Reuse the existing anonymous identities and localhost-checked BASE_URL.
const { base, accounts } = require('./life-sync-browser.cjs');
const origin = new URL(base).origin;
function playwright() {
  for (const name of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core',
    '/opt/codex/cua_node/lib/node_modules/playwright', '/opt/codex/cua_node/lib/node_modules/playwright-core'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Set PW_MODULE_PATH to an existing Playwright installation.');
}
(async () => {
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  let passed = 0;
  try {
    for (const mode of ['A-B', 'A-B-A', 'foreign-goal-only']) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      await context.addInitScript(account => {
        globalThis.__requests = [];
        globalThis.HaedoAuth = {
          user: { id: account.id }, epoch: 0, config: { url: 'https://fixture.invalid' },
          requireUser: async function () { return this.user; },
          request: async function (_url, options) { __requests.push(options?.method || 'GET'); return new Response('[]', { status: 200 }); },
        };
      }, accounts.a);
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (['assets/platform-auth.js', 'assets/platform-config.js'].some(file => url.href === base + '/' + file)) {
          return route.fulfill({ contentType: 'application/javascript', body: '/* isolated anonymous auth fixture */' });
        }
        return route.continue();
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/workspace.html');
      await page.waitForFunction(() => typeof document.getElementById('backupFile')?.onchange === 'function' && !document.getElementById('syncRetry').disabled);
      const result = await page.evaluate(async ({ mode, accounts }) => {
        const before = () => Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]);
        const originalImport = HaedoPlatformData.importDocs, originalChange = HaedoPlatformStore.change;
        let imports = 0, itemChanges = 0, release, entered;
        HaedoPlatformData.importDocs = (...args) => { imports++; return originalImport(...args); };
        HaedoPlatformStore.change = (...args) => { itemChanges++; return originalChange(...args); };
        const loaded = new Promise(resolve => { entered = resolve; });
        const bytes = new Promise(resolve => { release = resolve; });
        const doc = { profile: { name: '익명 가져오기', birth: '1990-01' }, events: [], spans: [] };
        const payload = mode === 'foreign-goal-only'
          ? { format: 'life-tools-backup-v1', items: [{ id: 'old-goal', kind: 'goal', data: { title: '다른 형식', progress: 0 } }] }
          : { format: 'haedo-platform-backup-v1', docs: [{ id: 'old-doc', data: doc }] };
        const target = { value: 'selected', files: [{ size: 512, text: () => { entered(); return bytes; } }] };
        const starting = before(), requestCount = __requests.length;
        const pending = document.getElementById('backupFile').onchange({ target });
        await loaded;
        if (mode !== 'foreign-goal-only') {
          HaedoAuth.user = { id: accounts.b.id }; HaedoAuth.epoch++; HaedoPlatformStore.init(accounts.b.id);
          if (mode === 'A-B-A') { HaedoAuth.user = { id: accounts.a.id }; HaedoAuth.epoch++; HaedoPlatformStore.init(accounts.a.id); }
        }
        release(JSON.stringify(payload)); await pending;
        return { imports, itemChanges, unchanged: JSON.stringify(starting) === JSON.stringify(before()),
          requestsAdded: __requests.length - requestCount, cleared: target.value === '',
          message: document.getElementById('platformToast').textContent };
      }, { mode, accounts });
      assert.equal(result.imports, 0); assert.equal(result.itemChanges, 0);
      assert.equal(result.unchanged, true); assert.equal(result.requestsAdded, 0); assert.equal(result.cleared, true);
      assert.match(result.message, mode === 'foreign-goal-only' ? /연표·목표·습관 백업/ : /계정이 변경/);
      assert.deepEqual(errors, []);
      console.log('PASS actual backupFile.onchange: ' + mode + ', no import/local write/remote call');
      passed++;
      await context.close();
    }
  } finally { await browser.close(); }
  console.log(`${passed} platform import boundary checks passed (anonymous Auth mock).`);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
