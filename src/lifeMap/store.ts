import { create } from 'zustand';
import dayjs from 'dayjs';
import { liveblocks } from '@liveblocks/zustand';
import type { WithLiveblocks } from '@liveblocks/zustand';
import { liveblocksClient } from '@/store/client';
import { createCoalescedPersistence, createDedicatedStorage, createScopedStorage, readJsonStorage, writeJsonStorage } from '@/utils/persistence';
import { createWorkspaceTrackedSet } from '@/services/workspaceLocalWriteJournal';
import {
  LIFE_MAP_FIELDS,
  canDeleteLifeArea,
  createEmptyLifeMapData,
  migrateLegacyLifeMapLayouts,
  normalizeLifeMapData,
} from './data';
import type {
  LifeArea,
  LifeEvent,
  LifeFocus,
  LifeGoal,
  LifeMapData,
  LifeMapNote,
  LifeMapPlanGroupId,
  LifeMapStage,
  LifeReview,
  LifeSystem,
  LifeSystemCheckIn,
  LifeTheme,
} from './types';

const STORAGE_KEY = 'line-life-map-storage-v1';
const STORAGE_MIRROR_KEY = `${STORAGE_KEY}:mirror`;
const SYNC_SETTINGS_KEY = 'line-life-map-liveblocks';
const LEGACY_PROJECT_SIDE_KEY = 'life-map:project-sides';
const LEGACY_NODE_LAYOUT_KEY = 'life-map:node-layouts';
const LEGACY_PROJECT_RANK_KEY = 'life-map:project-ranks';
export const LIFE_MAP_ROOM_PREFIX = 'life-map-';
const lifeMapStorage = createDedicatedStorage('line-life-map', 'life_map_data');
// Read-only migration source used once by installations that stored Life Map
// in the main Smart Timeline database before the two domains were separated.
const legacyLifeMapStorage = createScopedStorage('life_map_data');

interface SyncSettings { roomCode: string; enabled: boolean }
export type LifeMapSyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export interface LifeMapShiftSnapshot { id: string; start: string; targetDate: string }

type NewArea = Pick<LifeArea, 'name' | 'color' | 'planGroupId'> & Partial<Pick<LifeArea, 'icon' | 'order' | 'isHidden'>>;
type NewStage = Pick<LifeMapStage, 'name' | 'start' | 'end'> & Partial<Pick<LifeMapStage, 'id' | 'color'>>;
type NewTheme = Pick<LifeTheme, 'areaId' | 'name' | 'start' | 'end'> & Partial<Pick<LifeTheme, 'color' | 'placement'>>;
type NewGoal = Pick<LifeGoal, 'areaId' | 'name' | 'start' | 'targetDate'> & Partial<Omit<LifeGoal, 'id' | 'areaId' | 'name' | 'start' | 'targetDate' | 'createdAt' | 'updatedAt' | 'revision' | 'deletedAt'>>;
type NewSystem = Pick<LifeSystem, 'areaId' | 'name' | 'start' | 'frequency' | 'targetCount'> & Partial<Omit<LifeSystem, 'id' | 'areaId' | 'name' | 'start' | 'frequency' | 'targetCount' | 'createdAt' | 'updatedAt' | 'revision' | 'deletedAt'>>;
type NewEvent = Pick<LifeEvent, 'name' | 'date'> & Partial<Omit<LifeEvent, 'name' | 'date' | 'createdAt' | 'updatedAt' | 'revision' | 'deletedAt'>>;
type NewFocus = Pick<LifeFocus, 'areaId' | 'name' | 'start' | 'end'> & Partial<Pick<LifeFocus, 'id' | 'color' | 'placement'>>;
type NewNote = Pick<LifeMapNote, 'areaId' | 'name' | 'date' | 'type'> & Partial<Pick<LifeMapNote, 'id' | 'endDate' | 'color' | 'placement'>>;
type NewReview = Pick<LifeReview, 'title' | 'period' | 'start' | 'end' | 'reflection' | 'adjustments' | 'snapshot'> & Partial<Pick<LifeReview, 'areaIds'>>;

