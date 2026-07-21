import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Hash, CalendarDays, Clock3, FolderOpen, Layers3, ListTodo, Paperclip, Tag, Trash2, Upload, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '@/store';
import { SmartTaskBlockCard } from './SmartTaskBlockCard';
import { PROJECT_TASK_MODAL_EVENT, type ProjectTaskModalDetail } from './projectTaskModal';
import { getQuantityCompleted, getQuantityTotal, getQuantityUnit, getValidGraphNodeIds, isQuantityTask } from '@/utils/blocks';
import { formatDate } from '@/utils/dateSafe';
import { attachmentUrl, deleteAttachment, uploadAttachment } from '@/services/attachments';

const ProjectTaskBlockModal: React.FC = () => {
  const [target, setTarget] = useState<ProjectTaskModalDetail | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentMessage, setAttachmentMessage] = useState('');
  const attachmentInputRef = useRef<HTMLInputElement>(null);
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

  const sourceLabels: Record<NonNullable<ProjectTaskModalDetail['source']>, string> = {
    'daily-schedule': '每日安排',
    'task-overview': '任务总览',
    'week-matrix': '周矩阵',
    'time-block': '时间块',
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
      sessionStorage.setItem('smart-line-daily-target-date', block.header.date);
    } catch {
      // Navigation still works when session storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent('tl-navigate', { detail: { view: 'daily-schedule' } }));
  };

  const handleAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAttachmentBusy(true);
    setAttachmentMessage('');
    try {
      const reference = await uploadAttachment(file);
      updateHeader(block.id, { attachments: [...(block.header.attachments ?? []), reference] });
      setAttachmentMessage('附件已安全保存到R2，任务中仅记录引用。');
    } catch (error) {
      setAttachmentMessage(error instanceof Error ? error.message : '附件上传失败。');
    } finally {
      setAttachmentBusy(false);
    }
  };

  const handleDeleteAttachment = async (id: string) => {
    setAttachmentBusy(true);
    try {
      await deleteAttachment({ id });
      updateHeader(block.id, { attachments: (block.header.attachments ?? []).filter((item) => item.id !== id) });
      setAttachmentMessage('附件已删除。');
    } catch (error) {
      setAttachmentMessage(error instanceof Error ? error.message : '附件删除失败。');
    } finally {
      setAttachmentBusy(false);
    }
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
            <div><CalendarDays size={14} /><span>计划日期</span><strong>{formatDate(block.header.date, 'M月D日')}</strong></div>
            <div><Tag size={14} /><span>标签</span><strong>{block.header.tag || '未分类'}</strong></div>
            <div>{quantity ? <Hash size={14} /> : <Clock3 size={14} />}<span>{quantity ? '数量进度' : '预计时长'}</span><strong>{quantity ? `${getQuantityCompleted(block.header)}/${getQuantityTotal(block.header)} ${getQuantityUnit(block.header)}` : `${block.header.duration} 分钟`}</strong></div>
            <div><Layers3 size={14} /><span>知识关联</span><strong>{graphNodeCount > 0 ? `${graphNodeCount} 个节点` : '未绑定'}</strong></div>
          </div>
          <SmartTaskBlockCard
            parentTaskId={task.id}
            block={block}
            expandOverride
            onUpdateHeader={updateHeader}
            onUpdateBody={(blockId, body) => updateBlockBody(task.id, blockId, body)}
            onDelete={(blockId) => { removeBlock(task.id, blockId); close(); }}
          />
          <section className="ptm-attachments" aria-label="任务附件">
            <div className="ptm-attachments-head"><strong><Paperclip size={14} />附件</strong><button type="button" className="ptm-nav-btn" disabled={attachmentBusy} onClick={() => attachmentInputRef.current?.click()}><Upload size={14} />上传附件</button></div>
            {(block.header.attachments ?? []).map((attachment) => (
              <div className="ptm-attachment-row" key={attachment.id}>
                <a href={attachmentUrl(attachment)} target="_blank" rel="noreferrer">{attachment.name}</a>
                <span>{Math.max(1, Math.round(attachment.size / 1024))} KB</span>
                <button type="button" aria-label={`删除${attachment.name}`} disabled={attachmentBusy} onClick={() => void handleDeleteAttachment(attachment.id)}><Trash2 size={14} /></button>
              </div>
            ))}
            {(block.header.attachments ?? []).length === 0 && <p>暂无附件。绑定R2后可上传图片或资料。</p>}
            {attachmentMessage && <p role="status">{attachmentMessage}</p>}
            <input ref={attachmentInputRef} type="file" hidden onChange={(event) => void handleAttachment(event)} />
          </section>
          <p className="ptm-date-change-hint">修改名称、日期、标签或进度后，项目文档、任务总览、周矩阵和每日安排会读取同一份任务数据。</p>
        </div>
        <footer className="ptm-footer">
          <div className="ptm-footer-context"><ListTodo size={14} /><span>{quantity ? '数量任务通过每日完成量推进总进度，不记录时长' : '完成状态会同步关联模块并进入统一撤销记录'}</span></div>
          <div className="ptm-footer-actions">
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
