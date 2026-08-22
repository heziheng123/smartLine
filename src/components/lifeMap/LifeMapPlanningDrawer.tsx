import React, { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Layers3, NotebookPen, Plus, Repeat2, Settings2, Trash2, X } from 'lucide-react';
import type { LifeMapPlanGroupId, LifeMapPlanGroupPreference } from '@/lifeMap/types';
import { LIFE_MAP_PLAN_GROUP_META } from '@/lifeMap/data';

export interface LifeMapPlanningItem {
  id: string;
  name: string;
  meta?: string;
}

export interface LifeMapStructureAreaItem {
  id: string;
  name: string;
  color: string;
  planGroupId: LifeMapPlanGroupId;
  order: number;
  isHidden?: boolean;
  itemCount: number;
}

interface LifeMapPlanningDrawerProps {
  open: boolean;
  view?: 'overview' | 'areas';
  plans: LifeMapPlanningItem[];
  systems: LifeMapPlanningItem[];
  reviews: LifeMapPlanningItem[];
  periods: LifeMapPlanningItem[];
  unassignedCount: number;
  areas: LifeMapStructureAreaItem[];
  planGroups: LifeMapPlanGroupPreference[];
  onClose: () => void;
  onEdit: (kind: 'plan' | 'system' | 'review' | 'period', item: LifeMapPlanningItem) => void;
  onCreateSystem: () => void;
  onCreateReview: (period: 'month' | 'quarter') => void;
  onCreatePeriod: () => void;
  onCreateArea: (groupId: LifeMapPlanGroupId) => void;
  onEditArea: (id: string) => void;
  onMoveArea: (id: string, direction: 'up' | 'down') => void;
  onToggleArea: (id: string) => void;
  onDeleteArea: (id: string) => void;
  onShiftPlans?: () => void;
  onUpdateGroupPlacement: (id: LifeMapPlanGroupId, placement: 'above' | 'below') => void;
}

const ItemList: React.FC<{ items: LifeMapPlanningItem[]; empty: string; onOpen: (item: LifeMapPlanningItem) => void }> = ({ items, empty, onOpen }) => (
  <div className="life-map-planning-drawer__list">
    {items.map((item) => <button type="button" key={item.id} onClick={() => onOpen(item)}><span><b>{item.name}</b><small>{item.meta}</small></span></button>)}
    {items.length === 0 && <p>{empty}</p>}
  </div>
);

const LifeMapPlanningDrawer: React.FC<LifeMapPlanningDrawerProps> = (props) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  useEffect(() => {
    if (!props.open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const previous = previousFocusRef.current;
      if (previous?.isConnected) window.requestAnimationFrame(() => previous.focus());
    };
  }, [props.open]);
  if (!props.open) return null;

  const areaManagement = props.view === 'areas';
  const title = areaManagement ? '领域与分类' : '规划概览';
  const groups = props.planGroups.slice().sort((left, right) => left.order - right.order);
  return <div className="life-map-planning-drawer__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <aside ref={drawerRef} className="life-map-planning-drawer" role="dialog" aria-modal="true" aria-label={title}>
      <header><div><small>人生地图</small><h2>{title}</h2></div><button ref={closeRef} type="button" onClick={props.onClose} aria-label={`关闭${title}`}><X size={18} /></button></header>
      <div className="life-map-planning-drawer__content">
        {!areaManagement && <>{props.unassignedCount > 0 && <section className="life-map-planning-drawer__unassigned"><h3>未归属阶段内容</h3><p>{props.unassignedCount} 项内容尚未与任何人生阶段相交；它们仍保留在这里与各自的规划入口中。</p></section>}<section><h3><Layers3 size={15} />进行中的人生计划</h3><ItemList items={props.plans} empty="暂无进行中的人生计划" onOpen={(item) => props.onEdit('plan', item)} />{props.onShiftPlans && <button type="button" className="is-action" onClick={props.onShiftPlans}>批量调整人生计划日期</button>}</section><section><h3><Repeat2 size={15} />长期系统</h3><ItemList items={props.systems} empty="暂无长期系统" onOpen={(item) => props.onEdit('system', item)} /><button type="button" className="is-action" onClick={props.onCreateSystem}>新建长期系统</button></section><section><h3><NotebookPen size={15} />复盘</h3><ItemList items={props.reviews} empty="还没有保存复盘" onOpen={(item) => props.onEdit('review', item)} /><div className="life-map-planning-drawer__actions"><button type="button" onClick={() => props.onCreateReview('month')}>开始月度复盘</button><button type="button" onClick={() => props.onCreateReview('quarter')}>开始季度复盘</button></div></section></>}
        <section><h3><Settings2 size={15} />{areaManagement ? '人生领域' : '结构设置'}</h3>{!areaManagement && <><ItemList items={props.periods} empty="尚未设置人生时期" onOpen={(item) => props.onEdit('period', item)} /><button type="button" className="is-action" onClick={props.onCreatePeriod}>新建人生时期</button></>}
          <div className="life-map-structure-settings">
            {groups.map((group) => {
              const meta = LIFE_MAP_PLAN_GROUP_META[group.id];
              const areas = props.areas.filter((area) => area.planGroupId === group.id).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
              return <section key={group.id} role="group" aria-label={`${meta.name}人生领域`} style={{ '--structure-group-color': meta.color } as React.CSSProperties}>
                <header><span><i /><b>{meta.name}</b><small>{areas.length} 个人生领域</small></span>{!areaManagement && <button type="button" onClick={() => props.onUpdateGroupPlacement(group.id, group.placement === 'above' ? 'below' : 'above')} aria-label={`${meta.name}移到${group.placement === 'above' ? '下方' : '上方'}`}>{group.placement === 'above' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}{group.placement === 'above' ? '轴上' : '轴下'}</button>}</header>
                <div className="life-map-structure-settings__areas">
                  {areas.map((area, index) => <div key={area.id} className={area.isHidden ? 'is-hidden' : ''}>
                    <i style={{ background: area.color }} /><span><b>{area.name}</b><small>{area.itemCount} 项内容{area.isHidden ? ' · 已隐藏' : ''}</small></span>
                    <button type="button" disabled={index === 0} onClick={() => props.onMoveArea(area.id, 'up')} aria-label={`上移${area.name}`}><ArrowUp size={13} /></button>
                    <button type="button" disabled={index === areas.length - 1} onClick={() => props.onMoveArea(area.id, 'down')} aria-label={`下移${area.name}`}><ArrowDown size={13} /></button>
                    <button type="button" onClick={() => props.onToggleArea(area.id)} aria-label={area.isHidden ? `显示${area.name}` : `隐藏${area.name}`}>{area.isHidden ? <Eye size={13} /> : <EyeOff size={13} />}</button>
                    <button type="button" onClick={() => props.onEditArea(area.id)} aria-label={`编辑${area.name}`}>编辑</button>
                    <button type="button" disabled={area.itemCount > 0} title={area.itemCount > 0 ? '仍有规划内容，不能删除' : '删除人生领域'} onClick={() => props.onDeleteArea(area.id)} aria-label={`删除${area.name}`}><Trash2 size={13} /></button>
                  </div>)}
                  {areas.length === 0 && <p>尚无人生领域，可直接在这里添加。</p>}
                </div>
                <button type="button" className="life-map-structure-settings__add" onClick={() => props.onCreateArea(group.id)} aria-label={`在${meta.name}下添加人生领域`}><Plus size={14} />添加人生领域</button>
              </section>;
            })}
          </div>
        </section>
      </div>
    </aside>
  </div>;
};

export default LifeMapPlanningDrawer;
