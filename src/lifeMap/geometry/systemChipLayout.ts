export interface SystemChipAnchor {
  id: string;
  anchorDate: string;
}

export interface SystemChipPlacement<T extends SystemChipAnchor> {
  kind: 'system' | 'overflow';
  item?: T;
  date: string;
  anchorY: number;
  top: number;
  overflowCount?: number;
}

const CHIP_HEIGHT = 30;
const CHIP_GAP = 2;
const CLUSTER_GAP = 8;

/**
 * Systems use their own vertical lane. This deliberately never consults
 * project lanes or annotation tracks: visual avoidance stays type-local.
 */
export function layoutSystemChips<T extends SystemChipAnchor>(items: T[], dateToY: (date: string) => number, maxVisible: number | ((date: string) => number) = 3): Array<SystemChipPlacement<T>> {
  const groups = new Map<string, T[]>();
  items.forEach((item) => groups.set(item.anchorDate, [...(groups.get(item.anchorDate) ?? []), item]));
  let previousBottom = -Infinity;
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([date, group]) => {
    const limit = typeof maxVisible === 'function' ? maxVisible(date) : maxVisible;
    const visible = group.slice(0, Math.max(1, limit - (group.length > limit ? 1 : 0)));
    const entries: Array<Pick<SystemChipPlacement<T>, 'kind' | 'item' | 'overflowCount'>> = [
      ...visible.map((item) => ({ kind: 'system' as const, item })),
      ...(group.length > limit ? [{ kind: 'overflow' as const, overflowCount: group.length - visible.length }] : []),
    ];
    const anchorY = dateToY(date);
    const clusterHeight = entries.length * CHIP_HEIGHT + (entries.length - 1) * CHIP_GAP;
    const clusterTop = Math.max(anchorY - clusterHeight / 2, previousBottom + CLUSTER_GAP);
    previousBottom = clusterTop + clusterHeight;
    return entries.map((entry, index) => ({ ...entry, date, anchorY, top: clusterTop + index * (CHIP_HEIGHT + CHIP_GAP) }));
  });
}

export const SYSTEM_CHIP_HEIGHT = CHIP_HEIGHT;
