import {
  edgeSourceRef,
  edgeTargetRef,
  type MindMapDocument,
  type MindMapEdge,
  type MindMapNode,
  type MindMapVisualTheme,
} from './model';
export const MIND_MAP_THEME_PRESETS: Record<MindMapVisualTheme, {
  label: string;
  palette: string[];
  centerMix: number;
  branchMix: number;
  childMix: number;
  compactChildren: boolean;
}> = {
  classic: {
    label: '经典脑图',
    palette: ['#5b5bd6', '#0f766e', '#2563eb', '#7c3aed', '#c2410c', '#be185d'],
    centerMix: 0.66,
    branchMix: 0.83,
    childMix: 0.96,
    compactChildren: true,
  },
  rainbow: {
    label: '彩虹分支',
    palette: ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'],
    centerMix: 0.56,
    branchMix: 0.76,
    childMix: 0.92,
    compactChildren: false,
  },
  professional: {
    label: '专业简报',
    palette: ['#1e3a5f', '#0f766e', '#475569', '#1d4ed8', '#6d28d9', '#9f1239'],
    centerMix: 0.78,
    branchMix: 0.90,
    childMix: 0.985,
    compactChildren: true,
  },
  warm: {
    label: '暖色创意',
    palette: ['#c2410c', '#d97706', '#ca8a04', '#65a30d', '#db2777', '#9333ea'],
    centerMix: 0.62,
    branchMix: 0.80,
    childMix: 0.94,
    compactChildren: false,
  },
};

export const MIND_MAP_TASK_STATUS_ICON = { todo: '○', doing: '◐', done: '✓' } as const;
export const MIND_MAP_PRIORITY_COLOR = { low: '#3b82f6', medium: '#f59e0b', high: '#ef4444' } as const;
export const MIND_MAP_PRIORITY_LABEL = { low: '低', medium: '中', high: '高' } as const;
export const MIND_MAP_MARKER_ICON = { none: '', star: '★', flag: '⚑', question: '?', idea: '💡' } as const;

const presetFor = (theme: MindMapVisualTheme | undefined) => MIND_MAP_THEME_PRESETS[theme ?? 'classic'];

const parseHexColor = (color: string) => {
  const value = color.trim().replace('#', '');
  const expanded = value.length === 3 ? value.split('').map((character) => character + character).join('') : value;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  return [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16));
};

export const mixMindMapColor = (source: string, target: string, targetRatio: number) => {
  const from = parseHexColor(source);
  const to = parseHexColor(target);
  if (!from || !to) return source;
  const ratio = Math.max(0, Math.min(1, targetRatio));
  return `#${from.map((channel, index) => Math.round(channel + (to[index] - channel) * ratio).toString(16).padStart(2, '0')).join('')}`;
};

export const mindMapColorWithAlpha = (color: string, alpha: number) => {
  const channels = parseHexColor(color);
  return channels ? `rgba(${channels.join(',')},${alpha})` : `rgba(91,91,214,${alpha})`;
};

export const mindMapNodeThemeColor = (node: MindMapNode, theme?: MindMapVisualTheme) => {
  if (node.colorMode === 'inherit') return presetFor(theme).palette[0];
  if (node.colorMode === 'custom') {
    return node.style.fill.toLowerCase() === '#fff' || node.style.fill.toLowerCase() === '#ffffff'
      ? node.style.borderColor
      : node.style.fill;
  }
  const fill = node.style.fill.toLowerCase();
  if (fill !== '#fff' && fill !== '#ffffff') return node.style.fill;
  if (node.style.borderColor.toLowerCase() !== '#d9dce3') return node.style.borderColor;
  return presetFor(theme).palette[0];
};

export interface MindMapNodePresentation {
  accent: string;
  fill: string;
  border: string;
  text: string;
  fontSize: number;
  fontWeight: number;
  shadow: boolean;
  topic: boolean;
}

