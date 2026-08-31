import { createWorkspaceBackup, validateWorkspaceBackup } from './workspaceBackup';
import { readWorkspaceSyncSettings } from './workspaceSync';
import { listWorkspaceConflicts, readPendingWorkspaceSync } from './workspaceOfflineQueue';
import { createWorkspaceAuditReport, type WorkspaceAuditReport } from './workspaceAuditCore';

interface LastConnectedRecord {
  workspace?: string;
  workspaceRoomId?: string;
}

function readLastConnected(): LastConnectedRecord {
  try {
    return JSON.parse(localStorage.getItem('smart-line-sync-last-connected') ?? '{}') as LastConnectedRecord;
  } catch {
    return {};
  }
}

export async function createCurrentWorkspaceAuditReport(): Promise<WorkspaceAuditReport> {
  const backup = createWorkspaceBackup();
  const validation = validateWorkspaceBackup(backup);
  const [pending, conflicts] = await Promise.all([
    readPendingWorkspaceSync(),
    listWorkspaceConflicts(),
  ]);
  const architecture = readWorkspaceSyncSettings();
  const lastConnected = readLastConnected();
  const historicalConflicts = conflicts.filter((item) => item.status === 'resolved');
  const activeConflicts = conflicts.filter((item) => item.status !== 'resolved');

  return await createWorkspaceAuditReport(backup, {
    validationErrors: validation.errors,
    validationIssues: validation.summary?.issues,
    sync: {
      architecture: architecture.architecture,
      roomId: architecture.unifiedRoomId ?? lastConnected.workspaceRoomId,
      lastVerifiedAt: lastConnected.workspace,
      pendingFieldCount: Object.keys(pending?.fields ?? {}).length,
      pendingFields: Object.keys(pending?.fields ?? {}),
      activeConflictCount: activeConflicts.length,
      historicalConflictCount: historicalConflicts.length,
    },
  });
}

export async function downloadCurrentWorkspaceAuditReport(): Promise<WorkspaceAuditReport> {
  const report = await createCurrentWorkspaceAuditReport();
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `smart-line-audit-${report.source.deviceId.slice(0, 8)}-${report.generatedAt.replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return report;
}