interface LifeMapStore extends LifeMapData {
  isHydrated: boolean;
  hydrateStore: () => Promise<void>;
  syncEnabled: boolean;
  syncRoomCode: string;
  syncStatus: LifeMapSyncStatus;
  enableSync: (roomCode: string) => void;
  disableSync: () => void;
  setSyncStatus: (status: LifeMapSyncStatus) => void;
  addArea: (value: NewArea) => LifeArea;
  updateArea: (id: string, updates: Partial<Omit<LifeArea, 'id' | 'createdAt'>>) => void;
  deleteArea: (id: string) => boolean;
  updatePlanGroupPlacement: (id: LifeMapPlanGroupId, placement: 'above' | 'below') => void;
  addStage: (value: NewStage) => LifeMapStage;
  updateStage: (id: string, updates: Partial<Omit<LifeMapStage, 'id' | 'createdAt'>>) => void;
  deleteStage: (id: string) => void;
  addTheme: (value: NewTheme) => LifeTheme;
  updateTheme: (id: string, updates: Partial<Omit<LifeTheme, 'id' | 'createdAt'>>) => void;
  deleteTheme: (id: string) => void;
  addGoal: (value: NewGoal) => LifeGoal;
  updateGoal: (id: string, updates: Partial<Omit<LifeGoal, 'id' | 'createdAt'>>) => void;
  deleteGoal: (id: string) => void;
  shiftPlanningItems: (ids: string[], days: number) => LifeMapShiftSnapshot[];
  restorePlanningItems: (snapshot: LifeMapShiftSnapshot[]) => void;
  addSystem: (value: NewSystem) => LifeSystem;
  updateSystem: (id: string, updates: Partial<Omit<LifeSystem, 'id' | 'createdAt'>>) => void;
  deleteSystem: (id: string) => void;
  addSystemCheckIn: (systemId: string, date?: string, count?: number) => LifeSystemCheckIn;
  setSystemCheckIn: (systemId: string, date: string, count: number) => void;
  deleteSystemCheckIn: (id: string) => void;
  addEvent: (value: NewEvent) => LifeEvent;
  updateEvent: (id: string, updates: Partial<Omit<LifeEvent, 'id' | 'createdAt'>>) => void;
  deleteEvent: (id: string) => void;
  addFocus: (value: NewFocus) => LifeFocus;
  updateFocus: (id: string, updates: Partial<Omit<LifeFocus, 'id' | 'createdAt'>>) => void;
  deleteFocus: (id: string) => void;
  addNote: (value: NewNote) => LifeMapNote;
  updateNote: (id: string, updates: Partial<Omit<LifeMapNote, 'id' | 'createdAt'>>) => void;
  deleteNote: (id: string) => void;
  addReview: (value: NewReview) => LifeReview;
  updateReview: (id: string, updates: Partial<Omit<LifeReview, 'id' | 'createdAt'>>) => void;
  deleteReview: (id: string) => void;
  replaceLifeMapData: (data: LifeMapData) => void;
  migrateLegacyLayouts: () => boolean;
}

function loadSyncSettings(): SyncSettings {
  try {
    const raw = localStorage.getItem(SYNC_SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as SyncSettings;
  } catch { /* ignore malformed settings */ }
  return { roomCode: '', enabled: false };
}

function saveSyncSettings(settings: SyncSettings): void {
  localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(settings));
}

function genId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function stamp<T extends object>(value: T): T & { createdAt: string; updatedAt: string; revision: number } {
  const now = new Date().toISOString();
  return { ...value, createdAt: now, updatedAt: now, revision: 1 };
}

function revised<T extends { revision: number }>(item: T, updates: Partial<T>): T {
  return {
    ...item,
    ...updates,
    updatedAt: new Date().toISOString(),
    revision: Math.max(1, item.revision + 1),
  };
}

const persistence = createCoalescedPersistence<LifeMapData>({
  mirrorKey: STORAGE_MIRROR_KEY,
  label: 'life-map',
  writeAsync: (data) => lifeMapStorage.setItem(STORAGE_KEY, data).then(() => undefined),
});

