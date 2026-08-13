import type { WorkspaceStorageField } from './workspaceSyncQueueCore';

interface EntityPath {
  entityType: string;
  entityId: string;
  entityLabel: string;
  fieldPath: string;
}

interface ConflictFieldDiff {
  fieldPath: string;
  localValue: unknown;
  remoteValue: unknown;
  baseValue: unknown;
  diverged: boolean;
  summary: string;
}

interface EntityConflict {
  entityType: string;
  entityId: string;
  entityLabel: string;
  diffs: ConflictFieldDiff[];
}

interface FieldConflictSummary {
  field: WorkspaceStorageField;
  fieldLabel: string;
  entities: EntityConflict[];
  totalEntities: number;
  totalDiffs: number;
}

const ENTITY_KIND_LABELS: Record<string, string> = {
  tasks: '项目任务',
  groups: '项目分组',
  notes: '时间轴便签',
  milestones: '里程碑',
  schedules: '每日安排',
  retrospectives: '每日复盘',
  reviewTasks: '复习轮次',
  nodes: '知识节点',
  edges: '知识关系',
  lifeMapAreas: '人生领域',
  lifeMapPlanGroups: '人生规划分组',
  lifeMapStages: '人生时期',
  lifeMapThemes: '时期主题',
  lifeMapGoals: '人生目标',
  lifeMapSystems: '长期系统',
  lifeMapSystemCheckIns: '系统打卡',
  lifeMapEvents: '关键日期',
  lifeMapFocuses: '阶段重点',
  lifeMapNotes: '人生便签',
  lifeMapReviews: '周期复盘',
};

const FIELD_TYPE_MAP: Partial<Record<WorkspaceStorageField, keyof typeof ENTITY_KIND_LABELS>> = {
  tasks: 'tasks',
  groups: 'groups',
  notes: 'notes',
  milestones: 'milestones',
  schedules: 'schedules',
  retrospectives: 'retrospectives',
  reviewTasks: 'reviewTasks',
  nodes: 'nodes',
  lifeMapAreas: 'lifeMapAreas',
  lifeMapPlanGroups: 'lifeMapPlanGroups',
  lifeMapStages: 'lifeMapStages',
  lifeMapThemes: 'lifeMapThemes',
  lifeMapGoals: 'lifeMapGoals',
  lifeMapSystems: 'lifeMapSystems',
  lifeMapSystemCheckIns: 'lifeMapSystemCheckIns',
  lifeMapEvents: 'lifeMapEvents',
  lifeMapFocuses: 'lifeMapFocuses',
  lifeMapNotes: 'lifeMapNotes',
  lifeMapReviews: 'lifeMapReviews',
};

const SCALAR_FIELDS: Partial<Record<WorkspaceStorageField, string[]>> = {
  groups: ['name', 'color', 'description'],
  notes: ['date', 'content', 'color'],
  milestones: ['date', 'title', 'description'],
  lifeMapAreas: ['name', 'description'],
  lifeMapStages: ['name', 'description'],
};

