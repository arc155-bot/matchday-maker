const CACHE='matchday-mobile-v4-2-oswald-montserrat';
const ASSETS=[
  './','index.html','styles.css','app.js','manifest.webmanifest','icon.svg',
  'assets/backgrounds/Halle.png','assets/backgrounds/base_match.png','assets/backgrounds/base_roster.png',
  'assets/logos/vbc_frauenfeld.png','assets/logos/instagram_herren1.png',
  'assets/logos/volley_amriswil.png','assets/logos/volley_buetschwil.png',
  'assets/logos/stadtturnverein_wil.png','assets/logos/vbc_seuzach.png',
  'assets/logos/tv_felben_wellhausen.png','assets/logos/vbr_rickenbach.png',
  'assets/logos/vc_smash_winterthur.png','assets/logos/tv_warth_weiningen.png',
  'assets/logos/vbc_schaffhausen.png'
];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp}).catch(()=>caches.match(e.request)));
});
