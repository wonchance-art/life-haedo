/* Public-catalog boundary. Private extraction has separate intake tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../scripts/update-discovery-feed.py');
function python(code) {
  const setup = `import sys,importlib.util,json,copy,hashlib\nsys.dont_write_bytecode=True\ns=importlib.util.spec_from_file_location('feed',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n`;
  const result = spawnSync('python3', ['-c', setup + fixture + code, script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const fixture = `
source=next(s for s in m.SOURCES if s['id']=='frontiers-psychology')
url='https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.12345/full'
now=m.datetime(2026,10,29,12,tzinfo=m.timezone.utc)
rss=('<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Learning study</title><link>'+url+'</link><pubdate>2026-10-28T00:00:00Z</pubdate><author>Min Kim</author><description>PRIVATE_ABSTRACT_SENTINEL</description><content:encoded><![CDATA[<p>PRIVATE_BODY_SENTINEL</p><img src="https://www.frontiersin.org/private-image.png"/>]]></content:encoded></item></channel></rss>').encode()
calls=[]
def fetch(address,config,limit):
 calls.append(address)
 if address.endswith('/robots.txt'): data=b'User-agent: *\\nAllow: /\\n';mime='text/plain'
 elif address==config['feedUrl']:data=rss;mime='application/rss+xml'
 else:raise AssertionError('Public producer requested an article or image')
 return data,{'url':address,'finalUrl':address,'contentType':mime,'sha256':hashlib.sha256(data).hexdigest()}
`;

function metadataOnly(article) {
  assert.equal(article.coverage, 'link_only');
  assert.equal(article.summary, '');
  assert.equal(article.rights.mode, 'metadata_only');
  for (const key of ['bodyText', 'images', 'contentEvidence', 'acquisition', 'privateReader', 'privateReceipt']) assert.equal(Object.hasOwn(article, key), false, key);
}

test('successful public refresh requests only robots and RSS and never copies article payloads', () => {
  const result = python(`s,a,e=m.refresh_one(source,{},now,fetch)\nprint(json.dumps({'source':s,'articles':a,'evidence':e,'calls':calls}))`);
  assert.equal(result.source.status, 'ok');
  assert.equal(result.source.rights.mode, 'metadata_only');
  assert.deepEqual(result.calls, ['https://www.frontiersin.org/robots.txt', 'https://www.frontiersin.org/journals/psychology/rss']);
  assert.equal(result.articles.length, 1);
  metadataOnly(result.articles[0]);
  assert.equal(result.articles[0].author, 'Min Kim');
  assert.equal(result.articles[0].publishedAt, '2026-10-28T00:00:00Z');
  assert.equal(result.evidence.articleContent, undefined);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_.*_SENTINEL|private-image/);
});

for (const failure of ['robots', 'feed', 'parse']) {
  test(`public ${failure} failure retains metadata and success time while removing old body, images and receipts`, () => {
    const result = python(`
s,a,e=m.refresh_one(source,{},now,fetch)
expected=copy.deepcopy(a[0]);old=copy.deepcopy(a[0])
old.update({'coverage':'full_text','summary':'PRIVATE_ABSTRACT_SENTINEL','bodyText':'PRIVATE_BODY_SENTINEL','images':[{'dataBase64':'PRIVATE_IMAGE_SENTINEL'}],'contentEvidence':{'adapter':'frontiers-jats-v1'},'privateReader':True,'privateReceipt':{'contentHash':'PRIVATE_RECEIPT_SENTINEL'},'acquisition':{'mode':'private'}})
old['rights']={'mode':'full_text_allowed','label':'Old license','url':'https://creativecommons.org/licenses/by/4.0/'}
def failed(address,config,limit):
 if '${failure}'=='robots' and address.endswith('/robots.txt'):raise m.FeedError('robots unavailable')
 if '${failure}'=='feed' and address==config['feedUrl']:raise m.FeedError('feed unavailable')
 if '${failure}'=='parse' and address==config['feedUrl']:return b'<rss>broken',{'url':address,'sha256':'fixture'}
 return fetch(address,config,limit)
next_source,next_articles,next_evidence=m.refresh_one(source,{'sources':[s],'articles':[old]},now+m.timedelta(days=1),failed)
print(json.dumps({'source':next_source,'article':next_articles[0],'expected':expected,'evidence':next_evidence}))
`);
    assert.equal(result.source.status, 'error');
    assert.equal(result.source.stale, true);
    assert.equal(result.source.lastSuccessAt, '2026-10-29T12:00:00Z');
    assert.equal(result.source.lastAttemptAt, '2026-10-30T12:00:00Z');
    assert.equal(result.source.rights.mode, 'metadata_only');
    assert.equal(result.evidence.failureStage, failure);
    assert.equal(result.evidence.retainedArticles, 1);
    metadataOnly(result.article);
    assert.deepEqual(result.article, result.expected);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_.*_SENTINEL|frontiers-jats-v1/);
  });
}

test('previous metadata fallback strips private payloads for every registered source', () => {
  const result = python(`
rows=[]
for config in m.SOURCES:
 old={'sourceId':config['id'],'url':'https://'+config['allowedHosts'][0]+'/article','title':'Exact title','author':'Exact author','publishedAt':'2026-10-28T00:00:00Z','dateStatus':'valid','fetchedAt':'2026-10-29T12:00:00Z','summary':'PRIVATE_ABSTRACT_SENTINEL','bodyText':'PRIVATE_BODY_SENTINEL','images':[{}],'contentEvidence':{},'privateReader':True,'privateReceipt':{},'acquisition':{}}
 rows.extend(m.previous_articles({'articles':[old]},config))
print(json.dumps(rows))
`);
  assert.equal(result.length, 9);
  for (const article of result) { metadataOnly(article); assert.equal(article.title, 'Exact title'); assert.equal(article.fetchedAt, '2026-10-29T12:00:00Z'); }
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_.*_SENTINEL/);
});

test('published static catalog contains metadata only across all registered sources', () => {
  const feed = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../assets/life/discovery-feed.json'), 'utf8'));
  const registered = python('print(json.dumps([s["id"] for s in m.SOURCES]))');
  assert.deepEqual(feed.sources.map(source => source.id), registered);
  assert.ok(feed.articles.length > 0);
  assert.ok(feed.sources.every(source => source.rights.mode === 'metadata_only'));
  feed.articles.forEach(metadataOnly);
});
