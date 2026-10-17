'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { openPost } = require('./photo-post-entry.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve('.local/blog-writing-completion');
const report = { checks: [], visual: [], errors: [], consoleErrors: [], external: [], scope: 'Anonymous Auth, synthetic originals and real IndexedDB. Exported HTML reopened over local HTTP in a fresh context. Playwright Chromium viewport checks; no production or mobile Apple-device proof.' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version();
  const context = await makeContext(browser, new FakeCloud(), 'blog-completion', accounts.a, { viewport: { width: 1440, height: 1000 }, hasTouch: true });
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback();
    report.external.push(u.origin); return route.abort();
  });
  let currentCheck = 'setup'; report.consoleDetails = []; report.requestFailures = [];
  const resourceLabel = value => { const u = new URL(value); return u.protocol === 'blob:' ? 'blob:' + u.origin + '/<object-url>' : u.origin + u.pathname; };
  const page = await context.newPage(), other = await context.newPage();
  const observe = p => {
    p.setDefaultTimeout(15000); p.setDefaultNavigationTimeout(30000);
    p.on('pageerror', e => report.errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') { report.consoleErrors.push(m.text()); report.consoleDetails.push({ check: currentCheck, message: m.text(), location: { ...m.location(), url: m.location().url ? resourceLabel(m.location().url) : '' } }); } });
    p.on('requestfailed', request => {
      const row = { check: currentCheck, resource: resourceLabel(request.url()), error: request.failure()?.errorText }; report.requestFailures.push(row);
    });
  };
  observe(page); observe(other);
  const click = async (name, p = page) => p.getByRole('button', { name, exact: true }).click();
  const more = async (name, p = page) => {
    const menu = p.locator('.photo-more');
    if (!await menu.evaluate(n => n.open)) await menu.locator(':scope > summary').click();
    await click(name, p);
  };
  const go = async (p = page) => {
    await p.goto(base + '/index.html?section=records&view=page', { waitUntil: 'domcontentloaded' }); await ready(p);
    const compatibility = p.locator('.wb-page-compatibility'); if (await compatibility.count() && !await compatibility.evaluate(n => n.open)) await compatibility.locator(':scope > summary').click();
    await p.getByRole('button', { name: '글쓰기', exact: true }).waitFor();
  };
  const stored = p => (p || page).waitForFunction(() => document.querySelector('.photo-status')?.textContent === '초안 보관됨');
  const read = () => page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, w = await s.getActive(), index = await s.listPhotoPosts(w);
    return { w, index, docs: await Promise.all(index.map(v => s.readPhotoPost(w, v.id))) };
  });
  const originals = () => page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, w = await s.getActive();
    return { bundle: await s.read(w), wb: await s.readWorkbench(w), drafts: await s.readPageDrafts(w), collection: await s.readCollection(w), nine: await s.readNineBoard(w) };
  });
  const check = async (name, task) => { currentCheck = name; console.log('START ' + name); await task(); report.checks.push(name); console.log('PASS ' + name); };
  const capture = async (p, scene, widths = [1440, 390]) => {
    for (const width of widths) {
      await p.setViewportSize({ width, height: 1000 });
      // Contrast belongs to the final reading surface; allow finite UI fades
      // to end naturally without cancelling motion or relaxing the threshold.
      await p.evaluate(async () => {
        await document.fonts.ready; await new Promise(requestAnimationFrame);
        await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {})));
      });
      const metrics = await p.evaluate(inspect); report.visual.push({ scene, width, metrics });
      assert.equal(metrics.horizontalOverflow, false, scene + ' overflow');
      for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ' ' + key);
      await p.screenshot({ path: path.join(out, scene + '-' + width + '.png') });
    }
  };
  const getDownload = async action => {
    const promise = page.waitForEvent('download'); promise.catch(() => {});
    await action(); const download = await promise;
    return { download, bytes: await fs.readFile(await download.path()) };
  };
  let images, legacy, original, primary, primaryId, primaryZip, legacyZip, copyId, portableContext;
  try {
    await go();
    images = await page.evaluate(() => [[800, 600, 'image/png'], [600, 900, 'image/jpeg']].map(([width, height, type], i) => {
      const c = document.createElement('canvas'); c.width = width; c.height = height;
      const x = c.getContext('2d'); x.fillStyle = i ? '#d8d0bf' : '#a6c3be'; x.fillRect(0, 0, width, height); x.fillStyle = '#293c4f';
      x.font = '32px sans-serif'; x.fillText('익명 여행 사진 ' + (i + 1), 40, 100); x.fillRect(40, 150, width - 80, 24);
      return { width, height, type, data: c.toDataURL(type, .95).split(',')[1] };
    }));
    legacy = await page.evaluate(async image => {
      const s = HaedoLife.Shell.storage, w = await s.getActive(), c = await s.readCollection(w), now = new Date().toISOString();
      c.items.push({ id: HaedoLife.Core.id(), type: 'book', title: '여행에서 읽은 책 <script>literal</script>', creator: '익명 저자', url: 'https://example.org/book', note: '복사하면 안 되는 개인 메모', tags: ['비공개 주제'], details: {}, archived: false, createdAt: now, updatedAt: now }); await s.saveCollection(w, c, c.revision);
      const M = HaedoLife.PhotoPost, d = M.create(HaedoLife.Core.id), file = new File([Uint8Array.from(atob(image.data), ch => ch.charCodeAt(0))], 'legacy.png', { type: image.type }), p = await M.readPhoto(file, HaedoLife.Core.id);
      d.format = 'life-photo-post-v1'; delete d.attachments; delete d.archived; d.title = '기존 v1 여행 글'; d.status = 'saved'; d.photos = [p]; d.ops = [{ insert: '옛 글도 그대로 읽는다.\n' }, { insert: { photo: { id: p.id, caption: '예전 사진 설명', alt: '익명 풍경' } } }, { insert: '\n' }];
      const saved = await s.savePhotoPost(w, d, 0), zip = await M.backup(saved);
      return { id: saved.id, revision: saved.revision, digest: p.digest, zip: Array.from(new Uint8Array(await zip.arrayBuffer())) };
    }, images[0]);
    legacyZip = Buffer.from(legacy.zip); await go(); original = await originals();

    await check('A v1 post stays unchanged; one editor accepts original photos and an existing book without private collection context', async () => {
      await openPost(page, legacy.id); await page.locator('.photo-article').waitFor(); assert.match(await page.locator('.photo-article').innerText(), /옛 글도/);
      assert.equal((await read()).docs.find(d => d.id === legacy.id).format, 'life-photo-post-v1'); await click('사진 글 목록');
      await click('글쓰기'); await page.locator('#photoTitle').fill('여행에서 읽고 들은 것들 <기록>'); await page.locator('.ql-editor').fill('사진과 책, 장소를 함께 남기는 여행 기록.\n두 번째 문장도 같은 본문에 남긴다.');
      await page.evaluate(() => { const q = Quill.find(document.querySelector('.ql-container')); q.setSelection(q.getLength() - 1, 0, 'silent'); });
      await page.locator('#photoFiles').setInputFiles(images.map((v, i) => ({ name: 'anonymous-' + i + (i ? '.jpg' : '.png'), mimeType: v.type, buffer: Buffer.from(v.data, 'base64') })));
      await page.locator('.photo-block').nth(1).waitFor(); await stored();
      await click('음악·책·대상 붙이기'); await page.locator('#clPickerQuery').fill('여행에서 읽은 책'); await page.locator('.cl-picker-results .cl-pick-row').click(); await stored();
      const d = (await read()).docs.find(v => v.status === 'draft'); primaryId = d.id;
      assert.equal(d.format, 'life-photo-post-v2'); assert.equal(d.attachments.length, 1); assert.equal(d.attachments[0].creator, '익명 저자');
      assert(!JSON.stringify(d.attachments).includes('개인 메모')); assert(!JSON.stringify(d.attachments).includes('비공개 주제'));
      assert.equal(d.photos[0].digest, hash(Buffer.from(images[0].data, 'base64'))); assert.deepEqual(await originals(), original);
    });

    await check('Unapplied attachment input and composition block save/export/navigation; edit, cancel and reorder preserve the body and collection', async () => {
      await click('음악·책·대상 붙이기'); await page.locator('#clPickerQuery').fill('산책한 장소'); await click('직접 입력');
      const review = page.locator('.photo-attachment-review'), title = review.getByRole('textbox', { name: '제목 또는 이름', exact: true });
      await review.evaluate(n => window.__review = n); await review.getByLabel('첨부 종류', { exact: true }).selectOption('place');
      await review.getByRole('textbox', { name: '출처 링크', exact: true }).fill('javascript:alert(1)'); await click('첨부'); await page.locator('.photo-status[role=alert]').waitFor(); assert.equal(await review.evaluate(n => n === __review), true);
      await title.dispatchEvent('compositionstart'); await title.fill('조합 중인 장소'); await click('글 저장'); assert.equal(await review.evaluate(n => n === __review), true);
      await page.locator('[data-haedo-navigation] [data-haedo-section=home]').click(); assert.equal(await page.locator('.life-workbench').getAttribute('data-mode'), 'page');
      await title.dispatchEvent('compositionend'); await title.fill('산책한 장소'); await review.getByRole('textbox', { name: '출처 링크', exact: true }).fill('https://example.org/place');
      await more('HTML 읽기 파일 받기'); assert.match(await page.locator('.photo-status').innerText(), /첨부 입력을 먼저/); assert.equal((await read()).docs.find(v => v.id === primaryId).attachments.length, 1);
      assert.equal(await title.evaluate(n => n === document.activeElement), true);
      await page.locator('.photo-more > summary').click(); await review.scrollIntoViewIfNeeded(); await capture(page, 'attachment-review', [390, 820]); await click('첨부'); await stored();
      await page.locator('.photo-edit-attachment .photo-attachment-edit').first().click(); await page.getByRole('textbox', { name: '제목 또는 이름', exact: true }).fill('취소할 수정'); await click('입력 취소');
      await page.getByRole('button', { name: '산책한 장소 위로', exact: true }).click(); await stored();
      const d = (await read()).docs.find(v => v.id === primaryId); assert.equal(d.attachments[0].type, 'place'); assert.match(d.attachments[1].title, /literal/); assert.match(d.ops.map(v => typeof v.insert === 'string' ? v.insert : '').join(''), /두 번째 문장/); assert.deepEqual(await originals(), original);
      if (await page.locator('.photo-more').evaluate(n => n.open)) await page.locator('.photo-more > summary').click();
      await click('글 저장'); await page.locator('.photo-article').waitFor(); primary = (await read()).docs.find(v => v.id === primaryId); await capture(page, 'reading');
      primaryZip = (await getDownload(() => click('사진 포함 백업'))).bytes;
    });

    await check('Portable HTML contains exact original bytes and readable Korean/attribution, with no scripts, runtime URLs or automatic external requests', async () => {
      await page.evaluate(() => { window.__readData = FileReader.prototype.readAsDataURL; FileReader.prototype.readAsDataURL = function (blob) { FileReader.prototype.readAsDataURL = __readData; window.__continueExport = () => __readData.call(this, blob); }; });
      await page.locator('.photo-more > summary').click(); await capture(page, 'reading-menu', [390, 820]);
      const pending = page.waitForEvent('download'); pending.catch(() => {}); await more('HTML 읽기 파일 받기'); await page.locator('.photo-posts[aria-busy=true]').waitFor();
      await page.locator('[data-haedo-navigation] [data-haedo-section=tools]').click(); assert.equal(await page.locator('.life-workbench').getAttribute('data-mode'), 'page');
      await page.evaluate(() => __continueExport()); const file = await pending, bytes = await fs.readFile(await file.path()), html = bytes.toString('utf8');
      assert.equal(file.suggestedFilename(), 'haedo-post.html'); assert(!html.includes('blob:')); assert(!html.includes('<script')); assert(!html.includes('<button')); assert(html.includes('charset="utf-8"'));
      const imageData = [...html.matchAll(/src="data:image\/(?:png|jpeg|webp);base64,([^"]+)"/g)].map(v => hash(Buffer.from(v[1], 'base64')));
      assert.deepEqual(imageData, primary.photos.map(p => p.digest)); assert(!html.includes('개인 메모')); assert(!html.includes('비공개 주제'));
      const target = path.join(out, 'anonymous-post.html'); await fs.writeFile(target, bytes);
      portableContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const portableURL = base + '/.local/blog-writing-completion/anonymous-post.html';
      await portableContext.route('**/*', route => { if (route.request().url() === portableURL) return route.fallback(); report.external.push(route.request().url()); return route.abort(); });
      const reader = await portableContext.newPage(); observe(reader); await reader.goto(portableURL); await reader.locator('img').evaluateAll(nodes => Promise.all(nodes.map(n => n.decode())));
      assert.equal(await reader.locator('script,button,iframe').count(), 0); assert.equal(await reader.locator('h1').innerText(), primary.title); assert.equal(await reader.locator('img').first().evaluate(n => n.naturalWidth), 800);
      assert.match(await reader.locator('article').innerText(), /익명 저자/); assert.equal(await reader.locator('meta[http-equiv="Content-Security-Policy"]').count(), 1); await capture(reader, 'portable');
      await portableContext.close(); portableContext = null;
    });

    await check('The original viewer navigates the document order, downloads the current original and releases image URLs while returning focus to the viewed photo', async () => {
      await page.evaluate(() => { window.__revoked = []; const original = URL.revokeObjectURL; URL.revokeObjectURL = u => { __revoked.push(u); original.call(URL, u); }; });
      await page.locator('.photo-expand').first().click(); const dialog = page.getByRole('dialog'); await dialog.waitFor();
      const firstURL = await dialog.locator('img').getAttribute('src'); assert.equal(await dialog.getByRole('button', { name: '이전 사진', exact: true }).isDisabled(), true);
      await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => document.querySelector('.photo-viewer-position')?.textContent.startsWith('2 / 2'));
      assert.equal(await dialog.getByRole('button', { name: '다음 사진', exact: true }).isDisabled(), true); assert.equal(await page.evaluate(u => __revoked.includes(u), firstURL), true);
      const file = await getDownload(() => click('원본 내려받기')); assert.equal(hash(file.bytes), hash(Buffer.from(images[1].data, 'base64')));
      await click('이전 사진'); await click('원본 크기로 보기'); assert.equal(await page.locator('.photo-actual-size').count(), 1); await click('다음 사진'); await capture(page, 'viewer', [390, 820]);
      const lastURL = await dialog.locator('img').getAttribute('src'); await page.keyboard.press('Escape'); await page.locator('.photo-viewer').waitFor({ state: 'detached' }); assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await page.evaluate(u => __revoked.includes(u), lastURL), true);
      assert.equal(await page.locator('.photo-expand').nth(1).evaluate(n => n === document.activeElement), true);
    });

    await check('A separate draft copy preserves originals and attachments without changing the saved post or collection', async () => {
      await more('사본으로 이어 쓰기'); await page.locator('#photoTitle').waitFor(); const d = (await read()).docs.find(v => v.status === 'draft' && v.id !== legacy.id); copyId = d.id;
      assert.notEqual(copyId, primaryId); assert.equal(d.replaces, null); assert.deepEqual(d.attachments, primary.attachments); assert.deepEqual(d.photos.map(p => p.digest), primary.photos.map(p => p.digest));
      await page.locator('#photoTitle').fill('사본으로 이어쓴 기록'); await click('글 저장'); await page.locator('.photo-article').waitFor(); assert.deepEqual((await read()).docs.find(v => v.id === primaryId), primary); assert.deepEqual(await originals(), original);
    });

    await check('Archive failure leaves the reader and index unchanged; a retry hides the post from normal feed/search and explicit restoration keeps every byte', async () => {
      await click('사진 글 목록'); await openPost(page, primaryId); await page.locator('.photo-article').waitFor();
      await page.evaluate(() => { window.__put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { const r = __put.apply(this, args); if (args[0]?.key?.startsWith('photo-post:')) this.transaction.abort(); return r; }; window.__article = document.querySelector('.photo-article'); });
      await more('보관함으로 옮기기'); await page.locator('.photo-status[role=alert]').waitFor(); assert.equal(await page.locator('.photo-article').evaluate(n => n === __article), true); assert.equal((await read()).index.find(v => v.id === primaryId).archived, false);
      await page.evaluate(() => IDBObjectStore.prototype.put = __put); await more('보관함으로 옮기기'); await page.getByRole('button', { name: '목록으로 복원', exact: true }).waitFor(); assert.equal((await read()).docs.find(v => v.id === primaryId).archived, true);
      await click('사진 글 목록'); await page.locator('.photo-retained > summary').click(); await page.locator('.photo-archived-list [data-photo-post-id="' + primaryId + '"]').waitFor(); assert.equal(await page.locator('.wb-post-feed [data-photo-post-id="' + primaryId + '"]').count(), 0); await capture(page, 'archive');
      await nav(page, 'home'); await page.locator('#lifeFindOpen').click(); await page.locator('#lifeFind[aria-busy=false]').waitFor(); await page.locator('#lifeFindQuery').fill(primary.title); await page.locator('#lifeFind[aria-busy=false]').waitFor(); assert.equal(await page.locator('[data-focus-key="find:photo-post:' + primaryId + '"]').count(), 0);
      await go(); await openPost(page, primaryId); await page.locator('.photo-article').waitFor(); await click('목록으로 복원'); await page.getByRole('button', { name: '글 수정', exact: true }).waitFor();
      const active = (await read()).docs.find(v => v.id === primaryId); assert.equal(active.archived, false); assert.deepEqual(active.attachments, primary.attachments); assert.deepEqual(active.photos.map(p => p.digest), primary.photos.map(p => p.digest));
    });

    await check('Another tab archiving the original cannot be overwritten by an older edit; explicit new-copy recovery preserves both', async () => {
      await click('글 수정'); await page.locator('#photoTitle').fill('다른 탭 보관 후 새 글로 보존'); await stored();
      await go(other); await openPost(other, primaryId); await other.locator('.photo-article').waitFor(); await more('보관함으로 옮기기', other); await other.getByRole('button', { name: '목록으로 복원', exact: true }).waitFor();
      await click('글 저장'); await page.locator('.photo-status[role=alert]').waitFor(); assert.equal(await page.locator('#photoTitle').inputValue(), '다른 탭 보관 후 새 글로 보존'); await more('새 글로 저장'); await page.locator('.photo-article').waitFor();
      const docs = (await read()).docs; assert.equal(docs.find(v => v.id === primaryId).archived, true); assert(docs.some(v => v.title === '다른 탭 보관 후 새 글로 보존' && v.status === 'saved' && v.id !== primaryId));
    });

    await check('Empty drafts are reused and unfinished posts live in the explicit draft area rather than the normal saved feed', async () => {
      await click('사진 글 목록'); await click('글쓰기'); await page.locator('.ql-editor').fill('잠시 썼다 지울 문장'); await stored(); await page.locator('.ql-editor').fill(''); await stored();
      const before = await read(), empty = before.docs.find(v => v.status === 'draft' && !v.title.trim() && !v.photos.length && !v.attachments.length && !v.ops.some(op => typeof op.insert === 'string' && op.insert.trim()));
      assert(empty); await click('닫기'); await page.locator('.photo-retained > summary').click(); await page.locator('.photo-draft-list [data-photo-post-id="' + empty.id + '"]').waitFor(); assert.equal(await page.locator('.wb-post-feed [data-photo-post-id="' + empty.id + '"]').count(), 0);
      await click('글쓰기'); await page.locator('.ql-editor').waitFor(); await page.locator('#photoTitle').fill('같은 초안에서 이어 쓴 글'); await stored(); const after = await read(); assert.equal(after.index.length, before.index.length); assert.equal(after.docs.find(v => v.title === '같은 초안에서 이어 쓴 글').id, empty.id); await click('닫기');
      // Exercise the quick list -> draft -> list path before forcing lazy
      // covers to load, so decode waits cannot hide premature URL revocation.
      const covers = page.locator('.photo-entry-cover[src^="blob:"]:visible'); await covers.first().waitFor();
      for (const cover of await covers.all()) {
        const decoded = await cover.evaluate(async image => {
          image.scrollIntoView({ block: 'center', behavior: 'instant' }); await image.decode();
          return image.isConnected && image.complete && image.naturalWidth > 0;
        });
        assert.equal(decoded, true, 'A cover must remain reachable after draft transitions');
      }
    });

    await check('Both v1 and v2 ZIPs show a review before installing a new unarchived draft with remapped IDs and unchanged originals', async () => {
      for (const [name, buffer, expected] of [['v1', legacyZip, 0], ['v2', primaryZip, 2]]) {
        const before = await read(); if (!await page.locator('.photo-files').evaluate(n => n.open)) await page.locator('.photo-files > summary').click();
        await page.getByLabel('사진 글 ZIP 백업', { exact: true }).setInputFiles({ name: name + '.zip', mimeType: 'application/zip', buffer }); await page.getByRole('button', { name: '새 초안으로 복원', exact: true }).waitFor(); assert.equal((await read()).index.length, before.index.length);
        assert.equal(await page.locator('.photo-import .pp-attachment').count(), expected); if (expected) await capture(page, 'restore-review');
        await click('새 초안으로 복원'); await page.locator('.ql-editor').waitFor(); const d = (await read()).docs.find(v => !before.docs.some(old => old.id === v.id)); assert.equal(d.format, 'life-photo-post-v2'); assert.equal(d.status, 'draft'); assert.equal(d.archived, false); assert.equal(d.attachments.length, expected); assert.equal(d.photos[0].digest, legacy.digest);
        if (expected) assert.deepEqual(d.attachments, primary.attachments); await click('닫기');
      }
    });

    await check('Legacy records and private collection context remain exact; another account cannot read or overwrite the rich post', async () => {
      assert.deepEqual(await originals(), original); const old = (await read()).docs.find(v => v.id === legacy.id); assert.equal(old.format, 'life-photo-post-v1'); assert.equal(old.revision, legacy.revision); assert.equal(old.photos[0].digest, legacy.digest);
      const result = await page.evaluate(async ({ cloud, id, owner }) => {
        const w = await HaedoLife.Shell.storage.getActive(), foreign = HaedoLife.Storage.forAccount({ projectUrl: cloud, userId: owner });
        try { await foreign.readPhotoPost(w, id); return 'unexpected'; } catch (e) { return e.code; } finally { foreign.dispose(); }
      }, { cloud, id: primaryId, owner: accounts.b.id }); assert.equal(result, 'workspace_access_denied');
    });
    assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } catch (e) {
    report.failure = { check: currentCheck, message: String(e.stack || e) };
    await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {}); throw e;
  } finally {
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log('CLEANUP report written');
    await portableContext?.close(); console.log('CLEANUP portable context closed');
    await browser.close(); console.log('CLEANUP browser closed');
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
