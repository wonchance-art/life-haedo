/* Deterministic experiment for tests/record-arrange-browser.cjs:178
 * ("selected page entry …": uncheck had no effect while 저장 중… was shown).
 *
 * Separates
 *   H1 test timing  — the click is not delivered while the layout moves, and
 *   H2 input loss   — the click is delivered, but the save completion puts the
 *                     previous part selection back.
 *
 * The workbench save latency is pinned: storage.saveWorkbench is wrapped by the
 * same storage.js route hook pattern the suite already uses for readWorkbench,
 * and the first save after arming waits for an explicit release. While that
 * save is held, the second part's "… 표시" checkbox is clicked, its state is
 * read immediately (click delivered?), the save is released, and the final
 * checkbox state plus the stored part.enabled are read after the follow-up
 * save completes.
 *
 * Run from the repository root with a static server on BASE_URL:
 *   python3 -m http.server 4184 --bind 127.0.0.1 &
 *   BASE_URL=http://127.0.0.1:4184 PW_MODULE_PATH=<playwright> CHROMIUM_PATH=<chromium> \
 *     node docs/design-review/evidence/structure-workflow-20261102/repro/record-arrange-revert.cjs [runs]
 * Anonymous FakeCloud only; no real account or server.
 */
'use strict';
const path = require('node:path');
const root = path.resolve(__dirname, '../../../../..');
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const { FakeCloud, accounts, base } = require(path.join(root, 'tests/life-sync-browser.cjs'));
const { playwright, ready, settle, makeContext } = require(path.join(root, 'tests/unified-home-browser.cjs'));
const { fixture, current } = require(path.join(root, 'tests/life-workbench-browser.cjs'));

async function holdSaves(context) {
  await context.route(`${base}/assets/life/storage.js`, async route => {
    const response = await route.fetch(), source = await response.text();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async saveWorkbench(...saveArgs){if(window.__holdSave){window.__holdSave=false;window.__saveHeld=true;await new Promise(resolve=>{window.__releaseSave=resolve;});}window.__savesStarted=(window.__savesStarted||0)+1;return actual.saveWorkbench(...saveArgs);}});}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
}
async function records(page) { await page.goto(base + '/index.html?section=records'); await ready(page); await page.locator('#lifeSelectionToggle').waitFor(); }
async function select(page, query, id) {
  await page.locator('#lifeSearch').fill(query);
  const b = page.locator(`.life-source-select[data-version-id="${id}"]`); await b.waitFor();
  if (await b.getAttribute('aria-pressed') !== 'true') await b.click();
}
async function storedEntry(page) { return (await current(page)).workbench.page.entries[0]; }
const status = page => page.locator('#wbStatus').evaluate(n => ({ text: n.textContent, state: n.dataset.state }));

async function run(browser, n) {
  const server = new FakeCloud(), context = await makeContext(browser, server, 'revert-' + n, accounts.a);
  await holdSaves(context);
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    const f = await fixture(page);
    await records(page);
    if (await page.locator('#lifeSelectionToggle').getAttribute('aria-pressed') !== 'true') await page.locator('#lifeSelectionToggle').click();
    await select(page, '처음 받은 본문', f.refs[0].versionId); await select(page, '오후 네 시의 빛', f.refs[1].versionId);
    await page.locator('#lifeSelectionBar .life-arrange-page').click(); await settle(page); await page.locator('#wbIncomingSelection').waitFor();
    await page.locator('#wbIncomingTitle').fill('산책과 전시를 다시 읽는 페이지'); await page.locator('#wbIncomingApply').click();
    await page.waitForFunction(() => document.querySelector('#wbStatus')?.dataset.state === 'saved' && !/저장 중/.test(document.querySelector('#wbStatus').textContent));
    const entryId = (await storedEntry(page)).id, entry = page.locator(`article[data-entry-id="${entryId}"]`);
    for (const details of await entry.locator('details').all()) if (!(await details.evaluate(el => el.open))) await details.locator('summary').first().click();
    const box = entry.locator(`[data-part-version-id="${f.refs[1].versionId}"] input[type=checkbox]`);
    const initial = await box.isChecked();
    // Document-relative checkbox position: shows whether saving moves it.
    const where = () => box.evaluate(el => { const r = el.getBoundingClientRect(); return Math.round(r.top + scrollY); });
    const yBeforeEdit = await where();

    // Pin the next save: the note edit's autosave enters and stays in flight.
    await page.evaluate(() => { window.__holdSave = true; window.__saveHeld = false; });
    await entry.getByLabel('내 코멘트', { exact: true }).fill('내가 고른 조각에서 이어진 질문');
    await page.waitForFunction(() => window.__saveHeld === true);
    const during = await status(page), yWhileHeld = await where();
    const handle = await box.elementHandle();
    await box.click();                                   // plain click, no state retry
    const afterClick = await box.isChecked();            // read before any release
    const storedWhileHeld = (await storedEntry(page)).parts[1].enabled;

    await page.evaluate(() => window.__releaseSave());
    // Completion: the held save and the follow-up save for the toggle are both stored.
    await page.waitForFunction(() => { const s = document.querySelector('#wbStatus'); return s?.dataset.state === 'saved' && !/저장 중/.test(s.textContent); });
    const final = await box.isChecked(), yAfterSave = await where();
    const sameElement = await handle.evaluate(el => el.isConnected);
    const stored = await storedEntry(page);
    const obs = { run: n, initial, statusWhileHeld: during, afterClick, storedWhileHeld, finalChecked: final, checkboxReplaced: !sameElement, yBeforeEdit, yWhileHeld, yAfterSave,
      storedEnabled: stored.parts[1].enabled, storedNote: stored.note === '내가 고른 조각에서 이어진 질문', savesStarted: await page.evaluate(() => window.__savesStarted), pageErrors: errors.length };
    obs.verdict = obs.afterClick !== false ? 'click-not-delivered' : (obs.finalChecked || obs.storedEnabled) ? 'REVERTED (H2)' : 'kept (no revert)';
    return obs;
  } finally { await context.close(); }
}
(async () => {
  const runs = Number(process.argv[2] || 5), browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const results = [];
  try { for (let n = 1; n <= runs; n++) { const r = await run(browser, n); results.push(r); console.log(JSON.stringify(r)); } }
  finally { await browser.close(); }
  const reverted = results.filter(r => r.verdict.startsWith('REVERTED')).length;
  console.log(`record-arrange revert experiment: ${results.length} runs, ${reverted} reverted, ${results.filter(r => r.verdict === 'click-not-delivered').length} click not delivered.`);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
