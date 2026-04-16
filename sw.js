// ============================================================
// MICS TE AYUDA — Service Worker v13
// Estrategia: Network-first para HTML/JS/CSS (siempre código fresco)
//             Cache-first solo para imágenes/íconos (assets estáticos)
// ============================================================

const CACHE_NAME = 'mics-te-ayuda-v13';

// Assets que se cachean solo como FALLBACK offline (no bloquean actualizaciones)
const OFFLINE_FALLBACKS = [
    './index.html',
    './css/style.css',
    './js/config.js',
    './js/app.js',
    './manifest.json',
];

// Assets estáticos que RARAMENTE cambian (íconos, imágenes)
const STATIC_ASSETS = [
    './assets/icon-192.png',
    './assets/icon-512.png',
    './assets/qr_share.png',
];

// Instalar: pre-cachear solo íconos, guardar fallbacks sin bloquear
self.addEventListener('install', (event) => {
    console.log('[SW v13] Instalando...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Cachear íconos estáticos (no cambian)
            return cache.addAll(STATIC_ASSETS)
                .then(() => cache.addAll(OFFLINE_FALLBACKS))
                .catch(err => console.warn('[SW] Error pre-cacheando:', err));
        })
    );
    // Activar inmediatamente sin esperar que se cierren pestañas
    self.skipWaiting();
});

// Activar: eliminar TODOS los caches anteriores
self.addEventListener('activate', (event) => {
    console.log('[SW v13] Activando, limpiando caches antiguas...');
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => {
                    console.log('[SW] Eliminando cache antigua:', k);
                    return caches.delete(k);
                })
            )
        ).then(() => self.clients.claim()) // Tomar control de todas las pestañas
    );
});

// Fetch: estrategia diferenciada por tipo de recurso
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. Dejar pasar SIEMPRE: Firebase, CDNs externos (Leaflet, Firebase SDK)
    if (url.hostname !== self.location.hostname) {
        event.respondWith(fetch(event.request));
        return;
    }

    // 2. NETWORK-FIRST para HTML, JS y CSS
    //    → Intenta la red; si falla (offline), usa el caché
    const isAppCode = /\.(html|js|css)$/.test(url.pathname) || url.pathname.endsWith('/');
    if (isAppCode) {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    // Actualizar el caché con la versión fresca del servidor
                    if (networkResponse && networkResponse.status === 200) {
                        const clone = networkResponse.clone();
                        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // Sin red → fallback desde caché
                    return caches.match(event.request)
                        .then(cached => cached || caches.match('./index.html'));
                })
        );
        return;
    }

    // 3. CACHE-FIRST para imágenes/íconos (raramente cambian)
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
