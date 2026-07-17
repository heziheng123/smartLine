// ============================================================
// 智能任务块卡片（Smart Task Block Card）
// Header 属性区 + Body 详情区 双层结构
// 支持：完成切换、标签选择、日期修改、Body 内联编辑
// ============================================================

import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import dayjs from 'dayjs';
import { todayStr, formatDate, getDayOfWeek, isBeforeDay, makeLocalDayjs } from '@/utils/dateSafe';
import {
  Check,
  Clock,
  Trash2,
  ChevronDown,
} from 'lucide-react';
import type { SmartTaskBlock, SmartTaskHeader } from '@/types';
import { getTagColor, DEFAULT_TAG_COLORS } from '@/utils/blocks';
import { sanitizeHtml } from '@/utils/sanitize';
import { GraphNodeSelect } from '@/graph/components/GraphNodeSelect';
import { useGraphStore } from '@/graph/store';
import { getValidGraphNodeIds, shouldAutoSyncEbb } from '@/utils/blocks';
import { useGraphBindingStore } from '@/graph/bindingStore';
import { motion, AnimatePresence } from 'framer-motion';

interface SmartTaskBlockCardProps {
  parentTaskId: string;
  block: SmartTaskBlock;
  onUpdateHeader: (blockId: string, patch: Partial<SmartTaskHeader>) => void;
  onUpdateBody: (blockId: string, body: string) => void;
  onDelete: (blockId: string) => void;
  /** 是否在矩阵/每日视图中使用（折叠模式） */
  compact?: boolean;
  /** 强制展开/折叠：true=展开，false=折叠，null=自动 */
  expandOverride?: boolean | null;
}

const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

