'use strict';
// S2: the page-lifecycle events reach the sync engines in a real signed-in page (FakeCloud,
// synthetic account A). For each event the set of server calls it causes is pinned; the same file
// passes on main before S2 (2a224dc) and after it. Observable here: preparations
// (life_material_list), account documents (life_account_document_changes) and, as an unchanged
// control, the blog (life_blog_sync_list). The other engines make no server call on this page; their
// event -> handler bindings are pinned by tests/sync-lifecycle.test.cjs.
const assert = require('node:assert/strict');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');

const MATERIAL = 'life_material_list', DOCS = 'life_account_document_changes', BLOG = 'life_blog_sync_list';
const QUIET_MS = 2500; // longer than the engines' immediate wake-ups (0 ms timers, direct passes)

async function main() {
  const browser = await playwright().chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await makeContext(browser, new FakeCloud(), 'sync-lifecycle', accounts.a, { viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [], calls = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { const url = new URL(request.url()); if (url.origin === cloud && url.pathname.startsWith('/rest/v1/rpc/')) calls.push(url.pathname.slice('/rest/v1/rpc/'.length)); });
  const check = async (name, run) => { console.log('START ' + name); await run(); console.log('PASS ' + name); };
  // Dispatches in the page, waits until the expected calls arrive (or QUIET_MS for none), then
  // compares the whole set.
  async function after(dispatch, expected, label) {
    calls.length = 0;
    await page.evaluate(dispatch);
    const deadline = Date.now() + 10000;
    while (expected.some(name => !calls.includes(name)) && Date.now() < deadline) await page.waitForTimeout(100);
    await page.waitForTimeout(expected.length ? 500 : QUIET_MS);
    assert.deepEqual([...new Set(calls)].sort(), [...expected].sort(), label);
  }
  // Page scripts as text: page.evaluate does not carry closures into the page.
  const fire = type => `dispatchEvent(new Event(${JSON.stringify(type)}))`;
  const visibility = state => `Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => ${JSON.stringify(state)} }); document.dispatchEvent(new Event('visibilitychange'))`;
  const persisted = type => `dispatchEvent(new PageTransitionEvent(${JSON.stringify(type)}, { persisted: true }))`;
  const onDocument = type => `document.dispatchEvent(new Event(${JSON.stringify(type)}))`;
  try {
    await page.goto(base + '/index.html'); await ready(page); await settle(page);
    await page.waitForTimeout(QUIET_MS);

    await check('online and focus wake preparations, account documents and the blog', async () => {
      await after(fire('online'), [MATERIAL, DOCS, BLOG], 'online');
      await after(fire('focus'), [MATERIAL, DOCS, BLOG], 'focus');
    });

    await check('hiding the page flushes account documents only; showing it pulls preparations and documents again', async () => {
      await after(visibility('hidden'), [DOCS], 'hidden');
      await after(visibility('visible'), [MATERIAL, DOCS, BLOG], 'visible');
    });

    await check('a page in the back/forward cache starts nothing until its pageshow', async () => {
      await after(persisted('pagehide'), [], 'persisted pagehide');
      await after(fire('online'), [], 'online while parked');
      // The shell's own pageshow handling verifies the account again and sends haedo:page-ready.
      await after(persisted('pageshow'), [MATERIAL, DOCS], 'pageshow itself');
      await after(fire('online'), [MATERIAL, DOCS, BLOG], 'online after pageshow');
    });

    await check('a suspended page sends nothing until haedo:page-ready', async () => {
      await after(onDocument('haedo:page-suspend'), [], 'suspend');
      await after(fire('focus'), [BLOG], 'focus while suspended: only the blog, which has no suspend handler');
      await after(onDocument('haedo:page-ready'), [MATERIAL, DOCS], 'ready');
    });

    assert.deepEqual(errors, []);
  } finally {
    await context.close(); await browser.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
