import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import { getProjectBlockSourceId } from '@/components/dailySchedule/sourceIds';
import type { ProjectTaskEffectPlan } from '@/domain/projectTaskEffects';
import { useEbbStore } from '@/ebb/store';
import { isLeafGraphNode } from '@/graph/activation';
import { useGraphStore } from '@/graph/store';
import type { SmartTaskHeader } from '@/types';
import { headerValueEquals } from '@/store/timelineData';
import type { AppDomain } from './operationResult';

export interface ProjectTaskEffectCommitReport {
  affectedDomains: AppDomain[];
  dailyScheduleAction: 'none' | 'updated' | 'removed';
  ebbCommandCount: number;
  activatedGraphNodeIds: string[];
  deactivatedGraphNodeIds: string[];
}

interface ProjectTaskEffectCommitInput {
  taskId: string;
  blockId: string;
  currentHeader: SmartTaskHeader;
  nextHeader: SmartTaskHeader;
  effectPlan: ProjectTaskEffectPlan;
}

export const EMPTY_PROJECT_TASK_EFFECT_COMMIT: ProjectTaskEffectCommitReport = {
  affectedDomains: [],
  dailyScheduleAction: 'none',
  ebbCommandCount: 0,
  activatedGraphNodeIds: [],
  deactivatedGraphNodeIds: [],
};

/**
 * Commits an already validated project-task effect plan. Keeping all external
 * store writes here makes the Timeline action a single transaction boundary
 * instead of spreading the same side effects across UI callers.
 */
export function commitProjectTaskEffects({
  taskId,
  blockId,
  currentHeader,
  nextHeader,
  effectPlan,
}: ProjectTaskEffectCommitInput): ProjectTaskEffectCommitReport {
  const affectedDomains = new Set<AppDomain>();
  let dailyScheduleAction: ProjectTaskEffectCommitReport['dailyScheduleAction'] = 'none';
  const sourceId = getProjectBlockSourceId(taskId, blockId);

  if (currentHeader.isArchived !== nextHeader.isArchived && nextHeader.isArchived) {
    useDailyScheduleStore.getState().removeBySourceIds([sourceId]);
    dailyScheduleAction = 'removed';
    affectedDomains.add('daily-schedule');
    affectedDomains.add('week-matrix');
  } else if (currentHeader.date !== nextHeader.date) {
    useDailyScheduleStore.getState().removeBySourceIds([sourceId]);
    dailyScheduleAction = 'removed';
    affectedDomains.add('daily-schedule');
    affectedDomains.add('week-matrix');
  } else if (
    currentHeader.title !== nextHeader.title
    || currentHeader.duration !== nextHeader.duration
  ) {
    useDailyScheduleStore.getState().updateBySourceId(sourceId, {
      ...(currentHeader.title !== nextHeader.title ? { name: nextHeader.title } : {}),
      ...(currentHeader.duration !== nextHeader.duration ? { duration: nextHeader.duration } : {}),
    });
    dailyScheduleAction = 'updated';
    affectedDomains.add('daily-schedule');
  }
  if (
    currentHeader.isCompleted !== nextHeader.isCompleted
    || currentHeader.isArchived !== nextHeader.isArchived
    || !headerValueEquals(currentHeader.vocabularyRecords, nextHeader.vocabularyRecords)
    || !headerValueEquals(currentHeader.quantityRecords, nextHeader.quantityRecords)
  ) {
    affectedDomains.add('daily-schedule');
  }
  if (!headerValueEquals(currentHeader.graphNodeIds, nextHeader.graphNodeIds)) {
    affectedDomains.add('knowledge-graph');
  }

  effectPlan.ebbPayloads.forEach((payload) => {
    useEbbStore.getState().syncTaskToEbb({
      ...payload,
      sourceTaskId: taskId,
      sourceBlockId: blockId,
    });
  });
  if (effectPlan.ebbPayloads.length > 0) affectedDomains.add('ebb');

  const activatedGraphNodeIds: string[] = [];
  const deactivatedGraphNodeIds: string[] = [];
  effectPlan.graphNodeIdsToActivate.forEach((nodeId) => {
    const graphState = useGraphStore.getState();
    if (!isLeafGraphNode(graphState.nodes, nodeId)) return;
    graphState.updateNode(nodeId, { status: 'activated' });
    activatedGraphNodeIds.push(nodeId);
  });
  effectPlan.graphNodeIdsToDeactivate.forEach((nodeId) => {
    const graphState = useGraphStore.getState();
    if (!isLeafGraphNode(graphState.nodes, nodeId)) return;
    graphState.updateNode(nodeId, { status: 'unactivated' });
    deactivatedGraphNodeIds.push(nodeId);
  });
  if (activatedGraphNodeIds.length > 0 || deactivatedGraphNodeIds.length > 0) {
    affectedDomains.add('knowledge-graph');
  }

  return {
    affectedDomains: [...affectedDomains],
    dailyScheduleAction,
    ebbCommandCount: effectPlan.ebbPayloads.length,
    activatedGraphNodeIds,
    deactivatedGraphNodeIds,
  };
}
