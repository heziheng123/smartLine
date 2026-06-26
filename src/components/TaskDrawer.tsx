// ============================================================
// Smart Timeline - 任务详情面板（内联分屏，非悬浮抽屉）
// 与左侧甘特图并排显示，挤占布局而非遮罩
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import type { Task } from '@/types';
import MarkdownEditor, { type EditorMode } from './MarkdownEditor';
import TaskMetaEditor from './TaskMetaEditor';
import {
  generateTaskMarkdown,
  computeTodoProgress,
  formatTimestamp,
} from '@/utils/markdown';

interface TaskDrawerProps {
  /** 当前关联的任务；为 null 时面板不渲染 */
  task: Task | null;
  /** 受控开关（与 task 同时满足才显示） */
  open: boolean;
  onClose: () => void;
  /** 保存 Markdown 到 store */
  onSave: (taskId: string, markdown: string) => void;
  /** 即时更新任务元信息（名称/日期/颜色等） */
  onUpdateTask?: (taskId: string, patch: Partial<Task>) => void;
  /** 删除任务 */
  onDeleteTask?: (taskId: string) => void;
  /** 初始是否展开元信息折叠区（右键"编辑"入口时可设为 true） */
  initialMetaExpanded?: boolean;
}

const MODE_STORAGE_KEY = 'smart-timeline-md-mode';

function loadMode(): EditorMode {
  try {
    const m = localStorage.getItem(MODE_STORAGE_KEY);
    if (m === 'edit' || m === 'preview' || m === 'split') return m;
  } catch { /* ignore */ }
  // 默认 preview（用户指定）
  return 'preview';
}

