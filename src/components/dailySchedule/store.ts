// ============================================================
// 每日任务安排 - Zustand Store（Liveblocks 同步版）
// 复用现有 liveblocksClient，独立 room 命名空间 daily-{code}
// ============================================================

import { create } from 'zustand';
import { liveblocks } from '@liveblocks/zustand';
import type { WithLiveblocks } from '@liveblocks/zustand';
import { liveblocksClient } from '@/store/client';
import type { DaySchedule, ScheduledItem, TimeSlot, TimeBlock } from './types';

const STORAGE_KEY = 'daily-schedule-data';
const SYNC_SETTINGS_KEY = 'daily-schedule-liveblocks';

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

function loadSchedules(): Record<string, DaySchedule> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return {};
      const result: Record<string, DaySchedule> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        // 跳过非法条目（远端 LWW 合并冲突 / JSON 损坏时可能出现 null 或非对象）
        if (!value || typeof value !== 'object') continue;
        const v = value as Partial<DaySchedule>;
        result[key] = {
          date: typeof v.date === 'string' ? v.date : key,
          items: Array.isArray(v.items) ? v.items : [],
          blocks: Array.isArray(v.blocks) ? v.blocks : [],
        };
      }
      return result;
    }
  } catch { /* ignore */ }
  return {};
}

function saveSchedules(schedules: Record<string, DaySchedule>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
  } catch (e) {
    console.warn('[daily-schedule] 本地存储写入失败：', e);
  }
}

// ── Store 接口 ──────────────────────────────────────────────

export type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface DailyScheduleStore {
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

  /** 移动任务到另一个时间段 */
  moveScheduledItem: (date: string, itemId: string, targetSlot: TimeSlot, targetIndex: number) => void;

  /** 同一时间段内重排序 */
  reorderScheduledItems: (date: string, slot: TimeSlot, itemIds: string[]) => void;

  /** 标记完成/未完成 */
  toggleScheduledItem: (date: string, itemId: string) => void;

  /** 更新安排项 */
  updateScheduledItem: (date: string, itemId: string, patch: Partial<ScheduledItem>) => void;

  // ── 时间块模式方法 ────────────────────────────────────────

  /** 添加时间块 */
  addTimeBlock: (date: string, block: Omit<TimeBlock, 'id'>) => void;

  /** 更新时间块 */
  updateTimeBlock: (date: string, blockId: string, patch: Partial<TimeBlock>) => void;

  /** 删除时间块 */
  removeTimeBlock: (date: string, blockId: string) => void;

  /** 切换时间块完成状态 */
  toggleTimeBlock: (date: string, blockId: string) => void;

  /** 拉伸/移动时间块 */
  resizeTimeBlock: (date: string, blockId: string, startTime: string, endTime: string) => void;
}

let _idCounter = 0;
function genScheduleId(): string {
  return `sch-${Date.now().toString(36)}-${(++_idCounter).toString(36)}`;
}

export const useDailyScheduleStore = create<WithLiveblocks<DailyScheduleStore>>()(
  liveblocks(
    (set, get) => {
      const initialSyncSettings = loadSyncSettings();

      return {
        schedules: loadSchedules(),
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

        toggleScheduledItem: (date, itemId) => {
          set((state) => {
            const schedules = { ...state.schedules };
            const day = schedules[date];
            if (!day) return state;
            const items = day.items.map((i) =>
              i.id === itemId ? { ...i, completed: !i.completed } : i,
            );
            schedules[date] = { ...day, items };
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
              b.id === blockId ? { ...b, ...patch } : b,
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

        toggleTimeBlock: (date, blockId) => {
          set((state) => {
            const schedules = { ...state.schedules };
            const day = schedules[date];
            if (!day) return state;
            const blocks = (day.blocks ?? []).map((b) =>
              b.id === blockId ? { ...b, completed: !b.completed } : b,
            );
            schedules[date] = { ...day, blocks };
            saveSchedules(schedules);
            return { schedules };
          });
        },

        resizeTimeBlock: (date, blockId, startTime, endTime) => {
          set((state) => {
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