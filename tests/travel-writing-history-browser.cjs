/* Real Linux Chromium history return, actual SDK/IDB, synthetic Auth only.
 * No Apple hardware, native IME, production session or synthetic lifecycle claim.
 * PW_MODULE_PATH=<installed playwright> CHROMIUM_PATH=<chromium> node tests/travel-writing-history-browser.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const controlledDrift = process.env.NATIVE_SCROLL_DRIFT === undefined ? 0 : Number(process.env.NATIVE_SCROLL_DRIFT);
assert.ok(controlledDrift === 0 || controlledDrift === 20, 'NATIVE_SCROLL_DRIFT supports only 0 or 20 pixels');
const output = path.resolve(process.env.TRAVEL_HISTORY_OUTPUT || path.join(root, controlledDrift ? '.local/travel-writing-history-drift' : '.local/travel-writing-history'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const critical = ['/assets/platform-auth.js', '/assets/life/shell.js', '/assets/life/ui.js',
  '/assets/life/photo-post-ui.js', '/assets/life/workbench-ui.js'];
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };

async function publicServer(report) {
  // Exact release allowlist, not a directory server: .local/tests/private files
  // cannot be fetched. Keep ordinary cache headers so this is a native BFCache test.
  const shell = (await fs.readFile(path.join(root, 'sw.js'), 'utf8'))
    .match(/const SHELL\s*=\s*(\[[\s\S]*?\]);/);
  assert.ok(shell, 'Release public shell allowlist must exist');
  const allowed = new Set([...shell[1].matchAll(/['"]\.\/([^'"]*)['"]/g)]
    .map(match => '/' + (match[1] || 'index.html')));
  const realRoot = await fs.realpath(root);
  const server = http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); return response.end(); }
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/native-neutral') {
        response.writeHead(200, { 'content-type': mime['.html'] });
        return response.end(request.method === 'HEAD' ? '' :
          '<!doctype html><meta charset="utf-8"><title>합성 외출 페이지</title><h1>같은 출처의 임시 페이지</h1>');
      }
      if (pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
      const publicPath = pathname === '/' ? '/index.html' : pathname;
      if (!allowed.has(publicPath) || /[\\\0]/.test(publicPath) || publicPath.split('/').includes('..')) throw Error('Not public');
      // platformContext intercepts this before serving. Never expose disk config.
      if (publicPath === '/assets/platform-config.js') throw Error('Synthetic config interception required');
      const file = await fs.realpath(path.join(root, publicPath.slice(1)));
      if (!file.startsWith(realRoot + path.sep)) throw Error('Outside public root');
      const bytes = await fs.readFile(file);
      if (critical.includes(publicPath)) report.sourceHashes[publicPath] = digest(bytes);
      response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? '' : bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return server;
}

function installHistoryObserver({ drift = 0 } = {}) {
  window.__travelDocument = crypto.randomUUID();
  window.__travelEvents = [];
  window.__travelFocus = [];
  window.__travelDrift = [];
  const sample = (label, event) => {
    const active = document.activeElement;
    __travelFocus.push({ label, at: performance.now(), trusted: event?.isTrusted ?? null, captionActive: !!window.__travelCaption && active === __travelCaption,
      activeTag: active?.tagName || null, start: active?.selectionStart ?? null,
      end: active?.selectionEnd ?? null, direction: active?.selectionDirection ?? null,
      scrollX, scrollY, privateHidden: document.querySelector('#lifeApp')?.hidden ?? null });
  };
  window.__travelSample = sample;
  addEventListener('beforeunload', event => sample('beforeunload', event), { capture: true });
  for (const type of ['pagehide', 'pageshow']) addEventListener(type, event => {
    if (type === 'pagehide' && event.persisted && event.isTrusted && drift) {
      // Controlled fault injection on a genuine native lifecycle event. This
      // does not dispatch events or turn a simulated event into BFCache proof.
      sample('pagehide-before-controlled-drift', event);
      const caption = window.__travelCaption, focusBefore = document.activeElement === caption;
      caption?.focus({ preventScroll: true });
      const focusAfter = document.activeElement === caption;
      sample('pagehide-after-controlled-focus', event);
      const before = [scrollX, scrollY], top = Math.min(scrollY + drift, Math.max(0, document.documentElement.scrollHeight - innerHeight));
      scrollTo({ left: scrollX, top, behavior: 'instant' });
      __travelDrift.push({ at: performance.now(), trusted: event.isTrusted, persisted: event.persisted,
        requested: drift, focusBefore, focusAfter, captionConnected: !!caption?.isConnected, before, after: [scrollX, scrollY] });
    }
    __travelEvents.push({ type, at: performance.now(), persisted: event.persisted, trusted: event.isTrusted, documentId: __travelDocument });
    sample(type, event);
  }, { capture: true });
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const storage = HaedoLife.Shell.storage, ws = await storage.getActive();
    const rows = await storage.listPhotoPosts(ws);
    if (rows.length !== 1) throw Error('Expected exactly one synthetic travel draft');
    const doc = await storage.readPhotoPost(ws, rows[0].id), caption = window.__travelCaption;
    return { documentId: __travelDocument, postId: doc.id, owner: HaedoAuth.user.id,
      editorSame: document.querySelector('.ql-editor') === window.__travelEditor,
      storageSame: storage === window.__travelStorage,
      captionSame: document.querySelector('textarea[aria-label="사진 설명"]') === caption,
      captionActive: document.activeElement === caption, caption: caption.value,
      selection: [caption.selectionStart, caption.selectionEnd, caption.selectionDirection],
      body: Quill.find(document.querySelector('.ql-container')).getText(),
      photos: await Promise.all(doc.photos.map(async photo => ({ id: photo.id,
        digest: await HaedoLife.PhotoPost.digest(photo.blob), width: photo.width, height: photo.height }))),
      captionStored: JSON.stringify(doc.ops).includes(caption.value), scroll: [scrollX, scrollY] };
  });
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const report = { scope: 'Real Linux Chromium BFCache and beforeunload dialog; synthetic Auth HTTP, actual SDK/IDB. Not Apple hardware or native IME.',
    pass: false, consoleErrors: [], pageErrors: [], external: [], dialogs: [], notRestored: [],
    sourceHashes: {}, authUserReads: 0, cleanup: {}, dialogTimeline: [],
    observationClocks: { focus: 'performance.now() in the retained document', dialog: 'Date.now() epoch milliseconds' },
    controlledDrift: { requested: controlledDrift, syntheticLifecycleEvents: 0,
      scope: controlledDrift ? 'Controlled caption focus and scroll fault injection on trusted persisted pagehide; not naturally occurring drift evidence.' : 'Natural browser/dialog scrolling; no controlled drift.' } };
  let server, browser, context, page, cdp;
  let failure;
  try {
    server = await publicServer(report);
    const base = 'http://127.0.0.1:' + server.address().port;
    // Existing helpers capture BASE_URL at require time; this process owns its origin.
    process.env.BASE_URL = base;
    const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
    const { FakeCloud, accounts, cloud } = require('./life-sync-browser.cjs');
    const { openCompatibility } = require('./page-composer-entry.cjs');
    for (const privatePath of ['/AGENTS.md', '/tests/life-sync-browser.cjs', '/.local/travel-writing-history/report.json'])
      assert.equal((await fetch(base + privatePath)).status, 404, 'Only approved public release files are served');
    browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox'], ignoreDefaultArgs: ['--disable-back-forward-cache'] });
    report.browser = browser.version();
    const fake = new FakeCloud();
    context = await makeContext(browser, fake, 'travel-native-history', accounts.a, { viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(installHistoryObserver, { drift: controlledDrift });
    await context.route(cloud + '/auth/v1/user', route => {
      if (route.request().method() !== 'OPTIONS') report.authUserReads++;
      return route.fallback();
    });
    await context.route('**/*', route => {
      const origin = new URL(route.request().url()).origin;
      if ([base, cloud].includes(origin)) return route.fallback();
      report.external.push(origin); return route.abort();
    });
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    page.on('dialog', async dialog => {
      report.dialogTimeline.push({ event: 'dialog', type: dialog.type(), at: Date.now() });
      report.dialogs.push({ type: dialog.type(), accepted: true });
      await dialog.accept();
      report.dialogTimeline.push({ event: 'accepted', type: dialog.type(), at: Date.now() });
    });
    cdp = await context.newCDPSession(page);
    await cdp.send('Page.enable');
    cdp.on('Page.javascriptDialogOpening', event => report.dialogTimeline.push({ event: 'native-open', type: event.type, at: Date.now() }));
    cdp.on('Page.javascriptDialogClosed', event => report.dialogTimeline.push({ event: 'native-closed', accepted: event.result, at: Date.now() }));
    cdp.on('Page.backForwardCacheNotUsed', event => {
      report.notRestored.push((event.notRestoredExplanations || []).map(item => ({ type: item.type, reason: item.reason })));
    });

    await page.goto(base + '/index.html?section=records&view=page');
    await ready(page);
    await openCompatibility(page);
    await page.getByRole('button', { name: '글쓰기', exact: true }).click();
    await page.locator('#photoTitle').fill('캐시 왕복으로 이어 쓰는 합성 여행글');
    await page.locator('.ql-editor').fill('사진 앞의 한글 문단🌱\n사진 뒤의 한글 문단\n');
    const images = await page.evaluate(async () => {
      const result = [];
      for (const [width, height] of [[4032, 3024], [1200, 1800]]) {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const paint = canvas.getContext('2d'); paint.fillStyle = '#e1e9dc'; paint.fillRect(0, 0, width, height);
        paint.fillStyle = '#23412f'; paint.fillRect(40, 40, 300, 160);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        result.push([...new Uint8Array(await blob.arrayBuffer())]);
      }
      return result;
    });
    report.originalPhotos = images.map((bytes, index) => ({ digest: digest(Buffer.from(bytes)),
      width: index ? 1200 : 4032, height: index ? 1800 : 3024 }));
    await page.locator('#photoFiles').setInputFiles(images.map((bytes, index) => ({
      name: 'native-travel-' + index + '.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })));
    await page.locator('.photo-block').nth(1).waitFor();
    await page.waitForFunction(() => document.querySelector('.photo-status')?.textContent === '초안 보관됨');
    await page.evaluate(() => {
      const editor = Quill.find(document.querySelector('.ql-container'));
      editor.setSelection(editor.getLength() - 1, 0, 'silent');
      editor.insertText(editor.getLength() - 1, '끝에서 계속 쓸 한글 여행 문단🌊\n', 'user');
    });
    await page.waitForFunction(() => document.querySelector('.photo-status')?.textContent === '초안 보관됨');
    await page.locator('.photo-block img').first().click();
    const caption = page.getByRole('textbox', { name: '사진 설명', exact: true });
    await caption.fill('외출 뒤에도 유지할 사진 설명🌱');
    await caption.focus();
    await caption.evaluate(node => {
      node.setSelectionRange(2, 8, 'forward'); window.__travelCaption = node;
      window.__travelEditor = document.querySelector('.ql-editor'); window.__travelStorage = HaedoLife.Shell.storage;
      node.addEventListener('input', () => { window.__travelFinalInputAt = performance.now(); }, { once: true });
      scrollTo({ left: 0, top: Math.min(100, document.documentElement.scrollHeight - innerHeight), behavior: 'instant' });
    });
    // Finish expensive IDB/Blob checks before the final real input. Protocol and
    // hashing latency must not accidentally let its 500ms autosave finish first.
    const before = await snapshot(page);
    assert.deepEqual(before.photos.map(({ digest, width, height }) => ({ digest, width, height })), report.originalPhotos);
    assert.deepEqual(before.selection, [2, 8, 'forward']);
    assert.ok(before.scroll[1] > 0, 'Native return must preserve a nonzero reading position');
    assert.match(before.body, /끝에서 계속 쓸 한글 여행 문단🌊/);
    await caption.fill('외출 뒤에도 유지할 사진 설명🌱 마지막 실제 입력');
    const finalInput = await caption.evaluate(node => {
      node.focus(); node.setSelectionRange(2, 8, 'forward');
      scrollTo({ left: 0, top: Math.min(100, document.documentElement.scrollHeight - innerHeight), behavior: 'instant' });
      __travelSample('before-native-navigation');
      return { caption: node.value, captionActive: document.activeElement === node,
        selection: [node.selectionStart, node.selectionEnd, node.selectionDirection], scroll: [scrollX, scrollY],
        inputAt: window.__travelFinalInputAt, preparedAt: performance.now(), timeOrigin: performance.timeOrigin };
    });
    Object.assign(before, { caption: finalInput.caption, captionActive: finalInput.captionActive,
      selection: finalInput.selection, scroll: finalInput.scroll });
    assert.deepEqual(before.selection, [2, 8, 'forward']);
    assert.ok(before.captionActive && before.scroll[1] > 0);
    report.scroll = { setup: before.scroll };
    report.documentTimeOrigin = finalInput.timeOrigin;
    report.finalInput = { at: finalInput.inputAt, preparedAt: finalInput.preparedAt };
    const initialAuthReads = report.authUserReads;
    await page.goto(base + '/native-neutral');
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForFunction(() => window.__travelEvents?.some(event => event.type === 'pageshow'));
    const returned = await page.evaluate(() => ({ documentId: __travelDocument, events: __travelEvents }));
    report.events = returned.events;
    assert.equal(returned.documentId, before.documentId, 'Native history must retain the same document; see CDP notRestored reasons');
    for (const type of ['pagehide', 'pageshow']) assert.ok(returned.events.some(event =>
      event.type === type && event.persisted && event.trusted && event.documentId === before.documentId),
    'Require genuine trusted persisted ' + type + '; no synthetic fallback or skip');
    await page.waitForFunction(() => document.querySelector('#lifeApp') && !document.querySelector('#lifeApp').hidden && globalThis.HaedoLife?.Shell?.storage);
    await page.waitForFunction(() => document.activeElement === window.__travelCaption &&
      __travelCaption.selectionStart === 2 && __travelCaption.selectionEnd === 8);
    const after = await snapshot(page);
    // Save observations before any preservation assertion. A failure must keep
    // setup, actual pre-dialog departure and post-dialog pagehide positions;
    // they are different browser moments, not interchangeable expectations.
    report.focusSamples = await page.evaluate(() => __travelFocus);
    report.controlledDrift.samples = await page.evaluate(() => __travelDrift);
    const departures = report.focusSamples.filter(sample => sample.label === 'beforeunload');
    const pagehides = report.focusSamples.filter(sample => sample.label === 'pagehide');
    report.scroll = { setup: before.scroll,
      before: departures[0] ? [departures[0].scrollX, departures[0].scrollY] : null,
      departure: departures[0] ? [departures[0].scrollX, departures[0].scrollY] : null,
      pagehide: pagehides.length ? [pagehides[pagehides.length - 1].scrollX, pagehides[pagehides.length - 1].scrollY] : null,
      after: after.scroll };
    assert.equal(after.documentId, before.documentId);
    assert.equal(after.postId, before.postId);
    assert.equal(after.owner, accounts.a.id);
    for (const key of ['editorSame', 'storageSame', 'captionSame', 'captionActive', 'captionStored']) assert.equal(after[key], true, key);
    assert.equal(after.caption, before.caption);
    assert.deepEqual(after.selection, before.selection);
    assert.equal(after.body, before.body);
    assert.deepEqual(after.photos, before.photos);
    // Compare the real pre-dialog reading position. Setup can still settle
    // before navigation, and the native dialog may blur/scroll before pagehide.
    // Shell intentionally retains the focused position from beforeunload.
    assert.equal(departures.length, 1, 'One native confirmation must have one actual pre-dialog position');
    const [departure] = departures;
    assert.ok(departure.trusted && !departure.privateHidden && departure.captionActive &&
      Number.isFinite(departure.scrollX) && Number.isFinite(departure.scrollY) && departure.scrollY > 0,
      'Actual departure must retain a visible nonzero reading position');
    const departureScroll = [departure.scrollX, departure.scrollY];
    if (controlledDrift) {
      assert.equal(report.controlledDrift.samples.length, 1, 'One genuine pagehide must receive controlled drift');
      const drift = report.controlledDrift.samples[0];
      assert.ok(drift.trusted && drift.persisted);
      assert.ok(drift.captionConnected && drift.focusAfter, 'Controlled fixture must establish real caption focus without property/event fabrication');
      assert.equal(drift.after[1] - drift.before[1], controlledDrift, 'Controlled fixture must apply the full requested drift');
    }
    for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(after.scroll[axis] - departureScroll[axis]) < 2,
      'Native return must preserve scroll position on axis ' + axis);
    report.resumeUserReads = report.authUserReads - initialAuthReads;
    assert.equal(report.resumeUserReads, 1, 'One fresh server user verification on native resume');
    assert.deepEqual(report.dialogs, [{ type: 'beforeunload', accepted: true }], 'The native confirmation dialog is required');
    report.preserved = { sameDocument: true, sameEditor: true, sameCaption: true, sameStorage: true,
      samePost: true, sameOwner: true, captionSelection: after.selection, fullBody: true, captionCheckpointed: true,
      photoBytesAndDimensions: true, scrollPosition: true };
    for (const publicPath of critical) assert.equal(report.sourceHashes[publicPath],
      digest(await fs.readFile(path.join(root, publicPath.slice(1)))), 'Served source must equal final runtime: ' + publicPath);
    assert.equal(Object.keys(report.sourceHashes).length, critical.length);
    assert.equal(fake.writes().length, 0, 'Native return must not transmit private content');
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
    await page.screenshot({ path: path.join(output, 'native-return.png'), fullPage: true });
    report.pass = true;
  } catch (error) {
    failure = error; report.error = error.stack;
    if (page && !page.isClosed()) {
      report.actual = await page.evaluate(() => ({ documentId: window.__travelDocument, events: window.__travelEvents,
        focus: window.__travelFocus, captionConnected: !!window.__travelCaption?.isConnected,
        captionActive: !!window.__travelCaption && document.activeElement === __travelCaption,
        selection: window.__travelCaption ? [__travelCaption.selectionStart, __travelCaption.selectionEnd, __travelCaption.selectionDirection] : null,
        privateHidden: document.querySelector('#lifeApp')?.hidden ?? null, scroll: [scrollX, scrollY] })).catch(() => ({ unavailable: true }));
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    }
  } finally {
    for (const [name, resource] of [['cdp', cdp], ['context', context], ['browser', browser]]) {
      try { if (resource) await (name === 'cdp' ? resource.detach() : resource.close()); report.cleanup[name] = true; }
      catch { report.cleanup[name] = false; }
    }
    if (server) {
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      report.cleanup.server = !server.listening;
    }
    if (Object.values(report.cleanup).some(value => !value)) { report.pass = false; failure ||= Error('Owned resource cleanup failed'); }
    report.capturedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ pass: report.pass, browser: report.browser, resumeUserReads: report.resumeUserReads,
    consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length,
    cleanup: report.cleanup, report: path.relative(root, path.join(output, 'report.json')) }));
  if (failure) throw failure;
}

if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
