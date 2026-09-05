const env = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env ?? {} as ImportMetaEnv;

export const MIND_MAP_ENABLED = env.VITE_MIND_MAP_ENABLED !== 'false';
export const MIND_MAP_SYNC_ENABLED = env.VITE_MIND_MAP_SYNC_ENABLED !== 'false';
