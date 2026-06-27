import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import dayjs from 'dayjs';

interface DatePickerProps {
  value?: string;
  onChange: (date: string | undefined) => void;
  onClose: () => void;
  anchorRect?: DOMRect | null;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const DatePicker: React.FC<DatePickerProps> = ({ value, onChange, onClose, anchorRect }) => {
  const initial = value ? dayjs(value) : dayjs();
  const [cursor, setCursor] = useState(initial);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      setMounted(false);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [onClose]);

  const calendarDays = useMemo(() => {
    const start = cursor.startOf('month').startOf('week');
    return Array.from({ length: 42 }, (_, i) => start.add(i, 'day'));
  }, [cursor]);

  const todayStr = dayjs().format('YYYY-MM-DD');
  const selectedStr = value || '';

  const handleSelect = (d: dayjs.Dayjs) => {
    onChange(d.format('YYYY-MM-DD'));
    onClose();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(undefined);
    onClose();
  };

  const handleToday = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(todayStr);
    onClose();
  };

  const handleMaskClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  const style: React.CSSProperties = anchorRect
    ? {
        position: 'fixed',
        top: anchorRect.bottom + 6,
        left: Math.min(anchorRect.left, window.innerWidth - 230),
        zIndex: 1000,
      }
    : {
        position: 'fixed',
        zIndex: 1000,
      };

  const maskStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 999,
    background: 'transparent',
  };

  const content = (
    <>
      <div style={maskStyle} onMouseDown={handleMaskClick} />
      <div className="tl-datepicker" style={style} onMouseDown={(e) => e.stopPropagation()}>
        <div className="tl-datepicker-header">
          <button
            type="button"
            className="tl-datepicker-nav"
            onClick={() => setCursor((c) => c.subtract(1, 'month'))}
          >
            ‹
          </button>
          <span className="tl-datepicker-title">
            {cursor.format('YYYY年M月')}
          </span>
          <button
            type="button"
            className="tl-datepicker-nav"
            onClick={() => setCursor((c) => c.add(1, 'month'))}
          >
            ›
          </button>
        </div>

        <div className="tl-datepicker-weekdays">
          {WEEKDAYS.map((w) => (
            <span key={w} className="tl-datepicker-weekday">{w}</span>
          ))}
        </div>

        <div className="tl-datepicker-grid">
          {calendarDays.map((d) => {
            const dateStr = d.format('YYYY-MM-DD');
            const isCurrentMonth = d.month() === cursor.month();
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedStr;

            return (
              <button
                key={dateStr}
                type="button"
                className={[
                  'tl-datepicker-day',
                  !isCurrentMonth ? 'tl-datepicker-day--other' : '',
                  isToday ? 'tl-datepicker-day--today' : '',
                  isSelected ? 'tl-datepicker-day--selected' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => handleSelect(d)}
              >
                {d.date()}
              </button>
            );
          })}
        </div>

        <div className="tl-datepicker-footer">
          <button type="button" className="tl-datepicker-clear" onClick={handleClear}>
            清除
          </button>
          <button type="button" className="tl-datepicker-today" onClick={handleToday}>
            今天
          </button>
        </div>
      </div>
    </>
  );

  if (!mounted) return null;
  return createPortal(content, document.body);
};

export default DatePicker;
