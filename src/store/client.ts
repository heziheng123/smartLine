import { createClient } from '@liveblocks/client';

const AUTH_ENDPOINT = import.meta.env.VITE_LIVEBLOCKS_AUTH_ENDPOINT?.trim();
const PUBLIC_KEY = import.meta.env.VITE_LIVEBLOCKS_PUBLIC_KEY?.trim();
const PUBLIC_KEY_FALLBACK_DISABLED = import.meta.env.VITE_DISABLE_PUBLIC_KEY_FALLBACK === 'true';

function createLiveblocksClient() {
  if (AUTH_ENDPOINT) {
    if (!AUTH_ENDPOINT.startsWith('/') && !AUTH_ENDPOINT.startsWith('https://')) {
      throw new Error('[Liveblocks] VITE_LIVEBLOCKS_AUTH_ENDPOINT must be a same-origin path or HTTPS URL.');
    }
    return createClient({ authEndpoint: AUTH_ENDPOINT });
  }

  if (PUBLIC_KEY_FALLBACK_DISABLED) {
    throw new Error('[Liveblocks] Authenticated endpoint is required because public-key fallback is disabled.');
  }

  if (!PUBLIC_KEY || !PUBLIC_KEY.startsWith('pk_')) {
    console.error('[Liveblocks] Missing or invalid Liveblocks authentication configuration.');
  }

  return createClient({
    publicApiKey: PUBLIC_KEY || 'pk_test_invalid_key',
  });
}

export const liveblocksAuthMode = AUTH_ENDPOINT ? 'authenticated' : 'public-key';
export const liveblocksClient = createLiveblocksClient();
