import type { LifeMapStage } from '../types';
import type { LifePathGeometry, LifePathPoint } from './lifePathGeometry';

export interface StageBandOptions {
  dateToWorldY?: (date: string) => number;
  width?: number;
  offset?: (worldY: number) => number;
  labelShiftX?: (worldY: number) => number;
  labelShiftY?: (worldY: number) => number;
}

export interface StageBandGeometry {
  id: string;
  path: string;
  centerPath: string;
  points: LifePathPoint[];
  anchor: LifePathPoint;
  label: { side: 1 | -1; x: number; y: number; angle: number };
}

export interface ParallelStageBands {
  visible: StageBandGeometry[];
  overflow: LifeMapStage[];
  overflowCount: number;
}

export interface StageBranchLayout {
  getOffset: (stageId: string, worldY: number) => number;
  getLabelShiftX: (stageId: string, worldY: number) => number;
  getLabelShiftY: (stageId: string, worldY: number) => number;
}

type StageInput = Pick<LifeMapStage, 'id' | 'start' | 'end'>;

export function createStageBand(stage: StageInput, geometry: LifePathGeometry, options: StageBandOptions = {}): StageBandGeometry {
  if (!options.dateToWorldY) throw new Error('dateToWorldY is required');
  const startY = options.dateToWorldY(stage.start);
  const endY = options.dateToWorldY(stage.end);
  const steps = Math.max(4, Math.ceil(Math.abs(endY - startY) / 24));
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const worldY = startY + (endY - startY) * index / steps;
    const offset = options.offset?.(worldY) ?? 0;
    const point = geometry.getLifePathPoint(worldY);
    const normal = geometry.getLifePathNormal(worldY);
    return { x: point.x + normal.x * offset, y: point.y + normal.y * offset };
  });
  const halfWidth = (options.width ?? 34) / 2;
  const left = points.map((point, index) => {
    const normal = geometry.getLifePathNormal(startY + (endY - startY) * index / steps);
    return { x: point.x + normal.x * halfWidth, y: point.y + normal.y * halfWidth };
  });
  const right = points.map((point, index) => {
    const normal = geometry.getLifePathNormal(startY + (endY - startY) * index / steps);
    return { x: point.x - normal.x * halfWidth, y: point.y - normal.y * halfWidth };
  });
  const toPath = (items: LifePathPoint[]) => items.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const centerIndex = Math.floor(points.length / 2);
  const anchor = points[centerIndex];
  const side: 1 | -1 = stage.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2 === 0 ? 1 : -1;
  const worldY = anchor.y;
  return {
    id: stage.id,
    path: `${toPath(left)} ${right.slice().reverse().map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')} Z`,
    centerPath: toPath(points),
    points,
    anchor,
    label: {
      side,
      x: anchor.x + (options.labelShiftX?.(worldY) ?? 0),
      y: anchor.y + (options.labelShiftY?.(worldY) ?? 0),
      angle: geometry.getLabelAngle(worldY),
    },
  };
}

export function createParallelStageBands(stages: LifeMapStage[], geometry: LifePathGeometry, options: StageBandOptions & { today?: string; selectedStageId?: string } = {}): ParallelStageBands {
  const selectedId = options.selectedStageId;
  const visibleIds = new Set(stages.slice(0, 3).map((stage) => stage.id));
  if (selectedId && !visibleIds.has(selectedId)) {
    visibleIds.delete(stages[2]?.id ?? '');
    visibleIds.add(selectedId);
  }
  const visibleStages = stages.filter((stage) => visibleIds.has(stage.id));
  return {
    visible: visibleStages.map((stage, index) => createStageBand(stage, geometry, { ...options, offset: (worldY) => (index - (visibleStages.length - 1) / 2) * 24 + (options.offset?.(worldY) ?? 0) })),
    overflow: stages.filter((stage) => !visibleIds.has(stage.id)),
    overflowCount: Math.max(0, stages.length - visibleStages.length),
  };
}

export function createStageBranchLayout(stages: StageInput[], dateToWorldY: (date: string) => number): StageBranchLayout {
  const activeAt = (worldY: number) => stages.filter((stage) => worldY >= dateToWorldY(stage.start) && worldY <= dateToWorldY(stage.end));
  const getOffset = (stageId: string, worldY: number) => {
    const active = activeAt(worldY);
    if (active.length < 2) return 0;
    const index = active.findIndex((stage) => stage.id === stageId);
    return index < 0 ? 0 : (index - (active.length - 1) / 2) * 36;
  };
  return { getOffset, getLabelShiftX: getOffset, getLabelShiftY: () => 0 };
}
