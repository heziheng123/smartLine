import { create } from 'zustand';
import dayjs from 'dayjs';
import { saveData, useTimelineStore } from './index';
import { useDailyScheduleStore } from '../components/dailySchedule/store';
import { useEbbStore } from '../ebb/store';
import { useGraphStore } from '../graph/store';
import { parseSourceId } from '../components/dailySchedule/conversion';

export type HealthCheckCategory = 'tasks' | 'groups' | 'schedule' | 'graph' | 'ebb' | 'sync';
export type HealthIssueSeverity = 'warning' | 'error' | 'critical';
export type HealthRiskLevel = 'low' | 'medium' | 'high';
export type HealthEntityType =
  | 'task'
  | 'group'
  | 'schedule_item'
  | 'time_block'
  | 'smart_block'
  | 'graph_node'
  | 'review_task'
  | 'date';

export interface HealthEntityPreview {
  id: string;
  type: HealthEntityType;
  title: string;
  subtitle?: string;
  meta?: string;
}

export interface HealthPreviewRow {
  label: string;
  before: string;
  after: string;
}

export interface HealthFixPreview {
  summary: string;
  rows: HealthPreviewRow[];
}

export interface HealthIssue {
  id: string;
  category: HealthCheckCategory;
  severity: HealthIssueSeverity;
  riskLevel: HealthRiskLevel;
  title: string;
  description: string;
  impactSummary: string;
  affectedIds: string[];
  affectedEntities: HealthEntityPreview[];
  autoFixable: boolean;
  requiresConfirm?: boolean;
  fixPreview?: HealthFixPreview;
  fix?: () => Promise<void>;
}

export interface HealthReport {
  lastChecked: number;
  totalIssues: number;
  issues: HealthIssue[];
  isChecking: boolean;
}

interface DataIntegrityStore {
  toast: {
    isOpen: boolean;
    message: string;
    onConfirm?: () => void;
    onUndo?: () => void;
  } | null;
  showToast: (message: string, onConfirm?: () => void, onUndo?: () => void) => void;
  hideToast: () => void;
  healthReport: HealthReport;
  healthPanelOpen: boolean;
  setHealthPanelOpen: (open: boolean) => void;
  runHealthCheck: () => Promise<void>;
  fixIssue: (issueId: string) => Promise<void>;
  fixAllIssues: () => Promise<void>;
  previewFixableIssues: () => HealthFixPreview | null;
  exportReport: () => string;
}

let issueCounter = 0;

function genIssueId(): string {
  issueCounter += 1;
  return `issue-${Date.now().toString(36)}-${issueCounter.toString(36)}`;
}

function isValidDate(dateStr: string | undefined): boolean {
  return !!dateStr && dayjs(dateStr).isValid();
}

function entity(
  type: HealthEntityType,
  id: string,
  title: string,
  subtitle?: string,
  meta?: string,
): HealthEntityPreview {
  return { type, id, title, subtitle, meta };
}

function preview(summary: string, rows: HealthPreviewRow[]): HealthFixPreview {
  return { summary, rows };
}

function createIssue(input: Omit<HealthIssue, 'id' | 'affectedIds'>): HealthIssue {
  return {
    id: genIssueId(),
    ...input,
    affectedIds: input.affectedEntities.map((item) => item.id),
  };
}

function getRiskLevel(
  severity: HealthIssueSeverity,
  autoFixable: boolean,
  entityCount: number,
): HealthRiskLevel {
  if (!autoFixable && severity === 'critical') return 'high';
  if (severity === 'error' || entityCount >= 5) return 'medium';
  return 'low';
}

