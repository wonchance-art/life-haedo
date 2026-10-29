/* Bounded public upstream checks only. Default invocation performs no fetch.
 * A recent official runtime observation is a prerequisite, not an access grant;
 * the session proxy remains the final network enforcement point. */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { collect, feedURL } from '../supabase/functions/haedo-naver-blog/collector.mjs';
import { createNetwork, readBytes, imageMetadata } from '../supabase/functions/haedo-naver-blog/harvest-network.mjs';
import { parseInventory, extractHTML, imageURL, sha256 } from '../supabase/functions/haedo-naver-blog/extractor.mjs';

const CORE_HOSTS = ['rss.blog.naver.com', 'blog.naver.com'];
const SOURCES = ['public', 'rss', 'all'];
const CDNS = new Set(['blogfiles.pstatic.net', 'postfiles.pstatic.net', 'mblogthumb-phinf.pstatic.net', 'blogthumb.pstatic.net', 'post-phinf.pstatic.net']);
const problem = code => Object.assign(new Error(code), { code });
const need = (value, code) => { if (!value) throw problem(code); };
const safeCode = error => /^[a-z][a-z0-9_]{0,79}$/.test(error?.code || '') ? error.code : 'request_failed';
function snapshotAllows(snapshot, host) {
  if (snapshot?.version !== 1) return false;
  const policy = snapshot.http_network_policy;
  return policy?.type === 'unrestricted' || policy?.type === 'restricted' && policy.egress_rules?.some(rule => rule.host === host);
}
function observationAllows(observation, host) {
  const policy = observation?.network_policy;
  return policy?.mode === 'unrestricted' || policy?.mode === 'restricted' && policy.effective_allowed_hosts?.includes(host);
}
export async function probeNaver({ blogId, postNo, probe = false, photos = 0, source = 'all', snapshot, observation, fetcher = fetch, load, now = Date.now(), signal } = {}) {
  const coreHosts = CORE_HOSTS.filter(host => source === 'all' || source === 'rss' && host === 'rss.blog.naver.com' || source === 'public' && host === 'blog.naver.com');
  const report = { version: 1, mode: probe ? 'public_probe' : 'diagnostic', source: SOURCES.includes(source) ? source : null, sources: { rss: source === 'all' || source === 'rss' ? 'not_checked' : 'not_selected', public: source === 'all' || source === 'public' ? 'not_checked' : 'not_selected' }, status: 'planned', operationalReadinessVerified: false, targetConfigured: !!blogId, postSelection: source === 'rss' ? 'not_selected' : postNo ? 'explicit_post' : 'first_inventory_entry', photosRequested: photos, requests: [], policy: { snapshotOnly: !observation, coreHosts: coreHosts.map(host => ({ host, snapshotAllowed: snapshotAllows(snapshot, host), observedAllowed: observationAllows(observation, host) })) }, scope: 'Read-only selected-source samples, not full collection or operational verification; no Auth, account records, uploads, scheduler changes or collection activation. No body, title, URL or target identifiers are emitted.' };
  let stage = 'arguments';
  try {
    need(typeof probe === 'boolean' && [0, 1].includes(photos) && SOURCES.includes(source), 'invalid_arguments');
    need(source !== 'rss' || photos === 0 && postNo === undefined, 'invalid_arguments');
    if (blogId !== undefined) feedURL(blogId);
    need(postNo === undefined || typeof postNo === 'string' && /^[1-9][0-9]{0,29}$/.test(postNo), 'invalid_arguments');
    if (!probe) return report;
    need(typeof blogId === 'string', 'blog_required');
    stage = 'policy';
    need(snapshot?.version === 1, 'policy_snapshot_required');
    need(observation?.observations_current === true && observation?.network_policy?.state === 'enforced', 'current_policy_observation_required');
    const observed = Date.parse(observation.observed_at);
    need(Number.isFinite(observed) && observed <= now + 60000 && now - observed <= 300000, 'policy_observation_expired');
    if (observation.spec_revision !== undefined || observation.observed_spec_revision !== undefined) need(observation.spec_revision === observation.observed_spec_revision, 'policy_observation_mismatch');
    const allowed = host => snapshotAllows(snapshot, host) && observationAllows(observation, host);
    need(coreHosts.every(allowed), 'required_host_not_allowed');
    if (fetcher === globalThis.fetch && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)) {
      const proxyFlag = process.execArgv.includes('--use-env-proxy') || process.env.NODE_USE_ENV_PROXY === '1' || /(?:^|\s)--use-env-proxy(?:\s|$)/.test(process.env.NODE_OPTIONS || '');
      need(process.allowedNodeEnvironmentFlags.has('--use-env-proxy') && proxyFlag, 'proxy_configuration_required');
    }
    if (source !== 'rss' && !load) {
      try { const require = createRequire(new URL('../tests/fixtures/naver-extractor/package.json', import.meta.url)); need(require('cheerio/package.json').version === '1.2.0', 'extractor_dependency_mismatch'); load = require('cheerio/slim').load; }
      catch (error) { throw problem(error?.code === 'extractor_dependency_mismatch' ? error.code : 'extractor_dependency_missing'); }
    }
    const started = Date.now(), deadline = started + 80000;
    const guardedFetch = async (raw, options = {}) => {
      const url = new URL(raw), host = url.hostname;
      need(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && (coreHosts.includes(host) || source !== 'rss' && CDNS.has(host)), 'invalid_public_target');
      need(allowed(host), 'required_host_not_allowed');
      need(now + Date.now() - started - observed <= 300000, 'policy_observation_expired');
      need((options.method || 'GET') === 'GET' && options.redirect === 'error', 'invalid_public_request');
      const headers = new Headers(options.headers);
      need(!headers.has('authorization') && !headers.has('apikey') && options.body === undefined, 'invalid_public_request');
      const row = { stage, host, status: null, bytes: 0, sha256: null }; report.requests.push(row);
      const response = await fetcher(url.href, options); row.status = response.status;
      if (response.redirected || response.url && response.url !== url.href) { await response.body?.cancel(); throw problem('blocked'); }
      if (!response.ok) return response;
      const limit = url.pathname === '/robots.txt' ? 128 * 1024 : host === 'rss.blog.naver.com' || url.pathname === '/PostTitleListAsync.naver' ? 2 * 1024 * 1024 : CDNS.has(host) ? 16 * 1024 * 1024 : 4 * 1024 * 1024;
      const bytes = await readBytes(response, limit); row.bytes = bytes.length; row.sha256 = await sha256(bytes);
      return new Response(bytes, { status: response.status, headers: response.headers });
    };
    if (source !== 'public') {
      stage = 'rss';
      const feed = await collect(blogId, { fetcher: guardedFetch, signal });
      report.feed = { entries: feed.length, coverage: Object.fromEntries(['partial', 'link_only'].map(kind => [kind, feed.filter(value => value.coverage === kind).length])) };
      report.sources.rss = 'checked';
      if (source === 'rss') { report.status = 'checked'; return report; }
    }
    const network = createNetwork({ fetcher: guardedFetch, signal, deadline });
    const decode = result => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.bytes);
    stage = 'inventory';
    const inventoryURL = 'https://blog.naver.com/PostTitleListAsync.naver?' + new URLSearchParams({ blogId, currentPage: '1', categoryNo: '0', countPerPage: '30' });
    const inventory = parseInventory(decode(await network.resource(inventoryURL, 'html', 2 * 1024 * 1024)), { blogId });
    report.inventory = { sampledPage: 1, entries: inventory.entries.length, reportedTotal: inventory.total, hasMore: inventory.has_more, fullInventoryVerified: !inventory.has_more };
    const selected = postNo || inventory.entries[0]?.log_no;
    if (!selected) { report.status = 'checked'; report.sources.public = 'checked'; report.postSelection = 'no_inventory_entry'; return report; }
    stage = 'post';
    const postURL = 'https://blog.naver.com/PostView.naver?' + new URLSearchParams({ blogId, logNo: selected });
    const extracted = await extractHTML(decode(await network.resource(postURL, 'html', 4 * 1024 * 1024)), { load, blogId, logNo: selected });
    report.post = { coverage: extracted.coverage, bodyBytes: extracted.content_text === null ? 0 : new TextEncoder().encode(extracted.content_text).length, bodyHash: extracted.content_hash, editorVersion: extracted.editor_version, photos: extracted.images.length, links: extracted.links.length, summaryRequired: extracted.summary_required, omissionCodes: ['original_photo_unverified', 'video_comments_attachments_excluded', ...(extracted.summary_required ? ['folded_body_not_probed'] : []), ...(extracted.unsupported.length ? ['unsupported_components'] : [])], photoHosts: [...new Set(extracted.images.map(value => new URL(imageURL(value.url)).hostname))].map(host => ({ host, allowed: allowed(host) })) };
    if (photos && extracted.images.length) {
      stage = 'photo';
      // Fail before even CDN robots if this exact origin is unapproved.
      const url = imageURL(extracted.images[0].url); need(allowed(new URL(url).hostname), 'required_host_not_allowed');
      const resource = await network.resource(url, 'image', 16 * 1024 * 1024);
      report.photo = { ...imageMetadata(resource.bytes, resource.type), sha256: await sha256(resource.bytes), originalStatus: 'unverified', decodeVerified: false };
    }
    report.status = 'checked'; report.sources.public = 'checked'; return report;
  } catch (error) {
    report.status = 'blocked'; report.blockedStage = stage; report.code = safeCode(error);
    if (stage === 'rss') report.sources.rss = 'blocked';
    if (['inventory', 'post', 'photo'].includes(stage)) report.sources.public = 'blocked';
    return report;
  }
}

