import { createCoalescedPersistence, createScopedStorage, readJsonStorage } from '@/utils/persistence';
import type { EbbData } from './types';
import { EBB_STORAGE_KEY, EBB_SYNC_SETTINGS_KEY } from './constants';
import { normalizeEbbData, toEbbData } from './dataNormalization';

const EBB_STORAGE_MIRROR_KEY = `${EBB_STORAGE_KEY}:mirror`;
const ebbStorage = createScopedStorage('ebb_data');

export interface EbbSyncSettings {
  roomCode: string;
  enabled: boolean;
}

export function loadEbbSyncSettings(): EbbSyncSettings {
  try {
    const raw = localStorage.getItem(EBB_SYNC_SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as EbbSyncSettings;
  } catch { /* ignore invalid legacy settings */ }
  return { roomCode: '', enabled: false };
}

export function saveEbbSyncSettings(settings: EbbSyncSettings): void {
  localStorage.setItem(EBB_SYNC_SETTINGS_KEY, JSON.stringify(settings));
}

async function saveEbbDataAsync(data: EbbData): Promise<void> {
  try {
    await ebbStorage.setItem(EBB_STORAGE_KEY, toEbbData(data));
  } catch (error) {
    console.warn('[smart-ebb] IndexedDB 写入失败：', error);
    throw error;
  }
}

const ebbPersistence = createCoalescedPersistence<EbbData>({
  mirrorKey: EBB_STORAGE_MIRROR_KEY,
  label: 'smart-ebb',
  writeAsync: saveEbbDataAsync,
});

export async function loadEbbData(): Promise<EbbData | null> {
  let raw = readJsonStorage<EbbData>(EBB_STORAGE_MIRROR_KEY)
    ?? await ebbStorage.getItem<EbbData>(EBB_STORAGE_KEY);
  if (!raw) {
    const legacy = readJsonStorage<EbbData>(EBB_STORAGE_KEY);
    if (legacy) {
      raw = legacy;
      await ebbStorage.setItem(EBB_STORAGE_KEY, raw);
      localStorage.removeItem(EBB_STORAGE_KEY);
    }
  } else if (typeof raw === 'string') {
    raw = JSON.parse(raw) as EbbData;
  }
  return raw ? normalizeEbbData(raw) : null;
}

export function saveEbbData(data: EbbData): void {
  ebbPersistence.schedule(toEbbData(data));
}
