import type {
  LifeArea,
  LifeEvent,
  LifeFocus,
  LifeGoal,
  LifeMapData,
  LifeMapNote,
  LifeMapStage,
  LifeSystem,
  LifeSystemCheckIn,
  LifeTheme,
  LifeReview,
  LifeMapPlacement,
  LifeMaintenancePeriod,
  LifeMapPlanGroupId,
  LifeMapPlanGroupPreference,
} from './types';
import { suggestGroupColor } from '@/utils/timeline-utils';
import { canonicalizeAnnotationDateFields } from './annotationSemantics';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_AREA_TIMESTAMP = '2026-01-01T00:00:00.000Z';

export const LIFE_MAP_FIELDS = [
  'lifeMapAreas',
  'lifeMapPlanGroups',
  'lifeMapStages',
  'lifeMapThemes',
  'lifeMapGoals',
  'lifeMapSystems',
  'lifeMapSystemCheckIns',
  'lifeMapEvents',
  'lifeMapFocuses',
  'lifeMapNotes',
  'lifeMapReviews',
] as const;

const DEFAULT_AREA_DEFINITIONS = [
  ['health', '身体健康', '#10B981', '心', 'life'],
  ['learning', '学习成长', '#6366F1', '学', 'learning'],
  ['career', '职业发展', '#3B82F6', '业', 'work'],
  ['finance', '财务生活', '#F59E0B', '财', 'life'],
  ['relationships', '家庭关系', '#EC4899', '家', 'life'],
  ['personal', '兴趣与精神', '#8B5CF6', '趣', 'life'],
] as const;

export const LIFE_MAP_PLAN_GROUP_META: Record<LifeMapPlanGroupId, { name: string; color: string }> = {
  learning: { name: '学习', color: '#6366F1' },
  work: { name: '工作', color: '#D8A72E' },
  life: { name: '生活', color: '#10B981' },
};

/**
 * 学习领域专用子色板（6 色）
 *
 * 设计目标：
 * - 色相差异 ≥ 30°，确保多个学习子任务（考研政治 / 考研英语 / 数学 / 专业课…）一眼区分
 * - 整体保持柔和高级感，避免过饱和
 * - 索引 0 = 领域主色（与 LIFE_MAP_PLAN_GROUP_META.learning.color 保持一致）
 *
 * 选择建议（用户可手动覆盖）：
 *   紫 #6366F1 → 通识 / 默认
 *   蓝 #3B82F6 → 数学 / 理工
 *   青 #0EA5E9 → 英语 / 语言 / 编程
 *   粉 #EC4899 → 政治 / 社科
 *   紫红 #A855F7 → 专业课 / 技术
 *   绿 #10B981 → 综合 / 兴趣 / 跨学科
 */
export const LEARNING_CHILD_PALETTE: ReadonlyArray<{ hex: string; label: string; hint: string }> = [
  { hex: '#6366F1', label: '通识', hint: '通用学习 / 默认' },
  { hex: '#3B82F6', label: '理工', hint: '数学 / 理工类' },
  { hex: '#0EA5E9', label: '语言', hint: '英语 / 编程 / 语言类' },
  { hex: '#EC4899', label: '社科', hint: '政治 / 社科类' },
  { hex: '#A855F7', label: '专业课', hint: '专业课 / 技术' },
  { hex: '#10B981', label: '兴趣', hint: '兴趣 / 跨学科' },
];

export function isLearningPlanGroup(planGroupId: string | undefined | null): boolean {
  return planGroupId === 'learning';
}

/**
 * 为领域下的子项目推荐一个识别色。
 *
 * - 学习组：使用 LEARNING_CHILD_PALETTE，挑选使用次数最少 + 邻色回避的色
 * - 其它领域：使用现有的 GROUP_COLOR_PRESET（24 色标准调色板）
 * - 已有自定义色的项目不会被覆盖
 */
