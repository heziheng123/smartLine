import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Archive, X, GripVertical } from 'lucide-react';
import { useTimelineStore } from '@/store';
import { getSmartTaskBlocks, getTagColor } from '@/utils/blocks';
import type { SmartTaskBlock, SmartBlockDragPayload } from '@/types';
import styles from './IceboxPalette.module.css';

interface IceboxTask extends SmartTaskBlock {
  _taskId: string;
}

export const IceboxPalette: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [panelSize, setPanelSize] = useState({ width: 320, height: 480 });
  const [isResizing, setIsResizing] = useState(false);
  const tasks = useTimelineStore(state => state.tasks);

  // 获取所有在冷冻库中的任务（未完成，且 date 为空）
  const iceboxBlocks = useMemo(() => {
    const blocks: IceboxTask[] = [];
    tasks.forEach(task => {
      const parsedBlocks = getSmartTaskBlocks(task.blocks ?? []);
      parsedBlocks.forEach(block => {
        if (!block.header.isCompleted && !block.header.date) {
          blocks.push({ ...block, _taskId: task.id });
        }
      });
    });
    return blocks;
  }, [tasks]);

  // 按 Tag 分组
  const groupedBlocks = useMemo(() => {
    const map = new Map<string, IceboxTask[]>();
    iceboxBlocks.forEach(block => {
      const tag = block.header.tag || 'untagged';
      if (!map.has(tag)) map.set(tag, []);
      map.get(tag)!.push(block);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [iceboxBlocks]);

  const count = iceboxBlocks.length;

  // 拖拽处理
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, block: IceboxTask) => {
    const dragData: SmartBlockDragPayload = {
      type: 'smart-block',
      source: 'icebox',
      taskId: block._taskId,
      blockId: block.id,
      tag: block.header.tag,
      title: block.header.title,
      fromDate: '' // 冷冻任务没有原始日期
    };
    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'move';
    
    // 拖拽时面板稍微变透明
    const container = e.currentTarget.closest(`.${styles.panel}`) as HTMLElement;
    if (container) {
      container.style.opacity = '0.5';
      const handleDragEnd = () => {
        container.style.opacity = '1';
        container.removeEventListener('dragend', handleDragEnd);
      };
      container.addEventListener('dragend', handleDragEnd);
    }
  };

  // 隐形边框拉伸逻辑
  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>, direction: 'left' | 'top' | 'top-left') => {
    e.stopPropagation(); // 阻止 Framer Motion 的拖拽
    setIsResizing(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = panelSize.width;
    const startHeight = panelSize.height;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      
      let newWidth = startWidth;
      let newHeight = startHeight;

      if (direction === 'left' || direction === 'top-left') {
        const deltaX = startX - moveEvent.clientX;
        newWidth = Math.min(Math.max(startWidth + deltaX, 280), 800); // 最小 280px，最大 800px
      }
      
      if (direction === 'top' || direction === 'top-left') {
        const deltaY = startY - moveEvent.clientY;
        newHeight = Math.min(Math.max(startHeight + deltaY, 320), window.innerHeight * 0.85); // 最小 320px，最大 85vh
      }

      setPanelSize({ width: newWidth, height: newHeight });
    };

    const handlePointerUp = () => {
      setIsResizing(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  if (count === 0 && !isExpanded) return null;

  return (
    <motion.div 
      className={styles.paletteContainer}
      drag
      dragConstraints={{ top: -500, left: -800, right: 0, bottom: 0 }}
      dragMomentum={false}
    >
      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            className={`${styles.panel} ${isResizing ? styles.isResizing : ''}`}
            style={{ width: panelSize.width, height: panelSize.height, maxHeight: '85vh' }}
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={isResizing ? { duration: 0 } : { type: 'spring', damping: 25, stiffness: 300 }}
          >
            {/* 隐形拉伸控制手柄 */}
            <div 
              className={`${styles.resizeHandle} ${styles.resizeTop}`} 
              onPointerDown={(e) => handleResizeStart(e, 'top')} 
            />
            <div 
              className={`${styles.resizeHandle} ${styles.resizeLeft}`} 
              onPointerDown={(e) => handleResizeStart(e, 'left')} 
            />
            <div 
              className={`${styles.resizeHandle} ${styles.resizeTopLeft}`} 
              onPointerDown={(e) => handleResizeStart(e, 'top-left')} 
            />

            <div className={styles.panelHeader}>
              <div className={styles.panelTitle}>
                <Archive size={16} />
                冷冻库 (Icebox)
              </div>
              <button 
                className={styles.panelClose}
                onClick={() => setIsExpanded(false)}
                onPointerDownCapture={(e) => e.stopPropagation()} // 防止触发拖拽
              >
                <X size={16} />
              </button>
            </div>
            
            <div 
              className={styles.panelBody}
              onPointerDownCapture={(e) => e.stopPropagation()} // 面板内部滚动不触发拖拽
            >
              {groupedBlocks.length === 0 ? (
                <div className={styles.emptyState}>
                  <Archive size={32} opacity={0.5} />
                  <span>冷冻库是空的</span>
                </div>
              ) : (
                groupedBlocks.map(([tag, blocks]) => (
                  <div key={tag} className={styles.tagGroup}>
                    <div className={styles.tagHeader}>
                      <span 
                        className={styles.tagColorDot} 
                        style={{ backgroundColor: getTagColor(tag) }} 
                      />
                      {tag}
                    </div>
                    {blocks.map(block => (
                      <div 
                        key={block.id}
                        className={styles.taskCard}
                        draggable
                        onDragStart={(e) => handleDragStart(e, block)}
                      >
                        <GripVertical size={14} className={styles.taskIcon} />
                        <div className={styles.taskContent}>
                          <span className={styles.taskTitle}>{block.header.title}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div 
        className={`${styles.capsule} ${isExpanded ? styles.capsuleActive : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
        whileTap={{ scale: 0.95 }}
      >
        <span>🧊 Backlog</span>
        <span style={{ 
          background: isExpanded ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.04)', 
          padding: '2px 8px', 
          borderRadius: '99px',
          fontSize: '11px',
          fontWeight: 600,
          color: isExpanded ? 'var(--text-primary, #18181B)' : 'var(--text-secondary, #52525B)',
          transition: 'all 0.2s'
        }}>
          {count}
        </span>
      </motion.div>
    </motion.div>
  );
};
