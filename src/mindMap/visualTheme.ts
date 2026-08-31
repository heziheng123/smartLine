import { edgeSourceRef, edgeTargetRef, type MindMapDocument, type MindMapEdge, type MindMapNode } from './model';
import { MIND_MAP_VISUAL_TOKENS } from './styles/visualTokens';

export const mindMapNodeThemeColor = (node: MindMapNode) => {
  const fill = node.style.fill.toLowerCase();
  if (fill !== '#fff' && fill !== '#ffffff') return node.style.fill;
  if (node.style.borderColor.toLowerCase() !== '#d9dce3') return node.style.borderColor;
  return MIND_MAP_VISUAL_TOKENS.color.accent;
};

export function resolveBranchThemeColors(document: MindMapDocument) {
  const children = new Map<string, string[]>();
  const childIds = new Set<string>();
  for (const edge of Object.values(document.edges)) {
    const source = edgeSourceRef(edge);
    const target = edgeTargetRef(edge);
    if (edge.relationship !== 'tree' || source.type !== 'node' || target.type !== 'node') continue;
    const list = children.get(source.id) ?? [];
    list.push(target.id);
    children.set(source.id, list);
    childIds.add(target.id);
  }

  const colors = new Map<string, string>();
  const visited = new Set<string>();
  const roots = Object.keys(document.nodes).filter((id) => !childIds.has(id));
  for (const rootId of [...roots, ...Object.keys(document.nodes)]) {
    if (visited.has(rootId)) continue;
    const root = document.nodes[rootId];
    if (!root) continue;
    const pending: Array<{ id: string; depth: number; color: string }> = [{ id: rootId, depth: 0, color: mindMapNodeThemeColor(root) }];
    for (let index = 0; index < pending.length; index += 1) {
      const current = pending[index];
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      colors.set(current.id, current.color);
      for (const childId of children.get(current.id) ?? []) {
        const child = document.nodes[childId];
        if (!child || visited.has(childId)) continue;
        pending.push({
          id: childId,
          depth: current.depth + 1,
          color: current.depth === 0 ? mindMapNodeThemeColor(child) : current.color,
        });
      }
    }
  }
  return colors;
}

export function resolveTreeEdgeColor(edge: MindMapEdge, branchColors: ReadonlyMap<string, string>) {
  if (edge.relationship !== 'tree') return edge.style.color;
  const customColor = edge.style.color.toLowerCase() !== '#9aa3b2';
  return customColor ? edge.style.color : branchColors.get(edgeTargetRef(edge).id) ?? edge.style.color;
}
