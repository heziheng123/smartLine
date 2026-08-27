import { canDeleteLifeArea, isLifeMapDate, normalizeLifeMapData } from '@/lifeMap/data';
import type { LifeMapData, LifeMapPlanGroupId, LifeMapStatus } from '@/lifeMap/types';

export type LifePlanningKind = 'area' | 'stage' | 'theme' | 'goal' | 'system' | 'event' | 'focus' | 'note' | 'review';

export interface LifePlanningDraft {
  name: string;
  areaId?: string;
  start?: string;
  end?: string;
  body?: string;
  color?: string;
  status?: LifeMapStatus;
  frequency?: 'daily' | 'weekly' | 'monthly';
  targetCount?: number;
  planGroupId?: LifeMapPlanGroupId;
  period?: 'month' | 'quarter';
}

const collectionFor = {
  area: 'lifeMapAreas',
  stage: 'lifeMapStages',
  theme: 'lifeMapThemes',
  goal: 'lifeMapGoals',
  system: 'lifeMapSystems',
  event: 'lifeMapEvents',
  focus: 'lifeMapFocuses',
  note: 'lifeMapNotes',
  review: 'lifeMapReviews',
} as const satisfies Record<LifePlanningKind, keyof LifeMapData>;

const datedKinds = new Set<LifePlanningKind>(['stage', 'theme', 'goal', 'system', 'event', 'focus', 'note', 'review']);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const requireDraft = (kind: LifePlanningKind, draft: LifePlanningDraft) => {
  if (!draft.name.trim()) throw new Error('名称不能为空。');
  if (datedKinds.has(kind) && !isLifeMapDate(draft.start)) throw new Error('请选择有效的开始日期。');
  if (datedKinds.has(kind) && !isLifeMapDate(draft.end ?? draft.start)) throw new Error('请选择有效的结束日期。');
  if (draft.start && draft.end && draft.start > draft.end) throw new Error('结束日期不能早于开始日期。');
  if (['theme', 'goal', 'system', 'focus'].includes(kind) && !draft.areaId) throw new Error('请选择人生领域。');
};

const fieldsFor = (kind: LifePlanningKind, draft: LifePlanningDraft, data: LifeMapData) => {
  const name = draft.name.trim();
  const start = draft.start ?? '';
  const end = draft.end ?? start;
  const color = draft.color || '#6366f1';
  switch (kind) {
    case 'area': return {
      name, color, planGroupId: draft.planGroupId ?? 'life',
      order: Math.max(-1, ...data.lifeMapAreas.map((item) => item.order)) + 1,
    };
    case 'stage': return { name, start, end, description: draft.body?.trim() ?? '', importance: 'normal' as const, areaIds: draft.areaId ? [draft.areaId] : undefined, color };
    case 'theme': return { name, areaId: draft.areaId!, start, end, color };
    case 'goal': return { name, areaId: draft.areaId!, start, targetDate: end, color, status: draft.status ?? 'active', progress: 0, kind: 'goal' as const };
    case 'system': return { name, areaId: draft.areaId!, start, end, color, status: draft.status ?? 'active', frequency: draft.frequency ?? 'weekly', targetCount: Math.max(1, draft.targetCount ?? 1) };
    case 'event': return { name, areaId: draft.areaId || undefined, date: start, color, importance: 'normal' as const };
    case 'focus': return { name, areaId: draft.areaId!, start, end, color };
    case 'note': return { name, areaId: draft.areaId || undefined, body: draft.body?.trim() ?? '', date: start, endDate: end === start ? undefined : end, type: end === start ? 'pin' as const : 'range' as const, color, importance: 'normal' as const };
    case 'review': return { title: name, period: draft.period ?? 'month', start, end, reflection: draft.body?.trim() ?? '', adjustments: '', areaIds: draft.areaId ? [draft.areaId] : undefined, snapshot: { goals: [], systems: [] } };
  }
};

const nextId = (kind: LifePlanningKind) => `map-${kind}-${crypto.randomUUID()}`;

