const CACHE_PREFIX = 'smartline-shell-';
const META_CACHE = 'smartline-shell-meta-v1';
const ACTIVE_CACHE_KEY = '/__smartline_active_cache__';
const RELOAD_CLIENTS_KEY = '/__smartline_reload_clients__';
const APP_SHELL_URL = '/';
const MAX_ASSET_COUNT = 160;
const STATIC_URLS = [
  '/manifest.json',
  '/favicon.png',
  '/apple-touch-icon.png',
];

let refreshPromise;

function getHtmlAssetUrls(html) {
  const urls = new Set();
  const pattern = /(?:src|href)=["'](\/assets\/[^"'?#]+)["']/g;
  let match;
  while ((match = pattern.exec(html)) !== null) urls.add(match[1]);
  return [...urls];
}

function getJavaScriptAssetUrls(source, sourceUrl) {
  const urls = new Set();
  const pattern = /["']((?:\/assets\/|assets\/|\.{1,2}\/)[^"'?#]+?\.(?:js|css))["']/g;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const reference = match[1];
    const resolved = reference.startsWith('assets/')
      ? `/${reference}`
      : new URL(reference, new URL(sourceUrl, self.location.origin)).pathname;
    if (resolved.startsWith('/assets/')) urls.add(resolved);
  }

  return [...urls];
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cacheNameForHtml(html) {
  return `${CACHE_PREFIX}${hashString(html)}`;
}

async function readCacheState() {
  const cache = await caches.open(META_CACHE);
  const response = await cache.match(ACTIVE_CACHE_KEY);
  if (!response) return { active: null, history: [] };

  try {
    const state = await response.json();
    return {
      active: typeof state.active === 'string' ? state.active : null,
      history: Array.isArray(state.history)
        ? state.history.filter((name) => typeof name === 'string' && name.startsWith(CACHE_PREFIX))
        : [],
    };
  } catch {
    return { active: null, history: [] };
  }
}

async function writeCacheState(state) {
  const cache = await caches.open(META_CACHE);
  await cache.put(
    ACTIVE_CACHE_KEY,
    new Response(JSON.stringify(state), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }),
  );
}

async function setReloadClientsFlag(value) {
  const cache = await caches.open(META_CACHE);
  if (!value) {
    await cache.delete(RELOAD_CLIENTS_KEY);
    return;
  }
  await cache.put(RELOAD_CLIENTS_KEY, new Response('1'));
}

async function takeReloadClientsFlag() {
  const cache = await caches.open(META_CACHE);
  const shouldReload = Boolean(await cache.match(RELOAD_CLIENTS_KEY));
  if (shouldReload) await cache.delete(RELOAD_CLIENTS_KEY);
  return shouldReload;
}

async function fetchAndCache(cache, url) {
  const response = await fetch(url, {
    cache: 'force-cache',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  await cache.put(url, response.clone());
  return response;
}

async function cacheAssetGraph(cache, initialUrls) {
  const queue = [...initialUrls];
  const visited = new Set();

  while (queue.length > 0) {
    if (visited.size >= MAX_ASSET_COUNT) {
      throw new Error(`Application asset graph exceeded ${MAX_ASSET_COUNT} resources.`);
    }

    const batch = [];
    while (queue.length > 0 && batch.length < 6) {
      const url = queue.shift();
      if (url && !visited.has(url)) {
        visited.add(url);
        batch.push(url);
      }
    }
    if (batch.length === 0) continue;

    await Promise.all(batch.map(async (url) => {
      const response = await fetchAndCache(cache, url);
      if (!url.endsWith('.js')) return;

      const source = await response.text();
      for (const discoveredUrl of getJavaScriptAssetUrls(source, url)) {
        if (!visited.has(discoveredUrl)) queue.push(discoveredUrl);
      }
    }));
  }

  return visited;
}

async function removeObsoleteCaches(keepNames) {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== META_CACHE && !keepNames.has(key))
      .map((key) => caches.delete(key)),
  );
}

