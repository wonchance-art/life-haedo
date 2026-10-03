/* Optional real-browser checks. No application dependency or remote service required.
 * Run with the development server: node tests/life-browser.cjs
 * BASE_URL, PW_MODULE_PATH, CHROMIUM_PATH can select existing local tools.
 * Chromium viewport emulation is not an Apple hardware / iPad file-provider test.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {FakeCloud,platformContext,cloud}=require('./life-sync-browser.cjs');

function loadPlaywright() {
  const candidates = [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core',
    '/opt/codex/cua_node/lib/node_modules/playwright',
    '/opt/codex/cua_node/lib/node_modules/playwright-core'].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('Playwright is unavailable; set PW_MODULE_PATH to an existing installation.');
}

const base = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) {
  throw new Error('This anonymous, isolated test suite only runs against localhost.');
}
const failures = [];
const storageOnly = process.argv.includes('--storage-only');
let passed = 0;
async function check(name, action) {
  try { await action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}\n${error.stack}`); }
}

async function shellChecks(browser, observe) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.__privateReads = {idb:0,legacy:0};
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) { window.__privateReads.idb++; return open.apply(this,args); };
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'caeyeon_life_registry' || String(key).startsWith('caeyeon_life_doc_')) window.__privateReads.legacy++;
      return get.call(this,key);
    };
  });
  try {
    await check('read-only route never opens private IDB, legacy storage or service worker', async () => {
      const page = await context.newPage(); observe(page);
      await page.goto(`${base}/life.html?view-only=1`);
      await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.ready);
      await page.evaluate(() => HaedoLife.Shell.ready);
      assert.deepEqual(await page.evaluate(() => __privateReads),{idb:0,legacy:0});
      assert.equal(await page.locator('#lifeApp').textContent(),'');
      assert.match(await page.locator('#lifeStartup').textContent(),/읽기 전용/);
      assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),0);
    });
  } finally { await context.close(); }
}

async function delayedPrepareCheck(browser, observe) {
  const context = await browser.newContext({serviceWorkers:'block'});
  try {
    await check('UI regression: changed input discards delayed prepare result', async () => {
      const page = await context.newPage(); observe(page);
      await page.goto(`${base}/life.html?view-only=1`);
      await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.ready);
      await page.evaluate(async () => {
        await HaedoLife.Shell.ready;
        const original = HaedoLife.Core;
        let delayOnce = true;
        const core = {...original,prepareImport:async (...args) => {
          const prepared = await original.prepareImport(...args);
          if (delayOnce) {
            delayOnce = false;
            window.__prepareWaiting = true;
            await new Promise(resolve => { window.__releasePrepare = resolve; });
          }
          return prepared;
        }};
        await HaedoLife.UI.mount(document.querySelector('#lifeApp'),{core,storage:HaedoLife.Storage,legacy:HaedoLife.Legacy});
        document.querySelector('#lifeApp').hidden=false;
      });
      await page.getByRole('button',{name:'가져오기',exact:true}).click();
      await page.locator('#lifeImportTitle').fill('비동기 검토 경합');
      await page.locator('#lifeImportText').fill('검토 시작 때의 원문');
      await page.getByRole('button',{name:'원문·출처 확인',exact:true}).click();
      await page.waitForFunction(() => window.__prepareWaiting);
      assert.ok(await page.locator('#lifeImportText').isDisabled(),'pending prepare left input editable');
      await page.locator('#lifeImportText').evaluate(input => {
        // Force the otherwise-disabled event to cover the completion-time guard,
        // without replacing core validation or the browser's IndexedDB.
        input.value = '기다리는 동안 바뀐 원문';
        input.dispatchEvent(new Event('input',{bubbles:true}));
        window.__releasePrepare();
      });
      await page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]'));
      assert.equal(await page.locator('.life-review').count(),0,'stale source preview survived');
      assert.equal(await page.getByRole('button',{name:'자료만 보관',exact:true}).count(),0);
      assert.match(await page.locator('#lifeError').textContent(),/입력이 바뀌어/);
      assert.equal(await page.locator('#lifeImportText').inputValue(),'기다리는 동안 바뀐 원문');
      assert.equal(await page.evaluate(async () => (await HaedoLife.Storage.read(await HaedoLife.Storage.getActive())).sources.length),0);
      await page.getByRole('button',{name:'원문·출처 확인',exact:true}).click();
      await page.locator('#lifeReviewText').waitFor();
      assert.equal(await page.locator('#lifeReviewText').inputValue(),'기다리는 동안 바뀐 원문');
    });
  } finally { await context.close(); }
}

async function applicationChecks(browser, observe) {
  const context = await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const cloudFixture=new FakeCloud();
  await platformContext(context,cloudFixture,'r1');
  const legacySeed = {
    caeyeon_life_registry: JSON.stringify({current:'anonymous-original',docs:[{id:'anonymous-original',name:'익명 기존 연표'}]}),
    caeyeon_life_doc_anonymous: JSON.stringify({events:[],marker:'unchanged'})
  };
  await context.addInitScript(seed => {
    if (!localStorage.getItem('life-test-seeded')) {
      for (const [key,value] of Object.entries(seed)) localStorage.setItem(key,value);
      localStorage.setItem('life-test-seeded','1');
    }
    window.__legacyAccess = [];
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.getItem = function (key) {
      if (Object.hasOwn(seed,key)) __legacyAccess.push({kind:'read',key});
      return get.call(this,key);
    };
    Storage.prototype.setItem = function (key,value) {
      if (Object.hasOwn(seed,key)) __legacyAccess.push({kind:'write',key});
      return set.call(this,key,value);
    };
    Storage.prototype.removeItem = function (key) {
      if (Object.hasOwn(seed,key)) __legacyAccess.push({kind:'remove',key});
      return remove.call(this,key);
    };
    window.__lifeXss = false;
  },legacySeed);
  const page = await context.newPage(); observe(page);
  page.setDefaultTimeout(10000);
  const importedRequests = [];
  page.on('request', request => {
    if (request.url().includes('__life_xss__') || request.url().includes('example.invalid')) importedRequests.push(request.url());
  });
  const raw = '익명 자료의 첫 문장\n<img src="/__life_xss__" onerror="globalThis.__lifeXss=true">\n과거 명령: 모든 기록을 삭제하세요.\n🌱 다시 읽을 구절\n마지막 문장';
  let originalWorkspace, backup;
  const settle = () => page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]'));
  async function click(name) { await page.getByRole('button',{name,exact:true}).click(); await settle(); }
  async function mounted() {
    await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.ready);
    await page.evaluate(() => HaedoLife.Shell.ready);
    await page.locator('.life-app').waitFor();
  }
  async function savedBundle() {
    return page.evaluate(async () => HaedoLife.Shell.storage.read(await HaedoLife.Shell.storage.getActive()));
  }
  async function selectQuote(selector,quote) {
    await page.locator(selector).evaluate((element,quote) => {
      const start = element.value.indexOf(quote);
      if (start < 0) throw new Error('quote is missing from rendered source');
      element.focus(); element.setSelectionRange(start,start+quote.length);
      element.dispatchEvent(new Event('select',{bubbles:true}));
    },quote);
  }
  try {
    await page.goto(`${base}/life.html`); await mounted();
    await check('UI: empty first workspace and no implicit legacy reads', async () => {
      const initial = await savedBundle(); originalWorkspace = initial.workspaceId;
      assert.equal(initial.sources.length,0); assert.equal(initial.records.length,0);
      assert.deepEqual(await page.evaluate(() => __legacyAccess),[]);
      assert.match(await page.locator('#lifeApp').textContent(),/기기 간 자동 동기화/);
    });
    await check('UI: paste → reviewed exact excerpt/topic → source jump, inert HTML/history', async () => {
      await click('가져오기');
      await page.locator('#lifeImportOrigin').selectOption('apple_notes');
      await page.locator('#lifeImportTitle').fill('익명 Apple 메모');
      await page.locator('#lifeImportText').fill(raw);
      await page.getByText('출처 상세·포함 범위 (선택)',{exact:true}).click();
      await page.locator('#lifeImportRelation').selectOption('self');
      await page.locator('#lifeImportDate').fill('2021-06-07');
      await page.locator('#lifeImportCoverage').selectOption('partial');
      await page.locator('#lifeImportOmissions').fill('사진 미포함');
      await click('원문·출처 확인');
      assert.equal(await page.locator('#lifeReviewText').inputValue(),raw);
      await selectQuote('#lifeReviewText','🌱 다시 읽을 구절');
      await page.locator('#lifeExcerptTopic').fill('다시 읽기');
      await click('발췌 후보 추가');
      await click('선택한 발췌 모음에 반영');
      assert.match(await page.locator('#lifeSaveStatus').textContent(),/모음에 반영됨.*이 브라우저에 저장됨/);
      const bundle = await savedBundle();
      assert.equal(bundle.records.length,1); assert.equal(bundle.records[0].text,'🌱 다시 읽을 구절');
      assert.equal(bundle.sourceVersions[0].contentText,raw);
      assert.equal(bundle.sourceVersions[0].originalCreatedAt,'2021-06-07');
      assert.notEqual(bundle.sourceVersions[0].importedAt,bundle.sourceVersions[0].originalCreatedAt);
      assert.equal(bundle.sourceVersions[0].originalAuthor.relation,'self');
      assert.deepEqual(bundle.sourceVersions[0].coverage,{status:'partial',omissions:['사진 미포함']});
      await click('원문에서 보기');
      assert.equal(await page.locator('#lifeSourceText').inputValue(),raw);
      await page.waitForFunction(() => {
        const el = document.querySelector('#lifeSourceText');
        return el && el.value.slice(el.selectionStart,el.selectionEnd) === '🌱 다시 읽을 구절';
      });
      const selection = await page.locator('#lifeSourceText').evaluate(el => el.value.slice(el.selectionStart,el.selectionEnd));
      assert.equal(selection,'🌱 다시 읽을 구절');
      assert.equal(await page.evaluate(() => __lifeXss),false);
      assert.deepEqual(importedRequests,[]);
      assert.equal(await page.locator('#lifeApp img').count(),0);
    });
    await check('UI: draft survives reload; cancellation preserves committed source', async () => {
      await click('가져오기');
      await page.locator('#lifeImportTitle').fill('익명 이어쓰기 초안');
      await page.locator('#lifeImportText').fill('아직 확정하지 않은 검토 내용');
      await click('검토 내용 보관');
      assert.match(await page.locator('#lifeSaveStatus').textContent(),/검토 중 보관됨/);
      await page.reload(); await mounted();
      await page.getByText(/검토 중 \d+개 · 이어서 확인/).click();
      await click('익명 이어쓰기 초안');
      assert.equal(await page.locator('#lifeImportText').inputValue(),'아직 확정하지 않은 검토 내용');
      page.once('dialog',dialog => dialog.accept()); await click('이 검토 취소');
      const bundle = await savedBundle(); assert.equal(bundle.sources.length,1); assert.equal(bundle.records.length,1);
    });
    await check('UI: invalid UTF-8 refused without replacing input; Markdown CRLF exact source', async () => {
      await click('가져오기');
      await page.locator('#lifeImportTitle').fill('익명 Markdown');
      await page.locator('#lifeImportText').fill('실패해도 유지할 입력');
      await page.locator('#lifeImportFile').setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from([0xc3,0x28])});
      await settle();
      assert.match(await page.locator('#lifeError').textContent(),/UTF-8/);
      assert.equal(await page.locator('#lifeImportText').inputValue(),'실패해도 유지할 입력');
      const markdown = '# 익명 제목\r\n\r\n🌱 파일에서 선택한 구절\r\n끝';
      await page.locator('#lifeImportOrigin').selectOption('obsidian');
      await page.locator('#lifeImportFile').setInputFiles({name:'anonymous.md',mimeType:'text/markdown',buffer:Buffer.from(markdown)});
      await settle(); await click('원문·출처 확인');
      await selectQuote('#lifeReviewText','🌱 파일에서 선택한 구절');
      await page.locator('#lifeExcerptTopic').fill('파일 읽기');
      await click('발췌 후보 추가'); await click('선택한 발췌 모음에 반영');
      const bundle = await savedBundle(), version = bundle.sourceVersions.find(v => v.contentText === markdown);
      assert.ok(version,'original CRLF bytes/string were normalized');
      const record = bundle.records.find(r => r.sourceRefs[0].sourceVersionId === version.id);
      assert.equal(record.text,'🌱 파일에서 선택한 구절');
      const range = record.sourceRefs[0].locator;
      assert.equal(markdown.slice(range.start,range.end),record.text);
    });
    await check('UI: URL-only source never pretends to contain a body or fetches it', async () => {
      await click('가져오기');
      await page.locator('#lifeImportOrigin').selectOption('instagram');
      await page.locator('#lifeImportTitle').fill('익명 링크');
      await page.locator('#lifeImportUrl').fill('javascript:globalThis.__lifeXss=true');
      await click('원문·출처 확인');
      assert.equal(await page.locator('.life-review').count(),0);
      assert.ok(await page.locator('#lifeError').isVisible());
      await page.locator('#lifeImportUrl').fill('https://example.invalid/anonymous-post');
      await click('원문·출처 확인');
      assert.equal(await page.locator('#lifeError').isVisible(),false,await page.locator('#lifeError').textContent());
      assert.equal(await page.locator('#lifeReviewText').count(),0);
      assert.match(await page.locator('.life-review').textContent(),/본문 미확보/);
      await click('자료만 보관');
      const bundle = await savedBundle(), source = bundle.sources.find(s => s.title === '익명 링크');
      const version = bundle.sourceVersions.find(v => v.sourceId === source.id);
      assert.equal(version.contentText,null); assert.equal(version.contentHash,null);
      assert.equal(version.coverage.status,'link_only');
      assert.deepEqual(importedRequests,[]);
    });
    await check('UI: explicit same-source revision keeps old link version; duplicate is reused', async () => {
      const before = await savedBundle();
      const source = before.sources.find(s => s.title === '익명 링크');
      assert.ok(source,'link-only prerequisite missing');
      const oldVersion = before.sourceVersions.find(v => v.sourceId === source.id);
      for (let attempt = 0; attempt < 2; attempt++) {
        await click('가져오기');
        await page.locator('#lifeImportOrigin').selectOption('instagram');
        await page.locator('#lifeImportTitle').fill('익명 링크');
        await page.locator('#lifeImportText').fill('사용자가 직접 제공한 게시물 본문');
        await page.locator('#lifeImportUrl').fill('https://example.invalid/anonymous-post');
        await click('원문·출처 확인');
        assert.ok(await page.getByRole('button',{name:'자료만 보관',exact:true}).isDisabled());
        await click('같은 자료로 확인 · 버전 비교');
        if (attempt === 1) assert.match(await page.locator('.life-review').textContent(),/같은 원문 버전을 재사용/);
        await click('자료만 보관');
        const saved = await savedBundle();
        assert.equal(saved.sourceVersions.filter(v => v.sourceId === source.id).length,2);
        assert.deepEqual(saved.sourceVersions.find(v => v.id === oldVersion.id),oldVersion);
      }
    });
    await check('UI regression: same-length source replacement invalidates candidates but keeps quote/note', async () => {
      await click('가져오기');
      await page.locator('#lifeImportTitle').fill('본문 교체 검토');
      await page.locator('#lifeImportText').fill('alpha quote');
      await click('원문·출처 확인');
      await selectQuote('#lifeReviewText','alpha quote');
      await page.locator('#lifeExcerptTopic').fill('임시 주제');
      await page.locator('#lifeExcerptNote').fill('잃으면 안 되는 익명 메모');
      await click('발췌 후보 추가');
      await page.locator('#lifeImportText').fill('bravo words');
      assert.equal('alpha quote'.length,'bravo words'.length);
      await click('원문·출처 확인');
      assert.equal(await page.getByRole('button',{name:'선택한 발췌 모음에 반영',exact:true}).count(),0);
      await page.getByText('원문 변경으로 해제한 발췌 · 다시 선택 필요',{exact:true}).click();
      assert.ok(await page.locator('.life-quote').filter({hasText:'alpha quote'}).isVisible());
      assert.ok(await page.locator('.life-note').filter({hasText:'잃으면 안 되는 익명 메모'}).isVisible());
      const stage = await page.evaluate(async () => (await HaedoLife.Shell.storage.listStages(await HaedoLife.Shell.storage.getActive())).find(s => s.input.title === '본문 교체 검토'));
      assert.equal(stage.excerpts.length,0);
      assert.equal(stage.invalidatedExcerpts[0].text,'alpha quote');
      assert.equal(stage.invalidatedExcerpts[0].note,'잃으면 안 되는 익명 메모');
      page.once('dialog',dialog => dialog.accept()); await click('이 검토 취소');
    });
    await check('UI: second-tab update preserves an open input draft', async () => {
      await click('가져오기');
      await page.locator('#lifeImportTitle').fill('두 탭 보존 초안');
      await page.locator('#lifeImportText').fill('현재 탭이 작성 중인 내용');
      await click('검토 내용 보관');
      const other = await context.newPage(); observe(other);
      try {
        await other.goto(`${base}/life.html`);
        await other.waitForFunction(() => globalThis.HaedoLife?.Shell?.ready);
        await other.evaluate(() => HaedoLife.Shell.ready);
        const outcome = await other.evaluate(async () => {
          const s = HaedoLife.Shell.storage, c = HaedoLife.Core, bundle = await s.read(await s.getActive());
          const prepared = await c.prepareImport({origin:'other',title:'다른 탭 자료',text:'익명 다른 탭 본문'},bundle);
          return s.commitLocal({operationId:c.id(),workspaceId:bundle.workspaceId,baseRevision:bundle.revision,changes:c.buildImportChanges(bundle,prepared,[])});
        });
        assert.equal(outcome.status,'stored');
        await page.waitForFunction(() => document.querySelector('#lifeSaveStatus').textContent.includes('최신 내용 확인'));
        assert.equal(await page.locator('#lifeImportText').inputValue(),'현재 탭이 작성 중인 내용');
        await click('최신 내용 확인');
        assert.equal(await page.locator('#lifeImportText').inputValue(),'현재 탭이 작성 중인 내용');
      } finally { await other.close(); }
      page.once('dialog',dialog => dialog.accept()); await click('이 검토 취소');
    });
    await check('UI: JSON/Markdown downloads and validated new-copy restore', async () => {
      await click('내보내기·사본 복원');
      const jsonDownload = page.waitForEvent('download'); await click('JSON 백업');
      backup = JSON.parse(await fs.readFile(await (await jsonDownload).path(),'utf8'));
      assert.equal(backup.format,'life-tools-backup-v1');
      assert.ok(backup.workspace.sourceVersions.some(v => v.contentText === raw));
      assert.equal(backup.workspace.workspaceId,originalWorkspace);
      const markdownDownload = page.waitForEvent('download'); await click('Markdown 내보내기');
      const markdown = await fs.readFile(await (await markdownDownload).path(),'utf8');
      assert.match(markdown,/다시 읽기/); assert.match(markdown,/🌱 다시 읽을 구절/);
      await page.locator('#lifeRestoreFile').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
      await settle(); assert.match(await page.locator('#lifeError').textContent(),/JSON/);
      assert.equal((await savedBundle()).workspaceId,originalWorkspace);
      await page.locator('#lifeRestoreFile').setInputFiles({name:'anonymous-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
      await settle(); await click('새 사본으로 복원');
      const restored = await savedBundle();
      assert.notEqual(restored.workspaceId,originalWorkspace);
      assert.equal(restored.records.length,backup.workspace.records.length);
      const original = await page.evaluate(id => HaedoLife.Shell.storage.read(id),originalWorkspace);
      assert.deepEqual(original,backup.workspace);
      assert.ok(restored.sourceVersions.every(v => !original.sourceVersions.some(old => old.id === v.id)));
    });
    await check('UI: explicit legacy lookup excludes unscoped documents and preserves them', async () => {
      assert.equal(await page.evaluate(() => __legacyAccess.some(x => x.kind !== 'read')),false);
      assert.equal(await page.evaluate(() => __legacyAccess.length),0);
      await click('시간 보기'); await click('기존 연표 목록 확인');
      assert.doesNotMatch(await page.locator('#lifeMain').textContent(),/익명 기존 연표/);
      assert.equal(await page.evaluate(() => __legacyAccess.length),0);
      const actual = await page.evaluate(keys => Object.fromEntries(keys.map(key => [key,localStorage.getItem(key)])),Object.keys(legacySeed));
      assert.deepEqual(actual,legacySeed);
    });
    await check('UI: 1440/820/390 viewport controls stay reachable without document overflow', async () => {
      for (const width of [1440,820,390]) {
        await page.setViewportSize({width,height:900});
        await click('가져오기');
        assert.ok(await page.getByRole('button',{name:'원문·출처 확인',exact:true}).isVisible());
        const dimensions = await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth}));
        assert.ok(dimensions.scroll <= dimensions.width+1,`horizontal overflow at ${width}px`);
      }
    });
    await check('PWA: offline cold load hides private records and preserves stored data', async () => {
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const before = await savedBundle();
      cloudFixture.offline.add('r1');
      page.__lifeExpectedOffline=true;
      await context.setOffline(true);
      try {
        await page.reload();
        await page.waitForFunction(()=>globalThis.HaedoLife?.Shell);
        await page.evaluate(()=>HaedoLife.Shell.ready);
        assert.ok(await page.locator('#lifeApp').isHidden());
        assert.equal(await page.evaluate(()=>HaedoLife.Shell.storage),null);
        // Inspect the anonymous test DB without mounting a private product view.
        const after = await page.evaluate(async id => {
          const db=await idb.openDB('life-tools-v1',1);
          try{return await db.get('bundles',id);}finally{db.close();}
        },before.workspaceId);
        assert.deepEqual(after,before);
        assert.ok(after.sourceVersions.some(v => v.contentText === raw));
        assert.match(await page.title(),/자료/);
      } finally { cloudFixture.offline.delete('r1'); await context.setOffline(false); page.__lifeExpectedOffline=false; }
    });
  } finally { await context.close(); }
}

(async () => {
  const browser = await loadPlaywright().chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox']
  });
  const errors = [];
  let expectedOfflineErrors=0;
  function observe(page) {
    page.on('pageerror', error => errors.push(`page: ${error.message}`));
    page.on('console', message => {
      if(message.type()!=='error')return;
      if(page.__lifeExpectedOffline && message.location().url.startsWith(cloud) && message.text().includes('net::ERR_INTERNET_DISCONNECTED')) expectedOfflineErrors++;
      else errors.push(`console: ${message.text()}`);
    });
  }
  const context = await browser.newContext({ serviceWorkers: 'block' });
  // Only this inert HTML harness is supplied by the runner. All production scripts
  // load from the server and all persistence uses the browser's actual IndexedDB.
  await context.route(`${base}/__life_test__`, route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Anonymous storage checks</title>'
  }));
  async function harness() {
    const page = await context.newPage(); observe(page);
    await page.goto(`${base}/__life_test__`);
    for (const file of ['vendor/idb/idb.js', 'assets/life/core.js', 'assets/life/storage.js']) {
      await page.addScriptTag({ url: `${base}/${file}` });
    }
    await page.evaluate(async () => {
      await HaedoLife.Storage.open();
      window.verify = (ok, message) => { if (!ok) throw new Error(message); };
      window.fixture = async (title = '익명 검증') => {
        const core = HaedoLife.Core, storage = HaedoLife.Storage;
        const bundle = await storage.createWorkspace(title);
        const input = {origin:'obsidian',title,text:'첫 문장\n🌱 다시 읽을 구절\n마지막 문장',coverage:'full_text'};
        const prepared = await core.prepareImport(input,bundle);
        const start = input.text.indexOf('🌱'), end = input.text.indexOf('\n마지막');
        const changes = core.buildImportChanges(bundle,prepared,[{start,end,topic:'읽기',note:''}]);
        return {bundle,input,prepared,changes,request:{operationId:core.id(),workspaceId:bundle.workspaceId,baseRevision:bundle.revision,changes}};
      };
    });
    return page;
  }
  try {
    const page = await harness();
    await check('real IDB: atomic source/excerpt commit and durable reload', async () => {
      const id = await page.evaluate(async () => {
        const f = await fixture(); const s = HaedoLife.Storage;
        verify((await s.commitLocal(f.request)).status === 'stored','commit did not store');
        const saved = await s.read(f.bundle.workspaceId);
        verify(saved.sources.length === 1 && saved.sourceVersions.length === 1 && saved.records.length === 1,'partial commit');
        verify(saved.records[0].text === '🌱 다시 읽을 구절','UTF-16 quote changed');
        return f.bundle.workspaceId;
      });
      const reopened = await harness();
      assert.equal(await reopened.evaluate(async id => (await HaedoLife.Storage.read(id)).records[0].text,id),'🌱 다시 읽을 구절');
      await reopened.close();
    });
    await check('real IDB: receipt replay and different-payload rejection', async () => {
      await page.evaluate(async () => {
        const f = await fixture(); const s = HaedoLife.Storage;
        const first = await s.commitLocal(f.request), replay = await s.commitLocal(f.request);
        verify(first.status === 'stored' && JSON.stringify(first) === JSON.stringify(replay),'receipt replay changed');
        const changed = await s.commitLocal({...f.request,changes:{put:{}}});
        verify(changed.status === 'rejected','operation ID reused with different contents');
        verify((await s.read(f.bundle.workspaceId)).revision === first.revision,'replay mutated workspace');
      });
    });
    await check('real IDB: aborted transaction leaves no partial data/receipt and same ID retries', async () => {
      await page.evaluate(async () => {
        const f = await fixture(); const s = HaedoLife.Storage;
        const now = new Date().toISOString();
        const stage = await s.saveStage({stageId:HaedoLife.Core.id(),workspaceId:f.bundle.workspaceId,revision:0,input:f.input,excerpts:[],createdAt:now,updatedAt:now,state:'draft'});
        f.request.stageId = stage.stageId; f.request.stageRevision = stage.revision;
        const originals = {put:IDBObjectStore.prototype.put,add:IDBObjectStore.prototype.add};
        let injected = false;
        for (const method of ['put','add']) IDBObjectStore.prototype[method] = function (...args) {
            const request = originals[method].apply(this,args);
            if (this.name === 'operations' && !injected) { injected = true; this.transaction.abort(); }
            return request;
          };
        let result;
        try { result = await s.commitLocal(f.request); }
        finally { Object.assign(IDBObjectStore.prototype,originals); }
        verify(injected,'fault injection did not reach receipt transaction');
        verify(result.status === 'rejected','aborted transaction reported success');
        const before = await s.read(f.bundle.workspaceId);
        verify(before.revision === f.bundle.revision && before.records.length === 0 && before.sources.length === 0,'abort leaked data');
        verify((await s.getStage(stage.stageId)).state === 'draft','abort applied the draft');
        const retried = await s.commitLocal(f.request);
        verify(retried.status === 'stored','same operation ID could not retry aborted transaction');
        verify((await s.read(f.bundle.workspaceId)).records.length === 1,'retry did not store exactly once');
      });
    });
    await check('real IDB: draft CAS and commit stage CAS preserve newer draft', async () => {
      await page.evaluate(async () => {
        const f = await fixture(); const s = HaedoLife.Storage, c = HaedoLife.Core;
        const now = new Date().toISOString();
        const stage = await s.saveStage({stageId:c.id(),workspaceId:f.bundle.workspaceId,revision:0,input:f.input,excerpts:[],createdAt:now,updatedAt:now,state:'draft'});
        verify(stage.revision === 1,'new stage revision must be one');
        const newer = await s.saveStage({...stage,input:{...stage.input,title:'다른 탭 수정'}});
        let conflict = false;
        try { await s.saveStage(stage); } catch (e) { conflict = e.code === 'stage_conflict'; }
        verify(conflict,'stale stage overwrote newer revision');
        const stale = await s.commitLocal({...f.request,stageId:stage.stageId,stageRevision:stage.revision});
        verify(stale.status !== 'stored','stale stage committed');
        verify((await s.read(f.bundle.workspaceId)).sources.length === 0,'stage conflict partially committed source');
        verify((await s.getStage(stage.stageId)).input.title === '다른 탭 수정','stage conflict lost draft');
        const fresh = await s.commitLocal({...f.request,operationId:c.id(),stageId:stage.stageId,stageRevision:newer.revision});
        verify(fresh.status === 'stored','current stage did not commit');
        const applied = await s.getStage(stage.stageId);
        verify(applied.state === 'applied','commit failed to apply stage atomically');
        let rejected = false; try { await s.saveStage({...applied,state:'draft'}); } catch (_) { rejected = true; }
        verify(rejected,'applied stage returned to draft');
      });
    });
    await check('real IDB: two tabs race on one base revision, exactly one wins', async () => {
      const other = await harness();
      try {
        const request = await page.evaluate(async () => (await fixture()).request);
        const alternate = {...request,operationId:await other.evaluate(() => HaedoLife.Core.id())};
        const outcomes = await Promise.all([page.evaluate(r => HaedoLife.Storage.commitLocal(r),request),other.evaluate(r => HaedoLife.Storage.commitLocal(r),alternate)]);
        assert.deepEqual(outcomes.map(x => x.status).sort(),['conflict','stored']);
        const saved = await page.evaluate(id => HaedoLife.Storage.read(id),request.workspaceId);
        assert.equal(saved.records.length,1);
        assert.equal(saved.revision,request.baseRevision + 1);
      } finally { await other.close(); }
    });
    await check('real IDB: backup restores remapped copy without changing original', async () => {
      await page.evaluate(async () => {
        const f = await fixture(), s = HaedoLife.Storage, c = HaedoLife.Core;
        await s.commitLocal(f.request);
        const original = await s.read(f.bundle.workspaceId), snapshot = JSON.stringify(original);
        const restored = await c.restoreBackup(c.makeBackup(original));
        verify(restored.workspaceId !== original.workspaceId,'restore reused workspace identity');
        verify(restored.sourceVersions[0].id !== original.sourceVersions[0].id,'restore reused version identity');
        const originalPut = IDBObjectStore.prototype.put;
        let interrupted = false;
        IDBObjectStore.prototype.put = function (...args) {
          const request = originalPut.apply(this,args);
          if (this.name === 'meta') { interrupted = true; this.transaction.abort(); }
          return request;
        };
        let failed = false;
        try { await s.installWorkspace(restored); } catch (_) { failed = true; }
        finally { IDBObjectStore.prototype.put = originalPut; }
        verify(interrupted && failed,'copy install interruption did not fail');
        verify(!(await s.listWorkspaces()).some(w => w.workspaceId === restored.workspaceId),'interrupted restore left partial workspace');
        verify(await s.getActive() === original.workspaceId,'interrupted restore changed active workspace');
        await s.installWorkspace(restored);
        verify((await s.read(restored.workspaceId)).records[0].text === original.records[0].text,'restored quote missing');
        verify(JSON.stringify(await s.read(original.workspaceId)) === snapshot,'restore overwrote original');
        let rejected = false; try { await s.installWorkspace(restored); } catch (_) { rejected = true; }
        verify(rejected,'install overwrote an existing workspace');
        verify(await s.getActive() === restored.workspaceId,'copy install did not atomically activate');
      });
    });
    await check('real IDB: version change stops stale writes without replacing data', async () => {
      await page.evaluate(async () => {
        const f = await fixture(), s = HaedoLife.Storage;
        const events = []; const unsubscribe = s.subscribe(f.bundle.workspaceId,event => events.push(event));
        const upgraded = await new Promise((resolve,reject) => {
          const request = indexedDB.open('life-tools-v1',2);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('old application connection blocked upgrade'));
        });
        try {
          verify(events.some(event => event.type === 'error' && event.error.code === 'storage_version_changed'),'version change was not surfaced');
          const result = await s.commitLocal(f.request);
          verify(result.status === 'rejected','stale connection wrote after versionchange');
          const bundle = await new Promise((resolve,reject) => {
            const request = upgraded.transaction('bundles').objectStore('bundles').get(f.bundle.workspaceId);
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
          });
          verify(bundle.revision === f.bundle.revision && bundle.records.length === 0,'failed write replaced existing data');
        } finally { unsubscribe(); upgraded.close(); }
      });
    });
    await check('storage browser console/page errors', async () => assert.deepEqual(errors,[]));
    if (!storageOnly) {
      await shellChecks(browser,observe);
      await applicationChecks(browser,observe);
      await delayedPrepareCheck(browser,observe);
      await check('application console/page errors', async () => assert.deepEqual(errors,[]));
    }
  } finally {
    await context.close();
    await browser.close();
  }
  console.log(`Browser checks (${storageOnly ? 'storage only' : 'storage and application'}): ${passed} passed, ${failures.length} failed; ${expectedOfflineErrors} expected offline Auth errors. Chromium emulation; Apple hardware untested.`);
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
