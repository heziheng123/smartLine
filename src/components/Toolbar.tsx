import React, { useEffect, useRef, useState } from 'react';
import { Plus, FolderPlus, BookmarkPlus, Flag, Cloud, CloudOff, CalendarDays, BrainCircuit, CalendarClock, LayoutGrid, Network, Archive, ListTodo, History, RotateCcw } from 'lucide-react';
import { useTimelineStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import { ArchiveLibraryModal } from './GlobalSearch';
import { useOperationHistory } from '@/services/operationHistory';

export type AppModule = 'timeline' | 'task-overview' | 'ebb' | 'daily-schedule' | 'week-matrix' | 'knowledge-graph';

interface ToolbarProps {
  currentView: AppModule;
  onViewChange: (view: AppModule) => void;
  displayYear: number;
  onYearChange: (year: number) => void;
  onAddTask: () => void;
  onAddGroup: () => void;
  onAddNote: () => void;
  onAddMilestone: () => void;
  onOpenSync: () => void;
}

const Toolbar: React.FC<ToolbarProps> = ({
  currentView,
  onViewChange,
  displayYear,
  onYearChange,
  onAddTask,
  onAddGroup,
  onAddNote,
  onAddMilestone,
  onOpenSync,
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
  const createMenuRef = useRef<HTMLDivElement>(null);
  const {
    entries: operationEntries,
    panelOpen: operationPanelOpen,
    setPanelOpen: setOperationPanelOpen,
    undo: undoOperation,
  } = useOperationHistory();
  const latestUndoableOperation = operationEntries.find((entry) => entry.canUndo);

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

  const runCreateAction = (action: () => void) => {
    setIsCreateMenuOpen(false);
    action();
  };

  const NAV_ITEMS: { module: AppModule; label: string; icon: React.ReactNode }[] = [
    { module: 'timeline', label: '项目规划', icon: <CalendarDays size={18} /> },
    { module: 'task-overview', label: '任务总览', icon: <ListTodo size={18} /> },
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
        <AnimatePresence mode="popLayout" initial={false}>
          {/* ── 视图导航 ── */}
        {NAV_ITEMS.map((item) => {
          const active = currentView === item.module;
          // Context takeover: only show active view icon if context is not 'none'
          if (dockContext !== 'none' && !active) return null;
          
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

        <motion.div 
          layout 
          key="divider-1" 
          className="tl-dock-divider" 
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0 }}
        />

        {latestUndoableOperation && (
          <motion.button
            layout
            key="undo-operation"
            initial={{ opacity: 0, width: 0, scale: 0.8 }}
            animate={{ opacity: 1, width: 'auto', scale: 1 }}
            exit={{ opacity: 0, width: 0, scale: 0.8 }}
            type="button"
            className="tl-dock-btn tl-dock-btn--primary"
            onClick={() => void undoOperation(latestUndoableOperation.id)}
            title={`撤销：${latestUndoableOperation.label}`}
            aria-label={`撤销：${latestUndoableOperation.label}`}
            style={{ position: 'relative', flexShrink: 0 }}
          >
            <RotateCcw size={18} />
          </motion.button>
        )}

        <motion.button
          layout
          key="operation-history"
          initial={{ opacity: 0, width: 0, scale: 0.8 }}
          animate={{ opacity: 1, width: 'auto', scale: 1 }}
          exit={{ opacity: 0, width: 0, scale: 0.8 }}
          type="button"
          className={`tl-dock-btn ${operationPanelOpen ? 'tl-dock-btn--view-active' : ''}`}
          onClick={() => setOperationPanelOpen(!operationPanelOpen)}
          title="最近操作与回收站"
          aria-label="最近操作与回收站"
          aria-expanded={operationPanelOpen}
          style={{ position: 'relative', flexShrink: 0 }}
        >
          <History size={18} />
          {operationEntries.length > 0 && <span className="tl-dock-status-badge">{Math.min(operationEntries.length, 99)}</span>}
        </motion.button>

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
        </AnimatePresence>
      </motion.div>

      <ArchiveLibraryModal isOpen={isArchiveLibraryOpen} onClose={() => setIsArchiveLibraryOpen(false)} />
    </div>
  );
};

export default Toolbar;