export const useLifeMapStore = create<WithLiveblocks<LifeMapStore>>()(
  liveblocks(
    (setState, get) => {
      const set = createWorkspaceTrackedSet(setState, get, LIFE_MAP_FIELDS);
      const sync = loadSyncSettings();
      const initial = createEmptyLifeMapData();
      const updateCollection = <K extends keyof LifeMapData>(key: K, id: string, updates: Record<string, unknown>) => {
        set((state) => ({
          [key]: state[key].map((item) => item.id === id ? revised(item, updates) : item),
        }) as Partial<LifeMapStore>);
      };
      const deleteFromCollection = <K extends keyof LifeMapData>(key: K, id: string) =>
        updateCollection(key, id, { deletedAt: new Date().toISOString() });

      return {
        ...initial,
        isHydrated: false,
        hydrateStore: async () => {
          try {
          let raw = readJsonStorage<LifeMapData>(STORAGE_MIRROR_KEY)
            ?? await lifeMapStorage.getItem<LifeMapData>(STORAGE_KEY);
          if (!raw) {
            const legacy = await legacyLifeMapStorage.getItem<LifeMapData>(STORAGE_KEY);
            if (legacy) {
              raw = legacy;
              await lifeMapStorage.setItem(STORAGE_KEY, legacy);
            }
          }
            if (typeof raw === 'string') raw = JSON.parse(raw) as LifeMapData;
            if (raw) {
              set({ ...normalizeLifeMapData(raw), isHydrated: true });
              return;
            }
          } catch (error) {
            console.warn('[life-map] 本地数据加载失败：', error);
          }
          set({ isHydrated: true });
        },
        syncEnabled: sync.enabled,
        syncRoomCode: sync.roomCode,
        syncStatus: 'disconnected',
        enableSync: (roomCode) => {
          saveSyncSettings({ roomCode, enabled: true });
          set({ syncEnabled: true, syncRoomCode: roomCode });
        },
        disableSync: () => {
          saveSyncSettings({ roomCode: '', enabled: false });
          set({ syncEnabled: false, syncRoomCode: '', syncStatus: 'disconnected' });
        },
        setSyncStatus: (syncStatus) => set({ syncStatus }),
        addArea: (value) => {
          const area = stamp({ id: genId('area'), order: get().lifeMapAreas.length, ...value });
          set((state) => ({ lifeMapAreas: [...state.lifeMapAreas, area] }));
          return area;
        },
        updateArea: (id, updates) => updateCollection('lifeMapAreas', id, updates),
        deleteArea: (id) => {
          if (!canDeleteLifeArea(get(), id)) return false;
          deleteFromCollection('lifeMapAreas', id);
          return true;
        },
        updatePlanGroupPlacement: (id, placement) => updateCollection('lifeMapPlanGroups', id, { placement }),
        addStage: (value) => {
          const item = stamp({ ...value, id: value.id ?? genId('stage') });
          set((state) => ({ lifeMapStages: [...state.lifeMapStages, item] }));
          return item;
        },
        updateStage: (id, updates) => updateCollection('lifeMapStages', id, updates),
        deleteStage: (id) => deleteFromCollection('lifeMapStages', id),
        addTheme: (value) => {
          const item = stamp({ id: genId('theme'), ...value });
          set((state) => ({ lifeMapThemes: [...state.lifeMapThemes, item] }));
          return item;
        },
        updateTheme: (id, updates) => updateCollection('lifeMapThemes', id, updates),
        deleteTheme: (id) => deleteFromCollection('lifeMapThemes', id),
        addGoal: (value) => {
          const item = stamp({ id: genId('goal'), status: 'active' as const, ...value });
          set((state) => ({ lifeMapGoals: [...state.lifeMapGoals, item] }));
          return item;
        },
        updateGoal: (id, updates) => updateCollection('lifeMapGoals', id, updates),
        deleteGoal: (id) => {
          deleteFromCollection('lifeMapGoals', id);
          get().lifeMapGoals
            .filter((item) => !item.deletedAt && item.kind === 'phase' && item.parentGoalId === id)
            .forEach((item) => deleteFromCollection('lifeMapGoals', item.id));
        },
        shiftPlanningItems: (ids, days) => {
          const amount = Math.trunc(days);
          if (!amount || ids.length === 0) return [];
          const activeGoals = get().lifeMapGoals.filter((item) => !item.deletedAt);
          const selected = new Set(ids);
          activeGoals
            .filter((item) => item.kind === 'phase' && item.parentGoalId && selected.has(item.parentGoalId))
            .forEach((item) => selected.add(item.id));
          const updates = new Map<string, { start: string; targetDate: string }>();
          activeGoals.filter((item) => selected.has(item.id) && (item.kind === 'plan' || item.kind === 'phase')).forEach((item) => {
            updates.set(item.id, {
              start: dayjs(item.start).add(amount, 'day').format('YYYY-MM-DD'),
              targetDate: dayjs(item.targetDate).add(amount, 'day').format('YYYY-MM-DD'),
            });
          });
          activeGoals.filter((item) => item.kind === 'phase' && item.parentGoalId && updates.has(item.id) && !updates.has(item.parentGoalId)).forEach((phase) => {
            const parent = activeGoals.find((item) => item.id === phase.parentGoalId && item.kind === 'plan');
            const shifted = updates.get(phase.id);
            if (!parent || !shifted) return;
            const start = shifted.start < parent.start ? shifted.start : parent.start;
            const targetDate = shifted.targetDate > parent.targetDate ? shifted.targetDate : parent.targetDate;
            if (start !== parent.start || targetDate !== parent.targetDate) updates.set(parent.id, { start, targetDate });
          });
          const snapshot = activeGoals
            .filter((item) => updates.has(item.id))
            .map((item) => ({ id: item.id, start: item.start, targetDate: item.targetDate }));
          if (snapshot.length === 0) return [];
          const now = new Date().toISOString();
          set((state) => ({
            lifeMapGoals: state.lifeMapGoals.map((item) => {
              const update = updates.get(item.id);
              return update ? { ...item, ...update, updatedAt: now, revision: Math.max(1, item.revision + 1) } : item;
            }),
          }));
          return snapshot;
        },
        restorePlanningItems: (snapshot) => {
          const previous = new Map(snapshot.map((item) => [item.id, item]));
          if (previous.size === 0) return;
          const now = new Date().toISOString();
          set((state) => ({
            lifeMapGoals: state.lifeMapGoals.map((item) => {
              const restore = previous.get(item.id);
              return restore ? { ...item, start: restore.start, targetDate: restore.targetDate, updatedAt: now, revision: Math.max(1, item.revision + 1) } : item;
            }),
          }));
        },
        addSystem: (value) => {
          const item = stamp({ id: genId('system'), status: 'active' as const, ...value });
          set((state) => ({ lifeMapSystems: [...state.lifeMapSystems, item] }));
          return item;
        },
        updateSystem: (id, updates) => updateCollection('lifeMapSystems', id, updates),
        deleteSystem: (id) => deleteFromCollection('lifeMapSystems', id),
        addSystemCheckIn: (systemId, date = new Date().toISOString().slice(0, 10), count = 1) => {
          const safeCount = Math.max(0, count);
          const existing = get().lifeMapSystemCheckIns.find((item) => !item.deletedAt && item.systemId === systemId && item.date === date);
          if (existing) {
            const newCount = Math.max(0, existing.count + safeCount);
            updateCollection('lifeMapSystemCheckIns', existing.id, { count: newCount });
            return { ...existing, count: newCount };
          }
          const item = stamp({ id: genId('checkin'), systemId, date, count: safeCount });
          set((state) => ({ lifeMapSystemCheckIns: [...state.lifeMapSystemCheckIns, item] }));
          return item;
        },
        setSystemCheckIn: (systemId, date, count) => {
          const existing = get().lifeMapSystemCheckIns.find((item) => !item.deletedAt && item.systemId === systemId && item.date === date);
          if (count <= 0) {
            if (existing) deleteFromCollection('lifeMapSystemCheckIns', existing.id);
            return;
          }
          if (existing) {
            updateCollection('lifeMapSystemCheckIns', existing.id, { count });
            return;
          }
          const item = stamp({ id: genId('checkin'), systemId, date, count });
          set((state) => ({ lifeMapSystemCheckIns: [...state.lifeMapSystemCheckIns, item] }));
        },
        deleteSystemCheckIn: (id) => deleteFromCollection('lifeMapSystemCheckIns', id),
        addEvent: (value) => {
          const item = stamp({ importance: 'normal' as const, ...value, id: value.id ?? genId('event') });
          set((state) => ({ lifeMapEvents: [...state.lifeMapEvents, item] }));
          return item;
        },
        updateEvent: (id, updates) => updateCollection('lifeMapEvents', id, updates),
        deleteEvent: (id) => deleteFromCollection('lifeMapEvents', id),
        addFocus: (value) => {
          const item = stamp({ ...value, id: value.id ?? genId('focus') });
          set((state) => ({ lifeMapFocuses: [...state.lifeMapFocuses, item] }));
          return item;
        },
        updateFocus: (id, updates) => updateCollection('lifeMapFocuses', id, updates),
        deleteFocus: (id) => deleteFromCollection('lifeMapFocuses', id),
        addNote: (value) => {
          const item = stamp({ ...value, id: value.id ?? genId('note') });
          set((state) => ({ lifeMapNotes: [...state.lifeMapNotes, item] }));
          return item;
        },
        updateNote: (id, updates) => updateCollection('lifeMapNotes', id, updates),
        deleteNote: (id) => deleteFromCollection('lifeMapNotes', id),
        addReview: (value) => {
          const item = stamp({ id: genId('review'), ...value });
          set((state) => ({ lifeMapReviews: [...state.lifeMapReviews, item] }));
          return item;
        },
        updateReview: (id, updates) => updateCollection('lifeMapReviews', id, updates),
        deleteReview: (id) => deleteFromCollection('lifeMapReviews', id),
        replaceLifeMapData: (data) => set(normalizeLifeMapData(data)),
        migrateLegacyLayouts: () => {
          const readRecord = (key: string): Record<string, unknown> => {
            try {
              const value = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown;
              return value && typeof value === 'object' && !Array.isArray(value)
                ? value as Record<string, unknown>
                : {};
            } catch {
              return {};
            }
          };
          const projectSides = readRecord(LEGACY_PROJECT_SIDE_KEY);
          const nodeLayouts = readRecord(LEGACY_NODE_LAYOUT_KEY);
          const legacyEntryCount = Object.keys(projectSides).length + Object.keys(nodeLayouts).length;
          if (legacyEntryCount === 0) {
            try { localStorage.removeItem(LEGACY_PROJECT_RANK_KEY); } catch { /* optional legacy cleanup */ }
            return false;
          }
          const migration = migrateLegacyLifeMapLayouts(normalizeLifeMapData(get()), { projectSides, nodeLayouts });
          if (migration.changed) set(migration.data);
          // Do not discard unmatched layout entries before synchronized entities
          // have hydrated. A later workspace render will retry the migration.
          if (migration.matched === legacyEntryCount) {
            try {
              localStorage.removeItem(LEGACY_PROJECT_SIDE_KEY);
              localStorage.removeItem(LEGACY_NODE_LAYOUT_KEY);
              localStorage.removeItem(LEGACY_PROJECT_RANK_KEY);
            } catch { /* synchronized entity fields are already authoritative */ }
          }
          return migration.changed;
        },
      };
    },
    {
      client: liveblocksClient,
      storageMapping: Object.fromEntries(LIFE_MAP_FIELDS.map((field) => [field, true])) as Record<(typeof LIFE_MAP_FIELDS)[number], true>,
    },
  ),
);

let lastDataJson = '';
useLifeMapStore.subscribe((state) => {
  if (!state.isHydrated) return;
  const data = normalizeLifeMapData(state);
  const json = JSON.stringify(data);
  if (json === lastDataJson) return;
  lastDataJson = json;
  // 人生地图属于长期、低频但高价值的数据。先同步记录可恢复日志，
  // 防止移动端在 IndexedDB 合并写入窗口内被强制结束而丢失最后一次编辑。
  writeJsonStorage(STORAGE_MIRROR_KEY, data, 'life-map');
  persistence.schedule(data);
});
