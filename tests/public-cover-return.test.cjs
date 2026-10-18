'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const R = require('../assets/life/public-cover-return.js');
const cover = '11111111-1111-4111-8111-111111111111', post = '22222222-2222-4222-8222-222222222222', series = '33333333-3333-4333-8333-333333333333';
const base = 'https://example.org/life/';
const address = (kind = 'post', id = post, file = 'blog.html', param = 'post') => base + file + '?' + param + '=' + id + '&fromCover=' + cover + '&coverItem=' + kind + '-' + id;
test('A return context accepts only the current canonical target and exact UUIDs', () => {
  assert.deepEqual(R.context(address()), { coverId: cover, kind: 'post', publicId: post, key: 'cover-entry-post-' + post });
  for (const url of [address().replace('blog.html', 'share.html'), address().replace('?post=', '?post=' + cover + '&post='), address() + '&fromCover=' + cover, address() + '&coverItem=post-' + post, address().replace('coverItem=post-', 'coverItem=series-'), address() + '&return=https://evil.example/', address().replace('blog.html', '%62log.html'), address().replace('https://', 'https://user:password@'), address().replace(cover, '../escape')]) assert.equal(R.context(url), null, url);
});
test('Series navigation carries only a verified same-site series context', () => {
  const context = { ...R.context(address('series', series, 'series.html', 'series')), url: base + 'cover.html?cover=' + cover };
  const next = R.seriesAddress(base + 'series.html?series=' + series + '&post=' + post, context);
  assert.equal(R.context(next).publicId, series); assert.equal(new URL(next).searchParams.get('post'), post);
  for (const url of ['https://evil.example/series.html?series=' + series, base + 'series.html?series=' + post, base + 'series.html?series=' + series + '&post=bad', base + 'series.html?series=' + series + '&post=' + post + '&post=' + post, base + 'series.html?series=' + series + '&url=https://evil.example/', base + 'other/series.html?series=' + series]) assert.equal(R.seriesAddress(url, context), null, url);
});
test('A backlink is made only for an actual member of the currently published wrapper', () => {
  const C = require('../assets/life/public-cover.js');
  const c = C.create(() => cover); c.title = '직접 고른 공개 글'; c.items.push(C.item('post', post, () => series));
  const snapshot = C.project(c, base), result = R.destination(address(), snapshot);
  assert.equal(result.url, base + 'cover.html?cover=' + cover + '#cover-entry-post-' + post);
  assert.equal(R.destination(address().replaceAll(post, series), snapshot), null);
  assert.equal(R.destination(address(), { ...snapshot, entries: [] }), null);
  const hostile = structuredClone(snapshot); hostile.entries[0].attachments[0].url = 'https://evil.example/blog.html?post=' + post;
  assert.equal(R.destination(address(), hostile), null);
});
