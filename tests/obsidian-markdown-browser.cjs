/* Obsidian properties on actual local import/read/edit/backup UI and scoped IDB.
 * Anonymous fixtures and FakeCloud Auth only; no real vault, account or network.
 * BASE_URL=http://127.0.0.1:4173 node tests/obsidian-markdown-browser.cjs */
'use strict';
const { isLegacyLibraryCapabilityRead } = require('./helpers/library-cloud.cjs');
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Module = require('node:module');
const { FakeCloud, accounts, cloud, base, openManagement } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext } = require('./unified-home-browser.cjs');
const output = path.resolve(process.env.OBSIDIAN_MARKDOWN_OUTPUT || '.local/obsidian-markdown');
const title = '익명 속성 분리 검수 자료';
const propertyTitle = '속성전용문구_익명표시';
const quote = '두 번째 위치도 정확한 익명 문장🌱';
const note = '익명 속성·본문 위치 확인 메모';
const header = '\uFEFF---\r\n' +
  'title: "' + propertyTitle + '"\r\n' +
  'date: "2026-01-02"\r\n' +
  'tags: ["익명쓰기", "익명연구"]\r\n' +
  'related:\r\n  - "[[익명 관련 문서]]"\r\n  - "https://example.invalid/anonymous-related"\r\n' +
  '긴_익명_속성_이름_줄바꿈_검사: "' + '긴 속성값을 본문과 분리합니다 '.repeat(8) + '"\r\n' +
  'unsafe_literal: \'<svg onload="globalThis.__obsidianMarkupExecuted=true">익명 값</svg>\'\r\n' +
  '---\r\n';
const raw = header + '\r\n# 익명 본문\r\n\r\n' +
  '본문의 **분리된 강조**와 [익명 출처](https://example.invalid/anonymous-source)입니다.\r\n\r\n' +
  quote + '\r\n\r\n' + quote + '\r\n\r\n' +
  '---\r\n\r\n> 원문의 정확한 문단입니다.\r\n\r\n' +
  '```yaml\r\ntitle: "본문 안의 코드 예시"\r\n```\r\n\r\n' +
  '![외부 이미지 요청 금지](https://images.example.invalid/anonymous-never.png)\r\n\r\n' +
  '<script>globalThis.__obsidianMarkupExecuted=true</script>\r\n';
