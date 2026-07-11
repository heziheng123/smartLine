import { create } from 'zustand';
import { useTimelineStore } from './index';
import { useDailyScheduleStore } from '../components/dailySchedule/store';
import { useEbbStore } from '../ebb/store';
import { useGraphStore } from '../graph/store';
import dayjs from 'dayjs';

// 新增类型定义
export type HealthCheckCategory = 'tasks' | 'groups' | 'schedule' | 'graph' | 'ebb' | 'sync';

export interface HealthIssue {
  id: string;
  category: HealthCheckCategory;
  severity: 'warning' | 'error' | 'critical';
  title: string;
  description: string;
  affectedIds: string[];
  autoFixable: boolean;
  fix?: () => Promise<void>;
}

export interface HealthReport {
  lastChecked: number;
  totalIssues: number;
  issues: HealthIssue[];
  isChecking: boolean;
}

interface DataIntegrityStore {
  // 现有字段
  toast: {
    isOpen: boolean;
    message: string;
    onConfirm?: () => void;
    onUndo?: () => void;
  } | null;
  showToast: (message: string, onConfirm?: () => void, onUndo?: () => void) => void;
  hideToast: () => void;

  // 新增字段
  healthReport: HealthReport;
  healthPanelOpen: boolean;

  // 新增方法
  setHealthPanelOpen: (open: boolean) => void;
  runHealthCheck: () => Promise<void>;
  fixIssue: (issueId: string) => Promise<void>;
  fixAllIssues: () => Promise<void>;
  exportReport: () => string;
}

let _issueIdCounter = 0;
function genIssueId(): string {
  return `issue-${Date.now().toString(36)}-${(++_issueIdCounter).toString(36)}`;
}

function isValidDate(dateStr: string): boolean {
  return dayjs(dateStr).isValid();
}

