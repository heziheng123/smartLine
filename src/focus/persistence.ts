import { createScopedStorage, mutateScopedStorageItemsAtomically } from '@/utils/persistence';
import { mergeWorkspaceFieldChanges } from '@/services/workspaceSyncCore';
import type { ActiveFocusSession, FocusData, FocusSession } from './types';
import { assertValidActiveFocusSession, assertValidFocusSession, assertValidFocusSubject, validateFocusWeeklyReview } from './validation';

const FOCUS_DATA_STORE = 'focus_data';
const FOCUS_ACTIVE_STORE = 'focus_active';
const FOCUS_DATA_KEY = 'data';
export const ACTIVE_FOCUS_SESSION_KEY = 'active-focus-session';

const focusDataStorage = createScopedStorage(FOCUS_DATA_STORE);
const focusActiveStorage = createScopedStorage(FOCUS_ACTIVE_STORE);

export function currentFocusWorkspaceId(): string {
  try {
    const value = JSON.parse(localStorage.getItem('smart-line-sync-architecture-v1') ?? 'null') as { unifiedRoomId?: unknown } | null;
    return typeof value?.unifiedRoomId === 'string' && value.unifiedRoomId ? value.unifiedRoomId : 'local';
  } catch {
    return 'local';
  }
}

export function createEmptyFocusData(): FocusData {
  return { focusSubjects: [], focusSessions: [], focusWeeklyReviews: [] };
}

export function normalizeFocusData(value: unknown): FocusData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createEmptyFocusData();
  const source = value as Partial<FocusData>;
  const subjects = Array.isArray(source.focusSubjects) ? source.focusSubjects : [];
  const sessions = Array.isArray(source.focusSessions) ? source.focusSessions : [];
  const weeklyReviews = Array.isArray(source.focusWeeklyReviews) ? source.focusWeeklyReviews : [];
  const subjectIds = new Set<string>();
  const sessionIds = new Set<string>();
  for (const subject of subjects) {
    assertValidFocusSubject(subject);
    if (subjectIds.has(subject.id)) throw new Error(`专注主题 ID 重复：${subject.id}`);
    subjectIds.add(subject.id);
  }
  for (const session of sessions) {
    assertValidFocusSession(session);
    if (sessionIds.has(session.id)) throw new Error(`专注记录 ID 重复：${session.id}`);
    sessionIds.add(session.id);
  }
  const reviewWeeks = new Set<string>();
  for (const review of weeklyReviews) {
    const errors = validateFocusWeeklyReview(review);
    if (errors.length) throw new Error(errors.join(' '));
    if (reviewWeeks.has(review.weekStart)) throw new Error(`周度复盘周起始日期重复：${review.weekStart}`);
    reviewWeeks.add(review.weekStart);
  }
  return { focusSubjects: [...subjects], focusSessions: [...sessions], focusWeeklyReviews: [...weeklyReviews] };
}

export async function loadFocusData(): Promise<FocusData> {
  return normalizeFocusData(await focusDataStorage.getItem<unknown>(FOCUS_DATA_KEY));
}

export async function persistFocusData(value: FocusData, base?: FocusData): Promise<FocusData> {
  const data = normalizeFocusData(value);
  if (!base) {
    await focusDataStorage.setItem(FOCUS_DATA_KEY, data);
    return data;
  }
  const normalizedBase = normalizeFocusData(base);
  return await mutateScopedStorageItemsAtomically(
    [{ storeName: FOCUS_DATA_STORE, key: FOCUS_DATA_KEY }],
    ([currentValue]) => {
      const current = normalizeFocusData(currentValue);
      const merged = mergeWorkspaceFieldChanges(
        data as unknown as Record<string, unknown>,
        normalizedBase as unknown as Record<string, unknown>,
        current as unknown as Record<string, unknown>,
      );
      if (merged.conflicts.length > 0) {
        throw new Error('专注数据已被其他标签页修改，请刷新后重试。');
      }
      const next = normalizeFocusData(merged.fields);
      return {
        result: next,
        writes: [{ storeName: FOCUS_DATA_STORE, key: FOCUS_DATA_KEY, value: next }],
      };
    },
  );
}

export async function loadActiveFocusSession(): Promise<ActiveFocusSession | null> {
  const value = await focusActiveStorage.getItem<unknown>(ACTIVE_FOCUS_SESSION_KEY);
  if (value === null || value === undefined) return null;
  assertValidActiveFocusSession(value as ActiveFocusSession);
  return value as ActiveFocusSession;
}

