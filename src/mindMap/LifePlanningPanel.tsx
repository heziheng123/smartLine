import { useMemo, useState, type FormEvent } from 'react';
import { addMonths, todayStr } from '@/utils/dateSafe';
import type { LifeMapData, LifeMapPlanGroupId } from '@/lifeMap/types';
import {
  addLifeSystemCheckIn,
  deleteLifePlanningItem,
  saveLifePlanningItem,
  updateLifePlanGroupPlacement,
  type LifePlanningDraft,
  type LifePlanningKind,
} from './lifePlanning';
import styles from './styles/MindMapWorkspace.module.css';

interface LifePlanningPanelProps {
  data: LifeMapData;
  onChange: (data: LifeMapData, label: string) => void;
  onClose: () => void;
}

const kindLabels: Record<LifePlanningKind, string> = {
  area: '人生领域', stage: '人生阶段', theme: '时期主题', goal: '人生目标', system: '长期系统',
  event: '关键日期', focus: '时期重点', note: '人生批注', review: '周期复盘',
};

const today = todayStr;
const nextMonth = () => addMonths(today(), 1);

const emptyDraft = (data: LifeMapData): LifePlanningDraft => ({
  name: '', areaId: data.lifeMapAreas.find((item) => !item.deletedAt)?.id,
  start: today(), end: nextMonth(), color: '#6366f1', status: 'active', frequency: 'weekly',
  targetCount: 3, planGroupId: 'life', period: 'month', body: '',
});

function draftFor(data: LifeMapData, kind: LifePlanningKind, id: string): LifePlanningDraft {
  const fallback = emptyDraft(data);
  switch (kind) {
    case 'area': {
      const item = data.lifeMapAreas.find((value) => value.id === id);
      return item ? { ...fallback, name: item.name, color: item.color, planGroupId: item.planGroupId } : fallback;
    }
    case 'stage': {
      const item = data.lifeMapStages.find((value) => value.id === id);
      return item ? { ...fallback, name: item.name, areaId: item.areaIds?.[0], start: item.start, end: item.end, color: item.color, body: item.description } : fallback;
    }
    case 'theme': {
      const item = data.lifeMapThemes.find((value) => value.id === id);
      return item ? { ...fallback, name: item.name, areaId: item.areaId, start: item.start, end: item.end, color: item.color } : fallback;
    }
    case 'goal': {
      const item = data.lifeMapGoals.find((value) => value.id === id);
      return item ? { ...fallback, name: item.name, areaId: item.areaId, start: item.start, end: item.targetDate, color: item.color, status: item.status, body: item.summary } : fallback;
    }
    case 'system': {
      const item = data.lifeMapSystems.find((value) => value.id === id);
      return item ? { ...fallback, name: item.name, areaId: item.areaId, start: item.start, end: item.end ?? item.start, color: item.color, status: item.status, frequency: item.frequency, targetCount: item.targetCount } : fallback;
    }
    case 'event': {
      const item = data.lifeMapEvents.find((value) => value.id === id);
      return item ? { ...fallback, name: item.name, areaId: item.areaId, start: item.date, end: item.date, color: item.color } : fallback;
    }
    case 'focus': {
      const item = data.lifeMapFocuses.find((value) => value.id === id);
      return item ? { ...fallback, name: item.name, areaId: item.areaId, start: item.start, end: item.end, color: item.color } : fallback;
    }
    case 'note': {
      const item = data.lifeMapNotes.find((value) => value.id === id);
      return item ? { ...fallback, name: item.name, areaId: item.areaId, start: item.date, end: item.endDate ?? item.date, color: item.color, body: item.body } : fallback;
    }
    case 'review': {
      const item = data.lifeMapReviews.find((value) => value.id === id);
      return item ? { ...fallback, name: item.title, areaId: item.areaIds?.[0], start: item.start, end: item.end, period: item.period, body: item.reflection } : fallback;
    }
  }
}

const active = <T extends { deletedAt?: string }>(items: T[]) => items.filter((item) => !item.deletedAt);

const entriesFor = (data: LifeMapData, kind: LifePlanningKind): Array<{ id: string; name: string; detail?: string }> => {
  switch (kind) {
    case 'area': return active(data.lifeMapAreas).map((item) => ({ id: item.id, name: item.name, detail: item.planGroupId }));
    case 'stage': return active(data.lifeMapStages).map((item) => ({ id: item.id, name: item.name, detail: `${item.start} — ${item.end}` }));
    case 'theme': return active(data.lifeMapThemes).map((item) => ({ id: item.id, name: item.name, detail: `${item.start} — ${item.end}` }));
    case 'goal': return active(data.lifeMapGoals).map((item) => ({ id: item.id, name: item.name, detail: `${item.start} — ${item.targetDate}` }));
    case 'system': return active(data.lifeMapSystems).map((item) => ({ id: item.id, name: item.name, detail: `${item.frequency} · ${item.targetCount}` }));
    case 'event': return active(data.lifeMapEvents).map((item) => ({ id: item.id, name: item.name, detail: item.date }));
    case 'focus': return active(data.lifeMapFocuses).map((item) => ({ id: item.id, name: item.name, detail: `${item.start} — ${item.end}` }));
    case 'note': return active(data.lifeMapNotes).map((item) => ({ id: item.id, name: item.name, detail: item.date }));
    case 'review': return active(data.lifeMapReviews).map((item) => ({ id: item.id, name: item.title, detail: `${item.start} — ${item.end}` }));
  }
};

