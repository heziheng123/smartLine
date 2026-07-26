import type { Task, TaskGroup } from '@/types';
import { resolveTaskTheme } from '@/utils/timeline-utils';

export interface ProjectDescriptor {
  id: string;
  label: string;
  shortName: string;
  groupId?: string;
  groupName?: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
}

export function buildProjectDescriptorMap(
  tasks: readonly Task[],
  groups: readonly TaskGroup[],
): Map<string, ProjectDescriptor> {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const groupByTaskId = new Map<string, TaskGroup>();
  for (const group of groups) {
    for (const task of group.children ?? []) groupByTaskId.set(task.id, group);
  }

  const descriptors = new Map<string, ProjectDescriptor>();
  for (const task of tasks) {
    const group = groupByTaskId.get(task.id)
      ?? (task.groupId ? groupById.get(task.groupId) : undefined);
    const theme = resolveTaskTheme(task, group?.color);
    descriptors.set(task.id, {
      id: task.id,
      label: group ? `${group.name} / ${task.name}` : task.name,
      shortName: task.name,
      groupId: group?.id,
      groupName: group?.name,
      backgroundColor: theme.backgroundColor,
      textColor: theme.textColor,
      accentColor: theme.accentColor,
    });
  }
  return descriptors;
}
