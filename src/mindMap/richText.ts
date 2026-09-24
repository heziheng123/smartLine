import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked } from 'marked';
import type { MindMapNode } from './model';

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', javascript: 'javascript',
  ts: 'typescript', tsx: 'typescript', typescript: 'typescript',
  json: 'json', css: 'css', html: 'html', xml: 'html',
  bash: 'shell', sh: 'shell', shell: 'shell',
};

const CODE_KEYWORDS: Record<string, string> = {
  javascript: 'async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield',
  typescript: 'abstract any as async await boolean break case catch class const continue declare default delete do else enum export extends false finally for from function if implements import in infer instanceof interface keyof let namespace never new null number object of private protected public readonly return satisfies static string super switch symbol this throw true try type typeof undefined unknown var void while yield',
  json: 'false null true',
  css: 'important inherit initial none transparent unset var',
  shell: 'case do done elif else esac export fi for function if in local readonly then while',
};

const highlightCode = (source: string, rawLanguage = '') => {
  const language = CODE_LANGUAGE_ALIASES[rawLanguage.trim().toLocaleLowerCase()];
  if (!language) return { html: escapeHtml(source), language: '' };
  const keywordPattern = (CODE_KEYWORDS[language] ?? '').split(' ').filter(Boolean).join('|');
  const pattern = language === 'html'
    ? /(?<comment><!--[\s\S]*?-->)|(?<keyword><\/?[A-Za-z][^>]*>)/g
    : new RegExp(`(?<comment>${language === 'shell' ? '#[^\\n]*' : '\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*'})|(?<string>"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)|(?<number>\\b(?:0x[\\da-f]+|\\d+(?:\\.\\d+)?)\\b)${keywordPattern ? `|(?<keyword>\\b(?:${keywordPattern})\\b)` : ''}`, 'gi');
  let html = '';
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    html += escapeHtml(source.slice(cursor, index));
    const kind = Object.entries(match.groups ?? {}).find(([, value]) => value !== undefined)?.[0] ?? 'plain';
    html += `<span class="mm-token-${kind}">${escapeHtml(match[0])}</span>`;
    cursor = index + match[0].length;
  }
  return { html: html + escapeHtml(source.slice(cursor)), language };
};

/** Detects Markdown that should render as a rich mind-map node instead of plain text. */
export function isMindMapMarkdown(source: string) {
  return /(^|\n)[ \t]{0,3}(?:#{1,6}\s|[-+*]\s(?:\[[ xX]\]\s)?|\d+[.)]\s|>\s|```|\||-{3,}\s*$)|\*\*|__|~~|`|!?\[[^\]]*\]\([^)]+\)|\[\[[^\]]+\]\]|(?:^|[\s(])(?:\*[^*\n]+\*|_[^_\n]+_)/m.test(source);
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

export function setMindMapTaskChecked(source: string, taskIndex: number, checked: boolean) {
  let index = -1;
  return source.replace(/^(\s*[-+*]\s+)\[([ xX])\]/gm, (task, prefix: string) => {
    index += 1;
    return index === taskIndex ? `${prefix}[${checked ? 'x' : ' '}]` : task;
  });
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
  const renderer = new marked.Renderer();
  renderer.code = ({ text, lang }) => {
    const highlighted = highlightCode(text, lang ?? '');
    const language = highlighted.language ? ` data-language="${highlighted.language}"` : '';
    return `<pre${language}><code>${highlighted.html}</code></pre>`;
  };
  const html = marked.parse(resolved, { async: false, breaks: true, gfm: true, renderer })
    .replace(/ disabled=""(?= type="checkbox")/g, '');
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
