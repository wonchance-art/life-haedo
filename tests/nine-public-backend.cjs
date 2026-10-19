'use strict';
/* Existing page SQL/SDK contract under isolated synthetic roles, never production. */
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { LocalSQLNineCloud } = require('./nine-public-sql-fixture.cjs'), { accounts } = require('./life-sync-browser.cjs');
const Remote = require('../assets/life/nine-public-remote.js'), Model = require('../assets/life/nine-public.js'), Nine = require('../assets/life/nine-board.js');
const Core = require('../assets/life/core.js'), Source = require('../assets/life/source-reference.js'), ShareRemote = require('../assets/life/share-remote.js');
async function main() {
  const server = new LocalSQLNineCloud({ container: process.env.BLOG_POSTGRES_CONTAINER, database: process.env.BLOG_POSTGRES_DATABASE + '_nine_contract' });
  await server.prepare(); await server.initialize();
  const owner = accounts.a.id, workspaceId = randomUUID(), seriesId = randomUUID(), board = Nine.create(randomUUID), area = board.areas[0];
  board.title = '비공개 구성'; board.intro = '구성 소개 비공개'; area.title = '나의 책과 음악'; area.note = '영역 개인 메모';
  area.items = [Nine.snapshot({ type: 'book', title: '전체 제목 🌱', creator: '한글 저자', url: 'https://example.org/book?edition=2#exact' }),
    Nine.snapshot({ type: 'music', title: '음악 제목', creator: '음악가', url: '' })];
  area.items[0].reason = '개인 선택 이유';
  const otherArea = { id: randomUUID(), title: '다른 영역', note: '다른 개인 메모', items: [Nine.snapshot({ type: 'other', title: '선택하지 않은 항목' })] }; board.areas.push(otherArea);
  let state = { ...Nine.empty(workspaceId), format: 'life-nine-board-v2', revision: 3, boards: [board] };
  let bundle = Core.createWorkspace({ workspaceId }); const imported = await Core.prepareImport({ origin: 'obsidian', title: '개인 정확 근거', text: '비공개 정확 구절\r\n원문 전체 본문', authorRelation: 'other' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, imported));
  const reference = await Source.build({ bundle, sourceId: imported.source.id, versionId: imported.version.id, locator: { start: 0, end: 9 } });
  area.items[0].reference = { kind: 'source', value: reference };
  const options = { boardId: board.id, areaId: area.id, title: '직접 공개한 취향', intro: '직접 적은 소개' }, calls = [], backing = new Map(); let lost = false, nextVerify = null;
  const auth = { ready: true, user: { id: owner }, epoch: 0, config: { url: 'https://anonymous.supabase.co', key: 'sb_publishable_fixture' },
    async verify() { const task = nextVerify; nextVerify = null; return task ? task() : auth.user; }, onAccountChange() { return () => {}; },
    client: { rpc(name, args) { calls.push({ name, args: structuredClone(args) }); return { abortSignal() { return this; }, async then(resolve, reject) {
      try { const data = server.rpc(auth.user.id, name, args); if (lost && name.endsWith('_put')) { lost = false; throw TypeError('lost SQL acknowledgement'); } return resolve({ data, error: null }); } catch (error) { return reject(error); }
    } }; } } };
  const receiptStorage = { getItem: key => backing.get(key) ?? null, setItem: (key, value) => backing.set(key, value), removeItem: key => backing.delete(key) };
  const local = { async readNineBoard(id) { assert.equal(id, workspaceId); return structuredClone(state); } };
  const create = () => Remote.create({ auth, storage: local, receiptStorage, workspaceId, publicFetch: (url, request) => fetch(url, request), baseURL: 'https://anonymous.example/app/index.html' }); let remote = create();
  const fetch = async (url, request) => Response.json(server.rpc(null, new URL(url).pathname.split('/').at(-1), JSON.parse(request.body)));
  const reader = ShareRemote.createReader({ config: auth.config, fetch });
  const output = path.resolve(__dirname, '../.local/nine-public-backend'); await fs.mkdir(output, { recursive: true });
  const report = { checks: [], pass: false, scope: 'Actual existing page SQL and JS decoders in isolated PostgreSQL. Auth/SDK/fetch/local storage fixture simulated. No hosted project or operational writes.' };
  const check = async (name, run) => { await run(); report.checks.push(name); console.log('PASS ' + name); };
  const read = id => server.rpc(null, 'life_public_page_read', { p_public_id: id });
  let publication, snapshot, sentinels;
  try {
    await check('area slot publishes exact allowlisted v2 metadata while existing workspace, series and other area pages remain byte-equivalent', async () => {
      sentinels = [workspaceId, seriesId, otherArea.id].map((id, index) => {
        const result = server.rpc(owner, 'life_public_page_put', { p_workspace_id: id, p_expected_revision: 0, p_operation_id: randomUUID(), p_action: 'publish', p_snapshot: { format: 'life-share-v1', title: '기존 페이지 ' + index, intro: null, entries: [] } });
        return { id, publicId: result.publicId, before: read(result.publicId) };
      });
      const review = await remote.prepare(options); publication = await remote.publish(review, { expectedRevision: 0 }); assert.equal(publication.status, 'stored'); assert.match(publication.url, /taste\.html\?nine=/);
      snapshot = read(publication.publicId).snapshot; assert.deepEqual(Model.parse(snapshot).items.slice(0, 2), area.items.map(item => item.attachment));
      for (const hidden of [workspaceId, board.id, area.id, seriesId, board.intro, area.note, '개인 선택 이유', reference.quote, reference.sourceId, reference.sourceVersionId, reference.contentHash, 'reference', 'locator', '선택하지 않은 항목']) assert(!JSON.stringify(snapshot).includes(hidden), hidden);
      assert.equal(server.sql('select count(*) from public.life_public_pages;'), 4);
      for (const row of sentinels) assert.deepEqual(read(row.publicId), row.before);
    });
    await check('local revision, same-revision selected change and auth.verify wait races all stop before actual SQL dispatch', async () => {
      const review = await remote.prepare(options), before = calls.length; state.revision++;
      await assert.rejects(remote.publish(review, { expectedRevision: 1 }), { code: 'local_changed' }); assert.equal(calls.length, before);
      const current = await remote.prepare(options); state.boards[0].areas[0].items[0].attachment.title = '선택 항목을 바꿈';
      await assert.rejects(remote.publish(current, { expectedRevision: 1 }), { code: 'local_changed' }); assert.equal(calls.length, before);
      const pendingReview = await remote.prepare(options); let enter, release; const entered = new Promise(resolve => { enter = resolve; }), waiting = new Promise(resolve => { release = resolve; });
      nextVerify = async () => { enter(); await waiting; return auth.user; }; const pending = remote.publish(pendingReview, { expectedRevision: 1 }); await entered; state.revision++; release();
      await assert.rejects(pending, { code: 'local_changed' }); assert.equal(calls.length, before); assert.equal(backing.size, 0); assert.deepEqual(read(publication.publicId).snapshot, snapshot);
    });
    await check('actual CAS consumes approval, and lost SQL reply replays the same receipt after local edits and adapter reload', async () => {
      const fresh = await remote.prepare(options), clash = await remote.publish(fresh, { expectedRevision: 0 }); assert.equal(clash.status, 'conflict');
      assert.throws(() => remote.publish(fresh, { expectedRevision: 1 }), { code: 'invalid_review' });
      const reviewed = await remote.prepare(options); lost = true; await assert.rejects(remote.publish(reviewed, { expectedRevision: 1 }), { code: 'publish_unknown' });
      const original = calls.filter(row => row.name.endsWith('_put')).at(-1); assert((await remote.getState(area.id)).pending);
      remote.dispose(); state.revision++; state.boards[0].areas[0].items[0].attachment.title = '재시도에 섞으면 안 되는 편집'; remote = create();
      const replay = await remote.retry(area.id); assert.equal(replay.status, 'stored'); assert.equal(replay.publicId, publication.publicId); assert.equal(replay.revision, 2);
      assert.deepEqual(calls.filter(row => row.name.endsWith('_put')).at(-1), original); assert.equal((await remote.getState(area.id)).pending, false);
      assert.equal(read(publication.publicId).snapshot.entries[0].attachments[0].title, '선택 항목을 바꿈'); assert.equal(server.sql('select count(*) from public.life_public_pages;'), 4);
    });
    await check('anonymous parsing, owner boundaries, independent revoke and rotated republish preserve unrelated pages and original local data', async () => {
      const before = structuredClone(state), publicRead = await reader.read(publication.publicId); assert.equal(Model.parse(publicRead.snapshot).items.length, 9);
      const writeCount = calls.filter(row => row.name.endsWith('_put')).length, resumed = await remote.getPublished(area.id);
      assert.equal(resumed.state.revision, 2); assert.deepEqual(resumed.snapshot, publicRead.snapshot); assert.equal(resumed.snapshot.intro, options.intro);
      assert.equal(calls.filter(row => row.name.endsWith('_put')).length, writeCount);
      assert.equal(server.rpc(accounts.b.id, 'life_public_page_get', { p_workspace_id: area.id }).status, 'missing');
      assert.throws(() => server.rpc(null, 'life_public_page_get', { p_workspace_id: area.id }), error => error.code === '42501');
      assert.throws(() => server.sql('select count(*) from public.life_public_pages;', { owner, role: 'authenticated' }), error => error.code === '42501');
      assert.equal((await remote.revoke(area.id, { expectedRevision: 2 })).status, 'stored'); assert.deepEqual(await reader.read(publication.publicId), { status: 'missing' });
      assert.equal((await remote.getPublished(area.id)).snapshot, null);
      const next = await remote.publish(await remote.prepare(options), { expectedRevision: 3 }); assert.notEqual(next.publicId, publication.publicId); assert.equal(read(publication.publicId).status, 'missing');
      for (const row of sentinels) assert.deepEqual(read(row.publicId), row.before); assert.deepEqual(state, before); assert.equal(server.sql('select count(*) from public.life_public_pages;'), 4);
    });
    report.pass = true;
  } finally { remote.dispose(); reader.dispose(); report.actualSdkRpcCalls = calls.length; await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
