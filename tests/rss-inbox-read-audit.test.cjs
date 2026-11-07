'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isRssInboxRead, isBackgroundSync, isBackgroundSyncWrite } = require('./helpers/account-sync-rpcs.cjs');
const cloud = 'https://fixture.invalid', ownerId = 'fixture-owner';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const server = { libraryOwner: request => request.headers().authorization === 'Bearer fixture-token' ? ownerId : null };
const options = { cloud, server, ownerId, workspaceId };
function request(overrides = {}) {
  const value = { url: cloud + '/functions/v1/haedo-rss', method: 'POST',
    headers: { authorization: 'Bearer fixture-token' }, body: { action: 'list', workspaceId }, ...overrides };
  return { url: () => value.url, method: () => value.method, headers: () => value.headers,
    postData: () => Object.hasOwn(overrides, 'raw') ? overrides.raw : JSON.stringify(value.body) };
}
test('only the exact authenticated initial RSS inbox read is classified separately', () => {
  assert.equal(isRssInboxRead(request(), options), true);
  assert.equal(isBackgroundSync(request().url()), false);
  assert.equal(isBackgroundSyncWrite(request().url()), false);
  assert.equal(isRssInboxRead(request(), { ...options, ownerId: 'another-owner' }), false);
  assert.equal(isRssInboxRead(request(), { ...options, workspaceId: '22222222-2222-4222-8222-222222222222' }), false);
});
test('collection, controls, cursor and every malformed body remain subject to the write audit', () => {
  const bodies = ['poll', 'register', 'pause', 'resume', 'disconnect', 'publish', 'LIST', ''].map(action => ({ action, workspaceId }));
  bodies.push({ action: 'list' }, { action: 'list', workspaceId: 'invalid' },
    { action: 'list', workspaceId, extra: true },
    { action: 'list', workspaceId, before: { fetched_at: '2026-11-05T00:00:00Z', id: workspaceId } },
    { action: 'list', workspaceId: null }, null, [], 'list');
  for (const body of bodies) assert.equal(isRssInboxRead(request({ body }), options), false, JSON.stringify(body));
  for (const raw of ['', '{', null]) assert.equal(isRssInboxRead(request({ raw }), options), false);
});
test('foreign endpoint, method and missing or unrecognized authentication are never exempt', () => {
  for (const suffix of ['/x', '2', '?action=list', '#list']) {
    assert.equal(isRssInboxRead(request({ url: cloud + '/functions/v1/haedo-rss' + suffix }), options), false, suffix);
  }
  for (const url of ['https://other.invalid/functions/v1/haedo-rss', 'https://user:pass@fixture.invalid/functions/v1/haedo-rss', cloud + '/rest/v1/rpc/life_blog_publish']) {
    assert.equal(isRssInboxRead(request({ url }), options), false, url);
  }
  for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) assert.equal(isRssInboxRead(request({ method }), options), false);
  for (const headers of [{}, { authorization: '' }, { authorization: 'Bearer unknown' }, { authorization: 'Basic fixture-token' }]) {
    assert.equal(isRssInboxRead(request({ headers }), options), false);
  }
  assert.equal(isRssInboxRead(request(), { ...options, server: {} }), false);
});
