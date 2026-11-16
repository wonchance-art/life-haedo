'use strict';
// 2026-11-16 owner: a save that went well or is still running is not shown on screen; it stays in the
// live region for screen readers. A failure is shown. said = what a screen reader gets (textContent),
// shown = what a sighted reader sees: '' when the line or an ancestor is clipped away (.life-sr-only,
// .life-save-quiet, .sr-only), hidden or not rendered.
function inPage(element) {
  const said = element.textContent;
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || style.display === 'none' || style.visibility === 'hidden' || /inset\(50%\)/.test(style.clipPath)) return { said, shown: '' };
  }
  // Not Playwright's "visible" (a clipped 1px box counts as visible there): the computed clip-path above,
  // and a real size here.
  const box = element.getBoundingClientRect();
  return { said, shown: element.getClientRects().length && box.width > 1 && box.height > 1 ? said : '' };
}
// locator: a Playwright locator of one status line.
const saveStatus = locator => locator.evaluate(inPage);
// The same as a function source, for page.waitForFunction / page.evaluate.
const inPageSource = inPage.toString();
module.exports = { saveStatus, inPageSource };
