// ============================================================
// Smart Timeline - zustand 全局状态管理（Liveblocks 同步版）
// ============================================================

import { create } from 'zustand';
import { liveblocks } from '@liveblocks/zustand';
import type { WithLiveblocks } from '@liveblocks/zustand';
import { createClient } from '@liveblocks/client';
import type { TimelineData, Task, TaskGroup, Note, Milestone } from '@/types';

const STORAGE_KEY = 'smart-timeline-data';
const SYNC_SETTINGS_KEY = 'smart-timeline-liveblocks';

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

function getDefaultData(): TimelineData {
  const y = new Date().getFullYear();
  return {
    tasks: [
      { id: 'demo-task-1', name: '产品规划', start: `${y}-01-05`, end: `${y}-02-28`, color: '#E0F2FE' },
      { id: 'demo-task-2', name: '设计评审', start: `${y}-03-01`, end: `${y}-04-15`, color: '#FCE7F3' },
      { id: 'demo-task-3', name: '研发冲刺', start: `${y}-02-15`, end: `${y}-05-30`, color: '#D1FAE5', isMain: true },
      { id: 'demo-task-4', name: '测试与发布', start: `${y}-06-01`, end: `${y}-07-20`, color: '#FEF3C7' },
      { id: 'demo-task-5', name: '暑期运营', start: `${y}-07-10`, end: `${y}-08-25`, color: '#EDE9FE' },
      { id: 'demo-task-6', name: '年度复盘', start: `${y}-11-01`, end: `${y}-12-20`, color: '#CFFAFE' },
    ],
    groups: [
      {
        id: 'demo-group-1',
        name: '产品研发',
        start: `${y}-01-05`,
        end: `${y}-07-20`,
        color: '#D1FAE5',
        autoDate: true,
        children: [
          { id: 'demo-task-1', name: '产品规划', start: `${y}-01-05`, end: `${y}-02-28`, color: '#E0F2FE', groupId: 'demo-group-1' },
          { id: 'demo-task-2', name: '设计评审', start: `${y}-03-01`, end: `${y}-04-15`, color: '#FCE7F3', groupId: 'demo-group-1' },
        ],
      },
      {
        id: 'demo-group-2',
        name: '开发阶段',
        start: `${y}-02-15`,
        end: `${y}-08-25`,
        color: '#EDE9FE',
        autoDate: true,
        children: [
          { id: 'demo-task-3', name: '研发冲刺', start: `${y}-02-15`, end: `${y}-05-30`, color: '#D1FAE5', isMain: true, groupId: 'demo-group-2' },
          { id: 'demo-task-4', name: '测试与发布', start: `${y}-06-01`, end: `${y}-07-20`, color: '#FEF3C7', groupId: 'demo-group-2' },
        ],
      },
    ],
    notes: [
      { id: 'demo-note-1', name: '项目启动会', date: `${y}-01-05`, type: 'pin', color: '#F59E0B' },
      { id: 'demo-note-2', name: '春节假期', date: `${y}-01-28`, endDate: `${y}-02-04`, type: 'range', color: '#EF4444' },
      { id: 'demo-note-3', name: '中期检查', date: `${y}-06-15`, type: 'pin', color: '#3B82F6' },
    ],
    milestones: [
      { id: 'demo-ms-1', name: 'V1.0 上线', date: `${y}-05-30`, color: '#F59E0B' },
      { id: 'demo-ms-2', name: '年度总结', date: `${y}-12-20`, color: '#F59E0B' },
    ],
  };
}

function loadData(): TimelineData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        tasks: parsed.tasks ?? [],
        groups: parsed.groups ?? [],
        notes: parsed.notes ?? [],
        milestones: parsed.milestones ?? [],
      };
    }
    return getDefaultData();
  } catch (e) {
    // 本地存储损坏：回退到默认示例数据，避免用户看到空白界面
    console.warn('[smart-timeline] 本地数据解析失败，已回退到默认数据：', e);
    return getDefaultData();
  }
}

