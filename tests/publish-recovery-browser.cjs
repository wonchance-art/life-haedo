/* Publication recovery (2026-11-11 review B1, M2, M3, M4, m5, m7, m8).
 * Actual UI -> shared SDK/IndexedDB -> isolated PostgreSQL publication RPCs -> anonymous reader.
 * Auth and Storage HTTP are the repository's synthetic fixtures; no hosted account, operation,
 * deployment or Apple device. A server-published post is never shown as 비공개 on the device
 * that sent the request, and that device can withdraw and update it.
 * BASE_URL=http://127.0.0.1:4173 BLOG_POSTGRES_CONTAINER=haedo-blog-postgres-...
 * BLOG_POSTGRES_DATABASE=haedo_blog_qa_... node tests/publish-recovery-browser.cjs --prepare-database
 * --prepare-database creates a fresh isolated DB; it refuses an existing name. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const { openBlogMenu } = require('./helpers/feature-menus.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { MarkdownPublishCloud, syntheticSession } = require('./helpers/post-markdown-publish-cloud.cjs');
const output = path.resolve(__dirname, '../.local/publish-recovery');
const report = { checks: [], screenshots: [], consoleErrors: [], pageErrors: [], external: [], expectedTransportErrors: [],
  scope: 'Actual app/SDK/IndexedDB and isolated PostgreSQL publication RPCs with the real media handler. Synthetic Auth and Storage HTTP; viewport sizes are emulated, not Apple devices; no hosted project.' };
const rpcPath = name => '**/rest/v1/rpc/' + name;

