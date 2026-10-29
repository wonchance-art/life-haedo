'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Remote = require('../assets/life/discovery-private-remote.js');
const Discovery = require('../assets/life/discovery.js');
const NOW = '2026-10-29T00:00:00.000Z';
const workspaceId = 'synthetic-private-reader', userId = '11111111-1111-4111-8111-111111111111';
const projectUrl = 'https://synthetic.supabase.co';
const url = 'https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.123456/full';
const metadata = { id: 'synthetic-article', sourceId: 'frontiers-psychology', title: 'Synthetic reading', url, canonicalUrl: url, author: 'Synthetic author', language: 'en', publishedAt: NOW, fetchedAt: NOW, tags: ['reading'], coverage: 'link_only', summary: '', rights: { mode: 'metadata_only', label: 'Metadata', url: null } };
const content = () => ({ coverage: 'full_text', summary: 'Synthetic summary', bodyText: 'First exact paragraph.\n\nSecond exact paragraph. 😀', rights: { mode: 'private_reading', label: 'Private reading', url },
  acquisition: { scope: 'private_account', method: 'publisher_xml', sourceUrl: url.replace('/full', '/xml'), fetchedAt: NOW, license: { label: 'Original source terms', url: null } } });
const ready = (change = {}) => ({ status: 'ready', sourceId: metadata.sourceId, url, content: content(), contentHash: 'a'.repeat(64), cached: false, stale: false, ...change });
const response = (data, init = {}) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, ...init });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function harness(fetcher = async () => response(ready())) {
  const listeners = new Set(), owner = { userId, projectUrl };
  const auth = { config: { url: projectUrl, key: 'synthetic-publishable-key' }, user: { id: userId }, epoch: 1,
    getAccount: () => owner, verify: async () => ({ id: userId }), onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    client: { auth: { getSession: async () => ({ data: { session: { user: { id: userId }, access_token: 'synthetic-user-token' } }, error: null }) } } };
  let current = true;
  const storage = { isAccountScoped: true, account: { ...owner } }, remote = Remote.create({ auth, storage, fetcher, isCurrent: () => current });
  return { auth, owner, storage, listeners, remote, leave() { current = false; }, switchAccount() { owner.userId = '22222222-2222-4222-8222-222222222222'; auth.user.id = owner.userId; auth.epoch++; for (const fn of listeners) fn(); } };
}

test('authenticated private POST sends only source identity and preserves the exact metadata and body', async () => {
  const calls = [], h = harness(async (address, options) => { calls.push({ address, options }); return response(ready()); });
  const original = structuredClone(metadata), found = await h.remote.loadPrivateArticle(metadata, { workspaceId });
  assert.equal(found.privateReader, true); assert.equal(found.id, metadata.id); assert.equal(found.url, metadata.url);
  assert.equal(found.bodyText, content().bodyText); assert.deepEqual(metadata, original);
  assert.deepEqual(found.privateReceipt, { sourceId: metadata.sourceId, url, contentHash: 'a'.repeat(64), cached: false, stale: false });
  assert.equal(calls.length, 1); const request = calls[0];
  assert.equal(request.address, projectUrl + '/functions/v1/haedo-discovery-private');
  assert.deepEqual(JSON.parse(request.options.body), { sourceId: metadata.sourceId, url });
  assert.equal(request.options.headers.Authorization, 'Bearer synthetic-user-token');
  assert.equal(request.options.cache, 'no-store'); assert.equal(request.options.credentials, 'omit'); assert.equal(request.options.redirect, 'error');
  assert(!request.options.body.includes(workspaceId)); assert(!request.options.body.includes(userId));
  h.remote.dispose(); assert.equal(h.listeners.size, 0);
});

test('unsupported approved sources fall back without HTTP, while invalid identity is rejected', async () => {
  let count = 0; const h = harness(async () => { count++; return response(ready()); });
  assert.equal(await h.remote.loadPrivateArticle({ ...metadata, sourceId: 'naver-d2', url: 'https://d2.naver.com/a', canonicalUrl: 'https://d2.naver.com/a' }, { workspaceId }), null);
  for (const invalid of [{ url: url + '?identity=other' }, { url: url.replace('www.frontiersin.org', 'www.frontiersin.org.evil.example') }, { canonicalUrl: url + '/other' }]) await assert.rejects(h.remote.loadPrivateArticle({ ...metadata, ...invalid }, { workspaceId }), { code: 'discovery_private_invalid' });
  assert.equal(count, 0); h.remote.dispose();
});

