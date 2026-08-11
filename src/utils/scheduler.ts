import dayjs from 'dayjs';
import { SmartTaskBlock, Task } from '@/types';
import { getSmartTaskBlocks } from './blocks';

/**
 * 智能排期引擎：将冷冻仓积压任务自动分配到未来 7 天内负载最少的日期
 * @param backlogTasks 待排期的冷冻仓任务
 * @param allTasks 全局所有任务（用于计算每日负载）
 * @param limit 最多排期数量，默认 5
 * @returns 包含任务与目标日期映射的数组
 */
export function autoScheduleBacklog(
  backlogTasks: Array<SmartTaskBlock & { _taskId: string }>,
  allTasks: Task[],
  limit: number = 5
) {
  if (backlogTasks.length === 0) return [];

  const today = dayjs();
  // 统计未来 7 天（包含今天）的负载
  const loadMap = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    loadMap.set(today.add(i, 'day').format('YYYY-MM-DD'), 0);
  }

  // 计算现有负载（统计这 7 天内安排了多少个 smart block）
  allTasks.forEach(task => {
    const blocks = getSmartTaskBlocks(task.blocks ?? []);
    blocks.forEach(block => {
      if (block.header.date && loadMap.has(block.header.date) && !block.header.isCompleted && !block.header.frozenAt) {
        loadMap.set(block.header.date, loadMap.get(block.header.date)! + 1);
      }
    });
  });

  // 获取可以排期的任务，最多取 limit 个
  const tasksToSchedule = backlogTasks.slice(0, limit);
  const assignments: Array<{ taskId: string; blockId: string; targetDate: string }> = [];

  tasksToSchedule.forEach(block => {
    // 找出负载最少的一天
    let minLoadDay = '';
    let minLoad = Infinity;
    
    Array.from(loadMap.entries()).forEach(([date, load]) => {
      if (load < minLoad) {
        minLoad = load;
        minLoadDay = date;
      }
    });

    if (minLoadDay) {
      assignments.push({
        taskId: block._taskId,
        blockId: block.id,
        targetDate: minLoadDay
      });
      // 更新该日负载
      loadMap.set(minLoadDay, minLoad + 1);
    }
  });

  return assignments;
}
