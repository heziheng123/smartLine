import type { AuthEnv } from './session.ts';

export interface R2StoredObject {
  body: ReadableStream<Uint8Array>;
  httpEtag?: string;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

export interface SmartLineR2Bucket {
  put(key: string, value: ReadableStream<Uint8Array> | ArrayBuffer | string, options?: {
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
    onlyIf?: Headers | { etagMatches?: string; etagDoesNotMatch?: string };
  }): Promise<unknown>;
  get(key: string): Promise<R2StoredObject | null>;
  delete(key: string): Promise<void>;
}

export interface StorageEnv extends AuthEnv {
  SMARTLINE_R2?: SmartLineR2Bucket;
}

export function safeObjectId(value: string): string | null {
  return /^[a-zA-Z0-9_-]{8,128}$/.test(value) ? value : null;
}

export function archiveKey(userId: string, period: string): string {
  return `users/${userId}/archives/${period}.json`;
}

export function workspaceHistoryKey(userId: string, date: string): string {
  return `users/${userId}/workspace-history/${date}.json`;
}

export async function readLimitedBody(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}
