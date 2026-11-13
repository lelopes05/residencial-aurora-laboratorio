/* Rodízio SP: cache só dos arquivos locais, não dos mapas OSM ou de serviços. */
const CACHE='rodizio-sp-pwa-v1';
const SHELL=["./index.html", "./manifest.webmanifest", "./pwa-bridge.js", "./leaflet.js", "./leaflet.css", "./leaflet-rotate.umd.min.js", "./app.js", "./navigation.js", "./features-v05.js", "./radar-points.js", "./minianel-rodizio.js", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(k=>k.startsWith('rodizio-sp-pwa-')&&k!==CACHE)
      .map(k=>caches.delete(k))
  )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  const basename=url.pathname.substring(url.pathname.lastIndexOf('/')+1)||'index.html';
  if(!SHELL.some(s=>s.endsWith('/'+basename)))return;
  if(basename==='index.html'){
    event.respondWith(fetch(event.request).then(res=>{
      if(res.ok)caches.open(CACHE).then(c=>c.put('./index.html',res.clone()));
      return res;
    }).catch(()=>caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then(x=>x||fetch(event.request)));
});
