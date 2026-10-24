'use strict';
// Real owner UI/SDK/IndexedDB and PNG bytes. Authentication is synthetic only.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, ready, makeContext } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, session, base, cloud } = require('./life-sync-browser.cjs');

const output = path.resolve(__dirname, '../.local/nine-board-compose');
const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [],
  scope: 'Real local owner UI, isolated IndexedDB, canvas PNG bytes and synthetic account HTTP. Linux Chromium viewport simulations; no production, Google OAuth, Apple hardware or publication.' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const forbidden = ['PRIVATE_BOARD_INTRO', 'PRIVATE_AREA_NOTE', 'PRIVATE_ITEM_REASON', 'PRIVATE_REFERENCE_QUOTE',
  'PRIVATE_SOURCE_BODY', 'PRIVATE_SOURCE_PATH', 'EXCLUDED_AREA_ONLY', 'unselected_area', 'compose_board', 'selected_area'];

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); report.node = process.version;
  let active = null;

  async function fixture() {
    const server = new FakeCloud(), device = 'nine-compose-' + report.checks.length;
    const context = await makeContext(browser, server, device, accounts.a, { viewport: { width: 1440, height: 1000 } });
    active = context; const remoteWrites = [];
    context.on('request', request => {
      const u = new URL(request.url());
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
          (/\/storage\/v1\/object/.test(u.pathname) || /\/functions\/v1\//.test(u.pathname) ||
           /\/rest\/v1\/rpc\/(?:life_blog_(?:save|publish|unpublish|prepare_asset)|life_sync_put)/.test(u.pathname))) remoteWrites.push(u.pathname);
    });
    await context.route('**/*', route => {
      const origin = new URL(route.request().url()).origin;
      if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
      report.external.push(origin); return route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    const observe = p => { p.on('pageerror', e => report.pageErrors.push(e.message));
      p.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text()); }); };
    observe(page);
    await page.goto(base + '/index.html?section=records&view=page'); await ready(page);
    const seed = await page.evaluate(async () => {
      const C = HaedoLife.Core, s = HaedoLife.Shell.storage, w = await s.getActive(), initial = await s.read(w);
      const raw = '\ufeffPRIVATE_SOURCE_BODY\r\nPRIVATE_REFERENCE_QUOTE 🌱\r\n끝';
      const imported = await C.prepareImport({ origin: 'obsidian', title: '기존 원문', text: raw,
        fileName: 'PRIVATE_SOURCE_PATH.md', url: 'https://example.org/private-original', authorRelation: 'unknown' }, initial);
      const changes = C.buildImportChanges(initial, imported);
      const result = await s.commitLocal({ workspaceId: w, baseRevision: initial.revision, operationId: C.id(), changes });
      if (result.status !== 'stored') throw Error('Synthetic original could not be installed');
      const b = await s.read(w), start = raw.indexOf('PRIVATE_REFERENCE_QUOTE');
      const ref = await HaedoLife.SourceReference.build({ bundle: b, sourceId: imported.source.id,
        versionId: imported.version.id, locator: { start, end: start + 'PRIVATE_REFERENCE_QUOTE 🌱'.length } });
      const longTitle = '끝까지 보존할 긴 한글 제목과 줄바꿈 없는 문장 '.repeat(8) + '전체제목끝';
      const sourceURL = 'https://example.org/selected/book?edition=original&long=' + 'a'.repeat(550) + '&tail=FULL_SOURCE_TAIL';
      const item = (title, creator, url, type = 'book') => ({ ...HaedoLife.NineBoard.snapshot({ type, title, creator, url }), reason: 'PRIVATE_ITEM_REASON' });
      const selected = [item(longTitle, '선택한 한글 저자', sourceURL), item('같이 걷는 노래', '선택한 음악가', '', 'music'),
        { ...item('직접 고른 원문 제목', '선택한 기록 작성자', 'https://example.org/selected/exact', 'other'), reference: { kind: 'source', value: ref } }];
      const board = { id: 'compose_board', title: '여행에서 다시 고른 아홉 가지', intro: 'PRIVATE_BOARD_INTRO', areas: [
        { id: 'unselected_area', title: 'EXCLUDED_AREA_ONLY', note: 'PRIVATE_AREA_NOTE', items: [item('EXCLUDED_AREA_ONLY', 'EXCLUDED_AREA_ONLY', 'https://example.org/EXCLUDED_AREA_ONLY')] },
        { id: 'selected_area', title: '책과 음악 · 선택한 여행 영역', note: 'PRIVATE_AREA_NOTE', items: selected } ] };
      const nine = await s.readNineBoard(w); nine.format = 'life-nine-board-v2'; nine.boards.push(board);
      await s.saveNineBoard(w, nine, nine.revision);
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
      canvas.getContext('2d').fillRect(0, 0, 80, 60);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      for (const status of ['saved', 'draft']) {
        const doc = HaedoLife.PhotoPost.create(C.id); doc.title = '이미 보관한 ' + status + ' 여행 글';
        doc.status = status; doc.ops = [{ insert: '기존 글의 본문과 사진을 바꾸지 않는다.\n' }];
        if (status === 'saved') {
          const photo = await HaedoLife.PhotoPost.readPhoto(new File([blob], 'existing.png', { type: 'image/png' }), C.id);
          doc.photos = [photo]; doc.ops.push({ insert: { photo: { id: photo.id, caption: '기존 원본 설명', alt: '기존 원본' } } }, { insert: '\n' });
        }
        await s.savePhotoPost(w, doc, 0);
      }
      return { workspaceId: w, board, longTitle, sourceURL, ref };
    });
    async function go() {
      await page.goto(base + '/index.html?section=records&view=page'); await ready(page);
      await page.getByRole('button', { name: '9칸 구성', exact: true }).click();
      await page.locator('.nb-status').waitFor();
      await page.locator('.nb-area-nav [data-area-id="selected_area"]').click();
      await page.locator('.nb-files > summary').click();
      await page.locator('#nbImageArea').selectOption('selected_area');
    }
    await go();
    return { page, context, server, remoteWrites, seed, go, observe };
  }

  const read = page => page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, w = await s.getActive(), rows = await s.listPhotoPosts(w);
    const hash = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join('');
    const docs = await Promise.all(rows.map(async row => {
      const doc = await s.readPhotoPost(w, row.id);
      return { ...doc, photos: await Promise.all(doc.photos.map(async ({ blob, ...photo }) => ({ ...photo, actualDigest: await hash(blob) }))),
        evidence: await s.readPostEvidence(w, row.id) };
    }));
    // Inspect only synthetic photo keys for this exact fixture workspace. This
    // catches orphan documents even if an index write was aborted or omitted.
    const photoKeys = await new Promise((resolve, reject) => {
      const request = indexedDB.open('life-tools-v1'); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, tx = db.transaction('meta', 'readonly'), get = tx.objectStore('meta').getAll();
        get.onerror = () => reject(get.error); get.onsuccess = () => {
          const keys = get.result.map(v => v.key).filter(k => k === 'photo-posts:' + w || k.startsWith('photo-post:' + w + ':') || k.startsWith('post-evidence:' + w + ':')).sort();
          tx.oncomplete = () => { db.close(); resolve(keys); };
        }; };
    });
    return { bundle: await s.read(w), nine: await s.readNineBoard(w), workbench: await s.readWorkbench(w),
      collection: await s.readCollection(w), drafts: await s.readPageDrafts(w), stages: await s.listStages(w), docs, photoKeys };
  });
  async function accountReady(page, id) {
    // Auth and the scoped storage object are available before a new account's
    // workspace is mounted. Snapshot only its revealed, initialized workspace.
    // Await each async storage read on Node; a Promise is not a ready predicate.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await page.evaluate(async id => {
        const shell = HaedoLife.Shell, storage = shell.storage;
        if (HaedoAuth.user?.id !== id || shell.sync?.getAccount()?.userId !== id ||
            storage?.account?.userId !== id || document.querySelector('#lifeApp')?.hidden !== false) return false;
        const workspaceId = await storage.getActive();
        return !!workspaceId && shell.storage === storage && HaedoAuth.user?.id === id && shell.sync?.getAccount()?.userId === id;
      }, id)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw Error('Verified account workspace did not finish mounting');
  }
  async function review(f) {
    await f.page.locator('#nbComposeReviewOpen').click();
    await f.page.locator('#nbComposeReview[data-state=ready]').waitFor();
  }
  async function created(f) {
    await f.page.locator('#photoTitle').waitFor();
    await f.page.waitForFunction(() => document.querySelector('.photo-posts')?.getAttribute('aria-busy') === 'false');
  }
  function unchanged(after, before) {
    for (const key of ['bundle', 'nine', 'workbench', 'collection', 'drafts', 'stages']) assert.deepEqual(after[key], before[key], key + ' changed');
    for (const doc of before.docs) assert.deepEqual(after.docs.find(v => v.id === doc.id), doc, 'Existing document changed');
  }
  async function verifyDraft(f, before) {
    const after = await read(f.page); unchanged(after, before);
    const added = after.docs.filter(d => !before.docs.some(old => old.id === d.id)); assert.equal(added.length, 1);
    const doc = added[0]; assert.equal(doc.status, 'draft'); assert.equal(doc.replaces, null); assert.equal(doc.revision, 1);
    assert.equal(doc.archived, false); assert.equal(doc.photos.length, 1); assert.deepEqual(doc.attachments, []);
    assert.equal(doc.photos[0].type, 'image/png'); assert.equal(doc.photos[0].width, 1800); assert.equal(doc.photos[0].height, 2100);
    assert.equal(doc.photos[0].digest, doc.photos[0].actualDigest);
    const body = doc.ops.map(op => typeof op.insert === 'string' ? op.insert : '').join('');
    for (const text of [f.seed.board.title, f.seed.board.areas[1].title, f.seed.longTitle, f.seed.sourceURL, '선택한 한글 저자', '같이 걷는 노래', '선택한 음악가', '직접 고른 원문 제목']) assert(body.includes(text), 'Missing complete selected text');
    const value = JSON.stringify(doc); for (const marker of [...forbidden, f.seed.ref.sourceId, f.seed.ref.sourceVersionId]) assert(!value.includes(marker), 'Private or unselected value copied');
    assert.deepEqual(doc.evidence.refs, []); assert.equal(await f.page.locator('#photoTitle').inputValue(), doc.title);
    assert.equal(await f.page.locator('.photo-status').getAttribute('role'), 'status');
    assert.deepEqual(f.remoteWrites, []); assert.equal(f.server.writes().length, 0);
    return doc;
  }
  async function capture(page, scene, selector) {
    const inspect = require('./home-entry-browser.cjs').inspectHome;
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(inspect, selector);
      assert.equal(metrics.horizontalOverflow, false); assert.deepEqual(metrics.unnamed, []); assert.deepEqual(metrics.contrastFailures, []);
      const file = scene + '-' + width + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: true });
      report.visual.push({ scene, width, file, metrics });
    }
  }
  const check = async (name, run) => {
    if (process.env.NINE_COMPOSE_MATCH && !new RegExp(process.env.NINE_COMPOSE_MATCH).test(name)) return;
    console.log('START ' + name); await run(); report.checks.push(name); console.log('PASS ' + name);
    await active?.close(); active = null;
  };
  try {
    await check('Selected second area creates only a fresh private draft with complete Korean metadata and byte-identical original PNG', async () => {
      const f = await fixture(), before = await read(f.page);
      const download = f.page.waitForEvent('download'); await f.page.getByRole('button', { name: '선택 영역 PNG 받기', exact: true }).click();
      const png = await fs.readFile(await (await download).path()); assert.equal(png.subarray(1, 4).toString(), 'PNG');
      assert.equal(png.readUInt32BE(16), 1800); assert.equal(png.readUInt32BE(20), 2100);
      // PNG file selection is independent of the displayed area used to write.
      await f.page.locator('#nbImageArea').selectOption('unselected_area');
      await review(f); assert.deepEqual(await read(f.page), before, 'Review itself saved a document');
      const text = await f.page.locator('.nb-compose-text').innerText(); assert(text.includes(f.seed.longTitle)); assert(text.includes(f.seed.sourceURL));
      for (const marker of forbidden) assert(!text.includes(marker));
      await capture(f.page, 'review', '#nbComposeReview');
      await f.page.locator('#nbComposeCreate').click(); await created(f); const doc = await verifyDraft(f, before);
      assert.equal(doc.photos[0].actualDigest, sha(png));
      const pixels = await f.page.evaluate(async ({ id, expected }) => {
        const s = HaedoLife.Shell.storage, d = await s.readPhotoPost(await s.getActive(), id);
        const decode = async blob => { const img = await createImageBitmap(blob), c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const x = c.getContext('2d'); x.drawImage(img, 0, 0); img.close(); const data = x.getImageData(0, 0, c.width, c.height).data;
          return { width: c.width, height: c.height, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), n => n.toString(16).padStart(2, '0')).join('') }; };
        const bytes = Uint8Array.from(atob(expected), c => c.charCodeAt(0)); return { actual: await decode(d.photos[0].blob), expected: await decode(new Blob([bytes], { type: 'image/png' })) };
      }, { id: doc.id, expected: png.toString('base64') }); assert.deepEqual(pixels.actual, pixels.expected); report.png = { originalSHA256: sha(png), pixelsSHA256: pixels.actual.hash, width: 1800, height: 2100 };
      await capture(f.page, 'draft-editor', '.photo-editor');
      await f.page.getByRole('button', { name: '닫기', exact: true }).click();
      await f.page.locator('#nbComposeReviewOpen').waitFor();
      assert.equal(await f.page.locator('.nb-area-nav [data-area-id="selected_area"]').getAttribute('aria-pressed'), 'true');
      await f.page.locator('#nbComposeOpen').click(); await created(f);
      assert.deepEqual((await read(f.page)).docs.find(d => d.id === doc.id), doc);
      await f.page.reload(); await ready(f.page); const reopened = await read(f.page); unchanged(reopened, before);
      assert.deepEqual(reopened.docs.find(d => d.id === doc.id), doc); assert.equal(reopened.docs.filter(d => d.status === 'saved').length, before.docs.filter(d => d.status === 'saved').length);
      const ordinary = before.docs.find(value => value.status === 'saved');
      const compatibility = f.page.locator('.wb-page-compatibility');
      if (!await compatibility.evaluate(node => node.open)) await compatibility.locator(':scope > summary').click();
      await f.page.locator('[data-photo-post-id="' + ordinary.id + '"]').click();
      await f.page.locator('.photo-read-heading').waitFor();
      assert.equal(await f.page.getByRole('button', { name: '9칸 구성으로 돌아가기', exact: true }).count(), 0);
      assert.deepEqual((await read(f.page)).docs.find(value => value.id === ordinary.id), ordinary);
    });
    await check('A PNG encoding failure preserves the selected board and retries without partially creating a draft', async () => {
      const f = await fixture(), before = await read(f.page);
      await f.page.evaluate(() => { window.__toBlob = HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob = callback => callback(null); });
      await f.page.locator('#nbComposeReviewOpen').click(); await f.page.locator('.nb-error[role=alert]').waitFor();
      assert.deepEqual(await read(f.page), before); assert.equal(await f.page.locator('#nbImageArea').inputValue(), 'selected_area');
      await capture(f.page, 'png-failure', '.nb-image-export');
      await f.page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = __toBlob; });
      await review(f); await f.page.locator('#nbComposeCreate').click(); await created(f); await verifyDraft(f, before);
    });
    await check('An actual IndexedDB transaction abort installs neither document nor index and keeps the same PNG review for retry', async () => {
      const f = await fixture(); await review(f); const before = await read(f.page);
      await f.page.evaluate(() => { window.__put = IDBObjectStore.prototype.put; window.__composeAborts = 0;
        window.__sameReview = document.querySelector('#nbComposeReview');
        IDBObjectStore.prototype.put = function (...args) { const request = __put.apply(this, args);
          if (this.name === 'meta' && args[0]?.key?.startsWith('photo-posts:')) { __composeAborts++; this.transaction.abort(); } return request; }; });
      await f.page.locator('#nbComposeCreate').click(); await f.page.locator('.nb-error[role=alert]').waitFor();
      assert(await f.page.evaluate(() => __composeAborts > 0)); assert.deepEqual(await read(f.page), before);
      assert.equal(await f.page.locator('#nbComposeReview').evaluate(n => n === __sameReview), true);
      await f.page.evaluate(() => { IDBObjectStore.prototype.put = __put; });
      await f.page.locator('#nbComposeCreate').click(); await created(f); await verifyDraft(f, before);
    });
    await check('Unapplied item input remains visible and blocks composing instead of silently accepting or discarding it', async () => {
      const f = await fixture(), before = await read(f.page);
      await f.page.locator('[data-area-id=selected_area]').click();
      await f.page.locator('.nb-grid [data-item-index="0"]').getByRole('button', { name: / · 수정$/ }).click();
      await f.page.locator('#nbItemTitle').fill('아직 반영하지 않은 한글 입력');
      if (!await f.page.locator('.nb-files').evaluate(n => n.open)) await f.page.locator('.nb-files > summary').click();
      await f.page.locator('#nbComposeReviewOpen').click(); await f.page.locator('.nb-error[role=alert]').waitFor();
      assert.equal(await f.page.locator('#nbItemTitle').inputValue(), '아직 반영하지 않은 한글 입력'); assert.deepEqual(await read(f.page), before);
      await f.page.getByRole('button', { name: '입력 취소', exact: true }).click();
      if (!await f.page.locator('.nb-files').evaluate(n => n.open)) await f.page.locator('.nb-files > summary').click();
      await f.page.locator('#nbImageArea').selectOption('selected_area'); await review(f);
    });
    await check('Rapid repeated confirmation while real PNG hashing is held creates exactly one draft', async () => {
      const f = await fixture(); await review(f); const before = await read(f.page);
      await f.page.evaluate(() => { window.__digest = SubtleCrypto.prototype.digest; window.__composeDigestHeld = false;
        SubtleCrypto.prototype.digest = async function (algorithm, data) { const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          if (!__composeDigestHeld && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) { __composeDigestHeld = true; await new Promise(resolve => window.__composeDigestRelease = resolve); }
          return __digest.call(this, algorithm, data); }; });
      await f.page.locator('#nbComposeCreate').evaluate(button => { button.click(); button.click(); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      await f.page.waitForFunction(() => window.__composeDigestHeld === true); assert.equal(await f.page.locator('#nbComposeCreate').isDisabled(), true);
      assert.deepEqual(await read(f.page), before); await f.page.evaluate(() => __composeDigestRelease());
      await created(f); await f.page.evaluate(() => { SubtleCrypto.prototype.digest = __digest; }); await verifyDraft(f, before);
    });
    await check('A real second-tab board revision change rejects a reviewed draft atomically and a fresh review succeeds', async () => {
      const f = await fixture(); await review(f); const other = await f.context.newPage(); f.observe(other);
      await other.goto(base + '/index.html?section=records&view=page'); await ready(other);
      await other.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(), nine = await s.readNineBoard(w); nine.boards[0].title += ' · 다른 창에서 바뀜'; await s.saveNineBoard(w, nine, nine.revision); });
      const before = await read(f.page); await f.page.locator('#nbComposeCreate').click(); await f.page.locator('.nb-error[role=alert]').waitFor();
      assert.deepEqual(await read(f.page), before); await other.close();
      await f.page.evaluate(() => {
        window.__get = IDBObjectStore.prototype.get; window.__composeReloadAborts = 0; window.__staleTitle = document.querySelector('#nbTitle');
        IDBObjectStore.prototype.get = function (key) {
          const request = __get.call(this, key);
          if (!__composeReloadAborts && this.name === 'meta' && typeof key === 'string' && key.startsWith('nine-board:')) {
            __composeReloadAborts++; this.transaction.abort();
          }
          return request;
        };
      });
      await f.page.locator('#nbComposeReload').click();
      await f.page.waitForFunction(() => window.__composeReloadAborts === 1);
      await f.page.locator('#nbComposeReload:not([disabled])').waitFor();
      assert.equal(await f.page.locator('#nbTitle').evaluate(node => node === __staleTitle), true);
      assert.equal(await f.page.locator('#nbTitle').inputValue(), f.seed.board.title);
      await f.page.evaluate(() => { IDBObjectStore.prototype.get = __get; });
      assert.deepEqual(await read(f.page), before);
      await f.page.locator('#nbComposeReload').click();
      await f.page.waitForFunction(() => document.querySelector('#nbTitle')?.value.endsWith(' · 다른 창에서 바뀜'));
      assert.deepEqual(await read(f.page), before); await review(f);
      await f.page.locator('#nbComposeCreate').click(); await created(f); await verifyDraft(f, before);
    });
    await check('A held old-account PNG cannot render or save after the verified account changes', async () => {
      const f = await fixture(), before = await read(f.page);
      await f.page.evaluate(() => { window.__toBlob = HTMLCanvasElement.prototype.toBlob; window.__composeBlobHeld = false;
        HTMLCanvasElement.prototype.toBlob = function (callback, ...args) { return __toBlob.call(this, blob => { __composeBlobHeld = true; window.__composeBlobRelease = () => callback(blob); }, ...args); }; });
      await f.page.locator('#nbComposeReviewOpen').click(); await f.page.waitForFunction(() => window.__composeBlobHeld === true);
      await f.page.evaluate(async value => { await HaedoAuth.client.auth.setSession({ access_token: value.access_token, refresh_token: value.refresh_token }); await HaedoAuth.verify(); }, session(accounts.b));
      await accountReady(f.page, accounts.b.id);
      const accountB = await read(f.page); await f.page.evaluate(async () => { __composeBlobRelease(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); HTMLCanvasElement.prototype.toBlob = __toBlob; });
      assert.deepEqual(await read(f.page), accountB); assert.equal(await f.page.locator('#nbComposeReview').count(), 0);
      assert(!(await f.page.locator('body').innerText()).includes(f.seed.longTitle));
      await f.page.evaluate(async value => { await HaedoAuth.client.auth.setSession({ access_token: value.access_token, refresh_token: value.refresh_token }); await HaedoAuth.verify(); }, session(accounts.a));
      await accountReady(f.page, accounts.a.id);
      assert.deepEqual(await read(f.page), before); assert.deepEqual(f.remoteWrites, []); assert.equal(f.server.writes().length, 0);
    });
    await check('A committed draft survives its first read failing and reopens from its receipt without saving a second draft', async () => {
      const f = await fixture(); await review(f); const before = await read(f.page);
      await f.page.evaluate(({ workspaceId, existingIds }) => {
        window.__get = IDBObjectStore.prototype.get; window.__put = IDBObjectStore.prototype.put;
        window.__composeCommitted = false; window.__composeReadFailures = 0;
        const excluded = new Set(existingIds.map(id => 'photo-post:' + workspaceId + ':' + id));
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === 'meta' && args[0]?.key === 'photo-posts:' + workspaceId)
            this.transaction.addEventListener('complete', () => { __composeCommitted = true; }, { once: true });
          return __put.apply(this, args);
        };
        IDBObjectStore.prototype.get = function (key) {
          if (__composeCommitted && !__composeReadFailures && this.name === 'meta' && typeof key === 'string' &&
              key.startsWith('photo-post:' + workspaceId + ':') && !excluded.has(key)) {
            __composeReadFailures++; throw new DOMException('Synthetic first committed draft read failure', 'UnknownError');
          }
          return __get.call(this, key);
        };
      }, { workspaceId: f.seed.workspaceId, existingIds: before.docs.map(doc => doc.id) });
      await f.page.locator('#nbComposeCreate').click();
      await f.page.waitForFunction(() => window.__composeReadFailures === 1);
      await f.page.locator('.nb-error[role=alert]').filter({ hasText: '초안은 보관했지만 열지 못했습니다' }).waitFor();
      await f.page.evaluate(() => { IDBObjectStore.prototype.get = __get; IDBObjectStore.prototype.put = __put; });
      const committed = await read(f.page); unchanged(committed, before);
      assert.equal(committed.docs.length, before.docs.length + 1);
      await f.page.locator('#nbComposeOpen').click(); await created(f);
      const doc = await verifyDraft(f, before); assert.deepEqual(await read(f.page), committed);
      await f.page.locator('.ql-editor').focus(); await f.page.keyboard.press('Control+End');
      await f.page.keyboard.press('Enter'); await f.page.keyboard.insertText('직접 덧붙인 여행 생각과 한글 입력');
      await f.page.locator('.photo-status').filter({ hasText: '브라우저에 자동 임시저장됨' }).waitFor();
      const edited = (await read(f.page)).docs.find(value => value.id === doc.id);
      assert(edited.revision > 1);
      assert(edited.ops.some(op => typeof op.insert === 'string' && op.insert.includes('직접 덧붙인 여행 생각과 한글 입력')));
      await f.page.getByRole('button', { name: '닫기', exact: true }).click();
      await f.page.locator('#nbComposeOpen').click(); await created(f);
      assert((await f.page.locator('.ql-editor').innerText()).includes('직접 덧붙인 여행 생각과 한글 입력'));
      assert.deepEqual((await read(f.page)).docs.find(value => value.id === doc.id), edited);
      await f.page.getByRole('button', { name: '글 저장', exact: true }).click();
      await f.page.locator('.photo-read-heading').waitFor();
      await f.page.locator('#photoServerStatus[data-state="synced"]').waitFor();
      await f.page.locator('.photo-posts').getByRole('button', { name: '글 수정', exact: true }).click();
      await f.page.locator('#photoTitle').fill('다시 다듬은 영역 여행 글');
      await f.page.getByRole('button', { name: '글 저장', exact: true }).click();
      await f.page.locator('.photo-read-heading').filter({ hasText: '다시 다듬은 영역 여행 글' }).waitFor();
      await f.page.locator('#photoServerStatus[data-state="synced"]').waitFor();
      const replaced = await read(f.page), currentDoc = replaced.docs.find(value => value.title === '다시 다듬은 영역 여행 글');
      assert(currentDoc && currentDoc.id !== doc.id); assert.equal(currentDoc.status, 'saved');
      assert.deepEqual(currentDoc.ops, edited.ops); assert.deepEqual(currentDoc.photos, edited.photos);
      assert.equal(replaced.docs.find(value => value.id === doc.id), undefined, 'Explicit replacement still listed the superseded ID');
      await f.page.getByRole('button', { name: '9칸 구성으로 돌아가기', exact: true }).click();
      await f.page.locator('#nbComposeReviewOpen').waitFor();
      assert.equal(await f.page.locator('.nb-area-nav [data-area-id="selected_area"]').getAttribute('aria-pressed'), 'true');
      // Navigate inside the app; a reload intentionally does not retain a UI receipt.
      await f.page.locator('[data-haedo-navigation] [data-haedo-section="home"]').click();
      await f.page.locator('#homeComposition[aria-busy=false]').waitFor();
      await f.page.locator('[data-haedo-navigation] [data-haedo-section="records"]').click();
      await f.page.waitForFunction(() => document.querySelector('#nbComposeOpen') || document.querySelector('#wbPageNine'));
      if (!await f.page.locator('#nbComposeOpen').isVisible()) await f.page.locator('#wbPageNine').click();
      await f.page.locator('#nbComposeOpen').click();
      await f.page.locator('.photo-read-heading').filter({ hasText: '다시 다듬은 영역 여행 글' }).waitFor();
      const saved = await read(f.page); unchanged(saved, before); assert.equal(saved.docs.length, before.docs.length + 1);
      assert.deepEqual(saved.docs.find(value => value.id === currentDoc.id), currentDoc);
      assert.equal(saved.docs.filter(value => value.status === 'draft').length, before.docs.filter(value => value.status === 'draft').length);
      const stored = await f.page.evaluate(async id => {
        const storage = HaedoLife.Shell.storage, workspaceId = await storage.getActive();
        const state = await storage.readBlogSyncState(workspaceId, id);
        const manifest = HaedoLife.Blog.pack(HaedoLife.PhotoPost.compact(await storage.readPhotoPost(workspaceId, id)));
        manifest.id = state.remoteId; manifest.replaces = null;
        return { state, manifest };
      }, currentDoc.id);
      assert.equal(stored.state.enabled, true); assert.equal(stored.state.status, 'synced');
      assert.equal(stored.state.localRevision, currentDoc.revision); assert.equal(stored.state.pending, null);
      assert.equal(stored.state.remoteId, doc.id, 'Replacing a saved local ID must retain the original private server identity');
      const remote = f.server.posts.get(accounts.a.id + ':' + stored.state.remoteId);
      assert(remote); assert.equal(f.server.posts.size, 1); assert.equal(remote.owner, accounts.a.id);
      assert.equal(remote.workspace_id, f.seed.workspaceId); assert.equal(remote.revision, 2);
      assert.deepEqual(remote.data, stored.manifest); assert.equal(remote.publication, null);
      assert.equal(f.server.saves().length, 2); assert.equal(new Set(f.server.saves().map(call => call.body.p_operation_id)).size, 2);
      for (const photo of remote.data.photos) {
        const original = f.server.originals.get(remote.assets[photo.id].path);
        assert(original); assert.equal(sha(original.bytes), photo.digest); assert.equal(original.bytes.length, photo.size);
        assert.equal(original.type, photo.type); assert.equal(original.bytes.readUInt32BE(16), photo.width); assert.equal(original.bytes.readUInt32BE(20), photo.height);
      }
      assert.equal(f.server.assetCalls.filter(call => call.method === 'POST').length, 1, 'The unchanged original must not be uploaded twice');
      for (const marker of [...forbidden, f.seed.ref.sourceId, f.seed.ref.sourceVersionId]) assert(!JSON.stringify(remote.data).includes(marker), 'Private or unselected material reached the private post');
      assert(f.remoteWrites.length > 0);
      assert(f.remoteWrites.every(url => /^\/rest\/v1\/rpc\/life_blog_(?:save|prepare_asset)$/.test(url) || url.startsWith('/storage/v1/object/haedo-blog-originals/')));
      assert(f.server.blogCalls.every(call => !/publish/.test(call.rpc)), 'Saving must never publish or withdraw');
      assert.equal(f.server.writes().length, 0, 'Saving a post must not upload the source workspace');
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } catch (error) {
    report.pass = false; report.error = error.stack;
    await active?.pages().at(-1)?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(cause => { report.captureError = cause.message; });
    throw error;
  } finally { await active?.close(); await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
