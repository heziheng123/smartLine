import { getProjectBlockSourceId } from '@/components/dailySchedule/sourceIds';
import type { Milestone, SmartTaskBlock, Task } from '@/types';

export interface ProjectPlanningSnapshot {
  projects: Task[];
  milestones: Milestone[];
}

export interface ProjectTaskSnapshot {
  id: string;
  projectId: string;
  projectName: string;
  block: SmartTaskBlock;
}

export interface ProjectReferenceSnapshot {
  title: string;
  subtitle: string;
  color: string;
  progress?: number;
}

export const projectTaskReferenceId = getProjectBlockSourceId;

export function parseProjectTaskReferenceId(id: string): { projectId: string; blockId: string } | null {
  if (!id.startsWith('project-blk:')) return null;
  const separator = id.indexOf('::', 12);
  if (separator < 0) return null;
  const projectId = id.slice(12, separator);
  const blockId = id.slice(separator + 2);
  return projectId && blockId ? { projectId, blockId } : null;
}

export function findProjectTask(projects: Task[], id: string): ProjectTaskSnapshot | null {
  const target = parseProjectTaskReferenceId(id);
  if (!target) return null;
  const project = projects.find((item) => item.id === target.projectId);
  const block = project?.blocks.find((item): item is SmartTaskBlock => item.type === 'smart-task' && item.id === target.blockId);
  return project && block ? { id, projectId: project.id, projectName: project.name, block } : null;
}

export function projectReferenceSnapshot(
  target: { targetType: 'project' | 'task' | 'milestone'; targetId: string },
  data: ProjectPlanningSnapshot,
): ProjectReferenceSnapshot | null {
  if (target.targetType === 'project') {
    const project = data.projects.find((item) => item.id === target.targetId);
    if (!project) return null;
    const tasks = project.blocks.filter((block): block is SmartTaskBlock => block.type === 'smart-task');
    const completed = tasks.filter((block) => block.header.isCompleted).length;
    return {
      title: project.name,
      subtitle: `${project.start} — ${project.end}`,
      color: project.color ?? '#5e5ce6',
      progress: project.lifeMapProgress ?? (tasks.length ? Math.round(completed / tasks.length * 100) : project.completed ? 100 : 0),
    };
  }
  if (target.targetType === 'task') {
    const task = findProjectTask(data.projects, target.targetId);
    if (!task) return null;
    const start = task.block.header.date;
    const end = task.block.header.deadline;
    return {
      title: task.block.header.title,
      subtitle: [task.projectName, start && end ? `${start} — ${end}` : start ?? end].filter(Boolean).join(' · '),
      color: task.block.header.tagColor || '#5e5ce6',
      progress: task.block.header.isCompleted ? 100 : 0,
    };
  }
  const milestone = data.milestones.find((item) => item.id === target.targetId);
  return milestone ? {
    title: milestone.name,
    subtitle: milestone.date,
    color: milestone.color ?? '#af52de',
  } : null;
}
