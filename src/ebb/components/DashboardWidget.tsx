// ============================================================
// Ebb - 仪表盘（矩阵视图 - Phase 2）
// 统计卡片 + 完成率 + 撤销 + 导入导出 + 筛选 + 标签统计 + 主题矩阵表
// 支持内联右侧面板渲染（分屏）和 Portal 模态渲染
// ============================================================

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Upload, Trash2, RotateCcw } from 'lucide-react';
import dayjs from 'dayjs';
import { useEbbStore } from '../store';
import {
  computeTopicStats,
  computeTagStats,
  calcTodayPoints,
  calcWeekPoints,
  isOverdue,
  isDueToday,
} from '../scheduler';

interface DashboardWidgetProps {
  onClose: () => void;
  inline?: boolean; // 内联模式（右侧面板），不使用 Portal
}

const DashboardWidget: React.FC<DashboardWidgetProps> = ({ onClose, inline = false }) => {
  const store = useEbbStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filterTag, setFilterTag] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'completed'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'ratio'>('date');
  const [query, setQuery] = useState('');

  // 统计卡片
  const stats = useMemo(() => {
    const tasks = store.reviewTasks;
    const topicCount = new Set(tasks.map((t) => t.topicName)).size;
    const todayDue = tasks.filter((t) => isDueToday(t) && !t.isCompleted).length;
    const overdue = tasks.filter(isOverdue).length;
    const todayPoints = calcTodayPoints(tasks, store.ebbSettings);
    const weekPoints = calcWeekPoints(tasks, store.ebbSettings);
    const completed = tasks.filter((t) => t.isCompleted).length;
    return {
      topicCount,
      total: tasks.length,
      todayDue,
      overdue,
      todayPoints,
      weekPoints,
      completed,
      ratio: tasks.length > 0 ? completed / tasks.length : 0,
    };
  }, [store.reviewTasks, store.ebbSettings]);

  const tagStats = useMemo(() => computeTagStats(store.reviewTasks), [store.reviewTasks]);

  // 主题矩阵（带筛选/排序/搜索）
  const topicStats = useMemo(() => {
    let list = computeTopicStats(store.reviewTasks, store.ebbSettings);
    if (filterTag) {
      list = list.filter((t) => (t.tag || '') === filterTag);
    }
    if (filterStatus === 'pending') {
      list = list.filter((t) => t.completedRounds < t.totalRounds);
    } else if (filterStatus === 'completed') {
      list = list.filter((t) => t.completedRounds === t.totalRounds && t.totalRounds > 0);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((t) => t.topicName.toLowerCase().includes(q) || (t.tag || '').toLowerCase().includes(q));
    }
    if (sortBy === 'date') {
      list = [...list].sort((a, b) => (a.nextDueDate || '9999').localeCompare(b.nextDueDate || '9999'));
    } else {
      list = [...list].sort((a, b) => a.ratio - b.ratio);
    }
    return list;
  }, [store.reviewTasks, store.ebbSettings, filterTag, filterStatus, query, sortBy]);

  const handleExport = useCallback(() => {
    const json = store.exportEbbData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart-ebb-${dayjs().format('YYYY-MM-DD')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [store]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        store.importEbbData(parsed);
      } catch {
        alert('导入失败：JSON 格式无效');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [store]);

  const handleClearAll = useCallback(() => {
    if (!confirm(`确认清空所有 ${store.reviewTasks.length} 个复习任务？可通过撤销恢复。`)) return;
    store.clearAllTasks();
  }, [store]);

  const handleUndo = useCallback(() => {
    store.popUndo();
  }, [store]);

  const content = (
    <div className={inline ? 'eb-inline-panel' : 'eb-panel eb-panel--dashboard'}>
      <div className="eb-panel-header">
        <h3 className="eb-panel-title">仪表盘</h3>
        <button type="button" className="eb-panel-close" onClick={onClose}><X size={16} /></button>
      </div>

      <div className="eb-panel-body">
          {/* 统计卡片 */}
          <div className="eb-stats-grid">
            <StatCard label="学习内容" value={stats.topicCount} color="#A8C4D9" />
            <StatCard label="总任务数" value={stats.total} color="#C4B8D9" />
            <StatCard label="今日到期" value={stats.todayDue} color="#D9C4B8" highlight={stats.todayDue > 0} />
            <StatCard label="逾期" value={stats.overdue} color="#E0B8B8" highlight={stats.overdue > 0} />
            <StatCard label="今日积分" value={stats.todayPoints} color="#B8D9C4" />
            <StatCard label="本周积分" value={stats.weekPoints} color="#D9D9B8" />
          </div>

          {/* 整体完成率 */}
          <div className="eb-overall-progress">
            <div className="eb-overall-progress-header">
              <span className="eb-overall-progress-label">整体完成率</span>
              <span className="eb-overall-progress-value">
                {stats.completed}/{stats.total} · {Math.round(stats.ratio * 100)}%
              </span>
            </div>
            <div className="eb-overall-progress-bar">
              <div className="eb-overall-progress-fill" style={{ width: `${stats.ratio * 100}%` }} />
            </div>
          </div>

          {/* 操作栏 */}
          <div className="eb-dashboard-actions">
            <button type="button" className="eb-btn eb-btn--ghost eb-btn--sm" onClick={handleExport}>
              <Download size={13} /> 导出
            </button>
            <button type="button" className="eb-btn eb-btn--ghost eb-btn--sm" onClick={() => fileInputRef.current?.click()}>
              <Upload size={13} /> 导入
            </button>
            <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
            {store.undoStack.length > 0 && (
              <button type="button" className="eb-btn eb-btn--ghost eb-btn--sm" onClick={handleUndo}>
                <RotateCcw size={13} /> 撤销（{store.undoStack.length}）
              </button>
            )}
            <button type="button" className="eb-btn eb-btn--danger eb-btn--sm" onClick={handleClearAll} disabled={store.reviewTasks.length === 0}>
              <Trash2 size={13} /> 清空所有
            </button>
          </div>

          {/* 筛选栏 */}
          <div className="eb-dashboard-filter">
            <select className="eb-field-input eb-field-input--sm" value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
              <option value="">全部标签</option>
              {tagStats.filter((t) => t.tag).map((t) => (
                <option key={t.tag} value={t.tag}>{t.tag}</option>
              ))}
            </select>
            <select className="eb-field-input eb-field-input--sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as 'all' | 'pending' | 'completed')}>
              <option value="all">全部状态</option>
              <option value="pending">待办</option>
              <option value="completed">已完成</option>
            </select>
            <select className="eb-field-input eb-field-input--sm" value={sortBy} onChange={(e) => setSortBy(e.target.value as 'date' | 'ratio')}>
              <option value="date">按日期排序</option>
              <option value="ratio">按完成率排序</option>
            </select>
            <input
              type="text"
              className="eb-field-input eb-field-input--sm eb-field-input--search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索主题..."
            />
          </div>

          {/* 标签统计区 */}
          {tagStats.length > 0 && (
            <section className="eb-dashboard-section">
              <h4 className="eb-dashboard-section-title">标签统计</h4>
              <div className="eb-tag-stats">
                {tagStats.map((t) => {
                  const color = t.tag ? store.ebbSettings.tagColors[t.tag] : '#E5E7EB';
                  return (
                    <div key={t.tag || 'untagged'} className="eb-tag-stat-card" style={{ '--tag-color': color } as React.CSSProperties}>
                      <div className="eb-tag-stat-name">{t.tag || '未分组'}</div>
                      <div className="eb-tag-stat-nums">
                        <span>共 {t.total}</span>
                        <span className="eb-tag-stat-done">完成 {t.completed}</span>
                        <span>待办 {t.pending}</span>
                        {t.overdue > 0 && <span className="eb-tag-stat-overdue">逾期 {t.overdue}</span>}
                      </div>
                      <div className="eb-tag-stat-bar">
                        <div className="eb-tag-stat-bar-fill" style={{ width: `${t.ratio * 100}%` }} />
                      </div>
                      <span className="eb-tag-stat-ratio">{Math.round(t.ratio * 100)}%</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 主题矩阵表 */}
          <section className="eb-dashboard-section">
            <h4 className="eb-dashboard-section-title">主题矩阵（{topicStats.length}）</h4>
            <div className="eb-topic-matrix">
              {topicStats.length === 0 ? (
                <div className="eb-matrix-empty">无符合条件的数据</div>
              ) : (
                <table className="eb-matrix-table">
                  <thead>
                    <tr>
                      <th>主题</th>
                      <th>标签</th>
                      <th>进度</th>
                      <th>状态</th>
                      <th>下个到期</th>
                      <th>积分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topicStats.map((t) => {
                      const overdue = t.overdueRounds > 0;
                      const done = t.completedRounds === t.totalRounds && t.totalRounds > 0;
                      return (
                        <tr key={t.topicName} className={overdue ? 'eb-matrix-row--overdue' : done ? 'eb-matrix-row--done' : ''}>
                          <td className="eb-matrix-topic">{t.topicName}</td>
                          <td>{t.tag && <span className="eb-matrix-tag">{t.tag}</span>}</td>
                          <td>
                            <div className="eb-matrix-progress">
                              <div className="eb-matrix-progress-bar">
                                <div className="eb-matrix-progress-fill" style={{ width: `${t.ratio * 100}%` }} />
                              </div>
                              <span className="eb-matrix-progress-text">{t.completedRounds}/{t.totalRounds}</span>
                            </div>
                          </td>
                          <td>
                            {done ? (
                              <span className="eb-status-pill eb-status-pill--done">已完成</span>
                            ) : overdue ? (
                              <span className="eb-status-pill eb-status-pill--overdue">逾期</span>
                            ) : t.completedRounds > 0 ? (
                              <span className="eb-status-pill eb-status-pill--progress">复习中</span>
                            ) : (
                              <span className="eb-status-pill eb-status-pill--pending">未开始</span>
                            )}
                          </td>
                          <td>{t.nextDueDate ? dayjs(t.nextDueDate).format('M月D日') : '—'}</td>
                          <td>{t.earnedPoints}/{t.totalPoints}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
    </div>
  );

  if (inline) return content;

  return createPortal(
    <div className="eb-panel-overlay" onClick={onClose}>
      {content}
    </div>,
    document.body,
  );
};

const StatCard: React.FC<{ label: string; value: number | string; color: string; highlight?: boolean }> = ({ label, value, color, highlight }) => (
  <div className={`eb-stat-card ${highlight ? 'eb-stat-card--highlight' : ''}`} style={{ '--card-color': color } as React.CSSProperties}>
    <div className="eb-stat-card-value">{value}</div>
    <div className="eb-stat-card-label">{label}</div>
  </div>
);

export default DashboardWidget;
