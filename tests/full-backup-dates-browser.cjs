/* 전체 백업의 글 날짜 (2026-11-11 M2). Posts written on different days are backed up with 모두 받기
 * and restored nine days later into an empty browser and an empty account: every copy keeps its own
 * 작성·수정 시각, so 일정 D·M and the list show the posts on their original days and in their original
 * order, and the copies reach the account without a conflict. A bundle written before this change
 * (list v2, post ZIPs without times) restores with the restore time and the result says so; a post
 * whose times were altered is refused while the others restore.
 * Real app, SDK and IDB with the anonymous intercepted Auth and FakeCloud.
 * npm run dev; node tests/full-backup-dates-browser.cjs
 * Never uses real Google, production Supabase or Apple-device claims. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Z = require('../vendor/fflate/fflate.js');
const { FakeCloud, accounts, base, openBackupCenter } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { blogSyncSettled } = require('./helpers/blog-sync-settle.cjs');

const output = path.resolve(process.env.FULL_BACKUP_DATES_OUTPUT || '.local/full-backup-dates-browser');
const report = { checks: [], consoleErrors: [], pageErrors: [] };
const BACKUP_DAY = '2026-11-11T08:30:00+09:00', RESTORE_DAY = '2026-11-20T08:30:00+09:00';
// Six posts on six days (KST); two were edited on a later day than they were written.
const POSTS = [
  { title: '익명 샘플 글 1', createdAt: '2026-11-10T13:10:00.000Z', updatedAt: '2026-11-10T13:10:00.000Z' },
  { title: '익명 샘플 글 2', createdAt: '2026-11-08T02:00:00.000Z', updatedAt: '2026-11-09T11:00:00.000Z' },
  { title: '익명 샘플 글 3', createdAt: '2026-11-05T09:30:00.000Z', updatedAt: '2026-11-05T09:30:00.000Z' },
  { title: '익명 샘플 글 4', createdAt: '2026-11-02T22:45:00.000Z', updatedAt: '2026-11-02T22:45:00.000Z' },
  { title: '익명 샘플 글 5', createdAt: '2026-10-28T04:15:00.000Z', updatedAt: '2026-11-06T01:00:00.000Z' },
  { title: '익명 샘플 글 6', createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:00:00.000Z' }];
const kstDay = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const list = page => page.waitForFunction(() => document.querySelector('#lifeMain')?.dataset.mode === 'home' && document.querySelector('#homePosts')?.getAttribute('aria-busy') === 'false');
const listTitles = page => page.locator('#homePosts .home-post h3').allInnerTexts();
async function shown(page, mode) {
  await page.waitForFunction(m => document.querySelector('#lifeMain')?.dataset.mode === m && document.querySelector('#lifeSchedule')?.getAttribute('aria-busy') === 'false' && !document.querySelector('.life-app[aria-busy="true"]'), mode);
}
const storedPosts = page => page.evaluate(async () => {
  const s = HaedoLife.Shell.storage, ws = await s.getActive(), out = [];
  for (const row of await s.listPhotoPosts(ws)) { const doc = await s.readPhotoPost(ws, row.id); out.push({ id: doc.id, title: doc.title, status: doc.status, createdAt: doc.createdAt, updatedAt: doc.updatedAt }); }
  return { ws, posts: out.sort((a, b) => a.title.localeCompare(b.title)) };
});
// The bundle with each post ZIP's manifest rewritten and the list's size and hash set to match.
function rewriteBundle(archive, { version, post }) {
  const files = Z.unzipSync(new Uint8Array(archive)), manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
  manifest.version = version;
  for (const file of manifest.files.filter(item => item.kind === 'photoPosts')) {
    const inner = Z.unzipSync(files[file.path]), next = post(JSON.parse(Buffer.from(inner['manifest.json']).toString()));
    files[file.path] = Z.zipSync({ ...inner, 'manifest.json': Z.strToU8(JSON.stringify(next)) }, { level: 0 });
    file.bytes = files[file.path].length; file.sha256 = sha(files[file.path]);
  }
  files['manifest.json'] = Z.strToU8(JSON.stringify(manifest));
  return Buffer.from(Z.zipSync(files, { level: 0 }));
}
async function restore(page, archive) {
  await openBackupCenter(page);
  await page.locator('#fbRestoreFile').setInputFiles({ name: 'haedo-backup.zip', mimeType: 'application/zip', buffer: archive });
  await page.locator('#fbRestoreHeading').waitFor();
  const preview = await page.locator('#fbRestorePreview').innerText();
  await page.locator('#fbRestoreRun').click();
  await page.locator('#fbRestoreResultHeading').waitFor();
  return preview;
}
async function openCopy(page) { await page.locator('#fbRestoreResult button[data-workspace-id]').first().click(); await settle(page); }

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const state = { archive: null, order: null };
  // Every check is its own browser context and its own empty FakeCloud: an empty browser and an empty account.
  async function check(name, run, today) {
    if (process.env.FULL_BACKUP_DATES_MATCH && !new RegExp(process.env.FULL_BACKUP_DATES_MATCH).test(name) && state.archive) return;
    const server = new FakeCloud(), device = 'backup-dates-' + report.checks.length;
    const context = await makeContext(browser, server, device, accounts.a, { viewport: { width: 1440, height: 960 }, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    await page.clock.setFixedTime(new Date(today));
    page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ check: name, message: event.text() }); });
    console.log('RUN ' + name);
    try { await run({ page, server }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    await check('모두 받기: the bundle is list v3 and each post ZIP names the post’s own times', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      await page.evaluate(async posts => {
        const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, ws = await s.getActive();
        for (const [index, post] of posts.entries()) {
          const doc = m.create(c.id, post.createdAt); doc.title = post.title; doc.status = 'saved'; doc.updatedAt = post.updatedAt;
          doc.ops = [{ insert: '퇴근길에 한 정거장 먼저 내려 천변을 따라 걸었다. ' + index + '\n' }];
          await s.savePhotoPost(ws, doc, 0);
        }
      }, POSTS);
      const before = await storedPosts(page);
      assert.deepEqual(before.posts.map(({ title, createdAt, updatedAt }) => ({ title, createdAt, updatedAt })), POSTS);
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      state.order = await listTitles(page);
      assert.equal(state.order.length, 6);
      await openBackupCenter(page);
      await page.locator('#fbInventory [data-kind="photoPosts"]').waitFor();
      const download = page.waitForEvent('download'); await page.locator('#fbDownloadAll').click();
      const file = await download; state.archive = await fs.readFile(await file.path());
      await page.locator('#fbDownloadDone').waitFor();
      const files = Z.unzipSync(new Uint8Array(state.archive)), manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
      assert.equal(manifest.version, 3);
      const inner = manifest.files.filter(item => item.kind === 'photoPosts').map(item => JSON.parse(Buffer.from(Z.unzipSync(files[item.path])['manifest.json']).toString()));
      assert.deepEqual(inner.map(({ title, createdAt, updatedAt }) => ({ title, createdAt, updatedAt })).sort((a, b) => a.title.localeCompare(b.title)), POSTS);
    }, BACKUP_DAY);
    assert.ok(state.archive, 'the bundle was made');

    await check('nine days later, empty browser and account: the copies keep their days in the store, 일정 D·M and the list, and reach the account', async ({ page, server }) => {
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      const preview = await restore(page, state.archive);
      assert.match(preview, /해도 백업 ZIP \(목록 v3\)/);
      assert.equal(await page.locator('#fbRestoreDates').count(), 0, 'nothing to say about dates: every post kept its own');
      await page.screenshot({ path: path.join(output, 'restore-result.png'), fullPage: true });
      await openCopy(page);
      const restored = await storedPosts(page);
      assert.deepEqual(restored.posts.map(({ title, createdAt, updatedAt, status }) => ({ title, createdAt, updatedAt, status })), POSTS.map(post => ({ ...post, status: 'saved' })));
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      assert.deepEqual(await listTitles(page), state.order, 'the list keeps the original order');
      for (const post of POSTS.slice(0, 3)) {
        const day = kstDay(post.createdAt);
        await page.goto(base + '/index.html?section=schedule&view=day&date=' + day); await ready(page); await shown(page, 'day');
        await page.locator('#lifeSchedule [data-schedule-item]').filter({ hasText: post.title }).first().waitFor();
      }
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-20'); await ready(page); await shown(page, 'day');
      assert.equal(await page.locator('#lifeSchedule [data-schedule-item]').count(), 0, 'the restore day holds none of the restored posts');
      await page.goto(base + '/index.html?section=schedule&view=month&date=2026-11-10'); await ready(page); await shown(page, 'month');
      const cells = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#lifeSchedule .schedule-day-cell:not([data-outside])')].filter(cell => cell.querySelector('.schedule-cell-title'))
        .map(cell => [cell.dataset.scheduleGo.split(':')[1], cell.querySelector('.schedule-cell-title').innerText])));
      assert.deepEqual(cells, Object.fromEntries(POSTS.filter(post => kstDay(post.createdAt).startsWith('2026-11')).map(post => [kstDay(post.createdAt), post.title]).sort()), 'M: each November post on its own day, none on the restore day');
      await page.screenshot({ path: path.join(output, 'month-after-restore.png'), fullPage: true });
      // The copies go to the account as new posts with their own (earlier) times: no conflict, no recovery copy.
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      const synced = await blogSyncSettled(page, restored.ws);
      assert.equal(synced.length, 6);
      const rows = [...server.posts.values()].filter(row => !row.deleted_at);
      assert.equal(rows.length, 6, 'six account rows');
      assert.deepEqual(rows.map(row => ({ title: row.data.title, updatedAt: row.data.updatedAt, createdAt: row.data.createdAt })).sort((a, b) => a.title.localeCompare(b.title)),
        POSTS.map(({ title, createdAt, updatedAt }) => ({ title, updatedAt, createdAt })));
      const after = await storedPosts(page);
      assert.deepEqual(after.posts, restored.posts, 'the upload changed no post and added none');
    }, RESTORE_DAY);

    await check('a bundle from before this change (list v2, no times): restored with the restore time, and the result says so', async ({ page }) => {
      const old = rewriteBundle(state.archive, { version: 2, post: ({ createdAt, updatedAt, ...rest }) => rest });
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      const preview = await restore(page, old);
      assert.match(preview, /해도 백업 ZIP \(목록 v2\)/);
      assert.equal(await page.locator('#fbRestoreDates').innerText(), '글 6개는 백업에 작성일·수정일이 없어 복원한 시각으로 저장했습니다.');
      await page.screenshot({ path: path.join(output, 'restore-result-undated.png'), fullPage: true });
      await openCopy(page);
      const restored = await storedPosts(page), now = new Date(RESTORE_DAY).toISOString();
      assert.deepEqual(restored.posts.map(post => [post.createdAt, post.updatedAt]), Array(6).fill([now, now]));
    }, RESTORE_DAY);

    await check('a post whose times were altered is refused; the other posts restore with their days', async ({ page }) => {
      const altered = rewriteBundle(state.archive, { version: 3, post: manifest => manifest.title === '익명 샘플 글 3' ? { ...manifest, updatedAt: '2026-11-01T00:00:00.000Z' } :
        manifest.title === '익명 샘플 글 4' ? { ...manifest, updatedAt: '2026-11-19T23:45:00.000Z' } : manifest });
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      await restore(page, altered);
      const failed = page.locator('#fbRestoreReport [data-kind="photoPosts"][data-status="failed"]');
      assert.match(await failed.innerText(), /익명 샘플 글 3: 사진 글 날짜 순서를 확인해 주세요\./);
      // 글 4 names a time fifteen minutes after this device's clock: it is set to the restore time, and said.
      assert.equal(await page.locator('#fbRestoreDates').innerText(), '글 1개는 날짜가 지금보다 늦어 복원한 시각으로 맞췄습니다.');
      await openCopy(page);
      const restored = await storedPosts(page);
      assert.deepEqual(restored.posts.map(post => post.title), POSTS.filter(post => post.title !== '익명 샘플 글 3').map(post => post.title));
      const four = restored.posts.find(post => post.title === '익명 샘플 글 4');
      assert.deepEqual([four.createdAt, four.updatedAt], [POSTS[3].createdAt, new Date(RESTORE_DAY).toISOString()]);
    }, RESTORE_DAY);
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.pageErrors, [], 'page errors'); assert.deepEqual(report.consoleErrors, [], 'console errors');
  assert(report.checks.length && report.checks.every(item => item.pass), 'all checks pass');
  console.log(JSON.stringify({ checks: report.checks.length }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
