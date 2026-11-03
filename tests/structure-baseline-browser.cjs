'use strict';
// S0 structure baseline, part B (docs/design-review/structure-workflow-review-20261102.md 4-5/4-6):
// the HaedoLife.* names and the extra top-level globals that index.html and life.html register in a
// real page: the public home signed out, and both pages signed in (FakeCloud, synthetic account A).
// life.html is private, so signed out it only redirects to login.html.
// Loading the same scripts in node:vm is not enough: shell.js, haedo-navigation.js,
// haedo-motion.js, photo-post-ui.js, full-backup.js and the vendored Quill touch the DOM or browser-only
// globals while loading, and shell.js is the one that registers HaedoLife.Shell.
//
// The pins record current behaviour. When a reviewed change adds, removes or renames a module on
// purpose (a real-device fix, an S1-S6 step), update the pin in that same PR.
// `STRUCTURE_BASELINE_PRINT=1 BASE_URL=… node tests/structure-baseline-browser.cjs` prints the current
// values in the pinned shape.
const assert = require('node:assert/strict');
const { playwright, makeContext, shellReady } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts } = require('./life-sync-browser.cjs');

const base = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const PRINT = process.env.STRUCTURE_BASELINE_PRINT === '1';
// [label, file, signed in]
const SCENES = [['index.html signed out', 'index.html', false], ['index.html signed in', 'index.html', true], ['life.html signed in', 'life.html', true]];

async function registered(context, file, signedIn) {
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Globals of an empty document from the same origin, so only names the page's scripts add remain.
  await page.goto(base + '/manifest.webmanifest');
  const empty = await page.evaluate(() => Object.getOwnPropertyNames(globalThis));
  // Every page module is a classic <script src> that registers itself while it loads, so the names
  // are complete at the load event. Signed in, also wait for HaedoLife.Shell.ready so anything the
  // shell adds at start-up is included. (Signed out, Shell is registered but its start waits for an
  // account, so it is not awaited.)
  await page.goto(base + '/' + file, { waitUntil: 'load' });
  if (signedIn) await shellReady(page);
  assert.equal(new URL(page.url()).pathname.split('/').pop(), file, file + ' stayed on its own page');
  const names = await page.evaluate(empty => ({
    haedoLife: Object.keys(globalThis.HaedoLife).sort(),
    globals: Object.getOwnPropertyNames(globalThis).filter(name => !empty.includes(name)).sort()
  }), empty);
  await page.close();
  assert.deepEqual(errors, [], file + ' page errors');
  return names;
}

async function main() {
  const browser = await playwright().chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const current = {};
    for (const [label, file, signedIn] of SCENES) {
      const context = signedIn
        ? await makeContext(browser, new FakeCloud(), 'structure-baseline', accounts.a)
        : await browser.newContext({ serviceWorkers: 'block' });
      // Signed out, every other origin is blocked: no cloud request is needed to register modules.
      if (!signedIn) await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.fallback() : route.abort('blockedbyclient'));
      try { current[label] = await registered(context, file, signedIn); } finally { await context.close(); }
    }
    if (PRINT) { console.log(JSON.stringify(current, null, 2)); return; }
    // All three scenes register the same set today; each is held to the one pinned list.
    for (const [label] of SCENES) {
      assert.deepEqual(current[label].haedoLife, PINNED.haedoLife, label + ': HaedoLife.* names');
      console.log('PASS ' + label + ' registers the pinned HaedoLife.* names (' + PINNED.haedoLife.length + ')');
      assert.deepEqual(current[label].globals, PINNED.globals, label + ': top-level globals');
      console.log('PASS ' + label + ' adds the pinned top-level globals (' + PINNED.globals.length + ')');
    }
  } finally {
    await browser.close();
  }
}

