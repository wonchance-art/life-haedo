'use strict';
// Compatibility regressions exercise existing attachment posts independently of
// the default rich-text entry, which is covered by photo-post-browser.cjs.
async function openLegacy(page) {
  const compatibility = page.locator('.wb-page-compatibility');
  if (await compatibility.count() && !await compatibility.evaluate(node => node.open)) await compatibility.locator(':scope > summary').click();
  const details = page.locator('.pp-legacy-writing');
  if (!await details.evaluate(node => node.open)) await details.locator('summary').click();
  await details.getByRole('button', { name: '대상 첨부 글쓰기', exact: true }).click();
}
module.exports = { openLegacy };
