export const PROJECT_TASK_CREATE_EVENT = 'tl-create-project-task';

export interface ProjectTaskCreateDetail {
  taskId?: string;
  date?: string;
  source?: 'project' | 'daily-schedule';
}

export function openProjectTaskCreate(detail: ProjectTaskCreateDetail = {}): void {
  window.dispatchEvent(new CustomEvent<ProjectTaskCreateDetail>(PROJECT_TASK_CREATE_EVENT, { detail }));
}