const edited = raw.replace(/\r\n?/g, '\n').replace(propertyTitle, '수정한_익명_속성값') + '\n## 직접 수정한 본문\n보관한 사본에 추가한 익명 문장입니다.\n';
const invalid = '\uFEFF---\r\ntitle: [닫히지 않은 익명 값\r\n---\r\n\r\n# 잘못된 YAML 뒤의 본문\r\n';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const click = async (page, selector) => { await page.locator(selector).click(); await settle(page); };
const byName = async (page, name) => { await page.getByRole('button', { name, exact: true }).click(); await settle(page); };
const report = { createdAt: new Date().toISOString(), scope: 'Actual local file import/read/raw quoting/edit preview/save/reopen/backup UI, bundled SDK and account-scoped IndexedDB; anonymous synthetic Markdown and intercepted FakeCloud Auth only. Direct renderer negative controls and seeded hidden-property reading point are explicit test fixtures. No real vault/working files, production account/DB/provider, Obsidian plugin runtime, Apple device or OS file-save proof.', checks: [], visual: [], observations: [], consoleErrors: [], pageErrors: [], externalRequests: [], privacyViolations: [], libraryCapabilityReads: [], remoteWrites: [], closedContexts: 0 };
async function snapshot(page) {
  return page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); return { bundle: await s.read(w), interest: await s.readInterestProfile(w) }; });
}
async function records(page) { await page.goto(base + '/index.html?section=records'); await ready(page); await settle(page); await page.locator('#lifeSearch').waitFor(); }
async function reveal(control) {
  const depth = await control.locator('xpath=ancestor::details').count();
  for (let n = depth; n > 0; n--) { const parent = control.locator('xpath=ancestor::details[' + n + ']'); if (!await parent.evaluate(el => el.open)) await parent.locator(':scope > summary').click(); }
}
async function importMarkdown(page, content = raw, importTitle = title) {
  await records(page); const before = await snapshot(page); await byName(page, '가져오기'); await byName(page, '텍스트 파일');
  await page.locator('#lifeImportFile').setInputFiles({ name: 'anonymous-properties.md', mimeType: 'text/markdown', buffer: Buffer.from(content) }); await settle(page);
  for (const [name, value] of Object.entries({ Origin: 'obsidian', Title: importTitle, Author: '익명 작성자', Relation: 'other', Coverage: 'partial', Omissions: '익명 검증 자료의 원본 첨부는 포함하지 않음' })) {
    const field = page.locator('#lifeImport' + name); await reveal(field);
    if (['Origin', 'Relation', 'Coverage'].includes(name)) await field.selectOption(value); else await field.fill(value);
  }
  await byName(page, '원문·출처 확인'); await byName(page, '자료만 보관'); await page.locator('#lifeSourceInfoToggle').waitFor();
  const after = await snapshot(page), source = after.bundle.sources.find(s => s.title === importTitle); assert(source);
  const version = after.bundle.sourceVersions.filter(v => v.sourceId === source.id).at(-1); assert.equal(version.format, 'text/markdown'); assert.equal(version.contentText, content); assert.equal(version.contentHash, sha(content));
  assert.equal(version.originalCreatedAt, null, 'YAML date does not infer source metadata'); assert.deepEqual(after.interest, before.interest, 'Properties do not become interests');
  return { source, version, workspaceId: after.bundle.workspaceId, interest: after.interest };
}
async function openSource(page, sourceId) {
  await records(page); const bundle = (await snapshot(page)).bundle, version = bundle.sourceVersions.filter(v => v.sourceId === sourceId).at(-1);
  await click(page, '.life-source-open[data-version-id="' + version.id + '"]'); await page.locator('#lifeSourceInfoToggle').waitFor();
}
async function sourceOptions(page) { const toggle = page.locator('#lifeSourceInfoToggle'); if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click(); await page.locator('#lifeSourceDetails').waitFor({ state: 'visible' }); }
async function beginEdit(page) { await sourceOptions(page); await click(page, '#lifeSourceEdit'); await page.locator('#lifeSourceEditText').waitFor(); }
async function backup(page) {
  await openManagement(page); await byName(page, '내보내기·사본 복원'); const pending = page.waitForEvent('download'); await byName(page, 'JSON 백업'); const download = await pending, chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function safeProjection(page, host = '#lifeSourceText') {
  const facts = await page.locator(host).evaluate(element => {
    const body = element.cloneNode(true); body.querySelectorAll('.source-properties').forEach(el => el.remove());
    return { propertyPanels: element.querySelectorAll('details.source-properties').length, summaries: [...element.querySelectorAll('details.source-properties > summary')].map(n => n.textContent), keys: [...element.querySelectorAll('.source-properties dt')].map(n => n.textContent), values: [...element.querySelectorAll('.source-properties dd')].map(n => n.textContent), lists: [...element.querySelectorAll('.source-properties dd > ul')].map(n => [...n.children].map(item => item.textContent)), propertyLinks: element.querySelectorAll('.source-properties a').length, bodyText: body.textContent, headings: body.querySelectorAll('h1,h2').length, strong: body.querySelectorAll('strong').length, unsafeNodes: element.querySelectorAll('script,img,iframe,video,audio,object,embed,svg,math,style,input,form,template').length, unsafeAttributes: [...element.querySelectorAll('*')].flatMap(n => [...n.attributes].filter(a => /^on/i.test(a.name) || ['src', 'srcset', 'id', 'style'].includes(a.name)).map(a => a.name)), unsafeLinks: [...element.querySelectorAll('a[href]')].map(n => n.getAttribute('href')).filter(h => !/^https?:\/\//i.test(h)), executed: globalThis.__obsidianMarkupExecuted === true };
  });
  assert.equal(facts.propertyPanels, 1); assert.deepEqual(facts.summaries, ['속성']); assert.deepEqual(facts.keys, ['title', 'date', 'tags', 'related', '긴_익명_속성_이름_줄바꿈_검사', 'unsafe_literal']);
  assert.ok([propertyTitle, '수정한_익명_속성값'].includes(facts.values[0])); assert.equal(facts.values[1], '2026-01-02'); assert.deepEqual(facts.lists, [['익명쓰기', '익명연구'], ['[[익명 관련 문서]]', 'https://example.invalid/anonymous-related']]); assert.ok(facts.values.some(v => v.includes('익명쓰기') && v.includes('익명연구'))); assert.ok(facts.values.some(v => v.includes('[[익명 관련 문서]]'))); assert.ok(facts.values.some(v => v.includes('<svg onload=')));
  assert.equal(facts.propertyLinks, 0, 'Read-only related values remain plain text'); assert.ok(facts.headings && facts.strong); assert.ok(!facts.bodyText.includes('title: "' + propertyTitle + '"') && !facts.bodyText.includes(propertyTitle) && !facts.bodyText.includes('수정한_익명_속성값') && !facts.bodyText.includes('unsafe_literal:'), 'Metadata must not be repeated in the Markdown body');
  assert.equal(facts.unsafeNodes, 0); assert.deepEqual(facts.unsafeAttributes, []); assert.deepEqual(facts.unsafeLinks, []); assert.equal(facts.executed, false);
  return facts;
}
async function reusableVisual(hashes) {
  if (!process.env.OBSIDIAN_MARKDOWN_REUSE_VISUAL_OUTPUT) return null;
  const directory = path.resolve(process.env.OBSIDIAN_MARKDOWN_REUSE_VISUAL_OUTPUT), reportPath = path.join(directory, 'report.json'), bytes = await fs.readFile(reportPath), previous = JSON.parse(bytes), baselinePath = path.join(directory, 'source-markdown.captured-baseline.js'), baseline = await fs.readFile(baselinePath);
  assert.ok(previous.checks.every(c => c.pass)); assert.equal(previous.productsUnchangedDuringRun, true); assert.equal(sha(baseline), previous.sourceHashesBefore['assets/life/source-markdown.js']);
  for (const [file, hash] of Object.entries(hashes)) if (!['assets/life/source-markdown.js', 'tests/obsidian-markdown-browser.cjs'].includes(file)) assert.equal(hash, previous.sourceHashesBefore[file], 'Reused capture supporting source must be unchanged: ' + file);
  const filename = path.resolve(__dirname, '../assets/life/source-markdown.js'), old = new Module(filename, module), savedLife = globalThis.HaedoLife;
  try {
    old.filename = filename; old.paths = Module._nodeModulePaths(path.dirname(filename)); old._compile(baseline.toString('utf8'), filename);
    const oldPlan = old.exports.prepare(raw), currentPlan = require(filename).prepare(raw); assert.deepEqual(currentPlan, oldPlan, 'Reused positive capture must have an identical HTML, block and frontmatter plan');
    report.visualReuse = { previousReport: reportPath, previousReportSHA256: sha(bytes), baselineSource: baselinePath, baselineSourceSHA256: sha(baseline), positivePreparationIdentical: true, positivePlanSHA256: sha(JSON.stringify(currentPlan)), note: 'Existing captures are reused after identical positive projection plan, supporting sources and per-width geometry; no new screenshots are claimed.' };
  } finally { globalThis.HaedoLife = savedLife; }
  const captureHashes = { [reportPath]: sha(bytes), [baselinePath]: sha(baseline) };
  for (const item of previous.visual) captureHashes[path.join(directory, item.file)] = sha(await fs.readFile(path.join(directory, item.file)));
  report.reusedCaptureHashesBefore = captureHashes;
  return { directory, previous, captureHashes };
}
async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)); await fs.mkdir(output, { recursive: true });
  const yamlAssets = [...(await fs.readFile(path.resolve(__dirname, '../index.html'), 'utf8')).matchAll(/(?:src|href)="([^"\s]*yaml[^"\s]*)"/g)].map(m => m[1]).filter(p => !p.includes('://'));
  const files = [...new Set(['index.html', 'life.html', 'assets/life/source-markdown.js', 'assets/life/source-markdown.css', 'assets/life/ui.js', 'assets/life/source-edit-ui.js', 'assets/life/storage.js', 'assets/life/core.js', 'assets/life/reading-position.js', 'assets/platform-auth.js', 'sw.js', 'tests/obsidian-markdown-browser.cjs', ...yamlAssets])];
  const hashes = async () => Object.fromEntries(await Promise.all(files.map(async p => [p, sha(await fs.readFile(path.resolve(__dirname, '..', p)))]))); report.sourceHashesBefore = await hashes(); const reuse = await reusableVisual(report.sourceHashesBefore);
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, run) {
    if (process.env.OBSIDIAN_MARKDOWN_MATCH && !new RegExp(process.env.OBSIDIAN_MARKDOWN_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'obsidian-md-' + report.checks.length, accounts.a, { viewport: { width: 820, height: 1000 }, hasTouch: true, reducedMotion: 'reduce' });
    context.on('request', request => {
      const u = new URL(request.url()), body = request.postData() || '';
      if ([propertyTitle, quote, note, raw].some(text => u.href.includes(text) || u.href.includes(encodeURIComponent(text)) || body.includes(text) || body.includes(JSON.stringify(text).slice(1, -1)))) report.privacyViolations.push({ check: name, destination: u.origin + u.pathname });
      if (isLegacyLibraryCapabilityRead(request, { cloud, server })) report.libraryCapabilityReads.push({ check: name, owner: server.libraryOwner(request), method: request.method(), path: u.pathname, parameterCount: 0 });
      else if (u.origin === cloud && !['GET', 'OPTIONS'].includes(request.method()) && !u.pathname.startsWith('/auth/')) report.remoteWrites.push({ check: name, method: request.method(), path: u.pathname });
    });
    await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.externalRequests.push({ check: name, destination: u.origin + u.pathname }); return route.abort('blockedbyclient'); });
    context.on('page', page => { page.setDefaultTimeout(15000); page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ check: name, message: event.text() }); }); page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message })); });
    const page = await context.newPage(); console.log('RUN ' + name);
    try { await run({ page, context }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); report.closedContexts++; }
  }
  try {
    await check('Obsidian properties separate from the body through exact raw quoting, editing, reopening and a preserved backup copy', async ({ page }) => {
      const f = await importMarkdown(page); assert.equal(await page.locator('#lifeSourceText').getAttribute('data-reading-mode'), 'formatted'); await safeProjection(page);
      assert.equal(await page.locator('#lifeSourceText details.source-properties').evaluate(el => el.open), false);
      const offset = raw.indexOf('tags:');
      await page.evaluate(async ({ f, offset }) => { const s = HaedoLife.Shell.storage, old = await s.readReadingPosition(f.workspaceId), result = await s.saveReadingPosition(f.workspaceId, { sourceId: f.source.id, sourceVersionId: f.version.id, offset }, old.revision); if (result.status !== 'stored') throw Error('Synthetic hidden-property point was not stored'); }, { f, offset });
      await records(page); await click(page, '#lifeReadingResumeOpen'); await page.locator('#lifeSourceInfoToggle').waitFor();
      const resumedMode = await page.locator('#lifeSourceText').getAttribute('data-reading-mode');
      if (resumedMode === 'formatted') assert.equal(await page.locator('#lifeSourceText details.source-properties').evaluate(el => el.open), true, 'Explicit resume reveals the exact hidden property block');
      else { assert.equal(resumedMode, 'raw'); assert.equal(await page.locator('#lifeSourceText').textContent(), raw, 'Raw fallback retains the exact property target'); }
      const resumed = await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.readReadingPosition(await s.getActive()); }); assert.equal(resumed.position.offset, offset);
      await click(page, '#lifeExcerptToggle'); await page.waitForFunction(() => document.querySelector('#lifeSourceText')?.dataset.readingMode === 'raw'); assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
      const start = raw.lastIndexOf(quote), end = start + quote.length;
      await page.locator('#lifeSourceText').evaluate((el, range) => { if (el.firstChild?.nodeType !== Node.TEXT_NODE) throw Error('Raw reader lost its exact Text node'); el.focus(); const selection = getSelection(), r = document.createRange(); r.setStart(el.firstChild, range.start); r.setEnd(el.firstChild, range.end); selection.removeAllRanges(); selection.addRange(r); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }, { start, end });
      await page.locator('#lifeSourceTopic').fill('익명 검증'); await page.locator('#lifeSourceNote').fill(note); await click(page, '#lifeSourceExcerptSave');
      let bundle = (await snapshot(page)).bundle, record = bundle.records.find(r => r.note === note); assert(record); assert.equal(record.text, quote); assert.deepEqual(record.sourceRefs[0], { sourceId: f.source.id, sourceVersionId: f.version.id, locator: { start, end } });
      await openSource(page, f.source.id); await beginEdit(page); assert.equal(await page.locator('#lifeSourceEditText').inputValue(), raw.replace(/\r\n?/g, '\n'));
      await page.locator('#lifeSourceEditText').fill(edited); await page.locator('#lifeSourceEditTitle').fill(title + ' · 수정한 사본'); await page.locator('#lifeSourceEditText').evaluate(el => { window.__obsidianEditor = el; });
      await click(page, '#lifeSourceEditPreview'); await page.locator('#lifeSourceEditPreviewBody').waitFor(); await safeProjection(page, '#lifeSourceEditPreviewBody');
      assert.equal(await page.evaluate(() => __obsidianEditor === document.querySelector('#lifeSourceEditText') && __obsidianEditor.isConnected), true); assert.equal((await snapshot(page)).bundle.sourceVersions.length, 1, 'Preview must not save or rewrite the old version');
      await click(page, '#lifeSourceEditSave'); await page.locator('#lifeSourceInfoToggle').waitFor(); bundle = (await snapshot(page)).bundle; const latest = bundle.sourceVersions.filter(v => v.sourceId === f.source.id).at(-1);
      assert.equal(bundle.sourceVersions.length, 2); assert.equal(latest.contentText, edited); assert.equal(latest.contentHash, sha(edited)); assert.deepEqual(bundle.sourceVersions.find(v => v.id === f.version.id), f.version); assert.deepEqual(bundle.records.find(r => r.id === record.id), record);
      await page.reload(); await ready(page); await openSource(page, f.source.id); await safeProjection(page); assert.deepEqual((await snapshot(page)).interest, f.interest);
      const file = await backup(page); assert.equal(file.workspace.sourceVersions.find(v => v.id === f.version.id).contentText, raw); assert.equal(file.workspace.sourceVersions.find(v => v.id === latest.id).contentText, edited); assert.deepEqual(file.workspace.records.find(r => r.id === record.id).sourceRefs[0].locator, { start, end });
      await page.locator('#lifeRestoreFile').setInputFiles({ name: 'anonymous-properties-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) }); await settle(page); await byName(page, '새 사본으로 복원');
      const copied = (await snapshot(page)).bundle; assert.notEqual(copied.workspaceId, f.workspaceId); assert.equal(copied.sourceVersions.length, 2); const copiedRecord = copied.records.find(r => r.note === note), copiedOld = copied.sourceVersions.find(v => v.id === copiedRecord.sourceRefs[0].sourceVersionId);
      assert.notEqual(copiedOld.id, f.version.id); assert.equal(copiedOld.contentText, raw); assert.equal(copiedOld.contentText.slice(copiedRecord.sourceRefs[0].locator.start, copiedRecord.sourceRefs[0].locator.end), quote); assert(copied.sourceVersions.some(v => v.contentText === edited));
      const original = await page.evaluate(id => HaedoLife.Shell.storage.read(id), f.workspaceId); assert.deepEqual(original, bundle);
      report.observations.push({ rawBOMCRLF: true, rawSHA256: sha(raw), editedSHA256: sha(edited), exactRepeatedQuote: { start, end }, hiddenPropertyResumeMode: resumedMode, seededReadingPointIsSynthetic: true, versionsInBackup: 2, newCopyIdsAndQuoteRangePreserved: true, interestsAndOriginalMetadataNotInferred: true, originalWorkspaceUnchanged: true, osFileSaved: false });
    });

    await check('title-only and format-only changes preserve BOM CRLF while a body edit creates an LF version', async ({ page }) => {
      const f = await importMarkdown(page);
      await beginEdit(page); await page.locator('#lifeSourceEditTitle').fill(title + ' · 제목만 수정');
      await click(page, '#lifeSourceEditPreview'); await safeProjection(page, '#lifeSourceEditPreviewBody');
      assert.equal((await snapshot(page)).bundle.sourceVersions.length, 1);
      await click(page, '#lifeSourceEditSave'); await page.locator('#lifeSourceInfoToggle').waitFor();
      let versions = (await snapshot(page)).bundle.sourceVersions.filter(v => v.sourceId === f.source.id);
      assert.equal(versions.length, 2); assert.equal(versions[1].contentText, raw); assert.equal(versions[1].contentHash, sha(raw)); assert.deepEqual(versions[0], f.version);
      const titleOnly = structuredClone(versions[1]);
      await beginEdit(page); await page.locator('#lifeSourceEditFormat').selectOption('text/plain');
      await click(page, '#lifeSourceEditPreview'); assert.equal(await page.locator('#lifeSourceEditPreviewBody .life-source-text').textContent(), raw);
      assert.equal((await snapshot(page)).bundle.sourceVersions.length, 2);
      await click(page, '#lifeSourceEditSave'); await page.locator('#lifeSourceInfoToggle').waitFor();
      versions = (await snapshot(page)).bundle.sourceVersions.filter(v => v.sourceId === f.source.id);
      assert.equal(versions.length, 3); assert.equal(versions[2].format, 'text/plain'); assert.equal(versions[2].contentText, raw); assert.equal(versions[2].contentHash, sha(raw)); assert.deepEqual(versions[1], titleOnly);
      const formatOnly = structuredClone(versions[2]);
      await beginEdit(page); await page.locator('#lifeSourceEditFormat').selectOption('text/markdown'); await page.locator('#lifeSourceEditText').fill(edited);
      await click(page, '#lifeSourceEditPreview'); await safeProjection(page, '#lifeSourceEditPreviewBody'); assert.equal((await snapshot(page)).bundle.sourceVersions.length, 3);
      await click(page, '#lifeSourceEditSave'); await page.locator('#lifeSourceInfoToggle').waitFor();
      await page.reload(); await ready(page); await openSource(page, f.source.id); await safeProjection(page);
      versions = (await snapshot(page)).bundle.sourceVersions.filter(v => v.sourceId === f.source.id);
      assert.equal(versions.length, 4); assert.deepEqual(versions[0], f.version); assert.deepEqual(versions[1], titleOnly); assert.deepEqual(versions[2], formatOnly); assert.equal(versions[3].contentText, edited); assert.equal(versions[3].contentHash, sha(edited)); assert.equal(versions[3].format, 'text/markdown'); assert.equal(versions[3].contentText.includes('\r'), false);
      report.observations.push({ titleOnlyRawBOMCRLFPreserved: true, formatOnlyRawBOMCRLFPreserved: true, bodyInputCreatesLFVersion: true, immutableVersions: 4 });
    });

    await check('invalid YAML and ordinary Markdown controls remain visible without being treated as properties', async ({ page }) => {
      await records(page);
      const cases = [
        { name: 'invalid sequence', raw: invalid, frontmatterLike: true, needles: ['title: [닫히지 않은 익명 값', '---'] },
        { name: 'unsafe custom tag', raw: '---\ncallback: !!js/function >\n  function() { globalThis.__obsidianMarkupExecuted=true; }\n---\n\n# 익명 본문\n', frontmatterLike: true, needles: ['!!js/function', '---'] },
        { name: 'duplicate key', raw: '---\ntitle: 익명 첫 값\ntitle: 익명 둘째 값\n---\n\n본문\n', frontmatterLike: true, needles: ['title: 익명 첫 값', 'title: 익명 둘째 값'] },
        { name: 'bare fields', raw: 'title: 구분선 없는 익명 본문\ndate: 2026-01-02\ntags: [익명]\n\n일반 본문\n', needles: ['title:', '일반 본문'] },
        { name: 'two thematic breaks around prose', raw: '---\n일반적인 구분선 사이의 **강조된 문장**\n---\n\n다음 문단\n', ordinaryMarkdown: true, needles: ['일반적인 구분선 사이의', '강조된 문장', '다음 문단'] },
        ...[
          ['heading', '# 익명 제목', 'h1', '익명 제목'],
          ['bold', '**익명 굵게**', 'strong', '익명 굵게'],
          ['italic', '*익명 기울임*', 'em', '익명 기울임'],
          ['link', '[익명 링크](https://example.invalid/anonymous-prose)', 'a', '익명 링크'],
          ['inline code', '`익명 코드`', 'code', '익명 코드'],
          ['quote', '> 익명 인용', 'blockquote', '익명 인용'],
          ['list', '- 익명 목록', 'ul > li', '익명 목록']
        ].map(([name, line, selector, text]) => ({ name: 'two thematic breaks around ' + name, raw: '---\n' + line + '\n---\n\n다음 문단\n', ordinaryMarkdown: true, selector, needles: [text, '다음 문단'] })),
        { name: 'thematic break prose', raw: '---\n\n일반적인 구분선 뒤의 본문\n\n다음 문단\n', needles: ['일반적인 구분선 뒤의 본문', '다음 문단'] },
        { name: 'code example', raw: '```yaml\n---\ntitle: 코드 속 익명 속성\n---\n```\n', needles: ['title: 코드 속 익명 속성', '---'] },
        { name: 'not at document start', raw: '먼저 적은 일반 문장\n\n---\ntitle: 본문 속 익명 문장\n---\n', needles: ['먼저 적은 일반 문장', 'title: 본문 속 익명 문장'] }
      ];
      const results = await page.evaluate(cases => cases.map(fixture => {
        const rendered = HaedoLife.SourceMarkdown.render(document, fixture.raw), element = rendered.element;
        return { name: fixture.name, formatted: rendered.formatted, reason: rendered.reason, properties: element.querySelectorAll('details.source-properties').length, rules: element.querySelectorAll('hr').length, strong: element.querySelectorAll('strong').length, expectedMarkup: fixture.selector ? element.querySelectorAll(fixture.selector).length : null, text: element.textContent, rawHeader: element.querySelector('pre.source-properties-raw')?.textContent || null, rawFallbackExact: !rendered.formatted && element.textContent === fixture.raw, adapterRawExact: rendered.formatted ? rendered.adapter.raw === fixture.raw : null, unsafe: element.querySelectorAll('script,img,iframe,svg,math,style,input,form').length, executed: globalThis.__obsidianMarkupExecuted === true };
      }), cases);
      for (let n = 0; n < cases.length; n++) { const f = cases[n], value = results[n]; assert.equal(value.properties, 0, f.name); assert.equal(value.unsafe, 0, f.name); assert.equal(value.executed, false, f.name); assert.ok(value.formatted ? value.adapterRawExact : value.rawFallbackExact, f.name + ' keeps the exact raw source'); for (const text of f.needles) assert.ok(value.text.includes(text), f.name + ': ' + text); if (f.frontmatterLike) { const closing = f.raw.indexOf('---', f.raw.indexOf('\n') + 1), afterFence = closing + 3, headerEnd = f.raw[afterFence] === '\r' ? afterFence + 2 : afterFence + 1; assert.ok(value.rawFallbackExact || value.rawHeader === f.raw.slice(0, headerEnd), f.name + ' must retain the exact invalid header'); } if (f.ordinaryMarkdown) { assert.equal(value.formatted, true); assert.equal(value.rawHeader, null, 'Thematic-break prose must remain ordinary Markdown'); assert.ok(value.rules > 0, f.name + ' retains its thematic break'); if (f.selector) assert.ok(value.expectedMarkup > 0, f.name + ' retains its ' + f.selector + ' styling'); else assert.ok(value.strong > 0, 'Ordinary thematic-break prose retains its Markdown styling'); } }
      report.observations.push({ rendererNegativeControls: results });
    });

    await check('property strings stay inert while native disclosure retains focus and fits three viewport widths', async ({ page }) => {
      const f = await importMarkdown(page), before = (await snapshot(page)).bundle; await safeProjection(page);
      const panel = page.locator('#lifeSourceText details.source-properties'), summary = panel.locator(':scope > summary');
      await summary.focus(); await summary.press('Space'); assert.equal(await panel.evaluate(el => el.open), true); await summary.press('Space'); assert.equal(await panel.evaluate(el => el.open), false); await summary.press('Enter'); assert.equal(await panel.evaluate(el => el.open), true);
      for (const width of [1440, 820, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); }); await page.keyboard.press('Tab'); await summary.focus();
        const audit = await summary.evaluate(el => { const r = el.getBoundingClientRect(), style = getComputedStyle(el), panel = el.parentElement, center = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, width: r.width, height: r.height, focus: document.activeElement === el, outline: style.outlineStyle, nativeDetailsOpen: panel.open, pointerClear: center === el || el.contains(center), fieldWidths: [...panel.querySelectorAll('dt,dd')].map(n => { const b = n.getBoundingClientRect(); return { tag: n.tagName, left: b.left, right: b.right, width: b.width, scrollWidth: n.scrollWidth, clientWidth: n.clientWidth }; }) }; });
        const original = reuse?.previous.visual.find(v => v.width === width), file = original ? path.join(reuse.directory, original.file) : 'properties-' + width + '.png';
        if (reuse) { assert.ok(original, 'Reused capture exists for this width'); assert.deepEqual(audit, original.audit, 'Current geometry must match the original positive capture'); }
        else await page.screenshot({ path: path.join(output, file), fullPage: true });
        report.visual.push({ width, file, audit, capture: reuse ? 'reused previous capture, not a new screenshot' : 'new screenshot', ...(reuse ? { captureSHA256: reuse.captureHashes[file] } : {}) });
        assert.ok(audit.documentWidth <= width, 'Property values must not cause document overflow'); assert.ok(audit.width >= 44 && audit.height >= 44); assert.equal(audit.focus, true); assert.notEqual(audit.outline, 'none'); assert.equal(audit.nativeDetailsOpen, true); assert.equal(audit.pointerClear, true); assert.ok(audit.fieldWidths.every(n => n.right <= width + 0.5 && n.left >= 0 && n.scrollWidth <= n.clientWidth + 1), 'Long property keys/values wrap within their columns');
        const invalidGeometry = await page.evaluate(content => { const projected = HaedoLife.SourceMarkdown.render(document, content), holder = document.createElement('section'); holder.append(projected.element); document.querySelector('#lifeMain').append(holder); try { const header = projected.element.querySelector('pre.source-properties-raw'), rect = header?.getBoundingClientRect(); return { rawHeaderPresent: !!header, documentWidth: document.documentElement.scrollWidth, viewport: innerWidth, rawHeaderRight: rect?.right, rawHeaderLeft: rect?.left, rawHeaderScrollWidth: header?.scrollWidth, rawHeaderClientWidth: header?.clientWidth }; } finally { holder.remove(); } }, invalid.replace('닫히지 않은 익명 값', '아주긴익명값'.repeat(80)));
        report.visual.at(-1).invalidHeaderGeometry = invalidGeometry; if (reuse) assert.deepEqual(invalidGeometry, original.invalidHeaderGeometry, 'Invalid header geometry also remains unchanged'); assert.equal(invalidGeometry.rawHeaderPresent, true); assert.ok(invalidGeometry.documentWidth <= width && invalidGeometry.rawHeaderRight <= width + 0.5 && invalidGeometry.rawHeaderScrollWidth <= invalidGeometry.rawHeaderClientWidth + 1, 'Invalid header literal wraps within the document');
      }
      const after = (await snapshot(page)).bundle; assert.deepEqual(after, before); assert.deepEqual(after.sourceVersions.find(v => v.id === f.version.id), f.version); assert.equal(await page.evaluate(() => globalThis.__obsidianMarkupExecuted === true), false);
    });
  } finally { await browser.close(); report.browserClosed = true; if (reuse) { report.reusedCaptureHashesAfter = Object.fromEntries(await Promise.all(Object.keys(reuse.captureHashes).map(async file => [file, sha(await fs.readFile(file))]))); report.reusedCapturesUnchangedDuringRun = JSON.stringify(report.reusedCaptureHashesAfter) === JSON.stringify(report.reusedCaptureHashesBefore); } report.sourceHashesAfter = await hashes(); report.productsUnchangedDuringRun = JSON.stringify(report.sourceHashesBefore) === JSON.stringify(report.sourceHashesAfter); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  for (const field of ['consoleErrors', 'pageErrors', 'externalRequests', 'privacyViolations', 'remoteWrites']) assert.deepEqual(report[field], [], field); assert.equal(report.productsUnchangedDuringRun, true); if (reuse) assert.equal(report.reusedCapturesUnchangedDuringRun, true, 'Original capture evidence remains unchanged'); assert.ok(report.checks.length && report.checks.every(c => c.pass)); assert.equal(report.closedContexts, report.checks.length);
  console.log('Obsidian Markdown: ' + report.checks.length + ' passed; no unsafe execution, external requests or remote writes.');
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
