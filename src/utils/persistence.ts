import localforage from 'localforage';

const STORAGE_DB_NAME = 'smart-timeline';
const STORAGE_SCHEMA_LOCK = 'smart-line-storage-schema-v1';
const storageSchemaStores = new Set<string>([
  'timeline_data',
  'daily_schedule_data',
  'ebb_data',
  'graph_data',
  'workspace_snapshots',
  'workspace_snapshot_chunks',
  'workspace_sync_queue',
  // localForage uses this private store when it checks Blob support.
  'local-forage-detect-blob-support',
]);

let storageSchemaReady: Promise<void> | null = null;

function createMissingStores(database: IDBDatabase): void {
  for (const storeName of storageSchemaStores) {
    if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName);
  }
}

function openCurrentDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STORAGE_DB_NAME);
    request.onupgradeneeded = () => createMissingStores(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败。'));
  });
}

function upgradeDatabase(version: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STORAGE_DB_NAME, version);
    request.onupgradeneeded = () => createMissingStores(request.result);
    request.onsuccess = () => {
      const database = request.result;
      const missing = [...storageSchemaStores].filter((storeName) => !database.objectStoreNames.contains(storeName));
      database.close();
      if (missing.length) reject(new Error(`IndexedDB 对象仓库初始化不完整：${missing.join(', ')}`));
      else resolve();
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 升级失败。'));
  });
}

async function initializeStorageSchema(): Promise<void> {
  // localForage will select its next available driver in restricted browsers.
  if (typeof indexedDB === 'undefined') return;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const database = await openCurrentDatabase();
      const missing = [...storageSchemaStores].filter((storeName) => !database.objectStoreNames.contains(storeName));
      const nextVersion = database.version + 1;
      database.close();
      if (!missing.length) return;
      await upgradeDatabase(nextVersion);
      return;
    } catch (error) {
      // Another tab may have completed the same upgrade between our read and open.
      if (!(error instanceof DOMException) || error.name !== 'VersionError' || attempt === 3) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}

function ensureStorageSchema(): Promise<void> {
  if (!storageSchemaReady) {
    const initialize = async () => {
      if (typeof navigator !== 'undefined' && navigator.locks) {
        await navigator.locks.request(STORAGE_SCHEMA_LOCK, { mode: 'exclusive' }, initializeStorageSchema);
      } else {
        await initializeStorageSchema();
      }
    };
    storageSchemaReady = initialize().catch((error) => {
      storageSchemaReady = null;
      throw error;
    });
  }
  return storageSchemaReady;
}

/** Removes obsolete IndexedDB stores during a storage-schema migration. */
export async function removeScopedStorageStores(storeNames: readonly string[]): Promise<void> {
  if (typeof indexedDB === 'undefined' || storeNames.length === 0) return;
  const remove = async () => {
    const database = await openCurrentDatabase();
    const obsolete = storeNames.filter((storeName) => database.objectStoreNames.contains(storeName));
    const nextVersion = database.version + 1;
    database.close();
    if (obsolete.length === 0) return;

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(STORAGE_DB_NAME, nextVersion);
      request.onupgradeneeded = () => {
        const upgrading = request.result;
        for (const storeName of obsolete) {
          if (upgrading.objectStoreNames.contains(storeName)) upgrading.deleteObjectStore(storeName);
        }
        createMissingStores(upgrading);
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 旧仓库删除失败。'));
      request.onblocked = () => reject(new Error('IndexedDB 正被其他标签页使用，无法删除旧仓库。'));
    });
  };

  if (typeof navigator !== 'undefined' && navigator.locks) {
    await navigator.locks.request(STORAGE_SCHEMA_LOCK, { mode: 'exclusive' }, remove);
  } else {
    await remove();
  }
}

function isRetryableStorageError(error: unknown): boolean {
  return error instanceof DOMException
    && ['VersionError', 'AbortError', 'InvalidStateError', 'NotFoundError'].includes(error.name);
}

export function createScopedStorage(storeName: string) {
  if (!storageSchemaStores.has(storeName)) {
    storageSchemaStores.add(storeName);
    storageSchemaReady = null;
  }
  let storage = localforage.createInstance({ name: STORAGE_DB_NAME, storeName });

  const execute = async <T>(operation: (current: LocalForage) => Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await ensureStorageSchema();
        return await operation(storage);
      } catch (error) {
        if (!isRetryableStorageError(error) || attempt === 2) throw error;
        storageSchemaReady = null;
        storage = localforage.createInstance({ name: STORAGE_DB_NAME, storeName });
        await new Promise((resolve) => window.setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
    throw new Error('IndexedDB 操作重试失败。');
  };

  return {
    getItem: <T>(key: string) => execute((current) => current.getItem<T>(key)),
    setItem: <T>(key: string, value: T) => execute((current) => current.setItem(key, value)),
    removeItem: (key: string) => execute((current) => current.removeItem(key)),
    keys: () => execute((current) => current.keys()),
  };
}

export interface ScopedStorageWrite {
  storeName: string;
  key: IDBValidKey;
  value: unknown;
}

export interface ScopedStorageMutationRead {
  storeName: string;
  key: IDBValidKey;
}

export interface ScopedStorageMutationWrite extends ScopedStorageWrite {
  remove?: boolean;
}

/** Writes already-computed values to multiple stores in one IndexedDB transaction. */
export async function setScopedStorageItemsAtomically(writes: ScopedStorageWrite[]): Promise<void> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB 不可用，已停止原子写入。');
  for (const write of writes) storageSchemaStores.add(write.storeName);
  storageSchemaReady = null;
  await ensureStorageSchema();
  const database = await openCurrentDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [...new Set(writes.map((write) => write.storeName))],
        'readwrite',
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 原子事务失败。'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 原子事务已回滚。'));
      for (const write of writes) {
        transaction.objectStore(write.storeName).put(write.value, write.key);
      }
    });
  } finally {
    database.close();
  }
}

