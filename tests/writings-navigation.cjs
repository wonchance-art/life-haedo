/* Retained writing journeys now start in the visible library entry.
 * This helper uses actual navigation; it does not call private app methods. */
'use strict';
const { nav: sectionNav, settle, ready: accountReady } = require('./unified-home-browser.cjs');
const originalSurface = () => ['SNS_PHASE', 'JOURNEY_PHASE'].some(key => process.env[key] === 'before');
async function openWritings(page) {
  if (originalSurface()) return;
  if (await page.locator('#lifeMain').getAttribute('data-mode') !== 'writings') {
    await sectionNav(page, 'records');
    if (await page.locator('#lifeMain').getAttribute('data-mode') !== 'writings') {
      if (!await page.locator('#lifeWritingsOpen').isVisible()) await sectionNav(page, 'records');
      await page.locator('#lifeWritingsOpen').click();
    }
  }
  await settle(page);
  await page.locator('#lifeMain[data-mode="writings"] #homePosts').waitFor();
}
async function nav(page, section) {
  if (section === 'home' && !originalSurface()) return openWritings(page);
  return sectionNav(page, section);
}
async function ready(page) {
  await accountReady(page);
  if (!originalSurface() && await page.locator('#lifeMain').getAttribute('data-mode') === 'home') await openWritings(page);
}
module.exports = { openWritings, nav, ready };
