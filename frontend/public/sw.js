/*
 * FarmBot paneli — servis çalışanı (service worker)
 *
 * Amaç: uygulamayı Raspberry Pi'nin ekranında kalıcı kılmak.
 * İnternet bir an kesildiğinde ekranın bembeyaz olmasını engeller; uygulama
 * kabuğu önbellekten açılır ve "bağlantı yok" durumu arayüzde gösterilir.
 *
 * ÖNEMLİ TASARIM KARARI — API yanıtları ASLA önbelleğe alınmaz.
 * Sensör değeri, robot konumu ve komut sonuçları anlıktır; eski bir değeri
 * göstermek bir kontrol panelinde yanıltıcı, hatta tehlikelidir. Bu yüzden:
 *   - /api/  ve  /media/  → yalnızca ağdan (önbellek yok)
 *   - kabuk (HTML/JS/CSS/simge) → önce önbellek, arkada güncelle
 */

// Sürüm değişince eski önbellek silinir. Yeni yayında bu satırı artırmak
// istemcilerin güncel dosyaları almasını garantiler.
const CACHE = "farmbot-shell-v1";

// Uygulama kabuğunun çekirdeği. Vite dosya adlarına özet (hash) eklediği için
// asıl JS/CSS burada sayfa açıldıkça öğreniliyor.
const CORE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Tek bir dosya inemezse kurulum tümden başarısız olmasın
      .then((cache) => Promise.allSettled(CORE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Yalnızca GET önbelleklenebilir; POST/PATCH/DELETE her zaman ağa gider
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Farklı bir sunucuya giden istekler (bulut API'si dahil) dokunulmadan geçer
  if (url.origin !== self.location.origin) return;

  // Canlı veri asla önbellekten servis edilmez
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) return;

  // Sayfa gezinmeleri: ağ önce, başarısız olursa önbellekteki kabuk.
  // SPA olduğu için her rota index.html'e düşer.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html").then((cached) => cached || offlineResponse())),
    );
    return;
  }

  // Varlıklar: önce önbellek (hızlı açılış), arkada sessizce tazele
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    }),
  );
});

/** Önbellekte de bir şey yoksa gösterilecek asgari sayfa. */
function offlineResponse() {
  return new Response(
    `<!doctype html><html lang="tr"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Bağlantı yok</title>
     <style>
       body{margin:0;min-height:100dvh;display:grid;place-items:center;
            background:#070c0e;color:#e6f0ec;
            font-family:system-ui,sans-serif;text-align:center;padding:2rem}
       h1{font-size:1.25rem;margin:0 0 .5rem}
       p{color:#93a9a2;margin:0;font-size:.9rem;line-height:1.6}
     </style></head>
     <body><div>
       <h1>Panele ulaşılamıyor</h1>
       <p>İnternet bağlantısını kontrol edin.<br>
          Bağlantı döndüğünde sayfa kendiliğinden açılacak.</p>
     </div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 },
  );
}
