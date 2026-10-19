const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const CI = require('../scripts/refresh-discovery-artifact.cjs');
const Core = require('../assets/life/discovery.js');

const BEFORE = '2026-10-18T12:00:00Z';
const NOW = '2026-10-19T12:00:00Z';
const stamp = () => Date.parse(NOW);
const bytes = value => Buffer.from(JSON.stringify(value));
const oldWorker = async () => ({ status: 200, bytes: Buffer.from("const CACHE='haedo-v129';\n") });
function seed() {
  const rights = { mode: 'metadata_only', label: '공식 제목과 링크', url: null };
  const sources = Object.entries(Core.ALLOWED_SOURCES).map(([id, hosts]) => ({ id, name: id,
    url: `https://${hosts[0]}/`, feedUrl: `https://${hosts[0]}/feed`, language: 'ko', rights,
    status: 'ok', lastSuccessAt: BEFORE, lastAttemptAt: BEFORE, fetchedAt: BEFORE, error: null, stale: false }));
  return { schemaVersion: 1, generatedAt: BEFORE, sources,
    articles: sources.map(source => ({ id: 'article-' + source.id + '-' + crypto.createHash('sha256').update(source.url + 'article-' + source.id).digest('hex').slice(0, 20), sourceId: source.id,
      url: source.url + 'article-' + source.id, canonicalUrl: source.url + 'article-' + source.id, title: '공개 합성 기사', publishedAt: BEFORE, dateStatus: 'valid',
      author: null, language: 'ko', tags: [], summary: '', coverage: 'link_only', rights, fetchedAt: BEFORE })) };
}
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'haedo-discovery-ci-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const f = CI.files(root);
  fs.mkdirSync(path.dirname(f.tracked), { recursive: true });
  fs.writeFileSync(f.tracked, bytes(seed()));
  fs.copyFileSync(path.resolve(__dirname, '../assets/life/discovery.js'), f.core);
  return { root, f };
}
function fakeUpdater({ failures = [], exitCode, mutate } = {}) {
  return ({ candidate, report }) => {
    const next = JSON.parse(fs.readFileSync(candidate)); next.generatedAt = NOW;
    for (const source of next.sources) {
      source.lastAttemptAt = NOW;
      if (failures.includes(source.id)) { source.status = 'error'; source.error = '합성 수집 실패'; source.stale = true; }
      else {
        source.status = 'ok'; source.error = null; source.stale = false; source.lastSuccessAt = NOW; source.fetchedAt = NOW;
        for (const article of next.articles.filter(article => article.sourceId === source.id)) article.fetchedAt = NOW;
      }
    }
    if (mutate) mutate(next);
    fs.writeFileSync(candidate, bytes(next));
    const okSources = next.sources.filter(source => source.status === 'ok').length;
    fs.writeFileSync(report, bytes({ okSources, sourceCount: next.sources.length, articleCount: next.articles.length }));
    return exitCode ?? (failures.length ? 2 : 0);
  };
}

test('only approved repository/main push, schedule and manual contexts can collect', () => {
  const valid = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'wonchance-art/life-haedo', GITHUB_REF: 'refs/heads/main' };
  for (const event of ['push', 'schedule', 'workflow_dispatch']) assert.doesNotThrow(() => CI.assertWorkflowContext({ ...valid, GITHUB_EVENT_NAME: event }));
  for (const changed of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'pull_request_target' },
    { GITHUB_REPOSITORY: 'someone/fork' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_ACTIONS: 'false' }]) {
    assert.throws(() => CI.assertWorkflowContext({ ...valid, GITHUB_EVENT_NAME: 'schedule', ...changed }));
  }
});

test('previous publication seeds partial failure instead of regressing to tracked baseline', async t => {
  const w = workspace(t), previous = seed(), id = previous.sources[0].id;
  previous.articles[0].title = '직전 게시본에서 확보한 새 제목';
  const tracked = fs.readFileSync(w.f.tracked);
  const result = await CI.collect({ root: w.root, clock: stamp, fetchBootstrapWorker: oldWorker,
    fetchSeed: async () => ({ status: 200, bytes: bytes(previous) }), runUpdater: fakeUpdater({ failures: [id] }) });
  assert.equal(result.seedKind, 'previous-publication'); assert.equal(result.partialFailure, true);
  const next = JSON.parse(fs.readFileSync(w.f.candidate));
  assert.deepEqual(next.articles[0], previous.articles[0]);
  assert.equal(next.sources[0].lastSuccessAt, BEFORE); assert.equal(next.sources[0].lastAttemptAt, NOW);
  assert.equal(next.sources[1].lastSuccessAt, NOW); assert.deepEqual(fs.readFileSync(w.f.tracked), tracked);
});

