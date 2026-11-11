/* Shared harness of the writing-input browser checks: the real app, the
 * synthetic account (FakeCloud) and the real IndexedDB/localStorage of an
 * isolated Chromium context. Anonymous sample text only. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { playwright, ready, settle, makeContext } = require('../unified-home-browser.cjs');
const { FakeCloud, accounts, base, cloud } = require('../life-sync-browser.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function chromium() {
  const given = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
  if (!fs.existsSync(given) || fs.statSync(given).isFile()) return given;
  // A directory of browser builds (Playwright's cache): the first chrome binary in it.
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name); let stat;
      try { stat = fs.statSync(file); } catch (_) { continue; }
      if (stat.isDirectory()) walk(file, depth + 1); else if (/^(chrome|chromium|headless_shell)$/.test(name)) found.push(file);
    }
  };
  walk(given, 0);
  return found.find(file => /chrome$/.test(file)) || found[0] || given;
}
const launch = () => playwright().chromium.launch({ executablePath: chromium(), headless: true, args: ['--no-sandbox'] });
// Expected browser noise while a scene cuts the connection on purpose.
const OFFLINE = /ERR_INTERNET_DISCONNECTED|ERR_FAILED|Failed to fetch|net::ERR/;
async function newPage(context, problems, name, { dialogs = [], accept = true, offline = () => false } = {}) {
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => problems.push({ scene: name, kind: 'pageerror', message: error.message }));
  page.on('console', event => { if (event.type() === 'error' && !(offline() && OFFLINE.test(event.text()))) problems.push({ scene: name, kind: 'console', message: event.text() }); });
  page.on('dialog', dialog => { dialogs.push(dialog.type() + ':' + dialog.message()); (typeof accept === 'function' ? accept(dialog) : accept ? dialog.accept() : dialog.dismiss()).catch(() => {}); });
  return page;
}
async function session(browser, problems, name, { viewport = { width: 1440, height: 1000 }, device = 'wi-' + name + '-' + Math.random().toString(36).slice(2), server = new FakeCloud(), account = accounts.a, options = {}, page: pageOptions = {} } = {}) {
  const context = await makeContext(browser, server, device, account, { viewport, timezoneId: 'Asia/Seoul', locale: 'ko-KR', ...options });
  const page = await newPage(context, problems, name, pageOptions);
  return { context, page, server };
}
async function home(page) { await page.goto(base + '/index.html'); await ready(page); await settle(page); await page.locator('#homeComposition[aria-busy="false"]').waitFor(); }
async function writer(page) { await page.locator('[data-haedo-compose]:visible').first().click(); await page.locator('#photoTitle').waitFor(); await page.locator('.ql-editor').waitFor(); }
const records = page => page.evaluate(async () => {
  const s = HaedoLife.Shell.storage, w = await s.getActive(), rows = await s.listPhotoPosts(w);
  return Promise.all(rows.map(async r => { const d = await s.readPhotoPost(w, r.id); return { id: d.id, title: d.title, status: d.status, revision: d.revision, archived: d.archived, replaces: d.replaces, text: HaedoLife.PhotoPost.plainText(d), photos: d.photos.length, ops: d.ops }; }));
});
// `detail` is the longer reason shown on its own line under the command row.
const status = page => page.evaluate(() => ({ text: document.querySelector('.photo-status-text')?.textContent ?? null, state: document.querySelector('.photo-status')?.dataset.state ?? null,
  detail: [...document.querySelectorAll('.photo-recovery-reason')].find(node => node.getClientRects().length)?.textContent ?? '' }));
const mode = page => page.evaluate(() => document.querySelector('.photo-posts')?.dataset.mode ?? null);
const quill = (page, fn, arg) => page.evaluate(({ fn, arg }) => (0, eval)('(' + fn + ')')(Quill.find(document.querySelector('.ql-container')), arg), { fn: fn.toString(), arg });
const contents = page => quill(page, q => q.getContents().ops);
const bodyText = page => quill(page, q => q.getText());
// Polls awaited reads: a predicate handed to the page would treat a Promise as true.
async function until(read, accept, label, timeout = 15000) {
  const deadline = Date.now() + timeout; let value;
  do { value = await read(); if (accept(value)) return value; await sleep(50); } while (Date.now() < deadline);
  assert.fail(label + ' · last value: ' + JSON.stringify(value)?.slice(0, 1200));
}
const stored = (page, accept, label) => until(() => records(page), accept, label);
const pasteBody = (page, { text, image = false }) => page.evaluate(async ({ text, image }) => {
  const root = document.querySelector('.ql-editor'); root.focus();
  const data = new DataTransfer();
  if (text != null) data.setData('text/plain', text);
  if (image) {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 80; canvas.getContext('2d').fillRect(0, 0, 300, 80);
    data.items.add(new File([await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))], 'image.png', { type: 'image/png' }));
  }
  root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
}, { text, image });
async function jpeg(page, width = 320, height = 240, color = '#88aacc') {
  const encoded = await page.evaluate(async ({ width, height, color }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const x = canvas.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, width, height); x.fillStyle = '#222'; x.fillRect(8, 8, width / 3, height / 3);
    return canvas.toDataURL('image/jpeg', .9).split(',')[1];
  }, { width, height, color });
  return Buffer.from(encoded, 'base64');
}
const menu = async (page, name) => { await page.locator('.photo-more > summary').click(); await page.locator('.photo-more-menu').getByRole('button', { name, exact: true }).click(); };
const download = (page, act) => Promise.all([page.waitForEvent('download', { timeout: 15000 }), act()]).then(async ([file]) => fs.readFileSync(await file.path()));
// Runs named scenes; a scene failure is reported with its name and the run exits non-zero.
async function run(file, scenes) {
  const browser = await launch(), problems = [], report = { file, browser: browser.version(), passed: [], failed: [] };
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  fs.mkdirSync(path.resolve('.local'), { recursive: true });
  try {
    for (const [name, scene] of Object.entries(scenes)) {
      if (only && !only.test(name)) continue;
      const opened = [];
      const open = async (options = {}) => { const value = await session(browser, problems, name, options); opened.push(value.context); return value; };
      try { await scene({ browser, open, problems, name }); report.passed.push(name); }
      catch (error) { report.failed.push({ name, error: error.stack }); for (const context of opened) for (const page of context.pages()) await page.screenshot({ path: path.resolve('.local', path.basename(file, '.cjs') + '-' + name + '-failure.png') }).catch(() => {}); }
      finally { for (const context of opened) await context.close().catch(() => {}); }
    }
  } finally { await browser.close(); }
  report.problems = problems;
  console.log(JSON.stringify(report, null, 1));
  assert.deepEqual(report.failed.map(item => item.name), [], 'failed scenes');
  assert.deepEqual(problems, [], 'console or page errors');
  assert(report.passed.length > 0, 'no scene ran');
}
module.exports = { assert, sleep, launch, session, newPage, home, writer, records, status, mode, quill, contents, bodyText, until, stored, pasteBody, jpeg, menu, download, run, base, cloud, accounts, FakeCloud };
