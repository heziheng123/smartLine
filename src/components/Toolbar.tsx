// ============================================================
// Smart Timeline - 工具栏（年份导航 + 新建 + 导入导出）
// ============================================================

import React, { useRef } from 'react';
import { Plus, FolderPlus, BookmarkPlus, Flag, Download, Upload, Cloud, CloudOff } from 'lucide-react';
import { useTimelineStore } from '@/store';

interface ToolbarProps {
  displayYear: number;
  onYearChange: (year: number) => void;
  onAddTask: () => void;
  onAddGroup: () => void;
  onAddNote: () => void;
  onAddMilestone: () => void;
  onImport: (data: string) => void;
  onExport: () => void;
  onOpenSync: () => void;
  taskCount: number;
}

const Toolbar: React.FC<ToolbarProps> = ({
  displayYear,
  onYearChange,
  onAddTask,
  onAddGroup,
  onAddNote,
  onAddMilestone,
  onImport,
  onExport,
  onOpenSync,
  taskCount,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { syncEnabled, syncStatus } = useTimelineStore();

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

    // 重置 input 以便重复导入同一文件
    e.target.value = '';
  };

  return (
    <div className="tl-toolbar">
      <div className="tl-toolbar-left">
        <button
          className="tl-toolbar-btn tl-toolbar-btn--primary"
          onClick={onAddTask}
          type="button"
        >
          <Plus size={14} />
          添加任务
        </button>
        <button
          className="tl-toolbar-btn tl-toolbar-btn--secondary"
          onClick={onAddGroup}
          type="button"
          title="添加分组"
        >
          <FolderPlus size={14} />
          分组
        </button>
        <button
          className="tl-toolbar-btn tl-toolbar-btn--secondary"
          onClick={onAddNote}
          type="button"
          title="添加便签"
        >
          <BookmarkPlus size={14} />
          便签
        </button>
        <button
          className="tl-toolbar-btn tl-toolbar-btn--secondary"
          onClick={onAddMilestone}
          type="button"
          title="添加里程碑"
        >
          <Flag size={14} />
          里程碑
        </button>
        <span className="tl-toolbar-count">共 {taskCount} 个任务</span>
      </div>

      <div className="tl-toolbar-center">
        <button
          className="tl-toolbar-year-btn"
          onClick={() => onYearChange(displayYear - 1)}
          type="button"
          title="上一年"
        >
          ‹
        </button>
        <span className="tl-toolbar-year">{displayYear} 年</span>
        <button
          className="tl-toolbar-year-btn"
          onClick={() => onYearChange(displayYear + 1)}
          type="button"
          title="下一年"
        >
          ›
        </button>
      </div>

      <div className="tl-toolbar-right">
        <button
          className={`tl-toolbar-btn tl-toolbar-btn--ghost ${syncEnabled && syncStatus === 'connected' ? 'tl-toolbar-btn--synced' : ''}`}
          onClick={onOpenSync}
          type="button"
          title={syncEnabled ? `同步中 (${syncStatus})` : '云端同步'}
        >
          {syncEnabled && syncStatus === 'connected' ? <Cloud size={14} /> : <CloudOff size={14} />}
          {syncEnabled && syncStatus === 'connected' ? '已同步' : '同步'}
        </button>
        <button
          className="tl-toolbar-btn tl-toolbar-btn--ghost"
          onClick={handleImportClick}
          type="button"
          title="导入 JSON"
        >
          <Upload size={14} />
          导入
        </button>
        <button
          className="tl-toolbar-btn tl-toolbar-btn--ghost"
          onClick={onExport}
          type="button"
          title="导出 JSON"
        >
          <Download size={14} />
          导出
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
};

export default Toolbar;
