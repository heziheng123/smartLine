export type LifeMapPlacement = 'above' | 'below';
export type LifeMapStatus = 'active' | 'completed' | 'paused' | 'archived';
export type LifeMapLayoutLane = number;

export interface LifeMapSyncMeta {
  createdAt: string;
  updatedAt: string;
  revision: number;
  deletedAt?: string;
}

export interface LifeMaintenancePeriod {
  id: string;
  start: string;
  end?: string;
  reason?: string;
}

export interface LifeArea extends LifeMapSyncMeta {
  id: string;
  name: string;
  color: string;
  icon?: string;
  order: number;
  isHidden?: boolean;
  maintenancePeriods?: LifeMaintenancePeriod[];
}

export interface LifeMapStage extends LifeMapSyncMeta {
  id: string;
  name: string;
  start: string;
  end: string;
  color?: string;
}

export interface LifeTheme extends LifeMapSyncMeta {
  id: string;
  areaId: string;
  name: string;
  start: string;
  end: string;
  color?: string;
  placement?: LifeMapPlacement;
  layoutLane?: LifeMapLayoutLane;
}

export interface LifeGoal extends LifeMapSyncMeta {
  id: string;
  areaId: string;
  name: string;
  start: string;
  targetDate: string;
  color?: string;
  placement?: LifeMapPlacement;
  status: LifeMapStatus;
  progress?: number;
  progressMode?: 'manual' | 'auto';
  metric?: string;
  initialValue?: number;
  currentValue?: number;
  targetValue?: number;
  unit?: string;
  isCore?: boolean;
  /** 旧数据未设置时按普通目标处理。主计划与计划阶段共用目标集合，以沿用同一套同步与备份链路。 */
  kind?: 'goal' | 'plan' | 'phase';
  /** 仅计划阶段使用，指向 kind=plan 的 LifeGoal。 */
  parentGoalId?: string;
  /** 面向时间线展示的简短说明或阶段结果。 */
  summary?: string;
  maintenancePeriods?: LifeMaintenancePeriod[];
}

export interface LifeSystem extends LifeMapSyncMeta {
  id: string;
  areaId: string;
  name: string;
  start: string;
  end?: string;
  color?: string;
  placement?: LifeMapPlacement;
  status: LifeMapStatus;
  frequency: 'daily' | 'weekly' | 'monthly';
  targetCount: number;
  unit?: string;
  durationMinutes?: number;
  /** 运行时也可合并所属领域的维护期，用于正确扣除目标次数。 */
  maintenancePeriods?: LifeMaintenancePeriod[];
}

export interface LifeSystemCheckIn extends LifeMapSyncMeta {
  id: string;
  systemId: string;
  date: string;
  count: number;
  note?: string;
}

export interface LifeReviewSnapshot {
  goals: Array<{ id: string; name: string; status: LifeMapStatus; progress?: number }>;
  systems: Array<{ id: string; name: string; completed: number; target: number; frequency?: LifeSystem['frequency'] }>;
}

export interface LifeReview extends LifeMapSyncMeta {
  id: string;
  title: string;
  period: 'month' | 'quarter';
  start: string;
  end: string;
  reflection: string;
  adjustments: string;
  areaIds?: string[];
  snapshot: LifeReviewSnapshot;
}

export interface LifeEvent extends LifeMapSyncMeta {
  id: string;
  areaId: string;
  name: string;
  date: string;
  color?: string;
  placement?: LifeMapPlacement;
  layoutLane?: LifeMapLayoutLane;
  importance?: 'normal' | 'important' | 'core';
}

export interface LifeFocus extends LifeMapSyncMeta {
  id: string;
  areaId: string;
  name: string;
  start: string;
  end: string;
  color?: string;
  placement?: LifeMapPlacement;
  layoutLane?: LifeMapLayoutLane;
}

export interface LifeMapNote extends LifeMapSyncMeta {
  id: string;
  areaId: string;
  name: string;
  date: string;
  endDate?: string;
  type: 'pin' | 'range';
  color?: string;
  placement?: LifeMapPlacement;
  layoutLane?: LifeMapLayoutLane;
}

export interface LifeRelation extends LifeMapSyncMeta {
  id: string;
  lifeItemType: 'goal' | 'system' | 'event';
  lifeItemId: string;
  projectId: string;
}

export interface LifeMapData {
  lifeMapAreas: LifeArea[];
  lifeMapStages: LifeMapStage[];
  lifeMapThemes: LifeTheme[];
  lifeMapGoals: LifeGoal[];
  lifeMapSystems: LifeSystem[];
  lifeMapSystemCheckIns: LifeSystemCheckIn[];
  lifeMapEvents: LifeEvent[];
  lifeMapFocuses: LifeFocus[];
  lifeMapNotes: LifeMapNote[];
  lifeMapRelations: LifeRelation[];
  lifeMapReviews: LifeReview[];
}

export type LifeMapEntity = LifeMapStage | LifeTheme | LifeGoal | LifeSystem | LifeSystemCheckIn | LifeEvent | LifeFocus | LifeMapNote | LifeRelation | LifeReview;
export type LifeMapEntityCollection = Exclude<keyof LifeMapData, 'lifeMapAreas'>;
