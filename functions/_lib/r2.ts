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
