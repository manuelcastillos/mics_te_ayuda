// ============================================================
// MICS TE AYUDA — Service Worker
// Permite instalación como PWA y funcionamiento básico offline
// ============================================================

const CACHE_NAME = 'mics-te-ayuda-v8';
const STATIC_ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/config.js',
    './js/app.js',
    './manifest.json',
    './assets/icon-192.png',
    './assets/icon-512.png'
];

// Instalar y cachear assets estáticos
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Cacheando assets estáticos');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activar: limpiar caches antiguas
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// Fetch: Cache-first para assets estáticos, network-first para Firebase
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Dejar pasar Firebase, Google Maps y APIs externas
    if (url.hostname.includes('firebase') ||
        url.hostname.includes('googleapis') ||
        url.hostname.includes('gstatic')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Cache-first para assets locales
    event.respondWith(
        caches.match(event.request).then((cached) => {
            return cached || fetch(event.request).then((response) => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                }
                return response;
            });
        }).catch(() => caches.match('./index.html'))
    );
});
