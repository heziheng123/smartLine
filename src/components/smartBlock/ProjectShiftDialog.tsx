import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [days, setDays] = useState(1);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const allPreviewState = useMemo(() => {
    try {
      return { preview: previewProjectShift(taskId, days), error: '' };
    } catch (cause) {
      return { preview: null, error: cause instanceof Error ? cause.message : '无法读取项目任务' };
    }
  }, [days, taskId]);
  const candidates = allPreviewState.preview?.project.tasks ?? [];
  const selected = selectedBlockIds ?? candidates.map((task) => task.blockId);
  const previewState = useMemo(() => {
    try {
      return { preview: previewProjectShift(taskId, days, selected), error: '' };
    } catch (cause) {
      return { preview: null, error: cause instanceof Error ? cause.message : '无法生成调整预览' };
    }
  }, [days, selected, taskId]);
  const preview = previewState.preview;
  const deadlineRisks = preview?.project.tasks.filter((task) => task.exceedsDeadline) ?? [];
  const movedDailyCount = preview
    ? preview.daily.movedSlotItems + preview.daily.movedTimeBlocks + preview.daily.collisionFallbacks
    : 0;
  const allSelected = candidates.length > 0 && selected.length === candidates.length;

  const changeDays = (value: number) => {
    setDays(value || 1);
    setError('');
  };

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
    const result = shiftProjectSchedule(taskId, days, selected);
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
                  value={days}
                  aria-label="自定义调整天数"
                  onChange={(event) => changeDays(Math.max(-365, Math.min(365, Math.trunc(Number(event.target.value) || 1))))}
                />
                天
              </label>
            </div>
          </section>

          <section className="psd-task-section" aria-label="选择要调整的任务">
            <div className="psd-task-section-header">
              <div><strong>选择任务</strong><small>已选 {selected.length} / {candidates.length} 个可调整任务</small></div>
              <button type="button" onClick={toggleAll} disabled={candidates.length === 0}>{allSelected ? '取消全选' : '全选'}</button>
            </div>
            {candidates.length === 0 ? (
              <p className="psd-empty">没有可调整的任务。已完成、未排期及数量任务会保留原状。</p>
            ) : (
              <div className="psd-task-list">
                {candidates.map((task) => {
                  const checked = selected.includes(task.blockId);
                  const next = preview?.project.tasks.find((item) => item.blockId === task.blockId);
                  return <label key={task.blockId} className={checked ? 'is-selected' : ''}>
                    <input type="checkbox" checked={checked} onChange={() => toggleTask(task.blockId)} />
                    <span><strong>{task.title}</strong><small>{task.fromDate} → {next?.toDate ?? task.toDate}</small></span>
                    {next?.exceedsDeadline && <em>超过截止 {next.deadline}</em>}
                  </label>;
                })}
              </div>
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
          {(error || allPreviewState.error || previewState.error) && <div className="psd-error" role="alert">{error || allPreviewState.error || previewState.error}</div>}
        </div>

        <footer className="psd-footer">
          <span>确认后可立即撤销本次调整</span>
          <div>
            <button type="button" onClick={onClose}>取消</button>
            <button type="button" className="is-primary" disabled={!preview || selected.length === 0} onClick={apply}>确认{actionLabel(days)}</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
};

export default ProjectShiftDialog;
