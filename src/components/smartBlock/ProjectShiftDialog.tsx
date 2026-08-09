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

const ProjectShiftDialog: React.FC<ProjectShiftDialogProps> = ({
  taskId,
  taskName,
  onClose,
  onApplied,
}) => {
  const [days, setDays] = useState(1);
  const [error, setError] = useState('');
  const previewState = useMemo(() => {
    try {
      return { preview: previewProjectShift(taskId, days), error: '' };
    } catch (cause) {
      return {
        preview: null,
        error: cause instanceof Error ? cause.message : '无法生成项目顺延预览',
      };
    }
  }, [days, taskId]);
  const preview = previewState.preview;
  const deadlineRisks = preview?.project.tasks.filter((task) => task.exceedsDeadline) ?? [];
  const movedDailyCount = preview
    ? preview.daily.movedSlotItems + preview.daily.movedTimeBlocks + preview.daily.collisionFallbacks
    : 0;

  const apply = () => {
    const result = shiftProjectSchedule(taskId, days);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const collisions = result.preview.daily.collisionFallbacks;
    onApplied({
      text: `已顺延 ${result.preview.project.tasks.length} 个任务和 ${result.preview.daily.movedSlotItems + result.preview.daily.movedTimeBlocks + collisions} 个每日安排${collisions > 0 ? `，${collisions} 个冲突时间块已放入时段` : ''}`,
      operationId: result.operationId,
    });
    onClose();
  };

  return createPortal(
    <div className="psd-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="psd-dialog" role="dialog" aria-modal="true" aria-label="项目整体顺延">
        <header className="psd-header">
          <div>
            <span><CalendarRange size={15} />项目整体顺延</span>
            <h2>{taskName}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭项目顺延"><X size={18} /></button>
        </header>

        <div className="psd-body">
          <div className="psd-presets" role="group" aria-label="顺延天数">
            {[1, 3, 7].map((value) => (
              <button type="button" key={value} className={days === value ? 'is-active' : ''} onClick={() => { setDays(value); setError(''); }}>
                {value} 天
              </button>
            ))}
            <label>
              自定义
              <input
                type="number"
                min={1}
                max={365}
                value={days}
                aria-label="自定义顺延天数"
                onChange={(event) => {
                  setDays(Math.min(365, Math.max(1, Math.trunc(Number(event.target.value) || 1))));
                  setError('');
                }}
              />
              天
            </label>
          </div>

          {preview && (
            <>
              <div className="psd-summary" aria-label="项目顺延预览">
                <div><strong>{preview.project.tasks.length}</strong><span>个任务将顺延</span></div>
                <div><strong>{movedDailyCount}</strong><span>个每日安排将移动</span></div>
                <div className={deadlineRisks.length > 0 ? 'is-warning' : ''}><strong>{deadlineRisks.length}</strong><span>个截止日期风险</span></div>
              </div>
              <div className="psd-range">
                <span>项目范围</span>
                <b>{preview.project.previousTask.start}—{preview.project.previousTask.end}</b>
                <em>→</em>
                <b>{preview.project.shiftedStart}—{preview.project.shiftedEnd}</b>
              </div>
              <div className="psd-note">
                <Clock3 size={15} />
                <span>已完成、已归档、未排期、日期异常以及单词/数量任务不会移动；任务截止日期保持不变。</span>
              </div>
              {preview.daily.collisionFallbacks > 0 && (
                <div className="psd-warning"><AlertTriangle size={15} />{preview.daily.collisionFallbacks} 个时间块在新日期发生冲突，将保留在对应的上午、下午或晚上时段。</div>
              )}
              {deadlineRisks.length > 0 && (
                <div className="psd-risk-list">
                  <strong><AlertTriangle size={15} />顺延后晚于截止日期</strong>
                  {deadlineRisks.slice(0, 5).map((task) => (
                    <div key={task.blockId}><span>{task.title}</span><em>{task.toDate} ＞ {task.deadline}</em></div>
                  ))}
                  {deadlineRisks.length > 5 && <small>另有 {deadlineRisks.length - 5} 个任务</small>}
                </div>
              )}
            </>
          )}
          {(error || previewState.error) && (
            <div className="psd-error" role="alert">{error || previewState.error}</div>
          )}
        </div>

        <footer className="psd-footer">
          <span>确认后可立即撤销本次整体操作</span>
          <div>
            <button type="button" onClick={onClose}>取消</button>
            <button type="button" className="is-primary" disabled={!preview || preview.project.tasks.length === 0} onClick={apply}>
              确认顺延 {days} 天
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
};

export default ProjectShiftDialog;
