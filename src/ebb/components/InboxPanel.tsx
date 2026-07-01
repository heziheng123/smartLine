// ============================================================
// Ebb - 收件箱（Phase 2 完整实现）
// 快速添加 + 草稿区 + 暂存区 + 批量操作
// ============================================================

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, ArrowRight, Check } from 'lucide-react';
import dayjs from 'dayjs';
import { useEbbStore } from '../store';
import { genId } from '../scheduler';
import { getIntervalsForComplexity, formatIntervals, parseIntervals } from '../complexity';
import { COMPLEXITY_LEVELS } from '../constants';
import type { ComplexityLevel, InboxItem } from '../types';

interface InboxPanelProps {
  onClose: () => void;
  inline?: boolean;
}

const InboxPanel: React.FC<InboxPanelProps> = ({ onClose, inline = false }) => {
  const store = useEbbStore();
  const [topicInput, setTopicInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  // 快速添加（回车连续创建，光标不离开输入框）
  const handleQuickAdd = useCallback(() => {
    const topic = topicInput.trim();
    if (!topic) return;
    const item: InboxItem = {
      id: genId('inb'),
      topicName: topic,
      tag: tagInput.trim(),
      status: 'draft',
      createdAt: new Date().toISOString(),
    };
    store.addInboxItem(item);
    setTopicInput('');
    // 光标保留在输入框
    inputRef.current?.focus();
  }, [topicInput, tagInput, store]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleQuickAdd();
    }
  };

  const drafts = useMemo(() => store.inboxItems.filter((i) => i.status === 'draft'), [store.inboxItems]);
  const staged = useMemo(() => store.inboxItems.filter((i) => i.status === 'staged'), [store.inboxItems]);

  const handleDelete = useCallback((id: string) => {
    store.deleteInboxItem(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [store]);

  const handleStage = useCallback((id: string) => {
    // 升级为暂存：默认复杂度 normal + 默认间隔 + 今天起
    const item = store.inboxItems.find((i) => i.id === id);
    if (!item) return;
    store.updateInboxItem(id, {
      status: 'staged',
      complexity: 'normal',
      intervals: getIntervalsForComplexity('normal', store.ebbSettings.complexityConfigs),
      startDate: dayjs().format('YYYY-MM-DD'),
    });
  }, [store]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchGenerate = useCallback(() => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const generated = store.generateTasksFromInbox(ids);
    if (generated.length > 0) {
      setSelectedIds(new Set());
    }
  }, [selectedIds, store]);

  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确认删除 ${selectedIds.size} 个收件箱项？`)) return;
    for (const id of selectedIds) {
      store.deleteInboxItem(id);
    }
    setSelectedIds(new Set());
  }, [selectedIds, store]);

  const content = (
    <div className={inline ? 'eb-inline-panel' : 'eb-panel eb-panel--inbox'} onClick={inline ? undefined : undefined}>
      <div className="eb-panel-header">
        <h3 className="eb-panel-title">收件箱</h3>
        <button type="button" className="eb-panel-close" onClick={onClose}><X size={16} /></button>
      </div>

      <div className="eb-panel-body">
          {/* 快速添加 */}
          <div className="eb-inbox-quick-add">
            <input
              ref={inputRef}
              type="text"
              className="eb-field-input"
              value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="+ 添加主题（回车快速创建）..."
              autoFocus
            />
            <input
              type="text"
              className="eb-field-input eb-field-input--tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="标签"
            />
            <button type="button" className="eb-btn eb-btn--primary eb-btn--sm" onClick={handleQuickAdd} disabled={!topicInput.trim()}>
              添加
            </button>
          </div>

          {/* 暂存区 */}
          {staged.length > 0 && (
            <section className="eb-inbox-section">
              <h4 className="eb-inbox-section-title">📋 暂存区（{staged.length}）</h4>
              <div className="eb-inbox-list">
                {staged.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    selected={selectedIds.has(item.id)}
                    onSelect={toggleSelect}
                    onDelete={handleDelete}
                    onUpdate={(patch) => store.updateInboxItem(item.id, patch)}
                    settings={store.ebbSettings}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 草稿区 */}
          {drafts.length > 0 && (
            <section className="eb-inbox-section">
              <h4 className="eb-inbox-section-title">📝 草稿区（{drafts.length}）</h4>
              <div className="eb-inbox-list">
                {drafts.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    selected={selectedIds.has(item.id)}
                    onSelect={toggleSelect}
                    onDelete={handleDelete}
                    onStage={() => handleStage(item.id)}
                    settings={store.ebbSettings}
                  />
                ))}
              </div>
            </section>
          )}

          {store.inboxItems.length === 0 && (
            <div className="eb-inbox-empty">
              <div className="eb-inbox-empty-icon">📥</div>
              <div className="eb-inbox-empty-text">收件箱为空，添加主题开始管理</div>
            </div>
          )}
        </div>

        {/* 批量操作栏 */}
        {selectedIds.size > 0 && (
          <div className="eb-inbox-batch">
            <span className="eb-inbox-batch-count">已选 {selectedIds.size} 项</span>
            <button type="button" className="eb-btn eb-btn--danger eb-btn--sm" onClick={handleBatchDelete}>
              <Trash2 size={13} /> 批量删除
            </button>
            <button type="button" className="eb-btn eb-btn--primary eb-btn--sm" onClick={handleBatchGenerate}>
              <Check size={13} /> 批量生成任务
            </button>
          </div>
        )}
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

// 收件箱单行
interface InboxRowProps {
  item: InboxItem;
  selected: boolean;
  settings: import('../types').EbbSettings;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onStage?: () => void;
  onUpdate?: (patch: Partial<InboxItem>) => void;
}

const InboxRow: React.FC<InboxRowProps> = ({ item, selected, settings, onSelect, onDelete, onStage, onUpdate }) => {
  const handleComplexityChange = (level: ComplexityLevel) => {
    onUpdate?.({
      complexity: level,
      intervals: getIntervalsForComplexity(level, settings.complexityConfigs),
    });
  };

  const handleIntervalsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate?.({ intervals: parseIntervals(e.target.value) ?? undefined });
  };

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate?.({ startDate: e.target.value });
  };

  return (
    <div className={`eb-inbox-row ${selected ? 'eb-inbox-row--selected' : ''}`}>
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onSelect(item.id)}
        className="eb-inbox-row-check"
      />
      <div className="eb-inbox-row-body">
        <div className="eb-inbox-row-header">
          <span className="eb-inbox-row-name">{item.topicName}</span>
          {item.tag && <span className="eb-inbox-row-tag">{item.tag}</span>}
        </div>
        {item.status === 'staged' ? (
          <div className="eb-inbox-row-config">
            <div className="eb-complexity-switch eb-complexity-switch--sm">
              {COMPLEXITY_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`eb-complexity-btn eb-complexity-btn--sm ${item.complexity === level ? 'eb-complexity-btn--active' : ''}`}
                  onClick={() => handleComplexityChange(level)}
                >
                  {settings.complexityConfigs[level].label.split(' ')[0]}
                </button>
              ))}
            </div>
            <input
              type="date"
              className="eb-field-input eb-field-input--sm"
              value={item.startDate || ''}
              onChange={handleStartDateChange}
            />
            <input
              type="text"
              className="eb-field-input eb-field-input--sm eb-field-input--intervals"
              value={item.intervals ? formatIntervals(item.intervals) : ''}
              onChange={handleIntervalsChange}
              placeholder="间隔"
            />
          </div>
        ) : (
          <div className="eb-inbox-row-hint">仅记录主题，升级为暂存后可配置</div>
        )}
      </div>
      <div className="eb-inbox-row-actions">
        {item.status === 'draft' && onStage && (
          <button type="button" className="eb-icon-btn" onClick={onStage} title="升级为暂存">
            <ArrowRight size={13} />
          </button>
        )}
        <button type="button" className="eb-icon-btn eb-icon-btn--danger" onClick={() => onDelete(item.id)} title="删除">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
};

export default InboxPanel;
