'use strict';
// 2026-11-03 first-screen delay: a CSP <meta http-equiv> in the HTML stops Chromium's preload
// scanner, so the ~180 scripts of index.html/life.html were fetched one after another
// (DOMContentLoaded 0.5 s -> 1.1 s locally, 0.6 s -> 7.6 s at 40 ms per request).
// The same frame-src policy is inserted by assets/life/shell.js before any view can make a frame.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const read = file => readFileSync(path.join(__dirname, '..', file), 'utf8');
const POLICY = "frame-src 'self' blob: https://www.youtube-nocookie.com https://www.readersnews.com https://www.frontiersin.org";

test('app pages leave the preload scanner on: no CSP meta in their HTML', () => {
  for (const page of ['index.html', 'life.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /<meta[^>]+http-equiv\s*=\s*["']?content-security-policy/i, page);
    assert.ok(html.split('<script src=').length - 1 > 100, page + ' still loads its scripts directly');
    assert.match(html, /<script src="assets\/life\/shell\.js"><\/script>\s*<\/body>/, page + ' ends with the shell that adds the policy');
  }
});

test('shell.js adds the same frame-src policy to head', () => {
  const shell = read('assets/life/shell.js');
  assert.ok(shell.includes('const FRAME_POLICY = "' + POLICY + '";'));
  assert.match(shell, /policy\.httpEquiv = 'Content-Security-Policy'; policy\.content = FRAME_POLICY;\s*root\.document\.head\.append\(policy\);/);
  // Before the shell reads auth or mounts any view.
  assert.ok(shell.indexOf('root.document.head.append(policy)') < shell.indexOf('const auth = root.HaedoAuth'));
});
