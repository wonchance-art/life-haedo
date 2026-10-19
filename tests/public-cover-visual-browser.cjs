'use strict';
// The complete owner/target/publication journey belongs to public-cover-browser.
// Reuse its real SQL/source fixture for independent view and input checks.
process.env.BASE_URL ||= 'http://127.0.0.1:4216';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { LocalSQLNineCloud } = require('./nine-public-sql-fixture.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { seedPublicTargets, enterCover, ownerIdle, saved, snapshot } = require('./public-cover-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const visitorOnly = process.argv.includes('--visitor-only');
const output = path.resolve(__dirname, '../.local/public-cover-visual' + (visitorOnly ? '-visitor' : ''));
async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(output, { recursive: true });
  const db = (process.env.BLOG_POSTGRES_DATABASE || 'haedo_blog_qa').slice(0, 30) + '_cover_visual_' + process.pid;
  const server = new LocalSQLNineCloud({ container: process.env.BLOG_POSTGRES_CONTAINER, database: db });
  // Always prepare a new isolated database, including CI's --prepare-database mode.
  await server.prepare(); await server.initialize();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const report = { checks: [], visual: [], visualFailures: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0,
    node: process.version, browser: browser.version(), productionWrites: 0,
    scope: 'Real owner UI/SDK/IndexedDB and isolated existing PostgreSQL RPCs; synthetic Auth/Storage/Edge and deliberately failed target-read HTTP only. Viewport and CompositionEvent simulation, not Apple/native IME/Google OAuth or production/deployment.' };
  const contexts = []; let page, visitor, heldRelease = null, failures = false;
  async function context(name, account) {
    const ctx = await makeContext(browser, server, name, account, { viewport: { width: 820, height: 1000 } }); contexts.push(ctx);
    await ctx.route('**/*', route => {
      if ([new URL(base).origin, cloud].includes(new URL(route.request().url()).origin)) return route.fallback();
      report.external.push(route.request().url()); return route.abort();
    });
    ctx.on('page', p => {
      p.setDefaultTimeout(25000); p.on('pageerror', e => report.pageErrors.push(e.message));
      p.on('console', m => {
        if (m.type() !== 'error') return;
        if (failures && m.location().url.startsWith(cloud) && /Failed to load resource:.*503/.test(m.text())) report.expectedErrors++;
        else report.consoleErrors.push(m.text());
      });
    }); return ctx;
  }
  const writes = () => ({ blog: server.blogRequests.filter(r => ['life_blog_save', 'life_blog_publish', 'life_blog_unpublish', 'life_blog_prepare_asset'].includes(r.rpc)).length,
    assets: server.assetRequests.filter(r => r.method === 'POST').length, pages: server.pageRequests.filter(r => r.name === 'life_public_page_put').length });
  async function check(name, run) {
    if (visitorOnly && !name.startsWith('An anonymous cover') && !name.startsWith('A failed live target')) return;
    console.log('START ' + name); await run(); report.checks.push(name); console.log('PASS ' + name);
  }
  async function capture(p, scene) {
    for (const width of [1440, 820, 390]) {
      await p.setViewportSize({ width, height: 1000 });
      await p.evaluate(() => document.fonts.ready);
      await p.evaluate(ownerPreview => { document.activeElement?.blur(); scrollTo({ top: 0, left: 0, behavior: 'instant' }); if (ownerPreview) document.getElementById('pcPreview')?.scrollIntoView({ block: 'start', behavior: 'instant' }); }, scene === 'owner-whole-preview');
      const metrics = await p.evaluate(inspect);
      if (metrics.horizontalOverflow) report.visualFailures.push({ scene, width, kind: 'overflow' });
      for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) if (metrics[key].length) report.visualFailures.push({ scene, width, kind: key, values: metrics[key] });
      const file = scene + '-' + width + '.png', fullFile = scene + '-' + width + '-full.png';
      await p.screenshot({ path: path.join(output, file) }); await p.screenshot({ path: path.join(output, fullFile), fullPage: true });
      report.visual.push({ scene, width, file, fullFile, metrics });
    }
    await p.setViewportSize({ width: 820, height: 1000 });
  }
  async function review() { await page.locator('#pcReview').click(); await ownerIdle(page); await page.locator('#pcPreview .pc-document').waitFor(); assert.equal(await page.locator('#pcConsent').isChecked(), false); }
  async function holdRead(ctx, predicate) {
    let arrive, release, used = false; const arrived = new Promise(r => arrive = r), gate = new Promise(r => release = r);
    const url = cloud + '/rest/v1/rpc/life_public_page_get';
    const handler = async route => {
      const request = route.request();
      if (used || request.method() !== 'POST' || !predicate(request.postDataJSON())) return route.fallback();
      used = true; arrive(); await gate; return route.fallback();
    };
    await ctx.route(url, handler); heldRelease = release;
    return { arrived, release, async dispose() { release(); heldRelease = null; await ctx.unroute(url, handler); } };
  }
  try {
    const owner = await context('cover-visual-owner', accounts.a), anon = await context('cover-visual-anon', null);
    await anon.addInitScript(() => {
      for (const key of ['indexedDB', 'localStorage', 'sessionStorage']) Object.defineProperty(window, key, { configurable: true, get() { throw Error('Anonymous cover opened ' + key); } });
      const native = setTimeout; window.__coverVisualPolls = [];
      window.setTimeout = function (fn, ms, ...args) { if (ms === 30000) __coverVisualPolls.push(fn); return native.call(this, fn, ms, ...args); };
    });
    page = await owner.newPage(); visitor = await anon.newPage(); await page.goto(base + '/index.html'); await ready(page);
    const fixture = await seedPublicTargets(page), before = await snapshot(page, fixture.workspaceId);
    const coverId = await page.evaluate(async f => {
      const L = HaedoLife, s = L.Shell.storage, state = await s.readPublicCover(f.workspaceId), cover = L.PublicCover.create(L.Core.id);
      cover.title = '여행을 읽고 들으며 다시 고르는 대표 글과 연재·취향 🌱';
      cover.intro = '공개하기로 고른 글과 연재, 책과 음악을 한곳에서 읽습니다.\n날짜순 목록과 별개로 직접 고른 순서입니다. ' + '긴 한글 소개도 원래 문장대로 읽습니다. '.repeat(5);
      for (const [kind, id] of [['post', f.publications[0].token], ['series', f.seriesPublicId], ['nine', f.ninePublicId]]) cover.items.push(L.PublicCover.item(kind, id, L.Core.id));
      state.covers.push(cover); await s.savePublicCover(f.workspaceId, state, state.revision); return cover.id;
    }, fixture);
    await enterCover(page, coverId);
    await check('The shared whole preview displays exact public fields at three widths without a publication write or default consent', async () => {
      const count = writes(); await review(); assert.deepEqual(writes(), count);
      const preview = page.locator('#pcPreview'); assert.equal(await preview.locator('.pc-entry').count(), 3);
      const text = await preview.innerText();
      for (const title of [fixture.docs[0].title, '차례로 읽는 공개 여행 연재', '함께 읽고 들은 공개 9칸']) assert(text.includes(title), title);
      for (const secret of ['PRIVATE_', '공개 표지의 글 소개로 복사하면 안 되는 작가 소개', fixture.workspaceId, fixture.nineBoardId]) assert(!text.includes(secret), secret);
      assert.equal(await preview.locator('img,iframe,video').count(), 0); await capture(page, 'owner-whole-preview');
    });
    await check('Composition and ordinary edits invalidate consent while the actual input node and composition text survive', async () => {
      const count = writes(); await page.locator('#pcConsent').check();
      await page.locator('#pcIntro').evaluate(node => {
        window.__coverInput = node; node.focus(); node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        node.value = '한글 조합을 마친 뒤 직접 공개할 소개 🌱'; node.setSelectionRange(3, 7);
        node.dispatchEvent(new InputEvent('input', { bubbles: true, data: '한', inputType: 'insertCompositionText', isComposing: true }));
      });
      assert.equal(await page.locator('#pcPreview .pc-document').count(), 0); assert.equal(await page.locator('#pcConsent').isChecked(), false);
      await page.locator('#pcPublish').click(); await ownerIdle(page); assert.deepEqual(writes(), count);
      assert.equal(await page.locator('#pcIntro').evaluate(node => node === __coverInput), true);
      assert.equal(await page.locator('#pcIntro').inputValue(), '한글 조합을 마친 뒤 직접 공개할 소개 🌱');
      await page.locator('#pcIntro').evaluate(node => { node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '한' })); }); await saved(page);
      await review(); assert.equal(await page.locator('#pcError').isHidden(), true); await page.locator('#pcConsent').check();
      await page.locator('#pcTitle').fill('최종적으로 직접 고른 여행 글·연재·9칸'); await saved(page);
      assert.equal(await page.locator('#pcPreview .pc-document').count(), 0); assert.equal(await page.locator('#pcConsent').isChecked(), false); assert.deepEqual(writes(), count);
    });
    await check('A late real public-state read preserves current title input, selection and focus and cannot restore old consent', async () => {
      const count = writes(), gate = await holdRead(owner, args => args.p_workspace_id === coverId);
      try {
        await page.locator('#pcRefresh').click(); await gate.arrived;
        await page.locator('#pcTitle').fill('상태 응답을 기다리는 동안 직접 고친 대표 여행 표지');
        await page.locator('#pcTitle').evaluate(node => { window.__coverFocusedTitle = node; node.focus(); node.setSelectionRange(4, 9); });
        gate.release(); await ownerIdle(page); await saved(page);
        assert.equal(await page.locator('#pcTitle').evaluate(node => node === __coverFocusedTitle && node === document.activeElement), true);
        assert.deepEqual(await page.locator('#pcTitle').evaluate(node => [node.selectionStart, node.selectionEnd]), [4, 9]);
        assert.equal(await page.locator('#pcTitle').inputValue(), '상태 응답을 기다리는 동안 직접 고친 대표 여행 표지');
        assert.equal(await page.locator('#pcConsent').isChecked(), false); assert.equal(await page.locator('#pcPreview .pc-document').count(), 0); assert.deepEqual(writes(), count);
      } finally { await gate.dispose(); }
    });
    await review(); await page.locator('#pcConsent').check(); await page.locator('#pcPublish').click(); await ownerIdle(page);
    await page.locator('#pcStatus[data-state="published"]').waitFor(); const url = await page.getByRole('link', { name: '공개 표지 열기', exact: true }).getAttribute('href');
    await check('An anonymous cover has readable native destinations, keyboard focus and no rendered body images or private-store access at three widths', async () => {
      await visitor.goto(url); await visitor.waitForFunction(() => document.querySelector('#coverStatus')?.dataset.state === 'published' && document.querySelector('#coverContent')?.getAttribute('aria-busy') !== 'true');
      assert.equal(await visitor.locator('.pc-entry[data-state="published"]').count(), 3); assert.equal(await visitor.locator('#coverContent img,iframe,video').count(), 0);
      const links = visitor.locator('.pc-entry-link'); await links.first().focus(); await visitor.keyboard.press('Tab'); assert.equal(await links.nth(1).evaluate(node => node === document.activeElement), true);
      for (const href of await links.evaluateAll(nodes => nodes.map(n => n.href))) { const target = new URL(href); assert.equal(target.origin, new URL(base).origin); assert(target.searchParams.get('fromCover')); assert(target.searchParams.get('coverItem')); }
      await capture(visitor, 'visitor-live-rows');
      await visitor.locator('.pc-entry-link').first().evaluate(node => { window.__stableCoverLink = node; const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
      const selected = await visitor.evaluate(() => getSelection().toString());
      await visitor.evaluate(() => { const poll = __coverVisualPolls.at(-1); if (!poll) throw Error('Actual reader poll was not scheduled'); return poll(); });
      await visitor.waitForFunction(() => document.querySelector('#coverContent')?.getAttribute('aria-busy') !== 'true' && !document.querySelector('#coverRefresh')?.disabled);
      assert.equal(await visitor.locator('.pc-entry-link').first().evaluate(node => node === __stableCoverLink), true); assert.equal(await visitor.evaluate(() => getSelection().toString()), selected);
    });
    await check('A failed live target loses its previous title and link while the other public destinations remain usable at three widths', async () => {
      failures = true;
      await anon.route(cloud + '/rest/v1/rpc/life_public_page_read', route => {
        const req = route.request(); if (req.method() !== 'POST' || req.postDataJSON().p_public_id !== fixture.ninePublicId) return route.fallback();
        return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify({ message: 'synthetic target unavailable' }) });
      });
      await visitor.locator('#coverRefresh').click(); const row = visitor.locator('.pc-entry[data-public-id="' + fixture.ninePublicId + '"][data-state="error"]'); await row.waitFor();
      assert.equal(await row.locator('a,h2').count(), 0); assert(!(await row.innerText()).includes('함께 읽고 들은 공개 9칸'));
      assert.equal(await visitor.locator('.pc-entry[data-state="published"] .pc-entry-link').count(), 2); await capture(visitor, 'visitor-partial-error');
      await anon.unroute(cloud + '/rest/v1/rpc/life_public_page_read'); await visitor.locator('#coverRefresh').click(); await visitor.locator('.pc-entry[data-public-id="' + fixture.ninePublicId + '"][data-state="published"]').waitFor();
    });
    const after = await snapshot(page, fixture.workspaceId); for (const key of Object.keys(before).filter(key => key !== 'cover')) assert.deepEqual(after[key], before[key], key + ': original state unchanged');
    assert.deepEqual(report.visualFailures, [], 'All measured visual states must pass; failures are batched without weakening any limit');
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } catch (error) {
    report.pass = false; report.error = error.stack;
    for (const [name, p] of [['owner', page], ['visitor', visitor]]) if (p) {
      await p.screenshot({ path: path.join(output, name + '-failure.png'), fullPage: true }).catch(() => {});
      await fs.writeFile(path.join(output, name + '-failure.txt'), await p.locator('body').innerText().catch(() => 'unavailable'));
    } throw error;
  } finally {
    heldRelease?.(); for (const ctx of contexts) await ctx.close(); await browser.close();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
