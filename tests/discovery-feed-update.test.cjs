const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../scripts/update-discovery-feed.py');
const ids = ['naver-d2', 'seoul-culture', 'woowahan-tech', 'readersnews-books', 'seoul-environment', 'arxiv-cs-cl', 'mit-linguistics', 'llt-journal', 'frontiers-psychology'];
const hosts = ['d2.naver.com', 'news.seoul.go.kr', 'techblog.woowahan.com', 'www.readersnews.com', 'news.seoul.go.kr', 'arxiv.org', 'news.mit.edu', 'www.lltjournal.org', 'www.frontiersin.org'];
const lltFixture = fs.readFileSync(path.join(__dirname, 'fixtures/external-discovery/llt-journal.xml'), 'utf8');
const first = '2026-10-18T12:00:00Z';
const next = '2026-10-19T12:00:00Z';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haedo-public-feed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (let i = 0; i < ids.length; i++) {
    fs.writeFileSync(path.join(dir, `${ids[i]}.robots.txt`), 'User-agent: *\nAllow: /\n');
    if (ids[i] === 'llt-journal') {
      fs.writeFileSync(path.join(dir, `${ids[i]}.xml`), lltFixture);
      continue;
    }
    const link = `https://${hosts[i]}/article?newsId=42&amp;utm_source=feed#detail`;
    const xml = ids[i] === 'frontiers-psychology'
      ? `<rss version="2.0"><channel><item><title>Learning in a synthetic study</title><link>${link}</link><pubdate>2026-10-17T00:00:00Z</pubdate><author>First Author</author><author>SECOND_AUTHOR_SENTINEL</author><category>Original Research</category><description>Official author abstract.</description></item></channel></rss>`
      : i === 0
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
  assert.equal(c.articles.length, ids.length);
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
    assert.equal(a.coverage, a.sourceId === 'frontiers-psychology' ? 'summary' : 'link_only');
    assert.equal(a.rights.mode, a.sourceId === 'frontiers-psychology' ? 'summary_allowed' : 'metadata_only');
    assert.equal(a.summary, a.sourceId === 'frontiers-psychology' ? 'Official author abstract.' : '');
    assert.equal(Object.hasOwn(a, 'bodyText'), false);
    assert.deepEqual(a.tags, ['llt-journal', 'frontiers-psychology'].includes(a.sourceId) ? [] : ['공식 분류']);
    assert.match(a.url, /utm_source=feed#detail$/);
    assert.equal(a.canonicalUrl, a.sourceId === 'llt-journal'
      ? 'https://www.lltjournal.org/item/synthetic/?newsId=42'
      : `https://${hosts[ids.indexOf(a.sourceId)]}/article?newsId=42`);
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
    assert.equal(after.sources.filter(s => s.status === 'ok').length, ids.length - 1);
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

test('collector and browser canonical query identities agree without reserializing required values', () => {
  const Discovery = require('../assets/life/discovery.js');
  const urls = [
    'https://d2.naver.com/article?q=one%20two&sig=a~b&x=%2f&x=2&utm_source=feed#detail',
    'https://d2.naver.com/article?sig=a%2Bb%2fc&ref=feed&source=official&fbclid=x',
    'https://d2.naver.com/article?empty=&flag&newsId=42&%75tm_source=feed&MC_EID=x',
    'https://d2.naver.com/article?q=서울&sig=~a+%2f&%FFbad=value&utm_medium=r',
    "https://d2.naver.com/article?q='quoted'&id=1&id=2&gclid=x"
  ];
  const actual = python(`\nurls=${JSON.stringify(urls)}\nprint(json.dumps([m.approved_url(url,['d2.naver.com'],canonical=True) for url in urls]))\n`);
  assert.deepEqual(actual, urls.map(Discovery.canonicalUrl));
  assert.match(actual[0], /q=one%20two&sig=a~b&x=%2f&x=2$/);
  assert.match(actual[1], /sig=a%2Bb%2fc&ref=feed&source=official$/);
});

test('future publication timestamps remain labeled and cannot outrank genuinely published metadata', () => {
  const actual = python(`
now=m.datetime(2026,10,18,12,tzinfo=m.timezone.utc)
xml=b'<rss><channel><item><title>Future</title><link>https://d2.naver.com/future</link><pubDate>2026-10-18T20:00:00Z</pubDate></item><item><title>Published</title><link>https://d2.naver.com/published</link><pubDate>2026-10-18T11:00:00Z</pubDate></item></channel></rss>'
articles,_=m.parse_feed(xml,m.SOURCES[0],now)
print(json.dumps({'ordered':[a['title'] for a in articles],'future':articles[1],'futureSortDate':m.article_date(articles[1]),'grace':m.parse_date('2026-10-18T12:05:00Z',m.SOURCES[0],now),'afterGrace':m.parse_date('2026-10-18T12:05:01Z',m.SOURCES[0],now),'seoulLocal':m.parse_date('2026-10-18 21:00:00',m.SOURCES[1],now),'invalid':m.parse_date('2026-02-30T00:00:00Z',m.SOURCES[0],now)}))
`);
  assert.deepEqual(actual.ordered, ['Published', 'Future']);
  assert.equal(actual.future.publishedAt, '2026-10-18T20:00:00Z');
  assert.equal(actual.future.dateStatus, 'future'); assert.equal(actual.future.dateBasis, 'unknown');
  assert.equal(actual.futureSortDate, ''); assert.equal(actual.grace[1], 'valid'); assert.equal(actual.afterGrace[1], 'future');
  assert.deepEqual(actual.seoulLocal, ['2026-10-18T12:00:00Z', 'valid']); assert.deepEqual(actual.invalid, [null, 'invalid']);
});

for (const damage of ['lastSuccessAt', 'lastAttemptAt', 'generatedAt', 'success-after-attempt']) {
  test(`corrupt prior ${damage} is refused before replacing any existing catalog bytes`, t => {
    const w = workspace(t); assert.equal(update(w).status, 0);
    const before = JSON.parse(fs.readFileSync(w.output));
    if (damage === 'generatedAt') before.generatedAt = 'invalid';
    else if (damage === 'success-after-attempt') { before.sources[0].lastSuccessAt = next; before.sources[0].lastAttemptAt = first; }
    else before.sources[0][damage] = 'not-a-date';
    const bytes = JSON.stringify(before); fs.writeFileSync(w.output, bytes);
    assert.equal(update(w, next).status, 1); assert.equal(fs.readFileSync(w.output, 'utf8'), bytes);
  });
}

test('robots denial or service failure cannot be treated as missing policy; rights remain metadata-only', () => {
  const actual = python(`
import urllib.error
source=m.SOURCES[0]
def missing(url,source,limit):raise urllib.error.HTTPError(url,404,'not found',{},None)
def unavailable(url,source,limit):raise urllib.error.HTTPError(url,503,'unavailable',{},None)
def denied(url,source,limit):return b'User-agent: *\\nDisallow: /\\n',{'sha256':'fixture'}
results={'missing':m.check_robots(source,missing)['status']}
for key,fetcher in [('unavailable',unavailable),('denied',denied)]:
 try:m.check_robots(source,fetcher);results[key]='accepted'
 except Exception:results[key]='rejected'
unreviewed=m.copy.deepcopy(source);unreviewed['rights']['mode']='full_text_allowed'
try:m.parse_feed(b'<rss><channel/></rss>',unreviewed,m.datetime.now(m.timezone.utc));results['rights']='accepted'
except m.FeedError:results['rights']='rejected'
print(json.dumps(results))
`);
  assert.deepEqual(actual, { missing: 'not_provided', unavailable: 'rejected', denied: 'rejected', rights: 'rejected' });
});

test('approved English sources are additive metadata feeds with explicit preprint/date limits', () => {
  const sources = python(`print(json.dumps(m.SOURCES))`);
  assert.deepEqual(sources.map(s => s.id), ids);
  assert.deepEqual(sources.slice(0, 5).map(s => s.allowedHosts), hosts.slice(0, 5).map(h => [h]));
  const arxiv = sources.find(s => s.id === 'arxiv-cs-cl'), mit = sources.find(s => s.id === 'mit-linguistics');
  assert.deepEqual(arxiv.allowedHosts, ['arxiv.org', 'rss.arxiv.org']);
  assert.equal(arxiv.feedUrl, 'https://rss.arxiv.org/rss/cs.CL');
  assert.equal(arxiv.requestIntervalSeconds, 3); assert.match(arxiv.name, /영문.*사전공개/); assert.match(arxiv.rights.label, /RSS 공지일/);
  assert.equal(mit.feedUrl, 'https://news.mit.edu/topic/mitlinguistics-rss.xml');
  assert.deepEqual(mit.allowedHosts, ['news.mit.edu']); assert.match(mit.rights.label, /MIT News/);
  assert.ok([arxiv, mit].every(s => s.language === 'en' && s.rights.mode === 'metadata_only'));
  assert.ok(sources.filter(s => s.id !== arxiv.id).every(s => !s.requestIntervalSeconds));
});

test('LLT has one official HTTPS host and preserves absent publisher fields without inferring tags or dates', t => {
  const w = workspace(t); assert.equal(update(w).status, 0);
  const catalog = JSON.parse(fs.readFileSync(w.output));
  const source = catalog.sources.find(row => row.id === 'llt-journal');
  const article = catalog.articles.find(row => row.sourceId === source.id);
  const config = python(`print(json.dumps(next(s for s in m.SOURCES if s['id']=='llt-journal')))`);
  assert.equal(config.name, 'Language Learning & Technology');
  assert.equal(config.feedUrl, 'https://www.lltjournal.org/feedlet/');
  assert.deepEqual(config.allowedHosts, ['www.lltjournal.org']);
  assert.equal(source.rights.url, 'https://www.lltjournal.org/about/');
  assert.equal(source.rights.mode, 'metadata_only');
  assert.match(source.rights.label, /2020년 이후 원문 CC BY-NC-ND 4\.0/);
  assert.match(source.rights.label, /출처표시·비상업·원형유지/);
  assert.equal(source.latestArticleAt, null);
  assert.equal(article.publishedAt, null); assert.equal(article.dateStatus, 'unknown');
  assert.equal(article.updatedAt, null); assert.equal(article.updatedDateStatus, 'unknown');
  assert.equal(article.dateBasis, 'unknown'); assert.equal(article.author, null);
  assert.deepEqual(article.tags, []); assert.equal(article.language, 'en');
  assert.equal(article.fetchedAt, first); assert.equal(article.coverage, 'link_only');
  assert.equal(article.summary, ''); assert.doesNotMatch(JSON.stringify(article), /PRIVATE_BODY_SENTINEL/);
});

test('LLT feed failure retains exact undated metadata and leaves the first seven source identities intact', t => {
  const w = workspace(t); assert.equal(update(w).status, 0);
  const before = JSON.parse(fs.readFileSync(w.output));
  fs.unlinkSync(path.join(w.dir, 'llt-journal.xml'));
  assert.equal(update(w, next).status, 2);
  const after = JSON.parse(fs.readFileSync(w.output)), source = after.sources.find(row => row.id === 'llt-journal');
  assert.equal(source.status, 'error'); assert.equal(source.stale, true);
  assert.equal(source.lastSuccessAt, first); assert.equal(source.lastAttemptAt, next);
  assert.deepEqual(after.articles.filter(row => row.sourceId === source.id), before.articles.filter(row => row.sourceId === source.id));
  const legacy = catalog => catalog.articles.filter(row => row.sourceId !== source.id).map(row => [row.id, row.sourceId, row.url, row.canonicalUrl]);
  assert.deepEqual(legacy(after), legacy(before));
});

test('Frontiers adds reviewed official abstract with its date and first author but no article-type topic tags', t => {
  const w = workspace(t);
  assert.equal(update(w).status, 0);
  const catalog = JSON.parse(fs.readFileSync(w.output));
  const source = catalog.sources.find(row => row.id === 'frontiers-psychology');
  const article = catalog.articles.find(row => row.sourceId === source.id);
  const config = python(`print(json.dumps(next(s for s in m.SOURCES if s['id']=='frontiers-psychology')))`);
  assert.equal(config.name, 'Frontiers in Psychology · 영문 심리학 연구');
  assert.equal(config.url, 'https://www.frontiersin.org/journals/psychology');
  assert.equal(config.feedUrl, 'https://www.frontiersin.org/journals/psychology/rss');
  assert.deepEqual(config.allowedHosts, ['www.frontiersin.org']);
  assert.equal(source.rights.url, 'https://www.frontiersin.org/journals/psychology/about#copyright-statement');
  assert.equal(source.rights.mode, 'full_text_allowed');
  assert.match(source.rights.label, /CC-BY\(출처표시·변경명시\)/);
  assert.match(source.rights.label, /개별 CC BY 4\.0 확인/);
  assert.equal(article.language, 'en');
  assert.equal(article.publishedAt, '2026-10-17T00:00:00Z');
  assert.equal(article.dateStatus, 'valid');
  assert.equal(article.dateBasis, 'published');
  assert.equal(article.author, 'First Author');
  assert.deepEqual(article.tags, []);
  assert.equal(article.coverage, 'summary');
  assert.equal(article.summary, 'Official author abstract.');
  assert.equal(article.rights.mode, 'summary_allowed');
  assert.equal(article.rights.url, 'https://creativecommons.org/licenses/by/4.0/');
  assert.doesNotMatch(JSON.stringify(catalog), /PRIVATE_BODY_SENTINEL|SECOND_AUTHOR_SENTINEL/);
});

test('Frontiers lowercase dates are source-specific and retain missing, invalid, future and standard-date precedence', () => {
  const actual = python(`
now=m.datetime(2026,10,18,12,tzinfo=m.timezone.utc)
frontiers=next(s for s in m.SOURCES if s['id']=='frontiers-psychology')
mit=next(s for s in m.SOURCES if s['id']=='mit-linguistics')
def parse(source, dates):
 xml=('<rss><channel><item><title>Study</title><link>https://'+source['allowedHosts'][0]+'/study</link>'+dates+'<category>Original Research</category></item></channel></rss>').encode()
 return m.parse_feed(xml,source,now)[0][0]
results={key:parse(frontiers,dates) for key,dates in {
 'missing':'',
 'invalid':'<pubdate>not-a-date</pubdate>',
 'future':'<pubdate>2026-10-19T00:00:00Z</pubdate>',
 'standard':'<pubDate>2026-10-16T00:00:00Z</pubDate><pubdate>2026-10-17T00:00:00Z</pubdate>',
 'dc':'<dc:date xmlns:dc="http://purl.org/dc/elements/1.1/">2026-10-15T00:00:00Z</dc:date><pubdate>2026-10-17T00:00:00Z</pubdate>'
}.items()}
results['legacy']=parse(mit,'<pubdate>2026-10-17T00:00:00Z</pubdate>')
print(json.dumps(results))
`);
  assert.equal(actual.missing.publishedAt, null);
  assert.equal(actual.missing.dateStatus, 'unknown');
  assert.equal(actual.invalid.publishedAt, null);
  assert.equal(actual.invalid.dateStatus, 'invalid');
  assert.equal(actual.future.publishedAt, '2026-10-19T00:00:00Z');
  assert.equal(actual.future.dateStatus, 'future');
  assert.equal(actual.future.dateBasis, 'unknown');
  assert.equal(actual.standard.publishedAt, '2026-10-16T00:00:00Z');
  assert.equal(actual.dc.publishedAt, '2026-10-15T00:00:00Z');
  assert.equal(actual.legacy.publishedAt, null);
  assert.equal(actual.legacy.dateStatus, 'unknown');
  assert.deepEqual(actual.legacy.tags, ['Original Research']);
});

test('Frontiers keeps the existing twenty-item cap and never promotes article-type categories into tags', () => {
  const actual = python(`
source=next(s for s in m.SOURCES if s['id']=='frontiers-psychology')
now=m.datetime(2026,10,18,12,tzinfo=m.timezone.utc)
items=['<item><title>Study '+str(i)+'</title><link>https://www.frontiersin.org/articles/study-'+str(i)+'</link><pubdate>2026-10-17T00:00:00Z</pubdate><category>Review</category><tags>General Psychology</tags></item>' for i in range(25)]
articles,stats=m.parse_feed(('<rss><channel>'+''.join(items)+'</channel></rss>').encode(),source,now)
print(json.dumps({'count':len(articles),'accepted':stats['acceptedEntries'],'tags':[a['tags'] for a in articles]}))
`);
  assert.equal(actual.count, 20);
  assert.equal(actual.accepted, 25);
  assert.ok(actual.tags.every(tags => tags.length === 0));
});

test('Frontiers failure preserves exact last-success metadata and removes stale article-type topic tags', t => {
  const w = workspace(t);
  assert.equal(update(w).status, 0);
  const before = JSON.parse(fs.readFileSync(w.output));
  const old = before.articles.find(row => row.sourceId === 'frontiers-psychology');
  const expected = structuredClone(old);
  old.tags = ['Original Research'];
  fs.writeFileSync(w.output, JSON.stringify(before));
  fs.unlinkSync(path.join(w.dir, 'frontiers-psychology.xml'));
  assert.equal(update(w, next).status, 2);
  const after = JSON.parse(fs.readFileSync(w.output));
  const source = after.sources.find(row => row.id === old.sourceId);
  assert.equal(source.status, 'error');
  assert.equal(source.stale, true);
  assert.equal(source.lastSuccessAt, first);
  assert.equal(source.lastAttemptAt, next);
  assert.deepEqual(after.articles.find(row => row.sourceId === old.sourceId), expected);
  assert.deepEqual(after.articles.filter(row => row.sourceId !== old.sourceId), before.articles.filter(row => row.sourceId !== old.sourceId).map(row => ({ ...row, fetchedAt: next })));
});

test('arXiv pacing covers initial requests, safe redirects and failures without pacing other sources', () => {
  const result = python(`
from unittest.mock import patch
source=next(s for s in m.SOURCES if s['id']=='arxiv-cs-cl')
other=next(s for s in m.SOURCES if s['id']=='mit-linguistics')
clock=[0.0];waits=[];starts=[];handlerKinds=[];responses=[];failures=[]
def sleep(seconds):waits.append(seconds);clock[0]+=seconds
gate=m.RequestPacer(3,clock=lambda:clock[0],sleeper=sleep)
class Response:
 status=200;headers={}
 def __init__(self,url):self.url=url
 def __enter__(self):return self
 def __exit__(self,*args):responses.append('closed')
 def read(self,limit):return b'public metadata'
def attempt(req):
 starts.append([req.full_url,clock[0]])
 if req.full_url.endswith('/fail'):
  import io
  fp=io.BytesIO(b'unavailable');failures.append(fp)
  raise m.urllib.error.HTTPError(req.full_url,503,'unavailable',{},fp)
 return Response(req.full_url)
def build(*handlers):
 paced=next((h for h in handlers if isinstance(h,m.PacedHTTPSHandler)),None)
 redirect=next(h for h in handlers if isinstance(h,m.RestrictedRedirect))
 handlerKinds.append(paced is not None)
 class Opener:
  def open(self,req,timeout):
   response=paced.https_open(req) if paced else attempt(req)
   if req.full_url.endswith('/redirect'):
    # urllib closes its redirect response before starting the next HTTPS open.
    response.__exit__()
    req=redirect.redirect_request(req,None,302,'',{},'https://arxiv.org/final')
    return paced.https_open(req)
   return response
 return Opener()
with patch.object(m.urllib.request,'build_opener',side_effect=build),patch.object(m.urllib.request.HTTPSHandler,'https_open',side_effect=attempt):
 m.fetch_public('https://rss.arxiv.org/robots.txt',source,100,pacer=gate)
 clock[0]+=0.5
 m.fetch_public('https://rss.arxiv.org/redirect',source,100,pacer=gate)
 try:m.fetch_public('https://rss.arxiv.org/fail',source,100,pacer=gate)
 except OSError:pass
 m.fetch_public('https://rss.arxiv.org/retry',source,100,pacer=gate)
 m.fetch_public('https://news.mit.edu/feed',other,100)
print(json.dumps({'starts':starts,'waits':waits,'handlers':handlerKinds,'otherPacer':m.source_pacer(other),'sharedPacer':m.source_pacer(source) is m.source_pacer(source),'errorClosed':all(fp.closed for fp in failures)}))
`);
  assert.deepEqual(result.starts.map(x => x[1]), [0, 3, 6, 9, 12, 12]);
  assert.deepEqual(result.waits, [2.5, 3, 3, 3]);
  assert.deepEqual(result.handlers, [true, true, true, true, false]);
  assert.equal(result.otherPacer, null); assert.equal(result.sharedPacer, true); assert.equal(result.errorClosed, true);
});

test('one arXiv connection remains exclusive until response close, including concurrently started fetch calls', () => {
  const result = python(`
from unittest.mock import patch
import threading,concurrent.futures
source=next(s for s in m.SOURCES if s['id']=='arxiv-cs-cl')
gate=m.RequestPacer(0,clock=lambda:0,sleeper=lambda seconds:None)
entered=threading.Event();release=threading.Event();attempted=threading.Event();secondOpened=threading.Event()
order=[];active=[0];maximum=[0]
class Response:
 status=200;headers={}
 def __init__(self,url):self.url=url
 def __enter__(self):return self
 def read(self,limit):
  if self.url.endswith('/one'):entered.set();assert release.wait(2)
  return b'metadata'
 def __exit__(self,*args):active[0]-=1;order.append('close:'+self.url.rsplit('/',1)[1])
def attempt(req):
 active[0]+=1;maximum[0]=max(maximum[0],active[0]);order.append('open:'+req.full_url.rsplit('/',1)[1])
 if req.full_url.endswith('/two'):secondOpened.set()
 return Response(req.full_url)
def build(*handlers):
 handler=next(h for h in handlers if isinstance(h,m.PacedHTTPSHandler))
 class Opener:
  def open(self,req,timeout):return handler.https_open(req)
 return Opener()
def second():
 attempted.set();return m.fetch_public('https://rss.arxiv.org/two',source,100,pacer=gate)
with patch.object(m.urllib.request,'build_opener',side_effect=build),patch.object(m.urllib.request.HTTPSHandler,'https_open',side_effect=attempt):
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
  first=executor.submit(m.fetch_public,'https://rss.arxiv.org/one',source,100,pacer=gate)
  assert entered.wait(2)
  later=executor.submit(second);assert attempted.wait(2)
  blocked=not secondOpened.wait(0.03)
  release.set();first.result();later.result()
print(json.dumps({'blocked':blocked,'maximumConnections':maximum[0],'order':order}))
`);
  assert.deepEqual(result, { blocked: true, maximumConnections: 1, order: ['open:one', 'close:one', 'open:two', 'close:two'] });
});

test('new feed empty/error preserves its prior metadata while legacy source identities stay unchanged', t => {
  const w = workspace(t); assert.equal(update(w).status, 0);
  const before = JSON.parse(fs.readFileSync(w.output));
  fs.writeFileSync(path.join(w.dir, 'arxiv-cs-cl.xml'), '<rss><channel/></rss>');
  assert.equal(update(w, next).status, 2);
  const after = JSON.parse(fs.readFileSync(w.output));
  const a = after.sources.find(s => s.id === 'arxiv-cs-cl');
  assert.equal(a.status, 'error'); assert.equal(a.stale, true); assert.equal(a.lastSuccessAt, first); assert.equal(a.lastAttemptAt, next);
  assert.deepEqual(after.articles.filter(a => a.sourceId === 'arxiv-cs-cl'), before.articles.filter(a => a.sourceId === 'arxiv-cs-cl'));
  const identity = c => c.articles.filter(a => ids.slice(0, 5).includes(a.sourceId)).map(a => [a.id, a.sourceId, a.url, a.canonicalUrl]);
  assert.deepEqual(identity(after), identity(before));
  assert.equal(after.sources.find(s => s.id === 'mit-linguistics').status, 'ok');
});
