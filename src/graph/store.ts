import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GraphNode, GraphData } from './types';
import { genId } from '@/ebb/scheduler';

interface GraphState extends GraphData {
  // Actions
  addNode: (name: string, parentId?: string | null) => GraphNode;
  updateNode: (id: string, updates: Partial<Omit<GraphNode, 'id' | 'createdAt'>>) => void;
  deleteNode: (id: string) => void;
  getNodeById: (id: string) => GraphNode | undefined;
}

export const useGraphStore = create<GraphState>()(
  persist(
    (set, get) => ({
      nodes: [],

      addNode: (name: string, parentId: string | null = null) => {
        const newNode: GraphNode = {
          id: genId('gn'),
          name,
          parentId,
          createdAt: Date.now(),
        };

        set((state) => ({
          nodes: [...state.nodes, newNode],
        }));

        return newNode;
      },

      updateNode: (id: string, updates: Partial<Omit<GraphNode, 'id' | 'createdAt'>>) => {
        set((state) => ({
          nodes: state.nodes.map((node) =>
            node.id === id ? { ...node, ...updates } : node
          ),
        }));
      },

      deleteNode: (id: string) => {
        set((state) => {
          // 删除节点，并将子节点的 parentId 置为 null，或者级联删除？
          // 这里我们选择把子节点的 parentId 设为父节点的 parentId 或 null
          const nodeToDelete = state.nodes.find(n => n.id === id);
          if (!nodeToDelete) return state;

          return {
            nodes: state.nodes
              .filter((node) => node.id !== id)
              .map((node) => 
                node.parentId === id ? { ...node, parentId: nodeToDelete.parentId } : node
              ),
          };
        });
      },

      getNodeById: (id: string) => {
        return get().nodes.find((node) => node.id === id);
      },
    }),
    {
      name: 'line-graph-storage',
      version: 1,
    }
  )
);
