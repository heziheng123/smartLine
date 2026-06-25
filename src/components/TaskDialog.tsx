// ============================================================
// Smart Timeline - 任务新增 / 编辑对话框
// ============================================================

import React, { useState } from 'react';
import type { Task } from '@/types';

interface TaskDialogProps {
  task?: Task;
  onSave: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onCancel: () => void;
}

const PRESET_COLORS = [
  '#E0F2FE', '#D1FAE5', '#FFE4E6', '#FEF3C7',
  '#EDE9FE', '#FFEDD5', '#CFFAFE', '#FCE7F3',
  '#ECFCCB', '#F3E8FF',
];

const TaskDialog: React.FC<TaskDialogProps> = ({
  task,
  onSave,
  onDelete,
  onCancel,
}) => {
  const isEdit = !!task;

  const [name, setName] = useState(task?.name ?? '');
  const [start, setStart] = useState(task?.start ?? '');
  const [end, setEnd] = useState(task?.end ?? '');
  const [color, setColor] = useState(task?.color ?? '');
  const [isMain, setIsMain] = useState(task?.isMain ?? false);
  const [completed, setCompleted] = useState(task?.completed ?? false);
  const [notePath, setNotePath] = useState(task?.notePath ?? '');

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || !start || !end) return;
    if (end < start) return;

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
      id: task?.id ?? crypto.randomUUID(),
      name: trimmed,
      start,
      end,
      color: finalColor,
      isMain,
      completed,
      notePath: notePath.trim() || undefined,
      groupId: task?.groupId,
    });
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  const isValid = name.trim() && start && end && end >= start;

  return (
    <div className="tl-dialog-overlay" onClick={handleOverlayClick}>
      <div className="tl-dialog">
        <div className="tl-dialog-header">
          <h3>{isEdit ? '编辑任务' : '新建任务'}</h3>
        </div>

        <div className="tl-dialog-body">
          <label className="tl-dialog-field">
            <span className="tl-dialog-label">任务名称</span>
            <input
              className="tl-dialog-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：政治第一轮"
              autoFocus
            />
          </label>

          <div className="tl-dialog-row">
            <label className="tl-dialog-field">
              <span className="tl-dialog-label">开始日期</span>
              <input
                className="tl-dialog-input"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="tl-dialog-field">
              <span className="tl-dialog-label">结束日期</span>
              <input
                className="tl-dialog-input"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>

          {start && end && end < start && (
            <div className="tl-dialog-error">结束日期必须晚于或等于开始日期</div>
          )}

          <label className="tl-dialog-field">
            <span className="tl-dialog-label">方块颜色</span>
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

          <div className="tl-dialog-row">
            <label className="tl-dialog-checkbox">
              <input
                type="checkbox"
                checked={isMain}
                onChange={(e) => setIsMain(e.target.checked)}
              />
              <span>主线任务</span>
            </label>
            <label className="tl-dialog-checkbox">
              <input
                type="checkbox"
                checked={completed}
                onChange={(e) => setCompleted(e.target.checked)}
              />
              <span>已完成</span>
            </label>
          </div>

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
              onClick={() => onDelete(task!.id)}
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

export default TaskDialog;
