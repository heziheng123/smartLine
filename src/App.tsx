// ============================================================
// Smart Timeline - React App 根组件（独立网页版）
// ============================================================

import React, { useState, useCallback, useMemo } from 'react';
import dayjs from 'dayjs';
import { todayStr, splitDate } from '@/utils/dateSafe';
import type { Task, TaskGroup, Note, Milestone, ContextMenuItem } from '@/types';
import { useTimelineStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import TimelineView from '@/components/TimelineView';
import Toolbar from '@/components/Toolbar';
import TaskDialog from '@/components/TaskDialog';
import GroupDialog from '@/components/GroupDialog';
import NoteDialog from '@/components/NoteDialog';
import MilestoneDialog from '@/components/MilestoneDialog';
import SyncDialog from '@/components/SyncDialog';
import ContextMenu from '@/components/ContextMenu';
import Sidebar, { type AppModule } from '@/components/Sidebar';
import EbbView from '@/ebb/components/EbbView';
import DailyScheduleView from '@/components/dailySchedule/DailyScheduleView';
import ProjectDocumentView from '@/components/smartBlock/ProjectDocumentView';
import WeekMatrixView from '@/components/smartBlock/WeekMatrixView';
import { KnowledgeGraphView } from '@/graph/components/KnowledgeGraphView';

import '@/styles/timeline.css';
import '@/styles/ebb.css';
import '@/styles/daily-schedule.css';
import '@/styles/smart-block.css';

type DialogType = 'task' | 'group' | 'note' | 'milestone' | 'sync' | null;

const App: React.FC = () => {
  // 选择性订阅：只关心 tasks/groups/notes/milestones 数据切片 + 各 CRUD 方法。
  // CRUD 方法在 zustand 中是 store 创建时一次性定义的稳定引用，
  // 故即便 syncStatus 等其它切片变化，本组件也不会重渲染。
  const {
    tasks,
    groups,
    notes,
    milestones,
    updateTask,
    deleteTask,
    toggleTaskComplete,
    addTask,
    updateGroup,
    addGroup,
    deleteGroup,
    addNote,
    updateNote,
    deleteNote,
    addMilestone,
    updateMilestone,
    deleteMilestone,
    importData,
    exportData,
    updateBlockHeader,
  } = useTimelineStore(
    useShallow((s) => ({
      tasks: s.tasks,
      groups: s.groups,
      notes: s.notes,
      milestones: s.milestones,
      updateTask: s.updateTask,
      deleteTask: s.deleteTask,
      toggleTaskComplete: s.toggleTaskComplete,
      addTask: s.addTask,
      updateGroup: s.updateGroup,
      addGroup: s.addGroup,
      deleteGroup: s.deleteGroup,
      addNote: s.addNote,
      updateNote: s.updateNote,
      deleteNote: s.deleteNote,
      addMilestone: s.addMilestone,
      updateMilestone: s.updateMilestone,
      deleteMilestone: s.deleteMilestone,
      importData: s.importData,
      exportData: s.exportData,
      updateBlockHeader: s.updateBlockHeader,
    })),
  );

  // 重构 store 视图供下游代码以 `store.X` 形式访问。
  // 由于 zustand 中方法引用是稳定的，本对象仅在数据切片变化时重建。
  const store = useMemo(
    () => ({
      tasks,
      groups,
      notes,
      milestones,
      updateTask,
      deleteTask,
      toggleTaskComplete,
      addTask,
      updateGroup,
      addGroup,
      deleteGroup,
      addNote,
      updateNote,
      deleteNote,
      addMilestone,
      updateMilestone,
      deleteMilestone,
      importData,
      exportData,
      updateBlockHeader,
    }),
    [
      tasks,
      groups,
      notes,
      milestones,
      updateTask,
      deleteTask,
      toggleTaskComplete,
      addTask,
      updateGroup,
      addGroup,
      deleteGroup,
      addNote,
      updateNote,
      deleteNote,
      addMilestone,
      updateMilestone,
      deleteMilestone,
      importData,
      exportData,
      updateBlockHeader,
    ],
  );

  // 对话框状态
  const [dialogType, setDialogType] = useState<DialogType>(null);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [editingTask, setEditingTask] = useState<Task | undefined>();
  const [editingGroup, setEditingGroup] = useState<TaskGroup | undefined>();
  const [editingNote, setEditingNote] = useState<Note | undefined>();
  const [editingMilestone, setEditingMilestone] = useState<Milestone | undefined>();

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    taskId: string;
    noteId?: string;
    milestoneId?: string;
  } | null>(null);

  // 任务详情抽屉状态：只存 id，task 对象从 store 派生（自动跟随远端更新 + 任务删除自动关闭）
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const drawerTask = useMemo(
    () => (drawerTaskId ? store.tasks.find((t) => t.id === drawerTaskId) ?? null : null),
    [drawerTaskId, store.tasks],
  );

  // 视图切换：timeline（甘特图） / ebb（艾宾浩斯复习） / daily-schedule（每日安排） / week-matrix（周矩阵）
  const [currentView, setCurrentView] = useState<AppModule>('timeline');

  // 年份显示
  const [displayYear, setDisplayYear] = useState(() => {
    if (store.tasks.length > 0) {
      const years = store.tasks.map((t) => splitDate(t.start).year);
      return Math.min(...years);
    }
    return dayjs().year();
  });

  // ── 任务操作 ──────────────────────────────────────────────

  // 抽屉：打开任务详情（单击入口，元信息折叠）
  const handleOpenDrawer = useCallback((task: Task) => {
    setDrawerTaskId(task.id);
  }, []);

  // 抽屉：打开任务详情并展开元信息（右键"编辑"入口）
  const handleOpenDrawerWithMeta = useCallback((task: Task) => {
    setDrawerTaskId(task.id);
  }, []);

  // 抽屉：关闭
  const handleCloseDrawer = useCallback(() => {
    setDrawerTaskId(null);
  }, []);

  // 抽屉：即时更新元信息（drawerTask 已从 store 派生，无需手动同步）
  const handleUpdateTaskMeta = useCallback((taskId: string, patch: Partial<Task>) => {
    const existing = store.tasks.find((t) => t.id === taskId);
    if (!existing) return;
    store.updateTask({ ...existing, ...patch });
  }, [store]);

  // 抽屉：删除任务
  const handleDeleteTaskFromDrawer = useCallback((taskId: string) => {
    store.deleteTask(taskId);
    setDrawerTaskId(null);
  }, [store]);

  const handleAddTask = useCallback(() => {
    setEditingTask(undefined);
    setDialogMode('add');
    setDialogType('task');
  }, []);

  const handleSaveTask = useCallback((task: Task) => {
    if (dialogMode === 'edit') {
      store.updateTask(task);
    } else {
      store.addTask(task);
    }
    setDialogType(null);
    setEditingTask(undefined);
  }, [dialogMode, store]);

  const handleDeleteTask = useCallback((taskId: string) => {
    store.deleteTask(taskId);
    setDialogType(null);
    setEditingTask(undefined);
  }, [store]);

  // ── 分组操作 ──────────────────────────────────────────────

  const handleAddGroup = useCallback(() => {
    setEditingGroup(undefined);
    setDialogMode('add');
    setDialogType('group');
  }, []);

  const handleEditGroup = useCallback((group: TaskGroup) => {
    setEditingGroup(group);
    setDialogMode('edit');
    setDialogType('group');
  }, []);

  const handleSaveGroup = useCallback((group: TaskGroup) => {
    if (dialogMode === 'edit') {
      store.updateGroup(group);
    } else {
      store.addGroup(group);
    }
    setDialogType(null);
    setEditingGroup(undefined);
  }, [dialogMode, store]);

  const handleDeleteGroup = useCallback((groupId: string) => {
    store.deleteGroup(groupId);
    setDialogType(null);
    setEditingGroup(undefined);
  }, [store]);

  // ── 便签操作 ──────────────────────────────────────────────

  const handleAddNote = useCallback(() => {
    setEditingNote(undefined);
    setDialogMode('add');
    setDialogType('note');
  }, []);

  const handleEditNote = useCallback((note: Note) => {
    setEditingNote(note);
    setDialogMode('edit');
    setDialogType('note');
  }, []);

  const handleSaveNote = useCallback((note: Note) => {
    if (dialogMode === 'edit') {
      store.updateNote(note);
    } else {
      store.addNote(note);
    }
    setDialogType(null);
    setEditingNote(undefined);
  }, [dialogMode, store]);

  const handleDeleteNote = useCallback((noteId: string) => {
    store.deleteNote(noteId);
    setDialogType(null);
    setEditingNote(undefined);
  }, [store]);

  // ── 里程碑操作 ────────────────────────────────────────────

  const handleAddMilestone = useCallback(() => {
    setEditingMilestone(undefined);
    setDialogMode('add');
    setDialogType('milestone');
  }, []);

  const handleEditMilestone = useCallback((milestone: Milestone) => {
    setEditingMilestone(milestone);
    setDialogMode('edit');
    setDialogType('milestone');
  }, []);

  const handleSaveMilestone = useCallback((milestone: Milestone) => {
    if (dialogMode === 'edit') {
      store.updateMilestone(milestone);
    } else {
      store.addMilestone(milestone);
    }
    setDialogType(null);
    setEditingMilestone(undefined);
  }, [dialogMode, store]);

  const handleDeleteMilestone = useCallback((milestoneId: string) => {
    store.deleteMilestone(milestoneId);
    setDialogType(null);
    setEditingMilestone(undefined);
  }, [store]);

  // ── 右键菜单 ──────────────────────────────────────────────

  const handleTaskContextMenu = useCallback((e: React.MouseEvent, taskId: string) => {
    setContextMenu({ x: e.clientX, y: e.clientY, taskId });
  }, []);

  const handleNoteContextMenu = useCallback((e: React.MouseEvent, noteId: string) => {
    setContextMenu({ x: e.clientX, y: e.clientY, taskId: '', noteId });
  }, []);

  const handleMilestoneContextMenu = useCallback((e: React.MouseEvent, milestoneId: string) => {
    setContextMenu({ x: e.clientX, y: e.clientY, taskId: '', milestoneId });
  }, []);

  const contextMenuItems = useMemo((): ContextMenuItem[] => {
    if (!contextMenu) return [];

    // 任务右键菜单
    if (contextMenu.taskId) {
      const task = store.tasks.find((t) => t.id === contextMenu.taskId);
      if (!task) return [];
      return [
        { label: '📝 查看详情', action: () => handleOpenDrawer(task) },
        { label: '✏️ 编辑', action: () => handleOpenDrawerWithMeta(task) },
        { label: task.completed ? '标记未完成' : '标记完成', action: () => store.toggleTaskComplete(task.id) },
        { label: '', action: () => {}, divider: true },
        { label: '删除', action: () => store.deleteTask(task.id), danger: true },
      ];
    }

    // 便签右键菜单
    if (contextMenu.noteId) {
      const note = store.notes.find((n) => n.id === contextMenu.noteId);
      if (!note) return [];
      return [
        { label: '编辑', action: () => handleEditNote(note) },
        { label: '', action: () => {}, divider: true },
        { label: '删除', action: () => store.deleteNote(note.id), danger: true },
      ];
    }

    // 里程碑右键菜单
    if (contextMenu.milestoneId) {
      const ms = store.milestones.find((m) => m.id === contextMenu.milestoneId);
      if (!ms) return [];
      return [
        { label: '编辑', action: () => handleEditMilestone(ms) },
        { label: '', action: () => {}, divider: true },
        { label: '删除', action: () => store.deleteMilestone(ms.id), danger: true },
      ];
    }

    return [];
  }, [contextMenu, store, handleEditNote, handleEditMilestone, handleOpenDrawer, handleOpenDrawerWithMeta]);

  // ── 导入/导出 ──────────────────────────────────────────────

  const handleImport = useCallback((data: string) => {
    try {
      const parsed = JSON.parse(data);
      store.importData({
        tasks: parsed.tasks ?? [],
        groups: parsed.groups ?? [],
        notes: parsed.notes ?? [],
        milestones: parsed.milestones ?? [],
      });
    } catch {
      alert('导入失败：JSON 格式无效');
    }
  }, [store]);

  const handleExport = useCallback(() => {
    const jsonStr = store.exportData();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart-timeline-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [store]);

  // ── 关闭对话框 ──────────────────────────────────────────────

  const closeDialog = useCallback(() => {
    setDialogType(null);
    setEditingTask(undefined);
    setEditingGroup(undefined);
    setEditingNote(undefined);
    setEditingMilestone(undefined);
  }, []);

  const handleOpenSync = useCallback(() => {
    setDialogType('sync');
  }, []);

  return (
    <div className={`tl-app ${(currentView === 'ebb' || currentView === 'daily-schedule' || currentView === 'week-matrix' || currentView === 'knowledge-graph') ? 'tl-app--ebb' : ''}`}>
      <Sidebar current={currentView} onChange={setCurrentView} />
      {currentView !== 'ebb' && currentView !== 'daily-schedule' && currentView !== 'week-matrix' && currentView !== 'knowledge-graph' && (
        <Toolbar
          displayYear={displayYear}
          onYearChange={setDisplayYear}
          onAddTask={handleAddTask}
          onAddGroup={handleAddGroup}
          onAddNote={handleAddNote}
          onAddMilestone={handleAddMilestone}
          onImport={handleImport}
          onExport={handleExport}
          onOpenSync={handleOpenSync}
          taskCount={store.tasks.length}
        />
      )}

      {currentView === 'ebb' ? (
        <div className="tl-app-split tl-app-split--ebb">
          <div className="tl-app-main">
            <EbbView />
          </div>
        </div>
      ) : currentView === 'daily-schedule' ? (
        <div className="tl-app-split tl-app-split--ebb">
          <div className="tl-app-main">
            <DailyScheduleView />
          </div>
        </div>
      ) : currentView === 'week-matrix' ? (
        <div className="tl-app-split tl-app-split--ebb">
          <div className="tl-app-main">
            <WeekMatrixView
              tasks={store.tasks}
              onUpdateBlockHeader={store.updateBlockHeader}
            />
          </div>
        </div>
      ) : currentView === 'knowledge-graph' ? (
        <div className="tl-app-split tl-app-split--ebb">
          <div className="tl-app-main">
            <KnowledgeGraphView />
          </div>
        </div>
      ) : (
        <>
          {/* 左右分屏容器：左侧内容视图 + 右侧任务详情面板 */}
          <div className="tl-app-split">
            <div className="tl-app-main">
              <TimelineView
                tasks={store.tasks}
                groups={store.groups}
                notes={store.notes}
                milestones={store.milestones}
                displayYear={displayYear}
                onTaskClick={handleOpenDrawer}
                onTaskContextMenu={handleTaskContextMenu}
                onNoteDoubleClick={handleEditNote}
                onNoteContextMenu={handleNoteContextMenu}
                onMilestoneDoubleClick={handleEditMilestone}
                onMilestoneContextMenu={handleMilestoneContextMenu}
                onGroupDoubleClick={handleEditGroup}
              />
            </div>

            {/* 项目文档视图面板（仅 open 时渲染，挤压左侧甘特图） */}
            {drawerTask && (
              <ProjectDocumentView
                task={drawerTask}
                onClose={handleCloseDrawer}
                onUpdateTask={handleUpdateTaskMeta}
                onDeleteTask={handleDeleteTaskFromDrawer}
              />
            )}
          </div>
        </>
      )}

      {/* 对话框 */}
      {dialogType === 'task' && (
        <TaskDialog
          task={dialogMode === 'edit' ? editingTask : undefined}
          onSave={handleSaveTask}
          onDelete={dialogMode === 'edit' ? handleDeleteTask : undefined}
          onCancel={closeDialog}
        />
      )}
      {dialogType === 'group' && (
        <GroupDialog
          group={dialogMode === 'edit' ? editingGroup : undefined}
          allTasks={store.tasks}
          groups={store.groups}
          onSave={handleSaveGroup}
          onDelete={dialogMode === 'edit' ? handleDeleteGroup : undefined}
          onCancel={closeDialog}
        />
      )}
      {dialogType === 'note' && (
        <NoteDialog
          note={dialogMode === 'edit' ? editingNote : undefined}
          onSave={handleSaveNote}
          onDelete={dialogMode === 'edit' ? handleDeleteNote : undefined}
          onCancel={closeDialog}
        />
      )}
      {dialogType === 'milestone' && (
        <MilestoneDialog
          milestone={dialogMode === 'edit' ? editingMilestone : undefined}
          onSave={handleSaveMilestone}
          onDelete={dialogMode === 'edit' ? handleDeleteMilestone : undefined}
          onCancel={closeDialog}
        />
      )}
      {dialogType === 'sync' && (
        <SyncDialog onClose={closeDialog} />
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

export default App;
