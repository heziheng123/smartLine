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
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class', 'style'],
  ALLOWED_URI_REGEXP: /^(?:https?:|data:image\/|mailto:)/i,
};

/**
 * 净化 HTML 字符串：剥离 <script>、on* 事件属性、javascript: URI 等。
 * 保留常见富文本标签（段落、列表、链接、图片、强调），允许安全图片协议。
 * 用于渲染 SmartTaskBlock.body 等 user-editable / Liveblocks 远端同步内容。
 */
export function sanitizeHtml(dirty: string | undefined | null): string {
  if (!dirty) return '';
  return DOMPurify.sanitize(dirty, PURIFY_CONFIG) as string;
}