export function resolveMindMapNodePresentation(
  node: MindMapNode,
  depth: number,
  accent: string,
  theme?: MindMapVisualTheme,
): MindMapNodePresentation {
  const preset = presetFor(theme);
  const textColor = ['#1d1d1f', '#202124'].includes(node.style.textColor.toLowerCase())
    ? null
    : node.style.textColor;
  const semantic = node.semantic ?? 'auto';
  const component = semantic === 'auto'
    ? depth === 0 ? 'topic' : depth === 1 ? 'branch' : 'subtopic'
    : semantic;
  if (component === 'topic') return {
    accent,
    fill: mixMindMapColor(accent, '#ffffff', preset.centerMix),
    border: mixMindMapColor(accent, '#ffffff', 0.32),
    text: textColor ?? mixMindMapColor(accent, '#202124', 0.62),
    fontSize: Math.max(17, node.style.fontSize),
    fontWeight: Math.max(680, node.style.fontWeight),
    shadow: theme !== 'professional' && node.style.shadow,
    topic: false,
  };
  if (component === 'summary') return {
    accent,
    fill: mixMindMapColor(accent, '#ffffff', 0.91),
    border: mixMindMapColor(accent, '#ffffff', 0.42),
    text: textColor ?? mixMindMapColor(accent, '#202124', 0.68),
    fontSize: Math.max(14, node.style.fontSize),
    fontWeight: Math.max(600, node.style.fontWeight),
    shadow: false,
    topic: true,
  };
  if (component === 'note') return {
    accent,
    fill: mixMindMapColor('#f59e0b', '#ffffff', 0.86),
    border: mixMindMapColor('#f59e0b', '#ffffff', 0.48),
    text: textColor ?? '#6b4d10',
    fontSize: node.style.fontSize,
    fontWeight: Math.max(450, Math.min(560, node.style.fontWeight)),
    shadow: false,
    topic: false,
  };
  if (component === 'branch') return {
    accent,
    fill: mixMindMapColor(accent, '#ffffff', preset.branchMix),
    border: mixMindMapColor(accent, '#ffffff', 0.58),
    text: textColor ?? mixMindMapColor(accent, '#202124', 0.68),
    fontSize: Math.max(14, node.style.fontSize),
    fontWeight: Math.max(580, node.style.fontWeight),
    shadow: false,
    topic: false,
  };
  return {
    accent,
    fill: mixMindMapColor(accent, '#ffffff', preset.childMix),
    border: mixMindMapColor(accent, '#ffffff', 0.84),
    text: textColor ?? mixMindMapColor(accent, '#202124', 0.78),
    fontSize: node.style.fontSize,
    fontWeight: Math.max(430, Math.min(520, node.style.fontWeight)),
    shadow: false,
    topic: preset.compactChildren,
  };
}

export function resolveBranchThemeColors(document: MindMapDocument) {
  const children = new Map<string, Array<{ id: string; order: number; createdAt: number }>>();
  const childIds = new Set<string>();
  for (const edge of Object.values(document.edges)) {
    const source = edgeSourceRef(edge);
    const target = edgeTargetRef(edge);
    if (edge.relationship !== 'tree' || source.type !== 'node' || target.type !== 'node') continue;
    const list = children.get(source.id) ?? [];
    list.push({ id: target.id, order: edge.order ?? Number.MAX_SAFE_INTEGER, createdAt: edge.createdAt });
    children.set(source.id, list);
    childIds.add(target.id);
  }
  for (const list of children.values()) list.sort((left, right) => left.order - right.order || left.createdAt - right.createdAt || left.id.localeCompare(right.id));

  const preset = presetFor(document.settings.mapTheme);
  const colors = new Map<string, string>();
  const visited = new Set<string>();
  const roots = Object.keys(document.nodes).filter((id) => !childIds.has(id));
  for (const rootId of [...roots, ...Object.keys(document.nodes)]) {
    if (visited.has(rootId)) continue;
    const root = document.nodes[rootId];
    if (!root) continue;
    const pending: Array<{ id: string; depth: number; color: string }> = [{
      id: rootId,
      depth: 0,
      color: mindMapNodeThemeColor(root, document.settings.mapTheme),
    }];
    for (let index = 0; index < pending.length; index += 1) {
      const current = pending[index];
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      colors.set(current.id, current.color);
      (children.get(current.id) ?? []).forEach((childEntry, childIndex) => {
        const child = document.nodes[childEntry.id];
        if (!child || visited.has(child.id)) return;
        const nodeColor = mindMapNodeThemeColor(child, document.settings.mapTheme);
        const color = current.depth === 0
          ? nodeColor === preset.palette[0] ? preset.palette[childIndex % preset.palette.length] : nodeColor
          : current.color;
        pending.push({ id: child.id, depth: current.depth + 1, color });
      });
    }
  }
  return colors;
}

export function resolveMindMapNodeDepths(document: MindMapDocument) {
  const children = new Map<string, string[]>();
  const childIds = new Set<string>();
  for (const edge of Object.values(document.edges)) {
    if (edge.relationship !== 'tree' || !document.nodes[edge.sourceId] || !document.nodes[edge.targetId]) continue;
    children.set(edge.sourceId, [...(children.get(edge.sourceId) ?? []), edge.targetId]);
    childIds.add(edge.targetId);
  }
  const depths = new Map<string, number>();
  const pending: Array<[string, number]> = Object.keys(document.nodes).filter((id) => !childIds.has(id)).map((id) => [id, 0]);
  for (let index = 0; index < pending.length; index += 1) {
    const [id, depth] = pending[index];
    if (depths.has(id)) continue;
    depths.set(id, depth);
    for (const childId of children.get(id) ?? []) pending.push([childId, depth + 1]);
  }
  return depths;
}

export function resolveTreeEdgeColor(edge: MindMapEdge, branchColors: ReadonlyMap<string, string>) {
  if (edge.relationship !== 'tree') return edge.style.color;
  const customColor = edge.style.color.toLowerCase() !== '#9aa3b2';
  return customColor ? edge.style.color : branchColors.get(edgeTargetRef(edge).id) ?? edge.style.color;
}
