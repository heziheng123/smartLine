// ============================================================
// Ebb - 轮次管理面板（Phase 3）
// 查看某主题的所有轮次 · 改期 · 删除单轮 · 追加轮次 · 完成进度
// ============================================================

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Calendar, Trash2, Plus, CalendarRange, RotateCcw, Clock3, ArrowRight, Sparkles } from 'lucide-react';
import { addDays, diffDays, formatDate, todayStr } from '@/utils/dateSafe';
import { useEbbStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { buildNextRoundTask, computeRounds, getDateLabel, getReviewTopicKey, isOverdue } from '../scheduler';
import { getPointWeight } from '../complexity';
import { ROUND_COLORS } from '../constants';
import EbbDatePicker from './EbbDatePicker';
import { requestManualReviewToggle } from '@/services/reviewCompletionCommands';
import {
  getDefaultReviewBaseDuration,
  getReviewBaseDuration,
  getReviewRoundDuration,
  REVIEW_DURATION_OPTIONS,
} from '../duration';
import { planReviewRoundReschedule } from '../reschedulePlanning';

interface RoundsPanelProps {
  topicKey: string;
  onClose: () => void;
}

type PendingChange =
  | { kind: 'reschedule'; title: string; description: string; updates: Array<{ id: string; dueDate: string }> }
  | { kind: 'delete'; title: string; description: string; taskId: string }
  | { kind: 'add'; title: string; description: string; task: ReturnType<typeof buildNextRoundTask> }
  | { kind: 'restart'; title: string; description: string; startDate: string };

const RoundsPanel: React.FC<RoundsPanelProps> = ({ topicKey, onClose }) => {
  const {
    reviewTasks,
    ebbSettings,
    deleteReviewTask,
    addReviewTasks,
    rescheduleReviewRounds,
    restartReviewCycle,
    updateReviewTask,
    updateReviewTopicDuration,
  } = useEbbStore(
    useShallow((s) => ({
      reviewTasks: s.reviewTasks,
      ebbSettings: s.ebbSettings,
      deleteReviewTask: s.deleteReviewTask,
      addReviewTasks: s.addReviewTasks,
      rescheduleReviewRounds: s.rescheduleReviewRounds,
      restartReviewCycle: s.restartReviewCycle,
      updateReviewTask: s.updateReviewTask,
      updateReviewTopicDuration: s.updateReviewTopicDuration,
    })),
  );
  const [datePickerTaskId, setDatePickerTaskId] = useState<string | null>(null);
  const [rescheduleChoiceTaskId, setRescheduleChoiceTaskId] = useState<string | null>(null);
  const [rescheduleMode, setRescheduleMode] = useState<'single' | 'following'>('single');
  const [isRestartDatePickerOpen, setIsRestartDatePickerOpen] = useState(false);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [replanOpen, setReplanOpen] = useState(false);
  const [replanStartDate, setReplanStartDate] = useState(addDays(todayStr(), 1));

  // 该主题所有任务，按 dueDate 升序
  const topicTasks = useMemo(
    () =>
      reviewTasks
        .filter((t) => !t.isArchived && getReviewTopicKey(t) === topicKey)
        .sort((a, b) =>
          (a.roundOrder ?? Number.MAX_SAFE_INTEGER) - (b.roundOrder ?? Number.MAX_SAFE_INTEGER)
          || (a.originalDueDate ?? a.dueDate ?? '').localeCompare(b.originalDueDate ?? b.dueDate ?? '')
          || a.id.localeCompare(b.id),
        ),
    [reviewTasks, topicKey],
  );

  const { roundMap, totalRoundsMap } = useMemo(
    () => computeRounds(reviewTasks),
    [reviewTasks],
  );

  const totalRounds = totalRoundsMap.get(topicKey) ?? topicTasks.length;
  const topicName = topicTasks[0]?.topicName ?? '';
  const completedCount = topicTasks.filter((t) => t.isCompleted).length;
  const ratio = topicTasks.length > 0 ? completedCount / topicTasks.length : 0;
  const durationTemplate = topicTasks.find((task) => task.baseDurationMinutes !== undefined) ?? topicTasks[0];
  const explicitBaseDuration = durationTemplate?.baseDurationMinutes;
  const automaticBaseDuration = getDefaultReviewBaseDuration(durationTemplate?.complexity);
  const effectiveBaseDuration = durationTemplate ? getReviewBaseDuration(durationTemplate) : automaticBaseDuration;
  const pendingTasks = useMemo(() => topicTasks.filter((task) => !task.isCompleted), [topicTasks]);
  const replanPreview = useMemo(() => {
    const first = pendingTasks[0];
    if (!first) return { updates: [] as Array<{ id: string; dueDate: string }>, invalid: '' };
    const delta = diffDays(replanStartDate, first.dueDate);
    const updates = pendingTasks.map((task) => ({ id: task.id, dueDate: addDays(task.dueDate, delta) }));
    const newDates = updates.map((update) => update.dueDate);
    if (new Set(newDates).size !== newDates.length) return { updates, invalid: '调整后会有两个未完成轮次落在同一天' };
    const latestCompleted = [...topicTasks].reverse().find((task) => task.isCompleted);
    if (latestCompleted && newDates[0] <= (latestCompleted.completedDate ?? latestCompleted.dueDate)) {
      return { updates, invalid: '下一轮不能早于最近一次实际完成日期' };
    }
    for (let index = 1; index < newDates.length; index += 1) {
      if (newDates[index] <= newDates[index - 1]) return { updates, invalid: '未完成轮次日期必须依次递增' };
    }
    return { updates, invalid: '' };
  }, [pendingTasks, replanStartDate, topicTasks]);

  const hasReplanChanges = replanPreview.updates.some(
    (update) => topicTasks.find((task) => task.id === update.id)?.dueDate !== update.dueDate,
  );

  const applyReplan = useCallback(() => {
    if (replanPreview.invalid || replanPreview.updates.length === 0 || !hasReplanChanges) return;
    rescheduleReviewRounds(replanPreview.updates);
    setActionError('');
    setActionNotice(`已从 ${formatDate(replanStartDate, 'M月D日')} 起重排 ${replanPreview.updates.length} 个未完成轮次`);
    setReplanOpen(false);
  }, [hasReplanChanges, replanPreview, replanStartDate, rescheduleReviewRounds]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 积分统计
  const pointsInfo = useMemo(() => {
    let earned = 0;
    let total = 0;
    for (const t of topicTasks) {
      const round = roundMap.get(t.id) ?? 0;
      if (t.complexity) {
        const w = getPointWeight(round, t.complexity, ebbSettings.complexityConfigs);
        total += w;
        if (t.isCompleted) earned += w;
      }
    }
    return { earned, total };
  }, [topicTasks, roundMap, ebbSettings.complexityConfigs]);

  // 改期
  const handleReschedule = useCallback((taskId: string) => {
    setRescheduleChoiceTaskId(taskId);
  }, []);

  const handleDateSelect = useCallback(
    (newDate: string | undefined) => {
      if (datePickerTaskId && newDate) {
        const targetIndex = topicTasks.findIndex((task) => task.id === datePickerTaskId);
        const target = topicTasks[targetIndex];
        if (!target) return;
        try {
          const plan = planReviewRoundReschedule(reviewTasks, datePickerTaskId, newDate, rescheduleMode);
          const delta = diffDays(newDate, target.dueDate);
          setPendingChange({
            kind: 'reschedule',
            title: rescheduleMode === 'following' ? '确认整体顺延' : '确认单轮改期',
            description: rescheduleMode === 'following'
              ? `将第 ${targetIndex + 1} 轮及之后 ${plan.updates.length} 个未完成轮次整体移动 ${Math.abs(delta)} 天${delta < 0 ? '（提前）' : delta > 0 ? '（顺延）' : ''}。已完成轮次不会改变。`
              : `第 ${targetIndex + 1} 轮将从 ${target.dueDate} 改为 ${newDate}，其他轮次不变。`,
            updates: plan.updates,
          });
          setActionError('');
        } catch (cause) {
          setActionError(cause instanceof Error ? cause.message : '轮次改期失败');
        }
      }
      setDatePickerTaskId(null);
    },
    [datePickerTaskId, rescheduleMode, reviewTasks, topicTasks],
  );

  // 删除单轮
  const handleDeleteRound = useCallback(
    (id: string) => {
      const target = topicTasks.find((task) => task.id === id);
      if (!target || target.isCompleted) return;
      setPendingChange({
        kind: 'delete',
        title: '确认删除未完成轮次',
        description: `删除后当前计划将从 ${topicTasks.length} 轮变为 ${topicTasks.length - 1} 轮，后续轮次编号会自动重排。`,
        taskId: id,
      });
    },
    [topicTasks],
  );

  // 追加一轮
  const handleAddRound = useCallback(() => {
    const nextRound = buildNextRoundTask(topicTasks, ebbSettings);
    if (!nextRound) return;

    setPendingChange({
      kind: 'add',
      title: '确认增加补充复习',
      description: `将在 ${nextRound.dueDate} 增加第 ${topicTasks.length + 1} 轮。若节点当前为金色，增加后会恢复为绿色，直至新轮次完成。`,
      task: nextRound,
    });
  }, [topicTasks, ebbSettings]);

  const handleRestartDateSelect = useCallback((startDate: string | undefined) => {
    setIsRestartDatePickerOpen(false);
    if (!startDate) return;
    const intervalCount = topicTasks[0]?.complexity
      ? ebbSettings.complexityConfigs[topicTasks[0].complexity!].intervals.length
      : ebbSettings.customIntervals.split(',').map(Number).filter((value) => Number.isInteger(value) && value > 0).length;
    setPendingChange({
      kind: 'restart',
      title: '确认重新开始复习计划',
      description: `当前 ${topicTasks.length} 个轮次将保留为历史记录并归档，从 ${startDate} 起重新生成 ${intervalCount} 个未完成轮次。已激活的知识节点会由金色回到绿色，节点激活状态本身不会改变。`,
      startDate,
    });
  }, [ebbSettings, topicTasks]);

  const applyPendingChange = useCallback(() => {
    if (!pendingChange) return;
    if (pendingChange.kind === 'reschedule') {
      rescheduleReviewRounds(pendingChange.updates);
    }
    if (pendingChange.kind === 'delete') {
      deleteReviewTask(pendingChange.taskId);
      if (topicTasks.length === 1) onClose();
    }
    if (pendingChange.kind === 'add' && pendingChange.task) addReviewTasks([pendingChange.task]);
    if (pendingChange.kind === 'restart') restartReviewCycle(topicKey, pendingChange.startDate);
    setPendingChange(null);
    setActionError('');
  }, [addReviewTasks, deleteReviewTask, onClose, pendingChange, rescheduleReviewRounds, restartReviewCycle, topicKey, topicTasks.length]);

  // 勾选
  const handleToggle = useCallback(
    async (id: string) => {
      const result = await requestManualReviewToggle(id);
      setActionError(result.cancelled ? '' : result.ok ? '' : result.message ?? '');
    },
    [],
  );

  // 当前改期任务的 dueDate
  const datePickerValue = useMemo(() => {
    if (!datePickerTaskId) return undefined;
    return reviewTasks.find((t) => t.id === datePickerTaskId)?.dueDate;
  }, [datePickerTaskId, reviewTasks]);

  return createPortal(
    <div className="eb-panel-overlay" onClick={onClose}>
      <div className="eb-panel eb-panel--rounds" role="dialog" aria-modal="true" aria-label={`复习计划 ${topicName}`} onClick={(e) => e.stopPropagation()}>
        <div className="eb-panel-header">
          <h3 className="eb-panel-title">复习计划 · {topicName}</h3>
          <button type="button" className="eb-panel-close" onClick={onClose} aria-label="关闭复习计划">
            <X size={16} />
          </button>
        </div>

        <div className="eb-panel-body">
          {actionError && <div className="eb-field-error">{actionError}</div>}
          {actionNotice && <div className="eb-action-notice" role="status">{actionNotice}</div>}
          {/* 进度概览 */}
          <div className="eb-rounds-summary">
            <div className="eb-rounds-stats">
              <div className="eb-rounds-stat">
                <span className="eb-rounds-stat-value">{completedCount}/{totalRounds}</span>
                <span className="eb-rounds-stat-label">已完成</span>
              </div>
              <div className="eb-rounds-stat">
                <span className="eb-rounds-stat-value">{pointsInfo.earned}/{pointsInfo.total}</span>
                <span className="eb-rounds-stat-label">积分</span>
              </div>
            </div>
            <div className="eb-rounds-progress">
              <div className="eb-rounds-progress-bar">
                <div
                  className="eb-rounds-progress-fill"
                  style={{ width: `${ratio * 100}%` }}
                />
              </div>
              <span className="eb-rounds-progress-text">{Math.round(ratio * 100)}%</span>
            </div>
          </div>

          {pendingTasks.length > 0 && (
            <section className="eb-replan-card" aria-label="重新安排剩余轮次">
              <div className="eb-replan-card-head">
                <div><span><Sparkles size={14} />推荐操作</span><strong>重新安排剩余 {pendingTasks.length} 轮</strong><small>已完成 {completedCount} 轮锁定不变；默认保持当前轮次间隔。</small></div>
                {!replanOpen && <button type="button" className="eb-btn eb-btn--primary eb-btn--sm" onClick={() => { setActionNotice(''); setReplanOpen(true); }}>重新安排</button>}
              </div>
              {replanOpen && (
                <div className="eb-replan-editor">
                  <div className="eb-replan-fields">
                    <label><span>下一轮安排在</span><input type="date" min={todayStr()} value={replanStartDate} onChange={(event) => setReplanStartDate(event.target.value)} /></label>
                    <div className="eb-replan-shortcuts">
                      <button type="button" onClick={() => setReplanStartDate(todayStr())}>今天</button>
                      <button type="button" onClick={() => setReplanStartDate(addDays(todayStr(), 1))}>明天</button>
                    </div>
                    <div className="eb-replan-rhythm"><span>后续节奏</span><strong>保持当前间隔</strong><small>如需逐轮指定，可使用下方每轮的改期按钮。</small></div>
                  </div>
                  <div className="eb-replan-preview" aria-label="剩余轮次日期预览">
                    {pendingTasks.map((task, index) => {
                      const nextDate = replanPreview.updates.find((update) => update.id === task.id)?.dueDate ?? task.dueDate;
                      const unchanged = nextDate === task.dueDate;
                      return <div key={task.id} className={unchanged ? 'is-unchanged' : ''}><span>R{task.roundOrder ?? completedCount + index + 1}</span>{unchanged ? <><strong>{formatDate(nextDate, 'M.D')}</strong><em>不变</em></> : <><b>{formatDate(task.dueDate, 'M.D')}</b><ArrowRight size={12} /><strong>{formatDate(nextDate, 'M.D')}</strong></>}</div>;
                    })}
                  </div>
                  {replanPreview.invalid && <div className="eb-field-error">{replanPreview.invalid}</div>}
                  {!replanPreview.invalid && !hasReplanChanges && <div className="eb-replan-unchanged">当前下一轮已经是这个日期，无需保存。</div>}
                  <div className="eb-replan-actions"><button type="button" className="eb-btn eb-btn--ghost eb-btn--sm" onClick={() => setReplanOpen(false)}>取消</button><button type="button" className="eb-btn eb-btn--primary eb-btn--sm" disabled={Boolean(replanPreview.invalid) || !hasReplanChanges} onClick={applyReplan}>保存调整</button></div>
                </div>
              )}
            </section>
          )}

          {durationTemplate && (
            <div className="eb-field" style={{ marginBottom: 16 }}>
              <span className="eb-field-label">
                主题基础时长
                <span className="eb-field-hint">自动跟随难度，或为整个主题设置自定义时长</span>
              </span>
              <div className="eb-complexity-switch" role="group" aria-label="主题基础时长">
                <button
                  type="button"
                  className={`eb-complexity-btn ${explicitBaseDuration === undefined ? 'eb-complexity-btn--active' : ''}`}
                  onClick={() => updateReviewTopicDuration(topicKey, undefined)}
                >
                  自动 {automaticBaseDuration}m
                </button>
                {REVIEW_DURATION_OPTIONS.filter((value) => value >= 10).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`eb-complexity-btn ${explicitBaseDuration === value ? 'eb-complexity-btn--active' : ''}`}
                    onClick={() => updateReviewTopicDuration(topicKey, value)}
                  >
                    {value}m
                  </button>
                ))}
              </div>
              <span className="eb-field-hint">当前基础 {effectiveBaseDuration} 分钟；R1 为100%，R2–R3 为80%，R4以后为60%。</span>
            </div>
          )}

          {/* 轮次列表 */}
          <div className="eb-rounds-list">
            {topicTasks.map((t, i) => {
              const round = roundMap.get(t.id) ?? i + 1;
              const color = ROUND_COLORS[(round - 1) % ROUND_COLORS.length];
              const dateLabel = getDateLabel(t.dueDate, t.isCompleted);
              const points = t.complexity
                ? getPointWeight(round, t.complexity, ebbSettings.complexityConfigs)
                : 0;
              const overdue = isOverdue(t);

              return (
                <div
                  key={t.id}
                  className={[
                    'eb-round-row',
                    t.isCompleted ? 'eb-round-row--done' : '',
                    overdue ? 'eb-round-row--overdue' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {/* 轮次指示点 */}
                  <div
                    className="eb-round-dot"
                    style={{ backgroundColor: color }}
                  />

                  {/* 轮次号 */}
                  <span className="eb-round-number">R{round}</span>

                  {/* 完成勾选 */}
                  <input
                    type="checkbox"
                    className="eb-round-check"
                    checked={t.isCompleted}
                    onChange={() => handleToggle(t.id)}
                  />

                  {/* 计划日期与执行日期 */}
                  <div className="eb-round-dates">
                    <span className={`eb-date-pill eb-date-pill--${dateLabel.variant}`}>
                      计划 {dateLabel.text}
                    </span>
                    {t.originalDueDate && t.originalDueDate !== t.dueDate && (
                      <span className="eb-round-original-date">原计划 {formatDate(t.originalDueDate, 'M.D')}</span>
                    )}
                    {t.completedDate && (
                      <span className="eb-round-completed-date">实际 {formatDate(t.completedDate, 'M.D')}</span>
                    )}
                  </div>

                  {/* 积分 */}
                  {points > 0 && (
                    <span className="eb-round-points">{points}分</span>
                  )}

                  <label className="eb-round-duration" title="可仅覆盖这一轮的预计时长">
                    <Clock3 size={12} />
                    <select
                      value={t.durationOverrideMinutes ?? 'auto'}
                      disabled={t.isCompleted}
                      aria-label={`第${round}轮预计时长`}
                      onChange={(event) => updateReviewTask(t.id, {
                        durationOverrideMinutes: event.target.value === 'auto'
                          ? undefined
                          : Number(event.target.value),
                      })}
                    >
                      <option value="auto">自动 {getReviewRoundDuration({ ...t, durationOverrideMinutes: undefined }, round)}m</option>
                      {REVIEW_DURATION_OPTIONS.map((value) => <option key={value} value={value}>{value}m</option>)}
                    </select>
                  </label>

                  {/* 操作按钮 */}
                  <div className="eb-round-actions">
                    {!t.isCompleted && (
                      <button
                        type="button"
                        className="eb-icon-btn"
                        onClick={() => handleReschedule(t.id)}
                        title="改期"
                      >
                        <Calendar size={13} />
                      </button>
                    )}
                    {!t.isCompleted && (
                      <button type="button" className="eb-icon-btn eb-icon-btn--danger" onClick={() => handleDeleteRound(t.id)} title="删除此未完成轮次">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 空状态 */}
          {topicTasks.length === 0 && (
            <div className="eb-rounds-empty">
              <div className="eb-rounds-empty-text">该主题暂无轮次</div>
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="eb-panel-footer">
          <button type="button" className="eb-btn eb-btn--ghost eb-btn--sm" onClick={() => setIsRestartDatePickerOpen(true)}>
            <RotateCcw size={14} />
            重新开始完整周期
          </button>
          <button
            type="button"
            className="eb-btn eb-btn--secondary eb-btn--sm"
            onClick={handleAddRound}
          >
            <Plus size={14} />
            追加一轮
          </button>
          <button type="button" className="eb-btn eb-btn--ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        {/* 日期选择器 */}
        {datePickerTaskId && (
          <EbbDatePicker anchorEl={null} value={datePickerValue} onSelect={handleDateSelect} onClose={() => setDatePickerTaskId(null)} />
        )}
        {rescheduleChoiceTaskId && (
          <div className="eb-change-preview-overlay" onClick={() => setRescheduleChoiceTaskId(null)}>
            <div className="eb-reschedule-mode" onClick={(event) => event.stopPropagation()}>
              <div className="eb-reschedule-mode-title">选择改期方式</div>
              <button type="button" onClick={() => { setRescheduleMode('single'); setDatePickerTaskId(rescheduleChoiceTaskId); setRescheduleChoiceTaskId(null); }}><Calendar size={14} />仅修改本轮</button>
              <button type="button" onClick={() => { setRescheduleMode('following'); setDatePickerTaskId(rescheduleChoiceTaskId); setRescheduleChoiceTaskId(null); }}><CalendarRange size={14} />本轮及后续整体顺延</button>
            </div>
          </div>
        )}
        {isRestartDatePickerOpen && (
          <EbbDatePicker anchorEl={null} value={todayStr()} onSelect={handleRestartDateSelect} onClose={() => setIsRestartDatePickerOpen(false)} />
        )}
        {pendingChange && (
          <div className="eb-change-preview-overlay" onClick={() => setPendingChange(null)}>
            <div className="eb-change-preview" onClick={(event) => event.stopPropagation()}>
              <div className="eb-change-preview-title">{pendingChange.title}</div>
              <p>{pendingChange.description}</p>
              <div className="eb-change-preview-actions">
                <button type="button" className="eb-btn eb-btn--ghost eb-btn--sm" onClick={() => setPendingChange(null)}>取消</button>
                <button type="button" className="eb-btn eb-btn--primary eb-btn--sm" onClick={applyPendingChange}>确认执行</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default RoundsPanel;
