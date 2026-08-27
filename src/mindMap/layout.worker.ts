/// <reference lib="webworker" />

import { layoutMindMapTree, type TreeDirection } from './layout';
import type { MindMapDocument } from './model';

self.onmessage = (event: MessageEvent<{ document: MindMapDocument; direction: TreeDirection }>) => {
  self.postMessage(layoutMindMapTree(event.data.document, event.data.direction));
};
