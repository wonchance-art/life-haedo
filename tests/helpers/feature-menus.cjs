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
// 2026-11-16 (notes-menu): the 글 메뉴 belongs to 노트, the former 일정 list.
const openBlogMenu = page => openMenu(page, 'notes', 'home', 'lifeBlogMenu');

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

// 2026-11-02: 공개 표지 and 공개한 페이지 are rows of 설정 (no longer in the blog menu).
const openSettings = page => sectionRoot(page, 'manage', 'manage');

// 2026-11-18 (노션 방향 W4): on the 자료 list, 기록 선택 and 폴더 관리 are items of the 자료 메뉴 (⋯), and a row's
// 자료 출처 정보 · 폴더로 이동 are items of that row's ⋯. These open the menu the way a person does, on the screen as it is.
async function recordsListMenuItem(page, selector) {
  const menu = page.locator('#lifeRecordsMenu');
  if (!await menu.evaluate(node => node.open)) await menu.locator(':scope > summary').click();
  const item = menu.locator(selector); await item.waitFor(); return item;
}
async function toggleRecordSelection(page) { await (await recordsListMenuItem(page, '#lifeSelectionToggle')).click(); }
async function openFolderManage(page) {
  if (await page.locator('#lifeFolderManage').isHidden()) {
    await (await recordsListMenuItem(page, '#lifeFolderManageOpen')).click();
    // The panel takes focus in the frame after it opens; wait for that, so a field used next keeps its focus.
    await page.waitForFunction(() => document.querySelector('#lifeFolderManage')?.contains(document.activeElement));
  }
  await page.locator('#lifeFolderManage').waitFor({ state: 'visible' });
}
async function recordRowMenuItem(row, selector) {
  const menu = row.locator('.records-row-more');
  if (!await menu.evaluate(node => node.open)) await menu.locator(':scope > summary').click();
  const item = menu.locator(selector); await item.waitFor(); return item;
}
// Opens a row's 폴더로 이동 form (under the row) and returns it.
async function openRowFolderMove(row) {
  const form = row.locator('[data-source-folder-assignment]').first();
  if (!await form.evaluate(node => node.open)) await (await recordRowMenuItem(row, '.records-row-folder')).click();
  return form;
}

module.exports = { openRecordsMenu, openBlogMenu, openNewsSettings, openSettings, recordsListMenuItem, toggleRecordSelection, openFolderManage, recordRowMenuItem, openRowFolderMove };
