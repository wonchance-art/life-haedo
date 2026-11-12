/* An open editor and account sync across devices and tabs (2026-11-12, account sync review
 * M2/M3/M4/m2/m5). Real app, IndexedDB and BlogSync in Chromium contexts ("devices") of one
 * anonymous test account against the intercepted FakeCloud (devices share the default
 * library). No production account or database.
 * - M2: an editor left open with nothing unsaved shows the version another device wrote, and
 *   typing goes on from it; while input is not stored (an IME composition) the version waits,
 *   the editor says so, and once stored the later input wins and the other version is kept as
 *   `복구 사본`.
 * - M3: another tab of the same browser never changes the post open in a tab; typing there
 *   is always stored (no false "다른 탭에서 수정", no input left outside storage).
 * - M4: the later save of a saved post edited on two devices updates it and keeps the other
 *   version as `복구 사본`; a revision of a post deleted elsewhere is saved as its own post.
 * - m2: a post deleted elsewhere while its read view is open says so and returns to the list.
 * - m5: a device whose clock is behind the post's first time saves its revision.
 * BASE_URL=http://127.0.0.1:4173 node tests/blog-editor-sync-browser.cjs */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const output = path.resolve('.local/blog-editor-sync');
const KEPT = '복구 사본 · ';
const report = { checks: [], consoleErrors: [], pageErrors: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate, label, timeout = 30000) {
  const start = Date.now(); let value;
  do { value = await read(); if (predicate(value)) return value; await sleep(150); } while (Date.now() - start < timeout);
  throw new Error('timed out: ' + label + ' ' + JSON.stringify(value)?.slice(0, 1500));
}
// A clock this many minutes behind (another device's clock); a plain call of Date() is not used by the app.
const skewed = minutes => `(() => { const Real = Date, offset = ${minutes} * 60000;
  class Skewed extends Real { constructor(...args) { if (args.length) super(...args); else super(Real.now() + offset); } static now() { return Real.now() + offset; } }
  globalThis.Date = Skewed; })();`;
async function device(browser, server, name, { viewport = { width: 1280, height: 900 }, init = null } = {}) {
  const context = await makeContext(browser, server, name, accounts.a, { viewport });
  if (init) await context.addInitScript(init);
  context.on('page', page => {
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.pageErrors.push(name + ': ' + error.message));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) report.consoleErrors.push(name + ': ' + message.text().slice(0, 300)); });
  });
  const page = await context.newPage();
  await openHome(page);
  return { name, context, page };
}
async function openHome(page) { await page.goto(base + '/index.html'); await ready(page); await page.locator('#homePosts[aria-busy="false"]').waitFor(); }
async function home(page) { await nav(page, 'home'); await page.locator('#homePosts[aria-busy="false"]').waitFor(); }
const kick = page => page.evaluate(() => dispatchEvent(new Event('online')));
async function posts(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, out = [];
    for (const library of await s.listAccountLibraries()) for (const row of await s.listPhotoPosts(library.workspaceId)) {
      let doc; try { doc = await s.readPhotoPost(library.workspaceId, row.id); } catch (_) { continue; }
      out.push({ id: doc.id, title: doc.title, status: doc.status, revision: doc.revision, replaces: doc.replaces, text: HaedoLife.PhotoPost.plainText(doc).trim() });
    }
    return out;
  });
}
const serverPosts = server => [...server.posts.values()].map(row => ({ id: row.id, status: row.data.status, title: row.data.title, text: (row.data.ops || []).map(op => typeof op.insert === 'string' ? op.insert : '').join('').trim() }));
const editor = page => page.evaluate(() => ({ title: document.querySelector('#photoTitle')?.value ?? null, body: document.querySelector('.ql-editor')?.innerText.trim() ?? null,
  status: document.querySelector('.photo-status')?.textContent ?? null, note: document.querySelector('.photo-edit-note')?.textContent ?? '' }));
