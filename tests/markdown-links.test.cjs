'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Links = require('../scripts/check-markdown-links.cjs');
// Links that were already broken when this check was added. Fix them by removing the entry.
const allowlist = require('./fixtures/markdown-links-allowlist.json');

test('GitHub heading slugs keep Korean text and drop punctuation', () => {
  assert.equal(Links.slug('현재 실행 기준 — 두 순환 · 2026-10-14 KST'), '현재-실행-기준--두-순환--2026-10-14-kst');
  assert.equal(Links.slug(Links.headingText('첫 구현 묶음 R1')), '첫-구현-묶음-r1');
  assert.equal(Links.slug(Links.headingText('`npm test`와 **검사** (완료)')), 'npm-test와-검사-완료');
});

test('checker reports missing files and anchors, ignores code and external links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-links-'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs', 'a.md'), '# 제목\n\n## 같은 절\n\n## 같은 절\n');
  fs.writeFileSync(path.join(root, 'README.md'), [
    '[ok](docs/a.md#같은-절-1) [ok](docs/a.md#%EC%A0%9C%EB%AA%A9) [ok](#local) [web](https://example.com/x.md#y)',
    '## local',
    '[gone](docs/b.md) [bad](docs/a.md#같은-절-2) `[code](docs/c.md)`',
    '```', '[fenced](docs/d.md)', '```',
  ].join('\n'));
  const broken = Links.check(root).map(item => `${item.line} ${item.reason}: ${item.target}`);
  assert.deepEqual(broken, ['3 missing file: docs/b.md', '3 missing anchor: docs/a.md#같은-절-2']);
});

test('docs and root markdown have no new broken relative links', () => {
  const found = [...new Set(Links.check().map(Links.keyOf))].sort();
  const added = found.filter(key => !allowlist.includes(key));
  const fixed = allowlist.filter(key => !found.includes(key));
  assert.deepEqual(added, [], 'New broken markdown links');
  assert.deepEqual(fixed, [], 'Allowlisted links now resolve; remove them from tests/fixtures/markdown-links-allowlist.json');
});
