import { useTimelineStore } from '@/store';
import type { Milestone, Task } from '@/types';
import { useShallow } from 'zustand/react/shallow';
import { projectDatePatch, projectTaskDatePatch } from './datePatch';
import { findProjectTask, parseProjectTaskReferenceId, type ProjectTaskSnapshot } from './projection';

export { projectDatePatch, projectTaskDatePatch } from './datePatch';
export * from './projection';

export type ProjectPlanningRef =
  | { type: 'project'; id: string }
  | { type: 'task'; id: string }
  | { type: 'milestone'; id: string };

const findTask = (id: string) => useTimelineStore.getState().tasks.find((task) => task.id === id) ?? null;

export const projectPlanningAdapter = {
  getProject(id: string): Task | null {
    return findTask(id);
  },

  getTask(id: string): ProjectTaskSnapshot | null {
    return findProjectTask(useTimelineStore.getState().tasks, id);
  },

  getMilestone(id: string): Milestone | null {
    return useTimelineStore.getState().milestones.find((milestone) => milestone.id === id) ?? null;
  },

  getChildren(projectId: string): ProjectTaskSnapshot[] {
    const project = findTask(projectId);
    if (!project) return [];
    return project.blocks.flatMap((block) => block.type === 'smart-task'
      ? [{ id: `project-blk:${project.id}::${block.id}`, projectId: project.id, projectName: project.name, block }]
      : []);
  },

  updateProjectDates(id: string, start: string, end: string): boolean {
    const task = findTask(id);
    const patch = projectDatePatch(start, end);
    if (!task || !patch) return false;
    useTimelineStore.getState().updateTask({ ...task, ...patch });
    return true;
  },

  updateTaskDates(id: string, start: string, end: string): boolean {
    const target = parseProjectTaskReferenceId(id);
    const patch = projectTaskDatePatch(start, end);
    if (!target || !patch) return false;
    const result = useTimelineStore.getState().updateBlockHeader(target.projectId, target.blockId, patch);
    return !result.error;
  },
};

export const useProjectPlanningProjects = () => useTimelineStore((state) => state.tasks);

export const useProjectPlanningSnapshot = () => useTimelineStore(useShallow((state) => ({
  projects: state.tasks,
  milestones: state.milestones,
})));
