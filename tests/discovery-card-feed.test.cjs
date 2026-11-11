/* 2026-11-11 뉴스 카드 피드 1단계: 공개 목록의 두 구간 형식, 기사 이미지 주소, 표시 상한, 기사 이미지 보기 설정.
 * 합성 고정 피드만 쓴다. 실제 출처·네트워크·Git 기록을 쓰지 않는다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const Discovery = require('../assets/life/discovery.js');
const Settings = require('../assets/life/discovery-settings.js');
const CI = require('../scripts/refresh-discovery-artifact.cjs');

const script = path.resolve(__dirname, '../scripts/update-discovery-feed.py');
const NOW = '2026-11-11T03:00:00Z', LATER = '2026-11-12T03:00:00Z';
const stamp = () => Date.parse(LATER);
const bytes = value => Buffer.from(JSON.stringify(value));

// The validator exactly as shipped before this change (tests/fixtures/discovery-old-client/README.md).
function oldValidator() {
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/discovery-old-client/discovery.js.gz')));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), 'ee284b29696fc6fdaadf8efc63cd2ebf4305030514411150e009fa2321ff234b');
  // Its own realm, as in a page: values cross as JSON so the validator's plain-object checks see its own prototypes.
  const sandbox = vm.createContext({ TextEncoder, URL, AbortController }); vm.runInContext(raw.toString('utf8'), sandbox);
  const api = vm.runInContext('HaedoLife.Discovery', sandbox), parse = vm.runInContext('JSON.parse', sandbox), inside = value => parse(JSON.stringify(value));
  const outside = run => { try { return JSON.parse(JSON.stringify(run())); } catch (error) { throw Object.assign(new Error(error.message), { code: error.code }); } };
  return { validateFeed: (input, options) => outside(() => api.validateFeed(inside(input), inside(options))), rank: (input, options) => outside(() => api.rank(inside(input), inside(options))) };
}
function catalog() {
  const rights = { mode: 'metadata_only', label: '합성 제목·링크', url: null };
  const source = (id, images) => ({ id, name: id, url: `https://${Discovery.ALLOWED_SOURCES[id][0]}/`, feedUrl: `https://${Discovery.ALLOWED_SOURCES[id][0]}/feed`, language: 'ko', rights,
    ...(images ? { images: { label: '합성 이미지 주소 안내', url: null } } : {}), status: 'ok', lastSuccessAt: NOW, lastAttemptAt: NOW, fetchedAt: NOW, error: null, stale: false });
  const article = (sourceId, n, imageUrl) => ({ id: `card-${sourceId}-${n}`, sourceId, url: `https://${Discovery.ALLOWED_SOURCES[sourceId][0]}/post/${sourceId}-${n}`, title: `합성 기사 ${sourceId} ${n}`,
    publishedAt: NOW, author: null, language: 'ko', tags: [], summary: '', coverage: 'link_only', rights, fetchedAt: NOW, ...(imageUrl === undefined ? {} : { imageUrl }) });
  return { schemaVersion: 1, generatedAt: NOW,
    sources: Discovery.LEGACY_SOURCE_IDS.map(id => source(id, id === 'mit-linguistics')),
    articles: [...Discovery.LEGACY_SOURCE_IDS.map(id => article(id, 1)), article('mit-linguistics', 2, 'https://news.mit.edu/sites/default/files/images/synthetic.jpg')],
    extended: { sources: Discovery.EXTENDED_SOURCE_IDS.map(id => source(id, Object.hasOwn(Discovery.IMAGE_HOSTS, id))),
      articles: [...Discovery.EXTENDED_SOURCE_IDS.map(id => article(id, 1)), article('yna-news', 2, 'https://img.yna.co.kr/photo/synthetic.jpg')] } };
}

test('one catalog carries the first registry and the later sources; the validator reads both as one list', () => {
  const input = catalog(), checked = Discovery.validateFeed(input, { now: LATER });
  assert.deepEqual(checked.sources.map(source => source.id), [...Discovery.LEGACY_SOURCE_IDS, ...Discovery.EXTENDED_SOURCE_IDS]);
  assert.equal(checked.articles.length, input.articles.length + input.extended.articles.length);
  assert.equal(checked.validation.invalid.length, 0); assert.equal(Object.hasOwn(checked, 'extended'), false);
  // The list re-validates its own filtered result, so a merged catalog must be valid input as well.
  assert.equal(Discovery.validateFeed(checked, { now: LATER }).articles.length, checked.articles.length);
  assert.equal(Discovery.LEGACY_SOURCE_IDS.length, 9); assert.ok(Discovery.EXTENDED_SOURCE_IDS.length >= 15);
  assert.deepEqual(Object.keys(Discovery.ALLOWED_SOURCES), [...Discovery.LEGACY_SOURCE_IDS, ...Discovery.EXTENDED_SOURCE_IDS]);
  // A catalog published before this change (no `extended`, no image field) is still the same valid catalog.
  const before = structuredClone(input); delete before.extended; before.articles.pop(); for (const source of before.sources) delete source.images;
  assert.equal(Discovery.validateFeed(before, { now: LATER }).articles.length, 9);
  for (const broken of [{ extended: [] }, { extended: { sources: [] } }, { extended: { sources: {}, articles: [] } }]) assert.throws(() => Discovery.validateFeed({ ...input, ...broken }, { now: LATER }), { code: 'discovery_feed_invalid' });
  const duplicated = structuredClone(input); duplicated.extended.sources.push(structuredClone(duplicated.sources[0]));
  assert.throws(() => Discovery.validateFeed(duplicated, { now: LATER }), { code: 'discovery_feed_invalid' });
});

test('the validator shipped before this change still lists the first registry from a new catalog', () => {
  const old = oldValidator(), input = catalog(), checked = old.validateFeed(input, { now: LATER });
  assert.deepEqual(checked.sources.map(source => source.id), Discovery.LEGACY_SOURCE_IDS);
  assert.equal(checked.articles.length, input.articles.length); assert.ok(checked.articles.length > 0);
  assert.equal(checked.validation.invalid.length, 0);
  assert.ok(checked.articles.every(article => !Object.hasOwn(article, 'imageUrl')), 'the older validator leaves the unknown image field out');
  assert.equal(old.rank(input, { now: LATER, mode: 'latest', profile: { manual: [] }, feedback: [], knownUrls: [] }).items.length, 5);
  // Why the later sources live in `extended`: one unknown id in `sources` empties the older screen's whole list.
  const flat = structuredClone(input); flat.sources.push(flat.extended.sources[0]); flat.articles.push(flat.extended.articles[0]); delete flat.extended;
  assert.throws(() => old.validateFeed(flat, { now: LATER }), { code: 'discovery_feed_invalid' });
  assert.doesNotThrow(() => Discovery.validateFeed(flat, { now: LATER }));
});

test('an article image is a link on the source\'s registered image host; anything else drops the image, never the article', () => {
  const hosts = Discovery.IMAGE_HOSTS['yna-news'];
  assert.equal(Discovery.imageUrl('https://img.yna.co.kr/a/b.jpg?w=640', hosts), 'https://img.yna.co.kr/a/b.jpg?w=640');
  for (const bad of ['http://img.yna.co.kr/a.jpg', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'https://user:pass@img.yna.co.kr/a.jpg', 'https://img.yna.co.kr:8443/a.jpg',
    'https://other.example/a.jpg', 'https://img.yna.co.kr.evil.example/a.jpg', 'https://127.0.0.1/a.jpg', 'https://localhost/a.jpg', 'https://img.yna.co.kr/a b.jpg', '//img.yna.co.kr/a.jpg',
    'https://img.yna.co.kr/' + 'a'.repeat(2048), '', null, undefined, 42, ['https://img.yna.co.kr/a.jpg']]) assert.equal(Discovery.imageUrl(bad, hosts), null, String(bad).slice(0, 40));
  assert.equal(Discovery.imageUrl('https://img.yna.co.kr/a.jpg', undefined), null);
  const input = catalog(), id = 'card-yna-news-2';
  const image = value => { const next = structuredClone(input); next.extended.articles.find(article => article.id === id).imageUrl = value; return Discovery.validateFeed(next, { now: LATER }); };
  assert.equal(image('https://img.yna.co.kr/photo/synthetic.jpg').articles.find(article => article.id === id).imageUrl, 'https://img.yna.co.kr/photo/synthetic.jpg');
  for (const bad of ['data:image/png;base64,AAAA', 'http://img.yna.co.kr/a.jpg', 'https://tracker.example/pixel.gif', 7, null]) {
    const checked = image(bad), article = checked.articles.find(value => value.id === id);
    assert.ok(article, 'article kept'); assert.equal(Object.hasOwn(article, 'imageUrl'), false); assert.equal(checked.validation.invalid.length, 0);
  }
  // A source without reviewed image terms never shows an image, whatever the catalog says.
  const unreviewed = structuredClone(input); delete unreviewed.extended.sources.find(source => source.id === 'yna-news').images;
  assert.equal(Object.hasOwn(Discovery.validateFeed(unreviewed, { now: LATER }).articles.find(article => article.id === id), 'imageUrl'), false);
  const terms = Discovery.validateFeed(input, { now: LATER }).sources.find(source => source.id === 'yna-news').images;
  assert.deepEqual(terms, { label: '합성 이미지 주소 안내', url: null });
  const badTerms = structuredClone(input); badTerms.extended.sources.find(source => source.id === 'yna-news').images = { label: '', url: null };
  assert.throws(() => Discovery.validateFeed(badTerms, { now: LATER }), { code: 'discovery_feed_invalid' });
  // An injected test registry carries no image hosts unless it names them.
  assert.equal(Discovery.validateFeed(input, { now: LATER, allowedSources: Discovery.ALLOWED_SOURCES }).articles.some(article => article.imageUrl), false);
});

test('a list may ask for every candidate; the default result size stays five', () => {
  const input = catalog(), options = { now: LATER, mode: 'latest', profile: { manual: [] }, feedback: [], knownUrls: [] };
  const total = input.articles.length + input.extended.articles.length;
  assert.equal(Discovery.rank(input, options).items.length, 5);
  assert.equal(Discovery.LIMITS.matches, 5);
  const every = Discovery.rank(input, { ...options, limit: Discovery.LIMITS.articles });
  assert.equal(every.items.length, total); assert.equal(every.eligibleCount, total);
  assert.equal(Discovery.rank(input, { ...options, limit: 20 }).items.length, 20);
  for (const limit of [0, -1, 1.5, Discovery.LIMITS.articles + 1, '20']) assert.throws(() => Discovery.rank(input, { ...options, limit }), { code: 'discovery_feed_invalid' });
});

test('a reading comparison still starts with every added source; image links stay out of what it freezes', async () => {
  const Reading = require('../assets/life/discovery-reading.js');
  // What the list hands over: the validated catalog (all sources in one list) without image links or their terms.
  const feed = Discovery.validateFeed(catalog(), { now: LATER });
  assert.ok(feed.sources.length > 20, 'more sources than the earlier comparison bound');
  for (const source of feed.sources) delete source.images;
  for (const article of feed.articles) delete article.imageUrl;
  const input = { feed, profile: { workspaceId: 'workspace-a', revision: 1, manual: [{ id: 'manual-a', label: '합성' }] }, feedback: [], knownUrls: [], contentLanguages: null, actions: null, translationTarget: 'original', personalAllowed: false, baselineMode: 'latest' };
  const result = await Reading.createComparison(Reading.empty('workspace-a'), input, { expectedRevision: 0, now: LATER, sessionId: 'card-feed-session' });
  assert.ok(Reading.validate(result));
  assert.deepEqual(result.session.conditions.sourceIds, Object.keys(Discovery.ALLOWED_SOURCES));
  assert.equal(result.session.lists.latest.length, 2); assert.equal(result.session.lists.related.length, 2);
  assert.equal(JSON.stringify(result).includes('imageUrl') || JSON.stringify(result).includes('"images"'), false);
  // The comparison's own contract is unchanged: it refuses a catalog that still carries image fields.
  const withImages = { ...input, feed: Discovery.validateFeed(catalog(), { now: LATER }) };
  await assert.rejects(Reading.createComparison(Reading.empty('workspace-a'), withImages, { expectedRevision: 0, now: LATER, sessionId: 'card-feed-session' }), { code: 'discovery_reading_invalid' });
});

// The settings model exactly as shipped before this change (tests/fixtures/discovery-old-client/README.md).
function oldSettings() {
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/discovery-old-client/discovery-settings.js.gz')));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), 'f6d8f710d848b15ec4b9fa4f7df2b5e295fcac5a2d1b05aee4737110606708bc');
  const sandbox = vm.createContext({ TextEncoder, structuredClone }); vm.runInContext(raw.toString('utf8'), sandbox);
  const api = vm.runInContext('HaedoLife.DiscoverySettings', sandbox), parse = vm.runInContext('JSON.parse', sandbox), inside = value => parse(JSON.stringify(value));
  const outside = run => { try { return JSON.parse(JSON.stringify(run())); } catch (error) { throw Object.assign(new Error(error.message), { code: error.code }); } };
  return { validate: value => outside(() => api.validate(inside(value))), update: (current, patch, options) => outside(() => api.update(inside(current), inside(patch), inside(options))) };
}

test('기사 이미지 보기 and 넓게 찾기 are account options, off until chosen, in a form the earlier settings model reads and keeps', () => {
  const empty = Settings.empty('workspace-a'), old = oldSettings();
  assert.equal(Settings.DEFAULT_SHOW_IMAGES, false); assert.equal(Settings.DEFAULT_WIDE_SEARCH, false);
  assert.equal(Settings.showImages(empty), false); assert.equal(Settings.wideSearch(empty), false);
  const on = Settings.update(empty, { showImages: true }, { expectedRevision: 0, now: NOW });
  assert.equal(Settings.showImages(on), true); assert.equal(Settings.wideSearch(on), false); assert.doesNotThrow(() => Settings.validate(on));
  // No new field: the stored keys are the first format's, and the choice is a reserved entry of disabledSourceIds.
  assert.deepEqual(Object.keys(on), Object.keys(empty)); assert.deepEqual(on.disabledSourceIds, ['option-images-on']);
  const both = Settings.update(on, { wideSearch: true, disabledSourceIds: ['yna-news'] }, { expectedRevision: 1, now: LATER });
  assert.equal(Settings.showImages(both), true); assert.equal(Settings.wideSearch(both), true);
  assert.deepEqual(Settings.disabledSources(both), ['yna-news'], 'the reserved entries are not sources');
  const off = Settings.update(both, { showImages: false }, { expectedRevision: 2, now: LATER });
  assert.equal(Settings.showImages(off), false); assert.equal(Settings.wideSearch(off), true); assert.deepEqual(Settings.disabledSources(off), ['yna-news']);
  // An explicit off is stored, so a later change of the default does not turn it on.
  assert.ok(off.disabledSourceIds.includes('option-images-off') && !off.disabledSourceIds.includes('option-images-on'));
  // Another setting, or a new source selection, keeps the stored options.
  assert.equal(Settings.showImages(Settings.update(on, { autoRefresh: true }, { expectedRevision: 1, now: LATER })), true);
  const reselected = Settings.update(both, { disabledSourceIds: [] }, { expectedRevision: 2, now: LATER });
  assert.equal(Settings.showImages(reselected), true); assert.equal(Settings.wideSearch(reselected), true); assert.deepEqual(Settings.disabledSources(reselected), []);
  assert.deepEqual(Settings.update(empty, { autoRefresh: true }, { expectedRevision: 0, now: NOW }).disabledSourceIds, []);
  // The earlier model accepts these settings and keeps the options when it saves a change of its own
  // (it copies the stored list and only toggles the ids it knows).
  for (const value of [on, both, off]) assert.doesNotThrow(() => old.validate(value));
  const olderEdit = old.update(both, { autoRefresh: both.autoRefresh, disabledInterestIds: [], disabledSourceIds: [...both.disabledSourceIds, 'seoul-culture'] }, { expectedRevision: both.revision, now: LATER });
  assert.equal(Settings.showImages(olderEdit), true); assert.equal(Settings.wideSearch(olderEdit), true); assert.deepEqual(Settings.disabledSources(olderEdit), ['yna-news', 'seoul-culture']);
  // A new field, by contrast, is what the earlier model refuses (the form this work first used and dropped).
  assert.throws(() => old.validate({ ...on, showImages: true }), { code: 'discovery_settings_invalid' });
  assert.throws(() => Settings.validate({ ...on, showImages: true }), { code: 'discovery_settings_invalid' });
  // Bounds: never both on and off, booleans only, a later version's reserved entry is kept untouched, no source uses the prefix.
  assert.throws(() => Settings.validate({ ...on, disabledSourceIds: ['option-images-on', 'option-images-off'] }), { code: 'discovery_settings_invalid' });
  for (const value of ['yes', 1, null]) assert.throws(() => Settings.update(empty, { showImages: value }, { expectedRevision: 0, now: NOW }), { code: 'discovery_settings_invalid' });
  const later = { ...on, disabledSourceIds: ['option-images-on', 'option-later-on'] };
  assert.doesNotThrow(() => Settings.validate(later)); assert.ok(Settings.update(later, { wideSearch: true }, { expectedRevision: 1, now: LATER }).disabledSourceIds.includes('option-later-on'));
  assert.equal(Object.keys(Discovery.ALLOWED_SOURCES).some(id => id.startsWith('option-')), false);
  // Settings saved before these options keep validating exactly as they were; a reset clears the options too.
  assert.doesNotThrow(() => Settings.validate({ schemaVersion: 1, workspaceId: 'workspace-a', revision: 3, deleted: false, updatedAt: NOW, autoRefresh: true, disabledInterestIds: ['a'], disabledSourceIds: ['naver-d2'] }));
  const cleared = Settings.clear(both, { expectedRevision: 2, now: LATER }); assert.deepEqual(cleared.disabledSourceIds, []); assert.equal(Settings.showImages(cleared), false); assert.equal(Settings.wideSearch(cleared), false);
  assert.equal(Settings.showImages(null), false); assert.equal(Settings.wideSearch(undefined), false);
});

// --- collector -----------------------------------------------------------------------------------
const MEDIA = 'xmlns:media="http://search.yahoo.com/mrss/"';
function python(code) {
  const bootstrap = `import sys,importlib.util,json\nsys.dont_write_bytecode=True\ns=importlib.util.spec_from_file_location('feed',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n`;
  const p = spawnSync('python3', ['-c', bootstrap + code, script], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  return JSON.parse(p.stdout);
}
function workspace(t, feeds = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haedo-card-feed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [id, hosts] of Object.entries(Discovery.ALLOWED_SOURCES)) {
    fs.writeFileSync(path.join(dir, `${id}.robots.txt`), 'User-agent: *\nAllow: /\n');
    if (feeds[id] === null) continue;
    fs.writeFileSync(path.join(dir, `${id}.xml`), feeds[id] || `<rss version="2.0"><channel><item><title>합성 글 ${id}</title><link>https://${hosts[0]}/post/1</link><pubDate>Tue, 10 Nov 2026 05:00:35 +0000</pubDate></item></channel></rss>`);
  }
  return { dir, output: path.join(dir, 'catalog.json'), report: path.join(dir, 'report.json') };
}
function update(w, now = NOW) {
  const p = spawnSync('python3', [script, '--output', w.output, '--report', w.report, '--fixtures', w.dir, '--now', now], { encoding: 'utf8' });
  assert.equal(p.error, undefined);
  return p;
}
const item = (host, n, extra = '') => `<item><title>합성 글 ${n}</title><link>https://${host}/post/${n}</link><pubDate>Tue, 10 Nov 2026 0${n}:00:00 +0000</pubDate>${extra}</item>`;

test('browser, collector and CI registries name the same sources, hosts and image hosts', () => {
  const sources = python(`print(json.dumps([{k:s.get(k) for k in ('id','allowedHosts','images','rights')} for s in m.SOURCES]+[list(m.LEGACY_SOURCE_IDS)]))`);
  const legacy = sources.pop();
  assert.deepEqual(legacy, Discovery.LEGACY_SOURCE_IDS);
  assert.deepEqual(sources.map(source => source.id), Object.keys(Discovery.ALLOWED_SOURCES));
  const imageHosts = {};
  for (const source of sources) {
    assert.deepEqual(source.allowedHosts, Discovery.ALLOWED_SOURCES[source.id]);
    assert.equal(source.rights.mode, 'metadata_only');
    if (source.images) { imageHosts[source.id] = source.images.hosts; assert.ok(source.images.label.length > 10 && /^https:\/\//.test(source.images.url), 'image terms are stated with their source'); }
  }
  assert.deepEqual(imageHosts, Object.fromEntries(Object.entries(Discovery.IMAGE_HOSTS).map(([id, hosts]) => [id, [...hosts]])));
});

test('the collector keeps only the image address the feed itself names, on the registered host', t => {
  const yna = 'www.yna.co.kr', w = workspace(t, {
    'yna-news': `<rss version="2.0" ${MEDIA}><channel>` +
      item(yna, 1, '<media:content url="https://img.yna.co.kr/photo/one.jpg" type="image/jpeg"/><description>&lt;img src="https://img.yna.co.kr/photo/body.jpg"&gt; PRIVATE_BODY_SENTINEL</description>') +
      item(yna, 2, '<media:thumbnail url="https://img.yna.co.kr/photo/two.jpg?w=640&amp;h=360"/>') +
      item(yna, 3, '<enclosure url="https://img.yna.co.kr/photo/three.png" type="image/png" length="1"/>') +
      item(yna, 4, '<media:content url="http://img.yna.co.kr/photo/plain-http.jpg" medium="image"/>') +
      item(yna, 5, '<media:content url="data:image/png;base64,AAAA" medium="image"/>') +
      item(yna, 6, '<media:content url="https://tracker.example/pixel.gif" medium="image"/><media:thumbnail url="https://img.yna.co.kr/photo/six.jpg"/>') +
      item(yna, 7, '<enclosure url="https://img.yna.co.kr/audio/seven.mp3" type="audio/mpeg" length="1"/><media:content url="https://img.yna.co.kr/video/seven.mp4" medium="video"/>') +
      item(yna, 8, '<description>&lt;img src="https://img.yna.co.kr/photo/only-in-body.jpg"&gt;</description>') +
      item(yna, 9, '<media:content url="https://user:secret@img.yna.co.kr/photo/nine.jpg" medium="image"/>') + '</channel></rss>',
    // A source without reviewed image terms: the same feed markup yields no image.
    'nocut-news': `<rss version="2.0" ${MEDIA}><channel>` + item('www.nocutnews.co.kr', 1, '<media:content url="https://img.yna.co.kr/photo/one.jpg" medium="image"/><enclosure url="https://www.nocutnews.co.kr/a.jpg" type="image/jpeg" length="1"/>') + '</channel></rss>',
    'global-voices': `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Synthetic atom</title><link href="https://globalvoices.org/2026/11/10/synthetic/"/><link rel="enclosure" type="image/jpeg" href="https://globalvoices.org/wp-content/uploads/synthetic.jpg"/><published>2026-11-10T05:00:00Z</published></entry></feed>`,
  });
  assert.equal(update(w).status, 0);
  const text = fs.readFileSync(w.output, 'utf8'), c = JSON.parse(text);
  const image = n => c.extended.articles.find(article => article.sourceId === 'yna-news' && article.url.endsWith('/post/' + n)).imageUrl;
  assert.equal(image(1), 'https://img.yna.co.kr/photo/one.jpg');
  assert.equal(image(2), 'https://img.yna.co.kr/photo/two.jpg?w=640&h=360');
  assert.equal(image(3), 'https://img.yna.co.kr/photo/three.png');
  assert.equal(image(6), 'https://img.yna.co.kr/photo/six.jpg', 'an unregistered host is skipped for the next named image');
  for (const n of [4, 5, 7, 8, 9]) assert.equal(image(n), undefined, 'item ' + n);
  assert.equal(Object.hasOwn(c.extended.articles.find(article => article.sourceId === 'nocut-news'), 'imageUrl'), false);
  assert.equal(c.extended.articles.find(article => article.sourceId === 'global-voices').imageUrl, 'https://globalvoices.org/wp-content/uploads/synthetic.jpg');
  for (const leaked of ['PRIVATE_BODY_SENTINEL', 'body.jpg', 'only-in-body', 'tracker.example', 'data:image', 'secret@', 'plain-http']) assert.equal(text.includes(leaked), false, leaked);
  assert.deepEqual(c.extended.sources.find(source => source.id === 'yna-news').images, python(`print(json.dumps({k:v for k,v in next(s for s in m.SOURCES if s['id']=='yna-news')['images'].items() if k!='hosts'}))`));
  assert.equal(Object.hasOwn(c.extended.sources.find(source => source.id === 'nocut-news'), 'images'), false);
  assert.equal(JSON.parse(fs.readFileSync(w.report)).imageCount, 5);
  // The published result is what the browser and the Pages gate accept, images included.
  const checked = Discovery.validateFeed(c, { now: LATER });
  assert.equal(checked.articles.filter(article => article.imageUrl).length, 5);
  assert.doesNotThrow(() => CI.validateCatalog(Buffer.from(text), stamp()));
  for (const article of [...c.articles, ...c.extended.articles]) for (const key of ['description', 'content', 'bodyText']) assert.equal(Object.hasOwn(article, key), false);
});

test('an image repeated across one feed is a logo and is removed from every entry', t => {
  const logo = '<media:thumbnail url="https://img.sbs.co.kr/news/logo-default.png"/>';
  const w = workspace(t, { 'sbs-news': `<rss version="2.0" ${MEDIA}><channel>` + item('news.sbs.co.kr', 1, logo) + item('news.sbs.co.kr', 2, '<media:thumbnail url="https://img.sbs.co.kr/news/own-two.jpg"/>') + item('news.sbs.co.kr', 3, logo) + '</channel></rss>' });
  assert.equal(update(w).status, 0);
  const rows = JSON.parse(fs.readFileSync(w.output)).extended.articles.filter(article => article.sourceId === 'sbs-news');
  assert.deepEqual(rows.map(article => [article.url.slice(-1), article.imageUrl]).sort(), [['1', undefined], ['2', 'https://img.sbs.co.kr/news/own-two.jpg'], ['3', undefined]]);
});

test('later sources are published in `extended`; a failing one keeps its last image and stays out of the first part', t => {
  const mit = `<rss version="2.0" ${MEDIA}><channel>` + item('news.mit.edu', 1, '<media:content url="https://news.mit.edu/sites/default/files/images/one.jpg" medium="image"/>') + '</channel></rss>';
  const w = workspace(t, { 'mit-news': mit, 'mit-linguistics': mit.replace('/post/1', '/post/linguistics') });
  assert.equal(update(w).status, 0);
  const first = JSON.parse(fs.readFileSync(w.output));
  assert.deepEqual(first.sources.map(source => source.id), Discovery.LEGACY_SOURCE_IDS);
  assert.deepEqual(first.extended.sources.map(source => source.id), Discovery.EXTENDED_SOURCE_IDS);
  assert.ok(first.articles.every(article => Discovery.LEGACY_SOURCE_IDS.includes(article.sourceId)) && first.extended.articles.every(article => Discovery.EXTENDED_SOURCE_IDS.includes(article.sourceId)));
  assert.equal(first.articles.find(article => article.sourceId === 'mit-linguistics').imageUrl, 'https://news.mit.edu/sites/default/files/images/one.jpg', 'a first-registry source may carry an image link too');
  // The older validator reads this real collector output as its nine sources.
  assert.equal(oldValidator().validateFeed(first, { now: LATER }).sources.length, 9);
  // Next run: one later source and one first-registry source fail. Each keeps its own last-good rows, images included.
  fs.rmSync(path.join(w.dir, 'mit-news.xml')); fs.writeFileSync(path.join(w.dir, 'mit-linguistics.xml'), '<rss><broken');
  const second = update(w, LATER); assert.equal(second.status, 2);
  const next = JSON.parse(fs.readFileSync(w.output));
  const later = next.extended.sources.find(source => source.id === 'mit-news'), legacy = next.sources.find(source => source.id === 'mit-linguistics');
  for (const source of [later, legacy]) { assert.equal(source.status, 'error'); assert.equal(source.stale, true); assert.equal(source.lastSuccessAt, NOW); assert.equal(source.lastAttemptAt, LATER); }
  assert.deepEqual(next.extended.articles.filter(article => article.sourceId === 'mit-news'), first.extended.articles.filter(article => article.sourceId === 'mit-news'));
  assert.equal(next.articles.find(article => article.sourceId === 'mit-linguistics').imageUrl, 'https://news.mit.edu/sites/default/files/images/one.jpg');
  // Every other source refreshed independently.
  for (const source of [...next.sources, ...next.extended.sources]) if (!['mit-news', 'mit-linguistics'].includes(source.id)) assert.equal(source.lastSuccessAt, LATER, source.id);
  assert.doesNotThrow(() => CI.validateCatalog(fs.readFileSync(w.output), Date.parse(LATER) + 1000));
  assert.doesNotThrow(() => CI.checkCollection(first, next, JSON.parse(fs.readFileSync(w.report)), 2));
  // A prior image on a host that is no longer registered is not carried forward.
  const tampered = structuredClone(next); tampered.extended.articles.find(article => article.sourceId === 'mit-news').imageUrl = 'https://tracker.example/pixel.gif';
  fs.writeFileSync(w.output, JSON.stringify(tampered)); assert.equal(update(w, '2026-11-13T03:00:00Z').status, 2);
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(w.output)).extended.articles.find(article => article.sourceId === 'mit-news'), 'imageUrl'), false);
});

test('the Pages gate requires both parts in place and refuses unreviewed image addresses', () => {
  const current = catalog();
  assert.doesNotThrow(() => CI.validateCatalog(bytes(current), stamp()));
  // The nine-source publication before this change seeds the upgrade but is not a current catalog.
  const before = structuredClone(current); delete before.extended;
  assert.doesNotThrow(() => CI.validateCatalog(bytes(before), stamp(), true));
  assert.throws(() => CI.validateCatalog(bytes(before), stamp()), /source set/);
  const missing = structuredClone(current); missing.extended.sources.pop(); missing.extended.articles = missing.extended.articles.filter(article => article.sourceId !== Discovery.EXTENDED_SOURCE_IDS.at(-1));
  assert.throws(() => CI.validateCatalog(bytes(missing), stamp()), /source set/);
  assert.throws(() => CI.validateCatalog(bytes(missing), stamp(), true), /source set/);
  // A later source in the first part would empty the list of every screen still on the older validator.
  const moved = structuredClone(current); moved.sources.push(moved.extended.sources.shift());
  assert.throws(() => CI.validateCatalog(bytes(moved), stamp()), /source set/);
  const misplaced = structuredClone(current); misplaced.articles.push(misplaced.extended.articles.shift());
  assert.throws(() => CI.validateCatalog(bytes(misplaced), stamp()), /wrong part/);
  for (const imageUrl of ['https://tracker.example/pixel.gif', 'http://img.yna.co.kr/a.jpg', 'data:image/png;base64,AAAA', 7, null]) {
    const next = structuredClone(current); next.extended.articles.find(article => article.id === 'card-yna-news-2').imageUrl = imageUrl;
    assert.throws(() => CI.validateCatalog(bytes(next), stamp()), /image address/);
  }
  const unreviewed = structuredClone(current); unreviewed.extended.articles.find(article => article.sourceId === 'nocut-news').imageUrl = 'https://img.yna.co.kr/photo/synthetic.jpg';
  assert.throws(() => CI.validateCatalog(bytes(unreviewed), stamp()), /image address/);
  const body = structuredClone(current); body.extended.articles[0].description = '본문을 복사하면 안 됨';
  assert.throws(() => CI.validateCatalog(bytes(body), stamp()), /metadata scope/);
});

test('the first deployment after this change: the nine-source publication seeds a two-part catalog through the real collector', async t => {
  // What is published today: nine sources, no `extended`, no image fields.
  const published = catalog(); delete published.extended; published.articles.pop(); for (const source of published.sources) delete source.images;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'haedo-card-feed-ci-')), f = CI.files(root), w = workspace(t, {
    'yna-news': `<rss version="2.0" ${MEDIA}><channel>` + item('www.yna.co.kr', 1, '<media:content url="https://img.yna.co.kr/photo/one.jpg" type="image/jpeg"/>') + '</channel></rss>',
    'sbs-news': null, // one later source fails on its very first collection
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(f.tracked), { recursive: true }); fs.writeFileSync(f.tracked, bytes(published));
  fs.copyFileSync(path.resolve(__dirname, '../assets/life/discovery.js'), f.core);
  const collector = now => ({ candidate, report }) => spawnSync('python3', [script, '--output', candidate, '--report', report, '--fixtures', w.dir, '--now', now], { encoding: 'utf8' }).status;
  const result = await CI.collect({ root, clock: stamp, fetchSeed: async () => ({ status: 200, bytes: bytes(published) }), runUpdater: collector(LATER) });
  assert.equal(result.seedKind, 'previous-publication'); assert.equal(result.collectorExitCode, 2); assert.equal(result.partialFailure, true);
  assert.equal(result.sourceCount, Object.keys(Discovery.ALLOWED_SOURCES).length); assert.equal(result.okSources, result.sourceCount - 1);
  const next = JSON.parse(fs.readFileSync(f.candidate));
  assert.deepEqual(next.sources.map(source => source.id), Discovery.LEGACY_SOURCE_IDS);
  assert.deepEqual(next.extended.sources.map(source => source.id), Discovery.EXTENDED_SOURCE_IDS);
  const failed = next.extended.sources.find(source => source.id === 'sbs-news');
  assert.equal(failed.status, 'error'); assert.equal(failed.lastSuccessAt, null);
  assert.equal(next.extended.articles.filter(article => article.sourceId === 'sbs-news').length, 0, 'no invented articles for a source that never succeeded');
  assert.equal(next.extended.articles.find(article => article.sourceId === 'yna-news').imageUrl, 'https://img.yna.co.kr/photo/one.jpg');
  fs.mkdirSync(path.dirname(f.artifact), { recursive: true });
  fs.writeFileSync(path.join(f.site, '.haedo-generated-site.json'), JSON.stringify({ generator: 'haedo-prepare-site', version: 1 }));
  fs.copyFileSync(f.tracked, f.artifact);
  assert.equal(CI.install({ root, clock: stamp }).artifactSHA256, result.candidateSHA256);
  const artifact = JSON.parse(fs.readFileSync(f.artifact));
  // Both validators read the installed file: the older screen its nine sources, the new one all of them.
  assert.equal(oldValidator().validateFeed(artifact, { now: LATER }).sources.length, 9);
  assert.equal(Discovery.validateFeed(artifact, { now: LATER }).sources.length, result.sourceCount);
  // The next run seeds from this two-part publication and keeps the failed source's empty history.
  const again = fs.mkdtempSync(path.join(os.tmpdir(), 'haedo-card-feed-ci2-')), g = CI.files(again);
  t.after(() => fs.rmSync(again, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(g.tracked), { recursive: true }); fs.writeFileSync(g.tracked, bytes(published)); fs.copyFileSync(f.core, g.core);
  const second = await CI.collect({ root: again, clock: () => Date.parse('2026-11-13T04:00:00Z'), fetchSeed: async () => ({ status: 200, bytes: fs.readFileSync(f.artifact) }), runUpdater: collector('2026-11-13T03:00:00Z') });
  assert.equal(second.collectorExitCode, 2); assert.equal(second.seedKind, 'previous-publication');
  assert.equal(second.sources.find(source => source.id === 'sbs-news').lastSuccessAt, null);
  assert.equal(second.sources.find(source => source.id === 'yna-news').lastSuccessAt, '2026-11-13T03:00:00Z');
});

// --- A1 (2026-11-11): the latest order in pages of 20, at most three of one publisher on a page ---------------
// A synthetic list shaped like the local collection of 2026-11-11 (405 articles, 25 sources): the two broadcasters
// publish every few minutes, everyone else hours apart. Only ids, publishers and times are real-shaped.
function measuredRows() {
  const start = Date.parse('2026-11-11T15:00:00Z'), rows = [];
  const plan = [
    // [feeds of one publisher, articles, minutes between them, minutes before the first]
    [['yna-news', 'yna-culture', 'yna-international'], 60, 4, 0], [['sbs-news', 'sbs-culture'], 40, 5, 1], [['nocut-news'], 20, 20, 60],
    [['seoul-culture', 'seoul-environment', 'seoul-economy', 'seoul-welfare', 'seoul-traffic', 'seoul-safe'], 60, 90, 120], [['arxiv-cs-cl'], 20, 0, 600],
    [['readersnews-books'], 20, 60, 180], [['nasa-news'], 10, 120, 240], [['global-voices'], 10, 150, 300], [['mit-news', 'mit-linguistics'], 20, 300, 360],
    [['conversation-global'], 20, 200, 420], [['eff-updates'], 10, 400, 480]
  ];
  for (const [ids, count, every, first] of plan) for (let i = 0; i < count; i++) {
    const sourceId = ids[i % ids.length], minutes = first + 3 + i * every + (every ? ids.indexOf(sourceId) : i);
    rows.push({ article: { sourceId, sourceName: sourceId, canonicalUrl: `https://${Discovery.ALLOWED_SOURCES[sourceId][0]}/a/${sourceId}-${i}`, sortDate: new Date(start - minutes * 60000).toISOString() } });
  }
  return rows;
}
const publishers = rows => rows.reduce((tally, row) => tally.set(Discovery.publisherKey(row.article), (tally.get(Discovery.publisherKey(row.article)) || 0) + 1), new Map());
const newestFirst = rows => rows.every((row, i) => i === 0 || Date.parse(rows[i - 1].article.sortDate) >= Date.parse(row.article.sortDate));

test('A1: the latest list spreads publishers over each page of 20 and still shows every article exactly once', () => {
  const rows = measuredRows(), plain = [...rows].sort((a, b) => Date.parse(b.article.sortDate) - Date.parse(a.article.sortDate));
  assert.ok(publishers(plain.slice(0, 20)).size <= 2, 'without the rule the first page is the two broadcasters');
  const spread = Discovery.spreadLatest(rows);
  assert.equal(spread.length, rows.length);
  assert.deepEqual(new Set(spread.map(row => row.article.canonicalUrl)), new Set(rows.map(row => row.article.canonicalUrl)), 'no article lost');
  assert.equal(new Set(spread.map(row => row.article.canonicalUrl)).size, rows.length, 'no article twice');
  const first = publishers(spread.slice(0, 20));
  assert.ok(first.size >= 6, 'first page publishers: ' + first.size);
  for (let at = 0; at < spread.length; at += 20) {
    const page = spread.slice(at, at + 20);
    assert.ok(newestFirst(page), 'a page reads newest first: ' + at);
    // A page short of publishers is filled anyway; only then can one publisher hold more than three places.
    const counts = [...publishers(page).values()], fillable = [...publishers(spread.slice(at)).values()].reduce((sum, left) => sum + Math.min(3, left), 0);
    if (fillable >= 20) assert.ok(Math.max(...counts) <= 3, 'page ' + at / 20 + ' holds ' + Math.max(...counts));
    else assert.equal(page.length, Math.min(20, spread.length - at), 'a short page is filled');
  }
  // 연합뉴스 종합·문화·세계 are one publisher, as are the six 서울시 feeds.
  assert.equal(first.get('연합뉴스'), 3); assert.equal(Discovery.publisherKey({ sourceId: 'seoul-safe' }), Discovery.publisherKey({ sourceId: 'seoul-culture' }));
  // Deterministic: the order of the input does not matter, so every device shows the same pages.
  const shuffled = [...rows].sort((a, b) => crypto.createHash('md5').update(a.article.canonicalUrl).digest('hex').localeCompare(crypto.createHash('md5').update(b.article.canonicalUrl).digest('hex')));
  assert.deepEqual(Discovery.spreadLatest(shuffled).map(row => row.article.canonicalUrl), spread.map(row => row.article.canonicalUrl));
});

test('A1: a short list lifts the cap to fill the page; a found link counts by its publisher name', () => {
  const at = minutes => new Date(Date.parse(NOW) - minutes * 60000).toISOString();
  const row = (sourceId, i, sourceName = sourceId) => ({ article: { sourceId, sourceName, canonicalUrl: `https://x.example/${sourceId}/${sourceName}/${i}`, sortDate: at(i) } });
  const two = [...Array.from({ length: 15 }, (_, i) => row('yna-news', i)), ...Array.from({ length: 15 }, (_, i) => row('sbs-news', i + 100))];
  const spread = Discovery.spreadLatest(two);
  assert.equal(spread.length, 30); assert.equal(spread.slice(0, 20).length, 20, 'the first page is full even with two publishers');
  assert.equal(publishers(spread.slice(0, 20)).get('연합뉴스'), 15);
  // Found links: the publisher name decides (case folded); a fixed feed's publisher wins over its display name.
  const found = [...Array.from({ length: 6 }, (_, i) => row('google-news', i, '합성일보')), ...Array.from({ length: 6 }, (_, i) => row('google-news', i + 10, i % 2 ? 'Synthetic Daily' : 'SYNTHETIC DAILY')),
    ...Array.from({ length: 14 }, (_, i) => row('google-news', i + 20, '합성매체 ' + i))];
  const page = Discovery.spreadLatest(found).slice(0, 20);
  assert.equal(publishers(page).get(Discovery.publisherKey({ sourceId: 'google-news', sourceName: '합성일보' })), 3);
  assert.equal(publishers(page).get('synthetic daily'), 3);
  assert.equal(Discovery.publisherKey({ sourceId: 'sbs-culture', sourceName: '다른 이름' }), Discovery.publisherKey({ sourceId: 'sbs-news' }));
  assert.equal(Discovery.publisherKey({ sourceId: 'google-news', sourceName: null }), 'google-news');
  for (const bad of [null, [{}].slice(1), 'rows']) if (!Array.isArray(bad)) assert.throws(() => Discovery.spreadLatest(bad));
  assert.throws(() => Discovery.spreadLatest([], { perPublisher: 0 })); assert.throws(() => Discovery.spreadLatest([], { size: 1.5 }));
});

test('A1: only the news list asks for the spread order; 관심순 and the default stay as they were', () => {
  const input = catalog(), options = { now: LATER, mode: 'latest', profile: { manual: [] }, feedback: [], knownUrls: [], limit: Discovery.LIMITS.articles };
  const plain = Discovery.rank(input, options).items.map(item => item.article.canonicalUrl), spread = Discovery.rank(input, { ...options, spread: true }).items.map(item => item.article.canonicalUrl);
  assert.deepEqual([...spread].sort(), [...plain].sort(), 'the same articles');
  assert.deepEqual(spread, Discovery.spreadLatest(Discovery.rank(input, options).items).map(item => item.article.canonicalUrl));
  const related = { ...options, mode: 'related', profile: { manual: [{ id: 'interest-1', label: '합성', aliases: [] }] } };
  assert.deepEqual(Discovery.rank(input, { ...related, spread: true }).items.map(item => item.article.canonicalUrl), Discovery.rank(input, related).items.map(item => item.article.canonicalUrl));
  assert.throws(() => Discovery.rank(input, { ...options, spread: 'yes' }));
});

test('A1: browser and collector name the same publisher for every source; the found-link id is not a catalog source', () => {
  const rows = python(`print(json.dumps({s['id']: s.get('publisher') for s in m.SOURCES}))`);
  assert.deepEqual(rows, { ...Discovery.PUBLISHERS });
  assert.deepEqual(Object.keys(Discovery.PUBLISHERS).sort(), Object.keys(Discovery.ALLOWED_SOURCES).sort());
  assert.equal(Object.hasOwn(Discovery.ALLOWED_SOURCES, Discovery.WIDE_SOURCE.id), false);
  assert.deepEqual(Discovery.SNAPSHOT_SOURCES[Discovery.WIDE_SOURCE.id], ['news.google.com']);
  // The publisher label is the registry's own; the catalog never carries it.
  const w = python(`print(json.dumps(sorted({k for s in m.SOURCES for k in s})))`);
  assert.ok(w.includes('publisher'));
});

test('노컷뉴스: its GMT label is always read as Korean time; other sources and explicit offsets are read as written', t => {
  const nocut = 'www.nocutnews.co.kr', entry = (n, date) => `<item><title>합성 노컷 ${n}</title><link>https://${nocut}/news/${6000000 + n}</link><pubDate>${date}</pubDate></item>`;
  const read = w => JSON.parse(fs.readFileSync(w.output)).extended.articles;
  const nocutRows = w => read(w).filter(article => article.sourceId === 'nocut-news').sort((a, b) => a.url.localeCompare(b.url)).map(article => [article.publishedAt, article.dateStatus]);
  // NOW is 2026-11-11T03:00:00Z (12:00 KST). 11:40 "GMT" is 8 h 40 min ahead: the feed's own 11:40 KST.
  const ahead = workspace(t, { 'nocut-news': `<rss version="2.0"><channel>${entry(1, 'Wed, 11 Nov 2026 11:40:00 GMT')}${entry(2, 'Wed, 11 Nov 2026 09:10:00 GMT')}</channel></rss>`,
    'sbs-news': `<rss version="2.0"><channel><item><title>합성 SBS</title><link>https://news.sbs.co.kr/news/endPage.do?news_id=N1</link><pubDate>Wed, 11 Nov 2026 11:40:00 GMT</pubDate></item></channel></rss>` });
  assert.ok([0, 2].includes(update(ahead).status));
  assert.deepEqual(nocutRows(ahead), [['2026-11-11T02:40:00Z', 'valid'], ['2026-11-11T00:10:00Z', 'valid']]);
  // Another source with the same label is read as written: still a future item.
  const sbs = read(ahead).find(article => article.sourceId === 'sbs-news');
  assert.equal(sbs.publishedAt, '2026-11-11T11:40:00Z'); assert.equal(sbs.dateStatus, 'future');
  // A quiet hour (no label in the future as written) is corrected the same way: 02:10 KST is 17:10Z the day before.
  const quiet = workspace(t, { 'nocut-news': `<rss version="2.0"><channel>${entry(3, 'Wed, 11 Nov 2026 02:10:00 GMT')}</channel></rss>` });
  assert.ok([0, 2].includes(update(quiet).status));
  assert.deepEqual(nocutRows(quiet), [['2026-11-10T17:10:00Z', 'valid']]);
  // One scheduled item does not move the others: 20:00 KST (11:00Z) stays a future item, 11:40 KST is corrected as always.
  const scheduled = workspace(t, { 'nocut-news': `<rss version="2.0"><channel>${entry(4, 'Wed, 11 Nov 2026 20:00:00 GMT')}${entry(5, 'Wed, 11 Nov 2026 11:40:00 GMT')}</channel></rss>` });
  assert.ok([0, 2].includes(update(scheduled).status));
  assert.deepEqual(nocutRows(scheduled), [['2026-11-11T11:00:00Z', 'future'], ['2026-11-11T02:40:00Z', 'valid']]);
  // An explicit offset is the feed's own statement and is read as written.
  const explicit = workspace(t, { 'nocut-news': `<rss version="2.0"><channel>${entry(6, 'Wed, 11 Nov 2026 11:40:00 +0900')}${entry(7, 'Wed, 11 Nov 2026 01:40:00 +0000')}</channel></rss>` });
  assert.ok([0, 2].includes(update(explicit).status));
  assert.deepEqual(nocutRows(explicit), [['2026-11-11T02:40:00Z', 'valid'], ['2026-11-11T01:40:00Z', 'valid']]);
});
