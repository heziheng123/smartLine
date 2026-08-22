import type { LifeMapNote } from '../types';
import { resolveAnnotationDateSemantics, type AnnotationSemanticKind } from '../annotationSemantics';

export interface AnnotationGroup { id: string; start: string; end: string; kind: AnnotationSemanticKind; notes: LifeMapNote[]; importance: 'normal' | 'important'; track: number; }

function assignAnnotationIntervalTracks<T extends { id: string; start: string; end: string; kind: AnnotationSemanticKind }>(items: T[]) {
  const tracks: Array<{ end: string; kind: AnnotationSemanticKind }> = [];
  return [...items].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.id.localeCompare(b.id)).map((item) => {
    // Annotation endpoints are exact points. Two ranges that only meet at one
    // endpoint may share a rail without their visible strokes overlapping.
    let track = tracks.findIndex((slot) => slot.end < item.start || (slot.end === item.start && slot.kind === 'range' && item.kind === 'range'));
    if (track < 0) { track = tracks.length; tracks.push({ end: item.end, kind: item.kind }); }
    else tracks[track] = { end: item.end, kind: item.kind };
    return { item, track };
  });
}

export function assignAnnotationTracks(notes: LifeMapNote[]): AnnotationGroup[] {
  const grouped = new Map<string, LifeMapNote[]>();
  notes.filter((note) => !note.deletedAt).forEach((note) => {
    const semantics = resolveAnnotationDateSemantics(note);
    const key = `${semantics.kind}:${semantics.start}:${semantics.end}`;
    grouped.set(key, [...(grouped.get(key) ?? []), note]);
  });
  const intervals = [...grouped.entries()].map(([key, entries]) => { const semantics = resolveAnnotationDateSemantics(entries[0]); return { id: key, start: semantics.start, end: semantics.end, kind: semantics.kind, notes: entries, importance: entries.some((item) => item.importance === 'important') ? 'important' as const : 'normal' as const }; });
  return assignAnnotationIntervalTracks(intervals).map(({ item, track }) => ({ ...item, track }));
}
