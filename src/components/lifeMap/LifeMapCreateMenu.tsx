import { useEffect, useRef } from 'react';
import { CalendarRange, Diamond, Layers3, Plus, Repeat2, StickyNote } from 'lucide-react';

interface LifeMapCreateMenuProps {
  hasPlans: boolean;
  hasAreas: boolean;
  onCreatePlan?: () => void;
  onCreateSystem?: () => void;
  onCreateEvent: () => void;
  onCreatePeriodFocus: () => void;
  onCreateNote: () => void;
  onCreatePhase?: () => void;
  onCreateArea?: () => void;
  onClose: () => void;
}

const LifeMapCreateMenu: React.FC<LifeMapCreateMenuProps> = ({
  hasPlans,
  hasAreas,
  onCreatePlan,
  onCreateSystem,
  onCreateEvent,
  onCreatePeriodFocus,
  onCreateNote,
  onCreatePhase,
  onCreateArea,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, []);
  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };
  return <div ref={menuRef} id="life-map-create-menu" className="life-line__primary-create" data-testid="life-map-primary-create" role="menu" aria-label="添加人生地图内容" onKeyDown={onKeyDown}>
    {onCreatePlan && <button type="button" role="menuitem" onClick={onCreatePlan} aria-label="新建人生计划">
      <Layers3 size={16} /><span><strong>人生计划</strong><small>只在人生地图中设计长期推进方向</small></span>
    </button>}
    {onCreateSystem && <button type="button" role="menuitem" onClick={onCreateSystem} aria-label="新建长期系统">
      <Repeat2 size={16} /><span><strong>长期系统</strong><small>准备长期保持什么规律</small></span>
    </button>}
    <button type="button" role="menuitem" onClick={onCreateEvent} aria-label="新建关键日期">
      <Diamond size={16} /><span><strong>关键日期</strong><small>时间点 · 不能忽略的某一天</small></span>
    </button>
    <button type="button" role="menuitem" disabled={!hasAreas} title={!hasAreas ? '请先创建二级分类' : undefined} onClick={onCreatePeriodFocus} aria-label="添加时间段注记">
      <CalendarRange size={16} /><span><strong>时间注记（时间段）</strong><small>一段时间的重点或说明</small></span>
    </button>
    <button type="button" role="menuitem" disabled={!hasAreas} title={!hasAreas ? '请先创建二级分类' : undefined} onClick={onCreateNote} aria-label="添加时间点注记">
      <StickyNote size={16} /><span><strong>时间注记（时间点）</strong><small>在某一天留下简短说明</small></span>
    </button>
    {!hasAreas && onCreateArea && <button type="button" role="menuitem" className="life-line__primary-create-context" onClick={onCreateArea} aria-label="先创建二级分类">
      <Plus size={16} /><span><strong>先创建二级分类</strong><small>时间注记需要所属分类</small></span>
    </button>}
    {hasPlans && onCreatePhase && <button type="button" role="menuitem" className="life-line__primary-create-context" onClick={onCreatePhase} aria-label="给现有人生计划添加阶段">
      <CalendarRange size={16} /><span><strong>给人生计划添加阶段</strong><small>选择计划后自动继承分类与日期</small></span>
    </button>}
  </div>;
};

export default LifeMapCreateMenu;
