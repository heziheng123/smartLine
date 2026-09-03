import type { WorkspaceBackup } from '../workspaceBackup.ts';
import { createWorkspaceAuditReport, type WorkspaceAuditReport } from '../workspaceAuditCore.ts';

export type WorkspaceV9PreflightBlockerCode =
  | 'source-schema-unsupported'
  | 'source-audit-blocked'
  | 'integrity-issue'
  | 'active-conflict'
  | 'pending-queue'
  | 'liveblocks-transport-unverified';

export interface WorkspaceV9PreflightBlocker {
  code: WorkspaceV9PreflightBlockerCode;
  count?: number;
}

export interface WorkspaceV9PreflightReport {
  kind: 'smart-line-workspace-v9-preflight';
  version: 1;
  workspaceId: string;
  createdAt: string;
  status: 'ready' | 'blocked';
  canCreateTestRoom: boolean;
  source: {
    schemaVersion: number;
    workspaceHash: string;
    auditStatus: WorkspaceAuditReport['integrity']['status'];
    entityCounts: Record<string, number>;
  };
  blockers: WorkspaceV9PreflightBlocker[];
}

export interface WorkspaceV9PreflightInput {
  workspaceId: string;
  backup: WorkspaceBackup;
  realTransportVerified: boolean;
  integrityIssueCount?: number;
  activeConflictIds?: string[];
  pendingQueueWriteId?: string;
  createdAt?: string;
}

/** Read-only gate for the next v9 test-room phase. It must never create v9 state. */
export async function createWorkspaceV9Preflight(
  input: WorkspaceV9PreflightInput,
): Promise<WorkspaceV9PreflightReport> {
  const audit = await createWorkspaceAuditReport(input.backup);
  const blockers: WorkspaceV9PreflightBlocker[] = [];
  if (input.backup.schemaVersion !== 8) blockers.push({ code: 'source-schema-unsupported' });
  if (audit.integrity.status === 'blocked') blockers.push({ code: 'source-audit-blocked', count: audit.integrity.blockerCount });
  if ((input.integrityIssueCount ?? 0) > 0) blockers.push({ code: 'integrity-issue', count: input.integrityIssueCount });
  if ((input.activeConflictIds?.length ?? 0) > 0) blockers.push({ code: 'active-conflict', count: input.activeConflictIds?.length });
  if (input.pendingQueueWriteId) blockers.push({ code: 'pending-queue' });
  if (!input.realTransportVerified) blockers.push({ code: 'liveblocks-transport-unverified' });

  return {
    kind: 'smart-line-workspace-v9-preflight',
    version: 1,
    workspaceId: input.workspaceId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    status: blockers.length === 0 ? 'ready' : 'blocked',
    canCreateTestRoom: blockers.length === 0,
    source: {
      schemaVersion: input.backup.schemaVersion,
      workspaceHash: audit.workspaceHash,
      auditStatus: audit.integrity.status,
      entityCounts: Object.fromEntries(Object.entries(audit.collections).map(([name, collection]) => [name, collection.count])),
    },
    blockers,
  };
}
