// ============================================================
// Ebb - 轮次管理面板（Phase 3）
// 查看某主题的所有轮次 · 改期 · 删除单轮 · 追加轮次 · 完成进度
// ============================================================

import React, { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Calendar, Trash2, Plus } from 'lucide-react';
import { addDays, formatDate, todayStr } from '@/utils/dateSafe';
import { useEbbStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { computeRounds, getDateLabel, suggestNextInterval, isOverdue, genId } from '../scheduler';
import { getPointWeight } from '../complexity';
import { parseIntervals } from '../complexity';
import { ROUND_COLORS } from '../constants';
import EbbDatePicker from './EbbDatePicker';

interface RoundsPanelProps {
  topicName: string;
  onClose: () => void;
}

const RoundsPanel: React.FC<RoundsPanelProps> = ({ topicName, onClose }) => {
  const {
    reviewTasks,
    ebbSettings,
    updateReviewTask,
    deleteReviewTask,
    addReviewTasks,
    toggleReviewTask,
  } = useEbbStore(
    useShallow((s) => ({
      reviewTasks: s.reviewTasks,
      ebbSettings: s.ebbSettings,
      updateReviewTask: s.updateReviewTask,
      deleteReviewTask: s.deleteReviewTask,
      addReviewTasks: s.addReviewTasks,
      toggleReviewTask: s.toggleReviewTask,
    })),
  );
  const [datePickerTaskId, setDatePickerTaskId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // 该主题所有任务，按 dueDate 升序
  const topicTasks = useMemo(
    () =>
      reviewTasks
        .filter((t) => t.topicName === topicName)
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
    [reviewTasks, topicName],
  );

  const { roundMap, totalRoundsMap } = useMemo(
    () => computeRounds(reviewTasks),
    [reviewTasks],
  );

  const totalRounds = totalRoundsMap.get(topicName) ?? topicTasks.length;
  const completedCount = topicTasks.filter((t) => t.isCompleted).length;
  const ratio = topicTasks.length > 0 ? completedCount / topicTasks.length : 0;

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
    setDatePickerTaskId(taskId);
  }, []);

  const handleDateSelect = useCallback(
    (newDate: string | undefined) => {
      if (datePickerTaskId && newDate) {
        updateReviewTask(datePickerTaskId, { dueDate: newDate });
      }
      setDatePickerTaskId(null);
    },
    [datePickerTaskId, updateReviewTask],
  );

  // 删除单轮
  const handleDeleteRound = useCallback(
    (id: string) => {
      deleteReviewTask(id);
      setConfirmDeleteId(null);
    },
    [deleteReviewTask],
  );

  // 追加一轮
  const handleAddRound = useCallback(() => {
    const lastTask = topicTasks[topicTasks.length - 1];
    if (!lastTask) return;
    const completedRounds = topicTasks.filter((t) => t.isCompleted).length;
    const nextInterval = suggestNextInterval(
      completedRounds,
      lastTask.complexity,
      parseIntervals(ebbSettings.customIntervals) ?? undefined,
    );
    const baseDate = lastTask ? lastTask.dueDate : undefined;
    let newDate = baseDate ? addDays(baseDate, nextInterval) : addDays(todayStr(), nextInterval);

    // 去重
    const topicDates = new Set(topicTasks.map((t) => t.dueDate));
    while (topicDates.has(newDate)) {
      newDate = addDays(newDate, 1);
    }

    addReviewTasks([
      {
        id: genId('rt'),
        topicName,
        dueDate: newDate,
        isCompleted: false,
        tag: lastTask.tag,
        complexity: lastTask.complexity,
        smStatus: 'scheduled',
      },
    ]);
  }, [topicTasks, topicName, ebbSettings.customIntervals, addReviewTasks]);

  // 勾选
  const handleToggle = useCallback(
    (id: string) => {
      toggleReviewTask(id);
    },
    [toggleReviewTask],
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
              const isConfirming = confirmDeleteId === t.id;

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

                  {/* 日期 */}
                  <span className={`eb-date-pill eb-date-pill--${dateLabel.variant}`}>
                    {dateLabel.text}
                  </span>

                  {/* 完成日期 */}
                  {t.completedDate && (
                    <span className="eb-round-completed-date">
                      {formatDate(t.completedDate, 'M.D')}
                    </span>
                  )}

                  {/* 积分 */}
                  {points > 0 && (
                    <span className="eb-round-points">{points}分</span>
                  )}

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
                    <button
                      type="button"
                      className={`eb-icon-btn eb-icon-btn--danger ${isConfirming ? 'eb-icon-btn--confirm' : ''}`}
                      onClick={() => {
                        if (isConfirming) {
                          handleDeleteRound(t.id);
                        } else {
                          setConfirmDeleteId(t.id);
                          setTimeout(() => setConfirmDeleteId(null), 2500);
                        }
                      }}
                      title={isConfirming ? '再次点击确认删除' : '删除此轮'}
                    >
                      <Trash2 size={13} />
                    </button>
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
          <EbbDatePicker
            anchorEl={null}
            value={datePickerValue}
            onSelect={handleDateSelect}
            onClose={() => setDatePickerTaskId(null)}
          />
        )}
      </div>
    </div>,
    document.body,
  );
};

export default RoundsPanel;
