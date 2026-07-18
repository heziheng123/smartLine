export type TaskCategoryKind = 'project' | 'review' | 'free';

export interface TaskCategoryTheme {
  accentColor: string;
  backgroundColor: string;
}

const DEFAULT_COLORS: Record<TaskCategoryKind, string> = {
  project: '#8B9DC3',
  review: '#F59E0B',
  free: '#9CA3AF',
};

function withAlpha(color: string, alphaHex: string): string {
  return /^#[0-9a-f]{6}$/i.test(color)
    ? `${color}${alphaHex}`
    : `color-mix(in srgb, ${color} 25%, white)`;
}

/** Shared by Week Matrix and every Daily Schedule surface. */
export function resolveTaskCategoryTheme(
  color: string | undefined,
  kind: TaskCategoryKind = 'project',
): TaskCategoryTheme {
  const accentColor = color || DEFAULT_COLORS[kind];
  return {
    accentColor,
    backgroundColor: kind === 'free' ? '#F3F4F6' : withAlpha(accentColor, '40'),
  };
}
