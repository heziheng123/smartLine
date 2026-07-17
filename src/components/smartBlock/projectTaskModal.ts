export const PROJECT_TASK_MODAL_EVENT = 'tl-open-project-task-block';

export interface ProjectTaskModalDetail {
  taskId: string;
  blockId: string;
}

export function openProjectTaskModal(taskId: string, blockId: string) {
  window.dispatchEvent(new CustomEvent<ProjectTaskModalDetail>(PROJECT_TASK_MODAL_EVENT, {
    detail: { taskId, blockId },
  }));
}

