// ============================================================
// HTML 净化工具：基于 DOMPurify
// 用于 SafeTaskBlock.body 等 user-editable HTML 的渲染前净化
// 防止通过 contentEditable 粘贴或 Liveblocks 远端同步注入恶意脚本
// ============================================================

import DOMPurify from 'dompurify';

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'del',
    'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'span', 'div', 'blockquote', 'code', 'pre',
    'img',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'title'],
  FORBID_TAGS: ['style', 'svg', 'math', 'form', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['style', 'class', 'id', 'srcset', 'formaction'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  SANITIZE_NAMED_PROPS: true,
  ALLOWED_URI_REGEXP: /^(?:(?:https):|mailto:|\/(?!\/)|#)/i,
};

/**
 * 净化 HTML 字符串：剥离 <script>、on* 事件属性、javascript: URI 等。
 * 保留常见富文本标签（段落、列表、链接、图片、强调），允许安全图片协议。
 * 用于渲染 SmartTaskBlock.body 等 user-editable / Liveblocks 远端同步内容。
 */
export function sanitizeHtml(dirty: string | undefined | null): string {
  if (!dirty) return '';
  const clean = DOMPurify.sanitize(dirty, PURIFY_CONFIG) as string;
  if (typeof document === 'undefined') return clean;

  const template = document.createElement('template');
  template.innerHTML = clean;
  template.content.querySelectorAll('a').forEach((link) => {
    if (link.getAttribute('target') === '_blank') {
      link.setAttribute('rel', 'noopener noreferrer');
    } else {
      link.removeAttribute('target');
      link.removeAttribute('rel');
    }
  });
  template.content.querySelectorAll('img').forEach((image) => {
    const source = image.getAttribute('src');
    if (!source) {
      image.remove();
      return;
    }
    try {
      const url = new URL(source, window.location.href);
      const sameOrigin = url.origin === window.location.origin;
      if (!sameOrigin && url.protocol !== 'https:') image.remove();
    } catch {
      image.remove();
    }
  });
  return template.innerHTML;
}
