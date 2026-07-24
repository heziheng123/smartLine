import { createClient } from '@liveblocks/client';
import {
  liveblocksAuthEndpoint,
  liveblocksAuthMode,
  liveblocksPublicKey,
  liveblocksPublicKeyFallbackDisabled,
} from '@/auth/config';

function createLiveblocksClient() {
  if (liveblocksAuthEndpoint) {
    if (!liveblocksAuthEndpoint.startsWith('/') && !liveblocksAuthEndpoint.startsWith('https://')) {
      throw new Error('[Liveblocks] VITE_LIVEBLOCKS_AUTH_ENDPOINT must be a same-origin path or HTTPS URL.');
    }
    return createClient({ authEndpoint: liveblocksAuthEndpoint });
  }

  if (liveblocksPublicKeyFallbackDisabled) {
    throw new Error('[Liveblocks] Authenticated endpoint is required because public-key fallback is disabled.');
  }

  if (!liveblocksPublicKey || !liveblocksPublicKey.startsWith('pk_')) {
    console.error('[Liveblocks] Missing or invalid Liveblocks authentication configuration.');
  }

  return createClient({
    publicApiKey: liveblocksPublicKey || 'pk_test_invalid_key',
  });
}

export { liveblocksAuthMode };
export const liveblocksClient = createLiveblocksClient();
