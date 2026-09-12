import { removeScopedStorageStores } from '@/utils/persistence';
import { clearRetiredFocusSnapshotData } from '@/services/workspaceBackup';

const RETIRED_STORES = ['focus_data', 'focus_active'];
const REMOTE_CLEANUP_KEY = 'smart-line-retired-focus-r2-v1';

export async function clearRetiredFeatureData(): Promise<void> {
  await removeScopedStorageStores(RETIRED_STORES);
  await clearRetiredFocusSnapshotData();
}

export async function clearRetiredFeatureArchives(accountId: string): Promise<void> {
  const key = `${REMOTE_CLEANUP_KEY}:${accountId}`;
  if (localStorage.getItem(key) === 'done') return;
  const response = await fetch('/api/archives/redact-focus', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) throw new Error('历史归档清理失败。');
  localStorage.setItem(key, 'done');
}
