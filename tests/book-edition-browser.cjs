/* Reader booklet output: UI-authored four-chapter manuscript; actual preview, HTML
 * and print document produce A5/A4 PDFs. Synthetic Auth, isolated IndexedDB only.
 * BASE_URL, PW_MODULE_PATH/PLAYWRIGHT_MODULE, CHROMIUM_PATH; BOOK_EDITION_MATCH. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
if (!process.env.PW_MODULE_PATH && process.env.PLAYWRIGHT_MODULE) process.env.PW_MODULE_PATH = process.env.PLAYWRIGHT_MODULE;
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { FakeCloud, accounts, password, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, observe } = require('./unified-home-browser.cjs');
const { current, save, details, download, go, openBook, createBook, createChapter } = require('./book-projects-browser.cjs');
const { expand } = require('./book-insights-browser.cjs');
const { abortWorkbenchWrites } = require('./life-workbench-browser.cjs');
const { importUI, arrangeReflection, samples, chapters, bookQuestion, latestBody } = require('./book-workshop-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve('.local/book-edition');
const title = '일과 쉼 사이에서 오래 좋아할 기준을 찾아서 — 네 번의 선택을 다시 읽는 기록';
const activeStatement = '지금은 잘하는 사람으로 보이는 일과 오래 좋아할 조건을 구분해 보려 한다.';
const uncertainty = '그때 말하지 않았던 사정이 있었을 수 있다. 남은 글만으로 모든 선택을 설명하지 않는다.';
const excludedStatement = '보류한 해석은 이번 독자용 책자에 내보내지 않는다.';
const notes = [
 [
  '처음 면접을 보러 가던 아침에는 평소보다 일찍 집을 나섰다. 역 앞에서 커피를 사면서 회사 이름이 적힌 안내 문자를 몇 번이나 다시 읽었다. 무엇을 하게 될지보다 그 이름을 다른 사람에게 어떻게 말할지 먼저 생각했다는 사실은 한참 뒤에야 알아차렸다.',
  '그날의 메모에는 질문과 답변보다 면접관의 표정이 더 자세히 남아 있다. 고개를 끄덕였다는 것, 다음 질문으로 빨리 넘어갔다는 것, 마지막에 수고했다고 말했다는 것을 하나씩 적었다. 내가 하고 싶은 일은 한 줄이었고, 나를 어떻게 보았을지에 대한 추측은 한 쪽을 채웠다.',
  '돌아오는 전철에서 친구에게 잘 본 것 같다고 말했다. 잘 보았다는 말의 기준을 물었다면 대답하기 어려웠을 것이다. 준비한 문장을 빠뜨리지 않았고 분위기가 나쁘지 않았다는 뜻이었다. 실제로 내가 질문해야 했던 근무 방식이나 동료의 역할은 거의 묻지 못했다.',
  '당시에는 선택할 수 있는 기회가 많지 않다고 느꼈다. 그래서 먼저 평가받고, 합격한 뒤에 내게 맞는지 생각해도 늦지 않다고 여겼다. 지금 읽는 사람에게 그 판단이 틀렸다고 말하고 싶지는 않다. 그때의 정보와 걱정 속에서는 꽤 현실적인 순서였기 때문이다.',
  '며칠 뒤 연락을 기다리며 적은 글에는 다른 장면이 나온다. 예전에 짧게 도왔던 작은 가게에서 하루의 일을 함께 정리하던 시간이다. 그곳에서는 내가 질문하면 누군가 실제 일을 보여 주었다. 실수한 이유를 설명할 수 있었고 다음번에는 무엇을 바꿀지도 함께 정했다.',
  '나는 그 기억을 면접에 관한 글과 따로 보관해 두었다. 하나는 중요한 진로 기록이고 다른 하나는 지나간 아르바이트 이야기라고 생각했다. 이번에 두 글을 나란히 놓으니 회사의 크기와 무관하게 내가 반복해서 찾은 조건이 있었다. 질문할 수 있는 사람과 다음 날 다시 시도할 시간이 필요했다.',
  '이 연결이 당시의 진짜 속마음을 모두 밝혀 주는 것은 아니다. 생활비를 벌어야 한다는 압박과 새로운 동네로 옮겨 보고 싶은 마음도 있었다. 기억에 잘 남지 않는 이유를 지우고 하나의 성장 이야기로 정리하면 문장은 매끈해질지 몰라도 실제 선택과는 멀어진다.',
  '그래서 이 장을 쓰면서 먼저 남긴 것은 결론이 아니라 장면의 순서다. 안내 문자를 읽던 아침, 질문하지 못하고 나온 면접실, 가게 마감을 도우며 다음 일을 물었던 저녁을 차례로 놓았다. 각 장면에서 내가 알고 있었던 것과 아직 몰랐던 것을 구분해 적었다.',
  '첫 직장에서 배운 일 중에는 지금도 계속하는 습관이 있다. 막힌 부분을 혼자 오래 붙잡기 전에 이미 해 본 사람에게 상황을 설명하는 일이다. 설명하다 보면 질문 자체가 바뀌기도 한다. 도움을 구하는 것이 능력 부족의 증거라는 생각을 천천히 내려놓게 되었다.',
  '물론 평가를 의식하지 않게 된 것은 아니다. 새로운 일을 시작할 때면 아직도 준비한 말을 잘 전달했는지 먼저 돌아본다. 다만 그다음에 한 가지 질문을 더 하게 됐다. 이곳에서 매일 반복할 시간은 어떤 모습이며, 나는 그 시간을 오래 견디는 것을 넘어 좋아할 수 있을까.',
  '다른 사람의 글에는 직업과 좋아하는 일을 분리한 이야기가 있었다. 생활을 지탱하는 일을 안정적으로 이어 가면서 취미에 기대를 모두 걸지 않았다는 설명이었다. 내 경험과 다르지만 그 선택을 반례로 남겨 두고 싶다. 좋아하는 일을 직업으로 만드는 것만이 유일한 답은 아니다.',
  '이 장에서 말하는 기준은 완성된 목록이 아니다. 어떤 때에는 수입이, 어떤 때에는 함께 배우는 관계가 더 중요했다. 달라진 우선순위를 일관성 부족으로 취급하는 대신 그때 감당할 수 있었던 조건을 기록해 보려 한다. 기준도 생활의 변화 속에서 다시 쓰일 수 있다.',
  '옛 글의 한 문장을 고치고 싶은 날도 있었다. 너무 단순하게 적었다는 생각이 들었기 때문이다. 그러나 원문은 그대로 두고 지금의 설명을 옆에 남기기로 했다. 과거의 문장을 오늘의 언어로 덮으면 내가 무엇을 새로 알게 되었는지 비교할 자리가 사라진다.',
  '마지막으로 면접을 마치고 집 앞 골목을 걷던 기억을 붙였다. 합격 여부를 아직 몰랐지만 그날 해야 할 일을 마쳤다는 안도감이 있었다. 미래를 정확히 예측하지 못한 자신을 탓하기보다 다음 질문을 남기는 것으로 이 장을 끝낸다. 내가 오래 좋아할 하루의 조건은 무엇일까.'
 ].join('\n\n'),
 [
  '일을 잠시 멈춘 첫 주에는 달력이 유난히 넓어 보였다. 약속이 없는 오후를 자유라고 부르다가도 저녁이 되면 무엇을 했는지 설명해야 할 것 같았다. 메모를 열어 보니 쉬는 날에도 일을 했던 날과 같은 방식으로 자신을 채점하고 있었다.',
  '처음 바꾼 일은 거창한 계획이 아니었다. 일어나면 커튼을 열고 점심 한 끼를 직접 만드는 순서를 정했다. 오전에 실패하면 하루 전체를 포기하는 대신 오후에 할 수 있는 작은 일을 골랐다. 이 순서는 성과를 늘리기보다 다시 시작할 자리를 만드는 데 도움이 됐다.',
  '가까운 공원을 걷던 날에는 나무 이름을 몰라도 멈춰 볼 수 있었다. 사진을 남기지 않은 길의 모양을 집에 돌아와 적었다. 기록을 잘 남기기 위해 경험하는 것이 아니라 지나간 경험을 다시 알아차리려고 기록한다는 감각이 조금 생겼다.',
  '다른 사람에게 이 시간을 설명하는 일은 여전히 어려웠다. 쉬고 있다고 말한 뒤 괜히 배우는 것과 준비하는 일을 덧붙이곤 했다. 지금 그 말을 읽으며 당시의 불안을 이해하려 한다. 쉬는 시간에도 쓸모를 증명해야 한다고 느꼈던 마음이 있었다.',
  '누구에게나 같은 휴식이 가능하다고 말할 수는 없다. 돈과 건강, 돌볼 사람의 유무에 따라 멈출 수 있는 시간은 다르다. 내 경험을 보편적인 방법으로 만들기보다 내가 도움을 받았던 조건을 함께 적어 두는 편이 정확하다.',
  '이 시기의 끝에서 남은 것은 빈 달력을 채우는 기술이 아니었다. 약속을 지키지 못한 날에도 다음 하루를 시작할 수 있다는 경험이었다. 쉬는 동안 세운 기준은 이후 다시 일할 때에도 작은 복귀 지점이 되어 주었다.'
 ].join('\n\n'),
 [
  '책 모임에 처음 나가던 날에는 밑줄 친 문장을 많이 준비했다. 제대로 읽었다는 것을 보여 주고 싶어서였다. 그런데 모임에서 오래 남은 이야기는 정리된 의견보다 이해하지 못한 부분을 묻는 질문이었다.',
  '한 사람은 인물의 선택이 납득되지 않는다고 말했다. 다른 사람은 비슷한 상황에서 자신이 했던 일을 조심스럽게 꺼냈다. 정답을 고르는 대화였다면 지나쳤을 장면이 서로 다른 경험 덕분에 조금 넓어졌다.',
  '집에 돌아와 메모의 제목을 바꿨다. 책의 핵심을 정리한 글에서 다음에 물어볼 질문으로 바꾼 것이다. 이미 알고 있는 것을 증명하려는 마음과 새로 알아보고 싶은 마음은 비슷해 보여도 대화를 다른 방향으로 이끈다.',
  '모른다고 말하기 쉬운 관계가 저절로 만들어지지는 않았다. 질문을 재촉하지 않는 시간과 말하지 않아도 괜찮다는 약속이 필요했다. 그 조건을 사람의 성격으로만 설명하지 않고 모임을 운영하는 방식으로도 기억해 두려 한다.',
  '이 장에 연결한 모임 안내는 링크만 보관돼 있다. 실제 프로그램의 세부 내용까지 읽었다고 쓰지 않는다. 확보한 자료와 아직 확인하지 않은 부분을 구분하는 태도는 책을 읽을 때뿐 아니라 나의 경험을 설명할 때도 필요하다.',
  '잘 아는 사람이 되고 싶었던 마음은 사라지지 않았다. 다만 혼자 완성한 답을 가져가는 것만이 준비는 아니라는 것을 배웠다. 다음 사람의 질문을 들을 여백을 남기는 것도 함께 배우기 위한 준비였다.'
 ].join('\n\n'),
 [
  '좋아하는 산책길을 물으면 한동안 사진이 잘 나오는 장소를 먼저 말했다. 실제로 자주 걷는 길은 특별한 풍경이 없는 동네 길이었다. 어느 쪽이 진짜 취향인지 고르려 하기보다 두 길에서 기대하는 것이 다르다는 사실을 적어 보았다.',
  '같은 나무를 계절마다 찾아가며 사진을 한 장씩 남겼다🌱 잎의 색이 크게 바뀌지 않은 날에도 빛의 방향과 그림자의 길이가 달랐다. 변화가 작다는 이유로 기록하지 않았더라면 보지 못했을 차이였다.',
  '화면에 올릴 사진을 고르는 시간과 그날을 기억하는 시간이 꼭 같지는 않았다. 잘 나온 한 장에서는 길을 잘못 들어 돌아왔던 경험이 빠졌다. 공개할 글을 편집하더라도 개인 기록에는 그 우회로를 남겨 두고 싶었다.',
  '예전에는 취향이 일관되어야 자신을 잘 설명할 수 있다고 생각했다. 지금은 오래 좋아한 것과 새로 궁금해진 것이 함께 있어도 괜찮다고 느낀다. 달라진 관심을 곧바로 정체성의 변화로 선언하지 않고 조금 더 경험할 시간을 주기로 했다.',
  '여기까지의 글은 네 번의 선택을 한 방향의 성장으로 묶으려는 시도가 아니다. 잘하고 싶은 마음, 쉬고 싶은 마음, 배우고 싶은 마음과 보여 주고 싶은 마음은 지금도 함께 있다. 어느 하나를 없애기보다 각각이 언제 앞에 나오는지 알아차리려 한다.',
  '책의 마지막에는 다음 산책에서 확인할 질문을 남긴다. 남에게 설명하기 좋은 선택과 내가 다시 돌아가고 싶은 선택 사이의 거리는 얼마나 될까. 답을 서둘러 정하지 않고 다음에 쓴 글과 나란히 읽을 수 있도록 오늘의 문장을 보관한다.'
 ].join('\n\n')
];
const clean = value => value.replace(/\s/g, '');
const button = async (page, name) => { await page.getByRole('button', { name, exact: true }).click(); await settle(page); };
function annotation(error) { if (process.env.GITHUB_ACTIONS) console.error('::error title=Book edition::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')); }
async function role(page, name, ids) { await expand(page, '#wbInsight' + name); const box = await details(page, name === 'Support' ? '뒷받침할 원문 연결' : '다른 관점의 원문 연결'); for (const id of ids) await box.locator(`input[data-version-id="${id}"]`).check(); await box.locator(':scope > summary').click(); }
async function manuscript(page) {
  const fixture = await importUI(page); await arrangeReflection(page, fixture.refs); await page.locator('#wbReflectionPlan').click(); await page.locator('#wbPlanTitle').fill(title); await page.locator('#wbPlanQuestion').fill(bookQuestion); await page.locator('#wbPlanChapters [data-plan-key="unknown"] input[type=checkbox]').uncheck();
  for (let i = 0; i < 4; i++) await page.locator('#wbPlanChapter' + i).fill(chapters[i][0]); await page.locator('#wbPlanCreate').click(); await page.locator('#wbChapterNote').waitFor();
  await details(page, '책 설정'); await page.locator('#wbBookFromYear').fill('2016'); await page.locator('#wbBookToYear').fill('2025'); await page.locator('#wbChapterNote').fill(notes[0]); await expand(page, '#wbChapterInsights'); await page.locator('#wbInsightCreate').click(); await page.locator('#wbInsightStatement').fill(activeStatement); await page.locator('#wbInsightUncertainty').fill(uncertainty); await role(page, 'Support', [fixture.refs.work.versionId]); await role(page, 'Counter', [fixture.refs.other.versionId, fixture.refs.link.versionId]); await save(page);
  await page.locator('#wbInsightCreate').click(); await page.locator('#wbInsightStatement').fill(excludedStatement); await role(page, 'Counter', [fixture.refs.latest.versionId]); await page.locator('#wbInsightExclude').click(); await save(page);
  for (let i = 1; i < 4; i++) { await page.locator('#wbChapterNext').click(); await page.waitForFunction(title => document.querySelector('#wbChapterTitle')?.value === title, chapters[i][0]); await page.locator('#wbChapterNote').fill(notes[i]); }
  await save(page); const state = await current(page); assert.equal(state.workbench.books.length, 1); assert.equal(state.workbench.books[0].chapters.length, 4); assert.deepEqual(state.bundle, fixture.bundle); return { ...fixture, state, book: state.workbench.books[0] };
}
async function edition(page, paper = 'A5', insights = false, sources = false) {
  await page.waitForFunction(({ paper, insights, sources }) => { const frame = document.querySelector('#wbEditionPreview'), doc = frame?.contentDocument; return document.querySelector('#wbEditionStatus')?.textContent.startsWith('책자 준비됨') && doc?.documentElement.dataset.printMode === 'book' && doc.documentElement.dataset.printPaper === paper && !!doc.querySelector('.insight') === insights && !!doc.querySelector('.source-body') === sources; }, { paper, insights, sources });
  return (await page.locator('#wbEditionPreview').elementHandle()).contentFrame();
}
async function capture(page, report, scene, width) {
  await page.mouse.move(width - 2, 2); await page.evaluate(async () => { document.activeElement?.blur(); scrollTo(0, 0); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const metrics = await page.evaluate(inspect), file = `${scene}-${width}.png`; await page.screenshot({ path: path.join(out, file), fullPage: true }); if (width === 390) await page.screenshot({ path: path.join(out, `${scene}-${width}-viewport.png`) });
  const frame = await page.locator('#wbEditionPreview').count() ? await page.locator('#wbEditionPreview').elementHandle() : null; const frameMetrics = frame ? await (await frame.contentFrame()).evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyFont: getComputedStyle(document.querySelector('.manuscript') || document.body).fontSize, targets: [...document.querySelectorAll('.book-toc a')].map(el => el.getBoundingClientRect().height) })) : null; if (frameMetrics) { assert(frameMetrics.scrollWidth <= frameMetrics.width + 1, 'Booklet does not overflow its viewport'); assert(parseFloat(frameMetrics.bodyFont) >= 16); assert(frameMetrics.targets.every(height => height >= 44)); } report.visual.push({ scene, width, screenshot: file, frameMetrics, ...metrics }); assert.equal(metrics.horizontalOverflow, false); for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ': ' + key);
}
async function capturePrint(page, { hold = false } = {}) {
  await page.evaluate(hold => {
    window.__editionPrints = []; window.__editionPrintHeld = false; window.__editionHold = hold; window.__editionPrintFinished = false;
    const gate = new Promise(resolve => { window.__editionRelease = resolve; }); window.__editionCreateOriginal ||= document.createElement.bind(document); const create = window.__editionCreateOriginal;
    document.createElement = function (tag, options) { const frame = create(tag, options); if (String(tag).toLowerCase() !== 'iframe') return frame; const add = frame.addEventListener.bind(frame);
      frame.addEventListener = function (type, listener, settings) { if (type !== 'load') return add(type, listener, settings); return add(type, async function (event) {
        if (frame.hasAttribute('data-book-print') && frame.contentDocument?.documentElement?.dataset.haedoPrint === 'v1') {
          frame.contentWindow.print = () => { window.__editionPrints.push(frame.contentDocument.documentElement.outerHTML); frame.contentWindow.dispatchEvent(new Event('afterprint')); };
          if (window.__editionHold) { window.__editionPrintHeld = true; await gate; window.__editionPrintFinished = true; }
        }
        return listener.call(this, event);
      }, settings); }; return frame;
    };
  }, hold);
}
async function authenticate(page, account) {
  await page.evaluate(async ({ email, password }) => { const result = await HaedoAuth.client.auth.signInWithPassword({ email, password }); if (result.error) throw result.error; await HaedoAuth.verify(); }, { email: account.email, password });
  await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell?.storage && HaedoLife.Shell.sync?.getAccount()?.userId === id, account.id); await ready(page); await settle(page);
}
async function output(page, context, report, width, paper, expectedNotes, { insights = false, sources = false, suffix = '' } = {}) {
  const frame = await edition(page, paper, insights, sources), view = await frame.evaluate(() => document.documentElement.outerHTML), raw = await download(page, '#wbEditionHTML');
  assert.match(raw.name, /\.html$/); const parsed = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').documentElement.outerHTML, raw.text); assert.equal(parsed, view, 'Downloaded HTML and actual preview have the same document');
  await capturePrint(page); await page.locator('#wbEditionPrint').focus(); await page.keyboard.press('Enter'); await page.waitForFunction(() => __editionPrints.length === 1); assert.equal(await page.evaluate(() => __editionPrints[0]), view, 'Native print receives the exact preview document');
  const filename = `book-${paper.toLowerCase()}-${width}${suffix}`, htmlPath = path.join(out, filename + '.html'), pdfPath = path.join(out, filename + '.pdf'); await fs.writeFile(htmlPath, raw.text);
  // Managed Chromium blocks file/data top-level URLs. A dedicated intercepted local
  // URL serves only these downloaded bytes, then networking is disabled before interaction/PDF.
  const standaloneContext = await context.browser().newContext({ serviceWorkers: 'block' });
  try {
    const standaloneURL = base + '/__qa_booklet__/' + filename + '.html'; await standaloneContext.route('**/*', route => { if (route.request().url() === standaloneURL) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: raw.text }); report.external.push(route.request().url()); return route.abort('blockedbyclient'); });
    const standalone = await standaloneContext.newPage(); observe(standalone, report, filename); await standalone.goto(standaloneURL); await standalone.evaluate(() => document.fonts.ready); await standaloneContext.setOffline(true);
    assert.equal(await standalone.locator('script,img,iframe,object,embed,link').count(), 0); assert.equal(await standalone.locator('.book-cover h1').textContent(), title); assert.equal(await standalone.evaluate(() => !!globalThis.HaedoLife), false); await standalone.locator('.book-toc a[href="#haedo-book-chapter-2"]').click(); await standalone.waitForURL(url => url.hash === '#haedo-book-chapter-2'); assert.equal(await standalone.locator('#haedo-book-chapter-2').evaluate(el => Math.abs(el.getBoundingClientRect().top) < 2), true);
    await standalone.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
  } finally { await standaloneContext.close(); }
  const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' }), info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  const pages = text.split('\f').filter(value => value.trim()), normalized = clean(text), size = info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/); const expectedSize = paper === 'A5' ? [419.53, 595.28] : [595.28, 841.89]; assert(size); assert(Math.abs(Number(size[1]) - expectedSize[0]) < 1); assert(Math.abs(Number(size[2]) - expectedSize[1]) < 1);
  assert.equal(clean(pages[0]), clean(title), 'Cover contains the chosen title only'); assert(pages[1].includes('목차')); assert(!pages[1].includes(expectedNotes[0].slice(0, 20))); const chapterPages = expectedNotes.map(note => pages.findIndex(value => clean(value).includes(clean(note.slice(0, 60))))); assert(chapterPages[0] >= 2); assert(chapterPages.every((at, i) => at >= 0 && (!i || at > chapterPages[i - 1]))); if (paper === 'A5') assert(chapterPages[1] - chapterPages[0] > 1, 'Real first-chapter prose spans multiple A5 pages');
  for (const note of expectedNotes) { assert(normalized.includes(clean(note)), 'PDF contains every complete authored paragraph'); for (const paragraph of note.split('\n\n')) assert(pages.some(value => clean(value).includes(clean(paragraph))), 'Each realistic short paragraph fits intact on one PDF page'); } assert(!normalized.includes(clean(bookQuestion))); assert(!normalized.includes(clean(excludedStatement))); assert(!normalized.includes(clean(latestBody))); assert.equal(normalized.includes(clean(activeStatement)), insights); assert.equal(normalized.includes(clean(uncertainty)), insights); assert.equal(normalized.includes(clean(samples[0].text)), sources); assert(normalized.includes('출처부록'));
  const sourceHeads = await frame.locator('.source-head').allTextContents();
  for (const head of sourceHeads) assert(pages.some(value => clean(value).includes(clean(head))), 'A fitting provenance block remains together on one PDF page');
  const firstSourcePage = pages.findIndex(value => clean(value).includes(clean(sourceHeads[0]))); assert(clean(pages[firstSourcePage]).includes('출처부록'), 'The source appendix heading shares its page with the first source');
  const xml = execFileSync('pdftohtml', ['-xml', '-stdout', '-i', pdfPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); const links = [...xml.matchAll(/<a href="([^"]+)"/g)].map(match => match[1]); assert(links.length >= 5, 'PDF retains at least four chapter and one appendix navigation links'); const targets = links.map(link => Number(link.match(/#(\d+)$/)?.[1])).filter(Number.isFinite); for (const at of chapterPages) assert(targets.includes(at + 1), 'PDF TOC navigates to the correct chapter page');
  let nativeBlobPDF = null;
  if (width === 820 && !suffix) {
    const blobURL = await page.evaluate(html => URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), '<!doctype html>' + view);
    const blobPage = await context.newPage(), blobPath = path.join(out, filename + '-native-blob.pdf');
    try {
      observe(blobPage, report, filename + '-native-blob'); await blobPage.goto(blobURL); await blobPage.evaluate(() => document.fonts.ready);
      assert.equal(await blobPage.evaluate(() => document.documentElement.outerHTML), view);
      await blobPage.locator('.book-toc a[href="#haedo-book-chapter-2"]').click(); assert.equal(new URL(blobPage.url()).hash, '#haedo-book-chapter-2'); assert(blobPage.url().startsWith('blob:' + new URL(base).origin));
      await blobPage.pdf({ path: blobPath, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
      const blobText = execFileSync('pdftotext', ['-layout', blobPath, '-'], { encoding: 'utf8' }), blobXML = execFileSync('pdftohtml', ['-xml', '-stdout', '-i', blobPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      assert.equal(blobText, text, 'Native-print Blob document and downloaded HTML produce the same PDF text/pages');
      const blobTargets = [...blobXML.matchAll(/<a href="[^"]+#(\d+)"/g)].map(match => Number(match[1])); for (const at of chapterPages) assert(blobTargets.includes(at + 1));
      nativeBlobPDF = { filename: path.basename(blobPath), PDFLinks: blobTargets.length, chapterDestinations: chapterPages.map(at => at + 1), samePDFTextAndPages: true, nativeSaveDialog: false };
    } finally { await blobPage.close(); await page.evaluate(url => URL.revokeObjectURL(url), blobURL); }
  }
  await fs.writeFile(path.join(out, filename + '.txt'), text); report.outputs.push({ width, paper, insights, sources, filename: filename + '.pdf', pages: pages.length, chapterPages: chapterPages.map(at => at + 1), PDFLinks: links.length, samePreviewHTMLAndPrint: true, nativeBlobPDF, offlineHTML: true, standaloneTransport: 'intercepted local HTML, offline after load; file and data navigation blocked by managed browser policy' });
  if (width === 820 && !suffix) for (const [at, scene] of [[1, 'cover'], [2, 'contents'], [chapterPages[0] + 1, 'chapter']]) execFileSync('pdftoppm', ['-f', String(at), '-singlefile', '-scale-to', '1400', '-png', pdfPath, path.join(out, `${paper.toLowerCase()}-${scene}`)], { stdio: ['ignore', 'pipe', 'pipe'] });
  return raw.text;
}
async function main() {
  await fs.mkdir(out, { recursive: true }); const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), scope: 'UI-created anonymous long Korean manuscript and exact source versions. Actual booklet preview/native-print input/offline HTML/Chromium PDF, with synthetic Auth only. No production, Apple hardware, native Save PDF confirmation or publication claims.', checks: [], visual: [], outputs: [], observations: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, operatingRemoteWrites: 0 };
  async function check(name, width, run) {
    if (process.env.BOOK_EDITION_MATCH && !new RegExp(process.env.BOOK_EDITION_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'book-edition-' + report.checks.length, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820, reducedMotion: 'reduce' });
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try { await run({ page, context }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); annotation(error); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const width of [1440, 820, 390]) await check(`reader booklet A5/A4 preview, PDF links, options and edited regeneration at ${width}`, width, async ({ page, context }) => {
      const f = await manuscript(page); if (width === 820) { await expand(page, '#wbBookEditions'); await page.locator('#wbEditionLabel').fill('독자용 책자로 다듬기 전 네 장 원고'); await page.locator('#wbEditionCapture').click(); await save(page); } await page.locator('#wbBookPreviewOpen').click(); await expand(page, '#wbBookPreviewOptions'); await page.locator('#wbBookPreviewIncludeSources').check(); await page.locator('#wbBookEditionOpen').click(); let frame = await edition(page); const before = await current(page);
      assert.equal(await page.locator('#wbEditionPaper').inputValue(), 'A5'); assert.equal(await page.locator('#wbEditionInsights').isChecked(), false); assert.equal(await page.locator('#wbEditionSources').isChecked(), false, 'Reader booklet does not inherit review source-body opt-in'); assert.equal(await frame.locator('.book-cover').textContent(), title); assert.equal(await frame.locator('.book-toc a').count(), 5); assert.equal(await frame.locator('.chapter .source,.chapter .metadata').count(), 0); assert((await frame.locator('.source-appendix').textContent()).includes(f.refs.work.versionId)); assert(!(await frame.locator('body').textContent()).includes(f.refs.latest.versionId)); for (let i = 0; i < 4; i++) assert.equal(await frame.locator(`#haedo-book-chapter-${i + 1} .manuscript`).textContent(), notes[i]);
      const appURL = page.url(); await frame.locator('.book-toc a[href="#haedo-book-chapter-2"]').click(); await page.waitForFunction(() => document.querySelector('#wbEditionPreview').contentWindow.location.hash === '#haedo-book-chapter-2'); assert.equal(page.url(), appURL); assert.equal(await page.locator('#wbBookEdition').isVisible(), true);
      await frame.evaluate(() => scrollTo(0, 0)); await capture(page, report, 'booklet-default', width); await output(page, context, report, width, 'A5', notes);
      await page.locator('#wbEditionBack').click(); await page.locator('#wbBookPreview').waitFor(); assert.equal(await page.locator('#wbBookPreviewIncludeSources').isChecked(), true); await page.locator('#wbBookEditionOpen').click(); await edition(page); await expand(page, '#wbEditionSettings'); await page.locator('#wbEditionPaper').selectOption('A4'); await edition(page, 'A4'); await page.locator('#wbEditionInsights').check(); await edition(page, 'A4', true); await page.locator('#wbEditionSources').check(); frame = await edition(page, 'A4', true, true); assert((await frame.locator('.source-appendix').textContent()).includes('본문 미확보')); assert((await frame.locator('.source-appendix').textContent()).includes('사진과 댓글 미보관')); assert(!(await frame.locator('body').textContent()).includes(excludedStatement)); await capture(page, report, 'booklet-options', width); const initialHTML = await output(page, context, report, width, 'A4', notes, { insights: true, sources: true }); assert.deepEqual(await current(page), before, 'Only booklet settings and reading positions changed');
      await page.locator('#wbEditionSources').uncheck(); frame = await edition(page, 'A4', true); await frame.locator('.book-toc a[href="#haedo-book-chapter-2"]').click(); await frame.locator('#haedo-book-chapter-2').evaluate(el => scrollTo(0, el.offsetTop + 80)); const anchorBefore = await frame.locator('#haedo-book-chapter-2').evaluate(el => el.getBoundingClientRect().top); await expand(page, '#wbEditionEditing'); await page.locator('#wbEditionEditChapter').selectOption(f.book.chapters[1].id); await page.locator('#wbEditionEdit').click(); await page.waitForFunction(title => document.querySelector('#wbChapterTitle')?.value === title, chapters[1][0]); const revised = notes[1] + '\n\n나중에 다시 읽고 고친 문장: 쉬는 시간을 설명할 말이 없던 날도 그 시기의 일부로 남긴다.'; await page.locator('#wbChapterNote').fill(revised); await page.locator('#wbChapterNote').evaluate(el => { el.focus(); el.setSelectionRange(45, 68); el.scrollTop = 80; }); const editorPosition = await page.locator('#wbChapterNote').evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, top: el.scrollTop })); await page.locator('#wbBookEditionOpen').click(); frame = await edition(page, 'A4', true); assert.equal(await frame.locator('#haedo-book-chapter-2 .manuscript').textContent(), revised); const anchorAfter = await frame.locator('#haedo-book-chapter-2').evaluate(el => el.getBoundingClientRect().top); assert(Math.abs(anchorAfter - anchorBefore) < 3, 'Booklet returns to its chapter offset after editing'); assert(!initialHTML.includes('나중에 다시 읽고 고친 문장')); const changedHTML = await download(page, '#wbEditionHTML'); assert(changedHTML.text.includes('나중에 다시 읽고 고친 문장')); assert(!changedHTML.text.includes(samples[0].text)); if (width === 820) { const revisedNotes = notes.slice(); revisedNotes[1] = revised; await output(page, context, report, width, 'A4', revisedNotes, { insights: true, suffix: '-revised' }); }
      await page.locator('#wbEditionBack').click(); await page.locator('#wbChapterNote').waitFor(); const restoredPosition = await page.locator('#wbChapterNote').evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, top: el.scrollTop })); assert.deepEqual(restoredPosition, editorPosition); assert.equal(await page.locator('#wbChapterNote').inputValue(), revised); assert.deepEqual((await current(page)).bundle, f.bundle); assert.equal((await current(page)).workbench.books[0].chapters[1].note, revised);
      await page.reload(); await ready(page); await openBook(page, f.book.id); await page.locator('#wbBookEditionOpen').click(); await edition(page); assert.equal(await page.locator('#wbEditionPaper').inputValue(), 'A5'); assert.equal(await page.locator('#wbEditionInsights').isChecked(), false); assert.equal(await page.locator('#wbEditionSources').isChecked(), false); if (width === 820) {
        await page.locator('#wbEditionBack').click(); await go(page, 'workbench-backup'); const original = await current(page), backup = await download(page, '#wbBackupDownload'); await fs.writeFile(path.join(out, 'reader-book-backup.json'), backup.text); assert.deepEqual(JSON.parse(backup.text).workbench.books, original.workbench.books);
        await page.locator('#wbRestoreFile').setInputFiles({ name: 'reader-book-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup.text) }); await page.locator('#wbRestoreInstall').click(); await page.waitForFunction(id => HaedoLife.Shell.storage.getActive().then(active => active !== id), original.bundle.workspaceId); await page.locator('.life-workbench[data-mode="page"]').waitFor();
        const copied = await current(page), book = copied.workbench.books[0], oldBook = original.workbench.books[0]; assert.notEqual(book.id, oldBook.id); assert.equal(book.chapters.length, 4); assert.deepEqual(book.chapters.map(ch => ch.note), oldBook.chapters.map(ch => ch.note)); assert.equal(book.editions.length, 1); assert.notEqual(book.editions[0].id, oldBook.editions[0].id); assert.deepEqual(book.editions[0].chapters.map(ch => ch.note), notes); assert.notEqual(book.chapters[0].insights[0].id, oldBook.chapters[0].insights[0].id); assert.equal(book.chapters[0].insights[1].excluded, true);
        const old = copied.bundle.sourceVersions.find(v => v.id === book.chapters[0].versionIds[0]), record = copied.bundle.records[0], ref = record.sourceRefs[0]; assert.equal(old.contentText, samples[0].text); assert.equal(ref.sourceVersionId, old.id); assert.equal(old.contentText.slice(ref.locator.start, ref.locator.end), record.text); assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.readWorkbench(id), original.bundle.workspaceId), original.workbench);
        report.observations.push({ backup: 'reader-book-backup.json', restoredInNewWorkspace: true, chapters: 4, editions: 1, exactVersionAndExcerptPreserved: true, originalsUnchanged: true });
      }
      report.observations.push({ width, realParagraphs: notes.map(note => note.split('\n\n').length), manuscriptLengths: notes.map(note => note.length), samePreviewHTMLPrint: true, reviewOptionsIndependent: true, editedChapterAndTextareaPositionPreserved: true, exactPriorSourceVersion: true, persistentOutputSettings: false });
    });
    await check('failed save and renderer recovery preserve manuscript; late print cannot escape account switch', 390, async ({ page }) => {
      const f = await manuscript(page); const revised = notes[3] + '\n\n저장 오류가 나도 남아야 할 책자 수정 문장.'; await abortWorkbenchWrites(page, true); await page.locator('#wbChapterNote').fill(revised); await page.locator('#wbBookEditionOpen').click(); await page.locator('#wbError').waitFor({ state: 'visible' }); assert.equal(await page.locator('#wbBookEdition').count(), 0); assert.equal(await page.locator('#wbChapterNote').inputValue(), revised); assert.deepEqual(await current(page), f.state); await capture(page, report, 'save-error', 390);
      await abortWorkbenchWrites(page, false); await page.locator('#wbError').getByRole('button', { name: '다시 저장', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#wbStatus')?.dataset.state === 'saved'); await page.locator('#wbBookEditionOpen').click(); await edition(page); const saved = await current(page);
      await page.evaluate(() => { window.__editionOriginalPrint = HaedoLife.BookPrint; HaedoLife.BookPrint = { ...HaedoLife.BookPrint, document() { throw Error('합성 출력 오류 · 원고를 다시 확인할 수 있습니다.'); } }; }); await expand(page, '#wbEditionSettings'); await page.locator('#wbEditionPaper').selectOption('A4'); await page.locator('#wbEditionRetry').waitFor(); assert.equal(await page.locator('#wbEditionPreview').count(), 0); assert.equal(await page.locator('#wbEditionHTML').isDisabled(), true); assert.equal(await page.locator('#wbEditionPrint').isDisabled(), true); assert.deepEqual(await current(page), saved); await capture(page, report, 'render-error', 390); await page.evaluate(() => { HaedoLife.BookPrint = __editionOriginalPrint; }); await page.locator('#wbEditionRetry').click(); await edition(page, 'A4');
      await capturePrint(page, { hold: true }); await page.locator('#wbEditionPrint').click(); await page.waitForFunction(() => __editionPrintHeld); try { await page.locator('#wbEditionPaper').selectOption('A5'); await edition(page); await page.locator('#wbEditionSources').check(); await edition(page, 'A5', false, true); await page.evaluate(() => __editionRelease()); await page.waitForFunction(() => __editionPrintFinished); assert.equal(await page.evaluate(() => __editionPrints.length), 0, 'Changing output settings cancels a pending older print'); } finally { await page.evaluate(() => __editionRelease?.()).catch(() => {}); }
      await capturePrint(page, { hold: true }); await page.locator('#wbEditionPrint').click(); await page.waitForFunction(() => __editionPrintHeld); try { await authenticate(page, accounts.b); assert.equal(await page.locator('#wbBookEdition').count(), 0); assert.equal(await page.locator('iframe[data-book-print]').count(), 0); await page.evaluate(() => __editionRelease()); await page.waitForFunction(() => __editionPrintFinished); assert.equal(await page.evaluate(() => __editionPrints.length), 0); assert.equal(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.read(id); return false; } catch (_) { return true; } }, f.bundle.workspaceId), true); } finally { await page.evaluate(() => __editionRelease?.()).catch(() => {}); }
      await authenticate(page, accounts.a); await go(page); await openBook(page, f.book.id); await page.locator('#wbBookEditionOpen').click(); await edition(page); assert.equal((await current(page)).workbench.books[0].chapters[3].note, revised); assert.deepEqual((await current(page)).bundle, f.bundle);
    });
    await check('empty book and empty chapter remain readable and editable without implied content', 390, async ({ page }) => {
      await go(page); await createBook(page, '아직 제목과 목차를 다듬는 책'); const before = await current(page); await page.locator('#wbBookEditionOpen').click(); let frame = await edition(page); assert.equal(await frame.locator('.chapter').count(), 0); assert.equal(await frame.locator('.source-appendix').count(), 1); assert.equal(await page.locator('#wbEditionHTML').isEnabled(), true); assert.equal(await page.locator('#wbEditionPrint').isEnabled(), true); await capture(page, report, 'empty-book', 390); assert.deepEqual(await current(page), before);
      await page.locator('#wbEditionBack').click(); await createChapter(page, '첫 장에 남길 이야기'); await page.locator('#wbBookEditionOpen').click(); frame = await edition(page); assert.equal(await frame.locator('.chapter').count(), 1); assert.equal(await frame.locator('.manuscript').count(), 0); assert((await frame.locator('.chapter').textContent()).includes('아직')); await expand(page, '#wbEditionEditing'); await page.locator('#wbEditionEdit').click(); await page.locator('#wbChapterNote').waitFor(); assert.equal(await page.locator('#wbChapterNote').inputValue(), '');
    });
    assert(report.checks.length > 0); report.pass = report.checks.every(check => check.pass) && !report.consoleErrors.length && !report.pageErrors.length && !report.external.length;
  } finally { await browser.close(); report.finishedAt = new Date().toISOString(); const json = JSON.stringify(report, null, 2); await fs.writeFile(path.join(out, 'run-' + report.createdAt.replace(/[:.]/g, '-') + '.json'), json); await fs.writeFile(path.join(out, 'browser-report.json'), json); }
  console.log(JSON.stringify({ checks: report.checks.length, passed: report.checks.filter(check => check.pass).length, outputs: report.outputs.length, visual: report.visual.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length, report: path.join(out, 'browser-report.json') })); if (!report.pass) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); annotation(error); process.exitCode = 1; });
