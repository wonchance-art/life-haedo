/* Real Chromium IndexedDB version negotiation against unchanged 2eebd27 modules.
 * No account/network service: a small textarea harness retains old-tab input;
 * this is a storage barrier test, not a historical PhotoPostUI/Apple IME test.
 * node tests/post-markdown-old-tab-browser.cjs
 * POST_MARKDOWN_OLD_TAB_MUTATION=no-version-bump node tests/post-markdown-old-tab-browser.cjs
 * The mutation must fail after observing the old replacement delete the md row.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { playwright } = require('./unified-home-browser.cjs');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:4173';
const mutation = process.env.POST_MARKDOWN_OLD_TAB_MUTATION || '';
assert.ok(['', 'no-version-bump'].includes(mutation), 'unknown mutation');
const output = path.resolve(process.env.POST_MARKDOWN_OLD_TAB_OUTPUT || path.join(root, '.local/post-markdown-old-tab', mutation || 'baseline'));
const owner = { projectUrl: 'https://old-tab-test.supabase.co', userId: '11111111-1111-4111-8111-111111111111' };
const shared = ['vendor/idb/idb.js', 'vendor/markdown-it/markdown-it.umd.min.js', 'assets/life/core.js', 'assets/life/page-posts.js', 'assets/life/post-markdown.js'];
const report = { scope: 'Linux Chromium, real IndexedDB; pinned old storage/photo model and synthetic textarea; no production account, PhotoPostUI or Apple verification', mutation, checks: [], consoleErrors: [], pageErrors: [], externalRequests: [] };

async function main() {
  await fs.mkdir(output, { recursive: true });
  const scripts = new Map(await Promise.all([...shared, 'assets/life/photo-post.js', 'assets/life/storage.js'].map(async file => ['/' + file, await fs.readFile(path.join(root, file))])));
  const fixtureRoot = path.join(__dirname, 'fixtures/post-markdown-old-client');
  const provenance = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'provenance.json'), 'utf8'));
  assert.equal(provenance.commit, '2eebd27cbde54f697c9de3a09382f2e21b39a743');
  for (const entry of provenance.files) {
    const raw = zlib.gunzipSync(await fs.readFile(path.join(fixtureRoot, entry.fixture)));
    assert.equal(raw.byteLength, entry.bytes);
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), entry.sha256);
    scripts.set('/old/' + path.basename(entry.source), raw);
  }
  report.provenance = provenance;
  if (mutation) {
    const original = scripts.get('/assets/life/storage.js').toString('utf8');
    assert.match(original, /const DB_VERSION = 2;/, 'mutation must remove the actual version barrier');
    scripts.set('/assets/life/storage.js', Buffer.from(original.replace('const DB_VERSION = 2;', 'const DB_VERSION = 1;')));
  }
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function scenario(name, run) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const result = { name, pass: false };
    report.checks.push(result);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { report.externalRequests.push(url.origin); return route.abort(); }
      if (url.pathname === '/old.html' || url.pathname === '/new.html') {
        const old = url.pathname === '/old.html';
        const assets = [...shared, ...(old ? ['old/photo-post.js', 'old/storage.js'] : ['assets/life/photo-post.js', 'assets/life/storage.js'])];
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="icon" href="data:,"><title>구형 탭 저장 장벽 검사</title><main><label>미저장 질문<textarea id="input"></textarea></label><p role="alert" id="error"></p></main>' + assets.map(file => `<script src="/${file}"></script>`).join('') + '</html>' });
      }
      const body = scripts.get(url.pathname);
      if (!body) { report.externalRequests.push(url.pathname); return route.abort(); }
      return route.fulfill({ contentType: 'text/javascript', body });
    });
    async function open(old) {
      const page = await context.newPage();
      page.on('pageerror', error => report.pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
      await page.goto(origin + (old ? '/old.html' : '/new.html'));
      await page.evaluate(owner => {
        globalThis.S = HaedoLife.Storage.forAccount(owner);
        globalThis.events = [];
        S.subscribeAll(event => events.push(event));
        globalThis.mdWrites = 0;
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...args) {
          if (value?.value?.format === 'life-post-md-v1') mdWrites++;
          return put.call(this, value, ...args);
        };
        globalThis.rawSnapshot = async () => {
          const db = await idb.openDB('life-tools-v1');
          try {
            const rows = {};
            for (const name of db.objectStoreNames) rows[name] = await db.getAll(name);
            return { version: db.version, rows };
          } finally { db.close(); }
        };
      }, owner);
      return page;
    }
    try { await run(open, result); result.pass = true; console.log('PASS ' + name); }
    catch (error) { result.error = error.stack; console.error('FAIL ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  async function seed(page) {
    return page.evaluate(async () => {
      const C = HaedoLife.Core, P = HaedoLife.PhotoPost;
      const workspaceId = (await S.createWorkspace('구형 탭 합성 자료')).workspaceId;
      const original = P.create(C.id, '2026-11-05T00:00:00.000Z');
      original.title = '정확하게 남길 글'; original.status = 'saved'; original.ops = [{ insert: '정확한 원문 한글\n' }];
      // This draft already exists locally before a newer client installs its
      // target (e.g. from another device). Keep revision 1 so CAS alone cannot
      // hide the historical unreadable-replacement deletion.
      const draft = await S.savePhotoPost(workspaceId, { ...original, id: C.id(), status: 'draft', replaces: { id: original.id, revision: 1 } }, 0);
      globalThis.fixture = { workspaceId, original, draft };
      const db = await idb.openDB('life-tools-v1', 1);
      await db.put('operations', { workspaceId, operationId: 'sentinel', marker: 'operation preserved' });
      await db.put('staging', { stageId: 'sentinel', workspaceId, marker: 'draft preserved' });
      await db.put('recovery', { id: 'sentinel', marker: 'recovery preserved' });
      db.close();
      return { ...fixture, before: await rawSnapshot() };
    });
  }
  async function promptly(promise, label) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' did not settle within 2 seconds')), 2000);
      })]);
    } finally { clearTimeout(timer); }
  }
  try {
    await scenario('native upgrade closes the old tab before md writes and rejects its replacement', async (open, result) => {
      const old = await open(true), f = await seed(old);
      await old.locator('#input').fill('예전 탭에 아직 저장하지 않은 한글 🌳');
      const current = await open(false);
      await current.evaluate(() => S.open());
      const upgraded = await current.evaluate(() => rawSnapshot());
      assert.deepEqual(upgraded.rows, f.before.rows, 'upgrade must preserve all five stores and every row');
      const saved = await current.evaluate(async f => S.savePhotoPost(f.workspaceId, HaedoLife.PostMarkdown.fromV2(f.original).document, 0), f);
      const attempted = await old.evaluate(async () => {
        const edited = { ...fixture.draft, status: 'saved', ops: [{ insert: document.querySelector('#input').value + '\n' }] };
        let code = null;
        try { await S.savePhotoPost(fixture.workspaceId, edited, fixture.draft.revision); }
        catch (error) { code = error.code; document.querySelector('#error').textContent = error.message; }
        return { code, input: document.querySelector('#input').value, errors: events.filter(e => e.type === 'error').map(e => e.error.code) };
      });
      const after = await current.evaluate(() => rawSnapshot());
      const original = after.rows.meta.find(row => row.key === `photo-post:${f.workspaceId}:${f.original.id}`)?.value;
      const draft = after.rows.meta.find(row => row.key === `photo-post:${f.workspaceId}:${f.draft.id}`)?.value;
      result.evidence = { initialVersion: f.before.version, upgradedVersion: upgraded.version, oldError: attempted.code, oldEvents: attempted.errors, originalDeleted: !original, oldReplacementSaved: draft?.status === 'saved', mdWrites: await current.evaluate(() => mdWrites), unsavedInput: attempted.input };
      // Assert content first: the mutation must reach the actual old writer and
      // demonstrate deletion, rather than failing only a version-number check.
      assert.deepEqual(original, saved, 'old replacement deleted or changed the Markdown original');
      assert.deepEqual(draft, f.draft, 'the old saved draft must remain recoverable');
      assert.equal(attempted.code, 'storage_version_changed');
      assert.ok(attempted.errors.includes('storage_version_changed'));
      assert.equal(attempted.input, '예전 탭에 아직 저장하지 않은 한글 🌳');
      assert.equal(await old.locator('#input').inputValue(), attempted.input);
      assert.match(await old.locator('#error').innerText(), /새로고침/);
      assert.equal(f.before.version, 1); assert.equal(upgraded.version, 2);
      assert.equal(result.evidence.mdWrites, 1);
      const reopened = await open(true);
      const stale = await reopened.evaluate(async () => { try { await S.open(); return null; } catch (error) { return { code: error.code, message: error.message }; } });
      assert.equal(stale?.code, 'storage_version_changed', 'a newly opened old client must fail native VersionError');
      result.evidence.reopenedOldError = stale.code;
      assert.deepEqual((await current.evaluate(() => rawSnapshot())).rows, after.rows);
      await old.screenshot({ path: path.join(output, 'old-input-preserved.png') });
    });
    await scenario('a noncooperating version-1 connection blocks all md writes, including a late upgrade', async (open, result) => {
      const old = await open(true), f = await seed(old);
      await old.evaluate(async () => {
        globalThis.blocker = await idb.openDB('life-tools-v1', 1);
        globalThis.blockerEvents = 0;
        blocker.addEventListener('versionchange', () => { blockerEvents++; });
      });
      const current = await open(false);
      const started = Date.now();
      const opening = await promptly(current.evaluate(async () => { try { await S.open(); return null; } catch (error) { return error.code; } }), 'blocked open');
      const refusalMs = Date.now() - started;
      // Deliberately keep the noncooperating connection alive after the prompt
      // rejection, as a suspended/background tab would, then retry a write.
      await new Promise(resolve => setTimeout(resolve, 1000));
      const attempted = await current.evaluate(async f => {
        try { await S.savePhotoPost(f.workspaceId, HaedoLife.PostMarkdown.fromV2(f.original).document, 0); return null; }
        catch (error) { return error.code; }
      }, f);
      const blockedWrites = await current.evaluate(() => mdWrites);
      const versionEvents = await old.evaluate(() => blockerEvents);
      await old.evaluate(() => blocker.close());
      // A no-version raw open waits behind the pending upgrade and observes it
      // finish. The failed Storage instance must still refuse all later writes.
      const after = await current.evaluate(() => rawSnapshot());
      const late = await current.evaluate(async f => {
        try { await S.savePhotoPost(f.workspaceId, HaedoLife.PostMarkdown.fromV2(f.original).document, 0); return null; }
        catch (error) { return error.code; }
      }, f);
      result.evidence = { opening, attempted, late, refusalMs, blockerHeldAfterRefusalMs: 1000, blockedWrites, finalWrites: await current.evaluate(() => mdWrites), versionEvents, finalVersion: after.version };
      assert.equal(opening, 'storage_blocked'); assert.equal(attempted, 'storage_blocked'); assert.equal(late, 'storage_blocked');
      assert.equal(blockedWrites, 0); assert.equal(result.evidence.finalWrites, 0);
      assert.equal(versionEvents, 1); assert.equal(after.version, 2);
      assert.deepEqual(after.rows, f.before.rows, 'blocked and late-open paths must leave all rows unchanged');
    });
    await scenario('two new tabs concurrently opening upgrade once before either writes Markdown', async (open, result) => {
      const old = await open(true), f = await seed(old);
      const [first, second] = await Promise.all([open(false), open(false)]);
      await promptly(Promise.all([first.evaluate(() => S.open()), second.evaluate(() => S.open())]), 'concurrent new opens');
      const [a, b] = await Promise.all([first.evaluate(() => rawSnapshot()), second.evaluate(() => rawSnapshot())]);
      assert.deepEqual(a.rows, f.before.rows); assert.deepEqual(b.rows, f.before.rows);
      const saved = await Promise.all([first, second].map((page, index) => page.evaluate(async ({ f, index }) => {
        const doc = HaedoLife.PostMarkdown.fromV2(f.original).document;
        doc.id = HaedoLife.Core.id(); doc.title += ' ' + index;
        return S.savePhotoPost(f.workspaceId, doc, 0);
      }, { f, index })));
      const rows = (await first.evaluate(() => rawSnapshot())).rows;
      result.evidence = { versions: [a.version, b.version], mdWrites: await Promise.all([first.evaluate(() => mdWrites), second.evaluate(() => mdWrites)]), oldErrors: await old.evaluate(() => events.filter(e => e.type === 'error').map(e => e.error.code)) };
      assert.deepEqual(result.evidence.versions, [2, 2]);
      assert.deepEqual(result.evidence.mdWrites, [1, 1]);
      assert.deepEqual(result.evidence.oldErrors, ['storage_version_changed']);
      for (const doc of saved) assert.deepEqual(rows.meta.find(row => row.key === `photo-post:${f.workspaceId}:${doc.id}`)?.value, doc);
      for (const name of ['bundles', 'operations', 'staging', 'recovery']) assert.deepEqual(rows[name], f.before.rows[name]);
      assert.deepEqual(rows.meta.find(row => row.key === `photo-post:${f.workspaceId}:${f.draft.id}`)?.value, f.draft);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('Report: ' + path.join(output, 'report.json'));
  }
  if (report.checks.some(check => !check.pass)) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
