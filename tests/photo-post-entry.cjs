'use strict';
async function openPost(page, id) {
  const row = page.locator('[data-photo-post-id="' + id + '"]');
  await row.waitFor({ state: 'attached' });
  const folded = await row.evaluate(node => !!node.closest('details:not([open])'));
  if (folded) await page.locator('.photo-retained > summary').click();
  await row.click();
}
module.exports = { openPost };
