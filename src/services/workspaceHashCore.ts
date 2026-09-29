export function canonicalizeWorkspaceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeWorkspaceValue);
  if (value && typeof value === 'object') {
    // Locale-independent ordering keeps hashes identical across devices.
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, canonicalizeWorkspaceValue(item)]));
  }
  return value;
}

export async function hashWorkspaceValueDirect(value: unknown): Promise<string> {
  const serialized = JSON.stringify(canonicalizeWorkspaceValue(value)) ?? 'undefined';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function compareWorkspaceFields(
  lefts: Record<string, unknown>[],
  right: Record<string, unknown>,
  fieldNames: readonly string[],
): string[][] {
  const mismatches = lefts.map(() => [] as string[]);
  for (const field of fieldNames) {
    const canonicalRight = JSON.stringify(canonicalizeWorkspaceValue(right[field]));
    lefts.forEach((left, index) => {
      if (JSON.stringify(canonicalizeWorkspaceValue(left[field])) !== canonicalRight) {
        mismatches[index].push(field);
      }
    });
  }
  return mismatches;
}
