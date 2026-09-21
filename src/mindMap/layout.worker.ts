/// <reference lib="webworker" />

import { layoutActiveMindMap, type TreeDirection } from './layout';
import type { MindMapDocument } from './model';

self.onmessage = (event: MessageEvent<{ document: MindMapDocument; direction: TreeDirection }>) => {
  self.postMessage(layoutActiveMindMap(event.data.document, event.data.direction));
};
