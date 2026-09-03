import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCcw, X } from 'lucide-react';
import type {
  ProjectTaskCompletionImpact,
  ProjectTaskCompletionReviewMode,
} from '@/domain/projectTaskCompletion';
import {
  setProjectTaskCompletionPromptHandler,
  type ProjectTaskCompletionPromptResult,
} from '@/services/projectTaskCompletionPrompt';

interface QueuedPrompt {
  id: number;
  impact: ProjectTaskCompletionImpact;
  resolve: (result: ProjectTaskCompletionPromptResult) => void;
}

let promptSequence = 0;

const ProjectTaskCompletionDialogHost: React.FC = () => {
  const [queue, setQueue] = useState<QueuedPrompt[]>([]);
  const [mode, setMode] = useState<ProjectTaskCompletionReviewMode>('relearn');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const current = queue[0];
  const currentId = current?.id;

  useEffect(() => setProjectTaskCompletionPromptHandler((impact) => new Promise((resolve) => {
    setQueue((items) => [...items, { id: ++promptSequence, impact, resolve }]);
  })), []);

  const settle = useCallback((result: ProjectTaskCompletionPromptResult) => {
    setQueue((items) => {
      const [active, ...rest] = items;
      active?.resolve(result);
      return rest;
    });
  }, []);

  useEffect(() => {
    if (!current) return;
    const relearnable = current.impact.nodes.filter((node) => node.canRelearn);
    setMode(relearnable.length > 0 ? 'relearn' : 'continue');
    setSelectedNodeIds(relearnable.map((node) => node.nodeId));
  }, [currentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!currentId) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    window.setTimeout(() => primaryButtonRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      settle(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [currentId, settle]);

  if (!current) return null;
  const { impact } = current;
  const selected = new Set(selectedNodeIds);
  const relearnableCount = impact.nodes.filter((node) => node.canRelearn).length;
  const canSubmit = mode !== 'relearn' || selectedNodeIds.length > 0;

  const toggleNode = (nodeId: string) => {
    setSelectedNodeIds((ids) => ids.includes(nodeId)
      ? ids.filter((id) => id !== nodeId)
      : [...ids, nodeId]);
  };

  return createPortal(
    <div className="app-confirm-overlay" role="presentation" onMouseDown={() => settle(null)}>
      <section
        className="app-confirm app-task-completion-dialog app-confirm--warning"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-task-completion-title"
        aria-describedby="app-task-completion-message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="app-confirm-close" type="button" aria-label="取消完成" onClick={() => settle(null)}>
          <X size={17} />
        </button>
        <div className="app-confirm-icon" aria-hidden="true"><RefreshCcw size={20} /></div>
        <div className="app-confirm-content">
          <h2 id="app-task-completion-title">完成“{impact.taskTitle}”</h2>
          <p id="app-task-completion-message">完成日期：{impact.completedDate}。请选择这次学习如何处理已有复习周期。</p>
        </div>

        <div className="app-task-completion-nodes" aria-label="复习周期影响预览">
          {impact.nodes.map((node) => (
            <div className="app-task-completion-node" key={node.nodeId}>
              <strong>{node.nodeName}</strong>
              <span>{node.stateLabel}</span>
              {!node.canRelearn && <span className="app-task-completion-blocked">{node.relearnBlockedReason}</span>}
              {mode === 'relearn' && (
                <label className={!node.canRelearn ? 'is-disabled' : ''}>
                  <input
                    type="checkbox"
                    checked={selected.has(node.nodeId)}
                    disabled={!node.canRelearn}
                    onChange={() => toggleNode(node.nodeId)}
                  />
                  <span>{node.canRelearn
                    ? `${node.relearnLabel}${node.firstNewDueDate ? `，首轮 ${node.firstNewDueDate}` : ''}${node.overdueNewRoundCount > 0 ? `（已有 ${node.overdueNewRoundCount} 轮逾期）` : ''}`
                    : node.relearnBlockedReason}</span>
                </label>
              )}
            </div>
          ))}
        </div>

        <div className="app-task-completion-options" role="radiogroup" aria-label="完成后的复习处理方式">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'relearn'}
            disabled={relearnableCount === 0}
            className={mode === 'relearn' ? 'is-selected' : ''}
            onClick={() => setMode('relearn')}
          >
            <strong>本次为重新学习 <em>推荐</em></strong>
            <span>从完成日重启勾选节点的完整周期；未勾选节点按原计划衔接。</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'continue'}
            className={mode === 'continue' ? 'is-selected' : ''}
            onClick={() => setMode('continue')}
          >
            <strong>按现有计划衔接</strong>
            <span>沿用当前规则完成可联动轮次，不归档旧周期。</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'task-only'}
            className={mode === 'task-only' ? 'is-selected' : ''}
            onClick={() => setMode('task-only')}
          >
            <strong>只完成项目任务</strong>
            <span>不完成复习轮次，也不生成或修改复习计划。</span>
          </button>
        </div>

        <footer className="app-confirm-actions">
          <button type="button" className="app-confirm-button app-confirm-button--cancel" onClick={() => settle(null)}>取消</button>
          <button
            ref={primaryButtonRef}
            type="button"
            className="app-confirm-button app-confirm-button--confirm"
            disabled={!canSubmit}
            onClick={() => settle({
              mode,
              relearnNodeIds: mode === 'relearn' ? selectedNodeIds : undefined,
            })}
          >
            确认完成
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
};

export default ProjectTaskCompletionDialogHost;
