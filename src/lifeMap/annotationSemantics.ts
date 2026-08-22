import type { LifeMapNote } from './types';

export type AnnotationSemanticKind = 'single' | 'range';

export interface AnnotationDateSemantics {
  start: string;
  end: string;
  kind: AnnotationSemanticKind;
}

/** Dates are authoritative; `type` is canonicalized from their relationship. */
export function resolveAnnotationDateSemantics(note: Pick<LifeMapNote, 'date' | 'endDate'>): AnnotationDateSemantics {
  const end = note.endDate && note.endDate > note.date ? note.endDate : note.date;
  return { start: note.date, end, kind: end === note.date ? 'single' : 'range' };
}

export function canonicalizeAnnotationDateFields(note: Pick<LifeMapNote, 'date' | 'endDate'>): Pick<LifeMapNote, 'type' | 'endDate'> {
  const semantics = resolveAnnotationDateSemantics(note);
  return semantics.kind === 'single'
    ? { type: 'pin', endDate: undefined }
    : { type: 'range', endDate: semantics.end };
}
