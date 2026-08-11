// ============================================================
// Ebb - 设置页
// 间隔/负载/复杂度/逾期/分散/标签颜色
// ============================================================

import React, { useState, useCallback, useMemo } from 'react';
import { requestConfirmation } from '@/services/confirmation';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useEbbStore } from '../store';
import { useGraphStore } from '@/graph/store';
import { TAG_COLOR_PALETTE, DEFAULT_COMPLEXITY_CONFIGS } from '../constants';
import { parseIntervals, formatIntervals } from '../complexity';
import { buildRootNodeMap, collectReviewCategories, getReviewCategoryColor } from '../category';
import type { ComplexityLevel, EbbSettings } from '../types';

interface SettingsPanelProps {
  onClose: () => void;
  inline?: boolean;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose, inline = false }) => {
  const store = useEbbStore();
  const s = store.ebbSettings;
  const graphNodes = useGraphStore((state) => state.nodes);

  const [customIntervals, setCustomIntervals] = useState(s.customIntervals);
  const [dailyTaskLimit, setDailyTaskLimit] = useState(s.dailyTaskLimit);
  const [dailyPointLimit, setDailyPointLimit] = useState(s.dailyPointLimit);
  const [dailyReviewMinutes, setDailyReviewMinutes] = useState(s.dailyReviewMinutes);
  const [maxSpreadDays, setMaxSpreadDays] = useState(s.maxSpreadDays);
  const [minTopicGapDays, setMinTopicGapDays] = useState(s.minTopicGapDays);
  const [autoProcessOverdue, setAutoProcessOverdue] = useState(s.autoProcessOverdue);
  const [overdueThreshold, setOverdueThreshold] = useState(s.overdueThreshold);
  const [loadThresholds, setLoadThresholds] = useState<[number, number, number, number]>(
    s.loadThresholds ?? [2, 4, 6, 9],
  );

  const intervalsValid = useMemo(() => parseIntervals(customIntervals) !== null, [customIntervals]);

  const handleSave = useCallback(() => {
    const patch: Partial<EbbSettings> = {
      customIntervals,
      dailyTaskLimit,
      dailyPointLimit,
      dailyReviewMinutes,
      maxSpreadDays,
      minTopicGapDays,
      autoProcessOverdue,
      overdueThreshold,
      loadThresholds,
    };
    store.updateSettings(patch);
    onClose();
  }, [customIntervals, dailyTaskLimit, dailyPointLimit, dailyReviewMinutes, maxSpreadDays, minTopicGapDays, autoProcessOverdue, overdueThreshold, loadThresholds, store, onClose]);

  // 复杂度配置编辑
  const [editingComplexity, setEditingComplexity] = useState<ComplexityLevel | null>(null);

  const handleResetComplexity = useCallback(async (level: ComplexityLevel) => {
    if (!await requestConfirmation(`重置「${level}」复杂度为默认配置？`)) return;
    const newConfigs = { ...s.complexityConfigs, [level]: DEFAULT_COMPLEXITY_CONFIGS[level] };
    store.updateSettings({ complexityConfigs: newConfigs });
  }, [s.complexityConfigs, store]);

  // 分类颜色：知识节点任务按大盘根节点归类，独立内容保留手动标签。
  const rootByNodeId = useMemo(() => buildRootNodeMap(graphNodes), [graphNodes]);
  const categoryEntries = useMemo(
    () => collectReviewCategories(store.reviewTasks, rootByNodeId),
    [store.reviewTasks, rootByNodeId],
  );

  const content = (
    <div className={inline ? 'eb-inline-panel' : 'eb-panel eb-panel--settings'}>
      <div className="eb-panel-header">
        <h3 className="eb-panel-title">复习设置</h3>
        <button type="button" className="eb-panel-close" onClick={onClose}><X size={16} /></button>
      </div>

      <div className="eb-panel-body">
          {/* 默认复习间隔 */}
          <section className="eb-settings-section">
            <h4 className="eb-settings-section-title">默认复习间隔</h4>
            <div className="eb-field">
              <input
                type="text"
                className={`eb-field-input ${!intervalsValid ? 'eb-field-input--error' : ''}`}
                value={customIntervals}
                onChange={(e) => setCustomIntervals(e.target.value)}
                placeholder="1, 2, 4, 7, 15"
              />
              {!intervalsValid && (
                <span className="eb-field-hint eb-field-hint--error">格式无效：逗号分隔的非递减正整数</span>
              )}
              <span className="eb-field-hint">用于手动添加轮次时的间隔推算</span>
            </div>
          </section>

          {/* 负载均衡 */}
          <section className="eb-settings-section">
            <h4 className="eb-settings-section-title">负载均衡</h4>
            <div className="eb-slider-row">
              <label className="eb-slider-label">
                每日复习目标容量
                <span className="eb-slider-value">{dailyReviewMinutes} 分钟</span>
              </label>
              <input
                type="range"
                min={15}
                max={240}
                step={5}
                value={dailyReviewMinutes}
                onChange={(e) => setDailyReviewMinutes(parseInt(e.target.value, 10))}
                className="eb-slider"
              />
              <span className="eb-field-hint">用于明日负荷规划和未来日期超载预警，不会阻止你手动保存。</span>
            </div>
            <div className="eb-slider-row">
              <label className="eb-slider-label">
                每日任务数上限
                <span className="eb-slider-value">{dailyTaskLimit}</span>
              </label>
              <input
                type="range"
                min={1}
                max={20}
                value={dailyTaskLimit}
                onChange={(e) => setDailyTaskLimit(parseInt(e.target.value, 10))}
                className="eb-slider"
              />
            </div>
            <div className="eb-slider-row">
              <label className="eb-slider-label">
                每日积分上限
                <span className="eb-slider-value">{dailyPointLimit}</span>
              </label>
              <input
                type="range"
                min={5}
                max={100}
                value={dailyPointLimit}
                onChange={(e) => setDailyPointLimit(parseInt(e.target.value, 10))}
                className="eb-slider"
              />
            </div>
          </section>

          {/* 日历任务量分级 */}
          <section className="eb-settings-section">
            <h4 className="eb-settings-section-title">日历任务量分级</h4>
            <span className="eb-field-hint">按每日任务数分 5 级颜色（绿→黄→橙→红），可拖动调整分界</span>
            <div className="eb-load-thresholds">
              {[
                { idx: 0, level: 1, color: '#A7F3D0', label: '轻松' },
                { idx: 1, level: 2, color: '#FDE68A', label: '适中' },
                { idx: 2, level: 3, color: '#FDBA74', label: '偏多' },
                { idx: 3, level: 4, color: '#FCA5A5', label: '繁重' },
              ].map(({ idx, level, color, label }) => (
                <div key={idx} className="eb-load-threshold-row">
                  <span className="eb-load-threshold-swatch" style={{ backgroundColor: color }} />
                  <span className="eb-load-threshold-label">L{level} {label}</span>
                  <span className="eb-load-threshold-hint">≤</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={loadThresholds[idx]}
                    onChange={(e) => {
                      const v = Math.max(1, parseInt(e.target.value, 10) || 1);
                      const next: [number, number, number, number] = [...loadThresholds];
                      next[idx] = v;
                      // 保持严格递增
                      for (let i = idx; i > 0 && next[i] <= next[i - 1]; i--) next[i - 1] = next[i] - 1;
                      for (let i = idx; i < 3 && next[i] >= next[i + 1]; i++) next[i + 1] = next[i] + 1;
                      setLoadThresholds(next);
                    }}
                    className="eb-load-threshold-input"
                  />
                  <span className="eb-load-threshold-unit">任务</span>
                </div>
              ))}
              <div className="eb-load-threshold-row eb-load-threshold-row--hint">
                <span className="eb-load-threshold-swatch" style={{ backgroundColor: '#FCA5A5', opacity: 0.7 }} />
                <span className="eb-load-threshold-label">L5 超载</span>
                <span className="eb-load-threshold-hint">&gt; {loadThresholds[3]} 任务</span>
              </div>
            </div>
          </section>

          {/* 复杂度配置 */}
          <section className="eb-settings-section">
            <h4 className="eb-settings-section-title">复杂度配置</h4>
            <div className="eb-complexity-list">
              {(['easy', 'normal', 'hard'] as ComplexityLevel[]).map((level) => {
                const cfg = s.complexityConfigs[level];
                return (
                  <div key={level} className="eb-complexity-row">
                    <div className="eb-complexity-row-info">
                      <span className="eb-complexity-row-label" style={{ backgroundColor: `${cfg.color}80` }}>{cfg.label}</span>
                      <span className="eb-complexity-row-intervals">间隔：{formatIntervals(cfg.intervals)}</span>
                    </div>
                    <div className="eb-complexity-row-actions">
                      <button
                        type="button"
                        className="eb-text-btn"
                        aria-expanded={editingComplexity === level}
                        aria-controls={`ebb-complexity-editor-${level}`}
                        onClick={() => setEditingComplexity(editingComplexity === level ? null : level)}
                      >
                        {editingComplexity === level ? '收起' : '编辑'}
                      </button>
                      <button
                        type="button"
                        className="eb-text-btn eb-text-btn--danger"
                        aria-label={`重置${cfg.label}复杂度配置`}
                        onClick={() => handleResetComplexity(level)}
                      >
                        重置
                      </button>
                    </div>
                    {editingComplexity === level && (
                      <ComplexityEditor
                        id={`ebb-complexity-editor-${level}`}
                        level={level}
                        settings={s}
                        onSave={(intervals, weights) => {
                          const newConfigs = {
                            ...s.complexityConfigs,
                            [level]: { ...cfg, intervals, weights },
                          };
                          store.updateSettings({ complexityConfigs: newConfigs });
                          setEditingComplexity(null);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 逾期处理 */}
          <section className="eb-settings-section">
            <h4 className="eb-settings-section-title">逾期处理</h4>
            <label className="eb-switch-row">
              <span>在今日复习中突出显示逾期提醒</span>
              <input
                type="checkbox"
                checked={autoProcessOverdue}
                onChange={(e) => setAutoProcessOverdue(e.target.checked)}
              />
            </label>
            <div className="eb-slider-row">
              <label className="eb-slider-label">
                逾期阈值（天）
                <span className="eb-slider-value">{overdueThreshold}</span>
              </label>
              <input
                type="range"
                min={1}
                max={30}
                value={overdueThreshold}
                onChange={(e) => setOverdueThreshold(parseInt(e.target.value, 10))}
                className="eb-slider"
              />
            </div>
          </section>

          {/* 智能分散 */}
          <section className="eb-settings-section">
            <h4 className="eb-settings-section-title">智能分散</h4>
            <div className="eb-slider-row">
              <label className="eb-slider-label">
                最大分散天数
                <span className="eb-slider-value">{maxSpreadDays}</span>
              </label>
              <input
                type="range"
                min={0}
                max={30}
                value={maxSpreadDays}
                onChange={(e) => setMaxSpreadDays(parseInt(e.target.value, 10))}
                className="eb-slider"
              />
            </div>
            <div className="eb-slider-row">
              <label className="eb-slider-label">
                同主题最小间隔（天）
                <span className="eb-slider-value">{minTopicGapDays}</span>
              </label>
              <input
                type="range"
                min={0}
                max={7}
                value={minTopicGapDays}
                onChange={(e) => setMinTopicGapDays(parseInt(e.target.value, 10))}
                className="eb-slider"
              />
            </div>
          </section>

          {/* 分类颜色 */}
          <section className="eb-settings-section">
            <h4 className="eb-settings-section-title">分类颜色</h4>
            <p className="eb-field-hint">关联知识节点的内容按知识大盘根节点归类；独立内容使用手动标签。</p>
            {categoryEntries.length === 0 ? (
              <p className="eb-settings-empty">暂无可配置分类</p>
            ) : (
              <div className="eb-tag-color-list">
                {categoryEntries.map((category) => {
                  const color = getReviewCategoryColor(category, s.tagColors);
                  return (
                    <div key={category.key} className="eb-tag-color-row">
                      <span className="eb-tag-color-name">{category.label}</span>
                      <div className="eb-tag-color-palette">
                        {TAG_COLOR_PALETTE.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={`eb-tag-color-swatch ${color === c ? 'eb-tag-color-swatch--active' : ''}`}
                            style={{ backgroundColor: c }}
                            aria-label={`将${category.label}设为${c}`}
                            onClick={() => store.setTagColor(category.key, c)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="eb-panel-footer">
          <button type="button" className="eb-btn eb-btn--ghost" onClick={onClose}>取消</button>
          <button type="button" className="eb-btn eb-btn--primary" onClick={handleSave} disabled={!intervalsValid}>保存</button>
        </div>
    </div>
  );

  if (inline) return content;

  return createPortal(
    <div
      className="eb-panel-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {content}
    </div>,
    document.body,
  );
};

// 复杂度编辑器子组件
interface ComplexityEditorProps {
  id: string;
  level: ComplexityLevel;
  settings: EbbSettings;
  onSave: (intervals: number[], weights: Record<number, number>) => void;
}

const ComplexityEditor: React.FC<ComplexityEditorProps> = ({ id, level, settings, onSave }) => {
  const cfg = settings.complexityConfigs[level];
  const [intervalsText, setIntervalsText] = useState(formatIntervals(cfg.intervals));
  const [weightsText, setWeightsText] = useState(
    Object.entries(cfg.weights).map(([r, w]) => `${r}:${w}`).join(', '),
  );

  const handleSave = () => {
    const intervals = parseIntervals(intervalsText);
    if (!intervals) {
      alert('间隔格式无效');
      return;
    }
    const weights: Record<number, number> = {};
    const parts = weightsText.split(/[,，\s]+/).filter(Boolean);
    for (const p of parts) {
      const [r, w] = p.split(':').map((x) => parseFloat(x.trim()));
      if (isNaN(r) || isNaN(w)) continue;
      weights[Math.floor(r)] = w;
    }
    onSave(intervals, weights);
  };

  return (
    <div id={id} className="eb-complexity-editor" role="group" aria-label={`${cfg.label}复杂度编辑器`}>
      <label className="eb-field">
        <span className="eb-field-label">间隔序列</span>
        <input
          type="text"
          className="eb-field-input"
          value={intervalsText}
          onChange={(e) => setIntervalsText(e.target.value)}
        />
      </label>
      <label className="eb-field">
        <span className="eb-field-label">积分权重（轮次:权重，逗号分隔）</span>
        <input
          type="text"
          className="eb-field-input"
          value={weightsText}
          onChange={(e) => setWeightsText(e.target.value)}
        />
      </label>
      <button type="button" className="eb-btn eb-btn--primary eb-btn--sm" onClick={handleSave}>保存</button>
    </div>
  );
};

export default SettingsPanel;
