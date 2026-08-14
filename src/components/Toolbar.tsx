import { type ReactNode } from 'react';
import { BrainCircuit, CalendarClock, CalendarDays, LayoutGrid, Map, Network } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { MOTION_DURATION, MOTION_EASE_ENTER, MOTION_SPRING_GENTLE } from '@/motion/system';

export type AppModule = 'life-map' | 'timeline' | 'ebb' | 'daily-schedule' | 'week-matrix' | 'knowledge-graph';

interface ToolbarProps {
  currentView: AppModule;
  onViewChange: (view: AppModule) => void;
  onViewPreload?: (view: AppModule) => void;
}

const NAV_ITEMS: { module: AppModule; label: string; phoneLabel: string; icon: ReactNode }[] = [
  { module: 'life-map', label: '人生地图', phoneLabel: '地图', icon: <Map size={18} /> },
  { module: 'timeline', label: '项目规划', phoneLabel: '项目', icon: <CalendarDays size={18} /> },
  { module: 'daily-schedule', label: '每日安排', phoneLabel: '今日', icon: <CalendarClock size={18} /> },
  { module: 'week-matrix', label: '周矩阵', phoneLabel: '本周', icon: <LayoutGrid size={18} /> },
  { module: 'ebb', label: '艾宾浩斯复习', phoneLabel: '复习', icon: <BrainCircuit size={18} /> },
  { module: 'knowledge-graph', label: '知识大盘', phoneLabel: '知识', icon: <Network size={18} /> },
];

const Toolbar: React.FC<ToolbarProps> = ({ currentView, onViewChange, onViewPreload }) => {
  const prefersReducedMotion = useReducedMotion();

  return <nav className="tl-dock-wrapper" aria-label="应用导航">
    <motion.div
      className="tl-dock"
      role="tablist"
      aria-label="主导航"
      initial={{ opacity: 1, scale: 1, y: 0 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{
        duration: prefersReducedMotion ? 0 : MOTION_DURATION.fast,
        ease: MOTION_EASE_ENTER,
      }}
    >
      {NAV_ITEMS.map((item) => {
        const active = currentView === item.module;
        return (
          <motion.button
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
            {active && (
              <motion.span
                layoutId="dock-active-indicator"
                className="tl-dock-active-indicator"
                transition={prefersReducedMotion ? { duration: 0 } : MOTION_SPRING_GENTLE}
              />
            )}
          </motion.button>
        );
      })}
    </motion.div>
  </nav>;
};

export default Toolbar;
