type GraphDiagnosticCounters = Record<string, number>;

const counters: GraphDiagnosticCounters = {};
const details: Record<string, unknown> = {};

const isDevelopment = () =>
  (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true
  || (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production');

export function recordGraphDiagnostic(name: string, amount = 1): void {
  if (!isDevelopment()) return;
  counters[name] = (counters[name] ?? 0) + amount;
}

export function setGraphDiagnostic(name: string, value: number): void {
  if (!isDevelopment()) return;
  counters[name] = value;
}

export function setGraphDiagnosticDetail(name: string, value: unknown): void {
  if (!isDevelopment()) return;
  details[name] = value;
}

export function resetGraphDiagnostics(): void {
  Object.keys(counters).forEach((key) => delete counters[key]);
  Object.keys(details).forEach((key) => delete details[key]);
}

export function getGraphDiagnostics(): {
  counters: Readonly<GraphDiagnosticCounters>;
  details: Readonly<Record<string, unknown>>;
} {
  return { counters: { ...counters }, details: { ...details } };
}
