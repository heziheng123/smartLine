// ============================================================
// 时间块模式视图 - 类日历画布 + 右侧任务池
// 使用纯 HTML5 Drag & Drop 实现从任务池拖入画布
// ============================================================

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { todayStr } from '@/utils/dateSafe';
import { CircleDashed, Link as LinkIcon } from 'lucide-react';
import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import { getValidGraphNodeIds } from '@/utils/blocks';
import { useGraphStore } from '@/graph/store';
import { useShallow } from 'zustand/react/shallow';
import { getReviewTopicKey, isOverdue, computeRounds } from '@/ebb/scheduler';
import { useSmartTaskTodos } from '@/hooks/useSmartTaskTodos';
import { useDailyScheduleStore, EMPTY_DAY_SCHEDULE } from './store';
import { getProjectBlockSourceId, getReviewSourceId } from './sourceIds';
import { useTaskCompletionStatus } from './useTaskCompletionStatus';
import { openProjectTaskModal } from '@/components/smartBlock/projectTaskModal';
import TimeGrid from './TimeGrid';
import type { TimeBlock, TaskSource } from './types';
import { resolveTaskCategoryTheme } from '@/utils/taskCategoryTheme';
import {
  projectBadgeStyle,
  resolveProjectAppearance,
} from './projectAppearance';
import {
  timeToMinutes,
  minutesToTime,
  snapToQuarter,
  yToMinutes,
  checkCollision,
  parseSourceId,
  GRID_CONFIG,
} from './conversion';

// ── 快速创建输入框 ──────────────────────────────────────────

const QuickCreateInput: React.FC<{
  initialTime: string;
  onCreate: (name: string, startTime: string) => void;
  onCancel: () => void;
}> = ({ initialTime, onCreate, onCancel }) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isSubmitting = useRef(false);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (isSubmitting.current) return;
    isSubmitting.current = true;
    const trimmed = name.trim();
    if (trimmed) onCreate(trimmed, initialTime);
    else onCancel();
  };

  return (
    <div className="tb-quick-create" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="tb-quick-create-input"
        value={name}
        placeholder={`在 ${initialTime} 添加...`}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') {
            isSubmitting.current = true;
            onCancel();
          }
        }}
        onBlur={handleSubmit}
      />
    </div>
  );
};

// ── 内联编辑浮层 ────────────────────────────────────────────

