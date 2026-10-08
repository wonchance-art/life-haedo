import { cp, mkdir, writeFile, readFile, access, lstat, readdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { resolve, dirname, parse, join, sep } from 'node:path';

const root = resolve('.');
const destination = resolve(process.argv[2] || '.local/site');
const marker = '.haedo-generated-site.json';
const markerText = JSON.stringify({ generator: 'haedo-prepare-site', version: 1 });
const url = process.env.HAEDO_SUPABASE_URL || '';
const key = process.env.HAEDO_SUPABASE_KEY || '';
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url) || !key.startsWith('sb_publishable_')) {
  throw new Error('A project URL and publishable key are required. Values are never logged.');
}
if (destination === root || root.startsWith(destination + sep) ||
    (destination.startsWith(root + sep) && !destination.startsWith(join(root, '.local') + sep))) {
  throw new Error('Use a generated output below .local/ or outside the repository, never a source directory.');
}
async function noSymlinks(target) {
  let cursor = parse(target).root;
  for (const part of target.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Generated output paths must not contain symlinks.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
await noSymlinks(destination);
let existed = false;
try {
  const stat = await lstat(destination);
  if (!stat.isDirectory()) throw new Error('The generated destination must be a directory.');
  existed = true;
  const names = await readdir(destination);
  if (names.length && await readFile(join(destination, marker), 'utf8').catch(() => '') !== markerText) {
    throw new Error('Refusing to replace a nonempty directory without this generator\'s marker.');
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }

await mkdir(dirname(destination), { recursive: true });
const staging = await mkdtemp(join(dirname(destination), '.haedo-site-staging-'));
let previous;
try {
  // Publish runtime files explicitly. Design previews, samples and future
  // internal assets must not become public just by living under assets/vendor.
  for (const path of ['index.html', 'login.html', 'workspace.html', 'timeline.html', 'goals.html', 'habits.html', 'privacy.html', 'life.html', 'share.html',
    'assets/app.css', 'assets/app.js', 'assets/data.js', 'assets/sync.js', 'assets/workspace.js',
    'assets/platform.css', 'assets/platform-auth.js', 'assets/platform-data.js', 'assets/platform-store.js',
    'assets/platform-ui.js', 'assets/platform-life-remote.js', 'assets/timeline-entry.js',
    'assets/haedo-navigation.js', 'assets/haedo-shell.css', 'assets/timeline-shell.css',
    'assets/life/core.js', 'assets/life/writing.js', 'assets/life/writing-ui.js', 'assets/life/workbench.js', 'assets/life/rediscovery.js', 'assets/life/share.js', 'assets/life/share-remote.js', 'assets/life/share-view.js', 'assets/life/share-view.css', 'assets/life/share-page.js', 'assets/life/storage.js', 'assets/life/remote.js', 'assets/life/sync.js',
    'assets/life/composition-remote.js', 'assets/life/composition-sync.js', 'assets/life/composition-ui.js',
    'assets/life/legacy.js', 'assets/life/icons.js', 'assets/life/workbench-ui.js', 'assets/life/home.js', 'assets/life/ui.js', 'assets/life/ui.css', 'assets/life/workbench.css', 'assets/life/home.css', 'assets/life/shell.js',
    'vendor/daisyui.css', 'vendor/daisyui-themes.css', 'vendor/idb/idb.js', 'vendor/idb/LICENSE',
    'vendor/supabase/supabase.js', 'vendor/supabase/LICENSE', 'vendor/lucide/LICENSE',
    'icon.svg', 'icon-maskable.svg', 'manifest.webmanifest', 'sw.js',
    'supabase/migrations/20261003085426_life_sync_workspaces.sql',
    'supabase/migrations/20261006010000_life_compositions.sql']) {
    await access(path);
    await mkdir(dirname(resolve(staging, path)), { recursive: true });
    await cp(path, resolve(staging, path), { recursive: true, dereference: false });
  }
  try { await access(join(staging, 'vendor/supabase.js')); throw new Error('Duplicate Supabase SDK in public source allowlist.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(join(staging, 'assets/platform-config.js'), 'window.HAEDO_CONFIG=Object.freeze(' + JSON.stringify({ url: url.replace(/\/$/, ''), key }) + ');\n');
  await writeFile(join(staging, '.nojekyll'), '');
  await writeFile(join(staging, marker), markerText);
  // Replace only an empty or previously marked output, never merge stale files into it.
  if (existed) {
    previous = await mkdtemp(join(dirname(destination), '.haedo-site-previous-'));
    await rm(previous, { recursive: true });
    await rename(destination, previous);
  }
  try { await rename(staging, destination); }
  catch (error) { if (previous) { await rename(previous, destination); previous = null; } throw error; }
  if (previous) await rm(previous, { recursive: true, force: true });
} finally { await rm(staging, { recursive: true, force: true }); }
console.log('Prepared public app shell with public project configuration. Personal files, Git metadata and server secrets are excluded.');
