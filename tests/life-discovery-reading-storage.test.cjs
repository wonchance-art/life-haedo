'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js');
const Core = require('../assets/life/core.js');
const Discovery = require('../assets/life/discovery.js');
const Interest = require('../assets/life/interest-profile.js');
const Feedback = require('../assets/life/discovery-profile.js');
const Settings = require('../assets/life/discovery-settings.js');
const Languages = require('../assets/life/discovery-language-settings.js');
const Actions = require('../assets/life/discovery-actions.js');
const Reading = require('../assets/life/discovery-reading.js');

// Transactional fault injection; independent browser tests use real IndexedDB.
function memoryAdapter() {
  const schemas = new Map(), rows = new Map();
  const control = { transactions: [], failRead: null, failWrite: null, failCompletion: false };
  const key = value => JSON.stringify(value);
  function connection() {
    let closed = false;
    return {
      objectStoreNames: { contains: name => schemas.has(name) },
      createObjectStore(name, options) { schemas.set(name, options.keyPath); rows.set(name, new Map()); return { createIndex() {} }; },
      close() { closed = true; },
      transaction(names, mode) {
        if (closed) throw new DOMException('closed', 'InvalidStateError');
        control.transactions.push({ names: [...names], mode });
        const working = new Map(names.map(name => [name, structuredClone(rows.get(name))]));
        let finished = false, resolve, reject;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; });
        const abort = (error = new DOMException('aborted', 'AbortError')) => { if (!finished) { finished = true; reject(error); } };
        function store(name) {
          const map = working.get(name); if (!map) throw Error('store missing');
          const valueKey = value => Array.isArray(schemas.get(name)) ? schemas.get(name).map(field => value[field]) : value[schemas.get(name)];
          async function write(method, value) {
            if (finished) throw new DOMException('inactive', 'InvalidStateError');
            assert.equal(mode, 'readwrite');
            control.beforeWrite?.({ name, method, value });
            if (control.failWrite?.name === name && control.failWrite.method === method) {
              control.failWrite = null; const error = new DOMException('quota', 'QuotaExceededError'); abort(error); throw error;
            }
            const encoded = key(method === 'delete' ? value : valueKey(value));
            if (method === 'delete') map.delete(encoded);
            else { if (method === 'add' && map.has(encoded)) throw new DOMException('duplicate', 'ConstraintError'); map.set(encoded, structuredClone(value)); }
            control.afterWrite?.({ name, method, value }); return method === 'delete' ? value : valueKey(value);
          }
          return {
            async get(value) {
              if (control.failRead?.name === name && (!control.failRead.key || control.failRead.key === value)) {
                control.failRead = null; throw new DOMException('read failed', 'UnknownError');
              }
              return structuredClone(map.get(key(value)));
            },
            async getAll() { return structuredClone([...map.values()]); },
            async getAllKeys() { return [...map.keys()].map(JSON.parse); },
            put: value => write('put', value), add: value => write('add', value), delete: value => write('delete', value),
            index(field) { return { async getAll(value) { return structuredClone([...map.values()].filter(row => row[field] === value)); } }; }
          };
        }
        setImmediate(() => {
          if (finished) return;
          if (control.failCompletion) { control.failCompletion = false; abort(); return; }
          finished = true;
          if (mode === 'readwrite') for (const [name, values] of working) rows.set(name, values);
          resolve();
        });
        return { done, objectStore: store, abort };
      }
    };
  }
  return { rows, schemas, control, idb: { async openDB(name, version, callbacks) { const db = connection(); if (!schemas.size) callbacks.upgrade(db, 0, version); return db; } } };
}
const accountA = { projectUrl: 'https://discovery-test.supabase.co', userId: 'anonymous-a' };
const accountB = { projectUrl: 'https://discovery-test.supabase.co', userId: 'anonymous-b' };
const otherProject = { projectUrl: 'https://other-discovery-test.supabase.co', userId: 'anonymous-a' };
const NOW = '2026-10-19T05:00:00.000Z';
const article = { id: 'public-article', canonicalUrl: 'https://example.org/article?id=1' };
const opts = expectedRevision => ({ expectedRevision, now: NOW });
const rowKey = (workspaceId, account = accountA) => `discoveryReading:${JSON.stringify([account.projectUrl, account.userId])}:${workspaceId}`;
const dependencies = { core: Core, interestProfile: Interest, discoveryProfile: Feedback, discoverySettings: Settings,
  discoveryActions: Actions, discoveryLanguageSettings: Languages, discoveryReading: Reading };
