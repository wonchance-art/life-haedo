'use strict';
// Exercise the real in-app reader; source navigation is a separate explicit action.
async function openReader(page, row) {
  await row.locator('[data-discovery-read]').click();
  await page.locator('#discoveryReader').waitFor({ state: 'visible' });
  return page.locator('#discoveryReader');
}
async function closeReader(page) {
  await page.locator('#discoveryReaderBack').click();
  await page.locator('#discoveryReader').waitFor({ state: 'detached' });
  await page.waitForFunction(() => !document.querySelector('#discoveryReview[aria-busy="true"]'));
}
async function originalUrl(page, row) {
  await openReader(page, row);
  const url = await page.locator('[data-discovery-original]').getAttribute('href');
  await closeReader(page);
  return url;
}
function assertImportedText(actual, article, { textarea = false } = {}) {
  const assert = require('node:assert/strict');
  if (article.coverage === 'link_only') { assert.equal(actual, textarea ? '' : null); return; }
  const original = article.coverage === 'full_text' ? article.bodyText : article.summary;
  const prefix = textarea ? original.replace(/\r\n/g, '\n') : original;
  assert.equal(actual.slice(0, prefix.length), prefix, 'Exact source text remains the prefix, including original UTF-16 and line endings');
  const footer = actual.slice(prefix.length);
  assert(footer.startsWith('\n\n[해도 출처 정보]\n'), 'Added provenance is explicitly outside the original text');
  assert(footer.includes('원문 본문에 포함되지 않습니다.'));
  assert(footer.includes('제목: ' + article.title));
  assert(footer.includes('원저자: ' + (article.author || '미확인')));
  assert(footer.includes('원문 URL: ' + article.url));
  assert(footer.includes('권리: ' + article.rights.label));
  assert(footer.includes('권리 URL: ' + (article.rights.url || '미제공')));
  assert(footer.includes('사진·영상은 보관하지 않았습니다.'));
}
module.exports = { openReader, closeReader, originalUrl, assertImportedText };
