import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Archive, X, GripVertical } from 'lucide-react';
import { useTimelineStore } from '@/store';
import { getSmartTaskBlocks, getTagColor } from '@/utils/blocks';
import type { SmartTaskBlock } from '@/types';
import styles from './IceboxPalette.module.css';

interface IceboxTask extends SmartTaskBlock {
  _taskId: string;
}

export const IceboxPalette: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
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
    const dragData = {
      type: 'icebox-task',
      taskId: block._taskId,
      blockId: block.id,
      tag: block.header.tag,
      title: block.header.title
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
            className={styles.panel}
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
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
