/* Service worker da Rasec - Espetinhos (PWA).
 * Estratégia:
 *  - App shell em cache para abrir mesmo sem internet.
 *  - Navegação: rede primeiro, caindo para o index.html offline.
 *  - Estáticos: cache primeiro com atualização em segundo plano.
 *  - API: sempre rede (nunca guarda dados de vendas/sessão no cache).
 */
const CACHE = 'rasec-v1';

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/icons.js',
  '/js/state.js',
  '/js/ui.js',
  '/js/util.js',
  '/js/views/auth.js',
  '/js/views/cart.js',
  '/js/views/dashboard.js',
  '/js/views/menu.js',
  '/js/views/orders.js',
  '/js/views/profile.js',
  '/js/views/receipt.js',
  '/js/views/stock.js',
  '/js/views/team.js',
  '/assets/logo-rasec.svg',
  '/assets/espeto-carne.svg',
  '/assets/espeto-frango.svg',
  '/assets/espeto-linguica.svg',
  '/assets/fonts/press-start-2p.woff2',
  '/assets/fonts/vt323.woff2',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/maskable-512.png',
  '/assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Dados de vendas, sessão e estoque nunca vão para o cache.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      return cached || network || Response.error();
    })(),
  );
});
