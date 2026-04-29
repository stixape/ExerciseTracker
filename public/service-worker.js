const CACHE_NAME = 'exercise-tracker-v2';
const SCOPE_URL = new URL(self.registration.scope);
const APP_SHELL = [
  new URL('.', SCOPE_URL).pathname,
  new URL('index.html', SCOPE_URL).pathname,
  new URL('manifest.webmanifest', SCOPE_URL).pathname,
  new URL('icons/icon.svg', SCOPE_URL).pathname,
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

async function fromNetwork(request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    return await fromNetwork(request);
  } catch {
    return (await caches.match(request)) ?? (await caches.match(new URL('.', SCOPE_URL).pathname)) ?? (await caches.match(new URL('index.html', SCOPE_URL).pathname));
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return fromNetwork(request);
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const acceptsHtml = event.request.headers.get('accept')?.includes('text/html') ?? false;
  if (event.request.mode === 'navigate' || acceptsHtml) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