// Pinned values (main c108dbb; S1 added SyncCommon, S2 SyncLifecycle).
const PINNED = {
  haedoLife: [
    "AccountBlogUI",
    "AccountDocsRemote",
    "AccountDocsSync",
    "AccountLibrary",
    "AccountMaterials",
    "AnnualPlan",
    "AnnualPlanUI",
    "Blog",
    "BlogEvidence",
    "BlogManager",
    "BlogPublic",
    "BlogPublicUI",
    "BlogRemote",
    "BlogSeries",
    "BlogSeriesPackage",
    "BlogSeriesPublic",
    "BlogSeriesReader",
    "BlogSeriesRemote",
    "BlogSeriesSharing",
    "BlogSeriesUI",
    "BlogSync",
    "BookHistory",
    "BookPrint",
    "Books",
    "Collection",
    "CollectionMedia",
    "CollectionMetadata",
    "CollectionPicker",
    "CollectionUI",
    "CompositionRemote",
    "CompositionSync",
    "CompositionUI",
    "Core",
    "Discovery",
    "DiscoveryActions",
    "DiscoveryLanguageSettings",
    "DiscoveryProfile",
    "DiscoveryReading",
    "DiscoveryReadingUI",
    "DiscoveryRecommendations",
    "DiscoverySettings",
    "DiscoveryUI",
    "FullBackup",
    "FullBackupUI",
    "HomeUI",
    "Icons",
    "InterestAnalysis",
    "InterestModel",
    "InterestPolicy",
    "InterestProfile",
    "InterestUI",
    "Legacy",
    "LibraryMeta",
    "LibraryMetaSync",
    "LibraryOriginalsRemote",
    "LibraryRemote",
    "MaterialContinuity",
    "MaterialContinuityRemote",
    "MaterialContinuitySync",
    "MaterialContinuityUI",
    "MaterialWriting",
    "MaterialWritingSources",
    "MaterialWritingUI",
    "NaverBlog",
    "NaverBlogSync",
    "NaverBlogUI",
    "NaverCapture",
    "NaverCaptureSync",
    "NaverCaptureUI",
    "NaverMedia",
    "NaverMediaReceipt",
    "NineBoard",
    "NineBoardUI",
    "NinePublic",
    "NinePublicRemote",
    "NinePublicSharing",
    "NinePublicView",
    "ObsidianLinkCandidates",
    "ObsidianLinkCandidatesUI",
    "ObsidianLinkCommit",
    "ObsidianPackage",
    "ObsidianUpdate",
    "ObsidianUpdateUI",
    "OriginalAttachments",
    "OriginalAttachmentsUI",
    "PageComposer",
    "PageMedia",
    "PagePosts",
    "PagePostsView",
    "PhotoPost",
    "PhotoPostAttachments",
    "PhotoPostUI",
    "PlatformRemote",
    "Preservation",
    "PreservationPackage",
    "PreservationReferences",
    "PreservationUI",
    "PublicCover",
    "PublicCoverReader",
    "PublicCoverRemote",
    "PublicCoverUI",
    "PublicCoverView",
    "ReadingPosition",
    "RecordsList",
    "Rediscovery",
    "Reflection",
    "ReflectionLenses",
    "ReflectionLensesUI",
    "Remote",
    "ScheduleData",
    "ScheduleUI",
    "SettingsUI",
    "Share",
    "ShareRemote",
    "ShareView",
    "Shell",
    "SourceEdit",
    "SourceEditUI",
    "SourceFolders",
    "SourceFoldersUI",
    "SourceMarkdown",
    "SourceReference",
    "Storage",
    "Sync",
    "SyncCommon", // S1: shared sync helpers (assets/life/sync-common.js)
    "SyncLifecycle", // S2: page-lifecycle wiring of the sync engines (assets/life/sync-lifecycle.js)
    "UI",
    "UnifiedSearch",
    "UnifiedSearchUI",
    "Workbench",
    "WorkbenchUI",
    "Writing",
    "WritingRemote",
    "WritingSync",
    "WritingSyncUI",
    "WritingUI"
  ],
  globals: [
    "DOMPurify",
    "HAEDO_CONFIG",
    "HaedoAuth",
    "HaedoData",
    "HaedoLife",
    "HaedoMotion",
    "HaedoNavigation",
    "HaedoPlatformData",
    "LifeObsidianUpdateUI",
    "LifeOriginalAttachmentsUI",
    "ObsidianDecisions",
    "Quill",
    "fflate",
    "idb",
    "jsyaml",
    "markdownit",
    "supabase"
  ]
};

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { SCENES, PINNED };