test('404 with independently verified pre-catalog worker permits tracked bootstrap', async t => {
  const w = workspace(t);
  const result = await CI.collect({ root: w.root, clock: stamp, fetchBootstrapWorker: oldWorker, fetchSeed: async () => ({ status: 404 }), runUpdater: fakeUpdater() });
  assert.equal(result.seedKind, 'verified-pre-catalog-404-bootstrap'); assert.equal(result.collectorExitCode, 0);
  assert.equal(result.okSources, Object.keys(Core.ALLOWED_SOURCES).length);
  assert.equal(result.bootstrapProof.cacheVersion, 129);
});

for (const failure of ['v130', 'v132', 'missing-version', 'worker404', 'backported-catalog']) {
  test(`catalog 404 with ${failure} is fatal instead of resetting last-good to Git`, async t => {
    const w = workspace(t); let called = false;
    const body = failure === 'missing-version' ? 'not a worker version' :
      failure === 'backported-catalog' ? "const CACHE='haedo-v129';\nconst feed='discovery-feed.json';" : `const CACHE='haedo-${failure}';`;
    await assert.rejects(CI.collect({ root: w.root, clock: stamp, fetchSeed: async () => ({ status: 404 }),
      fetchBootstrapWorker: async () => ({ status: failure === 'worker404' ? 404 : 200, bytes: Buffer.from(body) }),
      runUpdater: () => { called = true; return 0; } }));
    assert.equal(called, false); assert.equal(fs.existsSync(w.f.candidate), false);
  });
}

test('the reviewed v133 legacy worker remains allowed by exact SHA, not version alone', () => {
  const legacy = fs.readFileSync(path.resolve(__dirname, 'fixtures/external-discovery/sw-pre-catalog-v133.js'));
  const proof = CI.verifyPreCatalogWorker({ status: 200, bytes: legacy });
  assert.equal(proof.cacheVersion, 133); assert.equal(proof.sha256, CI.LEGACY_BOOTSTRAP_SHA256);
  assert.equal(proof.rule, 'approved-exact-pre-catalog-deployment');
  assert.throws(() => CI.verifyPreCatalogWorker({ status: 200, bytes: Buffer.concat([legacy, Buffer.from('\n')]) }));
  assert.throws(() => CI.verifyPreCatalogWorker({ status: 200, bytes: Buffer.from(legacy.toString().replace('haedo-v133', 'haedo-v135')) }));
  assert.throws(() => CI.verifyPreCatalogWorker({ status: 200, bytes: Buffer.from("/*\nconst CACHE='haedo-v129';\n*/") }));
});

test('reviewed main58e5cd5 v134 is allowed exactly while changed v134 and unknown v135 are denied', () => {
  const legacy = fs.readFileSync(path.resolve(__dirname, 'fixtures/external-discovery/sw-pre-catalog-v134.js'));
  const proof = CI.verifyPreCatalogWorker({ status: 200, bytes: legacy });
  assert.equal(proof.cacheVersion, 134);
  assert.equal(proof.sha256, 'cb4fd4ed6112856883eab180fc3d390eae7693e835d2407b77fac3ce67ba9967');
  assert.equal(proof.sha256, CI.LEGACY_BOOTSTRAP_WORKERS[134]);
  assert.equal(proof.rule, 'approved-exact-pre-catalog-deployment');
  assert.throws(() => CI.verifyPreCatalogWorker({ status: 200, bytes: Buffer.concat([legacy, Buffer.from('\n')]) }));
  assert.throws(() => CI.verifyPreCatalogWorker({ status: 200, bytes: Buffer.from(legacy.toString().replace('haedo-v134', 'haedo-v135')) }));
});

