import type {
  LifeArea,
  LifeEvent,
  LifeFocus,
  LifeGoal,
  LifeMapData,
  LifeMapNote,
  LifeMapStage,
  LifeRelation,
  LifeSystem,
  LifeSystemCheckIn,
  LifeTheme,
  LifeReview,
  LifeMapPlacement,
} from './types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_AREA_TIMESTAMP = '2026-01-01T00:00:00.000Z';

export const LIFE_MAP_FIELDS = [
  'lifeMapAreas',
  'lifeMapStages',
  'lifeMapThemes',
  'lifeMapGoals',
  'lifeMapSystems',
  'lifeMapSystemCheckIns',
  'lifeMapEvents',
  'lifeMapFocuses',
  'lifeMapNotes',
  'lifeMapRelations',
  'lifeMapReviews',
] as const;

const DEFAULT_AREA_DEFINITIONS = [
  ['health', '身体健康', '#10B981', '心'],
  ['learning', '学习成长', '#6366F1', '学'],
  ['career', '职业发展', '#3B82F6', '业'],
  ['finance', '财务生活', '#F59E0B', '财'],
  ['relationships', '家庭关系', '#EC4899', '家'],
  ['personal', '兴趣与精神', '#8B5CF6', '趣'],
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function isLifeMapDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function createDefaultLifeAreas(now = DEFAULT_AREA_TIMESTAMP): LifeArea[] {
  return DEFAULT_AREA_DEFINITIONS.map(([id, name, color, icon], order) => ({
    id,
    name,
    color,
    icon,
    order,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }));
}

export function createEmptyLifeMapData(): LifeMapData {
  return {
    lifeMapAreas: createDefaultLifeAreas(),
    lifeMapStages: [],
    lifeMapThemes: [],
    lifeMapGoals: [],
    lifeMapSystems: [],
    lifeMapSystemCheckIns: [],
    lifeMapEvents: [],
    lifeMapFocuses: [],
    lifeMapNotes: [],
    lifeMapRelations: [],
    lifeMapReviews: [],
  };
}

function hasMeta(value: Record<string, unknown>): boolean {
  return typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && typeof value.revision === 'number'
    && Number.isFinite(value.revision)
    && (value.deletedAt === undefined || typeof value.deletedAt === 'string');
}

function hasBase(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && typeof value.name === 'string'
    && value.name.trim().length > 0
    && hasMeta(value);
}

function hasValidLayout(value: Record<string, unknown>): boolean {
  return (value.placement === undefined || value.placement === 'above' || value.placement === 'below')
    && (value.layoutLane === undefined
      || (typeof value.layoutLane === 'number' && Number.isInteger(value.layoutLane) && value.layoutLane >= 0 && value.layoutLane <= 8));
}

function validArea(value: unknown): value is LifeArea {
  return hasBase(value)
    && typeof value.color === 'string'
    && typeof value.order === 'number'
    && Number.isFinite(value.order);
}

function validStage(value: unknown): value is LifeMapStage {
  return hasBase(value) && isLifeMapDate(value.start) && isLifeMapDate(value.end) && value.start <= value.end;
}

function validAreaRange(value: unknown): value is LifeTheme | LifeFocus {
  return hasBase(value)
    && hasValidLayout(value)
    && typeof value.areaId === 'string'
    && isLifeMapDate(value.start)
    && isLifeMapDate(value.end)
    && value.start <= value.end;
}

function validGoal(value: unknown): value is LifeGoal {
  return hasBase(value)
    && hasValidLayout(value)
    && typeof value.areaId === 'string'
    && isLifeMapDate(value.start)
    && isLifeMapDate(value.targetDate)
    && value.start <= value.targetDate
    && ['active', 'completed', 'paused', 'archived'].includes(String(value.status))
    && (value.progress === undefined || (typeof value.progress === 'number' && value.progress >= 0 && value.progress <= 100))
    && (value.progressMode === undefined || value.progressMode === 'manual' || value.progressMode === 'auto')
    && (value.initialValue === undefined || (typeof value.initialValue === 'number' && Number.isFinite(value.initialValue)))
    && (value.currentValue === undefined || (typeof value.currentValue === 'number' && Number.isFinite(value.currentValue)))
    && (value.targetValue === undefined || (typeof value.targetValue === 'number' && Number.isFinite(value.targetValue)));
}

function validSystem(value: unknown): value is LifeSystem {
  return hasBase(value)
    && hasValidLayout(value)
    && typeof value.areaId === 'string'
    && isLifeMapDate(value.start)
    && (value.end === undefined || isLifeMapDate(value.end))
    && (value.end === undefined || value.start <= value.end)
    && ['active', 'completed', 'paused', 'archived'].includes(String(value.status))
    && ['daily', 'weekly', 'monthly'].includes(String(value.frequency))
    && typeof value.targetCount === 'number'
    && Number.isFinite(value.targetCount)
    && value.targetCount > 0
    && (value.durationMinutes === undefined || (typeof value.durationMinutes === 'number' && value.durationMinutes > 0));
}

function validSystemCheckIn(value: unknown): value is LifeSystemCheckIn {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.systemId === 'string'
    && isLifeMapDate(value.date)
    && typeof value.count === 'number'
    && Number.isFinite(value.count)
    && value.count > 0
    && hasMeta(value);
}

function validReview(value: unknown): value is LifeReview {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && (value.period === 'month' || value.period === 'quarter')
    && isLifeMapDate(value.start)
    && isLifeMapDate(value.end)
    && value.start <= value.end
    && typeof value.reflection === 'string'
    && typeof value.adjustments === 'string'
    && (value.areaIds === undefined || (Array.isArray(value.areaIds) && value.areaIds.every((id) => typeof id === 'string')))
    && isRecord(value.snapshot)
    && Array.isArray(value.snapshot.goals)
    && Array.isArray(value.snapshot.systems)
    && hasMeta(value);
}

function validEvent(value: unknown): value is LifeEvent {
  return hasBase(value) && hasValidLayout(value) && typeof value.areaId === 'string' && isLifeMapDate(value.date);
}

function validNote(value: unknown): value is LifeMapNote {
  return hasBase(value)
    && hasValidLayout(value)
    && typeof value.areaId === 'string'
    && isLifeMapDate(value.date)
    && (value.endDate === undefined || isLifeMapDate(value.endDate))
    && (value.endDate === undefined || value.date <= value.endDate)
    && (value.type === 'pin' || value.type === 'range');
}

export interface LegacyLifeMapLayoutData {
  projectSides?: Record<string, unknown>;
  nodeLayouts?: Record<string, unknown>;
}

/**
 * Converts the old device-local layout maps into fields on synchronized life-map
 * entities. Existing synchronized preferences always win, so opening an older
 * device cannot overwrite a placement already chosen elsewhere.
 */
export function migrateLegacyLifeMapLayouts(
  input: LifeMapData,
  legacy: LegacyLifeMapLayoutData,
  now = new Date().toISOString(),
): { data: LifeMapData; changed: boolean; matched: number } {
  let changed = false;
  let matched = 0;
  const projectSides = legacy.projectSides ?? {};
  const nodeLayouts = legacy.nodeLayouts ?? {};
  const revisedLayout = <T extends { placement?: LifeMapPlacement; layoutLane?: number; updatedAt: string; revision: number }>(
    item: T,
    placement: LifeMapPlacement | undefined,
    layoutLane?: number,
  ): T => {
    matched += 1;
    if (item.placement !== undefined || item.layoutLane !== undefined) return item;
    const validLane = Number.isInteger(layoutLane) && Number(layoutLane) >= 0 && Number(layoutLane) <= 8
      ? Number(layoutLane)
      : undefined;
    if (!placement && validLane === undefined) return item;
    changed = true;
    return {
      ...item,
      ...(placement ? { placement } : {}),
      ...(validLane === undefined ? {} : { layoutLane: validLane }),
      updatedAt: now,
      revision: Math.max(1, item.revision + 1),
    };
  };
  const projectPlacement = (key: string): LifeMapPlacement | undefined => {
    const value = projectSides[key];
    return value === 'above' || value === 'below' ? value : undefined;
  };
  const nodeLayout = (key: string): { placement?: LifeMapPlacement; lane?: number } => {
    const value = nodeLayouts[key];
    if (!isRecord(value)) return {};
    return {
      placement: value.side === 'top' ? 'above' : value.side === 'bottom' ? 'below' : undefined,
      lane: typeof value.lane === 'number' ? value.lane : undefined,
    };
  };
  const data: LifeMapData = {
    ...input,
    lifeMapGoals: input.lifeMapGoals.map((item) => {
      const placement = projectPlacement(`goal:${item.id}`);
      return placement ? revisedLayout(item, placement) : item;
    }),
    lifeMapSystems: input.lifeMapSystems.map((item) => {
      const placement = projectPlacement(`system:${item.id}`);
      return placement ? revisedLayout(item, placement) : item;
    }),
    lifeMapEvents: input.lifeMapEvents.map((item) => {
      const layout = nodeLayout(`milestone:${item.id}`);
      return layout.placement || layout.lane !== undefined ? revisedLayout(item, layout.placement, layout.lane) : item;
    }),
    lifeMapThemes: input.lifeMapThemes.map((item) => {
      const layout = nodeLayout(`note:theme:${item.id}`);
      return layout.placement || layout.lane !== undefined ? revisedLayout(item, layout.placement, layout.lane) : item;
    }),
    lifeMapFocuses: input.lifeMapFocuses.map((item) => {
      const layout = nodeLayout(`note:${item.id}`);
      return layout.placement || layout.lane !== undefined ? revisedLayout(item, layout.placement, layout.lane) : item;
    }),
    lifeMapNotes: input.lifeMapNotes.map((item) => {
      const layout = nodeLayout(`note:${item.id}`);
      return layout.placement || layout.lane !== undefined ? revisedLayout(item, layout.placement, layout.lane) : item;
    }),
  };
  return { data, changed, matched };
}

function validRelation(value: unknown): value is LifeRelation {
  return isRecord(value)
    && typeof value.id === 'string'
    && ['goal', 'system', 'event'].includes(String(value.lifeItemType))
    && typeof value.lifeItemId === 'string'
    && typeof value.projectId === 'string'
    && hasMeta(value);
}

function dedupe<T extends { id: string }>(value: unknown, guard: (item: unknown) => item is T): T[] {
  const byId = new Map<string, T>();
  if (Array.isArray(value)) value.filter(guard).forEach((item) => byId.set(item.id, item));
  return [...byId.values()];
}

export function normalizeLifeMapData(value: unknown): LifeMapData {
  const source = isRecord(value) ? value : {};
  const storedAreas = dedupe(source.lifeMapAreas, validArea);
  const defaultAreas = createDefaultLifeAreas();
  const storedIds = new Set(storedAreas.map((area) => area.id));
  const areas = [...storedAreas, ...defaultAreas.filter((area) => !storedIds.has(area.id))]
    .sort((left, right) => left.order - right.order);
  const areaIds = new Set(areas.filter((area) => !area.deletedAt).map((area) => area.id));
  const keepArea = <T extends { areaId: string }>(items: T[]) => items.filter((item) => areaIds.has(item.areaId));

  const goals = keepArea(dedupe(source.lifeMapGoals, validGoal));
  const systems = keepArea(dedupe(source.lifeMapSystems, validSystem));
  const systemIds = new Set(systems.map((item) => item.id));
  const events = keepArea(dedupe(source.lifeMapEvents, validEvent));
  const validLifeIds = new Set([
    ...goals.map((item) => `goal:${item.id}`),
    ...systems.map((item) => `system:${item.id}`),
    ...events.map((item) => `event:${item.id}`),
  ]);

  return {
    lifeMapAreas: areas,
    lifeMapStages: dedupe(source.lifeMapStages, validStage),
    lifeMapThemes: keepArea(dedupe(source.lifeMapThemes, validAreaRange)),
    lifeMapGoals: goals,
    lifeMapSystems: systems,
    lifeMapSystemCheckIns: dedupe(source.lifeMapSystemCheckIns, validSystemCheckIn).filter((item) => systemIds.has(item.systemId)),
    lifeMapEvents: events,
    lifeMapFocuses: keepArea(dedupe(source.lifeMapFocuses, validAreaRange)),
    lifeMapNotes: keepArea(dedupe(source.lifeMapNotes, validNote)),
    lifeMapRelations: dedupe(source.lifeMapRelations, validRelation).filter((relation) =>
      validLifeIds.has(`${relation.lifeItemType}:${relation.lifeItemId}`)),
    lifeMapReviews: dedupe(source.lifeMapReviews, validReview),
  };
}

export function validateLifeMapData(value: unknown): string[] {
  if (!isRecord(value)) return ['人生地图数据缺失。'];
  const checks: Array<[keyof LifeMapData, (item: unknown) => boolean]> = [
    ['lifeMapAreas', validArea],
    ['lifeMapStages', validStage],
    ['lifeMapThemes', validAreaRange],
    ['lifeMapGoals', validGoal],
    ['lifeMapSystems', validSystem],
    ['lifeMapSystemCheckIns', validSystemCheckIn],
    ['lifeMapEvents', validEvent],
    ['lifeMapFocuses', validAreaRange],
    ['lifeMapNotes', validNote],
    ['lifeMapRelations', validRelation],
    ['lifeMapReviews', validReview],
  ];
  const errors: string[] = [];
  for (const [field, guard] of checks) {
    const items = value[field];
    if (!Array.isArray(items)) errors.push(`人生地图字段 ${field} 不是数组。`);
    else if (!items.every(guard)) errors.push(`人生地图字段 ${field} 包含无效内容。`);
    else if (new Set(items.map((item) => (item as { id: string }).id)).size !== items.length) errors.push(`人生地图字段 ${field} 存在重复 ID。`);
  }
  return errors;
}

export function hasIndependentLifeMapContent(data: LifeMapData): boolean {
  return LIFE_MAP_FIELDS.some((field) => field !== 'lifeMapAreas' && data[field].some((item) => !item.deletedAt));
}

export function activeLifeMapItems<T extends { deletedAt?: string }>(items: T[]): T[] {
  return items.filter((item) => !item.deletedAt);
}
