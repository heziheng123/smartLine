export interface WorkspacePeriodArchive<T = unknown> {
  version: 1;
  period: string;
  archivedAt: string;
  data: T;
}

function assertPeriod(period: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('归档月份必须使用 YYYY-MM。');
}

export async function saveWorkspacePeriodArchive<T>(period: string, data: T): Promise<void> {
  assertPeriod(period);
  const archive: WorkspacePeriodArchive<T> = { version: 1, period, archivedAt: new Date().toISOString(), data };
  const response = await fetch(`/api/archives/${period}`, {
    method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(archive),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || '历史归档保存失败。');
}

export async function loadWorkspacePeriodArchive<T>(period: string): Promise<WorkspacePeriodArchive<T>> {
  assertPeriod(period);
  const response = await fetch(`/api/archives/${period}`, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || '历史归档读取失败。');
  return await response.json() as WorkspacePeriodArchive<T>;
}
