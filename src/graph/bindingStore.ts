import { create } from 'zustand';
import { useTimelineStore } from '@/store';
import { getUniqueTasks } from '@/store/timelineData';
import type { CompletedTaskBindingStrategy } from '@/domain/projectTaskEffects';
import { useGraphStore } from './store';
import { requestCompletedBindingStrategy } from './bindingDecision';

export type GraphBindingConfirmResult = 'saved' | 'cancelled' | 'missing';
interface GraphBindingSession {
  active: boolean;
  isConfirming: boolean;
  taskId: string;
  blockId: string;
  taskTitle: string;
  originalNodeIds: string[];
  selectedNodeIds: string[];
  start: (input: { taskId: string; blockId: string; taskTitle: string; nodeIds: string[] }) => void;
  toggleNode: (nodeId: string) => void;
  setSelectedNodeIds: (nodeIds: string[]) => void;
  cancel: () => void;
  confirm: () => Promise<GraphBindingConfirmResult>;
}

const EMPTY_SESSION = {
  active: false,
  isConfirming: false,
  taskId: '',
  blockId: '',
  taskTitle: '',
  originalNodeIds: [] as string[],
  selectedNodeIds: [] as string[],
};

function returnToTask(taskId: string, blockId: string) {
  window.dispatchEvent(new CustomEvent('tl-navigate', {
    detail: { view: 'timeline', taskId, blockId },
  }));
}

export const useGraphBindingStore = create<GraphBindingSession>((set, get) => ({
  ...EMPTY_SESSION,
  start: ({ taskId, blockId, taskTitle, nodeIds }) => {
    const uniqueIds = [...new Set(nodeIds)];
    set({
      active: true,
      taskId,
      blockId,
      taskTitle,
      originalNodeIds: uniqueIds,
      selectedNodeIds: uniqueIds,
    });
    window.dispatchEvent(new CustomEvent('tl-navigate', { detail: { view: 'knowledge-graph' } }));
  },
  toggleNode: (nodeId) => set((state) => ({
    selectedNodeIds: state.selectedNodeIds.includes(nodeId)
      ? state.selectedNodeIds.filter((id) => id !== nodeId)
      : [...state.selectedNodeIds, nodeId],
  })),
  setSelectedNodeIds: (nodeIds) => set({ selectedNodeIds: [...new Set(nodeIds)] }),
  cancel: () => {
    const { taskId, blockId } = get();
    set(EMPTY_SESSION);
    returnToTask(taskId, blockId);
  },
  confirm: () => {
    const { taskId, blockId, selectedNodeIds, originalNodeIds, isConfirming } = get();
    if (isConfirming) return Promise.resolve('cancelled');
    set({ isConfirming: true });
    const save = async (): Promise<GraphBindingConfirmResult> => {
      const timeline = useTimelineStore.getState();
      const task = getUniqueTasks(timeline.tasks, timeline.groups)
        .find((item) => item.id === taskId);
      const block = task?.blocks.find(
        (candidate) => candidate.id === blockId && candidate.type === 'smart-task',
      );
      if (!task || block?.type !== 'smart-task') {
        set({ isConfirming: false });
        return 'missing';
      }

      const nextNodeIds = [...new Set(selectedNodeIds)];
      const previousNodeIds = [...new Set(originalNodeIds)];
      const addedNodeIds = nextNodeIds.filter((id) => !previousNodeIds.includes(id));
      const removedNodeIds = previousNodeIds.filter((id) => !nextNodeIds.includes(id));
      let bindingStrategy: CompletedTaskBindingStrategy = 'transfer';

      if (block.header.isCompleted && (addedNodeIds.length > 0 || removedNodeIds.length > 0)) {
        const selectedStrategy = await requestCompletedBindingStrategy({
          currentNodeIds: previousNodeIds,
          nextNodeIds,
          graphNodes: useGraphStore.getState().nodes,
        });
        if (!selectedStrategy) {
          set({ isConfirming: false });
          return 'cancelled';
        }
        bindingStrategy = selectedStrategy;
      }

      const result = timeline.updateBlockHeader(
        taskId,
        blockId,
        { graphNodeIds: nextNodeIds },
        { bindingStrategy },
      );
      if (result.error) {
        set({ isConfirming: false });
        return 'missing';
      }
      set(EMPTY_SESSION);
      returnToTask(taskId, blockId);
      return 'saved';
    };
    return save();
  },
}));
