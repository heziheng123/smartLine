// ============================================================
// Smart Timeline - 便签新增 / 编辑对话框（已标准化）
// P0 防护：脏态检测 → 关闭/取消前询问
// ============================================================

import { useMemo, useRef, useState } from 'react';
import type { Note } from '@/types';
import { Dialog, DialogField, ColorPicker } from '@/design/dialogs';
import { normalizeHex } from '@/design/color';

interface NoteDialogProps {
  note?: Note;
  onSave: (note: Note) => void;
  onDelete?: (noteId: string) => void | Promise<void>;
  onCancel: () => void;
}

function snapshotOf(note: Note | undefined): string {
  if (!note) return '__new__';
  return JSON.stringify({
    name: note.name ?? '',
    date: note.date ?? '',
    endDate: note.endDate ?? '',
    type: note.type ?? 'pin',
    color: note.color ?? '',
    notePath: note.notePath ?? '',
  });
}

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

  const initialSnapshotRef = useRef<string>(snapshotOf(note));

  const isDirty = useMemo(() => {
    const current = JSON.stringify({ name, date, endDate, type, color, notePath });
    return current !== initialSnapshotRef.current;
  }, [name, date, endDate, type, color, notePath]);

  const errors = useMemo(() => {
    const out: string[] = [];
    if (!name.trim()) out.push('请填写便签内容');
    if (!date) out.push('请选择标记日期');
    if (type === 'range' && endDate && date && endDate < date) {
      out.push('结束日期不能早于开始日期');
    }
    if (color && color.trim() && !normalizeHex(color)) {
      out.push('颜色格式无效（例：#5E5CE6）');
    }
    return out;
  }, [name, date, type, endDate, color]);

  const canSubmit = errors.length === 0;

  const handleSave = () => {
    if (!canSubmit) return;
    const trimmed = name.trim();
    onSave({
      id: note?.id ?? crypto.randomUUID(),
      name: trimmed,
      date,
      endDate: type === 'range' && endDate ? endDate : undefined,
      type,
      color: normalizeHex(color),
      notePath: notePath.trim() || undefined,
      placement: note?.placement,
    });
  };

  return (
    <Dialog
      title={isEdit ? '编辑便签' : '新建便签'}
      onCancel={onCancel}
      onSubmit={handleSave}
      canSubmit={canSubmit}
      submitLabel={isEdit ? '保存' : '创建'}
      sideAction={
        isEdit && onDelete
          ? {
              label: '删除',
              onClick: () => onDelete(note!.id),
              danger: true,
            }
          : undefined
      }
      errors={errors}
      isDirty={isDirty}
      discardConfirmMessage={`便签"${name.trim() || note?.name || '未命名'}"有未保存的修改，确定放弃？`}
    >
      <DialogField label="便签内容" fieldId="note-name">
        <input
          className="tl-dialog-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：四六级报名"
          autoFocus
          maxLength={200}
        />
      </DialogField>

      <div className="tl-dialog-row">
        <DialogField label="类型" fieldId="note-type">
          <select
            className="tl-dialog-input"
            value={type}
            onChange={(e) => setType(e.target.value as 'pin' | 'range')}
          >
            <option value="pin">单日图钉</option>
            <option value="range">日期范围</option>
          </select>
        </DialogField>
        <DialogField label="标记日期" fieldId="note-date">
          <input
            className="tl-dialog-input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </DialogField>
      </div>

      {type === 'range' && (
        <DialogField label="结束日期" fieldId="note-end-date">
          <input
            className="tl-dialog-input"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </DialogField>
      )}

      <DialogField label="标记颜色" fieldId="note-color">
        <ColorPicker
          value={color || undefined}
          onChange={(c) => setColor(c ?? '')}
        />
      </DialogField>

      <DialogField label="关联备注" fieldId="note-path">
        <input
          className="tl-dialog-input"
          type="text"
          value={notePath}
          onChange={(e) => setNotePath(e.target.value)}
          placeholder="URL 或备注内容"
          maxLength={500}
        />
      </DialogField>
    </Dialog>
  );
};

export default NoteDialog;