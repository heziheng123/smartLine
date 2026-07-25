import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarRange, ListChecks, Plus, RefreshCcw, Search, Trash2, X } from 'lucide-react';
import { todayStr } from '@/utils/dateSafe';
import type { EbbSettings, ReviewTask } from '../types';
import {
  planBatchReviewAdjustment,
  type BatchReviewAction,
  type BatchReviewPlan,
  type BatchReviewRequest,
} from '../batchAdjust';
import { getReviewTopicKey } from '../scheduler';

interface BatchAdjustPanelProps {
  reviewTasks: ReviewTask[];
  settings: EbbSettings;
  onApply: (request: BatchReviewRequest) => BatchReviewPlan;
  onClose: () => void;
}

type ActionKind = BatchReviewAction['kind'];

const ACTIONS: Array<{ kind: ActionKind; label: string; description: string; icon: React.ReactNode }> = [
  { kind: 'shift', label: '整体改期', description: '统一提前或顺延所有未完成轮次', icon: <CalendarRange size={15} /> },
  { kind: 'trim', label: '精简末尾轮次', description: '从每个计划末尾删除 N 个未完成轮次', icon: <Trash2 size={15} /> },
  { kind: 'append', label: '追加轮次', description: '为每个计划追加相同数量的未来轮次', icon: <Plus size={15} /> },
  { kind: 'template', label: '套用未来模板', description: '保留完成历史，重新生成未来轮次', icon: <RefreshCcw size={15} /> },
];

const PRESETS: Record<string, number[]> = {
  light: [1, 3, 7],
  standard: [1, 2, 4, 7, 15],
  long: [1, 3, 7, 15, 30, 60],
};

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

