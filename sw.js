/* 인생 연표 — 오프라인 캐시 (앱은 단일 HTML, 데이터는 localStorage/Supabase) */
const CACHE='haedo-v44';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon.svg','./vendor/daisyui.css','./vendor/daisyui-themes.css'];
self.addEventListener('install',e=>{
  /* 설치 때도 HTTP 캐시를 건너뛴다 — 안 그러면 오프라인 폴백이 직전 배포로 굳는다 */
  e.waitUntil(caches.open(CACHE)
    .then(c=>Promise.all(SHELL.map(u=>fetch(new Request(u,{cache:'reload'})).then(r=>c.put(u,r)).catch(()=>{}))))
    .then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET')return;
  if(u.origin!==location.origin)return; /* Supabase·타일·폰트는 항상 네트워크 */
  if(/-sample.html$/.test(u.pathname)){e.respondWith(fetch(e.request));return;} /* 시안은 캐시 우회 — 항상 최신 */
  /* 네트워크 우선 — 최신 배포를 놓치지 않되, 오프라인이면 캐시로.
     문서는 브라우저 HTTP 캐시까지 건너뛴다 (Pages가 max-age를 붙여 새 배포가 몇 분 늦게 보였다) */
  const doc=e.request.mode==='navigate'||u.pathname.endsWith('/')||/\.html?$/.test(u.pathname);
  const req=doc?new Request(e.request,{cache:'reload'}):e.request;
  e.respondWith(
    fetch(req).then(r=>{
      const copy=r.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
      return r;
    }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html')))
  );
});
