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
}

const TextBlockCard: React.FC<TextBlockCardProps> = ({
  block,
  onUpdate,
  onDelete,
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
  }, []);

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
      >
        {block.content || ''}
      </div>
      {!block.content && !editing && (
        <span className="tb-placeholder" onClick={handleClick}>
          输入文本...
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