function resolveSourceExists(
  source: 'project' | 'review' | 'free',
  sourceId: string,
  timelineState: ReturnType<typeof useTimelineStore.getState>,
  ebbState: ReturnType<typeof useEbbStore.getState>,
): boolean {
  if (source === 'free') return true;

  if (source === 'review') {
    const reviewId = sourceId.startsWith('review-') ? sourceId.slice(7) : sourceId;
    return ebbState.reviewTasks.some((task) => task.id === reviewId);
  }

  const parsed = parseSourceId(sourceId);
  if (!parsed || parsed.source !== 'project' || !parsed.parentTaskId) return false;

  const task = timelineState.tasks.find((item) => item.id === parsed.parentTaskId);
  if (!task) return false;

  if (parsed.blockId) {
    return task.blocks.some((block) => block.type === 'smart-task' && block.id === parsed.blockId);
  }

  // 当前项目的数据源已经统一为 SmartTaskBlock。
  // 历史 markdown / legacy sourceId 仅用于兼容旧数据，应视为待迁移或待清理数据。
  if (parsed.line !== undefined) {
    return false;
  }

  return true;
}

function toLocaleDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
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

  setHealthPanelOpen: (open) => set({ healthPanelOpen: open }),

  runHealthCheck: async () => {
    set((state) => ({
      healthReport: {
        ...state.healthReport,
        isChecking: true,
      },
    }));

    const issues: HealthIssue[] = [];
    const timelineState = useTimelineStore.getState();
    const dailyState = useDailyScheduleStore.getState();
    const ebbState = useEbbStore.getState();
    const graphState = useGraphStore.getState();

    const taskIds = new Set(timelineState.tasks.map((task) => task.id));
    const graphNodeIds = new Set(graphState.nodes.map((node) => node.id));

    for (const group of timelineState.groups) {
      const orphanChildren = group.children.filter((child) => !taskIds.has(child.id));
      if (orphanChildren.length === 0) continue;

      const affectedEntities = [
        entity('group', group.id, group.name, '受影响分组'),
        ...orphanChildren.map((child) => entity('task', child.id, child.name, '无效子任务引用')),
      ];

      issues.push(createIssue({
        category: 'groups',
        severity: 'warning',
        riskLevel: getRiskLevel('warning', true, affectedEntities.length),
        title: `分组“${group.name}”包含失效的子任务引用`,
        description: `发现 ${orphanChildren.length} 个子任务已不存在，但仍然残留在该分组中。`,
        impactSummary: `修复后会从该分组中移除 ${orphanChildren.length} 个无效引用，不影响仍存在的任务本体。`,
        affectedEntities,
        autoFixable: true,
        fixPreview: preview(
          '将清理分组内部的失效任务引用。',
          [
            { label: '分组子任务数量', before: `${group.children.length}`, after: `${group.children.length - orphanChildren.length}` },
            { label: '实际删除任务实体', before: '0', after: '0' },
          ],
        ),
        fix: async () => {
          useTimelineStore.setState((state) => {
            const groups = state.groups.map((item) =>
              item.id === group.id
                ? { ...item, children: item.children.filter((child) => taskIds.has(child.id)) }
                : item,
            );
            saveData({
              tasks: state.tasks,
              groups,
              notes: state.notes,
              milestones: state.milestones,
            });
            return { groups };
          });
        },
      }));
    }

    for (const [date, schedule] of Object.entries(dailyState.schedules)) {
      const orphanItems = schedule.items.filter((item) => !resolveSourceExists(item.source, item.sourceId, timelineState, ebbState));

      if (orphanItems.length > 0) {
        const affectedEntities = [
          entity('date', date, date, '受影响日期'),
          ...orphanItems.map((item) =>
            entity(
              'schedule_item',
              item.id,
              item.name || item.sourceId,
              `${date} · ${item.source}`,
              item.sourceId,
            ),
          ),
        ];

        issues.push(createIssue({
          category: 'schedule',
          severity: 'warning',
          riskLevel: getRiskLevel('warning', true, affectedEntities.length),
          title: `${date} 存在 ${orphanItems.length} 个幽灵排期项`,
          description: '这些排期项关联的源任务已经不存在，继续保留会污染每日排期视图。',
          impactSummary: `修复后将移除 ${orphanItems.length} 个失效排期项，不会影响仍存在的源任务和时间线数据。`,
          affectedEntities,
          autoFixable: true,
          fixPreview: preview(
            '将从每日排期 items 中移除失效条目。',
            [
              { label: '当日排期项', before: `${schedule.items.length}`, after: `${schedule.items.length - orphanItems.length}` },
              { label: '删除条目', before: '0', after: `${orphanItems.length}` },
            ],
          ),
          fix: async () => {
            useDailyScheduleStore
              .getState()
              .removeBySourceIds([...new Set(orphanItems.map((item) => item.sourceId))]);
          },
        }));
      }

      const orphanBlocks = (schedule.blocks ?? []).filter(
        (block) => !resolveSourceExists(block.source, block.sourceId, timelineState, ebbState),
      );

      if (orphanBlocks.length > 0) {
        const affectedEntities = [
          entity('date', date, date, '受影响日期'),
          ...orphanBlocks.map((block) =>
            entity(
              'time_block',
              block.id,
              block.name || block.sourceId,
              `${date} · ${block.startTime}-${block.endTime}`,
              block.sourceId,
            ),
          ),
        ];

        issues.push(createIssue({
          category: 'schedule',
          severity: 'warning',
          riskLevel: getRiskLevel('warning', true, affectedEntities.length),
          title: `${date} 存在 ${orphanBlocks.length} 个幽灵时间块`,
          description: '这些时间块已经无法追溯到有效源任务，会造成时间视图和真实数据不一致。',
          impactSummary: `修复后将移除 ${orphanBlocks.length} 个失效时间块，保留其他合法时间安排。`,
          affectedEntities,
          autoFixable: true,
          fixPreview: preview(
            '将从每日排期 blocks 中移除失效时间块。',
            [
              { label: '当日时间块', before: `${schedule.blocks.length}`, after: `${schedule.blocks.length - orphanBlocks.length}` },
              { label: '删除时间块', before: '0', after: `${orphanBlocks.length}` },
            ],
          ),
          fix: async () => {
            useDailyScheduleStore
              .getState()
              .removeBySourceIds([...new Set(orphanBlocks.map((block) => block.sourceId))]);
          },
        }));
      }

      const timeBlocks = [...(schedule.blocks ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime));
      const conflicts: Array<{ block1: typeof timeBlocks[number]; block2: typeof timeBlocks[number] }> = [];

      for (let i = 0; i < timeBlocks.length - 1; i += 1) {
        for (let j = i + 1; j < timeBlocks.length; j += 1) {
          if (timeBlocks[i].endTime > timeBlocks[j].startTime) {
            conflicts.push({ block1: timeBlocks[i], block2: timeBlocks[j] });
          }
        }
      }

      if (conflicts.length > 0) {
        const affectedEntities = [
          entity('date', date, date, '冲突日期'),
          ...conflicts.flatMap(({ block1, block2 }) => [
            entity('time_block', block1.id, block1.name, `${block1.startTime}-${block1.endTime}`),
            entity('time_block', block2.id, block2.name, `${block2.startTime}-${block2.endTime}`),
          ]),
        ];

        issues.push(createIssue({
          category: 'schedule',
          severity: 'error',
          riskLevel: getRiskLevel('error', false, conflicts.length * 2),
          title: `${date} 存在 ${conflicts.length} 组时间冲突`,
          description: '同一天内有时间块发生重叠，时间视图会出现执行冲突。',
          impactSummary: `共检测到 ${conflicts.length} 组时间块重叠，需要人工决定保留、错开或删除哪一项。`,
          affectedEntities,
          autoFixable: false,
          requiresConfirm: true,
          fixPreview: preview(
            '该问题不自动修复，需要你人工调整冲突块。',
            conflicts.map(({ block1, block2 }, index) => ({
              label: `冲突 ${index + 1}`,
              before: `${block1.name} ${block1.startTime}-${block1.endTime}`,
              after: `${block2.name} ${block2.startTime}-${block2.endTime}`,
            })),
          ),
        }));
      }
    }

    for (const task of timelineState.tasks) {
      for (const block of task.blocks) {
        if (block.type !== 'smart-task') continue;

        if (block.header.graphNodeId && !graphNodeIds.has(block.header.graphNodeId)) {
          const affectedEntities = [
            entity('task', task.id, task.name, '所属任务'),
            entity('smart_block', block.id, block.header.title, '绑定了不存在的图谱节点', block.header.graphNodeId),
          ];

          issues.push(createIssue({
            category: 'tasks',
            severity: 'warning',
            riskLevel: getRiskLevel('warning', true, affectedEntities.length),
            title: `任务“${task.name}”中存在失效的图谱绑定`,
            description: `任务块“${block.header.title}”绑定的 graphNodeId 已不存在。`,
            impactSummary: '修复后仅会解绑这条失效关联，不会删除任务块内容或正文。',
            affectedEntities,
            autoFixable: true,
            fixPreview: preview(
              '将清空失效的 graphNodeId。',
              [
                { label: '图谱绑定', before: block.header.graphNodeId, after: '未绑定' },
                { label: '任务块正文', before: '保留', after: '保留' },
              ],
            ),
            fix: async () => {
              useTimelineStore.getState().updateBlockHeader(task.id, block.id, { graphNodeId: undefined });
            },
          }));
        }

        if (block.header.date && !isValidDate(block.header.date)) {
          const affectedEntities = [
            entity('task', task.id, task.name, '所属任务'),
            entity('smart_block', block.id, block.header.title, `非法日期: ${block.header.date}`),
          ];

          issues.push(createIssue({
            category: 'tasks',
            severity: 'error',
            riskLevel: getRiskLevel('error', false, affectedEntities.length),
            title: `任务“${task.name}”存在非法排期日期`,
            description: `任务块“${block.header.title}”的 date 字段格式无效。`,
            impactSummary: '这会导致周矩阵、项目文档排序和排期视图出现异常，需要人工修正日期。',
            affectedEntities,
            autoFixable: false,
            requiresConfirm: true,
            fixPreview: preview(
              '该问题需要人工修正合法日期。',
              [{ label: '当前 date', before: String(block.header.date), after: '手动改为 YYYY-MM-DD' }],
            ),
          }));
        }

        if (
          block.header.deadline &&
          block.header.date &&
          isValidDate(block.header.deadline) &&
          isValidDate(block.header.date) &&
          dayjs(block.header.deadline).isBefore(dayjs(block.header.date))
        ) {
          const affectedEntities = [
            entity('task', task.id, task.name, '所属任务'),
            entity(
              'smart_block',
              block.id,
              block.header.title,
              `${block.header.deadline} 早于 ${block.header.date}`,
            ),
          ];

          issues.push(createIssue({
            category: 'tasks',
            severity: 'warning',
            riskLevel: getRiskLevel('warning', true, affectedEntities.length),
            title: `任务“${task.name}”存在截止日早于排期日`,
            description: `任务块“${block.header.title}”的 deadline 早于 date，容易误导排期和提醒逻辑。`,
            impactSummary: '修复后会清空这条异常截止日，保留原有排期日和任务块正文。',
            affectedEntities,
            autoFixable: true,
            requiresConfirm: true,
            fixPreview: preview(
              '将移除异常 deadline 字段。',
              [
                { label: '排期日期', before: block.header.date, after: block.header.date },
                { label: '截止日期', before: String(block.header.deadline), after: '未设置' },
              ],
            ),
            fix: async () => {
              useTimelineStore.getState().updateBlockHeader(task.id, block.id, { deadline: undefined });
            },
          }));
        }
      }

      if (!isValidDate(task.start) || !isValidDate(task.end)) {
        const affectedEntities = [
          entity('task', task.id, task.name, `${task.start} ~ ${task.end}`),
        ];

        issues.push(createIssue({
          category: 'tasks',
          severity: 'error',
          riskLevel: getRiskLevel('error', false, affectedEntities.length),
          title: `任务“${task.name}”的起止日期非法`,
          description: `start: ${task.start}，end: ${task.end}。`,
          impactSummary: '任务本体日期异常会影响时间线渲染、范围计算和跨视图联动，需要人工修正。',
          affectedEntities,
          autoFixable: false,
          requiresConfirm: true,
          fixPreview: preview(
            '该问题需要人工修正开始和结束日期。',
            [
              { label: '开始日期', before: String(task.start), after: '手动改为 YYYY-MM-DD' },
              { label: '结束日期', before: String(task.end), after: '手动改为 YYYY-MM-DD' },
            ],
          ),
        }));
      }
    }

    const archivedGraphNodes = graphState.nodes.filter((node) => node.isArchived);
    for (const node of archivedGraphNodes) {
      const activeReviews = ebbState.reviewTasks.filter(
        (task) => task.graphNodeId === node.id && !task.isCompleted && !task.isArchived,
      );

      if (activeReviews.length === 0) continue;

      const affectedEntities = [
        entity('graph_node', node.id, node.name, '已归档节点'),
        ...activeReviews.map((review) =>
          entity('review_task', review.id, review.topicName, `复习日期 ${review.dueDate}`),
        ),
      ];

      issues.push(createIssue({
        category: 'ebb',
        severity: 'warning',
        riskLevel: getRiskLevel('warning', true, affectedEntities.length),
        title: `已归档节点“${node.name}”仍有活跃复习任务`,
        description: `检测到 ${activeReviews.length} 个复习任务仍然挂在已归档节点下。`,
        impactSummary: `修复后会把这 ${activeReviews.length} 个复习任务标记为归档，避免继续出现在 Ebb 和每日排期中。`,
        affectedEntities,
        autoFixable: true,
        fixPreview: preview(
          '将归档这些仍然活跃的复习任务。',
          [
            { label: '活跃复习任务', before: `${activeReviews.length}`, after: '0' },
            { label: '图谱节点状态', before: '已归档', after: '已归档' },
          ],
        ),
        fix: async () => {
          const sourceIds = activeReviews.map((review) => `review-${review.id}`);
          for (const review of activeReviews) {
            useEbbStore.getState().updateReviewTask(review.id, { isArchived: true });
          }
          if (sourceIds.length > 0) {
            useDailyScheduleStore.getState().removeBySourceIds(sourceIds);
          }
        },
      }));
    }

    set({
      healthReport: {
        lastChecked: Date.now(),
        totalIssues: issues.length,
        issues,
        isChecking: false,
      },
    });
  },

  fixIssue: async (issueId) => {
    const issue = get().healthReport.issues.find((item) => item.id === issueId);
    if (!issue?.fix) return;

    await issue.fix();
    await get().runHealthCheck();
  },

  fixAllIssues: async () => {
    const fixableIssues = get().healthReport.issues.filter((issue) => issue.autoFixable && issue.fix);
    for (const issue of fixableIssues) {
      await issue.fix!();
    }
    await get().runHealthCheck();
  },

  previewFixableIssues: () => {
    const fixableIssues = get().healthReport.issues.filter((issue) => issue.autoFixable);
    if (fixableIssues.length === 0) return null;

    const affectedEntityCount = fixableIssues.reduce((sum, issue) => sum + issue.affectedEntities.length, 0);
    const mediumOrHighRisk = fixableIssues.filter((issue) => issue.riskLevel !== 'low').length;

    return preview(
      `将应用 ${fixableIssues.length} 项自动修复，覆盖 ${affectedEntityCount} 个受影响对象。`,
      [
        { label: '自动修复项', before: `${fixableIssues.length}`, after: '0' },
        { label: '受影响对象', before: `${affectedEntityCount}`, after: '清理异常引用' },
        { label: '中高风险修复', before: `${mediumOrHighRisk}`, after: `${mediumOrHighRisk}` },
      ],
    );
  },

  exportReport: () => {
    const report = get().healthReport;
    return JSON.stringify(
      {
        ...report,
        exportedAt: toLocaleDateTime(Date.now()),
      },
      null,
      2,
    );
  },
}));
