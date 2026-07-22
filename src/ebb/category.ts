import { TAG_COLOR_PALETTE } from './constants';
import type { ReviewTask } from './types';
import type { GraphNode } from '@/graph/types';

export type ReviewCategoryKind = 'root' | 'manual' | 'unlinked';

export interface ReviewCategory {
  key: string;
  label: string;
  kind: ReviewCategoryKind;
  rootNodeId?: string;
}

const ROOT_KEY_PREFIX = 'root:';
const MANUAL_KEY_PREFIX = 'manual:';
const UNLINKED_KEY = 'unlinked';
const UNLINKED_COLOR = '#9CA3AF';

/**
 * Resolve every knowledge node to its current root. The mapping is derived
 * from the graph instead of being copied into EBB data, so root renames and
 * hierarchy moves are reflected immediately in every view.
 */
export function buildRootNodeMap(nodes: GraphNode[]): Map<string, GraphNode> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const rootByNodeId = new Map<string, GraphNode>();

  for (const node of nodes) {
    let current = node;
    const visited = new Set<string>([node.id]);
    while (current.parentId) {
      const parent = nodeById.get(current.parentId);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      current = parent;
    }
    rootByNodeId.set(node.id, current);
  }

  return rootByNodeId;
}

/**
 * Graph-linked reviews are categorised by their knowledge-dashboard root.
 * Only standalone/manual EBB content falls back to its manually entered tag.
 */
export function resolveReviewCategory(
  task: Pick<ReviewTask, 'graphNodeId' | 'tag'>,
  rootByNodeId: Map<string, GraphNode>,
): ReviewCategory | null {
  if (task.graphNodeId) {
    const root = rootByNodeId.get(task.graphNodeId);
    if (root) {
      return {
        key: `${ROOT_KEY_PREFIX}${root.id}`,
        label: root.name,
        kind: 'root',
        rootNodeId: root.id,
      };
    }
    return { key: UNLINKED_KEY, label: '未关联知识节点', kind: 'unlinked' };
  }

  const manualTag = task.tag?.trim();
  if (!manualTag) return null;
  return {
    key: `${MANUAL_KEY_PREFIX}${manualTag}`,
    label: manualTag,
    kind: 'manual',
  };
}

function stablePaletteColor(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index++) {
    hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
  }
  return TAG_COLOR_PALETTE[Math.abs(hash) % TAG_COLOR_PALETTE.length];
}

/**
 * New custom colours are keyed by the stable category key. Label lookup is a
 * compatibility fallback for colours saved by older versions.
 */
export function getReviewCategoryColor(
  category: ReviewCategory | null,
  tagColors: Record<string, string>,
): string | undefined {
  if (!category) return undefined;
  if (category.kind === 'unlinked') return UNLINKED_COLOR;
  return tagColors[category.key]
    ?? tagColors[category.label]
    ?? stablePaletteColor(category.key);
}

export function collectReviewCategories(
  tasks: ReviewTask[],
  rootByNodeId: Map<string, GraphNode>,
): ReviewCategory[] {
  const categories = new Map<string, ReviewCategory>();
  for (const task of tasks) {
    if (task.isArchived) continue;
    const category = resolveReviewCategory(task, rootByNodeId);
    if (category && category.kind !== 'unlinked') categories.set(category.key, category);
  }
  return [...categories.values()].sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
}
