/* Native WAAPI frames and real app/SDK/IndexedDB flows. Synthetic Auth only.
 * BASE_URL=http://127.0.0.1:4173 PW_MODULE_PATH=/existing/playwright node tests/app-motion-browser.cjs
 * Viewport/touch/keyboard simulation does not exercise Apple hardware or IME.
 */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base, cloud } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav, observe } = require('./unified-home-browser.cjs');
const { seed } = require('./blog-user-journeys-browser.cjs');
const out = path.resolve('.local/app-native/qa');
const report = { createdAt: new Date().toISOString(), scope: 'Linux Chromium native WAAPI/rAF, actual app and account-scoped IndexedDB; intercepted anonymous Auth. Emulated viewports/touch/keyboard, no Apple hardware, IME, live OAuth/DB, publication or deployment.', checks: [], frames: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [] };

async function instrument(context) {
  await context.addInitScript(() => {
    window.__nativeMotion = { calls: [], animations: [] };
    window.__nativeHold = false; window.__nativeHeld = false;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args), target = this;
      const record = { target: target.id || target.className, call: __nativeMotion.activeCall, frames: [], animation, element: target, keyframes: animation.effect.getKeyframes() };
      __nativeMotion.animations.push(record);
      const sample = () => {
        const css = getComputedStyle(target);
        record.frames.push({ time: animation.currentTime, state: animation.playState, opacity: css.opacity, transform: css.transform, connected: target.isConnected });
        if (record.frames.length < 60 && ['running', 'pending'].includes(animation.playState)) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      return animation;
    };
  });
  await context.route('**/assets/haedo-motion.js', async route => {
    const response = await route.fetch();
    const hook = `\n;(()=>{const original=HaedoMotion;globalThis.HaedoMotion=Object.freeze({...original,...Object.fromEntries(['enter','feedback'].map(method=>[method,function(element,options){const call={method,options,mode:document.querySelector('#lifeMain')?.dataset.mode,target:element?.id||element?.className,connected:!!element?.isConnected};__nativeMotion.calls.push(call);__nativeMotion.activeCall=call;try{return original[method](element,options);}finally{__nativeMotion.activeCall=null;}}]))});})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
  await context.route('**/assets/life/storage.js', async route => {
    const response = await route.fetch();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async listPhotoPosts(...values){const result=await actual.listPhotoPosts(...values);if(window.__nativeHold){window.__nativeHeld=true;await new Promise(resolve=>window.__nativeRelease=()=>{window.__nativeHold=false;resolve();});}return result;}});}});})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
}
async function open(page) { await page.goto(base + '/index.html'); await ready(page); await loaded(page); }
async function loaded(page) { await page.locator('#homePosts[aria-busy="false"]').waitFor(); }
async function cleanTrace(page) { await page.evaluate(() => { __nativeMotion.calls.length = 0; __nativeMotion.animations.length = 0; }); }
async function idle(page) { await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running')); }
async function enterFrames(page, kind) {
  await page.waitForFunction(kind => __nativeMotion.calls.some(call => call.method === 'enter' && call.options?.kind === kind), kind);
  await page.waitForFunction(kind => __nativeMotion.animations.some(record => record.call?.options?.kind === kind && record.frames.filter(frame => frame.time > 0 && frame.state === 'running').length >= 2), kind);
  await idle(page);
  const frames = await page.evaluate(kind => __nativeMotion.animations.filter(record => record.call?.options?.kind === kind).map(({ target, frames, keyframes }) => ({ target, frames, keyframes })), kind);
  assert(frames.some(record => new Set(record.frames.map(frame => frame.transform + '/' + frame.opacity)).size > 1), 'Native animation must paint distinct intermediate frames');
  report.frames.push({ kind, animations: frames });
}
async function compose(page) { await page.locator('[data-home-destination="write"]:visible,#homeFirstWrite:visible').first().click(); await page.locator('.ql-editor').waitFor(); }
async function search(page, text) {
  if (!await page.locator('#homePostSearch').isVisible()) await page.locator('.home-search-toggle').click();
  await page.locator('#homePostSearch').fill(text);
}
async function failWrites(page) {
  await page.evaluate(() => {
    window.__nativePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { const request = __nativePut.apply(this, args); if (args[0]?.key?.startsWith('photo-post:')) this.transaction.abort(); return request; };
  });
}

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function check(name, run, options = {}) {
    if (process.env.MOTION_TEST_MATCH && !new RegExp(process.env.MOTION_TEST_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'native-' + report.checks.length;
    const context = await makeContext(browser, server, device, accounts.a, { viewport: { width: 390, height: 844 }, hasTouch: true, ...options });
    await instrument(context);
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try { await run({ page, context, server, device }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  try {
    await check('push, back and tab paint real intermediate native animation frames', async ({ page }) => {
      await open(page); const refs = await seed(page); await page.reload(); await ready(page); await loaded(page); await idle(page); await cleanTrace(page);
      await page.locator(`[data-photo-post-id="${refs.ids[0]}"] .home-post-open`).click(); await page.locator('.photo-article').waitFor(); await enterFrames(page, 'push');
      await cleanTrace(page); await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).click(); await loaded(page); await enterFrames(page, 'back');
      await cleanTrace(page); await page.locator('#homeTab-drafts').click(); await enterFrames(page, 'tab');
      assert.equal(await page.locator('#homeTab-drafts').getAttribute('aria-selected'), 'true');
    });
    await check('composer has one header, immediate body focus and reachable controls at five viewport shapes', async ({ page }) => {
      await open(page); await idle(page); await cleanTrace(page); await compose(page); await enterFrames(page, 'compose');
      await page.waitForFunction(() => document.activeElement?.classList.contains('ql-editor'));
      await page.locator('.ql-editor').fill('화면이 좁아져도 남아 있는 한글 입력 🌱\n'.repeat(30));
      for (const size of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 820, height: 1000 }, { width: 1440, height: 1000 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(size); await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
        assert.equal(await page.locator('.photo-editor-tools:visible').count(), 1); assert.equal(await page.getByRole('button', { name: '닫기', exact: true }).count(), 1);
        assert.equal(await page.locator('#lifeApp .haedo-page-heading:visible').count(), 0, 'Composer owns its only header');
        if (size.width <= 760) assert.equal(await page.locator('[data-haedo-navigation]').isVisible(), false);
        const geometry = await page.locator('.photo-save').evaluate(element => { const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, right: box.right, overflow: document.documentElement.scrollWidth > innerWidth }; });
        assert(!geometry.overflow); assert(geometry.top >= 0 && geometry.bottom <= size.height && geometry.right <= size.width);
      }
      // A viewport reduction approximates keyboard occlusion; it is not a native IME test.
      await page.setViewportSize({ width: 390, height: 410 }); await page.locator('.ql-editor').focus(); await page.keyboard.press('End'); await page.keyboard.type('keyboard');
      assert.match(await page.locator('.ql-editor').innerText(), /keyboard/);
      await page.locator('.photo-save').scrollIntoViewIfNeeded(); assert(await page.locator('.photo-save').evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }));
    });
    await check('failed draft flush preserves input, header and committed menu without false entrance or save feedback', async ({ page }) => {
      await open(page); await compose(page); await idle(page); await failWrites(page); await page.locator('.ql-editor').fill('저장 실패 뒤에도 그대로 남는 문장');
      await page.locator('.photo-status[role="alert"]').waitFor(); await cleanTrace(page);
      await page.evaluate(() => document.querySelector('[data-haedo-section="tools"]').click()); await page.locator('#lifeError:not([hidden])').waitFor();
      assert.equal((await page.locator('.ql-editor').innerText()).trim(), '저장 실패 뒤에도 그대로 남는 문장');
      assert.equal(await page.locator('[data-haedo-navigation] [data-haedo-section="home"]').getAttribute('aria-current'), 'page');
      assert.equal(await page.locator('.photo-status').getAttribute('data-state'), 'error');
      assert.equal(await page.locator('.photo-status-check').isVisible(), false);
      assert.deepEqual(await page.evaluate(() => __nativeMotion.calls.filter(call => call.method === 'enter' || call.options?.state === 'saved')), []);
      await page.evaluate(() => { IDBObjectStore.prototype.put = __nativePut; });
      await page.getByRole('button', { name: '다시 보관', exact: true }).click(); await page.locator('.photo-status[data-state="draft"]').waitFor();
      assert.deepEqual(await page.evaluate(() => __nativeMotion.calls.filter(call => call.method === 'feedback' && call.options?.state === 'saved')), []);
      await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
      await page.waitForFunction(() => __nativeMotion.calls.some(call => call.method === 'feedback' && call.options?.state === 'saved'));
      assert.equal(await page.locator('.photo-status').getAttribute('data-state'), 'success'); assert.match(await page.locator('.photo-status').innerText(), /비공개 글을 저장했어요/);
      assert.equal(await page.locator('.photo-status-check').isVisible(), true);
      assert.equal(await page.evaluate(async () => { const s = HaedoLife.Shell.storage, id = await s.getActive(); return (await s.listPhotoPosts(id)).filter(doc => doc.status === 'saved').length; }), 1);
    });
    await check('reduced motion at load keeps compose, save and return immediately usable', async ({ page }) => {
      await open(page); await compose(page); await page.locator('.ql-editor').fill('동작 줄이기에서도 실제 저장');
      await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
      await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).click(); await loaded(page);
      assert.equal(await page.evaluate(() => __nativeMotion.animations.length), 0);
      assert.equal(await page.locator('#homePosts .home-post').count(), 1);
    }, { reducedMotion: 'reduce' });
    await check('changing reduced motion during a running entrance cancels its effects without blocking another action', async ({ page }) => {
      await open(page); await idle(page); await cleanTrace(page);
      await page.evaluate(() => [...document.querySelectorAll('[data-home-destination="write"],#homeFirstWrite')].find(element => element.checkVisibility()).click());
      await page.waitForFunction(() => __nativeMotion.animations.some(record => record.animation.playState === 'running'));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => __nativeMotion.animations.every(record => record.animation.playState !== 'running'));
      assert.equal(await page.locator('.ql-editor').evaluate(element => getComputedStyle(element.closest('.photo-editor')).opacity), '1');
      await page.locator('.ql-editor').fill('중간 설정 변경 뒤에도 입력'); await page.getByRole('button', { name: '닫기', exact: true }).click(); await loaded(page);
      await nav(page, 'tools'); assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'tools');
    });
    await check('rapid section taps end at the last destination and indicator paints inside its selected link', async ({ page }) => {
      await open(page); await idle(page); await cleanTrace(page);
      await page.evaluate(async () => { for (const section of ['records', 'tools', 'manage', 'home', 'tools']) { document.querySelector(`[data-haedo-section="${section}"]`).click(); await new Promise(resolve => setTimeout(resolve, 35)); } });
      await page.waitForFunction(() => document.querySelector('#lifeMain')?.dataset.mode === 'tools'); await settle(page); await idle(page);
      const result = await page.evaluate(() => { const nav = document.querySelector('[data-haedo-navigation]'), selected = nav.querySelector('[aria-current="page"]'), marker = nav.querySelector('.haedo-nav-indicator'), a = selected.getBoundingClientRect(), b = marker.getBoundingClientRect(); return { selected: selected.dataset.haedoSection, left: Math.abs(a.left - b.left), top: Math.abs(a.top - b.top), width: Math.abs(a.width - b.width), height: Math.abs(a.height - b.height), hidden: marker.getAttribute('aria-hidden') }; });
      assert.equal(result.selected, 'tools'); assert.equal(result.hidden, 'true'); for (const key of ['left', 'top', 'width', 'height']) assert(result[key] < 2, JSON.stringify(result));
      assert.equal(await page.locator('#lifeMain').evaluate(element => getComputedStyle(element).transform), 'none');
    });
    await check('filtered home reader returns exact query, tab, focus and scroll', async ({ page }) => {
      await open(page); const refs = await seed(page, 24);
      const draftId = await page.evaluate(async postId => {
        const s = HaedoLife.Shell.storage, workspaceId = await s.getActive();
        const long = await s.readPhotoPost(workspaceId, postId); long.ops = [{ insert: '아래 목록에서 연 긴 기록도 제목부터 읽습니다. 🌱\n\n'.repeat(40) }]; await s.savePhotoPost(workspaceId, long, long.revision);
        const doc = HaedoLife.PhotoPost.create(HaedoLife.Core.id, '2026-10-17T01:00:00.000Z'); doc.title = '기록 필터에서 이어 쓸 초안'; doc.ops = [{ insert: '반영 전 기록 입력\n' }]; await s.savePhotoPost(workspaceId, doc, 0); return doc.id;
      }, refs.ids[12]);
      await page.reload(); await ready(page); await loaded(page); await search(page, '기록');
      const row = page.locator(`[data-photo-post-id="${refs.ids[12]}"] .home-post-open`); await row.scrollIntoViewIfNeeded(); await row.focus();
      const origin = await row.evaluate(element => ({ key: element.dataset.focusKey, y: scrollY })); assert(origin.y > 100);
      await row.click(); await page.locator('.photo-article').waitFor(); await idle(page);
      assert(await page.locator('.photo-read-heading').evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }), 'Opening a lower home row must reveal its reader title');
      await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).click(); await loaded(page); await idle(page);
      assert.equal(await page.locator('#homePostSearch').inputValue(), '기록'); assert.equal(await page.locator('#homeTab-posts').getAttribute('aria-selected'), 'true');
      await page.waitForFunction(origin => document.activeElement?.dataset.focusKey === origin.key && Math.abs(scrollY - origin.y) < 2, origin);
      await page.locator('#homeTab-drafts').click(); const draft = page.locator(`[data-draft-id="${draftId}"] .home-draft-open`); await draft.focus();
      const draftOrigin = await draft.evaluate(element => ({ key: element.dataset.focusKey, y: scrollY }));
      await draft.click(); await page.locator('.ql-editor').waitFor(); await page.getByRole('button', { name: '닫기', exact: true }).click(); await loaded(page); await idle(page);
      assert.equal(await page.locator('#homePostSearch').inputValue(), '기록'); assert.equal(await page.locator('#homeTab-drafts').getAttribute('aria-selected'), 'true');
      await page.waitForFunction(origin => document.activeElement?.dataset.focusKey === origin.key && Math.abs(scrollY - origin.y) < 2, draftOrigin);
    });
    await check('main section scroll memory survives round trips without changing the filtered home list', async ({ page }) => {
      await open(page); await seed(page, 24); await page.reload(); await ready(page); await loaded(page); await search(page, '기록');
      await page.evaluate(() => scrollTo({ top: 900, behavior: 'instant' })); const y = await page.evaluate(() => scrollY); assert(y > 100);
      // Dispatching the global control retains the actual origin scroll, as a bottom dock does on touch.
      await page.evaluate(() => document.querySelector('[data-haedo-section="tools"]').click()); await page.waitForFunction(() => document.querySelector('#lifeMain')?.dataset.mode === 'tools');
      await nav(page, 'home'); await loaded(page); await idle(page); await page.waitForFunction(y => Math.abs(scrollY - y) < 2, y);
      assert.equal(await page.locator('#homePostSearch').inputValue(), '기록');
    });
    await check('late private list work cannot animate or repaint after navigation, workspace switch or signout', async ({ page, server, device }) => {
      await open(page); const refs = await seed(page); const other = await page.evaluate(async first => { const s = HaedoLife.Shell.storage, created = await s.createWorkspace('분리된 익명 공간'); await s.setActive(first); return created.workspaceId; }, refs.workspaceId);
      await page.reload(); await ready(page); await loaded(page);
      await nav(page, 'tools'); await page.evaluate(() => { __nativeHold = true; }); await nav(page, 'home'); await page.waitForFunction(() => __nativeHeld);
      await nav(page, 'tools'); await idle(page); await cleanTrace(page); await page.evaluate(() => __nativeRelease()); await settle(page);
      assert.equal(await page.locator('#homePosts').count(), 0); assert.deepEqual(await page.evaluate(() => __nativeMotion.calls), []);
      await page.evaluate(() => { __nativeHold = true; __nativeHeld = false; }); await nav(page, 'home'); await page.waitForFunction(() => __nativeHeld);
      await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(other); await settle(page);
      await page.evaluate(() => { __nativeHold = false; __nativeReleaseOld = __nativeRelease; }); await nav(page, 'home'); await loaded(page); await idle(page); await cleanTrace(page);
      await page.evaluate(() => __nativeReleaseOld()); await settle(page);
      assert.equal(await page.locator('#homePosts .home-post').count(), 0); assert.deepEqual(await page.evaluate(() => __nativeMotion.calls), []);
      await nav(page, 'tools'); await page.evaluate(() => { __nativeHold = true; __nativeHeld = false; }); await nav(page, 'home'); await page.waitForFunction(() => __nativeHeld);
      await page.evaluate(() => { window.__nativeSignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); });
      await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage); await cleanTrace(page); await page.evaluate(() => __nativeRelease());
      await page.waitForFunction(() => HaedoAuth.user === null); assert.doesNotMatch(await page.locator('body').innerText(), /산책에서 발견한 문장/);
      assert.deepEqual(await page.evaluate(() => __nativeMotion.calls), []);
      server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-return-login]').click(); await page.locator('#googleLogin').click(); await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await loaded(page);
      assert.equal(await page.locator('#homePosts .home-post').count(), 0);
      assert(await page.evaluate(async refs => { try { await HaedoLife.Shell.storage.readPhotoPost(refs.workspaceId, refs.ids[0]); return false; } catch (_) { return true; } }, refs));
    });
  } finally { await browser.close(); await fs.writeFile(path.join(out, process.env.MOTION_TEST_MATCH ? 'recheck-report.json' : 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  const failed = report.checks.filter(check => !check.pass).length;
  console.log(JSON.stringify({ passed: report.checks.length - failed, failed, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length }));
  if (failed || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
