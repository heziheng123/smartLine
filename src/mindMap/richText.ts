import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked } from 'marked';
import type { MindMapNode } from './model';

/** Detects Markdown that should render as a rich mind-map node instead of plain text. */
export function isMindMapMarkdown(source: string) {
  return /(^|\n)(?:#{1,6}\s|[-+*]\s(?:\[[ xX]\]\s)?|\d+[.)]\s|>\s|```|\||-{3,}\s*$)|\*\*|__|~~|`|\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\]/m.test(source);
}

export function extractMindMapWikiLinks(source: string) {
  return [...source.matchAll(/\[\[([^\]\n]{1,200})\]\]/g)].map((match) => match[1].trim()).filter(Boolean);
}

export function mindMapBacklinks(nodes: Iterable<MindMapNode>, target: MindMapNode) {
  const targetName = target.text.trim().toLocaleLowerCase();
  if (!targetName) return [];
  return [...nodes].filter((node) => node.id !== target.id && extractMindMapWikiLinks(`${node.text}\n${node.note}`)
    .some((name) => name.toLocaleLowerCase() === targetName));
}

export function renderMindMapMarkdown(source: string, linkTargets: Iterable<Pick<MindMapNode, 'id' | 'text'>> = []) {
  const links = new Map<string, string>();
  for (const target of linkTargets) {
    const name = target.text.trim().toLocaleLowerCase();
    if (name && !links.has(name)) links.set(name, target.id);
  }
  const resolved = (source || '').replace(/\[\[([^\]\n]{1,200})\]\]/g, (original, rawName: string) => {
    const name = rawName.trim();
    const id = links.get(name.toLocaleLowerCase());
    return id ? `[${name.replace(/([\\\]])/g, '\\$1')}](#mind-map-node:${encodeURIComponent(id)})` : original;
  });
  const html = marked.parse(resolved, { async: false, breaks: true, gfm: true });
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

export function renderMindMapLatex(source: string) {
  return katex.renderToString(source || '\\text{空公式}', {
    displayMode: true,
    output: 'htmlAndMathml',
    strict: 'ignore',
    throwOnError: false,
  });
}
