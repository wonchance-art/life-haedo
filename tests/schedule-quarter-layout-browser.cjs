/* E4: the quarter count belongs below its title, with mobile navigation preserved.
 * Run npm run dev, then node tests/schedule-quarter-layout-browser.cjs.
 * Uses anonymous FakeCloud and real app storage. SCHEDULE_QUARTER_CSS optionally serves
 * a saved CSS revision to run the same assertions against a reverted implementation. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');

const output = path.resolve(process.env.SCHEDULE_QUARTER_OUTPUT || '.local/schedule-quarter-layout');
const title = '긴 제목도 날짜와 겹치지 않는 가을 산책 기록';
const report = { checks: [], errors: [], geometry: [] };

async function shown(page, mode) {
  await page.waitForFunction(value => document.querySelector('#lifeMain')?.dataset.mode === value &&
    !document.querySelector('.life-app[aria-busy="true"]') &&
    document.querySelector('#lifeSchedule')?.getAttribute('aria-busy') === 'false', mode);
}

async function seed(page) {
  await page.evaluate(async title => {
    const storage = HaedoLife.Shell.storage, ws = await storage.getActive();
    for (let i = 0; i < 2; i++) {
      const post = HaedoLife.PhotoPost.create(HaedoLife.Core.id, `2026-11-0${2 + i}T03:00:00.000Z`);
      post.title = i ? title : '첫 번째 산책'; post.status = 'saved';
      post.ops = [{ insert: '익명 일정 정렬 검사용 글입니다.\n' }];
      const result = await storage.savePhotoPost(ws, post, 0);
      if (result.id !== post.id || result.status !== 'saved') throw new Error('fixture post was not stored');
    }
  }, title);
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [1440, 390]) {
      const context = await makeContext(browser, new FakeCloud(), 'quarter-layout-' + width, accounts.a,
        { viewport: { width, height: 960 }, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
      if (process.env.SCHEDULE_QUARTER_CSS) {
        const css = await fs.readFile(process.env.SCHEDULE_QUARTER_CSS, 'utf8');
        await context.route(`${base}/assets/life/schedule.css`, route => route.fulfill({ contentType: 'text/css', body: css }));
      }
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => report.errors.push({ width, type: 'page', message: error.message }));
      page.on('console', event => { if (event.type() === 'error') report.errors.push({ width, type: 'console', message: event.text() }); });
      await page.clock.setFixedTime(new Date('2026-11-05T03:00:00.000Z'));
      try {
        await page.goto(base + '/index.html'); await ready(page); await seed(page);
        await page.goto(base + '/index.html?section=schedule&view=quarter&date=2026-11-03'); await ready(page); await shown(page, 'quarter');
        await page.evaluate(() => document.fonts.ready);
        const row = page.locator('.schedule-quarter-row').filter({ has: page.locator('.schedule-lead', { hasText: title }) });
        assert.equal(await row.count(), 1, 'the week containing both fixture posts is visible');
        const geometry = await row.evaluate(node => {
          const box = selector => {
            const element = node.querySelector(selector), rect = element.getBoundingClientRect();
            return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height,
              display: getComputedStyle(element).display, text: element.textContent };
          };
          return { title: box('.schedule-lead'), count: box('.schedule-count'), week: box('.schedule-week-label'),
            photo: box('.schedule-quarter-photo'), dots: box('.schedule-dots'), overflow: document.documentElement.scrollWidth - innerWidth };
        });
        report.geometry.push({ width, ...geometry });
        await page.screenshot({ path: path.join(output, 'quarter-' + width + '.png'), fullPage: true });
        assert.equal(geometry.count.text, '글 2편', 'both posts are counted');
        assert.equal(geometry.overflow, 0, 'quarter has no horizontal overflow');
        assert(geometry.week.height >= 44, 'week remains a touch target');
        if (width === 1440) {
          assert(geometry.count.y >= geometry.title.bottom, 'count appears below the title');
          assert(Math.abs(geometry.count.x - geometry.title.x) <= 1, 'count and title share the left edge');
          assert(geometry.title.width >= 120, 'the title keeps readable space');
          assert(geometry.photo.x >= geometry.title.right, 'photo stays beside the title/count column');
        } else {
          assert.equal(geometry.count.display, 'none', 'mobile keeps its compact count treatment');
          assert.equal(geometry.dots.display, 'none', 'mobile hides the desktop dot column');
          assert(geometry.title.x >= geometry.week.right, 'mobile title remains beside its week');
        }
        const week = row.locator('.schedule-week-label');
        await week.focus(); await page.keyboard.press('Enter'); await shown(page, 'week');
        assert.match(await page.locator('#lifeSchedule').innerText(), /가을 산책 기록/, 'week navigation opens the same posts');
        report.checks.push({ width, pass: true });
      } catch (error) {
        report.checks.push({ width, pass: false, error: error.stack });
      } finally { await context.close(); }
    }
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length || report.checks.some(check => !check.pass)) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