function fixture() {
  const adapter = memoryAdapter();
  return { ...adapter, storage: createStorage({ ...dependencies, idb: adapter.idb, channelFactory: null }) };
}
async function imported(storage) {
  const bundle = await storage.createWorkspace('합성 읽기 평가 검증');
  const prepared = await Core.prepareImport({ origin: 'other', title: '보존할 원문', text: '\ufeff가😀나\r\nCafe\u0301  저장할 원문입니다.', url: article.canonicalUrl, authorRelation: 'unknown' }, bundle);
  await storage.commitLocal({ workspaceId: bundle.workspaceId, operationId: Core.id(), baseRevision: bundle.revision, changes: Core.buildImportChanges(bundle, prepared) });
  return storage.read(bundle.workspaceId);
}
async function comparison(workspaceId) {
  const rights = { label: '합성 공개 메타데이터만', url: null, mode: 'metadata_only' };
  const host = Discovery.ALLOWED_SOURCES['naver-d2'][0];
  const feed = { schemaVersion: 1, generatedAt: NOW,
    sources: [{ id: 'naver-d2', name: '합성 출처', url: `https://${host}/`, feedUrl: `https://${host}/feed`, language: 'ko', rights,
      status: 'ok', stale: false, lastSuccessAt: NOW, lastAttemptAt: NOW, error: null }],
    articles: [{ id: 'synthetic-reading', sourceId: 'naver-d2', title: '공개 지도 연구', url: `https://${host}/reading-test`, author: null,
      language: 'ko', tags: ['지도'], publishedAt: NOW, fetchedAt: NOW, summary: '', coverage: 'link_only', rights }] };
  return Reading.createComparison(Reading.empty(workspaceId), { feed, profile: { workspaceId, manual: [{ id: 'manual-map', label: '지도' }] },
    feedback: [], knownUrls: [], contentLanguages: null, actions: null, translationTarget: 'original', personalAllowed: false },
    { ...opts(0), sessionId: 'synthetic-session' });
}

test('reading comparison is private metadata; rereads and clear preserve source, existing states, backups and sync', async t => {
  const { storage: base, rows, control } = fixture(); t.after(() => base.close());
  const store = base.forAccount(accountA), bundle = await imported(store), w = bundle.workspaceId;
  const interest = Interest.setManual(Interest.empty(w), [{ id: 'manual-map', label: '지도' }], opts(0));
  const feedback = Feedback.setFeedback(Feedback.empty(w), article, 'already_read', opts(0));
  const settings = Settings.update(Settings.empty(w), { autoRefresh: true }, opts(0));
  const languages = Languages.update(Languages.empty(w), { contentLanguages: ['en'], translationTarget: 'ko' }, opts(0));
  const actions = Actions.setPersonalization(Actions.empty(w), true, opts(0));
  await store.saveInterestProfile(w, interest, 0); await store.saveDiscoveryProfile(w, feedback, 0);
  await store.saveDiscoverySettings(w, settings, 0); await store.saveDiscoveryLanguageSettings(w, languages, 0); await store.saveDiscoveryActions(w, actions, 0);
  const metaBefore = structuredClone(rows.get('meta')), readsBefore = control.transactions.length;
  assert.deepEqual(await store.readDiscoveryReading(w), Reading.empty(w)); await store.readDiscoveryReading(w);
  assert.deepEqual(rows.get('meta'), metaBefore); assert.ok(control.transactions.slice(readsBefore).every(tx => tx.mode === 'readonly'));
  const candidate = await comparison(w), saved = await store.saveDiscoveryReading(w, candidate, 0);
  assert.equal(saved.status, 'stored'); assert.deepEqual(saved.profile, candidate);
  saved.profile.session = null; assert.deepEqual(await store.readDiscoveryReading(w), candidate);
  const answered = Reading.setReview(candidate, candidate.session.reviews[0].canonicalUrl,
    { intent: 'yes', reading: 'partial', helpful: 'yes' }, opts(1));
  assert.equal((await store.saveDiscoveryReading(w, answered, 1)).status, 'stored');
  assert.deepEqual(await store.readDiscoveryReading(w), answered);
  assert.equal(JSON.stringify(Actions.exportCopy(actions, { now: NOW })).includes('synthetic-session'), false);
  assert.equal(JSON.stringify(Core.makeBackup(await store.read(w))).includes('synthetic-session'), false);
  const binding = { ...accountA, remoteId: w }; await store.bindSync(w, binding);
  const upload = await store.prepareSyncUpload(w, binding); assert.deepEqual(upload.data, bundle);
  assert.equal(JSON.stringify(upload).includes('synthetic-session'), false);
  const cleared = Reading.clear(answered, opts(2));
  assert.equal((await store.saveDiscoveryReading(w, cleared, 2)).status, 'stored');
  assert.deepEqual(await store.saveDiscoveryReading(w, candidate, 0), { status: 'conflict', profile: cleared });
  assert.equal(cleared.deleted, true); assert.equal(cleared.session, null);
  assert.deepEqual(rows.get('meta').get(JSON.stringify(rowKey(w))).value, cleared);
  assert.deepEqual(await store.read(w), bundle);
  assert.deepEqual(await store.readInterestProfile(w), interest); assert.deepEqual(await store.readDiscoveryProfile(w), feedback);
  assert.deepEqual(await store.readDiscoverySettings(w), settings); assert.deepEqual(await store.readDiscoveryLanguageSettings(w), languages);
  assert.deepEqual(await store.readDiscoveryActions(w), actions);
  for (const [key, row] of metaBefore) assert.deepEqual(rows.get('meta').get(key), row);
});

