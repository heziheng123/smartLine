import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CalendarClock,
  CalendarRange,
  Check,
  CheckCircle,
  ChevronRight,
  Gauge,
  ListChecks,
  PauseCircle,
  Plus,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { addDays, todayStr } from '@/utils/dateSafe';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import type { EbbSettings, ReviewTask } from '../types';
import {
  planBatchReviewAdjustment,
  type BatchReviewAction,
  type BatchReviewPlan,
  type BatchReviewRequest,
  type ReviewAdjustmentGoal,
} from '../batchAdjust';
import { getReviewRoundDuration } from '../duration';
import { getReviewTopicKey } from '../scheduler';

interface BatchAdjustPanelProps {
  reviewTasks: ReviewTask[];
  settings: EbbSettings;
  initialGoal?: 'backlog' | 'balance';
  initialScope?: 'all' | 'overdue';
  initialPreviewExpanded?: boolean;
  onApply: (request: BatchReviewRequest) => BatchReviewPlan;
  onClose: () => void;
}

type GoalKind = ReviewAdjustmentGoal['kind'];
type ActionKind = BatchReviewAction['kind'];
type ScopeFilter = 'all' | 'overdue' | 'upcoming' | 'pending';
type ComplexityFilter = 'all' | 'easy' | 'normal' | 'hard' | 'custom';
type PlanningPreset = 'gentle' | 'balanced' | 'rapid' | 'custom';

const GOALS: Array<{
  kind: GoalKind;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  { kind: 'backlog', label: '清理逾期与积压', description: '优先处理已经到期的计划，并保持后续轮次顺序', icon: <CalendarClock size={18} /> },
  { kind: 'balance', label: '平衡未来负荷', description: '在规划区间内自动摊开高峰，尽量少偏离原日期', icon: <Gauge size={18} /> },
  { kind: 'cadence', label: '调整复习节奏', description: '保留完成历史，按难度或自定义间隔重建未来轮次', icon: <Sparkles size={18} /> },
  { kind: 'lifecycle', label: '管理计划周期', description: '精简、延长或重新建立未来复习周期', icon: <PauseCircle size={18} /> },
  { kind: 'advanced', label: '精确调整', description: '按指定日期、固定天数或轮次执行高级操作', icon: <SlidersHorizontal size={18} /> },
];

const QUICK_GOAL_KINDS: GoalKind[] = ['backlog', 'balance', 'cadence'];

const PLANNING_PRESETS: Array<{
  kind: Exclude<PlanningPreset, 'custom'>;
  label: string;
  description: string;
}> = [
  { kind: 'gentle', label: '温和调整', description: '尽量保持原日期' },
  { kind: 'balanced', label: '均衡调整', description: '推荐 · 消除高峰' },
  { kind: 'rapid', label: '快速清理', description: '优先处理积压' },
];

const ADVANCED_ACTIONS: Array<{ kind: ActionKind; label: string; description: string; icon: React.ReactNode }> = [
  { kind: 'reanchor', label: '指定下一轮日期', description: '从指定日期开始，保持当前间隔', icon: <RefreshCcw size={15} /> },
  { kind: 'shift', label: '整体提前或顺延', description: '统一移动所有未完成轮次', icon: <CalendarRange size={15} /> },
  { kind: 'trim', label: '精简末尾轮次', description: '删除每个计划末尾的未完成轮次', icon: <Trash2 size={15} /> },
  { kind: 'append', label: '追加轮次', description: '按照当前计划节奏继续追加', icon: <Plus size={15} /> },
  { kind: 'template', label: '自定义未来节奏', description: '保留完成历史并重建未来轮次', icon: <Sparkles size={15} /> },
];

