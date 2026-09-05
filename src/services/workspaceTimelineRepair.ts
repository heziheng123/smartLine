import { persistTimelineData, useTimelineStore } from '@/store';
import type { Block } from '@/types';
import type { WorkspaceBackup } from './workspaceBackup';
import { hashWorkspaceValue, workspaceValuesEqual } from './workspaceSyncCore';
import { createScopedStorage, setScopedStorageItemsAtomically } from '@/utils/persistence';
import { runWorkspaceMutationWithOrigin } from './workspaceMutationOrigin';
import {
  buildWorkspaceRepairManifest,
  persistWorkspaceRepairManifest,
  readWorkspaceRepairManifest,
  verifyWorkspaceRepairManifest,
  type WorkspaceRepairManifest,
} from './workspaceRepairSafety';
import {
  readWorkspaceQueueSafetySnapshot,
  type PendingWorkspaceSync,
} from './workspaceSyncQueueCore';
import { extractWorkspaceEntitySidecar } from './workspaceEntityStorage';

export interface TimelineBlockRepairAssignment {
  sourceIndex: number;
  ownerPath: string;
  taskId: string;
  oldId: string | null;
  newId: string;
  action: 'keep' | 'assign-missing' | 'split-duplicate' | 'archive-identical-copy';
  valueHash: string;
}

export interface TimelineBlocksRepairPlan {
  repairId: string;
  sourceHash: string;
  createdAt: string;
  assignments: TimelineBlockRepairAssignment[];
  referencePatches: Array<{
    ownerPath: string;
    property: string;
    fromId: string;
    toId: string;
  }>;
  warnings: Array<{ type: 'ambiguous-reference'; taskId: string; blockId: string }>;
}

export interface TimelineBlockRepairHistoryEntry {
  repairId: string;
  sourceIndex: number;
  ownerPath: string;
  originalValue: unknown;
  originalHash: string;
  archivedAt: string;
  reason: 'identical-duplicate';
}

export interface TimelineBlocksRepairResult {
  backup: WorkspaceBackup;
  history: TimelineBlockRepairHistoryEntry[];
  plan: TimelineBlocksRepairPlan;
  resultHash: string;
}

interface PlanOptions {
  repairId?: string;
  createdAt?: string;
  createId?: () => string;
  existingPlan?: TimelineBlocksRepairPlan;
}

export interface PreparedTimelineBlocksRepair {
  manifest: WorkspaceRepairManifest;
  plan: TimelineBlocksRepairPlan;
  pendingAtRepair: PendingWorkspaceSync | null;
}

export interface TimelineBlocksRepairUpload {
  repairId: string;
  resultHash: string;
  payloadHash: string;
  baseFields: Pick<WorkspaceBackup['timeline'], 'tasks' | 'groups'>;
  fields: Pick<WorkspaceBackup['timeline'], 'tasks' | 'groups'>;
  pendingAtRepair: PendingWorkspaceSync | null;
}

export interface TimelineBlocksRepairReceipt {
  repairId: string;
  sourceHash: string;
  resultHash: string;
  fieldsHash: string;
  historyCount: number;
  appliedAt: string;
  status: 'local-applied' | 'confirmed';
  remoteHash?: string;
  remoteFieldsHash?: string;
  confirmedAt?: string;
}

export async function confirmTimelineBlocksRepair(
  repairId: string,
  remoteHash: string,
  remoteFieldsHash: string,
  confirmedAt = new Date().toISOString(),
): Promise<void> {
  const key = 'receipt:' + repairId;
  const receipt = await repairStorage.getItem<TimelineBlocksRepairReceipt>(key);
  const upload = await readTimelineBlocksRepairUpload(repairId);
  if (!receipt
    || receipt.repairId !== repairId
    || receipt.resultHash !== remoteHash
    || receipt.fieldsHash !== remoteFieldsHash
    || await hashWorkspaceValue(upload.fields) !== remoteFieldsHash) {
    throw new Error('Timeline repair receipt 与云端回读 hash 不匹配。');
  }
  await repairStorage.setItem(key, {
    ...receipt,
    status: 'confirmed',
    remoteHash,
    remoteFieldsHash,
    confirmedAt,
  });
}

