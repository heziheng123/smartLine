import {
  edgeSourceRef,
  edgeTargetRef,
  type CanvasObjectRef,
  type MindMapDocument,
} from '../model';

export interface ConnectableObject {
  ref: CanvasObjectRef;
  bounds: { x: number; y: number; width: number; height: number };
  canStartRelation: true;
  canReceiveRelation: true;
}

const boundsFor = (x: number, y: number, width: number, height: number) => ({ x: x - width / 2, y: y - height / 2, width, height });

export function connectableObjects(document: MindMapDocument): ConnectableObject[] {
  return [
    ...Object.values(document.nodes).map((node) => ({
      ref: { type: 'node' as const, id: node.id },
      bounds: boundsFor(node.x, node.y, node.width, node.height),
      canStartRelation: true as const,
      canReceiveRelation: true as const,
    })),
    ...Object.values(document.projectReferences).map((reference) => ({
      ref: { type: 'project-reference' as const, id: reference.id },
      bounds: boundsFor(reference.x, reference.y, reference.width, reference.height),
      canStartRelation: true as const,
      canReceiveRelation: true as const,
    })),
  ];
}

export function resolveConnectableObject(document: MindMapDocument, ref: CanvasObjectRef): ConnectableObject | null {
  if (ref.type === 'node') {
    const node = document.nodes[ref.id];
    return node ? {
      ref,
      bounds: boundsFor(node.x, node.y, node.width, node.height),
      canStartRelation: true,
      canReceiveRelation: true,
    } : null;
  }
  const reference = document.projectReferences[ref.id];
  return reference ? {
    ref,
    bounds: boundsFor(reference.x, reference.y, reference.width, reference.height),
    canStartRelation: true,
    canReceiveRelation: true,
  } : null;
}

export function edgeConnectableObjects(document: MindMapDocument, edge: Parameters<typeof edgeSourceRef>[0]) {
  const source = resolveConnectableObject(document, edgeSourceRef(edge));
  const target = resolveConnectableObject(document, edgeTargetRef(edge));
  return source && target ? { source, target } : null;
}

export function hitConnectableObject(objects: ConnectableObject[], point: { x: number; y: number }): ConnectableObject | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index];
    const { x, y, width, height } = object.bounds;
    if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) return object;
  }
  return null;
}
