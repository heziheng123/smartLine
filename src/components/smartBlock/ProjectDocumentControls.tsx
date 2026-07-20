import React from 'react';
import { CalendarDays, CheckCircle2 } from 'lucide-react';

interface ProjectDocumentControlsProps {
  progress: { total: number; done: number; ratio: number };
  totalDuration: number;
  tags: Array<{ name: string; color: string }>;
  hideCompleted: boolean;
  activeTag: string | null;
  todayOnly: boolean;
  onToggleCompleted: () => void;
  onToggleTag: (tag: string) => void;
  onToggleToday: () => void;
}

const ProjectDocumentControls: React.FC<ProjectDocumentControlsProps> = ({
  progress,
  totalDuration,
  tags,
  hideCompleted,
  activeTag,
  todayOnly,
  onToggleCompleted,
  onToggleTag,
  onToggleToday,
}) => (
  <>
    {progress.total > 0 && (
      <div className="pdv-progress" aria-label={`项目进度 ${progress.done}/${progress.total}`}>
        <div className="pdv-progress-bar">
          <div className="pdv-progress-fill" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
        </div>
        <span className="pdv-progress-text">
          {progress.done}/{progress.total} 完成{totalDuration > 0 ? ` · ${totalDuration}min 总时长` : ''}
        </span>
      </div>
    )}

    {progress.total > 0 && (
      <div className="pdv-filter-bar" aria-label="项目任务筛选">
        <button type="button" className={`pdv-filter-pill ${hideCompleted ? 'pdv-filter-pill--active' : ''}`} onClick={onToggleCompleted}>
          <CheckCircle2 size={14} aria-hidden="true" />隐藏已完成
        </button>
        {tags.map(({ name, color }) => (
          <button key={name} type="button" className={`pdv-filter-pill ${activeTag === name ? 'pdv-filter-pill--active' : ''}`} onClick={() => onToggleTag(name)}>
            <span className="pdv-filter-dot" style={{ background: color }} />{name}
          </button>
        ))}
        <button type="button" className={`pdv-filter-pill ${todayOnly ? 'pdv-filter-pill--active' : ''}`} onClick={onToggleToday}>
          <CalendarDays size={14} aria-hidden="true" />只看今日
        </button>
      </div>
    )}
  </>
);

export default React.memo(ProjectDocumentControls);
