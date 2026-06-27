// ============================================================
// Smart Timeline - 分组新增 / 编辑对话框
// ============================================================

import React, { useState } from 'react';
import type { Task, TaskGroup } from '@/types';

interface GroupDialogProps {
  group?: TaskGroup;
  /** 所有可用任务列表（供选择子任务） */
  allTasks: Task[];
  onSave: (group: TaskGroup) => void;
  onDelete?: (groupId: string) => void;
  onCancel: () => void;
}

const PRESET_COLORS = [
  '#D1FAE5', '#EDE9FE', '#FEF3C7', '#FFE4E6',
  '#E0F2FE', '#F3E8FF', '#FCE7F3', '#CFFAFE',
];

const GroupDialog: React.FC<GroupDialogProps> = ({
  group,
  allTasks,
  onSave,
  onDelete,
  onCancel,
}) => {
  const isEdit = !!group;

  const [name, setName] = useState(group?.name ?? '');
  const [start, setStart] = useState(group?.start ?? '');
  const [end, setEnd] = useState(group?.end ?? '');
  const [color, setColor] = useState(group?.color ?? '');
  const [autoDate, setAutoDate] = useState(group?.autoDate ?? true);

  // 已选中的子任务 ID 集合
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => {
    const ids = group?.children.map((c) => c.id) ?? [];
    return new Set(ids);
  });

  const toggleTask = (taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;

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

    // 根据选中的 ID 构建子任务列表
    const children = allTasks.filter((t) => selectedTaskIds.has(t.id));

    onSave({
      id: group?.id ?? crypto.randomUUID(),
      name: trimmed,
      start: start || '',
      end: end || '',
      color: finalColor,
      autoDate,
      children,
    });
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return (
    <div className="tl-dialog-overlay" onClick={handleOverlayClick}>
      <div className="tl-dialog">
        <div className="tl-dialog-header">
          <h3>{isEdit ? '编辑分组' : '新建分组'}</h3>
        </div>

        <div className="tl-dialog-body">
          <label className="tl-dialog-field">
            <span className="tl-dialog-label">分组名称</span>
            <input
              className="tl-dialog-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：产品研发"
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
                disabled={autoDate}
              />
            </label>
            <label className="tl-dialog-field">
              <span className="tl-dialog-label">结束日期</span>
              <input
                className="tl-dialog-input"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                disabled={autoDate}
              />
            </label>
          </div>

          <label className="tl-dialog-checkbox">
            <input
              type="checkbox"
              checked={autoDate}
              onChange={(e) => setAutoDate(e.target.checked)}
            />
            <span>自动从子任务计算日期范围</span>
          </label>

          <label className="tl-dialog-field">
            <span className="tl-dialog-label">分组颜色</span>
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

          {/* 子任务选择 */}
          <div className="tl-dialog-field">
            <span className="tl-dialog-label">选择任务（{selectedTaskIds.size} 个已选）</span>
            <div className="tl-dialog-task-list">
              {allTasks.length === 0 ? (
                <div className="tl-dialog-task-empty">暂无任务，请先创建任务</div>
              ) : (
                allTasks.map((task) => (
                  <label key={task.id} className="tl-dialog-task-item">
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.has(task.id)}
                      onChange={() => toggleTask(task.id)}
                    />
                    <span
                      className="tl-dialog-task-dot"
                      style={{ backgroundColor: task.isMain ? '#FEE2E2' : (task.color || '#E0F2FE') }}
                    />
                    <span className="tl-dialog-task-name">{task.name}</span>
                    <span className="tl-dialog-task-date">{task.start} ~ {task.end}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="tl-dialog-footer">
          {isEdit && onDelete && (
            <button
              className="tl-dialog-btn tl-dialog-btn--danger"
              onClick={() => onDelete(group!.id)}
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
              disabled={!name.trim()}
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

export default GroupDialog;
