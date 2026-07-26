import {
  DEFAULT_WORKLOAD_PREFERENCES,
  type WorkloadPreferences,
} from '@/domain/taskBacklog';

const STORAGE_KEY = 'smart-line-workload-preferences-v1';
export const WORKLOAD_PREFERENCES_EVENT = 'smartline:workload-preferences';

function positiveMinutes(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 30 && number <= 1440
    ? Math.round(number)
    : fallback;
}

export function loadWorkloadPreferences(): WorkloadPreferences {
  if (typeof localStorage === 'undefined') return DEFAULT_WORKLOAD_PREFERENCES;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<WorkloadPreferences>;
    return {
      weekdayCapacityMinutes: positiveMinutes(
        parsed.weekdayCapacityMinutes,
        DEFAULT_WORKLOAD_PREFERENCES.weekdayCapacityMinutes,
      ),
      weekendCapacityMinutes: positiveMinutes(
        parsed.weekendCapacityMinutes,
        DEFAULT_WORKLOAD_PREFERENCES.weekendCapacityMinutes,
      ),
      showTaskCount: typeof parsed.showTaskCount === 'boolean'
        ? parsed.showTaskCount
        : DEFAULT_WORKLOAD_PREFERENCES.showTaskCount,
      showDuration: typeof parsed.showDuration === 'boolean'
        ? parsed.showDuration
        : DEFAULT_WORKLOAD_PREFERENCES.showDuration,
    };
  } catch {
    return DEFAULT_WORKLOAD_PREFERENCES;
  }
}

export function saveWorkloadPreferences(preferences: WorkloadPreferences): void {
  const normalized: WorkloadPreferences = {
    weekdayCapacityMinutes: positiveMinutes(preferences.weekdayCapacityMinutes, DEFAULT_WORKLOAD_PREFERENCES.weekdayCapacityMinutes),
    weekendCapacityMinutes: positiveMinutes(preferences.weekendCapacityMinutes, DEFAULT_WORKLOAD_PREFERENCES.weekendCapacityMinutes),
    showTaskCount: preferences.showTaskCount === true,
    showDuration: preferences.showDuration === true,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Display preferences are optional; still notify the current page.
  }
  window.dispatchEvent(new CustomEvent(WORKLOAD_PREFERENCES_EVENT, { detail: normalized }));
}
