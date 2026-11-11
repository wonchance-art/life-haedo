/* 2026-11-11 자료 읽기의 작은 결함들(m1~m6). 항목마다 한 묶음의 확인이다.
 * npm run dev; node tests/records-reader-small-browser.cjs [m1 m2 …]
 * Actual application bytes, synthetic Auth and anonymous fixtures; Chromium only. "Another device" is a second write
 * through the same storage API. The Korean IME is driven with CDP Input.imeSetComposition, not a real keyboard. */
'use strict';
const R = require('./helpers/records-reader.cjs');
const { assert, frames, settle } = R;
const S = R.suite('records-reader-small', 'Local Chromium, synthetic Auth, anonymous records. Small reader defects m1–m6.');
const only = process.argv.slice(2);
const group = (name, run) => only.length && !only.includes(name) ? Promise.resolve() : run();
const original = '첫 문단입니다.\n\n둘째 문단입니다.';

// Everything the status line said from now on (the reader hides the line itself, a screen reader still hears it).
const listen = page => page.evaluate(() => {
  window.__said = []; const status = document.querySelector('#lifeSaveStatus');
  new MutationObserver(() => { if (status.textContent) window.__said.push(status.textContent); }).observe(status, { childList: true, characterData: true, subtree: true });
});
const said = page => page.evaluate(() => window.__said);
const refreshVisible = page => page.getByRole('button', { name: '최신 내용 확인', exact: true }).isVisible();
async function openEditor(page) {
  await frames(page);
  if (await page.locator('#lifeSourceDetails').isHidden()) await page.locator('#lifeSourceInfoToggle').click();
  await page.locator('#lifeSourceEdit').click(); await settle(page); await page.locator('#lifeSourceEdit[aria-busy="false"]').waitFor();
}

async function m1() {
  for (const [width, height] of [[1440, 900], [390, 844]]) await S.check('m1 saving my own edit does not ask to review the latest content at ' + width, async () => {
    const { page, context } = await S.open({ width, height, touch: width < 1000 });
    const ids = await R.seed(page, [{ title: '수정할 메모', text: original }]);
    await R.openSource(page, ids[0].versionId); await openEditor(page);
    await page.locator('#lifeSourceEditText').fill(original + ' 고친 문장.');
    await listen(page);
    await page.locator('#lifeSourceEditSave').click(); await settle(page); await page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor(); await page.waitForTimeout(400);
    assert.match(await page.locator('.life-reader-meta').nth(1).textContent(), /버전 2\/2/);
    assert.equal(await refreshVisible(page), false, 'no 최신 내용 확인 after my own save');
    assert.equal(await page.locator('.life-toolbar').isHidden(), true, 'the reader keeps its page toolbar hidden');
    const heard = await said(page);
    assert(heard.includes('자료를 저장했습니다.'), 'the save is announced: ' + JSON.stringify(heard));
    assert(!heard.some(text => text.includes('보관한 자료가 변경되었습니다')), 'my own save is not announced as a change from elsewhere: ' + JSON.stringify(heard));
    // A change that really comes from elsewhere while reading is still offered for review.
    await R.addVersion(page, ids[0].sourceId, '다른 기기에서 고친 본문.');
    await page.getByRole('button', { name: '최신 내용 확인', exact: true }).waitFor();
    assert((await said(page)).some(text => text.includes('보관한 자료가 변경되었습니다')));
    await context.close();
  });
  await S.check('m1 saving my input on top of a newer version is my own save too', async () => {
    const { page, context } = await S.open();
    const ids = await R.seed(page, [{ title: '수정할 메모', text: original }]);
    await R.openSource(page, ids[0].versionId); await openEditor(page);
    await page.locator('#lifeSourceEditText').fill(original + ' 내 입력.');
    await page.waitForFunction(() => document.querySelector('#lifeSourceEditStatus')?.dataset.state === 'draft');
    await R.addVersion(page, ids[0].sourceId, '다른 기기에서 고친 본문.');
    await page.locator('#lifeSourceEditSave').click(); await page.locator('#lifeSourceEditBase').waitFor();
    await page.getByRole('button', { name: '최신 내용 확인', exact: true }).waitFor(); // the other device's version, announced before my choice
    await listen(page);
    await page.locator('#lifeSourceEditRebase').click(); await settle(page); await page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor(); await page.waitForTimeout(400);
    assert.match(await page.locator('.life-reader-meta').nth(1).textContent(), /버전 3\/3/);
    assert.equal(await refreshVisible(page), false, 'the reader now shows the latest; nothing is left to review');
    assert(!(await said(page)).some(text => text.includes('보관한 자료가 변경되었습니다')));
    await context.close();
  });
}

async function main() {
  await S.start();
  try {
    await group('m1', m1);
  } finally { await S.finish(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
