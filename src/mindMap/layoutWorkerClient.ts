import { layoutActiveMindMap, type TreeDirection } from './layout';
import type { MindMapDocument } from './model';

export function layoutMindMapTreeInWorker(
  document: MindMapDocument,
  direction: TreeDirection = 'left-right',
): Promise<MindMapDocument> {
  if (typeof Worker === 'undefined') return Promise.resolve(layoutActiveMindMap(document, direction));
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
    const finish = (result: MindMapDocument) => {
      window.clearTimeout(timeout);
      worker.terminate();
      resolve(result);
    };
    const timeout = window.setTimeout(() => finish(layoutActiveMindMap(document, direction)), 15_000);
    worker.onmessage = (event: MessageEvent<MindMapDocument>) => finish(event.data);
    worker.onerror = () => finish(layoutActiveMindMap(document, direction));
    worker.postMessage({ document, direction });
  });
}
