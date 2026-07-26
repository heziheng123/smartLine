import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarClock,
  Check,
  ChevronRight,
  Clock3,
  RotateCcw,
  X,
} from 'lucide-react';
import { addDays, formatDate, todayStr } from '@/utils/dateSafe';
import type { ReviewTask } from '../types';
import {
  getDailyReviewCandidates,
  type DailyReviewPlan,
  type DailyReviewPlanRequest,
} from '../dailyReviewPlanning';

interface DailyReviewPlannerProps {
  reviewTasks: ReviewTask[];
  onApply: (request: DailyReviewPlanRequest) => DailyReviewPlan;
  onClose: () => void;
}

const complexityLabel = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
} as const;

const DailyReviewPlanner: React.FC<DailyReviewPlannerProps> = ({
  reviewTasks,
  onApply,
  onClose,
}) => {
  const planDate = addDays(todayStr(), 1);
  const rolloverDate = addDays(planDate, 1);
  const candidates = useMemo(
    () => getDailyReviewCandidates(reviewTasks, planDate),
    [planDate, reviewTasks],
  );
  const taskById = useMemo(
    () => new Map(reviewTasks.map((task) => [task.id, task])),
    [reviewTasks],
  );
  const [keptIds, setKeptIds] = useState(() => new Set(
    candidates
      .filter((candidate) => candidate.previousDecision === 'keep')
      .map((candidate) => candidate.taskId),
  ));
  const [error, setError] = useState('');
  const deferredCount = Math.max(0, candidates.length - keptIds.size);

  const toggleKeep = (taskId: string) => {
    setError('');
    setKeptIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const handleApply = () => {
    try {
      onApply({
        planDate,
        candidateTaskIds: candidates.map((candidate) => candidate.taskId),
        keptTaskIds: [...keptIds],
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '明日选择失败，请重新打开后再试');
    }
  };

  return createPortal(
    <div className="eb-panel-overlay eb-daily-plan-overlay" onClick={onClose}>
      <div
        className="eb-panel eb-daily-plan-panel"
        role="dialog"
        aria-modal="true"
        aria-label="明日复习选择"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="eb-panel-header eb-daily-plan-header">
          <div>
            <div className="eb-daily-plan-eyebrow"><CalendarCheck2 size={14} />每日滚动选择</div>
            <h3 className="eb-panel-title">安排 {formatDate(planDate, 'M月D日')} 的复习</h3>
            <p className="eb-batch-subtitle">只确认明天；未保留的当前轮次统一进入 {formatDate(rolloverDate, 'M月D日')} 待选池</p>
          </div>
          <button type="button" className="eb-panel-close" onClick={onClose} aria-label="关闭明日选择"><X size={16} /></button>
        </div>

        <div className="eb-daily-plan-capacity" role="status">
          <div>
            <span>明日已选择</span>
            <strong>{keptIds.size} 轮 · 不限数量</strong>
          </div>
          <small><Clock3 size={13} />预计约 {keptIds.size * 12}–{keptIds.size * 15} 分钟，可按实际精力自由选择</small>
        </div>

        <div className="eb-daily-plan-body">
          {candidates.length === 0 ? (
            <div className="eb-daily-plan-empty">
              <CalendarCheck2 size={32} />
              <strong>明天没有需要决策的当前轮次</strong>
              <span>后续轮次保持原计划，不会被移动。</span>
            </div>
          ) : (
            <>
              <div className="eb-daily-plan-guide">
                <span><Check size={13} />保留：明天完成</span>
                <span><ChevronRight size={13} />未保留：统一顺延一天</span>
                <span><RotateCcw size={13} />明晚再次选择</span>
              </div>
              <div className="eb-daily-plan-list">
                {candidates.map((candidate) => {
                  const task = taskById.get(candidate.taskId);
                  const kept = keptIds.has(candidate.taskId);
                  const nextDeferralCount = candidate.previousDecision === 'defer'
                    ? candidate.deferralCount
                    : candidate.deferralCount + 1;
                  return (
                    <article
                      key={candidate.taskId}
                      className={`eb-daily-plan-card ${kept ? 'is-kept' : 'is-deferred'}`}
                    >
                      <button
                        type="button"
                        className="eb-daily-plan-choice"
                        aria-pressed={kept}
                        onClick={() => toggleKeep(candidate.taskId)}
                      >
                        <span className="eb-daily-plan-check">{kept && <Check size={14} />}</span>
                        <span>{kept ? '明天保留' : '保留明天'}</span>
                      </button>
                      <div className="eb-daily-plan-card-main">
                        <div className="eb-daily-plan-card-title">
                          <strong>{candidate.topicName}</strong>
                          <span>R{candidate.round}/{candidate.totalRounds}</span>
                          {task?.complexity && <span>{complexityLabel[task.complexity]}</span>}
                        </div>
                        <div className="eb-daily-plan-card-meta">
                          <span>当前日期 {candidate.dueDate}</span>
                          {candidate.laterPendingRounds > 0 && (
                            <span>后续 {candidate.laterPendingRounds} 轮保持间隔联动</span>
                          )}
                          {(candidate.deferralCount > 0 || !kept) && (
                            <span className={nextDeferralCount >= 3 ? 'is-warning' : ''}>
                              {kept ? `此前连续顺延 ${candidate.deferralCount} 次` : `确认后连续顺延 ${nextDeferralCount} 次`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="eb-daily-plan-destination">
                        {kept ? (
                          <><CalendarCheck2 size={15} /><span>{formatDate(planDate, 'M月D日')}</span></>
                        ) : (
                          <><CalendarClock size={15} /><span>{formatDate(rolloverDate, 'M月D日')} 待选</span></>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="eb-panel-footer eb-daily-plan-footer">
          <div>
            {error ? (
              <span className="eb-daily-plan-error"><AlertTriangle size={14} />{error}</span>
            ) : candidates.length > 0 ? (
              <span>保留 {keptIds.size} 轮 · 顺延 {deferredCount} 轮；后续未完成轮次同步保持间隔</span>
            ) : (
              <span>当前无需保存任何调整</span>
            )}
          </div>
          <div>
            <button type="button" className="eb-btn eb-btn--ghost" onClick={onClose}>取消</button>
            <button
              type="button"
              className="eb-btn eb-btn--primary"
              disabled={candidates.length === 0}
              onClick={handleApply}
            >
              确认明日选择
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default DailyReviewPlanner;
