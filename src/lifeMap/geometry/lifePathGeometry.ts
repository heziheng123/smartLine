export interface LifePathInfluence {
  id: string;
  startY: number;
  endY: number;
  importance?: 'normal' | 'important';
  isCurrent?: boolean;
  isSelected?: boolean;
}

export interface LifePathGeometryOptions {
  centerX?: number;
  amplitude?: number;
  wavelength?: number;
  todayY?: number;
  sampleStep?: number;
  stages?: LifePathInfluence[];
}

export interface LifePathPoint { x: number; y: number; }

export interface LifePathGeometry {
  options: Required<LifePathGeometryOptions>;
  getLifePathX: (worldY: number) => number;
  getLifePathPoint: (worldY: number) => LifePathPoint;
  getLifePathTangent: (worldY: number) => LifePathPoint;
  getLifePathNormal: (worldY: number) => LifePathPoint;
  getAmplitudeAt: () => number;
  getLabelAngle: (worldY: number) => number;
}

export function createLifePathGeometry(input: LifePathGeometryOptions = {}): LifePathGeometry {
  const options: Required<LifePathGeometryOptions> = {
    centerX: input.centerX ?? 460,
    amplitude: input.amplitude ?? 28,
    wavelength: input.wavelength ?? 260,
    todayY: input.todayY ?? 0,
    sampleStep: input.sampleStep ?? 8,
    stages: input.stages ?? [],
  };
  const getAmplitudeAt = () => Math.min(72, Math.max(0, options.amplitude));
  const getLifePathX = (worldY: number) => options.centerX + getAmplitudeAt() * Math.sin((worldY - options.todayY) / options.wavelength);
  const getLifePathPoint = (worldY: number) => ({ x: getLifePathX(worldY), y: worldY });
  const getLifePathTangent = (worldY: number) => {
    const dx = getAmplitudeAt() / options.wavelength * Math.cos((worldY - options.todayY) / options.wavelength);
    const length = Math.hypot(dx, 1);
    return { x: dx / length, y: 1 / length };
  };
  const getLifePathNormal = (worldY: number) => {
    const tangent = getLifePathTangent(worldY);
    return { x: -tangent.y, y: tangent.x };
  };
  const getLabelAngle = (worldY: number) => Math.atan2(getLifePathTangent(worldY).x, getLifePathTangent(worldY).y) * 180 / Math.PI;
  return { options, getLifePathX, getLifePathPoint, getLifePathTangent, getLifePathNormal, getAmplitudeAt, getLabelAngle };
}
