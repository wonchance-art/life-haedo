const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../scripts/update-discovery-feed.py');
const ids = ['naver-d2', 'seoul-culture', 'woowahan-tech'];
const hosts = ['d2.naver.com', 'news.seoul.go.kr', 'techblog.woowahan.com'];
const first = '2026-10-18T12:00:00Z';
const next = '2026-10-19T12:00:00Z';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haedo-public-feed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (let i = 0; i < ids.length; i++) {
    fs.writeFileSync(path.join(dir, `${ids[i]}.robots.txt`), 'User-agent: *\nAllow: /\n');
    const link = `https://${hosts[i]}/article?newsId=42&amp;utm_source=feed#detail`;
    const xml = i === 0
      ? `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>기술 기록</title><link href="${link}"/><updated>2026-10-08T06:44:57Z</updated><category term="공식 분류"/><content>PRIVATE_BODY_SENTINEL</content></entry></feed>`
      : `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><item><title>문화와 기술</title><link>${link}</link><pubDate>${i === 1 ? '2026-10-16 17:11:27' : 'Tue, 06 Oct 2026 05:00:35 +0000'}</pubDate><dc:creator>공식 작성자</dc:creator><category>공식 분류</category><description><![CDATA[<script>BAD_SCRIPT</script>PRIVATE_BODY_SENTINEL]]></description></item></channel></rss>`;
    fs.writeFileSync(path.join(dir, `${ids[i]}.xml`), xml);
  }
  return { dir, output: path.join(dir, 'catalog.json'), report: path.join(dir, 'report.json') };
}

function update(w, now = first) {
  const p = spawnSync('python3', [script, '--output', w.output, '--report', w.report, '--fixtures', w.dir, '--now', now], { encoding: 'utf8' });
  assert.equal(p.error, undefined);
  return p;
}

