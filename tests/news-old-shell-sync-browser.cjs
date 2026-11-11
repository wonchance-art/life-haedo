/* 과도기 확인: 새 판 기기가 남긴 뉴스 설정·반응·읽기 비교를, 아직 이전 셸인 같은 계정의 기기가 받았을 때.
 * npm run dev; node tests/news-old-shell-sync-browser.cjs
 * The "older device" is the actual shell with the four news files of the card-feed work replaced by the committed
 * base-commit bytes (tests/fixtures/discovery-old-client). What a new-shell device of the same account and
 * workspace uploads is built by the current models and placed in the in-memory account-document fixture; the
 * older device then syncs for real. Synthetic catalog only; no publisher, image or production request.
 * What must hold is asserted. What an older shell is known to lose is recorded in the report as an observation. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const Discovery = require('../assets/life/discovery.js');
const Settings = require('../assets/life/discovery-settings.js');
const Actions = require('../assets/life/discovery-actions.js');
const Reading = require('../assets/life/discovery-reading.js');
const Wide = require('../assets/life/discovery-wide-remote.js');
const out = path.resolve(process.env.NEWS_OLD_SHELL_OUTPUT || path.join(__dirname, '../.local/news-old-shell-sync'));
const report = { createdAt: new Date().toISOString(), scope: 'Local Chromium, one synthetic account, in-memory account documents, base-commit news files as the older shell.', checks: [], observations: {}, consoleErrors: [], pageErrors: [], external: [] };
const only = process.env.NEWS_OLD_SHELL_ONLY || '';
const idle = page => page.waitForFunction(() => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') === 'false');
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function until(check, label, ms = 20000) {
  const deadline = Date.now() + ms;
  for (;;) { let value; try { value = await check(); } catch (_) { value = null; } if (value) return value; if (Date.now() > deadline) throw new Error('timed out: ' + label); await new Promise(done => setTimeout(done, 100)); }
}
const digests = { 'discovery.js': 'ee284b29696fc6fdaadf8efc63cd2ebf4305030514411150e009fa2321ff234b', 'discovery-ui.js': 'a03cd2f1bab7f63585897f0d121a386cc6468a3b678e239b4f0192d877b5870b',
  'discovery.css': '07a0fa3d5f27e2a418fa82e692bc8d76a8e26705168b6a6b054238eb61013127', 'discovery-settings.js': 'f6d8f710d848b15ec4b9fa4f7df2b5e295fcac5a2d1b05aee4737110606708bc' };
// Every registered source in the published two-part form.
function catalog() {
  const now = Date.now(), iso = minutes => new Date(now - minutes * 60000).toISOString(), rights = { mode: 'metadata_only', label: '합성 제목·링크', url: null };
  const source = id => ({ id, name: '합성 ' + id, url: `https://${Discovery.ALLOWED_SOURCES[id][0]}/`, feedUrl: `https://${Discovery.ALLOWED_SOURCES[id][0]}/feed`, language: 'ko', rights,
    status: 'ok', stale: false, error: null, lastSuccessAt: iso(1), lastAttemptAt: iso(1) });
  const article = (id, minutes) => ({ id: `sync-${id}`, sourceId: id, url: `https://${Discovery.ALLOWED_SOURCES[id][0]}/post/${id}`, title: `합성 글 ${id}`, language: 'ko', tags: [], author: null,
    publishedAt: iso(minutes), fetchedAt: iso(1), summary: '', coverage: 'link_only', rights });
  const first = Discovery.LEGACY_SOURCE_IDS, later = Discovery.EXTENDED_SOURCE_IDS;
  return { schemaVersion: 1, generatedAt: iso(1), sources: first.map(source), articles: first.map((id, index) => article(id, 30 + index)),
    extended: { sources: later.map(source), articles: later.map((id, index) => article(id, 5 + index)) } };
}
const syncNow = page => page.evaluate(async () => { await HaedoLife.Shell.accountDocsSync.syncNow(); return HaedoLife.Shell.accountDocsSync.getStatus().state; });
const local = (page, method) => page.evaluate(async method => { const s = HaedoLife.Shell.storage; try { return { ok: true, value: await s[method](await s.getActive()) }; } catch (error) { return { ok: false, code: error?.code || String(error) }; } }, method);
const NOW = () => new Date().toISOString();
const tab = async (page, id) => (await page.locator(id).innerText()).replace(/\s+/g, ' ');

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const old = {};
  for (const [file, digest] of Object.entries(digests)) {
    old[file] = zlib.gunzipSync(await fs.readFile(path.join(__dirname, 'fixtures/discovery-old-client', file + '.gz')));
    assert.equal(crypto.createHash('sha256').update(old[file]).digest('hex'), digest, file + ' fixture bytes');
  }
  async function check(name, run) {
    if (only && !name.includes(only)) return;
    const server = new FakeCloud(), feed = catalog(), label = 'older-' + report.checks.length;
    const context = await makeContext(browser, server, label, accounts.a, { viewport: { width: 1440, height: 960 } });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
      report.external.push({ check: name, url: url.origin + url.pathname }); return route.abort('blockedbyclient');
    });
    await context.route(base + '/assets/life/discovery-feed.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }));
    for (const [file, body] of Object.entries(old)) await context.route(base + '/assets/life/' + file, route => route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : 'application/javascript', body }));
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ check: name, text: message.text() }); });
    page.on('pageerror', error => report.pageErrors.push({ check: name, text: error.message }));
    const openNews = async () => { await ready(page); await nav(page, 'news'); await idle(page); await frames(page); };
    try {
      await page.goto(base + '/index.html'); await openNews();
      const workspaceId = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      const key = prefix => `${prefix}:${JSON.stringify([cloud, accounts.a.id])}:${workspaceId}`;
      // What a new-shell device of this account and workspace uploads: built by the current model, stored as a server row.
      const upload = (prefix, data) => {
        const docs = server.accountDocs.get(accounts.a.id) || new Map(); server.accountDocs.set(accounts.a.id, docs);
        const row = { revision: (docs.get(key(prefix))?.revision || 0) + 1, data: structuredClone(data), deleted: false, client_updated_at: NOW(), seq: ++server.accountDocSeq, updated_at: NOW() };
        docs.set(key(prefix), row); return structuredClone(row);
      };
      const stored = prefix => { const row = server.accountDocs.get(accounts.a.id)?.get(key(prefix)); return row ? structuredClone(row) : null; };
      // The older device receives the account's documents and shows news again.
      const receive = async () => { await syncNow(page); await page.reload(); await openNews(); await syncNow(page); await idle(page); };
      // The same device after its next load: the new shell over the same local data.
      const updateShell = async () => { for (const file of Object.keys(old)) await context.unroute(base + '/assets/life/' + file); await page.reload(); await openNews(); await syncNow(page); await idle(page); };
      await run({ page, feed, workspaceId, upload, stored, receive, updateShell });
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
  }
  // The older screen opens and lists its nine sources whatever the newer device stored.
  const olderOpens = async page => {
    assert.equal(await page.locator('#discoveryList > .discovery-article').count(), 5, 'older screen lists its five rows');
    assert.equal(await page.locator('#discoveryList .discovery-card-foot').count(), 0, 'this is the older row layout');
    assert.equal(await page.locator('#discoveryError').isVisible(), false, 'no error on the older screen');
  };
  try {
    await check('settings: options chosen on the new shell survive an older device that receives them and then edits news settings', async ({ page, workspaceId, upload, stored, receive, updateShell }) => {
      let settings = Settings.update(Settings.empty(workspaceId), { showImages: true }, { expectedRevision: 0, now: NOW() });
      settings = Settings.update(settings, { wideSearch: true }, { expectedRevision: 1, now: NOW() });
      const uploaded = upload('discoverySettings', settings);
      report.observations.settingsDocument = uploaded.data;
      await receive(); await olderOpens(page);
      const received = await local(page, 'readDiscoverySettings');
      report.observations.settingsOnOlderDevice = { reads: received.ok, appliedRemote: received.ok && JSON.stringify(received.value) === JSON.stringify(uploaded.data) };
      assert.equal(received.ok, true, 'older device reads its news settings');
      assert.deepEqual(stored('discoverySettings').data, uploaded.data, 'an older device that only reads changes nothing on the account');
      // It then changes a news setting of its own (turns a source off in the older settings screen).
      await page.locator('#discoveryNewsSettings').click(); await page.locator('#discoveryOptions > summary').click();
      await page.locator('#discoverySource-seoul-culture').uncheck(); await idle(page);
      await until(async () => (await local(page, 'readDiscoverySettings')).value?.disabledSourceIds.includes('seoul-culture'), 'older device saved its change');
      await syncNow(page); await page.waitForTimeout(1200); await syncNow(page);
      const after = await until(() => { const row = stored('discoverySettings'); return row.data.disabledSourceIds.includes('seoul-culture') ? row : null; }, 'older device uploaded its change');
      report.observations.settingsAfterOlderEdit = { document: after.data, imageOptionKept: Settings.showImages(after.data), wideOptionKept: Settings.wideSearch(after.data) };
      assert.doesNotThrow(() => Settings.validate(after.data));
      assert.equal(Settings.showImages(after.data), true, 'the image option was not overwritten by the older device');
      assert.equal(Settings.wideSearch(after.data), true, 'the wide-search option was not overwritten by the older device');
      assert.equal(report.observations.settingsOnOlderDevice.appliedRemote, true, 'the older validator accepts and applies the newer settings');
      // The same device after it loads the new shell: every choice is there.
      await updateShell();
      await page.locator('#discoveryNewsSettings').click(); await page.locator('#discoveryOptions > summary').click();
      assert.equal(await page.locator('#discoveryShowImages').isChecked(), true); assert.equal(await page.locator('#discoverySource-seoul-culture').isChecked(), false);
    });
    await check('settings: 넓게 찾기 turned off with its erase still pending survives an older device edit; the new shell then erases', async ({ page, workspaceId, upload, stored, receive, updateShell }) => {
      let settings = Settings.update(Settings.empty(workspaceId), { wideSearch: true }, { expectedRevision: 0, now: NOW() });
      settings = Settings.update(settings, { wideSearch: false, wideClear: true }, { expectedRevision: 1, now: NOW() });
      const uploaded = upload('discoverySettings', settings);
      await receive(); await olderOpens(page);
      assert.deepEqual(stored('discoverySettings').data, uploaded.data, 'reading changes nothing');
      await page.locator('#discoveryNewsSettings').click(); await page.locator('#discoveryOptions > summary').click();
      await page.locator('#discoverySource-seoul-culture').uncheck(); await idle(page);
      await syncNow(page); await page.waitForTimeout(1200); await syncNow(page);
      const after = await until(() => { const row = stored('discoverySettings'); return row.data.disabledSourceIds.includes('seoul-culture') ? row : null; }, 'older device uploaded its change');
      report.observations.wideClearAfterOlderEdit = after.data.disabledSourceIds;
      assert.equal(Settings.wideSearch(after.data), false); assert.equal(Settings.wideClear(after.data), true, 'the pending erase mark is kept by the older device');
      // The same device on the new shell finishes the erase and removes the mark.
      const clears = []; await page.route(cloud + '/rest/v1/rpc/life_news_wide_clear', route => { clears.push(route.request().postData()); return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ status: 'cleared', removed: 2 }) }); });
      await updateShell();
      await until(() => clears.length >= 1, 'the new shell asks the erase');
      await syncNow(page);
      const finished = await until(() => { const row = stored('discoverySettings'); return !Settings.wideClear(row.data) ? row : null; }, 'erase mark removed on the account');
      assert.deepEqual([...finished.data.disabledSourceIds].sort(), ['option-wide-off', 'seoul-culture']); assert.equal(clears[0], '{}');
    });
    await check('reactions: a saved 넓게 찾기 link leaves the older device working, and its account copy untouched while that device only reads', async ({ page, workspaceId, upload, stored, receive, updateShell }) => {
      const found = Wide.validate({ supplier: 'google-news-rss', fetchedAt: NOW(), stale: false, topics: [], items: [{ id: 'a'.repeat(32), title: '합성 넓게 찾은 글', link: 'https://news.google.com/rss/articles/SYNOLD?oc=5', publishedAt: NOW(), sourceName: '합성매체', sourceUrl: null, topic: '합성 주제', language: 'ko' }] }).items[0];
      const article = Wide.toArticle(found, { sourceId: Discovery.WIDE_SOURCE.id, canonicalUrl: Discovery.canonicalUrl, fetchedAt: NOW() });
      const uploaded = upload('discoveryActions', Actions.setReaction(Actions.empty(workspaceId), Actions.capture(article, { id: article.sourceId, name: article.sourceName, rights: article.rights }), 'bookmarked', true, { expectedRevision: 0, now: NOW() }));
      await receive(); await olderOpens(page);
      assert.equal((await local(page, 'readDiscoveryActions')).ok, true, 'older device reads its own reactions');
      assert.deepEqual(stored('discoveryActions').data, uploaded.data, 'an older device that only reads changes nothing on the account');
      report.observations.wideReactionOnOlderDevice = { tab: await tab(page, '#discoveryBookmarked'), olderDeviceSync: await page.evaluate(() => HaedoLife.Shell.accountDocsSync.getStatus().state) };
      await updateShell(); await page.waitForTimeout(1500); await syncNow(page); await idle(page);
      assert.deepEqual(stored('discoveryActions').data, uploaded.data, 'nothing was written back');
      report.observations.wideReactionAfterShellUpdate = { tab: await tab(page, '#discoveryBookmarked'), localEntries: (await local(page, 'readDiscoveryActions')).value.entries.length };
    });
    await check('reactions: a reaction on an added source leaves the older device working, and its account copy untouched while that device only reads', async ({ page, feed, workspaceId, upload, stored, receive, updateShell }) => {
      const target = Discovery.validateFeed(feed).articles.find(article => article.sourceId === 'yna-news');
      const actions = Actions.setReaction(Actions.empty(workspaceId), Actions.capture(target, { id: 'yna-news', name: '합성 yna-news' }), 'bookmarked', true, { expectedRevision: 0, now: NOW() });
      const uploaded = upload('discoveryActions', actions);
      await receive(); await olderOpens(page);
      const received = await local(page, 'readDiscoveryActions');
      assert.equal(received.ok, true, 'older device reads its own reactions');
      assert.deepEqual(stored('discoveryActions').data, uploaded.data, 'an older device that only reads changes nothing on the account');
      report.observations.reactionsOnOlderDevice = { localEntries: received.value.entries.length, tab: await tab(page, '#discoveryBookmarked') };
      // Observation (recorded, not required): the older device now adds a reaction of its own.
      await page.locator('#discoveryList > .discovery-article').first().locator('[data-discovery-reaction=bookmarked]').click(); await idle(page);
      await syncNow(page); await page.waitForTimeout(1200); await syncNow(page);
      const after = stored('discoveryActions');
      report.observations.reactionsAfterOlderReaction = { accountEntries: after.data.entries.map(entry => entry.snapshot.sourceId), keptNewSourceReaction: after.data.entries.some(entry => entry.canonicalUrl === target.canonicalUrl),
        olderDeviceSync: await page.evaluate(() => HaedoLife.Shell.accountDocsSync.getStatus().state) };
      await updateShell();
      report.observations.reactionsAfterShellUpdate = { tab: await tab(page, '#discoveryBookmarked'), accountEntries: stored('discoveryActions').data.entries.map(entry => entry.snapshot.sourceId) };
    });
    await check('reading comparison: one started with more than twenty sources leaves the older device working, and its account copy untouched while that device only reads', async ({ page, feed, workspaceId, upload, stored, receive, updateShell }) => {
      const validated = Discovery.validateFeed(feed);
      const input = { feed: validated, profile: { workspaceId, revision: 1, manual: [{ id: 'manual-a', label: '합성' }] }, feedback: [], knownUrls: [], contentLanguages: null, actions: null, translationTarget: 'original', personalAllowed: false, baselineMode: 'latest' };
      const comparison = await Reading.createComparison(Reading.empty(workspaceId), input, { expectedRevision: 0, now: NOW(), sessionId: 'old-shell-session' });
      assert.ok(comparison.session.conditions.sourceIds.length > 20);
      const uploaded = upload('discoveryReading', comparison);
      await receive(); await olderOpens(page);
      const received = await local(page, 'readDiscoveryReading');
      assert.equal(received.ok, true, 'older device reads its own comparison state');
      assert.deepEqual(stored('discoveryReading').data, uploaded.data, 'an older device that only reads changes nothing on the account');
      report.observations.readingOnOlderDevice = { localSession: !!received.value.session, olderDeviceSync: await page.evaluate(() => HaedoLife.Shell.accountDocsSync.getStatus().state) };
      // Observation (recorded, not required): whether the comparison shows up on this device once its shell is new.
      await updateShell(); await page.waitForTimeout(1500); await syncNow(page);
      const later = await local(page, 'readDiscoveryReading');
      report.observations.readingAfterShellUpdate = { arrived: later.ok && !!later.value.session, accountStillHasIt: !!stored('discoveryReading').data.session };
      assert.deepEqual(stored('discoveryReading').data, uploaded.data, 'the account copy is still the newer device\'s comparison');
    });
    await check('reactions: an older device that never reacts keeps the account copy through its own shell update', async ({ page, feed, workspaceId, upload, stored, receive, updateShell }) => {
      const target = Discovery.validateFeed(feed).articles.find(article => article.sourceId === 'yna-news');
      const uploaded = upload('discoveryActions', Actions.setReaction(Actions.empty(workspaceId), Actions.capture(target, { id: 'yna-news', name: '합성 yna-news' }), 'bookmarked', true, { expectedRevision: 0, now: NOW() }));
      await receive(); await olderOpens(page);
      await updateShell(); await page.waitForTimeout(1500); await syncNow(page); await idle(page);
      assert.deepEqual(stored('discoveryActions').data, uploaded.data, 'nothing was written back');
      // Observation (recorded, not required): whether the reaction shows up on this device once its shell is new.
      report.observations.reactionsIdleAfterShellUpdate = { tab: await tab(page, '#discoveryBookmarked'), localEntries: (await local(page, 'readDiscoveryActions')).value.entries.length };
      // It then reacts on the new shell: both reactions are on the account.
      await page.locator('#discoveryList > .discovery-article').nth(3).locator('[data-discovery-reaction=bookmarked]').click(); await idle(page);
      await syncNow(page); await page.waitForTimeout(1500); await syncNow(page);
      const after = await until(() => { const row = stored('discoveryActions'); return row.data.entries.length === 2 ? row : null; }, 'both reactions on the account');
      assert.ok(after.data.entries.some(entry => entry.canonicalUrl === target.canonicalUrl), 'the newer device\'s reaction is kept');
    });
    assert.deepEqual(report.pageErrors, [], 'page errors'); assert.deepEqual(report.external, [], 'external requests');
  } catch (error) { report.checks.push({ name: 'cross-check totals', pass: false, error: error.stack }); console.error('FAIL cross-check totals\n' + error.stack); }
  finally {
    await browser.close();
    report.pass = report.checks.length > 0 && report.checks.every(entry => entry.pass);
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, failed: report.checks.filter(entry => !entry.pass).map(entry => entry.name), observations: report.observations }));
    if (!report.pass) process.exitCode = 1;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
