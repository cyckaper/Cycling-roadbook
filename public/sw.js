// 小布路書 離線殼層 v2.2 — 同源檔案 stale-while-revalidate;/api/ 一律直通網路;字型機會性快取
const V = 'xb-v241';
const CORE = ['./','./manifest.webmanifest','./vendor/leaflet/leaflet.css','./vendor/leaflet/leaflet.js','./icon-192.png','./icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== V+'-rt').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/')) return;                    // 資料一律走網路
  if (u.origin === location.origin) {
    e.respondWith(caches.open(V).then(async c => {
      const netP = fetch(e.request).then(r => { if (r && r.ok) c.put(e.request, r.clone()); return r; });
      const isNav = e.request.mode === 'navigate' || u.pathname === '/';
      if (isNav) {
        // 首頁：網路優先（3 秒逾時）→ 快取。連線即見最新版；離線或過慢退快照。
        try {
          const net = await Promise.race([netP, new Promise((_, rj) => setTimeout(() => rj(new Error('slow')), 3000))]);
          if (net && net.ok) return net;
          throw new Error('bad');
        } catch (err) {
          const hit = await c.match(e.request, { ignoreSearch: true });
          return hit || (await netP.catch(() => null)) || new Response('offline', { status: 503 });
        }
      }
      // 其餘同源資產維持 stale-while-revalidate
      const hit = await c.match(e.request);
      return hit || (await netP.catch(() => null)) || new Response('offline', { status: 503 });
    }));
  } else if (/fonts\.(gstatic|googleapis)\.com$/.test(u.hostname)) {
    e.respondWith(caches.open(V + '-rt').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try { const r = await fetch(e.request); if (r && (r.ok || r.type === 'opaque')) c.put(e.request, r.clone()); return r; }
      catch (err) { return Response.error(); }
    }));
  }
});
