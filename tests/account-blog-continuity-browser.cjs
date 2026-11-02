/* One account on two independent browsers (2026-11-01 owner directive): a post
 * saved with original photos on device A appears in device B's home feed with
 * no button, a draft follows too, B's edit reaches A in place, and an explicit
 * deletion on A leaves B. Selective publication stays explicit. Actual
 * app/SDK/IndexedDB and isolated PostgreSQL RPCs/RLS; Auth and Storage/Edge
 * HTTP are synthetic. No real Google login, production data or Apple hardware. */
'use strict';
const { openBlogMenu } = require('./helpers/feature-menus.cjs');
process.env.BASE_URL ||= 'http://127.0.0.1:4252';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { LocalSQLBlogCloud, digest } = require('./blog-completion-browser.cjs');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const output = path.resolve(__dirname, '../.local/account-blog-continuity');
const migrations = ['supabase/migrations/20261017144744_life_blog_originals.sql', 'supabase/migrations/20261101091500_life_blog_account_sync.sql', 'supabase/migrations/20261101160000_life_blog_delete_guard.sql', 'supabase/migrations/20261102110000_life_blog_ai_authorship.sql', 'supabase/migrations/20261102120000_life_blog_public_photo_copies.sql'];
const runtime = ['assets/life/account-blog-ui.js', 'assets/life/blog-sync.js', 'assets/life/blog-remote.js', 'assets/life/storage.js',
  'assets/life/photo-post-ui.js', 'assets/life/blog-manager.js', 'assets/life/ui.js', 'assets/life/home.js', 'assets/platform-auth.js', 'assets/life/home.css', 'sw.js'];

