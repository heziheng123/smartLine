import { create } from 'zustand';
import type { Task } from '@/types';
import type { ScheduledItem, TimeBlock } from '@/components/dailySchedule/types';

export interface RecycledTask { id: string; task: Task; groupId?: string; placements?: Array<{ date: string; items: ScheduledItem[]; blocks: TimeBlock[] }>; deletedAt: number; expiresAt: number; }
const KEY = 'line-recycle-bin-v1';
const RETENTION = 30 * 24 * 60 * 60 * 1000;
const load = (): RecycledTask[] => {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as RecycledTask[]).filter((item) => item.expiresAt > Date.now()); } catch { return []; }
};
const save = (items: RecycledTask[]) => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage may be unavailable in SSR/tests */ } };
interface State { items: RecycledTask[]; recycle: (task: Task, groupId?: string, placements?: RecycledTask['placements']) => RecycledTask; remove: (id: string) => void; clear: () => void; }
export const useRecycleBin = create<State>((set) => ({
  items: typeof localStorage === 'undefined' ? [] : load(),
  recycle: (task, groupId, placements) => {
    const item = { id: `trash-${Date.now().toString(36)}-${task.id}`, task: structuredClone(task), groupId, placements: structuredClone(placements ?? []), deletedAt: Date.now(), expiresAt: Date.now() + RETENTION };
    set((state) => { const items = [item, ...state.items.filter((old) => old.task.id !== task.id)]; save(items); return { items }; }); return item;
  },
  remove: (id) => set((state) => { const items = state.items.filter((item) => item.id !== id); save(items); return { items }; }),
  clear: () => { save([]); set({ items: [] }); },
}));
