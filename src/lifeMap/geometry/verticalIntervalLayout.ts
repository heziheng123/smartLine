export interface VerticalInterval { id: string; start: string; end: string; }
export interface VerticalTrack<T extends VerticalInterval> { item: T; track: number; }
export interface VerticalLane<T extends VerticalInterval> {
  item: T;
  laneIndex: number;
  laneCount: number;
  overlapGroup: number;
}

/** Inclusive date intervals: items sharing a date must never share a track. */
export function assignVerticalIntervalTracks<T extends VerticalInterval>(items: T[]): Array<VerticalTrack<T>> {
  const ends: string[] = [];
  return [...items].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.id.localeCompare(b.id)).map((item) => {
    let track = ends.findIndex((end) => end < item.start);
    if (track < 0) { track = ends.length; ends.push(item.end); } else ends[track] = item.end;
    return { item, track };
  });
}

/**
 * Splits inclusive time intervals into local overlap groups, then assigns the
 * smallest reusable lane within each group. A later non-overlapping group can
 * therefore reclaim the full column width instead of inheriting every lane
 * ever used by the category.
 */
export function assignVerticalIntervalLanes<T extends VerticalInterval>(items: T[]): Array<VerticalLane<T>> {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.id.localeCompare(b.id));
  const groups: T[][] = [];
  let groupEnd = '';

  for (const item of sorted) {
    if (!groups.length || item.start > groupEnd) {
      groups.push([item]);
      groupEnd = item.end;
      continue;
    }
    groups[groups.length - 1].push(item);
    if (item.end > groupEnd) groupEnd = item.end;
  }

  return groups.flatMap((group, overlapGroup) => {
    const laneEnds: string[] = [];
    const assigned = group.map((item) => {
      let laneIndex = laneEnds.findIndex((end) => end < item.start);
      if (laneIndex < 0) {
        laneIndex = laneEnds.length;
        laneEnds.push(item.end);
      } else {
        laneEnds[laneIndex] = item.end;
      }
      return { item, laneIndex };
    });
    const laneCount = laneEnds.length;
    return assigned.map(({ item, laneIndex }) => ({ item, laneIndex, laneCount, overlapGroup }));
  });
}