test('same-account verification notifications keep requests alive and canonical requests preserve original metadata URLs', async () => {
  let sent;
  const h = harness(async (_, options) => { sent = JSON.parse(options.body); return response(ready()); });
  h.auth.verify = async () => { for (const listener of h.listeners) listener({ userId, projectUrl }); return { id: userId }; };
  const original = { ...metadata, url: url + '?utm_source=feed#reader' };
  const loaded = await h.remote.loadPrivateArticle(original, { workspaceId });
  assert.deepEqual(sent, { sourceId: metadata.sourceId, url });
  assert.equal(loaded.url, original.url); assert.equal(loaded.canonicalUrl, url); assert.equal(loaded.privateReceipt.url, url);
  assert(Remote.toImportInput(loaded).text.includes(original.url)); h.remote.dispose();
});

test('private content validates source and acquired version independently from public feed permissions', () => {
  const found = Remote.project(metadata, ready());
  const source = { id: metadata.sourceId, name: 'Synthetic', url: 'https://www.frontiersin.org/', feedUrl: 'https://www.frontiersin.org/journals/psychology/rss', language: 'en', rights: metadata.rights, status: 'ok', stale: false, lastSuccessAt: NOW, lastAttemptAt: NOW, error: null };
  const publicFeed = Discovery.validateFeed({ schemaVersion: 1, generatedAt: NOW, sources: [source], articles: [found] }, { now: NOW });
  assert.equal(publicFeed.articles.length, 0, 'private reading must never widen public publication rights');
  for (const patch of [{ sourceId: 'mit-linguistics' }, { url: url.replace('123456', '654321') }, { contentHash: 'not-a-hash' }, { ownerId: userId }, { content: { ...content(), bodyText: 'bad\u0000body' } }, { content: { ...content(), coverage: 'summary' } }, { content: { ...content(), rights: { ...content().rights, mode: 'full_text_allowed' } } }]) assert.throws(() => Remote.project(metadata, ready(patch)), { code: 'discovery_private_invalid' });
  const wrong = content(); wrong.acquisition.sourceUrl = wrong.acquisition.sourceUrl.replace('123456', '654321');
  assert.throws(() => Remote.project(metadata, ready({ content: wrong })), { code: 'discovery_private_invalid' });
});

test('MIT exact HTML and LLT official-feed summaries retain honest acquisition coverage', () => {
  const mitURL = 'https://news.mit.edu/2026/synthetic-language-research-1010', mit = { ...metadata, sourceId: 'mit-linguistics', url: mitURL, canonicalUrl: mitURL };
  const body = content(); body.acquisition.method = 'publisher_html'; body.acquisition.sourceUrl = mitURL;
  assert.equal(Remote.project(mit, ready({ sourceId: mit.sourceId, url: mitURL, content: body })).coverage, 'full_text');
  body.acquisition.sourceUrl = mitURL + '-other'; assert.throws(() => Remote.project(mit, ready({ sourceId: mit.sourceId, url: mitURL, content: body })), { code: 'discovery_private_invalid' });
  const lltURL = 'https://www.lltjournal.org/item/10125-12345/', llt = { ...metadata, sourceId: 'llt-journal', url: lltURL, canonicalUrl: lltURL };
  const summary = content(); delete summary.bodyText; summary.coverage = 'summary'; summary.acquisition.method = 'publisher_rss'; summary.acquisition.sourceUrl = 'https://www.lltjournal.org/feedlet/';
  const found = Remote.project(llt, ready({ sourceId: llt.sourceId, url: lltURL, content: summary }));
  assert.equal(found.coverage, 'summary'); assert(!('bodyText' in found)); assert.equal(Remote.toImportInput(found).coverage.status, 'partial');
});

test('private import preserves exact body at offset zero and attribution without republishing permission', () => {
  const article = Remote.project(metadata, ready()), input = Remote.toImportInput(article);
  assert.equal(input.text.slice(0, article.bodyText.length), article.bodyText);
  assert(input.text.includes('\n원문 URL: ' + url)); assert(input.text.includes('비공개 개인 읽기'));
  assert(input.text.includes(article.acquisition.sourceUrl)); assert(input.text.includes(article.acquisition.fetchedAt));
  assert.equal(input.coverage.status, 'full_text'); assert.deepEqual(input.coverage.omissions, ['사진·영상 미보관']);
  assert.throws(() => Remote.toImportInput(metadata), { code: 'discovery_private_invalid' });
  assert.throws(() => Remote.toImportInput({ ...article, privateReceipt: { ...article.privateReceipt, url: url + '/other' } }), { code: 'discovery_private_invalid' });
});

