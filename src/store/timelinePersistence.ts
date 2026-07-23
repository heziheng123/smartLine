import type { TimelineData } from '@/types';
import {
  createCoalescedPersistence,
  createScopedStorage,
  readJsonStorage,
  writeJsonStorage,
} from '@/utils/persistence';
import { normalizeTimelineData, toTimelineData } from './timelineData';

const STORAGE_KEY = 'smart-timeline-data';
const STORAGE_MIRROR_KEY = `${STORAGE_KEY}:mirror`;
const SYNC_SETTINGS_KEY = 'smart-timeline-liveblocks';
const timelineStorage = createScopedStorage('timeline_data');

export interface TimelineSyncSettings {
  roomCode: string;
  enabled: boolean;
}

export function loadTimelineSyncSettings(): TimelineSyncSettings {
  try {
    const raw = localStorage.getItem(SYNC_SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as TimelineSyncSettings;
  } catch { /* ignore invalid legacy settings */ }
  return { roomCode: '', enabled: false };
}

export function saveTimelineSyncSettings(settings: TimelineSyncSettings): void {
  localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(settings));
}

async function saveDataAsync(data: TimelineData): Promise<void> {
  try {
    await timelineStorage.setItem(STORAGE_KEY, data);
  } catch (error) {
    console.warn('[smart-timeline] IndexedDB 写入失败：', error);
    throw error;
  }
}

const timelinePersistence = createCoalescedPersistence<TimelineData>({
  mirrorKey: STORAGE_MIRROR_KEY,
  label: 'smart-timeline',
  writeAsync: saveDataAsync,
});

export async function loadTimelineData(): Promise<TimelineData | null> {
  const mirror = readJsonStorage<TimelineData>(STORAGE_MIRROR_KEY);
  let raw = mirror ?? await timelineStorage.getItem<TimelineData>(STORAGE_KEY);
  if (!raw) {
    const legacy = readJsonStorage<TimelineData>(STORAGE_KEY);
    if (legacy) {
      raw = legacy;
      await timelineStorage.setItem(STORAGE_KEY, raw);
      writeJsonStorage(STORAGE_MIRROR_KEY, raw, 'smart-timeline');
      localStorage.removeItem(STORAGE_KEY);
    }
  } else if (typeof raw === 'string') {
    raw = JSON.parse(raw) as TimelineData;
  }
  if (!raw) return null;

  const normalized = normalizeTimelineData(raw);
  if (JSON.stringify(normalized) !== JSON.stringify(toTimelineData(raw))) {
    timelinePersistence.schedule(normalized);
  }
  return normalized;
}

export async function persistTimelineData(data: TimelineData): Promise<void> {
  await timelinePersistence.writeNow(toTimelineData(data));
}

export function saveTimelineData(data: TimelineData): void {
  timelinePersistence.schedule(toTimelineData(data));
}
