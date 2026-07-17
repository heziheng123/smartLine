import { create } from 'zustand';
import { useTimelineStore } from '@/store';

interface GraphBindingSession {
  active: boolean;
  taskId: string;
  blockId: string;
  taskTitle: string;
  originalNodeIds: string[];
  selectedNodeIds: string[];
  start: (input: { taskId: string; blockId: string; taskTitle: string; nodeIds: string[] }) => void;
  toggleNode: (nodeId: string) => void;
  setSelectedNodeIds: (nodeIds: string[]) => void;
  cancel: () => void;
  confirm: () => boolean;
}

const EMPTY_SESSION = {
  active: false,
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
    const { taskId, blockId, selectedNodeIds } = get();
    const timeline = useTimelineStore.getState();
    const task = timeline.tasks.find((item) => item.id === taskId);
    const blockExists = task?.blocks.some((block) => block.id === blockId && block.type === 'smart-task');
    if (!task || !blockExists) return false;
    timeline.updateBlockHeader(taskId, blockId, { graphNodeIds: selectedNodeIds });
    set(EMPTY_SESSION);
    returnToTask(taskId, blockId);
    return true;
  },
}));
