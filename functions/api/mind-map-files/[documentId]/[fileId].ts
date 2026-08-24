import { jsonResponse, readSession, type AuthEnv } from '../../../_lib/session.ts';
import { buildMindMapRoomId } from '../../../_lib/mindMapRoom.ts';

interface FunctionContext {
  env: AuthEnv;
  request: Request;
  params: { documentId?: string; fileId?: string };
}

const API = 'https://api.liveblocks.io/v2';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export async function onRequestGet({ env, request, params }: FunctionContext): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);
  const secret = env.LIVEBLOCKS_SECRET_KEY?.trim();
  if (!secret?.startsWith('sk_')) return jsonResponse({ error: 'Liveblocks is not configured.' }, 503);
  const documentId = params.documentId?.trim() ?? '';
  const fileId = params.fileId?.trim() ?? '';
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(documentId) || !/^fl_[a-zA-Z0-9_-]{21}$/.test(fileId)) {
    return jsonResponse({ error: 'Invalid mind map file request.' }, 400);
  }
  const roomId = buildMindMapRoomId(`gh_${session.githubUserId}`, documentId);
  try {
    const metadataResponse = await fetch(
      `${API}/rooms/${encodeURIComponent(roomId)}/storage/files/${encodeURIComponent(fileId)}`,
      {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (metadataResponse.status === 404) return jsonResponse({ error: 'Image not found.' }, 404);
    if (!metadataResponse.ok) return jsonResponse({ error: 'Unable to read Liveblocks image.' }, 502);
    const metadata = await metadataResponse.json() as { mimeType?: string; size?: number; url?: string };
    if (!metadata.url || !IMAGE_TYPES.has(metadata.mimeType ?? '') || !Number.isFinite(metadata.size)
      || Number(metadata.size) > MAX_IMAGE_BYTES) {
      return jsonResponse({ error: 'Invalid Liveblocks image metadata.' }, 502);
    }
    const fileResponse = await fetch(metadata.url, { signal: AbortSignal.timeout(20_000) });
    if (!fileResponse.ok || !fileResponse.body) return jsonResponse({ error: 'Unable to download Liveblocks image.' }, 502);
    return new Response(fileResponse.body, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Length': String(metadata.size),
        'Content-Type': metadata.mimeType!,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return jsonResponse({ error: 'Liveblocks image storage is temporarily unavailable.' }, 502);
  }
}

export function onRequest(): Response { return jsonResponse({ error: 'Method not allowed.' }, 405); }