test('optional raster bytes reuse bounded validation; image identity cannot cross articles', () => {
  const png = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(1, 16); png.writeUInt32BE(1, 20);
  const picture = { mimeType: 'image/png', dataBase64: png.toString('base64'), alt: 'Synthetic image', caption: 'Synthetic caption', credit: 'Synthetic author', license: { label: 'Private source figure', url: null }, sourceUrl: 'https://www.frontiersin.org/files/Articles/123456/xml-images/fpsyg-17-123456-g001.webp', afterParagraph: 0 };
  const input = content(); input.images = [picture];
  assert.deepEqual(Remote.project(metadata, ready({ content: input })).images, [picture]);
  input.images = [{ ...picture, dataBase64: Buffer.from('<svg onload=bad()>').toString('base64') }];
  const textOnly = Remote.project(metadata, ready({ content: input })); assert.equal(textOnly.bodyText, input.bodyText); assert.deepEqual(textOnly.images, []);
  input.images = [{ ...picture, sourceUrl: picture.sourceUrl.replaceAll('123456', '654321') }];
  assert.throws(() => Remote.project(metadata, ready({ content: input })), { code: 'discovery_private_invalid' });
});

test('server unavailability is distinct from busy, rate limit, authentication and missing setup', async () => {
  for (const [data, code] of [[{ status: 'unavailable' }, null], [{ status: 'busy' }, 'discovery_private_busy'], [{ status: 'rate_limited' }, 'discovery_private_rate_limited'], [{ error: 'setup_required' }, 'discovery_private_setup'], [{ status: 'ready' }, 'discovery_private_invalid']]) {
    const h = harness(async () => response(data));
    if (code) await assert.rejects(h.remote.loadPrivateArticle(metadata, { workspaceId }), { code });
    else assert.equal(await h.remote.loadPrivateArticle(metadata, { workspaceId }), null);
    h.remote.dispose();
  }
  const h = harness(async () => response({ error: 'unauthorized' }, { status: 401 }));
  await assert.rejects(h.remote.loadPrivateArticle(metadata, { workspaceId }), { code: 'discovery_private_auth' }); h.remote.dispose();
});

test('owner verification and session identity precede any private network request', async () => {
  let count = 0; const h = harness(async () => { count++; return response(ready()); });
  h.auth.verify = async () => ({ id: 'different-user' });
  await assert.rejects(h.remote.loadPrivateArticle(metadata, { workspaceId }), { code: 'discovery_private_auth' });
  h.auth.verify = async () => ({ id: userId }); h.auth.client.auth.getSession = async () => ({ data: { session: { user: { id: 'different-user' }, access_token: 'other-token' } } });
  await assert.rejects(h.remote.loadPrivateArticle(metadata, { workspaceId }), { code: 'discovery_private_auth' });
  assert.equal(count, 0); h.remote.dispose();
});

test('account switch, workspace departure, explicit cancellation and disposal reject late responses', async () => {
  for (const change of [h => h.switchAccount(), h => h.leave(), h => h.remote.cancel(), h => h.remote.dispose()]) {
    const entered = deferred(), finish = deferred();
    const h = harness(async () => { entered.resolve(); return finish.promise; });
    const pending = h.remote.loadPrivateArticle(metadata, { workspaceId }); await entered.promise;
    change(h); finish.resolve(response(ready()));
    await assert.rejects(pending, { code: 'discovery_private_cancelled' }); h.remote.dispose();
  }
});

test('external abort and malformed or oversized streamed data cannot install a snapshot', async () => {
  const h = harness(), controller = new AbortController(); controller.abort();
  await assert.rejects(h.remote.loadPrivateArticle(metadata, { workspaceId, signal: controller.signal }), { code: 'discovery_private_cancelled' }); h.remote.dispose();
  for (const makeResponse of [() => new Response('not JSON', { headers: { 'content-type': 'application/json' } }), () => new Response('{}', { headers: { 'content-type': 'text/html' } }), () => new Response(' '.repeat(Remote.MAX_BYTES + 1), { headers: { 'content-type': 'application/json' } }), () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(Remote.MAX_BYTES + 1) } })]) {
    const h = harness(async () => makeResponse()); await assert.rejects(h.remote.loadPrivateArticle(metadata, { workspaceId }), { code: 'discovery_private_invalid' }); h.remote.dispose();
  }
});

test('cancellation settles even if an underlying transport ignores abort', async () => {
  const entered = deferred(), controller = new AbortController(), late = deferred();
  const h = harness(async () => { entered.resolve(); return late.promise; });
  const pending = h.remote.loadPrivateArticle(metadata, { workspaceId, signal: controller.signal }); await entered.promise;
  controller.abort(); await assert.rejects(pending, { code: 'discovery_private_cancelled' });
  late.resolve(response(ready())); h.remote.dispose();
});
