import { create } from 'zustand';
import { createWorkspaceTrackedSet } from '@/services/workspaceLocalWriteJournal';
import type { FocusData, FocusSession, FocusSessionCorrectionField, FocusSubject, FocusWeeklyReview, FocusWeeklyTargetVersion } from './types';
import { createEmptyFocusData, loadFocusData, normalizeFocusData, persistFocusData } from './persistence';
import { assertValidFocusSession, assertValidFocusSubject, validateFocusWeeklyReview } from './validation';

interface FocusStore extends FocusData {
  isHydrated: boolean;
  hydrateStore: () => Promise<void>;
  acceptPersistedFocusData: (data: FocusData) => void;
  replaceFocusData: (data: FocusData) => Promise<void>;
  createSubject: (input: Omit<FocusSubject, 'id' | 'order' | 'createdAt' | 'updatedAt'>) => Promise<FocusSubject>;
  updateSubject: (id: string, patch: Partial<Pick<FocusSubject, 'name' | 'color' | 'weeklyTargetMinutes' | 'defaultBackgroundPolicy'>>) => Promise<void>;
  reorderSubjects: (ids: string[]) => Promise<void>;
  archiveSubject: (id: string, archived: boolean) => Promise<void>;
  createManualSession: (session: FocusSession) => Promise<void>;
  updateSession: (session: FocusSession) => Promise<void>;
  deleteSession: (id: string, deletedAt?: string) => Promise<void>;
  saveWeeklyReview: (weekStart: string, nextWeekPlan: string) => Promise<void>;
}

function makeId(): string {
  return crypto.randomUUID();
}

