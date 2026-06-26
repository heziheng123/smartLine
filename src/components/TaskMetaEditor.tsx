// ============================================================
// Smart Timeline - 任务元信息编辑器（内联折叠区）
// 用于嵌入右边栏顶部，改动即时保存到 store
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import type { Task } from '@/types';

interface TaskMetaEditorProps {
  task: Task;
  /** 即时保存回调：字段变化时触发 */
  onUpdate: (patch: Partial<Task>) => void;
  /** 删除任务 */
  onDelete?: (taskId: string) => void;
}

// 预设色板（与 TaskDialog 保持一致）
const PRESET_COLORS = [
  '#E0F2FE', '#D1FAE5', '#FFE4E6', '#FEF3C7',
  '#EDE9FE', '#FFEDD5', '#CFFAFE', '#FCE7F3',
  '#ECFCCB', '#F3E8FF',
];

// 规范化颜色输入：支持 #RGB / #RRGGBB / 无 #
function normalizeColor(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  let c = trimmed.replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(c)) {
    c = c.split('').map((x) => x + x).join('');
  }
  if (/^[0-9a-fA-F]{6}$/.test(c)) {
    return `#${c.toUpperCase()}`;
  }
  return undefined;
}

const TaskMetaEditor: React.FC<TaskMetaEditorProps> = ({
  task,
  onUpdate,
  onDelete,
}) => {
  // 本地受控状态（用于输入过程中的中间态，如清空再输入）
  const [name, setName] = useState(task.name);
  const [start, setStart] = useState(task.start);
  const [end, setEnd] = useState(task.end);
  const [color, setColor] = useState(task.color ?? '');
  const [isMain, setIsMain] = useState(!!task.isMain);
  const [completed, setCompleted] = useState(!!task.completed);
  const [notePath, setNotePath] = useState(task.notePath ?? '');
  // 记录上次任务 id，仅在任务切换时重置本地状态（避免远端更新打断本地输入）
  const lastTaskIdRef = useRef<string | null>(null);

  // 仅在切换到不同任务时重置本地状态（不因远端字段变化而重置，避免打断输入）
  useEffect(() => {
    if (lastTaskIdRef.current === task.id) return;
    lastTaskIdRef.current = task.id;
    setName(task.name);
    setStart(task.start);
    setEnd(task.end);
    setColor(task.color ?? '');
    setIsMain(!!task.isMain);
    setCompleted(!!task.completed);
    setNotePath(task.notePath ?? '');
    // 依赖列表列全 task 相关字段，但通过 ref 保证仅 task.id 变化时执行重置
  }, [task.id, task.name, task.start, task.end, task.color, task.isMain, task.completed, task.notePath]);

  // ── 即时保存：字段失焦或变化时写入 store ───────────────────
  // 名称：失焦时保存（避免输入过程频繁触发）
  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== task.name) {
      onUpdate({ name: trimmed });
    } else if (!trimmed) {
      // 还原为原值
      setName(task.name);
    }
  };

  // 日期：变化即时保存
  const commitStart = (v: string) => {
    setStart(v);
    if (v && (!end || v <= end)) {
      onUpdate({ start: v });
    }
  };

  const commitEnd = (v: string) => {
    setEnd(v);
    if (v && v >= start) {
      onUpdate({ end: v });
    }
  };

  // 颜色：选中预设色即时保存；自定义输入失焦时保存
  const selectPresetColor = (c: string) => {
    setColor(c);
    onUpdate({ color: c });
  };

  const commitColor = () => {
    const normalized = normalizeColor(color);
    if (normalized !== task.color) {
      onUpdate({ color: normalized });
    }
  };

  // checkbox：即时保存
  const toggleMain = (v: boolean) => {
    setIsMain(v);
    onUpdate({ isMain: v });
  };

  const toggleCompleted = (v: boolean) => {
    setCompleted(v);
    onUpdate({ completed: v });
  };

  // 备注：失焦保存
  const commitNotePath = () => {
    const trimmed = notePath.trim();
    if (trimmed !== (task.notePath ?? '')) {
      onUpdate({ notePath: trimmed || undefined });
    }
  };

  const dateInvalid = start && end && end < start;

  return (
    <div className="tl-meta-editor">
      {/* 任务名称 */}
      <label className="tl-meta-field">
        <span className="tl-meta-label">任务名称</span>
        <input
          className="tl-meta-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          placeholder="任务名称"
        />
      </label>

      {/* 起止日期 */}
      <div className="tl-meta-row">
        <label className="tl-meta-field">
          <span className="tl-meta-label">开始</span>
          <input
            className="tl-meta-input"
            type="date"
            value={start}
            onChange={(e) => commitStart(e.target.value)}
          />
        </label>
        <label className="tl-meta-field">
          <span className="tl-meta-label">结束</span>
          <input
            className="tl-meta-input"
            type="date"
            value={end}
            onChange={(e) => commitEnd(e.target.value)}
          />
        </label>
      </div>

      {dateInvalid && (
        <div className="tl-meta-error">结束日期需晚于或等于开始日期</div>
      )}

      {/* 颜色 */}
      <label className="tl-meta-field">
        <span className="tl-meta-label">方块颜色</span>
        <div className="tl-meta-color-row">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`tl-meta-color-btn ${color.toLowerCase() === c.toLowerCase() ? 'tl-meta-color-btn--active' : ''}`}
              style={{ background: c }}
              onClick={() => selectPresetColor(c)}
              title={c}
            />
          ))}
          <input
            className="tl-meta-input tl-meta-color-input"
            type="text"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            onBlur={commitColor}
            placeholder="#自定义"
          />
        </div>
      </label>

      {/* 主线 / 已完成 */}
      <div className="tl-meta-row">
        <label className="tl-meta-checkbox">
          <input
            type="checkbox"
            checked={isMain}
            onChange={(e) => toggleMain(e.target.checked)}
          />
          <span>主线任务</span>
        </label>
        <label className="tl-meta-checkbox">
          <input
            type="checkbox"
            checked={completed}
            onChange={(e) => toggleCompleted(e.target.checked)}
          />
          <span>已完成</span>
        </label>
      </div>

      {/* 关联备注 */}
      <label className="tl-meta-field">
        <span className="tl-meta-label">关联备注</span>
        <input
          className="tl-meta-input"
          type="text"
          value={notePath}
          onChange={(e) => setNotePath(e.target.value)}
          onBlur={commitNotePath}
          placeholder="URL 或备注内容"
        />
      </label>

      {/* 删除按钮 */}
      {onDelete && (
        <div className="tl-meta-footer">
          <button
            type="button"
            className="tl-meta-delete-btn"
            onClick={() => {
              if (confirm(`确定删除任务「${task.name}」？此操作不可撤销。`)) {
                onDelete(task.id);
              }
            }}
          >
            删除任务
          </button>
        </div>
      )}
    </div>
  );
};

export default TaskMetaEditor;
