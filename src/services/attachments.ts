import type { AttachmentReference } from '@/types';

interface UploadGrant {
  id: string;
  uploadUrl: string;
  token: string;
}

export async function uploadAttachment(file: File): Promise<AttachmentReference> {
  const grantResponse = await fetch('/api/files/token', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
  });
  if (!grantResponse.ok) throw new Error((await grantResponse.json().catch(() => null))?.error || '无法创建附件上传令牌。');
  const grant = await grantResponse.json() as UploadGrant;
  const uploadResponse = await fetch(grant.uploadUrl, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { Authorization: `Bearer ${grant.token}`, 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!uploadResponse.ok) throw new Error((await uploadResponse.json().catch(() => null))?.error || '附件上传失败。');
  return { id: grant.id, name: file.name, type: file.type || 'application/octet-stream', size: file.size, createdAt: new Date().toISOString() };
}

export function attachmentUrl(reference: Pick<AttachmentReference, 'id'>): string {
  return `/api/files/${encodeURIComponent(reference.id)}`;
}

export async function deleteAttachment(reference: Pick<AttachmentReference, 'id'>): Promise<void> {
  const response = await fetch(attachmentUrl(reference), { method: 'DELETE', credentials: 'same-origin' });
  if (!response.ok) throw new Error('附件删除失败。');
}
