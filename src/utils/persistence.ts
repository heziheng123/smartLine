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
