// Browser E2E tests must import stores through the same module specifiers used
// by the application. Importing explicit `/src/.../store.ts` URLs can make Vite
// instantiate a second Zustand store that is disconnected from the rendered UI.
export { useTimelineStore } from '@/store';
export { useEbbStore } from '@/ebb/store';
export { useDailyScheduleStore } from '@/components/dailySchedule/store';
export { useGraphStore } from '@/graph/store';
export { useLifeMapStore } from '@/lifeMap/store';
