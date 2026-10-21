const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const Naver = require('../assets/life/naver-blog.js');
const Core = require('../assets/life/core.js');
const copy = value => structuredClone(value);
const hash = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const invalid = error => error.code === 'naver_blog_invalid';
function item(patch = {}) {
  return { id: 'synthetic-entry', blog_id: 'fixture_blog', log_no: '123456789012345678901', title: '긴 한글 자료 제목',
    url: 'https://blog.naver.com/fixture_blog/123456789012345678901', content_text: null, content_hash: null,
    published_at: null, fetched_at: '2026-10-21T01:00:00.000Z', coverage: 'link_only', ...patch };
}
async function add(bundle, input, excerpts = []) {
  const prepared = await Core.prepareImport(input, bundle);
  return { bundle: Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared, excerpts)), prepared };
}

test('browser module uses no Auth, network or private storage and shares the pure API', () => {
  const context = vm.createContext({ URL, TextEncoder });
  for (const name of ['fetch', 'localStorage', 'indexedDB', 'document', 'supabase']) Object.defineProperty(context, name, {
    get() { throw new Error('Unexpected private/network API'); }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/naver-blog.js'), 'utf8'), context);
  assert.equal(context.HaedoLife.NaverBlog.parseBlog('fixture_blog').blogId, 'fixture_blog');
  assert.equal(context.HaedoLife.NaverBlog.postIdentity(item().url).logNo, item().log_no);
  assert.deepEqual(Object.keys(context.HaedoLife.NaverBlog).sort(), Object.keys(Naver).sort());
});

test('ID, profile, mobile and strict post/list addresses resolve without changing account case', () => {
  const expected = { blogId: 'Fixture_7', url: 'https://blog.naver.com/Fixture_7', feedUrl: 'https://rss.blog.naver.com/Fixture_7.xml' };
  for (const input of [' Fixture_7 ', 'https://blog.naver.com/Fixture_7', 'http://m.blog.naver.com/Fixture_7/',
    'https://BLOG.NAVER.COM/PostList.naver?blogId=Fixture_7&from=share',
    'https://m.blog.naver.com/PostView.naver?blogId=Fixture_7&logNo=123', 'https://blog.naver.com/Fixture_7/123?from=outside#part']) {
    assert.deepEqual(Naver.parseBlog(input), expected);
  }
  assert.notEqual(Naver.parseBlog('Fixture_7').blogId, Naver.parseBlog('fixture_7').blogId);
});

test('ambiguous and disguised addresses are rejected before URL normalization', () => {
  const inputs = [null, {}, '', 'bad id', 'bad\nID', 'https://blog.naver.com/fixture_blog\n/123',
    '//blog.naver.com/a', 'ftp://blog.naver.com/a', 'https://blog.naver.com.evil.invalid/a',
    'https://blog.naver.com./a', 'https://ｂlog.naver.com/a', 'https://user@blog.naver.com/a',
    'https://blog.naver.com:443/a', 'http://blog.naver.com:80/a', 'https://blog.naver.com\\@evil.invalid/a',
    'https://blog.naver.com/a/../b', 'https://blog.naver.com/%66ixture_blog',
    'https://blog.naver.com/PostView.naver?blogId=a&logNo=1&blogId=b',
    'https://blog.naver.com/PostView.naver?blogId=a&logNo=1&LOGNO=2',
    'https://blog.naver.com/PostView.naver?blogId=%61&logNo=1',
    'https://blog.naver.com/PostView.naver?%62logId=a&logNo=1',
    'https://blog.naver.com/a/1?blogId=b', 'https://blog.naver.com/a/1?logNo=2',
    'https://blog.naver.com/a?from=x&from=y', 'https://blog.naver.com/PostList.naver?blogId=a&logNo=1',
    'https://blog.naver.com/PostView.naver?blogId=a', 'https://blog.naver.com/a/01',
    'https://blog.naver.com/a/0', 'https://blog.naver.com/a/1/extra'];
  for (const input of inputs) {
    assert.throws(() => Naver.parseBlog(input), invalid);
    assert.equal(Naver.postIdentity(input), null);
  }
});

test('post identity unifies supported URL spellings but preserves arbitrarily precise decimal strings', () => {
  const logNo = '123456789012345678901234567890';
  const expected = { blogId: 'fixture_blog', logNo, key: 'fixture_blog:' + logNo, url: 'https://blog.naver.com/fixture_blog/' + logNo };
  for (const url of [expected.url, 'http://m.blog.naver.com/fixture_blog/' + logNo + '?from=share#구절',
    'https://blog.naver.com/PostView.naver?logNo=' + logNo + '&blogId=fixture_blog']) assert.deepEqual(Naver.postIdentity(url), expected);
  assert.equal(Naver.postIdentity('https://blog.naver.com/fixture_blog'), null);
  assert.equal(Naver.postIdentity('https://blog.naver.com/PostList.naver?blogId=fixture_blog'), null);
  assert.notEqual(Naver.postIdentity(expected.url).key, Naver.postIdentity(expected.url.replace('fixture_blog', 'Fixture_blog')).key);
});

test('projection matches Naver URL identity, requires current full text, and owns its result', async () => {
  let bundle = Core.createWorkspace();
  const captured = await add(bundle, { origin: 'naver_blog', title: '보관한 원문',
    url: 'http://m.blog.naver.com/PostView.naver?blogId=fixture_blog&logNo=' + item().log_no + '&from=manual',
    text: '원문\r\n🌱 옛 구절', coverage: 'full_text' }, [{ start: 0, end: 2 }]);
  bundle = captured.bundle;
  const before = copy(bundle), input = item(), rows = Naver.project([input], bundle);
  assert.equal(rows[0].status, 'imported');
  assert.equal(rows[0].sourceId, captured.prepared.source.id);
  assert.equal(rows[0].sourceVersionId, captured.prepared.version.id);
  assert.equal(rows[0].sourceUrl, captured.prepared.source.url);
  rows[0].candidateSourceIds.push('changed'); rows[0].title = 'changed';
  assert.deepEqual(bundle, before); assert.equal(input.title, item().title);
  assert.equal(Naver.project([item({ log_no: '2', url: 'https://blog.naver.com/fixture_blog/2' })], bundle)[0].status, 'new');
  const newer = await add(bundle, { origin: 'naver_blog', title: '보관한 원문', text: '새 일부 본문', coverage: 'partial',
    url: captured.prepared.source.url, existingSourceId: captured.prepared.source.id });
  const partial = Naver.project([input], newer.bundle)[0];
  assert.equal(partial.status, 'needs_content'); assert.equal(partial.sourceVersionId, newer.prepared.version.id);
  assert.deepEqual(newer.bundle.sourceVersions[0], before.sourceVersions[0]);
  assert.deepEqual(newer.bundle.records, before.records);
});

test('unrelated manual bodies do not count as imported; duplicate source identities remain ambiguous', async () => {
  let bundle = (await add(Core.createWorkspace(), { origin: 'other', title: '같은 주소', url: item().url, text: '원문', coverage: 'full_text' })).bundle;
  assert.equal(Naver.project([item()], bundle)[0].status, 'new');
  const link = await add(bundle, Naver.toImportInput(item())); bundle = link.bundle;
  assert.equal(Naver.project([item()], bundle)[0].status, 'needs_content');
  bundle = (await add(bundle, { origin: 'naver_blog', title: '별개 보관', url: item().url, text: '더 긴 본문', coverage: 'full_text', forceSeparate: true })).bundle;
  const row = Naver.project([item()], bundle)[0];
  assert.equal(row.status, 'ambiguous'); assert.equal(row.sourceId, null); assert.equal(row.sourceVersionId, null);
  assert.equal(row.candidateSourceIds.length, 2);
  const noURL = await add(Core.createWorkspace(), { origin: 'naver_blog', title: item().title, text: '원문', coverage: 'full_text' });
  assert.equal(Naver.project([item()], noURL.bundle)[0].status, 'new');
});

test('acquired text preserves CRLF/BOM/emoji and imports only as partial with unconfirmed ownership', async () => {
  const raw = '\uFEFF첫 줄\r\n🌱 받은 구절\r\n끝';
  const server = item({ content_text: raw, content_hash: hash(raw), coverage: 'partial', published_at: '2024-02-29T15:20:00.000Z' });
  const input = Naver.toImportInput(server);
  assert.equal(input.text, raw); assert.equal(input.authorRelation, 'unknown');
  assert.equal(input.coverage.status, 'partial'); assert.equal(input.originalCreatedAt, server.published_at);
  assert.equal(input.existingSourceId, undefined);
  const first = await add(Core.createWorkspace(), input);
  assert.equal(first.prepared.version.contentText, raw); assert.equal(first.prepared.version.contentHash, hash(raw));
  assert.deepEqual(first.prepared.version.originalAuthor, { label: '', relation: 'unknown' });
  const duplicate = await Core.prepareImport({ ...input, existingSourceId: first.prepared.source.id }, first.bundle);
  assert.equal(duplicate.match.kind, 'exact_duplicate');
  assert.equal(Core.buildImportChanges(first.bundle, duplicate).put.sourceVersions.length, 0);
  const projected = Naver.project([server], first.bundle)[0];
  assert.deepEqual(Naver.toImportInput(projected), input);
  const link = await add(Core.createWorkspace(), Naver.toImportInput(item()));
  assert.equal(link.prepared.version.contentText, null); assert.equal(link.prepared.version.contentHash, null);
  assert.equal(link.prepared.version.originalCreatedAt, null);
});

test('invalid server identities, scope/coverage claims and executable extra fields fail closed', () => {
  const base = item();
  for (const patch of [{ blog_id: 'another_blog' }, { log_no: '2' }, { log_no: 123 }, { coverage: 'full_text' },
    { content_text: '본문', content_hash: hash('본문') }, { coverage: 'partial' },
    { coverage: 'partial', content_text: '본문', content_hash: null }, { content_hash: hash('') },
    { content_html: '<img src=x onerror=alert(1)>' }, { title: '\ud800' }, { title: '' },
    { fetched_at: 'invalid' }, { published_at: 'unknown' }, { authorRelation: 'self' }]) {
    assert.throws(() => Naver.toImportInput({ ...base, ...patch }), invalid);
  }
  const getter = { ...base }; Object.defineProperty(getter, 'title', { get() { throw new Error('getter executed'); } });
  assert.throws(() => Naver.toImportInput(getter), invalid);
  assert.throws(() => Naver.project([base, base], Core.createWorkspace()), invalid);
  assert.throws(() => Naver.project(Array(1), Core.createWorkspace()), invalid);
});

test('thousands of unrelated source rows do not affect selected exact identity or old full-text preservation', async () => {
  const first = await add(Core.createWorkspace(), { origin: 'naver_blog', title: '정확 보관', url: item().url,
    text: 'FULL_ORIGINAL\r\n🌱', coverage: 'full_text' });
  const bundle = copy(first.bundle), source = bundle.sources[0], version = bundle.sourceVersions[0];
  for (let index = 0; index < 3479; index++) {
    const id = 'unrelated-' + index;
    bundle.sources.push({ ...source, id, url: 'https://blog.naver.com/unrelated_blog/' + (index + 1) });
    bundle.sourceVersions.push({ ...version, id: id + '-version', sourceId: id });
  }
  const before = copy(bundle), rss = item({ content_text: 'RSS 일부', content_hash: hash('RSS 일부'), coverage: 'partial' });
  const row = Naver.project([rss], bundle)[0];
  assert.equal(row.status, 'imported'); assert.equal(row.sourceVersionId, version.id);
  assert.deepEqual(bundle, before);
});
