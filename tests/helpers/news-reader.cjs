/* 2026-11-03 부드러운 판 묶음 C: 뉴스 목록 행에는 담기만 있고, 좋아요·번역·더보기(읽음·관련 없음·자료에 보관·
 * 기사 정보)·새 탭은 그 글의 읽기 칸(#discoveryReader)에 있다. Tests reach them the way a person does:
 * press the row to open its reader, and use ‹ 뉴스 (narrow screens) to return to the list. */
'use strict';
const idle = page => page.waitForFunction(() => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') === 'false');
async function leaveSettings(page) {
  const panel = page.locator('#discoveryNewsSettingsPanel');
  if (await panel.count() && await panel.isVisible()) { await page.locator('#discoveryNewsSettingsBack').click(); await idle(page); }
}
async function showList(page) {
  await leaveSettings(page);
  const back = page.locator('#discoveryReaderBack');
  if (await back.count() && await back.isVisible()) { await back.click(); await idle(page); }
}
async function openReader(page, row) {
  const url = await row.getAttribute('data-discovery-url'), reader = page.locator('#discoveryReader');
  await leaveSettings(page);
  if (await reader.count() && await reader.getAttribute('data-reader-url') === url && await reader.isVisible()) return reader;
  await showList(page); await row.locator('[data-discovery-select]').click(); await idle(page);
  await page.locator('#discoveryReader[data-reader-url="' + url.replace(/"/g, '\\"') + '"]').waitFor();
  return reader;
}
// A control for one article: the row's own 담기, otherwise the same control in that article's reader.
async function articleControl(page, row, selector) {
  if (await row.locator(selector).count()) { await showList(page); return row.locator(selector); }
  return (await openReader(page, row)).locator(selector);
}
// The reader of the first listed article: where 왜 이 글인가 and translation now appear.
async function readerFirst(page) {
  await leaveSettings(page);
  const reader = page.locator('#discoveryReader');
  if (await reader.count() && await reader.isVisible()) return reader;
  return openReader(page, page.locator('#discoveryList [data-discovery-select]').first().locator('xpath=ancestor::*[@data-discovery-url][1]'));
}
// Playwright's serviceWorkers:'block' patches navigator.serviceWorker in every frame; inside the reader's
// opaque-origin publisher frame (sandbox without allow-same-origin) that patch itself throws. The app never
// reads it there; a context with service workers allowed shows no such error (bundle C probe, 2026-11-03).
const harnessFrameError = message => /^Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag\.$/.test(message);
module.exports = { idle, showList, openReader, articleControl, readerFirst, harnessFrameError };