const repairStorage = createScopedStorage('workspace_repairs');

interface BlockLocation {
  sourceIndex: number;
  taskId: string;
  ownerPath: string;
  block: Record<string, unknown>;
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

function blockLocations(backup: WorkspaceBackup): BlockLocation[] {
  let sourceIndex = 0;
  return backup.timeline.tasks.flatMap((task, taskIndex) => task.blocks.map((block, blockIndex) => ({
    sourceIndex: sourceIndex++,
    taskId: task.id,
    ownerPath: `timeline.tasks[${taskIndex}].blocks[${blockIndex}]`,
    block: block as unknown as Record<string, unknown>,
  })));
}

function validBlockId(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= 256
    && ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
}

async function sourceHash(backup: WorkspaceBackup): Promise<string> {
  return await hashWorkspaceValue(blockLocations(backup).map(({ taskId, block }) => ({ taskId, block })));
}

export async function createTimelineBlocksRepairPlan(
  backup: WorkspaceBackup,
  options: PlanOptions = {},
): Promise<TimelineBlocksRepairPlan> {
  const currentSourceHash = await sourceHash(backup);
  if (options.existingPlan) {
    if (options.existingPlan.sourceHash !== currentSourceHash) {
      throw new Error('Persisted RepairPlan sourceHash no longer matches timeline.blocks.');
    }
    return options.existingPlan;
  }

  const createId = options.createId ?? (() => crypto.randomUUID());
  const firstByTaskAndId = new Map<string, Record<string, unknown>>();
  const duplicateIds = new Set<string>();
  const assignments: TimelineBlockRepairAssignment[] = [];
  for (const location of blockLocations(backup)) {
    const oldId = validBlockId(location.block.id) ? location.block.id : null;
    const key = oldId ? `${location.taskId}\u0000${oldId}` : '';
    const first = oldId ? firstByTaskAndId.get(key) : undefined;
    let action: TimelineBlockRepairAssignment['action'] = 'keep';
    let newId = oldId ?? createId();
    if (!oldId) action = 'assign-missing';
    else if (!first) firstByTaskAndId.set(key, location.block);
    else {
      duplicateIds.add(key);
      action = workspaceValuesEqual(first, location.block) ? 'archive-identical-copy' : 'split-duplicate';
      if (action === 'split-duplicate') newId = createId();
    }
    assignments.push({
      sourceIndex: location.sourceIndex,
      ownerPath: location.ownerPath,
      taskId: location.taskId,
      oldId,
      newId,
      action,
      valueHash: await hashWorkspaceValue(location.block),
    });
  }

  return {
    repairId: options.repairId ?? crypto.randomUUID(),
    sourceHash: currentSourceHash,
    createdAt: options.createdAt ?? new Date().toISOString(),
    assignments,
    referencePatches: [],
    warnings: [...duplicateIds].map((key) => {
      const separator = key.indexOf('\u0000');
      return { type: 'ambiguous-reference' as const, taskId: key.slice(0, separator), blockId: key.slice(separator + 1) };
    }),
  };
}

export async function applyTimelineBlocksRepairPlan(
  source: WorkspaceBackup,
  plan: TimelineBlocksRepairPlan,
): Promise<TimelineBlocksRepairResult> {
  if (await sourceHash(source) !== plan.sourceHash) {
    throw new Error('RepairPlan sourceHash does not match current timeline.blocks; create a new plan.');
  }
  const assignments = new Map(plan.assignments.map((assignment) => [assignment.sourceIndex, assignment]));
  const backup = clone(source);
  const history: TimelineBlockRepairHistoryEntry[] = [];
  let sourceIndex = 0;
  backup.timeline.tasks = backup.timeline.tasks.map((task, taskIndex) => ({
    ...task,
    blocks: task.blocks.flatMap((block, blockIndex) => {
      const assignment = assignments.get(sourceIndex++);
      if (!assignment
        || assignment.ownerPath !== `timeline.tasks[${taskIndex}].blocks[${blockIndex}]`
        || assignment.oldId !== (validBlockId((block as unknown as Record<string, unknown>).id) ? block.id : null)) {
        throw new Error('RepairPlan assignment does not match current timeline.blocks.');
      }
      if (assignment.action === 'archive-identical-copy') {
        history.push({
          repairId: plan.repairId,
          sourceIndex: assignment.sourceIndex,
          ownerPath: assignment.ownerPath,
          originalValue: clone(block),
          originalHash: assignment.valueHash,
          archivedAt: plan.createdAt,
          reason: 'identical-duplicate',
        });
        return [];
      }
      return [{ ...block, id: assignment.newId } as Block];
    }),
  }));
  if (sourceIndex !== plan.assignments.length) throw new Error('RepairPlan assignment count is invalid.');

  const tasksById = new Map(backup.timeline.tasks.map((task) => [task.id, task]));
  backup.timeline.groups = backup.timeline.groups.map((group) => ({
    ...group,
    children: group.children.map((child) => tasksById.get(child.id) ?? child),
  }));

  for (const task of backup.timeline.tasks) {
    const ids = task.blocks.map((block) => block.id);
    if (ids.some((id) => !validBlockId(id)) || ids.length !== new Set(ids).size) {
      throw new Error(`RepairPlan did not produce unique non-empty IDs for task ${task.id}.`);
    }
  }
  const result: TimelineBlocksRepairResult = {
    backup,
    history,
    plan,
    resultHash: await hashWorkspaceValue(backup.timeline.tasks.map((task) => ({ id: task.id, blocks: task.blocks }))),
  };
  if (!await verifyTimelineBlocksConservation(source, result)) {
    throw new Error('RepairPlan conservation check failed.');
  }
  return result;
}

function contentWithoutId(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const copy = clone(value as Record<string, unknown>);
  delete copy.id;
  return copy;
}

export async function verifyTimelineBlocksConservation(
  before: WorkspaceBackup,
  result: TimelineBlocksRepairResult,
): Promise<boolean> {
  const beforeHashes = await Promise.all(blockLocations(before).map(({ taskId, block }) =>
    hashWorkspaceValue({ taskId, value: contentWithoutId(block) })));
  const currentHashes = await Promise.all(blockLocations(result.backup).map(({ taskId, block }) =>
    hashWorkspaceValue({ taskId, value: contentWithoutId(block) })));
  const archivedHashes = await Promise.all(result.history.map((entry) => {
    const assignment = result.plan.assignments.find((item) => item.sourceIndex === entry.sourceIndex);
    return hashWorkspaceValue({ taskId: assignment?.taskId, value: contentWithoutId(entry.originalValue) });
  }));
  return beforeHashes.sort().join('\n') === [...currentHashes, ...archivedHashes].sort().join('\n');
}

export function timelineBlocksNeedRepair(plan: TimelineBlocksRepairPlan): boolean {
  return plan.assignments.some((assignment) => assignment.action !== 'keep');
}

export async function prepareTimelineBlocksRepair(input: {
  workspaceId: string;
  local: WorkspaceBackup;
  remoteRoot: Record<string, unknown>;
}): Promise<PreparedTimelineBlocksRepair> {
  const repairId = crypto.randomUUID();
  const queues = await readWorkspaceQueueSafetySnapshot();
  const manifest = await buildWorkspaceRepairManifest({
    repairId,
    workspaceId: input.workspaceId,
    local: input.local,
    queue: queues.durablePending,
    emergencyQueue: queues.emergencyPending,
    conflicts: queues.conflicts,
    remoteRoot: input.remoteRoot,
    entitySidecar: extractWorkspaceEntitySidecar(input.remoteRoot),
  });
  await persistWorkspaceRepairManifest(manifest);
  const plan = await createTimelineBlocksRepairPlan(input.local, { repairId });
  await repairStorage.setItem('plan:' + repairId, plan);
  const stored = await repairStorage.getItem<TimelineBlocksRepairPlan>('plan:' + repairId);
  if (!stored || !workspaceValuesEqual(stored, plan)) {
    throw new Error('Timeline RepairPlan 未能持久化并回读确认。');
  }
  return {
    manifest,
    plan,
    pendingAtRepair: queues.emergencyPending ?? queues.durablePending,
  };
}

async function buildTimelineBlocksRepairUpload(
  source: WorkspaceBackup,
  result: TimelineBlocksRepairResult,
  pendingAtRepair: PendingWorkspaceSync | null,
): Promise<TimelineBlocksRepairUpload> {
  const payload = {
    baseFields: { tasks: clone(source.timeline.tasks), groups: clone(source.timeline.groups) },
    fields: { tasks: clone(result.backup.timeline.tasks), groups: clone(result.backup.timeline.groups) },
    pendingAtRepair: clone(pendingAtRepair),
  };
  return {
    repairId: result.plan.repairId,
    resultHash: result.resultHash,
    payloadHash: await hashWorkspaceValue(payload),
    ...payload,
  };
}

export async function readTimelineBlocksRepairUpload(repairId: string): Promise<TimelineBlocksRepairUpload> {
  const upload = await repairStorage.getItem<TimelineBlocksRepairUpload>('upload:' + repairId);
  if (!upload || upload.repairId !== repairId) throw new Error('Timeline repair 上传任务缺失。');
  const payloadHash = await hashWorkspaceValue({
    baseFields: upload.baseFields,
    fields: upload.fields,
    pendingAtRepair: upload.pendingAtRepair,
  });
  if (payloadHash !== upload.payloadHash) throw new Error('Timeline repair 上传任务 hash 不匹配。');
  return upload;
}

export async function listPendingTimelineBlocksRepairUploads(): Promise<TimelineBlocksRepairUpload[]> {
  const keys = await repairStorage.keys();
  const receipts = await Promise.all(keys
    .filter((key) => key.startsWith('receipt:'))
    .map((key) => repairStorage.getItem<TimelineBlocksRepairReceipt>(key)));
  return await Promise.all(receipts
    .filter((receipt): receipt is TimelineBlocksRepairReceipt => receipt?.status === 'local-applied')
    .map((receipt) => readTimelineBlocksRepairUpload(receipt.repairId)));
}

export async function executePreparedTimelineBlocksRepair(
  source: WorkspaceBackup,
  prepared: PreparedTimelineBlocksRepair,
): Promise<TimelineBlocksRepairResult> {
  const storedManifest = await readWorkspaceRepairManifest(prepared.plan.repairId);
  if (!storedManifest
    || !await verifyWorkspaceRepairManifest(storedManifest)
    || !workspaceValuesEqual(storedManifest, prepared.manifest)
    || storedManifest.parts.local.sha256 !== await hashWorkspaceValue(source)) {
    throw new Error('修复前完整快照门禁失败，已停止 timeline.blocks 修复。');
  }
  const storedPlan = await repairStorage.getItem<TimelineBlocksRepairPlan>('plan:' + prepared.plan.repairId);
  if (!storedPlan || !workspaceValuesEqual(storedPlan, prepared.plan)) {
    throw new Error('持久化 RepairPlan 与待执行计划不一致。');
  }

  const result = await applyTimelineBlocksRepairPlan(source, storedPlan);
  const upload = await buildTimelineBlocksRepairUpload(source, result, prepared.pendingAtRepair);
  const receipt: TimelineBlocksRepairReceipt = {
    repairId: storedPlan.repairId,
    sourceHash: storedPlan.sourceHash,
    resultHash: result.resultHash,
    fieldsHash: await hashWorkspaceValue(upload.fields),
    historyCount: result.history.length,
    appliedAt: new Date().toISOString(),
    status: 'local-applied',
  };
  // Drain any older coalesced write before the repair transaction becomes authoritative.
  await persistTimelineData(source.timeline);
  await setScopedStorageItemsAtomically([
    { storeName: 'timeline_data', key: 'smart-timeline-data', value: result.backup.timeline },
    { storeName: 'workspace_repairs', key: 'history:' + storedPlan.repairId, value: result.history },
    { storeName: 'workspace_repairs', key: 'upload:' + storedPlan.repairId, value: upload },
    { storeName: 'workspace_repairs', key: 'receipt:' + storedPlan.repairId, value: receipt },
  ]);
  runWorkspaceMutationWithOrigin('repair', () => {
    useTimelineStore.setState({
      tasks: result.backup.timeline.tasks,
      groups: result.backup.timeline.groups,
    });
  });
  return result;
}
