// ============================================================
// Smart Timeline - 左侧模块切换栏（48px 窄图标栏）
// 时间轴 / 待办 / 复习 三模块切换
// ============================================================

import React from 'react';
import { CalendarDays, CheckSquare, BrainCircuit, CalendarClock, LayoutGrid } from 'lucide-react';

export type AppModule = 'timeline' | 'todo-view' | 'ebb' | 'daily-schedule' | 'week-matrix';

interface SidebarProps {
  current: AppModule;
  onChange: (module: AppModule) => void;
}

const NAV_ITEMS: {
  module: AppModule;
  label: string;
  icon: React.ReactNode;
}[] = [
  { module: 'timeline', label: '项目规划', icon: <CalendarDays size={18} /> },
  { module: 'todo-view', label: '待办执行', icon: <CheckSquare size={18} /> },
  { module: 'daily-schedule', label: '每日安排', icon: <CalendarClock size={18} /> },
  { module: 'week-matrix', label: '周矩阵', icon: <LayoutGrid size={18} /> },
  { module: 'ebb', label: '艾宾浩斯复习', icon: <BrainCircuit size={18} /> },
];

const Sidebar: React.FC<SidebarProps> = ({ current, onChange }) => {
  return (
    <nav className="tl-sidebar" aria-label="模块切换">
      {NAV_ITEMS.map((item) => {
        const active = current === item.module;
        return (
          <button
            key={item.module}
            type="button"
            className={`tl-sidebar-item ${active ? 'tl-sidebar-item--active' : ''}`}
            onClick={() => onChange(item.module)}
            title={item.label}
            aria-label={item.label}
            aria-pressed={active}
          >
            <span className="tl-sidebar-item-bar" aria-hidden="true" />
            <span className="tl-sidebar-item-icon">{item.icon}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default Sidebar;
