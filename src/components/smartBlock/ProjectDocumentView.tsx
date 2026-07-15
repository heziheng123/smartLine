// ============================================================
// 项目文档视图（Project Document View）
// 替代 TaskDrawer —— 全屏文档流，智能任务块镶嵌在文章中
// ============================================================

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import {
  ArrowLeft,
  Plus,
  Clock,
  Calendar,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  Maximize,
  Minimize,
  ListTree,
  MoreHorizontal,
} from 'lucide-react';
import {
  todayStr,
  addDays,
  formatDate,
  getDayOfWeek,
  diffDays,
} from '@/utils/dateSafe';

/** 计算日期所在周的周一（本地时间，避免 UTC/local 偏移） */
function getMondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday of the week
  date.setDate(date.getDate() + diff);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 本地化的星期名称（短） */
const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
function weekdayShort(dateStr: string): string {
  return `周${WEEKDAY_SHORT[getDayOfWeek(dateStr)]}`;
}
import { getValidGraphNodeIds } from '@/utils/blocks';
import type { Block, Task, SmartTaskBlock, SmartTaskHeader, TextBlock } from '@/types';
import { useTimelineStore } from '@/store';
import { useGraphStore } from '@/graph/store';
import { useShallow } from 'zustand/react/shallow';
import {
  genBlockId,
  getTagColor,
  computeBlockProgress,
  getSmartTaskBlocks,
} from '@/utils/blocks';
import SmartTaskBlockCard from './SmartTaskBlockCard';
import TextBlockCard from './TextBlockCard';
import SlashCommandMenu from './SlashCommandMenu';
import TaskMetaEditor from '@/components/TaskMetaEditor';
import BatchImportDialog from '@/components/BatchImportDialog';
import BatchEditDialog from '@/components/BatchEditDialog';
import { mergeBatchEditRows, type ParsedRow } from '@/utils/excelImport';

interface ProjectDocumentViewProps {
  task: Task;
  onClose: () => void;
  onUpdateTask?: (taskId: string, patch: Partial<Task>) => void;
  onDeleteTask?: (taskId: string) => void;
}

