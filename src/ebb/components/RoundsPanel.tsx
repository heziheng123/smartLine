// ============================================================
// Ebb - 轮次管理面板（Phase 3）
// 查看某主题的所有轮次 · 改期 · 删除单轮 · 追加轮次 · 完成进度
// ============================================================

import React, { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Calendar, Trash2, Plus, CalendarRange, RotateCcw, Clock3 } from 'lucide-react';
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
        const delta = diffDays(newDate, target.dueDate);
        const affected = rescheduleMode === 'following'
          ? topicTasks.slice(targetIndex).filter((task) => !task.isCompleted)
          : [target];
        const updates = affected.map((task) => ({
          id: task.id,
          dueDate: task.id === target.id ? newDate : addDays(task.dueDate, delta),
        }));
        const updateMap = new Map(updates.map((item) => [item.id, item.dueDate]));
        const resultingDates = topicTasks.map((task) => updateMap.get(task.id) ?? task.dueDate);
        if (new Set(resultingDates).size !== resultingDates.length) {
          setActionError('同一主题在该日期已经有复习轮次，请选择其他日期。');
          setDatePickerTaskId(null);
          return;
        }
        setPendingChange({
          kind: 'reschedule',
          title: rescheduleMode === 'following' ? '确认整体顺延' : '确认单轮改期',
          description: rescheduleMode === 'following'
            ? `将第 ${targetIndex + 1} 轮及之后 ${updates.length} 个未完成轮次整体移动 ${Math.abs(delta)} 天${delta < 0 ? '（提前）' : delta > 0 ? '（顺延）' : ''}。已完成轮次不会改变。`
            : `第 ${targetIndex + 1} 轮将从 ${target.dueDate} 改为 ${newDate}，其他轮次不变。`,
          updates,
        });
        setActionError('');
      }
      setDatePickerTaskId(null);
    },
    [datePickerTaskId, rescheduleMode, topicTasks],
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
      <div className="eb-panel eb-panel--rounds" onClick={(e) => e.stopPropagation()}>
        <div className="eb-panel-header">
          <h3 className="eb-panel-title">轮次管理 · {topicName}</h3>
          <button type="button" className="eb-panel-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="eb-panel-body">
          {actionError && <div className="eb-field-error">{actionError}</div>}
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
            重新开始
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
