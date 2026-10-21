/* Account server-post discovery → another independent browser → editing and
 * explicit conflict choice → selective publication. Actual app/SDK/IndexedDB
 * and isolated PostgreSQL RPCs/RLS; Auth and Storage/Edge HTTP are synthetic.
 * No real Google login, production data, Apple hardware or remote drafts. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4252';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { LocalSQLBlogCloud, digest } = require('./blog-completion-browser.cjs');
const { playwright, makeContext, ready, nav, settle } = require('./unified-home-browser.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const output = path.resolve(__dirname, '../.local/account-blog-continuity');
const migration = 'supabase/migrations/20261017144744_life_blog_originals.sql';
const runtime = ['assets/life/account-blog-ui.js', 'assets/life/blog-sync.js', 'assets/life/storage.js',
  'assets/life/photo-post-ui.js', 'assets/life/ui.js', 'assets/life/home.js', 'assets/platform-auth.js', 'assets/life/home.css', 'sw.js'];

// Await the IDB read itself: an async waitForFunction predicate is a truthy
// Promise on the pinned Playwright version, even while its result is false.
async function until(read, predicate, label, timeout = 25000) {
  const start = Date.now(); let value;
  do { value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 25)); }
  while (Date.now() - start < timeout);
  assert.fail(label + ': last observation ' + JSON.stringify(value));
}
async function state(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, ws = await s.getActive(), rows = await s.listPhotoPosts(ws), docs = [];
    for (const row of rows) {
      const doc = await s.readPhotoPost(ws, row.id), photos = [];
      for (const { blob, ...meta } of doc.photos) {
        const image = await createImageBitmap(blob);
        photos.push({ ...meta, actualHash: await HaedoLife.PhotoPost.digest(blob), actualSize: blob.size,
          actualWidth: image.width, actualHeight: image.height }); image.close();
      }
      docs.push({ ...doc, photos, sync: await s.readBlogSyncState(ws, row.id) });
    }
    return { ws, docs };
  });
}
const content = ({ sync, ...doc }) => doc;
function assertCopy(actual, source, newIds = true) {
  assert.deepEqual(actual.photos.map(p => [p.digest, p.actualHash, p.size, p.actualSize, p.width, p.height, p.actualWidth, p.actualHeight, p.name, p.type]),
    source.photos.map(p => [p.digest, p.actualHash, p.size, p.actualSize, p.width, p.height, p.actualWidth, p.actualHeight, p.name, p.type]));
  const remap = new Map(source.photos.map((photo, i) => [photo.id, actual.photos[i].id]));
  if (newIds) { assert.notEqual(actual.id, source.id); assert(actual.photos.every(p => !source.photos.some(old => old.id === p.id))); }
  assert.equal(actual.title, source.title);
  assert.deepEqual(actual.attachments, source.attachments);
  assert.deepEqual(actual.ops, source.ops.map(op => typeof op.insert === 'string' ? op :
    { ...op, insert: { photo: { ...op.insert.photo, id: remap.get(op.insert.photo.id) } } }));
}
async function preserved(page) {
  return page.evaluate(async () => { const s = HaedoLife.Shell.storage, ws = await s.getActive();
    return { bundle: await s.read(ws), workbench: await s.readWorkbench(ws), nine: await s.readNineBoard(ws), collection: await s.readCollection(ws) }; });
}
async function finish(page, expected = 'synced') {
  await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
  const status = page.locator('#photoServerStatus[data-state="' + expected + '"]'); await status.waitFor();
  const id = await status.getAttribute('data-post-id'), current = await state(page), doc = current.docs.find(doc => doc.id === id);
  assert(doc); assert.equal(doc.status, 'saved'); assert.equal(doc.sync.status, expected); return doc;
}
async function catalog(page) {
  await nav(page, 'home'); await page.getByRole('button', { name: '서버에 보관한 글', exact: true }).click();
  await page.locator('#accountBlogStatus[data-state="ready"]').waitFor();
  assert.equal(await page.locator('#lifeAccountBlog').count(), 1);
  await page.waitForFunction(() => document.querySelector('.account-blog')?.getAttribute('aria-busy') === 'false');
}
const serverRow = (page, id) => page.locator('#accountBlogList .ab-post[data-remote-id="' + id + '"]');
const managerRow = (page, id) => page.locator('.blog-post[data-post-id="' + id + '"]');
async function managerReady(page) {
  await page.locator('.blog-manager-list[data-state="ready"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('.blog-manager[aria-busy="true"]'));
}
async function managerClick(page, node) {
  await node.click(); await page.waitForFunction(() => !document.querySelector('.blog-manager[aria-busy="true"]'));
}
async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(output, { recursive: true });
  const server = new LocalSQLBlogCloud({ container: process.env.BLOG_POSTGRES_CONTAINER, database: process.env.BLOG_POSTGRES_DATABASE });
  const migrationBytes = await fs.readFile(path.resolve(__dirname, '..', migration));
  if (process.argv.includes('--prepare-database')) {
    // Explicit independent DB only; existing databases are never replaced.
    server.docker(['exec', '-i', server.container, 'createdb', '-U', 'postgres', server.database]);
    const bootstrap = await fs.readFile(path.resolve(__dirname, '../supabase/tests/blog-bootstrap.sql'), 'utf8');
    server.docker(['exec', '-i', server.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', server.database], bootstrap + '\n' + migrationBytes.toString());
  }
  await server.initialize();
  const report = { pass: false, checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], servedHashes: [],
    migrationSha256: digest(migrationBytes), scope: 'Actual app, bundled SDK, independent browser IndexedDB and network:none PostgreSQL RPCs/RLS. Synthetic Auth and Storage/Edge HTTP only. No real account, Google, Apple or production write claim.' };
  report.sourceHashes = Object.fromEntries(await Promise.all(runtime.map(async file => [file, digest(await fs.readFile(path.resolve(__dirname, '..', file)))])));
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); report.node = process.version;
  const contexts = [], devices = [], responseTasks = [];
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
    const page = await context.newPage(), value = { name, context, page }; devices.push(value);
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
  const writes = () => ({ saves: server.blogRequests.filter(r => r.rpc === 'life_blog_save').length,
    uploads: server.assetRequests.filter(r => r.method === 'POST').length,
    public: server.blogRequests.filter(r => /life_blog_(?:publish|unpublish)$/.test(r.rpc)).length });
  let a, b, first, received, changedB, draftA, conflictA, returnedA, draftB, originalA, originalB, remoteId, originalBytes;
  try {
    a = await device('account-device-a'); b = await device('account-device-b'); active = a.page;
    originalA = await preserved(a.page); originalB = await preserved(b.page);
    // Preserve an existing whole-library view while focused server management
    // must show its exact destination independently of that old search/filter.
    await nav(a.page, 'manage'); await a.page.getByRole('button', { name: '글 관리', exact: true }).click(); await managerReady(a.page);
    await a.page.locator('#blogManagerSearch').fill('일치하지 않는 기존 목록 검색');
    await a.page.locator('#blogManagerFilter').selectOption('archived');
    await nav(a.page, 'home');
    await check('Explicit save stores two exact originals privately while independent local drafts stay on their device', async () => {
      active = b.page;
      await b.page.locator('[data-home-destination="write"]:visible, #homeFirstWrite').click();
      await b.page.locator('#photoTitle').fill('B 기기에만 남긴 미완성 글'); await b.page.locator('.ql-editor').fill('PRIVATE_B_UNFINISHED_BODY 🌱\n');
      await b.page.locator('.photo-status[data-state="draft"]').waitFor();
      const currentB = await until(() => state(b.page), value => value.docs.some(d => d.title === 'B 기기에만 남긴 미완성 글'), 'B local autosave');
      draftB = currentB.docs.find(d => d.title === 'B 기기에만 남긴 미완성 글'); assert.equal(draftB.status, 'draft');
      await b.page.getByRole('button', { name: '닫기', exact: true }).click(); assert.deepEqual(writes(), { saves: 0, uploads: 0, public: 0 });
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
      assert.deepEqual(writes(), { saves: 0, uploads: 0, public: 0 }); first = await finish(a.page); remoteId = first.sync.remoteId;
      assert.equal(writes().saves, 1); assert.equal(writes().uploads, 2); assert.equal(writes().public, 0);
      assert.deepEqual(first.photos.map(p => p.actualHash), originalBytes.map(digest));
      const stored = server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: remoteId });
      assert.equal(stored.revision, 1); assert.equal(stored.publication, null); assert.deepEqual(stored.data.ops, first.ops);
      assert.deepEqual(stored.data.photos.map(p => p.digest), originalBytes.map(digest));
      assert.deepEqual(content((await state(b.page)).docs.find(d => d.id === draftB.id)), content(draftB));
    });
    await check('Home discovers the server post without bodies; explicit receive remaps IDs and reopening reuses one local copy', async () => {
      active = b.page; const before = writes(), gets = server.assetRequests.length;
      await catalog(b.page); const row = serverRow(b.page, remoteId);
      assert.equal(await row.getAttribute('data-state'), 'server_only'); assert.equal(server.assetRequests.length, gets);
      assert.deepEqual(writes(), before); assert.equal((await state(b.page)).docs.length, 1);
      await b.page.locator('#accountBlogSearch').fill('두 기기');
      await capture(b.page, 'server-only-catalog');
      await row.locator('button[data-action="receive"]').click(); await b.page.locator('.photo-article').waitFor();
      received = (await state(b.page)).docs.find(d => d.status === 'saved' && d.sync?.remoteId === remoteId); assert(received); assertCopy(received, first);
      assert.equal(received.sync.remoteRevision, 1); assert.equal((await state(b.page)).ws, originalB.bundle.workspaceId);
      assert.deepEqual(content((await state(b.page)).docs.find(d => d.id === draftB.id)), content(draftB)); assert.deepEqual(writes(), before);
      await b.page.getByRole('button', { name: '서버 글 목록으로 돌아가기', exact: true }).click();
      await b.page.locator('#accountBlogStatus[data-state="ready"]').waitFor();
      assert.equal(await b.page.locator('#accountBlogSearch').inputValue(), '두 기기');
      await b.page.waitForFunction(id => document.activeElement?.dataset.action === 'open' && document.activeElement?.dataset.localPostId === id, received.id);
      await serverRow(b.page, remoteId).locator('button[data-action="open"]').click(); await b.page.locator('.photo-article').waitFor();
      const after = await state(b.page); assert.equal(after.docs.filter(d => d.sync?.remoteId === remoteId).length, 1);
      assert.deepEqual(content(after.docs.find(d => d.id === received.id)), content(received)); assert.deepEqual(writes(), before);
      await capture(b.page, 'received-originals');
      await b.page.getByRole('button', { name: '서버 글 목록으로 돌아가기', exact: true }).click();
      await b.page.locator('#accountBlogStatus[data-state="ready"]').waitFor();
      assert.equal(await b.page.locator('#accountBlogSearch').inputValue(), '두 기기');
      await b.page.waitForFunction(id => document.activeElement?.dataset.action === 'open' && document.activeElement?.dataset.localPostId === id, received.id);
      await serverRow(b.page, remoteId).locator('button[data-action="open"]').click(); await b.page.locator('.photo-article').waitFor();
      assert.deepEqual(writes(), before);
    });
    await check('The second device saves an edit under the same server identity without changing the first device unfinished draft', async () => {
      active = a.page; await a.page.getByRole('button', { name: '글 수정', exact: true }).click();
      await a.page.locator('#photoTitle').fill('A 기기의 미완성 수정');
      await a.page.evaluate(() => Quill.find(document.querySelector('.ql-container')).insertText(0, 'PRIVATE_A_UNFINISHED_BODY\n', 'user'));
      await a.page.locator('.photo-status[data-state="draft"]').waitFor();
      const beforeA = await until(() => state(a.page), v => v.docs.some(d => d.status === 'draft' && d.title === 'A 기기의 미완성 수정'), 'A retained edit autosave');
      draftA = beforeA.docs.find(d => d.status === 'draft' && d.title === 'A 기기의 미완성 수정'); assert.equal(draftA.replaces.id, first.id);
      await a.page.getByRole('button', { name: '닫기', exact: true }).click();
      active = b.page;
      await b.page.getByRole('button', { name: '글 수정', exact: true }).click();
      await b.page.locator('#photoTitle').fill('B에서 완성한 여행 글');
      await b.page.evaluate(() => Quill.find(document.querySelector('.ql-container')).insertText(0, 'B에서 새로 다듬은 문단\n', 'user'));
      changedB = await finish(b.page); assert.notEqual(changedB.id, received.id); assert.equal(changedB.sync.remoteId, remoteId);
      assert.equal(changedB.sync.remoteRevision, 2); assert.deepEqual(changedB.photos.map(p => p.actualHash), originalBytes.map(digest));
      active = a.page;
      const before = writes(); await catalog(a.page); const row = serverRow(a.page, remoteId);
      assert.equal(await row.getAttribute('data-state'), 'remote_updated');
      assert.deepEqual(content((await state(a.page)).docs.find(d => d.id === draftA.id)), content(draftA));
      assert.deepEqual(writes(), before); await capture(a.page, 'remote-update-retained-draft');
      await row.locator('button[data-action="open"][data-local-post-id="' + first.id + '"]').click(); await a.page.locator('.photo-article').waitFor();
      assert.equal(await a.page.locator('.photo-article h2').innerText(), first.title);
      await a.page.getByRole('button', { name: '글 수정', exact: true }).click();
      assert.equal(await a.page.locator('#photoTitle').inputValue(), draftA.title);
      assert((await a.page.locator('.ql-editor').innerText()).includes('PRIVATE_A_UNFINISHED_BODY'));
      conflictA = await finish(a.page, 'conflict'); assert.equal(conflictA.id, draftA.id);
      assert.equal(server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: remoteId }).data.title, changedB.title);
    });
    await check('An explicit conflict choice retains A exact competing copy and receives B exact originals into the current workspace', async () => {
      active = a.page; await a.page.getByRole('button', { name: '글 관리에서 서버 내용 확인', exact: true }).click(); await managerReady(a.page);
      assert.equal(await a.page.locator('#blogManagerSearch').isHidden(), true);
      assert.equal(await a.page.locator('#blogManagerFilter').isHidden(), true);
      assert.equal(await a.page.locator('.blog-post').count(), 1);
      await managerRow(a.page, conflictA.id).waitFor();
      const panel = managerRow(a.page, conflictA.id).locator('.blog-manager-server');
      if (!await panel.evaluate(n => n.open)) await panel.locator(':scope > summary').click();
      await a.page.getByRole('button', { name: '기존 글을 남기고 서버 글로 이어쓰기', exact: true }).waitFor();
      await capture(a.page, 'explicit-conflict-choice');
      const before = writes(); await panel.getByRole('button', { name: '기존 글을 남기고 서버 글로 이어쓰기', exact: true }).click();
      await a.page.locator('.photo-article').waitFor(); const current = await state(a.page);
      returnedA = current.docs.find(d => d.status === 'saved' && d.title === changedB.title && d.sync?.remoteId === remoteId && d.sync.enabled);
      assert(returnedA); assertCopy(returnedA, changedB); assert.equal(current.ws, beforeAWorkspace());
      const competing = current.docs.find(d => d.id === conflictA.id); assert.deepEqual(content(competing), content(conflictA)); assert.equal(competing.sync.enabled, false);
      assert.deepEqual(writes(), before); assert.deepEqual(content((await state(b.page)).docs.find(d => d.id === draftB.id)), content(draftB));
      await catalog(a.page); const row = serverRow(a.page, remoteId);
      const open = row.locator('button[data-action="open"][data-local-post-id="' + returnedA.id + '"]'); await open.click(); await a.page.locator('.photo-article').waitFor();
      assert.deepEqual(content((await state(a.page)).docs.find(d => d.id === returnedA.id)), content(returnedA)); assert.deepEqual(writes(), before);
    });
    await check('Only the chosen photo is public; anonymous original bytes and withdrawal are verified after owner completion', async () => {
      active = a.page; await nav(a.page, 'manage'); await a.page.getByRole('button', { name: '글 관리', exact: true }).click(); await managerReady(a.page);
      assert.equal(await a.page.locator('#blogManagerSearch').inputValue(), '일치하지 않는 기존 목록 검색');
      assert.equal(await a.page.locator('#blogManagerFilter').inputValue(), 'archived');
      await a.page.locator('#blogManagerSearch').fill(''); await a.page.locator('#blogManagerFilter').selectOption('all');
      report.managerView = { focusedDestinationVisible: true, priorWholeLibrarySearchAndFilterPreserved: true };
      await managerRow(a.page, returnedA.id).getByRole('button', { name: '공개 내용 검토', exact: true }).click();
      const preview = a.page.locator('.blog-manager-preview'); await preview.waitFor();
      assert.equal(await preview.locator('input[data-photo-id]:checked').count(), 0);
      assert.equal(await a.page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).isChecked(), false);
      await a.page.getByRole('textbox', { name: '공개 이름', exact: true }).fill('합성 여행 블로그');
      await a.page.getByRole('textbox', { name: '공개 소개', exact: true }).fill('직접 선택한 사진 한 장만 공개합니다.');
      await preview.locator('input[data-photo-id="' + returnedA.photos[0].id + '"]').check();
      await managerClick(a.page, a.page.getByRole('button', { name: '공개 미리보기 갱신', exact: true }));
      await a.page.getByRole('checkbox', { name: '글 전체와 모든 사진 원본의 비공개 서버 보관 동의', exact: true }).check();
      await a.page.getByRole('checkbox', { name: '선택한 사진 원본과 포함된 메타데이터 공개 동의', exact: true }).check();
      await a.page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check();
      await managerClick(a.page, a.page.getByRole('button', { name: '공개 게시·갱신', exact: true }));
      const link = a.page.getByRole('link', { name: '공개한 글 열기', exact: true }); await link.waitFor(); const url = await link.getAttribute('href'), token = new URL(url).searchParams.get('post');
      const exposed = server.rpc(null, 'life_blog_public_read', { p_token: token });
      assert.equal(exposed.snapshot.photos.length, 1); assert.equal(exposed.snapshot.photos[0].digest, originalBytes.map(digest)[0]);
      for (const hidden of [draftA.title, draftB.title, 'PRIVATE_A_UNFINISHED_BODY', 'PRIVATE_B_UNFINISHED_BODY', returnedA.photos[1].digest]) assert(!JSON.stringify(exposed).includes(hidden));
      const visitor = await device('account-visitor', null); active = visitor.page; await visitor.page.goto(url);
      // A successful reader leaves this live region empty and visually hidden.
      // Observe its state rather than waiting for invisible status copy.
      await visitor.page.waitForFunction(() => document.querySelector('#blogStatus')?.dataset.state === 'published');
      const image = visitor.page.locator('#blogContent img'); assert.equal(await image.count(), 1); await image.evaluate(n => n.decode());
      assert.deepEqual(await image.evaluate(n => [n.naturalWidth, n.naturalHeight]), [4032, 3024]);
      assert.equal(await image.getAttribute('alt'), '합성 풍경 대체 텍스트 0'); const src = await image.getAttribute('src');
      assert.equal(await visitor.page.evaluate(async url => { const bytes = await (await fetch(url, { credentials: 'omit', cache: 'no-store' })).arrayBuffer(); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join(''); }, src), digest(originalBytes[0]));
      assert.deepEqual(await visitor.page.evaluate(() => __homeDbOpens), []); await capture(visitor.page, 'selected-public-original');
      await managerClick(a.page, a.page.getByRole('button', { name: '공개 철회', exact: true }));
      await preview.getByText('공개 철회를 확인했습니다. 이 브라우저의 원래 글은 유지했습니다.', { exact: true }).waitFor();
      assert.equal(server.rpc(null, 'life_blog_public_read', { p_token: token }), null);
      await visitor.page.locator('#blogRefresh').click(); await visitor.page.waitForFunction(() => document.querySelector('#blogStatus')?.dataset.state === 'missing');
      assert.equal(await visitor.page.locator('#blogContent').innerText(), '');
      assert.equal(await visitor.page.evaluate(async url => (await fetch(url, { credentials: 'omit', cache: 'no-store' })).status, src), 404);
      assert.deepEqual(content((await state(a.page)).docs.find(d => d.id === returnedA.id)), content(returnedA));
      assert.deepEqual(content((await state(b.page)).docs.find(d => d.id === draftB.id)), content(draftB));
      assert.deepEqual(await preserved(a.page), originalA); assert.deepEqual(await preserved(b.page), originalB);
      report.originals = originalBytes.map((bytes, i) => ({ sha256: digest(bytes), width: first.photos[i].width, height: first.photos[i].height, bytes: bytes.length }));
      report.privateRevisions = server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: remoteId }).revision;
    });
    await Promise.all(responseTasks);
    for (const row of report.servedHashes) assert.equal(row.sha256, report.sourceHashes[row.file], 'Mixed served runtime: ' + row.file);
    for (const [file, hash] of Object.entries(report.sourceHashes)) assert.equal(digest(await fs.readFile(path.resolve(__dirname, '..', file))), hash, 'Runtime changed while validating: ' + file);
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } catch (error) {
    report.error = error.stack;
    if (active) { await active.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
      report.failureDOM = await active.locator('body').innerText().catch(() => 'Page unavailable');
      report.failureFocus = await active.evaluate(() => ({ active: { tag: document.activeElement?.tagName, id: document.activeElement?.id,
        action: document.activeElement?.dataset.action, focusKey: document.activeElement?.dataset.focusKey },
        openButtons: [...document.querySelectorAll('#accountBlogList button')].map(n => ({ action: n.dataset.action, focusKey: n.dataset.focusKey, localPostId: n.dataset.localPostId })) })).catch(() => null); }
    throw error;
  } finally {
    await Promise.all(contexts.map(context => context.close())); await browser.close();
    report.resourcesClosed = true; report.rpcCounts = writes(); report.sqlRpcCalls = server.blogRequests.length;
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  function beforeAWorkspace() { return originalA.bundle.workspaceId; }
  console.log('Account blog continuity: ' + report.checks.length + ' journeys; exact originals and isolated SQL; all browser resources closed.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { state, assertCopy, catalog, output };