/**
 * Reads and writes a small set of values in one IndexedDB transaction. The
 * mutation callback runs from the final read request handler, before the
 * transaction can become inactive, so callers may safely implement a true
 * check-and-set lock instead of relying on BroadcastChannel timing.
 */
export async function mutateScopedStorageItemsAtomically<T>(
  reads: ScopedStorageMutationRead[],
  mutate: (values: unknown[]) => { result: T; writes: ScopedStorageMutationWrite[] },
): Promise<T> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB 不可用，已停止原子写入。');
  const storeNames = [...new Set(reads.map((read) => read.storeName))];
  for (const storeName of storeNames) storageSchemaStores.add(storeName);
  storageSchemaReady = null;
  await ensureStorageSchema();
  const database = await openCurrentDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeNames, 'readwrite');
      const values: unknown[] = Array(reads.length);
      let result: T | undefined;
      let completedReads = 0;
      let mutationStarted = false;
      transaction.oncomplete = () => {
        if (mutationStarted) resolve(result as T);
      };
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 原子事务失败。'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 原子事务已回滚。'));
      if (reads.length === 0) {
        try {
          const output = mutate([]);
          mutationStarted = true;
          result = output.result;
          for (const write of output.writes) {
            const store = transaction.objectStore(write.storeName);
            if (write.remove) store.delete(write.key);
            else store.put(write.value, write.key);
          }
        } catch (error) {
          transaction.abort();
          reject(error);
        }
        return;
      }
      reads.forEach((read, index) => {
        const request = transaction.objectStore(read.storeName).get(read.key);
        request.onerror = () => transaction.abort();
        request.onsuccess = () => {
          values[index] = request.result;
          completedReads += 1;
          if (completedReads !== reads.length || mutationStarted) return;
          try {
            const output = mutate(values);
            mutationStarted = true;
            result = output.result;
            for (const write of output.writes) {
              const store = transaction.objectStore(write.storeName);
              if (write.remove) store.delete(write.key);
              else store.put(write.value, write.key);
            }
          } catch (error) {
            transaction.abort();
            reject(error);
          }
        };
      });
    });
  } finally {
    database.close();
  }
}

/**
 * Creates a dataset in its own IndexedDB database. Use this for domains that
 * must remain physically independent from the main application database.
 */
export function createDedicatedStorage(databaseName: string, storeName: string) {
  let storage = localforage.createInstance({ name: databaseName, storeName });

  const execute = async <T>(operation: (current: LocalForage) => Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation(storage);
      } catch (error) {
        if (!isRetryableStorageError(error) || attempt === 2) throw error;
        storage = localforage.createInstance({ name: databaseName, storeName });
        await new Promise((resolve) => window.setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
    throw new Error('IndexedDB 操作重试失败。');
  };

  return {
    getItem: <T>(key: string) => execute((current) => current.getItem<T>(key)),
    setItem: <T>(key: string, value: T) => execute((current) => current.setItem(key, value)),
    removeItem: (key: string) => execute((current) => current.removeItem(key)),
    keys: () => execute((current) => current.keys()),
  };
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

export const PERSISTENCE_ERROR_EVENT = 'smartline:persistence-error';

export function writeJsonStorage(key: string, value: unknown, label: string): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`[${label}] localStorage 写入失败：`, e);
    return false;
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
    const operation = writeChain
      .then(async () => {
        await writeAsync(value);
        localStorage.removeItem(mirrorKey);
      })
      .catch((error) => {
        // IndexedDB can be unavailable in private/restricted browser modes.
        // Keep one recoverable emergency copy instead of losing the edit.
        const preserved = writeJsonStorage(mirrorKey, value, label);
        console.warn(`[${label}] IndexedDB 合并写入失败，已保留应急日志：`, error);
        if (!preserved) {
          const failure = new Error(`${label} 数据无法写入 IndexedDB 或应急日志，请勿关闭页面并立即导出备份。`);
          window.dispatchEvent(new CustomEvent(PERSISTENCE_ERROR_EVENT, { detail: { message: failure.message } }));
          throw failure;
        }
      });
    writeChain = operation.catch(() => undefined);
    return operation;
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
    timer = setTimeout(() => { void flush().catch(() => undefined); }, delay);
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
    window.addEventListener('beforeunload', (event) => {
      // Synchronous emergency journal only. Normal operation keeps complete
      // datasets out of localStorage and stores them in IndexedDB.
      if (latest !== undefined && !writeJsonStorage(mirrorKey, latest, label)) {
        event.preventDefault();
      }
    });
  }

  return { schedule, flush, writeNow };
}
