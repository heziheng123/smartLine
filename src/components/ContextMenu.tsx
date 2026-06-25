// ============================================================
// Smart Timeline - 右键上下文菜单
// ============================================================

import React, { useEffect, useRef } from 'react';
import type { ContextMenuItem } from '@/types';

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // 确保菜单不超出视口
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const menu = menuRef.current;

    if (rect.right > window.innerWidth) {
      menu.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="tl-context-menu"
      style={{ left: x, top: y }}
    >
      {items.map((item, idx) => {
        // 纯分隔线项：只渲染分割线，不渲染按钮
        if (item.divider && !item.label) {
          return <div key={idx} className="tl-context-menu-divider" />;
        }
        return (
          <React.Fragment key={idx}>
            {item.divider && <div className="tl-context-menu-divider" />}
            <button
              className={`tl-context-menu-item ${item.danger ? 'tl-context-menu-item--danger' : ''}`}
              onClick={() => {
                item.action();
                onClose();
              }}
              type="button"
            >
              {item.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default ContextMenu;
