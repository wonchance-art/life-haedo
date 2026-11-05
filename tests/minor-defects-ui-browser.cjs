/* E2/E3/E5: real application/IndexedDB with synthetic Auth; no production writes.
 * BASE_URL=http://127.0.0.1:4173 node tests/minor-defects-ui-browser.cjs
 * E_UI_CASE=workspace|header|source selects one mutation target. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright, makeContext, ready, shellReady, settle, importExcerpt } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const out = path.resolve(process.env.E_UI_OUTPUT || '.local/minor-defects-ui');
const selected = process.env.E_UI_CASE;
const report = { scope: 'Synthetic Auth and real IndexedDB, Linux Chromium at 1440/390; no Apple-device or deployment claim', checks: [], geometry: [], errors: [], consoleErrors: [], external: [] };
async function paint(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished.catch(() => {})));
    await new Promise(requestAnimationFrame);
  });
}
async function capture(page, name) {
  await paint(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name + ': horizontal overflow');
  await page.screenshot({ path: path.join(out, name + '.png') });
}
async function workspace(page, width) {
  await page.goto(base + '/index.html?section=manage'); await ready(page);
  const seeded = await page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, active = await s.getActive();
    let b = await s.createWorkspace('손상 검사 합성 공간');
    const p = await c.prepareImport({ origin: 'apple_notes', title: '보존할 합성 원문', text: '이 원문은 손상 안내 검사 뒤에도 지워지지 않습니다.' }, b);
    await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, p) });
    await s.setActive(active);
    return { active, damaged: b.workspaceId, version: p.version.id };
  });
  await page.reload(); await ready(page);
  await page.evaluate(async id => {
    const request = indexedDB.open('life-tools-v1');
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('bundles', 'readwrite'), store = tx.objectStore('bundles'), req = store.get(id);
        req.onsuccess = () => { const b = req.result; b.sourceVersions[0].contentHash = 'broken-hash'; store.put(b); };
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, seeded.damaged);
  await page.locator('#lifeCurrentWorkspace').click();
  await page.locator('#lifeWorkspace').selectOption(seeded.damaged); await settle(page);
  const error = page.locator('#lifeError'); await error.waitFor();
  const message = await error.textContent();
  assert.match(message, /원문|자료/);
  assert.match(message, /다시 가져|백업.*복원/, 'damage notice offers an actionable recovery path');
  assert.match(message, /삭제하지 않았|유지|보존/, 'damage notice confirms preservation');
  assert.doesNotMatch(message, /원문 해시가 올바르지 않습니다/, 'raw hash-validation error is translated');
  const retained = await page.evaluate(async ({ active, damaged, version }) => {
    const s = HaedoLife.Shell.storage;
    const req = indexedDB.open('life-tools-v1'), db = await new Promise(resolve => { req.onsuccess = () => resolve(req.result); });
    try {
      const tx = db.transaction('bundles', 'readonly'), get = tx.objectStore('bundles').get(damaged);
      const b = await new Promise(resolve => { get.onsuccess = () => resolve(get.result); });
      return { sameActive: await s.getActive() === active, preserved: b.sourceVersions[0].id === version && b.sourceVersions[0].contentHash === 'broken-hash', text: b.sourceVersions[0].contentText };
    } finally { db.close(); }
  }, seeded);
  assert.equal(retained.sameActive, true); assert.equal(retained.preserved, true);
  assert.equal(retained.text, '이 원문은 손상 안내 검사 뒤에도 지워지지 않습니다.');
  await capture(page, 'workspace-error-' + width);
  await page.locator('#lifeWorkspace').selectOption(seeded.active); await settle(page);
  assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'sources');
  // Simulate the already-selected workspace becoming damaged before the next launch.
  await page.evaluate(async ({ active, damaged }) => {
    const req = indexedDB.open('life-tools-v1'), db = await new Promise(resolve => { req.onsuccess = () => resolve(req.result); });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite'), store = tx.objectStore('meta'), rows = store.getAll();
        rows.onsuccess = () => {
          const current = rows.result.find(row => row.key.startsWith('activeWorkspace:') && row.value === active);
          if (!current) { tx.abort(); return; }
          store.put({ ...current, value: damaged });
        };
        tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error('active workspace missing'));
      });
    } finally { db.close(); }
  }, seeded);
  await page.reload(); await shellReady(page);
  // Auth may start another foreground check after a failed opening. Capture the
  // completed retry state atomically rather than reading a later loading frame.
  const startup = await (await page.waitForFunction(() => {
    const error=document.querySelector('#lifeStartup[role=alert]');
    return error?.querySelector('button')?.textContent==='다시 확인' ? error.textContent : false;
  })).jsonValue();
  assert.match(startup, /다시 가져|백업.*복원/, 'startup damage also offers recovery');
  assert.match(startup, /삭제하지 않았|유지|보존/);
  assert.doesNotMatch(startup, /원문 해시가 올바르지 않습니다/);
  await capture(page, 'workspace-startup-error-' + width);
  report.checks.push(width + ': corrupt workspace gives recovery guidance and preserves both spaces on switch and reload');
}
async function header(page, width) {
  await page.goto(base + '/index.html?compose=1'); await ready(page);
  await page.locator('#photoTitle').waitFor();
  await page.waitForFunction(()=>document.body.dataset.writingFocus==='true');
  assert.equal(await page.getByRole('button', { name: '통합 검색', exact: true }).isVisible(), false, 'editor keeps search out of focused writing');
  if(width===390) {
    assert.equal(await page.locator('[data-haedo-navigation]').isVisible(),false,'phone editor retains focused navigation behavior');
    assert.equal(await page.locator('[data-haedo-compose]').isVisible(),false,'phone editor keeps its existing compose visibility');
  }
  await page.locator('#photoTitle').fill('다시 읽고 이어 쓰는 합성 기록');
  await page.locator('.ql-editor').fill('읽기와 편집을 오가도 그대로 남을 합성 본문.');
  await paint(page);
  const titleBox = async selector => page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top + scrollY, left: r.left, width: r.width, height: r.height }; });
  const edit = await titleBox('#photoTitle');
  const editBar = await titleBox('.photo-editor-tools');
  await capture(page, 'editor-' + width);
  await page.getByRole('button', { name: '글 저장', exact: true }).click();
  await page.locator('.photo-read-heading').waitFor(); await paint(page);
  const read = await titleBox('.photo-read-heading');
  const readBar = await titleBox('.photo-read-actions');
  report.geometry.push({ width, edit, read, editBar, readBar });
  const commonVisible = await page.locator('.life-app > .life-toolbar').isVisible();
  assert.equal(commonVisible, false, 'PhotoPost reader uses its own single command row, with no duplicate common heading');
  // The approved phone layout may wrap the labelled controls once. The title
  // follows that actual row height; no extra common heading or spacer returns.
  assert.ok(Math.abs(readBar.top - editBar.top) <= 2, 'reading and editing command rows start at the same top');
  assert.ok(Math.abs((read.top - readBar.top - readBar.height) - (edit.top - editBar.top - editBar.height)) <= 2,
    'title follows its command row without extra space: ' + JSON.stringify({ read, edit, readBar, editBar }));
  assert.ok(readBar.height >= editBar.height - 2 && readBar.height <= editBar.height + (width === 390 ? 48 : 2), 'phone controls wrap at most once; desktop keeps one row');
  assert.equal(await page.getByRole('button', { name: '글 수정', exact: true }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name: '사진 포함 백업', exact: true }).isVisible(), true);
  const search = page.locator('.photo-read-actions').getByRole('button', { name: '통합 검색', exact: true });
  assert.equal(await search.isVisible(), true, 'reader has its own named search entry');
  const editLabel = await page.locator('.photo-read-edit > span').evaluate(el => {
    const box=el.getBoundingClientRect(), css=getComputedStyle(el);
    return {text:el.textContent,width:box.width,height:box.height,clipPath:css.clipPath};
  });
  assert.equal(editLabel.text,'수정');
  assert.ok(editLabel.width >= 20 && editLabel.height >= 14 && editLabel.clipPath === 'none', '수정 label must be visibly readable, not an icon-only clipped name');
  await page.locator('.photo-read-actions .photo-privacy').click();
  await page.getByRole('button', { name: '글 정보 닫기', exact: true }).click();
  assert.equal(await page.locator('.photo-read-actions .photo-privacy').evaluate(el => el === document.activeElement), true);
  const compose = page.locator('[data-haedo-compose]');
  assert.equal(await compose.isVisible(), true, 'global compose remains visible while reading at every width');
  const hittable = await page.locator('.photo-read-actions button, .photo-read-actions summary, [data-haedo-compose]').evaluateAll(nodes => nodes.filter(el=>el.getClientRects().length && (el.tagName==='SUMMARY' || !el.closest('details:not([open])'))).map(el => {
    const r=el.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2;
    return {name:el.getAttribute('aria-label')||el.textContent,hit:el.contains(document.elementFromPoint(x,y))};
  }));
  assert.deepEqual(hittable.filter(item=>!item.hit), [], 'reading actions and global compose must remain physically clickable');
  const overlap = await page.locator('.photo-read-actions button, .photo-read-actions summary').evaluateAll(nodes => {
    const compose=document.querySelector('[data-haedo-compose]').getBoundingClientRect();
    return nodes.filter(el=>el.getClientRects().length && (el.tagName==='SUMMARY' || !el.closest('details:not([open])'))).filter(el=>{
      const r=el.getBoundingClientRect();return Math.min(r.right,compose.right)>Math.max(r.left,compose.left)+1 && Math.min(r.bottom,compose.bottom)>Math.max(r.top,compose.top)+1;
    }).map(el=>el.getAttribute('aria-label')||el.textContent);
  });
  assert.deepEqual(overlap, [], 'full reading control rectangles do not overlap global compose');
  await capture(page, 'reader-' + width);
  // A failed export remains visible above the reader; only a success notice moves below it.
  await page.evaluate(() => {window.originalCreateObjectURL=URL.createObjectURL;URL.createObjectURL=()=>{throw new Error('합성 백업 파일 생성 실패');};});
  try {
    await page.getByRole('button',{name:'사진 포함 백업',exact:true}).click();
    await page.locator('.photo-status[role=alert]').waitFor();
    assert.match(await page.locator('.photo-status[role=alert]').textContent(),/합성 백업 파일 생성 실패/);
    const errorTop=await page.locator('.photo-status[role=alert]').evaluate(el=>el.getBoundingClientRect().top);
    assert.ok(errorTop < (await page.locator('.photo-read-heading').boundingBox()).y);
    assert.match(await page.locator('.photo-article').textContent(), /읽기와 편집을 오가도/);
  } finally {await page.evaluate(()=>URL.createObjectURL=originalCreateObjectURL);}

  await page.getByRole('button', { name: '글 수정', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.locator('#photoTitle').waitFor();
  assert.equal(await page.getByRole('button', { name: '통합 검색', exact: true }).isVisible(), false, 'search does not follow the reader into editing');
  assert.equal(await page.locator('#photoTitle').inputValue(), '다시 읽고 이어 쓰는 합성 기록');
  assert.match(await page.locator('.ql-editor').textContent(), /읽기와 편집을 오가도/);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.locator('#lifeMain[data-mode="home"]').waitFor();
  await page.getByRole('button', { name: '다시 읽고 이어 쓰는 합성 기록', exact: true }).click();
  await page.locator('.photo-read-heading').waitFor(); await paint(page);
  assert.equal(await page.locator('.life-app > .life-toolbar').isVisible(), false);
  // The reader's own back action remains usable when the common return disappears.
  const back = page.locator('.photo-read-actions button').first();
  assert.match(await back.getAttribute('aria-label') || await back.textContent(), /돌아가기|목록/);
  await back.focus(); await page.keyboard.press('Enter'); await settle(page);
  await page.locator('#lifeMain[data-mode="home"]').waitFor();
  await page.getByRole('button', { name: '다시 읽고 이어 쓰는 합성 기록', exact: true }).click();
  await page.locator('.photo-read-heading').waitFor();
  const exact = await page.evaluate(async () => {
    const s=HaedoLife.Shell.storage,w=await s.getActive(),post=(await s.listPhotoPosts(w)).find(p=>p.title==='다시 읽고 이어 쓰는 합성 기록'&&p.status==='saved');
    return {id:post.id,doc:await s.readPhotoPost(w,post.id)};
  });
  await page.locator('.photo-read-actions').getByRole('button',{name:'통합 검색',exact:true}).focus(); await page.keyboard.press('Enter');
  await page.locator('#lifeFind[aria-busy="false"]').waitFor();
  await page.locator('#lifeFindQuery').fill('다시 읽고 이어 쓰는 합성 기록');
  const result=page.locator('[data-focus-key="find:photo-post:'+exact.id+'"]');
  await result.focus();
  assert.equal(await result.evaluate(el=>el===document.activeElement),true,'exact saved-post result receives keyboard focus');
  await page.keyboard.press('Enter'); await page.locator('.photo-read-heading').waitFor();
  assert.equal(await page.locator('.photo-read-heading').textContent(),'다시 읽고 이어 쓰는 합성 기록');
  assert.match(await page.locator('.photo-article').textContent(),/읽기와 편집을 오가도 그대로 남을 합성 본문/);
  const returned=await page.evaluate(async id=>{const s=HaedoLife.Shell.storage;return s.readPhotoPost(await s.getActive(),id);},exact.id);
  assert.deepEqual(returned,exact.doc,'search reopens the exact saved document without mutating its revision or body');
  await page.locator('[data-haedo-compose]').click(); await page.locator('#photoTitle').waitFor();
  assert.equal(await page.locator('#photoTitle').inputValue(),'');
  const originals=await page.evaluate(async()=>{const s=HaedoLife.Shell.storage;return s.listPhotoPosts(await s.getActive());});
  assert.ok(originals.some(post=>post.title==='다시 읽고 이어 쓰는 합성 기록' && post.status==='saved'));
  report.checks.push(width + ': single reader command row, visible edit label and search, exact search return, phone wrap/compose separation, export failure, keyboard edit/return, content preservation');
}
async function configureSourceSync(context) {
  await context.route(base + '/assets/life/ui.js', async route => {
    const response = await route.fetch(), source = await response.text();
    await route.fulfill({ response, contentType: 'application/javascript', body: source + `
      {const original = HaedoLife.UI;
      HaedoLife.UI = {...original, mount(container, options) {
        const listeners = new Set(); let phase='pending', hold=null;
        const sync = {...options.sync,
          getAccount: async () => options.storage.account,
          getState: async workspaceId => {
            const bundle = await options.storage.read(workspaceId);
            const result = {workspaceId, binding:{...options.storage.account,remoteId:workspaceId},enabled:true,
              status:phase==='error'?'error':phase==='pending'?'pending':'synced',remoteRevision:1,
              syncedLocalRevision:bundle.revision-(phase==='stale'?1:0),outbox:null,conflict:null,
              error:phase==='error'?{code:'network_error'}:null};
            if(hold){const key=hold;hold=null;await new Promise(resolve=>window[key]=resolve);}return result;
          },
          subscribe: fn => {listeners.add(fn);return()=>listeners.delete(fn);},
          syncNow: async () => {phase='synced';for(const fn of listeners)fn({});},
          set: value => {phase=value;for(const fn of listeners)fn({});},
          hold:key=>hold=key
        };window.sourceStatusSync=sync;
        return original.mount(container,{...options,sync});
      }};}` });
  });
}
async function sourceStatus(page, width) {
  await page.goto(base + '/index.html?section=records'); await ready(page);
  const raw = '첫 합성 원문. 저장된 문장도 그대로 보존합니다. 마지막 줄.';
  await importExcerpt(page, '원문 저장 상태 합성 검사', raw, '저장된 문장도 그대로 보존합니다.');
  const expect = async text => { try { await page.waitForFunction(text => document.querySelector('#lifeSaveStatus')?.textContent === text, text); } catch(error) { assert.equal(await page.locator('#lifeSaveStatus').textContent(),text,error.message); } };
  const set = value => page.evaluate(value => sourceStatusSync.set(value), value);
  await expect('모음에 반영됨 · 저장됨 · 계정에 올리기 대기');
  const before = await page.evaluate(async () => {
    window.sourceStatusSurface = document.querySelector('#lifeMain').firstElementChild;
    const s=HaedoLife.Shell.storage;return JSON.stringify(await s.read(await s.getActive()));
  });
  await set('synced'); await expect('모음에 반영됨 · 저장됨 · 계정에 올림');
  await set('stale'); await expect('모음에 반영됨 · 저장됨 · 계정에 올리기 대기');
  await set('error');
  await page.waitForFunction(() => document.querySelector('#lifeSaveStatus')?.dataset.saveState==='error');
  assert.match(await page.locator('#lifeSaveStatus').textContent(), /계정에 올리지 못함/);
  await page.locator('#lifeSaveStatus').getByRole('button', { name:'다시 시도',exact:true }).click();
  await expect('모음에 반영됨 · 저장됨 · 계정에 올림');
  await page.evaluate(() => {sourceStatusSync.hold('releaseSourceStatus');sourceStatusSync.set('synced');});
  await page.waitForFunction(() => typeof releaseSourceStatus==='function'); await set('error');
  await page.waitForFunction(() => document.querySelector('#lifeSaveStatus')?.dataset.saveState==='error');
  await page.evaluate(() => releaseSourceStatus()); await paint(page);
  assert.equal(await page.locator('#lifeSaveStatus').getAttribute('data-save-state'), 'error');
  assert.equal(await page.evaluate(() => sourceStatusSurface===document.querySelector('#lifeMain').firstElementChild),true);
  const after = await page.evaluate(async () => {const s=HaedoLife.Shell.storage;return JSON.stringify(await s.read(await s.getActive()));});
  assert.equal(after,before,'sync status presentation leaves the exact original and excerpts intact');
  await capture(page,'source-save-status-'+width);
  await page.goto(base+'/index.html?section=records'); await ready(page);
  await page.locator('.life-source-open').filter({hasText:'원문 저장 상태 합성 검사'}).click();
  await page.locator('#lifeSourceText').waitFor();
  assert.equal(await page.locator('.life-app > .life-toolbar').getAttribute('hidden'),'');
  assert.equal(await page.locator('#lifeSourceText').textContent(),raw);
  if(width===390) assert.equal(await page.locator('[data-haedo-compose]').isVisible(),false,'source reader preserves its existing compose visibility');
  assert.equal(await page.locator('#lifeSourceInfoToggle').isVisible(),true);
  report.checks.push(width+': source save pending/exact ACK/stale ACK/failure/retry/late response preserves content and UI, source reader unchanged');
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    report.browser = browser.version();
    for (const width of [1440, 390]) {
      for (const [name, test] of [['workspace', workspace], ['header', header], ['source', sourceStatus]]) {
        if (selected && selected !== name) continue;
        const context = await makeContext(browser, new FakeCloud(), 'minor-e-' + name + width, accounts.a, { viewport: { width, height: 1000 } });
        if (name==='source') await configureSourceSync(context);
        const page = await context.newPage(); page.setDefaultTimeout(12000);
        page.on('pageerror', e => report.errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
        await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.external.push(u.origin); return route.abort(); });
        try { await test(page, width); console.log('PASS', name, width); } finally { await context.close(); }
      }
    }
    assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []);
  } catch (error) { report.failure = error.stack; throw error; }
  finally { await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
