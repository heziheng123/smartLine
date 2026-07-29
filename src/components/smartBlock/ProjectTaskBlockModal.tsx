import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArchiveRestore, ArrowUpRight, Hash, CalendarDays, Clock3, FolderOpen, Layers3, ListTodo, RotateCcw, Tag, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '@/store';
import { SmartTaskBlockCard } from './SmartTaskBlockCard';
import { PROJECT_TASK_MODAL_EVENT, type ProjectTaskModalDetail } from './projectTaskModal';
import { getQuantityCompleted, getQuantityTotal, getQuantityUnit, getTaskEstimatedMinutes, getValidGraphNodeIds, isQuantityTask } from '@/utils/blocks';
import { formatDate } from '@/utils/dateSafe';
import { deleteProjectTask, updateProjectTask } from '@/services/projectTaskCommands';
import { returnProjectTaskToBacklog } from '@/services/backlogCommands';
import { useOperationHistory } from '@/services/operationHistory';

const ProjectTaskBlockModal: React.FC = () => {
  const [target, setTarget] = useState<ProjectTaskModalDetail | null>(null);
  const [backlogNotice, setBacklogNotice] = useState<{ text: string; operationId?: string } | null>(null);
  const undoOperation = useOperationHistory((state) => state.undo);
  const { tasks, groups, updateBlockBody } = useTimelineStore(
    useShallow((state) => ({
      tasks: state.tasks,
      groups: state.groups,
      updateBlockBody: state.updateBlockBody,
    })),
  );

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<ProjectTaskModalDetail>).detail;
      if (detail?.taskId && detail?.blockId) {
        setBacklogNotice(null);
        setTarget(detail);
      }
    };
    const handleNavigate = () => setTarget(null);
    window.addEventListener(PROJECT_TASK_MODAL_EVENT, handleOpen);
    window.addEventListener('tl-navigate', handleNavigate);
    return () => {
      window.removeEventListener(PROJECT_TASK_MODAL_EVENT, handleOpen);
      window.removeEventListener('tl-navigate', handleNavigate);
    };
  }, []);

  const task = useMemo(() => {
    if (!target) return null;
    return tasks.find((item) => item.id === target.taskId)
      ?? groups.flatMap((group) => group.children).find((item) => item.id === target.taskId)
      ?? null;
  }, [groups, target, tasks]);

  const block = useMemo(() => {
    if (!task || !target) return null;
    const candidate = task.blocks?.find((item) => item.id === target.blockId);
    return candidate?.type === 'smart-task' ? candidate : null;
  }, [target, task]);

  const close = useCallback(() => setTarget(null), []);
  const updateHeader = useCallback((blockId: string, patch: Parameters<typeof updateProjectTask>[2]) => {
    updateProjectTask(task!.id, blockId, patch);
  }, [task]);

  useEffect(() => {
    if (!target) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [close, target]);

  useEffect(() => {
    if (target && (!task || !block)) close();
  }, [block, close, target, task]);

  if (!target || !task || !block) return null;

  const sourceLabels: Record<NonNullable<ProjectTaskModalDetail['source']>, string> = {
    'daily-schedule': '每日安排',
    'week-matrix': '周矩阵',
    'time-block': '时间块',
    icebox: '待排期箱',
    project: '项目文档',
  };
  const quantity = isQuantityTask(block.header);
  const graphNodeCount = getValidGraphNodeIds(block.header).length;

  const openInProject = () => {
    window.dispatchEvent(new CustomEvent('tl-navigate', {
      detail: { view: 'timeline', taskId: task.id, blockId: block.id },
    }));
  };

  const openInDailySchedule = () => {
    try {
      if (block.header.date) {
        sessionStorage.setItem('smart-line-daily-target-date', block.header.date);
      } else {
        sessionStorage.removeItem('smart-line-daily-target-date');
      }
    } catch {
      // Navigation still works when session storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent('tl-navigate', { detail: { view: 'daily-schedule' } }));
  };

  const moveToBacklog = () => {
    const result = returnProjectTaskToBacklog(task.id, block.id);
    setBacklogNotice('error' in result
      ? { text: result.error }
      : {
          text: `已将“${result.title}”移回待排期箱，其他任务信息保持不变`,
          operationId: result.operationId,
        });
  };

  const undoMoveToBacklog = async () => {
    if (!backlogNotice?.operationId) return;
    const restored = await undoOperation(backlogNotice.operationId);
    setBacklogNotice({
      text: restored ? '已撤销，任务已恢复到原排期和每日安排' : '撤销失败，任务数据可能已经发生变化',
    });
  };

  return createPortal(
    <div className="ptm-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="ptm-dialog" role="dialog" aria-modal="true" aria-labelledby="ptm-title">
        <header className="ptm-header">
          <div className="ptm-heading">
            <div id="ptm-title" className="ptm-title">任务详情</div>
            <div className="ptm-project"><FolderOpen size={13} />{task.name}{target.source ? <span>· 来源：{sourceLabels[target.source]}</span> : null}</div>
          </div>
          <button type="button" className="ptm-close" onClick={close} aria-label="关闭任务详情"><X size={18} /></button>
        </header>
        <div className="ptm-body">
          <div className="ptm-context-grid" aria-label="任务上下文">
            <div>
              <CalendarDays size={14} />
              <span>{quantity ? '开始日期' : '计划日期'}</span>
              <strong>{block.header.date ? formatDate(block.header.date, 'M月D日') : (quantity ? '需要设置' : '未排期')}</strong>
            </div>
            <div><Tag size={14} /><span>标签</span><strong>{block.header.tag || '未分类'}</strong></div>
            <div>{quantity ? <Hash size={14} /> : <Clock3 size={14} />}<span>{quantity ? '数量进度' : '预计时长'}</span><strong>{quantity ? `${getQuantityCompleted(block.header)}/${getQuantityTotal(block.header)} ${getQuantityUnit(block.header)}` : `${getTaskEstimatedMinutes(block.header)} 分钟`}</strong></div>
            {quantity && <div><Clock3 size={14} /><span>每日预计投入</span><strong>{getTaskEstimatedMinutes(block.header)} 分钟</strong></div>}
            <div><Layers3 size={14} /><span>知识关联</span><strong>{graphNodeCount > 0 ? `${graphNodeCount} 个节点` : '未绑定'}</strong></div>
          </div>
          <SmartTaskBlockCard
            parentTaskId={task.id}
            block={block}
            expandOverride
            onUpdateHeader={updateHeader}
            onUpdateBody={(blockId, body) => updateBlockBody(task.id, blockId, body)}
            onDelete={(blockId) => {
              const result = deleteProjectTask(task.id, blockId);
              if (result.ok) close();
            }}
          />
          {backlogNotice && (
            <div className="ptm-backlog-notice" role="status" aria-live="polite">
              <span>{backlogNotice.text}</span>
              {backlogNotice.operationId && (
                <button type="button" onClick={() => void undoMoveToBacklog()}>
                  <RotateCcw size={13} />撤销
                </button>
              )}
            </div>
          )}
          <p className="ptm-date-change-hint">修改名称、日期、标签或进度后，项目文档、周矩阵和每日安排会读取同一份任务数据。</p>
        </div>
        <footer className="ptm-footer">
          <div className="ptm-footer-context"><ListTodo size={14} /><span>{quantity ? '数量任务通过每日完成量推进总进度，不记录时长' : '完成状态会同步更新项目、日程、复习和知识节点'}</span></div>
          <div className="ptm-footer-actions">
            {block.header.date && !quantity && !block.header.isCompleted && (
              <button type="button" className="ptm-backlog-btn" onClick={moveToBacklog}>
                <ArchiveRestore size={14} />移回待排期箱
              </button>
            )}
            <button type="button" className="ptm-nav-btn" onClick={openInProject}><ArrowUpRight size={14} />在项目中定位</button>
            <button type="button" className="ptm-nav-btn" onClick={openInDailySchedule}><CalendarDays size={14} />查看每日安排</button>
            <button type="button" className="ptm-done-btn" onClick={close}>完成</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
};

export default ProjectTaskBlockModal;
