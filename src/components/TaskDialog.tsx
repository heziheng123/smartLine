// ============================================================
// Smart Timeline - 任务新增 / 编辑对话框（已标准化）
// ============================================================

import React, { useMemo, useState } from 'react';
import type { Task } from '@/types';
import { Dialog, DialogField, ColorPicker } from '@/design/dialogs';
import { normalizeHex } from '@/design/color';

interface TaskDialogProps {
  task?: Task;
  onSave: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onCancel: () => void;
}

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

  // 派生校验与错误（替代散落的 "如果不对就 disabled"）
  const errors = useMemo(() => {
    const out: string[] = [];
    const trimmed = name.trim();
    if (!trimmed) out.push('请填写任务名称');
    if (!start) out.push('请选择开始日期');
    if (start && !end) out.push('请选择结束日期');
    if (start && end && end < start) out.push('结束日期不能早于开始日期');
    if (color && color.trim() && !normalizeHex(color)) {
      out.push('颜色格式无效（例：#5E5CE6）');
    }
    return out;
  }, [name, start, end, color]);

  const canSubmit = errors.length === 0;

  const handleSave = () => {
    if (!canSubmit) return;
    const trimmed = name.trim();
    onSave({
      ...(task ?? {}),
      id: task?.id ?? crypto.randomUUID(),
      name: trimmed,
      start,
      end,
      color: normalizeHex(color),
      isMain,
      completed,
      notePath: notePath.trim() || undefined,
      groupId: task?.groupId,
      blocks: task?.blocks ?? [],
    });
  };

  return (
    <Dialog
      title={isEdit ? '编辑任务' : '新建任务'}
      onCancel={onCancel}
      onSubmit={handleSave}
      canSubmit={canSubmit}
      submitLabel={isEdit ? '保存' : '创建'}
      sideAction={
        isEdit && onDelete
          ? { label: '删除', onClick: () => onDelete(task!.id), danger: true }
          : undefined
      }
      errors={errors}
    >
      <DialogField label="任务名称" fieldId="task-name">
        <input
          className="tl-dialog-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：政治第一轮"
          autoFocus
        />
      </DialogField>

      <div className="tl-dialog-row">
        <DialogField label="开始日期" fieldId="task-start">
          <input
            className="tl-dialog-input"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </DialogField>
        <DialogField label="结束日期" fieldId="task-end">
          <input
            className="tl-dialog-input"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </DialogField>
      </div>

      <DialogField label="方块颜色" fieldId="task-color" hint="12 个预设 + 自定义 hex；无效值会在底部聚合提示">
        <ColorPicker
          value={color || undefined}
          onChange={(c) => setColor(c ?? '')}
          variant="task"
        />
      </DialogField>

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

      <DialogField label="关联备注" fieldId="task-note">
        <input
          className="tl-dialog-input"
          type="text"
          value={notePath}
          onChange={(e) => setNotePath(e.target.value)}
          placeholder="URL 或备注内容"
        />
      </DialogField>
    </Dialog>
  );
};

export default TaskDialog;
