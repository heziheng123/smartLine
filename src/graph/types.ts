// ============================================================
// Knowledge Graph - 类型定义
// ============================================================

export interface GraphNode {
  id: string;              // 唯一标识 (如 'gn_12345')
  name: string;            // 用户手动输入的节点名 (如 '定语从句', '剩余价值率')
  parentId: string | null; // 支持用户后续手动整理层级，初始可为 null (孤立节点)
  createdAt: number;       // 创建时间
  status?: 'unactivated' | 'activated'; // 节点激活状态：静默点亮，无需复习
}

export interface GraphData {
  nodes: GraphNode[];
}
