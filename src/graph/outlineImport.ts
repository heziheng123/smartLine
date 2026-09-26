export interface GraphNodeDraft {
  name: string;
  parentId?: string | null;
  parentIndex?: number;
}

export function parseGraphOutline(text: string, baseParentId: string | null = null): GraphNodeDraft[] {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const drafts: GraphNodeDraft[] = [];
  const stack: Array<{ level: number; index: number }> = [];

  for (const line of lines) {
    const match = line.match(/^(#+)\s+(.*)/);
    const level = match ? match[1].length : 1;
    const name = match ? match[2].trim() : line;
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();

    const parentIndex = stack.at(-1)?.index;
    const index = drafts.length;
    drafts.push(parentIndex === undefined ? { name, parentId: baseParentId } : { name, parentIndex });
    stack.push({ level, index });
  }

  return drafts;
}
