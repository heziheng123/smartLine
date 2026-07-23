export type ChoiceTone = 'default' | 'warning';

export interface ChoiceOption {
  value: string;
  label: string;
  description: string;
  recommended?: boolean;
}

export interface ChoiceOptions {
  title: string;
  message: string;
  choices: ChoiceOption[];
  cancelLabel?: string;
  tone?: ChoiceTone;
  impact?: string[];
}

type ChoiceHandler = (options: ChoiceOptions) => Promise<string | null>;

let handler: ChoiceHandler | null = null;

export function setChoiceHandler(next: ChoiceHandler | null): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/**
 * Opens the shared multi-choice dialog. The confirm fallback is only used
 * before the app host mounts or in isolated non-visual tests.
 */
export function requestChoice<T extends string>(options: ChoiceOptions): Promise<T | null> {
  if (handler) return handler(options) as Promise<T | null>;
  const first = options.choices[0];
  if (!first) return Promise.resolve(null);
  return Promise.resolve(window.confirm(`${options.message}\n\n${first.label}`) ? first.value as T : null);
}
