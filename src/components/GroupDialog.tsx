// ============================================================
// Smart Timeline - 分组新增 / 编辑对话框（已标准化）
// P0 防护：脏态检测 → 关闭/取消前询问
// ============================================================

import { useMemo, useRef, useState } from 'react';
import { WandSparkles } from 'lucide-react';
import type { Task, TaskGroup } from '@/types';
import {
  TIMELINE_THEMES,
  GROUP_COLOR_PRESET,
  suggestGroupColor,
} from '@/utils/timeline-utils';
import { isValidCalendarDate } from '@/utils/dateSafe';
import { Dialog, DialogField } from '@/design/dialogs';
import { normalizeHex } from '@/design/color';

interface GroupDialogProps {
  group?: TaskGroup;
  /** 所有可用任务列表（供选择子任务） */
  allTasks: Task[];
  /** 所有分组列表（用于显示任务当前所属分组） */
  groups: TaskGroup[];
  onSave: (group: TaskGroup) => void;
  onDelete?: (groupId: string) => void | Promise<void>;
  onCancel: () => void;
}

function snapshotOf(group: TaskGroup | undefined, selectedTaskIds: Set<string>): string {
  if (!group) return `__new__|${[...selectedTaskIds].sort().join(',')}`;
  return JSON.stringify({
    name: group.name ?? '',
    start: group.start ?? '',
    end: group.end ?? '',
    color: group.color ?? '',
    autoDate: group.autoDate ?? true,
    childIds: (group.children ?? []).map((c) => c.id).sort().join(','),
  });
}

