'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/life/source-markdown');
const withHeader = (yaml, body = '# 합성 본문\n\n원래 문단 **강조** 😀\n') => '---\n' + yaml + '\n---\n' + body;
function literalHeader(plan) {
  const match = plan.html.match(/^<pre class="source-properties-raw" data-source-block="0"><code>([\s\S]*?)<\/code><\/pre>/);
  assert(match, 'An unsupported proper header remains a literal pre/code block');
  return match[1].replace(/&#13;/g, '\r').replace(/&#10;/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

test('block maps preserve raw BOM, CRLF/CR, emoji, repeated paragraphs and skipped duplicate definitions', () => {
  const raw = '\uFEFF# 제목\r\n\r\n반복 **강조** 😀\r\n\r\n[x]: https://example.org/a\r\n[x]: https://example.org/b\r\n\r\n반복 **강조** 😀\r\r```js\rx < 1\r```\r';
  const before = raw, plan = M.prepare(raw);
  assert.equal(plan.formatted, true); assert.equal(raw, before);
  assert.match(plan.html, /^<h1[^>]*>제목<\/h1>/);
  assert.equal(plan.blocks.length, 4);
  const slices = plan.blocks.map(b => raw.slice(b.start, b.end));
  assert.equal(slices[0], '\uFEFF# 제목\r\n');
  assert.equal(slices[1], '반복 **강조** 😀\r\n');
  assert.equal(slices[2], '반복 **강조** 😀\r');
  assert.equal(slices[3], '```js\rx < 1\r```\r');
  assert(plan.blocks[2].start > plan.blocks[1].end, 'reference definitions never shift later anchors to an earlier repeated paragraph');
});

test('render plan keeps raw HTML literal and never emits images, media, internal or dangerous URL anchors', () => {
  const raw = '<img src="https://example.org/tracker" onerror="alert(1)">\n\n![alt](https://example.org/image.png) ![local](../private.png)\n\n[relative](file.md) [fragment](#title) [bad](javascript:alert(1)) [safe](https://example.org/a?q=1&b=2)\n\n```html\n<script>alert(2)</script>\n```';
  const plan = M.prepare(raw); assert(plan.formatted);
  assert(!/<(?:img|script|iframe|video|audio|svg|input)\b/.test(plan.html));
  assert.match(plan.html, /&lt;img/); assert.match(plan.html, /&lt;script&gt;/);
  assert.match(plan.html, /\[이미지: alt\]/); assert.match(plan.html, /\[이미지: local\]/);
  assert.equal((plan.html.match(/<a /g) || []).length, 1);
  assert.match(plan.html, /href="https:\/\/example.org\/a\?q=1&amp;b=2" target="_blank" rel="noopener noreferrer"/);
  for (const value of ['#title', '/path', '../x', 'file:///x', 'data:text/html,x', 'javascript:alert(1)', 'https://user:secret@example.org', 'https://example.org/\n']) assert.equal(M.safeLink(value), false, value);
});

test('headings, code, table and nested lists receive ordered bounded top-level source anchors', () => {
  const raw = '# H\n\n> quote\n>\n> * item\n\n| a | b |\n|---|---|\n| c | d |\n\n    code\n\n---\n';
  const plan = M.prepare(raw); assert(plan.formatted);
  assert.equal(plan.blocks.length, 5);
  assert.match(plan.html, /<table data-source-block="2">/);
  assert.match(plan.html, /<pre data-source-block="3">/);
  for (let i = 0; i < plan.blocks.length; i++) {
    const b = plan.blocks[i]; assert(b.start >= 0 && b.end <= raw.length && b.end > b.start);
    if (i) assert(b.start >= plan.blocks[i - 1].end);
  }
});

test('UTF-8 byte, token and nesting budgets fail to raw rather than silently clipping source', () => {
  assert.equal(M.prepare('가'.repeat(Math.floor(M.LIMITS.bytes / 3) + 1)).reason, 'too_large');
  assert.equal(M.prepare('> '.repeat(100) + 'end').reason, 'too_deep');
  assert.equal(M.prepare('a\n\n'.repeat(13000)).reason, 'too_many_tokens');
  assert.equal(M.prepare('').formatted, true);
});

test('a BOM/CRLF property mapping projects safe scalars/lists above the body with an exact full-header block', () => {
  const header = '\uFEFF---\r\ntitle: "합성 자료"\r\ndate: 2031-04-15\r\ntags:\r\n  - 학습\r\n  - 읽기\r\nrelated: ["[[합성 노트]]", "https://example.org/reference"]\r\n---\r\n';
  const raw = header + '# 합성 본문\r\n\r\n반복 **강조** 😀\r\n', before = raw, plan = M.prepare(raw);
  assert.equal(plan.formatted, true); assert.equal(raw, before);
  assert.deepEqual(plan.frontmatter, { start: 0, end: header.length, kind: 'properties', reason: null });
  assert.deepEqual(plan.blocks[0], { start: 0, end: header.length });
  assert.match(plan.html, /^<details class="source-properties" data-source-block="0"><summary>속성<\/summary><dl>/);
  assert.match(plan.html, /<dt>date<\/dt><dd>2031-04-15<\/dd>/);
  assert.match(plan.html, /<dt>tags<\/dt><dd><ul><li>학습<\/li><li>읽기<\/li><\/ul><\/dd>/);
  assert.match(plan.html, /<li>\[\[합성 노트\]\]<\/li><li>https:\/\/example.org\/reference<\/li>/);
  const body = plan.html.split('</details>')[1]; assert(!/title:|date:|tags:|related:/.test(body));
  assert.match(body, /<h1 data-source-block="1">합성 본문<\/h1>/);
  assert.equal(raw.slice(plan.blocks[1].start, plan.blocks[1].end), '# 합성 본문\r\n');
  assert.equal(raw.slice(plan.blocks[2].start, plan.blocks[2].end), '반복 **강조** 😀\r\n');
  assert.equal((plan.html.match(/<a\b/g) || []).length, 0, 'Property links stay plain text');
});

test('property values are escaped plain text including HTML, wiki syntax, multiline strings and scalar types', () => {
  const raw = withHeader('"<img src=x>": "<script>alert(1)</script>"\nrelated: ["[[노트]]", "![image](https://example.org/image.png)", "[link](https://example.org)"]\nflag: false\ncount: 12.5\nzero: -0\nnothing: null\nempty: ""\nnote: |\n  첫 줄\n  둘째 줄');
  const plan = M.prepare(raw); assert.equal(plan.frontmatter.kind, 'properties');
  assert.match(plan.html, /<dt>&lt;img src=x&gt;<\/dt><dd>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/dd>/);
  assert.match(plan.html, /<dt>flag<\/dt><dd>false<\/dd>/); assert.match(plan.html, /<dt>count<\/dt><dd>12.5<\/dd>/);
  assert.match(plan.html, /<dt>zero<\/dt><dd>-0<\/dd>/); assert.match(plan.html, /<dt>nothing<\/dt><dd>null<\/dd>/);
  assert.match(plan.html, /<dt>empty<\/dt><dd><\/dd>/); assert.match(plan.html, /<dt>note<\/dt><dd>첫 줄\n둘째 줄\n<\/dd>/);
  assert(!/<(?:a|img|script|iframe|svg|math|input|form)\b/.test(plan.html));
  assert(!/\s(?:id|style|onerror)=/.test(plan.html));
});

test('masking property display keeps repeated body blocks and skipped definitions at original CR/BOM/UTF16 offsets', () => {
  const header = '\uFEFF---\rtags: ["😀", "반복"]\r---\r';
  const raw = header + '반복 😀\r\r[x]: https://example.org/a\r[x]: https://example.org/b\r\r반복 😀\r\r```yaml\rtitle: 코드\r```\r';
  const plan = M.prepare(raw); assert.equal(plan.frontmatter.kind, 'properties'); assert.equal(plan.blocks.length, 4);
  assert.deepEqual(plan.blocks.map(block => raw.slice(block.start, block.end)), [header, '반복 😀\r', '반복 😀\r', '```yaml\rtitle: 코드\r```\r']);
  assert.equal(plan.blocks[1].start, header.length);
  assert(plan.blocks[2].start > plan.blocks[1].end);
  for (let n = 1; n < plan.blocks.length; n++) assert(plan.blocks[n].start >= plan.blocks[n - 1].end);
});

test('only exact document-start opening and closing fence lines opt into properties', () => {
  for (const raw of [
    'title: 합성\ndate: 2031-04-15\ntags: [학습]\n',
    '# 먼저 본문\n\n---\ntitle: 합성\n---\n',
    '\n---\ntitle: 합성\n---\n',
    ' ---\ntitle: 합성\n---\n',
    '--- \ntitle: 합성\n---\n',
    '---\ntitle: 합성\n--- \n',
    '---\ntitle: 합성\n...\n',
    '---\ntitle: 닫는 선 없음\n',
    '```yaml\n---\ntitle: 코드\n---\n```\n',
    '\uFEFF\uFEFF---\ntitle: 중복 BOM\n---\n'
  ]) {
    const plan = M.prepare(raw); assert.equal(plan.formatted, true); assert.equal(plan.frontmatter, null, raw);
    assert(!/source-properties/.test(plan.html), raw);
  }
  const code = M.prepare('```yaml\n---\ntitle: 코드\n---\n```\n');
  assert.match(code.html, /^<pre data-source-block="0"><code>---\ntitle: 코드\n---\n<\/code><\/pre>/);
});

test('malformed, duplicate and explicitly empty mappings remain verbatim while their body is formatted', () => {
  for (const yaml of ['title: [닫히지 않음', '"quoted: key": [닫히지 않음', "'quoted key': [닫히지 않음", '{title: [닫히지 않음', 'title: 첫 값\ntitle: 두 값', '{}', 'title: 먼저\n...']) {
    const raw = withHeader(yaml), plan = M.prepare(raw);
    assert.equal(plan.formatted, true, yaml); assert.equal(plan.frontmatter.kind, 'raw', yaml);
    assert.equal(literalHeader(plan), raw.slice(0, plan.frontmatter.end));
    assert(!/<details/.test(plan.html)); assert.match(plan.html, /<h1 data-source-block="1">합성 본문<\/h1>/);
  }
});

test('ordinary thematic-break prose, lists, null and scalars keep their original Markdown rendering', () => {
  for (const content of ['일반적인 구분선 사이의 **강조된 문장**', '\n평범한 문장\n', '- 첫 항목\n- 둘째 항목', 'null', 'true', '37', '', '여러 줄의\n평범한 문장',
    '# 제목', '## 작은 제목', '**강조 문장**', '*기울임 문장*', '[링크](https://example.org)', '`코드`', '> 인용문', '> title: 인용된 문장',
    '- title: 목록 안의 문장', '1. 번호 목록', '"title: 문자열 값"', "'title: [속성 아님]'", '<b>그대로 표시할 HTML</b>'
  ]) {
    const raw = withHeader(content), plan = M.prepare(raw);
    assert.equal(plan.formatted, true); assert.equal(plan.frontmatter, null, content);
    assert(!/source-properties|<details/.test(plan.html), content);
    // The leading blank line disables only document-start property detection;
    // the incumbent Markdown/link/security renderer and all content stay equal.
    assert.equal(plan.html, M.prepare('\n' + raw).html, content);
  }
  const prose = M.prepare('---\n일반적인 구분선 사이의 **강조된 문장**\n---\n\n다음 문단\n');
  assert.match(prose.html, /<hr data-source-block="0">/); assert.match(prose.html, /<strong>강조된 문장<\/strong>/);
});

test('unsupported headers preserve exact raw fences, BOM and line endings rather than HTML-normalized CRLF', () => {
  const header = '\uFEFF---\r\ntitle: 첫 값\r\ntitle: "<두 번째> & 😀"\r\n---\r\n', raw = header + '# 본문\r\n';
  const plan = M.prepare(raw); assert.equal(plan.frontmatter.kind, 'raw'); assert.equal(literalHeader(plan), header);
  assert(plan.html.includes('&#13;&#10;')); assert(!plan.html.split('</pre>')[0].includes('\r'));
  assert.deepEqual(plan.blocks[0], { start: 0, end: header.length });
  assert.equal(raw.slice(plan.blocks[1].start, plan.blocks[1].end), '# 본문\r\n');
});

test('aliases, anchors, explicit/custom tags and merge keys are kept raw without expanding or executing values', () => {
  for (const yaml of [
    'title: &name 값\nrelated: *name',
    'title: &name 값',
    'title: !!str 값',
    'title: !unsupported 값',
    'title: !!js/function "function () { return 1 }"',
    'title: !!timestamp 2031-04-15',
    '<<: { title: 값 }',
    '"<<": 값',
    'tags: &loop [*loop]',
    'base: &base [x, x]\ntags: [*base, *base]'
  ]) {
    const raw = withHeader(yaml), plan = M.prepare(raw); assert.equal(plan.frontmatter.kind, 'raw', yaml);
    assert.equal(literalHeader(plan), raw.slice(0, plan.frontmatter.end));
  }
  const quoted = M.prepare(withHeader('title: "&name *name !!str !custom <<"'));
  assert.equal(quoted.frontmatter.kind, 'properties', 'Literal string content is not mistaken for executable YAML syntax');
});

test('real-map schema refuses ambiguous scalar/complex keys and nested values while accepting quoted string keys', () => {
  for (const yaml of [
    '1: 값', 'true: 값', 'null: 값', '? [a, b]\n: 값', '? {a: b}\n: 값',
    'tags: [[노트]]', 'note: { nested: 값 }', 'tags: [a, [b]]',
    '"": 값', '"여러\\n줄": 값', 'title: "\\0"',
    'deep: ' + '['.repeat(12) + 'x' + ']'.repeat(12)
  ]) {
    const raw = withHeader(yaml), plan = M.prepare(raw); assert.equal(plan.frontmatter.kind, 'raw', yaml);
    assert.equal(literalHeader(plan), raw.slice(0, plan.frontmatter.end));
  }
  const plan = M.prepare(withHeader('"1": "숫자처럼 보이는 문자열 키"\n"true": 값\n"null": 값'));
  assert.equal(plan.frontmatter.kind, 'properties'); assert.match(plan.html, /<dt>1<\/dt>/);
});

test('prototype-looking keys stay literal data and cannot pollute objects or become element attributes', () => {
  const raw = withHeader('__proto__: "그대로 표시"\nconstructor: "문자열"\nprototype: false\n"data-source-block": 999\n"class": "evil"\n"id": "private"');
  const plan = M.prepare(raw); assert.equal(plan.frontmatter.kind, 'properties');
  assert.match(plan.html, /<dt>__proto__<\/dt><dd>그대로 표시<\/dd>/);
  assert.match(plan.html, /<dt>data-source-block<\/dt><dd>999<\/dd>/);
  assert(!/class="evil"|id="private"/.test(plan.html));
  assert.equal({}.polluted, undefined);
  const nested = M.prepare(withHeader('__proto__: { polluted: true }')); assert.equal(nested.frontmatter.kind, 'raw');
  assert.equal({}.polluted, undefined);
});

test('unsafe integer precision is preserved as raw YAML instead of displaying a rounded property', () => {
  for (const number of ['9007199254740993', '-9007199254740993', '1e30']) {
    const raw = withHeader('count: ' + number), plan = M.prepare(raw);
    assert.equal(plan.frontmatter.kind, 'raw', number); assert.equal(literalHeader(plan), raw.slice(0, plan.frontmatter.end));
  }
  const safe = M.prepare(withHeader('count: 9007199254740991\nquoted: "9007199254740993"\ndate: 2031-04-15\nvalues: [true, null, 2.5]'));
  assert.equal(safe.frontmatter.kind, 'properties'); assert.match(safe.html, /<dd>9007199254740993<\/dd>/);
  assert.match(safe.html, /<dt>date<\/dt><dd>2031-04-15<\/dd>/);
});

test('header byte/property/value budgets fall back to the full header without truncating later body maps', () => {
  const excessive = withHeader('note: "' + '가'.repeat(22000) + '"'), large = M.prepare(excessive);
  assert.equal(large.formatted, true); assert.equal(large.frontmatter.kind, 'raw'); assert.equal(large.frontmatter.reason, 'too_large');
  assert.equal(literalHeader(large), excessive.slice(0, large.frontmatter.end));
  assert.equal(excessive.slice(large.blocks[1].start, large.blocks[1].end), '# 합성 본문\n');
  const properties = count => Array.from({ length: count }, (_, n) => 'key' + n + ': 값').join('\n');
  assert.equal(M.prepare(withHeader(properties(100))).frontmatter.kind, 'properties');
  assert.equal(M.prepare(withHeader(properties(101))).frontmatter.kind, 'raw');
  const values = count => 'tags: [' + Array(count).fill('x').join(', ') + ']';
  assert.equal(M.prepare(withHeader(values(1000))).frontmatter.kind, 'properties');
  for (const count of [1001,5000]) {
    const raw = withHeader(values(count)), plan = M.prepare(raw); assert.equal(plan.frontmatter.kind, 'raw');
    assert.equal(literalHeader(plan), raw.slice(0, plan.frontmatter.end));
  }
});

test('missing browser YAML capability keeps the header literal and still formats ordinary body Markdown', () => {
  const context = vm.createContext({ markdownit: require('../vendor/markdown-it/markdown-it.umd.min.js'), TextEncoder, URL });
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/source-markdown'), 'utf8'), context);
  const raw = withHeader('title: 합성'), plan = context.HaedoLife.SourceMarkdown.prepare(raw);
  assert.equal(plan.formatted, true); assert.equal(plan.frontmatter.kind, 'raw'); assert.equal(plan.frontmatter.reason, 'unavailable');
  assert.equal(literalHeader(plan), raw.slice(0, plan.frontmatter.end)); assert.match(plan.html, /<h1 data-source-block="1">합성 본문/);
});
