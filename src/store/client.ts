import { createClient } from '@liveblocks/client';

const PUBLIC_KEY = import.meta.env.VITE_LIVEBLOCKS_PUBLIC_KEY;

if (!PUBLIC_KEY || !PUBLIC_KEY.startsWith('pk_')) {
  console.error('[Liveblocks] Missing or invalid VITE_LIVEBLOCKS_PUBLIC_KEY in environment variables.');
}

export const liveblocksClient = createClient({
  publicApiKey: PUBLIC_KEY || 'pk_test_invalid_key',
});
