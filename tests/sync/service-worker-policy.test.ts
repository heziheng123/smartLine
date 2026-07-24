import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const ORIGIN = 'https://smartline.test';
const FRESH_HTML = '<!doctype html><title>fresh shell</title><script type="module" src="/assets/index-new.js"></script>';
type WorkerEvent = Record<string, unknown>;

function cacheKey(request: string | { url?: string }): string {
  const value = typeof request === 'string' ? request : request.url ?? '/';
  return new URL(value, ORIGIN).pathname;
}

class MemoryCache {
  private values = new Map<string, Response>();

  async match(request: string | { url?: string }): Promise<Response | undefined> {
    return this.values.get(cacheKey(request))?.clone();
  }

  async put(request: string | { url?: string }, response: Response): Promise<void> {
    this.values.set(cacheKey(request), response.clone());
  }

  async delete(request: string | { url?: string }): Promise<boolean> {
    return this.values.delete(cacheKey(request));
  }
}

async function createHarness() {
  const source = await readFile(new URL('../../public/service-worker.js', import.meta.url), 'utf8');
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const cacheStores = new Map<string, MemoryCache>();
  const navigations: string[] = [];
  let online = true;

  const caches = {
    async open(name: string) {
      const existing = cacheStores.get(name);
      if (existing) return existing;
      const created = new MemoryCache();
      cacheStores.set(name, created);
      return created;
    },
    async keys() {
      return [...cacheStores.keys()];
    },
    async delete(name: string) {
      return cacheStores.delete(name);
    },
  };

  const fetch = async (input: string | { url?: string }) => {
    if (!online) throw new Error('offline');
    const path = cacheKey(input);
    if (path === '/') {
      return new Response(FRESH_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    if (path.endsWith('.js')) {
      return new Response('console.log("fresh asset")', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener(type: string, listener: (event: WorkerEvent) => void) {
      listeners.set(type, listener);
    },
    skipWaiting: async () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => [{
        url: `${ORIGIN}/`,
        navigate: async (url: string) => {
          navigations.push(url);
          return null;
        },
      }],
    },
  };

  vm.runInNewContext(source, {
    self,
    caches,
    fetch,
    Response,
    URL,
    console,
    Promise,
    Set,
    Map,
  });

  const waitForEvent = async (type: string, event: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)?.({
      ...event,
      waitUntil(value: Promise<unknown>) {
        waits.push(Promise.resolve(value));
      },
    });
    await Promise.all(waits);
  };

  return {
    caches,
    navigations,
    setOnline(value: boolean) {
      online = value;
    },
    async seedOldShell() {
      const meta = await caches.open('smartline-shell-meta-v1');
      await meta.put('/__smartline_active_cache__', new Response(JSON.stringify({
        active: 'smartline-shell-old',
        history: [],
      })));
      const old = await caches.open('smartline-shell-old');
      await old.put('/', new Response('<!doctype html><title>stale shell</title>'));
    },
    async navigate() {
      let responsePromise: Promise<Response> | undefined;
      const waits: Promise<unknown>[] = [];
      listeners.get('fetch')?.({
        request: { method: 'GET', mode: 'navigate', url: `${ORIGIN}/` },
        respondWith(value: Promise<Response>) {
          responsePromise = Promise.resolve(value);
        },
        waitUntil(value: Promise<unknown>) {
          waits.push(Promise.resolve(value));
        },
      });
      assert.ok(responsePromise);
      const response = await responsePromise;
      await Promise.all(waits);
      return response;
    },
    waitForEvent,
  };
}

test('online navigation returns the newest HTML instead of the cached old shell', async () => {
  const harness = await createHarness();
  await harness.seedOldShell();

  const response = await harness.navigate();
  assert.match(await response.text(), /fresh shell/);
});

test('offline navigation still falls back to the last complete shell', async () => {
  const harness = await createHarness();
  await harness.seedOldShell();
  harness.setOnline(false);

  const response = await harness.navigate();
  assert.match(await response.text(), /stale shell/);
});

test('a worker upgrade reloads controlled windows after publishing the new shell', async () => {
  const harness = await createHarness();
  await harness.seedOldShell();

  await harness.waitForEvent('install');
  await harness.waitForEvent('activate');
  assert.deepEqual(harness.navigations, [`${ORIGIN}/`]);
});
