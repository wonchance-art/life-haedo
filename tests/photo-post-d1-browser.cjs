/* D1 writing/reading screen behaviour (2026-11-04 review of PR #186), on the real app with the anonymous
 * ShareCloud account and real IndexedDB. Covers the title field (Enter, multi-line paste, the 500-character
 * limit, IME composition), 글 정보 (open/close/focus, publication shown only when known, the account upload
 * retry), 공개하기 reaching the review without publishing, and the revision mark on the pill.
 * BASE_URL=http://127.0.0.1:4173 node tests/photo-post-d1-browser.cjs
 * Never uses real Google, production Supabase or Apple-device claims. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { accounts, base } = require('./life-sync-browser.cjs');
const { ShareCloud } = require('./life-share-browser.cjs');
const { playwright, ready, settle, makeContext, nav } = require('./unified-home-browser.cjs');
const { seed } = require('./sns-blog-experience-browser.cjs');

const output = path.resolve(process.env.PHOTO_POST_D1_OUTPUT || '.local/photo-post-d1');
const report = { checks: [], consoleErrors: [], pageErrors: [] };
// BlogSync instances get a test seam: getState can be held (window.__blogStateGate), refused
// (window.__blogStateFail) or report a forced status (window.__blogForceStatus); saveDefault calls are counted.
const BLOG_SYNC_SEAM = `;(()=>{const B=HaedoLife.BlogSync;if(!B)return;HaedoLife.BlogSync=Object.freeze({...B,create(...args){const s=B.create(...args);
return Object.freeze({...s,async getState(...a){if(window.__blogStateGate)await window.__blogStateGate;if(window.__blogStateFail)throw Object.assign(new Error('fixture state refused'),{code:'network_error'});
const state=await s.getState(...a);return window.__blogForceStatus?{...state,status:window.__blogForceStatus}:state;},
async saveDefault(...a){window.__saveDefaultCalls=(window.__saveDefaultCalls||0)+1;return s.saveDefault(...a);}});}});})();`;

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  let count = 0;
  async function open(viewport) {
    const server = new ShareCloud(), device = 'photo-d1-' + (count++);
    const context = await makeContext(browser, server, device, null, { viewport, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
    await context.route(base + '/assets/life/blog-sync.js', async route => {
      const response = await route.fetch(), source = await response.text();
      await route.fulfill({ response, body: source + BLOG_SYNC_SEAM, headers: { ...response.headers(), 'content-type': 'text/javascript' } });
    });
    const publishes = [];
    context.on('request', request => { if (/\/rest\/v1\/rpc\/life_blog_(publish|unpublish)/.test(request.url())) publishes.push(request.url()); });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push(event.text()); });
    await page.goto(base + '/index.html'); await page.waitForFunction(() => globalThis.HaedoLife?.Shell); await page.evaluate(() => HaedoLife.Shell.ready);
    server.oauthAccounts.set(device, accounts.a); await page.locator('[data-life-login]').click(); await page.locator('#googleLogin').click();
    await page.waitForURL(u => u.pathname.endsWith('/index.html')); await ready(page);
    return { context, page, publishes };
  }
  async function check(name, viewport, run) {
    if (process.env.PHOTO_POST_D1_MATCH && !new RegExp(process.env.PHOTO_POST_D1_MATCH).test(name)) return;
    const { context, page, publishes } = await open(viewport);
    try { await run({ page, publishes }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
  }
  const title = page => page.locator('#photoTitle');
  const status = page => page.locator('.photo-status');
  const closeEditor = page => page.locator('#photoTitle').waitFor({ timeout: 8000 }).then(() => page.getByRole('button', { name: '닫기', exact: true }).click(), () => {});
  // Seed saved posts (synced to the anonymous account) and open the first one in the read view.
  async function readSaved(page) {
    await closeEditor(page);
    const sample = await seed(page); await page.reload(); await ready(page);
    await nav(page, 'home'); await page.locator('#homePosts[aria-busy="false"]').waitFor(); await settle(page);
    return sample;
  }
  async function openPost(page, id) {
    await page.locator(`#homePosts .home-post[data-photo-post-id="${id}"] .home-post-open`).click(); await page.locator('.photo-article').waitFor();
  }
  const paste = (page, text) => page.evaluate(text => {
    const t = document.querySelector('#photoTitle'); t.focus();
    const data = new DataTransfer(); data.setData('text/plain', text);
    t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    return t.value;
  }, text);
  const setTitle = (page, value) => page.evaluate(value => {
    const t = document.querySelector('#photoTitle'); t.focus(); t.value = value; t.setSelectionRange(value.length, value.length);
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  const pillText = page => page.locator('.photo-privacy').innerText();
  const pillName = page => page.locator('.photo-privacy').getAttribute('aria-label');

  try {
    await check('title: Enter goes to the body, pasted line breaks become spaces, a long paste is clipped to 500 and the draft still saves', { width: 1440, height: 1000 }, async ({ page }) => {
      await title(page).waitFor();
      await title(page).fill('첫 줄 제목'); await title(page).press('Enter');
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.ql-editor')), true, 'Enter moves to the body');
      assert.equal(await title(page).inputValue(), '첫 줄 제목', 'Enter adds no line to the title');
      await page.locator('.ql-editor').pressSequentially('본문 한 줄');
      await setTitle(page, '');
      assert.equal(await paste(page, '산책 기록\n둘째 줄\r\n  셋째 줄'), '산책 기록 둘째 줄 셋째 줄');
      // Review MAJOR-1: setRangeText ignores maxLength; a 700-character multi-line paste used to make every save fail.
      await setTitle(page, '');
      const long = await paste(page, '가나다라마바사아자차\n'.repeat(70));
      assert.ok(long.length <= 500, 'clipped to the title limit, got ' + long.length);
      assert.equal(/[\r\n]/.test(long), false);
      await page.waitForFunction(() => document.querySelector('.photo-status')?.textContent === '자동 저장됨');
      assert.equal(await status(page).getAttribute('data-state'), 'draft', 'autosave succeeded, no error');
      // At the limit, a surrogate pair that does not fit is dropped whole (a lone half would be refused on save).
      await setTitle(page, 'ㄱ'.repeat(499));
      const edge = await paste(page, '🌱\n🌱');
      assert.equal(edge.length, 499, 'no half of an emoji is inserted');
      await page.waitForFunction(() => document.querySelector('.photo-status')?.textContent === '자동 저장됨');
      const stored = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); const list = await s.listPhotoPosts(w); return Promise.all(list.map(v => s.readPhotoPost(w, v.id).then(d => d.title))); });
      assert.ok(stored.includes('ㄱ'.repeat(499)), 'the stored draft has the clipped title');
    });

    await check('title: IME composition is never altered; a composed line break is cleaned when composition ends', { width: 390, height: 844 }, async ({ page }) => {
      await title(page).waitFor();
      const during = await page.evaluate(() => {
        const t = document.querySelector('#photoTitle'); t.focus();
        t.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
        t.value = '가\n나'; t.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: '나' }));
        return t.value;
      });
      assert.equal(during, '가\n나', 'the value is left alone while composing');
      const after = await page.evaluate(() => { const t = document.querySelector('#photoTitle'); t.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '나' })); return t.value; });
      assert.equal(after, '가 나', 'cleaned at compositionend (review MINOR-1)');
    });

    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) await check(viewport.width + ': 글 정보 opens from the pill; Esc and a tap outside close it and return focus to the pill', viewport, async ({ page }) => {
      const sample = await readSaved(page); await openPost(page, sample.postIds[0]);
      await page.locator('#photoServerStatus[data-state="synced"]').waitFor();
      await page.locator('.photo-privacy').click(); await page.locator('dialog.photo-info[open]').waitFor();
      await page.keyboard.press('Escape'); await page.locator('dialog.photo-info').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('photo-privacy')), true, 'Esc returns focus to the pill');
      await page.locator('.photo-privacy').click(); await page.locator('dialog.photo-info[open]').waitFor();
      await page.mouse.click(8, 8); await page.locator('dialog.photo-info').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('photo-privacy')), true, 'an outside tap returns focus to the pill');
    });

    await check('publication not yet known or not readable is never shown as 비공개 (review MINOR-2)', { width: 1440, height: 1000 }, async ({ page }) => {
      const sample = await readSaved(page);
      await page.evaluate(() => { window.__blogStateGate = new Promise(resolve => { window.__releaseBlogState = resolve; }); });
      await openPost(page, sample.postIds[0]);
      assert.equal(await pillText(page), '글 정보');
      assert.match(await pillName(page), /^공개 여부 확인 중/);
      await page.locator('.photo-privacy').click(); await page.locator('dialog.photo-info[open]').waitFor();
      const sheet = await page.locator('dialog.photo-info').innerText();
      assert.match(sheet, /확인 중/); assert.doesNotMatch(sheet, /비공개|따로 선택합니다/);
      await page.evaluate(() => window.__releaseBlogState());
      await page.waitForFunction(() => /비공개/.test(document.querySelector('dialog.photo-info')?.innerText || ''));
      await page.keyboard.press('Escape'); await page.locator('dialog.photo-info').waitFor({ state: 'detached' });
      assert.equal(await pillText(page), '비공개', 'known private after the read');
      // A refused read: still not 비공개.
      await page.evaluate(() => { window.__blogStateGate = null; window.__blogStateFail = true; });
      await nav(page, 'home'); await page.locator('#homePosts[aria-busy="false"]').waitFor(); await openPost(page, sample.postIds[1]);
      await page.waitForFunction(() => /공개 여부 확인 못 함/.test(document.querySelector('.photo-privacy')?.getAttribute('aria-label') || ''));
      assert.doesNotMatch(await pillText(page), /비공개/);
    });

    await check('계정에 다시 올리기 in 글 정보 runs the account upload and keeps focus inside the sheet (review MINOR-3)', { width: 1440, height: 1000 }, async ({ page }) => {
      const sample = await readSaved(page);
      await page.evaluate(() => { window.__blogForceStatus = 'error'; window.__saveDefaultCalls = 0; });
      await openPost(page, sample.postIds[0]);
      await page.locator('#photoServerStatus[data-state="error"]').waitFor();
      await page.locator('.photo-privacy').click(); await page.locator('dialog.photo-info[open]').waitFor();
      await page.evaluate(() => { window.__blogForceStatus = null; });
      await page.locator('dialog.photo-info').getByRole('button', { name: '계정에 다시 올리기', exact: true }).click();
      await page.waitForFunction(() => window.__saveDefaultCalls === 1);
      await page.waitForFunction(() => document.querySelector('dialog.photo-info [data-state]')?.dataset.state === 'synced');
      const focus = await page.evaluate(() => ({ body: document.activeElement === document.body, inSheet: !!document.activeElement?.closest('dialog.photo-info') }));
      assert.deepEqual(focus, { body: false, inSheet: true });
    });

    await check('공개하기 in 글 정보 opens the publish review and publishes nothing', { width: 1440, height: 1000 }, async ({ page, publishes }) => {
      const sample = await readSaved(page); await openPost(page, sample.postIds[0]);
      await page.locator('#photoServerStatus[data-state="synced"]').waitFor();
      await page.locator('.photo-privacy').click(); await page.locator('dialog.photo-info[open]').waitFor();
      await page.locator('dialog.photo-info').getByRole('button', { name: '공개하기', exact: true }).click();
      await page.getByRole('button', { name: '공개 내용 검토', exact: true }).click(); await page.locator('.blog-manager-preview').waitFor();
      assert.deepEqual(publishes, [], 'reaching the review publishes nothing');
    });

    await check('editing a saved post says so on the pill', { width: 390, height: 844 }, async ({ page }) => {
      const sample = await readSaved(page); await openPost(page, sample.postIds[0]);
      await page.locator('#photoServerStatus[data-state="synced"]').waitFor();
      await page.getByRole('button', { name: '글 수정', exact: true }).click(); await title(page).waitFor();
      await page.waitForFunction(() => /수정 중/.test(document.querySelector('.photo-privacy')?.innerText || ''));
      assert.match(await pillName(page), /기존 글 수정 중/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no sideways scroll at 390');
    });
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.pageErrors, [], 'page errors'); assert.deepEqual(report.consoleErrors, [], 'console errors');
  assert(report.checks.length && report.checks.every(item => item.pass), 'all checks pass');
  console.log(JSON.stringify({ checks: report.checks.length }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
