import type React from 'react';
import type { Task, TaskGroup } from '@/types';
import {
  getTaskBorderColor,
  getTaskTextColor,
  resolveTaskTheme,
  type ResolvedTaskTheme,
} from '@/utils/timeline-utils';
import { parseSourceId } from './conversion';

export interface ProjectAppearance {
  name: string;
  theme: ResolvedTaskTheme;
  categoryColor?: string;
  categoryName?: string;
}

function findTaskGroup(task: Task, groups: TaskGroup[]): TaskGroup | undefined {
  return groups.find((group) =>
    group.id === task.groupId || group.children.some((child) => child.id === task.id),
  );
}

/** Resolve the latest project name and theme from a persisted daily source id. */
export function resolveProjectAppearance(
  sourceId: string,
  tasks: Task[],
  groups: TaskGroup[],
): ProjectAppearance | null {
  const parsed = parseSourceId(sourceId);
  if (parsed?.source !== 'project') return null;
  const task = tasks.find((item) => item.id === parsed.parentTaskId);
  if (!task) return null;
  const group = findTaskGroup(task, groups);
  const sourceBlock = parsed.blockId
    ? (Array.isArray(task.blocks) ? task.blocks : [])
      .find((block) => block.id === parsed.blockId)
    : undefined;
  const smartBlock = sourceBlock?.type === 'smart-task' ? sourceBlock : undefined;
  return {
    name: task.name,
    theme: resolveTaskTheme(task, group?.color),
    categoryColor: smartBlock?.header.tagColor,
    categoryName: smartBlock?.header.tag,
  };
}

/** CSS variables consumed by every project-name badge. */
export function projectBadgeStyle(backgroundColor?: string): React.CSSProperties {
  const background = backgroundColor || '#E0E7FF';
  return {
    '--project-bg': background,
    '--project-border': getTaskBorderColor(background),
    '--project-text': getTaskTextColor(background),
  } as React.CSSProperties;
}

export function projectAccentColor(backgroundColor?: string): string {
  return getTaskBorderColor(backgroundColor || '#E0E7FF');
}