export function suggestAreaChildColor(
  planGroupId: string | undefined | null,
  existingColors: ReadonlyArray<string | undefined>,
  seed = '',
): string {
  if (isLearningPlanGroup(planGroupId)) {
    const counts = new Map(LEARNING_CHILD_PALETTE.map((entry) => [entry.hex.toLowerCase(), 0]));
    for (const color of existingColors) {
      const key = color?.toLowerCase();
      if (key && counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const minCount = Math.min(...counts.values());
    const leastUsed = LEARNING_CHILD_PALETTE.filter((entry) => counts.get(entry.hex.toLowerCase()) === minCount);
    const seedKey = hashStringSeed(seed || String(existingColors.length));
    return leastUsed[seedKey % leastUsed.length].hex;
  }
  return suggestGroupColor([...existingColors], seed);
}

function hashStringSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function isLifeMapPlanGroupId(value: unknown): value is LifeMapPlanGroupId {
  return value === 'learning' || value === 'work' || value === 'life';
}

export function defaultPlanGroupForAreaId(areaId: string): LifeMapPlanGroupId {
  if (areaId === 'learning') return 'learning';
  if (areaId === 'career') return 'work';
  return 'life';
}

export function createDefaultLifeMapPlanGroups(now = DEFAULT_AREA_TIMESTAMP): LifeMapPlanGroupPreference[] {
  return [
    { id: 'learning', placement: 'above', order: 0, createdAt: now, updatedAt: now, revision: 1 },
    { id: 'work', placement: 'below', order: 1, createdAt: now, updatedAt: now, revision: 1 },
    { id: 'life', placement: 'below', order: 2, createdAt: now, updatedAt: now, revision: 1 },
  ];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function isLifeMapDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function createDefaultLifeAreas(now = DEFAULT_AREA_TIMESTAMP): LifeArea[] {
  return DEFAULT_AREA_DEFINITIONS.map(([id, name, color, icon, planGroupId], order) => ({
    id,
    name,
    color,
    icon,
    order,
    planGroupId,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }));
}

export function createEmptyLifeMapData(): LifeMapData {
  return {
    lifeMapAreas: createDefaultLifeAreas(),
    lifeMapPlanGroups: createDefaultLifeMapPlanGroups(),
    lifeMapStages: [],
    lifeMapThemes: [],
    lifeMapGoals: [],
    lifeMapSystems: [],
    lifeMapSystemCheckIns: [],
    lifeMapEvents: [],
    lifeMapFocuses: [],
    lifeMapNotes: [],
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

function validMaintenancePeriod(value: unknown): value is LifeMaintenancePeriod {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && isLifeMapDate(value.start)
    && (value.end === undefined || isLifeMapDate(value.end))
    && (value.end === undefined || value.start <= value.end)
    && (value.reason === undefined || typeof value.reason === 'string');
}

function hasValidMaintenance(value: Record<string, unknown>): boolean {
  return value.maintenancePeriods === undefined
    || (Array.isArray(value.maintenancePeriods) && value.maintenancePeriods.every(validMaintenancePeriod));
}

function validArea(value: unknown): value is LifeArea {
  return hasBase(value)
    && hasValidMaintenance(value)
    && typeof value.color === 'string'
    && typeof value.order === 'number'
    && Number.isFinite(value.order);
}

function validPlanGroup(value: unknown): value is LifeMapPlanGroupPreference {
  return isRecord(value)
    && isLifeMapPlanGroupId(value.id)
    && (value.placement === 'above' || value.placement === 'below')
    && typeof value.order === 'number'
    && Number.isFinite(value.order)
    && hasMeta(value);
}

function validStage(value: unknown): value is LifeMapStage {
  return hasBase(value)
    && isLifeMapDate(value.start)
    && isLifeMapDate(value.end)
    && value.start <= value.end
    && (value.description === undefined || typeof value.description === 'string')
    && (value.importance === undefined || value.importance === 'normal' || value.importance === 'important')
    && (value.areaIds === undefined || (Array.isArray(value.areaIds) && value.areaIds.every((id) => typeof id === 'string')));
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
    && hasValidMaintenance(value)
    && typeof value.areaId === 'string'
    && isLifeMapDate(value.start)
    && isLifeMapDate(value.targetDate)
    && value.start <= value.targetDate
    && ['active', 'completed', 'paused', 'archived'].includes(String(value.status))
    && (value.progress === undefined || (typeof value.progress === 'number' && value.progress >= 0 && value.progress <= 100))
    && (value.progressMode === undefined || value.progressMode === 'manual' || value.progressMode === 'auto')
    && (value.kind === undefined || value.kind === 'goal' || value.kind === 'plan' || value.kind === 'phase')
    && (value.parentGoalId === undefined || typeof value.parentGoalId === 'string')
    && (value.childRole === undefined || value.childRole === 'phase' || value.childRole === 'track')
    && (value.outcomeGoalId === undefined || typeof value.outcomeGoalId === 'string')
    && (value.summary === undefined || typeof value.summary === 'string')
    && (value.kind !== 'phase' || (typeof value.parentGoalId === 'string' && value.parentGoalId.trim().length > 0))
    && (value.initialValue === undefined || (typeof value.initialValue === 'number' && Number.isFinite(value.initialValue)))
    && (value.currentValue === undefined || (typeof value.currentValue === 'number' && Number.isFinite(value.currentValue)))
    && (value.targetValue === undefined || (typeof value.targetValue === 'number' && Number.isFinite(value.targetValue)));
}

function validSystem(value: unknown): value is LifeSystem {
  return hasBase(value)
    && hasValidLayout(value)
    && hasValidMaintenance(value)
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
  return hasBase(value)
    && hasValidLayout(value)
    && (value.areaId === undefined || typeof value.areaId === 'string')
    && (value.relatedPlanId === undefined || typeof value.relatedPlanId === 'string')
    && isLifeMapDate(value.date);
}

function validNote(value: unknown): value is LifeMapNote {
  return hasBase(value)
    && hasValidLayout(value)
    && (value.areaId === undefined || typeof value.areaId === 'string')
    && isLifeMapDate(value.date)
    && (value.endDate === undefined || isLifeMapDate(value.endDate))
    && (value.endDate === undefined || value.date <= value.endDate)
    && (value.type === 'pin' || value.type === 'range')
    && (value.body === undefined || typeof value.body === 'string')
    && (value.relatedStageId === undefined || typeof value.relatedStageId === 'string')
    && (value.relatedGoalId === undefined || typeof value.relatedGoalId === 'string')
    && (value.mood === undefined || typeof value.mood === 'string')
    && (value.importance === undefined || value.importance === 'normal' || value.importance === 'important');
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
    .map((area) => ({
      ...area,
      planGroupId: isLifeMapPlanGroupId(area.planGroupId)
        ? area.planGroupId
        : defaultPlanGroupForAreaId(area.id),
    }))
    .sort((left, right) => left.order - right.order);
  const storedPlanGroups = dedupe(source.lifeMapPlanGroups, validPlanGroup);
  const planGroups = createDefaultLifeMapPlanGroups().map((fallback) => {
    const stored = storedPlanGroups.find((group) => group.id === fallback.id && !group.deletedAt);
    return stored ? { ...stored, order: fallback.order } : fallback;
  });
  const areaIds = new Set(areas.filter((area) => !area.deletedAt).map((area) => area.id));
  const keepArea = <T extends { areaId: string; deletedAt?: string }>(items: T[]) => items
    .filter((item) => Boolean(item.deletedAt) || areaIds.has(item.areaId));

  const candidateGoals = dedupe(source.lifeMapGoals, validGoal).filter((item) => (
    Boolean(item.deletedAt)
    || item.kind === undefined
    || item.kind === 'goal'
    || areaIds.has(item.areaId)
  ));
  const planIds = new Set(candidateGoals.filter((item) => item.kind === 'plan' && !item.deletedAt).map((item) => item.id));
  const goals = candidateGoals
    .filter((item) => item.kind !== 'phase' || Boolean(item.deletedAt) || planIds.has(item.parentGoalId ?? ''));
  const systems = keepArea(dedupe(source.lifeMapSystems, validSystem));
  const systemIds = new Set(systems.map((item) => item.id));
  const events = dedupe(source.lifeMapEvents, validEvent).map((item) => {
    const areaId = item.areaId && areaIds.has(item.areaId) ? item.areaId : undefined;
    const relatedPlanId = item.relatedPlanId && planIds.has(item.relatedPlanId) ? item.relatedPlanId : undefined;
    return {
      ...item,
      areaId,
      relatedPlanId,
    };
  });
  return {
    lifeMapAreas: areas,
    lifeMapPlanGroups: planGroups,
    // v13 adds stage descriptions and importance without a destructive migration.
    // Normalizing at every read boundary makes old local, synced and backup data
    // immediately behave like new records while preserving their original IDs.
    lifeMapStages: dedupe(source.lifeMapStages, validStage).map((stage) => ({
      ...stage,
      description: stage.description ?? '',
      importance: stage.importance ?? 'normal',
      areaIds: stage.areaIds?.filter((id) => areaIds.has(id)),
    })),
    lifeMapThemes: keepArea(dedupe(source.lifeMapThemes, validAreaRange)),
    lifeMapGoals: goals.map((goal) => ({ ...goal, ...(goal.kind === 'phase' ? { childRole: goal.childRole ?? 'phase' } : {}) })),
    lifeMapSystems: systems,
    lifeMapSystemCheckIns: dedupe(source.lifeMapSystemCheckIns, validSystemCheckIn).filter((item) => systemIds.has(item.systemId)),
    lifeMapEvents: events,
    lifeMapFocuses: keepArea(dedupe(source.lifeMapFocuses, validAreaRange)),
    lifeMapNotes: dedupe(source.lifeMapNotes, validNote)
      .filter((note) => Boolean(note.deletedAt) || !note.areaId || areaIds.has(note.areaId))
      .map((note) => ({ ...note, ...canonicalizeAnnotationDateFields(note), body: note.body ?? '', importance: note.importance ?? 'normal' })),
    lifeMapReviews: dedupe(source.lifeMapReviews, validReview),
  };
}

export function canDeleteLifeArea(data: LifeMapData, areaId: string): boolean {
  const isActiveAreaReference = (item: { areaId?: string; deletedAt?: string }) => (
    !item.deletedAt && item.areaId === areaId
  );
  const hasPlanningReference = data.lifeMapGoals.some((item) => (
    (item.kind === 'plan' || item.kind === 'phase') && isActiveAreaReference(item)
  ));
  return !hasPlanningReference
    && !data.lifeMapSystems.some(isActiveAreaReference)
    && !data.lifeMapThemes.some(isActiveAreaReference)
    && !data.lifeMapFocuses.some(isActiveAreaReference)
    && !data.lifeMapNotes.some(isActiveAreaReference)
    && !data.lifeMapEvents.some((item) => !item.deletedAt && item.areaId === areaId);
}

export function validateLifeMapData(value: unknown): string[] {
  if (!isRecord(value)) return ['人生地图数据缺失。'];
  const checks: Array<[keyof LifeMapData, (item: unknown) => boolean]> = [
    ['lifeMapAreas', validArea],
    ['lifeMapPlanGroups', validPlanGroup],
    ['lifeMapStages', validStage],
    ['lifeMapThemes', validAreaRange],
    ['lifeMapGoals', validGoal],
    ['lifeMapSystems', validSystem],
    ['lifeMapSystemCheckIns', validSystemCheckIn],
    ['lifeMapEvents', validEvent],
    ['lifeMapFocuses', validAreaRange],
    ['lifeMapNotes', validNote],
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
  return LIFE_MAP_FIELDS.some((field) => field !== 'lifeMapAreas' && field !== 'lifeMapPlanGroups' && data[field].some((item) => !item.deletedAt));
}

export function activeLifeMapItems<T extends { deletedAt?: string }>(items: T[]): T[] {
  return items.filter((item) => !item.deletedAt);
}
