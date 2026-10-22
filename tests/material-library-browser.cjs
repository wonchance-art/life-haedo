/* Materials: actual import/reader/editor/trash/backup UI, bundled SDK and IDB.
 * Anonymous intercepted Auth only. No production account, DB or publisher access.
 * BASE_URL=http://127.0.0.1:4173 node tests/material-library-browser.cjs */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FakeCloud, accounts, cloud, base, openManagement } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe, nav } = require('./unified-home-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve(process.env.MATERIAL_LIBRARY_OUT || '.local/material-library');
const title = '익명 언어 연구 자료의 마크다운 읽기';
const quote = '반복해서 읽는 정확한 문장🌱';
const note = '두 번째 반복 문장을 다시 찾는 비공개 메모';
const raw = '\uFEFF# 언어 연구와 학습의 기록\r\n\r\n한글 **강조**와 *기울임*, ~~취소선~~, [연구 출처](https://example.org/research)입니다.\r\n\r\n' + quote + '\r\n\r\n' + quote + '\r\n\r\n> 인용한 문단 &amp; 보관한 질문\r\n\r\n- 첫 관찰\r\n- 둘째 관찰\r\n\r\n| 표현 | 기록 |\r\n| --- | --- |\r\n| 한글 | emoji🌿 |\r\n\r\n```js\r\nconst safe = "<img src=x onerror=alert(1)>";\r\n```\r\n\r\n![자동으로 요청하면 안 되는 이미지](https://images.example.invalid/never.png)\r\n\r\n<script>globalThis.__materialMarkupExecuted = true</script>\r\n<img src="https://images.example.invalid/html.png" onerror="globalThis.__materialMarkupExecuted=true">\r\n\r\n[위험한 주소](javascript:alert(1))\r\n';
const edited = raw.replace(/\r\n?/g, '\n') + '\n## 수정한 관찰\n내 사본에 직접 추가한 질문과 답입니다.\n';
const sha = value => createHash('sha256').update(value).digest('hex');
const click = async (page, selector) => { await page.locator(selector).click(); await settle(page); };
const byName = async (page, name) => { await page.getByRole('button', { name, exact: true }).click(); await settle(page); };
const snapshot = page => page.evaluate(async () => {
  const s = HaedoLife.Shell.storage, id = await s.getActive();
  return { bundle: await s.read(id), stages: await s.listStages(id) };
});
async function records(page) {
  await page.goto(base + '/index.html?section=records'); await ready(page); await settle(page);
  await page.locator('#lifeSearch').waitFor();
}
async function reveal(control) {
  // Expand existing native disclosures by their actual summary, without
  // removing hidden attributes or changing product visibility in the fixture.
  const ancestors = await control.locator('xpath=ancestor::details').count();
  for (let index = 0; index < ancestors; index++) {
    const parent = control.locator('xpath=ancestor::details').nth(index);
    if (!await parent.evaluate(el => el.open)) await parent.locator(':scope > summary').click();
  }
}
async function importMarkdown(page) {
  await records(page); await byName(page, '가져오기');
  await byName(page, '텍스트 파일');
  await page.locator('#lifeImportFile').setInputFiles({ name: 'anonymous-language.md', mimeType: 'text/markdown', buffer: Buffer.from(raw) });
  await settle(page);
  const fields = { Origin: 'obsidian', Title: title, Author: '익명 원작성자', Relation: 'other', Coverage: 'partial', Omissions: '원본 사진과 댓글은 포함하지 않음' };
  for (const [name, value] of Object.entries(fields)) {
    const field = page.locator('#lifeImport' + name); await reveal(field);
    if (['Origin', 'Relation', 'Coverage'].includes(name)) await field.selectOption(value); else await field.fill(value);
  }
  await byName(page, '원문·출처 확인'); await byName(page, '자료만 보관');
  await page.locator('#lifeSourceInfoToggle').waitFor();
  const { bundle } = await snapshot(page), source = bundle.sources.find(s => s.title === title);
  assert(source, 'The selected import was not stored');
  const version = bundle.sourceVersions.find(v => v.sourceId === source.id);
  assert.equal(version.format, 'text/markdown'); assert.equal(version.contentText, raw);
  assert.equal(version.contentHash, sha(raw));
  return { source, version, workspaceId: bundle.workspaceId };
}
async function options(page) {
  const toggle = page.locator('#lifeSourceInfoToggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.locator('#lifeSourceDetails').waitFor({ state: 'visible' });
}
async function openSource(page, sourceId) {
  await records(page); const { bundle } = await snapshot(page);
  const versions = bundle.sourceVersions.filter(v => v.sourceId === sourceId), latest = versions.at(-1);
  await click(page, `.life-source-open[data-version-id="${latest.id}"]`);
  await page.locator('#lifeSourceInfoToggle').waitFor();
}
async function beginEdit(page) {
  await options(page); await click(page, '#lifeSourceEdit'); await page.locator('#lifeSourceEditText').waitFor();
}
async function trash(page, confirm = true) {
  await options(page); await click(page, '#lifeSourceTrash');
  await click(page, confirm ? '#lifeSourceTrashConfirm' : '#lifeSourceTrashCancel');
}
async function openTrash(page) {
  await openManagement(page); await click(page, '#lifeSourceTrashOpen');
  await page.locator('#lifeSourceTrashList').waitFor();
}
async function backup(page) {
  await openManagement(page); await byName(page, '내보내기·사본 복원');
  const pending = page.waitForEvent('download'); await byName(page, 'JSON 백업');
  return JSON.parse(await fs.readFile(await (await pending).path(), 'utf8'));
}
async function safeMarkdown(page, host = '#lifeSourceText') {
  const value = await page.locator(host).evaluate(el => ({
    headings: el.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
    strong: el.querySelectorAll('strong').length, table: el.querySelectorAll('table').length,
    code: el.querySelectorAll('pre code').length,
    dangerousNodes: el.querySelectorAll('script,img,iframe,video,audio,object,embed,svg,math,style').length,
    dangerousAttributes: [...el.querySelectorAll('*')].flatMap(n => [...n.attributes].filter(a => /^on/i.test(a.name) || ['src', 'srcset'].includes(a.name)).map(a => a.name)),
    unsafeLinks: [...el.querySelectorAll('a[href]')].map(n => n.getAttribute('href')).filter(href => !/^(https?:|#)/i.test(href)),
    executed: globalThis.__materialMarkupExecuted === true
  }));
  assert(value.headings && value.strong && value.table && value.code, 'Markdown syntax was not displayed as formatting');
  assert.equal(value.dangerousNodes, 0); assert.deepEqual(value.dangerousAttributes, []); assert.deepEqual(value.unsafeLinks, []); assert.equal(value.executed, false);
  return value;
}
async function formattedResume(page, sourceId, versionId) {
  const point = await page.locator('#lifeSourceText').evaluate(el => {
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: Math.max(100, Math.min(innerHeight - 130, r.top + 140)), before: scrollY };
  });
  await page.mouse.move(point.x, point.y); await page.mouse.wheel(0, 650);
  await page.waitForFunction(before => scrollY !== before, point.before);
  // Keep the asynchronous IDB predicate outside waitForFunction: a Promise
  // returned to a DOM polling predicate can itself be treated as truthy.
  let saved;
  for (let attempt = 0; attempt < 80; attempt++) {
    saved = await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.readReadingPosition(await s.getActive()); });
    if (saved.status === 'available' && saved.position?.offset > 0) break;
    await page.waitForTimeout(100);
  }
  assert(saved?.position?.offset > 0, 'Durable formatted reading position did not arrive: ' + JSON.stringify(saved));
  assert.equal(saved.position.sourceId, sourceId); assert.equal(saved.position.sourceVersionId, versionId);
  const starts = [0]; for (const match of raw.matchAll(/\r\n|\r|\n/g)) starts.push(match.index + match[0].length);
  assert(starts.includes(saved.position.offset), 'Formatted resume must use an exact raw line start, not a rendered text offset');
  const displayed = await page.locator('#lifeSourceText [data-source-block]').evaluateAll(nodes => {
    const n = nodes.find(n => { const r = n.getBoundingClientRect(); return r.bottom > innerHeight / 3 && r.top < innerHeight; });
    return n?.getAttribute('data-source-block');
  });
  assert.notEqual(displayed, undefined);
  await records(page); await click(page, '#lifeReadingResumeOpen');
  await page.waitForFunction(() => document.querySelector('#lifeSourceText')?.dataset.readingMode === 'formatted');
  const visible = await page.locator(`#lifeSourceText [data-source-block="${displayed}"]`).evaluate(n => { const r = n.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight - 80; });
  assert.equal(visible, true, 'The same formatted reading block was not visible after explicit resume');
  const after = await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.readReadingPosition(await s.getActive()); });
  assert.deepEqual(after, saved, 'Programmatic resume must not claim a new reading action');
  return saved.position;
}
async function captureThree(page, report, scene) {
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.evaluate(async () => { await document.fonts.ready; document.activeElement?.blur(); scrollTo(0, 0); });
    const metrics = await page.evaluate(inspect);
    // Inline content links have WCAG's inline-text target exception. Preserve
    // their measurements while enforcing 44px on menu/editor/disclosure controls.
    const inline = await page.locator('#lifeSourceText a, #lifeSourceEditPreviewBody a').evaluateAll(nodes => nodes.map(n => ({ tag: 'a', id: n.id, text: (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 80) })));
    const inlineTargets = metrics.smallTargets.filter(item => inline.some(n => n.tag === item.tag && n.id === item.id && n.text === item.text));
    const actionTargets = metrics.smallTargets.filter(item => !inlineTargets.includes(item));
    assert.equal(metrics.horizontalOverflow, false, scene + ': page overflow'); assert.deepEqual(actionTargets, [], scene + ': action target');
    for (const key of ['smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ': ' + key);
    const filename = `${scene}-${width}.png`; await page.screenshot({ path: path.join(out, filename), fullPage: true });
    report.visual.push({ scene, width, screenshot: filename, inlineTextTargetExceptions: inlineTargets, ...metrics });
  }
  await page.setViewportSize({ width: 820, height: 1000 });
}
async function fault(page, enabled) {
  await page.evaluate(enabled => {
    if (enabled) {
      if (window.__materialPutOriginal) throw Error('Fault hook already installed');
      window.__materialPutOriginal = IDBObjectStore.prototype.put; window.__materialFaultAborts = 0;
      IDBObjectStore.prototype.put = function (value, ...args) {
        const request = __materialPutOriginal.call(this, value, ...args);
        if (this.name === 'bundles' && value?.sourceVersions?.length > 1) { __materialFaultAborts++; this.transaction.abort(); }
        return request;
      };
    } else if (window.__materialPutOriginal) {
      IDBObjectStore.prototype.put = __materialPutOriginal; delete window.__materialPutOriginal;
    }
  }, enabled);
}
async function errorVisible(page) {
  await page.locator('#lifeError:not([hidden]), #lifeSourceEditError:not([hidden])').first().waitFor();
  await page.locator('#lifeSourceEditSave:enabled').waitFor();
}
function annotation(error) {
  if (process.env.GITHUB_ACTIONS) console.error('::error title=Material library::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
}
async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only the isolated loopback app may be tested');
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), checks: [], visual: [], observations: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0,
    scope: 'Actual materials import/read/edit/trash/backup UI, bundled SDK and account-scoped IDB; explicit anonymous FakeCloud Auth only. No real account/DB/provider or Apple-device/usefulness claims. Fault injection is isolated to one failure case and removed before retry.' };
  async function check(name, run) {
    if (process.env.MATERIAL_LIBRARY_MATCH && !new RegExp(process.env.MATERIAL_LIBRARY_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'materials-' + report.checks.length, accounts.a, { viewport: { width: 820, height: 1000 }, hasTouch: true, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
      report.external.push(url.origin + url.pathname); return route.abort('blockedbyclient');
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000); observe(page, report, name);
    try {
      await run({ page, context, server }); assert.equal(server.writes().length, 0);
      assert.equal(await page.evaluate(() => !!window.__materialPutOriginal), false, 'Fault hook leaked beyond the isolated failure operation');
      report.checks.push({ name, pass: true, realRemoteWrites: 0 }); console.log('PASS ' + name);
    } catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); annotation(error); console.error('FAIL ' + name + '\n' + error.stack);
      await page.screenshot({ path: path.join(out, `failure-${report.checks.length}.png`), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
  }
  try {
    await check('Markdown import, exact original quote, edit, trash/restore and independent JSON copy form one preserved journey', async ({ page }) => {
      const f = await importMarkdown(page);
      assert.equal(await page.locator('#lifeSourceText').getAttribute('data-reading-mode'), 'formatted');
      const formatted = await safeMarkdown(page); await captureThree(page, report, 'formatted');
      const readingPoint = await formattedResume(page, f.source.id, f.version.id);
      await click(page, '#lifeExcerptToggle'); await page.waitForFunction(() => document.querySelector('#lifeSourceText')?.dataset.readingMode === 'raw');
      const start = raw.lastIndexOf(quote), end = start + quote.length;
      await page.locator('#lifeSourceText').evaluate((el, range) => {
        if (el.firstChild?.nodeType !== Node.TEXT_NODE) throw Error('Exact source is not a raw Text node');
        el.focus(); const selection = getSelection(), r = document.createRange(); r.setStart(el.firstChild, range.start); r.setEnd(el.firstChild, range.end);
        selection.removeAllRanges(); selection.addRange(r); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      }, { start, end });
      await page.locator('#lifeSourceTopic').fill('언어 학습'); await page.locator('#lifeSourceNote').fill(note); await click(page, '#lifeSourceExcerptSave');
      let b = (await snapshot(page)).bundle; const record = b.records.find(r => r.note === note); assert(record);
      assert.equal(record.text, quote); assert.deepEqual(record.sourceRefs[0], { sourceId: f.source.id, sourceVersionId: f.version.id, locator: { start, end } });
      if (await page.locator('#lifeSearchReturn').count()) await click(page, '#lifeSearchReturn');
      else await byName(page, '자료실로 돌아가기');
      await page.locator('#lifeSearch').fill(note);
      const hit = page.locator('.life-excerpt-open').first(), focusKey = await hit.getAttribute('data-focus-key'); await hit.click(); await settle(page);
      await page.waitForFunction(text => getSelection().toString() === text, quote); assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
      assert.equal(await page.evaluate(() => getSelection().getRangeAt(0).startOffset), start);
      await click(page, '#lifeSearchReturn'); assert.equal(await page.locator('#lifeSearch').inputValue(), note);
      await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, focusKey);
      await openSource(page, f.source.id); await beginEdit(page);
      assert.equal(await page.locator('#lifeSourceEditText').inputValue(), raw.replace(/\r\n?/g, '\n'));
      await page.locator('#lifeSourceEditTitle').fill(title + ' · 수정한 사본'); await page.locator('#lifeSourceEditText').fill(edited);
      await page.locator('#lifeSourceEditText').evaluate(el => { window.__materialEditorNode = el; });
      await click(page, '#lifeSourceEditPreview'); await page.locator('#lifeSourceEditPreviewBody').waitFor(); await safeMarkdown(page, '#lifeSourceEditPreviewBody');
      assert.equal(await page.evaluate(() => __materialEditorNode.isConnected && __materialEditorNode === document.querySelector('#lifeSourceEditText')), true);
      assert.equal((await snapshot(page)).bundle.sourceVersions.length, 1, 'Preview wrote a source version');
      await captureThree(page, report, 'edit-preview'); await click(page, '#lifeSourceEditSave'); await page.locator('#lifeSourceInfoToggle').waitFor();
      b = (await snapshot(page)).bundle; const latest = b.sourceVersions.filter(v => v.sourceId === f.source.id).at(-1);
      assert.equal(b.sources.length, 1); assert.equal(b.sourceVersions.length, 2); assert.equal(latest.contentText, edited); assert.equal(latest.originalAuthor.relation, 'other');
      assert.deepEqual(b.sourceVersions.find(v => v.id === f.version.id), f.version); assert.deepEqual(b.records.find(r => r.id === record.id), record);
      assert.match(await page.locator('.life-reader').innerText(), /수정한 사본/);
      // Inspect the persisted domain result directly; no renderer-derived or
      // synthetic ID is substituted for the actual UI operation's new version.
      assert.equal(await page.evaluate(async id => { const s = HaedoLife.Shell.storage; return HaedoLife.Core.isEditedCopy(await s.read(await s.getActive()), id); }, latest.id), true);
      await records(page); await page.locator('#lifeSearch').fill(note); await page.locator('.life-excerpt-open').first().click(); await settle(page);
      await page.waitForFunction(text => getSelection().toString() === text, quote);
      assert.equal(await page.locator('#lifeSourceText').textContent(), raw); assert.equal(await page.locator('#lifeVersion').inputValue(), f.version.id);
      await page.reload(); await ready(page); await openSource(page, f.source.id); await safeMarkdown(page);
      await trash(page, false); assert.equal(await page.evaluate(async id => { const s = HaedoLife.Shell.storage; return HaedoLife.Core.sourceState(await s.read(await s.getActive()), id).status; }, f.source.id), 'active');
      await trash(page); await page.locator('#lifeSearch').waitFor();
      assert.equal(await page.locator('.life-source-open').count(), 0); assert.equal(await page.locator('.life-excerpt-open').count(), 0);
      await page.locator('#lifeSearch').fill(note); assert.equal(await page.locator('.life-excerpt-open').count(), 0);
      await nav(page, 'home'); await click(page, '#lifeFindOpen'); await page.locator('#lifeFind[aria-busy="false"]').waitFor();
      await page.locator('#lifeFindQuery').fill('수정한 관찰'); assert.equal(await page.locator('#lifeFindResults [data-kind="source"]').count(), 0);
      const trashed = (await snapshot(page)).bundle; assert.deepEqual(trashed.sourceVersions, b.sourceVersions); assert.deepEqual(trashed.records, b.records);
      const file = await backup(page); assert(file.workspace.links.some(link => link.kind === 'source_trash')); assert(file.workspace.links.some(link => link.kind === 'source_edited_copy'));
      await openTrash(page); await captureThree(page, report, 'trash'); await click(page, `[data-source-restore="${f.source.id}"]`);
      const restored = (await snapshot(page)).bundle;
      assert.equal(await page.evaluate(async id => { const s = HaedoLife.Shell.storage; return HaedoLife.Core.sourceState(await s.read(await s.getActive()), id).status; }, f.source.id), 'active');
      assert.deepEqual(restored.sourceVersions, trashed.sourceVersions); assert.deepEqual(restored.records, trashed.records);
      await openManagement(page); await byName(page, '내보내기·사본 복원');
      await page.locator('#lifeRestoreFile').setInputFiles({ name: 'anonymous-materials-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
      await settle(page); await byName(page, '새 사본으로 복원');
      const copied = (await snapshot(page)).bundle; assert.notEqual(copied.workspaceId, f.workspaceId); assert.equal(copied.sources.length, 1); assert.equal(copied.sourceVersions.length, 2);
      assert(copied.sources.every(s => s.id !== f.source.id)); assert(copied.sourceVersions.every(v => !b.sourceVersions.some(old => old.id === v.id)));
      const copySource = copied.sources[0], copyRecord = copied.records[0], copyOld = copied.sourceVersions.find(v => v.id === copyRecord.sourceRefs[0].sourceVersionId);
      assert.equal(copyOld.contentText, raw); assert.equal(copyOld.contentText.slice(copyRecord.sourceRefs[0].locator.start, copyRecord.sourceRefs[0].locator.end), quote);
      assert(copied.links.some(link => link.kind === 'source_trash' && link.entityRefs[0].entityId === copySource.id));
      const copyLatest = copied.sourceVersions.at(-1); assert(copied.links.some(link => link.kind === 'source_edited_copy' && link.entityRefs[0].entityId === copyLatest.id));
      const original = await page.evaluate(id => HaedoLife.Shell.storage.read(id), f.workspaceId); assert.deepEqual(original, restored);
      await openTrash(page); await click(page, `[data-source-restore="${copySource.id}"]`); await openSource(page, copySource.id); await safeMarkdown(page);
      assert.match(await page.locator('.life-reader').innerText(), /수정한 사본/);
      report.observations.push({ formatted, rawSHA256: sha(raw), preservedBOMCRLF: true, formattedResumeRawLineStart: readingPoint, repeatedQuoteOffset: { start, end }, versions: 2, rawOldVersionPreserved: true,
        excerptSearchReturnPreserved: true, previewDidNotSaveOrReplaceInput: true, importedAuthorRetained: true, trashHiddenFromLibraryExcerptAndUnifiedSearch: true,
        sameIdRestore: true, JSONFreshIdsExactQuoteAndMarkers: true, previousWorkspaceUnchanged: true, successFlowFaultHooks: 0 });
    });
    await check('An actual IDB commit abort preserves the source-edit input and old graph until explicit retry', async ({ page }) => {
      const f = await importMarkdown(page); await beginEdit(page); await page.locator('#lifeSourceEditText').fill(edited);
      const before = (await snapshot(page)).bundle; await fault(page, true);
      try {
        await click(page, '#lifeSourceEditSave'); await errorVisible(page); assert(await page.evaluate(() => __materialFaultAborts > 0));
        assert.equal(await page.locator('#lifeSourceEditText').inputValue(), edited); assert.deepEqual((await snapshot(page)).bundle, before);
      } finally { await fault(page, false); }
      await click(page, '#lifeSourceEditSave'); await page.locator('#lifeSourceInfoToggle').waitFor(); const after = (await snapshot(page)).bundle;
      assert.equal(after.sourceVersions.length, 2); assert.deepEqual(after.sourceVersions.find(v => v.id === f.version.id), f.version);
      report.observations.push({ actualIDBAbort: true, faultHookRemovedBeforeRetry: true, inputRetained: true, oldGraphAtomic: true });
    });
    await check('Two actual tabs reject a late source edit after trash and explicit restoration without losing its draft', async ({ page, context }) => {
      const f = await importMarkdown(page); await beginEdit(page); await page.locator('#lifeSourceEditText').fill(edited);
      const other = await context.newPage(); other.setDefaultTimeout(15000); observe(other, report, 'two-tab companion');
      await openSource(other, f.source.id); await trash(other);
      assert.equal(await page.evaluate(async id => { const s = HaedoLife.Shell.storage; return HaedoLife.Core.sourceState(await s.read(await s.getActive()), id).status; }, f.source.id), 'trash');
      assert.equal(await page.locator('#lifeSourceEditText').inputValue(), edited); await click(page, '#lifeSourceEditSave'); await errorVisible(page);
      assert.equal((await snapshot(page)).bundle.sourceVersions.length, 1); assert.equal(await page.locator('#lifeSourceEditText').inputValue(), edited);
      await openTrash(other); await click(other, `[data-source-restore="${f.source.id}"]`);
      await click(page, '#lifeSourceEditSave'); await errorVisible(page); const final = await snapshot(page);
      assert.equal(final.bundle.sourceVersions.length, 1); assert.deepEqual(final.bundle.sourceVersions[0], f.version); assert.equal(await page.locator('#lifeSourceEditText').inputValue(), edited);
      await other.close(); report.observations.push({ tabs: 2, staleEditCouldNotRestoreTrash: true, restoredLifecycleStillRequiresFreshEditBase: true, draftInputPreserved: true, faultHooks: 0 });
    });
  } finally {
    await browser.close(); report.browserClosed = true;
    report.pass = report.checks.length > 0 && report.checks.every(c => c.pass) && report.consoleErrors.length === 0 && report.pageErrors.length === 0 && report.external.length === 0;
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  assert.equal(report.pass, true, 'Materials full journey failed; see ' + path.join(out, 'report.json'));
  console.log('Material library: ' + report.checks.length + ' passed; no real remote writes or external requests.');
}
if (require.main === module) main().catch(error => { annotation(error); console.error(error.stack || error); process.exitCode = 1; });
module.exports = { main };
