import React, { useRef, useState, useEffect } from 'react';
import { Plus, FolderPlus, BookmarkPlus, Flag, Download, Upload, Cloud, CloudOff, CalendarDays, BrainCircuit, CalendarClock, LayoutGrid, Network, Search, Archive, Activity } from 'lucide-react';
import { useTimelineStore } from '@/store';
import { useDataIntegrityStore } from '@/store/dataIntegrity';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import { GlobalSearchModal, ArchiveLibraryModal } from './GlobalSearch';

export type AppModule = 'timeline' | 'ebb' | 'daily-schedule' | 'week-matrix' | 'knowledge-graph';

interface ToolbarProps {
  currentView: AppModule;
  onViewChange: (view: AppModule) => void;
  displayYear: number;
  onYearChange: (year: number) => void;
  onAddTask: () => void;
  onAddGroup: () => void;
  onAddNote: () => void;
  onAddMilestone: () => void;
  onImport: (data: string) => void;
  onExport: () => void;
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
  onImport,
  onExport,
  onOpenSync,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { syncEnabled, syncStatus, dockContext } = useTimelineStore(
    useShallow((s) => ({ 
      syncEnabled: s.syncEnabled, 
      syncStatus: s.syncStatus,
      dockContext: s.dockContext,
    })),
  );

  const { healthReport, setHealthPanelOpen, runHealthCheck } = useDataIntegrityStore();
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [isArchiveLibraryOpen, setIsArchiveLibraryOpen] = useState(false);

  // 初始化时自动运行一次健康检查
  useEffect(() => {
    runHealthCheck();
  }, [runHealthCheck]);

  const getHealthIconColor = () => {
    if (healthReport.issues.some(i => i.severity === 'critical')) return 'text-red-500';
    if (healthReport.issues.some(i => i.severity === 'error')) return 'text-red-400';
    return 'text-amber-400';
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      onImport(content);
    };
    reader.readAsText(file);
    e.target.value = '';
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

        {/* ── 全局搜索 ── */}
        <motion.button
          layout
          key="global-search"
          initial={{ opacity: 0, width: 0, scale: 0.8 }}
          animate={{ opacity: 1, width: 'auto', scale: 1 }}
          exit={{ opacity: 0, width: 0, scale: 0.8 }}
          type="button"
          className="tl-dock-btn"
          onClick={() => setIsGlobalSearchOpen(true)}
          title="全局搜索 (查找知识点与归档)"
          style={{ position: 'relative', flexShrink: 0 }}
        >
          <Search size={18} />
        </motion.button>

        {/* ── 数据健康中心 (仅有问题时显示) ── */}
        {healthReport.totalIssues > 0 && (
          <motion.button
            layout
            key="health-center"
            initial={{ opacity: 0, width: 0, scale: 0.8 }}
            animate={{ opacity: 1, width: 'auto', scale: 1 }}
            exit={{ opacity: 0, width: 0, scale: 0.8 }}
            type="button"
            className={`tl-dock-btn ${getHealthIconColor()}`}
            onClick={() => setHealthPanelOpen(true)}
            title={`数据健康异常 (${healthReport.totalIssues} 个问题)`}
            style={{ position: 'relative', flexShrink: 0 }}
          >
            <Activity size={18} />
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-1 -right-1 flex items-center justify-center min-w-[14px] h-[14px] px-1 bg-red-500 text-white text-[9px] font-bold rounded-full border-2 border-slate-900"
            >
              {healthReport.totalIssues}
            </motion.div>
          </motion.button>
        )}

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
            style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}
          >
            <button
              className="tl-dock-btn tl-dock-btn--primary"
              onClick={onAddTask}
              type="button"
              title="添加任务"
            >
              <Plus size={18} />
            </button>
            <button
              className="tl-dock-btn"
              onClick={onAddGroup}
              type="button"
              title="添加分组"
            >
              <FolderPlus size={18} />
            </button>
            <button
              className="tl-dock-btn"
              onClick={onAddNote}
              type="button"
              title="添加便签"
            >
              <BookmarkPlus size={18} />
            </button>
            <button
              className="tl-dock-btn"
              onClick={onAddMilestone}
              type="button"
              title="添加里程碑"
            >
              <Flag size={18} />
            </button>

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
            <button
              className="tl-dock-btn"
              onClick={handleImportClick}
              type="button"
              title="导入 JSON"
            >
              <Upload size={18} />
            </button>
            <button
              className="tl-dock-btn"
              onClick={onExport}
              type="button"
              title="导出 JSON"
            >
              <Download size={18} />
            </button>
          </motion.div>
        )}
        </AnimatePresence>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </motion.div>

      <GlobalSearchModal isOpen={isGlobalSearchOpen} onClose={() => setIsGlobalSearchOpen(false)} />
      <ArchiveLibraryModal isOpen={isArchiveLibraryOpen} onClose={() => setIsArchiveLibraryOpen(false)} />
    </div>
  );
};

export default Toolbar;
