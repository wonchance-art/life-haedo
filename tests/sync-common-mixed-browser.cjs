'use strict';
// An older index.html (without assets/life/sync-common.js) mixed with the newer modules during an
// update. The page must open with no page or console errors, the blog and preparation sync engines
// stay off, and the screens say to refresh the app instead of failing or promising a retry.
// Synthetic account on FakeCloud; the only change to the served files is removing that one script.
const assert = require('node:assert/strict');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');

const REFRESH = '앱을 새로고침한 뒤 다시 시도해 주세요. 글은 이 기기에 그대로 있습니다.';
const MISSING = '동기화 공통 모듈을 읽지 못했습니다. 새로고침해 주세요.';

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

    await check('Blog management refuses publish, withdraw and delete with the refresh message and keeps the post', async () => {
      await page.goto(base + '/index.html?section=records&view=blog'); await ready(page); await settle(page);
      const row = page.locator('.blog-post', { hasText: '섞인 판에서 쓴 글' });
      const postId = await row.getAttribute('data-post-id');
      const status = page.locator('.blog-manager > [role="status"]');
      // Each refusal must be its own message: clear the line first so an earlier one cannot pass.
      const refused = async click => {
        await status.evaluate(node => { node.textContent = ''; });
        let dialogs = 0; const onDialog = dialog => { dialogs++; dialog.dismiss(); }; page.on('dialog', onDialog);
        await click();
        await status.filter({ hasText: REFRESH }).waitFor();
        page.off('dialog', onDialog);
        assert.equal(dialogs, 0, 'refused before asking to confirm');
      };
      await row.getByRole('button', { name: '공개 내용 검토', exact: true }).click();
      await page.getByRole('button', { name: '공개 미리보기 갱신', exact: true }).click();
      await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check();
      await refused(() => page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click());
      assert.equal(await page.getByRole('link', { name: '공개한 글 열기' }).count(), 0);
      await refused(() => page.getByRole('button', { name: '공개 철회', exact: true }).click());
      await refused(() => row.getByRole('button', { name: '삭제', exact: true }).click());
      const kept = await page.evaluate(async id => { const s = HaedoLife.Shell.storage, doc = await s.readPhotoPost(await s.getActive(), id); return { title: doc.title, status: doc.status }; }, postId);
      assert.deepEqual(kept, { title: '섞인 판에서 쓴 글', status: 'saved' });
      assert.equal(await page.locator('.blog-post', { hasText: '섞인 판에서 쓴 글' }).count(), 1);
    });

    // After a failed open: the page body, its unsaved input and the 지금 저장 control are back, the
    // heading is the page's, and the error is a new one with the sync_common_missing code.
    const failedOpen = async (click, label) => {
      const error = page.locator('#wbError');
      // Count first: elementHandle() on a missing node waits out the whole default timeout.
      const shown = error.locator('p'), previous = await shown.count() ? await shown.elementHandle() : null;
      await click();
      if (previous) await page.waitForFunction(node => !node.isConnected, previous, { timeout: 15000 });
      await error.getByText(MISSING).waitFor();
      assert.equal(await error.getAttribute('data-code'), 'sync_common_missing', label + ': error code');
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'page', label + ': still on the page');
      assert.equal((await page.locator('.life-page-title').innerText()).trim(), '선택 자료 페이지', label + ': heading');
      assert.equal(await page.locator('#wbPageMaterialWriting').isVisible(), true, label + ': page body');
      assert.equal(await page.getByRole('button', { name: '지금 저장', exact: true }).isVisible(), true, label + ': save control');
      assert.equal(await page.locator('.mw-workspace').count(), 0, label + ': no preparation screen');
    };

    await check('Writing from the page keeps the page, its input and save control, and shows a new error each time', async () => {
      await page.goto(base + '/index.html?section=records&view=page'); await ready(page); await settle(page);
      if (!await page.locator('#wbPageTitle').isVisible()) await page.locator('#wbProfileEdit').click();
      await page.locator('#wbPageTitle').fill('섞인 판의 페이지 제목');
      for (let attempt = 1; attempt <= 2; attempt++) {
        await failedOpen(() => page.locator('#wbPageMaterialWriting').click(), 'page attempt ' + attempt);
        assert.equal(await page.locator('#wbPageTitle').inputValue(), '섞인 판의 페이지 제목', 'attempt ' + attempt + ': input kept');
      }
    });

    await check('Writing from a reader shows the page with its own heading and the error', async () => {
      const title = '섞인 판에서 읽은 자료';
      await page.evaluate(async title => {
        const s = HaedoLife.Shell.storage, c = HaedoLife.Core, b = await s.read(await s.getActive());
        const p = await c.prepareImport({ origin: 'other', title, text: '읽던 자료에서 글쓰기를 시작한다.', forceSeparate: true }, b);
        const result = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, p, []) });
        if (result.status !== 'stored') throw new Error('Anonymous source rejected');
      }, title);
      await page.goto(base + '/index.html?section=records&view=sources'); await ready(page); await settle(page);
      await page.locator('.life-source-open', { hasText: title }).first().click();
      await page.locator('#lifeSourceMaterialWriting').waitFor();
      await failedOpen(() => page.locator('#lifeSourceMaterialWriting').click(), 'reader');
    });

    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(external, []);
  } finally {
    await context.close(); await browser.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
