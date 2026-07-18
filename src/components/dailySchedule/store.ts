// ============================================================
// 每日任务安排 - Zustand Store（Liveblocks 同步版）
// 复用现有 liveblocksClient，独立 room 命名空间 daily-{code}
// ============================================================

import { create } from 'zustand';
import { liveblocks } from '@liveblocks/zustand';
import type { WithLiveblocks } from '@liveblocks/zustand';
import { liveblocksClient } from '@/store/client';
import type { DaySchedule, ScheduledItem, TimeSlot, TimeBlock } from './types';
import { createScopedStorage, readJsonStorage, writeJsonStorage } from '@/utils/persistence';
import { registerUndoExecutor } from '@/services/operationHistory';

const STORAGE_KEY = 'daily-schedule-data';
const STORAGE_MIRROR_KEY = `${STORAGE_KEY}:mirror`;
const SYNC_SETTINGS_KEY = 'daily-schedule-liveblocks';
const dailyScheduleStorage = createScopedStorage('daily_schedule_data');

export const DAILY_ROOM_PREFIX = 'daily-';

/**
 * 空白日历的共享引用。
 * 替换 getDaySchedule 中 `?? { date, items: [], blocks: [] }` 每次新建对象的写法，
 * 避免下游 useMemo 在 date 不存在时每次 render 都拿到全新引用而失效。
 * 注意：消费者不应直接修改本对象的字段。
 */
export const EMPTY_DAY_SCHEDULE: DaySchedule = Object.freeze({
  date: '',
  items: [],
  blocks: [],
}) as DaySchedule;

// ── 同步设置 ───────────────────────────────────────────────

interface SyncSettings {
  roomCode: string;
  enabled: boolean;
}

