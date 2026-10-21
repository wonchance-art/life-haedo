/* Real editor/IndexedDB regression: independent copies retain exact private
 * evidence. Synthetic Auth only; no production data or external writes. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, base, cloud } = require('./life-sync-browser.cjs');
const output = path.resolve('.local/photo-post-evidence');
const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], scope: 'Synthetic HTTP Auth, real SDK/editor/account-scoped IndexedDB. Chromium viewport simulation, no real OAuth, hosted Storage or Apple hardware.' };
async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version();
  let active;
  async function fixture({ status = 'draft', before = false } = {}) {
    const server = new FakeCloud(), context = await makeContext(browser, server, 'evidence-' + report.checks.length + (before ? '-before' : ''), accounts.a, { viewport: { width: 1440, height: 1000 } });
    active = context;
    await context.route('**/*', route => { const origin = new URL(route.request().url()).origin; if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push(origin); return route.abort(); });
    if (before) await context.route(new URL('/assets/life/photo-post-ui.js', base).href, route => route.fulfill({ contentType: 'text/javascript', path: process.env.PHOTO_EVIDENCE_BEFORE_PATH }));
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', e => report.pageErrors.push(e.message)); page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
    await page.goto(base + '/index.html?section=records&view=page'); await ready(page);
    const seed = await page.evaluate(async status => {
      const C = HaedoLife.Core, s = HaedoLife.Shell.storage, w = await s.getActive(), initial = await s.read(w);
      const raw = '\ufeff🌱 첫 줄\r\n정확한 예전 구절 👨‍👩‍👧\r\n다음 문장';
      const old = await C.prepareImport({ origin: 'obsidian', title: '익명 원문', text: raw, url: 'https://example.org/source', authorRelation: 'unknown' }, initial);
      let b = C.applyChanges(initial, C.buildImportChanges(initial, old));
      const latest = await C.prepareImport({ origin: 'obsidian', title: '익명 원문', existingSourceId: old.source.id, text: '전혀 다른 최신 본문', authorRelation: 'unknown' }, b);
      b = C.applyChanges(b, C.buildImportChanges(b, latest));
      const result = await s.commitLocal({ workspaceId: w, baseRevision: initial.revision, operationId: C.id(), changes: { put: { sources: b.sources, sourceVersions: b.sourceVersions } } });
      if (result.status !== 'stored') throw Error('fixture commit');
      b = await s.read(w); const quote = '정확한 예전 구절 👨‍👩‍👧\r\n다음', start = raw.indexOf(quote);
      const ref = await HaedoLife.SourceReference.build({ bundle: b, sourceId: old.source.id, versionId: old.version.id, locator: { start, end: start + quote.length } });
      const p = HaedoLife.PhotoPost.create(C.id); p.title = '근거가 있는 여행 기록'; p.status = status; p.ops = HaedoLife.BlogEvidence.draft(ref, '내 생각을 직접 남겼다.').ops;
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; canvas.getContext('2d').fillRect(0, 0, 640, 480);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const photo = await HaedoLife.PhotoPost.readPhoto(new File([blob], 'anonymous-original.png', { type: 'image/png' }), C.id);
      p.photos = [photo]; p.ops.push({ insert: { photo: { id: photo.id, caption: '그날 남긴 사진', alt: '익명 풍경' } } }, { insert: '\n' });
      const stored = await s.savePhotoPostWithEvidence(w, p, 0, [ref], 0);
      return { id: stored.id, ref, bundle: b, original: stored };
    }, status);
    await page.reload(); await ready(page);
    const compatibility = page.locator('.wb-page-compatibility');
    if (await compatibility.count() && !await compatibility.evaluate(n => n.open)) await compatibility.locator(':scope > summary').click();
    const row = page.locator('[data-photo-post-id="' + seed.id + '"]');
    await row.waitFor({ state: 'attached' });
    if (await row.evaluate(n => !!n.closest('details:not([open])'))) await page.locator('.photo-retained > summary').click();
    await row.click({ noWaitAfter: true });
    if (status === 'saved') { await page.locator('.photo-article').waitFor(); await page.locator('.photo-posts').getByRole('button', { name: '글 수정', exact: true }).click(); }
    await page.locator('#photoTitle').waitFor();
    if (status === 'saved') {
      // Opening a saved post creates an editing draft. Establish the durable
      // baseline before counting the separate copy, rather than racing autosave.
      await page.locator('.photo-status[data-state="draft"]').waitFor();
      const drafts = await page.evaluate(async () => {
        const s = HaedoLife.Shell.storage, w = await s.getActive(), rows = await s.listPhotoPosts(w);
        return Promise.all(rows.filter(row => row.status === 'draft').map(row => s.readPhotoPost(w, row.id)));
      });
      assert.equal(drafts.length, 1);
      assert(drafts[0].revision > 0);
      assert.deepEqual(drafts[0].replaces, { id: seed.id, revision: seed.original.revision });
    }
    return { context, page, seed, server };
  }
  const read = p => p.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(), rows = await s.listPhotoPosts(w); return { bundle: await s.read(w), workbench: await s.readWorkbench(w), nine: await s.readNineBoard(w), collection: await s.readCollection(w), docs: await Promise.all(rows.map(async row => { const doc = await s.readPhotoPost(w, row.id), evidence = await s.readPostEvidence(w, row.id); return { ...doc, photos: await Promise.all(doc.photos.map(async photo => ({ ...photo, blob: undefined, actual: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await photo.blob.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join('') }))), evidence }; })) }; });
  async function duplicate(p, recovery = false) {
    if (!recovery && !await p.locator('.photo-more').evaluate(n => n.open)) await p.locator('.photo-more > summary').click();
    await p.getByRole('button', { name: recovery ? '현재 입력을 새 초안으로 보관' : '사본으로 이어 쓰기', exact: true }).click();
    await p.waitForFunction(() => document.querySelector('.photo-posts')?.getAttribute('aria-busy') === 'false');
  }
  async function verifyCopy(p, seed, previous, expectedRefs = [seed.ref]) {
    const after = await read(p), added = after.docs.filter(d => !previous.docs.some(v => v.id === d.id));
    assert.equal(added.length, 1); const copy = added[0]; assert.equal(copy.status, 'draft'); assert.equal(copy.replaces, null); assert.equal(copy.evidence.revision, 1); assert.deepEqual(copy.evidence.refs, expectedRefs);
    for (const key of ['bundle', 'workbench', 'nine', 'collection']) assert.deepEqual(after[key], previous[key]);
    for (const doc of previous.docs) assert.deepEqual(after.docs.find(v => v.id === doc.id), doc);
    assert.deepEqual(copy.photos, previous.docs[0].photos); assert.deepEqual(copy.ops, previous.docs[0].ops);
    if (expectedRefs.length) assert.deepEqual(await p.evaluate(async ref => { const s = HaedoLife.Shell.storage; return HaedoLife.SourceReference.resolve(await s.read(await s.getActive()), ref); }, copy.evidence.refs[0]), { sourceId: seed.ref.sourceId, sourceVersionId: seed.ref.sourceVersionId, locator: seed.ref.locator });
    return copy;
  }
  const snap = async (p, scene) => { for (const width of [1440, 390]) { await p.setViewportSize({ width, height: 1000 }); await p.evaluate(() => document.fonts.ready); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); await p.screenshot({ path: path.join(output, scene + '-' + width + '.png') }); report.visual.push({ scene, width }); } };
  const check = async (name, run) => { if (process.env.PHOTO_EVIDENCE_MATCH && !new RegExp(process.env.PHOTO_EVIDENCE_MATCH).test(name)) return; console.log('START ' + name); await run(); report.checks.push(name); console.log('PASS ' + name); await active?.close(); active = null; };
  try {
    if (process.env.PHOTO_EVIDENCE_BEFORE_PATH) { const f = await fixture({ before: true }), previous = await read(f.page); await duplicate(f.page); const after = await read(f.page), added = after.docs.filter(d => !previous.docs.some(v => v.id === d.id)); assert.equal(added.length, 1); assert.deepEqual(added[0].evidence, { revision: 0, refs: [] }); report.before = { reproduced: true, reason: 'An independent new ID lost its exact source sidecar.' }; await f.context.close(); active = null; console.log('REPRODUCED historical evidence loss'); }
    await check('Independent draft copy preserves old-version UTF-16/CRLF evidence, original photo bytes and all existing data', async () => { const f = await fixture(), previous = await read(f.page); await duplicate(f.page); await verifyCopy(f.page, f.seed, previous); await snap(f.page, 'independent-copy'); assert.equal(f.server.writes().length, 0); });
    await check('Saved-post edit draft inherits exact evidence only when no explicit sidecar exists', async () => { const f = await fixture({ status: 'saved' }), previous = await read(f.page); await duplicate(f.page); await verifyCopy(f.page, f.seed, previous); });
    await check('An explicit empty evidence revision overrides saved-post fallback', async () => { const f = await fixture({ status: 'saved' }); await f.page.locator('#photoTitle').fill('명시적으로 근거를 비운 수정 초안'); await f.page.waitForFunction(() => document.querySelector('.photo-status')?.textContent === '브라우저에 자동 임시저장됨'); await f.page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(), rows = await s.listPhotoPosts(w), draft = rows.find(v => v.status === 'draft'); if (!draft || draft.id === id) throw Error('editing draft missing'); await s.savePostEvidence(w, draft.id, { refs: [] }, 0); }, f.seed.id); const previous = await read(f.page); await duplicate(f.page); await verifyCopy(f.page, f.seed, previous, []); });
    await check('Evidence read failure retains the same editor/input and creates no partial copy; explicit retry succeeds', async () => { const f = await fixture(); await f.page.evaluate(() => { window.__getEvidence = IDBObjectStore.prototype.get; IDBObjectStore.prototype.get = function (...args) { if (this.name === 'meta' && String(args[0]).startsWith('post-evidence:')) throw Error('합성 근거 읽기 실패'); return __getEvidence.apply(this, args); }; window.__sameEditor = document.querySelector('.photo-editor'); }); const previous = await f.page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); return s.listPhotoPosts(w); }); await duplicate(f.page); await f.page.locator('.photo-status[role=alert]').waitFor(); assert.equal(await f.page.locator('.photo-editor').evaluate(n => n === __sameEditor), true); assert.equal(await f.page.locator('#photoTitle').inputValue(), f.seed.original.title); assert.deepEqual(await f.page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.listPhotoPosts(await s.getActive()); }), previous); await snap(f.page, 'read-failure'); await f.page.evaluate(() => { IDBObjectStore.prototype.get = __getEvidence; }); const before = await read(f.page); await duplicate(f.page); await verifyCopy(f.page, f.seed, before); });
    await check('Actual sidecar transaction abort installs zero copy bytes and preserves the editor for retry', async () => { const f = await fixture(), previous = await read(f.page); await f.page.evaluate(() => { window.__sameEditor = document.querySelector('.photo-editor'); window.__put = IDBObjectStore.prototype.put; window.__aborts = 0; IDBObjectStore.prototype.put = function (...args) { const request = __put.apply(this, args); if (this.name === 'meta' && args[0]?.key?.startsWith('post-evidence:')) { __aborts++; this.transaction.abort(); } return request; }; }); await duplicate(f.page); await f.page.locator('.photo-status[role=alert]').waitFor(); assert(await f.page.evaluate(() => __aborts > 0)); assert.equal(await f.page.locator('.photo-editor').evaluate(n => n === __sameEditor), true); assert.deepEqual(await read(f.page), previous); await f.page.evaluate(() => { IDBObjectStore.prototype.put = __put; }); await duplicate(f.page); await verifyCopy(f.page, f.seed, previous); await snap(f.page, 'atomic-retry'); });
    await check('A genuinely conflicted draft preserves the competing document and recovers current input with exact evidence under a new ID', async () => { const f = await fixture(); await f.page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(), doc = await s.readPhotoPost(w, id); doc.title = '다른 창에서 보관한 제목'; await s.savePhotoPost(w, doc, doc.revision); }, f.seed.id); await f.page.locator('#photoTitle').fill('내 입력을 살린 새 초안'); await f.page.locator('.photo-status[role=alert]').waitFor(); const previous = await read(f.page); await duplicate(f.page, true); const copy = await verifyCopy(f.page, f.seed, previous); assert.equal(copy.title, '내 입력을 살린 새 초안'); assert.equal(previous.docs.find(d => d.id === f.seed.id).title, '다른 창에서 보관한 제목'); });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } catch (error) { report.pass = false; report.error = error.stack; await active?.pages().at(-1)?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); throw error; }
  finally { await active?.close(); await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
