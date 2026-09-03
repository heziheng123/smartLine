import type { WorkspaceBackup } from './workspaceBackup.ts';
import { hashWorkspaceBackup } from './workspaceSyncCore.ts';

export type WorkspaceAuditSeverity = 'info' | 'warning' | 'blocker';

export interface WorkspaceAuditFinding {
  severity: WorkspaceAuditSeverity;
  code: string;
  collection?: string;
  entityId?: string;
  message: string;
}

export interface WorkspaceAuditCollection {
  count: number;
  ids: string[];
  idsHash: string;
  duplicateIds: string[];
  missingIdCount: number;
  largestEntity?: { id: string; bytes: number };
}

export interface WorkspaceAuditSyncState {
  architecture: 'legacy' | 'unified' | 'unknown';
  roomId?: string;
  lastVerifiedAt?: string;
  pendingFieldCount: number;
  pendingFields: string[];
  activeConflictCount: number;
  historicalConflictCount: number;
}

export interface WorkspaceAuditReport {
  kind: 'smart-line-workspace-audit';
  version: 1;
  generatedAt: string;
  source: {
    schemaVersion: number;
    revision: number;
    exportedAt: string;
    deviceId: string;
  };
  integrity: {
    status: 'passed' | 'warning' | 'blocked';
    blockerCount: number;
    warningCount: number;
    findingCount: number;
  };
  workspaceHash: string;
  backupBytes: number;
  collections: Record<string, WorkspaceAuditCollection>;
  findings: WorkspaceAuditFinding[];
  sync: WorkspaceAuditSyncState;
  limits: {
    d1MaximumRowBytes: number;
    auditWarningBytes: number;
  };
}

export interface WorkspaceAuditContext {
  generatedAt?: string;
  validationErrors?: string[];
  validationIssues?: string[];
  sync?: Partial<WorkspaceAuditSyncState>;
}

interface AuditedEntity {
  id?: unknown;
  value: unknown;
}

const D1_MAXIMUM_ROW_BYTES = 2_000_000;
const LARGE_ENTITY_WARNING_BYTES = 500_000;

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? 'null').byteLength;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value) ?? 'null');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function entity(id: unknown, value: unknown): AuditedEntity {
  return { id, value };
}

function collectEntities(backup: WorkspaceBackup): Record<string, AuditedEntity[]> {
  const groupedTasks = backup.timeline.groups.flatMap((group) => group.children);
  const schedules = Object.entries(backup.daily.schedules);
  const retrospectives = Object.entries(backup.daily.retrospectives);
  const allProjects = [...backup.timeline.tasks, ...groupedTasks];

  return {
    'timeline.tasks': backup.timeline.tasks.map((item) => entity(item.id, item)),
    'timeline.groups': backup.timeline.groups.map((item) => entity(item.id, item)),
    'timeline.groupChildren': groupedTasks.map((item) => entity(item.id, item)),
    'timeline.blocks': allProjects.flatMap((task) => task.blocks.map((block) => entity(`${task.id}:${block.id}`, block))),
    'timeline.notes': backup.timeline.notes.map((item) => entity(item.id, item)),
    'timeline.milestones': backup.timeline.milestones.map((item) => entity(item.id, item)),
    'timeline.lifeStages': backup.timeline.lifeStages.map((item) => entity(item.id, item)),
    'lifeMap.areas': backup.lifeMap.lifeMapAreas.map((item) => entity(item.id, item)),
    'lifeMap.planGroups': backup.lifeMap.lifeMapPlanGroups.map((item) => entity(item.id, item)),
    'lifeMap.stages': backup.lifeMap.lifeMapStages.map((item) => entity(item.id, item)),
    'lifeMap.themes': backup.lifeMap.lifeMapThemes.map((item) => entity(item.id, item)),
    'lifeMap.goals': backup.lifeMap.lifeMapGoals.map((item) => entity(item.id, item)),
    'lifeMap.systems': backup.lifeMap.lifeMapSystems.map((item) => entity(item.id, item)),
    'lifeMap.systemCheckIns': backup.lifeMap.lifeMapSystemCheckIns.map((item) => entity(item.id, item)),
    'lifeMap.events': backup.lifeMap.lifeMapEvents.map((item) => entity(item.id, item)),
    'lifeMap.focuses': backup.lifeMap.lifeMapFocuses.map((item) => entity(item.id, item)),
    'lifeMap.notes': backup.lifeMap.lifeMapNotes.map((item) => entity(item.id, item)),
    'lifeMap.reviews': backup.lifeMap.lifeMapReviews.map((item) => entity(item.id, item)),
    'ebb.reviewTasks': backup.ebb.reviewTasks.map((item) => entity(item.id, item)),
    'ebb.inboxItems': backup.ebb.inboxItems.map((item) => entity(item.id, item)),
    'ebb.outlineNodes': backup.ebb.outlineNodes.map((item) => entity(item.id, item)),
    'graph.nodes': backup.graph.nodes.map((item) => entity(item.id, item)),
    'daily.schedules': schedules.map(([date, item]) => entity(date, item)),
    'daily.scheduleEntries': schedules.flatMap(([date, schedule]) => [...schedule.items, ...schedule.blocks].map((item) => entity(`${date}:${item.id}`, item))),
    'daily.retrospectives': retrospectives.map(([date, item]) => entity(date, item)),
    'daily.retrospectiveEntries': retrospectives.flatMap(([date, item]) => item.entries.map((entry) => entity(`${date}:${entry.id}`, entry))),
  };
}