function loadSyncSettings(): SyncSettings {
  try {
    const raw = localStorage.getItem(SYNC_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { roomCode: '', enabled: false };
}

function saveSyncSettings(settings: SyncSettings) {
  localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(settings));
}

// ── 数据加载/保存 ───────────────────────────────────────────

function getInitialSchedules(): Record<string, DaySchedule> {
  return {};
}

function isValidClockTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidTimeRange(startTime: unknown, endTime: unknown): boolean {
  return isValidClockTime(startTime) && isValidClockTime(endTime) && startTime < endTime;
}

export function normalizeDailySchedules(
  input: Record<string, DaySchedule> | null | undefined,
): Record<string, DaySchedule> {
  const normalized: Record<string, DaySchedule> = {};
  for (const [date, day] of Object.entries(input ?? {})) {
    if (!day || typeof day !== 'object') continue;
    const usedIds = new Set<string>();
    const items = (Array.isArray(day.items) ? day.items : []).filter((item) => {
      if (!item || typeof item.id !== 'string' || usedIds.has(item.id)) return false;
      usedIds.add(item.id);
      return true;
    });
    const blocks = (Array.isArray(day.blocks) ? day.blocks : []).filter((block) => {
      if (!block || typeof block.id !== 'string' || usedIds.has(block.id)) return false;
      if (!isValidClockTime(block.startTime) || !isValidClockTime(block.endTime)) return false;
      if (block.startTime >= block.endTime) return false;
      usedIds.add(block.id);
      return true;
    });
    normalized[date] = { date, items, blocks };
  }
  return normalized;
}

async function saveSchedulesAsync(schedules: Record<string, DaySchedule>) {
  try {
    await dailyScheduleStorage.setItem(STORAGE_KEY, schedules);
  } catch (e) {
    console.warn('[daily-schedule] IndexedDB 写入失败：', e);
  }
}

export async function persistDailySchedules(schedules: Record<string, DaySchedule>): Promise<void> {
  writeJsonStorage(STORAGE_MIRROR_KEY, schedules, 'daily-schedule');
  await saveSchedulesAsync(schedules);
}

function saveSchedules(schedules: Record<string, DaySchedule>) {
  void persistDailySchedules(schedules);
}

// ── Store 接口 ──────────────────────────────────────────────

export type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface DailyScheduleStore {
  isHydrated: boolean;
  hydrateStore: () => Promise<void>;

  /** 所有日期的安排数据 */
  schedules: Record<string, DaySchedule>;

  /** 同步状态 */
  syncEnabled: boolean;
  syncRoomCode: string;
  syncStatus: SyncStatus;

  enableSync: (roomCode: string) => void;
  disableSync: () => void;
  setSyncStatus: (status: SyncStatus) => void;

  /** 获取指定日期的安排 */
  getDaySchedule: (date: string) => DaySchedule;

  /** 添加任务到时间段 */
  addScheduledItem: (date: string, item: Omit<ScheduledItem, 'id' | 'order'>) => void;

  /** 从时间段移除任务 */
  removeScheduledItem: (date: string, itemId: string) => void;
  restoreScheduledItem: (date: string, item: ScheduledItem, targetIndex: number) => void;

  /** 移动任务到另一个时间段 */
  moveScheduledItem: (date: string, itemId: string, targetSlot: TimeSlot, targetIndex: number) => void;

  /** 同一时间段内重排序 */
  reorderScheduledItems: (date: string, slot: TimeSlot, itemIds: string[]) => void;

  /** 更新安排项 */
  updateScheduledItem: (date: string, itemId: string, patch: Partial<ScheduledItem>) => void;

  // ── 时间块模式方法 ────────────────────────────────────────

  /** 添加时间块 */
  addTimeBlock: (date: string, block: Omit<TimeBlock, 'id'>) => void;

  /** 更新时间块 */
  updateTimeBlock: (date: string, blockId: string, patch: Partial<TimeBlock>) => void;

  /** 删除时间块 */
  removeTimeBlock: (date: string, blockId: string) => void;

  /** 拉伸/移动时间块 */
  resizeTimeBlock: (date: string, blockId: string, startTime: string, endTime: string) => void;

  /** 根据源任务 ID 批量清理失效的排期项和时间块 */
  removeBySourceIds: (sourceIds: string[]) => void;
  /** 同步来源任务的展示信息，不改变其已安排的时间段。 */
  updateBySourceId: (sourceId: string, patch: { name?: string; duration?: number }) => void;
  replaceSchedules: (schedules: Record<string, DaySchedule>) => void;
}

let _idCounter = 0;
const pendingSourceIdsToRemove = new Set<string>();
let dailyHydrationPromise: Promise<void> | null = null;

function genScheduleId(): string {
  return `sch-${Date.now().toString(36)}-${(++_idCounter).toString(36)}`;
}

export const useDailyScheduleStore = create<WithLiveblocks<DailyScheduleStore>>()(
  liveblocks(
    (set, get) => {
      const initialSyncSettings = loadSyncSettings();

      return {
        schedules: getInitialSchedules(),
        isHydrated: false,
        hydrateStore: () => {
          if (get().isHydrated) return Promise.resolve();
          if (dailyHydrationPromise) return dailyHydrationPromise;

          dailyHydrationPromise = (async () => {
          try {
            const mirror = readJsonStorage<unknown>(STORAGE_MIRROR_KEY);
            let parsed = mirror ?? await dailyScheduleStorage.getItem<unknown>(STORAGE_KEY);
            if (!parsed) {
              const lsRaw = readJsonStorage<unknown>(STORAGE_KEY);
              if (lsRaw) {
                parsed = lsRaw;
                await dailyScheduleStorage.setItem(STORAGE_KEY, parsed);
                writeJsonStorage(STORAGE_MIRROR_KEY, parsed, 'daily-schedule');
                localStorage.removeItem(STORAGE_KEY);
              }
            } else if (typeof parsed === 'string') {
              parsed = JSON.parse(parsed);
            }

            if (parsed && typeof parsed === 'object') {
              const result: Record<string, DaySchedule> = {};
              for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
                if (!value || typeof value !== 'object') continue;
                const v = value as Partial<DaySchedule>;
                result[key] = {
                  date: typeof v.date === 'string' ? v.date : key,
                  items: Array.isArray(v.items) ? v.items : [],
                  blocks: Array.isArray(v.blocks) ? v.blocks : [],
                };
              }
              const normalized = normalizeDailySchedules(result);
              set({ schedules: normalized, isHydrated: true });
              saveSchedules(normalized);
              if (pendingSourceIdsToRemove.size > 0) {
                const pendingIds = [...pendingSourceIdsToRemove];
                pendingSourceIdsToRemove.clear();
                get().removeBySourceIds(pendingIds);
              }
              return;
            }
          } catch (e) {
            console.warn('[daily-schedule] IndexedDB数据加载失败：', e);
          }
            set({ isHydrated: true });
            if (pendingSourceIdsToRemove.size > 0) {
              const pendingIds = [...pendingSourceIdsToRemove];
              pendingSourceIdsToRemove.clear();
              get().removeBySourceIds(pendingIds);
            }
          })().finally(() => {
            dailyHydrationPromise = null;
          });

          return dailyHydrationPromise;
        },
        syncEnabled: initialSyncSettings.enabled,
        syncRoomCode: initialSyncSettings.roomCode,
        syncStatus: 'disconnected' as SyncStatus,

        enableSync: (roomCode: string) => {
          const settings = { roomCode, enabled: true };
          saveSyncSettings(settings);
          set({ syncEnabled: true, syncRoomCode: roomCode });
        },

        disableSync: () => {
          const settings = { roomCode: '', enabled: false };
          saveSyncSettings(settings);
          set({ syncEnabled: false, syncRoomCode: '', syncStatus: 'disconnected' });
        },

        setSyncStatus: (status: SyncStatus) => {
          set({ syncStatus: status });
        },

        getDaySchedule: (date: string) => {
          const state = get();
          return state.schedules[date] ?? EMPTY_DAY_SCHEDULE;
        },

        addScheduledItem: (date, item) => {
          set((state) => {
            const schedules = { ...state.schedules };
            const day = schedules[date] ?? { date, items: [], blocks: [] };
            const sameSlotItems = day.items.filter((i) => i.timeSlot === item.timeSlot);
            const newItem: ScheduledItem = {
              ...item,
              id: genScheduleId(),
              order: sameSlotItems.length,
            };
            schedules[date] = { ...day, items: [...day.items, newItem] };
            saveSchedules(schedules);
            return { schedules };
          });
        },

        removeScheduledItem: (date, itemId) => {
          set((state) => {
            const schedules = { ...state.schedules };
            const day = schedules[date];
            if (!day) return state;
            const items = day.items.filter((i) => i.id !== itemId);
            schedules[date] = { ...day, items };
            // 重新排序
            reorderSlotItems(schedules, date);
            saveSchedules(schedules);
            return { schedules };
          });
        },

        moveScheduledItem: (date, itemId, targetSlot, targetIndex) => {
          set((state) => {
            const schedules = { ...state.schedules };
            const day = schedules[date];
            if (!day) return state;

            const item = day.items.find((i) => i.id === itemId);
            if (!item) return state;

            // 更新时间段
            const updatedItem = { ...item, timeSlot: targetSlot };
            const otherItems = day.items.filter((i) => i.id !== itemId);
            const slotItems = otherItems.filter((i) => i.timeSlot === targetSlot);

            // 插入到目标位置
            const clampedIndex = Math.min(targetIndex, slotItems.length);
            slotItems.splice(clampedIndex, 0, updatedItem);

            // 合并
            const nonSlotItems = otherItems.filter((i) => i.timeSlot !== targetSlot);
            const allItems = [...nonSlotItems, ...slotItems];
            schedules[date] = { ...day, items: allItems };
            reorderSlotItems(schedules, date);
            saveSchedules(schedules);
            return { schedules };
          });
        },

        reorderScheduledItems: (date, slot, itemIds) => {
          set((state) => {
            const schedules = { ...state.schedules };
            const day = schedules[date];
            if (!day) return state;

            const idOrder = new Map(itemIds.map((id, idx) => [id, idx]));
            const slotItems = day.items
              .filter((i) => i.timeSlot === slot)
              .sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
            const otherItems = day.items.filter((i) => i.timeSlot !== slot);
            schedules[date] = { ...day, items: [...otherItems, ...slotItems] };
            reorderSlotItems(schedules, date);
            saveSchedules(schedules);
            return { schedules };
          });
        },

        updateScheduledItem: (date, itemId, patch) => {
          set((state) => {
            const schedules = { ...state.schedules };
            const day = schedules[date];
            if (!day) return state;
            const items = day.items.map((i) =>
              i.id === itemId ? { ...i, ...patch } : i,
            );
            schedules[date] = { ...day, items };
            saveSchedules(schedules);
            return { schedules };
          });
        },

        // ── 时间块方法实现 ────────────────────────────────────

        addTimeBlock: (date, block) => {
          set((state) => {
            if (!isValidTimeRange(block.startTime, block.endTime)) return state;
            const schedules = { ...state.schedules };
            const day = schedules[date] ?? { date, items: [], blocks: [] };
            const newBlock: TimeBlock = { ...block, id: genScheduleId() };
            schedules[date] = { ...day, blocks: [...(day.blocks ?? []), newBlock] };
            saveSchedules(schedules);
            return { schedules };
          });
        },

        updateTimeBlock: (date, blockId, patch) => {
          set((state) => {
            const schedules = { ...state.schedules };
            const day = schedules[date];
            if (!day) return state;
            const blocks = (day.blocks ?? []).map((b) =>
              b.id === blockId
                ? (() => {
                    const candidate = { ...b, ...patch };
                    return isValidTimeRange(candidate.startTime, candidate.endTime) ? candidate : b;
                  })()
                : b,
            );
            schedules[date] = { ...day, blocks };
            saveSchedules(schedules);
            return { schedules };
          });
        },

        removeTimeBlock: (date, blockId) => {
          set((state) => {
            const schedules = { ...state.schedules };
            const day = schedules[date];
            if (!day) return state;
            const blocks = (day.blocks ?? []).filter((b) => b.id !== blockId);
            schedules[date] = { ...day, blocks };
            saveSchedules(schedules);
            return { schedules };
          });
        },

        resizeTimeBlock: (date, blockId, startTime, endTime) => {
          set((state) => {
            if (!isValidTimeRange(startTime, endTime)) return state;
            const schedules = { ...state.schedules };
            const day = schedules[date];
            if (!day) return state;
            const blocks = (day.blocks ?? []).map((b) =>
              b.id === blockId ? { ...b, startTime, endTime } : b,
            );
            schedules[date] = { ...day, blocks };
            saveSchedules(schedules);
            return { schedules };
          });
        },

        removeBySourceIds: (sourceIds) => {
          if (!sourceIds || sourceIds.length === 0) return;
          if (!get().isHydrated) {
            sourceIds.forEach((sourceId) => pendingSourceIdsToRemove.add(sourceId));
            return;
          }
          const ids = new Set(sourceIds);
          set((state) => {
            const schedules = { ...state.schedules };
            let changed = false;

            for (const [date, day] of Object.entries(schedules)) {
              const originalItemsCount = day.items?.length || 0;
              const originalBlocksCount = day.blocks?.length || 0;

              const newItems = (day.items || []).filter((i) => !ids.has(i.sourceId));
              const newBlocks = (day.blocks || []).filter((b) => !ids.has(b.sourceId));

              if (newItems.length !== originalItemsCount || newBlocks.length !== originalBlocksCount) {
                schedules[date] = { ...day, items: newItems, blocks: newBlocks };
                changed = true;
              }
            }

            if (changed) {
              // 重新排序受影响的日期
              for (const date of Object.keys(schedules)) {
                reorderSlotItems(schedules, date);
              }
              saveSchedules(schedules);
              return { schedules };
            }
            return state;
          });
        },

        restoreScheduledItem: (date, item, targetIndex) => {
          set((state) => {
            const schedules = { ...state.schedules };
            const day = schedules[date] ?? { date, items: [], blocks: [] };
            if (day.items.some((candidate) => candidate.id === item.id)) return state;
            const slotItems = day.items.filter((candidate) => candidate.timeSlot === item.timeSlot);
            slotItems.splice(Math.min(Math.max(0, targetIndex), slotItems.length), 0, { ...item });
            const otherItems = day.items.filter((candidate) => candidate.timeSlot !== item.timeSlot);
            schedules[date] = { ...day, items: [...otherItems, ...slotItems] };
            reorderSlotItems(schedules, date);
            saveSchedules(schedules);
            return { schedules };
          });
        },

        updateBySourceId: (sourceId, patch) => {
          set((state) => {
            let changed = false;
            const schedules = Object.fromEntries(Object.entries(state.schedules).map(([date, day]) => {
              let dayChanged = false;
              const items = (day.items || []).map((item) => {
                if (item.sourceId !== sourceId) return item;
                changed = true;
                dayChanged = true;
                return { ...item, ...patch };
              });
              const blocks = (day.blocks || []).map((block) => {
                if (block.sourceId !== sourceId || patch.name === undefined) return block;
                changed = true;
                dayChanged = true;
                return { ...block, name: patch.name! };
              });
              return [date, dayChanged ? { ...day, items, blocks } : day];
            }));
            if (!changed) return state;
            saveSchedules(schedules);
            return { schedules };
          });
        },

        replaceSchedules: (schedules) => {
          const normalized = normalizeDailySchedules(schedules);
          saveSchedules(normalized);
          set({ schedules: normalized });
        },
      };
    },
    {
      client: liveblocksClient,
      storageMapping: {
        schedules: true,
      },
    }
  )
);

