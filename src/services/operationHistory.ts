import { create } from 'zustand';

export type OperationModule = '项目文档' | '每日安排' | '周矩阵' | 'EBB' | '知识大盘';
export interface UndoSpec { kind: string; payload: unknown; }
export interface OperationEntry {
  id: string; label: string; detail: string; modules: OperationModule[];
  createdAt: number; canUndo: boolean; undoSpec?: UndoSpec; error?: string;
}
type UndoResult = void | boolean | string;
type UndoHandler = () => UndoResult | Promise<UndoResult>;
const KEY = 'line-operation-history-v2';
const handlers = new Map<string, UndoHandler>();
const executors = new Map<string, (payload: unknown) => UndoResult | Promise<UndoResult>>();
let suppressDepth = 0;
const load = (): OperationEntry[] => {
  if (typeof localStorage === 'undefined') return [];
  try { return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as OperationEntry[]).slice(0, 50); } catch { return []; }
};
const save = (entries: OperationEntry[]) => { try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* unavailable in SSR */ } };
interface State {
  entries: OperationEntry[]; panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  record: (entry: Omit<OperationEntry, 'id' | 'createdAt' | 'canUndo'>, undo?: UndoHandler) => string;
  undo: (id?: string) => Promise<boolean>; dismiss: (id: string) => void; clear: () => void;
}
const makeId = () => `operation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const useOperationHistory = create<State>((set, get) => ({
  entries: load(), panelOpen: false, setPanelOpen: (panelOpen) => set({ panelOpen }),
  record: (entry, undo) => {
    if (suppressDepth > 0) return '';
    const id = makeId(); if (undo) handlers.set(id, undo);
    set((state) => {
      // Only the newest operation may be undone. This prevents an old snapshot
      // from overwriting newer edits on the same task/day.
      const entries = [{ ...entry, id, createdAt: Date.now(), canUndo: true, error: undefined }, ...state.entries.map((item) => ({ ...item, canUndo: false }))].slice(0, 50);
      save(entries); return { entries };
    });
    return id;
  },
  undo: async (requestedId) => {
    const entry = requestedId ? get().entries.find((item) => item.id === requestedId) : get().entries[0];
    if (!entry?.canUndo) return false;
    const handler = handlers.get(entry.id) ?? (entry.undoSpec ? () => executors.get(entry.undoSpec!.kind)?.(entry.undoSpec!.payload) : undefined);
    if (!handler) {
      set((state) => { const entries = state.entries.map((item) => item.id === entry.id ? { ...item, error: '当前版本无法恢复这条历史操作' } : item); save(entries); return { entries }; });
      return false;
    }
    try {
      suppressDepth += 1;
      const result = await handler();
      if (result === false || typeof result === 'string') throw new Error(typeof result === 'string' ? result : '撤销条件已经发生变化');
      handlers.delete(entry.id);
      set((state) => {
        let enabledNext = false;
        const entries = state.entries.map((item) => {
          if (item.id === entry.id) return { ...item, canUndo: false, error: undefined };
          if (!enabledNext && item.createdAt < entry.createdAt && item.undoSpec) { enabledNext = true; return { ...item, canUndo: true, error: undefined }; }
          return { ...item, canUndo: false };
        });
        save(entries); return { entries };
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '撤销失败';
      set((state) => { const entries = state.entries.map((item) => item.id === entry.id ? { ...item, canUndo: true, error: message } : item); save(entries); return { entries }; });
      return false;
    } finally { suppressDepth = Math.max(0, suppressDepth - 1); }
  },
  dismiss: (id) => { handlers.delete(id); set((state) => {
    const removedWasUndoable = state.entries.find((entry) => entry.id === id)?.canUndo;
    const filtered = state.entries.filter((entry) => entry.id !== id);
    const entries = removedWasUndoable ? filtered.map((entry, index) => ({ ...entry, canUndo: index === 0 && Boolean(entry.undoSpec) })) : filtered;
    save(entries); return { entries };
  }); },
  clear: () => { handlers.clear(); save([]); set({ entries: [] }); },
}));
export const recordOperation = (entry: Omit<OperationEntry, 'id' | 'createdAt' | 'canUndo'>, undo?: UndoHandler) => useOperationHistory.getState().record(entry, undo);
export const registerUndoExecutor = (kind: string, executor: (payload: unknown) => UndoResult | Promise<UndoResult>) => { executors.set(kind, executor); };
export const isOperationRecordingSuppressed = () => suppressDepth > 0;
export const runWithoutOperationRecording = <T,>(work: () => T): T => {
  suppressDepth += 1;
  try { return work(); } finally { suppressDepth = Math.max(0, suppressDepth - 1); }
};
