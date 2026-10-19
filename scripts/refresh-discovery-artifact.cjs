#!/usr/bin/env node
'use strict';

// Public metadata only. Refresh an isolated copy, then install it in a prepared
// Pages artifact. Never commit the catalog or read personal settings/documents.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const Discovery = require('../assets/life/discovery.js');

const ROOT = path.resolve(__dirname, '..');
const PUBLISHED_URL = 'https://wonchance-art.github.io/life-haedo/assets/life/discovery-feed.json';
const PUBLISHED_SW_URL = 'https://wonchance-art.github.io/life-haedo/sw.js';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SW_BYTES = 256 * 1024;
// Reviewed default-branch legacy workers: version numbers advanced on another
// branch before this catalog existed. Only these exact bytes authorize bootstrap.
const LEGACY_BOOTSTRAP_SHA256 = '645102f365bb8135683fb7e611baf571e780e765c46dd50d570c34ede1a16da9';
const LEGACY_BOOTSTRAP_WORKERS = Object.freeze({
  133: LEGACY_BOOTSTRAP_SHA256,
  // origin/main 58e5cd55f73fb440c997266e160d8859f18bfd6c; CACHE-only bump.
  134: 'cb4fd4ed6112856883eab180fc3d390eae7693e835d2407b77fac3ce67ba9967',
});
const REQUEST_TIMEOUT_MS = 20000;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function assertWorkflowContext(env = process.env) {
  assert(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === 'wonchance-art/life-haedo' &&
    env.GITHUB_REF === 'refs/heads/main' && ['push', 'schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME),
  'Public collection requires the approved repository and default branch deployment context.');
}

function noSymlinks(target) {
  let cursor = path.parse(target).root;
  for (const piece of target.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, piece);
    try { assert(!fs.lstatSync(cursor).isSymbolicLink(), 'Public artifact paths must not contain symlinks.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function files(root = ROOT) {
  const directory = path.join(root, '.local/discovery-ci');
  return { directory, tracked: path.join(root, 'assets/life/discovery-feed.json'),
    core: path.join(root, 'assets/life/discovery.js'), seed: path.join(directory, 'seed.json'),
    candidate: path.join(directory, 'candidate.json'), report: path.join(directory, 'collector-report.json'),
    outcome: path.join(directory, 'outcome.json'), site: path.join(root, '.local/site'),
    artifact: path.join(root, '.local/site/assets/life/discovery-feed.json') };
}

function readBounded(file) {
  noSymlinks(file);
  const stat = fs.statSync(file);
  assert(stat.isFile() && stat.size <= MAX_BYTES, 'Public catalog is not a bounded regular file.');
  return fs.readFileSync(file);
}

function atomic(file, bytes) {
  noSymlinks(file);
  const temporary = file + '.tmp-' + crypto.randomBytes(8).toString('hex');
  try { fs.writeFileSync(temporary, bytes, { flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
}
const writeJSON = (file, value) => atomic(file, Buffer.from(JSON.stringify(value, null, 2) + '\n'));

function validateCatalog(bytes, now = Date.now()) {
  assert(Buffer.isBuffer(bytes) && bytes.length <= MAX_BYTES, 'Public catalog exceeds the size limit.');
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const checked = Discovery.validateFeed(raw, { now }); // Never inject an external allowlist.
  const sourceIds = Object.keys(Discovery.ALLOWED_SOURCES).sort();
  assert(same(raw.sources.map(source => source.id).sort(), sourceIds), 'The approved source set changed.');
  assert(Date.parse(raw.generatedAt) <= now, 'Public catalog generation time is in the future.');
  assert(checked.validation.invalid.length === 0 && checked.articles.length === raw.articles.length && raw.articles.length > 0,
    'Public catalog contains rejected or missing articles.');
  for (const source of raw.sources) {
    assert(source.rights.mode === 'metadata_only', 'Only reviewed public metadata is allowed.');
    for (const field of ['lastSuccessAt', 'lastAttemptAt']) {
      assert(source[field] === null || Date.parse(source[field]) <= now, 'Public source receipt is in the future.');
    }
    assert(source.fetchedAt === undefined || source.fetchedAt === source.lastSuccessAt, 'Source fetch/success receipt mismatch.');
  }
  for (const article of raw.articles) {
    assert(article.coverage === 'link_only' && article.rights.mode === 'metadata_only' && article.summary === '' &&
      !Object.hasOwn(article, 'bodyText') && !Object.hasOwn(article, 'description') && !Object.hasOwn(article, 'content'),
    'Article content exceeds the reviewed metadata scope.');
    assert(Date.parse(article.fetchedAt) <= now, 'Article fetch receipt is in the future.');
  }
  // Publisher dates marked future remain metadata; they are not fetch receipts
  // and the existing Core excludes them from publication-date ranking.
  return raw;
}

function fetchPublicResource(resource, request) {
  const isCatalog = resource === 'catalog';
  const url = isCatalog ? PUBLISHED_URL : PUBLISHED_SW_URL;
  const limit = isCatalog ? MAX_BYTES : MAX_SW_BYTES;
  return new Promise((resolve, reject) => {
    let timer, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); error ? reject(error) : resolve(result);
    };
    const req = request(url, { headers: {
      'User-Agent': 'HaedoPublicFeedCI/1.0 (public catalog continuity)',
      Accept: isCatalog ? 'application/json' : 'application/javascript, text/javascript',
      'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache',
    } }, response => {
      let ended = false;
      response.on('error', error => finish(error));
      response.on('aborted', () => finish(new Error('Published public catalog response was aborted.')));
      response.on('close', () => { if (!ended) finish(new Error('Published public catalog response closed before completion.')); });
      const stop = message => {
        finish(new Error(message));
        if (typeof response.destroy === 'function') response.destroy(); else response.resume();
      };
      // No redirect handling, credentials, cookies, browser state or custom URL.
      if (response.statusCode === 404) { response.resume(); finish(null, { status: 404 }); return; }
      if (response.statusCode !== 200) { stop('Published public catalog HTTP ' + response.statusCode); return; }
      const contentType = isCatalog ? /^application\/json(?:\s*;|$)/i : /^(?:application|text)\/(?:x-)?javascript(?:\s*;|$)/i;
      if (!contentType.test(response.headers['content-type'] || '') ||
          !['', 'identity'].includes((response.headers['content-encoding'] || '').toLowerCase())) {
        stop('Published public catalog response type is invalid.'); return;
      }
      const declared = response.headers['content-length'];
      if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
        stop('Published public catalog Content-Length exceeds the size limit or is invalid.'); return;
      }
      const chunks = []; let length = 0;
      response.on('data', chunk => {
        if (settled) return;
        length += chunk.length;
        if (length > limit) { stop('Published public catalog exceeds size limit.'); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        ended = true;
        if (declared !== undefined && length !== Number(declared)) { finish(new Error('Published public catalog length is incomplete.')); return; }
        if (length <= limit) finish(null, { status: 200, bytes: Buffer.concat(chunks) });
      });
    });
    timer = setTimeout(() => req.destroy(new Error('Published public catalog request timed out.')), REQUEST_TIMEOUT_MS);
    req.on('error', error => finish(error));
  });
}

const fetchPublished = (request = https.get) => fetchPublicResource('catalog', request);
const fetchPublishedWorker = (request = https.get) => fetchPublicResource('worker', request);

function verifyPreCatalogWorker(response) {
  assert(response.status === 200 && Buffer.isBuffer(response.bytes) && response.bytes.length <= MAX_SW_BYTES,
    'Catalog 404 requires a readable pre-catalog published service worker.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(response.bytes);
  const versions = [...text.matchAll(/^\s*const\s+CACHE\s*=\s*(['"])haedo-v(\d+)\1\s*;/gm)];
  const version = versions.length === 1 ? Number(versions[0][2]) : NaN;
  const leading = text.match(/^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*const\s+CACHE\s*=\s*(['"])haedo-v(\d+)\1\s*;/);
  const digest = sha(response.bytes), legacy = digest === LEGACY_BOOTSTRAP_WORKERS[version];
  assert(leading && Number(leading[2]) === version && Number.isSafeInteger(version) && version > 0 && (version < 130 || legacy) &&
    !/discovery-feed\.json|haedo-discovery-feed/.test(text),
  'Catalog 404 after catalog introduction or without a verified old version must stop deployment.');
  return { url: PUBLISHED_SW_URL, cacheVersion: version, sha256: digest,
    rule: legacy ? 'approved-exact-pre-catalog-deployment' : 'pre-catalog-version' };
}

function runUpdater({ root, candidate, report }) {
  const child = spawnSync('python3', [path.join(root, 'scripts/update-discovery-feed.py'), '--output', candidate, '--report', report],
    { encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024 });
  if (child.error) throw new Error('Public feed updater could not complete.');
  return child.status;
}

function checkCollection(seed, next, report, exitCode) {
  const successes = next.sources.filter(source => source.status === 'ok').length;
  assert((exitCode === 0 || exitCode === 2) && successes > 0 && report.okSources === successes &&
    report.sourceCount === next.sources.length && report.articleCount === next.articles.length,
  'No verified public source succeeded, or the collection report is inconsistent.');
  assert(exitCode === (successes === next.sources.length ? 0 : 2), 'Updater exit status contradicts the collection report.');
  assert(Date.parse(next.generatedAt) >= Date.parse(seed.generatedAt), 'Collection clock moved behind the previous publication.');
  for (const source of next.sources.filter(source => source.status === 'error')) {
    const old = seed.sources.find(item => item.id === source.id);
    assert(old && source.lastSuccessAt === old.lastSuccessAt && source.stale === true, 'Failed source lost its last success receipt.');
    const before = seed.articles.filter(article => article.sourceId === source.id);
    const after = next.articles.filter(article => article.sourceId === source.id);
    assert(before.length === after.length, 'Failed source lost last-good articles.');
    for (const prior of before) {
      const kept = after.find(article => article.id === prior.id);
      assert(kept && ['url', 'canonicalUrl', 'title', 'publishedAt', 'dateStatus', 'updatedAt', 'updatedDateStatus', 'dateBasis', 'author', 'tags', 'fetchedAt'].every(field => same(kept[field], prior[field])),
        'Failed source rewrote last-good article metadata.');
    }
  }
}

async function collect(options = {}) {
  const root = options.root || ROOT, clock = options.clock || Date.now, f = files(root);
  noSymlinks(f.directory); fs.mkdirSync(f.directory, { recursive: true });
  // Other local evidence may live here, but never overwrite a prior CI receipt.
  for (const name of ['seed', 'candidate', 'report', 'outcome']) assert(!fs.existsSync(f[name]), 'Refusing to overwrite an existing collection receipt.');
  const tracked = readBounded(f.tracked), trackedSHA256 = sha(tracked), coreSHA256 = sha(readBounded(f.core));
  const outcome = { schemaVersion: 1, status: 'failed', publishedCatalogURL: PUBLISHED_URL, trackedSHA256, coreSHA256 };
  try {
    const response = await (options.fetchSeed || fetchPublished)();
    assert(response.status === 200 || response.status === 404, 'Published catalog did not return 200 or initial 404.');
    outcome.seedHTTPStatus = response.status;
    if (response.status === 404) {
      outcome.bootstrapProof = verifyPreCatalogWorker(await (options.fetchBootstrapWorker || fetchPublishedWorker)());
    }
    const bytes = response.status === 404 ? tracked : response.bytes;
    const seed = validateCatalog(bytes, clock());
    outcome.seedKind = response.status === 404 ? 'verified-pre-catalog-404-bootstrap' : 'previous-publication';
    outcome.seedSHA256 = sha(bytes); outcome.seedGeneratedAt = seed.generatedAt;
    atomic(f.seed, bytes); atomic(f.candidate, bytes);
    const exitCode = (options.runUpdater || runUpdater)({ root, candidate: f.candidate, report: f.report });
    outcome.collectorExitCode = exitCode;
    assert(exitCode === 0 || exitCode === 2, 'Public feed updater failed; deployment is stopped.');
    const candidateBytes = readBounded(f.candidate), next = validateCatalog(candidateBytes, clock());
    const report = JSON.parse(readBounded(f.report));
    checkCollection(seed, next, report, exitCode);
    assert(sha(readBounded(f.tracked)) === trackedSHA256, 'Tracked public catalog was modified.');
    Object.assign(outcome, { status: 'collected', candidateSHA256: sha(candidateBytes), generatedAt: next.generatedAt,
      okSources: report.okSources, sourceCount: report.sourceCount, articleCount: next.articles.length,
      partialFailure: exitCode === 2, sources: next.sources.map(source => ({ id: source.id, status: source.status,
        lastSuccessAt: source.lastSuccessAt, lastAttemptAt: source.lastAttemptAt, stale: source.stale, error: source.error })) });
    writeJSON(f.outcome, outcome); return outcome;
  } catch (error) {
    outcome.error = error.message; writeJSON(f.outcome, outcome); throw error;
  }
}

function install(options = {}) {
  const root = options.root || ROOT, f = files(root), outcome = JSON.parse(readBounded(f.outcome));
  assert(outcome.status === 'collected', 'No successful collection is available to publish.');
  assert(sha(readBounded(f.tracked)) === outcome.trackedSHA256 && sha(readBounded(f.core)) === outcome.coreSHA256,
    'Tracked catalog or validator changed after collection.');
  const bytes = readBounded(f.candidate);
  assert(sha(bytes) === outcome.candidateSHA256, 'Collected catalog changed before installation.');
  validateCatalog(bytes, (options.clock || Date.now)());
  const marker = JSON.parse(readBounded(path.join(f.site, '.haedo-generated-site.json')));
  assert(marker.generator === 'haedo-prepare-site' && marker.version === 1, 'Target is not a prepared public site.');
  readBounded(f.artifact); // Require a regular existing allowlisted output.
  atomic(f.artifact, bytes);
  assert(sha(readBounded(f.artifact)) === outcome.candidateSHA256, 'Pages catalog hash differs from the verified collection.');
  Object.assign(outcome, { status: 'installed', artifactSHA256: outcome.candidateSHA256 });
  writeJSON(f.outcome, outcome); return outcome;
}

if (require.main === module) {
  (async () => {
    assertWorkflowContext();
    const command = process.argv[2];
    assert(process.argv.length === 3 && ['collect', 'install'].includes(command), 'Use collect or install with the fixed public artifact paths.');
    const result = command === 'collect' ? await collect() : install();
    console.log(JSON.stringify(result));
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { PUBLISHED_URL, PUBLISHED_SW_URL, MAX_BYTES, MAX_SW_BYTES, LEGACY_BOOTSTRAP_SHA256, LEGACY_BOOTSTRAP_WORKERS, assertWorkflowContext, validateCatalog,
  fetchPublished, fetchPublishedWorker, verifyPreCatalogWorker, checkCollection, collect, install, files };
