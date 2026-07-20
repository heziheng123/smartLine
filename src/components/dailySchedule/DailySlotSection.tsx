import React from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { Check, CircleDashed, Clock, GripVertical, Link as LinkIcon, X } from 'lucide-react';
import type { ScheduledItem, TimeSlotConfig } from './types';
import TimeSlotIcon from './TimeSlotIcon';
import { droppableIdForSlot } from './dndIds';
import { resolveTaskCategoryTheme } from '@/utils/taskCategoryTheme';
import { projectBadgeStyle } from './projectAppearance';

interface SlotStats {
  total: number;
  completed: number;
  totalDuration: number;
}

interface DailySlotSectionProps {
  config: TimeSlotConfig;
  items: ScheduledItem[];
  stats: SlotStats;
  addingFree: boolean;
  freeItemName: string;
  freeInputRef: React.RefObject<HTMLInputElement | null>;
  getVirtualTime: (itemId: string) => string;
  isVocabularySource: (sourceId: string) => boolean;
  checkIsUnlinkedTask: (sourceId: string) => boolean;
  checkIsLinkedTask: (sourceId: string) => boolean;
  onOpenProjectSource: (sourceId: string) => void;
  onToggleItem: (itemId: string) => void;
  onRemoveItem: (itemId: string) => void;
  onStartAddFree: () => void;
  onFreeItemNameChange: (value: string) => void;
  onSubmitFree: () => void;
  onCancelFree: () => void;
}