function addMissingReference(
  findings: WorkspaceAuditFinding[],
  collection: string,
  entityId: string,
  referenceName: string,
  referenceId: string,
): void {
  findings.push({
    severity: 'blocker',
    code: 'missing-reference',
    collection,
    entityId,
    message: `${collection} 中的 ${entityId} 引用了不存在的${referenceName}：${referenceId}`,
  });
}

function inspectReferences(backup: WorkspaceBackup, findings: WorkspaceAuditFinding[]): void {
  const graphIds = new Set(backup.graph.nodes.map((item) => item.id));
  const outlineIds = new Set(backup.ebb.outlineNodes.map((item) => item.id));
  const areaIds = new Set(backup.lifeMap.lifeMapAreas.map((item) => item.id));
  const goalIds = new Set(backup.lifeMap.lifeMapGoals.map((item) => item.id));
  const systemIds = new Set(backup.lifeMap.lifeMapSystems.map((item) => item.id));

  for (const node of backup.graph.nodes) {
    if (node.parentId && !graphIds.has(node.parentId)) addMissingReference(findings, 'graph.nodes', node.id, '父节点', node.parentId);
  }
  for (const node of backup.ebb.outlineNodes) {
    if (node.parentId && !outlineIds.has(node.parentId)) addMissingReference(findings, 'ebb.outlineNodes', node.id, '父节点', node.parentId);
    for (const childId of node.childrenIds) {
      if (!outlineIds.has(childId)) addMissingReference(findings, 'ebb.outlineNodes', node.id, '子节点', childId);
    }
  }
  for (const review of backup.ebb.reviewTasks) {
    if (review.graphNodeId && !graphIds.has(review.graphNodeId)) addMissingReference(findings, 'ebb.reviewTasks', review.id, '知识节点', review.graphNodeId);
    if (review.outlineNodeId && !outlineIds.has(review.outlineNodeId)) addMissingReference(findings, 'ebb.reviewTasks', review.id, '大纲节点', review.outlineNodeId);
  }
  for (const task of [...backup.timeline.tasks, ...backup.timeline.groups.flatMap((group) => group.children)]) {
    if (task.lifeMapProjection?.areaId && !areaIds.has(task.lifeMapProjection.areaId)) {
      addMissingReference(findings, 'timeline.tasks', task.id, '人生领域', task.lifeMapProjection.areaId);
    }
    for (const block of task.blocks) {
      if (block.type !== 'smart-task') continue;
      const nodeIds = new Set([...(block.header.graphNodeIds ?? []), ...(block.header.graphNodeId ? [block.header.graphNodeId] : [])]);
      for (const nodeId of nodeIds) {
        if (!graphIds.has(nodeId)) addMissingReference(findings, 'timeline.blocks', block.id, '知识节点', nodeId);
      }
    }
  }
  const areaEntities = [
    ...backup.lifeMap.lifeMapThemes,
    ...backup.lifeMap.lifeMapGoals,
    ...backup.lifeMap.lifeMapSystems,
    ...backup.lifeMap.lifeMapFocuses,
    ...backup.lifeMap.lifeMapNotes,
  ];
  for (const item of areaEntities) {
    if (item.areaId && !areaIds.has(item.areaId)) addMissingReference(findings, 'lifeMap', item.id, '人生领域', item.areaId);
  }
  for (const item of backup.lifeMap.lifeMapSystemCheckIns) {
    if (!systemIds.has(item.systemId)) addMissingReference(findings, 'lifeMap.systemCheckIns', item.id, '长期系统', item.systemId);
  }
  for (const item of backup.lifeMap.lifeMapGoals) {
    if (item.parentGoalId && !goalIds.has(item.parentGoalId)) addMissingReference(findings, 'lifeMap.goals', item.id, '父目标', item.parentGoalId);
  }
  for (const item of backup.lifeMap.lifeMapEvents) {
    if (item.areaId && !areaIds.has(item.areaId)) addMissingReference(findings, 'lifeMap.events', item.id, '人生领域', item.areaId);
    if (item.relatedPlanId && !goalIds.has(item.relatedPlanId)) addMissingReference(findings, 'lifeMap.events', item.id, '关联项目', item.relatedPlanId);
  }
  for (const retrospective of Object.values(backup.daily.retrospectives)) {
    for (const entry of retrospective.entries) {
      for (const nodeId of entry.nodeIds) {
        if (!graphIds.has(nodeId)) addMissingReference(findings, 'daily.retrospectiveEntries', entry.id, '知识节点', nodeId);
      }
    }
  }
}

