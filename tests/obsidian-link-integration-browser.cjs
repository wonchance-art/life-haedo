/* Actual SDK/IDB/UI with synthetic notes and account; no real vault or provider. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), { createHash } = require('node:crypto');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { accounts, base, session } = require('./life-sync-browser.cjs');
const { CaptureCloud } = require('./life-naver-capture-browser.cjs');
const { existingNaver } = require('./naver-blog-browser.cjs');
const hash = text => createHash('sha256').update(text).digest('hex');
const files = ['assets/life/ui.js', 'assets/life/obsidian-link-candidates.js', 'assets/life/obsidian-link-candidates-ui.js', 'assets/life/obsidian-link-commit.js', 'assets/life/core.js', 'assets/life/storage.js', 'assets/life/source-markdown.js', 'assets/life/naver-blog-ui.js', 'assets/platform-auth.js', 'index.html', 'life.html', 'sw.js'];
async function hashes() { const result = {}; for (const file of files) { const disk = await fs.readFile(file), response = await fetch(base + '/' + file); if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== hash(disk)) throw Error('Served bytes do not match ' + file); result[file] = hash(disk); } return result; }
const output = '.local/obsidian-link-integration';
async function main() {
  const report = { pass: false, checks: [], screenshots: [], errors: [], consoleErrors: [], externalRequests: [], scope: 'Synthetic SDK/Auth/HTTP; actual UI, IDB, exact text, Core backup and local account boundary. No real vault, Naver, Apple device or production data.' };
  report.sourceHashes = await hashes(); report.testHash = hash(await fs.readFile(__filename));
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const server = new CaptureCloud(), context = await makeContext(browser, server, 'obsidian-links', accounts.a);
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
  page.on('request', request => { if (/^https:\/\/(?:[^/]+\.)?(?:naver\.com|pstatic\.net)\//i.test(request.url())) report.externalRequests.push(new URL(request.url()).hostname); });
  const entry = async () => { await page.goto(base + '/index.html?section=records&view=sources', { waitUntil: 'domcontentloaded' }); await ready(page); await settle(page); await page.locator('#lifeSearch').waitFor(); };
  const open = async (term, version) => { await page.locator('#lifeSearch').fill(term); await page.locator(`.life-source-open[data-version-id="${version}"]`).click(); await page.locator('#lifeSourceText').waitFor(); };
  const openOccurrence = async (start, expected) => {
    const row = page.locator('#lifeObsidianCandidates article[data-start="' + start + '"]');
    const disclosure = row.locator(':scope > details.life-obsidian-occurrence');
    await disclosure.waitFor(); assert.equal(await disclosure.evaluate(node => node.open), false);
    await disclosure.locator(':scope > summary').click(); assert.equal(await disclosure.evaluate(node => node.open), true);
    await disclosure.getByText(expected, { exact: true }).waitFor();
    return row;
  };
  const openCandidate = async candidate => {
    const disclosure = candidate.locator(':scope > details.life-obsidian-candidate-choice');
    await disclosure.waitFor(); assert.equal(await disclosure.evaluate(node => node.open), false);
    await disclosure.locator(':scope > summary').click(); assert.equal(await disclosure.evaluate(node => node.open), true);
  };
  try {
    await entry();
    const seed = await page.evaluate(async () => {
      const C = HaedoLife.Core, s = HaedoLife.Shell.storage, ws = await s.getActive(); let b = await s.read(ws);
      async function add(input, excerpts = []) { const p = await C.prepareImport(input, b); const result = await s.commitLocal({ workspaceId: ws, baseRevision: b.revision, operationId: C.id(), changes: C.buildImportChanges(b, p, excerpts) }); if (result.status !== 'stored') throw Error('seed commit failed'); b = await s.read(ws); return p; }
      const text = '\uFEFF🌱 옛 문장\r\n# 자기제목\r\n[[대상#목표|보기]]\r\n[[#자기제목]]\r\n[[대상#목표|지연검사]]\r\n![[사진.png]]\r\n' + '익명 본문 보존.\r\n'.repeat(140), quote = '🌱 옛 문장';
      const start = text.indexOf(quote), source = await add({ origin: 'obsidian', fileName: '일기/출발.md', title: '테스트 출발 원문', text }, [{ start, end: start + quote.length, topic: '기존 인용', note: '보존' }]);
      const targetText = '# 목표\r\n첫 번째 문맥\r\n# 목표\r\n두 번째 🌿 문맥\r\n';
      const target = await add({ origin: 'obsidian', fileName: '일기/대상.md', title: '첫 번째 보관함 대상', text: targetText });
      const other = await add({ origin: 'obsidian', fileName: '일기/대상.md', title: '다른 보관함 대상', text: '# 목표\n다른 노트', forceSeparate: true });
      return { workspaceId: ws, source: source.source, sourceVersion: source.version, target: target.source, targetVersion: target.version, other: other.source, token: '[[대상#목표|보기]]', before: b };
    });
    await entry(); await open('테스트 출발 원문', seed.sourceVersion.id);
    const before = await page.evaluate(ws => HaedoLife.Shell.storage.read(ws), seed.workspaceId);
    const panel = page.locator('#lifeObsidianCandidates'); await panel.locator('summary').click();
    const occurrence = await openOccurrence(seed.sourceVersion.contentText.indexOf(seed.token), '대상 후보 여러 개 · 직접 선택');
    const panelError = panel.locator('.life-error[role=alert]'); assert.equal(await panelError.isHidden(), true); assert.equal(await panelError.textContent(), '');
    assert.match(await occurrence.innerText(), /대상 후보 여러 개/);
    const target = occurrence.locator('section.life-backup-source[data-version-id="' + seed.targetVersion.id + '"]');
    await openCandidate(target);
    await target.getByRole('button', { name: '이 위치를 연결', exact: true }).nth(1).waitFor();
    assert.equal(await target.getByRole('button', { name: '이 위치를 연결', exact: true }).count(), 2);
    assert.match(await target.innerText(), /두 번째 🌿 문맥/);
    const attachment = await openOccurrence(seed.sourceVersion.contentText.indexOf('![[사진.png]]'), '첨부 목록을 아직 확인하지 않았습니다');
    assert.match(await attachment.innerText(), /첨부 목록을 아직 확인하지 않았습니다/);
    await target.getByRole('button', { name: '이 위치를 연결', exact: true }).nth(1).click();
    await target.getByRole('button', { name: '이미 연결됨', exact: true }).waitFor(); assert.equal(await panelError.isHidden(), true); assert.equal(await panelError.textContent(), '');
    const after = await page.evaluate(ws => HaedoLife.Shell.storage.read(ws), seed.workspaceId), link = after.links.find(l => l.kind === 'obsidian_link' && l.sourceRefs?.[0]?.sourceVersionId === seed.sourceVersion.id);
    assert.ok(link); assert.equal(after.links.length, before.links.length + 1); assert.deepEqual(after.sources, before.sources); assert.deepEqual(after.sourceVersions, before.sourceVersions); assert.deepEqual(after.records, before.records);
    assert.equal(seed.sourceVersion.contentText.slice(link.sourceRefs[0].locator.start, link.sourceRefs[0].locator.end), seed.token);
    assert.equal(link.sourceRefs[1].sourceVersionId, seed.targetVersion.id); assert.equal(link.sourceRefs[1].locator.start, seed.targetVersion.contentText.lastIndexOf('# 목표'));
    const restored = await page.evaluate(async ws => { const C = HaedoLife.Core, b = await HaedoLife.Shell.storage.read(ws); return C.restoreBackup(C.makeBackup(b)); }, seed.workspaceId);
    const restoredLink = restored.links.find(l => l.kind === 'obsidian_link'); assert.ok(restoredLink); assert.equal(restored.sourceVersions.find(v => v.id === restoredLink.sourceRefs[0].sourceVersionId).contentText.slice(restoredLink.sourceRefs[0].locator.start, restoredLink.sourceRefs[0].locator.end), seed.token);
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 500 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1)); await fs.mkdir(output, { recursive: true }); const file = `${output}/reader-${width}.png`; await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file); }
    // Exercise the actual DOM selection path, including the emoji's two UTF-16 units.
    await page.locator('#lifeExcerptToggle').click(); await page.waitForFunction(() => document.querySelector('#lifeSourceText')?.dataset.readingMode === 'raw');
    const chosenText = '🌱 옛 문장', selectionStart = seed.sourceVersion.contentText.indexOf(chosenText), selectionEnd = selectionStart + chosenText.length;
    await page.locator('#lifeSourceText').evaluate((el, range) => {
      if (el.firstChild?.nodeType !== Node.TEXT_NODE) throw Error('Exact original text node is missing');
      el.focus(); const selection = getSelection(), selected = document.createRange(); selected.setStart(el.firstChild, range.start); selected.setEnd(el.firstChild, range.end);
      selection.removeAllRanges(); selection.addRange(selected); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, { start: selectionStart, end: selectionEnd });
    await page.waitForFunction(expected => document.querySelector('#lifeSelectedQuote')?.textContent === expected && getSelection()?.toString() === expected, chosenText);
    const openTarget = target.getByRole('button', { name: /일치 위치 2 열기/ }); await openTarget.scrollIntoViewIfNeeded(); const scroll = await page.evaluate(() => scrollY); const key = await openTarget.getAttribute('data-obsidian-focus');
    await openTarget.click(); await page.locator('#lifeObsidianPreviousSource').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), seed.targetVersion.contentText);
    await page.locator('#lifeObsidianPreviousSource').click(); await page.getByRole('heading', { name: '테스트 출발 원문', exact: true }).waitFor();
    await page.waitForFunction(key => document.activeElement?.dataset.obsidianFocus === key, key); assert.ok(Math.abs((await page.evaluate(() => scrollY)) - scroll) <= 2);
    await page.waitForFunction(expected => getSelection()?.toString() === expected && document.querySelector('#lifeSelectedQuote')?.textContent === expected, chosenText);
    const selection = await page.evaluate(() => { const r = getSelection().getRangeAt(0), reader = document.querySelector('#lifeSourceText'); return { start: r.startOffset, end: r.endOffset, exactTextNode: r.startContainer === reader.firstChild && r.endContainer === reader.firstChild }; });
    assert.deepEqual(selection, { start: selectionStart, end: selectionEnd, exactTextNode: true });
    await page.locator('#lifeExcerptToggle').click(); await page.waitForFunction(() => document.querySelector('#lifeSourceText')?.dataset.readingMode === 'raw');
    assert.equal(await page.locator('#lifeSourceText').textContent(), seed.sourceVersion.contentText); assert.equal(hash(await page.locator('#lifeSourceText').textContent()), hash(seed.sourceVersion.contentText));
    await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor(); assert.equal(await page.locator('#lifeSearch').inputValue(), '테스트 출발 원문');
    report.checks.push('DOM selection, duplicated anchors, old quote and backup, exact target and original return');
    await open('테스트 출발 원문', seed.sourceVersion.id); await page.locator('#lifeObsidianCandidates > details > summary').click();
    await openOccurrence(seed.sourceVersion.contentText.indexOf(seed.token), '대상 후보 여러 개 · 직접 선택');
    const linked = page.locator('#lifeObsidianCandidates article[data-start="' + seed.sourceVersion.contentText.indexOf(seed.token) + '"] section.life-backup-source[data-version-id="' + seed.targetVersion.id + '"]');
    await openCandidate(linked);
    await linked.getByRole('button', { name: /일치 위치 2 열기/ }).click(); await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor(); assert.equal(await page.locator('#lifeSearch').inputValue(), '테스트 출발 원문');
    report.checks.push('existing direct list return remains available');
    await open('테스트 출발 원문', seed.sourceVersion.id); await page.locator('#lifeObsidianCandidates > details > summary').click();
    const selfStart = seed.sourceVersion.contentText.indexOf('[[#자기제목]]');
    await openOccurrence(selfStart, '대상 후보 1개 · 직접 확인');
    const self = page.locator('#lifeObsidianCandidates article[data-start="' + selfStart + '"] section.life-backup-source[data-version-id="' + seed.sourceVersion.id + '"]');
    await self.getByRole('button', { name: '이 위치를 연결', exact: true }).click(); await self.getByRole('button', { name: '이미 연결됨', exact: true }).waitFor();
    const selfBundle = await page.evaluate(ws => HaedoLife.Shell.storage.read(ws), seed.workspaceId), selfLink = selfBundle.links.find(l => l.kind === 'obsidian_link' && l.sourceRefs?.[0]?.locator?.start === selfStart);
    assert.ok(selfLink); assert.equal(selfLink.sourceRefs[0].sourceVersionId, seed.sourceVersion.id); assert.equal(selfLink.sourceRefs[1].sourceVersionId, seed.sourceVersion.id);
    assert.equal(seed.sourceVersion.contentText.slice(selfLink.sourceRefs[0].locator.start, selfLink.sourceRefs[0].locator.end), '[[#자기제목]]');
    assert.equal(seed.sourceVersion.contentText.slice(selfLink.sourceRefs[1].locator.start, selfLink.sourceRefs[1].locator.end), '# 자기제목');
    await self.getByRole('button', { name: /일치 위치 1 열기/ }).click(); await page.locator('#lifeObsidianPreviousSource').waitFor();
    await page.locator('#lifeObsidianPreviousSource').click(); await page.waitForFunction(() => document.activeElement?.dataset.obsidianFocus?.startsWith('obsidian-candidate:'));
    await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor();
    report.checks.push('same exact note can explicitly connect and return to its own heading');
    await page.evaluate(() => {
      const original = HaedoLife.ObsidianLinkCommit;
      window.__obsidianCommitOriginal = original; window.__obsidianGate = { entered: false, commits: 0, completed: false };
      window.__obsidianGate.promise = new Promise(resolve => { window.__obsidianGate.release = resolve; });
      HaedoLife.ObsidianLinkCommit = { ...original, create(options) {
        const underlying = options.storage, gate = window.__obsidianGate;
        const delayed = { read: async ws => { gate.entered = true; await gate.promise; try { return await underlying.read(ws); } finally { gate.completed = true; } },
          commitLocal: (...args) => { gate.commits++; return underlying.commitLocal(...args); } };
        return original.create({ ...options, storage: delayed });
      } };
    });
    await open('테스트 출발 원문', seed.sourceVersion.id); await page.locator('#lifeObsidianCandidates > details > summary').click();
    const lateStart = seed.sourceVersion.contentText.indexOf('[[대상#목표|지연검사]]');
    await openOccurrence(lateStart, '대상 후보 여러 개 · 직접 선택');
    const late = page.locator('#lifeObsidianCandidates article[data-start="' + lateStart + '"] section.life-backup-source[data-version-id="' + seed.targetVersion.id + '"]');
    await openCandidate(late);
    const beforeLate = await page.evaluate(ws => HaedoLife.Shell.storage.read(ws), seed.workspaceId);
    await late.getByRole('button', { name: '이 위치를 연결', exact: true }).first().click(); await page.waitForFunction(() => __obsidianGate.entered);
    await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor(); await page.evaluate(() => __obsidianGate.release());
    await page.waitForFunction(() => __obsidianGate.completed); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => __obsidianGate.commits), 0); assert.deepEqual(await page.evaluate(ws => HaedoLife.Shell.storage.read(ws), seed.workspaceId), beforeLate);
    await page.evaluate(() => { HaedoLife.ObsidianLinkCommit = __obsidianCommitOriginal; });
    report.checks.push('late source response after leaving the screen cannot install a link');
    await page.evaluate(() => {
      const original = __obsidianCommitOriginal; window.__obsidianGate = { entered: false, commits: 0, completed: false };
      window.__obsidianGate.promise = new Promise(resolve => { window.__obsidianGate.release = resolve; });
      HaedoLife.ObsidianLinkCommit = { ...original, create(options) {
        const underlying = options.storage, gate = window.__obsidianGate;
        return original.create({ ...options, storage: { read: async ws => { gate.entered = true; await gate.promise; try { return await underlying.read(ws); } finally { gate.completed = true; } },
          commitLocal: (...args) => { gate.commits++; return underlying.commitLocal(...args); } } });
      } };
    });
    await open('테스트 출발 원문', seed.sourceVersion.id); await page.locator('#lifeObsidianCandidates > details > summary').click();
    await openOccurrence(lateStart, '대상 후보 여러 개 · 직접 선택');
    const lateAccount = page.locator('#lifeObsidianCandidates article[data-start="' + lateStart + '"] section.life-backup-source[data-version-id="' + seed.targetVersion.id + '"]');
    await openCandidate(lateAccount);
    const beforeAccount = await page.evaluate(ws => HaedoLife.Shell.storage.read(ws), seed.workspaceId);
    await lateAccount.getByRole('button', { name: '이 위치를 연결', exact: true }).first().click(); await page.waitForFunction(() => __obsidianGate.entered);
    await page.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.b));
    await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id); await ready(page);
    await page.evaluate(() => __obsidianGate.release()); await page.waitForFunction(() => __obsidianGate.completed);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => __obsidianGate.commits), 0);
    const oldRaw = await page.evaluate(ws => new Promise((resolve, reject) => { const request = indexedDB.open('life-tools-v1'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('bundles', 'readonly'), get = tx.objectStore('bundles').get(ws); get.onsuccess = () => { const result = get.result; db.close(); resolve(result); }; get.onerror = () => { db.close(); reject(get.error); }; }; }), seed.workspaceId);
    assert.deepEqual(oldRaw, beforeAccount);
    await page.evaluate(async value => { HaedoLife.ObsidianLinkCommit = __obsidianCommitOriginal; await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.a));
    await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.a.id); await ready(page);
    report.checks.push('late old-account response cannot install a link after switching accounts');
    const existing = await existingNaver(page), sub = server.setup(existing.workspaceId); server.inbox(sub);
    const naverBody = (await page.evaluate(ws => HaedoLife.Shell.storage.read(ws), existing.workspaceId)).sourceVersions.find(v => v.id === existing.refs['100001'].versionId).contentText;
    await entry(); await open('기존 합성 원문 100001', existing.refs['100001'].versionId); await page.locator('#lifeNaverSourceMedia[data-state=unverified]').waitFor();
    for (const route of ['top', 'bottom']) {
      await page.locator('#lifeNaverMediaReview').scrollIntoViewIfNeeded(); const y = await page.evaluate(() => scrollY);
      await page.locator('#lifeNaverMediaReview').click(); await page.locator('#lifeNaverBlog').waitFor();
      if (route === 'top') await page.locator('#lifeSubviewReturn').click(); else await page.locator('#naverBlogReturn').click();
      await page.locator('#lifeNaverSourceMedia[data-state=unverified]').waitFor(); await page.waitForFunction(() => document.activeElement?.id === 'lifeNaverMediaReview');
      assert.ok(Math.abs((await page.evaluate(() => scrollY)) - y) <= 2); assert.equal(await page.locator('#lifeSourceText').textContent(), naverBody);
    }
    await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor(); assert.equal(await page.locator('#lifeSearch').inputValue(), '기존 합성 원문 100001');
    report.checks.push('Naver missing-photo review returns to exact prior source from top and bottom');
    assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.externalRequests, []);
    assert.deepEqual(await hashes(), report.sourceHashes); assert.equal(hash(await fs.readFile(__filename)), report.testHash); report.pass = true;
  } catch (error) { report.failure = error.stack; report.surface = await page.evaluate(() => ({ title: document.querySelector('.life-reader-heading')?.textContent, text: document.querySelector('#lifeSourceText')?.textContent?.slice(0, 200), active: document.activeElement?.outerHTML, error: document.querySelector('.life-error:not([hidden])')?.textContent, buttons: [...document.querySelectorAll('button')].filter(v => v.getClientRects().length).map(v => v.textContent) })).catch(() => null); throw error; } finally { await context.close(); await browser.close(); await fs.mkdir(output, { recursive: true }); await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); }
  console.log('PASS ' + report.checks.length + ' Obsidian and Naver exact-return journeys');
}
main().catch(error => {
  console.error(error.stack);
  if (process.env.GITHUB_ACTIONS) console.error('::error title=Obsidian link integration::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
  process.exitCode = 1;
});
