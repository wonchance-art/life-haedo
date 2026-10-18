/* Open the visible global search affordance on either the hub or another view. */
'use strict';
async function openSearch(page) {
  if (await page.locator('#homeGlobalSearch').isVisible()) await page.locator('.home-hub-search-submit').click();
  else await page.locator('#lifeFindOpen').click();
}
async function settleVisual(page) {
  await page.waitForFunction(() => document.getAnimations().every(animation =>
    animation.playState !== 'running' || !Number.isFinite(animation.effect?.getComputedTiming().endTime)));
}
module.exports = { openSearch, settleVisual };
