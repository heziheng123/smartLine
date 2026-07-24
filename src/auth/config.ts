const authEndpoint = import.meta.env.VITE_LIVEBLOCKS_AUTH_ENDPOINT?.trim();
const publicKey = import.meta.env.VITE_LIVEBLOCKS_PUBLIC_KEY?.trim();

export const liveblocksAuthMode = authEndpoint ? 'authenticated' : 'public-key';
export const liveblocksAuthEndpoint = authEndpoint;
export const liveblocksPublicKey = publicKey;
export const liveblocksPublicKeyFallbackDisabled =
  import.meta.env.VITE_DISABLE_PUBLIC_KEY_FALLBACK === 'true';
