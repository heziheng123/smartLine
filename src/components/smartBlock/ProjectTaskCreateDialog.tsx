import React, { useEffect, useMemo, useState } from 'react';
import { CheckSquare2, Hash, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '@/store';
import type { SmartTaskBlock } from '@/types';
import { genBlockId, getQuantityDailySuggestion, getTagColor } from '@/utils/blocks';
import { todayStr } from '@/utils/dateSafe';
import { PROJECT_TASK_CREATE_EVENT, type ProjectTaskCreateDetail } from './projectTaskCreate';
import { createProjectTask } from '@/services/projectTaskCommands';

type ProgressMode = 'binary' | 'quantity';

const UNIT_OPTIONS = ['个', '题', '页', '节', '章'] as const;

const ProjectTaskCreateDialog: React.FC = () => {
  const { tasks, groups } = useTimelineStore(useShallow((state) => ({
    tasks: state.tasks,
    groups: state.groups,
  })));
  const projects = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    groups.forEach((group) => group.children.forEach((task) => { if (!byId.has(task.id)) byId.set(task.id, task); }));
    return [...byId.values()];
  }, [groups, tasks]);

  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [mode, setMode] = useState<ProgressMode>('binary');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayStr());
  const [duration, setDuration] = useState('30');
  const [unit, setUnit] = useState('题');
  const [total, setTotal] = useState('');
  const [initialCompleted, setInitialCompleted] = useState('0');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<ProjectTaskCreateDetail>).detail ?? {};
      setProjectId(detail.taskId && projects.some((task) => task.id === detail.taskId) ? detail.taskId : (projects[0]?.id ?? ''));
      setDate(detail.date || todayStr());
      setMode('binary');
      setTitle('');
      setDuration('30');
      setUnit('题');
      setTotal('');
      setInitialCompleted('0');
      setDeadline('');
      setError(null);
      setOpen(true);
    };
    window.addEventListener(PROJECT_TASK_CREATE_EVENT, handleOpen);
    return () => window.removeEventListener(PROJECT_TASK_CREATE_EVENT, handleOpen);
  }, [projects]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const suggestion = useMemo(() => {
    const parsedTotal = Number(total);
    const parsedInitial = Number(initialCompleted);
    if (mode !== 'quantity' || !date || !deadline || !Number.isInteger(parsedTotal) || parsedTotal <= 0
      || !Number.isInteger(parsedInitial) || parsedInitial < 0 || parsedInitial > parsedTotal) return null;
    return getQuantityDailySuggestion({
      taskKind: 'quantity', date, deadline,
      quantityTotal: parsedTotal,
      quantityInitialCompleted: parsedInitial,
      quantityRecords: {},
    }, date);
  }, [date, deadline, initialCompleted, mode, total]);

  if (!open) return null;

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId || !projects.some((task) => task.id === projectId)) return setError('请选择所属项目。');
    if (!title.trim()) return setError('请输入任务名称。');
    if (mode === 'quantity' && !date) return setError('请选择开始日期。');

    let block: SmartTaskBlock;
    if (mode === 'quantity') {
      const parsedTotal = Number(total);
      const parsedInitial = Number(initialCompleted);
      if (!unit.trim()) return setError('请输入计量单位。');
      if (!Number.isInteger(parsedTotal) || parsedTotal <= 0) return setError('目标总量必须是大于 0 的整数。');
      if (!Number.isInteger(parsedInitial) || parsedInitial < 0 || parsedInitial > parsedTotal) return setError('当前进度必须是 0 到目标总量之间的整数。');
      if (deadline && deadline < date) return setError('截止日期不能早于计划日期。');
      const completed = parsedInitial >= parsedTotal;
      block = {
        type: 'smart-task', id: genBlockId(), body: '',
        header: {
          taskKind: 'quantity', title: title.trim(), tag: '数量', tagColor: '#14B8A6',
          date, deadline: deadline || undefined, duration: 0,
          isCompleted: completed, completedDate: completed ? todayStr() : undefined,
          autoSyncEbb: false, quantityUnit: unit.trim().slice(0, 6),
          quantityTotal: parsedTotal, quantityInitialCompleted: parsedInitial, quantityRecords: {},
        },
      };
    } else {
      const parsedDuration = Number(duration);
      if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) return setError('预计时长必须是大于 0 的分钟数。');
      block = {
        type: 'smart-task', id: genBlockId(), body: '',
        header: {
          taskKind: 'standard', title: title.trim(), tag: '默认', tagColor: getTagColor('默认'),
          date: date || undefined, duration: parsedDuration, isCompleted: false, autoSyncEbb: true,
        },
      };
    }
    const result = createProjectTask(projectId, block);
    if ('error' in result) return setError(result.error);
    setOpen(false);
  };

  return (
    <div className="ds-vocab-overlay" role="presentation" onMouseDown={() => setOpen(false)}>
      <section className="ds-vocab-dialog task-create-dialog" role="dialog" aria-modal="true" aria-labelledby="project-task-create-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="ds-vocab-dialog-header">
          <div><h2 id="project-task-create-title">新建项目任务</h2><p>普通任务和数量进度使用同一张任务卡。</p></div>
          <button type="button" className="ds-vocab-icon-btn" onClick={() => setOpen(false)} aria-label="关闭新建项目任务"><X size={18} /></button>
        </div>
        <form className="ds-vocab-form" onSubmit={create}>
          <label>所属项目<select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}</select></label>
          <label>任务名称<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={mode === 'quantity' ? '例如：考研数学题库' : '例如：整理本章笔记'} /></label>
          <label>{mode === 'quantity' ? '开始日期（必填）' : '计划日期（可选）'}<input type="date" required={mode === 'quantity'} value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <fieldset className="task-create-mode">
            <legend>完成方式</legend>
            <div>
              <button type="button" className={mode === 'binary' ? 'is-active' : ''} onClick={() => setMode('binary')}><CheckSquare2 size={14} />完成 / 未完成</button>
              <button type="button" className={mode === 'quantity' ? 'is-active' : ''} onClick={() => setMode('quantity')}><Hash size={14} />按数量推进</button>
            </div>
          </fieldset>
          {mode === 'binary' ? (
            <label>预计时长（分钟）<input type="number" step="any" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
          ) : (
            <>
              <div className="ds-vocab-form-grid">
                <label>目标总量<input type="number" min="1" step="1" value={total} onChange={(event) => setTotal(event.target.value)} placeholder="例如 1000" /></label>
                <label>单位<input value={unit} maxLength={6} onChange={(event) => setUnit(event.target.value)} /></label>
              </div>
              <div className="task-create-units" role="group" aria-label="快捷单位">
                {UNIT_OPTIONS.map((value) => <button key={value} type="button" className={unit === value ? 'is-active' : ''} onClick={() => setUnit(value)}>{value}</button>)}
                <span>也可以直接输入自定义单位</span>
              </div>
              <details className="task-create-more">
                <summary>更多设置：当前进度与截止日期</summary>
                <div className="ds-vocab-form-grid">
                  <label>当前已完成<input type="number" min="0" step="1" value={initialCompleted} onChange={(event) => setInitialCompleted(event.target.value)} /></label>
                  <label>截止日期（可选）<input type="date" min={date} value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
                </div>
              </details>
              {suggestion && <div className="ds-quantity-suggestion" aria-label="每日建议预览"><span>从开始日到截止日还有 {suggestion.daysRemaining} 天</span><strong>建议首日完成 {suggestion.suggested} {unit}</strong></div>}
            </>
          )}
          {error && <div className="ds-vocab-error" role="alert">{error}</div>}
          <div className="ds-vocab-form-actions"><button type="button" className="ds-vocab-secondary-btn" onClick={() => setOpen(false)}>取消</button><button type="submit" className="ds-vocab-primary-btn">创建任务</button></div>
        </form>
      </section>
    </div>
  );
};

export default ProjectTaskCreateDialog;
