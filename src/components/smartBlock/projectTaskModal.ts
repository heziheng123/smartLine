export const PROJECT_TASK_MODAL_EVENT = 'tl-open-project-task-block';

export interface ProjectTaskModalDetail {
  taskId: string;
  blockId: string;
  source?: 'daily-schedule' | 'task-overview' | 'week-matrix' | 'time-block' | 'project';
  sourceDate?: string;
}

export function openProjectTaskModal(taskId: string, blockId: string, context: Omit<ProjectTaskModalDetail, 'taskId' | 'blockId'> = {}) {
  window.dispatchEvent(new CustomEvent<ProjectTaskModalDetail>(PROJECT_TASK_MODAL_EVENT, {
    detail: { taskId, blockId, ...context },
  }));
}
