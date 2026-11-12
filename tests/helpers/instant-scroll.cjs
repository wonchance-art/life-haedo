'use strict';
// Instant scrolling only, for a browser context a suite drives with Playwright.
// assets/life/ui.css sets html{scroll-behavior:smooth}, which turns Playwright's own
// scroll-into-view (DOM.scrollIntoViewIfNeeded, before every click) into an animation.
// Playwright checks the hit target once, on the press; under load the press lands on the
// target and the release after the page moved on, so the click goes to a common ancestor and
// does nothing (a checkbox: "Clicking the checkbox did not change its state"). Same cause as
// tests/integrated-release-browser.cjs step 1 (d3279bd). Transitions, animations and
// HaedoMotion stay on; the app's own scroll calls already pass behavior: 'instant'.
// CSSOM, not a <style> element: public pages' CSP (style-src 'self') blocks inline styles.
async function instantScroll(context) {
  await context.addInitScript(() => {
    const set = () => document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
    if (document.documentElement) set(); else document.addEventListener('DOMContentLoaded', set, { once: true });
  });
}

module.exports = { instantScroll };