test('workspace, user, project and closed scope isolate reading states and reject foreign writes', async t => {
  const { storage: base } = fixture(); t.after(() => base.close());
  const a = base.forAccount(accountA), bundle = await imported(a), w = bundle.workspaceId, candidate = await comparison(w);
  await a.saveDiscoveryReading(w, candidate, 0);
  const second = await a.createWorkspace('다른 합성 공간');
  await assert.rejects(a.saveDiscoveryReading(second.workspaceId, candidate, 0), { code: 'workspace_mismatch' });
  assert.deepEqual(await a.readDiscoveryReading(second.workspaceId), Reading.empty(second.workspaceId));
  for (const account of [accountB, otherProject]) {
    const foreign = base.forAccount(account);
    await assert.rejects(foreign.readDiscoveryReading(w), { code: 'workspace_access_denied' });
    await assert.rejects(foreign.saveDiscoveryReading(w, candidate, 0), { code: 'workspace_access_denied' });
  }
  await assert.rejects(a.readDiscoveryReading(w), { code: 'storage_scope_closed' });
  await assert.rejects(a.saveDiscoveryReading(w, candidate, 0), { code: 'storage_scope_closed' });
  await assert.rejects(base.readDiscoveryReading(w), { code: 'auth_scope_required' });
  assert.deepEqual(await base.forAccount(accountA).readDiscoveryReading(w), candidate);
});

test('missing reading row means empty, while failed lookup and corrupt row fail closed without replacement', async t => {
  const { storage: base, rows, control } = fixture(); t.after(() => base.close());
  const store = base.forAccount(accountA), bundle = await imported(store), w = bundle.workspaceId;
  control.failRead = { name: 'meta', key: rowKey(w) };
  await assert.rejects(store.readDiscoveryReading(w), { code: 'storage_error' });
  assert.deepEqual(await store.readDiscoveryReading(w), Reading.empty(w));
  const corrupt = { key: rowKey(w), value: { malformed: true } }; rows.get('meta').set(JSON.stringify(rowKey(w)), corrupt);
  await assert.rejects(store.readDiscoveryReading(w), error => error.code?.startsWith('discovery_reading_'));
  await assert.rejects(store.saveDiscoveryReading(w, await comparison(w), 0), error => error.code?.startsWith('discovery_reading_'));
  assert.deepEqual(rows.get('meta').get(JSON.stringify(rowKey(w))), corrupt);
});

test('put and completion failures keep comparison and notifications intact; explicit retry commits once', async t => {
  for (const failure of ['put', 'completion']) await t.test(failure, async t => {
    const { storage: base, control } = fixture(); t.after(() => base.close());
    const store = base.forAccount(accountA), bundle = await imported(store), w = bundle.workspaceId, candidate = await comparison(w), events = [];
    await store.saveDiscoveryReading(w, candidate, 0); store.subscribe(w, event => events.push(event));
    const cleared = Reading.clear(candidate, opts(1));
    if (failure === 'put') control.failWrite = { name: 'meta', method: 'put' };
    else control.afterWrite = ({ name, value }) => { if (name === 'meta' && value.key === rowKey(w)) { control.failCompletion = true; control.afterWrite = null; } };
    await assert.rejects(store.saveDiscoveryReading(w, cleared, 1), { code: failure === 'put' ? 'storage_quota' : 'storage_aborted' });
    assert.deepEqual(await store.readDiscoveryReading(w), candidate); assert.deepEqual(events, []);
    assert.equal((await store.saveDiscoveryReading(w, cleared, 1)).status, 'stored');
    assert.deepEqual(events, [{ type: 'discovery_reading_changed', workspaceId: w, revision: 2, local: true }]);
    assert.deepEqual(await store.read(w), bundle);
  });
});

