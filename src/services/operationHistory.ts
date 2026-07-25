import { create } from 'zustand';

export type OperationModule = '项目文档' | '每日安排' | '周矩阵' | 'EBB' | '知识大盘';
export interface UndoSpec { kind: string; payload: unknown; }
export interface OperationEntry {
  id: string; label: string; detail: string; modules: OperationModule[];
  createdAt: number; canUndo: boolean; undoSpec?: UndoSpec; error?: string;
}
type UndoResult = void | boolean | string;
type UndoHandler = () => UndoResult | Promise<UndoResult>;
const RETIRED_STORAGE_KEYS = ['line-operation-history-v2', 'line-recycle-bin-v1'];
const handlers = new Map<string, UndoHandler>();
const executors = new Map<string, (payload: unknown) => UndoResult | Promise<UndoResult>>();
let suppressDepth = 0;

// The former history/recycle library has been retired. Remove its persisted
// payloads once this module loads; contextual undo below is intentionally
// limited to the latest operation in the current browser session.
if (typeof localStorage !== 'undefined') {
  try {
    RETIRED_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage can be unavailable in private browsing or tests.
  }
}

interface State {
  entries: OperationEntry[];
  record: (entry: Omit<OperationEntry, 'id' | 'createdAt' | 'canUndo'>, undo?: UndoHandler) => string;
  undo: (id?: string) => Promise<boolean>;
  clear: () => void;
}
const makeId = () => `operation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const useOperationHistory = create<State>((set, get) => ({
  entries: [],
  record: (entry, undo) => {
    if (suppressDepth > 0) return '';
    const id = makeId();
    handlers.clear();
    if (undo) handlers.set(id, undo);
    set({
      entries: [{ ...entry, id, createdAt: Date.now(), canUndo: true, error: undefined }],
    });
    return id;
  },
  undo: async (requestedId) => {
    const entry = requestedId ? get().entries.find((item) => item.id === requestedId) : get().entries[0];
    if (!entry?.canUndo) return false;
    const handler = handlers.get(entry.id) ?? (entry.undoSpec ? () => executors.get(entry.undoSpec!.kind)?.(entry.undoSpec!.payload) : undefined);
    if (!handler) {
      set((state) => ({
        entries: state.entries.map((item) =>
          item.id === entry.id ? { ...item, error: '当前操作已经无法恢复' } : item),
      }));
      return false;
    }
    try {
      suppressDepth += 1;
      const result = await handler();
      if (result === false || typeof result === 'string') throw new Error(typeof result === 'string' ? result : '撤销条件已经发生变化');
      handlers.delete(entry.id);
      set({ entries: [] });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '撤销失败';
      set((state) => ({
        entries: state.entries.map((item) =>
          item.id === entry.id ? { ...item, canUndo: true, error: message } : item),
      }));
      return false;
    } finally { suppressDepth = Math.max(0, suppressDepth - 1); }
  },
  clear: () => {
    handlers.clear();
    set({ entries: [] });
  },
}));
export const recordOperation = (entry: Omit<OperationEntry, 'id' | 'createdAt' | 'canUndo'>, undo?: UndoHandler) => useOperationHistory.getState().record(entry, undo);
export const registerUndoExecutor = (kind: string, executor: (payload: unknown) => UndoResult | Promise<UndoResult>) => { executors.set(kind, executor); };
export const isOperationRecordingSuppressed = () => suppressDepth > 0;
export const runWithoutOperationRecording = <T,>(work: () => T): T => {
  suppressDepth += 1;
  try { return work(); } finally { suppressDepth = Math.max(0, suppressDepth - 1); }
};
