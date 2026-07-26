import React from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { ArchiveRestore, Check, CircleDashed, Clock, GripVertical, Hash, Link as LinkIcon, MoreHorizontal, X } from 'lucide-react';
import type { ScheduledItem, TimeSlotConfig } from './types';
import TimeSlotIcon from './TimeSlotIcon';
import { droppableIdForSlot } from './dndIds';
import { resolveTaskCategoryTheme } from '@/utils/taskCategoryTheme';
import { projectBadgeStyle } from './projectAppearance';

interface SlotStats {
  total: number;
  completed: number;
  totalDuration: number;
  inProgress: number;
}

interface DailySlotSectionProps {
  config: TimeSlotConfig;
  items: ScheduledItem[];
  stats: SlotStats;
  addingFree: boolean;
  freeItemName: string;
  freeInputRef: React.RefObject<HTMLInputElement>;
  getVirtualTime: (itemId: string) => string;
  isQuantitySource: (sourceId: string) => boolean;
  checkIsUnlinkedTask: (sourceId: string) => boolean;
  checkIsLinkedTask: (sourceId: string) => boolean;
  onOpenProjectSource: (sourceId: string) => void;
  onToggleItem: (itemId: string) => void;
  onRecordQuantityTarget: (itemId: string, target: number) => void;
  onRemoveItem: (itemId: string) => void;
  onReturnToBacklog: (itemId: string) => void;
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
  isQuantitySource,
  checkIsUnlinkedTask,
  checkIsLinkedTask,
  onOpenProjectSource,
  onToggleItem,
  onRecordQuantityTarget,
  onRemoveItem,
  onReturnToBacklog,
  onStartAddFree,
  onFreeItemNameChange,
  onSubmitFree,
  onCancelFree,
}) => {
  const statLabel = stats.total === 0
    ? '暂无任务'
    : stats.completed === stats.total
      ? '本时段已完成'
      : `${stats.completed}/${stats.total} 完成${stats.inProgress > 0 ? ` · ${stats.inProgress} 进行中` : ''}`;

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
              const quantity = isQuantitySource(item.sourceId);
              const unlinked = checkIsUnlinkedTask(item.sourceId);
              return (
                <Draggable key={item.id} draggableId={item.id} index={index} isDragDisabled={item.id.startsWith('virtual-block-')}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      className={`ds-item ${quantity ? 'ds-item--quantity' : ''} ${item.completed ? 'ds-item--completed' : ''} ${snapshot.isDragging ? 'ds-item--dragging' : ''} ${item.id.startsWith('virtual-block-') ? 'ds-item--virtual' : ''} ${unlinked ? 'ds-item--unlinked' : ''} ${item.source === 'free' ? 'ds-item--free' : ''}`}
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
                        {item.detail && item.source === 'free' && <span className="ds-item-detail">{item.detail}</span>}
                      </div>
                      {quantity && (
                        <div
                          className={`ds-item-quantity-inline ds-item-quantity-inline--${item.quantityState ?? 'unrecorded'}`}
                          title={`今日 ${item.quantityActual ?? 0}${item.quantityTarget !== undefined ? `/${item.quantityTarget}` : ''} ${item.quantityUnit} · 总进度 ${item.quantityCompleted ?? 0}/${item.quantityTotal ?? 0} ${item.quantityUnit} · 剩余 ${Math.max(0, (item.quantityTotal ?? 0) - (item.quantityCompleted ?? 0))} ${item.quantityUnit}`}
                        >
                          <span className="ds-item-quantity-metric ds-item-quantity-metric--today"><Hash size={11} />今日 <strong>{item.quantityActual ?? 0}{item.quantityTarget !== undefined ? `/${item.quantityTarget}` : ''} {item.quantityUnit}</strong></span>
                          <span className="ds-item-quantity-metric ds-item-quantity-metric--total">总 <strong>{item.quantityCompleted ?? 0}/{item.quantityTotal ?? 0} {item.quantityUnit}</strong></span>
                          <span className="ds-item-quantity-mini-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round(((item.quantityCompleted ?? 0) / Math.max(1, item.quantityTotal ?? 1)) * 100))}%` }} /></span>
                          {item.quantityTarget !== undefined && (item.quantityActual ?? 0) < item.quantityTarget && (
                            <button
                              type="button"
                              className="ds-item-quantity-quick"
                              aria-label={(item.quantityActual ?? 0) > 0 ? `补到 ${item.quantityTarget} ${item.quantityUnit}` : `按目标记录 ${item.quantityTarget} ${item.quantityUnit}`}
                              title={(item.quantityActual ?? 0) > 0 ? `补到 ${item.quantityTarget} ${item.quantityUnit}` : `按目标记录 ${item.quantityTarget} ${item.quantityUnit}`}
                              onClick={(event) => { event.stopPropagation(); onRecordQuantityTarget(item.id, item.quantityTarget!); }}
                            >
                              {(item.quantityActual ?? 0) > 0 ? `补${Math.max(0, item.quantityTarget - (item.quantityActual ?? 0))}` : `+${item.quantityTarget}`}
                            </button>
                          )}
                          <button
                            type="button"
                            className="ds-item-quantity-edit"
                            aria-label={(item.quantityActual ?? 0) > 0 ? '编辑记录' : '自定义数量'}
                            title={(item.quantityActual ?? 0) > 0 ? '编辑今日数量' : '记录今日数量'}
                            onClick={(event) => { event.stopPropagation(); onToggleItem(item.id); }}
                          >
                            {(item.quantityActual ?? 0) > 0 ? '编辑' : '记录'}
                          </button>
                        </div>
                      )}
                      {item.id.startsWith('virtual-block-') && <div className="ds-item-duration ds-item-duration--virtual"><Clock size={11} />{getVirtualTime(item.id)}</div>}
                      {(item.duration || item.source === 'review') && !item.id.startsWith('virtual-block-') && <span className="ds-item-duration"><Clock size={11} />{item.duration ?? 30}min</span>}
                      <span
                        className={`ds-item-source ds-item-source--${quantity ? 'vocabulary' : item.source} ${item.source === 'project' && !quantity ? 'ds-project-name-badge' : ''}`}
                        title={item.source === 'project' ? (quantity ? '数量任务' : item.detail || '项目') : undefined}
                        style={item.source === 'project' && !quantity ? projectBadgeStyle(item.color) : undefined}
                      >
                        {quantity ? '数量' : item.source === 'project' ? (item.detail || '项目') : item.source === 'review' ? `复习${item.detail ? ` · ${item.detail}` : ''}` : '占位'}
                      </span>
                      {!quantity && (
                        <button type="button" className={`ds-item-check ${item.completed ? 'ds-item-check--done' : ''}`} onClick={(event) => { event.stopPropagation(); onToggleItem(item.id); }} aria-label={item.completed ? `取消完成：${item.name}` : `完成：${item.name}`}>
                          <Check size={13} />
                        </button>
                      )}
                      {item.source === 'project' && !quantity && !item.completed && !item.id.startsWith('virtual-block-') && (
                        <details className="ds-item-menu" onClick={(event) => event.stopPropagation()}>
                          <summary aria-label={`任务菜单：${item.name}`} title="任务菜单">
                            <MoreHorizontal size={14} />
                          </summary>
                          <div role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={(event) => {
                                event.stopPropagation();
                                onReturnToBacklog(item.id);
                              }}
                            >
                              <ArchiveRestore size={13} />移回待排期箱
                            </button>
                          </div>
                        </details>
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
