/* Exact source-photo recovery: visible UI, actual bundled SDK/IndexedDB,
 * synthetic capability-1 account HTTP, independent browser contexts. No live
 * Naver collection, operating credentials/SQL/RLS, or physical-device proof. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const ZIP = require('../vendor/fflate/fflate.js');
const { playwright, makeContext, ready, shellReady, settle, nav } = require('./unified-home-browser.cjs');
const { accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const { seedCapture, capturedRow, storedMedia, enter, fullText, selectedQuote } = require('./life-naver-capture-browser.cjs');
const { SourcePhotoCloud } = require('./helpers/source-photo-cloud.cjs');
const { awaitCondition } = require('./helpers/await-condition.cjs');
const repo = path.resolve(process.env.SOURCE_PHOTO_SOURCE_ROOT || path.join(__dirname, '..'));
const output = path.resolve(process.env.SOURCE_PHOTO_OUTPUT || '.local/source-photo-recovery-browser');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => structuredClone(value);
const products = ['index.html', 'life.html', 'sw.js', 'assets/platform-auth.js', 'assets/haedo-navigation.js', 'assets/life/core.js',
  'assets/life/storage.js', 'assets/life/ui.js', 'assets/life/ui.css', 'assets/life/shell.js', 'assets/life/account-library.js',
  'assets/life/sync.js', 'assets/life/naver-capture-reference.js', 'assets/life/naver-capture.js', 'assets/life/naver-capture-sync.js',
  'assets/life/naver-capture-ui.js', 'assets/life/naver-media.js', 'assets/life/naver-blog-ui.js', 'assets/life/naver-blog-sync.js',
  'assets/life/photo-post.js', 'assets/life/source-reference.js', 'assets/life/library-meta.js', 'assets/life/library-meta-sync.js'];
const fixtures = ['tests/source-photo-recovery-browser.cjs', 'tests/helpers/source-photo-cloud.cjs', 'tests/helpers/await-condition.cjs',
  'tests/life-naver-capture-browser.cjs', 'tests/naver-blog-browser.cjs', 'tests/account-materials-browser.cjs', 'tests/local-post-finder-browser.cjs',
  'tests/composition-sync-browser.cjs', 'tests/life-sync-browser.cjs', 'tests/unified-home-browser.cjs', 'tests/helpers/library-cloud.cjs', 'tests/helpers/blog-cloud.cjs'];
const report = { createdAt: new Date().toISOString(), scope: 'Actual product static bytes, bundled SDK, scoped IndexedDB and decoder/ZIP; synthetic account HTTP only. Initial legacy-sidecar fixture is explicit. In-flight service diagnostics forward every argument/result/error unchanged. No operating data or physical Apple-device claim.',
  checks: [], visual: [], consoleErrors: [], expectedConsoleErrors: [], pageErrors: [], staticErrors: [], staticResponses: [], external: [], observations: [], closedContexts: 0, browserClosed: false };
const hashes = files => Promise.all(files.map(async file => [file, sha(await fs.readFile(path.join(repo, file)))])).then(Object.fromEntries);
const bundle = (page, id) => page.evaluate(async id => { const s = HaedoLife.Shell.storage; return s.read(id || await s.getActive()); }, id);
function reference(value, versionId) {
  const links = value.links.filter(link => link.kind === 'naver_capture_reference' && link.entityRefs?.some(ref => ref.entityType === 'sourceVersion' && ref.entityId === versionId));
  assert(links.length <= 1); if (!links.length) return null;
  const link = links[0], note = JSON.parse(link.note);
  assert.equal(link.revision, 1); assert.deepEqual(link.entityRefs, [{ entityType: 'sourceVersion', entityId: versionId }]);
  assert.deepEqual(Object.keys(note).sort(), ['format', 'blogId', 'logNo', 'captureHash'].sort()); assert.equal(note.format, 'haedo.naver.capture-reference.v1');
  return { link, note };
}
async function waitValue(read, predicate, label, timeout = 20000) {
  const until = Date.now() + timeout; let last;
  while (Date.now() < until) { last = await read(); if (predicate(last)) return last; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw Error(label + ' did not arrive within ' + timeout + 'ms' + (last?.state ? '\nLast account state: ' + JSON.stringify(last.state) : ''));
}
async function within(promise, label, timeout = 20000) {
  let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' did not finish within ' + timeout + 'ms')), timeout); })]); }
  finally { clearTimeout(timer); }
}
const jobsDone = page => awaitCondition(page, () => globalThis.__sourcePhotoJobs === 0, undefined, { timeout: 20000, label: 'actual source-photo service completion' });
async function acknowledged(device, server, id) {
  await waitValue(() => device.page.evaluate(async id => { const h = HaedoLife.Shell, ws = id || await h.storage.getActive(); return { state: await h.accountLibrary.getState(ws), bundle: await h.storage.read(ws), sync: await h.storage.getSyncState(ws) }; }, id), value => {
    const remote = server.row(device.owner, value.bundle.workspaceId);
    return value.state.mode === 'account' && value.state.status === 'synced' && ['sources', 'composition', 'metadata'].every(k => value.state.domains[k]?.status === 'synced') && remote && isDeepStrictEqual(remote.data, value.bundle);
  }, 'actual account source/composition/metadata acknowledgement');
}
async function openSource(page, sourceId, versionId) {
  await nav(page, 'records'); await page.locator('.life-source-open[data-source-id="' + sourceId + '"]').first().click();
  await page.locator('#lifeSourceInfoToggle').waitFor();
  const versions = page.locator('#lifeVersion');
  if (await versions.count() && await versions.inputValue() !== versionId) {
    if (!await versions.isVisible()) await page.locator('#lifeSourceInfoToggle').click();
    await versions.selectOption(versionId);
  }
  await page.locator('#lifeNaverSourceMedia:not([data-state=loading])').waitFor();
}
async function rawReader(page) {
  if (await page.locator('#lifeSourceText').getAttribute('data-reading-mode') !== 'raw') await page.locator('#lifeExcerptToggle').click();
  await page.waitForFunction(() => document.querySelector('#lifeSourceText')?.dataset.readingMode === 'raw');
}
async function quoteCurrent(page) {
  await rawReader(page);
  await page.locator('#lifeSourceText').evaluate((element, quote) => {
    const text = element.firstChild, start = text.textContent.indexOf(quote), range = document.createRange();
    if (text.nodeType !== Node.TEXT_NODE || start < 0) throw Error('Exact raw quote target absent');
    element.focus(); range.setStart(text, start); range.setEnd(text, start + quote.length); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, selectedQuote);
  await page.locator('#lifeSourceTopic').fill('정확 사진 판의 옛 인용'); await page.locator('#lifeSourceNote').fill('복구와 파일에 자동 포함하지 않을 개인 메모');
  await page.locator('#lifeSourceExcerptSave:enabled').click();
  await awaitCondition(page, async quote => { const s = HaedoLife.Shell.storage, b = await s.read(await s.getActive()); return b.records.some(r => r.topic === '정확 사진 판의 옛 인용' && r.sourceRefs.some(ref => { const v = b.sourceVersions.find(v => v.id === ref.sourceVersionId); return v && v.contentText.slice(ref.locator.start, ref.locator.end) === quote; })); }, selectedQuote,
    { timeout: 20000, label: 'actual exact source quotation stored' });
}
async function readState(page, workspaceId) {
  return page.evaluate(async ws => {
    const s = HaedoLife.Shell.storage, b = await s.read(ws), photos = [];
    for (const v of b.sourceVersions) {
      const a = await s.readNaverCapture(ws, v.id); if (!a) continue;
      photos.push({ sourceId: a.sourceId, sourceVersionId: a.sourceVersionId, captureHash: a.capture.capture_hash, localOnly: a.localOnly === true,
        photos: await Promise.all(a.photos.map(async p => ({ index: p.index, bytes: p.blob.size, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await p.blob.arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join('') }))) });
    }
    return { bundle: b, photos, workbench: await s.readWorkbench(ws), folders: await s.readSourceFolders(ws), posts: await s.listPhotoPosts(ws), stages: await s.listStages(ws) };
  }, workspaceId);
}
async function download(page, control, name) {
  const pending = page.waitForEvent('download'); await control.click(); const item = await pending;
  const chunks = []; for await (const bytes of await item.createReadStream()) chunks.push(bytes);
  const bytes = Buffer.concat(chunks); await fs.writeFile(path.join(output, name), bytes); return bytes;
}
function inspectArchive(bytes, target, row, photos) {
  const files = ZIP.unzipSync(bytes), manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
  // Independently check both central and local CRC declarations against every
  // stored entry, in addition to the product's own import validation.
  const end = bytes.length - 22; assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  let offset = bytes.readUInt32LE(end + 16); const entryCount = bytes.readUInt16LE(end + 10), names = [];
  for (let entry = 0; entry < entryCount; entry++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50); assert.equal(bytes.readUInt16LE(offset + 10), 0);
    const length = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + length).toString(), local = bytes.readUInt32LE(offset + 42), data = files[name];
    assert(data); assert.equal(bytes.readUInt32LE(local), 0x04034b50); assert.equal(bytes.readUInt32LE(offset + 24), data.length);
    let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    crc = (crc ^ 0xffffffff) >>> 0; assert.equal(bytes.readUInt32LE(offset + 16), crc); assert.equal(bytes.readUInt32LE(local + 14), crc);
    names.push(name); offset += 46 + length + extra + comment;
  }
  assert.equal(offset, end); assert.deepEqual(names.sort(), Object.keys(files).sort());
  assert.deepEqual(names, ['manifest.json', ...photos.map((_, index) => 'photos/' + index)].sort());
  assert.equal(manifest.format, 'haedo.naver.capture.v1'); assert.equal(manifest.bundle.sourceVersions.length, 1); assert.equal(manifest.bundle.records.length, 0);
  assert.equal(manifest.bundle.sourceVersions[0].id, target.versionId); assert.equal(manifest.bundle.sourceVersions[0].contentText, row.payload.body);
  assert.equal(manifest.bundle.sourceVersions[0].contentHash, row.payload.bodyHash); assert.equal(manifest.attachment.capture.capture_hash, row.capture_hash);
  assert.equal(manifest.attachment.localOnly, true); assert.deepEqual(Object.keys(manifest.attachment.capture).sort(), ['capture_hash', 'payload']);
  assert(!manifest.bundle.links.some(link => link.kind === 'naver_capture_reference')); assert(!JSON.stringify(manifest).includes(accounts.a.id));
  assert(manifest.attachment.capture.payload.photos.every(photo => photo.storagePath === null));
  for (let index = 0; index < photos.length; index++) assert.equal(sha(files['photos/' + index]), photos[index].digest);
  return { manifest, paths: Object.keys(files), sha256: sha(bytes), photos: photos.map(p => p.digest), bytes: bytes.length };
}
async function main() {
  assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname)); await assert.rejects(fs.access(output), 'Fresh evidence directory required'); await fs.mkdir(output, { recursive: true });
  report.productsBefore = await hashes(products); report.fixturesBefore = await hashes(fixtures);
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, action) {
    if (process.env.SOURCE_PHOTO_MATCH && !new RegExp(process.env.SOURCE_PHOTO_MATCH).test(name)) return;
    const server = new SourcePhotoCloud(), devices = [], pendingBodies = new Set(); let number = 0;
    async function drain() { await Promise.all([...pendingBodies]); }
    async function device(label, owner = accounts.a) {
      const name = 'source-photo-' + report.checks.length + '-' + label, context = await makeContext(browser, server, name, null, { viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      const d = { name, context, page: null, owner: owner.id, closed: false }; devices.push(d);
      await context.addInitScript(() => {
        window.__sourcePhotoJobs = 0; window.__sourcePhotoJobEvents = [];
        const life = window.HaedoLife ||= {};
        Object.defineProperty(life, 'NaverCaptureSync', { configurable: true, set(api) {
          Object.defineProperty(life, 'NaverCaptureSync', { configurable: true, writable: true, value: { ...api, create(options) {
            const actual = api.create(options), wrapped = { ...actual };
            for (const key of ['restoreSourcePhotos', 'rememberSourcePhotos']) if (actual[key]) wrapped[key] = async (...args) => {
              window.__sourcePhotoJobs++; const event = { method: key, started: performance.now() }; window.__sourcePhotoJobEvents.push(event);
              try { return await actual[key](...args); } catch (error) { event.error = error.code || error.name; throw error; }
              finally { event.finished = performance.now(); window.__sourcePhotoJobs--; }
            };
            return Object.freeze(wrapped);
          } } });
        } });
      });
      await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.external.push({ device: name, path: u.origin + u.pathname }); return route.abort('blockedbyclient'); });
      context.on('response', response => {
        const u = new URL(response.url()); if (u.origin !== new URL(base).origin || !/\.(?:js|css|html)$/.test(u.pathname)) return;
        const task = (async () => { const file = u.pathname.slice(1), bytes = await response.body(), row = { device: name, file, status: response.status(), sha256: sha(bytes), bytes: bytes.length, configFixture: file === 'assets/platform-config.js' }; if (!row.configFixture) assert.equal(row.sha256, sha(await fs.readFile(path.join(repo, file)))); assert.equal(row.status, 200); report.staticResponses.push(row); })();
        pendingBodies.add(task); task.catch(error => report.staticErrors.push({ device: name, path: u.pathname, message: error.message })).finally(() => pendingBodies.delete(task));
      });
      const page = d.page = await context.newPage(); page.setDefaultTimeout(20000);
      page.on('pageerror', error => report.pageErrors.push({ device: name, message: error.message }));
      page.on('console', event => {
        if (event.type() !== 'error') return;
        const value = { device: name, message: event.text(), path: event.location().url };
        const expected = server.photoFailures.find(f => f.device === name && value.path === cloud + f.path && !f.observed && (/Failed to load resource/.test(value.message)) && (typeof f.expected === 'number' ? value.message.includes(String(f.expected)) : /ERR_INTERNET_DISCONNECTED/.test(value.message)));
        if (expected) { expected.observed = true; report.expectedConsoleErrors.push(value); } else report.consoleErrors.push(value);
      });
      await page.goto(base + '/index.html'); await shellReady(page); await drain(); assert.deepEqual(await page.evaluate(() => __homeDbOpens), []);
      server.oauthAccounts.set(name, owner); await page.goto(base + '/login.html?next=' + encodeURIComponent('index.html?section=records')); await drain();
      await page.locator('#googleLogin').click(); await page.waitForURL(u => u.pathname.endsWith('/index.html')); await ready(page); await settle(page); await drain();
      assert.equal(await page.evaluate(() => HaedoAuth.user.id), owner.id); assert((await page.evaluate(() => __homeDbOpens)).every(row => row.verified));
      await acknowledged(d, server); return d;
    }
    async function receive(a, row) {
      await enter(a.page); await a.page.locator('.nv-connection [data-action=public-list]').first().click();
      await a.page.locator('.nv-capture-row[data-capture-id="' + row.id + '"] [data-action=review-capture]').click(); await a.page.locator('#naverCaptureReview[aria-busy=false]').waitFor();
      await a.page.locator('#naverCaptureApply').click(); await a.page.locator('#naverCaptureStatus[data-state=stored]').waitFor(); await acknowledged(a, server);
      const b = await bundle(a.page), source = b.sources.find(s => s.origin === 'naver_blog' && s.url.includes('100002')), version = b.sourceVersions.filter(v => v.sourceId === source.id).at(-1);
      assert.equal(reference(b, version.id).note.captureHash, row.capture_hash); return { workspaceId: b.workspaceId, sourceId: source.id, versionId: version.id };
    }
    async function prepare() {
      const a = await device('a'), seeded = await seedCapture(a.page); await acknowledged(a, server, seeded.workspaceId); server.setup(seeded.workspaceId);
      const row = await capturedRow(seeded.photoFiles); server.addCapture(row, seeded.photoFiles); const target = await receive(a, row);
      await openSource(a.page, target.sourceId, target.versionId); await quoteCurrent(a.page); await acknowledged(a, server, target.workspaceId);
      const original = await readState(a.page, target.workspaceId); const ref = reference(original.bundle, target.versionId);
      assert.equal(ref.note.captureHash, row.capture_hash); assert.equal(original.bundle.sourceVersions.find(v => v.id === target.versionId).contentText, fullText);
      for (const key of ['sourceVersions', 'records', 'links']) for (const previous of seeded.original.bundle[key]) assert.deepEqual(original.bundle[key].find(value => value.id === previous.id), previous);
      for (const record of original.bundle.records) for (const r of record.sourceRefs) {
        const text = original.bundle.sourceVersions.find(v => v.id === r.sourceVersionId).contentText;
        if (text !== null) assert.equal(text.slice(r.locator.start, r.locator.end), record.text);
      }
      return { a, seeded, row, target, original };
    }
    async function peer(f, label = 'b') {
      const b = await device(label); await acknowledged(b, server, f.target.workspaceId);
      const actual = await bundle(b.page); assert.equal(actual.workspaceId, f.target.workspaceId); assert.deepEqual(actual, f.original.bundle);
      assert.equal(await storedMedia(b.page, f.target.workspaceId, f.target.versionId), null); return b;
    }
    async function restored(d, f) {
      await openSource(d.page, f.target.sourceId, f.target.versionId); await d.page.locator('#lifeNaverSourceMedia[data-state=recoverable]').waitFor();
      await d.page.locator('#lifeNaverPhotosRestore').click(); await jobsDone(d.page); await d.page.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor();
      const media = await storedMedia(d.page, f.target.workspaceId, f.target.versionId); assert.equal(media.capture.capture_hash, f.row.capture_hash);
      assert.deepEqual(media.photos.map(p => p.sha256), f.seeded.photoFiles.map(p => p.digest)); assert.deepEqual(await bundle(d.page), f.original.bundle); return media;
    }
    async function screen(d, scene) {
      for (const width of [1440, 820, 390]) {
        await d.page.setViewportSize({ width, height: 1000 }); await d.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const metrics = await d.page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth,
          controls: [...document.querySelectorAll('#lifeNaverSourceMedia button')].filter(n => n.getClientRects().length).map(n => { const r = n.getBoundingClientRect(); return { name: n.getAttribute('aria-label') || n.textContent.trim(), width: r.width, height: r.height }; }) }));
        assert(metrics.overflow <= 1); assert(metrics.controls.every(c => c.name && c.width >= 43 && c.height >= 43));
        const file = scene + '-' + width + '.png'; await d.page.screenshot({ path: path.join(output, file), fullPage: true }); report.visual.push({ file, width, ...metrics });
      }
      await d.page.setViewportSize({ width: 1440, height: 1000 });
    }
    try {
      console.log('RUN ' + name); const details = await action({ server, device, prepare, peer, restored, receive, screen });
      assert.deepEqual(server.photoRouteErrors, []); assert.deepEqual(server.libraryRouteErrors, []);
      assert.equal(server.captureCalls.filter(row => ['worker', 'life_naver_capture_request'].includes(row.rpc)).length, 0, 'Recovery must not initiate collection');
      assert.equal(server.saves().length, 0, 'Recovery must not publish or save a blog post'); assert.equal(server.assetCalls.filter(row => row.method !== 'GET').length, 0);
      report.checks.push({ name, pass: true, ...details }); console.log('PASS ' + name);
    } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); for (const d of devices) await d.page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '-' + number++ + '.png'), fullPage: true }).catch(() => {}); throw error; }
    finally {
      server.photoHolds.forEach(hold => hold.release.resolve()); await drain();
      for (const d of devices) { await d.context.close(); d.closed = true; report.closedContexts++; }
      report.observations.push({ name, requests: server.requests, captureRequests: server.captureCalls, photoRequests: server.photoRequests, photoFailures: server.photoFailures, libraryRequests: server.libraryRequests, contexts: devices.map(d => ({ name: d.name, closed: d.closed })) });
      await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    }
  }
  try {
    await check('same source/version arrives on B and explicit recovery preserves raw reader and exact quotation', async ({ prepare, peer, server, restored, screen }) => {
      const f = await prepare(), b = await peer(f); await openSource(b.page, f.target.sourceId, f.target.versionId); await rawReader(b.page);
      await screen(b, 'recoverable'); await b.page.locator('#lifeNaverPhotosRestore').focus(); assert.equal(await b.page.locator('#lifeNaverPhotosRestore').evaluate(n => n === document.activeElement), true);
      await b.page.evaluate(quote => { const n = document.querySelector('#lifeSourceText'); window.__exactReader = n; const start = n.firstChild.textContent.indexOf(quote), range = document.createRange(); range.setStart(n.firstChild, start); range.setEnd(n.firstChild, start + quote.length); getSelection().removeAllRanges(); getSelection().addRange(range); }, selectedQuote);
      await b.page.locator('#lifeNaverPhotosRestore').click(); await jobsDone(b.page); await b.page.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor();
      assert.equal(await b.page.evaluate(() => __exactReader === document.querySelector('#lifeSourceText')), true); assert.equal(await b.page.locator('#lifeSourceText').textContent(), fullText);
      assert.equal(await b.page.evaluate(() => getSelection().toString()), selectedQuote); assert.deepEqual(await bundle(b.page), f.original.bundle);
      const media = await storedMedia(b.page, f.target.workspaceId, f.target.versionId); assert.deepEqual(media.photos.map(p => p.sha256), f.seeded.photoFiles.map(p => p.digest));
      await b.page.waitForFunction(() => [...document.querySelectorAll('#lifeNaverSourceMedia img')].length === 2 && [...document.querySelectorAll('#lifeNaverSourceMedia img')].every(n => n.naturalWidth > 0));
      assert.deepEqual(await b.page.locator('#lifeNaverSourceMedia img').evaluateAll(nodes => nodes.map(n => [n.naturalWidth, n.naturalHeight])), [[4032, 3024], [1200, 1800]]);
      const unchanged = await readState(b.page, f.target.workspaceId), before = server.photoRequests.length; await openSource(b.page, f.target.sourceId, f.target.versionId); await b.page.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor();
      assert.deepEqual(await readState(b.page, f.target.workspaceId), unchanged); assert.equal(server.photoRequests.length, before); await screen(b, 'restored');
      return { sameIds: true, coreUnchanged: true, rawReaderIdentity: true, repeatedOpenDownloads: 0 };
    });
    await check('same text with another photo capture never replaces the selected old photo version; missing and invalid rows remain recoverable', async ({ prepare, peer, receive, server, screen }) => {
      const f = await prepare(), second = await capturedRow(f.seeded.photoFiles.slice().reverse(), { title: f.row.payload.title }); second.id = 'eeeeeeee-eeee-4eee-8eee-000000900002';
      server.addCapture(second, f.seeded.photoFiles.slice().reverse()); const latest = await receive(f.a, second); assert.notEqual(latest.versionId, f.target.versionId); assert.equal(second.payload.bodyHash, f.row.payload.bodyHash); assert.notEqual(second.capture_hash, f.row.capture_hash);
      f.original = await readState(f.a.page, f.target.workspaceId); const b = await peer(f); await openSource(b.page, f.target.sourceId, f.target.versionId);
      const before = await readState(b.page, f.target.workspaceId); server.exactOverride = () => [];
      await b.page.locator('#lifeNaverPhotosRestore').click(); await jobsDone(b.page); await b.page.locator('#lifeNaverPhotosError:not([hidden])').waitFor(); assert.deepEqual(await readState(b.page, f.target.workspaceId), before); await screen(b, 'missing-capture');
      for (const invalid of [() => [copy(f.row), copy(f.row)], () => [copy(second)], () => [{ ...copy(f.row), owner_id: accounts.b.id }]]) {
        server.exactOverride = invalid; await b.page.locator('#lifeNaverPhotosRestore:enabled').click(); await jobsDone(b.page); await b.page.locator('#lifeNaverPhotosError:not([hidden])').waitFor(); assert.deepEqual(await readState(b.page, f.target.workspaceId), before);
      }
      server.exactOverride = null; await b.page.locator('#lifeNaverPhotosRestore:enabled').click(); await jobsDone(b.page); await b.page.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor();
      assert.equal((await storedMedia(b.page, f.target.workspaceId, f.target.versionId)).capture.capture_hash, f.row.capture_hash); assert.equal(await storedMedia(b.page, f.target.workspaceId, latest.versionId), null);
      const queries = server.photoRequests.filter(r => r.device === b.name && r.kind === 'exact'); assert(queries.length >= 5); assert(queries.every(r => new Map(r.query).get('capture_hash') === 'eq.' + f.row.capture_hash));
      assert.deepEqual(await bundle(b.page), f.original.bundle); return { bodyIdentical: true, selectedHashUnchanged: true, rejectedShapes: 4 };
    });
    await check('download failure, original hash corruption and native IDB abort leave no partial sidecar; retry and duplicate activation are atomic', async ({ prepare, peer, server }) => {
      const f = await prepare(), b = await peer(f); await openSource(b.page, f.target.sourceId, f.target.versionId); const before = await readState(b.page, f.target.workspaceId);
      for (const fault of ['failNextMedia', 'corruptNextMedia']) {
        server[fault].add(b.name); await b.page.locator('#lifeNaverPhotosRestore').click(); await jobsDone(b.page); await b.page.locator('#lifeNaverPhotosError:not([hidden])').waitFor(); assert.deepEqual(await readState(b.page, f.target.workspaceId), before);
      }
      await b.page.evaluate(() => { window.__photoAbortCount = 0; window.__nativePhotoAdd = IDBObjectStore.prototype.add; IDBObjectStore.prototype.add = function (...args) { const value = window.__nativePhotoAdd.apply(this, args); if (String(args[0]?.key || args[1] || '').startsWith('naver-capture:') && __photoAbortCount === 0) { window.__photoAbortCount++; this.transaction.abort(); } return value; }; });
      try { await b.page.locator('#lifeNaverPhotosRestore').click(); await jobsDone(b.page); await b.page.locator('#lifeNaverPhotosError:not([hidden])').waitFor(); assert.equal(await b.page.evaluate(() => __photoAbortCount), 1); assert.deepEqual(await readState(b.page, f.target.workspaceId), before); }
      finally { await b.page.evaluate(() => { IDBObjectStore.prototype.add = __nativePhotoAdd; }); }
      const hold = server.holdPhoto(b.name), action = b.page.locator('#lifeNaverPhotosRestore').click(); await within(hold.entered.promise, 'held original request'); await action;
      try { assert.equal(await b.page.locator('#lifeNaverPhotosRestore').isDisabled(), true); await b.page.keyboard.press('Enter'); }
      finally { hold.release.resolve(); }
      await jobsDone(b.page); await b.page.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor(); const media = await storedMedia(b.page, f.target.workspaceId, f.target.versionId);
      assert.equal(media.capture.capture_hash, f.row.capture_hash); assert.deepEqual(await bundle(b.page), before.bundle);
      const events = await b.page.evaluate(() => __sourcePhotoJobEvents); assert.equal(events.filter(e => e.method === 'restoreSourcePhotos').length, 4);
      return { injectedNativeAborts: 1, rejectedTransportAndHash: 2, duplicateServiceStarts: 0 };
    });
    await check('late photo replies after reader, workspace or account change cannot write; another owner cannot obtain the pinned capture', async ({ prepare, peer, server, device }) => {
      const f = await prepare();
      for (const direction of ['reader', 'workspace', 'account']) {
        const b = await peer(f, direction); let other;
        if (direction === 'workspace') other = await b.page.evaluate(() => HaedoLife.Shell.storage.createWorkspace('늦은 사진을 받지 않을 별도 공간'));
        await openSource(b.page, f.target.sourceId, f.target.versionId); const before = await readState(b.page, f.target.workspaceId), hold = server.holdPhoto(b.name);
        await b.page.locator('#lifeNaverPhotosRestore').click(); await within(hold.entered.promise, 'late original request');
        try {
          if (direction === 'reader') await nav(b.page, 'home');
          if (direction === 'workspace') { await nav(b.page, 'manage'); await b.page.locator('#lifeCurrentWorkspace').click(); await b.page.locator('#lifeWorkspace').selectOption(other.workspaceId); await settle(b.page); }
          if (direction === 'account') { b.owner = accounts.b.id; await b.page.evaluate(value => HaedoAuth.client.auth.setSession(value).then(() => HaedoAuth.verify()), session(accounts.b)); await awaitCondition(b.page, id => HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id, { timeout: 20000, label: 'changed account owns storage' }); }
        } finally { hold.release.resolve(); }
        await within(hold.finished.promise, 'released original response'); await jobsDone(b.page);
        if (direction !== 'account') { assert.deepEqual(await readState(b.page, f.target.workspaceId), before); if (other) assert.equal(await storedMedia(b.page, other.workspaceId, f.target.versionId), null); }
        else { const current = await bundle(b.page); assert(!current.sources.some(s => s.id === f.target.sourceId)); assert.equal(await b.page.locator('#lifeNaverSourceMedia').count(), 0); }
      }
      const foreign = await device('foreign', accounts.b);
      const result = await foreign.page.evaluate(async value => { const query = HaedoAuth.client.from('life_naver_captures').select('id,owner_id,blog_id,log_no,capture_hash,created_at,payload').eq('owner_id', HaedoAuth.user.id).eq('blog_id', value.blog_id).eq('log_no', value.log_no).eq('capture_hash', value.capture_hash).limit(2); return (await query).data; }, f.row);
      assert.deepEqual(result, []); return { cancelledContexts: 3, foreignExactRows: 0 };
    });
    await check('cached exact originals remain readable offline and dedicated ZIP restores an independent local-only copy', async ({ prepare, peer, restored, server }) => {
      const f = await prepare(), b = await peer(f); await restored(b, f); const before = await readState(b.page, f.target.workspaceId), gets = server.photoRequests.filter(r => r.device === b.name).length;
      server.photoOffline.add(b.name); await openSource(b.page, f.target.sourceId, f.target.versionId); await b.page.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor();
      const archive = await download(b.page, b.page.locator('#lifeNaverSourceMedia').getByRole('button', { name: '글·사진 ZIP 저장', exact: true }), 'exact-originals.zip'); const proof = inspectArchive(archive, f.target, f.row, f.seeded.photoFiles);
      assert.equal(server.photoRequests.filter(r => r.device === b.name).length, gets); assert.deepEqual(await readState(b.page, f.target.workspaceId), before); server.photoOffline.delete(b.name);
      await enter(b.page); const spaces = await b.page.evaluate(async () => (await HaedoLife.Shell.storage.listWorkspaces()).map(w => w.workspaceId));
      await b.page.locator('#naverCaptureImportFile').setInputFiles({ name: 'exact-originals.zip', mimeType: 'application/zip', buffer: archive });
      const copyId = await waitValue(() => b.page.evaluate(async old => (await HaedoLife.Shell.storage.listWorkspaces()).find(w => !old.includes(w.workspaceId))?.workspaceId || null, spaces), value => !!value, 'new independent original-photo workspace');
      const copied = await bundle(b.page, copyId), version = copied.sourceVersions[0], media = await storedMedia(b.page, copyId, version.id);
      assert.notEqual(copied.workspaceId, f.target.workspaceId); assert.notEqual(version.id, f.target.versionId); assert.equal(version.contentText, fullText); assert.equal(media.localOnly, true); assert.deepEqual(media.photos.map(p => p.sha256), f.seeded.photoFiles.map(p => p.digest)); assert.equal(reference(copied, version.id), null);
      await openSource(b.page, copied.sources[0].id, version.id); assert.equal(await b.page.locator('#lifeNaverPhotosRemember').count(), 0); assert.equal(await b.page.locator('#lifeNaverPhotosRestore').count(), 0);
      return { archive: { sha256: proof.sha256, bytes: proof.bytes, paths: proof.paths }, offlinePhotoRequests: 0, restoredLocalOnly: true };
    });
    await check('legacy remote sidecar gains a pointer only through explicit remember and then recovers on B; text-only legacy is never guessed', async ({ prepare, peer, server, screen }) => {
      const f = await prepare(), legacy = await capturedRow(f.seeded.photoFiles, { logNo: '100004', title: '이전 앱에서 보관한 정확 사진 사본' }); server.addCapture(legacy, f.seeded.photoFiles);
      const target = await f.a.page.evaluate(async ({ row, files }) => {
        const L = HaedoLife, s = L.Shell.storage, C = L.Core, b = await s.read(await s.getActive()), input = L.NaverCapture.toImportInput(row.payload); input.forceSeparate = true;
        const p = await C.prepareImport(input, b), result = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: C.id(), changes: C.buildImportChanges(b, p) }); if (result.status !== 'stored') throw Error('Legacy source fixture failed');
        const attachment = await L.NaverMedia.validate({ sourceId: p.source.id, sourceVersionId: p.version.id, capture: row, photos: files.map((file, index) => ({ index, blob: new Blob([new Uint8Array(file.bytes)], { type: file.type }) })) });
        await new Promise((resolve, reject) => { const r = indexedDB.open('life-tools-v1'); r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result, tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').add({ key: `naver-capture:${b.workspaceId}:${p.version.id}`, value: attachment }); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; }; });
        return { workspaceId: b.workspaceId, sourceId: p.source.id, versionId: p.version.id };
      }, { row: legacy, files: f.seeded.photoFiles.map(p => ({ type: p.type, bytes: [...p.bytes] })) });
      await acknowledged(f.a, server, target.workspaceId); f.original = await readState(f.a.page, target.workspaceId); assert.equal(reference(f.original.bundle, target.versionId), null);
      const b = await peer(f); await openSource(b.page, target.sourceId, target.versionId); await b.page.locator('#lifeNaverSourceMedia[data-state=unverified]').waitFor(); assert.equal(await b.page.locator('#lifeNaverPhotosRestore').count(), 0); const queries = server.photoRequests.length; await screen(b, 'legacy-unverified'); assert.equal(server.photoRequests.length, queries);
      await openSource(f.a.page, target.sourceId, target.versionId); await f.a.page.locator('#lifeNaverPhotosRemember').waitFor(); const old = await bundle(f.a.page); await f.a.page.locator('#lifeNaverPhotosRemember').click(); await jobsDone(f.a.page); await acknowledged(f.a, server, target.workspaceId);
      const updated = await bundle(f.a.page); assert.equal(reference(updated, target.versionId).note.captureHash, legacy.capture_hash); for (const k of ['sources', 'sourceVersions', 'records', 'resumeHints', 'tombstones']) assert.deepEqual(updated[k], old[k]); assert.equal(updated.links.length, old.links.length + 1);
      await b.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await acknowledged(b, server, target.workspaceId); await openSource(b.page, target.sourceId, target.versionId); await b.page.locator('#lifeNaverPhotosRestore').click(); await jobsDone(b.page); await b.page.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor();
      assert.equal((await storedMedia(b.page, target.workspaceId, target.versionId)).capture.capture_hash, legacy.capture_hash); assert.deepEqual(await bundle(b.page), updated); return { legacyExplicitPointer: true, newVersions: 0, ambiguousAutoDownloads: 0 };
    });
  } finally {
    await browser.close(); report.browserClosed = true; report.productsAfter = await hashes(products); report.fixturesAfter = await hashes(fixtures);
    report.productsUnchanged = JSON.stringify(report.productsBefore) === JSON.stringify(report.productsAfter); report.fixturesUnchanged = JSON.stringify(report.fixturesBefore) === JSON.stringify(report.fixturesAfter);
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  for (const name of ['consoleErrors', 'pageErrors', 'staticErrors', 'external']) assert.deepEqual(report[name], [], name);
  assert(report.productsUnchanged && report.fixturesUnchanged); assert(report.checks.length && report.checks.every(c => c.pass));
  console.log('Source-photo recovery: ' + report.checks.length + ' passed; actual SDK/IDB with synthetic HTTP only.');
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { reference, inspectArchive, products, fixtures };
