/* Materials → exact citations → finished PhotoPost → selected public copy →
 * preservation file. Actual UI/SDK/IndexedDB and isolated PostgreSQL RPCs;
 * synthetic Auth and Storage binary/Edge transport only. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4214';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { LocalSQLBlogCloud, digest } = require('./blog-completion-browser.cjs');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const ZIP = require('../vendor/fflate/fflate.js');
const output = path.resolve(__dirname, '../.local/material-writing');

async function seedMaterials(page) {
  return page.evaluate(async () => {
    const C = HaedoLife.Core, s = HaedoLife.Shell.storage, workspaceId = await s.getActive();
    const initial = await s.read(workspaceId); let bundle = initial;
    const firstRaw = '\ufeff🌱 여행의 시작\r\n👨‍👩‍👧‍👦 같은 풍경을 천천히 읽었다\r\n다시 걷고 싶은 길\r\nPRIVATE_FULL_BODY_NOT_PUBLIC';
    const firstQuote = '👨‍👩‍👧‍👦 같은 풍경을 천천히 읽었다\r\n다시 걷고 싶은 길';
    async function imported(input) {
      const value = await C.prepareImport({ origin: 'obsidian', author: '익명 자료 작성자', authorRelation: 'other', ...input }, bundle);
      bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, value)); return value;
    }
    const first = await imported({ title: '같은 여행 자료', text: firstRaw, url: 'https://example.org/material-first', fileName: '첫 자료.md' });
    const latest = await imported({ title: '같은 여행 자료', text: 'LATEST_MUST_NOT_REPLACE_OLD', existingSourceId: first.source.id });
    const secondRaw = '두 번째 관찰\n🌊 길 위에서 서로 다른 생각이 만났다\nSECOND_UNQUOTED_BODY';
    const secondQuote = '🌊 길 위에서 서로 다른 생각이 만났다';
    const second = await imported({ title: '같은 여행 자료', text: secondRaw, url: 'https://example.org/material-second', fileName: '둘째 자료.md' });
    const link = await imported({ title: '본문 없는 여행 링크', text: '', url: 'https://example.org/material-link-only' });
    const commit = await s.commitLocal({ workspaceId, baseRevision: initial.revision, operationId: C.id(), changes: { put: { sources: bundle.sources, sourceVersions: bundle.sourceVersions } } });
    assertResult(commit.status === 'stored', 'synthetic source commit failed');
    function assertResult(value, message) { if (!value) throw Error(message); }
    return { workspaceId, first: { sourceId: first.source.id, versionId: first.version.id, raw: firstRaw, quote: firstQuote },
      latestId: latest.version.id, second: { sourceId: second.source.id, versionId: second.version.id, raw: secondRaw, quote: secondQuote },
      link: { sourceId: link.source.id, versionId: link.version.id } };
  });
}
async function enter(page, planId) {
  await page.goto(base + '/index.html?section=records&view=page'); await ready(page);
  await page.locator('#wbPageMaterialWriting').click(); await page.locator('#mwNew').waitFor();
  if (planId) { await page.locator('#mwPlanSelect').selectOption(planId); await page.locator('#mwTitle').waitFor(); }
}
async function saved(page) { await page.locator('.mw-status[data-state="saved"]').waitFor(); }
async function readPreparation(page) { return page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.readMaterialWriting(await s.getActive()); }); }
async function addMaterial(page, source, title) {
  await page.locator('.mw-source-search').fill(title);
  await page.locator('.mw-source-candidate[data-source-id="' + source.sourceId + '"]').click();
  await page.locator('.mw-candidate-version').selectOption(source.versionId); await page.locator('.mw-material-add').click();
  await page.waitForFunction(() => !document.querySelector('.mw-material-add'));
  await saved(page);
  const state = await readPreparation(page), selected = await page.locator('#mwPlanSelect').inputValue();
  return state.plans.find(p => p.id === selected).materials.find(m => m.sourceId === source.sourceId && m.sourceVersionId === source.versionId).id;
}
async function quoteMaterial(page, materialId, quote) {
  const previous = await page.locator('#mwBlocks [data-kind="quote"]').count();
  await page.locator('.mw-material-tab[data-material-id="' + materialId + '"]').click();
  const card = page.locator('.mw-material[data-material-id="' + materialId + '"]');
  await card.locator('.mw-material-body').evaluate((node, raw) => {
    const text = raw.replace(/\r\n?/g, '\n'), start = node.value.indexOf(text);
    if (start < 0) throw Error('Exact fixture quote missing');
    node.focus(); node.setSelectionRange(start, start + text.length); node.dispatchEvent(new Event('select', { bubbles: true }));
  }, quote);
  await card.locator('.mw-quote-apply').click();
  await page.waitForFunction(count => document.querySelectorAll('#mwBlocks [data-kind="quote"]').length === count, previous + 1); await saved(page);
}
async function seedPlan(page, fixture, title = '경계 검수용 준비') {
  return page.evaluate(async ({ f, title }) => {
    const s = HaedoLife.Shell.storage, C = HaedoLife.Core, M = HaedoLife.MaterialWriting, R = HaedoLife.SourceReference;
    const state = await s.readMaterialWriting(f.workspaceId), bundle = await s.read(f.workspaceId), plan = M.create(C.id);
    plan.title = title; plan.question = 'PRIVATE_QUESTION_SENTINEL';
    for (const source of [f.first, f.second]) {
      const material = M.material(bundle, source.sourceId, source.versionId, C.id); material.note = 'PRIVATE_NOTE_SENTINEL'; plan.materials.push(material);
      const start = source.raw.indexOf(source.quote), reference = await R.build({ bundle, sourceId: source.sourceId, versionId: source.versionId, locator: { start, end: start + source.quote.length } });
      plan.blocks.push({ id: C.id(), kind: 'quote', materialId: material.id, reference });
    }
    plan.blocks.unshift({ id: C.id(), kind: 'paragraph', text: '직접 쓴 나의 생각\n' }); state.plans.push(plan);
    await s.saveMaterialWriting(f.workspaceId, state, state.revision); return plan.id;
  }, { f: fixture, title });
}
async function snapshot(page, workspaceId) {
  return page.evaluate(async requested => {
    const s = HaedoLife.Shell.storage, workspaceId = requested || await s.getActive(), bundle = await s.read(workspaceId), posts = [];
    for (const row of await s.listPhotoPosts(workspaceId)) {
      const doc = await s.readPhotoPost(workspaceId, row.id), photos = [];
      for (const { blob, ...meta } of doc.photos) {
        const bitmap = await createImageBitmap(blob); photos.push({ ...meta, actualHash: await HaedoLife.PhotoPost.digest(blob), actualWidth: bitmap.width, actualHeight: bitmap.height }); bitmap.close();
      }
      posts.push({ doc: { ...doc, photos }, evidence: await s.readPostEvidence(workspaceId, row.id), sync: await s.readBlogSyncState(workspaceId, row.id) });
    }
    return { workspaceId, bundle, posts, preparation: await s.readMaterialWriting(workspaceId), spaces: await s.listWorkspaces() };
  }, workspaceId);
}

async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)); await fs.mkdir(output, { recursive: true });
  const server = new LocalSQLBlogCloud({ container: process.env.BLOG_POSTGRES_CONTAINER, database: process.env.BLOG_POSTGRES_DATABASE });
  if (process.argv.includes('--prepare-database')) {
    server.docker(['exec', '-i', server.container, 'createdb', '-U', 'postgres', server.database]);
    const files = await Promise.all(['supabase/tests/blog-bootstrap.sql', 'supabase/migrations/20261017144744_life_blog_originals.sql'].map(file => fs.readFile(path.resolve(__dirname, '..', file), 'utf8')));
    server.docker(['exec', '-i', server.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', server.database], files.join('\n'));
  }
  await server.initialize();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, sourceLoads: [], browser: browser.version(),
    scope: 'Actual UI/SDK/IndexedDB and local PostgreSQL RPC/RLS. Synthetic Auth/Storage binary/Edge only; no real Google, Apple hardware, production access or deployment.' };
  const contexts = []; let page;
  function observe(p) {
    p.setDefaultTimeout(20000); p.on('pageerror', e => report.pageErrors.push(e.message)); p.on('console', e => { if (e.type() !== 'error') return;
      if (e.location().url.startsWith(cloud + '/functions/v1/haedo-blog-media') && /404/.test(e.text())) report.expectedErrors++; else report.consoleErrors.push(e.text()); });
  }
  async function device(name, account = accounts.a) {
    const context = await makeContext(browser, server, name, account, { viewport: { width: 1440, height: 1000 } }); contexts.push(context);
    context.on('page', observe);
    await context.route(/\/assets\/life\/(?:workbench-ui|storage|material-writing|material-writing-sources)\.js$/, async route => {
      const response = await route.fetch(), bytes = await response.body(); report.sourceLoads.push({ device: name, path: new URL(route.request().url()).pathname, sha256: digest(bytes) }); await route.fulfill({ response, body: bytes });
    });
    await context.route(base + '/assets/life/material-writing-ui.js', async route => {
      const response = await route.fetch(), source = await response.text();
      report.sourceLoads.push({ device: name, path: '/assets/life/material-writing-ui.js', sha256: digest(Buffer.from(source)), fixtureFaultHook: true });
      // Fail only the editor-open callback AFTER the actual committed handoff.
      // The real UI, account storage, transactions and returned receipt remain.
      const hook = `;(()=>{const original=HaedoLife.MaterialWritingUI;HaedoLife.MaterialWritingUI=Object.freeze({...original,create(options){return original.create({...options,onOpenPost:async(...values)=>{if(window.__mwSimulateOpenFailure)throw Object.assign(new Error('합성 저장 후 편집기 열기 실패'),{code:'synthetic_open_failure'});return options.onOpenPost(...values);}});}});})();`;
      await route.fulfill({ response, body: source + hook });
    });
    await context.route('**/*', route => { const origin = new URL(route.request().url()).origin; if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push(origin); return route.abort(); });
    const p = await context.newPage();
    return { page: p, context };
  }
  async function fixture(name) { const d = await device(name); await d.page.goto(base + '/index.html'); await ready(d.page); d.fixture = await seedMaterials(d.page); return d; }
  async function previewCreate(p) { await p.locator('#mwPreview').click(); await p.locator('#mwPreviewContent').waitFor(); await p.locator('#mwConsent').check(); await p.locator('#mwCreate').click(); }
  async function capture(p, scene) {
    for (const width of [1440, 390]) { await p.setViewportSize({ width, height: 1000 }); await p.evaluate(() => document.fonts.ready); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, scene); const file = scene + '-' + width + '.png'; await p.screenshot({ path: path.join(output, file), fullPage: true }); report.visual.push({ scene, width, file }); }
    await p.setViewportSize({ width: 1440, height: 1000 });
  }
  async function check(name, run) { console.log('START ' + name); await run(); report.checks.push(name); console.log('PASS ' + name); }
  try {
    const owner = await fixture('material-owner'); page = owner.page; const f = owner.fixture;
    let planId, finished, archive;
    await check('Exact old-version materials, private notes/questions and ordered authored blocks survive reopening and a single handoff', async () => {
      await enter(page); await page.locator('#mwNew').click(); await page.locator('#mwTitle').fill('자료를 비교해 완성한 여행글'); await page.locator('#mwQuestion').fill('PRIVATE_QUESTION_SENTINEL');
      await page.locator('#mwAddHeading').click(); await page.locator('#mwBlocks [data-kind="heading"] textarea').fill('같은 풍경을 다르게 읽기');
      await page.locator('#mwAddParagraph').click(); await page.locator('#mwBlocks [data-kind="paragraph"] textarea').fill('두 자료를 비교하며 내가 새로 생각한 문단🌱'); await saved(page);
      const a = await addMaterial(page, f.first, '같은 여행 자료'), b = await addMaterial(page, f.second, '같은 여행 자료');
      await addMaterial(page, f.link, '본문 없는 여행 링크');
      await page.locator('.mw-material-tab[data-material-id="' + a + '"]').click();
      await page.locator('.mw-material[data-material-id="' + a + '"] .mw-material-note').fill('PRIVATE_NOTE_SENTINEL'); await saved(page);
      await page.locator('.mw-compare-select').selectOption(b); assert.equal(await page.locator('.mw-material-body').count(), 2); await capture(page, 'materials-compare');
      await quoteMaterial(page, a, f.first.quote); await quoteMaterial(page, b, f.second.quote);
      planId = await page.locator('#mwPlanSelect').inputValue(); const before = await readPreparation(page), plan = before.plans.find(p => p.id === planId);
      assert.equal(plan.materials.length, 3); assert.deepEqual(plan.blocks.map(b => b.kind), ['heading', 'paragraph', 'quote', 'quote']); assert.equal(plan.blocks[2].reference.quote, f.first.quote); assert.equal(plan.blocks[2].reference.sourceVersionId, f.first.versionId);
      assert.equal(server.blogRequests.length, 0); await enter(page, planId); assert.equal(await page.locator('#mwQuestion').inputValue(), 'PRIVATE_QUESTION_SENTINEL');
      assert.deepEqual(await readPreparation(page), before); await page.locator('#mwPreview').click(); const preview = await page.locator('#mwPreviewContent').innerText();
      assert(preview.includes('두 자료를 비교하며')); for (const text of ['PRIVATE_QUESTION_SENTINEL', 'PRIVATE_NOTE_SENTINEL', 'LATEST_MUST_NOT_REPLACE_OLD', 'PRIVATE_FULL_BODY_NOT_PUBLIC']) assert(!preview.includes(text), text);
      await capture(page, 'outline-preview'); await page.locator('#mwConsent').check(); await page.locator('#mwCreate').click(); await page.locator('#photoTitle').waitFor();
      const state = await snapshot(page); assert.equal(state.posts.length, 1); assert.equal(state.posts[0].evidence.refs.length, 2); assert.equal(state.posts[0].doc.ops.some(o => o.attributes?.header === 2), true);
      const prepared = state.preparation.plans.find(p => p.id === planId); assert.equal(prepared.output.postId, state.posts[0].doc.id);
      const repeat = await page.evaluate(async ({ ws, id, revision }) => HaedoLife.Shell.storage.createMaterialWritingPost(ws, id, revision), { ws: f.workspaceId, id: planId, revision: state.preparation.revision });
      assert.equal(repeat.created, false); assert.equal(repeat.postId, prepared.output.postId); assert.equal((await snapshot(page)).posts.length, 1);
    });
    await check('The handed-off PhotoPost accepts two original photos, saves/replaces its ID and resumes the same finished post from preparation', async () => {
      await page.evaluate(() => { const q = Quill.find(document.querySelector('.ql-container')); q.insertText(q.getLength() - 1, '\n완성 편집기에서 덧붙인 마지막 문단\n', 'user'); q.setSelection(q.getLength() - 1, 0, 'silent'); });
      const images = await page.evaluate(async () => {
        const rows = []; for (const [width, height, name] of [[4032, 3024, '익명 원본 풍경.png'], [1200, 1800, '익명 원본 세로.png']]) {
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const g = canvas.getContext('2d'); g.fillStyle = '#dae6e1'; g.fillRect(0, 0, width, height); g.fillStyle = '#203b32'; g.fillRect(50, 50, 260, 280);
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); rows.push({ name, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
        } return rows;
      });
      await page.locator('#photoFiles').setInputFiles(images.map(p => ({ name: p.name, mimeType: 'image/png', buffer: Buffer.from(p.bytes) }))); await page.locator('.photo-block').nth(1).waitFor();
      await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
      const savedTarget = (await readPreparation(page)).plans.find(p => p.id === planId).output.postId;
      await page.locator('#photoServerStatus[data-post-id="' + savedTarget + '"][data-state="synced"]').waitFor();
      const original = (await snapshot(page)).posts.find(p => p.doc.status === 'saved'); assert(original); assert.equal(original.doc.photos.length, 2);
      await page.getByRole('button', { name: '글 수정', exact: true }).click(); await page.locator('#photoTitle').fill('자료로 완성하고 다시 다듬은 여행글');
      await page.evaluate(() => Quill.find(document.querySelector('.ql-container')).insertText(0, '준비와 왕복해도 유지할 미완성 수정 문단🌱\n', 'user'));
      await page.waitForFunction(() => document.querySelector('.photo-status-text')?.textContent === '초안 보관됨');
      const pending = await snapshot(page), editing = pending.posts.find(p => p.doc.status === 'draft' && p.doc.replaces?.id === original.doc.id); assert(editing); assert.notEqual(editing.doc.id, original.doc.id);
      await page.locator('.photo-editor').getByRole('button', { name: '닫기', exact: true }).click(); await page.locator('#mwContinue').waitFor(); await page.locator('#mwContinue').click(); await page.locator('#photoTitle').waitFor();
      assert.equal(await page.locator('#photoTitle').inputValue(), editing.doc.title); assert.match(await page.locator('.ql-editor').innerText(), /준비와 왕복해도 유지할 미완성 수정 문단/);
      assert.deepEqual((await snapshot(page)).posts, pending.posts, 'Resuming must keep the exact existing editing draft and saved original without creating or rewriting a document');
      await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
      await page.locator('#photoServerStatus[data-post-id="' + editing.doc.id + '"][data-state="synced"]').waitFor();
      const after = await snapshot(page); finished = after.posts.find(p => p.doc.status === 'saved'); assert.equal(finished.doc.id, editing.doc.id); assert.notEqual(finished.doc.id, original.doc.id); assert.equal(after.posts.length, 1); assert.equal(finished.evidence.refs.length, 2);
      assert.equal(after.preparation.plans.find(p => p.id === planId).output.postId, finished.doc.id);
      for (const p of finished.doc.photos) { assert.equal(p.actualHash, p.digest); assert.equal(p.actualWidth, p.width); assert.equal(p.actualHeight, p.height); }
      await page.getByRole('button', { name: '작성 준비로 돌아가기', exact: true }).click(); await page.locator('#mwContinue').click(); await page.locator('.photo-article').waitFor(); assert.match(await page.locator('.photo-article').innerText(), /다시 다듬은 여행글/);
      await page.getByRole('button', { name: '작성 준비로 돌아가기', exact: true }).click(); await capture(page, 'finished-return');
      const beforeOrdinary = (await snapshot(page)).posts;
      await nav(page, 'home'); await page.locator('[data-home-destination="write"]:visible').click(); await page.locator('#photoTitle').waitFor();
      assert.equal(await page.locator('#photoTitle').inputValue(), ''); assert.equal((await page.locator('.ql-editor').innerText()).trim(), '');
      assert.equal(await page.getByRole('button', { name: '작성 준비로 돌아가기', exact: true }).count(), 0, 'A fresh ordinary writer must not inherit the previous material-preparation destination');
      await page.locator('.photo-editor').getByRole('button', { name: '닫기', exact: true }).click(); await settle(page); assert.deepEqual((await snapshot(page)).posts, beforeOrdinary);
      await enter(page, planId);
    });
    await check('Only the finished authored text and one explicit photo become anonymous; withdrawal blocks the public snapshot and original bytes', async () => {
      await page.locator('#mwManageOutput').click(); await page.locator('.blog-manager-list[data-state="ready"]').waitFor();
      await page.locator('.blog-post[data-post-id="' + finished.doc.id + '"]').getByRole('button', { name: '공개 내용 검토', exact: true }).click();
      await page.locator('input[data-photo-id="' + finished.doc.photos[0].id + '"]').check(); await page.getByRole('button', { name: '공개 미리보기 갱신', exact: true }).click();
      await page.getByRole('checkbox', { name: '글 전체와 모든 사진 원본의 비공개 서버 보관 동의', exact: true }).check(); await page.getByRole('checkbox', { name: '선택한 사진 원본과 포함된 메타데이터 공개 동의', exact: true }).check(); await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check();
      await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click(); const link = page.getByRole('link', { name: '공개한 글 열기', exact: true }); await link.waitFor(); const url = await link.getAttribute('href'), token = new URL(url, base).searchParams.get('post');
      const publicDoc = server.rpc(null, 'life_blog_public_read', { p_token: token }); assert.equal(publicDoc.snapshot.photos.length, 1);
      const privateDoc = server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: finished.doc.id }); assert.equal(privateDoc.data.photos.length, 2);
      assert.notEqual(publicDoc.snapshot.photos[0].id, finished.doc.photos[0].id); assert(!JSON.stringify(publicDoc.snapshot).includes(finished.doc.photos[1].digest));
      const wire = JSON.stringify(server.blogRequests); for (const text of ['PRIVATE_NOTE_SENTINEL', 'PRIVATE_QUESTION_SENTINEL', 'PRIVATE_FULL_BODY_NOT_PUBLIC', 'LATEST_MUST_NOT_REPLACE_OLD', 'SECOND_UNQUOTED_BODY', f.link.sourceId]) assert(!wire.includes(text), text);
      const visitor = await device('material-visitor', null); await visitor.page.goto(url); await visitor.page.waitForFunction(() => document.querySelector('#blogStatus')?.dataset.state === 'published'); assert.match(await visitor.page.locator('#blogContent').innerText(), /완성 편집기에서 덧붙인 마지막 문단/);
      assert.equal(await visitor.page.evaluate(() => __homeDbOpens.length), 0); assert.equal(await visitor.page.locator('#blogContent img').count(), 1);
      await visitor.page.locator('#blogContent img').evaluate(node => node.decode()); assert.deepEqual(await visitor.page.locator('#blogContent img').evaluate(node => [node.naturalWidth, node.naturalHeight]), [4032, 3024]);
      const image = await visitor.page.locator('#blogContent img').getAttribute('src'); const response = await visitor.page.evaluate(async url => { const response = await fetch(url); return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) }; }, image); assert.equal(response.status, 200); assert.equal(digest(Buffer.from(response.bytes)), finished.doc.photos[0].digest); await capture(visitor.page, 'anonymous-selected');
      await page.getByRole('button', { name: '공개 철회', exact: true }).click();
      await page.getByText('공개 철회를 확인했습니다. 이 브라우저의 원래 글은 유지했습니다.', { exact: true }).waitFor();
      assert.equal(server.rpc(null, 'life_blog_public_read', { p_token: token }), null);
      await visitor.page.locator('#blogRefresh').click(); await visitor.page.waitForFunction(() => document.querySelector('#blogStatus')?.dataset.state === 'missing'); assert.equal(await visitor.page.locator('#blogContent').innerText(), ''); assert.equal(server.rpc(null, 'life_blog_public_read', { p_token: token }), null);
      // Route interception serves the same actual SQL-authorized media request.
      assert.equal(await visitor.page.evaluate(async url => (await fetch(url)).status, image), 404); await visitor.context.close();
    });
    await check('The evidence file contains only the chosen post and adopted exact source versions; fresh-workspace restoration preserves hashes, pixels and UTF-16 references', async () => {
      await enter(page, planId); await page.locator('#mwPreserveOutput').click(); await page.locator('#lifePreservation[data-state="ready"]').waitFor();
      assert.deepEqual(await page.locator('#preservationPostSelection input:checked').evaluateAll(nodes => nodes.map(n => n.dataset.postId)), [finished.doc.id]);
      await page.locator('#preservationPrepareExport').click(); await page.locator('#preservationExportReview[data-state="ready"]').waitFor();
      const event = page.waitForEvent('download'); await page.locator('#preservationDownload').click(); archive = Buffer.from(await fs.readFile(await (await event).path())); await fs.writeFile(path.join(output, 'synthetic-evidence.zip'), archive);
      const files = ZIP.unzipSync(archive), manifest = JSON.parse(ZIP.strFromU8(files['manifest.json'])); assert.equal(manifest.posts.length, 1); assert.equal(manifest.bundle.sources.length, 2); assert.equal(manifest.bundle.sourceVersions.length, 2); assert.deepEqual(manifest.bundle.sourceVersions.map(v => v.id).sort(), [f.first.versionId, f.second.versionId].sort());
      for (const src of [f.first, f.second]) { const version = manifest.bundle.sourceVersions.find(v => v.id === src.versionId); assert.equal(version.contentText, src.raw); assert.equal(version.contentHash, digest(Buffer.from(src.raw))); }
      const wire = JSON.stringify(manifest); for (const text of ['PRIVATE_NOTE_SENTINEL', 'PRIVATE_QUESTION_SENTINEL', 'LATEST_MUST_NOT_REPLACE_OLD', f.link.sourceId, planId]) assert(!wire.includes(text), text);
      assert.equal(manifest.nineBoard.boards.length, 0); for (const p of finished.doc.photos) assert.equal(digest(files['photos/' + finished.doc.id + '/' + p.id]), p.digest);
      const before = await snapshot(page, f.workspaceId); await page.locator('#preservationFile').setInputFiles({ name: '합성 근거 파일.zip', mimeType: 'application/zip', buffer: archive }); await page.locator('#preservationImportReview[data-state="ready"]').waitFor(); assert.deepEqual(await snapshot(page, f.workspaceId), before);
      await page.locator('#preservationRestore').click(); await page.waitForFunction(() => !!document.querySelector('#lifePreservation')?.dataset.restoreWorkspaceId); const restoredId = await page.locator('#lifePreservation').getAttribute('data-restore-workspace-id'); assert.notEqual(restoredId, f.workspaceId);
      const restored = await snapshot(page, restoredId); assert.equal(restored.posts.length, 1); assert.equal(restored.preparation.plans.length, 0); const copy = restored.posts[0]; assert.notEqual(copy.doc.id, finished.doc.id); assert.equal(copy.sync, null); assert.equal(copy.evidence.refs.length, 2);
      for (let i = 0; i < 2; i++) { const p = copy.doc.photos[i], original = finished.doc.photos[i]; assert.notEqual(p.id, original.id); for (const key of ['digest', 'size', 'width', 'height', 'actualHash', 'actualWidth', 'actualHeight']) assert.equal(p[key], original[key]); }
      for (let i = 0; i < 2; i++) { const ref = copy.evidence.refs[i], original = finished.evidence.refs[i]; assert.equal(ref.workspaceId, restoredId); assert.notEqual(ref.sourceVersionId, original.sourceVersionId); for (const key of ['quote', 'contentHash', 'locator']) assert.deepEqual(ref[key], original[key]); const resolved = await page.evaluate(async ({ ws, ref }) => HaedoLife.SourceReference.resolve(await HaedoLife.Shell.storage.read(ws), ref), { ws: restoredId, ref }); assert.equal(resolved.sourceVersionId, ref.sourceVersionId); }
      const originalAfter = await snapshot(page, f.workspaceId); delete before.spaces; delete originalAfter.spaces; assert.deepEqual(originalAfter, before); await capture(page, 'evidence-restored');
      await page.locator('#preservationOpenRestored').click(); await ready(page); await nav(page, 'manage'); await page.getByRole('button', { name: '글 관리', exact: true }).click(); await page.locator('.blog-manager-list[data-state="ready"]').waitFor();
      const provenance = page.locator('.blog-post[data-post-id="' + copy.doc.id + '"] .blog-manager-evidence details'); await provenance.locator(':scope > summary').click(); await provenance.getByRole('button', { name: '같은 여행 자료', exact: true }).first().click(); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), f.first.raw);
    });
    await owner.context.close();
    await check('A real IndexedDB handoff abort preserves preparation and installs zero partial post/evidence; explicit retry creates exactly one post', async () => {
      const d = await fixture('material-abort'); page = d.page; const id = await seedPlan(page, d.fixture); await enter(page, id); const before = await snapshot(page);
      await page.evaluate(() => { window.__mwPut = IDBObjectStore.prototype.put; window.__mwAborts = 0; IDBObjectStore.prototype.put = function (...args) { const result = __mwPut.apply(this, args); if (this.name === 'meta' && String(args[0]?.key).startsWith('material-writing-output:')) { __mwAborts++; this.transaction.abort(); } return result; }; });
      await previewCreate(page); await page.locator('.mw-error:not([hidden])').waitFor(); assert(await page.evaluate(() => __mwAborts > 0)); assert.deepEqual(await snapshot(page), before);
      await page.evaluate(() => { IDBObjectStore.prototype.put = __mwPut; }); await previewCreate(page); await page.locator('#photoTitle').waitFor(); assert.equal((await snapshot(page)).posts.length, 1); await d.context.close();
    });
    await check('Two real tabs keep the competing preparation and the current input; CAS failure requires explicit recovery', async () => {
      const d = await fixture('material-two-tabs'); page = d.page; const id = await seedPlan(page, d.fixture); await enter(page, id);
      const second = await d.context.newPage(); await enter(second, id); await second.locator('#mwTitle').fill('두 번째 창이 먼저 보관한 제목'); await saved(second);
      await page.locator('#mwTitle').fill('첫 번째 창의 남겨야 할 입력'); await page.locator('.mw-error:not([hidden])').waitFor(); assert.equal(await page.locator('#mwTitle').inputValue(), '첫 번째 창의 남겨야 할 입력'); assert.equal((await readPreparation(page)).plans.find(p => p.id === id).title, '두 번째 창이 먼저 보관한 제목'); assert.equal((await snapshot(page)).posts.length, 0);
      await page.locator('#mwRecover').click(); await saved(page); const state = await readPreparation(page); assert.equal(state.plans.length, 2); assert(state.plans.some(p => p.title === '첫 번째 창의 남겨야 할 입력' && p.output === null)); await d.context.close();
    });
    await check('A committed handoff survives an editor-open failure; explicit continuation reopens its existing ID without duplicate documents', async () => {
      const d = await fixture('material-open-failure'); page = d.page; const id = await seedPlan(page, d.fixture); await enter(page, id);
      await page.evaluate(() => { window.__mwSimulateOpenFailure = true; }); await previewCreate(page); await page.locator('.mw-error:not([hidden])').waitFor();
      await page.evaluate(() => { window.__mwSimulateOpenFailure = false; });
      const before = await snapshot(page); assert.equal(before.posts.length, 1); const postId = before.posts[0].doc.id; assert.equal(before.preparation.plans.find(p => p.id === id).output.postId, postId);
      await page.locator('#mwContinue').click(); await page.locator('#photoTitle').waitFor(); const after = await snapshot(page); assert.equal(after.posts.length, 1); assert.equal(after.posts[0].doc.id, postId); assert.deepEqual(after, before); await d.context.close();
    });
    await check('A real SDK account change during exact-source hashing cancels the old account handoff and leaves both accounts free of partial posts', async () => {
      const d = await fixture('material-late-account'); page = d.page; const id = await seedPlan(page, d.fixture); await enter(page, id);
      await page.evaluate(() => {
        window.__mwDigest = crypto.subtle.digest.bind(crypto.subtle); window.__mwHoldDigest = true;
        crypto.subtle.digest = async function (...args) { const result = await __mwDigest(...args); if (window.__mwHoldDigest) { window.__mwHashHeld = true; await new Promise(resolve => window.__mwReleaseHash = () => { window.__mwHoldDigest = false; resolve(); }); } return result; };
      });
      await previewCreate(page); await page.waitForFunction(() => window.__mwHashHeld === true);
      const result = await page.evaluate(async account => { const { error } = await HaedoAuth.client.auth.signInWithPassword({ email: account.email, password: 'anonymous-browser-password' }); if (!error) await HaedoAuth.verify(); return error?.message || null; }, accounts.b); assert.equal(result, null);
      await page.waitForFunction(id => HaedoAuth.user?.id === id, accounts.b.id);
      await page.evaluate(() => { __mwReleaseHash(); crypto.subtle.digest = __mwDigest; });
      await ready(page);
      assert.equal(await page.evaluate(async ws => { try { await HaedoLife.Shell.storage.readMaterialWriting(ws); return 'unexpected_access'; } catch (error) { return error.code; } }, d.fixture.workspaceId), 'workspace_access_denied');
      const oldRows = await page.evaluate(async ws => new Promise((resolve, reject) => {
        const open = indexedDB.open('life-tools-v1'); open.onerror = () => reject(open.error); open.onsuccess = () => {
          const db = open.result, tx = db.transaction('meta', 'readonly'), get = tx.objectStore('meta').getAll();
          get.onsuccess = () => { const rows = get.result, plan = rows.find(r => r.key === 'material-writing:' + ws)?.value;
            resolve({ plan, postCount: rows.filter(r => r.key.startsWith('photo-post:' + ws + ':')).length, refsCount: rows.filter(r => r.key.startsWith('post-evidence:' + ws + ':')).length, receipts: rows.filter(r => r.key.startsWith('material-writing-output:' + ws + ':')).length }); };
          tx.oncomplete = () => db.close(); tx.onerror = () => reject(tx.error);
        };
      }), d.fixture.workspaceId);
      assert.equal(oldRows.postCount, 0); assert.equal(oldRows.refsCount, 0); assert.equal(oldRows.receipts, 0); assert.equal(oldRows.plan.plans.find(p => p.id === id).output, null);
      const current = await snapshot(page); assert.notEqual(current.workspaceId, d.fixture.workspaceId); assert.equal(current.posts.length, 0); assert.equal(current.preparation.plans.length, 0); assert.equal(server.blogRequests.filter(r => r.device === 'material-late-account').length, 0); await d.context.close();
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } catch (error) { report.pass = false; report.error = error.stack; await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); throw error; }
  finally { for (const context of contexts) await context.close().catch(() => {}); await browser.close(); report.rpcCounts = server.blogRequests.reduce((v, r) => { v[r.rpc] = (v[r.rpc] || 0) + 1; return v; }, {}); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
module.exports = { seedMaterials, enter, saved, readPreparation, addMaterial, quoteMaterial, seedPlan, snapshot, output };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
