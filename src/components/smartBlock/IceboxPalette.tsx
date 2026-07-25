import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArchiveRestore, Inbox, X } from 'lucide-react';
import { useTimelineStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { collectBacklogTasks, type BacklogTask } from '@/domain/taskBacklog';
import { openProjectTaskModal } from './projectTaskModal';
import BacklogTaskList from './BacklogTaskList';
import { rescheduleProjectTask } from '@/services/projectTaskCommands';
import { returnProjectTaskToBacklog } from '@/services/backlogCommands';
import { useOperationHistory } from '@/services/operationHistory';
import type { SmartBlockDragPayload } from '@/types';
import styles from './IceboxPalette.module.css';
import { getUniqueTasks } from '@/store/timelineData';

interface IceboxPaletteProps {
  layout?: 'overlay' | 'docked';
}

interface PaletteMessage {
  text: string;
  operationId?: string;
}

export const IceboxPalette: React.FC<IceboxPaletteProps> = ({ layout = 'overlay' }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [message, setMessage] = useState<PaletteMessage | null>(null);
  const undoOperation = useOperationHistory((state) => state.undo);
  const { tasks, groups } = useTimelineStore(
    useShallow((state) => ({ tasks: state.tasks, groups: state.groups })),
  );

  const allTasks = useMemo(() => {
    return getUniqueTasks(tasks, groups);
  }, [groups, tasks]);
  const backlogTasks = useMemo(() => collectBacklogTasks(allTasks), [allTasks]);

  const scheduleTask = async (task: BacklogTask, date: string): Promise<boolean> => {
    const result = rescheduleProjectTask(task.taskId, task.blockId, date);
    if ('error' in result) {
      setMessage({ text: result.error });
      return false;
    }
    setMessage({ text: `已将“${task.title}”安排到 ${date}` });
    return true;
  };

  const handleDropToBacklog = (event: React.DragEvent) => {
    event.preventDefault();
    setDropActive(false);
    try {
      const raw = event.dataTransfer.getData('application/json');
      if (!raw) return;
      const payload = JSON.parse(raw) as SmartBlockDragPayload;
      if (payload.type !== 'smart-block' || !payload.fromDate) return;
      const result = returnProjectTaskToBacklog(payload.taskId, payload.blockId);
      setMessage('error' in result
        ? { text: result.error }
        : {
            text: `已将“${result.title}”移回待排期箱`,
            operationId: result.operationId,
          });
      setIsExpanded(true);
    } catch {
      setMessage({ text: '无法识别拖入的任务' });
    }
  };

  const handleUndo = async () => {
    if (!message?.operationId) return;
    const restored = await undoOperation(message.operationId);
    setMessage({
      text: restored ? '已撤销，任务已恢复到原排期' : '撤销失败，任务数据可能已经发生变化',
    });
  };

  return (
    <div
      data-backlog-dock={layout === 'docked' ? 'true' : undefined}
      data-expanded={isExpanded ? 'true' : 'false'}
      className={`${styles.paletteContainer} ${
        layout === 'docked' ? styles.paletteContainerDocked : ''
      } ${isExpanded ? styles.paletteContainerExpanded : ''} ${
        dropActive ? styles.paletteDropActive : ''
      }`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/json')) {
          event.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false);
      }}
      onDrop={handleDropToBacklog}
    >
      <AnimatePresence>
        {isExpanded && (
          <motion.section
            className={styles.panel}
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            aria-label="待排期任务箱"
          >
            <header className={styles.panelHeader}>
              <div className={styles.panelTitle}>
                <Inbox size={16} />
                待排期箱
                <span className={styles.panelCount}>{backlogTasks.length}</span>
              </div>
              <button
                className={styles.panelClose}
                onClick={() => setIsExpanded(false)}
                onPointerDownCapture={(event) => event.stopPropagation()}
                type="button"
                aria-label="关闭待排期箱"
              >
                <X size={16} />
              </button>
            </header>
            {message && (
              <div className={styles.message} role="status" aria-live="polite">
                <span>{message.text}</span>
                {message.operationId && (
                  <button type="button" onClick={() => void handleUndo()}>撤销</button>
                )}
                <button type="button" onClick={() => setMessage(null)} aria-label="关闭提示">×</button>
              </div>
            )}
            <div className={styles.panelBody} onPointerDownCapture={(event) => event.stopPropagation()}>
              <BacklogTaskList
                tasks={backlogTasks}
                onSchedule={scheduleTask}
                onOpenTask={(task) => openProjectTaskModal(task.taskId, task.blockId, { source: 'task-overview' })}
              />
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        className={`${styles.capsule} ${isExpanded ? styles.capsuleActive : ''}`}
        onClick={() => setIsExpanded((value) => !value)}
        whileTap={{ scale: 0.97 }}
        aria-expanded={isExpanded}
        aria-label={`待排期箱，${backlogTasks.length} 个任务`}
      >
        {dropActive ? <ArchiveRestore size={15} /> : <Inbox size={15} />}
        <span>{dropActive ? '松开移回任务箱' : '待排期箱'}</span>
        <strong className={styles.capsuleCount}>{backlogTasks.length}</strong>
      </motion.button>
    </div>
  );
};