const ProjectDocumentView: React.FC<ProjectDocumentViewProps> = ({
  task,
  onClose,
  onUpdateTask,
  onDeleteTask,
}) => {
  const {
    tasks: storeTasks,
    updateBlockHeader,
    updateBlockBody,
    removeBlock,
    updateTextBlockContent,
    appendBlock,
    extendTaskBlocks,
    updateTaskBlocks,
  } = useTimelineStore(
    useShallow((s) => ({
      tasks: s.tasks,
      updateBlockHeader: s.updateBlockHeader,
      updateBlockBody: s.updateBlockBody,
      removeBlock: s.removeBlock,
      updateTextBlockContent: s.updateTextBlockContent,
      appendBlock: s.appendBlock,
      extendTaskBlocks: s.extendTaskBlocks,
      updateTaskBlocks: s.updateTaskBlocks,
    })),
  );
  const [metaExpanded, setMetaExpanded] = useState(false);
  const [slashMenu, setSlashMenu] = useState<{ position: { top: number; left: number }; blockId: string } | null>(null);
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const [expandAll, setExpandAll] = useState<boolean | null>(null);
  const [showExpandMenu, setShowExpandMenu] = useState(false);
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [groupDimension, setGroupDimension] = useState<'time' | 'node'>('time');
  const [groupByWeek, setGroupByWeek] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [todayOnly, setTodayOnly] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 实时从 store 读取最新 blocks（防止 stale data）
  const { id: taskId } = task;
  const currentTask = useMemo(
    () => storeTasks.find(t => t.id === taskId) ?? task,
    [storeTasks, taskId, task],
  );
  const blocks = useMemo(
    () => currentTask.blocks ?? [],
    [currentTask],
  );

  // ── 排序：smart-task 按日期升序，text 块保持原位 ──
  const sortedBlocks = useMemo(() => {
    if (blocks.length <= 1) return blocks;
    // 先按原索引分组，smart-task 段内按日期排序，text 块保持位置
    return blocks.map((b, i) => ({ block: b, index: i }))
      .sort((a, b) => {
        // 不同类型之间保持原顺序
        if (a.block.type !== b.block.type) return a.index - b.index;
        // text 块之间保持原顺序
        if (a.block.type === 'text') return a.index - b.index;
        // smart-task 按日期排序，无日期排最后
        const dateA = (a.block as SmartTaskBlock).header.date || '9999-12-31';
        const dateB = (b.block as SmartTaskBlock).header.date || '9999-12-31';
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return a.index - b.index;
      })
      .map(item => item.block);
  }, [blocks]);

  // ── 过滤器：从所有 smart-task 块提取标签 ──
  const uniqueTags = useMemo(() => {
    const tagSet = new Map<string, string>(); // tag name → tagColor
    for (const b of blocks) {
      if (b.type === 'smart-task') {
        const { tag, tagColor } = (b as SmartTaskBlock).header;
        if (tag && !tagSet.has(tag)) tagSet.set(tag, tagColor);
      }
    }
    return Array.from(tagSet.entries()).map(([name, color]) => ({ name, color }));
  }, [blocks]);

  // ── 过滤后的 smart-task 块（供分组使用） ──
  const filteredSmartBlocks = useMemo(() => {
    const today = todayStr();
    return sortedBlocks.filter((b) => {
      if (b.type !== 'smart-task') return true; // text 块不过滤
      const h = (b as SmartTaskBlock).header;
      if (hideCompleted && h.isCompleted) return false;
      if (activeTag && h.tag !== activeTag) return false;
      if (todayOnly && h.date !== today) return false;
      return true;
    });
  }, [sortedBlocks, hideCompleted, activeTag, todayOnly]);

  // ── 按日期/周分组：smart-task 按 date 分组插入粘性表头，text 块单独收集 ──
  type DateGroup = {
    key: string;            // 分组唯一标识（日期或周标识，或者图谱节点 ID）
    label: string;          // 主显示文本
    subLabel?: string;      // 副显示文本（周模式下的日期范围）
    icon?: React.ReactNode; // 节点专属图标
    blocks: SmartTaskBlock[];
  };

  const { nodes } = useGraphStore();

  const groupedByDate = useMemo(() => {
    const groups: DateGroup[] = [];
    const groupMap = new Map<string, DateGroup>();
    const textBlocks: TextBlock[] = [];

    for (const block of filteredSmartBlocks) {
      if (block.type === 'text') {
        textBlocks.push(block);
        continue;
      }
      const sb = block as SmartTaskBlock;

      let groupKey: string;
      let label: string;
      let subLabel: string | undefined;
      let icon: React.ReactNode | undefined;

      if (groupDimension === 'node') {
        // 按图谱节点分组
        const graphNodeIds = getValidGraphNodeIds(sb.header);
        if (graphNodeIds.length === 0) {
          groupKey = '__unlinked__';
          label = '未关联节点';
          icon = '📥';
        } else {
          // 在 ProjectDocumentView 分组时，如果绑了多个节点，按第一个节点分组展示，或者可以用逗号拼接
          // 这里为了与原有逻辑尽量保持一致并兼顾多节点，使用第一个节点
          const nodeId = graphNodeIds[0];
          const node = nodes.find(n => n.id === nodeId);
          groupKey = nodeId;
          label = node ? node.name : '未知节点';
          icon = '🕸️';
        }
      } else {
        // 按时间分组
        const dateStr = sb.header.date || '__none__';
        if (groupByWeek && dateStr !== '__none__') {
          // 按周分组：用该日期所在周的周一作为 key
          const mondayStr = getMondayOfWeek(dateStr);
          const sundayStr = addDays(mondayStr, 6);
          groupKey = mondayStr;
          label = `第 ${formatDate(mondayStr, 'M.D')} ~ ${formatDate(sundayStr, 'M.D')} 周`;
          subLabel = `${weekdayShort(mondayStr)} ~ ${weekdayShort(sundayStr)}`;
          icon = '🗓️';
        } else {
          groupKey = dateStr;
          label = dateStr === '__none__' ? '未排期' : `${formatDate(dateStr, 'M.D')} ${weekdayShort(dateStr)}`;
          icon = '📅';
        }
      }

      if (!groupMap.has(groupKey)) {
        const group: DateGroup = { key: groupKey, label, subLabel, icon, blocks: [] };
        groupMap.set(groupKey, group);
        groups.push(group);
      }
      groupMap.get(groupKey)!.blocks.push(sb);
    }

    // 如果是按节点分组，对分组进行排序：未关联排在最前面，其他按节点名称排序
    if (groupDimension === 'node') {
      groups.sort((a, b) => {
        if (a.key === '__unlinked__') return -1;
        if (b.key === '__unlinked__') return 1;
        return a.label.localeCompare(b.label);
      });
    }

    return { groups, textBlocks };
  }, [filteredSmartBlocks, groupByWeek, groupDimension, nodes]);

  const toggleDateCollapse = useCallback((date: string) => {
    setCollapsedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }, []);

  // ── 统计 ──
  const progress = useMemo(() => computeBlockProgress(blocks), [blocks]);
  const smartBlocks = useMemo(() => getSmartTaskBlocks(blocks), [blocks]);
  const totalDuration = useMemo(
    () => smartBlocks.reduce((sum, b) => sum + b.header.duration, 0),
    [smartBlocks],
  );

  // ── Block 操作回调 ──

  const handleUpdateHeader = useCallback(
    (blockId: string, patch: Partial<SmartTaskHeader>) => {
      updateBlockHeader(task.id, blockId, patch);
    },
    [updateBlockHeader, task.id],
  );

  const handleUpdateBody = useCallback(
    (blockId: string, body: string) => {
      // 局部 patch：只更新指定 block 的 body，避免整体覆盖 blocks 数组
      updateBlockBody(task.id, blockId, body);
    },
    [updateBlockBody, task.id],
  );

  const handleDeleteBlock = useCallback(
    (blockId: string) => {
      removeBlock(task.id, blockId);
    },
    [removeBlock, task.id],
  );

  const handleUpdateTextBlock = useCallback(
    (blockId: string, content: string) => {
      // 局部 patch：只更新指定 TextBlock 的 content
      updateTextBlockContent(task.id, blockId, content);
    },
    [updateTextBlockContent, task.id],
  );

  // ── 添加新 Block ──

  const handleAddTaskBlock = useCallback(() => {
    const today = todayStr();
    const newBlock: SmartTaskBlock = {
      type: 'smart-task',
      id: genBlockId(),
      header: {
        title: '新任务',
        tag: '默认',
        tagColor: getTagColor('默认'),
        date: today,
        duration: 30,
        isCompleted: false,
      },
      body: '',
    };
    appendBlock(task.id, newBlock);
  }, [appendBlock, task.id]);

  // ── 批量导入确认：把 Excel 解析出的 blocks 追加到当前项目 ──

  const handleBatchImportConfirm = useCallback(
    (
      newBlocks: SmartTaskBlock[],
      target: { taskId: string } | { newTaskName: string; start: string; end: string; tag: string },
    ) => {
      if ('taskId' in target && target.taskId === task.id) {
        // 仅追加 blocks，不修改 task 其他字段（避免覆盖远端并发更新）
        extendTaskBlocks(task.id, newBlocks);
      }
      setShowBatchImport(false);
    },
    [extendTaskBlocks, task.id],
  );

  // ── 批量编辑确认：将修改后的 blocks 整体合并回 task ──
  const handleBatchEditConfirm = useCallback(
    (rows: ParsedRow[]) => {
      // 批量编辑目前只处理 smart-task，我们需要保留原来的 text blocks
      const currentBlocks = useTimelineStore.getState().tasks.find(t => t.id === task.id)?.blocks ?? [];
      const currentSmartBlocks = currentBlocks.filter((block): block is SmartTaskBlock => block.type === 'smart-task');
      const editedSmartBlocks = mergeBatchEditRows(rows, currentSmartBlocks);
      const editedById = new Map(editedSmartBlocks.map((block) => [block.id, block]));
      const mergedBlocks = currentBlocks.flatMap<Block>((block) => {
        if (block.type !== 'smart-task') return [block];
        const edited = editedById.get(block.id);
        return edited ? [edited] : [];
      });
      const existingIds = new Set(currentSmartBlocks.map((block) => block.id));
      mergedBlocks.push(...editedSmartBlocks.filter((block) => !existingIds.has(block.id)));
      
      updateTaskBlocks(task.id, mergedBlocks);
      setShowBatchEdit(false);
    },
    [updateTaskBlocks, task.id]
  );

  // ── 拖拽排序 & 跨日排期 ──

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { source, destination, draggableId } = result;
      if (!destination) return;
      if (source.droppableId === destination.droppableId && source.index === destination.index) return;

      const blockId = draggableId.replace('block-', '');
      const sourceGroupKey = source.droppableId;
      const destGroupKey = destination.droppableId;

      // 基于最新 store state 操作，避免闭包 stale
      const currentBlocks = useTimelineStore.getState().tasks.find(t => t.id === task.id)?.blocks ?? [];
      const newBlocks = [...currentBlocks];
      const blockIndex = newBlocks.findIndex(b => b.id === blockId);
      if (blockIndex === -1 || newBlocks[blockIndex].type !== 'smart-task') return;

      // 跨组：更新日期或图谱节点
      if (sourceGroupKey !== destGroupKey) {
        if (groupDimension === 'node') {
          let newGraphNodeIds: string[] = [];
          if (destGroupKey !== '__unlinked__') {
            newGraphNodeIds = [destGroupKey]; // 拖拽到一个节点组时，覆盖为其单一节点
          }
          (newBlocks[blockIndex] as SmartTaskBlock) = {
            ...newBlocks[blockIndex] as SmartTaskBlock,
            header: {
              ...(newBlocks[blockIndex] as SmartTaskBlock).header,
              graphNodeId: newGraphNodeIds[0],
              graphNodeIds: newGraphNodeIds,
            },
          };
        } else {
          let newDate: string | undefined;
          if (destGroupKey === '__none__') {
            newDate = undefined;
          } else {
            newDate = destGroupKey;
            if (groupByWeek) {
              const origDate = (newBlocks[blockIndex] as SmartTaskBlock).header.date;
              if (origDate) {
                const origDayOfWeek = getDayOfWeek(origDate);
                newDate = addDays(destGroupKey, origDayOfWeek === 0 ? 6 : origDayOfWeek - 1);
              }
            }
          }
          (newBlocks[blockIndex] as SmartTaskBlock) = {
            ...newBlocks[blockIndex] as SmartTaskBlock,
            header: {
              ...(newBlocks[blockIndex] as SmartTaskBlock).header,
              ...(newDate !== undefined ? { date: newDate } : { date: undefined }),
            },
          };
        }
      }

      const [moved] = newBlocks.splice(blockIndex, 1);

      const findInsertIndex = (groupKey: string, destIdx: number): number => {
        const groupSmartIds: string[] = [];
        for (const b of currentBlocks) {
          if (b.type !== 'smart-task') continue;
          const sb = b as SmartTaskBlock;
          let bGroupKey: string;
          if (groupDimension === 'node') {
            const ids = getValidGraphNodeIds(sb.header);
            bGroupKey = ids.length > 0 ? ids[0] : '__unlinked__';
          } else {
            const d = sb.header.date || '__none__';
            if (groupByWeek && d !== '__none__') {
              bGroupKey = getMondayOfWeek(d);
            } else {
              bGroupKey = d;
            }
          }
          if (bGroupKey === groupKey) groupSmartIds.push(b.id);
        }

        const adjustedIds = groupSmartIds.filter(id => id !== blockId);

        if (activeTag || hideCompleted) {
          const filteredIds = groupSmartIds.filter(id => {
            const b = currentBlocks.find(bl => bl.id === id) as SmartTaskBlock;
            if (hideCompleted && b.header.isCompleted) return false;
            if (activeTag && b.header.tag !== activeTag) return false;
            return true;
          }).filter(id => id !== blockId);

          const targetId = destIdx < filteredIds.length ? filteredIds[destIdx] : null;
          if (targetId) {
            const idx = newBlocks.findIndex(b => b.id === targetId);
            return idx === -1 ? newBlocks.length : idx;
          }
          const lastId = adjustedIds.length > 0 ? adjustedIds[adjustedIds.length - 1] : null;
          if (lastId) {
            const idx = newBlocks.findIndex(b => b.id === lastId);
            return idx === -1 ? newBlocks.length : idx + 1;
          }
          return newBlocks.length;
        }

        const targetId = destIdx < adjustedIds.length ? adjustedIds[destIdx] : null;
        if (targetId) {
          const idx = newBlocks.findIndex(b => b.id === targetId);
          return idx === -1 ? newBlocks.length : idx;
        }
        const lastId = adjustedIds.length > 0 ? adjustedIds[adjustedIds.length - 1] : null;
        if (lastId) {
          const idx = newBlocks.findIndex(b => b.id === lastId);
          return idx === -1 ? newBlocks.length : idx + 1;
        }
        return newBlocks.length;
      };

      const insertIdx = findInsertIndex(destGroupKey, destination.index);
      newBlocks.splice(insertIdx, 0, moved);

      updateTaskBlocks(task.id, newBlocks);
    },
    [task.id, groupByWeek, groupDimension, updateTaskBlocks, activeTag, hideCompleted],
  );

  const handleAddTextBlock = useCallback(() => {
    const newBlock: TextBlock = {
      type: 'text',
      id: genBlockId(),
      content: '',
    };
    appendBlock(task.id, newBlock);
    // 自动聚焦到新文本块
    setTimeout(() => {
      const cards = containerRef.current?.querySelectorAll('.tb-content');
      const last = cards?.[cards.length - 1] as HTMLElement | undefined;
      last?.focus();
    }, 100);
  }, [appendBlock, task.id]);

  // ── Slash 命令 ──

  const handleSlashSelect = useCallback(
    (key: string) => {
      if (!slashMenu) return;
      const { blockId } = slashMenu;
      setSlashMenu(null);
      
      const currentBlocks = useTimelineStore.getState().tasks.find(t => t.id === task.id)?.blocks ?? [];
      const blockIndex = currentBlocks.findIndex(b => b.id === blockId);
      if (blockIndex === -1) return;

      const newBlocks = [...currentBlocks];
      const targetBlock = { ...newBlocks[blockIndex] };
      newBlocks[blockIndex] = targetBlock;

      if (targetBlock.type === 'text') {
        const textBlock = targetBlock as TextBlock;
        // Attempt to remove the trailing slash that triggered the menu
        textBlock.content = textBlock.content.replace(/\/$/, '');
      }

      if (key === 'task') {
        const today = todayStr();
        const newBlock: SmartTaskBlock = {
          type: 'smart-task',
          id: genBlockId(),
          header: {
            title: '新任务',
            tag: '默认',
            tagColor: getTagColor('默认'),
            date: today,
            duration: 30,
            isCompleted: false,
          },
          body: '',
        };
        
        if (targetBlock.type === 'text' && !(targetBlock as TextBlock).content.trim()) {
           newBlocks[blockIndex] = newBlock;
        } else {
           newBlocks.splice(blockIndex + 1, 0, newBlock);
        }
      } else if (key === 'text') {
        const newBlock: TextBlock = {
          type: 'text',
          id: genBlockId(),
          content: '',
        };
        newBlocks.splice(blockIndex + 1, 0, newBlock);
        
        setTimeout(() => {
          const cards = containerRef.current?.querySelectorAll('.tb-content');
          const last = cards?.[cards.length - 1] as HTMLElement | undefined;
          last?.focus();
        }, 100);
      }

      updateTaskBlocks(task.id, newBlocks);
    },
    [task.id, updateTaskBlocks, slashMenu],
  );

  const handleSlashCommandTrigger = useCallback((rect: { top: number; left: number }, blockId: string) => {
    setSlashMenu({ position: rect, blockId });
  }, []);

  // ── ESC 关闭 ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable) return;
        if (isFullscreen) {
          setIsFullscreen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, isFullscreen]);

  // ── 元信息即时更新 ──
  const handleUpdateTask = useCallback(
    (patch: Partial<Task>) => {
      if (onUpdateTask) onUpdateTask(task.id, patch);
    },
    [task.id, onUpdateTask],
  );

  return (
    <aside className={`pdv-container ${isFullscreen ? 'pdv-container--fullscreen' : ''} ${groupDimension === 'node' ? 'pdv-container--node' : ''}`} ref={containerRef}>
      {/* ── 顶部导航栏 ── */}
      <header className="pdv-header">
        <button type="button" className="pdv-back" onClick={onClose}>
          <ArrowLeft size={18} />
        </button>
        <h2 className="pdv-title" onClick={() => setMetaExpanded(!metaExpanded)} title={currentTask.name}>
          <span className="pdv-title-text">{currentTask.name}</span>
          <span className={`pdv-caret ${metaExpanded ? 'pdv-caret--open' : ''}`}>▾</span>
        </h2>
        <div className="pdv-header-actions">
          {smartBlocks.length > 0 && (
            <div
              className="pdv-group-toggle"
              title={groupDimension === 'node' ? '按时间分组' : '按节点分组'}
            >
              <span 
                className={`pdv-group-toggle-opt ${groupDimension === 'time' ? 'pdv-group-toggle-opt--active' : ''}`}
                onClick={() => setGroupDimension('time')}
              >
                📅
              </span>
              <span 
                className={`pdv-group-toggle-opt ${groupDimension === 'node' ? 'pdv-group-toggle-opt--active' : ''}`}
                onClick={() => setGroupDimension('node')}
              >
                🕸️
              </span>
            </div>
          )}
          {smartBlocks.length > 0 && groupDimension === 'time' && (
            <div
              className={`pdv-group-toggle ${groupByWeek ? 'pdv-group-toggle--week' : ''}`}
              onClick={() => setGroupByWeek(prev => !prev)}
              title={groupByWeek ? '按日分组' : '按周分组'}
            >
              <span className={`pdv-group-toggle-opt ${!groupByWeek ? 'pdv-group-toggle-opt--active' : ''}`}>日</span>
              <span className={`pdv-group-toggle-opt ${groupByWeek ? 'pdv-group-toggle-opt--active' : ''}`}>周</span>
            </div>
          )}
          <button
            type="button"
            className="pdv-btn"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? "退出全屏" : "全屏显示"}
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>

          <div className="pdv-expand-toggle">
            <button
              type="button"
              className="pdv-btn"
              onClick={() => setShowExpandMenu(!showExpandMenu)}
              title="更多操作"
            >
              <MoreHorizontal size={16} />
            </button>
            {showExpandMenu && (
              <div className="pdv-expand-menu pdv-more-menu">
                {smartBlocks.length > 0 && (
                  <>
                    <div className="pdv-menu-group-title">展开控制</div>
                    <button
                      type="button"
                      className={`pdv-expand-option ${expandAll === null ? 'pdv-expand-option--active' : ''}`}
                      onClick={() => { setExpandAll(null); setShowExpandMenu(false); }}
                    >
                      默认展开
                    </button>
                    <button
                      type="button"
                      className={`pdv-expand-option ${expandAll === true ? 'pdv-expand-option--active' : ''}`}
                      onClick={() => { setExpandAll(true); setShowExpandMenu(false); }}
                    >
                      全部展开
                    </button>
                    <button
                      type="button"
                      className={`pdv-expand-option ${expandAll === false ? 'pdv-expand-option--active' : ''}`}
                      onClick={() => { setExpandAll(false); setShowExpandMenu(false); }}
                    >
                      全部折叠
                    </button>
                    <div className="pdv-menu-divider" />
                  </>
                )}
                
                <button
                  type="button"
                  className="pdv-expand-option pdv-expand-option--icon"
                  onClick={() => { setShowBatchImport(true); setShowExpandMenu(false); }}
                >
                  <FileSpreadsheet size={14} /> 批量导入
                </button>
                <button
                  type="button"
                  className="pdv-expand-option pdv-expand-option--icon"
                  onClick={() => { setShowBatchEdit(true); setShowExpandMenu(false); }}
                >
                  <ListTree size={14} /> 批量编辑
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="pdv-btn pdv-btn--primary"
            onClick={handleAddTaskBlock}
            title="添加任务块"
          >
            <Plus size={16} />
          </button>
        </div>
      </header>

      {/* ── 元信息折叠区 ── */}
      {metaExpanded && (
        <div className="pdv-meta-panel">
          <div className="pdv-meta-row">
            <Calendar size={14} />
            <span>{currentTask.start} ~ {currentTask.end}</span>
            <span className="pdv-meta-chip">
              <Clock size={12} /> {diffDays(currentTask.end, currentTask.start) + 1} 天
            </span>
          </div>
          <TaskMetaEditor
            task={currentTask}
            onUpdate={handleUpdateTask}
            onDelete={onDeleteTask}
          />
        </div>
      )}

      {/* ── 进度统计条 ── */}
      {progress.total > 0 && (
        <div className="pdv-progress">
          <div className="pdv-progress-bar">
            <div
              className="pdv-progress-fill"
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
          </div>
          <span className="pdv-progress-text">
            {progress.done}/{progress.total} 完成 · {totalDuration}min 总时长
          </span>
        </div>
      )}

      {/* ── 快速过滤器 ── */}
      {smartBlocks.length > 0 && (
        <div className="pdv-filter-bar">
          <button
            type="button"
            className={`pdv-filter-pill ${hideCompleted ? 'pdv-filter-pill--active' : ''}`}
            onClick={() => setHideCompleted(v => !v)}
          >
            ✅ 隐藏已完成
          </button>
          {uniqueTags.map(({ name, color }) => (
            <button
              key={name}
              type="button"
              className={`pdv-filter-pill ${activeTag === name ? 'pdv-filter-pill--active' : ''}`}
              onClick={() => setActiveTag(v => v === name ? null : name)}
            >
              <span className="pdv-filter-dot" style={{ background: color }} />
              {name}
            </button>
          ))}
          <button
            type="button"
            className={`pdv-filter-pill ${todayOnly ? 'pdv-filter-pill--active' : ''}`}
            onClick={() => setTodayOnly(v => !v)}
          >
            📅 只看今日
          </button>
        </div>
      )}

      {/* ── 文档主体：按日期分组 + 粘性表头 ── */}
      <div className="pdv-body">
        {sortedBlocks.length === 0 ? (
          <div className="pdv-empty">
            <div className="pdv-empty-icon">📝</div>
            <div className="pdv-empty-text">
              这是一个空白文档。输入 <code>/</code> 触发命令，或点击上方按钮添加内容。
            </div>
          </div>
        ) : filteredSmartBlocks.length === 0 ? (
          <div className="pdv-empty">
            <div className="pdv-empty-icon">🔍</div>
            <div className="pdv-empty-text">
              当前筛选条件下没有匹配的任务，试试调整过滤条件。
            </div>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="pdv-layout-content">
              {/* 无日期的 text 块 */}
              {groupedByDate.textBlocks.length > 0 && (
                <div className="pdv-text-blocks">
                  {groupedByDate.textBlocks.map((block) => (
                    <TextBlockCard
                      key={block.id}
                      block={block}
                      onUpdate={handleUpdateTextBlock}
                      onDelete={handleDeleteBlock}
                      onSlashCommand={handleSlashCommandTrigger}
                    />
                  ))}
                </div>
              )}

              {/* 日期/周分组 */}
              {groupedByDate.groups.length > 0 && (
                <div className="pdv-kanban-board">
                  {groupedByDate.groups.map((group) => {
                    const isCollapsed = collapsedDates.has(group.key);
                    const duration = group.blocks.reduce((s, b) => s + b.header.duration, 0);
                    const doneCount = group.blocks.filter(b => b.header.isCompleted).length;
                    const today = todayStr();
                    const isToday = groupByWeek
                      ? getMondayOfWeek(today) === group.key
                      : group.key === today;
                    return (
                      <div key={group.key} className="pdv-date-group">
                        <div
                          className={`pdv-date-header ${isToday ? 'pdv-date-header--today' : ''} ${groupByWeek ? 'pdv-date-header--week' : ''}`}
                          onClick={() => toggleDateCollapse(group.key)}
                        >
                          <span className="pdv-date-chevron">
                            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          </span>
                          <span className="pdv-date-icon">{group.icon || (groupByWeek ? '🗓️' : '📅')}</span>
                          <span className="pdv-date-label">{group.label}</span>
                          {group.subLabel && (
                            <span className="pdv-date-sublabel">{group.subLabel}</span>
                          )}
                          <span className="pdv-date-summary">
                            {group.blocks.length}项任务{doneCount > 0 ? `，${doneCount}项已完成` : ''}
                            {duration > 0 ? `，共 ${duration} min` : ''}
                          </span>
                        </div>
                        {!isCollapsed && (
                          <Droppable droppableId={group.key}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.droppableProps}
                                className={`pdv-date-tasks ${snapshot.isDraggingOver ? 'pdv-date-tasks--drag-over' : ''}`}
                              >
                                {group.blocks.map((block, idx) => (
                                  <Draggable
                                    key={block.id}
                                    draggableId={`block-${block.id}`}
                                    index={idx}
                                  >
                                    {(provided, snapshot) => (
                                      <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                        className={snapshot.isDragging ? 'pdv-drag-item--dragging' : ''}
                                      >
                                        <SmartTaskBlockCard
                                          block={block}
                                          onUpdateHeader={handleUpdateHeader}
                                          onUpdateBody={handleUpdateBody}
                                          onDelete={handleDeleteBlock}
                                          expandOverride={expandAll}
                                        />
                                      </div>
                                    )}
                                  </Draggable>
                                ))}
                                {provided.placeholder}
                              </div>
                            )}
                          </Droppable>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </DragDropContext>
        )}
        
        {/* 点击底部空白区域自动添加文本块 */}
        <div 
          className="pdv-body-pad" 
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleAddTextBlock();
            }
          }}
          style={{ flex: 1, minHeight: '60px', cursor: 'text' }}
        />
      </div>

      {/* ── Slash 命令菜单 ── */}
      {slashMenu && createPortal(
        <SlashCommandMenu
          position={slashMenu.position}
          onSelect={handleSlashSelect}
          onClose={() => setSlashMenu(null)}
        />,
        document.body,
      )}

      {/* ── 批量导入对话框（绑定当前项目，blocks 直接追加） ── */}
      {showBatchImport && createPortal(
        <BatchImportDialog
          fixedTask={currentTask}
          onClose={() => setShowBatchImport(false)}
          onConfirm={handleBatchImportConfirm}
        />,
        document.body,
      )}

      {/* ── 批量编辑对话框 ── */}
      {showBatchEdit && createPortal(
        <BatchEditDialog
          task={currentTask}
          initialBlocks={smartBlocks}
          onClose={() => setShowBatchEdit(false)}
          onConfirm={handleBatchEditConfirm}
        />,
        document.body,
      )}
    </aside>
  );
};

export default ProjectDocumentView;
