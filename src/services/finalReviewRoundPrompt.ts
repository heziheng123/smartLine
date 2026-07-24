export interface FinalReviewRoundPromptOptions {
  topicName: string;
  currentRound: number;
  suggestedDate: string;
  minimumDate: string;
}

export type FinalReviewRoundPromptResult =
  | { decision: 'finish' }
  | { decision: 'append'; nextDueDate: string }
  | null;

type PromptHandler = (
  options: FinalReviewRoundPromptOptions,
) => Promise<FinalReviewRoundPromptResult>;

let handler: PromptHandler | null = null;

export function setFinalReviewRoundPromptHandler(next: PromptHandler | null): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function requestFinalReviewRoundDecision(
  options: FinalReviewRoundPromptOptions,
): Promise<FinalReviewRoundPromptResult> {
  if (handler) return handler(options);
  const append = window.confirm(
    `“${options.topicName}”的第 ${options.currentRound} 轮是当前最后一轮。\n\n`
    + `确定：完成并在 ${options.suggestedDate} 增加一轮\n取消：暂不完成`,
  );
  return Promise.resolve(append
    ? { decision: 'append', nextDueDate: options.suggestedDate }
    : null);
}
