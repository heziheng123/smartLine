import { useEffect } from 'react';
import { useTimelineStore } from '@/store';
import { todayStr, splitDate } from '@/utils/dateSafe';
import { collectOverdueFreezeTargets } from '@/domain/icebox';
import { getUniqueTasks } from '@/store/timelineData';

function subtractDays(dateStr: string, days: number): string {
  const { year, month, day } = splitDate(dateStr);
  const d = new Date(year, month - 1, day - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function useIceboxMonitor() {
  // Subscribe to canonical task changes so newly overdue work is discovered.
  const tasks = useTimelineStore(state => state.tasks);
  const groups = useTimelineStore(state => state.groups);
  const freezeOverdueBlocks = useTimelineStore(state => state.freezeOverdueBlocks);

  useEffect(() => {
    let frozenTimer: ReturnType<typeof setTimeout> | null = null;
    const checkAndFreeze = () => {
      const today = todayStr();
      const thresholdDate = subtractDays(today, 2); // T-2

      const targets = collectOverdueFreezeTargets(getUniqueTasks(tasks, groups), thresholdDate);
      if (targets.length > 0) {
        // Defer the single transaction until after React finishes the effect.
        frozenTimer = setTimeout(() => {
          freezeOverdueBlocks(targets, new Date().toISOString());
        }, 0);
      }
    };

    checkAndFreeze();

    // 设置一个定时器，每天凌晨或跨天时也能自动触发扫描
    // 这里简单设置每小时检查一次，应对不刷新网页一直挂着的情况
    const timer = setInterval(checkAndFreeze, 1000 * 60 * 60);
    return () => {
      clearInterval(timer);
      if (frozenTimer !== null) clearTimeout(frozenTimer);
    };
  }, [tasks, groups, freezeOverdueBlocks]);
}
