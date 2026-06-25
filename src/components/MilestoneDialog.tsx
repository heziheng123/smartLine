// ============================================================
// Smart Timeline - 里程碑新增 / 编辑对话框
// ============================================================

import React, { useState } from 'react';
import type { Milestone } from '@/types';

interface MilestoneDialogProps {
  milestone?: Milestone;
  onSave: (milestone: Milestone) => void;
  onDelete?: (milestoneId: string) => void;
  onCancel: () => void;
}

const PRESET_COLORS = [
  '#FBBF24', '#F59E0B', '#EF4444', '#10B981',
  '#3B82F6', '#8B5CF6', '#EC4899', '#6366F1',
];

const MilestoneDialog: React.FC<MilestoneDialogProps> = ({
  milestone,
  onSave,
  onDelete,
  onCancel,
}) => {
  const isEdit = !!milestone;

  const [name, setName] = useState(milestone?.name ?? '');
  const [date, setDate] = useState(milestone?.date ?? '');
  const [color, setColor] = useState(milestone?.color ?? '');

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || !date) return;

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
      id: milestone?.id ?? crypto.randomUUID(),
      name: trimmed,
      date,
      color: finalColor,
    });
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return (
    <div className="tl-dialog-overlay" onClick={handleOverlayClick}>
      <div className="tl-dialog">
        <div className="tl-dialog-header">
          <h3>{isEdit ? '编辑里程碑' : '新建里程碑'}</h3>
        </div>

        <div className="tl-dialog-body">
          <label className="tl-dialog-field">
            <span className="tl-dialog-label">里程碑名称</span>
            <input
              className="tl-dialog-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：V1.0 上线"
              autoFocus
            />
          </label>

          <label className="tl-dialog-field">
            <span className="tl-dialog-label">日期</span>
            <input
              className="tl-dialog-input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>

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
        </div>

        <div className="tl-dialog-footer">
          {isEdit && onDelete && (
            <button
              className="tl-dialog-btn tl-dialog-btn--danger"
              onClick={() => onDelete(milestone!.id)}
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
              disabled={!name.trim() || !date}
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

export default MilestoneDialog;
