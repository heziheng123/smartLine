import { compareWorkspaceFields } from './workspaceHashCore';

self.onmessage = (event: MessageEvent<{ lefts: Record<string, unknown>[]; right: Record<string, unknown>; fields: string[] }>) => {
  const { lefts, right, fields } = event.data;
  self.postMessage(compareWorkspaceFields(lefts, right, fields));
};
