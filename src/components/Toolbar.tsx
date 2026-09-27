import React, { type ReactNode } from 'react';
import { BrainCircuit, CalendarClock, CalendarDays, LayoutGrid, Map, Network } from 'lucide-react';
import { MIND_MAP_ENABLED } from '@/mindMap/config';

export type AppModule = 'life-map' | 'timeline' | 'ebb' | 'daily-schedule' | 'week-matrix' | 'knowledge-graph' | 'mind-map';

interface ToolbarProps {
  currentView: AppModule;
  onViewChange: (view: AppModule) => void;
  onViewPreload?: (view: AppModule) => void;
}

const NAV_ITEMS: { module: AppModule; label: string; phoneLabel: string; icon: ReactNode }[] = [
  ...(MIND_MAP_ENABLED
    ? [{ module: 'mind-map' as const, label: '地图工作区', phoneLabel: '地图', icon: <Map size={18} /> }]
    : [{ module: 'life-map' as const, label: '人生地图', phoneLabel: '人生', icon: <Map size={18} /> }]),
  { module: 'timeline', label: '项目规划', phoneLabel: '项目', icon: <CalendarDays size={18} /> },
  { module: 'daily-schedule', label: '每日安排', phoneLabel: '今日', icon: <CalendarClock size={18} /> },
  { module: 'week-matrix', label: '周矩阵', phoneLabel: '本周', icon: <LayoutGrid size={18} /> },
  { module: 'ebb', label: '艾宾浩斯复习', phoneLabel: '复习', icon: <BrainCircuit size={18} /> },
  { module: 'knowledge-graph', label: '知识大盘', phoneLabel: '知识', icon: <Network size={18} /> },
];

const Toolbar: React.FC<ToolbarProps> = ({ currentView, onViewChange, onViewPreload }) => {
  const dockRef = React.useRef<HTMLDivElement>(null);
  const pillRef = React.useRef<HTMLSpanElement>(null);
  const activeIndex = NAV_ITEMS.findIndex((item) => item.module === currentView);
  // 滑动小药丸：纯 CSS transform 位移（显卡画），位置按 active 按钮实测计算，
  // 不用 framer-motion 量布局，主线程再忙也滑得动。
  React.useLayoutEffect(() => {
    const dock = dockRef.current;
    const pill = pillRef.current;
    if (!dock || !pill) return;
    const activeBtn = dock.querySelector<HTMLElement>('.tl-dock-btn--active');
    if (!activeBtn) return;
    const dockRect = dock.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    const x = btnRect.left - dockRect.left + btnRect.width / 2;
    pill.style.transform = `translateX(${x}px) translateX(-50%)`;
    pill.style.opacity = '1';
  }, [currentView, activeIndex]);
  return <nav className="tl-dock-wrapper" aria-label="应用导航">
    <div
      ref={dockRef}
      className="tl-dock"
      role="tablist"
      aria-label="主导航"
    >
      <span ref={pillRef} className="tl-dock-sliding-pill" aria-hidden="true" />
      {NAV_ITEMS.map((item) => {
        const active = currentView === item.module;
        return (
          <button
            key={item.module}
            role="tab"
            aria-selected={active}
            aria-controls={`view-${item.module}`}
            aria-label={item.label}
            type="button"
            className={`tl-dock-btn ${active ? 'tl-dock-btn--active' : ''}`}
            onClick={() => onViewChange(item.module)}
            onPointerEnter={() => onViewPreload?.(item.module)}
            onFocus={() => onViewPreload?.(item.module)}
            title={item.label}
          >
            {item.icon}
            <span className="tl-dock-phone-label">{item.phoneLabel}</span>
          </button>
        );
      })}
    </div>
  </nav>;
};

export default Toolbar;
