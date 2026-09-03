import type { WorkspaceStorageField } from './workspaceSyncQueueCore';
import { workspaceValuesEqual } from './workspaceSyncCore';

export const WORKSPACE_ENTITY_STORAGE_VERSION = 1;
export const WORKSPACE_WRITER_PROTOCOL_VERSION = 1;

const ARRAY_FIELDS = new Set<WorkspaceStorageField>([
  'tasks', 'groups', 'notes', 'milestones', 'lifeStages',
  'lifeMapAreas', 'lifeMapPlanGroups', 'lifeMapStages', 'lifeMapThemes', 'lifeMapGoals',
  'lifeMapSystems', 'lifeMapSystemCheckIns', 'lifeMapEvents', 'lifeMapFocuses', 'lifeMapNotes', 'lifeMapReviews',
  'reviewTasks', 'inboxItems', 'outlineNodes', 'nodes',
]);
const MAP_FIELDS = new Set<WorkspaceStorageField>(['schedules', 'retrospectives']);
const ENTITY_KEY_PREFIX = 'workspace-entity:';

interface WorkspaceEntityRecord {
  version: 1;
  field: WorkspaceStorageField;
  id: string;
  value?: unknown;
  order?: number;
  deletedAt?: string;
  writeId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonValue(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? null : JSON.parse(serialized);
}

function isEntityField(field: string): field is WorkspaceStorageField {
  return ARRAY_FIELDS.has(field as WorkspaceStorageField) || MAP_FIELDS.has(field as WorkspaceStorageField);
}

function hashId(id: string): string {
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(id)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function workspaceEntityKey(field: WorkspaceStorageField, id: string): string {
  return `${ENTITY_KEY_PREFIX}${field}:${hashId(id)}`;
}

function collectionEntries(
  field: WorkspaceStorageField,
  value: unknown,
): Array<{ id: string; value: unknown; order?: number }> {
  if (ARRAY_FIELDS.has(field)) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, order) => (
      isRecord(item) && typeof item.id === 'string' && item.id
        ? [{ id: item.id, value: item, order }]
        : []
    ));
  }
  if (MAP_FIELDS.has(field) && isRecord(value)) {
    return Object.entries(value).map(([id, item]) => ({ id, value: item }));
  }
  return [];
}

function parseEntityRecord(value: unknown): WorkspaceEntityRecord | null {
  if (!isRecord(value)
    || value.version !== 1
    || typeof value.field !== 'string'
    || !isEntityField(value.field)
    || typeof value.id !== 'string'
    || !value.id
    || typeof value.writeId !== 'string') return null;
  if (value.deletedAt !== undefined && typeof value.deletedAt !== 'string') return null;
  return value as unknown as WorkspaceEntityRecord;
}

function entityRecords(root: Record<string, unknown>): Map<WorkspaceStorageField, Map<string, WorkspaceEntityRecord>> {
  const records = new Map<WorkspaceStorageField, Map<string, WorkspaceEntityRecord>>();
  for (const [key, value] of Object.entries(root)) {
    if (!key.startsWith(ENTITY_KEY_PREFIX)) continue;
    const record = parseEntityRecord(value);
    if (!record || workspaceEntityKey(record.field, record.id) !== key) continue;
    const fieldRecords = records.get(record.field) ?? new Map<string, WorkspaceEntityRecord>();
    fieldRecords.set(record.id, record);
    records.set(record.field, fieldRecords);
  }
  return records;
}

export function materializeWorkspaceEntityRoot(root: Record<string, unknown>): Record<string, unknown> {
  const metadata = isRecord(root.metadata) ? root.metadata : {};
  if (metadata.entityStorageVersion !== WORKSPACE_ENTITY_STORAGE_VERSION) return root;
  const result = { ...root };
  for (const [field, records] of entityRecords(root)) {
    const live = [...records.values()].filter((record) => !record.deletedAt && record.value !== undefined);
    if (ARRAY_FIELDS.has(field)) {
      result[field] = live
        .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
          || left.id.localeCompare(right.id))
        .map((record) => record.value);
    } else {
      result[field] = Object.fromEntries(live.map((record) => [record.id, record.value]));
    }
  }
  return result;
}

export function extractWorkspaceEntitySidecar(root: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(root).filter(([key]) => key.startsWith(ENTITY_KEY_PREFIX)));
}

/** Both schema-8 projections must contain the submitted value before dequeue. */
export function workspaceFieldsMatchEntityProjection(
  rawRoot: Record<string, unknown>,
  fields: Partial<Record<WorkspaceStorageField, unknown>>,
): boolean {
  const materialized = materializeWorkspaceEntityRoot(rawRoot);
  return Object.entries(fields).every(([field, value]) => (
    workspaceValuesEqual(rawRoot[field], value)
    && workspaceValuesEqual(materialized[field], value)
  ));
}

export function buildWorkspaceEntityWrites(
  before: Record<string, unknown>,
  fields: Record<string, unknown>,
  writeId: string,
  writtenAt = new Date().toISOString(),
): Record<string, WorkspaceEntityRecord> {
  const writes: Record<string, WorkspaceEntityRecord> = {};
  for (const [fieldName, nextValue] of Object.entries(fields)) {
    if (!isEntityField(fieldName)) continue;
    const beforeEntries = new Map(collectionEntries(fieldName, before[fieldName]).map((entry) => [entry.id, entry]));
    const nextEntries = new Map(collectionEntries(fieldName, nextValue).map((entry) => [entry.id, entry]));
    for (const entry of nextEntries.values()) {
      const previous = beforeEntries.get(entry.id);
      if (previous && previous.order === entry.order && workspaceValuesEqual(previous.value, entry.value)) continue;
      writes[workspaceEntityKey(fieldName, entry.id)] = {
        version: 1,
        field: fieldName,
        id: entry.id,
        value: jsonValue(entry.value),
        ...(entry.order === undefined ? {} : { order: entry.order }),
        writeId,
      };
    }
    for (const entry of beforeEntries.values()) {
      if (nextEntries.has(entry.id)) continue;
      writes[workspaceEntityKey(fieldName, entry.id)] = {
        version: 1,
        field: fieldName,
        id: entry.id,
        deletedAt: writtenAt,
        writeId,
      };
    }
  }
  return writes;
}

export function buildWorkspaceEntityInitializationWrites(
  fields: Record<string, unknown>,
  writeId: string,
): Record<string, WorkspaceEntityRecord> {
  return buildWorkspaceEntityWrites({}, fields, writeId);
}
