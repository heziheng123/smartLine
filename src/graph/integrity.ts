import type { GraphNode } from './types';

export function inspectGraphNodes(nodes: GraphNode[], selectedId?: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node.id);
    children.set(node.parentId, siblings);
  }
  const walk = (starts: string[]) => {
    const seen = new Set<string>();
    const stack = [...starts];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id) || !byId.has(id)) continue;
      seen.add(id);
      stack.push(...children.get(id) ?? []);
    }
    return seen;
  };
  const roots = nodes.filter((node) => !node.parentId);
  const cycleIds = new Set<string>();
  for (const node of nodes) {
    const chain: string[] = [];
    const seenAt = new Map<string, number>();
    let current: GraphNode | undefined = node;
    while (current) {
      const start = seenAt.get(current.id);
      if (start !== undefined) {
        chain.slice(start).forEach((id) => cycleIds.add(id));
        break;
      }
      seenAt.set(current.id, chain.length);
      chain.push(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return {
    totalNodes: nodes.length,
    uniqueIds: byId.size,
    duplicateIds: nodes.length - byId.size,
    rootNodes: roots.length,
    nodesWithParent: nodes.length - roots.length,
    missingParentNodes: nodes.filter((node) => node.parentId && !byId.has(node.parentId)).length,
    cycleNodes: cycleIds.size,
    unreachableNodes: nodes.length - walk(roots.map((node) => node.id)).size,
    directChildren: selectedId ? children.get(selectedId)?.length ?? 0 : 0,
    reachableNodes: selectedId ? walk([selectedId]).size : 0,
  };
}
