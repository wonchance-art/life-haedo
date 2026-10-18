'use strict';
// Actual owner UI/SDK/IndexedDB -> isolated PostgreSQL RPC -> anonymous reader.
process.env.BASE_URL ||= 'http://127.0.0.1:4213';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { LocalSQLNineCloud } = require('./nine-public-sql-fixture.cjs');
const { accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const output = path.resolve(__dirname, '../.local/nine-public');
const sha = value => createHash('sha256').update(value).digest('hex');
const hidden = ['PRIVATE_BOARD_TITLE', 'PRIVATE_BOARD_INTRO', 'PRIVATE_AREA_NOTE', 'PRIVATE_ITEM_REASON', 'PRIVATE_REFERENCE_QUOTE',
  'PRIVATE_SOURCE_BODY', 'PRIVATE_SOURCE_PATH', 'PRIVATE_SOURCE_TITLE', 'OTHER_AREA_ONLY', 'OTHER_BOARD_ONLY'];

async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(output, { recursive: true });
  const server = new LocalSQLNineCloud({ container: process.env.BLOG_POSTGRES_CONTAINER, database: process.env.BLOG_POSTGRES_DATABASE + '_nine_browser_' + process.pid });
  await server.prepare(); await server.initialize();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], sourceVisits: [], covers: [], expectedErrors: 0,
    browser: browser.version(), node: process.version,
    scope: 'Actual owner UI/SDK/IndexedDB and existing isolated PostgreSQL page RPCs; anonymous DOM, synthetic Auth and explicitly intercepted external source/cover HTTP. No production, Google OAuth, Apple hardware, merge or deployment claims.' };
  const contexts = [], pages = []; let fixture, before, publicId, publicURL, selectedSource = null, coverMode = 'off';
  function observe(page) {
    pages.push(page); page.setDefaultTimeout(25000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      if (message.location().url.startsWith(cloud) && /Failed to load resource:.*(?:ERR_FAILED|404)/.test(message.text())) report.expectedErrors++;
      else report.consoleErrors.push(message.text());
    });
  }
  async function context(name, account) {
    const value = await makeContext(browser, server, name, account, { viewport: { width: 1440, height: 1000 } }); contexts.push(value);
    await value.route('**/*', async route => {
      const request = route.request(), u = new URL(request.url());
      if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback();
      if (selectedSource && request.url() === selectedSource && request.isNavigationRequest()) {
        report.sourceVisits.push({ url: request.url(), referrer: request.headers().referer || null, authorization: request.headers().authorization || null });
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="ko"><title>합성 출처</title><p>명시적으로 연 합성 출처</p></html>' });
      }
      if (u.hostname === 'covers.openlibrary.org' && coverMode !== 'off') {
        report.covers.push({ url: request.url(), referrer: request.headers().referer || null, mode: coverMode });
        if (coverMode === 'failure') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'image/png', 'cache-control': 'no-store' }, body: 'synthetic-undecodable-cover' });
        return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'image/png', 'cache-control': 'no-store' }, body: Buffer.from(fixture.cover, 'base64') });
      }
      report.external.push(request.url()); return route.abort();
    });
    return value;
  }
  const owner = await context('nine-owner', accounts.a), anon = await context('nine-visitor', null);
  await anon.addInitScript(() => {
    for (const key of ['localStorage', 'sessionStorage', 'indexedDB']) Object.defineProperty(window, key, { configurable: true, get() { throw Error('Anonymous reader accessed ' + key); } });
    const native = setTimeout; window.__ninePolls = [];
    window.setTimeout = function (callback, delay, ...args) { if (delay === 30000) __ninePolls.push(callback); return native.call(this, callback, delay, ...args); };
  });
  const page = await owner.newPage(), visitor = await anon.newPage(); observe(page); observe(visitor);
  const busy = () => page.waitForFunction(() => document.getElementById('nineShare')?.getAttribute('aria-busy') === 'false');
  const click = async id => { await page.locator(id).click(); await busy(); };
  const publicState = value => visitor.waitForFunction(value => document.getElementById('ninePublicStatus')?.dataset.state === value, value);
  const putCount = () => server.pageRequests.filter(row => row.name === 'life_public_page_put').length;
  const readPublic = () => server.rpc(null, 'life_public_page_read', { p_public_id: publicId });
  async function go(target = page, areaId = fixture.areaId) {
    await target.goto(base + '/index.html?section=records&view=page'); await ready(target); await settle(target);
    await target.getByRole('button', { name: '9칸 구성', exact: true }).click(); await target.locator('#nbSelect').waitFor();
    await target.locator('#nbSelect').selectOption(fixture.boardId);
    await target.locator('.nb-area-nav [data-area-id="' + areaId + '"]').click();
  }
  async function open(target = page) { await target.locator('#nbPublicReviewOpen').click(); await target.locator('#nineShare').waitFor(); await target.waitForFunction(() => document.getElementById('nineShare')?.getAttribute('aria-busy') === 'false'); }
  async function original(target = page) {
    return target.evaluate(async () => {
      const s = HaedoLife.Shell.storage, ws = await s.getActive();
      const docs = await Promise.all((await s.listPhotoPosts(ws)).map(async row => {
        const doc = await s.readPhotoPost(ws, row.id);
        return { ...doc, photos: await Promise.all(doc.photos.map(async ({ blob, ...photo }) => ({ ...photo, actualDigest: await HaedoLife.PhotoPost.digest(blob) }))), evidence: await s.readPostEvidence(ws, row.id) };
      }));
      return { ws, bundle: await s.read(ws), nine: await s.readNineBoard(ws), workbench: await s.readWorkbench(ws),
        collection: await s.readCollection(ws), drafts: await s.readPageDrafts(ws), stages: await s.listStages(ws), docs };
    });
  }
  async function capture(target, scene) {
    for (const width of [1440, 820, 390]) {
      await target.setViewportSize({ width, height: 1000 });
      await target.evaluate(() => { document.activeElement?.blur(); scrollTo({ top: 0, left: 0, behavior: 'instant' }); document.getElementById('nineShare')?.scrollTo(0, 0); });
      const metrics = await target.evaluate(inspect);
      assert.equal(metrics.horizontalOverflow, false, scene + ': overflow');
      for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ':' + key);
      metrics.gridRows = await target.locator('.np-grid').evaluateAll(grids => grids.map(grid => [...grid.children].map(cell => {
        const item = cell.querySelector('.np-tile,.np-empty'), bounds = item.getBoundingClientRect(); return { top: bounds.top, height: bounds.height };
      })));
      for (const cells of metrics.gridRows) for (let start = 0; start < cells.length; start += 3) {
        const row = cells.slice(start, start + 3); assert(Math.max(...row.map(cell => cell.height)) - Math.min(...row.map(cell => cell.height)) < 1, scene + ': consistent row height');
      }
      if (scene === 'owner-preview-grid') await target.locator('#nineSharePreview .np-grid').scrollIntoViewIfNeeded();
      const file = scene + '-' + width + '.png'; await target.screenshot({ path: path.join(output, file), fullPage: !scene.startsWith('owner-') }); report.visual.push({ scene, width, file, metrics });
    }
    await target.setViewportSize({ width: 1440, height: 1000 });
  }
  async function prepare(title = '책과 음악으로 다시 찾는 여행', intro = '직접 공개하기로 정한 취향 소개 🌱') {
    await page.getByLabel('공개 9칸 제목', { exact: true }).fill(title);
    await page.getByLabel('공개 소개', { exact: true }).fill(intro);
    await click('#nineSharePrepare'); await page.locator('#nineSharePreview').waitFor();
  }
  function privateExcluded(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const word of [...hidden, fixture.ws, fixture.boardId, fixture.areaId, fixture.otherAreaId, fixture.reference.sourceId, fixture.reference.sourceVersionId, fixture.reference.contentHash]) assert(!text.includes(word), 'Private value entered publication: ' + word);
  }
  const check = async (name, run) => {
    console.log('START ' + name);
    try { await run(); report.checks.push(name); console.log('PASS ' + name); }
    catch (error) {
      for (const [name, target] of [['owner', page], ['visitor', visitor]]) {
        await target.screenshot({ path: path.join(output, name + '-failure.png'), fullPage: true }).catch(() => {});
        const state = await target.evaluate(() => ({ text: document.body.innerText, status: document.getElementById('ninePublicStatus')?.outerHTML, share: document.getElementById('nineShare')?.outerHTML })).catch(() => null);
        if (state) await fs.writeFile(path.join(output, name + '-failure.json'), JSON.stringify(state, null, 2));
      }
      throw error;
    }
  };
  try {
    await page.goto(base + '/index.html'); await ready(page);
    fixture = await page.evaluate(async () => {
      const L = HaedoLife, C = L.Core, s = L.Shell.storage, ws = await s.getActive(), initial = await s.read(ws);
      const raw = '\ufeffPRIVATE_SOURCE_BODY\r\nPRIVATE_REFERENCE_QUOTE 🌱\r\n끝';
      const imported = await C.prepareImport({ origin: 'obsidian', title: 'PRIVATE_SOURCE_TITLE', text: raw, fileName: 'PRIVATE_SOURCE_PATH.md', url: 'https://example.org/private-original', authorRelation: 'other' }, initial);
      const installed = await s.commitLocal({ workspaceId: ws, baseRevision: initial.revision, operationId: C.id(), changes: C.buildImportChanges(initial, imported) });
      if (installed.status !== 'stored') throw Error('Synthetic source could not be installed');
      const bundle = await s.read(ws), start = raw.indexOf('PRIVATE_REFERENCE_QUOTE');
      const reference = await L.SourceReference.build({ bundle, sourceId: imported.source.id, versionId: imported.version.id, locator: { start, end: start + 'PRIVATE_REFERENCE_QUOTE 🌱'.length } });
      const board = L.NineBoard.create(C.id); board.title = 'PRIVATE_BOARD_TITLE'; board.intro = 'PRIVATE_BOARD_INTRO';
      const area = board.areas[0]; area.title = '책과 음악 · 선택 영역'; area.note = 'PRIVATE_AREA_NOTE';
      const longTitle = '전체를 읽을 수 있어야 하는 긴 한글 제목과 출처 '.repeat(8) + '제목끝🌱';
      const sourceURL = 'https://example.org/selected/book?edition=old&source=' + 'a'.repeat(550) + '&tail=FULL_SOURCE_TAIL';
      const titles = [longTitle, '명시적으로만 표지를 여는 책', '사진 없이 듣는 음악', '<img src="https://unexpected.example/x" onerror="alert(1)"> 문자 그대로', '함께 본 영화', '직접 고른 장소', '다시 읽는 글', '작업에 쓰는 도구', '마지막 아홉 번째 작품 🌱'];
      const types = ['book', 'book', 'music', 'other', 'film', 'place', 'article', 'tool', 'artwork'];
      for (let index = 0; index < titles.length; index++) {
        const url = index === 0 ? sourceURL : index === 1 ? 'https://openlibrary.org/books/OL7353617M' : index === 2 ? '' : 'https://example.org/selected/' + index;
        const item = L.NineBoard.snapshot({ title: titles[index], creator: '직접 고른 창작자 ' + index, type: types[index], url }); item.reason = 'PRIVATE_ITEM_REASON';
        if (index === 0) item.reference = { kind: 'source', value: reference }; area.items.push(item);
      }
      const single = { id: C.id(), title: '한 항목만 고른 영역', note: 'PRIVATE_AREA_NOTE', items: [L.NineBoard.snapshot({ type: 'music', title: '한 칸의 음악', creator: '한 사람', url: '' })] };
      const other = { id: C.id(), title: 'OTHER_AREA_ONLY', note: 'PRIVATE_AREA_NOTE', items: [L.NineBoard.snapshot({ title: 'OTHER_AREA_ONLY', type: 'other', creator: '', url: '' })] };
      const empty = { id: C.id(), title: '아직 고르지 않은 영역', note: '', items: [] }; board.areas.push(single, other, empty);
      const otherBoard = L.NineBoard.create(C.id); otherBoard.title = 'OTHER_BOARD_ONLY';
      const nine = await s.readNineBoard(ws); nine.format = 'life-nine-board-v2'; nine.boards.push(board, otherBoard); await s.saveNineBoard(ws, nine, nine.revision);
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 100; const g = canvas.getContext('2d'); g.fillStyle = '#145b50'; g.fillRect(0, 0, 80, 100);
      const photoBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const doc = L.PhotoPost.create(C.id); doc.status = 'saved'; doc.title = '원래 보관한 사진 글'; doc.ops = [{ insert: '원래 본문은 공개하지 않는다.\n' }];
      const photo = await L.PhotoPost.readPhoto(new File([photoBlob], 'existing.png', { type: 'image/png' }), C.id); doc.photos = [photo]; doc.ops.push({ insert: { photo: { id: photo.id, caption: '원래 설명', alt: '원래 사진' } } }, { insert: '\n' }); await s.savePhotoPost(ws, doc, 0);
      const savedBoard = (await s.readNineBoard(ws)).boards.find(value => value.id === board.id), bytes = new Uint8Array(await (await L.NineBoard.png(savedBoard, area.id)).arrayBuffer());
      return { ws, boardId: board.id, areaId: area.id, singleAreaId: single.id, otherAreaId: other.id, emptyAreaId: empty.id, reference, titles, sourceURL,
        attachments: area.items.map(item => item.attachment), html: L.NineBoard.html(savedBoard), json: L.NineBoard.backup([savedBoard]), compose: L.NineBoard.composeContent(savedBoard, area.id),
        png: Array.from(bytes), cover: btoa(String.fromCharCode(...new Uint8Array(await photoBlob.arrayBuffer()))) };
    });
    const oldPage = server.rpc(accounts.a.id, 'life_public_page_put', { p_workspace_id: fixture.ws, p_expected_revision: 0, p_operation_id: randomUUID(), p_action: 'publish', p_snapshot: { format: 'life-share-v1', title: '원래 공개한 페이지', intro: null, entries: [] } });
    await go(); before = await original();
    await check('A selected saved area is fully reviewed without private metadata, then explicitly published with exact lost-response receipt replay', async () => {
      await page.locator('.nb-area-nav [data-area-id="' + fixture.emptyAreaId + '"]').click(); assert.equal(await page.locator('#nbPublicReviewOpen').isDisabled(), false);
      await open(); assert.equal(await page.locator('#nineShareStatus').getAttribute('data-state'), 'missing'); await page.locator('#nineShareClose').click();
      await page.locator('.nb-area-nav [data-area-id="' + fixture.areaId + '"]').click(); await open();
      assert.equal(await page.getByLabel('공개 소개', { exact: true }).inputValue(), '');
      assert.equal(await page.locator('#nineShareConsent').isChecked(), false); assert.equal(putCount(), 0);
      await prepare(); privateExcluded(await page.locator('#nineSharePreview').innerText());
      const preview = await page.locator('#nineSharePreview').innerText(); for (const title of fixture.titles) assert(preview.includes(title));
      for (const [index, item] of fixture.attachments.entries()) {
        await page.locator('#nineSharePreview .np-tile[data-index="' + index + '"]').click();
        assert.equal(await page.locator('#nineSharePreview .np-detail-title').innerText(), item.title);
        assert((await page.locator('#nineSharePreview .np-detail-meta').innerText()).includes(item.creator));
        const source = page.locator('#nineSharePreview .np-source-link');
        if (item.url) { assert.equal(await source.getAttribute('href'), item.url); assert.equal(await source.innerText(), item.url); }
        else assert.equal(await source.count(), 0);
      }
      await page.locator('#nineSharePreview .np-tile[data-index="0"]').click(); privateExcluded(await page.locator('#nineSharePreview').innerText());
      assert.equal(putCount(), 0, 'Preparing a preview cannot publish');
      await capture(page, 'owner-review');
      await capture(page, 'owner-preview-grid');
      await page.locator('#nineSharePreview .np-detail-close').click();
      await page.locator('#nineSharePreview .np-tile[data-index="0"]').scrollIntoViewIfNeeded();
      const ownerPosition = await page.locator('#nineShare').evaluate(dialog => ({ windowY: scrollY, dialogY: dialog.scrollTop }));
      await page.locator('#nineSharePreview .np-tile[data-index="0"]').click();
      await page.waitForFunction(() => document.activeElement?.classList.contains('np-detail-title'));
      await page.locator('#nineSharePreview .np-detail-close').click(); await page.waitForFunction(() => document.activeElement?.dataset.index === '0');
      const ownerReturned = await page.locator('#nineShare').evaluate(dialog => ({ windowY: scrollY, dialogY: dialog.scrollTop }));
      assert(Math.abs(ownerReturned.windowY - ownerPosition.windowY) < 1); assert(Math.abs(ownerReturned.dialogY - ownerPosition.dialogY) < 1, 'Owner preview restores its nested dialog scroll');
      await page.locator('#nineShareConsent').check(); server.pageFailure = 'ack'; await click('#nineSharePublish');
      await page.locator('.nine-share-error:not([hidden])').waitFor(); await click('#nineShareRetry');
      const link = page.getByRole('link', { name: '공개 9칸 열기', exact: true }); await link.waitFor(); publicURL = await link.getAttribute('href'); publicId = new URL(publicURL).searchParams.get('nine'); assert(publicId);
      const writes = server.pageRequests.filter(row => row.name === 'life_public_page_put'); assert.equal(writes.length, 2); assert.deepEqual(writes[0].args, writes[1].args);
      const wire = readPublic().snapshot; privateExcluded(wire); assert.deepEqual(wire.entries[0].attachments, fixture.attachments);
      assert.equal(wire.entries.length, 1); assert.equal(wire.entries[0].note, null); assert.deepEqual(wire.entries[0].parts, []);
      assert.deepEqual(await original(), before); assert.equal(server.rpc(accounts.a.id, 'life_public_page_get', { p_workspace_id: fixture.ws }).publicId, oldPage.publicId);
      assert.equal(server.blogRequests.length, 0); assert.equal(server.assetRequests.length, 0);
    });
    await check('An anonymous visitor reads all nine ordered items, full details and explicit source without opening personal storage or external media automatically', async () => {
      await visitor.goto(publicURL); await publicState('published'); privateExcluded(await visitor.locator('#ninePublicContent').innerText());
      assert.equal(await visitor.locator('.np-grid .np-cell').count(), 9); assert.equal(await visitor.locator('.np-tile').count(), 9);
      assert.deepEqual(await visitor.locator('.np-tile').evaluateAll(nodes => nodes.map(n => Number(n.dataset.index))), [0,1,2,3,4,5,6,7,8]);
      assert.equal(await visitor.locator('#ninePublicContent img').count(), 0); assert.deepEqual(report.external, []); assert.deepEqual(report.covers, []);
      await capture(visitor, 'visitor-grid');
      const tile = visitor.locator('.np-tile[data-index="0"]'); await tile.focus(); await visitor.keyboard.press('Enter'); await visitor.locator('#ninePublicDetail').waitFor();
      assert.equal(await visitor.locator('.np-detail-title').innerText(), fixture.titles[0]);
      const source = visitor.locator('#ninePublicDetail .np-source-link'); assert.equal(await source.getAttribute('href'), fixture.sourceURL); assert((await source.innerText()).includes(fixture.sourceURL));
      assert.equal(await source.getAttribute('target'), '_blank'); assert.match(await source.getAttribute('rel'), /noopener/); assert.match(await source.getAttribute('rel'), /noreferrer/);
      await capture(visitor, 'visitor-detail');
      selectedSource = fixture.sourceURL; const popup = visitor.waitForEvent('popup'); await source.click(); const destination = await popup; await destination.waitForLoadState('domcontentloaded');
      assert.equal(destination.url(), fixture.sourceURL); assert.equal(report.sourceVisits.length, 1); assert.equal(report.sourceVisits[0].referrer, null); assert.equal(report.sourceVisits[0].authorization, null); await destination.close(); selectedSource = null;
      await visitor.getByRole('button', { name: '9칸으로 돌아가기', exact: true }).click(); await visitor.waitForFunction(() => document.activeElement?.dataset.index === '0');
      await visitor.locator('.np-tile[data-index="2"]').click(); assert.equal(await visitor.locator('#ninePublicDetail .np-source-link').count(), 0);
      const beforePoll = await visitor.locator('#ninePublicContent .np-document').elementHandle();
      await visitor.evaluate(() => { const n = document.querySelector('.np-detail-title'); const selection = getSelection(), range = document.createRange(); range.selectNodeContents(n); selection.removeAllRanges(); selection.addRange(range); });
      const selection = await visitor.evaluate(() => getSelection().toString());
      await visitor.evaluate(() => __ninePolls.at(-1)()); await publicState('published');
      assert(await beforePoll.evaluate(node => node.isConnected && node === document.querySelector('#ninePublicContent .np-document'))); assert.equal(await visitor.evaluate(() => getSelection().toString()), selection);
    });
    await check('A changed saved area invalidates old consent while an explicit fresh preview updates the same public copy', async () => {
      await prepare(); await page.locator('#nineShareConsent').check(); const oldWire = readPublic(), count = putCount();
      await page.evaluate(async value => { const s = HaedoLife.Shell.storage, state = await s.readNineBoard(value.ws); state.boards.find(b => b.id === value.boardId).areas.find(a => a.id === value.areaId).items[8].attachment.title = '다른 탭에서 고친 아홉 번째'; await s.saveNineBoard(value.ws, state, state.revision); }, fixture);
      const changed = await original(); await click('#nineSharePublish');
      assert.equal(putCount(), count); assert.deepEqual(readPublic(), oldWire); assert.equal(await page.locator('#nineShareConsent').isChecked(), false);
      await prepare(); await page.locator('#nineShareConsent').check(); await click('#nineSharePublish');
      assert.equal(readPublic().publicId, oldWire.publicId); assert.equal(readPublic().snapshot.entries[0].attachments[8].title, '다른 탭에서 고친 아홉 번째');
      assert.deepEqual(await original(), changed); before = changed;
      await visitor.locator('#ninePublicRefresh').click(); await publicState('published'); assert((await visitor.locator('#ninePublicContent').innerText()).includes('다른 탭에서 고친 아홉 번째'));
    });
    await check('Two actual owner tabs require a fresh review after public CAS conflict and preserve the competing publication', async () => {
      const other = await owner.newPage(); observe(other);
      try {
        await prepare('먼저 검토한 제목', '현재 창의 공개 소개'); await page.locator('#nineShareConsent').check();
        await go(other); await open(other); await other.getByLabel('공개 9칸 제목', { exact: true }).fill('다른 탭에서 먼저 게시한 제목');
        await other.getByLabel('공개 소개', { exact: true }).fill('다른 탭에서 먼저 검토한 공개 소개'); await other.locator('#nineSharePrepare').click();
        await other.waitForFunction(() => document.getElementById('nineShare')?.getAttribute('aria-busy') === 'false'); await other.locator('#nineShareConsent').check(); await other.locator('#nineSharePublish').click();
        await other.waitForFunction(() => document.getElementById('nineShare')?.getAttribute('aria-busy') === 'false'); const competing = readPublic();
        await click('#nineSharePublish'); assert.deepEqual(readPublic(), competing); assert.equal(await page.locator('#nineShareConsent').isChecked(), false);
        const count = putCount(); if (!await page.locator('#nineSharePublish').isDisabled()) await click('#nineSharePublish'); assert.equal(putCount(), count); assert.deepEqual(readPublic(), competing);
        await click('#nineShareRefresh'); await prepare('새 검토로 명시 갱신한 제목'); await page.locator('#nineShareConsent').check(); await click('#nineSharePublish');
        assert.equal(readPublic().snapshot.title, '새 검토로 명시 갱신한 제목'); assert.deepEqual(await original(), before);
      } finally { await other.close(); }
    });
    await check('Book covers require explicit opt-in and a one-item area leaves eight noninteractive empty slots', async () => {
      await visitor.locator('#ninePublicRefresh').click(); await publicState('published'); assert.deepEqual(report.covers, []);
      coverMode = 'failure'; await visitor.locator('.np-media-toggle').click(); await visitor.locator('.np-tile[data-index="1"]').scrollIntoViewIfNeeded();
      await visitor.locator('.np-cover[data-state=error]').waitFor(); assert.equal(await visitor.locator('.np-cover img').count(), 0);
      assert((await visitor.locator('.np-tile[data-index="1"]').innerText()).includes(fixture.titles[1]));
      await visitor.locator('.np-media-toggle').click(); coverMode = 'success'; await visitor.locator('.np-media-toggle').click();
      await visitor.locator('.np-tile[data-index="1"]').scrollIntoViewIfNeeded();
      await visitor.waitForFunction(() => [...document.querySelectorAll('.np-cover img')].some(image => image.complete && image.naturalWidth === 80 && image.naturalHeight === 100));
      assert.equal(report.covers.length, 2); assert(report.covers.every(row => row.url === 'https://covers.openlibrary.org/b/olid/OL7353617M-M.jpg?default=false' && row.referrer === null));
      await visitor.locator('.np-media-toggle').click(); assert.equal(await visitor.locator('.np-cover img').count(), 0); coverMode = 'off';
      await page.locator('#nineShareClose').click(); await go(page, fixture.singleAreaId); await open();
      await prepare('한 항목의 취향'); await page.locator('#nineShareConsent').check(); await click('#nineSharePublish');
      const singleURL = await page.getByRole('link', { name: '공개 9칸 열기', exact: true }).getAttribute('href');
      await visitor.goto(singleURL); await publicState('published'); assert.equal(await visitor.locator('.np-grid .np-cell').count(), 9);
      assert.equal(await visitor.locator('.np-tile').count(), 1); assert.equal(await visitor.locator('.np-empty').count(), 8);
      assert.equal(await visitor.locator('.np-empty button,.np-empty a,.np-empty [tabindex]').count(), 0); assert.equal(await visitor.locator('.np-media-toggle').count(), 0);
      await visitor.locator('.np-tile').click(); await visitor.locator('.np-source-empty').waitFor();
      assert.deepEqual(await original(), before);
      // Removing the last local item must not strand an already public copy.
      await page.locator('#nineShareClose').click();
      await page.getByRole('button', { name: '한 칸의 음악 · 수정', exact: true }).click(); await page.getByRole('button', { name: '영역에서 빼기', exact: true }).click();
      await page.locator('.nb-status[data-state=saved]').waitFor(); const emptied = await original();
      for (const key of Object.keys(before).filter(key => key !== 'nine')) assert.deepEqual(emptied[key], before[key]);
      assert.equal(emptied.nine.boards.find(b => b.id === fixture.boardId).areas.find(a => a.id === fixture.singleAreaId).items.length, 0);
      assert.equal(await page.locator('#nbPublicReviewOpen').isDisabled(), false); await open();
      assert.equal(await page.locator('#nineShareStatus').getAttribute('data-state'), 'published');
      const count = putCount(); await click('#nineSharePrepare'); await page.locator('.nine-share-error:not([hidden])').waitFor(); assert.equal(putCount(), count);
      await page.locator('#nineShareRevokeConsent').check(); await click('#nineShareRevoke');
      await visitor.locator('#ninePublicRefresh').click(); await publicState('missing'); before = emptied;
      await page.locator('#nineShareClose').click(); await go(); await open();
      await visitor.goto(publicURL); await publicState('published');
    });
    await check('Revocation removes the anonymous grid and details while original files and draft composition remain reusable', async () => {
      await page.locator('#nineShareRevokeConsent').check(); await click('#nineShareRevoke'); assert.equal(readPublic().status, 'missing');
      await visitor.locator('#ninePublicRefresh').click(); await publicState('missing'); assert.equal(await visitor.locator('#ninePublicContent').innerText(), ''); assert.equal(await visitor.locator('#ninePublicContent img').count(), 0);
      assert.deepEqual(await original(), before); assert.equal(server.rpc(accounts.a.id, 'life_public_page_get', { p_workspace_id: fixture.ws }).publicId, oldPage.publicId);
      await page.locator('#nineShareClose').click(); await go();
      await page.locator('.nb-files > summary').click(); await page.locator('#nbImageArea').selectOption(fixture.areaId);
      const expected = await page.evaluate(async value => { const board = (await HaedoLife.Shell.storage.readNineBoard(value.ws)).boards.find(b => b.id === value.boardId); return { json: HaedoLife.NineBoard.backup([board]), html: HaedoLife.NineBoard.html(board), compose: HaedoLife.NineBoard.composeContent(board, value.areaId), png: Array.from(new Uint8Array(await (await HaedoLife.NineBoard.png(board, value.areaId)).arrayBuffer())) }; }, fixture);
      for (const [label, kind] of [['현재 구성 JSON 받기','json'], ['HTML 보기 파일 받기','html'], ['선택 영역 PNG 받기','png']]) {
        const download = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click(); const bytes = await fs.readFile(await (await download).path());
        if (kind === 'json') assert.deepEqual(JSON.parse(bytes.toString()), expected.json); else if (kind === 'html') assert.equal(bytes.toString(), expected.html); else { assert.equal(sha(bytes), sha(Buffer.from(expected.png))); assert.equal(bytes.readUInt32BE(16), 1800); assert.equal(bytes.readUInt32BE(20), 2100); }
      }
      await page.locator('#nbComposeReviewOpen').click(); await page.locator('#nbComposeReview[data-state=ready]').waitFor();
      assert((await page.locator('#nbComposeReview').innerText()).includes(expected.compose.text)); await page.locator('#nbComposeCancel').click(); assert.deepEqual(await original(), before);
    });
    await check('Late old-account preparation cannot restore a private review in the verified new account', async () => {
      await open();
      // Hold the real RPC state response after it has executed in the isolated DB.
      let held = null, release; const released = new Promise(resolve => release = resolve);
      await owner.route(cloud + '/rest/v1/rpc/life_public_page_get', async route => {
        const request = route.request(); if (request.method() === 'OPTIONS') return route.fallback();
        const args = request.postDataJSON(), ownerId = server.owner(request), value = server.rpc(ownerId, 'life_public_page_get', args);
        server.pageRequests.push({ name: 'life_public_page_get', owner: ownerId, device: 'nine-held-read', args: structuredClone(args) });
        held = true; await released; await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(value) });
      });
      const preparation = page.locator('#nineSharePrepare').click();
      for (let n = 0; !held && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 20)); assert(held, 'The actual state read was held');
      await page.evaluate(async value => { await HaedoAuth.client.auth.setSession({ access_token: value.access_token, refresh_token: value.refresh_token }); await HaedoAuth.verify(); }, session(accounts.b));
      await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id);
      await ready(page); await settle(page);
      const accountB = await original(); release(); await preparation; await owner.unroute(cloud + '/rest/v1/rpc/life_public_page_get');
      await page.waitForFunction(() => !document.getElementById('nineShare')); assert.deepEqual(await original(), accountB);
      assert(!(await page.locator('body').innerText()).includes('PRIVATE_BOARD_TITLE'));
      await page.evaluate(async value => { await HaedoAuth.client.auth.setSession({ access_token: value.access_token, refresh_token: value.refresh_token }); await HaedoAuth.verify(); }, session(accounts.a));
      await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.a.id);
      await ready(page); await settle(page); assert.deepEqual(await original(), before);
    });
    await check('A public area deleted from private storage remains discoverable and revocable through the existing public page manager', async () => {
      const prior = await original();
      await page.evaluate(async value => {
        const s = HaedoLife.Shell.storage, state = await s.readNineBoard(value.ws);
        state.boards.find(b => b.id === value.boardId).areas.find(a => a.id === value.emptyAreaId).items.push(HaedoLife.NineBoard.snapshot({ type: 'book', title: '삭제 후에도 철회할 수 있는 공개 항목', creator: '직접 고른 사람', url: 'https://example.org/revocable' }));
        await s.saveNineBoard(value.ws, state, state.revision);
      }, fixture);
      await go(page, fixture.emptyAreaId); await open(); await prepare('영역 삭제 뒤 관리할 공개 9칸');
      await page.locator('#nineShareConsent').check(); await click('#nineSharePublish');
      const address = await page.getByRole('link', { name: '공개 9칸 열기', exact: true }).getAttribute('href'), id = new URL(address).searchParams.get('nine');
      await visitor.goto(address); await publicState('published'); await page.locator('#nineShareClose').click();
      await page.evaluate(async value => {
        const s = HaedoLife.Shell.storage, state = await s.readNineBoard(value.ws), board = state.boards.find(b => b.id === value.boardId);
        board.areas = board.areas.filter(area => area.id !== value.emptyAreaId); await s.saveNineBoard(value.ws, state, state.revision);
      }, fixture);
      const deleted = await original(); for (const key of Object.keys(prior).filter(key => key !== 'nine')) assert.deepEqual(deleted[key], prior[key]);
      assert(!deleted.nine.boards.find(b => b.id === fixture.boardId).areas.some(a => a.id === fixture.emptyAreaId));
      await page.locator('[data-haedo-navigation] [data-haedo-section="manage"]').click();
      await page.getByText('공개 페이지 관리', { exact: true }).click(); await page.locator('#wbPublicPages').waitFor();
      const row = page.locator('.wb-public-page[data-workspace-id="' + fixture.emptyAreaId + '"]'); await row.waitFor();
      assert.equal(await row.locator('h3').innerText(), '영역 삭제 뒤 관리할 공개 9칸');
      await row.locator('.wb-public-revoke').click(); await row.locator('.wb-public-revoke-confirm').waitFor();
      assert.equal(server.rpc(null, 'life_public_page_read', { p_public_id: id }).status, 'published', 'First confirmation does not revoke');
      await row.locator('.wb-public-revoke-confirm').click(); await row.waitFor({ state: 'detached' });
      assert.equal(server.rpc(null, 'life_public_page_read', { p_public_id: id }).status, 'missing');
      await visitor.locator('#ninePublicRefresh').click(); await publicState('missing'); assert.equal(await visitor.locator('#ninePublicContent').innerText(), '');
      assert.deepEqual(await original(), deleted); assert.equal(server.rpc(accounts.a.id, 'life_public_page_get', { p_workspace_id: fixture.ws }).publicId, oldPage.publicId);
    });
    await check('Reopening restores the exact explicitly public title and introduction while status refresh preserves current edits', async () => {
      await go(); await open(); const prior = await original();
      const first = { title: '처음 직접 쓴 공개 제목 🌱', intro: '직접 썼던 공개 소개\n두 번째 줄도 보존합니다.' };
      await prepare(first.title, first.intro); await page.locator('#nineShareConsent').check(); await click('#nineSharePublish');
      const address = await page.getByRole('link', { name: '공개 9칸 열기', exact: true }).getAttribute('href'), id = new URL(address).searchParams.get('nine');
      const read = () => server.rpc(null, 'life_public_page_read', { p_public_id: id });
      assert.equal(read().snapshot.title, first.title); assert.equal(read().snapshot.intro, first.intro);
      const count = putCount(); await page.locator('#nineShareClose').click(); await go(); await open();
      assert.equal(await page.getByLabel('공개 9칸 제목', { exact: true }).inputValue(), first.title);
      assert.equal(await page.getByLabel('공개 소개', { exact: true }).inputValue(), first.intro); assert.equal(putCount(), count, 'Reopening only reads the existing public copy');
      const edited = { title: '이어서 고친 공개 제목', intro: '입력 중 새로 고친 소개 🌱\n상태 조회가 덮어쓰지 않습니다.' };
      await page.getByLabel('공개 9칸 제목', { exact: true }).fill(edited.title); await page.getByLabel('공개 소개', { exact: true }).fill(edited.intro);
      await click('#nineShareRefresh');
      assert.equal(await page.getByLabel('공개 9칸 제목', { exact: true }).inputValue(), edited.title);
      assert.equal(await page.getByLabel('공개 소개', { exact: true }).inputValue(), edited.intro);
      assert.equal(putCount(), count); assert.equal(read().snapshot.title, first.title); assert.equal(read().snapshot.intro, first.intro);
      await prepare(edited.title, edited.intro); await page.locator('#nineShareConsent').check(); await click('#nineSharePublish');
      assert.equal(read().publicId, id); assert.equal(read().snapshot.title, edited.title); assert.equal(read().snapshot.intro, edited.intro); assert.deepEqual(await original(), prior);
      await page.locator('#nineShareClose').click(); await open();
      assert.equal(await page.getByLabel('공개 9칸 제목', { exact: true }).inputValue(), edited.title); assert.equal(await page.getByLabel('공개 소개', { exact: true }).inputValue(), edited.intro);
      await visitor.goto(address); await publicState('published'); assert.equal(await visitor.locator('.np-title').innerText(), edited.title); assert.equal(await visitor.locator('.np-description').innerText(), edited.intro);
      assert.equal(server.rpc(accounts.a.id, 'life_public_page_get', { p_workspace_id: fixture.ws }).publicId, oldPage.publicId);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
    assert.equal(server.blogRequests.length, 0); assert.equal(server.assetRequests.length, 0); report.pass = true;
  } catch (error) { report.pass = false; report.failure = error.stack; throw error; }
  finally { for (const value of contexts) await value.close().catch(() => {}); await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
