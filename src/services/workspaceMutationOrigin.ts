export type WorkspaceMutationOrigin =
  | 'user'
  | 'restore'
  | 'remote-hydration'
  | 'indexeddb-hydration'
  | 'repair'
  | 'migration'
  | 'broadcast'
  | 'convergence'
  | 'system-normalization';

export function canWorkspaceMutationEnqueue(
  origin: WorkspaceMutationOrigin,
): origin is 'user' | 'restore' {
  return origin === 'user' || origin === 'restore';
}

let synchronousOrigin: WorkspaceMutationOrigin = 'user';

/**
 * Supplies origin only while a synchronous Zustand mutation is executing.
 * Async work must pass origin again at its eventual mutation/queue boundary.
 */
export function runWorkspaceMutationWithOrigin<T>(
  origin: WorkspaceMutationOrigin,
  mutation: () => T,
): T {
  const previous = synchronousOrigin;
  synchronousOrigin = origin;
  try {
    const result = mutation();
    if (result instanceof Promise) {
      throw new Error('Workspace mutation origin scopes must not cross an async boundary.');
    }
    return result;
  } finally {
    synchronousOrigin = previous;
  }
}

export function currentWorkspaceMutationOrigin(): WorkspaceMutationOrigin {
  return synchronousOrigin;
}
