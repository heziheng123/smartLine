import { useEffect } from 'react';
import { useTimelineStore } from '@/store';
import { getSmartTaskBlocks } from '@/utils/blocks';
import { todayStr, splitDate } from '@/utils/dateSafe';

function subtractDays(dateStr: string, days: number): string {
  const { year, month, day } = splitDate(dateStr);
  const d = new Date(year, month - 1, day - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function useIceboxMonitor() {
  // 订阅 tasks 的变化，一旦有任务增删改，就会触发重新渲染并执行 useEffect
  const tasks = useTimelineStore(state => state.tasks);
  const updateBlockHeader = useTimelineStore(state => state.updateBlockHeader);

  useEffect(() => {
    const checkAndFreeze = () => {
      const today = todayStr();
      const thresholdDate = subtractDays(today, 2); // T-2
      
      let hasChanges = false;
      const updates: { taskId: string; blockId: string }[] = [];

      tasks.forEach(task => {
        const blocks = getSmartTaskBlocks(task.blocks ?? []);
        blocks.forEach(block => {
          if (!block.header.isCompleted && block.header.date) {
            // 如果日期早于 T-2
            if (block.header.date < thresholdDate) {
              console.log(`[Icebox] Freezing overdue block: ${block.header.title}`);
              updates.push({ taskId: task.id, blockId: block.id });
              hasChanges = true;
            }
          }
        });
      });

      // 批量更新，避免在循环中触发多次 store 改变导致死循环
      if (hasChanges) {
        // 使用 setTimeout 避免在渲染期间触发 store 的更新（React 警告）
        setTimeout(() => {
          const now = new Date().toISOString();
          updates.forEach(({ taskId, blockId }) => {
            updateBlockHeader(taskId, blockId, { date: undefined, frozenAt: now });
          });
        }, 0);
      }
    };

    checkAndFreeze();
    
    // 设置一个定时器，每天凌晨或跨天时也能自动触发扫描
    // 这里简单设置每小时检查一次，应对不刷新网页一直挂着的情况
    const timer = setInterval(checkAndFreeze, 1000 * 60 * 60);
    return () => clearInterval(timer);
  }, [tasks, updateBlockHeader]); // 依赖 tasks，实现实时扫描
}