async function performAppShellRefresh() {
  const response = await fetch(APP_SHELL_URL, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'text/html' },
  });
  if (!response.ok) throw new Error(`App shell request failed: ${response.status}`);

  const html = await response.clone().text();
  const assetUrls = getHtmlAssetUrls(html);
  if (assetUrls.length === 0) throw new Error('App shell does not reference any hashed assets.');

  const nextCacheName = cacheNameForHtml(html);
  const currentState = await readCacheState();
  const isActiveCache = currentState.active === nextCacheName;

  if (!isActiveCache) await caches.delete(nextCacheName);
  const nextCache = await caches.open(nextCacheName);
  let publishedHistory = [];

  try {
    await cacheAssetGraph(nextCache, assetUrls);
    await Promise.all(STATIC_URLS.map((url) => fetchAndCache(nextCache, url)));

    // Publishing the HTML and active-cache pointer is the commit point. Until
    // both steps succeed, the previous complete cache remains active.
    await nextCache.put(APP_SHELL_URL, response);

    publishedHistory = [
      nextCacheName,
      currentState.active,
      ...currentState.history,
    ].filter((name, index, names) => (
      typeof name === 'string'
      && name.startsWith(CACHE_PREFIX)
      && names.indexOf(name) === index
    )).slice(0, 2);

    await writeCacheState({ active: nextCacheName, history: publishedHistory });
  } catch (error) {
    if (!isActiveCache) await caches.delete(nextCacheName);
    throw error;
  }

  // Cleanup is deliberately best-effort and happens after the atomic switch.
  // A storage cleanup failure must never delete or invalidate the new active
  // cache that has already been published.
  await removeObsoleteCaches(new Set(publishedHistory)).catch((error) => {
    console.warn('[service-worker] obsolete cache cleanup failed:', error);
  });

  return nextCacheName;
}

function refreshAppShell() {
  refreshPromise ??= performAppShellRefresh().finally(() => {
    refreshPromise = undefined;
  });
  return refreshPromise;
}

async function matchFromShellCaches(request) {
  const state = await readCacheState();
  const cacheNames = [state.active, ...state.history]
    .filter((name, index, names) => typeof name === 'string' && names.indexOf(name) === index);

  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
    if (cached) return cached;
  }

  return undefined;
}

async function cacheRuntimeResponse(request, response) {
  if (!response?.ok) return response;
  const state = await readCacheState();
  if (!state.active) return response;
  const cache = await caches.open(state.active);
  await cache.put(request, response.clone());
  return response;
}

self.addEventListener('install', (event) => {
  // Do not catch this promise: a failed install must leave the existing worker
  // and its complete offline cache in control.
  event.waitUntil((async () => {
    const previousState = await readCacheState();
    await refreshAppShell();
    if (previousState.active) await setReloadClientsFlag(true);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const state = await readCacheState();
    if (state.active) await removeObsoleteCaches(new Set(state.history));
    await self.clients.claim();
    if (await takeReloadClientsFlag()) {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      await Promise.all(windows.map((client) =>
        Promise.resolve(client.navigate(client.url)).catch((error) => {
          console.warn('[service-worker] client refresh failed:', error);
        }),
      ));
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'REFRESH_APP_SHELL') {
    event.waitUntil(
      refreshAppShell().catch((error) => {
        console.warn('[service-worker] shell refresh failed:', error);
      }),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!networkResponse.ok) throw new Error(`Navigation request failed: ${networkResponse.status}`);
        event.waitUntil(
          refreshAppShell().catch((error) => {
            console.warn('[service-worker] background shell refresh failed:', error);
          }),
        );
        return networkResponse;
      } catch {
        const cached = await matchFromShellCaches(APP_SHELL_URL);
        if (cached) return cached;
        return new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="theme-color" content="#f5f7fb"><title>Smart Timeline</title><body style="font-family:system-ui;padding:32px;background:#f5f7fb;color:#172033"><h1>Smart Timeline</h1><p>首次启动需要连接网络，请联网后重试。</p><button onclick="location.reload()">重新加载</button></body>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/assets/') || STATIC_URLS.includes(url.pathname)) {
    event.respondWith((async () => {
      const cached = await matchFromShellCaches(url.pathname);
      if (cached) return cached;
      return cacheRuntimeResponse(url.pathname, await fetch(request));
    })());
  }
});
