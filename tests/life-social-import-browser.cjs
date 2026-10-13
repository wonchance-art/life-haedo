/* Social-source input journeys: real DOM, bundled SDK and IndexedDB; anonymous HTTP only.
 * npm run dev; node tests/life-social-import-browser.cjs
 * This does not fetch a social post, log into a provider, or prove Apple clipboard behavior.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { FakeCloud, base, cloud, openManagement } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe } = require('./unified-home-browser.cjs');
const button = async (page, name) => { await page.getByRole('button', { name, exact: true }).click(); await settle(page); };
const bundle = page => page.evaluate(async () => HaedoLife.Shell.storage.read(await HaedoLife.Shell.storage.getActive()));
const stages = page => page.evaluate(async () => HaedoLife.Shell.storage.listStages(await HaedoLife.Shell.storage.getActive()));
const sourceFile = (name, text) => ({ name, mimeType: /\.md$/i.test(name) ? 'text/markdown' : 'text/plain', buffer: Buffer.from(text) });
const suggestion = page => page.locator('#lifeImportOriginSuggestion button');
async function openImport(page) { await page.goto(base + '/index.html'); await ready(page); await button(page, '가져오기'); }
async function exposeField(page, selector) {
  const control = page.locator(selector);
  if (!(await control.isVisible())) await control.locator('xpath=ancestor::details[1]').locator('summary').click();
  assert.equal(await control.isVisible(), true);
  return control;
}
async function sourceDetails(page, values = {}) {
  for (const [key, value] of Object.entries(values)) {
    const control = await exposeField(page, '#lifeImport' + key);
    if (['Coverage', 'Relation'].includes(key)) await control.selectOption(value); else await control.fill(value);
  }
}
async function quote(page, text) {
  await page.locator('#lifeReviewText').evaluate((el, value) => {
    const start = el.value.indexOf(value);
    if (start < 0) throw new Error('Synthetic quote absent');
    el.focus(); el.setSelectionRange(start, start + value.length); el.dispatchEvent(new Event('select', { bubbles: true }));
  }, text);
  await page.locator('#lifeExcerptTopic').fill('천천히 다시 읽기');
  await page.locator('#lifeExcerptNote').fill('익명 검토 메모');
  await button(page, '발췌 후보 추가');
}
async function savedDraft(page) { await button(page, '검토 내용 보관'); const saved = await stages(page); assert.equal(saved.length, 1); return saved[0]; }
async function main() {
  await fs.mkdir('.local/life-social-import', { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, externalRequests: [], realRemoteWrites: 0, browser: browser.version() };
  async function check(name, run) {
    if (process.env.SOCIAL_TEST_MATCH && !new RegExp(process.env.SOCIAL_TEST_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'social-' + report.checks.length), page = await context.newPage();
    page.setDefaultTimeout(15000); observe(page, report, name);
    // Newest route runs first. No imported URL (or other unexpected external resource)
    // can escape to the network, even if an implementation accidentally tries to fetch it.
    await context.route('**/*', route => {
      const origin = new URL(route.request().url()).origin;
      if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
      report.externalRequests.push({ check: name, origin });
      return route.abort('blockedbyclient');
    });
    try {
      await openImport(page); await run({ page, context, server });
      assert.equal(server.writes().length, 0, 'Input/review must never opt into cloud writes');
      assert.equal(report.externalRequests.filter(item => item.check === name).length, 0, 'Source URL was fetched');
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); if (process.env.CI) console.error('::error::' + String(name + ': ' + error.stack).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')); }
    finally { await context.close(); }
  }
  try {
    await check('recognized exact hosts only suggest an origin; explicit acceptance preserves URL spelling and never commits', async ({ page }) => {
      const examples = [
        ['https://blog.naver.com/anonymous/123?from=outside#본문', 'naver_blog', '네이버 블로그로 설정'],
        ['http://m.blog.naver.com/anonymous/123?from=share#part', 'naver_blog', '네이버 블로그로 설정'],
        [' HTTPS://BLOG.NAVER.COM/anonymous/123?Keep=UPPER#Part ', 'naver_blog', '네이버 블로그로 설정'],
        ['https://instagram.com/p/Anonymous_1/?igsh=synthetic#caption', 'instagram', 'Instagram으로 설정'],
        ['https://www.instagram.com/reel/Anonymous_2/?next=%2F#caption', 'instagram', 'Instagram으로 설정']
      ];
      for (const [url, origin, label] of examples) {
        await page.locator('#lifeImportOrigin').selectOption('other'); await page.locator('#lifeImportUrl').fill(url);
        assert.equal(await page.locator('#lifeImportOrigin').inputValue(), 'other', 'Pasting a URL changed the chosen source');
        assert.equal(await suggestion(page).innerText(), label); await suggestion(page).click(); await settle(page);
        assert.equal(await page.locator('#lifeImportOrigin').inputValue(), origin); assert.equal(await page.locator('#lifeImportUrl').inputValue(), url);
        assert.equal(await page.locator('#lifeImportOrigin').evaluate(el => el === document.activeElement), true);
        assert.equal(await suggestion(page).isVisible(), false);
      }
      assert.equal((await bundle(page)).sources.length, 0);
    });
    await check('lookalike, credential, malformed and non-HTTP addresses have no platform suggestion; manual choice remains authoritative', async ({ page }) => {
      const examples = ['https://blog.naver.com.evil.invalid/post', 'https://notinstagram.com/p/x', 'https://www.instagram.com.evil.invalid/p/x', 'https://naver.com/post', 'https://m.instagram.com/p/x',
        'https://name@blog.naver.com/post', 'https://name:pass@instagram.com/p/x', 'https://instagram.com@evil.invalid/post', 'https://blog.naver.com\\@evil.invalid/post',
        'https://blog.naver.com/has space', 'javascript:alert(1)', 'ftp://instagram.com/p/x', '//instagram.com/p/x', 'not a url'];
      await page.locator('#lifeImportOrigin').selectOption('obsidian');
      for (const url of examples) {
        await page.locator('#lifeImportUrl').fill(url);
        assert.equal(await suggestion(page).isVisible(), false, 'Incorrect suggestion for ' + url);
        assert.equal(await page.locator('#lifeImportOrigin').inputValue(), 'obsidian');
      }
      await page.locator('#lifeImportUrl').fill('https://www.instagram.com/p/Anonymous_3/');
      await page.locator('#lifeImportOrigin').selectOption('apple_notes');
      assert.equal(await page.locator('#lifeImportOrigin').inputValue(), 'apple_notes');
      await page.locator('#lifeImportTitle').fill('직접 지정한 원천'); await page.locator('#lifeImportText').fill('사용자가 선택한 출처를 그대로 둡니다.');
      const draft = await savedDraft(page); assert.equal(draft.input.origin, 'apple_notes'); assert.equal((await bundle(page)).sources.length, 0);
    });
    await check('accepting a source suggestion preserves reviewed metadata and exact excerpt candidates', async ({ page }) => {
      const raw = '첫 문장\n👨‍👩‍👧‍👦 함께 읽을 한글 문장🌱\n마지막 문장', selected = '👨‍👩‍👧‍👦 함께 읽을 한글 문장🌱';
      await page.locator('#lifeImportOrigin').selectOption('other'); await page.locator('#lifeImportTitle').fill('출처만 다시 확인하는 익명 기록');
      await page.locator('#lifeImportUrl').fill('https://blog.naver.com/anonymous/456?ref=keep#quote'); await page.locator('#lifeImportText').fill(raw);
      await sourceDetails(page, { Author: '익명 작성자', Relation: 'other', Date: '2025-04-17', Coverage: 'partial', Omissions: '사진 미보관, 댓글 미포함' });
      await button(page, '원문·출처 확인'); await quote(page, selected); await button(page, '입력 수정');
      const before = await savedDraft(page); await suggestion(page).click(); await settle(page); const after = await savedDraft(page);
      assert.deepEqual(after.input, { ...before.input, origin: 'naver_blog' }); assert.deepEqual(after.excerpts, before.excerpts);
      assert.equal(after.excerpts.length, 1); assert.equal(raw.slice(after.excerpts[0].start, after.excerpts[0].end), selected);
      assert.equal((await bundle(page)).sources.length, 0);
      await button(page, '원문·출처 확인'); await button(page, '선택한 발췌 모음에 반영');
      const saved = await bundle(page); assert.equal(saved.sources[0].origin, 'naver_blog'); assert.equal(saved.records[0].text, selected);
    });
    await check('invalid URL review preserves pasted body and details and recovers after correcting only the URL', async ({ page }) => {
      const raw = '주소 오류가 나도 지우지 않을 게시물 본문🌱\n두 번째 문장';
      await page.locator('#lifeImportOrigin').selectOption('instagram'); await page.locator('#lifeImportTitle').fill('실패 후 이어서 확인');
      await page.locator('#lifeImportText').fill(raw); await page.locator('#lifeImportUrl').fill('javascript:globalThis.__unexpectedSocialScript=true');
      await sourceDetails(page, { Coverage: 'partial', Author: '익명 작성자' }); await button(page, '원문·출처 확인');
      assert.equal(await page.locator('#lifeError').isVisible(), true); assert.equal(await page.locator('.life-review').count(), 0);
      assert.equal(await page.locator('#lifeImportText').inputValue(), raw); assert.equal(await page.locator('#lifeImportTitle').inputValue(), '실패 후 이어서 확인');
      assert.equal((await bundle(page)).sources.length, 0); assert.equal(await page.evaluate(() => !!globalThis.__unexpectedSocialScript), false);
      await page.locator('#lifeImportUrl').fill('https://www.instagram.com/p/Anonymous_recovered/?igsh=keep#caption');
      await button(page, '원문·출처 확인'); assert.equal(await page.locator('#lifeError').isVisible(), false); await button(page, '자료만 보관');
      const saved = await bundle(page); assert.equal(saved.sourceVersions[0].contentText, raw); assert.equal(saved.sourceVersions[0].originalAuthor.label, '익명 작성자');
      assert.equal(saved.sourceVersions[0].coverage.status, 'partial');
    });
    for (const [origin, url, label] of [['naver_blog', 'https://m.blog.naver.com/anonymous/789?from=share&Keep=%2F#본문', '네이버 블로그로 설정'], ['instagram', 'https://www.instagram.com/p/Anonymous_4/?igsh=keep&Keep=%2F#caption', 'Instagram으로 설정']]) {
      await check(origin + ' pasted partial body → exact excerpt/source → JSON backup and remapped copy preserves provenance', async ({ page }) => {
        const raw = '  오전에 다시 읽은 ' + origin + ' 기록\n🌱 “사진보다 기억하고 싶은 문장”을 남긴다.\n👩🏽‍💻 한글과 이모지를 함께 발췌한다.  ', selected = '👩🏽‍💻 한글과 이모지를 함께 발췌한다.';
        await page.locator('#lifeImportTitle').fill('따뜻한 창가에서 다시 읽은 산책 기록'); await page.locator('#lifeImportUrl').fill('  ' + url + '  ');
        await button(page, label); await page.locator('#lifeImportText').fill(raw);
        assert.equal(await page.locator('#lifeImportWebScope').isVisible(), true); assert.equal(await page.locator('#lifeImportCoverage').isVisible(), true);
        assert.equal(await page.locator('#lifeImportWebHelp').evaluate(el => el.open), false); assert.equal(await page.locator('#lifeImportWebNotice').isVisible(), true);
        assert.match(await page.locator('#lifeImportWebNotice').innerText(), /사진/); assert.match(await page.locator('#lifeImportWebNotice').innerText(), /영상/);
        await sourceDetails(page, { Coverage: 'partial', Author: '익명 산책자', Relation: 'other', Date: '2024-06-03', Omissions: '사진 미보관, 댓글 미포함' });
        await button(page, '원문·출처 확인'); assert.equal(await page.locator('#lifeReviewWebNotice').isVisible(), true); await quote(page, selected);
        assert.equal((await bundle(page)).sources.length, 0); await button(page, '선택한 발췌 모음에 반영');
        const saved = await bundle(page), version = saved.sourceVersions[0], record = saved.records[0], range = record.sourceRefs[0].locator;
        assert.equal(saved.sources[0].origin, origin); assert.equal(saved.sources[0].url, url); assert.equal(version.contentText, raw);
        assert.deepEqual(version.coverage, { status: 'partial', omissions: ['사진 미보관', '댓글 미포함'] });
        assert.deepEqual(version.originalAuthor, { label: '익명 산책자', relation: 'other' }); assert.equal(version.originalCreatedAt, '2024-06-03');
        assert.deepEqual(range, { start: raw.indexOf(selected), end: raw.indexOf(selected) + selected.length }); assert.equal(record.text, selected);
        await page.getByRole('button', { name: /^원문에서 보기/ }).click(); await settle(page);
        assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
        await page.waitForFunction(expected => getSelection().toString() === expected, selected);
        assert.equal(await page.locator('#lifeApp .life-source-url').textContent(), url);
        assert.equal(await page.locator('#lifeApp a.life-external').getAttribute('href'), new URL(url).href);
        await openManagement(page); await button(page, '내보내기·사본 복원'); const pending = page.waitForEvent('download'); await button(page, 'JSON 백업');
        const backup = JSON.parse(await fs.readFile(await (await pending).path(), 'utf8'));
        assert.equal(backup.workspace.sources[0].url, url); assert.deepEqual(backup.workspace.sourceVersions[0], version);
        await page.locator('#lifeRestoreFile').setInputFiles({ name: 'social-source-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }); await settle(page);
        await button(page, '새 사본으로 복원'); const restored = await bundle(page);
        assert.notEqual(restored.workspaceId, saved.workspaceId); assert.notEqual(restored.sources[0].id, saved.sources[0].id); assert.equal(restored.sources[0].url, url);
        assert.equal(restored.sourceVersions[0].contentText, raw); assert.deepEqual(restored.sourceVersions[0].coverage, version.coverage);
        assert.deepEqual(restored.sourceVersions[0].originalAuthor, version.originalAuthor); assert.equal(restored.sourceVersions[0].originalCreatedAt, version.originalCreatedAt);
        assert.equal(restored.records[0].text, selected); assert.deepEqual(restored.records[0].sourceRefs[0].locator, range);
        assert.equal(restored.records[0].sourceRefs[0].sourceId, restored.sources[0].id); assert.equal(restored.records[0].sourceRefs[0].sourceVersionId, restored.sourceVersions[0].id);
      });
    }
    await check('link-only preview neither fetches nor marks body obtained; adding a body starts with unknown coverage', async ({ page }) => {
      await page.locator('#lifeImportUrl').fill('https://instagram.com/p/Anonymous_link/'); await button(page, 'Instagram으로 설정'); await button(page, '링크 보관');
      await page.locator('#lifeImportTitle').fill('나중에 본문을 확인할 링크');
      const draft = await savedDraft(page); assert.equal(draft.input.coverage.status, 'unknown');
      await button(page, '원문·출처 확인'); assert.equal(await page.locator('#lifeReviewText').count(), 0); assert.match(await page.locator('.life-review').innerText(), /본문 미확보/);
      assert.equal((await bundle(page)).sources.length, 0); await button(page, '입력 수정'); await button(page, '본문 붙여넣기');
      await page.locator('#lifeImportText').fill('사용자가 직접 제공한 새 본문'); assert.equal(await page.locator('#lifeImportCoverage').isVisible(), true);
      assert.equal(await page.locator('#lifeImportCoverage').inputValue(), 'unknown');
      await button(page, '원문·출처 확인'); assert.match(await page.locator('.life-review').innerText(), /확보 범위 미확인/); await button(page, '자료만 보관');
      const saved = await bundle(page); assert.equal(saved.sourceVersions[0].coverage.status, 'unknown'); assert.equal(saved.sourceVersions[0].contentText, '사용자가 직접 제공한 새 본문');
    });
    await check('file CRLF content and raw UTF-16 locators survive source acceptance and input-method switches', async ({ page }) => {
      const raw = '# 파일로 보관한 게시물\r\n\r\n👨‍👩‍👧‍👦 보존할 한글 구절🌱\r\n끝', selected = '👨‍👩‍👧‍👦 보존할 한글 구절🌱';
      await page.locator('#lifeImportTitle').fill('파일에서 읽은 익명 게시물'); await button(page, '텍스트 파일');
      await page.locator('#lifeImportFile').setInputFiles(sourceFile('anonymous-social.md', raw)); await settle(page);
      await page.locator('#lifeImportUrl').fill('https://blog.naver.com/anonymous/321?source=file#quote'); await button(page, '네이버 블로그로 설정');
      await button(page, '링크 보관'); await button(page, '텍스트 파일'); await button(page, '본문 붙여넣기');
      const draft = await savedDraft(page); assert.equal(draft.input.text, raw); assert.equal(draft.input.fileName, 'anonymous-social.md'); assert.equal(draft.input.format, 'text/markdown');
      await button(page, '원문·출처 확인'); await quote(page, selected); await button(page, '선택한 발췌 모음에 반영');
      const saved = await bundle(page); assert.equal(saved.sourceVersions[0].contentText, raw); assert.equal(saved.sourceVersions[0].format, 'text/markdown');
      assert.deepEqual(saved.records[0].sourceRefs[0].locator, { start: raw.indexOf(selected), end: raw.indexOf(selected) + selected.length });
    });
    await check('uncommitted social draft resumes after reload with body, URL, source and inclusion decisions intact', async ({ page }) => {
      const raw = '앱을 닫기 전에 확인하던 본문🌱\n남겨 둔 두 번째 문장', url = 'https://www.instagram.com/p/Anonymous_draft/?igsh=keep#caption';
      await page.locator('#lifeImportTitle').fill('이어서 확인할 익명 게시물'); await page.locator('#lifeImportUrl').fill(url); await button(page, 'Instagram으로 설정');
      await page.locator('#lifeImportText').fill(raw); await sourceDetails(page, { Coverage: 'partial', Author: '익명 작성자', Relation: 'self', Omissions: '사진 미보관' });
      const draft = await savedDraft(page); await page.reload(); await ready(page); await button(page, '기록으로 돌아가기');
      await page.getByText(/검토 중 \d+개 · 이어서 확인/).click(); await button(page, '이어서 확인할 익명 게시물');
      assert.equal(await page.locator('#lifeImportText').inputValue(), raw); assert.equal(await page.locator('#lifeImportUrl').inputValue(), url);
      assert.equal(await page.locator('#lifeImportOrigin').inputValue(), 'instagram'); assert.equal(await page.locator('#lifeImportCoverage').inputValue(), 'partial');
      assert.equal(await page.locator('#lifeImportCoverage').isVisible(), true); assert.deepEqual((await stages(page))[0].input, draft.input);
      assert.equal((await bundle(page)).sources.length, 0); await button(page, '원문·출처 확인'); await button(page, '자료만 보관');
      assert.equal((await bundle(page)).sourceVersions[0].contentText, raw);
    });
  } finally {
    await browser.close(); await fs.writeFile(process.env.SOCIAL_REPORT_PATH || '.local/life-social-import/browser-report.json', JSON.stringify(report, null, 2) + '\n');
  }
  const failed = report.checks.filter(item => !item.pass).length;
  console.log(JSON.stringify({ passed: report.checks.length - failed, failed, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, externalRequests: report.externalRequests.length, realRemoteWrites: 0 }));
  if (failed || report.consoleErrors.length || report.pageErrors.length || report.externalRequests.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
