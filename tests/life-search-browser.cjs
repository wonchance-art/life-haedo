/* Search journeys using actual Chromium, packaged SDK and account-scoped IDB.
 * npm run dev; node tests/life-search-browser.cjs. Anonymous Auth HTTP only.
 * Neither Apple IME/File providers nor real Google OAuth are verified here.
 */
'use strict';
const assert = require('node:assert/strict');
const { FakeCloud, platformContext, accounts, base } = require('./life-sync-browser.cjs');
function playwright() {
  for (const name of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core', '/opt/codex/cua_node/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Set PW_MODULE_PATH to an existing Playwright installation.');
}
const settle = page => page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]'));
async function click(page, name) { await page.getByRole('button', { name, exact: true }).click(); await settle(page); }
async function ready(page) {
  await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.storage && !document.querySelector('#lifeApp').hidden);
  await page.evaluate(() => HaedoLife.Shell.ready);
}
const results = page => page.locator('#lifeSearchResults article[data-source-id][data-version-id]');
const result = (page, versionId) => page.locator('#lifeSearchResults article[data-version-id="' + versionId + '"]');
async function openResult(page, versionId) { await result(page, versionId).getByRole('button', { name: '자료 읽기', exact: true }).click(); await settle(page); }
const stored = page => page.evaluate(async () => HaedoLife.Shell.storage.read(await HaedoLife.Shell.storage.getActive()));
async function sources(page, query) { await click(page, '원천 기록'); await page.locator('#lifeSearch').fill(query); }
async function selectedText(page, expected) {
  await page.waitForFunction(expected => { const el = document.querySelector('#lifeSourceText'); return el?.value.slice(el.selectionStart, el.selectionEnd) === expected; }, expected);
}
// Fixtures use existing import/commit APIs. Assertions use the caller's original
// strings/indices, never searchSources' returned quotes or positions as an oracle.
async function seed(page, specs, multiRef = false) {
  const ids = await page.evaluate(async ({ specs, multiRef }) => {
    const storage = HaedoLife.Shell.storage, core = HaedoLife.Core;
    let b = await storage.read(await storage.getActive()); const ids = [];
    for (const spec of specs) {
      const item = { versions: [] }; ids.push(item);
      for (const text of spec.texts) {
        const input = { origin: spec.origin || 'apple_notes', title: spec.title, text,
          ...(spec.url ? { url: spec.url } : {}), ...(item.sourceId ? { existingSourceId: item.sourceId } : { forceSeparate: true }) };
        const prepared = await core.prepareImport(input, b);
        await storage.commitLocal({ operationId: core.id(), workspaceId: b.workspaceId, baseRevision: b.revision, changes: core.buildImportChanges(b, prepared, []) });
        item.sourceId = prepared.source.id; item.versions.push(prepared.version.id);
        b = await storage.read(b.workspaceId);
      }
    }
    if (multiRef) {
      const quote = '함께 읽을 구절', now = new Date().toISOString();
      const refs = ids.slice(0, 2).map((item, index) => ({ sourceId: item.sourceId, sourceVersionId: item.versions[0], locator: { start: specs[index].texts[0].indexOf(quote), end: specs[index].texts[0].indexOf(quote) + quote.length } }));
      await storage.commitLocal({ operationId: core.id(), workspaceId: b.workspaceId, baseRevision: b.revision,
        changes: { put: { records: [{ id: core.id(), kind: 'excerpt', text: quote, topic: '확인 주제', note: '모음에서 찾는 메모', sourceRefs: refs, provenance: { kind: 'user' }, revision: 1, createdAt: now, updatedAt: now }] } } });
    }
    return ids;
  }, { specs, multiRef });
  await page.reload(); await ready(page); return ids;
}
async function main() {
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const server = new FakeCloud(), failures = [], errors = [];
  let passed = 0, number = 0;
  async function check(name, action) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 820, height: 1000 } }), device = 'search-' + ++number;
    try {
      await platformContext(context, server, device);
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(name + ': ' + error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(name + ': ' + message.text()); });
      await page.goto(base + '/life.html'); await ready(page);
      await action(page, context, device);
      assert.equal(server.writes().length, 0, 'search must not opt in to upload');
      passed++; console.log('PASS ' + name);
    } catch (error) { failures.push(name); console.error('FAIL ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  try {
    await check('old-only body hit opens exact raw version/range and makes a faithful UTF16 excerpt', async page => {
      const raw = 'İ 앞 🌱\r\n기억🌸한 구절\r\n옛 문장', quote = '기억🌸한 구절';
      const [s] = await seed(page, [{ title: '시간별 자료', texts: [raw, '최신 버전에는 다른 내용만 있습니다.'] }]);
      await sources(page, quote); assert.equal(await results(page).count(), 1);
      assert.equal(await result(page, s.versions[0]).locator('mark').innerText(), quote);
      await openResult(page, s.versions[0]); await selectedText(page, quote);
      assert.equal(await page.locator('#lifeVersion').inputValue(), s.versions[0]);
      assert.equal(await page.locator('#lifeSourceText').inputValue(), raw.replace(/\r\n/g, '\n'));
      await page.locator('#lifeSourceTopic').fill('기억한 구절'); await click(page, '선택 구절 모음에 추가');
      const b = await stored(page), record = b.records[0]; assert.equal(record.text, quote);
      assert.deepEqual(record.sourceRefs, [{ sourceId: s.sourceId, sourceVersionId: s.versions[0], locator: { start: raw.indexOf(quote), end: raw.indexOf(quote) + quote.length } }]);
      assert.equal(b.sourceVersions.find(v => v.id === s.versions[0]).contentText, raw);
      await page.locator('#lifeVersion').selectOption(s.versions[1]); await settle(page);
      const range = await page.locator('#lifeSourceText').evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd })); assert.equal(range.start, range.end);
    });
    await check('body versions plus latest title match form a deduplicated union and open chosen version', async page => {
      const [s] = await seed(page, [{ title: '공통 제목', texts: ['옛 공통 문장', '다음 공통 문장', '제목만 찾히는 최신 본문'] }]);
      await sources(page, '공통');
      assert.deepEqual(await results(page).evaluateAll(rows => rows.map(row => row.dataset.versionId)), [...s.versions].reverse());
      assert.equal(await result(page, s.versions[2]).locator('mark').count(), 0);
      assert.equal(await result(page, s.versions[1]).locator('mark').innerText(), '공통');
      await openResult(page, s.versions[1]); await selectedText(page, '공통'); assert.equal(await page.locator('#lifeVersion').inputValue(), s.versions[1]);
      await page.locator('#lifeSearchReturn').click(); await settle(page); await openResult(page, s.versions[2]);
      assert.equal(await page.locator('#lifeVersion').inputValue(), s.versions[2]);
      assert.equal(await page.locator('#lifeSourceText').evaluate(el => el.selectionStart === el.selectionEnd), true);
      // Inject a stale version option through the real selector/change handler.
      // This exercises the missing requested-version guard, not source deletion.
      const missing = '00000000-0000-4000-8000-000000000099';
      await page.locator('#lifeVersion').evaluate((el, id) => el.add(new Option('더 이상 없는 버전', id)), missing);
      await page.locator('#lifeVersion').selectOption(missing); await settle(page);
      assert.equal(await page.locator('#lifeSourceText').count(), 0);
      assert.match(await page.locator('#lifeApp').innerText(), /요청한 원문 버전을 찾을 수 없습니다/);
      assert.equal((await stored(page)).sourceVersions.length, 3, 'missing-version UI guard altered valid data');
    });
    await check('title-only and link-only hits never invent matching body or URL text', async page => {
      const [text, link] = await seed(page, [{ title: '제목표식 자료', texts: ['제목과 다른 본문'] }, { title: '제목표식 링크', texts: [''], url: 'https://example.invalid/url-only-marker' }]);
      await sources(page, '다른'); await openResult(page, text.versions[0]); await selectedText(page, '다른');
      await page.locator('#lifeSourceTopic').fill('이전 선택'); await click(page, '선택 구절 모음에 추가');
      assert.equal((await stored(page)).records[0].text, '다른');
      await page.locator('#lifeSearchReturn').click(); await settle(page); await page.locator('#lifeSearch').fill('제목표식');
      assert.equal(await results(page).count(), 2); assert.equal(await page.locator('#lifeSearchResults mark').count(), 0);
      await openResult(page, text.versions[0]);
      // Drain pending reader rAF work so a delayed old-selection restore cannot
      // pass a premature collapsed-selection assertion.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('#lifeSourceText').evaluate(el => el.selectionStart === el.selectionEnd), true);
      await page.locator('#lifeSearchReturn').click(); await settle(page); await openResult(page, link.versions[0]);
      assert.equal(await page.locator('#lifeSourceText').count(), 0); assert.equal(await page.getByRole('button', { name: '선택 구절 모음에 추가', exact: true }).count(), 0);
      assert.match(await page.locator('#lifeApp').innerText(), /본문 미확보/);
      await page.locator('#lifeSearchReturn').click(); await settle(page); await page.locator('#lifeSearch').fill('url-only-marker'); assert.equal(await results(page).count(), 0);
    });
    await check('IME waits for composition end; literal metacharacters and native case matching retain raw coordinates', async page => {
      const raw = '🌱 .+[x] 그리고 한글 K 끝 é';
      const [s] = await seed(page, [{ title: '문자 검색', texts: [raw] }]);
      await sources(page, '없는구절'); assert.equal(await results(page).count(), 0);
      await page.locator('#lifeSearch').evaluate(el => { el.focus(); el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.value = '한글'; el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '한글', isComposing: true })); });
      assert.equal(await results(page).count(), 0); assert.equal(await page.locator('#lifeSearch').inputValue(), '한글');
      await page.locator('#lifeSearch').dispatchEvent('compositionend'); assert.equal(await results(page).count(), 1);
      assert.equal(await page.locator('#lifeSearch').evaluate(el => el === document.activeElement), true);
      await page.locator('#lifeSearch').fill('.+[x]'); assert.equal(await result(page, s.versions[0]).locator('mark').innerText(), '.+[x]');
      await openResult(page, s.versions[0]); await selectedText(page, '.+[x]');
      await page.locator('#lifeSearchReturn').click(); await settle(page); await page.locator('#lifeSearch').fill('k');
      assert.equal(await result(page, s.versions[0]).locator('mark').innerText(), 'K'); await openResult(page, s.versions[0]); await selectedText(page, 'K');
      await page.locator('#lifeSourceTopic').fill('문자 좌표'); await click(page, '선택 구절 모음에 추가');
      assert.deepEqual((await stored(page)).records[0].sourceRefs[0].locator, { start: raw.indexOf('K'), end: raw.indexOf('K') + 1 });
      await page.locator('#lifeSearchReturn').click(); await settle(page); await page.locator('#lifeSearch').fill('e\u0301'); assert.equal(await results(page).count(), 0);
      await page.locator('#lifeSearchClear').click(); assert.equal(await page.locator('#lifeSearch').inputValue(), ''); assert.equal(await results(page).count(), 1);
    });
    await check('source filters and topic queries return independently; a second excerpt reference opens its own source', async page => {
      const ids = await seed(page, [{ title: '첫째근거', origin: 'apple_notes', texts: ['첫째 함께 읽을 구절 끝'] }, { title: '둘째근거', origin: 'obsidian', texts: ['🌱\r\n함께 읽을 구절 둘째'] }], true);
      await sources(page, '함께'); await page.locator('#lifeOriginFilter').selectOption('obsidian'); assert.equal(await results(page).count(), 1);
      await openResult(page, ids[1].versions[0]); await page.locator('#lifeSearchReturn').click(); await settle(page);
      assert.equal(await page.locator('#lifeSearch').inputValue(), '함께'); assert.equal(await page.locator('#lifeOriginFilter').inputValue(), 'obsidian');
      await page.waitForFunction(id => document.activeElement?.matches('button[data-version-id="' + id + '"]'), ids[1].versions[0]);
      assert.equal(await result(page, ids[1].versions[0]).getByRole('button', { name: '자료 읽기', exact: true }).evaluate(el => el === document.activeElement), true);
      await click(page, '모아보기'); await page.locator('#lifeSearch').fill('둘째근거'); await click(page, '확인 주제');
      assert.equal(await page.locator('.life-quote').count(), 1);
      const second = page.locator('[data-source-id="' + ids[1].sourceId + '"][data-version-id="' + ids[1].versions[0] + '"]');
      await second.click(); await settle(page); await selectedText(page, '함께 읽을 구절');
      assert.equal(await page.locator('#lifeSourceText').inputValue(), '🌱\n함께 읽을 구절 둘째');
      await page.locator('#lifeSearchReturn').click(); await settle(page);
      assert.equal(await page.locator('#lifeSearch').inputValue(), '둘째근거'); assert.equal(await page.getByRole('button', { name: '확인 주제', exact: true }).getAttribute('aria-pressed'), 'true');
      await click(page, '원천 기록'); assert.equal(await page.locator('#lifeSearch').inputValue(), '함께'); assert.equal(await page.locator('#lifeOriginFilter').inputValue(), 'obsidian');
    });
    await check('search stays within workspace/account and never persists or transmits query state', async (page, context, device) => {
      await seed(page, [{ title: 'A 공간 자료', texts: ['A공간에서만 찾을 내용'] }]);
      const original = (await stored(page)).workspaceId;
      const other = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, current = await s.getActive(), b = await s.createWorkspace('별도 공간'); await s.setActive(current); return b.workspaceId; });
      await page.reload(); await ready(page); await sources(page, 'A공간'); assert.equal(await results(page).count(), 1);
      const sentinel = '검색상태만-71ca-메모리에', requests = [];
      page.on('request', request => requests.push(request.url() + (request.postData() || '')));
      await page.locator('#lifeSearch').fill(sentinel);
      assert.ok(!page.url().includes(encodeURIComponent(sentinel)) && !page.url().includes(sentinel));
      const local = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, history: history.state })); assert.ok(!local.includes(sentinel));
      assert.ok(!JSON.stringify(await stored(page)).includes(sentinel)); assert.ok(requests.every(text => !text.includes(sentinel) && !text.includes(encodeURIComponent(sentinel))));
      await page.locator('#lifeWorkspace').selectOption(other); await settle(page); await click(page, '원천 기록');
      assert.equal(await page.locator('#lifeSearch').inputValue(), ''); await page.locator('#lifeSearch').fill('A공간'); assert.equal(await results(page).count(), 0);
      await page.locator('#lifeWorkspace').selectOption(original); await settle(page); await click(page, '원천 기록'); assert.equal(await page.locator('#lifeSearch').inputValue(), '');
      await page.locator('#lifeSearch').fill(sentinel); await click(page, '로그아웃'); await page.waitForFunction(() => location.pathname.endsWith('/index.html') && document.readyState === 'complete');
      server.oauthAccounts.set(device, accounts.b); await page.goto(base + '/login.html?next=life.html'); await page.locator('#googleLogin').click(); await page.waitForURL('**/life.html'); await ready(page); await click(page, '원천 기록');
      assert.equal(await page.locator('#lifeSearch').inputValue(), ''); await page.locator('#lifeSearch').fill('A공간'); assert.equal(await results(page).count(), 0);
      assert.equal((await stored(page)).sources.length, 0); assert.doesNotMatch(await page.locator('#lifeApp').innerText(), /A 공간 자료/);
    });
    if (errors.length) { failures.push('unexpected console/page errors'); console.error(errors.join('\n')); }
  } finally { await browser.close(); }
  console.log(`Search browser: ${passed} passed, ${failures.length} failed; ${errors.length} unexpected console/page errors. Synthetic Auth; Apple hardware untested.`);
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
