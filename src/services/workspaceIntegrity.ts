import { parseSourceId } from '@/components/dailySchedule/conversion';
import type { WorkspaceBackup } from './workspaceBackup';
import type {
  PendingWorkspaceSync,
  WorkspaceConflictRecord,
} from './workspaceSyncQueueCore';
import { hashWorkspaceBackup, hashWorkspaceValue } from './workspaceSyncCore';

export interface WorkspaceIntegrityIssue {
  path: string;
  type: 'missing-id' | 'duplicate-id' | 'dangling-reference' | 'invalid-shape';
  index?: number;
  entityId?: string;
  valueHash: string;
}

export interface WorkspaceIntegrityReport {
  reportId: string;
  workspaceId: string;
  createdAt: string;
  schemaVersion: 8;
  localRootHash: string;
  remoteRootHash?: string;
  queueWriteId?: string;
  activeConflictIds: string[];
  issues: WorkspaceIntegrityIssue[];
}

export interface WorkspaceIntegrityInput {
  workspaceId: string;
  local: WorkspaceBackup;
  queue?: PendingWorkspaceSync | null;
  emergencyQueue?: PendingWorkspaceSync | null;
  conflicts?: WorkspaceConflictRecord[];
  remoteRoot?: Record<string, unknown>;
  entitySidecar?: Record<string, unknown>;
  reportId?: string;
  createdAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function pushIssue(
  issues: WorkspaceIntegrityIssue[],
  issue: Omit<WorkspaceIntegrityIssue, 'valueHash'>,
  value: unknown,
): Promise<void> {
  issues.push({ ...issue, valueHash: await hashWorkspaceValue(value) });
}

async function inspectTimelineBlocks(
  backup: WorkspaceBackup,
  issues: WorkspaceIntegrityIssue[],
): Promise<void> {
  const blockIdsByTask = new Map<string, Set<string>>();
  for (const [taskIndex, task] of backup.timeline.tasks.entries()) {
    const ids = new Set<string>();
    blockIdsByTask.set(task.id, ids);
    for (const [blockIndex, block] of task.blocks.entries()) {
      const path = 'local.timeline.tasks[' + taskIndex + '].blocks[' + blockIndex + ']';
      if (!isRecord(block)) {
        await pushIssue(issues, { path, type: 'invalid-shape', index: blockIndex }, block);
        continue;
      }
      const id = typeof block.id === 'string' ? block.id.trim() : '';
      if (!id) {
        await pushIssue(issues, { path, type: 'missing-id', index: blockIndex }, block);
      } else if (ids.has(id)) {
        await pushIssue(issues, { path, type: 'duplicate-id', index: blockIndex, entityId: id }, block);
      } else {
        ids.add(id);
      }
    }
  }

  for (const [date, schedule] of Object.entries(backup.daily.schedules)) {
    for (const [index, entry] of [...schedule.items, ...schedule.blocks].entries()) {
      const parsed = parseSourceId(entry.sourceId);
      if (parsed?.source !== 'project' || !parsed.blockId) continue;
      if (blockIdsByTask.get(parsed.parentTaskId)?.has(parsed.blockId)) continue;
      await pushIssue(issues, {
        path: 'local.daily.schedules.' + date + '.entries[' + index + '].sourceId',
        type: 'dangling-reference',
        index,
        entityId: entry.id,
      }, entry.sourceId);
    }
  }
}

async function inspectRemoteShape(
  root: Record<string, unknown> | undefined,
  sidecar: Record<string, unknown> | undefined,
  issues: WorkspaceIntegrityIssue[],
): Promise<void> {
  if (!root) return;
  for (const field of ['tasks', 'groups', 'notes', 'milestones', 'lifeStages']) {
    if (Object.prototype.hasOwnProperty.call(root, field) && !Array.isArray(root[field])) {
      await pushIssue(issues, { path: 'remote.' + field, type: 'invalid-shape' }, root[field]);
    }
  }
  for (const [key, value] of Object.entries(sidecar ?? {})) {
    if (!key.startsWith('workspace-entity:') || !isRecord(value)) {
      await pushIssue(issues, { path: 'remote.entitySidecar.' + key, type: 'invalid-shape' }, value);
    }
  }
}

export async function createWorkspaceIntegrityReport(
  input: WorkspaceIntegrityInput,
): Promise<WorkspaceIntegrityReport> {
  const issues: WorkspaceIntegrityIssue[] = [];
  await inspectTimelineBlocks(input.local, issues);
  await inspectRemoteShape(input.remoteRoot, input.entitySidecar, issues);
  if (input.queue && !isRecord(input.queue.fields)) {
    await pushIssue(issues, { path: 'queue.fields', type: 'invalid-shape' }, input.queue);
  }
  if (input.emergencyQueue && !isRecord(input.emergencyQueue.fields)) {
    await pushIssue(issues, { path: 'emergencyQueue.fields', type: 'invalid-shape' }, input.emergencyQueue);
  }
  return {
    reportId: input.reportId ?? crypto.randomUUID(),
    workspaceId: input.workspaceId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    schemaVersion: 8,
    localRootHash: await hashWorkspaceBackup(input.local),
    ...(input.remoteRoot ? { remoteRootHash: await hashWorkspaceValue(input.remoteRoot) } : {}),
    ...((input.queue ?? input.emergencyQueue)?.writeId
      ? { queueWriteId: (input.queue ?? input.emergencyQueue)?.writeId }
      : {}),
    activeConflictIds: (input.conflicts ?? [])
      .filter((conflict) => conflict.status !== 'resolved')
      .map((conflict) => conflict.id),
    issues,
  };
}
