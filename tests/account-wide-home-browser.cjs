/* One account, one blog (2026-11-01 owner report: "Mac and iPhone still show
 * different posts"). Two independent browsers of the same account open
 * DIFFERENT libraries, yet their homes list the same posts. A post kept in a
 * library other than the open one opens, and returns, in its own library; the
 * sync view shows the app version, the account post count, waiting/failed
 * counts and the last sync time. Actual app/SDK/IndexedDB and isolated
 * PostgreSQL RPCs/RLS; Auth and Storage/Edge HTTP are synthetic. No real Google
 * login, production data or Apple hardware. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4252';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { LocalSQLBlogCloud } = require('./blog-completion-browser.cjs');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const output = path.resolve(__dirname, '../.local/account-wide-home');
const migrations = ['supabase/migrations/20261017144744_life_blog_originals.sql', 'supabase/migrations/20261101091500_life_blog_account_sync.sql', 'supabase/migrations/20261101160000_life_blog_delete_guard.sql', 'supabase/migrations/20261102120000_life_blog_public_photo_copies.sql'];

async function until(read, predicate, label, timeout = 45000) {
  const start = Date.now(); let value;
  do { value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  while (Date.now() - start < timeout);
  assert.fail(label + ': last observation ' + JSON.stringify(value)?.slice(0, 800));
}
// Every post of the account on this device, with the library that holds it.
async function libraryPosts(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, active = await s.getActive(), rows = [];
    for (const library of await s.listAccountLibraries()) if (library.eligible) for (const row of await s.listPhotoPosts(library.workspaceId)) rows.push({ id: row.id, title: row.title, status: row.status, workspaceId: library.workspaceId });
    return { active, rows: rows.sort((a, b) => a.id.localeCompare(b.id)) };
  });
}
const homeIds = page => page.locator('#homePosts [data-photo-post-id]').evaluateAll(nodes => nodes.map(node => node.dataset.photoPostId).sort());
async function home(page) { await nav(page, 'home'); await page.locator('#homePosts[aria-busy="false"]').waitFor(); }
const kick = page => page.evaluate(() => dispatchEvent(new Event('online')));
async function write(page, title, body) {
  await page.locator('[data-home-destination="write"]:visible, #homeFirstWrite').first().click();
  await page.locator('#photoTitle').fill(title); await page.locator('.ql-editor').fill(body + '\n');
  await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
  const status = page.locator('#photoServerStatus[data-state="synced"]'); await status.waitFor({ timeout: 45000 });
  return status.getAttribute('data-post-id');
}

async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(output, { recursive: true });
  const server = new LocalSQLBlogCloud({ container: process.env.BLOG_POSTGRES_CONTAINER, database: process.env.BLOG_POSTGRES_DATABASE });
  if (process.argv.includes('--prepare-database')) {
    server.docker(['exec', '-i', server.container, 'createdb', '-U', 'postgres', server.database]);
    const bootstrap = await fs.readFile(path.resolve(__dirname, '../supabase/tests/blog-bootstrap.sql'), 'utf8');
    const sources = await Promise.all(migrations.map(file => fs.readFile(path.resolve(__dirname, '..', file), 'utf8')));
    server.docker(['exec', '-i', server.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', server.database], [bootstrap, ...sources].join('\n'));
  }
  await server.initialize();
  const report = { pass: false, checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [],
    scope: 'Actual app, bundled SDK, two independent browser IndexedDBs and isolated PostgreSQL RPCs/RLS. Synthetic Auth and Storage/Edge HTTP only. No real account, Google, Apple or production write claim.' };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); report.node = process.version;
  const contexts = [];
  async function device(name) {
    const context = await makeContext(browser, server, name, accounts.a, { viewport: { width: 1440, height: 1000 } }); contexts.push(context);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([new URL(base).origin, cloud].includes(url.origin) || ['blob:', 'data:'].includes(url.protocol)) return route.fallback();
      report.external.push(url.origin); return route.abort();
    });
    context.on('page', page => {
      page.setDefaultTimeout(25000); page.on('pageerror', error => report.pageErrors.push({ name, error: error.message }));
      page.on('console', event => {
        if (event.type() !== 'error') return;
        const expected = event.location().url.startsWith(cloud + '/functions/v1/haedo-blog-media') && /404/.test(event.text());
        if (!expected) report.consoleErrors.push({ name, error: event.text() });
      });
    });
    const page = await context.newPage();
    await page.goto(base + '/index.html'); await ready(page); await page.locator('#homePosts[aria-busy="false"]').waitFor();
    return { name, context, page };
  }
  let active;
  async function capture(page, scene) {
    active = page;
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, scene + ' ' + width);
      const file = scene + '-' + width + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: true }); report.visual.push({ scene, width, file });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  async function check(name, fn) {
    console.log('START ' + name); await fn(); report.checks.push({ name, pass: true });
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log('PASS ' + name);
  }
  let a, b, onA, onB, second;
  try {
    a = await device('wide-home-a'); b = await device('wide-home-b'); active = a.page;
    await check('A writes in its library; B opens a different library of the same account and writes there', async () => {
      onA = await write(a.page, 'A 기기의 기본 공간에 쓴 글', 'A_BODY 첫 문단 🌿');
      active = b.page; await kick(b.page);
      // B receives it into the library open at that moment.
      const received = await until(() => libraryPosts(b.page), value => value.rows.some(row => row.id === onA), 'B receives A\'s post');
      assert.equal(received.rows.find(row => row.id === onA).workspaceId, received.active);
      // B keeps a second library of the account and opens it (as an adopted
      // earlier library would be). The page reloads into that library.
      second = await b.page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.createWorkspace('B의 두 번째 자료공간'); await s.setActive(w.workspaceId); return w.workspaceId; });
      await b.page.reload(); await ready(b.page); await b.page.locator('#homePosts[aria-busy="false"]').waitFor();
      assert.equal((await libraryPosts(b.page)).active, second);
      onB = await write(b.page, 'B 기기의 두 번째 공간에 쓴 글', 'B_BODY 다른 공간의 문단');
      const stored = await libraryPosts(b.page);
      assert.equal(stored.rows.find(row => row.id === onB).workspaceId, second);
      // The open library alone (the home before this change) lacks A's post.
      assert.deepEqual(await b.page.evaluate(async ws => (await HaedoLife.Shell.storage.listPhotoPosts(ws)).map(row => row.id), second), [onB]);
    });
    await check('Both homes list the same posts although the open libraries differ', async () => {
      active = a.page; await home(a.page); await kick(a.page);
      await until(() => homeIds(a.page), ids => ids.includes(onA) && ids.includes(onB), 'A home lists both posts');
      active = b.page; await home(b.page); await kick(b.page);
      await until(() => homeIds(b.page), ids => ids.includes(onA) && ids.includes(onB), 'B home lists both posts');
      const [atA, atB] = [await libraryPosts(a.page), await libraryPosts(b.page)];
      assert.notEqual(atA.active, atB.active, 'the two devices have different open libraries');
      assert.deepEqual(atA.rows.map(row => row.id), atB.rows.map(row => row.id));
      assert.deepEqual(await homeIds(a.page), await homeIds(b.page));
      // On B the post from A was received into a library that is not the open one.
      const fromA = atB.rows.find(row => row.id === onA);
      assert.notEqual(fromA.workspaceId, atB.active, 'the received post lives outside the open library on B');
      await b.page.locator('#homePosts [data-photo-post-id="' + onA + '"]').waitFor();
      await capture(b.page, 'b-home-two-libraries');
    });
    await check('A post from another library opens there and returns to the same home tab and search', async () => {
      active = b.page;
      await b.page.getByRole('button', { name: '내 글 검색 열기', exact: true }).click();
      await b.page.locator('#homePostSearch').fill('A 기기');
      await until(() => homeIds(b.page), ids => ids.length === 1 && ids[0] === onA, 'search matches the other library\'s post');
      const before = await libraryPosts(b.page), holder = before.rows.find(row => row.id === onA).workspaceId;
      await b.page.locator('#homePosts [data-photo-post-id="' + onA + '"]').getByRole('button', { name: 'A 기기의 기본 공간에 쓴 글', exact: true }).first().click();
      await b.page.locator('.photo-article').waitFor();
      assert.match(await b.page.locator('.photo-article').innerText(), /A_BODY 첫 문단/);
      assert.equal((await libraryPosts(b.page)).active, holder, 'the post opened in its own library');
      // Editing and saving happen in that library: the same post, no copy.
      await b.page.getByRole('button', { name: '글 수정', exact: true }).click();
      await b.page.locator('#photoTitle').fill('B에서 고친 A의 글');
      await b.page.getByRole('button', { name: '글 저장', exact: true }).click(); await b.page.locator('.photo-article').waitFor();
      const status = b.page.locator('#photoServerStatus[data-state="synced"]'); await status.waitFor({ timeout: 45000 });
      // A saved edit gets a new local identity in the same library; the server post stays one.
      const edited = await status.getAttribute('data-post-id');
      const after = await libraryPosts(b.page);
      assert.equal(after.rows.find(row => row.id === edited).workspaceId, holder, 'saved in the post\'s own library');
      assert.equal(after.rows.length, 2, 'no extra copy'); assert.equal(after.rows.filter(row => row.workspaceId === holder).length, before.rows.filter(row => row.workspaceId === holder).length);
      await b.page.getByRole('button', { name: '홈으로 돌아가기' }).first().click();
      await b.page.locator('#homePosts[aria-busy="false"]').waitFor();
      assert.equal(await b.page.locator('#homeTab-posts').getAttribute('aria-selected'), 'true');
      // The search survives the move between libraries; the renamed post no
      // longer matches it, and the home says so instead of hiding it silently.
      assert.equal(await b.page.locator('#homePostSearch').inputValue(), 'A 기기');
      await b.page.getByRole('button', { name: '검색어 지우고 저장한 글 보기', exact: true }).click();
      await until(() => homeIds(b.page), ids => ids.length === 2, 'both posts after clearing the search');
      assert.deepEqual(await homeIds(b.page), [edited, onB].sort(), 'the saved post is shown with every post of the account');
      assert.equal(await b.page.evaluate(() => document.activeElement?.closest('[data-photo-post-id]')?.dataset.photoPostId), edited, 'focus returns to the saved post');
      active = a.page; await kick(a.page);
      await a.page.locator('#homePosts [data-photo-post-id="' + onA + '"]').getByRole('button', { name: 'B에서 고친 A의 글', exact: true }).first().waitFor({ timeout: 45000 });
    });
    await check('The sync view shows version, account post count, waiting/failed and last sync; sync now works', async () => {
      for (const device of [a, b]) {
        active = device.page; await home(device.page);
        await device.page.locator('#homeAccountBlog').click();
        const facts = device.page.locator('#accountBlogFacts');
        await until(() => facts.innerText(), text => /글 2개/.test(text) && /대기 0 · 실패 0/.test(text) && /마지막 동기화 /.test(text), device.name + ' facts');
        const text = await facts.innerText();
        assert.match(text, /^(haedo-v\d+|앱 버전 확인 불가) · /);
        await device.page.getByRole('button', { name: '지금 동기화', exact: true }).click();
        await device.page.locator('#accountBlogStatus[data-state="synced"]').waitFor();
        assert.equal(await device.page.locator('#accountBlogList [data-action="open"]').count(), 2, 'every post opens from the sync list');
      }
      await capture(b.page, 'b-sync-facts');
      // The other library's post opens from the sync list as well.
      active = a.page; const atA = await libraryPosts(a.page);
      const remote = atA.rows.find(row => row.workspaceId !== atA.active);
      if (remote) {
        await a.page.locator('#accountBlogList [data-action="open"][data-local-post-id="' + remote.id + '"]').click();
        await a.page.locator('.photo-article').waitFor(); assert.equal((await libraryPosts(a.page)).active, remote.workspaceId);
      }
    });
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } catch (error) {
    report.error = error.stack;
    if (active) { await active.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
      report.failureDOM = await active.locator('body').innerText().catch(() => 'Page unavailable'); }
    throw error;
  } finally {
    await Promise.all(contexts.map(context => context.close())); await browser.close();
    report.resourcesClosed = true; report.sqlRpcCalls = server.blogRequests.length;
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log('Account-wide home: ' + report.checks.length + ' journeys; two devices with different open libraries list the same posts.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
