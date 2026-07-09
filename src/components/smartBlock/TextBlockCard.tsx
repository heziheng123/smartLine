// ============================================================
// 纯文本块卡片（Text Block Card）
// 支持内联编辑、删除
// ============================================================

import React, { useRef, useState, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import type { TextBlock } from '@/types';

interface TextBlockCardProps {
  block: TextBlock;
  onUpdate: (blockId: string, content: string) => void;
  onDelete: (blockId: string) => void;
  onSlashCommand?: (rect: { top: number; left: number }, blockId: string) => void;
}

const TextBlockCard: React.FC<TextBlockCardProps> = ({
  block,
  onUpdate,
  onDelete,
  onSlashCommand,
}) => {
  const [editing, setEditing] = useState(false);
  const [hovering, setHovering] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleBlur = useCallback(() => {
    if (contentRef.current) {
      onUpdate(block.id, contentRef.current.innerText);
    }
    setEditing(false);
  }, [block.id, onUpdate]);

  const handleClick = useCallback(() => {
    setEditing(true);
    setTimeout(() => {
      if (contentRef.current) {
        contentRef.current.focus();
      }
    }, 0);
  }, []);

  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const text = e.currentTarget.innerText;
    // Check if the text ends with '/' or if the caret is right after a '/'
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const textBeforeCaret = range.startContainer.textContent?.substring(0, range.startOffset) || '';
      
      if (textBeforeCaret.endsWith('/')) {
        const rect = range.getBoundingClientRect();
        if (onSlashCommand) {
          // Add offset to position the menu right below the cursor
          onSlashCommand({ top: rect.bottom + 5, left: rect.left }, block.id);
        }
      }
    }
  }, [block.id, onSlashCommand]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // If empty and backspace is pressed, delete the block
    if (e.key === 'Backspace' && !contentRef.current?.innerText) {
      e.preventDefault();
      onDelete(block.id);
    }
  }, [block.id, onDelete]);

  return (
    <div
      className="tb-card"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div
        ref={contentRef}
        className={`tb-content ${editing ? 'tb-content--active' : ''}`}
        contentEditable={editing}
        suppressContentEditableWarning
        onBlur={handleBlur}
        onClick={handleClick}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
      >
        {block.content || ''}
      </div>
      {!block.content && !editing && (
        <span className="tb-placeholder" onClick={handleClick}>
          输入 / 触发命令，或直接输入文本...
        </span>
      )}
      {hovering && (
        <button
          type="button"
          className="tb-delete-btn"
          onClick={() => onDelete(block.id)}
          title="删除"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
};

export default TextBlockCard;
