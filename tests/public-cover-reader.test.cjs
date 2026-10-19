'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../assets/life/core.js'), Cover = require('../assets/life/public-cover.js');
const Reader = require('../assets/life/public-cover-reader.js'), Series = require('../assets/life/blog-series-public.js');
const PhotoPost = require('../assets/life/photo-post.js'), Blog = require('../assets/life/blog.js');
const baseURL = 'https://example.org/haedo/cover.html', clone = value => structuredClone(value);
const id = n => '55555555-5555-4555-8555-' + String(n).padStart(12, '0');
function fixture(kinds = ['post', 'series', 'nine']) {
  const coverId = id(1), cover = Cover.create(Core.id); cover.title = '우리 여행의 글과 취향'; cover.intro = '직접 고른 읽을거리';
  cover.items = kinds.map((kind, index) => Cover.item(kind, id(index + 20), Core.id));
  const wire = Cover.project(cover, baseURL), pages = new Map(), posts = new Map(), reads = [];
  const published = snapshot => ({ status: 'published', publicId: coverId, revision: 1, updatedAt: '2026-10-19T00:00:00.000Z', snapshot });
  pages.set(coverId, published(clone(wire)));
  for (const item of cover.items) {
    if (item.kind === 'post') {
      const doc = PhotoPost.create(Core.id); doc.title = '현재 공개한 여행 글'; doc.status = 'saved'; doc.ops = [{ insert: '오래 걷고 쉬었던 여행의 하루🌱\n다음 줄입니다.\n' }];
      posts.set(item.publicId, { snapshot: Blog.publicSnapshot(doc, { author: { name: '공개 이름', intro: '이 프로필 소개는 글 앞부분이 아닙니다.' } }) });
    } else if (item.kind === 'series') pages.set(item.publicId, published(Series.wrapper('현재 공개한 여행 연재', '연재 소개', [id(500), id(501)], baseURL)));
    else pages.set(item.publicId, published({ format: 'life-share-v1', title: '현재 공개한 여행 9칸', intro: '9칸 소개', entries: [{ title: '여행에서 읽은 책', pinned: false, note: null, parts: [], attachments: [{ type: 'book', title: '온전한 책 제목', creator: '공개 저자', url: 'https://example.org/book' }] }] }));
  }
  const f = { coverId, cover, wire, pages, posts, reads, active: 0, maximum: 0, disposed: [] };
  async function resolve(kind, key) {
    reads.push({ kind, key }); if (key !== coverId) { f.active++; f.maximum = Math.max(f.maximum, f.active); }
    try { if (f.beforeRead) await f.beforeRead(kind, key); return clone(kind === 'post' ? posts.get(key) || null : pages.get(key) || { status: 'missing' }); }
    finally { if (key !== coverId) f.active--; }
  }
  f.reader = Reader.create({ baseURL, shareReader: { read: key => resolve('share', key), dispose() { f.disposed.push('share'); } }, blogReader: { read: key => resolve('post', key), dispose() { f.disposed.push('post'); } } });
  return f;
}
function gate() { let enter, release; return { entered: new Promise(resolve => enter = resolve), released: new Promise(resolve => release = resolve), enter: () => enter(), release: () => release() }; }
test('live public previews preserve order and exact URLs without fetching series children or profile intro', async () => {
  const f = fixture(), before = clone(f.wire), result = await f.reader.read(f.coverId);
  assert.equal(result.status, 'published'); assert.deepEqual(result.items.map(item => item.kind), ['post', 'series', 'nine']);
  assert(result.items.every(item => item.status === 'published'));
  for (const row of result.items) { assert.equal(row.key, Reader.key(row.kind, row.publicId)); assert.equal(row.url, Reader.targetURL(row.kind, row.publicId, baseURL)); }
  assert.equal(result.items[0].excerpt, '오래 걷고 쉬었던 여행의 하루🌱 다음 줄입니다.'); assert.equal(result.items[0].intro, '');
  assert(!JSON.stringify(result).includes('이 프로필 소개')); assert(!Object.hasOwn(result.items[0], 'snapshot')); assert(!Object.hasOwn(result.items[0], 'photos'));
  assert.deepEqual(f.reads.filter(read => read.kind === 'post').map(read => read.key), [f.cover.items[0].publicId]); assert.equal(f.reads.filter(read => read.key === f.coverId).length, 2); assert.deepEqual(f.wire, before);
  f.posts.get(f.cover.items[0].publicId).snapshot.title = '작성자가 갱신한 현재 제목';
  assert.equal((await f.reader.read(f.coverId)).items[0].title, '작성자가 갱신한 현재 제목'); f.reader.dispose();
});
test('at most three target reads run at once even when a cover selects twenty entries', async () => {
  const f = fixture(Array(20).fill('post')), held = gate(); let started = 0;
  f.beforeRead = async (_, key) => { if (key !== f.coverId && ++started <= 3) { if (started === 3) held.enter(); await held.released; } };
  const pending = f.reader.read(f.coverId); await held.entered; assert.equal(started, 3); assert.equal(f.maximum, 3); held.release();
  assert.equal((await pending).items.length, 20); assert.equal(f.maximum, 3); f.reader.dispose();
});
test('individual withdrawal, errors and nested covers cannot expose stale target titles or links', async () => {
  const f = fixture(); f.posts.clear(); const broken = f.cover.items[1].publicId;
  f.beforeRead = (_, key) => { if (key === broken) throw Object.assign(Error('untrusted HTTP detail'), { code: 'network_error' }); };
  const nested = Cover.create(Core.id); nested.title = '이 표지를 9칸으로 오인하면 안 됩니다'; nested.items = [Cover.item('post', id(900), Core.id)];
  f.pages.get(f.cover.items[2].publicId).snapshot = Cover.project(nested, baseURL);
  const result = await f.reader.read(f.coverId); assert.deepEqual(result.items.map(item => item.status), ['missing', 'error', 'error']);
  for (const row of result.items) for (const key of ['title', 'intro', 'excerpt', 'url']) assert.equal(row[key], null);
  assert(!JSON.stringify(result).includes('untrusted HTTP detail')); assert(!JSON.stringify(result).includes(nested.title));
  // A single-post series also satisfies the generic nine shape. The declared
  // kind must still change to an error rather than silently opening as nine.
  f.pages.get(f.cover.items[2].publicId).snapshot = Series.wrapper('바뀐 한 편짜리 연재', '연재 소개', [id(901)], baseURL);
  const changedKind = (await f.reader.read(f.coverId)).items[2]; assert.equal(changedKind.status, 'error'); assert.equal(changedKind.title, null); assert.equal(changedKind.url, null);
  f.reader.dispose();
});
test('changed or withdrawn cover heads never return the old selected membership', async () => {
  for (const change of ['revision', 'snapshot', 'withdraw']) {
    const f = fixture(), held = gate(); let waited = false;
    f.beforeRead = async (_, key) => { if (key !== f.coverId && !waited) { waited = true; held.enter(); await held.released; } };
    const pending = f.reader.read(f.coverId); await held.entered;
    if (change === 'withdraw') f.pages.set(f.coverId, { status: 'missing' });
    else if (change === 'revision') f.pages.get(f.coverId).revision++;
    else f.pages.get(f.coverId).snapshot = { ...clone(f.wire), title: '변경된 표지' };
    held.release();
    if (change === 'withdraw') assert.deepEqual(await pending, { status: 'missing' }); else await assert.rejects(pending, { code: 'cover_changed' });
    f.reader.dispose();
  }
});
test('strict wrapper rejection and disposal stop malformed or late reads before any old result escapes', async () => {
  const invalid = fixture(); invalid.pages.get(invalid.coverId).snapshot.entries[0].note = '표지에 복사하면 안 되는 개인 메모';
  await assert.rejects(invalid.reader.read(invalid.coverId)); assert.equal(invalid.reads.length, 1); invalid.reader.dispose();
  const missing = fixture(); missing.pages.clear(); assert.deepEqual(await missing.reader.read(missing.coverId), { status: 'missing' }); assert.equal(missing.reads.length, 1); missing.reader.dispose();
  const f = fixture(), held = gate(); f.beforeRead = async (_, key) => { if (key === f.coverId) { held.enter(); await held.released; } };
  const pending = f.reader.read(f.coverId); await held.entered; f.reader.dispose(); held.release(); await assert.rejects(pending, { code: 'request_cancelled' });
  assert.deepEqual(f.disposed.sort(), ['post', 'share']); await assert.rejects(f.reader.read(f.coverId), { code: 'request_cancelled' });
});
test('preview text has a code-point boundary and target links accept only supported kinds and safe bases', () => {
  assert.equal(Reader.postExcerpt({ ops: [{ insert: ' 🌱'.repeat(300) }, { insert: { photo: { id: id(900) } } }] }).length > 240, true);
  assert.equal(Array.from(Reader.postExcerpt({ ops: [{ insert: '🌱'.repeat(300) }] })).length, 240);
  assert.equal(Reader.postExcerpt({ ops: [{ insert: ' A\r\n' }, { insert: { photo: {} } }, { insert: '\tB ' }] }), 'A B');
  for (const kind of ['cover', '__proto__', 'external']) assert.throws(() => Reader.targetURL(kind, id(1), baseURL));
  for (const base of ['file:///tmp/cover.html', 'https://user:secret@example.org/cover.html']) assert.throws(() => Reader.targetURL('post', id(1), base));
  assert.throws(() => Reader.targetURL('post', 'not-a-token', baseURL));
});