test('candidate is snapshotted before await and a revision jump or stale comparison cannot commit', async t => {
  const { storage: base } = fixture(); t.after(() => base.close());
  const store = base.forAccount(accountA), bundle = await imported(store), w = bundle.workspaceId, candidate = await comparison(w), original = structuredClone(candidate);
  await assert.rejects(store.saveDiscoveryReading(w, { ...candidate, revision: 2 }, 0), { code: 'discovery_reading_conflict' });
  const pending = store.saveDiscoveryReading(w, candidate, 0); candidate.session.afterCallMutation = true;
  assert.deepEqual((await pending).profile, original); assert.deepEqual(await store.readDiscoveryReading(w), original);
  const notices = []; store.subscribe(w, event => notices.push(event));
  assert.deepEqual(await store.saveDiscoveryReading(w, original, 0), { status: 'conflict', profile: original }); assert.deepEqual(notices, []);
});

test('account-scoped channel transmits only revision/workspace, strips local and ignores invalid events', async t => {
  const adapter = memoryAdapter(), channels = [], sent = [];
  function channelFactory(name) {
    const channel = { name, closed: false, onmessage: null, close() { this.closed = true; },
      postMessage(data) { sent.push(structuredClone(data)); for (const peer of channels) if (!peer.closed && peer !== channel && peer.name === name) peer.onmessage?.({ data }); } };
    channels.push(channel); return channel;
  }
  const common = { ...dependencies, idb: adapter.idb, channelFactory };
  const first = createStorage({ ...common, account: accountA }), second = createStorage({ ...common, account: accountA }), foreign = createStorage({ ...common, account: accountB });
  t.after(() => { first.close(); second.close(); foreign.close(); });
  const bundle = await imported(first), w = bundle.workspaceId; await second.open(); await foreign.open();
  const own = [], received = [], outside = []; first.subscribe(w, event => own.push(event)); second.subscribe(w, event => received.push(event)); foreign.subscribe(w, event => outside.push(event));
  await first.saveDiscoveryReading(w, await comparison(w), 0);
  assert.deepEqual(received, [{ type: 'discovery_reading_changed', workspaceId: w, revision: 1 }]); assert.deepEqual(outside, []);
  assert.deepEqual(own, [{ type: 'discovery_reading_changed', workspaceId: w, revision: 1, local: true }]);
  const posted = sent.find(row => row.type === 'discovery_reading_changed'); assert.deepEqual(Object.keys(posted).sort(), ['revision', 'sender', 'type', 'workspaceId']);
  const sender = channels.find(channel => channel.name.endsWith(':' + JSON.stringify([accountA.projectUrl, accountA.userId])));
  for (const revision of [0, -1, NaN, '2']) sender.postMessage({ sender: 'invalid', type: 'discovery_reading_changed', workspaceId: w, revision });
  assert.equal(received.length, 1);
  sender.postMessage({ sender: 'remote', type: 'discovery_reading_changed', workspaceId: w, revision: 2, local: true, session: { private: 'must-not-notify' } });
  assert.deepEqual(received[1], { type: 'discovery_reading_changed', workspaceId: w, revision: 2 });
});

test('account replacement before commit aborts the old comparison write without notification or source change', async t => {
  const { storage: base, control, rows } = fixture(); t.after(() => base.close());
  const prior = base.forAccount(accountA), bundle = await imported(prior), w = bundle.workspaceId, candidate = await comparison(w), events = [];
  prior.subscribe(w, event => events.push(event));
  control.beforeWrite = ({ name, value }) => { if (name === 'meta' && value.key === rowKey(w)) { control.beforeWrite = null; base.forAccount(accountB); } };
  await assert.rejects(prior.saveDiscoveryReading(w, candidate, 0), { code: 'storage_scope_closed' });
  assert.equal(rows.get('meta').has(JSON.stringify(rowKey(w))), false); assert.deepEqual(events, []);
  const reopened = base.forAccount(accountA); assert.deepEqual(await reopened.readDiscoveryReading(w), Reading.empty(w)); assert.deepEqual(await reopened.read(w), bundle);
});

// Existing option resets/writers and reaction exports have no access to this independent key.
test('clearing settings, language, feedback or actions preserves the current reading comparison', async t => {
  const { storage: base } = fixture(); t.after(() => base.close());
  const store = base.forAccount(accountA), bundle = await imported(store), w = bundle.workspaceId, candidate = await comparison(w);
  await store.saveDiscoveryReading(w, candidate, 0);
  await store.saveDiscoverySettings(w, Settings.clear(Settings.empty(w), opts(0)), 0);
  await store.saveDiscoveryLanguageSettings(w, Languages.clear(Languages.empty(w), opts(0)), 0);
  await store.saveDiscoveryProfile(w, Feedback.clear(Feedback.empty(w), opts(0)), 0);
  await store.saveDiscoveryActions(w, Actions.clear(Actions.empty(w), opts(0)), 0);
  assert.deepEqual(await store.readDiscoveryReading(w), candidate); assert.deepEqual(await store.read(w), bundle);
});
