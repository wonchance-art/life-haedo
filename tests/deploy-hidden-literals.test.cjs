/* 배포하는 화면 파일에 보이지 않는 문자가 글자 그대로 들어 있지 않은지(2026-11-11 재검수 MINOR-2).
 * 서버 쪽 같은 검사(tests/news-wide-edge.test.cjs "deploy targets hold no literal invisible character")의 규칙에,
 * 넓게 찾기 주제 규칙이 따로 거절하는 보이지 않는 글자(한글 채움 문자, 변형 선택자 등)를 더했다. 편집기나 복사
 * 과정이 그런 문자를 조용히 바꾸거나 지우면 정규식의 뜻이 달라지므로 언제나 \uXXXX로 적는다.
 * 대상은 scripts/prepare-site.mjs가 공개하는 파일 가운데 이 저장소가 쓴 글 파일이다(vendor의 제3자 파일 제외). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
// Format, line/paragraph separator, private-use, unassigned, controls other than tab/newline/CR, spaces other than
// U+0020 (the server test's rule), and the invisible letters and selectors of the topic rule's INVISIBLE class.
const hiddenLiteral = /[\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}͏ᅟᅠ឴឵᠋-᠏ㅤ︀-️ﾠ\u{e0100}-\u{e01ef}]|(?![\t\n\r])\p{Cc}|(?! )\p{Zs}/u;
function published() {
  const source = fs.readFileSync(path.join(root, 'scripts/prepare-site.mjs'), 'utf8');
  const list = source.slice(source.indexOf("for (const path of ['"), source.indexOf(']) {', source.indexOf("for (const path of ['")));
  return [...list.matchAll(/'([^']+)'/g)].map(match => match[1]).filter(file => !file.startsWith('vendor/') && /\.(js|mjs|css|html|json|webmanifest|svg)$/.test(file));
}

test('published screen files hold no literal invisible character', () => {
  const files = published();
  assert.ok(files.length > 200 && files.includes('assets/life/discovery-wide-remote.js') && files.includes('assets/life/storage.js') && files.includes('sw.js'), 'the list is read: ' + files.length);
  const found = [];
  for (const file of files) fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, at) => {
    for (const char of line) if (hiddenLiteral.test(char)) found.push(file + ':' + (at + 1) + ' U+' + char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
  });
  assert.deepEqual(found, []);
});

test('the rule itself: what it finds and what it leaves', () => {
  for (const point of [0x034f, 0x115f, 0x3164, 0xfe00, 0xfe0f, 0x200b, 0xfeff, 0x00a0, 0x3000, 0x2028, 0xe000, 0x0000, 0xe0101]) assert.ok(hiddenLiteral.test(String.fromCodePoint(point)), point.toString(16));
  for (const char of [' ', '\t', '\n', '가', 'a', '·', '’', '…', '→', '😀']) assert.equal(hiddenLiteral.test(char), false, JSON.stringify(char));
});
