import {
  createEmptyMindMapDocument,
  createMindMapEdge,
  createTextMindMapNode,
  type MindMapDocument,
} from './model';

export function createMindMapBenchmarkDocument(nodeCount: number): MindMapDocument {
  const count = Math.max(0, Math.min(10_000, Math.floor(nodeCount)));
  const document = createEmptyMindMapDocument(`${count} 节点基准`, { id: `benchmark-${count}`, now: 1 });
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  for (let index = 0; index < count; index += 1) {
    const id = `node-${index}`;
    const node = createTextMindMapNode({
      x: (index % columns) * 220,
      y: Math.floor(index / columns) * 100,
    }, { id, now: 1, text: `节点 ${index}` });
    document.nodes[id] = node;
    document.zOrder.push(id);
    if (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const edge = createMindMapEdge(`node-${parentIndex}`, id, { id: `edge-${index}`, now: 1 });
      document.edges[edge.id] = edge;
    }
  }
  return document;
}