function python(code) {
  const bootstrap = `import sys,importlib.util,json\nsys.dont_write_bytecode=True\ns=importlib.util.spec_from_file_location('feed',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n`;
  const p = spawnSync('python3', ['-c', bootstrap + code, script], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  return JSON.parse(p.stdout);
}

test('official metadata contract distinguishes publication, update, fetch and rights', t => {
  const w = workspace(t);
  assert.equal(update(w).status, 0);
  const c = JSON.parse(fs.readFileSync(w.output));
  assert.equal(c.articles.length, 3);
  assert.equal(c.schemaVersion, 1);
  assert.equal(c.generatedAt, first);
  for (const s of c.sources) {
    assert.equal(s.status, 'ok');
    assert.equal(s.lastSuccessAt, first);
    assert.equal(s.lastAttemptAt, first);
    assert.equal(s.stale, false);
    assert.equal(s.freshnessMaxAgeDays, 7);
  }
  const [d2, seoul, woo] = c.articles;
  assert.equal(d2.publishedAt, null);
  assert.equal(d2.dateStatus, 'unknown');
  assert.equal(d2.updatedAt, '2026-10-08T06:44:57Z');
  assert.equal(d2.dateBasis, 'updated');
  assert.equal(seoul.publishedAt, '2026-10-16T08:11:27Z');
  assert.equal(woo.publishedAt, '2026-10-06T05:00:35Z');
  for (const a of c.articles) {
    assert.equal(a.coverage, 'link_only');
    assert.equal(a.rights.mode, 'metadata_only');
    assert.equal(a.summary, '');
    assert.equal(Object.hasOwn(a, 'bodyText'), false);
    assert.deepEqual(a.tags, ['공식 분류']);
    assert.match(a.url, /utm_source=feed#detail$/);
    assert.equal(a.canonicalUrl, `https://${hosts[ids.indexOf(a.sourceId)]}/article?newsId=42`);
    assert.equal(a.fetchedAt, first);
  }
  assert.doesNotMatch(JSON.stringify(c), /PRIVATE_BODY_SENTINEL|BAD_SCRIPT/);
});

test('unsafe links and HTML never become catalog content; canonical duplicates collapse', t => {
  const w = workspace(t);
  fs.writeFileSync(path.join(w.dir, 'naver-d2.xml'), `<rss><channel>
    <item><title><script>XML_SCRIPT</script><![CDATA[<img src=x onerror=BAD_EVENT><script>BAD_SCRIPT</script><b>안전한 제목</b>]]></title><link>https://d2.naver.com/post?newsId=1&amp;utm_source=a</link><pubDate>not-a-date</pubDate><author>contact@example.invalid (작성자)</author></item>
    <item><title>중복</title><link>https://d2.naver.com/post?newsId=1&amp;fbclid=b#copy</link></item>
    <item><title>외부</title><link>https://d2.naver.com.evil.invalid/post</link></item>
    <item><title>자격</title><link>https://secret@d2.naver.com/post</link></item>
    <item><title>실행</title><link>javascript:alert(1)</link></item>
    </channel></rss>`);
  assert.equal(update(w).status, 0);
  const a = JSON.parse(fs.readFileSync(w.output)).articles.filter(x => x.sourceId === 'naver-d2');
  assert.equal(a.length, 1);
  assert.equal(a[0].title, '안전한 제목');
  assert.equal(a[0].author, '작성자');
  assert.equal(a[0].publishedAt, null);
  assert.equal(a[0].dateStatus, 'invalid');
  assert.equal(a[0].dateBasis, 'unknown');
  assert.doesNotMatch(JSON.stringify(a), /BAD_|XML_SCRIPT|@|evil|javascript/);
  assert.equal(JSON.parse(fs.readFileSync(w.report)).sources[0].rejectedEntries, 3);
});

for (const failure of ['missing', 'malformed', 'entity', 'robots']) {
  test(`${failure} failure retains last good articles and success time with explicit fresh attempt`, t => {
    const w = workspace(t);
    assert.equal(update(w).status, 0);
    const before = JSON.parse(fs.readFileSync(w.output));
    const old = before.articles.find(a => a.sourceId === 'naver-d2');
    // Unknown body fields from an old file are never carried into public output.
    old.bodyText = 'DO_NOT_RETAIN_BODY';
    fs.writeFileSync(w.output, JSON.stringify(before));
    const f = path.join(w.dir, 'naver-d2.xml');
    if (failure === 'missing') fs.unlinkSync(f);
    if (failure === 'malformed') fs.writeFileSync(f, '<rss>broken');
    if (failure === 'entity') fs.writeFileSync(f, '<!DOCTYPE rss [<!ENTITY x "expanded">]><rss><channel><item><title>&x;</title><link>https://d2.naver.com/post</link></item></channel></rss>');
    if (failure === 'robots') fs.writeFileSync(path.join(w.dir, 'naver-d2.robots.txt'), 'User-agent: *\nDisallow: /\n');
    assert.equal(update(w, next).status, 2);
    const after = JSON.parse(fs.readFileSync(w.output));
    const s = after.sources.find(s => s.id === 'naver-d2');
    assert.equal(s.status, 'error');
    assert.equal(s.stale, true);
    assert.ok(s.error);
    assert.equal(s.lastSuccessAt, first);
    assert.equal(s.lastAttemptAt, next);
    delete old.bodyText;
    assert.deepEqual(after.articles.find(a => a.sourceId === 'naver-d2'), old);
    assert.equal(after.sources.filter(s => s.status === 'ok').length, 2);
    assert.equal(after.sources.find(s => s.id === 'seoul-culture').lastSuccessAt, next);
    assert.doesNotMatch(JSON.stringify(after), /DO_NOT_RETAIN_BODY/);
    assert.equal(JSON.parse(fs.readFileSync(w.report)).sources[0].retainedArticles, 1);
  });
}

test('a corrupt previous file is preserved byte for byte rather than replaced', t => {
  const w = workspace(t);
  const bad = '{ preserve this corrupt file';
  fs.writeFileSync(w.output, bad);
  assert.equal(update(w).status, 1);
  assert.equal(fs.readFileSync(w.output, 'utf8'), bad);
});

test('HTTPS downgrade, off-host redirects and oversized input fail closed', () => {
  const actual = python(`
import urllib.request
results=[]
for url in ['http://d2.naver.com/NotFound','https://evil.invalid/','https://user@d2.naver.com/','https://d2.naver.com:444/']:
 try:
  m.RestrictedRedirect(['d2.naver.com']).redirect_request(urllib.request.Request('https://d2.naver.com/robots.txt'),None,302,'',{},url)
  results.append(False)
 except m.FeedError: results.append(True)
try:
 m.parse_feed(b'x'*(m.MAX_FEED_BYTES+1),m.SOURCES[0],m.datetime.now(m.timezone.utc))
 results.append(False)
except m.FeedError: results.append(True)
try:
 m.parse_feed('<!DOCTYPE rss [<!ENTITY x "expanded">]><rss/>'.encode('utf-16'),m.SOURCES[0],m.datetime.now(m.timezone.utc))
 results.append(False)
except m.FeedError: results.append(True)
print(json.dumps(results))
`);
  assert.deepEqual(actual, [true, true, true, true, true, true]);
});

test('failed atomic replacement preserves the previous file and removes temporary partial data', () => {
  const actual = python(`
from unittest.mock import patch
with m.tempfile.TemporaryDirectory() as d:
 p=m.Path(d)/'feed.json';p.write_text('previous',encoding='utf-8')
 try:
  with patch.object(m.os,'replace',side_effect=OSError('unavailable')):m.atomic_json(p,{'new':True})
 except OSError:pass
 print(json.dumps({'preserved':p.read_text()=='previous','files':[x.name for x in m.Path(d).iterdir()]}))
`);
  assert.deepEqual(actual, { preserved: true, files: ['feed.json'] });
});
