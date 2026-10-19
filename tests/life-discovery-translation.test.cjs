'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Discovery = require('../assets/life/discovery.js');
const Language = require('../assets/life/discovery-language-settings.js');

// Public, neutral URL fixtures only. These tests never navigate to them.
const original = 'https://news.mit.edu/2026/public-note';
const article = (changes = {}) => ({ sourceId: 'mit-linguistics', url: original, ...changes });
const targets = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de'];
function inspect(result, target, expectedOriginal = original) {
  assert.equal(typeof result, 'string');
  const link = new URL(result);
  assert.equal(link.origin, 'https://translate.google.com');
  assert.equal(link.pathname, '/translate');
  assert.equal(link.username, ''); assert.equal(link.password, ''); assert.equal(link.hash, '');
  assert.deepEqual([...link.searchParams.keys()], ['sl', 'tl', 'u']);
  assert.equal(link.searchParams.get('sl'), 'auto');
  assert.equal(link.searchParams.get('tl'), target);
  assert.equal(link.searchParams.get('u'), expectedOriginal);
  return link;
}

test('translation link permits only explicit target codes and the fixed external website endpoint', () => {
  for (const target of targets) inspect(Language.buildTranslationURL(article(), target), target);
  assert.equal(Language.buildTranslationURL(article(), 'original'), null);
  for (const target of [undefined, null, '', 'auto', 'zh', 'zh-cn', 'zh-TW ', ' ko', 'KO', 'en-US', 'xx', 1, {}, ['ko'], 'ko&u=https://attacker.example/', 'ko#fragment']) {
    assert.equal(Language.buildTranslationURL(article(), target), null, 'reject unsupported target ' + String(target));
  }
});

test('minimal approved article/source pairs work across old and newly reviewed public providers', () => {
  const examples = [
    ['naver-d2', 'https://d2.naver.com/public-note'],
    ['seoul-culture', 'https://news.seoul.go.kr/culture/archives/1'],
    ['woowahan-tech', 'https://techblog.woowahan.com/public-note/'],
    ['readersnews-books', 'https://www.readersnews.com/news/articleView.html?idxno=1'],
    ['seoul-environment', 'https://news.seoul.go.kr/env/archives/1'],
    ['arxiv-cs-cl', 'https://arxiv.org/abs/2601.00001'],
    ['mit-linguistics', original]
  ];
  for (const [sourceId, url] of examples) inspect(Language.buildTranslationURL({ sourceId, url }, 'ko'), 'ko', url);
  inspect(Language.buildTranslationURL(article({ url: 'https://NEWS.MIT.EDU:443/2026/public-note' }), 'en'), 'en', original);
});

test('unapproved source, wrong source-host pairing and malformed article identities never form links', () => {
  for (const input of [null, undefined, false, 1, original, [], {}, { url: original }, { sourceId: 'mit-linguistics' },
    article({ sourceId: 'unknown' }), article({ sourceId: '__proto__' }), article({ sourceId: 'constructor' }),
    article({ sourceId: 'mit-linguistics ' }), article({ sourceId: ['mit-linguistics'] }),
    article({ sourceId: { toString() { return 'mit-linguistics'; } } }),
    article({ sourceId: { toString() { throw Error('Do not coerce an arbitrary source identity'); } } }),
    article({ sourceId: 'arxiv-cs-cl' }), article({ sourceId: 'naver-d2' }),
    article({ url: null }), article({ url: 42 }), article({ url: { toString() { throw Error('Do not coerce an arbitrary URL object'); } } })]) {
    assert.equal(Language.buildTranslationURL(input, 'ko'), null);
  }
});

test('unsafe schemes, credentials, deceptive hosts, nonstandard ports and controls are rejected', () => {
  const hostile = [
    'http://news.mit.edu/2026/public-note', '//news.mit.edu/2026/public-note', '/2026/public-note',
    'javascript:alert(1)', 'data:text/html,public', 'file:///public-note', 'blob:https://news.mit.edu/public-note',
    'ftp://news.mit.edu/public-note', 'https://user@news.mit.edu/public-note', 'https://user:password@news.mit.edu/public-note',
    'https://news.mit.edu@attacker.example/public-note', 'https://news.mit.edu.attacker.example/public-note',
    'https://attacker.example/?next=https://news.mit.edu/public-note', 'https://news.mit.edu:8443/public-note',
    'https://news.mіt.edu/public-note', 'https://127.0.0.1/public-note', 'https://[::1]/public-note',
    ' https://news.mit.edu/public-note', 'https://news.mit.edu/public-note ',
    'https://news.mit.edu/line\nbreak', 'https://news.mit.edu/tab\there', 'https://news.mit.edu/null\0here',
    'https://', 'not a URL'
  ];
  for (const url of hostile) assert.equal(Language.buildTranslationURL(article({ url }), 'ko'), null, JSON.stringify(url));
});

