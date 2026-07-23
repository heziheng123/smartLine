export type AppDomain =
  | 'project'
  | 'daily-schedule'
  | 'week-matrix'
  | 'knowledge-graph'
  | 'ebb'
  | 'undo-history';

/** Machine-readable summary returned by a cross-module command. */
export interface OperationImpact {
  operation: 'create' | 'update' | 'reschedule' | 'complete' | 'archive' | 'delete' | 'record-progress' | 'remove-progress';
  summary: string;
  affectedDomains: AppDomain[];
  changed: boolean;
  undoable: boolean;
}

export function createOperationImpact(
  operation: OperationImpact['operation'],
  summary: string,
  affectedDomains: AppDomain[],
  changed = true,
  undoable = true,
): OperationImpact {
  return { operation, summary, affectedDomains, changed, undoable };
}
