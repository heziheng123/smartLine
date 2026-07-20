import React from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { ChevronDown, CircleDashed, Link as LinkIcon, ListTodo, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { TaskSource } from './types';
import { DROPPABLE_POOL, DROPPABLE_POOL_CONTAINER, DROPPABLE_REVIEW_POOL } from './dndIds';
import { resolveTaskCategoryTheme } from '@/utils/taskCategoryTheme';
import { projectBadgeStyle } from './projectAppearance';
import { isQuantityTask } from '@/utils/blocks';

export interface DailyPoolItem {
  id: string;
  name: string;
  source: TaskSource;
  color?: string;
  categoryColor?: string;
  detail?: string;
  duration?: number;
  sourceId: string;
  taskKind?: 'standard' | 'vocabulary' | 'quantity';
  quantityActual?: number;
  quantityTarget?: number;
  quantityTotal?: number;
  quantityCompleted?: number;
  quantityUnit?: string;
  quantityState?: 'unrecorded' | 'in-progress' | 'achieved' | 'recorded';
}

export interface CompletedDailyPoolItem {
  id: string;
  name: string;
  source: TaskSource;
  sourceId: string;
  taskKind?: 'standard' | 'vocabulary' | 'quantity';
  detail?: string;
  color?: string;
  categoryColor?: string;
}

type PoolFilter = 'all' | 'project' | 'review' | 'quantity';

interface DailyTaskPoolProps {
  open: boolean;
  filter: PoolFilter;
  items: DailyPoolItem[];
  completedItems: CompletedDailyPoolItem[];
  showCompleted: boolean;
  checkIsUnlinkedTask: (sourceId: string) => boolean;
  checkIsLinkedTask: (sourceId: string) => boolean;
  onOpenChange: (open: boolean) => void;
  onFilterChange: (filter: PoolFilter) => void;
  onShowCompletedChange: (show: boolean) => void;
  onOpenProjectSource: (sourceId: string) => void;
  onUndoCompleted: (source: TaskSource, sourceId: string) => void;
}

interface PoolGroupProps {
  title: string;
  dotClass: string;
  droppableId: string;
  items: DailyPoolItem[];
  checkIsUnlinkedTask: (sourceId: string) => boolean;
  checkIsLinkedTask: (sourceId: string) => boolean;
  onOpenProjectSource: (sourceId: string) => void;
}

const PoolGroup: React.FC<PoolGroupProps> = ({
  title,
  dotClass,
  droppableId,
  items,
  checkIsUnlinkedTask,
  checkIsLinkedTask,
  onOpenProjectSource,
}) => {
  if (items.length === 0) return null;
  return (
    <section className="ds-pool-group">
      <div className="ds-pool-group-header">
        <div className={`ds-pool-group-dot ${dotClass}`} />
        <span className="ds-pool-group-label">{title}</span>
        <span className="ds-pool-group-count">{items.length}</span>
      </div>
      <Droppable droppableId={droppableId}>
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps} className="ds-pool-list">
            {items.map((item, index) => (
              <Draggable key={item.id} draggableId={item.id} index={index}>
                {(provided, snapshot) => {
                  const unlinked = checkIsUnlinkedTask(item.sourceId);
                  const quantity = isQuantityTask({ taskKind: item.taskKind });
                  return (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className={`ds-pool-item ${snapshot.isDragging ? 'ds-pool-item--dragging' : ''} ${unlinked ? 'ds-pool-item--unlinked' : ''}`}
                      style={{ ...provided.draggableProps.style, backgroundColor: resolveTaskCategoryTheme(item.categoryColor, item.source).backgroundColor }}
                      onClick={() => { if (item.source === 'project') onOpenProjectSource(item.sourceId); }}
                    >
                      <div className="ds-pool-item-accent" style={{ backgroundColor: resolveTaskCategoryTheme(item.categoryColor, item.source).accentColor }} />
                      <div className="ds-pool-item-content">
                        <span className="ds-pool-item-name" title={item.name}>
                          {item.name}
                          {item.source === 'project' && (unlinked
                            ? <span title="未绑定节点" className="ml-1 inline-flex items-center"><CircleDashed size={12} className="opacity-40" /></span>
                            : checkIsLinkedTask(item.sourceId) && <span title="已绑定节点" className="ml-1 inline-flex items-center text-blue-500"><LinkIcon size={12} className="opacity-60" /></span>)}
                        </span>
                        {item.detail && (item.source !== 'project' || !quantity) && <span className="ds-pool-item-detail">{item.detail}</span>}
                        {quantity && (
                          <span className="ds-pool-quantity-summary">
                            <span>总进度 <strong>{item.quantityCompleted}/{item.quantityTotal} {item.quantityUnit}</strong></span>
                            <span>剩余 <strong>{Math.max(0, (item.quantityTotal ?? 0) - (item.quantityCompleted ?? 0))} {item.quantityUnit}</strong></span>
                            {item.quantityTarget !== undefined && <span>今日目标 <strong>{item.quantityTarget} {item.quantityUnit}</strong></span>}
                          </span>
                        )}
                      </div>
                      {item.source === 'project' && !quantity && (
                        <span className="ds-pool-item-tag ds-pool-item-tag--project ds-pool-item-tag--project-name ds-project-name-badge" title={item.detail || '项目'} style={projectBadgeStyle(item.color)}>{item.detail || '项目'}</span>
                      )}
                      {item.source === 'review' && <span className="ds-pool-item-tag ds-pool-item-tag--review">复习{item.detail ? ` · ${item.detail}` : ''}</span>}
                      {quantity && <span className="ds-pool-item-tag ds-pool-item-tag--vocabulary">数量</span>}
                    </div>
                  );
                }}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </section>
  );
};

const DailyTaskPool: React.FC<DailyTaskPoolProps> = ({
  open,
  filter,
  items,
  completedItems,
  showCompleted,
  checkIsUnlinkedTask,
  checkIsLinkedTask,
  onOpenChange,
  onFilterChange,
  onShowCompletedChange,
  onOpenProjectSource,
  onUndoCompleted,
}) => {
  const visibleItems = filter === 'all'
    ? items
    : items.filter((item) => filter === 'quantity'
      ? isQuantityTask({ taskKind: item.taskKind })
      : item.source === filter && !isQuantityTask({ taskKind: item.taskKind }));
  const projectItems = visibleItems.filter((item) => item.source === 'project');
  const reviewItems = visibleItems.filter((item) => item.source === 'review');
  const totalAvailable = items.length;

  return (
    <>
      <button type="button" className="ds-task-pool-trigger" onClick={() => onOpenChange(true)} aria-expanded={open} aria-controls="daily-task-pool">
        <ListTodo size={17} />
        <span>任务池</span>
        <strong>{totalAvailable}</strong>
      </button>
      {open && <button type="button" className="ds-task-pool-backdrop" onClick={() => onOpenChange(false)} aria-label="关闭任务池" />}
      <Droppable droppableId={DROPPABLE_POOL_CONTAINER} isDropDisabled={false}>
        {(provided, snapshot) => (
          <aside
            id="daily-task-pool"
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`ds-right ${open ? 'ds-right--open' : 'ds-right--collapsed'} ${snapshot.isDraggingOver ? 'ds-right--drop-target' : ''}`}
            aria-label="待安排任务池"
          >
            <div className="ds-pool-collapsed-rail">
              <button type="button" onClick={() => onOpenChange(true)} aria-label={`展开任务池，${totalAvailable} 个待安排任务`}>
                <PanelRightOpen size={18} />
                <strong>{totalAvailable}</strong>
                <span>任务池</span>
              </button>
            </div>
            <div className="ds-pool-content">
              <div className="ds-pool-header">
                <div className="ds-pool-heading">
                  <ListTodo size={17} />
                  <h2 className="ds-pool-title">任务池</h2>
                  <span className="ds-pool-total">{totalAvailable} 个待安排</span>
                </div>
                <button type="button" className="ds-pool-collapse-btn" onClick={() => onOpenChange(false)} aria-label="收起任务池">
                  <PanelRightClose className="ds-pool-collapse-desktop" size={17} />
                  <ChevronDown className="ds-pool-collapse-mobile" size={18} />
                </button>
              </div>
              <div className="ds-pool-filters" role="group" aria-label="任务池筛选">
                {(['all', 'project', 'review', 'quantity'] as const).map((value) => (
                  <button key={value} type="button" className={`ds-filter-btn ${filter === value ? 'ds-filter-btn--active' : ''}`} onClick={() => onFilterChange(value)}>
                    {value === 'all' ? '全部' : value === 'project' ? '项目' : value === 'review' ? '复习' : '数量'}
                  </button>
                ))}
              </div>
              <div className="ds-pool-scroll">
                <PoolGroup title="项目任务" dotClass="ds-pool-group-dot--project" droppableId={DROPPABLE_POOL} items={projectItems} checkIsUnlinkedTask={checkIsUnlinkedTask} checkIsLinkedTask={checkIsLinkedTask} onOpenProjectSource={onOpenProjectSource} />
                <PoolGroup title="复习任务" dotClass="ds-pool-group-dot--review" droppableId={DROPPABLE_REVIEW_POOL} items={reviewItems} checkIsUnlinkedTask={checkIsUnlinkedTask} checkIsLinkedTask={checkIsLinkedTask} onOpenProjectSource={onOpenProjectSource} />
                {visibleItems.length === 0 && (
                  <div className="ds-pool-empty">
                    <ListTodo size={22} />
                    <strong>{items.length === 0 ? '今日暂无待安排任务' : '当前筛选下没有任务'}</strong>
                    <span>{items.length === 0 ? '普通任务、数量进度任务和复习会显示在这里' : '可以切换上方筛选条件'}</span>
                  </div>
                )}
                {completedItems.length > 0 && (
                  <section className="ds-pool-group ds-pool-group--completed">
                    <button type="button" className="ds-pool-completed-toggle" onClick={() => onShowCompletedChange(!showCompleted)} aria-expanded={showCompleted}>
                      <span>今日已完成</span>
                      <span className="ds-pool-group-count">{completedItems.length}</span>
                      <span>{showCompleted ? '收起' : '展开'}</span>
                    </button>
                    {showCompleted && (
                      <div className="ds-pool-list">
                        {completedItems.map((item) => (
                          <div key={item.id} className="ds-pool-item ds-pool-item--completed" style={{ backgroundColor: resolveTaskCategoryTheme(item.categoryColor, item.source).backgroundColor }} onClick={() => { if (item.source === 'project') onOpenProjectSource(item.sourceId); }}>
                            <div className="ds-pool-item-content">
                              <span className="ds-pool-item-name" title={item.name}>{item.name}</span>
                              {item.detail && (item.source !== 'project' || isQuantityTask({ taskKind: item.taskKind })) && <span className="ds-pool-item-detail">{item.detail}</span>}
                            </div>
                            {item.source === 'project' && !isQuantityTask({ taskKind: item.taskKind }) && <span className="ds-pool-item-tag ds-pool-item-tag--project ds-pool-item-tag--project-name ds-project-name-badge" title={item.detail || '项目'} style={projectBadgeStyle(item.color)}>{item.detail || '项目'}</span>}
                            <button type="button" className="ds-pool-undo-btn" onClick={(event) => { event.stopPropagation(); onUndoCompleted(item.source, item.sourceId); }}>撤销</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}
                {provided.placeholder}
              </div>
            </div>
          </aside>
        )}
      </Droppable>
    </>
  );
};

export default React.memo(DailyTaskPool);