export async function assertNoActiveFocusSessionForWorkspace(workspaceId = currentFocusWorkspaceId()): Promise<void> {
  const active = await loadActiveFocusSession();
  if (active?.workspaceId === workspaceId) {
    throw new Error('当前工作区存在未结束的专注会话。请先保存并结束或放弃本次专注。');
  }
}

export async function createActiveFocusSessionAtomically(active: ActiveFocusSession): Promise<void> {
  assertValidActiveFocusSession(active);
  await mutateScopedStorageItemsAtomically(
    [{ storeName: FOCUS_ACTIVE_STORE, key: ACTIVE_FOCUS_SESSION_KEY }],
    ([current]) => {
      if (current !== undefined && current !== null) throw new Error('已有未结束的专注会话，请先处理当前会话。');
      return {
        result: undefined,
        writes: [{ storeName: FOCUS_ACTIVE_STORE, key: ACTIVE_FOCUS_SESSION_KEY, value: active }],
      };
    },
  );
}

export async function persistActiveFocusSession(
  active: ActiveFocusSession,
  expected?: ActiveFocusSession,
): Promise<void> {
  assertValidActiveFocusSession(active);
  await mutateScopedStorageItemsAtomically(
    [{ storeName: FOCUS_ACTIVE_STORE, key: ACTIVE_FOCUS_SESSION_KEY }],
    ([current]) => {
      const stored = current as Partial<ActiveFocusSession> | null;
      if (!stored || stored.sessionId !== active.sessionId
        || (expected !== undefined && JSON.stringify(stored) !== JSON.stringify(expected))) {
        throw new Error('当前活跃专注会话已被其他标签页更新，请重试。');
      }
      return {
        result: undefined,
        writes: [{ storeName: FOCUS_ACTIVE_STORE, key: ACTIVE_FOCUS_SESSION_KEY, value: active }],
      };
    },
  );
}

export async function discardActiveFocusSession(sessionId: string): Promise<void> {
  await mutateScopedStorageItemsAtomically(
    [{ storeName: FOCUS_ACTIVE_STORE, key: ACTIVE_FOCUS_SESSION_KEY }],
    ([current]) => {
      const stored = current as Partial<ActiveFocusSession> | null;
      if (!stored || stored.sessionId !== sessionId) throw new Error('当前活跃专注会话已被其他标签页处理。');
      return {
        result: undefined,
        writes: [{ storeName: FOCUS_ACTIVE_STORE, key: ACTIVE_FOCUS_SESSION_KEY, value: undefined, remove: true }],
      };
    },
  );
}

export async function finalizeActiveFocusSessionAtomically(
  session: FocusSession,
  workspaceId: string,
): Promise<FocusData> {
  assertValidFocusSession(session);
  if (currentFocusWorkspaceId() !== workspaceId) {
    throw new Error('当前工作区已变化。请返回开始计时时的工作区后再保存。');
  }
  return await mutateScopedStorageItemsAtomically(
    [
      { storeName: FOCUS_ACTIVE_STORE, key: ACTIVE_FOCUS_SESSION_KEY },
      { storeName: FOCUS_DATA_STORE, key: FOCUS_DATA_KEY },
    ],
    ([activeValue, dataValue]) => {
      const active = activeValue as Partial<ActiveFocusSession> | null;
      const current = normalizeFocusData(dataValue);
      const existing = current.focusSessions.find((candidate) => candidate.id === session.id);
      if (existing) {
        if (active?.sessionId !== session.id) return { result: current, writes: [] };
        return {
          result: current,
          writes: [{ storeName: FOCUS_ACTIVE_STORE, key: ACTIVE_FOCUS_SESSION_KEY, value: undefined, remove: true }],
        };
      }
      if (!active || active.sessionId !== session.id) throw new Error('当前活跃专注会话已被其他标签页处理。');
      if (!current.focusSubjects.some((subject) => subject.id === session.subjectId)) {
        throw new Error('原专注主题不存在，无法保存本次会话。');
      }
      const next = { ...current, focusSessions: [...current.focusSessions, session] };
      return {
        result: next,
        writes: [
          { storeName: FOCUS_DATA_STORE, key: FOCUS_DATA_KEY, value: next },
          { storeName: FOCUS_ACTIVE_STORE, key: ACTIVE_FOCUS_SESSION_KEY, value: undefined, remove: true },
        ],
      };
    },
  );
}