const DailySlotSection: React.FC<DailySlotSectionProps> = ({
  config,
  items,
  stats,
  addingFree,
  freeItemName,
  freeInputRef,
  getVirtualTime,
  isVocabularySource,
  checkIsUnlinkedTask,
  checkIsLinkedTask,
  onOpenProjectSource,
  onToggleItem,
  onRemoveItem,
  onStartAddFree,
  onFreeItemNameChange,
  onSubmitFree,
  onCancelFree,
}) => {
  const statLabel = stats.total === 0
    ? '暂无任务'
    : stats.completed === stats.total
      ? '本时段已完成'
      : `${stats.completed}/${stats.total} 完成`;

  return (
    <section className="ds-slot-section" aria-labelledby={`ds-slot-title-${config.slot}`}>
      <div className="ds-slot-header">
        <div className="ds-slot-title" id={`ds-slot-title-${config.slot}`}>
          <span className={`ds-slot-icon ds-slot-icon--${config.slot}`}><TimeSlotIcon slot={config.slot} /></span>
          <span>{config.label}</span>
          <span className="ds-slot-time">
            {String(config.startHour).padStart(2, '0')}:00 – {String(config.endHour).padStart(2, '0')}:00
          </span>
        </div>
        <div className={`ds-slot-stats ${stats.total === 0 ? 'ds-slot-stats--empty' : ''}`}>
          {statLabel}
          {stats.totalDuration > 0 && <span className="ds-slot-duration">约 {stats.totalDuration} 分钟</span>}
        </div>
      </div>
      <Droppable droppableId={droppableIdForSlot(config.slot)}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            data-testid={`daily-slot-${config.slot}`}
            className={`ds-slot-dropzone ${snapshot.isDraggingOver ? 'ds-slot-dropzone--active' : ''} ${items.length === 0 ? 'ds-slot-dropzone--empty' : ''}`}
          >
            {items.length === 0 && !snapshot.isDraggingOver && (
              <div className="ds-slot-placeholder">从任务池拖入，或添加生活安排</div>
            )}
            {items.map((item, index) => {
              const vocabulary = isVocabularySource(item.sourceId);
              const unlinked = checkIsUnlinkedTask(item.sourceId);
              return (
                <Draggable key={item.id} draggableId={item.id} index={index} isDragDisabled={item.id.startsWith('virtual-block-')}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      className={`ds-item ${item.completed ? 'ds-item--completed' : ''} ${snapshot.isDragging ? 'ds-item--dragging' : ''} ${item.id.startsWith('virtual-block-') ? 'ds-item--virtual' : ''} ${unlinked ? 'ds-item--unlinked' : ''} ${item.source === 'free' ? 'ds-item--free' : ''}`}
                      style={{
                        ...provided.draggableProps.style,
                        backgroundColor: resolveTaskCategoryTheme(item.categoryColor, item.source).backgroundColor,
                      }}
                      onClick={() => { if (item.source === 'project') onOpenProjectSource(item.sourceId); }}
                    >
                      {item.source !== 'free' && <div className="ds-item-accent" style={{ backgroundColor: resolveTaskCategoryTheme(item.categoryColor, item.source).accentColor }} />}
                      {!item.id.startsWith('virtual-block-') && <div className="ds-item-grip" {...provided.dragHandleProps}><GripVertical size={14} /></div>}
                      <div className="ds-item-content">
                        <span className="ds-item-name" title={item.name}>
                          {item.name}
                          {item.source !== 'free' && (unlinked
                            ? <span title="未绑定节点" className="ml-1 inline-flex items-center"><CircleDashed size={12} className="opacity-40" /></span>
                            : checkIsLinkedTask(item.sourceId) && <span title="已绑定节点" className="ml-1 inline-flex items-center text-blue-500"><LinkIcon size={12} className="opacity-60" /></span>)}
                        </span>
                        {item.detail && (item.source === 'free' || vocabulary) && <span className="ds-item-detail">{item.detail}</span>}
                      </div>
                      {item.id.startsWith('virtual-block-') && <div className="ds-item-duration ds-item-duration--virtual"><Clock size={11} />{getVirtualTime(item.id)}</div>}
                      {(item.duration || item.source === 'review') && !item.id.startsWith('virtual-block-') && <span className="ds-item-duration"><Clock size={11} />{item.duration ?? 30}min</span>}
                      <span
                        className={`ds-item-source ds-item-source--${vocabulary ? 'vocabulary' : item.source} ${item.source === 'project' && !vocabulary ? 'ds-project-name-badge' : ''}`}
                        title={item.source === 'project' ? (vocabulary ? '单词任务' : item.detail || '项目') : undefined}
                        style={item.source === 'project' && !vocabulary ? projectBadgeStyle(item.color) : undefined}
                      >
                        {vocabulary ? '单词' : item.source === 'project' ? (item.detail || '项目') : item.source === 'review' ? `复习${item.detail ? ` · ${item.detail}` : ''}` : '占位'}
                      </span>
                      {item.source !== 'free' && (
                        <button type="button" className={`ds-item-check ${item.completed ? 'ds-item-check--done' : ''}`} onClick={(event) => { event.stopPropagation(); onToggleItem(item.id); }} aria-label={item.completed ? `取消完成：${item.name}` : `完成：${item.name}`}>
                          <Check size={13} />
                        </button>
                      )}
                      <button type="button" className="ds-item-delete" onClick={(event) => { event.stopPropagation(); onRemoveItem(item.id); }} aria-label={`移出安排：${item.name}`}><X size={13} /></button>
                    </div>
                  )}
                </Draggable>
              );
            })}
            {provided.placeholder}
            {addingFree ? (
              <div className="ds-slot-add-free-input-wrap">
                <input
                  ref={freeInputRef}
                  type="text"
                  className="ds-slot-add-free-input"
                  placeholder="输入生活安排..."
                  value={freeItemName}
                  onChange={(event) => onFreeItemNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onSubmitFree();
                    if (event.key === 'Escape') onCancelFree();
                  }}
                  onBlur={onSubmitFree}
                />
              </div>
            ) : (
              <button type="button" className="ds-slot-add-free-btn" onClick={onStartAddFree}>添加生活安排</button>
            )}
          </div>
        )}
      </Droppable>
    </section>
  );
};

export default React.memo(DailySlotSection);