const BlockEditor: React.FC<{
  block: TimeBlock;
  rect: DOMRect;
  onSave: (blockId: string, patch: Partial<TimeBlock>) => void;
  onDelete: (blockId: string) => void;
  onClose: () => void;
}> = ({ block, rect, onSave, onDelete, onClose }) => {
  const [startTime, setStartTime] = useState(block.startTime);
  const [endTime, setEndTime] = useState(block.endTime);

  return (
    <div
      className="tb-editor-overlay"
      onClick={onClose}
    >
      <div
        className="tb-editor"
        style={{
          top: Math.min(rect.bottom + 4, window.innerHeight - 180),
          left: Math.min(rect.left, window.innerWidth - 240),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tb-editor-name">{block.name}</div>
        <div className="tb-editor-times">
          <label>
            开始
            <input
              type="time"
              className="tb-editor-input"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </label>
          <label>
            结束
            <input
              type="time"
              className="tb-editor-input"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </label>
        </div>
        <div className="tb-editor-actions">
          <button
            type="button"
            className="tb-editor-save"
            onClick={() => onSave(block.id, { startTime, endTime })}
          >
            保存
          </button>
          <button
            type="button"
            className="tb-editor-delete"
            onClick={() => onDelete(block.id)}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
};

// ── 任务池项类型 ────────────────────────────────────────────

interface PoolItem {
  id: string;
  name: string;
  source: TaskSource;
  color?: string;
  categoryColor?: string;
  detail?: string;
  duration?: number;
  sourceId: string;
}

// ── Props ───────────────────────────────────────────────────

interface BlockModeViewProps {
  selectedDate: string;
  /** 已安排的 sourceId 集合（来自 items + blocks，由父组件计算） */
  scheduledSourceIds: Set<string>;
  onReviewToggleError: (error: string | null) => void;
}

// ── 主组件 ──────────────────────────────────────────────────

const BlockModeView: React.FC<BlockModeViewProps> = ({
  selectedDate,
  scheduledSourceIds,
  onReviewToggleError,
}) => {
  const today = todayStr();
  const [showCompletedPool, setShowCompletedPool] = useState(false);
  const { tasks: rawTlTasks, groups: rawTlGroups, updateBlockHeader: tlUpdateBlockHeader } = useTimelineStore(
    useShallow((s) => ({ tasks: s.tasks, groups: s.groups, updateBlockHeader: s.updateBlockHeader })),
  );
  const {
    reviewTasks: rawEbbReviewTasks,
    ebbSettings: ebbSettingsData,
    toggleReviewTask: ebbToggleReviewTask,
  } = useEbbStore(
    useShallow((s) => ({
      reviewTasks: s.reviewTasks,
      ebbSettings: s.ebbSettings,
      toggleReviewTask: s.toggleReviewTask,
    })),
  );

  const { nodes: graphNodes } = useGraphStore();

  const archivedNodeIds = useMemo(() => new Set(graphNodes.filter(n => n.isArchived).map(n => n.id)), [graphNodes]);

  const ebbReviewTasks = useMemo(() => {
    return rawEbbReviewTasks.filter(t => {
      if (t.isArchived) return false;
      return !t.graphNodeId || !archivedNodeIds.has(t.graphNodeId);
    });
  }, [rawEbbReviewTasks, archivedNodeIds]);

  const tlTasks = useMemo(() => {
    const taskMap = new Map(rawTlTasks.map((task) => [task.id, task]));
    for (const group of rawTlGroups) {
      for (const child of group.children) {
        if (!taskMap.has(child.id)) taskMap.set(child.id, child);
      }
    }
    return [...taskMap.values()].map(task => ({
      ...task,
      blocks: task.blocks?.filter(b => {
        if (b.type === 'smart-task') {
          if (b.header.isArchived) return false;
          const ids = getValidGraphNodeIds(b.header);
          return !ids.some(id => archivedNodeIds.has(id));
        }
        return true;
      }) ?? []
    }));
  }, [rawTlTasks, rawTlGroups, archivedNodeIds]);

  const {
    addTimeBlock,
    resizeTimeBlock,
    removeTimeBlock,
    updateTimeBlock,
  } = useDailyScheduleStore(
    useShallow((s) => ({
      addTimeBlock: s.addTimeBlock,
      resizeTimeBlock: s.resizeTimeBlock,
      removeTimeBlock: s.removeTimeBlock,
      updateTimeBlock: s.updateTimeBlock,
    })),
  );

  const scheduleForDate = useDailyScheduleStore((s) => s.schedules[selectedDate]);
  const daySchedule = scheduleForDate ?? EMPTY_DAY_SCHEDULE;
  
  const { checkIsCompleted } = useTaskCompletionStatus();
  const blocks = useMemo(() => {
    const rawBlocks = daySchedule.blocks ?? [];
    return rawBlocks.map((b) => {
      const appearance = resolveProjectAppearance(b.sourceId, tlTasks, rawTlGroups);
      const parsed = parseSourceId(b.sourceId);
      const reviewTask = parsed?.source === 'review'
        ? ebbReviewTasks.find((task) => task.id === parsed.reviewId)
        : undefined;
      const reviewCategoryColor = reviewTask
        ? ebbSettingsData.tagColors[reviewTask.tag ?? '']
        : undefined;
      return {
        ...b,
        completed: checkIsCompleted(b.source, b.sourceId),
        detail: appearance?.name ?? b.detail,
        color: appearance?.theme.backgroundColor ?? b.color,
        categoryColor: appearance?.categoryColor ?? reviewCategoryColor ?? b.categoryColor,
      };
    });
  }, [daySchedule.blocks, checkIsCompleted, tlTasks, rawTlGroups, ebbReviewTasks, ebbSettingsData]);

  // ── 判断是否未绑定节点 ──────────────────────────────────
  const checkIsUnlinkedTask = useCallback((sourceId: string) => {
    const parsed = parseSourceId(sourceId);
    if (!parsed) return false;
    
    if (parsed.source === 'review') {
      const reviewTask = ebbReviewTasks.find((t) => t.id === parsed.reviewId);
      return reviewTask ? !reviewTask.graphNodeId : false;
    }

    if (parsed.source === 'project') {
      const parentTask = tlTasks.find((t) => t.id === parsed.parentTaskId);
      if (!parentTask || !parentTask.blocks) return false;
      
      if (parsed.blockId) {
        const block = parentTask.blocks.find(b => b.id === parsed.blockId);
        if (block?.type === 'smart-task') {
          const ids = getValidGraphNodeIds(block.header);
          return ids.length === 0; // 如果没有 graphNodeIds，说明未绑定
        }
      }
    }
    return false;
  }, [tlTasks, ebbReviewTasks]);

  // ── 判断是否已绑定节点 ──────────────────────────────────
  const checkIsLinkedTask = useCallback((sourceId: string) => {
    const parsed = parseSourceId(sourceId);
    if (!parsed) return false;
    
    if (parsed.source === 'review') {
      const reviewTask = ebbReviewTasks.find((t) => t.id === parsed.reviewId);
      return reviewTask ? !!reviewTask.graphNodeId : false;
    }

    if (parsed.source === 'project') {
      const parentTask = tlTasks.find((t) => t.id === parsed.parentTaskId);
      if (!parentTask || !parentTask.blocks) return false;
      
      if (parsed.blockId) {
        const block = parentTask.blocks.find(b => b.id === parsed.blockId);
        if (block?.type === 'smart-task') {
          const ids = getValidGraphNodeIds(block.header);
          return ids.length > 0; // 如果有 graphNodeIds，说明已绑定
        }
      }
    }
    return false;
  }, [tlTasks, ebbReviewTasks]);

  // ── 快速创建状态 ───────────────────────────────────────
  const [quickCreateTime, setQuickCreateTime] = useState<string | null>(null);
  const suppressPoolOpenRef = useRef(false);

  // ── 编辑浮层状态 ───────────────────────────────────────
  const [editingBlock, setEditingBlock] = useState<{ block: TimeBlock; rect: DOMRect } | null>(null);

  // ── 冲突 ID 列表 ───────────────────────────────────────
  const conflictIds = useMemo(() => {
    const ids: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i];
        const b = blocks[j];
        if (
          timeToMinutes(a.startTime) < timeToMinutes(b.endTime) &&
          timeToMinutes(a.endTime) > timeToMinutes(b.startTime)
        ) {
          ids.push(a.id, b.id);
        }
      }
    }
    return [...new Set(ids)];
  }, [blocks]);

  // ── 项目任务来源：SmartTaskBlock（与时段模式一致） ──────────
  const allTodos = useSmartTaskTodos(tlTasks, rawTlGroups);

  const todayProjectTasks = useMemo(() => {
    return allTodos.filter((todo) => {
      if (todo.checked) return false;
      // 只有精确指定了排期日或截止日为当天的任务才会被纳入任务池
      if (todo.scheduled && todo.scheduled === selectedDate) return true;
      if (todo.due && todo.due === selectedDate) return true;
      return false;
    });
  }, [allTodos, selectedDate]);

  const completedProjectTasks = useMemo(() => {
    return allTodos.filter((todo) => {
      if (!todo.checked) return false;
      return todo.scheduled === selectedDate || todo.due === selectedDate;
    });
  }, [allTodos, selectedDate]);

  const todayReviewTasks = useMemo(() => {
    return ebbReviewTasks.filter((t) => {
      if (t.isCompleted) return false;
      return t.dueDate === selectedDate || (isOverdue(t) && selectedDate === today);
    });
  }, [ebbReviewTasks, selectedDate, today]);

  const completedReviewTasks = useMemo(
    () => ebbReviewTasks.filter((task) => task.isCompleted && task.dueDate === selectedDate),
    [ebbReviewTasks, selectedDate],
  );

  // ── 任务池列表（sourceId 格式与 DailyScheduleView 完全一致） ──
  const poolItems = useMemo(() => {
    const items: PoolItem[] = [];

    for (const todo of todayProjectTasks) {
      // sourceId 格式必须与 DailyScheduleView 保持一致，否则两模式间已安排状态不互通
      const sourceId = todo._blockId
        ? getProjectBlockSourceId(todo.parentTaskId, todo._blockId)
        : `project-md:${todo.id}`;
      if (scheduledSourceIds.has(sourceId)) continue;
      items.push({
        id: `pool-project-${todo.id}`,
        name: todo.text,
        source: 'project',
        color: todo.parentTaskColor,
        categoryColor: todo._tagColor,
        detail: todo.parentTaskTitle,
        sourceId,
        duration: todo._duration,
      });
    }

    const { roundMap, totalRoundsMap } = computeRounds(ebbReviewTasks);
    for (const task of todayReviewTasks) {
      if (scheduledSourceIds.has(getReviewSourceId(task.id))) continue;
      const round = roundMap.get(task.id) ?? 1;
      const total = totalRoundsMap.get(getReviewTopicKey(task)) ?? 1;
      items.push({
        id: `pool-review-${task.id}`,
        name: task.topicName,
        source: 'review',
        color: ebbSettingsData.tagColors[task.tag ?? ''] ?? '#8B9DC3',
        categoryColor: ebbSettingsData.tagColors[task.tag ?? ''],
        detail: `第${round}/${total}轮`,
        sourceId: getReviewSourceId(task.id),
        duration: 30,
      });
    }

    return items;
  }, [todayProjectTasks, todayReviewTasks, scheduledSourceIds, ebbReviewTasks, ebbSettingsData]);

  const completedPoolItems = useMemo(() => {
    const items: PoolItem[] = [];
    for (const todo of completedProjectTasks) {
      if (!todo._blockId) continue;
      const sourceId = getProjectBlockSourceId(todo.parentTaskId, todo._blockId);
      if (scheduledSourceIds.has(sourceId)) continue;
      items.push({
        id: `completed-project-${todo.id}`,
        name: todo.text,
        source: 'project',
        sourceId,
        detail: todo.parentTaskTitle,
        color: todo.parentTaskColor,
        categoryColor: todo._tagColor,
      });
    }
    for (const task of completedReviewTasks) {
      const sourceId = getReviewSourceId(task.id);
      if (scheduledSourceIds.has(sourceId)) continue;
      items.push({
        id: `completed-review-${task.id}`,
        name: task.topicName,
        source: 'review',
        sourceId,
        categoryColor: ebbSettingsData.tagColors[task.tag ?? ''],
      });
    }
    return items;
  }, [completedProjectTasks, completedReviewTasks, scheduledSourceIds, ebbSettingsData]);

  // ── 拖拽状态（纯 HTML5 DnD） ──────────────────────────
  const [draggedPoolItemId, setDraggedPoolItemId] = useState<string | null>(null);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [ghostBlock, setGhostBlock] = useState<{
    startTime: string;
    endTime: string;
    name: string;
    color?: string;
    categoryColor?: string;
  } | null>(null);

  // ── 任务池项拖拽开始 ──────────────────────────────────
  const handlePoolDragStart = useCallback(
    (e: React.DragEvent, poolItemId: string) => {
      const poolItem = poolItems.find((i) => i.id === poolItemId);
      if (!poolItem) return;

      e.dataTransfer.setData('application/x-pool-item', poolItemId);
      e.dataTransfer.effectAllowed = 'copy';
      suppressPoolOpenRef.current = true;
      setDraggedPoolItemId(poolItemId);
    },
    [poolItems],
  );

  // ── 从任务池拖入画布的放置处理 ─────────────────────────
  const handlePoolItemDrop = useCallback(
    (poolItemId: string, targetMinutes: number) => {
      const poolItem = poolItems.find((i) => i.id === poolItemId);
      if (!poolItem) return;

      const duration = Math.max(15, poolItem.duration ?? 30);
      const latestStart = 23 * 60 + 45 - duration;
      const earliestStart = GRID_CONFIG.startHour * 60;
      if (latestStart < earliestStart) return;
      const startMin = Math.max(earliestStart, Math.min(snapToQuarter(targetMinutes), latestStart));
      const endMin = startMin + duration;

      const startTime = minutesToTime(startMin);
      const endTime = minutesToTime(endMin);

      // 碰撞检测
      const collision = checkCollision(null, startTime, endTime, blocks);
      if (collision.overlap) return;

      addTimeBlock(selectedDate, {
        sourceId: poolItem.sourceId,
        name: poolItem.name,
        source: poolItem.source,
        startTime,
        endTime,
        completed: false,
        color: poolItem.color,
        categoryColor: poolItem.categoryColor,
        detail: poolItem.detail,
      });
    },
    [poolItems, blocks, addTimeBlock, selectedDate],
  );

  // ── 时间块操作 ─────────────────────────────────────────
  const handleResize = useCallback(
    (blockId: string, startTime: string, endTime: string) => {
      resizeTimeBlock(selectedDate, blockId, startTime, endTime);
    },
    [resizeTimeBlock, selectedDate],
  );

  const handleToggle = useCallback(
    (blockId: string) => {
      const block = blocks.find((b) => b.id === blockId);
      if (!block) return;

      if (block.source === 'review') {
        const reviewId = block.sourceId.replace('review-', '');
        onReviewToggleError(ebbToggleReviewTask(reviewId));
      } else if (block.source === 'project') {
        const parsed = parseSourceId(block.sourceId);
        if (!parsed || parsed.source !== 'project') return;
        const parentTask = tlTasks.find((t) => t.id === parsed.parentTaskId);
        if (!parentTask) return;

        if (parsed.blockId) {
          const currentBlock = (parentTask.blocks ?? []).find(b => b.id === parsed.blockId);
          const isCurrentlyDone = currentBlock?.type === 'smart-task' && currentBlock.header.isCompleted;
          const now = todayStr();
          // 更新源 store 的 block header，无需手动 toggleTimeBlock
          tlUpdateBlockHeader(parsed.parentTaskId, parsed.blockId, {
            isCompleted: !isCurrentlyDone,
            completedDate: !isCurrentlyDone ? now : undefined,
          });
        }
      }
    },
    [blocks, ebbToggleReviewTask, onReviewToggleError, tlTasks, tlUpdateBlockHeader],
  );

  const handleUndoCompletedPoolItem = useCallback((item: PoolItem) => {
    if (item.source === 'review') {
      const parsed = parseSourceId(item.sourceId);
      if (parsed?.source === 'review') onReviewToggleError(ebbToggleReviewTask(parsed.reviewId));
      return;
    }
    if (item.source !== 'project') return;
    const parsed = parseSourceId(item.sourceId);
    if (!parsed || parsed.source !== 'project' || !parsed.blockId) return;
    const parentTask = tlTasks.find((task) => task.id === parsed.parentTaskId);
    const currentBlock = parentTask?.blocks.find((block) => block.id === parsed.blockId);
    if (currentBlock?.type !== 'smart-task' || !currentBlock.header.isCompleted) return;
    tlUpdateBlockHeader(parsed.parentTaskId, parsed.blockId, {
      isCompleted: false,
      completedDate: undefined,
    });
  }, [ebbToggleReviewTask, onReviewToggleError, tlTasks, tlUpdateBlockHeader]);

  const handleRemove = useCallback(
    (blockId: string) => {
      removeTimeBlock(selectedDate, blockId);
    },
    [removeTimeBlock, selectedDate],
  );

  const handleBlockClick = useCallback(
    (block: TimeBlock, rect: DOMRect) => {
      if (block.source === 'project') {
        const parsed = parseSourceId(block.sourceId);
        if (parsed?.source === 'project' && parsed.blockId) {
          openProjectTaskModal(parsed.parentTaskId, parsed.blockId);
          return;
        }
      }
      setEditingBlock({ block, rect });
    },
    [],
  );

  const handleProjectPoolClick = useCallback((sourceId: string) => {
    const parsed = parseSourceId(sourceId);
    if (parsed?.source === 'project' && parsed.blockId) {
      openProjectTaskModal(parsed.parentTaskId, parsed.blockId);
    }
  }, []);

  // ── 时间块开始被拖拽（准备拖回任务池） ────────────────
  const handleBlockDragStart = useCallback(
    (blockId: string) => {
      setDraggingBlockId(blockId);
    },
    [],
  );

  const handleEditorSave = useCallback(
    (blockId: string, patch: Partial<TimeBlock>) => {
      updateTimeBlock(selectedDate, blockId, patch);
      setEditingBlock(null);
    },
    [updateTimeBlock, selectedDate],
  );

  const handleEditorDelete = useCallback(
    (blockId: string) => {
      removeTimeBlock(selectedDate, blockId);
      setEditingBlock(null);
    },
    [removeTimeBlock, selectedDate],
  );

  // ── 点击空白区域 → 快速创建 ─────────────────────────────
  const handleBlankClick = useCallback((startTime: string) => {
    setQuickCreateTime(startTime);
  }, []);

  const handleQuickCreate = useCallback(
    (name: string, startTime: string) => {
      const startMin = Math.min(timeToMinutes(startTime), 23 * 60 + 15);
      const endMin = startMin + 30; // 默认 30 分钟
      const endTime = minutesToTime(endMin);

      addTimeBlock(selectedDate, {
        sourceId: `free-${Date.now().toString(36)}`,
        name,
        source: 'free',
        startTime: minutesToTime(startMin),
        endTime,
        completed: false,
      });
      setQuickCreateTime(null);
    },
    [addTimeBlock, selectedDate],
  );

  // ── 画布区域接收拖放的 ref ─────────────────────────────
  const canvasRef = useRef<HTMLDivElement>(null);

  // ── 画布区域的拖放处理 ──────────────────────────────────
  const handleCanvasDragOver = useCallback(
    (e: React.DragEvent) => {
      // 仅接受从任务池拖入的项，不干预时间块拖回任务池
      if (!e.dataTransfer.types.includes('application/x-pool-item')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';

      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top + canvasRef.current.scrollTop;
      const min = yToMinutes(y);
      const startMin = snapToQuarter(min);

      // 实时构建 ghost 预览块
      if (draggedPoolItemId) {
        const poolItem = poolItems.find((i) => i.id === draggedPoolItemId);
        if (poolItem) {
          const duration = Math.max(15, poolItem.duration ?? 30);
          const previewStartMin = Math.min(startMin, 23 * 60 + 45 - duration);
          if (previewStartMin < GRID_CONFIG.startHour * 60) {
            setGhostBlock(null);
            return;
          }
          setGhostBlock({
            startTime: minutesToTime(previewStartMin),
            endTime: minutesToTime(previewStartMin + duration),
            name: poolItem.name,
            color: poolItem.color,
            categoryColor: poolItem.categoryColor,
          });
        }
      }
    },
    [draggedPoolItemId, poolItems],
  );

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const poolItemId = e.dataTransfer.getData('application/x-pool-item');
      if (!poolItemId || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top + canvasRef.current.scrollTop;
      const targetMin = yToMinutes(y);

      handlePoolItemDrop(poolItemId, targetMin);
      setDraggedPoolItemId(null);
      setGhostBlock(null);
    },
    [handlePoolItemDrop],
  );

  const handleCanvasDragLeave = useCallback(() => {
    setGhostBlock(null);
  }, []);

  const handleCanvasDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-pool-item')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    [],
  );

  // ── 全局 dragend 清理 ──────────────────────────────────
  const handleGlobalDragEnd = useCallback(() => {
    setDraggedPoolItemId(null);
    setDraggingBlockId(null);
    setGhostBlock(null);
    window.setTimeout(() => { suppressPoolOpenRef.current = false; }, 120);
  }, []);

  // ── 统计 ───────────────────────────────────────────────
  const stats = useMemo(() => {
    const taskBlocks = blocks.filter(b => b.source !== 'free');
    const total = taskBlocks.length;
    const completed = taskBlocks.filter((b) => b.completed).length;
    const totalMin = taskBlocks.reduce((sum, b) => sum + (timeToMinutes(b.endTime) - timeToMinutes(b.startTime)), 0);
    return { total, completed, totalMin };
  }, [blocks]);

  // ── 分组计算 ───────────────────────────────────────────
  const projectPoolItems = useMemo(
    () => poolItems.filter((i) => i.source === 'project'),
    [poolItems],
  );
  const reviewPoolItems = useMemo(
    () => poolItems.filter((i) => i.source === 'review'),
    [poolItems],
  );

  return (
    <div className="ds-body" onDragEnd={handleGlobalDragEnd}>
      {/* 左侧：时间块画布 */}
      <div className="ds-left ds-left--blocks">
        <div className="tg-stats">
          <span>{stats.completed}/{stats.total} 完成</span>
          {stats.totalMin > 0 && <span>~{stats.totalMin}分钟</span>}
        </div>
        <div
          ref={canvasRef}
          className="tg-scroll"
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
          onDragLeave={handleCanvasDragLeave}
          onDragEnter={handleCanvasDragEnter}
        >
          <TimeGrid
            blocks={blocks}
            selectedDate={selectedDate}
            onResize={handleResize}
            onToggle={handleToggle}
            onRemove={handleRemove}
            onBlockClick={handleBlockClick}
            onBlockDragStart={handleBlockDragStart}
            onBlankClick={handleBlankClick}
            ghostBlock={ghostBlock}
            conflictIds={conflictIds}
            isUnlinkedTask={checkIsUnlinkedTask}
            isLinkedTask={checkIsLinkedTask}
          />
        </div>

        {/* 快速创建输入框 */}
        {quickCreateTime && (
          <QuickCreateInput
            initialTime={quickCreateTime}
            onCreate={handleQuickCreate}
            onCancel={() => setQuickCreateTime(null)}
          />
        )}
      </div>

      {/* 分隔线 */}
      <div className="ds-divider" />

      {/* 右侧：任务池（纯 HTML5 拖拽，接收从画布拖回的时间块） */}
      <div
        className={`ds-right ${draggingBlockId ? 'ds-right--drop-target' : ''}`}
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes('application/x-timeblock')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-timeblock')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          const blockId = e.dataTransfer.getData('application/x-timeblock');
          if (blockId) {
            removeTimeBlock(selectedDate, blockId);
            setDraggingBlockId(null);
          }
        }}
      >
        <div className="ds-pool-header">
          <h2 className="ds-pool-title">任务池</h2>
        </div>

        {/* 项目任务组 */}
        {projectPoolItems.length > 0 && (
          <div className="ds-pool-group">
            <div className="ds-pool-group-header">
              <div className="ds-pool-group-dot ds-pool-group-dot--project" />
              <span className="ds-pool-group-label">项目任务</span>
              <span className="ds-pool-group-count">
                {projectPoolItems.length}
              </span>
            </div>
            <div className="ds-pool-list">
              {projectPoolItems.map((item) => (
                <div
                  key={item.id}
                  className={`ds-pool-item ${draggedPoolItemId === item.id ? 'ds-pool-item--dragging' : ''}`}
                  style={{ backgroundColor: resolveTaskCategoryTheme(item.categoryColor, item.source).backgroundColor }}
                  draggable
                  onDragStart={(e) => handlePoolDragStart(e, item.id)}
                  onClick={() => { if (!suppressPoolOpenRef.current) handleProjectPoolClick(item.sourceId); }}
                >
                  <div
                    className="ds-pool-item-accent"
                    style={{ backgroundColor: resolveTaskCategoryTheme(item.categoryColor, item.source).accentColor }}
                  />
                  <div className="ds-pool-item-content">
                    <span className="ds-pool-item-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title={item.name}>
                      {item.name}
                      {checkIsUnlinkedTask(item.sourceId) && (
                        <span title="未绑定节点" className="ml-1 inline-flex items-center">
                          <CircleDashed size={12} className="opacity-40" />
                        </span>
                      )}
                    </span>
                  </div>
                  <span
                    className="ds-pool-item-tag ds-pool-item-tag--project ds-pool-item-tag--project-name ds-project-name-badge"
                    title={item.detail || '项目'}
                    style={projectBadgeStyle(item.color)}
                  >
                    {item.detail || '项目'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 复习任务组 */}
        {reviewPoolItems.length > 0 && (
          <div className="ds-pool-group">
            <div className="ds-pool-group-header">
              <div className="ds-pool-group-dot ds-pool-group-dot--review" />
              <span className="ds-pool-group-label">复习任务</span>
              <span className="ds-pool-group-count">
                {reviewPoolItems.length}
              </span>
            </div>
            <div className="ds-pool-list">
              {reviewPoolItems.map((item) => (
                  <div
                    key={item.id}
                    className={`ds-pool-item ${draggedPoolItemId === item.id ? 'ds-pool-item--dragging' : ''}`}
                    style={{ backgroundColor: resolveTaskCategoryTheme(item.categoryColor, item.source).backgroundColor }}
                    draggable
                    onDragStart={(e) => handlePoolDragStart(e, item.id)}
                  >
                    <div
                      className="ds-pool-item-accent"
                      style={{ backgroundColor: resolveTaskCategoryTheme(item.categoryColor, item.source).accentColor }}
                    />
                    <div className="ds-pool-item-content">
                      <span className="ds-pool-item-name" title={item.name}>
                            {item.name}
                            {checkIsUnlinkedTask(item.sourceId) ? (
                              <span title="未绑定节点" className="ml-1 inline-flex items-center">
                                <CircleDashed size={12} className="opacity-40" />
                              </span>
                            ) : checkIsLinkedTask(item.sourceId) && (
                              <span title="已绑定节点" className="ml-1 inline-flex items-center text-blue-500">
                                <LinkIcon size={12} className="opacity-60" />
                              </span>
                            )}
                          </span>
                    </div>
                    <span className="ds-pool-item-tag ds-pool-item-tag--review">
                      复习{item.detail ? ` · ${item.detail}` : ''}
                    </span>
                  </div>
              ))}
            </div>
          </div>
        )}

        {completedPoolItems.length > 0 && (
          <div className="ds-pool-group ds-pool-group--completed">
            <button
              type="button"
              className="ds-pool-completed-toggle"
              onClick={() => setShowCompletedPool((value) => !value)}
            >
              <span>今日已完成</span>
              <span className="ds-pool-group-count">{completedPoolItems.length}</span>
              <span>{showCompletedPool ? '收起' : '展开'}</span>
            </button>
            {showCompletedPool && (
              <div className="ds-pool-list">
                {completedPoolItems.map((item) => (
                  <div
                    key={item.id}
                    className="ds-pool-item ds-pool-item--completed"
                    style={{ backgroundColor: resolveTaskCategoryTheme(item.categoryColor, item.source).backgroundColor }}
                    onClick={() => { if (item.source === 'project') handleProjectPoolClick(item.sourceId); }}
                  >
                    <div className="ds-pool-item-content">
                      <span className="ds-pool-item-name" title={item.name}>{item.name}</span>
                      {item.detail && item.source !== 'project' && <span className="ds-pool-item-detail">{item.detail}</span>}
                    </div>
                    {item.source === 'project' && (
                      <span
                        className="ds-pool-item-tag ds-pool-item-tag--project ds-pool-item-tag--project-name ds-project-name-badge"
                        title={item.detail || '项目'}
                        style={projectBadgeStyle(item.color)}
                      >
                        {item.detail || '项目'}
                      </span>
                    )}
                    <button
                      type="button"
                      className="ds-pool-undo-btn"
                      onClick={(event) => { event.stopPropagation(); handleUndoCompletedPoolItem(item); }}
                    >
                      撤销
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {poolItems.length === 0 && (
          <div className="ds-pool-empty">今日暂无待安排任务</div>
        )}
      </div>

      {/* 编辑浮层 */}
      {editingBlock && (
        <BlockEditor
          block={editingBlock.block}
          rect={editingBlock.rect}
          onSave={handleEditorSave}
          onDelete={handleEditorDelete}
          onClose={() => setEditingBlock(null)}
        />
      )}
    </div>
  );
};

export default React.memo(BlockModeView);
