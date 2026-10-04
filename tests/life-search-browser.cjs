/* Search journeys using actual Chromium, packaged SDK and account-scoped IDB.
 * npm run dev; node tests/life-search-browser.cjs. Anonymous Auth HTTP only.
 * Neither Apple IME/File providers nor real Google OAuth are verified here.
 */
'use strict';
const assert = require('node:assert/strict');
const { FakeCloud, platformContext, accounts, base, openManagement, openAccount, openSection } = require('./life-sync-browser.cjs');
function playwright() {
  for (const name of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core', '/opt/codex/cua_node/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Set PW_MODULE_PATH to an existing Playwright installation.');
}
const settle = page => page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]'));
async function click(page, name) {
  if (['모아보기','원천 기록','가져오기','시간 보기'].includes(name)) await openSection(page, 'records');
  if (name === '로그아웃') await openAccount(page);
  await page.getByRole('button', { name, exact: true }).click(); await settle(page);
}
async function ready(page) {
  await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.storage && !document.querySelector('#lifeApp').hidden);
  await page.evaluate(() => HaedoLife.Shell.ready);
}
const results = page => page.locator('#lifeSearchResults article[data-source-id][data-version-id]');
const result = (page, versionId) => page.locator('#lifeSearchResults article[data-version-id="' + versionId + '"]');
async function openResult(page, versionId) { await result(page, versionId).getByRole('button', { name: /^자료 읽기/ }).click(); await settle(page); }
const stored = page => page.evaluate(async () => HaedoLife.Shell.storage.read(await HaedoLife.Shell.storage.getActive()));
async function sources(page, query) { await click(page, '원천 기록'); await page.locator('#lifeSearch').fill(query); }
async function selectedText(page, expected) {
  await page.waitForFunction(expected => {
    const el = document.querySelector('#lifeSourceText'), selection = getSelection();
    return el?.contains(selection?.anchorNode) && el.contains(selection?.focusNode) && selection.toString() === expected;
  }, expected);
}
async function hasReaderSelection(page) {
  return page.locator('#lifeSourceText').evaluate(el => {
    const selection = getSelection();
    return !selection.isCollapsed && el.contains(selection.anchorNode) && el.contains(selection.focusNode);
  });
}
async function excerptPanel(page) {
  const toggle = page.getByRole('button', { name: '발췌와 주제 연결', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}
async function filterPanel(page) {
  const toggle = page.getByRole('button', { name: '검색 필터', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
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
      assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
      await excerptPanel(page);
      await page.locator('#lifeSourceTopic').fill('기억한 구절'); await click(page, '선택 구절 모음에 추가');
      const b = await stored(page), record = b.records[0]; assert.equal(record.text, quote);
      assert.deepEqual(record.sourceRefs, [{ sourceId: s.sourceId, sourceVersionId: s.versions[0], locator: { start: raw.indexOf(quote), end: raw.indexOf(quote) + quote.length } }]);
      assert.equal(b.sourceVersions.find(v => v.id === s.versions[0]).contentText, raw);
      await page.locator('#lifeVersion').selectOption(s.versions[1]); await settle(page);
      assert.equal(await hasReaderSelection(page), false);
    });
    await check('backward DOM selection preserves a repeated cross-line quote and keyboard fallback uses raw coordinates', async page => {
      const quote = '반복 🌱 한글 e\u0301\r\n다음 문장';
      const raw = '머리\r\n' + quote + '\r\n가운데\r\n' + quote + '\r\n끝';
      const start = raw.lastIndexOf(quote), end = start + quote.length;
      const [s] = await seed(page, [{ title: '반복 문장 선택', texts: [raw] }]);
      await sources(page, ''); await openResult(page, s.versions[0]);
      assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
      assert.equal(await page.getByRole('button', { name: '발췌와 주제 연결', exact: true }).getAttribute('aria-expanded'), 'false');
      // A real backward Selection, using caller-owned raw offsets, catches
      // accidental first-match lookup and newline/surrogate normalization.
      await page.locator('#lifeSourceText').evaluate((el, { start, end }) => {
        el.focus();
        const node = el.firstChild;
        if (node.nodeType !== Node.TEXT_NODE) throw new Error('reader did not expose source text');
        getSelection().setBaseAndExtent(node, end, node, start);
      }, { start, end });
      await selectedText(page, quote);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      assert.equal(await page.getByRole('button', { name: '발췌와 주제 연결', exact: true }).getAttribute('aria-expanded'), 'false', 'selecting text opened a panel');
      assert.equal(await page.locator('#lifeSourceText').evaluate(el => el === document.activeElement), true, 'selecting text stole reader focus');
      await excerptPanel(page);
      await page.locator('#lifeSourceTopic').fill('반복 구절');
      await page.locator('#lifeSourceNote').fill('둘째 구절의 원문 위치');
      await page.keyboard.press('Escape');
      const toggle = page.getByRole('button', { name: '발췌와 주제 연결', exact: true });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await toggle.evaluate(el => el === document.activeElement), true, 'closing excerpt did not return toolbar focus');
      assert.equal((await stored(page)).records.length, 0, 'closing a draft saved an excerpt');
      await excerptPanel(page);
      assert.equal(await page.locator('#lifeSourceTopic').inputValue(), '반복 구절');
      assert.equal(await page.locator('#lifeSourceNote').inputValue(), '둘째 구절의 원문 위치');
      await click(page, '선택 구절 모음에 추가');
      let b = await stored(page);
      assert.equal(b.records[0].text, quote);
      assert.equal(b.records[0].note, '둘째 구절의 원문 위치');
      assert.deepEqual(b.records[0].sourceRefs, [{ sourceId: s.sourceId, sourceVersionId: s.versions[0], locator: { start, end } }]);
      assert.equal(b.sourceVersions[0].contentText, raw);

      await excerptPanel(page); await click(page, '키보드로 구절 선택');
      const keyboard = page.locator('#lifeSourceSelectionText');
      assert.equal(await keyboard.inputValue(), raw.replace(/\r\n/g, '\n'));
      // Chromium readonly textareas cannot expand a collapsed caret with Shift.
      // Start through the actual first-line control, then extend with a real key.
      await click(page, '첫 줄 선택');
      assert.equal(await keyboard.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd)), '머리\n');
      // Native textarea keyboard selection includes the CRLF-normalized line;
      // the saved locator must still refer to the exact raw source characters.
      await page.keyboard.press('Shift+ArrowRight');
      assert.equal(await keyboard.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd)), '머리\n반');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await excerptPanel(page);
      await page.locator('#lifeSourceTopic').fill('키보드 구절');
      await click(page, '선택 구절 모음에 추가');
      b = await stored(page);
      const keyboardRecord = b.records.find(record => record.topic === '키보드 구절');
      assert.ok(keyboardRecord, 'keyboard selection was not saved');
      assert.equal(keyboardRecord.text, '머리\r\n반');
      assert.deepEqual(keyboardRecord.sourceRefs[0].locator, { start: 0, end: '머리\r\n반'.length });
      assert.equal(b.sourceVersions[0].contentText, raw);
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
      assert.equal(await hasReaderSelection(page), false);
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
      await excerptPanel(page);
      await page.locator('#lifeSourceTopic').fill('이전 선택'); await click(page, '선택 구절 모음에 추가');
      assert.equal((await stored(page)).records[0].text, '다른');
      await page.locator('#lifeSearchReturn').click(); await settle(page); await page.locator('#lifeSearch').fill('제목표식');
      assert.equal(await results(page).count(), 2); assert.equal(await page.locator('#lifeSearchResults mark').count(), 0);
      await openResult(page, text.versions[0]);
      // Drain pending reader rAF work so a delayed old-selection restore cannot
      // pass a premature collapsed-selection assertion.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await hasReaderSelection(page), false);
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
      await excerptPanel(page);
      await page.locator('#lifeSourceTopic').fill('문자 좌표'); await click(page, '선택 구절 모음에 추가');
      assert.deepEqual((await stored(page)).records[0].sourceRefs[0].locator, { start: raw.indexOf('K'), end: raw.indexOf('K') + 1 });
      await page.locator('#lifeSearchReturn').click(); await settle(page); await page.locator('#lifeSearch').fill('e\u0301'); assert.equal(await results(page).count(), 0);
      await page.locator('#lifeSearchClear').click(); assert.equal(await page.locator('#lifeSearch').inputValue(), ''); assert.equal(await results(page).count(), 1);
    });
    await check('source filters and topic queries return independently; a second excerpt reference opens its own source', async page => {
      const ids = await seed(page, [{ title: '첫째근거', origin: 'apple_notes', texts: ['첫째 함께 읽을 구절 끝'] }, { title: '둘째근거', origin: 'obsidian', texts: ['🌱\r\n함께 읽을 구절 둘째'] }], true);
      await sources(page, '함께'); await filterPanel(page); await page.locator('#lifeOriginFilter').selectOption('obsidian'); assert.equal(await results(page).count(), 1);
      await openResult(page, ids[1].versions[0]); await page.locator('#lifeSearchReturn').click(); await settle(page);
      assert.equal(await page.locator('#lifeSearch').inputValue(), '함께'); assert.equal(await page.locator('#lifeOriginFilter').inputValue(), 'obsidian');
      await page.waitForFunction(id => document.activeElement?.matches('button[data-version-id="' + id + '"]'), ids[1].versions[0]);
      assert.equal(await result(page, ids[1].versions[0]).getByRole('button', { name: /^자료 읽기/ }).evaluate(el => el === document.activeElement), true);
      await click(page, '모아보기'); await page.locator('#lifeSearch').fill('둘째근거'); await filterPanel(page); await click(page, '확인 주제');
      assert.equal(await page.locator('.life-quote').count(), 1);
      await page.getByRole('button', { name: /^발췌 출처 정보/ }).click();
      const second = page.locator('.life-source-refs button[data-source-id="' + ids[1].sourceId + '"][data-version-id="' + ids[1].versions[0] + '"]');
      const secondFocusKey = await second.getAttribute('data-focus-key');
      await second.click(); await settle(page); await selectedText(page, '함께 읽을 구절');
      assert.equal(await page.locator('#lifeSourceText').textContent(), '🌱\r\n함께 읽을 구절 둘째');
      await page.locator('#lifeSearchReturn').click(); await settle(page);
      assert.equal(await page.locator('#lifeSearch').inputValue(), '둘째근거'); assert.equal(await page.getByRole('button', { name: '확인 주제', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, secondFocusKey);
      assert.equal(await second.isVisible(), true);
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
      await openManagement(page); await page.locator('#lifeWorkspace').selectOption(other); await settle(page); await click(page, '원천 기록');
      assert.equal(await page.locator('#lifeSearch').inputValue(), ''); await page.locator('#lifeSearch').fill('A공간'); assert.equal(await results(page).count(), 0);
      await openManagement(page); await page.locator('#lifeWorkspace').selectOption(original); await settle(page); await click(page, '원천 기록'); assert.equal(await page.locator('#lifeSearch').inputValue(), '');
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