function saveData(data: TimelineData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ── Liveblocks 客户端初始化 ───────────────────────────────────

export const liveblocksClient = createClient({
  publicApiKey: import.meta.env.VITE_LIVEBLOCKS_PUBLIC_KEY || '',
});

// ── Store 接口定义 ─────────────────────────────────────────────

export type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface TimelineStore extends TimelineData {
  syncEnabled: boolean;
  syncRoomCode: string;
  syncStatus: SyncStatus;

  enableSync: (roomCode: string) => void;
  disableSync: () => void;
  setSyncStatus: (status: SyncStatus) => void;

  addTask: (task: Task) => void;
  updateTask: (task: Task) => void;
  deleteTask: (taskId: string) => void;
  toggleTaskComplete: (taskId: string) => void;
  /** 仅更新任务的 Markdown 详情与时间戳 */
  updateTaskMarkdown: (taskId: string, markdown: string) => void;

  addGroup: (group: TaskGroup) => void;
  updateGroup: (group: TaskGroup) => void;
  deleteGroup: (groupId: string) => void;

  addNote: (note: Note) => void;
  updateNote: (note: Note) => void;
  deleteNote: (noteId: string) => void;

  addMilestone: (milestone: Milestone) => void;
  updateMilestone: (milestone: Milestone) => void;
  deleteMilestone: (milestoneId: string) => void;

  importData: (data: TimelineData) => void;
  exportData: () => string;

  getFlatTasks: () => Task[];
}

// ── 创建 Store ─────────────────────────────────────────────────

export const useTimelineStore = create<WithLiveblocks<TimelineStore>>()(
  liveblocks(
    (set, get) => {
      const initialSyncSettings = loadSyncSettings();

      return {
        ...loadData(),
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

        setSyncStatus: (status) => {
          set({ syncStatus: status });
        },

        addTask: (task) => {
          set((state) => {
            const newData = { ...state, tasks: [...state.tasks, task] };
            saveData(newData);
            return newData;
          });
        },

        updateTask: (task) => {
          set((state) => {
            const tasks = state.tasks.map((t) => (t.id === task.id ? task : t));
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.map((c) => (c.id === task.id ? { ...task, groupId: g.id } : c)),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        deleteTask: (taskId) => {
          set((state) => {
            const tasks = state.tasks.filter((t) => t.id !== taskId);
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.filter((c) => c.id !== taskId),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        toggleTaskComplete: (taskId) => {
          set((state) => {
            const tasks = state.tasks.map((t) =>
              t.id === taskId ? { ...t, completed: !t.completed } : t
            );
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.map((c) =>
                c.id === taskId ? { ...c, completed: !c.completed } : c
              ),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        updateTaskMarkdown: (taskId, markdown) => {
          const now = new Date().toISOString();
          set((state) => {
            const tasks = state.tasks.map((t) =>
              t.id === taskId
                ? { ...t, markdown, markdownUpdatedAt: now }
                : t
            );
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.map((c) =>
                c.id === taskId
                  ? { ...c, markdown, markdownUpdatedAt: now }
                  : c
              ),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        addGroup: (group) => {
          set((state) => {
            const newTasks = [...state.tasks];
            for (const child of group.children) {
              const idx = newTasks.findIndex((t) => t.id === child.id);
              if (idx >= 0) {
                // 已存在任务：仅打上 groupId 标记（保留 store 中完整的字段，避免被 child 快照覆盖）
                newTasks[idx] = { ...newTasks[idx], groupId: group.id };
              }
              // 不存在的 child 直接跳过：分组仅关联已有任务，
              // 避免 push 字段不完整的 task 对象进入 tasks 数组
            }
            const newData = { ...state, tasks: newTasks, groups: [...state.groups, group] };
            saveData(newData);
            return newData;
          });
        },

        updateGroup: (group) => {
          set((state) => {
            const groups = state.groups.map((g) => (g.id === group.id ? group : g));
            const newTasks = [...state.tasks];
            for (const child of group.children) {
              const idx = newTasks.findIndex((t) => t.id === child.id);
              if (idx >= 0) {
                newTasks[idx] = { ...newTasks[idx], groupId: group.id };
              }
            }
            const newData = { ...state, tasks: newTasks, groups };
            saveData(newData);
            return newData;
          });
        },

        deleteGroup: (groupId) => {
          set((state) => {
            const groups = state.groups.filter((g) => g.id !== groupId);
            const tasks = state.tasks.map((t) =>
              t.groupId === groupId ? { ...t, groupId: undefined } : t
            );
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        addNote: (note) => {
          set((state) => {
            const newData = { ...state, notes: [...state.notes, note] };
            saveData(newData);
            return newData;
          });
        },

        updateNote: (note) => {
          set((state) => {
            const notes = state.notes.map((n) => (n.id === note.id ? note : n));
            const newData = { ...state, notes };
            saveData(newData);
            return newData;
          });
        },

        deleteNote: (noteId) => {
          set((state) => {
            const notes = state.notes.filter((n) => n.id !== noteId);
            const newData = { ...state, notes };
            saveData(newData);
            return newData;
          });
        },

        addMilestone: (milestone) => {
          set((state) => {
            const newData = { ...state, milestones: [...state.milestones, milestone] };
            saveData(newData);
            return newData;
          });
        },

        updateMilestone: (milestone) => {
          set((state) => {
            const milestones = state.milestones.map((m) => (m.id === milestone.id ? milestone : m));
            const newData = { ...state, milestones };
            saveData(newData);
            return newData;
          });
        },

        deleteMilestone: (milestoneId) => {
          set((state) => {
            const milestones = state.milestones.filter((m) => m.id !== milestoneId);
            const newData = { ...state, milestones };
            saveData(newData);
            return newData;
          });
        },

        importData: (data) => {
          const normalized: TimelineData = {
            tasks: data.tasks ?? [],
            groups: data.groups ?? [],
            notes: data.notes ?? [],
            milestones: data.milestones ?? [],
          };
          saveData(normalized);
          set(normalized);
        },

        exportData: () => {
          const { tasks, groups, notes, milestones } = get();
          return JSON.stringify({ tasks, groups, notes, milestones }, null, 2);
        },

        getFlatTasks: () => {
          const { tasks } = get();
          return tasks;
        },
      };
    },
    {
      client: liveblocksClient,
      storageMapping: {
        tasks: true,
        groups: true,
        notes: true,
        milestones: true,
      },
    }
  )
);