const typeTop = (page, text) => page.evaluate(value => Quill.find(document.querySelector('.ql-container')).insertText(0, value, 'user'), text);
async function writeDraft(page, title, body) {
  await page.locator('[data-haedo-compose]:visible').first().click();
  await page.locator('#photoTitle').fill(title); await page.locator('.ql-editor').fill(body);
  await page.locator('.photo-status[data-state="draft"]').waitFor();
  return (await until(() => posts(page), list => list.some(item => item.title === title && item.status === 'draft'), 'draft stored')).find(item => item.title === title).id;
}
async function writeSaved(page, title, body) {
  await page.locator('[data-haedo-compose]:visible').first().click();
  await page.locator('#photoTitle').fill(title); await page.locator('.ql-editor').fill(body);
  await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
  await page.locator('#photoServerStatus[data-state="synced"]').waitFor({ timeout: 30000 });
  return page.locator('#photoServerStatus').getAttribute('data-post-id');
}
async function closeEditor(page) { await page.getByRole('button', { name: '닫기', exact: true }).click(); await page.locator('#homePosts[aria-busy="false"]').waitFor(); }
async function openDraft(page, id) {
  await home(page);
  await page.locator('#homeTab-drafts').click(); await page.locator('#homeTab-drafts[aria-selected="true"]').waitFor(); await page.locator('#homePosts[aria-busy="false"]').waitFor();
  await page.locator('[data-draft-id="' + id + '"] .home-draft-open').click(); await page.locator('.ql-editor').waitFor();
}
async function openRead(page, id) {
  await home(page);
  const card = page.locator('#homePosts [data-photo-post-id="' + id + '"]'); await card.waitFor();
  await card.getByRole('button').first().click(); await page.locator('.photo-article').waitFor();
}
async function openEdit(page, id) { await openRead(page, id); await page.getByRole('button', { name: '글 수정', exact: true }).click(); await page.locator('.ql-editor').waitFor(); }
const onServer = (server, predicate, label) => until(async () => serverPosts(server), predicate, label);
const received = (dev, predicate, label) => until(async () => { await kick(dev.page); return posts(dev.page); }, predicate, label);
async function check(name, run) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  const start = Date.now();
  try { await run(); report.checks.push({ name, ok: true, ms: Date.now() - start }); console.log('ok', name); }
  catch (error) { report.checks.push({ name, ok: false, error: error.stack }); console.error('FAIL', name, error.stack); process.exitCode = 1; }
}

