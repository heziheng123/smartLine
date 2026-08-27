import { useLifeMapStore } from '@/lifeMap/store';
import { useShallow } from 'zustand/react/shallow';
import type { LifeTimelineSnapshot } from './timelineProjection';
import type { LifeMapData } from '@/lifeMap/types';

export function useLifeMapDataSnapshot(): LifeMapData {
  return useLifeMapStore(useShallow((state) => ({
    lifeMapAreas: state.lifeMapAreas,
    lifeMapPlanGroups: state.lifeMapPlanGroups,
    lifeMapStages: state.lifeMapStages,
    lifeMapThemes: state.lifeMapThemes,
    lifeMapGoals: state.lifeMapGoals,
    lifeMapSystems: state.lifeMapSystems,
    lifeMapSystemCheckIns: state.lifeMapSystemCheckIns,
    lifeMapEvents: state.lifeMapEvents,
    lifeMapFocuses: state.lifeMapFocuses,
    lifeMapNotes: state.lifeMapNotes,
    lifeMapReviews: state.lifeMapReviews,
  })));
}

export function useLifeMapHydrated(): boolean {
  return useLifeMapStore((state) => state.isHydrated);
}

export function useLifeTimelineSnapshot(): LifeTimelineSnapshot {
  return useLifeMapStore(useShallow((state) => ({
    lifeMapAreas: state.lifeMapAreas,
    lifeMapStages: state.lifeMapStages,
    lifeMapThemes: state.lifeMapThemes,
    lifeMapGoals: state.lifeMapGoals,
    lifeMapSystems: state.lifeMapSystems,
    lifeMapEvents: state.lifeMapEvents,
    lifeMapFocuses: state.lifeMapFocuses,
    lifeMapNotes: state.lifeMapNotes,
    lifeMapReviews: state.lifeMapReviews,
  })));
}
