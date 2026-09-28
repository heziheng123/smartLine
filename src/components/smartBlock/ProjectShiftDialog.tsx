import React, { useDeferredValue, useMemo, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { AlertTriangle, CalendarRange, Clock3, X } from 'lucide-react';
import { previewProjectShift, shiftProjectSchedule } from '@/services/projectShiftCommands';

interface ProjectShiftDialogProps {
  taskId: string;
  taskName: string;
  onClose: () => void;
  onApplied: (result: { text: string; operationId: string }) => void;
}

const actionLabel = (days: number) => days > 0 ? `顺延 ${days} 天` : `提前 ${Math.abs(days)} 天`;

const ProjectShiftDialog: React.FC<ProjectShiftDialogProps> = ({ taskId, taskName, onClose, onApplied }) => {
  const [daysInput, setDaysInput] = useState('1');
  const [days, setDays] = useState(1);
  const [isPending, startTransition] = useTransition();
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const listParentRef = useRef<HTMLDivElement>(null);
  // 天数输入防抖：输入不堵，预览在 transition 中计算
  const changeDays = (value: number) => {
    const clamped = Number.isFinite(value) ? Math.max(-365, Math.min(365, Math.trunc(value))) : 1;
    setDaysInput(String(clamped || 1));
    setError('');
    startTransition(() => setDays(clamped || 1));
  };
  // 全量候选只算一次骨架（selected==null 时复用为预览，避免双重全量计算）
  const basePreviewState = useMemo(() => {
    try {
      return { preview: previewProjectShift(taskId, days), error: '' };
    } catch (cause) {
      return { preview: null, error: cause instanceof Error ? cause.message : '无法读取项目任务' };
    }
  }, [days, taskId]);
  const candidates = useMemo(() => basePreviewState.preview?.project.tasks ?? [], [basePreviewState]);
  const selectedSet = useMemo(
    () => new Set(selectedBlockIds ?? candidates.map((task) => task.blockId)),
    [selectedBlockIds, candidates],
  );
  const selectedIds = useMemo(() => [...selectedSet], [selectedSet]);
  const selected = useDeferredValue(selectedIds);
  const previewPending = selected !== selectedIds || isPending;
  const previewState = useMemo(() => {
    if (selectedBlockIds === null) return basePreviewState;
    try {
      return { preview: previewProjectShift(taskId, days, selected), error: '' };
    } catch (cause) {
      return { preview: null, error: cause instanceof Error ? cause.message : '无法生成调整预览' };
    }
  }, [basePreviewState, days, selected, selectedBlockIds, taskId]);
  const preview = previewState.preview;
  // O(1) 查表替代渲染期 find
  const nextByBlockId = useMemo(() => {
    const map = new Map<string, (typeof candidates)[number]>();
    for (const item of preview?.project.tasks ?? []) map.set(item.blockId, item);
    return map;
  }, [preview]);
  const selectedCount = selectedSet.size;
  const deadlineRisks = preview?.project.tasks.filter((task) => task.exceedsDeadline) ?? [];
  const movedDailyCount = preview
    ? preview.daily.movedSlotItems + preview.daily.movedTimeBlocks + preview.daily.collisionFallbacks
    : 0;
  const allSelected = candidates.length > 0 && selectedCount === candidates.length;

  const toggleTask = (blockId: string) => {
    setSelectedBlockIds((current) => {
      const next = new Set(current ?? candidates.map((task) => task.blockId));
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return [...next];
    });
  };

  const toggleAll = () => setSelectedBlockIds(allSelected ? [] : candidates.map((task) => task.blockId));

  const apply = () => {
    const result = shiftProjectSchedule(taskId, days, [...selectedSet]);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const collisions = result.preview.daily.collisionFallbacks;
    const action = days > 0 ? '顺延' : '提前';
    onApplied({
      text: `已${action} ${result.preview.project.tasks.length} 个任务和 ${result.preview.daily.movedSlotItems + result.preview.daily.movedTimeBlocks + collisions} 个每日安排${collisions > 0 ? `，${collisions} 个冲突时间块已放入时段` : ''}`,
      operationId: result.operationId,
    });
    onClose();
  };

  return createPortal(
    <div className="psd-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="psd-dialog" role="dialog" aria-modal="true" aria-label="批量调整排期">
        <header className="psd-header">
          <div>
            <span><CalendarRange size={15} />批量调整排期</span>
            <h2>{taskName}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭批量调整排期"><X size={18} /></button>
        </header>

        <div className="psd-body">
          <section className="psd-adjustment" aria-label="调整天数">
            <span>调整日期</span>
            <div className="psd-presets" role="group" aria-label="调整天数">
              {[-7, -3, -1, 1, 3, 7].map((value) => (
                <button type="button" key={value} className={days === value ? 'is-active' : ''} onClick={() => changeDays(value)}>
                  {actionLabel(value)}
                </button>
              ))}
              <label>
                自定义
                <input
                  type="number"
                  min={-365}
                  max={365}
                  value={daysInput}
                  aria-label="自定义调整天数"
                  onChange={(event) => {
                    setDaysInput(event.target.value);
                    changeDays(Number(event.target.value));
                  }}
                />
                天
              </label>
            </div>
          </section>

          <section className="psd-task-section" aria-label="选择要调整的任务">
            <div className="psd-task-section-header">
              <div><strong>选择任务</strong><small>已选 {selectedCount} / {candidates.length} 个可调整任务{previewPending ? ' · 预览更新中…' : ''}</small></div>
              <button type="button" onClick={toggleAll} disabled={candidates.length === 0}>{allSelected ? '取消全选' : '全选'}</button>
            </div>
            {candidates.length === 0 ? (
              <p className="psd-empty">没有可调整的任务。已完成、未排期及数量任务会保留原状。</p>
            ) : (
              <ShiftTaskList
                candidates={candidates}
                selectedSet={selectedSet}
                nextByBlockId={nextByBlockId}
                onToggle={toggleTask}
                listParentRef={listParentRef}
              />
            )}
          </section>

          {preview && (
            <>
              <div className="psd-summary" aria-label="批量调整预览">
                <div><strong>{preview.project.tasks.length}</strong><span>个任务将{days > 0 ? '顺延' : '提前'}</span></div>
                <div><strong>{movedDailyCount}</strong><span>个每日安排将移动</span></div>
                <div className={deadlineRisks.length > 0 ? 'is-warning' : ''}><strong>{deadlineRisks.length}</strong><span>个截止日期风险</span></div>
              </div>
              <div className="psd-note">
                <Clock3 size={15} />
                <span>{preview.project.projectRangeMoved ? '已选全部可调整任务，项目起止日期也会同步移动。' : '只会移动已选任务及其每日安排，项目起止日期保持不变。'}</span>
              </div>
              {preview.daily.collisionFallbacks > 0 && <div className="psd-warning"><AlertTriangle size={15} />{preview.daily.collisionFallbacks} 个时间块在新日期发生冲突，将保留在对应的上午、下午或晚上时段。</div>}
              {deadlineRisks.length > 0 && (
                <div className="psd-risk-list">
                  <strong><AlertTriangle size={15} />调整后晚于截止日期</strong>
                  {deadlineRisks.slice(0, 5).map((task) => <div key={task.blockId}><span>{task.title}</span><em>{task.toDate} ＞ {task.deadline}</em></div>)}
                  {deadlineRisks.length > 5 && <small>另有 {deadlineRisks.length - 5} 个任务</small>}
                </div>
              )}
            </>
          )}
          {(error || previewState.error) && <div className="psd-error" role="alert">{error || previewState.error}</div>}
        </div>

        <footer className="psd-footer">
          <span>确认后可立即撤销本次调整</span>
          <div>
            <button type="button" onClick={onClose}>取消</button>
            <button type="button" className="is-primary" disabled={!preview || previewPending || selectedCount === 0} onClick={apply}>确认{actionLabel(days)}</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
};

type ShiftCandidate = { blockId: string; title: string; fromDate: string; toDate: string };

function ShiftTaskList({ candidates, selectedSet, nextByBlockId, onToggle, listParentRef }: {
  candidates: ShiftCandidate[];
  selectedSet: Set<string>;
  nextByBlockId: Map<string, { toDate: string; deadline?: string; exceedsDeadline?: boolean }>;
  onToggle: (blockId: string) => void;
  listParentRef: React.RefObject<HTMLDivElement>;
}) {
  const rowVirtualizer = useVirtualizer({
    count: candidates.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 52,
    overscan: 8,
  });
  return (
    <div ref={listParentRef} className="psd-task-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const task = candidates[virtualRow.index];
          const checked = selectedSet.has(task.blockId);
          const next = nextByBlockId.get(task.blockId);
          return (
            <label
              key={task.blockId}
              className={checked ? 'is-selected' : ''}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
            >
              <input type="checkbox" checked={checked} onChange={() => onToggle(task.blockId)} />
              <span><strong>{task.title}</strong><small>{task.fromDate} → {next?.toDate ?? task.toDate}</small></span>
              {next?.exceedsDeadline && <em>超过截止 {next.deadline}</em>}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default ProjectShiftDialog;
