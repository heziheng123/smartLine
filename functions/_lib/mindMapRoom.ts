const safeRoomPart = (value: string, limit: number) => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, limit);

function safeDocumentRoomPart(value: string): string {
  const safe = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (safe.length <= 48) return safe;
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `${safe.slice(0, 39)}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildMindMapRoomId(identity: string, documentId: string): string {
  const owner = safeRoomPart(identity, 48);
  const document = safeDocumentRoomPart(documentId);
  if (!owner || !document) throw new Error('Invalid mind map room identity.');
  return `workspace-${owner}-mind-map-${document}`;
}
