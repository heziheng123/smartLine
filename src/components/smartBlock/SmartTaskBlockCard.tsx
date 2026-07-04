// ============================================================
// 智能任务块卡片（Smart Task Block Card）
// Header 属性区 + Body 详情区 双层结构
// 支持：完成切换、标签选择、日期修改、Body 内联编辑
// ============================================================

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import dayjs from 'dayjs';
import {
  Check,
  Calendar,
  Clock,
  Tag,
  Trash2,
  ChevronDown,
  Repeat,
} from 'lucide-react';
import type { SmartTaskBlock, SmartTaskHeader } from '@/types';
import { getTagColor, DEFAULT_TAG_COLORS } from '@/utils/blocks';

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

const SmartTaskBlockCard: React.FC<SmartTaskBlockCardProps> = ({
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
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // textarea 自动撑高
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [header.title]);

  // 完成切换
  const handleToggle = useCallback(() => {
    const now = dayjs().format('YYYY-MM-DD');
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

  // 时长修改
  const handleDurationChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val > 0) {
      onUpdateHeader(block.id, { duration: val });
    }
  }, [block.id, onUpdateHeader]);

  const dateLabel = header.date
    ? `${dayjs(header.date).format('M.D')} 周${WEEKDAY_SHORT[dayjs(header.date).day()]}`
    : '未排期';

  const isOverdue = header.date && !header.isCompleted && dayjs(header.date).isBefore(dayjs(), 'day');
  const isToday = header.date === dayjs().format('YYYY-MM-DD');

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
              <div dangerouslySetInnerHTML={{ __html: body }} />
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
                dangerouslySetInnerHTML={{ __html: body || '' }}
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
    </div>
  );
};

/** 内联日历小组件（轻量版，用于 block 日期选择） */
const MiniCalendarInline: React.FC<{
  selectedDate: string;
  onDateSelect: (date: string) => void;
}> = ({ selectedDate, onDateSelect }) => {
  const [cursor, setCursor] = useState(() => dayjs(selectedDate || undefined));
  const today = dayjs().format('YYYY-MM-DD');

  const startOfMonth = cursor.startOf('month');
  const startDay = startOfMonth.day(); // 0=Sun
  const daysInMonth = cursor.daysInMonth();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthLabel = cursor.format('YYYY年M月');

  return (
    <div className="stb-mini-cal">
      <div className="stb-mini-cal-header">
        <button type="button" onClick={() => setCursor(c => c.subtract(1, 'month'))}>◀</button>
        <span>{monthLabel}</span>
        <button type="button" onClick={() => setCursor(c => c.add(1, 'month'))}>▶</button>
      </div>
      <div className="stb-mini-cal-grid">
        {['日', '一', '二', '三', '四', '五', '六'].map(d => (
          <span key={d} className="stb-mini-cal-dow">{d}</span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />;
          const dateStr = cursor.date(d).format('YYYY-MM-DD');
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
    </div>
  );
};

export default SmartTaskBlockCard;
