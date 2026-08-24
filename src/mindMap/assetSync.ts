import type { MindMapDocument } from './model';
import { mindMapRepository } from './repository';

const ready = new Set<string>();
const pending = new Map<string, Promise<'uploaded' | 'downloaded'>>();

export interface MindMapAssetCloud {
  cacheKey: string;
  download: (assetId: string) => Promise<Blob | null>;
  upload: (assetId: string, blob: Blob) => Promise<void>;
}

async function syncAsset(assetId: string, documentId: string, referenceCount: number, cloud: MindMapAssetCloud) {
  const cacheKey = `${cloud.cacheKey}:${assetId}`;
  if (ready.has(cacheKey)) {
    if (await mindMapRepository.loadImageAsset(assetId)) return null;
    ready.delete(cacheKey);
  }
  const running = pending.get(cacheKey);
  if (running) return running;
  const request = (async () => {
    const local = await mindMapRepository.loadImageAsset(assetId);
    if (local) {
      await cloud.upload(assetId, local.blob);
      ready.add(cacheKey);
      return 'uploaded' as const;
    }
    const blob = await cloud.download(assetId);
    if (!blob) throw new Error(`云端缺少图片“${assetId.slice(0, 8)}”。`);
    await mindMapRepository.saveImageAsset(blob, assetId, { [documentId]: referenceCount });
    ready.add(cacheKey);
    return 'downloaded' as const;
  })().finally(() => pending.delete(cacheKey));
  pending.set(cacheKey, request);
  return request;
}

export async function syncMindMapImageAssets(document: MindMapDocument, cloud: MindMapAssetCloud) {
  const counts = new Map<string, number>();
  for (const node of Object.values(document.nodes)) {
    if (node.imageAssetId) counts.set(node.imageAssetId, (counts.get(node.imageAssetId) ?? 0) + 1);
  }
  const results = await Promise.all([...counts].map(([assetId, count]) => (
    syncAsset(assetId, document.id, count, cloud)
  )));
  return {
    uploaded: results.filter((result) => result === 'uploaded').length,
    downloaded: results.filter((result) => result === 'downloaded').length,
  };
}
