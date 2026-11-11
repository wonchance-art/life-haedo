/* Publication recovery (2026-11-11 review B1, M2, M3, M4, m5, m7, m8; second review M1-M3, m1, m2, m6).
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
    apply(await fs.readFile(path.resolve(__dirname, '../supabase/migrations/20261111120000_life_blog_withdraw_before_publication.sql'), 'utf8'));
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
  const offlineCut = { on: false };
  const deliberate = /\/rest\/v1\/rpc\/life_blog_(?:publish|publish_copies|unpublish|read|public_list|sync_list)$|\/functions\/v1\/haedo-blog-media/;
  function watch(page, name) {
    page.setDefaultTimeout(25000);
    page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    page.on('console', event => {
      if (event.type() !== 'error') return;
      const entry = { name, message: event.text(), url: event.location().url };
      if (entry.url.startsWith(cloud) && deliberate.test(new URL(entry.url).pathname) && /Failed to load resource:.*(?:ERR_FAILED|404)/.test(entry.message)) report.expectedTransportErrors.push(entry);
      // R4-M1: while this suite cuts every request to the project (offlineCut), each one fails so.
      else if (offlineCut.on && entry.url.startsWith(cloud) && /Failed to load resource:.*ERR_INTERNET_DISCONNECTED/.test(entry.message)) report.expectedTransportErrors.push(entry);
      // earlierWithdrawal(): the refusal of the definition before 20261111120000.
      else if (entry.url === cloud + '/rest/v1/rpc/life_blog_unpublish' && earlier.on && /Failed to load resource:.*400/.test(entry.message)) report.expectedTransportErrors.push(entry);
      else report.consoleErrors.push(entry);
    });
    page.on('dialog', dialog => { dialogs.push({ name, type: dialog.type(), message: dialog.message() }); dialog.accept().catch(() => {}); });
  }
  async function device(name, account = accounts.a, { width = 1440, height = 1000 } = {}) {
    const context = await makeContext(browser, server, name, account, { viewport: { width, height } }); contexts.push(context);
    await context.route('**/*', route => {
      const origin = new URL(route.request().url()).origin;
      if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
      report.external.push(origin); return route.abort();
    });
    const page = await context.newPage(); watch(page, name);
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
  // The request stays in flight: it has left the page and has not reached the server. release()
  // lets it arrive and be answered.
  async function inFlight(context, rpc) {
    let seen, open; const arrived = new Promise(resolve => { seen = resolve; }), gate = new Promise(resolve => { open = resolve; });
    let first = true;
    const handler = async route => { if (!first) return route.fallback(); first = false; seen(route.request().postDataJSON()); await gate; return route.fallback(); };
    await context.route(rpcPath(rpc), handler);
    return { arrived, async release() { open(); await context.unroute(rpcPath(rpc), handler); } };
  }
  // The server definition before 20261111120000, exactly as it answers a withdrawal with expected
  // revision 0 (tests/run-blog-unpublish-postgres.cjs "before"): HTTP 400, 22023
  // life_invalid_request, nothing changed. Every other withdrawal reaches the real SQL.
  const earlier = { on: false, refused: [] };
  async function earlierWithdrawal(context) {
    const handler = route => {
      const body = route.request().postDataJSON();
      if (body.p_expected_revision !== 0) return route.fallback();
      earlier.refused.push(body);
      return route.fulfill({ status: 400, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json', 'cache-control': 'no-store' },
        body: JSON.stringify({ code: '22023', details: null, hint: null, message: 'life_invalid_request' }) });
    };
    earlier.on = true; earlier.refused.length = 0; await context.route(rpcPath('life_blog_unpublish'), handler);
    return { refused: earlier.refused, async stop() { await context.unroute(rpcPath('life_blog_unpublish'), handler); earlier.on = false; } };
  }
  const uuid = () => require('node:crypto').randomUUID();
  const published = remoteId => { const value = publication(remoteId); return value && { active: value.active, revision: value.revision }; };
  const cycles = () => server.blogRequests.filter(request => request.rpc === 'life_blog_sync_list').length;
  // One whole cycle of this page after now (its list request and what follows it).
  const cycle = async page => { const before = cycles(); await kick(page); await until(cycles, value => value > before, 'a cycle lists the account'); await new Promise(done => setTimeout(done, 700)); };
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

    // ---- m6 + m1: first reading of a public post; the profile after the only public post is withdrawn ----
    const z = await savedPost(page, '첫 공개 이름 글');
    await manager(page); await openReview(page, z.doc.id);
    assert.equal(await page.getByRole('textbox', { name: '공개 이름', exact: true }).inputValue(), '', 'nothing was published from this device yet');
    await preview(page, { name: '익명Z', intro: '기억할 소개' }); await publish(page); await publishedLink(page).waitFor(); await click(page, '공개 검토 닫기');
    // The post was read as 비공개 before it was published: opening it again must not start from that.
    await page.evaluate(() => {
      window.__pill = [];
      const record = () => { for (const node of document.querySelectorAll('.photo-privacy')) { const value = node.dataset.state; if (window.__pill.at(-1) !== value) window.__pill.push(value); } };
      window.__pillObserver = new MutationObserver(record); window.__pillObserver.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state'] });
    });
    await row(page, z.doc.id).getByRole('button', { name: z.doc.title, exact: true }).click(); await page.locator('.photo-article').waitFor();
    await until(() => pill(page), value => value.state === 'public', 'the pill settles as public');
    const drawn = await page.evaluate(() => { window.__pillObserver.disconnect(); return window.__pill; });
    assert.equal(drawn.includes('private'), false, 'never drawn as 비공개 on the way: ' + drawn.join(' > ')); assert.equal(drawn.at(-1), 'public');
    await manager(page); await openReview(page, z.doc.id); await click(page, '공개 철회', panel(page)); assert.equal(publication(z.remoteId).active, false); await click(page, '공개 검토 닫기');
    await openReview(page, z.doc.id);
    assert.equal(await page.getByRole('textbox', { name: '공개 이름', exact: true }).inputValue(), '익명Z', 'the last published name of this device');
    assert.equal(await page.getByRole('textbox', { name: '공개 소개', exact: true }).inputValue(), '기억할 소개');
    assert.equal(await panel(page).locator('.blog-manager-profile').getAttribute('data-state'), 'remembered');
    assert.match(await panel(page).locator('.blog-manager-profile').innerText(), /지금 공개 중인 글이 없어 서버의 값을 읽을 수 없습니다\. 이 기기에서 마지막으로 게시한 이름과 소개를 채웠으니 확인해 주세요/);
    await preview(page); await publish(page); await publishedLink(page).waitFor();
    assert.deepEqual(profile(), { name: '익명Z', intro: '기억할 소개' }, 'publishing again without retyping does not blank the profile');
    await click(page, '공개 철회', panel(page)); await click(page, '공개 검토 닫기');
    pass('m6 + m1: a public post is never first drawn as 비공개; with no public post the review offers the last published name and intro, marked as this device\'s');

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
    assert.equal(settledM.state, 'private'); assert.match(settledM.text, /앞서 보낸 공개 게시 요청은 아직 반영되지 않았습니다\. 늦게 반영될 수 있습니다/);
    assert.equal(await panel(page).locator('.blog-manager-current').getAttribute('data-notice'), 'publish_unapplied');
    await publish(page); await publishedLink(page).waitFor();
    assert.doesNotMatch(await statusLine(page), /글이 변경됐습니다/);
    const publishedM = publication(m.remoteId);
    // The request that never arrived was ended first (a withdrawal from revision 0), so this publication is revision 2.
    assert.deepEqual({ active: publishedM.active, photos: publishedM.photos, revision: publishedM.revision }, { active: true, photos: 0, revision: 2 });
    assert.deepEqual(sentUnpublish(m.remoteId).map(request => request.body.p_expected_revision), [0]);
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
    sheet = await openInfo(page); assert.match(await sheet.locator('.photo-public-unapplied[data-notice="publish_unapplied"]').innerText(), /아직 반영되지 않았습니다\. 늦게 반영될 수 있습니다/); await closeInfo(page);
    await manager(page); assert.equal(await mark(page, n.doc.id), '앞서 보낸 게시 미반영', 'the list names the unanswered request too');
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
    // m3: not silently. The open list announces it and the post keeps saying it.
    await page.waitForFunction(() => /받지 못했던 철회 요청을 이 기기가 다시 보내 공개를 철회했습니다/.test(document.querySelector('.blog-manager [role="status"]')?.textContent || ''));
    await openPost(page, n.doc.id, n.doc.title); await settledPill(page);
    sheet = await openInfo(page); assert.match(await sheet.locator('.photo-public-log').innerText(), /받지 못했던 철회 요청을 이 기기가 다시 보내 공개를 철회했습니다/); await closeInfo(page);
    pass('a publish request is never sent again by itself; an unanswered withdrawal is, with its own operation id, and the device says that it did');

    // An unanswered withdrawal is sent again only against the publication it was made for: a
    // publication another device makes afterwards stays (review probe 5).
    const y = await savedPost(page, '철회 대기 뒤 다른 기기 재게시 글');
    await manager(page); await openReview(page, y.doc.id); await preview(page, { name: '익명 검수' }); await publish(page); await publishedLink(page).waitFor();
    const staleWithdrawal = await neverArrives(owner.context, 'life_blog_unpublish');
    await click(page, '공개 철회', panel(page)); await staleWithdrawal.stop(); await click(page, '공개 검토 닫기');
    assert.equal(staleWithdrawal.count, 1); assert.equal(await publicStatus(page, y.doc.id), 'unknown');
    const headY = server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: y.remoteId });
    assert.equal(server.rpc(accounts.a.id, 'life_blog_publish', { p_post_id: y.remoteId, p_expected_revision: headY.revision, p_operation_id: require('node:crypto').randomUUID(), p_photo_ids: [],
      p_author: { name: '다른 기기에서 다시 공개', intro: '' }, p_expected_publication_revision: headY.publication.revision }).status, 'stored');
    const newerY = publication(y.remoteId); assert.deepEqual({ active: newerY.active, revision: newerY.revision }, { active: true, revision: 2 });
    await kick(page); await until(() => publicStatus(page, y.doc.id), value => value === 'public', 'the cycle settles the old withdrawal against the newer publication');
    await new Promise(done => setTimeout(done, 1500));
    assert.deepEqual(publication(y.remoteId), newerY, 'the newer publication is not withdrawn'); assert.equal(sentUnpublish(y.remoteId).length, 0, 'the old withdrawal is not sent against it');
    assert.equal((await state(page, y.doc.id)).unpublishPending, null); assert.equal(await mark(page, y.doc.id), '공개 중');
    await openReview(page, y.doc.id); await click(page, '공개 철회', panel(page)); assert.equal(publication(y.remoteId).active, false); await click(page, '공개 검토 닫기');
    pass('an unanswered withdrawal does not withdraw a publication another device made afterwards');

    // ---- M1: two tabs; a request still being sent is not judged by the other tab ----------------------
    const tabB = await owner.context.newPage(); watch(tabB, 'recovery-owner-tab-b'); await tabB.goto(base + '/index.html'); await ready(tabB); await settle(tabB);
    const t2 = await savedPost(page, '두 탭 게시 글');
    await manager(page); await openReview(page, t2.doc.id); await preview(page, { name: '익명 검수', intro: '' });
    let flying = await inFlight(owner.context, 'life_blog_publish');
    await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click(); await flying.arrived;
    await cycle(tabB);
    let during = await state(tabB, t2.doc.id);
    assert(during.publishPending, 'the request is recorded'); assert.equal(during.publishChecked ?? null, null, 'tab B did not record it as not applied');
    assert.equal(await publicStatus(tabB, t2.doc.id), 'unknown'); assert.equal(publication(t2.remoteId), null);
    await flying.release(); await idle(page); await publishedLink(page).waitFor();
    assert.equal(await statusLine(page), '공개 게시를 확인했습니다. 같은 글의 갱신은 이 주소를 유지합니다.', 'the tab that sent it ends with its result, not with an error');
    assert.equal((await current(page)).state, 'public'); assert.equal(publication(t2.remoteId).active, true); assert.equal(sentPublish(t2.remoteId).length, 1);
    await openPost(tabB, t2.doc.id, t2.doc.title); assert.equal((await settledPill(tabB)).state, 'public', 'the other tab reads the same result');
    assert.match(await homeMeta(tabB, t2.doc.id), /공개 중 · 원본은 비공개/);
    flying = await inFlight(owner.context, 'life_blog_unpublish');
    await panel(page).getByRole('button', { name: '공개 철회', exact: true }).click(); await flying.arrived;
    await cycle(tabB);
    assert.equal(sentUnpublish(t2.remoteId).length, 0, 'tab B sent no second withdrawal while the first is in flight'); assert.equal(await publicStatus(tabB, t2.doc.id), 'unknown');
    // r2-m3: an action in tab B waits for tab A, then says so instead of staying busy (wait limit 10 s).
    await manager(tabB); const waitFrom = Date.now();
    await row(tabB, t2.doc.id).getByRole('button', { name: t2.doc.title + ' 공개 상태 확인', exact: true }).click();
    await tabB.waitForFunction(() => /다른 탭에서 처리 중입니다\. 잠시 뒤 다시 시도해 주세요/.test(document.querySelector('.blog-manager [role="status"]')?.textContent || ''));
    const waited = Date.now() - waitFrom; assert(waited >= 9000 && waited < 20000, 'the wait limit: ' + waited + ' ms');
    await idle(tabB); assert.equal(sentUnpublish(t2.remoteId).length, 0, 'tab B sent nothing'); assert.equal(await publicStatus(tabB, t2.doc.id), 'unknown');
    await flying.release(); await idle(page);
    assert.equal(await statusLine(page), '공개 철회를 확인했습니다.'); assert.equal(publication(t2.remoteId).active, false); assert.equal(sentUnpublish(t2.remoteId).length, 1);
    await click(page, '공개 검토 닫기'); await tabB.close();
    pass('M1: with two tabs a publish or withdrawal in flight is not judged or sent again by the other tab, and ends with its own result');

    // ---- M1: a withdrawal must hold against an unanswered publish request that arrives later -----------
    // (a) A publication row exists: the withdrawal moves its revision, so the late request ends in conflict (real SQL).
    const w1 = await savedPost(page, '철회 뒤 늦은 재게시 글', files);
    await manager(page); await openReview(page, w1.doc.id); await preview(page, { selected: [], name: '익명 검수' }); await publish(page); await publishedLink(page).waitFor();
    await click(page, '공개 철회', panel(page)); assert.deepEqual({ active: publication(w1.remoteId).active, revision: publication(w1.remoteId).revision }, { active: false, revision: 2 });
    await preview(page, { selected: w1.doc.photos.map(photo => photo.id) });
    let lateRequest = await neverArrives(owner.context, 'life_blog_publish_copies'); await publish(page); await lateRequest.stop();
    assert.equal(lateRequest.count, 1); assert.equal(lateRequest.bodies[0].p_expected_publication_revision, 2);
    await click(page, '공개 철회', panel(page));
    assert.equal(await statusLine(page), '앞서 보낸 공개 게시 요청을 끝냈습니다. 이 글은 공개 중이 아닙니다.');
    assert.equal(sentUnpublish(w1.remoteId).length, 2, 'a withdrawal request was really sent although nothing was public');
    assert.deepEqual({ active: publication(w1.remoteId).active, revision: publication(w1.remoteId).revision }, { active: false, revision: 3 });
    assert.equal(await publicStatus(page, w1.doc.id), 'private'); assert.equal((await state(page, w1.doc.id)).publishPending, null);
    assert.equal(server.rpc(accounts.a.id, 'life_blog_publish_copies', lateRequest.bodies[0]).status, 'conflict', 'the request arriving after the withdrawal is refused');
    assert.equal(publication(w1.remoteId).active, false); await click(page, '공개 검토 닫기');
    // (b) No publication row (review R2-M1): the withdrawal is always sent, with expected revision 0. The real SQL
    // records a withdrawn row at revision 1, so the late first publication ends in conflict. Nothing is guarded on
    // the device and nothing is withdrawn afterwards.
    const w2 = await savedPost(page, '철회 뒤 늦은 첫 게시 글', files);
    assert.equal(server.rpc(accounts.a.id, 'life_blog_unpublish', { p_post_id: w2.remoteId, p_expected_revision: 1, p_operation_id: uuid() }).status, 'missing', 'an expected revision of 1 or more keeps the earlier answer');
    await manager(page); await openReview(page, w2.doc.id); await preview(page, { selected: w2.doc.photos.map(photo => photo.id), name: '익명 검수' });
    lateRequest = await neverArrives(owner.context, 'life_blog_publish_copies'); await publish(page); await lateRequest.stop();
    assert.equal(await publicStatus(page, w2.doc.id), 'unknown'); assert.equal(publication(w2.remoteId), null);
    await click(page, '공개 철회', panel(page));
    assert.equal(await statusLine(page), '앞서 보낸 공개 게시 요청을 끝냈습니다. 이 글은 공개 중이 아닙니다.');
    assert.deepEqual(sentUnpublish(w2.remoteId).map(request => request.body.p_expected_revision), [0], 'the withdrawal request was sent, for revision 0');
    assert.deepEqual(published(w2.remoteId), { active: false, revision: 1 }, 'a withdrawn row at revision 1');
    assert.equal(await publicStatus(page, w2.doc.id), 'private', 'settled as 비공개 at once: the request can no longer be applied');
    assert.deepEqual({ state: (await current(page)).state, notice: await panel(page).locator('.blog-manager-current').getAttribute('data-notice') }, { state: 'private', notice: '' });
    // r3-m5(b): pressing again sends nothing and says the post was not public.
    await click(page, '공개 철회', panel(page));
    assert.equal(await statusLine(page), '이 글은 공개 중이 아닙니다.'); assert.equal(sentUnpublish(w2.remoteId).length, 1, 'no second request');
    const bindingW2 = await state(page, w2.doc.id); assert.equal(bindingW2.publishPending, null); assert.equal(bindingW2.unpublishPending, null); assert.equal(Object.hasOwn(bindingW2, 'publishRevoked'), false);
    await click(page, '공개 검토 닫기');
    assert.equal(server.rpc(accounts.a.id, 'life_blog_publish_copies', lateRequest.bodies[0]).status, 'conflict', 'the first publication arriving after the withdrawal is refused');
    assert.deepEqual(published(w2.remoteId), { active: false, revision: 1 }); assert.equal(server.rpc(null, 'life_blog_public_read', { p_token: publication(w2.remoteId).token }), null, 'the row\'s token is not a public address');
    await cycle(page); assert.equal(sentUnpublish(w2.remoteId).length, 1); assert.equal(sentPublish(w2.remoteId).length, 0); assert.equal(await mark(page, w2.doc.id), '');
    // The next deliberate publication starts from that row and gets its own address.
    await openReview(page, w2.doc.id); await preview(page, { selected: [] }); await publish(page); await publishedLink(page).waitFor();
    assert.deepEqual(published(w2.remoteId), { active: true, revision: 2 }); assert.notEqual(publication(w2.remoteId).token, bindingW2.publication.token);
    await click(page, '공개 철회', panel(page)); await click(page, '공개 검토 닫기');
    pass('R2-M1: a withdrawal holds against a late publish request with or without a publication row: a withdrawal request moves the revision (from 0 without a row) and the late request ends in conflict');

    // R2-A: another device's later deliberate publication with the same name and no photos is indistinguishable
    // from this device's own request by content. It is never withdrawn.
    const w3 = await savedPost(page, '철회 뒤 다른 기기의 같은 이름 게시 글');
    await manager(page); await openReview(page, w3.doc.id); await preview(page, { name: '익명 검수', intro: '' });
    lateRequest = await neverArrives(owner.context, 'life_blog_publish'); await publish(page); await lateRequest.stop();
    await click(page, '공개 철회', panel(page)); await click(page, '공개 검토 닫기');
    assert.deepEqual(published(w3.remoteId), { active: false, revision: 1 });
    const theirs = server.rpc(accounts.a.id, 'life_blog_publish', { p_post_id: w3.remoteId, p_expected_revision: lateRequest.bodies[0].p_expected_revision, p_operation_id: uuid(), p_photo_ids: [],
      p_author: { name: '익명 검수', intro: '' }, p_expected_publication_revision: 1 });
    assert.equal(theirs.status, 'stored'); const theirCopy = publication(w3.remoteId);
    assert.deepEqual({ author: theirCopy.author, photos: theirCopy.photos }, { author: lateRequest.bodies[0].p_author, photos: 0 }, 'the same name and no photos as this device\'s unanswered request');
    await cycle(page); await until(() => publicStatus(page, w3.doc.id), value => value === 'public', 'this device reads the other device\'s publication');
    await cycle(page);
    assert.deepEqual(publication(w3.remoteId), theirCopy, 'the other device\'s publication is not withdrawn');
    assert.deepEqual(sentUnpublish(w3.remoteId).map(request => request.body.p_expected_revision), [0], 'no withdrawal after it');
    assert.equal(await mark(page, w3.doc.id), '공개 중');
    assert.equal(server.rpc(accounts.a.id, 'life_blog_publish', lateRequest.bodies[0]).status, 'conflict', 'this device\'s own request can no longer be applied');
    await openReview(page, w3.doc.id); await click(page, '공개 철회', panel(page)); assert.equal(publication(w3.remoteId).active, false); await click(page, '공개 검토 닫기');
    pass('R2-A: another device\'s later publication with the same name and no photos stays public; this device sends no withdrawal against it');

    // (c) The server still has the earlier definition (before the migration is applied): the withdrawal for
    // revision 0 is refused. The post stays 확인 못 함, the withdrawal is sent again once per cycle, nothing is
    // judged from what becomes public, and it ends when the server takes the withdrawal.
    const w4 = await savedPost(page, '옛 서버 정의의 철회 글');
    await manager(page); await openReview(page, w4.doc.id); await preview(page, { name: '익명 검수', intro: '' });
    lateRequest = await neverArrives(owner.context, 'life_blog_publish'); await publish(page); await lateRequest.stop();
    let old = await earlierWithdrawal(owner.context);
    await click(page, '공개 철회', panel(page));
    assert.match(await statusLine(page), /앞서 보낸 공개 게시 요청을 서버에서 아직 끝내지 못했습니다\. 공개 상태는 확인 못 함으로 두고 철회 요청을 다시 보냅니다/);
    assert.equal(old.refused.length, 1); assert.equal(publication(w4.remoteId), null);
    assert.equal(await publicStatus(page, w4.doc.id), 'unknown', 'never called 비공개 while the request can still arrive'); assert.equal((await current(page)).state, 'unknown');
    await click(page, '공개 검토 닫기');
    // Sent again by the cycle, and never more than once per cycle (no flood).
    const listedBefore = cycles();
    for (let i = 2; i <= 3; i++) { await cycle(page); await until(() => old.refused.length, value => value >= i, 'the withdrawal is sent again on the cycle'); }
    assert(old.refused.length - 1 <= cycles() - listedBefore, 'at most one per cycle: ' + (old.refused.length - 1) + ' in ' + (cycles() - listedBefore) + ' cycles');
    assert.equal(new Set(old.refused.map(body => body.p_operation_id)).size, 1, 'the same operation each time'); assert.equal(await publicStatus(page, w4.doc.id), 'unknown');
    assert.equal(sentPublish(w4.remoteId).length, 0, 'no publication request is sent');
    // The server takes it (the migration is applied): the next cycle ends the request.
    await old.stop();
    await kick(page); await until(() => published(w4.remoteId), value => value?.revision === 1, 'the cycle sends the withdrawal to the updated server');
    await until(() => publicStatus(page, w4.doc.id), value => value === 'private', 'settled as 비공개');
    assert.deepEqual(published(w4.remoteId), { active: false, revision: 1 }); assert.equal(sentUnpublish(w4.remoteId)[0].body.p_operation_id, old.refused[0].p_operation_id);
    assert.equal(server.rpc(accounts.a.id, 'life_blog_publish', lateRequest.bodies[0]).status, 'conflict');
    // The same, and another device publishes the same name meanwhile: public, said, not withdrawn.
    const w5 = await savedPost(page, '옛 서버 정의에서 다른 기기 게시 글');
    await manager(page); await openReview(page, w5.doc.id); await preview(page, { name: '익명 검수', intro: '' });
    lateRequest = await neverArrives(owner.context, 'life_blog_publish'); await publish(page); await lateRequest.stop();
    old = await earlierWithdrawal(owner.context);
    await click(page, '공개 철회', panel(page)); await click(page, '공개 검토 닫기');
    assert.equal(await publicStatus(page, w5.doc.id), 'unknown');
    assert.equal(server.rpc(accounts.a.id, 'life_blog_publish', { ...lateRequest.bodies[0], p_operation_id: uuid() }).status, 'stored');
    const otherCopy = publication(w5.remoteId); assert.equal(otherCopy.active, true);
    await kick(page); await until(() => publicStatus(page, w5.doc.id), value => value === 'public', 'the cycle reads the publication');
    await page.waitForFunction(() => /철회를 요청한 뒤에 게시가 반영되어 지금 공개 중입니다\. 비공개로 두려면 다시 철회해 주세요/.test(document.querySelector('.blog-manager [role="status"]')?.textContent || ''));
    await cycle(page);
    assert.deepEqual(publication(w5.remoteId), otherCopy, 'not withdrawn by content'); assert.equal(sentUnpublish(w5.remoteId).length, 0);
    assert(old.refused.every(body => body.p_expected_revision === 0)); assert.equal(await mark(page, w5.doc.id), '공개 중');
    await openPost(page, w5.doc.id, w5.doc.title); await settledPill(page);
    sheet = await openInfo(page); assert.match(await sheet.locator('.photo-public-log').innerText(), /철회를 요청한 뒤에 게시가 반영되어 지금 공개 중입니다/); await closeInfo(page);
    await old.stop();
    await manager(page); await openReview(page, w5.doc.id); await click(page, '공개 철회', panel(page)); assert.equal(publication(w5.remoteId).active, false); await click(page, '공개 검토 닫기');
    pass('earlier server definition: a withdrawal that cannot end the first publication keeps 확인 못 함, is sent again once per cycle, withdraws nothing by content, and ends when the server takes it');

    // ---- r2-m4: the "not applied yet" notice ends when the owner ends the request ----------------------
    const cx = await savedPost(page, '게시 요청 취소 글');
    await manager(page); await openReview(page, cx.doc.id); await preview(page, { name: '익명 검수', intro: '' });
    lateRequest = await neverArrives(owner.context, 'life_blog_publish'); await publish(page); await lateRequest.stop(); await click(page, '공개 검토 닫기');
    await kick(page); await until(() => mark(page, cx.doc.id), value => value === '앞서 보낸 게시 미반영', 'the list names the request that is not applied');
    await cycle(page); assert.equal(await mark(page, cx.doc.id), '앞서 보낸 게시 미반영', 'it stays until the owner acts'); assert.equal(sentUnpublish(cx.remoteId).length, 0);
    await openReview(page, cx.doc.id);
    assert.match((await current(page)).text, /비공개.*앞서 보낸 공개 게시 요청은 아직 반영되지 않았습니다.*공개하지 않으려면 공개 검토에서 게시 요청을 취소해 주세요/);
    await shot(page, 'r2m4-cancel-request-1440');
    await page.setViewportSize({ width: 390, height: 844 }); await panel(page).getByRole('button', { name: '게시 요청 취소', exact: true }).scrollIntoViewIfNeeded(); await shot(page, 'r2m4-cancel-request-390');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll at 390');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await panel(page).getByRole('button', { name: '게시 요청 취소', exact: true }).focus(); await page.keyboard.press('Enter'); await settle(page); await idle(page);
    assert.equal(await statusLine(page), '앞서 보낸 게시 요청을 취소했습니다. 이 글은 공개 중이 아닙니다.');
    assert.deepEqual({ state: (await current(page)).state, notice: await panel(page).locator('.blog-manager-current').getAttribute('data-notice') }, { state: 'private', notice: '' });
    assert.equal(await panel(page).getByRole('button', { name: '게시 요청 취소', exact: true }).count(), 0);
    assert.deepEqual(published(cx.remoteId), { active: false, revision: 1 }); assert.deepEqual(sentUnpublish(cx.remoteId).map(request => request.body.p_expected_revision), [0]);
    assert.equal(server.rpc(accounts.a.id, 'life_blog_publish', lateRequest.bodies[0]).status, 'conflict', 'the cancelled request can never be applied');
    await click(page, '공개 검토 닫기'); assert.equal(await mark(page, cx.doc.id), '');
    pass('r2-m4: 게시 요청 취소 ends a publish request that is not applied (keyboard, 1440/390); the notice ends and the late request is refused');

    // ---- M2: an update of a public post that is not applied is never silent ---------------------------
    const u = await savedPost(page, '갱신 미반영 글', files);
    await manager(page); await openReview(page, u.doc.id); await preview(page, { selected: u.doc.photos.map(photo => photo.id), name: '익명 검수' }); await publish(page); await publishedLink(page).waitFor();
    const urlU = await publishedLink(page).getAttribute('href');
    await preview(page, { selected: [] });
    const lostUpdate = await neverArrives(owner.context, 'life_blog_publish'); await publish(page); await lostUpdate.stop(); await click(page, '공개 검토 닫기');
    assert.equal(await publicStatus(page, u.doc.id), 'unknown');
    await kick(page); await until(() => publicStatus(page, u.doc.id), value => value === 'public', 'the cycle settles the update as not applied');
    await until(() => mark(page, u.doc.id), value => value === '공개 중 · 앞서 보낸 갱신 미반영', 'the list names the unanswered update');
    await openReview(page, u.doc.id);
    assert.equal(await panel(page).locator('.blog-manager-current').getAttribute('data-notice'), 'update_unapplied');
    assert.match((await current(page)).text, /공개 중.*앞서 보낸 공개 갱신은 아직 반영되지 않았습니다\. 이전 공개본이 그대로 공개 중입니다\. 늦게 반영될 수 있으니/);
    await shot(page, 'm2-update-unapplied-review-1440'); await click(page, '공개 검토 닫기');
    await openPost(page, u.doc.id, u.doc.title); assert.equal((await settledPill(page)).state, 'public');
    sheet = await openInfo(page); assert.match(await sheet.locator('.photo-public-unapplied[data-notice="update_unapplied"]').innerText(), /이전 공개본이 그대로 공개 중입니다/); await closeInfo(page);
    await visit(visitor.page, urlU, 'published'); assert.equal(await visitor.page.locator('#blogContent img').count(), 2, 'the earlier copy is what visitors still read');
    await manager(page); await openReview(page, u.doc.id); await preview(page, { selected: [] }); await publish(page); await publishedLink(page).waitFor();
    assert.equal(publication(u.remoteId).photos, 0); assert.equal(await panel(page).locator('.blog-manager-current').getAttribute('data-notice'), '');
    await click(page, '공개 검토 닫기'); assert.equal(await mark(page, u.doc.id), '공개 중');
    pass('M2: an update of a public post that is not applied stays named in the list, the review and 글 정보 while the earlier copy is public');

    // ---- M3: a changed choice while an earlier request is unanswered ---------------------------------------
    // Nothing is public yet: the earlier request is ended first, so when it arrives it is refused.
    const v = await savedPost(page, '전송 중 경합 글', files);
    await manager(page); await openReview(page, v.doc.id); await preview(page, { selected: v.doc.photos.map(photo => photo.id), name: '익명 검수' });
    let replacedRequest = await neverArrives(owner.context, 'life_blog_publish_copies'); await publish(page); await replacedRequest.stop();
    await preview(page, { selected: [] });
    flying = await inFlight(owner.context, 'life_blog_publish');
    await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click(); const secondBody = await flying.arrived;
    assert.equal(secondBody.p_expected_publication_revision, 1, 'the new choice is sent against the revision the withdrawal made');
    assert.deepEqual(published(v.remoteId), { active: false, revision: 1 }); assert.deepEqual(sentUnpublish(v.remoteId).map(request => request.body.p_expected_revision), [0]);
    assert.equal(server.rpc(accounts.a.id, 'life_blog_publish_copies', replacedRequest.bodies[0]).status, 'conflict', 'the replaced choice arriving first is refused');
    await flying.release(); await idle(page); await publishedLink(page).waitFor();
    assert.equal(await statusLine(page), '공개 게시를 확인했습니다. 같은 글의 갱신은 이 주소를 유지합니다.');
    let finalV = publication(v.remoteId);
    assert.deepEqual({ active: finalV.active, photos: finalV.photos, revision: finalV.revision }, { active: true, photos: 0, revision: 2 }, 'only the last reviewed choice became public');
    assert.deepEqual(sentPublish(v.remoteId).map(request => [request.rpc, request.body.p_expected_publication_revision]), [['life_blog_publish', 1]]);
    await visit(visitor.page, await publishedLink(page).getAttribute('href'), 'published'); assert.equal(await visitor.page.locator('#blogContent img').count(), 0);
    // The post is public now: an unanswered update keeps the address, so the next choice shares its revision. When
    // the replaced update arrives first, the new choice is sent once more as an update.
    await preview(page, { selected: v.doc.photos.map(photo => photo.id) });
    replacedRequest = await neverArrives(owner.context, 'life_blog_publish_copies'); await publish(page); await replacedRequest.stop();
    await preview(page, { selected: [v.doc.photos[0].id] });
    flying = await inFlight(owner.context, 'life_blog_publish_copies');
    await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click(); await flying.arrived;
    const firstCopy = server.rpc(accounts.a.id, 'life_blog_publish_copies', replacedRequest.bodies[0]);
    assert.equal(firstCopy.status, 'stored'); assert.equal(publication(v.remoteId).photos, 2, 'the replaced update reached the server first');
    await flying.release(); await idle(page); await publishedLink(page).waitFor();
    assert.equal(await statusLine(page), '공개 게시를 확인했습니다. 같은 글의 갱신은 이 주소를 유지합니다.');
    finalV = publication(v.remoteId);
    assert.deepEqual({ active: finalV.active, photos: finalV.photos, revision: finalV.revision, token: finalV.token }, { active: true, photos: 1, revision: 4, token: firstCopy.token }, 'the last reviewed choice is what stays public, at the same address');
    assert.deepEqual(sentPublish(v.remoteId).map(request => [request.rpc, request.body.p_expected_publication_revision]).slice(1), [['life_blog_publish_copies', 2], ['life_blog_publish_copies', 3]]);
    assert.equal(sentUnpublish(v.remoteId).length, 1, 'a public post is never withdrawn to end an update');
    await visit(visitor.page, await publishedLink(page).getAttribute('href'), 'published'); assert.equal(await visitor.page.locator('#blogContent img').count(), 1);
    await click(page, '공개 검토 닫기');
    // ---- R3-M1 (review probe A4): the new choice was not sent and the earlier request became public --------
    const a4 = await savedPost(page, '빼려던 사진이 공개된 글', files);
    await manager(page); await openReview(page, a4.doc.id); await preview(page, { selected: a4.doc.photos.map(photo => photo.id), name: '익명 검수' });
    replacedRequest = await neverArrives(owner.context, 'life_blog_publish_copies'); await publish(page); await replacedRequest.stop();
    // The owner takes the photos out and publishes again; the withdrawal that ends the first request never arrives.
    await preview(page, { selected: [] });
    const endingA4 = await neverArrives(owner.context, 'life_blog_unpublish'); await publish(page); await endingA4.stop();
    assert.match(await statusLine(page), /이번 공개 게시 요청은 보내지 못했습니다\. 앞서 보낸 요청의 결과는 아직 확인하지 못했습니다/);
    assert.equal(endingA4.count, 1); assert.equal(sentPublish(a4.remoteId).length, 0, 'the new choice was not sent'); assert.equal((await current(page)).state, 'unknown');
    const consentA4 = page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true });
    assert.equal(await consentA4.isChecked(), true, 'a connection failure keeps the reviewed preview');
    // The first request reaches the server.
    assert.equal(server.rpc(accounts.a.id, 'life_blog_publish_copies', replacedRequest.bodies[0]).status, 'stored');
    assert.deepEqual({ active: publication(a4.remoteId).active, photos: publication(a4.remoteId).photos, revision: publication(a4.remoteId).revision }, { active: true, photos: 2, revision: 1 });
    await kick(page); await until(() => publicStatus(page, a4.doc.id), value => value === 'public', 'the cycle reads the publication');
    // The open review says what is public, and the preview that was not published is over.
    await until(() => panel(page).locator('.blog-manager-current').getAttribute('data-notice'), value => value === 'earlier_choice_public', 'the open review names it');
    const noticeA4 = /마지막으로 고른 내용은 게시되지 않았습니다\. 먼저 보낸 게시가 반영되어 공개 중입니다\(사진 2장\)\. 미리보기를 갱신해 다시 게시하거나 철회해 주세요/;
    assert.match((await current(page)).text, /현재 공개 상태: 공개 중/); assert.match((await current(page)).text, noticeA4);
    assert.equal(await consentA4.isChecked(), false, 'the consent ends with the preview');
    assert.match(await panel(page).locator('.blog-manager-public-preview').innerText(), /이 미리보기는 게시되지 않았습니다\. 미리보기를 갱신해 현재 공개 상태를 확인해 주세요/);
    // r4-m2: the status line says the photo count too, as the review and 글 정보 do.
    assert.equal(await statusLine(page), '“빼려던 사진이 공개된 글”: 마지막으로 고른 내용은 게시되지 않았습니다. 먼저 보낸 게시가 반영되어 공개 중입니다(사진 2장). 미리보기를 갱신해 다시 게시하거나 철회해 주세요.');
    await panel(page).locator('.blog-manager-current').scrollIntoViewIfNeeded(); await shot(page, 'r3m1-earlier-choice-review-1440');
    for (const [width, height] of [[820, 1180], [390, 844]]) {
      await page.setViewportSize({ width, height }); await panel(page).locator('.blog-manager-current').scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll at ' + width); await shot(page, 'r3m1-earlier-choice-review-' + width);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Publishing without a new preview sends nothing.
    await consentA4.check(); await publish(page);
    assert.equal(await statusLine(page), '공개 미리보기를 먼저 갱신해 주세요.'); assert.equal(sentPublish(a4.remoteId).length, 0);
    await click(page, '공개 검토 닫기');
    // It stays in the list and in 글 정보 until the owner acts; the device sends nothing by itself.
    assert.equal(await mark(page, a4.doc.id), '공개 중 · 마지막 선택 미반영');
    await cycle(page); await cycle(page);
    assert.equal(await mark(page, a4.doc.id), '공개 중 · 마지막 선택 미반영'); assert.equal(sentPublish(a4.remoteId).length, 0); assert.equal(sentUnpublish(a4.remoteId).length, 0);
    await shot(page, 'r3m1-earlier-choice-list-1440');
    await openPost(page, a4.doc.id, a4.doc.title); assert.equal((await settledPill(page)).state, 'public');
    sheet = await openInfo(page); assert.match(await sheet.locator('.photo-public-unapplied[data-notice="earlier_choice_public"]').innerText(), noticeA4);
    await page.setViewportSize({ width: 390, height: 844 }); await shot(page, 'r3m1-earlier-choice-info-390'); await page.setViewportSize({ width: 1440, height: 1000 });
    await closeInfo(page);
    await visit(visitor.page, new URL('blog.html?post=' + publication(a4.remoteId).token, base + '/').href, 'published');
    assert.equal(await visitor.page.locator('#blogContent img').count(), 2, 'visitors read the earlier choice meanwhile');
    // The owner reviews against what is public and publishes the choice without photos: the notice ends.
    await manager(page); await openReview(page, a4.doc.id);
    assert.equal(await panel(page).locator('.blog-manager-current').getAttribute('data-notice'), 'earlier_choice_public');
    await preview(page, { selected: [] }); await publish(page); await publishedLink(page).waitFor();
    assert.deepEqual({ active: publication(a4.remoteId).active, photos: publication(a4.remoteId).photos, revision: publication(a4.remoteId).revision }, { active: true, photos: 0, revision: 2 });
    assert.equal(await panel(page).locator('.blog-manager-current').getAttribute('data-notice'), ''); await click(page, '공개 검토 닫기');
    assert.equal(await mark(page, a4.doc.id), '공개 중');
    await visit(visitor.page, new URL('blog.html?post=' + publication(a4.remoteId).token, base + '/').href, 'published'); assert.equal(await visitor.page.locator('#blogContent img').count(), 0);
    pass('R3-M1: when the withdrawal that ends the earlier request fails and that request becomes public, the review, the list and 글 정보 keep saying so with the photo count, the stale preview and consent end, and the next publication ends it');

    // ---- Round five, item 5: the photo-count read of that notice is slow -----------------------------------
    // The settlement holds the post's lock while it reads the public copy anonymously; a publish
    // pressed in the same tab meanwhile waits for that lock (10 s). The read has its own short
    // limit, so the press is answered for this tab's own state, never as "another tab".
    const d5 = await savedPost(page, '사진 수 읽기가 느린 글', files);
    await manager(page); await openReview(page, d5.doc.id); await preview(page, { selected: d5.doc.photos.map(photo => photo.id), name: '익명 검수' });
    replacedRequest = await neverArrives(owner.context, 'life_blog_publish_copies'); await publish(page); await replacedRequest.stop();
    await preview(page, { selected: [] });
    const endingD5 = await neverArrives(owner.context, 'life_blog_unpublish'); await publish(page); await endingD5.stop();
    assert.equal(await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).isChecked(), true);
    assert.equal(server.rpc(accounts.a.id, 'life_blog_publish_copies', replacedRequest.bodies[0]).status, 'stored');
    const slowRead = { seen: 0, answered: 0 };
    const slow = async route => { slowRead.seen++; await new Promise(done => setTimeout(done, 12000)); slowRead.answered++; await route.fallback().catch(() => {}); };
    await owner.context.route(rpcPath('life_blog_public_read'), slow);
    await kick(page); await until(() => slowRead.seen, value => value >= 1, 'the settlement reads the public copy');
    const pressedD5 = Date.now();
    await publish(page);
    report.slowCountRead = { answerMs: Date.now() - pressedD5, line: await statusLine(page) };
    assert.doesNotMatch(await statusLine(page), /다른 탭에서 처리 중/, 'the press is not told to wait for another tab');
    assert.equal(await statusLine(page), '글이나 공개 상태가 이 미리보기와 달라졌습니다. 공개 미리보기를 갱신해 현재 상태를 확인한 뒤 다시 게시해 주세요.');
    assert.equal(slowRead.answered, 0, 'answered before the slow read would have ended');
    await until(() => panel(page).locator('.blog-manager-current').getAttribute('data-notice'), value => value === 'earlier_choice_public', 'the notice is recorded without the count');
    assert.match((await current(page)).text, /마지막으로 고른 내용은 게시되지 않았습니다\. 먼저 보낸 게시나 다른 게시가 반영되어 공개 중입니다\. 미리보기를 갱신해/);
    assert.equal(sentPublish(d5.remoteId).length, 0); assert.equal(sentUnpublish(d5.remoteId).length, 0, 'the device sent nothing by itself');
    await owner.context.unroute(rpcPath('life_blog_public_read'), slow);
    await click(page, '공개 검토 닫기');
    pass('round five: a slow photo-count read of the notice ends by its own limit inside the post lock; a publish pressed meanwhile in the same tab is answered for its own state, and the notice is said without the count');

    // ---- R4-M1: the new choice is pressed with no connection (every request to the project fails), then the earlier request arrives ----
    const offlineChoice = async (title, cutRequests) => {
      const made = await savedPost(page, title, files);
      await manager(page); await openReview(page, made.doc.id); await preview(page, { selected: made.doc.photos.map(photo => photo.id), name: '익명 검수' });
      const first = await neverArrives(owner.context, 'life_blog_publish_copies'); await publish(page); await first.stop();
      await preview(page, { selected: [] });
      const stop = await cutRequests(); await publish(page); const tried = await stop();
      assert.match(await statusLine(page), /^이번 공개 게시 요청은 보내지 못했습니다\. 앞서 보낸 요청의 결과는 아직 확인하지 못했습니다/, 'never "공개 상태는 바뀌지 않았습니다": the earlier request can still arrive');
      assert(tried >= 1, 'the press tried the connection');
      assert.equal(sentPublish(made.remoteId).length, 0); assert.equal(sentUnpublish(made.remoteId).length, 0, 'nothing was sent');
      assert.equal((await state(page, made.doc.id)).choiceUnsent?.operationId, first.bodies[0].p_operation_id, 'the earlier request is named on this device');
      const consent = page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true });
      assert.equal(await consent.isChecked(), true, 'a connection failure keeps the reviewed preview');
      assert.equal(server.rpc(accounts.a.id, 'life_blog_publish_copies', first.bodies[0]).status, 'stored');
      await kick(page); await until(() => publicStatus(page, made.doc.id), value => value === 'public', 'the cycle reads the publication');
      await until(() => panel(page).locator('.blog-manager-current').getAttribute('data-notice'), value => value === 'earlier_choice_public', 'the open review names it');
      assert.match((await current(page)).text, /현재 공개 상태: 공개 중/);
      assert.match((await current(page)).text, /마지막으로 고른 내용은 게시되지 않았습니다\. 먼저 보낸 게시가 반영되어 공개 중입니다\(사진 2장\)\. 미리보기를 갱신해 다시 게시하거나 철회해 주세요/);
      assert.equal(await consent.isChecked(), false, 'the consent ends with the preview');
      assert.match(await panel(page).locator('.blog-manager-public-preview').innerText(), /이 미리보기는 게시되지 않았습니다/);
      // The status line no longer says that nothing changed: it says what is public, with the count.
      assert.equal(await statusLine(page), '“' + title + '”: 마지막으로 고른 내용은 게시되지 않았습니다. 먼저 보낸 게시가 반영되어 공개 중입니다(사진 2장). 미리보기를 갱신해 다시 게시하거나 철회해 주세요.');
      await consent.check(); await publish(page);
      assert.equal(await statusLine(page), '공개 미리보기를 먼저 갱신해 주세요.'); assert.equal(sentPublish(made.remoteId).length, 0);
      await click(page, '공개 검토 닫기');
      assert.equal(await mark(page, made.doc.id), '공개 중 · 마지막 선택 미반영');
      await cycle(page); assert.equal(sentPublish(made.remoteId).length, 0); assert.equal(sentUnpublish(made.remoteId).length, 0, 'the device publishes and withdraws nothing by itself');
      await visit(visitor.page, new URL('blog.html?post=' + publication(made.remoteId).token, base + '/').href, 'published');
      assert.equal(await visitor.page.locator('#blogContent img').count(), 2, 'visitors read the earlier choice meanwhile');
      // Publishing the choice again from a new preview ends it.
      await openReview(page, made.doc.id); await preview(page, { selected: [] }); await publish(page); await publishedLink(page).waitFor();
      assert.deepEqual({ active: publication(made.remoteId).active, photos: publication(made.remoteId).photos, revision: publication(made.remoteId).revision }, { active: true, photos: 0, revision: 2 });
      assert.equal(await panel(page).locator('.blog-manager-current').getAttribute('data-notice'), ''); assert.equal((await state(page, made.doc.id)).choiceUnsent ?? null, null);
      await click(page, '공개 검토 닫기'); assert.equal(await mark(page, made.doc.id), '공개 중');
      return made;
    };
    // Offline: the account check, the first request of the attempt, fails like every other.
    let offlineTried = 0;
    const offlineRoute = route => { offlineTried++; return route.abort('internetdisconnected'); };
    await offlineChoice('연결 없이 사진을 뺀 글', async () => {
      offlineTried = 0; offlineCut.on = true; await owner.context.route(cloud + '/**', offlineRoute);
      return async () => { await owner.context.unroute(cloud + '/**', offlineRoute); offlineCut.on = false; return offlineTried; };
    });
    // Only the exact post read fails (the account check works).
    await offlineChoice('글 읽기만 막힌 글', async () => {
      let tried = 0; const handler = route => { tried++; return route.abort('failed'); };
      await owner.context.route(rpcPath('life_blog_read'), handler);
      return async () => { await owner.context.unroute(rpcPath('life_blog_read'), handler); return tried; };
    });
    pass('R4-M1: a new choice pressed offline, or while the post head cannot be read, names the earlier request on the device; when that request becomes public the review, the status line and the list say so with the photo count, the stale preview and consent end, nothing is sent by the device, and publishing again ends it');

    // A conflict that is not this device's earlier request: nothing is sent again, and the screen says what is public.
    const x = await savedPost(page, '다른 기기 경합 글', files);
    await manager(page); await openReview(page, x.doc.id); await preview(page, { selected: [], name: '익명 검수' });
    flying = await inFlight(owner.context, 'life_blog_publish');
    await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click(); const heldBody = await flying.arrived;
    assert.equal(server.rpc(accounts.a.id, 'life_blog_publish', { ...heldBody, p_operation_id: require('node:crypto').randomUUID(), p_author: { name: '다른 기기', intro: '' } }).status, 'stored');
    await flying.release(); await idle(page);
    assert.match(await statusLine(page), /공개 내용이 그사이 다른 요청으로 바뀌어 이 게시는 적용하지 못했습니다\. 지금 공개 중인 사본에는 사진이 0장 있습니다\. 미리보기를 갱신한 뒤 다시 게시하거나 철회해 주세요/);
    assert.doesNotMatch(await statusLine(page), /다른 기기에서 먼저 바뀐 글/);
    assert.equal(await publishedLink(page).count(), 0); assert.equal(await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).isChecked(), false, 'the consent ends with the preview');
    assert.match(await panel(page).locator('.blog-manager-public-preview').innerText(), /이 미리보기는 게시되지 않았습니다/);
    assert.equal((await current(page)).state, 'public'); assert.equal(publication(x.remoteId).author.name, '다른 기기'); assert.equal(sentPublish(x.remoteId).length, 1);
    await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check(); await publish(page);
    assert.equal(await statusLine(page), '공개 미리보기를 먼저 갱신해 주세요.'); assert.equal(sentPublish(x.remoteId).length, 1);
    await click(page, '공개 철회', panel(page)); await click(page, '공개 검토 닫기');
    pass('M3: before anything is public a changed choice ends the earlier request first; an update that arrives first is followed by the new choice once more; another request\'s conflict ends the preview and says what is public');

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
    // m2: what the owner typed meanwhile is kept; only untouched fields take the values read.
    await page.getByRole('textbox', { name: '공개 소개', exact: true }).fill('직접 고친 소개');
    await click(page, '공개 이름·소개 다시 읽기', panel(page));
    assert.equal(await page.getByRole('textbox', { name: '공개 이름', exact: true }).inputValue(), '익명B');
    assert.equal(await page.getByRole('textbox', { name: '공개 소개', exact: true }).inputValue(), '직접 고친 소개', 'the typed intro is not overwritten');
    assert.match(await statusLine(page), /직접 입력한 칸은 그대로 두었습니다/);
    await preview(page); await publish(page); await publishedLink(page).waitFor(); await click(page, '공개 검토 닫기');
    assert.deepEqual(profile(), { name: '익명B', intro: '직접 고친 소개' });
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
