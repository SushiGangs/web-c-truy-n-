const CACHE_NAME = 'sushi-truyen-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/js/main.js',
  '/js/auth.js',
  '/js/db.js',
  '/js/ui.js',
  '/js/reader.js',
  '/js/editor.js',
  '/js/config.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS).catch(err => console.log('Lỗi cache assets', err));
    })
  );
});

self.addEventListener('fetch', event => {
  // Chỉ cache các request GET
  if (event.request.method !== 'GET') return;
  // Bỏ qua các request tới Supabase API để luôn lấy dữ liệu mới
  if (event.request.url.includes('supabase.co')) return;

  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request).then(fetchRes => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request.url, fetchRes.clone());
          return fetchRes;
        });
      });
    }).catch(() => {
      // Offline fallback
      if (event.request.url.includes('.html') || event.request.url === '/') {
        return caches.match('/index.html');
      }
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});
