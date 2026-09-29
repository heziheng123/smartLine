import { hashWorkspaceValueDirect } from './workspaceHashCore';

self.onmessage = async (event: MessageEvent<{ id: number; value: unknown }>) => {
  const { id, value } = event.data;
  try {
    self.postMessage({ id, hash: await hashWorkspaceValueDirect(value) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
