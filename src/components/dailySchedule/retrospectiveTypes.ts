export type RetrospectiveStatus = 'draft' | 'completed';

export type RetrospectiveSourceType =
  | 'project'
  | 'review'
  | 'quantity'
  | 'vocabulary'
  | 'free';

export type RetrospectiveCategory = 'insight' | 'problem' | 'next-action';

export interface RetrospectiveReflection {
  /** One concise task-level note. A sentence is enough. */
  content: string;
}

export interface RetrospectiveNodeSnapshot {
  id: string;
  name: string;
}

export interface RetrospectiveEntry {
  /** Stable identity for one completed activity on one day. */
  id: string;
  sourceId: string;
  sourceType: RetrospectiveSourceType;
  title: string;
  projectName?: string;
  taskId?: string;
  blockId?: string;
  reviewTaskId?: string;
  completedDate: string;
  completionSource?: 'manual' | 'project-task';
  linkedProjectSourceId?: string;
  round?: number;
  totalRounds?: number;
  /** Present when this completed old round was archived by a relearn restart. */
  restartedNextDueDate?: string;
  quantityActual?: number;
  quantityCompleted?: number;
  quantityTotal?: number;
  quantityUnit?: string;
  nodeIds: string[];
  nodeSnapshots: RetrospectiveNodeSnapshot[];
  /** Optional labels used by the knowledge-dashboard filters without adding more text inputs. */
  categories: RetrospectiveCategory[];
  /** Historical entries remain stored when their source is no longer completed. */
  completionStatusChanged: boolean;
  reflection: RetrospectiveReflection;
  updatedAt: string;
}

export interface RetrospectiveOverall {
  summary: string;
}

export interface DailyRetrospective {
  id: string;
  date: string;
  status: RetrospectiveStatus;
  entries: RetrospectiveEntry[];
  overall: RetrospectiveOverall;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
}

export interface CompletedActivity {
  id: string;
  sourceId: string;
  sourceType: RetrospectiveSourceType;
  title: string;
  projectName?: string;
  taskId?: string;
  blockId?: string;
  reviewTaskId?: string;
  completedDate: string;
  completionSource?: 'manual' | 'project-task';
  linkedProjectSourceId?: string;
  round?: number;
  totalRounds?: number;
  restartedNextDueDate?: string;
  quantityActual?: number;
  quantityCompleted?: number;
  quantityTotal?: number;
  quantityUnit?: string;
  nodeIds: string[];
  nodeSnapshots: RetrospectiveNodeSnapshot[];
}

export const EMPTY_REFLECTION: RetrospectiveReflection = {
  content: '',
};

export const EMPTY_OVERALL: RetrospectiveOverall = {
  summary: '',
};
