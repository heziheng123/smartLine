import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked } from 'marked';

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