registerUndoExecutor('daily-remove', (raw) => {
  const payload = raw as { date: string; itemId: string; expectedSourceId: string };
  const state = useDailyScheduleStore.getState();
  const item = state.schedules[payload.date]?.items.find((candidate) => candidate.id === payload.itemId);
  if (!item || item.sourceId !== payload.expectedSourceId) return '安排项已经发生变化';
  state.removeScheduledItem(payload.date, payload.itemId);
});
registerUndoExecutor('daily-move', (raw) => {
  const payload = raw as { date: string; itemId: string; targetSlot: TimeSlot; targetIndex: number; expectedSlot: TimeSlot };
  const state = useDailyScheduleStore.getState();
  const item = state.schedules[payload.date]?.items.find((candidate) => candidate.id === payload.itemId);
  if (!item || item.timeSlot !== payload.expectedSlot) return '任务位置已经发生变化';
  state.moveScheduledItem(payload.date, payload.itemId, payload.targetSlot, payload.targetIndex);
});
registerUndoExecutor('daily-restore', (raw) => {
  const payload = raw as { date: string; item: ScheduledItem; targetIndex: number };
  const state = useDailyScheduleStore.getState();
  if (state.schedules[payload.date]?.items.some((candidate) => candidate.id === payload.item.id)) return '任务已经重新安排';
  state.restoreScheduledItem(payload.date, payload.item, payload.targetIndex);
});

// 远端 Liveblocks 推送同步落盘，避免刷新后回退到旧的本地排期。
{
  let lastSchedules: unknown = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  useDailyScheduleStore.subscribe((state) => {
    if (state.schedules === lastSchedules) return;
    lastSchedules = state.schedules;

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveSchedules(state.schedules);
    }, 500);
  });
}

/** 内部辅助：按时间段重新编号 order（不可变版本） */
function reorderSlotItems(schedules: Record<string, DaySchedule>, date: string) {
  const day = schedules[date];
  if (!day) return;
  const slots: TimeSlot[] = ['morning', 'afternoon', 'evening'];

  // 按时间段分组，创建新对象更新 order
  const reorderedItems: ScheduledItem[] = [];
  for (const slot of slots) {
    const slotItems = day.items
      .filter((i) => i.timeSlot === slot)
      .map((item, idx) => ({ ...item, order: idx }));
    reorderedItems.push(...slotItems);
  }

  // 更新为新的 items 数组
  schedules[date] = { ...day, items: reorderedItems };
}