export function parseArguments(args) {
  const value = { probe: false, photos: 0 };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--probe') { need(!value.probe, 'invalid_arguments'); value.probe = true; }
    else if (['--blog', '--post', '--photos', '--policy-status', '--source'].includes(key)) {
      const name = { '--blog': 'blogId', '--post': 'postNo', '--photos': 'photos', '--policy-status': 'policyStatus', '--source': 'source' }[key];
      need(args[i + 1] !== undefined && !args[i + 1].startsWith('--') && (name === 'photos' ? value.photos === 0 : value[name] === undefined), 'invalid_arguments');
      const item = args[++i]; if (name === 'photos') need(item === '1', 'invalid_arguments');
      if (name === 'source') need(SOURCES.includes(item), 'invalid_arguments');
      value[name] = name === 'photos' ? 1 : item;
    } else throw problem('invalid_arguments');
  }
  value.source ??= 'all';
  need(value.source !== 'rss' || value.photos === 0 && value.postNo === undefined, 'invalid_arguments');
  return value;
}
async function main() {
  let report;
  try {
    const options = parseArguments(process.argv.slice(2));
    const snapshot = JSON.parse(await readFile('/etc/codex/network-policy.json', 'utf8'));
    let observation;
    if (options.policyStatus) { try { observation = JSON.parse(await readFile(options.policyStatus, 'utf8')); } catch (_) { throw problem('policy_observation_unreadable'); } }
    report = await probeNaver({ ...options, snapshot, observation });
  } catch (error) { report = { version: 1, status: 'blocked', code: safeCode(error), requests: [] }; }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.status === 'blocked') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
