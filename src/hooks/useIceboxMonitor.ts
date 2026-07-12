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
  useEffect(() => {
    // 检查频率：组件挂载时执行一次
    const checkAndFreeze = () => {
      const tasks = useTimelineStore.getState().tasks;
      const updateBlockHeader = useTimelineStore.getState().updateBlockHeader;
      
      const today = todayStr();
      const thresholdDate = subtractDays(today, 2); // T-2
      
      tasks.forEach(task => {
        const blocks = getSmartTaskBlocks(task.blocks ?? []);
        blocks.forEach(block => {
          if (!block.header.isCompleted && block.header.date) {
            // 如果日期早于 T-2
            if (block.header.date < thresholdDate) {
              console.log(`[Icebox] Freezing overdue block: ${block.header.title}`);
              // 将日期设为 undefined，放入冷冻库
              updateBlockHeader(task.id, block.id, { date: undefined });
            }
          }
        });
      });
    };

    checkAndFreeze();
    
    // 可选：设置一个定时器，跨天时自动触发（为保持轻量，这里仅在加载时触发）
  }, []);
}
