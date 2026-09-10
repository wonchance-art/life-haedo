/* Versioned app shell. Personal documents remain in localStorage. */
const CACHE='haedo-v47';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon.svg','./icon-maskable.svg',
  './vendor/daisyui.css','./vendor/daisyui-themes.css','./assets/app.css',
  './assets/data.js','./assets/sync.js','./assets/app.js','./assets/workspace.js'];
const shellURLs=new Set(SHELL.map(path=>new URL(path,self.registration.scope).href));
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
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  const canonical=url.origin+url.pathname;
  if(!shellURLs.has(canonical))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{
      const response=await fetch(new Request(request,{cache:'reload'}));
      if(response.ok){
        event.waitUntil(cache.put(canonical,response.clone()).catch(()=>{}));
        return response;
      }
      return await cache.match(canonical)||response;
    }catch(error){
      const cached=await cache.match(canonical);
      if(cached)return cached;
      if(request.mode==='navigate'){
        const index=await cache.match(new URL('./index.html',self.registration.scope).href);
        if(index)return index;
      }
      return Response.error();
    }
  })());
});