const BatchAdjustPanel: React.FC<BatchAdjustPanelProps> = ({ reviewTasks, settings, onApply, onClose }) => {
  const topics = useMemo(() => {
    const grouped = new Map<string, ReviewTask[]>();
    reviewTasks.filter((task) => !task.isArchived).forEach((task) => {
      const key = getReviewTopicKey(task);
      const group = grouped.get(key) ?? [];
      group.push(task);
      grouped.set(key, group);
    });
    return [...grouped.entries()].map(([key, tasks]) => ({
      key,
      name: tasks[0]?.topicName ?? key,
      total: tasks.length,
      pending: tasks.filter((task) => !task.isCompleted).length,
    })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [reviewTasks]);

  const [selectedKeys, setSelectedKeys] = useState(() => new Set(topics.map((topic) => topic.key)));
  const [query, setQuery] = useState('');
  const [actionKind, setActionKind] = useState<ActionKind>('trim');
  const [shiftDays, setShiftDays] = useState(7);
  const [trimCount, setTrimCount] = useState(2);
  const [appendCount, setAppendCount] = useState(1);
  const [templateStartDate, setTemplateStartDate] = useState(todayStr());
  const [preset, setPreset] = useState('standard');
  const [customIntervals, setCustomIntervals] = useState('1, 2, 4, 7, 15');

  const visibleTopics = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    return normalized ? topics.filter((topic) => topic.name.toLocaleLowerCase('zh-CN').includes(normalized)) : topics;
  }, [query, topics]);

  const action = useMemo<BatchReviewAction>(() => {
    if (actionKind === 'shift') return { kind: 'shift', days: boundedInteger(shiftDays, -365, 365, 0) };
    if (actionKind === 'trim') return { kind: 'trim', count: boundedInteger(trimCount, 1, 12, 1), minRemaining: 1 };
    if (actionKind === 'append') return { kind: 'append', count: boundedInteger(appendCount, 1, 12, 1) };
    return {
      kind: 'template',
      startDate: templateStartDate,
      intervals: preset === 'custom' ? parseIntervals(customIntervals) : PRESETS[preset] ?? PRESETS.standard,
    };
  }, [actionKind, appendCount, customIntervals, preset, shiftDays, templateStartDate, trimCount]);

  const request = useMemo<BatchReviewRequest>(() => ({ topicKeys: [...selectedKeys], action }), [action, selectedKeys]);
  const preview = useMemo(() => planBatchReviewAdjustment(reviewTasks, settings, request), [request, reviewTasks, settings]);
  const selectedVisibleCount = visibleTopics.filter((topic) => selectedKeys.has(topic.key)).length;
  const allVisibleSelected = visibleTopics.length > 0 && selectedVisibleCount === visibleTopics.length;

  const toggleVisible = () => setSelectedKeys((current) => {
    const next = new Set(current);
    visibleTopics.forEach((topic) => {
      if (allVisibleSelected) next.delete(topic.key);
      else next.add(topic.key);
    });
    return next;
  });

  const handleApply = () => {
    if (preview.affectedTopics === 0) return;
    onApply(request);
    onClose();
  };

  return createPortal(
    <div className="eb-panel-overlay eb-batch-overlay" onClick={onClose}>
      <div className="eb-panel eb-batch-panel" role="dialog" aria-modal="true" aria-label="批量调整复习计划" onClick={(event) => event.stopPropagation()}>
        <div className="eb-panel-header">
          <div>
            <h3 className="eb-panel-title">批量调整复习计划</h3>
            <p className="eb-batch-subtitle">只调整有效计划；已完成历史不会被改写</p>
          </div>
          <button type="button" className="eb-panel-close" onClick={onClose} aria-label="关闭批量调整"><X size={16} /></button>
        </div>

        <div className="eb-batch-body">
          <section className="eb-batch-section eb-batch-scope">
            <div className="eb-batch-section-head">
              <div><span className="eb-batch-step">1</span><strong>选择计划</strong></div>
              <button type="button" className="eb-batch-link" onClick={toggleVisible}>{allVisibleSelected ? '取消当前全选' : '全选当前结果'}</button>
            </div>
            <label className="eb-batch-search">
              <Search size={14} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索复习主题" aria-label="搜索复习主题" />
            </label>
            <div className="eb-batch-topic-list">
              {visibleTopics.map((topic) => (
                <label key={topic.key} className={`eb-batch-topic ${selectedKeys.has(topic.key) ? 'is-selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(topic.key)}
                    onChange={() => setSelectedKeys((current) => {
                      const next = new Set(current);
                      if (next.has(topic.key)) next.delete(topic.key); else next.add(topic.key);
                      return next;
                    })}
                  />
                  <span className="eb-batch-topic-name">{topic.name}</span>
                  <span className="eb-batch-topic-meta">{topic.pending}/{topic.total} 未完成</span>
                </label>
              ))}
              {visibleTopics.length === 0 && <div className="eb-batch-empty">没有匹配的复习计划</div>}
            </div>
            <div className="eb-batch-selection">已选择 {selectedKeys.size}/{topics.length} 个计划</div>
          </section>

          <section className="eb-batch-section eb-batch-config">
            <div className="eb-batch-section-head"><div><span className="eb-batch-step">2</span><strong>选择调整方式</strong></div></div>
            <div className="eb-batch-actions" role="radiogroup" aria-label="批量调整方式">
              {ACTIONS.map((item) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={actionKind === item.kind}
                  key={item.kind}
                  className={`eb-batch-action ${actionKind === item.kind ? 'is-active' : ''}`}
                  onClick={() => setActionKind(item.kind)}
                >
                  <span className="eb-batch-action-icon">{item.icon}</span>
                  <span><strong>{item.label}</strong><small>{item.description}</small></span>
                </button>
              ))}
            </div>

            <div className="eb-batch-parameters">
              {actionKind === 'shift' && (
                <label className="eb-batch-field"><span>调整天数</span><input type="number" value={shiftDays} min={-365} max={365} onChange={(event) => setShiftDays(Number(event.target.value))} /><small>正数顺延，负数提前</small></label>
              )}
              {actionKind === 'trim' && (
                <><label className="eb-batch-field"><span>删除末尾轮数</span><input type="number" value={trimCount} min={1} max={12} onChange={(event) => setTrimCount(Number(event.target.value))} /></label><div className="eb-batch-note">仅当末尾轮次均未完成时执行，并至少保留 1 轮。</div></>
              )}
              {actionKind === 'append' && (
                <label className="eb-batch-field"><span>追加轮数</span><input type="number" value={appendCount} min={1} max={12} onChange={(event) => setAppendCount(Number(event.target.value))} /><small>日期根据当前复习设置自动计算</small></label>
              )}
              {actionKind === 'template' && (
                <div className="eb-batch-template-fields">
                  <label className="eb-batch-field"><span>计算起点</span><input type="date" value={templateStartDate} onChange={(event) => setTemplateStartDate(event.target.value)} /></label>
                  <label className="eb-batch-field"><span>未来模板</span><select value={preset} onChange={(event) => setPreset(event.target.value)}><option value="light">轻量 · 1, 3, 7</option><option value="standard">标准 · 1, 2, 4, 7, 15</option><option value="long">长期 · 1, 3, 7, 15, 30, 60</option><option value="custom">自定义</option></select></label>
                  {preset === 'custom' && <label className="eb-batch-field eb-batch-field--wide"><span>间隔天数</span><input value={customIntervals} onChange={(event) => setCustomIntervals(event.target.value)} placeholder="1, 2, 4, 7, 15" /></label>}
                </div>
              )}
            </div>
          </section>

          <section className="eb-batch-section eb-batch-preview">
            <div className="eb-batch-section-head"><div><span className="eb-batch-step">3</span><strong>确认影响</strong></div></div>
            <div className="eb-batch-summary" aria-label="批量调整预览统计">
              <span><strong>{preview.affectedTopics}</strong> 个计划会修改</span>
              {preview.rescheduledRounds > 0 && <span><strong>{preview.rescheduledRounds}</strong> 轮改期</span>}
              {preview.removedRounds > 0 && <span><strong>{preview.removedRounds}</strong> 轮删除</span>}
              {preview.addedRounds > 0 && <span><strong>{preview.addedRounds}</strong> 轮新增</span>}
              {preview.skippedTopics > 0 && <span className="is-muted"><strong>{preview.skippedTopics}</strong> 个跳过</span>}
            </div>
            <div className="eb-batch-preview-list">
              {preview.results.map((result) => (
                <div key={result.topicKey} className={`eb-batch-preview-row ${result.status === 'skipped' ? 'is-skipped' : ''}`}>
                  <span className="eb-batch-preview-status">{result.status === 'changed' ? '✓' : '—'}</span>
                  <span className="eb-batch-preview-name">{result.topicName}</span>
                  <span className="eb-batch-preview-description">{result.description}</span>
                  <span className="eb-batch-preview-count">{result.beforeCount} → {result.afterCount}</span>
                </div>
              ))}
              {preview.results.length === 0 && <div className="eb-batch-empty"><ListChecks size={18} />请选择至少一个复习计划</div>}
            </div>
          </section>
        </div>

        <div className="eb-panel-footer eb-batch-footer">
          <span>执行后会同步更新复习轮次与每日安排引用</span>
          <div><button type="button" className="eb-btn eb-btn--ghost" onClick={onClose}>取消</button><button type="button" className="eb-btn eb-btn--primary" disabled={preview.affectedTopics === 0} onClick={handleApply}>确认调整 {preview.affectedTopics > 0 ? `${preview.affectedTopics} 个计划` : ''}</button></div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default BatchAdjustPanel;
