import type { SyncTaskToEbbPayload } from '@/ebb/types';
import { isLeafGraphNode } from '@/graph/activation';
import type { GraphNode } from '@/graph/types';
import type { SmartTaskHeader, Task } from '@/types';
import { getValidGraphNodeIds, shouldAutoSyncEbb } from '@/utils/blocks';

export interface ProjectTaskEffectPlan {
  ebbPayloads: SyncTaskToEbbPayload[];
  graphNodeIdsToActivate: string[];
  graphNodeIdsToDeactivate: string[];
}

export type CompletedTaskBindingStrategy =
  | 'transfer'
  | 'association-only'
  | 'keep-existing-reviews';

interface ProjectTaskEffectInput {
  tasks: Task[];
  taskId: string;
  blockId: string;
  currentHeader: SmartTaskHeader;
  nextHeader: SmartTaskHeader;
  graphNodes: GraphNode[];
  bindingStrategy?: CompletedTaskBindingStrategy;
}

const emptyPlan = (): ProjectTaskEffectPlan => ({
  ebbPayloads: [],
  graphNodeIdsToActivate: [],
  graphNodeIdsToDeactivate: [],
});

/**
 * Calculates cross-module consequences without mutating any store. This is the
 * transaction planning stage shared by top-level and grouped project tasks.
 */
export function planProjectTaskEffects({
  tasks,
  taskId,
  blockId,
  currentHeader,
  nextHeader,
  graphNodes,
  bindingStrategy = 'transfer',
}: ProjectTaskEffectInput): ProjectTaskEffectPlan {
  const plan = emptyPlan();
  const graphNodeById = new Map(
    (Array.isArray(graphNodes) ? graphNodes : []).map((node) => [node.id, node]),
  );
  const currentNodeIds = getValidGraphNodeIds(currentHeader);
  const nextNodeIds = getValidGraphNodeIds(nextHeader);
  const hasOtherCompletedBinding = (nodeId: string, requireEbbSync = false) =>
    (Array.isArray(tasks) ? tasks : []).some((task) => {
      const blocks = Array.isArray(task?.blocks) ? task.blocks : [];
      return blocks.some((block) =>
        block?.type === 'smart-task'
        && Boolean(block.header)
        && !(task.id === taskId && block.id === blockId)
        && block.header.isCompleted
        && (!requireEbbSync || shouldAutoSyncEbb(block.header))
        && getValidGraphNodeIds(block.header).includes(nodeId),
      );
    });

  const addNode = (nodeId: string, syncEbb = true) => {
    plan.graphNodeIdsToActivate.push(nodeId);
    if (!syncEbb) return;
    const node = graphNodeById.get(nodeId);
    if (!node) return;
    plan.ebbPayloads.push({
      action: 'add',
      graphNodeId: nodeId,
      topicName: node.name,
      complexity: nextHeader.complexity ?? 'normal',
      triggerSchedule: shouldAutoSyncEbb(nextHeader) && isLeafGraphNode(graphNodes, nodeId),
    });
  };

  const removeNode = (nodeId: string, cleanupEbb = true) => {
    const node = graphNodeById.get(nodeId);
    if (!hasOtherCompletedBinding(nodeId)) plan.graphNodeIdsToDeactivate.push(nodeId);
    if (!cleanupEbb) return;
    plan.ebbPayloads.push({
      action: 'revert-source',
      graphNodeId: nodeId,
      topicName: node?.name ?? currentHeader.title,
    });
    if (node && shouldAutoSyncEbb(currentHeader) && !hasOtherCompletedBinding(nodeId, true)) {
      plan.ebbPayloads.push({ action: 'remove', graphNodeId: nodeId, topicName: node.name });
    }
  };

  const newlyCompleted = !currentHeader.isCompleted && nextHeader.isCompleted;
  const newlyUncompleted = currentHeader.isCompleted && !nextHeader.isCompleted;
  if (newlyCompleted) {
    nextNodeIds.forEach((nodeId) => addNode(nodeId));
  } else if (newlyUncompleted) {
    currentNodeIds.forEach((nodeId) => removeNode(nodeId));
  } else if (currentHeader.isCompleted && nextHeader.isCompleted) {
    const syncAddedNodes = bindingStrategy !== 'association-only';
    const cleanupRemovedNodes = bindingStrategy === 'transfer';
    nextNodeIds
      .filter((id) => !currentNodeIds.includes(id))
      .forEach((nodeId) => addNode(nodeId, syncAddedNodes));
    currentNodeIds
      .filter((id) => !nextNodeIds.includes(id))
      .forEach((nodeId) => removeNode(nodeId, cleanupRemovedNodes));

    if (shouldAutoSyncEbb(currentHeader) !== shouldAutoSyncEbb(nextHeader)) {
      nextNodeIds.filter((id) => currentNodeIds.includes(id)).forEach((nodeId) => {
        const node = graphNodeById.get(nodeId);
        if (!node) return;
        if (shouldAutoSyncEbb(nextHeader)) {
          plan.ebbPayloads.push({
            action: 'add',
            graphNodeId: nodeId,
            topicName: node.name,
            complexity: nextHeader.complexity ?? 'normal',
            triggerSchedule: isLeafGraphNode(graphNodes, nodeId),
          });
        } else if (!hasOtherCompletedBinding(nodeId, true)) {
          plan.ebbPayloads.push({ action: 'remove', graphNodeId: nodeId, topicName: node.name });
        }
      });
    }
  }

  return {
    ebbPayloads: plan.ebbPayloads,
    graphNodeIdsToActivate: [...new Set(plan.graphNodeIdsToActivate)],
    graphNodeIdsToDeactivate: [...new Set(plan.graphNodeIdsToDeactivate)],
  };
}
