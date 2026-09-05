const env = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env ?? {} as ImportMetaEnv;
const authEndpoint = env.VITE_LIVEBLOCKS_AUTH_ENDPOINT?.trim();
const publicKey = env.VITE_LIVEBLOCKS_PUBLIC_KEY?.trim();

export const liveblocksAuthMode = authEndpoint ? 'authenticated' : 'public-key';
export const liveblocksAuthEndpoint = authEndpoint;
export const liveblocksPublicKey = publicKey;
export const liveblocksPublicKeyFallbackDisabled =
  env.VITE_DISABLE_PUBLIC_KEY_FALLBACK === 'true';