async function main() {
  await fs.rm(output, { recursive: true, force: true }); await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version();
  const pair = async (label, options = {}) => {
    const server = new FakeCloud(); server.enableAccountLibrary();
    const a = await device(browser, server, label + '-mac'), b = await device(browser, server, label + '-phone', { viewport: { width: 390, height: 800 }, ...options });
    return { server, a, b, close: async () => { await a.context.close(); await b.context.close(); } };
  };
  try {
    await check('M2: a clean open editor shows the other device\'s version and typing goes on from it', async () => {
      const { server, a, b, close } = await pair('m2');
      try {
        const id = await writeDraft(a.page, '여행 초안', '맥에서 쓴 첫 문단.');
        await closeEditor(a.page);
        await onServer(server, list => list.some(item => item.id === id), 'draft on the server');
        await received(b, list => list.some(item => item.id === id), 'phone receives the draft');
        await openDraft(a.page, id);
        await a.page.locator('.ql-editor').click(); await a.page.keyboard.press('End');
        await openDraft(b.page, id); await typeTop(b.page, '폰에서 이어 쓴 문단. '); await sleep(1200); await closeEditor(b.page);
        await onServer(server, list => list.some(item => item.id === id && /폰에서/.test(item.text)), 'phone edit on the server');
        // Where the Mac page rests (opening the editor may still be scrolling smoothly).
        let scroll = await a.page.evaluate(() => scrollY);
        for (let resting = false; !resting;) { await sleep(300); const now = await a.page.evaluate(() => scrollY); resting = now === scroll; scroll = now; }
        const shown = await until(async () => { await kick(a.page); return editor(a.page); }, value => /폰에서 이어 쓴 문단/.test(value.body), 'the open editor reads the new version');
        assert.match(shown.note, /다른 기기나 탭에서 바뀐 내용을 불러왔어요/);
        assert.equal(await a.page.evaluate(() => document.activeElement?.closest('.ql-editor') !== null), true, 'focus stays in the body');
        assert.equal(await a.page.evaluate(() => scrollY), scroll, 'scroll stays');
        await a.page.screenshot({ path: path.join(output, 'm2-mac-reloaded.png') });
        await a.page.keyboard.type('!');
        await onServer(server, list => list.some(item => item.id === id && /폰에서 이어 쓴 문단\. 맥에서 쓴 첫 문단\.\s*!$/.test(item.text)), 'typing goes on from the new version');
        await sleep(3000); await kick(a.page); await sleep(1500);
        assert.deepEqual((await posts(a.page)).map(item => item.title), ['여행 초안'], 'nothing to keep as a recovery copy');
        assert.deepEqual(serverPosts(server).map(item => item.title), ['여행 초안']);
      } finally { await close(); }
    });

    await check('M2: while input is not stored the version waits, the editor says so, and the later input wins', async () => {
      const { server, a, b, close } = await pair('m2b');
      try {
        const id = await writeDraft(a.page, '조합 중 초안', '처음 문장.');
        await closeEditor(a.page);
        await onServer(server, list => list.some(item => item.id === id), 'draft on the server');
        await received(b, list => list.some(item => item.id === id), 'phone receives the draft');
        await openDraft(a.page, id);
        await a.page.locator('.ql-editor').click(); await a.page.keyboard.press('End');
        // An IME composition is open on the Mac (synthetic composition events).
        await a.page.evaluate(() => document.querySelector('.ql-editor').dispatchEvent(new CompositionEvent('compositionstart', { data: '' })));
        await openDraft(b.page, id); await typeTop(b.page, '폰에서 먼저 고침. '); await sleep(1200); await closeEditor(b.page);
        await onServer(server, list => list.some(item => item.id === id && /폰에서/.test(item.text)), 'phone edit on the server');
        const waiting = await until(async () => { await kick(a.page); return editor(a.page); }, value => /다른 기기에서도 바뀌었어요/.test(value.note), 'the editor says a version waits');
        assert.doesNotMatch(waiting.body, /폰에서/, 'the open composition is never replaced');
        assert.equal((await posts(a.page)).find(item => item.id === id).text, '처음 문장.', 'nothing decided under it');
        await a.page.screenshot({ path: path.join(output, 'm2-mac-waiting.png') });
        await a.page.evaluate(() => document.querySelector('.ql-editor').dispatchEvent(new CompositionEvent('compositionend', { data: '' })));
        await a.page.keyboard.type(' 맥에서 마저 씀');
        const expected = list => list.some(item => item.id === id && /맥에서 마저 씀/.test(item.text) && !/폰에서/.test(item.text)) && list.some(item => item.title === KEPT + '조합 중 초안' && /폰에서 먼저 고침/.test(item.text));
        await until(async () => { await kick(a.page); return posts(a.page); }, expected, 'the later input wins, the phone version is kept');
        await onServer(server, expected, 'the account converges');
        await received(b, expected, 'the phone converges');
        assert.match((await editor(a.page)).body, /맥에서 마저 씀/);
      } finally { await close(); }
    });

    await check('M3: another tab never changes the post open in a tab; typing there is always stored', async () => {
      const { server, a, b, close } = await pair('m3');
      try {
        const id = await writeDraft(a.page, '두 탭 초안', '첫 문단.');
        await closeEditor(a.page);
        await onServer(server, list => list.some(item => item.id === id), 'draft on the server');
        await received(b, list => list.some(item => item.id === id), 'phone receives the draft');
        const tab2 = await a.context.newPage(); await openHome(tab2);
        await a.page.bringToFront(); await openDraft(a.page, id);
        await typeTop(a.page, '탭1에서 쓰는 중 ');
        await onServer(server, list => list.some(item => item.id === id && /탭1/.test(item.text)), 'tab 1 input on the server');
        await openDraft(b.page, id); await typeTop(b.page, '폰에서 덧붙임 '); await sleep(1200); await closeEditor(b.page);
        await onServer(server, list => list.some(item => item.id === id && /폰에서/.test(item.text)), 'phone edit on the server');
        // Only tab 2 runs cycles meanwhile.
        for (let i = 0; i < 3; i++) { await kick(tab2); await sleep(1500); }
        const stored = (await posts(tab2)).find(item => item.id === id);
        assert.match(stored.text, /탭1에서 쓰는 중/, 'the other tab left the open post as it is'); assert.doesNotMatch(stored.text, /폰에서/);
        await a.page.bringToFront();
        await a.page.locator('.ql-editor').click(); await a.page.keyboard.press('End'); await a.page.keyboard.type(' 이어서 씀');
        await until(async () => posts(a.page), list => list.some(item => item.id === id && /이어서 씀/.test(item.text)), 'tab 1 typing is stored');
        const state = await editor(a.page);
        assert.doesNotMatch(state.status, /다른 탭에서 사진 글을 수정했습니다/); assert.equal(await a.page.locator('.photo-recovery-actions:not([hidden])').count(), 0, 'no manual recovery');
        await a.page.screenshot({ path: path.join(output, 'm3-tab1-after-typing.png') });
        const converged = list => list.some(item => item.id === id && /이어서 씀/.test(item.text)) && list.some(item => item.title === KEPT + '두 탭 초안' && /폰에서 덧붙임/.test(item.text));
        await until(async () => { await kick(a.page); return posts(a.page); }, converged, 'the later input wins, the phone version is kept');
        await onServer(server, converged, 'the account converges');
        await tab2.close();
      } finally { await close(); }
    });

    await check('M3: the same draft typed in two tabs: the later input is stored over the other, which is kept as a recovery copy', async () => {
      const { a, close } = await pair('m3b');
      try {
        const id = await writeDraft(a.page, '두 탭에서 쓰는 초안', '처음 문장.');
        const tab2 = await a.context.newPage(); await openHome(tab2); await openDraft(tab2, id);
        await tab2.locator('.ql-editor').click(); await tab2.keyboard.press('End');
        // Tab 2 has a composition open (input outside storage) while tab 1 stores its own input.
        await tab2.evaluate(() => document.querySelector('.ql-editor').dispatchEvent(new CompositionEvent('compositionstart', { data: '' })));
        await a.page.bringToFront(); await a.page.locator('.ql-editor').click(); await a.page.keyboard.press('End'); await a.page.keyboard.type(' 탭1 입력');
        await until(async () => posts(a.page), list => list.some(item => item.id === id && /탭1 입력/.test(item.text)), 'tab 1 input stored');
        await tab2.bringToFront();
        await tab2.evaluate(() => document.querySelector('.ql-editor').dispatchEvent(new CompositionEvent('compositionend', { data: '' })));
        await tab2.keyboard.type(' 탭2 입력');
        const stored = await until(async () => posts(tab2), list => list.some(item => item.id === id && /탭2 입력/.test(item.text)), 'tab 2 input stored over the changed draft');
        assert.doesNotMatch(stored.find(item => item.id === id).text, /탭1 입력/);
        assert.ok(stored.some(item => item.title === KEPT + '두 탭에서 쓰는 초안' && /탭1 입력/.test(item.text)), 'tab 1\'s version is a recovery copy');
        const state = await editor(tab2);
        assert.match(state.note, /다른 탭이나 기기에서 바뀐 내용은 복구 사본으로 남겼어요/); assert.notEqual(await tab2.locator('.photo-status').getAttribute('data-state'), 'error');
        assert.equal(await tab2.locator('.photo-recovery-actions:not([hidden])').count(), 0, 'no manual recovery');
        await until(async () => editor(a.page), value => /탭2 입력/.test(value.body), 'tab 1 (clean) reads the stored version');
        // Tab 2 finishes the draft: tab 1, with nothing unsaved, shows the saved post and says why.
        await tab2.getByRole('button', { name: '글 저장', exact: true }).click(); await tab2.locator('.photo-article').waitFor();
        await a.page.locator('.photo-article').waitFor();
        assert.match(await a.page.locator('.photo-status').innerText(), /다른 탭이나 기기에서 이 초안을 글로 저장했어요/);
        assert.match(await a.page.locator('.photo-article').innerText(), /탭2 입력/);
        await tab2.close();
      } finally { await close(); }
    });

    await check('M4: the later save of a saved post edited on two devices updates it; the other version is a recovery copy', async () => {
      const { server, a, b, close } = await pair('m4');
      try {
        const id = await writeSaved(a.page, '같이 고치는 글', '원래 본문');
        await received(b, list => list.some(item => item.id === id), 'phone receives the post');
        await openEdit(a.page, id); await typeTop(a.page, 'A가 고치는 중 '); await sleep(1500);
        await openEdit(b.page, id); await typeTop(b.page, 'B가 먼저 저장 ');
        await b.page.getByRole('button', { name: '글 저장', exact: true }).click(); await b.page.locator('#photoServerStatus[data-state="synced"]').waitFor({ timeout: 30000 });
        await onServer(server, list => list.some(item => item.id === id && /B가 먼저 저장/.test(item.text)), 'B saved first');
        await until(async () => { await kick(a.page); return posts(a.page); }, list => list.some(item => item.status === 'saved' && /B가 먼저 저장/.test(item.text)), 'A receives B\'s version');
        await a.page.getByRole('button', { name: '글 저장', exact: true }).click(); await a.page.locator('.photo-article').waitFor();
        assert.match(await a.page.locator('.photo-status').innerText(), /비공개 글을 저장했어요 · 다른 곳에서 바뀐 판은 복구 사본으로 남겼어요/);
        await a.page.screenshot({ path: path.join(output, 'm4-a-after-save.png') });
        const converged = list => list.filter(item => item.status === 'saved').length === 1 && list.some(item => item.status === 'saved' && /A가 고치는 중/.test(item.text) && !/B가 먼저/.test(item.text)) &&
          list.some(item => item.status === 'draft' && item.title === KEPT + '같이 고치는 글' && /B가 먼저 저장/.test(item.text)) && list.length === 2;
        assert.ok(converged(await posts(a.page)), JSON.stringify(await posts(a.page)));
        await onServer(server, converged, 'the account converges (the editing draft retired, the kept copy uploaded)');
        await received(b, converged, 'B converges');
        assert.equal(await a.page.locator('#photoServerStatus').getAttribute('data-state'), 'synced');
      } finally { await close(); }
    });

    await check('M4/m2: a post deleted elsewhere: its revision is saved as its own post, its read view says so and returns to the list', async () => {
      const { server, a, b, close } = await pair('m4b');
      try {
        const read = await writeSaved(a.page, '읽는 중 지워질 글', '본문 하나');
        const edited = await writeSaved(a.page, '고치는 중 지워질 글', '본문 둘');
        await received(b, list => [read, edited].every(id => list.some(item => item.id === id)), 'phone receives both');
        // (m2) B reads one post; A deletes it.
        await openRead(b.page, read);
        await openRead(a.page, read); await a.page.locator('.photo-more summary').first().click();
        a.page.once('dialog', dialog => dialog.accept()); await a.page.getByRole('button', { name: '삭제', exact: true }).click();
        await onServer(server, list => !list.some(item => item.id === read), 'deleted on the server');
        await until(async () => { await kick(b.page); return b.page.locator('.photo-article').count(); }, count => count === 0, 'B leaves the read view');
        assert.match(await b.page.locator('#lifeSaveStatus').innerText(), /다른 기기나 탭에서 삭제된 글이라 목록으로 돌아왔어요/);
        assert.equal(await b.page.getByText('올리기 실패').count(), 0, 'never a failed upload');
        await b.page.screenshot({ path: path.join(output, 'm2-b-after-deletion.png') });
        // (M4) B revises the other post; A deletes it; B saves.
        await openEdit(b.page, edited); await typeTop(b.page, 'B가 길게 고친 내용 '); await sleep(1500);
        await openRead(a.page, edited); await a.page.locator('.photo-more summary').first().click();
        a.page.once('dialog', dialog => dialog.accept()); await a.page.getByRole('button', { name: '삭제', exact: true }).click();
        await onServer(server, list => !list.some(item => item.id === edited), 'deleted on the server');
        await until(async () => { await kick(b.page); return posts(b.page); }, list => !list.some(item => item.id === edited), 'B receives the deletion');
        await b.page.getByRole('button', { name: '글 저장', exact: true }).click(); await b.page.locator('.photo-article').waitFor();
        assert.doesNotMatch(await b.page.locator('#lifeMain').innerText(), /원래 사진 글이 변경됐습니다/);
        const saved = (await posts(b.page)).filter(item => item.status === 'saved');
        assert.equal(saved.length, 1); assert.match(saved[0].text, /B가 길게 고친 내용 본문 둘/); assert.equal(saved[0].replaces, null);
        await onServer(server, list => list.some(item => item.status === 'saved' && /B가 길게 고친 내용/.test(item.text)), 'saved as its own post');
      } finally { await close(); }
    });

    // Review B1 (q2b): a draft deleted in another tab while this tab's input is outside storage. The input is kept as a
    // new draft under a new id (never the deleted id, whose server row would come back at revision 1 and be taken for
    // the version another device holds). The other device receives it, and its later edit keeps it.
    await check('B1: a draft deleted in another tab while input is outside storage: the input is kept under a new id everywhere', async () => {
      const { server, a, b, close } = await pair('b1');
      try {
        const id = await writeDraft(a.page, '지울 초안', '초안 본문.');
        await onServer(server, list => list.some(item => item.id === id), 'draft on the server');
        await received(b, list => list.some(item => item.id === id), 'phone receives');
        const tab2 = await a.context.newPage(); await openHome(tab2);
        await a.page.bringToFront();
        await a.page.locator('#photoTitle').evaluate(n => n.dispatchEvent(new CompositionEvent('compositionstart', { data: '' })));
        await tab2.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(), d = await s.readPhotoPost(w, id); await HaedoLife.BlogSync.forStorage(s).deletePost(w, id, { expectedRevision: d.revision }); }, id);
        await sleep(800);
        await a.page.locator('#photoTitle').evaluate(n => { n.value = '지운 뒤 이어 쓴 제목'; n.dispatchEvent(new CompositionEvent('compositionend', { data: '' })); });
        const kept = (await until(async () => posts(a.page), list => list.some(item => item.title === '지운 뒤 이어 쓴 제목'), 'the input is stored')).find(item => item.title === '지운 뒤 이어 쓴 제목');
        assert.notEqual(kept.id, id, 'under a new id'); assert.equal(kept.replaces, null);
        assert.match((await editor(a.page)).note, /지운 초안이라, 지금 입력은 새 초안으로 보관했어요/);
        await onServer(server, list => !list.some(item => item.id === id) && list.some(item => item.id === kept.id && item.title === '지운 뒤 이어 쓴 제목'), 'the account: deleted id gone, the input under its new id');
        await received(b, list => !list.some(item => item.id === id) && list.some(item => item.id === kept.id), 'the phone: the deleted draft goes, the kept input arrives');
        await closeEditor(a.page);
        // The phone goes on writing what it holds now.
        await openDraft(b.page, kept.id); await typeTop(b.page, '폰에서 덧붙임. '); await sleep(1200); await closeEditor(b.page);
        const both = list => list.some(item => item.id === kept.id && item.title === '지운 뒤 이어 쓴 제목' && /폰에서 덧붙임/.test(item.text));
        await onServer(server, both, 'the phone edit keeps the Mac title');
        await until(async () => { await kick(a.page); return posts(a.page); }, both, 'the Mac converges');
        await tab2.close();
      } finally { await close(); }
    });

    // Review M-a (q1): a revision of a saved post open on the Mac while the phone continues and finishes it.
    await check('M-a: a revision finished on another device: a clean editor shows the saved post and says so; a busy one keeps the input and its save keeps the other version as a recovery copy', async () => {
      const { server, a, b, close } = await pair('ma');
      try {
        const id = await writeSaved(a.page, '다듬는 글', '원문 문단.');
        await received(b, list => list.some(item => item.id === id), 'phone receives');
        const savedId = async page => (await posts(page)).find(item => item.status === 'saved').id;
        const hop = async (busy, word) => {
          await openEdit(a.page, await savedId(a.page)); await typeTop(a.page, '맥 입력 ' + word + '. ');
          await onServer(server, list => list.some(item => item.status === 'draft' && new RegExp('맥 입력 ' + word).test(item.text)), 'Mac revision on the server');
          await received(b, list => list.some(item => item.status === 'draft' && new RegExp('맥 입력 ' + word).test(item.text)), 'phone receives the revision');
          if (busy) await a.page.locator('#photoTitle').evaluate(n => n.dispatchEvent(new CompositionEvent('compositionstart', { data: '' })));
          await openEdit(b.page, await savedId(b.page)); assert.match((await editor(b.page)).body, new RegExp('맥 입력 ' + word), 'the phone continues the same revision');
          await typeTop(b.page, '폰 마무리 ' + word + '. '); await sleep(1200);
          await b.page.getByRole('button', { name: '글 저장', exact: true }).click(); await b.page.locator('.photo-article').waitFor();
          await onServer(server, list => list.some(item => item.status === 'saved' && new RegExp('폰 마무리 ' + word).test(item.text)), 'phone save on the server');
        };
        await hop(false, '하나');
        await until(async () => { await kick(a.page); return a.page.locator('.photo-article').count(); }, count => count === 1, 'the Mac shows the saved post');
        assert.match(await a.page.locator('.photo-status').innerText(), /다른 탭이나 기기에서 이 수정을 글로 저장했어요/);
        assert.match(await a.page.locator('.photo-article').innerText(), /폰 마무리 하나\. 맥 입력 하나\./);
        const one = list => list.filter(item => item.status === 'saved').length === 1 && !list.some(item => item.status === 'draft');
        await until(async () => { await kick(a.page); return posts(a.page); }, one, 'no editing draft is left on the Mac');
        // Busy: the Mac's composition is open when the phone finishes.
        await hop(true, '둘');
        await until(async () => { await kick(a.page); return editor(a.page); }, value => /이 수정을 글로 저장했어요 · 지금 입력을 저장하면 그쪽은 복구 사본으로 남겨요/.test(value.note), 'the Mac says so and keeps the editor');
        assert.equal(await a.page.locator('.ql-editor').count(), 1);
        await a.page.locator('#photoTitle').evaluate(n => { n.value = '맥이 나중에 고친 제목'; n.dispatchEvent(new CompositionEvent('compositionend', { data: '' })); });
        await until(async () => editor(a.page), value => value.status === '자동 저장됨', 'the Mac input is stored');
        await a.page.getByRole('button', { name: '글 저장', exact: true }).click(); await a.page.locator('.photo-article').waitFor();
        const converged = list => list.filter(item => item.status === 'saved').length === 1 && list.some(item => item.status === 'saved' && item.title === '맥이 나중에 고친 제목') &&
          list.some(item => item.status === 'draft' && item.title === KEPT + '다듬는 글' && /폰 마무리 둘/.test(item.text));
        await until(async () => { await kick(a.page); return posts(a.page); }, converged, 'the Mac: one post, the phone version as a recovery copy');
        await onServer(server, list => converged(list) && list.length === 2, 'the account converges');
        await received(b, converged, 'the phone converges');
      } finally { await close(); }
    });

    // Review m-3: a tab that missed the other tab's notice (no BroadcastChannel here) reads storage again when shown.
    // Review U17 (q3c): the list shows the draft gone while the Mac's change to it is still waiting to be sent. It is
    // kept under a new identity; a device that missed the deletion receives it and its later edit keeps it.
    await check('U17: a draft deleted elsewhere while an edit here waits to be sent is kept under a new identity for every device', async () => {
      const server = new FakeCloud(); server.enableAccountLibrary();
      const mac = await device(browser, server, 'u17-mac'), phone = await device(browser, server, 'u17-phone'), ipad = await device(browser, server, 'u17-ipad');
      try {
        const id = await writeDraft(mac.page, '세 기기 초안', '초안 본문.');
        await onServer(server, list => list.some(item => item.id === id), 'draft on the server');
        for (const dev of [phone, ipad]) await received(dev, list => list.some(item => item.id === id), dev.name + ' receives');
        server.offline.add('u17-ipad');
        await phone.page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(); await HaedoLife.BlogSync.forStorage(s).deletePost(w, id); }, id);
        await kick(phone.page); await onServer(server, list => !list.some(item => item.id === id), 'deleted on the server');
        await kick(mac.page); await sleep(3000);
        await typeTop(mac.page, '맥에서 지워진 뒤 쓴 문장. '); await sleep(1200); await closeEditor(mac.page);
        const kept = list => list.some(item => item.id !== id && /맥에서 지워진 뒤 쓴 문장/.test(item.text));
        await until(async () => { await kick(mac.page); return serverPosts(server); }, list => kept(list) && !list.some(item => item.id === id), 'kept under a new identity, the deleted one stays deleted');
        server.offline.delete('u17-ipad');
        const fresh = await received(ipad, list => kept(list) && !list.some(item => item.id === id), 'the iPad receives it and drops the deleted draft');
        const ipadId = fresh.find(item => /맥에서 지워진 뒤 쓴 문장/.test(item.text)).id;
        await openDraft(ipad.page, ipadId); await typeTop(ipad.page, '아이패드 덧붙임. '); await sleep(1200); await closeEditor(ipad.page);
        const both = list => list.some(item => /아이패드 덧붙임\. 맥에서 지워진 뒤 쓴 문장/.test(item.text));
        await onServer(server, both, 'the iPad edit keeps the Mac sentence');
        await until(async () => { await kick(mac.page); return posts(mac.page); }, both, 'the Mac converges');
      } finally { for (const dev of [mac, phone, ipad]) await dev.context.close(); }
    });

    // Review q5 (accepted limit, coordinator 2026-11-12): two devices change a draft offline that a third deletes. Each
    // change is kept as a post of its own; nothing is lost and the deleted identity is never re-created.
    await check('q5: a deleted draft changed offline on two devices: both changes are kept and the deleted identity is not re-created', async () => {
      const server = new FakeCloud(); server.enableAccountLibrary();
      const mac = await device(browser, server, 'q5-mac'), phone = await device(browser, server, 'q5-phone'), ipad = await device(browser, server, 'q5-ipad');
      try {
        const id = await writeDraft(mac.page, '두 기기 고침', '초안 본문.'); await closeEditor(mac.page);
        await onServer(server, list => list.some(item => item.id === id), 'draft on the server');
        for (const dev of [phone, ipad]) await received(dev, list => list.some(item => item.id === id), dev.name + ' receives');
        server.offline.add('q5-mac'); server.offline.add('q5-ipad');
        await openDraft(mac.page, id); await typeTop(mac.page, '맥 오프라인 고침. '); await sleep(1500); await closeEditor(mac.page);
        await sleep(1000);
        await openDraft(ipad.page, id); await typeTop(ipad.page, '아이패드 오프라인 고침. '); await sleep(1500); await closeEditor(ipad.page);
        await phone.page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(); await HaedoLife.BlogSync.forStorage(s).deletePost(w, id); }, id);
        await kick(phone.page); await onServer(server, list => !list.some(item => item.id === id), 'deleted on the server');
        server.offline.delete('q5-mac'); await until(async () => { await kick(mac.page); return serverPosts(server); }, list => list.some(item => /맥 오프라인 고침/.test(item.text)), 'the Mac change is kept');
        server.offline.delete('q5-ipad');
        const both = list => list.some(item => /맥 오프라인 고침/.test(item.text)) && list.some(item => /아이패드 오프라인 고침/.test(item.text));
        await until(async () => { await kick(ipad.page); await kick(mac.page); return serverPosts(server); }, list => both(list) && !list.some(item => item.id === id), 'both changes on the server, the deleted identity not re-created');
        // Devices keep their own local ids (the Mac's post keeps the deleted draft's local id; only its server identity moved).
        for (const dev of [mac, phone, ipad]) await received(dev, both, dev.name + ' has both');
      } finally { for (const dev of [mac, phone, ipad]) await dev.context.close(); }
    });

    // Review (3rd) M-a: a link being written (Quill's link input) the moment a finished revision is followed keeps the
    // editor; the revision is followed once the link input is closed. (An AI suggestion panel is held the same way,
    // editorBusy; it is not opened here because it asks the AI service for its usage.)
    await check('M-a: a link input opened while a revision finished elsewhere is followed keeps the editor', async () => {
      const { server, a, b, close } = await pair('ma-link');
      try {
        const id = await writeSaved(a.page, '링크 입력 글', '원문 문단입니다.');
        await received(b, list => list.some(item => item.id === id), 'phone receives');
        await openEdit(a.page, id); await typeTop(a.page, '맥 입력. ');
        await onServer(server, list => list.some(item => item.status === 'draft' && /맥 입력/.test(item.text)), 'Mac revision on the server');
        await received(b, list => list.some(item => item.status === 'draft' && /맥 입력/.test(item.text)), 'phone receives the revision');
        // The moment the Mac hears that the revision left the server, a link input opens (right after the editor's own handler).
        await a.page.evaluate(() => {
          const sync = HaedoLife.BlogSync.forStorage(HaedoLife.Shell.storage);
          const off = sync.subscribe(event => {
            if (event.type !== 'remote_gone') return; off();
            Quill.find(document.querySelector('.ql-container')).setSelection(0, 2, 'user');
            document.querySelector('.photo-editor .ql-link').click();
            window.__linkOpened = !!document.querySelector('.ql-tooltip.ql-editing:not(.ql-hidden)');
          });
        });
        await openEdit(b.page, (await posts(b.page)).find(item => item.status === 'saved').id); await typeTop(b.page, '폰 마무리. '); await sleep(1200);
        await b.page.getByRole('button', { name: '글 저장', exact: true }).click(); await b.page.locator('.photo-article').waitFor();
        await until(async () => { await kick(a.page); return a.page.evaluate(() => window.__linkOpened); }, value => value === true, 'the link input opened as the Mac heard');
        await sleep(2500);
        assert.equal(await a.page.locator('.ql-editor').count(), 1, 'the editor stays while the link input is open');
        assert.equal(await a.page.locator('.ql-tooltip.ql-editing:not(.ql-hidden)').count(), 1, 'the link input stays open');
        assert.match((await editor(a.page)).note, /이 수정을 글로 저장했어요/);
        await a.page.keyboard.press('Escape');
        await a.page.waitForFunction(() => !document.querySelector('.ql-tooltip.ql-editing:not(.ql-hidden)'));
        await a.page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        await a.page.locator('.photo-article').waitFor();
        assert.match(await a.page.locator('.photo-article').innerText(), /폰 마무리\. 맥 입력\./);
      } finally { await close(); }
    });

    await check('m-3: shown again (visibility, back/forward cache) an open editor or read view reads what storage holds now', async () => {
      const { a, close } = await pair('m3c');
      try {
        const id = await writeDraft(a.page, '다시 볼 초안', '처음 문장.');
        await closeEditor(a.page);
        const post = await writeSaved(a.page, '다시 볼 글', '처음 본문.');
        await home(a.page);
        const tab1 = await a.context.newPage();
        await tab1.addInitScript(() => { window.BroadcastChannel = undefined; });
        await openHome(tab1);
        const setVisibility = (page, state) => page.evaluate(value => { Object.defineProperty(document, 'visibilityState', { get: () => value, configurable: true }); Object.defineProperty(document, 'hidden', { get: () => value === 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, state);
        // A read view restored from the back/forward cache.
        await openRead(tab1, post);
        await a.page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(), d = await s.readPhotoPost(w, id); await s.savePhotoPost(w, { ...d, title: '다른 탭에서 바꾼 글 제목', updatedAt: new Date().toISOString() }, d.revision); }, post);
        await sleep(1500);
        assert.doesNotMatch(await tab1.locator('.photo-article').innerText(), /다른 탭에서 바꾼 글 제목/, 'no notice reached this tab');
        await tab1.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        await until(() => tab1.locator('.photo-article').innerText(), text => /다른 탭에서 바꾼 글 제목/.test(text), 'restored from the back/forward cache: the read view reads it');
        // An open editor shown again after its tab was hidden.
        await openDraft(tab1, id);
        await setVisibility(tab1, 'hidden');
        await a.page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(), d = await s.readPhotoPost(w, id); await s.savePhotoPost(w, { ...d, title: '다른 탭에서 바꾼 제목', updatedAt: new Date().toISOString() }, d.revision); }, id);
        await sleep(1500);
        assert.equal(await tab1.locator('#photoTitle').inputValue(), '다시 볼 초안', 'no notice reached this tab');
        await setVisibility(tab1, 'visible');
        await until(() => tab1.locator('#photoTitle').inputValue(), value => value === '다른 탭에서 바꾼 제목', 'shown again: the editor reads it');
        await tab1.close();
      } finally { await close(); }
    });

    await check('m5: a device whose clock is 10 minutes behind saves its revision of a post just made elsewhere', async () => {
      const { server, a, b, close } = await pair('m5', { init: skewed(-10) });
      try {
        const id = await writeSaved(a.page, '방금 만든 글', '맥에서 씀');
        await received(b, list => list.some(item => item.id === id), 'phone receives the post');
        await openEdit(b.page, id); await typeTop(b.page, '폰에서 바로 고침 ');
        await b.page.getByRole('button', { name: '글 저장', exact: true }).click(); await b.page.locator('.photo-article').waitFor();
        assert.doesNotMatch(await b.page.locator('#lifeMain').innerText(), /날짜 순서/);
        await b.page.locator('#photoServerStatus[data-state="synced"]').waitFor({ timeout: 30000 });
        await onServer(server, list => list.some(item => item.id === id && /폰에서 바로 고침/.test(item.text)), 'the revision reaches the account');
        // Continuing a draft made by the faster clock: typing stores it.
        const draft = await writeDraft(a.page, '맥에서 만든 초안', '첫 줄');
        await closeEditor(a.page);
        await received(b, list => list.some(item => item.id === draft), 'phone receives the draft');
        await openDraft(b.page, draft); await typeTop(b.page, '폰에서 이어 씀 ');
        await until(async () => posts(b.page), list => list.some(item => item.id === draft && /폰에서 이어 씀/.test(item.text)), 'stored, not kept on this device only');
        assert.doesNotMatch((await editor(b.page)).status, /임시 보관|날짜 순서/);
      } finally { await close(); }
    });
  } finally {
    await browser.close();
    report.unexpected = { consoleErrors: report.consoleErrors, pageErrors: report.pageErrors };
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  if (report.pageErrors.length) { console.error('page errors', report.pageErrors); process.exitCode = 1; }
  if (report.consoleErrors.length) { console.error('console errors', report.consoleErrors); process.exitCode = 1; }
  console.log(report.checks.filter(item => item.ok).length + '/' + report.checks.length + ' checks');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
