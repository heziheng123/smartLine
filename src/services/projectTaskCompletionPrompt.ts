import type {
  ProjectTaskCompletionImpact,
  ProjectTaskCompletionReviewDecision,
} from '@/domain/projectTaskCompletion';

export type ProjectTaskCompletionPromptResult = ProjectTaskCompletionReviewDecision | null;

type PromptHandler = (
  impact: ProjectTaskCompletionImpact,
) => Promise<ProjectTaskCompletionPromptResult>;

let handler: PromptHandler | null = null;

export function setProjectTaskCompletionPromptHandler(next: PromptHandler | null): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function requestProjectTaskCompletionDecision(
  impact: ProjectTaskCompletionImpact,
): Promise<ProjectTaskCompletionPromptResult> {
  if (handler) return handler(impact);
  const relearnable = impact.nodes.filter((node) => node.canRelearn);
  if (relearnable.length === 0) return Promise.resolve({ mode: 'continue' });
  const confirmed = window.confirm(
    `完成“${impact.taskTitle}”后，是否从 ${impact.completedDate} 重新开始完整复习周期？`,
  );
  return Promise.resolve(confirmed
    ? { mode: 'relearn', relearnNodeIds: relearnable.map((node) => node.nodeId) }
    : null);
}
