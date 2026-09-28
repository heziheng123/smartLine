import type { KeyboardEvent } from 'react';

const FOCUSABLE = 'tbody tr.bi-row input:not([disabled]), tbody tr.bi-row select:not([disabled]), tbody tr.bi-row button:not([disabled])';

export function handleVirtualTableTab(
  event: KeyboardEvent<HTMLTableElement>,
  scrollElement: HTMLDivElement | null,
  rowCount: number,
  scrollToIndex: (index: number) => void,
): void {
  if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey || !scrollElement) return;
  const row = (event.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-index]');
  if (!row) return;
  const focusable = scrollElement.querySelectorAll<HTMLElement>(FOCUSABLE);
  const boundary = event.shiftKey ? focusable[0] : focusable[focusable.length - 1];
  if (event.target !== boundary) return;

  const nextIndex = Number(row.dataset.index) + (event.shiftKey ? -1 : 1);
  if (nextIndex < 0 || nextIndex >= rowCount) return;
  event.preventDefault();
  scrollToIndex(nextIndex);

  let attempts = 0;
  const focusNext = () => {
    const nextRow = scrollElement.querySelector<HTMLTableRowElement>(`tr[data-index="${nextIndex}"]`);
    const controls = nextRow?.querySelectorAll<HTMLElement>('input:not([disabled]), select:not([disabled]), button:not([disabled])');
    const control = event.shiftKey ? controls?.[controls.length - 1] : controls?.[0];
    if (control) control.focus();
    else if (++attempts < 4) requestAnimationFrame(focusNext);
  };
  requestAnimationFrame(focusNext);
}