// Await the IDB read itself: an async waitForFunction predicate is a truthy
// Promise on the pinned Playwright version, even while its result is false.
async function until(read, predicate, label, timeout = 40000) {
  const start = Date.now(); let value;
  do { value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  while (Date.now() - start < timeout);
  assert.fail(label + ': last observation ' + JSON.stringify(value)?.slice(0, 800));
}
async function state(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, ws = await s.getActive(), rows = await s.listPhotoPosts(ws), docs = [];
    for (const row of rows) {
      // listPhotoPosts and readPhotoPost are separate reads. A post that the page's own BlogSync
      // removes between them (the deletion journey polls exactly for that) is absent, not an
      // error; any other read fault still fails the observation.
      let doc;
      try { doc = await s.readPhotoPost(ws, row.id); }
      catch (error) { if (error?.code === 'photo_post_missing') continue; throw error; }
      const photos = [];
      for (const { blob, ...meta } of doc.photos) {
        const image = await createImageBitmap(blob);
        photos.push({ ...meta, actualHash: await HaedoLife.PhotoPost.digest(blob), actualSize: blob.size, actualWidth: image.width, actualHeight: image.height }); image.close();
      }
      docs.push({ ...doc, photos, sync: await s.readBlogSyncState(ws, row.id) });
    }
    return { ws, docs };
  });
}
const content = ({ sync, revision, ...doc }) => doc;
// Same post on another device: identical identities, body, captions and bytes.
function assertSame(actual, source) {
  assert.equal(actual.id, source.id); assert.equal(actual.title, source.title); assert.equal(actual.status, source.status);
  assert.deepEqual(actual.ops, source.ops); assert.deepEqual(actual.attachments, source.attachments);
  assert.deepEqual(actual.photos.map(p => [p.id, p.digest, p.actualHash, p.size, p.actualSize, p.width, p.height, p.actualWidth, p.actualHeight, p.name, p.type]),
    source.photos.map(p => [p.id, p.digest, p.actualHash, p.size, p.actualSize, p.width, p.height, p.actualWidth, p.actualHeight, p.name, p.type]));
}
async function preserved(page) {
  return page.evaluate(async () => { const s = HaedoLife.Shell.storage, ws = await s.getActive();
    return { bundle: await s.read(ws), workbench: await s.readWorkbench(ws), nine: await s.readNineBoard(ws), collection: await s.readCollection(ws) }; });
}
async function finish(page, expected = 'synced') {
  await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
  const status = page.locator('#photoServerStatus[data-state="' + expected + '"]'); await status.waitFor();
  const id = await status.getAttribute('data-post-id'), current = await state(page), doc = current.docs.find(doc => doc.id === id);
  assert(doc); assert.equal(doc.status, 'saved'); return doc;
}
const homeCard = (page, id) => page.locator('#homePosts [data-photo-post-id="' + id + '"]');
async function home(page) { await nav(page, 'home'); await page.locator('#homePosts[aria-busy="false"]').waitFor(); }
// An 'online' event starts an immediate account sync cycle; the automatic
// 30-second cycle does the same without it.
const kick = page => page.evaluate(() => dispatchEvent(new Event('online')));
async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(output, { recursive: true });
  const server = new LocalSQLBlogCloud({ container: process.env.BLOG_POSTGRES_CONTAINER, database: process.env.BLOG_POSTGRES_DATABASE });
  const migrationBytes = Buffer.concat(await Promise.all(migrations.map(file => fs.readFile(path.resolve(__dirname, '..', file)))));
  if (process.argv.includes('--prepare-database')) {
    // Explicit independent DB only; existing databases are never replaced.
    server.docker(['exec', '-i', server.container, 'createdb', '-U', 'postgres', server.database]);
    const bootstrap = await fs.readFile(path.resolve(__dirname, '../supabase/tests/blog-bootstrap.sql'), 'utf8');
    const sources = await Promise.all(migrations.map(file => fs.readFile(path.resolve(__dirname, '..', file), 'utf8')));
    server.docker(['exec', '-i', server.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', server.database], [bootstrap, ...sources].join('\n'));
  }
  await server.initialize();
  const report = { pass: false, checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], servedHashes: [],
    migrationSha256: digest(migrationBytes), scope: 'Actual app, bundled SDK, two independent browser IndexedDBs and isolated PostgreSQL RPCs/RLS. Synthetic Auth and Storage/Edge HTTP only. No real account, Google, Apple or production write claim.' };
  report.sourceHashes = Object.fromEntries(await Promise.all(runtime.map(async file => [file, digest(await fs.readFile(path.resolve(__dirname, '..', file)))])));
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); report.node = process.version;
  const contexts = [], responseTasks = [];
  async function device(name, seed = accounts.a) {
    const context = await makeContext(browser, server, name, seed, { viewport: { width: 1440, height: 1000 } }); contexts.push(context);
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
      page.on('response', response => {
        const url = new URL(response.url()), file = url.pathname.slice(1);
        if (url.origin === new URL(base).origin && runtime.includes(file)) responseTasks.push(response.body().then(bytes => { report.servedHashes.push({ name, file, sha256: digest(bytes) }); }));
      });
    });
    const page = await context.newPage(), value = { name, context, page };
    if (seed) { await page.goto(base + '/index.html'); await ready(page); await page.locator('#homePosts[aria-busy="false"]').waitFor(); }
    return value;
  }
  let active;
  async function capture(page, scene) {
    active = page;
    for (const width of [1440, 820, 390]) {
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
  const publicCalls = () => server.blogRequests.filter(r => /life_blog_(?:publish|unpublish)$/.test(r.rpc)).length;
  const readRemote = id => server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: id });
  let a, b, first, draftB, editedB, originalA, originalB, originalBytes;
  try {
    a = await device('account-device-a'); b = await device('account-device-b'); active = a.page;
    originalA = await preserved(a.page); originalB = await preserved(b.page);
    await check('A post saved with two original photos on A appears in B\'s home feed automatically, with exact bytes and identities', async () => {
      active = a.page;
      await a.page.locator('[data-home-destination="write"]:visible, #homeFirstWrite').click();
      await a.page.locator('#photoTitle').fill('두 기기에서 이어 쓸 합성 여행 글');
      await a.page.locator('.ql-editor').fill('기억한 풍경을 내 말로 남깁니다. 🌱\n두 원본과 사진 설명을 그대로 보관합니다.\n');
      const images = await a.page.evaluate(() => [[4032, 3024], [1200, 1800]].map(([width, height], i) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const paint = canvas.getContext('2d'); paint.fillStyle = i ? '#e6d9cc' : '#c9ded4'; paint.fillRect(0, 0, width, height);
        paint.fillStyle = '#284d40'; paint.fillRect(90, 90, 210, 170);
        return { width, height, bytes: canvas.toDataURL('image/png').split(',')[1] };
      }));
      originalBytes = images.map(p => Buffer.from(p.bytes, 'base64'));
      await a.page.locator('#photoFiles').setInputFiles(originalBytes.map((buffer, i) => ({ name: 'anonymous-trip-' + i + '.png', mimeType: 'image/png', buffer })));
      await a.page.locator('.photo-block').nth(1).waitFor();
      for (let i = 0; i < 2; i++) {
        await a.page.locator('.photo-block').nth(i).click(); await a.page.getByRole('textbox', { name: '사진 설명', exact: true }).fill('그대로 남길 사진 설명 ' + i);
        if (!await a.page.locator('.photo-settings').evaluate(n => n.open)) await a.page.locator('.photo-settings > summary').click();
        await a.page.getByRole('textbox', { name: '사진 대체 텍스트', exact: true }).fill('합성 풍경 대체 텍스트 ' + i);
      }
      first = await finish(a.page);
      assert.deepEqual(first.photos.map(p => p.actualHash), originalBytes.map(digest));
      const stored = readRemote(first.sync.remoteId);
      assert.equal(stored.data.status, 'saved'); assert.equal(stored.publication, null); assert.deepEqual(stored.data.ops, first.ops);
      assert.deepEqual(stored.data.photos.map(p => p.digest), originalBytes.map(digest)); assert.equal(publicCalls(), 0);
      active = b.page; await home(b.page);
      // No button on B: the background account sync installs the post in place.
      await homeCard(b.page, first.id).waitFor({ timeout: 45000 });
      const received = (await state(b.page)).docs.find(d => d.id === first.id); assert(received); assertSame(received, first);
      assert.equal((await state(b.page)).ws, originalB.bundle.workspaceId);
      for (const label of ['이 기기에 받기', '서버에 보관한 글에서 확인']) assert.equal(await b.page.getByText(label).count(), 0, label);
      await homeCard(b.page, first.id).locator('img.home-post-cover').waitFor();
      await capture(b.page, 'b-home-received');
      assert.equal(publicCalls(), 0);
    });
    await check('A draft written on B follows to A after its quiet period without being saved or published', async () => {
      active = b.page;
      await b.page.locator('[data-home-destination="write"]:visible, #homeFirstWrite').click();
      await b.page.locator('#photoTitle').fill('B에서 쓰다 만 글'); await b.page.locator('.ql-editor').fill('B_UNFINISHED_BODY 🌱\n');
      await b.page.locator('.photo-status[data-state="draft"]').waitFor();
      draftB = await until(() => state(b.page), v => v.docs.some(d => d.title === 'B에서 쓰다 만 글'), 'B local autosave').then(v => v.docs.find(d => d.title === 'B에서 쓰다 만 글'));
      await b.page.getByRole('button', { name: '닫기', exact: true }).click();
      await until(() => readRemote(draftB.id), row => row?.data.status === 'draft', 'B draft reaches the account');
      active = a.page; await kick(a.page);
      const atA = await until(() => state(a.page), v => v.docs.some(d => d.id === draftB.id), 'draft reaches A', 60000).then(v => v.docs.find(d => d.id === draftB.id));
      const latestB = (await state(b.page)).docs.find(d => d.id === draftB.id);
      assert.equal(atA.status, 'draft'); assert.equal(atA.title, 'B에서 쓰다 만 글'); assert.deepEqual(atA.ops, latestB.ops);
      assert(atA.ops.some(op => typeof op.insert === 'string' && op.insert.includes('B_UNFINISHED_BODY'))); assert.equal(publicCalls(), 0);
    });
    await check('B edits the received post; A shows the edit in place under the same identity and photos', async () => {
      active = b.page; await home(b.page);
      await homeCard(b.page, first.id).getByRole('button', { name: first.title, exact: true }).first().click(); await b.page.locator('.photo-article').waitFor();
      await b.page.getByRole('button', { name: '글 수정', exact: true }).click();
      await b.page.locator('#photoTitle').fill('B에서 완성한 여행 글');
      await b.page.evaluate(() => Quill.find(document.querySelector('.ql-container')).insertText(0, 'B에서 새로 다듬은 문단\n', 'user'));
      editedB = await finish(b.page); assert.notEqual(editedB.id, first.id); assert.equal(editedB.sync.remoteId, first.id);
      assert.deepEqual(editedB.photos.map(p => p.actualHash), originalBytes.map(digest));
      await until(() => readRemote(first.id), row => row.data.title === 'B에서 완성한 여행 글', 'B edit stored');
      active = a.page; await home(a.page); await kick(a.page);
      const card = homeCard(a.page, first.id);
      await card.getByRole('button', { name: 'B에서 완성한 여행 글', exact: true }).first().waitFor({ timeout: 45000 });
      const atA = (await state(a.page)).docs.find(d => d.id === first.id);
      assert.equal(atA.title, editedB.title); assert.deepEqual(atA.ops, editedB.ops);
      assert.deepEqual(atA.photos.map(p => [p.id, p.actualHash]), first.photos.map(p => [p.id, p.actualHash]));
      assert.equal((await state(a.page)).docs.filter(d => d.status === 'saved').length, 1, 'no duplicate copy on A');
      await capture(a.page, 'a-home-edit-arrived');
    });
    let token;
    await check('Only the chosen photo becomes public, only by explicit choice; anonymous bytes and withdrawal are verified', async () => {
      active = a.page; await openBlogMenu(a.page); await a.page.getByRole('button', { name: '글 공개·보관', exact: true }).click();
      await a.page.locator('.blog-manager-list[data-state="ready"]').waitFor();
      const row = a.page.locator('.blog-post[data-post-id="' + first.id + '"]');
      await row.locator('[data-sync-post]').filter({ hasText: '모든 기기에 저장됨' }).waitFor();
      await row.getByRole('button', { name: '공개 내용 검토', exact: true }).click();
      const preview = a.page.locator('.blog-manager-preview'); await preview.waitFor();
      assert.equal(await preview.locator('input[data-photo-id]:checked').count(), 0, 'no photo is public by default');
      await a.page.getByRole('textbox', { name: '공개 이름', exact: true }).fill('합성 여행 블로그');
      await preview.locator('input[data-photo-id="' + first.photos[0].id + '"]').check();
      await a.page.getByRole('button', { name: '공개 미리보기 갱신', exact: true }).click(); await a.page.waitForFunction(() => !document.querySelector('.blog-manager[aria-busy="true"]'));
      await a.page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check();
      await a.page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click();
      const link = a.page.getByRole('link', { name: '공개한 글 열기', exact: true }); await link.waitFor(); const url = await link.getAttribute('href'); token = new URL(url).searchParams.get('post');
      const exposed = server.rpc(null, 'life_blog_public_read', { p_token: token });
      // 2026-11-02: the public photo is a metadata-free copy, never the original.
      assert.equal(exposed.snapshot.photos.length, 1); assert.notEqual(exposed.snapshot.photos[0].digest, originalBytes.map(digest)[0]);
      for (const hidden of [draftB.title, 'B_UNFINISHED_BODY', first.photos[1].digest, first.id]) assert(!JSON.stringify(exposed).includes(hidden));
      const visitor = await device('account-visitor', null); active = visitor.page; await visitor.page.goto(url);
      await visitor.page.waitForFunction(() => document.querySelector('#blogStatus')?.dataset.state === 'published');
      const image = visitor.page.locator('#blogContent img'); assert.equal(await image.count(), 1); await image.evaluate(n => n.decode());
      assert.deepEqual(await image.evaluate(n => [n.naturalWidth, n.naturalHeight]), [4032, 3024]);
      const src = await image.getAttribute('src');
      assert.equal(await visitor.page.evaluate(async url => { const bytes = await (await fetch(url, { credentials: 'omit', cache: 'no-store' })).arrayBuffer(); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join(''); }, src), exposed.snapshot.photos[0].digest);
      assert.deepEqual(await visitor.page.evaluate(() => __homeDbOpens), []);
      await a.page.getByRole('button', { name: '공개 철회', exact: true }).click();
      await a.page.locator('.blog-manager-preview').getByText('공개 철회를 확인했습니다. 이 브라우저의 원래 글은 유지했습니다.', { exact: true }).waitFor();
      assert.equal(server.rpc(null, 'life_blog_public_read', { p_token: token }), null);
      assert.equal(await visitor.page.evaluate(async url => (await fetch(url, { credentials: 'omit', cache: 'no-store' })).status, src), 404);
    });
    await check('Deleting the post on A removes it from the server, its originals and B\'s home feed; other posts and data remain', async () => {
      active = a.page; const paths = Object.values(readRemote(first.id).assets).map(asset => asset.path);
      await a.page.getByRole('button', { name: '공개 검토 닫기', exact: true }).click();
      a.page.once('dialog', dialog => { assert.match(dialog.message(), /모든 기기에서 함께 삭제/); dialog.accept(); });
      await a.page.locator('.blog-post[data-post-id="' + first.id + '"]').getByRole('button', { name: '삭제', exact: true }).click();
      await a.page.waitForFunction(id => !document.querySelector('.blog-post[data-post-id="' + id + '"]'), first.id);
      await until(() => readRemote(first.id), row => row === null, 'server deletion');
      await until(() => server.sql('select count(*) from storage.objects where name=any(array(select jsonb_array_elements_text(' + "'" + JSON.stringify(paths) + "'" + '::jsonb)));'), count => count === 0, 'deleted originals removed through Storage RLS');
      active = b.page; await home(b.page); await kick(b.page);
      await until(() => state(b.page), v => !v.docs.some(d => d.id === first.id || d.sync?.remoteId === first.id), 'B removes the deleted post', 45000);
      await b.page.waitForFunction(id => !document.querySelector('#homePosts [data-photo-post-id="' + id + '"]'), first.id);
      assert((await state(b.page)).docs.some(d => d.id === draftB.id), 'the unrelated draft stays');
      assert.deepEqual(await preserved(a.page), originalA); assert.deepEqual(await preserved(b.page), originalB);
      await capture(b.page, 'b-home-after-delete');
    });
    await Promise.all(responseTasks);
    for (const row of report.servedHashes) assert.equal(row.sha256, report.sourceHashes[row.file], 'Mixed served runtime: ' + row.file);
    for (const [file, hash] of Object.entries(report.sourceHashes)) assert.equal(digest(await fs.readFile(path.resolve(__dirname, '..', file))), hash, 'Runtime changed while validating: ' + file);
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
  console.log('Account blog continuity: ' + report.checks.length + ' journeys; automatic two-device sync over isolated SQL; all browser resources closed.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { state, assertSame, output };
