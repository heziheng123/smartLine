export interface AnnotationTextAnchor { id: string; anchorY: number; height: number; }
export interface ResolvedAnnotationTextAnchor extends AnnotationTextAnchor { y: number; displaced: boolean; collapsed: boolean; }

export function resolveAnnotationTextCollisions(items: AnnotationTextAnchor[], gap = 10, maxDisplacement = 80): ResolvedAnnotationTextAnchor[] {
  let previousBottom = -Infinity;
  return [...items].sort((a, b) => a.anchorY - b.anchorY || a.id.localeCompare(b.id)).map((item) => {
    const idealTop = item.anchorY - item.height / 2;
    const y = Math.max(idealTop, previousBottom + gap);
    previousBottom = y + item.height;
    return { ...item, y, displaced: y !== idealTop, collapsed: y - idealTop > maxDisplacement };
  });
}
