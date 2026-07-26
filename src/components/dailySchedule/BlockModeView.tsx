// ============================================================
// 时间块模式视图 - 类日历画布 + 右侧任务池
// 使用纯 HTML5 Drag & Drop 实现从任务池拖入画布
// ============================================================

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { todayStr } from '@/utils/dateSafe';
import { CircleDashed, Link as LinkIcon } from 'lucide-react';
import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import { getValidGraphNodeIds, isQuantityTask } from '@/utils/blocks';
import { useGraphStore } from '@/graph/store';
import { useShallow } from 'zustand/react/shallow';
import { buildRootNodeMap, getReviewCategoryColor, resolveReviewCategory } from '@/ebb/category';
import { useDailyScheduleStore, EMPTY_DAY_SCHEDULE } from './store';
import { useTaskCompletionStatus } from './useTaskCompletionStatus';
import { openProjectTaskModal } from '@/components/smartBlock/projectTaskModal';
import { removeQuantityProgress, setProjectTaskCompletion } from '@/services/projectTaskCommands';
import { returnProjectTaskToBacklog, scheduleBacklogTaskToTimeBlock } from '@/services/backlogCommands';
import { requestConfirmation } from '@/services/confirmation';
import { requestManualReviewToggle } from '@/services/reviewCompletionCommands';
import BacklogTaskList from '@/components/smartBlock/BacklogTaskList';
import type { BacklogTask } from '@/domain/taskBacklog';
import TimeGrid from './TimeGrid';
import { BlockEditor, QuickCreateInput } from './TimeBlockOverlays';
import { getUniqueTasks } from '@/store/timelineData';
import type { SmartTaskBlock } from '@/types';
import type { TimeBlock } from './types';
import type { CompletedDailyPoolItem, DailyPoolItem } from './DailyTaskPool';
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

// ── 任务池项类型 ────────────────────────────────────────────

// ── Props ───────────────────────────────────────────────────

interface BlockModeViewProps {
  selectedDate: string;
  poolItems: DailyPoolItem[];
  completedPoolItems: CompletedDailyPoolItem[];
  backlogItems: BacklogTask[];
  onScheduleBacklog: (task: BacklogTask, date: string) => boolean | Promise<boolean>;
  onOpenBacklogTask: (task: BacklogTask) => void;
  onReviewToggleError: (error: string | null) => void;
  onOpenQuantityProgress: (taskId: string, block: SmartTaskBlock) => void;
}

// ── 主组件 ──────────────────────────────────────────────────