for (const failure of ['503', 'bad-json', 'invalid-utf8', 'future', 'unknown-host', 'missing-source', 'invalid-row', 'content']) {
  test(`bad publication ${failure} never falls back to tracked data or starts collection`, async t => {
    const w = workspace(t), prior = seed(); let called = false;
    if (failure === 'future') prior.generatedAt = '2027-01-01T00:00:00Z';
    if (failure === 'unknown-host') prior.articles[0].url = 'https://unapproved.invalid/post';
    if (failure === 'missing-source') prior.sources.pop();
    if (failure === 'invalid-row') prior.articles[0].title = '';
    if (failure === 'content') prior.articles[0].bodyText = '원문을 복사하면 안 됨';
    let encoded = bytes(prior);
    if (failure === 'invalid-utf8') {
      const title = Buffer.from('공개 합성 기사'), start = encoded.indexOf(title);
      encoded = Buffer.concat([encoded.subarray(0, start), Buffer.from([0xff]), encoded.subarray(start + title.length)]);
    }
    const response = failure === '503' ? { status: 503 } : { status: 200, bytes: failure === 'bad-json' ? Buffer.from('{') : encoded };
    await assert.rejects(CI.collect({ root: w.root, clock: stamp, fetchBootstrapWorker: oldWorker, fetchSeed: async () => response,
      runUpdater: () => { called = true; return 0; } }));
    assert.equal(called, false); assert.equal(JSON.parse(fs.readFileSync(w.f.outcome)).status, 'failed');
    assert.equal(fs.existsSync(w.f.candidate), false);
  });
}

for (const failure of ['all-failed', 'fatal', 'bad-report-exit', 'lost-lastgood', 'rewrote-fetch-time', 'rewrote-date-status']) {
  test(`unpublishable collection ${failure} preserves tracked bytes and cannot install`, async t => {
    const w = workspace(t), tracked = fs.readFileSync(w.f.tracked), ids = Object.keys(Core.ALLOWED_SOURCES);
    const config = failure === 'all-failed' ? { failures: ids } : failure === 'fatal' ? { exitCode: 1 } :
      failure === 'bad-report-exit' ? { exitCode: 2 } : { failures: [ids[0]], mutate: next => {
        if (failure === 'lost-lastgood') next.articles = next.articles.filter(article => article.sourceId !== ids[0]);
        else if (failure === 'rewrote-date-status') next.articles.find(article => article.sourceId === ids[0]).dateStatus = 'future';
        else next.articles.find(article => article.sourceId === ids[0]).fetchedAt = NOW;
      } };
    await assert.rejects(CI.collect({ root: w.root, clock: stamp, fetchBootstrapWorker: oldWorker, fetchSeed: async () => ({ status: 404 }), runUpdater: fakeUpdater(config) }));
    assert.deepEqual(fs.readFileSync(w.f.tracked), tracked);
    assert.throws(() => CI.install({ root: w.root, clock: stamp }));
  });
}

test('prepared artifact receives exactly the verified bytes while tracked feed remains unchanged', async t => {
  const w = workspace(t), tracked = fs.readFileSync(w.f.tracked);
  const result = await CI.collect({ root: w.root, clock: stamp, fetchBootstrapWorker: oldWorker, fetchSeed: async () => ({ status: 404 }), runUpdater: fakeUpdater() });
  fs.mkdirSync(path.dirname(w.f.artifact), { recursive: true });
  fs.writeFileSync(path.join(w.f.site, '.haedo-generated-site.json'), JSON.stringify({ generator: 'haedo-prepare-site', version: 1 }));
  fs.copyFileSync(w.f.tracked, w.f.artifact);
  const installed = CI.install({ root: w.root, clock: stamp });
  assert.equal(installed.artifactSHA256, result.candidateSHA256);
  assert.deepEqual(fs.readFileSync(w.f.artifact), fs.readFileSync(w.f.candidate));
  assert.deepEqual(fs.readFileSync(w.f.tracked), tracked);
});

test('candidate tampering and symlink outputs cannot enter the Pages artifact', async t => {
  const w = workspace(t);
  await CI.collect({ root: w.root, clock: stamp, fetchBootstrapWorker: oldWorker, fetchSeed: async () => ({ status: 404 }), runUpdater: fakeUpdater() });
  fs.appendFileSync(w.f.candidate, ' ');
  assert.throws(() => CI.install({ root: w.root, clock: stamp }), /changed before installation/);
  const other = workspace(t); fs.mkdirSync(path.join(other.root, '.local'), { recursive: true });
  fs.symlinkSync(os.tmpdir(), other.f.directory, 'dir');
  await assert.rejects(CI.collect({ root: other.root, clock: stamp }), /symlinks/);
});