test('supplied canonical identity must exactly match the public original after canonicalization', () => {
  const url = original + '?id=A%20B&utm_source=public#section';
  const canonicalUrl = original + '?id=A%20B';
  inspect(Language.buildTranslationURL(article({ url, canonicalUrl }), 'ja'), 'ja', canonicalUrl);
  for (const mismatch of [null, '', original + '/different', original + '?id=A+B', url, canonicalUrl + '#section', 'https://attacker.example/public-note']) {
    assert.equal(Language.buildTranslationURL(article({ url, canonicalUrl: mismatch }), 'ja'), null);
  }
});

test('single outer encoding preserves original percent escapes, query spelling, duplicates and nested public URL', () => {
  const url = 'https://news.mit.edu/2026/public%2Fnote?name=A%20B&plus=A+B&encoded=%252F&tag=one&tag=two&next=https%3A%2F%2Fnews.mit.edu%2Fmore%3Fx%3D1&utm_source=public#section';
  const canonicalUrl = 'https://news.mit.edu/2026/public%2Fnote?name=A%20B&plus=A+B&encoded=%252F&tag=one&tag=two&next=https%3A%2F%2Fnews.mit.edu%2Fmore%3Fx%3D1';
  const result = Language.buildTranslationURL(article({ url }), 'zh-TW');
  inspect(result, 'zh-TW', canonicalUrl);
  assert.ok(result.includes('public%252Fnote'), 'existing original percent escape is preserved through one outer encoding');
  assert.ok(!result.includes('public%25252Fnote'), 'the entire original URL must not be double encoded');
  assert.ok(!new URL(result).searchParams.has('next'), 'nested query remains entirely in u');
  inspect(Language.buildTranslationURL(article({ url: 'https://news.mit.edu/2026/한글?label=한글' }), 'ko'), 'ko', 'https://news.mit.edu/2026/%ED%95%9C%EA%B8%80?label=%ED%95%9C%EA%B8%80');
});

test('translation helper leaves the original frozen metadata untouched and never reads content or private fields', () => {
  const input = article({ canonicalUrl: original, language: 'en', tags: Object.freeze(['public']), rights: Object.freeze({ mode: 'metadata_only' }) });
  for (const key of ['title', 'summary', 'bodyText', 'privateMemo', 'accountId', 'workspaceId']) {
    Object.defineProperty(input, key, { enumerable: true, get() { throw Error('Translation must not read ' + key); } });
  }
  Object.freeze(input);
  const before = Object.getOwnPropertyDescriptors(input);
  inspect(Language.buildTranslationURL(input, 'fr'), 'fr');
  assert.deepEqual(Object.getOwnPropertyDescriptors(input), before);
  assert.equal(input.url, original); assert.equal(input.canonicalUrl, original); assert.equal(input.language, 'en');
  assert.deepEqual(input.tags, ['public']);
});

test('browser UMD import and repeated URL construction perform no network, storage, DOM, navigation or scheduling IO', () => {
  const attempts = [];
  const sandbox = { URL, URLSearchParams, TextEncoder, structuredClone, HaedoLife: { Discovery } };
  const forbidden = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'BroadcastChannel',
    'indexedDB', 'caches', 'localStorage', 'sessionStorage', 'navigator', 'document', 'location', 'open',
    'setTimeout', 'setInterval', 'requestAnimationFrame', 'require'];
  for (const name of forbidden) Object.defineProperty(sandbox, name, { get() { attempts.push(name); throw Error('Unexpected IO: ' + name); } });
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/discovery-language-settings.js'), 'utf8'), sandbox);
  assert.deepEqual(Array.from(Object.keys(sandbox.HaedoLife.DiscoveryLanguageSettings)).sort(), Object.keys(Language).sort());
  const results = vm.runInContext(`(() => {
    const build = HaedoLife.DiscoveryLanguageSettings.buildTranslationURL;
    const article = Object.freeze({ sourceId: 'mit-linguistics', url: 'https://news.mit.edu/2026/public-note' });
    return [build(article, 'ko'), build(article, 'en'), build(article, 'original'), build(null, 'ko')];
  })()`, sandbox);
  inspect(results[0], 'ko'); inspect(results[1], 'en'); assert.equal(results[2], null); assert.equal(results[3], null);
  assert.deepEqual(attempts, []);
});
