// ============================================================
// Ebb - 逾期任务提醒弹窗
// 启动时检测逾期任务，提示用户顺延或忽略
// ============================================================

import React, { useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Calendar, SkipForward, X } from 'lucide-react';
import { useEbbStore } from '../store';
import { isOverdue, computeRounds } from '../scheduler';
import { ROUND_COLORS } from '../constants';
import type { ReviewTask } from '../types';

interface OverdueAlertModalProps {
  onClose: () => void;
}

const OverdueAlertModal: React.FC<OverdueAlertModalProps> = ({ onClose }) => {
  const store = useEbbStore();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 所有逾期未完成任务
  const overdueTasks = useMemo(() => {
    return store.reviewTasks
      .filter((t) => !t.isCompleted && isOverdue(t))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [store.reviewTasks]);

  // 按主题分组
  const groupedByTopic = useMemo(() => {
    const map = new Map<string, ReviewTask[]>();
    for (const t of overdueTasks) {
      const list = map.get(t.topicName) ?? [];
      list.push(t);
      map.set(t.topicName, list);
    }
    return map;
  }, [overdueTasks]);

  const { roundMap } = useMemo(() => computeRounds(store.reviewTasks), [store.reviewTasks]);

  // 全选/取消全选
  const allSelected = overdueTasks.length > 0 && selectedIds.size === overdueTasks.length;
  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(overdueTasks.map((t) => t.id)));
    }
  }, [allSelected, overdueTasks]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 顺延选中任务到今天
  const handleReschedule = useCallback(() => {
    if (selectedIds.size === 0) return;
    store.rescheduleOverdue(Array.from(selectedIds));
    onClose();
  }, [selectedIds, store, onClose]);

  // 全部顺延
  const handleRescheduleAll = useCallback(() => {
    store.rescheduleOverdue(overdueTasks.map((t) => t.id));
    onClose();
  }, [overdueTasks, store, onClose]);

  return createPortal(
    <div className="eb-modal-overlay" onClick={onClose}>
      <div className="eb-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="eb-modal-header">
          <h3 className="eb-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} style={{ color: '#D4A0A0' }} />
            逾期任务提醒
          </h3>
          <button type="button" className="eb-modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="eb-modal-body">
          <p className="eb-overdue-summary">
            检测到 <strong>{overdueTasks.length}</strong> 个逾期未完成的复习任务，
            涉及 <strong>{groupedByTopic.size}</strong> 个主题。
            可以将逾期任务顺延至今天重新安排。
          </p>

          <div className="eb-overdue-list">
            {Array.from(groupedByTopic.entries()).map(([topicName, tasks]) => (
              <div key={topicName} className="eb-overdue-group">
                <div className="eb-overdue-group-header">
                  <input
                    type="checkbox"
                    checked={tasks.every((t) => selectedIds.has(t.id))}
                    ref={(el) => {
                      if (el) el.indeterminate = tasks.some((t) => selectedIds.has(t.id)) && !tasks.every((t) => selectedIds.has(t.id));
                    }}
                    onChange={() => {
                      const allChecked = tasks.every((t) => selectedIds.has(t.id));
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        for (const t of tasks) {
                          if (allChecked) next.delete(t.id);
                          else next.add(t.id);
                        }
                        return next;
                      });
                    }}
                    className="eb-round-check"
                  />
                  <span className="eb-overdue-group-name">{topicName}</span>
                  <span className="eb-overdue-group-count">{tasks.length} 轮逾期</span>
                </div>
                {tasks.map((t) => {
                  const round = roundMap.get(t.id) ?? 0;
                  const color = ROUND_COLORS[(round - 1) % ROUND_COLORS.length];
                  const overdueDays = Math.floor(
                    (new Date().getTime() - new Date(t.dueDate).getTime()) / (1000 * 60 * 60 * 24),
                  );
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
              顺延选中 ({selectedIds.size})
            </button>
            <button type="button" className="eb-btn eb-btn--primary" onClick={handleRescheduleAll}>
              <SkipForward size={14} />
              全部顺延
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default OverdueAlertModal;
