'use strict';
// Exact material component in a browser; account/storage/publication integration is verified separately.
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { playwright } = require('./unified-home-browser.cjs');
const base = process.env.BASE_URL || 'http://127.0.0.1:4214';
const out = path.resolve(__dirname, '../.local/material-writing-sources');
const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], scope: 'Actual source selector/readonly comparison, real Core/SourceReference/MaterialWriting models and synthetic callbacks. No production data, real Auth, storage or publication claim.' };
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); report.node = process.version; let active;
  async function fixture() {
    if (active) await active.close();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' }); active = context;
    await context.route('**/*', route => { if (new URL(route.request().url()).origin === new URL(base).origin) return route.continue(); report.external.push(new URL(route.request().url()).origin); return route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => report.pageErrors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    await page.goto(base + '/index.html'); await page.waitForFunction(() => !!globalThis.HaedoLife?.Core);
    for (const [name, file] of [['PhotoPost', 'photo-post.js'], ['SourceReference', 'source-reference.js'], ['BlogEvidence', 'blog-evidence.js'], ['MaterialWriting', 'material-writing.js'], ['MaterialWritingSources', 'material-writing-sources.js']]) {
      if (!await page.evaluate(name => !!HaedoLife[name], name)) await page.addScriptTag({ url: base + '/assets/life/' + file });
    }
    // Isolate the component while keeping all real site styles and typography.
    await page.addStyleTag({ content: 'body>:not(#materialSourceTestHost){display:none!important}#materialSourceTestHost{display:block;margin:0 auto;max-width:1100px;padding:24px 20px 80px}' });
    await page.evaluate(async () => {
      const C = HaedoLife.Core, M = HaedoLife.MaterialWriting; let bundle = C.createWorkspace();
      const raw = '\ufeff🌱 시작\r\n정확한 옛 구절🌿\r\n다음 문단\r\n글에 자동 복사하면 안 되는 원문 나머지';
      const old = await C.prepareImport({ origin: 'obsidian', title: '여행 비교 자료 하나', text: raw, authorRelation: 'unknown', url: 'https://example.org/old' }, bundle); bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, old));
      const latest = await C.prepareImport({ origin: 'obsidian', title: old.source.title, text: '최신 자료에는 옛 구절이 없습니다.', existingSourceId: old.source.id, authorRelation: 'unknown' }, bundle); bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, latest));
      const second = await C.prepareImport({ origin: 'obsidian', title: old.source.title, text: '서로 다른 두 번째 원문\n전체 본문을 비교합니다.', url: 'https://example.org/second', authorRelation: 'unknown' }, bundle); bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, second));
      const link = await C.prepareImport({ origin: 'other', title: '본문 없는 링크', url: 'https://example.org/link', authorRelation: 'unknown' }, bundle); bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, link));
      const templateSource = bundle.sources.find(s => s.id === second.source.id), templateVersion = bundle.sourceVersions.find(v => v.id === second.version.id);
      for (let i = 0; i < 3000; i++) { const sourceId = C.id(), versionId = C.id(); bundle.sources.push({ ...templateSource, id: sourceId, sourceKey: 'synthetic:' + i, title: '대규모 후보 ' + i }); bundle.sourceVersions.push({ ...templateVersion, id: versionId, sourceId }); }
      C.validateWorkspace(bundle);
      const state = M.empty(bundle.workspaceId), plan = M.create(C.id); state.plans.push(plan);
      const host = document.createElement('main'); host.id = 'materialSourceTestHost'; host.className = 'mw-workspace'; document.body.append(host);
      const f = window.materialSourceTest = { bundle, original: structuredClone(bundle), state, plan, raw, old, latest, second, link, quotes: [], opens: [], notes: [], pending: [], valid: true, failQuote: false, failNote: false, reads: 0 };
      const add = item => { const before = [...plan.materials]; plan.materials.push(item); try { M.validate(state); } catch (e) { plan.materials = before; throw e; } };
      const options = { host, getPlan: () => f.plan, isCurrent: () => f.valid, getBundle: async () => {
        f.reads++; const value = structuredClone(f.bundle);
        if (f.holdRead) { f.holdRead = false; f.held = true; await new Promise(resolve => { f.releaseRead = resolve; }); }
        return value;
      }, onAdd: add, onRemove: id => { if (plan.blocks.some(b => b.materialId === id)) throw Error('채택한 인용을 먼저 처리해 주세요.'); plan.materials = plan.materials.filter(m => m.id !== id); },
      onNote: (id, text) => { if (f.failNote) throw Error('합성 메모 저장 거절'); const item = plan.materials.find(m => m.id === id), prior = item.note; item.note = text; try { M.validate(state); } catch (e) { item.note = prior; throw e; } f.notes.push(text); },
      onQuote: (id, ref) => { if (f.failQuote) throw Error('합성 인용 채택 실패'); f.quotes.push({ id, ref }); plan.blocks.push({ id: C.id(), kind: 'quote', materialId: id, reference: ref }); M.validate(state); },
      onOpenSource: value => { f.opens.push(value); }, onPendingChange: value => f.pending.push(value) };
      f.options = options; window.sourceUI = HaedoLife.MaterialWritingSources.create(options); await sourceUI.mount();
    });
    return page;
  }
  async function add(page, sourceKey, versionKey) {
    const pick = await page.evaluate(([s, v]) => { const f = materialSourceTest; return { title: f[s].source.title, sourceId: f[s].source.id, versionId: f[v || s].version.id }; }, [sourceKey, versionKey]);
    await page.locator('.mw-source-search').fill(pick.title);
    await page.locator('.mw-source-candidate[data-source-id="' + pick.sourceId + '"]').click();
    await page.locator('.mw-candidate-version').selectOption(pick.versionId); await page.locator('.mw-material-add').click();
    await page.waitForFunction(id => materialSourceTest.plan.materials.some(m => m.sourceVersionId === id) && !sourceUI.pending(), pick.versionId);
    return page.evaluate(id => materialSourceTest.plan.materials.find(m => m.sourceVersionId === id).id, pick.versionId);
  }
  async function select(page, id) {
    await page.locator('.mw-material[data-material-id="' + id + '"] .mw-material-body').evaluate(body => {
      const shown = body.value, start = shown.indexOf('정확한'), end = shown.indexOf('다음') + 2; body.focus(); body.setSelectionRange(start, end); body.dispatchEvent(new Event('select'));
    });
    await page.waitForFunction(() => sourceUI.pending());
  }
  async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS ' + name); }
  let page;
  try {
    page = await fixture();
    await check('Large vault title search creates only twenty candidates and adds the explicitly chosen old version', async () => {
      await page.locator('.mw-source-search').fill('대규모 후보'); assert.equal(await page.locator('.mw-source-candidate').count(), 20); assert.equal(await page.locator('.mw-material-body').count(), 0);
      const id = await add(page, 'old'); const material = await page.evaluate(() => materialSourceTest.plan.materials[0]);
      assert.equal(material.id, id); assert.equal(material.sourceVersionId, await page.evaluate(() => materialSourceTest.old.version.id));
      assert.equal(await page.locator('.mw-material-body').inputValue(), (await page.evaluate(() => materialSourceTest.raw)).replace(/\r\n?/g, '\n'));
      assert.equal(await page.locator('.mw-material-body').getAttribute('readonly'), '');
      await page.locator('.mw-material-note').fill('내 비공개 자료 메모'); await page.evaluate(() => sourceUI.refresh());
      assert.equal(await page.locator('.mw-material-note').inputValue(), '내 비공개 자료 메모');
      assert(await page.evaluate(() => JSON.stringify(materialSourceTest.bundle) === JSON.stringify(materialSourceTest.original)));
    });
    await check('Two readonly originals compare, exact CRLF/emoji quote is adopted once, and memos stay outside references', async () => {
      const first = await page.evaluate(() => materialSourceTest.plan.materials[0].id);
      await page.locator('.mw-source-search').fill('여행 비교 자료 하나');
      assert.equal(await page.locator('.mw-source-candidate').count(), 2);
      const oldChoice = page.locator('.mw-source-candidates').getByRole('button', { name: '여행 비교 자료 하나 · 출처: https://example.org/old', exact: true }), secondChoice = page.locator('.mw-source-candidates').getByRole('button', { name: '여행 비교 자료 하나 · 출처: https://example.org/second', exact: true });
      assert.equal(await oldChoice.locator('.mw-source-hint').innerText(), '출처: https://example.org/old'); assert.equal(await secondChoice.locator('.mw-source-hint').innerText(), '출처: https://example.org/second');
      await secondChoice.click(); assert.equal(await page.locator('.mw-source-choice .mw-source-hint').innerText(), '출처: https://example.org/second');
      await page.locator('.mw-material-add').click(); await page.waitForFunction(() => materialSourceTest.plan.materials.length === 2 && !sourceUI.pending());
      const second = await page.evaluate(() => materialSourceTest.plan.materials[1].id);
      assert.equal(await page.locator('.mw-material-tab').filter({ hasText: 'https://example.org/second' }).count(), 1);
      await page.locator('.mw-compare-select').selectOption(second); assert.equal(await page.locator('.mw-material-body').count(), 2);
      for (const [id, url] of [[first, 'https://example.org/old'], [second, 'https://example.org/second']]) assert.equal(await page.locator('.mw-material[data-material-id="' + id + '"] > .mw-source-hint').innerText(), '출처: ' + url);
      await select(page, first); await page.locator('.mw-material[data-material-id="' + first + '"] .mw-quote-apply').click(); await page.waitForFunction(() => !sourceUI.pending());
      const value = await page.evaluate(() => ({ ref: materialSourceTest.quotes[0].ref, raw: materialSourceTest.raw, old: materialSourceTest.old.version.id, count: materialSourceTest.quotes.length }));
      assert.equal(value.count, 1); assert.equal(value.ref.sourceVersionId, value.old); assert.equal(value.ref.quote, value.raw.slice(value.ref.locator.start, value.ref.locator.end)); assert.match(value.ref.quote, /🌿\r\n/); assert(!JSON.stringify(value.ref).includes('내 비공개 자료 메모'));
      await page.locator('.mw-material[data-material-id="' + first + '"] .mw-material-open').click();
      const opened = await page.evaluate(() => materialSourceTest.opens[0]); assert.deepEqual(opened.locator, value.ref.locator); assert.equal(opened.sourceVersionId, value.old); assert.equal(opened.contentHash, value.ref.contentHash);
      const before = await page.evaluate(() => sourceUI.getView()); await page.evaluate(async () => { const view = sourceUI.getView(); sourceUI.dispose(); sourceUI = HaedoLife.MaterialWritingSources.create({ ...materialSourceTest.options, view }); await sourceUI.mount(); });
      assert.deepEqual(await page.evaluate(() => sourceUI.getView()), before); assert.equal(await page.locator('.mw-material-body').count(), 2);
    });
    await check('Quote failure and invalid/IME notes retain DOM input and prevent navigation until explicitly resolved', async () => {
      const first = await page.evaluate(() => materialSourceTest.plan.materials[0].id), card = page.locator('.mw-material[data-material-id="' + first + '"]');
      await page.evaluate(() => { materialSourceTest.failNote = true; }); await card.locator('.mw-material-note').fill('실패해도 남는 메모');
      await page.locator('.mw-sources-error:not([hidden])').waitFor(); await page.evaluate(() => sourceUI.refresh()); assert.equal(await card.locator('.mw-material-note').inputValue(), '실패해도 남는 메모'); assert(await page.evaluate(() => sourceUI.pending()));
      const count = await page.evaluate(() => materialSourceTest.opens.length); await card.locator('.mw-material-open').click(); assert.equal(await page.evaluate(() => materialSourceTest.opens.length), count);
      await page.evaluate(() => { materialSourceTest.failNote = false; }); await card.locator('.mw-material-note').fill('유효한 메모'); assert.equal(await page.evaluate(() => sourceUI.pending()), false);
      await card.locator('.mw-material-note').evaluate(n => n.dispatchEvent(new CompositionEvent('compositionstart'))); assert(await page.evaluate(() => sourceUI.pending())); await card.locator('.mw-material-open').click(); assert.equal(await page.evaluate(() => materialSourceTest.opens.length), count);
      await card.locator('.mw-material-note').evaluate(n => n.dispatchEvent(new CompositionEvent('compositionend')));
      await select(page, first); await page.evaluate(() => { materialSourceTest.failQuote = true; }); await card.locator('.mw-quote-apply').click(); await page.waitForFunction(() => document.querySelector('.mw-sources-error')?.textContent.includes('채택 실패'));
      assert(await page.evaluate(() => sourceUI.pending())); assert.match(await card.locator('.mw-material-quote').innerText(), /정확한 옛 구절/);
      await card.locator('.mw-material-open').click(); assert.equal(await page.evaluate(() => materialSourceTest.opens.length), count);
      await card.locator('.mw-quote-cancel').click(); await page.evaluate(() => { materialSourceTest.failQuote = false; }); assert.equal(await page.evaluate(() => sourceUI.pending()), false);
    });
    await check('Link-only, missing and mismatched versions are explicit and never replaced by a newer body', async () => {
      const link = await add(page, 'link'); await page.locator('.mw-material-tab[data-material-id="' + link + '"]').click(); await page.locator('.mw-material[data-material-id="' + link + '"] .mw-material-link-only').waitFor();
      const first = await page.evaluate(() => materialSourceTest.plan.materials[0].id);
      await page.evaluate(() => { const f = materialSourceTest; f.bundle.sourceVersions = f.bundle.sourceVersions.filter(v => v.id !== f.old.version.id); }); await page.evaluate(() => sourceUI.refresh());
      await page.locator('.mw-material-tab[data-material-id="' + first + '"]').click(); assert.match(await page.locator('.mw-material[data-material-id="' + first + '"]').innerText(), /원문 버전이 없습니다/); assert.equal(await page.locator('.mw-material[data-material-id="' + first + '"] .mw-material-body').count(), 0);
      await page.evaluate(() => { const f = materialSourceTest; f.bundle = structuredClone(f.original); f.bundle.sourceVersions.find(v => v.id === f.old.version.id).contentHash = 'f'.repeat(64); }); await page.evaluate(() => sourceUI.refresh());
      assert.match(await page.locator('.mw-material[data-material-id="' + first + '"]').innerText(), /내용이 다릅니다/); assert.equal(await page.locator('.mw-material[data-material-id="' + first + '"] .mw-material-open').count(), 0);
    });
    page = await fixture();
    await check('Held quote work cannot double-adopt or mutate a different preparation after account invalidation', async () => {
      const id = await add(page, 'old'); await select(page, id); await page.evaluate(() => { materialSourceTest.holdRead = true; });
      await page.locator('.mw-quote-apply').click(); await page.waitForFunction(() => materialSourceTest.held === true);
      await page.locator('.mw-quote-apply').click(); assert.equal(await page.evaluate(() => materialSourceTest.quotes.length), 0);
      await page.evaluate(() => { materialSourceTest.valid = false; sourceUI.dispose(); materialSourceTest.releaseRead(); });
      await page.waitForFunction(() => !document.querySelector('.mw-sources')); assert.equal(await page.evaluate(() => materialSourceTest.quotes.length), 0);
    });
    page = await fixture();
    await check('Delayed refresh cannot resurrect disposed account content or commit an obsolete plan selection', async () => {
      await add(page, 'old'); await page.evaluate(() => { materialSourceTest.holdRead = true; window.lateRefresh = sourceUI.refresh(); }); await page.waitForFunction(() => materialSourceTest.held === true);
      await page.evaluate(async () => { materialSourceTest.plan = HaedoLife.MaterialWriting.create(HaedoLife.Core.id); materialSourceTest.valid = false; sourceUI.dispose(); materialSourceTest.releaseRead(); await lateRefresh; });
      assert.equal(await page.locator('.mw-sources').count(), 0); assert.equal(await page.evaluate(() => materialSourceTest.plan.materials.length), 0);
    });
    page = await fixture();
    await check('Desktop two-source comparison becomes one chosen source on mobile without losing comparison context', async () => {
      const first = await add(page, 'old'), second = await add(page, 'second'); await page.locator('.mw-compare-select').selectOption(second);
      for (const width of [1440, 820, 390]) {
        await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(expected => document.querySelectorAll('.mw-material-body').length === expected, width <= 760 ? 1 : 2);
        const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, active: sourceUI.getView(), readonly: [...document.querySelectorAll('.mw-material-body')].every(n => n.readOnly) }));
        assert.equal(metrics.overflow, false); assert.equal(metrics.readonly, true); assert.deepEqual(metrics.active, { activeId: first, compareId: second }); report.visual.push({ width, ...metrics }); await page.screenshot({ path: path.join(out, 'comparison-' + width + '.png'), fullPage: true });
      }
      await page.locator('.mw-material-tab[data-material-id="' + second + '"]').click(); assert.equal(await page.locator('.mw-material-body').inputValue(), '서로 다른 두 번째 원문\n전체 본문을 비교합니다.');
    });
    await check('A pending comparison quote remains reachable and explicitly cancellable after narrowing the viewport', async () => {
      const [first, second] = await page.evaluate(() => materialSourceTest.plan.materials.map(m => m.id));
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.locator('.mw-material-tab[data-material-id="' + first + '"]').click(); await page.locator('.mw-compare-select').selectOption(second);
      await page.locator('.mw-material[data-material-id="' + second + '"] .mw-material-body').evaluate(body => { body.focus(); body.setSelectionRange(0, 8); body.dispatchEvent(new Event('select')); });
      await page.setViewportSize({ width: 390, height: 1000 });
      await page.locator('.mw-material-tab[data-material-id="' + second + '"]').click();
      assert.equal(await page.locator('.mw-material[data-material-id="' + second + '"] .mw-quote-cancel').count(), 1, 'Mobile must expose the pending comparison selection instead of trapping navigation');
      await page.locator('.mw-material[data-material-id="' + second + '"] .mw-quote-cancel').click(); assert.equal(await page.evaluate(() => sourceUI.pending()), false);
      // Both sides may have pending selections before resizing. Each remains
      // reachable; switching to resolve one never silently discards the other.
      await page.setViewportSize({ width: 1440, height: 1000 });
      for (const id of [first, second]) await page.locator('.mw-material[data-material-id="' + id + '"] .mw-material-body').evaluate(body => { body.focus(); body.setSelectionRange(0, 6); body.dispatchEvent(new Event('select')); });
      await page.setViewportSize({ width: 390, height: 1000 });
      for (const id of [first, second]) { await page.locator('.mw-material-tab[data-material-id="' + id + '"]').click(); await page.locator('.mw-material[data-material-id="' + id + '"] .mw-quote-cancel').click(); }
      assert.equal(await page.evaluate(() => sourceUI.pending()), false);
      // A pending quote on one side must not hide an active Korean composition
      // on the other side when a mobile keyboard narrows the viewport.
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.locator('.mw-material-tab[data-material-id="' + first + '"]').click();
      await select(page, first);
      await page.locator('.mw-material[data-material-id="' + second + '"] .mw-material-note').evaluate(note => { window.composingMaterialNote = note; note.focus(); note.dispatchEvent(new CompositionEvent('compositionstart')); note.value = '한글 조합 중에도 유지하는 메모'; note.dispatchEvent(new InputEvent('input', { isComposing: true })); });
      await page.setViewportSize({ width: 390, height: 1000 });
      // setViewportSize can resolve before the native media-query change event.
      // Wait for the actual narrow layout, then independently check that the
      // original composing node and its input survived that layout transition.
      await page.waitForFunction(id => matchMedia('(max-width: 760px)').matches && sourceUI.getView().activeId === id &&
        document.querySelectorAll('.mw-material-body').length === 1 && document.querySelectorAll('.mw-material-note').length === 1, second);
      assert.equal(await page.evaluate(() => composingMaterialNote.isConnected && composingMaterialNote === document.querySelector('.mw-material-note')), true);
      assert.equal(await page.locator('.mw-material-note').inputValue(), '한글 조합 중에도 유지하는 메모'); assert(await page.evaluate(() => sourceUI.pending()));
      await page.locator('.mw-material-note').evaluate(note => note.dispatchEvent(new CompositionEvent('compositionend')));
      await page.locator('.mw-material-tab[data-material-id="' + first + '"]').click(); await page.locator('.mw-quote-cancel').click();
      assert.equal(await page.evaluate(() => sourceUI.pending()), false); assert.equal(await page.evaluate(id => materialSourceTest.plan.materials.find(m => m.id === id).note, second), '한글 조합 중에도 유지하는 메모');
    });
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } catch (error) { try { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(out, 'failure.png') }); report.failure = await page.evaluate(() => ({ error: document.querySelector('.mw-sources-error')?.textContent, quoteCount: window.materialSourceTest?.quotes.length, pending: window.sourceUI?.pending() })); } } catch (_) {} throw error; }
  finally { await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
