import localforage from 'localforage';

const STORAGE_DB_NAME = 'smart-timeline';

export function createScopedStorage(storeName: string) {
  return localforage.createInstance({
    name: STORAGE_DB_NAME,
    storeName,
  });
}

export function readJsonStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJsonStorage(key: string, value: unknown, label: string) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`[${label}] localStorage 写入失败：`, e);
  }
}

interface CoalescedPersistenceOptions<T> {
  mirrorKey: string;
  label: string;
  writeAsync: (value: T) => Promise<void>;
  delay?: number;
}

/**
 * Coalesces rapid UI mutations into one IndexedDB write. localStorage is used
 * only as an emergency beforeunload journal when an async write is still
 * pending; it is removed immediately after IndexedDB confirms the write.
 */
export function createCoalescedPersistence<T>({
  mirrorKey,
  label,
  writeAsync,
  delay = 350,
}: CoalescedPersistenceOptions<T>) {
  let latest: T | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writeChain = Promise.resolve();

  const writeValue = (value: T) => {
    writeChain = writeChain
      .then(async () => {
        await writeAsync(value);
        localStorage.removeItem(mirrorKey);
      })
      .catch((error) => {
        // IndexedDB can be unavailable in private/restricted browser modes.
        // Keep one recoverable emergency copy instead of losing the edit.
        writeJsonStorage(mirrorKey, value, label);
        console.warn(`[${label}] IndexedDB 合并写入失败，已保留应急日志：`, error);
      });
    return writeChain;
  };

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (latest === undefined) return writeChain;
    const value = latest;
    latest = undefined;
    return writeValue(value);
  };

  const schedule = (value: T) => {
    latest = value;
    // Keep the first deadline instead of restarting it for every keystroke.
    // This still writes only the latest snapshot, but guarantees that a busy
    // editing session is persisted at least once per delay window.
    if (timer) return;
    timer = setTimeout(() => { void flush(); }, delay);
  };

  const writeNow = (value: T) => {
    latest = undefined;
    if (timer) clearTimeout(timer);
    timer = null;
    return writeValue(value);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush();
    });
    window.addEventListener('beforeunload', () => {
      // Synchronous emergency journal only. Normal operation keeps complete
      // datasets out of localStorage and stores them in IndexedDB.
      if (latest !== undefined) writeJsonStorage(mirrorKey, latest, label);
    });
  }

  return { schedule, flush, writeNow };
}
