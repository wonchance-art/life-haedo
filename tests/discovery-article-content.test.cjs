const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../scripts/update-discovery-feed.py');
function python(code) {
  const setup = `import sys,importlib.util,json,copy,hashlib\nsys.dont_write_bytecode=True\ns=importlib.util.spec_from_file_location('feed',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nfrom lib import discovery_article_content as c\n`;
  const result = spawnSync('python3', ['-c', setup + fixture + code, script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const fixture = `
url='https://www.frontiersin.org/articles/10.3389/fpsyg.2026.12345'
xml=b'''<article xmlns:xlink="http://www.w3.org/1999/xlink"><front><article-meta>
<article-id pub-id-type="doi">10.3389/fpsyg.2026.12345</article-id>
<title-group><article-title>Learning study</article-title></title-group>
<contrib-group><contrib contrib-type="author"><name><surname>Kim</surname><given-names>Min</given-names></name></contrib></contrib-group>
<abstract><p>Publisher abstract.</p></abstract>
<permissions><license><ext-link xlink:href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</ext-link></license></permissions>
</article-meta></front><body><sec><title>Results</title><p>Original <italic>paragraph</italic> preserved.</p>
<script>DO_NOT_SHOW</script><table-wrap><label>Table 1</label><table><thead><tr><th colspan="2">Scores</th></tr></thead><tbody><tr><td>First</td><td>12</td></tr><tr><td>Second</td><td>24</td></tr></tbody></table><table-wrap-foot><p>Table note.</p></table-wrap-foot></table-wrap>
<fig><label>Figure 1</label><caption><p>Hypothesis model.</p></caption><graphic xlink:href="fpsyg-17-12345-g001.tif"/></fig>
</sec></body><back><ref-list><ref><label>1</label><mixed-citation>Exact reference.</mixed-citation></ref></ref-list></back>
<sub-article><front><article-meta><contrib-group><contrib contrib-type="author"><name><surname>NOT_AUTHOR</surname></name></contrib></contrib-group></article-meta></front><body><p>NOT_BODY</p></body></sub-article></article>'''
source=next(s for s in m.SOURCES if s['id']=='frontiers-psychology')
now=m.datetime(2026,10,29,12,tzinfo=m.timezone.utc)
rss=('<rss><channel><item><title>Learning study</title><link>'+url+'</link><pubdate>2026-10-28T00:00:00Z</pubdate><author>Min Kim</author><description>Publisher abstract.</description></item></channel></rss>').encode()
png=bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082')
`;

test('Frontiers JATS preserves article scope, paragraphs, table cells, notes, references and figure position', () => {
  const result = python(`a,images=c.parse_frontiers_xml(xml,url)\nprint(json.dumps({'article':a,'images':images,'xmlUrl':c.frontiers_xml_url(url)}))`);
  assert.equal(result.xmlUrl, 'https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.12345/xml');
  assert.equal(result.article.coverage, 'full_text');
  assert.equal(result.article.summary, 'Publisher abstract.');
  assert.match(result.article.bodyText, /Original paragraph preserved\./);
  assert.match(result.article.bodyText, /Scores \| \n\nFirst \| 12\n\nSecond \| 24/);
  assert.match(result.article.bodyText, /Table note\./);
  assert.match(result.article.bodyText, /Exact reference\./);
  assert.match(result.article.rights.label, /Min Kim/);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_SHOW|NOT_AUTHOR|NOT_BODY/);
  assert.equal(result.images.length, 1);
  assert.equal(result.article.bodyText.split('\n\n')[result.images[0].afterParagraph], 'Figure 1 Hypothesis model.');
});

test('only matching DOI and explicit article CC BY 4.0 permit full text; arbitrary DTD/entities remain blocked', () => {
  const result = python(`
bad=[xml.replace(b'licenses/by/4.0/',b'licenses/by-nc/4.0/'),xml.replace(b'2026.12345</article-id>',b'2026.54321</article-id>'),b'<!DOCTYPE article SYSTEM "https://evil.invalid/x">'+xml,b'<!DOCTYPE article [<!ENTITY x "bad">]>'+xml,xml.replace(b'<body>',b'<body>&x;'),xml.replace(b'contrib-type="author"',b'contrib-type="editor"')]
rejected=[]
for data in bad:
 try:c.parse_frontiers_xml(data,url);rejected.append(False)
 except c.ArticleContentError:rejected.append(True)
print(json.dumps(rejected))
`);
  assert.deepEqual(result, [true, true, true, true, true, true]);
});

test('mathematical or oversized body is an honest publisher abstract rather than truncated full text', () => {
  const result = python(`
values=[]
for data in [xml.replace(b'<body>',b'<body><disp-formula><tex-math>x+y</tex-math></disp-formula>'),xml.replace(b'Original ',b'x'*200001)]:
 a,_=c.parse_frontiers_xml(data,url);values.append(a)
print(json.dumps(values))
`);
  assert.ok(result.every(a => a.coverage === 'summary' && !Object.hasOwn(a, 'bodyText') && a.summary === 'Publisher abstract.'));
});

test('unknown third-party figure credit is excluded while article text remains available', () => {
  const result = python(`
values=[]
for note in [b'Adapted from another work.',b'Courtesy of an author.',b'Third-party illustration.',b'Reproduced with permission.']:
 a,images=c.parse_frontiers_xml(xml.replace(b'Hypothesis model.',note),url);values.append([a['coverage'],len(images)])
a,images=c.parse_frontiers_xml(xml.replace(b'<graphic ',b'<attrib>Other owner</attrib><graphic '),url);values.append([a['coverage'],len(images)])
print(json.dumps(values))
`);
  assert.deepEqual(result, Array.from({ length: 5 }, () => ['full_text', 0]));
});

test('RSS abstract strips executable/hidden fragments and keeps paragraph boundaries without truncating content', () => {
  const result = python(`print(json.dumps([c.rss_abstract('<p>First <b>paragraph</b>.</p><script>BAD</script><div hidden>HIDDEN</div><p>Second.</p>'),c.rss_abstract('x'*50001)]))`);
  assert.deepEqual(result, ['First paragraph.\n\nSecond.', '']);
});

test('image bytes require declared raster format, bounded size and bounded dimensions', () => {
  const result = python(`
_,candidates=c.parse_frontiers_xml(xml,url)
valid=c.image_payload(png,'image/png',candidates[0])
bad=[(b'<svg/>','image/svg+xml'),(png,'image/jpeg'),(png[:16]+(5000).to_bytes(4,'big')+png[20:],'image/png'),(b'x'*(c.MAX_IMAGE_BYTES+1),'image/png')]
rejected=[]
for data,mime in bad:
 try:c.image_payload(data,mime,candidates[0]);rejected.append(False)
 except c.ArticleContentError:rejected.append(True)
print(json.dumps({'valid':valid['mimeType'],'rejected':rejected}))
`);
  assert.equal(result.valid, 'image/png');
  assert.deepEqual(result.rejected, [true, true, true, true]);
});

test('article refresh checks robots, keeps good text through image errors, and retains exact previous text through XML failure', () => {
  const result = python(`
calls=[]
def fetch(url,source,limit):
 calls.append(url)
 if url.endswith('/robots.txt'):data=b'User-agent: *\\nAllow: /\\n';mime='text/plain'
 elif url.endswith('/rss'):data=rss;mime='application/xml'
 elif url.endswith('/xml'):data=xml;mime='text/xml'
 else:raise m.FeedError('image failed')
 return data,{'url':url,'finalUrl':url,'contentType':mime,'sha256':hashlib.sha256(data).hexdigest()}
s,a,e=m.refresh_one(source,{},now,fetch)
previous={'sources':[s],'articles':a}
def failed(url,source,limit):
 if url.endswith('/xml'):raise m.FeedError('XML unavailable')
 return fetch(url,source,limit)
s2,a2,e2=m.refresh_one(source,previous,now+m.timedelta(days=1),failed)
changed=copy.deepcopy(previous);changed['articles'][0]['bodyText']='injected body'
s3,a3,e3=m.refresh_one(source,changed,now+m.timedelta(days=1),failed)
print(json.dumps({'first':a[0],'next':a2[0],'bad':a3[0],'robotsFetches':sum(x.endswith('/robots.txt') for x in calls),'status':s2['status'],'stale':s2['stale'],'retained':e2['articleContent'][0].get('retainedContent')}))
`);
  assert.equal(result.first.coverage, 'full_text');
  assert.equal(result.first.images, undefined);
  assert.equal(result.next.bodyText, result.first.bodyText);
  assert.equal(result.next.contentEvidence.checkedAt, result.first.contentEvidence.checkedAt);
  assert.equal(result.status, 'ok');
  assert.equal(result.stale, true);
  assert.equal(result.next.fetchedAt, result.first.fetchedAt);
  assert.equal(result.retained, true);
  assert.equal(result.bad.coverage, 'summary');
  assert.equal(result.bad.bodyText, undefined);
  assert.equal(result.robotsFetches, 3);
});

test('matching older full text survives the three-request window; changed editions and text budget use current abstract', () => {
  const result = python(`
old=m.parse_feed(rss,source,now)[0][0]
payload,_=c.parse_frontiers_xml(xml,url);old.update(payload);m.mark_content(old,m.FRONTIERS_ADAPTER,old['canonicalUrl'],now)
fresh=m.parse_feed(rss,source,now+m.timedelta(days=1))[0][0]
newer=[]
for i in range(3):
 a=copy.deepcopy(fresh);a.update({'id':'new-'+str(i),'url':url+'1'+str(i),'canonicalUrl':url+'1'+str(i)});newer.append(a)
def fail(*args):raise m.FeedError('offline')
previous={'articles':[old]}
kept=m.enrich_articles(copy.deepcopy(newer+[fresh]),source,previous,now,fail,{})[-1]
changed=copy.deepcopy(fresh);changed['title']='New edition'
not_reused=m.enrich_articles(copy.deepcopy(newer+[changed]),source,previous,now,fail,{})[-1]
m.MAX_FRONTIERS_TEXT_BYTES=1
budget=m.enrich_articles(copy.deepcopy(newer+[fresh]),source,previous,now,fail,{})[-1]
print(json.dumps({'kept':kept,'changed':not_reused,'budget':budget,'old':old['fetchedAt'],'fresh':fresh['fetchedAt']}))
`);
  assert.equal(result.kept.coverage, 'full_text');
  assert.equal(result.kept.fetchedAt, result.old);
  assert.equal(result.changed.coverage, 'summary');
  assert.equal(result.budget.coverage, 'summary');
  assert.equal(result.budget.bodyText, undefined);
  assert.equal(result.budget.fetchedAt, result.fresh);
});

test('previous image reuse stays with the exact article DOI and never moves a different article figure', () => {
  const result = python(`
a=m.parse_feed(rss,source,now)[0][0];payload,candidates=c.parse_frontiers_xml(xml,url);a.update(payload)
image=c.image_payload(png,'image/png',candidates[0]);a['images']=[image];m.mark_content(a,m.FRONTIERS_ADAPTER,a['canonicalUrl'],now)
good=m.retained_content(a,source)
a['images'][0]['sourceUrl']=a['images'][0]['sourceUrl'].replace('12345','54321')
bad=m.retained_content(a,source)
print(json.dumps({'good':len(good.get('images',[])),'bad':len(bad.get('images',[])),'bodyKept':bad.get('bodyText')==good.get('bodyText')}))
`);
  assert.deepEqual(result, { good: 1, bad: 0, bodyKept: true });
});

test('robots denial prevents article and redirected image requests before connection', () => {
  const result = python(`
calls=[]
def fetch(url,source,limit):
 calls.append(url)
 if url.endswith('/robots.txt'):data=b'User-agent: *\\nDisallow: /journals/psychology/articles/\\n';mime='text/plain'
 else:data=rss;mime='application/xml'
 return data,{'url':url,'finalUrl':url,'contentType':mime,'sha256':hashlib.sha256(data).hexdigest()}
s,a,e=m.refresh_one(source,{},now,fetch)
blocked=False
def policy(url):raise m.FeedError('robots denied')
try:m.RestrictedRedirect(['www.frontiersin.org'],policy).redirect_request(m.urllib.request.Request('https://www.frontiersin.org/image'),None,302,'',{},'https://www.frontiersin.org/blocked')
except m.FeedError:blocked=True
print(json.dumps({'coverage':a[0]['coverage'],'requests':calls,'blocked':blocked}))
`);
  assert.equal(result.coverage, 'summary');
  assert.equal(result.requests.length, 2);
  assert.equal(result.blocked, true);
});