export const useDataIntegrityStore = create<DataIntegrityStore>((set, get) => ({
  toast: null,
  showToast: (message, onConfirm, onUndo) => set({ toast: { isOpen: true, message, onConfirm, onUndo } }),
  hideToast: () => set({ toast: null }),

  healthReport: {
    lastChecked: 0,
    totalIssues: 0,
    issues: [],
    isChecking: false,
  },
  healthPanelOpen: false,

  setHealthPanelOpen: (open: boolean) => set({ healthPanelOpen: open }),

  runHealthCheck: async () => {
    set({ healthReport: { ...get().healthReport, isChecking: true } });

    const issues: HealthIssue[] = [];
    const timelineState = useTimelineStore.getState();
    const dailyState = useDailyScheduleStore.getState();
    const ebbState = useEbbStore.getState();
    const graphState = useGraphStore.getState();

    const taskIds = new Set(timelineState.tasks.map(t => t.id));
    const graphNodeIds = new Set(graphState.nodes.map(n => n.id));

    // 1. 检查孤儿分组子任务
    for (const group of timelineState.groups) {
      const orphanChildren = group.children.filter(child => !taskIds.has(child.id));
      if (orphanChildren.length > 0) {
        const issueId = genIssueId();
        issues.push({
          id: issueId,
          category: 'groups',
          severity: 'warning',
          title: `分组「${group.name}」包含孤儿子任务`,
          description: `${orphanChildren.length} 个子任务在主任务列表中不存在`,
          affectedIds: [group.id, ...orphanChildren.map(c => c.id)],
          autoFixable: true,
          fix: async () => {
            useTimelineStore.setState(state => ({
              groups: state.groups.map(g =>
                g.id === group.id
                  ? { ...g, children: g.children.filter(c => taskIds.has(c.id)) }
                  : g
              )
            }));
          }
        });
      }
    }

    // 2. 检查已排期但源任务不存在
    for (const [date, schedule] of Object.entries(dailyState.schedules)) {
      // 检查 ScheduledItem
      const orphanItems = schedule.items.filter(item => {
        if (item.source === 'project') {
          return !timelineState.tasks.some(t => t.blocks.some(b => b.type === 'smart-task' && (b as any).id === item.sourceId));
        } else if (item.source === 'review') {
          return !ebbState.reviewTasks.some(t => t.id === item.sourceId);
        }
        return false;
      });

      if (orphanItems.length > 0) {
        const issueId = genIssueId();
        issues.push({
          id: issueId,
          category: 'schedule',
          severity: 'warning',
          title: `${date} 有 ${orphanItems.length} 个排期项关联的源任务不存在`,
          description: '这些排期项可能是过期数据',
          affectedIds: [date, ...orphanItems.map(i => i.id)],
          autoFixable: true,
          fix: async () => {
            useDailyScheduleStore.setState(state => {
              const day = state.schedules[date];
              if (!day) return state;
              return {
                schedules: {
                  ...state.schedules,
                  [date]: {
                    ...day,
                    items: day.items.filter(i => !orphanItems.some(oi => oi.id === i.id))
                  }
                }
              };
            });
          }
        });
      }

      // 检查 TimeBlock
      const orphanBlocks = schedule.blocks.filter(block => {
        if (block.source === 'project') {
          return !timelineState.tasks.some(t => t.blocks.some(b => b.type === 'smart-task' && (b as any).id === block.sourceId));
        } else if (block.source === 'review') {
          return !ebbState.reviewTasks.some(t => t.id === block.sourceId);
        }
        return false;
      });

      if (orphanBlocks.length > 0) {
        const issueId = genIssueId();
        issues.push({
          id: issueId,
          category: 'schedule',
          severity: 'warning',
          title: `${date} 有 ${orphanBlocks.length} 个时间块关联的源任务不存在`,
          description: '这些时间块可能是过期数据',
          affectedIds: [date, ...orphanBlocks.map(b => b.id)],
          autoFixable: true,
          fix: async () => {
            useDailyScheduleStore.setState(state => {
              const day = state.schedules[date];
              if (!day) return state;
              return {
                schedules: {
                  ...state.schedules,
                  [date]: {
                    ...day,
                    blocks: day.blocks.filter(b => !orphanBlocks.some(ob => ob.id === b.id))
                  }
                }
              };
            });
          }
        });
      }

      // 5. 检查同一天时间块冲突
      const timeBlocks = [...schedule.blocks].sort((a, b) => a.startTime.localeCompare(b.startTime));
      const conflicts: { block1: string; block2: string }[] = [];
      for (let i = 0; i < timeBlocks.length - 1; i++) {
        for (let j = i + 1; j < timeBlocks.length; j++) {
          if (timeBlocks[i].endTime > timeBlocks[j].startTime) {
            conflicts.push({ block1: timeBlocks[i].id, block2: timeBlocks[j].id });
          }
        }
      }
      if (conflicts.length > 0) {
        const issueId = genIssueId();
        issues.push({
          id: issueId,
          category: 'schedule',
          severity: 'error',
          title: `${date} 有 ${conflicts.length} 个时间块冲突`,
          description: '时间块之间存在时间重叠',
          affectedIds: conflicts.flatMap(c => [c.block1, c.block2]),
          autoFixable: false,
        });
      }
    }

    // 3. 检查绑定了不存在 graphNodeId 的 block
    for (const task of timelineState.tasks) {
      for (const block of task.blocks) {
        if (block.type === 'smart-task') {
          const smartBlock = block as any;
          if (smartBlock.header.graphNodeId && !graphNodeIds.has(smartBlock.header.graphNodeId)) {
            const issueId = genIssueId();
            issues.push({
              id: issueId,
              category: 'tasks',
              severity: 'warning',
              title: `任务「${task.name}」的智能块绑定了不存在的知识节点`,
              description: `graphNodeId: ${smartBlock.header.graphNodeId}`,
              affectedIds: [task.id, block.id],
              autoFixable: true,
              fix: async () => {
                useTimelineStore.getState().updateBlockHeader(task.id, block.id, { graphNodeId: undefined });
              }
            });
          }
        }
      }
    }

    // 4. 检查日期非法、截止早于排期
    for (const task of timelineState.tasks) {
      if (!isValidDate(task.start) || !isValidDate(task.end)) {
        const issueId = genIssueId();
        issues.push({
          id: issueId,
          category: 'tasks',
          severity: 'error',
          title: `任务「${task.name}」日期格式非法`,
          description: `start: ${task.start}, end: ${task.end}`,
          affectedIds: [task.id],
          autoFixable: false,
        });
      }

      for (const block of task.blocks) {
        if (block.type === 'smart-task') {
          const smartBlock = block as any;
          if (smartBlock.header.date && !isValidDate(smartBlock.header.date)) {
            const issueId = genIssueId();
            issues.push({
              id: issueId,
              category: 'tasks',
              severity: 'warning',
              title: `任务「${task.name}」的智能块排期日期非法`,
              description: `date: ${smartBlock.header.date}`,
              affectedIds: [task.id, block.id],
              autoFixable: false,
            });
          }
          if (smartBlock.header.deadline && smartBlock.header.date &&
              isValidDate(smartBlock.header.deadline) && isValidDate(smartBlock.header.date) &&
              dayjs(smartBlock.header.deadline).isBefore(dayjs(smartBlock.header.date))) {
            const issueId = genIssueId();
            issues.push({
              id: issueId,
              category: 'tasks',
              severity: 'warning',
              title: `任务「${task.name}」的智能块截止日期早于排期日期`,
              description: `deadline: ${smartBlock.header.deadline} < date: ${smartBlock.header.date}`,
              affectedIds: [task.id, block.id],
              autoFixable: true,
              fix: async () => {
                useTimelineStore.getState().updateBlockHeader(task.id, block.id, { deadline: undefined });
              }
            });
          }
        }
      }
    }

    // 6. 检查已归档节点仍有活跃复习
    const archivedGraphNodes = graphState.nodes.filter(n => n.isArchived);
    for (const node of archivedGraphNodes) {
      const activeReviews = ebbState.reviewTasks.filter(t => t.graphNodeId === node.id && !t.isCompleted);
      if (activeReviews.length > 0) {
        const issueId = genIssueId();
        issues.push({
          id: issueId,
          category: 'ebb',
          severity: 'warning',
          title: `已归档节点「${node.name}」仍有 ${activeReviews.length} 个活跃复习任务`,
          description: '这些复习任务应该被归档',
          affectedIds: [node.id, ...activeReviews.map(t => t.id)],
          autoFixable: true,
          fix: async () => {
            for (const review of activeReviews) {
              useEbbStore.getState().updateReviewTask(review.id, { isArchived: true });
            }
          }
        });
      }
    }

    set({
      healthReport: {
        lastChecked: Date.now(),
        totalIssues: issues.length,
        issues,
        isChecking: false,
      }
    });
  },

  fixIssue: async (issueId: string) => {
    const issue = get().healthReport.issues.find(i => i.id === issueId);
    if (issue && issue.fix) {
      await issue.fix();
      set(state => ({
        healthReport: {
          ...state.healthReport,
          issues: state.healthReport.issues.filter(i => i.id !== issueId),
          totalIssues: state.healthReport.totalIssues - 1,
        }
      }));
    }
  },

  fixAllIssues: async () => {
    const fixableIssues = get().healthReport.issues.filter(i => i.autoFixable && i.fix);
    for (const issue of fixableIssues) {
      await issue.fix!();
    }
    set(state => ({
      healthReport: {
        ...state.healthReport,
        issues: state.healthReport.issues.filter(i => !i.autoFixable),
        totalIssues: state.healthReport.issues.filter(i => !i.autoFixable).length,
      }
    }));
  },

  exportReport: () => {
    return JSON.stringify(get().healthReport, null, 2);
  }
}));