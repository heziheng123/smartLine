export interface WorkspacePeriodArchive<T = unknown> {
  version: 1;
  period: string;
  archivedAt: string;
  data: T;
}

function assertPeriod(period: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('归档月份必须使用 YYYY-MM。');
}

async function fetchArchive(input: RequestInfo | URL, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('历史归档请求超时，请检查网络后重试。');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function saveWorkspacePeriodArchive<T>(period: string, data: T): Promise<void> {
  assertPeriod(period);
  const archive: WorkspacePeriodArchive<T> = { version: 1, period, archivedAt: new Date().toISOString(), data };
  const current = await fetchArchive(`/api/archives/${period}`, {
    method: 'HEAD', credentials: 'same-origin', cache: 'no-store',
  });
  if (current.status !== 404 && !current.ok) {
    throw new Error((await current.json().catch(() => null))?.error || '无法检查云端历史归档版本。');
  }
  const etag = current.headers.get('ETag');
  if (current.ok && !etag) throw new Error('云端历史归档缺少版本标识，已停止覆盖。');
  const response = await fetchArchive(`/api/archives/${period}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }),
    },
    body: JSON.stringify(archive),
  });
  if (response.status === 409) throw new Error('另一台设备刚刚更新了该月归档，请重新加载后再保存。');
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || '历史归档保存失败。');
}

export async function loadWorkspacePeriodArchive<T>(period: string): Promise<WorkspacePeriodArchive<T>> {
  assertPeriod(period);
  let response = await fetchArchive(`/api/archives/${period}`, { credentials: 'same-origin', cache: 'no-store' });
  if (response.status >= 500) {
    response = await fetchArchive(`/api/archives/${period}`, { credentials: 'same-origin', cache: 'no-store' });
  }
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || '历史归档读取失败。');
  return await response.json() as WorkspacePeriodArchive<T>;
}
