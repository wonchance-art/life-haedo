/* Actual anonymous app UI and IndexedDB; no operating account or private source files. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4189';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { playwright, ready, makeContext } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, base, cloud } = require('./life-sync-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve('.local/source-evidence'), report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], scope: 'Anonymous mock Auth and actual IndexedDB/UI. Chromium viewport simulation only; no private or operating data.' };
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const server = new FakeCloud(), context = await makeContext(browser, server, 'source-evidence', accounts.a, { viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => { const origin = new URL(route.request().url()).origin; if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push(origin); return route.abort(); });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.pageErrors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  const check = async (name, fn) => { await fn(); report.checks.push(name); console.log('PASS ' + name); };
  const go = async view => { await page.goto(base + '/index.html?section=records&view=' + view); await ready(page); };
  const board = () => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.readNineBoard(await s.getActive()); });
  const saved = () => page.waitForFunction(() => document.querySelector('.nb-status')?.textContent === '이 브라우저에 저장됨');
  const openSource = async () => { await go('sources'); await page.locator('#lifeSearch').fill('이전 근거'); await page.locator('.life-source-open').click(); await page.locator('#lifeSourceText').waitFor(); };
  const selectSource = async () => {
    await page.locator('#lifeSourceText').evaluate((element, quote) => { const text = element.firstChild, start = text.data.indexOf(quote), range = document.createRange(); range.setStart(text, start); range.setEnd(text, start + quote.length); const selected = getSelection(); selected.removeAllRanges(); selected.addRange(range); element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }, '이전 근거 문장\r\n둘째');
    await page.locator('#lifeReaderArrange').click();
  };
  const capture = async scene => {
    for (const width of [1440, 820, 390]) { await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready); const metrics = await page.evaluate(inspect); report.visual.push({ scene, width, metrics }); assert.equal(metrics.horizontalOverflow, false); for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ' ' + key); await page.screenshot({ path: path.join(out, scene + '-' + width + '.png') }); }
    await page.setViewportSize({ width: 1440, height: 1000 });
  };
  let fixture, original;
  try {
    await go('sources'); fixture = await page.evaluate(async () => {
      const C = HaedoLife.Core, s = HaedoLife.Shell.storage; let b = await s.read(await s.getActive());
      const raw = '\ufeff🌱 머리\r\n이전 근거 문장\r\n둘째\r\n복사하면 안 되는 원문 나머지';
      const old = await C.prepareImport({ origin: 'obsidian', title: '익명 근거 원문', text: raw, authorRelation: 'unknown', url: 'https://example.org/source' }, b);
      let next = C.applyChanges(b, C.buildImportChanges(b, old));
      const latest = await C.prepareImport({ origin: 'obsidian', title: old.source.title, text: '다른 최신 본문', existingSourceId: old.source.id, authorRelation: 'unknown' }, next);
      next = C.applyChanges(next, C.buildImportChanges(next, latest));
      const changes = { put: { sources: next.sources, sourceVersions: next.sourceVersions } };
      const result = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: C.id(), changes }); if (result.status !== 'stored') throw Error('fixture source commit');
      const post = HaedoLife.PhotoPost.create(C.id); post.title = '내가 저장한 글'; post.ops = [{ insert: '선택한 저장 글의 본문🌱\n' }]; post.status = 'saved';
      const stored = await s.savePhotoPost(b.workspaceId, post, 0);
      return { workspaceId: b.workspaceId, sourceId: old.source.id, oldVersionId: old.version.id, raw, postId: stored.id, quote: '이전 근거 문장\r\n둘째' };
    });
    original = await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.read(await s.getActive()); });
    await check('Reader selection enters nine-board review without changing sources or inserting before explicit confirmation', async () => {
      await openSource(); await selectSource(); await page.locator('#lifeSourceToNine').click(); await page.locator('.nb-incoming').waitFor();
      assert.equal((await board()).boards.length, 0); assert.equal((await board()).format, 'life-nine-board-v1');
      await page.getByRole('button', { name: '새 9칸 구성', exact: true }).click(); await page.locator('#nbTitle').fill('근거를 다시 읽는 구성'); await page.locator('#nbAreaTitle').fill('내가 고른 원문');
      await page.getByRole('button', { name: '선택한 영역에 담기', exact: true }).click();
      assert.equal(await page.locator('#nbItemTitle').inputValue(), '익명 근거 원문');
      await page.getByLabel('선택 이유', { exact: true }).fill('지금 직접 작성한 선택 이유');
      assert.equal((await board()).format, 'life-nine-board-v1');
      await page.evaluate(() => { window.__evidencePut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { const result = __evidencePut.apply(this, args); if (this.name === 'meta' && args[0]?.key?.startsWith('nine-board:')) this.transaction.abort(); return result; }; });
      await page.locator('.nb-item-editor button[type=submit]').click(); await page.locator('.nb-error:not([hidden])').waitFor();
      assert.equal((await board()).format, 'life-nine-board-v1'); await page.locator('.nb-grid .nb-reason > summary').first().click(); assert.match(await page.locator('.nb-grid').innerText(), /지금 직접/);
      await page.evaluate(() => { IDBObjectStore.prototype.put = __evidencePut; }); await page.getByRole('button', { name: '다시 저장', exact: true }).click(); await saved();
      const value = await board(), reference = value.boards[0].areas[0].items[0].reference.value;
      assert.equal(value.format, 'life-nine-board-v2'); assert.equal(reference.sourceVersionId, fixture.oldVersionId); assert.equal(reference.quote, fixture.quote);
    });
    await check('Nine-board exact source reopening and back navigation retain the chosen old version, quote and item focus', async () => {
      await page.getByText('보관한 근거', { exact: true }).first().click(); await capture('nine-reference');
      await page.getByRole('button', { name: /^정확한 근거 열기/ }).first().click(); await page.locator('#lifeSourceText').waitFor();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.waitForFunction(quote => { const text=document.querySelector('#lifeSourceText')?.firstChild,selected=getSelection();if(!text||selected?.rangeCount!==1)return false;const range=selected.getRangeAt(0);return range.startContainer===text&&range.endContainer===text&&range.startOffset===text.data.indexOf(quote)&&range.endOffset===text.data.indexOf(quote)+quote.length&&text.data.slice(range.startOffset,range.endOffset)===quote; }, fixture.quote);
      assert.equal(await page.locator('#lifeSourceText').textContent(), fixture.raw); assert.equal(await page.locator('#lifeVersion').inputValue(), fixture.oldVersionId);
      await page.locator('#lifeSearchReturn').click(); await page.locator('.nb-status').waitFor();
      await page.waitForFunction(() => document.activeElement?.dataset.focusKey?.startsWith('nine:reference:'));
    });
    await check('Saved-post picker, v2 file roundtrip and another-workspace restore preserve selected revisions without rebinding', async () => {
      await page.getByRole('button', { name: '원문·저장 글 담기', exact: true }).click(); await page.getByRole('button', { name: '저장한 글 고르기', exact: true }).click();
      await page.getByRole('button', { name: '내가 저장한 글', exact: true }).click(); await page.getByLabel('선택 이유', { exact: true }).fill('내가 다시 읽을 이유');
      await page.locator('.nb-item-editor button[type=submit]').click(); await saved();
      const value = await board(); assert.equal(value.boards[0].areas[0].items[1].reference.kind, 'post');
      const postRef = value.boards[0].areas[0].items[1].reference.value; assert.equal(postRef.postId, fixture.postId);
      await page.locator('.nb-cell').nth(1).getByText('보관한 근거',{exact:true}).click();
      await page.locator('.nb-cell').nth(1).getByRole('button',{name:/^정확한 근거 열기/}).click();
      await page.getByRole('heading',{name:'내가 저장한 글',exact:true}).waitFor();
      await page.getByRole('button',{name:'9칸 구성으로 돌아가기',exact:true}).click();await page.locator('.nb-status').waitFor();
      await page.waitForFunction(()=>document.activeElement?.dataset.focusKey?.endsWith(':1'));
      await page.evaluate(async postId=>{const s=HaedoLife.Shell.storage,w=await s.getActive(),p=await s.readPhotoPost(w,postId);p.ops=[{insert:'다른 탭에서 바뀐 최신 본문\n'}];await s.savePhotoPost(w,p,p.revision);},fixture.postId);
      await page.locator('.nb-cell').nth(1).getByRole('button',{name:/^정확한 근거 열기/}).click();await page.locator('.nb-error:not([hidden])').waitFor();
      assert.match(await page.locator('.nb-error').textContent(),/바뀌었|최신/);assert.equal((await board()).boards[0].areas[0].items[1].reference.value.postRevision,postRef.postRevision);
      const copies = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, current = await s.readNineBoard(await s.getActive()), file = HaedoLife.NineBoard.backup(current.boards), other = await s.createWorkspace('다른 익명 공간'); const next = { ...HaedoLife.NineBoard.empty(other.workspaceId), format: 'life-nine-board-v2', boards: HaedoLife.NineBoard.copies(HaedoLife.NineBoard.readBackup(file), HaedoLife.Core.id) }; await s.saveNineBoard(other.workspaceId, next, 0); return next; });
      assert.equal(copies.boards[0].areas[0].items[0].reference.value.workspaceId, fixture.workspaceId);
      await go('page'); await page.getByRole('button', { name: '9칸 구성', exact: true }).click(); await page.locator('.nb-status').waitFor();
      await page.getByText('보관한 근거', { exact: true }).first().click(); assert.match(await page.locator('.nb-grid').innerText(), /다른 작업공간의 근거/);
      assert.equal(await page.getByRole('button', { name: /^정확한 근거 열기/ }).count(), 0);
      await page.evaluate(async id => { await HaedoLife.Shell.storage.setActive(id); }, fixture.workspaceId);
    });
    await check('Rich evidence draft and sidecar commit atomically; failed storage keeps the exact selection and thought for retry', async () => {
      await openSource(); await selectSource(); await page.locator('#lifeSourceToBlog').click(); await page.locator('#blogEvidenceThought').waitFor();
      assert.equal(await page.locator('#blogEvidenceQuote').textContent(), fixture.quote); await page.locator('#blogEvidenceThought').fill('내가 직접 쓴 별도의 생각');
      await capture('quote-editor');
      const before = await page.evaluate(async () => (await HaedoLife.Shell.storage.listPhotoPosts(await HaedoLife.Shell.storage.getActive())).length);
      await page.evaluate(() => { window.__evidencePut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { const result = __evidencePut.apply(this, args); if (this.name === 'meta' && args[0]?.key?.startsWith('post-evidence:')) this.transaction.abort(); return result; }; });
      await page.getByRole('button', { name: '인용으로 새 글 쓰기', exact: true }).click(); await page.locator('.life-evidence [role=alert]:not([hidden])').waitFor();
      assert.equal(await page.locator('#blogEvidenceThought').inputValue(), '내가 직접 쓴 별도의 생각');
      assert.equal(await page.evaluate(async () => (await HaedoLife.Shell.storage.listPhotoPosts(await HaedoLife.Shell.storage.getActive())).length), before);
      await page.evaluate(() => { IDBObjectStore.prototype.put = __evidencePut; }); await page.getByRole('button', { name: '인용으로 새 글 쓰기', exact: true }).click();
      await page.locator('#photoTitle').waitFor();
      const result = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, id = await s.getActive(), rows = await s.listPhotoPosts(id), row = rows.find(value => value.status === 'draft'); return { rows: rows.length, doc: await s.readPhotoPost(id, row.id), evidence: await s.readPostEvidence(id, row.id), bundle: await s.read(id) }; });
      assert.equal(result.rows, before + 1); assert.equal(result.evidence.refs[0].quote, fixture.quote); assert.equal(result.evidence.refs[0].sourceVersionId, fixture.oldVersionId);
      assert.deepEqual(result.bundle, original); assert(!JSON.stringify(result.doc.ops).includes('복사하면 안 되는 원문 나머지'));
      assert.match(result.doc.ops.map(op => typeof op.insert === 'string' ? op.insert : '').join(''), /내가 직접 쓴 별도의 생각/);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []); assert.equal(server.writes().length, 0); report.pass = true;
  } catch (error) { await page.screenshot({ path: path.join(out, 'failure.png') }); throw error; }
  finally { await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
