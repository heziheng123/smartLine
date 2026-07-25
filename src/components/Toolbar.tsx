import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, FolderPlus, BookmarkPlus, Flag, Cloud, CloudOff, CalendarDays, BrainCircuit, CalendarClock, LayoutGrid, Network, Archive, ListTodo, Check, ChevronUp } from 'lucide-react';
import { useTimelineStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { motion } from 'framer-motion';
import { ArchiveLibraryModal } from './GlobalSearch';

export type AppModule = 'timeline' | 'ebb' | 'daily-schedule' | 'week-matrix' | 'knowledge-graph';

interface ToolbarProps {
  currentView: AppModule;
  onViewChange: (view: AppModule) => void;
  onViewPreload?: (view: AppModule) => void;
  displayYear: number;
  onYearChange: (year: number) => void;
  onAddTask: () => void;
  onAddGroup: () => void;
  onAddNote: () => void;
  onAddMilestone: () => void;
  onOpenSync: () => void;
  projectWorkspaceView: 'timeline' | 'overview';
  onProjectWorkspaceViewChange: (view: 'timeline' | 'overview') => void;
}

const Toolbar: React.FC<ToolbarProps> = ({
  currentView,
  onViewChange,
  onViewPreload,
  displayYear,
  onYearChange,
  onAddTask,
  onAddGroup,
  onAddNote,
  onAddMilestone,
  onOpenSync,
  projectWorkspaceView,
  onProjectWorkspaceViewChange,
}) => {
  const { syncEnabled, syncStatus, dockContext } = useTimelineStore(
    useShallow((s) => ({ 
      syncEnabled: s.syncEnabled, 
      syncStatus: s.syncStatus,
      dockContext: s.dockContext,
    })),
  );

  const [isArchiveLibraryOpen, setIsArchiveLibraryOpen] = useState(false);
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [isProjectViewMenuOpen, setIsProjectViewMenuOpen] = useState(false);
  const [projectViewMenuPosition, setProjectViewMenuPosition] = useState<{ left: number; bottom: number } | null>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const projectViewMenuRef = useRef<HTMLDivElement>(null);
  const projectViewPopoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isCreateMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!createMenuRef.current?.contains(event.target as Node)) setIsCreateMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsCreateMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCreateMenuOpen]);

  useEffect(() => {
    if (!isProjectViewMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!projectViewMenuRef.current?.contains(target) && !projectViewPopoverRef.current?.contains(target)) {
        setIsProjectViewMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsProjectViewMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isProjectViewMenuOpen]);

  useEffect(() => {
    if (currentView !== 'timeline') setIsProjectViewMenuOpen(false);
  }, [currentView]);

  const runCreateAction = (action: () => void) => {
    setIsCreateMenuOpen(false);
    action();
  };

  const NAV_ITEMS: { module: AppModule; label: string; icon: React.ReactNode }[] = [
    { module: 'timeline', label: '项目规划', icon: <CalendarDays size={18} /> },
    { module: 'daily-schedule', label: '每日安排', icon: <CalendarClock size={18} /> },
    { module: 'week-matrix', label: '周矩阵', icon: <LayoutGrid size={18} /> },
    { module: 'ebb', label: '艾宾浩斯复习', icon: <BrainCircuit size={18} /> },
    { module: 'knowledge-graph', label: '知识大盘', icon: <Network size={18} /> },
  ];

  return (
    <div className="tl-dock-wrapper">
      <motion.div 
        className="tl-dock"
        role="tablist"
        aria-label="主导航"
        layout
        initial={{ opacity: 1, scale: 1, y: 0 }}
        animate={{ 
          opacity: 1, 
          scale: 1,
          y: 0
        }}
        transition={{ 
          type: "spring", 
          stiffness: 300, 
          damping: 25,
          layout: { type: "spring", stiffness: 350, damping: 30 }
        }}
      >
        <>
          {/* ── 视图导航 ── */}
        {NAV_ITEMS.map((item) => {
          const active = currentView === item.module;
          // Context takeover: only show active view icon if context is not 'none'
          if (dockContext !== 'none' && !active) return null;
          
          if (item.module === 'timeline') {
            return (
              <motion.div
                layout
                key={item.module}
                className="tl-dock-popover-wrap"
                ref={projectViewMenuRef}
                initial={{ opacity: 0, width: 0, scale: 0.8 }}
                animate={{ opacity: 1, width: 'auto', scale: 1 }}
                exit={{ opacity: 0, width: 0, scale: 0.8 }}
              >
                <button
                  role="tab"
                  aria-label="项目规划"
                  aria-selected={active}
                  aria-controls="view-timeline"
                  aria-haspopup="menu"
                  aria-expanded={active ? isProjectViewMenuOpen : false}
                  type="button"
                  className={`tl-dock-btn ${active ? 'tl-dock-btn--active' : ''} ${isProjectViewMenuOpen ? 'tl-dock-btn--menu-open' : ''}`}
                  onClick={() => {
                    if (!active) {
                      onViewChange('timeline');
                      setIsProjectViewMenuOpen(false);
                    } else {
                      if (isProjectViewMenuOpen) {
                        setIsProjectViewMenuOpen(false);
                      } else {
                        const rect = projectViewMenuRef.current?.getBoundingClientRect();
                        const halfMenuWidth = 126;
                        const rawLeft = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
                        setProjectViewMenuPosition({
                          left: Math.max(halfMenuWidth + 8, Math.min(window.innerWidth - halfMenuWidth - 8, rawLeft)),
                          bottom: rect ? window.innerHeight - rect.top + 12 : 88,
                        });
                        setIsProjectViewMenuOpen(true);
                      }
                    }
                  }}
                  onPointerEnter={() => onViewPreload?.('timeline')}
                  onFocus={() => onViewPreload?.('timeline')}
                  title="项目规划"
                >
                  {item.icon}
                  <ChevronUp size={8} className="tl-project-view-caret" aria-hidden="true" />
                  {active && (
                    <motion.div
                      layoutId="dock-active-indicator"
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-500"
                      initial={false}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  )}
                </button>
                {active && isProjectViewMenuOpen && projectViewMenuPosition && createPortal(
                  <div
                    ref={projectViewPopoverRef}
                    className="tl-dock-popover tl-project-view-menu tl-project-view-menu--portal"
                    role="menu"
                    aria-label="项目规划视图"
                    style={{ left: projectViewMenuPosition.left, bottom: projectViewMenuPosition.bottom }}
                  >
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={projectWorkspaceView === 'timeline'}
                      onClick={() => {
                        onProjectWorkspaceViewChange('timeline');
                        setIsProjectViewMenuOpen(false);
                      }}
                    >
                      <CalendarDays size={15} /><span>项目时间轴</span>{projectWorkspaceView === 'timeline' && <Check size={12} />}
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={projectWorkspaceView === 'overview'}
                      onClick={() => {
                        onProjectWorkspaceViewChange('overview');
                        setIsProjectViewMenuOpen(false);
                      }}
                    >
                      <ListTodo size={15} /><span>全部任务</span>{projectWorkspaceView === 'overview' && <Check size={12} />}
                    </button>
                  </div>,
                  document.body,
                )}
              </motion.div>
            );
          }

          return (
            <motion.button
              layout
              key={item.module}
              role="tab"
              aria-selected={active}
              aria-controls={`view-${item.module}`}
              initial={{ opacity: 0, width: 0, scale: 0.8 }}
              animate={{ opacity: 1, width: 'auto', scale: 1 }}
              exit={{ opacity: 0, width: 0, scale: 0.8 }}
              type="button"
              className={`tl-dock-btn ${active ? 'tl-dock-btn--active' : ''}`}
              onClick={() => onViewChange(item.module)}
              onPointerEnter={() => onViewPreload?.(item.module)}
              onFocus={() => onViewPreload?.(item.module)}
              title={item.label}
              style={{ position: 'relative', flexShrink: 0 }}
            >
              {item.icon}
              {active && (
                <motion.div
                  layoutId="dock-active-indicator"
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-500"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </motion.button>
          );
        })}

        {/* ── 归档库 (仅在知识大盘中显示) ── */}
        {currentView === 'knowledge-graph' && (
          <motion.button
            layout
            key="archive-library"
            initial={{ opacity: 0, width: 0, scale: 0.8 }}
            animate={{ opacity: 1, width: 'auto', scale: 1 }}
            exit={{ opacity: 0, width: 0, scale: 0.8 }}
            type="button"
            className="tl-dock-btn"
            onClick={() => setIsArchiveLibraryOpen(true)}
            title="归档库 (查看冷数据)"
            style={{ position: 'relative', flexShrink: 0 }}
          >
            <Archive size={18} />
          </motion.button>
        )}

        {/* ── 动态视图控制插槽 (Portal Target) ── */}
        <motion.div 
          layout 
          key="portal-target" 
          id="tl-dock-portal-target" 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px' 
          }}
        ></motion.div>

        {/* ── 操作按钮 (仅部分视图可能需要，或全局提供) ── */}
        {currentView === 'timeline' && dockContext === 'none' && (
          <motion.div
            key="timeline-actions"
            layout
            initial={{ opacity: 0, width: 0, scale: 0.8 }}
            animate={{ opacity: 1, width: 'auto', scale: 1 }}
            exit={{ opacity: 0, width: 0, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'visible' }}
          >
            <div className="tl-dock-popover-wrap" ref={createMenuRef}>
              <button
                className={`tl-dock-btn tl-dock-btn--primary ${isCreateMenuOpen ? 'tl-dock-btn--menu-open' : ''}`}
                onClick={() => setIsCreateMenuOpen((open) => !open)}
                type="button"
                title="新建"
                aria-haspopup="menu"
                aria-expanded={isCreateMenuOpen}
              >
                <Plus size={18} />
              </button>
              {isCreateMenuOpen && (
                <div className="tl-dock-popover tl-create-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => runCreateAction(onAddTask)}>
                    <Plus size={16} />
                    <span>新建任务</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => runCreateAction(onAddGroup)}>
                    <FolderPlus size={16} />
                    <span>新建项目分组</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => runCreateAction(onAddNote)}>
                    <BookmarkPlus size={16} />
                    <span>新建便签</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => runCreateAction(onAddMilestone)}>
                    <Flag size={16} />
                    <span>新建里程碑</span>
                  </button>
                </div>
              )}
            </div>

            <div className="tl-dock-divider" />

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0 8px' }}>
              <button
                className="tl-dock-btn"
                style={{ width: '24px', height: '24px' }}
                onClick={() => onYearChange(displayYear - 1)}
                type="button"
                title="上一年"
              >
                ‹
              </button>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151', minWidth: '40px', textAlign: 'center' }}>
                {displayYear}
              </span>
              <button
                className="tl-dock-btn"
                style={{ width: '24px', height: '24px' }}
                onClick={() => onYearChange(displayYear + 1)}
                type="button"
                title="下一年"
              >
                ›
              </button>
            </div>

            <div className="tl-dock-divider" />
            
            <button
              className={`tl-dock-btn ${syncEnabled && syncStatus === 'connected' ? 'tl-dock-btn--synced' : ''}`}
              onClick={onOpenSync}
              type="button"
              title={syncEnabled ? `同步中 (${syncStatus})` : '云端同步'}
            >
              {syncEnabled && syncStatus === 'connected' ? <Cloud size={18} /> : <CloudOff size={18} />}
            </button>
          </motion.div>
        )}
        </>
      </motion.div>

      <ArchiveLibraryModal isOpen={isArchiveLibraryOpen} onClose={() => setIsArchiveLibraryOpen(false)} />
    </div>
  );
};

export default Toolbar;
