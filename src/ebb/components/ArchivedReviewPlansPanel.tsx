import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, CheckCircle2, RotateCcw, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { formatDate } from '@/utils/dateSafe';
import { listArchivedReviewPlans, type ArchivedReviewPlan } from '../reviewPlanArchive';
import { useEbbStore } from '../store';

interface ArchivedReviewPlansPanelProps {
  onClose: () => void;
}

const ArchivedReviewPlansPanel: React.FC<ArchivedReviewPlansPanelProps> = ({ onClose }) => {
  const { reviewTasks, restoreArchivedReviewPlan } = useEbbStore(useShallow((state) => ({
    reviewTasks: state.reviewTasks,
    restoreArchivedReviewPlan: state.restoreArchivedReviewPlan,
  })));
  const plans = useMemo(() => listArchivedReviewPlans(reviewTasks), [reviewTasks]);
  const [pendingPlan, setPendingPlan] = useState<ArchivedReviewPlan | null>(null);

  const restore = () => {
    if (!pendingPlan) return;
    restoreArchivedReviewPlan(pendingPlan.tasks.map((task) => task.id));
    setPendingPlan(null);
  };

  return createPortal(
    <div className="eb-panel-overlay" onClick={onClose}>
      <div className="eb-panel eb-archive-panel" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="复习归档库">
        <div className="eb-panel-header eb-archive-header">
          <div className="eb-archive-heading">
            <span className="eb-archive-heading-icon"><Archive size={18} /></span>
            <div>
              <span className="eb-archive-eyebrow">复习历史</span>
              <h3 className="eb-panel-title">复习归档库</h3>
              <p>已归档的整套复习计划会保存在这里。</p>
            </div>
          </div>
          <button type="button" className="eb-panel-close" onClick={onClose} aria-label="关闭复习归档库"><X size={16} /></button>
        </div>

        <div className="eb-archive-body">
          <div className="eb-archive-note">
            <Archive size={15} />
            <span><strong>仅收起复习任务</strong>基础课任务记录与知识节点仍会保留。</span>
          </div>
          {plans.length === 0 ? (
            <div className="eb-archive-empty">
              <span><Archive size={28} /></span>
              <strong>暂时没有归档的复习计划</strong>
              <p>归档后的计划会集中显示在这里，需要时可以恢复。</p>
            </div>
          ) : (
            <div className="eb-archive-list">
              <div className="eb-archive-list-heading"><span>已归档计划</span><em>{plans.length} 套</em></div>
              {plans.map((plan) => {
                const completed = plan.tasks.filter((task) => task.isCompleted).length;
                const pending = plan.tasks.length - completed;
                return (
                  <article key={plan.id} className="eb-archive-card">
                    <div className="eb-archive-card-topline">
                      <div>
                        <h4 title={plan.topicName}>{plan.topicName}</h4>
                        <span>{plan.archivedAt ? `${formatDate(plan.archivedAt.slice(0, 10), 'M月D日')}归档` : '历史归档'}</span>
                      </div>
                      <button type="button" className="eb-btn eb-btn--secondary eb-btn--sm" onClick={() => setPendingPlan(plan)}>
                        <RotateCcw size={14} />恢复计划
                      </button>
                    </div>
                    <div className="eb-archive-card-stats">
                      <span><CheckCircle2 size={14} /><strong>{completed}/{plan.tasks.length}</strong> 已完成</span>
                      <span><strong>{pending}</strong> 轮待复习</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {pendingPlan && (
          <div className="eb-change-preview-overlay" onClick={() => setPendingPlan(null)}>
            <div className="eb-change-preview" onClick={(event) => event.stopPropagation()}>
              <div className="eb-change-preview-title">恢复“{pendingPlan.topicName}”的旧复习计划？</div>
              <p>当前活动复习计划会自动归档，旧计划的未完成轮次将从今天起重新排期。每日安排需要重新放入对应日期。</p>
              <div className="eb-change-preview-actions">
                <button type="button" className="eb-btn eb-btn--ghost eb-btn--sm" onClick={() => setPendingPlan(null)}>取消</button>
                <button type="button" className="eb-btn eb-btn--primary eb-btn--sm" onClick={restore}>确认恢复</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default ArchivedReviewPlansPanel;
