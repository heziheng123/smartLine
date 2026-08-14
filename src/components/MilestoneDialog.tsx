// ============================================================
// Smart Timeline - 里程碑新增 / 编辑对话框（已标准化）
// P0 防护：脏态检测 → 关闭/取消前询问
// ============================================================

import { useMemo, useRef, useState } from 'react';
import type { Milestone } from '@/types';
import { Dialog, DialogField, ColorPicker } from '@/design/dialogs';
import { normalizeHex } from '@/design/color';

interface MilestoneDialogProps {
  milestone?: Milestone;
  onSave: (milestone: Milestone) => void;
  onDelete?: (milestoneId: string) => void | Promise<void>;
  onCancel: () => void;
}

const IMPORTANCE_OPTIONS: Array<[NonNullable<Milestone['importance']>, string]> = [
  ['normal', '普通提醒'],
  ['important', '重要节点'],
  ['core', '核心事件'],
];

function snapshotOf(milestone: Milestone | undefined): string {
  if (!milestone) return '__new__';
  return JSON.stringify({
    name: milestone.name ?? '',
    date: milestone.date ?? '',
    color: milestone.color ?? '',
    importance: milestone.importance ?? 'important',
  });
}

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
  const [importance, setImportance] = useState<NonNullable<Milestone['importance']>>(
    milestone?.importance ?? 'important',
  );

  const initialSnapshotRef = useRef<string>(snapshotOf(milestone));

  const isDirty = useMemo(() => {
    const current = JSON.stringify({ name, date, color, importance });
    return current !== initialSnapshotRef.current;
  }, [name, date, color, importance]);

  const errors = useMemo(() => {
    const out: string[] = [];
    if (!name.trim()) out.push('请填写里程碑名称');
    if (!date) out.push('请选择日期');
    if (color && color.trim() && !normalizeHex(color)) {
      out.push('颜色格式无效（例：#5E5CE6）');
    }
    return out;
  }, [name, date, color]);

  const canSubmit = errors.length === 0;

  const handleSave = () => {
    if (!canSubmit) return;
    const trimmed = name.trim();
    onSave({
      id: milestone?.id ?? crypto.randomUUID(),
      name: trimmed,
      date,
      color: normalizeHex(color),
      placement: milestone?.placement,
      importance,
    });
  };

  return (
    <Dialog
      title={isEdit ? '编辑里程碑' : '新建里程碑'}
      onCancel={onCancel}
      onSubmit={handleSave}
      canSubmit={canSubmit}
      submitLabel={isEdit ? '保存' : '创建'}
      sideAction={
        isEdit && onDelete
          ? {
              label: '删除',
              onClick: () => onDelete(milestone!.id),
              danger: true,
            }
          : undefined
      }
      errors={errors}
      isDirty={isDirty}
      discardConfirmMessage={`里程碑"${name.trim() || milestone?.name || '未命名'}"有未保存的修改，确定放弃？`}
    >
      <DialogField label="里程碑名称" fieldId="milestone-name">
        <input
          className="tl-dialog-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：V1.0 上线"
          autoFocus
          maxLength={120}
        />
      </DialogField>

      <DialogField label="日期" fieldId="milestone-date">
        <input
          className="tl-dialog-input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </DialogField>

      <DialogField label="关键程度" fieldId="milestone-importance">
        <div className="tl-dialog-segmented" role="radiogroup" aria-label="关键日期重要程度">
          {IMPORTANCE_OPTIONS.map(([value, label]) => (
            <button
              type="button"
              key={value}
              role="radio"
              aria-checked={importance === value}
              className={importance === value ? 'is-active' : ''}
              onClick={() => setImportance(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </DialogField>

      <DialogField label="标记颜色" fieldId="milestone-color">
        <ColorPicker
          value={color || undefined}
          onChange={(c) => setColor(c ?? '')}
        />
      </DialogField>
    </Dialog>
  );
};

export default MilestoneDialog;