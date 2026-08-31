import type { WorkspaceBackup } from './workspaceBackup';
import { hashWorkspaceBackup } from './workspaceSyncCore';

export interface WorkspaceDailyHistory {
  version: 1;
  date: string;
  savedAt: string;
  hash: string;
  backup: WorkspaceBackup;
}

const attemptedDates = new Set<string>();

export function currentWorkspaceHistoryDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function assertDate(date: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date)) throw new Error('历史日期必须使用 YYYY-MM-DD。');
}

async function requestHistory(date: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(`/api/workspace-history/${date}`, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('云端工作区历史请求超时。');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function saveWorkspaceDailyHistory(
  backup: WorkspaceBackup,
  date = currentWorkspaceHistoryDate(),
): Promise<void> {
  assertDate(date);
  const current = await requestHistory(date, { method: 'HEAD' });
  if (current.status !== 404 && !current.ok) {
    throw new Error((await current.json().catch(() => null))?.error || '无法检查云端工作区历史版本。');
  }
  const etag = current.headers.get('ETag');
  if (current.ok && !etag) throw new Error('云端工作区历史缺少版本标识，已停止覆盖。');
  const history: WorkspaceDailyHistory = {
    version: 1,
    date,
    savedAt: new Date().toISOString(),
    hash: await hashWorkspaceBackup(backup),
    backup,
  };
  const response = await requestHistory(date, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }),
    },
    body: JSON.stringify(history),
  });
  if (response.status === 409) throw new Error('另一台设备刚刚更新了今天的工作区历史，请重试。');
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || '保存云端工作区历史失败。');
}

export async function saveWorkspaceDailyHistoryOnce(backup: WorkspaceBackup): Promise<void> {
  const date = currentWorkspaceHistoryDate();
  if (attemptedDates.has(date)) return;
  attemptedDates.add(date);
  await saveWorkspaceDailyHistory(backup, date);
}

export async function loadWorkspaceDailyHistory(date: string): Promise<WorkspaceDailyHistory> {
  assertDate(date);
  const response = await requestHistory(date, {});
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || '读取云端工作区历史失败。');
  return await response.json() as WorkspaceDailyHistory;
}

