/* Blog entry journey: real local application, bundled SDK and account-scoped
 * IndexedDB. Anonymous HTTP Auth fixtures only; no real accounts or remote DB.
 * BASE_URL=http://127.0.0.1:4173 node tests/blog-platform-home-browser.cjs
 */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { ShareCloud } = require('./life-share-browser.cjs');
const { playwright, shellReady, settle, makeContext, observe } = require('./unified-home-browser.cjs');
const { nav, openWritings, ready } = require('./writings-navigation.cjs');
const { inspectHome } = require('./home-entry-browser.cjs');

const out = process.env.BLOG_OUT_DIR ? path.resolve(process.env.BLOG_OUT_DIR) : path.resolve(__dirname, '../.local/blog-platform');
const sizes = [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }];
const report = { createdAt: new Date().toISOString(), scope: 'Linux Chromium viewport simulation; actual local application/SDK/IndexedDB, intercepted anonymous HTTP Auth. No live OAuth/DB, Apple hardware or deployment claim.', checks: [], visual: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [] };

// Faults surround real storage calls. A held result is a genuine read completed
// before signout/workspace navigation, rather than fabricated private data.
async function instrumentStorage(context) {
  await context.route(`${base}/assets/life/storage.js`, async route => {
    const response = await route.fetch(), source = await response.text();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async readWorkbench(...values){if(window.__blogFailWorkbench)throw new Error('익명 검사: 구성 읽기 실패');return actual.readWorkbench(...values);},async readPageDrafts(...values){const result=await actual.readPageDrafts(...values);if(window.__blogHoldDrafts){window.__blogHeldDrafts=true;await new Promise(resolve=>{window.__blogReleaseDrafts=()=>{window.__blogHoldDrafts=false;resolve();};});}window.__blogDraftReads=(window.__blogDraftReads||0)+1;return result;},async listPhotoPosts(...values){if(window.__blogFailPosts)throw new Error('익명 검사: 글 목록 읽기 실패');const result=await actual.listPhotoPosts(...values);if(window.__blogHoldPosts){window.__blogHeldPosts=true;await new Promise(resolve=>{window.__blogReleasePosts=()=>{window.__blogHoldPosts=false;resolve();};});}window.__blogPostReads=(window.__blogPostReads||0)+1;return result;}});}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
}
async function home(page) {
  if (!await page.locator('[data-haedo-navigation] a[data-haedo-section="home"]').isVisible()) {
    if (await page.locator('.photo-editor').isVisible()) await page.getByRole('button', { name: '닫기', exact: true }).click();
    else await page.locator('[data-subview-return]').click();
    await settle(page);
  }
  await nav(page, 'home');
  await page.locator('#homePosts[aria-busy="false"]').waitFor();
  await page.locator('#homeComposition[aria-busy="false"]').waitFor();
  if (await page.locator('#homeTab-posts').getAttribute('aria-selected') !== 'true') await page.locator('#homeTab-posts').click();
}
async function openHome(page) {
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.locator('#homePosts[aria-busy="false"]').waitFor();
  await page.locator('#homeComposition[aria-busy="false"]').waitFor();
}
async function snapshot(page, scene, selector = '.life-home') {
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.mouse.move(size.width - 1, 0);
    const metrics = await page.evaluate(inspectHome, selector);
    const file = `${scene}-${size.width}.png`;
    await page.screenshot({ path: path.join(out, file), fullPage: true });
    report.visual.push({ scene, file, ...metrics });
    assert(!metrics.horizontalOverflow && !metrics.overflow.length, `${scene}/${size.width}: horizontal overflow ${JSON.stringify(metrics.overflow)}`);
    assert.deepEqual(metrics.unnamed, [], `${scene}/${size.width}: unnamed controls`);
    assert.deepEqual(metrics.smallTargets, [], `${scene}/${size.width}: controls smaller than 44px`);
    assert.deepEqual(metrics.contrastFailures, [], `${scene}/${size.width}: text contrast`);
  }
}
async function documents(page) {
  return page.evaluate(async () => {
    const storage = HaedoLife.Shell.storage, workspaceId = await storage.getActive(), rows = await storage.listPhotoPosts(workspaceId);
    return { workspaceId, rows, docs: await Promise.all(rows.map(row => storage.readPhotoPost(workspaceId, row.id))) };
  });
}
async function preserved(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, id = await s.getActive();
    return { bundle: await s.read(id), workbench: await s.readWorkbench(id), collection: await s.readCollection(id), nine: await s.readNineBoard(id), drafts: await s.readPageDrafts(id) };
  });
}
async function writePost(page, title = '산책 끝에 남긴 생각') {
  if (!await page.locator('.photo-editor').isVisible()) await page.locator('[data-home-destination="write"]:visible, #homeFirstWrite').click();
  await page.locator('#photoTitle').waitFor();
  assert.equal(await page.locator('#lifeWritingBody').count(), 0, 'Home must use the established blog editor');
  await page.locator('#photoTitle').fill(title);
  await page.locator('.ql-editor').fill('걷다가 잠시 멈춰 본 풍경을 글로 남깁니다. 🌱\n다음에 다시 읽을 내 생각입니다.');
  await page.getByRole('button', { name: '글 저장', exact: true }).click();
  await page.locator('.photo-article').waitFor();
  const data = await documents(page), post = data.docs.find(doc => doc.title === title && doc.status === 'saved');
  assert(post, 'The explicit save must persist a saved local document');
  assert.equal(post.photos.length, 0);
  return { ...post, workspaceId: data.workspaceId };
}

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function check(name, run, seed = accounts.a) {
    if (process.env.BLOG_TEST_MATCH && !new RegExp(process.env.BLOG_TEST_MATCH).test(name)) return;
    const server = new ShareCloud(), device = 'blog-' + report.checks.length;
    const context = await makeContext(browser, server, device, seed, { viewport: sizes[0], hasTouch: true });
    await instrumentStorage(context);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
      report.external.push({ origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient');
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try {
      await run({ page, context, server, device });
      assert.equal(server.writes().length, 0, 'Browsing and local blog save must not write the remote DB');
      assert.equal(server.publicationWrites().length, 0, 'Saving a blog post must not publish it');
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      await page.screenshot({ path: path.join(out, `failure-${report.checks.length}.png`), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
  }
  try {
    await check('public collection entry retains the explicit private writing flow and exact reopening at three widths', async ({ page, server, device }) => {
      await page.goto(base + '/index.html'); await shellReady(page);
      assert.equal(await page.locator('#lifeWelcome').isVisible(), true);
      assert.match(await page.locator('#lifeWelcome').innerText(), /흩어진 내 글/);
      assert.equal(await page.locator('[data-life-login="import"]').innerText(), '글 가져오기');
      assert.equal(await page.locator('.haedo-welcome-sources > li').count(), 3);
      assert.deepEqual(await page.evaluate(() => __homeDbOpens), []);
      assert.equal(await page.evaluate(() => HaedoLife.Shell.storage), null);
      await snapshot(page, 'public', '#lifeWelcome');
      server.oauthAccounts.set(device, accounts.a);
      await page.locator('[data-life-login]').click(); await page.locator('#googleLogin').click();
      await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page);
      await page.locator('#lifeImportText').waitFor();
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'import');
      assert.equal(new URL(page.url()).searchParams.has('collect'), false);
      await openWritings(page);
      await page.locator('[data-home-destination="write"]:visible, #homeFirstWrite').click();
      await page.locator('#photoTitle').waitFor();
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'page');
      assert.equal(await page.locator('.ql-editor').evaluate(node => node === document.activeElement), true, 'An explicit new-writing action must focus the established editor body');
      assert.equal(await page.locator('.home-posts-error').count(), 0);
      assert((await page.evaluate(() => __homeDbOpens)).every(item => item.verified));
      await snapshot(page, 'first-writing', '.photo-editor');
      const before = await preserved(page), post = await writePost(page);
      assert.deepEqual(await preserved(page), before, 'Writing a local blog post must preserve other data formats');
      await home(page);
      const row = page.locator(`#homePosts .home-post[data-photo-post-id="${post.id}"]`);
      assert.equal(await row.count(), 1); assert.match(await row.innerText(), /산책 끝에 남긴 생각/);
      assert.match(await page.locator('.life-home').innerText(), /비공개|브라우저/);
      assert.equal(await page.locator('#homeFirstWrite').count(), 0);
      await snapshot(page, 'saved');
      for (const size of sizes) {
        await page.setViewportSize(size);
        const open = row.locator('.home-post-open');
        if (size.width === 1440) { await open.focus(); await page.keyboard.press('Enter'); }
        else await open.tap();
        await page.locator('.photo-article').waitFor();
        assert.match(await page.locator('.photo-article').innerText(), /다음에 다시 읽을 내 생각/);
        const saved = (await documents(page)).docs.find(doc => doc.id === post.id);
        assert.deepEqual(saved.ops, post.ops);
        await home(page);
      }
      await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
      await page.locator(`#homePosts .home-post[data-photo-post-id="${post.id}"] .home-post-open`).click();
      await page.locator('.photo-article').waitFor();
      assert.match(await page.locator('.photo-article').innerText(), /산책 끝에 남긴 생각/);
      await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).click();
      await page.goto(base + '/index.html?view=page'); await ready(page);
      await page.locator('#wbPageShare').click(); await page.locator('#wbSharePanel').waitFor();
      assert.match(await page.locator('#wbSharePanel').innerText(), /포함되지|미지원|공개.*지원/);
      assert(!(await page.locator('#wbSharePanel').innerText()).includes(post.title), 'Local blog body must not silently enter the old public-copy payload');
      assert.equal(await page.locator('#wbSharePublish').isEnabled().catch(() => false), false);
      assert.deepEqual(await preserved(page), before);
    }, null);
    await check('failed post and composition reads never claim an empty blog and can be retried', async ({ page }) => {
      await openHome(page); const post = await writePost(page, '조회 실패 뒤에도 남아 있는 글'); await home(page);
      for (const flag of ['__blogFailPosts', '__blogFailWorkbench']) {
        await nav(page, 'tools'); await page.evaluate(key => { window[key] = true; }, flag); await home(page);
        await page.locator('.home-posts-error').waitFor();
        assert.equal(await page.locator('#homeFirstWrite').count(), 0, 'Failed reads are not an empty first-use blog');
        assert.equal(await page.locator('.home-first-post').count(), 0);
        if (flag === '__blogFailPosts') await snapshot(page, 'posts-error');
        await page.evaluate(key => { window[key] = false; }, flag);
        await page.locator('.home-posts-error').getByRole('button').click();
        await page.locator(`#homePosts .home-post[data-photo-post-id="${post.id}"]`).waitFor();
        await page.locator('.home-posts-error').waitFor({ state: 'detached' });
        assert.equal(await page.locator('.home-posts-error').count(), 0);
      }
      assert.equal((await documents(page)).docs.find(doc => doc.id === post.id).title, post.title);
    });
    await check('new home writing preserves an existing draft and exits preview nine-grid and share states', async ({ page }) => {
      await openHome(page);
      await page.locator('[data-home-destination="write"]:visible, #homeFirstWrite').click(); await page.locator('#photoTitle').waitFor();
      await page.locator('#photoTitle').fill('계속 보관할 이전 블로그 초안');
      await page.locator('.ql-editor').fill('새 글을 시작해도 이 입력을 덮어쓰지 않습니다.');
      await home(page);
      const previous = (await documents(page)).docs.find(doc => doc.title === '계속 보관할 이전 블로그 초안');
      assert(previous && previous.status === 'draft');
      assert.equal(await page.locator('#homePosts .home-post').count(), 0, 'Unfinished drafts must not appear as saved posts');
      await page.locator('[data-home-destination="write"]:visible, #homeFirstWrite').click(); await page.locator('#photoTitle').waitFor();
      assert.equal(await page.locator('#photoTitle').inputValue(), '');
      assert.equal(await page.locator('.ql-editor').innerText(), '\n');
      assert.deepEqual((await documents(page)).docs.find(doc => doc.id === previous.id), previous);
      await page.getByRole('button', { name: '닫기', exact: true }).click();
      await home(page); await page.locator('#homeTab-drafts').click();
      await page.locator('.home-draft[data-draft-id="' + previous.id + '"] .home-draft-open').click(); await page.locator('#photoTitle').waitFor();
      assert.equal(await page.locator('#photoTitle').inputValue(), previous.title);
      await home(page);
      for (const mode of ['preview', 'nine', 'share']) {
        if (mode === 'preview') {
          const library = page.locator('.home-library');
          if (!await library.evaluate(node => node.open)) await library.locator(':scope > summary').click();
          await page.locator('[data-home-destination="preview"]').click();
        }
        else {
          await page.goto(base + '/index.html?view=page'); await ready(page);
          if (await page.locator('.photo-editor').isVisible()) await page.getByRole('button', { name: '닫기', exact: true }).click();
          if (await page.locator('.photo-article').isVisible()) await page.getByRole('button', { name: '사진 글 목록', exact: true }).click();
          await page.locator(mode === 'nine' ? '#wbPageNine' : '#wbPageShare').click();
        }
        await page.locator(mode === 'preview' ? '#wbVisitor' : mode === 'nine' ? '.nb-workspace' : '#wbSharePanel').waitFor();
        await home(page); await page.locator('[data-home-destination="write"]:visible, #homeFirstWrite').click(); await page.locator('#photoTitle').waitFor();
        assert.equal(await page.locator('#photoTitle').isVisible(), true, mode + ' must not trap the new-post action');
        assert.equal(await page.locator('#photoTitle').inputValue(), '');
        assert.deepEqual((await documents(page)).docs.find(doc => doc.id === previous.id), previous);
        await home(page);
      }
    });
    await check('a delayed editor mount cannot start a post after leaving the page', async ({ page }) => {
      await openHome(page); const before = await documents(page);
      await page.evaluate(() => { window.__blogHoldDrafts = true; window.__blogHeldDrafts = false; });
      await page.locator('[data-home-destination="write"]:visible, #homeFirstWrite').click(); await page.waitForFunction(() => __blogHeldDrafts);
      await nav(page, 'tools'); const finished = await page.evaluate(() => window.__blogDraftReads || 0);
      await page.evaluate(() => __blogReleaseDrafts()); await page.waitForFunction(n => __blogDraftReads > n, finished);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'tools');
      assert.equal(await page.locator('#photoTitle').count(), 0);
      assert.deepEqual(await documents(page), before, 'A late begin must not create a hidden draft');
    });
    await check('late saved-post response cannot replace the selected section', async ({ page }) => {
      await openHome(page); await writePost(page, '늦게 도착한 이전 홈의 글'); await nav(page, 'tools');
      await page.evaluate(() => { window.__blogHoldPosts = true; window.__blogHeldPosts = false; });
      await nav(page, 'home'); await page.waitForFunction(() => __blogHeldPosts);
      await nav(page, 'tools'); const finished = await page.evaluate(() => window.__blogPostReads || 0);
      await page.evaluate(() => __blogReleasePosts()); await page.waitForFunction(n => __blogPostReads > n, finished);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'tools');
      assert.equal(await page.locator('#homePosts').count(), 0);
    });
    await check('late account A post reads cannot reveal content after signout and account B login', async ({ page, server, device }) => {
      await openHome(page); const post = await writePost(page, '계정 A에서만 읽을 익명 글'); await nav(page, 'tools');
      await page.evaluate(() => { window.__blogHoldPosts = true; window.__blogHeldPosts = false; });
      await nav(page, 'home'); await page.waitForFunction(() => __blogHeldPosts);
      await page.evaluate(() => { window.__blogSignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); });
      await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage);
      await page.evaluate(() => __blogReleasePosts()); await page.waitForFunction(() => HaedoAuth.user === null);
      assert(!(await page.locator('body').innerText()).includes(post.title));
      server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-login]').click(); await page.locator('#googleLogin').click();
      await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page);
      await page.locator('#lifeImportText').waitFor();
      await openWritings(page);
      await page.locator('#homePosts[aria-busy="false"]').waitFor();
      assert.equal((await documents(page)).rows.length, 0);
      assert.equal(await page.locator('#homeFirstWrite').isVisible(), true);
      assert(!(await page.locator('body').innerText()).includes(post.title));
      const denied = await page.evaluate(async ({ workspaceId, id }) => { try { await HaedoLife.Shell.storage.readPhotoPost(workspaceId, id); return false; } catch (_) { return true; } }, post);
      assert.equal(denied, true);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
  } finally {
    await browser.close();
    await fs.writeFile(path.join(out, process.env.BLOG_TEST_MATCH ? 'recheck-report.json' : 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`Blog home: ${report.checks.filter(item => item.pass).length}/${report.checks.length} journeys; ${report.visual.length} visual states; console ${report.consoleErrors.length}; page ${report.pageErrors.length}; remote writes 0.`);
  if (report.checks.some(item => !item.pass) || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
