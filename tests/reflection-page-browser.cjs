'use strict';
const { openRecordsMenu } = require('./helpers/feature-menus.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { current } = require('./life-workbench-browser.cjs');
const report = { checks: [], errors: [], consoleErrors: [] };
async function main() {
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await makeContext(browser, new FakeCloud(), 'reflection-page', accounts.a);
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const open = async () => {
    await openRecordsMenu(page); await click('회고');
    await page.locator('#wbReflectionUse').click();
  };
  const drafts = () => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.readPageDrafts(await s.getActive()); });
  const copy = () => page.locator('#wbReflectionToPage').click();
  try {
    await page.goto(base + '/index.html'); await ready(page); await open();
    await copy(); await page.locator('#wbError:not([hidden])').waitFor();
    assert.equal((await drafts()).posts.length, 0);
    report.checks.push('Blank reflection does not create a draft');
    const note = page.locator('#wbReflectionNote');
    await note.fill('천천히 다시 읽어 볼 내 생각');
    await note.dispatchEvent('compositionstart'); await page.locator('#wbReflectionToPage').evaluate(el => el.click());
    assert.equal((await drafts()).posts.length, 0); assert.equal(await note.inputValue(), '천천히 다시 읽어 볼 내 생각');
    await note.dispatchEvent('compositionend'); await click('지금 저장');
    report.checks.push('Active Korean composition remains in the reflection without copying');
    // Another tab has committed a draft. Return a stale revision for the readonly
    // preparation read; the actual readwrite CAS sees the current stored revision.
    await page.evaluate(async () => {
      const s = HaedoLife.Shell.storage, id = await s.getActive(), value = await s.readPageDrafts(id);
      const post = HaedoLife.PagePosts.draft([], HaedoLife.Core.id(), new Date().toISOString());
      post.body = '다른 탭의 보존할 초안'; value.posts.push(post);
      await s.savePageDrafts(id, value, value.revision);
      window.__originalGet = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function(key) {
        const request = __originalGet.call(this, key);
        if (this.name === 'meta' && this.transaction.mode === 'readonly' && String(key).startsWith('page-drafts:')) {
          request.addEventListener('success', () => {
            const result = structuredClone(request.result); result.value.revision--;
            Object.defineProperty(request, 'result', { configurable: true, value: result });
          });
        }
        return request;
      };
    });
    await copy(); await page.locator('#wbError').filter({ hasText: '다른 탭' }).waitFor();
    await page.evaluate(() => { IDBObjectStore.prototype.get = __originalGet; });
    assert.deepEqual((await drafts()).posts.map(p => p.body), ['다른 탭의 보존할 초안']);
    assert.equal(await note.inputValue(), '천천히 다시 읽어 볼 내 생각');
    report.checks.push('Draft CAS rejects a stale copy and preserves the other tab and authored thought');
    await copy(); await page.locator('#ppBody').waitFor();
    assert.equal((await drafts()).posts.length, 2);
    await page.locator('#ppBody').fill('페이지에서 고친 별도의 생각');
    await click('회고로 돌아가기'); await page.locator('#wbReflectionToPage').waitFor();
    assert.equal((await current(page)).workbench.reflection.note, '천천히 다시 읽어 볼 내 생각');
    await copy(); await page.locator('#ppBody').waitFor();
    assert.equal(await page.locator('#ppBody').inputValue(), '천천히 다시 읽어 볼 내 생각');
    assert.deepEqual(new Set((await drafts()).posts.map(p => p.body)), new Set(['다른 탭의 보존할 초안', '페이지에서 고친 별도의 생각', '천천히 다시 읽어 볼 내 생각']));
    report.checks.push('Explicit retry reloads current drafts; editing a copied draft never rewrites reflection or overwrites the edited copy');
    const other = await makeContext(browser, new FakeCloud(), 'reflection-page-b', accounts.b);
    const otherPage = await other.newPage(); await otherPage.goto(base + '/index.html?section=records&view=page'); await ready(otherPage);
    assert.equal(await otherPage.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.readPageDrafts(await s.getActive())).posts.length; }), 0);
    await other.close(); report.checks.push('Other account has no copied thought or draft');
    assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []); report.pass = true;
  } finally {
    await browser.close(); await fs.mkdir('.local/reflection-page', { recursive: true });
    await fs.writeFile('.local/reflection-page/report.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}
main().catch(e => { console.error(e); if (process.env.GITHUB_ACTIONS) console.error('::error title=Reflection page::' + String(e.stack || e).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')); process.exitCode = 1; });
