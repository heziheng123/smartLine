// ============================================================
// Smart Timeline - 便签新增 / 编辑对话框
// ============================================================

import React, { useState } from 'react';
import type { Note } from '@/types';

interface NoteDialogProps {
  note?: Note;
  onSave: (note: Note) => void;
  onDelete?: (noteId: string) => void;
  onCancel: () => void;
}

const PRESET_COLORS = [
  '#F59E0B', '#EF4444', '#3B82F6', '#10B981',
  '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6',
];

const NoteDialog: React.FC<NoteDialogProps> = ({
  note,
  onSave,
  onDelete,
  onCancel,
}) => {
  const isEdit = !!note;

  const [name, setName] = useState(note?.name ?? '');
  const [date, setDate] = useState(note?.date ?? '');
  const [endDate, setEndDate] = useState(note?.endDate ?? '');
  const [type, setType] = useState<'pin' | 'range'>(note?.type ?? 'pin');
  const [color, setColor] = useState(note?.color ?? '');
  const [notePath, setNotePath] = useState(note?.notePath ?? '');

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || !date) return;
    if (type === 'range' && endDate && endDate < date) return;

    let finalColor: string | undefined;
    const colorTrimmed = color.trim();
    if (colorTrimmed) {
      let c = colorTrimmed.replace(/^#/, '');
      if (/^[0-9a-fA-F]{3}$/.test(c)) {
        c = c.split('').map(x => x + x).join('');
      }
      if (/^[0-9a-fA-F]{6}$/.test(c)) {
        finalColor = `#${c.toUpperCase()}`;
      }
    }

    onSave({
      id: note?.id ?? crypto.randomUUID(),
      name: trimmed,
      date,
      endDate: type === 'range' && endDate ? endDate : undefined,
      type,
      color: finalColor,
      notePath: notePath.trim() || undefined,
    });
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  const isValid = name.trim() && date && (type === 'pin' || !endDate || endDate >= date);

  return (
    <div className="tl-dialog-overlay" onClick={handleOverlayClick}>
      <div className="tl-dialog">
        <div className="tl-dialog-header">
          <h3>{isEdit ? '编辑便签' : '新建便签'}</h3>
        </div>

        <div className="tl-dialog-body">
          <label className="tl-dialog-field">
            <span className="tl-dialog-label">便签内容</span>
            <input
              className="tl-dialog-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：四六级报名"
              autoFocus
            />
          </label>

          <div className="tl-dialog-row">
            <label className="tl-dialog-field">
              <span className="tl-dialog-label">类型</span>
              <select
                className="tl-dialog-input"
                value={type}
                onChange={(e) => setType(e.target.value as 'pin' | 'range')}
              >
                <option value="pin">单日图钉</option>
                <option value="range">日期范围</option>
              </select>
            </label>
            <label className="tl-dialog-field">
              <span className="tl-dialog-label">标记日期</span>
              <input
                className="tl-dialog-input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>

          {type === 'range' && (
            <label className="tl-dialog-field">
              <span className="tl-dialog-label">结束日期</span>
              <input
                className="tl-dialog-input"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          )}

          {type === 'range' && endDate && date && endDate < date && (
            <div className="tl-dialog-error">结束日期必须晚于或等于开始日期</div>
          )}

          <label className="tl-dialog-field">
            <span className="tl-dialog-label">标记颜色</span>
            <div className="tl-dialog-color-row">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  className={`tl-dialog-color-btn ${color === c ? 'tl-dialog-color-btn--active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  type="button"
                />
              ))}
              <input
                className="tl-dialog-input tl-dialog-color-input"
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#自定义"
              />
            </div>
          </label>

          <label className="tl-dialog-field">
            <span className="tl-dialog-label">关联备注</span>
            <input
              className="tl-dialog-input"
              type="text"
              value={notePath}
              onChange={(e) => setNotePath(e.target.value)}
              placeholder="URL 或备注内容"
            />
          </label>
        </div>

        <div className="tl-dialog-footer">
          {isEdit && onDelete && (
            <button
              className="tl-dialog-btn tl-dialog-btn--danger"
              onClick={() => onDelete(note!.id)}
              type="button"
            >
              删除
            </button>
          )}
          <div className="tl-dialog-footer-right">
            <button
              className="tl-dialog-btn tl-dialog-btn--secondary"
              onClick={onCancel}
              type="button"
            >
              取消
            </button>
            <button
              className="tl-dialog-btn tl-dialog-btn--primary"
              onClick={handleSave}
              disabled={!isValid}
              type="button"
            >
              {isEdit ? '保存' : '创建'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NoteDialog;
