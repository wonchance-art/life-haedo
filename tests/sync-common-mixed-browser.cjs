'use strict';
// An older index.html (without assets/life/sync-common.js) mixed with the newer modules during an
// update. The page must open with no page or console errors, the blog and preparation sync engines
// stay off, and the screens say to refresh the app instead of failing or promising a retry.
// Synthetic account on FakeCloud; the only change to the served files is removing that one script.
const assert = require('node:assert/strict');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');

async function main() {
  const browser = await playwright().chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await makeContext(browser, new FakeCloud(), 'sync-common-mixed', accounts.a, { viewport: { width: 1440, height: 1000 } });
  const external = [], errors = [], consoleErrors = [];
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback();
    external.push(u.origin); return route.abort();
  });
  await context.route(/\/index\.html(\?.*)?$/, async route => {
    const response = await route.fetch(), html = await response.text();
    const older = html.replace(/\s*<script src="assets\/life\/sync-common\.js"><\/script>/, '');
    assert.notEqual(older, html, 'the served page lost its sync-common.js script');
    await route.fulfill({ response, body: older });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const check = async (name, run) => { console.log('START ' + name); await run(); console.log('PASS ' + name); };
  try {
    await check('The mixed page opens the private app with no page or console errors', async () => {
      await page.goto(base + '/index.html'); await ready(page); await settle(page);
      const state = await page.evaluate(() => ({ syncCommon: !!HaedoLife.SyncCommon, blogSync: !!HaedoLife.BlogSync, material: !!HaedoLife.MaterialContinuitySync, app: !document.querySelector('#lifeApp').hidden }));
      assert.deepEqual(state, { syncCommon: false, blogSync: true, material: true, app: true });
    });

    await check('A saved post says the app needs a refresh to reach the account, with no retry button', async () => {
      await page.locator('#homeComposition[aria-busy="false"]').waitFor();
      await page.locator('[data-home-destination="write"]:visible, #homeFirstWrite:visible').first().click();
      await page.locator('#photoTitle').fill('섞인 판에서 쓴 글'); await page.locator('.ql-editor').fill('새로고침 전까지 이 기기에만 있다.');
      await page.getByRole('button', { name: '글 저장', exact: true }).click();
      const status = page.locator('#photoServerStatus');
      await status.filter({ hasText: '저장됨 · 앱을 새로고침하면 계정에 올립니다.' }).waitFor();
      assert.equal(await status.getAttribute('data-state'), 'refresh');
      assert.equal(await page.locator('#photoServerRetry').count(), 0);
    });

    await check('Writing from materials keeps the page and shows the error instead of losing the page body', async () => {
      await page.goto(base + '/index.html?section=records&view=page'); await ready(page); await settle(page);
      const open = page.locator('#wbPageMaterialWriting');
      for (let attempt = 0; attempt < 2; attempt++) {
        await open.click();
        await page.getByText('동기화 공통 모듈을 읽지 못했습니다. 새로고침해 주세요.').waitFor();
        assert.equal(await open.isVisible(), true, 'the page body is still there');
        assert.equal(await page.locator('.mw-workspace').count(), 0);
      }
    });

    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(external, []);
  } finally {
    await context.close(); await browser.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
