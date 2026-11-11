/* Actual UI → shared SDK/IndexedDB → actual Edge handlers → isolated PostgreSQL
 * → anonymous public reader. Auth/Storage HTTP uses synthetic fixtures only.
 * BASE_URL=http://127.0.0.1:4173 BLOG_POSTGRES_CONTAINER=haedo-blog-postgres-...
 * BLOG_POSTGRES_DATABASE=haedo_blog_qa_... node tests/post-markdown-publish-browser.cjs
 * --prepare-database creates a fresh isolated DB; it refuses an existing name. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { openBlogMenu } = require('./helpers/feature-menus.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { MarkdownPublishCloud, syntheticSession, SESSION_IDS } = require('./helpers/post-markdown-publish-cloud.cjs');
const output = path.resolve(__dirname, '../.local/post-markdown-publish');
const report = { checks: [], consoleErrors: [], pageErrors: [], external: [], expectedTransportErrors: [],
  scope: 'Actual app/SDK/IndexedDB, publication/media Edge code and isolated PostgreSQL. Synthetic Auth and Storage HTTP; no hosted account, operation, deployment or Apple device.' };
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
  for (const file of ['assets/life/blog.js', 'assets/life/post-markdown.js', 'assets/life/blog-remote.js', 'assets/life/blog-sync.js', 'assets/life/blog-manager.js']) {
    const response = await fetch(base + '/' + file); assert(response.ok);
    const actual = Buffer.from(await response.arrayBuffer()), expected = await fs.readFile(path.resolve(__dirname, '..', file));
    const sha = value => createHash('sha256').update(value).digest('hex');
    assert.equal(sha(actual), sha(expected), 'Serve this exact checkout: ' + file); report.sources.push({ file, sha256: sha(expected) });
  }
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); const contexts = [];
  async function device(name, width, account = accounts.a) {
    const context = await makeContext(browser, server, name, account, { viewport: { width, height: 1000 } }); contexts.push(context);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
      report.external.push(url.origin); return route.abort();
    });
    if (!account) await context.addInitScript(() => {
      for (const key of ['indexedDB', 'localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw Error('Anonymous reader must not open private storage: ' + key); } });
    });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    page.on('console', event => {
      if (event.type() !== 'error') return;
      const entry = { name, message: event.text(), url: event.location().url };
      if (entry.url.startsWith(cloud) && (server.expectedFailures && /Failed to load resource:.*ERR_FAILED/.test(entry.message) || server.expectedAuthFailure && /Failed to load resource:.*401/.test(entry.message))) report.expectedTransportErrors.push(entry);
      else report.consoleErrors.push(entry);
    });
    if (account) {
      await page.goto(base + '/index.html'); await ready(page);
      await page.evaluate(async value => { const result = await HaedoAuth.client.auth.setSession(value); if (result.error) throw result.error; await HaedoAuth.verify(); }, syntheticSession(account));
    }
    return { page, context, name };
  }
  async function seed(page, label) {
    return page.evaluate(async label => {
      const L = HaedoLife, s = L.Shell.storage, ws = await s.getActive(), P = L.PhotoPost, photos = [];
      for (const [name, color] of [['A 빨강', '#dc1e1e'], ['B 초록', '#1eb43c']]) {
        const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 16;
        canvas.getContext('2d').fillStyle = color; canvas.getContext('2d').fillRect(0, 0, 24, 16);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        photos.push(await P.readPhoto(new File([blob], name + '.png', { type: 'image/png' }), L.Core.id));
      }
      const v2 = P.create(L.Core.id); v2.title = '서버 Markdown 공개 검수 ' + label; v2.status = 'saved'; v2.photos = photos;
      v2.ops = [{ insert: '직접 쓴 첫 문단\n' }, { insert: 'AI 도움 문장', attributes: { author: 'ai', bold: true } }, { insert: '\n' },
        { insert: { photo: { id: photos[1].id, caption: 'B 초록 설명', alt: 'B 초록 사진' } } },
        { insert: '사진 사이\n' }, { insert: { photo: { id: photos[0].id, caption: 'A 빨강 설명', alt: 'A 빨강 사진' } } }, { insert: '\n끝 문단\n' }];
      const md = L.PostMarkdown.fromV2(v2).document; md.photos = photos;
      const saved = await s.savePhotoPost(ws, md, 0), sync = L.BlogSync.create({ storage: s, auth: HaedoAuth });
      try { await sync.saveDefault(ws, saved.id, { expectedLocalRevision: saved.revision }); } finally { sync.dispose(); }
      const doc = await s.readPhotoPost(ws, saved.id), state = await s.readBlogSyncState(ws, saved.id);
      return { ws, id: doc.id, photoIds: photos.map(photo => photo.id), private: L.Blog.pack(doc), state };
    }, label);
  }
  async function manager(page, id) {
    await openBlogMenu(page); await page.getByRole('button', { name: '글 공개·보관', exact: true }).click();
    await page.locator('.blog-manager-list[data-state="ready"]').waitFor();
    await page.locator('.blog-post[data-post-id="' + id + '"]').getByRole('button', { name: '공개 내용 검토', exact: true }).click();
    await page.locator('.blog-manager-preview').waitFor();
  }
  async function preview(page, selected = []) {
    for (const checkbox of await page.locator('[data-photo-id]').all()) await checkbox.setChecked(selected.includes(await checkbox.getAttribute('data-photo-id')));
    await page.getByRole('button', { name: '공개 미리보기 갱신', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.blog-manager[aria-busy="true"]'));
    await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check();
  }
  async function publish(page) {
    await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.blog-manager[aria-busy="true"]'));
  }
  const state = (page, f) => page.evaluate(({ ws, id }) => HaedoLife.Shell.storage.readBlogSyncState(ws, id), f);
  const read = f => server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: f.state.remoteId });
  async function publicPage(page, url) { await page.goto(url); await page.waitForFunction(() => document.querySelector('#blogStatus')?.dataset.state === 'published'); }
  async function unchanged(page, f) { assert.deepEqual(await page.evaluate(async ({ ws, id }) => HaedoLife.Blog.pack(await HaedoLife.Shell.storage.readPhotoPost(ws, id)), f), f.private); }
  const pass = name => { report.checks.push({ name, pass: true }); console.log('PASS ' + name); };
  try {
    for (const width of [390, 1440]) {
      const owner = await device('md-owner-' + width, width), visitor = await device('md-visitor-' + width, width, null), page = owner.page;
      const f = await seed(page, String(width)); assert.equal(f.state.status, 'synced');
      await manager(page, f.id);
      assert.equal(await page.locator('[data-photo-id]:checked').count(), 0);
      await preview(page); await publish(page);
      const link = page.getByRole('link', { name: '공개한 글 열기', exact: true }); await link.waitFor(); const url = await link.getAttribute('href');
      const token = new URL(url).searchParams.get('post'), first = server.rpc(null, 'life_blog_public_read', { p_token: token });
      assert.deepEqual(first.snapshot.photos, []); assert(!JSON.stringify(first.snapshot).includes('"author":"ai"'));
      assert(first.snapshot.ops.some(op => typeof op.insert === 'string' && op.insert.includes('AI 도움 문장')));
      assert.equal(first.snapshot.ops.find(op => op.insert.includes?.('AI 도움 문장')).attributes.bold, true);
      await publicPage(visitor.page, url); assert.equal(await visitor.page.locator('#blogContent img,.blog-ai-text').count(), 0);
      assert.match(await visitor.page.locator('#blogContent').innerText(), /AI 도움 문장/);
      await unchanged(page, f); pass(width + ': explicit zero-photo publication projects stored Markdown and hides AI marks without removing text');

      await preview(page, f.photoIds); server.losePublishAck = true; await publish(page);
      const pending = (await state(page, f)).publishPending; assert(pending); assert.equal(pending.documentFormat, 'life-post-md-v1');
      const committed = server.rpc(null, 'life_blog_public_read', { p_token: token }); assert.equal(committed.revision, first.revision + 1);
      await publish(page); assert.equal(await link.getAttribute('href'), url);
      assert.equal((await state(page, f)).publishPending, null);
      const calls = server.edgeRequests.filter(item => item.body.p_operation_id === pending.operationId);
      assert.equal(calls.length, 2); assert.deepEqual(calls[0].body, calls[1].body);
      assert.deepEqual(server.rpc(null, 'life_blog_public_read', { p_token: token }), committed);
      assert.equal(committed.snapshot.photos.length, 2);
      assert(committed.snapshot.photos.every(photo => !f.private.photos.some(original => original.digest === photo.digest)));
      assert.deepEqual(Object.keys(calls[0].body.p_copies).sort(), [...f.photoIds].sort());
      await publicPage(visitor.page, url);
      await visitor.page.waitForFunction(() => [...document.querySelectorAll('#blogContent img')].length === 2 && [...document.querySelectorAll('#blogContent img')].every(img => img.complete && img.naturalWidth === 24));
      const actual = await visitor.page.locator('#blogContent figure').evaluateAll(figures => figures.map(figure => ({ alt: figure.querySelector('img').alt, caption: figure.querySelector('figcaption').textContent })));
      assert.deepEqual(actual, [{ alt: 'B 초록 사진', caption: 'B 초록 설명' }, { alt: 'A 빨강 사진', caption: 'A 빨강 설명' }]);
      const media = await visitor.page.locator('#blogContent img').evaluateAll(async images => Promise.all(images.map(async img => {
        const response = await fetch(img.src, { credentials: 'omit', cache: 'no-store' }), blob = await response.blob(), image = await createImageBitmap(blob);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 1, 1); image.close();
        const bytes = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return { pixel: [...ctx.getImageData(0, 0, 1, 1).data], digest: [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join(''), cache: response.headers.get('cache-control') };
      })));
      assert.deepEqual(media.map(item => item.pixel), [[30, 180, 60, 255], [220, 30, 30, 255]]);
      assert.deepEqual(media.map(item => item.digest), committed.snapshot.ops.filter(op => typeof op.insert !== 'string').map(op => committed.snapshot.photos.find(photo => photo.id === op.insert.photo.id).digest));
      assert(media.every(item => item.cache.includes('no-store')));
      const expectedSnapshot = await page.evaluate(async ({ f, wire, actual }) => {
        const doc = await HaedoLife.Shell.storage.readPhotoPost(f.ws, f.id);
        const snapshot = HaedoLife.Blog.publicSnapshot(doc, { photoIds: wire.p_photo_ids, author: wire.p_author,
          copies: Object.entries(wire.p_copies).map(([id, metadata]) => ({ id, ...metadata })) });
        const ids = new Map(snapshot.photos.map((photo, index) => [photo.id, actual.photos[index].id]));
        for (const photo of snapshot.photos) photo.id = ids.get(photo.id);
        for (const op of snapshot.ops) if (typeof op.insert !== 'string') op.insert.photo.id = ids.get(op.insert.photo.id);
        return snapshot;
      }, { f, wire: calls[0].body, actual: committed.snapshot });
      assert.deepEqual(committed.snapshot, expectedSnapshot, 'server projection equals actual client projection with only SQL-assigned IDs substituted');
      await unchanged(page, f);
      assert.equal(await visitor.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await visitor.page.screenshot({ path: path.join(output, 'anonymous-' + width + '.png'), fullPage: true });
      await page.screenshot({ path: path.join(output, 'manager-' + width + '.png'), fullPage: true });
      pass(width + ': selected sanitized copies keep body order/captions; lost ACK retries exact durable intent once');

      await preview(page); server.expectedAuthFailure = true;
      const commitsBeforeAuth = server.edgeFetches.filter(call => /publish_commit$/.test(call.path)).length;
      const authsBefore = server.edgeFetches.filter(call => call.path === '/auth/v1/user').length;
      server.failAuthAfterPrepare = true; await publish(page);
      assert.equal(server.edgeFetches.filter(call => call.path === '/auth/v1/user').length, authsBefore + 2, 'publication re-verifies Auth immediately before commit');
      assert.equal(server.edgeFetches.filter(call => /publish_commit$/.test(call.path)).length, commitsBeforeAuth, 'revoked Auth prevents service commit entirely');
      assert.deepEqual(server.rpc(null, 'life_blog_public_read', { p_token: token }), committed);
      assert((await state(page, f)).publishPending);
      pass(width + ': Auth revoked after preparation is checked again and prevents any service commit');

      server.beforeCommit = () => server.sql("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='" + SESSION_IDS[accounts.a.id] + "'; select 'true'::jsonb;");
      await publish(page);
      server.expectedAuthFailure = false;
      assert.deepEqual(server.rpc(null, 'life_blog_public_read', { p_token: token }), committed, 'revocation between prepare and commit must not replace the publication');
      assert((await state(page, f)).publishPending, 'refused commit keeps its durable retry intent');
      server.sql("update auth.sessions set not_after='2099-01-01' where id='" + SESSION_IDS[accounts.a.id] + "'; select 'true'::jsonb;");
      await publish(page);
      assert.equal(server.rpc(null, 'life_blog_public_read', { p_token: token }).revision, committed.revision + 1);
      await unchanged(page, f);
      pass(width + ': SQL rejects a session revoked after preparation, keeps the public copy unchanged and permits an exact retry');

      await preview(page); const gate = server.holdPublicationAck(); await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click();
      let timer;
      try { await Promise.race([gate.entered.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Publication ACK gate not reached')), 20000); })]); }
      finally { clearTimeout(timer); }
      await page.evaluate(async value => { const result = await HaedoAuth.client.auth.setSession(value); if (result.error) throw result.error; await HaedoAuth.verify(); }, syntheticSession(accounts.b));
      gate.release.resolve(); await page.waitForFunction(() => HaedoAuth.user?.id === HaedoAuth.session?.user?.id);
      assert.equal(await page.getByRole('link', { name: '공개한 글 열기', exact: true }).count(), 0, 'a late response cannot announce account A publication in account B');
      assert.equal(server.rpc(accounts.b.id, 'life_blog_read', { p_post_id: f.state.remoteId }), null);
      assert.equal(read(f).data.markdown, f.private.markdown);
      pass(width + ': an ACK delivered after account switch cannot leak private content or report success in the new account');
      await owner.context.close(); await visitor.context.close();
    }
    assert(server.edgeFetches.some(call => call.path === '/auth/v1/user'));
    assert(server.edgeFetches.some(call => call.service && /publish_commit$/.test(call.path)));
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []);
    report.pass = true;
  } finally {
    await Promise.allSettled(contexts.map(context => context.close())); await browser.close();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