function getEntityLabel(entity: Record<string, unknown>, kind: string): string {
  const candidates = ['name', 'title', 'topicName', 'displayName'];
  for (const key of candidates) {
    const value = entity[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  if (typeof entity.id === 'string') return `${kind}#${entity.id.slice(0, 8)}`;
  return '未命名条目';
}

function formatScalar(value: unknown): string {
  if (value === undefined) return '空';
  if (value === null) return '空';
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length} 项数组`;
  if (typeof value === 'object') return `${Object.keys(value as Record<string, unknown>).length} 个字段对象`;
  return String(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return false;
}

function diffScalars(
  base: Record<string, unknown> | undefined,
  local: Record<string, unknown> | undefined,
  remote: Record<string, unknown> | undefined,
  field: string,
): ConflictFieldDiff | null {
  const baseValue = base?.[field];
  const localValue = local?.[field];
  const remoteValue = remote?.[field];
  const localChanged = !deepEqual(baseValue, localValue);
  const remoteChanged = !deepEqual(baseValue, remoteValue);
  const diverged = localChanged && remoteChanged && !deepEqual(localValue, remoteValue);
  if (!diverged) return null;
  return {
    fieldPath: field,
    baseValue,
    localValue,
    remoteValue,
    diverged: true,
    summary: `${formatScalar(localValue)} → ${formatScalar(remoteValue)}`,
  };
}

function diffEntities(
  field: WorkspaceStorageField,
  local: unknown,
  remote: unknown,
  base: unknown,
): EntityConflict[] {
  const kind = FIELD_TYPE_MAP[field];
  if (!kind) return [];
  const localArr = Array.isArray(local) ? local as Record<string, unknown>[] : [];
  const remoteArr = Array.isArray(remote) ? remote as Record<string, unknown>[] : [];
  const baseArr = Array.isArray(base) ? base as Record<string, unknown>[] : [];
  const baseMap = new Map<string, Record<string, unknown>>();
  for (const item of baseArr) {
    if (typeof item?.id === 'string') baseMap.set(item.id, item);
  }
  const localMap = new Map<string, Record<string, unknown>>();
  for (const item of localArr) {
    if (typeof item?.id === 'string') localMap.set(item.id, item);
  }
  const remoteMap = new Map<string, Record<string, unknown>>();
  for (const item of remoteArr) {
    if (typeof item?.id === 'string') remoteMap.set(item.id, item);
  }
  const ids = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);
  const conflicts: EntityConflict[] = [];
  const candidateFields = SCALAR_FIELDS[field] ?? ['name', 'title', 'content', 'description', 'date'];
  for (const id of ids) {
    const localItem = localMap.get(id);
    const remoteItem = remoteMap.get(id);
    const baseItem = baseMap.get(id);
    if (!localItem && !remoteItem) continue;
    const localExisted = Boolean(localItem);
    const remoteExisted = Boolean(remoteItem);
    const baseExisted = Boolean(baseItem);
    const diffs: ConflictFieldDiff[] = [];
    if (!localExisted && remoteExisted && !baseExisted) {
      diffs.push({
        fieldPath: '(新建)',
        localValue: undefined,
        remoteValue: remoteItem,
        baseValue: undefined,
        diverged: true,
        summary: '远端新增条目',
      });
    } else if (localExisted && !remoteExisted && !baseExisted) {
      diffs.push({
        fieldPath: '(新建)',
        localValue: localItem,
        remoteValue: undefined,
        baseValue: undefined,
        diverged: true,
        summary: '本地新增条目',
      });
    } else if (localExisted && !remoteExisted && baseExisted) {
      diffs.push({
        fieldPath: '(删除)',
        localValue: undefined,
        remoteValue: remoteItem,
        baseValue: baseItem,
        diverged: true,
        summary: '本地删除 · 远端保留',
      });
    } else if (!localExisted && remoteExisted && baseExisted) {
      diffs.push({
        fieldPath: '(删除)',
        localValue: localItem,
        remoteValue: undefined,
        baseValue: baseItem,
        diverged: true,
        summary: '远端删除 · 本地保留',
      });
    } else if (localExisted && remoteExisted) {
      const merged: Record<string, unknown> = { ...(baseItem ?? {}), ...localItem, ...remoteItem };
      for (const candidate of candidateFields) {
        const diff = diffScalars(baseItem, localItem, remoteItem, candidate);
        if (diff) diffs.push(diff);
      }
      if (diffs.length === 0 && !deepEqual(localItem, remoteItem)) {
        diffs.push({
          fieldPath: '(整体内容)',
          localValue: localItem,
          remoteValue: remoteItem,
          baseValue: baseItem,
          diverged: true,
          summary: `整体内容不同（${Object.keys(merged).length} 个字段）`,
        });
      }
    }
    if (diffs.length === 0) continue;
    const representative = localItem ?? remoteItem ?? baseItem ?? {};
    conflicts.push({
      entityType: ENTITY_KIND_LABELS[kind] ?? kind,
      entityId: id,
      entityLabel: getEntityLabel(representative, kind),
      diffs,
    });
  }
  return conflicts;
}

export function summarizeFieldConflict(
  field: WorkspaceStorageField,
  fieldLabel: string,
  local: unknown,
  remote: unknown,
  base: unknown,
): FieldConflictSummary | null {
  const entities = diffEntities(field, local, remote, base);
  const totalDiffs = entities.reduce((sum, entity) => sum + entity.diffs.length, 0);
  if (entities.length === 0) return null;
  return {
    field,
    fieldLabel,
    entities,
    totalEntities: entities.length,
    totalDiffs,
  };
}

export function summarizeAllConflicts(
  conflict: {
    pending: { fields: Record<string, unknown> };
    remoteFields?: Partial<Record<WorkspaceStorageField, unknown>>;
  },
  base: { fields?: Record<string, unknown> } | null,
  fieldLabels: Partial<Record<WorkspaceStorageField, string>>,
): FieldConflictSummary[] {
  const summaries: FieldConflictSummary[] = [];
  const fields = Object.keys(conflict.pending.fields) as WorkspaceStorageField[];
  for (const field of fields) {
    const local = conflict.pending.fields[field];
    const remote = conflict.remoteFields?.[field];
    const baseValue = base?.fields?.[field];
    const summary = summarizeFieldConflict(
      field,
      fieldLabels[field] ?? String(field),
      local,
      remote,
      baseValue,
    );
    if (summary) summaries.push(summary);
  }
  return summaries;
}

export type { EntityConflict, FieldConflictSummary, ConflictFieldDiff, EntityPath };