const TaskDrawer: React.FC<TaskDrawerProps> = ({
  task,
  open,
  onClose,
  onSave,
  onUpdateTask,
  onDeleteTask,
  initialMetaExpanded = false,
}) => {
  const [content, setContent] = useState<string>('');
  const [savedContent, setSavedContent] = useState<string>('');
  const [mode, setMode] = useState<EditorMode>(loadMode);
  const [saveHint, setSaveHint] = useState<string>('');
  // 元信息折叠区展开状态
  const [metaExpanded, setMetaExpanded] = useState<boolean>(initialMetaExpanded);
  // 用于在 task 切换时重置内部状态
  const taskIdRef = useRef<string | null>(null);
  // 记录上次从 store 同步的 markdown（用于检测远端更新）
  const lastSyncedMarkdownRef = useRef<string>('');
  const dirty = content !== savedContent;

  // ── 任务切换 + 远端 markdown 同步 ──────────────────────────
  useEffect(() => {
    if (!task) return;
    // 情况 A：切换到新任务 → 初始化
    if (taskIdRef.current !== task.id) {
      taskIdRef.current = task.id;
      const initial = task.markdown && task.markdown.trim()
        ? task.markdown
        : generateTaskMarkdown(task);
      setContent(initial);
      setSavedContent(task.markdown ?? '');
      lastSyncedMarkdownRef.current = task.markdown ?? '';
      setSaveHint('');
      setMetaExpanded(initialMetaExpanded);

      // 首次打开且无 markdown：注入默认模板并立即保存
      if (!task.markdown || !task.markdown.trim()) {
        onSave(task.id, initial);
        setSavedContent(initial);
        lastSyncedMarkdownRef.current = initial;
        setSaveHint('已生成默认模板');
      }
      return;
    }
    // 情况 B：同一任务，远端 markdown 更新，且本地无未保存修改 → 同步
    if (!dirty && task.markdown !== lastSyncedMarkdownRef.current) {
      setContent(task.markdown ?? '');
      setSavedContent(task.markdown ?? '');
      lastSyncedMarkdownRef.current = task.markdown ?? '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, dirty, initialMetaExpanded]);

  // ── ESC 关闭（有未保存改动时二次确认）─────────────────────
  // 注意：textarea/input 的 Esc 由其自身的 onKeyDown 处理（退出编辑），
  // 这里通过 target.tagName 判断跳过，避免双重触发关闭整个抽屉
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement;
      // 焦点在表单元素上时，让表单自己处理 Esc（textarea 退出编辑）
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
      if (dirty && !confirm('有未保存的修改，确定关闭？')) return;
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, dirty, onClose]);

  // ── 模式持久化 ──────────────────────────────────────────
  const handleModeChange = useCallback((m: EditorMode) => {
    setMode(m);
    try { localStorage.setItem(MODE_STORAGE_KEY, m); } catch { /* ignore */ }
  }, []);

  // ── 保存（含乐观锁：检测远端是否已更新） ─────────────────
  const handleSave = useCallback(() => {
    if (!task) return;
    if (!dirty) return;
    // 乐观锁：store 中 markdown 与上次同步值不一致，说明远端有更新
    if (task.markdown !== lastSyncedMarkdownRef.current) {
      if (!confirm('该任务内容已被其他设备修改，是否用你的版本覆盖？')) return;
    }
    onSave(task.id, content);
    setSavedContent(content);
    lastSyncedMarkdownRef.current = content;
    setSaveHint(`已保存 · ${dayjs().format('HH:mm')}`);
    // 3 秒后清空提示
    window.setTimeout(() => setSaveHint(''), 3000);
  }, [task, content, dirty, onSave]);

  // ── 关闭前检查 ──────────────────────────────────────────
  const handleClose = useCallback(() => {
    if (dirty && !confirm('有未保存的修改，确定关闭？')) return;
    onClose();
  }, [dirty, onClose]);

  // ── 元信息即时更新 ──────────────────────────────────────
  const handleUpdateTask = useCallback(
    (patch: Partial<Task>) => {
      if (!task || !onUpdateTask) return;
      onUpdateTask(task.id, patch);
    },
    [task, onUpdateTask],
  );

  // ── 元信息折叠切换 ──────────────────────────────────────
  const toggleMeta = useCallback(() => {
    setMetaExpanded((v) => !v);
  }, []);

  // ── 时间跨度与统计 ────────────────────────────────────────
  const meta = useMemo(() => {
    if (!task) return null;
    const s = dayjs(task.start);
    const e = dayjs(task.end);
    const days = s.isValid() && e.isValid() ? e.diff(s, 'day') + 1 : 0;
    const progress = computeTodoProgress(content);
    return {
      days,
      startLabel: task.start,
      endLabel: task.end,
      isMain: !!task.isMain,
      completed: !!task.completed,
      updatedAt: formatTimestamp(task.markdownUpdatedAt),
      progress,
    };
  }, [task, content]);

  if (!open || !task || !meta) {
    return null;
  }

  return (
    <aside
      className="tl-drawer"
      role="complementary"
      aria-label={`任务详情：${task.name}`}
    >
      {/* 关闭按钮 */}
      <button
        type="button"
        className="tl-drawer-close"
        onClick={handleClose}
        aria-label="关闭"
        title="关闭 (Esc)"
      >
        ×
      </button>

      {/* 顶部：任务标题与元信息（降噪设计） */}
      <header className="tl-drawer-header">
        {/* 标题：点击切换元信息编辑（取代笨重的"编辑元信息"按钮） */}
        <h2
          className="tl-drawer-title"
          onClick={toggleMeta}
          title={metaExpanded ? '收起元信息编辑' : '点击编辑任务元信息（时间、颜色等）'}
        >
          {task.name}
          <span className={`tl-drawer-title-caret ${metaExpanded ? 'tl-drawer-title-caret--open' : ''}`}>▾</span>
        </h2>

        {/* 元信息行：日期 + 现代化 Tag */}
        <div className="tl-drawer-meta">
          <span className="tl-drawer-meta-item">
            📅 {meta.startLabel} ~ {meta.endLabel}
          </span>
          <span className="tl-drawer-meta-item">⏱ {meta.days} 天</span>
          <span className={`tl-chip ${meta.isMain ? 'tl-chip--indigo' : 'tl-chip--gray'}`}>
            {meta.isMain ? '主线' : '普通'}
          </span>
          <span className={`tl-chip ${meta.completed ? 'tl-chip--green' : 'tl-chip--amber'}`}>
            {meta.completed ? '已完成' : '进行中'}
          </span>
        </div>

        {/* 待办进度条 */}
        {meta.progress.total > 0 && (
          <div className="tl-drawer-progress">
            <div className="tl-drawer-progress-bar">
              <div
                className="tl-drawer-progress-fill"
                style={{ width: `${Math.round(meta.progress.ratio * 100)}%` }}
              />
            </div>
            <span className="tl-drawer-progress-text">
              {meta.progress.done}/{meta.progress.total}
            </span>
          </div>
        )}
      </header>

      {/* 元信息折叠编辑区 */}
      {metaExpanded && (
        <div className="tl-drawer-meta-panel">
          <TaskMetaEditor
            task={task}
            onUpdate={handleUpdateTask}
            onDelete={onDeleteTask}
          />
        </div>
      )}

      {/* 主体：Markdown 编辑器（无缝阅读/编辑） */}
      <div className="tl-drawer-body">
        <MarkdownEditor
          value={content}
          onChange={setContent}
          mode={mode}
          onModeChange={handleModeChange}
          onSave={handleSave}
          dirty={dirty}
          saveHint={saveHint}
        />
      </div>

      {/* 右下角极淡"上次编辑"时间（不抢视觉焦点） */}
      {meta.updatedAt && (
        <div className="tl-drawer-updated-footer">上次编辑 {meta.updatedAt}</div>
      )}
    </aside>
  );
};

export default TaskDrawer;
