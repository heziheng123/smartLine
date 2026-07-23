import type { CompletedTaskBindingStrategy } from '@/domain/projectTaskEffects';
import { requestChoice, type ChoiceOption } from '@/services/choice';
import type { GraphNode } from './types';

interface CompletedBindingDecisionInput {
  currentNodeIds: string[];
  nextNodeIds: string[];
  graphNodes: GraphNode[];
}

export async function requestCompletedBindingStrategy({
  currentNodeIds,
  nextNodeIds,
  graphNodes,
}: CompletedBindingDecisionInput): Promise<CompletedTaskBindingStrategy | null> {
  const previousIds = [...new Set(currentNodeIds)];
  const selectedIds = [...new Set(nextNodeIds)];
  const addedNodeIds = selectedIds.filter((id) => !previousIds.includes(id));
  const removedNodeIds = previousIds.filter((id) => !selectedIds.includes(id));
  if (addedNodeIds.length === 0 && removedNodeIds.length === 0) return 'transfer';

  const nodeName = (id: string) => graphNodes.find((node) => node.id === id)?.name ?? '未知节点';
  const choices: ChoiceOption[] = [
    {
      value: 'transfer',
      label: removedNodeIds.length > 0 ? '转移并生成新计划' : '为新增节点生成复习计划',
      description: removedNodeIds.length > 0
        ? '释放不再绑定的节点，清理可安全删除的旧计划，并为新增节点创建或衔接复习。'
        : '保留原有绑定和复习，为新增节点创建或衔接复习。',
      recommended: true,
    },
    {
      value: 'association-only',
      label: '仅修改关联',
      description: '更新知识节点和节点状态；保留现有复习数据，不为新增节点生成复习轮次。',
    },
  ];
  if (removedNodeIds.length > 0) {
    choices.push({
      value: 'keep-existing-reviews',
      label: '保留旧计划，同时生成新计划',
      description: '不再绑定的节点会按规则解除激活，但其复习链保留；新增节点会创建或衔接复习。',
    });
  }

  return requestChoice<CompletedTaskBindingStrategy>({
    title: '如何处理已完成任务的复习关联？',
    message: '这个任务已经完成。修改知识节点会影响节点状态和复习计划，请选择本次处理方式。',
    choices,
    cancelLabel: '返回继续选择',
    tone: 'warning',
    impact: [
      addedNodeIds.length > 0
        ? `新增：${addedNodeIds.map(nodeName).join('、')}`
        : '没有新增节点',
      removedNodeIds.length > 0
        ? `移除：${removedNodeIds.map(nodeName).join('、')}`
        : '保留全部原节点',
    ],
  });
}
