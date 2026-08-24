import type { MindMapNode } from '../model';
import { nodeRect, type Rect } from './geometry';

const CELL_SIZE = 480;
const cellKey = (x: number, y: number) => `${x}:${y}`;

export class MindMapSpatialIndex {
  private readonly cells = new Map<string, MindMapNode[]>();

  constructor(nodes: Iterable<MindMapNode>) {
    for (const node of nodes) {
      const rect = nodeRect(node);
      const left = Math.floor(rect.x / CELL_SIZE);
      const right = Math.floor((rect.x + rect.width) / CELL_SIZE);
      const top = Math.floor(rect.y / CELL_SIZE);
      const bottom = Math.floor((rect.y + rect.height) / CELL_SIZE);
      for (let x = left; x <= right; x += 1) {
        for (let y = top; y <= bottom; y += 1) {
          const key = cellKey(x, y);
          const cell = this.cells.get(key) ?? [];
          cell.push(node);
          this.cells.set(key, cell);
        }
      }
    }
  }

  query(rect: Rect) {
    const result = new Map<string, MindMapNode>();
    const left = Math.floor(rect.x / CELL_SIZE);
    const right = Math.floor((rect.x + rect.width) / CELL_SIZE);
    const top = Math.floor(rect.y / CELL_SIZE);
    const bottom = Math.floor((rect.y + rect.height) / CELL_SIZE);
    for (let x = left; x <= right; x += 1) {
      for (let y = top; y <= bottom; y += 1) {
        for (const node of this.cells.get(cellKey(x, y)) ?? []) result.set(node.id, node);
      }
    }
    return [...result.values()].filter((node) => {
      const nodeBounds = nodeRect(node);
      return nodeBounds.x <= rect.x + rect.width && nodeBounds.x + nodeBounds.width >= rect.x
        && nodeBounds.y <= rect.y + rect.height && nodeBounds.y + nodeBounds.height >= rect.y;
    });
  }
}