export function saveLifePlanningItem(
  data: LifeMapData,
  kind: LifePlanningKind,
  draft: LifePlanningDraft,
  options: { id?: string; now?: string } = {},
): LifeMapData {
  requireDraft(kind, draft);
  const now = options.now ?? new Date().toISOString();
  const collection = collectionFor[kind];
  const items = data[collection] as unknown as Array<Record<string, unknown> & { id: string; createdAt: string; revision: number }>;
  const current = options.id ? items.find((item) => item.id === options.id) : undefined;
  if (options.id && !current) throw new Error('找不到要编辑的人生规划对象。');
  const fields = fieldsFor(kind, draft, data);
  const next = {
    ...(current ?? {}),
    ...fields,
    ...(kind === 'area' && current ? { order: current.order } : {}),
    id: current?.id ?? nextId(kind),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    revision: (current?.revision ?? 0) + 1,
    deletedAt: undefined,
  };
  return normalizeLifeMapData({
    ...data,
    [collection]: current
      ? items.map((item) => item.id === current.id ? next : item)
      : [...items, next],
  });
}

export function deleteLifePlanningItem(
  data: LifeMapData,
  kind: LifePlanningKind,
  id: string,
  now = new Date().toISOString(),
): LifeMapData {
  const collection = collectionFor[kind];
  const items = data[collection] as unknown as Array<Record<string, unknown> & { id: string; revision: number }>;
  const current = items.find((item) => item.id === id);
  if (!current) return data;
  if (kind === 'area' && !canDeleteLifeArea(data, id)) throw new Error('该领域仍有规划内容，不能删除。');
  return normalizeLifeMapData({
    ...data,
    [collection]: items.map((item) => item.id === id
      ? { ...item, deletedAt: now, updatedAt: now, revision: item.revision + 1 }
      : item),
  });
}

export function updateLifePlanningDates(
  data: LifeMapData,
  referenceId: string,
  start: string,
  end: string,
  now = new Date().toISOString(),
): LifeMapData | null {
  if (!isLifeMapDate(start) || !isLifeMapDate(end) || start > end) return null;
  const separator = referenceId.indexOf(':');
  const kind = referenceId.slice(0, separator) as LifePlanningKind | 'milestone';
  const id = referenceId.slice(separator + 1);
  const mapping = {
    stage: ['lifeMapStages', { start, end }],
    theme: ['lifeMapThemes', { start, end }],
    goal: ['lifeMapGoals', { start, targetDate: end }],
    system: ['lifeMapSystems', { start, end }],
    milestone: ['lifeMapEvents', { date: start }],
    event: ['lifeMapEvents', { date: start }],
    focus: ['lifeMapFocuses', { start, end }],
    note: ['lifeMapNotes', { date: start, endDate: start === end ? undefined : end, type: start === end ? 'pin' : 'range' }],
    review: ['lifeMapReviews', { start, end }],
  } as const;
  const target = mapping[kind as keyof typeof mapping];
  if (!target || !id) return null;
  const [collection, fields] = target;
  const items = data[collection] as unknown as Array<Record<string, unknown> & { id: string; revision: number }>;
  if (!items.some((item) => item.id === id && !item.deletedAt)) return null;
  return normalizeLifeMapData({
    ...data,
    [collection]: items.map((item) => item.id === id
      ? { ...item, ...fields, updatedAt: now, revision: item.revision + 1 }
      : item),
  });
}

export function addLifeSystemCheckIn(
  data: LifeMapData,
  systemId: string,
  date: string,
  now = new Date().toISOString(),
): LifeMapData {
  const system = data.lifeMapSystems.find((item) => item.id === systemId && !item.deletedAt);
  if (!system || !datePattern.test(date)) throw new Error('无法记录长期系统完成情况。');
  const current = data.lifeMapSystemCheckIns.find((item) => item.systemId === systemId && item.date === date && !item.deletedAt);
  const next = current
    ? data.lifeMapSystemCheckIns.map((item) => item.id === current.id
      ? { ...item, count: item.count + 1, updatedAt: now, revision: item.revision + 1 }
      : item)
    : [...data.lifeMapSystemCheckIns, {
        id: `map-checkin-${crypto.randomUUID()}`, systemId, date, count: 1,
        createdAt: now, updatedAt: now, revision: 1,
      }];
  return normalizeLifeMapData({ ...data, lifeMapSystemCheckIns: next });
}

export function updateLifePlanGroupPlacement(
  data: LifeMapData,
  id: LifeMapPlanGroupId,
  placement: 'above' | 'below',
  now = new Date().toISOString(),
): LifeMapData {
  return normalizeLifeMapData({
    ...data,
    lifeMapPlanGroups: data.lifeMapPlanGroups.map((item) => item.id === id
      ? { ...item, placement, updatedAt: now, revision: item.revision + 1 }
      : item),
  });
}
