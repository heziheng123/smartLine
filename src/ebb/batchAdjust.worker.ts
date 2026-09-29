import { planBatchReviewAdjustment, type BatchReviewRequest } from './batchAdjust';
import type { EbbSettings, ReviewTask } from './types';

let timer: ReturnType<typeof setTimeout> | undefined;
self.onmessage = (event: MessageEvent<{ id: number; tasks: ReviewTask[]; settings: EbbSettings; request: BatchReviewRequest }>) => {
  clearTimeout(timer);
  const { id, tasks, settings, request } = event.data;
  timer = setTimeout(() => {
    try {
      self.postMessage({ id, plan: planBatchReviewAdjustment(tasks, settings, request) });
    } catch (error) {
      self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }, 10);
};
