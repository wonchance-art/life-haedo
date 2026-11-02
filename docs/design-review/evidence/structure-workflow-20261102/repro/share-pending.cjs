/* B3 재현: 공개 사본 게시 요청이 서버에 커밋된 뒤 응답 전에 탭을 닫으면 어떻게 되는가.
 * 실행(저장소 루트): python3 -m http.server 4184 --bind 127.0.0.1 &
 *   BASE_URL=http://127.0.0.1:4184 PW_MODULE_PATH=... CHROMIUM_PATH=... \
 *   node docs/design-review/evidence/structure-workflow-20261102/repro/share-pending.cjs
 * 기존 tests/life-share-browser.cjs의 익명 ShareCloud(공개 RPC 모사)를 재사용한다.
 * ShareCloud는 put을 먼저 저장한 뒤 held 응답을 붙잡으므로 "커밋됐지만 응답 전" 상태를 만든다.
 * 운영 SQL/RLS·실제 계정·Apple 기기 검증이 아니다. 앱 코드를 바꾸지 않는다. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../../..');
const { ShareCloud, shareFixture } = require(path.join(root, 'tests/life-share-browser.cjs'));
const { accounts, base } = require(path.join(root, 'tests/life-sync-browser.cjs'));
const { playwright, makeContext } = require(path.join(root, 'tests/unified-home-browser.cjs'));
const { go } = require(path.join(root, 'tests/life-workbench-browser.cjs'));

const PREFIX = 'life_share_pending_v1:';
const results = [];
const step = (name, value) => { results.push({ name, ...value }); console.log('STEP ' + name + ' ' + JSON.stringify(value)); };
const ignoredRouteErrors = [];
process.on('unhandledRejection', error => {
  // Fulfilling the held response after its tab closed is the scenario itself.
  if (/closed|Target|disposed|handled/i.test(String(error?.message))) { ignoredRouteErrors.push(String(error.message).split('\n')[0]); return; }
  throw error;
});
const pendingIn = page => page.evaluate(prefix => Object.keys(sessionStorage).filter(key => key.startsWith(prefix))
  .map(key => ({ key, value: JSON.parse(sessionStorage.getItem(key)) })), PREFIX);
const idle = page => page.waitForFunction(() => document.querySelector('#wbSharePanel')?.getAttribute('aria-busy') === 'false');
async function openShare(page) {
  await go(page, 'page'); await page.locator('#wbPageShare').click();
  await page.locator('#wbSharePanel').waitFor(); await idle(page);
}
async function panel(page) {
  return page.evaluate(() => ({
    status: document.querySelector('#wbShareStatus')?.textContent || null,
    url: document.querySelector('#wbShareUrl')?.getAttribute('href') || null,
    retry: !!document.querySelector('#wbShareRetry'),
    pendingNotice: (document.querySelector('#wbSharePanel')?.textContent || '').includes('아직 확인하지 못한 요청'),
    error: document.querySelector('#wbShareError:not([hidden])')?.textContent || null
  }));
}

(async () => {
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  let failed = false;
  try {
    const server = new ShareCloud(), device = 'repro-share';
    const context = await makeContext(browser, server, device, accounts.a);
    const tab1 = await context.newPage(); tab1.setDefaultTimeout(15000);
    const fixture = await shareFixture(tab1);
    const key = accounts.a.id + ':' + fixture.workspaceId;

    // A second tab that read the head (revision 0) before the first publish commits.
    const tab2 = await context.newPage(); tab2.setDefaultTimeout(15000);
    await openShare(tab2);
    await openShare(tab1);

    // 1. Publish in tab1; the fake server stores the row, then holds the HTTP response.
    const gate = server.held('life_public_page_put', device);
    await tab1.locator('#wbShareConsent').check(); await tab1.locator('#wbSharePublish').click();
    await gate.entered;
    const pending = await pendingIn(tab1), row = server.pages.get(key);
    assert.equal(pending.length, 1, 'tab1 keeps exactly one pending record before the response');
    step('pending-before-close', { storage: 'sessionStorage', fields: Object.keys(pending[0].value), action: pending[0].value.action,
      expectedRevision: pending[0].value.expectedRevision, snapshotEntries: pending[0].value.snapshot?.entries?.length ?? null,
      serverCommitted: !!row, serverRevision: row?.revision ?? null, serverPublished: row?.published ?? null });
    const committedPublicId = row.publicId;

    // 2. Close the tab while the response is outstanding, then let the server answer.
    await tab1.close(); gate.release(); await new Promise(resolve => setTimeout(resolve, 300));

    // 3. Reopen: a new tab of the same browser profile (localStorage/IndexedDB kept, sessionStorage not).
    const tab3 = await context.newPage(); tab3.setDefaultTimeout(15000);
    await go(tab3, 'page');
    const after = await pendingIn(tab3);
    step('pending-after-reopen', { count: after.length });
    await tab3.locator('#wbPageShare').click(); await tab3.locator('#wbSharePanel').waitFor();
    await tab3.waitForFunction(() => document.querySelector('#wbSharePanel')?.getAttribute('aria-busy') === 'false' &&
      document.querySelector('#wbShareStatus')?.textContent !== '공개 상태를 확인하는 중…');
    const reopened = await panel(tab3);
    step('reopened-share-panel', { ...reopened, publicIdMatchesCommitted: reopened.url ? new URL(reopened.url, base).searchParams.get('id') === committedPublicId : false });

    // 4. The management list in another reopened tab shows the publication.
    const manage = await context.newPage(); manage.setDefaultTimeout(15000);
    await manage.goto(base + '/index.html?section=manage&view=public-pages');
    await manage.waitForFunction(id => !!document.querySelector('article.wb-public-page[data-workspace-id="' + id + '"]'), fixture.workspaceId).catch(() => {});
    step('public-pages-list', { listed: await manage.locator('article.wb-public-page[data-workspace-id="' + fixture.workspaceId + '"]').count() });
    await manage.close();

    // 5. The stale tab2 (head revision 0) tries its own publish: CAS conflict, not a second page.
    await tab2.locator('#wbShareConsent').check(); await tab2.locator('#wbSharePublish').click(); await idle(tab2);
    step('stale-tab-publish', { ...(await panel(tab2)), pages: server.pages.size, revision: server.pages.get(key).revision,
      putCalls: server.publicationWrites().map(write => ({ expected: write.body.p_expected_revision, action: write.body.p_action })) });

    // 6. Withdraw from the reopened tab.
    await tab3.locator('#wbShareRevoke').click(); await tab3.locator('#wbShareRevokeConfirm').click();
    await tab3.waitForFunction(() => document.querySelector('#wbSharePanel')?.getAttribute('aria-busy') === 'false' &&
      /철회/.test(document.querySelector('#wbShareStatus')?.textContent || ''));
    const final = server.pages.get(key);
    step('withdraw-after-reopen', { ...(await panel(tab3)), published: final.published, revision: final.revision, pages: server.pages.size });

    assert.equal(after.length, 0, 'sessionStorage pending record is gone in a new tab');
    assert.match(reopened.status, /공개 중/, 'reopened tab reads the committed publication from the server');
    assert.equal(server.pages.size, 1, 'no duplicate public page');
    assert.equal(final.published, false, 'withdraw works after reopen');
    console.log('REPRO PASS: pending record lost with the tab; publication neither orphaned nor duplicated; visible and withdrawable after reopen.');
  } catch (error) { failed = true; console.error('REPRO FAIL ' + error.stack); }
  finally {
    await browser.close();
    console.log(JSON.stringify({ results, ignoredRouteErrors }, null, 2));
    process.exitCode = failed ? 1 : 0;
  }
})();
