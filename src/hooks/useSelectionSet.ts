import { useCallback, useState } from 'react';

export function useSelectionSet(initialIds: Iterable<string> = []) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(initialIds));

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setSelectedIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const replace = useCallback((ids: Iterable<string>) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const mutate = useCallback((update: (next: Set<string>) => void) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      update(next);
      return next;
    });
  }, []);

  return { selectedIds, toggle, remove, replace, clear, mutate };
}
