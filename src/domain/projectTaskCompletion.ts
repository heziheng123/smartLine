import type { EbbSettings, ReviewTask } from '@/ebb/types';
import { buildAbsoluteScheduleDates } from '@/ebb/dataNormalization';
import { isLeafGraphNode } from '@/graph/activation';
import type { GraphNode } from '@/graph/types';
import type { SmartTaskHeader } from '@/types';
import { getValidGraphNodeIds, shouldAutoSyncEbb } from '@/utils/blocks';
import { todayStr } from '@/utils/dateSafe';

export type ProjectTaskCompletionReviewMode = 'continue' | 'relearn' | 'task-only';

export interface ProjectTaskCompletionReviewDecision {
  mode: ProjectTaskCompletionReviewMode;
  /** Only these nodes restart; other eligible nodes continue their current chain. */
  relearnNodeIds?: string[];
}

export interface ProjectTaskCompletionNodeImpact {
  nodeId: string;
  nodeName: string;
  activeRoundIds: string[];
  stateLabel: string;
  relearnLabel: string;
  oldRoundCount: number;
  completedRoundCount: number;
  linkedRoundOrder?: number;
  linkedRoundDueDate?: string;
  newRoundCount: number;
  firstNewDueDate?: string;
  overdueNewRoundCount: number;
  alreadyRestartedOnDate: boolean;
  canRelearn: boolean;
  relearnBlockedReason?: string;
}

export interface ProjectTaskCompletionImpact {
  taskTitle: string;
  completedDate: string;
  nodes: ProjectTaskCompletionNodeImpact[];
  fingerprint: string;
}

interface AnalyzeProjectTaskCompletionInput {
  header: SmartTaskHeader;
  completedDate: string;
  graphNodes: GraphNode[];
  reviewTasks: ReviewTask[];
  ebbSettings: EbbSettings;
  today?: string;
}

function validIntervals(settings: EbbSettings, complexity: ReviewTask['complexity']): number[] {
  const level = complexity ?? 'normal';
  const intervals = settings.complexityConfigs[level]?.intervals;
  return Array.isArray(intervals)
    && intervals.length > 0
    && intervals.every((value) => Number.isInteger(value) && value > 0)
    ? intervals
    : [];
}

function sortRounds(tasks: ReviewTask[]): ReviewTask[] {
  return [...tasks].sort((left, right) =>
    (left.roundOrder ?? Number.MAX_SAFE_INTEGER) - (right.roundOrder ?? Number.MAX_SAFE_INTEGER)
    || left.dueDate.localeCompare(right.dueDate)
    || left.id.localeCompare(right.id),
  );
}

export function buildProjectTaskCompletionFingerprint(
  header: SmartTaskHeader,
  graphNodes: GraphNode[],
  reviewTasks: ReviewTask[],
): string {
  const nodeIds = new Set(getValidGraphNodeIds(header));
  const nodes = graphNodes
    .filter((node) => nodeIds.has(node.id))
    .map((node) => ({
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      isArchived: node.isArchived,
      status: node.status,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const reviews = reviewTasks
    .filter((task) => task.graphNodeId && nodeIds.has(task.graphNodeId))
    .map((task) => ({ ...task }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify({
    header,
    nodes,
    reviews,
  });
}

/**
 * Builds the user-facing completion impact without mutating any store.
 * An empty node list means the completion should keep the existing silent path.
 */
export function analyzeProjectTaskCompletion({
  header,
  completedDate,
  graphNodes,
  reviewTasks,
  ebbSettings,
  today = todayStr(),
}: AnalyzeProjectTaskCompletionInput): ProjectTaskCompletionImpact {
  const nodeById = new Map(graphNodes.map((node) => [node.id, node]));
  const impacts: ProjectTaskCompletionNodeImpact[] = [];

  if (shouldAutoSyncEbb(header)) {
    for (const nodeId of getValidGraphNodeIds(header)) {
      const node = nodeById.get(nodeId);
      if (!node || node.isArchived || !isLeafGraphNode(graphNodes, nodeId)) continue;
      const active = sortRounds(reviewTasks.filter(
        (task) => !task.isArchived && task.graphNodeId === nodeId,
      ));
      if (active.length === 0) continue;

      const alreadyCompletedOnDate = active.some(
        (task) => task.isCompleted && task.completedDate === completedDate,
      );
      const linkedRound = alreadyCompletedOnDate
        ? undefined
        : active.find((task) => !task.isCompleted && task.dueDate <= completedDate);
      const nextPending = active.find((task) => !task.isCompleted);
      const complexity = header.complexity
        ?? active.find((task) => task.complexity)?.complexity
        ?? 'normal';
      const intervals = validIntervals(ebbSettings, complexity);
      const newDates = intervals.length > 0
        ? buildAbsoluteScheduleDates(completedDate, intervals)
        : [];
      const futureCompletion = completedDate > today;
      const canRelearn = !futureCompletion && intervals.length > 0;
      const alreadyRestartedOnDate = active.every((task) =>
        task.scheduleCreatedDate === completedDate
        && Boolean(task.scheduleSourceTaskId)
        && Boolean(task.scheduleSourceBlockId)
        && !task.isSupplemental,
      );
      const stateLabel = alreadyRestartedOnDate
        ? '该节点当天已经重新开始复习周期'
        : active.every((task) => task.isCompleted)
        ? '旧周期已全部完成'
        : linkedRound
          ? `${linkedRound.dueDate === completedDate ? '当天' : '逾期'}有 R${linkedRound.roundOrder ?? active.indexOf(linkedRound) + 1} 待复习`
          : alreadyCompletedOnDate
            ? '当天已有一轮复习完成'
            : nextPending
              ? `下一轮在 ${nextPending.dueDate}`
              : '旧周期没有待复习轮次';
      const relearnParts = alreadyRestartedOnDate
        ? ['本次不会重复归档或生成周期']
        : [
            linkedRound ? `自动完成 R${linkedRound.roundOrder ?? active.indexOf(linkedRound) + 1}` : null,
            `归档旧周期`,
            intervals.length > 0 ? `生成 ${intervals.length} 轮新计划` : '无法生成新计划',
          ].filter(Boolean);

      impacts.push({
        nodeId,
        nodeName: node.name,
        activeRoundIds: active.map((task) => task.id),
        stateLabel,
        relearnLabel: relearnParts.join('，'),
        oldRoundCount: active.length,
        completedRoundCount: active.filter((task) => task.isCompleted).length,
        linkedRoundOrder: linkedRound?.roundOrder ?? (linkedRound ? active.indexOf(linkedRound) + 1 : undefined),
        linkedRoundDueDate: linkedRound?.dueDate,
        newRoundCount: intervals.length,
        firstNewDueDate: newDates[0],
        overdueNewRoundCount: newDates.filter((date) => date < today).length,
        alreadyRestartedOnDate,
        canRelearn,
        relearnBlockedReason: futureCompletion
          ? '完成日期在未来，不能从未来日期重启复习周期。'
          : intervals.length === 0
            ? '当前难度没有有效复习间隔，不能生成新周期。'
            : undefined,
      });
    }
  }

  return {
    taskTitle: header.title,
    completedDate,
    nodes: impacts,
    fingerprint: buildProjectTaskCompletionFingerprint(header, graphNodes, reviewTasks),
  };
}