export const SmartTaskBlockCard: React.FC<SmartTaskBlockCardProps> = ({
  parentTaskId,
  block,
  onUpdateHeader,
  onUpdateBody,
  onDelete,
  compact = false,
  expandOverride = null,
}) => {
  const { header, body } = block;
  const hasBody = body && body.trim() !== '';
  const [bodyExpanded, setBodyExpanded] = useState(() => !compact && !!hasBody);

  // 响应外部展开/折叠控制
  useEffect(() => {
    if (expandOverride !== null && expandOverride !== undefined) {
      setBodyExpanded(expandOverride);
    }
  }, [expandOverride]);
  const [editingBody, setEditingBody] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showGraphPicker, setShowGraphPicker] = useState(false);
  const startGraphBinding = useGraphBindingStore((state) => state.start);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const { nodes, getNodeById } = useGraphStore();
  const graphNodeIds = useMemo(() => getValidGraphNodeIds(header), [header]);
  const validGraphNodeIds = useMemo(() => graphNodeIds.filter(id => getNodeById(id)), [graphNodeIds, getNodeById]);
  const graphNodes = useMemo(() => {
    if (!Array.isArray(graphNodeIds)) return [];
    return validGraphNodeIds.map(id => getNodeById(id)) as typeof nodes;
  }, [graphNodeIds, validGraphNodeIds, getNodeById]);

  // 计算任务标题的幽灵文本（智能推荐节点名称）
  const titleGhostText = useMemo(() => {
    if (!header.title || header.isCompleted) return '';
    const match = nodes.find(n => n.name.toLowerCase().startsWith(header.title.toLowerCase()));
    if (match) {
      return header.title + match.name.slice(header.title.length);
    }
    return '';
  }, [header.title, header.isCompleted, nodes]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && titleGhostText && titleGhostText !== header.title) {
      e.preventDefault();
      onUpdateHeader(block.id, { title: titleGhostText });
    }
  }, [block.id, header.title, titleGhostText, onUpdateHeader]);

  // textarea 自动撑高
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [header.title]);

  // 完成切换
  const handleToggle = useCallback(() => {
    const now = todayStr();
    onUpdateHeader(block.id, {
      isCompleted: !header.isCompleted,
      completedDate: !header.isCompleted ? now : undefined,
    });
  }, [block.id, header.isCompleted, onUpdateHeader]);

  // Body 编辑
  const handleBodyBlur = useCallback(() => {
    if (bodyRef.current) {
      const html = bodyRef.current.innerHTML;
      onUpdateBody(block.id, html);
    }
    setEditingBody(false);
  }, [block.id, onUpdateBody]);

  const handleBodyClick = useCallback(() => {
    setEditingBody(true);
    setBodyExpanded(true);
  }, []);

  // 标签选择
  const handleTagSelect = useCallback((tag: string) => {
    onUpdateHeader(block.id, {
      tag,
      tagColor: getTagColor(tag),
    });
    setShowTagPicker(false);
  }, [block.id, onUpdateHeader]);

  // 日期选择
  const handleDateSelect = useCallback((date: string) => {
    onUpdateHeader(block.id, { date });
    setShowDatePicker(false);
  }, [block.id, onUpdateHeader]);

  // 知识节点选择
  const handleGraphNodeSelect = useCallback((nodeIds: string[]) => {
    onUpdateHeader(block.id, { 
      graphNodeIds: nodeIds, 
      autoSyncEbb: shouldAutoSyncEbb(header),
    });
    // 不自动关闭，支持连续点选
  }, [block.id, header, onUpdateHeader]);

  const handleOpenGraphBinding = useCallback(() => {
    setShowGraphPicker(false);
    startGraphBinding({
      taskId: parentTaskId,
      blockId: block.id,
      taskTitle: header.title,
      nodeIds: validGraphNodeIds,
    });
  }, [startGraphBinding, parentTaskId, block.id, header.title, validGraphNodeIds]);

  // 时长修改
  const handleDurationChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val > 0) {
      onUpdateHeader(block.id, { duration: val });
    }
  }, [block.id, onUpdateHeader]);

  const dateLabel = header.date
    ? `${formatDate(header.date, 'M.D')} 周${WEEKDAY_SHORT[getDayOfWeek(header.date)]}`
    : '未排期';

  const isOverdue = header.date && !header.isCompleted && isBeforeDay(header.date, todayStr());
  const isToday = header.date === todayStr();

  // 左侧高亮条颜色
  const leftBarColor = header.isCompleted
    ? '#86EFAC'
    : isOverdue
      ? '#FCA5A5'
      : header.tagColor;

  // 极淡的标签底色（用于徽章）
  const tagBgStyle = { color: header.tagColor };

  if (compact) {
    // 紧凑模式：单行卡条
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className={`stb-card stb-card--compact ${header.isCompleted ? 'stb-card--done' : ''}`}
        style={{ borderLeftColor: leftBarColor }}
        onClick={() => setBodyExpanded(!bodyExpanded)}
      >
        <motion.button
          whileTap={{ scale: 0.8 }}
          type="button"
          className={`stb-check ${header.isCompleted ? 'stb-check--done' : ''}`}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleToggle(); }}
        >
          {header.isCompleted && <Check size={12} strokeWidth={3} />}
        </motion.button>
        <span className="stb-tag-badge" style={tagBgStyle}>
          {header.tag}
        </span>
        <input
          type="text"
          className={`stb-title ${header.isCompleted ? 'stb-title--done' : ''}`}
          value={header.title}
          onChange={(e) => onUpdateHeader(block.id, { title: e.target.value })}
        />
        <span className="stb-meta">
          <Clock size={12} /> {header.duration}min
        </span>
        <AnimatePresence initial={false}>
          {bodyExpanded && (
            <motion.div 
              className="stb-body-compact"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              style={{ overflow: 'hidden', width: '100%' }}
            >
              {hasBody ? (
                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }} />
              ) : (
                <span className="stb-body-empty">点击编辑详情...</span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={`stb-card ${header.isCompleted ? 'stb-card--done' : ''}`}
      style={{ borderLeftColor: leftBarColor }}
    >
      {/* ── 左侧色条（绝对定位） ── */}
      <div
        className="stb-accent-bar"
        style={{ backgroundColor: leftBarColor }}
        aria-hidden
      />

      {/* ── 主容器：复选框 + 右侧内容 ── */}
      <div className="stb-header-main">
        <motion.button
          whileTap={{ scale: 0.8 }}
          type="button"
          className={`stb-check ${header.isCompleted ? 'stb-check--done' : ''}`}
          onClick={handleToggle}
          title={header.isCompleted ? '标记未完成' : '标记完成'}
        >
          {header.isCompleted && <Check size={11} strokeWidth={3} />}
        </motion.button>

        {/* 右侧内容容器：标题 → 元数据 → Body */}
        <div className="stb-header-content">
          {/* 第一层：标题（横向占满，允许折行） */}
          <div style={{ position: 'relative', width: '100%' }}>
            {titleGhostText && titleGhostText !== header.title && (
              <div
                style={{
                  position: 'absolute',
                  left: 4,
                  top: 0,
                  right: 4,
                  bottom: 0,
                  pointerEvents: 'none',
                  color: '#9ca3af',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                  fontWeight: 500,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  zIndex: 1,
                  display: 'flex',
                  alignItems: 'flex-start'
                }}
              >
                <span style={{ opacity: 0 }}>{header.title}</span>
                <span>{titleGhostText.slice(header.title.length)}</span>
                <span style={{ 
                  marginLeft: 8, 
                  fontSize: 10, 
                  backgroundColor: '#f3f4f6', 
                  padding: '0 4px', 
                  borderRadius: 4,
                  color: '#6b7280',
                  border: '1px solid #e5e7eb',
                  height: '16px',
                  lineHeight: '14px',
                  marginTop: 3
                }}>Tab</span>
              </div>
            )}
            <textarea
              ref={titleRef}
              className={`stb-title ${header.isCompleted ? 'stb-title--done' : ''}`}
              value={header.title}
              onChange={(e) => onUpdateHeader(block.id, { title: e.target.value })}
              onKeyDown={handleTitleKeyDown}
              rows={1}
              style={{ position: 'relative', zIndex: 2, background: 'transparent' }}
            />
          </div>

          {/* 第二层：元数据（紧贴标题下方，极小字号） */}
          <div className="stb-meta-row">
            <button
              type="button"
              className="stb-tag-badge"
              style={tagBgStyle}
              onClick={() => setShowTagPicker(!showTagPicker)}
            >
              {header.tag}
            </button>

            <span className="text-slate-300">·</span>

            <button
              type="button"
              className={`stb-date-badge ${isOverdue ? 'stb-date-badge--overdue' : ''} ${isToday && !isOverdue ? 'stb-date-badge--today' : ''}`}
              ref={setDateAnchor}
              onClick={() => setShowDatePicker(!showDatePicker)}
            >
              {dateLabel}
            </button>

            <span className="text-slate-300">·</span>

            <span className="stb-duration-badge">
              <input
                type="number"
                className="stb-duration-input"
                value={header.duration}
                onChange={handleDurationChange}
                min={5}
                step={5}
                title="预估时长（分钟）"
              />
              <span style={{ fontSize: 10 }}>m</span>
            </span>

            {header.recurring && (
              <>
                <span className="text-slate-300">·</span>
                <span className="stb-recurring-badge" title={header.recurring}>
                  循环
                </span>
              </>
            )}

            <span className="text-slate-300">·</span>

            <div className="stb-node-badge-group" style={{ display: 'flex', gap: '4px', flexWrap: 'nowrap', overflow: 'hidden' }}>
              {graphNodes.length === 0 ? (
                <button
                  type="button"
                  className="stb-tag-badge"
                  style={{ color: '#6b7280', flexShrink: 0 }}
                  onClick={() => setShowGraphPicker(!showGraphPicker)}
                  title="绑定知识节点"
                >
                  <span className="stb-node-name">未绑定节点</span>
                </button>
              ) : (
                <>
                  {graphNodes.slice(0, 1).map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className={`stb-tag-badge ${header.autoSyncEbb ? 'stb-tag-badge--sync' : ''}`}
                      style={{ color: '#3b82f6', flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      onClick={() => setShowGraphPicker(!showGraphPicker)}
                      title={graphNodes.map(node => node.name).join(', ')}
                    >
                      <span className="stb-node-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
                    </button>
                  ))}
                  {graphNodes.length > 1 && (
                    <button
                      type="button"
                      className="stb-tag-badge"
                      style={{ color: '#6b7280', backgroundColor: '#f3f4f6', flexShrink: 0 }}
                      onClick={() => setShowGraphPicker(!showGraphPicker)}
                      title={graphNodes.map(node => node.name).join(', ')}
                    >
                      +{graphNodes.length - 1}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Hover 快捷菜单（仅删除） */}
            <div className="stb-actions">
              <button
                type="button"
                className="stb-action-btn stb-action-btn--danger"
                onClick={() => onDelete(block.id)}
                title="删除此任务块"
              >
                <Trash2 size={12} />
              </button>
            </div>

            {/* 折叠箭头（始终可见，靠右） */}
            <button
              type="button"
              className={`stb-collapse-arrow ${bodyExpanded ? 'stb-collapse-arrow--open' : ''}`}
              onClick={() => setBodyExpanded(!bodyExpanded)}
              title={bodyExpanded ? '折叠详情' : '展开详情'}
            >
              <ChevronDown size={12} />
            </button>
          </div>

          {/* 第三层：Body 详情区（紧贴元数据下方，缩进+引述线） */}
          <AnimatePresence initial={false}>
            {bodyExpanded && (
              <motion.div 
                className="stb-body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                style={{ overflow: 'hidden' }}
              >
                <div
                  ref={bodyRef}
                  className={`stb-body-editor ${editingBody ? 'stb-body-editor--active' : ''}`}
                  contentEditable={editingBody}
                  suppressContentEditableWarning
                  onBlur={handleBodyBlur}
                  onClick={handleBodyClick}
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }}
                />
                {!hasBody && !editingBody && (
                  <span className="stb-body-placeholder" onClick={handleBodyClick}>
                    点击编辑详情...
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── 标签选择器浮层 ── */}
      {showTagPicker && createPortal(
        <div className="stb-tag-picker-overlay" onClick={() => setShowTagPicker(false)}>
          <div className="stb-tag-picker" onClick={(e) => e.stopPropagation()}>
            <div className="stb-tag-picker-title">选择标签</div>
            {Object.entries(DEFAULT_TAG_COLORS).map(([tag, color]) => (
              <button
                key={tag}
                type="button"
                className={`stb-tag-option ${header.tag === tag ? 'stb-tag-option--active' : ''}`}
                onClick={() => handleTagSelect(tag)}
              >
                <span className="stb-tag-dot" style={{ backgroundColor: color }} />
                {tag}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}

      {/* ── 日期选择器 ── */}
      {showDatePicker && dateAnchor && createPortal(
        <div className="stb-date-picker-overlay" onClick={() => setShowDatePicker(false)}>
          <div className="stb-date-picker" onClick={(e) => e.stopPropagation()}>
            <MiniCalendarInline
              selectedDate={header.date}
              onDateSelect={handleDateSelect}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* ── 知识节点选择器浮层 ── */}
      {showGraphPicker && createPortal(
        <div className="stb-tag-picker-overlay" onClick={() => setShowGraphPicker(false)}>
          <div 
            className="stb-tag-picker stb-graph-picker-container"
            onClick={e => e.stopPropagation()}
          >
            <GraphNodeSelect 
              value={validGraphNodeIds}
              onChange={handleGraphNodeSelect}
              taskTitle={header.title}
              footer={
                <div style={{ padding: '8px 12px', borderTop: '1px solid #f3f4f6', backgroundColor: '#fafaf9', borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px', display: 'grid', gap: 8 }}>
                  <button type="button" className="stb-graph-option" onClick={handleOpenGraphBinding} style={{ justifyContent: 'center', color: '#4f46e5', fontWeight: 600 }}>
                    去知识大盘选择
                  </button>
                  <label className="stb-sync-checkbox flex items-center cursor-pointer" title="任务完成后是否自动安排艾宾浩斯复习">
                    <input
                      type="checkbox"
                      checked={shouldAutoSyncEbb(header)}
                      onChange={(e) => onUpdateHeader(block.id, { autoSyncEbb: e.target.checked })}
                      className="mr-2"
                    />
                    <span className="text-[12px] text-slate-600 font-medium">自动同步至复习流</span>
                  </label>
                </div>
              }
            />
          </div>
        </div>,
        document.body
      )}
    </motion.div>
  );
};

/** 内联日历小组件（轻量版，用于 block 日期选择） */
const MiniCalendarInline: React.FC<{
  selectedDate: string;
  onDateSelect: (date: string) => void;
}> = ({ selectedDate, onDateSelect }) => {
  const [cursor, setCursor] = useState(() => selectedDate ? makeLocalDayjs(selectedDate) : dayjs());
  const [view, setView] = useState<'days' | 'years'>('days');
  const today = todayStr();

  const startOfMonth = cursor.startOf('month');
  const startDay = startOfMonth.day(); // 0=Sun
  const daysInMonth = cursor.daysInMonth();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthLabel = `${cursor.year()}年${cursor.month() + 1}月`;
  const yearLabel = `${cursor.year()}年`;

  // 年份视图：当前年份 ± 5，共 12 个
  const yearCells = useMemo(() => {
    const currentYear = cursor.year();
    const startYear = currentYear - 5;
    const years: number[] = [];
    for (let y = startYear; y < startYear + 12; y++) years.push(y);
    return years;
  }, [cursor]);

  const isCurrentMonth = `${cursor.year()}-${String(cursor.month() + 1).padStart(2, '0')}` === todayStr().slice(0, 7);

  return (
    <div className="stb-mini-cal">
      <div className="stb-mini-cal-header">
        {view === 'days' ? (
          <>
            <button type="button" onClick={() => setCursor(c => c.subtract(1, 'month'))}>◀</button>
            <button
              type="button"
              className="stb-mini-cal-title"
              onClick={() => setView('years')}
              title="点击切换年份"
            >
              {monthLabel}
            </button>
            <button type="button" onClick={() => setCursor(c => c.add(1, 'month'))}>▶</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setCursor(c => c.subtract(12, 'year'))}>◀</button>
            <button
              type="button"
              className="stb-mini-cal-title"
              onClick={() => setView('days')}
            >
              {yearLabel}
            </button>
            <button type="button" onClick={() => setCursor(c => c.add(12, 'year'))}>▶</button>
          </>
        )}
      </div>
      {view === 'days' ? (
        <div className="stb-mini-cal-grid">
          {['日', '一', '二', '三', '四', '五', '六'].map(d => (
            <span key={d} className="stb-mini-cal-dow">{d}</span>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <span key={`e${i}`} />;
            const c = cursor.date(d);
            const dateStr = `${c.year()}-${String(c.month() + 1).padStart(2, '0')}-${String(c.date()).padStart(2, '0')}`;
            const isSelected = dateStr === selectedDate;
            const isToday = dateStr === today;
            return (
              <button
                key={dateStr}
                type="button"
                className={`stb-mini-cal-day ${isSelected ? 'stb-mini-cal-day--selected' : ''} ${isToday ? 'stb-mini-cal-day--today' : ''}`}
                onClick={() => onDateSelect(dateStr)}
              >
                {d}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="stb-mini-cal-years">
          {yearCells.map(y => {
            const isYearSelected = y === cursor.year();
            const isYearCurrent = y === dayjs().year();
            return (
              <button
                key={y}
                type="button"
                className={`stb-mini-cal-year ${isYearSelected ? 'stb-mini-cal-year--selected' : ''} ${isYearCurrent ? 'stb-mini-cal-year--current' : ''}`}
                onClick={() => {
                  setCursor(c => c.year(y));
                  setView('days');
                }}
              >
                {y}
              </button>
            );
          })}
        </div>
      )}
      {!isCurrentMonth && (
        <button
          type="button"
          className="stb-mini-cal-today"
          onClick={() => {
            setCursor(dayjs());
            setView('days');
          }}
        >
          回到今天
        </button>
      )}
    </div>
  );
};

export default SmartTaskBlockCard;
