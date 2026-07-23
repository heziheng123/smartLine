// ============================================================
// Ebb - 添加学习内容弹窗
// 表单：主题名/标签/日期/复杂度/间隔 + 预览/直接入库
// ============================================================

import React, { useState, useMemo, useCallback } from 'react';
import { requestConfirmation } from '@/services/confirmation';
import { createPortal } from 'react-dom';
import { todayStr, getDayOfWeek } from '@/utils/dateSafe';
import { X, Eye, Check } from 'lucide-react';
import type { ComplexityLevel } from '../types';
import { useEbbStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import {
  getIntervalsForComplexity,
  parseIntervals,
  formatIntervals,
  isDefaultIntervals,
} from '../complexity';
import { generateTasks, validateInput, type GenerateTasksInput } from '../scheduler';
import { COMPLEXITY_LEVELS } from '../constants';

interface AddContentModalProps {
  open: boolean;
  onClose: () => void;
  onGenerated?: () => void;
}

const AddContentModal: React.FC<AddContentModalProps> = ({ open, onClose, onGenerated }) => {
  const { reviewTasks, ebbSettings, addReviewTasks } = useEbbStore(
    useShallow((s) => ({
      reviewTasks: s.reviewTasks,
      ebbSettings: s.ebbSettings,
      addReviewTasks: s.addReviewTasks,
    })),
  );
  const [topicName, setTopicName] = useState('');
  const [tag, setTag] = useState('');
  const [startDate, setStartDate] = useState(todayStr());
  const [complexity, setComplexity] = useState<ComplexityLevel>('normal');
  const [intervalsText, setIntervalsText] = useState(formatIntervals(getIntervalsForComplexity('normal')));
  const [intervalsDirty, setIntervalsDirty] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof generateTasks> | null>(null);
  const [error, setError] = useState('');

  const intervals = useMemo(() => parseIntervals(intervalsText), [intervalsText]);

  const handleComplexityChange = useCallback(
    async (level: ComplexityLevel) => {
      if (intervalsDirty && !isDefaultIntervals(intervals ?? [], complexity, ebbSettings.complexityConfigs)) {
        if (!await requestConfirmation('已手动修改间隔，切换复杂度将覆盖当前间隔，是否继续？')) return;
      }
      setComplexity(level);
      setIntervalsText(formatIntervals(getIntervalsForComplexity(level, ebbSettings.complexityConfigs)));
      setIntervalsDirty(false);
      setPreview(null);
    },
    [complexity, intervals, intervalsDirty, ebbSettings.complexityConfigs],
  );

  const handleIntervalsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIntervalsText(e.target.value);
    setIntervalsDirty(true);
    setPreview(null);
  };

  const buildInput = useCallback((): GenerateTasksInput | null => {
    if (!intervals) {
      setError('间隔格式无效：应为逗号分隔的非递减正整数（1-1825）');
      return null;
    }
    const input: GenerateTasksInput = {
      topicName: topicName.trim(),
      tag: tag.trim() || undefined,
      complexity,
      startDate,
      intervals,
    };
    const errs = validateInput(input);
    if (errs.length > 0) {
      setError(errs.join('; '));
      return null;
    }
    setError('');
    return input;
  }, [topicName, tag, complexity, startDate, intervals]);

  const handlePreview = useCallback(() => {
    const input = buildInput();
    if (!input) return;
    try {
      const result = generateTasks(input, reviewTasks, ebbSettings);
      setPreview(result);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [buildInput, reviewTasks, ebbSettings]);

  const handleDirectAdd = useCallback(() => {
    const input = buildInput();
    if (!input) return;
    try {
      const result = generateTasks(input, reviewTasks, ebbSettings);
      if (result.tasks.length === 0) {
        setError('未生成任何任务');
        return;
      }
      addReviewTasks(result.tasks);
      onGenerated?.();
      // 重置表单
      setTopicName('');
      setTag('');
      setIntervalsDirty(false);
      setPreview(null);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [buildInput, reviewTasks, ebbSettings, addReviewTasks, onGenerated, onClose]);

  const handleConfirmPreview = useCallback(() => {
    if (!preview || preview.tasks.length === 0) return;
    addReviewTasks(preview.tasks);
    onGenerated?.();
    setTopicName('');
    setTag('');
    setIntervalsDirty(false);
    setPreview(null);
    onClose();
  }, [preview, addReviewTasks, onGenerated, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="eb-modal-overlay" onClick={onClose}>
      <div className="eb-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="eb-modal-header">
          <h3 className="eb-modal-title">添加学习内容</h3>
          <button type="button" className="eb-modal-close" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="eb-modal-body">
          <label className="eb-field">
            <span className="eb-field-label">学习内容名称 <em>*</em></span>
            <input
              type="text"
              className="eb-field-input"
              value={topicName}
              onChange={(e) => setTopicName(e.target.value.slice(0, 100))}
              placeholder="如：考研政治马原第一章"
              maxLength={100}
              autoFocus
            />
          </label>

          <div className="eb-field-row">
            <label className="eb-field eb-field--flex1">
              <span className="eb-field-label">分类标签</span>
              <input
                type="text"
                className="eb-field-input"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="如：政治"
              />
            </label>
            <label className="eb-field eb-field--flex1">
              <span className="eb-field-label">学习日期 <em>*</em></span>
              <input
                type="date"
                className="eb-field-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
          </div>

          <div className="eb-field">
            <span className="eb-field-label">复杂度</span>
            <div className="eb-complexity-switch">
              {COMPLEXITY_LEVELS.map((level) => {
                const cfg = ebbSettings.complexityConfigs[level];
                return (
                  <button
                    key={level}
                    type="button"
                    className={`eb-complexity-btn ${complexity === level ? 'eb-complexity-btn--active' : ''}`}
                    onClick={() => handleComplexityChange(level)}
                    style={complexity === level ? { backgroundColor: `${cfg.color}80`, borderColor: cfg.color } : undefined}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="eb-field">
            <span className="eb-field-label">
              复习间隔（天）
              <span className="eb-field-hint">逗号分隔，非递减正整数；切换复杂度自动填充</span>
            </span>
            <input
              type="text"
              className="eb-field-input"
              value={intervalsText}
              onChange={handleIntervalsChange}
              placeholder="1, 2, 4, 7, 15"
            />
          </label>

          {error && <div className="eb-field-error">{error}</div>}

          {preview && (
            <div className="eb-preview">
              <div className="eb-preview-header">
                <span className="eb-preview-title">预览复习计划</span>
                <span className="eb-preview-count">{preview.tasks.length} 个任务</span>
              </div>
              <div className="eb-preview-list">
                {preview.tasks.map((t, i) => {
                  return (
                    <div key={t.id} className="eb-preview-row">
                      <span className="eb-preview-round">第 {i + 1} 轮</span>
                      <span className="eb-preview-date">{t.dueDate}</span>
                      <span className="eb-preview-weekday">{['周日','周一','周二','周三','周四','周五','周六'][getDayOfWeek(t.dueDate)]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="eb-modal-actions">
          {preview ? (
            <>
              <button type="button" className="eb-btn eb-btn--ghost" onClick={() => setPreview(null)}>
                返回编辑
              </button>
              <button type="button" className="eb-btn eb-btn--primary" onClick={handleConfirmPreview}>
                <Check size={14} />
                确认入库（{preview.tasks.length}）
              </button>
            </>
          ) : (
            <>
              <button type="button" className="eb-btn eb-btn--ghost" onClick={onClose}>取消</button>
              <button
                type="button"
                className="eb-btn eb-btn--secondary"
                onClick={handlePreview}
                disabled={!topicName.trim() || !intervals}
              >
                <Eye size={14} />
                预览复习计划
              </button>
              <button
                type="button"
                className="eb-btn eb-btn--primary"
                onClick={handleDirectAdd}
                disabled={!topicName.trim() || !intervals}
              >
                直接入库
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default AddContentModal;
