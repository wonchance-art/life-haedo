'use strict';

// Explicit user-facing entry helpers. The shared top-level nav helper keeps its
// original meaning; these helpers click the actual section and disclosure.
async function sectionRoot(page, section, mode) {
  const link = page.locator('[data-haedo-navigation] [data-haedo-section="' + section + '"]');
  await link.click();
  await page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]'));
  // Returning to records may resume its last subview. Selecting the active tab
  // opens the list, just as a person does before opening the list's menu.
  if (await page.locator('#lifeMain').getAttribute('data-mode') !== mode) {
    await link.click();
    await page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]'));
  }
  await page.locator('#lifeMain[data-mode="' + mode + '"]').waitFor();
}

async function openMenu(page, section, mode, id) {
  await sectionRoot(page, section, mode);
  const menu = page.locator('#' + id);
  await menu.waitFor();
  if (!await menu.evaluate(node => node.open)) await menu.locator(':scope > summary').click();
  return menu;
}

const openRecordsMenu = page => openMenu(page, 'records', 'sources', 'lifeRecordsMenu');
const openBlogMenu = page => openMenu(page, 'home', 'home', 'lifeBlogMenu');

async function openNewsSettings(page) {
  await sectionRoot(page, 'news', 'external-discovery');
  await page.locator('#discoveryReview').waitFor();
  const panel = page.locator('#discoveryNewsSettingsPanel');
  if (!await panel.isVisible()) await page.locator('#discoveryNewsSettings').click();
  await panel.waitFor({ state: 'visible' });
  const topics = page.locator('#discoveryTopics');
  if (!await topics.evaluate(node => node.open)) await topics.locator(':scope > summary').click();
  await page.locator('#discoveryOpenInterests').waitFor({ state: 'visible' });
}

module.exports = { openRecordsMenu, openBlogMenu, openNewsSettings };
