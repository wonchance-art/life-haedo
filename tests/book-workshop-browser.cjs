/* UI-only workshop journey: empty account → original imports → reflection → chosen outline
 * → authored book → edition recovery → JSON/Markdown/actual app PDF document.
 * No source/workbench seeding; storage reads only, except isolated IDB fault injection.
 * BASE_URL, PW_MODULE_PATH (or PLAYWRIGHT_MODULE), CHROMIUM_PATH; BOOK_WORKSHOP_MATCH filters. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
if (!process.env.PW_MODULE_PATH && process.env.PLAYWRIGHT_MODULE) process.env.PW_MODULE_PATH = process.env.PLAYWRIGHT_MODULE;
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, observe, nav } = require('./unified-home-browser.cjs');
const { current, save, details, download, openBook } = require('./book-projects-browser.cjs');
const { expand } = require('./book-insights-browser.cjs');
const { field } = require('./source-reimport-browser.cjs');
const { abortWorkbenchWrites } = require('./life-workbench-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve('.local/book-workshop');
const layoutOnly = process.env.BOOK_WORKSHOP_LAYOUT_ONLY === '1';
const samples=[
 {key:'work',origin:'naver_blog',title:'처음 일을 고르며 적어 둔 기준',date:'2016-03-14',relation:'self',url:'https://blog.naver.com/anonymous_workshop/222000000091',text:'첫 면접을 마치고 집으로 돌아왔다. 이름을 아는 회사에서 일하고 싶다는 마음과 내가 오래 잘할 일을 찾고 싶다는 마음이 섞여 있었다.\n\n잘하고 싶다는 마음이 오래 좋아할 조건을 대신하고 있었다. 먼저 일하는 선배의 말을 듣되 내가 매일 반복할 시간을 떠올려 보고 싶다.'},
 {key:'rest',origin:'apple_notes',title:'일을 잠시 쉬며 만든 하루의 순서',date:'2019-08-23',relation:'self',text:'일을 쉬기 시작한 첫 주에는 늦게 일어나는 자신을 계속 탓했다. 오전에 가까운 공원을 걷고 점심을 만들어 먹는 순서를 정하니 하루가 조금 선명해졌다.\n\n성과가 없어도 지킨 약속을 적었다. 쉬는 시간에도 나를 돌보는 기준은 자라고 있었다.'},
 {key:'learn',origin:'obsidian',title:'책 모임에서 질문을 바꾼 날',date:'2021-11-06',relation:'self',text:'정답을 준비해 가려던 책 모임에서 모른다고 말하는 사람의 이야기를 오래 들었다. 질문을 완성하지 않아도 서로의 경험을 읽을 수 있었다.\n\n잘 아는 사람이 되는 것보다 함께 배우는 사람이 되고 싶다는 생각을 처음 적었다.'},
 {key:'taste',origin:'instagram',title:'좋아하는 산책을 다시 고르다',date:'2025-04-20',relation:'self',url:'https://www.instagram.com/p/AnonymousWorkshop/',coverage:'partial',text:'화면에 잘 나오는 길보다 오래 걷고 싶은 길을 다시 골랐다. 같은 나무를 계절마다 찾아가며 사진을 한 장씩 남긴다🌱\n\n남에게 보여 주는 취향과 실제로 돌보는 취향이 조금 가까워졌다.',omissions:'사진과 댓글 미보관'},
 {key:'other',origin:'naver_blog',title:'일과 취미를 나누어 두는 사람의 이야기',date:'2021-05-03',relation:'other',author:'익명 필자',url:'https://blog.naver.com/anonymous_workshop/222000000092',coverage:'partial',text:'좋아하는 일을 직업으로 삼지 않아도 괜찮다. 생계를 지탱하는 일과 마음을 쉬게 하는 취미를 분리하면서 오히려 두 가지를 오래 지속할 수 있었다.',omissions:'본문 일부와 출처만 보관'},
 {key:'link',origin:'naver_blog',title:'지역 독립서점의 글쓰기 모임 안내',date:'',relation:'unknown',url:'https://blog.naver.com/anonymous_workshop/222000000093',text:null}
];
const chapters=[['잘하고 싶었던 마음','처음 일을 고를 때 나는 잘하는 사람으로 보이는 일을 먼저 생각했다. 당시 글에 남은 기대를 지금의 후회로 덮지 않고, 어떤 조건을 알 수 있었는지부터 적어 본다.',['work']],['쉬는 동안 생긴 기준','일을 잠시 멈춘 뒤에도 하루는 계속됐다. 산책과 식사를 챙기는 작은 약속이 성과와 다른 기준을 만들었다. 쉬는 시간을 빈칸으로 취급하지 않는 장을 쓰고 싶다.',['rest','other']],['함께 배우는 쪽으로','책 모임에서 질문이 바뀌었다. 모른다고 말할 수 있는 관계에서 더 오래 배우게 됐다는 장면을 남긴다.',['learn','link']],['오래 좋아하는 것을 고르기','좋아 보이는 것과 오래 좋아할 수 있는 것의 간격을 산책하며 읽었다. 아직 이 변화가 모든 선택에 이어졌다고 말할 수는 없다.',['taste']]];
const bookTitle = '오래 좋아할 기준을 찾아서';
const bookQuestion = '나는 무엇을 잘하는 사람보다 무엇을 오래 좋아하는 사람이 되고 싶었을까?';
const reflectionNote = '잘하고 싶은 마음에서 오래 좋아할 기준으로 옮겨 간 네 장면을 엮고 싶다. 다른 사람의 글은 내 경험과 나란히 두되 같은 신념으로 합치지 않는다.';
const latestBody = '첫 회사를 돌아보며 다시 쓴 글이다. 회사의 이름보다 함께 배울 동료와 질문할 시간이 더 중요했다. 당시와 지금의 판단을 하나의 결론으로 합치지 않는다.';
const statement = '내가 잘하는 사람으로 보이는 일보다 오래 좋아할 조건을 살피기 시작했다고 생각한다.';
const uncertainty = '몇 편의 글만으로 변화의 방향을 확정할 수 없다. 당시 적지 않은 이유도 있었을 수 있다.';
const excludedStatement = '초기에 적었지만 이번 원고에서는 제외하기로 한 잠정 해석.';
const button = async (page, name) => { await page.getByRole('button', { name, exact: true }).click(); await settle(page); };
function annotation(error) { if (process.env.GITHUB_ACTIONS) console.error('::error title=Book workshop::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')); }
async function records(page) {
  if (await page.getByRole('button', { name: '기록으로 돌아가기', exact: true }).isVisible()) await button(page, '기록으로 돌아가기');
  else if (await page.locator('#lifeSearchReturn').isVisible()) { await page.locator('#lifeSearchReturn').click(); await settle(page); }
  await nav(page, 'records');
  if (await page.getByRole('button', { name: '기록으로 돌아가기', exact: true }).isVisible()) await button(page, '기록으로 돌아가기');
  if (await page.getByRole('button', { name: '기록 목록', exact: true }).isVisible()) await button(page, '기록 목록');
  await page.locator('#lifeSearch').waitFor();
}
async function tools(page, name) { await nav(page, 'tools'); if (await page.getByRole('button', { name: '도구로 돌아가기', exact: true }).isVisible()) await button(page, '도구로 돌아가기'); await button(page, name); }
async function importUI(page) {
  await page.goto(base + '/index.html?section=records'); await ready(page); await settle(page); assert.equal((await current(page)).bundle.sources.length, 0);
  const refs = {};
  for (const sample of samples) {
    await records(page); await button(page, '가져오기'); await field(page, 'Origin', sample.origin); await field(page, 'Title', sample.title);
    if (sample.url) await field(page, 'Url', sample.url);
    if (sample.text !== null) await field(page, 'Text', sample.text); else await button(page, '링크 보관');
    await field(page, 'Relation', sample.relation); if (sample.author) await field(page, 'Author', sample.author); if (sample.date) await field(page, 'Date', sample.date);
    if (sample.text !== null) await field(page, 'Coverage', sample.coverage || 'full_text'); if (sample.omissions) await field(page, 'Omissions', sample.omissions);
    await button(page, '원문·출처 확인');
    if (sample.key === 'work') {
      const quote = '잘하고 싶다는 마음이 오래 좋아할 조건을 대신하고 있었다.';
      await page.locator('#lifeReviewText').evaluate((el, text) => { const at = el.value.indexOf(text); if (at < 0) throw Error('UI excerpt not found'); el.focus(); el.setSelectionRange(at, at + text.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, quote);
      await page.locator('#lifeExcerptTopic').fill('일의 기준'); await page.locator('#lifeExcerptNote').fill('지금도 이어지는 질문인지 다시 확인하기'); await button(page, '발췌 후보 추가'); await button(page, '선택한 발췌 모음에 반영');
    } else await button(page, '자료만 보관');
    const bundle = (await current(page)).bundle, source = bundle.sources.find(item => item.title === sample.title), version = bundle.sourceVersions.find(item => item.sourceId === source.id);
    assert.equal(version.contentText, sample.text); refs[sample.key] = { sourceId: source.id, versionId: version.id };
  }
  await records(page); await page.locator(`.life-source-open[data-version-id="${refs.work.versionId}"]`).click(); await page.locator('#lifeSourceInfoToggle').click(); await page.locator('#lifeSourceReimport').click(); await field(page, 'Text', latestBody); await field(page, 'Coverage', 'full_text'); await button(page, '원문·출처 확인'); await button(page, '자료만 보관');
  const bundle = (await current(page)).bundle; refs.latest = { sourceId: refs.work.sourceId, versionId: bundle.sourceVersions.filter(item => item.sourceId === refs.work.sourceId).at(-1).id };
  assert.equal(bundle.sources.length, 6); assert.equal(bundle.sourceVersions.length, 7); assert.equal(bundle.records.length, 1);
  const ref = bundle.records[0].sourceRefs[0]; assert.equal(ref.sourceVersionId, refs.work.versionId); assert.equal(samples[0].text.slice(ref.locator.start, ref.locator.end), bundle.records[0].text);
  return { refs, bundle };
}
async function arrangeReflection(page, refs, keys = samples.map(sample => sample.key), failApply = false) {
  await records(page); await page.locator('#lifeSelectionToggle').click();
  for (const key of keys) { const query = key === 'work' ? '오래 좋아할 조건을 대신' : samples.find(sample => sample.key === key).title; await page.locator('#lifeSearch').fill(query); await page.locator(`.life-source-select[data-version-id="${refs[key].versionId}"]`).click(); }
  const before = await current(page); await page.locator('#lifeArrangeReflection').click(); await page.locator('#wbIncomingSelection').waitFor(); assert.deepEqual((await current(page)).workbench, before.workbench);
  const selected = await page.locator('#wbIncomingSelection input[data-version-id]:checked').evaluateAll(nodes => nodes.map(node => node.dataset.versionId)); assert.deepEqual(new Set(selected), new Set(keys.map(key => refs[key].versionId)));
  if (failApply) await abortWorkbenchWrites(page, true);
  await page.locator('#wbIncomingApply').click(); await page.locator('#wbReflectionNote').waitFor();
  if (failApply) {
    await page.locator('#wbError').waitFor({ state: 'visible' }); assert.deepEqual((await current(page)).workbench, before.workbench);
    const pending = JSON.parse((await download(page, '#wbError button:has-text("초안 JSON 받기")')).text); assert.deepEqual(new Set(pending.workbench.reflection.versionIds), new Set(selected));
    await page.getByRole('button', { name: '도구로 돌아가기', exact: true }).click(); await settle(page); assert.equal(await page.locator('#wbReflectionNote').isVisible(), true, 'Unsaved incoming selection blocks departure');
    await abortWorkbenchWrites(page, false); await page.locator('#wbError').getByRole('button', { name: '다시 저장', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#wbStatus')?.dataset.state === 'saved');
    await records(page); assert.equal(await page.locator('#lifeSelectionBar').isVisible(), false, 'Durable retry consumes the source selection'); assert.equal(await page.locator('.life-source-select').count(), 0); await tools(page, '회고');
  }
  await save(page); assert.deepEqual(new Set((await current(page)).workbench.reflection.versionIds), new Set(keys.map(key => refs[key].versionId)));
}
async function openPreview(page) { const back = page.locator('#wbBookPreviewReturn'); await (await back.isVisible() ? back : page.locator('#wbBookPreviewOpen')).click(); await page.locator('#wbBookPreview').waitFor(); }
async function period(page, from, to) { await details(page, '작성 연도로 좁히기'); await page.locator('#wbReflectionFrom').fill(from); await page.locator('#wbReflectionTo').fill(to); await page.locator('#wbReflectionApplyPeriod').click(); }
async function role(page, name, ids) { await expand(page, '#wbInsight' + name); const box = await details(page, name === 'Support' ? '뒷받침할 원문 연결' : '다른 관점의 원문 연결'); for (const id of ids) await box.locator(`input[data-version-id="${id}"]`).check(); await box.locator(':scope > summary').click(); }
async function restoreEdition(page, id) { await expand(page, '#wbBookEditions'); const wait = page.waitForEvent('dialog'); const clicked = page.locator(`[data-edition-id="${id}"]`).getByRole('button', { name: '이 개정본으로 복원', exact: true }).click(); await (await wait).accept(); await clicked; await save(page); }
async function capture(page, report, scene, width) {
  await page.mouse.move(width - 2, 2); await page.evaluate(async () => { document.activeElement?.blur(); scrollTo(0, 0); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const metrics = await page.evaluate(inspect), screenshot = `${scene}-${width}.png`; await page.screenshot({ path: path.join(out, screenshot), fullPage: true }); if (width === 390) await page.screenshot({ path: path.join(out, `${scene}-${width}-viewport.png`) }); report.visual.push({ scene, width, screenshot, ...metrics });
  assert.equal(metrics.horizontalOverflow, false); for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ': ' + key);
}
async function preparePrintCapture(page) {
  await page.evaluate(() => { window.__workshopPrints = []; const create = document.createElement.bind(document); document.createElement = function (tag, opts) { const frame = create(tag, opts); if (String(tag).toLowerCase() !== 'iframe') return frame; const add = frame.addEventListener.bind(frame); frame.addEventListener = function (type, listener, settings) { if (type !== 'load') return add(type, listener, settings); return add(type, function (event) { if (frame.contentDocument?.documentElement?.dataset.haedoPrint === 'v1') frame.contentWindow.print = function () { window.__workshopPrints.push(frame.contentDocument.documentElement.outerHTML); frame.contentWindow.dispatchEvent(new Event('afterprint')); }; return listener.call(this, event); }, settings); }; return frame; }; });
}
async function printPDF(page, context, width) {
  await preparePrintCapture(page); await page.locator('#wbBookPrint').click(); await page.waitForFunction(() => __workshopPrints.length === 1); const html = await page.evaluate(() => __workshopPrints[0]); const target = path.join(out, `book-${width}.pdf`); await fs.writeFile(path.join(out, `book-${width}.html`), html);
  const print = await context.newPage(); try { await print.setContent(html); await print.evaluate(() => document.fonts.ready); await print.pdf({ path: target, preferCSSPageSize: true, printBackground: true }); } finally { await print.close(); }
  const text = execFileSync('pdftotext', ['-layout', target, '-'], { encoding: 'utf8' }); return { text, html, filename: path.basename(target) };
}
async function main() {
  await fs.mkdir(out, { recursive: true }); const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), layoutOnly, browser: browser.version(), scope: 'UI-created anonymous originals and manuscripts only; real SDK and IndexedDB with synthetic Auth. No production access. Chromium widths/touch/keyboard, not Apple hardware, native IME, print-dialog Save confirmation or a usability study.', checks: [], visual: [], observations: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, operatingRemoteWrites: 0 };
  async function check(name, width, run) {
    if (layoutOnly && name.startsWith('outline choices')) return;
    if (process.env.BOOK_WORKSHOP_MATCH && !new RegExp(process.env.BOOK_WORKSHOP_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'workshop-' + report.checks.length, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820, reducedMotion: 'reduce' });
    await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.external.push(u.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try { await run({ page, context }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); annotation(error); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const width of [1440, 820, 390]) await check(`${layoutOnly ? 'Final planner layout and preserved reflection return' : 'UI originals to four-chapter workshop, revision, JSON, Markdown and PDF'} at ${width}`, width, async ({ page, context }) => {
      const { refs, bundle } = await importUI(page); await arrangeReflection(page, refs); assert.equal((await current(page)).workbench.books, undefined);
      assert.deepEqual(await page.locator('#wbReflectionReading [data-reflection-group]').evaluateAll(nodes => nodes.map(node => node.dataset.reflectionGroup)), ['2016', '2019', '2021', '2025', 'unknown']); await page.locator('#wbReflectionNote').fill(reflectionNote); await save(page);
      await period(page, '2016', '2019'); await page.locator('#wbReflectionGroup').click(); await page.locator('#wbIncomingSelection').waitFor(); assert.equal(await page.locator('#wbIncomingSelection input:checked').count(), 3); await page.locator(`#wbIncomingSelection input[data-version-id="${refs.link.versionId}"]`).uncheck(); await page.locator('#wbIncomingTitle').fill('일과 쉼의 기준'); await page.locator('#wbIncomingApply').click(); await page.locator('#wbGroupsReflection').click(); await page.locator('#wbReflectionNote').waitFor(); await period(page, '', ''); await page.locator('#wbReflectionThemes').click();
      const group = (await current(page)).workbench.groups[0]; assert.deepEqual(new Set(group.versionIds), new Set([refs.work.versionId, refs.rest.versionId])); assert.equal(await page.locator(`#wbReflectionReading [data-reflection-group="${group.id}"] .wb-source`).count(), 2); assert.equal(await page.locator('#wbReflectionNote').inputValue(), reflectionNote);
      await page.locator('#wbReflectionTime').click(); const reflection = (await current(page)).workbench.reflection; await page.locator('#wbReflectionPlan').click(); await page.locator('#wbPlanTitle').fill(bookTitle); await page.locator('#wbPlanQuestion').fill(bookQuestion); assert.equal(await page.locator('#wbPlanChapters > li').count(), 5);
      await page.locator('#wbPlanThemes').click(); assert.equal(await page.locator('#wbPlanChapters > li').count(), 2); await page.locator('#wbPlanTime').click();
      await page.locator('#wbPlanChapters [data-plan-key="unknown"] input[type=checkbox]').uncheck(); for (let i = 0; i < 4; i++) await page.locator('#wbPlanChapter' + i).fill(chapters[i][0]); await capture(page, report, 'outline-plan', width);
      if (layoutOnly) { await page.locator('#wbPlanClose').click(); await page.locator('#wbReflectionNote').waitFor(); assert.equal(await page.locator('#wbReflectionNote').inputValue(), reflectionNote); assert.deepEqual((await current(page)).workbench.reflection, reflection); report.observations.push({ width, scope: 'Final planner-only layout after UI import, exact selection, reflection/group return and candidate choices. No full export/recovery repeat.' }); return; }
      await page.locator('#wbPlanCreate').focus(); await page.keyboard.press('Enter'); await page.locator('#wbChapterNote').waitFor(); await save(page); let book = (await current(page)).workbench.books[0]; const bookId = book.id; assert.equal(book.chapters.length, 4); assert(book.chapters.every(chapter => chapter.note === '')); assert.deepEqual((await current(page)).workbench.reflection, reflection); assert.deepEqual(book.chapters.map(chapter => chapter.versionIds), [[refs.work.versionId], [refs.rest.versionId], [refs.learn.versionId, refs.other.versionId], [refs.taste.versionId]]);
      await openPreview(page); await expand(page, '#wbBookReview'); assert.equal((await page.locator('#wbBookReview').innerText()).match(/아직 쓰지 않은 원고/g).length, 4); if (width === 390) await capture(page, report, 'empty-manuscript-review', width); await page.locator('#wbBookPreviewBack').click();
      await page.locator('#wbChapterNote').fill(chapters[0][1]); await expand(page, '#wbChapterInsights'); await page.locator('#wbInsightCreate').click(); await page.locator('#wbInsightStatement').fill(statement); await page.locator('#wbInsightUncertainty').fill(uncertainty); await role(page, 'Support', [refs.work.versionId]); await role(page, 'Counter', [refs.other.versionId, refs.link.versionId]); await save(page);
      let insight = (await current(page)).workbench.books[0].chapters[0].insights[0]; const source = page.locator(`#wbInsightSupportRows [data-version-id="${refs.work.versionId}"]`).getByRole('button', { name: '이 원문 버전 열기', exact: true }), key = await source.getAttribute('data-focus-key'); await source.click(); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), samples[0].text); await page.locator('#lifeSearchReturn').click(); await page.locator('#wbInsightStatement').waitFor(); await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, key);
      await page.locator('#wbInsightCreate').click(); await page.locator('#wbInsightStatement').fill(excludedStatement); await role(page, 'Counter', [refs.latest.versionId]); await page.locator('#wbInsightExclude').click(); await save(page);
      for (let i = 1; i < 4; i++) { await page.locator('#wbChapterNext').click(); await page.waitForFunction(title => document.querySelector('#wbChapterTitle')?.value === title, chapters[i][0]); await page.locator('#wbChapterNote').fill(chapters[i][1]); }
      await save(page); assert.equal(await page.locator('#wbChapterNext').isDisabled(), true); await page.locator('#wbChapterPrevious').click(); await page.waitForFunction(title => document.querySelector('#wbChapterTitle')?.value === title, chapters[2][0]); assert.equal(await page.locator('#wbChapterNote').inputValue(), chapters[2][1]); await page.locator('#wbChapterNext').click(); await page.waitForFunction(title => document.querySelector('#wbChapterTitle')?.value === title, chapters[3][0]); await openPreview(page); await expand(page, '#wbBookReview'); const review = await page.locator('#wbBookReview').innerText(); assert(review.includes('다른 사람의 글')); assert(review.includes('본문 미확보')); assert(review.includes('작성 시기 미확인')); assert(!review.includes('아직 쓰지 않은 원고')); await capture(page, report, 'whole-book-review', width);
      book = (await current(page)).workbench.books[0]; const editId = book.chapters[1].id; await page.locator(`[data-review-edit="${editId}"]`).click(); const edited = chapters[1][1] + '\n\n다만 일과 취미를 분리한다는 다른 사람의 선택도 가능한 길로 남겨 둔다.'; await page.locator('#wbChapterNote').fill(edited); await page.locator('#wbBookPreviewReturn').click(); await page.locator('#wbBookPreview').waitFor(); assert((await page.locator('#wbBookPreview').textContent()).includes(edited)); await page.locator('#wbBookPreviewBack').click();
      await expand(page, '#wbBookEditions'); await page.locator('#wbEditionLabel').fill('네 장을 처음 연결한 원고'); await page.locator('#wbEditionCapture').click(); await save(page); const savedA = (await current(page)).workbench.books[0], edition = savedA.editions[0]; await page.locator('#wbChapterNote').fill(edited + '\n복원 전 원고 B에만 남기는 문장.'); await save(page); await restoreEdition(page, edition.id); book = (await current(page)).workbench.books[0]; assert.equal(book.editions.length, 2); assert(book.editions[1].chapters.some(chapter => chapter.note.includes('원고 B에만'))); assert(!book.chapters.some(chapter => chapter.note.includes('원고 B에만'))); assert.equal(book.chapters[1].note, edited);
      await openPreview(page); const metadata = await download(page, '#wbBookPreviewExport'); assert(metadata.text.includes(statement)); assert(metadata.text.includes(uncertainty)); assert(!metadata.text.includes(excludedStatement)); assert(!metadata.text.includes(latestBody)); for (const sample of samples.filter(sample => sample.text)) assert(!metadata.text.includes(sample.text)); await fs.writeFile(path.join(out, `book-${width}.md`), metadata.text);
      const pdf = await printPDF(page, context, width); const normalized = pdf.text.replace(/\s/g, ''); for (const chapter of book.chapters) assert(normalized.includes(chapter.note.replace(/\s/g, ''))); assert(normalized.includes(statement.replace(/\s/g, ''))); assert(!normalized.includes(excludedStatement.replace(/\s/g, ''))); assert(!pdf.html.includes(latestBody)); assert(!pdf.html.includes(samples[0].text));
      await expand(page, '#wbBookPreviewOptions'); await page.locator('#wbBookPreviewIncludeSources').check(); const originals = await download(page, '#wbBookPreviewExport'); assert(originals.text.includes(samples[0].text)); assert(originals.text.includes(samples[4].text)); assert(!originals.text.includes(latestBody)); assert(!originals.text.includes(excludedStatement)); assert(originals.text.includes('본문 미확보')); assert.deepEqual((await current(page)).bundle, bundle); assert.deepEqual((await current(page)).workbench.reflection, reflection);
      const originalState = await current(page); await nav(page, 'manage'); await button(page, '자료·구성 백업'); const backup = await download(page, '#wbBackupDownload'); await fs.writeFile(path.join(out, `book-${width}-backup.json`), backup.text); const parsed = JSON.parse(backup.text); assert.deepEqual(parsed.workbench.books, originalState.workbench.books); assert.equal(parsed.workbench.books[0].chapters[0].insights[1].excluded, true);
      await page.locator('#wbRestoreFile').setInputFiles({ name: '익명-책-전체.json', mimeType: 'application/json', buffer: Buffer.from(backup.text) }); await page.locator('#wbRestoreInstall').click(); await page.locator('.life-workbench[data-mode="books"][aria-busy="false"]').waitFor(); assert.notEqual(await page.evaluate(() => HaedoLife.Shell.storage.getActive()), bundle.workspaceId); const copy = await current(page), copiedBook = copy.workbench.books[0]; assert.notEqual(copiedBook.id, bookId); assert.equal(copiedBook.editions.length, 2); assert.notEqual(copiedBook.editions[0].id, edition.id); assert.notEqual(copiedBook.chapters[0].insights[0].id, book.chapters[0].insights[0].id); assert.deepEqual(copiedBook.chapters.map(chapter => chapter.note), book.chapters.map(chapter => chapter.note)); const old = copy.bundle.sourceVersions.find(version => version.id === copiedBook.chapters[0].versionIds[0]); assert.equal(old.contentText, samples[0].text); const record = copy.bundle.records[0], ref = record.sourceRefs[0]; assert.equal(ref.sourceVersionId, old.id); assert.equal(old.contentText.slice(ref.locator.start, ref.locator.end), record.text); assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.readWorkbench(id), bundle.workspaceId), originalState.workbench);
      await tools(page, '책 만들기'); await openBook(page, copiedBook.id); await openPreview(page); await capture(page, report, 'restored-book-preview', width); await page.reload(); await ready(page); await openBook(page, copiedBook.id); assert.deepEqual((await current(page)).workbench.books[0], copiedBook);
      report.observations.push({ width, uiImportedSources: 6, immutableVersions: 7, exactOldExcerptPreserved: true, sourceSelectionToReflectionNoReselect: true, filteredReflectionToGroupNoReselect: true, chosenOutlineChapters: 4, automaticChapterManuscripts: 0, nextPreviousEditAndReviewReturn: true, activeAndExcludedInsightsIndependent: true, editionRestoreAutoCapturesPrior: true, JSONRestoredWithNewIds: true, pdf: pdf.filename, nativePDFSaveNotClaimed: true });
    });
    await check('outline choices survive close and changed reading range; failed and repeated create recovers one book', 390, async ({ page }) => {
      const { refs } = await importUI(page); await arrangeReflection(page, refs, ['work', 'rest', 'link'], true); await page.locator('#wbReflectionNote').fill(reflectionNote); await save(page); const baseline = await current(page);
      await page.locator('#wbReflectionPlan').click(); await page.locator('#wbPlanTitle').fill(bookTitle); await page.locator('#wbPlanQuestion').fill(bookQuestion); await page.locator('#wbPlanChapters [data-plan-key="unknown"] input[type=checkbox]').uncheck(); await page.locator('#wbPlanChapter0').fill('첫 기준을 다시 읽기'); await page.locator('#wbPlanClose').click(); await period(page, '2019', '2025'); await page.locator('#wbReflectionPlan').click(); assert.equal(await page.locator('#wbPlanTitle').inputValue(), bookTitle); assert.equal(await page.locator('#wbPlanQuestion').inputValue(), bookQuestion); assert.equal(await page.locator('#wbPlanChapter0').inputValue(), '첫 기준을 다시 읽기'); assert.equal(await page.locator('#wbPlanChapters [data-plan-key="unknown"] input[type=checkbox]').isChecked(), false); assert.equal(await page.locator('#wbPlanChapters [data-plan-key="2016"]').count(), 1, 'Opening again must preserve the captured source range'); assert.deepEqual(await current(page), baseline);
      await abortWorkbenchWrites(page, true); await page.locator('#wbPlanCreate').evaluate(el => { el.click(); el.click(); }); await page.locator('#wbError').waitFor({ state: 'visible' }); assert.deepEqual(await current(page), baseline); assert.equal(await page.locator('#wbPlanTitle').inputValue(), bookTitle); assert.equal(await page.locator('#wbPlanChapter0').inputValue(), '첫 기준을 다시 읽기'); assert.equal(await page.locator('#wbPlanCreate').textContent(), '저장 후 책 열기'); const recovery = JSON.parse((await download(page, '#wbError button:has-text("초안 JSON 받기")')).text); assert.equal(recovery.workbench.books.length, 1); assert.equal(recovery.workbench.books[0].chapters.length, 2); assert.equal(recovery.workbench.books[0].chapters[0].versionIds[0], refs.work.versionId); await capture(page, report, 'plan-save-error', 390);
      await abortWorkbenchWrites(page, false); await page.locator('#wbPlanCreate').click(); await page.locator('#wbChapterNote').waitFor(); await save(page); const result = await current(page); assert.equal(result.workbench.books.length, 1); assert.equal(result.workbench.books[0].id, recovery.workbench.books[0].id); assert.deepEqual(result.workbench.reflection, baseline.workbench.reflection); assert.equal(result.workbench.books[0].chapters[0].title, '첫 기준을 다시 읽기');
    });
    assert(report.checks.length > 0); report.pass = report.checks.every(check => check.pass) && !report.consoleErrors.length && !report.pageErrors.length && !report.external.length;
  } finally { await browser.close(); report.finishedAt = new Date().toISOString(); const json = JSON.stringify(report, null, 2); await fs.writeFile(path.join(out, 'run-' + report.createdAt.replace(/[:.]/g, '-') + '.json'), json); await fs.writeFile(path.join(out, layoutOnly ? 'planner-layout-report.json' : 'browser-report.json'), json); }
  console.log(JSON.stringify({ checks: report.checks.length, passed: report.checks.filter(check => check.pass).length, visual: report.visual.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length, report: path.join(out, layoutOnly ? 'planner-layout-report.json' : 'browser-report.json') })); if (!report.pass) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); annotation(error); process.exitCode = 1; });

module.exports = { importUI, arrangeReflection, samples, chapters, bookTitle, bookQuestion, reflectionNote, latestBody };
