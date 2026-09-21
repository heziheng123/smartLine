import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked } from 'marked';

/** Detects Markdown that should render as a rich mind-map node instead of plain text. */
export function isMindMapMarkdown(source: string) {
  return /(^|\n)(?:#{1,6}\s|[-+*]\s(?:\[[ xX]\]\s)?|\d+[.)]\s|>\s|```|\|)|\*\*|__|~~|`|\[[^\]]+\]\([^)]+\)/.test(source);
}

export function renderMindMapMarkdown(source: string) {
  const html = marked.parse(source || '', { async: false, breaks: true, gfm: true });
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