async function main() {
  assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
  const server = new MarkdownPublishCloud({ container: process.env.BLOG_POSTGRES_CONTAINER, database: process.env.BLOG_POSTGRES_DATABASE });
  if (process.argv.includes('--prepare-database')) {
    server.docker(['exec', '-i', server.container, 'createdb', '-U', 'postgres', server.database]);
    const apply = sql => server.docker(['exec', '-i', server.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', server.database], sql);
    for (const file of ['supabase/tests/blog-bootstrap.sql',
      'supabase/migrations/20261017144744_life_blog_originals.sql', 'supabase/migrations/20261101091500_life_blog_account_sync.sql',
      'supabase/migrations/20261101160000_life_blog_delete_guard.sql', 'supabase/migrations/20261102110000_life_blog_ai_authorship.sql',
      'supabase/migrations/20261102120000_life_blog_public_photo_copies.sql', 'supabase/migrations/20261105051632_life_post_markdown.sql'])
      apply(await fs.readFile(path.resolve(__dirname, '..', file), 'utf8'));
    apply("create table auth.users(id uuid primary key,is_anonymous boolean not null default false); create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz); " +
      "create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$; grant execute on function auth.jwt() to authenticated,service_role;");
    apply(await fs.readFile(path.resolve(__dirname, '../supabase/migrations/20261105081055_life_post_markdown_publish.sql'), 'utf8'));
  }
  await server.initialize(); await fs.mkdir(output, { recursive: true });
  report.sources = [];
  for (const file of ['assets/life/blog-remote.js', 'assets/life/blog-sync.js', 'assets/life/blog-manager.js', 'assets/life/photo-post-ui.js', 'assets/life/home.js', 'assets/life/storage.js']) {
    const response = await fetch(base + '/' + file); assert(response.ok);
    const sha = value => createHash('sha256').update(value).digest('hex');
    const actual = Buffer.from(await response.arrayBuffer()), expected = await fs.readFile(path.resolve(__dirname, '..', file));
    assert.equal(sha(actual), sha(expected), 'Serve this exact checkout: ' + file); report.sources.push({ file, sha256: sha(expected) });
  }
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); const contexts = [], dialogs = [];
  // Requests this suite fails on purpose; every other console error fails the run.
  const deliberate = /\/rest\/v1\/rpc\/life_blog_(?:publish|publish_copies|unpublish|read|public_list|sync_list)$|\/functions\/v1\/haedo-blog-media/;
  async function device(name, account = accounts.a, { width = 1440, height = 1000 } = {}) {
    const context = await makeContext(browser, server, name, account, { viewport: { width, height } }); contexts.push(context);
    await context.route('**/*', route => {
      const origin = new URL(route.request().url()).origin;
      if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
      report.external.push(origin); return route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(25000);
    page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    page.on('console', event => {
      if (event.type() !== 'error') return;
      const entry = { name, message: event.text(), url: event.location().url };
      if (entry.url.startsWith(cloud) && deliberate.test(new URL(entry.url).pathname) && /Failed to load resource:.*(?:ERR_FAILED|404)/.test(entry.message)) report.expectedTransportErrors.push(entry);
      else report.consoleErrors.push(entry);
    });
    page.on('dialog', dialog => { dialogs.push({ name, type: dialog.type(), message: dialog.message() }); dialog.accept().catch(() => {}); });
    if (account) {
      await page.goto(base + '/index.html'); await ready(page);
      await page.evaluate(async value => { const result = await HaedoAuth.client.auth.setSession(value); if (result.error) throw result.error; await HaedoAuth.verify(); }, syntheticSession(account));
    }
    return { context, page, name };
  }
  const idle = page => page.waitForFunction(() => !document.querySelector('.blog-manager[aria-busy="true"]'));
  const click = async (page, name, scope = page) => { await scope.getByRole('button', { name, exact: true }).click(); await settle(page); await idle(page); };
  const data = page => page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, workspaceId = await s.getActive(), rows = await s.listPhotoPosts(workspaceId);
    return { workspaceId, docs: (await Promise.all(rows.map(row => s.readPhotoPost(workspaceId, row.id)))).map(d => ({ ...d, photos: d.photos.map(({ blob, view, ...meta }) => meta) })) };
  });
  const manager = async page => { await openBlogMenu(page); await page.getByRole('button', { name: '글 공개·보관', exact: true }).click(); await page.locator('.blog-manager-list[data-state="ready"]').waitFor(); };
  const row = (page, id) => page.locator('.blog-post[data-post-id="' + id + '"]');
  const panel = page => page.locator('.blog-manager-preview');
  // The publication mark of one list row ('' when the post is not public).
  const mark = (page, id) => row(page, id).locator('[data-public-label]').evaluate(node => node.textContent.replace(/^\s*·\s*/, '').trim());
  const statusLine = page => page.locator('.blog-manager [role="status"]').innerText();
  const state = (page, id) => page.evaluate(async id => { const s = HaedoLife.Shell.storage; return s.readBlogSyncState(await s.getActive(), id); }, id);
  const publicStatus = (page, id) => page.evaluate(async id => { const s = HaedoLife.Shell.storage; return HaedoLife.BlogSync.publicationStatus(await s.readBlogSyncState(await s.getActive(), id)); }, id);
  const until = async (read, ok, label, timeout = 30000) => {
    const end = Date.now() + timeout; let value;
    do { value = await read(); if (ok(value)) return value; await new Promise(done => setTimeout(done, 150)); } while (Date.now() < end);
    assert.fail(label + ': last observation ' + JSON.stringify(value)?.slice(0, 600));
  };
  // A forced cycle of the page's own BlogSync (the same call 지금 동기화 makes).
  const kick = page => page.evaluate(() => dispatchEvent(new Event('online')));
  const publications = remoteId => server.sql("select coalesce(jsonb_agg(jsonb_build_object('token',token,'active',active,'revision',revision,'photos',jsonb_array_length(coalesce(snapshot->'photos','[]')),'author',snapshot->'author')),'[]') from haedo_blog_private.publications where post_id='" + remoteId + "'");
  const publication = remoteId => publications(remoteId)[0] || null;
  const profile = () => server.sql("select coalesce((select to_jsonb(author) from haedo_blog_private.profiles limit 1),'null'::jsonb)");
  const savedPost = async (page, title, images = []) => {
    await nav(page, 'home'); await page.locator('[data-haedo-compose]:visible').click(); await page.locator('#photoTitle').fill(title);
    await page.locator('.ql-editor').fill('익명 검수 본문입니다.\n직접 고른 글만 공개합니다.');
    if (images.length) {
      await page.evaluate(() => { const q = Quill.find(document.querySelector('.ql-container')); q.setSelection(q.getLength() - 1, 0, 'silent'); });
      await page.locator('#photoFiles').setInputFiles(images); await page.locator('.photo-block').nth(images.length - 1).waitFor();
    }
    await page.getByRole('button', { name: '글 저장', exact: true }).click(); await settle(page); await page.locator('.photo-article').waitFor();
    const doc = (await data(page)).docs.find(value => value.title === title && value.status === 'saved'); assert(doc, 'saved post ' + title);
    await page.locator('#photoServerStatus[data-post-id="' + doc.id + '"][data-state="synced"]').waitFor();
    return { doc, remoteId: (await state(page, doc.id)).remoteId };
  };
  const openReview = async (page, id) => { await row(page, id).getByRole('button', { name: '공개 내용 검토', exact: true }).click(); await panel(page).waitFor(); await idle(page); };
  const preview = async (page, { selected = null, name, intro } = {}) => {
    if (name !== undefined) await page.getByRole('textbox', { name: '공개 이름', exact: true }).fill(name);
    if (intro !== undefined) await page.getByRole('textbox', { name: '공개 소개', exact: true }).fill(intro);
    if (selected) for (const box of await page.locator('input[data-photo-id]').all()) await box.setChecked(selected.includes(await box.getAttribute('data-photo-id')));
    await click(page, '공개 미리보기 갱신');
    await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check();
  };
  const publish = page => click(page, '공개 게시·갱신');
  const publishedLink = page => panel(page).getByRole('link', { name: '공개한 글 열기', exact: true });
  const current = page => panel(page).locator('.blog-manager-current').evaluate(node => ({ state: node.dataset.publication, text: node.innerText }));
  const openPost = async (page, id, title) => { await manager(page); await row(page, id).getByRole('button', { name: title, exact: true }).click(); await page.locator('.photo-article').waitFor(); };
  const pill = page => page.locator('.photo-privacy').first().evaluate(node => ({ state: node.dataset.state, label: node.getAttribute('aria-label'), text: node.innerText.replace(/\s+/g, ' ').trim() }));
  const settledPill = page => until(() => pill(page), value => value.state !== 'checking', 'pill read');
  const openInfo = async page => { await page.locator('.photo-privacy').first().click(); const sheet = page.locator('dialog.photo-info[open]'); await sheet.waitFor(); return sheet; };
  const closeInfo = async page => { await page.locator('dialog.photo-info [aria-label="글 정보 닫기"]').click(); await page.locator('dialog.photo-info').waitFor({ state: 'detached' }); };
  const homeMeta = async (page, id) => { await nav(page, 'home'); await page.locator('#homePosts[aria-busy="false"]').waitFor(); return page.locator('#homePosts [data-photo-post-id="' + id + '"] .home-post-meta').innerText(); };
  const visit = async (page, url, expected) => { await page.goto(url); await page.waitForFunction(value => document.querySelector('#blogStatus')?.dataset.state === value, expected); };
  const shot = async (page, name) => { const file = path.join(output, name + '.png'); await page.screenshot({ path: file }); report.screenshots.push(path.basename(file)); };
  const pass = name => { report.checks.push({ name, pass: true }); console.log('PASS ' + name); };
  // Publication requests of one kind that the page sent, by what this suite did with them.
  const sentPublish = remoteId => server.blogRequests.filter(request => ['life_blog_publish', 'life_blog_publish_copies'].includes(request.rpc) && request.body.p_post_id === remoteId);
  const sentUnpublish = remoteId => server.blogRequests.filter(request => request.rpc === 'life_blog_unpublish' && request.body.p_post_id === remoteId);
  // Fails every exact post read of this device: the publication cannot be settled meanwhile.
  function blockReads(context) {
    const handler = route => route.abort('failed'); let on = false;
    return { async start() { if (!on) { on = true; await context.route(rpcPath('life_blog_read'), handler); } }, async stop() { if (on) { on = false; await context.unroute(rpcPath('life_blog_read'), handler); } } };
  }
  // The server applies the publication, then the answer is lost and (optionally) the device
  // cannot read the post head: it has no way to know the result.
  async function loseAnswer(context, rpc, { then = null } = {}) {
    const lost = { count: 0, bodies: [] };
    const handler = async route => {
      const body = route.request().postDataJSON(); lost.count++; lost.bodies.push(body);
      lost.result = server.rpc(accounts.a.id, rpc, body);
      if (then) await then();
      await context.unroute(rpcPath(rpc), handler);
      return route.abort('failed');
    };
    await context.route(rpcPath(rpc), handler); return lost;
  }
  // The request never reaches the server.
  async function neverArrives(context, rpc, { then = null } = {}) {
    const blocked = { count: 0, bodies: [] };
    const handler = async route => { blocked.count++; blocked.bodies.push(route.request().postDataJSON()); if (then) await then(); return route.abort('failed'); };
    await context.route(rpcPath(rpc), handler);
    return { ...blocked, get count() { return blocked.count; }, bodies: blocked.bodies, stop: () => context.unroute(rpcPath(rpc), handler) };
  }

  try {
    const owner = await device('recovery-owner'), visitor = await device('recovery-visitor', null), page = owner.page;
    const reads = blockReads(owner.context);
    const jpegs = await page.evaluate(async () => {
      const out = [];
      for (const color of ['#c02020', '#20a040']) {
        const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 30;
        const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 40, 30);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92)); let text = '';
        new Uint8Array(await blob.arrayBuffer()).forEach(value => { text += String.fromCharCode(value); }); out.push(btoa(text));
      }
      return out;
    });
    const files = jpegs.map((value, index) => ({ name: 'sample-' + index + '.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(value, 'base64') }));

    // ---- B1: the server published, the answer was lost -------------------------------------
    const a = await savedPost(page, '응답 유실 글', files);
    await manager(page); await openReview(page, a.doc.id);
    assert.equal((await current(page)).state, 'private');
    await preview(page, { selected: [a.doc.photos[0].id], name: '익명 검수', intro: '검수 소개' });
    const lostA = await loseAnswer(owner.context, 'life_blog_publish_copies', { then: () => reads.start() });
    await publish(page);
    assert.equal(lostA.count, 1); assert.equal(lostA.result.status, 'stored');
    assert.equal(publication(a.remoteId).active, true, 'the server holds the public copy');
    const lostText = await statusLine(page);
    assert.match(lostText, /공개 게시 결과를 받지 못했습니다/); assert.doesNotMatch(lostText, /자동으로 다시 시도|글은 이 기기에 남아/);
    assert.equal(await publishedLink(page).count(), 0, 'no success link without an answer');
    assert.equal((await current(page)).state, 'unknown'); assert.match((await current(page)).text, /확인하지 못함/);
    assert.equal(await publicStatus(page, a.doc.id), 'unknown');
    await click(page, '공개 검토 닫기');
    assert.equal(await mark(page, a.doc.id), '공개 확인 못 함');
    // The post's own screen: neither 공개 nor 비공개.
    await openPost(page, a.doc.id, a.doc.title);
    const unknownPill = await settledPill(page);
    assert.equal(unknownPill.state, 'unsettled'); assert.match(unknownPill.label, /^공개 여부 확인 못 함/); assert.doesNotMatch(unknownPill.text, /비공개/); assert.match(unknownPill.text, /공개 확인 못 함/);
    let sheet = await openInfo(page);
    assert.match(await sheet.innerText(), /확인하지 못함/); assert.doesNotMatch(await sheet.innerText(), /비공개|공개 중\s/);
    await shot(page, 'b1-unknown-info-1440');
    // The check fails while the server cannot be reached: still not private, and it says so.
    await sheet.getByRole('button', { name: '공개 상태 확인', exact: true }).click();
    await sheet.locator('.photo-public-error[role="alert"]').waitFor();
    assert.match(await sheet.locator('.photo-public-error').innerText(), /공개 상태를 확인하지 못했습니다/);
    assert.equal(await page.evaluate(() => document.querySelector('dialog.photo-info').contains(document.activeElement)), true, 'focus stays in the sheet');
    assert.equal((await pill(page)).state, 'unsettled');
    await closeInfo(page);
    // A forced cycle cannot settle it either; the list says the same.
    await kick(page); await new Promise(done => setTimeout(done, 1500));
    assert.equal(await publicStatus(page, a.doc.id), 'unknown', 'a failed settlement keeps the state unknown');
    assert.match(await homeMeta(page, a.doc.id), /공개 확인 못 함 · 원본은 비공개/);
    for (const width of [820, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await openPost(page, a.doc.id, a.doc.title); await settledPill(page); assert.equal((await pill(page)).state, 'unsettled');
      const box = await page.locator('.photo-privacy').first().boundingBox(); assert(box.x >= 0 && box.x + box.width <= width + 0.5, 'the pill fits ' + width);
      sheet = await openInfo(page); await shot(page, 'b1-unknown-info-' + width); await closeInfo(page);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // The server is reachable again: one check settles it as public.
    await reads.stop();
    await openPost(page, a.doc.id, a.doc.title); await settledPill(page);
    sheet = await openInfo(page); await sheet.getByRole('button', { name: '공개 상태 확인', exact: true }).click();
    await sheet.locator('dd[data-publication="public"]').waitFor();
    assert.match(await sheet.locator('dd[data-publication="public"]').innerText(), /공개 중/);
    assert.equal(await sheet.getByRole('button', { name: '공개 설정', exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => document.querySelector('dialog.photo-info').contains(document.activeElement)), true, 'focus stays in the sheet after the check');
    await closeInfo(page);
    assert.deepEqual({ state: (await pill(page)).state, text: (await pill(page)).text }, { state: 'public', text: '공개' });
    assert.equal(sentPublish(a.remoteId).length, 0, 'settling sent no publication request (the lost one was applied by the server itself)');
    const settledA = await state(page, a.doc.id);
    assert.equal(settledA.publishPending, null); assert.equal(settledA.publication.active, true); assert.equal(settledA.publication.revision, 1);
    assert.match(await homeMeta(page, a.doc.id), /공개 중 · 원본은 비공개/);
    pass('B1: a lost publication answer is shown as 공개 확인 못 함 (never 비공개), stays so while unreachable, and one check settles it as 공개');

    // The account overview and the post agree.
    await manager(page); await page.getByRole('button', { name: '계정 보관 상태', exact: true }).click();
    await page.locator('#accountBlogList[data-state="ready"]').waitFor();
    assert.match(await page.locator('#accountBlogList .ab-post').filter({ hasText: a.doc.title }).innerText(), /공개 중/);
    // Withdraw on this device, in the review.
    await manager(page);
    assert.equal(await mark(page, a.doc.id), '공개 중');
    await openReview(page, a.doc.id);
    assert.equal((await current(page)).state, 'public');
    const urlA = await panel(page).getByRole('link', { name: '공개 중인 글 열기', exact: true }).getAttribute('href');
    await visit(visitor.page, urlA, 'published');
    assert.equal(await visitor.page.locator('#blogContent img').count(), 1);
    await click(page, '공개 철회', panel(page));
    assert.equal(await statusLine(page), '공개 철회를 확인했습니다.');
    assert.equal(publication(a.remoteId).active, false); assert.equal(sentUnpublish(a.remoteId).length, 1);
    assert.equal((await current(page)).state, 'private');
    await visitor.page.locator('#blogRefresh').click(); await visitor.page.waitForFunction(() => document.querySelector('#blogStatus')?.dataset.state === 'missing');
    assert.equal(server.rpc(null, 'life_blog_public_read', { p_token: new URL(urlA).searchParams.get('post') }), null, 'the withdrawn address answers nothing');
    pass('B1: the device that lost the answer withdraws the publication; the address stops answering');

    // m7: again in the same panel.
    await click(page, '공개 철회', panel(page));
    assert.doesNotMatch(await statusLine(page), /글이 변경됐습니다|찾을 수 없습니다/);
    assert.equal(sentUnpublish(a.remoteId).length, 1, 'a second withdrawal of a withdrawn post sends nothing');
    await publish(page);
    assert.equal(await statusLine(page), '공개 미리보기를 먼저 갱신해 주세요.', 'the next publication is reviewed again');
    assert.equal(sentPublish(a.remoteId).length, 0);
    // A changed selection publishes (other photo, other name).
    await preview(page, { selected: [a.doc.photos[1].id], name: '익명 검수 둘' });
    await publish(page); await publishedLink(page).waitFor();
    assert.doesNotMatch(await statusLine(page), /글이 변경됐습니다/);
    const republished = publication(a.remoteId);
    assert.equal(republished.active, true); assert.equal(republished.photos, 1); assert.equal(republished.author.name, '익명 검수 둘');
    assert.equal((await current(page)).state, 'public'); assert.equal(sentPublish(a.remoteId).length, 1);
    // m7 as reviewed: the panel that just published withdraws, withdraws again and publishes again.
    await click(page, '공개 철회', panel(page));
    assert.equal(await statusLine(page), '공개 철회를 확인했습니다.'); assert.equal(publication(a.remoteId).active, false);
    const withdrawn = sentUnpublish(a.remoteId).length;
    await click(page, '공개 철회', panel(page));
    assert.doesNotMatch(await statusLine(page), /글이 변경됐습니다|달라졌습니다|찾을 수 없습니다/); assert.equal(sentUnpublish(a.remoteId).length, withdrawn);
    await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check();
    await publish(page);
    assert.equal(await statusLine(page), '공개 미리보기를 먼저 갱신해 주세요.', 'after a withdrawal the next publication is reviewed again, not refused as changed');
    assert.equal(sentPublish(a.remoteId).length, 1);
    await preview(page); await publish(page); await publishedLink(page).waitFor();
    assert.doesNotMatch(await statusLine(page), /글이 변경됐습니다|달라졌습니다/);
    assert.equal(publication(a.remoteId).active, true); assert.equal(sentPublish(a.remoteId).length, 2);
    await click(page, '공개 철회', panel(page)); assert.equal(publication(a.remoteId).active, false);
    await click(page, '공개 검토 닫기');
    pass('m7 + B1: withdrawing twice and publishing again or with a changed selection in the same panel work without 글이 변경됐습니다');

    // ---- B1: without any check in between ----------------------------------------------------
    const b = await savedPost(page, '유실 직후 철회 글', files);
    await manager(page); await openReview(page, b.doc.id); await preview(page, { selected: [b.doc.photos[0].id] });
    await loseAnswer(owner.context, 'life_blog_publish_copies'); await publish(page);
    assert.equal(publication(b.remoteId).active, true);
    await click(page, '공개 철회', panel(page));
    assert.equal(await statusLine(page), '공개 철회를 확인했습니다.'); assert.equal(publication(b.remoteId).active, false);
    await click(page, '공개 검토 닫기');
    const c = await savedPost(page, '유실 직후 선택 변경 글', files);
    await manager(page); await openReview(page, c.doc.id); await preview(page, { selected: c.doc.photos.map(photo => photo.id) });
    await loseAnswer(owner.context, 'life_blog_publish_copies'); await publish(page);
    const firstC = publication(c.remoteId); assert.equal(firstC.photos, 2);
    await preview(page, { selected: [] });
    assert.equal((await current(page)).state, 'public', 'refreshing the preview settles the lost answer first');
    await publish(page); await publishedLink(page).waitFor();
    const secondC = publication(c.remoteId);
    assert.deepEqual({ token: secondC.token, revision: secondC.revision, photos: secondC.photos, active: secondC.active }, { token: firstC.token, revision: 2, photos: 0, active: true });
    await click(page, '공개 검토 닫기');
    pass('B1: right after the lost answer the same device withdraws, or publishes a different selection as an update of the same address');

    // ---- B1: the tab is reloaded while the request is in flight ------------------------------
    const r = await savedPost(page, '게시 중 새로고침 글', files);
    await manager(page); await openReview(page, r.doc.id); await preview(page, { selected: [r.doc.photos[0].id] });
    let arrived; const reached = new Promise(resolve => { arrived = resolve; });
    const hang = route => { server.rpc(accounts.a.id, 'life_blog_publish_copies', route.request().postDataJSON()); arrived(); /* the answer never arrives */ };
    await owner.context.route(rpcPath('life_blog_publish_copies'), hang);
    await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click(); await reached;
    await owner.context.unroute(rpcPath('life_blog_publish_copies'), hang);
    assert.equal(publication(r.remoteId).active, true);
    await page.reload(); await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.storage && document.querySelector('[data-haedo-navigation]')); await settle(page);
    const seen = new Set();
    await until(async () => { const value = await publicStatus(page, r.doc.id); seen.add(value); return value; }, value => value === 'public', 'the first cycle settles the reloaded tab');
    assert.equal(seen.has('private'), false, 'never private on the way: ' + [...seen]);
    await openPost(page, r.doc.id, r.doc.title); assert.equal((await settledPill(page)).state, 'public');
    await manager(page); await openReview(page, r.doc.id); await click(page, '공개 철회', panel(page));
    assert.equal(publication(r.remoteId).active, false); await click(page, '공개 검토 닫기');
    pass('B1: a tab reloaded during publication settles itself as 공개 on its first cycle and can withdraw');

    // ---- M4: the request never reached the server, then the choice changed -------------------
    const m = await savedPost(page, '전송 실패 글', files);
    await manager(page); await openReview(page, m.doc.id); await preview(page, { selected: m.doc.photos.map(photo => photo.id), name: '익명 검수' });
    const unsent = await neverArrives(owner.context, 'life_blog_publish_copies');
    await publish(page); await unsent.stop();
    assert.equal(unsent.count, 1); assert.equal(publication(m.remoteId), null);
    assert.match(await statusLine(page), /공개 게시 결과를 받지 못했습니다/);
    assert.equal(await publicStatus(page, m.doc.id), 'unknown');
    await preview(page, { selected: [] });
    const settledM = await current(page);
    assert.equal(settledM.state, 'private'); assert.match(settledM.text, /앞서 보낸 게시 요청은 서버에 반영되지 않았습니다/);
    await publish(page); await publishedLink(page).waitFor();
    assert.doesNotMatch(await statusLine(page), /글이 변경됐습니다/);
    const publishedM = publication(m.remoteId);
    assert.deepEqual({ active: publishedM.active, photos: publishedM.photos, revision: publishedM.revision }, { active: true, photos: 0, revision: 1 });
    await visit(visitor.page, await publishedLink(page).getAttribute('href'), 'published');
    assert.equal(await visitor.page.locator('#blogContent img').count(), 0, 'the dropped photos are not public');
    assert.equal(sentPublish(m.remoteId).length, 1, 'only the new choice reached the server');
    // The old request arriving late: refused by the publication-revision CAS of the real SQL.
    const late = server.rpc(accounts.a.id, 'life_blog_publish_copies', unsent.bodies[0]);
    assert.equal(late.status, 'conflict'); assert.equal(publication(m.remoteId).photos, 0);
    await click(page, '공개 검토 닫기');
    pass('M4: after a request that never arrived, publishing without photos succeeds; the late old request ends in conflict and its photos stay private');

    // ---- No implicit publication; a withdrawal is sent again ---------------------------------
    const n = await savedPost(page, '자동 재전송 없음 글');
    await manager(page); await openReview(page, n.doc.id); await preview(page, { name: '익명 검수' });
    const unsentText = await neverArrives(owner.context, 'life_blog_publish', { then: () => reads.start() });
    await publish(page); await unsentText.stop(); await click(page, '공개 검토 닫기');
    assert.equal(await publicStatus(page, n.doc.id), 'unknown');
    // m8: the list follows the settlement while it is on screen (publishing changes no post document).
    assert.match(await homeMeta(page, n.doc.id), /공개 확인 못 함 · 원본은 비공개/);
    await reads.stop();
    await kick(page); await until(() => publicStatus(page, n.doc.id), value => value === 'private', 'the cycle settles a request that never arrived');
    await page.waitForFunction(id => document.querySelector('#homePosts [data-photo-post-id="' + id + '"] .home-post-visibility')?.dataset.publication === 'private', n.doc.id);
    assert.match(await page.locator('#homePosts [data-photo-post-id="' + n.doc.id + '"] .home-post-meta').innerText(), /비공개 원본/);
    await kick(page); await new Promise(done => setTimeout(done, 1500));
    assert.equal(publication(n.remoteId), null, 'nothing became public by itself'); assert.equal(sentPublish(n.remoteId).length, 0);
    await openPost(page, n.doc.id, n.doc.title); assert.equal((await settledPill(page)).state, 'private');
    sheet = await openInfo(page); assert.match(await sheet.innerText(), /앞서 보낸 공개 게시 요청은 서버에 반영되지 않았습니다/); await closeInfo(page);
    // Publish it, then lose a withdrawal before it reaches the server.
    await manager(page); await openReview(page, n.doc.id); await preview(page); await publish(page); await publishedLink(page).waitFor();
    const unsentWithdrawal = await neverArrives(owner.context, 'life_blog_unpublish');
    await click(page, '공개 철회', panel(page));
    const withdrawText = await statusLine(page);
    assert.match(withdrawText, /공개 철회 결과를 받지 못했습니다/); assert.match(withdrawText, /철회 요청을 다시 보냅니다/);
    assert.equal(publication(n.remoteId).active, true); assert.equal(await publicStatus(page, n.doc.id), 'unknown');
    assert.equal((await current(page)).state, 'unknown');
    await unsentWithdrawal.stop(); await click(page, '공개 검토 닫기');
    await kick(page); await until(() => publication(n.remoteId).active, value => value === false, 'the cycle sends the withdrawal again');
    await until(() => publicStatus(page, n.doc.id), value => value === 'private', 'the withdrawal is settled');
    const withdrawals = sentUnpublish(n.remoteId);
    assert.equal(withdrawals.length, 1); assert.equal(withdrawals[0].body.p_operation_id, unsentWithdrawal.bodies[0].p_operation_id, 'the same operation was sent again');
    pass('a publish request is never sent again by itself; an unanswered withdrawal is, with its own operation id');

    // ---- M2: a hidden public post ---------------------------------------------------------------
    const h = await savedPost(page, '숨길 공개 글'), q = await savedPost(page, '철회하고 숨길 글');
    for (const post of [h, q]) { await manager(page); await openReview(page, post.doc.id); await preview(page, { name: '익명 검수' }); await publish(page); await publishedLink(page).waitFor(); await click(page, '공개 검토 닫기'); }
    await manager(page);
    assert.equal(await mark(page, h.doc.id), '공개 중');
    assert.equal(await mark(page, n.doc.id), '', 'a post that is not public has no public mark');
    const hide = row(page, h.doc.id).getByRole('button', { name: '목록에서 숨기기', exact: true });
    await hide.click();
    const question = page.getByRole('dialog', { name: '공개 중인 글 숨기기', exact: true }); await question.waitFor();
    assert.match(await question.innerText(), /숨겨도 공개는 유지/);
    assert.deepEqual(await question.getByRole('button').allInnerTexts(), ['공개 철회 후 숨기기', '숨기기만', '취소']);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), '취소', 'focus starts on the choice that changes nothing');
    await shot(page, 'm2-hide-question-1440');
    // Keyboard: the choices are reached in order, and the page behind the modal question cannot take focus.
    await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(() => document.activeElement?.textContent), '숨기기만');
    await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(() => document.activeElement?.textContent), '공개 철회 후 숨기기');
    assert.equal(await page.evaluate(() => { const outside = document.querySelector('#blogManagerSearch'); outside.focus(); return document.activeElement === outside; }), false, 'the list behind the question is inert');
    await page.keyboard.press('Escape'); await question.waitFor({ state: 'detached' }); await idle(page);
    await page.waitForFunction(() => document.activeElement?.textContent === '목록에서 숨기기');
    assert.equal(await row(page, h.doc.id).count(), 1); assert.equal(publication(h.remoteId).active, true);
    assert.equal((await data(page)).docs.find(doc => doc.id === h.doc.id).archived, false, 'Escape hides nothing');
    for (const width of [820, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await hide.scrollIntoViewIfNeeded(); await hide.click(); await question.waitFor();
      const box = await question.boundingBox(); assert(box.x >= 0 && box.x + box.width <= width + 0.5 && box.y >= 0, 'the question fits ' + width);
      for (const size of await question.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))) assert(size >= 44, 'a 44px target at ' + width);
      await shot(page, 'm2-hide-question-' + width);
      await question.getByRole('button', { name: '취소', exact: true }).click(); await question.waitFor({ state: 'detached' }); await idle(page);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await hide.click(); await question.waitFor(); await question.getByRole('button', { name: '숨기기만', exact: true }).click(); await question.waitFor({ state: 'detached' }); await idle(page);
    assert.match(await statusLine(page), /목록에서 숨겼습니다\. 공개는 유지됩니다/);
    assert.equal(await row(page, h.doc.id).count(), 0); assert.equal(publication(h.remoteId).active, true, 'hiding is not withdrawing');
    await page.locator('#blogManagerFilter').selectOption('archived');
    assert.match(await row(page, h.doc.id).locator('.life-meta').first().innerText(), /숨긴 글 · 공개 중/);
    await shot(page, 'm2-hidden-public-row-1440');
    await row(page, h.doc.id).getByRole('button', { name: '삭제', exact: true }).click(); await idle(page);
    assert.equal(await statusLine(page), '공개 중인 글입니다. 공개를 철회한 뒤 삭제해 주세요.');
    const withdrawHidden = row(page, h.doc.id).getByRole('button', { name: h.doc.title + ' 공개 철회', exact: true });
    assert.equal(await withdrawHidden.innerText(), '공개 철회');
    await withdrawHidden.click();
    const confirm = page.getByRole('dialog', { name: '공개 철회', exact: true }); await confirm.waitFor();
    assert.match(await confirm.innerText(), /다시 공개하면 새 주소/);
    await confirm.getByRole('button', { name: '공개 철회', exact: true }).click(); await confirm.waitFor({ state: 'detached' }); await idle(page);
    assert.equal(await statusLine(page), '공개 철회를 확인했습니다. 글은 그대로 있습니다.');
    assert.equal(publication(h.remoteId).active, false);
    assert.equal(await mark(page, h.doc.id), '');
    assert.equal(await row(page, h.doc.id).locator('[data-public-action]').count(), 0);
    await row(page, h.doc.id).getByRole('button', { name: '삭제', exact: true }).click(); await idle(page);
    assert.equal(await statusLine(page), '글을 삭제했습니다. 다른 기기에서도 삭제됩니다.'); assert.equal(await row(page, h.doc.id).count(), 0);
    await page.locator('#blogManagerFilter').selectOption('all');
    await row(page, q.doc.id).getByRole('button', { name: '목록에서 숨기기', exact: true }).click(); await question.waitFor();
    await question.getByRole('button', { name: '공개 철회 후 숨기기', exact: true }).click(); await question.waitFor({ state: 'detached' }); await idle(page);
    assert.equal(await statusLine(page), '공개를 철회하고 목록에서 숨겼습니다.');
    assert.equal(publication(q.remoteId).active, false); assert.equal((await data(page)).docs.find(doc => doc.id === q.doc.id).archived, true);
    // A post that is not public is hidden without a question, as before.
    await row(page, n.doc.id).getByRole('button', { name: '목록에서 숨기기', exact: true }).click(); await idle(page);
    assert.equal(await page.locator('dialog.blog-manager-dialog').count(), 0); assert.equal((await data(page)).docs.find(doc => doc.id === n.doc.id).archived, true);
    pass('M2: the list marks public posts; hiding a public post asks (keyboard, Escape, 820/390); a hidden public post can be withdrawn and then deleted');

    // ---- M3: one public name and intro for the whole list --------------------------------------
    const p1 = await savedPost(page, '첫 공개 글'), p2 = await savedPost(page, '둘째 공개 글');
    await manager(page); await openReview(page, p1.doc.id);
    await preview(page, { name: '익명A', intro: '익명 소개' }); await publish(page); await publishedLink(page).waitFor();
    const url1 = await publishedLink(page).getAttribute('href'); await click(page, '공개 검토 닫기');
    assert.deepEqual(profile(), { name: '익명A', intro: '익명 소개' });
    await openReview(page, p2.doc.id);
    assert.equal(await page.getByRole('textbox', { name: '공개 이름', exact: true }).inputValue(), '익명A', 'the current public name is filled in');
    assert.equal(await page.getByRole('textbox', { name: '공개 소개', exact: true }).inputValue(), '익명 소개');
    assert.match(await panel(page).locator('.blog-manager-profile').innerText(), /공개 글 목록 맨 위에 표시되며, 여기서 바꾸면 공개한 모든 글의 목록에서 함께 바뀝니다/);
    assert.match(await panel(page).innerText(), /제목, 본문 전체와 모든 첨부를 공개합니다/); assert.doesNotMatch(await panel(page).innerText(), /고른 본문과 첨부만/);
    await preview(page, { name: '익명B', intro: '바꾼 소개' });
    const head = panel(page).locator('.blog-manager-list-head');
    assert.match(await head.innerText(), /공개 글 목록 맨 위에 표시/); assert.match(await head.innerText(), /익명B의 블로그/); assert.match(await head.innerText(), /바꾼 소개/);
    await shot(page, 'm3-review-1440');
    for (const width of [820, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await head.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, 'no sideways scroll at ' + width);
      await shot(page, 'm3-review-' + width);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await publish(page); await publishedLink(page).waitFor(); await click(page, '공개 검토 닫기');
    await visit(visitor.page, url1, 'published'); await visitor.page.locator('#blogBack').click();
    await visitor.page.waitForFunction(() => /익명B의 블로그/.test(document.querySelector('#blogContent')?.innerText || ''));
    assert.match(await visitor.page.locator('#blogContent').innerText(), /바꾼 소개/);
    // Reviewing the first post again starts from the current values: updating does not blank them.
    await openReview(page, p1.doc.id);
    assert.equal(await page.getByRole('textbox', { name: '공개 이름', exact: true }).inputValue(), '익명B');
    assert.equal(await page.getByRole('textbox', { name: '공개 소개', exact: true }).inputValue(), '바꾼 소개');
    await preview(page); await publish(page); await publishedLink(page).waitFor(); await click(page, '공개 검토 닫기');
    assert.deepEqual(profile(), { name: '익명B', intro: '바꾼 소개' }, 'an untouched update keeps the list name and intro');
    await visitor.page.locator('#blogRefresh').click(); await visitor.page.waitForFunction(() => /익명B의 블로그/.test(document.querySelector('#blogContent')?.innerText || ''));
    // The current values cannot be read: nothing is published over them.
    const noProfile = await neverArrives(owner.context, 'life_blog_public_list');
    await openReview(page, p1.doc.id);
    assert.equal(await panel(page).locator('.blog-manager-profile').getAttribute('data-state'), 'failed');
    assert.equal(await page.getByRole('textbox', { name: '공개 이름', exact: true }).inputValue(), '');
    const before = sentPublish(p1.remoteId).length;
    await preview(page); await publish(page);
    assert.match(await statusLine(page), /현재 공개 이름과 소개를 읽지 못해 게시하지 않았습니다/);
    assert.equal(sentPublish(p1.remoteId).length, before, 'no request with blank values'); assert.deepEqual(profile(), { name: '익명B', intro: '바꾼 소개' });
    await noProfile.stop();
    await click(page, '공개 이름·소개 다시 읽기', panel(page));
    assert.equal(await page.getByRole('textbox', { name: '공개 이름', exact: true }).inputValue(), '익명B');
    await preview(page); await publish(page); await publishedLink(page).waitFor(); await click(page, '공개 검토 닫기');
    assert.deepEqual(profile(), { name: '익명B', intro: '바꾼 소개' });
    pass('M3: the review starts from the current public name and intro, says they head the whole list, previews that head, and never publishes blanks over values it could not read');

    // ---- m5: another device published; this device deletes before it knows ---------------------
    const d = await savedPost(page, '다른 기기 공개 글');
    await manager(page);
    const noList = await neverArrives(owner.context, 'life_blog_sync_list');
    const head1 = server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: d.remoteId });
    assert.equal(server.rpc(accounts.a.id, 'life_blog_publish', { p_post_id: d.remoteId, p_expected_revision: head1.revision, p_operation_id: require('node:crypto').randomUUID(), p_photo_ids: [],
      p_author: { name: '익명B', intro: '바꾼 소개' }, p_expected_publication_revision: 0 }).status, 'stored');
    assert.equal(await publicStatus(page, d.doc.id), 'private', 'this device has not seen the other device\'s publication');
    await row(page, d.doc.id).getByRole('button', { name: '삭제', exact: true }).click(); await idle(page);
    assert.equal(await row(page, d.doc.id).count(), 0);
    await until(() => server.blogRequests.filter(request => request.rpc === 'life_blog_delete' && request.body.p_post_id === d.remoteId).length, value => value >= 1, 'the deletion reaches the server');
    assert.equal(publication(d.remoteId).active, true, 'the server keeps the public post');
    await noList.stop(); await kick(page);
    await page.waitForFunction(() => /공개 중인 글이라 서버에서 삭제하지 않았고, 이 기기로 다시 받았습니다/.test(document.querySelector('.blog-manager [role="status"]')?.textContent || ''));
    const returned = (await data(page)).docs.find(doc => doc.title === d.doc.title); assert(returned, 'the post is back');
    assert.equal(await mark(page, returned.id), '공개 중');
    pass('m5: a deletion the server refused for a post another device published is explained when the post returns');

    assert.deepEqual(report.external, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []);
    report.dialogs = dialogs.length; report.pass = true;
  } finally {
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close();
  }
  console.log(JSON.stringify({ pass: report.pass === true, checks: report.checks.length, screenshots: report.screenshots.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, expectedTransportErrors: report.expectedTransportErrors.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
