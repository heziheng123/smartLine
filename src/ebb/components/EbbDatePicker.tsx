// ============================================================
// Ebb - 简易日期选择器（内联改期）
// 使用 React Portal 渲染到 body，避免被 transform/overflow 容器裁剪
// ============================================================

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import dayjs from 'dayjs';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface EbbDatePickerProps {
  anchorEl: HTMLElement | null;
  value?: string;
  onSelect: (date: string | undefined) => void;
  onClose: () => void;
}

const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

function getWeekStart(date: dayjs.Dayjs): dayjs.Dayjs {
  const d = date.day();
  const offset = d === 0 ? -6 : 1 - d;
  return date.add(offset, 'day');
}

const EbbDatePicker: React.FC<EbbDatePickerProps> = ({ anchorEl, value, onSelect, onClose }) => {
  const [cursor, setCursor] = useState(() => dayjs(value || undefined));
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // 计算 panel 位置：有锚点时贴锚点，无锚点时居中
  useEffect(() => {
    const panelWidth = 240;
    const panelHeight = 280;
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      let left = rect.left;
      let top = rect.bottom + 4;
      if (left + panelWidth > window.innerWidth - 8) {
        left = window.innerWidth - panelWidth - 8;
      }
      if (top + panelHeight > window.innerHeight - 8) {
        top = rect.top - panelHeight - 4;
      }
      setPosition({ top, left });
    } else {
      // 无锚点：视口居中
      setPosition({
        top: Math.max(8, (window.innerHeight - panelHeight) / 2),
        left: Math.max(8, (window.innerWidth - panelWidth) / 2),
      });
    }
  }, [anchorEl]);

  // 点击外部/ESC 关闭
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        if (!anchorEl || !anchorEl.contains(e.target as Node)) {
          onClose();
        }
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose, anchorEl]);

  const days = useMemo(() => {
    const monthStart = cursor.startOf('month');
    const gridStart = getWeekStart(monthStart);
    return Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
  }, [cursor]);

  const currentMonth = cursor.month();
  const todayStr = dayjs().format('YYYY-MM-DD');

  const handleClear = useCallback(() => {
    onSelect(undefined);
    onClose();
  }, [onSelect, onClose]);

  const handleSelect = useCallback((date: string) => {
    onSelect(date);
    onClose();
  }, [onSelect, onClose]);

  return createPortal(
    <div className={`eb-datepicker-overlay ${!anchorEl ? 'eb-datepicker-overlay--centered' : ''}`}>
      <div
        ref={panelRef}
        className="eb-datepicker"
        style={{ position: 'fixed', top: position.top, left: position.left }}
      >
        <div className="eb-datepicker-header">
          <button type="button" className="eb-datepicker-nav" onClick={() => setCursor((c) => c.subtract(1, 'month'))}>
            <ChevronLeft size={14} />
          </button>
          <span className="eb-datepicker-range">{cursor.format('YYYY年M月')}</span>
          <button type="button" className="eb-datepicker-nav" onClick={() => setCursor((c) => c.add(1, 'month'))}>
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="eb-datepicker-weekday-row">
          {WEEKDAY_SHORT.map((w) => (
            <div key={w} className="eb-datepicker-weekday">{w}</div>
          ))}
        </div>
        <div className="eb-datepicker-grid">
          {days.map((day) => {
            const dateStr = day.format('YYYY-MM-DD');
            const inMonth = day.month() === currentMonth;
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === value;
            return (
              <button
                key={dateStr}
                type="button"
                className={[
                  'eb-datepicker-cell',
                  !inMonth ? 'eb-datepicker-cell--other' : '',
                  isToday ? 'eb-datepicker-cell--today' : '',
                  isSelected ? 'eb-datepicker-cell--selected' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => handleSelect(dateStr)}
              >
                {day.date()}
              </button>
            );
          })}
        </div>
        <div className="eb-datepicker-footer">
          <button type="button" className="eb-datepicker-clear" onClick={handleClear}>
            清除日期
          </button>
          <button type="button" className="eb-datepicker-today" onClick={() => handleSelect(todayStr)}>
            今天
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// 引入 useMemo 以避免 ESLint 警告

export default EbbDatePicker;
