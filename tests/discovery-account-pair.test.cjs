/* 뉴스 반응·읽기 비교의 두 계정 문서(2026-11-11 검수 MAJOR-1).
 * `discoveryActions`/`discoveryReading`에는 이전 판(c767df3) 검증기가 받는 것만, 나머지(추가 출처, 넓게 찾기
 * 링크, 출처 20곳을 넘는 비교)는 `discoveryActionsExtended`/`discoveryReadingExtended`에 둔다. 이전 판 검증기는
 * tests/fixtures/discovery-old-client의 고정본을 자기 realm에서 그대로 돌린다. 합성 자료만, 네트워크 없음. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { createStorage } = require('../assets/life/storage.js');
const Core = require('../assets/life/core.js');
const Discovery = require('../assets/life/discovery.js');
const Interest = require('../assets/life/interest-profile.js');
const Feedback = require('../assets/life/discovery-profile.js');
const Settings = require('../assets/life/discovery-settings.js');
const Languages = require('../assets/life/discovery-language-settings.js');
const Actions = require('../assets/life/discovery-actions.js');
const Reading = require('../assets/life/discovery-reading.js');
const Wide = require('../assets/life/discovery-wide-remote.js');

const FIXTURES = path.join(__dirname, 'fixtures/discovery-old-client');
const OLD = { 'discovery.js': 'ee284b29696fc6fdaadf8efc63cd2ebf4305030514411150e009fa2321ff234b', 'discovery-actions.js': 'cbae40cdaf96f221f2d160f126b6a5b31174fbb748117f4544b374aa3e1497d9',
  'discovery-reading.js': '8b6c18f69c752ed971ffdd1d578ccd7d7927ba97dcee0906b5582469ff548028' };
// The earlier shell's validators in their own realm. The modules this change did not touch load as they are.
function older() {
  const sandbox = vm.createContext({ TextEncoder, URL, AbortController, structuredClone, crypto: globalThis.crypto });
  for (const file of ['discovery.js', 'discovery-actions.js']) {
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, file + '.gz')));
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), OLD[file], file); vm.runInContext(raw.toString('utf8'), sandbox);
  }
  for (const file of ['discovery-profile.js', 'discovery-language-settings.js', 'interest-profile.js', 'discovery-recommendations.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/life', file), 'utf8'), sandbox);
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, 'discovery-reading.js.gz')));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), OLD['discovery-reading.js']); vm.runInContext(raw.toString('utf8'), sandbox);
  const parse = vm.runInContext('JSON.parse', sandbox), inside = value => parse(JSON.stringify(value));
  const accepts = name => value => { try { vm.runInContext(`HaedoLife.${name}`, sandbox).validate(inside(value)); return true; } catch (_) { return false; } };
  return { actions: accepts('DiscoveryActions'), reading: accepts('DiscoveryReading') };
}
const Old = older();
const W = 'workspace-pair', T = minutes => new Date(Date.parse('2026-11-11T10:00:00.000Z') + minutes * 60000).toISOString();
const rights = { label: '합성 제목·링크', url: null, mode: 'metadata_only' };
function article(sourceId, n, host = Discovery.SNAPSHOT_SOURCES[sourceId][0]) {
  return { id: `pair-${sourceId}-${n}`, sourceId, url: `https://${host}/post/${sourceId}-${n}`, title: `합성 ${sourceId} ${n}`, author: null, language: 'ko', tags: [], publishedAt: null, updatedAt: null, fetchedAt: T(0), coverage: 'link_only', rights };
}
const captured = (sourceId, n, host) => Actions.capture(article(sourceId, n, host), { id: sourceId, name: '합성 ' + sourceId });
const found = () => {
  const item = Wide.validate({ supplier: 'google-news-rss', fetchedAt: T(0), stale: false, topics: [], items: [{ id: 'a'.repeat(32), title: '합성 넓게 찾은 글', link: 'https://news.google.com/rss/articles/SYNPAIR?oc=5', publishedAt: T(0), sourceName: '합성매체', sourceUrl: null, topic: '합성', language: 'ko' }] }).items[0];
  const value = Wide.toArticle(item, { sourceId: Discovery.WIDE_SOURCE.id, canonicalUrl: Discovery.canonicalUrl, fetchedAt: T(0) });
  return Actions.capture(value, { id: value.sourceId, name: value.sourceName });
};
// What storage does on a save: the profile from the pair, the model's change, the pair back.
function save(pair, change) {
  const profile = Actions.combine(pair.legacy, pair.extended), next = change(profile, { expectedRevision: profile.revision });
  const written = Actions.separate(next, pair.legacy, pair.extended);
  return { legacy: written.legacy || pair.legacy, extended: written.extended || pair.extended, written };
}
const urls = profile => profile.entries.map(row => row.canonicalUrl).sort();

test('reactions: the legacy document always passes the earlier validator; every other entry is in the extended one', () => {
  let pair = { legacy: Actions.empty(W), extended: Actions.empty(W) };
  const legacy = captured('seoul-culture', 1), added = captured('yna-news', 1), link = found();
  // Why two documents: the earlier validator holds back a document with an added source or a found link.
  const single = Actions.setReaction(Actions.setReaction(Actions.empty(W), legacy, 'bookmarked', true, { expectedRevision: 0, now: T(1) }), added, 'bookmarked', true, { expectedRevision: 1, now: T(2) });
  assert.equal(Old.actions(single), false, 'the earlier validator refuses a mixed document');
  assert.equal(Actions.legacyCompatible(single), false);
  let minute = 1;
  for (const [snapshot, kind] of [[legacy, 'bookmarked'], [added, 'bookmarked'], [link, 'bookmarked'], [legacy, 'liked'], [added, 'liked']]) {
    const before = Actions.combine(pair.legacy, pair.extended);
    pair = save(pair, (profile, options) => Actions.setReaction(profile, snapshot, kind, true, { ...options, now: T(++minute) }));
    assert.equal(Old.actions(pair.legacy), true, 'the earlier validator accepts the legacy document after ' + snapshot.sourceId + ' ' + kind);
    assert.ok(pair.legacy.entries.every(row => Discovery.LEGACY_SOURCE_IDS.includes(row.snapshot.sourceId)));
    assert.ok(pair.extended.entries.every(row => !Discovery.LEGACY_SOURCE_IDS.includes(row.snapshot.sourceId)));
    const after = Actions.combine(pair.legacy, pair.extended);
    assert.equal(after.revision, before.revision + 1, 'one save, one revision of the pair');
    // Only the document that holds the changed entry is written.
    assert.deepEqual([!!pair.written.legacy, !!pair.written.extended], Discovery.LEGACY_SOURCE_IDS.includes(snapshot.sourceId) ? [true, false] : [false, true]);
  }
  const profile = Actions.combine(pair.legacy, pair.extended);
  assert.deepEqual(urls(profile), [legacy.canonicalUrl, added.canonicalUrl, link.canonicalUrl].sort());
  assert.equal(profile.entries.find(row => row.canonicalUrl === added.canonicalUrl).liked, true);
  assert.equal(profile.revision, pair.legacy.revision + pair.extended.revision);
  // 개인 추천 lives in the legacy document, which the earlier shell reads too.
  pair = save(pair, (value, options) => Actions.setPersonalization(value, true, { ...options, now: T(20) }));
  assert.equal(pair.legacy.personalizationEnabled, true); assert.equal(pair.extended.personalizationEnabled, false); assert.equal(Actions.combine(pair.legacy, pair.extended).personalizationEnabled, true);
  // Forgetting an added-source entry writes the extended document only; the reset clears both.
  pair = save(pair, (value, options) => Actions.forget(value, added.canonicalUrl, { ...options, now: T(21) }));
  assert.deepEqual([!!pair.written.legacy, !!pair.written.extended], [false, true]);
  assert.deepEqual(urls(Actions.combine(pair.legacy, pair.extended)), [legacy.canonicalUrl, link.canonicalUrl].sort());
  pair = save(pair, (value, options) => Actions.clear(value, { ...options, now: T(22) }));
  const cleared = Actions.combine(pair.legacy, pair.extended);
  assert.equal(cleared.deleted, true); assert.deepEqual(cleared.entries, []); assert.equal(Old.actions(pair.legacy), true);
});

test('reactions: an address in both documents shows the version changed last; the other copy stays until it is forgotten', () => {
  // Two feeds of one site can list one article: 서울시 문화 (first registry) and 서울시 경제 (added).
  const url = 'news.seoul.go.kr';
  const inLegacy = Actions.capture({ ...article('seoul-culture', 7, url), url: 'https://news.seoul.go.kr/post/same' }, { id: 'seoul-culture', name: '서울시 문화' });
  const inExtended = Actions.capture({ ...article('seoul-economy', 7, url), url: 'https://news.seoul.go.kr/post/same' }, { id: 'seoul-economy', name: '서울시 경제' });
  const other = captured('yna-news', 9);
  const legacy = Actions.setReaction(Actions.empty(W), inLegacy, 'bookmarked', true, { expectedRevision: 0, now: T(1) });
  const extended = Actions.setReaction(Actions.empty(W), inExtended, 'liked', true, { expectedRevision: 0, now: T(2) });
  let pair = { legacy, extended }, shown = Actions.combine(legacy, extended);
  assert.equal(shown.entries.length, 1); assert.equal(shown.entries[0].snapshot.sourceId, 'seoul-economy', 'the later version shows');
  pair = save(pair, (value, options) => Actions.setReaction(value, other, 'bookmarked', true, { ...options, now: T(3) }));
  assert.equal(pair.legacy.entries.length, 1, 'the other copy is not dropped by an unrelated save');
  pair = save(pair, (value, options) => Actions.forget(value, inLegacy.canonicalUrl, { ...options, now: T(4) }));
  assert.equal(pair.legacy.entries.length, 0); assert.deepEqual(pair.extended.entries.map(row => row.canonicalUrl), [other.canonicalUrl]);
});

test('reactions: a legacy document holding other entries moves them, and keeps them until they are in the extended one', () => {
  const legacy = captured('naver-d2', 1), added = captured('nasa-news', 1), link = found();
  let mixed = Actions.empty(W), minute = 0;
  for (const snapshot of [legacy, added, link]) mixed = Actions.setReaction(mixed, snapshot, 'bookmarked', true, { expectedRevision: mixed.revision, now: T(++minute) });
  // The extended document already has the found link, changed later: that version stays and the older one is returned.
  const later = Actions.setReaction(Actions.empty(W), link, 'liked', true, { expectedRevision: 0, now: T(10) });
  const moved = Actions.migrate(mixed, later, T(11));
  assert.equal(Old.actions(moved.legacy), true); assert.deepEqual(urls(moved.legacy), [legacy.canonicalUrl]);
  assert.deepEqual(urls(moved.extended), [added.canonicalUrl, link.canonicalUrl].sort());
  assert.equal(moved.extended.entries.find(row => row.canonicalUrl === link.canonicalUrl).liked, true);
  assert.equal(moved.lost.length, 1); assert.equal(moved.lost[0].bookmarked, true, 'the older version is returned for a recovery copy');
  assert.deepEqual(urls(Actions.combine(moved.legacy, moved.extended)), urls(mixed), 'nothing is lost from the profile');
  assert.equal(Actions.migrate(moved.legacy, moved.extended, T(12)), null, 'nothing to move twice');
});

// A comparison as the screen starts it: the validated catalog, image links taken out.
function catalog(ids) {
  const source = id => ({ id, name: '합성 ' + id, url: `https://${Discovery.ALLOWED_SOURCES[id][0]}/`, feedUrl: `https://${Discovery.ALLOWED_SOURCES[id][0]}/feed`, language: 'ko', rights, status: 'ok', lastSuccessAt: T(0), lastAttemptAt: T(0), error: null, stale: false });
  const row = (id, n) => ({ ...article(id, n, Discovery.ALLOWED_SOURCES[id][0]), url: `https://${Discovery.ALLOWED_SOURCES[id][0]}/post/${id}-${n}`, publishedAt: T(-n), summary: '' });
  const legacyIds = ids.filter(id => Discovery.LEGACY_SOURCE_IDS.includes(id)), laterIds = ids.filter(id => !Discovery.LEGACY_SOURCE_IDS.includes(id));
  const feed = Discovery.validateFeed({ schemaVersion: 1, generatedAt: T(0), sources: legacyIds.map(source), articles: legacyIds.map((id, n) => row(id, n + 1)),
    extended: { sources: laterIds.map(source), articles: laterIds.map((id, n) => row(id, n + 30)) } }, { now: T(1) });
  for (const value of feed.sources) delete value.images; for (const value of feed.articles) delete value.imageUrl;
  return { feed, profile: { workspaceId: W, revision: 1, manual: [{ id: 'manual-a', label: '합성' }] }, feedback: [], knownUrls: [], contentLanguages: null, actions: null, translationTarget: 'original', personalAllowed: false, baselineMode: 'latest' };
}
async function startComparison(pair, ids, minute, sessionId) {
  const profile = Reading.combine(pair.legacy, pair.extended);
  const next = await Reading.createComparison(profile, catalog(ids), { expectedRevision: profile.revision, now: T(minute), sessionId });
  const written = Reading.separate(next, pair.legacy, pair.extended);
  return { legacy: written.legacy || pair.legacy, extended: written.extended || pair.extended, written };
}
function edit(pair, change) {
  const profile = Reading.combine(pair.legacy, pair.extended), next = change(profile, { expectedRevision: profile.revision });
  const written = Reading.separate(next, pair.legacy, pair.extended);
  return { legacy: written.legacy || pair.legacy, extended: written.extended || pair.extended, written };
}

test('reading comparison: one over every source lives in the extended document; one the earlier shell reads stays legacy', async () => {
  let pair = { legacy: Reading.empty(W), extended: Reading.empty(W) };
  pair = await startComparison(pair, Object.keys(Discovery.ALLOWED_SOURCES), 1, 'pair-wide');
  assert.equal(pair.written.legacy, null); assert.ok(pair.written.extended);
  assert.equal(Old.reading(pair.extended), false, 'the earlier validator refuses a comparison over more than twenty sources');
  assert.equal(Old.reading(pair.legacy), true);
  const shown = Reading.combine(pair.legacy, pair.extended);
  assert.equal(shown.session.id, 'pair-wide'); assert.equal(shown.revision, 1);
  // An answer to the shown comparison stays in its document.
  pair = edit(pair, (value, options) => Reading.setReview(value, value.session.reviews[0].canonicalUrl, { intent: 'yes' }, { ...options, now: T(2) }));
  assert.equal(pair.written.legacy, null); assert.equal(Reading.combine(pair.legacy, pair.extended).session.reviews[0].intent, 'yes');
  // Deleting it, then starting one over the first nine sources only: that one is legacy and the earlier shell reads it.
  pair = edit(pair, (value, options) => Reading.clear(value, { ...options, now: T(3) }));
  assert.equal(Reading.combine(pair.legacy, pair.extended).session, null);
  pair = await startComparison(pair, Discovery.LEGACY_SOURCE_IDS, 4, 'pair-nine');
  assert.ok(pair.written.legacy); assert.equal(pair.written.extended, null); assert.equal(Old.reading(pair.legacy), true);
  assert.equal(Reading.combine(pair.legacy, pair.extended).session.id, 'pair-nine');
  assert.equal(Reading.combine(pair.legacy, pair.extended).revision, 4);
});

test('reading comparison: a legacy document holding a comparison the earlier shell cannot read moves it; the replaced one is returned', async () => {
  const mixed = await Reading.createComparison(Reading.empty(W), catalog(Object.keys(Discovery.ALLOWED_SOURCES)), { expectedRevision: 0, now: T(5), sessionId: 'pair-mixed' });
  const older = await Reading.createComparison(Reading.empty(W), catalog(Object.keys(Discovery.ALLOWED_SOURCES)), { expectedRevision: 0, now: T(1), sessionId: 'pair-older' });
  const moved = Reading.migrate(mixed, older, T(6));
  assert.equal(Old.reading(moved.legacy), true); assert.equal(moved.legacy.session, null);
  assert.equal(moved.extended.session.id, 'pair-mixed'); assert.deepEqual(moved.lost.map(item => [item.from, item.value.session.id]), [['extended', 'pair-older']]);
  assert.equal(Reading.combine(moved.legacy, moved.extended).session.id, 'pair-mixed');
  assert.equal(Reading.migrate(moved.legacy, moved.extended, T(7)), null);
});

// Storage over a transactional in-memory IndexedDB (same shape as the other storage tests).
function memoryAdapter() {
  const schemas = new Map(), rows = new Map(), key = value => JSON.stringify(value), control = { beforeWrite: null };
  function connection() {
    return {
      objectStoreNames: { contains: name => schemas.has(name) },
      createObjectStore(name, options) { schemas.set(name, options.keyPath); rows.set(name, new Map()); return { createIndex() {} }; },
      close() {},
      transaction(names, mode) {
        const working = new Map(names.map(name => [name, structuredClone(rows.get(name))]));
        let finished = false, resolve, reject; const done = new Promise((yes, no) => { resolve = yes; reject = no; });
        const abort = (error = new DOMException('aborted', 'AbortError')) => { if (!finished) { finished = true; reject(error); } };
        function store(name) {
          const map = working.get(name), valueKey = value => Array.isArray(schemas.get(name)) ? schemas.get(name).map(field => value[field]) : value[schemas.get(name)];
          async function write(method, value) {
            if (finished) throw new DOMException('inactive', 'InvalidStateError'); assert.equal(mode, 'readwrite');
            control.beforeWrite?.({ name, method, value, abort });
            const encoded = key(method === 'delete' ? value : valueKey(value));
            if (method === 'delete') map.delete(encoded); else { if (method === 'add' && map.has(encoded)) throw new DOMException('duplicate', 'ConstraintError'); map.set(encoded, structuredClone(value)); }
            return method === 'delete' ? value : valueKey(value);
          }
          return { async get(value) { return structuredClone(map.get(key(value))); }, async getAll() { return structuredClone([...map.values()]); }, async getAllKeys() { return [...map.keys()].map(JSON.parse); },
            async getKey(value) { return map.has(key(value)) ? structuredClone(value) : undefined; }, put: value => write('put', value), add: value => write('add', value), delete: value => write('delete', value),
            index(field) { return { async getAll(value) { return structuredClone([...map.values()].filter(row => row[field] === value)); } }; } };
        }
        setImmediate(() => { if (finished) return; finished = true; if (mode === 'readwrite') for (const [name, values] of working) rows.set(name, values); resolve(); });
        return { done, objectStore: store, abort };
      }
    };
  }
  return { rows, control, idb: { async openDB(name, version, callbacks) { const db = connection(); if (!schemas.size) callbacks.upgrade(db, 0, version); return db; } } };
}
const account = { projectUrl: 'https://pair-test.supabase.co', userId: 'anonymous-pair' };
const accountKey = JSON.stringify([account.projectUrl, account.userId]);
function fixture() {
  const adapter = memoryAdapter(), base = createStorage({ idb: adapter.idb, core: Core, interestProfile: Interest, discoveryProfile: Feedback, discoverySettings: Settings,
    discoveryActions: Actions, discoveryLanguageSettings: Languages, discoveryReading: Reading, channelFactory: null });
  const raw = key => adapter.rows.get('meta').get(JSON.stringify(key))?.value;
  return { ...adapter, base, store: base.forAccount(account), raw };
}

test('storage: a save writes the pair, reads it as one profile, and lists both as account documents', async t => {
  const { base, store, raw } = fixture(); t.after(() => base.close());
  const w = (await store.createWorkspace('익명 반응 두 문서')).workspaceId, events = [];
  store.subscribeAll(event => events.push(event));
  const keys = { legacy: `discoveryActions:${accountKey}:${w}`, extended: `discoveryActionsExtended:${accountKey}:${w}` };
  let profile = await store.readDiscoveryActions(w); assert.equal(profile.revision, 0);
  const legacy = captured('seoul-culture', 1), added = captured('yna-news', 1), link = found();
  let minute = 0;
  for (const snapshot of [legacy, added, link]) {
    const next = Actions.setReaction({ ...profile, workspaceId: w }, { ...snapshot }, 'bookmarked', true, { expectedRevision: profile.revision, now: T(++minute) });
    const result = await store.saveDiscoveryActions(w, next, profile.revision);
    assert.equal(result.status, 'stored'); profile = result.profile;
  }
  assert.equal(profile.revision, 3); assert.deepEqual(urls(profile), [legacy.canonicalUrl, added.canonicalUrl, link.canonicalUrl].sort());
  assert.equal(Old.actions(raw(keys.legacy)), true, 'the stored legacy row is what the earlier validator accepts');
  assert.deepEqual(raw(keys.legacy).entries.map(row => row.canonicalUrl), [legacy.canonicalUrl]);
  assert.deepEqual(raw(keys.extended).entries.map(row => row.canonicalUrl).sort(), [added.canonicalUrl, link.canonicalUrl].sort());
  assert.deepEqual(await store.readDiscoveryActions(w), profile);
  // Each save tells the changed document to the account sync and the pair's revision to the screen.
  assert.deepEqual(events.filter(event => event.type === 'account_doc_changed').map(event => event.key), [keys.legacy, keys.extended, keys.extended]);
  assert.deepEqual(events.filter(event => event.type === 'discovery_actions_changed').map(event => event.revision), [1, 2, 3]);
  const listed = (await store.listAccountDocs()).map(doc => doc.key);
  assert.ok(listed.includes(keys.legacy) && listed.includes(keys.extended));
  // A stale base is a conflict against the pair.
  const stale = Actions.setReaction(profile, captured('sbs-news', 1), 'bookmarked', true, { expectedRevision: 3, now: T(9) });
  assert.equal((await store.saveDiscoveryActions(w, { ...stale, revision: 3 }, 2)).status, 'conflict');
  // An applied row of either document reports the pair's revision.
  const applied = Actions.setReaction(raw(keys.extended), captured('owid', 1), 'bookmarked', true, { expectedRevision: raw(keys.extended).revision, now: T(10) });
  events.length = 0;
  assert.equal((await store.applyAccountDoc(keys.extended, { value: applied, expectedHash: store.accountDocHash(raw(keys.extended)) })).status, 'applied');
  assert.deepEqual(events.filter(event => event.type === 'discovery_actions_changed').map(event => event.revision), [4]);
});

test('storage: a mixed legacy row (written before the pair) is split once before sync lists the documents; its original stays until the move is stored', async t => {
  const { base, store, raw, control } = fixture(); t.after(() => base.close());
  const w = (await store.createWorkspace('익명 섞인 문서')).workspaceId;
  const keys = { legacy: `discoveryActions:${accountKey}:${w}`, extended: `discoveryActionsExtended:${accountKey}:${w}`, reading: `discoveryReading:${accountKey}:${w}`, readingExtended: `discoveryReadingExtended:${accountKey}:${w}` };
  let mixed = Actions.empty(w), minute = 0;
  for (const snapshot of [captured('naver-d2', 1), captured('kakao-tech', 1), found()]) mixed = Actions.setReaction(mixed, snapshot, 'liked', true, { expectedRevision: mixed.revision, now: T(++minute) });
  // As the account delivered it (the earlier single-document form): applied as received.
  assert.equal((await store.applyAccountDoc(keys.legacy, { value: mixed, expectedHash: null })).status, 'applied');
  const comparison = await Reading.createComparison(Reading.empty(w), { ...catalog(Object.keys(Discovery.ALLOWED_SOURCES)), profile: { workspaceId: w, revision: 1, manual: [{ id: 'manual-a', label: '합성' }] } }, { expectedRevision: 0, now: T(5), sessionId: 'mixed-session' });
  assert.equal((await store.applyAccountDoc(keys.reading, { value: comparison, expectedHash: null })).status, 'applied');
  const before = await store.readDiscoveryActions(w);
  // A failed write leaves both rows exactly as they were, and the listing (the sync pass) goes on.
  const original = { legacy: structuredClone(raw(keys.legacy)), reading: structuredClone(raw(keys.reading)) };
  control.beforeWrite = ({ value, abort }) => { if (value?.key === keys.extended || value?.key === keys.readingExtended) { const error = new DOMException('quota', 'QuotaExceededError'); abort(error); throw error; } };
  await store.listAccountDocs();
  assert.deepEqual(raw(keys.legacy), original.legacy); assert.equal(raw(keys.extended), undefined);
  assert.deepEqual(raw(keys.reading), original.reading); assert.equal(raw(keys.readingExtended), undefined);
  control.beforeWrite = null;
  await store.listAccountDocs();
  assert.equal(Old.actions(raw(keys.legacy)), true); assert.equal(Old.reading(raw(keys.reading)), true);
  assert.equal(raw(keys.legacy).entries.length, 1); assert.equal(raw(keys.extended).entries.length, 2);
  assert.equal(raw(keys.readingExtended).session.id, 'mixed-session'); assert.equal(raw(keys.reading).session, null);
  const after = await store.readDiscoveryActions(w);
  assert.deepEqual(urls(after), urls(before), 'the profile still holds every reaction');
  assert.equal((await store.readDiscoveryReading(w)).session.id, 'mixed-session');
  // Both documents now go to the account; a second pass moves nothing.
  const listed = (await store.listAccountDocs()).filter(doc => Object.values(keys).includes(doc.key));
  assert.equal(listed.length, 4); assert.ok(listed.every(doc => !doc.sync || doc.hash !== doc.sync.hash), 'every changed document is pending');
  assert.equal(raw(keys.legacy).revision, mixed.revision + 1, 'moved once');
});
