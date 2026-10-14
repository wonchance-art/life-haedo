/* Anonymous generated-site and real service-worker upgrade gate.
 * Requires complete Git history and the existing pinned browser tooling.
 * Preserves an actual earlier shell; never fabricates an old cache version.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve('.');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const cacheName = source => {
  const match = source.match(/const CACHE\s*=\s*['"](haedo-v\d+)['"]/);
  if (!match) throw new Error('The app shell must declare a versioned cache.');
  return match[1];
};
if (git(['rev-parse', '--is-shallow-repository']) === 'true') {
  throw new Error('Fetch complete Git history before verifying a preserved PWA update.');
}
const currentCache = cacheName(readFileSync(join(root, 'sw.js'), 'utf8'));
const baselines = [];
for (const revision of git(['log', '--format=%H', '--', 'sw.js']).split('\n')) {
  const previous = git(['show', revision + ':sw.js']);
  const name = cacheName(previous);
  if (name !== currentCache) { baselines.push({ revision, cache: name, kind: 'previous' }); break; }
}
if (!baselines.length) throw new Error('No earlier versioned app shell exists in this checkout.');
// A stacked PR's preceding cache can be much newer than the current main shell.
// Include main too, so the long integration jump keeps its storage contract.
const mainRevision = git(['rev-parse', 'refs/remotes/origin/main']);
const mainCache = cacheName(git(['show', mainRevision + ':sw.js']));
if (mainCache !== currentCache && !baselines.some(value => value.revision === mainRevision)) {
  baselines.push({ revision: mainRevision, cache: mainCache, kind: 'main' });
}

const evidence = join(root, '.local/prepared-site-check');
mkdirSync(evidence, { recursive: true });
const work = mkdtempSync(join(evidence, 'run-'));
const currentSite = join(work, 'current-site'), previousSites = [];
// Always use the simulator's public configuration, even in a production CI job.
const anonymousEnv = { ...process.env,
  HAEDO_SUPABASE_URL: 'https://life-sync-test.supabase.co',
  HAEDO_SUPABASE_KEY: 'sb_publishable_anonymous_browser_test_only' };
const sources = [[root, currentSite]];
for (const baseline of baselines) {
  const source = join(work, baseline.kind + '-source'), site = join(work, baseline.kind + '-site');
  mkdirSync(source);
  const archive = join(work, baseline.kind + '.tar');
  execFileSync('git', ['archive', '--format=tar', '--output', archive, baseline.revision], { cwd: root });
  execFileSync('tar', ['-xf', archive, '-C', source]);
  sources.push([source, site]); previousSites.push(site);
}
for (const [source, site] of sources) {
  execFileSync(process.execPath, ['scripts/prepare-site.mjs', site], { cwd: source, env: anonymousEnv, stdio: 'inherit' });
}
writeFileSync(join(evidence, 'baseline.json'), JSON.stringify({
  head: git(['rev-parse', 'HEAD']), baselines, currentCache
}, null, 2) + '\n');
for (const baseline of baselines) console.log(`Verify generated app shell: ${baseline.cache} → ${currentCache} (${baseline.revision.slice(0, 12)}, ${baseline.kind}).`);
const result = spawnSync(process.execPath, ['tests/platform-life-browser.cjs'], {
  cwd: root, env: { ...anonymousEnv, SITE_DIR: currentSite, OLD_SITE_DIR: previousSites.join(process.platform === 'win32' ? ';' : ':') },
  encoding: 'utf8', maxBuffer: 10 * 1024 * 1024
});
const output = (result.stdout || '') + (result.stderr || '');
writeFileSync(join(evidence, 'platform-report.txt'), output);
process.stdout.write(output);
if (result.error) throw result.error;
if (result.signal) throw new Error('Generated-site verification was interrupted: ' + result.signal);
process.exitCode = result.status ?? 1;
