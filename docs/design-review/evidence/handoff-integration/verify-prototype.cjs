/* Independent, synthetic prototype QA. No app/auth/DB helpers are imported.
 * Run from any directory: node docs/design-review/evidence/handoff-integration/verify-prototype.cjs
 * Optional: PW_MODULE_PATH=/installed/playwright CHROMIUM_PATH=/usr/bin/chromium
 * Serves only the frozen prototype HTML on an ephemeral loopback port.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const output = __dirname;
const root = path.resolve(__dirname, '../../../..');
const source = path.join(root, 'docs/prototypes/planning-practice-review.html');
const quote = '퇴근 후 짧게 읽고, 기억에 남는 문장을 남긴다.';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function playwright() {
  for (const name of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core', '/opt/codex/cua_node/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('An installed Playwright module is required.');
}
const report = {
  date: '2026-10-29', scope: 'Independent QA of one synthetic, memory-only HTML prototype. No product account, backend, deployment, real-device or human-usefulness claim.',
  checks: [], comparison: {}, screens: [], audits: [], failures: [],
  measurement: 'One intentional button activation, one select choice, one complete text-entry operation or one explicit text-range selection counts as one action. Setup, assertions, screenshots and reloads are excluded. No timing or percentage improvement is reported. Comparison tests an unnecessary memo detour for the same connection-only goal; it does not rank a genuine memo-writing task below direct connection.',
  limitations: ['The source sentence is preselected in a fixed synthetic fixture; arbitrary original-text selection is not implemented.', 'This prototype connects saved memo text only. The design allowance for directly connecting unsaved memo text is outside this demonstration.', 'Storage, account continuity, remote failures, backup restoration and real Apple devices are outside this demonstration.'],
  priorEvidence: [{file:'report-initial.json',classification:'Initial 15 scenarios; one harness timing assertion read the DOM before the native dialog close handler completed. Original 7-second limit retained; corrected test waits for exact-date row removal.'},{file:'report-contract-failures.json',classification:'Focused run reproduced two prototype defects: missing explicit memo return after connection and unrelated default period selection on contextual target entry. Check correction passed after the harness correction.'}]
};
let browser, server, url;
async function visible(page, selector, expected = true) { assert.equal(await page.locator(selector).isVisible(), expected, selector + ' visibility'); }
async function text(page, selector) { return page.locator(selector).innerText(); }
async function has(page, selector, pattern) { assert.match(await text(page, selector), pattern); }
async function openDetails(page, id) { const node = page.locator('#' + id); if (!await node.getAttribute('open').then(v => v !== null)) await node.locator('summary').click(); }
async function scope(page, plan, habit, goal) {
  for (const [key, value] of Object.entries({plan, habit, goal})) await page.locator('#include-' + key).setChecked(value);
}
async function inspect(page) { await page.locator('#inspect-period').click(); await visible(page, '#review-view'); }
async function fresh(width = 820) {
  const context = await browser.newContext({ viewport: {width, height: 1000}, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
  const audit = { documentRequests: 0, additionalRequests: [], storageAccess: [], pageErrors: [], consoleErrors: [] };
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.url() === url && request.method() === 'GET' && request.resourceType() === 'document') { audit.documentRequests++; await route.continue(); }
    else { audit.additionalRequests.push({url: request.url(), method: request.method(), resourceType: request.resourceType()}); await route.abort('blockedbyclient'); }
  });
  await context.exposeBinding('__reportPrototypeViolation', (_source, name) => { audit.storageAccess.push(name); });
  await context.addInitScript(() => {
    window.__prototypeAudit = [];
    const blocked = name => { window.__prototypeAudit.push(name); window.__reportPrototypeViolation(name); throw new Error('Prototype must not access ' + name); };
    for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) {
      Object.defineProperty(window, name, { configurable: true, get: () => blocked(name) });
    }
    window.fetch = () => blocked('fetch');
    window.XMLHttpRequest = function () { blocked('XMLHttpRequest'); };
    window.WebSocket = function () { blocked('WebSocket'); };
    window.EventSource = function () { blocked('EventSource'); };
    navigator.sendBeacon = () => blocked('sendBeacon');
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => blocked('serviceWorker.register');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => audit.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') audit.consoleErrors.push(message.text()); });
  await page.goto(url, {waitUntil: 'load'});
  return {context, page, audit};
}
async function check(name, run, width = 820) {
  if (process.env.QA_CASE_FILTER && !new RegExp(process.env.QA_CASE_FILTER).test(name)) return;
  const {context, page, audit} = await fresh(width);
  try {
    const detail = await run(page);
    report.checks.push({name, status: 'passed', ...(detail ? {detail} : {})});
  } catch (error) {
    const failure = {name, message: error.message, stack: error.stack, visibleText: (await page.locator('body').innerText().catch(() => '')).slice(0, 9000)};
    report.failures.push(failure); report.checks.push({name, status: 'failed', message: error.message});
  } finally {
    const finalAccess = await page.evaluate(() => window.__prototypeAudit).catch(() => ['audit unavailable']);
    audit.storageAccess = [...new Set([...audit.storageAccess,...finalAccess])];
    report.audits.push({name, ...audit}); await context.close();
  }
}
async function originalValues(page) {
  return {
    plan: await page.locator('#current-plan').textContent(),
    days: await page.locator('#habit-days').textContent(),
    dates: await page.locator('#check-list time').evaluateAll(nodes => nodes.map(node => node.dateTime)),
    progress: await page.locator('#goal-progress').inputValue(),
    deadline: await page.locator('#goal-deadline').textContent()
  };
}
async function readingStart(page) {
  await page.locator('#nav-reading').click(); await visible(page, '#reading-view');
  assert.equal(await page.locator('#reading-source').getAttribute('data-source-id'), 'example-source-reading');
  assert.equal(await page.locator('#reading-source').getAttribute('data-version-id'), 'example-source-reading-v1');
  assert.equal(await page.locator('#reading-selected-sentence').textContent(), quote);
}
async function monthlyLink(page, kind, intent) {
  await openDetails(page, 'link-editor');
  await page.locator('#intent-text').fill(intent);
  await page.locator('#link-target').selectOption(kind);
  await page.locator('#link-form button[type=submit]').click();
}
async function geometry(page) {
  return page.evaluate(() => {
    const shown = el => { const r=el.getBoundingClientRect(), s=getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    const controls = [...document.querySelectorAll('button,summary,input,select,textarea')].filter(shown);
    const short = controls.filter(el => {
      const owner = el.matches('input[type=checkbox],input[type=radio]') ? el.closest('label') : el;
      return owner.getBoundingClientRect().height < 43.9;
    }).map(el => el.id || el.textContent.slice(0, 50));
    const smallInput = controls.filter(el => el.matches('input,select,textarea') && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id);
    return {viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, shortControls: short, smallInputs: smallInput};
  });
}
async function screenshot(page, name, scene) {
  // A full-page image captured after focusing the comparison heading would
  // paint the sticky navigation halfway down the composite. Normalize scroll
  // before capture; this changes no application state or style.
  await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
  await page.waitForFunction(()=>window.scrollY===0);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const measured = await geometry(page);
  assert.ok(measured.documentWidth <= measured.viewport + 1, 'Document overflow');
  assert.deepEqual(measured.shortControls, []); assert.deepEqual(measured.smallInputs, []);
  await page.screenshot({path:path.join(output,name), fullPage:true});
  report.screens.push({file:name,sha256:sha(await fs.readFile(path.join(output,name))),scene,...measured,visualReview:'Independent image review is separate; match this hash against visual-review.json.'});
}
(async () => {
  const bytes = await fs.readFile(source), startHash = sha(bytes);
  server = http.createServer((request, response) => {
    if (request.url !== '/planning-practice-review.html' || request.method !== 'GET') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'}); response.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = 'http://127.0.0.1:' + server.address().port + '/planning-practice-review.html';
  browser = await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless:true, args:['--no-sandbox']});
  report.environment = {browser:await browser.version(), viewportWidths:[390,820,1440], timezone:'Asia/Seoul', host:'127.0.0.1 ephemeral port; only frozen HTML document served', storage:'All storage API access blocked and audited', browserClaims:'Linux Chromium viewport simulation only'};
  report.source = {path:'docs/prototypes/planning-practice-review.html', sha256:startHash};

  await check('Initial plan and original values preserved; inclusive date boundary and one-day period', async page => {
    assert.equal(await text(page,'#current-plan'), quote); await has(page,'#check-summary',/6일/);
    await page.locator('#period-start').fill('2026-10-02'); await page.locator('#period-end').fill('2026-10-07');
    await inspect(page); await has(page,'#preview-content',/체크한 날 3일/); await has(page,'#preview-period',/2026.10.02 — 2026.10.07/);
    await page.locator('#back-to-period').click(); await page.locator('#period-start').fill('2026-10-07');
    await inspect(page); await has(page,'#preview-content',/체크한 날 1일/); await has(page,'#preview-content',/중복 1개/);
    await page.locator('#back-to-period').click();
    for (const [start,end] of [['','2026-10-07'],['2026-10-08','2026-10-07'],['2026-10-30','2026-10-31']]) {
      await page.locator('#period-start').fill(start); await page.locator('#period-end').fill(end); await page.locator('#inspect-period').click(); await visible(page,'#period-error'); await visible(page,'#workspace-view');
    }
  });
  await check('Existing monthly/direct link requires target, cancels duplicate creation and preserves target data', async page => {
    const before = await originalValues(page); await openDetails(page,'link-editor');
    await page.locator('#link-form button[type=submit]').click(); await has(page,'#link-message',/대상을 선택/); assert.equal(await page.locator('#link-summary [data-link-id]').count(),0);
    await monthlyLink(page,'habit','월 방향 연결'); await page.locator('#link-form button[type=submit]').click(); assert.equal(await page.locator('#link-summary [data-link-id]').count(),1);
    await page.locator('[name=intent-origin][value=direct]').check(); await monthlyLink(page,'goal','직접 선택한 의도');
    assert.equal(await page.locator('#link-summary [data-link-id]').count(),2); assert.deepEqual(await originalValues(page),before);
  });
  await check('Current weekday change, keyboard cancel and explicit duplicate-date correction preserve other dates', async page => {
    const before = await originalValues(page); await openDetails(page,'days-editor');
    for (let day=0;day<7;day++) await page.locator('[name=habit-day][value="'+day+'"]').uncheck();
    await page.locator('#days-form button[type=submit]').click(); await has(page,'#days-message',/하나 이상/); assert.equal(await text(page,'#habit-days'),before.days);
    for (const day of [2,4]) await page.locator('[name=habit-day][value="'+day+'"]').check();
    await page.locator('#days-form button[type=submit]').click(); await has(page,'#habit-days',/화·목/);
    await openDetails(page,'checks-detail'); const correction=page.locator('[data-correct-date="2026-10-07"]');
    await correction.focus(); await page.keyboard.press('Enter'); await visible(page,'#correction-dialog'); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.correctDate),'2026-10-07'); await has(page,'#check-list',/2개 중복/);
    await correction.click(); await page.locator('#confirm-correction').click(); await correction.waitFor({state:'detached'}); assert.equal(await correction.count(),0); await has(page,'#check-summary',/5일/);
    assert.deepEqual((await originalValues(page)).dates,before.dates.filter(date=>date!=='2026-10-07'));
    for (const date of ['','2026-10-30','2026-10-26']) { await page.locator('#check-date').fill(date); await page.locator('#add-check-form button').click(); await has(page,'#check-message',/선택해/); }
    await page.locator('#check-date').fill('2026-10-27'); await page.locator('#add-check-form button').click(); await has(page,'#check-summary',/6일/);
  });
  await check('Frozen saved review and optional note remain unchanged after current plan/check/progress edits', async page => {
    await inspect(page); await page.locator('#review-note').fill('익명 검수 판단 🌱'); await page.locator('#save-review').click();
    const before = await text(page,'#saved-content'); assert.equal(await text(page,'#saved-note'),'익명 검수 판단 🌱');
    await page.locator('#edit-current').click(); await page.locator('#plan-text').fill('현재 문장만 수정'); await page.locator('#plan-form button').click();
    await page.locator('#current-target').selectOption('goal'); await page.locator('#goal-progress').fill('100'); await page.locator('#goal-form button').click();
    await page.locator('#current-target').selectOption('habit'); await openDetails(page,'checks-detail'); await page.locator('[data-correct-date="2026-10-02"]').click(); await page.locator('#confirm-correction').click();
    await page.locator('[data-review-id="1"]').click(); assert.equal(await text(page,'#saved-content'),before);
    await page.locator('#compare-current').click(); await has(page,'#comparison-content',/현재 문장만 수정/); await has(page,'#comparison-content',/100%/); await has(page,'#comparison-content',/5일/);
    await page.locator('#back-to-workspace').click(); await inspect(page); await page.locator('#save-review').click(); await has(page,'#saved-note',/판단을 남기지/);
  });
  await check('Reading alone ends without memo/link/review; reload resets the synthetic session', async page => {
    await readingStart(page); await page.locator('#reading-finish').click(); await visible(page,'#end-view'); await page.locator('#resume-demo').click(); await visible(page,'#reading-view');
    assert.equal(await page.locator('#reading-link-list button').count(),0); await visible(page,'#reading-saved-memo',false);
    await page.reload(); await visible(page,'#workspace-view'); assert.equal(await page.locator('#saved-list button').count(),0); assert.equal(await page.locator('#link-summary [data-link-id]').count(),0);
  });
  await check('Direct reading path: exact source, unselected target rejection, cancel and session draft/selection preservation', async page => {
    await readingStart(page); await page.locator('#reading-direct-link').click(); assert.equal(await page.locator('#reading-link-target').inputValue(),'');
    await page.locator('#reading-link-save').click(); await has(page,'#reading-link-message',/대상을 선택/);
    const draft='원문에서 확인한 내 의도'; await page.locator('#reading-link-intent').fill(draft); await page.locator('#reading-link-target').selectOption('goal');
    await page.locator('#reading-link-intent').focus(); await page.locator('#reading-link-intent').evaluate(el=>el.setSelectionRange(3,6));
    await page.locator('#nav-planning').click(); await page.locator('#nav-reading').click();
    assert.equal(await page.locator('#reading-link-intent').inputValue(),draft); assert.deepEqual(await page.locator('#reading-link-intent').evaluate(el=>[el.selectionStart,el.selectionEnd]),[3,6]);
    await page.locator('#reading-link-cancel').click(); await visible(page,'#reading-view'); assert.equal(await page.locator('#reading-link-list button').count(),0);
    await page.locator('#reading-direct-link').click(); assert.equal(await page.locator('#reading-link-intent').inputValue(),draft); assert.equal(await page.locator('#reading-link-target').inputValue(),'goal');
    await page.locator('#reading-link-save').click(); await page.locator('#reading-link-save').click(); await page.locator('#reading-link-return').click();
    assert.equal(await page.locator('#reading-link-list button').count(),1); assert.equal(await page.locator('#reading-link-list button').getAttribute('data-target-id'),'example-goal-book');
    assert.equal(await page.locator('#reading-source').getAttribute('data-version-id'),'example-source-reading-v1');
  });
  for (const route of ['direct','memo']) await check('Controlled action comparison: '+route, async page => {
    await readingStart(page); const before = await originalValues(page), actions=[];
    const act = async (name,run) => { await run(); actions.push(name); };
    if(route==='direct') await act('Open direct connection',()=>page.locator('#reading-direct-link').click());
    else {
      await act('Open memo',()=>page.locator('#reading-memo').click());
      await act('Insert the same source sentence with the existing explicit button',()=>page.locator('#memo-insert-quote').click());
      await act('Explicitly save memo',()=>page.locator('#memo-save').click());
      assert.equal(await page.locator('#memo-selected-text').inputValue(),'');
      await act('Explicitly select the saved memo phrase',async()=>{await page.locator('#memo-saved-text').focus();await page.keyboard.press('ControlOrMeta+A');});
      await act('Bring only the selected phrase into the connection input',()=>page.locator('#memo-use-selection').click());
      await act('Open connection from that phrase',()=>page.locator('#memo-connect').click());
    }
    assert.equal(await page.locator('#reading-link-intent').inputValue(),quote);
    await act('Choose the existing book goal',()=>page.locator('#reading-link-target').selectOption('goal'));
    await act('Confirm connection',()=>page.locator('#reading-link-save').click());
    await act('Return to the same source',()=>page.locator('#reading-link-return').click());
    await visible(page,'#reading-view'); assert.equal(await page.locator('#reading-link-list button').count(),1); assert.deepEqual(await originalValues(page),before);
    report.comparison[route]={start:'Same source/version and preselected sentence visible in reader; no memo or relation',end:'Same source visible; one relation with same intent and target; original plan/habit/goal unchanged',sourceId:'example-source-reading',sourceVersionId:'example-source-reading-v1',intent:quote,targetId:'example-goal-book',actionCount:actions.length,actions,reenteredText:0,extraMemo:route==='memo'};
  });
  await check('Memo selection excludes private remainder, blocks unsaved edit and resolves repeated phrase explicitly', async page => {
    await readingStart(page); await page.locator('#reading-memo').click(); await page.locator('#memo-save').click(); await has(page,'#memo-message',/입력해/); await visible(page,'#memo-selection-section',false);
    const memo='개인 앞부분\n'+quote+'\n개인 뒷부분'; await page.locator('#memo-body').fill(memo); await page.locator('#memo-save').click();
    assert.equal(await page.locator('#memo-selected-text').inputValue(),''); await page.locator('#memo-selected-text').fill(quote);
    await page.locator('#memo-body').fill(memo+' 수정 중'); await page.locator('#memo-connect').click(); await has(page,'#memo-selection-message',/먼저 저장/); await visible(page,'#memo-view');
    await page.locator('#memo-body').fill(memo); await page.locator('#memo-connect').click(); assert.equal(await page.locator('#reading-link-intent').inputValue(),quote); await page.locator('#reading-link-cancel').click();
    await page.locator('#memo-body').fill('같은 문구 / 같은 문구'); await page.locator('#memo-save').click(); await page.locator('#memo-selected-text').fill('같은 문구');
    await page.locator('#memo-connect').click(); await has(page,'#memo-selection-message',/여러 곳/);
    await page.locator('#memo-saved-text').evaluate(el=>{el.focus();el.setSelectionRange(8,13);}); await page.locator('#memo-use-selection').click();
    await page.locator('#memo-connect').click(); await visible(page,'#reading-link-view'); assert.equal(await page.locator('#reading-link-intent').inputValue(),'같은 문구');
  });
  await check('Period scope: plan-only accepted, empty scope rejected, habit-only excludes unselected goal/month payload', async page => {
    await scope(page,true,false,false); await inspect(page); await has(page,'#preview-content',/계획/); assert.doesNotMatch(await text(page,'#preview-content'),/체크한 날|현재 진척/);
    await page.locator('#back-to-period').click(); await scope(page,false,false,false); await page.locator('#inspect-period').click(); await has(page,'#period-error',/하나 이상/);
    await monthlyLink(page,'goal','목표만의 관계 표시'); await page.locator('[name=intent-origin][value=direct]').check(); await monthlyLink(page,'habit','습관만의 관계 표시');
    await scope(page,false,true,false); await inspect(page); const content=await text(page,'#preview-content');
    assert.match(content,/습관만의 관계 표시/); assert.doesNotMatch(content,/목표만의 관계 표시|현재 진척|퇴근 후 짧게 읽고/);
    assert.deepEqual(await page.locator('#preview-content [data-snapshot-target]').evaluateAll(nodes=>nodes.map(node=>node.dataset.snapshotTarget)),['example-habit-reading']);
  });
  await check('Memo connection success exposes an explicit return to the same memo, separate from source return', async page => {
    await readingStart(page); await page.locator('#reading-memo').click(); await page.locator('#memo-body').fill('개인 판단과 연결할 문구'); await page.locator('#memo-save').click();
    await page.locator('#memo-selected-text').fill('연결할 문구'); await page.locator('#memo-connect').click(); await page.locator('#reading-link-target').selectOption('habit'); await page.locator('#reading-link-save').click();
    await page.getByRole('button',{name:'메모로 돌아가기',exact:true}).click(); await visible(page,'#memo-view'); assert.equal(await page.locator('#memo-body').inputValue(),'개인 판단과 연결할 문구'); assert.equal(await page.locator('#memo-selected-text').inputValue(),'연결할 문구'); assert.equal(await page.evaluate(()=>document.querySelector('#memo-view').contains(document.activeElement)),true);
  });
  await check('A linked reading target carries its period scope without unrelated default selections', async page => {
    for (const kind of ['habit','goal']) {
      if(kind==='goal')await page.reload();
      await readingStart(page); await page.locator('#reading-direct-link').click(); await page.locator('#reading-link-target').selectOption(kind); await page.locator('#reading-link-save').click(); await page.locator('#reading-link-return').click();
      await page.locator('#reading-link-list button').click(); await visible(page,'#workspace-view');
      assert.equal(await page.locator('#current-target').inputValue(),kind); assert.equal(await page.locator('#include-habit').isChecked(),kind==='habit'); assert.equal(await page.locator('#include-goal').isChecked(),kind==='goal'); assert.equal(await page.locator('#include-plan').isChecked(),false);
      await inspect(page); const preview=await text(page,'#preview-content'); assert.doesNotMatch(preview,/확인한 현재 문장/); assert.doesNotMatch(preview,kind==='habit'?/현재 진척/:/체크한 날/);
      await page.locator('#save-review').click(); await page.locator('#edit-current').click();
      assert.equal(await page.evaluate(()=>document.activeElement.id),kind==='habit'?'check-summary':'goal-progress');
    }
    return {targetKinds:['habit','goal']};
  });
  await check('Unselected target modification does not invalidate a draft; selected target change preserves note and requires review', async page => {
    await scope(page,false,true,false); await inspect(page); await page.locator('#review-note').fill('선택한 습관 판단'); await page.locator('#back-to-period').click();
    await page.locator('#current-target').selectOption('goal'); await page.locator('#goal-progress').fill('80'); await page.locator('#goal-form button').click();
    await page.locator('#resume-preview').click(); await page.locator('#save-review').click(); await visible(page,'#saved-view'); assert.equal(await text(page,'#saved-note'),'선택한 습관 판단');
    await page.locator('#back-to-workspace').click(); await inspect(page); await page.locator('#review-note').fill('보존해야 할 새 판단'); await page.locator('#back-to-period').click();
    await page.locator('#current-target').selectOption('habit'); await page.locator('#check-date').fill('2026-10-26'); await page.locator('#add-check-form button').click();
    await page.locator('#resume-preview').click(); await page.locator('#save-review').click(); await has(page,'#review-error',/선택한 내용이 바뀌/); assert.equal(await page.locator('#review-note').inputValue(),'보존해야 할 새 판단');
    await page.locator('#back-to-period').click(); await inspect(page); assert.equal(await page.locator('#review-note').inputValue(),'보존해야 할 새 판단'); await page.locator('#save-review').click(); await visible(page,'#saved-view');
  });
  await check('Preview and saved review source links return to the exact reading fixture without altering saved content', async page => {
    await readingStart(page); await page.locator('#reading-direct-link').click(); await page.locator('#reading-link-target').selectOption('habit'); await page.locator('#reading-link-save').click(); await page.locator('#nav-planning').click();
    await scope(page,false,true,false); await inspect(page); const preview=await text(page,'#preview-content'); await page.locator('#preview-content [data-return-source]').click(); await visible(page,'#reading-view');
    await page.locator('#nav-planning').click(); await visible(page,'#review-view'); assert.equal(await text(page,'#preview-content'),preview); await page.locator('#save-review').click();
    const saved=await text(page,'#saved-content'); await page.locator('#saved-content [data-return-source]').click(); await visible(page,'#reading-view'); await page.locator('#nav-planning').click(); assert.equal(await text(page,'#saved-content'),saved);
  });
  await check('390px reading screen and keyboard entry', async page => { await page.locator('#nav-reading').focus(); await page.keyboard.press('Enter'); await visible(page,'#reading-view'); await screenshot(page,'reading-390.png','Reading entry; no link or memo created'); },390);
  await check('820px selected scope screen', async page => { await scope(page,false,true,false); await inspect(page); await screenshot(page,'period-820.png','Habit-only period preview; no unselected plan or goal'); },820);
  await check('1440px saved/current comparison screen', async page => {
    await inspect(page); await page.locator('#review-note').fill('다음 달도 내 속도로 읽어 본다.'); await page.locator('#save-review').click(); await page.locator('#edit-current').click(); await page.locator('#plan-text').fill('시간을 정하기보다 짧게 다시 읽는다.'); await page.locator('#plan-form button').click(); await page.locator('[data-review-id="1"]').click(); await page.locator('#compare-current').click();
    const viewport = await page.evaluate(()=>{
      const nav=document.querySelector('.entry-nav').getBoundingClientRect(), heading=document.querySelector('#comparison-heading').getBoundingClientRect();
      return {scrollY,viewportHeight:innerHeight,nav:{top:nav.top,bottom:nav.bottom},focusedHeading:{top:heading.top,bottom:heading.bottom},activeElement:document.activeElement.id};
    });
    assert.equal(viewport.activeElement,'comparison-heading');assert.ok(viewport.nav.top>=-1&&viewport.nav.top<=1);assert.ok(viewport.focusedHeading.top>=viewport.nav.bottom&&viewport.focusedHeading.bottom<=viewport.viewportHeight);
    report.scrolledViewport=viewport;
    await screenshot(page,'saved-comparison-1440.png','Frozen saved values compared with current plan; scroll normalized before full-page capture');
  },1440);
  const endHash=sha(await fs.readFile(source)); report.source.endSha256=endHash; report.source.unchanged=startHash===endHash;
  report.auditPassed=report.audits.every(a=>!a.additionalRequests.length&&!a.storageAccess.length&&!a.pageErrors.length&&!a.consoleErrors.length);
  report.pass=report.failures.length===0&&report.auditPassed&&report.source.unchanged;
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,failures:report.failures.map(f=>({name:f.name,message:f.message})),auditPassed:report.auditPassed,sourceUnchanged:report.source.unchanged,comparison:report.comparison},null,2));
  if(!report.pass)process.exitCode=1;
})().catch(async error=>{
  report.failures.push({name:'runner',message:error.message,stack:error.stack});report.pass=false;
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n').catch(()=>{});
  console.error(error.stack);process.exitCode=1;
}).finally(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
