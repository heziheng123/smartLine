import type { LifeMapTimeMapper } from '../time/lifeMapTime';

export function createAnnotationBraceGeometry(start: string, end: string, mapper: LifeMapTimeMapper) {
  const top = mapper.dateToWorldY(start);
  const bottom = mapper.dateToWorldY(end);
  return { top, bottom, center: (top + bottom) / 2, height: bottom - top };
}

export type AnnotationPresentationKind = 'single' | 'compact-range' | 'range';

export function resolveAnnotationPresentation(start: string, end: string, mapper: LifeMapTimeMapper, minimumBraceHeight = 28) {
  const geometry = createAnnotationBraceGeometry(start, end, mapper);
  const kind: AnnotationPresentationKind = start === end
    ? 'single'
    : geometry.height < minimumBraceHeight ? 'compact-range' : 'range';
  return { ...geometry, kind };
}

/**
 * A real vertical curly brace whose first and last SVG points are the exact
 * date anchors. Only the interior control points adapt to the interval height.
 */
export function createVerticalAnnotationBracePath(x: number, top: number, bottom: number, width = 16) {
  const height = bottom - top;
  const center = top + height / 2;
  const shoulder = Math.min(20, Math.max(0, height / 4));
  const waist = Math.min(12, Math.max(0, height / 6));
  const endTipX = x;
  const stemX = x + width * .625;
  const centerTipX = x + width;
  return [
    `M ${endTipX} ${top}`,
    `C ${stemX} ${top} ${stemX} ${top + shoulder * .45} ${stemX} ${top + shoulder}`,
    `L ${stemX} ${center - waist}`,
    `C ${stemX} ${center - waist * .35} ${centerTipX} ${center - waist * .35} ${centerTipX} ${center}`,
    `C ${centerTipX} ${center + waist * .35} ${stemX} ${center + waist * .35} ${stemX} ${center + waist}`,
    `L ${stemX} ${bottom - shoulder}`,
    `C ${stemX} ${bottom - shoulder * .45} ${stemX} ${bottom} ${endTipX} ${bottom}`,
  ].join(' ');
}