const LifePlanningPanel = ({ data, onChange, onClose }: LifePlanningPanelProps) => {
  const [kind, setKind] = useState<LifePlanningKind>('stage');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LifePlanningDraft>(() => emptyDraft(data));
  const [error, setError] = useState<string | null>(null);
  const entries = useMemo(() => entriesFor(data, kind), [data, kind]);
  const areas = active(data.lifeMapAreas);

  const beginCreate = () => {
    setEditingId('');
    setDraft(emptyDraft(data));
    setError(null);
  };
  const beginEdit = (id: string) => {
    setEditingId(id);
    setDraft(draftFor(data, kind, id));
    setError(null);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    try {
      onChange(saveLifePlanningItem(data, kind, draft, { id: editingId || undefined }), `${editingId ? '编辑' : '新建'}${kindLabels[kind]}`);
      setEditingId(null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败。');
    }
  };

  return <div className={styles.lifePanelBackdrop} role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <aside className={styles.lifePanel} role="dialog" aria-modal="true" aria-label="人生规划管理">
      <header><div><small>地图正式数据</small><h2>人生规划</h2></div><button type="button" aria-label="关闭人生规划" onClick={onClose}>×</button></header>
      <div className={styles.lifePanelControls}>
        <label><span>对象类型</span><select aria-label="对象类型" value={kind} onChange={(event) => {
          setKind(event.target.value as LifePlanningKind);
          setEditingId(null);
        }}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button type="button" onClick={beginCreate}>新建{kindLabels[kind]}</button>
      </div>
      {kind === 'area' && <div className={styles.lifePlanGroups} aria-label="人生分组布局">
        {data.lifeMapPlanGroups.map((group) => <label key={group.id}>{group.id}<select value={group.placement} onChange={(event) => onChange(updateLifePlanGroupPlacement(data, group.id, event.target.value as 'above' | 'below'), '调整人生分组')}><option value="above">上方</option><option value="below">下方</option></select></label>)}
      </div>}
      <div className={styles.lifePanelList} role="list" aria-label={`${kindLabels[kind]}列表`}>
        {entries.length === 0 && <p>暂无{kindLabels[kind]}。</p>}
        {entries.map((entry) => <article key={entry.id} role="listitem"><div><strong>{entry.name}</strong>{entry.detail && <small>{entry.detail}</small>}</div><div>
          {kind === 'system' && <button type="button" onClick={() => onChange(addLifeSystemCheckIn(data, entry.id, today()), '记录长期系统')}>今日 +1</button>}
          <button type="button" onClick={() => beginEdit(entry.id)}>编辑</button>
          <button type="button" onClick={() => {
            if (!window.confirm(`确定删除“${entry.name}”吗？可通过地图撤销恢复。`)) return;
            try { onChange(deleteLifePlanningItem(data, kind, entry.id), `删除${kindLabels[kind]}`); }
            catch (caught) { setError(caught instanceof Error ? caught.message : '删除失败。'); }
          }}>删除</button>
        </div></article>)}
      </div>
      {editingId !== null && <form className={styles.lifePanelForm} onSubmit={save}>
        <h3>{editingId ? '编辑' : '新建'}{kindLabels[kind]}</h3>
        <label>名称<input required autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        {kind === 'area' ? <label>所属分组<select value={draft.planGroupId} onChange={(event) => setDraft({ ...draft, planGroupId: event.target.value as LifeMapPlanGroupId })}><option value="learning">学习</option><option value="work">工作</option><option value="life">生活</option></select></label> : <>
          <label>人生领域<select aria-label="人生领域" value={draft.areaId ?? ''} onChange={(event) => setDraft({ ...draft, areaId: event.target.value || undefined })}><option value="">全部人生</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
          <div className={styles.lifePanelDates}><label>开始日期<input type="date" required value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label><label>结束日期<input type="date" required value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label></div>
        </>}
        {['stage', 'goal', 'note', 'review'].includes(kind) && <label>说明<textarea value={draft.body ?? ''} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>}
        {['goal', 'system'].includes(kind) && <label>状态<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as LifePlanningDraft['status'] })}><option value="active">进行中</option><option value="completed">已完成</option><option value="paused">暂停</option><option value="archived">归档</option></select></label>}
        {kind === 'system' && <div className={styles.lifePanelDates}><label>频率<select value={draft.frequency} onChange={(event) => setDraft({ ...draft, frequency: event.target.value as LifePlanningDraft['frequency'] })}><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label><label>目标次数<input type="number" min="1" value={draft.targetCount} onChange={(event) => setDraft({ ...draft, targetCount: Number(event.target.value) })} /></label></div>}
        {kind === 'review' && <label>周期<select value={draft.period} onChange={(event) => setDraft({ ...draft, period: event.target.value as LifePlanningDraft['period'] })}><option value="month">月</option><option value="quarter">季度</option></select></label>}
        <label>颜色<input type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></label>
        {error && <p role="alert">{error}</p>}
        <footer><button type="button" onClick={() => setEditingId(null)}>取消</button><button type="submit">保存</button></footer>
      </form>}
    </aside>
  </div>;
};

export default LifePlanningPanel;
