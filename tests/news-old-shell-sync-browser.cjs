/* 과도기 확인: 새 판 기기가 남긴 뉴스 설정·반응·읽기 비교를, 아직 이전 셸인 같은 계정의 기기가 받았을 때.
 * npm run dev; node tests/news-old-shell-sync-browser.cjs
 * The "older device" is the actual shell with every file this work changed replaced by the committed base-commit
 * bytes (tests/fixtures/discovery-old-client: the four news screen files, storage, account sync, backup, reactions and
 * reading models). What a new-shell device of the same account and workspace uploads is built by the current models
 * (the pair of documents, discovery-actions.js separate) and placed in the in-memory account-document fixture; the
 * older device then syncs for real. Synthetic catalog only; no publisher, image or production request.
 * Review MAJOR-1 (2026-11-11): an older device that reacts keeps the newer device's added-source and found-link
 * reactions on the account and on the newer screen, and its own reaction too. Asserted. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const vm = require('node:vm');
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
  'discovery.css': '07a0fa3d5f27e2a418fa82e692bc8d76a8e26705168b6a6b054238eb61013127', 'discovery-settings.js': 'f6d8f710d848b15ec4b9fa4f7df2b5e295fcac5a2d1b05aee4737110606708bc',
  'storage.js': '6436add886ac555043a4f81fc0bfa31fe4ea5f763fcf2468e9d2709c3f76ace5', 'account-docs-sync.js': '2ecc53d98add9a566f9da5148299d1720e7ff0d4daecd2066f5fab6f9bf51e00',
  'full-backup.js': '8c0e5d698686466ba707c64e225e11af320c2c285c0ecbfa793475609c4828a4', 'discovery-actions.js': 'cbae40cdaf96f221f2d160f126b6a5b31174fbb748117f4544b374aa3e1497d9',
  'discovery-reading.js': '8b6c18f69c752ed971ffdd1d578ccd7d7927ba97dcee0906b5582469ff548028' };
// The earlier reactions and reading validators, run in their own realm on what the account holds.
function olderValidators(old) {
  const sandbox = vm.createContext({ TextEncoder, URL, AbortController, structuredClone, crypto: globalThis.crypto });
  vm.runInContext(old['discovery.js'].toString('utf8'), sandbox); vm.runInContext(old['discovery-actions.js'].toString('utf8'), sandbox);
  for (const file of ['discovery-profile.js', 'discovery-language-settings.js', 'interest-profile.js', 'discovery-recommendations.js']) vm.runInContext(require('node:fs').readFileSync(path.join(__dirname, '../assets/life', file), 'utf8'), sandbox);
  vm.runInContext(old['discovery-reading.js'].toString('utf8'), sandbox);
  const parse = vm.runInContext('JSON.parse', sandbox), inside = value => parse(JSON.stringify(value));
  const accepts = name => value => { try { vm.runInContext('HaedoLife.' + name, sandbox).validate(inside(value)); return true; } catch (_) { return false; } };
  return { actions: accepts('DiscoveryActions'), reading: accepts('DiscoveryReading') };
}
// What a new-shell device uploads for its reactions or comparison: the pair, from an empty one.
const pairOf = (model, workspaceId, change) => { const legacy = model.empty(workspaceId), extended = model.empty(workspaceId), next = change(model.combine(legacy, extended)); return model.separate(next, legacy, extended); };
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
  const Old = olderValidators(old);
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
      await run({ page, feed, workspaceId, upload, stored, receive, updateShell, Old });
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
    // It is the earlier shell: no pair in its reactions model, the earlier document kinds in its storage.
    assert.deepEqual(await page.evaluate(() => ({ pair: typeof HaedoLife.DiscoveryActions.combine, schema: HaedoLife.Shell.storage.accountDocKinds?.schema, kinds: HaedoLife.Shell.storage.accountDocKinds?.account.filter(kind => kind.endsWith('Extended')) })),
      { pair: 'undefined', schema: 5, kinds: [] });
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
    const both = stored => [...(stored('discoveryActions')?.data.entries || []), ...(stored('discoveryActionsExtended')?.data.entries || [])];
    const bookmarkedCount = async page => Number((await tab(page, '#discoveryBookmarked')).match(/\d+/)?.[0] || 0);
    await check('reactions: a saved 넓게 찾기 link is in the extended document; the older device works and leaves it alone; the new shell shows it', async ({ page, workspaceId, upload, stored, receive, updateShell, Old }) => {
      const found = Wide.validate({ supplier: 'google-news-rss', fetchedAt: NOW(), stale: false, topics: [], items: [{ id: 'a'.repeat(32), title: '합성 넓게 찾은 글', link: 'https://news.google.com/rss/articles/SYNOLD?oc=5', publishedAt: NOW(), sourceName: '합성매체', sourceUrl: null, topic: '합성 주제', language: 'ko' }] }).items[0];
      const article = Wide.toArticle(found, { sourceId: Discovery.WIDE_SOURCE.id, canonicalUrl: Discovery.canonicalUrl, fetchedAt: NOW() });
      const pair = pairOf(Actions, workspaceId, profile => Actions.setReaction(profile, Actions.capture(article, { id: article.sourceId, name: article.sourceName, rights: article.rights }), 'bookmarked', true, { expectedRevision: 0, now: NOW() }));
      assert.equal(pair.legacy, null, 'the new shell writes a found link to the extended document only');
      const uploaded = upload('discoveryActionsExtended', pair.extended);
      await receive(); await olderOpens(page);
      assert.equal((await local(page, 'readDiscoveryActions')).ok, true, 'older device reads its own reactions');
      assert.deepEqual(stored('discoveryActionsExtended').data, uploaded.data, 'the older device leaves the extended document alone');
      assert.equal(stored('discoveryActions'), null);
      report.observations.wideReactionOnOlderDevice = { tab: await tab(page, '#discoveryBookmarked'), olderDeviceSync: await page.evaluate(() => HaedoLife.Shell.accountDocsSync.getStatus().state) };
      await updateShell(); await page.waitForTimeout(1500); await syncNow(page); await idle(page);
      assert.deepEqual(stored('discoveryActionsExtended').data, uploaded.data, 'nothing was written back');
      // The older release moved its cursor past the row it did not know; the new shell reads the list again once.
      assert.equal(await bookmarkedCount(page), 1, 'the found link is in 담은 글 on the new shell');
      assert.equal((await local(page, 'readDiscoveryActions')).value.entries.length, 1);
    });
    await check('reactions: an older device that reacts keeps the newer device\'s added-source and found-link reactions, and its own (MAJOR-1)', async ({ page, feed, workspaceId, upload, stored, receive, updateShell, Old }) => {
      const target = Discovery.validateFeed(feed).articles.find(article => article.sourceId === 'yna-news');
      const found = Wide.validate({ supplier: 'google-news-rss', fetchedAt: NOW(), stale: false, topics: [], items: [{ id: 'b'.repeat(32), title: '합성 넓게 찾은 글 둘', link: 'https://news.google.com/rss/articles/SYNOLD2?oc=5', publishedAt: NOW(), sourceName: '합성매체', sourceUrl: null, topic: '합성 주제', language: 'ko' }] }).items[0];
      const link = Wide.toArticle(found, { sourceId: Discovery.WIDE_SOURCE.id, canonicalUrl: Discovery.canonicalUrl, fetchedAt: NOW() });
      const pair = pairOf(Actions, workspaceId, profile => {
        const one = Actions.setReaction(profile, Actions.capture(target, { id: 'yna-news', name: '합성 yna-news' }), 'bookmarked', true, { expectedRevision: 0, now: NOW() });
        return Actions.setReaction(one, Actions.capture(link, { id: link.sourceId, name: link.sourceName }), 'bookmarked', true, { expectedRevision: 1, now: NOW() });
      });
      assert.equal(pair.legacy, null); const uploaded = upload('discoveryActionsExtended', pair.extended);
      await receive(); await olderOpens(page);
      assert.equal((await local(page, 'readDiscoveryActions')).ok, true, 'older device reads its own reactions');
      // The older device now adds a reaction of its own (a first-registry article on its screen).
      await page.locator('#discoveryList > .discovery-article').first().locator('[data-discovery-reaction=bookmarked]').click(); await idle(page);
      await syncNow(page); await page.waitForTimeout(1200); await syncNow(page);
      const legacy = await until(() => stored('discoveryActions'), 'older device uploaded its reaction');
      report.observations.reactionsAfterOlderReaction = { legacyEntries: legacy.data.entries.map(entry => entry.snapshot.sourceId), extendedEntries: stored('discoveryActionsExtended').data.entries.map(entry => entry.snapshot.sourceId),
        olderDeviceSync: await page.evaluate(() => HaedoLife.Shell.accountDocsSync.getStatus().state) };
      assert.equal(legacy.data.entries.length, 1, 'the older device\'s own reaction is on the account');
      assert.ok(Discovery.LEGACY_SOURCE_IDS.includes(legacy.data.entries[0].snapshot.sourceId));
      assert.equal(Old.actions(legacy.data), true, 'what the older device wrote is what its validator accepts');
      assert.deepEqual(stored('discoveryActionsExtended').data, uploaded.data, 'the newer device\'s added-source and found-link reactions stay on the account');
      // The same device on the new shell: all three are in 담은 글, nothing on the account changed.
      await updateShell(); await page.waitForTimeout(1200); await syncNow(page); await idle(page);
      assert.deepEqual(await page.evaluate(() => [typeof HaedoLife.DiscoveryActions.combine, HaedoLife.Shell.storage.accountDocKinds.schema]), ['function', 6], 'the new shell after the update');
      report.observations.reactionsAfterShellUpdate = { tab: await tab(page, '#discoveryBookmarked') };
      assert.equal(await bookmarkedCount(page), 3, 'three reactions on the new shell');
      assert.deepEqual(both(stored).map(entry => entry.canonicalUrl).sort(), [legacy.data.entries[0].canonicalUrl, ...uploaded.data.entries.map(entry => entry.canonicalUrl)].sort());
      assert.deepEqual(stored('discoveryActionsExtended').data, uploaded.data);
      // A newer-device screen that receives the account: the older device's reaction joins its own two.
      const combined = Actions.combine(stored('discoveryActions').data, stored('discoveryActionsExtended').data);
      assert.equal(combined.entries.filter(entry => entry.bookmarked).length, 3);
    });
    await check('reading comparison: one over more than twenty sources is in the extended document; the older device works; the new shell shows it', async ({ page, feed, workspaceId, upload, stored, receive, updateShell, Old }) => {
      const validated = Discovery.validateFeed(feed);
      const input = { feed: validated, profile: { workspaceId, revision: 1, manual: [{ id: 'manual-a', label: '합성' }] }, feedback: [], knownUrls: [], contentLanguages: null, actions: null, translationTarget: 'original', personalAllowed: false, baselineMode: 'latest' };
      const comparison = await Reading.createComparison(Reading.empty(workspaceId), input, { expectedRevision: 0, now: NOW(), sessionId: 'old-shell-session' });
      assert.ok(comparison.session.conditions.sourceIds.length > 20);
      const pair = Reading.separate(comparison, Reading.empty(workspaceId), Reading.empty(workspaceId));
      assert.equal(pair.legacy, null, 'the new shell writes it to the extended document only'); assert.equal(Old.reading(pair.extended), false, 'the earlier validator could not read it');
      const uploaded = upload('discoveryReadingExtended', pair.extended);
      await receive(); await olderOpens(page);
      const received = await local(page, 'readDiscoveryReading');
      assert.equal(received.ok, true, 'older device reads its own comparison state');
      assert.deepEqual(stored('discoveryReadingExtended').data, uploaded.data, 'the older device leaves the extended document alone');
      report.observations.readingOnOlderDevice = { localSession: !!received.value.session, olderDeviceSync: await page.evaluate(() => HaedoLife.Shell.accountDocsSync.getStatus().state) };
      await updateShell(); await page.waitForTimeout(1500); await syncNow(page);
      const later = await local(page, 'readDiscoveryReading');
      assert.equal(later.ok && later.value.session?.id, 'old-shell-session', 'the comparison is on the new shell');
      assert.deepEqual(stored('discoveryReadingExtended').data, uploaded.data, 'the account copy is still the newer device\'s comparison');
    });
    await check('reactions: a legacy document holding an added-source entry (written before the pair) is split by the new shell; the older validator then accepts it', async ({ page, feed, workspaceId, upload, stored, receive, updateShell, Old }) => {
      const articles = Discovery.validateFeed(feed).articles, first = articles.find(article => article.sourceId === 'naver-d2'), added = articles.find(article => article.sourceId === 'sbs-news');
      let mixed = Actions.setReaction(Actions.empty(workspaceId), Actions.capture(first, { id: 'naver-d2', name: '합성 naver-d2' }), 'bookmarked', true, { expectedRevision: 0, now: NOW() });
      mixed = Actions.setReaction(mixed, Actions.capture(added, { id: 'sbs-news', name: '합성 sbs-news' }), 'bookmarked', true, { expectedRevision: 1, now: NOW() });
      assert.equal(Old.actions(mixed), false);
      upload('discoveryActions', mixed);
      await receive(); await olderOpens(page);
      await updateShell(); await page.waitForTimeout(1200); await syncNow(page); await page.waitForTimeout(1200); await syncNow(page); await idle(page);
      const legacy = await until(() => { const row = stored('discoveryActions'); return row && Old.actions(row.data) ? row : null; }, 'the account legacy copy is readable by the older validator');
      assert.deepEqual(legacy.data.entries.map(entry => entry.canonicalUrl), [first.canonicalUrl]);
      assert.deepEqual(stored('discoveryActionsExtended').data.entries.map(entry => entry.canonicalUrl), [added.canonicalUrl], 'the moved entry is on the account');
      assert.equal(await bookmarkedCount(page), 2, 'both reactions on the screen');
    });
    await check('reactions: an older device that never reacts keeps the account copy through its own shell update; the new shell writes added sources to the extended document', async ({ page, feed, workspaceId, upload, stored, receive, updateShell, Old }) => {
      const target = Discovery.validateFeed(feed).articles.find(article => article.sourceId === 'yna-news');
      const pair = pairOf(Actions, workspaceId, profile => Actions.setReaction(profile, Actions.capture(target, { id: 'yna-news', name: '합성 yna-news' }), 'bookmarked', true, { expectedRevision: 0, now: NOW() }));
      const uploaded = upload('discoveryActionsExtended', pair.extended);
      await receive(); await olderOpens(page);
      await updateShell(); await page.waitForTimeout(1500); await syncNow(page); await idle(page);
      assert.deepEqual(stored('discoveryActionsExtended').data, uploaded.data, 'nothing was written back');
      assert.equal(stored('discoveryActions'), null);
      assert.equal(await bookmarkedCount(page), 1, 'the reaction shows on the new shell');
      // It then reacts on the new shell, on an added-source card and on a first-registry card.
      const card = async id => { const locator = page.locator(`#discoveryList > .discovery-article[data-discovery-id="${id}"]`); while (!await locator.count() && await page.locator('#discoveryShowMore').count()) { await page.locator('#discoveryShowMore').click(); await idle(page); } return locator; };
      await (await card('sync-sbs-news')).locator('[data-discovery-reaction=bookmarked]').click(); await idle(page);
      await (await card('sync-naver-d2')).locator('[data-discovery-reaction=bookmarked]').click(); await idle(page);
      await syncNow(page); await page.waitForTimeout(1500); await syncNow(page);
      const extended = await until(() => { const row = stored('discoveryActionsExtended'); return row?.data.entries.length === 2 ? row : null; }, 'the added-source reaction in the extended document');
      const legacy = await until(() => stored('discoveryActions'), 'the first-registry reaction in the legacy document');
      assert.deepEqual(extended.data.entries.map(entry => entry.snapshot.sourceId).sort(), ['sbs-news', 'yna-news']);
      assert.deepEqual(legacy.data.entries.map(entry => entry.snapshot.sourceId), ['naver-d2']);
      assert.equal(Old.actions(legacy.data), true, 'the legacy document stays readable by the older validator');
    });
    // Re-review MAJOR-A: each document within 500 entries and 1 MB, the pair above them. News opens on the new shell,
    // the list and 담은 글 show, and only adding is refused with the usual message.
    const filled = (workspaceId, sourceId, count, title = n => '합성 ' + n, tags = []) => {
      let profile = Actions.empty(workspaceId);
      for (let n = 0; n < count; n++) {
        const host = Discovery.SNAPSHOT_SOURCES[sourceId][0];
        const article = { id: `limit-${sourceId}-${n}`, sourceId, url: `https://${host}/limit/${sourceId}/${n}`, title: title(n), author: null, language: 'ko', tags, publishedAt: null, updatedAt: null, fetchedAt: NOW(), coverage: 'link_only', rights: { label: '합성', url: null, mode: 'metadata_only' } };
        profile = Actions.setReaction(profile, Actions.capture(article, { id: sourceId, name: '합성 ' + sourceId }), 'bookmarked', true, { expectedRevision: profile.revision, now: NOW() });
      }
      return profile;
    };
    for (const [label, legacyCount, extendedCount, title, tags] of [['501 entries (300 + 201)', 300, 201, undefined, []], ['more than 1 MB (250 + 250 long titles)', 250, 250, n => '가'.repeat(480) + n, ['나'.repeat(150)]]]) {
      await check('reactions: an account pair of ' + label + ' opens on the new shell; adding is refused, nothing is written', async ({ page, workspaceId, upload, stored, updateShell }) => {
        await updateShell();
        const legacy = filled(workspaceId, 'naver-d2', legacyCount, title, tags), extended = filled(workspaceId, 'yna-news', extendedCount, title, tags);
        upload('discoveryActions', legacy); upload('discoveryActionsExtended', extended);
        await syncNow(page); await page.reload(); await ready(page); await nav(page, 'news'); await idle(page); await frames(page);
        const read = await local(page, 'readDiscoveryActions');
        assert.equal(read.ok, true, 'the pair reads: ' + read.code); assert.equal(read.value.entries.length, legacyCount + extendedCount);
        assert.equal(await page.locator('#discoveryList > .discovery-article').count(), 20, 'the news list shows');
        assert.equal(await page.locator('#discoveryError').isVisible(), false);
        assert.equal(await bookmarkedCount(page), legacyCount + extendedCount, '담은 글 counts both documents');
        const before = { legacy: stored('discoveryActions'), extended: stored('discoveryActionsExtended') };
        await page.locator('#discoveryList > .discovery-article').first().locator('[data-discovery-reaction=bookmarked]').click(); await idle(page);
        await page.locator('#discoveryActionsError').waitFor();
        assert.match(await page.locator('#discoveryActionsError').innerText(), /^목록 보관 한도를 넘었습니다/);
        await syncNow(page);
        assert.deepEqual(stored('discoveryActions'), before.legacy); assert.deepEqual(stored('discoveryActionsExtended'), before.extended);
        assert.equal((await local(page, 'readDiscoveryActions')).value.entries.length, legacyCount + extendedCount);
        // 2026-11-12: the notice asks for a copy. 사본 받기 saves every entry of the pair, and the file opens again as a copy.
        assert.match(await page.locator('#discoveryActionsError').innerText(), /사본을 받거나/);
        await page.locator('#discoveryNewsSettings').click(); await page.locator('#discoveryNewsSettingsPanel').waitFor();
        // The button sits in nested disclosures: open them outermost first.
        const exportButton = page.locator('#discoveryActionsExport'), depth = await exportButton.locator('xpath=ancestor::details').count();
        for (let index = depth; index > 0; index--) {
          const details = exportButton.locator('xpath=ancestor::details[' + index + ']');
          if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
        }
        const pending = page.waitForEvent('download'); await page.locator('#discoveryActionsExport').click();
        const download = await pending, chunks = []; for await (const bytes of await download.createReadStream()) chunks.push(bytes);
        const bytes = Buffer.concat(chunks), copy = JSON.parse(bytes.toString('utf8'));
        assert.equal(copy.entries.length, legacyCount + extendedCount, 'the copy holds both documents');
        // (The refused bookmark is still held, so this screen's 사본에서 추가 waits; the copy is read by the same model.)
        assert.equal(Actions.previewCopy(copy).counts.total, legacyCount + extendedCount, 'the copy opens again');
        assert.deepEqual(stored('discoveryActions'), before.legacy); assert.deepEqual(stored('discoveryActionsExtended'), before.extended);
      });
    }
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