export async function createWorkspaceAuditReport(
  backup: WorkspaceBackup,
  context: WorkspaceAuditContext = {},
): Promise<WorkspaceAuditReport> {
  const findings: WorkspaceAuditFinding[] = [];
  for (const message of context.validationErrors ?? []) {
    findings.push({ severity: 'blocker', code: 'invalid-backup', message });
  }
  for (const message of context.validationIssues ?? []) {
    findings.push({ severity: 'warning', code: 'health-check', message });
  }

  const collections: Record<string, WorkspaceAuditCollection> = {};
  for (const [name, entities] of Object.entries(collectEntities(backup))) {
    const ids = entities.map((item) => typeof item.id === 'string' ? item.id : '').filter(Boolean).sort();
    const occurrences = new Map<string, number>();
    ids.forEach((id) => occurrences.set(id, (occurrences.get(id) ?? 0) + 1));
    const duplicateIds = [...occurrences].filter(([, count]) => count > 1).map(([id]) => id).sort();
    const sizes = entities.map((item) => ({ id: typeof item.id === 'string' ? item.id : '(missing-id)', bytes: utf8Bytes(item.value) }));
    const largestEntity = sizes.sort((a, b) => b.bytes - a.bytes)[0];
    const missingIdCount = entities.length - ids.length;
    collections[name] = {
      count: entities.length,
      ids,
      idsHash: await sha256(ids),
      duplicateIds,
      missingIdCount,
      ...(largestEntity ? { largestEntity } : {}),
    };
    if (missingIdCount > 0) {
      findings.push({ severity: 'blocker', code: 'missing-id', collection: name, message: `${name} 有 ${missingIdCount} 项缺少稳定 ID。` });
    }
    if (duplicateIds.length > 0) {
      findings.push({ severity: 'blocker', code: 'duplicate-id', collection: name, message: `${name} 存在 ${duplicateIds.length} 个重复 ID。` });
    }
    for (const sized of sizes) {
      if (sized.bytes >= D1_MAXIMUM_ROW_BYTES) {
        findings.push({ severity: 'blocker', code: 'd1-row-limit', collection: name, entityId: sized.id, message: `${name} 的 ${sized.id} 约 ${sized.bytes} 字节，超过 D1 单行 2MB 限制。` });
      } else if (sized.bytes >= LARGE_ENTITY_WARNING_BYTES) {
        findings.push({ severity: 'warning', code: 'large-entity', collection: name, entityId: sized.id, message: `${name} 的 ${sized.id} 约 ${sized.bytes} 字节，迁移前应拆分内容。` });
      }
    }
  }

  inspectReferences(backup, findings);
  const deduplicatedFindings = [...new Map(findings.map((item) => [`${item.severity}:${item.code}:${item.collection ?? ''}:${item.entityId ?? ''}:${item.message}`, item])).values()];
  const sync: WorkspaceAuditSyncState = {
    architecture: context.sync?.architecture ?? 'unknown',
    roomId: context.sync?.roomId,
    lastVerifiedAt: context.sync?.lastVerifiedAt,
    pendingFieldCount: context.sync?.pendingFieldCount ?? 0,
    pendingFields: [...(context.sync?.pendingFields ?? [])].sort(),
    activeConflictCount: context.sync?.activeConflictCount ?? 0,
    historicalConflictCount: context.sync?.historicalConflictCount ?? 0,
  };
  if (sync.pendingFieldCount > 0) {
    deduplicatedFindings.push({ severity: 'warning', code: 'pending-sync', message: `当前设备仍有 ${sync.pendingFieldCount} 个字段等待补传。` });
  }
  if (sync.activeConflictCount > 0) {
    deduplicatedFindings.push({ severity: 'blocker', code: 'active-conflict', message: `当前设备仍有 ${sync.activeConflictCount} 个同步分支等待自动归档。` });
  }

  const finalBlockerCount = deduplicatedFindings.filter((item) => item.severity === 'blocker').length;
  const finalWarningCount = deduplicatedFindings.filter((item) => item.severity === 'warning').length;
  return {
    kind: 'smart-line-workspace-audit',
    version: 1,
    generatedAt: context.generatedAt ?? new Date().toISOString(),
    source: {
      schemaVersion: backup.schemaVersion,
      revision: backup.revision,
      exportedAt: backup.exportedAt,
      deviceId: backup.deviceId,
    },
    integrity: {
      status: finalBlockerCount > 0 ? 'blocked' : finalWarningCount > 0 ? 'warning' : 'passed',
      blockerCount: finalBlockerCount,
      warningCount: finalWarningCount,
      findingCount: deduplicatedFindings.length,
    },
    workspaceHash: await hashWorkspaceBackup(backup),
    backupBytes: utf8Bytes(backup),
    collections,
    findings: deduplicatedFindings,
    sync,
    limits: {
      d1MaximumRowBytes: D1_MAXIMUM_ROW_BYTES,
      auditWarningBytes: LARGE_ENTITY_WARNING_BYTES,
    },
  };
}
