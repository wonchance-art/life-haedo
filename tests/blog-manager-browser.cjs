/* Manager UI: synthetic documents and explicitly injected sync/storage faults.
 * Uses the actual PhotoPost/Blog/public renderer; no real account or remote DB.
 * BASE_URL=http://127.0.0.1:4196 node tests/blog-manager-browser.cjs
 */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4196';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts } = require('./life-sync-browser.cjs');
const base = process.env.BASE_URL, out = path.resolve(__dirname, '../.local/blog-manager');
const report = { scope: 'Linux Chromium, synthetic local documents and injected transport/failures. Actual shared models and public renderer. No live OAuth, DB, publication or Apple device claim.', checks: [], visual: [], consoleErrors: [], pageErrors: [] };
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function check(name, fn) {
    if (process.env.BLOG_MANAGER_TEST_MATCH && !new RegExp(process.env.BLOG_MANAGER_TEST_MATCH).test(name)) return;
    console.log('START manager: ' + name);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ check: name, message: message.text() }); });
    try {
      await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => !!window.HaedoLife?.PhotoPost && !!window.HaedoLife?.Writing);
      for (const name of ['blog.js', 'blog-public-ui.js', 'blog-manager.js']) await page.addScriptTag({ url: base + '/assets/life/' + name });
      await page.addStyleTag({ url: base + '/assets/life/blog-manager.css' });
      await page.addStyleTag({ content: 'body>:not(#managerTestHost){display:none!important}#managerTestHost{padding:20px;font:16px/1.6 sans-serif}button{min-height:44px}input,select,textarea{font:inherit}' });
      await page.evaluate(async () => {
        const life = HaedoLife, M = life.PhotoPost, host = document.createElement('main'); host.id = 'managerTestHost'; host.className = 'life-app'; document.body.append(host);
        const make = (id, title, status = 'saved', archived = false) => ({ ...M.create(() => id), revision: 1, title, status, archived, ops: [{ insert: title + ' 원문 내용\n' }] });
        const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 3;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const photo = await M.readPhoto(new File([blob], '원본.png', { type: 'image/png' }), () => 'local-photo');
        const doc = make('saved-photo', '산책을 마친 날'); doc.photos = [photo];
        doc.ops = [{ insert: '안전한 공개 본문\n' }, { insert: { photo: { id: photo.id, caption: '선택한 사진 설명', alt: '작은 풍경' } } }, { insert: '\n' }];
        const docs = new Map([doc, make('draft-photo', '다시 쓰는 생각', 'draft'), make('archived-photo', '보관해 둔 여행', 'saved', true)].map(d => [d.id, d]));
        life.Writing = { isOwnSource: () => true, latestVersion: bundle => bundle.sourceVersions[0] };
        const state = { status: 'not_enabled', remoteRevision: 0, publication: null };
        window.testData = { docs, state, opens: [], legacy: [], openContexts: [], legacyContexts: [], publishCalls: [], readFail: false, syncFail: false, listFail: false, accountCurrent: true, previewSnapshots: [] };
        const actualRender = life.BlogPublicUI.render;
        life.BlogPublicUI = { ...life.BlogPublicUI, render(snapshot, options) { testData.previewSnapshots.push(structuredClone(snapshot)); return actualRender(snapshot, options); } };
        const storage = {
          async read() { return { sources: [{ id: 'own-source', title: '기록 글 제목' }], sourceVersions: [{ id: 'exact-version', contentText: '정확한 이전 원문', importedAt: '2026-10-17T00:00:00.000Z' }] }; },
          async readWorkbench() { return { page: { posts: [{ id: 'plain-post', title: '오래된 첨부 글', body: '이전 작성기의 본문', status: 'saved', attachments: [] }] } }; },
          async listPhotoPosts() { if (testData.listFail) throw Error('익명 목록 읽기 실패'); return [...docs.values()].map(d => ({ id: d.id, title: d.title, revision: d.revision, status: d.status, archived: d.archived, updatedAt: d.updatedAt, body: M.plainText(d), photos: d.photos.length, attachments: d.attachments.length })); },
          async readPhotoPost(ws, id) { if (testData.holdRead) { testData.readBlocked = true; await new Promise(resolve => { testData.releaseRead = () => { testData.holdRead = false; resolve(); }; }); } if (testData.readFail) throw Error('익명 글 읽기 실패'); return structuredClone(docs.get(id)); },
          async savePhotoPost(ws, input, rev) { if (testData.saveFail) throw Error('익명 저장 실패'); if (docs.get(input.id)?.revision !== rev) throw Error('익명 CAS 충돌'); const saved = { ...structuredClone(input), revision: rev + 1 }; docs.set(saved.id, saved); return saved; },
          async readPageDrafts() { return { posts: [{ id: 'legacy-draft', title: '첨부 초안', status: 'draft', body: '미완성 본문' }] }; },
          async listStages() { return [{ stageId: 'writing-stage', kind: 'writing', state: 'draft', title: '기록 초안', text: '내 생각 초안' }, { stageId: 'import-stage', kind: 'text', state: 'draft', title: '가져오기 검토 제외' }]; }, subscribe() { return () => {}; },
        };
        const sync = {
          async getState() { if (testData.syncFail) throw Object.assign(Error('아직 준비되지 않은 서버'), { code: 'schema_missing' }); return structuredClone(state); },
          async connect() { if (testData.syncFail) throw Object.assign(Error('아직 준비되지 않은 서버'), { code: 'schema_missing' }); state.status = 'conflict'; state.remoteId = 'remote-version'; return structuredClone(state); },
          async sync() { return this.connect(); }, async pause() { state.status = 'paused'; },
          async list() { if (testData.syncFail) throw Object.assign(Error('준비되지 않은 서버'), { code: 'schema_missing' }); return [{ id: 'remote-version', title: '다른 기기의 글' }]; },
          async receive() { const fresh = make('received-copy', '다른 기기의 글'); docs.set(fresh.id, fresh); return { newLocalPostId: fresh.id, post: fresh }; },
          async publish(ws, id, options) { if (testData.syncFail) throw Object.assign(Error('준비되지 않은 서버'), { code: 'schema_missing' }); testData.publishCalls.push(structuredClone(options)); state.status = 'synced'; state.remoteRevision = 1; state.publication = { revision: (state.publication?.revision || 0) + 1, active: true }; if (testData.failAfterPublish) testData.syncFail = true; return { publicUrl: location.origin + '/blog.html?post=stable-public-token' }; },
          async unpublish() { state.publication = { revision: (state.publication?.revision || 0) + 1, active: false }; testData.unpublished = true; },
        };
        window.manager = life.BlogManager.create({ storage, workspaceId: 'workspace', blogSync: sync, isCurrent: () => testData.accountCurrent,
          async openPost(id, context) { await manager.flush(); testData.opens.push(id); testData.openContexts.push(context); }, async openLegacy(row, context) { await manager.flush(); testData.legacy.push(row); testData.legacyContexts.push(context); } });
        await manager.mount(host);
      });
      await fn(page); report.checks.push({ name, pass: true }); console.log('PASS manager: ' + name);
    } catch (error) { report.checks.push({ name, pass: false, error: error.message }); throw error; }
    finally { await context.close(); }
  }
  try {
    await check('all formats, exact resume and query retention through partial list failure', async page => {
      assert.equal(await page.locator('.blog-post').count(), 6);
      const draftRow = page.locator('.blog-post[data-post-id="draft-photo"]');
      assert.equal(await draftRow.locator('.blog-manager-server').count(), 0);
      assert.equal(await draftRow.getByText('초안은 이 브라우저에 보관합니다. 글을 저장한 뒤 한 편씩 서버에 보관할 수 있습니다.', { exact: true }).count(), 1);
      assert.equal(await page.locator('.blog-post[data-post-id="saved-photo"] .blog-manager-server').count(), 1);
      assert.equal(await page.getByRole('button', { name: '보관해 둔 여행', exact: true }).count(), 0);
      assert.equal(await page.getByText('가져오기 검토 제외', { exact: true }).count(), 0);
      await page.locator('#blogManagerFilter').selectOption('archived');
      assert.equal(await page.locator('.blog-post[data-post-id="archived-photo"] .blog-manager-server').count(), 1);
      await page.locator('#blogManagerFilter').selectOption('draft'); assert.equal(await page.locator('.blog-post').count(), 3);
      await page.getByRole('button', { name: '기록 초안', exact: true }).click();
      assert.equal(await page.evaluate(() => testData.legacy[0].id), 'writing-stage');
      assert.equal(await page.evaluate(() => testData.legacyContexts[0].focusKey), 'blog:post:writing-draft:writing-stage');
      await page.locator('#blogManagerFilter').selectOption('all');
      await page.locator('#blogManagerSearch').fill('안전한 공개'); assert.equal(await page.locator('.blog-post').count(), 1);
      await page.evaluate(() => { testData.listFail = true; });
      await page.getByRole('button', { name: '글 목록 다시 불러오기', exact: true }).click();
      await page.locator('.blog-manager-list[data-state="partial"]').waitFor();
      assert.equal(await page.locator('#blogManagerSearch').inputValue(), '안전한 공개'); assert.equal(await page.locator('.blog-post').count(), 1);
      await page.getByRole('button', { name: '산책을 마친 날', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => testData.opens), ['saved-photo']);
      assert.deepEqual(await page.evaluate(() => testData.openContexts[0]), { expectedRevision: 1, focusKey: 'blog:post:photo:saved-photo' });
      await page.locator('#blogManagerSearch').fill('정확한 이전 원문');
      const sourceTitle = page.getByRole('button', { name: '기록 글 제목', exact: true });
      assert.equal(await sourceTitle.getAttribute('data-focus-key'), 'blog:post:source:own-source'); await sourceTitle.click();
      assert.equal(await page.evaluate(() => testData.legacy.at(-1).versionId), 'exact-version');
      assert.equal(await page.evaluate(() => testData.legacyContexts.at(-1).focusKey), 'blog:post:source:own-source');
    });
    await check('actual public projection, explicit original-photo consent, stale revision refusal and stable URL', async page => {
      const original = await page.evaluate(() => HaedoLife.Blog.pack(testData.docs.get('saved-photo')));
      await page.getByRole('button', { name: '공개 내용 검토', exact: true }).click();
      await page.getByRole('button', { name: '공개 미리보기 갱신', exact: true }).click();
      assert.equal(await page.locator('.blog-manager-public-preview img').count(), 0);
      assert.equal(await page.locator('[data-photo-id="local-photo"]').isChecked(), false);
      await page.getByRole('checkbox', { name: '글 전체와 모든 사진 원본의 비공개 서버 보관 동의', exact: true }).check();
      await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check();
      await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click();
      await page.getByRole('link', { name: '공개한 글 열기' }).waitFor();
      assert.equal((await page.evaluate(() => testData.publishCalls))[0].photoIds.length, 0);
      await page.locator('[data-photo-id="local-photo"]').check();
      assert.equal(await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).isChecked(), false);
      await page.getByRole('button', { name: '공개 미리보기 갱신', exact: true }).click();
      await page.locator('.blog-manager-public-preview img').waitFor();
      await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check();
      await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click();
      assert.equal(await page.evaluate(() => testData.publishCalls.length), 1);
      await page.getByRole('checkbox', { name: '선택한 사진 원본과 포함된 메타데이터 공개 동의', exact: true }).check();
      await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check();
      await page.evaluate(() => { testData.docs.get('saved-photo').revision++; });
      await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click();
      assert.equal(await page.evaluate(() => testData.publishCalls.length), 1);
      assert.match(await page.locator('.blog-manager [role="status"]').textContent(), /글이 바뀌었습니다/);
      await page.evaluate(() => { testData.docs.get('saved-photo').revision--; });
      await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click();
      await page.getByRole('link', { name: '공개한 글 열기' }).waitFor();
      const calls = await page.evaluate(() => testData.publishCalls);
      assert.deepEqual(calls[1].photoIds, ['local-photo']); assert.equal(calls[1].expectedPublicRevision, 1);
      assert.equal(calls[1].expectedLocalRevision, original.revision); assert.equal(calls[1].expectedRemoteRevision, 1);
      assert.equal(await page.getByRole('link', { name: '공개한 글 열기' }).getAttribute('href'), base + '/blog.html?post=stable-public-token');
      await page.getByRole('button', { name: '공개 철회', exact: true }).click();
      assert.equal(await page.evaluate(() => testData.unpublished), true);
      assert.deepEqual(await page.evaluate(() => HaedoLife.Blog.pack(testData.docs.get('saved-photo'))), original);
      await page.getByRole('button', { name: '공개 미리보기 갱신', exact: true }).click();
      for (const width of [1440, 820, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const file = `manager-preview-${width}.png`; await page.screenshot({ path: path.join(out, file), fullPage: true });
        const result = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, unnamed: [...document.querySelectorAll('#managerTestHost button,input,select,textarea')].filter(n => !n.textContent.trim() && !n.getAttribute('aria-label') && !n.closest('label')).length }));
        assert.equal(result.overflow, false); assert.equal(result.unnamed, 0); report.visual.push({ width, file, ...result });
      }
    });
    await check('uninstalled server is not reported as success; conflicts keep the original and receive a fresh copy', async page => {
      const row = page.locator('.blog-post[data-post-id="saved-photo"]');
      await row.locator('summary').click();
      await page.evaluate(() => { testData.syncFail = true; });
      await row.getByRole('button', { name: '이 글 서버에 보관', exact: true }).click();
      assert.match(await page.locator('.blog-manager [role="status"]').textContent(), /아직 준비되지/);
      assert.equal(await page.evaluate(() => testData.state.status), 'not_enabled');
      await page.evaluate(() => { testData.syncFail = false; });
      await row.getByRole('button', { name: '이 글 서버에 보관', exact: true }).click();
      await row.getByRole('button', { name: '서버 글을 새 사본으로 받기', exact: true }).click();
      assert.equal(await page.evaluate(() => testData.docs.has('saved-photo') && testData.docs.has('received-copy')), true);
      assert.equal(await page.evaluate(() => testData.opens.at(-1)), 'received-copy');
      await page.evaluate(() => { testData.saveFail = true; });
      await page.locator('.blog-post[data-post-id="saved-photo"]').getByRole('button', { name: '보관함으로', exact: true }).click();
      assert.equal(await page.evaluate(() => testData.docs.get('saved-photo').archived), false);
    });
    await check('publication freezes editable controls, rechecks consent after await and distinguishes a completed publication from follow-up failure', async page => {
      await page.getByRole('button', { name: '공개 내용 검토', exact: true }).click();
      await page.getByRole('button', { name: '공개 미리보기 갱신', exact: true }).click();
      await page.getByRole('checkbox', { name: '글 전체와 모든 사진 원본의 비공개 서버 보관 동의', exact: true }).check();
      await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check();
      await page.evaluate(() => { testData.holdRead = true; });
      await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click();
      await page.waitForFunction(() => testData.readBlocked);
      assert.equal(await page.getByRole('textbox', { name: '공개 이름', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).isDisabled(), true);
      assert.equal(await page.evaluate(() => manager.flush().then(() => false, () => true)), true);
      await page.evaluate(() => { document.querySelector('[aria-label="이 내용을 공개합니다"]').checked = false; testData.releaseRead(); });
      await page.locator('.blog-manager[aria-busy="false"]').waitFor();
      assert.equal(await page.evaluate(() => testData.publishCalls.length), 0);
      await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check();
      await page.evaluate(() => { testData.failAfterPublish = true; });
      await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click();
      await page.getByRole('link', { name: '공개한 글 열기' }).waitFor();
      assert.equal(await page.evaluate(() => testData.publishCalls.length), 1);
      assert.match(await page.locator('.blog-manager [role="status"]').textContent(), /공개 게시와 주소는 확인했습니다.*후속 상태 조회/);
    });
    if (!process.env.BLOG_MANAGER_TEST_MATCH || /idb/i.test(process.env.BLOG_MANAGER_TEST_MATCH)) {
    const actual = await makeContext(browser, new FakeCloud(), 'manager-actual-idb', accounts.a);
    const page = await actual.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => report.pageErrors.push({ check: 'real IDB and revision guard', message: error.message }));
    try {
      await page.goto(base + '/index.html'); await ready(page);
      await page.addScriptTag({ url: base + '/assets/life/blog-manager.js' });
      await page.evaluate(async () => {
        const life = HaedoLife, storage = life.Shell.storage, ws = await storage.getActive();
        const draft = life.PhotoPost.create(life.Core.id); draft.title = '실제 저장소의 수정 초안'; draft.ops = [{ insert: '이전 입력을 유지합니다.\n' }];
        const saved = await storage.savePhotoPost(ws, draft, 0);
        const host = document.createElement('section'); host.id = 'actualManagerHost'; document.querySelector('#lifeApp').append(host);
        window.actualManager = life.BlogManager.create({ storage, workspaceId: ws, isCurrent: () => true,
          openPost: async id => { window.actualOpened = id; }, openLegacy: async () => {} });
        await actualManager.mount(host);
        window.actualSavedId = saved.id;
        const editorHost = document.createElement('section'); editorHost.id = 'actualEditorHost'; document.querySelector('#lifeApp').append(editorHost);
        const wrapped = { ...storage, savePhotoPost(...args) { if (window.actualWriteFail) throw new Error('익명 저장 실패; 기존 입력 유지'); return storage.savePhotoPost(...args); } };
        window.actualEditor = life.PhotoPostUI.create({ storage: wrapped, workspaceId: ws, isCurrent: () => true });
        await actualEditor.mount(editorHost, { postId: saved.id, expectedRevision: saved.revision + 1 });
      });
      const manager = page.locator('#actualManagerHost');
      await manager.getByRole('button', { name: '실제 저장소의 수정 초안', exact: true }).click();
      assert.equal(await page.evaluate(() => actualOpened), await page.evaluate(() => actualSavedId));
      assert.equal(await page.locator('#actualEditorHost #photoTitle').count(), 0);
      assert.match(await page.locator('#actualEditorHost').innerText(), /글이 바뀌었습니다/);
      await page.evaluate(async () => {
        const s = HaedoLife.Shell.storage, ws = await s.getActive(), doc = await s.readPhotoPost(ws, actualSavedId);
        await actualEditor.mount(document.querySelector('#actualEditorHost'), { postId: doc.id, expectedRevision: doc.revision });
      });
      await page.locator('#actualEditorHost #photoTitle').fill('저장 실패에도 유지할 실제 입력');
      const rejected = await page.evaluate(async () => {
        window.actualWriteFail = true;
        try { await actualEditor.mount(document.querySelector('#actualEditorHost'), { postId: actualSavedId, expectedRevision: 1 }); return false; }
        catch (_) { return true; }
      });
      assert.equal(rejected, true);
      assert.equal(await page.locator('#actualEditorHost #photoTitle').inputValue(), '저장 실패에도 유지할 실제 입력');
      assert.equal(await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.readPhotoPost(await s.getActive(), actualSavedId)).title; }), '실제 저장소의 수정 초안');
      report.checks.push({ name: 'actual account-scoped IndexedDB resume and stale-revision guard preserve unsaved editor input on failed remount', pass: true });
    } catch (error) { report.checks.push({ name: 'real IDB and revision guard', pass: false, error: error.message }); throw error; }
    finally { await actual.close(); }
    }
    if (!process.env.BLOG_MANAGER_TEST_MATCH || /provenance/i.test(process.env.BLOG_MANAGER_TEST_MATCH)) {
      const context = await makeContext(browser, new FakeCloud(), 'manager-provenance-idb', accounts.a);
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      page.on('pageerror', error => report.pageErrors.push({ check: 'exact provenance roundtrip', message: error.message }));
      page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ check: 'exact provenance roundtrip', message: event.text() }); });
      try {
        await page.goto(base + '/index.html'); await ready(page);
        const fixture = await page.evaluate(async () => {
          const C = HaedoLife.Core, s = HaedoLife.Shell.storage, ws = await s.getActive(); let b = await s.read(ws);
          const raw = '\ufeff🌱 앞 문장\r\n오래된 정확 인용\r\n둘째 줄\r\n다른 원문';
          const quote = '오래된 정확 인용\r\n둘째 줄', start = raw.indexOf(quote), locator = { start, end: start + quote.length };
          const first = await C.prepareImport({ origin: 'obsidian', title: '되돌아갈 원문', text: raw, url: 'https://example.org/source', authorRelation: 'unknown' }, b);
          let result = await s.commitLocal({ workspaceId: ws, baseRevision: b.revision, operationId: C.id(), changes: C.buildImportChanges(b, first, [{ ...locator, topic: '비공개 주제', note: '복사하지 않을 개인 메모' }]) });
          if (result.status !== 'stored') throw Error('source fixture save'); b = await s.read(ws);
          const latest = await C.prepareImport({ origin: 'obsidian', title: '되돌아갈 원문', text: '현재 버전에는 인용 구절이 없습니다.', existingSourceId: first.source.id, authorRelation: 'unknown' }, b);
          result = await s.commitLocal({ workspaceId: ws, baseRevision: b.revision, operationId: C.id(), changes: C.buildImportChanges(b, latest) });
          if (result.status !== 'stored') throw Error('newer source fixture save'); b = await s.read(ws);
          const ref = await HaedoLife.SourceReference.build({ bundle: b, sourceId: first.source.id, versionId: first.version.id, locator });
          for (let index = 0; index < 44; index++) {
            const other = HaedoLife.PhotoPost.create(C.id); other.title = '원문 연결필터 ' + index; other.ops = [{ insert: '다른 글의 초안\n' }];
            await s.savePhotoPost(ws, other, 0);
          }
          const doc = HaedoLife.PhotoPost.create(C.id); doc.title = '원문 연결필터 99'; doc.createdAt = doc.updatedAt = '2026-10-16T00:00:00.000Z'; doc.ops = HaedoLife.BlogEvidence.draft(ref, '별도로 직접 쓴 생각').ops;
          await s.savePhotoPostWithEvidence(ws, doc, 0, [ref], 0);
          window.__provenanceOriginal = JSON.stringify(b);
          return { ws, postId: doc.id, raw, quote, locator, versionId: first.version.id, latestVersionId: latest.version.id };
        });
        const before = await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return JSON.stringify(await s.read(await s.getActive())); });
        await page.goto(base + '/index.html?section=records&view=blog'); await ready(page);
        await page.locator('#blogManagerSearch').fill('원문 연결필터');
        await page.locator('#blogManagerFilter').selectOption('draft');
        assert.equal(await page.locator(`.blog-post[data-post-id="${fixture.postId}"]`).count(), 0);
        await page.getByRole('button', { name: '글 더 보기', exact: true }).click();
        const row = page.locator(`.blog-post[data-post-id="${fixture.postId}"]`), provenance = row.locator('.blog-manager-evidence');
        await provenance.locator('summary').waitFor();
        assert(!((await page.locator('#lifeBlogManager').innerText()).includes('복사하지 않을 개인 메모')));
        assert(!((await provenance.innerText()).includes(fixture.quote)));
        await provenance.locator('summary').click();
        const open = provenance.getByRole('button', { name: '되돌아갈 원문', exact: true });
        const focusKey = await open.getAttribute('data-focus-key'); await open.click();
        await page.locator('#lifeSourceText').waitFor();
        assert.equal(await page.locator('#lifeVersion').inputValue(), fixture.versionId);
        assert.notEqual(fixture.versionId, fixture.latestVersionId);
        assert.equal(await page.locator('#lifeSourceText').textContent(), fixture.raw);
        await page.waitForFunction(({ locator, quote }) => {
          const text = document.querySelector('#lifeSourceText')?.firstChild, selection = getSelection(); if (!text || selection?.rangeCount !== 1) return false;
          const range = selection.getRangeAt(0); return range.startContainer === text && range.endContainer === text && range.startOffset === locator.start && range.endOffset === locator.end && text.data.slice(range.startOffset, range.endOffset) === quote;
        }, fixture);
        await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeBlogManager').waitFor();
        assert.equal(await page.locator('#blogManagerSearch').inputValue(), '원문 연결필터');
        assert.equal(await page.locator('#blogManagerFilter').inputValue(), 'draft');
        assert.equal(await page.locator('.blog-post').count(), 45);
        await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, focusKey);
        assert.equal(await page.locator(`.blog-post[data-post-id="${fixture.postId}"] .blog-manager-evidence details`).evaluate(n => n.open), true);
        assert.equal(await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return JSON.stringify(await s.read(await s.getActive())); }), before);
        assert.equal((await page.evaluate(async id => { const s = HaedoLife.Shell.storage; return s.readPostEvidence(await s.getActive(), id); }, fixture.postId)).refs[0].sourceVersionId, fixture.versionId);
        report.checks.push({ name: 'exact provenance roundtrip uses the original CRLF/UTF-16 version and restores search/filter/more-than-40 focused manager rows without copying private notes or changing source data', pass: true });
      } catch (error) { report.checks.push({ name: 'exact provenance roundtrip', pass: false, error: error.message }); throw error; }
      finally { await context.close(); }
    }
    report.pass = report.checks.every(check => check.pass) && !report.pageErrors.length && !report.consoleErrors.length;
    assert.equal(report.pass, true, JSON.stringify({ console: report.consoleErrors, page: report.pageErrors }));
  } finally { await browser.close(); await fs.writeFile(path.join(out, process.env.BLOG_MANAGER_TEST_MATCH ? 'recheck-report.json' : 'report.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, visual: report.visual.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
