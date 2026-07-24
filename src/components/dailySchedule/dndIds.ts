import type { TimeSlot } from './types';

export const DROPPABLE_POOL = 'ds-pool';
export const DROPPABLE_REVIEW_POOL = `${DROPPABLE_POOL}-review`;
export const DROPPABLE_VOCABULARY_POOL = `${DROPPABLE_POOL}-vocabulary`;
export const DROPPABLE_POOL_CONTAINER = 'ds-pool-container';
export const DROPPABLE_BACKLOG = 'ds-backlog';

export const droppableIdForSlot = (slot: TimeSlot) => `ds-slot-${slot}`;

export function isTaskPoolDroppable(droppableId: string): boolean {
  return droppableId === DROPPABLE_POOL
    || droppableId === DROPPABLE_REVIEW_POOL
    || droppableId === DROPPABLE_VOCABULARY_POOL
    || droppableId === DROPPABLE_BACKLOG
    || droppableId === DROPPABLE_POOL_CONTAINER;
}