const parseIntervals = (value: string) => {
  const tokens = value.trim().split(/[,，\s]+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const intervals = tokens.map(Number);
  return intervals.every((number) => Number.isInteger(number) && number > 0 && number <= 1825)
    ? intervals
    : [];
};

const boundedInteger = (value: number, min: number, max: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

const formatShortDate = (value: string) => {
  const [, month, day] = value.split('-');
  return `${Number(month)}.${Number(day)}`;
};

const BatchAdjustPanel: React.FC<BatchAdjustPanelProps> = ({ reviewTasks, settings, initialGoal, initialScope = 'all', initialPreviewExpanded = false, onApply, onClose }) => {
  const today = todayStr();
  const schedules = useDailyScheduleStore((state) => state.schedules);
  const scheduledReviewIds = useMemo(() => {
    const result = new Set<string>();
    Object.values(schedules).forEach((day) => {
      [...(day.items ?? []), ...(day.blocks ?? [])].forEach((entry) => {
        if (entry.sourceId?.startsWith('review-')) result.add(entry.sourceId.slice('review-'.length));
      });
    });
    return result;
  }, [schedules]);

  const topics = useMemo(() => {
    const grouped = new Map<string, ReviewTask[]>();
    reviewTasks.filter((task) => !task.isArchived).forEach((task) => {
      const key = getReviewTopicKey(task);
      grouped.set(key, [...(grouped.get(key) ?? []), task]);
    });
    return [...grouped.entries()].map(([key, tasks]) => {
      const pending = tasks.filter((task) => !task.isCompleted).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      return {
        key,
        name: tasks[0]?.topicName ?? key,
        total: tasks.length,
        pending: pending.length,
        overdue: pending.filter((task) => task.dueDate < today).length,
        upcoming: pending.some((task) => task.dueDate >= today && task.dueDate <= addDays(today, 14)),
        nextDueDate: pending[0]?.dueDate,
        complexity: tasks[0]?.complexity ?? 'custom',
        minutes: pending.reduce((sum, task) => sum + getReviewRoundDuration(task, task.roundOrder ?? 1), 0),
      };
    }).sort((a, b) => (a.nextDueDate ?? '9999-12-31').localeCompare(b.nextDueDate ?? '9999-12-31')
      || a.name.localeCompare(b.name, 'zh-CN'));
  }, [reviewTasks, today]);

  const [selectedKeys, setSelectedKeys] = useState(() => new Set(topics
    .filter((topic) => topic.pending > 0 && (initialScope !== 'overdue' || topic.overdue > 0))
    .map((topic) => topic.key)));
  const [query, setQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>(initialScope);
  const [complexityFilter, setComplexityFilter] = useState<ComplexityFilter>('all');
  const hasOverdue = topics.some((topic) => topic.overdue > 0);
  const [goalKind, setGoalKind] = useState<GoalKind>(initialGoal ?? (hasOverdue ? 'backlog' : 'balance'));
  const [showMoreGoals, setShowMoreGoals] = useState(false);
  const [planningPreset, setPlanningPreset] = useState<PlanningPreset>('balanced');

  const [startDate, setStartDate] = useState(today);
  const [horizonDays, setHorizonDays] = useState(14);
  const [capacityMinutes, setCapacityMinutes] = useState(settings.dailyReviewMinutes);
  const [maxRoundsPerDay, setMaxRoundsPerDay] = useState(Math.max(1, settings.dailyTaskLimit));
  const [maxMoveDays, setMaxMoveDays] = useState(Math.max(7, settings.maxSpreadDays));
  const [deadline, setDeadline] = useState('');
  const [dailyHandling, setDailyHandling] = useState<'protect' | 'return'>('protect');

  const [cadencePreset, setCadencePreset] = useState<'easy' | 'normal' | 'hard' | 'custom'>('normal');
  const [customIntervals, setCustomIntervals] = useState(settings.customIntervals);
  const [lifecycleOperation, setLifecycleOperation] = useState<'trim' | 'append' | 'restart'>('append');
  const [lifecycleCount, setLifecycleCount] = useState(1);
  const [advancedKind, setAdvancedKind] = useState<ActionKind>('reanchor');
  const [shiftDays, setShiftDays] = useState(7);
  const planningPresetValues = useMemo(() => ({
    gentle: {
      horizonDays: 14,
      capacityMinutes: settings.dailyReviewMinutes,
      maxRoundsPerDay: Math.max(1, settings.dailyTaskLimit),
      maxMoveDays: 7,
    },
    balanced: {
      horizonDays: 14,
      capacityMinutes: settings.dailyReviewMinutes,
      maxRoundsPerDay: Math.max(1, settings.dailyTaskLimit),
      maxMoveDays: Math.max(14, settings.maxSpreadDays),
    },
    rapid: {
      horizonDays: 7,
      capacityMinutes: Math.max(settings.dailyReviewMinutes, Math.ceil(settings.dailyReviewMinutes * 1.5 / 5) * 5),
      maxRoundsPerDay: Math.max(3, settings.dailyTaskLimit + 2),
      maxMoveDays: 30,
    },
  }), [settings.dailyReviewMinutes, settings.dailyTaskLimit, settings.maxSpreadDays]);

  const visibleTopics = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    return topics.filter((topic) => {
      if (normalized && !topic.name.toLocaleLowerCase('zh-CN').includes(normalized)) return false;
      if (scopeFilter === 'overdue' && topic.overdue === 0) return false;
      if (scopeFilter === 'upcoming' && !topic.upcoming) return false;
      if (scopeFilter === 'pending' && topic.pending === 0) return false;
      if (complexityFilter !== 'all' && topic.complexity !== complexityFilter) return false;
      return true;
    });
  }, [complexityFilter, query, scopeFilter, topics]);

  const selectedTopics = useMemo(() => topics.filter((topic) => selectedKeys.has(topic.key)), [selectedKeys, topics]);
  const selectedPending = selectedTopics.reduce((sum, topic) => sum + topic.pending, 0);
  const selectedOverdue = selectedTopics.reduce((sum, topic) => sum + topic.overdue, 0);
  const selectedMinutes = selectedTopics.reduce((sum, topic) => sum + topic.minutes, 0);
  const selectedVisibleCount = visibleTopics.filter((topic) => selectedKeys.has(topic.key)).length;
  const allVisibleSelected = visibleTopics.length > 0 && selectedVisibleCount === visibleTopics.length;

  const cadenceIntervals = useMemo(() => cadencePreset === 'custom'
    ? parseIntervals(customIntervals)
    : settings.complexityConfigs[cadencePreset].intervals,
  [cadencePreset, customIntervals, settings.complexityConfigs]);

  const advancedAction = useMemo<BatchReviewAction>(() => {
    if (advancedKind === 'reanchor') return { kind: 'reanchor', startDate };
    if (advancedKind === 'shift') return { kind: 'shift', days: boundedInteger(shiftDays, -365, 365, 0) };
    if (advancedKind === 'trim') return { kind: 'trim', count: boundedInteger(lifecycleCount, 1, 12, 1), minRemaining: 1 };
    if (advancedKind === 'append') return { kind: 'append', count: boundedInteger(lifecycleCount, 1, 12, 1) };
    return { kind: 'template', startDate, intervals: cadenceIntervals };
  }, [advancedKind, cadenceIntervals, lifecycleCount, shiftDays, startDate]);

  const request = useMemo<BatchReviewRequest>(() => {
    const topicKeys = [...selectedKeys];
    if (goalKind === 'backlog' || goalKind === 'balance') {
      return {
        topicKeys,
        mode: 'goal',
        goal: {
          kind: goalKind,
          startDate,
          horizonDays: boundedInteger(horizonDays, 1, 90, 14),
          capacityMinutes: boundedInteger(capacityMinutes, 15, 1440, 60),
          maxRoundsPerDay: boundedInteger(maxRoundsPerDay, 1, 99, 6),
          maxMoveDays: boundedInteger(maxMoveDays, 0, 365, 30),
          deadline: deadline || undefined,
          protectedTaskIds: dailyHandling === 'protect' ? [...scheduledReviewIds] : [],
        },
      };
    }
    if (goalKind === 'cadence') return { topicKeys, mode: 'goal', goal: { kind: 'cadence', startDate, intervals: cadenceIntervals } };
    if (goalKind === 'lifecycle') {
      return {
        topicKeys,
        mode: 'goal',
        goal: {
          kind: 'lifecycle',
          operation: lifecycleOperation,
          count: boundedInteger(lifecycleCount, 1, 12, 1),
          startDate,
          intervals: cadenceIntervals,
        },
      };
    }
    return { topicKeys, mode: 'goal', goal: { kind: 'advanced', action: advancedAction } };
  }, [advancedAction, cadenceIntervals, capacityMinutes, dailyHandling, deadline, goalKind, horizonDays, lifecycleCount, lifecycleOperation, maxMoveDays, maxRoundsPerDay, scheduledReviewIds, selectedKeys, startDate]);

  const preview = useMemo(() => planBatchReviewAdjustment(reviewTasks, settings, request), [request, reviewTasks, settings]);
  const previewDatesByTopic = useMemo(() => {
    const nextPendingDates = new Map<string, string>();
    preview.nextTasks
      .filter((task) => !task.isCompleted)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .forEach((task) => {
        const key = getReviewTopicKey(task);
        if (!nextPendingDates.has(key)) nextPendingDates.set(key, task.dueDate);
      });
    return nextPendingDates;
  }, [preview.nextTasks]);
  const impactedDailyCount = preview.sourceIdsToClear.filter((id) => scheduledReviewIds.has(id)).length;
  const overloadBefore = preview.dayLoads?.filter((day) => day.beforeOverCapacity).length ?? 0;
  const overloadAfter = preview.dayLoads?.filter((day) => day.afterOverCapacity).length ?? 0;
  const presetImpacts = useMemo<Partial<Record<Exclude<PlanningPreset, 'custom'>, { moved: number; overloadBefore: number; overloadAfter: number }>>>(() => {
    if (goalKind !== 'backlog' && goalKind !== 'balance') return {};
    return Object.fromEntries((['gentle', 'balanced', 'rapid'] as const).map((preset) => {
      const values = planningPresetValues[preset];
      const presetRequest: BatchReviewRequest = {
        topicKeys: [...selectedKeys],
        mode: 'goal',
        goal: {
          kind: goalKind,
          startDate: today,
          ...values,
          protectedTaskIds: [...scheduledReviewIds],
        },
      };
      const result = planBatchReviewAdjustment(reviewTasks, settings, presetRequest);
      return [preset, {
        moved: result.rescheduledRounds,
        overloadBefore: result.dayLoads?.filter((day) => day.beforeOverCapacity).length ?? 0,
        overloadAfter: result.dayLoads?.filter((day) => day.afterOverCapacity).length ?? 0,
      }];
    }));
  }, [goalKind, planningPresetValues, reviewTasks, scheduledReviewIds, selectedKeys, settings, today]);
  const hasInvalidIntervals = (goalKind === 'cadence'
    || (goalKind === 'lifecycle' && lifecycleOperation === 'restart')
    || (goalKind === 'advanced' && advancedKind === 'template'))
    && cadenceIntervals.length === 0;
  const ruleSummary = goalKind === 'backlog' || goalKind === 'balance'
    ? `从 ${formatShortDate(startDate)} 开始，规划 ${horizonDays} 天；每天最多 ${capacityMinutes} 分钟、${maxRoundsPerDay} 轮，单轮最多移动 ${maxMoveDays} 天${deadline ? `，截止 ${formatShortDate(deadline)}` : ''}`
    : goalKind === 'cadence'
      ? `从 ${formatShortDate(startDate)} 开始，按 ${cadencePreset === 'custom' ? '自定义' : settings.complexityConfigs[cadencePreset].label}节奏重建未来轮次`
      : goalKind === 'lifecycle'
        ? `${lifecycleOperation === 'trim' ? `缩短 ${lifecycleCount} 轮` : lifecycleOperation === 'append' ? `追加 ${lifecycleCount} 轮` : `从 ${formatShortDate(startDate)} 重建未来周期`}`
        : advancedKind === 'shift'
          ? `所有未完成轮次${shiftDays >= 0 ? '顺延' : '提前'} ${Math.abs(shiftDays)} 天`
          : advancedKind === 'reanchor'
            ? `把每个计划的下一轮设为 ${formatShortDate(startDate)}`
            : advancedKind === 'trim'
              ? `每个计划删除末尾 ${lifecycleCount} 轮`
              : advancedKind === 'append'
                ? `每个计划追加 ${lifecycleCount} 轮`
                : `从 ${formatShortDate(startDate)} 按自定义间隔重建未来轮次`;
  const planningPresetLabel = planningPreset === 'custom'
    ? '自定义参数'
    : PLANNING_PRESETS.find((preset) => preset.kind === planningPreset)?.label;
  const verdictKind = (preview.blockingIssues?.length ?? 0) > 0 || hasInvalidIntervals
    ? 'blocked'
    : preview.affectedTopics === 0
      ? 'neutral'
      : (preview.warnings?.length ?? 0) > 0 || impactedDailyCount > 0 || overloadAfter > 0
        ? 'caution'
        : 'safe';
  const verdictText = verdictKind === 'blocked'
    ? `暂时无法执行：${preview.blockingIssues?.[0] ?? '请检查自定义间隔。'}`
    : verdictKind === 'neutral'
      ? selectedKeys.size === 0 ? '请选择至少一个复习计划。' : '当前设置不会改变任何复习轮次。'
      : verdictKind === 'caution'
        ? `可以执行，但请注意：将调整 ${preview.affectedTopics} 个计划、改期 ${preview.rescheduledRounds} 轮${impactedDailyCount > 0 ? `，${impactedDailyCount} 个每日安排会返回任务池或保持受保护` : ''}${overloadAfter > 0 ? `，仍有 ${overloadAfter} 个超载日期` : ''}。`
        : `可以安全执行：调整 ${preview.affectedTopics} 个计划、改期 ${preview.rescheduledRounds} 轮，不改变已完成历史，超载日期 ${overloadBefore} → ${overloadAfter}。`;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const toggleVisible = () => setSelectedKeys((current) => {
    const next = new Set(current);
    visibleTopics.forEach((topic) => {
      if (allVisibleSelected) next.delete(topic.key);
      else if (topic.pending > 0) next.add(topic.key);
    });
    return next;
  });

  const selectScope = (scope: ScopeFilter) => {
    setScopeFilter(scope);
    setSelectedKeys(new Set(topics.filter((topic) => {
      if (topic.pending === 0) return false;
      if (scope === 'overdue') return topic.overdue > 0;
      if (scope === 'upcoming') return topic.upcoming;
      return true;
    }).map((topic) => topic.key)));
  };

  const applyPlanningPreset = (preset: Exclude<PlanningPreset, 'custom'>) => {
    const values = planningPresetValues[preset];
    setPlanningPreset(preset);
    setStartDate(today);
    setDeadline('');
    setDailyHandling('protect');
    setHorizonDays(values.horizonDays);
    setCapacityMinutes(values.capacityMinutes);
    setMaxRoundsPerDay(values.maxRoundsPerDay);
    setMaxMoveDays(values.maxMoveDays);
  };

  const canApply = preview.affectedTopics > 0
    && !hasInvalidIntervals
    && (preview.blockingIssues?.length ?? 0) === 0;

  const handleApply = () => {
    if (!canApply) return;
    onApply(request);
    onClose();
  };

  return createPortal(
    <div className="eb-panel-overlay eb-batch-overlay" onClick={onClose}>
      <div className="eb-panel eb-batch-panel eb-adjust-center" role="dialog" aria-modal="true" aria-label="复习计划调整中心" onClick={(event) => event.stopPropagation()}>
        <div className="eb-panel-header eb-adjust-header">
          <div>
            <div className="eb-adjust-eyebrow"><Sparkles size={14} />统一规划</div>
            <h3 className="eb-panel-title">复习计划调整中心</h3>
            <p className="eb-batch-subtitle">已选 {selectedKeys.size} 个计划 · {selectedPending} 个未完成轮次 · {selectedMinutes} 分钟</p>
          </div>
          <button type="button" className="eb-panel-close" onClick={onClose} aria-label="关闭复习计划调整中心"><X size={16} /></button>
        </div>

        <div className="eb-adjust-page">
          <div className="eb-adjust-controls">
          {(
            <section className="eb-adjust-section eb-adjust-scope" aria-labelledby="adjust-step-scope">
              <div className="eb-adjust-section-title">
                <div><ListChecks size={18} /><div><h4 id="adjust-step-scope">调整范围</h4><p>默认选中符合当前范围的全部计划。</p></div></div>
              </div>
              <div className="eb-adjust-scope-presets" aria-label="快速选择计划范围">
                <button type="button" className={scopeFilter === 'all' ? 'is-active' : ''} onClick={() => selectScope('all')}>全部待处理</button>
                <button type="button" className={scopeFilter === 'overdue' ? 'is-active' : ''} onClick={() => selectScope('overdue')}>仅逾期</button>
                <button type="button" className={scopeFilter === 'upcoming' ? 'is-active' : ''} onClick={() => selectScope('upcoming')}>未来 14 天</button>
              </div>
              <div className="eb-adjust-scope-summary">
                <div className="eb-adjust-scope-counter">
                  <strong>{selectedKeys.size}</strong>
                  <span>个计划 · {selectedPending} 个未完成轮次 · {selectedMinutes} 分钟</span>
                </div>
                {selectedOverdue > 0 && <div className="eb-adjust-scope-overdue">{selectedOverdue} 逾期</div>}
              </div>
              <div className="eb-adjust-picker">
                <div className="eb-adjust-task-heading"><strong>待重新安排</strong><span>{visibleTopics.length} 个计划</span></div>
                <div className="eb-adjust-picker-toolbar">
                  <div className="eb-adjust-filters">
                    <label className="eb-batch-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索复习主题" aria-label="搜索复习主题" /></label>
                    <select value={complexityFilter} onChange={(event) => setComplexityFilter(event.target.value as ComplexityFilter)} aria-label="难度筛选">
                      <option value="all">全部难度</option><option value="easy">简单</option><option value="normal">普通</option><option value="hard">困难</option><option value="custom">自定义</option>
                    </select>
                  </div>
                  <button type="button" className="eb-batch-link" onClick={toggleVisible}>{allVisibleSelected ? '取消当前全选' : '全选当前结果'}</button>
                </div>
                  <div className="eb-adjust-topic-grid">
                    {visibleTopics.map((topic) => (
                      <label
                        key={topic.key}
                        className={`eb-adjust-topic ${selectedKeys.has(topic.key) ? 'is-selected' : ''} ${topic.pending === 0 ? 'is-disabled' : ''}`}
                        aria-label={`${topic.name}，${topic.pending}/${topic.total} 未完成，约 ${topic.minutes} 分钟${topic.nextDueDate ? `，下一轮 ${formatShortDate(topic.nextDueDate)}` : ''}`}
                      >
                        <input type="checkbox" disabled={topic.pending === 0} checked={selectedKeys.has(topic.key)} onChange={() => setSelectedKeys((current) => {
                          const next = new Set(current);
                          if (next.has(topic.key)) next.delete(topic.key); else next.add(topic.key);
                          return next;
                        })} />
                        <span className="eb-adjust-topic-body">
                          <span className="eb-adjust-topic-main"><strong title={topic.name}>{topic.name}</strong><small>{topic.pending}/{topic.total} · 剩余 {topic.minutes} 分钟</small></span>
                          <span className="eb-adjust-topic-dates">
                            {topic.nextDueDate ? <>原 {formatShortDate(topic.nextDueDate)} <b>→</b> {selectedKeys.has(topic.key) ? `新 ${formatShortDate(previewDatesByTopic.get(topic.key) ?? topic.nextDueDate)}` : '未选择'}</> : '等待排期'}
                          </span>
                        </span>
                        {topic.overdue > 0 && <em>{topic.overdue} 轮逾期</em>}
                      </label>
                    ))}
                    {visibleTopics.length === 0 && <div className="eb-batch-empty"><ListChecks size={18} />没有匹配的复习计划</div>}
                </div>
              </div>
            </section>
          )}

          {(
            <section className="eb-adjust-section eb-adjust-goals" aria-labelledby="adjust-step-goal">
              <div className="eb-adjust-section-title"><div><Sparkles size={18} /><div><h4 id="adjust-step-goal">调整方式</h4><p>点击目标后下方参数与右侧结果会立即更新。</p></div></div></div>
              {selectedOverdue > 0 && <div className="eb-adjust-recommendation"><Sparkles size={16} /><span><strong>推荐：清理逾期与积压</strong>已选择计划中有 {selectedOverdue} 个逾期轮次，可优先消化并联动后续安排。</span></div>}
              <div className="eb-adjust-goal-grid" role="radiogroup" aria-label="调整方式">
                {GOALS.filter((goal) => QUICK_GOAL_KINDS.includes(goal.kind) || showMoreGoals).map((goal) => (
                  <button
                    key={goal.kind}
                    type="button"
                    role="radio"
                    aria-checked={goalKind === goal.kind}
                    className={goalKind === goal.kind ? 'is-active' : ''}
                    onClick={() => setGoalKind(goal.kind)}
                  >
                    <span className="eb-adjust-goal-icon">{goal.icon}</span>
                    <span><strong>{goal.label}</strong><small>{goal.description}</small></span>
                    {goalKind === goal.kind && <Check size={16} className="eb-adjust-goal-check" aria-hidden="true" />}
                  </button>
                ))}
                <button
                  type="button"
                  className={`eb-adjust-more-goals ${showMoreGoals ? 'is-active' : ''}`}
                  aria-expanded={showMoreGoals}
                  onClick={() => {
                    const next = !showMoreGoals;
                    setShowMoreGoals(next);
                    if (!next && !QUICK_GOAL_KINDS.includes(goalKind)) setGoalKind('balance');
                  }}
                >
                  <span className="eb-adjust-goal-icon"><SlidersHorizontal size={14} /></span>
                  <span><strong>{showMoreGoals ? '收起高级调整' : '高级调整'}</strong><small>计划维护与精确工具</small></span>
                  <ChevronRight size={14} style={{ transform: showMoreGoals ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} aria-hidden="true" />
                </button>
              </div>
              <p className="eb-adjust-goal-help">{GOALS.find((goal) => goal.kind === goalKind)?.description}</p>
              {goalKind === 'advanced' && (
                <div className="eb-adjust-preset-sublist">
                  <small className="eb-adjust-preset-hint">选择一个精确操作</small>
                  <div className="eb-batch-actions">
                    {ADVANCED_ACTIONS.map((action) => (
                      <label key={action.kind} className={`eb-batch-action ${advancedKind === action.kind ? 'is-active' : ''}`}>
                        <input type="radio" name="batch-advanced-action" checked={advancedKind === action.kind} onChange={() => setAdvancedKind(action.kind)} />
                        <span className="eb-batch-action-icon">{action.icon}</span><span><strong>{action.label}</strong><small>{action.description}</small></span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {(
            <details className="eb-adjust-section eb-adjust-options" aria-labelledby="adjust-step-constraints">
              <summary><span><SlidersHorizontal size={16} /><span><strong id="adjust-step-constraints">参数与保护规则</strong><small>{ruleSummary}</small></span></span><em>展开</em></summary>

              {(goalKind === 'backlog' || goalKind === 'balance') && (
                <div className="eb-adjust-preset-sublist" aria-label="规划预设">
                  <div className="eb-adjust-preset-heading">
                    <small className="eb-adjust-preset-hint">调整强度</small>
                    <span className={planningPreset === 'custom' ? 'is-custom' : ''}>当前：{planningPresetLabel}</span>
                  </div>
                  <div className="eb-adjust-preset-row" role="group" aria-label="规划预设">
                    {PLANNING_PRESETS.map((preset) => {
                      const impact = presetImpacts[preset.kind];
                      return (
                        <button
                          key={preset.kind}
                          type="button"
                          title={impact ? `${impact.moved} 轮改期 · 超载 ${impact.overloadBefore}→${impact.overloadAfter}` : preset.description}
                          className={planningPreset === preset.kind ? 'is-active' : ''}
                          onClick={() => applyPlanningPreset(preset.kind)}
                        >
                          <strong>{preset.label.replace('调整', '').replace('清理', '')}</strong>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {(goalKind === 'backlog' || goalKind === 'balance') && (
                <div className="eb-adjust-form-grid">
                  <label><span>规划开始日期</span><input type="date" min={today} value={startDate} onChange={(event) => { setStartDate(event.target.value); setPlanningPreset('custom'); }} /></label>
                  <label><span>规划范围</span><select value={horizonDays} onChange={(event) => { setHorizonDays(Number(event.target.value)); setPlanningPreset('custom'); }}><option value={7}>未来 7 天</option><option value={14}>未来 14 天</option><option value={30}>未来 30 天</option><option value={60}>未来 60 天</option></select></label>
                  <label><span>每日复习容量</span><div className="eb-adjust-input-unit"><input type="number" min={15} max={1440} value={capacityMinutes} onChange={(event) => { setCapacityMinutes(Number(event.target.value)); setPlanningPreset('custom'); }} /><em>分钟</em></div></label>
                  <label><span>每日最多轮次</span><div className="eb-adjust-input-unit"><input type="number" min={1} max={99} value={maxRoundsPerDay} onChange={(event) => { setMaxRoundsPerDay(Number(event.target.value)); setPlanningPreset('custom'); }} /><em>轮</em></div></label>
                  <label><span>最大移动范围</span><div className="eb-adjust-input-unit"><input type="number" min={0} max={365} value={maxMoveDays} onChange={(event) => { setMaxMoveDays(Number(event.target.value)); setPlanningPreset('custom'); }} /><em>天</em></div></label>
                  <label><span>可选截止日期</span><input type="date" min={startDate} value={deadline} onChange={(event) => { setDeadline(event.target.value); setPlanningPreset('custom'); }} /></label>
                </div>
              )}

              {(goalKind === 'cadence' || (goalKind === 'lifecycle' && lifecycleOperation === 'restart') || (goalKind === 'advanced' && advancedKind === 'template')) && (
                <div className="eb-adjust-form-grid">
                  <label><span>未来节奏起点</span><input type="date" min={today} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
                  <label><span>节奏模板</span><select value={cadencePreset} onChange={(event) => setCadencePreset(event.target.value as typeof cadencePreset)}><option value="easy">{settings.complexityConfigs.easy.label} · {settings.complexityConfigs.easy.intervals.join(', ')}</option><option value="normal">{settings.complexityConfigs.normal.label} · {settings.complexityConfigs.normal.intervals.join(', ')}</option><option value="hard">{settings.complexityConfigs.hard.label} · {settings.complexityConfigs.hard.intervals.join(', ')}</option><option value="custom">自定义间隔</option></select></label>
                  {cadencePreset === 'custom' && <label className="is-wide"><span>间隔天数</span><input value={customIntervals} onChange={(event) => setCustomIntervals(event.target.value)} placeholder="1, 2, 4, 7, 15" />{hasInvalidIntervals && <small className="is-error">请输入以逗号分隔的正整数</small>}</label>}
                </div>
              )}

              {goalKind === 'lifecycle' && (
                <div className="eb-adjust-lifecycle">
                  <label className={lifecycleOperation === 'trim' ? 'is-active' : ''}><input type="radio" name="lifecycle" checked={lifecycleOperation === 'trim'} onChange={() => setLifecycleOperation('trim')} /><Trash2 size={16} /><span><strong>缩短计划</strong><small>删除末尾未完成轮次</small></span></label>
                  <label className={lifecycleOperation === 'append' ? 'is-active' : ''}><input type="radio" name="lifecycle" checked={lifecycleOperation === 'append'} onChange={() => setLifecycleOperation('append')} /><Plus size={16} /><span><strong>延长计划</strong><small>按照当前节奏追加轮次</small></span></label>
                  <label className={lifecycleOperation === 'restart' ? 'is-active' : ''}><input type="radio" name="lifecycle" checked={lifecycleOperation === 'restart'} onChange={() => setLifecycleOperation('restart')} /><RefreshCcw size={16} /><span><strong>重建未来周期</strong><small>保留完成历史，替换所有未来轮次</small></span></label>
                  {lifecycleOperation !== 'restart' && <label className="eb-adjust-count"><span>{lifecycleOperation === 'trim' ? '删除' : '追加'}轮数</span><input type="number" min={1} max={12} value={lifecycleCount} onChange={(event) => setLifecycleCount(Number(event.target.value))} /></label>}
                </div>
              )}

              {goalKind === 'advanced' && advancedKind !== 'template' && (
                <div className="eb-adjust-form-grid">
                  {advancedKind === 'reanchor' && <label><span>每个计划的下一轮</span><input type="date" min={today} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>}
                  {advancedKind === 'shift' && <label><span>移动天数</span><div className="eb-adjust-input-unit"><input type="number" min={-365} max={365} value={shiftDays} onChange={(event) => setShiftDays(Number(event.target.value))} /><em>正数顺延</em></div></label>}
                  {(advancedKind === 'trim' || advancedKind === 'append') && <label><span>{advancedKind === 'trim' ? '删除' : '追加'}轮数</span><input type="number" min={1} max={12} value={lifecycleCount} onChange={(event) => setLifecycleCount(Number(event.target.value))} /></label>}
                </div>
              )}

              <fieldset className="eb-adjust-daily-policy">
                <legend>每日安排保护</legend>
                <label className={dailyHandling === 'protect' ? 'is-active' : ''}><input type="radio" name="daily-handling" checked={dailyHandling === 'protect'} onChange={() => { setDailyHandling('protect'); setPlanningPreset('custom'); }} /><span><strong>保护已手动安排的轮次</strong><small>这些轮次保持原日期，其他轮次仍可调整</small></span></label>
                <label className={dailyHandling === 'return' ? 'is-active' : ''}><input type="radio" name="daily-handling" checked={dailyHandling === 'return'} onChange={() => { setDailyHandling('return'); setPlanningPreset('custom'); }} /><span><strong>日期变化时返回任务池</strong><small>清除旧日期安排，避免留下失效引用</small></span></label>
              </fieldset>
            </details>
          )}
          </div>

          {(
            <section className="eb-adjust-section eb-adjust-preview" aria-labelledby="adjust-step-preview">
              <div className="eb-adjust-section-title"><div><Gauge size={18} /><div><h4 id="adjust-step-preview">排期结果</h4><p>范围、方式或参数变化后自动更新。</p></div></div></div>
              <div className={`eb-adjust-verdict is-${verdictKind}`} role="status">
                {verdictKind === 'safe' ? <CheckCircle size={18} /> : verdictKind === 'blocked' ? <X size={18} /> : <AlertTriangle size={18} />}
                <span><strong>{verdictKind === 'safe' ? '可以执行' : verdictKind === 'blocked' ? '需要先解决' : '请注意'}</strong>{verdictText}</span>
              </div>
              <div className="eb-adjust-impact-grid" aria-label="批量调整预览统计">
                <span><small>会修改计划</small><strong>{preview.affectedTopics}</strong><em>{preview.affectedTopics === 0 ? '无需任何修改' : `共 ${preview.affectedTopics} 个主题`}</em></span>
                <span className={preview.rescheduledRounds > 0 ? 'is-warn' : ''}><small>轮次改期</small><strong>{preview.rescheduledRounds}</strong><em>已移到新日期</em></span>
                <span className={overloadAfter > 0 ? 'is-danger' : overloadAfter < overloadBefore ? 'is-good' : ''}><small>超载日期</small><strong>{overloadBefore} → {overloadAfter}</strong><em>{overloadAfter === 0 ? '已全部消化' : '仍需关注'}</em></span>
                {preview.removedRounds > 0 && <span className="is-danger"><small>轮次移除</small><strong>{preview.removedRounds}</strong><em>删除的多余轮次</em></span>}
                {preview.addedRounds > 0 && <span><small>轮次新增</small><strong>{preview.addedRounds}</strong><em>补齐的规划</em></span>}
                {impactedDailyCount > 0 && <span className="is-warn"><small>每日安排</small><strong>{impactedDailyCount}</strong><em>个引用会受影响</em></span>}
              </div>

              {(preview.warnings?.length ?? 0) > 0 && <div className="eb-adjust-warnings">{preview.warnings!.map((warning) => <p key={warning}><AlertTriangle size={14} />{warning}</p>)}</div>}
              {(preview.blockingIssues?.length ?? 0) > 0 && <div className="eb-adjust-blocking">{preview.blockingIssues!.map((issue) => <p key={issue}><X size={14} />{issue}</p>)}</div>}

              <div className="eb-adjust-preview-block eb-adjust-load-preview">
                <div className="eb-adjust-preview-heading"><strong>未来负荷安排</strong><span>灰色为调整前，紫色为调整后；虚线代表每日容量。</span></div>
                <div className="eb-adjust-load-chart" aria-label="调整前后每日负荷">
                  {(preview.dayLoads ?? []).map((day) => {
                    const scale = Math.max(day.capacityMinutes, day.beforeMinutes, day.afterMinutes, 1);
                    return <div key={day.date} className={day.afterOverCapacity ? 'is-over' : ''} title={`${day.date}：${day.beforeMinutes} → ${day.afterMinutes} 分钟`}>
                      <span className="eb-adjust-load-bars"><i style={{ height: `${Math.max(3, day.beforeMinutes / scale * 100)}%` }} /><b style={{ height: `${Math.max(3, day.afterMinutes / scale * 100)}%` }} /><em style={{ bottom: `${Math.min(100, day.capacityMinutes / scale * 100)}%` }} /></span>
                      <small>{formatShortDate(day.date)}</small><strong>{day.afterMinutes}</strong>
                    </div>;
                  })}
                </div>
              </div>

              <details className="eb-adjust-disclosure eb-adjust-preview-details" open={initialPreviewExpanded || undefined}>
                <summary>查看逐计划安排明细 <span>{preview.results.length} 项</span></summary>
                  <div className="eb-adjust-preview-block">
                    <div className="eb-adjust-preview-heading"><strong>逐计划结果</strong><span>{preview.skippedTopics > 0 ? `${preview.skippedTopics} 个未修改，原因如下。` : '所有选中计划均已生成明确结果。'}</span></div>
                    <div className="eb-batch-preview-list">
                      {preview.results.map((result) => (
                        <div key={result.topicKey} className={`eb-batch-preview-row ${result.status === 'skipped' ? 'is-skipped' : ''}`}>
                          <span className="eb-batch-preview-status">{result.status === 'changed' ? <Check size={13} /> : '—'}</span>
                          <span className="eb-batch-preview-name">{result.topicName}</span>
                          <span className="eb-batch-preview-description">{result.description}</span>
                          <span className="eb-batch-preview-count">{result.beforeCount} → {result.afterCount}</span>
                        </div>
                      ))}
                      {preview.results.length === 0 && <div className="eb-batch-empty"><ListChecks size={18} />请选择至少一个复习计划</div>}
                    </div>
                  </div>

                  <div className="eb-adjust-safety-note"><Check size={15} /><span><strong>执行保障</strong>已完成历史不会改变；日期变化会同步清理失效的每日安排引用；本次调整支持立即撤销并通过统一工作区同步到其他设备。</span></div>
              </details>
            </section>
          )}
        </div>

        <div className="eb-panel-footer eb-batch-footer eb-adjust-footer">
          <div className="eb-adjust-footer-summary">
            <span>已选择 {selectedKeys.size} 个计划 · {preview.affectedTopics} 个会修改 · {preview.rescheduledRounds} 轮改期</span>
            {(goalKind === 'backlog' || goalKind === 'balance') && planningPreset === 'custom' && (
              <button type="button" className="eb-batch-link" onClick={() => applyPlanningPreset('balanced')}>恢复均衡设置</button>
            )}
          </div>
          <div>
            <button type="button" className="eb-btn eb-btn--ghost" onClick={onClose}>取消</button>
            <button type="button" className="eb-btn eb-btn--primary" disabled={!canApply} onClick={handleApply}>执行调整 {preview.affectedTopics > 0 ? `· ${preview.affectedTopics} 个计划` : ''}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default BatchAdjustPanel;
