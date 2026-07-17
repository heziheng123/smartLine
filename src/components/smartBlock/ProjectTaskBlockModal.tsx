import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '@/store';
import { SmartTaskBlockCard } from './SmartTaskBlockCard';
import { PROJECT_TASK_MODAL_EVENT, type ProjectTaskModalDetail } from './projectTaskModal';

const ProjectTaskBlockModal: React.FC = () => {
  const [target, setTarget] = useState<ProjectTaskModalDetail | null>(null);
  const { tasks, groups, updateBlockHeader, updateBlockBody, removeBlock } = useTimelineStore(
    useShallow((state) => ({
      tasks: state.tasks,
      groups: state.groups,
      updateBlockHeader: state.updateBlockHeader,
      updateBlockBody: state.updateBlockBody,
      removeBlock: state.removeBlock,
    })),
  );

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<ProjectTaskModalDetail>).detail;
      if (detail?.taskId && detail?.blockId) setTarget(detail);
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
  const updateHeader = useCallback((blockId: string, patch: Parameters<typeof updateBlockHeader>[2]) => {
    updateBlockHeader(task!.id, blockId, patch);
  }, [task, updateBlockHeader]);

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

  return createPortal(
    <div className="ptm-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="ptm-dialog" role="dialog" aria-modal="true" aria-labelledby="ptm-title">
        <header className="ptm-header">
          <div className="ptm-heading">
            <div id="ptm-title" className="ptm-title">任务详情</div>
            <div className="ptm-project"><FolderOpen size={13} />所属项目：{task.name}</div>
          </div>
          <button type="button" className="ptm-close" onClick={close} aria-label="关闭任务详情"><X size={18} /></button>
        </header>
        <div className="ptm-body">
          <SmartTaskBlockCard
            parentTaskId={task.id}
            block={block}
            expandOverride
            onUpdateHeader={updateHeader}
            onUpdateBody={(blockId, body) => updateBlockBody(task.id, blockId, body)}
            onDelete={(blockId) => { removeBlock(task.id, blockId); close(); }}
          />
          <p className="ptm-date-change-hint">修改任务日期后，原每日安排会被取消；请在新日期重新安排执行时间。</p>
        </div>
        <footer className="ptm-footer">
          <span>标题、日期、时长和正文会同步到各任务视图，但不会调整已有 EBB 轮次日期。</span>
          <button type="button" onClick={close}>完成</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
};

export default ProjectTaskBlockModal;