export const useFocusStore = create<FocusStore>()((_, get, api) => {
  const set = createWorkspaceTrackedSet(api.setState, get, ['focusSubjects', 'focusSessions', 'focusWeeklyReviews']);
  const commit = async (data: FocusData, base?: FocusData) => {
    const normalized = normalizeFocusData(data);
    const persisted = await persistFocusData(normalized, base);
    set(persisted);
  };
  return {
    ...createEmptyFocusData(),
    isHydrated: false,
    hydrateStore: async () => {
      if (get().isHydrated) return;
      try {
        set({ ...await loadFocusData(), isHydrated: true });
      } catch (error) {
        console.warn('[focus] IndexedDB 数据加载失败：', error);
        set({ isHydrated: true });
      }
    },
    acceptPersistedFocusData: (data) => set(normalizeFocusData(data)),
    replaceFocusData: async (data) => await commit(data),
    createSubject: async (input) => {
      const now = new Date().toISOString();
      const state = get();
      const subject: FocusSubject = {
        ...input,
        id: makeId(),
        name: input.name.trim(),
        order: state.focusSubjects.length,
        createdAt: now,
        updatedAt: now,
        weeklyTargetHistory: [{ targetMinutes: input.weeklyTargetMinutes ?? null, effectiveFrom: now }],
      };
      assertValidFocusSubject(subject);
      await commit({ focusSubjects: [...state.focusSubjects, subject], focusSessions: state.focusSessions, focusWeeklyReviews: state.focusWeeklyReviews }, state);
      return subject;
    },
    updateSubject: async (id, patch) => {
      const state = get();
      const subject = state.focusSubjects.find((candidate) => candidate.id === id);
      if (!subject) throw new Error('专注主题不存在。');
      const now = new Date().toISOString();
      const changesTarget = Object.prototype.hasOwnProperty.call(patch, 'weeklyTargetMinutes')
        && patch.weeklyTargetMinutes !== subject.weeklyTargetMinutes;
      const history = changesTarget
        ? [
          ...(subject.weeklyTargetHistory ?? [{ targetMinutes: subject.weeklyTargetMinutes ?? null, effectiveFrom: subject.createdAt }]),
          { targetMinutes: patch.weeklyTargetMinutes ?? null, effectiveFrom: now },
        ] satisfies FocusWeeklyTargetVersion[]
        : subject.weeklyTargetHistory;
      const next = {
        ...subject,
        ...patch,
        name: patch.name === undefined ? subject.name : patch.name.trim(),
        ...(changesTarget ? { weeklyTargetHistory: history } : {}),
        updatedAt: now,
      };
      assertValidFocusSubject(next);
      await commit({ focusSubjects: state.focusSubjects.map((candidate) => candidate.id === id ? next : candidate), focusSessions: state.focusSessions, focusWeeklyReviews: state.focusWeeklyReviews }, state);
    },
    reorderSubjects: async (ids) => {
      const state = get();
      if (ids.length !== state.focusSubjects.length || new Set(ids).size !== ids.length
        || ids.some((id) => !state.focusSubjects.some((subject) => subject.id === id))) throw new Error('专注主题排序无效。');
      const byId = new Map(state.focusSubjects.map((subject) => [subject.id, subject]));
      await commit({
        focusSubjects: ids.map((id, order) => ({ ...byId.get(id)!, order, updatedAt: new Date().toISOString() })),
        focusSessions: state.focusSessions,
        focusWeeklyReviews: state.focusWeeklyReviews,
      }, state);
    },
    archiveSubject: async (id, archived) => {
      const state = get();
      if (!state.focusSubjects.some((subject) => subject.id === id)) throw new Error('专注主题不存在。');
      const timestamp = new Date().toISOString();
      await commit({
        focusSubjects: state.focusSubjects.map((subject) => subject.id === id
          ? { ...subject, ...(archived ? { archivedAt: timestamp } : { archivedAt: undefined }), updatedAt: timestamp }
          : subject),
        focusSessions: state.focusSessions,
        focusWeeklyReviews: state.focusWeeklyReviews,
      }, state);
    },
    createManualSession: async (session) => {
      const state = get();
      assertValidFocusSession(session);
      if (session.source !== 'manual') throw new Error('手动补录必须标记为 manual。');
      if (!state.focusSubjects.some((subject) => subject.id === session.subjectId)) throw new Error('专注主题不存在。');
      if (state.focusSessions.some((candidate) => candidate.id === session.id)) throw new Error('专注记录已存在。');
      await commit({ focusSubjects: state.focusSubjects, focusSessions: [...state.focusSessions, session], focusWeeklyReviews: state.focusWeeklyReviews }, state);
    },
    updateSession: async (session) => {
      const state = get();
      assertValidFocusSession(session);
      const current = state.focusSessions.find((candidate) => candidate.id === session.id);
      if (!current || current.deletedAt) throw new Error('专注记录不存在或已删除。');
      if (current.source !== session.source || current.timeZone !== session.timeZone || current.createdAt !== session.createdAt) {
        throw new Error('不能修改专注记录的来源、时区或创建时间。');
      }
      if (!state.focusSubjects.some((subject) => subject.id === session.subjectId)) throw new Error('专注主题不存在。');
      const fields = (['subjectId', 'startedAt', 'endedAt', 'activeSeconds', 'interruptions', 'mode', 'targetMinutes'] as const)
        .filter((field) => JSON.stringify(current[field]) !== JSON.stringify(session[field])) as FocusSessionCorrectionField[];
      const corrected = fields.length
        ? { ...session, correctedAt: new Date().toISOString(), correctedFields: [...new Set([...(current.correctedFields ?? []), ...fields])] }
        : session;
      assertValidFocusSession(corrected);
      await commit({ focusSubjects: state.focusSubjects, focusSessions: state.focusSessions.map((candidate) => candidate.id === session.id ? corrected : candidate), focusWeeklyReviews: state.focusWeeklyReviews }, state);
    },
    deleteSession: async (id, deletedAt = new Date().toISOString()) => {
      const state = get();
      const current = state.focusSessions.find((candidate) => candidate.id === id);
      if (!current) throw new Error('专注记录不存在。');
      await commit({
        focusSubjects: state.focusSubjects,
        focusSessions: state.focusSessions.map((candidate) => candidate.id === id ? { ...candidate, deletedAt, updatedAt: deletedAt } : candidate),
        focusWeeklyReviews: state.focusWeeklyReviews,
      }, state);
    },
    saveWeeklyReview: async (weekStart, nextWeekPlan) => {
      const state = get();
      const plan = nextWeekPlan.trim();
      const timestamp = new Date().toISOString();
      if (plan) {
        const review: FocusWeeklyReview = { weekStart, nextWeekPlan: plan, updatedAt: timestamp };
        const errors = validateFocusWeeklyReview(review);
        if (errors.length) throw new Error(errors.join(' '));
        await commit({
          focusSubjects: state.focusSubjects,
          focusSessions: state.focusSessions,
          focusWeeklyReviews: [...state.focusWeeklyReviews.filter((item) => item.weekStart !== weekStart), review],
        }, state);
        return;
      }
      await commit({
        focusSubjects: state.focusSubjects,
        focusSessions: state.focusSessions,
        focusWeeklyReviews: state.focusWeeklyReviews.filter((item) => item.weekStart !== weekStart),
      }, state);
    },
  };
});
