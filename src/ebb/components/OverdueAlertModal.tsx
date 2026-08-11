// ============================================================
// Ebb - 逾期任务提醒弹窗
// 启动时检测逾期任务，提示用户顺延或忽略
// ============================================================

import React, { useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Calendar, SkipForward, X } from 'lucide-react';
import { useEbbStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { getReviewTopicKey, isOverdue, computeRounds } from '../scheduler';
import { ROUND_COLORS } from '../constants';
import { diffDays, todayStr } from '@/utils/dateSafe';
import type { ReviewTask } from '../types';
import { useSelectionSet } from '@/hooks/useSelectionSet';

interface OverdueAlertModalProps {
  onClose: () => void;
}

const OverdueAlertModal: React.FC<OverdueAlertModalProps> = ({ onClose }) => {
  const { reviewTasks, rescheduleOverdue } = useEbbStore(
    useShallow((s) => ({ reviewTasks: s.reviewTasks, rescheduleOverdue: s.rescheduleOverdue })),
  );
  const selection = useSelectionSet();
  const { selectedIds } = selection;

  // 所有逾期未完成任务
  const overdueTasks = useMemo(() => {
    return reviewTasks
      .filter((t) => !t.isCompleted && isOverdue(t))
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  }, [reviewTasks]);

  // 按主题分组
  const groupedByTopic = useMemo(() => {
    const map = new Map<string, ReviewTask[]>();
    for (const t of overdueTasks) {
      const topicKey = getReviewTopicKey(t);
      const list = map.get(topicKey) ?? [];
      list.push(t);
      map.set(topicKey, list);
    }
    return map;
  }, [overdueTasks]);

  const { roundMap } = useMemo(() => computeRounds(reviewTasks), [reviewTasks]);

  // 全选/取消全选
  const allSelected = overdueTasks.length > 0 && selectedIds.size === overdueTasks.length;
  const toggleAll = useCallback(() => {
    if (allSelected) {
      selection.clear();
    } else {
      selection.replace(overdueTasks.map((t) => t.id));
    }
  }, [allSelected, overdueTasks, selection]);

  const toggleOne = selection.toggle;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 将选中主题的最早逾期轮次安排到今天，并保持后续轮次间隔
  const handleReschedule = useCallback(() => {
    if (selectedIds.size === 0) return;
    rescheduleOverdue(Array.from(selectedIds));
    onClose();
  }, [selectedIds, rescheduleOverdue, onClose]);

  // 全部顺延
  const handleRescheduleAll = useCallback(() => {
    rescheduleOverdue(overdueTasks.map((t) => t.id));
    onClose();
  }, [overdueTasks, rescheduleOverdue, onClose]);

  return createPortal(
    <div className="eb-modal-overlay eb-overdue-overlay" onClick={onClose}>
      <div className="eb-modal eb-overdue-modal" role="dialog" aria-modal="true" aria-label="处理逾期复习" onClick={(e) => e.stopPropagation()}>
        <div className="eb-modal-header">
          <h3 className="eb-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} style={{ color: '#D4A0A0' }} />
            处理逾期复习
          </h3>
          <button type="button" className="eb-modal-close" onClick={onClose} aria-label="关闭逾期处理"><X size={16} /></button>
        </div>
        <div className="eb-modal-body">
          <div className="eb-overdue-summary">
            <div><strong>{overdueTasks.length}</strong><span>逾期轮次</span></div>
            <div><strong>{groupedByTopic.size}</strong><span>涉及计划</span></div>
            <p>补做时只把每个计划最早的逾期轮次移到今天，后续轮次保持原间隔。</p>
          </div>

          <div className="eb-overdue-list">
            {Array.from(groupedByTopic.entries()).map(([topicKey, tasks]) => (
              <div key={topicKey} className="eb-overdue-group">
                <div className="eb-overdue-group-header">
                  <input
                    type="checkbox"
                    checked={tasks.every((t) => selectedIds.has(t.id))}
                    ref={(el) => {
                      if (el) el.indeterminate = tasks.some((t) => selectedIds.has(t.id)) && !tasks.every((t) => selectedIds.has(t.id));
                    }}
                    onChange={() => {
                      const allChecked = tasks.every((t) => selectedIds.has(t.id));
                      selection.mutate((next) => {
                        for (const t of tasks) {
                          if (allChecked) next.delete(t.id);
                          else next.add(t.id);
                        }
                      });
                    }}
                    className="eb-round-check"
                  />
                  <span className="eb-overdue-group-name">{tasks[0]?.topicName}</span>
                  <span className="eb-overdue-group-count">{tasks.length} 轮逾期</span>
                </div>
                {tasks.map((t) => {
                  const round = roundMap.get(t.id) ?? 0;
                  const color = ROUND_COLORS[(round - 1) % ROUND_COLORS.length];
                  const overdueDays = Math.abs(diffDays(todayStr(), t.dueDate));
                  return (
                    <div
                      key={t.id}
                      className={`eb-overdue-row ${selectedIds.has(t.id) ? 'eb-overdue-row--selected' : ''}`}
                      onClick={() => toggleOne(t.id)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(t.id)}
                        onChange={() => toggleOne(t.id)}
                        className="eb-round-check"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="eb-overdue-dot" style={{ background: color }} />
                      <span className="eb-overdue-round">R{round || '?'}</span>
                      <span className="eb-overdue-date">{t.dueDate}</span>
                      <span className="eb-overdue-days">
                        逾期 {overdueDays} 天
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="eb-modal-footer">
          <label className="eb-overdue-select-all">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selectedIds.size > 0 && !allSelected;
              }}
              onChange={toggleAll}
              className="eb-round-check"
            />
            全选
          </label>
          <div className="eb-modal-footer-actions">
            <button type="button" className="eb-btn eb-btn--ghost" onClick={onClose}>
              暂不处理
            </button>
            <button
              type="button"
              className="eb-btn eb-btn--secondary"
              disabled={selectedIds.size === 0}
              onClick={handleReschedule}
            >
              <Calendar size={14} />
              今天补做选中 ({selectedIds.size})
            </button>
            <button type="button" className="eb-btn eb-btn--primary" onClick={handleRescheduleAll}>
              <SkipForward size={14} />
              今天补做全部
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default OverdueAlertModal;
