'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js');
const Core = require('../assets/life/core.js');
const Profile = require('../assets/life/interest-profile.js');

// Same transactional failure adapter used by life-storage.test.cjs. Real browser
// tests separately exercise actual IDB serialization and cross-tab delivery.
function memoryAdapter() {
  const schemas = new Map(), rows = new Map();
  const control = { opens: 0, closes: 0, callbacks: null, failWrite: null, failCompletion: false, transactions: [] };
  const encode = key => JSON.stringify(key);
  function connection() {
    let closed = false;
    return {
      objectStoreNames: { contains: name => schemas.has(name) },
      createObjectStore(name, options) {
        schemas.set(name, options.keyPath); rows.set(name, new Map());
        return { createIndex() {} };
      },
      close() { if (!closed) { closed = true; control.closes += 1; } },
      transaction(names, mode) {
        if (closed) throw new DOMException('closed', 'InvalidStateError');
        control.transactions.push({ names: [...names], mode });
        const working = new Map(names.map(name => [name, structuredClone(rows.get(name))]));
        let finished = false, resolve, reject;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; });
        function abort(error = new DOMException('aborted', 'AbortError')) {
          if (finished) return;
          finished = true;
          reject(error);
        }
        function store(name) {
          if (!working.has(name)) throw new Error('store not in transaction');
          const map = working.get(name);
          function keyOf(value) {
            const path = schemas.get(name);
            return Array.isArray(path) ? path.map(key => value[key]) : value[path];
          }
          async function write(method, value) {
            if (finished) throw new DOMException('inactive', 'InvalidStateError');
            if (mode !== 'readwrite') throw new Error('readonly');
            if (control.failWrite?.name === name && control.failWrite.method === method) {
              control.failWrite = null;
              const error = new DOMException('quota', 'QuotaExceededError');
              abort(error);
              throw error;
            }
            const key = method === 'delete' ? value : keyOf(value);
            if (method === 'delete') map.delete(encode(key));
            else {
              if (method === 'add' && map.has(encode(key))) throw new DOMException('duplicate', 'ConstraintError');
              map.set(encode(key), structuredClone(value));
            }
            control.afterWrite?.({ name, method, value });
            return key;
          }
          function requestWrite(method, value) {
            // Native IDB requests can throw before returning their promise.
            control.beforeWrite?.({ name, method, value });
            return write(method, value);
          }
          return {
            async get(key) { return structuredClone(map.get(encode(key))); },
            async getAll() { return structuredClone([...map.values()]); },
            async getAllKeys() { return [...map.keys()].map(key => JSON.parse(key)); },
            put: value => requestWrite('put', value), add: value => requestWrite('add', value), delete: key => requestWrite('delete', key),
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
  return {
    control, rows, schemas,
    idb: {
      async openDB(name, version, callbacks) {
        control.opens += 1; control.callbacks = callbacks;
        const db = connection();
        if (!schemas.size) callbacks.upgrade(db, 0, version);
        return db;
      }
    }
  };
}

const accountA = { projectUrl: 'https://interest-test.supabase.co', userId: 'anonymous-a' };
const accountB = { projectUrl: 'https://interest-test.supabase.co', userId: 'anonymous-b' };
function fixture(interestProfile = Profile) {
  const adapter = memoryAdapter();
  const storage = createStorage({ idb: adapter.idb, core: Core, interestProfile, channelFactory: null });
  return { ...adapter, storage };
}
const rowKey = (workspaceId, account = accountA) => `interestProfile:${JSON.stringify([account.projectUrl, account.userId])}:${workspaceId}`;
async function imported(storage) {
  let bundle = await storage.createWorkspace('익명 관심 정보 검증');
  for (const text of ['도시의 숲을 걷고 나무를 관찰한다.', '숲에서 새를 보고 산책 기록을 남긴다.']) {
    const prepared = await Core.prepareImport({ origin: 'other', title: '익명 원문', text, coverage: 'full_text' }, bundle);
    assert.equal((await storage.commitLocal({ workspaceId: bundle.workspaceId, operationId: Core.id(), baseRevision: bundle.revision,
      changes: Core.buildImportChanges(bundle, prepared) })).status, 'stored');
    bundle = await storage.read(bundle.workspaceId);
  }
  return bundle;
}
async function proposal(bundle, current = Profile.empty(bundle.workspaceId)) {
  const docs = bundle.sourceVersions.map(version => ({ sourceId: version.sourceId, sourceVersionId: version.id, sha256: version.contentHash }));
  const evidence = bundle.sourceVersions.map((version, index) => ({ ...docs[index], start: 0, end: 2, quote: version.contentText.slice(0, 2) }));
  return Profile.propose(bundle, current, { workspaceId: bundle.workspaceId, scopeRevision: bundle.revision, limitations: [], analysis: {
    createdAt: '2026-10-19T00:00:00.000Z', model: 'anonymous-fixture-model', modelRevision: 'fixed-fixture-revision', adapter: 'fixture',
    inputFingerprint: 'a'.repeat(64), documents: docs,
    interests: [{ id: 'forest', label: '숲 관찰', kind: 'topic', terms: ['숲'], support: 2, evidence }]
  } }, { sourceVersionIds: docs.map(value => value.sourceVersionId), expectedRevision: current.revision });
}

test('profile CAS is independent, scoped and private; a deletion tombstone blocks delayed resurrection', async t => {
  const { storage: base, rows } = fixture(); t.after(() => base.close());
  let a = base.forAccount(accountA); const bundle = await imported(a), w = bundle.workspaceId;
  const events = []; a.subscribe(w, event => events.push(event));
  assert.deepEqual(await a.readInterestProfile(w), Profile.empty(w));
  const profile = await proposal(bundle), saved = await a.saveInterestProfile(w, profile, 0);
  assert.equal(saved.status, 'stored'); assert.equal(saved.profile.revision, 1); assert.equal(profile.revision, 1);
  saved.profile.manual.push({ id: 'caller-edit', label: '호출자 사본' });
  assert.deepEqual(await a.readInterestProfile(w), profile);
  assert.deepEqual(await a.read(w), bundle);
  assert.equal(JSON.stringify(Core.makeBackup(await a.read(w))).includes('interestProfile'), false);
  assert.deepEqual(events, [{ type: 'interest_profile_changed', workspaceId: w, revision: 1 }]);
  assert.deepEqual(rows.get('meta').get(JSON.stringify(rowKey(w))).value, profile);
  const tombstone = Profile.clear(profile, { expectedRevision: 1 });
  assert.equal((await a.saveInterestProfile(w, tombstone, 1)).status, 'stored');
  assert.deepEqual(await a.saveInterestProfile(w, profile, 0), { status: 'conflict', profile: tombstone });
  a.close();
  a = base.forAccount(accountA);
  assert.deepEqual(await a.readInterestProfile(w), tombstone);
  const b = base.forAccount(accountB);
  await assert.rejects(b.readInterestProfile(w), { code: 'workspace_access_denied' });
  await assert.rejects(b.saveInterestProfile(w, profile, 0), { code: 'workspace_access_denied' });
  await assert.rejects(base.readInterestProfile(w), { code: 'auth_scope_required' });
});

test('failed profile writes and transaction completion preserve the prior row and emit no event', async t => {
  for (const point of ['put', 'completion']) await t.test(point, async t => {
    const { storage: base, control, rows } = fixture(); t.after(() => base.close());
    const a = base.forAccount(accountA), bundle = await imported(a), w = bundle.workspaceId;
    const events = []; a.subscribe(w, event => events.push(event));
    const candidate = Profile.setManual(Profile.empty(w), [{ id: 'walk', label: '산책' }], { expectedRevision: 0 });
    if (point === 'put') control.failWrite = { name: 'meta', method: 'put' };
    else control.afterWrite = ({ name, value }) => {
      if (name === 'meta' && value.key === rowKey(w)) { control.failCompletion = true; control.afterWrite = null; }
    };
    await assert.rejects(a.saveInterestProfile(w, candidate, 0), { code: point === 'put' ? 'storage_quota' : 'storage_aborted' });
    assert.deepEqual(await a.readInterestProfile(w), Profile.empty(w));
    assert.equal(rows.get('meta').has(JSON.stringify(rowKey(w))), false); assert.deepEqual(events, []);
    assert.deepEqual(await a.read(w), bundle);
    assert.equal((await a.saveInterestProfile(w, candidate, 0)).status, 'stored');
  });
});

test('authoritative schema, UTF-8 byte bound and exact evidence digest reject malformed candidates', async t => {
  const { storage: base } = fixture(); t.after(() => base.close());
  const a = base.forAccount(accountA), bundle = await imported(a), w = bundle.workspaceId;
  const candidate = await proposal(bundle);
  const invalid = structuredClone(candidate); invalid.unexpected = 'not accepted';
  await assert.rejects(a.saveInterestProfile(w, invalid, 0), { code: 'interest_profile_invalid' });
  const oversize = structuredClone(candidate); oversize.analysis.limitations = Array(40).fill('한'.repeat(500));
  oversize.analysis.interests = Array.from({ length: 8 }, (_, i) => ({ ...structuredClone(candidate.analysis.interests[0]), id: `interest-${i}`,
    label: '한'.repeat(1000), terms: Array(20).fill('한'.repeat(200)), question: '한'.repeat(4000) }));
  await assert.rejects(a.saveInterestProfile(w, oversize, 0), { code: 'interest_profile_too_large' });
  const corrupt = structuredClone(candidate); corrupt.analysis.interests[0].evidence[0].quote = '거짓';
  await assert.rejects(a.saveInterestProfile(w, corrupt, 0), { code: 'interest_profile_stale' });
  await assert.rejects(a.saveInterestProfile(w, { ...candidate, revision: 2 }, 0), { code: 'interest_profile_conflict' });
  assert.deepEqual(await a.readInterestProfile(w), Profile.empty(w));
});

test('source raw text or author changes after asynchronous verification cannot slip into the write transaction', async t => {
  for (const change of ['raw', 'author', 'source']) await t.test(change, async t => {
    let duringRevalidate;
    const checking = { ...Profile, async revalidate(bundle, candidate) { await Profile.revalidate(bundle, candidate); duringRevalidate?.(); return true; } };
    const { storage: base, rows } = fixture(checking); t.after(() => base.close());
    const a = base.forAccount(accountA), bundle = await imported(a), w = bundle.workspaceId;
    const candidate = await proposal(bundle);
    duringRevalidate = () => {
      const current = rows.get('bundles').get(JSON.stringify(w));
      if (change === 'raw') current.sourceVersions[0].contentText = '변조된 원문';
      else if (change === 'author') current.sourceVersions[0].originalAuthor = { relation: 'other', label: '다른 작성자' };
      else current.sources[0].title = '선택 원천 변경';
    };
    await assert.rejects(a.saveInterestProfile(w, candidate, 0), { code: 'interest_profile_stale' });
    assert.deepEqual(await a.readInterestProfile(w), Profile.empty(w));
  });
});

test('account replacement while hashing blocks the old profile write', async t => {
  let afterHash;
  const checking = { ...Profile, async revalidate(bundle, candidate) { await Profile.revalidate(bundle, candidate); afterHash?.(); } };
  const { storage: base, rows } = fixture(checking); t.after(() => base.close());
  const a = base.forAccount(accountA), bundle = await imported(a), candidate = await proposal(bundle);
  afterHash = () => base.forAccount(accountB);
  await assert.rejects(a.saveInterestProfile(bundle.workspaceId, candidate, 0), { code: 'storage_scope_closed' });
  assert.equal(rows.get('meta').has(JSON.stringify(rowKey(bundle.workspaceId))), false);
});

test('a competing profile saved during hashing wins CAS and is returned without an overwrite', async t => {
  let duringRevalidate;
  const checking = { ...Profile, async revalidate(bundle, candidate) {
    await Profile.revalidate(bundle, candidate);
    if (candidate.analysis) await duringRevalidate?.();
  } };
  const { storage: base } = fixture(checking); t.after(() => base.close());
  const a = base.forAccount(accountA), bundle = await imported(a), w = bundle.workspaceId;
  const candidate = await proposal(bundle), winner = Profile.clear(Profile.empty(w), { expectedRevision: 0 });
  duringRevalidate = () => a.saveInterestProfile(w, winner, 0);
  assert.deepEqual(await a.saveInterestProfile(w, candidate, 0), { status: 'conflict', profile: winner });
  assert.deepEqual(await a.readInterestProfile(w), winner);
});

test('a retained contentHash cannot authenticate modified raw content; unrelated records do not invalidate exact evidence', async t => {
  const { storage: base, rows } = fixture(); t.after(() => base.close());
  const a = base.forAccount(accountA), bundle = await imported(a), w = bundle.workspaceId;
  const candidate = await proposal(bundle), current = rows.get('bundles').get(JSON.stringify(w));
  const original = current.sourceVersions[0].contentText;
  current.sourceVersions[0].contentText = '다른 본문';
  await assert.rejects(a.saveInterestProfile(w, candidate, 0), { code: 'interest_profile_stale' });
  current.sourceVersions[0].contentText = original;
  current.title = '선택 근거와 무관한 작업공간 제목'; current.revision += 1;
  assert.equal((await a.saveInterestProfile(w, candidate, 0)).status, 'stored');
  assert.equal((await a.read(w)).title, current.title);
});

test('account-scoped channel events contain only workspace/revision and malformed or foreign notifications stay isolated', async t => {
  const adapter = memoryAdapter(), channels = [];
  function channelFactory(name) {
    const channel = { name, onmessage: null, closed: false, close() { this.closed = true; },
      postMessage(data) { for (const peer of channels) if (!peer.closed && peer !== channel && peer.name === name) peer.onmessage?.({ data }); } };
    channels.push(channel); return channel;
  }
  const options = { idb: adapter.idb, core: Core, interestProfile: Profile, channelFactory };
  const a = createStorage({ ...options, account: accountA }), second = createStorage({ ...options, account: accountA });
  const foreign = createStorage({ ...options, account: accountB });
  t.after(() => { a.close(); second.close(); foreign.close(); });
  const bundle = await imported(a), w = bundle.workspaceId;
  await second.open(); await foreign.open();
  const received = [], other = []; second.subscribe(w, event => received.push(event)); foreign.subscribe(w, event => other.push(event));
  const manual = Profile.setManual(Profile.empty(w), [{ id: 'walk', label: '걷기' }], { expectedRevision: 0 });
  assert.equal((await a.saveInterestProfile(w, manual, 0)).status, 'stored');
  assert.deepEqual(received, [{ type: 'interest_profile_changed', workspaceId: w, revision: 1 }]); assert.deepEqual(other, []);
  const sending = channels.find(channel => channel.name.endsWith(':' + JSON.stringify([accountA.projectUrl, accountA.userId])));
  for (const revision of [0, -1, NaN, '2']) sending.postMessage({ sender: 'invalid-sender', type: 'interest_profile_changed', workspaceId: w, revision });
  assert.equal(received.length, 1);
});

