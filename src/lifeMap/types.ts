export type LifeMapPlacement = 'above' | 'below';
export type LifeMapStatus = 'active' | 'completed' | 'paused' | 'archived';
export type LifeMapLayoutLane = number;
export type LifeMapPlanGroupId = 'learning' | 'work' | 'life';

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
  planGroupId: LifeMapPlanGroupId;
  maintenancePeriods?: LifeMaintenancePeriod[];
}

export interface LifeMapPlanGroupPreference extends LifeMapSyncMeta {
  id: LifeMapPlanGroupId;
  placement: LifeMapPlacement;
  order: number;
}

export interface LifeMapStage extends LifeMapSyncMeta {
  id: string;
  name: string;
  start: string;
  end: string;
  /** 阶段的补充说明。旧数据会在规范化时补为空字符串。 */
  description?: string;
  color?: string;
  /** 仅表示用户定义的重要性；当前与选中状态属于运行时 UI 状态。 */
  importance?: 'normal' | 'important';
  /** 缺失时阶段作为全局叙事背景，覆盖学习、工作和生活。 */
  areaIds?: string[];
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
  /** 旧数据未设置时按普通目标处理。项目与项目子阶段共用目标集合，以沿用同一套同步与备份链路。 */
  kind?: 'goal' | 'plan' | 'phase';
  /** 仅项目子阶段使用，指向 kind=plan 的 LifeGoal。 */
  parentGoalId?: string;
  /** 子项目的时间关系。缺失的旧数据按先后阶段处理。 */
  childRole?: 'phase' | 'track';
  /** 历史兼容字段；新项目 UI 不再写入，规范化和备份仍保留。 */
  outcomeGoalId?: string;
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
  /** 缺失表示全局关键日期。 */
  areaId?: string;
  /** 可选关联一个人生地图主项目。 */
  relatedPlanId?: string;
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
  /** 缺失表示全局人生批注。 */
  areaId?: string;
  name: string;
  body?: string;
  date: string;
  endDate?: string;
  type: 'pin' | 'range';
  relatedStageId?: string;
  /** 可关联项目或项目单元。 */
  relatedGoalId?: string;
  color?: string;
  mood?: string;
  importance?: 'normal' | 'important';
  placement?: LifeMapPlacement;
  layoutLane?: LifeMapLayoutLane;
}

export interface LifeMapData {
  lifeMapAreas: LifeArea[];
  lifeMapPlanGroups: LifeMapPlanGroupPreference[];
  lifeMapStages: LifeMapStage[];
  lifeMapThemes: LifeTheme[];
  lifeMapGoals: LifeGoal[];
  lifeMapSystems: LifeSystem[];
  lifeMapSystemCheckIns: LifeSystemCheckIn[];
  lifeMapEvents: LifeEvent[];
  lifeMapFocuses: LifeFocus[];
  lifeMapNotes: LifeMapNote[];
  lifeMapReviews: LifeReview[];
}

export type LifeMapEntity = LifeMapPlanGroupPreference | LifeMapStage | LifeTheme | LifeGoal | LifeSystem | LifeSystemCheckIn | LifeEvent | LifeFocus | LifeMapNote | LifeReview;
export type LifeMapEntityCollection = Exclude<keyof LifeMapData, 'lifeMapAreas'>;
