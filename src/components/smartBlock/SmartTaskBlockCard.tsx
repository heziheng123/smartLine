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
  Calendar,
  Clock,
  Tag,
  Trash2,
  ChevronDown,
  Repeat,
  Network,
  RefreshCw,
  Video,
  BookOpen,
  PenTool,
  StickyNote,
} from 'lucide-react';
import type { SmartTaskBlock, SmartTaskHeader } from '@/types';
import { getTagColor, DEFAULT_TAG_COLORS } from '@/utils/blocks';
import { sanitizeHtml } from '@/utils/sanitize';
import { GraphNodeSelect } from '@/graph/components/GraphNodeSelect';
import { useGraphStore } from '@/graph/store';

interface SmartTaskBlockCardProps {
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

const TASK_TYPE_CONFIG = {
  'video': { icon: <Video size={12} />, label: '网课 (吸收)', color: '#ef4444' },
  'reading': { icon: <BookOpen size={12} />, label: '阅读 (吸收)', color: '#f59e0b' },
  'exercise': { icon: <PenTool size={12} />, label: '做题 (输出)', color: '#3b82f6' },
  'note': { icon: <StickyNote size={12} />, label: '笔记 (输出)', color: '#8b5cf6' },
};

export const SmartTaskBlockCard: React.FC<SmartTaskBlockCardProps> = ({
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
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const { getNodeById } = useGraphStore();
  const graphNode = header.graphNodeId ? getNodeById(header.graphNodeId) : null;

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
  const handleGraphNodeSelect = useCallback((nodeId: string) => {
    onUpdateHeader(block.id, { graphNodeId: nodeId, autoSyncEbb: true });
    setShowGraphPicker(false);
  }, [block.id, onUpdateHeader]);

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
  const tagBgStyle = { backgroundColor: header.tagColor + '1A', color: header.tagColor };

  if (compact) {
    // 紧凑模式：单行卡条
    return (
      <div
        className={`stb-card stb-card--compact ${header.isCompleted ? 'stb-card--done' : ''}`}
        style={{ borderLeftColor: leftBarColor }}
        onClick={() => setBodyExpanded(!bodyExpanded)}
      >
        <button
          type="button"
          className={`stb-check ${header.isCompleted ? 'stb-check--done' : ''}`}
          onClick={(e) => { e.stopPropagation(); handleToggle(); }}
        >
          {header.isCompleted && <Check size={12} strokeWidth={3} />}
        </button>
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
        {bodyExpanded && (
          <div className="stb-body-compact">
            {hasBody ? (
              <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }} />
            ) : (
              <span className="stb-body-empty">点击编辑详情...</span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
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
        <button
          type="button"
          className={`stb-check ${header.isCompleted ? 'stb-check--done' : ''}`}
          onClick={handleToggle}
          title={header.isCompleted ? '标记未完成' : '标记完成'}
        >
          {header.isCompleted && <Check size={11} strokeWidth={3} />}
        </button>

        {/* 右侧内容容器：标题 → 元数据 → Body */}
        <div className="stb-header-content">
          {/* 第一层：标题（横向占满，允许折行） */}
          <textarea
            ref={titleRef}
            className={`stb-title ${header.isCompleted ? 'stb-title--done' : ''}`}
            value={header.title}
            onChange={(e) => onUpdateHeader(block.id, { title: e.target.value })}
            rows={1}
          />

          {/* 第二层：元数据（紧贴标题下方，极小字号） */}
          <div className="stb-meta-row">
            <button
              type="button"
              className="stb-tag-badge"
              style={tagBgStyle}
              onClick={() => setShowTagPicker(!showTagPicker)}
            >
              <Tag size={9} /> {header.tag}
            </button>

            <button
              type="button"
              className={`stb-date-badge ${isOverdue ? 'stb-date-badge--overdue' : ''} ${isToday && !isOverdue ? 'stb-date-badge--today' : ''}`}
              ref={setDateAnchor}
              onClick={() => setShowDatePicker(!showDatePicker)}
            >
              <Calendar size={10} /> {dateLabel}
            </button>

            <span className="stb-duration-badge">
              <Clock size={10} />
              <input
                type="number"
                className="stb-duration-input"
                value={header.duration}
                onChange={handleDurationChange}
                min={5}
                step={5}
                title="预估时长（分钟）"
              />
              <span>min</span>
            </span>

            {header.recurring && (
              <span className="stb-recurring-badge" title={header.recurring}>
                <Repeat size={10} /> 🔁
              </span>
            )}

            <button
              type="button"
              className={`stb-tag-badge ${header.autoSyncEbb ? 'stb-tag-badge--sync' : ''}`}
              style={header.autoSyncEbb ? { backgroundColor: '#eff6ff', color: '#3b82f6' } : {}}
              onClick={() => setShowGraphPicker(!showGraphPicker)}
              title="绑定知识节点并自动同步至复习流"
            >
              <Network size={10} /> {graphNode ? graphNode.name : '未绑定节点'}
              {header.autoSyncEbb && <RefreshCw size={8} style={{ marginLeft: 2 }} />}
            </button>

            {/* 任务类型选择器（仅当绑定了节点时才显示，因为只有进入复习流才有分类意义） */}
            {header.graphNodeId && (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="stb-tag-badge"
                  style={{ 
                    color: header.taskType ? TASK_TYPE_CONFIG[header.taskType].color : '#6b7280',
                    backgroundColor: header.taskType ? `${TASK_TYPE_CONFIG[header.taskType].color}15` : '#f3f4f6'
                  }}
                  onClick={() => setShowTypePicker(!showTypePicker)}
                >
                  {header.taskType ? (
                    <>
                      {TASK_TYPE_CONFIG[header.taskType].icon}
                      {TASK_TYPE_CONFIG[header.taskType].label.split(' ')[0]}
                    </>
                  ) : (
                    <>
                      <Tag size={10} /> 未分类
                    </>
                  )}
                </button>
                {showTypePicker && (
                  <div className="stb-type-dropdown" onClick={(e) => e.stopPropagation()}>
                    {(Object.keys(TASK_TYPE_CONFIG) as Array<keyof typeof TASK_TYPE_CONFIG>).map(type => (
                      <div 
                        key={type}
                        className="stb-type-option"
                        onClick={() => {
                          onUpdateHeader(block.id, { taskType: type });
                          setShowTypePicker(false);
                        }}
                      >
                        <span style={{ color: TASK_TYPE_CONFIG[type].color, display: 'flex', alignItems: 'center' }}>
                          {TASK_TYPE_CONFIG[type].icon}
                        </span>
                        <span>{TASK_TYPE_CONFIG[type].label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

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
          {bodyExpanded && (
            <div className="stb-body">
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
            </div>
          )}
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
          <div onClick={(e) => e.stopPropagation()}>
            <GraphNodeSelect 
              value={header.graphNodeId}
              onChange={handleGraphNodeSelect}
            />
            {header.graphNodeId && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: '#fff', borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#374151' }}>
                  <input 
                    type="checkbox" 
                    checked={header.autoSyncEbb}
                    onChange={(e) => onUpdateHeader(block.id, { autoSyncEbb: e.target.checked })}
                  />
                  完成时自动同步至 Ebb 复习流
                </label>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
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