function transport(status, body = Buffer.from('{}'), extra = {}) {
  const calls = [];
  const request = (url, options, callback) => {
    calls.push({ url, options }); const req = new EventEmitter();
    req.destroy = error => process.nextTick(() => req.emit('error', error));
    process.nextTick(() => {
      const response = new EventEmitter(); response.statusCode = status;
      response.headers = { 'content-type': 'application/json', ...extra }; response.resume = () => {};
      callback(response);
      if (status === 200) { response.emit('data', body); response.emit('end'); }
    });
    return req;
  };
  return { calls, request };
}
test('publication HTTP client fixes origin/path, sends no credentials and follows no redirect', async () => {
  const success = transport(200); assert.equal((await CI.fetchPublished(success.request)).status, 200);
  assert.equal(success.calls[0].url, CI.PUBLISHED_URL);
  assert.deepEqual(Object.keys(success.calls[0].options.headers).sort(), ['Accept', 'Accept-Encoding', 'Cache-Control', 'User-Agent']);
  for (const status of [301, 302, 401, 403, 500]) {
    const fixture = transport(status); await assert.rejects(CI.fetchPublished(fixture.request)); assert.equal(fixture.calls.length, 1);
  }
  assert.deepEqual(await CI.fetchPublished(transport(404).request), { status: 404 });
  await assert.rejects(CI.fetchPublished(transport(200, Buffer.alloc(CI.MAX_BYTES + 1)).request), /size limit/);
  await assert.rejects(CI.fetchPublished(transport(200, Buffer.from('{}'), { 'content-type': 'text/html' }).request), /response type/);
  await assert.rejects(CI.fetchPublished(transport(200, Buffer.from('{}'), { 'content-length': String(CI.MAX_BYTES + 1) }).request), /Content-Length/);
  await assert.rejects(CI.fetchPublished(transport(200, Buffer.from('{}'), { 'content-length': '10' }).request), /incomplete/);
});

test('aborted or prematurely closed publication responses never become a successful seed', async () => {
  for (const event of ['aborted', 'close']) {
    const request = (_url, _options, callback) => {
      const req = new EventEmitter(); req.destroy = error => req.emit('error', error);
      process.nextTick(() => {
        const response = new EventEmitter(); response.statusCode = 200;
        response.headers = { 'content-type': 'application/json' }; response.resume = () => {};
        callback(response); response.emit('data', Buffer.from('{')); response.emit(event);
      }); return req;
    };
    await assert.rejects(CI.fetchPublished(request), /aborted|closed/);
  }
});

test('real existing Python updater and fixture XML integrate with seed/validation/partial preservation', async t => {
  const w = workspace(t), fixture = path.join(w.root, 'fixtures'); fs.mkdirSync(fixture);
  const ids = Object.keys(Core.ALLOWED_SOURCES);
  for (const [id, hosts] of Object.entries(Core.ALLOWED_SOURCES)) {
    fs.writeFileSync(path.join(fixture, id + '.robots.txt'), 'User-agent: *\nAllow: /\n');
    if (id === ids[0]) continue; // Actual partial-failure path, with a prior article to retain.
    fs.writeFileSync(path.join(fixture, id + '.xml'), `<rss><channel><item><title>새 공개 합성 기사</title><link>https://${hosts[0]}/fresh-${id}</link><pubDate>2026-10-19T10:00:00Z</pubDate></item></channel></rss>`);
  }
  const result = await CI.collect({ root: w.root, clock: stamp, fetchBootstrapWorker: oldWorker, fetchSeed: async () => ({ status: 404 }),
    runUpdater: ({ candidate, report }) => {
      const child = spawnSync('python3', [path.resolve(__dirname, '../scripts/update-discovery-feed.py'), '--output', candidate,
        '--report', report, '--fixtures', fixture, '--now', NOW], { encoding: 'utf8' });
      assert.equal(child.error, undefined); return child.status;
    } });
  assert.equal(result.collectorExitCode, 2); assert.equal(result.okSources, ids.length - 1);
  assert.equal(JSON.parse(fs.readFileSync(w.f.candidate)).articles.find(article => article.sourceId === ids[0]).title, '공개 합성 기사');
});

test('Pages schedule preserves all required checks and least-privilege publication gates', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/pages.yml'), 'utf8');
  assert.match(workflow, /cron: ['"]15 6 \* \* \*['"]/);
  assert.match(workflow, /needs: \[check, browser, blog\]/);
  assert.match(workflow, /github\.repository == 'wonchance-art\/life-haedo'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /run: node scripts\/refresh-discovery-artifact\.cjs collect/);
  assert.match(workflow, /run: node scripts\/refresh-discovery-artifact\.cjs install/);
  assert.ok(workflow.indexOf('refresh-discovery-artifact.cjs install') < workflow.indexOf('actions/upload-pages-artifact'));
  const build = workflow.slice(workflow.indexOf('\n  build:'), workflow.indexOf('\n  deploy:'));
  assert.match(build, /contents: read\n      pages: read/); assert.doesNotMatch(build, /id-token: write|continue-on-error/);
  assert.match(workflow.slice(workflow.indexOf('\n  deploy:')), /pages: write\n      id-token: write/);
});
