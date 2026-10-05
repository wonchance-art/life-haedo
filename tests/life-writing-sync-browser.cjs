/* Optional two-device writing regression. Real SDK/app/IndexedDB with only
 * anonymous intercepted Supabase HTTP, not live SQL/RLS or Apple hardware.
 * BASE_URL=http://127.0.0.1:4184 node tests/life-writing-sync-browser.cjs */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe } = require('./unified-home-browser.cjs');
const out = path.resolve(__dirname, '../.local/writing-sync');
const originalText = '오늘 읽은 책에서 나만의 질문을 찾았다.\n다른 기기에서도 그대로 이어 읽을 글🌱';
const revisedText = originalText + '\n기기 B에서 다시 읽고 생각을 한 문장 더 보탰다.';
const draftText = '기기 A에만 남길 미완성 초안 — 동기화 대상이 아니다.';
const bundle = (page, id) => page.evaluate(id => HaedoLife.Shell.storage.read(id), id);
const stages = (page, id) => page.evaluate(id => HaedoLife.Shell.storage.listStages(id), id);

async function save(page, count) {
  await page.locator('#lifeWritingSave').click();
  await page.waitForFunction(count => {
    const storage = HaedoLife.Shell.storage;
    return storage.getActive().then(id => storage.read(id)).then(value => value.sourceVersions.length === count);
  }, count);
  await settle(page);
  await page.locator('#lifeSourceText').waitFor();
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const server = new FakeCloud(), contexts = [];
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), scope: 'Two isolated Chromium contexts, same anonymous account; actual SDK and IndexedDB, intercepted HTTP only', checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, externalRequests: [], simulatedWrites: 0, productionWrites: 0 };
  async function device(name) {
    const context = await makeContext(browser, server, name, accounts.a); contexts.push(context);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
      report.externalRequests.push({ origin: url.origin, path: url.pathname });
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    await page.goto(base + '/index.html?section=records&view=write'); await ready(page);
    await page.waitForFunction(id => HaedoLife.Shell.sync.getAccount()?.userId === id, accounts.a.id);
    await page.locator('#lifeWritingBody').waitFor();
    return page;
  }
  try {
    const a = await device('writing-device-a'), b = await device('writing-device-b');
    const id = await a.evaluate(() => HaedoLife.Shell.storage.getActive());
    const bEmptyId = await b.evaluate(() => HaedoLife.Shell.storage.getActive());
    await a.locator('#lifeWritingTitle').fill('산책과 독서 사이에서 남긴 내 글');
    await a.locator('#lifeWritingBody').fill(originalText); await save(a, 1);
    const first = await bundle(a, id), originalVersion = first.sourceVersions[0];
    assert.match(first.sources[0].sourceKey, /^haedo:writing:[0-9a-f-]{36}$/i);
    await a.getByRole('button', { name: '글쓰기', exact: true }).click();
    await a.locator('#lifeWritingTitle').fill('아직 다 쓰지 않은 글'); await a.locator('#lifeWritingBody').fill(draftText);
    await a.waitForFunction(() => document.querySelector('#lifeWritingStatus')?.dataset.state === 'draft');
    const localDraft = (await stages(a, id)).find(stage => stage.kind === 'writing' && stage.state === 'draft');
    assert.equal(localDraft.text, draftText); assert.equal(server.writes().length, 0, 'No upload before explicit sync opt-in');

    await a.evaluate(id => HaedoLife.Shell.sync.enable(id), id);
    await a.evaluate(id => HaedoLife.Shell.sync.syncNow(id), id);
    assert.equal((await a.evaluate(id => HaedoLife.Shell.sync.getState(id), id)).status, 'synced');
    const firstRemote = server.row(accounts.a.id, id);
    assert.equal(firstRemote.data.sources[0].sourceKey, first.sources[0].sourceKey);
    assert.deepEqual(firstRemote.data.sourceVersions, first.sourceVersions);
    assert(!JSON.stringify(firstRemote.data).includes(draftText));
    assert(!JSON.stringify(firstRemote.data).includes(localDraft.stageId));

    await b.evaluate(async id => { await HaedoLife.Shell.sync.download(id); await HaedoLife.Shell.storage.setActive(id); }, id);
    await b.goto(base + '/index.html?section=records'); await ready(b); await settle(b);
    assert.deepEqual((await bundle(b, id)).sourceVersions, first.sourceVersions);
    assert.equal((await bundle(b, id)).sources[0].sourceKey, first.sources[0].sourceKey);
    assert.deepEqual(await stages(b, id), [], 'No local draft or applied stage crosses devices');
    await b.locator('.life-source-open[data-version-id="' + originalVersion.id + '"]').click(); await settle(b);
    assert.equal(await b.locator('#lifeSourceText').textContent(), originalText);
    await b.getByRole('button', { name: '내 글 수정', exact: true }).click();
    assert.equal(await b.locator('#lifeWritingBody').inputValue(), originalText);
    await b.locator('#lifeWritingBody').fill(revisedText); await save(b, 2);
    await b.evaluate(id => HaedoLife.Shell.sync.syncNow(id), id);
    assert.equal((await b.evaluate(id => HaedoLife.Shell.sync.getState(id), id)).status, 'synced');
    const revised = await bundle(b, id);
    assert.equal(revised.sources.length, 1); assert.equal(revised.sources[0].sourceKey, first.sources[0].sourceKey);
    assert.deepEqual(revised.sourceVersions.find(value => value.id === originalVersion.id), originalVersion);
    assert.equal(revised.sourceVersions.at(-1).contentText, revisedText);

    await a.evaluate(id => HaedoLife.Shell.sync.download(id), id);
    const received = await bundle(a, id);
    assert.deepEqual(received.sourceVersions, revised.sourceVersions);
    assert.deepEqual(received.sources, revised.sources);
    assert.deepEqual((await stages(a, id)).find(stage => stage.stageId === localDraft.stageId), localDraft);
    await a.goto(base + '/index.html?section=records'); await ready(a); await settle(a);
    await a.locator('.life-source-open[data-version-id="' + revised.sourceVersions.at(-1).id + '"]').click(); await settle(a);
    assert.equal(await a.locator('#lifeSourceText').textContent(), revisedText);
    assert(await a.getByRole('button', { name: '내 글 수정', exact: true }).isVisible());
    await a.getByRole('button', { name: '글쓰기', exact: true }).click();
    assert.equal(await a.locator('#lifeWritingBody').inputValue(), draftText);
    assert.equal(server.writes(accounts.a.id, bEmptyId).length, 0, 'Downloading does not upload the blank workspace');
    assert(server.writes().every(request => request.owner === accounts.a.id && request.id === id));
    report.checks.push({ name: 'Explicit two-device writing sync preserves source identity and immutable versions while local drafts stay on device A', pass: true });
    console.log('PASS writing two-device sync, edit, immutable original and draft exclusion');
  } catch (error) {
    report.checks.push({ name: 'Explicit two-device writing sync', pass: false, error: error.stack }); console.error(error.stack);
  } finally {
    report.simulatedWrites = server.writes().length;
    for (const context of contexts) await context.close(); await browser.close();
    const json = JSON.stringify(report, null, 2) + '\n';
    await fs.writeFile(path.join(out, 'browser-report.json'), json);
    await fs.writeFile(path.join(out, 'run-' + report.createdAt.replace(/[:.]/g, '-') + '.json'), json);
  }
  if (report.checks.some(check => !check.pass) || report.consoleErrors.length || report.pageErrors.length || report.externalRequests.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
