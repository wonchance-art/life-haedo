/* Page drafts (legacy page composer) and the public cover editor open on two devices of one account:
 * a field that only has the cursor is not a conflict. The other device's change is taken quietly, the
 * cursor stays, and the next input is stored. Input that is really unsaved (a Korean composition here)
 * still gets the existing comparison / reload step and is not touched.
 * Real local UI, bundled SDK, scoped IndexedDB and the account-document sync engine; Auth and the
 * account-document RPCs are the anonymous FakeCloud. The public page RPCs answer "nothing published"
 * (the cover's publication is not what this checks; tests/public-cover-browser.cjs does that on SQL).
 * The composition is Chromium's Input.imeSetComposition, not a real Korean keyboard or Apple device. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const output = path.resolve(process.env.ACCOUNT_DOC_FOCUS_OUTPUT || '.local/account-doc-focus-sync-browser');
const report = { createdAt: new Date().toISOString(), checks: [], consoleErrors: [], pageErrors: [] };
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(read, accept, label, timeout = 20000) {
  const deadline = Date.now() + timeout; let value;
  for (;;) {
    value = await read(); if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error('timed out: ' + label + ' — last ' + JSON.stringify(value)?.slice(0, 900));
    await sleep(100);
  }
}
const kick = page => page.evaluate(() => { dispatchEvent(new Event('online')); });
const serverDoc = (server, prefix) => [...(server.accountDocs.get(accounts.a.id) || new Map()).entries()].find(([key]) => key.startsWith(prefix + ':'))?.[1]?.data || null;
// Page drafts ---------------------------------------------------------------------------------------
async function openDrafts(page) {
  await page.goto(base + '/index.html?section=records&view=page'); await ready(page);
  const compatibility = page.locator('.wb-page-compatibility'); await compatibility.waitFor();
  if (!await compatibility.evaluate(node => node.open)) await compatibility.locator(':scope > summary').click();
  await page.locator('.pp-toolbar').waitFor();
}
const drafts = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.readPageDrafts(await s.getActive())).posts.map(draft => draft.body); });
const addDraft = (page, body) => page.evaluate(async body => {
  const s = HaedoLife.Shell.storage, w = await s.getActive(), value = await s.readPageDrafts(w), draft = HaedoLife.PagePosts.draft([], HaedoLife.Core.id(), new Date().toISOString());
  draft.body = body; value.posts.push(draft); await s.savePageDrafts(w, value, value.revision);
}, body);
const compare = page => page.getByRole('button', { name: '최신 초안과 비교', exact: true });
async function draftOnBoth(a, b, server) {
  await openDrafts(a); await openDrafts(b);
  await a.locator('.pp-legacy-writing > summary').click(); await a.getByRole('button', { name: '대상 첨부 글쓰기', exact: true }).click();
  await a.locator('#ppBody').fill('맥의 첫 초안');
  await until(() => serverDoc(server, 'page-drafts')?.posts.map(draft => draft.body), value => value?.includes('맥의 첫 초안'), 'A draft on the account');
  await kick(b); await until(() => drafts(b), value => value.includes('맥의 첫 초안'), 'B has the draft');
}
// Public cover --------------------------------------------------------------------------------------
async function openCover(page) {
  await page.goto(base + '/index.html?section=manage&view=public-cover'); await ready(page);
  await page.locator('#publicCoverEditor[aria-busy="false"]').waitFor(); await page.locator('#pcNew:not([disabled])').waitFor();
}
const covers = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.readPublicCover(await s.getActive())).covers.map(cover => cover.title + ' / ' + cover.intro); });
const setIntro = (page, intro) => page.evaluate(async intro => {
  const s = HaedoLife.Shell.storage, w = await s.getActive(), value = await s.readPublicCover(w); value.covers[0].intro = intro; await s.savePublicCover(w, value, value.revision);
}, intro);
async function coverOnBoth(a, b, server) {
  await openCover(a); await openCover(b);
  await a.locator('#pcNew').click(); await a.locator('#pcTitle').fill('맥의 표지'); await a.locator('#pcSaveStatus[data-state="saved"]').waitFor();
  await until(() => serverDoc(server, 'public-cover')?.covers.map(cover => cover.title), value => value?.includes('맥의 표지'), 'A cover on the account');
  await kick(b); await until(() => covers(b), value => value.some(text => text.startsWith('맥의 표지')), 'B has the cover');
}

async function main() {
  await fs.rm(output, { recursive: true, force: true }); await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function check(name, run) {
    if (process.env.ACCOUNT_DOC_FOCUS_MATCH && !new RegExp(process.env.ACCOUNT_DOC_FOCUS_MATCH).test(name)) return;
    const server = new FakeCloud(); server.enableAccountLibrary();
    const contexts = [], pages = [];
    const device = async label => {
      const context = await makeContext(browser, server, label + '-' + report.checks.length, accounts.a, { viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
      // Nothing is published in these checks: the public page list and state are empty.
      await context.route('**/rest/v1/rpc/life_public_page_*', route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
      contexts.push(context);
      context.on('page', page => {
        page.setDefaultTimeout(15000); pages.push(page);
        page.on('pageerror', error => report.pageErrors.push({ check: name, device: label, message: error.message }));
        page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ check: name, device: label, message: event.text() }); });
      });
      return { context, page: await context.newPage() };
    };
    console.log('RUN ' + name);
    try { await run({ device, server }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      for (const [index, page] of pages.entries()) await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '-' + index + '.png'), fullPage: true }).catch(() => {});
    } finally { for (const context of contexts) await context.close(); }
  }
  try {
    await check('page drafts: a body that only has the cursor takes the other device\'s draft quietly and keeps saving', async ({ device, server }) => {
      const a = (await device('mac')).page, b = (await device('phone')).page; await draftOnBoth(a, b, server);
      await addDraft(b, '폰에서 새로 시작한 초안');
      await until(() => serverDoc(server, 'page-drafts').posts.map(draft => draft.body), value => value.includes('폰에서 새로 시작한 초안'), 'B draft on the account');
      await a.locator('#ppBody').evaluate(el => { window.__field = el; el.focus(); el.setSelectionRange(2, 2); });
      await kick(a); await until(() => drafts(a), value => value.includes('폰에서 새로 시작한 초안'), 'A storage has B\'s draft');
      await until(() => a.locator('.pp-drafts > summary').textContent().catch(() => null), text => text === '초안 1', 'A lists the other draft');
      assert.deepEqual(await a.locator('#ppBody').evaluate(el => ({ same: el === __field, focused: document.activeElement === el, value: el.value, start: el.selectionStart, end: el.selectionEnd })),
        { same: true, focused: true, value: '맥의 첫 초안', start: 2, end: 2 }, 'the body kept its node, text and caret');
      assert.equal(await compare(a).count(), 0, 'no comparison step'); assert.equal(await a.locator('.pp-status').textContent(), '');
      await a.keyboard.type(' 긴');
      await until(() => serverDoc(server, 'page-drafts').posts.map(draft => draft.body).sort(), value => value.join('|') === ['맥의 긴 첫 초안', '폰에서 새로 시작한 초안'].sort().join('|'), 'A input after the arrival is on the account with B\'s draft');
      assert.equal(await compare(a).count(), 0); assert.equal(await a.locator('.pp-status').textContent(), '');
      // The same open draft changed there (nothing unsaved here): the latest text, cursor still in the body.
      await kick(b); await until(() => drafts(b), value => value.includes('맥의 긴 첫 초안'), 'B has A\'s text');
      await b.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(), value = await s.readPageDrafts(w), draft = value.posts.find(item => item.body === '맥의 긴 첫 초안'); draft.body = '폰에서 고친 첫 초안'; draft.updatedAt = new Date().toISOString(); await s.savePageDrafts(w, value, value.revision); });
      await until(() => serverDoc(server, 'page-drafts').posts.map(draft => draft.body), value => value.includes('폰에서 고친 첫 초안'), 'B edit on the account');
      await kick(a); await until(() => a.locator('#ppBody').inputValue(), value => value === '폰에서 고친 첫 초안', 'A shows the open draft\'s latest text');
      assert.equal(await a.evaluate(() => document.activeElement?.id), 'ppBody'); assert.equal(await compare(a).count(), 0);
    });

    await check('page drafts: a composition in progress is untouched and still gets the comparison step', async ({ device, server }) => {
      const mac = await device('mac'), a = mac.page, b = (await device('phone')).page; await draftOnBoth(a, b, server);
      const cdp = await mac.context.newCDPSession(a); await a.bringToFront();
      await a.locator('#ppBody').evaluate(el => { window.__field = el; el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
      await cdp.send('Input.imeSetComposition', { text: ' 한', selectionStart: 2, selectionEnd: 2 });
      await addDraft(b, '폰에서 새로 시작한 초안');
      await until(() => serverDoc(server, 'page-drafts').posts.map(draft => draft.body), value => value.includes('폰에서 새로 시작한 초안'), 'B draft on the account');
      await kick(a); await compare(a).waitFor();
      assert.deepEqual(await a.locator('#ppBody').evaluate(el => ({ same: el === __field, focused: document.activeElement === el, value: el.value })), { same: true, focused: true, value: '맥의 첫 초안 한' });
    });

    await check('public cover: a title that only has the cursor takes the other device\'s change quietly and keeps saving', async ({ device, server }) => {
      const a = (await device('mac')).page, b = (await device('phone')).page; await coverOnBoth(a, b, server);
      await setIntro(b, '폰에서 쓴 소개');
      await until(() => serverDoc(server, 'public-cover').covers[0].intro, value => value === '폰에서 쓴 소개', 'B intro on the account');
      await a.locator('#pcTitle').evaluate(el => { window.__field = el; el.focus(); el.setSelectionRange(2, 2); });
      await kick(a); await until(() => a.locator('#pcIntro').inputValue(), value => value === '폰에서 쓴 소개', 'A shows B\'s intro');
      assert.deepEqual(await a.locator('#pcTitle').evaluate(el => ({ same: el === __field, focused: document.activeElement === el, value: el.value, start: el.selectionStart, end: el.selectionEnd })),
        { same: true, focused: true, value: '맥의 표지', start: 2, end: 2 }, 'the title kept its node, text and caret');
      assert.equal(await a.locator('#pcRemoteReload').isVisible(), false, 'no reload step'); assert.equal(await a.locator('#pcError').isVisible(), false);
      await a.keyboard.type(' 새');
      await until(() => serverDoc(server, 'public-cover').covers.map(cover => cover.title + ' / ' + cover.intro), value => value.join('|') === '맥의 새 표지 / 폰에서 쓴 소개', 'A input after the arrival is on the account with B\'s intro');
      await a.locator('#pcSaveStatus[data-state="saved"]').waitFor();
      assert.equal(await a.locator('#pcError').isVisible(), false); assert.equal(await a.locator('#pcRecover').isVisible(), false); assert.equal(await a.locator('#pcRemoteReload').isVisible(), false);
      // The field with the cursor changed there (nothing unsaved here): the latest text, cursor still in it.
      await kick(b); await until(() => covers(b), value => value[0] === '맥의 새 표지 / 폰에서 쓴 소개', 'B has A\'s title');
      await b.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(), value = await s.readPublicCover(w); value.covers[0].title = '폰에서 고친 표지'; await s.savePublicCover(w, value, value.revision); });
      await until(() => serverDoc(server, 'public-cover').covers[0].title, value => value === '폰에서 고친 표지', 'B title on the account');
      await kick(a); await until(() => a.locator('#pcTitle').inputValue(), value => value === '폰에서 고친 표지', 'A shows the latest title');
      assert.equal(await a.locator('#pcTitle').evaluate(el => el === __field && document.activeElement === el), true);
      await a.keyboard.press('End'); await a.keyboard.type('!');
      await until(() => serverDoc(server, 'public-cover').covers[0].title, value => value === '폰에서 고친 표지!', 'the field still writes to the open cover');
    });

    await check('public cover: a composition in progress is untouched and still gets the reload step', async ({ device, server }) => {
      const mac = await device('mac'), a = mac.page, b = (await device('phone')).page; await coverOnBoth(a, b, server);
      const cdp = await mac.context.newCDPSession(a); await a.bringToFront();
      await a.locator('#pcTitle').evaluate(el => { window.__field = el; el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
      await cdp.send('Input.imeSetComposition', { text: ' 한', selectionStart: 2, selectionEnd: 2 });
      await setIntro(b, '폰에서 쓴 소개');
      await until(() => serverDoc(server, 'public-cover').covers[0].intro, value => value === '폰에서 쓴 소개', 'B intro on the account');
      await kick(a); await a.locator('#pcRemoteReload').waitFor({ state: 'visible' });
      assert.deepEqual(await a.locator('#pcTitle').evaluate(el => ({ same: el === __field, focused: document.activeElement === el, value: el.value })), { same: true, focused: true, value: '맥의 표지 한' });
      assert.equal(await a.locator('#pcIntro').inputValue(), '', 'nothing was replaced under the composition');
    });
  } finally {
    await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  for (const key of ['consoleErrors', 'pageErrors']) assert.deepEqual(report[key], [], key);
  assert.ok(report.checks.length > 0 && report.checks.every(row => row.pass), 'every check passed');
  console.log('Account document focus sync: ' + report.checks.length + ' passed; console/page errors 0.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
