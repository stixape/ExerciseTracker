const CACHE_PREFIX = 'exercise-tracker-';
const CACHE_NAME = `${CACHE_PREFIX}__EXERCISE_TRACKER_BUILD_ID__`;
const PRECACHE_PATHS = /* __EXERCISE_TRACKER_PRECACHE_PATHS__ */ [];
const SCOPE_URL = new URL(self.registration.scope);
const INDEX_URL = new URL('index.html', SCOPE_URL).href;
const PRECACHE_URLS = PRECACHE_PATHS.map((path) => new URL(path, SCOPE_URL).href);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME))
      .then((staleKeys) => Promise.all([...staleKeys.map((key) => caches.delete(key)), self.clients.claim()])),
  );
});

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (response.ok) return response;
  } catch {
    // Fall through to the app shell when the network is unavailable.
  }
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(INDEX_URL, { ignoreVary: true })) ?? Response.error();
}

async function cacheFirst(request) {
  // Vite preview and some static hosts vary responses by Origin. Hashed,
  // same-origin release assets are safe to match by URL across that header.
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE_URL.href)) return;

  const acceptsHtml = event.request.headers.get('accept')?.includes('text/html') ?? false;
  if (event.request.mode === 'navigate' || acceptsHtml) {
    event.respondWith(navigationResponse(event.request));
    return;
  }

  if (!event.request.headers.has('range')) {
    event.respondWith(cacheFirst(event.request));
  }
});