const BlockModeView: React.FC<BlockModeViewProps> = ({
  selectedDate,
  poolItems,
  completedPoolItems,
  backlogItems,
  onScheduleBacklog,
  onOpenBacklogTask,
  onReviewToggleError,
  onOpenQuantityProgress,
}) => {
  const [showCompletedPool, setShowCompletedPool] = useState(false);
  const [activePoolTab, setActivePoolTab] = useState<'today' | 'backlog'>('today');
  const { tasks: rawTlTasks, groups: rawTlGroups } = useTimelineStore(
    useShallow((s) => ({ tasks: s.tasks, groups: s.groups })),
  );
  const {
    reviewTasks: rawEbbReviewTasks,
    ebbSettings: ebbSettingsData,
  } = useEbbStore(
    useShallow((s) => ({
      reviewTasks: s.reviewTasks,
      ebbSettings: s.ebbSettings,
    })),
  );

  const graphNodes = useGraphStore((state) => state.nodes);
  const ebbRootByNodeId = useMemo(() => buildRootNodeMap(graphNodes), [graphNodes]);

  const archivedNodeIds = useMemo(() => new Set(graphNodes.filter(n => n.isArchived).map(n => n.id)), [graphNodes]);

  const ebbReviewTasks = useMemo(() => {
    return rawEbbReviewTasks.filter(t => {
      if (t.isArchived) return false;
      return !t.graphNodeId || !archivedNodeIds.has(t.graphNodeId);
    });
  }, [rawEbbReviewTasks, archivedNodeIds]);

  const tlTasks = useMemo(() => {
    return getUniqueTasks(rawTlTasks, rawTlGroups).map(task => ({
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
        ? getReviewCategoryColor(
            resolveReviewCategory(reviewTask, ebbRootByNodeId),
            ebbSettingsData.tagColors,
          )
        : undefined;
      return {
        ...b,
        completed: b.source === 'free'
          ? b.completedDate === selectedDate
          : checkIsCompleted(b.source, b.sourceId, selectedDate),
        detail: appearance?.name ?? b.detail,
        color: appearance?.theme.backgroundColor ?? b.color,
        categoryColor: appearance?.categoryColor ?? reviewCategoryColor ?? b.categoryColor,
      };
    });
  }, [daySchedule.blocks, checkIsCompleted, tlTasks, rawTlGroups, ebbReviewTasks, ebbSettingsData, selectedDate, ebbRootByNodeId]);

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
      if (!parentTask || !Array.isArray(parentTask.blocks)) return false;
      
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
      if (!parentTask || !Array.isArray(parentTask.blocks)) return false;
      
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

  const handleBacklogItemDrop = useCallback(
    async (taskId: string, targetMinutes: number) => {
      const task = backlogItems.find((item) => item.id === taskId);
      if (!task) return;
      const duration = Math.max(15, task.duration || 30);
      const latestStart = 23 * 60 + 45 - duration;
      const earliestStart = GRID_CONFIG.startHour * 60;
      if (latestStart < earliestStart) return;
      const startMin = Math.max(earliestStart, Math.min(snapToQuarter(targetMinutes), latestStart));
      const endMin = startMin + duration;
      const startTime = minutesToTime(startMin);
      const endTime = minutesToTime(endMin);
      if (checkCollision(null, startTime, endTime, blocks).overlap) {
        onReviewToggleError('目标时间与现有时间块冲突。');
        return;
      }
      if (task.deadline && selectedDate > task.deadline) {
        const confirmed = await requestConfirmation({
          title: '排期晚于截止日期',
          message: `“${task.title}”的截止日期是 ${task.deadline}，目标日期是 ${selectedDate}。是否仍然安排？`,
          confirmLabel: '仍然安排',
          cancelLabel: '返回修改',
          tone: 'warning',
        });
        if (!confirmed) return;
      }
      const result = scheduleBacklogTaskToTimeBlock({
        task,
        date: selectedDate,
        startTime,
        endTime,
        color: task.projectColor,
        categoryColor: task.tagColor,
      });
      onReviewToggleError('error' in result ? result.error : null);
    },
    [backlogItems, blocks, onReviewToggleError, selectedDate],
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
        void requestManualReviewToggle(reviewId).then((result) => {
          onReviewToggleError(result.cancelled || result.ok ? null : result.message ?? '复习任务操作失败');
        });
      } else if (block.source === 'project') {
        const parsed = parseSourceId(block.sourceId);
        if (!parsed || parsed.source !== 'project') return;
        const parentTask = tlTasks.find((t) => t.id === parsed.parentTaskId);
        if (!parentTask) return;

        if (parsed.blockId) {
          const currentBlock = (Array.isArray(parentTask.blocks) ? parentTask.blocks : [])
            .find((candidate) => candidate.id === parsed.blockId);
          if (currentBlock?.type === 'smart-task' && isQuantityTask(currentBlock.header)) {
            onOpenQuantityProgress(parsed.parentTaskId, currentBlock);
            return;
          }
          if (currentBlock?.type !== 'smart-task') return;
          const desired = !currentBlock.header.isCompleted;
          const result = setProjectTaskCompletion(
            parsed.parentTaskId,
            parsed.blockId,
            desired,
            desired ? todayStr() : undefined,
          );
          if ('error' in result) onReviewToggleError(result.error);
        }
      } else if (block.source === 'free') {
        updateTimeBlock(selectedDate, block.id, {
          completed: block.completedDate !== selectedDate,
          completedDate: block.completedDate === selectedDate ? undefined : selectedDate,
        });
      }
    },
    [blocks, onOpenQuantityProgress, onReviewToggleError, selectedDate, tlTasks, updateTimeBlock],
  );

  const handleUndoCompletedPoolItem = useCallback((item: CompletedDailyPoolItem) => {
    if (item.source === 'review') {
      const parsed = parseSourceId(item.sourceId);
      if (parsed?.source === 'review') {
        void requestManualReviewToggle(parsed.reviewId).then((result) => {
          onReviewToggleError(result.cancelled || result.ok ? null : result.message ?? '复习任务操作失败');
        });
      }
      return;
    }
    if (item.source !== 'project') return;
    const parsed = parseSourceId(item.sourceId);
    if (!parsed || parsed.source !== 'project' || !parsed.blockId) return;
    const parentTask = tlTasks.find((task) => task.id === parsed.parentTaskId);
    const currentBlock = (Array.isArray(parentTask?.blocks) ? parentTask.blocks : [])
      .find((block) => block.id === parsed.blockId);
    if (currentBlock?.type !== 'smart-task') return;
    if (isQuantityTask(currentBlock.header)) {
      const result = removeQuantityProgress(parsed.parentTaskId, parsed.blockId, selectedDate);
      if ('error' in result) onReviewToggleError(result.error);
      return;
    }
    if (!currentBlock.header.isCompleted) return;
    const result = setProjectTaskCompletion(parsed.parentTaskId, parsed.blockId, false);
    if ('error' in result) onReviewToggleError(result.error);
  }, [onReviewToggleError, selectedDate, tlTasks]);

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
          openProjectTaskModal(parsed.parentTaskId, parsed.blockId, { source: 'time-block', sourceDate: selectedDate });
          return;
        }
      }
      setEditingBlock({ block, rect });
    },
    [selectedDate],
  );

  const handleProjectPoolClick = useCallback((sourceId: string) => {
    const parsed = parseSourceId(sourceId);
    if (parsed?.source === 'project' && parsed.blockId) {
      openProjectTaskModal(parsed.parentTaskId, parsed.blockId, { source: 'time-block', sourceDate: selectedDate });
    }
  }, [selectedDate]);

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
      // 接受当日任务池或待排期箱，不干预时间块拖回右侧面板。
      const fromPool = e.dataTransfer.types.includes('application/x-pool-item');
      const fromBacklog = e.dataTransfer.types.includes('application/x-backlog-task');
      if (!fromPool && !fromBacklog) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';

      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top + canvasRef.current.scrollTop;
      const min = yToMinutes(y);
      const startMin = snapToQuarter(min);

      // 实时构建 ghost 预览块
      if (fromPool && draggedPoolItemId) {
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
    async (e: React.DragEvent) => {
      e.preventDefault();
      const poolItemId = e.dataTransfer.getData('application/x-pool-item');
      const backlogTaskId = e.dataTransfer.getData('application/x-backlog-task');
      if ((!poolItemId && !backlogTaskId) || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top + canvasRef.current.scrollTop;
      const targetMin = yToMinutes(y);

      if (backlogTaskId) await handleBacklogItemDrop(backlogTaskId, targetMin);
      else handlePoolItemDrop(poolItemId, targetMin);
      setDraggedPoolItemId(null);
      setGhostBlock(null);
    },
    [handleBacklogItemDrop, handlePoolItemDrop],
  );

  const handleCanvasDragLeave = useCallback(() => {
    setGhostBlock(null);
  }, []);

  const handleCanvasDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (
        !e.dataTransfer.types.includes('application/x-pool-item')
        && !e.dataTransfer.types.includes('application/x-backlog-task')
      ) return;
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
            const draggedBlock = blocks.find((block) => block.id === blockId);
            if (activePoolTab === 'backlog' && draggedBlock?.source === 'project') {
              const parsed = parseSourceId(draggedBlock.sourceId);
              const project = parsed?.source === 'project'
                ? tlTasks.find((task) => task.id === parsed.parentTaskId)
                : undefined;
              const parsedBlockId = parsed?.source === 'project' && 'blockId' in parsed
                ? parsed.blockId
                : undefined;
              const projectBlock = parsedBlockId
                ? (Array.isArray(project?.blocks) ? project.blocks : [])
                  .find((block) => block.id === parsedBlockId)
                : undefined;
              if (parsed?.source !== 'project' || !parsedBlockId || projectBlock?.type !== 'smart-task') {
                onReviewToggleError('无法识别对应的项目任务。');
              } else if (isQuantityTask(projectBlock.header)) {
                onReviewToggleError('数量任务必须保留开始日期，不能移入待排期箱。');
              } else {
                const result = returnProjectTaskToBacklog(parsed.parentTaskId, parsedBlockId);
                onReviewToggleError('error' in result ? result.error : null);
              }
            } else if (activePoolTab === 'backlog') {
              onReviewToggleError('只有普通项目任务可以移回待排期箱。');
            } else {
              removeTimeBlock(selectedDate, blockId);
            }
            setDraggingBlockId(null);
          }
        }}
      >
        <div className="ds-pool-header">
          <h2 className="ds-pool-title">任务池</h2>
        </div>
        <div className="ds-pool-tabs" role="tablist" aria-label="任务池类型">
          <button type="button" role="tab" aria-selected={activePoolTab === 'today'} className={activePoolTab === 'today' ? 'is-active' : ''} onClick={() => setActivePoolTab('today')}>
            今日任务 <span>{poolItems.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={activePoolTab === 'backlog'} className={activePoolTab === 'backlog' ? 'is-active' : ''} onClick={() => setActivePoolTab('backlog')}>
            待排期箱 <span>{backlogItems.length}</span>
          </button>
        </div>

        {activePoolTab === 'backlog' ? (
          <div className="ds-pool-scroll ds-pool-scroll--backlog">
            <BacklogTaskList
              tasks={backlogItems}
              defaultDate={selectedDate}
              onSchedule={onScheduleBacklog}
              onOpenTask={onOpenBacklogTask}
            />
          </div>
        ) : <>
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
                    {isQuantityTask({ taskKind: item.taskKind }) && (
                      <span className="ds-pool-quantity-summary">
                        今日 {item.quantityActual ?? 0}/{item.quantityTarget ?? 0} {item.quantityUnit}
                        {' · '}总进度 {item.quantityCompleted ?? 0}/{item.quantityTotal ?? 0} {item.quantityUnit}
                      </span>
                    )}
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
        </>}
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
