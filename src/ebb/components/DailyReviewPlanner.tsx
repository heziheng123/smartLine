import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import '@/styles/ebb.css';
import { AlertTriangle, CalendarCheck2, Clock3, RotateCcw, ShieldAlert, X } from 'lucide-react';
import { addDays, formatDate, todayStr } from '@/utils/dateSafe';
import { useGraphStore } from '@/graph/store';
import type { EbbSettings, ReviewTask } from '../types';
import { buildRootNodeMap, resolveReviewCategory } from '../category';
import {
  buildBalancedDailyReviewPlan,
  getDailyReviewCandidates,
  type DailyReviewPlan,
  type DailyReviewPlanRequest,
} from '../dailyReviewPlanning';

interface DailyReviewPlannerProps {
  reviewTasks: ReviewTask[];
  settings: EbbSettings;
  onApply: (request: DailyReviewPlanRequest) => DailyReviewPlan;
  onClose: () => void;
}

const DailyReviewPlanner: React.FC<DailyReviewPlannerProps> = ({
  reviewTasks,
  settings,
  onApply,
  onClose,
}) => {
  const planDate = addDays(todayStr(), 1);
  const dates = useMemo(() => Array.from({ length: 3 }, (_, index) => addDays(planDate, index)), [planDate]);
  const candidates = useMemo(() => getDailyReviewCandidates(reviewTasks, planDate), [planDate, reviewTasks]);
  const automatic = useMemo(
    () => buildBalancedDailyReviewPlan(reviewTasks, planDate, settings.dailyReviewMinutes, dates.length),
    [dates.length, planDate, reviewTasks, settings.dailyReviewMinutes],
  );
  const initialAssignments = useMemo(() => {
    const next = { ...automatic.assignmentsByTaskId };
    candidates.forEach((candidate) => {
      if (candidate.previousDecision === 'keep') next[candidate.taskId] = planDate;
      if (candidate.previousDecision === 'defer' && dates.includes(candidate.dueDate)) next[candidate.taskId] = candidate.dueDate;
    });
    return next;
  }, [automatic.assignmentsByTaskId, candidates, dates, planDate]);
  const [assignments, setAssignments] = useState<Record<string, string>>(initialAssignments);
  const [error, setError] = useState('');
  const graphNodes = useGraphStore((state) => state.nodes);
  const rootByNodeId = useMemo(() => buildRootNodeMap(graphNodes), [graphNodes]);

  const baselineMinutes = useMemo(() => {
    const result = new Map(automatic.days.map((day) => [day.date, day.minutes]));
    candidates.forEach((candidate) => {
      const date = automatic.assignmentsByTaskId[candidate.taskId];
      result.set(date, Math.max(0, (result.get(date) ?? 0) - candidate.durationMinutes));
    });
    return result;
  }, [automatic, candidates]);
  const baselineCounts = useMemo(() => {
    const result = new Map(automatic.days.map((day) => [day.date, day.taskIds.length]));
    candidates.forEach((candidate) => {
      const date = automatic.assignmentsByTaskId[candidate.taskId];
      result.set(date, Math.max(0, (result.get(date) ?? 0) - 1));
    });
    return result;
  }, [automatic, candidates]);
  const daySummaries = useMemo(() => dates.map((date) => {
    const assigned = candidates.filter((candidate) => assignments[candidate.taskId] === date);
    const fixedMinutes = baselineMinutes.get(date) ?? 0;
    const fixedCount = baselineCounts.get(date) ?? 0;
    const minutes = fixedMinutes + assigned.reduce((sum, candidate) => sum + candidate.durationMinutes, 0);
    return { date, assigned, fixedCount, fixedMinutes, minutes, over: minutes > settings.dailyReviewMinutes };
  }), [assignments, baselineCounts, baselineMinutes, candidates, dates, settings.dailyReviewMinutes]);
  const tomorrow = daySummaries[0];
  const overflowMinutes = daySummaries.reduce((sum, day) => sum + Math.max(0, day.minutes - settings.dailyReviewMinutes), 0);
  const deferredCount = candidates.filter((candidate) => assignments[candidate.taskId] !== planDate).length;
  const deferredDateLabels = daySummaries.slice(1)
    .filter((day) => day.assigned.length > 0)
    .map((day) => formatDate(day.date, 'M月D日'));

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const setAssignment = (taskId: string, date: string) => {
    setError('');
    setAssignments((current) => ({ ...current, [taskId]: date }));
  };

  const handleApply = () => {
    try {
      onApply({
        planDate,
        candidateTaskIds: candidates.map((candidate) => candidate.taskId),
        keptTaskIds: candidates.filter((candidate) => assignments[candidate.taskId] === planDate).map((candidate) => candidate.taskId),
        assignmentsByTaskId: assignments,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '明日负荷规划失败，请重新打开后再试');
    }
  };

  return createPortal(
    <div className="eb-panel-overlay eb-daily-plan-overlay" onClick={onClose}>
      <div className="eb-panel eb-daily-plan-panel eb-workload-panel" role="dialog" aria-modal="true" aria-label="明日负荷规划" onClick={(event) => event.stopPropagation()}>
        <div className="eb-panel-header eb-daily-plan-header">
          <div>
            <div className="eb-daily-plan-eyebrow"><CalendarCheck2 size={14} />容量平衡</div>
            <h3 className="eb-panel-title">规划 {formatDate(planDate, 'M月D日')} 的复习负荷</h3>
            <p className="eb-batch-subtitle">目标 {settings.dailyReviewMinutes} 分钟；调整当前轮次时，后续未完成轮次会保持原间隔联动。</p>
          </div>
          <button type="button" className="eb-panel-close" onClick={onClose} aria-label="关闭明日负荷规划"><X size={16} /></button>
        </div>

        <div className={`eb-daily-plan-capacity ${tomorrow?.over ? 'is-over' : ''}`} role="status">
          <div><span>明日预计</span><strong>{tomorrow?.minutes ?? 0}/{settings.dailyReviewMinutes} 分钟 · {tomorrow?.assigned.length ?? 0} 轮</strong></div>
          <small>{tomorrow?.over ? <><AlertTriangle size={13} />超载 {tomorrow.minutes - settings.dailyReviewMinutes} 分钟</> : <><CalendarCheck2 size={13} />容量正常</>}</small>
          <div className="eb-workload-quick-actions">
            <button type="button" className="eb-btn eb-btn--secondary eb-btn--sm" onClick={() => setAssignments({ ...automatic.assignmentsByTaskId })}><RotateCcw size={13} />一键平衡</button>
            <button type="button" className="eb-btn eb-btn--ghost eb-btn--sm" onClick={() => setAssignments(Object.fromEntries(candidates.map((candidate) => [candidate.taskId, planDate])))}>全部安排明天</button>
          </div>
        </div>

        <div className="eb-workload-body">
          {candidates.length === 0 ? (
            <div className="eb-daily-plan-empty"><CalendarCheck2 size={32} /><strong>明天没有需要重新分配的当前轮次</strong><span>未来轮次保持原计划。</span></div>
          ) : (
            <div className="eb-workload-columns">
              {daySummaries.map((day, dayIndex) => (
                <section className={`eb-workload-day ${day.over ? 'is-over' : ''}`} key={day.date} aria-label={`${formatDate(day.date, 'M月D日')}负荷`}>
                  <header>
                    <div><strong>{dayIndex === 0 ? '明天' : formatDate(day.date, 'M月D日')}</strong><span>{day.assigned.length + day.fixedCount}轮</span></div>
                    <em>{day.minutes}/{settings.dailyReviewMinutes}m</em>
                  </header>
                  <div className="eb-workload-meter"><span style={{ width: `${Math.min(100, day.minutes / settings.dailyReviewMinutes * 100)}%` }} /></div>
                  <div className="eb-workload-cards">
                    {day.fixedCount > 0 && <div className="eb-workload-fixed"><CalendarCheck2 size={12} />已有 {day.fixedCount} 轮固定计划，占用 {day.fixedMinutes} 分钟</div>}
                    {day.assigned.map((candidate) => {
                      const task = reviewTasks.find((item) => item.id === candidate.taskId);
                      const category = task ? resolveReviewCategory(task, rootByNodeId)?.label : undefined;
                      return <article className="eb-workload-card" key={candidate.taskId}>
                        <div className="eb-workload-card-main">
                          <strong>{candidate.topicName}</strong>
                          <span>{category ?? '未分类'} · R{candidate.round}/{candidate.totalRounds}</span>
                          <span><Clock3 size={11} />约 {candidate.durationMinutes} 分钟{candidate.laterPendingRounds > 0 ? ` · 后续 ${candidate.laterPendingRounds} 轮联动` : ''}</span>
                          {candidate.recommendedLocked && <span className="eb-workload-urgent"><ShieldAlert size={11} />高优先级：已逾期或连续推迟</span>}
                        </div>
                        <label>
                          <span>安排到</span>
                          <select value={assignments[candidate.taskId]} onChange={(event) => setAssignment(candidate.taskId, event.target.value)} aria-label={`安排${candidate.topicName}`}>
                            {dates.map((date, index) => <option key={date} value={date}>{index === 0 ? '明天' : index === 1 ? `后天 · ${formatDate(date, 'M月D日')}` : formatDate(date, 'M月D日')}</option>)}
                          </select>
                        </label>
                      </article>;
                    })}
                    {day.assigned.length === 0 && day.fixedCount === 0 && <div className="eb-workload-empty">暂无分配</div>}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="eb-panel-footer eb-daily-plan-footer">
          <div>
            {error ? <span className="eb-daily-plan-error"><AlertTriangle size={14} />{error}</span>
              : overflowMinutes > 0 ? <span className="eb-daily-plan-error"><AlertTriangle size={14} />未来3天仍超载 {overflowMinutes} 分钟，请增加容量或继续调整</span>
                : <span>明日保留 {tomorrow?.assigned.length ?? 0} 轮，共 {tomorrow?.minutes ?? 0} 分钟；{deferredCount > 0 ? `另外 ${deferredCount} 轮已调整到 ${deferredDateLabels.join('、')}` : '没有轮次需要推迟'}</span>}
          </div>
          <div><button type="button" className="eb-btn eb-btn--ghost" onClick={onClose}>取消</button><button type="button" className="eb-btn eb-btn--primary" disabled={candidates.length === 0} onClick={handleApply}>保存负荷规划</button></div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default DailyReviewPlanner;