const GroupDialog: React.FC<GroupDialogProps> = ({
  group,
  allTasks,
  groups,
  onSave,
  onDelete,
  onCancel,
}) => {
  const isEdit = !!group;

  const [name, setName] = useState(group?.name ?? '');
  const [start, setStart] = useState(group?.start ?? '');
  const [end, setEnd] = useState(group?.end ?? '');
  const [color, setColor] = useState(
    group?.color ?? suggestGroupColor(groups.map((item) => item.color), group?.id ?? name),
  );
  const [autoDate, setAutoDate] = useState(group?.autoDate ?? true);

  // 已选中的子任务 ID 集合
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => {
    const ids = group?.children.map((c) => c.id) ?? [];
    return new Set(ids);
  });

  const toggleTask = (taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  // 初始快照
  const initialSnapshotRef = useRef<string>(snapshotOf(group, selectedTaskIds));

  const isDirty = useMemo(() => {
    const current = JSON.stringify({
      name,
      start,
      end,
      color,
      autoDate,
      childIds: [...selectedTaskIds].sort().join(','),
    });
    return current !== initialSnapshotRef.current;
  }, [name, start, end, color, autoDate, selectedTaskIds]);

  const manualDateError = useMemo(() => {
    if (autoDate) return null;
    if (!start || !end) return '手动日期模式必须填写开始日期和结束日期';
    if (!isValidCalendarDate(start) || !isValidCalendarDate(end))
      return '请输入有效的日历日期';
    if (end < start) return '结束日期不能早于开始日期';
    return null;
  }, [autoDate, start, end]);

  const errors = useMemo(() => {
    const out: string[] = [];
    if (!name.trim()) out.push('请填写分组名称');
    if (manualDateError) out.push(manualDateError);
    if (color && color.trim() && !normalizeHex(color) && !GROUP_COLOR_PRESET.map((c) => c.toLowerCase()).includes(color.trim().toLowerCase())) {
      out.push('颜色格式无效（例：#5E5CE6）');
    }
    return out;
  }, [name, manualDateError, color]);

  const canSubmit = errors.length === 0;

  const handleSave = () => {
    if (!canSubmit) return;
    const trimmed = name.trim();
    const children = allTasks.filter((t) => selectedTaskIds.has(t.id));
    onSave({
      id: group?.id ?? crypto.randomUUID(),
      name: trimmed,
      start: start || '',
      end: end || '',
      color: normalizeHex(color) ?? color,
      autoDate,
      children,
    });
  };

  return (
    <Dialog
      title={isEdit ? '编辑分组' : '新建分组'}
      onCancel={onCancel}
      onSubmit={handleSave}
      canSubmit={canSubmit}
      submitLabel={isEdit ? '保存' : '创建'}
      sideAction={
        isEdit && onDelete
          ? {
              label: '删除',
              onClick: () => onDelete(group!.id),
              danger: true,
            }
          : undefined
      }
      errors={errors}
      isDirty={isDirty}
      discardConfirmMessage={`分组"${name.trim() || group?.name || '未命名'}"有未保存的修改，确定放弃？`}
    >
      <DialogField label="分组名称" fieldId="group-name">
        <input
          className="tl-dialog-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：产品研发"
          autoFocus
          maxLength={120}
        />
      </DialogField>

      <div className="tl-dialog-row">
        <DialogField label="开始日期" fieldId="group-start">
          <input
            className="tl-dialog-input"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            disabled={autoDate}
          />
        </DialogField>
        <DialogField label="结束日期" fieldId="group-end">
          <input
            className="tl-dialog-input"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            disabled={autoDate}
          />
        </DialogField>
      </div>

      <label className="tl-dialog-checkbox">
        <input
          type="checkbox"
          checked={autoDate}
          onChange={(e) => setAutoDate(e.target.checked)}
        />
        <span>自动从子任务计算日期范围</span>
      </label>

      <DialogField label="分组颜色" fieldId="group-color" hint="点击色板可选，或用「自动」推荐使用最少的颜色">
        <div className="tl-dialog-color-row">
          <div className="tl-dialog-color-grid" role="listbox" aria-label="分组颜色预设">
            {GROUP_COLOR_PRESET.map((c) => {
              const selected = (color ?? '').toLowerCase() === c.toLowerCase();
              return (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`tl-dialog-color-btn ${selected ? 'tl-dialog-color-btn--active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                  aria-label={`选择分组颜色 ${c}`}
                />
              );
            })}
          </div>
          <button
            className="tl-dialog-auto-color"
            type="button"
            onClick={() =>
              setColor(
                suggestGroupColor(
                  groups.filter((item) => item.id !== group?.id).map((item) => item.color),
                  name,
                ),
              )
            }
            title="选择当前使用次数最少的颜色"
          >
            <WandSparkles size={14} />
            自动
          </button>
          <input
            className="tl-dialog-input tl-dialog-color-input"
            type="text"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="#自定义"
            maxLength={9}
          />
        </div>
      </DialogField>

      {/* 子任务选择 —— 业务特定，保留原 .tl-dialog-task-list 结构 */}
      <div className="tl-dialog-field">
        <span className="tl-dialog-label">选择任务（{selectedTaskIds.size} 个已选）</span>
        <div className="tl-dialog-task-list" role="group" aria-label="子任务列表">
          {allTasks.length === 0 ? (
            <div className="tl-dialog-task-empty">暂无任务，请先创建任务</div>
          ) : (
            allTasks.map((task) => {
              const currentGroup =
                task.groupId && task.groupId !== group?.id
                  ? groups.find((g) => g.id === task.groupId)
                  : null;
              return (
                <label key={task.id} className="tl-dialog-task-item">
                  <input
                    type="checkbox"
                    checked={selectedTaskIds.has(task.id)}
                    onChange={() => toggleTask(task.id)}
                  />
                  <span
                    className="tl-dialog-task-dot"
                    style={{ backgroundColor: task.color || TIMELINE_THEMES[0].taskBg }}
                  />
                  <span className="tl-dialog-task-name">{task.name}</span>
                  {currentGroup && (
                    <span
                      className="tl-dialog-task-group-badge"
                      style={{
                        backgroundColor: currentGroup.color ? `${currentGroup.color}20` : '#F3F4F6',
                        color: currentGroup.color || '#6B7280',
                      }}
                    >
                      {currentGroup.name}
                    </span>
                  )}
                  <span className="tl-dialog-task-date">{task.start} ~ {task.end}</span>
                </label>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
};

export default GroupDialog;