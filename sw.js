const CACHE_NAME = 'wordgrid-app-v1';
const STATIC_ASSETS = [
  './app.html',
  './manifest.json',
  './icon.svg',
  './words.js',
  './dictionary.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        STATIC_ASSETS.map((url) => cache.add(url).catch(() => {}))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  // درخواست‌های آنلاین Firebase هرگز کش نشوند
  if (url.includes('firebaseio.com') || url.includes('firebasedatabase.app')) {
    return;
  }

  // برای دیکشنری‌ها: ابتدا از حافظه کش (سرعت آنی و آفلاین)
  if (url.endsWith('dictionary.js') || url.endsWith('words.js') || url.endsWith('icon.svg')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((resp) => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return resp;
        });
      })
    );
    return;
  }

  // برای فایل اصلی برنامه: ابتدا شبکه (برای دریافت آپدیت‌ها) و در حالت آفلاین از کش
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        if (resp && resp.status === 200 && event.request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
