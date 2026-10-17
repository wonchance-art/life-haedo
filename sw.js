/* Versioned app shell. Personal documents remain in localStorage/IndexedDB. */
const CACHE='haedo-v121';
const SHELL=['./assets/life/source-reference.js','./assets/life/blog.js','./assets/life/blog-evidence.js','./assets/life/blog-remote.js','./assets/life/blog-sync.js','./assets/life/blog-public-ui.js','./assets/life/blog-manager.js','./assets/life/blog-public.js','./assets/life/blog-public.css','./assets/life/blog-manager.css','./','./index.html','./login.html','./workspace.html','./timeline.html',
  './assets/life/obsidian-decisions.js','./assets/life/obsidian-package.js',
  './goals.html','./habits.html','./privacy.html','./manifest.webmanifest','./icon.svg','./icon-maskable.svg',
  './vendor/daisyui.css','./vendor/daisyui-themes.css','./assets/app.css',
  './assets/data.js','./assets/sync.js','./assets/app.js','./assets/workspace.js',
  './assets/platform-config.js','./assets/platform.css','./assets/platform-auth.js',
  './assets/haedo-navigation.js','./assets/haedo-shell.css','./assets/timeline-shell.css',
  './assets/platform-data.js','./assets/platform-store.js','./assets/platform-ui.js','./assets/platform-life-remote.js','./assets/timeline-entry.js',
  './life.html','./vendor/idb/idb.js','./vendor/supabase/supabase.js','./assets/life/unified-search.js','./assets/life/unified-search-ui.js','./assets/life/core.js','./assets/life/writing.js','./assets/life/writing-ui.js','./assets/life/nine-board.js','./assets/life/nine-board-ui.js','./assets/life/nine-board.css','./assets/life/page-posts.js','./assets/life/page-posts-view.js','./assets/life/page-media.js','./assets/life/page-composer.js','./assets/life/photo-post.js','./assets/life/photo-post-attachments.js','./assets/life/photo-post-ui.js','./assets/life/photo-post.css','./vendor/quill/quill.js','./vendor/quill/quill.snow.css','./vendor/fflate/fflate.js','./assets/life/page-posts.css','./assets/life/workbench.js','./assets/life/reflection.js','./assets/life/reflection-lenses.js','./assets/life/reflection-lenses-ui.js','./assets/life/books.js','./assets/life/book-history.js','./assets/life/book-print.js','./assets/life/rediscovery.js','./assets/life/share.js','./assets/life/share-remote.js','./assets/life/share-view.js','./assets/life/share-view.css','./assets/life/storage.js',
  './assets/life/remote.js','./assets/life/sync.js',
  './assets/life/composition-remote.js','./assets/life/composition-sync.js','./assets/life/composition-ui.js','./assets/life/writing-remote.js','./assets/life/writing-sync.js','./assets/life/writing-sync-ui.js','./assets/life/reading-position.js',
  './assets/life/legacy.js','./assets/life/icons.js','./assets/life/workbench-ui.js','./assets/life/collection.js','./assets/life/collection-media.js','./assets/life/collection-metadata.js','./assets/life/collection-picker.js','./assets/life/collection-ui.js','./assets/life/collection.css', './assets/life/home.js','./assets/life/ui.js','./assets/life/ui.css','./assets/life/workbench.css','./assets/life/home.css','./assets/life/shell.js'];
const shellURLs=new Set(SHELL.map(path=>new URL(path,self.registration.scope).href));
const authParams=new Set(['code','access_token','refresh_token','token','token_hash','id_token','error','error_code','error_description']);
const shellParams=new Set(['v','section','view','doc','next','view-only','view_only','viewOnly','readonly','read_only','share','public']);
self.addEventListener('install',event=>{
  // Reject a partial shell so the installed version stays usable.
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL.map(url=>new Request(url,{cache:'reload'}))))
    .then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys
    .filter(key=>/^haedo-v\d+$/.test(key)&&key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||request.headers?.has('authorization')||request.cache==='no-store')return;
  const canonical=url.origin+url.pathname;
  if(!shellURLs.has(canonical))return;
  if([...url.searchParams.keys()].some(key=>authParams.has(key))){
    // OAuth codes stay in the browser's callback URL only until Auth consumes them.
    // Never cache callback requests or forward their query to the static host/referrer.
    event.respondWith(fetch(new Request(canonical,{cache:'no-store',credentials:'same-origin',referrerPolicy:'no-referrer',redirect:'error'}))
      .catch(()=>Response.error()));
    return;
  }
  if([...url.searchParams.keys()].some(key=>!shellParams.has(key)))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // Auth, platform and life modules are one installed release. An individual
    // network response cannot replace a module or substitute another page's HTML.
    return await cache.match(canonical)||Response.error();
  })());
});
